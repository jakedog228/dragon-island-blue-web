// Post-fix visual survey: field + stars + localized names, turn panel, living-info popup.
// Deterministic stepping via window.advanceTime; screenshots must be EYEBALLED (STATUS.md #4).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/fidelity-survey");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.addInitScript(() => { window.advanceTime = () => Promise.resolve(); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => {
    if (typeof window.render_game_to_text !== "function") return false;
    return JSON.parse(window.render_game_to_text()).mode === "start";
  }, undefined, { timeout: 30_000 });
  for (let i = 0; i < 300; i++) await page.evaluate(() => window.advanceTime(1000 / 60));
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.mouse.down();
  await page.evaluate(() => window.advanceTime(1000 / 60));
  await page.evaluate(() => window.advanceTime(1000 / 60));
  await page.mouse.up();
  await page.waitForTimeout(500);
  let reachedBattle = false;
  for (let i = 0; i < 1800; i++) {
    await page.evaluate(() => window.advanceTime(1000 / 60));
    if (i % 10 === 0) {
      const current = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
      if (current.mode === "battle") { reachedBattle = true; break; }
      await page.waitForTimeout(1);
    }
  }
  assert.equal(reachedBattle, true, "battle scene did not build");

  const step = async (frames) => {
    for (let i = 0; i < frames; i++) await page.evaluate(() => window.advanceTime(1000 / 60));
  };
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));

  // Point-space -> canvas. This used to hardcode a 480x320 letterbox, which is the iPhone tier;
  // the app runs in iPad mode (512x384 points), so every mapped click landed off-target and the
  // living-info popup never opened. `stageGeometry` reads the geometry the app actually reports.
  const geometry = await stageGeometry(page, canvasBox);
  const toCanvas = (px, py) => geometry.toCss({ x: px, y: py });

  // Shot 1: ~7s in — rarity stars are at rest (entry ends ~5.2s), panel is up for WhiteDragonling.
  await step(420);
  // Generous timeout: swiftshader occasionally stalls >30s producing the first battle frame.
  await page.screenshot({ path: path.join(outputDir, "01-field-stars.png"), timeout: 120_000 });
  const s1 = await state();
  fs.writeFileSync(path.join(outputDir, "01-state.json"), JSON.stringify(s1, null, 2));

  // Shot 2: tap the front (friendly) turn-order entry -> LivingInfoDisplay popup.
  // Column root Cocos (0,315) -> Pixi y=5; slot i rests at (12, (i+1)*34) local; the 24pt icon
  // extends UP from the entry origin (Cocos anchor (0,0), Y-up), so its center is origin - 12.
  assert.equal(s1.queue[0].startsWith("t0"), true, "front of queue should be the friendly actor");
  const entry = toCanvas(12 + 12, 5 + 34 - 12);
  await page.mouse.click(entry.x, entry.y);
  // The popup mounts after real async work (first-use sprite fetches) — wait for it before
  // stepping the pop-in tween, or the card can sit at scaleY 0 in the shot.
  // The ticker is STOPPED under the deterministic harness, so a wall-clock waitForFunction can
  // never observe progress — the popup only mounts as stepped frames run. Step for it instead.
  for (let i = 0; i < 400 && (await state()).activePopup === null; i++) await step(1);
  assert((await state()).activePopup !== null, "living-info popup did not open");
  await step(30);
  await page.waitForTimeout(300);
  await step(30);
  await page.screenshot({ path: path.join(outputDir, "02-living-info.png"), timeout: 120_000 });
  fs.writeFileSync(path.join(outputDir, "02-state.json"), JSON.stringify(await state(), null, 2));

  // Shot 3: tap a stat row inside the card -> the stacked Stat<Name>Info message popup. This point
  // lands on the HP row (the shot shows "Max HP"); any stat exercises the same stacking path, and
  // the survey asserts nothing about which one. Content layout is deterministic, so the point is
  // stable run to run. (Comment previously claimed "Attack" — it never hit that icon.)
  const statIcon = toCanvas(155, 117);
  await page.mouse.click(statIcon.x, statIcon.y);
  await step(30);
  await page.waitForTimeout(300);
  await step(30);
  await page.screenshot({ path: path.join(outputDir, "03-stat-info.png"), timeout: 120_000 });
  fs.writeFileSync(path.join(outputDir, "03-state.json"), JSON.stringify(await state(), null, 2));

  console.log("errors:", errors);
} finally {
  await browser.close();
}
