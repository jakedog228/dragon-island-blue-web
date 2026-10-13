import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/contract-swipe-nearest");
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

  // Presence at boot selects the app's deterministic ticker harness; main.ts replaces this shim.
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_BATTLE_SEED__ = 7;
  });
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
  await page.waitForTimeout(1000);
  let reachedBattle = false;
  for (let i = 0; i < 1800; i++) {
    await page.evaluate(() => window.advanceTime(1000 / 60));
    if (i % 10 === 0) {
      const current = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
      if (current.mode === "battle") {
        reachedBattle = true;
        break;
      }
      await page.waitForTimeout(1);
    }
  }
  if (!reachedBattle) {
    console.error("build state", await page.evaluate(() => window.render_game_to_text()), errors);
    await page.screenshot({ path: path.join(outputDir, "build-stalled.png") });
  }
  assert.equal(reachedBattle, true, "battle scene did not finish building under deterministic stepping");

  const stepFrames = async (count) => {
    for (let i = 0; i < count; i++) {
      await page.evaluate(() => window.advanceTime(1000 / 60));
    }
  };
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));

  for (let i = 0; i < 900; i++) {
    await stepFrames(1);
    if (i % 10 === 0) {
      const current = await state();
      if (current.presentation.state === "awaitingPlayerChoice" && current.panelVisible) break;
      await page.waitForTimeout(1);
    }
  }
  const before = await state();
  assert.equal(before.presentation.state, "awaitingPlayerChoice");
  assert.equal(before.panelVisible, true);
  assert.equal(before.friendlyPopForwardCount, 0, "player monster must not pop before a move is committed");
  const minotaurBefore = before.monsters.find((monster) => monster.id.includes("Minotaur"));
  assert(minotaurBefore);

  // Slot 1 is leftToRight. Source single-enemy swipe resolution first requires the gesture-bounds
  // midpoint to hit an eligible enemy's unexpanded monster-node bounds, then chooses the nearest
  // hit. Drive the stroke through Minotaur's live target geometry; it is deliberately not first in
  // queue order. Keeping the whole lane inside the node also prevents this success contract from
  // accidentally exercising the separately-covered empty-hit/notAllowed branch.
  assert(minotaurBefore.targetPoint && minotaurBefore.targetSize);
  const { toCss } = await stageGeometry(page, canvasBox);
  const halfLane = Math.min(25, minotaurBefore.targetSize.w * 0.4);
  const lane = toCss({ x: minotaurBefore.targetPoint.x - halfLane, y: minotaurBefore.targetPoint.y });
  const laneEnd = toCss({ x: minotaurBefore.targetPoint.x + halfLane, y: minotaurBefore.targetPoint.y });
  await page.mouse.move(lane.x, lane.y);
  await page.mouse.down();
  for (let i = 1; i <= 18; i++) {
    await page.mouse.move(lane.x + ((laneEnd.x - lane.x) * i) / 18, lane.y, { steps: 1 });
  }
  await page.mouse.up();
  await page.waitForTimeout(25);
  await stepFrames(45);

  const after = await state();
  const minotaurAfter = after.monsters.find((monster) => monster.id.includes("Minotaur"));
  const sparkAfter = after.monsters.find((monster) => monster.id.includes("Spark"));
  assert(minotaurAfter && sparkAfter);
  assert.equal(after.panelVisible, false, "successful swipe removes/hides the turn panel");
  assert.equal(after.friendlyPopForwardCount, 1, "queueing the selected move starts pop-forward immediately");
  assert.equal(after.friendlyPopForwardLayers.length, 1, "active spotlight layer was not exposed");
  assert.equal(after.friendlyPopForwardLayers[0].zIndex, 2, "friendly spotlight must use source BattleNode z=2");
  assert.equal(
    after.friendlyPopForwardLayers[0].parentIsFriendlyDisplay,
    false,
    "friendly spotlight must be a BattleNode child below friendlyTeamDisplay z=3",
  );
  assert(minotaurAfter.hp < minotaurAfter.maxHp, "gesture midpoint selects Minotaur and deals damage");
  assert.equal(sparkAfter.hp, 147, "queue-nearer Spark must not be selected");
  assert.equal(errors.length, 0, errors.join("\n"));

  await page.screenshot({ path: path.join(outputDir, "impact-overlap.png"), timeout: 120_000 });

  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(after, null, 2) + "\n");
  console.log("swipe-nearest: PASS (selection timing and impact overlap)");
} finally {
  await browser.close();
}
