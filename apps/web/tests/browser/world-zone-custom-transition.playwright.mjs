

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  buildCustomWorldTransitionFixture,
  CARDINAL_TARGET_WORLD,
  CUSTOM_MONSTER_SHORT_TYPE,
  CUSTOM_SOURCE_EXIT,
  CUSTOM_SOURCE_WORLD,
  CUSTOM_TARGET_ENTRY,
  CUSTOM_TARGET_WORLD,
  NORMAL_TO_CUSTOM_EXIT,
  NON_CARDINAL_TARGET_WORLD,
} from "./customWorldTransitionFixture.mjs";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const ORIGINAL_SOURCE_WORLD = "World_1-1";
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dib-custom-world-"));
const sourceArchive = process.env.DIB_CONTENT_ARCHIVE ??
  path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa");
const customFixtureArchive = path.join(temporaryRoot, "CustomWorldTransition.ipa");
const nonCardinalFixtureArchive = path.join(temporaryRoot, "NonCardinalWorldTransition.ipa");
const outputDirectory = path.resolve(repositoryRoot, "output/custom-world-compat");
assert.equal(
  path.dirname(outputDirectory),
  path.join(repositoryRoot, "output"),
  "scenario output escaped the repository output directory",
);
fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

let browser;

async function openWorld({ archive, startWorld, startPoi }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ world, poi, monster }) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_NAME__ = world;
    window.__DIB_TEST_POI_NAME__ = poi;
    window.__DIB_TEST_WORLD_SEED__ = 11;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [100, 100],
      members: [{ shortType: monster, level: 100 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 100,
      monsterPartyLevels: [100],
      silver: 1_000,
      gold: 200,
      captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"],
    };
  }, { world: startWorld, poi: startPoi, monster: CUSTOM_MONSTER_SHORT_TYPE });
  await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173", {
    waitUntil: "domcontentloaded",
  });
  await loadLocalContent(page, archive);

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

  const snapshot = await state();
  assert.equal(snapshot.world, startWorld);
  assert.equal(snapshot.currentPoi, startPoi);
  assert.deepEqual(
    snapshot.party.map(({ shortType }) => shortType),
    [CUSTOM_MONSTER_SHORT_TYPE],
    "the parent-only custom Jobs child did not produce a usable world-party member",
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  return { advance, context, errors, geometry, page, state };
}

async function followGenericFade(runtime, {
  fromWorld,
  sourcePoi,
  targetWorld,
  targetPoi,
  artifactName,
}) {
  let snapshot = await runtime.state();
  assert.equal(snapshot.world, fromWorld);
  assert.equal(snapshot.currentPoi, sourcePoi);
  const partyIdentity = snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType }));
  const exit = snapshot.pois.find((poi) => poi.name === sourcePoi);
  assert(exit && snapshot.selectablePois.includes(exit.name), `${fromWorld}.${sourcePoi} is not selectable`);
  const exitPoint = runtime.geometry.toCss({ x: exit.position.x + 8, y: exit.position.y });
  await runtime.page.mouse.click(exitPoint.x, exitPoint.y);


  await runtime.page.waitForTimeout(50);

  // The outgoing world remains the state owner until the opaque midpoint. The empty authored
  // encounter must complete the POI without opening a battle or drawing an ordinary encounter.
  await runtime.advance(200);
  snapshot = await runtime.state();
  assert.equal(snapshot.mode, "world", `${fromWorld}.${sourcePoi} opened a battle`);
  assert.equal(snapshot.world, fromWorld, "fade replaced the world before midpoint");
  assert(
    snapshot.refresh.completedPois.includes(sourcePoi),
    `${fromWorld}.${sourcePoi} did not complete after its empty encounter resolved nil: ` +
      JSON.stringify({
        locked: snapshot.locked,
        walking: snapshot.walking,
        currentPoi: snapshot.currentPoi,
        completedPois: snapshot.refresh.completedPois,
        transitionFailure: snapshot.transitionFailure,
        exitPosition: exit.position,
        click: exitPoint,
      }),
  );

  let sawIncomingWithoutMarker = false;
  for (let index = 0; index < 40; index++) {
    snapshot = await runtime.state();
    if (snapshot.world === targetWorld && !snapshot.markerVisible) sawIncomingWithoutMarker = true;
    if (snapshot.world === targetWorld && snapshot.markerVisible) break;
    await runtime.advance(25);
  }
  snapshot = await runtime.state();
  assert(sawIncomingWithoutMarker, `${fromWorld} -> ${targetWorld} exposed its marker during the fade`);
  assert.equal(snapshot.world, targetWorld);
  assert.equal(snapshot.currentPoi, targetPoi);
  assert.deepEqual(snapshot.slidePosition, { x: 0, y: 0 }, `${fromWorld} -> ${targetWorld} incorrectly slid`);
  assert.equal(snapshot.markerVisible, true, "incoming marker did not begin its post-transition reveal");
  assert(Math.abs(snapshot.markerAlpha) < 0.01, `incoming marker reveal started late: ${snapshot.markerAlpha}`);

  await runtime.advance(250);
  snapshot = await runtime.state();
  assert(
    Math.abs(snapshot.markerAlpha - 0.5) < 0.02,
    `incoming marker was not half-visible 250ms after the transition: ${snapshot.markerAlpha}`,
  );
  await runtime.advance(250);
  snapshot = await runtime.state();
  assert(Math.abs(snapshot.markerAlpha - 1) < 0.01, "incoming marker did not finish its 0.5s fade");
  assert.equal(snapshot.locked, false);
  assert.equal(snapshot.chrome.mapName.visible, true);
  assert.deepEqual(
    snapshot.party.map(({ instanceId, shortType }) => ({ instanceId, shortType })),
    partyIdentity,
    `${fromWorld} -> ${targetWorld} replaced the trip party`,
  );
  assert.deepEqual(runtime.errors, [], runtime.errors.join(" | "));
  await runtime.page.screenshot({
    path: path.join(outputDirectory, `${artifactName}.png`),
    timeout: 60_000,
  });
  fs.writeFileSync(
    path.join(outputDirectory, `${artifactName}.json`),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
}

