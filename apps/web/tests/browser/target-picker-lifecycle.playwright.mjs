import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter } from "./fixtures.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const parsedUrl = new URL(url);
assert.equal(parsedUrl.protocol, "http:", "target-picker lifecycle proof requires an http localhost server");
assert.equal(parsedUrl.hostname, "localhost", "target-picker lifecycle proof rejects non-localhost servers");

// Existing browser fixtures establish these as shipped, importer-supported choices. No target mode
// is fabricated here: Desoul is self-only, AttackAll is all-enemy, and Minotaur's usable2 is the
// real two-enemy Offensive.DoubleAttack.
const SELF_ONLY_BATTLE = {
  backgroundKey: "ForestCombat",
  blockSaveMe: true,
  playerTeam: [
    { shortType: "Manticore", level: 12, soulStone: { element: "Fire", level: 40, sourceType: "FireCub" } },
  ],
  enemyTeam: [{ shortType: "Minotaur", level: 12 }],
};
const ALL_ENEMY_BATTLE = {
  backgroundKey: "ForestCombat",
  blockSaveMe: true,
  playerTeam: [{ shortType: "DonPen", level: 12 }],
  enemyTeam: [
    { shortType: "Minotaur", level: 12 },
    { shortType: "Spark", level: 12 },
    { shortType: "UnhappyBird", level: 12 },
  ],
};
const MANUAL_MULTI_BATTLE = {
  backgroundKey: "ForestCombat",
  blockSaveMe: true,
  playerTeam: [{ shortType: "Minotaur", level: 50 }],
  enemyTeam: [
    { shortType: "Spark", level: 12 },
    { shortType: "UnhappyBird", level: 12 },
  ],
};

const state = async (page) => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const advance = (page, ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

async function settle(page, predicate, label, maxSteps = 180) {
  for (let step = 0; step < maxSteps; step++) {
    const current = await state(page);
    if (predicate(current)) return current;
    await advance(page, 50);
    if (step % 20 === 0) await page.waitForTimeout(10);
  }
  throw new Error(`${label}; last state: ${JSON.stringify(await state(page))}`);
}

async function settledField(page, field, label) {
  let previous = "";
  for (let step = 0; step < 80; step++) {
    const current = await state(page);
    const serialized = JSON.stringify(current[field]);
    // Card geometry is published before the panel has finished becoming interactive. A reported
    // ButtonSprite center is only safe to click once the panel owns input too.
    if (serialized !== "" && serialized === previous && current.panelVisible === true) return current;
    previous = serialized;
    await advance(page, 50);
    if (step % 20 === 0) await page.waitForTimeout(10);
  }
  throw new Error(`${label} never settled: ${JSON.stringify((await state(page))[field])}`);
}

async function bootBattle(browser, encounter) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
  });
  await pinEncounter(page, encounter);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box, "battle canvas must be measurable");
  await settle(page, (current) => current.startup?.phase === "title", "title did not settle before target-picker fixture");
  await page.waitForTimeout(100);
  await advance(page, 16.67);
  await page.waitForTimeout(100);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const startup = await settle(
    page,
    (current) => current.mode === "battle" || current.startup?.phase === "save-select",
    "title did not reach save selection for target-picker fixture",
  );
  if (startup.startup?.phase === "save-select") {
    await advance(page, 250);
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `slot-1 must be enabled after title transition: ${JSON.stringify(startup.startup)}`);
    await clickBattlePoint(page, box, { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  }
  await settle(
    page,
    (current) => current.presentation?.state === "awaitingPlayerChoice" && current.statusText?.visible === false,
    "battle never reached an unlocked player choice",
    360,
  );
  return { page, box, errors };
}

async function clickBattlePoint(page, box, point) {
  const { toCss } = await stageGeometry(page, box);
  const css = toCss(point);
  await page.mouse.click(css.x, css.y);
}

