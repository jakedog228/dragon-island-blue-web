// Opt-in Warp Gate contract. Run only with operator authorization; Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(
  process.env.DIB_TOWN_WARP_OUTPUT ??
    path.join(import.meta.dirname, "../../../../output/town-warp-browser"),
);
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: process.env.DIB_HEADED !== "1",
  args: [
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
  ],
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
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WARP_GATE_EVIDENCE__ = true;
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_NAME__ = "World_3-3";
    window.__DIB_TEST_POI_NAME__ = "Longdale_City";
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_VISITED_TOWN_COUNT__ = 0;
    window.__DIB_TEST_WORLD_SEED__ = 17;
    window.__DIB_TEST_BATTLE_SEED__ = 5;
    // This completed-story fixture accounts for every Longdale-authored side quest while keeping
    // LiberateTownsQuest active, so the post-victory visited row exercises the native zero badge.
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 80;
    window.__DIB_TEST_GUILD_QUEST_NAMES__ = ["LiberateTownsQuest"];
    window.__DIB_TEST_DIALOGS_SEEN__ = [
      "GiselleIntro3", "LeslieIntro18", "LeslieIntro22", "OmarIntro1",
      "ConstanceIntro1", "KaiIntro1", "RenIntro2", "LeslieIntro19",
      "EnyaIntro4", "NemoIntro1", "LeslieIntro21",
    ];
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 100,
      monsterPartyLevels: [100, 100, 100, 100, 100, 100],
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: [
        "Tutorial0", "Tutorial1", "Tutorial2", "Tutorial4", "TownWarpTutorial", "flashTownExit",
      ],
    };
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 6,
      battingOrderSize: 6,
      levelRange: [100, 100],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const canvas = page.locator("canvas").first();
  const canvasBounds = await canvas.boundingBox();
  assert(canvasBounds, "Pixi canvas is unavailable");
  const geometry = await stageGeometry(page, canvasBounds);
  const nodeCenter = (label) => page.evaluate((wanted) => {
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
        const point = node.hitArea && Number.isFinite(node.hitArea.x)
          ? node.toGlobal({
              x: node.hitArea.x + node.hitArea.width / 2,
              y: node.hitArea.y + node.hitArea.height / 2,
            })
          : (() => {
              const bounds = node.getBounds();
              return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
            })();
        const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(point.x, point.y);
        const hitPath = [];
        for (let current = hit; current; current = current.parent) {
          hitPath.push(current.label ?? null);
        }
        // A source `PopupMenu` row is deliberately inert (`eventMode: "none"`) and its touch is
        // arbitrated by the container that owns the whole item list, so the top hit is legitimately
        // an ANCESTOR of the labelled visual rather than the visual itself. What still has to hold
        // is that the owner sits on this node's own chain -- an unrelated card swallowing the pixel
        // would not.
        let owned = false;
        for (let current = node; current && !owned; current = current.parent) {
          owned = current === hit;
        }
        return { x: point.x, y: point.y, hitPath, owned };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, label);
  const clickNode = async (label) => {
    let previous = null;
    let point = null;
    for (let index = 0; index < 240; index++) {
      point = await nodeCenter(label);
      if (
        point !== null &&
        previous !== null &&
        Math.abs(point.x - previous.x) < 1e-6 &&
        Math.abs(point.y - previous.y) < 1e-6
      ) break;
      previous = point;
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    assert(point, `missing visible Pixi node ${label}`);
    assert(
      point.owned,
      `${label}'s physical click point is not owned by the node or its arbitrating ancestors: `
      + JSON.stringify(point.hitPath),
    );
    await page.mouse.click(canvasBounds.x + point.x, canvasBounds.y + point.y);
  };
  const clickBattleSwipe = async () => {
    const current = await state();
    const target = current.monsters.find((monster) => monster.team === 1 && monster.visible);
    assert(target?.targetPoint && target.targetSize, "Longdale battle has no visible enemy target");
    const lane = Math.max(40, target.targetSize.w * 0.75);
    const start = geometry.toCss({ x: target.targetPoint.x - lane, y: target.targetPoint.y });
    const end = geometry.toCss({ x: target.targetPoint.x + lane, y: target.targetPoint.y });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let index = 1; index <= 18; index++) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * index) / 18,
        start.y,
        { steps: 1 },
      );
    }
    await page.mouse.up();
  };
  for (let index = 0; index < 600 && (await state()).startup?.phase !== "title"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
  await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    const current = await state();
    if (current.startup?.phase === "save-select" || ["world", "town"].includes(current.mode)) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  if ((await state()).startup?.phase === "save-select") await page.keyboard.press("Enter");
  for (let index = 0; index < 600; index++) {
    if (await page.evaluate(() => typeof window.__DIB_TEST_OPEN_TOWN_WARP__ === "function")) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  for (let index = 0; index < 600; index++) {
    const current = await state();
    if (["world", "town"].includes(current.mode) && !current.locked && current.overlay === null) break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  // Longdale is the current and only visited town. With LiberateTownsQuest active and its fixed
  // battle absent, source `TownWarpMenuItem activate:` presents this disabled chat and does not
  // construct a picker.
  const warpIcon = "town:Longdale_City:menu:TownWarpMenuItem";
  const warpHouse = "town:Longdale_City:building:3";
  console.log("town-warp: Longdale ready; testing disabled icon");
  await clickNode(warpIcon);
  await page.waitForFunction(() => {
    const current = JSON.parse(window.render_game_to_text());
    return current.overlay?.kind === "guildQuestChat" &&
      current.overlay.chatName === "TownPortalsDisabledChatKey";
  });
  let snapshot = await state();
  assert.deepEqual(snapshot.overlay, {
    kind: "guildQuestChat",
    chatName: "TownPortalsDisabledChatKey",
  });
  await page.waitForFunction(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "guildQuestChat" && node.visible && node.renderable) return true;
      stack.push(...(node?.children ?? []));
    }
    return false;
  });
  await advance(100);
  await page.waitForTimeout(25);
  await page.screenshot({
    path: path.join(outputDir, "01-liberate-warp-disabled.png"),
    timeout: 120_000,
  });
  await advance(550);
  await clickNode("guildQuestChat");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).overlay === null);

  // Reproduce the report's literal house tap independently of the floating Warp icon. Before the
  // Guild encounter it must reach the same source-disabled chat instead of falling through.
  console.log("town-warp: disabled icon passed; testing disabled house");
  await clickNode(warpHouse);
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).overlay?.chatName === "TownPortalsDisabledChatKey");
  await page.waitForFunction(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "guildQuestChat" && node.visible && node.renderable) return true;
      stack.push(...(node?.children ?? []));
    }
    return false;
  });
  await advance(550);
  await clickNode("guildQuestChat");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).overlay === null);

  // Leave Longdale, physically reselect the current town, and win its real shipped fixed
  // encounter. This exercises BattleNode.performWinLogic, event 9, the retained WorldNode return,
  // and the exact post-modal state that the former debug-event shortcut skipped.
  console.log("town-warp: disabled house passed; launching Longdale fixed encounter");
  await clickNode("town:Longdale_City:exit");
  for (let index = 0; index < 800 && (await state()).mode !== "world"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  await advance(1_100);
  snapshot = await state();
  assert.equal(snapshot.mode, "world", "Longdale did not return to its retained world map");
  const longdale = snapshot.pois.find(({ name, state: poiState }) =>
    name === "Longdale_City" && poiState === 2);
  assert(longdale, `Longdale is not the current town POI: ${JSON.stringify(snapshot.poiStates)}`);
  const townPoint = geometry.toCss({ x: longdale.position.x + 8, y: longdale.position.y });
  await page.mouse.click(townPoint.x, townPoint.y);
  for (let index = 0; index < 800 && (await state()).mode !== "battle"; index++) {
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  snapshot = await state();
  assert.equal(snapshot.mode, "battle", "Longdale fixed encounter did not launch");
  assert.equal(snapshot.encounter.questKey, "LiberateTownsQuest");
  assert.equal(snapshot.encounter.uniqueKey, "RenderableLongdale_CityNameKey");
  console.log("town-warp: real Longdale fixed encounter mounted");
  let submittedMoves = 0;
  let capturedInteractiveBattle = false;
  for (let index = 0; index < 6_000; index++) {
    snapshot = await state();
    if (snapshot.mode === "town") break;
    assert.equal(snapshot.mode, "battle", `unexpected mode during Longdale battle: ${snapshot.mode}`);
    if (snapshot.activePopup === "encounterChat") {
      await advance(550);
      await clickNode("guildQuestChat");
    } else if (snapshot.activePopup === "xpAward" && snapshot.postBattleButtons.length > 0) {
      const action = geometry.toCss(snapshot.postBattleButtons[0].point);
      await page.mouse.click(action.x, action.y);
    } else if (snapshot.statusText?.visible) {
      await page.keyboard.press("Enter");
    } else if (
      snapshot.presentation.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible &&
      !snapshot.turnOrderAnimating
    ) {
      if (!capturedInteractiveBattle) {
        assert.equal(snapshot.entry?.transitionFinished, true, "Longdale battle transition stayed opaque");
        assert(
          snapshot.monsters.some((monster) => monster.team === 1 && monster.visible),
          "Longdale battle rendered no visible Cockatrice opponent",
        );
        await page.waitForTimeout(25);
        await page.screenshot({
          path: path.join(outputDir, "02-longdale-fixed-battle.png"),
          timeout: 120_000,
        });
        capturedInteractiveBattle = true;
      }
      await clickBattleSwipe();
      submittedMoves += 1;
    } else {
      await advance(50);
    }
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  snapshot = await state();
  assert.equal(snapshot.mode, "town", `Longdale victory did not return to town: ${JSON.stringify(snapshot)}`);
  assert(capturedInteractiveBattle, "Longdale fixed battle never exposed an interactive combat board");
  assert(submittedMoves > 0, "Longdale fixed battle completed without physical player input");
  assert.equal(snapshot.town?.name, "Longdale_City");
  console.log(`town-warp: real Longdale victory returned to town after ${submittedMoves} moves`);

  // Dismiss every source post-win/town-entry chat before testing the gate. A click while one of
  // these owns the stage is correctly swallowed and would recreate a modal-timing false positive.
  for (let pageIndex = 0; pageIndex < 30; pageIndex++) {
    snapshot = await state();
    if (snapshot.overlay === null && !snapshot.locked) break;
    if (snapshot.overlay?.chatOpen || snapshot.overlay?.kind === "townEnterChat") {
      await advance(550);
      await clickNode("guildQuestChat");
    } else {
      await advance(50);
    }
  }
  snapshot = await state();
  assert.equal(snapshot.overlay, null, "Longdale post-win chat chain did not finish");
  assert.equal(snapshot.locked, false, "Longdale remained locked after its post-win return");

  console.log("town-warp: post-win modal chain drained; testing physical house picker");
  await clickNode(warpHouse);
  const postWinObservations = [];
  for (let index = 0; index < 240; index++) {
    snapshot = await state();
    const observation = JSON.stringify({
      locked: snapshot.locked,
      overlay: snapshot.overlay,
      inputBlockers: snapshot.inputBlockers,
      guildQuests: snapshot.guildQuests,
    });
    if (postWinObservations.at(-1) !== observation) postWinObservations.push(observation);
    if (snapshot.overlay?.kind === "townWarp") break;
    await advance(25);
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  snapshot = await state();
  if (snapshot.overlay?.kind !== "townWarp") {
    const persisted = await page.evaluate(() =>
      window.__DIB_TEST_RESTART_SESSION__.snapshot());
    await page.screenshot({
      path: path.join(outputDir, "03-post-win-inert.png"),
      timeout: 120_000,
    });
    throw new Error(
      `physical post-win Warp house remained inert; observations=${postWinObservations.join(" -> ")}; ` +
        `persistedQuests=${JSON.stringify(persisted?.quests)}; errors=${JSON.stringify(errors)}`,
    );
  }
  await advance(50);
  await page.waitForTimeout(25);

  snapshot = await state();
  assert.equal(snapshot.overlay.config, "TownWarp");
  assert(snapshot.overlay.destinations.some(({ townName, visited, autoCloseOnInvoke }) =>
    townName === "Longdale_City" && visited && autoCloseOnInvoke));
  assert.equal(snapshot.overlay.destinations.filter(({ visited }) => visited).length, 1);
  assert.equal(snapshot.overlay.destinations.length, 2);
  const visitedEndgameDestination = snapshot.overlay.destinations.find(({ visited }) => visited);
  assert(visitedEndgameDestination, "completed-story Warp picker has no visited destination");
  assert.equal(visitedEndgameDestination.questCount, 0);
  assert.equal(visitedEndgameDestination.questBadgeVisible, true);
  assert.equal(
    await page.evaluate((townName) => {
      const wanted = `townWarp:badge:${townName}`;
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === wanted && node.visible && node.renderable) return true;
        stack.push(...(node?.children ?? []));
      }
      return false;
    }, visitedEndgameDestination.townName),
    true,
    "source zero-count quest badge is absent from the visible Pixi tree",
  );
  const columnLengths = [0, 0, 0];
  for (const destination of snapshot.overlay.destinations) {
    assert(
      Number.isInteger(destination.column) && destination.column >= 0 && destination.column < 3,
      `Warp destination has invalid source column ${String(destination.column)}`,
    );
    columnLengths[destination.column] += 1;
  }
  assert.deepEqual(
    columnLengths,
    [1, 1, 0],
    "Liberate Towns Warp picker did not preserve its valid empty third source column",
  );
  assert(snapshot.overlay.destinations.some(({ label }) => label === "??????"));
  assert(snapshot.overlay.destinations
    .filter(({ visited }) => visited)
    .every(({ autoCloseOnInvoke }) => autoCloseOnInvoke));
  assert(snapshot.overlay.destinations
    .filter(({ visited }) => !visited)
    .every(({ autoCloseOnInvoke }) => !autoCloseOnInvoke));
  await page.screenshot({
    path: path.join(outputDir, "03-liberate-warp-picker.png"),
    timeout: 120_000,
  });

  const unknown = snapshot.overlay.destinations.find(({ visited }) => !visited);
  assert(unknown);
  const unknownCss = geometry.toCss({
    x: unknown.backgroundBounds.x + unknown.backgroundBounds.w / 2,
    y: unknown.backgroundBounds.y + unknown.backgroundBounds.h / 2,
  });
  await page.mouse.click(unknownCss.x, unknownCss.y);
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).overlay?.popups?.depth === 1);
  // PopupNode scales Y from 0 to 1 over the source 0.2-second pop-in. Capture only after that
  // transition completes so the visual proof is not a vertically squashed intermediate frame.
  await advance(250);
  await page.waitForTimeout(25);
  snapshot = await state();
  assert.equal(snapshot.overlay.kind, "townWarp", "unknown town closed the Warp menu");
  assert.equal(snapshot.overlay.popups.depth, 1, "UnknownTown popup was not presented");
  await page.screenshot({
    path: path.join(outputDir, "04-unknown-town.png"),
    timeout: 120_000,
  });

  // The popup's source-authored Ok button closes the top popup first; the Warp Gate remains open.
  await clickNode("popupButton:Ok");
  await page.waitForFunction(() =>
    JSON.parse(window.render_game_to_text()).overlay?.popups?.depth === 0);
  snapshot = await state();
  const visited = snapshot.overlay.destinations.find(({ visited }) => visited);
  assert(visited);
  const visitedCss = geometry.toCss({
    x: visited.backgroundBounds.x + visited.backgroundBounds.w / 2,
    y: visited.backgroundBounds.y + visited.backgroundBounds.h / 2,
  });
  await page.mouse.click(visitedCss.x, visitedCss.y);
  await advance(500);
  await page.waitForFunction((townName) => {
    const current = JSON.parse(window.render_game_to_text());
    return current.mode === "town" && current.town?.name === townName && current.overlay === null;
  }, visited.townName);
  await advance(1_100);
  await page.waitForTimeout(25);
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: path.join(outputDir, "05-warped-town.png"),
    timeout: 120_000,
  });
  console.log(
    `town-warp: PASS (physical disabled icon/house, real Longdale victory, retained-town picker; ${submittedMoves} moves)`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
