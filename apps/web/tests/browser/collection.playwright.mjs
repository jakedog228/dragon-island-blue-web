// Opt-in local Collection contract. The operator supplies a compatible archive and authored
// world/POI fixture values below. This uses the normal archive import, world navigation, POI, and
// Pixi presentation seams; it never injects a Collection catalog or production route. Automated
// Chromium is always muted.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const worldName = requiredEnv("DIB_COLLECTION_WORLD");
const collectionPoi = requiredEnv("DIB_COLLECTION_POI");
const startPoi = requiredEnv("DIB_COLLECTION_START_POI");
const completeGoalKey = requiredEnv("DIB_COLLECTION_COMPLETE_KEY");
const incompleteGoalKey = requiredEnv("DIB_COLLECTION_INCOMPLETE_KEY");
const partyShortType = requiredEnv("DIB_COLLECTION_PARTY_SHORT_TYPE");
const capturedLevels = parseObjectEnv("DIB_COLLECTION_CAPTURED_LEVELS");
const expectedRows = parseRowsEnv();
const requestedDisplayMode = process.env.DIB_COLLECTION_DISPLAY_MODE;
assert(
  requestedDisplayMode === undefined || requestedDisplayMode === "iphone" || requestedDisplayMode === "ipad",
  `DIB_COLLECTION_DISPLAY_MODE must be iphone or ipad, got ${String(requestedDisplayMode)}`,
);

assert(
  expectedRows.some((row) => row.key === completeGoalKey),
  "DIB_COLLECTION_COMPLETE_KEY is missing from DIB_COLLECTION_EXPECTED_ROWS",
);
assert(
  expectedRows.some((row) => row.key === incompleteGoalKey),
  "DIB_COLLECTION_INCOMPLETE_KEY is missing from DIB_COLLECTION_EXPECTED_ROWS",
);

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  for (const displayMode of requestedDisplayMode === undefined
    ? ["iphone", "ipad"]
    : [requestedDisplayMode]) {
    await runMode(displayMode, displayMode === "iphone");
  }
} finally {
  await browser.close();
}

