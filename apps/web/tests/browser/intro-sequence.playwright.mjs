

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/intro-sequence");
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

const installHarness = async (page, worldDemo, profile) => {
  await page.addInitScript(({ useWorld, playerProfile }) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = useWorld;
    window.__DIB_TEST_WORLD_SEED__ = 17;
    window.__DIB_TEST_BATTLE_SEED__ = 5;
    if (playerProfile !== null) window.__DIB_TEST_PLAYER_PROFILE__ = playerProfile;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
  }, { useWorld: worldDemo, playerProfile: profile ?? null });
};

const assertTransitionShadeGone = async (page, context) => {
  const shade = await page.evaluate(() => {
    let result = null;
    const visit = (node) => {
      if (result === null && node.label === "startupTransitionShade") {
        result = { visible: node.visible, alpha: node.alpha };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return result;
  });
  assert(
    shade === null || shade.visible === false || shade.alpha === 0,
    `${context} remained covered by startup transition shade: ${JSON.stringify(shade)}`,
  );
};

const assertPixiLabelMounted = async (page, label) => {
  const node = await page.evaluate((wanted) => {
    let result = null;
    const visit = (candidate) => {
      if (result === null && candidate.label === wanted) {
        const bounds = candidate.getBounds();
        result = {
          visible: candidate.visible,
          renderable: candidate.renderable,
          bounds: { w: bounds.width, h: bounds.height },
        };
      }
      for (const child of candidate.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return result;
  }, label);
  assert(
    node !== null && node.visible && node.renderable && node.bounds.w > 0 && node.bounds.h > 0,
    `${label} is not mounted/drawable: ${JSON.stringify(node)}`,
  );
};

const assertTutorialOkCentered = async (page) => {
  const bounds = await page.evaluate(() => {
    const result = { background: null, label: null };
    const visit = (node) => {
      if (result.background === null && node.label === "plotTutorialOkBackground") {
        const box = node.getBounds();
        result.background = { x: box.x, y: box.y, w: box.width, h: box.height };
      }
      if (result.label === null && node.label === "plotTutorialOkLabel") {
        const box = node.getBounds();
        result.label = { x: box.x, y: box.y, w: box.width, h: box.height };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(globalThis.__PIXI_APP__.stage);
    return result;
  });
  assert(bounds.background && bounds.label, `missing tutorial OK geometry: ${JSON.stringify(bounds)}`);
  const center = (box) => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
  const backgroundCenter = center(bounds.background);
  const labelCenter = center(bounds.label);
  assert(
    Math.abs(backgroundCenter.x - labelCenter.x) < 1 &&
      Math.abs(backgroundCenter.y - labelCenter.y) < 1,
    `tutorial OK text is not centered: ${JSON.stringify({ backgroundCenter, labelCenter, bounds })}`,
  );
};

const attachHelpers = async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(1);
  };
  const waitFor = async (predicate, description, frames = 600) => {
    for (let i = 0; i < frames; i++) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(
      `${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`,
    );
  };
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox);
  const clickLabel = async (label) => {
    const point = await page.evaluate((wanted) => {
      let result = null;
      const visit = (node) => {
        if (result === null && node.label === wanted && node.visible && node.renderable) {
          const bounds = node.getBounds();
          result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return result;
    }, label);
    assert(point, `missing visible Pixi node ${label}`);
    await page.mouse.click(canvasBox.x + point.x, canvasBox.y + point.y);
  };
  return { state, advance, waitFor, clickLabel, canvasBox, errors };
};

try {
  // Fresh source route: NewGame plot -> four-choice starter -> auto-enter First_City.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await installHarness(page, true);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  let helpers = await attachHelpers(page);
  let { state, advance, waitFor, clickLabel } = helpers;

  await waitFor((value) => value.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.startup?.phase === "new-game-plot",
    "NewGame did not begin with Plot.NewGame",
  );
  assert.equal(snapshot.startup.intro.image, "plot_start1.png");
  assert.equal(snapshot.startup.intro.scrollMs % 1_000, 0);
  await advance(750);
  await page.screenshot({
    path: path.join(outputDir, "01-new-game-plot.png"),
    timeout: 120_000,
  });
  await advance(1_300);
  await page.keyboard.press("Enter");

  snapshot = await waitFor(
    (value) => value.startup?.phase === "pick-dragon",
    "NewGame plot did not chain into PickDragon",
  );
  assert.deepEqual(snapshot.startup.intro.choices.map(({ shortType }) => shortType), [
    "BlueBabyDragon",
    "RedBabyDragon",
    "WhiteBabyDragon",
    "GoldBabyDragon",
  ]);
  assert(snapshot.startup.intro.choices.every((choice, index, all) =>
    index === 0 || choice.x > all[index - 1].x));
  const pickerVisual = await page.evaluate(() => {
    const labels = [];
    const visit = (node) => {
      if (typeof node.label === "string" &&
          (node.label === "sourcePickDragon" || node.label.startsWith("starter:"))) {
        const bounds = node.getBounds();
        labels.push({
          label: node.label,
          visible: node.visible,
          renderable: node.renderable,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
        });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return labels;
  });
  assert.equal(
    pickerVisual.filter(({ label }) => label.startsWith("starter:")).length,
    4,
    `starter visuals are not mounted: ${JSON.stringify(pickerVisual)}`,
  );
  assert(
    pickerVisual.every(({ visible, renderable, bounds }) =>
      visible && renderable && bounds.w > 0 && bounds.h > 0),
    `starter visuals are not drawable: ${JSON.stringify(pickerVisual)}`,
  );
  await page.screenshot({
    path: path.join(outputDir, "02-pick-dragon.png"),
    timeout: 120_000,
  });
  await page.keyboard.press("1");

  snapshot = await waitFor(
    (value) => value.mode === "town" && value.town?.name === "First_City" && !value.locked,
    "fresh game did not auto-enter First_City",
  );
  assert.equal(snapshot.currentPoi, "First_City");
  assert.equal(snapshot.party.length, 1);
  assert.equal(snapshot.party[0].shortType, "BlueBabyDragon");
  assert.equal(snapshot.party[0].level, 1);

  // Leslie's first-town chat may sit above the still-running source exit flash.
  snapshot = await waitFor(
    (value) => value.town?.flashing?.key === "flashTownExit",
    "Leave Town did not begin FlashForeverAction",
  );
  assert.equal(snapshot.town.flashing.running, true);
  assert.equal(snapshot.town.flashing.strength, 2);
  const townArrivalOverlayOrder = await page.evaluate(() => {
    const byLabel = new Map();
    const visit = (node) => {
      if (typeof node.label === "string") byLabel.set(node.label, node);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    const host = byLabel.get("worldNotificationHost");
    const namePlate = byLabel.get("townNamePlate");
    const automatic = byLabel.get("directorAutomaticPopupLayer");
    const chat = byLabel.get("guildQuestChat");
    const banner = byLabel.get("townDayNotification");
    const hasAncestor = (node, ancestor) => {
      for (let current = node?.parent; current; current = current.parent) {
        if (current === ancestor) return true;
      }
      return false;
    };
    return {
      complete: Boolean(host && namePlate && automatic && chat && banner),
      namePlateParentIsHost: namePlate?.parent === host,
      automaticParentIsHost: automatic?.parent === host,
      bannerParentIsHost: banner?.parent === host,
      chatWithinAutomaticLayer: hasAncestor(chat, automatic),
      z: {
        namePlate: namePlate?.zIndex,
        automatic: automatic?.zIndex,
        banner: banner?.zIndex,
      },
    };
  });
  assert.deepEqual(
    townArrivalOverlayOrder,
    {
      complete: true,
      namePlateParentIsHost: true,
      automaticParentIsHost: true,
      bannerParentIsHost: true,
      chatWithinAutomaticLayer: true,
      z: { namePlate: 0, automatic: 1, banner: 999 },
    },
    `town dialogue is not between the arrival plaque and CCNotifications banner: ` +
      JSON.stringify(townArrivalOverlayOrder),
  );
  await page.screenshot({
    path: path.join(outputDir, "02b-town-dialogue-over-nameplate.png"),
    timeout: 120_000,
  });
  for (let pageIndex = 0; pageIndex < 10; pageIndex++) {
    if ((await state()).overlay?.kind !== "townEnterChat") break;
    await advance(525);
    await clickLabel("guildQuestChat");
    await advance(25);
  }
  assert.notEqual((await state()).overlay?.kind, "townEnterChat", "town intro chat did not close");
  await waitFor(
    (value) => value.town?.dayNotification?.visible !== true,
    "town day notification did not finish",
  );
  await waitFor(
    (value) => value.town?.flashing?.opacity > 0.9,
    "Leave Town flash never reached its bright phase",
  );
  await page.screenshot({
    path: path.join(outputDir, "03-first-city-leave-flash.png"),
    timeout: 120_000,
  });
  // CCBlink/FlashForeverAction affects drawing alpha, not the manual Cocos hit test. Prove the
  // port remains tappable at the dim trough rather than timing the click for the on phase.
  // Browser stepping samples the float32 action clock at frame boundaries and need not land on
  // the single exact-zero instant of the continuous triangle.
  await waitFor(
    (value) => value.town?.flashing?.opacity <= 0.05,
    "Leave Town flash never reached its dim trough",
  );
  await clickLabel("town:First_City:exit");
  snapshot = await waitFor(
    (value) => value.mode === "world" && value.tutorial?.key === "Tutorial2",
    "leaving town did not present fieldMovement Tutorial2",
  );
  assert.equal(snapshot.tutorial.image, "fieldMovement.png");
  assert.equal(snapshot.tutorial.pageCount, 1);
  assert.equal(snapshot.tutorial.okReady, true, "Tutorial2 OK retained an input delay");
  await advance(1_025);
  await assertTutorialOkCentered(page);
  await advance(25);
  await page.screenshot({
    path: path.join(outputDir, "04-field-movement.png"),
    timeout: 120_000,
  });
  await page.keyboard.press("Enter");
  await waitFor(
    (value) => value.mode === "world" && value.tutorial === undefined,
    "field movement tutorial did not close",
  );

  // Loading the just-saved slot must discard field position and rebuild the last town entered.
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  helpers = await attachHelpers(page);
  ({ state, advance, waitFor, clickLabel } = helpers);
  await waitFor((value) => value.startup?.phase === "title", "reload title did not become interactive");
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "occupied save did not open save selection",
  );
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, `saved slot 1 is unavailable: ${JSON.stringify(snapshot.startup)}`);
  // buildSaveSelectScene publishes diagnostics before transitionTo's 0.25s fade-from-black has
  // finished; wait out the source transition shade so it cannot consume this pointer.
  await advance(300);
  await clickLabel("sourcePopupButton:slot-1");
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.town?.name === "First_City",
    "save load resumed on the field instead of auto-entering lastTown",
  );
  assert.equal(snapshot.currentPoi, "First_City");
  await context.close();

  // First battle presents Tutorial0 after the source two-second showAIPopup delay.
  const battleProfile = {
    heroLevel: 12,
    monsterPartyLevels: [12, 12, 12, 12, 12, 12],
    silver: 1_000,
    gold: 100,
    captureCards: { 1: 2, 2: 0, 3: 0 },
    highestCapturedLevels: { KemetGod: 12 },
    spiritReadiness: 0,
    spiritTierLevels: {},
    tutorialFlags: [],
  };
  const battleContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const battlePage = await battleContext.newPage();
  await installHarness(battlePage, false, battleProfile);
  await battlePage.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(battlePage);
  const battle = await attachHelpers(battlePage);
  await battle.waitFor(
    (value) => value.startup?.phase === "title",
    "battle fixture title did not become interactive",
  );
  await battlePage.keyboard.press("Enter");
  snapshot = await battle.waitFor(
    (value) => value.mode === "battle" && value.tutorial?.key === "Tutorial0",
    "first battle did not gate on Tutorial0",
  );
  assert.equal(snapshot.tutorial.image, "battleTutorial1.png");
  assert.equal(snapshot.tutorial.okReady, true, "Tutorial0 OK retained an input delay");
  await battle.advance(1_025);
  snapshot = await battle.waitFor(
    (value) => value.tutorial?.key === "Tutorial0" &&
      value.tutorial?.page === 0 &&
      value.tutorial?.entering === false &&
      value.tutorial?.okReady === true,
    "Tutorial0 first frame did not finish its entry/OK sequencing",
  );
  await assertTransitionShadeGone(battlePage, "Tutorial0");
  await assertPixiLabelMounted(battlePage, "plotBackground:battleTutorial1.png");
  await assertTutorialOkCentered(battlePage);
  await battle.advance(25);
  await battlePage.screenshot({
    path: path.join(outputDir, "05-battle-tutorial-1.png"),
    timeout: 120_000,
  });
  await battlePage.keyboard.press("Enter");
  snapshot = await battle.waitFor(
    (value) => value.tutorial?.key === "Tutorial0" && value.tutorial.page === 1,
    "Tutorial0 did not advance to its second frame",
  );
  assert.equal(snapshot.tutorial.image, "battleTutorial2.png");
  await battle.advance(25);
  await assertPixiLabelMounted(battlePage, "plotBackground:battleTutorial2.png");
  await battlePage.screenshot({
    path: path.join(outputDir, "06-battle-tutorial-2.png"),
    timeout: 120_000,
  });
  await battlePage.keyboard.press("Enter");
  await battle.waitFor(
    (value) => value.mode === "battle" && value.tutorial === null,
    "first battle did not continue after Tutorial0",
  );
  assert.deepEqual(battle.errors, []);
  await battleContext.close();

  // The next BattleNode sees Tutorial0 claimed and presents Tutorial1's catch frame instead.
  const catchContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const catchPage = await catchContext.newPage();
  await installHarness(catchPage, false, {
    ...battleProfile,
    tutorialFlags: ["Tutorial0"],
  });
  await catchPage.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(catchPage);
  const catchBattle = await attachHelpers(catchPage);
  await catchBattle.waitFor(
    (value) => value.startup?.phase === "title",
    "second-battle fixture title did not become interactive",
  );
  await catchPage.keyboard.press("Enter");
  snapshot = await catchBattle.waitFor(
    (value) => value.mode === "battle" && value.tutorial?.key === "Tutorial1",
    "second battle did not present Tutorial1",
  );
  assert.equal(snapshot.tutorial.image, "catchTutorial.png");
  assert.equal(snapshot.tutorial.okReady, true, "Tutorial1 OK retained an input delay");
  await catchBattle.advance(1_025);
  snapshot = await catchBattle.waitFor(
    (value) => value.tutorial?.key === "Tutorial1" &&
      value.tutorial?.entering === false &&
      value.tutorial?.okReady === true,
    "Tutorial1 did not finish its entry/OK sequencing",
  );
  await assertTransitionShadeGone(catchPage, "Tutorial1");
  await assertPixiLabelMounted(catchPage, "plotBackground:catchTutorial.png");
  await assertTutorialOkCentered(catchPage);
  await catchBattle.advance(25);
  await catchPage.screenshot({
    path: path.join(outputDir, "07-catch-tutorial.png"),
    timeout: 120_000,
  });
  await catchPage.keyboard.press("Enter");
  await catchBattle.waitFor(
    (value) => value.mode === "battle" && value.tutorial === null,
    "second battle did not continue after Tutorial1",
  );
  assert.deepEqual(catchBattle.errors, []);
  await catchContext.close();

  assert.deepEqual(helpers.errors, []);
  console.log("intro sequence scenario passed");
} finally {
  await browser.close();
}
