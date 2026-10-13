


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/analyze-turn-continuation");
const FRAME_MS = 1000 / 60;





const BATTLE_SEED = 3;
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
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ configured, seed }) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_BATTLE_SEED__ = seed;
    window.__DIB_TEST_ENCOUNTER__ = configured;
  }, { configured: encounter, seed: BATTLE_SEED });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  for (let i = 0; i < 600 && (await state()).mode !== "start"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "battle canvas missing");
  await advance(16.67);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  let startup = await state();
  for (let i = 0; i < 1200 && startup.mode !== "battle" && startup.startup?.phase !== "save-select"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
    startup = await state();
  }
  if (startup.startup?.phase === "save-select") {
    await advance(250);
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, "slot-1 unavailable");
    const geometry = await stageGeometry(page, canvasBox);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }
  for (let i = 0; i < 1200 && (await state()).mode !== "battle"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal((await state()).mode, "battle", "battle did not finish building");
  return { page, state, advance, errors, geometry: await stageGeometry(page, canvasBox) };
}

async function waitFor(ctx, predicate, description, limit = 1200) {
  let snapshot;
  for (let i = 0; i < limit; i++) {
    snapshot = await ctx.state();
    if (snapshot.presentation?.state !== "building" && predicate(snapshot)) return snapshot;
    await ctx.advance(25);
    if (i % 20 === 0) await ctx.page.waitForTimeout(1);
  }
  assert.fail(`${description}: ${JSON.stringify(snapshot)}`);
}

async function settleWithoutAdvancingTime(ctx, predicate, description) {
  let snapshot;
  for (let i = 0; i < 100; i++) {
    snapshot = await ctx.state();
    if (predicate(snapshot)) return snapshot;
    // Yield only real task time. A call to advanceTime here would hide the delay under test.
    await ctx.page.waitForTimeout(1);
  }
  assert.fail(`${description}: ${JSON.stringify(snapshot)}`);
}

async function runCase(name, encounter, expected) {
  const ctx = await openBattle(encounter);
  try {
    const ready = await waitFor(
      ctx,
      (snapshot) =>
        snapshot.presentation.state === "awaitingPlayerChoice" &&
        snapshot.panelVisible === true &&
        snapshot.activeActorId === "t0m0:Penguin" &&
        snapshot.abilityButtons.some((button) => button.abilityPath === "Utility.Analyze"),
      `${name}: Penguin never received Analyze`,
    );
    // Dynamic panel children become pointer-ready on the next source sample.
    await ctx.advance(25);
    const current = await ctx.state();
    const analyze = current.abilityButtons.find((button) => button.abilityPath === "Utility.Analyze");
    assert(analyze, `${name}: Analyze card disappeared`);
    const analyzePoint = ctx.geometry.toCss(analyze.center);
    await ctx.page.mouse.click(analyzePoint.x, analyzePoint.y);

    const status = await settleWithoutAdvancingTime(
      ctx,
      (snapshot) =>
        snapshot.presentation.state === "turnComplete" &&
        snapshot.statusText?.visible === true &&
        snapshot.statusText.text === "Analyze Successful",
      `${name}: Analyze did not reach its state-1 finish page without a target-phase delay`,
    );
    assert.equal(status.activeAbilityPath, "Utility.Analyze");
    assert.equal(status.queue[0], expected.actorId, `${name}: fixture no longer admits the expected next actor`);

    const acknowledgedAt = status.presentation.elapsedMs;
    // ChainedTextLabel claims every screen point while visible. Pointer-down must hold state 1;
    // pointer-up runs the finish route. The deterministic ticker is stopped, and the poll below
    // never calls advanceTime, so elapsedPresentationMs can change only if the port adds a gate.
    const finishPoint = ctx.geometry.toCss({
      x: ctx.geometry.screenPt.w / 2,
      y: ctx.geometry.screenPt.h / 2,
    });
    await ctx.page.mouse.move(finishPoint.x, finishPoint.y);
    await ctx.page.mouse.down();
    const held = await ctx.state();
    assert.equal(held.presentation.elapsedMs, acknowledgedAt, `${name}: pointer-down advanced source time`);
    assert.equal(held.presentation.state, "turnComplete", `${name}: pointer-down released state 1`);
    await ctx.page.mouse.up();
    const callbackState = await settleWithoutAdvancingTime(
      ctx,
      (snapshot) => snapshot.activeActorId === expected.actorId && snapshot.statusText?.visible === false,
      `${name}: finish-arrow release did not synchronously advance the queue`,
    );
    assert.equal(
      callbackState.presentation.elapsedMs,
      acknowledgedAt,
      `${name}: statusTextAdvance advanced the source clock inside its callback`,
    );
    // Native state/front mutation above is synchronous, but MonsterTurnPanel construction and
    // automatic state work belong to BattleNode.update:. Sample one normal update/render boundary;
    // a regressed 1.0/2.25-second timeDelay would still be stuck in turnLeadIn here.
    await ctx.advance(FRAME_MS);
    const continued = await settleWithoutAdvancingTime(
      ctx,
      (snapshot) => {
        if (snapshot.activeActorId !== expected.actorId) return false;
        return expected.kind === "friendly"
          ? snapshot.presentation.state === "awaitingPlayerChoice" &&
            snapshot.panelVisible === true &&
            snapshot.statusText?.visible === false
          : snapshot.presentation.state === "phaseDelay" &&
            typeof snapshot.activeAbilityPath === "string" &&
            snapshot.statusText?.visible === false;
      },
      `${name}: ${expected.kind} successor was not visible by the next render update`,
    );
    const activationUpdateMs = continued.presentation.elapsedMs - acknowledgedAt;
    assert(
      Math.abs(activationUpdateMs - FRAME_MS) < 0.01,
      `${name}: successor required ${activationUpdateMs}ms instead of one ${FRAME_MS}ms render update`,
    );
    assert.equal(continued.activeActorId, expected.actorId);
    assert.notEqual(continued.presentation.state, "turnLeadIn");
    assert.deepEqual(ctx.errors, [], ctx.errors.join("\n"));
    await ctx.page.screenshot({ path: path.join(outputDir, `${name}.png`), timeout: 120_000 });
    return {
      case: name,
      actorId: continued.activeActorId,
      boundary: continued.presentation.state,
      fixedLeadInMs: callbackState.presentation.elapsedMs - acknowledgedAt,
      activationUpdateMs,
    };
  } finally {
    await ctx.page.close();
  }
}

try {
  const friendly = await runCase(
    "friendly-next",
    {
      backgroundKey: "ForestCombat",
      playerTeam: [
        { shortType: "Penguin", level: 100 },
        { shortType: "FireCub", level: 1 },
        { shortType: "SnowCub", level: 1 },
      ],
      enemyTeam: [{ shortType: "Minotaur", level: 1 }],
    },
    {
      actorId: "t0m2:SnowCub",
      kind: "friendly",
    },
  );
  const enemy = await runCase(
    "enemy-next",
    {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "Penguin", level: 100 }],
      enemyTeam: [{ shortType: "Minotaur", level: 1 }],
    },
    {
      actorId: "t1m0:Minotaur",
      kind: "enemy",
    },
  );
  console.log(`analyze-turn-continuation: PASS ${JSON.stringify({ friendly, enemy })}`);
} finally {
  await browser.close();
}