async function runMode(displayMode, exerciseClaim) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.addInitScript(({ displayMode, worldName, startPoi, partyShortType, capturedLevels }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 17;
    window.__DIB_TEST_WORLD_NAME__ = worldName;
    window.__DIB_TEST_POI_NAME__ = startPoi;
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 1,
      battingOrderSize: 1,
      levelRange: [1, 1],
      members: [{ shortType: partyShortType, level: 1, currentHp: 1 }],
    };
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 6,
      monsterPartyLevels: [1],
      silver: 2_000,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: capturedLevels,
      licenseType: "Apprentice",
      tutorialFlags: [],
    };
  }, { displayMode, worldName, startPoi, partyShortType, capturedLevels });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (milliseconds = 25) => {
    await page.evaluate((delta) => window.advanceTime?.(delta), milliseconds);
    await page.waitForTimeout(1);
  };
  const waitFor = async (predicate, description, iterations = 600) => {
    for (let index = 0; index < iterations; index++) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance();
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}`);
  };
  const clickLabel = async (label) => {
    const center = await page.evaluate((wanted) => {
      const visible = (node) => {
        for (let current = node; current; current = current.parent) {
          if (!current.visible || !current.renderable) return false;
        }
        return true;
      };
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (node?.label === wanted && visible(node)) {
          const bounds = node.getBounds();
          const screen = window.__PIXI_APP__.renderer.screen;
          return {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
            screenWidth: screen.width,
            screenHeight: screen.height,
          };
        }
        if (node?.children) stack.push(...node.children);
      }
      return null;
    }, label);
    assert(center, `missing visible Pixi node ${label}`);
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
  const findLabel = async (prefix) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (typeof node?.label === "string" && node.label.startsWith(wanted) && visible(node)) {
        return node.label;
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, prefix);
  const dismissTopPopup = async (snapshot) => {
    const stack = snapshot.overlay?.popupHost?.stack ?? [];
    const top = stack.at(-1);
    assert(top, "expected a Collection child popup");
    if (top.buttons.length > 0) {
      await clickLabel(`popupButton:${top.buttons[0]}`);
      return;
    }
    const button = await findLabel("popupButton:");
    assert(button, "expected a labeled Collection reward button");
    await clickLabel(button);
  };
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box, `${displayMode}: missing Pixi canvas`);
  const geometry = await stageGeometry(page, box);

  let snapshot = await waitFor(
    (value) => value.startup?.phase === "title",
    `${displayMode}: title did not become interactive`,
  );
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) =>
      (value.mode === "world" && value.locked === false) ||
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon",
    `${displayMode}: local world or new-game presentation did not open`,
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) =>
        (value.mode === "world" && value.locked === false) ||
        value.startup?.phase === "pick-dragon",
      `${displayMode}: new-game plot did not reach starter selection`,
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") {
    const starter = snapshot.startup.intro?.choices?.[0];
    assert(starter?.shortType, `${displayMode}: starter selection is missing its first choice`);
    await page.keyboard.press("1");
    snapshot = await waitFor(
      (value) => value.mode === "world" && value.locked === false,
      `${displayMode}: starter selection did not open the local world`,
    );
  }
  assert.equal(snapshot.displayMode, displayMode);
  console.log(`collection: ${displayMode} world ready`);
  const fatalHeading = page.getByRole("heading", { name: "Local content cannot start" });
  if (await fatalHeading.isVisible()) {
    const detail = await page.locator("details pre").textContent();
    throw new Error(`${displayMode}: world boot became fatal: ${detail?.trim() ?? "unknown error"}`);
  }
  if (process.env.DIB_COLLECTION_DEBUG_SCREENSHOT === "1") {
    await page.screenshot({ path: `output/collection-${displayMode}-world.png` });
  }
  assert.deepEqual(snapshot.screenPt, {
    w: snapshot.stagePx.w / 2,
    h: snapshot.stagePx.h / 2,
  }, `${displayMode}: stage geometry is not point-derived`);

  const clickPoi = async (name) => {
    const before = await state();
    const target = before.pois.find((candidate) => candidate.name === name);
    assert(target, `${displayMode}: cannot click absent POI ${name}`);
    assert(
      name === before.currentPoi || before.selectablePois.includes(name),
      `${displayMode}: POI ${name} is not selectable through the normal world route`,
    );
    const flag = await page.evaluate(({ x, y }) => {
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
            const screen = window.__PIXI_APP__.renderer.screen;
            return {
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height / 2,
              screenWidth: screen.width,
              screenHeight: screen.height,
            };
          }
        }
        if (node?.children) stack.push(...node.children);
      }
      return null;
    }, target.mapPosition);
    assert(flag, `${displayMode}: POI ${name} has no materialized state flag`);
    const currentBox = await canvas.boundingBox();
    assert(currentBox, `${displayMode}: Pixi canvas disappeared before clicking ${name}`);
    const point = {
      x: currentBox.x + flag.x * currentBox.width / flag.screenWidth,
      y: currentBox.y + flag.y * currentBox.height / flag.screenHeight,
    };
    console.log(`collection: ${displayMode} click ${name} at ${JSON.stringify(point)}`);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await advance(16);
    await page.mouse.up();
    await advance(16);
  };
  const openCollection = async () => {
    await clickPoi(collectionPoi);
    snapshot = await waitFor(
      (value) => value.overlay?.kind === "collection",
      `${displayMode}: Collection POI did not open`,
    );
    assert.equal(snapshot.overlay.collectionType, "Base", `${displayMode}: wrong live Collection root`);
  };
  const assertRows = (value) => {
    const rows = value.overlay.rows;
    assert.deepEqual(rows.map((row) => row.goalKey), expectedRows.map((row) => row.key));
    for (const expected of expectedRows) {
      const row = rows.find((candidate) => candidate.goalKey === expected.key);
      assert(row, `${displayMode}: expected row ${expected.key}`);
      assert.equal(row.percentComplete, expected.percent);
      assert.equal(row.label, `${expected.title} (${expected.percent}%)`);
    }
  };

  await openCollection();
  console.log(`collection: ${displayMode} first overlay open`);
  if (process.env.DIB_COLLECTION_DEBUG_SCREENSHOT === "1") {
    await page.screenshot({ path: `output/collection-${displayMode}-intro.png` });
  }
  snapshot = await waitFor(
    async (value) => value.overlay.ownedPresentation.kind === "intro-chat" &&
      await findLabel("guildQuestChatText") !== null &&
      await findLabel("guildQuestChatFinish") !== null,
    `${displayMode}: first-use Collection chat was not visibly mounted above the live base`,
  );
  assert(await findLabel("guildQuestChatText"));
  await advance(525);
  await clickLabel("guildQuestChat");
  snapshot = await waitFor(
    (value) => value.overlay.ownedPresentation.kind === "none",
    `${displayMode}: first-use Collection chat did not dismiss`,
  );
  assertRows(snapshot);

  await clickLabel("collection:close");
  await waitFor((value) => value.overlay === null, `${displayMode}: Collection base did not close`);
  await openCollection();
  console.log(`collection: ${displayMode} same-POI reopen`);
  // `Chats.plist` has no `MonsterCollection` record, so `showChatDialog:` synthesizes one whose
  // absent `alwaysShow` stays 1 and whose `!seen || alwaysShow` gate never suppresses: the Old Sage
  // greets the player on every arrival, not only the first.
  snapshot = await waitFor(
    async (value) => value.overlay.ownedPresentation.kind === "intro-chat" &&
      await findLabel("guildQuestChatText") !== null,
    `${displayMode}: Collection chat did not replay on the same-POI reopen`,
  );
  await advance(525);
  await clickLabel("guildQuestChat");
  snapshot = await waitFor(
    (value) => value.overlay.ownedPresentation.kind === "none",
    `${displayMode}: replayed Collection chat did not dismiss`,
  );
  assertRows(snapshot);

  // Exercise every incomplete authored row, not one representative. With the original Base root
  // and an empty capture census this covers all four source descriptions in authored order.
  const incompleteRows = expectedRows.filter(({ percent }) => percent < 100);
  assert(
    incompleteRows.some(({ key }) => key === incompleteGoalKey),
    `${displayMode}: configured incomplete goal ${incompleteGoalKey} is not incomplete`,
  );
  for (const row of incompleteRows) {
    await clickLabel(`collection:${row.key}`);
    snapshot = await waitFor(
      async (value) => value.overlay.ownedPresentation.kind === "description" &&
        value.overlay.ownedPresentation.goalKey === row.key &&
        await findLabel("popupButton:") !== null,
      `${displayMode}: Collection description ${row.key} was not visibly mounted`,
    );
    await page.keyboard.press("Escape");
    snapshot = await waitFor(
      (value) => value.overlay.ownedPresentation.kind === "none",
      `${displayMode}: Escape did not dismiss Collection description ${row.key}`,
    );
    assert.equal(snapshot.overlay.kind, "collection");
  }

  if (exerciseClaim) {
    const goldBefore = snapshot.player.gold;
    await clickLabel(`collection:${completeGoalKey}`);
    snapshot = await waitFor(
      async (value) => value.overlay.ownedPresentation.kind === "committed-loot" &&
        await findLabel("popupButton:") !== null,
      `${displayMode}: complete Collection loot popup was not visibly mounted`,
    );
    const goldAfterClaim = snapshot.player.gold;
    assert(goldAfterClaim >= goldBefore, `${displayMode}: committed loot changed wallet backwards`);
    await advance(250);
    await dismissTopPopup(snapshot);
    console.log(`collection: ${displayMode} claim committed`);
    snapshot = await waitFor(
      (value) => value.overlay.ownedPresentation.kind === "none" &&
        value.overlay.rows.some((row) => row.goalKey === completeGoalKey && row.claimed),
      `${displayMode}: committed loot did not return to the claimed Collection base`,
    );
    const claimedGold = snapshot.player.gold;
    const playerBeforeRepeat = JSON.parse(JSON.stringify(snapshot.player));
    await clickLabel(`collection:${completeGoalKey}`);
    snapshot = await waitFor(
      async (value) => value.overlay.ownedPresentation.kind === "repeat" &&
        await findLabel("popupButton:") !== null,
      `${displayMode}: finished Collection repeat popup was not visibly mounted`,
    );
    assert.equal(snapshot.player.gold, claimedGold, `${displayMode}: repeat changed durable wallet`);
    await advance(250);
    await dismissTopPopup(snapshot);
    snapshot = await waitFor(
      (value) => value.overlay.ownedPresentation.kind === "none",
      `${displayMode}: repeat popup did not dismiss`,
    );
    assert.deepEqual(snapshot.player, playerBeforeRepeat, `${displayMode}: repeat changed the player projection`);
    await clickLabel("collection:close");
    await waitFor((value) => value.overlay === null, `${displayMode}: post-claim Collection close failed`);

    // The saved claim must survive the real local-content reload and still be a no-op.
    await page.waitForTimeout(100);
    await page.reload({ waitUntil: "domcontentloaded" });
    await loadLocalContent(page);
    await waitFor((value) => value.startup?.phase === "title", `${displayMode}: reload title missing`);
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.mode === "world" || value.startup?.phase === "save-select",
      `${displayMode}: reload did not reach save selection or world`,
    );
    if (snapshot.startup?.phase === "save-select") {
      const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
      assert(slot?.enabled, `${displayMode}: persisted slot 1 is unavailable`);
      const reloadBox = await canvas.boundingBox();
      assert(reloadBox, `${displayMode}: reloaded Pixi canvas is missing`);
      const reloadGeometry = await stageGeometry(page, reloadBox);
      const point = reloadGeometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
      await advance(250);
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      await advance(16);
      await page.mouse.up();
      await advance(16);
    }
    await waitFor((value) => value.mode === "world" && value.locked === false, `${displayMode}: reload world missing`);
    await openCollection();
    console.log(`collection: ${displayMode} persisted reload open`);
    // The greeting replays here too: a restored `dialogsSeen` cannot suppress an alwaysShow record.
    snapshot = await waitFor(
      async (value) => value.overlay.ownedPresentation.kind === "intro-chat" &&
        await findLabel("guildQuestChatText") !== null,
      `${displayMode}: Collection chat did not replay after reload`,
    );
    await advance(525);
    await clickLabel("guildQuestChat");
    snapshot = await waitFor(
      (value) => value.overlay.ownedPresentation.kind === "none",
      `${displayMode}: reloaded Collection chat did not dismiss`,
    );
    const reloadedRow = snapshot.overlay.rows.find((row) => row.goalKey === completeGoalKey);
    assert(reloadedRow?.claimed, `${displayMode}: claimed Collection row did not persist after reload`);
    const reloadedGold = snapshot.player.gold;
    const playerBeforeReloadRepeat = JSON.parse(JSON.stringify(snapshot.player));
    await clickLabel(`collection:${completeGoalKey}`);
    snapshot = await waitFor(
      async (value) => value.overlay.ownedPresentation.kind === "repeat" &&
        await findLabel("popupButton:") !== null,
      `${displayMode}: reloaded repeat popup was not visibly mounted`,
    );
    assert.equal(snapshot.player.gold, reloadedGold, `${displayMode}: reloaded repeat duplicated loot`);
    await advance(250);
    await dismissTopPopup(snapshot);
    snapshot = await waitFor((value) => value.overlay.ownedPresentation.kind === "none", `${displayMode}: reload repeat did not dismiss`);
    assert.deepEqual(snapshot.player, playerBeforeReloadRepeat, `${displayMode}: reloaded repeat changed the player projection`);
  }

  assert.deepEqual(errors, [], `${displayMode}: page/console errors: ${errors.join(" | ")}`);
  await context.close();
  console.log(`Collection scenario prepared checks passed for ${displayMode} (browser run is opt-in).`);
}

function requiredEnv(name) {
  const value = process.env[name];
  assert(value, `${name} is required for this authored operator-owned Collection fixture`);
  return value;
}

function parseObjectEnv(name) {
  let value;
  try {
    value = JSON.parse(requiredEnv(name));
  } catch (error) {
    throw new Error(`${name} must be a JSON object`, { cause: error });
  }
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be a JSON object`);
  for (const [key, level] of Object.entries(value)) {
    assert(Number.isSafeInteger(level) && level > 0, `${name}.${key} must be a positive level`);
  }
  return value;
}

function parseRowsEnv() {
  let value;
  try {
    value = JSON.parse(requiredEnv("DIB_COLLECTION_EXPECTED_ROWS"));
  } catch (error) {
    throw new Error("DIB_COLLECTION_EXPECTED_ROWS must be a JSON array", { cause: error });
  }
  assert(Array.isArray(value) && value.length > 0, "DIB_COLLECTION_EXPECTED_ROWS must be a non-empty JSON array");
  return value.map((row, index) => {
    assert(row && typeof row === "object", `expected Collection row ${index} must be an object`);
    assert(typeof row.key === "string" && row.key.length > 0, `expected Collection row ${index} key missing`);
    assert(typeof row.title === "string", `expected Collection row ${index} title missing`);
    assert(Number.isSafeInteger(row.percent) && row.percent >= 0 && row.percent <= 100, `expected Collection row ${index} percent invalid`);
    return { key: row.key, title: row.title, percent: row.percent };
  });
}
