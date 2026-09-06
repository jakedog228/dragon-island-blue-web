


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

async function captureCanvas(page, fileName) {
  const dataUrl = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL("image/png"));
  mkdirSync("output", { recursive: true });
  writeFileSync(`output/${fileName}`, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

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
    window.__DIB_TEST_WORLD_SEED__ = 0x544f5552;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [100, 100],
      members: [
        { shortType: "Cockatrice", level: 100 },
      ],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 20,
      monsterPartyLevels: [100],
      silver: 2_000,
      gold: 1_000,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: {},
      licenseType: "Apprentice",
      tutorialFlags: [
        "FirstShop",
        "FirstCharacterDisplay",
        "Tutorial0",
        "Tutorial1",
        "TournamentTutorial",
      ],
      tournament: { schemaVersion: 1, index: 0, round: 0, status: 0 },
    };
  }, { displayMode });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");

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
    throw new Error(
      `${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`,
    );
  };
  const boundsForLabel = (label) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    let match = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        match = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      }
      if (node?.children) stack.push(...node.children);
    }
    return match;
  }, label);
  const textForLabel = (label) => page.evaluate((wanted) => {
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
        const textNodes = [node];
        let text = "";
        while (textNodes.length > 0) {
          const textNode = textNodes.pop();
          if (typeof textNode?.text === "string") text = textNode.text + text;
          if (textNode?.children) textNodes.push(...textNode.children);
        }
        return text;
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, label);
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    await page.mouse.click(canvas.x + bounds.x + bounds.w / 2, canvas.y + bounds.y + bounds.h / 2);
  };
  // Row taps are routed by the menu container that owns them (rows are `eventMode: "none"`),
  // so emitting on the row node itself reaches no listener at all.
  const invokeLabel = (label) => tapPixiLabel(page, label);

  let snapshot = await waitFor(
    (value) => value.startup?.phase === "title",
    "startup title did not become interactive",
  );
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "pick-dragon" || value.mode === "town",
    "startup did not open the configured local world",
  );
  if (snapshot.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  await waitFor((value) => value.mode === "town", "Capital City did not open");
  await advance(1_000);
  snapshot = await state();
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex += 1) {
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  await advance(12_000);

  assert.equal(
    await page.evaluate(() => typeof window.__DIB_TEST_OPEN_ARENA__),
    "function",
    "Arena test seam was not installed",
  );
  await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await waitFor(
    async () => await boundsForLabel("guildQuestChatFinish") !== null,
    "Arena greeting did not open",
  );
  await advance(550);
  await invokeLabel("guildQuestChat");
  await waitFor(
    (value) => value.overlay?.open === true && value.overlay?.buttons,
    "Arena menu did not open",
  );
  await invokeLabel("arena:tournament");
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "tournament",
    "Tournament bracket did not open",
  );
  assert.equal(snapshot.overlay.round, 0, "Tournament bracket did not start at round zero");
  assert.equal(snapshot.overlay.status, 0, "Tournament bracket was not idle before its first battle");
  const primary = snapshot.overlay.buttons.find(({ action }) => action === "primary");
  assert(primary?.enabled, "Tournament primary battle action was not enabled");
  assert(snapshot.overlay.buttons.some(({ action }) => action === "rewards"), "Tournament Rewards action missing");
  assert(snapshot.overlay.buttons.some(({ action }) => action === "back"), "Tournament Back action missing");

  await invokeLabel("tournament:primary");
  await waitFor(
    async (value) => value.mode === "battle" && await boundsForLabel("guildQuestChatFinish") !== null,
    "Tournament challenger chat did not open over the battle",
  );
  await advance(550);
  await invokeLabel("guildQuestChat");
  snapshot = await waitFor(
    (value) => value.mode === "battle" && value.presentation?.state !== "building",
    "Tournament battle did not become playable",
  );
  assert.equal(snapshot.encounter.allowRetreat, false, "toolbar retreat must remain disabled in Tournament");
  const expectedTournament = structuredClone(snapshot.player.tournament);
  assert.equal(expectedTournament.round, 0, "Escape fixture did not begin at round zero");
  assert.equal(expectedTournament.status, 0, "Escape fixture unexpectedly entered loss/progress state");
  assert(Number.isFinite(expectedTournament.timeLast), "Tournament start did not set timeLast");
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "Pixi canvas is unavailable");
  const geometry = await stageGeometry(page, canvasBox);
  let ready = snapshot;
  for (let i = 0; i < 1_600; i += 1) {
    if (
      ready.presentation?.state === "awaitingPlayerChoice" &&
      ready.activeActorId === "t0m0:Cockatrice" &&
      ready.abilityButtons?.some(({ abilityPath }) => abilityPath === "Utility.Escape")
    ) break;
    await advance(25);
    ready = await state();
  }
  assert.equal(ready.activeActorId, "t0m0:Cockatrice", `Cockatrice did not receive a choice: ${JSON.stringify(ready.presentation)}`);
  await advance(250);
  ready = await state();
  const escape = ready.abilityButtons.find(({ abilityPath }) => abilityPath === "Utility.Escape");
  assert(escape, `shipped Cockatrice Utility.Escape carrier was absent: ${JSON.stringify(ready.abilityButtons)}`);
  const escapeCss = geometry.toCss(escape.center);
  await page.mouse.click(escapeCss.x, escapeCss.y);
  snapshot = await waitFor(
    (value) => value.presentation?.state === "retreated" && value.activePopup === "retreated",
    "Utility.Escape did not reach the source retreat presentation",
  );
  assert.equal(snapshot.player.tournament.round, expectedTournament.round);
  assert.equal(snapshot.player.tournament.status, expectedTournament.status);
  assert.equal(snapshot.player.tournament.timeLast, expectedTournament.timeLast);
  await advance(550);
  await clickLabel("popupButton:Ok");
  await waitFor(
    async () => await textForLabel("guildQuestChatText") === "TournamentLostChatKey",
    "Tournament Escape omitted the source-specific TournamentLost fallback chat",
  );
  // ChainedTextLabel ignores an immediate tap during its source 0.5s entry fade.
  await advance(550);
  assert.equal(
    await textForLabel("guildQuestChatText"),
    "TournamentLostChatKey",
    "Tournament Escape did not preserve Cocoa's missing-localization fallback",
  );
  await advance(1000 / 60);
  await page.waitForTimeout(50);
  await captureCanvas(page, "tournament-escape-chat.png");
  await clickLabel("guildQuestChat");
  await waitFor((value) => value.mode === "town", "Tournament Escape did not return to town");
  await advance(1_000);
  snapshot = await state();
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    if (await boundsForLabel("guildQuestChat") === null) break;
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.locked === false &&
      value.town?.buildings?.length > 0 && value.overlay === null,
    "town return remained covered by a Tournament popup",
  );
  assert.deepEqual(snapshot.player.tournament, expectedTournament, "Escape changed durable Tournament progress");
  await advance(1000 / 60);
  await page.waitForTimeout(50);
  await captureCanvas(page, "tournament-escape-town.png");

  // Reopen the real bracket and exercise the immediate source cooldown rejection. The bracket must
  // still show the same round/status while activation rejects against timeLast.
  await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await waitFor(async () => await boundsForLabel("guildQuestChatFinish") !== null, "Arena greeting did not reopen");
  await advance(550);
  await invokeLabel("guildQuestChat");
  await waitFor((value) => value.overlay?.open === true, "Arena menu did not reopen");
  await invokeLabel("arena:tournament");
  snapshot = await waitFor((value) => value.overlay?.kind === "tournament", "Tournament bracket did not reopen");
  assert.equal(snapshot.overlay.round, expectedTournament.round);
  assert.equal(snapshot.overlay.status, expectedTournament.status);
  assert(snapshot.overlay.timeToNext > 0, "Escape removed the 24-hour Tournament cooldown");
  await advance(250);
  await invokeLabel("tournament:primary");
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "tournament" && value.overlay.popups?.depth === 1,
    "immediate Tournament restart did not present the cooldown rejection",
  );
  assert.deepEqual(snapshot.overlay.popups.stack[0].buttons, ["Ok"]);
  const cooldownText = await textForLabel("notificationPopupHost");
  assert.match(cooldownText ?? "", /Daily Tournament/i);
  assert.match(cooldownText ?? "", /once a day/i);
  await advance(1000 / 60);
  await page.waitForTimeout(50);
  await captureCanvas(page, "tournament-escape-cooldown.png");
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("tournament-escape: PASS");
} finally {
  await browser.close();
}
