// Opt-in production-ticker regression for in-memory renderer restarts. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/session-restart-realtime");
fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const expectedSaveErrors = [];
  // Which leg of the scenario was running when a page error arrived. `errors` is only asserted at
  // the very end, so without this an error raised during (say) the save-select restart reads as if
  // it came from the fail-closed checkpoint eight steps later.
  let testPhase = "boot";
  const phase = (name) => { testPhase = name; };
  // Check pageerrors at each restart boundary rather than only at the end. A teardown crash aborts
  // nothing on its own -- the scenario sails on for eight more steps and then blames the last one.
  const assertNoErrorsYet = (where) => {
    assert.deepEqual(errors, [], `uncaught page error at/before "${where}": ` + errors.join(" | "));
  };



  page.on("pageerror", (error) => errors.push(
    `pageerror [${testPhase}]: ${error?.stack ?? String(error)}`,
  ));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      if (message.text().includes("Session restart checkpoint failed")) {
        expectedSaveErrors.push(message.text());
      } else {
        errors.push(`console: ${message.text()}`);
      }
    }
  });
  await page.addInitScript(() => {
    // Deliberately do NOT install advanceTime here. This must boot as a normal rAF/ticker session.
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const waitForState = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await page.waitForTimeout(50);
    }
    throw new Error(
      `${description}; errors: ${errors.join(" | ") || "none"}; state: ${JSON.stringify(await state())}`,
    );
  };

  await waitForState((value) => value.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitForState(
    (value) =>
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" ||
      value.mode === "world" ||
      value.mode === "town",
    "title did not continue",
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await page.waitForTimeout(2_100);
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.startup?.phase === "pick-dragon",
      "new-game plot did not reach starter selection",
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  snapshot = await waitForState((value) => value.mode === "town", "initial town did not start");
  await page.waitForTimeout(2_000);
  snapshot = await state();
  assert.equal(
    await page.evaluate(() => window.__PIXI_APP__.ticker.started),
    true,
    "initial production ticker is stopped",
  );

  const initialDisplayMode = snapshot.displayMode;
  const nextDisplayMode = initialDisplayMode === "iphone" ? "ipad" : "iphone";
  const initialTextMode = snapshot.textResolutionMode;
  const nextTextMode = initialTextMode === "original" ? "modern" : "original";
  const durableBefore = await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot());
  const applySettingsAndRestart = async (displayMode, textResolutionMode, description) => {
    phase(`town-restart ${displayMode}/${textResolutionMode}`);
    await page.evaluate(({ displayMode: mode, textResolutionMode: textMode }) => {
      const key = "dib.portSettings.v1";
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({
        displayMode: mode,
        textResolutionMode: textMode,
        sound: saved.sound ?? 0.75,
        music: saved.music ?? 0.5,
      }));
    }, { displayMode, textResolutionMode });
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
    const restored = await waitForState(
      (value) =>
        value.displayMode === displayMode &&
        value.textResolutionMode === textResolutionMode &&
        value.mode === "town",
      description,
    );
    assert.deepEqual(
      await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot()),
      durableBefore,
      `${description}: town entry mutated the durable player/world state`,
    );
    assert.equal(
      await page.evaluate(() => window.__PIXI_APP__.ticker.started),
      true,
      `${description}: replacement production ticker is stopped`,
    );
    assertNoErrorsYet(description);
    return restored;
  };
  snapshot = await applySettingsAndRestart(
    nextDisplayMode,
    initialTextMode,
    "presentation restart did not resume town",
  );
  const audio = await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.audio());
  assert(audio.musicLevel > 0, `presentation restart restored a muted music level: ${JSON.stringify(audio)}`);
  assert.equal(audio.musicPaused, false, `presentation restart left music paused: ${JSON.stringify(audio)}`);
  assert(
    audio.musicAssetName === "Field1.mp3" || audio.musicAssetName === "Town1.mp3",
    `presentation restart restored the wrong world music: ${JSON.stringify(audio)}`,
  );
  snapshot = await applySettingsAndRestart(
    initialDisplayMode,
    initialTextMode,
    "reciprocal display restart did not resume town",
  );
  snapshot = await applySettingsAndRestart(
    initialDisplayMode,
    nextTextMode,
    "text-only restart did not resume town",
  );
  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: path.join(outputDir, "presentation-restart.png"),
    timeout: 120_000,
  });

  phase("main-menu restart");
  await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.mainMenu());
  snapshot = await waitForState(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "Main Menu restart did not reach title",
  );
  assert.equal(
    await page.evaluate(() => window.__PIXI_APP__.ticker.started),
    true,
    "Main Menu restart misclassified the app-owned advanceTime hook and stopped the ticker",
  );
  await page.waitForTimeout(1_000);
  assert.equal((await state()).startup?.phase, "title", "title did not remain stable");
  await page.screenshot({
    path: path.join(outputDir, "main-menu-restart.png"),
    timeout: 120_000,
  });
  await page.keyboard.press("Enter");
  snapshot = await waitForState(
    (value) => value.mode === "start" && value.startup?.phase === "save-select",
    "restarted title was not interactive",
  );
  const startupDisplayMode = snapshot.displayMode === "iphone" ? "ipad" : "iphone";
  await page.evaluate((displayMode) => {
    const key = "dib.portSettings.v1";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...saved, displayMode }));
  }, startupDisplayMode);
  // The save picker publishes `phase: "save-select"` from the SAME presentation callback that
  // starts `SourcePopupMenu.present()`'s 0.5s dim fade, so this restart is deliberately issued
  // while that ticker-backed tween is still live -- that is the teardown ordering under test.
  phase("save-select restart (popup dim fade live)");
  assertNoErrorsYet("save-select restart");
  await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
  snapshot = await waitForState(
    (value) =>
      value.mode === "start" &&
      value.displayMode === startupDisplayMode &&
      value.startup?.phase === "save-select",
    "startup Options rebuild did not return directly to save selection",
  );
  assertNoErrorsYet("save-select restart");

  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, `saved slot 1 is unavailable after startup rebuild: ${JSON.stringify(snapshot.startup)}`);
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, "restarted save-select canvas is missing");
  const geometry = await stageGeometry(page, canvasBox);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);
  phase("slot-1 resume from restarted save picker");
  snapshot = await waitForState((value) => value.mode === "town", "saved town did not relaunch");
  assertNoErrorsYet("slot-1 resume");
  await page.waitForTimeout(1_500);
  const beforeFailedRestart = await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot());
  const activeDisplayMode = snapshot.displayMode;
  const rejectedDisplayMode = activeDisplayMode === "iphone" ? "ipad" : "iphone";
  await page.evaluate((displayMode) => {
    window.__DIB_PRE_FAILURE_APP__ = window.__PIXI_APP__;
    const key = "dib.portSettings.v1";
    const savedSettings = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...savedSettings, displayMode }));
    for (let index = 0; index < localStorage.length; index++) {
      const saveKey = localStorage.key(index);
      if (!saveKey?.startsWith("dib-save-v1:") || !saveKey.endsWith(":slot-1")) continue;
      const envelope = JSON.parse(localStorage.getItem(saveKey));
      envelope.revision += 1;
      localStorage.setItem(saveKey, JSON.stringify(envelope));
      return;
    }
    throw new Error("could not find slot-1 envelope for conflict fixture");
  }, rejectedDisplayMode);
  phase("fail-closed checkpoint restart");
  await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
  await page.waitForTimeout(500);
  snapshot = await state();
  assert.equal(snapshot.mode, "town", "failed checkpoint destroyed the live town");
  assert.equal(snapshot.displayMode, activeDisplayMode, "failed checkpoint applied a renderer rebuild");
  assert.equal(
    await page.evaluate(() => window.__PIXI_APP__ === window.__DIB_PRE_FAILURE_APP__),
    true,
    "failed checkpoint replaced the live Pixi application",
  );
  assert.deepEqual(
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot()),
    beforeFailedRestart,
    "failed checkpoint rewound or mutated live state",
  );
  assert.match(
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.saveHealth()),
    /^FAILING:/,
  );
  assert.equal(expectedSaveErrors.length, 1, JSON.stringify(expectedSaveErrors));
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(
    "session-restart-realtime: PASS " +
    "(town both display directions + text-only + save-select resume + fail-closed save)",
  );
} finally {
  await browser.close();
}
