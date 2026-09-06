



import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/underworld-background-alignment");
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
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_START_IN_WORLD__ = true;
    window.__DIB_TEST_WORLD_NAME__ = "UnderWorld_1-1";
    window.__DIB_TEST_POI_NAME__ = "Underworld_Cave_3";
    window.__DIB_TEST_SKIP_DEMO_EVOLUTION_HISTORY__ = true;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [100, 100],
      members: [{ shortType: "Goblin", level: 100 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      // Hero level/total are DERIVED, not free-form (`c06109a`): the registered levels below
      // sum to 100, the total must cover them, and heroLevelForXp(100) is 5. The original
      // `heroLevel: 1` with no total predates that rule and failed the profile's own
      // consistency check at boot, which is what kept the world from ever coming up here.
      heroLevel: 5,
      heroTotalHighestLevels: 100,
      monsterPartyLevels: [100],
      highestCapturedLevels: { Goblin: 100 },
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      tutorialFlags: [],
    };
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (milliseconds = 25) => {
    await page.evaluate((value) => window.advanceTime(value), milliseconds);
    await page.waitForTimeout(1);
  };
  for (let index = 0; index < 600 && (await state()).startup?.phase !== "title"; index++) {
    await advance();
  }
  assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
  await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const snapshot = await state();
    if (snapshot.startup?.phase === "save-select" || snapshot.mode === "world") break;
    await advance();
  }
  if ((await state()).startup?.phase === "save-select") await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const snapshot = await state();
    if (snapshot.mode === "world" && !snapshot.locked) break;
    await advance();
  }

  let snapshot = await state();
  if (snapshot.mode !== "world") {





    const flags = await page.evaluate(() => ({
      skipSourceNewGameIntro: window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__,
      startInWorld: window.__DIB_TEST_START_IN_WORLD__,
      worldName: window.__DIB_TEST_WORLD_NAME__,
      poiName: window.__DIB_TEST_POI_NAME__,
    }));
    assert.fail(
      `world never came up: mode=${snapshot.mode} ` +
        `startup=${JSON.stringify(snapshot.startup)} ` +
        `world=${snapshot.world} currentPoi=${snapshot.currentPoi} locked=${snapshot.locked} ` +
        `initFlags=${JSON.stringify(flags)} ` +
        `errors=${errors.join(" | ") || "none"}`,
    );
  }
  assert.equal(snapshot.world, "UnderWorld_1-1");
  assert.equal(snapshot.displayMode, "iphone");
  assert.deepEqual(snapshot.screenPt, { w: 480, h: 320 });
  const cave = snapshot.pois.find((poi) => poi.name === "Underworld_Cave_3");
  assert(cave, "Underworld_Cave_3 was not rendered");
  assert.deepEqual(cave.mapPosition, { x: 275, y: 205 });
  assert.deepEqual(cave.position, { x: 258, y: 180 });

  const map = await page.evaluate(() => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const candidates = [];
    const visit = (node) => {
      const frame = node.texture?.frame;
      if (
        visible(node) &&
        frame?.width === 1024 &&
        frame?.height === 768 &&
        Math.abs(node.width - 512) < 1e-6 &&
        Math.abs(node.height - 384) < 1e-6
      ) {
        candidates.push(node);
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    if (candidates.length !== 1) {
      throw new Error(`expected one visible 1024x768 Underworld map, found ${candidates.length}`);
    }
    const node = candidates[0];
    return {
      sprite: { x: node.position.x, y: node.position.y, w: node.width, h: node.height },
      layer: { x: node.parent.position.x, y: node.parent.position.y },
    };
  });
  assert.deepEqual(map, {
    sprite: { x: 0, y: 0, w: 512, h: 384 },
    layer: { x: -17, y: -25 },
  });

  await page.screenshot({
    path: path.join(outputDir, "iphone-underworld.png"),
    timeout: 120_000,
  });

  await page.keyboard.press("Escape");
  for (let index = 0; index < 200 && (await state()).menu?.config !== "MasterMenu"; index++) {
    await advance();
  }
  snapshot = await state();
  assert.equal(snapshot.menu?.config, "MasterMenu", "Underworld MasterMenu did not open");
  assert.equal(
    snapshot.menu.buttons.find((button) => button.action === "worldMap")?.enabled,
    true,
    "World Map is not enabled by the operator archive",
  );
  // PopupMenu owns one shared item list. The labelled visual's descendant bounds include its
  // animated plate and are not the source hit target; use the exact source-local centre published
  // by WorldMenu's geometry, mapped through the live FixedStage letterbox.
  const worldMapButton = snapshot.menu.buttons.find((button) => button.action === "worldMap");
  assert(worldMapButton, "World Map button geometry is missing");
  await page.evaluate((center) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "worldMasterMenu") {
        // PopupMenu's one parent delegate resolves the source-local release point against its
        // menuItems list. This scenario proves map geometry, not browser pointer mapping; deliver
        // that exact semantic release rather than deriving a point from the row visual's broader
        // animated descendant bounds.
        node.emit("pointertap", {
          pointerId: 1,
          getLocalPosition: () => ({ ...center }),
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
        return;
      }
      if (node?.children) stack.push(...node.children);
    }
    throw new Error("world MasterMenu root is missing");
  }, worldMapButton.center);
  for (let index = 0; index < 200 && (await state()).overlay?.currentWorld === undefined; index++) {
    await advance();
  }
  await advance(1_000);
  snapshot = await state();
  assert.equal(
    snapshot.overlay?.currentWorld,
    "UnderWorld_1-1",
    `Underworld Big Map did not open: menu=${JSON.stringify(snapshot.menu)} ` +
      `overlay=${JSON.stringify(snapshot.overlay)} errors=${errors.join(" | ") || "none"}`,
  );
  assert.equal(
    snapshot.overlay.currentMarkerVisible,
    false,
    "the source 4x4 Big Map must not invent an Underworld marker",
  );
  assert.equal(
    snapshot.overlay.hiddenWorlds.length,
    16,
    "all sixteen ordinary worlds should remain masked in this fresh Underworld fixture",
  );
  await page.screenshot({
    path: path.join(outputDir, "iphone-underworld-big-map.png"),
    timeout: 120_000,
  });
  await page.keyboard.press("Escape");
  for (let index = 0; index < 200 && (await state()).overlay !== null; index++) await advance();
  snapshot = await state();
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.overlay, null, "Big Map did not return to the Underworld field");
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("underworld-background-alignment: PASS (local map aligned; Big Map opens without marker)");
} finally {
  await browser.close();
}
