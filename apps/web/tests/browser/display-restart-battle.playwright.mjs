// Opt-in display-cache regression: switch idioms in-process and rebuild a fixed encounter.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter } from "./fixtures.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/display-restart-battle");
fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
  });
  await pinEncounter(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const waitForState = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await page.waitForTimeout(50);
      await advance(25);
    }
    throw new Error(
      `${description}; errors: ${errors.join(" | ") || "none"}; state: ${JSON.stringify(await state())}`,
    );
  };
  const expectedEnemyCenterY = (mode) => mode === "iphone" ? 125 : 157;
  const assertEnemyCenters = (snapshot) => {
    const enemies = snapshot.enemyMemberPositions.filter(({ parented }) => parented);
    assert.equal(enemies.length, 3, `expected three visible enemies: ${JSON.stringify(enemies)}`);
    const expected = expectedEnemyCenterY(snapshot.displayMode);
    for (const enemy of enemies) {
      assert(
        Math.abs(enemy.fieldCenterY - expected) < 0.01,
        `${enemy.id} center y ${enemy.fieldCenterY} retained the wrong idiom offset; expected ${expected}`,
      );
    }
  };

  let snapshot = await waitForState(
    (value) => value.startup?.phase === "title",
    "title did not become interactive",
  );
  const initialDisplayMode = snapshot.displayMode;
  const nextDisplayMode = initialDisplayMode === "iphone" ? "ipad" : "iphone";
  await page.evaluate((displayMode) => {
    const key = "dib.portSettings.v1";
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({
      displayMode,
      textResolutionMode: saved.textResolutionMode ?? "modern",
      sound: saved.sound ?? 0.75,
      music: saved.music ?? 0.5,
    }));
  }, nextDisplayMode);
  await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
  snapshot = await waitForState(
    (value) =>
      value.displayMode === nextDisplayMode &&
      value.startup?.phase === "save-select",
    "display restart did not rebuild the startup shell",
  );
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, "slot 1 is unavailable after the display restart");
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "startup canvas is missing");
  const geometry = await stageGeometry(page, canvasBox);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await advance(500);
  await page.mouse.click(slotPoint.x, slotPoint.y);
  snapshot = await waitForState(
    (value) => value.mode === "battle" && value.presentation?.state !== "building",
    "fixed battle did not start after the display restart",
  );
  await advance(2_000);
  snapshot = await state();
  assertEnemyCenters(snapshot);
  await page.screenshot({
    path: path.join(outputDir, `enemy-centers-${nextDisplayMode}.png`),
    timeout: 120_000,
  });
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(`display-restart-battle: PASS (${initialDisplayMode} -> ${nextDisplayMode})`);
} finally {
  await browser.close();
}
