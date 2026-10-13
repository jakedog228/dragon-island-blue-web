// Opt-in external Devtools master-menu/UI proof. Always launch muted.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
assert(archive, "Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");
const mod = resolve(repositoryRoot, "examples/mods/dist/devtools.dibmod");
assert(existsSync(mod), "Run pnpm mods:examples before this scenario.");
const dungeonMode = process.env.DIB_DEVTOOLS_DUNGEON === "1";
const fixedMode = process.env.DIB_DEVTOOLS_FIXED === "1";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // This Offline scenario needs no authority service running beside the client.
  await page.route("**/api/game/readiness", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ready: false, installedLogicPackIds: [] }),
  }));
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ useDungeon, useFixed }) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1"];
    if (useFixed) {
      window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
      window.__DIB_TEST_POI_NAME__ = "1-1_Turtorial_Hut_1";
      window.__DIB_TEST_GUILD_QUEST_NAMES__ = [];
    }
    if (useDungeon) {
      window.__DIB_TEST_WORLD_SEED__ = 7;
      window.__DIB_TEST_DUNGEON_SEED__ = 3;
      window.__DIB_TEST_DUNGEON_ROUTE__ = {
        typeName: "Cave",
        sourceFile: "Dungeon_1.plist",
        floor: 1,
      };
    } else {
      window.__DIB_TEST_PLAYER_PROFILE__ = {
        heroLevel: 20,
        monsterPartyLevels: [20, 20, 20, 20, 20],
        silver: 2_000,
        gold: 1_000,
        captureCards: { 1: 0, 2: 0, 3: 0 },
        highestCapturedLevels: {},
        licenseType: "Apprentice",
        tutorialFlags: ["FirstShop", "Tutorial0", "Tutorial1"],
      };
    }
  }, { useDungeon: dungeonMode, useFixed: fixedMode });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const archiveInput = page.locator('input[name="asset-archive"]');
  await archiveInput.waitFor({ state: "attached", timeout: 120_000 });
  await archiveInput.setInputFiles(archive);
  await page.locator('input[name="mod-archives"]').setInputFiles(mod);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ state: "visible", timeout: 120_000 }).catch(async (error) => {
      throw new Error(`Offline gate did not validate: ${await page.locator("body").innerText()}`, { cause: error });
    });
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const waitForState = async (predicate, description, iterations = 180) => {
    for (let index = 0; index < iterations; index += 1) {
      const snapshot = await state();
      if (predicate(snapshot)) {
        await advance(25);
        return await state();
      }
      await advance(25);
      if (index % 10 === 0) await page.waitForTimeout(10);
    }
    throw new Error(
      `${description}; errors: ${errors.join(" | ") || "none"}; state: ${JSON.stringify(await state())}`,
    );
  };
  const boundsForLabel = (label) => page.evaluate((wanted) => {
    const root = globalThis.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const matches = [];
    const visit = (node) => {
      if (node.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        matches.push({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return matches.at(-1) ?? null;
  }, label);
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "game canvas has no bounding box");
    const left = Math.max(canvas.x, canvas.x + bounds.x);
    const right = Math.min(canvas.x + canvas.width, canvas.x + bounds.x + bounds.w);
    const top = Math.max(canvas.y, canvas.y + bounds.y);
    const bottom = Math.min(canvas.y + canvas.height, canvas.y + bounds.y + bounds.h);
    assert(right > left && bottom > top, `${label} has no on-canvas visible area`);
    await page.mouse.click((left + right) / 2, (top + bottom) / 2);
    await advance(25);
  };
  const waitForLabel = async (label, present, description, iterations = 180) => {
    for (let index = 0; index < iterations; index += 1) {
      const bounds = await boundsForLabel(label);
      if ((bounds !== null) === present) return bounds;
      await advance(25);
      if (index % 10 === 0) await page.waitForTimeout(10);
    }
    throw new Error(`${description}; errors: ${errors.join(" | ") || "none"}`);
  };
  const textForLabel = (label) => page.evaluate((wanted) => {
    const root = globalThis.__PIXI_APP__?.stage;
    let result = null;
    const visit = (node) => {
      if (node.label === wanted && typeof node.text === "string") result = node.text;
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return result;
  }, label);

  await waitForState(
    (value) => value.startup?.phase === "title",
    "startup title did not become interactive",
    2400,
  );
  await page.keyboard.press("Enter");
  let snapshot = await waitForState(
    (value) => value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" || value.mode === "world" ||
        value.mode === "town" || value.mode === "dungeon",
    "title did not continue into a save",
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.startup?.phase === "pick-dragon",
      "new-game plot did not reach starter selection",
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  snapshot = await waitForState(
    (value) => value.mode === "world" || value.mode === "town" || value.mode === "dungeon",
    "starter selection did not reach gameplay",
    300,
  );
  if (dungeonMode && snapshot.mode !== "dungeon") {
    snapshot = await waitForState(
      (value) => value.mode === "dungeon",
      "configured dungeon route did not replace the startup world",
      600,
    );
  }
  for (let index = 0; index < 20 && snapshot.overlay?.kind === "townEnterChat"; index += 1) {
    await page.keyboard.press("Enter");
    await advance(50);
    snapshot = await state();
  }
  if (!dungeonMode && snapshot.mode === "town") {
    snapshot = await waitForState(
      (value) => value.mode === "town" && value.overlay === null && value.town?.exitEnabled,
      "startup town did not become interactive",
    );
    await advance(1_500);
  }
  for (let index = 0; index < 10 && snapshot.tutorial !== undefined; index += 1) {
    await page.keyboard.press("Enter");
    await advance(100);
    snapshot = await state();
  }
  for (let index = 0; index < 160 &&
      (snapshot.chrome?.heroXp?.expanded || snapshot.chrome?.heroXp?.moving); index += 1) {
    await advance(25);
    snapshot = await state();
  }
  if (snapshot.mode === "dungeon") {
    snapshot = await waitForState(
      (value) => value.mode === "dungeon" && value.started === true,
      "dungeon did not finish its entry lifecycle",
      600,
    );
    const catchQuestClose = await boundsForLabel("catchQuestClose");
    if (catchQuestClose !== null) {
      await clickLabel("catchQuestClose");
      snapshot = await waitForState(
        (value) => value.popups?.persistent?.depth === 0,
        "capture challenge did not close",
      );
    }
    for (let index = 0; index < 4 && snapshot.floorDetectionChat !== undefined; index += 1) {
      await page.keyboard.press("Enter");
      await advance(250);
      snapshot = await state();
    }
    assert.equal(snapshot.floorDetectionChat, undefined, "floor-entry chat retained input");
  }

  await page.keyboard.press("Escape");
  snapshot = await waitForState(
    (value) => value.menu?.config === "MasterMenu",
    "Escape did not open the master menu",
  );
  const devtoolsButton = snapshot.menu.buttons.find(({ action }) => action === "devtools");
  assert(devtoolsButton?.enabled, `Devtools button is missing or disabled: ${JSON.stringify(snapshot.menu)}`);
  assert(!snapshot.menu.columns.flat().some(({ label }) => label === "Devtools"),
    "Devtools leaked into the source Options/menu item model instead of remaining an external button");
  await clickLabel("worldMenu:devtools");
  assert(await boundsForLabel("devtoolsContent"), "Devtools popup content did not mount");

  const requiredControls = [
    "devtools:noBattleDelays:off",
    "devtools:noBattleDelays:on",
    "devtools:speedUp:on",
    "devtools:unlockLocations:on",
    "devtools:unlockShop:on",
    "devtools:activateFixedEncounters:on",
  ];
  for (const label of requiredControls) assert(await boundsForLabel(label), `missing Devtools control ${label}`);

  snapshot = await state();
  assert.deepEqual(snapshot.codeMods?.devtools?.features, {
    noBattleDelays: false,
    speedUp: false,
    unlockLocations: false,
    unlockShop: false,
    activateFixedEncounters: false,
    speedMultiplier: 3,
  });
  assert.equal(
    await page.evaluate(() => localStorage.getItem("dev.dragonislandblue.devtools.settings.v1")),
    null,
    "fresh Devtools defaults were unexpectedly persisted",
  );
  await clickLabel("devtools:noBattleDelays:on");
  await clickLabel("devtools:speedUp:on");
  assert.equal(await page.evaluate(() => globalThis.__PIXI_APP__.ticker.speed), 3);
  await clickLabel("devtools:unlockLocations:on");
  snapshot = await state();
  if (snapshot.mode === "dungeon") {
    assert(snapshot.rooms.some(({ explored }) => !explored),
      "dungeon fixture has no durable hidden room for the reveal proof");
    assert.equal(snapshot.renderedRoomIds.length, snapshot.rooms.length,
      `not every dungeon room rendered: ${JSON.stringify(snapshot.renderedRoomIds)}`);
  } else {
    assert(Object.values(snapshot.poiStates).every((value) => value !== 3),
      `locked overworld POIs remain: ${JSON.stringify(snapshot.poiStates)}`);
  }
  await clickLabel("devtools:unlockShop:on");
  await clickLabel("devtools:activateFixedEncounters:on");
  snapshot = await state();
  assert.deepEqual(snapshot.codeMods?.devtools?.features, {
    noBattleDelays: true,
    speedUp: true,
    unlockLocations: true,
    unlockShop: true,
    activateFixedEncounters: true,
    speedMultiplier: 3,
  });
  assert.deepEqual(
    await page.evaluate(() => JSON.parse(localStorage.getItem(
      "dev.dragonislandblue.devtools.settings.v1",
    ))),
    { noBattleDelays: true, speedUp: true, unlockLocations: true, unlockShop: true },
  );
  const screenshotDirectory = resolve(repositoryRoot, "output/offline-devtools");
  mkdirSync(screenshotDirectory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const screenshotPath = resolve(
    screenshotDirectory,
    dungeonMode ? "devtools-dungeon-all-enabled.png" : "devtools-all-enabled.png",
  );
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  let shopScreenshotPath;
  let dungeonScreenshotPath;
  if (fixedMode) {
    await clickLabel("devtools:activateFixedEncounters:off");
    assert.equal((await state()).codeMods.devtools.features.activateFixedEncounters, false);
    await clickLabel("devtools:activateFixedEncounters:on");
    await clickLabel("popupButton:Close");
    await waitForLabel("devtoolsContent", false, "Devtools popup did not close");
    snapshot = await state();
    assert.equal(snapshot.currentPoi, "1-1_Turtorial_Hut_1");
    assert(!snapshot.guildQuests.usableQuestKeys.includes("LiberateTownsQuest"));
    // Mark the destination cleared to cover the short-circuit that originally skipped arrivals.
    await page.evaluate(() => {
      const visit = (node) => {
        if (node.deps?.trip && node.deps?.refreshState) {
          node.deps.refreshState.completedThisRefresh.add("First_City");
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(globalThis.__PIXI_APP__.stage);
    });
    const poi = snapshot.pois.find((point) => point.name === "First_City");
    assert(poi);
    const { stageGeometry } = await import("./stageGeometry.mjs");
    const geometry = await stageGeometry(page, await page.locator("canvas").first().boundingBox());
    const target = geometry.toCss({ x: poi.position.x + 8, y: poi.position.y });
    await page.mouse.click(target.x, target.y);
    snapshot = await waitForState((value) => value.mode === "battle" &&
      value.activePopup === "encounterChat", "inactive quest encounter did not launch", 1000);
    assert.equal(snapshot.encounter.questKey, "LiberateTownsQuest");
    assert.equal(snapshot.encounter.uniqueKey, "RenderableFirst_CityNameKey");
    assert.equal(snapshot.encounter.startChat, "Ralph");
    const fixedScreenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(resolve(screenshotDirectory, "devtools-fixed-encounter.png"), Buffer.from(fixedScreenshot.data, "base64"));
    writeFileSync(resolve(screenshotDirectory, "devtools-fixed-encounter.json"), JSON.stringify(snapshot, null, 2));
  } else if (snapshot.mode === "dungeon") {
    await clickLabel("popupButton:Close");
    await waitForLabel("devtoolsContent", false, "Devtools popup did not close in the dungeon");
    await advance(500);
    const dungeonScreenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    dungeonScreenshotPath = resolve(screenshotDirectory, "devtools-dungeon-all-rooms.png");
    writeFileSync(dungeonScreenshotPath, Buffer.from(dungeonScreenshot.data, "base64"));

    // Revealing a room is only half the feature: the shipped touch arbitration skips unexplored
    // rooms and the session refuses one as a destination, so prove a revealed room can be walked
    // to. Prefer a quiet room so the proof is a room change and not an encounter or a loot popup.
    snapshot = await state();
    const current = snapshot.rooms.find(({ id }) => id === snapshot.currentRoomId);
    assert(current, "dungeon projection has no current room");
    const distanceFromCurrent = (room) =>
      Math.abs(room.x - current.x) + Math.abs(room.y - current.y);
    const candidates = snapshot.rooms
      .filter((room) => !room.explored)
      .sort((left, right) =>
        (left.encounter === undefined ? 0 : 1) - (right.encounter === undefined ? 0 : 1) ||
        (left.treasure === undefined ? 0 : 1) - (right.treasure === undefined ? 0 : 1) ||
        distanceFromCurrent(left) - distanceFromCurrent(right));
    assert(candidates.length > 0, "every dungeon room is already explored; nothing to reveal");
    let travelled;
    for (const room of candidates) {
      const bounds = await boundsForLabel(`dungeonRoom:${room.id}`);
      if (bounds === null) continue;
      const canvas = await page.locator("canvas").first().boundingBox();
      const onCanvas = bounds.x + bounds.w > 0 && bounds.y + bounds.h > 0 &&
        bounds.x < canvas.width && bounds.y < canvas.height;
      if (!onCanvas) continue;
      await clickLabel(`dungeonRoom:${room.id}`);
      for (let index = 0; index < 200; index += 1) {
        snapshot = await state();
        if (snapshot.mode !== "dungeon" || snapshot.currentRoomId === room.id) break;
        await advance(25);
        if (index % 10 === 0) await page.waitForTimeout(10);
      }
      if (snapshot.mode === "dungeon" && snapshot.currentRoomId === room.id) travelled = room;
      break;
    }
    assert(travelled, `tapping a revealed room did not travel to it: ${JSON.stringify(
      candidates.slice(0, 3).map(({ id, x, y }) => ({ id, x, y })),
    )}`);
    assert.equal(
      snapshot.rooms.find(({ id }) => id === travelled.id)?.explored,
      true,
      "arriving in a revealed room did not explore it",
    );
  } else {
    await clickLabel("popupButton:Close");
    await waitForLabel("devtoolsContent", false, "Devtools popup did not close");
    for (let index = 0; index < 180; index += 1) {
      if (await page.evaluate(() => typeof window.__DIB_TEST_OPEN_STORE__ === "function")) break;
      await advance(25);
      if (index % 10 === 0) await page.waitForTimeout(10);
    }
    assert.equal(
      await page.evaluate(() => typeof window.__DIB_TEST_OPEN_STORE__),
      "function",
      "world fixture did not install its Store route",
    );
    const silverBefore = (await state()).player.silver;
    await page.evaluate(() => { void window.__DIB_TEST_OPEN_STORE__(); });
    await waitForState((value) => value.overlay?.category === 0, "Store did not open");
    await advance(1_000);
    await clickLabel("store:selection");
    await waitForState(
      (value) => value.overlay?.category === 1 && value.overlay?.selectedId === "card-1",
      "Store Items category did not select Card",
    );
    assert.equal(await boundsForLabel("store:price:silver"), null,
      "zero-priced Store selection retained its silver price row");
    await clickLabel("store:buy");
    await waitForLabel("popupButton:Purchase", true, "zero-price purchase popup did not open");
    assert.equal(await textForLabel("store:purchase:price:value"), "0");
    await advance(550);
    await clickLabel("popupButton:Purchase");
    await waitForLabel("dungeonLootPage", true, "zero-price Store purchase did not settle");
    assert.equal((await state()).player.silver, silverBefore, "free Store purchase spent silver");
    const shopScreenshot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    shopScreenshotPath = resolve(screenshotDirectory, "devtools-free-shop-receipt.png");
    writeFileSync(shopScreenshotPath, Buffer.from(shopScreenshot.data, "base64"));
  }
  assert.deepEqual(errors, []);
  console.log("offline Devtools menu scenario passed", {
    archive: archive.split(/[\\/]/).at(-1),
    mod: mod.split(/[\\/]/).at(-1),
    mode: snapshot.mode,
    tickerSpeed: 3,
    ...(snapshot.mode === "dungeon"
      ? { renderedRooms: snapshot.renderedRoomIds.length, durableRooms: snapshot.rooms.length }
      : { poiCount: Object.keys(snapshot.poiStates ?? {}).length }),
    screenshot: screenshotPath,
    ...(shopScreenshotPath === undefined ? {} : { shopScreenshot: shopScreenshotPath }),
    ...(dungeonScreenshotPath === undefined ? {} : { dungeonScreenshot: dungeonScreenshotPath }),
  });
} finally {
  await browser.close();
}
