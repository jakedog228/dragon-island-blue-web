import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const GAME_SPEED = Number(process.env.DIB_GAME_SPEED ?? "1");
assert(Number.isFinite(GAME_SPEED) && GAME_SPEED > 0, `DIB_GAME_SPEED must be a positive number, got ${process.env.DIB_GAME_SPEED}`);


assert(
  GAME_SPEED === 1 || process.env.DIB_ALLOW_UNSCALED_ANIMATIONS === "1",
  `DIB_GAME_SPEED=${GAME_SPEED} exposes the known unscaled-animation divergence documented above; ` +
    `set DIB_ALLOW_UNSCALED_ANIMATIONS=1 to run it anyway (it will fail at the TU-settle assertion).`,
);
// Keep each speed's trace file distinct so a later run cannot be mistaken for the other speed's
// evidence (pitfall: stale artifacts read as fresh proof).
const outputDir = path.resolve(`output/turn-timing/speed-${GAME_SPEED}`);
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
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.addInitScript(() => { window.advanceTime = () => Promise.resolve(); });
  await page.addInitScript((speed) => { window.__DIB_TEST_GAME_SPEED__ = speed; }, GAME_SPEED);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const rawAdvance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  const TRACE_STEP_MS = 10;
  const transitionSamples = [];
  let transitionSamplingEnabled = false;
  let transitionStepIndex = 0;
  let lastTransitionStep = null;
  const arrayEqual = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
  const effectLabels = (snapshot) => snapshot.activeEffectNodes.map((node) => node.label).sort();
  const tuLayout = (snapshot) => snapshot.turnOrderEntries
    .map((entry) => `${entry.id}:${entry.x}:${entry.y}:${entry.scaleX}:${entry.rotationDeg ?? 0}`)
    .sort();
  const multisetAdded = (before, after) => {
    const remaining = [...before];
    const added = [];
    for (const value of after) {
      const index = remaining.indexOf(value);
      if (index >= 0) remaining.splice(index, 1);
      else added.push(value);
    }
    return added;
  };
  const recordTransitionStep = (before, after, advanceMs) => {
    const stepIndex = ++transitionStepIndex;
    const base = {
      stepIndex,
      advanceMs,
      fromElapsedMs: before.presentation.elapsedMs,
      atElapsedMs: after.presentation.elapsedMs,
    };
    const changes = [];
    for (const monster of before.monsters) {
      const next = after.monsters.find((candidate) => candidate.id === monster.id);
      if (next && next.hp !== monster.hp) {
        changes.push({ ...base, kind: "hp-change", id: monster.id, team: monster.team, beforeHp: monster.hp, afterHp: next.hp });
      }
      if (!next) changes.push({ ...base, kind: "field-removal", id: monster.id, team: monster.team });
    }
    const beforeEffects = effectLabels(before);
    const afterEffects = effectLabels(after);
    if (!arrayEqual(beforeEffects, afterEffects)) {
      changes.push({
        ...base,
        kind: "effect-change",
        added: multisetAdded(beforeEffects, afterEffects),
        removed: multisetAdded(afterEffects, beforeEffects),
      });
    }
    if (!arrayEqual(before.queue, after.queue)) {
      changes.push({ ...base, kind: "engine-queue-change", before: before.queue, after: after.queue });
    }
    if (!arrayEqual(before.displayedQueue, after.displayedQueue)) {
      changes.push({ ...base, kind: "displayed-queue-change", before: before.displayedQueue, after: after.displayedQueue });
    }
    const beforeFalling = before.turnOrderFalling.map((entry) => entry.id);
    const afterFalling = after.turnOrderFalling.map((entry) => entry.id);
    for (const id of multisetAdded(beforeFalling, afterFalling)) changes.push({ ...base, kind: "death-fall-start", id });
    for (const id of multisetAdded(afterFalling, beforeFalling)) changes.push({ ...base, kind: "death-fall-complete", id });
    const beforeTu = tuLayout(before);
    const afterTu = tuLayout(after);
    if (!arrayEqual(beforeTu, afterTu)) changes.push({ ...base, kind: "tu-layout-change", before: beforeTu, after: afterTu });
    if (before.presentation.state !== after.presentation.state) {
      changes.push({
        ...base,
        kind: "presentation-change",
        actorId: after.activeActorId,
        beforeState: before.presentation.state,
        afterState: after.presentation.state,
      });
    }
    if (before.activeActorId !== after.activeActorId) {
      changes.push({ ...base, kind: "actor-change", beforeActorId: before.activeActorId, afterActorId: after.activeActorId });
    }
    transitionSamples.push(...changes);
    lastTransitionStep = { ...base, before, after, changes };
  };
  const advance = async (ms) => {
    if (!transitionSamplingEnabled) return rawAdvance(ms);
    let remaining = ms;
    while (remaining > 1e-9) {
      const stepMs = Math.min(TRACE_STEP_MS, remaining);
      const before = await state();
      await rawAdvance(stepMs);
      const after = await state();
      recordTransitionStep(before, after, stepMs);
      remaining = Math.max(0, remaining - stepMs);
      if (transitionStepIndex % 20 === 0) await page.waitForTimeout(1);
    }
  };

  for (let i = 0; i < 600 && (await state()).mode !== "start"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal((await state()).mode, "start", "battle title did not finish building");
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  assert.equal((await state()).startup?.phase, "title", "turn-timing fixture must begin at the title touch layer");
  await page.waitForTimeout(100);
  await advance(16.67);
  await page.waitForTimeout(100);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  let startup = await state();
  for (let i = 0; i < 360 && startup.mode !== "battle" && startup.startup?.phase !== "save-select"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
    startup = await state();
  }
  assert(
    startup.mode === "battle" || startup.startup?.phase === "save-select",
    `title did not reach save selection for turn-timing fixture: ${JSON.stringify(startup)}`,
  );
  if (startup.startup?.phase === "save-select") {
    await advance(250);
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `slot-1 must be enabled after title transition: ${JSON.stringify(startup.startup)}`);
    const { toCss } = await stageGeometry(page, canvasBox);
    const point = toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }
  for (let i = 0; i < 1200 && (await state()).mode !== "battle"; i++) {
    const snapshot = await state();
    if (snapshot.presentation?.state === "building") await page.waitForTimeout(1);
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  const built = await state();
  assert.equal(built.mode, "battle", "battle did not finish building");


  assert.equal(
    built.presentation.gameSpeed,
    GAME_SPEED,
    "battle did not adopt the requested gameSpeed multiplier",
  );
  transitionSamplingEnabled = true;

  // `presentation.elapsedMs` sums per-frame float deltaMS (16.66666…), so a measured duration
  // sits within ~1e-10 of the true multiple — sometimes just BELOW it (e.g. a true 500ms gate
  // measuring 499.9999999999818). Which side it lands on depends on how many loading-phase
  // advance(100) polls ran (i.e. on real boot duration), so a zero-epsilon `>=` here flips on
  // unrelated preload-list changes. A genuinely skipped frame would measure a full 16.67ms short,
  // far outside this epsilon.
  const FLOAT_EPSILON_MS = 0.001;
  const IMPACT_BOUNDARY_STEP_MS = 1;
  // `removalLogicHoldMs(count)` is the source's 0.5s gate PER removed living; state-1 then
  // applies its own team-keyed pacing before the incoming actor can choose/act. battleNode.test
  // pins the friendly incoming leg independently at 1.0s.
  // Every source gate below is a wall-clock duration divided by the live multiplier, mirroring the
  // binary's `dt' = dt × gameSpeed`. At GAME_SPEED 1 these are exactly the source constants.
  const REMOVED_LIVING_LOGIC_HOLD_MS = 500 / GAME_SPEED;
  const FRIENDLY_INCOMING_PACING_MS = 1000 / GAME_SPEED;
  const ENEMY_TURN_LEAD_IN_MS = 2250 / GAME_SPEED;
  const TU_DEATH_FALL_MS = 3000 / GAME_SPEED;


  const TURN_ORDER_SETTLE_BUDGET_MS = 2 * (1500 / GAME_SPEED);
  const EXPECTED_LETHAL_ACTOR_ID = "t1m2:UnhappyBird";
  const EXPECTED_LETHAL_ABILITY_PATH = "Offensive.AttackAll";
  const EXPECTED_LETHAL_TARGET_ID = "t1m2:UnhappyBird";
  const EXPECTED_COLLATERAL_REMOVAL_ID = "t0m1:SnowCub";
  const impactTrace = { friendly: null, enemy: null, lethal: null };
  let lethalLifecycleId = null;

  const tracePhaseBoundary = async (phase) => {
    assert.equal(phase.presentation.state, "phaseDelay");
    const actor = phase.monsters.find((monster) => monster.id === phase.activeActorId);
    if (!actor || !phase.activeAbilityPath) return;
    const phaseStartedAt = phase.presentation.elapsedMs - phase.presentation.stateAgeMs;
    const expectedDelayMs = 500 / phase.presentation.gameSpeed;
    const remainingToPreBoundary = expectedDelayMs - phase.presentation.stateAgeMs - IMPACT_BOUNDARY_STEP_MS;
    if (remainingToPreBoundary > 0) {
      await advance(remainingToPreBoundary);
      await page.waitForTimeout(1);
    }
    const before = await state();
    assert.equal(before.presentation.state, "phaseDelay", `${phase.activeAbilityPath} left before its lower phase bound`);
    const beforeAgeMs = before.presentation.elapsedMs - phaseStartedAt;
    assert(
      beforeAgeMs >= expectedDelayMs - IMPACT_BOUNDARY_STEP_MS - FLOAT_EPSILON_MS &&
        beforeAgeMs < expectedDelayMs + FLOAT_EPSILON_MS,
      `${phase.activeAbilityPath} pre-impact sample ${beforeAgeMs}ms missed the ${expectedDelayMs}ms boundary window`,
    );
    // Step across the boundary in IMPACT_BOUNDARY_STEP_MS increments rather than assuming one is
    // enough. `tween` completes on the first frame whose ACCUMULATED float dt reaches the duration,
    // and that sum can land a hair under its true multiple (measured: 249.99999999999955 for a
    // 250ms gate) — exactly the drift this file's FLOAT_EPSILON_MS comment describes, but on the
    // tween's own accumulator, where an epsilon on our measurement cannot reach it. One extra 1ms
    // step then completes it. The window stays far tighter than the thing under test: at gameSpeed 2
    // an UNSCALED gate would land at 500ms, ~250 steps away, so this still discriminates hard.
    let after = before;
    let boundaryStepsUsed = 0;
    const MAX_BOUNDARY_STEPS = 3;
    while (after.presentation.state === "phaseDelay" && boundaryStepsUsed < MAX_BOUNDARY_STEPS) {
      await advance(IMPACT_BOUNDARY_STEP_MS);
      await page.waitForTimeout(1);
      after = await state();
      boundaryStepsUsed += 1;
    }
    assert.notEqual(
      after.presentation.state,
      "phaseDelay",
      `${phase.activeAbilityPath} remained gated ${boundaryStepsUsed * IMPACT_BOUNDARY_STEP_MS}ms past its ${expectedDelayMs}ms upper phase bound`,
    );
    const phaseDelayMs = after.presentation.elapsedMs - phaseStartedAt;
    assert(
      phaseDelayMs >= expectedDelayMs - FLOAT_EPSILON_MS &&
        phaseDelayMs <= expectedDelayMs + MAX_BOUNDARY_STEPS * IMPACT_BOUNDARY_STEP_MS + FLOAT_EPSILON_MS,
      `${phase.activeAbilityPath} impact ${phaseDelayMs}ms escaped the epsilon-safe ${expectedDelayMs}ms phase bounds`,
    );
    const hpChanged = before.monsters.some((monster) => {
      const afterMonster = after.monsters.find((candidate) => candidate.id === monster.id);
      return afterMonster === undefined || afterMonster.hp !== monster.hp;
    });
    const effectsStarted =
      after.activeEffects > before.activeEffects ||
      after.activeEffectNodes.length > before.activeEffectNodes.length;
    assert(hpChanged, `${phase.activeAbilityPath} reached impact without same-advance HP/removal output`);
    assert(effectsStarted, `${phase.activeAbilityPath} reached impact without same-advance visual effect output`);
    assert(lastTransitionStep, `${phase.activeAbilityPath} impact boundary produced no sampled step`);
    const firstHpChange = lastTransitionStep.changes.find((change) => change.kind === "hp-change");
    const firstEffectChange = lastTransitionStep.changes.find(
      (change) => change.kind === "effect-change" && change.added.length > 0,
    );
    assert(firstHpChange, `${phase.activeAbilityPath} HP did not first change on the bounded impact step`);
    assert(firstEffectChange, `${phase.activeAbilityPath} effect did not first change on the bounded impact step`);
    assert.equal(
      firstHpChange.stepIndex,
      firstEffectChange.stepIndex,
      `${phase.activeAbilityPath} HP/effect first-change steps diverged`,
    );
    assert.equal(
      firstHpChange.atElapsedMs,
      firstEffectChange.atElapsedMs,
      `${phase.activeAbilityPath} HP/effect first-change timestamps diverged`,
    );
    const lethalTarget = before.monsters.find((monster) => {
      if (monster.team !== 1 || monster.hp <= 0) return false;
      const afterMonster = after.monsters.find((candidate) => candidate.id === monster.id);
      return afterMonster === undefined || afterMonster.hp <= 0;
    });
    const lethal = lethalTarget !== undefined;
    const kind = lethal ? "lethal" : actor.team === 0 ? "friendly" : "enemy";
    if (impactTrace[kind] === null) {
      impactTrace[kind] = {
        actorId: actor.id,
        abilityPath: phase.activeAbilityPath,
        phaseDelayMs,
        atElapsedMs: after.presentation.elapsedMs,
        hpFirstChangeStep: firstHpChange.stepIndex,
        effectFirstChangeStep: firstEffectChange.stepIndex,
      };
    }
    if (lethal) {
      lethalLifecycleId = lethalTarget.id;
    }
    return after;
  };

  const swipeCurrentMove = async () => {
    // handleRecognizer resolves a single target only when the stroke midpoint hits a targetable
    // field node. Keep slot 1's source left-to-right pattern, but derive that field point live.
    const current = await state();
    const target = current.monsters.find((monster) => monster.team === 1 && monster.targetPoint);
    assert(target?.targetPoint, "timing swipe requires a live enemy target point");
    const { toCss } = await stageGeometry(page, canvasBox);
    const start = toCss({ x: target.targetPoint.x - 30, y: target.targetPoint.y });
    const end = toCss({ x: target.targetPoint.x + 30, y: target.targetPoint.y });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 18; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 18, start.y, { steps: 1 });
    }
    await page.mouse.up();
  };

  let enemyLeadIn = null;
  let enemyActivationPulseObserved = false;
  let lethalEnemyId = null;
  let playerMoves = 0;
  let friendlyTransitionVerified = false;
  const initialEnemyIds = (await state()).monsters.filter((m) => m.team === 1).map((m) => m.id);
  let fallStart = null;
  let fallMid = null;
  let deathReflowObserved = false;
  let lastQueueBeforeFall = [];
  const observeFall = async (snapshot) => {
    const entry = snapshot.turnOrderFalling.find((candidate) => initialEnemyIds.includes(candidate.id));
    if (!entry) {
      lastQueueBeforeFall = [...snapshot.displayedQueue];
      return;
    }
    const previousIndex = lastQueueBeforeFall.indexOf(entry.id);
    if (!fallStart) {
      fallStart = {
        id: entry.id,
        x: 12,
        y: previousIndex >= 0 ? (previousIndex + 1) * 34 : entry.y,
        rotationDeg: 0,
      };
      const shiftedId = lastQueueBeforeFall.find((id) => {
        const oldIndex = lastQueueBeforeFall.indexOf(id);
        const newIndex = snapshot.displayedQueue.indexOf(id);
        return id !== entry.id && newIndex >= 0 && oldIndex !== newIndex;
      });
      if (shiftedId) {
        const oldY = (lastQueueBeforeFall.indexOf(shiftedId) + 1) * 34;
        const targetY = (snapshot.displayedQueue.indexOf(shiftedId) + 1) * 34;
        for (let i = 0; i < 16 && !deathReflowObserved; i++) {
          const sample = await state();
          const live = sample.turnOrderEntries.find((candidate) => candidate.id === shiftedId);
          if (live && Math.abs(live.y - oldY) > 0.01 && Math.abs(live.y - targetY) > 0.01) {
            deathReflowObserved = true;
            await page.screenshot({ path: path.join(outputDir, "death-reflow.png"), timeout: 120_000 });
            break;
          }
          await advance(100);
        }
      }
    }
    if (!fallMid) {
      let progressed = entry;
      if (entry.rotationDeg <= 80) {
        await advance(500);
        const progressedState = await state();
        progressed = progressedState.turnOrderFalling.find((candidate) => candidate.id === entry.id);
      }
      if (progressed) {
        fallMid = { ...progressed };
        await page.screenshot({ path: path.join(outputDir, "tu-death-fall.png"), timeout: 120_000 });
      }
    }
  };

  for (let i = 0; i < 1600 && (!enemyLeadIn || !lethalEnemyId); i++) {
    const before = await state();
    await observeFall(before);
    let current;
    if (before.presentation.state === "phaseDelay") {
      current = await tracePhaseBoundary(before);
    } else if (before.presentation.state === "awaitingPlayerChoice" && before.panelVisible && before.friendlyRowVisible === false) {
      if (playerMoves > 0 && !friendlyTransitionVerified) {
        assert.equal(before.turnOrderAnimating, true, "friendly TU trailing reflow did not animate");
        assert.equal(before.displayedQueue[0], before.activeActorId, "friendly actor did not reach TU 0 before its panel opened");
        assert.deepEqual(before.displayedQueue, before.queue, "friendly TU sidebar did not settle to engine order");
        const movingEntries = before.turnOrderEntries.filter((entry) => {
          const index = before.displayedQueue.indexOf(entry.id);
          return index >= 0 && (entry.x !== 12 || Math.abs(entry.y - (index + 1) * 34) > 0.01);
        });
        const restoringActor = before.turnOrderEntries.find((entry) => {
          const index = before.displayedQueue.indexOf(entry.id);
          return index >= 0 && entry.scaleX < 0.99 && Math.abs(entry.y - (index + 1) * 34) < 0.01;
        });
        assert(restoringActor, "old TU front was not peeling right after reaching its destination");
        assert(
          movingEntries.some((entry) => entry.id !== restoringActor.id),
          "other TU entries did not move simultaneously with the actor's peel-right leg",
        );
        await page.screenshot({ path: path.join(outputDir, "friendly-reflow.png"), timeout: 120_000 });
        let settledFriendly = await state();
        for (
          let waited = 0;
          waited < TURN_ORDER_SETTLE_BUDGET_MS && settledFriendly.turnOrderAnimating;
          waited += 50
        ) {
          await advance(50);
          settledFriendly = await state();
        }
        assert.equal(settledFriendly.turnOrderAnimating, false, "friendly TU reflow never settled");
        for (const entry of settledFriendly.turnOrderEntries) {
          const index = settledFriendly.displayedQueue.indexOf(entry.id);
          assert(index >= 0);
          assert.equal(entry.x, 12);
          assert(Math.abs(entry.y - (index + 1) * 34) < 0.01, `${entry.id} did not finish at its queue slot`);
          assert(Math.abs(entry.scaleX - 1) < 0.01, `${entry.id} did not finish in its normal orientation`);
        }
        await page.screenshot({ path: path.join(outputDir, "friendly-ready.png"), timeout: 120_000 });
        friendlyTransitionVerified = true;
      }
      const actorId = before.activeActorId;
      assert(actorId, "timing swipe requires an active player actor");
      await swipeCurrentMove();
      await page.waitForFunction(
        (expectedActorId) => {
          const current = JSON.parse(window.render_game_to_text());
          return current.battleInput.latestPlayerSubmission?.actorId === expectedActorId && current.panelVisible === false;
        },
        actorId,
        { timeout: 3_000 },
      );
      const submitted = await state();
      assert.equal(submitted.battleInput.latestSwipeTargetFeedback, null, "valid timing swipe must not produce notAllowed feedback");
      assert.equal(submitted.picking, false, "valid timing swipe must submit without target picking");
      playerMoves += 1;
      await advance(50);
      current = await state();
    } else {
      await advance(50);
      current = await state();
    }

    await observeFall(current);
    if (!enemyLeadIn && current.presentation.state === "turnLeadIn" && current.activeActorId?.startsWith("t1")) {
      const startedAt = current.presentation.elapsedMs - current.presentation.stateAgeMs;
      const friendlyHpAtStart = Object.fromEntries(current.monsters.filter((m) => m.team === 0).map((m) => [m.id, m.hp]));


      await advance(50);
      const acknowledged = await state();
      assert.equal(acknowledged.queue[0], current.activeActorId, "engine queue does not lead with the deciding enemy");
      assert(
        acknowledged.turnOrderAnimating || acknowledged.displayedQueue[0] === current.activeActorId,
        `TU sidebar neither started its front change nor already showed the deciding enemy: ${
          JSON.stringify({ displayed: acknowledged.displayedQueue, queue: acknowledged.queue })}`,
      );


      let settledWaiting = await state();
      for (
        let waited = 0;
        waited < ENEMY_TURN_LEAD_IN_MS && settledWaiting.presentation.state === "turnLeadIn" &&
          (settledWaiting.turnOrderAnimating ||
            settledWaiting.displayedQueue[0] !== current.activeActorId);
        waited += 50
      ) {
        await advance(50);
        settledWaiting = await state();
      }
      assert.equal(settledWaiting.presentation.state, "turnLeadIn", "enemy acted before its decision wait completed");
      assert.equal(settledWaiting.turnOrderAnimating, false, "prior TU transition did not settle during enemy wait");
      assert.equal(settledWaiting.displayedQueue[0], current.activeActorId, "settled sidebar lost the waiting enemy");
      assert.deepEqual(
        settledWaiting.displayedQueue,
        settledWaiting.queue,
        "engine and TU sidebar must share the unresolved enemy queue once the front change settles",
      );
      const waitingActor = settledWaiting.monsters.find((monster) => monster.id === current.activeActorId);
      assert(waitingActor, "waiting enemy had no rendered field sprite");
      const enemyBaseScale = waitingActor.targetScale.x;
      await page.screenshot({ path: path.join(outputDir, "enemy-waiting.png"), timeout: 120_000 });

      let phase = settledWaiting;
      while (phase.presentation.state === "turnLeadIn") {
        await advance(50);
        phase = await state();
      }
      const leadInMs = phase.presentation.elapsedMs - startedAt;
      assert(
        leadInMs >= ENEMY_TURN_LEAD_IN_MS - FLOAT_EPSILON_MS,
        `enemy turn escaped its ${ENEMY_TURN_LEAD_IN_MS}ms source gate (2250ms / gameSpeed ${GAME_SPEED}) after only ${leadInMs}ms`,
      );
      assert.equal(phase.turnOrderAnimating, false, "enemy phase began before the TU sidebar transition finished");
      assert.deepEqual(
        Object.fromEntries(phase.monsters.filter((m) => m.team === 0).map((m) => [m.id, m.hp])),
        friendlyHpAtStart,
        "enemy damage landed during the turn lead-in",
      );

      // The first externally observable phaseDelay sample may precede the tween's first ticker
      // update. Sample only this actor across the source's 500ms rising leg, but reserve the final
      // 1ms for tracePhaseBoundary's exact impact-edge proof below.
      const pulseRiseMs = 500 / phase.presentation.gameSpeed;
      while (phase.presentation.state === "phaseDelay" && phase.presentation.stateAgeMs < pulseRiseMs) {
        assert.equal(phase.displayedQueue[0], current.activeActorId, "TU sidebar moved before enemy impact");
        assert.notDeepEqual(phase.displayedQueue, phase.queue, "TU sidebar registered the resolved enemy action before impact");
        const actingEnemy = phase.monsters.find((monster) => monster.id === current.activeActorId);
        if (!enemyActivationPulseObserved && actingEnemy && actingEnemy.targetScale.x > enemyBaseScale + 0.01) {
          enemyActivationPulseObserved = true;
          await page.screenshot({ path: path.join(outputDir, "enemy-activation-pulse.png"), timeout: 120_000 });
          break;
        }
        const remainingBeforeBoundaryProbe = pulseRiseMs - IMPACT_BOUNDARY_STEP_MS - phase.presentation.stateAgeMs;
        if (remainingBeforeBoundaryProbe <= 0) break;
        await advance(Math.min(TRACE_STEP_MS, remainingBeforeBoundaryProbe));
        await page.waitForTimeout(1);
        phase = await state();
      }
      phase = await tracePhaseBoundary(phase);
      const enemyImpact = impactTrace.enemy;
      assert(enemyImpact, "enemy impact trace missing after enemy phase boundary");
      const phaseDelayMs = enemyImpact.phaseDelayMs;
      enemyLeadIn = { actorId: current.activeActorId, startedAt, leadInMs, phaseDelayMs, queue: settledWaiting.queue };
      await observeFall(phase);
      await advance(550);
      const restoredPulse = await state();
      const restoredEnemy = restoredPulse.monsters.find((monster) => monster.id === current.activeActorId);
      assert(restoredEnemy, "acting enemy disappeared before its activation pulse restored");
      assert(
        Math.abs(restoredEnemy.targetScale.x - enemyBaseScale) < 0.001,
        "enemy field sprite did not return to its captured scale after the activation pulse",
      );
      await page.screenshot({ path: path.join(outputDir, "enemy-activation-restored.png"), timeout: 120_000 });
      await observeFall(restoredPulse);
    }

    const visibleIds = new Set(current.monsters.map((m) => m.id));
    lethalEnemyId = initialEnemyIds.find((id) => !visibleIds.has(id)) ?? null;
  }

  assert(enemyLeadIn, "did not observe an enemy turn lead-in");
  assert(impactTrace.friendly, "did not observe a friendly same-advance HP/effect impact bundle");
  assert(impactTrace.enemy, "did not observe an enemy same-advance HP/effect impact bundle");
  assert(impactTrace.lethal, "did not observe a lethal same-advance HP/effect impact bundle");
  assert(enemyActivationPulseObserved, "enemy field sprite did not scale up when its ability activated");
  assert(friendlyTransitionVerified, "did not verify a post-action friendly TU transition");
  assert(lethalEnemyId, "repeated player attacks did not kill an enemy");
  assert(fallStart, "dead enemy TU entry did not begin its falling animation");
  assert.equal(fallStart.id, lethalEnemyId, "observed the wrong TU entry falling");
  assert(fallMid, "dead enemy TU entry was removed before the source's 3s fall completed");
  assert(deathReflowObserved, "surviving TU entries snapped after a death instead of reflowing");
  assert(fallMid.y <= 415, "dead TU entry overshot its source fall target");
  assert(fallMid.rotationDeg > 0 && fallMid.rotationDeg <= 90, "dead TU entry did not rotate toward 90 degrees");

  let final = await state();
  for (let i = 0; i < 600; i++) {
    if (
      final.presentation.state === "awaitingPlayerChoice" &&
      final.panelVisible &&
      final.activeEffects === 0 &&
      final.friendlyPopForwardCount === 0
    ) break;
    await advance(50);
    final = await state();
  }
  assert.equal(final.presentation.state, "awaitingPlayerChoice", "battle did not settle after lethal hit");
  assert.equal(final.activeEffects, 0, "ability effects remained after the battle settled");
  assert(!final.queue.includes(lethalEnemyId), "dead enemy remained in engine queue");
  assert(!final.displayedQueue.includes(lethalEnemyId), "dead enemy remained in TU sidebar");
  for (let i = 0; i < 80 && final.turnOrderFalling.length > 0; i++) {
    await advance(50);
    final = await state();
  }
  assert.equal(final.turnOrderFalling.length, 0, "dead TU entry remained after its 3s fall");
  assert(lethalLifecycleId, "transition sampler never identified the lethal target at its HP edge");
  // `applyHp` writes zero before `EnemyTeamDisplay.notifyDied`, but the latter synchronously
  // removes its live display entry. `render_game_to_text` consequently has no serializable
  // `{ id, hp: 0 }` target snapshot for an ordinary enemy death: the verified first observable
  // target transition is its field removal on the same impact step. Preserve that real surface
  // rather than fabricating a post-removal HP value.
  const lethalImpactStep = impactTrace.lethal?.hpFirstChangeStep;
  assert(Number.isInteger(lethalImpactStep), "lethal impact trace has no sampled impact step");
  const lethalHp = transitionSamples.find(
    (entry) =>
      entry.kind === "hp-change" &&
      entry.id === lethalLifecycleId &&
      entry.beforeHp > 0 &&
      entry.afterHp <= 0 &&
      entry.stepIndex === lethalImpactStep,
  );
  const lethalRemoval = transitionSamples.find(
    (entry) =>
      entry.kind === "field-removal" &&
      entry.id === lethalLifecycleId &&
      entry.stepIndex === lethalImpactStep,
  );
  const lethalImpact = lethalHp ?? lethalRemoval;
  assert(lethalImpact, "transition sampler missed the lethal HP/removal impact transition");
  const lethalImpactTrace = impactTrace.lethal;
  assert(lethalImpactTrace, "lethal impact trace missing before lifecycle correlation");
  assert.equal(lethalImpactTrace.actorId, EXPECTED_LETHAL_ACTOR_ID, "lethal fixture used the wrong actor");
  assert.equal(lethalImpactTrace.abilityPath, EXPECTED_LETHAL_ABILITY_PATH, "lethal fixture used the wrong ability");
  assert.equal(lethalLifecycleId, EXPECTED_LETHAL_TARGET_ID, "lethal fixture identified the wrong target");
  assert.equal(lethalImpact.id, EXPECTED_LETHAL_TARGET_ID, "lethal impact record identified the wrong target");
  // Scope every lifecycle expectation to the nearest matching AttackAll phase start through its
  // next actor. A global first/last search can otherwise join events from unrelated turns.
  const lethalPhaseStart = [...transitionSamples].reverse().find(
    (entry) =>
      entry.kind === "presentation-change" &&
      entry.afterState === "phaseDelay" &&
      entry.actorId === lethalImpactTrace.actorId &&
      entry.stepIndex <= lethalImpact.stepIndex,
  );
  assert(lethalPhaseStart, "transition sampler missed lethal AttackAll phase start");
  const fromLethalPhase = transitionSamples.filter((entry) => entry.stepIndex >= lethalPhaseStart.stepIndex);
  const afterLethalImpact = fromLethalPhase.filter((entry) => entry.stepIndex >= lethalImpact.stepIndex);
  const incomingActor = afterLethalImpact.find(
    (entry) =>
      entry.kind === "presentation-change" &&
      entry.stepIndex > lethalImpact.stepIndex &&
      entry.afterState === "turnLeadIn" &&
      entry.actorId !== lethalImpact.id,
  );
  assert(incomingActor, "transition sampler missed incoming actor state");
  const lethalTransitionSlice = fromLethalPhase.filter((entry) => entry.stepIndex <= incomingActor.stepIndex);
  const findInLethalSlice = (kind, predicate = () => true) => lethalTransitionSlice.find(
    (entry) => entry.kind === kind && predicate(entry),
  );
  const deathStart = findInLethalSlice(
    "presentation-change",
    (entry) => entry.stepIndex === lethalImpact.stepIndex && entry.afterState === "deathResolution",
  );


  const engineRemoval = findInLethalSlice(
    "engine-queue-change",
    (entry) => entry.before.includes(lethalLifecycleId) && !entry.after.includes(lethalLifecycleId),
  );
  const queueRefresh = findInLethalSlice(
    "displayed-queue-change",
    (entry) =>
      entry.stepIndex === lethalImpact.stepIndex &&
      entry.before.includes(lethalLifecycleId) &&
      !entry.after.includes(lethalLifecycleId),
  );
  const tuReflow = findInLethalSlice(
    "tu-layout-change",
    (entry) => entry.stepIndex === lethalImpact.stepIndex,
  );
  const expectedRemovalIds = [EXPECTED_COLLATERAL_REMOVAL_ID, EXPECTED_LETHAL_TARGET_ID].sort();
  const removalsAtImpact = lethalTransitionSlice.filter(
    (entry) => entry.kind === "field-removal" && entry.stepIndex === lethalImpact.stepIndex,
  );
  assert.deepEqual(
    removalsAtImpact.map((entry) => entry.id).sort(),
    expectedRemovalIds,
    "lethal AttackAll did not remove the exact two expected displays at impact",
  );
  const fieldRemoval = removalsAtImpact.find((entry) => entry.id === lethalLifecycleId);
  const fallStartTransition = findInLethalSlice(
    "death-fall-start",
    (entry) => entry.stepIndex === lethalImpact.stepIndex && entry.id === lethalLifecycleId,
  );
  const sameImpactEffect = findInLethalSlice(
    "effect-change",
    (entry) => entry.stepIndex === lethalImpact.stepIndex && entry.added.length > 0,
  );
  const fallCompleteTransition = fromLethalPhase.find(
    (entry) => entry.kind === "death-fall-complete" && entry.id === lethalLifecycleId,
  );
  assert(deathStart, "transition sampler missed deathResolution entry");
  assert(engineRemoval, "transition sampler missed lethal engine-queue removal");
  assert(queueRefresh, "transition sampler missed displayed queue refresh");
  assert(tuReflow, "transition sampler missed TU reflow motion");
  assert(fieldRemoval, "transition sampler missed field death/removal completion");
  assert(fallStartTransition, "transition sampler missed TU death-fall start");
  assert(fallCompleteTransition, "transition sampler missed TU death-fall completion");
  assert(sameImpactEffect, "lethal AttackAll did not add an effect on its impact step");
  assert(deathStart.stepIndex >= lethalImpact.stepIndex, "death resolution began before lethal HP/removal impact");
  assert(engineRemoval.stepIndex <= lethalImpact.stepIndex, "engine queue removal escaped its pre-impact resolution window");
  assert(queueRefresh.stepIndex >= lethalImpact.stepIndex, "displayed queue refreshed before lethal presentation impact");
  assert(tuReflow.stepIndex >= lethalImpact.stepIndex, "TU reflow began before lethal presentation impact");
  assert(fieldRemoval.stepIndex >= deathStart.stepIndex, "field removal completed before death started");
  assert(fallStartTransition.stepIndex >= lethalImpact.stepIndex, "TU fall began before lethal impact");
  assert(fallCompleteTransition.stepIndex > fallStartTransition.stepIndex, "TU fall completed before it started");
  assert(incomingActor.stepIndex > deathStart.stepIndex, "incoming actor began before death-resolution hold");
  const removalHoldMs = incomingActor.atElapsedMs - deathStart.atElapsedMs;
  const expectedRemovalHoldMs = REMOVED_LIVING_LOGIC_HOLD_MS * expectedRemovalIds.length;
  assert(
    removalHoldMs >= expectedRemovalHoldMs - FLOAT_EPSILON_MS &&
      removalHoldMs <= expectedRemovalHoldMs + TRACE_STEP_MS + FLOAT_EPSILON_MS,
    `incoming actor escaped the source ${expectedRemovalHoldMs}ms removal hold at ${removalHoldMs}ms`,
  );
  assert(incomingActor.actorId?.startsWith("t0"), "lethal fixture did not enter the expected friendly incoming turn");
  const incomingChoice = fromLethalPhase.find(
    (entry) =>
      entry.kind === "presentation-change" &&
      entry.stepIndex > incomingActor.stepIndex &&
      entry.afterState === "awaitingPlayerChoice" &&
      entry.actorId === incomingActor.actorId,
  );
  assert(incomingChoice, "transition sampler missed incoming friendly player-choice state");
  const incomingPacingMs = incomingChoice.atElapsedMs - incomingActor.atElapsedMs;
  assert(
    incomingPacingMs >= FRIENDLY_INCOMING_PACING_MS - FLOAT_EPSILON_MS &&
      incomingPacingMs <= FRIENDLY_INCOMING_PACING_MS + TRACE_STEP_MS + FLOAT_EPSILON_MS,
    `incoming friendly actor escaped its source ${FRIENDLY_INCOMING_PACING_MS}ms lead-in at ${incomingPacingMs}ms`,
  );
  const fallDurationMs = fallCompleteTransition.atElapsedMs - fallStartTransition.atElapsedMs;
  assert(
    fallDurationMs >= TU_DEATH_FALL_MS - FLOAT_EPSILON_MS &&
      fallDurationMs <= TU_DEATH_FALL_MS + TRACE_STEP_MS + FLOAT_EPSILON_MS,
    `TU death fall completed outside its source ${TU_DEATH_FALL_MS}ms bound (3000ms / gameSpeed ${GAME_SPEED}) at ${fallDurationMs}ms`,
  );
  const lethalTrace = fromLethalPhase.filter((entry) =>
    entry.stepIndex <= Math.max(fallCompleteTransition.stepIndex, incomingActor.stepIndex));
  assert.equal(errors.length, 0, errors.join("\n"));

  await page.screenshot({ path: path.join(outputDir, "post-lethal-turn.png"), timeout: 120_000 });
  fs.writeFileSync(
    path.join(outputDir, "state.json"),
    JSON.stringify({ gameSpeed: built.presentation.gameSpeed, impactTrace, lethalTrace, enemyLeadIn, lethalEnemyId, final }, null, 2) + "\n",
  );
  console.log(`turn-timing: PASS (gameSpeed ${GAME_SPEED}; enemy lead-in ${enemyLeadIn.leadInMs}ms; killed ${lethalEnemyId})`);
} finally {
  await browser.close();
}
