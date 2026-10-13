// Opt-in regression for a save whose current Tournament index is past the shipped catalog.
// The TournamentFinished PlotGameFlowEvent must render and own input above TournamentNode before
// its `back:` finish selector performs the source town-return scene replace.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/tournament-finished");
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
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x46494e49;
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 82;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1", "HaraldDefeated"];
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 100,
      monsterPartyLevels: [100, 100, 100, 100, 100],
      silver: 2_000,
      gold: 1_000,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: {},
      licenseType: "Grandmaster",
      tutorialFlags: [
        "FirstShop", "FirstCharacterDisplay", "Tutorial0", "Tutorial1", "TournamentTutorial",
      ],
      tournament: { schemaVersion: 1, index: 12, round: 0, status: 0 },
    };
  });
  await page.goto(url);
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((delta) => window.advanceTime(delta), ms);
  const waitFor = async (predicate, description, timeoutMs = 60_000) => {
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
    throw new Error(
      `${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`,
    );
  };
  const boundsForLabel = (label) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable || current.worldAlpha <= 0) return false;
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
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "Pixi canvas is unavailable");
    await page.mouse.click(canvas.x + bounds.x + bounds.w / 2, canvas.y + bounds.y + bounds.h / 2);
  };

  let snapshot = await waitFor(
    (value) => value.startup?.phase === "title",
    "startup title did not become interactive",
  );
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" || value.mode === "town",
    "startup did not begin the local world session",
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.startup?.phase === "pick-dragon",
      "intro plot did not open the starter picker",
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  snapshot = await waitFor((value) => value.mode === "town", "town did not open");
  await advance(1_000);
  snapshot = await state();
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  await advance(12_000);

  await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await waitFor(
    async () => await boundsForLabel("guildQuestChatFinish") !== null,
    "Arena greeting did not open",
  );
  await advance(550);
  await tapPixiLabel(page, "guildQuestChat");
  await waitFor(
    (value) => value.overlay?.open === true && Array.isArray(value.overlay?.buttons),
    "Arena menu did not open",
  );
  await tapPixiLabel(page, "arena:tournament");
  await waitFor(
    async (value) => value.overlay?.kind === "tournament" &&
      await boundsForLabel("sourceBlackSceneFade:arena-tournament") === null,
    "terminal Tournament scene did not finish entering",
  );

  await advance(50); // Render the newly mounted Plot before reading Pixi worldAlpha.
  const plot = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "sourceNewGamePlot") {
        const bounds = node.getBounds();
        return {
          parentLabel: node.parent?.label ?? null,
          worldAlpha: (() => {
            let alpha = 1;
            for (let current = node; current; current = current.parent) alpha *= current.alpha;
            return alpha;
          })(),
          bounds: { w: bounds.width, h: bounds.height },
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  });
  assert(plot, "TournamentFinished plot was not mounted");
  assert.equal(plot.parentLabel, "tournament", "TournamentFinished plot is behind TournamentNode");
  assert(plot.worldAlpha > 0 && plot.bounds.w > 0 && plot.bounds.h > 0, "ending plot is not visible");
  await advance(800);
  const png = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL("image/png"));
  fs.writeFileSync(
    path.join(outputDir, "tournament-finished.png"),
    Buffer.from(png.split(",", 2)[1], "base64"),
  );

  // A real pointer tap after the source two-second early-finish gate must reach the Plot blocker.
  await advance(1_250);
  await clickLabel("sourceNewGamePlot");
  snapshot = await waitFor((value) => value.mode === "town" && value.overlay?.kind !== "tournament", "ending plot did not return to town");
  assert.equal(snapshot.overlay, null);
  assert.deepEqual(errors, [], errors.join("\n"));
  console.log("tournament-finished: PASS");
} finally {
  await browser.close();
}
