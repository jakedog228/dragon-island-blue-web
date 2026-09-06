import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter, STANDARD_BATTLE } from "./fixtures.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

// This proof fixture must never attach to a potentially stale 127.0.0.1 Vite listener.
const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const parsedUrl = new URL(url);
assert.equal(parsedUrl.protocol, "http:", "friendly-info input proof requires an http localhost server");
assert.equal(parsedUrl.hostname, "localhost", "friendly-info input proof rejects non-localhost servers");

// Existing soulstone-info-desoul coverage establishes this content-contract fixture. Manticore's
// localized display name is deliberately unambiguous, so the popup identity can be exact here.
const MANTICORE_INFO_BATTLE = {
  backgroundKey: "ForestCombat",
  blockSaveMe: true,
  playerTeam: [
    { shortType: "Manticore", level: 12, soulStone: { element: "Fire", level: 40, sourceType: "FireCub" } },
    { shortType: "Minotaur", level: 12 },
  ],
  enemyTeam: [{ shortType: "Spark", level: 12 }],
};

const state = async (page) => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
const advance = (page, ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

async function settle(page, predicate, label, maxSteps = 160) {
  for (let step = 0; step < maxSteps; step++) {
    const current = await state(page);
    if (predicate(current)) return current;
    await advance(page, 50);
    // The deterministic ticker must still yield to real asset fetches. A tight advanceTime loop
    // leaves the battle in "building" without a visible page error.
    if (step % 20 === 0) await page.waitForTimeout(10);
  }
  throw new Error(`${label}; last state: ${JSON.stringify(await state(page))}`);
}

async function settledField(page, field, label) {
  let previous = "";
  for (let step = 0; step < 80; step++) {
    const current = await state(page);
    const serialized = JSON.stringify(current[field]);
    // Card geometry is published before the panel has finished becoming interactive. Wait until
    // the panel owns input so the reported ButtonSprite center cannot fall through to the field.
    if (serialized !== "" && serialized === previous && current.panelVisible === true) return current;
    previous = serialized;
    await advance(page, 50);
    if (step % 20 === 0) await page.waitForTimeout(10);
  }
  throw new Error(`${label} never settled: ${JSON.stringify((await state(page))[field])}`);
}

async function bootBattle(browser, encounter, { waitForChoice = true } = {}) {
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
  await settle(page, (current) => current.startup?.phase === "title", "title did not settle before friendly-info fixture");
  await page.waitForTimeout(100);
  await advance(page, 16.67);
  await page.waitForTimeout(100);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const startup = await settle(
    page,
    (current) => current.mode === "battle" || current.startup?.phase === "save-select",
    "title did not reach save selection for friendly-info fixture",
  );
  if (startup.startup?.phase === "save-select") {
    await advance(page, 250);
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `slot-1 must be enabled after title transition: ${JSON.stringify(startup.startup)}`);
    await clickBattlePoint(page, box, { x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  }
  await settle(page, waitForChoice
    ? (current) => current.presentation?.state === "awaitingPlayerChoice" && current.statusText?.visible === false
    : (current) => current.mode === "battle" && current.friendlyRowVisible === true &&
      current.monsters.some((monster) => monster.team === 0 && monster.visible) &&
      current.turnOrderEntries.length > 0,
  waitForChoice ? "battle never reached an unlocked player choice" : "friendly field never became reachable before the panel",
  360);
  return { page, box, errors };
}

async function clickBattlePoint(page, box, point) {
  const { toCss } = await stageGeometry(page, box);
  const css = toCss(point);
  await page.mouse.click(css.x, css.y);
}

async function clickLabeledNode(page, box, label) {
  const center = await page.evaluate((wanted) => {
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
        const bounds = node.getBounds();
        const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const localCenter = node.toLocal(center);
        const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(center.x, center.y);
        const hitPath = [];
        for (let current = hit; current; current = current.parent) {
          hitPath.push({ label: current.label ?? null, eventMode: current.eventMode });
        }
        const nodePath = [];
        for (let current = node; current; current = current.parent) {
          nodePath.push({
            label: current.label ?? null,
            eventMode: current.eventMode,
            interactiveChildren: current.interactiveChildren,
            measurable: current.measurable,
            visible: current.visible,
            renderable: current.renderable,
            childIndex: current.parent?.children.indexOf(current) ?? null,
          });
        }
        return {
          ...center,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
          localCenter: { x: localCenter.x, y: localCenter.y },
          hitAreaContains: node.hitArea?.contains(localCenter.x, localCenter.y) ?? null,
          hitPath,
          nodePath,
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, label);
  assert(center, `missing visible Pixi node ${label}`);
  assert(center.hitPath.some((entry) => entry.label === label),
    `${label} does not own its rendered center: ${JSON.stringify(center)}`);
  // Pixi getBounds is already canvas-global (FixedStage scale and letterbox included).
  await page.mouse.click(box.x + center.x, box.y + center.y);
}

async function closePopup(page) {
  await page.keyboard.press("Escape");
  await settle(page, (current) => current.activePopup === null, "Escape did not close LivingInfo");
}

async function proveFriendlyInformation(browser) {
  const ctx = await bootBattle(browser, MANTICORE_INFO_BATTLE, { waitForChoice: false });
  try {
    const ready = await state(ctx.page);
    const manticore = ready.monsters.find((monster) => monster.id === "t0m0:Manticore" && monster.team === 0 && monster.visible);
    const minotaur = ready.monsters.find((monster) => monster.id === "t0m1:Minotaur" && monster.team === 0 && monster.visible);
    assert(manticore?.targetPoint, `Manticore must expose a stable friendly field target: ${JSON.stringify(ready.monsters)}`);
    assert(minotaur?.targetPoint, `Minotaur must expose a second eligible friendly field target: ${JSON.stringify(ready.monsters)}`);

    // Ordinary FriendlyTeamDisplay cards retain mainLiving=false. The source's only
    // setMainLiving: call belongs to the turn-panel acting card, so even a precise field-card tap
    // must be inert outside Battle.state == 3.
    const towardMinotaur = {
      x: minotaur.targetPoint.x - manticore.targetPoint.x,
      y: minotaur.targetPoint.y - manticore.targetPoint.y,
    };
    const distance = Math.hypot(towardMinotaur.x, towardMinotaur.y);
    const nearEdgeDistance = Math.min(distance * 0.45, manticore.targetSize.w * 0.45);
    const nearestPoint = {
      x: manticore.targetPoint.x + (towardMinotaur.x / distance) * nearEdgeDistance,
      y: manticore.targetPoint.y + (towardMinotaur.y / distance) * nearEdgeDistance,
    };
    const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    assert(
      distanceSquared(nearestPoint, manticore.targetPoint) < distanceSquared(nearestPoint, minotaur.targetPoint),
      `reported nearest point must select Manticore: ${JSON.stringify({ nearestPoint, manticore: manticore.targetPoint, minotaur: minotaur.targetPoint })}`,
    );
    await clickBattlePoint(ctx.page, ctx.box, nearestPoint);
    for (let i = 0; i < 8; i++) await advance(ctx.page, 50);
    assert.equal((await state(ctx.page)).activePopup, null, "ordinary friendly field card must be inert");

    const panelReady = await settle(
      ctx.page,
      (current) => current.presentation?.state === "awaitingPlayerChoice" &&
        current.statusText?.visible === false && current.panelVisible === true &&
        current.actingCardLayout?.livingId === manticore.id,
      "battle never reached the player choice after the field-card proof",
      360,
    );

    // The bottom-left turn-panel copy is the source's always-enabled mainLiving card. Its whole
    // content-size rect opens style-0 LivingInfo without consuming the pending turn.
    const acting = panelReady.actingCardLayout;
    assert.equal(acting?.livingId, manticore.id, `fixture must give Manticore the first acting card: ${JSON.stringify(acting)}`);
    const panelChoicesBefore = structuredClone(panelReady.abilityButtons);
    await clickLabeledNode(ctx.page, ctx.box, "turnPanel:actingCard");
    const actingInfo = await settle(
      ctx.page,
      (current) => current.activePopup === "livingInfo:Manticore",
      "bottom-left acting card did not open Manticore LivingInfo",
    );
    assert.equal(actingInfo.activePopup, "livingInfo:Manticore");
    await closePopup(ctx.page);
    const resumedTurn = await settle(
      ctx.page,
      (current) => current.presentation?.state === "awaitingPlayerChoice" && current.panelVisible === true,
      "closing acting-card LivingInfo did not return to the same pending turn",
    );
    assert.deepEqual(resumedTurn.abilityButtons, panelChoicesBefore, "acting-card info tap must not consume or rebuild the turn choices");

    // Friendly turn-order route: iconGlobalCenter is already canvas-global and must not be passed
    // through stageGeometry (that would double-apply the letterbox transform).
    const beforeOrderTap = await state(ctx.page);
    const ownEntry = beforeOrderTap.turnOrderEntries.find((entry) => entry.id === manticore.id && entry.team === 0);
    assert(ownEntry?.iconGlobalCenter, `Manticore must expose a friendly turn-order center: ${JSON.stringify(beforeOrderTap.turnOrderEntries)}`);
    await ctx.page.mouse.click(ctx.box.x + ownEntry.iconGlobalCenter.x, ctx.box.y + ownEntry.iconGlobalCenter.y);
    const orderInfo = await settle(
      ctx.page,
      (current) => current.activePopup === "livingInfo:Manticore",
      "friendly turn-order entry did not open Manticore LivingInfo",
    );
    assert.equal(orderInfo.activePopup, "livingInfo:Manticore");
    await closePopup(ctx.page);

    // Entry roots retain zero contentSize, so the shared helper gives each origin a 55pt square.
    // The 34pt column pitch makes adjacent squares overlap. Pick a point in that overlap which is
    // nearer the upper friendly origin but below its painted portrait: source arbitration must
    // open the friendly entry instead of Pixi choosing the later-painted enemy entry.
    const orderedEntries = beforeOrderTap.displayedQueue
      .map((id) => beforeOrderTap.turnOrderEntries.find((entry) => entry.id === id))
      .filter(Boolean);
    const overlapPair = orderedEntries.slice(0, -1)
      .map((entry, index) => [entry, orderedEntries[index + 1]])
      .find(([upper, lower]) => upper.team === 0 && lower.team === 1);
    assert(overlapPair, `fixture must expose an own/enemy adjacent pair: ${JSON.stringify(orderedEntries)}`);
    const [upperOwn, lowerEnemy] = overlapPair;
    assert(upperOwn.entryOriginGlobal && lowerEnemy.entryOriginGlobal,
      `turn-order entries must expose their shared-helper origins: ${JSON.stringify(overlapPair)}`);
    const weightedOverlapPoint = (near, far) => ({
      x: near.entryOriginGlobal.x * 0.55 + far.entryOriginGlobal.x * 0.45,
      y: near.entryOriginGlobal.y * 0.55 + far.entryOriginGlobal.y * 0.45,
    });
    const ownOverlapPoint = weightedOverlapPoint(upperOwn, lowerEnemy);
    await ctx.page.mouse.click(ctx.box.x + ownOverlapPoint.x, ctx.box.y + ownOverlapPoint.y);
    const overlapInfo = await settle(
      ctx.page,
      (current) => current.activePopup === `livingInfo:${upperOwn.id.split(":").at(-1)}`,
      "nearest-center arbitration did not give the overlapping turn-order touch to the friendly entry",
    );
    assert.equal(overlapInfo.activePopup, `livingInfo:${upperOwn.id.split(":").at(-1)}`);
    await closePopup(ctx.page);

    // The symmetric point is still inside both 55pt regions but is nearer the enemy origin. The
    // source selects that enemy entry and then takes its inert team-1 branch; it must not fall
    // through to the friendly entry underneath.
    const enemyOverlapPoint = weightedOverlapPoint(lowerEnemy, upperOwn);
    await ctx.page.mouse.click(ctx.box.x + enemyOverlapPoint.x, ctx.box.y + enemyOverlapPoint.y);
    for (let i = 0; i < 8; i++) await advance(ctx.page, 50);
    assert.equal((await state(ctx.page)).activePopup, null,
      "enemy-nearest overlap touch fell through to the adjacent friendly turn-order entry");

    // Team-1 turn-order entries are intentionally inert; retain an exact null popup state through
    // several source-clock ticks rather than treating an immediate event dispatch as proof.
    const enemyEntry = (await state(ctx.page)).turnOrderEntries.find((entry) => entry.team === 1);
    assert(enemyEntry?.iconGlobalCenter, "fixture must expose an enemy turn-order entry");
    await ctx.page.mouse.click(ctx.box.x + enemyEntry.iconGlobalCenter.x, ctx.box.y + enemyEntry.iconGlobalCenter.y);
    for (let i = 0; i < 8; i++) await advance(ctx.page, 50);
    assert.equal((await state(ctx.page)).activePopup, null, "enemy turn-order entry must be inert");
    assert.deepEqual(ctx.errors, [], `friendly-info page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

async function provePickerSuppressesInformation(browser) {
  const ctx = await bootBattle(browser, STANDARD_BATTLE);
  try {
    await settledField(ctx.page, "abilityButtons", "standard panel buttons");
    await advance(ctx.page, 250);
    const ready = await state(ctx.page);
    const manualAbility = ready.abilityButtons.find((button) => button.slot === 1);
    assert(manualAbility, `standard fixture must expose the known manual slot-1 move: ${JSON.stringify(ready.abilityButtons)}`);
    await clickBattlePoint(ctx.page, ctx.box, manualAbility.center);
    await settle(
      ctx.page,
      (current) => current.picking === true && current.panelVisible === false && current.targetPickerVisuals.cancel !== null,
      "manual ability did not give TargetPicker input ownership",
    );

    const picking = await state(ctx.page);
    const friendly = picking.monsters.find((monster) => monster.team === 0 && monster.visible);
    const ownEntry = picking.turnOrderEntries.find((entry) => entry.id === friendly?.id && entry.team === 0);
    assert(friendly?.targetPoint, `picker suppression fixture lacks a friendly field target: ${JSON.stringify(picking.monsters)}`);
    assert(ownEntry?.iconGlobalCenter, `picker suppression fixture lacks the matching turn-order entry: ${JSON.stringify(picking.turnOrderEntries)}`);

    await clickBattlePoint(ctx.page, ctx.box, friendly.targetPoint);
    let suppressed = await state(ctx.page);
    assert.equal(suppressed.activePopup, null, "TargetPicker must suppress friendly field LivingInfo");
    assert.equal(suppressed.picking, true, "friendly field tap must leave TargetPicker active");

    await ctx.page.mouse.click(ctx.box.x + ownEntry.iconGlobalCenter.x, ctx.box.y + ownEntry.iconGlobalCenter.y);
    suppressed = await state(ctx.page);
    assert.equal(suppressed.activePopup, null, "TargetPicker must suppress friendly turn-order LivingInfo");
    assert.equal(suppressed.picking, true, "friendly turn-order tap must leave TargetPicker active");

    // Cleanup through the reported cancel geometry. This also proves that picker ownership returns
    // to the panel without relying on an Esc-only desktop adaptation.
    await advance(ctx.page, 250);
    suppressed = await state(ctx.page);
    const cancel = suppressed.targetPickerVisuals.cancel;
    assert(cancel, "manual TargetPicker must report its cancel button geometry");
    await clickBattlePoint(ctx.page, ctx.box, { x: cancel.x + cancel.w / 2, y: cancel.y + cancel.h / 2 });
    await settle(
      ctx.page,
      (current) => current.picking === false && current.panelVisible === true &&
        current.targetPickerVisuals.cancel === null && current.targetPickerVisuals.outlines.length === 0,
      "TargetPicker cancel did not clear picker ownership and restore the panel",
    );
    assert.deepEqual(ctx.errors, [], `picker suppression page errors: ${ctx.errors.join(" | ")}`);
  } finally {
    await ctx.page.close();
  }
}

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  await proveFriendlyInformation(browser);
  await provePickerSuppressesInformation(browser);
  console.log("friendly-info-input: PASS (field inertness, acting-card/order info, enemy inertness, TargetPicker suppression, and cancel ownership)");
} finally {
  await browser.close();
}
