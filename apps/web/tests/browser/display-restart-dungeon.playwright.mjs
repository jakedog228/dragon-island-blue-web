// Opt-in production-ticker regression for changing presentation while an active dungeon run owns
// the scene. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/display-restart-dungeon");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    // Deliberately leave advanceTime absent: replacement sessions must run on the production ticker.
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 7;
    window.__DIB_TEST_DUNGEON_SEED__ = 3;
    window.__DIB_TEST_DUNGEON_ROUTE__ = {
      typeName: "Cave",
      sourceFile: "Dungeon_1.plist",
      floor: 1,
    };
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const waitForState = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await page.waitForTimeout(50);
    }
    throw new Error(
      `${description}; errors: ${errors.join(" | ") || "none"}; state: ${JSON.stringify(await state())}`,
    );
  };

  await waitForState((value) => value.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitForState(
    (value) =>
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" ||
      value.mode === "dungeon",
    "title did not continue",
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await page.waitForTimeout(2_100);
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.startup?.phase === "pick-dragon",
      "new-game plot did not reach starter selection",
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  snapshot = await waitForState((value) => value.mode === "dungeon", "dungeon fixture did not start");
  // `mode` changes as soon as the incoming DungeonNode is published. Let SceneCoordinator finish
  // its source transition before exercising an Options action, which cannot be pressed mid-fade.
  await page.waitForTimeout(1_500);
  snapshot = await state();
  const labeledNodeCenter = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) {
        const bounds = node.getBounds();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      if (node?.children) stack.push(...node.children);
    }
    return undefined;
  }, label);
  const closeCatchQuestIfPresent = async () => {
    const center = await labeledNodeCenter("catchQuestClose");
    if (center === undefined) return;
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "dungeon canvas is missing");
    await page.mouse.click(canvas.x + center.x, canvas.y + center.y);
    await waitForState(
      (value) => value.popups?.persistent?.depth === 0,
      "capture challenge did not close",
    );
  };
  await closeCatchQuestIfPresent();
  for (let index = 0; index < 4 && (await state()).floorDetectionChat != null; index++) {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(250);
  }
  snapshot = await state();
  assert.equal(snapshot.floorDetectionChat, undefined, "floor-entry chat remained open before Options");
  const durableBefore = await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot());
  assert.equal(
    await page.evaluate(() => window.__PIXI_APP__.ticker.started),
    true,
    "initial production ticker is stopped",
  );

  const initialDisplayMode = snapshot.displayMode;
  const nextDisplayMode = initialDisplayMode === "iphone" ? "ipad" : "iphone";
  const initialTextMode = snapshot.textResolutionMode;
  const nextTextMode = initialTextMode === "original" ? "modern" : "original";
  const applyAndRestart = async (displayMode, textResolutionMode, description) => {
    await page.evaluate(({ displayMode: mode, textResolutionMode: textMode }) => {
      const key = "dib.portSettings.v1";
      const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
      localStorage.setItem(key, JSON.stringify({
        displayMode: mode,
        textResolutionMode: textMode,
        sound: saved.sound ?? 0.25,
        music: saved.music ?? 0.5,
      }));
    }, { displayMode, textResolutionMode });
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
    const restored = await waitForState(
      (value) =>
        value.displayMode === displayMode &&
        value.textResolutionMode === textResolutionMode &&
        value.mode === "dungeon",
      description,
    );
    // Gameplay mode publishes before the startup half-fade releases its ticker ownership. Options
    // cannot be opened during that transition, so the next reciprocal change must wait likewise.
    await page.waitForTimeout(1_500);
    assert.deepEqual(
      await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot()),
      durableBefore,
      `${description}: durable player/world/dungeon snapshot changed`,
    );
    const settled = await state();
    assert.equal(settled.floorDetectionChat, undefined, `${description}: floor-entry chat replayed`);
    assert.equal(
      await labeledNodeCenter("catchQuestDisplay"),
      undefined,
      `${description}: capture challenge replayed`,
    );
    assert.equal(
      await page.evaluate(() => window.__PIXI_APP__.ticker.started),
      true,
      `${description}: replacement production ticker is stopped`,
    );
    return settled;
  };

  snapshot = await applyAndRestart(
    nextDisplayMode,
    initialTextMode,
    "first display restart did not restore the active dungeon",
  );
  assert.deepEqual(
    snapshot.stagePx,
    nextDisplayMode === "iphone" ? { w: 960, h: 640 } : { w: 1024, h: 768 },
  );
  snapshot = await applyAndRestart(
    initialDisplayMode,
    initialTextMode,
    "reciprocal display restart did not restore the active dungeon",
  );
  snapshot = await applyAndRestart(
    initialDisplayMode,
    nextTextMode,
    "text-only restart did not restore the active dungeon",
  );
  assert.deepEqual(
    snapshot.stagePx,
    initialDisplayMode === "iphone" ? { w: 960, h: 640 } : { w: 1024, h: 768 },
  );
  assert.equal(await page.locator("#content-title").count(), 0, "restart returned to the archive picker");

  const after = {
    sourceFile: snapshot.sourceFile,
    dungeonType: snapshot.dungeonType,
    floor: snapshot.floor,
    currentRoomId: snapshot.currentRoomId,
    exploredRoomIds: snapshot.rooms.filter((room) => room.explored).map((room) => room.id).sort(),
    availableDirections: [...snapshot.availableDirections].sort(),
    player: snapshot.player,
  };
  const before = {
    sourceFile: durableBefore.dungeon.current.route.sourceFile,
    dungeonType: durableBefore.dungeon.current.route.typeName,
    floor: durableBefore.dungeon.current.route.floor,
    currentRoomId: durableBefore.dungeon.current.session.currentRoomId,
    player: durableBefore.player,
  };

  await page.waitForTimeout(1_000);
  await page.screenshot({
    path: path.join(outputDir, "restored-dungeon.png"),
    timeout: 120_000,
  });
  fs.writeFileSync(
    path.join(outputDir, "restored-state.json"),
    `${JSON.stringify({
      displayMode: initialDisplayMode,
      textResolutionMode: nextTextMode,
      before,
      after,
      durableSnapshot: durableBefore,
    }, null, 2)}\n`,
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(
    `display-restart-dungeon: PASS ` +
    `(${initialDisplayMode} -> ${nextDisplayMode} -> ${initialDisplayMode}, text ${nextTextMode})`,
  );
} finally {
  await browser.close();
}
