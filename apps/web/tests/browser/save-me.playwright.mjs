// Opt-in local Save Me contract. Every route below uses the normal world/town/dungeon UI and a
// caller-owned content archive; automated Chromium is always muted.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const requestedCase = process.env.DIB_SAVE_ME_CASE;
const knownCases = new Set([
  "decline", "exact-cost", "store-reentry", "tournament", "dungeon", "arena", "volcano",
]);
if (requestedCase !== undefined && !knownCases.has(requestedCase)) {
  throw new Error(`unknown DIB_SAVE_ME_CASE ${requestedCase}`);
}
const shouldRun = (name) => requestedCase === undefined || requestedCase === name;
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

async function captureCanvas(page, fileName) {
  const dataUrl = await page.locator("canvas").evaluate((canvas) => canvas.toDataURL("image/png"));
  mkdirSync("output", { recursive: true });
  writeFileSync(`output/${fileName}`, Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"));
}

const commonTutorials = [
  "FirstShop",
  "FirstCharacterDisplay",
  "Tutorial0",
  "Tutorial1",
  "TournamentTutorial",
];

async function openLocalFixture({
  gold,
  tutorialSeen = false,
  route = null,
  startPoi = "1-1_Field_1",
  partyLevel = 1,
  finishedQuestCount = 0,
  captureCards = { 1: 0, 2: 0, 3: 0 },
}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ gold, tutorialSeen, route, startPoi, partyLevel, finishedQuestCount, captureCards, commonTutorials }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 17;
    window.__DIB_TEST_WORLD_NAME__ = "World_1-1";
    window.__DIB_TEST_POI_NAME__ = startPoi;
    window.__DIB_TEST_BATTLE_SEED__ = 5;
    window.__DIB_TEST_DUNGEON_SEED__ = 2; // First neighboring encounter has two enemies.
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = finishedQuestCount;
    if (finishedQuestCount === 0) {
      window.__DIB_TEST_GUILD_QUEST_NAMES__ = ["LiberateTownsQuest"];
    }
    if (route !== null) window.__DIB_TEST_DUNGEON_ROUTE__ = route;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [partyLevel, partyLevel],
      members: [{ shortType: "FireCub", level: partyLevel, currentHp: 1 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: Math.max(6, partyLevel),
      monsterPartyLevels: [partyLevel],
      silver: 2_000,
      gold,
      captureCards,
      highestCapturedLevels: { FireCub: partyLevel },
      licenseType: "Apprentice",
      tutorialFlags: tutorialSeen ? [...commonTutorials, "SaveMe"] : commonTutorials,
    };
  }, { gold, tutorialSeen, route, startPoi, partyLevel, finishedQuestCount, captureCards, commonTutorials });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((delta) => window.advanceTime(delta), ms);
    await page.waitForTimeout(1);
  };
  const waitFor = async (predicate, description, iterations = 600) => {
    for (let index = 0; index < iterations; index++) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance(100);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    throw new Error(`${description}; errors=${errors.join(" | ") || "none"}; state=${JSON.stringify(await state())}`);
  };
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box, "missing Pixi canvas");
  const geometry = await stageGeometry(page, box);
  const nodeCenter = (label, userObject) => page.evaluate(({ label, userObject }) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    let found = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (
        node?.label === label &&
        (userObject === undefined || node.userObject === userObject) &&
        visible(node)
      ) {
        const bounds = node.getBounds();
        found = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      if (node?.children) stack.push(...node.children);
    }
    return found;
  }, { label, userObject });
  const clickCanvasGlobal = async (point, description) => {
    // Pixi getBounds() above returns canvas-global coordinates after FixedStage's scale and
    // letterbox transforms. Playwright consumes viewport/CSS coordinates, so add only the canvas
    // element's viewport origin; applying stageGeometry or another scale would double-transform.
    const viewport = page.viewportSize();
    assert(viewport, `${description}: viewport unavailable`);
    assert(Number.isFinite(point.x) && Number.isFinite(point.y), `${description}: non-finite canvas-global point`);
    const cssPoint = { x: box.x + point.x, y: box.y + point.y };
    assert(cssPoint.x >= 0 && cssPoint.x <= viewport.width, `${description}: CSS x outside viewport`);
    assert(cssPoint.y >= 0 && cssPoint.y <= viewport.height, `${description}: CSS y outside viewport`);
    await page.mouse.click(cssPoint.x, cssPoint.y);
  };
  const clickLabel = async (label, userObject) => {
    const center = await nodeCenter(label, userObject);
    assert(center, `missing visible Pixi node ${label}:${String(userObject ?? "")}`);
    await clickCanvasGlobal(center, `Pixi node ${label}:${String(userObject ?? "")}`);
  };
  const pressButtonLabel = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) {
        const bounds = node.getLocalBounds();
        const local = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const event = {
          pointerId: 920,
          global: node.toGlobal(local),
          getLocalPosition: () => local,
          stopPropagation() {},
        };
        node.emit("pointerdown", event);
        node.emit("pointerup", event);
        return;
      }
      if (node?.children) stack.push(...node.children);
    }
    throw new Error(`missing Pixi button ${wanted}`);
  }, label);
  // Row taps are routed by the menu container that owns them (rows are `eventMode: "none"`),
  // so emitting on the row node itself reaches no listener at all.
  const tapLabel = (label) => tapPixiLabel(page, label);
  const clickText = async (text) => {
    const point = await page.evaluate((wanted) => {
      const stack = [window.__PIXI_APP__.stage];
      let found = null;
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.text === wanted && node.visible && node.renderable) {
          const bounds = node.getBounds();
          found = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
        if (node?.children) stack.push(...node.children);
      }
      return found;
    }, text);
    assert(point, `missing visible text ${text}`);
    await clickCanvasGlobal(point, `Pixi text ${text}`);
  };
  const clickPostBattle = async (label) => {
    const snapshot = await state();
    const button = snapshot.postBattleButtons.find((candidate) => candidate.label === label);
    assert(button, `missing post-battle ${label}: ${JSON.stringify(snapshot.postBattleButtons)}`);
    // postBattleButtons exposes authored battle-scene points, not Pixi getBounds() output, so
    // this input genuinely requires the stage-point -> viewport/CSS transform.
    const css = geometry.toCss(button.point);
    await page.mouse.click(css.x, css.y);
  };

  await waitFor((snapshot) => snapshot.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) =>
      ["world", "town", "dungeon"].includes(value.mode) ||
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon",
    "local session did not reach gameplay or new-game presentation",
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) =>
        ["world", "town", "dungeon"].includes(value.mode) ||
        value.startup?.phase === "pick-dragon",
      "new-game plot did not reach starter selection",
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") {
    const starter = snapshot.startup.intro?.choices?.[0];
    assert(starter?.shortType, `starter selection missing from startup state: ${JSON.stringify(snapshot.startup)}`);
    await page.keyboard.press("1");
    await waitFor(
      (value) => ["world", "town", "dungeon"].includes(value.mode),
      "starter selection did not reach world/town/dungeon",
    );
  }
  return { page, errors, state, advance, waitFor, nodeCenter, clickLabel, pressButtonLabel, tapLabel, clickText, clickPostBattle };
}

