


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createFrameCapture } from "./captureFrame.mjs";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
// This seed's old 25%-fallback roll missed North Cave's authored Egg. CatchQuestDisplay instead
// sets TreasureData.defaultSpawnChance to 1.0, so the fixture now proves that source behavior.
const dungeonSeed = Number(process.env.DIB_DUNGEON_SCENARIO_SEED ?? 20260724);
const routeFloor = Number(process.env.DIB_DUNGEON_SCENARIO_FLOOR ?? 1);
const encounterScenario = process.env.DIB_DUNGEON_SCENARIO_ENCOUNTER === "1";
const reentryScenario = process.env.DIB_DUNGEON_SCENARIO_REENTRY === "1";
const sparkleOnlyScenario = process.env.DIB_DUNGEON_SCENARIO_SPARKLE_ONLY === "1";
const logPhases = process.env.DIB_BROWSER_PHASES === "1";
const phase = (message) => { if (logPhases) console.log(`[dungeon] ${message}`); };
const outputDir = path.resolve(
  sparkleOnlyScenario
    ? "output/dungeon-chest-sparkle"
    : encounterScenario
    ? "output/dungeon-encounter"
    : reentryScenario
      ? "output/dungeon-reentry"
    : routeFloor === 1
      ? "output/dungeon-loop"
      : "output/dungeon-stairs",
);
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const captureFrameImpl = await createFrameCapture(page, outputDir);
  const captureFrame = process.env.DIB_DUNGEON_SKIP_CAPTURES === "1"
    ? async () => undefined
    : captureFrameImpl;
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ seed, floor, reentry, encounter, sparkle }) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 7;
    window.__DIB_TEST_DUNGEON_SEED__ = seed;
    window.__DIB_TEST_DUNGEON_ROUTE__ = {
      typeName: "Cave",
      sourceFile: "Dungeon_1.plist",
      floor,
      ...(reentry ? { entryZoneName: "NorthCaveEntrance" } : {}),
    };
    if (encounter || sparkle) window.__DIB_TEST_GUILD_QUEST_NAMES__ = ["BeatRigel"];
    // North Cave's shipped catch quest is a deterministic, source-authored one-item treasure
    // seam. Register its three required catches so this scenario must render and escape the real
    // LootPageProvider instead of conditionally hoping the generated room graph exposes a chest.
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 12,
      monsterPartyLevels: [12, 12, 12],
      silver: 1000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      highestCapturedLevels: { Penguin: 1, FireCub: 1, GiantTurtle: 1 },
      ...(encounter || sparkle ? { catchQuestsDone: ["NorthCave"] } : {}),
    };
  }, {
    seed: dungeonSeed,
    floor: routeFloor,
    reentry: reentryScenario,
    encounter: encounterScenario,
    sparkle: sparkleOnlyScenario,
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  phase("content loaded");

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(1);
  };
  const waitForState = async (predicate, description, iterations = 160) => {
    for (let index = 0; index < iterations; index++) {
      const snapshot = await state();
      if (predicate(snapshot)) {
        await advance(25);
        return await state();
      }
      await advance(25);
      if (index % 10 === 0) await page.waitForTimeout(2);
    }
    throw new Error(
      `${description}; browser errors: ${errors.join(" | ") || "none"}; ` +
      `final state: ${JSON.stringify(await state())}`,
    );
  };
  const dungeonLayerOrder = () => page.evaluate(() => {
    const wanted = new Set(["dungeonWorld", "dungeonChrome"]);
    const found = {};
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (wanted.has(node?.label)) found[node.label] = node.zIndex;
      if (node?.children) stack.push(...node.children);
    }
    return found;
  }, dungeonSeed);
  const labeledNodeCounts = () => page.evaluate(() => {
    const counts = {};
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label) counts[node.label] = (counts[node.label] ?? 0) + 1;
      if (node?.children) stack.push(...node.children);
    }
    return counts;
  });
  const connectorBounds = () => page.evaluate(() => {
    const result = [];
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label?.startsWith("dungeonConnector:")) {
        const bounds = node.getLocalBounds();
        result.push({ label: node.label, x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
      }
      if (node?.children) stack.push(...node.children);
    }
    return result;
  });
  const chestSparkleEvidence = () => page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    const result = [];
    while (stack.length > 0) {
      const chest = stack.pop();
      if (chest?.label?.startsWith("dungeonChest:")) {
        const sparkle = chest.children?.find((child) =>
          child.label?.startsWith("dungeonChestSparkles:"));
        if (sparkle !== undefined) {
          sparkle.visible = false;
          const art = chest.getBounds();
          sparkle.visible = true;
          const particles = Array.from({ length: sparkle.particleCount }, (_, index) => {
            const particle = sparkle.debugParticleState(index);
            const center = sparkle.toGlobal({ x: particle.renderXPx, y: particle.renderYPx });
            const size = particle.renderSizePx;
            return {
              x: center.x - size / 2, y: center.y - size / 2, w: size, h: size,
            };
          });
          result.push({
            chestLabel: chest.label,
            sparkleLabel: sparkle.label,
            art: { x: art.x, y: art.y, w: art.width, h: art.height },
            emitterPosition: { x: sparkle.x, y: sparkle.y },
            particleTopology: sparkle.particleTopology,
            particleBlendMode: sparkle.particleBlendMode,
            particles,
          });
        }
      }
      if (chest?.children) stack.push(...chest.children);
    }
    return result;
  });
  const clickLabeledNode = async (label) => tapPixiLabel(page, label);
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box, "missing Pixi canvas");
  const geometry = await stageGeometry(page, box);
  const clickWorldMenuAction = async (action) => {
    const current = await state();
    const button = current.menu?.buttons?.find((candidate) => candidate.action === action);
    assert(button?.enabled, `enabled world-menu action ${action} is unavailable: ${JSON.stringify(current.menu)}`);
    // WorldMenu's dedicated browser contract owns physical pointer/plate arbitration. This much
    // broader dungeon flow needs the exact source-local release only; emit it at the single parent
    // delegate so iPad canvas/letterbox reconstruction cannot turn a healthy menu into a false red.
    await page.evaluate((center) => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "dungeonMasterMenu") {
          node.emit("pointertap", {
            pointerId: 1,
            getLocalPosition: () => ({ ...center }),
            stopPropagation() {},
            stopImmediatePropagation() {},
          });
          return;
        }
        if (node?.children) stack.push(...node.children);
      }
      throw new Error("dungeon MasterMenu root is missing");
    }, button.center);
  };
  const clickCurrentZone = async (current) => {
    const room = current.rooms.find((candidate) => candidate.id === current.currentRoomId);
    assert(room, "current zone room missing");
    const tile = 60;
    const worldPoint = {
      x: room.x * tile + room.width * tile / 2,
      y: -(room.y + room.height) * tile + room.height * tile / 2 + 10,
    };
    const point = {
      x: current.camera.x + worldPoint.x * current.camera.scale,
      y: current.camera.y + worldPoint.y * current.camera.scale,
    };
    const css = geometry.toCss(point);
    await page.mouse.click(css.x, css.y);
  };
  const boundsForLabel = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) {
        const bounds = node.getBounds();
        return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, label);
  const emitPointerForLabel = (label, type) => page.evaluate(({ wanted, eventType }) => {
    const stack = [window.__PIXI_APP__.stage];
    let node = null;
    while (stack.length > 0) {
      const candidate = stack.pop();
      if (candidate?.label === wanted) { node = candidate; break; }
      if (candidate?.children) stack.push(...candidate.children);
    }
    if (node === null) throw new Error(`missing Pixi node ${wanted}`);
    let owner = node;
    while (owner !== null && (owner.listenerCount?.(eventType) ?? 0) === 0) owner = owner.parent;
    if (owner === null) throw new Error(`no ${eventType} owner for ${wanted}`);
    const bounds = node.getLocalBounds();
    const global = node.toGlobal({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    const local = owner.toLocal(global);
    owner.emit(eventType, {
      pointerId: 1,
      global,
      getLocalPosition: () => ({ x: local.x, y: local.y }),
      stopPropagation() {},
      stopImmediatePropagation() {},
    });
    return owner.label ?? "(unlabelled owner)";
  }, { wanted: label, eventType: type });
  const finishPendingEggHatch = async (required = false) => {
    let current = await state();
    for (let index = 0; index < 480 &&
        (current.overlay?.phase !== "rolling" || current.overlay?.kind === undefined); index++) {
      await advance(25);
      current = await state();
    }
    if (current.overlay?.phase !== "rolling" || current.overlay?.kind === undefined) {
      assert.equal(required, false, "catch-quest Egg continuation did not mount");
      return;
    }
    const kind = current.overlay.kind;
    phase(`${kind} Egg reel mounted`);
    const reel = await boundsForLabel("eggHatch:background");
    assert(reel, `${kind} Egg reel did not mount after taking catch-quest loot`);
    const eggPointerOwner = await emitPointerForLabel("eggHatch:background", "pointerdown");
    assert.equal((await state()).overlay?.pressed, true, `${kind} Egg did not own pointer-down`);
    await advance(1_600);
    assert.equal(await emitPointerForLabel("eggHatch:background", "pointerup"), eggPointerOwner,
      `${kind} Egg pointer sequence changed owners`);
    for (let index = 0; index < 40 && (await state()).overlay?.reel?.friction === 0; index++) {
      await advance(25);
    }
    assert.notEqual((await state()).overlay?.reel?.friction, 0,
      `${kind} Egg release did not commit friction`);
    phase(`${kind} Egg reel released`);
    await waitForState(
      (value) => value.overlay?.kind === kind && value.overlay?.phase !== "rolling",
      `${kind} Egg did not settle after the source 1.5-second release gate`,
      1_200,
    );
    let labels = await labeledNodeCounts();
    for (let index = 0; index < 480 &&
        labels["popupButton:Keep"] === undefined && labels["popupButton:No"] === undefined;
      index++) {
      await advance(25);
      labels = await labeledNodeCounts();
    }
    if (labels["popupButton:Keep"] !== undefined) {
      phase(`${kind} Egg monster prize mounted`);
      await clickLabeledNode("popupButton:Keep");
      for (let index = 0; index < 480 &&
          (await labeledNodeCounts())["popupButton:No"] === undefined; index++) await advance(25);
    }
    assert.equal((await labeledNodeCounts())["popupButton:No"], 1,
      `${kind} Egg repeat question did not open`);
    phase(`${kind} Egg repeat question mounted`);
    await clickLabeledNode("popupButton:No");
    await waitForState(
      (value) => value.overlay?.kind !== kind,
      `${kind} Egg continuation did not close`,
      480,
    );
  };

  // `loadLocalContent` returns as soon as the shell first enters start mode. The source startup
  // sequence can still be replacing the preloader with its title scene at that point, so wait for
  // the actual full-screen title touch consumer before sending the launch gesture.
  for (let index = 0; index < 240 && (await state()).startup?.phase !== "title"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
  await page.waitForTimeout(100);
  await advance(16.67);
  await page.waitForTimeout(100);
  const hasTitleTouch = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "sourceTitleTouchLayer") return true;
      if (node?.children) stack.push(...node.children);
    }
    return false;
  });
  assert.equal(hasTitleTouch, true, "source title touch layer was not mounted");
  await page.keyboard.press("Enter");
  for (let index = 0; index < 480; index++) {
    const snapshot = await state();
    if (snapshot.mode === "dungeon" || snapshot.startup?.phase === "save-select") break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  if ((await state()).startup?.phase === "save-select") {
    const startup = await state();
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `save slot 1 unavailable: ${JSON.stringify(startup.startup)}`);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
    for (let index = 0; index < 480; index++) {
      const current = await state();
      if (current.mode === "dungeon" || current.startup?.phase === "new-game-plot") break;
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
  }

  let snapshot = await state();
  // A fresh browser has an empty slot. The destination callback may publish `mode=dungeon` one
  // microtask before startup settles on its source new-game plot, so classify the final observed
  // startup state here rather than the transient state immediately after the slot click.
  if (snapshot.startup?.phase === "new-game-plot") {
    await advance(Math.max(50, snapshot.startup.intro.scrollMs - 100));
    await page.keyboard.press("Enter");
    await waitForState(
      (current) => current.startup?.phase === "pick-dragon",
      "new-game plot did not open the starter picker",
      480,
    );
    await page.keyboard.press("1");
    for (let index = 0; index < 480 && (await state()).mode !== "dungeon"; index++) {
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    snapshot = await state();
  }
  assert.equal(snapshot.mode, "dungeon", JSON.stringify(snapshot));
  phase("dungeon entered");



  const hasStartupShade = () => page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "startupTransitionShade") return true;
      if (node?.children) stack.push(...node.children);
    }
    return false;
  });
  for (let index = 0; index < 240 && await hasStartupShade(); index++) {
    await advance(25);
    if (index % 10 === 0) await page.waitForTimeout(2);
  }
  assert.equal(await hasStartupShade(), false, "startup transition did not release dungeon input");
  snapshot = await state();
  assert.equal(snapshot.mode, "dungeon", JSON.stringify(snapshot));
  assert.equal(snapshot.sourceFile, "Dungeon_1.plist");
  assert.equal(snapshot.dungeonType, "Cave");
  assert.equal(snapshot.floor, routeFloor);
  if (routeFloor === 1) {
    assert.match(snapshot.currentRoomId, /^Cave\.[^-]+-\{0, 0\}$/);
  } else {
    const current = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
    assert(current?.zones.some((zone) => zone.kind === "stairsUp"), JSON.stringify(current));
  }
  assert.equal(snapshot.chrome.namePlate.text, `Lv:${routeFloor} North Cave`);
  assert.equal(snapshot.chrome.namePlate.label, "dungeonNamePlate");
  assert.equal(snapshot.chrome.namePlate.placement, "upper-inset");
  assert(Math.abs(snapshot.chrome.namePlate.position.x - 124.8) < 1e-6);
  assert.equal(snapshot.chrome.namePlate.position.y, 5);
  assert.equal(snapshot.chrome.caught.total, 8);
  assert(snapshot.availableDirections.length > 0, "seeded start room has no linked room");
  assert(snapshot.rooms.some((room) => room.id === snapshot.currentRoomId && room.explored));
  assert(!snapshot.diagnostics.some((entry) => entry.code === "topology-order-approximation"));
  assert.deepEqual(await dungeonLayerOrder(), {
    dungeonWorld: 0,
    dungeonChrome: 10_000,
  });
  const catchNodes = await labeledNodeCounts();
  if (encounterScenario || sparkleOnlyScenario) {
    // This renderer-only fixture starts with the independently persisted North Cave catch reward
    // already complete, so no unrelated claim modal can cover the encounter marker under test.
    assert.equal(catchNodes.catchQuestDisplay, undefined, JSON.stringify(catchNodes));
  } else {
  assert.equal(catchNodes.catchQuestDisplay, 1, JSON.stringify(catchNodes));
  assert.equal(catchNodes.catchQuestHeading, 1, JSON.stringify(catchNodes));
  assert.equal(catchNodes.catchQuestClaimChest, 1, JSON.stringify(catchNodes));
  assert.equal(catchNodes.catchQuestClose, 1, JSON.stringify(catchNodes));
  await captureFrame("catch-quest-entry.png");
  const claimTapOwner = await clickLabeledNode("catchQuestClaimChest");
  phase(`catch quest tapped through ${claimTapOwner}`);
  for (let index = 0; index < 480 &&
      (await labeledNodeCounts()).dungeonLootPage === undefined; index++) {
    await advance(25);
    await page.waitForTimeout(10);
  }
  let lootState = await state();
  assert.equal(lootState.pendingAction, undefined);
  const lootLabels = await labeledNodeCounts();
  assert.equal(lootLabels.catchQuestDisplay, undefined, JSON.stringify({
    claimTapOwner,
    lootLabels,
    errors,
    state: lootState,
  }));
  assert.equal(lootLabels.dungeonLootPage, 1, JSON.stringify({
    lootLabels,
    errors,
    state: lootState,
  }));
  phase("catch quest loot mounted");
  assert.equal(lootLabels.dungeonLootTitle, 1, JSON.stringify(lootLabels));
  assert.equal(lootLabels.dungeonLootPrevious, 1, JSON.stringify(lootLabels));
  assert.equal(lootLabels.dungeonLootNext, 1, JSON.stringify(lootLabels));
  assert.equal(lootLabels["popupButton:Take All"], 1, JSON.stringify(lootLabels));
  const renderedTakeAllBounds = () => page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "popupButton:Take All") {
          const bounds = node.getBounds();
          let visible = true;
          for (let current = node; current !== null; current = current.parent) {
            visible &&= current.visible;
          }
          return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height, visible };
        }
        if (node?.children) stack.push(...node.children);
      }
      return undefined;
    });
  await advance(250);
  let takeAllBounds = await renderedTakeAllBounds();
  for (let index = 0; index < 80 && (takeAllBounds?.h ?? 0) <= 0; index++) {
    await advance(25);
    takeAllBounds = await renderedTakeAllBounds();
  }
  assert(takeAllBounds, "Take All has no rendered bounds");
  assert.equal(takeAllBounds.visible, true, JSON.stringify(takeAllBounds));
  assert(takeAllBounds.w > 0 && takeAllBounds.h > 0, JSON.stringify(takeAllBounds));
  assert(takeAllBounds.x >= 0 && takeAllBounds.y >= 0, JSON.stringify(takeAllBounds));
  assert(takeAllBounds.x + takeAllBounds.w <= geometry.stagePx.w, JSON.stringify(takeAllBounds));
  assert(takeAllBounds.y + takeAllBounds.h <= geometry.stagePx.h, JSON.stringify(takeAllBounds));
  await captureFrame("catch-quest-loot-popup.png");
  await clickLabeledNode("popupButton:Take All");
  for (let index = 0; index < 240 && (await labeledNodeCounts()).dungeonLootPage !== undefined; index++) {
    await advance(25);
    if (index % 10 === 0) await page.waitForTimeout(2);
  }
  assert.equal((await labeledNodeCounts()).catchQuestDisplay, undefined);
  assert.equal((await labeledNodeCounts()).dungeonLootPage, undefined);
  phase("catch quest loot taken");
  lootState = await state();
  assert.equal(lootState.locked, false, JSON.stringify(lootState));
  await finishPendingEggHatch(true);
  phase("catch quest Egg continuation finished");
  // GeneralMenu always keeps the fixed "Challenge" item operable. Reopening it after a claim must
  // show the already-collected static chest, proving the action is no longer disabled.
  await clickLabeledNode("dungeonMenuButton");
  for (let index = 0; index < 80 &&
      (await labeledNodeCounts()).dungeonMasterMenu === undefined; index++) await advance(25);
  assert.equal((await labeledNodeCounts())["worldMenu:catchQuest"], 1);
  await clickWorldMenuAction("catchQuest");
  for (let index = 0; index < 80 &&
      (await labeledNodeCounts()).catchQuestDisplay === undefined; index++) await advance(25);
  const collectedLabels = await labeledNodeCounts();
  assert.equal(collectedLabels.catchQuestChest, 1, JSON.stringify(collectedLabels));
  assert.equal(collectedLabels.catchQuestClaimChest, undefined, JSON.stringify(collectedLabels));
  await clickLabeledNode("catchQuestClose");
  for (let index = 0; index < 80 &&
      (await labeledNodeCounts()).catchQuestDisplay !== undefined; index++) await advance(25);

  // DungeonNode passes world=nil/dungeon=self to the same GeneralMenu builder. The common
  // implemented destinations remain enabled; only Big Map is replaced by Challenge.
  await clickLabeledNode("dungeonMenuButton");
  snapshot = await waitForState(
    (value) => value.menu?.config === "MasterMenu",
    "dungeon MasterMenu did not open",
  );
  assert.equal(snapshot.menu.editable, false);
  assert.deepEqual(
    snapshot.menu.buttons.filter((button) => button.enabled).map((button) => button.action),
    [
      "items",
      "quests",
      "options",
      "monsters",
      "catchQuest",
      "townPortal",
      "mainMenu",
      "monsterpedia",
      "tutorials",
    ],
  );

  await clickWorldMenuAction("monsters");
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "partyEditor" || value.overlay?.kind === "tutorial",
    "dungeon Monsters did not open",
  );
  if (snapshot.overlay?.kind === "tutorial") {
    snapshot = await waitForState(
      (value) => value.overlay?.kind === "tutorial" && value.overlay.tutorial?.okReady,
      "dungeon Tutorial4 first page did not become dismissible",
      480,
    );
    assert.equal(snapshot.overlay.tutorial.key, "Tutorial4");
    assert.equal(snapshot.overlay.tutorial.pageCount, 2);
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.overlay?.kind === "tutorial" &&
        value.overlay.tutorial?.page === 1 && value.overlay.tutorial.okReady,
      "dungeon Tutorial4 second page did not become dismissible",
      480,
    );
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.overlay?.screen === "partyEditor",
      "dungeon Tutorial4 did not return to the retained party editor",
      480,
    );
  }
  assert.equal(snapshot.overlay.style, 1);
  await clickLabeledNode("partyEditorClose");
  await waitForState((value) => value.overlay === null, "dungeon Monsters did not close");

  await clickLabeledNode("dungeonMenuButton");
  await waitForState((value) => value.menu?.config === "MasterMenu", "dungeon MasterMenu did not reopen");
  await clickWorldMenuAction("monsterpedia");
  snapshot = await waitForState(
    (value) =>
      value.sceneFade?.route === "dungeon-menu-monsterpedia" &&
      value.sceneFade.phase === "covering",
    "dungeon Monsterpedia did not begin its source black fade",
  );
  assert.equal(snapshot.overlay, null, "dungeon Monsterpedia replaced the dungeon before midpoint");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.screen === "monsterpedia" &&
      value.sceneFade?.route === "dungeon-menu-monsterpedia" &&
      value.sceneFade.phase === "revealing",
    "dungeon Monsterpedia did not swap at the opaque midpoint",
  );
  assert.equal(snapshot.overlay.editable, false);
  await waitForState(
    (value) => value.overlay?.screen === "monsterpedia" && value.sceneFade === undefined,
    "dungeon Monsterpedia entry fade did not finish",
  );
  await clickLabeledNode("monsterpediaTab:close");
  snapshot = await waitForState(
    (value) =>
      value.overlay?.screen === "monsterpedia" &&
      value.sceneFade?.route === "dungeon-menu-monsterpedia-return" &&
      value.sceneFade.phase === "covering",
    "dungeon Monsterpedia did not retain the book during return fade-in",
  );
  assert.equal(snapshot.overlay.closing, true);
  await waitForState(
    (value) =>
      value.overlay === null &&
      value.sceneFade?.route === "dungeon-menu-monsterpedia-return" &&
      value.sceneFade.phase === "revealing",
    "dungeon Monsterpedia did not return at the opaque midpoint",
  );
  await waitForState(
    (value) => value.overlay === null && value.sceneFade === undefined,
    "dungeon Monsterpedia return fade did not finish",
  );

  await clickLabeledNode("dungeonMenuButton");
  await waitForState((value) => value.menu?.config === "MasterMenu", "dungeon MasterMenu did not reopen");
  await clickWorldMenuAction("options");
  snapshot = await waitForState(
    (value) => Array.isArray(value.overlay?.rows),
    "dungeon Options did not open",
  );
  await clickLabeledNode("popupButton:Ok");
  await waitForState((value) => value.overlay === null, "dungeon Options did not close");
  }

  if (!encounterScenario && !sparkleOnlyScenario) {
    await captureFrame("cave-floor-entry.png");
  }
  if (sparkleOnlyScenario) {
    // The source only constructs a RoomNode (and therefore its chest child) after the room is
    // revealed. Follow the same clear-room route used by the Rigel fixture until his fixed room is
    // a materialized neighbor, then leave the chest unopened for the visibility proof below.
    snapshot = await state();
    let room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
    const fixedRoom = snapshot.rooms.find((candidate) => candidate.encounter === "encounter-fixed-0");
    assert(room && fixedRoom, `seed ${dungeonSeed} did not generate Rigel's fixed room`);
    for (let index = 0; index < 4 && (await state()).floorDetectionChat !== undefined; index++) {
      await page.keyboard.press("Enter");
      await advance(500);
    }
    assert.equal((await state()).floorDetectionChat, undefined,
      "Rigel detection chat retained dungeon navigation ownership");
    await advance(8_000);
    snapshot = await state();
    room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
    assert(room, "current room disappeared after the arrival notification");
    const byId = new Map(snapshot.rooms.map((candidate) => [candidate.id, candidate]));
    const parent = new Map([[room.id, undefined]]);
    const queue = [room.id];
    while (queue.length > 0 && !parent.has(fixedRoom.id)) {
      const currentId = queue.shift();
      const current = byId.get(currentId);
      if (!current) continue;
      for (const link of current.links) {
        if (parent.has(link.targetRoomId)) continue;
        const candidate = byId.get(link.targetRoomId);
        if (!candidate || (candidate.id !== fixedRoom.id && candidate.encounter !== undefined)) continue;
        parent.set(candidate.id, currentId);
        queue.push(candidate.id);
      }
    }
    assert(parent.has(fixedRoom.id),
      `Rigel has no clear-room reveal path: ${JSON.stringify(snapshot.rooms)}`);
    const pathToFixed = [];
    for (let id = fixedRoom.id; id !== undefined; id = parent.get(id)) pathToFixed.push(id);
    pathToFixed.reverse();
    for (const nextId of pathToFixed.slice(1, -1)) {
      const current = await state();
      const currentRoom = current.rooms.find((candidate) => candidate.id === current.currentRoomId);
      const nextRoom = current.rooms.find((candidate) => candidate.id === nextId);
      assert(currentRoom && nextRoom && nextRoom.explored,
        `next sparkle reveal-path room is not materialized: ${JSON.stringify({ nextId, current })}`);
      const tile = 60;
      const roomCenter = {
        x: nextRoom.x * tile + nextRoom.width * tile / 2,
        y: -(nextRoom.y + nextRoom.height) * tile + nextRoom.height * tile / 2,
      };
      const css = geometry.toCss({
        x: current.camera.x + roomCenter.x * current.camera.scale,
        y: current.camera.y + roomCenter.y * current.camera.scale,
      });
      await page.mouse.click(css.x, css.y);
      for (let index = 0; index < 160 && (await state()).currentRoomId !== nextId; index++) {
        await advance(25);
      }
      assert.equal((await state()).currentRoomId, nextId,
        `dungeon did not follow sparkle reveal path through ${nextId}`);
      await advance(650);
    }
  }
  await advance(2_100);
  snapshot = await state();
  assert.equal(snapshot.chrome.heroXpExpanded, false, JSON.stringify(snapshot.chrome));
  assert(Math.abs(snapshot.camera.x + snapshot.camera.focus.x * snapshot.camera.scale - geometry.screenPt.w / 2) < 1e-6);
  assert(Math.abs(snapshot.camera.y + snapshot.camera.focus.y * snapshot.camera.scale - geometry.screenPt.h / 2) < 1e-6);
  assert(snapshot.connectors.length > 0, "materialized dungeon rooms emitted no connector floors");
  if (sparkleOnlyScenario) {
  assert(snapshot.chestSparkles.length > 0, "materialized treasure emitted no Sparkle.plist systems");
  assert(snapshot.chestSparkles.every((sparkle) =>
    sparkle.particleCount > 0 &&
    sparkle.emitterPosition.x === 22.5 && sparkle.emitterPosition.y === 16.5 &&
    sparkle.positionVariance.x === 22.5 && sparkle.positionVariance.y === 16.5 &&
    sparkle.pixiLocalPosition.x === 0 && sparkle.pixiLocalPosition.y === 0 &&
    sparkle.particleTopology === "point-list" && sparkle.particleBlendMode === "add-npm"
  ), JSON.stringify(snapshot.chestSparkles));
  const sparkleEvidence = await chestSparkleEvidence();
  const offscreenCandidate = sparkleEvidence[0];
  assert(offscreenCandidate, JSON.stringify(sparkleEvidence));
  assert.equal(offscreenCandidate.particleTopology, "point-list", JSON.stringify(offscreenCandidate));
  assert.equal(offscreenCandidate.particleBlendMode, "add-npm", JSON.stringify(offscreenCandidate));
  const offscreenProof = await page.evaluate((chestLabel) => {
    const stack = [window.__PIXI_APP__.stage];
    let chest;
    let world;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === chestLabel) chest = node;
      if (node?.label === "dungeonWorld") world = node;
      if (node?.children) stack.push(...node.children);
    }
    if (chest === undefined || world === undefined) return undefined;
    const sparkle = chest.children.find((child) => child.label?.startsWith("dungeonChestSparkles:"));
    if (sparkle === undefined) return undefined;
    sparkle.visible = false;
    const art = chest.getBounds();
    sparkle.visible = true;
    const originalWorldX = world.x;
    const originalWorldY = world.y;
    const parentScaleX = world.parent.worldTransform.a;
    const parentScaleY = world.parent.worldTransform.d;
    world.x += (25 - (art.x + art.width)) / parentScaleX;
    world.y += (window.__PIXI_APP__.screen.height / 2 - (art.y + art.height / 2)) / parentScaleY;
    return { originalWorldX, originalWorldY, worldLabel: world.label };
  }, offscreenCandidate.chestLabel);
  assert(offscreenProof, "could not stage the off-screen chest proof");
  await advance(1_200);
  let shifted = (await chestSparkleEvidence()).find(
    ({ chestLabel }) => chestLabel === offscreenCandidate.chestLabel,
  );
  for (let index = 0; index < 80 && !shifted?.particles.some(({ x, y, w, h }) =>
    x + w > 0 && y + h > 0 && y < geometry.stagePx.h); index++) {
    await advance(125);
    shifted = (await chestSparkleEvidence()).find(
      ({ chestLabel }) => chestLabel === offscreenCandidate.chestLabel,
    );
  }
  assert(shifted, JSON.stringify(sparkleEvidence));
  assert(shifted.art.x < 0 && shifted.art.x + shifted.art.w / 2 < 0, JSON.stringify(shifted));
  assert(shifted.particles.some(({ x, y, w, h }) =>
    x + w > 0 && y + h > 0 && y < geometry.stagePx.h), JSON.stringify(shifted));
  await captureFrame("cave-chest-sparkle-offscreen.png");
  fs.writeFileSync(
    path.join(outputDir, "cave-chest-sparkle-state.json"),
    `${JSON.stringify({
      state: snapshot,
      chest: shifted,
      browserErrors: errors,
    }, null, 2)}\n`,
  );
  await page.evaluate(({ worldX, worldY, worldLabel }) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === worldLabel) { node.position.set(worldX, worldY); return; }
      if (node?.children) stack.push(...node.children);
    }
  }, {
    worldX: offscreenProof.originalWorldX,
    worldY: offscreenProof.originalWorldY,
    worldLabel: offscreenProof.worldLabel,
  });
  await advance(16.67);
  assert.deepEqual(errors, [], `browser errors: ${errors.join(" | ")}`);
  await browser.close();
  console.log("dungeon chest sparkle scenario passed");
  process.exit(0);
  }
  const connectors = await connectorBounds();
  assert.equal(connectors.length, snapshot.connectors.length, JSON.stringify({ connectors, state: snapshot.connectors }));
  assert(connectors.every((entry) => Math.abs(entry.w - 60) < 1e-6 && Math.abs(entry.h - 60) < 1e-6),
    JSON.stringify(connectors));
  if (!encounterScenario && !sparkleOnlyScenario) {
    await captureFrame("cave-floor-settled.png");
    fs.writeFileSync(
      path.join(outputDir, "cave-floor-state.json"),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }

  if (reentryScenario) {
    assert.equal(routeFloor, 1, "dungeon re-entry fixture requires floor 1");
    const entrance = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
    assert(entrance?.zones.some((zone) => zone.kind === "worldExit"), JSON.stringify(entrance));
    const originalLayout = snapshot.rooms.map((room) => ({
      id: room.id,
      links: room.links.map((link) => link.targetRoomId),
    }));
    const originalSeed = snapshot.seed;
    const originalExplored = snapshot.rooms.filter((room) => room.explored).map((room) => room.id);

    await clickCurrentZone(snapshot);
    for (let index = 0; index < 320 && (await state()).mode !== "world"; index++) {
      await advance(25);
      if (index % 10 === 0) await page.waitForTimeout(2);
    }
    await advance(600);
    let world = await state();
    assert.equal(world.mode, "world", JSON.stringify(world));
    assert.equal(world.chrome.mapName.text, "Southern Alvalon");
    assert.equal(world.chrome.mapName.label, "worldNamePlate");
    const dungeonPoi = world.pois.find((poi) => poi.name === "Dungeon_1");
    assert(dungeonPoi, JSON.stringify(world.pois));
    const dungeonPoint = geometry.toCss(dungeonPoi.position);
    await page.mouse.click(dungeonPoint.x, dungeonPoint.y);
    for (let index = 0; index < 320 && (await state()).mode !== "dungeon"; index++) {
      await advance(25);
      if (index % 10 === 0) await page.waitForTimeout(2);
    }
    await advance(1_200);
    snapshot = await state();
    assert.equal(snapshot.mode, "dungeon", JSON.stringify(snapshot));
    assert.equal(snapshot.seed, originalSeed);
    assert.deepEqual(snapshot.rooms.map((room) => ({
      id: room.id,
      links: room.links.map((link) => link.targetRoomId),
    })), originalLayout);
    assert.deepEqual(
      snapshot.rooms.filter((room) => room.explored).map((room) => room.id),
      originalExplored,
    );
    assert.equal(snapshot.chrome.namePlate.text, "Lv:1 North Cave");
    const reentered = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
    assert(reentered?.zones.some((zone) => zone.kind === "worldExit"), JSON.stringify(reentered));
    await captureFrame("cave-reentered-cached-layout.png");
  } else if (routeFloor === 1 && !encounterScenario) {
    // Web-native WASD navigation selects the same linked RoomNode path. Deliberately prove that an
    // arrow key remains unbound before moving toward a safe adjacent room with W/A/S/D.
    const room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
    assert(room, "current room missing from render state");
    const linked = room.links.map((link) =>
      snapshot.rooms.find((candidate) => candidate.id === link.targetRoomId)).filter(Boolean);
    const target = linked.find((candidate) =>
      candidate.encounter === undefined && candidate.zones.length === 0) ?? linked[0];
    assert(target, "current room has no materialized linked target");
    const targetLink = room.links.find((link) => link.targetRoomId === target.id);
    assert(targetLink, "target room has no source link");
    const direction = targetLink.offset.x === -1
      ? "west"
      : targetLink.offset.x === room.width
        ? "east"
        : targetLink.offset.y === -1
          ? "south"
          : targetLink.offset.y === room.height
            ? "north"
            : undefined;
    assert(direction, `target link is not cardinal: ${JSON.stringify(targetLink)}`);
    const movementKey = { north: "w", east: "d", south: "s", west: "a" }[direction];
    await page.keyboard.press("ArrowUp");
    await advance(50);
    assert.equal((await state()).currentRoomId, room.id, "arrow navigation must remain unbound");
    await page.keyboard.press(movementKey);
    for (let index = 0; index < 160 && (await state()).currentRoomId === room.id; index++) await advance(25);
    for (let index = 0; index < 160; index++) {
      const current = await state();
      if (current.lootProvider !== undefined) {
        assert.equal(current.pendingAction, "treasure");
        assert(current.lootProvider.pendingCount > 0);
        const labels = await labeledNodeCounts();
        assert.equal(labels.dungeonLootPage, 1, JSON.stringify(labels));
        assert.equal(labels.dungeonLootTitle, 1, JSON.stringify(labels));
        assert.equal(labels.dungeonLootPrevious, 1, JSON.stringify(labels));
        assert.equal(labels.dungeonLootNext, 1, JSON.stringify(labels));
        assert.equal(labels["popupButton:Take All"], 1, JSON.stringify(labels));
        await captureFrame("cave-room-loot-popup.png");
        assert.equal(labels["popupButton:Ok"], undefined, JSON.stringify(labels));
        assert.equal(
          Object.entries(labels)
            .filter(([label]) => label.startsWith("dungeonLootItem:"))
            .reduce((sum, [, count]) => sum + count, 0),
          current.lootProvider.pendingCount,
          JSON.stringify(labels),
        );
        assert.equal(
          Object.keys(labels).some((label) => label.startsWith("dungeonLootCard:")),
          false,
          JSON.stringify(labels),
        );
        await clickLabeledNode("popupButton:Take All");
        await advance(50);
        continue;
      }
      if (current.mode !== "dungeon" || !current.locked) break;
      await advance(25);
      if (index % 10 === 0) await page.waitForTimeout(2);
    }
    await advance(350);

    snapshot = await state();
    assert.equal(snapshot.mode, "dungeon");
    assert.equal(snapshot.currentRoomId, target.id);
    assert(snapshot.rooms.some((candidate) => candidate.id === target.id && candidate.explored));
    await captureFrame("cave-after-room-touch.png");
  } else if (routeFloor === 1) {
    let room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
    assert(room, "current room missing from encounter fixture");
    const fixedRoom = snapshot.rooms.find((candidate) =>
      candidate.encounter === "encounter-fixed-0");
    assert(fixedRoom, `seed ${dungeonSeed} did not generate Rigel's fixed encounter`);
    if (!fixedRoom.explored) {
      for (let index = 0; index < 4 && (await state()).floorDetectionChat !== undefined; index++) {
        await page.keyboard.press("Enter");
        await advance(500);
      }
      assert.equal((await state()).floorDetectionChat, undefined,
        "Rigel detection chat retained dungeon navigation ownership");
      // The source Day 2 banner has priority while it is visible. Let its eight-second arrival
      // lifecycle finish before using RoomNode pointer input, as the other town/dungeon fixtures do.
      await advance(8_000);
      snapshot = await state();
      room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
      assert(room, "current room disappeared after the arrival notification");
      // Walk only through clear rooms until Rigel becomes a materialized direct neighbor. Native
      // `setCurrentRoom:` reveals linked rooms from each clear arrival; it does not create every
      // RoomNode up front, which is exactly the late-materialization clock path under audit.
      const byId = new Map(snapshot.rooms.map((candidate) => [candidate.id, candidate]));
      const parent = new Map([[room.id, undefined]]);
      const queue = [room.id];
      while (queue.length > 0 && !parent.has(fixedRoom.id)) {
        const currentId = queue.shift();
        const current = byId.get(currentId);
        if (!current) continue;
        for (const link of current.links) {
          if (parent.has(link.targetRoomId)) continue;
          const candidate = byId.get(link.targetRoomId);
          if (!candidate || (candidate.id !== fixedRoom.id && candidate.encounter !== undefined)) {
            continue;
          }
          parent.set(candidate.id, currentId);
          queue.push(candidate.id);
        }
      }
      assert(parent.has(fixedRoom.id),
        `Rigel has no clear-room reveal path: ${JSON.stringify(snapshot.rooms)}`);
      const pathToFixed = [];
      for (let id = fixedRoom.id; id !== undefined; id = parent.get(id)) pathToFixed.push(id);
      pathToFixed.reverse();
      for (const nextId of pathToFixed.slice(1, -1)) {
        const current = await state();
        const currentRoom = current.rooms.find((candidate) => candidate.id === current.currentRoomId);
        const nextRoom = current.rooms.find((candidate) => candidate.id === nextId);
        const link = currentRoom?.links.find((candidate) => candidate.targetRoomId === nextId);
        assert(currentRoom && nextRoom && link && nextRoom.explored,
          `next reveal-path room is not materialized: ${JSON.stringify({ nextId, current })}`);
        const tile = 60;
        const roomCenter = {
          x: nextRoom.x * tile + nextRoom.width * tile / 2,
          y: -(nextRoom.y + nextRoom.height) * tile + nextRoom.height * tile / 2,
        };
        const css = geometry.toCss({
          x: current.camera.x + roomCenter.x * current.camera.scale,
          y: current.camera.y + roomCenter.y * current.camera.scale,
        });
        await page.mouse.click(css.x, css.y);
        for (let index = 0; index < 160 && (await state()).currentRoomId !== nextId; index++) {
          await advance(25);
        }
        assert.equal((await state()).currentRoomId, nextId,
          `dungeon did not follow Rigel reveal path through ${nextId}`);
        await advance(650);
      }
      snapshot = await state();
      room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
      assert(room, "current room disappeared after Rigel reveal path");
    }
    const encounterTargets = room.links.map((link) =>
      snapshot.rooms.find((candidate) => candidate.id === link.targetRoomId))
      .filter((candidate) => candidate?.encounter !== undefined && candidate.explored);
    const target = encounterTargets.find((candidate) =>
      candidate?.encounter === "encounter-fixed-0");
    assert(target?.encounter, `seed ${dungeonSeed} has no adjacent materialized encounter`);

    const encounterPresentation = () => page.evaluate((label) => {
      let encounter;
      let world;
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === label) encounter = node;
        if (node?.label === "dungeonWorld") world = node;
        if (node?.children) stack.push(...node.children);
      }
      if (!encounter || !world) return undefined;
      const bounds = encounter.getBounds();
      const outlineIndex = encounter.children
        .findIndex((child) => child?.label === "dungeonEncounterOutline");
      const outline = outlineIndex === -1 ? undefined : encounter.children[outlineIndex];
      return {
        cocosAddBlend: [...window.__PIXI_APP__.renderer.state.blendModesMap["add-npm"]],
        parentLabel: encounter.parent?.label,
        center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
        scale: encounter.scale.x,
        contentSize: encounter.boundsArea === null ? null : {
          w: encounter.boundsArea.width,
          h: encounter.boundsArea.height,
        },
        camera: { x: world.x, y: world.y, scale: world.scale.x },
        outline: outline === undefined
          ? null
          : {
              index: outlineIndex,
              alpha: outline.alpha,
              childCount: encounter.children.length,
              stampCount: outline.children.length,
              stampBlendModes: outline.children.map((child) => child.blendMode),
              stampPositions: outline.children.map((child) => ({
                x: child.position.x,
                y: child.position.y,
              })),
              stampTints: outline.children.map((child) => child.tint),
              cached: outline.isCachedAsTexture,
              viewport: outline.boundsArea === null ? null : {
                x: outline.boundsArea.x,
                y: outline.boundsArea.y,
                w: outline.boundsArea.width,
                h: outline.boundsArea.height,
              },
            },
      };
    }, `dungeonEncounter:${target.encounter}`);
    const transitionPresentation = () => page.evaluate(() => {
      let shade;
      let notificationHost;
      let namePlate;
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "dungeonBattleTransitionShade") shade = node;
        if (node?.label === "worldNotificationHost") notificationHost = node;
        if (node?.label === "dungeonNamePlate") namePlate = node;
        if (node?.children) stack.push(...node.children);
      }
      return {
        shade: shade === undefined
          ? null
          : {
              alpha: shade.alpha,
              parentIndex: shade.parent?.children.indexOf(shade),
              zIndex: shade.zIndex,
            },
        notificationHost: notificationHost === undefined
          ? null
          : {
              parentIndex: notificationHost.parent?.children.indexOf(notificationHost),
              zIndex: notificationHost.zIndex,
            },
        namePlate: namePlate === undefined
          ? null
          : { visible: namePlate.visible, alpha: namePlate.alpha },
      };
    });
    const marker = await encounterPresentation();
    assert(marker, "adjacent encounter marker has no rendered bounds");


    assert(marker.outline, `encounter preview has no outline child: ${JSON.stringify(marker)}`);
    assert.equal(marker.outline.index, 0, JSON.stringify(marker.outline));
    // A native fade-out midpoint is exactly zero; sampling there is valid rather than a missing
    // outline. Presence/composition are proved independently below.
    assert(marker.outline.alpha >= 0 && marker.outline.alpha <= 1, JSON.stringify(marker.outline));
    // This pinned North Cave seed exposes Rigel's breeder encounter first, whose preview is the
    // odd-height Bitewing-hd sprite. It distinguishes native integer target truncation from Pixi's
    // former inferred-bounds ceil and proves that only the baked visits use additive-npm.
    assert.equal(target.encounter, "encounter-fixed-0", JSON.stringify(target));
    assert(marker.contentSize, JSON.stringify(marker));
    const sourceScale = snapshot.displayMode === "ipad" ? 2 : 1;
    const radius = snapshot.displayMode === "ipad" ? 1.5 : 3;
    const expectedW = Math.trunc((marker.contentSize.w + radius * 2) * sourceScale) / sourceScale;
    const expectedH = Math.trunc((marker.contentSize.h + radius * 2) * sourceScale) / sourceScale;
    assert.deepEqual(marker.outline.viewport, {
      x: (marker.contentSize.w - expectedW) / 2,
      y: (marker.contentSize.h - expectedH) / 2,
      w: expectedW,
      h: expectedH,
    });
    assert.equal(marker.outline.cached, true, JSON.stringify(marker.outline));
    assert.equal(marker.outline.stampCount, 12, JSON.stringify(marker.outline));
    assert.deepEqual(marker.cocosAddBlend, [770, 1], JSON.stringify(marker.cocosAddBlend));
    assert(marker.outline.stampBlendModes.every((mode) => mode === "add-npm"),
      JSON.stringify(marker.outline));
    const closeTo = (actual, expected) => Math.abs(actual - expected) < 1e-6;
    assert(
      closeTo(marker.outline.stampPositions[0].x, marker.outline.viewport.x + radius * 2) &&
        closeTo(marker.outline.stampPositions[0].y, marker.outline.viewport.y + radius),
      `first stamp lost native centering residual: ${JSON.stringify(marker.outline)}`,
    );
    assert(
      closeTo(marker.outline.stampPositions[6].x, marker.outline.viewport.x) &&
        closeTo(marker.outline.stampPositions[6].y, marker.outline.viewport.y + radius),
      `opposite stamp lost native centering residual: ${JSON.stringify(marker.outline)}`,
    );
    assert(marker.outline.stampTints.every((tint) => tint === 0xff0000),
      JSON.stringify(marker.outline));
    const triggerLink = room.links.find((link) => link.targetRoomId === target.id);
    assert(triggerLink, "Rigel marker is no longer linked from the reveal-path room");
    const triggerKey = triggerLink.offset.x === -1
      ? "a"
      : triggerLink.offset.x === room.width
        ? "d"
        : triggerLink.offset.y === -1
          ? "s"
          : triggerLink.offset.y === room.height
            ? "w"
            : undefined;
    assert(triggerKey, `Rigel trigger link is not cardinal: ${JSON.stringify(triggerLink)}`);
    // The late marker is legitimately above the clipped camera after this source-valid reveal
    // route, so use the app's direct-link keyboard seam to enter its room and trigger the same
    // RoomNode encounter path rather than synthesizing an off-canvas pointer.
    await page.keyboard.press(triggerKey);
    let flourishStart;
    for (let index = 0; index < 200; index++) {
      flourishStart = await encounterPresentation();
      if (flourishStart?.parentLabel === "dungeonPointRoot") break;
      await advance(10);
      if (index % 10 === 0) await page.waitForTimeout(2);
    }
    assert.equal(flourishStart?.parentLabel, "dungeonPointRoot", JSON.stringify(flourishStart));
    await captureFrame("encounter-flourish-start.png");
    await advance(500);
    const halfway = await encounterPresentation();
    assert(halfway, "encounter presentation disappeared before the 500ms checkpoint");
    // The camera tween is sampled on the fixed 16.67ms presentation clock, so a nominal 500ms
    // checkpoint can land one fractional tick from the exact 1.5 source scale.
    assert(Math.abs(halfway.camera.scale - 1.5) < 0.001, JSON.stringify(halfway));
    assert(Math.abs(halfway.scale - (flourishStart.scale + (1 - flourishStart.scale) / 2)) < 0.02,
      JSON.stringify({ flourishStart, halfway }));
    // `getBounds()` includes FixedStage's root transform, so the flourish converges on the Pixi
    // renderer's screen center rather than the pre-letterbox logical-stage center.
    const viewportCenter = await page.evaluate(() => ({
      x: window.__PIXI_APP__.screen.width / 2,
      y: window.__PIXI_APP__.screen.height / 2,
    }));
    assert(Math.abs(halfway.center.x - (flourishStart.center.x + viewportCenter.x) / 2) < 8,
      JSON.stringify({ flourishStart, halfway }));
    assert(Math.abs(halfway.center.y - (flourishStart.center.y + viewportCenter.y) / 2) < 8,
      JSON.stringify({ flourishStart, halfway }));
    // The outline is a child, so it reparents and scales with the sprite (`visit`-stamped into the
    // render texture, then carried by `addChild:z:-1`).
    assert(halfway.outline, `outline lost during the flourish: ${JSON.stringify(halfway)}`);
    assert.equal(halfway.outline.index, 0, JSON.stringify(halfway.outline));
    await captureFrame("encounter-flourish-500ms.png");
    await advance(475);
    const almostFinished = await encounterPresentation();
    assert(almostFinished, "encounter presentation disappeared before the 975ms checkpoint");
    assert(Math.abs(almostFinished.camera.scale - 1.5) < 0.001, JSON.stringify(almostFinished));
    assert(Math.abs(almostFinished.scale - 1) < 0.01, JSON.stringify(almostFinished));
    assert(Math.abs(almostFinished.center.x - viewportCenter.x) < 8, JSON.stringify(almostFinished));
    assert(Math.abs(almostFinished.center.y - viewportCenter.y) < 8, JSON.stringify(almostFinished));
    assert.equal((await transitionPresentation()).shade, null,
      "white transition began before RoomNode's one-second callback");
    await captureFrame("encounter-flourish-975ms.png");

    // The source callback starts CCTransitionFade at exactly 1.0s. Browser-only asset decoding and
    // durable checkpointing began at flourish start and now continue behind this cover; neither is
    // allowed to pin the fully centred monster on screen.
    await advance(25);
    let transition = await transitionPresentation();
    let transitionStartSamplingMs = 0;
    while (transition.shade === null && transitionStartSamplingMs < 50) {
      await advance(5);
      transitionStartSamplingMs += 5;
      transition = await transitionPresentation();
    }
    assert(transition.shade, JSON.stringify(transition));
    assert(transitionStartSamplingMs <= 20,
      `white transition missed the next fixed presentation tick: ${JSON.stringify(transition)}`);
    assert(transition.shade.alpha >= 0 && transition.shade.alpha <= 0.2, JSON.stringify(transition));
    assert(transition.notificationHost, JSON.stringify(transition));
    assert(transition.notificationHost.zIndex > transition.shade.zIndex, JSON.stringify(transition));
    await captureFrame("encounter-transition-start.png");

    await advance(125);
    transition = await transitionPresentation();
    assert(transition.shade?.alpha >= 0.4 && transition.shade.alpha <= 0.65,
      JSON.stringify(transition));
    await captureFrame("encounter-transition-white-in-half.png");

    await advance(125);
    transition = await transitionPresentation();
    assert(transition.shade?.alpha >= 0.99, JSON.stringify(transition));
    // Scene preparation may finish on an IndexedDB/decode continuation. Advance the deterministic
    // clock in small slices while the cover is already opaque; this preserves a measurable hold
    // without ever exposing either the centred marker or a partially built battle.
    let opaqueHoldPresentationMs = 0;
    for (let index = 0; index < 6000 && (await state()).mode !== "battle"; index++) {
      await advance(5);
      opaqueHoldPresentationMs += 5;
    }
    let battleEntry = await state();
    assert.equal(battleEntry.mode, "battle", JSON.stringify(battleEntry));
    assert.equal(battleEntry.entry.sceneVisible, false, JSON.stringify(battleEntry.entry));
    assert.equal(battleEntry.entry.transitionFinished, false, JSON.stringify(battleEntry.entry));
    assert.equal(battleEntry.entry.enemyEntranceStarted, false, JSON.stringify(battleEntry.entry));
    await captureFrame("encounter-transition-white-midpoint.png");

    await advance(125);
    transition = await transitionPresentation();
    assert(transition.shade?.alpha >= 0.35 && transition.shade.alpha <= 0.65,
      JSON.stringify(transition));
    battleEntry = await state();
    assert.equal(battleEntry.entry.transitionFinished, false, JSON.stringify(battleEntry.entry));
    assert.equal(battleEntry.entry.enemyEntranceStarted, false, JSON.stringify(battleEntry.entry));
    await captureFrame("encounter-transition-white-out-half.png");

    await advance(125);
    transition = await transitionPresentation();
    let transitionFinishSamplingMs = 0;
    while (transition.shade !== null && transitionFinishSamplingMs < 20) {
      await advance(1);
      transitionFinishSamplingMs += 1;
      transition = await transitionPresentation();
    }
    assert.equal(transition.shade, null, JSON.stringify(transition));
    assert(transitionFinishSamplingMs <= 5,
      `white transition cleanup missed the next fixed presentation tick: ${JSON.stringify(transition)}`);
    battleEntry = await state();
    assert.equal(battleEntry.entry.transitionFinished, true, JSON.stringify(battleEntry.entry));
    assert.equal(battleEntry.entry.enemyEntranceStarted, true, JSON.stringify(battleEntry.entry));
    await captureFrame("encounter-battle-entry-ready.png");

    fs.writeFileSync(
      path.join(outputDir, "encounter-entry-state.json"),
      `${JSON.stringify({
        flourishStart,
        halfway,
        almostFinished,
        transitionStartSamplingMs,
        transitionFinishSamplingMs,
        opaqueHoldPresentationMs,
        battleEntry,
        browserErrors: errors,
      }, null, 2)}\n`,
    );
  } else {
    const awaitCoveredFloorAssignment = async (expectedFloor) => {
      for (let index = 0; index < 320 && (await state()).floor !== expectedFloor; index++) {
        await advance(25);
        if (index % 10 === 0) await page.waitForTimeout(2);
      }
      let arrived = await state();
      assert.equal(arrived.mode, "dungeon", JSON.stringify(arrived));
      assert.equal(arrived.floor, expectedFloor, JSON.stringify(arrived));
      // DungeonNode.setCurrentRoom is queued before the incoming source scene is added. At the
      // opaque midpoint its first 0.25s fade has completed, rather than beginning after the cover.
      assert(
        arrived.hero.alpha <= 0.15,
        `floor ${expectedFloor} hero assignment escaped the transition cover: ${JSON.stringify(arrived.hero)}`,
      );
      await advance(125);
      arrived = await state();
      assert(
        arrived.hero.alpha >= 0.35 && arrived.hero.alpha <= 0.7,
        `floor ${expectedFloor} hero did not fade in concurrently with the cover: ${JSON.stringify(arrived.hero)}`,
      );
      await advance(1_075);
      return state();
    };

    await captureFrame("floor-2-before-up.png");
    await clickCurrentZone(snapshot);
    snapshot = await awaitCoveredFloorAssignment(1);
    assert.equal(snapshot.locked, false, JSON.stringify(snapshot));
    let current = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
    assert(current?.zones.some((zone) => zone.kind === "stairsDown"), JSON.stringify(current));
    await captureFrame("floor-1-arrived-at-down.png");

    await clickCurrentZone(snapshot);
    snapshot = await awaitCoveredFloorAssignment(2);
    current = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
    assert(current?.zones.some((zone) => zone.kind === "stairsUp"), JSON.stringify(current));
    await captureFrame("floor-2-arrived-at-up.png");
  }

  if (!encounterScenario && !reentryScenario && routeFloor === 1) {
    await clickLabeledNode("dungeonMenuButton");
    await waitForState(
      (value) => value.menu?.config === "MasterMenu",
      "dungeon MasterMenu did not open for Town Portal",
    );
    await clickWorldMenuAction("townPortal");
    snapshot = await waitForState(
      (value) => value.mode === "town" && value.town?.name,
      "dungeon Town Portal did not auto-enter the saved/default town",
      320,
    );
    assert.equal(snapshot.menu, null);
    assert.equal((await labeledNodeCounts()).dungeonMasterMenu, undefined);
    assert.equal((await labeledNodeCounts()).dungeonMenuButton, undefined);
    await captureFrame("dungeon-town-portal-arrival.png");
  }
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(encounterScenario
    ? "dungeon-encounter: PASS (500ms forced zoom and halfway monster move/scale)"
    : reentryScenario
    ? "dungeon-reentry: PASS (claim reward, world plate, cached layout, floor plate)"
    : routeFloor === 1
    ? "dungeon-loop: PASS (native topology, WASD movement, unbound arrows, menu routes, Town Portal)"
    : "dungeon-stairs: PASS (floor 2 up to floor 1, then downstairs back to synthesized floor 2 Up)");
} finally {
  await browser.close();
}
