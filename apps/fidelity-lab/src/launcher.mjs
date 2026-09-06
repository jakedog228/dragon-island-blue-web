import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  createSourceFreshnessGuard,
  defaultNativePackage,
  discoverLocalInputs,
  managedComparisonPolicy,
  managedNativeEnvironment,
  managedNativeOverrides,
  observerScript,
  prepareDisposableNative,
  repositoryRoot,
  sha256File,
  taskScript,
} from "./launcherCore.mjs";

const args = process.argv.slice(2).filter((value) => value !== "--");
const openDashboard = !args.includes("--no-open");
const portIndex = args.indexOf("--port");
const launcherPort = portIndex >= 0 ? Number(args[portIndex + 1]) : 4317;
if (!Number.isSafeInteger(launcherPort) || launcherPort < 1 || launcherPort > 65535) {
  throw new Error("--port must be a valid TCP port");
}

const publicDirectory = path.join(import.meta.dirname, "public");
const launcherFreshness = createSourceFreshnessGuard([
  import.meta.filename,
  path.join(import.meta.dirname, "launcherCore.mjs"),
]);
const outputRoot = path.join(repositoryRoot, "output/fidelity-lab");
const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dib-fidelity-lab-"));
const discovered = discoverLocalInputs();
const inputs = new Map([
  ...discovered.archives.map((item) => [item.id, { ...item, kind: "archive" }]),
  ...discovered.saves.map((item) => [item.id, { ...item, kind: "save" }]),
]);
const sessions = new Map();
let activeSession;
let vite;
let viteUrl;

const json = (response, status, body, headers = {}) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(`${JSON.stringify(body)}\n`);
};

const staticFile = (response, file, type) => {
  if (!fs.existsSync(file)) return json(response, 404, { error: "Not found" });
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
};

const readJson = async (request, limit = 1_000_000) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error("Request is too large");
    chunks.push(chunk);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const writeUpload = async (request, kind) => {
  if (!['archive', 'save'].includes(kind)) throw new Error("Unknown upload kind");
  const label = decodeURIComponent(String(request.headers["x-file-name"] ?? `Uploaded ${kind}`));
  const suppliedExtension = path.extname(path.basename(label)).toLowerCase();
  const extension = kind === "archive" && [".ipa", ".zip"].includes(suppliedExtension)
    ? suppliedExtension
    : kind === "archive" ? ".ipa" : ".save";
  const id = `upload-${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const file = path.join(uploadRoot, `${id}${extension}`);
  const stream = fs.createWriteStream(file, { flags: "wx" });
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 512 * 1024 * 1024) throw new Error("Upload exceeds 512 MB");
      if (!stream.write(chunk)) await new Promise((resolve) => stream.once("drain", resolve));
    }
    await new Promise((resolve, reject) => stream.end((error) => error ? reject(error) : resolve()));
  } catch (error) {
    stream.destroy();
    if (fs.existsSync(file)) fs.unlinkSync(file);
    throw error;
  }
  const sha256 = sha256File(file);
  inputs.set(id, { id, kind, label, file, uploaded: true, sha256 });
  return { id, label, size, sha256 };
};

const availablePort = (start) => new Promise((resolve, reject) => {
  const tryPort = (port) => {
    const server = net.createServer();
    server.once("error", () => tryPort(port + 1));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(port)));
  };
  try { tryPort(start); } catch (error) { reject(error); }
});

const waitForUrl = async (url, timeoutMs = 60_000, child) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Process exited (${child.exitCode}) before ${url} became ready`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError ?? "not ready"}`);
};

async function ensureVite(sessionDirectory) {
  if (vite !== undefined && vite.exitCode === null) return viteUrl;
  const port = await availablePort(5189);
  viteUrl = `http://127.0.0.1:${port}`;
  const stdout = fs.openSync(path.join(sessionDirectory, "vite-stdout.txt"), "a");
  const stderr = fs.openSync(path.join(sessionDirectory, "vite-stderr.txt"), "a");
  const viteCli = path.join(repositoryRoot, "apps/web/node_modules/vite/bin/vite.js");
  vite = spawn(process.execPath, [viteCli, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
    cwd: path.join(repositoryRoot, "apps/web"),
    stdio: ["ignore", stdout, stderr],
    windowsHide: true,
  });
  await waitForUrl(viteUrl, 90_000);
  return viteUrl;
}

const publicSession = (session) => session === undefined ? undefined : ({
  id: session.id,
  workflow: session.workflow,
  waitForViewerSync: session.waitForViewerSync,
  portAudio: session.portAudio,
  state: session.state,
  message: session.message,
  dashboardUrl: session.dashboardUrl,
  error: session.error,
  task: session.task?.public,
  startedAt: session.startedAt,
});

