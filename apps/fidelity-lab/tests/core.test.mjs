import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  parseLatestSceneDump,
  parseRecentRngDraws,
  preferSceneRngPosition,
} from "../src/nativeSceneLog.mjs";
import { parsePpm, ppmToPng, pruneNativeCaptures, refreshNativeCapture } from "../src/nativeCapture.mjs";
import {
  nearestFrame,
  nativeFramebufferMjpegArguments,
  nativeMjpegArguments,
  PortCanvasWebRtc,
  PortScreencast,
} from "../src/liveStreams.mjs";
import { LiveTouchBridge } from "../src/liveTouchBridge.mjs";
import { parseOptions } from "../src/options.mjs";
import { inputEvent, inputGesture, LabSession, normalizedPoint, targetPoint } from "../src/session.mjs";
import { evaluateStateRules, valueAtPath } from "../src/stateRules.mjs";
import { evaluateTaskExpectations, loadFidelityTask } from "../src/task.mjs";
import {
  assertManagedComparisonPolicy,
  createSourceFreshnessGuard,
  managedComparisonPolicy,
  managedNativeEnvironment,
  managedNativeOverrides,
  observerScript,
  prepareDisposableNative,
  taskScript,
} from "../src/launcherCore.mjs";
import { DungeonTopologyTracker } from "../src/dungeonTopology.mjs";
import { controlledPortBrowserLaunchOptions, DEFAULT_PORT_AUDIO_LEVELS } from "../src/portAudio.mjs";
import { MirroredInputGate } from "../src/public/inputGate.mjs";

test("parseOptions keeps the local lab bounded and validates RNG offsets", () => {
  assert.equal(parseOptions([], "C:/work").captureFps, 2);
  assert.equal(parseOptions([], "C:/work").ffmpegPath, "ffmpeg");
  assert.equal(parseOptions([], "C:/work").waitForViewerSync, false);
  assert.equal(parseOptions([], "C:/work").mutePortAudio, false);
  assert.equal(parseOptions(["--auto-run-task"], "C:/work").mutePortAudio, true);
  const options = parseOptions([
    "--", "--port", "4500", "--capture-fps", "15", "--native-pid", "42",
    "--rng-state", "270369", "--rng-skip", "17", "--native-input", "scripted", "--headed-port",
    "--prune-native-captures", "--wait-for-viewer-sync", "--mute-port-audio", "--managed-policy", managedComparisonPolicy,
  ], "C:/work");
  assert.equal(options.dashboardPort, 4500);
  assert.equal(options.captureFps, 15);
  assert.equal(options.nativePid, 42);
  assert.equal(options.rngState, 270369);
  assert.equal(options.rngSkip, 17);
  assert.equal(options.nativeInput, "scripted");
  assert.equal(options.headedPort, true);
  assert.equal(options.pruneNativeCaptures, true);
  assert.equal(options.waitForViewerSync, true);
  assert.equal(options.mutePortAudio, true);
  assert.equal(options.managedPolicy, managedComparisonPolicy);
  assert.throws(() => parseOptions(["--capture-fps", "60"]), /capture-fps/);
  assert.throws(() => parseOptions(["--rng-state", "4294967296"]), /rng-state/);
});

test("controlled web port audio passes through at source defaults unless explicitly browser-muted", () => {
  assert.deepEqual(DEFAULT_PORT_AUDIO_LEVELS, { sound: 0.25, music: 0.5 });
  const passthrough = controlledPortBrowserLaunchOptions();
  assert.equal(passthrough.args.includes("--mute-audio"), false);
  assert.deepEqual(passthrough.ignoreDefaultArgs, ["--mute-audio"]);

  const muted = controlledPortBrowserLaunchOptions({ muteAudio: true });
  assert.equal(muted.args.includes("--mute-audio"), true);
  assert.equal(muted.ignoreDefaultArgs, undefined);
});

