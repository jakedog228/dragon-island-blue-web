


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/sleep-status");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
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
    // Divine.Fairy (shortType "Fairy") carries Hypnosis at usable2 (status-effects.md §0). A
    // single weak enemy keeps the scenario deterministic: Fairy's own Speed/stats aren't tuned
    // against SnowCub specifically, so whichever monster wins the first speed tie just means a
    // few enemy turns resolve automatically before Fairy's own choose phase opens -- the loop
    // below tolerates that by polling for the actor id, not assuming turn 1.
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

  for (let i = 0; i < 300 && (await state()).mode !== "start"; i++) {
    await page.waitForTimeout(100);
  }
  assert.equal((await state()).mode, "start", `boot stalled: ${errors.join(" | ")}`);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  console.log("sleep-status: booted");

  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  let ready;
  for (let i = 0; i < 2000; i++) {
    ready = await state();
    if (
      ready.mode === "battle" &&
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.panelVisible &&
      ready.activeActorId === "t0m0:Fairy" &&
      ready.abilityButtons?.some((button) => button.abilityPath === "Offensive.Sleep.Sleep")
    ) {
      break;
    }
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal(ready.activeActorId, "t0m0:Fairy", `Fairy's choose phase never opened: ${JSON.stringify(ready.presentation)}`);
  console.log("sleep-status: Fairy's turn, panel visible");

  const hypnosis = ready.abilityButtons.find((b) => b.abilityPath === "Offensive.Sleep.Sleep");
  assert(hypnosis, `Hypnosis ability card not found among: ${JSON.stringify(ready.abilityButtons)}`);

  const { toCss } = await stageGeometry(page, canvasBox);
  const abilityClick = toCss(hypnosis.center);
  await page.mouse.click(abilityClick.x, abilityClick.y);
  console.log("sleep-status: Hypnosis card clicked");

  let picking;
  for (let i = 0; i < 200; i++) {
    picking = await state();
    if (picking.presentation?.state === "targetPicking") break;
    await advance(25);
    await page.waitForTimeout(1);
  }
  assert.equal(picking.presentation.state, "targetPicking", "Hypnosis did not open the target picker");

  const target = picking.monsters.find((m) => m.team === 1 && m.id === "t1m0:SnowCub");
  assert(target, `enemy target not found: ${JSON.stringify(picking.monsters)}`);
  const targetClick = toCss(target.targetPoint);
  await page.mouse.click(targetClick.x, targetClick.y);
  console.log("sleep-status: enemy target picked");

  // (1) The one-shot cast-flash: AnimationEffectBuilder("Sleep") spawned via the new buffAdded
  // dispatch in abilityRenderer.ts's renderResult (status-effects.md §0 point 1).
  let sawCastFlash = false;
  for (let i = 0; i < 200; i++) {
    const current = await state();
    if (current.activeEffectNodes.some((node) => node.label === "animation:Sleep")) {
      sawCastFlash = true;
      break;
    }
    await advance(25);
    await page.waitForTimeout(1);
  }
  assert(sawCastFlash, "Sleep cast-flash animation (animation:Sleep) never appeared");
  console.log("sleep-status: cast-flash animation observed");

  // (2) The persistent Zzz overlay: 0->1 transition-counted show (status-effects.md §1/§2),
  // exposed via renderGameState's new per-monster `statusOverlays.Sleep` debug field.
  let overlaid;
  for (let i = 0; i < 400; i++) {
    overlaid = await state();
    const snowCub = overlaid.monsters.find((m) => m.id === "t1m0:SnowCub");
    if (snowCub?.statusOverlays?.Sleep === true) break;
    await advance(25);
    await page.waitForTimeout(1);
  }
  const snowCubAfter = overlaid.monsters.find((m) => m.id === "t1m0:SnowCub");
  assert(snowCubAfter, "SnowCub missing from state after Hypnosis");
  assert.equal(snowCubAfter.statusOverlays.Sleep, true, "persistent Sleep overlay never mounted on SnowCub");
  assert(
    snowCubAfter.activeBuffs.some((buff) => Array.isArray(buff.statusEffects) && buff.statusEffects.includes("Sleep")),
    `engine-side Sleep buff missing from activeBuffs: ${JSON.stringify(snowCubAfter.activeBuffs)}`,
  );
  console.log("sleep-status: persistent Sleep overlay mounted (statusOverlays.Sleep === true)");

  // Give the periodic spawner at least one full 0.8s cadence so a "Z" sprite is visibly
  // mid-drift (not just freshly spawned at full scale/alpha) before the screenshot.
  await advance(900);

  assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors)}`);
  await page.screenshot({ path: path.join(outputDir, "sleep-overlay.png"), timeout: 60_000 });

  // (3) Disabled fronts auto-queue Utility.LooseTurn and skip state 2 / startQueuedAbility
  // (battle.md §1, Battle.txt:671-679) — no enemy ability-activation pulse. LooseTurn has no
  // target phase, so `activeAbilityPath` can begin and finish within one browser microtask; prove
  // the durable source condition instead: SnowCub is still sleeping when its turn begins, its turn
  // completes, and its cumulative activation-pulse count never changes.
  const snowCubId = "t1m0:SnowCub";
  const pulsesBeforeSleepTurns = (await state()).enemyAbilityPulseStartsById?.[snowCubId] ?? 0;
  let sawSleepingTurn = false;
  let sleepingTurnCompleted = false;
  // Budget note: the forced LooseTurn's source-phase statusTextLocalizationKey line ("Snow Cub
  // loses its turn") holds the NEXT turn for its 5s waitLimit auto-advance (loop()'s state-1
  // gate), so completing the sleeping turn needs ~5s of sim time beyond reaching it.
  for (let i = 0; i < 3000; i++) {
    const current = await state();
    if (current.activeActorId === snowCubId) {
      const snowCub = current.monsters.find((monster) => monster.id === snowCubId);
      sawSleepingTurn ||= Boolean(
        snowCub?.activeBuffs?.some(
          (buff) => Array.isArray(buff.statusEffects) && buff.statusEffects.includes("Sleep"),
        ),
      );
    } else if (sawSleepingTurn) {
      sleepingTurnCompleted = true;
      break;
    }
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert(sawSleepingTurn, "SnowCub never reached a turn while its Sleep buff was active");
  assert(sleepingTurnCompleted, "sleeping SnowCub's forced lost turn never completed");
  const pulsesAfter = (await state()).enemyAbilityPulseStartsById?.[snowCubId] ?? 0;
  assert.equal(
    pulsesAfter,
    pulsesBeforeSleepTurns,
    "status-skipped LooseTurn must not run EnemyMonsterDisplay notifyActivatedAbility pulse",
  );
  console.log("sleep-status: sleeping enemy LooseTurn had no activation motion");

  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(await state(), null, 2) + "\n");
  console.log("sleep-status: PASS (cast-flash + persistent Zzz overlay + no skip-turn motion, no console/page errors)");
} finally {
  await browser.close();
}
