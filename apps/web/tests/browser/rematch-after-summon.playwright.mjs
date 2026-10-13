


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/rematch-after-summon");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

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


      playerTeam: [{ shortType: "Kaguya", level: 30 }],
      enemyTeam: [{ shortType: "Minotaur", level: 1 }],
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
  const geometry = await stageGeometry(page, canvasBox);

  // ---- Battle 1, turn 1: cast Puppet so the roster registers a mid-battle summon. -------------
  let ready;
  for (let i = 0; i < 2000; i++) {
    ready = await state();
    if (
      ready.mode === "battle" &&
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.panelVisible &&
      ready.activeActorId === "t0m0:Kaguya" &&
      ready.abilityButtons?.some((button) => button.abilityPath === "Utility.AddMonsterFromEnemyTeam")
    ) {
      break;
    }
    await advance(25);
  }
  assert.equal(ready.activeActorId, "t0m0:Kaguya", `Kaguya's choose phase never opened: ${JSON.stringify(ready?.presentation)}`);

  const card = ready.abilityButtons.find((b) => b.abilityPath === "Utility.AddMonsterFromEnemyTeam");
  assert(card, `Puppet card not found among: ${JSON.stringify(ready.abilityButtons)}`);
  const abilityClick = geometry.toCss(card.center);
  await page.mouse.click(abilityClick.x, abilityClick.y);

  let picking;
  for (let i = 0; i < 200; i++) {
    picking = await state();
    if (picking.presentation?.state === "targetPicking") break;
    await advance(25);
  }
  assert.equal(picking.presentation.state, "targetPicking", "Puppet did not open the target picker");
  const target = picking.monsters.find((m) => m.id === "t1m0:Minotaur");
  assert(target, `enemy target not found: ${JSON.stringify(picking.monsters)}`);
  const targetClick = geometry.toCss(target.targetPoint);
  await page.mouse.click(targetClick.x, targetClick.y);

  // The summon (t0m1:Minotaur — engine nextConstructionIndex starts at team length 1) must join
  // team 0; that roster registration is exactly the state the rematch used to choke on.
  let afterAdd;
  for (let i = 0; i < 400; i++) {
    afterAdd = await state();
    if (afterAdd.monsters.some((m) => m.team === 0 && m.id === "t0m1:Minotaur")) break;
    await advance(25);
  }
  assert(
    afterAdd.monsters.some((m) => m.team === 0 && m.id === "t0m1:Minotaur"),
    `Puppet's summon never joined team 0: ${JSON.stringify(afterAdd.monsters)}`,
  );
  console.log("rematch-after-summon: Puppet summoned t0m1:Minotaur into battle 1");

  // ---- Play battle 1 out to the win popup (battle-end-audio's swipe idiom). -------------------
  const swipeCurrentMove = async (current) => {
    const enemy = current.monsters.find((monster) => monster.team === 1 && monster.targetPoint && monster.targetSize);
    assert(enemy, `no live enemy target for swipe: ${JSON.stringify(current.monsters)}`);
    const halfLane = Math.max(40, enemy.targetSize.w * 0.75);
    const start = geometry.toCss({ x: enemy.targetPoint.x - halfLane, y: enemy.targetPoint.y });
    const end = geometry.toCss({ x: enemy.targetPoint.x + halfLane, y: enemy.targetPoint.y });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 18; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 18, start.y, { steps: 1 });
    }
    await page.mouse.up();
  };
  let snapshot = await state();
  for (let i = 0; i < 1600 && snapshot.presentation.state !== "battleEnded"; i++) {
    if (snapshot.presentation.state === "awaitingPlayerChoice" && snapshot.panelVisible) {
      await swipeCurrentMove(snapshot);
    }
    await advance(50);
    snapshot = await state();
  }
  assert.equal(snapshot.presentation.state, "battleEnded", "battle 1 did not end");
  for (let i = 0; i < 200 && snapshot.activePopup !== "xpAward"; i++) {
    await advance(50);
    snapshot = await state();
  }
  assert.equal(snapshot.activePopup, "xpAward", "win popup did not open");
  await page.screenshot({ path: path.join(outputDir, "battle1-won.png"), timeout: 120_000 });

  // ---- Ok → rematch: the fresh battle must build without the stale-summon session lookup. -----
  const [okButton] = snapshot.postBattleButtons;
  assert(okButton, "post-battle popup did not expose its Ok button");
  const okCss = geometry.toCss(okButton.point);
  await page.mouse.click(okCss.x, okCss.y);

  let rematch;
  for (let i = 0; i < 600; i++) {
    rematch = await state();
    if (rematch.mode === "battle" && rematch.monsters.length > 0 &&
      rematch.presentation.state === "awaitingPlayerChoice" && rematch.panelVisible) break;
    await advance(50);
  }
  assert.equal(
    rematch.mode,
    "battle",
    `rematch never rebuilt a battle: ${JSON.stringify(rematch?.presentation)} errors=${JSON.stringify(errors)}`,
  );
  assert.notEqual(rematch.presentation.state, "battleEnded", "rematch stayed on the ended battle");
  assert.equal(rematch.presentation.state, "awaitingPlayerChoice", "rebuilt battle never became playable");
  assert(rematch.panelVisible, "rebuilt battle has no player controls");
  // Fresh roster: only the encounter's initial members — battle 1's summon must not leak in.
  assert(
    !rematch.monsters.some((m) => m.id === "t0m1:Minotaur"),
    `battle 1's summon leaked into the rematch: ${JSON.stringify(rematch.monsters)}`,
  );
  assert(
    rematch.monsters.some((m) => m.id === "t0m0:Kaguya") && rematch.monsters.some((m) => m.id === "t1m0:Minotaur"),
    `rematch roster is not the fresh encounter: ${JSON.stringify(rematch.monsters)}`,
  );
  // The original bug surfaced here as an unhandled rejection (pageerror), not a thrown assert.
  assert.deepEqual(errors, [], `browser errors after rematch: ${JSON.stringify(errors)}`);
  await page.screenshot({ path: path.join(outputDir, "battle2-rebuilt.png"), timeout: 120_000 });
  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(rematch, null, 2) + "\n");
  console.log("rematch-after-summon: PASS (summon in battle 1, Ok → battle 2 rebuilt cleanly)");
} finally {
  await browser.close();
}