test("managed comparisons normalize Foundation dictionaries and retain per-input RNG evidence", () => {
  const launcher = fs.readFileSync(path.resolve(import.meta.dirname, "../src/launcher.mjs"), "utf8");
  const worker = fs.readFileSync(path.resolve(import.meta.dirname, "../src/index.mjs"), "utf8");
  const setup = fs.readFileSync(path.resolve(import.meta.dirname, "../src/public/setup.html"), "utf8");
  assert.match(launcher, /managedNativeEnvironment\(process\.env/);
  assert.match(launcher, /"--managed-policy", managedComparisonPolicy/);
  assert.match(launcher, /launcherFreshness\.assertCurrent\(\)/);
  assert.match(worker, /foundationDictionaryOrder:\s*"lexicographic"/);
  assert.match(worker, /assertManagedComparisonPolicy\(options\)/);
  assert.match(worker, /nativeRng:\s*\{/);
  assert.match(worker, /rngAnchor:\s*lastRngAnchor/);
  assert.match(worker, /rngTrace:\s*readRecentRngDraws/);
  assert.match(worker, /preferSceneRngPosition\(scene\?\.rng, nativeRngPosition\)/);
  assert.match(launcher, /waitForViewerSync \? \["--wait-for-viewer-sync"\] : \[\]/);
  assert.match(launcher, /portAudio \? \[\] : \["--mute-port-audio"\]/);
  assert.match(worker, /const synchronizeViewer = options\.waitForViewerSync/);
  assert.match(setup, /Wait for both panels to sync/);
  assert.match(setup, /Hold the faster web panel until TouchHLE's matching framebuffer is ready/);
});

test("managed worker refuses stale or incomplete launcher contracts", () => {
  assert.doesNotThrow(() => assertManagedComparisonPolicy({}));
  assert.doesNotThrow(() => assertManagedComparisonPolicy({
    launcherUrl: "http://127.0.0.1:4317",
    sessionId: "session-1",
    managedPolicy: managedComparisonPolicy,
  }));
  assert.throws(() => assertManagedComparisonPolicy({
    launcherUrl: "http://127.0.0.1:4317",
    sessionId: "session-1",
  }), /launcher policy is stale/);
  assert.throws(() => assertManagedComparisonPolicy({
    launcherUrl: "http://127.0.0.1:4317",
  }), /must be supplied together/);
  assert.throws(() => assertManagedComparisonPolicy({
    managedPolicy: managedComparisonPolicy,
  }), /only valid for a managed launcher session/);
});

test("managed native environment keeps both sides on the traced deterministic stream", () => {
  const environment = managedNativeEnvironment(
    { RETAINED: "yes" },
    {
      scriptFile: "input.txt",
      framebuffer: "frames",
      liveInput: "live-input.txt",
      liveAck: "live-ack.txt",
    },
  );
  assert.deepEqual(environment, {
    RETAINED: "yes",
    ...managedNativeOverrides,
    TOUCHHLE_INPUT_SCRIPT: "input.txt",
    TOUCHHLE_CAPTURE_DIR: "frames",
    TOUCHHLE_LIVE_INPUT: "live-input.txt",
    TOUCHHLE_LIVE_ACK: "live-ack.txt",
  });
});

test("managed launcher refuses sessions after its loaded source changes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-launcher-freshness-"));
  try {
    const file = path.join(root, "launcher.mjs");
    fs.writeFileSync(file, "first");
    const guard = createSourceFreshnessGuard([file]);
    assert.equal(guard.isCurrent(), true);
    guard.assertCurrent();
    fs.writeFileSync(file, "second");
    assert.equal(guard.isCurrent(), false);
    assert.throws(() => guard.assertCurrent(), /setup process started/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native RNG traces retain draw positions and guest return addresses", () => {
  assert.deepEqual(parseRecentRngDraws([
    "noise",
    "HRNG 122558ms call=5 state=0x8ef917d1 lr=0x00075828",
    "HRNG 122559ms call=6 state=0x2c6f5bd0 lr=0x000675d4",
    "HRNG 122562ms call=7 state=0x25b2331a lr=0x00089a0e",
  ].join("\n"), 2), [
    { nativeMs: 122559, call: 6, rawState: 0x2c6f5bd0, returnAddress: 0x675d4 },
    { nativeMs: 122562, call: 7, rawState: 0x25b2331a, returnAddress: 0x89a0e },
  ]);
  assert.throws(() => parseRecentRngDraws("", 0), /positive/);
});

test("a later scene RNG position supersedes the ACK's pre-input metadata", () => {
  const ack = { rawState: 0x25b2331a, calls: 7, source: "ack" };
  assert.equal(preferSceneRngPosition({ rawState: 0x25b2331a, calls: 7 }, ack), ack);
  assert.deepEqual(preferSceneRngPosition({ rawState: 0xadd02374, calls: 10 }, ack), {
    rawState: 0xadd02374,
    calls: 10,
    source: "scene",
  });
});

test("native live viewer captures the TouchHLE window without the physical pointer", () => {
  const args = nativeMjpegArguments([120, 80, 960, 640], 60);
  assert.deepEqual(args.slice(args.indexOf("-framerate"), args.indexOf("-framerate") + 2), ["-framerate", "60"]);
  assert.deepEqual(args.slice(args.indexOf("-draw_mouse"), args.indexOf("-draw_mouse") + 2), ["-draw_mouse", "0"]);
  assert.equal(args[args.indexOf("-offset_x") + 1], "120");
  assert.equal(args[args.indexOf("-offset_y") + 1], "80");
  assert.equal(args[args.indexOf("-video_size") + 1], "960x640");
  assert.equal(args[args.indexOf("-i") + 1], "desktop");
  assert.equal(args[args.indexOf("-boundary_tag") + 1], "dib-native-frame");
  const framebufferArgs = nativeFramebufferMjpegArguments(60);
  assert.equal(framebufferArgs[framebufferArgs.indexOf("-i") + 1], "pipe:0");
  assert.equal(framebufferArgs[framebufferArgs.indexOf("-vf") + 1],
    "vflip,scale=960:640:flags=fast_bilinear");
  assert.equal(framebufferArgs[framebufferArgs.indexOf("-fps_mode") + 1], "passthrough");
});

test("managed viewer selects the port frame nearest the native source time", () => {
  const frames = [
    { id: "before", capturedAt: 970 },
    { id: "nearest", capturedAt: 1_004 },
    { id: "after", capturedAt: 1_025 },
  ];
  assert.equal(nearestFrame(frames, 1_000), frames[1]);
  assert.equal(nearestFrame([], 1_000), undefined);
});

test("managed port stream waits for a paired native source frame", () => {
  const stream = new PortScreencast({ send: async () => undefined }, { synchronized: true });
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writes: [],
    writeHead() {},
    write(value) { this.writes.push(value); return true; },
  });
  stream.serve(response);
  stream.onFrame({ data: Buffer.from("port-frame").toString("base64"), sessionId: 1 });
  assert.equal(response.writes.length, 0, "port frame escaped before a native pairing boundary");
  stream.releaseNearest(stream.latestFrame.capturedAt);
  assert.equal(response.writes.length, 3);
  assert.equal(stream.status().pairing, "native-source-time");
  assert.equal(stream.status().frames, 1);
  assert.equal(stream.status().latestPairSkewMs, 0);
});

