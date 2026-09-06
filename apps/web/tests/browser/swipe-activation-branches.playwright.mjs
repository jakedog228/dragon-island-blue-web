


import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter, STANDARD_BATTLE } from "./fixtures.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const parsedUrl = new URL(url);
assert.equal(parsedUrl.protocol, "http:", "swipe branch proof requires an http localhost server");
assert.equal(parsedUrl.hostname, "localhost", "swipe branch proof rejects non-localhost servers");

// `turnPanelMath.ts`'s SWIPE_DIRECTION_BY_SLOT. Duplicated rather than imported: this file drives
// the built app through the browser, and a scenario that silently inherited a changed mapping would
// stop testing the mapping at all.
const SWIPE_DIRECTION_BY_SLOT = { 1: "leftToRight", 2: "rightToLeft", 3: "upToDown", 4: "downToUp" };


const BLOCKED_SWIPE_BATTLE = {
  backgroundKey: "ForestCombat",
  blockSaveMe: true,
  playerTeam: [
    { shortType: "Kaguya", level: 50 },
    { shortType: "SnowCub", level: 12 },
    { shortType: "WhiteDragonling", level: 12 },
  ],
  enemyTeam: [{ shortType: "Minotaur", level: 12 }],
};

// DonPen's Offensive.AttackAll is the all-enemy shape, proven live against three enemies.
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

const state = async (page) => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const advance = (page, ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

async function settle(page, predicate, label, maxSteps = 360) {
  for (let step = 0; step < maxSteps; step++) {
    const current = await state(page);
    if (predicate(current)) return current;
    await advance(page, 50);
    // The deterministic ticker must still yield to real asset fetches; a tight advanceTime loop
    // strands the battle in "building" with no visible page error.
    if (step % 20 === 0) await page.waitForTimeout(10);
  }
  throw new Error(`${label}; last state: ${JSON.stringify(await state(page))}`);
}

async function settledPanel(page, label) {
  let previous = "";
  for (let step = 0; step < 80; step++) {
    const current = await state(page);
    const serialized = JSON.stringify(current.abilityButtons);
    // Card geometry is published before the panel finishes becoming interactive; a reported centre
    // is only safe to drive once the panel owns input too.
    if (serialized !== "" && serialized === previous && current.panelVisible === true) return current;
    previous = serialized;
    await advance(page, 50);
    if (step % 20 === 0) await page.waitForTimeout(10);
  }
  throw new Error(`${label} never settled: ${JSON.stringify((await state(page)).abilityButtons)}`);
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
  const box = await page.locator("canvas").first().boundingBox();
  assert(box, "battle canvas must be measurable");
  await settle(page, (current) => current.startup?.phase === "title", "title did not settle before swipe fixture");
  await page.waitForTimeout(100);
  await advance(page, 16.67);
  await page.waitForTimeout(100);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const startup = await settle(
    page,
    (current) => current.mode === "battle" || current.startup?.phase === "save-select",
    "title did not reach save selection for swipe fixture",
  );
  if (startup.startup?.phase === "save-select") {
    await advance(page, 250);
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `slot-1 must be enabled after title transition: ${JSON.stringify(startup.startup)}`);
    const { toCss } = await stageGeometry(page, box);
    const css = toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(css.x, css.y);
  }
  await settle(
    page,
    (current) => current.presentation?.state === "awaitingPlayerChoice" && current.statusText?.visible === false,
    "battle never reached an unlocked player choice",
  );
  return { page, box, errors };
}

/** Drives one recognized directional stroke centred on `midpoint` (battle points). Endpoints sit
 *  outside any interactive sprite so the scene recognizer — not a ButtonSprite — owns the input,
 *  and the span is well past the recognizer's ~20pt activation threshold. */
