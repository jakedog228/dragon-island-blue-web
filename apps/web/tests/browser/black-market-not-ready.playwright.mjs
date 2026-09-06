


import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_BLACK_MARKET_DISPLAY_MODE ?? "ipad";
const worldName = requiredEnv("DIB_BLACK_MARKET_WORLD");
const startPoiName = requiredEnv("DIB_BLACK_MARKET_START_POI");
const blackMarketPoiName = requiredEnv("DIB_BLACK_MARKET_POI");
const partyShortType = requiredEnv("DIB_BLACK_MARKET_PARTY_SHORT_TYPE");

assert(
  displayMode === "iphone" || displayMode === "ipad",
  `DIB_BLACK_MARKET_DISPLAY_MODE must be "iphone" or "ipad", got ${JSON.stringify(displayMode)}`,
);
assert.notEqual(
  startPoiName,
  blackMarketPoiName,
  "DIB_BLACK_MARKET_START_POI must differ from DIB_BLACK_MARKET_POI so normal navigation is exercised",
);


const expectedTitle = "Not Yet Ready";
const expectedMessage =
  "Please try back in a minute or two. If you have no internet access you will need to " +
  "restore it before you can use this.";
const expectedCloseButton = "Ok";

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  const nonIdempotentRequests = [];

  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    const requested = request.url();
    if (!requested.startsWith(url) && !requested.startsWith("data:") && !requested.startsWith("blob:")) {
      externalRequests.push(requested);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      nonIdempotentRequests.push(`${request.method()} ${requested}`);
    }
  });

  await page.addInitScript(({ displayMode, worldName, startPoiName, partyShortType }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));

    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x424c4b4d;
    window.__DIB_TEST_WORLD_NAME__ = worldName;
    window.__DIB_TEST_POI_NAME__ = startPoiName;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [1, 1],
      members: [{ shortType: partyShortType, level: 1, currentHp: 1 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 6,
      monsterPartyLevels: [1],
      silver: 2_000,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: { [partyShortType]: 1 },
      licenseType: "Apprentice",
      tutorialFlags: [],
    };
    window.__DIB_TEST_SESSION_RESTARTS__ = true;

    // Deliberately NOT setting `__DIB_TEST_BLACK_MARKET_SERVICE_READY__`: this scenario asserts the
    // shipped default. Any window.open here would be a defect, so record instead of navigating.
    window.__DIB_BLACK_MARKET_EXTERNAL_OPENS__ = [];
    window.open = (...args) => {
      window.__DIB_BLACK_MARKET_EXTERNAL_OPENS__.push(args);
      return null;
    };
  }, { displayMode, worldName, startPoiName, partyShortType });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, "missing Pixi canvas");
  const geometry = await stageGeometry(page, canvasBox);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (milliseconds = 25) => {
    await page.evaluate((value) => window.advanceTime?.(value), milliseconds);
    await page.waitForTimeout(1);
  };
  const waitFor = async (predicate, description, iterations = 600) => {
    for (let index = 0; index < iterations; index += 1) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance();
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}`);
  };
  /** Every visible text string currently on the stage, in traversal order. */
  const visibleTexts = () => page.evaluate(() => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const found = [];
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (typeof node?.text === "string" && visible(node)) found.push(node.text);
      if (node?.children) stack.push(...node.children);
    }
    return found;
  });
  const clickLabel = async (label) => {
    const center = await page.evaluate((wanted) => {
      const visible = (node) => {
        for (let current = node; current; current = current.parent) {
          if (!current.visible || !current.renderable) return false;
        }
        return true;
      };
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === wanted && visible(node)) {
          const bounds = node.getBounds();
          const screen = window.__PIXI_APP__.renderer.screen;
          return {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
            screenWidth: screen.width,
            screenHeight: screen.height,
          };
        }
        if (node?.children) stack.push(...node.children);
      }
      return null;
    }, label);
    assert(center, `missing visible Pixi node ${label}`);
    const point = {
      x: canvasBox.x + center.x * canvasBox.width / center.screenWidth,
      y: canvasBox.y + center.y * canvasBox.height / center.screenHeight,
    };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await advance(16);
    await page.mouse.up();
    await advance(16);
  };
  /** Clicks a popup button by its rendered label text. */
  const clickPopupButton = async (text) => {
    const center = await page.evaluate((wanted) => {
      const visible = (node) => {
        for (let current = node; current; current = current.parent) {
          if (!current.visible || !current.renderable) return false;
        }
        return true;
      };
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.text === wanted && visible(node)) {
          const target = node.parent ?? node;
          const bounds = target.getBounds();
          const screen = window.__PIXI_APP__.renderer.screen;
          return {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
            screenWidth: screen.width,
            screenHeight: screen.height,
          };
        }
        if (node?.children) stack.push(...node.children);
      }
      return null;
    }, text);
    assert(center, `missing visible popup button ${JSON.stringify(text)}`);
    const point = {
      x: canvasBox.x + center.x * canvasBox.width / center.screenWidth,
      y: canvasBox.y + center.y * canvasBox.height / center.screenHeight,
    };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await advance(16);
    await page.mouse.up();
    await advance(16);
  };
  const clickPoi = async (poiName) => {
    const snapshot = await state();
    const poi = snapshot.pois.find((candidate) => candidate.name === poiName);
    assert(poi, `missing rendered POI ${poiName}`);
    assert(
      poiName === snapshot.currentPoi || snapshot.selectablePois.includes(poiName),
      `POI ${poiName} is not selectable through the normal world route`,
    );
    const transform = snapshot.sceneTransform;
    const point = geometry.toCss({
      x: transform.position.x + (poi.position.x - transform.pivot.x) * transform.scale,
      y: transform.position.y + (poi.position.y - transform.pivot.y) * transform.scale,
    });
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await advance(16);
    await page.mouse.up();
    await advance(16);
  };
  const saveSnapshot = () => page.evaluate(() => {
    const session = window.__DIB_TEST_RESTART_SESSION__;
    if (!session?.snapshot) throw new Error("deterministic save snapshot hook is unavailable");
    return session.snapshot();
  });
  const saveHealth = () => page.evaluate(() => {
    const session = window.__DIB_TEST_RESTART_SESSION__;
    if (!session?.saveHealth) throw new Error("deterministic save-health hook is unavailable");
    return session.saveHealth();
  });

  await waitFor(
    (value) => value.startup?.phase === "title",
    "title did not become interactive",
  );
  await page.keyboard.press("Enter");
  let startup = await waitFor(
    (value) =>
      (value.mode === "world" && value.currentPoi === startPoiName && !value.locked && !value.walking) ||
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon",
    "deterministic world fixture did not become interactive",
  );
  if (startup.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    startup = await waitFor(
      (value) =>
        (value.mode === "world" && value.currentPoi === startPoiName && !value.locked && !value.walking) ||
        value.startup?.phase === "pick-dragon",
      "new-game plot did not reach starter selection",
    );
  }
  if (startup.startup?.phase === "pick-dragon") {
    assert(startup.startup.intro?.choices?.[0]?.shortType, "starter selection has no first choice");
    await page.keyboard.press("1");
    await waitFor(
      (value) => value.mode === "world" && value.currentPoi === startPoiName && !value.locked && !value.walking,
      "starter selection did not open the deterministic world fixture",
    );
  }

  await clickPoi(blackMarketPoiName);
  let townEntry = await waitFor(
    (value) => value.mode === "town" && value.town?.name === blackMarketPoiName,
    "Black Market town did not open through normal navigation",
  );
  await advance(1_000);
  townEntry = await state();
  for (let pageIndex = 0; townEntry.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await clickLabel("guildQuestChat");
    townEntry = await state();
  }
  assert.equal(townEntry.overlay, null, "town entry presentation remained above the Black Market fixture");
  await advance(12_000);


  const settledTown = await waitFor(
    (value) => value.mode === "town" &&
      value.town?.name === blackMarketPoiName &&
      value.locked === false &&
      value.walking === false &&
      value.town.dayNotification === undefined &&
      value.town.buildings.some((building) =>
        building.className === "BlackMarketMenuItem" && building.enabled === true),
    "Black Market town entry did not settle with an enabled building",
  );
  assert.equal(settledTown.town.name, blackMarketPoiName);

  const before = await saveSnapshot();
  const beforeSaveHealth = await saveHealth();

  await clickLabel(`town:${blackMarketPoiName}:menu:BlackMarketMenuItem`);
  const blocked = await waitFor(
    (value) => value.overlay?.kind === "popup" && value.overlay.popups.depth === 1,
    "Black Market not-ready dialog did not open",
  );
  assert.deepEqual(
    blocked.overlay.popups.stack[0].buttons,
    [expectedCloseButton],
    "the not-ready dialog must carry exactly the source OkButtonKey close button",
  );
  assert.equal(blocked.overlay.popups.stack[0].visible, true);
  assert.equal(blocked.overlay.popups.stack[0].dismissed, false);

  const texts = await visibleTexts();
  assert(
    texts.includes(expectedTitle),
    `missing BlackMarketLoadingTitleKey text; visible=${JSON.stringify(texts)}`,
  );
  assert(
    texts.includes(expectedMessage),
    `missing BlackMarketLoadingMessageKey text; visible=${JSON.stringify(texts)}`,
  );
  assert(
    !texts.includes("DEMO CONTENT"),
    "the demo screen appeared while the source blocker is in force",
  );

  // The blocked route has no cards, no image loads, and no external destinations at all.
  assert.deepEqual(
    await page.evaluate(() => window.__DIB_BLACK_MARKET_EXTERNAL_OPENS__),
    [],
    "the not-ready dialog opened an external destination",
  );
  assert.deepEqual(
    externalRequests.filter((requested) => requested.includes("placehold.co")),
    [],
    "the not-ready dialog requested retired-host placeholder imagery",
  );

  await clickPopupButton(expectedCloseButton);
  await waitFor(
    (value) => value.overlay === null,
    "the not-ready dialog did not close through its Ok button",
  );

  // Reopening reproduces it: nothing latches the readiness state off.
  await clickLabel(`town:${blackMarketPoiName}:menu:BlackMarketMenuItem`);
  await waitFor(
    (value) => value.overlay?.kind === "popup" && value.overlay.popups.depth === 1,
    "Black Market not-ready dialog did not reopen",
  );
  await clickPopupButton(expectedCloseButton);
  await waitFor((value) => value.overlay === null, "reopened not-ready dialog did not close");

  await waitFor(
    (value) => value.mode === "town" &&
      value.town?.name === blackMarketPoiName &&
      value.locked === false &&
      value.walking === false &&
      value.town.dayNotification === undefined,
    "town did not settle after the not-ready dialog closed",
  );

  const after = await saveSnapshot();
  assert.deepEqual(after, before, "the not-ready dialog changed durable save state");
  assert.deepEqual(
    await saveHealth(),
    beforeSaveHealth,
    "the not-ready dialog changed observable save health",
  );
  assert.equal(
    nonIdempotentRequests.length,
    0,
    "the not-ready dialog issued a non-idempotent authority/network request",
  );
  assert.deepEqual(errors, [], errors.join(" | "));

  console.log("Black Market not-ready scenario prepared checks passed (browser run is opt-in).", {
    archive: process.env.DIB_CONTENT_ARCHIVE ?? "auto-selected local IPA/ZIP",
    worldName,
    blackMarketPoiName,
    displayMode,
    title: expectedTitle,
    closeButton: expectedCloseButton,
    nonIdempotentRequests: nonIdempotentRequests.length,
  });
  await context.close();
} finally {
  await browser.close();
}

function requiredEnv(name) {
  const value = process.env[name];
  assert(value, `${name} is required for this operator-owned Black Market archive fixture`);
  return value;
}
