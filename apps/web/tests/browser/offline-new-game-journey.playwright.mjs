// Opt-in, uninterrupted offline new-game journey. Run only with operator authorization and an
// operator-owned compatible archive. Chromium is always muted.
//
// This deliberately starts with an empty browser profile. The source skips PickSaveSlotNode when
// all three slots are empty, so the scenario reaches Corova, waits for slot 1 to checkpoint, then
// reloads through the real content gate and physically selects the now-occupied slot 1. From that
// restored save it follows the authored tutorial route through the Field 1 Goblin, proves that
// LeslieSaved unlocks the Corova Guild, opens/closes every town building, and mounts one ordinary
// random encounter through the source same-POI forced-battle route.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? fs.readdirSync(repositoryRoot)
  .map((name) => path.resolve(repositoryRoot, name))
  .find((candidate) => /\.(?:ipa|zip)$/i.test(candidate) && fs.existsSync(candidate));
if (archive === undefined) {
  throw new Error("Set DIB_CONTENT_ARCHIVE to a compatible operator-owned IPA/ZIP.");
}

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDirectory = path.resolve(
  process.env.DIB_OFFLINE_JOURNEY_OUTPUT ??
    path.join(repositoryRoot, "output/offline-new-game-journey"),
);
fs.mkdirSync(outputDirectory, { recursive: true });

const edgePath = process.env.DIB_BROWSER_EXECUTABLE ??
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await chromium.launch({
  executablePath: fs.existsSync(edgePath) ? edgePath : undefined,
  headless: process.env.DIB_HEADED !== "1",
  args: [
    "--enable-unsafe-swiftshader",
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
  ],
});

