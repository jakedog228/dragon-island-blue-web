// Opt-in regression using an existing local Official test account with a discovered waypoint.
// Setup uses semantic commands only; it never creates/replaces player state or deletes slots.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { clickNativeLabel } from "./nativeLabelInput.mjs";
import { stageGeometry } from "./stageGeometry.mjs";
import { createFrameCapture } from "./captureFrame.mjs";

const webUrl = process.env.DIB_WEB_URL;
const apiUrl = process.env.DIB_GAME_URL;
assert(webUrl && apiUrl && process.env.DIB_TEST_AUTH_KEY_FILE, "Supply local web/API URLs and a test account credential file");
for (const url of [webUrl, apiUrl]) assert(["localhost", "127.0.0.1"].includes(new URL(url).hostname));
const { loginToken } = JSON.parse(fs.readFileSync(process.env.DIB_TEST_AUTH_KEY_FILE, "utf8"));
const output = path.resolve(process.env.DIB_OFFICIAL_DUNGEON_OUTPUT ?? "output/official-waypoint-pending");
fs.mkdirSync(output, { recursive: true });
const json = async (url, options) => {
  const response = await fetch(url, options);
  assert(response.ok, `${response.status}: ${await response.clone().text()}`);
  return response.json();
};
const readiness = await json(`${apiUrl}/api/game/readiness`);
const session = await json(`${apiUrl}/api/game/session`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ protocolVersion: "game-protocol-v1", loginToken,
    logicPackId: readiness.installedLogicPackIds[0], supportedEventVersions: ["presentation-events-v1"] }) });
