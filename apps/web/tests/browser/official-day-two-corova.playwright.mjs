

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-authority-key";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/official-day-two-corova");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
assert(token.length >= 16, "DIB_TEST_AUTH_KEY must contain at least 16 characters");
fs.mkdirSync(outputDirectory, { recursive: true });

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
const execute = async (command) => {
  const expectedRevision = committed?.revision ?? 0;
  const decision = committed?.projection.decision;
  const response = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      commandId: `browser_day_two_${String(++serial).padStart(4, "0")}`,
      expectedRevision,
      ...(decision?.decisionId === undefined ? {} : { expectedDecisionId: decision.decisionId }),
      command,
    }),
  });
  if (response.status !== 200) {
    throw new Error(`${command.type} failed: ${await response.text()}`);
  }
  committed = await response.json();
  return committed;
};

const targetsFor = (choice, decision) => {
  switch (choice.target.kind) {
    case "self":
      return [decision.actorId];
    case "allEnemies":
      return [...decision.enemyTargetIds];
    case "allFriends":
      return [...decision.friendlyTargetIds];
    case "enemies":
      return decision.enemyTargetIds.slice(0, choice.target.count);
    case "friends":
      return decision.friendlyTargetIds.slice(0, choice.target.count);
    case "mixed":
      return [
        ...(choice.target.allEnemies
          ? decision.enemyTargetIds
          : decision.enemyTargetIds.slice(0, choice.target.enemyCount)),
        ...(choice.target.allFriends
          ? decision.friendlyTargetIds
          : decision.friendlyTargetIds.slice(0, choice.target.friendlyCount)),
      ];
    default:
      throw new Error(`Unhandled target shape ${JSON.stringify(choice.target)}`);
  }
};

await execute({ type: "slot.create", starterElement: "Water" });
await execute({ type: "player.claimDialog", dialogId: "LeslieIntro1" });
await execute({ type: "player.claimTutorialFlag", flag: "flashTownExit" });
await execute({ type: "world.leaveTown" });
await execute({ type: "world.navigate", targetPoiId: "1-1_Turtorial_Hut_1" });
await execute({ type: "world.navigate", targetPoiId: "1-1_Field_1" });
assert.equal(committed.projection.location.kind, "battle", "Field 1 did not start its fixed battle");

