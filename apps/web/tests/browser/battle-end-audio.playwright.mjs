


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/battle-end-audio");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  // no-user-gesture-required: the win jingle plays from ticker time, not a click stack. In a real
  // session Chrome's "user has interacted with the domain" rule covers it (the tap-to-begin
  // overlay); synthesized CDP input doesn't reliably establish that, so the policy is disabled
  // here rather than pretending the harness models real engagement.
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--autoplay-policy=no-user-gesture-required", "--mute-audio"],
});

/** Runs one battle to its end popup, asserting after every time step that at most one music
 *  element is unpaused (the channel-exclusivity invariant). Returns the final music log.
 *  `expectLevelUpPages`/`expectedEvolutions` drive the post-Close chain (levelup-evolution-flow.md):
 *  tap-through level-up pages on the shared status box, then the beginEvolve loop. */
async function runBattle({
  playerLevel,
  enemyLevel,
  label,
  expectedPopup,
  playerCount = 1,
  expectedButton = "Ok",
  expectLevelUpPages = false,
  expectedEvolutions = null,
  expectedAward = null,
  expectedPartyLevel = null,
}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.addInitScript(
    ([pLevel, eLevel, pCount]) => {
      window.advanceTime = () => Promise.resolve();
      // This scenario times the post-battle bars against the source DelayTime, which the
      // first-capture "NEW!" overlay sits in front of. Pin the collection seam so the
      // another fixture's collection override cannot change what the win sequence renders.
      window.__DIB_TEST_ALL_UNLOCKED__ = false;
      // 1v1 with a lopsided level gap so the battle ends in a handful of turns either way.
      window.__DIB_TEST_ENCOUNTER__ = {
        backgroundKey: "ForestCombat",
        playerTeam: ["FireCub", "SnowCub", "WhiteDragonling"]
          .slice(0, pCount)
          .map((shortType) => ({ shortType, level: pLevel })),
        enemyTeam: [{ shortType: "Spark", level: eLevel }],
      };
      const NativeAudio = window.Audio;
      window.__musicLog = [];
      window.Audio = function (src) {
        const el = new NativeAudio(src);
        window.__musicLog.push(el);
        return el;
      };
      window.__musicSnapshot = () =>
        window.__musicLog.map((el) => ({
          src: el.src,
          assetName: el.dataset.assetName,
          loop: el.loop,
          paused: el.paused,
        }));
    },
    [playerLevel, enemyLevel, playerCount],
  );
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const music = async () => page.evaluate(() => window.__musicSnapshot());
  const advance = async (ms) => {
    await page.evaluate((amount) => window.advanceTime(amount), ms);
    const playing = (await music()).filter((el) => !el.paused);
    assert(playing.length <= 1, `${label}: music channel mixed: ${JSON.stringify(playing)}`);
  };

  while ((await state()).mode !== "start") await advance(100);
  // Startup scene construction/image decode runs on real browser tasks. Render the title once
  // before clicking; otherwise deterministic-time scenarios can hit the canvas before Pixi has
  // mounted the source title touch layer.
  await page.waitForTimeout(100);
  await advance(16.67);
  await page.waitForTimeout(100);
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox);
  const hasTitleTouch = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "sourceTitleTouchLayer") return true;
      if (node?.children) stack.push(...node.children);
    }
    return false;
  });
  assert.equal(hasTitleTouch, true, `${label}: source title touch layer was not mounted`);
  await canvas.click({ position: { x: canvasBox.width / 2, y: canvasBox.height / 2 } });
  for (let i = 0; i < 360; i++) {
    const startup = await state();
    if (startup.mode === "battle" || startup.startup?.phase === "save-select") break;
    await advance(25);
    if (i % 10 === 0) await page.waitForTimeout(2);
  }
  if ((await state()).startup?.phase === "save-select") {
    const startup = await state();
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `${label}: save slot 1 unavailable`);
    const geometry = await stageGeometry(page, canvasBox);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }
  let battleReady;
  for (let i = 0; i < 1200; i++) {
    battleReady = await state();
    if (
      battleReady.mode === "battle" &&
      battleReady.presentation.state !== "building" &&
      battleReady.turnOrderEntries.length > 0
    ) break;
    await advance(25);
    if (battleReady.presentation?.state === "building") await page.waitForTimeout(10);
  }
  assert.equal(battleReady?.mode, "battle", `${label}: battle did not enter its scene`);
  assert.notEqual(battleReady.presentation.state, "building", `${label}: battle did not finish building`);

  // Battle music starts with start(): one looping BattleN track on the channel.
  const atStart = await music();
  const battleTrackIndex = atStart.findLastIndex((track) => /Battle[1-7]\.mp3$/.test(track.assetName));
  assert(battleTrackIndex >= 0, `${label}: battle music is not a BattleN track`);
  const battleTrack = atStart[battleTrackIndex];
  assert.equal(battleTrack.loop, true, `${label}: battle music must loop`);
  assert.equal(battleTrack.paused, false, `${label}: battle music is not playing`);
  assert.equal(
    atStart.filter((track) => !track.paused).length,
    1,
    `${label}: startup music was not replaced by the battle track`,
  );

  const battleGeometry = await stageGeometry(page, canvasBox);
  // Same source-backed panel swipe as swipe-nearest/turn-timing: derive the live enemy geometry
  // so the stroke-bounds midpoint intersects the eligible monster node before nearest arbitration.
  const swipeCurrentMove = async () => {
    const current = await state();
    const target = current.monsters.find((monster) => monster.team === 1 && monster.visible);
    assert(target?.targetPoint && target.targetSize, `${label}: no live enemy target geometry`);
    const halfLane = Math.max(40, target.targetSize.w * 0.75);
    const start = battleGeometry.toCss({ x: target.targetPoint.x - halfLane, y: target.targetPoint.y });
    const end = battleGeometry.toCss({ x: target.targetPoint.x + halfLane, y: target.targetPoint.y });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 18; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 18, start.y, { steps: 1 });
    }
    await page.mouse.up();
  };

  let snapshot = await state();
  let terminalDelayStartedAt = null;
  for (let i = 0; i < 1600 && snapshot.presentation.state !== "battleEnded"; i++) {
    // A real player cannot submit the next move in the same microtask as the panel appears.
    // Let the preceding source TU action settle so this checkpoint isolates the terminal turn's
    // own notification behavior rather than completion of an older 0.5s column warp.
    if (
      snapshot.presentation.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible &&
      !snapshot.turnOrderAnimating
    ) {
      await swipeCurrentMove();
    }
    await advance(50);
    snapshot = await state();
    if (snapshot.presentation.state === "battleEndDelay" && terminalDelayStartedAt === null) {
      terminalDelayStartedAt = snapshot.presentation.elapsedMs - snapshot.presentation.stateAgeMs;
    }
  }
  assert.equal(snapshot.presentation.state, "battleEnded", `${label}: battle did not end`);
  assert.notEqual(terminalDelayStartedAt, null, `${label}: terminal delay state was never observed`);
  // Measure from the terminal state's OWN start, not from the sample that first observed it. The
  // loop steps 50ms, so `elapsedMs` at the observing sample quantizes the hold UP to the next
  // sample boundary and the reading depends on where the gate's start happened to fall in that
  // grid: the same 2516.67ms hold reads as 2549.99 in one fixture and 2550.00 in the next, and the
  // window below then passes or fails on a 4e-11 margin. Both endpoints are exact here.
  const terminalDelayElapsed =
    snapshot.presentation.elapsedMs - snapshot.presentation.stateAgeMs - terminalDelayStartedAt;


  const expectedTerminalHoldMs = expectedPopup === "returnToTown" ? 1_500 : 2_500;


  const dispatchFrameMs = 1000 / 60;
  const floatEpsilonMs = 0.01;
  assert(
    terminalDelayElapsed >= expectedTerminalHoldMs - floatEpsilonMs &&
      terminalDelayElapsed < expectedTerminalHoldMs + dispatchFrameMs + floatEpsilonMs,
    `${label}: terminal hold was ${terminalDelayElapsed}ms instead of source ${expectedTerminalHoldMs}ms ` +
      `plus its single dispatch frame`,
  );
  const terminalTurnStart = snapshot.turnOrderAtTurnStart;
  assert(terminalTurnStart, `${label}: no pre-turn TU state was observed`);
  const terminalIds = new Set(snapshot.turnOrderEntries.map((entry) => entry.id));
  assert.deepEqual(
    snapshot.displayedQueue,
    terminalTurnStart.displayedQueue.filter((id) => terminalIds.has(id)),
    `${label}: terminal turn sampled the post-advance queue instead of only removing defeated entries`,
  );
  assert.deepEqual(
    Object.fromEntries(snapshot.turnOrderEntries.map((entry) => [entry.id, entry.delayText])),
    Object.fromEntries(
      terminalTurnStart.displayedQueue
        .filter((id) => terminalIds.has(id))
        .map((id) => [id, terminalTurnStart.delayText[id]]),
    ),
    `${label}: terminal turn changed a surviving TU label`,
  );
  for (let i = 0; i < 200 && snapshot.activePopup !== expectedPopup; i++) {
    await advance(50);
    snapshot = await state();
  }
  assert.equal(snapshot.activePopup, expectedPopup, `${label}: real post-battle popup did not open`);
  if (expectedPopup === "xpAward") {
    assert(snapshot.postBattle, "win: missing XP display state");
    assert.equal(snapshot.postBattle.entries.length, playerCount, "win: wrong participating-monster count");
    assert(snapshot.postBattle.amount > 0, "win: XP award was not positive");
    // Closure check on the packed grid (postBattleDisplay's XpAwardDisplayState.grid): the columns
    // must fill the grid's own contentSize exactly, since `-[Scale9Popup newConfiguration:]` cuts
    // the card from that box. A negative-direction Box packs unequal children correctly only if
    // each child ENDS at the running offset, and `playerCount: 1` is the case that makes them
    // unequal (`sub_65ae0` returns `[[entry], []]`, the empty column measuring one Box.gap).
    const grid = snapshot.postBattle.grid;
    assert(grid, `${label}: XP display state is missing its grid geometry`);
    assert.equal(grid.inkStart, 0, `${label}: XP columns start outside the card: ${JSON.stringify(grid)}`);
    assert.equal(grid.inkEnd, grid.width, `${label}: XP columns overhang the card: ${JSON.stringify(grid)}`);
    if (expectedAward !== null) {
      assert.equal(snapshot.postBattle.amount, expectedAward, `${label}: wrong XP award`);
    }
    if (expectedPartyLevel !== null) {
      assert(
        snapshot.postBattleParty?.bench?.length === playerCount,
        `${label}: post-battle party is incomplete: ${JSON.stringify(snapshot.postBattleParty)}`,
      );
      assert(
        snapshot.postBattleParty.bench.every((member) => member.level === expectedPartyLevel),
        `${label}: XP advanced a party member past level ${expectedPartyLevel}: ${JSON.stringify(snapshot.postBattleParty)}`,
      );
    }
    assert.equal(snapshot.postBattle.targetStarted, false, "win: bars started before source DelayTime 0.5");
    const remainingDelay = 500 - snapshot.postBattle.elapsedMs;
    assert(remainingDelay > 0, "win: XP popup became observable after its bar delay elapsed");
    await advance(Math.max(1, remainingDelay - 10));
    snapshot = await state();
    assert.equal(snapshot.postBattle.targetStarted, false, "win: bars started inside source DelayTime 0.5");
    await advance(20);
    snapshot = await state();
    assert.equal(snapshot.postBattle.targetStarted, true, "win: bars did not start after source DelayTime 0.5");
  } else {
    assert.equal(snapshot.postBattle, null, "loss: return-to-town popup must not expose XP state");
  }
  await page.screenshot({ path: path.join(outputDir, `${label}-end.png`), timeout: 120_000 });

  const finalMusic = await music();
  const [actionButton] = snapshot.postBattleButtons;
  assert(actionButton, `${label}: post-battle popup did not expose its action button`);

  assert.equal(actionButton.label, expectedButton, `${label}: wrong post-battle button label`);
  const geometry = await stageGeometry(page, canvasBox);
  const buttonCss = geometry.toCss(actionButton.point);
  await page.mouse.click(buttonCss.x, buttonCss.y);

  if (expectLevelUpPages) {
    // beginWaitingForText: the pre-queued pages reveal on the shared status box (flow doc §1.2/§4).
    await advance(50);
    snapshot = await state();
    assert(snapshot.statusText.visible, `${label}: level-up pages did not open after Close`);
    assert(snapshot.statusTextPages.length > 0, `${label}: no queued level-up pages`);
    assert.equal(
      snapshot.statusTextPages[0],
      "Monsters Have Leveled Up!",
      `${label}: first page is not the MonsterLevelUpKey header`,
    );
    assert.match(
      snapshot.statusTextPages[1],
      /is now level \d+!$/,
      `${label}: second page is not a LevelUpTextKey page`,
    );
    assert(
      snapshot.statusTextPages.some((p) => /^\+\d+ /.test(p)),
      `${label}: no stat-bonus page in the queue`,
    );
    // Web-native Enter uses the same statusTextAdvance seam as the source screen-wide tap.
    let taps = 0;
    while ((await state()).statusTextPages.length > 0) {
      assert(taps++ < 200, `${label}: level-up page queue did not drain`);
      await page.keyboard.press("Enter");
      await advance(50);
    }
  }

  if (expectedEvolutions) {
    // The beginEvolve loop mutates the bench in place (buildEvolvedVersion swap); each iteration
    // is 5s of ticker time (1s shake -> performEvolution -> 4s -> endEvolve).
    for (let i = 0; ; i++) {
      snapshot = await state();
      const bench = snapshot.postBattleParty?.bench ?? [];
      if (expectedEvolutions.every((to) => bench.some((m) => m.shortType === to))) break;
      assert(i < 1200, `${label}: evolutions incomplete: ${JSON.stringify(bench)}`);
      await advance(100);
    }
    assert(
      (await music()).some((el) => /Evolve1\.mp3$/.test(el.assetName)),
      `${label}: Evolve1.mp3 never played during the evolution chain`,
    );


    for (let i = 0; i < 25; i++) {
      await advance(100);
      await page.waitForTimeout(20);
    }
    await page.screenshot({ path: path.join(outputDir, `${label}-evolve.png`), timeout: 120_000 });
  }

  for (let i = 0; i < 1500 && (await state()).presentation.state === "battleEnded"; i++) await advance(50);
  snapshot = await state();
  assert.notEqual(snapshot.presentation.state, "battleEnded", `${label}: post-battle flow did not continue the demo`);
  assert.equal(snapshot.activePopup, null, `${label}: post-battle popup stayed modal`);
  assert.equal(errors.length, 0, `${label}:\n${errors.join("\n")}`);
  await page.close();
  // Ignore the earlier title/startup music elements; callers assert the battle-owned channel
  // segment (BattleN plus an optional Win1) exactly as this scenario did before source startup.
  return finalMusic.slice(battleTrackIndex);
}

