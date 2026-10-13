

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const outputDir = path.resolve("output/replay-battle-tutorial");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    // First arrival is suppressed at Field 1. Seed 7 makes Field 2's first occurrence roll pass;
    // the level-100 party then takes WorldEncounter.allowSkip's exact easy-ordinary branch.
    window.__DIB_TEST_POI_NAME__ = "1-1_Field_1";
    window.__DIB_TEST_WORLD_POI_WINS__ = { "1-1_Field_1": 1 };
    window.__DIB_TEST_WORLD_COMPLETED_POIS__ = ["1-1_Field_1"];
    window.__DIB_TEST_WORLD_SEED__ = 7;
    window.__DIB_TEST_WORLD_PARTY__ = { size: 3, battingOrderSize: 3, levelRange: [100, 100] };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 100,
      monsterPartyLevels: [100, 100, 100],
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      // Deliberately omit the shipped typo `RevistPOI` so this save owns the first-use branch.
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"],
    };
  });

  await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173", {
    waitUntil: "domcontentloaded",
  });
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  const geometry = await stageGeometry(page, box);

  for (let index = 0; index < 600 && (await state()).startup?.phase !== "title"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  assert.equal((await state()).startup?.phase, "title");
  await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const current = await state();
    if (current.startup?.phase === "save-select" || current.mode === "world") break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  if ((await state()).startup?.phase === "save-select") await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const current = await state();
    if (current.mode === "world" && !current.locked && !current.walking) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }

  let snapshot = await state();
  assert.equal(snapshot.currentPoi, "1-1_Field_1");
  const field2 = snapshot.pois.find((poi) => poi.name === "1-1_Field_2" && poi.state === 4);
  assert(field2, `Field 2 was not selectable: ${JSON.stringify(snapshot.poiStates)}`);
  const field2Point = geometry.toCss(field2.position);
  await page.mouse.click(field2Point.x, field2Point.y);

  for (let index = 0; index < 300; index++) {
    snapshot = await state();
    if (snapshot.overlay?.kind === "popup" && snapshot.overlay.popups.depth === 1) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  snapshot = await state();
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.currentPoi, "1-1_Field_2");
  assert.equal(snapshot.refresh.completedPois.includes("1-1_Field_2"), true);
  assert.equal(snapshot.player.tutorialFlags.includes("RevistPOI"), true);
  assert.equal(snapshot.overlay?.kind, "popup");
  assert.deepEqual(snapshot.overlay.popups.stack, [{
    visible: true,
    dismissed: false,
    contentLabel: "replayBattleTutorial",
    buttons: ["Ok"],
  }]);
  await page.screenshot({ path: path.join(outputDir, "replay-battle-popup.png") });
  await advance(550);

  const okCenter = await page.evaluate(() => {
    let result = null;
    const visit = (node) => {
      if (result !== null || node.destroyed || node.visible === false) return;
      if (node.label === "popupButton:Ok") {
        const bounds = node.getBounds();
        result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return result;
  });
  assert(okCenter, "Replay Battle popup exposed no Ok button");
  await page.mouse.click(box.x + okCenter.x, box.y + okCenter.y);
  await advance(25);
  snapshot = await state();
  assert.notEqual(snapshot.overlay?.kind, "popup");
  assert.equal(snapshot.audio.lastSfx, "click");

  // The source text's promised action: touching the now-current flag forces a battle, bypassing
  // both occurrence and easy-battle skipping. No second Replay Battle popup may appear.
  snapshot = await state();
  const current = snapshot.pois.find((poi) => poi.state === 2);
  assert(current);
  const currentPoint = geometry.toCss(current.position);
  await page.mouse.click(currentPoint.x, currentPoint.y);
  for (let index = 0; index < 500 && (await state()).mode !== "battle"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  snapshot = await state();
  assert.equal(snapshot.mode, "battle");
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("replay-battle-tutorial: PASS (one-shot popup, exact shell, forced flag replay)");
} finally {
  await browser.close();
}