async function stopSession(session) {
  if (session === undefined || session.state === "stopped") return;
  session.state = "stopping";
  for (const child of [session.worker, session.native]) {
    if (child === undefined || child.exitCode !== null) continue;
    child.kill();
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 4_000)),
    ]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  session.state = "stopped";
  session.message = "Session stopped; evidence was retained.";
  if (activeSession?.id === session.id) activeSession = undefined;
}

async function startSession(config) {
  launcherFreshness.assertCurrent();
  if (activeSession !== undefined && !["error", "stopped"].includes(activeSession.state)) {
    throw new Error("End the active comparison before starting another one");
  }
  if (!config.contentRights) throw new Error("Confirm your right to use the selected content");
  if (!["live", "task"].includes(config.workflow)) throw new Error("Choose a comparison workflow");
  if (config.waitForViewerSync !== undefined && typeof config.waitForViewerSync !== "boolean") {
    throw new Error("Viewer wait selection must be boolean");
  }
  if (config.portAudio !== undefined && typeof config.portAudio !== "boolean") {
    throw new Error("Web port audio selection must be boolean");
  }
  const waitForViewerSync = config.workflow === "live" && config.waitForViewerSync === true;
  const portAudio = config.workflow === "live" && config.portAudio !== false;
  const archive = inputs.get(config.archiveId);
  const save = inputs.get(config.saveId);
  if (archive?.kind !== "archive") throw new Error("Choose a compatible archive");
  if (save?.kind !== "save") throw new Error("Choose a native save");
  if (!discovered.nativePackageAvailable) throw new Error("The maintained TouchHLE package was not found");
  const task = config.workflow === "task" ? discovered.tasks.find(({ id }) => id === config.taskId) : undefined;
  if (config.workflow === "task" && task === undefined) throw new Error("Choose an automated task");
  if (task?.task.recommendedSaveSha256 !== undefined && save.sha256 !== task.task.recommendedSaveSha256) {
    throw new Error(`This task requires its matched save (${task.task.recommendedSaveSha256.slice(0, 12)}…). Choose the recommended save or upload those exact bytes.`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = `${stamp}-${config.workflow}`;
  const directory = path.join(outputRoot, "managed", id);
  fs.mkdirSync(directory, { recursive: true });
  const session = {
    id, workflow: config.workflow, waitForViewerSync, portAudio, state: "starting", message: "Preparing disposable TouchHLE…",
    startedAt: new Date().toISOString(), directory, task,
  };
  sessions.set(id, session);
  activeSession = session;

  void (async () => {
    try {
      const nativeDirectory = path.join(directory, "native");
      const native = prepareDisposableNative({
        source: defaultNativePackage,
        destination: nativeDirectory,
        archive: archive.file,
        save: save.file,
        script: config.workflow === "task" ? taskScript(task.task) : observerScript(),
      });
      const framebuffer = path.join(directory, "native-frames");
      fs.mkdirSync(framebuffer);
      const liveInput = path.join(directory, "touchhle-live-input.txt");
      const liveAck = path.join(directory, "touchhle-live-ack.txt");
      fs.writeFileSync(liveInput, "");
      fs.writeFileSync(liveAck, "");
      fs.writeFileSync(path.join(directory, "launcher-environment.json"), `${JSON.stringify({
        managedComparisonPolicy,
        launcherSourceFingerprint: launcherFreshness.expected,
        nativeOverrides: managedNativeOverrides,
        waitForViewerSync,
        portAudio,
      }, null, 2)}\n`);
      session.message = "Launching native reference and web port…";
      const nativeStdout = fs.openSync(path.join(nativeDirectory, "touchHLE-stdout.txt"), "a");
      const nativeStderr = fs.openSync(native.logFile, "a");
      session.native = spawn(native.executable, [native.archiveArgument], {
        cwd: nativeDirectory,
        stdio: ["ignore", nativeStdout, nativeStderr],
        env: managedNativeEnvironment(process.env, {
          scriptFile: native.scriptFile,
          framebuffer,
          liveInput,
          liveAck,
        }),
      });
      const webUrl = await ensureVite(directory);
      const workerPort = await availablePort(4320);
      const workerArgs = [
        path.join(import.meta.dirname, "index.mjs"),
        "--web-url", webUrl,
        "--native-pid", String(session.native.pid),
        "--native-log", native.logFile,
        "--native-capture-dir", framebuffer,
        "--prune-native-captures",
        "--native-input", config.workflow === "task" ? "scripted" : "harness",
        "--native-live-input", liveInput,
        "--native-live-ack", liveAck,
        "--archive", archive.file,
        "--save", save.file,
        "--accept-content-rights",
        "--port", String(workerPort),
        "--output", path.join(directory, "evidence"),
        "--launcher-url", `http://127.0.0.1:${launcherPort}`,
        "--session-id", id,
        "--managed-policy", managedComparisonPolicy,
        ...(waitForViewerSync ? ["--wait-for-viewer-sync"] : []),
        ...(portAudio ? [] : ["--mute-port-audio"]),
        ...(config.workflow === "task" ? ["--task", task.file, "--auto-run-task"] : []),
      ];
      const workerStdout = fs.openSync(path.join(directory, "worker-stdout.txt"), "a");
      const workerStderr = fs.openSync(path.join(directory, "worker-stderr.txt"), "a");
      session.worker = spawn(process.execPath, workerArgs, {
        cwd: repositoryRoot,
        stdio: ["ignore", workerStdout, workerStderr],
        windowsHide: true,
      });
      session.dashboardUrl = `http://127.0.0.1:${workerPort}`;
      await waitForUrl(session.dashboardUrl, 120_000, session.worker);
      session.state = "ready";
      session.message = config.workflow === "task"
        ? "Automated comparison is running. Review its progress and paired evidence."
        : waitForViewerSync
          ? "Live comparison is ready in Wait mode. Both panels advance after the matching native frame is ready."
          : "Live comparison is ready. Independent low-latency panels use either game surface for mirrored input.";
    } catch (error) {
      session.state = "error";
      session.error = String(error);
      session.message = "Setup failed; see the error below.";
      for (const child of [session.worker, session.native]) if (child?.exitCode === null) child.kill();
    }
  })();
  return session;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/") return staticFile(response, path.join(publicDirectory, "setup.html"), "text/html; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/setup.js") return staticFile(response, path.join(publicDirectory, "setup.js"), "text/javascript; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/dashboard.css") return staticFile(response, path.join(publicDirectory, "dashboard.css"), "text/css; charset=utf-8");
    if (request.method === "GET" && url.pathname === "/favicon.ico") { response.writeHead(204); return response.end(); }
    if (request.method === "GET" && url.pathname === "/api/setup") {
      return json(response, 200, {
        environment: {
          nativePackageAvailable: discovered.nativePackageAvailable,
          managedWebPort: true,
          launcherSourceCurrent: launcherFreshness.isCurrent(),
          launcherSourceFingerprint: launcherFreshness.expected,
        },
        archives: [...inputs.values()].filter(({ kind }) => kind === "archive").map(({ id, label, uploaded }) => ({ id, label, uploaded })),
        saves: [...inputs.values()].filter(({ kind }) => kind === "save").map(({ id, label, uploaded, sha256 }) => ({ id, label, uploaded, sha256 })),
        tasks: discovered.tasks.map(({ public: task }) => task),
        activeSession: publicSession(activeSession),
      });
    }
    const uploadMatch = url.pathname.match(/^\/api\/uploads\/(archive|save)$/);
    if (request.method === "POST" && uploadMatch) return json(response, 201, await writeUpload(request, uploadMatch[1]));
    if (request.method === "POST" && url.pathname === "/api/sessions") {
      const session = await startSession(await readJson(request));
      return json(response, 202, publicSession(session));
    }
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (request.method === "GET" && sessionMatch) {
      const session = sessions.get(decodeURIComponent(sessionMatch[1]));
      if (session === undefined) throw new Error("Unknown comparison session");
      return json(response, 200, publicSession(session), { "access-control-allow-origin": "*" });
    }
    const stopMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/stop$/);
    if (request.method === "POST" && stopMatch) {
      const session = sessions.get(decodeURIComponent(stopMatch[1]));
      if (session === undefined) throw new Error("Unknown comparison session");
      await stopSession(session);
      return json(response, 200, publicSession(session), { "access-control-allow-origin": "*" });
    }
    response.writeHead(404); response.end();
  } catch (error) {
    json(response, 400, { error: String(error) }, { "access-control-allow-origin": "*" });
  }
});

await new Promise((resolve) => server.listen(launcherPort, "127.0.0.1", resolve));
const launcherUrl = `http://127.0.0.1:${launcherPort}`;
console.log(`Fidelity Lab setup: ${launcherUrl}`);
if (openDashboard) spawn("cmd.exe", ["/c", "start", "", launcherUrl], { windowsHide: true, detached: true });

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await Promise.all([...sessions.values()].map(stopSession));
  if (vite?.exitCode === null) vite.kill();
  server.close();
  try { fs.rmSync(uploadRoot, { recursive: true, force: true }); } catch {}
}
process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
