// Opt-in, prepared-but-unrun dungeon theme matrix. Browser decoding and renderer construction are
// intentionally unobserved here; no copyrighted content is bundled in the synthetic archive.
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
const requestedDisplayMode = process.env.DIB_DUNGEON_DISPLAY_MODE;
if (requestedDisplayMode !== undefined && requestedDisplayMode !== "iphone" && requestedDisplayMode !== "ipad") {
  throw new Error(`DIB_DUNGEON_DISPLAY_MODE must be iphone or ipad; got ${requestedDisplayMode}`);
}
const requestedTheme = process.env.DIB_DUNGEON_THEME;
if (requestedTheme !== undefined && !DUNGEON_SCENARIO_FIXTURES.some(({ label }) => label === requestedTheme)) {
  throw new Error(`unknown DIB_DUNGEON_THEME ${requestedTheme}`);
}

const EXPECTED_RESERVED_CODES = new Set(["opaque-battle-reward"]);
const EXPECTED_FLOOR_CODES = new Set([
  "zone-room-choice-tie-order",
  "generation-retry",
]);

function installFixture(page, displayMode, fixture) {
  return page.addInitScript(({ displayMode: mode, route }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: mode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    // Stop real rAF before app boot; the app replaces this with its deterministic ticker hook.
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
      // The synthetic job leaves intentionally carry no invented XP curve. Level 1 is the exact
      // zero-XP state and is sufficient because this scenario validates dungeon presentation.
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
    };
  }, { displayMode, route: fixture.route });
}

function expectedStage(displayMode) {
  return displayMode === "iphone"
    ? { stagePx: { w: 960, h: 640 }, screenPt: { w: 480, h: 320 } }
    : { stagePx: { w: 1024, h: 768 }, screenPt: { w: 512, h: 384 } };
}

async function runFixture(context, displayMode, fixture, archivePath) {
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await installFixture(page, displayMode, fixture);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  try {
    await loadLocalContent(page, archivePath);
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      text: document.body.innerText,
      state: typeof window.render_game_to_text === "function"
        ? window.render_game_to_text()
        : "render_game_to_text unavailable",
      startup: window.__DIB_TEST_RESTART_SESSION__?.startup?.() ?? "startup hook unavailable",
    })).catch((diagnosticError) => ({
      text: "page diagnostic unavailable",
      state: String(diagnosticError),
    }));
    throw new Error(
      `${fixture.label}/${displayMode}: content boot failed; browserErrors=${errors.join(" | ") || "none"}; ` +
      `diagnostic=${JSON.stringify(diagnostic)}`,
      { cause: error },
    );
  }

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
    const body = await page.locator("body").textContent().catch(() => "body unavailable");
    throw new Error(
      `${fixture.label}/${displayMode}: ${description}; state=${JSON.stringify(await state())}; body=${JSON.stringify(body)}`,
    );
  };

  await waitFor((snapshot) => snapshot.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.mode === "dungeon" || value.startup?.phase === "save-select",
    "title did not reach save selection or dungeon",
  );
  if (snapshot.startup?.phase === "save-select") {
    const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `${fixture.label}/${displayMode}: slot 1 unavailable`);
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    assert(box, `${fixture.label}/${displayMode}: missing canvas`);
    const geometry = await stageGeometry(page, box);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }

  snapshot = await waitFor(
    (value) => value.mode === "dungeon" && value.started === true,
    "dungeon scene did not finish its deterministic entry lifecycle",
  );
  const expected = expectedStage(displayMode);
  assert.equal(snapshot.displayMode, displayMode);
  assert.deepEqual(snapshot.stagePx, expected.stagePx);
  assert.deepEqual(snapshot.screenPt, expected.screenPt);
  assert.equal(snapshot.dungeonType, fixture.route.typeName);
  assert.equal(snapshot.sourceFile, fixture.route.sourceFile);
  assert.equal(snapshot.floor, fixture.route.floor);
  assert.equal(snapshot.instanceName, fixture.instanceName);
  assert(snapshot.currentRoomId, `${fixture.label}/${displayMode}: missing current room`);
  const currentRoom = snapshot.rooms.find((room) => room.id === snapshot.currentRoomId);
  assert(currentRoom?.explored, `${fixture.label}/${displayMode}: current room is not explored`);
  assert(
    currentRoom?.zones.some((zone) => zone.instanceName === fixture.route.entryZoneName),
    `${fixture.label}/${displayMode}: requested entry zone did not select the starting room`,
  );
  assert(snapshot.renderedRoomIds.includes(snapshot.currentRoomId));
  assert(snapshot.camera.scale > 0);

  if (fixture.expectedRuntimeDiagnostics.length > 0) {
    snapshot = await waitFor(
      (value) => JSON.stringify(value.runtimeDiagnostics.map((entry) => entry.code)) ===
        JSON.stringify(fixture.expectedRuntimeDiagnostics),
      "post-transition runtime diagnostics did not settle",
    );
  }
  const runtimeCodes = snapshot.runtimeDiagnostics.map((entry) => entry.code);
  assert.deepEqual(runtimeCodes, fixture.expectedRuntimeDiagnostics);
  assert.equal(runtimeCodes.includes("music-transition-timing"), false);
  assert(runtimeCodes.every((code) => !EXPECTED_RESERVED_CODES.has(code)));
  assert(snapshot.diagnostics.every((entry) => EXPECTED_FLOOR_CODES.has(entry.code)));
  assert.equal(snapshot.diagnostics.some((entry) => entry.code === "topology-order-approximation"), false);

  if (fixture.label === "Forest") {
    assert.notEqual(snapshot.chrome.caught, undefined);
  } else if (fixture.label.startsWith("Volcano")) {
    assert.equal(snapshot.chrome.caught, undefined);
  } else {
    assert.notEqual(snapshot.chrome.caught, undefined);
  }
  assert.deepEqual(errors, [], `${fixture.label}/${displayMode} browser errors`);
  await page.close();
}

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

let directory;
try {
  directory = await mkdtemp(join(tmpdir(), "dib-dungeon-all-themes-"));
  const displayModes = requestedDisplayMode === undefined ? ["iphone", "ipad"] : [requestedDisplayMode];
  const fixtures = requestedTheme === undefined
    ? DUNGEON_SCENARIO_FIXTURES
    : DUNGEON_SCENARIO_FIXTURES.filter(({ label }) => label === requestedTheme);
  for (const displayMode of displayModes) {
    for (const fixture of fixtures) {
      const routeDirectory = await mkdtemp(join(directory, "route-"));
      try {
        console.log(`dungeon-all-themes: running ${fixture.label}/${displayMode}`);
        // Each display-mode/fixture route gets a complete, freshly generated archive as well as a
        // fresh context, so neither archive contents nor browser state can leak between routes.
        const archivePath = join(routeDirectory, "task-owned-dungeon-scenario.zip");
        await writeFile(archivePath, createDungeonScenarioArchive());
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        try {
          await runFixture(context, displayMode, fixture, archivePath);
        } finally {
          await context.close();
        }
      } finally {
        await rm(routeDirectory, { recursive: true, force: true });
      }
    }
  }
  console.log("dungeon-all-themes: PASS (authorized opt-in browser run)");
} finally {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  await browser.close();
}
