


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve("output/dungeon-waypoint");
fs.mkdirSync(outputDir, { recursive: true });
const requestedMode = process.env.DIB_WAYPOINT_MODE;
assert(
  requestedMode === undefined || requestedMode === "undiscovered" || requestedMode === "registered",
  `DIB_WAYPOINT_MODE must be undiscovered or registered, got ${requestedMode}`,
);
const modes = requestedMode === undefined ? ["undiscovered", "registered"] : [requestedMode];

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  for (const mode of modes) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon")) {
        errors.push(`console: ${message.text()}`);
      }
    });
    await page.addInitScript((waypointState) => {
      window.__DIB_TEST_WORLD_DEMO__ = true;
      window.__DIB_TEST_WORLD_SEED__ = 7;
      window.__DIB_TEST_DUNGEON_SEED__ = 0;
      window.__DIB_TEST_DUNGEON_ROUTE__ = {
        typeName: "Cave",
        sourceFile: "Dungeon_1.plist",
        floor: 2,
      };
      window.__DIB_TEST_DUNGEON_WAYPOINT_STATE__ = waypointState;
      window.__DIB_TEST_PLAYER_PROFILE__ = {
        heroLevel: 20,
        monsterPartyLevels: [20, 20, 20],
        silver: 1000,
        gold: 200,
        captureCards: { 1: 1, 2: 0, 3: 0 },
        highestCapturedLevels: {},
      };
    }, mode);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await loadLocalContent(page);

    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const advance = async (ms) => {
      await page.evaluate((value) => window.advanceTime(value), ms);
      await page.waitForTimeout(1);
    };
    const labels = () => page.evaluate(() => {
      const counts = {};
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label) counts[node.label] = (counts[node.label] ?? 0) + 1;
        if (node?.children) stack.push(...node.children);
      }
      return counts;
    });

    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    assert(box, "missing Pixi canvas");
    const geometry = await stageGeometry(page, box);
    const clickLabel = async (wanted) => {
      const center = await page.evaluate((label) => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node?.label === label) {
            const bounds = node.getBounds();
            return {
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height / 2,
              stageWidth: window.__PIXI_APP__.renderer.screen.width,
              stageHeight: window.__PIXI_APP__.renderer.screen.height,
            };
          }
          if (node?.children) stack.push(...node.children);
        }
        return undefined;
      }, wanted);
      assert(center, `missing labeled node ${wanted}`);
      await page.mouse.click(
        box.x + center.x * box.width / center.stageWidth,
        box.y + center.y * box.height / center.stageHeight,
      );
    };

    for (let index = 0; index < 240 && (await state()).startup?.phase !== "title"; index++) {
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    assert.equal((await state()).startup?.phase, "title");
    await advance(16.67);
    await page.keyboard.press("Enter");
    for (let index = 0; index < 480; index++) {
      const snapshot = await state();
      if (
        snapshot.mode === "dungeon" ||
        snapshot.startup?.phase === "save-select" ||
        snapshot.startup?.phase === "new-game-plot" ||
        snapshot.startup?.phase === "pick-dragon"
      ) break;
      await advance(25);
    }
    if ((await state()).startup?.phase === "save-select") {
      const startup = await state();
      const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
      assert(slot?.enabled, JSON.stringify(startup.startup));
      const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
      await page.mouse.click(point.x, point.y);
    }
    let plotAdvanced = false;
    let starterChosen = false;
    for (let index = 0; index < 480 && (await state()).mode !== "dungeon"; index++) {
      const current = await state();
      if (current.startup?.phase === "new-game-plot" && !plotAdvanced) {
        await advance(2_100);
        await page.keyboard.press("Enter");
        plotAdvanced = true;
      } else if (current.startup?.phase === "pick-dragon" && !starterChosen) {
        await page.keyboard.press("1");
        starterChosen = true;
      } else {
        await advance(25);
      }
    }
    for (let index = 0; index < 240; index++) {
      const hasShade = await page.evaluate(() => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node?.label === "startupTransitionShade") return true;
          if (node?.children) stack.push(...node.children);
        }
        return false;
      });
      if (!hasShade) break;
      await advance(25);
    }
    await page.waitForTimeout(1_500);
    const closedCatchQuest = await page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "catchQuestClose" && node.visible && node.renderable) {
          node.emit("pointertap", { stopPropagation() {} });
          return true;
        }
        if (node?.children) stack.push(...node.children);
      }
      return false;
    });
    if (closedCatchQuest) {
      for (let index = 0; index < 80 && (await state()).popups?.scene?.depth > 1; index++) {
        await advance(25);
      }
    }
    await advance(100);
    await page.waitForTimeout(100);

    if (mode === "registered") {
      for (let index = 0; index < 160; index++) {
        const current = await state();
        const mounted = await labels();
        if (
          current.waypointSelection !== undefined &&
          current.popups?.scene?.depth === 1 &&
          current.floorDetectionChat !== undefined &&
          mounted.dungeonFloorDetectionChat === 1
        ) break;
        await advance(25);
      }
      const snapshot = await state();
      assert.equal(snapshot.mode, "dungeon", JSON.stringify(snapshot));
      const current = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
      assert.equal(current?.waypoint, true, JSON.stringify(current));
      assert.deepEqual(snapshot.waypointSelection, { floors: [2], selectedFloor: 2 });
      assert.equal(snapshot.popups.scene.depth, 1);
      assert.equal(snapshot.popups.scene.stack[0]?.contentLabel, "dungeonWaypointSelection");
      assert.deepEqual(snapshot.popups.scene.stack[0]?.buttons, ["Don't use Waypoint"]);
      const counts = await labels();
      assert.equal(counts.waypointIncrementer, 1, JSON.stringify(counts));
      assert.equal(counts.waypointFloorLabel, 1, JSON.stringify(counts));
      assert.equal(counts.waypointGoTo, 1, JSON.stringify(counts));
      assert.equal(counts["waypointArrow:up"], undefined, JSON.stringify(counts));
      assert.equal(counts["waypointArrow:down"], undefined, JSON.stringify(counts));
      assert.equal(counts["popupButton:Don't use Waypoint"], 1, JSON.stringify(counts));





      const layering = await page.evaluate(() => {
        const find = (wanted) => {
          const stack = [window.__PIXI_APP__.stage];
          while (stack.length > 0) {
            const node = stack.pop();
            if (node?.label === wanted) return node;
            stack.push(...(node?.children ?? []));
          }
          return null;
        };
        const chat = find("dungeonFloorDetectionChat");
        const host = find("notificationPopupHost");
        return {
          chatVisible: chat?.visible === true,
          siblings: chat?.parent != null && chat.parent === host?.parent,
          chatZ: chat?.zIndex ?? null,
          hostZ: host?.zIndex ?? null,
        };
      });
      assert.equal(layering.chatVisible, true, "the floor notice was not visible");
      assert.equal(
        layering.siblings,
        true,
        `notice and selector did not share the notification layer: ${JSON.stringify(layering)}`,
      );
      assert(
        layering.chatZ > layering.hostZ,
        `the floor notice did not draw over the waypoint selector: ${JSON.stringify(layering)}`,
      );
      assert.equal(
        snapshot.popups.scene.stack[0]?.visible,
        false,
        "the waypoint selector stayed visible under the floor notice",
      );
      await page.screenshot({
        path: path.join(outputDir, "registered-selection.png"),
        timeout: 120_000,
      });


      await advance(500);
      await page.keyboard.press("Escape");
      for (
        let index = 0;
        index < 80 && (await state()).floorDetectionChat !== undefined;
        index++
      ) {
        await advance(25);
      }
      const revealed = await state();
      assert.equal(revealed.floorDetectionChat, undefined);
      assert.notEqual(revealed.waypointSelection, undefined, JSON.stringify(revealed));
      assert.equal(revealed.popups.scene.stack[0]?.visible, true, JSON.stringify(revealed));
      await page.keyboard.press("Escape");
      for (let index = 0; index < 80 && (await state()).waypointSelection !== undefined; index++) {
        await advance(25);
      }
      assert.equal((await state()).waypointSelection, undefined);
    } else {
      for (let index = 0; index < 80; index++) {
        const snapshot = await state();
        const counts = await labels();
        if (
          snapshot.mode === "dungeon" &&
          snapshot.popups?.persistent?.depth === 1 &&
          snapshot.floorDetectionChat !== undefined &&
          counts.dungeonFloorDetectionChat === 1
        ) break;
        await advance(10);
      }
      const snapshot = await state();
      assert.equal(snapshot.mode, "dungeon", JSON.stringify(snapshot));
      const current = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
      assert.equal(current?.waypoint, true, JSON.stringify(current));
      assert.equal(snapshot.popups.persistent.depth, 1);
      assert.equal(snapshot.popups.persistent.stack[0]?.contentLabel, "dungeonPopupContent");
      assert.deepEqual(snapshot.popups.persistent.stack[0]?.buttons, ["Ok"]);
      assert.match(snapshot.floorDetectionChat.key, /WaypointDetected$/);
      const counts = await labels();
      assert.equal(counts.dungeonFloorDetectionChat, 1, JSON.stringify(counts));
      assert.equal(counts.dungeonFloorDetectionFinish, 1, JSON.stringify(counts));
      assert.equal(counts["popupButton:Ok"], 1, JSON.stringify(counts));
      await page.screenshot({
        path: path.join(outputDir, "first-discovery-notices.png"),
        timeout: 120_000,
      });
      await advance(500);
      await page.keyboard.press("Enter");
      for (let index = 0; index < 80 && (await state()).floorDetectionChat !== undefined; index++) {
        await advance(25);
      }
      assert.equal((await state()).floorDetectionChat, undefined);
    }
    assert.deepEqual(errors, [], errors.join(" | "));
    await page.close();
  }
  console.log("dungeon-waypoint: PASS (Enter/Esc text and waypoint controls)");
} finally {
  await browser.close();
}