async function dismissBattleChat(ctx) {
  for (let pages = 0; pages < 20; pages++) {
    const snapshot = await ctx.state();
    if (snapshot.mode !== "battle" || snapshot.activePopup !== "encounterChat") return;
    await ctx.advance(550);
    await ctx.clickLabel("guildQuestChat");
    await ctx.advance(25);
  }
  throw new Error("encounter chat did not drain");
}

async function driveToDefeat(ctx) {
  let confirmedDelay = false;
  // Keep deterministic input in short bursts. A large one-shot advance can spend a long time in
  // chained source-timed presentation work and hide which player decision still needs input.
  for (let index = 0; index < 160; index++) {
    const snapshot = await ctx.state();
    if (index % 10 === 0) {
      console.log(
        `save-me: defeat step ${index + 1}/160 state=${snapshot.presentation?.state ?? "none"} ` +
          `popup=${snapshot.activePopup ?? "none"} panel=${String(snapshot.panelVisible)}`,
      );
    }
    if (snapshot.mode === "battle" && snapshot.presentation?.state === "battleEnded") {
      if (snapshot.activePopup === "returnToTown") return snapshot;
    }
    if (snapshot.activePopup === "encounterChat") {
      await ctx.advance(550);
      await ctx.clickLabel("guildQuestChat");
    } else if (snapshot.activePopup === "confirmSkip") {
      await ctx.clickText("Yes");
      confirmedDelay = true;
    } else if (
      snapshot.presentation?.state === "awaitingPlayerChoice" &&
      snapshot.panelVisible &&
      !snapshot.turnOrderAnimating
    ) {
      if ((snapshot.capture?.pendingCapturedIds?.length ?? 0) > 0) {
        await ctx.tapLabel("secondary:delay");
      } else {
        await ctx.clickLabel("secondary:delay");
      }
    } else if (snapshot.statusText?.visible) {
      await ctx.page.keyboard.press("Enter");
    }
    await ctx.advance(1_000);
  }
  throw new Error(`battle did not reach defeat; confirmedDelay=${confirmedDelay}; state=${JSON.stringify(await ctx.state())}`);
}

