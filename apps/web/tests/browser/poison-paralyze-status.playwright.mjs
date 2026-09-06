


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/poison-paralyze-status");
const FRAME_MS = 1000 / 60;
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

async function captureCanvas(page, shotName) {
  const dataUrl = await page.locator("canvas").first().evaluate((canvas) => canvas.toDataURL("image/png"));
  fs.writeFileSync(
    path.join(outputDir, shotName),
    Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
  );
}

/** Boots a fresh 1v1 SerpentMage-vs-Minotaur encounter, casts `abilityPath` on the enemy on
 *  SerpentMage's first turn, waits for `kind`'s overlay on the target, settles `settleMs` of
 *  presentation time, screenshots, and returns the final state for extra assertions. */
async function runStatusLeg({
  abilityPath,
  kind,
  settleMs,
  shotName,
  extraAssert,
  verifyFriendlyLostTurn,
  enemyShortType = "Minotaur",
  enemyLevel = 34,
}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ enemyShortType, enemyLevel }) => {


    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone", textResolutionMode: "modern", sound: 0, music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    // A sturdy enemy so VenomSting's TripleHit damage + DoT ticks don't end the battle mid-assert.
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "SerpentMage", level: 30 }],
      enemyTeam: [{ shortType: enemyShortType, level: enemyLevel }],
    };
  }, { enemyShortType, enemyLevel });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  for (let i = 0; i < 300 && (await state()).mode !== "start"; i++) {
    await page.waitForTimeout(100);
  }
  assert.equal((await state()).mode, "start", `boot stalled (${kind}): ${errors.join(" | ")}`);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }

  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  const { toCss } = await stageGeometry(page, canvasBox);

  let ready;
  for (let i = 0; i < 2000; i++) {
    ready = await state();
    if (
      ready.mode === "battle" &&
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.panelVisible &&
      ready.activeActorId === "t0m0:SerpentMage" &&
      ready.abilityButtons?.some((button) => button.abilityPath === abilityPath)
    ) {
      break;
    }
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal(
    ready.activeActorId,
    "t0m0:SerpentMage",
    `SerpentMage's choose phase never opened (${kind}): ${JSON.stringify(ready?.presentation)}`,
  );

  const card = ready.abilityButtons.find((b) => b.abilityPath === abilityPath);
  assert(card, `${abilityPath} card not found among: ${JSON.stringify(ready.abilityButtons)}`);
  const abilityClick = toCss(card.center);
  await page.mouse.click(abilityClick.x, abilityClick.y);

  let picking;
  for (let i = 0; i < 200; i++) {
    picking = await state();
    if (picking.presentation?.state === "targetPicking") break;
    await advance(25);
    await page.waitForTimeout(1);
  }
  assert.equal(picking.presentation.state, "targetPicking", `${abilityPath} did not open the target picker`);
  const enemyId = `t1m0:${enemyShortType}`;
  const target = picking.monsters.find((m) => m.team === 1 && m.id === enemyId);
  assert(target, `enemy target not found: ${JSON.stringify(picking.monsters)}`);
  const targetClick = toCss(target.targetPoint);
  await page.mouse.click(targetClick.x, targetClick.y);
  console.log(`poison-paralyze-status: ${abilityPath} cast on ${enemyShortType}`);

  let current;
  for (let i = 0; i < 400; i++) {
    current = await state();
    const monster = current.monsters.find((m) => m.id === enemyId);
    const emitted = kind !== "Poison" || (monster?.statusOverlayParticles?.Poison ?? 0) > 0;
    if (monster?.statusOverlays?.[kind] === true && monster?.statusEffects?.includes(kind) && emitted) break;
    await advance(25);
    await page.waitForTimeout(1);
  }
  const after = current.monsters.find((m) => m.id === enemyId);
  assert.equal(after?.statusOverlays?.[kind], true, `${kind} overlay never mounted on ${enemyShortType}`);
  // Independent engine cross-check: `statusEffects` includes DamageOverTimeBuff-backed Poison;
  // the controller's mounted-holder state alone cannot prove either the mechanic or visible output.
  assert(
    after?.statusEffects?.includes(kind),
    `engine-side ${kind} status missing independently of the overlay: ${JSON.stringify(after?.statusEffects)}`,
  );
  if (kind === "Poison") {
    assert(
      after?.statusOverlayParticles?.Poison > 0,
      `Poison holder mounted without a live particle: ${JSON.stringify(after?.statusOverlayParticles)}`,
    );
  }
  console.log(`poison-paralyze-status: ${kind} status and visible overlay mounted on ${enemyShortType}`);

  if (extraAssert) await extraAssert(current);

  await advance(settleMs);
  await advance(FRAME_MS);
  await page.waitForTimeout(50);
  assert.deepEqual(errors, [], `browser errors (${kind}): ${JSON.stringify(errors)}`);
  await captureCanvas(page, shotName);

  if (verifyFriendlyLostTurn) {
    // WrapAround paralyzes both the player-owned caster and the enemy target. Each disabled front
    // follows the forced Utility.LooseTurn/state-3 route. At the following state-1 finish gate,
    // statusTextAdvance: selects the next front without the ordinary 1.0/2.25s lead-in. If that
    // front is also disabled, its zero-delay LooseTurn is consumed on the NEXT BattleNode update.
    // A complete click before that update is swallowed and discarded, not buffered. Requiring two
    // teams and an accumulated block exercises that rapid-click cadence and the native buffer.
    const popStartsBefore = (await state()).friendlyPopForwardStarts ?? 0;
    const enemyPulseStartsBefore = (await state()).enemyAbilityPulseStarts ?? 0;
    const fastSkippedTeams = new Set();
    const acknowledgedBlocks = [];
    for (let i = 0; i < 6000 && (fastSkippedTeams.size < 2 || acknowledgedBlocks.length < 2); i++) {
      const turnState = await state();
      const actor = turnState.monsters.find((monster) => monster.id === turnState.activeActorId);
      const atEarliestFinishBoundary =
        turnState.presentation?.state === "turnComplete" &&
        turnState.statusText?.visible === true &&
        turnState.statusText?.text?.includes("loses its turn") &&
        actor?.activeBuffs?.some(
          (buff) => Array.isArray(buff.statusEffects) && buff.statusEffects.includes("Paralyze"),
        );
      if (atEarliestFinishBoundary) {
        const beforeActorId = turnState.activeActorId;
        const beforeText = turnState.statusText.text;
        const beforeElapsedMs = turnState.presentation.elapsedMs;
        fastSkippedTeams.add(actor.team);
        acknowledgedBlocks.push(beforeText);

        await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
        let callbackState;
        for (let poll = 0; poll < 200; poll++) {
          callbackState = await state();
          if (
            callbackState.activeActorId !== beforeActorId ||
            callbackState.statusText?.text !== beforeText ||
            callbackState.presentation?.state !== "turnComplete"
          ) {
            break;
          }
          await page.waitForTimeout(1);
        }
        assert(
          callbackState.activeActorId !== beforeActorId ||
            callbackState.statusText?.text !== beforeText ||
            callbackState.presentation?.state !== "turnComplete",
          `earliest Paralyze finish tap did not continue state 1: ${JSON.stringify(callbackState.presentation)}`,
        );
        assert.equal(
          callbackState.presentation.elapsedMs,
          beforeElapsedMs,
          `statusTextAdvance advanced source-clock time inside the callback after ${beforeActorId}`,
        );
        assert.equal(
          callbackState.presentation.state,
          "turnLeadIn",
          `finish callback should leave a disabled successor in state 3 until the next update: ${JSON.stringify(callbackState.presentation)}`,
        );

        // ChainedTextLabel remains visible during this state-3 gap. The source swallows a fully
        // completed extra click here, but statusTextAdvance's state==1 guard discards it.
        const selectedActorId = callbackState.activeActorId;
        await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
        const beforeUpdate = await state();
        assert.equal(beforeUpdate.activeActorId, selectedActorId, "a pre-update click was incorrectly buffered");
        assert.equal(beforeUpdate.presentation.state, "turnLeadIn", "a pre-update click performed state 3 early");
        await advance(FRAME_MS);
        const continued = await state();
        assert.equal(continued.activeActorId, selectedActorId, "the following update selected an unexpected actor");
        assert.notEqual(continued.statusText?.text, beforeText, "the following LooseTurn did not append status text");
        assert.notEqual(
          continued.presentation?.state,
          "turnLeadIn",
          `Paralyze finish inherited ordinary pacing after ${beforeActorId}`,
        );
        assert(
          Math.abs(continued.presentation.elapsedMs - beforeElapsedMs - FRAME_MS) < 0.01,
          `Paralyze continuation required more than one render update after ${beforeActorId}`,
        );
        continue;
      }
      await advance(10);
      if (i % 20 === 0) await page.waitForTimeout(1);
    }

    // Edge branch from ccTouchBegan:/ccTouchEnded:: a press may begin while the retained label is
    // swallowing state 3, then succeed if the following update reaches state 1 before release.
    const spanStart = await state();
    assert.equal(spanStart.presentation?.state, "turnComplete", "spanning-touch probe needs a state-1 finish gate");
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    const state3 = await state();
    assert.equal(state3.presentation?.state, "turnLeadIn", "spanning-touch probe did not select a disabled front");
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.mouse.down();
    await advance(FRAME_MS);
    const beforeSpanningRelease = await state();
    assert.equal(beforeSpanningRelease.presentation?.state, "turnComplete", "press did not span state 3 into state 1");
    await page.mouse.up();
    const afterSpanningRelease = await state();
    assert.notEqual(
      afterSpanningRelease.activeActorId,
      beforeSpanningRelease.activeActorId,
      "release after the state-3-to-state-1 update did not advance the queue",
    );
    assert.equal(
      afterSpanningRelease.presentation.elapsedMs,
      beforeSpanningRelease.presentation.elapsedMs,
      "spanning release added fixed lead-in time",
    );
    assert.deepEqual([...fastSkippedTeams].sort(), [0, 1], "fast finish taps did not cover both Paralyzed teams");
    assert(
      acknowledgedBlocks.some((text) => text.split("\n").length >= 2),
      `repeated Paralyze skips did not preserve the accumulated native status buffer: ${JSON.stringify(acknowledgedBlocks)}`,
    );
    assert.equal(
      (await state()).friendlyPopForwardStarts ?? 0,
      popStartsBefore,
      "status-skipped friendly LooseTurn must not start showFriendlyAttackAnimation pop-forward",
    );
    assert.equal(
      (await state()).enemyAbilityPulseStarts ?? 0,
      enemyPulseStartsBefore,
      "status-skipped enemy LooseTurn must not start the enemy ability pulse",
    );
    console.log("poison-paralyze-status: both Paralyzed teams matched the one-update rapid-click cadence");
  }

  fs.writeFileSync(
    path.join(outputDir, `${path.parse(shotName).name.replace(/-overlay$/, "")}-state.json`),
    JSON.stringify(await state(), null, 2) + "\n",
  );
  await page.close();
}

