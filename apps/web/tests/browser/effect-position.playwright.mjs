import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/effect-position");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

const allCases = [
  { slot: 2, targetIndex: 0, effectPrefix: "melee:", screenshotDelayMs: 125, name: "outrage-minotaur" },
  { slot: 2, targetIndex: 1, effectPrefix: "melee:", screenshotDelayMs: 125, name: "outrage-spark" },
  { slot: 2, targetIndex: 2, effectPrefix: "melee:", screenshotDelayMs: 125, name: "outrage-unhappy-bird" },
  { slot: 3, targetIndex: 1, effectPrefix: "animation:Air", screenshotDelayMs: 400, name: "sonic-blast-spark" },
];
const cases = process.env.DIB_EFFECT_CASE
  ? allCases.filter((scenario) => scenario.name === process.env.DIB_EFFECT_CASE)
  : allCases;
assert(cases.length > 0, `unknown DIB_EFFECT_CASE: ${process.env.DIB_EFFECT_CASE}`);

try {
  for (const scenario of cases) {
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
    await page.waitForFunction(() => typeof window.render_game_to_text === "function");
    const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
    const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
    const canvasBox = await page.locator("canvas").first().boundingBox();
    assert(canvasBox);

    while ((await state()).mode !== "start") await advance(100);
    for (let i = 0; i < 300; i++) {
      await advance(10);
      if (i % 20 === 0) await page.waitForTimeout(10);
    }
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    const { toCss } = await stageGeometry(page, canvasBox);
    for (let i = 0; i < 1000; i++) {
      const current = await state();
      if (
        current.mode === "battle" &&
        current.presentation?.state === "awaitingPlayerChoice" &&
        current.panelVisible &&
        current.activeActorId === "t0m2:WhiteDragonling" &&
        current.abilityButtons?.some((button) => button.slot === scenario.slot)
      ) break;
      await advance(50);
      if (i % 20 === 0) await page.waitForTimeout(1);
    }
    const ready = await state();
    assert.equal(ready.activeActorId, "t0m2:WhiteDragonling");
    assert.equal(ready.panelVisible, true);

    const abilityButton = ready.abilityButtons.find((button) => button.slot === scenario.slot);
    assert(abilityButton, `${scenario.name}: missing ability slot ${scenario.slot}`);
    const ability = toCss(abilityButton.center);
    await page.mouse.click(ability.x, ability.y);
    for (let i = 0; i < 100 && (await state()).presentation.state !== "targetPicking"; i++) {
      await advance(25);
      await page.waitForTimeout(1);
    }
    const picking = await state();
    assert.equal(picking.presentation.state, "targetPicking", `${scenario.name}: ability card did not open target picker`);
    const enemies = picking.monsters.filter((monster) => monster.team === 1);
    const target = enemies[scenario.targetIndex];
    assert(target, `${scenario.name}: missing target index ${scenario.targetIndex}`);
    const targetClick = toCss(target.targetPoint);
    await page.mouse.click(targetClick.x, targetClick.y);

    let impact;
    let effect;
    for (let i = 0; i < 200; i++) {
      impact = await state();
      effect = impact.activeEffectNodes.find((node) => node.label.startsWith(scenario.effectPrefix));
      if (effect) break;
      await advance(25);
      await page.waitForTimeout(1);
    }
    assert(effect, `${scenario.name}: expected attack effect never appeared`);
    const impactedTarget = impact.monsters.find((monster) => monster.id === target.id);
    assert(impactedTarget);


    assert(impactedTarget.effectRect, `${scenario.name}: target exposes no effectRect`);
    const expected = {
      x: impactedTarget.effectRect.x + impactedTarget.effectRect.width / 2,
      y: impactedTarget.effectRect.y + impactedTarget.effectRect.height / 2,
    };
    assert(Math.abs(effect.x - expected.x) < 0.05, `${scenario.name}: effect x ${effect.x} != ${expected.x}`);
    assert(Math.abs(effect.y - expected.y) < 0.05, `${scenario.name}: effect y ${effect.y} != ${expected.y}`);
    // Move off the first (often nearly-empty) wipe/animation frame so the screenshot proves the
    // artwork itself is on the intended sprite, not merely that its invisible node is centered.
    await advance(scenario.screenshotDelayMs);
    impact = await state();
    await page.screenshot({ path: path.join(outputDir, `${scenario.name}.png`), timeout: 120_000 });
    fs.writeFileSync(path.join(outputDir, `${scenario.name}.json`), JSON.stringify(impact, null, 2));
    assert.deepEqual(errors, [], `${scenario.name}: browser errors`);
    await page.close();
  }
  console.log(`effect-position: PASS (${cases.map((scenario) => scenario.name).join(", ")})`);
} finally {
  await browser.close();
}
