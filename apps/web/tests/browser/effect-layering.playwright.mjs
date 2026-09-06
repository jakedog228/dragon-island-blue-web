import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";


import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/effect-layering");
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
    window.__DIB_TEST_BATTLE_SEED__ = 3;
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "ThunderWolf", level: 20 }],
      enemyTeam: [{ shortType: "Minotaur", level: 5 }],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  for (let i = 0; i < 400 && (await state()).mode !== "start"; i += 1) await advance(25);
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox);
  for (let i = 0; i < 300; i++) {
    await advance(1000 / 60);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  let ready;
  for (let i = 0; i < 1500; i += 1) {
    ready = await state();
    if (
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.panelVisible &&
      ready.activeActorId === "t0m0:ThunderWolf"
    ) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal(ready?.presentation?.state, "awaitingPlayerChoice");
  assert.equal(ready?.activeActorId, "t0m0:ThunderWolf");

  const geometry = await stageGeometry(page, canvasBox);
  const howl = ready.abilityButtons.find((button) => button.slot === 2);
  assert(howl, "Thunder Wolf's Howl card was not available in slot 2");
  const howlCss = geometry.toCss(howl.center);
  await page.mouse.click(howlCss.x, howlCss.y);

  let picking;
  for (let i = 0; i < 120; i += 1) {
    picking = await state();
    if (picking.picking) break;
    await advance(25);
  }
  assert.equal(picking?.picking, true, "Howl did not open its one-enemy target picker");
  const minotaur = picking.monsters.find((monster) => monster.id === "t1m0:Minotaur");
  assert(minotaur, "Minotaur target disappeared before selection");
  const targetCss = geometry.toCss(minotaur.targetPoint);
  await page.mouse.click(targetCss.x, targetCss.y);

  let impact;
  for (let i = 0; i < 300; i += 1) {
    impact = await state();
    const stun = impact.activeEffectNodes.find((node) => node.label === "floater:STUN!");
    const stop = impact.activeEffectNodes.find((node) => node.label === "animation:Stop");
    if (stun && stop) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  const stun = impact?.activeEffectNodes.find((node) => node.label === "floater:STUN!");
  const stop = impact?.activeEffectNodes.find((node) => node.label === "animation:Stop");
  assert(stun, `seeded Howl did not produce STUN!: ${JSON.stringify({
    presentation: impact?.presentation,
    picking: impact?.picking,
    activeActorId: impact?.activeActorId,
    activeAbilityPath: impact?.activeAbilityPath,
    effects: impact?.activeEffectNodes,
  })}`);
  assert(stop, `Howl's Stop animation did not overlap STUN!: ${JSON.stringify(impact?.activeEffectNodes)}`);
  assert(
    stop.zIndex < stun.zIndex,
    `STUN! must paint above Howl's Stop animation: ${JSON.stringify(impact.activeEffectNodes)}`,
  );
  assert.deepEqual(errors, []);

  fs.writeFileSync(path.join(outputDir, "state.json"), `${JSON.stringify(impact, null, 2)}\n`);
  // The battle ticker continuously animates the canvas. Capture its measured clip directly so
  // Playwright does not wait for an animated element to satisfy locator-stability heuristics.
  await page.screenshot({
    path: path.join(outputDir, "stun-above-stop.png"),
    clip: canvasBox,
    timeout: 120_000,
  });
  console.log("effect-layering: PASS (Howl Stop animation below STUN!, zero browser errors)");
} finally {
  await browser.close();
}
