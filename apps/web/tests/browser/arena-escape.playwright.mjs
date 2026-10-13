


import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_DISPLAY_MODE === "ipad" ? "ipad" : "iphone";
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
  await page.addInitScript(({ displayMode }) => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode,
      textResolutionMode: "modern",
      sound: 0.25,
      music: 0.5,
    }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_NAME__ = "World_1-2";
    window.__DIB_TEST_POI_NAME__ = "Capital_City";
    window.__DIB_TEST_WORLD_SEED__ = 0x4152454e;
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 5;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [100, 100],
      members: [{ shortType: "Cockatrice", level: 100 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 3,
      monsterPartyLevels: [100],
      silver: 2_000,
      gold: 1_000,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: {},
      licenseType: "Novice",
      tutorialFlags: ["FirstShop", "FirstCharacterDisplay", "Tutorial0", "Tutorial1"],
    };
  }, { displayMode });

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((amount) => window.advanceTime(amount), ms);
    await page.waitForTimeout(1);
  };
  const waitFor = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`);
  };
  const visibleBounds = (label) => page.evaluate((wanted) => {
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
        return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, label);
  const chatDiagnostics = () => page.evaluate(() => {
    const result = [];
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "guildQuestChat") {
        const parents = [];
        for (let current = node; current; current = current.parent) {
          parents.push({
            label: current.label ?? null,
            visible: current.visible,
            renderable: current.renderable,
            destroyed: current.destroyed,
          });
        }
        result.push({
          visible: node.visible,
          renderable: node.renderable,
          destroyed: node.destroyed,
          tapListeners: node.listenerCount?.("pointertap") ?? 0,
          finishVisible: node.children?.find((child) => child.label === "guildQuestChatFinish")?.visible,
          parents,
        });
      }
      if (node?.children) stack.push(...node.children);
    }
    return result;
  });
  // Row taps are routed by the menu container that owns them (rows are `eventMode: "none"`),
  // so emitting on the row node itself reaches no listener at all.
  const invokeLabel = (label) => tapPixiLabel(page, label);
  const clickLabel = async (label) => {
    const bounds = await visibleBounds(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    await page.mouse.click(canvas.x + bounds.x + bounds.w / 2, canvas.y + bounds.y + bounds.h / 2);
  };
  const dismissGuildChat = async (description) => {
    for (let pageIndex = 0; pageIndex < 32 &&
        await visibleBounds("guildQuestChat") !== null; pageIndex++) {
      // Pixi clamps one oversized ticker delta. Feed the source 0.5s gate normal-sized updates so
      // this really advances 550ms instead of four attempts accumulating only ~400ms.
      for (let tick = 0; tick < 22; tick++) await advance(25);
      await invokeLabel("guildQuestChat");
      await advance(25);
    }
    assert.equal(await visibleBounds("guildQuestChat"), null, `${description} did not dismiss`);
  };
  const enterSavedGame = async () => {
    await page.waitForFunction(() => typeof window.render_game_to_text === "function");
    await waitFor((value) => value.startup?.phase === "title", "title did not become interactive");
    await page.keyboard.press("Enter");
    let startup = await waitFor(
      (value) => ["save-select", "pick-dragon"].includes(value.startup?.phase) || value.mode === "town",
      "configured local game did not open",
    );
    if (startup.startup?.phase === "save-select") {
      await advance(250);
      const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
      assert(slot?.enabled, `save slot 1 unavailable: ${JSON.stringify(startup.startup)}`);
      const canvas = await page.locator("canvas").first().boundingBox();
      assert(canvas, "save picker canvas is unavailable");
      const geometry = await stageGeometry(page, canvas);
      const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
      await page.mouse.click(point.x, point.y);
      startup = await waitFor(
        (value) => value.startup?.phase === "pick-dragon" || value.mode === "town",
        "configured save did not open",
      );
    }
    if (startup.startup?.phase === "pick-dragon") await page.keyboard.press("1");
    await waitFor((value) => value.mode === "town", "Capital City did not open");
    await advance(12_000);
  };

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await enterSavedGame();
  await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await waitFor(async () => await visibleBounds("guildQuestChat") !== null, "Arena greeting did not open");
  await dismissGuildChat("Arena greeting");
  await waitFor((value) => value.overlay?.open === true && value.overlay?.buttons, "Arena menu did not open");
  await invokeLabel("arena:battle");
  await waitFor(
    async () => await visibleBounds("sourceBlackSceneFade:arena-challenge-battle") !== null,
    "Arena challenge did not begin its source black scene fade",
  );
  await waitFor(
    async (value) => value.mode === "battle" && await visibleBounds("guildQuestChat") !== null,
    "Arena challenger chat did not open over battle",
  );
  let snapshot = await state();
  for (let index = 0; index < 2_400; index++) {
    if (
      snapshot.presentation?.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible === true &&
      snapshot.activeActorId === "t0m0:Cockatrice" &&
      snapshot.abilityButtons?.some(({ abilityPath }) => abilityPath === "Utility.Escape")
    ) break;
    if (await visibleBounds("guildQuestChat") !== null) {
      // The Arena transition's challenger chat is already mounted after `mode` flips to battle;
      // BattleNode then mounts its own encounter start chat after scene construction. Service both
      // source-owned dialogs instead of treating the first non-startEvent transient as playable.
      await dismissGuildChat("Arena battle chat");
    } else {
      if (snapshot.activePopup === "encounterChat") {
        throw new Error(`BattleNode owns a hidden encounter chat: ${JSON.stringify(await chatDiagnostics())}`);
      }
      await advance(25);
    }
    snapshot = await state();
  }
  assert.equal(snapshot.encounter.allowRetreat, false, "Arena toolbar retreat must remain disabled");
  const licenseBefore = snapshot.player.licenseType;
  const canvas = await page.locator("canvas").first().boundingBox();
  assert(canvas, "Pixi canvas is unavailable");
  const geometry = await stageGeometry(page, canvas);
  const escape = snapshot.abilityButtons?.find(({ abilityPath }) => abilityPath === "Utility.Escape");
  assert(escape, `Cockatrice Utility.Escape was unavailable: ${JSON.stringify(snapshot)}`);
  const escapeCss = geometry.toCss(escape.center);
  await page.mouse.click(escapeCss.x, escapeCss.y);
  await waitFor(
    (value) => value.presentation?.state === "retreated" && value.activePopup === "retreated",
    "Arena Escape did not reach the generic Retreat presentation",
  );
  await advance(550);
  await clickLabel("popupButton:Ok");
  snapshot = await waitFor(
    (value) => value.mode === "battle" && value.presentation?.state === "retreated" && value.activePopup === null,
    "Arena Escape did not preserve the source state-6 dead-end after popup dismissal",
  );
  assert.equal(snapshot.player.licenseType, licenseBefore, "Arena Escape changed the license");
  assert(snapshot.overlay == null, "Arena Escape invented ArenaLost or town UI");
  assert.equal(await visibleBounds("arena"), null, "Arena menu replaced the dead battle");
  assert.deepEqual(errors, []);

  await advance(25);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dataUrl = await page.locator("canvas").evaluate((node) => node.toDataURL("image/png"));
  mkdirSync("output", { recursive: true });
  writeFileSync("output/arena-escape-source-stall.png", Buffer.from(dataUrl.split(",")[1], "base64"));

  // The bug is live-process faithful but not allowed to brick the port: the pre-battle local town
  // checkpoint remains durable and is restored when a fresh process loads the slot.
  await page.reload({ waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await enterSavedGame();
  snapshot = await state();
  assert.equal(snapshot.mode, "town");
  assert.equal(snapshot.player.licenseType, licenseBefore);
  assert.deepEqual(errors, []);
  console.log("arena-escape: PASS");
} finally {
  await browser.close();
}