async function followCardinalSlide(runtime) {
  let snapshot = await runtime.state();
  const exit = snapshot.pois.find((poi) => poi.name === NORMAL_TO_CUSTOM_EXIT);
  assert(exit && snapshot.selectablePois.includes(exit.name), "cardinal source exit is not selectable");
  const exitPoint = runtime.geometry.toCss({ x: exit.position.x + 8, y: exit.position.y });
  await runtime.page.mouse.click(exitPoint.x, exitPoint.y);
  await runtime.page.waitForTimeout(50);

  let sawMovingIncomingWithoutMarker = false;
  for (let index = 0; index < 80; index++) {
    snapshot = await runtime.state();
    if (
      snapshot.world === CARDINAL_TARGET_WORLD &&
      !snapshot.markerVisible &&
      (Math.abs(snapshot.slidePosition.x) > 0.01 || Math.abs(snapshot.slidePosition.y) > 0.01)
    ) {
      sawMovingIncomingWithoutMarker = true;
    }
    if (snapshot.world === CARDINAL_TARGET_WORLD && snapshot.markerVisible) break;
    await runtime.advance(25);
  }
  snapshot = await runtime.state();
  assert(sawMovingIncomingWithoutMarker, "cardinal slide exposed the incoming hero before slideEndAtPOIName:");
  assert.equal(snapshot.world, CARDINAL_TARGET_WORLD);
  assert.deepEqual(snapshot.slidePosition, { x: 0, y: 0 });
  assert.equal(snapshot.markerVisible, true);
  assert(Math.abs(snapshot.markerAlpha) < 0.01, `cardinal marker reveal started late: ${snapshot.markerAlpha}`);

  await runtime.advance(250);
  snapshot = await runtime.state();
  assert(Math.abs(snapshot.markerAlpha - 0.5) < 0.02, `cardinal marker alpha: ${snapshot.markerAlpha}`);
  await runtime.advance(250);
  snapshot = await runtime.state();
  assert(Math.abs(snapshot.markerAlpha - 1) < 0.01, "cardinal marker fade did not finish");
  assert.deepEqual(runtime.errors, [], runtime.errors.join(" | "));
}

try {
  buildCustomWorldTransitionFixture({
    sourceArchive,
    outputArchive: customFixtureArchive,
    sourceRoute: "custom",
  });
  buildCustomWorldTransitionFixture({
    sourceArchive,
    outputArchive: nonCardinalFixtureArchive,
    sourceRoute: "noncardinal",
  });
  browser = await chromium.launch({
    headless: process.env.DIB_HEADED !== "1",
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
  });

  // Native `slideEndAtPOIName:` sets the destination POI only after the cardinal screen slide.
  // The incoming hero therefore remains absent for the complete movement, then fades in.
  const cardinalRoute = await openWorld({
    archive: sourceArchive,
    startWorld: ORIGINAL_SOURCE_WORLD,
    startPoi: NORMAL_TO_CUSTOM_EXIT,
  });
  try {
    await followCardinalSlide(cardinalRoute);
  } finally {
    await cardinalRoute.context.close();
  }

  // The old port admitted ModWorld_1-1 only from a dungeon. Prove the normal-world entrance and
  // then the second custom-to-custom hop in the same durable trip.
  const customRoute = await openWorld({
    archive: customFixtureArchive,
    startWorld: ORIGINAL_SOURCE_WORLD,
    startPoi: NORMAL_TO_CUSTOM_EXIT,
  });
  try {
    await followGenericFade(customRoute, {
      fromWorld: ORIGINAL_SOURCE_WORLD,
      sourcePoi: NORMAL_TO_CUSTOM_EXIT,
      targetWorld: CUSTOM_SOURCE_WORLD,
      targetPoi: CUSTOM_SOURCE_EXIT,
      artifactName: "normal-to-modworld",
    });
    await followGenericFade(customRoute, {
      fromWorld: CUSTOM_SOURCE_WORLD,
      sourcePoi: CUSTOM_SOURCE_EXIT,
      targetWorld: CUSTOM_TARGET_WORLD,
      targetPoi: CUSTOM_TARGET_ENTRY,
      artifactName: "modworld-to-modworld",
    });
  } finally {
    await customRoute.context.close();
  }

  // The old port admitted World_5-1 only from World_4-1. Prove a deliberately nonadjacent source.
  const nonCardinalRoute = await openWorld({
    archive: nonCardinalFixtureArchive,
    startWorld: ORIGINAL_SOURCE_WORLD,
    startPoi: NORMAL_TO_CUSTOM_EXIT,
  });
  try {
    await followGenericFade(nonCardinalRoute, {
      fromWorld: ORIGINAL_SOURCE_WORLD,
      sourcePoi: NORMAL_TO_CUSTOM_EXIT,
      targetWorld: NON_CARDINAL_TARGET_WORLD,
      targetPoi: CUSTOM_TARGET_ENTRY,
      artifactName: "noncardinal-world-5-1",
    });
  } finally {
    await nonCardinalRoute.context.close();
  }

  console.log(
    "world-zone-custom-transition: PASS " +
    "(cardinal marker reveal, World_5-1 noncardinal, normal->ModWorld, ModWorld->ModWorld, " +
      "empty populators, inherited Job)",
  );
} finally {
  await browser?.close();
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
