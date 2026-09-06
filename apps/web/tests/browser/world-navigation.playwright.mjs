


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createFrameCapture } from "./captureFrame.mjs";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/world-navigation");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const captureFrame = await createFrameCapture(page, outputDir);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 7; // first occurrence roll is 0.0117 < source 0.333f
    window.__DIB_TEST_BATTLE_SEED__ = 5;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1"];
    window.__DIB_TEST_WORLD_PARTY__ = { size: 6, battingOrderSize: 3, levelRange: [12, 12] };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 12,
      monsterPartyLevels: [12, 12, 12, 12, 12, 12],
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"],
    };
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
  assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
  await page.keyboard.press("Enter");
  let startup = await state();
  for (let i = 0; i < 600 && !["save-select", "new-game-plot", "pick-dragon"].includes(startup.startup?.phase) &&
    !["world", "town"].includes(startup.mode); i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
    startup = await state();
  }
  if (startup.startup?.phase === "save-select") {
    await page.keyboard.press("Enter");
    for (let i = 0; i < 600 && !["world", "town"].includes((await state()).mode); i++) {
      await advance(25);
      if (i % 20 === 0) await page.waitForTimeout(10);
    }
    startup = await state();
  }
  if (startup.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    for (let i = 0; i < 600 && (await state()).startup?.phase !== "pick-dragon"; i++) await advance(25);
    startup = await state();
  }
  if (startup.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  for (let i = 0; i < 600 && !["world", "town"].includes((await state()).mode); i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  startup = await state();
  if (startup.mode === "town") {
    await advance(12_000);
    const exitBounds = await page.evaluate(() => {
      let result = null;
      const visit = (node) => {
        if (result || node.destroyed || node.visible === false) return;
        if (node.label?.endsWith(":exit")) {
          const bounds = node.getBounds();
          result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          return;
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return result;
    });
    assert(exitBounds, "startup town did not expose its exit");
    await page.mouse.click(box.x + exitBounds.x, box.y + exitBounds.y);
    for (let i = 0; i < 600 && (await state()).mode !== "world"; i++) await advance(25);
  }
  let snapshot = await state();
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.world, "World_1-1");
  assert.equal(snapshot.currentPoi, "First_City");
  // Startup now enters Corova before returning to the retained map. Native town exit fades that
  // town plate away; it does not synthesize a second world-name plate on the same retained node.
  assert.equal(snapshot.chrome.mapName.text, "Corova");
  assert.equal(snapshot.chrome.mapName.visible, false);
  assert.equal(snapshot.chrome.menu.functional, true);
  assert.equal(snapshot.chrome.heroXp.level, snapshot.player.heroLevel);
  assert.equal(snapshot.chrome.heroXp.level, 13, "seeded demo evolution history must feed hero XP");
  assert.equal(snapshot.party.length, 6);
  assert(snapshot.party.every((member) => member.currentHp > 0 && !member.fainted));
  const initialParty = snapshot.party.map((member) => ({ ...member }));
  // Fresh Corova exposes only Tutorial Hut. The Forest shortcut remains hidden until the staged
  // Field 1 encounter is won and its durable POI completion is recorded.
  const branch = snapshot.pois.find(
    (poi) => poi.name === "1-1_Turtorial_Hut_1" && poi.state === 4,
  );
  assert(branch, `starting point exposes no source state-4 branch: ${JSON.stringify(snapshot.poiStates)}`);


  const branchCss = geometry.toCss({ x: branch.position.x + 20, y: branch.position.y });
  await page.mouse.click(branchCss.x, branchCss.y);
  for (let i = 0; i < 400; i++) {
    snapshot = await state();
    if (
      snapshot.mode === "world" &&
      snapshot.currentPoi === "1-1_Turtorial_Hut_1" &&
      !snapshot.locked &&
      !snapshot.walking
    ) break;
    await advance(25);
  }
  snapshot = await state();
  const initialWorldSceneInstanceId = snapshot.sceneInstanceId;
  const field = snapshot.pois.find((poi) => poi.name === "1-1_Field_1" && poi.state === 4);
  assert(field, `Tutorial Hut did not expose staged Field 1: ${JSON.stringify(snapshot.poiStates)}`);
  const fieldCss = geometry.toCss({ x: field.position.x + 20, y: field.position.y });
  await page.mouse.click(fieldCss.x, fieldCss.y);

  // The source starts arrival/encounter logic immediately while the 0.25s marker walk is live,
  // then runs its 1.32s zoom/fade-in and 0.66s fade-out around scene replacement.
  for (let i = 0; i < 400 && (await state()).mode !== "battle"; i++) {
    await advance(25);
    await page.waitForTimeout(2);
  }
  snapshot = await state();
  assert.equal(snapshot.entry.transitionFinished, false, "battle entry finished before the world fade-out");
  assert.equal(snapshot.entry.sceneVisible, false, "battle children were exposed beneath the world transition");
  assert.equal(snapshot.entry.enemyEntranceStarted, false, "enemy entrance ran beneath the world transition");
  assert.equal(snapshot.audio.musicAssetName, "Field1.mp3", "battle BGM started before transition completion");
  for (let i = 0; i < 200 && (await state()).activePopup !== "encounterChat"; i++) await advance(25);
  snapshot = await state();
  assert.equal(snapshot.entry.transitionFinished, true);
  assert.equal(snapshot.entry.sceneVisible, true);
  assert.equal(snapshot.entry.enemyEntranceStarted, true);
  assert.match(snapshot.audio.musicAssetName, /Battle[1-7]\.mp3$/);
  if (snapshot.activePopup === "encounterChat") {
    await advance(550);
    const chatCenter = await page.evaluate(() => {
      let result = null;
      const visit = (node) => {
        if (result === null && node.label === "guildQuestChat") {
          const bounds = node.getBounds();
          result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return result;
    });
    assert(chatCenter, "staged Field 1 encounter chat was unavailable");
    await page.mouse.click(box.x + chatCenter.x, box.y + chatCenter.y);
  }
  for (let i = 0; i < 1200 && !(await state()).panelVisible; i++) await advance(25);
  await advance(500);
  snapshot = await state();
  assert.equal(snapshot.mode, "battle");
  assert.equal(snapshot.presentation.state, "awaitingPlayerChoice");
  await captureFrame("staged-world-encounter.png");

  const clickAction = async (kind) => {
    const action = (await state()).secondaryActions.find((candidate) => candidate.kind === kind);
    assert(action, `missing ${kind} action`);
    const point = geometry.toCss(action.center);
    await page.mouse.click(point.x, point.y);
  };
  const visibleTextPoint = async (wanted) => page.evaluate((text) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) if (!current.visible) return false;
      return true;
    };
    let found = null;
    const visit = (node) => {
      if (!found && node.text === text && visible(node)) {
        const bounds = node.getBounds();
        found = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  }, wanted);
  const clickText = async (wanted) => {
    for (let i = 0; i < 100 && !(await visibleTextPoint(wanted)); i++) {
      await advance(25);
      if (i % 20 === 0) await page.waitForTimeout(10);
    }
    await advance(250);
    const stagePoint = await visibleTextPoint(wanted);
    assert(stagePoint, `missing visible text ${wanted}`);
    // Pixi getBounds() is already canvas-global: FixedStage's scale and letterbox offset are
    // included. Only add the canvas element's CSS origin; stageGeometry.toCss is for battle-point
    // coordinates reported by render_game_to_text().
    await page.mouse.click(box.x + stagePoint.x, box.y + stagePoint.y);
  };
  const waitForPanel = async (attempt) => {
    // The popup dismiss callback restores awaitingPlayerChoice before BattleNode consumes the
    // pending selection. First prove the old panel actually leaves, then wait for the next actor's
    // panel; otherwise this helper can return on the same turn without advancing battle time.
    for (let i = 0; i < 160 && (await state()).panelVisible; i++) await advance(10);
    const afterSubmit = await state();
    assert.equal(
      afterSubmit.panelVisible,
      false,
      `submitted action ${attempt} did not remove its panel: ${JSON.stringify({
        presentation: afterSubmit.presentation,
        activePopup: afterSubmit.activePopup,
        statusText: afterSubmit.statusText,
        latestSecondaryAction: afterSubmit.latestSecondaryAction,
        errors,
      })}`,
    );
    for (let i = 0; i < 1600 && !(await state()).panelVisible; i++) await advance(25);
    // panelVisible flips when construction starts; let the source slide-in reach its stable hit
    // geometry before the next toolbar click.
    await advance(500);
    assert.equal((await state()).presentation.state, "awaitingPlayerChoice");
  };

  // Yield turns until an enemy produces real persistent damage. A lethal hit is equally valid:
  // the source immediately promotes a reserve, so detect it as active+bench shrinking below the
  // original trip-party size instead of looking only at the surviving displays' HP.
  const damageObserved = (state) => {
    const activeFriendlies = state.monsters.filter((monster) => monster.team === 0);
    return activeFriendlies.some((monster) => monster.hp < monster.maxHp) ||
      activeFriendlies.length + state.friendlyBenchCount < initialParty.length;
  };
  let confirmedDelay = false;
  for (let attempts = 0; attempts < 12; attempts++) {
    snapshot = await state();
    if (damageObserved(snapshot)) break;
    await clickAction("delay");
    if (!confirmedDelay) {
      await clickText("Yes");
      confirmedDelay = true;
    }
    await waitForPanel(attempts);
  }
  snapshot = await state();
  assert(
    damageObserved(snapshot),
    `enemy turns did not damage a friendly before the persistence check: ${JSON.stringify({
      presentation: snapshot.presentation,
      queue: snapshot.queue,
      monsters: snapshot.monsters,
      errors,
    })}`,
  );

  // Retry the source 30% retreat action until it succeeds; failures consume the acting turn and
  // preserve every intervening HP change. This avoids pinning assumptions about a random roster's
  // speed/ability draw count.
  for (let attempts = 0; attempts < 30 && (await state()).presentation.state !== "retreated"; attempts++) {
    await clickAction("retreat");
    await clickText("Yes");
    for (let i = 0; i < 200; i++) {
      snapshot = await state();
      if (snapshot.presentation.state === "retreated" || snapshot.presentation.state === "retreatFailedAwaitingStatus") break;
      await advance(25);
    }
    if (snapshot.presentation.state === "retreatFailedAwaitingStatus") {
      const status = geometry.toCss({ x: 240, y: 260 });
      await page.mouse.click(status.x, status.y);
      await waitForPanel(`retreat-${attempts}`);
    }
  }
  snapshot = await state();
  assert.equal(snapshot.presentation.state, "retreated", "retreat did not succeed within 30 attempts");
  const terminalHp = new Map(
    snapshot.monsters
      .filter((monster) => monster.team === 0)
      .map((monster) => [Number(/^t0m(\d+):/.exec(monster.id)?.[1]), monster.hp]),
  );
  await clickText("Ok");
  for (let i = 0; i < 400 && (await state()).mode !== "world"; i++) await advance(25);
  snapshot = await state();
  assert.equal(snapshot.locked, true, "retained world unlocked before SceneCoordinator became idle");
  assert.equal(
    snapshot.sceneInstanceId,
    initialWorldSceneInstanceId,
    "battle return rebuilt the WorldNode instead of restoring the retained source scene",
  );
  // Wait through the source 0.25s-in/0.25s-out black return before tapping a POI.
  await advance(600);
  snapshot = await state();
  assert.equal(snapshot.mode, "world");
  assert.equal(snapshot.locked, false);
  for (const [index, hp] of terminalHp) {
    assert.equal(snapshot.party[index].currentHp, hp, `party member ${index} was healed/rebuilt after retreat`);
  }
  assert(
    snapshot.party.some((member, index) => member.currentHp < initialParty[index].currentHp),
    "retreat did not preserve any damage or fainting from the battle",
  );
  assert.deepEqual(
    snapshot.party.slice(0, initialParty.length).map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    initialParty.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    "retreat replaced durable party identities",
  );
  await captureFrame("returned-with-wounds.png");

  // Tapping the current state-2 POI is the source's forced-repeat path. With no self-edge,
  // `setCurrentPOI:` concurrently runs its non-adjacent marker sequence under the encounter zoom:
  // fade out .25s, zero-duration move to the same point, then fade in .5s. The second BattleNode
  // must also seed engine and presentation HP from the retained Monster instances, excluding
  // fainted batting members without backfilling or reconstructing survivors at full health.
  const current = snapshot.pois.find((poi) => poi.state === 2);
  assert(current, "returned world has no current state-2 POI");
  const expectedAlive = new Map(
    snapshot.party
      .slice(0, initialParty.length)
      .filter((member) => !member.fainted && !member.injured)
      .slice(0, 3)
      .map((member) => [member.instanceId, member.currentHp]),
  );
  const currentCss = geometry.toCss(current.position);
  await page.mouse.click(currentCss.x, currentCss.y);
  await advance(125);
  snapshot = await state();
  assert.equal(snapshot.mode, "world", "forced-repeat transition replaced the world before its zoom");
  assert.equal(snapshot.locked, true);
  assert.equal(snapshot.walking, true);
  assert(Math.abs(snapshot.markerAlpha - 0.5) < 0.02, `forced-repeat fade-out midpoint was ${snapshot.markerAlpha}`);
  assert(snapshot.sceneTransform.scale > 1, "encounter zoom did not run concurrently with marker fade");
  await advance(125);
  snapshot = await state();
  assert.equal(snapshot.markerAlpha, 0, "forced-repeat marker did not finish its .25s fade-out");
  await advance(250);
  snapshot = await state();
  assert(Math.abs(snapshot.markerAlpha - 0.5) < 0.02, `forced-repeat fade-in midpoint was ${snapshot.markerAlpha}`);
  await advance(250);
  snapshot = await state();
  assert.equal(snapshot.markerAlpha, 1, "forced-repeat marker did not finish its .5s fade-in");
  assert.equal(snapshot.walking, false);
  for (let i = 0; i < 400 && (await state()).mode !== "battle"; i++) await advance(25);
  snapshot = await state();
  assert.equal(snapshot.mode, "battle");
  const secondBattle = snapshot.monsters.filter((monster) => monster.team === 0);
  assert.deepEqual(
    secondBattle.map(({ sourceInstanceId, hp }) => [sourceInstanceId, hp]),
    [...expectedAlive],
    "second encounter did not reuse the surviving party identities/current HP",
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("world-navigation: PASS (tutorial graph, staged/forced encounter transitions, retreat HP persistence)");
} finally {
  await browser.close();
}
