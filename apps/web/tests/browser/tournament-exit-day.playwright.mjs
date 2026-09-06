











import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
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
      members: [{ shortType: "Cockatrice", level: 100 }],
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
  // Portraits are labelled `guildQuestPortrait:<file>` and the node only exists when the chat was
  // given one, so the absence of any such label is the whole assertion.
  const visibleLabelsStartingWith = (prefix) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    const found = [];
    while (stack.length > 0) {
      const node = stack.pop();
      if (typeof node?.label === "string" && node.label.startsWith(wanted) && visible(node)) {
        found.push(node.label);
      }
      if (node?.children) stack.push(...node.children);
    }
    return found;
  }, prefix);
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    await page.mouse.click(canvas.x + bounds.x + bounds.w / 2, canvas.y + bounds.y + bounds.h / 2);
  };
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

  // The boot town entry is itself a notifyEnteredTown, so its banner names the baseline day.
  snapshot = await waitFor(
    (value) => typeof value.town?.dayNotification?.day === "number",
    "town entry did not queue its sunrise day banner",
  );
  const baselineDay = snapshot.town.dayNotification.day;
  assert(Number.isInteger(baselineDay) && baselineDay >= 1, `implausible baseline day ${baselineDay}`);

  await advance(1_000);
  snapshot = await state();
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex += 1) {
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  await advance(12_000);

  // --- Report 1: the Arena greeting must carry no portrait -------------------------------------
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
  assert.deepEqual(
    await visibleLabelsStartingWith("guildQuestPortrait"),
    [],
    "the Arena greeting rendered a portrait; Chats.plist has no Arena record, so it has no images",
  );
  await captureCanvas(page, "tournament-exit-day-arena-greeting.png");
  await invokeLabel("guildQuestChat");
  await waitFor(
    (value) => value.overlay?.open === true && value.overlay?.buttons,
    "Arena menu did not open",
  );

  // `My License` runs showChatForLicense: -> showChatDialog:@"ArenaLicenseDescription", also
  // absent from Chats.plist and therefore also portrait-less.
  await invokeLabel("arena:current");
  await waitFor(
    async () => await boundsForLabel("guildQuestChatFinish") !== null,
    "My License chat did not open",
  );
  await advance(550);
  assert.deepEqual(
    await visibleLabelsStartingWith("guildQuestPortrait"),
    [],
    "the ArenaLicenseDescription chat rendered a portrait it has no images entry for",
  );
  await invokeLabel("guildQuestChat");
  await waitFor(
    (value) => value.overlay?.open === true && value.overlay?.buttons,
    "Arena menu did not return after the My License chat",
  );

  // --- Report 2: leaving the bracket must auto-enter the town on a new day ----------------------
  await invokeLabel("arena:tournament");
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "tournament",
    "Tournament bracket did not open",
  );
  assert(
    snapshot.overlay.buttons.some(({ action }) => action === "back"),
    "Tournament Back action missing",
  );
  await advance(250);
  await captureCanvas(page, "tournament-exit-day-bracket.png");

  await invokeLabel("tournament:back");
  snapshot = await waitFor(
    (value) => value.mode === "town" &&
      value.overlay == null &&
      value.town?.dayNotification?.day === baselineDay + 1,
    `Tournament Back did not auto-enter the town on day ${baselineDay + 1}`,
  );
  assert.equal(
    snapshot.town.dayNotification.image,
    "sunrise.png",
    "the Tournament exit banner is not notifyEnteredTown's sunrise notification",
  );
  await advance(1000 / 60);
  await page.waitForTimeout(50);
  await captureCanvas(page, "tournament-exit-day-town.png");

  snapshot = await waitFor(
    (value) => value.mode === "town" && value.locked === false &&
      value.town?.buildings?.length > 0 && value.overlay == null,
    "the town did not become interactive again after the Tournament exit",
  );
  assert.equal(snapshot.town.name, "Capital_City", "the exit landed on the wrong town");

  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("tournament-exit-day: PASS");
} finally {
  await browser.close();
}
