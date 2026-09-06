import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import {
  NativeFramebufferStream,
  NativeWindowStream,
  PortCanvasWebRtc,
  PortScreencast,
} from "./liveStreams.mjs";
import { LiveTouchBridge } from "./liveTouchBridge.mjs";
import { pruneNativeCaptures, refreshNativeCapture } from "./nativeCapture.mjs";
import { HELP, parseOptions } from "./options.mjs";
import { assertManagedComparisonPolicy } from "./launcherCore.mjs";
import {
  preferSceneRngPosition,
  readLatestSceneDump,
  readRecentRngDraws,
} from "./nativeSceneLog.mjs";
import { DungeonTopologyTracker } from "./dungeonTopology.mjs";
import { inputEvent, inputGesture, LabSession, targetPoint } from "./session.mjs";
import { evaluateStateRules, loadStateRules } from "./stateRules.mjs";
import { evaluateTaskExpectations, loadFidelityTask, publicTask } from "./task.mjs";
import { controlledPortBrowserLaunchOptions, DEFAULT_PORT_AUDIO_LEVELS } from "./portAudio.mjs";

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  console.log(HELP);
  process.exit(0);
}
assertManagedComparisonPolicy(options);
if (!["harness", "win32", "scripted"].includes(options.nativeInput)) {
  throw new Error("--native-input must be harness, win32, or scripted");
}
if (options.nativeInput === "harness" && (options.nativeLiveInput === undefined || options.nativeLiveAck === undefined)) {
  throw new Error("--native-input harness requires --native-live-input and --native-live-ack");
}
if (options.waitForViewerSync && options.nativeCaptureDir === undefined) {
  throw new Error("--wait-for-viewer-sync requires --native-capture-dir");
}
if (!["iphone", "ipad"].includes(options.portDisplayMode)) {
  throw new Error("--display-mode must be iphone or ipad");
}
if (!["original", "modern"].includes(options.portTextMode)) {
  throw new Error("--text-mode must be original or modern");
}

fs.mkdirSync(options.outputRoot, { recursive: true });
const liveDirectory = path.join(options.outputRoot, ".live");
fs.mkdirSync(liveDirectory, { recursive: true });
const nativeFrame = path.join(liveDirectory, "native.png");
const portFrame = path.join(liveDirectory, "port.png");
const publicDirectory = path.join(import.meta.dirname, "public");
const session = new LabSession(options.outputRoot);
const stateRules = loadStateRules(options.rules);
const fidelityTask = loadFidelityTask(options.task);
if (options.archive !== undefined && !options.acceptContentRights) {
  throw new Error("--archive requires --accept-content-rights");
}
if (options.nativeSave !== undefined && options.archive === undefined) {
  throw new Error("--save requires --archive so the port content gate can import it");
}
for (const file of [options.archive, options.nativeSave, options.rules, options.task].filter(Boolean)) {
  if (!fs.existsSync(file)) throw new Error(`Missing Fidelity Lab input: ${file}`);
}

class PowerShellBridge {
  constructor(script) {
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.process = spawn("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process.stdout.setEncoding("utf8");
    this.process.stdout.on("data", (chunk) => this.consume(chunk));
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => { process.stderr.write(`[native bridge] ${chunk}`); });
    this.process.once("exit", (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`Native bridge exited (${code})`));
      this.pending.clear();
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length === 0) continue;
      let response;
      try { response = JSON.parse(line); } catch { continue; }
      const request = this.pending.get(response.id);
      if (request === undefined) continue;
      this.pending.delete(response.id);
      if (response.ok) request.resolve(response.result);
      else request.reject(new Error(response.error));
    }
  }

  call(command) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  }

  async close() {
    try { await this.call({ command: "quit" }); } catch {}
  }
}

const native = new PowerShellBridge(path.join(import.meta.dirname, "win32-bridge.ps1"));
const liveTouch = options.nativeInput === "harness"
  ? new LiveTouchBridge(options.nativeLiveInput, options.nativeLiveAck)
  : undefined;
let nativeStatus = { connected: false, error: undefined, bounds: undefined };
try {
  const result = await native.call({
    command: "locate",
    pid: options.nativePid ?? 0,
    title: options.nativeTitle,
  });
  nativeStatus = { connected: true, bounds: result.bounds };
} catch (error) {
  nativeStatus = { connected: false, error: String(error) };
}

