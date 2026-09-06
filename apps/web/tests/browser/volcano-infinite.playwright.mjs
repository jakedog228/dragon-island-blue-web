


import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";
import {
  createDungeonScenarioArchive,
  DUNGEON_SCENARIO_FIXTURES,
} from "./dungeonScenarioArchive.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const VOLCANO_B = DUNGEON_SCENARIO_FIXTURES.find(({ label }) => label === "VolcanoB");
assert(VOLCANO_B, "the scenario archive no longer defines a VolcanoB fixture");

/**
 * `infiniteDungeonFloorEntry` in `packages/player-domain/src/playerProfile.ts`, restated here so the
 * browser run checks the port against the source rule rather than against itself.
 *
 * unlock:  stored 209, entering 211. firstThreshold = 209 + 10 - 9 = 210; 211 > 209 writes the
 *          property, and 211 >= 210 claims `NewInfiniteMonsterSlot` and posts the banner. The
 *          recurring label prints the threshold of the NEW high: 211 + 10 - 1 = 220.
 * revisit: stored 400, entering 211. 211 is not deeper, so nothing is written, no tutorial and no
 *          banner appear, and the label still prints the stored high's threshold, 410 — never 220.
 */
const CASES = Object.freeze({
  unlock: {
    infiniteDungeonHighestLevel: 209,
    expectedLabel: "Next bonus at floor: 220",
    expectsUnlock: true,
  },
  revisit: {
    infiniteDungeonHighestLevel: 400,
    expectedLabel: "Next bonus at floor: 410",
    expectsUnlock: false,
  },
});

const requestedCase = process.env.DIB_VOLCANO_CASE;
if (requestedCase !== undefined && !(requestedCase in CASES)) {
  throw new Error(`DIB_VOLCANO_CASE must be one of ${Object.keys(CASES).join(", ")}`);
}
const requestedDisplayMode = process.env.DIB_DUNGEON_DISPLAY_MODE;
if (requestedDisplayMode !== undefined && requestedDisplayMode !== "iphone" && requestedDisplayMode !== "ipad") {
  throw new Error(`DIB_DUNGEON_DISPLAY_MODE must be iphone or ipad; got ${requestedDisplayMode}`);
}

const UNLOCK_TITLE = "New Monster Slot Unlocked!";
const UNLOCK_SHORT_MESSAGE = "+1 Max Monsters!";


const DISPLAY_MODE_INSET_PT = Object.freeze({ iphone: 10, ipad: 5 });

function installFixture(page, displayMode, scenario) {
  return page.addInitScript(({ displayMode: mode, route, infiniteDungeonHighestLevel }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: mode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
    window.__DIB_TEST_WORLD_NAME__ = "Harbor";
    window.__DIB_TEST_POI_NAME__ = "ScenarioStart";
    window.__DIB_TEST_WORLD_SEED__ = 0xD06E00D;
    window.__DIB_TEST_DUNGEON_SEED__ = 0xD06E00D;
    window.__DIB_TEST_DUNGEON_ROUTE__ = route;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [1, 1],
      members: [{ shortType: "Testling", level: 1 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 20,
      monsterPartyLevels: [1],
      silver: 1000,
      gold: 1000,
      captureCards: { 1: 5, 2: 5, 3: 5 },
      highestCapturedLevels: { Testling: 1 },
      infiniteDungeonHighestLevel,
    };
  }, {
    displayMode,
    route: VOLCANO_B.route,
    infiniteDungeonHighestLevel: scenario.infiniteDungeonHighestLevel,
  });
}

/** Every string the live scene is currently drawing, so a missing banner cannot read as a pass. */
const drawnText = (page) => page.evaluate(() => {
  const found = [];
  const stack = [window.__PIXI_APP__.stage];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || node === null) continue;
    if (typeof node.text === "string" && node.text.length > 0 && node.visible !== false) {
      found.push(node.text);
    }
    if (node.children) stack.push(...node.children);
  }
  return found;
});