test("default port stream preserves independent low-latency delivery", () => {
  const stream = new PortScreencast({ send: async () => undefined });
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writes: [],
    writeHead() {},
    write(value) { this.writes.push(value); return true; },
  });
  stream.serve(response);
  stream.onFrame({ data: Buffer.from("port-frame").toString("base64"), sessionId: 1 });
  assert.equal(response.writes.length, 3);
  assert.equal(stream.status().pairing, "independent");
  assert.equal(stream.status().frames, 1);
});

test("default port viewer negotiates direct canvas video and reports presented frames", async () => {
  const commands = [];
  const page = {
    async evaluate(_command, input) {
      commands.push(input);
      if (input.action === "offer") return {
        offer: { type: "offer", sdp: "sender-sdp" },
        width: 960,
        height: 640,
        renderer: "ANGLE (hardware)",
      };
      if (input.action === "answer") return { connectionState: "connecting" };
      return { closed: true };
    },
  };
  const stream = new PortCanvasWebRtc(page, { now: () => 1234 });
  const offer = await stream.createOffer();
  assert.equal(offer.id, "port-video-1234-1");
  assert.equal(offer.offer.sdp, "sender-sdp");
  assert.equal(stream.status().transport, "canvas-webrtc");
  assert.equal(stream.status().renderer, "ANGLE (hardware)");
  assert.equal(stream.status().clients, 1);

  await stream.acceptAnswer(offer.id, { type: "answer", sdp: "receiver-sdp" });
  assert.equal(stream.report(offer.id, { state: "connected", frames: 90, deliveredFps: 59.47 }), true);
  assert.equal(stream.report("stale-peer", { state: "connected", frames: 100, deliveredFps: 60 }), false);
  assert.deepEqual(stream.status(), {
    available: true,
    targetFps: 60,
    deliveredFps: 59.5,
    frames: 90,
    capturedFrames: 90,
    pairing: "independent",
    transport: "canvas-webrtc",
    clients: 1,
    connectionState: "connected",
    width: 960,
    height: 640,
    renderer: "ANGLE (hardware)",
    error: undefined,
  });
  assert.throws(() => stream.report(offer.id, { state: "connected", frames: -1, deliveredFps: 60 }), /frames/);
  await stream.close();
  assert.deepEqual(commands.map(({ action }) => action), ["offer", "answer", "close"]);
});

