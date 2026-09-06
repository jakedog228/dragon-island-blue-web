


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ?? path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const nativeSave = path.resolve(process.env.DIB_NATIVE_SAVE ?? "");
const outputDirectory = path.resolve(
  process.env.DIB_JOURNEY_LOCKSTEP_OUTPUT ??
    path.join(repositoryRoot, "output/frame-timing-survey/browser-journey"),
);
const captureScreenshots = process.env.DIB_JOURNEY_LOCKSTEP_CAPTURE !== "0";

assert(nativeSave !== repositoryRoot && fs.existsSync(nativeSave),
  "DIB_NATIVE_SAVE must name the copied save used by TouchHLE");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
fs.mkdirSync(outputDirectory, { recursive: true });

// Native reference zero is MainMenuNode.onEnterTransitionDidFinish @ 1318 ms. These offsets use
// the observed ccTouchEnded timestamp (the action boundary), not the harness's earlier TAP-down.
const inputs = [
  { id: "title", nativeMs: 3_950, x: 480, y: 320 },
  { id: "slot-1", nativeMs: 6_630, x: 480, y: 208 },
  { id: "town-poi", nativeMs: 14_755, x: 128, y: 372 },
  { id: "world-1", nativeMs: 20_179, x: 366, y: 442 },
  { id: "world-2", nativeMs: 24_249, x: 282, y: 380 },
  { id: "replay-popup", nativeMs: 27_638, x: 480, y: 496 },
  { id: "world-3", nativeMs: 30_676, x: 320, y: 286 },
  { id: "world-4", nativeMs: 34_638, x: 346, y: 186 },
  { id: "dungeon-poi", nativeMs: 38_652, x: 238, y: 156 },
  { id: "dungeon-chat", nativeMs: 43_138, x: 480, y: 520 },
  { id: "floor-choice", nativeMs: 47_630, x: 684, y: 352 },
  { id: "floor-chat", nativeMs: 53_146, x: 480, y: 520 },
].map((input) => ({ ...input, timeMs: input.nativeMs - 1_318 }));
const durationMs = inputs.at(-1).timeMs + 2_000;
const frameDurationMs = 1_000 / 60;

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: process.env.DIB_HEADED !== "1",
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_EXTERNAL_STARTUP_CLOCK__ = true;
  });

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: "Offline settings" }).click();
  const storageDialog = page.getByRole("dialog", { name: "Offline settings" });
  await storageDialog.getByText("Offline save slots").waitFor();
  page.once("dialog", async (prompt) => { await prompt.accept("1"); });
  await storageDialog.locator('input[type="file"]').setInputFiles(nativeSave);
  await storageDialog.getByText(/Imported the save into slot-1\./).waitFor({ timeout: 30_000 });
  await storageDialog.getByRole("button", { name: "Close save settings" }).click();
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(1);
  };
  for (let attempt = 0; attempt < 1_200; attempt++) {
    if ((await state()).startup?.phase === "title") break;
    await advance(25);
  }
  assert.equal((await state()).startup?.phase, "title", "startup did not reach title");
  // Let the title's source fade-in fully settle before beginning the native-relative clock.
  await advance(1_000);

  const canvas = page.locator("canvas").first();
  const canvasBounds = await canvas.boundingBox();
  assert(canvasBounds, "Pixi canvas is unavailable");

  const presentation = () => page.evaluate(() => {
    const nodes = [];
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (typeof node?.label === "string" &&
          (node.label.toLowerCase().includes("shade") ||
           node.label.toLowerCase().includes("hero") ||
           node.label.toLowerCase().includes("transition"))) {
        const bounds = node.getBounds();
        nodes.push({
          label: node.label,
          visible: node.visible,
          renderable: node.renderable,
          alpha: node.alpha,
          x: bounds.x,
          y: bounds.y,
          w: bounds.width,
          h: bounds.height,
        });
      }
      if (node?.children) stack.push(...node.children);
    }
    return nodes;
  });
  const summarize = (snapshot) => ({
    mode: snapshot.mode ?? null,
    startupPhase: snapshot.startup?.phase ?? null,
    currentPoi: snapshot.currentPoi ?? null,
    locked: snapshot.locked ?? null,
    walking: snapshot.walking ?? null,
    overlayKind: snapshot.overlay?.kind ?? null,
    tutorialKey: snapshot.tutorial?.key ?? null,
    town: snapshot.town?.name ?? null,
    floor: snapshot.floor ?? null,
    currentRoomId: snapshot.currentRoomId ?? null,
    popupLabels: snapshot.popups?.scene?.stack?.map((popup) => popup.contentLabel) ?? [],
    markerVisible: snapshot.markerVisible ?? null,
    markerAlpha: snapshot.markerAlpha ?? null,
    markerDirection: snapshot.markerDirection ?? null,
    markerPosition: snapshot.markerPosition ?? null,
    slidePosition: snapshot.slidePosition ?? null,
    sceneTransform: snapshot.sceneTransform ?? null,
    camera: snapshot.camera ?? null,
  });
  const timeline = [];
  const keyStates = [];
  const shouldCapture = (timeMs) => inputs.some((input) =>
    timeMs >= input.timeMs - 2 * frameDurationMs && timeMs <= input.timeMs + 1_500);
  const captureFrame = async (frame, timeMs) => {
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      path.join(outputDirectory,
        `frame-${String(frame).padStart(4, "0")}-${Math.round(timeMs)}ms.png`),
      Buffer.from(screenshot.data, "base64"),
    );
  };

  let inputIndex = 0;
  const totalFrames = Math.ceil(durationMs / frameDurationMs);
  for (let frame = 0; frame <= totalFrames; frame++) {
    const timeMs = frame * frameDurationMs;
    const fired = [];
    while (inputIndex < inputs.length && inputs[inputIndex].timeMs <= timeMs + 0.001) {
      const input = inputs[inputIndex++];
      await page.mouse.click(canvasBounds.x + input.x, canvasBounds.y + input.y);
      fired.push(input.id);
      keyStates.push({
        input: input.id,
        frame,
        timeMs,
        beforeAdvance: await state(),
      });
    }
    const snapshot = await state();
    timeline.push({
      frame,
      timeMs,
      inputs: fired,
      state: summarize(snapshot),
      presentation: await presentation(),
    });
    if (captureScreenshots && shouldCapture(timeMs)) await captureFrame(frame, timeMs);
    if (frame < totalFrames) await advance(frameDurationMs);
  }

  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(outputDirectory, "timeline.json"), `${JSON.stringify({
    archive,
    nativeSave,
    nativeReference: {
      titleOnEnterTransitionDidFinishMs: 1_318,
      inputs,
    },
    durationMs,
    captureScreenshots,
    canvasBounds,
    keyStates,
    frames: timeline,
    errors,
  }, null, 2)}\n`);
  console.log(`journey-frame-lockstep: PASS (${timeline.length} frames; ` +
    `${inputs.length} native-timed inputs)`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