for (let turn = 0; committed.projection.location.kind === "battle" && turn < 100; turn++) {
  const decision = committed.projection.decision;
  assert.equal(decision.type, "battle.playerTurn", "battle did not settle at a player decision");
  const choices = decision.choices.filter((choice) => choice.blockedReasonId === undefined);
  const choice =
    choices.find(({ abilityId, target }) =>
      abilityId === "Offensive.Attack" && (
        target.kind === "allEnemies" ||
        target.kind === "enemies" ||
        target.kind === "mixed"
      )) ??
    choices.find(({ target }) =>
      target.kind === "allEnemies" ||
      target.kind === "enemies" ||
      target.kind === "mixed");
  assert(choice, `No usable enemy-targeted ability: ${JSON.stringify(decision.choices)}`);
  await execute({
    type: "battle.chooseAbility",
    battleId: decision.battleId,
    actorId: decision.actorId,
    slot: choice.slot,
    targetIds: targetsFor(choice, decision),
  });
}
assert.notEqual(committed.projection.location.kind, "battle", "Field 1 battle exceeded 100 turns");
assert(
  committed.events.some((event) => event.type === "battle.ended" && event.outcome === "victory"),
  `Field 1 did not end in victory: ${JSON.stringify(committed.events)}`,
);
assert.deepEqual(committed.projection.location, {
  kind: "world",
  worldId: "World_1-1",
  poiId: "1-1_Field_1",
});
assert.equal(committed.projection.world.dayNumber, 1);
assert(
  committed.projection.quests.dialogsSeen.includes("LeslieSaved"),
  "Field 1 victory did not unlock the Corova Guild condition",
);

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      errors.push(`response: ${response.status()} ${response.url()}`);
    }
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
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`);
  };
  const pixiControlCenter = (label) => page.evaluate((wanted) => {
      const effectivelyVisible = (node) => {
        for (let current = node; current; current = current.parent) {
          if (!current.visible || !current.renderable) return false;
        }
        return true;
      };
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === wanted && effectivelyVisible(node)) {
          const bounds = node.getBounds();
          if (bounds.width > 0 && bounds.height > 0) {
            return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          }
        }
        stack.push(...(node?.children ?? []));
      }
      return null;
    }, label);
  const activatePixiControl = async (label) => {
    const center = await pixiControlCenter(label);
    if (center === null) return false;
    const liveCanvas = await page.locator("canvas").first().boundingBox();
    assert(liveCanvas, "official client lost its canvas before a Pixi control click");
    await page.mouse.click(liveCanvas.x + center.x, liveCanvas.y + center.y);
    return true;
  };
  const waitForPixiControl = async (label, description) => {
    for (let frame = 0; frame < 240; frame++) {
      if (await pixiControlCenter(label) !== null) return;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`);
  };

  await waitFor(
    (snapshot) => snapshot.mode === "start" && snapshot.startup?.phase === "title",
    "official content did not reach the source title",
  );
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "title did not open save selection",
  );
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, "official client has no canvas");
  const geometry = await stageGeometry(page, canvasBox);
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, `authoritative slot is unavailable: ${JSON.stringify(snapshot.startup)}`);
  await advance(500);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);

  snapshot = await waitFor(
    (value) =>
      value.mode === "world" &&
      value.currentPoi === "1-1_Field_1" &&
      !value.walking &&
      value.overlay === null,
    "post-Goblin world did not become interactive",
  );
  const corova = snapshot.pois.find(
    (poi) => poi.name === "First_City" && poi.state !== 3,
  );
  assert(corova, `post-Goblin Corova shortcut is unavailable: ${JSON.stringify(snapshot.poiStates)}`);
  // Use the live world geometry and sample the POI's center before its small horizontal edge.
  // The flag/base textures differ in opaque width, so a single inherited +8 point offset can miss
  // Corova even though the logical POI is selectable.
  for (const offsetX of [0, 8, -8]) {
    const liveCanvasBox = await canvas.boundingBox();
    assert(liveCanvasBox, "official client lost its canvas before Corova navigation");
    const liveGeometry = await stageGeometry(page, liveCanvasBox);
    const corovaPoint = liveGeometry.toCss({
      x: corova.position.x + offsetX,
      y: corova.position.y,
    });
    await page.mouse.click(corovaPoint.x, corovaPoint.y);
    for (let frame = 0; frame < 80; frame++) {
      const current = await state();
      if (current.mode !== "world" || current.currentPoi !== "1-1_Field_1" || current.locked) break;
      await advance(25);
    }
    const current = await state();
    if (current.mode !== "world" || current.currentPoi !== "1-1_Field_1" || current.locked) break;
  }

  snapshot = await waitFor(
    (value) =>
      value.mode === "town" &&
      value.town?.name === "First_City" &&
      value.overlay?.kind === "townEnterChat" &&
      value.overlay.chatName === "LeslieIntro2",
    "post-Goblin Corova navigation did not present LeslieIntro2",
  );
  for (let page = 0; snapshot.overlay?.kind === "townEnterChat" && page < 20; page++) {
    await advance(550);
    await waitForPixiControl("guildQuestChat", "town enter chat did not finish mounting");
    assert(await activatePixiControl("guildQuestChat"), "town enter chat was not mounted");
    await advance(25);
    snapshot = await state();
  }
  snapshot = await waitFor(
    (value) => value.overlay === null,
    "day-2 Corova story dialog did not finish",
  );
  const tavern = snapshot.town.buildings.find(
    ({ className }) => className === "TavernMenuItem",
  );
  assert(tavern?.enabled, `Guild of Corova remained disabled: ${JSON.stringify(snapshot.town)}`);
  assert.equal(snapshot.town.flashing?.key, "FirstTavernFlash");
  assert.equal(snapshot.town.flashing?.target, tavern.sourceIndex);
  assert.equal(snapshot.town.flashing?.running, true);
  assert.notEqual(snapshot.town.flashing.target, "exit", "Leave Town retained the day-1 pulse");

  assert(
    await activatePixiControl("town:First_City:menu:MonsterManagementMenuItem"),
    "Corova Monster Management control was not mounted",
  );
  snapshot = await waitFor(
    (value) => value.overlay?.screen === "partyEditor" && value.overlay.style === 0,
    "day-2 Corova Monster Management did not open",
  );
  let tutorialState = await waitFor(
    (value) => value.tutorial?.okReady === true,
    "day-2 Corova party tutorial did not become dismissible",
  );
  for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
    const previousPage = tutorialState.tutorial.page;
    await page.keyboard.press("Enter");
    tutorialState = await waitFor(
      (value) =>
        value.tutorial === undefined ||
        (value.tutorial.okReady === true && value.tutorial.page !== previousPage),
      "day-2 Corova party tutorial did not advance",
    );
    if (tutorialState.tutorial === undefined) break;
  }
  assert.equal((await state()).tutorial, undefined, "day-2 Corova party tutorial did not finish");
  assert(await activatePixiControl("partyEditorClose"), "party editor close control was not mounted");
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.overlay === null && !value.locked,
    "day-2 Corova party editor did not close",
  );

  assert(
    await activatePixiControl("town:First_City:menu:TavernMenuItem"),
    "Guild of Corova control was not mounted",
  );
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "guildQuests" && value.overlay.tavernOpen,
    "Guild of Corova did not open",
  );
  assert(snapshot.overlay.availableCount > 0, "Corova Guild had no available quest");
  await page.screenshot({
    path: path.join(outputDirectory, "corova-guild-day-two.png"),
    fullPage: true,
    timeout: 120_000,
  });

  assert(
    await activatePixiControl("guildTavern:newQuest"),
    "Official Guild New Quest control was not mounted",
  );
  snapshot = await waitFor(
    (value) =>
      value.overlay?.kind === "guildQuests" &&
      value.overlay.chatOpen &&
      value.overlay.activeQuestNames?.[0] === "MacworldCatch",
    "Official Guild did not commit and describe MacworldCatch",
  );
  await advance(550);
  assert(await activatePixiControl("guildQuestChat"), "Official quest description was not mounted");
  await waitFor(
    (value) => value.overlay?.kind === "guildQuests" && !value.overlay.chatOpen,
    "Official quest description did not close",
  );
  // Global banners wait behind the modal quest description. Sample the queue while the already-
  // visible Day 2 notice leaves so this observes the committed notification during its source
  // three-second lifetime instead of advancing across both banners before asserting.
  snapshot = await waitFor(
    (value) =>
      value.guildQuests?.notification?.kind === "accepted" &&
      value.guildQuests.notification.questName === "MacworldCatch",
    "Official quest acceptance did not enqueue its source notification",
  );
  assert.match(snapshot.guildQuests.notification.title, /^Quest .+ Accepted! \(1\/3 quests\)$/);
  assert.equal(
    snapshot.guildQuests.notification.message,
    "Return to town once you finish the quest.",
  );
  await page.screenshot({
    path: path.join(outputDirectory, "official-quest-accepted.png"),
    fullPage: true,
    timeout: 120_000,
  });

  await page.keyboard.press("Escape");
  await waitFor((value) => value.overlay === null, "Guild of Corova did not close");
  assert(await activatePixiControl("town:First_City:exit"), "Leave Town control was not mounted");
  snapshot = await waitFor(
    (value) => value.mode === "world" && !value.locked,
    "day-2 Leave Town did not return to the overworld",
  );
  assert.equal(snapshot.transitionFailure, undefined);
  assert.equal(errors.length, 0, errors.join("\n"));
  process.stdout.write(JSON.stringify({
    dayNumber: snapshot.notifications.dayNotification?.day,
    guildUnlockedBy: "LeslieSaved",
    final: snapshot,
  }, null, 2));
} finally {
  await browser.close();
}