try {
  const only = process.env.DIB_STATUS_ONLY;
  // (1) Poison: grouped ~152/sec particle emitter, drawn BEHIND the monster sprite (Cocos z=-1),
  // anchored at (0.5*w, 0.6*h); particle lives span ~0..1.18s, so settle past one full generation.
  if (only !== "Paralyze") await runStatusLeg({
    abilityPath: "Offensive.Poison.PoisonAttack",
    kind: "Poison",
    settleMs: 1300,
    shotName: "poison-overlay.png",
  });

  // (1b) MetalSludge is a real 0.7-scale carrier-sized target with a narrow silhouette. Native
  // modelview shrinks the grouped spread but NOT GL point diameter, so its green fringe must stay
  // as legible as the scale-1 Minotaur's instead of being scaled down a second time.
  if (only !== "Paralyze") await runStatusLeg({
    abilityPath: "Offensive.Poison.PoisonAttack",
    kind: "Poison",
    settleMs: 1300,
    shotName: "poison-subscale-overlay.png",
    enemyShortType: "MetalSludge",
  });

  // (2) Paralyze: the asymmetric left/top/right bolt cluster at (0.5*w, 0.9*h), each bolt on the
  // deterministic 0.5s elastic (2,4)-offset shake. WrapAround's sourceBuffs also self-paralyzes
  // the caster -> the friendly-side (monsterSprite) anchor must carry a cluster too.
  if (only !== "Poison") await runStatusLeg({
    abilityPath: "Offensive.Paralyze.Paralyze",
    kind: "Paralyze",
    settleMs: 650,
    shotName: "paralyze-overlay.png",
    verifyFriendlyLostTurn: true,
    extraAssert: async (current) => {
      const self = current.monsters.find((m) => m.id === "t0m0:SerpentMage");
      assert.equal(
        self?.statusOverlays?.Paralyze,
        true,
        `WrapAround's self-paralyze overlay missing on the caster: ${JSON.stringify(self?.statusOverlays)}`,
      );
      console.log("poison-paralyze-status: caster self-Paralyze overlay mounted (friendly-side anchor)");
    },
  });

  const coverage = only === "Poison"
    ? "scale-1/subscale poison"
    : only === "Paralyze"
      ? "both-side paralyze"
      : "scale-1/subscale poison + both-side paralyze";
  console.log(`poison-paralyze-status: PASS (${coverage}, no errors)`);
} finally {
  await browser.close();
}
