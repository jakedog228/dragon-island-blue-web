// Browser contract for `AnalyzeAbilityComponent` -> BattleNode event 0 -> EnemyTeamDisplay.
// Covers counter population/decrement, pre-Analyze and empty-post-Analyze source messages,
// active-enemy body rerouting, label blink, promotion inheritance, and the source style-4
// MonsterManagementNode reserve viewer (the editable player Bench UI remains separate/disabled).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/enemy-analyze-reserves");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

async function openBattle(encounter) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript((configured) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = configured;
  }, encounter);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  while ((await state()).mode !== "start") await advance(100);
  const box = await page.locator("canvas").first().boundingBox();
  assert(box);
  for (let i = 0; i < 300; i++) {
    await advance(1000 / 60);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 1200 && (await state()).mode !== "battle"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  const geometry = await stageGeometry(page, box);
  return { page, errors, state, advance, box, geometry };
}

async function waitFor(ctx, predicate, message, limit = 400) {
  for (let i = 0; i < limit; i++) {
    const snapshot = await ctx.state();
    if (predicate(snapshot)) return snapshot;
    await ctx.advance(25);
    if (i % 20 === 0) await ctx.page.waitForTimeout(1);
  }
  throw new Error(message);
}

async function clickBattlePoint(ctx, point) {
  const css = ctx.geometry.toCss(point);
  await ctx.page.mouse.move(css.x, css.y);
  await ctx.page.mouse.down();
  await ctx.advance(16);
  await ctx.page.mouse.up();
  await ctx.advance(16);
}

