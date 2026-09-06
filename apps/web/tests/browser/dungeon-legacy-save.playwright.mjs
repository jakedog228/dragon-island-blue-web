// Opt-in regression for the schema-1 dungeon topology migration. This deliberately writes the
// pre-native `room-N` signature into a real browser-local slot, reloads through title/save select,
// and proves boot repairs the run instead of trapping the player at login.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/dungeon-legacy-save");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const warnings = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
    if (message.type() === "warning") warnings.push(message.text());
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    // The first launch below is a fresh source-capable slot, so startup would otherwise open
    // the 31s scrolling new-game plot before the dungeon (`main.ts` source-intro gate). This
    // scenario is about legacy dungeon topology, not the intro; `intro`/`intro-chat` own that
    // route. The later reload selects an OCCUPIED slot, which never begins a new game.
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 7;
    window.__DIB_TEST_DUNGEON_SEED__ = 3;
    if (localStorage.getItem("dib-legacy-dungeon-abandon") !== "1") {
      window.__DIB_TEST_DUNGEON_ROUTE__ = {
        typeName: "Cave",
        sourceFile: "Dungeon_1.plist",
        floor: 1,
      };
    }
  });

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(1);
  };
  const launchSelectedContent = async (expectedMode = "dungeon") => {
    await loadLocalContent(page);
    for (let index = 0; index < 240 && (await state()).startup?.phase !== "title"; index++) {
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    assert(box, "missing Pixi canvas");
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
    await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
    for (let index = 0; index < 480; index++) {
      const snapshot = await state();
      if (snapshot.mode === expectedMode || snapshot.startup?.phase === "save-select") break;
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    if ((await state()).startup?.phase === "save-select") {
      const snapshot = await state();
      const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
      assert(slot?.enabled, `save slot 1 unavailable: ${JSON.stringify(snapshot.startup)}`);
      const geometry = await stageGeometry(page, box);
      const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
      await page.mouse.click(point.x, point.y);
      for (let index = 0; index < 480 && (await state()).mode !== expectedMode; index++) {
        await advance(25);
        if (index % 20 === 0) await page.waitForTimeout(2);
      }
    }
    const launchState = await state();
    if (launchState.mode !== expectedMode) {
      const diagnostic = await page.evaluate(() => {
        const result = [];
        const visit = (node, depth = 0) => {
          if (node?.label && /dungeon|startup|shade/i.test(node.label)) {
            result.push({
              label: node.label,
              depth,
              visible: node.visible,
              renderable: node.renderable,
              destroyed: node.destroyed,
            });
          }
          for (const child of node?.children ?? []) visit(child, depth + 1);
        };
        visit(window.__PIXI_APP__.stage);
        return result;
      });
      assert.fail(
        `${JSON.stringify(launchState)} mounted=${JSON.stringify(diagnostic)} ` +
          `errors=${JSON.stringify(errors)} warnings=${JSON.stringify(warnings)}`,
      );
    }
  };

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await launchSelectedContent();

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box, "missing Pixi canvas after dungeon launch");
  const hasLabel = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) return true;
      if (node?.children) stack.push(...node.children);
    }
    return false;
  }, label);
  for (let index = 0; index < 240 && await hasLabel("startupTransitionShade"); index++) {
    await advance(25);
    if (index % 10 === 0) await page.waitForTimeout(2);
  }
  if (await hasLabel("catchQuestDisplay")) {
    await tapPixiLabel(page, "catchQuestClose");
    for (let index = 0; index < 80 && await hasLabel("catchQuestDisplay"); index++) {
      await advance(25);
    }
    assert.equal(await hasLabel("catchQuestDisplay"), false, "catch quest display did not close");
  }

  const legacyKey = await page.waitForFunction(() => {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith("dib-save-v1:") && key.endsWith(":slot-1")) {
        const envelope = JSON.parse(localStorage.getItem(key));
        if (envelope.state?.dungeon) return key;
      }
    }
    return undefined;
  }).then((handle) => handle.jsonValue());
  assert.equal(typeof legacyKey, "string", "active dungeon slot was not checkpointed");

  await page.evaluate((key) => {
    const envelope = JSON.parse(localStorage.getItem(key));
    const legacySession = {
      ...envelope.state.dungeon.current.session,
      currentRoomId: "room-0",
      exploredRoomIds: ["room-0"],
      clearedEncounterIds: [],
      collectedTreasureIds: [],
    };
    // These fields were introduced with the native-topology snapshot. A genuine pre-native save
    // cannot carry them: their room/encounter identities cannot be mapped honestly, and the
    // migration deliberately rejects a synthetic `room-N` floor that claims otherwise.
    delete legacySession.previousRoomId;
    delete legacySession.encounterRosters;
    delete legacySession.generationGateDecisions;
    envelope.state.dungeon.current.session = legacySession;
    envelope.state.dungeon.cachedFloors = envelope.state.dungeon.cachedFloors.map((entry) => ({
      ...entry,
      session: legacySession,
    }));
    localStorage.setItem(key, JSON.stringify(envelope));
  }, legacyKey);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await launchSelectedContent();
  for (let index = 0; index < 240 && await hasLabel("startupTransitionShade"); index++) {
    await advance(25);
    if (index % 10 === 0) await page.waitForTimeout(2);
  }
  assert.equal(await hasLabel("startupTransitionShade"), false, "restored startup transition did not finish");
  await advance(100);
  const restored = await state();
  assert.equal(restored.mode, "dungeon", JSON.stringify(restored));
  assert.notEqual(restored.currentRoomId, "room-0");
  assert.match(restored.currentRoomId, /^Cave\.[^-]+-\{-?\d+, -?\d+\}$/);
  assert(
    warnings.some((warning) => warning.includes("Migrated a pre-native-topology dungeon save")),
    `missing migration diagnostic: ${JSON.stringify(warnings)}`,
  );

  await page.waitForFunction((key) => {
    const envelope = JSON.parse(localStorage.getItem(key));
    return envelope.state?.dungeon?.current?.session?.currentRoomId !== "room-0";
  }, legacyKey);
  await page.screenshot({
    path: path.join(outputDir, "restored-native-dungeon.png"),
    timeout: 120_000,
  });
  fs.writeFileSync(
    path.join(outputDir, "restored-state.json"),
    `${JSON.stringify(restored, null, 2)}\n`,
  );


  await page.evaluate((key) => {
    const envelope = JSON.parse(localStorage.getItem(key));
    const missingRoomId = "Cave.Missing-{999, 999}";
    const incompatibleSession = {
      ...envelope.state.dungeon.current.session,
      currentRoomId: missingRoomId,
      exploredRoomIds: [missingRoomId],
    };
    delete incompatibleSession.previousRoomId;
    envelope.state.dungeon.current.session = incompatibleSession;
    envelope.state.dungeon.cachedFloors = envelope.state.dungeon.cachedFloors.map((entry) =>
      entry.route.typeName === envelope.state.dungeon.current.route.typeName &&
      entry.route.sourceFile === envelope.state.dungeon.current.route.sourceFile &&
      entry.route.floor === envelope.state.dungeon.current.route.floor
        ? { ...entry, session: incompatibleSession }
        : entry);
    envelope.state.pendingBattleRewardKeys = { "stale-treasure": "stale-reward" };
    localStorage.setItem(key, JSON.stringify(envelope));
    localStorage.setItem("dib-legacy-dungeon-abandon", "1");
  }, legacyKey);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await launchSelectedContent("world");
  const recovered = await state();
  assert.equal(recovered.mode, "world", JSON.stringify(recovered));
  assert(
    warnings.some((warning) => warning.includes("Abandoned an incompatible active dungeon run")),
    `missing abandoned-run diagnostic: ${JSON.stringify(warnings)}`,
  );
  await page.waitForFunction((key) => {
    const envelope = JSON.parse(localStorage.getItem(key));
    return envelope.state?.dungeon === undefined &&
      envelope.state?.pendingBattleRewardKeys === undefined;
  }, legacyKey);
  await page.screenshot({
    path: path.join(outputDir, "recovered-world.png"),
    timeout: 120_000,
  });
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(
    "dungeon-legacy-save: PASS (legacy room-N migrated; incompatible later floor safely abandoned)",
  );
} finally {
  await browser.close();
}
