import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/combat-modifiers");
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
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "BatSquirrel", level: 5 }],
      enemyTeam: [{ shortType: "SnowCub", level: 5 }],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  for (let i = 0; i < 300 && (await state()).mode !== "start"; i++) {
    await page.waitForTimeout(100);
  }
  assert.equal((await state()).mode, "start", `boot stalled: ${errors.join(" | ")}`);
  console.log("combat-modifiers: booted");
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  for (let i = 0; i < 300; i++) {
    await advance(1000 / 60);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let i = 0; i < 1200; i++) {
    const current = await state();
    if (current.presentation?.state === "awaitingPlayerChoice" && current.panelVisible) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  const ready = await state();
  console.log(`combat-modifiers: turn=${ready.presentation?.state} actor=${ready.activeActorId}`);
  assert.equal(ready.activeActorId, "t0m0:BatSquirrel");
  const batBefore = ready.monsters.find((monster) => monster.id === ready.activeActorId);
  assert(batBefore);
  assert.equal(batBefore.haste, 0);
  assert.deepEqual(batBefore.activeBuffs, []);

  const { toCss } = await stageGeometry(page, canvasBox);
  const haste = ready.abilityButtons.find((button) => button.abilityPath === "Defensive.HasteUp");
  assert(haste, `Haste Up button missing: ${JSON.stringify(ready.abilityButtons)}`);
  const hasteCard = toCss(haste.center);
  await page.mouse.click(hasteCard.x, hasteCard.y);
  console.log("combat-modifiers: haste card clicked");
  let applied;
  for (let i = 0; i < 200; i++) {
    applied = await state();
    const bat = applied.monsters.find((monster) => monster.id === "t0m0:BatSquirrel");
    const floater = applied.activeEffectNodes.find((node) => node.label === "floater:Haste UP:37");
    if (bat?.activeBuffs.some((buff) => buff.stackName === "hasteUp") && floater) break;
    await advance(25);
    await page.waitForTimeout(1);
  }
  const batAfter = applied.monsters.find((monster) => monster.id === "t0m0:BatSquirrel");
  assert(batAfter);
  assert.equal(batAfter.haste, Math.fround(-0.6));
  assert.equal(batAfter.activeBuffs.length, 1);
  assert.equal(batAfter.activeBuffs[0].duration, 500);
  assert.equal(batAfter.activeBuffs[0].stackName, "hasteUp");
  const floaterStart = applied.activeEffectNodes.find((node) => node.label === "floater:Haste UP:37");
  assert(floaterStart, "source-formatted Haste UP:37 floater did not appear at impact");
  const animationStart = applied.activeEffectNodes.find((node) => node.label === "animation:HasteUp");
  assert(animationStart, "HasteUp move animation did not appear with its parameter text");
  assert(
    animationStart.zIndex < floaterStart.zIndex,
    `ParameterEffectBuilder text must paint above authored move effects: ${JSON.stringify(applied.activeEffectNodes)}`,
  );
  assert.equal(floaterStart.alpha, 1);
  assert.deepEqual(errors, []);
  console.log("combat-modifiers: state assertions passed");

  await page.screenshot({
    path: path.join(outputDir, "haste-applied.png"),
    timeout: 120_000,
  });
  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(applied, null, 2) + "\n");


  await advance(1000);
  const afterOneSecond = (await state()).activeEffectNodes.find((node) => node.label === "floater:Haste UP:37");
  assert(afterOneSecond, "floater disappeared before its character-count lifetime");
  assert(Math.abs((floaterStart.y - afterOneSecond.y) - 30 * (1000 / 3300)) < 0.15);
  assert.equal(afterOneSecond.alpha, 1);
  await advance(1850);
  const fading = (await state()).activeEffectNodes.find((node) => node.label === "floater:Haste UP:37");
  assert(fading, "floater disappeared before the final fade interval");
  assert(fading.alpha < 1 && fading.alpha > 0);
  await advance(500);
  assert.equal(
    (await state()).activeEffectNodes.some((node) => node.label === "floater:Haste UP:37"),
    false,
    "floater survived beyond its 3.3s source lifetime",
  );
  assert.deepEqual(errors, []);
  console.log("combat-modifiers: PASS (Haste text layering, motion, fade, duration, and browser-visible buff state)");
} finally {
  await browser.close();
}
