import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/effect-text-blocked");




const battleSeed = Number(process.env.DIB_BLOCKED_SEED ?? 5);
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
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript((seed) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_BATTLE_SEED__ = seed;
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "FireCub", level: 50 }],
      enemyTeam: [
        { shortType: "FireCub", level: 1 },
        { shortType: "CrabKing", level: 1 },
      ],
    };
  }, battleSeed);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  for (let i = 0; i < 300 && (await state()).mode !== "start"; i++) await page.waitForTimeout(100);
  assert.equal((await state()).mode, "start", `boot stalled: ${errors.join(" | ")}`);
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  for (let i = 0; i < 300; i++) {
    await advance(1000 / 60);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  let ready;
  for (let i = 0; i < 1200; i++) {
    ready = await state();
    if (
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.activeActorId === "t0m0:FireCub" &&
      ready.panelVisible &&
      ready.abilityButtons.length > 0
    ) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert(
    ready.panelVisible && ready.abilityButtons.length > 0,
    `high-level FireCub never received the choice panel: ${JSON.stringify(ready.presentation)}`,
  );
  const attack = ready.abilityButtons.find((button) => button.abilityPath === "Offensive.Attack");
  assert(attack, `Attack card missing: ${JSON.stringify(ready.abilityButtons)}`);
  const { toCss } = await stageGeometry(page, canvasBox);
  let click = toCss(attack.center);
  await page.mouse.click(click.x, click.y);
  for (let i = 0; i < 100 && (await state()).presentation.state !== "targetPicking"; i++) {
    await advance(25);
    await page.waitForTimeout(1);
  }
  const picking = await state();
  assert.equal(picking.presentation.state, "targetPicking");
  const plain = picking.monsters.find((monster) => monster.id === "t1m0:FireCub");
  const crab = picking.monsters.find((monster) => monster.id === "t1m1:CrabKing");
  assert(plain && crab);
  click = toCss(plain.targetPoint);
  await page.mouse.click(click.x, click.y);

  let queued;
  let blocked;
  for (let i = 0; i < 40; i++) {
    queued = await state();
    blocked = queued.activeEffectNodes.find((node) => node.label === "floater:Blocked");
    if (blocked) break;
    await advance(10);
    await page.waitForTimeout(1);
  }
  assert(blocked, `EasyTarget did not redirect with seed ${battleSeed}: ${JSON.stringify(queued.presentation)}`);
  assert.equal(queued.presentation.state, "phaseDelay", "Blocked feedback must begin before target impact");
  const queuedCrab = queued.monsters.find((monster) => monster.id === crab.id);
  assert(queuedCrab);
  const expectedCenter = {
    x: queuedCrab.effectRect.x + queuedCrab.effectRect.width / 2,
    y: queuedCrab.effectRect.y + queuedCrab.effectRect.height / 2,
  };
  assert(Math.abs(blocked.x - expectedCenter.x) < 0.05, `Blocked x ${blocked.x} != ${expectedCenter.x}`);
  assert(Math.abs(blocked.y - expectedCenter.y) < 0.05, `Blocked y ${blocked.y} != ${expectedCenter.y}`);
  await advance(25); // render one deterministic frame with the newly-added queue-time label
  await page.screenshot({
    path: path.join(outputDir, "blocked-queue-time.png"),
    timeout: 120_000,
  });
  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(queued, null, 2) + "\n");
  assert.deepEqual(errors, []);
  console.log("effect-text-blocked: PASS (redirect, queue timing, target center, and localized floater)");
} finally {
  await browser.close();
}
