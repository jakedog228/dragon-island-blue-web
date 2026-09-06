// Ready-to-run browser proof for the native HeroDisplay -> spirit-menu -> autonomous summon
// path. Repository policy keeps this opt-in: `pnpm scenario:spirits` (never part of `pnpm test`).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { createFrameCapture } from "./captureFrame.mjs";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/spirit-system");
fs.mkdirSync(outputDir, { recursive: true });

const tiers = {
  Resistance: 2, Fire: 7, Fate: 0, Aggression: 13, Energy: 5, Karma: 9,
  Evil: 16, Fear: 4, Thought: 11, Divine: 15, Time: 18, Shenron: 17,
};
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const captureFrame = await createFrameCapture(page, outputDir);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ profileTiers }) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "FireCub", level: 20 }],
      enemyTeam: [{ shortType: "Minotaur", level: 50 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 20,
      monsterPartyLevels: [20],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1"],
      spiritReadiness: 1,
      spiritTierLevels: profileTiers,
    };
  }, { profileTiers: tiers });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  // The addInitScript advanceTime stub is a *signal*: main.ts sees a pre-installed hook and stops
  // the Pixi ticker, so real rAF renders nothing and only advanceTime() calls stage.app.render().
  // Pixi computes worldTransform during render, so a popup that mounted after the last advance()
  // is not yet hit-testable — clicking it silently misses on stale transforms. Render once (without
  // moving game time) before driving the mouse at anything just added to the scene.
  const settle = () => advance(0);
  for (let i = 0; i < 500 && (await state()).mode !== "start"; i++) await advance(25);
  assert.equal((await state()).mode, "start", `boot stalled: ${errors.join(" | ")}`);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }

  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "battle canvas has no layout box");
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  const geometry = await stageGeometry(page, canvasBox);

  let ready;
  for (let i = 0; i < 2000; i++) {
    ready = await state();
    if (
      ready.mode === "battle" &&
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.panelVisible &&
      ready.spirit?.panelHero?.point
    ) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  assert.equal(ready.presentation?.state, "awaitingPlayerChoice", `player choose phase did not open: ${JSON.stringify(ready)}`);
  assert.equal(ready.spirit.profile.spirits.length, 12);
  assert.equal(ready.spirit.profile.readiness, 1);
  assert.deepEqual(
    { ...ready.spirit.fieldHero, flashOpacity: undefined },
    { readiness: 1, coverPercent: 0, flashing: true, flashOpacity: undefined, enabled: false },
  );
  assert(ready.spirit.fieldHero.flashOpacity >= 0 && ready.spirit.fieldHero.flashOpacity <= 102 / 255);
  assert.equal(ready.spirit.panelHero.enabled, true);
  assert.equal(ready.spirit.panelHero.flashing, true);
  assert(ready.spirit.panelHero.point, "interactive panel HeroDisplay did not expose its portrait target");

  const heroCss = geometry.toCss(ready.spirit.panelHero.point);
  await page.mouse.click(heroCss.x, heroCss.y);
  for (let i = 0; i < 200 && (await state()).activePopup !== "spiritMenu"; i++) await advance(25);
  await advance(500);
  await settle();
  const menu = await state();
  assert.equal(menu.activePopup, "spiritMenu");
  assert.equal(menu.spirit.menu.title, "Spirit Totems");
  assert.deepEqual(
    menu.spirit.menu.columns.map((column) => column.map((item) => item.shortType ?? "Back")),
    [
      ["Resistance", "Aggression", "Evil", "Divine", "Back"],
      ["Fire", "Energy", "Fear", "Time"],
      ["Fate", "Karma", "Thought", "Shenron"],
    ],
  );
  assert(menu.spirit.menu.buttons.every((button) => button.enabled), "first-trip menu unexpectedly disabled a spirit");


  assert(
    Math.abs(menu.spirit.menu.dimAlpha - 200 / 255) < 1e-6,
    `spirit menu dim settled at ${menu.spirit.menu.dimAlpha}, expected sub_91878's 200/255`,
  );
  assert.equal(menu.spirit.menu.content.x + menu.spirit.menu.content.w / 2, menu.screenPt.w / 2);
  assert.equal(
    menu.spirit.menu.content.y + menu.spirit.menu.content.h / 2,
    menu.screenPt.h / 2,
    "PopupMenu's outer Box bounds are not centered on the source screen-center origin",
  );
  // The title is centered *through* rebuildMenu's roundf: titleX = contentX + roundf((contentW -
  // titleW)/2), so a measured label whose half-width lands off the native point grid leaves a
  // residual of up to half a native point. Assert the snap itself, not a perfect center — the
  // source does not center perfectly either.
  const titleCenterX = menu.spirit.menu.titleBounds.x + menu.spirit.menu.titleBounds.w / 2;
  const nativeScale = menu.displayMode === "ipad" ? 1 : 2;
  assert.equal(
    menu.spirit.menu.titleBounds.x,
    menu.spirit.menu.content.x
      + Math.floor(((menu.spirit.menu.content.w - menu.spirit.menu.titleBounds.w) / 2) * nativeScale + 0.5) / nativeScale,
    "PopupMenu title x does not match rebuildMenu's rounded centering offset",
  );
  assert(
    Math.abs(titleCenterX - menu.screenPt.w / 2) <= 0.5 / nativeScale,
    `PopupMenu title is off-center by more than the source rounding quantum: ${titleCenterX} vs ${menu.screenPt.w / 2}`,
  );
  for (const button of menu.spirit.menu.buttons) {
    assert(button.y - button.h / 2 >= 0, `${button.label} background extends above the screen`);
    assert(button.y + button.h / 2 <= menu.screenPt.h, `${button.label} background extends below the screen`);
  }
  for (const column of [0, 1, 2]) {
    const buttons = menu.spirit.menu.buttons
      .filter((button) => button.column === column)
      .sort((a, b) => a.row - b.row);
    assert(buttons.length > 0, `Spirit Totems column ${column} is empty`);
    assert.equal(new Set(buttons.map((button) => button.w)).size, 1, `column ${column} backgrounds differ in width`);
    assert.equal(new Set(buttons.map((button) => button.h)).size, 1, `column ${column} backgrounds differ in height`);
    for (let row = 1; row < buttons.length; row++) {
      const previous = buttons[row - 1];
      const current = buttons[row];
      const labelGap = current.y - current.labelH / 2 - (previous.y + previous.labelH / 2);
      assert.equal(labelGap, 30, `column ${column} row ${row} does not use the source label gap`);
    }
  }
  await captureFrame("menu-full.png");

  const fireModel = menu.spirit.tiers.find((item) => item.shortType === "Fire");
  assert(fireModel, "Fire spirit tier model is missing");
  const fireButton = menu.spirit.menu.buttons.find((button) => button.label === fireModel.label);
  assert(fireButton, "Fire spirit menu button is missing");
  const fireCss = geometry.toCss(fireButton);
  await page.mouse.click(fireCss.x, fireCss.y);

  let summoned;
  for (let i = 0; i < 400; i++) {
    summoned = await state();
    if (summoned.friendlySummon?.id?.endsWith(":Fire")) break;
    await advance(25);
  }
  const summonId = summoned.friendlySummon?.id;
  assert(summonId, `Fire did not occupy the dedicated summon slot: ${JSON.stringify(summoned.friendlySummon)}`);
  const fireLiving = summoned.monsters.find((monster) => monster.id === summonId);
  const fireProfile = summoned.spirit.profile.spirits.find((spirit) => spirit.shortType === "Fire");
  assert.equal(fireLiving.level, fireModel.combatLevel, "grade -> saved XP -> combat-level conversion diverged");
  assert.equal(fireLiving.aiControlled, true, "native spirit must use BadguyAI even on team 0");
  assert.equal(fireProfile.savedXp, fireModel.savedXp + 33, "summoning must award exactly 33 persistent XP");
  assert.equal(fireProfile.usedThisTrip, true);
  assert.equal(summoned.spirit.profile.readiness, 0);
  assert.equal(summoned.spiritBackgroundVisible, false);
  assert(summoned.displayedQueue.includes(summonId), "spirit did not enter the TU queue");
  assert(summoned.turnOrderEntries.some((entry) => entry.id === summonId), "spirit did not enter the TU sidebar");
  assert.equal(summoned.activeActorId, ready.activeActorId, "side-command summon consumed the pending player action");
  await advance(300); // native HeroDisplay shader cadence
  summoned = await state();
  assert.equal(summoned.spirit.panelHero.coverPercent, 1);
  assert.equal(summoned.spirit.panelHero.flashing, false);
  await captureFrame("summoned-hotbar-tu.png");

  // Queue the still-pending player's move, then prove the spirit's scheduled turn is autonomous:
  // its actor becomes active without ever opening the player choice panel.
  // abilityButtonStates() already excludes locked/empty slots (monsterTurnPanel.ts), so every
  // entry it reports is a real selectable card — there is no `enabled` flag to filter on.
  const ability = summoned.abilityButtons[0];
  assert(ability, "player has no selectable ability to continue the scheduling proof");
  const abilityCss = geometry.toCss(ability.center);
  await page.mouse.click(abilityCss.x, abilityCss.y);
  let afterAbility = await state();
  if (afterAbility.presentation.state === "targetPicking") {
    const target = afterAbility.monsters.find((monster) => monster.team === 1 && monster.hp > 0);
    assert(target, "manual ability picker has no live enemy target");
    const targetCss = geometry.toCss(target.targetPoint);
    await page.mouse.click(targetCss.x, targetCss.y);
  }
  let sawAutonomousTurn = false;
  for (let i = 0; i < 3000; i++) {
    const snapshot = await state();
    if (snapshot.activeActorId === summonId) {
      assert.notEqual(snapshot.presentation.state, "awaitingPlayerChoice");
      assert.equal(snapshot.panelVisible, false);
      sawAutonomousTurn = true;
      break;
    }
    if (snapshot.presentation.state === "battleEnded") break;
    await advance(25);
  }
  assert(sawAutonomousTurn, "the native spirit never received an observable autonomous turn");
  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors)}`);
  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(await state(), null, 2) + "\n");
  console.log("spirit-system: PASS (menu, grade conversion, summon slot/TU, profile spend, autonomous AI)");
} finally {
  await browser.close();
}