try {
  if (process.env.DIB_BATTLE_END_CASE === "loss") {
    const loss = await runBattle({
      playerLevel: 1,
      enemyLevel: 50,
      label: "loss",
      expectedPopup: "returnToTown",
    });
    assert.equal(loss.length, 1, "loss: defeat must not start any new music");
    assert.match(loss[0].assetName, /Battle[1-7]\.mp3$/);
    assert.equal(loss[0].loop, true);
    assert.equal(loss[0].paused, false, "loss: battle loop must keep playing under the defeat popup");
    console.log("battle-end-audio: PASS (loss keeps battle loop and freezes terminal TU state)");
  } else if (process.env.DIB_XP_SINGLE_ONLY === "1") {
    // A brand-new save's first battle: ONE party monster. `sub_65ae0` still returns `columns`
    // arrays, so the grid packs the monster's ~218pt column against an EMPTY column worth one
    // Box.gap — the first unequal-size negative-direction pack in the port, and the case that
    // exposed `packBox` emitting each child's FAR edge as its position (monster + XP bar rendered
    // off the right of the card and off screen). The shared xpAward block asserts the closure.
    await runBattle({
      // Level 12 vs 1: a tiny award, so the Close button takes the no-level-up, no-evolution
      // branch (level 12 is below FireCub's evolve threshold — cf. the XP regression case).
      playerLevel: 12,
      enemyLevel: 1,
      label: "xp-single-participant",
      expectedPopup: "xpAward",
      playerCount: 1,
      expectedButton: "Close",
    });
    console.log("battle-end-audio: PASS (single-participant XP card packs inside its own contentSize)");
  } else if (process.env.DIB_XP_REGRESSION_ONLY === "1") {
    // Regression for the reported level-12 -> level-112 blowup. The real ARM curve gives
    // xpAwardForLevel(12, 2.5, 12)=3412; three participants receive ceil(3412/3)=1138 each,
    // which leaves cumulative XP below level 13's threshold.
    await runBattle({
      playerLevel: 12,
      enemyLevel: 12,
      label: "xp-level12-regression",
      expectedPopup: "xpAward",
      playerCount: 3,
      expectedButton: "Close",
      expectedAward: 1138,
      expectedPartyLevel: 12,
    });
    console.log("battle-end-audio: PASS (level-12 XP regression: 1,138 XP, party remains level 12)");
  } else {


  const win = await runBattle({
    playerLevel: 50,
    enemyLevel: 1,
    label: "win",
    expectedPopup: "xpAward",
    playerCount: 3,
    expectedButton: "Close",
    expectedEvolutions: ["FireTiger", "SnowPanther", "WhiteDragon"],
  });
  assert.equal(win.length, 2, "win: expected battle track + win jingle on the channel");
  assert.match(win[0].assetName, /Battle[1-7]\.mp3$/);
  assert.equal(win[0].paused, true, "win: battle loop kept playing under the win jingle");
  assert.match(win[1].assetName, /Win1\.mp3$/, "win: jingle is not Win1");
  assert.equal(win[1].loop, false, "win: Win1 must not loop (source loop:NO)");

  // WIN + LEVEL-UPS: one level-7 Spark awards monsterXpAward(7,2.5,3)=920 total, ceil(920/3)=307
  // per level-3 participant — exactly one level each (cumulative 220+307=527; level-4 threshold
  // 512, level-5 threshold 945; emulation-verified curve, xp-emulation.md) — so Close runs
  // beginWaitingForText: header + 3x(LevelUpTextKey + stat page), and with everyone at level 4
  // << levelReq 28 the evolve scan finds nothing and the demo restarts. 3v1 keeps the +4-level
  // enemy beatable.
  await runBattle({
    playerLevel: 3,
    enemyLevel: 7,
    label: "win-levelup",
    expectedPopup: "xpAward",
    playerCount: 3,
    expectedButton: "Close",
    expectLevelUpPages: true,
  });

  // LOSS: performLooseLogic makes no audio calls — the battle loop keeps running, nothing else.
  const loss = await runBattle({ playerLevel: 1, enemyLevel: 50, label: "loss", expectedPopup: "returnToTown" });
  assert.equal(loss.length, 1, "loss: defeat must not start any new music");
  assert.match(loss[0].assetName, /Battle[1-7]\.mp3$/);
  assert.equal(loss[0].loop, true);
  assert.equal(loss[0].paused, false, "loss: battle loop must keep playing under the defeat popup");

  fs.writeFileSync(
    path.join(outputDir, "state.json"),
    JSON.stringify({ win, loss }, null, 2) + "\n",
  );
  console.log(
    "battle-end-audio: PASS (win jingle + 3-monster evolution chain; level-up page walk; loss keeps loop; never mixed)",
  );
  }
} finally {
  await browser.close();
}
