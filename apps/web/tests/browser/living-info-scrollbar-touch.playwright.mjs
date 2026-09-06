




















import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/living-info-scrollbar-touch");
fs.mkdirSync(outputDir, { recursive: true });
const desktop = process.env.DIB_DESKTOP === "1";

const readState = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));

/** The two bar sprites' live geometry, plus the global-px-per-region-point scale derived from the
 *  track's own known 12pt width — every ring probe below is expressed in SOURCE POINTS and
 *  converted through this, so the assertions hold at any letterbox/display tier. */
const scrollGeometry = (page) =>
  page.evaluate(() => {
    let track = null;
    let thumb = null;
    const visit = (node, visible) => {
      const nodeVisible = visible && node.visible !== false;
      if (nodeVisible && node.label === "livingInfoScrollTrack") track = node;
      if (nodeVisible && node.label === "livingInfoScrollThumb") thumb = node;
      for (const child of node.children ?? []) visit(child, nodeVisible);
    };
    visit(window.__PIXI_APP__.stage, true);
    if (!track || !thumb) return null;
    const tb = track.getBounds();
    const hb = thumb.getBounds();
    return {
      pxPerPoint: tb.width / track.width,
      thumbY: thumb.y,
      trackPointW: track.width,
      track: { x: tb.x, y: tb.y, w: tb.width, h: tb.height },
      thumb: { x: hb.x, y: hb.y, w: hb.width, h: hb.height },
    };
  });