const headers = { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
let committed = await json(`${apiUrl}/api/game/slots/slot-1/bootstrap`, { headers });
committed = { revision: committed.revision, projection: committed };
const execute = async command => {
  committed = await json(`${apiUrl}/api/game/slots/slot-1/commands`, { method: "POST", headers,
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", commandId: randomUUID(), expectedRevision: committed.revision,
      expectedDecisionId: committed.projection.decision.decisionId, command }) });
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
const finishBattle = async () => {
  for (let turn = 0; committed.projection.location.kind === "battle" && turn < 200; turn++) {
    const decision = committed.projection.decision;
    assert.equal(decision.type, "battle.playerTurn", "Setup route must be survivable by the supplied test account");
    const choices = decision.choices.filter(choice => choice.blockedReasonId === undefined &&
      ["allEnemies", "enemies", "mixed"].includes(choice.target.kind));
    const choice = choices.find(choice => choice.abilityId !== "Offensive.Attack") ?? choices[0];
    assert(choice, "No usable attack in setup battle");
    await execute({ type: "battle.chooseAbility", battleId: decision.battleId, actorId: decision.actorId,
      slot: choice.slot, targetIds: targetsFor(choice, decision) });
  }
  assert.notEqual(committed.projection.location.kind, "battle", "setup battle exceeded 200 turns");
};
console.log("setup location", committed.projection.location);
const setupBefore = committed;
await finishBattle();
if (process.env.DIB_WAYPOINT_SETUP_COMMANDS) {
  const setup = JSON.parse(fs.readFileSync(process.env.DIB_WAYPOINT_SETUP_COMMANDS, "utf8"));
  assert(Array.isArray(setup));
  for (const command of setup) { console.log("setup command", command); await execute(command); await finishBattle(); }
}
assert.equal(committed.projection.location.kind, "world");
const poiId = committed.projection.world.currentPoiId;
assert(poiId.startsWith("Dungeon_"), "The test account must be at its dungeon entrance");
fs.writeFileSync(path.join(output, "setup.json"), JSON.stringify({ before: setupBefore, after: committed }, null, 2));
const displayMode = process.env.DIB_DISPLAY_MODE ?? "iphone";
assert(["iphone", "ipad"].includes(displayMode));
const browser = await chromium.launch({ channel: "chromium", headless: true, args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
let release = () => {};
const errors = [], commands = [], failures = [];
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 }, serviceWorkers: "block" });
  const page = await context.newPage();
  const capture = await createFrameCapture(page, output);
  page.on("pageerror", error => errors.push(String(error)));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("request", request => {
    if (new URL(request.url()).pathname.endsWith("/commands")) commands.push(request.postDataJSON().command);
  });
  page.on("response", async response => {
    if (new URL(response.url()).pathname.endsWith("/commands") && response.status() >= 400)
      failures.push(`${response.status()}: ${await response.text()}`);
  });
  await page.addInitScript(displayMode => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode, textResolutionMode: "modern", sound: 0, music: 0 }));
  }, displayMode);
  await page.goto(webUrl);
  await page.locator('input[name="asset-archive"]').setInputFiles(path.resolve(process.env.DIB_CONTENT_ARCHIVE ?? "Dragon_Island_Blue_1.1.0.ipa"));
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await page.getByLabel("Login token").fill(loginToken);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.locator(".content-gate__login-status--success").waitFor({ timeout: 120000 });
  await page.locator(".content-gate__rights input").check();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", null, { timeout: 120000 });
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
  const wait = async (predicate, description) => {
    for (let i = 0; i < 1600; i++) { assert.deepEqual([...errors, ...failures], []); const s = await state(); if (predicate(s)) return s; await advance(50); }
    throw new Error(`${description}: ${JSON.stringify(await state())}`);
  };
  await wait(s => s.startup?.phase === "title", "title");
  await page.keyboard.press("Enter");
  let s = await wait(s => s.startup?.phase === "save-select", "save selector");
  await advance(500);
  const geometry = await stageGeometry(page, await page.locator("canvas").first().boundingBox());
  const slot = s.startup.menu.buttons.find(button => button.id === "slot-1");
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);
  s = await wait(s => s.mode === "world" && !s.locked, "world entrance");
  await advance(1500);
  const poi = s.pois.find(poi => poi.name === poiId);
  const poiPoint = geometry.toCss(poi.position);
  await page.mouse.click(poiPoint.x, poiPoint.y);
  s = await wait(s => s.mode === "dungeon" && s.waypointSelection, "entrance waypoint selector");
  await advance(1500);
  const gate = new Promise(resolve => { release = resolve; });
  let held, destination;
  await page.route("**/api/game/slots/*/commands", async route => {
    const command = route.request().postDataJSON().command;
    if (command.type !== "dungeon.travelToWaypoint") return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    destination = (await response.json()).projection;
    held = true;
    await gate;
    await route.fulfill({ response });
  });
  const before = commands.length;
  assert(await clickNativeLabel(page, "waypointGoTo"));
  await wait(() => held, "waypoint response held");
  s = await state();
  const current = s.rooms.find(room => room.id === s.currentRoomId);
  const target = s.rooms.find(room => current.links.some(link => link.targetRoomId === room.id));
  assert(target);
  const rect = { x: s.camera.x + target.x * 60 * s.camera.scale,
    y: s.camera.y - (target.y + target.height) * 60 * s.camera.scale,
    w: target.width * 60 * s.camera.scale, h: target.height * 60 * s.camera.scale };
  const point = geometry.toCss({ x: (Math.max(12, rect.x + 5) + Math.min(s.screenPt.w - 12, rect.x + rect.w - 5)) / 2,
    y: (Math.max(40, rect.y + 5) + Math.min(s.screenPt.h - 25, rect.y + rect.h - 5)) / 2 });
  const hitPath = await page.evaluate(point => {
    const app = window.__PIXI_APP__, box = app.canvas.getBoundingClientRect();
    let node = app.renderer.events.rootBoundary.hitTest((point.x - box.x) * app.screen.width / box.width,
      (point.y - box.y) * app.screen.height / box.height);
    const labels = [];
    for (; node; node = node.parent) if (node.label) labels.push(node.label);
    return labels;
  }, point);
  assert(hitPath.includes("dungeonPointRoot"), "Pointer must reach the old dungeon input surface");
  for (let i = 0; i < 3; i++) { await page.mouse.click(point.x, point.y); await advance(100); }
  for (const key of ["ArrowUp", "ArrowRight", "Escape"]) await page.keyboard.press(key);
  await advance(1000);
  const pending = await state();
  await capture("pending.png");
  fs.writeFileSync(path.join(output, "pending.json"), JSON.stringify({ pending, destination: destination.location, commands: commands.slice(before), target: target.id, point, hitPath, errors, failures }, null, 2));
  assert.equal(pending.locked, true, "Old floor accepts input during a committed waypoint jump");
  assert.equal(pending.currentRoomId, current.id);
  assert.deepEqual(commands.slice(before).map(command => command.type), ["dungeon.travelToWaypoint"]);
  release();
  const arrived = await wait(s => s.mode === "dungeon" && s.floor === destination.location.floor && !s.locked, "destination floor");
  assert.equal(arrived.currentRoomId, destination.location.roomId);
  await advance(3000);
  for (let i = 0; i < 4; i++) { await page.keyboard.press("Enter"); await advance(500); }
  if (await clickNativeLabel(page, "catchQuestClose")) await advance(500);
  await capture("arrived.png");
  s = await state();
  assert.equal(s.floor, destination.location.floor);
  const destinationRoom = s.rooms.find(room => room.id === s.currentRoomId);
  const nextRoom = s.rooms.find(room => destinationRoom.links.some(link => link.targetRoomId === room.id));
  assert(nextRoom);
  const nextPoint = geometry.toCss({
    x: Math.max(12, Math.min(s.screenPt.w - 12, s.camera.x + (nextRoom.x + nextRoom.width / 2) * 60 * s.camera.scale)),
    y: Math.max(40, Math.min(s.screenPt.h - 25, s.camera.y - (nextRoom.y + nextRoom.height / 2) * 60 * s.camera.scale)),
  });
  await page.mouse.click(nextPoint.x, nextPoint.y);
  const moved = await wait(s => (s.mode === "battle" && s.entry?.transitionFinished && s.presentation?.state === "awaitingPlayerChoice") || (s.mode === "dungeon" && s.currentRoomId === nextRoom.id && !s.locked), "movement after waypoint");
  assert(commands.slice(before).some(command => command.type === "dungeon.selectRoom" && command.roomId === nextRoom.id));
  await capture("moved.png");
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ pass: true, sourceFloor: pending.floor, arrived, moved, commands: commands.slice(before), errors, failures }, null, 2));
  console.log("official-waypoint-pending: PASS");
} finally { release(); await browser.close(); }
