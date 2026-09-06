import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadFidelityTask, publicTask } from "./task.mjs";

export const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
export const defaultNativePackage = path.join(repositoryRoot, "emulation/DragonIslandBlue-touchHLE-windows");

const existing = (file) => fs.existsSync(file) ? file : undefined;
export const sha256File = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// Increment whenever a managed comparison changes a cross-process determinism contract. The
// launcher is long-lived while each worker is loaded from disk afresh, so the worker must reject
// a launcher that predates the policy it expects instead of comparing differently configured
// runtimes.
export const managedComparisonPolicy = "rng-foundation-input-viewer-audio-v6";

export function assertManagedComparisonPolicy({ launcherUrl, sessionId, managedPolicy }) {
  if ((launcherUrl === undefined) !== (sessionId === undefined)) {
    throw new Error("--launcher-url and --session-id must be supplied together");
  }
  if (launcherUrl !== undefined && managedPolicy !== managedComparisonPolicy) {
    throw new Error(
      `Managed Fidelity Lab launcher policy is stale (expected ${managedComparisonPolicy}, got ${managedPolicy ?? "none"}); ` +
        "stop pnpm fidelity:lab, start it again, and create a new comparison",
    );
  }
  if (launcherUrl === undefined && managedPolicy !== undefined) {
    throw new Error("--managed-policy is only valid for a managed launcher session");
  }
}

export const managedNativeOverrides = Object.freeze({
  TOUCHHLE_CAPTURE_EVERY: "2",
  TOUCHHLE_TRACE_TOUCH: "1",
  TOUCHHLE_TRACE_RNG: "1",
  TOUCHHLE_FOUNDATION_DICTIONARY_ORDER: "lexicographic",
  ALSOFT_DRIVERS: "null",
});

export function managedNativeEnvironment(base, session) {
  return {
    ...base,
    ...managedNativeOverrides,
    TOUCHHLE_INPUT_SCRIPT: session.scriptFile,
    TOUCHHLE_CAPTURE_DIR: session.framebuffer,
    TOUCHHLE_LIVE_INPUT: session.liveInput,
    TOUCHHLE_LIVE_ACK: session.liveAck,
  };
}

