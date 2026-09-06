// Browser contract for the source-ordered MonsterTurnPanel secondary row plus delay/bench/retreat flows.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/secondary-actions");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

const encounter = (allowRetreat) => ({
  backgroundKey: "ForestCombat",
  allowRetreat,
  playerTeam: [{ shortType: "FireCub", level: 5 }],
  enemyTeam: [{ shortType: "SnowCub", level: 5 }],
});

const reservesEncounter = {
  backgroundKey: "ForestCombat",
  allowRetreat: true,
  playerTeam: [
    { shortType: "FireCub", level: 5 },
    { shortType: "SnowCub", level: 5 },
    { shortType: "WhiteDragonling", level: 5 },
    { shortType: "Fairy", level: 5 },
    { shortType: "Penguin", level: 5 },
    { shortType: "Kingpen", level: 5 },
  ],
  enemyTeam: [{ shortType: "Minotaur", level: 1 }],
};

async function openBattle({ seed, allowRetreat = true, testEncounter = null }) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ testEncounter, testSeed }) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = testEncounter;
    window.__DIB_TEST_BATTLE_SEED__ = testSeed;
  }, { testEncounter: testEncounter ?? encounter(allowRetreat), testSeed: seed });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  while ((await state()).mode !== "start") await advance(50);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let i = 0; i < 1200 && !(await state()).panelVisible; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  const ready = await state();
  assert.equal(ready.presentation?.state, "awaitingPlayerChoice", `battle panel did not become ready: ${JSON.stringify(ready)}`);
  const geometry = await stageGeometry(page, canvasBox);

  const clickAction = async (kind) => {
    const action = (await state()).secondaryActions.find((candidate) => candidate.kind === kind);
    assert(action, `missing ${kind} action`);
    const css = geometry.toCss(action.center);
    await page.mouse.click(css.x, css.y);
  };

  const waitVisibleText = (wanted) => page.waitForFunction((text) => {
      const chainVisible = (node) => {
        for (let current = node; current; current = current.parent) if (!current.visible) return false;
        return true;
      };
      let found = false;
      const visit = (node) => {
        if (node.text === text && chainVisible(node)) found = true;
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return found;
    }, wanted, { timeout: 15_000 });

  const clickVisibleText = async (wanted) => {
    await waitVisibleText(wanted);
    // PopupKit's source-timed opening tween begins at scaleY=0. Because these
    // deterministic scenarios stop the Pixi ticker, advance it before a hit.
    await advance(250);
    const point = await page.evaluate((text) => {
      const chainVisible = (node) => {
        for (let current = node; current; current = current.parent) if (!current.visible) return false;
        return true;
      };
      let found = null;
      const visit = (node) => {
        if (!found && node.text === text && chainVisible(node)) {
          const bounds = node.getBounds();
          found = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return found;
    }, wanted);
    assert(point, `missing visible popup text ${wanted}`);
    const appScreen = await page.evaluate(() => ({
      w: window.__PIXI_APP__.screen.width,
      h: window.__PIXI_APP__.screen.height,
    }));
    const scale = Math.min(canvasBox.width / appScreen.w, canvasBox.height / appScreen.h);
    const ox = (canvasBox.width - appScreen.w * scale) / 2;
    const oy = (canvasBox.height - appScreen.h * scale) / 2;
    await page.mouse.click(canvasBox.x + ox + point.x * scale, canvasBox.y + oy + point.y * scale);
  };

  return { page, errors, state, advance, clickAction, clickVisibleText, waitVisibleText, geometry };
}

async function waitForPanel(ctx) {
  for (let i = 0; i < 1600 && !(await ctx.state()).panelVisible; i++) {
    await ctx.advance(25);
    if (i % 20 === 0) await ctx.page.waitForTimeout(10);
  }
  assert.equal((await ctx.state()).presentation.state, "awaitingPlayerChoice");
}

try {
  // Skip-turn: exact visual order, cancel, one-time confirmation, direct retry.
  {
    const ctx = await openBattle({ seed: 7 });
    const before = await ctx.state();
    assert.deepEqual(before.secondaryActions.map((action) => action.kind), ["delay", "bench", "retreat"]);
    assert(before.secondaryActions[0].center.x < before.secondaryActions[1].center.x);
    assert(before.secondaryActions[1].center.x < before.secondaryActions[2].center.x);
    assert.deepEqual(before.secondaryActions.map((action) => action.enabled), [true, true, true]);
    await ctx.page.screenshot({ path: path.join(outputDir, "source-order.png"), timeout: 120_000 });

    await ctx.clickAction("delay");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "confirmSkip");
    await ctx.clickVisibleText("No");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);
    assert.equal((await ctx.state()).hasConfirmedSkip, false);
    assert.equal((await ctx.state()).panelVisible, true);

    await ctx.clickAction("delay");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "confirmSkip");
    await ctx.clickVisibleText("Yes");
    for (let i = 0; i < 80 && (await ctx.state()).latestSecondaryAction?.abilityPath !== "Utility.Delay"; i++) {
      await ctx.advance(10);
    }
    const queued = await ctx.state();
    assert.equal(queued.hasConfirmedSkip, true);
    assert.equal(queued.latestSecondaryAction.abilityPath, "Utility.Delay");
    assert.equal(queued.latestSecondaryAction.noHaste, true);
    assert(queued.latestSecondaryAction.activationLength >= 2);
    assert.equal(queued.panelVisible, false);

    await waitForPanel(ctx);
    await ctx.clickAction("delay");
    for (let i = 0; i < 80 && (await ctx.state()).panelVisible; i++) await ctx.advance(10);
    assert.equal((await ctx.state()).activePopup, null, "confirmed skip must not ask again this battle");
    assert.deepEqual(ctx.errors, []);
    await ctx.page.close();
  }

  // Encounter permission branch: no roll/queue, localized NoRetreat popup, panel restored.
  {
    const ctx = await openBattle({ seed: 7, allowRetreat: false });
    await ctx.clickAction("retreat");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "noRetreat");
    const blocked = await ctx.state();
    assert.equal(blocked.panelVisible, true);
    assert.equal(blocked.activeAbilityPath, null);
    await ctx.waitVisibleText("Retreat Is Not An Option");
    await ctx.advance(250);
    await ctx.page.screenshot({ path: path.join(outputDir, "no-retreat.png"), timeout: 120_000 });
    await ctx.clickVisibleText("Ok");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);
    assert.equal((await ctx.state()).panelVisible, true);
    assert.deepEqual(ctx.errors, []);
    await ctx.page.close();
  }

  // Seed 7: player leads and the third RNG draw is 0.9769, so the 30% attempt fails.
  {
    const ctx = await openBattle({ seed: 7 });
    await ctx.clickAction("retreat");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "confirmRetreat");
    await ctx.clickVisibleText("No");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);
    assert.equal((await ctx.state()).panelVisible, true, "No keeps the same actor's panel open");

    await ctx.clickAction("retreat");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "confirmRetreat");
    await ctx.clickVisibleText("Yes");
    for (let i = 0; i < 100 && (await ctx.state()).presentation.state !== "retreatFailedAwaitingStatus"; i++) {
      await ctx.advance(10);
    }
    const failed = await ctx.state();
    assert.equal(failed.activeAbilityPath, "Utility.LooseTurn");


    assert.deepEqual(failed.statusText, { visible: true, text: "Run away fail\nFire Cub loses its turn" });
    assert.equal(failed.panelVisible, false);
    await ctx.advance(750);
    await ctx.page.screenshot({ path: path.join(outputDir, "retreat-failed.png"), timeout: 120_000 });
    const statusPoint = ctx.geometry.toCss({ x: 240, y: 260 });
    await ctx.page.mouse.click(statusPoint.x, statusPoint.y);
    await ctx.advance(25);
    assert.notEqual((await ctx.state()).presentation.state, "retreatFailedAwaitingStatus");
    assert.deepEqual(ctx.errors, []);
    await ctx.page.close();
  }

  // Seed 5: player leads and the third RNG draw is 0.2197, so the 30% attempt succeeds.
  {
    const ctx = await openBattle({ seed: 5 });
    await ctx.clickAction("retreat");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "confirmRetreat");
    await ctx.clickVisibleText("Yes");
    for (let i = 0; i < 120 && (await ctx.state()).presentation.state !== "retreated"; i++) await ctx.advance(10);
    const escaped = await ctx.state();
    assert.equal(escaped.presentation.state, "retreated");
    assert.equal(escaped.activePopup, "retreated");
    assert.equal(escaped.panelVisible, false);
    assert(escaped.monsters.every((monster) => monster.visible === false), "state 6 hides both teams");
    const chatVisible = await ctx.page.evaluate(() => {
      let found = false;
      const visit = (node) => {
        if (node.text === "You escaped the battle.") found = true;
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return found;
    });
    assert.equal(chatVisible, true);
    await ctx.advance(250);
    await ctx.page.screenshot({ path: path.join(outputDir, "retreat-success.png"), timeout: 120_000 });
    assert.deepEqual(ctx.errors, []);
    await ctx.page.close();
  }


  {
    const ctx = await openBattle({ seed: 7 });
    await ctx.clickAction("bench");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "noBattingOrder");
    const blocked = await ctx.state();
    assert.equal(blocked.monsterManagement, null);
    assert.equal(blocked.panelVisible, true);
    await ctx.waitVisibleText("No Creatures Left");
    await ctx.waitVisibleText("There are no reinforcement creatures on your side.");
    await ctx.advance(250);
    await ctx.page.screenshot({ path: path.join(outputDir, "no-batting-order.png"), timeout: 120_000 });
    await ctx.clickVisibleText("Ok");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);
    assert.equal((await ctx.state()).panelVisible, true);
    assert.deepEqual(ctx.errors, []);
    await ctx.page.close();
  }

  // `benchCallback:` nonempty branch: the SAME view-only style-4 screen the Analyze counter
  // uses, over the player team's replacementMembers, without consuming the pending choice.
  {
    const ctx = await openBattle({ seed: 7, testEncounter: reservesEncounter });
    const before = await ctx.state();
    assert.equal(before.friendlyBenchCount, 3);
    await ctx.clickAction("bench");
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "monsterManagement");
    const opened = await ctx.state();
    assert.equal(opened.presentation.state, "friendlyReserveManagement");
    assert.equal(opened.monsterManagement.style, 4);
    assert.equal(opened.monsterManagement.editable, false);
    assert.equal(opened.monsterManagement.title, "View Party Order");
    assert.equal(opened.monsterManagement.backgroundAlpha, 1, "onEnter background shows immediately, no fade");
    assert.equal(opened.monsterManagement.backgroundTint, 0x505050, "MMScreen carries the source setColor 0x505050 shading");
    assert.deepEqual(
      opened.monsterManagement.cards.map((card) => card.id),
      ["t0m3:Fairy", "t0m4:Penguin", "t0m5:Kingpen"],
      "player view must snapshot the friendly replacementMembers in order",
    );
    await ctx.advance(250);
    await ctx.page.screenshot({ path: path.join(outputDir, "player-party-order.png"), timeout: 120_000 });

    // The management screen swallows panel input while open.
    const abilityUnderlay = opened.abilityButtons[0];
    if (abilityUnderlay) {
      const css = ctx.geometry.toCss(abilityUnderlay.center);
      await ctx.page.mouse.click(css.x, css.y);
      await ctx.advance(25);
      const swallowed = await ctx.state();
      assert.equal(swallowed.activePopup, "monsterManagement");
      assert.equal(swallowed.presentation.state, "friendlyReserveManagement");
    }

    const closeCss = ctx.geometry.toCss(opened.monsterManagement.closeCenter);
    await ctx.page.mouse.click(closeCss.x, closeCss.y);
    await ctx.page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);
    const closed = await ctx.state();
    assert.equal(closed.presentation.state, "awaitingPlayerChoice");
    assert.equal(closed.panelVisible, true, "browsing the party order must not consume the turn");
    assert.equal(closed.friendlyBenchCount, 3, "view-only screen must not mutate reserves");
    assert.deepEqual(ctx.errors, []);
    await ctx.page.close();
  }

  console.log("secondary-actions: PASS (order, skip confirmation/direct use, retreat blocked/cancel/fail/success, player party order view/empty branches)");
} finally {
  await browser.close();
}