test("dashboard prefers canvas capture WebRTC while retaining the screencast fallback", () => {
  const worker = fs.readFileSync(path.resolve(import.meta.dirname, "../src/index.mjs"), "utf8");
  const streams = fs.readFileSync(path.resolve(import.meta.dirname, "../src/liveStreams.mjs"), "utf8");
  const dashboard = fs.readFileSync(path.resolve(import.meta.dirname, "../src/public/dashboard.js"), "utf8");
  const html = fs.readFileSync(path.resolve(import.meta.dirname, "../src/public/index.html"), "utf8");
  assert.match(streams, /canvas\.captureStream\(command\.targetFps\)/);
  assert.match(streams, /new RTCPeerConnection\(\{ iceServers: \[\] \}\)/);
  assert.match(worker, /\/api\/live\/port\/offer/);
  assert.match(worker, /await portScreencast\.start\(\);\s*portViewerTransport = "cdp-screencast"/);
  assert.match(dashboard, /connectDirectPortVideo/);
  assert.match(dashboard, /connectPortFallback/);
  assert.match(html, /<video id="port-live-video" muted autoplay playsinline/);
});

test("normalized mirrored input maps independently into both target rectangles", () => {
  assert.deepEqual(normalizedPoint({ x: 0.25, y: 0.75 }), { x: 0.25, y: 0.75 });
  assert.deepEqual(targetPoint({ x: 0.25, y: 0.75 }, { x: 100, y: 50, width: 960, height: 640 }), {
    x: 340,
    y: 530,
  });
  assert.deepEqual(inputEvent({ phase: "move", x: 0, y: 1 }), { phase: "move", x: 0, y: 1 });
  assert.throws(() => normalizedPoint({ x: -0.01, y: 0 }), /normalized/);
  assert.throws(() => inputEvent({ phase: "tap", x: 0.5, y: 0.5 }), /Unknown input phase/);
});

test("complete mirrored gestures preserve ordered relative timing", () => {
  const gesture = inputGesture({
    id: "pointer-7",
    events: [
      { phase: "down", x: 0.25, y: 0.5, tMs: 0 },
      { phase: "move", x: 0.5, y: 0.5, tMs: 32 },
      { phase: "up", x: 0.75, y: 0.5, tMs: 64 },
    ],
  });
  assert.equal(gesture.id, "pointer-7");
  assert.deepEqual(gesture.events.map(({ phase, tMs }) => ({ phase, tMs })), [
    { phase: "down", tMs: 0 },
    { phase: "move", tMs: 32 },
    { phase: "up", tMs: 64 },
  ]);
  assert.equal(inputGesture({ events: [
    { phase: "down", x: 0.5, y: 0.5, tMs: 0 },
    { phase: "up", x: 0.5, y: 0.5, tMs: 1 },
  ] }).events[1].tMs, 120);
  // Browsers stamp phases with `performance.now()`. Fractional offsets produce fractional replay
  // deadlines, and the TouchHLE harness discards any command whose deadline is not an integer.
  const fractional = inputGesture({ events: [
    { phase: "down", x: 0.5, y: 0.5, tMs: 0.4 },
    { phase: "move", x: 0.5, y: 0.5, tMs: 132.7 },
    { phase: "up", x: 0.5, y: 0.5, tMs: 264.5 },
  ] });
  assert.deepEqual(fractional.events.map(({ tMs }) => tMs), [0, 133, 265]);
  for (const { tMs } of fractional.events) assert.equal(Number.isSafeInteger(tMs), true);
  assert.throws(() => inputGesture({ events: [
    { phase: "down", x: 0.5, y: 0.5, tMs: 10 },
    { phase: "up", x: 0.5, y: 0.5, tMs: 5 },
  ] }), /nondecreasing/);
  assert.throws(() => inputGesture({ events: [
    { phase: "move", x: 0.5, y: 0.5, tMs: 0 },
    { phase: "up", x: 0.5, y: 0.5, tMs: 5 },
  ] }), /begin with down/);
});

test("dashboard input admits only one gesture through mirrored delivery", () => {
  const dashboard = fs.readFileSync(path.resolve(import.meta.dirname, "../src/public/dashboard.js"), "utf8");
  assert.match(dashboard, /mirroredInputGate\.begin\(event\.pointerId\)/);
  assert.match(dashboard, /mirroredInputGate\.commit\(event\.pointerId\)/);
  assert.doesNotMatch(dashboard, /mirroredInputQueue/);
  const gate = new MirroredInputGate();
  assert.equal(gate.state, "ready");
  assert.equal(gate.begin(7), true);
  assert.equal(gate.state, "capturing");
  assert.equal(gate.begin(8), false, "a second pointer must not join the active gesture");
  assert.equal(gate.commit(8), false, "only the owning pointer may commit the gesture");
  assert.equal(gate.commit(7), true);
  assert.equal(gate.state, "mirroring");
  assert.equal(gate.begin(8), false, "a stale click must not queue behind mirrored delivery");
  assert.equal(gate.complete(), true);
  assert.equal(gate.begin(8), true, "input reopens only after mirrored delivery finishes");
  assert.equal(gate.cancel(8), true);
  assert.equal(gate.state, "ready");
});