const visibleTexts = (page) =>
  page.evaluate(() => {
    const values = [];
    const visit = (node, visible) => {
      const nodeVisible = visible && node.visible !== false;
      if (nodeVisible && typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child, nodeVisible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return values;
  });

const textCenterGlobal = (page, needle) =>
  page.evaluate((t) => {
    let found = null;
    const visit = (node, visible) => {
      const nodeVisible = visible && node.visible !== false;
      if (!found && nodeVisible && typeof node.text === "string" && node.text === t) {
        const b = node.getBounds();
        found = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      for (const child of node.children ?? []) visit(child, nodeVisible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return found;
  }, needle);

/** Global-space bounds of a labelled node on the card. */
const labelledBounds = (page, label) =>
  page.evaluate((wanted) => {
    let found = null;
    const visit = (node, visible) => {
      const nodeVisible = visible && node.visible !== false;
      if (!found && nodeVisible && node.label === wanted) {
        const b = node.getBounds();
        found = { x: b.x, y: b.y, w: b.width, h: b.height };
      }
      for (const child of node.children ?? []) visit(child, nodeVisible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return found;
  }, label);

/** The first ability row's text and global centre — whatever moves this monster happens to have. */
const firstAbilityRow = (page) =>
  page.evaluate(() => {
    let found = null;
    const visit = (node, visible) => {
      const nodeVisible = visible && node.visible !== false;
      if (!found && nodeVisible && node.label === "livingInfoAbilityRow") {
        const b = node.getBounds();
        found = { text: node.text, x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      for (const child of node.children ?? []) visit(child, nodeVisible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return found;
  });

const elementIconCenter = async (page) => {
  const b = await labelledBounds(page, "livingInfoElementIcon");
  return b && { x: b.x + b.w / 2, y: b.y + b.h / 2 };
};
const hpLabelBounds = (page) => labelledBounds(page, "livingInfoHpLabel");

const waitForVisibleText = async (page, advance, needle, timeoutIters = 100) => {
  for (let i = 0; i < timeoutIters; i++) {
    if ((await visibleTexts(page)).includes(needle)) return;
    await page.waitForTimeout(100);
    await advance(100);
  }
  throw new Error(`"${needle}" never rendered; saw: ${(await visibleTexts(page)).join(" | ")}`);
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  // A real touch context: `hasTouch` makes Chromium emit touch-derived pointer events, which is
  // the input stream the playtester's device produces. The phone tier is the default because the
  // report is a mobile one; the finalized target is 55 PORT points in both tiers.
  const context = await browser.newContext(
    desktop
      ? { viewport: { width: 1280, height: 800 }, hasTouch: true }
      : { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
  );
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();



    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      blockSaveMe: true,
      playerTeam: [
        { shortType: "Manticore", level: 12, soulStone: { element: "Fire", level: 40, sourceType: "FireCub" } },
      ],
      enemyTeam: [{ shortType: "Minotaur", level: 12 }],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // buildScene awaits REAL asset fetches — wall-clock first (a tight advanceTime loop starves
  // them, the "building" stall pitfall), then deterministic ticks to the first player turn.
  for (let i = 0; i < 240 && (await readState(page)).mode !== "battle"; i++) {
    await advance(50);
    await page.waitForTimeout(250);
  }
  for (let i = 0; i < 400 && (await readState(page)).presentation?.state !== "awaitingPlayerChoice"; i++) {
    await advance(250);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  assert.equal((await readState(page)).presentation?.state, "awaitingPlayerChoice", "first player turn never arrived");

  // --- Open Manticore's stats card from its friendly turn-order portrait. ---
  const state = await readState(page);
  const manticore = state.turnOrderEntries.find((entry) => entry.id === "t0m0:Manticore");
  assert(manticore?.iconGlobalCenter, `Manticore TU entry must be ready: ${JSON.stringify(state.turnOrderEntries)}`);
  await page.mouse.click(box.x + manticore.iconGlobalCenter.x, box.y + manticore.iconGlobalCenter.y);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup?.startsWith("livingInfo:"), undefined, { timeout: 15_000 });
  await waitForVisibleText(page, advance, "Soul Stone");
  await advance(800); // settle the 0.2s pop-in before measuring bounds

  const base = await scrollGeometry(page);
  assert(base, "the overflowing card must build a scrollbar track + thumb");
  const pt = base.pxPerPoint;
  assert.equal(base.trackPointW, 12, `the shipped bar art is 12 logical points wide; saw ${base.trackPointW}`);
  await page.screenshot({ path: path.join(outputDir, "01-card-open.png"), timeout: 120_000 });

  // --- Touch plumbing. Points are CSS-viewport px; the canvas renders 1:1 with its CSS box. ---
  const cdp = await context.newCDPSession(page);
  const touch = async (type, points) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      // For touchEnd, `points` are the contacts that REMAIN active (not the contact being
      // released). TouchCancel must be empty and cancels the complete active set.
      touchPoints: type === "touchCancel"
        ? []
        : points.map((p) => ({ x: box.x + p.x, y: box.y + p.y, id: p.id ?? 1, radiusX: 6, radiusY: 6, force: 1 })),
    });
    await advance(16);
  };
  const thumbY = async () => (await scrollGeometry(page)).thumbY;
  /** One complete claimed sequence: down at `from`, move to `to`, release there. */
  const dragTouch = async (from, to, id = 1) => {
    await touch("touchStart", [{ ...from, id }]);
    await touch("touchMove", [{ ...to, id }]);
    await touch("touchEnd", []);
    await advance(120);
  };
  const trackTop = base.track.y + 4 * pt;
  const trackBottom = base.track.y + base.track.h - 4 * pt;

  const dismissPopup = async () => {
    const okPt = await textCenterGlobal(page, "Ok");
    assert(okPt, "the open popup must render an Ok button to dismiss");
    await page.mouse.click(box.x + okPt.x, box.y + okPt.y);
    await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null, undefined, { timeout: 15_000 });
    await advance(300);
  };
  const resetToTop = async (id = 1) => {
    // ScrollingNode maps the release ABSOLUTELY as localY/viewedH. `trackTop` is intentionally
    // inset by 4pt for hit-ring probes, so releasing there means percent 3.125 (thumbY 3.2), not
    // the asserted source endpoint. Release on the exported track origin for exact percent 0.
    await dragTouch(
      { x: base.track.x + base.track.w / 2, y: trackBottom },
      { x: base.track.x + base.track.w / 2, y: base.track.y },
      id,
    );
    assert.equal(await thumbY(), 0, "reset drag must return the thumb to percent 0");
  };
  await resetToTop();

  // --- 1. The RIGHT padding ring: 10pt past the visible bar, inside the 21.5pt source ring. This
  // is the probe the old parent `Rectangle(0, 0, viewedW + gap + spriteW, viewedH)` clipped off. ---
  const rightRing = base.track.x + base.track.w + 10 * pt;
  await dragTouch({ x: rightRing, y: trackTop }, { x: rightRing, y: trackBottom });
  const afterRightRing = await thumbY();
  assert(afterRightRing > 0, `a touch 10pt RIGHT of the visible bar must claim the scrollbar (thumbY=${afterRightRing})`);
  await page.screenshot({ path: path.join(outputDir, "02-right-ring-drag.png"), timeout: 120_000 });
  await resetToTop();

  // --- 2. Just outside the finalized edge: 23pt right of the art is past the 21.5pt ring. ---
  const pastRing = base.track.x + base.track.w + 23 * pt;
  await dragTouch({ x: pastRing, y: trackTop }, { x: pastRing, y: trackBottom });
  assert.equal(await thumbY(), 0, "a touch 23pt right of the bar is outside the 55pt rect and must NOT scroll");

  // --- 3. The LEFT padding ring (over the content column, so this also proves the bar claim wins
  // over the rows it overlaps — the source swallows the sequence at priority INT_MIN+90). ---
  const leftRing = base.track.x - 10 * pt;
  await dragTouch({ x: leftRing, y: trackTop }, { x: leftRing, y: trackBottom });
  assert((await thumbY()) > 0, "a touch 10pt LEFT of the visible bar must claim the scrollbar");
  await resetToTop();

  // --- 4. The thumb's own 12.5pt endpoint padding at percent 0, ABOVE the track's top edge (the
  // track rect starts at region y=0, so only the thumb's finalized rect can claim up there). ---
  const thumbMidX = base.thumb.x + base.thumb.w / 2;
  await dragTouch({ x: thumbMidX, y: base.track.y - 8 * pt }, { x: thumbMidX, y: trackBottom });
  assert((await thumbY()) > 0, "a touch 8pt ABOVE the thumb at percent 0 must claim it");
  await resetToTop();
  await dragTouch({ x: thumbMidX, y: base.track.y - 13 * pt }, { x: thumbMidX, y: trackBottom });
  assert.equal(await thumbY(), 0, "13pt above the thumb is past its 12.5pt ring and must NOT claim");

  // --- 5. `ccTouchBegan:` moves NOTHING; the jump comes from `ccTouchEnded:`'s final recompute. ---
  const tapX = base.track.x + base.track.w / 2;
  await touch("touchStart", [{ x: tapX, y: trackBottom, id: 1 }]);
  assert.equal(await thumbY(), 0, "touchBegan must not move the thumb (no-move tap jumps only on release)");
  await touch("touchEnd", []);
  await advance(120);
  assert((await thumbY()) > 0, "touchEnded must apply the final absolute position");
  await resetToTop();

  // --- 6. `ccTouchCancelled:` clears the claim WITHOUT a final update, and nothing drives it after. ---
  await touch("touchStart", [{ x: tapX, y: trackTop, id: 1 }]);
  await touch("touchMove", [{ x: tapX, y: base.track.y + base.track.h * 0.4, id: 1 }]);
  const atCancel = await thumbY();
  assert(atCancel > 0, "the drag must be live before cancelling");
  await touch("touchCancel", [{ x: tapX, y: base.track.y + base.track.h * 0.4, id: 1 }]);
  await touch("touchStart", [{ x: 20, y: 20, id: 2 }]);
  await touch("touchMove", [{ x: 20, y: box.height - 20, id: 2 }]);
  await touch("touchEnd", []);
  assert.equal(await thumbY(), atCancel, "a cancelled sequence must leave no stuck drag state");
  await resetToTop(3);

  // --- 7. The `scrolling` ivar gate: only the FIRST claimed pointer drives the bar. ---
  await touch("touchStart", [{ x: tapX, y: trackTop, id: 1 }]);
  await touch("touchStart", [{ x: tapX, y: trackTop, id: 1 }, { x: tapX, y: trackBottom, id: 2 }]);
  await touch("touchMove", [{ x: tapX, y: trackTop, id: 1 }, { x: tapX, y: trackBottom, id: 2 }]);
  assert.equal(await thumbY(), 0, "a second pointer must not drive the first pointer's drag");
  await touch("touchEnd", [{ x: tapX, y: trackTop, id: 1 }]);
  await touch("touchMove", [{ x: tapX, y: base.track.y + base.track.h * 0.5, id: 1 }]);
  assert((await thumbY()) > 0, "the claiming pointer must still drive the drag");
  await touch("touchEnd", []);
  await resetToTop();

  // --- 8. The root pass-through regression: interactive DESCENDANTS of the card root must still
  // route. The soul-stone row lives at the bottom of the scrolled column, so scroll to it first. ---
  await dragTouch({ x: tapX, y: trackTop }, { x: tapX, y: trackBottom });
  await advance(400);
  const rowPt = await textCenterGlobal(page, "Fire Soul Stone");
  assert(rowPt, "the stone row must be locatable after scrolling to the bottom");
  await touch("touchStart", [{ x: rowPt.x, y: rowPt.y, id: 1 }]);
  await touch("touchEnd", []);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "soulStone:Fire Soul Stone", undefined, { timeout: 15_000 });
  await advance(600);
  await page.screenshot({ path: path.join(outputDir, "03-descendant-row-tap.png"), timeout: 120_000 });








  await dismissPopup();
  await resetToTop();

  // (a) The reported bug: a move row must open its ability popup.
  const abilityRow = await firstAbilityRow(page);
  assert(abilityRow, `an ability row must be visible; saw: ${(await visibleTexts(page)).join(" | ")}`);
  await touch("touchStart", [{ x: abilityRow.x, y: abilityRow.y, id: 1 }]);
  await touch("touchEnd", []);
  await page.waitForFunction((n) => JSON.parse(window.render_game_to_text()).activePopup === `ability:${n}`, abilityRow.text, { timeout: 15_000 });
  await advance(600);
  await page.screenshot({ path: path.join(outputDir, "04-ability-row-tap.png"), timeout: 120_000 });

  // (b) An outer target still routes after the reordering: the element icon opens element help.
  await dismissPopup();
  const elementPt = await elementIconCenter(page);
  assert(elementPt, "the card's element icon must be locatable");
  await touch("touchStart", [{ x: elementPt.x, y: elementPt.y, id: 1 }]);
  await touch("touchEnd", []);
  await page.waitForFunction(() => (JSON.parse(window.render_game_to_text()).activePopup ?? "").startsWith("element:"), undefined, { timeout: 15_000 });

  // (c) The outer ring where it INTRUDES INTO the scroll viewport. The HP label's finalized rect
  // extends 22.5pt below its own bounds, past the top of the scroll region; the source's
  // ScrollingNode never claims that point, so it must still open the HP stat popup. This is the
  // case a self-claiming `scrollRegion.hitArea` silently swallowed.
  await dismissPopup();
  const hp = await hpLabelBounds(page);
  assert(hp, "the card's HP label must be locatable");
  const ringY = hp.y + hp.h + 12 * base.pxPerPoint; // 12pt below the label, inside its 22.5pt ring
  await touch("touchStart", [{ x: hp.x + hp.w / 2, y: ringY, id: 1 }]);
  await touch("touchEnd", []);
  await page.waitForFunction(() => (JSON.parse(window.render_game_to_text()).activePopup ?? "").startsWith("message:"), undefined, { timeout: 15_000 });
  await advance(600);
  await page.screenshot({ path: path.join(outputDir, "05-outer-ring-into-viewport.png"), timeout: 120_000 });

  assert.deepEqual(errors, [], `page must stay clean: ${errors.join(" | ")}`);
  console.log(`living-info scrollbar touch scenario PASS (${desktop ? "desktop" : "phone"} tier) -> ${outputDir}`);
} finally {
  await browser.close();
}
