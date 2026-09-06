

import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
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
    window.__DIB_TEST_POI_NAME__ = "1-1_Turtorial_Hut_1";
    window.__DIB_TEST_WORLD_PARTY__ = { size: 6, battingOrderSize: 3, levelRange: [12, 12] };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 12,
      monsterPartyLevels: [12, 12, 12, 12, 12, 12],
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"],
    };
    window.__DIB_TEST_WORLD_SEED__ = 17;
    window.__DIB_TEST_BATTLE_SEED__ = 5;
    // First_City's source fixed encounter is gated by this exact active quest key.
    window.__DIB_TEST_GUILD_QUEST_NAMES__ = ["LiberateTownsQuest"];
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  const geometry = await stageGeometry(page, box);
  for (let i = 0; i < 600 && (await state()).startup?.phase !== "title"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  await page.keyboard.press("Enter");
  for (let i = 0; i < 600; i++) {
    const current = await state();
    if (current.startup?.phase === "save-select" || current.mode === "world") break;
    await advance(25);
  }
  if ((await state()).startup?.phase === "save-select") await page.keyboard.press("Enter");
  for (let i = 0; i < 600 && (await state()).mode !== "world"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  for (let i = 0; i < 600; i++) {
    const current = await state();
    if (
      current.mode === "world" &&
      !current.locked &&
      !current.walking &&
      current.chrome?.menu?.functional &&
      current.guildQuests?.notification === undefined &&
      current.pois?.some(
        (poi) => poi.name === "First_City" && poi.state === 4 && poi.stateVisible && poi.stateAlpha === 1,
      )
    ) break;
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  await advance(1_000);
  await page.waitForTimeout(20);

  let snapshot = await state();
  assert.equal(snapshot.world, "World_1-1");
  assert.equal(snapshot.currentPoi, "1-1_Turtorial_Hut_1");
  assert(snapshot.guildQuests.usableQuestKeys.includes("LiberateTownsQuest"));
  const clickPoiStateSprite = async (poi) => {
    // Use the materialized state sprite rather than the generic POI base center; the source-backed
    // hit region is the shipped flag/arrow bounds and may not overlap a tiny authored base.
    const point = geometry.toCss({ x: poi.position.x + 8, y: poi.position.y });
    await page.mouse.click(point.x, point.y);
  };

  // Start on the authored adjacent hut so First_City is an arrival. Tapping a current state-2
  // town is the source enter-town branch and would never run fixed-populator selection.
  const firstCity = snapshot.pois.find((poi) => poi.name === "First_City" && poi.state === 4);
  assert(firstCity, `Tutorial Hut exposes no unlocked First_City edge: ${JSON.stringify(snapshot.poiStates)}`);
  await clickPoiStateSprite(firstCity);

  for (let i = 0; i < 500 && (await state()).mode !== "battle"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  for (let i = 0; i < 500 && (await state()).activePopup !== "encounterChat"; i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  snapshot = await state();
  assert.equal(snapshot.mode, "battle", `fixed encounter did not launch: ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.presentation.state, "startEvent", JSON.stringify(snapshot));
  assert.equal(snapshot.activePopup, "encounterChat");
  assert.match(
    snapshot.audio.musicAssetName,
    /^BossBattle[1-5]\.mp3$/,
    "First_City has a breeder without Living.boss and must still use source BossBattle music",
  );
  assert.deepEqual(snapshot.encounter, {
    backgroundKey: "FieldCombat",
    allowRetreat: true,
    questKey: "LiberateTownsQuest",
    uniqueKey: "RenderableFirst_CityNameKey",
    startChat: "Ralph",
    winChat: "RalphDefeated",
  });
  assert.equal(snapshot.displayedQueue.length, 0, "combat queue must not start before chat finishes");
  assert(
    snapshot.monsters.filter((monster) => monster.team === 1)
      .every((monster) => monster.captureStatus === "uncapturable"),
    "missing breeder allowCapture must make active and reserve enemies uncapturable",
  );

  const nodeCenter = (label, userObject) => page.evaluate(({ label, userObject }) => {
    let result = null;
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const visit = (node) => {
      if (
        result === null &&
        node.label === label &&
        visible(node) &&
        (userObject === undefined || node.userObject === userObject)
      ) {
        if (node.hitArea && Number.isFinite(node.hitArea.x) && Number.isFinite(node.hitArea.width)) {
          const point = node.toGlobal({
            x: node.hitArea.x + node.hitArea.width / 2,
            y: node.hitArea.y + node.hitArea.height / 2,
          });
          result = { node, x: point.x, y: point.y };
          return;
        }
        const bounds = node.getBounds();
        result = { node, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    if (result !== null) {
      const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(result.x, result.y);
      const hitPath = [];
      for (let current = hit; current; current = current.parent) hitPath.push(current.label ?? null);
      // A source `PopupMenu`/`MonsterManagement` row is deliberately inert (`eventMode: "none"`)
      // and its touch is arbitrated by the container that owns the whole item list, so the top hit
      // is legitimately an ANCESTOR of the labelled visual rather than the visual itself. What
      // still has to hold is that the owner is on this node's own chain -- an unrelated card
      // swallowing the pixel would not be.
      let owned = false;
      for (let current = result.node; current && !owned; current = current.parent) {
        owned = current === hit;
      }
      return { x: result.x, y: result.y, hitPath, owned };
    }
    return null;
  }, { label, userObject });
  const clickNode = async (label, userObject) => {
    let previous = null;
    let point = null;
    for (let i = 0; i < 160; i++) {
      point = await nodeCenter(label, userObject);
      if (point && previous && Math.abs(point.x - previous.x) < 1e-6 &&
          Math.abs(point.y - previous.y) < 1e-6) break;
      previous = point;
      await advance(25);
    }
    assert(point, `missing ${label}:${String(userObject)}`);
    assert(point.owned,
      `${label}'s authored click point is not owned by the node or its arbitrating ancestors: `
      + JSON.stringify(point));
    await page.mouse.click(box.x + point.x, box.y + point.y);
  };

  await advance(550);
  await clickNode("guildQuestChat");
  for (let i = 0; i < 1600 && !(await state()).panelVisible; i++) await advance(25);
  snapshot = await state();
  assert.equal(snapshot.presentation.state, "awaitingPlayerChoice");
  const targetId = snapshot.monsters.find((monster) => monster.team === 1)?.id;
  assert(targetId);





  assert.deepEqual(
    snapshot.capture.adjacentCardTargetIds,
    [],
    "an uncapturable breeder team must mount no capture cards",
  );
  assert.equal(
    await nodeCenter("captureCard"),
    null,
    "no capture card node may exist next to an uncapturable enemy's name",
  );
  assert.equal(await nodeCenter("captureCardHit"), null, "no capture hit proxy either");
  assert.equal(snapshot.presentation.state, "awaitingPlayerChoice");

  const clickRetreat = async () => {
    for (let i = 0; i < 160 && !(await nodeCenter("secondary:retreat")); i++) await advance(25);
    await clickNode("secondary:retreat");
    for (let i = 0; i < 100 && (await state()).presentation.state !== "retreatConfirmation"; i++) {
      await advance(25);
    }
    assert.equal((await state()).presentation.state, "retreatConfirmation",
      "visible Retreat button did not open its confirmation");
    for (let i = 0; i < 100 && !(await nodeCenter("popupButton:Yes")); i++) await advance(25);
    await clickNode("popupButton:Yes");
  };

  // `WorldEncounter.combatRetreatFinished:` rebuilds through the WorldNode convenience wrapper
  // whose `autoEnterTown:YES` matters at this origin. Retry the source 30% roll, then prove the
  // town departure and same-POI forced-repeat route keep the encounter available.
  for (let attempt = 0; attempt < 30 && (await state()).presentation.state !== "retreated"; attempt++) {
    await clickRetreat();
    for (let i = 0; i < 250; i++) {
      snapshot = await state();
      if (snapshot.presentation.state === "retreated" ||
          snapshot.presentation.state === "retreatFailedAwaitingStatus") break;
      await advance(25);
    }
    if (snapshot.presentation.state === "retreatFailedAwaitingStatus") {
      const status = geometry.toCss({ x: 240, y: 260 });
      await page.mouse.click(status.x, status.y);
      for (let i = 0; i < 800 && !(await state()).panelVisible; i++) await advance(25);
    }
  }
  assert.equal((await state()).presentation.state, "retreated", "town-origin retreat never succeeded");
  for (let i = 0; i < 100 && !(await nodeCenter("popupButton:Ok")); i++) await advance(25);
  await clickNode("popupButton:Ok");
  for (let i = 0; i < 800 && (await state()).mode !== "town"; i++) await advance(25);
  await advance(1_100);
  snapshot = await state();
  assert.equal(snapshot.mode, "town", `retreat stopped on the map: ${JSON.stringify(snapshot)}`);
  assert.equal(snapshot.town?.name, "First_City");
  assert.equal(snapshot.audio.musicAssetName, "Town1.mp3");

  // The fixed encounter's source chat can continue on the automatic notification layer after
  // the town is already mounted. Leave Town must remain swallowed until every page is dismissed.
  for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
    snapshot = await state();
    if (snapshot.overlay === null) break;
    assert(snapshot.overlay?.chatOpen || snapshot.overlay?.kind === "townEnterChat",
      `unexpected returned-town overlay: ${JSON.stringify(snapshot.overlay)}`);
    await advance(550);
    await clickNode("guildQuestChat");
  }
  assert.equal((await state()).overlay, null, "returned-town chat did not finish");

  for (let i = 0; i < 160 && !(await state()).town?.exitEnabled; i++) await advance(25);
  assert.equal((await state()).town?.exitEnabled, true, "returned town did not enable its exit");
  await clickNode("town:First_City:exit");
  for (let i = 0; i < 800 && (await state()).mode !== "world"; i++) await advance(25);
  await advance(1_100);
  snapshot = await state();
  assert.equal(snapshot.mode, "world");
  const returnedTown = snapshot.pois.find(({ name, state: poiState }) =>
    name === "First_City" && poiState === 2);
  assert(returnedTown, "town departure did not retain First_City as the current POI");
  await clickPoiStateSprite(returnedTown);
  for (let i = 0; i < 800 && (await state()).mode !== "battle"; i++) await advance(25);
  assert.equal((await state()).mode, "battle", "same-town click did not re-trigger the encounter");
  assert.deepEqual(errors, []);
  console.log("fixed-encounter: PASS (source encounter + town retreat auto-entry + forced rematch)");
} finally {
  await browser.close();
}
