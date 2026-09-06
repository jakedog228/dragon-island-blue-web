


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { pinEncounter } from "./fixtures.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/contract-popup-modal-swallow");
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

  await pinEncounter(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => {
    if (typeof window.render_game_to_text !== "function") return false;
    return JSON.parse(window.render_game_to_text()).mode === "start";
  }, undefined, { timeout: 30_000 });
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).presentation?.state === "awaitingPlayerChoice",
    undefined,
    { timeout: 60_000 },
  );

  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const { toCss } = await stageGeometry(page, canvasBox);
  const swipeLane = async () => {
    // The swipe-nearest scenario's source-valid dispatch lane: slot-1 leftToRight with its
    // stroke-bounds midpoint inside Minotaur's live monster-node bounds.
    const snapshot = await state();
    const target = snapshot.monsters.find((monster) => monster.id.includes("Minotaur"));
    assert(target?.targetPoint && target.targetSize, "missing Minotaur target geometry");
    const halfLane = Math.max(40, target.targetSize.w * 0.75);
    const lane = toCss({ x: target.targetPoint.x - halfLane, y: target.targetPoint.y });
    const laneEnd = toCss({ x: target.targetPoint.x + halfLane, y: target.targetPoint.y });
    await page.mouse.move(lane.x, lane.y);
    await page.mouse.down();
    for (let i = 1; i <= 18; i++) {
      await page.mouse.move(lane.x + ((laneEnd.x - lane.x) * i) / 18, lane.y, { steps: 1 });
    }
    await page.mouse.up();
  };

  // Open the living-info popup from the first friendly turn-order entry (root (0,5), entry i
  // origin (12, 5+(i+1)*34), icon extends up from the origin — same tap the popup proofs use).
  const before = await state();
  const friendlyIdx = before.queue.findIndex((id) => /FireCub|SnowCub|WhiteDragonling/.test(id));
  assert(friendlyIdx >= 0, "no friendly in queue");
  const tap = toCss({ x: 22, y: 5 + (friendlyIdx + 1) * 34 - 10 });
  await page.mouse.click(tap.x, tap.y);
  await page.waitForFunction(
    () => (JSON.parse(window.render_game_to_text()).activePopup ?? "").startsWith("livingInfo"),
    undefined,
    { timeout: 10_000 },
  );

  // Swipe the dispatch lane THROUGH the open popup, then give the app real time to (wrongly)
  // react. Every "nothing happened" signal must hold.
  await swipeLane();
  await page.waitForTimeout(600);
  const during = await state();
  assert((during.activePopup ?? "").startsWith("livingInfo"), "popup must stay open across the swipe");
  assert.equal(during.panelVisible, true, "swipe through the modal popup must not remove the panel");
  assert.equal(during.friendlyPopForwardCount, 0, "swipe through the modal popup must not queue a move");
  assert.deepEqual(
    during.monsters.map((m) => [m.id, m.hp]),
    before.monsters.map((m) => [m.id, m.hp]),
    "no HP may change from a swallowed swipe",
  );
  await page.screenshot({ path: path.join(outputDir, "swipe-swallowed.png") });

  // Dismiss via the popup's own Ok button (its whole ancestor chain must be visible — the same
  // guard the stacking proof needed) — the button INSIDE the popup must keep working.
  const okPos = await page.evaluate(() => {
    const chainVisible = (n) => { for (let p = n; p; p = p.parent) if (!p.visible) return false; return true; };
    let found = null;
    const visit = (n) => {
      if (!found && typeof n.text === "string" && n.text === "Ok" && chainVisible(n)) {
        const b = n.getBounds();
        found = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      for (const c of n.children ?? []) visit(c);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  });
  assert(okPos, "popup Ok button not found");
  await page.mouse.click(canvasBox.x + okPos.x, canvasBox.y + okPos.y);
  await page.waitForFunction(
    () => !(JSON.parse(window.render_game_to_text()).activePopup ?? "").startsWith("livingInfo"),
    undefined,
    { timeout: 10_000 },
  );

  // Control: the identical lane must dispatch once the popup is gone.
  await swipeLane();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).friendlyPopForwardCount === 1,
    undefined,
    { timeout: 10_000 },
  );
  const after = await state();
  assert.equal(after.panelVisible, false, "successful post-dismiss swipe removes/hides the turn panel");
  assert.equal(errors.length, 0, errors.join("\n"));

  fs.writeFileSync(path.join(outputDir, "state.json"), JSON.stringify(after, null, 2) + "\n");
  console.log("popup-modal-swallow: PASS (swipe swallowed while open, dispatches after dismiss)");
} finally {
  await browser.close();
}
