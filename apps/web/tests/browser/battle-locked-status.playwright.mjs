


import assert from "node:assert/strict";
import { chromium } from "playwright";

import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const FRAME_MS = 1000 / 60;

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
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    // Hypnosis leaves SnowCub disabled. Its forced Utility.LooseTurn supplies the shipped
    // source-phase status line and runs the source state-1 acknowledgment gate on the next loop.
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "Fairy", level: 10 }],
      enemyTeam: [{ shortType: "SnowCub", level: 5 }],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  for (let i = 0; i < 600 && (await state()).mode !== "start"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal((await state()).mode, "start", "title did not settle before locked-status fixture");
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  assert.equal((await state()).startup?.phase, "title", "locked-status fixture must begin at the title touch layer");
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
    `title did not reach save selection for locked-status fixture: ${JSON.stringify(startup)}`,
  );
  if (startup.startup?.phase === "save-select") {
    await advance(250);
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `slot-1 must be enabled after title transition: ${JSON.stringify(startup.startup)}`);
    const { toCss } = await stageGeometry(page, canvasBox);
    const point = toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }

  const waitFor = async (predicate, description, limit = 2400) => {
    let snapshot;
    for (let i = 0; i < limit; i++) {
      snapshot = await state();
      if (snapshot.presentation?.state !== "building" && predicate(snapshot)) return snapshot;
      await advance(25);
      if (i % 20 === 0) await page.waitForTimeout(1);
    }
    assert.fail(`${description}: ${JSON.stringify(snapshot)}`);
  };

  const fairyReady = await waitFor(
    (snapshot) =>
      snapshot.presentation?.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible &&
      snapshot.activeActorId === "t0m0:Fairy",
    "Fairy never reached an actionable panel",
  );
  const hypnosis = fairyReady.abilityButtons.find((button) => button.abilityPath === "Offensive.Sleep.Sleep");
  const snowCub = fairyReady.monsters.find((monster) => monster.id === "t1m0:SnowCub");
  assert(hypnosis && snowCub, "Hypnosis card or SnowCub field target missing");
  const { toCss } = await stageGeometry(page, canvasBox);
  const panelPoint = toCss(hypnosis.center);
  const fieldPoint = toCss(snowCub.targetPoint);

  const castHypnosis = async () => {
    // Resolve this card from the current panel rather than retaining a point from a prior turn.
    // `awaitingPlayerChoice` is entered before a replacement panel's dynamic children have had a
    // production ticker sample to settle, so the caller gates that readiness separately below.
    const current = await state();
    const card = current.abilityButtons.find((button) => button.abilityPath === "Offensive.Sleep.Sleep");
    assert(card, "current Hypnosis card missing before tap");
    const cardPoint = toCss(card.center);
    await page.mouse.click(cardPoint.x, cardPoint.y);
    const picking = await waitFor(
      (snapshot) => snapshot.presentation?.state === "targetPicking",
      "Hypnosis did not open target picking",
      300,
    );
    const target = picking.monsters.find((monster) => monster.id === "t1m0:SnowCub");
    assert(target, "SnowCub disappeared before target selection");
    const targetPoint = toCss(target.targetPoint);
    await page.mouse.click(targetPoint.x, targetPoint.y);
  };

  const waitForLooseTurnStatus = () => waitFor(
    (snapshot) =>
      snapshot.statusText?.visible === true &&
      typeof snapshot.statusText.text === "string" &&
      snapshot.statusText.text.includes("loses its turn") &&
      snapshot.panelVisible === false,
    "forced Utility.LooseTurn never reached the state-1 status gate",
  );
  const lockedSnapshot = (snapshot) => ({
    activeActorId: snapshot.activeActorId,
    presentationState: snapshot.presentation.state,
    activePopup: snapshot.activePopup,
    queue: snapshot.queue,
    displayedQueue: snapshot.displayedQueue,
    playerAbilitySubmissionCount: snapshot.battleInput.playerAbilitySubmissionCount,
    latestPlayerSubmission: snapshot.battleInput.latestPlayerSubmission,
    panelVisible: snapshot.panelVisible,
    statusText: snapshot.statusText,
  });
  const assertHeldForDeterministicTime = async (initial, route) => {
    const before = lockedSnapshot(initial);
    const startedAt = initial.presentation.elapsedMs;
    let held = initial;
    // Stay well below ChainedTextLabel's cited 5.0s waitLimit while proving ticker progress alone
    // cannot release state 1. Real yields keep asset/browser tasks serviceable.
    for (let i = 0; i < 4; i++) {
      await advance(100);
      await page.waitForTimeout(1);
      held = await state();
      const current = lockedSnapshot(held);
      assert.equal(current.activeActorId, before.activeActorId, `${route} gate advanced actor without finish callback`);
      assert.equal(current.presentationState, before.presentationState, `${route} gate changed state without finish callback`);
      assert.equal(current.activePopup, before.activePopup, `${route} gate opened a popup while unacknowledged`);
      assert.deepEqual(current.queue, before.queue, `${route} gate mutated queue while unacknowledged`);
      assert.deepEqual(current.displayedQueue, before.displayedQueue, `${route} gate mutated TU order while unacknowledged`);
      assert.deepEqual(
        current.latestPlayerSubmission,
        before.latestPlayerSubmission,
        `${route} gate accepted input while unacknowledged`,
      );
      assert.equal(
        current.playerAbilitySubmissionCount,
        before.playerAbilitySubmissionCount,
        `${route} gate submitted a player ability while unacknowledged`,
      );
      assert.equal(current.panelVisible, false, `${route} gate restored panel while unacknowledged`);
      assert.deepEqual(current.statusText, before.statusText, `${route} gate changed status text before finish callback`);
    }
    assert(
      held.presentation.elapsedMs - startedAt >= 400 - 0.001,
      `${route} gate did not remain closed across 400ms of deterministic time`,
    );
    return held;
  };
  const assertHeldOnPointerDown = (before, after, route) => {
    assert.deepEqual(after.queue, before.queue, `${route} pointer down mutated the state-1 queue`);
    assert.deepEqual(after.displayedQueue, before.displayedQueue, `${route} pointer down mutated TU display order`);
    assert.deepEqual(
      after.battleInput.latestPlayerSubmission,
      before.latestPlayerSubmission,
      `${route} pointer down reached an underlying player action`,
    );
    assert.equal(
      after.battleInput.playerAbilitySubmissionCount,
      before.playerAbilitySubmissionCount,
      `${route} pointer down submitted an underlying player action`,
    );
    assert.equal(after.activePopup, before.activePopup, `${route} pointer down opened an underlay popup`);
    assert.equal(after.panelVisible, false, `${route} pointer down restored the underlay panel before status finish`);
    assert.deepEqual(after.statusText, before.statusText, `${route} pointer down altered the queued status page`);
  };
  const releaseStatusThrough = async (point, beforeState, route) => {
    const before = lockedSnapshot(beforeState);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.waitForTimeout(1);
    const held = await state();
    assertHeldOnPointerDown(before, held, route);
    await page.mouse.up();
    // The release is StatusTextDisplay.advance -> waitForAcknowledgment -> BattleNode's state-1
    // continuation. Unlike notifyBattleStateChangedTo:'s empty-text branch, statusTextAdvance:
    // adds no team pacing. First prove the synchronous callback did not advance source time, then
    // sample one normal BattleNode update/render. SnowCub can remain TU-front and produce another
    // LooseTurn, so a state-age reset or changed status backlog is also valid callback evidence.
    let callbackState = await state();
    for (let i = 0; i < 20; i++) {
      const progressed =
        callbackState.presentation.state !== before.presentationState ||
        callbackState.presentation.stateAgeMs < beforeState.presentation.stateAgeMs ||
        JSON.stringify(callbackState.statusText) !== JSON.stringify(before.statusText) ||
        JSON.stringify(callbackState.queue) !== JSON.stringify(before.queue);
      if (progressed) break;
      await page.waitForTimeout(1);
      callbackState = await state();
    }
    assert(
      callbackState.presentation.state !== before.presentationState ||
        callbackState.presentation.stateAgeMs < beforeState.presentation.stateAgeMs ||
        JSON.stringify(callbackState.statusText) !== JSON.stringify(before.statusText) ||
        JSON.stringify(callbackState.queue) !== JSON.stringify(before.queue),
      `${route} release did not invoke the status finish callback/state-1 continuation`,
    );
    assert.equal(
      callbackState.presentation.elapsedMs,
      beforeState.presentation.elapsedMs,
      `${route} status finish advanced source time inside its callback`,
    );
    await advance(FRAME_MS);
    const continued = await state();
    assert.notEqual(continued.presentation.state, "turnLeadIn", `${route} status finish inherited ordinary pacing`);
    assert(
      Math.abs(continued.presentation.elapsedMs - beforeState.presentation.elapsedMs - FRAME_MS) < 0.01,
      `${route} status finish did not reach continuation within one render update`,
    );
    assert.equal(continued.activePopup, null, `${route} status finish release opened an unrelated popup`);
    assert.equal(
      continued.battleInput.playerAbilitySubmissionCount,
      before.playerAbilitySubmissionCount,
      `${route} status finish release submitted an underlay panel action`,
    );
    if (continued.battleInput.latestPlayerSubmission !== null) {
      assert.deepEqual(
        continued.battleInput.latestPlayerSubmission,
        before.latestPlayerSubmission,
        `${route} status finish release replaced the latest submission evidence`,
      );
    }
    return continued;
  };

  await castHypnosis();
  const firstStatus = await assertHeldForDeterministicTime(await waitForLooseTurnStatus(), "field");
  await releaseStatusThrough(fieldPoint, firstStatus, "field");

  const returnedPanel = await waitFor(
    (snapshot) =>
      snapshot.presentation?.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible === true &&
      snapshot.activeActorId === "t0m0:Fairy" &&
      snapshot.statusText?.visible === false,
    "field status finish did not reach the terminal input-restored player state",
  );
  assert.equal(returnedPanel.activePopup, null, "status completion must not leave a popup over the restored panel");

  // Do not treat the logical state transition as card hit-test readiness. The rebuilt panel's
  // dynamic ButtonSprites are observed on the next production ticker sample; without that sample
  // a click at the otherwise correct card center reaches only battleScene.
  await waitFor(
    (snapshot) =>
      snapshot.presentation?.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible === true &&
      snapshot.activeActorId === "t0m0:Fairy" &&
      snapshot.statusText?.visible === false &&
      snapshot.abilityButtons.some((button) => button.abilityPath === "Offensive.Sleep.Sleep") &&
      snapshot.presentation.elapsedMs - returnedPanel.presentation.elapsedMs >= 25 - 0.001,
    "restored Fairy panel did not receive a post-transition ticker sample before the second real tap",
  );

  // A real panel action is admitted only after the state-1 status finish restored this terminal
  // choice state. Reapply Hypnosis to create a second locked page for the panel-coordinate probe.
  await castHypnosis();
  const secondStatus = await assertHeldForDeterministicTime(await waitForLooseTurnStatus(), "turn-panel");
  await releaseStatusThrough(panelPoint, secondStatus, "turn-panel");

  const terminal = await waitFor(
    (snapshot) =>
      snapshot.presentation?.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible === true &&
      snapshot.activeActorId === "t0m0:Fairy" &&
      snapshot.statusText?.visible === false,
    "turn-panel status finish did not restore input only after the terminal state",
  );
  assert.equal(terminal.activePopup, null, "terminal status completion left an unrelated popup");
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("battle-locked-status: PASS (field/panel status ownership and state-1 finish continuation)");
} finally {
  await browser.close();
}