const screenshot = async (page, name) => {
  // State changes can complete between two browser paints when advanceTime drives Pixi quickly.
  // Wait for two real frames so every proof image reflects the state asserted immediately above.
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await page.screenshot({
    path: path.join(outputDirectory, name),
    fullPage: false,
    timeout: 120_000,
  });
};

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    // Capture deterministic-harness intent before boot; main.ts replaces this provisional hook
    // with the real single-ticker advancer.
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 7;
    window.__DIB_TEST_BATTLE_SEED__ = 5;
  });

  const bootOfflineThroughGate = async (capturePrefix, { expectUnselectedMode = false } = {}) => {
    const gate = page.locator(".content-gate");
    await gate.waitFor({ state: "visible", timeout: 30_000 });
    const selectedMode = await gate.evaluate((root) =>
      root.querySelector('input[name="save-mode"]:checked')?.getAttribute("value") ?? null);
    if (expectUnselectedMode) {
      assert.equal(selectedMode, null, `${capturePrefix}: play mode was preselected`);
    } else {
      assert(
        selectedMode === null || selectedMode === "local",
        `${capturePrefix}: unexpected persisted play mode ${JSON.stringify(selectedMode)}`,
      );
    }
    await screenshot(page, `${capturePrefix}-landing.png`);

    await page.locator('input[name="asset-archive"]').setInputFiles(archive);
    const backdrop = page.locator(".content-gate__backdrop--visible");
    await backdrop.waitFor({
      state: "visible",
      timeout: 120_000,
    });
    await page.waitForFunction(() => {
      const node = document.querySelector(".content-gate__backdrop--visible");
      return node instanceof HTMLElement && Number.parseFloat(getComputedStyle(node).opacity) > 0.99;
    }, undefined, { timeout: 10_000 });
    assert.match(await gate.getAttribute("class"), /content-gate--themed/,
      `${capturePrefix}: selected archive did not theme the landing page`);
    await page.getByRole("radio", { name: "Offline", exact: true }).check();
    const status = page.locator(
      '[data-local-save-status].content-gate__mode-detail-status--success',
    );
    await status.waitFor({ state: "visible", timeout: 120_000 });
    assert.match((await status.textContent()) ?? "", /save slots?|gear icon/i,
      `${capturePrefix}: Offline mode did not finish its save probe`);
    await page.getByRole("checkbox", {
      name: "I have the right to use the content in this archive on this device.",
    }).check();
    await screenshot(page, `${capturePrefix}-offline-ready.png`);
    await page.getByRole("button", { name: "Play Offline", exact: true }).click();

    try {
      await page.waitForFunction(
        () => typeof window.render_game_to_text === "function" &&
          JSON.parse(window.render_game_to_text()).mode === "start",
        undefined,
        { timeout: 120_000 },
      );
    } catch (error) {
      const detail = await page.locator("details pre").textContent().catch(() => null);
      throw new Error(
        `${capturePrefix}: Offline content did not reach the source start screen` +
          (detail ? `: ${detail.trim()}` : ""),
        { cause: error },
      );
    }
  };

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (milliseconds) => {
    await page.evaluate((value) => window.advanceTime(value), milliseconds);
    await page.waitForTimeout(1);
  };
  const waitFor = async (predicate, description, frames = 1_600) => {
    for (let index = 0; index < frames; index += 1) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
      // Asset continuations require occasional real event-loop turns; a tight advanceTime loop can
      // otherwise leave a healthy scene indefinitely in presentation.state === "building".
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    throw new Error(
      `${description}; errors=${errors.join(" | ") || "none"}; ` +
        `state=${JSON.stringify(await state())}`,
    );
  };
  const visibleTarget = (label) => page.evaluate((wanted) => {
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
        const hitArea = node.hitArea;
        const point = hitArea && Number.isFinite(hitArea.x) &&
            Number.isFinite(hitArea.y) && Number.isFinite(hitArea.width) &&
            Number.isFinite(hitArea.height)
          ? node.toGlobal({
              x: hitArea.x + hitArea.width / 2,
              y: hitArea.y + hitArea.height / 2,
            })
          : (() => {
              const bounds = node.getBounds();
              return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
            })();
        const hit = window.__PIXI_APP__.renderer.events.rootBoundary.hitTest(point.x, point.y);
        const hitPath = [];
        for (let current = hit; current; current = current.parent) {
          hitPath.push(current.label ?? null);
        }
        return {
          x: point.x,
          y: point.y,
          eventMode: node.eventMode,
          hitPath,
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  }, label);
  const stableVisibleTarget = async (label) => {
    let previous = null;
    let target = null;
    for (let index = 0; index < 240; index += 1) {
      target = await visibleTarget(label);
      if (
        target !== null && previous !== null &&
        Math.abs(target.x - previous.x) < 1e-6 &&
        Math.abs(target.y - previous.y) < 1e-6
      ) break;
      previous = target;
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    assert(target, `missing stable visible Pixi control ${label}`);
    return target;
  };
  const clickLabel = async (label) => {
    const target = await stableVisibleTarget(label);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, `canvas disappeared before clicking ${label}`);
    await page.mouse.click(canvas.x + target.x, canvas.y + target.y);
  };
  const clickBattlePoint = async (point) => {
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "canvas disappeared before a battle-point click");
    const geometry = await stageGeometry(page, canvas);
    const css = geometry.toCss(point);
    await page.mouse.click(css.x, css.y);
  };
  const clickPoi = async (name) => {
    const snapshot = await state();
    const poi = snapshot.pois?.find((candidate) => candidate.name === name);
    assert(poi, `missing world POI ${name}`);
    assert.notEqual(poi.state, 3, `world POI ${name} is not selectable`);
    const stateSpriteCenter = await page.evaluate((position) => {
      let result = null;
      const visit = (node) => {
        if (
          result === null &&
          Math.abs((node.position?.x ?? Number.NaN) - position.x) < 1e-3 &&
          Math.abs((node.position?.y ?? Number.NaN) - position.y) < 1e-3
        ) {
          const sprite = (node.children ?? []).find((child) =>
            child.visible && child.cursor === "pointer" && child.texture !== undefined);
          if (sprite !== undefined) {
            const bounds = sprite.getBounds();
            result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          }
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return result;
    }, poi.position);
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, `canvas disappeared before selecting POI ${name}`);
    if (stateSpriteCenter !== null) {
      // Pixi getBounds is already canvas-global; only add the canvas element's CSS-page origin.
      await page.mouse.click(canvas.x + stateSpriteCenter.x, canvas.y + stateSpriteCenter.y);
      return;
    }
    const geometry = await stageGeometry(page, canvas);
    const fallback = geometry.toCss(poi.position);
    await page.mouse.click(fallback.x, fallback.y);
  };
  const swipeCurrentEnemy = async () => {
    const snapshot = await state();
    const enemy = snapshot.monsters.find((monster) => monster.team === 1 && monster.visible);
    assert(enemy?.targetPoint && enemy.targetSize, "battle has no visible enemy swipe target");
    const canvas = await page.locator("canvas").first().boundingBox();
    assert(canvas, "canvas disappeared before a battle swipe");
    const geometry = await stageGeometry(page, canvas);
    const halfLane = Math.max(40, enemy.targetSize.w * 0.75);
    const start = geometry.toCss({
      x: enemy.targetPoint.x - halfLane,
      y: enemy.targetPoint.y,
    });
    const end = geometry.toCss({
      x: enemy.targetPoint.x + halfLane,
      y: enemy.targetPoint.y,
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let index = 1; index <= 18; index += 1) {
      await page.mouse.move(
        start.x + ((end.x - start.x) * index) / 18,
        start.y,
        { steps: 1 },
      );
    }
    await page.mouse.up();
  };
  const dismissTutorial = async (expectedKey) => {
    let snapshot = await state();
    for (let pageIndex = 0; pageIndex < 12 && snapshot.tutorial != null; pageIndex += 1) {
      assert.equal(snapshot.tutorial.key, expectedKey,
        `unexpected tutorial while dismissing ${expectedKey}`);
      snapshot = await waitFor(
        (value) => value.tutorial == null || value.tutorial.okReady === true,
        `${expectedKey} page ${pageIndex} did not become dismissible`,
      );
      if (snapshot.tutorial == null) break;
      const previousPage = snapshot.tutorial.page;
      await page.keyboard.press("Enter");
      snapshot = await waitFor(
        (value) => value.tutorial == null || value.tutorial.page !== previousPage,
        `${expectedKey} page ${pageIndex} did not advance`,
      );
    }
    assert.equal(snapshot.tutorial, snapshot.mode === "battle" ? null : undefined,
      `${expectedKey} did not close`);
  };
  const dismissTownChats = async (description) => {
    let snapshot = await state();
    for (let pageIndex = 0; pageIndex < 40; pageIndex += 1) {
      if (snapshot.overlay?.kind !== "townEnterChat" && !snapshot.overlay?.chatOpen) break;
      await advance(550);
      await clickLabel("guildQuestChat");
      await advance(25);
      snapshot = await state();
    }
    await waitFor(
      (value) => value.overlay?.kind !== "townEnterChat" && !value.overlay?.chatOpen,
      description,
    );
  };
  const waitForTownIdle = (description) => waitFor(
    (value) => value.mode === "town" && value.overlay === null &&
      value.tutorial == null && !value.locked && value.town?.dayNotification?.visible !== true,
    description,
  );
  const browserSaveEnvelope = () => page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((key) =>
      key.startsWith("dib-save-v1:") && key.endsWith(":slot-1"));
    if (keys.length !== 1) return { keys, envelope: null };
    return { keys, envelope: JSON.parse(localStorage.getItem(keys[0])) };
  });
  const waitForBrowserSave = async (predicate, description) => {
    for (let index = 0; index < 800; index += 1) {
      const saved = await browserSaveEnvelope();
      if (saved.envelope !== null && predicate(saved.envelope)) return saved;
      await advance(25);
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    throw new Error(`${description}: ${JSON.stringify(await browserSaveEnvelope())}`);
  };

  const driveBattleToWorld = async (expectedPoi) => {
    let submittedMoves = 0;
    let sawInteractiveBoard = false;
    const tutorials = [];
    const recordedTutorialPages = new Set();
    for (let index = 0; index < 8_000; index += 1) {
      let snapshot = await state();
      if (snapshot.mode === "world") {
        assert.equal(snapshot.currentPoi, expectedPoi,
          `battle returned to the wrong world POI: ${JSON.stringify(snapshot)}`);
        return { submittedMoves, sawInteractiveBoard, tutorials, snapshot };
      }
      assert.equal(snapshot.mode, "battle", `unexpected mode during battle: ${snapshot.mode}`);
      if (snapshot.tutorial != null) {
        const identity = `${snapshot.tutorial.key}:${snapshot.tutorial.page}`;
        if (!recordedTutorialPages.has(identity)) {
          recordedTutorialPages.add(identity);
          tutorials.push({
            key: snapshot.tutorial.key,
            page: snapshot.tutorial.page,
            image: snapshot.tutorial.image,
          });
        }
        snapshot = await waitFor(
          (value) => value.tutorial == null || value.tutorial.okReady === true,
          `${snapshot.tutorial.key} did not become dismissible during battle`,
        );
        if (snapshot.tutorial != null) await page.keyboard.press("Enter");
      } else if (snapshot.activePopup === "encounterChat") {
        await advance(550);
        await clickLabel("guildQuestChat");
      } else if (snapshot.activePopup === "xpAward" && snapshot.postBattleButtons.length > 0) {
        await clickBattlePoint(snapshot.postBattleButtons[0].point);
      } else if (snapshot.statusText?.visible) {
        await page.keyboard.press("Enter");
      } else if (
        snapshot.presentation.state === "awaitingPlayerChoice" &&
        snapshot.panelVisible && !snapshot.turnOrderAnimating
      ) {
        if (!sawInteractiveBoard) {
          await screenshot(page, `07a-${expectedPoi.replaceAll("_", "-")}-interactive.png`);
        }
        sawInteractiveBoard = true;
        await swipeCurrentEnemy();
        submittedMoves += 1;
      } else {
        await advance(50);
      }
      if (index % 20 === 0) await page.waitForTimeout(2);
    }
    throw new Error(
      `battle at ${expectedPoi} did not return to the world; ` +
        `state=${JSON.stringify(await state())}`,
    );
  };

  // Phase 1: real landing page -> empty source slot -> NewGame plot/starter -> first Corova save.
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await bootOfflineThroughGate("01-initial-gate", { expectUnselectedMode: true });
  let snapshot = await waitFor(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "fresh Offline boot did not reach the source title",
  );
  assert(snapshot.startup.slots.every(({ occupied }) => occupied === false),
    `fresh browser context exposed an occupied slot: ${JSON.stringify(snapshot.startup.slots)}`);
  await clickLabel("sourceTitleTouchLayer");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "new-game-plot",
    "all-empty source title did not start NewGame in slot 1",
  );
  assert.equal(snapshot.startup.selectedSlot, "slot-1");
  assert.equal(snapshot.startup.intro.image, "plot_start1.png");
  await advance(750);
  await screenshot(page, "02-new-game-plot.png");
  await advance(1_300);
  if ((await state()).startup?.phase === "new-game-plot") await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "pick-dragon",
    "NewGame plot did not reach starter selection",
  );
  assert.deepEqual(snapshot.startup.intro.choices.map(({ shortType }) => shortType), [
    "BlueBabyDragon",
    "RedBabyDragon",
    "WhiteBabyDragon",
    "GoldBabyDragon",
  ]);
  for (const shortType of snapshot.startup.intro.choices.map(({ shortType }) => shortType)) {
    await stableVisibleTarget(`starter:${shortType}`);
  }
  await screenshot(page, "03-starter-selection.png");
  await clickLabel("starter:BlueBabyDragon");
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.town?.name === "First_City" && !value.locked,
    "starter selection did not auto-enter Corova",
  );
  assert.deepEqual(snapshot.party.map(({ shortType, level }) => ({ shortType, level })), [
    { shortType: "BlueBabyDragon", level: 1 },
  ]);
  assert.equal(
    snapshot.town.buildings.find(({ className }) => className === "TavernMenuItem")?.enabled,
    false,
    "Corova Guild was enabled before LeslieSaved",
  );
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "townEnterChat" &&
      value.overlay.chatName === "LeslieIntro1",
    "fresh Corova did not present LeslieIntro1",
  );
  await dismissTownChats("initial LeslieIntro1 chat did not close");
  const initialSave = await waitForBrowserSave(
    (envelope) => envelope.state?.world?.currentPoiName === "First_City" &&
      envelope.state?.quests?.dialogsSeen?.includes("LeslieIntro1"),
    "fresh Corova state did not checkpoint slot 1",
  );
  assert(initialSave.envelope.revision > 0, "fresh slot checkpoint has no revision");
  await waitForTownIdle("fresh Corova checkpoint did not become visually idle");
  await screenshot(page, "04-first-corova-checkpoint.png");

  // Phase 2: reload the same durable journey and physically select occupied slot 1.
  await page.reload({ waitUntil: "domcontentloaded" });
  await bootOfflineThroughGate("05-reload-gate");
  await waitFor(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "reloaded Offline boot did not reach the source title",
  );
  await clickLabel("sourceTitleTouchLayer");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "occupied browser save did not open PickSaveSlotNode",
  );
  const slot1 = snapshot.startup.menu.buttons.find(({ id }) => id === "slot-1");
  assert(slot1?.enabled, `occupied slot 1 is not selectable: ${JSON.stringify(snapshot.startup)}`);
  assert.equal(snapshot.startup.slots.find(({ slotId }) => slotId === "slot-1")?.occupied, true);
  assert.equal(snapshot.startup.slots.find(({ slotId }) => slotId === "slot-2")?.occupied, false);
  assert.equal(snapshot.startup.slots.find(({ slotId }) => slotId === "slot-3")?.occupied, false);
  await advance(300);
  await screenshot(page, "06-save-selection.png");
  await clickLabel("sourcePopupButton:slot-1");
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.town?.name === "First_City" && !value.locked,
    "slot 1 did not resume in Corova",
  );
  assert.equal(snapshot.party[0]?.shortType, "BlueBabyDragon");
  assert.equal(snapshot.currentPoi, "First_City");
  await waitForTownIdle("restored Corova did not become interactive");

  // Phase 3: source tutorial route, first battle, and LeslieSaved Guild unlock.
  await clickLabel("town:First_City:exit");
  snapshot = await waitFor(
    (value) => value.mode === "world" && value.tutorial?.key === "Tutorial2",
    "leaving fresh Corova did not present Tutorial2",
  );
  assert.equal(snapshot.tutorial.image, "fieldMovement.png");
  await dismissTutorial("Tutorial2");
  await waitFor(
    (value) => value.mode === "world" && !value.locked && !value.walking,
    "world did not settle after Tutorial2",
  );
  await clickPoi("1-1_Turtorial_Hut_1");
  await waitFor(
    (value) => value.mode === "world" && value.currentPoi === "1-1_Turtorial_Hut_1" &&
      !value.walking && !value.locked,
    "Leslie's Hut walk did not settle",
  );
  await clickPoi("1-1_Field_1");
  snapshot = await waitFor(
    (value) => value.mode === "battle",
    "Field 1 did not launch its staged Goblin battle",
  );
  assert.equal(snapshot.encounter.startChat, "Leslie");
  assert.equal(snapshot.encounter.winChat, "LeslieSaved");
  assert.equal(snapshot.encounter.questKey, null);
  await waitFor(
    (value) => value.mode === "battle" && value.entry?.transitionFinished === true &&
      value.entry.sceneVisible === true && value.activePopup !== null,
    "Field 1 did not reach its first visible battle overlay",
  );
  await screenshot(page, "07-field-1-battle-entry.png");
  const firstBattle = await driveBattleToWorld("1-1_Field_1");
  assert(firstBattle.sawInteractiveBoard, "Field 1 never exposed an interactive battle panel");
  assert(firstBattle.submittedMoves > 0, "Field 1 completed without physical player input");
  assert.deepEqual(firstBattle.tutorials, [
    { key: "Tutorial0", page: 0, image: "battleTutorial1.png" },
    { key: "Tutorial0", page: 1, image: "battleTutorial2.png" },
  ], "Field 1 did not present the complete first-battle Tutorial0 sequence");
  snapshot = await waitFor(
    (value) => value.mode === "world" && value.currentPoi === "1-1_Field_1" && !value.locked,
    "Field 1 victory did not restore the retained world",
  );
  assert(snapshot.refresh.completedPois.includes("1-1_Field_1"),
    "Field 1 victory did not complete the POI in the live refresh state");
  assert.equal(snapshot.pois.find(({ name }) => name === "1-1_Forest_1")?.state === 3, false,
    "Field 1 victory did not unlock Corova's Forest connection");
  await waitForBrowserSave(
    (envelope) => envelope.state?.world?.poiWins?.["1-1_Field_1"] === 1 &&
      envelope.state?.quests?.dialogsSeen?.includes("LeslieSaved"),
    "Field 1 victory and LeslieSaved did not checkpoint",
  );

  await clickPoi("1-1_Turtorial_Hut_1");
  await waitFor(
    (value) => value.mode === "world" && value.currentPoi === "1-1_Turtorial_Hut_1" &&
      !value.walking && !value.locked,
    "post-victory return to Leslie's Hut did not settle",
  );
  await clickPoi("First_City");
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.town?.name === "First_City",
    "post-victory route did not enter Corova",
  );
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "townEnterChat" &&
      value.overlay.chatName === "LeslieIntro2",
    "post-Goblin Corova did not present LeslieIntro2",
  );
  await dismissTownChats("post-Goblin Corova story chat did not close");
  snapshot = await waitForTownIdle("post-Goblin Corova did not become interactive");
  const tavern = snapshot.town.buildings.find(({ className }) => className === "TavernMenuItem");
  assert(tavern?.enabled, `LeslieSaved did not enable the Corova Guild: ${JSON.stringify(snapshot.town)}`);
  assert.equal(snapshot.town.flashing?.key, "FirstTavernFlash");
  const guildSave = await waitForBrowserSave(
    (envelope) => envelope.state?.quests?.dialogsSeen?.includes("LeslieSaved") &&
      envelope.state?.world?.poiWins?.["1-1_Field_1"] === 1,
    "LeslieSaved/Guild unlock did not checkpoint",
  );
  await screenshot(page, "08-corova-guild-unlocked.png");

  // Phase 4: physically open and close every non-fake Corova building without making a purchase,
  // editing the party, accepting a quest, or travelling away.
  const testedBuildings = [];
  const buildingLabel = (className) => `town:First_City:menu:${className}`;
  const assertTownRestored = async (className) => {
    await waitForTownIdle(`${className} did not return control to Corova`);
    // Several source screens release their debug/modal owner before their 0.2s close tween has
    // left the display tree. Do not aim the next physical town tap through that closing surface.
    await advance(250);
    const current = await waitForTownIdle(`${className} close presentation did not settle`);
    assert.equal(current.currentPoi, "First_City");
    assert.equal(current.transitionFailure, undefined, `${className} reported a transition failure`);
    testedBuildings.push(className);
  };

  await clickLabel(buildingLabel("MonsterManagementMenuItem"));
  snapshot = await waitFor(
    (value) => value.overlay?.screen === "partyEditor" && value.overlay.style === 0,
    "Monster Management did not open its editable town screen",
  );
  assert.equal(snapshot.overlay.members.length, 1);
  snapshot = await waitFor(
    (value) => value.tutorial?.key === "Tutorial4",
    "Monster Management did not present its first-use Tutorial4",
  );
  await dismissTutorial("Tutorial4");
  await clickLabel("partyEditorClose");
  await assertTownRestored("MonsterManagementMenuItem");

  await clickLabel(buildingLabel("StoreMenuItem"));
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "popup" || value.overlay?.category === 0,
    "Store did not open its first-use popup or category root",
  );
  if (snapshot.overlay?.kind === "popup") {
    assert.deepEqual(snapshot.overlay.popups.stack.at(-1)?.buttons, ["Ok"]);
    await clickLabel("popupButton:Ok");
  }
  await waitFor((value) => value.overlay?.category === 0, "Store category root did not mount");
  await clickLabel("store:close");
  await assertTownRestored("StoreMenuItem");

  await clickLabel(buildingLabel("TavernMenuItem"));
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "guildQuests" && value.overlay.tavernOpen,
    "unlocked Corova Guild did not open",
  );
  assert(snapshot.overlay.availableCount > 0, "Corova Guild has no available quests");
  assert.equal(snapshot.overlay.activeQuestNames.length, 0,
    "Guild click-test unexpectedly accepted a quest");
  await clickLabel("guildTavern:close");
  await assertTownRestored("TavernMenuItem");

  await clickLabel(buildingLabel("TownWarpMenuItem"));
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "townWarp" && value.overlay.open === true,
    "post-tutorial Corova Warp Gate did not open",
  );
  assert(
    snapshot.overlay.destinations.some(({ townName, visited }) =>
      townName === "First_City" && visited),
    "Corova Warp Gate did not include the visited current town",
  );
  if (snapshot.overlay.popups?.depth === 1) {
    assert.deepEqual(snapshot.overlay.popups.stack.at(-1)?.buttons, ["Ok"]);
    await clickLabel("popupButton:Ok");
    await waitFor(
      (value) => value.overlay?.kind === "townWarp" && value.overlay.popups?.depth === 0,
      "TownWarpTutorial popup did not close",
    );
  }
  await clickLabel("townWarp:close");
  await assertTownRestored("TownWarpMenuItem");

  await clickLabel(buildingLabel("MonsterpediaMenuItem"));
  snapshot = await waitFor(
    (value) => value.overlay?.screen === "monsterpedia" && value.overlay.editable === true,
    "town Monsterpedia did not open its editable book",
  );
  snapshot = await waitFor(
    (value) => value.overlay?.screen === "monsterpedia" && value.overlay.popups?.depth === 1,
    "FirstMonsterpedia tutorial did not open",
  );
  assert.deepEqual(snapshot.overlay.popups.stack.at(-1)?.buttons, ["Ok"]);
  await clickLabel("popupButton:Ok");
  await waitFor(
    (value) => value.overlay?.screen === "monsterpedia" && value.overlay.popups?.depth === 0,
    "FirstMonsterpedia tutorial did not close",
  );
  await clickLabel("monsterpediaTab:close");
  await assertTownRestored("MonsterpediaMenuItem");

  await clickLabel(buildingLabel("CharacterDisplayMenuItem"));
  await waitFor(
    (value) => value.overlay?.config === "HeroManagement" && value.overlay.open === true,
    "Character building did not open Hero Management",
  );
  await clickLabel("characterManagement:close");
  await assertTownRestored("CharacterDisplayMenuItem");

  await clickLabel(buildingLabel("BlackMarketMenuItem"));
  snapshot = await waitFor(
    (value) => value.overlay?.kind === "popup" && value.overlay.popups?.depth === 1,
    "Black Market did not present its source not-ready popup",
  );
  assert.deepEqual(snapshot.overlay.popups.stack.at(-1)?.buttons, ["Ok"]);
  await clickLabel("popupButton:Ok");
  await assertTownRestored("BlackMarketMenuItem");

  assert.deepEqual(testedBuildings, [
    "MonsterManagementMenuItem",
    "StoreMenuItem",
    "TavernMenuItem",
    "TownWarpMenuItem",
    "MonsterpediaMenuItem",
    "CharacterDisplayMenuItem",
    "BlackMarketMenuItem",
  ]);
  snapshot = await state();
  assert.equal(snapshot.town.buildings.filter(({ fake }) => !fake).length, testedBuildings.length,
    "Corova exposes an untested non-fake building");
  // PopupNode's source close tween outlives its modal/debug-state ownership. Advance through that
  // presentation tail so this proof frame shows the restored town, not the last closing popup.
  await advance(250);
  await waitForTownIdle("Corova did not remain idle after the final building close tween");
  await screenshot(page, "09-all-corova-buildings-tested.png");

  // Phase 5: leave town and mount one ordinary randomized wild encounter. The first Forest visit
  // may pass its authored occurrence roll; reselecting the current field sets forcedBattle=true,
  // which preserves ordinary population RNG while guaranteeing an encounter instead of a skip.
  await clickLabel("town:First_City:exit");
  await waitFor(
    (value) => value.mode === "world" && value.currentPoi === "First_City" && !value.locked,
    "final Corova exit did not restore the overworld",
  );
  await clickPoi("1-1_Forest_1");
  snapshot = await waitFor(
    (value) => value.mode === "battle" ||
      (value.mode === "world" && value.currentPoi === "1-1_Forest_1" &&
        !value.walking && !value.locked),
    "Forest 1 arrival neither settled nor launched an encounter",
  );
  if (snapshot.mode === "world") {
    await clickPoi("1-1_Forest_1");
    snapshot = await waitFor(
      (value) => value.mode === "battle",
      "same-POI forced route did not launch a Forest 1 encounter",
    );
  }
  assert.equal(snapshot.encounter.questKey, null, "final encounter is quest-authored, not random");
  assert.equal(snapshot.encounter.uniqueKey, null, "final encounter is fixed, not random");
  assert.equal(snapshot.encounter.startChat, null, "random encounter unexpectedly has start chat");
  assert.equal(snapshot.encounter.winChat, null, "random encounter unexpectedly has win chat");
  assert.equal(snapshot.encounter.allowRetreat, true, "ordinary wild encounter disabled retreat");

  const randomTutorials = [];
  const recordedRandomTutorialPages = new Set();
  for (let index = 0; index < 1_600; index += 1) {
    snapshot = await state();
    if (
      snapshot.presentation.state === "awaitingPlayerChoice" && snapshot.panelVisible &&
      !snapshot.turnOrderAnimating && snapshot.tutorial == null && snapshot.activePopup === null
    ) break;
    if (snapshot.tutorial != null) {
      const identity = `${snapshot.tutorial.key}:${snapshot.tutorial.page}`;
      if (!recordedRandomTutorialPages.has(identity)) {
        recordedRandomTutorialPages.add(identity);
        randomTutorials.push({
          key: snapshot.tutorial.key,
          page: snapshot.tutorial.page,
          image: snapshot.tutorial.image,
        });
      }
      snapshot = await waitFor(
        (value) => value.tutorial == null || value.tutorial.okReady === true,
        `${snapshot.tutorial.key} did not become dismissible in the random encounter`,
      );
      if (snapshot.tutorial != null) await page.keyboard.press("Enter");
    } else if (snapshot.activePopup === "encounterChat") {
      throw new Error(`ordinary random encounter opened ${snapshot.encounter.startChat}`);
    } else {
      await advance(25);
    }
    if (index % 20 === 0) await page.waitForTimeout(2);
  }
  snapshot = await state();
  assert.equal(snapshot.presentation.state, "awaitingPlayerChoice",
    `random encounter never reached player input: ${JSON.stringify(snapshot)}`);
  assert.deepEqual(randomTutorials, [
    { key: "Tutorial1", page: 0, image: "catchTutorial.png" },
  ], "the second real battle did not present the one-page catch Tutorial1 sequence");
  assert(snapshot.monsters.some(({ team, visible }) => team === 1 && visible),
    "random encounter rendered no visible enemy");
  assert.equal(snapshot.battleInput.latestPlayerSubmission, null,
    "random encounter began with a stale player submission");
  await screenshot(page, "10-random-wild-encounter.png");
  await swipeCurrentEnemy();
  snapshot = await waitFor(
    (value) => value.mode === "battle" && value.battleInput?.latestPlayerSubmission !== null,
    "random wild encounter did not accept a physical player action",
  );
  assert(snapshot.battleInput.latestPlayerSubmission.submittedTargetIds.length > 0,
    `random encounter action submitted no target: ${JSON.stringify(snapshot.battleInput)}`);
  await advance(500);

  const finalSave = await waitForBrowserSave(
    (envelope) => envelope.state?.world?.currentPoiName === "1-1_Forest_1" &&
      envelope.state?.quests?.dialogsSeen?.includes("LeslieSaved"),
    "final Forest/Guild state did not remain durable",
  );
  assert(finalSave.envelope.revision >= guildSave.envelope.revision,
    "final browser save revision moved backwards");
  assert.equal(errors.length, 0, errors.join("\n"));

  const result = {
    archive: path.basename(archive),
    selectedSlot: "slot-1",
    starter: "BlueBabyDragon",
    firstBattleMoves: firstBattle.submittedMoves,
    guildUnlockedBy: "LeslieSaved",
    testedBuildings,
    randomEncounter: {
      poi: "1-1_Forest_1",
      enemies: snapshot.monsters
        .filter(({ team }) => team === 1)
        .map(({ id, level }) => ({ id, level })),
      submission: snapshot.battleInput.latestPlayerSubmission,
    },
    saveRevision: finalSave.envelope.revision,
  };
  fs.writeFileSync(
    path.join(outputDirectory, "journey-result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
  console.log(`offline-new-game-journey: PASS ${JSON.stringify(result)}`);
  await context.close();
} finally {
  await browser.close();
}
