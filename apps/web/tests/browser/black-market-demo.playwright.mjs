// Prepared opt-in Black Market contract. Run once against the maintained custom archive and
// once against an operator-owned original-format archive; both runs use the normal File API gate.
// This is PORT ADAPTATION / DEMO CONTENT, not a browser proof of the retired native service.
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

const preservationImageUrl =
  "https://placehold.co/640x360/png?text=Preservation+Demo";
const communityImageUrl =
  "https://placehold.co/640x360/png?text=Community+Demo";
const exactImageUrls = [preservationImageUrl, communityImageUrl];
const preservationDestinationUrl = "https://example.com/";
const communityDestinationUrl = "https://example.org/";
const exactDestinationUrls = [preservationDestinationUrl, communityDestinationUrl];

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  const imageRequests = [];
  const nonIdempotentRequests = [];
  let failedCommunityImageRequests = 0;

  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (exactImageUrls.includes(request.url())) imageRequests.push(request.url());
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      nonIdempotentRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  // Own the failure deterministically with a quiet decode failure. The other exact URL is allowed
  // to use the operator's normal network path; it may remain loading, load, or fall back.
  await page.route(communityImageUrl, async (route) => {
    failedCommunityImageRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: "not-a-valid-png",
    });
  });

  await page.addInitScript(({ displayMode, worldName, startPoiName, partyShortType }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));

    // Stop real rAF and use the app's existing deterministic ticker bridge.
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

    // This existing deterministic-only hook exposes the complete save snapshot; it does not
    // alter production save semantics or provide a new gameplay route.
    window.__DIB_TEST_SESSION_RESTARTS__ = true;

    // The shipped build blocks this building with the source's `-[BlackMarketMenuItem activate:]`
    // "Not Yet Ready" dialog (`blackMarketAvailability.ts`), which is what `black-market-not-ready`
    // covers. This scenario is specifically about the screen BEHIND that blocker, so it lifts it
    // through the deterministic-harness-only override.
    window.__DIB_TEST_BLACK_MARKET_SERVICE_READY__ = true;

    // Record the production opener without creating a popup or navigating to either example site.
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
    // Yield to asset/image promises; tight virtual-time loops can starve them.
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
  const playerProfileInventoryPartyWorldTrip = (snapshot) => ({
    // Keep the complete player envelope as well as named projections so a future field cannot be
    // accidentally omitted from this mutation proof.
    completeSave: snapshot,
    player: snapshot.player,
    profile: snapshot.player.profile,
    inventory: snapshot.player.profile.inventory,
    party: snapshot.player.party,
    world: snapshot.world,
    trip: {
      worldName: snapshot.world?.worldName,
      currentPoiName: snapshot.world?.currentPoiName,
      refresh: snapshot.world?.refresh,
      poiWins: snapshot.world?.poiWins,
      dayNumber: snapshot.world?.dayNumber,
      everCompletedPois: snapshot.world?.everCompletedPois,
      lastTownName: snapshot.world?.lastTownName,
      visitedTownNames: snapshot.world?.visitedTownNames,
    },
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
  const beforeProjection = playerProfileInventoryPartyWorldTrip(before);
  const beforeSaveHealth = await saveHealth();

  await clickLabel(`town:${blackMarketPoiName}:menu:BlackMarketMenuItem`);
  let overlay = await waitFor(
    (value) => value.overlay?.kind === "black-market-demo" &&
      imageRequests.includes(preservationImageUrl) &&
      imageRequests.includes(communityImageUrl) &&
      value.overlay.imageStatus.community === "fallback",
    "Black Market demo image requests/fallback did not settle",
  );
  assert.deepEqual(overlay.overlay, {
    kind: "black-market-demo",
    adaptation: "DEMO CONTENT",
    cardIds: ["preservation", "community"],
    imageStatus: {
      preservation: overlay.overlay.imageStatus.preservation,
      community: "fallback",
    },
  });
  assert(["loading", "loaded", "fallback"].includes(overlay.overlay.imageStatus.preservation));
  assert.equal(overlay.overlay.imageStatus.community, "fallback");
  assert.equal(failedCommunityImageRequests, 1);
  assert.deepEqual([...new Set(imageRequests)].sort(), [...exactImageUrls].sort());

  await clickLabel("blackMarketDemo:card:community");
  const externalOpens = await page.evaluate(() => window.__DIB_BLACK_MARKET_EXTERNAL_OPENS__);
  assert.deepEqual(externalOpens, [[communityDestinationUrl, "_blank", "noopener,noreferrer"]]);
  assert(
    externalOpens.every(([destination]) => exactDestinationUrls.includes(destination)),
    `external opener escaped the exact destination allowlist: ${JSON.stringify(externalOpens)}`,
  );
  assert.equal(
    context.pages().filter((candidate) => candidate.url().includes("example.com") || candidate.url().includes("example.org")).length,
    0,
    "external example destination opened a browser page",
  );

  await clickLabel("blackMarketDemo:close");
  await waitFor((value) => value.overlay === null, "Black Market demo did not close");

  await clickLabel(`town:${blackMarketPoiName}:menu:BlackMarketMenuItem`);
  overlay = await waitFor(
    (value) => value.overlay?.kind === "black-market-demo" &&
      value.overlay.imageStatus.community === "fallback",
    "Black Market demo did not reopen with deterministic fallback state",
  );
  assert.deepEqual(overlay.overlay.cardIds, ["preservation", "community"]);
  assert.equal(failedCommunityImageRequests, 2);
  await clickLabel("blackMarketDemo:close");
  await waitFor((value) => value.overlay === null, "reopened Black Market demo did not close");

  await waitFor(
    (value) => value.mode === "town" &&
      value.town?.name === blackMarketPoiName &&
      value.locked === false &&
      value.walking === false &&
      value.town.dayNotification === undefined,
    "town entry activity did not remain settled before the after baseline",
  );

  const after = await saveSnapshot();
  const afterProjection = playerProfileInventoryPartyWorldTrip(after);
  assert.deepEqual(
    afterProjection,
    beforeProjection,
    "Black Market open/external-open/close/reopen changed player, profile, inventory, party, world, or trip state",
  );
  const afterSaveHealth = await saveHealth();
  assert.deepEqual(afterSaveHealth, beforeSaveHealth, "Black Market presentation changed observable save health");
  assert.equal(
    nonIdempotentRequests.length,
    0,
    "Black Market presentation issued a non-idempotent authority/network request",
  );
  assert.equal(
    await page.evaluate(() => typeof window.__DIB_TEST_RESTART_SESSION__.snapshot),
    "function",
  );
  assert.deepEqual(errors, [], errors.join(" | "));

  console.log("Black Market demo scenario prepared checks passed (browser run is opt-in).", {
    archive: process.env.DIB_CONTENT_ARCHIVE ?? "auto-selected local IPA/ZIP",
    worldName,
    blackMarketPoiName,
    displayMode,
    imageRequests: [...new Set(imageRequests)],
    failedCommunityImageRequests,
    nonIdempotentRequests: nonIdempotentRequests.length,
    saveHealthUnchanged: true,
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