async function clickVisibleNodeLocalPoint(page, box, label, localPoint, ownerLabel = label) {
  const target = await page.evaluate(({ wanted, point }) => {
    const stack = [window.__PIXI_APP__.stage];
    const isVisible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && !node.destroyed && isVisible(node)) {
        const global = node.toGlobal(point);
        const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(global.x, global.y);
        const hitPath = [];
        for (let current = hit; current; current = current.parent) hitPath.push(current.label ?? null);
        const nodePath = [];
        for (let current = node; current; current = current.parent) {
          nodePath.push({
            label: current.label ?? null,
            eventMode: current.eventMode,
            interactiveChildren: current.interactiveChildren,
            measurable: current.measurable,
            visible: current.visible,
            renderable: current.renderable,
            hasHitArea: current.hitArea !== null,
          });
        }
        return {
          global: { x: global.x, y: global.y },
          localHit: node.hitArea?.contains(point.x, point.y) ?? false,
          hitPath,
          nodePath,
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, { wanted: label, point: localPoint });
  assert(target, `missing visible Pixi node ${label}`);
  if (ownerLabel === label) {
    assert.equal(target.localHit, true, `${label} rejected its authored local edge point`);
  }
  assert(target.hitPath.includes(ownerLabel),
    `${ownerLabel} did not own ${label}'s authored local edge point: ${JSON.stringify(target)}`);
  await page.mouse.click(box.x + target.global.x, box.y + target.global.y);
}

function assertPickerCleared(current, label) {
  assert.equal(current.picking, false, `${label}: picker ownership must be cleared`);
  assert.equal(current.targetPickerVisuals.cancel, null, `${label}: cancel button must be removed`);
  assert.deepEqual(current.targetPickerVisuals.outlines, [], `${label}: target outlines must be removed`);
}

async function proveSelfOnlyAutoComplete(browser) {
  const ctx = await bootBattle(browser, SELF_ONLY_BATTLE);
  try {
    const ready = await settledField(ctx.page, "abilityButtons", "self-only panel buttons");
    const ability = ready.abilityButtons.find((button) => button.abilityPath === "Utility.Desoul");
    assert(ability, `Manticore must expose self-only Utility.Desoul: ${JSON.stringify(ready.abilityButtons)}`);
    await clickBattlePoint(ctx.page, ctx.box, ability.center);
    const submitted = await settle(
      ctx.page,
      (current) => current.battleInput.latestPlayerSubmission?.abilityPath === "Utility.Desoul",
      "self-only Utility.Desoul did not auto-submit",
    );
    assert.deepEqual(submitted.battleInput.latestPlayerSubmission, {
      actorId: ready.activeActorId,
      slot: `usable${ability.slot}`,
      abilityPath: "Utility.Desoul",
      selectedTargetIds: [],
      submittedTargetIds: [],
    });
    assertPickerCleared(submitted, "self-only auto-complete");
    assert.equal(submitted.panelVisible, false, "self-only completion must release the panel to ability presentation");
    assert.deepEqual(ctx.errors, [], `self-only page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

async function proveAllEnemyAutoComplete(browser) {
  const ctx = await bootBattle(browser, ALL_ENEMY_BATTLE);
  try {
    const ready = await settledField(ctx.page, "abilityButtons", "all-enemy panel buttons");
    const ability = ready.abilityButtons.find((button) => button.abilityPath === "Offensive.AttackAll");
    assert(ability, `DonPen must expose all-enemy Offensive.AttackAll: ${JSON.stringify(ready.abilityButtons)}`);
    // BattleNode feeds TargetPicker its live enemy pool from queueOrder(), not renderer array
    // order. Preserve that source-owned candidate order for the all-target auto-picked array.
    const visibleEnemyIds = new Set(ready.monsters.filter((monster) => monster.team === 1 && monster.visible).map((monster) => monster.id));
    const enemyIds = ready.queue.filter((id) => visibleEnemyIds.has(id));
    assert.equal(enemyIds.length, 3, `all-enemy fixture must expose three live targets: ${JSON.stringify(ready.monsters)}`);
    await clickBattlePoint(ctx.page, ctx.box, ability.center);
    const submitted = await settle(
      ctx.page,
      (current) => current.battleInput.latestPlayerSubmission?.abilityPath === "Offensive.AttackAll",
      "all-enemy Offensive.AttackAll did not auto-submit",
    );
    assert.deepEqual(submitted.battleInput.latestPlayerSubmission, {
      actorId: ready.activeActorId,
      slot: `usable${ability.slot}`,
      abilityPath: "Offensive.AttackAll",
      selectedTargetIds: enemyIds,
      submittedTargetIds: [],
    });
    assertPickerCleared(submitted, "all-enemy auto-complete");
    assert.equal(submitted.panelVisible, false, "all-enemy completion must release the panel to ability presentation");
    assert.deepEqual(ctx.errors, [], `all-enemy page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

async function proveManualMultiTargetLifecycle(browser) {
  const ctx = await bootBattle(browser, MANUAL_MULTI_BATTLE);
  try {
    const ready = await settledField(ctx.page, "abilityButtons", "manual multi-target panel buttons");
    const ability = ready.abilityButtons.find((button) => button.abilityPath === "Offensive.DoubleAttack");
    assert(ability, `Minotaur must expose shipped two-target Offensive.DoubleAttack: ${JSON.stringify(ready.abilityButtons)}`);
    const enemyIds = ready.monsters.filter((monster) => monster.team === 1 && monster.visible).map((monster) => monster.id);
    assert.equal(enemyIds.length, 2, `manual fixture must expose two live enemy targets: ${JSON.stringify(ready.monsters)}`);
    const enemyById = new Map(ready.monsters.map((monster) => [monster.id, monster]));
    const friendlyId = ready.monsters.find((monster) => monster.team === 0)?.id;
    assert(friendlyId, "manual fixture must retain its friendly target identity while the panel is shown");
    assert(enemyIds.every((id) => enemyById.get(id)?.targetPoint), "manual fixture must expose stable enemy target points");

    await clickBattlePoint(ctx.page, ctx.box, ability.center);
    let picking = await settle(
      ctx.page,
      (current) => current.picking === true && current.panelVisible === false &&
        current.targetPickerVisuals.cancel !== null && current.targetPickerVisuals.outlines.length === enemyIds.length,
      "Offensive.DoubleAttack did not enter the two-enemy picker",
    );
    assert.deepEqual(
      picking.targetPickerVisuals.outlines.map((outline) => outline.id),
      enemyIds,
      "manual picker must initially outline the exact live enemy target pool",
    );
    const pickerEnemyById = new Map(picking.monsters.map((monster) => [monster.id, monster]));
    const expectedEnemyTargetHeight = picking.displayMode === "ipad" ? 274 : 210;
    for (const id of enemyIds) {
      const enemy = pickerEnemyById.get(id);
      assert(
        enemy?.targetSize &&
          Math.abs(enemy.targetSize.w - 128) < 1e-6 &&
          Math.abs(enemy.targetSize.h - expectedEnemyTargetHeight) < 1e-6,
        `manual target ${id} must expose the full EnemyMonsterDisplay content box`,
      );
    }
    const edgeTarget = pickerEnemyById.get(enemyIds[0]);
    assert(
      edgeTarget?.targetPoint && edgeTarget?.targetSize &&
        edgeTarget?.visualTargetPoint && edgeTarget?.visualTargetSize,
      "manual picker must report both full hit geometry and silhouette geometry",
    );
    const edgePickPoint = {
      x: edgeTarget.targetPoint.x,
      y: edgeTarget.targetPoint.y + edgeTarget.targetSize.h / 2 - 2,
    };
    assert(
      edgePickPoint.y >= edgeTarget.visualTargetPoint.y + edgeTarget.visualTargetSize.h / 2,
      `edge proof point must be below the monster artwork: ${JSON.stringify({ edgePickPoint, edgeTarget })}`,
    );
    const friendly = picking.monsters.find((monster) => monster.id === friendlyId && monster.visible);
    assert(friendly?.targetPoint, "manual picker must restore the friendly target point for the miss branch");

    // A friendly hit while the enemy phase is active is a source miss: it must not pick, submit,
    // or open LivingInfo, AND it must play notAllowed.m4a (targetPickerMath.ts §2). The effect
    // channel is WebAudio, so the sound identity comes from AudioPlayer's read-only tally.
    const beforeMiss = picking.audio.sfxCounts["notAllowed"] ?? 0;
    await clickBattlePoint(ctx.page, ctx.box, friendly.targetPoint);
    for (let i = 0; i < 8; i++) await advance(ctx.page, 50);
    picking = await state(ctx.page);
    assert.equal(
      picking.audio.sfxCounts["notAllowed"] ?? 0,
      beforeMiss + 1,
      "manual-picker miss must play exactly one notAllowed.m4a",
    );
    assert.equal(picking.audio.lastSfx, "notAllowed", "the miss must be the most recent effect-channel sound");
    assert.equal(picking.picking, true, "friendly miss must retain manual picker ownership");
    assert.equal(picking.activePopup, null, "friendly miss must not open LivingInfo over TargetPicker");
    assert.equal(picking.battleInput.latestPlayerSubmission, null, "friendly miss must not submit a player action");
    assert.deepEqual(picking.targetPickerVisuals.outlines.map((outline) => outline.id), enemyIds, "miss must retain the enemy outline pool");

    // First selected enemy remains in the callback pool but loses its outline. A duplicate tap is
    // silent and leaves that partial state unchanged until cancel/retry.
    await clickVisibleNodeLocalPoint(
      ctx.page,
      ctx.box,
      `enemyDisplay:${enemyIds[0]}`,
      { x: edgeTarget.targetSize.w / 2, y: edgeTarget.targetSize.h - 2 },
      "targetPicker",
    );
    picking = await settle(
      ctx.page,
      (current) => current.picking === true && current.targetPickerVisuals.outlines.length === 1,
      "first manual enemy pick did not retain one remaining outline",
    );
    assert.deepEqual(picking.targetPickerVisuals.outlines.map((outline) => outline.id), [enemyIds[1]], "first pick must remove only the selected enemy outline");
    const beforeDuplicate = (await state(ctx.page)).audio.sfxCounts;
    await clickBattlePoint(ctx.page, ctx.box, enemyById.get(enemyIds[0]).targetPoint);
    for (let i = 0; i < 8; i++) await advance(ctx.page, 50);
    const afterDuplicate = await state(ctx.page);


    assert.deepEqual(
      afterDuplicate.audio.sfxCounts,
      beforeDuplicate,
      "duplicate target tap must be silent, not a miss or an accept",
    );
    assert.equal(afterDuplicate.picking, true, "duplicate target tap must not finish picking");
    assert.equal(afterDuplicate.battleInput.latestPlayerSubmission, null, "duplicate target tap must not submit");
    assert.deepEqual(afterDuplicate.targetPickerVisuals.outlines.map((outline) => outline.id), [enemyIds[1]], "duplicate target tap must leave the remaining outline unchanged");

    const cancel = afterDuplicate.targetPickerVisuals.cancel;
    assert(cancel, "partial manual picker must retain the reported cancel button");
    await clickBattlePoint(ctx.page, ctx.box, { x: cancel.x + cancel.w / 2, y: cancel.y + cancel.h / 2 });
    const cancelled = await settle(
      ctx.page,
      (current) => current.picking === false && current.panelVisible === true &&
        current.targetPickerVisuals.cancel === null && current.targetPickerVisuals.outlines.length === 0,
      "cancel did not restore panel and remove picker visuals",
    );
    assert.equal(cancelled.battleInput.latestPlayerSubmission, null, "cancelled partial picker must not submit a player action");
    const restored = await settledField(ctx.page, "abilityButtons", "restored panel buttons");
    assert.deepEqual(restored.abilityButtons, ready.abilityButtons, "cancel must restore the same panel cards and geometry");

    // Retry the real ability, select both enemies in reported order, and verify the exact flat
    // target array that reaches BattleNode's player-action submission seam.
    const retryAbility = restored.abilityButtons.find((button) => button.abilityPath === "Offensive.DoubleAttack");
    assert(retryAbility, "retry panel must retain Offensive.DoubleAttack");
    await clickBattlePoint(ctx.page, ctx.box, retryAbility.center);
    await settle(ctx.page, (current) => current.picking === true && current.targetPickerVisuals.outlines.length === 2, "retry did not re-open manual picker");
    await clickBattlePoint(ctx.page, ctx.box, enemyById.get(enemyIds[0]).targetPoint);
    await settle(ctx.page, (current) => current.picking === true && current.targetPickerVisuals.outlines.length === 1, "retry first pick did not retain the picker");
    await clickBattlePoint(ctx.page, ctx.box, enemyById.get(enemyIds[1]).targetPoint);
    const submitted = await settle(
      ctx.page,
      (current) => current.battleInput.latestPlayerSubmission?.abilityPath === "Offensive.DoubleAttack",
      "retry completion did not submit Offensive.DoubleAttack",
    );
    assert.deepEqual(submitted.battleInput.latestPlayerSubmission, {
      actorId: ready.activeActorId,
      slot: `usable${retryAbility.slot}`,
      abilityPath: "Offensive.DoubleAttack",
      selectedTargetIds: enemyIds,
      submittedTargetIds: enemyIds,
    });
    assertPickerCleared(submitted, "manual retry completion");
    assert.equal(submitted.panelVisible, false, "manual completion must release panel ownership to ability presentation");
    assert.deepEqual(ctx.errors, [], `manual lifecycle page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}


const MANUAL_ENEMY_BEFORE_FRIEND_BLOCKER =
  "No shipped/importer-supported ability reaches a manual enemy-then-friendly TargetPicker phase; SleepAllTeams is auto all-target.";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  await proveSelfOnlyAutoComplete(browser);
  await proveAllEnemyAutoComplete(browser);
  await proveManualMultiTargetLifecycle(browser);
  console.log(`target-picker-lifecycle: EXCLUDED (no shipped data) ${MANUAL_ENEMY_BEFORE_FRIEND_BLOCKER}`);
  console.log("target-picker-lifecycle: PASS (full-display edge hit, self/all auto-complete, miss+duplicate state, cancel/retry, exact submission, and teardown)");
} finally {
  await browser.close();
}
