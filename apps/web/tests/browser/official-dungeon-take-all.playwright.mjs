










import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-authority-key";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ?? path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/official-dungeon-take-all");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
fs.mkdirSync(outputDirectory, { recursive: true });
const report = (step) => process.stderr.write(`[take-all] ${step}\n`);

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const sessionResponse = await fetch(`${gameUrl}/api/game/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    protocolVersion: "game-protocol-v1",
    loginToken: token,
    logicPackId: readiness.installedLogicPackIds[0],
    supportedEventVersions: ["presentation-events-v1"],
  }),
});
if (sessionResponse.status !== 200) throw new Error(await sessionResponse.text());
const apiSession = await sessionResponse.json();
const authHeaders = {
  Authorization: `Bearer ${apiSession.token}`,
  "Content-Type": "application/json",
};

const listSlots = async () => {
  const refreshed = await fetch(`${gameUrl}/api/game/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      loginToken: token,
      logicPackId: readiness.installedLogicPackIds[0],
      supportedEventVersions: ["presentation-events-v1"],
    }),
  }).then((response) => response.json());
  authHeaders.Authorization = `Bearer ${refreshed.token}`;
  return refreshed.slots;
};
/** Deletes slot-1 at whatever revision it currently holds, not the one this fixture last saw. */
const deleteSlot = async () => {
  const slot = (await listSlots()).find((entry) => entry.slotId === "slot-1");
  if (slot === undefined) return;
  const deleted = await fetch(`${gameUrl}/api/game/slots/slot-1`, {
    method: "DELETE",
    headers: authHeaders,
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", expectedRevision: slot.revision }),
  });
  if (deleted.status !== 200) throw new Error(await deleted.text());
};
await deleteSlot();

