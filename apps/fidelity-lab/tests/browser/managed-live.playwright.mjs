// Full dashboard-first live workflow. It verifies launch, comparison controls, checkpoint review, and teardown.
// Set DIB_FIDELITY_WAIT=1 to retain coverage for the optional source-time-paired screencast viewer.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const launcherUrl = process.env.DIB_FIDELITY_LAB_URL ?? "http://127.0.0.1:4317";
const output = path.resolve(import.meta.dirname, "../../../../output/fidelity-lab/managed-live-browser");
const waitForViewerSync = process.env.DIB_FIDELITY_WAIT === "1";
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: process.env.DIB_HEADED !== "1",
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  let mirroredGestureRequests = 0;
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/gesture") mirroredGestureRequests++;
  });
  await page.goto(launcherUrl, { waitUntil: "domcontentloaded" });
  const initial = await page.evaluate(() => fetch("/api/setup").then((response) => response.json()));
  if (initial.activeSession && initial.activeSession.state !== "stopped") {
    await page.evaluate((id) => fetch(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" }), initial.activeSession.id);
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await page.getByText("Live comparison", { exact: true }).click();
  if (waitForViewerSync) await page.locator("#wait-for-viewer-sync").check();
  await page.locator("#port-audio").uncheck();
  await page.locator("#content-rights").check();
  await page.getByRole("button", { name: "Start comparison" }).click();
  await Promise.race([
    page.waitForURL((current) => current.port !== new URL(launcherUrl).port, { timeout: 150_000 }),
    page.locator("#setup-error:not(.hidden)").waitFor({ timeout: 150_000 }).then(async () => {
      throw new Error(`Dashboard setup failed: ${await page.locator("#setup-error").textContent()}`);
    }),
  ]);
  const deadline = Date.now() + 60_000;
  let status;
  while (Date.now() < deadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    if (status.native?.frameReady && status.port?.frameReady) break;
    await page.waitForTimeout(250);
  }
  assert(status?.native?.frameReady, "native frame never became ready");
  assert(status?.port?.frameReady, "port frame never became ready");
  assert.equal(status.captureFps, 2, "managed comparison did not use the low-overhead evidence rate");
  assert.equal(status.viewerMode, waitForViewerSync ? "wait" : "independent",
    "managed live proof launched the wrong viewer mode");
  assert.equal(status.portAudio, "muted", "automated managed-live proof must mute controlled-port output");
  const streamDeadline = Date.now() + 30_000;
  while (Date.now() < streamDeadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    if (status.liveStreams?.native?.clients === 1 && status.liveStreams?.port?.clients === 1 &&
        status.liveStreams.native.frames > 0 && status.liveStreams.port.frames > 0) break;
    await page.waitForTimeout(100);
  }
  assert.equal(status?.liveStreams?.native?.clients, 1, "dashboard did not open the native live stream");
  assert.equal(status?.liveStreams?.port?.clients, 1, "dashboard did not open the port live stream");
  const initialStreamFrames = {
    native: status.liveStreams.native.frames,
    port: status.liveStreams.port.frames,
  };
  await page.waitForTimeout(1_500);
  status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
  assert(status.liveStreams.native.frames - initialStreamFrames.native >= 30,
    `native viewer delivered only ${status.liveStreams.native.frames - initialStreamFrames.native} frames in 1.5s`);
  if (waitForViewerSync) {
    assert(status.liveStreams.port.frames - initialStreamFrames.port >= 15,
      `paired port viewer delivered only ${status.liveStreams.port.frames - initialStreamFrames.port} frames in 1.5s`);
    assert.match(await page.locator("#viewer-cadence").textContent(), /Viewer source-time paired/);
    assert.equal(status.liveStreams.port.pairing, "native-source-time");
    assert(Number.isFinite(status.liveStreams.port.latestPairSkewMs),
      "managed viewer did not publish a source-time frame pair");
  } else {
    assert.equal(status.liveStreams.port.transport, "canvas-webrtc",
      "default viewer fell back from direct canvas video");
    assert(status.liveStreams.port.frames - initialStreamFrames.port >= 45,
      `direct port viewer presented only ${status.liveStreams.port.frames - initialStreamFrames.port} frames in 1.5s`);
    assert(status.liveStreams.port.deliveredFps >= 40,
      `direct port viewer sustained only ${status.liveStreams.port.deliveredFps} fps`);
    assert.match(await page.locator("#viewer-cadence").textContent(), /Viewer direct canvas/);
    assert.equal(status.liveStreams.port.pairing, "independent");
  }
  assert.equal(await page.locator("#auto-diff").isChecked(), false,
    "live pixel analysis should be opt-in");
  await page.getByText(/Pixel analysis paused/).waitFor();
  const inputDeadline = Date.now() + 60_000;
  while (Date.now() < inputDeadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    const nativeAtTitle = status.native?.scene?.nodes?.some(({ text }) => text === "Touch To Continue");
    if (status.port?.state?.mode === "start" && nativeAtTitle) break;
    await page.waitForTimeout(100);
  }
  assert.equal(status?.port?.state?.mode, "start", "port did not settle on its title screen");
  assert(status.native?.scene?.nodes?.some(({ text }) => text === "Touch To Continue"),
    "native did not settle on its title screen");
  const portCanvasBounds = await page.locator("#port-canvas").boundingBox();
  assert(portCanvasBounds, "web-port dashboard pane has no interactive bounds");
  await page.locator("#port-canvas").click({
    position: { x: portCanvasBounds.width * 0.5, y: portCanvasBounds.height * 0.5 },
  });
  await page.locator('#comparison[data-input-state="mirroring"]').waitFor();
  await page.locator("#port-canvas").click({
    position: { x: portCanvasBounds.width * 0.5, y: portCanvasBounds.height * 0.5 },
  });
  const mirroredDeadline = Date.now() + 30_000;
  while (Date.now() < mirroredDeadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    const nativeAtSavePicker = status.native?.scene?.nodes?.some(({ className }) => className === "PickSaveSlotNode");
    if (status.inputSync?.state === "synced" &&
        status.port?.state?.startup?.phase === "save-select" && nativeAtSavePicker) break;
    await page.waitForTimeout(100);
  }
  assert.equal(status?.inputSync?.state, "synced", "live gesture did not complete on both targets");
  assert.equal(status?.inputSync?.phaseCount, 2, "dashboard click was not replayed as one complete gesture");
  assert.equal(mirroredGestureRequests, 1, "a rapid stale click queued behind the in-flight mirrored gesture");
  assert.equal(status?.inputSync?.durationMs, 120, "sub-frame click did not use the native tap hold");
  assert.equal(status?.nativeInput, "harness", "managed live input did not use the background TouchHLE harness");
  assert.equal(status?.inputSync?.cursorRestored, undefined, "background input unexpectedly manipulated the cursor");
  assert.equal(status?.inputSync?.focusRestored, undefined, "background input unexpectedly manipulated foreground focus");
  // The native ACK is emitted after UIKit dispatch, then ACK-time RNG anchoring adds one
  // page-evaluation round trip before CDP can register the port phase. Keep the phase-specific
  // bound aligned with the transport's existing 32 ms max-skew contract.
  assert(Math.abs(status.inputSync.phases.find(({ phase }) => phase === "down").skewMs) <= 32,
    `live input-down delivery skew was ${status.inputSync.phases.find(({ phase }) => phase === "down").skewMs}ms`);
  assert(status.inputSync.maxSkewMs <= 32, `live input delivery skew was ${status.inputSync.maxSkewMs}ms`);
  assert(status.inputSync.phases.every(({ targetEpochMs, portRegisteredAt, nativeRegisteredAt }) =>
    Number.isFinite(targetEpochMs) && Number.isFinite(portRegisteredAt) && Number.isFinite(nativeRegisteredAt)),
  "live input diagnostics did not report real registration times");
  assert.equal(status?.port?.state?.startup?.phase, "save-select", "mirrored tap did not reach the web port");
  assert.equal(status?.port?.state?.fidelityLab?.foundationDictionaryOrder, "lexicographic",
    "web port did not enable the managed lab's Foundation traversal normalization");
  assert(status.native?.scene?.nodes?.some(({ className }) => className === "PickSaveSlotNode"),
    "mirrored tap did not reach TouchHLE");
  const requiredCaptureMs = Date.parse(status.inputSync.completedAt) - status.nativeClock.originEpochMs + 100;
  const freshFrameDeadline = Date.now() + 5_000;
  while (Date.now() < freshFrameDeadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    const captureMs = Number(/_(\d+)ms\.ppm$/i.exec(status.native?.captureSource ?? "")?.[1]);
    if (captureMs >= requiredCaptureMs) break;
    await page.waitForTimeout(50);
  }
  assert(Number(/_(\d+)ms\.ppm$/i.exec(status.native?.captureSource ?? "")?.[1]) >= requiredCaptureMs,
    "native framebuffer did not refresh after the mirrored gesture");
  // The shipped picker continues its source entry transition after its scene node exists.
  // Do not turn that real input gate into a transport-flakiness assertion.
  await page.waitForTimeout(1_800);
  const previousCaptureAt = status.lastCaptureAt;
  await page.getByRole("button", { name: "Refresh frames" }).click();
  await page.waitForFunction((previous) => window.fetch("/api/status")
    .then((response) => response.json())
    .then((next) => next.lastCaptureAt > previous), previousCaptureAt);
  const nativeCanvasBounds = await page.locator("#native-canvas").boundingBox();
  assert(nativeCanvasBounds, "native dashboard pane has no interactive bounds");
  await page.locator("#native-canvas").click({
    position: { x: nativeCanvasBounds.width * 0.5, y: nativeCanvasBounds.height * 0.325 },
  });
  const nativePaneDeadline = Date.now() + 45_000;
  while (Date.now() < nativePaneDeadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    const nativeAtTown = status.native?.scene?.nodes?.some(({ className }) => className === "WorldNode");
    if (status.inputSync?.state === "synced" && status.port?.state?.mode === "town" && nativeAtTown) break;
    await page.waitForTimeout(100);
  }
  assert.equal(status?.port?.state?.mode, "town", "native-pane tap did not reach the web port");
  assert(status.native?.scene?.nodes?.some(({ className }) => className === "WorldNode"),
    "native-pane tap did not reach TouchHLE");
  assert.equal(status?.inputSync?.cursorRestored, undefined, "native-pane background input manipulated the cursor");
  assert.equal(status?.inputSync?.focusRestored, undefined, "native-pane background input manipulated foreground focus");
  assert(Math.abs(status.inputSync.phases.find(({ phase }) => phase === "down").skewMs) <= 32,
    `native-pane input-down delivery skew was ${status.inputSync.phases.find(({ phase }) => phase === "down").skewMs}ms`);
  assert(status.inputSync.maxSkewMs <= 32,
    `native-pane live input delivery skew was ${status.inputSync.maxSkewMs}ms`);
  await page.locator("#view-mode").selectOption("overlay");
  await page.locator("#checkpoint-note").fill("Dashboard-first live workflow smoke checkpoint");
  await page.getByRole("button", { name: "Checkpoint", exact: true }).click();
  await page.locator("#evidence-panel").waitFor();
  await page.screenshot({ path: path.join(output, "live-workspace.png"), fullPage: true });
  assert.deepEqual(errors, [], "dashboard reported an error before session teardown");
  await page.getByRole("button", { name: "End session" }).click();
  await page.waitForURL(`${launcherUrl}/`, { timeout: 30_000 });
  await page.getByRole("heading", { name: "What do you want to compare?" }).waitFor();
  assert(errors.every((message) => message.includes("net::ERR_CONNECTION_RESET")),
    `unexpected dashboard teardown errors: ${errors.join("\n")}`);
  console.log("fidelity-lab-managed-live: PASS");
} finally {
  await browser.close();
}
