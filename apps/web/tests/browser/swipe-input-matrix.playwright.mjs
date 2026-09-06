import assert from "node:assert/strict";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter } from "./fixtures.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";

async function reachPanel(page) {
  await pinEncounter(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => {
      const state = JSON.parse(window.render_game_to_text());
      return state.presentation?.state === "awaitingPlayerChoice" && state.panelVisible === true;
    },
    undefined,
    { timeout: 30_000 },
  );
  return box;
}

async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

function horizontalTargetLane(snapshot, toCss, idPart) {
  const target = snapshot.monsters.find((monster) => monster.id.includes(idPart));
  assert(target?.targetPoint && target.targetSize, `missing live target geometry for ${idPart}`);
  // Endpoints outside the interactive sprite keep the sparse input owned by the scene recognizer;
  // source selection uses the stroke-bounds midpoint, which remains exactly on the target.
  const halfLane = Math.max(40, target.targetSize.w * 0.75);
  return {
    start: toCss({ x: target.targetPoint.x - halfLane, y: target.targetPoint.y }),
    end: toCss({ x: target.targetPoint.x + halfLane, y: target.targetPoint.y }),
  };
}

async function runMouse(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const box = await reachPanel(page);
  const { toCss, screenPt } = await stageGeometry(page, box);
  // A shaky background click must not be normalized into a directional gesture (mid-field).
  const jitter = toCss({ x: screenPt.w / 2, y: 200 });
  const jitterX = jitter.x;
  const jitterY = jitter.y;
  await page.mouse.move(jitterX, jitterY);
  await page.mouse.down();
  await page.mouse.move(jitterX + 18, jitterY + 7, { steps: 1 });
  await page.mouse.move(jitterX + 6, jitterY - 4, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.equal((await state(page)).panelVisible, true, "sub-20pt shaky click must not queue a swipe ability");

  // User-like sparse swipe: cross the live enemy monster bound with one move event. Source
  // single-enemy resolution rejects a recognized stroke whose midpoint misses every eligible
  // monster node, so a bottom-panel lane is an intentional notAllowed case, not a success path.
  const lane = horizontalTargetLane(await state(page), toCss, "Minotaur");
  await page.mouse.move(lane.start.x, lane.start.y);
  await page.mouse.down();
  await page.mouse.move(lane.end.x, lane.end.y, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  const mouseDispatch = await state(page);
  assert.equal(
    mouseDispatch.panelVisible,
    false,
    `sparse mouse swipe did not queue: ${JSON.stringify(mouseDispatch.battleInput)}`,
  );
  // The contract is that the swipe DISPATCHED a move onto the nearest enemy — not any particular
  // damage figure. Combat RNG is unseeded here, so the roll genuinely varies run to run (observed
  // 40/39/85 off 137 max on the pinned roster); the old `hp === 100` pin was tied to a superseded
  // roster and could only ever have passed by luck.
  await page.waitForFunction(
    () => {
      const m = JSON.parse(window.render_game_to_text()).monsters.find((x) => x.id.includes("Minotaur"));
      return m && m.hp < m.maxHp;
    },
    undefined,
    { timeout: 5_000 },
  );
  const after = await state(page);
  const minotaur = after.monsters.find((m) => m.id.includes("Minotaur"));
  assert(minotaur.hp < minotaur.maxHp, "swipe did not land a move on the nearest enemy");
  assert.deepEqual(errors, []);
  await page.close();
}

async function runTouch(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const box = await reachPanel(page);
  const { toCss } = await stageGeometry(page, box);
  const session = await context.newCDPSession(page);
  const lane = horizontalTargetLane(await state(page), toCss, "Minotaur");
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: lane.start.x, y: lane.start.y, id: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: lane.end.x, y: lane.end.y, id: 1 }] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(250);
  const touchDispatch = await state(page);
  assert.equal(
    touchDispatch.panelVisible,
    false,
    `sparse touch swipe did not queue: ${JSON.stringify(touchDispatch.battleInput)}`,
  );
  // The contract is that the swipe DISPATCHED a move onto the nearest enemy — not any particular
  // damage figure. Combat RNG is unseeded here, so the roll genuinely varies run to run (observed
  // 40/39/85 off 137 max on the pinned roster); the old `hp === 100` pin was tied to a superseded
  // roster and could only ever have passed by luck.
  await page.waitForFunction(
    () => {
      const m = JSON.parse(window.render_game_to_text()).monsters.find((x) => x.id.includes("Minotaur"));
      return m && m.hp < m.maxHp;
    },
    undefined,
    { timeout: 5_000 },
  );
  const after = await state(page);
  const minotaur = after.monsters.find((m) => m.id.includes("Minotaur"));
  assert(minotaur.hp < minotaur.maxHp, "swipe did not land a move on the nearest enemy");
  assert.deepEqual(errors, []);
  await context.close();
}

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  await runMouse(browser);
  await runTouch(browser);
  console.log("swipe-input-matrix: PASS (normal-runtime sparse mouse + touch)");
} finally {
  await browser.close();
}