let serial = 0;
let committed;
const runId = Date.now().toString(36);
const execute = async (command) => {
  const response = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      commandId: `browser_take_all_${runId}_${String(++serial).padStart(4, "0")}`,
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
/**
 * Plays a route battle out to a decision. A starter party walking into North Cave is genuinely
 * marginal, so this spends the same recoveries a player would: summon the available spirit, favour
 * a real ability over a basic attack, and accept Save Me while the authority still offers it.
 * Returns false when the party is beaten for good, which discards the slot rather than the run.
 */
const finishBattle = async () => {
  let saveMes = 0;
  let summoned = false;
  for (let turn = 0; committed.projection.location.kind === "battle" && turn < 400; turn++) {
    const decision = committed.projection.decision;
    if (decision.type === "battle.defeatRecovery") {
      if (saveMes >= 3 || !decision.canSaveMe) return false;
      await execute({
        type: "battle.resolveDefeat",
        battleId: decision.battleId,
        recovery: "saveMe",
      });
      saveMes += 1;
      continue;
    }
    assert.equal(decision.type, "battle.playerTurn");
    const capture = committed.projection.player.party.length < 3
      ? decision.captureTargets.find((target) => target.availableCardLevels.some((level) => committed.projection.player.captureCards[level] > 0))
      : undefined;
    if (capture !== undefined) {
      await execute({
        type: "battle.attemptCapture", battleId: decision.battleId, actorId: decision.actorId,
        targetId: capture.targetId, cardLevel: capture.availableCardLevels.find((level) => committed.projection.player.captureCards[level] > 0),
      });
      continue;
    }
    if (!summoned && decision.summonableSpiritTypes.length > 0) {
      await execute({
        type: "battle.summonSpirit",
        battleId: decision.battleId,
        shortType: decision.summonableSpiritTypes[0],
      });
      summoned = true;
      continue;
    }
    const choices = decision.choices.filter((choice) => choice.blockedReasonId === undefined);
    const offensive = choices.filter(({ target }) =>
      ["allEnemies", "enemies", "mixed"].includes(target.kind));
    const usable = offensive.find(({ abilityId }) => abilityId !== "Offensive.Attack") ??
      offensive[0];
    assert(usable, `No usable enemy-targeted ability: ${JSON.stringify(decision.choices)}`);
    await execute({
      type: "battle.chooseAbility",
      battleId: decision.battleId,
      actorId: decision.actorId,
      slot: usable.slot,
      targetIds: targetsFor(usable, decision),
    });
  }
  return committed.projection.location.kind !== "battle";
};

/**
 * Rebuilds slot-1 and walks it to the North Cave entrance. The floor beyond it is generated from
 * a server-chosen seed and its chests roll against `TreasureData` spawn chance, so a given run can
 * legitimately produce a floor with no treasure at all; the caller retries with a fresh slot.
 */
const buildRouteToDungeonEntrance = async () => {
  for (let attempt = 0; attempt < 8; attempt++) {
    if (attempt > 0 || committed !== undefined) {
      await deleteSlot();
      committed = undefined;
    }
    await execute({ type: "slot.create", starterElement: "Water" });
    await execute({ type: "player.claimDialog", dialogId: "LeslieIntro1" });
    await execute({ type: "player.claimTutorialFlag", flag: "flashTownExit" });
    await execute({ type: "world.leaveTown" });
    let survived = true;
    for (const poi of ["1-1_Turtorial_Hut_1", "1-1_Field_1", "1-1_Field_2", "1-1_Field_3", "Dungeon_1"]) {
      if (committed.projection.location.kind !== "world") { survived = false; break; }
      await execute({ type: "world.navigate", targetPoiId: poi });
      if (committed.projection.location.kind === "battle" && !(await finishBattle())) {
        survived = false;
        break;
      }
    }
    if (
      survived &&
      committed.projection.location.kind === "world" &&
      committed.projection.location.poiId === "Dungeon_1"
    ) return;
  }
  assert.fail("could not build a surviving authoritative route to North Cave");
};

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

/** Boots the online client into the committed slot-1 projection on a fresh page. */
const openClient = async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const commandFailures = [];
  const submitted = [];
  const results = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/commands")) return;
    const type = response.request().postDataJSON()?.command?.type ?? "unknown";
    if (response.status() >= 400) {
      commandFailures.push(`${type} returned ${response.status()}: ${await response.text()}`);
      return;
    }
    submitted.push(type);
    results.push(await response.json());
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
  });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await page.getByLabel("Login token").fill(token);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.locator(".content-gate__login-status--success").waitFor();
  await page.locator(".content-gate__rights input").check();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitFor = async (predicate, description, frames = 1_600) => {
    for (let index = 0; index < frames; index++) {
      if (errors.length > 0 || commandFailures.length > 0) {
        throw new Error(`${description}; errors=${[...errors, ...commandFailures].join(" | ")}`);
      }
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}`);
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
  /** Live `eventMode` of a labeled control; "none" is the provider's disabled state. */
  const eventModeOf = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) return node.eventMode;
      if (node?.children) stack.push(...node.children);
    }
    return undefined;
  }, label);
  /** Delivers the source-local release at the control that owns it, disabled controls included. */
  const tap = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) {
        node.emit("pointertap", {
          pointerId: 1,
          getLocalPosition: () => ({ x: 0, y: 0 }),
          stopPropagation() {},
          stopImmediatePropagation() {},
        });
        return true;
      }
      if (node?.children) stack.push(...node.children);
    }
    return false;
  }, label);

  await waitFor(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "official content did not reach title",
  );
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "occupied Official slot did not reach save selection",
  );
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "Official client has no canvas");
  const geometry = await stageGeometry(page, canvasBox);
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, "occupied Official slot is unavailable");
  await advance(500);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);
  snapshot = await waitFor(
    (value) => value.mode === "world" || value.mode === "dungeon",
    "committed Official slot did not restore",
  );
  if (snapshot.tutorial !== undefined) {
    await waitFor((value) => value.tutorial?.okReady === true, "field tutorial never armed");
    await page.keyboard.press("Enter");
    snapshot = await waitFor((value) => value.tutorial === undefined, "field tutorial never released");
  }
  const dismissPopups = async () => {
    let current = await state();
    for (let guard = 0; guard < 8; guard++) {
      if (
        (current.popups?.scene?.depth ?? 0) === 0 &&
        (current.popups?.persistent?.depth ?? 0) === 0 &&
        current.floorDetectionChat == null
      ) break;
      await page.keyboard.press("Escape");
      await advance(500);
      current = await state();
    }
    return current;
  };
  return {
    page, state, advance, waitFor, labels, eventModeOf, tap, geometry,
    dismissPopups, errors, commandFailures, submitted, results, snapshot,
  };
};

/** Enters Dungeon_1 from the restored world by tapping its POI. */
const enterDungeon = async (client) => {
  let snapshot = await client.state();
  const poi = snapshot.pois.find((entry) => entry.name === "Dungeon_1");
  assert(poi, `Dungeon_1 is absent: ${JSON.stringify(snapshot.pois)}`);
  const point = client.geometry.toCss({ x: poi.position.x, y: poi.position.y });
  for (let attempt = 0; attempt < 3; attempt++) {
    await client.page.mouse.click(point.x, point.y);
    for (let frame = 0; frame < 120; frame++) {
      snapshot = await client.state();
      if (snapshot.mode !== "world" || snapshot.locked) break;
      await client.advance(25);
    }
    if (snapshot.mode !== "world" || snapshot.locked) break;
  }
  return client.waitFor(
    (value) => value.mode === "dungeon" && !value.locked,
    "live Official world-to-dungeon entry did not complete",
  );
};

const keyForDirection = { north: "w", east: "d", south: "s", west: "a" };
const directionOf = (room, link) =>
  link.offset.x === -1
    ? "west"
    : link.offset.x === room.width
      ? "east"
      : link.offset.y === -1
        ? "south"
        : link.offset.y === room.height
          ? "north"
          : undefined;
/**
 * Breadth-first room path from `fromId` to the nearest room satisfying `accept`, never routing
 * through a room `avoid` rejects. The destination itself is exempt: a guarded chest room has to be
 * entered, and its encounter is cleared on the way in.
 */
const routeTo = (rooms, fromId, accept, avoid = () => false) => {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const queue = [[fromId, []]];
  const seen = new Set([fromId]);
  while (queue.length > 0) {
    const [id, walked] = queue.shift();
    const room = byId.get(id);
    if (room === undefined) continue;
    if (id !== fromId && accept(room)) return walked;
    for (const link of room.links) {
      const next = byId.get(link.targetRoomId);
      if (next === undefined || seen.has(next.id)) continue;
      const direction = directionOf(room, link);
      if (direction === undefined) continue;
      seen.add(next.id);
      if (avoid(next) && !accept(next)) continue;
      queue.push([next.id, [...walked, { direction, roomId: next.id, room: next }]]);
    }
  }
  return undefined;
};
/** Nearest chest, preferring a walk this starter party does not have to fight its way along. */
const routeToChest = (rooms, fromId) => {
  const hasChest = (room) => room.treasure !== undefined;
  return routeTo(rooms, fromId, hasChest, (room) => room.encounter !== undefined) ??
    routeTo(rooms, fromId, hasChest);
};

try {
  // ---- Legs 1+2: find a claimable chest and park the party next to it ---------------------
  // Two things about a North Cave floor are only knowable by trying it: the authority projects a
  // seed rather than a room graph, so only a booted client can say whether this floor rolled any
  // treasure at all; and a starter party can lose a route battle on the way to the one it rolled.
  // Either outcome discards the slot and rolls a fresh floor rather than failing the contract.
  let snapshot;
  let chestHop;
  let approachRoomId;
  for (let attempt = 0; attempt < 6 && chestHop === undefined; attempt++) {
    await buildRouteToDungeonEntrance();
    report(`server fixture reached the dungeon entrance (attempt ${attempt + 1})`);
    const survey = await openClient();
    await enterDungeon(survey);
    await survey.dismissPopups();
    snapshot = await survey.state();
    assert.equal(survey.errors.length, 0, survey.errors.join(" | "));
    assert.equal(survey.commandFailures.length, 0, survey.commandFailures.join(" | "));
    const floorRooms = snapshot.rooms;
    const entranceRoomId = snapshot.currentRoomId;
    // `expectedRevision`/`expectedDecisionId` have to come from the client's own last result: the
    // slot listing carries no decision id, and a slot parked on an open decision rejects any
    // command that does not name it.
    const resumeFrom = survey.results.at(-1);
    await survey.page.close();

    const walk = routeToChest(floorRooms, entranceRoomId);
    if (walk === undefined || walk.length === 0) {
      report(`floor from ${entranceRoomId} rolled no treasure; retrying with a fresh slot`);
      continue;
    }
    const candidate = walk[walk.length - 1];
    report(`chest ${candidate.room.treasure} is ${walk.length} room(s) away in ${candidate.roomId}`);

    const liveSlot = (await listSlots()).find((entry) => entry.slotId === "slot-1");
    assert(liveSlot, "slot-1 disappeared after the survey client entered the dungeon");
    assert(resumeFrom, "survey client committed no command to resume from");
    assert.equal(resumeFrom.revision, liveSlot.revision, "survey client result is stale");
    committed = resumeFrom;

    let lost = false;
    for (const hop of walk) {
      await execute({ type: "dungeon.selectRoom", roomId: hop.roomId });
      if (committed.projection.location.kind !== "battle") continue;
      if (await finishBattle()) continue;
      report(`route battle in ${hop.roomId} beat this starter party; retrying with a fresh slot`);
      lost = true;
      break;
    }
    if (lost) continue;

    // A guarded chest only becomes visible once its encounter is cleared, and the loot provider is
    // driven by ROOM ENTRY. Step back out so the live client can walk in and trigger it.
    approachRoomId = walk.length > 1 ? walk[walk.length - 2].roomId : entranceRoomId;
    if (approachRoomId !== candidate.roomId) {
      await execute({ type: "dungeon.selectRoom", roomId: approachRoomId });
    }
    const runSession = committed.projection.dungeon?.run?.current?.session;
    assert(runSession, "authority lost its dungeon run while pre-clearing the chest room");
    assert.equal(
      runSession.collectedTreasureIds?.includes(candidate.room.treasure) ?? false,
      false,
      "pre-clearing the encounter also collected the treasure",
    );
    assert.equal(runSession.currentRoomId, approachRoomId);
    chestHop = candidate;
    report(`authority parked at ${approachRoomId}, chest still unclaimed`);
  }
  assert(
    chestHop !== undefined,
    "six Official North Cave floors in a row produced no claimable chest",
  );

  // ---- Leg 3: claim it in the browser -----------------------------------------------------
  const client = await openClient();
  let releaseClaim;
  const claimHeld = new Promise((resolve) => { releaseClaim = resolve; });
  let claimRequests = 0;
  // The claim's in-flight window is the thing under test, so hold `dungeon.openTreasure` open
  // until the assertions below release it. Every other command passes straight through.
  await client.page.route("**/api/game/slots/*/commands", async (route) => {
    if (route.request().postDataJSON()?.command?.type !== "dungeon.openTreasure") {
      await route.continue();
      return;
    }
    claimRequests += 1;
    await claimHeld;
    await route.continue();
  });
  snapshot = await client.waitFor(
    (value) => value.mode === "dungeon" && !value.locked,
    "Official client did not restore into the pre-cleared dungeon",
  );
  await client.dismissPopups();
  snapshot = await client.state();
  assert.equal(snapshot.currentRoomId, approachRoomId, "restored client is not at the approach room");
  const approachRoom = snapshot.rooms.find((room) => room.id === approachRoomId);
  const chestLink = approachRoom.links.find((link) => link.targetRoomId === chestHop.roomId);
  assert(chestLink, `approach room has no link into ${chestHop.roomId}`);
  const chestDirection = directionOf(approachRoom, chestLink);
  assert(chestDirection, "link into the chest room is not cardinal");

  await client.page.keyboard.press(keyForDirection[chestDirection]);
  snapshot = await client.waitFor(
    (value) => value.lootProvider !== undefined,
    "Official treasure room did not mount the loot provider",
  );
  report(`loot provider mounted for ${snapshot.lootProvider.treasureId}`);
  assert.equal(snapshot.pendingAction, "treasure");
  assert(snapshot.lootProvider.pendingCount > 0, JSON.stringify(snapshot.lootProvider));
  const mounted = await client.labels();
  assert.equal(mounted.dungeonLootPage, 1, JSON.stringify(mounted));
  assert.equal(mounted["popupButton:Take All"], 1, JSON.stringify(mounted));
  assert.equal(await client.eventModeOf("popupButton:Take All"), "static");

  const submittedBeforeClaim = client.submitted.length;
  assert.equal(await client.tap("popupButton:Take All"), true, "Take All control was not reachable");
  // Give the claim room to reach the network and, under the old ordering, to have dismissed.
  for (let index = 0; index < 40; index++) await client.advance(25);

  assert.equal(claimRequests, 1, `Take All submitted ${claimRequests} dungeon.openTreasure commands`);
  const inFlightLabels = await client.labels();
  assert.equal(
    inFlightLabels.dungeonLootPage,
    1,
    "loot card was removed before its authority claim settled - the pre-fix ordering",
  );
  assert.equal(inFlightLabels["popupButton:Take All"], 1, JSON.stringify(inFlightLabels));
  const inFlight = await client.state();
  assert.notEqual(inFlight.lootProvider, undefined);
  assert.equal(inFlight.pendingAction, "treasure");
  assert.equal(inFlight.locked, true, "dungeon movement unlocked while the claim was pending");
  // Every control the display owns is refused locally while one claim is in flight.
  assert.equal(await client.eventModeOf("popupButton:Take All"), "none");
  assert.equal(await client.eventModeOf("dungeonLootNext"), "none");
  assert.equal(await client.eventModeOf("dungeonLootPrevious"), "none");
  assert.equal(await client.eventModeOf("dungeonLootPageViewport"), "none");
  report("claim is in flight with the loot card still mounted");

  await client.tap("popupButton:Take All");
  await client.tap("popupButton:Take All");
  for (let index = 0; index < 20; index++) await client.advance(25);
  assert.equal(claimRequests, 1, "repeat Take All taps reached the authority a second time");
  assert.equal(
    client.submitted.length,
    submittedBeforeClaim,
    "a command settled while the held claim was still outstanding",
  );

  releaseClaim();
  await client.waitFor(
    (value) => value.lootProvider === undefined,
    "loot provider never released after its claim committed",
  );
  const settled = await client.labels();
  assert.equal(settled.dungeonLootPage, undefined, JSON.stringify(settled));
  const claims = client.submitted.filter((type) => type === "dungeon.openTreasure");
  assert.equal(claims.length, 1, `dungeon.openTreasure committed ${claims.length} times`);
  report("loot card removed after settlement, exactly one claim committed");

  // Whatever continuation the claim produced runs only once the card is gone: the provider's
  // `hidesWhenNotOnTop` is 0, so a modal mounted earlier would sit over live loot.
  snapshot = await client.waitFor(
    (value) =>
      value.mode !== "dungeon" ||
      (value.pendingAction === undefined && !value.locked) ||
      (value.popups?.persistent?.depth ?? 0) > 0 ||
      (value.popups?.scene?.depth ?? 0) > 0,
    "dungeon neither released its entry lock nor presented a continuation",
  );
  const continuation = await client.labels();
  assert.equal(continuation.dungeonLootPage, undefined, JSON.stringify(continuation));
  if ((snapshot.popups?.persistent?.depth ?? 0) + (snapshot.popups?.scene?.depth ?? 0) > 0) {
    report("claim produced a post-dismiss continuation, mounted after the loot card was gone");
  }

  assert.equal(client.errors.length, 0, client.errors.join("\n"));
  assert.equal(client.commandFailures.length, 0, client.commandFailures.join("\n"));
  console.log("official-dungeon-take-all: PASS (settle behind the live card, one command, then remove)");
} finally {
  await browser.close();
}