function assertOffer(snapshot, label) {
  assert.equal(snapshot.activePopup, "returnToTown", `${label}: loss popup order`);
  assert.deepEqual(snapshot.postBattleButtons.map((button) => button.label), ["Yes", "No"], `${label}: Save Me choice`);
  assert(snapshot.player.tutorialFlags.includes("SaveMe"), `${label}: tutorial flag claimed before presentation`);
}

function assertBlocked(snapshot, label) {
  assert.equal(snapshot.activePopup, "returnToTown", `${label}: loss popup`);
  assert.deepEqual(snapshot.postBattleButtons.map((button) => button.label), ["Ok"], `${label}: Save Me must be blocked`);
  assert.equal(snapshot.defeatRecovery.storeOpenCount, 0, `${label}: Store must not open`);
}

async function enterWorldFixedEncounter(ctx) {
  const world = await ctx.waitFor((snapshot) => snapshot.mode === "world", "world did not open");
  const current = world.pois.find((poi) => poi.name === world.currentPoi);
  assert(current, "current world POI missing");
  const canvas = ctx.page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  // Locate the actual materialized state sprite beneath the POI container. Its getBounds() output
  // is already canvas-global, so this avoids guessing whether a rendered diagnostic point is in
  // authored, scene, or stage coordinates while still exercising the real pointer path.
  const flagCenter = await ctx.page.evaluate(({ x, y }) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (
        node?.children?.length >= 2 &&
        Math.abs(node.position?.x - x) < 0.01 &&
        Math.abs(node.position?.y - y) < 0.01
      ) {
        const stateSprite = node.children[1];
        const bounds = stateSprite?.getBounds?.();
        if (stateSprite?.visible && bounds?.width > 0 && bounds?.height > 0) {
          return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        }
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, current.mapPosition);
  assert(flagCenter, `current POI ${current.name} has no materialized state flag`);
  const css = { x: box.x + flagCenter.x, y: box.y + flagCenter.y };
  await ctx.page.mouse.move(css.x, css.y);
  await ctx.page.mouse.down();
  await ctx.advance(16);
  await ctx.page.mouse.up();
  await ctx.advance(16);
  await ctx.waitFor((snapshot) => snapshot.mode === "battle", "fixed world encounter did not open");
  await dismissBattleChat(ctx);
  return current.name;
}

async function enterArenaSurface(ctx, action) {
  let snapshot = await ctx.waitFor((value) => value.mode === "town", "Arena fixture town did not open");
  await ctx.advance(1_000);
  snapshot = await ctx.state();
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await ctx.advance(550);
    await ctx.clickLabel("guildQuestChat");
    snapshot = await ctx.state();
  }
  assert.equal(snapshot.overlay, null, "town entry presentation remained above the Arena fixture");
  await ctx.advance(12_000);
  await ctx.page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await ctx.waitFor(async () => await ctx.page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "guildQuestChatFinish") return true;
      if (node?.children) stack.push(...node.children);
    }
    return false;
  }), "Arena greeting did not open");
  await ctx.advance(550);
  await ctx.clickLabel("guildQuestChat");
  await ctx.waitFor((snapshot) => snapshot.overlay?.open === true, "Arena menu did not open");
  if (action === "arena") {
    await ctx.tapLabel("arena:battle");
  } else {
    await ctx.tapLabel("arena:tournament");
    await ctx.waitFor((snapshot) => snapshot.overlay?.kind === "tournament", "Tournament did not open");
    if (action === "tournament") await ctx.tapLabel("tournament:primary");
  }
  if (action === "tournament-menu") return;
  await ctx.waitFor((snapshot) => snapshot.mode === "battle", `${action} battle did not open`);
  await dismissBattleChat(ctx);
}

