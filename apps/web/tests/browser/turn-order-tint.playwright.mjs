


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/turn-order-tint");
fs.mkdirSync(outputDir, { recursive: true });

// turnOrderLabelFill(1, enemyNameColor(slot)) — displayShared.ts's ×0.75 vmul, precomputed so a
// tint regression cannot silently track a broken source table.
const DIM = { slot0: 0x7070bf, slot1: 0xbf4b4b, slot2: 0x4bbf4b };
const GREY = 0xbfbfbf; // ×0.75 of the white unmapped-enemy fallback — the bug's signature

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

function enemyEntries(snapshot) {
  return snapshot.turnOrderEntries.filter((entry) => entry.team === 1);
}

function assertNoGrey(snapshot, context) {
  for (const entry of enemyEntries(snapshot)) {
    assert.notEqual(
      entry.labelFill,
      GREY,
      `${context}: enemy sidebar entry ${entry.id} is grey (unmapped fallback): ${JSON.stringify(snapshot.turnOrderEntries)}`,
    );
  }
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "FireCub", level: 50 }],
      enemyTeam: [
        { shortType: "Minotaur", level: 1 }, // t1m0, active, color slot 0
        { shortType: "Spark", level: 1 }, // t1m1, active, color slot 1 -- the kill target
        { shortType: "Kingpen", level: 1 }, // t1m2, active, color slot 2
        { shortType: "SnowCub", level: 1 }, // t1m3, the sole bench reserve -> promoted into slot 1
      ],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  for (let i = 0; i < 300 && (await state()).mode !== "start"; i++) await page.waitForTimeout(100);
  assert.equal((await state()).mode, "start", `boot stalled: ${errors.join(" | ")}`);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  const { toCss } = await stageGeometry(page, canvasBox);

  // FireCub's choice phase — level-1 enemies may legitimately act first (tolerant wait, the
  // repo-wide idiom). Their trivial hits cannot kill a level-50 FireCub.
  let ready;
  for (let i = 0; i < 2000; i++) {
    ready = await state();
    if (
      ready.mode === "battle" &&
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.panelVisible &&
      ready.activeActorId === "t0m0:FireCub" &&
      ready.abilityButtons?.some((button) => button.abilityPath === "Offensive.Attack")
    ) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal(ready.activeActorId, "t0m0:FireCub", `FireCub's choice never opened: ${JSON.stringify(ready?.presentation)}`);
  console.log("turn-order-tint: FireCub's turn, panel visible");

  // Baseline: the three ACTIVE enemies hold join-order slots 0/1/2; the bench reserve must not be
  // in the sidebar at all (the engine seeds only active members into the queue).
  const initialFills = new Map(enemyEntries(ready).map((entry) => [entry.id, entry.labelFill]));
  assert.equal(initialFills.get("t1m0:Minotaur"), DIM.slot0, `t1m0 slot-0 tint: ${JSON.stringify(ready.turnOrderEntries)}`);
  assert.equal(initialFills.get("t1m1:Spark"), DIM.slot1, `t1m1 slot-1 tint: ${JSON.stringify(ready.turnOrderEntries)}`);
  assert.equal(initialFills.get("t1m2:Kingpen"), DIM.slot2, `t1m2 slot-2 tint: ${JSON.stringify(ready.turnOrderEntries)}`);
  assert(!initialFills.has("t1m3:SnowCub"), `bench reserve leaked into the sidebar: ${JSON.stringify(ready.turnOrderEntries)}`);
  assertNoGrey(ready, "baseline");
  console.log("turn-order-tint: baseline slot tints confirmed (blue/red/green, no grey, no bench leak)");

  // Kill the slot-1 holder: Attack card -> target picker -> t1m1:Spark.
  const attack = ready.abilityButtons.find((button) => button.abilityPath === "Offensive.Attack");
  assert(attack, `Attack card missing: ${JSON.stringify(ready.abilityButtons)}`);
  let click = toCss(attack.center);
  await page.mouse.click(click.x, click.y);
  for (let i = 0; i < 200 && (await state()).presentation.state !== "targetPicking"; i++) {
    await advance(25);
    await page.waitForTimeout(1);
  }
  const picking = await state();
  assert.equal(picking.presentation.state, "targetPicking", "Attack did not open the target picker");
  const target = picking.monsters.find((monster) => monster.id === "t1m1:Spark");
  assert(target, `Spark target missing: ${JSON.stringify(picking.monsters)}`);
  click = toCss(target.targetPoint);
  await page.mouse.click(click.x, click.y);
  console.log("turn-order-tint: Attack cast on t1m1:Spark (slot 1)");

  // Wait for the promotion to reach the sidebar: the reserve joins the engine queue at engine
  // resolution, its entry whenever a refresh next executes -- exactly the raced boundary under
  // test, so no assumptions about WHICH refresh creates it.
  let promoted;
  for (let i = 0; i < 1200; i++) {
    promoted = await state();
    if (enemyEntries(promoted).some((entry) => entry.id === "t1m3:SnowCub")) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert(
    enemyEntries(promoted).some((entry) => entry.id === "t1m3:SnowCub"),
    `promoted reserve never entered the sidebar: ${JSON.stringify(promoted.turnOrderEntries)}`,
  );
  console.log("turn-order-tint: promoted reserve t1m3:SnowCub entered the sidebar");
  // NOT locator.screenshot(): its "element is stable" check needs steady rAF frames, and with the
  // harness ticker stopped headless SwiftShader delivers them seconds apart, starving the check
  // forever. Plain page.screenshot works but needs the repo-wide 120s budget — SwiftShader takes
  // over 30s to compose the first capture (see random-roster-smoke).
  await page.screenshot({ path: path.join(outputDir, "promotion-entered.png"), timeout: 120_000 });

  // Settle: run past every queued refresh/warp/front-change animation AND the next full turn's
  // queue commit (pacing 1s/2.25s + phase 0.5s + warps). Pre-fix, a raced creation stays grey
  // through all of this -- permanence is the bug.
  for (let i = 0; i < 240; i++) {
    await advance(25);
    if (i % 40 === 0) await page.waitForTimeout(1);
  }
  const settled = await state();
  fs.writeFileSync(path.join(outputDir, "settled-state.json"), JSON.stringify(settled, null, 2) + "\n");
  const settledEnemies = enemyEntries(settled);
  const snow = settledEnemies.find((entry) => entry.id === "t1m3:SnowCub");
  assert(snow, `promoted reserve fell OUT of the sidebar during settle: ${JSON.stringify(settled.turnOrderEntries)}`);
  assert.equal(
    snow.labelFill,
    DIM.slot1,
    `promoted reserve must inherit the freed slot-1 tint (grey = the raced white fallback): ${JSON.stringify(settledEnemies)}`,
  );
  const survivors = new Map(settledEnemies.map((entry) => [entry.id, entry.labelFill]));
  assert.equal(survivors.get("t1m0:Minotaur"), DIM.slot0, `t1m0 kept slot 0: ${JSON.stringify(settledEnemies)}`);
  assert.equal(survivors.get("t1m2:Kingpen"), DIM.slot2, `t1m2 kept slot 2: ${JSON.stringify(settledEnemies)}`);
  assert(!survivors.has("t1m1:Spark"), `dead t1m1 still in the live sidebar: ${JSON.stringify(settledEnemies)}`);
  assertNoGrey(settled, "settled");

  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors)}`);
  await page.screenshot({ path: path.join(outputDir, "settled.png"), timeout: 120_000 });
  console.log("turn-order-tint: PASS (baseline slots, promotion inherits freed slot, no grey, no errors)");
} finally {
  await browser.close();
}