const browser = await chromium.launch({
  executablePath: options.edgePath,
  headless: !options.headedPort,
  ...controlledPortBrowserLaunchOptions({ muteAudio: options.mutePortAudio }),
});
const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
const page = await context.newPage();
await page.addInitScript(({ initialState, skip, displayMode, textResolutionMode, audioLevels }) => {
  localStorage.setItem("dib.portSettings.v1", JSON.stringify({
    displayMode,
    textResolutionMode,
    ...audioLevels,
  }));
  window.__DIB_FIDELITY_LAB__ = {
    rng: { kind: "touchhle-xorshift32", initialState, skip },
    foundationDictionaryOrder: "lexicographic",
  };
  const inputDelivery = { serial: 0, events: [] };
  window.__DIB_FIDELITY_INPUT_DELIVERY__ = inputDelivery;
  for (const type of ["pointerdown", "pointermove", "pointerup"]) {
    window.addEventListener(type, (event) => {
      inputDelivery.events.push({
        serial: ++inputDelivery.serial,
        phase: type.slice("pointer".length),
        registeredAt: Date.now(),
        x: event.clientX,
        y: event.clientY,
      });
      if (inputDelivery.events.length > 100) inputDelivery.events.shift();
    }, { capture: true });
  }
}, {
  initialState: fidelityTask?.rng?.initialState ?? options.rngState,
  skip: fidelityTask?.rng?.skip ?? options.rngSkip,
  displayMode: options.portDisplayMode,
  textResolutionMode: options.portTextMode,
  audioLevels: DEFAULT_PORT_AUDIO_LEVELS,
});
// Port failures are evidence, not lab noise. The dashboard's panel keeps only the last 20 entries
// and nothing survived the session, so the stack trace that explains a comparison — and a renderer
// that crashes or stops answering, which is otherwise indistinguishable from a game that simply
// stopped animating — is mirrored to a session file as well.
const browserErrors = [];
const portErrorLog = path.join(options.outputRoot, "port-errors.log");
const recordPortError = (message) => {
  const entry = `${new Date().toISOString()} ${message}`;
  browserErrors.push(entry);
  try { fs.appendFileSync(portErrorLog, `${entry}\n`); } catch {}
};
page.on("pageerror", (error) => recordPortError(`pageerror: ${String(error)}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("favicon")) {
    recordPortError(`console: ${message.text()}`);
  }
});
page.on("crash", () => recordPortError("port renderer process crashed (Chromium target crash)"));
page.on("close", () => recordPortError("port page closed"));
await page.goto(options.webUrl, { waitUntil: "domcontentloaded" });
if (options.archive !== undefined) {
  await page.locator('input[name="asset-archive"]').setInputFiles(options.archive);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ timeout: 120_000 });
  if (options.nativeSave !== undefined) {
    await page.getByRole("button", { name: "Offline settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Offline settings" });
    await dialog.getByText("Offline save slots").waitFor();
    page.once("dialog", async (prompt) => { await prompt.accept("1"); });
    await dialog.locator('input[type="file"]').setInputFiles(options.nativeSave);
    await dialog.getByText(/Imported the save into slot-1\./).waitFor({ timeout: 30_000 });
    await dialog.getByRole("button", { name: "Close save settings" }).click();
  }
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
}

const cdp = await context.newCDPSession(page);
const synchronizeViewer = options.waitForViewerSync;
const portScreencast = new PortScreencast(cdp, { synchronized: synchronizeViewer });
const portCanvasWebRtc = new PortCanvasWebRtc(page);
let portViewerTransport = synchronizeViewer ? "cdp-screencast" : "canvas-webrtc";
const nativeLiveStream = options.nativeCaptureDir === undefined
  ? new NativeWindowStream({ ffmpegPath: options.ffmpegPath })
  : new NativeFramebufferStream({
      directory: options.nativeCaptureDir,
      ffmpegPath: options.ffmpegPath,
      onFrame: ({ capturedAt }) => portScreencast.releaseNearest(capturedAt),
    });
if (synchronizeViewer) await portScreencast.start();

let captureInFlight = false;
let capturePaused = false;
let lastCaptureAt = 0;
let portStatus = { connected: true, error: undefined, bounds: undefined, state: undefined };
let nativeClock = { originEpochMs: undefined, latestNativeMs: undefined, samples: 0 };
let inputSync = { mode: options.nativeInput, state: "idle" };
let nativeRngPosition;
let lastRngAnchor;
const dungeonTopology = new DungeonTopologyTracker();

const readNativeScene = () => {
  const scene = readLatestSceneDump(options.nativeLog);
  // An ACK carries the stream sample captured when the due phase was dequeued, before the guest
  // handled it, even though the ACK itself is written after UIKit dispatch returns. Keep that
  // pre-input position only until a later complete HSCENE proves guest work advanced the stream;
  // otherwise every post-input RNG comparison remains pinned to stale registration metadata.
  nativeRngPosition = preferSceneRngPosition(scene?.rng, nativeRngPosition);
  if (scene !== undefined && scene.nativeMs !== nativeClock.latestNativeMs) {
    const candidateOrigin = Date.now() - scene.nativeMs;
    nativeClock = {
      originEpochMs: nativeClock.originEpochMs === undefined
        ? candidateOrigin
        : Math.min(nativeClock.originEpochMs, candidateOrigin),
      latestNativeMs: scene.nativeMs,
      samples: nativeClock.samples + 1,
    };
  }
  return scene;
};

const capture = async () => {
  if (captureInFlight || capturePaused) return;
  captureInFlight = true;
  try {
    if (!nativeStatus.connected) {
      try {
        const result = await native.call({
          command: "locate",
          pid: options.nativePid ?? 0,
          title: options.nativeTitle,
        });
        nativeStatus = { connected: true, bounds: result.bounds };
      } catch (error) {
        nativeStatus = { connected: false, error: String(error) };
      }
    }
    if (nativeStatus.connected) {
      try {
        if (options.nativeCaptureDir !== undefined) {
          const result = await refreshNativeCapture(options.nativeCaptureDir, nativeFrame);
          nativeStatus = {
            connected: true,
            bounds: nativeStatus.bounds,
            captureMode: "framebuffer",
            captureSource: result.source,
          };
        } else {
          const result = await native.call({ command: "capture", path: nativeFrame });
          nativeStatus = {
            connected: true,
            bounds: result.bounds,
            captureMode: "desktop",
          };
        }
      } catch (error) {
        nativeStatus = { connected: false, error: String(error) };
      }
    }

    try {
      const canvas = page.locator("canvas").first();
      const bounds = await canvas.boundingBox();
      if (bounds === null) {
        await page.screenshot({ path: portFrame, type: "png", timeout: 10_000 });
      } else {
        await canvas.screenshot({ path: portFrame, type: "png", timeout: 10_000 });
      }
      const state = await page.evaluate(() => typeof window.render_game_to_text === "function"
        ? JSON.parse(window.render_game_to_text())
        : undefined);
      portStatus = {
        connected: true,
        bounds: bounds ?? { x: 0, y: 0, width: 960, height: 640 },
        state,
        surface: bounds === null ? "page" : "canvas",
      };
    } catch (error) {
      // Do NOT carry the last successful `state` forward. The dashboard prefers a present state
      // over an error string, so retaining it published a stale snapshot as if it were live and
      // hid every port capture failure behind the last frame the port managed to answer for.
      if (portStatus.connected) recordPortError(`port capture failed: ${String(error)}`);
      portStatus = {
        connected: false,
        error: String(error),
        bounds: portStatus.bounds,
        surface: portStatus.surface,
        lastState: portStatus.state ?? portStatus.lastState,
      };
    }
    lastCaptureAt = Date.now();
    session.capture(nativeFrame, portFrame);
  } finally {
    captureInFlight = false;
  }
};
const captureTimer = setInterval(() => void capture(), Math.round(1_000 / options.captureFps));
void capture();

// Pruning runs on its own cadence rather than inside `capture()`. The harness writes ~27 frames a
// second at 1.8 MB each, and `capture()` is suspended for the whole of a mirrored gesture, so tying
// collection to it let a gigabyte of pending frames accumulate during a single slow gesture.
let pruneInFlight = false;
const pruneTimer = options.pruneNativeCaptures && options.nativeCaptureDir !== undefined
  ? setInterval(() => {
    if (pruneInFlight) return;
    pruneInFlight = true;
    void pruneNativeCaptures(options.nativeCaptureDir)
      .catch(() => undefined)
      .finally(() => { pruneInFlight = false; });
  }, 500)
  : undefined;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const INPUT_DISPATCH_LEAD_MS = 64;

// Timer-only. The former sub-millisecond spin blocked the event loop once per phase, which stalled
// both live viewer streams; deadlines are whole milliseconds and the runtimes poll per frame, so
// there is nothing below a millisecond left to resolve.
const waitUntilEpoch = async (targetEpochMs) => {
  for (;;) {
    const remaining = targetEpochMs - Date.now();
    if (remaining <= 0) return;
    await sleep(remaining);
  }
};

const currentSnapshot = () => {
  const nativeScene = readNativeScene();
  const dungeonTopologyComparison = dungeonTopology.observe(nativeScene, portStatus.state);
  const portRng = portStatus.state?.fidelityLab?.rng;
  const rngSync = nativeRngPosition === undefined && portRng === undefined
    ? undefined
    : {
        native: nativeRngPosition,
        port: portRng === undefined ? undefined : {
          rawState: portRng.rawState,
          calls: portRng.cursor,
          anchors: portRng.anchors,
        },
        drift: nativeRngPosition === undefined || !Number.isSafeInteger(portRng?.cursor)
          ? undefined
          : portRng.cursor - nativeRngPosition.calls,
        stateMatches: nativeRngPosition === undefined || !Number.isSafeInteger(portRng?.rawState)
          ? undefined
          : portRng.rawState === nativeRngPosition.rawState,
        lastAnchor: lastRngAnchor,
      };
  return {
    native: {
      ...nativeStatus,
      scene: nativeScene,
      rngTrace: readRecentRngDraws(options.nativeLog),
      frameReady: fs.existsSync(nativeFrame),
    },
    port: { ...portStatus, frameReady: fs.existsSync(portFrame) },
    browserErrors: browserErrors.slice(-20),
    stateDifferences: evaluateStateRules(stateRules, nativeScene, portStatus.state),
    rngSync,
    dungeonTopology: dungeonTopologyComparison,
  };
};

async function preparePortInput(event) {
  if (portStatus.bounds === undefined) return undefined;
  const point = targetPoint(event, portStatus.bounds);
  const beforeSerial = await page.evaluate(() => window.__DIB_FIDELITY_INPUT_DELIVERY__?.serial ?? 0);
  return async (targetEpochMs) => {
    await waitUntilEpoch(targetEpochMs);
    await cdp.send("Input.dispatchMouseEvent", {
      type: ({ down: "mousePressed", move: "mouseMoved", up: "mouseReleased" })[event.phase],
      x: point.x,
      y: point.y,
      button: event.phase === "move" ? "none" : "left",
      buttons: event.phase === "up" ? 0 : 1,
      clickCount: event.phase === "move" ? 0 : 1,
      pointerType: "mouse",
    });
    const delivery = await page.evaluate(({ serial, phase }) => {
      const events = window.__DIB_FIDELITY_INPUT_DELIVERY__?.events ?? [];
      for (let index = events.length - 1; index >= 0; index--) {
        if (events[index].serial > serial && events[index].phase === phase) return events[index];
      }
      return undefined;
    }, { serial: beforeSerial, phase: event.phase });
    if (delivery === undefined) throw new Error(`Chromium did not deliver mirrored ${event.phase} input`);
    return delivery.registeredAt;
  };
}

async function dispatchPortInput(event, targetEpochMs) {
  const deliver = await preparePortInput(event);
  return deliver?.(targetEpochMs);
}

async function dispatchNativeInput(event, targetEpochMs, focus) {
  if (options.nativeInput === "harness") {
    await liveTouch.ready();
    return liveTouch.input(event, targetEpochMs);
  }
  if (!nativeStatus.connected || options.nativeInput !== "win32") return undefined;
  const result = await native.call({
    command: "input",
    ...event,
    focus,
    targetEpochMs,
  });
  return { registeredAt: result.deliveredAt ?? Date.now() };
}

async function dispatchInput(
  raw,
  record = true,
  diagnostics,
  targetEpochMs = Date.now() + INPUT_DISPATCH_LEAD_MS,
  nativePrepared = false,
) {
  const event = inputEvent(raw);
  const deliverPort = await preparePortInput(event);
  // The port marker and trusted CDP payload are prepared before the deadline.
  // TouchHLE then supplies the registration barrier after UIKit has synchronously dispatched the
  // phase to the guest, avoiding any prediction of which native poll will merely queue it.
  //
  // A native phase that is rejected or never acknowledged must not take the port phase down with
  // it: aborting here left the port holding a press that its matching release never arrived for,
  // which is a worse comparison state than a reported one-sided phase.
  let nativeDelivery;
  let nativeAt;
  let nativeError;
  try {
    nativeDelivery = await dispatchNativeInput(event, targetEpochMs, !nativePrepared);
    nativeAt = nativeDelivery?.registeredAt;
  } catch (error) {
    nativeError = String(error);
  }
  if (nativeDelivery?.rawState !== undefined && nativeDelivery.calls !== undefined) {
    nativeRngPosition = {
      rawState: nativeDelivery.rawState,
      calls: nativeDelivery.calls,
      source: "ack",
    };
    // The acknowledgement is the one synchronization barrier where both runtimes are about to
    // process the same phase. Anchor after TouchHLE accepts it and before Chromium receives it;
    // the optional hook keeps an unpatched/older port usable while the 3-field ACK remains valid.
    const portBeforeAnchor = await page.evaluate(({ rawState, calls }) => {
      return window.__DIB_FIDELITY_LAB_ANCHOR__?.(rawState, calls);
    }, { rawState: nativeDelivery.rawState, calls: nativeDelivery.calls });
    lastRngAnchor = {
      native: { rawState: nativeDelivery.rawState, calls: nativeDelivery.calls },
      ...(portBeforeAnchor === undefined ? {} : { portBefore: portBeforeAnchor }),
      observedAt: Date.now(),
    };
  }
  const portAt = await deliverPort?.(nativeAt ?? targetEpochMs);
  const phase = {
    phase: event.phase,
    targetEpochMs,
    portRegisteredAt: portAt,
    nativeRegisteredAt: nativeAt,
    // Retained for compatibility with existing recordings and local analysis scripts.
    portAt,
    nativeAt,
    nativeError,
    portLatenessMs: portAt === undefined ? undefined : portAt - targetEpochMs,
    nativeLatenessMs: nativeAt === undefined ? undefined : nativeAt - targetEpochMs,
    skewMs: portAt === undefined || nativeAt === undefined ? undefined : nativeAt - portAt,
  };
  if (record) {
    session.append("input", {
      ...event,
      delivery: phase,
      ...(nativeDelivery?.rawState === undefined || nativeDelivery.calls === undefined
        ? {}
        : {
            nativeRng: {
              rawState: nativeDelivery.rawState,
              calls: nativeDelivery.calls,
            },
          }),
      ...(lastRngAnchor === undefined ? {} : { rngAnchor: lastRngAnchor }),
    });
  }
  if (diagnostics !== undefined) diagnostics.push(phase);
  if (nativeError !== undefined) session.append("input-error", { phase: event.phase, error: nativeError });
  return phase;
}

let replaying = false;
let inputQueue = Promise.resolve();
const enqueueInput = (event, record = true, targetEpochMs, nativePrepared = false) => {
  const next = inputQueue.catch(() => undefined)
    .then(() => dispatchInput(event, record, undefined, targetEpochMs, nativePrepared));
  inputQueue = next;
  return next;
};

const enqueueGesture = (rawGesture) => {
  const gesture = inputGesture(rawGesture);
  const next = inputQueue.catch(() => undefined).then(async () => {
    const phases = [];
    capturePaused = true;
    while (captureInFlight) await sleep(5);
    let preparationMs;
    let nativeInputSession = false;
    let restoration;
    let gestureError;
    let recovered = false;
    try {
      const prepareStartedAt = Date.now();
      inputSync = { mode: "live", state: "preparing", id: gesture.id, phaseCount: gesture.events.length };
      if (nativeStatus.connected && options.nativeInput === "win32") {
        nativeInputSession = true;
        await native.call({ command: "begin-input" });
      }
      preparationMs = Date.now() - prepareStartedAt;
      inputSync = { mode: "live", state: "replaying", id: gesture.id, phaseCount: gesture.events.length, preparationMs };
      const replayStartedAt = Date.now() + INPUT_DISPATCH_LEAD_MS;
      let lastEvent;
      try {
        for (const event of gesture.events) {
          lastEvent = event;
          await dispatchInput(event, true, phases, replayStartedAt + event.tMs, true);
        }
      } catch (error) {
        gestureError = String(error);
      }
      // Whatever went wrong above, neither runtime may be left holding the press. The release is
      // dispatched immediately rather than on a replay deadline; the gesture is already abandoned,
      // and its timing is no longer comparable evidence.
      if (phases.at(-1)?.phase !== "up") {
        const releaseAt = lastEvent ?? gesture.events.at(-1);
        try {
          await dispatchInput({ phase: "up", x: releaseAt.x, y: releaseAt.y }, true, phases, Date.now(), true);
          recovered = true;
        } catch (error) {
          gestureError = `${gestureError ?? "gesture aborted"}; release failed: ${String(error)}`;
        }
      }
      if (nativeInputSession) await sleep(50);
    } finally {
      try {
        if (nativeInputSession) restoration = await native.call({ command: "end-input" });
      } finally {
        capturePaused = false;
        void capture();
      }
    }
    const skews = phases.map(({ skewMs }) => skewMs).filter(Number.isFinite);
    const nativeErrors = phases.filter(({ nativeError }) => nativeError !== undefined);
    inputSync = {
      mode: "live",
      state: nativeErrors.length > 0 || gestureError !== undefined ? "degraded" : "synced",
      id: gesture.id,
      phaseCount: phases.length,
      durationMs: gesture.events.at(-1).tMs,
      preparationMs,
      restorationDelayMs: nativeInputSession ? 50 : 0,
      cursorRestored: restoration?.cursorRestored,
      focusRestored: restoration?.focusRestored,
      maxSkewMs: skews.length === 0 ? undefined : Math.max(...skews.map(Math.abs)),
      // A one-sided phase is a real fidelity result, not a lab detail to swallow: the dashboard
      // reports it instead of the comparison quietly drifting apart.
      droppedNativePhases: nativeErrors.length === 0 ? undefined : nativeErrors.length,
      recoveredRelease: recovered ? true : undefined,
      error: gestureError,
      phases,
      completedAt: new Date().toISOString(),
    };
  });
  inputQueue = next;
  return next;
};
async function replayMacro() {
  if (replaying) throw new Error("A macro replay is already active");
  const macro = session.macro();
  if (macro.length === 0) throw new Error("No recorded macro is available");
  replaying = true;
  let nativeInputSession = false;
  try {
    if (nativeStatus.connected && options.nativeInput === "win32") {
      nativeInputSession = true;
      await native.call({ command: "begin-input" });
    }
    const replayStartedAt = Date.now() + INPUT_DISPATCH_LEAD_MS;
    for (const event of macro) {
      await enqueueInput(event, false, replayStartedAt + event.tMs, true);
    }
    if (nativeInputSession) await sleep(50);
  } finally {
    try {
      if (nativeInputSession) await native.call({ command: "end-input" });
    } finally {
      replaying = false;
    }
  }
}

const taskRunsDirectory = path.join(options.outputRoot, "task-runs");
let taskRuntime = {
  running: false,
  currentStep: undefined,
  lastResult: undefined,
};
let lastManualCheckpoint;

const taskStamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

function publicTaskRuntime() {
  return {
    loaded: publicTask(fidelityTask),
    running: taskRuntime.running,
    currentStep: taskRuntime.currentStep,
    lastResult: taskRuntime.lastResult,
  };
}

function publicEvidence() {
  const taskEvidence = (taskRuntime.lastResult?.steps ?? [])
    .filter(({ kind, directory }) => kind === "checkpoint" && directory !== undefined)
    .map(({ id, directory, evaluation }) => ({
      id,
      label: id.replaceAll("-", " "),
      kind: "task",
      pass: evaluation?.pass,
      nativeUrl: `/api/evidence/task/${encodeURIComponent(id)}/native`,
      portUrl: `/api/evidence/task/${encodeURIComponent(id)}/port`,
      directory,
    }));
  return {
    task: taskEvidence,
    manual: lastManualCheckpoint === undefined ? undefined : {
      label: "Latest manual checkpoint",
      nativeUrl: "/api/evidence/manual/latest/native",
      portUrl: "/api/evidence/manual/latest/port",
      directory: lastManualCheckpoint,
    },
  };
}

async function waitForTaskStep(step) {
  const startedAt = performance.now();
  let stableSamples = 0;
  let latest;
  while (performance.now() - startedAt <= step.timeoutMs) {
    latest = evaluateTaskExpectations(step.until, currentSnapshot());
    stableSamples = latest.pass ? stableSamples + 1 : 0;
    if (stableSamples >= step.stableSamples) {
      return { ...latest, elapsedMs: performance.now() - startedAt, stableSamples };
    }
    await sleep(step.pollMs);
  }
  return { ...latest, pass: false, elapsedMs: performance.now() - startedAt, stableSamples };
}

async function waitForNativeDeadline(nativeMs, stepId, phase) {
  while (nativeClock.originEpochMs === undefined) {
    readNativeScene();
    await sleep(20);
  }
  let targetEpochMs;
  let remaining;
  do {
    readNativeScene();
    targetEpochMs = nativeClock.originEpochMs + nativeMs;
    remaining = targetEpochMs - Date.now();
    inputSync = { mode: "scripted", state: "waiting", stepId, phase, nativeMs, targetEpochMs };
    if (remaining > 5) await sleep(Math.min(20, remaining));
  } while (remaining > 5);
  if (remaining < -250) {
    throw new Error(`Task input ${stepId}/${phase} missed the shared native deadline by ${Math.abs(Math.round(remaining))}ms`);
  }
  if (remaining > 0) await sleep(remaining);
  return targetEpochMs;
}

async function dispatchScriptedPortTap(step) {
  if (!Number.isFinite(step.nativeAtMs)) throw new Error(`Task tap ${step.id} has no nativeAtMs`);
  const phases = [];
  capturePaused = true;
  while (captureInFlight) await sleep(5);
  try {
    for (const [phase, offsetMs] of [["down", 0], ["up", 120]]) {
      const targetEpochMs = await waitForNativeDeadline(step.nativeAtMs + offsetMs, step.id, phase);
      const event = inputEvent({ phase, x: step.x, y: step.y });
      const portAt = await dispatchPortInput(event, targetEpochMs);
      phases.push({
        phase,
        nativeScheduledAt: targetEpochMs,
        portAt,
        skewMs: portAt === undefined ? undefined : portAt - targetEpochMs,
      });
    }
  } finally {
    capturePaused = false;
    void capture();
  }
  const skews = phases.map(({ skewMs }) => skewMs).filter(Number.isFinite);
  inputSync = {
    mode: "scripted",
    state: "synced",
    stepId: step.id,
    phaseCount: phases.length,
    maxSkewMs: skews.length === 0 ? undefined : Math.max(...skews.map(Math.abs)),
    phases,
    completedAt: new Date().toISOString(),
  };
  return inputSync;
}

async function saveTaskCheckpoint(runDirectory, step, evaluation) {
  while (captureInFlight) await sleep(20);
  await capture();
  const directory = path.join(runDirectory, step.id);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(nativeFrame)) fs.copyFileSync(nativeFrame, path.join(directory, "native.png"));
  if (fs.existsSync(portFrame)) fs.copyFileSync(portFrame, path.join(directory, "port.png"));
  writeJson(path.join(directory, "state.json"), {
    taskId: fidelityTask.id,
    stepId: step.id,
    label: step.label,
    note: step.note,
    evaluation,
    snapshot: currentSnapshot(),
  });
  return directory;
}

async function executeLoadedTask() {
  if (fidelityTask === undefined) throw new Error("No Fidelity Lab task was loaded with --task");
  if (taskRuntime.running) throw new Error("A Fidelity Lab task is already running");
  const runId = `${taskStamp()}-${fidelityTask.id}`;
  const runDirectory = path.join(taskRunsDirectory, runId);
  fs.mkdirSync(runDirectory, { recursive: true });
  const result = {
    schemaVersion: 1,
    taskId: fidelityTask.id,
    title: fidelityTask.title,
    runId,
    startedAt: new Date().toISOString(),
    status: "running",
    runDirectory,
    steps: [],
  };
  writeJson(path.join(runDirectory, "task.json"), publicTask(fidelityTask));
  taskRuntime = { running: true, currentStep: undefined, lastResult: taskRuntime.lastResult };
  try {
    for (const step of fidelityTask.steps) {
      taskRuntime.currentStep = { id: step.id, kind: step.kind, note: step.note };
      const stepResult = { id: step.id, kind: step.kind, startedAt: new Date().toISOString() };
      if (step.kind === "wait") {
        stepResult.evaluation = await waitForTaskStep(step);
        if (!stepResult.evaluation.pass) throw Object.assign(new Error(`Task wait ${step.id} timed out`), { stepResult });
      } else if (step.kind === "tap") {
        const synchronization = options.nativeInput === "scripted"
          ? await dispatchScriptedPortTap(step)
          : undefined;
        if (options.nativeInput !== "scripted") {
          await enqueueInput({ phase: "down", x: step.x, y: step.y }, false);
          await sleep(step.holdMs);
          await enqueueInput({ phase: "up", x: step.x, y: step.y }, false);
        }
        await sleep(step.settleMs);
        stepResult.input = {
          x: step.x,
          y: step.y,
          holdMs: options.nativeInput === "scripted" ? 120 : step.holdMs,
          settleMs: step.settleMs,
          synchronization,
        };
      } else if (step.kind === "drag") {
        const interval = step.durationMs / (step.points.length - 1);
        await enqueueInput({ phase: "down", ...step.points[0] }, false);
        for (const point of step.points.slice(1, -1)) {
          await sleep(interval);
          await enqueueInput({ phase: "move", ...point }, false);
        }
        await sleep(interval);
        await enqueueInput({ phase: "up", ...step.points.at(-1) }, false);
        await sleep(step.settleMs);
        stepResult.input = { points: step.points, durationMs: step.durationMs, settleMs: step.settleMs };
      } else if (step.kind === "checkpoint") {
        stepResult.evaluation = evaluateTaskExpectations(step.expectations, currentSnapshot());
        stepResult.directory = await saveTaskCheckpoint(runDirectory, step, stepResult.evaluation);
        if (!stepResult.evaluation.pass) {
          throw Object.assign(new Error(`Task checkpoint ${step.id} failed`), { stepResult });
        }
      }
      stepResult.finishedAt = new Date().toISOString();
      result.steps.push(stepResult);
      writeJson(path.join(runDirectory, "result.json"), result);
    }
    result.status = "passed";
  } catch (error) {
    if (error.stepResult !== undefined && !result.steps.some(({ id }) => id === error.stepResult.id)) {
      error.stepResult.finishedAt = new Date().toISOString();
      result.steps.push(error.stepResult);
    }
    result.status = "failed";
    result.error = String(error);
  } finally {
    result.finishedAt = new Date().toISOString();
    result.finalSnapshot = currentSnapshot();
    writeJson(path.join(runDirectory, "result.json"), result);
    taskRuntime = { running: false, currentStep: undefined, lastResult: result };
  }
}

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(`${JSON.stringify(body)}\n`);
};
const readBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Request body exceeds 1 MB");
    chunks.push(chunk);
  }
  return chunks.length === 0 ? {} : JSON.parse(Buffer.concat(chunks).toString("utf8"));
};
const staticFile = (response, file, type) => {
  if (!fs.existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  fs.createReadStream(file).pipe(response);
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/") {
      return staticFile(response, path.join(publicDirectory, "index.html"), "text/html; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/dashboard.js") {
      return staticFile(response, path.join(publicDirectory, "dashboard.js"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/inputGate.mjs") {
      return staticFile(response, path.join(publicDirectory, "inputGate.mjs"), "text/javascript; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/dashboard.css") {
      return staticFile(response, path.join(publicDirectory, "dashboard.css"), "text/css; charset=utf-8");
    }
    if (request.method === "GET" && url.pathname === "/favicon.ico") {
      response.writeHead(204, { "cache-control": "no-store" });
      return response.end();
    }
    if (request.method === "GET" && url.pathname === "/api/frame/native") {
      return staticFile(response, nativeFrame, "image/png");
    }
    if (request.method === "GET" && url.pathname === "/api/frame/port") {
      return staticFile(response, portFrame, "image/png");
    }
    if (request.method === "GET" && url.pathname === "/api/live/native.mjpeg") {
      nativeLiveStream.serve(response, nativeStatus.bounds);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/live/port.mjpeg") {
      if (!synchronizeViewer) await portCanvasWebRtc.close();
      await portScreencast.start();
      portViewerTransport = "cdp-screencast";
      portScreencast.serve(response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/live/port/offer") {
      if (synchronizeViewer) throw new Error("Wait mode uses source-time-paired CDP frames");
      const offer = await portCanvasWebRtc.createOffer();
      portViewerTransport = "canvas-webrtc";
      return json(response, 200, offer);
    }
    if (request.method === "POST" && url.pathname === "/api/live/port/answer") {
      const body = await readBody(request);
      const result = await portCanvasWebRtc.acceptAnswer(body.id, body.answer);
      return json(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/api/live/port/stats") {
      const body = await readBody(request);
      const accepted = portCanvasWebRtc.report(body.id, body);
      return json(response, accepted ? 200 : 409, { accepted });
    }
    if (request.method === "GET" && url.pathname === "/api/status") {
      const snapshot = currentSnapshot();
      const portLiveStatus = portViewerTransport === "canvas-webrtc"
        ? portCanvasWebRtc.status()
        : portScreencast.status();
      return json(response, 200, {
        ...snapshot,
        lastCaptureAt,
        recording: session.isRecording(),
        replaying,
        captureFps: options.captureFps,
        viewerMode: options.waitForViewerSync ? "wait" : "independent",
        liveStreams: {
          native: nativeLiveStream.status(),
          port: portLiveStatus,
        },
        nativeInput: options.nativeInput,
        portAudio: options.mutePortAudio ? "muted" : "passthrough",
        nativeClock,
        inputSync,
        task: publicTaskRuntime(),
        evidence: publicEvidence(),
        launcherUrl: options.launcherUrl,
        sessionId: options.sessionId,
      });
    }
    if (request.method === "GET" && url.pathname === "/api/task") {
      return json(response, 200, publicTaskRuntime());
    }
    if (request.method === "POST" && url.pathname === "/api/task/run") {
      if (fidelityTask === undefined) throw new Error("No task loaded; restart with --task <path>");
      if (taskRuntime.running) throw new Error("A Fidelity Lab task is already running");
      void executeLoadedTask();
      return json(response, 202, { accepted: true, taskId: fidelityTask.id });
    }
    const evidenceMatch = url.pathname.match(/^\/api\/evidence\/(task|manual)\/([^/]+)\/(native|port)$/);
    if (request.method === "GET" && evidenceMatch) {
      const [, kind, rawId, side] = evidenceMatch;
      const directory = kind === "manual"
        ? lastManualCheckpoint
        : taskRuntime.lastResult?.steps.find(({ id, directory: stepDirectory }) =>
          id === decodeURIComponent(rawId) && stepDirectory !== undefined)?.directory;
      if (directory === undefined) throw new Error("Evidence is not available");
      return staticFile(response, path.join(directory, `${side}.png`), "image/png");
    }
    if (request.method === "POST" && url.pathname === "/api/input") {
      await enqueueInput(await readBody(request));
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && url.pathname === "/api/gesture") {
      await enqueueGesture(await readBody(request));
      return json(response, 200, { ok: true, inputSync });
    }
    if (request.method === "POST" && url.pathname === "/api/capture") {
      while (captureInFlight) await sleep(10);
      await capture();
      return json(response, 200, { ok: true, lastCaptureAt });
    }
    if (request.method === "POST" && url.pathname === "/api/record/start") {
      const directory = session.start({
        webUrl: options.webUrl,
        captureFps: options.captureFps,
        rng: { kind: "touchhle-xorshift32", initialState: options.rngState, skip: options.rngSkip },
      });
      return json(response, 200, { directory });
    }
    if (request.method === "POST" && url.pathname === "/api/record/stop") {
      return json(response, 200, { result: session.stop() });
    }
    if (request.method === "POST" && url.pathname === "/api/macro/replay") {
      void replayMacro().catch((error) => session.append("replay-error", { message: String(error) }));
      return json(response, 202, { accepted: true });
    }
    if (request.method === "POST" && url.pathname === "/api/checkpoint") {
      const body = await readBody(request);
      while (captureInFlight) await sleep(10);
      await capture();
      const directory = session.checkpoint(nativeFrame, portFrame, {
        native: { ...nativeStatus, scene: readNativeScene() },
        port: portStatus,
        browserErrors,
        comparison: body.comparison,
        note: body.note,
      }, body.label);
      lastManualCheckpoint = directory;
      return json(response, 200, { directory });
    }
    if (request.method === "POST" && url.pathname === "/api/observation") {
      const observation = await readBody(request);
      session.append("observation", observation);
      return json(response, 200, { ok: true });
    }
    response.writeHead(404);
    response.end();
  } catch (error) {
    json(response, 400, { error: String(error) });
  }
});

await new Promise((resolve) => server.listen(options.dashboardPort, "127.0.0.1", resolve));
const dashboardUrl = `http://127.0.0.1:${options.dashboardPort}`;
console.log(`Fidelity Lab: ${dashboardUrl}`);
console.log(`Port: ${options.webUrl} (${options.headedPort ? "headed" : "dashboard-only"}, ${options.mutePortAudio ? "muted" : "audio passthrough"})`);
console.log(nativeStatus.connected
  ? `TouchHLE attached: ${JSON.stringify(nativeStatus.bounds)}`
  : `TouchHLE is not attached yet: ${nativeStatus.error}`);
console.log(`Native automation: input=${options.nativeInput}, capture=${options.nativeCaptureDir === undefined ? "desktop" : "framebuffer"}`);
if (options.open) spawn("cmd.exe", ["/c", "start", "", dashboardUrl], { windowsHide: true, detached: true });
if (options.autoRunTask && fidelityTask !== undefined) {
  setTimeout(() => void executeLoadedTask(), 500);
}

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(captureTimer);
  if (pruneTimer !== undefined) clearInterval(pruneTimer);
  session.stop();
  nativeLiveStream.close();
  server.close();
  await Promise.allSettled([
    portCanvasWebRtc.close(),
    portScreencast.close(),
    native.close(),
    browser.close(),
  ]);
}
process.once("SIGINT", () => void shutdown().then(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().then(() => process.exit(0)));