async function enterDungeonEncounter(ctx) {
  const settled = await ctx.waitFor(
    (snapshot) => snapshot.mode === "battle" || (snapshot.mode === "dungeon" && !snapshot.locked),
    "dungeon did not settle",
  );
  // High-level Volcano enemies can resolve the entry-room encounter before the harness observes
  // the unlocked dungeon frame. That is still the normal room-entry path, not a battle shortcut.
  if (settled.mode === "battle") {
    await dismissBattleChat(ctx);
    return;
  }
  for (let moves = 0; moves < 80; moves++) {
    await ctx.advance(550);
    const snapshot = await ctx.state();
    if (snapshot.floorDetectionChat !== undefined) {
      await ctx.page.keyboard.press("Enter");
      continue;
    }
    if ((snapshot.popups?.scene?.stack ?? []).some(
      (popup) => popup.contentLabel === "catchQuestDisplay" && popup.visible,
    )) {
      await ctx.advance(200);
      await ctx.tapLabel("catchQuestClose");
      await ctx.waitFor(
        (value) => !(value.popups?.scene?.stack ?? []).some(
          (popup) => popup.contentLabel === "catchQuestDisplay" && popup.visible,
        ),
        "dungeon catch-quest display did not close",
      );
      continue;
    }
    const room = snapshot.rooms.find((candidate) => candidate.id === snapshot.currentRoomId);
    assert(room, "current dungeon room missing");
    const linked = room.links
      .map((link) => snapshot.rooms.find((candidate) => candidate.id === link.targetRoomId))
      .filter((candidate) => candidate && snapshot.renderedRoomIds.includes(candidate.id));
    const encounter = linked.find((candidate) => candidate.encounter !== undefined);
    const next = encounter ?? linked.find((candidate) => !candidate.explored) ?? linked[0];
    assert(next, `no rendered route from ${room.id}`);
    const link = room.links.find((candidate) => candidate.targetRoomId === next.id);
    assert(link, `selected room ${next.id} is not linked from ${room.id}`);
    const movementKey = link.offset.x === -1
      ? "a"
      : link.offset.x === room.width
        ? "d"
        : link.offset.y === -1
          ? "s"
          : link.offset.y === room.height
            ? "w"
            : undefined;
    assert(movementKey, `selected dungeon link is not cardinal: ${JSON.stringify(link)}`);
    // Prefer the materialized RoomNode itself. A room may share a cardinal direction with another
    // linked room (North Cave's entry room has multiple west doors), so a direction-only key is
    // ambiguous even though the exact room is visible and clickable. Fall back to the app's
    // direct-link keyboard seam only when a tall authored layout places that room off-canvas.
    const roomCenter = await ctx.nodeCenter(`dungeonRoom:${next.id}`);
    const canvasBox = await ctx.page.locator("canvas").first().boundingBox();
    const viewport = ctx.page.viewportSize();
    assert(canvasBox && viewport, "dungeon room input geometry unavailable");
    const roomCss = roomCenter === null ? null : {
      x: canvasBox.x + roomCenter.x,
      y: canvasBox.y + roomCenter.y,
    };
    if (
      roomCss !== null &&
      roomCss.x >= 0 && roomCss.x <= viewport.width &&
      roomCss.y >= 0 && roomCss.y <= viewport.height
    ) {
      await ctx.page.mouse.click(roomCss.x, roomCss.y);
    } else {
      await ctx.page.keyboard.press(movementKey);
    }
    const result = await ctx.waitFor(
      (candidate) => candidate.mode === "battle" || (candidate.mode === "dungeon" &&
        candidate.currentRoomId === next.id && !candidate.locked),
      `dungeon move to ${next.id} did not settle`,
    );
    if (result.mode === "battle") {
      await dismissBattleChat(ctx);
      return room.id;
    }
  }
  throw new Error(`dungeon fixture did not find an encounter through rendered rooms; state=${JSON.stringify(await ctx.state())}`);
}

