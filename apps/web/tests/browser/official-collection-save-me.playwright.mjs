// Opt-in end-to-end Official Collection + Save Me contract. It requires the test-only fixture from
// officialCollectionSaveMeFixture.mjs, a fresh file-backed current service installed from that
// fixture's extracted directory, and a matching browser-selectable archive. It also regresses ordinary
// defeat -> town restoration -> next encounter construction. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5199";
const gameUrl = process.env.DIB_GAME_URL ?? "http://localhost:8799";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-collection-save-me";
const archive = path.resolve(process.env.DIB_CONTENT_ARCHIVE ?? path.join(
  repositoryRoot,
  "output/official-collection-save-me-fixture/fixture.ipa",
));
const outputDirectory = path.join(repositoryRoot, "output/official-collection-save-me");
assert(fs.existsSync(archive), `missing Official Collection/Save Me fixture archive: ${archive}`);
assert(token.length >= 16, "DIB_TEST_AUTH_KEY must contain at least 16 characters");
fs.mkdirSync(outputDirectory, { recursive: true });

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const logicPackId = readiness.installedLogicPackIds[0];
assert(logicPackId, "game server has no installed logic pack");
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
// This browser contract follows the current client/server wire. It pinned v16 when v16 was current,
// but the v22 client now rejects a v16 session before gameplay and the maintained server advertises
// only v22. Historical v16 reducer and migration coverage remains in officialGame.test.ts and
// fileSlotStore.test.ts; an unlaunchable old-client browser pin does not add compatibility proof.
assert.equal(
  apiSession.pack.simulationVersion,
  "official-game-v22",
  `this scenario needs a dedicated current authority (default ${gameUrl}) installed from the ` +
    "official-collection-save-me fixture; the server at that address advertises " +
    `${apiSession.pack.simulationVersion} for pack ${logicPackId}. ` +
    `installedLogicPackIds=${JSON.stringify(readiness.installedLogicPackIds)}`,
);
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
let projection;
const execute = async (command) => {
  const response = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      commandId: `browser_collection_save_me_${String(++serial).padStart(4, "0")}`,
      expectedRevision: projection?.revision ?? 0,
      ...(projection?.decision?.decisionId === undefined
        ? {}
        : { expectedDecisionId: projection.decision.decisionId }),
      command,
    }),
  });
  if (response.status !== 200) throw new Error(`${command.type} failed: ${await response.text()}`);
  const result = await response.json();
  projection = result.projection;
  return result;
};
const bootstrap = async () => {
  const response = await fetch(`${gameUrl}/api/game/slots/slot-1/bootstrap`, {
    headers: authHeaders,
  });
  if (response.status !== 200) throw new Error(await response.text());
  projection = await response.json();
  return projection;
};
const targetsFor = (choice, decision) => {
  switch (choice.target.kind) {
    case "self": return [decision.actorId];
    case "allEnemies": return [...decision.enemyTargetIds];
    case "allFriends": return [...decision.friendlyTargetIds];
    case "enemies": return decision.enemyTargetIds.slice(0, choice.target.count);
    case "friends": return decision.friendlyTargetIds.slice(0, choice.target.count);
    case "mixed": return [
      ...(choice.target.allEnemies
        ? decision.enemyTargetIds
        : decision.enemyTargetIds.slice(0, choice.target.enemyCount)),
      ...(choice.target.allFriends
        ? decision.friendlyTargetIds
        : decision.friendlyTargetIds.slice(0, choice.target.friendlyCount)),
    ];
    default: throw new Error(`unhandled target shape ${JSON.stringify(choice.target)}`);
  }
};