async function swipe(page, box, direction, midpoint, span = 60) {
  const { toCss } = await stageGeometry(page, box);
  const half = span / 2;
  const lanes = {
    leftToRight: [{ x: midpoint.x - half, y: midpoint.y }, { x: midpoint.x + half, y: midpoint.y }],
    rightToLeft: [{ x: midpoint.x + half, y: midpoint.y }, { x: midpoint.x - half, y: midpoint.y }],
    upToDown: [{ x: midpoint.x, y: midpoint.y - half }, { x: midpoint.x, y: midpoint.y + half }],
    downToUp: [{ x: midpoint.x, y: midpoint.y + half }, { x: midpoint.x, y: midpoint.y - half }],
  };
  const [from, to] = lanes[direction];
  const start = toCss(from);
  const end = toCss(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(50);
  for (let i = 0; i < 6; i++) await advance(page, 50);
}

/** A battle point inside the field that lies outside EVERY live enemy's target bounds — the
 *  midpoint `handleRecognizer:` resolves against. Derived from live geometry, never hardcoded. */
function pointMissingEveryEnemy(snapshot) {
  const enemies = snapshot.monsters.filter((monster) => monster.team === 1 && monster.visible);
  assert(enemies.length > 0, "fixture must expose at least one live enemy to miss");
  const bounds = enemies.map((enemy) => ({
    minX: enemy.targetPoint.x - enemy.targetSize.w / 2,
    maxX: enemy.targetPoint.x + enemy.targetSize.w / 2,
    minY: enemy.targetPoint.y - enemy.targetSize.h / 2,
    maxY: enemy.targetPoint.y + enemy.targetSize.h / 2,
  }));
  const leftmost = Math.min(...bounds.map((b) => b.minX));
  // Sit well left of the leftmost enemy, at their vertical mid-band so the miss is horizontal-only.
  const candidate = { x: Math.max(12, leftmost - 60), y: bounds[0].minY + (bounds[0].maxY - bounds[0].minY) / 2 };
  const inside = bounds.some((b) => candidate.x >= b.minX && candidate.x <= b.maxX && candidate.y >= b.minY && candidate.y <= b.maxY);
  assert(!inside, `derived miss point ${JSON.stringify(candidate)} still lands on an enemy: ${JSON.stringify(bounds)}`);
  return candidate;
}

async function proveBlockedSwipeIsRefused(browser) {
  const ctx = await bootBattle(browser, BLOCKED_SWIPE_BATTLE);
  try {
    // Kaguya is the fixture's only level-50 member, but turn order is engine-owned: wait for its
    // panel rather than assuming it leads.
    let ready = await settledPanel(ctx.page, "blocked-swipe panel buttons");
    for (let attempt = 0; attempt < 6 && !ready.abilityButtons.some((b) => b.abilityPath === "Utility.AddMonsterFromEnemyTeam"); attempt++) {
      await settle(ctx.page, (current) => current.panelVisible === false, "panel never closed while seeking Kaguya");
      await settle(ctx.page, (current) => current.presentation?.state === "awaitingPlayerChoice", "battle never returned to a player choice");
      ready = await settledPanel(ctx.page, "blocked-swipe panel buttons (retry)");
    }
    const blocked = ready.abilityButtons.find((button) => button.abilityPath === "Utility.AddMonsterFromEnemyTeam");
    assert(blocked, `Kaguya must expose the blockable swipeable Puppet card: ${JSON.stringify(ready.abilityButtons)}`);
    assert.equal(blocked.slot, 4, "Puppet is Kaguya's usable4, which owns the downToUp gesture");
    assert.equal(ready.battleInput.latestPlayerSubmission, null, "fixture must start with no submission");

    const before = await state(ctx.page);
    const notAllowedBefore = before.audio.sfxCounts["notAllowed"] ?? 0;
    await swipe(ctx.page, ctx.box, SWIPE_DIRECTION_BY_SLOT[blocked.slot], pointMissingEveryEnemy(before));

    const after = await settle(
      ctx.page,
      (current) => current.activePopup === "message:NoRoomToAddMonster",
      "blocked swipe did not raise its source block-reason popup",
    );
    // The block is refused BEFORE target resolution, so it is not the empty-candidate notAllowed
    // exit: the swipe-feedback channel must stay untouched and nothing may queue.
    assert.equal(after.battleInput.latestPlayerSubmission, null, "a blocked ability must never queue from a swipe");
    assert.equal(after.battleInput.latestSwipeTargetFeedback, null, "a block is not the empty-target notAllowed branch");
    assert.equal(after.battleInput.swipeTargetFeedbackCount, before.battleInput.swipeTargetFeedbackCount, "block must not increment swipe target feedback");
    assert.equal(after.audio.sfxCounts["notAllowed"] ?? 0, notAllowedBefore, "block popup must not play the swipe-miss sound");
    assert.equal(after.picking, false, "a blocked swipe must not open a target picker");
    assert.deepEqual(ctx.errors, [], `blocked-swipe page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

async function proveInvalidSwipeFeedback(browser) {
  const ctx = await bootBattle(browser, STANDARD_BATTLE);
  try {
    const ready = await settledPanel(ctx.page, "invalid-swipe panel buttons");
    const single = ready.abilityButtons.find((button) => button.slot === 1);
    assert(single, `standard fixture must expose its slot-1 single-enemy move: ${JSON.stringify(ready.abilityButtons)}`);
    const missPoint = pointMissingEveryEnemy(ready);
    const notAllowedBefore = ready.audio.sfxCounts["notAllowed"] ?? 0;

    await swipe(ctx.page, ctx.box, SWIPE_DIRECTION_BY_SLOT[1], missPoint);

    const after = await settle(
      ctx.page,
      (current) => current.battleInput.latestSwipeTargetFeedback === "notAllowed",
      "a stroke whose midpoint missed every enemy did not report notAllowed feedback",
    );
    assert.equal(
      after.battleInput.swipeTargetFeedbackCount,
      ready.battleInput.swipeTargetFeedbackCount + 1,
      "the miss must register exactly one swipe-target feedback event",
    );
    assert.equal(after.audio.sfxCounts["notAllowed"] ?? 0, notAllowedBefore + 1, "the miss must play exactly one notAllowed.m4a");
    assert.equal(after.battleInput.latestPlayerSubmission, null, "a missed swipe must not queue an ability");
    assert.equal(after.picking, false, "a missed swipe must not open a target picker");
    // PANEL LIFETIME: refusal keeps the turn with the same actor and the same cards.
    assert.equal(after.panelVisible, true, "a refused swipe must leave the panel owning input");
    assert.equal(after.activeActorId, ready.activeActorId, "a refused swipe must not advance the actor");
    const restored = await settledPanel(ctx.page, "panel after refused swipe");
    assert.deepEqual(restored.abilityButtons, ready.abilityButtons, "a refused swipe must leave the same cards in place");

    // CONTROL: the identical gesture aimed at a real enemy DOES dispatch, so the assertions above
    // measure the midpoint rule and not a dead recognizer.
    const target = restored.monsters.find((monster) => monster.team === 1 && monster.visible);
    assert(target?.targetPoint, "control needs a live enemy target point");
    await swipe(ctx.page, ctx.box, SWIPE_DIRECTION_BY_SLOT[1], target.targetPoint, Math.max(40, target.targetSize.w * 1.5));
    const dispatched = await settle(
      ctx.page,
      (current) => current.battleInput.latestPlayerSubmission !== null,
      "control swipe onto a live enemy did not dispatch",
    );
    assert.deepEqual(
      dispatched.battleInput.latestPlayerSubmission.selectedTargetIds,
      [target.id],
      "control swipe must resolve to exactly the enemy under the stroke midpoint",
    );
    assert.deepEqual(ctx.errors, [], `invalid-swipe page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

async function proveAllEnemySwipe(browser) {
  const ctx = await bootBattle(browser, ALL_ENEMY_BATTLE);
  try {
    const ready = await settledPanel(ctx.page, "all-enemy swipe panel buttons");
    const ability = ready.abilityButtons.find((button) => button.abilityPath === "Offensive.AttackAll");
    assert(ability, `DonPen must expose all-enemy Offensive.AttackAll: ${JSON.stringify(ready.abilityButtons)}`);
    // BattleNode feeds targets from its live queue order, not renderer array order.
    const visibleEnemyIds = new Set(ready.monsters.filter((m) => m.team === 1 && m.visible).map((m) => m.id));
    const enemyIds = ready.queue.filter((id) => visibleEnemyIds.has(id));
    assert.equal(enemyIds.length, 3, `all-enemy fixture must expose three live targets: ${JSON.stringify(ready.monsters)}`);
    const notAllowedBefore = ready.audio.sfxCounts["notAllowed"] ?? 0;

    // The all-enemy shape ignores the stroke midpoint entirely — it queues against the whole live
    // pool. Aim deliberately at empty space to prove the midpoint is NOT consulted on this branch.
    await swipe(ctx.page, ctx.box, SWIPE_DIRECTION_BY_SLOT[ability.slot], pointMissingEveryEnemy(ready));

    const submitted = await settle(
      ctx.page,
      (current) => current.battleInput.latestPlayerSubmission?.abilityPath === "Offensive.AttackAll",
      "all-enemy swipe did not queue Offensive.AttackAll",
    );
    assert.deepEqual(submitted.battleInput.latestPlayerSubmission, {
      actorId: ready.activeActorId,
      slot: `usable${ability.slot}`,
      abilityPath: "Offensive.AttackAll",
      selectedTargetIds: enemyIds,
      submittedTargetIds: [],
    });
    assert.equal(submitted.battleInput.latestSwipeTargetFeedback, null, "a valid all-enemy swipe must not report notAllowed");
    assert.equal(submitted.audio.sfxCounts["notAllowed"] ?? 0, notAllowedBefore, "a valid all-enemy swipe must not play the miss sound");
    assert.equal(submitted.picking, false, "the all-enemy shape must queue without a target picker");
    // PANEL LIFETIME: only a queued gesture releases the panel to ability presentation.
    assert.equal(submitted.panelVisible, false, "a queued swipe must release the panel");
    assert.deepEqual(ctx.errors, [], `all-enemy swipe page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

async function proveUnmatchedSlotIsSilent(browser) {
  // A level-12 member has not unlocked all four ability slots, so one gesture direction maps to no
  // choice at all. DonPen's four filled slots cannot show this, hence the standard roster here.
  const ctx = await bootBattle(browser, STANDARD_BATTLE);
  try {
    let ready = await settledPanel(ctx.page, "unmatched-slot panel buttons");
    const freeSlotOf = (snapshot) => {
      const occupied = new Set(snapshot.abilityButtons.map((button) => button.slot));
      return [1, 2, 3, 4].find((slot) => !occupied.has(slot));
    };
    // Turn order is engine-owned; if this actor happens to have all four, wait for one that doesn't.
    for (let attempt = 0; attempt < 6 && freeSlotOf(ready) === undefined; attempt++) {
      await settle(ctx.page, (current) => current.panelVisible === false, "panel never closed while seeking a partial ability row");
      await settle(ctx.page, (current) => current.presentation?.state === "awaitingPlayerChoice", "battle never returned to a player choice");
      ready = await settledPanel(ctx.page, "unmatched-slot panel buttons (retry)");
    }
    const emptySlot = freeSlotOf(ready);
    assert(emptySlot, `fixture must leave one gesture slot unoccupied: ${JSON.stringify(ready.abilityButtons)}`);
    const notAllowedBefore = ready.audio.sfxCounts["notAllowed"] ?? 0;

    await swipe(ctx.page, ctx.box, SWIPE_DIRECTION_BY_SLOT[emptySlot], pointMissingEveryEnemy(ready));

    const after = await state(ctx.page);
    assert.equal(after.battleInput.latestPlayerSubmission, null, "an unmatched gesture must not queue");
    assert.equal(after.battleInput.latestSwipeTargetFeedback, null, "an unmatched gesture is silent, not a miss");
    assert.equal(after.audio.sfxCounts["notAllowed"] ?? 0, notAllowedBefore, "an unmatched gesture must play no sound");
    assert.equal(after.activePopup, null, "an unmatched gesture must not open a popup");
    assert.equal(after.panelVisible, true, "an unmatched gesture must leave the panel owning input");
    assert.deepEqual(ctx.errors, [], `unmatched-slot page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  await proveBlockedSwipeIsRefused(browser);
  await proveInvalidSwipeFeedback(browser);
  await proveAllEnemySwipe(browser);
  await proveUnmatchedSlotIsSilent(browser);
  console.log("swipe-activation-branches: PASS (blocked refusal, invalid-miss feedback + control, all-enemy queueing, unmatched silence, panel lifetime)");
} finally {
  await browser.close();
}