async function captureOneBeforeLoss(ctx) {
  const ready = await ctx.waitFor(
    (snapshot) => snapshot.mode === "battle" && snapshot.panelVisible && snapshot.capture?.adjacentCardTargetIds?.length > 0,
    "ordinary dungeon did not expose a capture turn",
  );
  assert(ready.monsters.filter((monster) => monster.team === 1).length >= 2, "capture-forfeit fixture needs a surviving enemy");
  const targetId = ready.capture.adjacentCardTargetIds[0];
  await ctx.clickLabel("captureCardHit", targetId);
  await ctx.waitFor((snapshot) => snapshot.activePopup === "captureChooser", "capture chooser did not open");
  await ctx.waitFor(
    async () => await ctx.nodeCenter("captureCardChoice3") !== null,
    "gold capture-card choice did not finish mounting",
  );
  await ctx.pressButtonLabel("captureCardChoice3");
  const captured = await ctx.waitFor(
    (snapshot) => snapshot.capture?.pendingCapturedIds?.includes(targetId),
    "gold card did not produce the deterministic capture fixture",
  );
  await ctx.waitFor(
    async (snapshot) =>
      snapshot.capture?.pendingCapturedIds?.includes(targetId) &&
      !snapshot.monsters.some((monster) => monster.id === targetId) &&
      await ctx.nodeCenter("captureMonsterCard") === null,
    "capture result animation did not settle",
  );
  // The public battle diagnostic intentionally exposes logical target IDs, not species metadata.
  // Prove the loss-only scratch boundary by comparing the complete durable collection snapshot.
  return { targetId, collectionBefore: { ...captured.player.highestCapturedLevels } };
}

async function closeAndAssertClean(ctx, label) {
  assert.deepEqual(ctx.errors, [], `${label}: ${ctx.errors.join(" | ")}`);
  await ctx.page.close();
}

