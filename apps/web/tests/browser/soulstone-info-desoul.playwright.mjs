


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/soulstone-info-desoul");
fs.mkdirSync(outputDir, { recursive: true });

const readState = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));
/** Visible stage Text nodes' strings (worldVisible-filtered so hidden stacked popups don't leak). */
const visibleTexts = (page) =>
  page.evaluate(() => {
    const values = [];
    const visit = (node, visible) => {
      const nodeVisible = visible && node.visible !== false;
      if (nodeVisible && typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child, nodeVisible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return values;
  });


const textCenterGlobal = (page, needle) =>
  page.evaluate((t) => {
    let found = null;
    const visit = (node, visible) => {
      const nodeVisible = visible && node.visible !== false;
      if (!found && nodeVisible && typeof node.text === "string" && node.text === t) {
        const b = node.getBounds();
        found = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      for (const child of node.children ?? []) visit(child, nodeVisible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return found;
  }, needle);

/** Popup content mounts async (real asset fetches + a pop-in tween on the stopped deterministic
 *  ticker) — poll wall-clock AND advance ticks until the expected label is visible. */
const waitForVisibleText = async (page, advance, needle, timeoutIters = 100) => {
  for (let i = 0; i < timeoutIters; i++) {
    if ((await visibleTexts(page)).includes(needle)) return;
    await page.waitForTimeout(100);
    await advance(100);
  }
  throw new Error(`"${needle}" never rendered; saw: ${(await visibleTexts(page)).join(" | ")}`);
};

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      blockSaveMe: true,
      playerTeam: [
        // Manticore's kit carries Utility.Desoul (engine components.test.ts fixture); the Fire
        // stone's level 40 makes the popup's Attack row an unambiguous 40.
        { shortType: "Manticore", level: 12, soulStone: { element: "Fire", level: 40, sourceType: "FireCub" } },
      ],
      enemyTeam: [{ shortType: "Minotaur", level: 12 }],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // buildScene awaits REAL asset fetches — wall-clock first (a tight advanceTime loop starves
  // them, the "building" stall pitfall), then deterministic ticks through the entrance
  // choreography until Manticore's player turn opens the panel.
  for (let i = 0; i < 240 && (await readState(page)).mode !== "battle"; i++) {
    await advance(50);
    await page.waitForTimeout(250);
  }
  for (let i = 0; i < 400 && (await readState(page)).presentation?.state !== "awaitingPlayerChoice"; i++) {
    await advance(250);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  assert.equal((await readState(page)).presentation?.state, "awaitingPlayerChoice", "first player turn never arrived");
  const { toCss } = await stageGeometry(page, box);

  // --- 1. Open Manticore's stats card from its always-reachable friendly TU portrait. ---
  let state = await readState(page);
  const manticore = state.monsters.find((m) => m.id === "t0m0:Manticore");
  assert(manticore, "Manticore must be on the field");
  const initialManticoreEntry = state.turnOrderEntries.find((entry) => entry.id === manticore.id);
  assert(initialManticoreEntry?.iconGlobalCenter, `Manticore TU entry must be ready: ${JSON.stringify(state.turnOrderEntries)}`);
  await page.mouse.click(
    box.x + initialManticoreEntry.iconGlobalCenter.x,
    box.y + initialManticoreEntry.iconGlobalCenter.y,
  );
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup?.startsWith("livingInfo:"), undefined, { timeout: 15_000 });
  await waitForVisibleText(page, advance, "Soul Stone");
  let texts = await visibleTexts(page);
  assert(texts.includes("Soul Stone"), `card must render the underlined "Soul Stone" section title; saw: ${texts.join(" | ")}`);
  assert(texts.includes("Fire Soul Stone"), 'card must render the bare-text "Fire Soul Stone" row (no level suffix)');
  assert(!texts.some((t) => t.includes("Fire Soul Stone") && t !== "Fire Soul Stone"),
    "the stone row must be the bare localized name only (no level suffix/format)");
  await advance(600);
  await page.screenshot({ path: path.join(outputDir, "01-living-info-soulstone-section.png"), timeout: 120_000 });

  // --- 2. The stone section sits at the bottom of the scrolled column — jump the ScrollingNode
  // to percent 1 first (a no-move tap on the track's bottom end applies the absolute mapping via
  // the touchEnded recompute, exercising the drag-scroll port), then tap the row. Settle the
  // popup's 0.2s pop-in before measuring (mid-tween bounds put the first attempt's click on a
  // moving target). ---
  await advance(800);
  const trackPt = await page.evaluate(() => {
    let found = null;
    const visit = (node) => {
      if (!found && node.label === "livingInfoScrollTrack") {
        const b = node.getBounds();
        found = { x: b.x + b.width / 2, y: b.y + b.height - 8 };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  });
  assert(trackPt, "the overflowing card must render its scrollbar track");
  await page.mouse.click(box.x + trackPt.x, box.y + trackPt.y);
  await advance(600);
  const rowPt = await textCenterGlobal(page, "Fire Soul Stone");
  assert(rowPt, "stone row text node must be locatable");
  await page.mouse.click(box.x + rowPt.x, box.y + rowPt.y);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "soulStone:Fire Soul Stone", undefined, { timeout: 15_000 });
  await waitForVisibleText(page, advance, "40");
  texts = await visibleTexts(page);
  assert(texts.includes("Fire Soul Stone"), "popup must render the stone's localized name as its title");
  assert(texts.includes("40"), `popup must render the isolated Attack bonus 40 (level 40 x weight 1.0); saw: ${texts.join(" | ")}`);
  assert(texts.includes("Ok"), "popup must render its single view-only Ok button");
  await advance(600);
  await page.screenshot({ path: path.join(outputDir, "02-soulstone-item-popup.png"), timeout: 120_000 });


  let okPt = await textCenterGlobal(page, "Ok");
  assert(okPt, "the stone popup's Ok must be visible");
  await page.mouse.click(box.x + okPt.x, box.y + okPt.y);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null, undefined, { timeout: 15_000 });
  await advance(300);
  okPt = await textCenterGlobal(page, "Ok");
  assert(okPt, "the re-shown living-info card's Ok must be visible");
  await page.mouse.click(box.x + okPt.x, box.y + okPt.y);
  for (let i = 0; i < 50 && (await visibleTexts(page)).includes("Ok"); i++) {
    await page.waitForTimeout(100);
    await advance(100);
  }
  assert(!(await visibleTexts(page)).includes("Ok"), "both popups must close before acting");

  // --- 4. Cast Utility.Desoul (self-target auto-completes on tap). The panel slides in — its
  // reported button centers are only click-safe once two consecutive ticks agree (an earlier
  // attempt clicked mid-slide and hit the turn-order column instead). ---
  let prevButtons = "";
  for (let i = 0; i < 100; i++) {
    const cur = JSON.stringify((await readState(page)).abilityButtons);
    if (cur === prevButtons && cur !== "[]") break;
    prevButtons = cur;
    await advance(200);
  }
  state = await readState(page);
  const desoulButton = state.abilityButtons.find((b) => b.abilityPath === "Utility.Desoul");
  assert(desoulButton, `Manticore's panel must offer Utility.Desoul; saw ${JSON.stringify(state.abilityButtons)}`);
  await page.mouse.click(toCss(desoulButton.center).x, toCss(desoulButton.center).y);
  // Let the cast play out. The engine flips summonIds at resolution time, but the summon CARD
  // build awaits REAL asset fetches (FireCub sprite/atlas) — interleave wall-clock time with the
  // deterministic ticks (the starvation pitfall) until the display side catches up too.
  for (let i = 0; i < 120 && (await readState(page)).summonIds[0] === null; i++) await advance(250);
  for (let i = 0; i < 100 && (await readState(page)).friendlySummon === null; i++) {
    await page.waitForTimeout(100);
    await advance(100);
  }

  state = await readState(page);
  assert.equal(state.summonIds[0], "t0m1:FireCub", "Desoul must install the stone's remembered FireCub at the caster's level into the team-0 summon slot");
  assert(state.friendlySummon && state.friendlySummon.id === "t0m1:FireCub",
    `the summon must render its own FriendlyMonsterDisplay card; saw ${JSON.stringify(state.friendlySummon)}`);
  assert.equal(state.spiritBackgroundVisible, false, "spiritBkg must hide while the summon slot is occupied (generic toggle, §10.11.3)");
  const summonMonster = state.monsters.find((m) => m.id === "t0m1:FireCub");
  assert(summonMonster && summonMonster.team === 0 && summonMonster.visible, "the summon must be a visible team-0 field monster");
  assert(state.displayedQueue.includes("t0m1:FireCub") || state.queue.includes("t0m1:FireCub"),
    "the summon must join the shared turn queue");
  await advance(600);
  await page.screenshot({ path: path.join(outputDir, "03-desoul-summon-on-field.png"), timeout: 120_000 });

  // --- 5. The stone was CONSUMED: reopen the card via Manticore's TURN-ORDER entry (own-team
  // tap -> living info, `TurnOrderDisplay.onOwnTap`) — reachable in every presentation state,
  // unlike the friendly row, which hides while the turn panel is up. Wait out any status-text
  // page first (it swallows every touch while showing). ---
  for (let i = 0; i < 100; i++) {
    const s = await readState(page);
    if (!s.statusText.visible && s.presentation?.state === "awaitingPlayerChoice") break;
    await page.waitForTimeout(50);
    await advance(200);
  }
  state = await readState(page);
  const manticoreEntry = state.turnOrderEntries.find((e) => e.id === "t0m0:Manticore");
  if (manticoreEntry) {
    await page.mouse.click(box.x + manticoreEntry.iconGlobalCenter.x, box.y + manticoreEntry.iconGlobalCenter.y);
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup?.startsWith("livingInfo:"), undefined, { timeout: 15_000 });
    // "Abilities" (the card's key-echo header) proves the card content finished mounting before
    // the soul-stone ABSENCE is asserted.
    await waitForVisibleText(page, advance, "Abilities");
    texts = await visibleTexts(page);
    assert(!texts.includes("Soul Stone"), "the soul-stone section must disappear once Desoul consumed the stone");
    assert(!texts.includes("Fire Soul Stone"), "no stone row may remain after the consume");
    await advance(600);
    await page.screenshot({ path: path.join(outputDir, "04-post-desoul-no-section.png"), timeout: 120_000 });
  } else {
    // Battle resolved before another Manticore queue entry existed — the consume itself is
    // already proven by the engine tests; note and move on.
    console.log("soulstone-info-desoul: no Manticore queue entry remained — post-consume card check skipped");
  }

  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log("soulstone-info-desoul: PASS (section + popup + Desoul summon render end-to-end)");
} finally {
  await browser.close();
}
