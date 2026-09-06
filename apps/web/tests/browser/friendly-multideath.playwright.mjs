// Browser contract for one all-target impact removing three active allies and synchronously
// filling every slot from the reserve list. Native FriendlyTeamDisplay keeps each dead card's
// independent 1s spin/shrink while each newly added card appears directly at its final slot (no
// borrowed enemy entrance). TurnOrderDisplay adds the three reserve portraits at origin and
// carries them into the queue over its ordinary 0.5s warp.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/friendly-multideath");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [
        { shortType: "FireCub", level: 1 },
        { shortType: "SnowCub", level: 1 },
        { shortType: "WhiteDragonling", level: 1 },
        // Keep the promoted trio alive long enough for their independent turn-order warps to
        // complete even if the zero-delay enemy begins another decision while death settles.
        { shortType: "Penguin", level: 100 },
        { shortType: "Fairy", level: 100 },
        { shortType: "Kingpen", level: 100 },
      ],
      // Unhappy Bird's only AI-selectable move is the all-enemy, sacrificeChance=1 Detonate
      // path. Keep a second enemy alive so that sacrifice is nonterminal: terminal turns
      // source-correctly suppress the later post-advance turn-order refresh this test exercises.
      enemyTeam: [
        { shortType: "UnhappyBird", level: 100 },
        { shortType: "Minotaur", level: 1 },
      ],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  while ((await state()).mode !== "start") await advance(100);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let i = 0; i < 600; i++) {
    const candidate = await state();
    if (candidate.mode === "battle" && Array.isArray(candidate.monsters)) break;
    await advance(50);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }

  let snapshot = await state();
  assert.equal(snapshot.mode, "battle", `battle scene did not become ready: ${JSON.stringify(snapshot)}`);
  assert(Array.isArray(snapshot.monsters), "battle monster state must be available before the contract begins");
  const initialFriendlyIds = snapshot.monsters.filter((monster) => monster.team === 0).map((monster) => monster.id);
  const reserveIds = ["t0m3:Penguin", "t0m4:Fairy", "t0m5:Kingpen"];
  assert.equal(initialFriendlyIds.length, 3);
  assert.equal(snapshot.friendlyBenchCount, 3);
  let overlap = null;
  const promotedTuEntriesSeen = new Set();
  let sawPromotedTuWarp = false;
  for (let i = 0; i < 600 && (!overlap || promotedTuEntriesSeen.size < reserveIds.length); i++) {
    await advance(25);
    // Texture-backed turn-order additions settle through native promises, so yield between
    // deterministic ticker steps instead of starving their rebuild work.
    await page.waitForTimeout(5);
    snapshot = await state();
    for (const entry of snapshot.turnOrderEntries.filter((candidate) => reserveIds.includes(candidate.id))) {
      promotedTuEntriesSeen.add(entry.id);
      if (snapshot.turnOrderAnimating) sawPromotedTuWarp = true;
    }
    const liveReserveCards = snapshot.friendlyMemberPositions.filter(
      (entry) => reserveIds.includes(entry.id) && !entry.dying,
    );
    const dyingActives = snapshot.friendlyMemberPositions.filter(
      (entry) => initialFriendlyIds.includes(entry.id) && entry.dying,
    );
    if (!overlap && liveReserveCards.length === 3 && dyingActives.length === 3) {
      overlap = snapshot;
      assert.deepEqual(liveReserveCards.map((entry) => entry.id), reserveIds, "reserve order must be stable");
      assert.equal(snapshot.friendlyBenchCount, 0);
      // Source `notifyTeam:addedMonster:` gives new cards their final positions immediately.
      const layoutById = new Map(snapshot.friendlyCardLayouts.map((entry) => [entry.id, entry.nodePosition]));
      for (const card of liveReserveCards) {
        assert.deepEqual({ x: card.x, y: card.y }, layoutById.get(card.id), `${card.id} must snap to its slot`);
      }
      await advance(0); // render the async-built cards before the visual checkpoint
      await page.screenshot({ path: path.join(outputDir, "death-promotion-overlap.png"), timeout: 120_000 });
    }
  }

  assert(overlap, "never observed all three dying cards alongside all three source-snapped reserves");
  assert.deepEqual(
    [...promotedTuEntriesSeen].sort(),
    [...reserveIds].sort(),
    "each promoted reserve must enter the live turn-order display",
  );
  assert(sawPromotedTuWarp, "promoted turn-order entries must participate in the source warp animation");
  for (let i = 0; i < 240 && snapshot.turnOrderAnimating; i++) {
    await advance(25);
    snapshot = await state();
  }
  for (const id of reserveIds) {
    assert(snapshot.queue.includes(id), `${id} must enter the authoritative queue`);
    assert(snapshot.displayedQueue.includes(id), `${id} must enter the displayed TU queue`);
    const entry = snapshot.turnOrderEntries.find((candidate) => candidate.id === id);
    assert(entry && (entry.x !== 0 || entry.y !== 0), `${id} TU portrait must settle away from origin`);
  }
  assert.equal(initialFriendlyIds.filter((id) => snapshot.queue.includes(id)).length, 0);
  assert.equal(errors.length, 0, errors.join("\n"));
  await page.screenshot({ path: path.join(outputDir, "promotions-tu-settled.png"), timeout: 120_000 });
  console.log("friendly-multideath: PASS (three source-snapped reserves and three warped TU portraits)");
} finally {
  await browser.close();
}