// Reach Field 1 and settle its one-time Goblin before opening the Collection fixture. This setup
// uses semantic commands only; no player-authored snapshot enters the authority.
await execute({ type: "slot.create", starterElement: "Water" });
await execute({ type: "player.claimDialog", dialogId: "LeslieIntro1" });
await execute({ type: "player.claimTutorialFlag", flag: "flashTownExit" });
await execute({ type: "world.leaveTown" });
await execute({ type: "world.navigate", targetPoiId: "1-1_Turtorial_Hut_1" });
await execute({ type: "world.navigate", targetPoiId: "1-1_Field_1" });
for (let turn = 0; projection.location.kind === "battle" && turn < 100; turn++) {
  const decision = projection.decision;
  assert.equal(decision.type, "battle.playerTurn", "setup battle did not settle at a player turn");
  const choice = decision.choices.find(({ blockedReasonId, target }) =>
    blockedReasonId === undefined && ["allEnemies", "enemies", "mixed"].includes(target.kind));
  assert(choice, `setup battle has no usable enemy ability: ${JSON.stringify(decision.choices)}`);
  await execute({
    type: "battle.chooseAbility",
    battleId: decision.battleId,
    actorId: decision.actorId,
    slot: choice.slot,
    targetIds: targetsFor(choice, decision),
  });
}
assert.equal(projection.location.kind, "world", "setup Goblin battle did not finish");
assert.equal(projection.location.poiId, "1-1_Field_1");

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const commandBodies = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (!request.url().includes("/commands") || request.method() !== "POST") return;
    try { commandBodies.push(request.postDataJSON()?.command); } catch { /* response assertion catches it */ }
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

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms = 25) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitFor = async (predicate, description, frames = 2_000) => {
    for (let index = 0; index < frames; index++) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`);
  };
  const visibleNodeCenter = (wanted) => page.evaluate((label) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node?.label === label && visible(node)) {
        const bounds = node.getBounds();
        const screen = window.__PIXI_APP__.renderer.screen;
        return {
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height / 2,
          screenWidth: screen.width,
          screenHeight: screen.height,
        };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  }, wanted);
  const findLabel = (prefix) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (typeof node?.label === "string" && node.label.startsWith(wanted) && visible(node)) {
        return node.label;
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  }, prefix);
  const clickLabel = async (label) => {
    const center = await visibleNodeCenter(label);
    assert(center, `missing visible Pixi node ${label}`);
    const box = await page.locator("canvas").first().boundingBox();
    assert(box, "Pixi canvas disappeared");
    const point = {
      x: box.x + center.x * box.width / center.screenWidth,
      y: box.y + center.y * box.height / center.screenHeight,
    };
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await advance(16);
    await page.mouse.up();
    await advance(16);
  };
  const clickText = async (text) => {
    const label = await page.evaluate((wanted) => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length) {
        const node = stack.pop();
        if (node?.text === wanted && node.visible && node.renderable) return node.label ?? null;
        stack.push(...(node?.children ?? []));
      }
      return null;
    }, text);
    if (label !== null) return clickLabel(label);
    const point = await page.evaluate((wanted) => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length) {
        const node = stack.pop();
        if (node?.text === wanted && node.visible && node.renderable) {
          const bounds = node.getBounds();
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
        stack.push(...(node?.children ?? []));
      }
      return null;
    }, text);
    assert(point, `missing visible text ${text}`);
    const box = await page.locator("canvas").first().boundingBox();
    assert(box);
    await page.mouse.click(box.x + point.x, box.y + point.y);
  };
  const clickPoi = async (name) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const snapshot = await state();
      const target = snapshot.pois.find((candidate) => candidate.name === name);
      assert(target, `world has no POI ${name}`);
      assert(name === snapshot.currentPoi || snapshot.selectablePois.includes(name),
        `POI ${name} is not selectable from ${snapshot.currentPoi}`);
      const flag = await page.evaluate(({ x, y }) => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length) {
          const node = stack.pop();
          if (node?.children?.length >= 2 && Math.abs(node.position?.x - x) < 0.01 &&
            Math.abs(node.position?.y - y) < 0.01) {
            const bounds = node.children[1]?.getBounds?.();
            if (node.children[1]?.visible && bounds?.width > 0 && bounds?.height > 0) {
              const screen = window.__PIXI_APP__.renderer.screen;
              return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2,
                screenWidth: screen.width, screenHeight: screen.height };
            }
          }
          stack.push(...(node?.children ?? []));
        }
        return null;
      }, target.mapPosition);
      assert(flag, `POI ${name} has no materialized state flag`);
      const box = await page.locator("canvas").first().boundingBox();
      assert(box);
      const point = {
        x: box.x + flag.x * box.width / flag.screenWidth,
        y: box.y + flag.y * box.height / flag.screenHeight,
      };
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await advance(16);
      await page.mouse.up();
      await advance(500);
      const after = await state();
      if (after.walking || after.locked || after.mode !== "world" || after.overlay !== null ||
        (snapshot.currentPoi !== name && after.currentPoi === name)) return;
    }
    throw new Error(`POI ${name} ignored ten pointer bursts`);
  };
  const loadOfficialSlot = async (
    ready = (value) => value.mode === "world" && !value.locked,
    description = "Official world missing",
  ) => {
    await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await page.locator('input[name="asset-archive"]').setInputFiles(archive);
    await page.getByLabel("Online (Beta)", { exact: true }).check();
    await page.getByLabel("Login token").fill(token);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.locator(".content-gate__login-status--success").waitFor({ timeout: 30_000 });
    await page.locator(".content-gate__rights input").check();
    await page.getByRole("button", { name: "Play Online", exact: true }).click();
    await waitFor((value) => value.mode === "start" && value.startup?.phase === "title", "title missing");
    await page.keyboard.press("Enter");
    const select = await waitFor((value) => value.startup?.phase === "save-select", "save selection missing");
    const slot = select.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `Official slot 1 is unavailable: ${JSON.stringify(select.startup)}`);
    const box = await page.locator("canvas").first().boundingBox();
    assert(box);
    const geometry = await stageGeometry(page, box);
    await advance(500);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
    return waitFor(ready, description);
  };

  let snapshot = await loadOfficialSlot();
  assert.equal(snapshot.currentPoi, "1-1_Field_1");
  await clickPoi("1-1_Turtorial_Hut_3");
  snapshot = await waitFor((value) => value.overlay?.kind === "collection", "Collection did not open");
  await waitFor(async (value) => value.overlay?.ownedPresentation?.kind === "intro-chat" &&
    (await visibleNodeCenter("guildQuestChat")) !== null, "Collection intro chat did not mount");
  await advance(550);
  await clickLabel("guildQuestChat");
  snapshot = await waitFor((value) => value.overlay?.ownedPresentation?.kind === "none",
    "Collection intro chat did not dismiss");
  const collector = snapshot.overlay.rows.find((row) => row.goalKey === "Collector");
  assert.deepEqual(
    { percentComplete: collector?.percentComplete, complete: collector?.complete, claimed: collector?.claimed },
    { percentComplete: 100, complete: true, claimed: false },
  );
  const collectionCommandCount = () => commandBodies.filter((command) =>
    command?.type === "collection.claim").length;
  const beforeClaimCommands = collectionCommandCount();
  await clickLabel("collection:Collector");
  snapshot = await waitFor(async (value) =>
    value.overlay?.ownedPresentation?.kind === "committed-loot" &&
      (await findLabel("popupButton:")) !== null,
    "Official Collection claim did not present committed loot");
  assert.equal(collectionCommandCount(), beforeClaimCommands + 1);
  const lootButton = await findLabel("popupButton:");
  assert(lootButton, `Collection loot has no dismissal button: ${JSON.stringify(snapshot.overlay)}`);
  await advance(250);
  await clickLabel(lootButton);
  snapshot = await waitFor((value) => value.overlay?.ownedPresentation?.kind === "none" &&
    value.overlay.rows.some((row) => row.goalKey === "Collector" && row.claimed),
  "Official Collection claim did not return to its durable row");
  assert(snapshot.player.party.some((member) => member.shortType === "Spikey" && member.level === 105),
    "authority-minted Collection monster was not mirrored into the live party");
  assert.equal(snapshot.chrome.heroXp.level, snapshot.player.heroLevel,
    "Collection claim left the world hero-XP model stale");
  const heroXpLabel = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node?.label === "worldHeroXpLevel") return node.text;
      stack.push(...(node?.children ?? []));
    }
    return null;
  });
  assert.equal(heroXpLabel, "Lv 6", "Collection claim left the rendered hero-XP label stale");
  await advance(17);
  await page.screenshot({
    path: path.join(outputDirectory, "01-official-collection-claimed.png"),
    fullPage: true,
    timeout: 120_000,
  });

  // Reload through the real content gate and prove the claim remains one-shot.
  await clickLabel("collection:close");
  await waitFor((value) => value.overlay === null, "Collection did not close before reload");
  await page.reload({ waitUntil: "domcontentloaded" });
  snapshot = await loadOfficialSlot();
  assert.equal(snapshot.currentPoi, "1-1_Turtorial_Hut_3");
  await clickPoi("1-1_Turtorial_Hut_3");
  snapshot = await waitFor((value) => value.overlay?.kind === "collection",
    "reloaded Collection did not open");
  // `Chats.plist` has no `MonsterCollection` record, so its synthesized `alwaysShow` stays 1 and the
  // Old Sage greets the player on every visit — reload or not. This is now an assertion, not a
  // tolerance.
  await waitFor(async (value) => value.overlay?.ownedPresentation?.kind === "intro-chat" &&
    (await visibleNodeCenter("guildQuestChat")) !== null,
  "reloaded Collection intro chat did not replay");
  await advance(550);
  await clickLabel("guildQuestChat");
  snapshot = await waitFor((value) => value.overlay?.ownedPresentation?.kind === "none",
    "reloaded Collection intro chat did not dismiss");
  assert(snapshot.overlay.rows.find((row) => row.goalKey === "Collector")?.claimed,
    "Official Collection claim did not survive reload");
  const beforeRepeatCommands = collectionCommandCount();
  await clickLabel("collection:Collector");
  snapshot = await waitFor((value) => value.overlay?.ownedPresentation?.kind === "repeat",
    "reloaded Collection did not take the repeat branch");
  assert.equal(collectionCommandCount(), beforeRepeatCommands,
    "repeat Collection row submitted a second authority command");
  const repeatButton = await findLabel("popupButton:");
  assert(repeatButton, "Collection repeat has no dismissal button");
  await advance(250);
  await clickLabel(repeatButton);
  await waitFor((value) => value.overlay?.ownedPresentation?.kind === "none", "repeat popup stuck");
  await clickLabel("collection:close");
  await waitFor((value) => value.overlay === null, "Collection did not close after repeat");

  // The fixture reward intentionally raises the source hero gate. Remove it through the semantic
  // party command, then reload so the browser coordinator adopts that committed revision before
  // starting the loss used for Save Me.
  await bootstrap();
  const rewardMonster = projection.player.party.find((member) => member.shortType === "Spikey");
  assert(rewardMonster, "Collection projection omitted its authority-minted reward monster");
  assert(projection.player.heroLevel >= 6, "Collection fixture did not reach Save Me's hero gate");
  await execute({ type: "party.destroyMonster", instanceId: rewardMonster.instanceId });
  assert.equal(projection.player.party.some((member) => member.instanceId === rewardMonster.instanceId), false);
  await page.reload({ waitUntil: "domcontentloaded" });
  snapshot = await loadOfficialSlot();
  if (snapshot.overlay?.kind === "collection") {
    await clickLabel("collection:close");
    snapshot = await waitFor((value) => value.overlay === null, "resumed Collection did not close");
  }
  await clickPoi("1-1_Turtorial_Hut_1");
  await waitFor((value) => value.mode === "world" && !value.locked && !value.walking &&
    value.currentPoi === "1-1_Turtorial_Hut_1", "route did not settle at Tutorial Hut 1");
  await clickPoi("1-1_Field_1");
  await waitFor((value) => value.mode === "world" && !value.locked && !value.walking &&
    value.currentPoi === "1-1_Field_1", "route did not settle at Field 1");
  await clickPoi("1-1_Field_2");
  snapshot = await waitFor((value) => value.mode === "battle", "Field 2 recovery encounter did not start");
  for (let pageIndex = 0; pageIndex < 40; pageIndex++) {
    snapshot = await state();
    if (snapshot.tutorial != null) {
      snapshot = await waitFor((value) => value.tutorial == null || value.tutorial.okReady,
        "Field 2 tutorial did not become dismissible");
      if (snapshot.tutorial != null) {
        await page.keyboard.press("Enter");
        await advance(25);
      }
      continue;
    }
    if (snapshot.activePopup === "encounterChat") {
      await advance(550);
      await clickLabel("guildQuestChat");
      continue;
    }
    break;
  }
  const lostBattle = await bootstrap();
  assert.equal(lostBattle.location.kind, "battle");
  const lostBattleId = lostBattle.battle.battleId;
  const lostEnemies = lostBattle.battle.teams[1].map(({ instanceId, shortType, level, maxHp }) =>
    ({ instanceId, shortType, level, maxHp }));

  for (let turn = 0; projection.decision.type === "battle.playerTurn" && turn < 100; turn++) {
    const decision = projection.decision;
    await execute({
      type: "battle.delay",
      battleId: decision.battleId,
      actorId: decision.actorId,
    });
  }
  assert.equal(projection.decision.type, "battle.defeatRecovery",
    "initial authority battle never reached Save Me defeat");
  // A pending defeat is durable state. Restore it through the same browser boot path a refresh or
  // outage recovery uses; this also regresses terminal official replay mounting.
  snapshot = await loadOfficialSlot(
    (value) => value.presentation?.state === "battleEnded" && value.activePopup === "returnToTown",
    "terminal initial battle did not restore its Save Me popup",
  );
  assert.equal(snapshot.activePopup, "returnToTown", "Official loss never reached its recovery popup");
  assert.deepEqual(snapshot.postBattleButtons.map(({ label }) => label), ["Yes", "No"]);
  const resolveCount = () => commandBodies.filter((command) =>
    command?.type === "battle.resolveDefeat" && command.recovery === "saveMe").length;
  const beforeResolve = resolveCount();
  await clickLabel("popupButton:Yes");
  snapshot = await waitFor((value) => value.mode === "battle" &&
    value.presentation?.state !== "battleEnded" &&
    value.monsters.some(({ team }) => team === 0),
  "Official Save Me did not mount its replacement battle");
  assert.equal(resolveCount(), beforeResolve + 1, "Official Save Me command was not submitted exactly once");
  const saved = await bootstrap();
  assert.equal(saved.player.gold, 0, "Official Save Me did not spend exactly 100 gold");
  assert.equal(saved.location.kind, "battle");
  assert.notEqual(saved.battle.battleId, lostBattleId, "Official Save Me reused the defeated battle id");
  assert.deepEqual(
    saved.battle.teams[1].map(({ instanceId, shortType, level, maxHp }) =>
      ({ instanceId, shortType, level, maxHp })),
    lostEnemies,
    "Official Save Me changed the committed enemy roster",
  );
  assert(saved.player.party.every(({ hp, maxHp }) => hp === maxHp),
    "Official Save Me did not fully heal the durable party");
  assert(snapshot.player.party.every((member) =>
    member.injureTime === undefined && member.healTime === undefined),
  "Official Save Me retained an injury timestamp");
  await advance(17);
  await page.screenshot({
    path: path.join(outputDirectory, "02-official-save-me-restart.png"),
    fullPage: true,
    timeout: 120_000,
  });

  // Lose the restarted encounter again with no gold, take the ordinary return, leave town, and
  // immediately reconstruct the encounter. This is the browser path that previously mixed a
  // locally healed roster with the server's dead-only replay and threw "unknown livingid".
  // Settle the repeated combat mechanically through the same semantic authority commands, then
  // reload the browser onto the committed terminal replay. Replaying another ~20 identical Delay
  // presentations frame-by-frame adds minutes without strengthening the lifecycle assertion: the
  // Save Me scene replacement above already tears down a live result effect. The browser still
  // owns the ordinary-return popup, town transition, departure, and next encounter under test.
  await bootstrap();
  for (let turn = 0; projection.decision.type === "battle.playerTurn" && turn < 100; turn++) {
    const decision = projection.decision;
    await execute({
      type: "battle.delay",
      battleId: decision.battleId,
      actorId: decision.actorId,
    });
  }
  assert.equal(projection.decision.type, "battle.defeatRecovery",
    "replacement authority battle never reached ordinary defeat");
  snapshot = await loadOfficialSlot(
    (value) => value.presentation?.state === "battleEnded" && value.activePopup === "returnToTown",
    "terminal replacement battle did not restore its defeat popup",
  );
  assert.equal(snapshot.activePopup, "returnToTown", "replacement battle never reached ordinary defeat");
  // Once the Save Me tutorial is seen, source keeps offering the choice even below 100 gold; the
  // No branch is the ordinary return under test.
  assert.deepEqual(snapshot.postBattleButtons.map(({ label }) => label), ["Yes", "No"]);
  const beforeOrdinaryReturn = commandBodies.filter((command) =>
    command?.type === "battle.resolveDefeat" && command.recovery === "return").length;
  await clickLabel("popupButton:No");
  snapshot = await waitFor((value) => value.mode === "town" && !value.locked,
    "ordinary Official defeat did not enter town");
  assert.equal(commandBodies.filter((command) =>
    command?.type === "battle.resolveDefeat" && command.recovery === "return").length,
  beforeOrdinaryReturn + 1, "ordinary defeat return was not submitted exactly once");
  const returned = await bootstrap();
  assert.equal(returned.location.kind, "town");
  assert(returned.player.party.every(({ hp, maxHp }) => hp === maxHp),
    "authority retained depleted HP after ordinary defeat return");

  if (snapshot.overlay?.kind === "townEnterChat") {
    await advance(550);
    await clickLabel("guildQuestChat");
    snapshot = await waitFor((value) => value.mode === "town" && value.overlay === null && !value.locked,
      "post-defeat town chat did not dismiss");
  }
  snapshot = await waitFor((value) => value.mode === "town" && value.overlay === null &&
    value.town?.dayNotification?.visible !== true && !value.locked,
  "post-defeat day notification did not release town input");
  const townName = snapshot.town?.name;
  assert(townName, `ordinary return omitted town state: ${JSON.stringify(snapshot)}`);
  await clickLabel(`town:${townName}:exit`);
  snapshot = await waitFor((value) => value.mode === "world" && !value.locked,
    "town departure did not return to the world map");
  const departed = await bootstrap();
  assert.equal(departed.location.kind, "world");
  assert(departed.player.party.every(({ hp, maxHp }) => hp === maxHp),
    "authority lost restored HP while leaving town");

  // Route mechanically, then reconstruct the committed active battle through the browser startup
  // path. This targets the reported failure directly: browser encounter roster vs server replay
  // living ids, without coupling the proof to post-restart map pointer geometry.
  await execute({ type: "world.navigate", targetPoiId: "1-1_Turtorial_Hut_1" });
  await execute({ type: "world.navigate", targetPoiId: "1-1_Field_1" });
  if (projection.location.kind === "world") {
    // Field 1's repeat occurrence is random. Field 2 carries this scenario's fixed encounter, so
    // continue there when the repeat roll legitimately produces no battle.
    await execute({ type: "world.navigate", targetPoiId: "1-1_Field_2" });
  }
  const nextBattle = projection;
  assert.equal(nextBattle.location.kind, "battle");
  snapshot = await loadOfficialSlot(
    (value) => value.mode === "battle" && value.monsters.some(({ team }) => team === 0),
    "next Official encounter failed to construct after ordinary defeat",
  );
  assert(snapshot.monsters.some(({ team }) => team === 0),
    "next encounter mounted without a friendly living roster");
  await advance(17);
  await page.screenshot({
    path: path.join(outputDirectory, "03-official-defeat-town-next-encounter.png"),
    fullPage: true,
    timeout: 120_000,
  });
  assert.deepEqual(errors, [], errors.join("\n"));
  process.stdout.write(`${JSON.stringify({
    simulationVersion: apiSession.pack.simulationVersion,
    collectionClaims: collectionCommandCount(),
    saveMeResolutions: resolveCount(),
    lostBattleId,
    replacementBattleId: saved.battle.battleId,
    finalGold: saved.player.gold,
    ordinaryReturnHealed: returned.player.party.every(({ hp, maxHp }) => hp === maxHp),
    nextBattleId: nextBattle.battle.battleId,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
