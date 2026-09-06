

import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

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
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_NAME__ = "World_1-1";
    window.__DIB_TEST_POI_NAME__ = "1-1_Zone_Change_1";
    window.__DIB_TEST_WORLD_SEED__ = 11;
    window.__DIB_TEST_WORLD_PARTY__ = { size: 1, battingOrderSize: 1, levelRange: [100, 100] };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 100,
      monsterPartyLevels: [100],
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"],
    };
  });

  await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173", {
    waitUntil: "domcontentloaded",
  });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);

  for (let index = 0; index < 600 && (await state()).startup?.phase !== "title"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  assert.equal((await state()).startup?.phase, "title");
  await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const snapshot = await state();
    if (snapshot.startup?.phase === "save-select" || snapshot.mode === "world") break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  if ((await state()).startup?.phase === "save-select") await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const snapshot = await state();
    if (snapshot.mode === "world" && !snapshot.locked && snapshot.chrome?.menu?.functional) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }

  let snapshot = await state();
  assert.equal(snapshot.world, "World_1-1");
  assert.equal(snapshot.currentPoi, "1-1_Zone_Change_1");
  const exit = snapshot.pois.find((poi) => poi.name === "1-1_Zone_Change_1");
  assert(exit && snapshot.selectablePois.includes(exit.name), "Northern Alvalon exit is not selectable");

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  const geometry = await stageGeometry(page, box);
  const click = geometry.toCss({ x: exit.position.x + 8, y: exit.position.y });
  await page.mouse.click(click.x, click.y);

  for (let index = 0; index < 120; index++) {
    snapshot = await state();
    if (
      snapshot.world === "World_1-2" &&
      snapshot.chrome?.mapName?.visible &&
      snapshot.chrome.mapName.text === "Northern Alvalon"
    ) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }

  snapshot = await state();
  assert.equal(snapshot.world, "World_1-2");
  assert.equal(snapshot.currentPoi, "1-2_Zone_Change_1");
  assert.equal(snapshot.chrome.mapName.text, "Northern Alvalon");
  assert.equal(
    snapshot.chrome.mapName.placement,
    "upper-inset",
    "slideEndAtPOIName: did not select source mode 1 for the lower-half arrival",
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("world-nameplate-placement: PASS (Northern Alvalon southern slide uses upper-inset)");
} finally {
  await browser.close();
}
