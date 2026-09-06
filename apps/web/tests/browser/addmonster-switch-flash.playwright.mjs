





























import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { createFrameCapture } from "./captureFrame.mjs";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/addmonster-switch-flash");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

/** rectMid matching abilityRendererMath.ts's own (unexported) helper: displayArea-rect center. */
function rectMid(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Live Pixi scene-graph probe (mirrors ability-info.playwright.mjs's `visit` idiom): walks
 *  `window.__PIXI_APP__.stage` looking for any node whose `label` starts with "animation:" --
 *  positive confirmation that a real Pixi display object was mounted (not just JSON metadata
 *  from `render_game_to_text`'s `activeEffectNodes`, which is driven off the same effectLayer but
 *  is still just this app's OWN accounting of its children). */
async function pixiEffectProbe(page) {
  return page.evaluate(() => {
    const found = [];
    const visit = (node) => {
      if (typeof node.label === "string" && node.label.startsWith("animation:")) {
        const g = node.getGlobalPosition();
        found.push({
          label: node.label,
          globalX: g.x,
          globalY: g.y,
          visible: node.visible,
          renderable: node.renderable,
          alpha: node.alpha,
          constructorName: node.constructor.name,
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  });
}

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

  const captureFrame = await createFrameCapture(page, outputDir);
  return { page, errors, state, advance, toCss, captureFrame };
}

/** Waits (tolerantly, matching sleep-status.playwright.mjs's own comment on why) for Kaguya's
 *  choose phase to open -- other active teammates/the enemy may legitimately act first. */
async function waitForKaguyaChoice(state, advance) {
  let ready;
  for (let i = 0; i < 2000; i++) {
    ready = await state();
    if (
      ready.mode === "battle" &&
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.panelVisible &&
      ready.activeActorId === "t0m0:Kaguya" &&
      ready.abilityButtons?.length > 0
    ) {
      break;
    }
    await advance(25);
    if (i % 20 === 0) await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(
    ready.activeActorId,
    "t0m0:Kaguya",
    `Kaguya's choose phase never opened: ${JSON.stringify(ready?.presentation)}`,
  );
  return ready;
}

try {
  // ---------------------------------------------------------------------------------------------
  // LEG 1: Puppet (Utility.AddMonsterFromEnemyTeam) -- enemy-targeted, flash on the COPIED enemy.
  // ---------------------------------------------------------------------------------------------
  {
    const { page, errors, state, advance, toCss, captureFrame } = await openBattle({
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "Kaguya", level: 30 }],
      enemyTeam: [{ shortType: "Minotaur", level: 34 }],
    });

    const ready = await waitForKaguyaChoice(state, advance);
    console.log("addmonster-switch-flash: Puppet leg -- Kaguya's turn, panel visible");

    const card = ready.abilityButtons.find((b) => b.abilityPath === "Utility.AddMonsterFromEnemyTeam");
    assert(card, `Puppet card not found among: ${JSON.stringify(ready.abilityButtons)}`);
    const abilityClick = toCss(card.center);
    await page.mouse.click(abilityClick.x, abilityClick.y);

    let picking;
    for (let i = 0; i < 200; i++) {
      picking = await state();
      if (picking.presentation?.state === "targetPicking") break;
      await advance(25);
    }
    assert.equal(picking.presentation.state, "targetPicking", "Puppet did not open the target picker");
    const target = picking.monsters.find((m) => m.team === 1 && m.id === "t1m0:Minotaur");
    assert(target, `enemy target not found: ${JSON.stringify(picking.monsters)}`);
    const targetClick = toCss(target.targetPoint);
    await page.mouse.click(targetClick.x, targetClick.y);
    console.log("addmonster-switch-flash: Puppet cast on the enemy Minotaur");

    // Mid-animation: GenericEffect is a 20-frame/20fps animation (Animations.json) == ~1000ms
    // lifetime; poll until it mounts, which lands us well inside that window.
    let mid;
    for (let i = 0; i < 400; i++) {
      mid = await state();
      if (mid.activeEffectNodes.some((n) => n.label === "animation:GenericEffect")) break;
      await advance(25);
    }
    const flashNodes = mid.activeEffectNodes.filter((n) => n.label === "animation:GenericEffect");
    assert(flashNodes.length > 0, "Puppet's GenericEffect flash never mounted");

    const enemyAfterCast = mid.monsters.find((m) => m.id === "t1m0:Minotaur");
    assert(enemyAfterCast?.effectRect, `enemy Minotaur missing effectRect in state: ${JSON.stringify(enemyAfterCast)}`);
    const expected = rectMid(enemyAfterCast.effectRect);
    const kaguyaMid = mid.monsters.find((m) => m.id === "t0m0:Kaguya");

    const TOL = 5;
    const onTarget = flashNodes.some(
      (n) => Math.abs(n.x - expected.x) <= TOL && Math.abs(n.y - expected.y) <= TOL,
    );
    assert(
      onTarget,
      `Puppet's flash spawned away from the copied enemy's rect: nodes=${JSON.stringify(flashNodes)} expected=${JSON.stringify(expected)}`,
    );
    if (kaguyaMid?.effectRect) {
      const casterMid = rectMid(kaguyaMid.effectRect);
      const onCaster = flashNodes.some(
        (n) => Math.abs(n.x - casterMid.x) <= TOL && Math.abs(n.y - casterMid.y) <= TOL,
      );
      assert(!onCaster, `Puppet's flash incorrectly spawned on the CASTER (${JSON.stringify(casterMid)}), not the enemy`);
    }
    console.log("addmonster-switch-flash: Puppet flash confirmed on the picked enemy (not the caster)");

    const pixiMid = await pixiEffectProbe(page);
    assert(
      pixiMid.some((n) => n.label === "animation:GenericEffect"),
      "live Pixi scene graph has no animation:GenericEffect node during Puppet's flash",
    );
    console.log(`addmonster-switch-flash: Pixi probe confirms ${pixiMid.length} live animation node(s)`, JSON.stringify(pixiMid));

    // Land visibly mid-animation (GenericEffect ~1000ms total) rather than screenshotting the
    // exact spawn instant, which can be a near-transparent opening frame.
    await advance(300);
    await captureFrame("puppet-mid-flash.png");

    // Roster assertion: a NEW team-0 monster (species stolen from the enemy, i.e. "Minotaur")
    // must appear -- distinct from the untouched enemy t1m0:Minotaur.
    let afterAdd;
    for (let i = 0; i < 400; i++) {
      afterAdd = await state();
      if (afterAdd.monsters.some((m) => m.team === 0 && m.id !== "t0m0:Kaguya")) break;
      await advance(25);
    }
    const clone = afterAdd.monsters.find((m) => m.team === 0 && m.id !== "t0m0:Kaguya");
    assert(clone, `no new team-0 monster appeared after Puppet: ${JSON.stringify(afterAdd.monsters)}`);
    assert(clone.id.endsWith(":Minotaur"), `cloned monster should be a Minotaur (enemy's species): ${clone.id}`);
    console.log(`addmonster-switch-flash: Puppet added a new roster monster (${clone.id})`);

    // Full settle: past GenericEffect's ~1000ms lifetime, the flash node must be gone.
    await advance(1300);
    const settled = await state();
    assert(
      !settled.activeEffectNodes.some((n) => n.label === "animation:GenericEffect"),
      `Puppet's flash never cleaned up: ${JSON.stringify(settled.activeEffectNodes)}`,
    );
    assert.deepEqual(errors, [], `browser errors (Puppet leg): ${JSON.stringify(errors)}`);
    await captureFrame("puppet-settled.png");
    fs.writeFileSync(path.join(outputDir, "puppet-state.json"), JSON.stringify(settled, null, 2) + "\n");
    console.log("addmonster-switch-flash: Puppet leg PASS (flash on enemy + roster add + no errors)");

    await page.close();
  }

  // ---------------------------------------------------------------------------------------------
  // LEG 2: Switch (Defensive.RandomSwitch) -- self-targeted, flash on the monster LEAVING battle.
  // ---------------------------------------------------------------------------------------------
  {
    const { page, errors, state, advance, toCss, captureFrame } = await openBattle({
      backgroundKey: "ForestCombat",
      playerTeam: [
        { shortType: "Kaguya", level: 30 }, // t0m0, active
        { shortType: "FireCub", level: 30 }, // t0m1, active filler
        { shortType: "SnowCub", level: 30 }, // t0m2, active filler
        { shortType: "Penguin", level: 30 }, // t0m3, the ONLY bench reserve -- deterministic switch-in
      ],
      enemyTeam: [{ shortType: "Minotaur", level: 34 }],
    });
    void toCss; // Switch is self-only (SelfOnlyRoot): the ability card auto-queues on tap, no picker.

    const ready = await waitForKaguyaChoice(state, advance);
    console.log("addmonster-switch-flash: Switch leg -- Kaguya's turn, panel visible");

    // Baseline: Kaguya's own on-screen rect WHILE STILL ACTIVE -- this is the "last position"
    // the flash must land on once the switch tears its display down.
    const kaguyaBefore = ready.monsters.find((m) => m.id === "t0m0:Kaguya");
    assert(kaguyaBefore?.effectRect, `Kaguya missing effectRect before cast: ${JSON.stringify(kaguyaBefore)}`);
    const expected = rectMid(kaguyaBefore.effectRect);

    const card = ready.abilityButtons.find((b) => b.abilityPath === "Defensive.RandomSwitch");
    assert(card, `Switch card not found among: ${JSON.stringify(ready.abilityButtons)}`);
    const abilityClick = toCss(card.center);
    await page.mouse.click(abilityClick.x, abilityClick.y);
    console.log("addmonster-switch-flash: Switch cast on Kaguya (self)");

    let mid;
    for (let i = 0; i < 400; i++) {
      mid = await state();
      if (mid.activeEffectNodes.some((n) => n.label === "animation:GenericEffect")) break;
      await advance(25);
    }
    const flashNodes = mid.activeEffectNodes.filter((n) => n.label === "animation:GenericEffect");
    assert(
      flashNodes.length > 0,
      `Switch's GenericEffect flash never mounted (blockReason gotcha? abilityButtons=${JSON.stringify(mid.abilityButtons)})`,
    );

    const TOL = 5;
    const onCaster = flashNodes.some(
      (n) => Math.abs(n.x - expected.x) <= TOL && Math.abs(n.y - expected.y) <= TOL,
    );
    assert(
      onCaster,
      `Switch's flash spawned away from Kaguya's last on-screen rect: nodes=${JSON.stringify(flashNodes)} expected=${JSON.stringify(expected)}`,
    );
    console.log("addmonster-switch-flash: Switch flash confirmed on the caster's own (outgoing) position");

    const pixiMid = await pixiEffectProbe(page);
    assert(
      pixiMid.some((n) => n.label === "animation:GenericEffect"),
      "live Pixi scene graph has no animation:GenericEffect node during Switch's flash",
    );
    console.log(`addmonster-switch-flash: Pixi probe confirms ${pixiMid.length} live animation node(s)`, JSON.stringify(pixiMid));

    await advance(300);
    await captureFrame("switch-mid-flash.png");

    // Full settle: Kaguya must no longer be the active team-0 occupant of that slot (replaced by
    // Penguin, its only bench reserve), and the flash must be gone. Native Team dispatches removed
    // then added synchronously, so the outgoing spin and incoming layout overlap; an empty slot
    // lasting for the outgoing animation would be an async-port serialization bug.
    let settled;
    for (let i = 0; i < 400; i++) {
      settled = await state();
      const kaguyaGone = !settled.monsters.some((m) => m.id === "t0m0:Kaguya");
      const penguinIn = settled.monsters.some((m) => m.id === "t0m3:Penguin" && m.team === 0);
      if (kaguyaGone && penguinIn) break;
      await advance(25);
    }
    assert(
      !settled.monsters.some((m) => m.id === "t0m0:Kaguya"),
      `Kaguya is still shown active after Switch: ${JSON.stringify(settled.monsters)}`,
    );
    assert(
      settled.monsters.some((m) => m.id === "t0m3:Penguin" && m.team === 0),
      `Penguin (the sole bench reserve) never became active after Switch: ${JSON.stringify(settled.monsters)}`,
    );
    await advance(1300); // past GenericEffect's ~1000ms lifetime
    const fullySettled = await state();
    assert(
      !fullySettled.activeEffectNodes.some((n) => n.label === "animation:GenericEffect"),
      `Switch's flash never cleaned up: ${JSON.stringify(fullySettled.activeEffectNodes)}`,
    );
    assert.deepEqual(errors, [], `browser errors (Switch leg): ${JSON.stringify(errors)}`);
    await captureFrame("switch-settled.png");
    fs.writeFileSync(path.join(outputDir, "switch-state.json"), JSON.stringify(fullySettled, null, 2) + "\n");
    console.log("addmonster-switch-flash: Switch leg PASS (flash on outgoing caster + roster swap + no errors)");

    await page.close();
  }

  console.log("addmonster-switch-flash: PASS (Puppet enemy-target flash + Switch caster-flash, no console/page errors)");
} finally {
  await browser.close();
}
