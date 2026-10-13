


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { pixiLabelVisible, tapPixiLabel } from "./pixiInput.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/dungeon-waypoint-save");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  let context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  let page = await context.newPage();
  const errors = [];
  const watchPage = (target) => {
    target.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
    target.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon")) {
        errors.push(`console: ${message.text()}`);
      }
    });
  };
  const installHarness = (target) => target.addInitScript(() => {
      window.__DIB_TEST_WORLD_DEMO__ = true;
      window.__DIB_TEST_WORLD_SEED__ = 7;
      window.__DIB_TEST_DUNGEON_SEED__ = 0;
      window.__DIB_TEST_DUNGEON_ROUTE__ = {
        typeName: "Cave",
        sourceFile: "Dungeon_1.plist",
        floor: 2,
      };
      window.__DIB_TEST_DUNGEON_WAYPOINT_STATE__ =
        localStorage.getItem("dib-waypoint-reentry") === "1" ? undefined : "registered";
      window.__DIB_TEST_PLAYER_PROFILE__ = {
        heroLevel: 20,
        monsterPartyLevels: [20, 20, 20],
        silver: 1000,
        gold: 200,
        captureCards: { 1: 1, 2: 0, 3: 0 },
        highestCapturedLevels: {},
      };
    });
  watchPage(page);
  await installHarness(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const waitForState = async (predicate, description, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await page.evaluate(() => window.advanceTime(25));
      await page.waitForTimeout(1);
    }
    throw new Error(
      `${description}; errors: ${errors.join(" | ") || "none"}; state: ${JSON.stringify(await state())}`,
    );
  };
  const hasLabel = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) return true;
      if (node?.children) stack.push(...node.children);
    }
    return false;
  }, label);
  // The node itself carries no listener by design: a source PopupMenu owns one `menuItems` list,
  // so rows are inert and the menu container arbitrates the tap. Assert an OWNER exists rather
  // than a listener on the row, which is the property that actually keeps the control live.
  const invokePointerLabel = async (label) => {
    for (let frame = 0; frame < 600 && !await pixiLabelVisible(page, label); frame++) {
      await page.evaluate(() => window.advanceTime(25));
      await page.waitForTimeout(1);
    }
    const owner = await tapPixiLabel(page, label);
    assert(owner, `missing interactive Pixi node ${label}`);
  };
  // Same routing as `invokePointerLabel`: the row is inert and its menu owns the tap. Keep the
  // real check -- the menu must CLOSE as a result -- and drop the per-node listener count, which
  // is zero for every source-shaped row and says nothing about whether the control is live.
  const invokeLabel = async (label) => {
    const owner = await tapPixiLabel(page, label);
    assert(owner, `missing visible Pixi node ${label}`);
    // The selection closes the menu, which detaches the row -- so the observable outcome is that
    // the row is gone, not a `closed` flag on an ancestor the row no longer has.
    assert.equal(
      await pixiLabelVisible(page, label),
      false,
      `Pixi node ${label} did not close its menu`,
    );
  };
  const bootSelectedContent = async () => {
    await loadLocalContent(page);
    await waitForState(
      (value) => value.startup?.phase === "title",
      "title did not become interactive",
    );
    await page.keyboard.press("Enter");
    let snapshot = await waitForState(
      (value) =>
        value.startup?.phase === "new-game-plot" ||
        value.startup?.phase === "pick-dragon" ||
        value.startup?.phase === "save-select" ||
        value.mode === "dungeon",
      "title did not continue",
    );
    if (snapshot.startup?.phase === "save-select") {
      const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
      assert(slot?.enabled, JSON.stringify(snapshot.startup));
      await page.evaluate(() => window.advanceTime(300));
      await page.waitForFunction(() => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node?.label === "startupTransitionShade") {
            return node.visible === false || node.alpha === 0;
          }
          if (node?.children) stack.push(...node.children);
        }
        return true;
      });
      await page.screenshot({
        path: path.join(outputDir, "save-select-reentry.png"),
        timeout: 120_000,
      });
      await invokeLabel("sourcePopupButton:slot-1");
      snapshot = await waitForState(
        (value) =>
          value.startup?.phase === "new-game-plot" ||
          value.startup?.phase === "pick-dragon" ||
          value.mode === "dungeon",
        "save slot did not continue",
      );
    }
    if (snapshot.startup?.phase === "new-game-plot") {
      await page.waitForTimeout(2_100);
      await page.keyboard.press("Enter");
      snapshot = await waitForState(
        (value) => value.startup?.phase === "pick-dragon",
        "new-game plot did not reach starter selection",
      );
    }
    if (snapshot.startup?.phase === "pick-dragon") {
      await page.keyboard.press("1");
    }
    return waitForState((value) => value.mode === "dungeon", "dungeon fixture did not start");
  };
  const closeCatchQuestIfPresent = async () => {
    if (!await hasLabel("catchQuestClose")) return;
    const center = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "catchQuestClose") {
          const bounds = node.getBounds();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
        if (node?.children) stack.push(...node.children);
      }
      return undefined;
    });
    assert(center, "catch quest close button has no bounds");
    const box = await page.locator("canvas").first().boundingBox();
    assert(box, "missing dungeon canvas");
    await page.mouse.click(box.x + center.x, box.y + center.y);
  };
  const waitForWaypointMenu = () => waitForState(
    (value) =>
      value.mode === "dungeon" &&
      value.waypointSelection?.floors?.includes(2) === true &&
      value.popups?.scene?.depth === 1,
    "registered waypoint menu did not open",
  );

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await bootSelectedContent();
  await page.waitForTimeout(1_500);
  await closeCatchQuestIfPresent();
  const discovered = await waitForWaypointMenu();
  assert.equal(discovered.waypointSelection.selectedFloor, 2);
  console.log("dungeon-waypoint-save: initial waypoint menu ready");

  const saveKey = await page.waitForFunction(() => {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith("dib-save-v1:") || !key.endsWith(":slot-1")) continue;
      const envelope = JSON.parse(localStorage.getItem(key));
      const waypoints = envelope.state?.player?.profile?.dungeonWaypoints;
      if (
        waypoints &&
        Object.values(waypoints).some((floors) => Array.isArray(floors) && floors.includes(2))
      ) return key;
    }
    return undefined;
  }).then((handle) => handle.jsonValue());
  assert.equal(typeof saveKey, "string", "waypoint floor 2 was not persisted in PlayerProfile");
  console.log("dungeon-waypoint-save: durable profile field saved");

  const savedEnvelope = await page.evaluate((key) => {
    const envelope = JSON.parse(localStorage.getItem(key));
    delete envelope.state.dungeon;
    return JSON.stringify(envelope);
  }, saveKey);
  console.log("dungeon-waypoint-save: transient dungeon cache removed");

  await page.evaluate(() => window.__PIXI_APP__.ticker.stop());
  console.log("dungeon-waypoint-save: original ticker stopped");
  await page.close({ runBeforeUnload: false });
  console.log("dungeon-waypoint-save: original page closed");
  const reentryBrowser = await chromium.launch({
    headless: process.env.DIB_HEADED !== "1",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
  });
  context = await reentryBrowser.newContext({ viewport: { width: 1280, height: 800 } });
  page = await context.newPage();
  watchPage(page);
  await installHarness(page);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, value);
    localStorage.setItem("dib-waypoint-reentry", "1");
  }, { key: saveKey, value: savedEnvelope });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  console.log("dungeon-waypoint-save: reload page ready");
  await bootSelectedContent();
  console.log("dungeon-waypoint-save: re-entry dungeon ready");
  await page.waitForTimeout(1_500);
  await closeCatchQuestIfPresent();
  const restored = await waitForWaypointMenu();
  assert.deepEqual(restored.waypointSelection, { floors: [2], selectedFloor: 2 });
  console.log("dungeon-waypoint-save: restored waypoint menu ready");
  fs.writeFileSync(
    path.join(outputDir, "restored-state.json"),
    `${JSON.stringify(restored, null, 2)}\n`,
  );
  // The arrival chat covers the retained waypoint popup until its dialogue is acknowledged.
  for (let index = 0; index < 8 && (await state()).floorDetectionChat !== undefined; index++) {
    await page.keyboard.press("Enter");
    await page.evaluate(() => window.advanceTime(500));
  }
  await invokePointerLabel("waypointGoTo");
  const travelled = await waitForState(
    (value) =>
      value.mode === "dungeon" &&
      value.floor === 2 &&
      value.waypointSelection === undefined,
    "restored waypoint Go To did not complete",
  );
  assert.equal(travelled.currentRoomId, restored.currentRoomId);
  console.log("dungeon-waypoint-save: restored Go To completed");
  assert.deepEqual(errors, [], errors.join(" | "));
  await page.evaluate(() => window.__PIXI_APP__.ticker.stop());
  await page.close({ runBeforeUnload: false });
  console.log("dungeon-waypoint-save: PASS (profile save, cache exit, reload, re-entry)");
  process.exit(0);
} finally {
  await browser.close();
}