/** Geometry of the corner label root, in the renderer's own pixels. */
const labelBounds = (page) => page.evaluate(() => {
  const stack = [window.__PIXI_APP__.stage];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node?.label === "dungeonInfiniteUnlock") {
      const childZ = {};
      const childAlpha = {};
      let textWidth = 0;
      let textHeight = 0;
      for (const child of node.children ?? []) {
        childZ[child.label] = child.zIndex;
        childAlpha[child.label] = child.alpha;
        if (child.label === "dungeonInfiniteUnlockLabel") {
          textWidth = child.width;
          textHeight = child.height;
        }
      }
      // The root's own position is `infiniteDungeonUnlockLabelLayout().topLeft` in fixed-stage
      // pixels, which is pure port math. `getBounds()` is deliberately NOT used: it folds in the
      // `PopupBackgroundThin` Scale9, and this archive ships a 1x1 placeholder atlas, so measured
      // extents would describe the fixture rather than the port.
      return {
        x: node.position.x,
        y: node.position.y,
        textWidth,
        textHeight,
        zIndex: node.zIndex,
        childZ,
        childAlpha,
      };
    }
    if (node?.children) stack.push(...node.children);
  }
  return undefined;
});

async function runCase(context, displayMode, caseName, scenario, archivePath) {
  const tag = `${caseName}/${displayMode}`;
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await installFixture(page, displayMode, scenario);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page, archivePath);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(1);
  };
  const waitFor = async (predicate, description, iterations = 600) => {
    for (let index = 0; index < iterations; index++) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    throw new Error(`${tag}: ${description}; state=${JSON.stringify(await state())}`);
  };

  await waitFor((snapshot) => snapshot.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.mode === "dungeon" || value.startup?.phase === "save-select",
    "title did not reach save selection or dungeon",
  );
  if (snapshot.startup?.phase === "save-select") {
    const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `${tag}: slot 1 unavailable`);
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    assert(box, `${tag}: missing canvas`);
    const geometry = await stageGeometry(page, box);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }
  snapshot = await waitFor(
    (value) => value.mode === "dungeon" && value.started === true,
    "dungeon scene did not finish its deterministic entry lifecycle",
  );

  assert.equal(snapshot.instanceName, "VolcanoB", `${tag}: wrong instance`);
  assert.equal(snapshot.floor, VOLCANO_B.route.floor, `${tag}: wrong floor`);
  // The Abyss has no `Caught x/y` census at all — the source returns before building it.
  assert.equal(snapshot.chrome.caught, undefined, `${tag}: the Abyss must not draw a caught census`);

  // The GameKit submission is the one step with no local equivalent, and it reports on EVERY entry,
  // deeper or not — it sits before the write branch in the source.
  snapshot = await waitFor(
    (value) => value.runtimeDiagnostics.some(
      (entry) => entry.code === "leaderboard-platform-hook-unavailable",
    ),
    "the platform-score hook did not report",
  );
  const scoreEntry = snapshot.runtimeDiagnostics.find(
    (entry) => entry.code === "leaderboard-platform-hook-unavailable",
  );
  // `recordDiagnostic` keeps the emitted detail under `detail`, hoisting only `code`.
  assert.equal(
    scoreEntry.detail?.category,
    "DIBlueInfiniteDungeon",
    `${tag}: wrong leaderboard category in ${JSON.stringify(scoreEntry)}`,
  );
  // `max(current, stored)`: 211 on the unlock case, the stored 400 on the revisit case.
  assert.equal(
    scoreEntry.detail?.score,
    Math.max(VOLCANO_B.route.floor, scenario.infiniteDungeonHighestLevel),
    `${tag}: the submitted score is not max(floor, stored)`,
  );
  assert.equal(
    snapshot.runtimeDiagnostics.some((entry) => entry.code === "volcano-infinite-unlock-unverified"),
    false,
    `${tag}: the retired unavailable-branch diagnostic came back`,
  );

  // The label is built asynchronously (`Scale9.fromConfig` awaits its atlas), so it is polled on
  // the Pixi tree rather than read from the text state, which never exposes it. The poll advances
  // in 10 ms steps and gives up well inside the 2000 ms hold, so finding it can never consume the
  // hold the next assertions measure.
  let measured;
  let advancedMs = 0;
  for (let index = 0; index < 60 && measured === undefined; index++) {
    measured = await labelBounds(page);
    if (measured === undefined) {
      await advance(10);
      advancedMs += 10;
    }
  }
  assert(measured, `${tag}: the recurring corner label never mounted`);
  assert.equal(measured.zIndex, 10, `${tag}: label z must be 10`);
  assert.equal(
    measured.childZ.dungeonInfiniteUnlockBacking,
    -9,
    `${tag}: backing z must be -9 (mvn r3, #8 @ 0xcb290), not -8`,
  );
  // The source's anchor quirk, measured on the live node rather than trusted from the unit test:
  // `setAnchorPoint:(1,0)` on a position that already subtracts half the label's own size leaves
  // the box inset by `10 + w/2` from the right edge and `10 + h/2` from the bottom, not by a flat
  // 10. The chrome frame is the source's point space, so `screenPt` is the right ruler here, and
  // `roundSourcePoint` allows a point of slack.
  const { screenPt } = snapshot;
  const insetPt = DISPLAY_MODE_INSET_PT[displayMode];
  const rightGap = screenPt.w - (measured.x + measured.textWidth);
  const bottomGap = screenPt.h - (measured.y + measured.textHeight);
  assert(
    Math.abs(rightGap - (insetPt + measured.textWidth / 2)) <= 1,
    `${tag}: right gap ${rightGap} is not 10 + w/2 for ${JSON.stringify(measured)}`,
  );
  assert(
    Math.abs(bottomGap - (insetPt + measured.textHeight / 2)) <= 1,
    `${tag}: bottom gap ${bottomGap} is not 10 + h/2 for ${JSON.stringify(measured)}`,
  );

  const texts = await drawnText(page);
  assert(
    texts.includes(scenario.expectedLabel),
    `${tag}: expected ${JSON.stringify(scenario.expectedLabel)} among ${JSON.stringify(texts)}`,
  );
  if (scenario.expectsUnlock) {
    assert(
      texts.includes(UNLOCK_TITLE) || texts.includes(UNLOCK_SHORT_MESSAGE),
      `${tag}: the unlock banner did not appear among ${JSON.stringify(texts)}`,
    );
  } else {
    assert.equal(
      texts.includes(UNLOCK_TITLE) || texts.includes(UNLOCK_SHORT_MESSAGE),
      false,
      `${tag}: an unlock fired for a floor that is not a new high: ${JSON.stringify(texts)}`,
    );
  }

  // 2 s hold, then a 2 s fade, then `CCFadeAndRemove` takes the label and its backing away. The
  // port fades the text and the backing independently rather than the root, matching the source's
  // two separate `CCFadeOut`s, so the hold is read off the children.
  await advance(1_900 - advancedMs);
  const held = await labelBounds(page);
  assert(held, `${tag}: the label disappeared during its 2 s hold`);
  assert(
    held.childAlpha.dungeonInfiniteUnlockLabel > 0.9 && held.childAlpha.dungeonInfiniteUnlockBacking > 0.9,
    `${tag}: the label started fading before its 2 s hold elapsed: ${JSON.stringify(held.childAlpha)}`,
  );
  await advance(2_200);
  assert.equal(
    await labelBounds(page),
    undefined,
    `${tag}: the label survived its fade-and-remove`,
  );

  assert.deepEqual(errors, [], `${tag} browser errors`);
  await page.close();
}

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

let directory;
try {
  directory = await mkdtemp(join(tmpdir(), "dib-volcano-infinite-"));
  const displayModes = requestedDisplayMode === undefined ? ["iphone", "ipad"] : [requestedDisplayMode];
  const caseNames = requestedCase === undefined ? Object.keys(CASES) : [requestedCase];
  for (const displayMode of displayModes) {
    for (const caseName of caseNames) {
      const caseDirectory = await mkdtemp(join(directory, "case-"));
      try {
        console.log(`volcano-infinite: running ${caseName}/${displayMode}`);
        const archivePath = join(caseDirectory, "task-owned-dungeon-scenario.zip");
        await writeFile(archivePath, createDungeonScenarioArchive());
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        try {
          await runCase(context, displayMode, caseName, CASES[caseName], archivePath);
        } finally {
          await context.close();
        }
      } finally {
        await rm(caseDirectory, { recursive: true, force: true });
      }
    }
  }
  console.log("volcano-infinite: all cases passed");
} finally {
  await browser.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
}
