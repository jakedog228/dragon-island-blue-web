// Regression for a battle-scene teardown while Metal Slime's source-owned friendly spotlight is
// still running. Utility.Escape reaches state 6 immediately, so pressing Rematch during the
// spotlight's exit used to destroy its Pixi transform while a ticker listener still wrote `y`.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "MetalSlime", level: 50 }],
      enemyTeam: [{ shortType: "SnowCub", level: 1 }],
    };
    window.__DIB_TEST_BATTLE_SEED__ = 0x455343;
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((amount) => window.advanceTime(amount), ms);
    // Asset fetches used by the rematch rebuild need a real event-loop yield.
    await page.waitForTimeout(1);
  };
  while ((await state()).mode !== "start") await advance(50);
  for (let i = 0; i < 300; i++) await advance(10);
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(
    canvasBox.x + canvasBox.width / 2,
    canvasBox.y + canvasBox.height / 2,
  );
  const geometry = await stageGeometry(page, canvasBox);

  let ready;
  for (let i = 0; i < 1600; i++) {
    ready = await state();
    if (
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.activeActorId === "t0m0:MetalSlime" &&
      ready.abilityButtons?.some((button) => button.abilityPath === "Utility.Escape")
    ) {
      break;
    }
    await advance(25);
  }
  assert.equal(
    ready?.activeActorId,
    "t0m0:MetalSlime",
    `Metal Slime's choice phase never opened: ${JSON.stringify(ready?.presentation)}`,
  );
  await advance(250);
  ready = await state();
  const escape = ready.abilityButtons.find(
    (button) => button.abilityPath === "Utility.Escape",
  );
  assert(escape, `Escape card missing: ${JSON.stringify(ready.abilityButtons)}`);



  const escapeCss = geometry.toCss(escape.center);
  const owner = await page.evaluate((point) => {
    const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(point.x, point.y);
    const path = [];
    for (let current = hit; current; current = current.parent) path.push(current.label ?? null);
    return path;
  }, { x: escapeCss.x, y: escapeCss.y });
  assert.equal(
    owner[0],
    `ability:${escape.slot}`,
    `Escape's reported card centre ${JSON.stringify(escapeCss)} is owned by ${JSON.stringify(owner)}`,
  );
  await page.mouse.click(escapeCss.x, escapeCss.y);

  let retreated;
  for (let i = 0; i < 200; i++) {
    retreated = await state();
    if (retreated.presentation?.state === "retreated") break;
    await advance(10);
  }
  assert.equal(retreated?.presentation?.state, "retreated");
  assert.equal(retreated.activePopup, "retreated");

  // Entry 450ms + hold 1000ms: this places the spotlight inside its 450ms exit tween, matching
  // the reported friendlyTeamDisplay.ts exit-line crash before the scene is rebuilt.
  await advance(1500);
  const exiting = await state();
  assert.equal(
    exiting.friendlyPopForwardLayers.length,
    1,
    `spotlight was not active during teardown: ${JSON.stringify(exiting.friendlyPopForwardLayers)}`,
  );

  const rematchGlobal = await page.evaluate(() => {
    let result = null;
    const visit = (node) => {
      if (result || node.destroyed || !node.visible) return;
      if (node.text === "Rematch") {
        const bounds = node.getBounds();
        result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return result;
  });
  assert(rematchGlobal, "retreat popup did not expose Rematch");
  // getBounds() is already in renderer-global pixels after FixedStage's scale/letterbox
  // transform; only add the canvas's page offset here.
  const rematchCss = {
    x: canvasBox.x + rematchGlobal.x,
    y: canvasBox.y + rematchGlobal.y,
  };
  await page.screenshot({ path: "output/escape-spotlight-teardown.png", timeout: 120_000 });
  await page.mouse.click(rematchCss.x, rematchCss.y);

  let rebuilt;
  for (let i = 0; i < 1600; i++) {
    rebuilt = await state();
    if (
      rebuilt.presentation?.state === "awaitingPlayerChoice" &&
      rebuilt.activeActorId === "t0m0:MetalSlime" &&
      rebuilt.abilityButtons?.some((button) => button.abilityPath === "Utility.Escape")
    ) {
      break;
    }
    await advance(25);
  }
  assert.equal(
    rebuilt?.presentation?.state,
    "awaitingPlayerChoice",
    `rematch did not rebuild after spotlight teardown: ${JSON.stringify(rebuilt?.presentation)}`,
  );
  assert.deepEqual(errors, []);
  console.log("escape-spotlight-teardown: PASS");
} finally {
  await browser.close();
}