try {
  // Decline: choice appears after tutorial claim; No follows the normal town-loss route without debit.
  if (shouldRun("decline")) {
    console.log("save-me: world decline");
    const ctx = await openLocalFixture({ gold: 100 });
    await enterWorldFixedEncounter(ctx);
    let snapshot = await driveToDefeat(ctx);
    assertOffer(snapshot, "world decline");
    await ctx.clickPostBattle("No");
    snapshot = await ctx.waitFor((value) => value.mode === "town", "decline did not return to town");
    assert.equal(snapshot.player.gold, 100);
    assert.equal(snapshot.defeatRecovery.storeOpenCount, 0);
    await closeAndAssertClean(ctx, "world decline");
  }

  // Exact 100-gold settlement: the source WorldEncounter callback tears down combat and rebuilds
  // the world at the same POI without immediately remounting the fixed encounter.
  if (shouldRun("exact-cost")) {
    console.log("save-me: world exact-cost recovery");
    const ctx = await openLocalFixture({ gold: 100, tutorialSeen: true });
    console.log("save-me: exact-cost fixture ready");
    const originPoi = await enterWorldFixedEncounter(ctx);
    console.log("save-me: exact-cost battle entered");
    let snapshot = await driveToDefeat(ctx);
    console.log("save-me: exact-cost defeat reached");
    assertOffer(snapshot, "world success");
    await ctx.tapLabel("popupButton:Yes");
    snapshot = await ctx.waitFor(
      (value) => value.mode === "world" && value.currentPoi === originPoi,
      "Save Me did not return to the source world POI",
    );
    console.log("save-me: exact-cost world return observed");
    assert.equal(snapshot.player.gold, 0);
    assert(snapshot.player.party.every((member) => member.currentHp > 0), "Save Me left a defeated party member at zero HP");
    assert(snapshot.player.party.every((member) => member.injureTime === undefined && member.healTime === undefined), "Save Me did not clear injury state");
    assert.deepEqual(snapshot.player.highestCapturedLevels, { FireCub: 1 });
    await closeAndAssertClean(ctx, "world success");
  }



  if (shouldRun("store-reentry")) {
    console.log("save-me: world insufficient-funds Store re-entry");
    const ctx = await openLocalFixture({ gold: 99, tutorialSeen: true });
    await enterWorldFixedEncounter(ctx);
    let snapshot = await driveToDefeat(ctx);
    assertOffer(snapshot, "world insufficient initial");
    await ctx.clickPostBattle("Yes");
    snapshot = await ctx.waitFor(
      (value) => value.activePopup === "returnToTown" && value.defeatRecovery.store?.category === 3,
      "NotEnough did not stack over Store category 3",
    );
    assert.deepEqual(snapshot.postBattleButtons.map((button) => button.label), ["Ok"]);
    assert.equal(snapshot.defeatRecovery.storeOpenCount, 1);
    assert.equal(snapshot.defeatRecovery.storeCloseCount, 0);
    assert.equal(snapshot.player.gold, 99);
    await ctx.clickPostBattle("Ok");
    await ctx.clickLabel("store:close");
    snapshot = await ctx.waitFor(
      (value) => value.postBattleButtons?.map((button) => button.label).join(",") === "Yes,No",
      "Store close did not re-present Save Me",
    );
    assertOffer(snapshot, "world insufficient re-entry");
    assert.equal(snapshot.defeatRecovery.storeOpenCount, 1);
    assert.equal(snapshot.defeatRecovery.storeCloseCount, 1);
    assert.equal(snapshot.defeatRecovery.store, null);
    assert.equal(snapshot.player.gold, 99);
    await closeAndAssertClean(ctx, "world insufficient");
  }

  // Tournament follows source useSaveMe: recovery into combatRetreatFinished: town return. It
  // preserves the bracket/timestamp, shows TournamentLost's missing-key fallback, and keeps the
  // existing 24-hour attempt gate instead of mounting a replacement battle.
  if (shouldRun("tournament")) {
    console.log("save-me: Tournament");
    const ctx = await openLocalFixture({
      gold: 100,
      tutorialSeen: true,
      startPoi: "First_City",
      partyLevel: 10,
      finishedQuestCount: 15,
    });
    const tournamentAttemptStartedAt = Date.now();
    await enterArenaSurface(ctx, "tournament");
    let snapshot = await driveToDefeat(ctx);
    assertOffer(snapshot, "local Tournament");
    const tournamentBefore = structuredClone(snapshot.player.tournament);
    await ctx.tapLabel("popupButton:Yes");
    await ctx.waitFor(
      async () => await ctx.nodeCenter("guildQuestChat") !== null,
      "Tournament Save Me did not mount TournamentLost chat",
    );
    const lostChat = await ctx.page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "guildQuestChatText") {
          const textNodes = [node];
          let text = "";
          while (textNodes.length > 0) {
            const textNode = textNodes.pop();
            if (typeof textNode?.text === "string") text = textNode.text + text;
            if (textNode?.children) textNodes.push(...textNode.children);
          }
          return text;
        }
        if (node?.children) stack.push(...node.children);
      }
      return null;
    });
    assert.equal(lostChat, "TournamentLostChatKey");
    snapshot = await ctx.state();
    assert(snapshot.monsters.every((member) => member.visible === false),
      "Tournament Save Me left combat monsters visible behind TournamentLost");
    await ctx.advance(1000 / 60);
    await ctx.page.waitForTimeout(50);
    await captureCanvas(ctx.page, "save-me-tournament-chat.png");
    await ctx.advance(550);
    await ctx.clickLabel("guildQuestChat");
    snapshot = await ctx.waitFor(
      (value) => value.mode === "town" && value.locked === false && value.town?.buildings?.length > 0,
      "Tournament Save Me did not finish the town reveal",
    );
    assert.equal(snapshot.player.gold, 0, "Tournament Save Me did not spend exactly 100 gold");
    assert(snapshot.player.party.every((member) =>
      member.currentHp > 1 && member.injureTime === undefined && member.healTime === undefined),
    "Tournament Save Me did not fully restore and clear injuries");
    assert.deepEqual(snapshot.player.tournament, tournamentBefore, "Tournament Save Me changed bracket or timeLast");
    await ctx.advance(1000 / 60);
    await ctx.page.waitForTimeout(50);
    await captureCanvas(ctx.page, "save-me-tournament-town.png");

    await enterArenaSurface(ctx, "tournament-menu");
    snapshot = await ctx.state();
    assert.equal(snapshot.overlay?.kind, "tournament");
    const elapsedAttemptSeconds = (Date.now() - tournamentAttemptStartedAt) / 1000;
    assert(
      snapshot.overlay.timeToNext > 86_400 - elapsedAttemptSeconds - 5 &&
        snapshot.overlay.timeToNext <= 86_400,
      `Tournament Save Me lost its 24-hour gate: ${snapshot.overlay.timeToNext}`);
    await closeAndAssertClean(ctx, "local Tournament");
  }

  // Ordinary dungeon: capture remains battle scratch, surviving enemies are settled, and Save Me
  // returns to the immediately previous room without an active fight.
  if (shouldRun("dungeon")) {
    console.log("save-me: ordinary dungeon");
    const ctx = await openLocalFixture({
      gold: 100,
      tutorialSeen: true,
      route: { typeName: "Cave", sourceFile: "Dungeon_1.plist", floor: 1 },
      // Keep the capture target deterministic; currentHp remains 1 in openLocalFixture so the
      // surviving enemy still reaches the post-capture loss promptly once the result popup closes.
      partyLevel: 150,
      captureCards: { 1: 0, 2: 0, 3: 1 },
    });
    const retreatRoomId = await enterDungeonEncounter(ctx);
    console.log("save-me: ordinary dungeon encounter entered");
    const capture = await captureOneBeforeLoss(ctx);
    console.log("save-me: ordinary dungeon capture staged and resolution settled");
    let snapshot = await driveToDefeat(ctx);
    console.log("save-me: ordinary dungeon defeat reached");
    assertOffer(snapshot, "ordinary dungeon");
    assert(snapshot.capture.pendingCapturedIds.includes(capture.targetId));
    assert.deepEqual(snapshot.player.highestCapturedLevels, capture.collectionBefore, "loss banked a capture");
    if (await ctx.page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "popupButton:Close") return true;
        if (node?.children) stack.push(...node.children);
      }
      return false;
    })) {
      // `activePopup` reflects the already-mounted loss choice while showLostCaptures is still in
      // its independent 0.2s pop-in. Wait until the top card has an invertible scale before the
      // owner-aware helper maps Close into its parent row.
      await ctx.advance(200);
      await ctx.tapLabel("popupButton:Close");
    }
    await ctx.advance(25);
    const popupStacks = await ctx.page.evaluate(() => {
      const stack = [window.__PIXI_APP__.stage];
      const hosts = [];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === "notificationPopupHost") {
          hosts.push({
            parentLabel: node.parent?.label ?? null,
            popups: node.children.map((popup) => ({
              visible: popup.visible,
              destroyed: popup.destroyed,
              debugState: popup.debugState ?? null,
            })),
          });
        }
        if (node?.children) stack.push(...node.children);
      }
      return hosts;
    });
    assert(
      await ctx.nodeCenter("popupButton:Yes") !== null,
      `Save Me choice did not reappear after Close: ${JSON.stringify(popupStacks)}`,
    );
    await ctx.tapLabel("popupButton:Yes");
    snapshot = await ctx.waitFor(
      (value) =>
        value.mode === "dungeon" &&
        value.currentRoomId === retreatRoomId &&
        value.player?.gold === 0,
      "Save Me did not return to the immediately previous dungeon room",
    );
    assert.equal(
      snapshot.player.gold,
      0,
      "dungeon Save Me did not debit the prospective terminal aggregate",
    );
    assert(snapshot.player.party.every((member) => member.currentHp > 0), "dungeon Save Me left a defeated party member at zero HP");
    assert.deepEqual(snapshot.player.highestCapturedLevels, capture.collectionBefore, "forfeited capture became durable");
    await closeAndAssertClean(ctx, "ordinary dungeon");
  }

  // Arena and Volcano keep their source block and never mount Store.
  if (shouldRun("arena")) {
    console.log("save-me: Arena");
    const ctx = await openLocalFixture({
      gold: 100,
      tutorialSeen: true,
      startPoi: "First_City",
      partyLevel: 10,
      finishedQuestCount: 15,
    });
    await enterArenaSurface(ctx, "arena");
    const snapshot = await driveToDefeat(ctx);
    assertBlocked(snapshot, "Arena");
    await closeAndAssertClean(ctx, "Arena");
  }
  if (shouldRun("volcano")) {
    console.log("save-me: Volcano");
    const ctx = await openLocalFixture({
      gold: 100,
      tutorialSeen: true,
      // Shipped Dungeon_15 is the Volcano *instance* under the Cave presentation definition.
      route: { typeName: "Cave", sourceFile: "Dungeon_15.plist", floor: 1 },
    });
    if ((await ctx.state()).mode !== "battle") await enterDungeonEncounter(ctx);
    const snapshot = await driveToDefeat(ctx);
    assertBlocked(snapshot, "Volcano");
    await closeAndAssertClean(ctx, "Volcano");
  }

  console.log(requestedCase === undefined
    ? "save-me: PASS (decline, 100-gold recovery, 99-gold Store re-entry, Tournament, dungeon, Arena, Volcano)"
    : `save-me: PASS (${requestedCase})`);
} finally {
  await browser.close();
}
