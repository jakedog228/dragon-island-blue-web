

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
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    // First arrival is source-suppressed; begin on the authored exit so this contract stays focused
    // on the cardinal world replacement rather than replaying the separately covered story route.
    window.__DIB_TEST_POI_NAME__ = "1-1_Zone_Change_1";
    window.__DIB_TEST_WORLD_SEED__ = 11;
    // High levels source-skip ordinary level-1 encounters, making the route deterministic.
    window.__DIB_TEST_WORLD_PARTY__ = { size: 3, battingOrderSize: 3, levelRange: [100, 100] };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 100,
      monsterPartyLevels: [100, 100, 100],
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"],
    };
  });
  await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173", { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  const geometry = await stageGeometry(page, box);
  for (let index = 0; index < 600 && (await state()).startup?.phase !== "title"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
  await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const current = await state();
    if (current.startup?.phase === "save-select" || current.mode === "world") break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  if ((await state()).startup?.phase === "save-select") await page.keyboard.press("Enter");
  for (let index = 0; index < 600 && (await state()).mode !== "world"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  for (let index = 0; index < 600; index++) {
    const current = await state();
    if (current.mode === "world" && !current.locked && !current.walking && current.chrome?.menu?.functional) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }

  let snapshot = await state();
  assert.equal(snapshot.world, "World_1-1");
  assert.equal(snapshot.currentPoi, "1-1_Zone_Change_1");
  assert(snapshot.blockedPois.every((name) => !snapshot.selectablePois.includes(name)));
  const partyIdentity = snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType }));

  snapshot = await state();
  const exit = snapshot.pois.find((poi) => poi.name === "1-1_Zone_Change_1");
  assert(exit && snapshot.selectablePois.includes(exit.name));
  const exitPoint = geometry.toCss({ x: exit.position.x + 8, y: exit.position.y });
  await page.mouse.click(exitPoint.x, exitPoint.y);
  // The destination scene can request map/POI textures that have not yet materialized from the
  // in-memory archive. Give those browser promises one real event-loop turn before driving the
  // deterministic ticker, matching the custom-world compatibility scenario.
  await page.waitForTimeout(50);
  for (let index = 0; index < 400 && (await state()).world !== "World_1-2"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  snapshot = await state();
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.currentPoi, "1-2_Zone_Change_1");
  assert.equal(snapshot.slidePosition.x, 0);
  assert(snapshot.slidePosition.y < 0, `incoming world did not start above: ${snapshot.slidePosition.y}`);
  assert.equal(snapshot.locked, true);

  await advance(1100);
  snapshot = await state();
  assert.deepEqual(snapshot.slidePosition, { x: 0, y: 0 });
  assert.equal(snapshot.locked, false);
  assert.equal(snapshot.chrome.mapName.visible, true);
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    partyIdentity,
    "cardinal transition replaced the trip party",
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("world-zone-transition: PASS (gating, target entry suppression, cardinal slide, party identity)");
} finally {
  await browser.close();
}