async function renderedTexts(page) {
  return page.evaluate(() => {
    const values = [];
    const visit = (node) => {
      if (typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return values;
  });
}

async function waitForText(page, text) {
  await page.waitForFunction((expected) => {
    const values = [];
    const visit = (node) => {
      if (typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return values.includes(expected);
  }, text, { timeout: 15_000 });
}

async function waitForPopupCard(page) {
  await page.waitForFunction(() => {
    let found = false;
    const visit = (node) => {
      if (node.label === "popupCard") found = true;
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  }, undefined, { timeout: 15_000 });
}

async function closeOk(ctx, expectedPopup = null) {
  const global = await ctx.page.evaluate(() => {
    let found = null;
    const visit = (node) => {
      if (!found && node.visible && typeof node.text === "string" && node.text === "Ok") {
        const b = node.getBounds();
        found = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  });
  assert(global, "expected a rendered Ok button");
  await ctx.page.mouse.click(ctx.box.x + global.x, ctx.box.y + global.y);
  await waitFor(ctx, (s) => s.activePopup === expectedPopup, "popup did not close to the expected stack state");
}

async function useAnalyze(ctx) {
  const choose = await waitFor(
    ctx,
    (s) => s.presentation.state === "awaitingPlayerChoice" && s.abilityButtons.some((b) => b.abilityPath === "Utility.Analyze"),
    "Penguin never received a choice containing Analyze",
  );
  const analyze = choose.abilityButtons.find((button) => button.abilityPath === "Utility.Analyze");
  // `showPanel` can complete in the microtask after the ticker frame that opened the choice;
  // render that completed visibility swap before sending real pointer input.
  await ctx.advance(0);
  await clickBattlePoint(ctx, analyze.center);
  for (let i = 0; i < 200; i++) {
    const snapshot = await ctx.state();
    if (snapshot.enemyAnalyze.enabled) return snapshot;
    await ctx.advance(25);
    if (i % 20 === 0) await ctx.page.waitForTimeout(1);
  }
  throw new Error(`Analyze did not reach event 0: ${JSON.stringify({ analyze, state: await ctx.state(), errors: ctx.errors })}`);
}

try {
  // Nine members leave enough reserves to exercise CFlow's three-visible-per-side boundary.
  // The original six-member fixture never produced a distance-four neighbor, so it could not
  // catch an outgoing card being incorrectly blended back toward the origin before hiding.
  const nineEncounter = {
    backgroundKey: "ForestCombat",
    playerTeam: [
      { shortType: "Penguin", level: 100 },
      { shortType: "FireCub", level: 1 },
      { shortType: "SnowCub", level: 1 },
      { shortType: "WhiteDragonling", level: 1 },
      { shortType: "Fairy", level: 1 },
      { shortType: "Kingpen", level: 1 },
      { shortType: "Minotaur", level: 1 },
      { shortType: "Spark", level: 1 },
      { shortType: "UnhappyBird", level: 1 },
    ],
    enemyTeam: [
      { shortType: "Minotaur", level: 1 },
      { shortType: "Spark", level: 1 },
      { shortType: "UnhappyBird", level: 1 },
      { shortType: "FireCub", level: 1 },
      { shortType: "SnowCub", level: 1 },
      { shortType: "WhiteDragonling", level: 1 },
      { shortType: "Fairy", level: 1 },
      { shortType: "Kingpen", level: 1 },
      { shortType: "Penguin", level: 1 },
    ],
  };

  const notReady = await openBattle(nineEncounter);

  const initial = await waitFor(notReady, (s) => s.enemyBenchCountShown === 6 && s.enemyBenchCenter, "counter did not mount");
  assert.equal(initial.friendlyBenchCount, 6);
  assert.deepEqual(initial.enemyBenchIds, [
    "t1m3:FireCub",
    "t1m4:SnowCub",
    "t1m5:WhiteDragonling",
    "t1m6:Fairy",
    "t1m7:Kingpen",
    "t1m8:Penguin",
  ]);
  const benchAction = initial.secondaryActions.find((action) => action.kind === "bench");
  if (benchAction) assert.equal(benchAction.enabled, true, "the player party-order action is always tappable (benchCallback owns its branches)");

  await clickBattlePoint(notReady, initial.enemyBenchCenter);
  const blocked = await waitFor(notReady, (s) => s.activePopup === "analyzeNotReady", "pre-Analyze counter branch missing");
  assert.equal(blocked.enemyAnalyze.enabled, false);
  await waitForText(notReady.page, "Some monsters allow you to analyze the incoming enemies. When this happens, the number in this box will blink and you can touch it to inspect the monsters that are yet to enter battle.");
  await notReady.advance(250);
  const blockedText = await renderedTexts(notReady.page);
  assert(blockedText.includes("Analyze"));
  assert(blockedText.includes("Some monsters allow you to analyze the incoming enemies. When this happens, the number in this box will blink and you can touch it to inspect the monsters that are yet to enter battle."));
  await notReady.page.screenshot({ path: path.join(outputDir, "counter-not-ready.png"), timeout: 120_000 });
  await closeOk(notReady);
  assert.deepEqual(notReady.errors, []);
  await notReady.page.close();

  // A fresh battle isolates the post-Analyze behavior from the precondition popup while still
  // proving both branches through real pointer input.
  const withReserves = await openBattle(nineEncounter);

  const analyzed = await useAnalyze(withReserves);
  assert.deepEqual(analyzed.enemyAnalyze.analyzedMonsterIds, ["t1m0:Minotaur", "t1m1:Spark", "t1m2:UnhappyBird"]);
  assert.equal(analyzed.enemyAnalyze.blinking, true);
  const visibility = new Set([analyzed.enemyAnalyze.labelVisible]);
  for (let i = 0; i < 24 && visibility.size < 2; i++) {
    await withReserves.advance(25);
    visibility.add((await withReserves.state()).enemyAnalyze.labelVisible);
  }
  assert.deepEqual([...visibility].sort(), [false, true], "0.5s/one-blink repeat must toggle the count label");

  // This encounter carries reserves on both sides, so the round after Analyze runs long: the next
  // player choice lands around step 490 (~12s of stepped time), past waitFor's 400-step default.
  // The counter also blinks on a 0.5s cycle, so the visible half has to coincide with the panel.
  const stableAnalyzed = await waitFor(
    withReserves,
    (s) => s.enemyAnalyze.labelVisible && s.presentation.state === "awaitingPlayerChoice" && s.panelVisible,
    "counter never became visible during the next stable player choice",
    1200,
  );
  assert.equal(stableAnalyzed.enemyBenchCountShown, stableAnalyzed.enemyBenchIds.length);
  assert(stableAnalyzed.enemyBenchIds.length > 0);
  // UnhappyBird sacrifices itself deterministically in this fixture, promoting the bench front.
  // Source allowAnalyze touched only the displays that existed at activation time: the promoted
  // FireCub must not silently inherit analyze mode.
  const promoted = stableAnalyzed.monsters.find((monster) => monster.id === "t1m3:FireCub");
  assert(promoted, "expected the reserve-front FireCub to be promoted before the next choice");
  assert(!stableAnalyzed.enemyAnalyze.analyzedMonsterIds.includes(promoted.id));
  await withReserves.page.screenshot({ path: path.join(outputDir, "analyzed-counter-and-promotion.png"), timeout: 120_000 });




  const blinkedOff = await waitFor(
    withReserves,
    (s) => !s.enemyAnalyze.labelVisible && s.enemyAnalyze.blinking,
    "counter never entered a blink-off phase",
  );
  await clickBattlePoint(withReserves, blinkedOff.enemyBenchCenter);
  const managementOpening = await waitFor(
    withReserves,
    (s) => s.activePopup === "monsterManagement" && s.monsterManagement,
    "post-Analyze counter did not mount MonsterManagementNode style 4 from a blink-off tap",
  );
  assert.equal(managementOpening.enemyAnalyze.enabled, false, "opening the native destination consumes Analyze state");
  assert.equal(managementOpening.monsterManagement.style, 4);
  assert.equal(managementOpening.monsterManagement.editable, false);
  assert.equal(managementOpening.monsterManagement.title, "View Party Order");
  assert.deepEqual(
    managementOpening.monsterManagement.cards.map((card) => card.id),
    managementOpening.enemyBenchIds,
    "style 4 must snapshot current replacementMembers in source order",
  );
  assert.equal(managementOpening.monsterManagement.showingId, managementOpening.enemyBenchIds[0]);


  assert.equal(managementOpening.monsterManagement.backgroundAlpha, 1);
  assert.equal(managementOpening.monsterManagement.backgroundTint, 0x505050);

  // The full-screen notification node swallows the still-visible battle panel. A tap at a real
  // ability button must neither choose an ability nor remove the management screen.
  const underlayAbility = managementOpening.abilityButtons[0];
  assert(underlayAbility);
  const underlayQueue = managementOpening.queue;
  await clickBattlePoint(withReserves, underlayAbility.center);
  const swallowed = await withReserves.state();
  assert.equal(swallowed.activePopup, "monsterManagement");
  assert.deepEqual(swallowed.queue, underlayQueue);
  assert.equal(swallowed.presentation.state, "enemyReserveManagement");

  await withReserves.advance(500);
  const management = await withReserves.state();
  assert.equal(management.monsterManagement.backgroundAlpha, 1);
  assert.equal(management.monsterManagement.cards[0].alpha, 1);
  if (management.monsterManagement.cards.length > 1) {
    const side = management.monsterManagement.cards[1];
    assert(Math.abs(side.orbitDeg) === 75);
    assert(side.alpha < 1, "side-card backing did not receive the source opacity fade");
    assert.equal(side.contentAlpha, 1, "source background opacity incorrectly cascaded to card content");
    assert.equal(side.scaleX, 1, "projective CFlow must not retain the old affine cosine squeeze");
    const leftHeight = side.projectedQuad.bottomLeft.y - side.projectedQuad.topLeft.y;
    const rightHeight = side.projectedQuad.bottomRight.y - side.projectedQuad.topRight.y;
    assert(
      Math.abs(rightHeight - leftHeight) > 1,
      "75-degree source camera did not produce different near/far card-edge heights",
    );
    assert(
      Math.abs(side.projectedQuad.topRight.y - side.projectedQuad.topLeft.y) > 1,
      "75-degree source camera did not slope the card's top edge",
    );
  }
  await waitForText(withReserves.page, "View Party Order");
  await withReserves.page.screenshot({ path: path.join(outputDir, "reserve-management-open.png"), timeout: 120_000 });

  if (management.monsterManagement.cards.length > 1) {
    const side = management.monsterManagement.cards[1];
    await clickBattlePoint(withReserves, side.center);
    const selectedSecond = await waitFor(
      withReserves,
      (s) => s.monsterManagement?.showingIndex === 1 && s.monsterManagement.actualSelectedIndex === 1,
      "tapping a side card did not select/ease it to center",
    );
    assert.equal(selectedSecond.monsterManagement.showingId, side.id);

    // Exact CFlow drag normalization: one 80pt rightward drag returns from index 1 to index 0.
    const center = selectedSecond.monsterManagement.cards[1].center;
    const startCss = withReserves.geometry.toCss(center);
    const endCss = withReserves.geometry.toCss({ x: center.x + 80, y: center.y });
    await withReserves.page.mouse.move(startCss.x, startCss.y);
    await withReserves.page.mouse.down();
    await withReserves.advance(16);
    await withReserves.page.mouse.move(endCss.x, endCss.y, { steps: 4 });
    await withReserves.advance(16);
    await withReserves.page.mouse.up();
    const draggedFirst = await waitFor(
      withReserves,
      (s) => s.monsterManagement?.showingIndex === 0 && s.monsterManagement.actualSelectedIndex === 0,
      "80pt coverflow drag did not return to the first reserve",
    );
    assert.equal(draggedFirst.monsterManagement.showingId, management.enemyBenchIds[0]);

    await clickBattlePoint(withReserves, draggedFirst.monsterManagement.cards[1].center);
    await waitFor(withReserves, (s) => s.monsterManagement?.showingIndex === 1, "side-card retry did not center");

    // Drive the five-card post-promotion reserve list from index 1 to index 4. While the visual
    // selection eases through 3..3.5, card 0 is the rounded selection's outermost visible card
    // and the adjacent arrangement places it at distance four. Source updateValues continues
    // it outward past x=-120, then toggles visibility at roundf's midpoint. The old port instead
    // blended against an invented invisible x=0 layout and visibly reversed toward the center.
    const selectedFirstSide = await waitFor(
      withReserves,
      (s) => Math.abs(s.monsterManagement.selectedIndex - 1) < 0.01,
      "side-card selection did not settle before the outer-boundary drag",
    );
    assert(selectedFirstSide.monsterManagement.cards.length >= 5, "fixture needs a distance-four reserve card");
    const dragCenter = selectedFirstSide.monsterManagement.cards[1].center;
    const dragStartCss = withReserves.geometry.toCss(dragCenter);
    const dragEndCss = withReserves.geometry.toCss({ x: dragCenter.x - 240, y: dragCenter.y });
    await withReserves.page.mouse.move(dragStartCss.x, dragStartCss.y);
    await withReserves.page.mouse.down();
    await withReserves.advance(16);
    await withReserves.page.mouse.move(dragEndCss.x, dragEndCss.y, { steps: 4 });
    await withReserves.advance(16);
    await withReserves.page.mouse.up();

    const outerSamples = [];
    let firstHidden = null;
    let capturedOuterArc = false;
    for (let i = 0; i < 120; i++) {
      const sample = await withReserves.state();
      const card0 = sample.monsterManagement.cards[0];
      if (sample.monsterManagement.presentedIndex >= 3 && card0.visible) {
        outerSamples.push(sample);
        if (!capturedOuterArc && sample.monsterManagement.presentedIndex >= 3.4) {
          await withReserves.page.screenshot({ path: path.join(outputDir, "reserve-management-outer-arc.png"), timeout: 120_000 });
          capturedOuterArc = true;
        }
      }
      if (!card0.visible) {
        firstHidden = sample;
        break;
      }
      await withReserves.advance(16);
    }
    assert(outerSamples.length > 0, "did not observe the outgoing card inside the distance-three boundary");
    for (let i = 1; i < outerSamples.length; i++) {
      assert(
        outerSamples[i].monsterManagement.cards[0].center.x <=
          outerSamples[i - 1].monsterManagement.cards[0].center.x + 1e-6,
        "outgoing reserve card reversed toward the center before disappearing",
      );
    }
    const lastVisibleOuter = outerSamples.at(-1);
    const carouselCenterX = lastVisibleOuter.screenPt.w / 2;
    assert(
      lastVisibleOuter.monsterManagement.cards[0].center.x < carouselCenterX - 120,
      "distance-four interpolation did not widen the outer coverflow arc past the distance-three center",
    );
    assert(firstHidden, "outgoing distance-four card never left the three-card visibility window");
    // Visibility is rendered from the sub-frame presentation lane. The exact source/logical lane
    // intentionally remains behind it and continues to own drag gain + showing selection.
    assert(firstHidden.monsterManagement.presentedIndex >= 3.5);
    assert(capturedOuterArc, "did not capture the last visible portion of the widened outer arc");
  }

  let evolvedDetail = await withReserves.state();
  if (evolvedDetail.monsterManagement.detail.evolution !== null) {
    evolvedDetail = await waitFor(
      withReserves,
      (s) => s.monsterManagement.detail.summaryAlpha > 0 && s.monsterManagement.detail.summaryAlpha < 1,
      "2.0s hold did not enter the 0.2s detail cross-fade",
      120,
    );
    assert(Math.abs(
      evolvedDetail.monsterManagement.detail.summaryAlpha +
      evolvedDetail.monsterManagement.detail.evolutionAlpha - 1
    ) < 1e-6);
    await waitForText(withReserves.page, evolvedDetail.monsterManagement.detail.evolution);
  }
  await withReserves.page.screenshot({ path: path.join(outputDir, "reserve-management-selected.png"), timeout: 120_000 });



  const badgeCard = evolvedDetail.monsterManagement.cards[evolvedDetail.monsterManagement.showingIndex];
  await clickBattlePoint(withReserves, badgeCard.badgeCenter);
  const elementHelp = await waitFor(
    withReserves,
    (s) => (s.activePopup ?? "").startsWith("element:") && s.monsterManagement,
    "centered-card badge tap did not open the element help popup",
  );
  assert.equal(elementHelp.monsterManagement.showingId, badgeCard.id, "badge tap must not change the selection");
  await waitForPopupCard(withReserves.page);
  await withReserves.advance(250);
  await withReserves.page.screenshot({ path: path.join(outputDir, "reserve-element-help.png"), timeout: 120_000 });
  await closeOk(withReserves, "monsterManagement");

  // A selected/centered card's second tap stacks LivingInfo above MMScreen. Closing LivingInfo
  // restores the view-only screen; it does not dismiss or mutate replacementMembers.
  const centered = (await withReserves.state()).monsterManagement.cards[evolvedDetail.monsterManagement.showingIndex];
  await clickBattlePoint(withReserves, centered.center);
  const reserveInfo = await waitFor(
    withReserves,
    (s) => (s.activePopup ?? "").startsWith("livingInfo") && s.monsterManagement,
    "second tap on the centered reserve did not stack LivingInfo",
  );
  assert.equal(reserveInfo.monsterManagement.showingId, centered.id);
  await waitForPopupCard(withReserves.page);
  await withReserves.advance(250);
  await withReserves.page.screenshot({ path: path.join(outputDir, "reserve-living-info-stacked.png"), timeout: 120_000 });
  await closeOk(withReserves, "monsterManagement");
  assert((await withReserves.state()).monsterManagement, "closing LivingInfo must restore MonsterManagementNode");

  const beforeClose = await withReserves.state();
  await clickBattlePoint(withReserves, beforeClose.monsterManagement.closeCenter);
  const afterClose = await waitFor(
    withReserves,
    (s) => s.monsterManagement === null && s.activePopup === null,
    "native close sprite did not synchronously dismiss the reserve viewer",
  );
  assert.equal(afterClose.enemyAnalyze.enabled, false);
  assert.deepEqual(afterClose.enemyBenchIds, beforeClose.enemyBenchIds, "view-only screen must not reorder reserves");




  assert.equal(afterClose.enemyAnalyze.blinking, true, "nothing in the binary ever stops the blink");
  await clickBattlePoint(withReserves, afterClose.enemyBenchCenter);
  await waitFor(withReserves, (s) => s.activePopup === "analyzeNotReady", "consumed counter must fall back to the AnalyzeNotReady branch");
  await closeOk(withReserves);

  // Body taps on an originally analyzed survivor route to LivingInfo, not stars. The source's
  // counter destination does not clear the per-enemy displays' analyzed state when it consumes
  // the team-level Analyze gate.
  const bodyBefore = await withReserves.state();
  const analyzedSurvivorId = bodyBefore.enemyAnalyze.analyzedMonsterIds.find(
    (id) => bodyBefore.monsters.some((monster) => monster.id === id),
  );
  assert(analyzedSurvivorId);
  const enemy = bodyBefore.monsters.find((monster) => monster.id === analyzedSurvivorId);
  const starsBefore = enemy.starGroups;
  await clickBattlePoint(withReserves, enemy.targetPoint);
  const bodyInfo = await waitFor(withReserves, (s) => (s.activePopup ?? "").startsWith("livingInfo"), "analyzed enemy body did not open LivingInfo");
  assert.equal(bodyInfo.monsters.find((monster) => monster.id === enemy.id).starGroups, starsBefore);
  await waitForPopupCard(withReserves.page);
  await withReserves.advance(250);
  await closeOk(withReserves);
  assert.deepEqual(withReserves.errors, []);
  await withReserves.page.close();

  const withoutReserves = await openBattle({
    backgroundKey: "ForestCombat",
    playerTeam: [{ shortType: "Penguin", level: 100 }],
    enemyTeam: [{ shortType: "Minotaur", level: 1 }],
  });
  await useAnalyze(withoutReserves);
  // Wait for a STABLE player choice before tapping the counter. The label is visible well before
  // the panel returns, and a tap landing during turnComplete/turnLeadIn is simply swallowed — the
  // old predicate let the click fire at a non-interactive moment and then never retried.
  const zero = await waitFor(
    withoutReserves,
    (s) => s.enemyAnalyze.labelVisible && s.enemyBenchCenter
      && s.presentation.state === "awaitingPlayerChoice" && s.panelVisible,
    "zero counter unavailable",
    1200,
  );
  assert.equal(zero.enemyBenchCountShown, 0);
  await clickBattlePoint(withoutReserves, zero.enemyBenchCenter);
  await waitFor(withoutReserves, (s) => s.activePopup === "noMonstersToAnalyze", "post-Analyze empty counter branch missing");
  await waitForText(withoutReserves.page, "A number in this button indicates how many reinforcements are ready to replace defeated enemy monsters. There are none in this battle.");
  await withoutReserves.advance(250);
  const emptyText = await renderedTexts(withoutReserves.page);
  assert(emptyText.includes("No Reinforcements"));
  assert(emptyText.includes("A number in this button indicates how many reinforcements are ready to replace defeated enemy monsters. There are none in this battle."));
  await withoutReserves.page.screenshot({ path: path.join(outputDir, "counter-no-reinforcements.png"), timeout: 120_000 });
  assert.deepEqual(withoutReserves.errors, []);
  await withoutReserves.page.close();

  console.log("enemy-analyze-reserves: PASS (counter branches, Analyze bodies/promotions, style-4 reserve management)");
} finally {
  await browser.close();
}
