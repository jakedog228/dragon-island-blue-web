


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/enemy-entrance");
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

  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    // This scenario counts never-captured enemies. Pin the collection seam explicitly.
    window.__DIB_TEST_ALL_UNLOCKED__ = false;
    // Entries 4-6 are ordered reserves (engine actives are the first 3), so a death promotes.
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [
        { shortType: "FireCub", level: 12 },
        { shortType: "SnowCub", level: 12 },
        { shortType: "WhiteDragonling", level: 12 },
      ],
      enemyTeam: [
        { shortType: "Minotaur", level: 12 },
        { shortType: "Spark", level: 12 },
        { shortType: "UnhappyBird", level: 12 },
        { shortType: "FireCub", level: 12 },
        { shortType: "SnowCub", level: 12 },
        { shortType: "WhiteDragonling", level: 12 },
      ],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  while ((await state()).mode !== "start") await advance(100);
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  const { toCss } = await stageGeometry(page, canvasBox);
  // Let the start screen's deterministic entrance and input registration settle before pressing
  // it; clicking in the first `mode:start` frame can race the async listener install.
  for (let i = 0; i < 300; i++) {
    await advance(1000 / 60);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  // Scene building needs ticker frames (same as every sibling scenario); poll in 25ms bites so
  // that when the entrance's start positions appear we are still far inside the first member's
  // 500ms stagger window.
  for (let i = 0; i < 1200 && (await state()).enemyMemberPositions?.length !== 3; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }

  // --- 1. Initial entrance ------------------------------------------------------------------
  const t0 = await state();
  assert(
    Array.isArray(t0.enemyMemberPositions),
    `battle scene did not build: ${JSON.stringify({ mode: t0.mode, presentation: t0.presentation, activePopup: t0.activePopup })}`,
  );
  assert.equal(t0.enemyMemberPositions.length, 3, "3 active enemies (entries 4-6 are benched)");
  assert.equal(t0.enemyBenchCountShown, 3, "bench badge must show all 3 reserves");
  // EnemyMonsterDisplay.contentSize is fixed at 128pt even when a field sprite overflows it.
  // Packing and absolute centers depend only on slot index/count, never on these monsters'
  // different texture bounds or renderer scales.
  assert.deepEqual(
    t0.enemyMemberPositions.map((m) => m.x),
    [0, 128, 256],
    "three enemy displays must occupy fixed 128pt local slots",
  );
  // calculateMembersBoxPosition uses 70/160 native idiom offsets. In the port's normalized
  // iPad space that is 80pt, not the phone's 70pt.
  const membersBoxOffsetX = t0.screenPt.w === 512 ? 80 : 70;
  const membersBoxX = membersBoxOffsetX + 0.5 * (t0.screenPt.w - 3 * 128 - membersBoxOffsetX);
  assert.deepEqual(
    t0.enemyMemberPositions.map((m) => m.fieldCenterX),
    [0, 128, 256].map((slotX) => membersBoxX + slotX + 64),
    "three enemy field centers must be the source-fixed winSize-relative points",
  );
  // Drop distance = winH − membersBoxYCocos (winSize-relative in both display modes):
  // iPhone 320 → 125pt, iPad-mode 384 → 157pt.
  const winH = t0.screenPt.h;
  const drop = winH - (90 + 0.5 * (winH - 20 - 90));
  const restY = new Map();
  // All three start exactly `drop` points (Pixi -y) above their rest line before any stagger
  // delay elapses.
  for (const m of t0.enemyMemberPositions) {
    assert(m.parented, `${m.id} must be parented at build`);
    restY.set(m.id, m.y + drop);
    assert.equal(Math.round(m.y), m.y, `${m.id} start y must be roundf'd`);
  }
  await page.screenshot({ path: path.join(outputDir, "entrance-start.png"), timeout: 120_000 });

  const byId = (snap, id) => snap.enemyMemberPositions.find((m) => m.id === id);
  const ids = t0.enemyMemberPositions.map((m) => m.id);
  // The state poll above can observe the first fully-built frame partway through the shared 500ms
  // base delay. Measure movement onsets from that observable frame and pin the source 250ms
  // stagger directly instead of assuming the polling loop caught delay age zero.
  const onsetMs = new Map();
  let staggered = null;
  for (let elapsed = 25; elapsed <= 1500 && onsetMs.size < ids.length; elapsed += 25) {
    await advance(25);
    const snap = await state();
    for (const id of ids) {
      if (!onsetMs.has(id) && byId(snap, id).y > byId(t0, id).y + 0.01) onsetMs.set(id, elapsed);
    }
    if (onsetMs.has(ids[0]) && !onsetMs.has(ids[1]) && staggered === null) staggered = snap;
  }
  assert.equal(onsetMs.size, 3, `not every enemy started its entrance: ${JSON.stringify([...onsetMs])}`);
  assert(staggered, "member 0 never moved while members 1 and 2 were still waiting");
  assert.equal(byId(staggered, ids[1]).y, byId(t0, ids[1]).y, "member 1 must wait through member 0's first motion");
  assert.equal(byId(staggered, ids[2]).y, byId(t0, ids[2]).y, "member 2 must wait through member 0's first motion");
  for (let i = 1; i < ids.length; i++) {
    const delta = onsetMs.get(ids[i]) - onsetMs.get(ids[i - 1]);
    assert(
      Math.abs(delta - 250) <= 25,
      `entrance onset ${i - 1}->${i} must stagger by 250ms (got ${delta}ms)`,
    );
  }
  await page.screenshot({ path: path.join(outputDir, "entrance-stagger.png"), timeout: 120_000 });

  // Once the final member begins, one full 1.0s move plus a frame margin settles every member.
  await advance(1100);
  const settled = await state();
  for (const m of settled.enemyMemberPositions) {
    assert(Math.abs(m.y - restY.get(m.id)) < 0.5, `${m.id} settled y ${m.y} != rest ${restY.get(m.id)}`);
  }
  await page.screenshot({ path: path.join(outputDir, "entrance-settled.png"), timeout: 120_000 });

  // --- 2. Capture cards: layering + idle shake ----------------------------------------------
  for (let i = 0; i < 600 && (await state()).presentation.state !== "awaitingPlayerChoice"; i++) {
    await advance(50);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  assert.equal((await state()).presentation.state, "awaitingPlayerChoice");
  const readCards = () =>
    page.evaluate(() => {
      const cards = [];
      const visit = (node) => {
        if (node.label === "captureCard") {
          const siblings = node.parent?.children ?? [];
          const nameLabel = siblings.find((s) => typeof s.text === "string" && s.zIndex === 2);
          const art = (node.children ?? []).find((c) => c.label === "captureCardArt");
          const glow = (node.children ?? []).find((c) => c.label === "captureCardGlow");
          const newLabel = (node.children ?? []).find((c) => c.label === "captureCardNewLabel");
          cards.push({
            enemyName: nameLabel?.text ?? null,
            x: node.position.x,
            y: node.position.y,
            zIndex: node.zIndex,
            cardSorts: node.sortableChildren,
            parentSorts: node.parent?.sortableChildren ?? false,
            nameAboveCard: !!nameLabel && nameLabel.zIndex > node.zIndex,
            art: art ? { zIndex: art.zIndex, scale: art.scale.x } : null,
            glow: glow ? { zIndex: glow.zIndex, alpha: glow.alpha, scale: glow.scale.x } : null,
            newLabel: newLabel ? { text: newLabel.text, scale: newLabel.scale.x, alpha: newLabel.alpha } : null,
          });
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return cards;
    });
  let cards = [];
  for (let i = 0; i < 600 && cards.length !== 3; i++) {
    cards = await readCards();
    if (cards.length === 3) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  const captureRest = settled.screenPt.w === 512 ? { x: 2, y: -10 } : { x: 4, y: -7 };
  assert.equal(cards.length, 3, "one capture card per live enemy during the choose phase");
  for (const c of cards) {
    assert.equal(c.x, captureRest.x, "card rest x must normalize the bare Cocos 4pt literal");
    assert.equal(c.y, captureRest.y, "card rest y must use the Cocos 7/20 idiom pair");
    assert.equal(c.zIndex, 0, "plain addChild: -> z=0");
    assert(c.parentSorts, "enemy widget must sort children so the z=2 name wins");
    assert(c.nameAboveCard, "name label (addChild:z:2) must render above the capture card");
  }
  // First-capture "NEW!" overlay: the demo collection marks Minotaur+Spark captured, so exactly
  // Unhappy Bird's card carries the pulsing cardGlow (z=-1, scale 1/0.75) + localized "NEW!"
  // label; the captured types get plain cards.
  const newCards = cards.filter((c) => c.glow !== null);
  assert.equal(newCards.length, 1, "exactly one never-captured enemy among the initial three");
  assert.equal(newCards[0].enemyName, "Unhappy Bird", "the NEW overlay must sit on the never-captured type");
  // Cocos child-z reproduction: glow z=-1 sorts BEFORE the z=0 card art (glow BEHIND the card),
  // which requires the button container to actually sort its children.
  assert(newCards[0].art, "card art must be an explicit child (the Cocos self-draw slot)");
  assert(newCards[0].cardSorts, "button container must sort children for the z=-1 glow to go behind");
  assert.equal(newCards[0].glow.zIndex, -1, "cardGlow addChild:z:-1");
  assert(newCards[0].glow.zIndex < newCards[0].art.zIndex, "glow must sort behind the card art");
  assert(
    Math.abs(newCards[0].glow.scale / newCards[0].art.scale - 1 / 0.75) < 0.001,
    "glow scale = 1/buttonScale relative to the card art (both carry the same px->pt fold)",
  );
  assert.equal(newCards[0].newLabel?.text, "NEW!", "localized NewKey string");
  for (const c of cards.filter((x) => x !== newCards[0])) {
    assert.equal(c.glow, null, `captured type ${c.enemyName} must not glow`);
    assert.equal(c.newLabel, null, `captured type ${c.enemyName} must not carry the NEW label`);
  }
  // Glow pulse (FadeOut 0.5 / FadeIn 0.5 forever): alpha must sweep a visible range across
  // three 200ms-spaced samples (single-pair diffs can straddle a fade turnaround symmetrically).
  const glowAlphas = [];
  for (let i = 0; i < 3; i++) {
    glowAlphas.push((await readCards()).find((c) => c.glow)?.glow.alpha);
    if (i < 2) await advance(200);
  }
  assert(
    Math.max(...glowAlphas) - Math.min(...glowAlphas) > 0.15,
    `cardGlow must be actively fading (saw alphas ${glowAlphas.join(", ")})`,
  );
  // ...and the NEW label pops from glowScale*0.5 toward glowScale over 2.0s, then fade-removes.
  const labelEarly = (await readCards()).find((c) => c.newLabel)?.newLabel;
  assert(labelEarly, "NEW label present during its 2.0s pop");
  // Park the glow on an alpha peak (t≈1.0s = FadeIn complete) so the screenshot shows it.
  await advance(600);
  await page.screenshot({ path: path.join(outputDir, "capture-card-new.png"), timeout: 120_000 });
  await advance(2000); // > remaining pop + 0.5s fade-remove
  const afterPop = (await readCards()).find((c) => c.newLabel);
  assert.equal(afterPop, undefined, "NEW label must fade-remove after its pop; the glow persists");
  assert((await readCards()).some((c) => c.glow), "glow keeps pulsing after the label is gone");
  // Idle: each card shakes for 0.5s after its own fixed 6–9s delay; the offset moves +x and −y
  // (Cocos (2,2) is right+up) with |dx| = |dy|. Sample every 50ms across 10s to catch it.
  let shakeSample = null;
  for (let i = 0; i < 200 && !shakeSample; i++) {
    await advance(50);
    const snap = await readCards();
    shakeSample = snap.find((c) => Math.abs(c.x - captureRest.x) > 0.15) ?? null;
  }
  assert(shakeSample, "no capture card shook within 10s (delay is 6–9s)");
  assert(
    Math.abs(shakeSample.y - captureRest.y + (shakeSample.x - captureRest.x)) < 0.001,
    `shake must move (+dx, -dx): got dx=${shakeSample.x - captureRest.x}, dy=${shakeSample.y - captureRest.y}`,
  );
  await page.screenshot({ path: path.join(outputDir, "capture-cards.png"), timeout: 120_000 });

  // --- 3. Reserve promotion ------------------------------------------------------------------
  const swipeCurrentMove = async () => {
    const snapshot = await state();
    const target = snapshot.monsters
      .filter((monster) => monster.team === 1 && monster.visible)
      .sort((left, right) => left.hp - right.hp)[0];
    assert(target?.targetPoint && target.targetSize, "no live enemy target geometry for promotion swipe");
    const halfLane = Math.max(40, target.targetSize.w * 0.75);
    const start = toCss({ x: target.targetPoint.x - halfLane, y: target.targetPoint.y });
    const end = toCss({ x: target.targetPoint.x + halfLane, y: target.targetPoint.y });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let i = 1; i <= 18; i++) {
      await page.mouse.move(start.x + ((end.x - start.x) * i) / 18, start.y, { steps: 1 });
    }
    await page.mouse.up();
  };
  const initialIds = new Set(ids);
  let joined = null;
  let sawUnparented = false;
  let sawNewTuEntry = false;
  let firstTuSample = null;
  let entryStart = null;
  for (let i = 0; i < 3000 && !entryStart; i++) {
    const snap = await state();
    if (snap.presentation.state === "awaitingPlayerChoice" && snap.panelVisible) {
      await swipeCurrentMove();
    }
    await advance(50);
    const after = await state();
    const reserve = after.enemyMemberPositions.find((m) => !initialIds.has(m.id));
    if (reserve && !reserve.parented) {
      sawUnparented = true;
      joined = reserve.id;
    }
    if (joined && !sawNewTuEntry) {
      const tuEntry = after.turnOrderEntries.find((entry) => entry.id === joined);
      if (tuEntry) {
        sawNewTuEntry = true;
        // Where the joiner was the FIRST time the column showed it, and whether the safety net
        // had to find it. `addNodeForMonster:` parents the node at its CCNode origin (0,0) and
        // `notifyTeam:addedMonster:`'s own `updateOrder` starts the 0.5s slide out of it, so a
        // joiner discovered at rest-position-zero and a joiner already sliding are the two
        // orderings this scenario has to be able to tell apart.
        firstTuSample = {
          y: tuEntry.y,
          safetyNet: after.turnOrderCounters?.membershipSafetyNet ?? null,
          fieldParented: Boolean(after.enemyMemberPositions.find((m) => m.id === joined)?.parented),
        };
      }
    }
    if (reserve && reserve.parented && entryStart === null) {
      joined = reserve.id;
      entryStart = reserve;
      assert(sawUnparented, "promoted reserve must spend its 1.0s reorder deferral unparented");
      // Drop-in start: 125pt above the packed row line (rest y = 0 box-local).
      assert(
        reserve.y < -100,
        `promoted ${reserve.id} must start its entrance ~125pt above rest (got y=${reserve.y})`,
      );
      assert.equal(
        after.monsters.find((monster) => monster.id === reserve.id)?.starGroups,
        0,
        "promoted reserve started its onEnter rarity timer while still unparented",
      );
      assert.equal(after.enemyBenchCountShown, 2, "bench badge must drop from 3 to 2 after promotion");
      await page.screenshot({ path: path.join(outputDir, "promotion-dropin.png"), timeout: 120_000 });
    }
  }
  assert(entryStart, "no reserve promotion observed");
  assert(sawNewTuEntry, "promoted reserve never received a TU sidebar entry");


  assert(
    firstTuSample && !firstTuSample.fieldParented,
    `promoted reserve reached the TU column only after its field entrance began (${JSON.stringify(firstTuSample)})`,
  );
  assert.equal(
    firstTuSample.safetyNet,
    0,
    `promoted reserve was discovered by reconcileMembership, not by a team-add event (${JSON.stringify(firstTuSample)})`,
  );
  // The entrance + reflow complete within 1.0s; give it 1.2s and require the rest line.
  await advance(1200);
  const done = await state();
  const rested = done.enemyMemberPositions.find((m) => m.id === joined);
  assert(rested, "promoted reserve disappeared after its entrance");
  assert(Math.abs(rested.y) < 0.5, `promoted ${joined} must rest on the row line (got y=${rested.y})`);
  assert(done.queue.includes(joined), "promoted reserve must be in the authoritative queue");
  assert(done.displayedQueue.includes(joined), "promoted reserve must settle into the displayed TU queue");
  // `EnemyMonsterDisplay.onEnter` owns Delay(2.5s)->showStars. It begins when reorderMonsters
  // parents the promoted display, not at construction one second earlier.
  await advance(1_200);
  let starTiming = await state();
  assert.equal(
    starTiming.monsters.find((monster) => monster.id === joined)?.starGroups,
    0,
    "promoted reserve showed rarity stars before 2.5s of parented lifetime",
  );
  await advance(150);
  starTiming = await state();
  assert.equal(
    starTiming.monsters.find((monster) => monster.id === joined)?.starGroups,
    1,
    "promoted reserve did not show rarity stars at its source 2.5s onEnter boundary",
  );
  await page.screenshot({ path: path.join(outputDir, "promotion-settled.png"), timeout: 120_000 });

  assert.equal(errors.length, 0, errors.join("\n"));
  fs.writeFileSync(
    path.join(outputDir, "state.json"),
    JSON.stringify({ entrance: { t0: t0.enemyMemberPositions, staggered: staggered.enemyMemberPositions, onsetMs: Object.fromEntries(onsetMs) }, shakeSample, joined }, null, 2) + "\n",
  );
  console.log(`enemy-entrance-capture-idle: PASS (promoted ${joined})`);
} finally {
  await browser.close();
}
