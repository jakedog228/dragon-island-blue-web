




import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_DISPLAY_MODE === "ipad" ? "ipad" : "iphone";
const outputName = displayMode === "iphone" ? "store-cflow" : `store-cflow-${displayMode}`;
const outputDir = path.resolve(import.meta.dirname, `../../../../output/${outputName}`);
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
  await page.addInitScript((activeDisplayMode) => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: activeDisplayMode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x53544f52;
    window.__DIB_TEST_WORLD_NAME__ = "World_1-2";
    window.__DIB_TEST_POI_NAME__ = "Capital_City";
    // The Apprentice challenge win chat: the authored `conditions.chats` for Westguard's
    // CharacterDisplayMenuItem. Without it the house has no icon, no name plate, and no touch
    // surface at all.
    window.__DIB_TEST_DIALOGS_SEEN__ = ["HaraldDefeated"];
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 15;
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
  }, displayMode);
  await page.goto(url);
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((delta) => window.advanceTime(delta), ms);
  const waitFor = async (predicate, description, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (await predicate(snapshot)) {
        await advance(25);
        return await state();
      }
      await advance(25);
      await page.waitForTimeout(1);
    }
    throw new Error(`${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`);
  };
  const boundsFor = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    let match = null;
    const isVisible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && isVisible(node)) {
        const bounds = node.getBounds();
        match = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      }
      if (node?.children) stack.push(...node.children);
    }
    return match;
  }, label);
  /** The reflection sprite's own texture cut, for checking the source crop rather than a squash. */
  const reflectionCutFor = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    let match = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && node.texture !== undefined) {
        const { frame, source } = node.texture;
        match = {
          frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
          source: { w: source.width, h: source.height },
          scaleX: node.scale.x,
          scaleY: node.scale.y,
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return match;
  }, label);
  const canvasPoint = async (point) => {
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    return { x: canvas.x + point.x, y: canvas.y + point.y };
  };
  const clickLabel = async (label) => {
    const bounds = await boundsFor(label);
    assert(bounds, `missing ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    const left = Math.max(canvas.x, canvas.x + bounds.x);
    const right = Math.min(canvas.x + canvas.width, canvas.x + bounds.x + bounds.w);
    const top = Math.max(canvas.y, canvas.y + bounds.y);
    const bottom = Math.min(canvas.y + canvas.height, canvas.y + bounds.y + bounds.h);
    assert(right > left && bottom > top, `${label} has no on-canvas visible area`);
    await page.mouse.click((left + right) / 2, (top + bottom) / 2);
  };
  const capture = async (name) => {
    const png = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL("image/png"));
    fs.writeFileSync(path.join(outputDir, name), Buffer.from(png.split(",", 2)[1], "base64"));
  };

  await waitFor((value) => value.startup?.phase === "title", "startup title did not open");
  await page.keyboard.press("Enter");
  let startup = await waitFor(
    (value) =>
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" ||
      value.mode === "town",
    "startup did not begin the world session",
  );
  if (startup.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    startup = await waitFor(
      (value) => value.startup?.phase === "pick-dragon",
      "starter picker did not open",
    );
  }
  if (startup.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  startup = await waitFor((value) => value.mode === "town", "town did not open");
  await advance(1_000);
  startup = await state();
  for (let index = 0; startup.overlay?.kind === "townEnterChat" && index < 20; index += 1) {
    await advance(550);
    await clickLabel("guildQuestChat");
    startup = await state();
  }
  await advance(12_000);
  await waitFor(
    async () => await page.evaluate(() => typeof window.__DIB_TEST_OPEN_STORE__ === "function"),
    "World fixture did not install the Store test route",
  );

  const westguard = await state();
  assert.equal(westguard.currentPoi, "Capital_City");
  const heroBuilding = westguard.town?.buildings.find(
    ({ className }) => className === "CharacterDisplayMenuItem",
  );
  assert(
    heroBuilding?.revealed,
    `HaraldDefeated did not reveal the Westguard Hero house: ${JSON.stringify(westguard.town)}`,
  );
  assert(
    heroBuilding.enabled,
    `Westguard Hero house is revealed but not interactive: ${JSON.stringify(westguard.town)}`,
  );
  // `flashTownExit` is still unclaimed, so the exit keeps the flash sequence: revealing the Hero
  // house makes FirstGemFlash eligible, not active.
  assert.notEqual(
    westguard.town?.flashing?.target,
    heroBuilding.sourceIndex,
    "FirstGemFlash started before flashTownExit was claimed",
  );
  await clickLabel(`town:Capital_City:building:${heroBuilding.sourceIndex}`);
  await waitFor(
    (value) => value.overlay?.config === "HeroManagement",
    "Westguard Hero house did not open Character management",
  );
  await capture("westguard-hero-open.png");
  await page.keyboard.press("Escape");
  await waitFor((value) => value.overlay === null, "Character management did not close");

  await page.evaluate(() => { void window.__DIB_TEST_OPEN_STORE__(); });
  let snapshot = await waitFor((value) => value.overlay?.category === 0, "Store did not open");
  assert.equal(snapshot.overlay.cards.filter(({ visible }) => visible).length, 5);
  assert(snapshot.overlay.cards[1].x > 0, "adjacent category is not offset to the right");
  assert(await boundsFor("store:reflection:0"), "selected category reflection is missing");





  const itemsCut = await reflectionCutFor("store:reflection:0");
  assert(itemsCut, "Items category reflection has no texture");
  assert.equal(itemsCut.frame.w, itemsCut.source.w, "Items reflection was cut horizontally");
  assert.equal(
    itemsCut.frame.h,
    Math.round(itemsCut.source.h * 0.75),
    `Items reflection kept ${itemsCut.frame.h} of ${itemsCut.source.h} rows, not roundf(h * 0.75)`,
  );
  assert.equal(
    itemsCut.frame.y,
    itemsCut.source.h - itemsCut.frame.h,
    "Items reflection kept the top of the frame instead of the bottom",
  );
  assert(itemsCut.scaleY < 0, "Items reflection is not flipped");
  assert.equal(
    Math.abs(itemsCut.scaleY),
    itemsCut.scaleX,
    "Items reflection is not uniformly scaled",
  );
  assert.equal(itemsCut.scaleX, 0.5, "Items reflection was fitted instead of drawn at native size");
  await capture("root-initial.png");

  const itemCount = (player) => Object.values(player.items)
    .reduce((total, count) => total + count, 0);
  const beforeStorePurchase = await state();
  assert.equal(beforeStorePurchase.player.silver, 2_000);
  assert.equal(itemCount(beforeStorePurchase.player), 0);



  await clickLabel("store:selection");
  snapshot = await waitFor(
    (value) => value.overlay?.category === 1 && value.overlay?.selectedId === "card-1",
    "Items category did not open on Card",
  );
  await clickLabel("store:buy");
  await waitFor(
    async () => (await boundsFor("popupButton:Purchase")) !== null,
    "Card purchase confirmation did not open",
  );
  await advance(550);
  const purchaseName = await boundsFor("store:purchase:name");
  const purchaseDescription = await boundsFor("store:purchase:description");
  const purchaseQuantity = await boundsFor("store:purchase:quantity");
  const purchaseArrows = await boundsFor("store:purchase:quantity:arrows");
  const purchaseQuantityValue = await boundsFor("store:purchase:quantity:value");
  const purchaseUp = await boundsFor("store:quantity:plus");
  const purchaseDown = await boundsFor("store:quantity:minus");
  const purchasePrice = await boundsFor("store:purchase:price");
  for (const [label, bounds] of Object.entries({
    purchaseName,
    purchaseDescription,
    purchaseQuantity,
    purchaseArrows,
    purchaseQuantityValue,
    purchaseUp,
    purchaseDown,
    purchasePrice,
  })) assert(bounds, `Card confirmation omitted ${label}`);
  const leftTolerance = 2;
  assert(
    Math.abs(purchaseName.x - purchaseDescription.x) <= leftTolerance &&
      Math.abs(purchaseName.x - purchaseQuantity.x) <= leftTolerance &&
      Math.abs(purchaseName.x - purchasePrice.x) <= leftTolerance,
    `Card confirmation content is not source-left-aligned: ${JSON.stringify({
      purchaseName,
      purchaseDescription,
      purchaseQuantity,
      purchasePrice,
    })}`,
  );
  assert(
    purchaseName.y < purchaseDescription.y &&
      purchaseDescription.y < purchaseQuantity.y &&
      purchaseQuantity.y < purchasePrice.y,
    "Card confirmation is not ordered name, description, quantity, price",
  );
  assert(
    purchaseArrows.x + purchaseArrows.w <= purchaseQuantityValue.x + leftTolerance,
    "How Many label is not to the right of the source arrow column",
  );
  assert(purchaseUp.y < purchaseDown.y, "increment arrow is not above decrement arrow");
  await capture("card-purchase-confirmation.png");
  await clickLabel("popupButton:Purchase");
  snapshot = await waitFor(
    async () => (await boundsFor("dungeonLootPage")) !== null,
    "Committed Card receipt did not open LootPageProvider",
  );
  assert.equal(snapshot.player.silver, 1_950, "Card debit did not settle before presentation");
  // Usables live in the typed inventory and are projected through captureCards; `player.items`
  // intentionally contains only the legacy-compatible Egg/Gem families.
  assert.equal(snapshot.player.captureCards[1], 1, "Card grant did not settle before presentation");
  assert.equal(itemCount(snapshot.player), 0);
  await capture("card-committed-loot.png");
  await clickLabel("popupButton:Take All");
  await waitFor(
    async () => (await boundsFor("dungeonLootPage")) === null,
    "Card receipt did not dismiss",
  );



  await waitFor(
    (value) => value.overlay?.category === 1 && value.overlay?.selectedId === "card-1",
    "Store did not restore after Card receipt dismissal",
  );
  await clickLabel("store:card:3");
  await waitFor(
    (value) => value.overlay?.selectedIndex === 3 && Math.abs(value.overlay?.visualIndex - 3) < 0.01,
    "Gem card did not center",
  );
  await clickLabel("store:buy");
  await waitFor(
    async () => (await boundsFor("popupButton:Purchase")) !== null,
    "Gem purchase confirmation did not open",
  );
  await advance(550);
  const emptyGemDescription = await boundsFor("store:purchase:description");
  assert(emptyGemDescription, "Gem confirmation dropped the source's empty description node");
  await capture("gem-purchase-confirmation.png");
  await clickLabel("popupButton:Purchase");
  snapshot = await waitFor(
    async () => (await boundsFor("dungeonLootPage")) !== null,
    "Committed Gem receipt did not open LootPageProvider",
  );
  assert.equal(snapshot.player.silver, 1_850, "Gem debit did not settle before presentation");
  assert.equal(itemCount(snapshot.player), 1, "Gem grant did not settle before presentation");
  await capture("gem-committed-loot.png");
  await clickLabel("popupButton:Take All");
  await waitFor(
    async () => (await boundsFor("dungeonLootPage")) === null,
    "Gem receipt did not dismiss",
  );

  const settledStorePurchase = await state();
  await advance(250);
  assert.deepEqual((await state()).player, settledStorePurchase.player, "render refresh replayed Store rewards");
  // The source back button first leaves the selected aisle for the category coverflow, then closes
  // the Store when pressed from that root.
  await clickLabel("store:close");
  await waitFor((value) => value.overlay?.category === 0, "Store did not return to its category root");
  await clickLabel("store:close");
  await waitFor((value) => value.overlay === null, "Store did not close after receipt dismissal");
  await page.evaluate(() => { void window.__DIB_TEST_OPEN_STORE__(); });
  snapshot = await waitFor((value) => value.overlay?.category === 0, "Store did not reopen");
  assert.deepEqual(snapshot.player, settledStorePurchase.player, "Store reopen replayed committed rewards");

  await clickLabel("store:card:1");
  snapshot = await waitFor(
    (value) => value.overlay?.selectedIndex === 1 && value.overlay?.visualIndex > 0,
    "side category did not recenter through easing",
  );
  assert(snapshot.overlay.visualIndex < 1, "side-card selection jumped instead of easing");
  await capture("root-easing.png");
  await waitFor(
    (value) => Math.abs(value.overlay?.visualIndex - 1) < 0.01,
    "root selection did not settle",
  );
  await clickLabel("store:selection");
  snapshot = await waitFor(
    (value) => value.overlay?.category === 2 && value.overlay?.cards?.length === 2,
    "centered category did not open",
  );
  assert.equal(snapshot.overlay.stockCount, 2);
  assert(snapshot.overlay.cards[1].visible, "adjacent Egg stock is hidden");
  await capture("eggs-initial.png");

  const selectedBounds = await boundsFor("store:buy");
  assert(selectedBounds, "selected Egg card bounds are unavailable");
  const center = await canvasPoint({
    x: selectedBounds.x + selectedBounds.w / 2,
    y: selectedBounds.y + selectedBounds.h * 0.35,
  });
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 90, center.y, { steps: 3 });
  snapshot = await state();
  assert(
    snapshot.overlay.selectedIndex > 0 && snapshot.overlay.selectedIndex < 1,
    `drag did not produce a continuous fractional index: ${snapshot.overlay.selectedIndex}`,
  );
  await capture("eggs-dragging.png");
  await page.mouse.up();
  snapshot = await waitFor(
    (value) => value.overlay?.selectedIndex === 1,
    "release did not snap to the nearest bounded card",
  );
  await waitFor(
    (value) => Math.abs(value.overlay?.visualIndex - 1) < 0.01,
    "dragged selection did not settle",
  );
  await capture("eggs-settled.png");

  // Store purchase keeps the Store scene alive, but native ItemPurchase closes confirmation and
  // puts New Items above it. Take All then calls Player.addItem -> Egg.destroyFromPickup, so the
  // reel must mount immediately over that still-open Store without a Shop-close gesture.
  await clickLabel("store:buy");
  await waitFor(
    async () => (await boundsFor("popupButton:Purchase")) !== null,
    "Golden Egg purchase confirmation did not open",
  );
  await clickLabel("popupButton:Purchase");
  await waitFor(
    async () => (await boundsFor("dungeonLootItem:0:monsterEgg")) !== null,
    "Golden Egg did not enter the source New Items receipt",
  );
  assert.equal(await boundsFor("eggHatch:background"), null, "Egg hatched before Take All");
  await advance(250);
  await capture("gold-egg-new-items.png");
  await clickLabel("popupButton:Take All");
  await waitFor(
    async () => (await boundsFor("eggHatch:background")) !== null,
    "Golden Egg hatch did not override the still-open Store after Take All",
  );
  assert(await boundsFor("store:close"), "Store was disposed instead of remaining under the hatch");
  await advance(250);
  await capture("gold-egg-hatch-over-store.png");

  assert.deepEqual(errors, []);
  console.log(`store-cflow: PASS (${outputDir})`);
} finally {
  await browser.close();
}
