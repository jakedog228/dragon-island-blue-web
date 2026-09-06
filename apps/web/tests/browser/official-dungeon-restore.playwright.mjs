


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createFrameCapture } from "./captureFrame.mjs";
import { firstDifference, formatDifference } from "./firstDifference.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-authority-key";
const postCommitOutcome = process.env.DIB_OFFICIAL_POST_COMMIT_OUTCOME;
assert(
  postCommitOutcome === undefined || postCommitOutcome === "victory" || postCommitOutcome === "retreat",
  "DIB_OFFICIAL_POST_COMMIT_OUTCOME must be victory or retreat",
);
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/official-dungeon-restore");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
fs.mkdirSync(outputDirectory, { recursive: true });
const statusPath = path.join(outputDirectory, "official-dungeon-status.log");
fs.writeFileSync(statusPath, "");
const reportStep = (step) => {
  const line = `[official-dungeon] ${step}\n`;
  fs.appendFileSync(statusPath, line);
  process.stderr.write(line);
};

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const logicPackId = readiness.installedLogicPackIds[0];
const sessionResponse = await fetch(`${gameUrl}/api/game/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    protocolVersion: "game-protocol-v1",
    loginToken: token,
    logicPackId,
    supportedEventVersions: ["presentation-events-v1"],
  }),
});
if (sessionResponse.status !== 200) throw new Error(await sessionResponse.text());
const apiSession = await sessionResponse.json();
const authHeaders = {
  Authorization: `Bearer ${apiSession.token}`,
  "Content-Type": "application/json",
};
const occupied = apiSession.slots.find((slot) => slot.slotId === "slot-1");
if (occupied !== undefined) {
  const deleted = await fetch(`${gameUrl}/api/game/slots/slot-1`, {
    method: "DELETE",
    headers: authHeaders,
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      expectedRevision: occupied.revision,
    }),
  });
  if (deleted.status !== 200) throw new Error(await deleted.text());
}

let serial = 0;
let committed;
const commandRunId = Date.now().toString(36);
const execute = async (command) => {
  const response = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      commandId:
        `browser_dungeon_restore_${commandRunId}_${String(++serial).padStart(4, "0")}`,
      expectedRevision: committed?.revision ?? 0,
      ...(committed?.projection.decision?.decisionId === undefined
        ? {}
        : { expectedDecisionId: committed.projection.decision.decisionId }),
      command,
    }),
  });
  if (response.status !== 200) throw new Error(`${command.type} failed: ${await response.text()}`);
  committed = await response.json();
  return committed;
};
const targetsFor = (choice, decision) => {
  switch (choice.target.kind) {
    case "self": return [decision.actorId];
    case "allEnemies": return [...decision.enemyTargetIds];
    case "allFriends": return [...decision.friendlyTargetIds];
    case "enemies": return decision.enemyTargetIds.slice(0, choice.target.count);
    case "friends": return decision.friendlyTargetIds.slice(0, choice.target.count);
    case "mixed":
      return [
        ...(choice.target.allEnemies
          ? decision.enemyTargetIds
          : decision.enemyTargetIds.slice(0, choice.target.enemyCount)),
        ...(choice.target.allFriends
          ? decision.friendlyTargetIds
          : decision.friendlyTargetIds.slice(0, choice.target.friendlyCount)),
      ];
    default: throw new Error(`Unhandled target shape ${JSON.stringify(choice.target)}`);
  }
};
const finishBattle = async (preferBasicAttack = false, allowSaveMe = false) => {
  let settlement;
  let usedSaveMe = false;
  let usedSpirit = false;
  for (let turn = 0; committed.projection.location.kind === "battle" && turn < 200; turn++) {
    const decision = committed.projection.decision;
    // A fresh authoritative slot can lose one of the route battles. Leave that attempt in its
    // terminal decision so the outer fixture loop can discard the slot and try its next seed.
    if (decision.type === "battle.defeatRecovery") {
      if (!allowSaveMe || usedSaveMe || !decision.canSaveMe) return settlement;
      settlement = await execute({
        type: "battle.resolveDefeat",
        battleId: decision.battleId,
        recovery: "saveMe",
      });
      usedSaveMe = true;
      continue;
    }
    assert.equal(decision.type, "battle.playerTurn");
    if (
      preferBasicAttack && !usedSpirit && decision.summonableSpiritTypes.length > 0
    ) {
      settlement = await execute({
        type: "battle.summonSpirit",
        battleId: decision.battleId,
        shortType: decision.summonableSpiritTypes[0],
      });
      usedSpirit = true;
      continue;
    }
    const choices = decision.choices.filter((choice) => choice.blockedReasonId === undefined);
    const attack = choices.find(({ abilityId, target }) =>
      abilityId === "Offensive.Attack" &&
      ["allEnemies", "enemies", "mixed"].includes(target.kind));
    const special = choices.find(({ abilityId, target }) =>
      abilityId !== "Offensive.Attack" &&
      ["allEnemies", "enemies", "mixed"].includes(target.kind));
    const choice = (preferBasicAttack ? attack ?? special : special ?? attack) ??
      choices.find(({ target }) => ["allEnemies", "enemies", "mixed"].includes(target.kind));
    assert(choice, `No usable enemy-targeted ability: ${JSON.stringify(decision.choices)}`);
    settlement = await execute({
      type: "battle.chooseAbility",
      battleId: decision.battleId,
      actorId: decision.actorId,
      slot: choice.slot,
      targetIds: targetsFor(choice, decision),
    });
  }
  assert.notEqual(committed.projection.location.kind, "battle", "battle exceeded 200 turns");
  return settlement;
};
const finishRetreat = async () => {
  let usedSaveMe = false;
  for (let attempt = 0; committed.projection.location.kind === "battle" && attempt < 50; attempt++) {
    const decision = committed.projection.decision;
    if (decision.type === "battle.defeatRecovery") {
      assert.equal(usedSaveMe, false, "retreat fixture exhausted its Save Me recovery");
      assert.equal(decision.canSaveMe, true, "retreat fixture cannot use Save Me recovery");
      await execute({
        type: "battle.resolveDefeat",
        battleId: decision.battleId,
        recovery: "saveMe",
      });
      usedSaveMe = true;
      continue;
    }
    assert.equal(decision.type, "battle.playerTurn");
    await execute({
      type: "battle.retreat",
      battleId: decision.battleId,
      actorId: decision.actorId,
    });
  }
  assert.notEqual(committed.projection.location.kind, "battle", "retreat exceeded 50 attempts");
  return committed;
};
const navigate = async (targetPoiId) => {
  await execute({ type: "world.navigate", targetPoiId });
  return committed.projection.location.kind === "battle"
    ? finishBattle()
    : undefined;
};

let enyaSettlement;
let fixtureReady = false;
for (let attempt = 0; attempt < 8 && !fixtureReady; attempt++) {
  enyaSettlement = undefined;
  if (attempt > 0) {
    const deleted = await fetch(`${gameUrl}/api/game/slots/slot-1`, {
      method: "DELETE",
      headers: authHeaders,
      body: JSON.stringify({
        protocolVersion: "game-protocol-v1",
        expectedRevision: committed.revision,
      }),
    });
    if (deleted.status !== 200) throw new Error(await deleted.text());
    committed = undefined;
  }
  await execute({ type: "slot.create", starterElement: "Water" });
  await execute({ type: "player.claimDialog", dialogId: "LeslieIntro1" });
  await execute({ type: "player.claimTutorialFlag", flag: "flashTownExit" });
  await execute({ type: "world.leaveTown" });
  for (const poi of [
    "1-1_Turtorial_Hut_1",
    "1-1_Field_1",
    "1-1_Field_2",
    "1-1_Field_3",
    "Dungeon_1",
  ]) {
    if (committed.projection.location.kind !== "world") break;
    const settlement = await navigate(poi);
    if (poi === "1-1_Field_3") enyaSettlement = settlement;
  }
  fixtureReady =
    committed.projection.location.kind === "world" &&
    committed.projection.location.poiId === "Dungeon_1";
}
assert(fixtureReady, "could not build a surviving authoritative route to North Cave");
reportStep("server fixture reached dungeon entrance");
const enyaRewards = enyaSettlement?.events.find(
  (event) => event.type === "battle.rewardsGranted",
)?.rewards;
assert(
  enyaRewards?.some((reward) => reward.kind === "gem" && reward.level === 7),
  `Enya settlement omitted its authored gem reward: ${JSON.stringify(enyaSettlement?.events)}`,
);
const expectedItems = committed.projection.player.items;
assert(
  Object.keys(expectedItems).length > 0,
  "route battles did not commit an item reward before dungeon entry",
);
assert.deepEqual(committed.projection.location, {
  kind: "world",
  worldId: "World_1-1",
  poiId: "Dungeon_1",
});

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const captureFrame = await createFrameCapture(page, outputDirectory);
  const captureScreenshot = (fileName) => captureFrame(fileName, { fullPage: true });
  const errors = [];
  const commandFailures = [];
  const committedBrowserCommands = [];
  const committedBrowserResults = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/commands")) return;
    const body = response.request().postDataJSON();
    const commandType = body?.command?.type ?? "unknown";
    if (response.status() >= 400) {
      commandFailures.push(
        `${commandType} returned ${response.status()}: ${await response.text()}`,
      );
      return;
    }
    committedBrowserCommands.push(commandType);
    committedBrowserResults.push(await response.json());
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
  });
  const loadContent = async () => {
    await page.locator('input[name="asset-archive"]').setInputFiles(archive);
    await page.getByLabel("Online (Beta)", { exact: true }).check();
    await page.getByLabel("Login token").fill(token);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.locator(".content-gate__login-status--success").waitFor();
    await page.locator(".content-gate__rights input").check();
    await page.getByRole("button", { name: "Play Online", exact: true }).click();
  };
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await loadContent();
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitFor = async (predicate, description, frames = 1_600) => {
    for (let index = 0; index < frames; index++) {
      if (errors.length > 0 || commandFailures.length > 0) {
        throw new Error(
          `${description}; errors=${[...errors, ...commandFailures].join(" | ")}`,
        );
      }
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`);
  };
  await waitFor(
    (snapshot) => snapshot.mode === "start" && snapshot.startup?.phase === "title",
    "official content did not reach title",
  );
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "occupied Official slot did not reach save selection",
  );
  let canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "Official client has no canvas");
  let geometry = await stageGeometry(page, canvasBox);
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, "occupied Official slot is unavailable");
  await advance(500);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);
  snapshot = await waitFor(
    (value) => value.mode === "world",
    "committed Official world did not restore at the dungeon entrance",
  );
  if (snapshot.tutorial !== undefined) {
    snapshot = await waitFor(
      (value) => value.mode === "world" && value.tutorial?.okReady === true,
      "restored field tutorial did not become dismissible",
    );
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.mode === "world" && value.tutorial === undefined,
      "restored field tutorial did not release world input",
    );
  }
  const dungeonPoi = snapshot.pois.find((poi) => poi.name === "Dungeon_1");
  assert(dungeonPoi, `Dungeon_1 is absent from restored world: ${JSON.stringify(snapshot.pois)}`);
  const dungeonPoint = geometry.toCss({
    x: dungeonPoi.position.x,
    y: dungeonPoi.position.y,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.click(dungeonPoint.x, dungeonPoint.y);
    for (let frame = 0; frame < 120; frame++) {
      snapshot = await state();
      if (snapshot.mode !== "world" || snapshot.locked) break;
      await advance(25);
    }
    if (snapshot.mode !== "world" || snapshot.locked) break;
  }
  snapshot = await waitFor(
    (value) => value.mode === "dungeon" && !value.locked,
    "live Official world-to-dungeon entry did not complete",
  );
  reportStep("browser entered dungeon");
  assert.deepEqual(
    snapshot.player.items,
    expectedItems,
    "battle-acquired authoritative items did not reach the live browser profile",
  );
  const enteredRoomId = snapshot.currentRoomId;
  while (
    snapshot.popups?.scene?.depth > 0 ||
    snapshot.popups?.persistent?.depth > 0 ||
    snapshot.floorDetectionChat != null
  ) {
    await page.keyboard.press("Escape");
    await advance(500);
    snapshot = await state();
  }
  const officialDungeonBefore = await page.evaluate(
    () => window.__DIB_TEST_RESTART_SESSION__.snapshot(),
  );
  const commandsBeforePresentationRestarts = committedBrowserCommands.length;
  const restartOfficialDungeon = async (displayMode, textResolutionMode, description) => {
    await page.evaluate(({ displayMode: mode, textResolutionMode: textMode }) => {
      const key = "dib.portSettings.v1";
      const saved = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({
        ...saved,
        displayMode: mode,
        textResolutionMode: textMode,
      }));
    }, { displayMode, textResolutionMode });
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
    const restored = await waitFor(
      (value) =>
        value.mode === "dungeon" &&
        value.displayMode === displayMode &&
        value.textResolutionMode === textResolutionMode &&
        !value.locked,
      description,
    );
    // `mode` publishes before the startup half-fade finishes; a real Options menu is unavailable
    // during that interval, and the reciprocal restart/next room click must wait for it too.
    await advance(1_000);
    const mirror = await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot());
    const drift = firstDifference(mirror, officialDungeonBefore, "snapshot");
    if (drift !== undefined) {
      // The snapshot is a browser persistence aggregate (`currentGameStateSnapshot`), not the wire
      // projection -- some of it is reconstructed by `projectionToGameState` (batting-order
      // recomposition, ISO->epoch injury times, migration defaults, sorted set/cache views) and
      // `pendingBattleRewardKeys` is local-only. So a mismatch here is not automatically an
      // authority defect, and the raw revision/location/decision that WOULD say so are not in the
      // compared object. Print both, plus which restart this was, and let the path decide.
      const provenance = await page.evaluate(
        () => window.__DIB_TEST_RESTART_SESSION__.officialProvenance?.(),
      );
      assert.fail(
        `${description}: Official player/world/dungeon projection mirror changed
` +
        `${formatDifference(drift)}
` +
        `  restart: displayMode=${displayMode} textResolutionMode=${textResolutionMode}
` +
        `  authority provenance now: ${JSON.stringify(provenance)}
` +
        `  gameplay commands committed so far: ${committedBrowserCommands.length}` +
        ` (${commandsBeforePresentationRestarts} before the presentation restarts)`,
      );
    }
    // Backstop: `firstDifference` walks only enumerable JSON-shaped values, so keep the original
    // total equality check behind it rather than trusting the walk to be exhaustive.
    assert.deepEqual(
      mirror,
      officialDungeonBefore,
      `${description}: Official projection mirror changed outside the first-difference walk`,
    );
    assert.equal(restored.floorDetectionChat, undefined, `${description}: floor chat replayed`);
    assert.equal(restored.popups.scene.depth, 0, `${description}: scene popup replayed`);
    assert.equal(restored.popups.persistent.depth, 0, `${description}: persistent popup replayed`);
    return restored;
  };
  await restartOfficialDungeon("ipad", "modern", "Official dungeon did not resume in iPad mode");
  await restartOfficialDungeon("iphone", "modern", "Official dungeon did not resume back in iPhone mode");
  snapshot = await restartOfficialDungeon(
    "iphone",
    "original",
    "Official dungeon did not resume after a text-only change",
  );
  assert.equal(
    committedBrowserCommands.length,
    commandsBeforePresentationRestarts,
    "presentation-only Official restarts submitted gameplay commands",
  );
  canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "Official dungeon canvas disappeared after presentation restarts");
  geometry = await stageGeometry(page, canvasBox);
  if (process.env.DIB_OFFICIAL_PRESENTATION_ONLY === "1") {
    await captureScreenshot("official-dungeon-presentation-restored.png");
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.equal(commandFailures.length, 0, commandFailures.join("\n"));
    console.log("official-dungeon-presentation: PASS (display reciprocal + text-only)");
  } else {
  const enteredSeed = snapshot.seed;
  const enteredExploredRoomIds = snapshot.rooms
    .filter(({ explored }) => explored)
    .map(({ id }) => id)
    .sort();
  const entranceRoom = snapshot.rooms.find(({ id }) => id === snapshot.currentRoomId);
  const worldExit = entranceRoom?.zones.find(({ kind }) => kind === "worldExit");
  assert(worldExit, `entered dungeon room has no authored world exit: ${JSON.stringify(entranceRoom)}`);
  const commandsBeforeExit = committedBrowserCommands.length;
  const exitPoint = geometry.toCss({
    x: snapshot.camera.x +
      (entranceRoom.x * 60 + entranceRoom.width * 60 / 2) * snapshot.camera.scale,
    y: snapshot.camera.y +
      (-(entranceRoom.y + entranceRoom.height) * 60 + entranceRoom.height * 60 / 2 + 10) *
        snapshot.camera.scale,
  });
  await page.mouse.click(exitPoint.x, exitPoint.y);
  snapshot = await waitFor(
    (value) => value.mode === "world" &&
      committedBrowserCommands.length > commandsBeforeExit,
    "authored Official dungeon exit did not return to the world",
  );
  assert.equal(
    committedBrowserCommands.slice(commandsBeforeExit).includes("dungeon.activateZone"),
    true,
    "authored dungeon exit did not commit zone activation",
  );
  assert.equal(
    committedBrowserCommands.slice(commandsBeforeExit).includes("dungeon.selectRoom"),
    false,
    "same-room dungeon exit spent a redundant room-selection command",
  );
  assert.equal(
    committedBrowserCommands.slice(commandsBeforeExit).includes("dungeon.exit"),
    false,
    "browser submitted the removed generic dungeon exit shortcut",
  );
  assert.equal(
    committedBrowserResults.at(-1)?.projection?.dungeon,
    undefined,
    "inactive Official dungeon cache leaked into the public world projection",
  );
  await advance(1_000);
  snapshot = await state();

  const reentryPoi = snapshot.pois.find((poi) => poi.name === "Dungeon_1");
  assert(reentryPoi, "Dungeon_1 is absent after authored dungeon exit");
  const reentryPoint = geometry.toCss({
    x: reentryPoi.position.x,
    y: reentryPoi.position.y,
  });
  const commandsBeforeReentry = committedBrowserCommands.length;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.mouse.click(reentryPoint.x, reentryPoint.y);
    for (let frame = 0; frame < 120; frame++) {
      snapshot = await state();
      if (snapshot.mode !== "world" || snapshot.locked) break;
      await advance(25);
    }
    if (snapshot.mode !== "world" || snapshot.locked) break;
  }
  snapshot = await waitFor(
    (value) => value.mode === "dungeon" &&
      !value.locked &&
      committedBrowserCommands.length > commandsBeforeReentry,
    "Official dungeon cache did not re-enter from the world",
  );
  assert.equal(
    committedBrowserCommands.slice(commandsBeforeReentry).includes("world.navigate"),
    false,
    "same-POI dungeon re-entry spent a redundant world navigation command",
  );
  assert.equal(
    committedBrowserCommands.slice(commandsBeforeReentry).includes("world.activateZone"),
    true,
    "same-POI dungeon re-entry omitted its authoritative zone activation",
  );
  assert.equal(snapshot.seed, enteredSeed, "Official re-entry regenerated the dungeon seed");
  assert.deepEqual(
    snapshot.rooms.filter(({ explored }) => explored).map(({ id }) => id).sort(),
    enteredExploredRoomIds,
    "Official re-entry changed the cached explored-room set",
  );
  await page.waitForTimeout(500);
  await advance(500);
  snapshot = await state();
  assert.equal(
    (snapshot.popups?.scene?.depth ?? 0) + (snapshot.popups?.persistent?.depth ?? 0),
    0,
    "unchanged Catch Challenge redisplayed after Official cache adoption",
  );
  reportStep("exited and re-entered the retained Official dungeon cache");

  const enteredRoom = snapshot.rooms.find(({ id }) => id === snapshot.currentRoomId);
  assert(enteredRoom, `entered dungeon room is absent: ${JSON.stringify(snapshot)}`);
  const safeKeyboardTarget = enteredRoom.links
    .map(({ targetRoomId }) => snapshot.rooms.find(({ id }) => id === targetRoomId))
    .find((candidate) => candidate !== undefined && candidate.encounter === undefined);
  const keyForDirection = { north: "w", east: "d", south: "s", west: "a" };
  let traversedRoomId = enteredRoomId;
  if (safeKeyboardTarget !== undefined) {
    const targetLink = enteredRoom.links.find(({ targetRoomId }) =>
      targetRoomId === safeKeyboardTarget.id);
    assert(targetLink, "safe keyboard target has no source link");
    const direction = targetLink.offset.x === -1
      ? "west"
      : targetLink.offset.x === enteredRoom.width
        ? "east"
        : targetLink.offset.y === -1
          ? "south"
          : targetLink.offset.y === enteredRoom.height
            ? "north"
            : undefined;
    assert(direction, `safe keyboard link is not cardinal: ${JSON.stringify(targetLink)}`);
    const commandsBeforeMove = committedBrowserCommands.length;
    await page.keyboard.press(keyForDirection[direction]);
    const acceptedKeyboardMove = await state();
    assert.equal(
      acceptedKeyboardMove.locked,
      true,
      "directional dungeon input was not acknowledged before authority settlement",
    );
    snapshot = await waitFor(
      (value) =>
        value.mode === "dungeon" &&
        value.currentRoomId === safeKeyboardTarget.id &&
        !value.locked &&
        committedBrowserResults.length > commandsBeforeMove,
      `Official dungeon did not traverse ${direction} from ${enteredRoomId}`,
    );
    assert.equal(
      committedBrowserCommands.slice(commandsBeforeMove).includes("dungeon.selectRoom"),
      true,
      "directional dungeon traversal did not commit a server command",
    );
    const traversalResult = committedBrowserResults.at(-1);
    traversedRoomId =
      traversalResult?.projection?.dungeon?.run?.current?.session?.currentRoomId;
    assert.equal(traversedRoomId, safeKeyboardTarget.id,
      "directional dungeon command omitted its committed room");
    reportStep(`keyboard traversed to ${traversedRoomId}`);
  } else {
    reportStep("entry topology has no clear keyboard target; preserving its encounter for pointer proof");
  }

  // Exercise the pointer path that originally submitted a browser-materialized room which the
  // server had not materialized. Walk the generated graph until an encounter is reached instead
  // of depending on one seed's first neighbor layout.
  const tilePt = 60;
  const visitedRoomIds = new Set([enteredRoomId, traversedRoomId]);
  let pointerTarget;
  let pointerMoveCount = 0;
  let pointerSelectCommitted = false;
  for (; snapshot.mode === "dungeon" && pointerMoveCount < 12; pointerMoveCount++) {
    // Catch-quest progress can mount just after a room transition completes. Give that queued
    // presentation one beat before checking the modal stack so it cannot steal the pointer click.
    await page.waitForTimeout(500);
    await advance(500);
    snapshot = await state();
    while (
      snapshot.popups?.scene?.depth > 0 ||
      snapshot.popups?.persistent?.depth > 0
    ) {
      await page.keyboard.press("Escape");
      await advance(500);
      snapshot = await state();
    }
    const currentRoom = snapshot.rooms.find(({ id }) => id === snapshot.currentRoomId);
    assert(currentRoom, `traversed room is absent: ${snapshot.currentRoomId}`);
    const candidates = currentRoom.links
      .map(({ targetRoomId }) => snapshot.rooms.find(({ id }) => id === targetRoomId))
      .filter((room) => room !== undefined && !visitedRoomIds.has(room.id))
      .sort((left, right) =>
        Number(right.encounter !== undefined) - Number(left.encounter !== undefined) ||
        right.links.length - left.links.length);
    pointerTarget = candidates[0];
    assert(
      pointerTarget,
      `pointer traversal reached a dead end before an encounter: ${JSON.stringify(currentRoom)}`,
    );
    canvasBox = await page.locator("canvas").first().boundingBox();
    assert(canvasBox, "Official dungeon lost its canvas before pointer traversal");
    geometry = await stageGeometry(page, canvasBox);
    const roomCenter = {
      x: pointerTarget.x * tilePt + pointerTarget.width * tilePt / 2,
      y: -(pointerTarget.y + pointerTarget.height) * tilePt +
        pointerTarget.height * tilePt / 2,
    };
    const rawPointerStagePoint = {
      x: snapshot.camera.x + roomCenter.x * snapshot.camera.scale,
      y: snapshot.camera.y + roomCenter.y * snapshot.camera.scale,
    };
    // Native selection accepts a 30-point radius around a room node. A linked room center can sit
    // slightly beyond the clipped viewport while its near edge remains visible, so choose the
    // nearest in-viewport point rather than sending Playwright a negative page coordinate.
    const pointerStagePoint = {
      x: Math.max(5, Math.min(snapshot.screenPt.w - 5, rawPointerStagePoint.x)),
      y: Math.max(5, Math.min(snapshot.screenPt.h - 5, rawPointerStagePoint.y)),
    };
    const pointerCssPoint = geometry.toCss(pointerStagePoint);
    reportStep(
      `clicking ${pointerTarget.id} stage=${JSON.stringify(pointerStagePoint)} ` +
      `css=${JSON.stringify(pointerCssPoint)}`,
    );
    const commandsBeforePointerMove = committedBrowserCommands.length;
    await page.mouse.click(pointerCssPoint.x, pointerCssPoint.y);
    const acceptedPointerMove = await state();
    assert.equal(
      acceptedPointerMove.locked,
      true,
      `pointer dungeon input for ${pointerTarget.id} was not acknowledged immediately`,
    );
    snapshot = await waitFor(
      (value) =>
        committedBrowserResults.length > commandsBeforePointerMove &&
        (
          value.mode === "battle" ||
          (
            value.mode === "dungeon" &&
            value.currentRoomId === pointerTarget.id &&
            !value.locked
          )
      ),
      `Official pointer traversal did not reach ${pointerTarget.id}`,
      300,
    );
    pointerSelectCommitted ||= committedBrowserCommands
      .slice(commandsBeforePointerMove)
      .includes("dungeon.selectRoom");
    visitedRoomIds.add(pointerTarget.id);
  }
  assert.equal(snapshot.mode, "battle", "pointer traversal did not reach a dungeon encounter");
  assert.equal(
    pointerSelectCommitted,
    true,
    "pointer dungeon traversal never committed a server room-selection command",
  );
  reportStep(`pointer traversal reached battle after ${pointerMoveCount} moves`);
  committed = committedBrowserResults.at(-1);
  assert.equal(committed.projection.location.kind, "battle");
  const battleRoomId = committed.projection.dungeon.run.current.session.currentRoomId;
  assert.equal(battleRoomId, pointerTarget.id);
  assert.deepEqual(
    committed.projection.player.items,
    expectedItems,
    "authoritative dungeon battle lost the previously acquired item inventory",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(commandFailures.length, 0, commandFailures.join("\n"));



  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  reportStep("reloaded browser");
  await loadContent();
  await waitFor(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "reloaded Official content did not reach title",
  );
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "reloaded occupied Official slot did not reach save selection",
  );
  canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "reloaded Official client has no canvas");
  geometry = await stageGeometry(page, canvasBox);
  const reloadedSlot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(reloadedSlot?.enabled, "reloaded occupied Official slot is unavailable");
  await advance(500);
  const reloadedSlotPoint = geometry.toCss({
    x: reloadedSlot.x + reloadedSlot.w / 2,
    y: reloadedSlot.y + reloadedSlot.h / 2,
  });
  await page.mouse.click(reloadedSlotPoint.x, reloadedSlotPoint.y);
  snapshot = await waitFor(
    (value) => value.mode === "battle",
    "committed Official dungeon battle did not restore after browser reload",
  );
  reportStep("restored authoritative dungeon battle");
  assert.deepEqual(snapshot.player.items, committed.projection.player.items);
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(commandFailures.length, 0, commandFailures.join("\n"));
  await advance(500);
  snapshot = await state();
  await captureScreenshot("official-dungeon-restored.png");
  reportStep("captured restored-battle screenshot");

  if (postCommitOutcome !== undefined) {
    // Settle the terminal command outside the page, exactly modeling a response that committed at
    // the authority but was lost before the browser coordinator received it. The next document
    // boot must consume the durable v17 receipt without replaying source floor-entry presentation.
    const commandsBeforePostCommitReload = committedBrowserCommands.length;
    if (postCommitOutcome === "victory") await finishBattle(true, true);
    else await finishRetreat();
    assert.equal(committed.projection.location.kind, "dungeon");
    assert.equal(committed.projection.dungeonBattleReturn?.outcome, postCommitOutcome);
    const handoff = committed.projection.dungeonBattleReturn;
    assert(handoff, "terminal command omitted the durable dungeon battle return receipt");
    reportStep(`authority committed lost-response ${postCommitOutcome} handoff`);

    await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await loadContent();
    await waitFor(
      (value) => value.mode === "start" && value.startup?.phase === "title",
      "post-commit reload did not reach title",
    );
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.startup?.phase === "save-select",
      "post-commit reload did not reach save selection",
    );
    canvasBox = await page.locator("canvas").first().boundingBox();
    assert(canvasBox, "post-commit reload has no canvas");
    geometry = await stageGeometry(page, canvasBox);
    const postCommitSlot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(postCommitSlot?.enabled, "post-commit Official slot is unavailable");
    await advance(500);
    const postCommitSlotPoint = geometry.toCss({
      x: postCommitSlot.x + postCommitSlot.w / 2,
      y: postCommitSlot.y + postCommitSlot.h / 2,
    });
    await page.mouse.click(postCommitSlotPoint.x, postCommitSlotPoint.y);
    snapshot = await waitFor(
      (value) => value.mode === "dungeon" && !value.locked,
      `lost-response ${postCommitOutcome} did not restore its dungeon battle-return scene`,
    );
    await advance(1_000);
    snapshot = await state();
    assert.equal(
      snapshot.floorDetectionChat,
      undefined,
      `lost-response ${postCommitOutcome} replayed floor-detection chat`,
    );
    assert.equal(
      committedBrowserCommands.length,
      commandsBeforePostCommitReload,
      `lost-response ${postCommitOutcome} bootstrap submitted a semantic command`,
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    assert.equal(commandFailures.length, 0, commandFailures.join("\n"));
    await captureScreenshot(`official-dungeon-post-commit-${postCommitOutcome}.png`);
    reportStep(`lost-response ${postCommitOutcome} resumed without replaying floor entry`);
    process.stdout.write(JSON.stringify({
      outcome: postCommitOutcome,
      handoff,
      dungeon: snapshot,
    }, null, 2));
  } else {



  const commandsBeforeReconnectReturn = committedBrowserCommands.length;
  let submittedReconnectTurns = 0;
  for (let frame = 0; frame < 8_000 && snapshot.mode === "battle"; frame++) {
    if (errors.length > 0 || commandFailures.length > 0) {
      throw new Error(
        `reconnected dungeon battle failed; errors=${[...errors, ...commandFailures].join(" | ")}`,
      );
    }
    if (snapshot.activePopup === "encounterChat") {
      await advance(550);
      await page.keyboard.press("Enter");
    } else if (
      snapshot.presentation?.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible &&
      !snapshot.turnOrderAnimating &&
      snapshot.statusText?.visible !== true
    ) {
      const attack = snapshot.abilityButtons.find(({ abilityPath }) =>
        abilityPath === "Offensive.Attack");
      assert(attack, `reconnected actor omitted basic Attack: ${JSON.stringify(snapshot.abilityButtons)}`);
      const attackPoint = geometry.toCss(attack.center);
      await page.mouse.click(attackPoint.x, attackPoint.y);
      await advance(50);
      const picking = await state();
      if (picking.picking) {
        const target = picking.monsters.find((monster) =>
          monster.team === 1 && monster.visible && monster.hp > 0);
        assert(target?.targetPoint, `reconnected Attack has no enemy target: ${JSON.stringify(picking.monsters)}`);
        const targetPoint = geometry.toCss(target.targetPoint);
        await page.mouse.click(targetPoint.x, targetPoint.y);
      }
      submittedReconnectTurns += 1;
    } else if (
      snapshot.presentation?.state === "battleEnded" &&
      snapshot.postBattleButtons?.length > 0
    ) {
      await advance(550);
      const buttonPoint = geometry.toCss(snapshot.postBattleButtons[0].point);
      await page.mouse.click(buttonPoint.x, buttonPoint.y);
    } else {
      await advance(50);
    }
    snapshot = await state();
    if (frame % 20 === 0) await page.waitForTimeout(2);
  }
  assert(submittedReconnectTurns > 0, "restored battle never submitted a player turn");
  assert.equal(snapshot.mode, "dungeon", `restored battle did not return to dungeon: ${JSON.stringify(snapshot)}`);
  await advance(1_000);
  snapshot = await state();
  assert.equal(
    snapshot.floorDetectionChat,
    undefined,
    "reconnected battle return replayed the already-consumed floor-detection chat",
  );
  assert.equal(
    committedBrowserCommands
      .slice(commandsBeforeReconnectReturn)
      .includes("world.activateZone"),
    false,
    "reconnected battle return re-entered the dungeon through its world entrance",
  );
  assert(
    committedBrowserCommands
      .slice(commandsBeforeReconnectReturn)
      .includes("battle.chooseAbility"),
    "reconnected battle victory submitted no authoritative ability command",
  );
  await captureScreenshot("official-dungeon-post-reconnect-victory.png");
  reportStep("reconnected battle returned without replaying floor entry");
  process.stdout.write(JSON.stringify({
    enteredRoomId,
    traversedRoomId,
    battleRoomId,
    pointerMoveCount,
    committedBrowserCommands,
    dungeon: snapshot,
  }, null, 2));
  }
  }
} finally {
  await browser.close();
}