test("native input bridge sends directly to TouchHLE on the shared phase deadline", () => {
  const bridge = fs.readFileSync(path.resolve(import.meta.dirname, "../src/win32-bridge.ps1"), "utf8");
  assert.match(bridge, /static void WaitUntil\(long targetEpochMs\)/);
  assert(bridge.indexOf("if (focusWindow) Focus(handle);") < bridge.indexOf("WaitUntil(targetEpochMs);"));
  assert.match(bridge, /SendMessage\(handle, 0x0201, new IntPtr\(1\), position\)/);
  assert.doesNotMatch(bridge, /case "down": mouse_event/);
  assert.match(bridge, /\$command\.targetEpochMs/);
});

test("live TouchHLE bridge waits for readiness and acknowledges background gesture phases", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-live-touch-"));
  try {
    const inputFile = path.join(root, "input.txt");
    const ackFile = path.join(root, "ack.txt");
    fs.writeFileSync(inputFile, "");
    fs.writeFileSync(ackFile, "READY 1\n");
    const bridge = new LiveTouchBridge(inputFile, ackFile, { timeoutMs: 500, pollMs: 1 });
    await bridge.ready();
    await bridge.ready();
    const delivery = bridge.input({ phase: "move", x: 0.25, y: 0.75 }, 123456);
    while (!fs.readFileSync(inputFile, "utf8").includes("INPUT 1")) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(fs.readFileSync(inputFile, "utf8"), "INPUT 1 123456 MOVE 0.25 0.75\n");
    fs.appendFileSync(ackFile, "ACK 1 123460\n");
    assert.deepEqual(await delivery, { registeredAt: 123460 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("live TouchHLE bridge writes integer deadlines the harness can parse", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-live-touch-round-"));
  try {
    const inputFile = path.join(root, "input.txt");
    const ackFile = path.join(root, "ack.txt");
    fs.writeFileSync(inputFile, "");
    fs.writeFileSync(ackFile, "READY 1\n");
    const bridge = new LiveTouchBridge(inputFile, ackFile, { timeoutMs: 500, pollMs: 1 });
    await bridge.ready();
    // `u64::from_str` in the harness rejects "1786896219847.7" outright and drops the phase.
    const delivery = bridge.input({ phase: "move", x: 0.25, y: 0.75 }, 1_786_896_219_847.7);
    while (!fs.readFileSync(inputFile, "utf8").includes("INPUT 1")) await new Promise((resolve) => setTimeout(resolve, 1));
    const line = fs.readFileSync(inputFile, "utf8").trim();
    assert.equal(line, "INPUT 1 1786896219848 MOVE 0.25 0.75");
    assert.doesNotMatch(line.split(" ")[2], /\./);
    fs.appendFileSync(ackFile, "ACK 1 1786896219850\n");
    assert.deepEqual(await delivery, { registeredAt: 1_786_896_219_850 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("live TouchHLE bridge reads only newly appended acknowledgements", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-live-touch-tail-"));
  try {
    const inputFile = path.join(root, "input.txt");
    const ackFile = path.join(root, "ack.txt");
    fs.writeFileSync(inputFile, "");
    fs.writeFileSync(ackFile, `${"# backlog\n".repeat(500)}READY 1\n`);
    const bridge = new LiveTouchBridge(inputFile, ackFile, { timeoutMs: 500, pollMs: 1 });
    await bridge.ready();
    const consumed = bridge.ackOffset;
    assert.equal(consumed, fs.statSync(ackFile).size);
    const delivery = bridge.input({ phase: "up", x: 0, y: 0 }, 1_000);
    fs.appendFileSync(ackFile, "ACK 1 1234 0x04080601 6789\n");
    assert.deepEqual(await delivery, {
      registeredAt: 1234,
      rawState: 0x04080601,
      calls: 6789,
    });

    assert.equal(bridge.ackOffset - consumed, "ACK 1 1234 0x04080601 6789\n".length);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("TouchHLE scene parser returns only the latest complete dump", () => {
  const parsed = parseLatestSceneDump([
    "HSCENE 10ms ==== running scene ====",
    "HSCENE Old tap=(1,2) size=(3x4)",
    "HSCENE 10ms ==== end ====",
    "HSCENE 25ms ==== running scene ====",
    "HSCENE 25ms arc4random state=0x04080601 calls=6789",
    "HSCENE BattleNode tap=(240,160) size=(480x320)",
    "HSCENE   CCLabelBMFont tap=(110,44) size=(70x14) \"Damage 42\"",
    "HSCENE   HiddenNode tap=(0,0) size=(1x1) HIDDEN",
    "HSCENE 25ms ==== end ====",
    "HSCENE 40ms ==== running scene ====",
    "HSCENE IncompleteNode tap=(0,0) size=(1x1)",
  ].join("\n"));
  assert.equal(parsed.nativeMs, 25);
  assert.deepEqual(parsed.rng, { rawState: 0x04080601, calls: 6789 });
  assert.deepEqual(parsed.nodes, [
    { className: "BattleNode", depth: 0, tap: { x: 240, y: 160 }, size: { w: 480, h: 320 }, visible: true },
    { className: "CCLabelBMFont", depth: 1, tap: { x: 110, y: 44 }, size: { w: 70, h: 14 }, visible: true, text: "Damage 42" },
    { className: "HiddenNode", depth: 1, tap: { x: 0, y: 0 }, size: { w: 1, h: 1 }, visible: false },
  ]);
});

test("dungeon topology tracker removes camera transform and accumulates a complete floor", () => {
  const tracker = new DungeonTopologyTracker();
  const port = {
    mode: "dungeon",
    instanceName: "NorthCave",
    sourceFile: "Dungeon_1.plist",
    floor: 1,
    seed: 123,
    currentRoomId: "room-1",
    rooms: [
      { id: "room-1", x: 0, y: 0, width: 2, height: 4 },
      { id: "room-2", x: 0, y: 5, width: 1, height: 2 },
      { id: "room-3", x: 3, y: 0, width: 2, height: 2 },
    ],
  };
  const scene = {
    nativeMs: 25,
    nodes: [
      { className: "CCScene", depth: 0, tap: { x: 240, y: 160 }, size: { w: 480, h: 320 }, visible: true },
      { className: "DungeonNode", depth: 1, tap: { x: 0, y: 320 }, size: { w: 0, h: 0 }, visible: true },
      { className: "RoomNode", depth: 2, tap: { x: 218, y: -20 }, size: { w: 45, h: 90 }, visible: true },
      { className: "RoomNode", depth: 2, tap: { x: 240, y: 160 }, size: { w: 90, h: 180 }, visible: true },
      { className: "RoomNode", depth: 2, tap: { x: 375, y: 205 }, size: { w: 90, h: 90 }, visible: true },
    ],
  };
  assert.equal(tracker.observe(scene, port).verdict, "incomplete");
  assert.deepEqual(tracker.observe({ ...scene, nativeMs: 26 }, port), {
    identity: "NorthCave|Dungeon_1.plist|1|123",
    verdict: "match",
    nativeObservedRooms: 3,
    portRooms: 3,
    matchedRooms: 3,
    nativeOnly: [],
    portNotObserved: [],
    alignmentErrors: [],
  });
});

test("dungeon topology tracker reports observed native geometry absent from the port", () => {
  const tracker = new DungeonTopologyTracker();
  const scene = {
    nativeMs: 40,
    nodes: [
      { className: "CCScene", depth: 0, tap: { x: 240, y: 160 }, size: { w: 480, h: 320 }, visible: true },
      { className: "DungeonNode", depth: 0, tap: { x: 0, y: 320 }, size: { w: 0, h: 0 }, visible: true },
      { className: "RoomNode", depth: 1, tap: { x: 240, y: 160 }, size: { w: 45, h: 45 }, visible: true },
      { className: "RoomNode", depth: 1, tap: { x: 330, y: 160 }, size: { w: 45, h: 45 }, visible: true },
    ],
  };
  const port = {
    mode: "dungeon", instanceName: "Cave", sourceFile: "Dungeon.plist", floor: 1, seed: 1,
    currentRoomId: "room-1",
    rooms: [
      { id: "room-1", x: 0, y: 0, width: 1, height: 1 },
      { id: "room-2", x: 1, y: 0, width: 1, height: 1 },
    ],
  };
  assert.equal(tracker.observe(scene, port).verdict, "incomplete");
  const comparison = tracker.observe({ ...scene, nativeMs: 41 }, port);
  assert.equal(comparison.verdict, "different");
  assert.deepEqual(comparison.nativeOnly, [{ x: 2, y: 0, width: 1, height: 1 }]);
  assert.deepEqual(comparison.portNotObserved, [{ x: 1, y: 0, width: 1, height: 1 }]);
});

test("dungeon topology tracker reports one-sided dungeon entry instead of hiding it", () => {
  const tracker = new DungeonTopologyTracker();
  const nativeDungeon = {
    nativeMs: 1,
    nodes: [{ className: "DungeonNode", depth: 0, visible: true }],
  };
  assert.deepEqual(tracker.observe(nativeDungeon, { mode: "town" }), {
    verdict: "scene-mismatch",
    nativeDungeon: true,
    portDungeon: false,
    message: "Native is in a dungeon while the web port is not",
  });
  assert.deepEqual(tracker.observe({ nativeMs: 2, nodes: [] }, { mode: "dungeon", rooms: [] }), {
    verdict: "scene-mismatch",
    nativeDungeon: false,
    portDungeon: true,
    message: "Web port is in a dungeon while native is not",
  });
});

test("recordings retain mirrored input timing and write a reusable macro", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-fidelity-lab-"));
  try {
    const session = new LabSession(root);
    const directory = session.start({ test: true });
    session.append("input", { phase: "down", x: 0.5, y: 0.25 });
    session.append("input", { phase: "up", x: 0.5, y: 0.25 });
    const stopped = session.stop();
    assert.equal(stopped.inputs, 2);
    const macro = JSON.parse(fs.readFileSync(path.join(directory, "macro.json"), "utf8"));
    assert.deepEqual(macro.inputs.map(({ phase, x, y }) => ({ phase, x, y })), [
      { phase: "down", x: 0.5, y: 0.25 },
      { phase: "up", x: 0.5, y: 0.25 },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("numeric state rules flag deterministic values only beyond the configured margin", () => {
  const rules = [{
    id: "hp",
    label: "Active HP",
    regexp: /HP (?<value>\d+)/,
    portPath: "monsters[0].hp",
    occurrence: 0,
    absoluteTolerance: 2,
    relativeTolerance: 0,
  }];
  const nativeScene = { nodes: [{ visible: true, text: "HP 100" }] };
  expectPath();
  assert.equal(valueAtPath({ monsters: [{ hp: 102 }] }, "monsters[0].hp"), 102);
  assert.equal(evaluateStateRules(rules, nativeScene, { monsters: [{ hp: 102 }] })[0].status, "match");
  assert.equal(evaluateStateRules(rules, nativeScene, { monsters: [{ hp: 103 }] })[0].status, "different");

  function expectPath() {
    assert.equal(valueAtPath({ player: { gold: 4 } }, "player.gold"), 4);
  }
});

test("machine-made tasks load normalized input and evaluate explicit port/native output", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-fidelity-task-"));
  try {
    const file = path.join(root, "task.json");
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      id: "load-town",
      title: "Load town",
      purpose: "Exercise task input and output detection.",
      setup: ["Use the same save in both runtimes."],
      reviewFocus: ["Compare the town building layout."],
      steps: [
        { id: "tap-start", kind: "tap", x: 0.5, y: 0.5 },
        {
          id: "wait-town",
          kind: "wait",
          until: [
            { target: "port", path: "mode", equals: "town" },
            { target: "native", node: { className: "WorldNode" } },
          ],
        },
        {
          id: "town-checkpoint",
          kind: "checkpoint",
          expectations: [
            { target: "native", node: { text: "Corova" } },
            { target: "lab", path: "browserErrors.length", equals: 0 },
          ],
        },
      ],
    }));
    const task = loadFidelityTask(file);
    assert.equal(task.steps[0].x, 0.5);
    const result = evaluateTaskExpectations(task.steps[1].until, {
      native: { scene: { nodes: [{ className: "WorldNode", visible: true }] } },
      port: { state: { mode: "town" } },
      browserErrors: [],
    });
    assert.equal(result.pass, true);
    assert.equal(result.results.length, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("TouchHLE framebuffer PPMs become browser-readable PNGs without the desktop", () => {
  const header = Buffer.from("P6 2 1 255\n", "ascii");
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0]);
  const parsed = parsePpm(Buffer.concat([header, pixels]));
  assert.equal(parsed.width, 2);
  assert.equal(parsed.height, 1);
  const converted = ppmToPng(Buffer.concat([header, pixels]));
  assert.equal(converted.width, 2);
  assert.deepEqual([...converted.png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("managed native capture skips partial newest frames and prunes past the viewer window", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-native-capture-"));
  try {
    const header = Buffer.from("P6 4 2 255\n", "ascii");
    const complete = (fill) => Buffer.concat([header, Buffer.alloc(24, fill)]);
    fs.writeFileSync(path.join(root, "frame_0001_100ms.ppm"), complete(127));
    fs.writeFileSync(path.join(root, "frame_0002_200ms.ppm"), complete(64));
    // The harness writes straight to its final filename, so the newest entry can be incomplete.
    fs.writeFileSync(path.join(root, "frame_0003_300ms.ppm"), Buffer.concat([header, Buffer.alloc(30, 255)]));
    const output = path.join(root, "current.png");
    const result = await refreshNativeCapture(root, output, { prune: true, keep: 2 });
    assert.match(result.source, /frame_0002_200ms\.ppm$/);
    assert.equal(fs.existsSync(output), true);
    // The incomplete newest frame stays: it is the head of the window the live pump reads, and it
    // completes a moment later. Only frames past the window are collected.
    assert.equal(fs.existsSync(path.join(root, "frame_0003_300ms.ppm")), true);
    assert.equal(fs.existsSync(path.join(root, "frame_0002_200ms.ppm")), true);
    assert.equal(fs.existsSync(path.join(root, "frame_0001_100ms.ppm")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("native capture pruning keeps a newest-first window for the live viewer", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-native-prune-"));
  try {
    const header = Buffer.from("P6 4 2 255\n", "ascii");
    for (let index = 1; index <= 12; index++) {
      fs.writeFileSync(
        path.join(root, `frame_${String(index).padStart(4, "0")}_${index * 33}ms.ppm`),
        Buffer.concat([header, Buffer.alloc(24, index)]),
      );
    }
    const pruned = await pruneNativeCaptures(root, { keep: 4 });
    assert.equal(pruned.removed, 8);
    // The four highest frame indices survive so the streaming pump keeps a complete predecessor.
    assert.deepEqual(fs.readdirSync(root).sort(), [
      "frame_0009_297ms.ppm", "frame_0010_330ms.ppm", "frame_0011_363ms.ppm", "frame_0012_396ms.ppm",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("dashboard launcher builds native scripts and a disposable save without mutating its package", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dib-launcher-test-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "destination");
  fs.mkdirSync(path.join(source, "touchHLE_dylibs"), { recursive: true });
  fs.mkdirSync(path.join(source, "touchHLE_fonts"), { recursive: true });
  const sourceDocuments = path.join(source, "touchHLE_sandbox/jp.ne.goo.game.dragonislandblue/Documents");
  fs.mkdirSync(sourceDocuments, { recursive: true });
  fs.writeFileSync(path.join(source, "touchHLE.exe"), "exe");
  fs.writeFileSync(path.join(source, "touchHLE_dylibs", "library"), "dylib");
  fs.writeFileSync(path.join(source, "touchHLE_fonts", "font"), "font");
  fs.writeFileSync(path.join(sourceDocuments, "savefile0"), "original");
  fs.writeFileSync(path.join(sourceDocuments, "savefile1"), "unselected");
  fs.writeFileSync(path.join(sourceDocuments, "savefile2.bak"), "unselected-backup");
  const archive = path.join(root, "content.ipa");
  const save = path.join(root, "matched-save");
  fs.writeFileSync(archive, "archive");
  fs.writeFileSync(save, "matched");
  const observer = observerScript(500, 250);
  assert.match(observer, /DUMP 0\nDUMP 250\nDUMP 500/);
  assert.match(observerScript(1_000), /DUMP 0\nDUMP 500\nDUMP 1000/);
  const task = loadFidelityTask(path.resolve(import.meta.dirname, "../tasks/01-load-saved-town.json"));
  const generated = taskScript(task);
  assert.match(generated, /TAP 120000 480 320/);
  const prepared = prepareDisposableNative({ source, destination, archive, save, script: generated });
  assert.equal(fs.readFileSync(path.join(sourceDocuments, "savefile0"), "utf8"), "original");
  assert.equal(fs.readFileSync(path.join(destination, "touchHLE_sandbox/jp.ne.goo.game.dragonislandblue/Documents/savefile0"), "utf8"), "matched");
  assert.equal(fs.existsSync(path.join(destination, "touchHLE_sandbox/jp.ne.goo.game.dragonislandblue/Documents/savefile1")), false);
  assert.equal(fs.existsSync(path.join(destination, "touchHLE_sandbox/jp.ne.goo.game.dragonislandblue/Documents/savefile2.bak")), false);
  assert.equal(fs.readFileSync(prepared.scriptFile, "utf8"), generated);
});