export function sourceFingerprint(files) {
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(path.resolve(file));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** A launcher is intentionally long-lived, unlike its per-session web worker. Refuse to create a
 * new comparison after its own loaded modules change on disk; otherwise native can retain stale
 * environment policy while the freshly spawned web worker uses the new policy. */
export function createSourceFreshnessGuard(files) {
  const expected = sourceFingerprint(files);
  const current = () => sourceFingerprint(files);
  return Object.freeze({
    expected,
    isCurrent: () => current() === expected,
    assertCurrent: () => {
      if (current() !== expected) {
        throw new Error(
          "Fidelity Lab launcher source changed after this setup process started; " +
          "stop pnpm fidelity:lab, start it again, and then create a new comparison",
        );
      }
    },
  });
}

export function discoverLocalInputs(root = repositoryRoot, nativePackage = defaultNativePackage) {
  const archives = [
    ["repository-archive", "Repository archive", path.join(root, "Dragon_Island_Blue_1.1.0.ipa")],
    ["native-package-archive", "TouchHLE package archive", path.join(nativePackage, "touchHLE_apps/Dragon_Island_Blue_1.1.0.ipa")],
  ].filter(([, , file]) => existing(file)).map(([id, label, file]) => ({ id, label, file }));

  const documents = path.join(nativePackage, "touchHLE_sandbox/jp.ne.goo.game.dragonislandblue/Documents");
  const matchedSave = path.join(root, "working/non-authoritative-planning/dungeon-frame-lockstep-20260814/matched-savefile0");
  const saves = [
    ...(existing(matchedSave) ? [{
      id: "matched-fidelity-save",
      label: "Matched Fidelity Lab save (recommended)",
      file: matchedSave,
    }] : []),
    ...[0, 1, 2].map((slot) => ({
      id: `native-slot-${slot + 1}`,
      label: `TouchHLE save slot ${slot + 1}`,
      file: path.join(documents, `savefile${slot}`),
    })),
  ].filter(({ file }) => existing(file)).map((item) => ({ ...item, sha256: sha256File(item.file) }));

  const taskDirectory = path.join(root, "apps/fidelity-lab/tasks");
  const tasks = fs.existsSync(taskDirectory)
    ? fs.readdirSync(taskDirectory).filter((name) => name.endsWith(".json")).sort().map((name) => {
      const file = path.join(taskDirectory, name);
      const task = loadFidelityTask(file);
      return { id: task.id, file, task, public: publicTask(task) };
    })
    : [];

  return {
    nativePackage,
    nativePackageAvailable: fs.existsSync(path.join(nativePackage, "touchHLE.exe")),
    archives,
    saves,
    tasks,
  };
}

export function observerScript(durationMs = 60 * 60_000, intervalMs = 500) {
  const lines = ["# Fidelity Lab live observer: scene dumps only; dashboard supplies input."];
  for (let at = 0; at <= durationMs; at += intervalMs) lines.push(`DUMP ${at}`);
  return `${lines.join("\n")}\n`;
}

export function taskScript(task, intervalMs = 250) {
  const taps = task.steps.filter(({ kind }) => kind === "tap");
  for (const step of task.steps) {
    if (step.kind === "drag") throw new Error(`Automated native workflow does not support task drag ${step.id}`);
  }
  const latestTap = Math.max(0, ...taps.map(({ nativeAtMs }) => nativeAtMs ?? 0));
  const durationMs = Math.max(120_000, latestTap + 90_000);
  const lines = [`# Fidelity Lab automated task: ${task.id}`];
  for (const step of taps) {
    if (!Number.isSafeInteger(step.nativeAtMs)) throw new Error(`Task tap ${step.id} requires nativeAtMs`);
    lines.push(`TAP ${step.nativeAtMs} ${Math.round(step.x * 960)} ${Math.round(step.y * 640)}`);
  }
  for (let at = 0; at <= durationMs; at += intervalMs) lines.push(`DUMP ${at}`);
  return `${lines.join("\n")}\n`;
}

export function prepareDisposableNative({ source, destination, archive, save, script }) {
  if (fs.existsSync(destination)) throw new Error(`Disposable native directory already exists: ${destination}`);
  fs.mkdirSync(destination, { recursive: true });
  for (const name of ["touchHLE.exe", "touchHLE_default_options.txt", "COPYING.txt"]) {
    const input = path.join(source, name);
    if (fs.existsSync(input)) fs.copyFileSync(input, path.join(destination, name));
  }
  for (const name of ["touchHLE_dylibs", "touchHLE_fonts", "touchHLE_sandbox"]) {
    const input = path.join(source, name);
    if (!fs.existsSync(input)) throw new Error(`Native package is missing ${name}`);
    fs.cpSync(input, path.join(destination, name), { recursive: true, errorOnExist: true });
  }
  const apps = path.join(destination, "touchHLE_apps");
  fs.mkdirSync(apps);
  const archiveName = path.basename(archive);
  fs.copyFileSync(archive, path.join(apps, archiveName));

  const documents = path.join(destination, "touchHLE_sandbox/jp.ne.goo.game.dragonislandblue/Documents");
  fs.mkdirSync(documents, { recursive: true });
  for (const slot of [1, 2]) {
    for (const suffix of ["", ".bak"]) {
      const staleSlot = path.join(documents, `savefile${slot}${suffix}`);
      if (fs.existsSync(staleSlot)) fs.rmSync(staleSlot);
    }
  }
  fs.copyFileSync(save, path.join(documents, "savefile0"));
  fs.copyFileSync(save, path.join(documents, "savefile0.bak"));
  const scriptFile = path.join(destination, "fidelity-input.txt");
  fs.writeFileSync(scriptFile, script);
  return {
    executable: path.join(destination, "touchHLE.exe"),
    archiveArgument: path.join("touchHLE_apps", archiveName),
    scriptFile,
    logFile: path.join(destination, "touchHLE-stderr.txt"),
  };
}
