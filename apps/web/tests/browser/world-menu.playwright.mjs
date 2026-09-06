// Opt-in MasterMenu composition contract. Run only with operator authorization; Chromium is muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/world-menu-browser");
fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(`console: ${message.text()}`);
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1"];
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const waitForState = async (predicate, description, iterations = 120) => {
    for (let i = 0; i < iterations; i++) {
      const snapshot = await state();
      if (predicate(snapshot)) {
        // Cached assets can make a modal resolve between frames. Force one deterministic render
        // before probing Pixi bounds so sortableChildren/zIndex arbitration reflects that mount.
        await advance(25);
        return await state();
      }
      await page.waitForTimeout(50);
      await advance(25);
    }
    throw new Error(
      `${description}; browser errors: ${errors.join(" | ") || "none"}; ` +
      `final state: ${JSON.stringify(await state())}`,
    );
  };
  const box = await page.locator("canvas").first().boundingBox();
  assert(box);
  const boundsForLabel = async (label) => page.evaluate((wanted) => {
    const root = globalThis.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const matches = [];
    const visit = (node) => {
      if (node.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        matches.push({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return matches.at(-1) ?? null;
  }, label);
  const clickLabel = async (label) => {
    const bounds = await boundsForLabel(label);
    assert(bounds, `missing visible Pixi node ${label}`);
    const currentBox = await page.locator("canvas").first().boundingBox();
    assert(currentBox, "current Pixi canvas is unavailable");
    await page.mouse.click(
      currentBox.x + bounds.x + bounds.w / 2,
      currentBox.y + bounds.y + bounds.h / 2,
    );
  };

  await waitForState((value) => value.startup?.phase === "title", "startup title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitForState(
    (value) => value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" ||
      value.mode === "world",
    "title did not continue into a save",
  );
  if (snapshot.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.startup?.phase === "pick-dragon",
      "new-game plot did not reach starter selection",
    );
  }
  if (snapshot.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  for (let i = 0; i < 240 && !["world", "town"].includes((await state()).mode); i++) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(1);
  }
  snapshot = await state();
  assert(
    snapshot.mode === "world" || snapshot.mode === "town",
    `startup did not reach gameplay: ${JSON.stringify(snapshot)}`,
  );
  for (let i = 0; i < 20 && snapshot.overlay?.kind === "townEnterChat"; i++) {
    await page.keyboard.press("Enter");
    await advance(50);
    snapshot = await state();
  }
  if (snapshot.mode === "town") {
    await waitForState(
      (value) => value.mode === "town" && value.overlay === null && value.town?.exitEnabled,
      "startup town did not become interactive",
    );
    await advance(1_500);
    await clickLabel(`town:${snapshot.town.name}:exit`);
    snapshot = await waitForState(
      (value) => value.mode === "world",
      "town exit did not return to the world menu context",
    );
  }
  for (let i = 0; i < 10 && snapshot.tutorial !== undefined; i++) {
    await page.keyboard.press("Enter");
    await advance(100);
    snapshot = await state();
  }
  assert.equal(snapshot.tutorial, undefined, "startup field tutorial did not dismiss");
  for (let i = 0; i < 160 && (snapshot.chrome.heroXp.expanded || snapshot.chrome.heroXp.moving); i++) {
    await advance(25);
    snapshot = await state();
  }

  // Web-native contextual Esc opens the otherwise pointer-only world menu, then closes it.
  await page.keyboard.press("Escape");
  await waitForState((value) => value.menu?.config === "MasterMenu", "Esc did not open MasterMenu");
  await page.keyboard.press("Escape");
  await waitForState((value) => value.menu === null, "Esc did not close MasterMenu");

  await clickLabel("worldMenuButton");
  snapshot = await waitForState((value) => value.menu !== null, "MasterMenu did not open");
  assert.equal(snapshot.menu.config, "MasterMenu");
  assert.equal(snapshot.menu.editable, false);
  assert.deepEqual(snapshot.menu.columns.map((column) => column.map((item) => item.label)), [
    ["Items", "Quests", "Achievements", "Options"],
    ["Monsters", "World Map", "Town Portal", "Main Menu"],
    ["Monsterpedia", "Highscores", "Tutorials"],
  ]);
  const enabledActions = snapshot.menu.buttons.filter((button) => button.enabled).map((button) => button.action).sort();
  assert(enabledActions.includes("monsters"));
  assert(enabledActions.includes("monsterpedia"));
  assert(enabledActions.includes("townPortal"));
  assert(enabledActions.includes("options"));
  assert(enabledActions.includes("mainMenu"));

  // Disabled rows are visible black labels but inert under PopupMenu arbitration.
  const disabledButton = snapshot.menu.buttons.find((button) => !button.enabled);
  assert(disabledButton, "MasterMenu fixture exposes no disabled row for arbitration proof");
  await clickLabel(`worldMenu:${disabledButton.action}`);
  assert.equal((await state()).menu.config, "MasterMenu");

  const monstersButton = snapshot.menu.buttons.find((button) => button.action === "monsters");
  const brownPlateEdge = {
    x: monstersButton.backgroundBounds.x + 1,
    y: monstersButton.backgroundBounds.y + monstersButton.backgroundBounds.h / 2,
  };
  assert(
    brownPlateEdge.x < monstersButton.labelBounds.x &&
      brownPlateEdge.x >= monstersButton.backgroundBounds.x,
    "brown-plate probe must be outside the label but inside the visible MenuButton2 background",
  );
  // `menu.buttons[].backgroundBounds` are MENU-LOCAL points; the canvas wants global pixels (points
  // x2, then the FixedStage letterbox scale). Converting through the row node's own transform is
  // what `clickLabel` effectively does via `getBounds()`, and it keeps this probe pointing at the
  // plate instead of a spot a couple of hundred pixels up and to the left.
  const platePoint = await page.evaluate(({ wanted, local }) => {
    const root = globalThis.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    let found;
    const visit = (node) => {
      if (node.label === wanted) found = node;
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    if (!found) throw new Error(`missing Pixi node ${wanted}`);
    // The row node's origin is its LABEL origin, so the plate sits at (background - label).
    const point = found.toGlobal({ x: local.x, y: local.y });
    return { x: point.x, y: point.y };
  }, {
    wanted: "worldMenu:monsters",
    local: {
      x: brownPlateEdge.x - monstersButton.labelBounds.x,
      y: brownPlateEdge.y - monstersButton.labelBounds.y,
    },
  });
  await page.mouse.click(box.x + platePoint.x, box.y + platePoint.y);
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "partyEditor",
    "party editor did not open",
  );
  assert.equal(snapshot.overlay.style, 1);
  assert.deepEqual(snapshot.overlay.members, snapshot.party.map(({ instanceId }) => instanceId));
  if (enabledActions.includes("tutorials")) {
    snapshot = await waitForState(
      (value) => value.tutorial?.key === "Tutorial4" && value.tutorial.okReady,
      "first editable Monster Management entry did not present Tutorial4",
    );
    assert.equal(snapshot.tutorial.image, "monsterChange1.png");
    assert.equal(snapshot.tutorial.pageCount, 2);
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.tutorial?.key === "Tutorial4" && value.tutorial.page === 1,
      "Tutorial4 did not retain its second raster page",
    );
    assert.equal(snapshot.tutorial.image, "monsterChange2.png");
    await page.keyboard.press("Enter");
    await waitForState(
      (value) => value.tutorial == null && value.overlay?.screen === "partyEditor",
      "Tutorial4 did not return to the retained party editor",
    );
  }
  await clickLabel(`editorCard:${snapshot.overlay.members[0]}`);
  snapshot = await waitForState(
    (value) => value.overlay?.popups?.depth === 1,
    "monster information popup did not open",
  );
  await advance(250);
  assert.equal(snapshot.overlay.popups.depth, 1);
  assert(snapshot.overlay.popups.stack[0].buttons.includes("Convert To Soul Stone"));
  await page.screenshot({ path: path.join(outputDir, "party-editor-info-popup.png"), timeout: 120_000 });
  await page.keyboard.press("Escape");
  await waitForState(
    (value) => value.overlay?.popups?.depth === 0,
    "Esc did not dismiss the nested monster information popup",
  );
  await page.keyboard.press("Escape");
  await waitForState((value) => value.overlay === null, "Esc did not close the party editor");

  if (enabledActions.includes("tutorials")) {
    await clickLabel("worldMenuButton");
    await waitForState((value) => value.menu !== null, "MasterMenu did not reopen for Tutorials");
    await clickLabel("worldMenu:tutorials");
    snapshot = await waitForState(
      (value) => value.overlay?.kind === "tutorials",
      "Tutorial topics menu did not open",
    );
    assert.equal(snapshot.overlay.title, "Tutorial Topics");
    assert.deepEqual(
      snapshot.overlay.columns.map((column) => column.map(({ label }) => label)),
      [
        ["Battle", "Worldmap", "Monster Management", "Insert Soulstone", "Combine Monsters"],
        ["Capturing", "Dungeon", "Make Soulstone", "Spirit", "Back"],
      ],
    );
    await clickLabel("tutorialMenu:Tutorial4");
    snapshot = await waitForState(
      (value) => value.overlay?.tutorial?.key === "Tutorial4",
      "Tutorial4 replay did not open above the retained topic menu",
    );
    assert.equal(snapshot.overlay.tutorial.image, "monsterChange1.png");
    await page.keyboard.press("Enter");
    await waitForState(
      (value) => value.overlay?.tutorial?.page === 1,
      "Tutorial4 replay did not advance to page 2",
    );
    await page.keyboard.press("Enter");
    await waitForState(
      (value) => value.overlay?.kind === "tutorials" && value.overlay.tutorial === null,
      "Tutorial4 replay did not return to the retained topic menu",
    );
    await clickLabel("tutorialMenu:back");
    await waitForState((value) => value.overlay === null, "Tutorial Back did not close the catalog");
  }

  snapshot = await state();
  await clickLabel("worldMenuButton");
  snapshot = await waitForState((value) => value.menu !== null, "MasterMenu did not reopen");
  if (enabledActions.includes("worldMap")) {
    await clickLabel("worldMenu:worldMap");
    snapshot = await waitForState(
      (value) => value.overlay?.currentWorld !== undefined,
      "BigMap did not open",
    );
    await advance(1500);
    assert.equal(snapshot.overlay.currentWorld, "World_1-1");
    assert.equal(snapshot.overlay.hiddenWorlds.length, 15);
    await page.keyboard.press("Escape");
    await advance(1000);
    await waitForState((value) => value.overlay === null, "Esc did not close BigMap");
  } else {
    // Maintained clean-room packages may omit the optional source BigMap structural role.
    await clickLabel("worldMenu:close");
  }

  snapshot = await state();
  await clickLabel("worldMenuButton");
  await waitForState((value) => value.menu !== null, "MasterMenu did not open for Options");
  await clickLabel("worldMenu:options");
  snapshot = await waitForState(
    (value) => Array.isArray(value.overlay?.rows),
    "Options popup did not open",
  );
  assert.deepEqual(snapshot.overlay.rows.map((row) => row.name), ["music", "sound", "display", "text"]);
  assert.equal(snapshot.overlay.fullscreenAction, "shown");
  assert(
    await boundsForLabel("popupButton:Fullscreen"),
    "Options popup omitted its supported Fullscreen button",
  );
  assert([0, 0.25, 0.5, 0.75, 1].includes(snapshot.overlay.settings.sound));
  assert([0, 0.25, 0.5, 0.75, 1].includes(snapshot.overlay.settings.music));
  const initialGameplayMode = snapshot.mode;
  const initialDisplayMode = snapshot.displayMode;
  const nextDisplayMode = initialDisplayMode === "iphone" ? "ipad" : "iphone";
  await clickLabel(`optionsChoice:display:${nextDisplayMode}`);
  snapshot = await waitForState(
    (value) => value.overlay?.settings?.displayMode === nextDisplayMode,
    "Options did not persist the alternate display mode",
  );
  assert.equal(snapshot.overlay.appliesOnClose, true);
  await page.keyboard.press("Escape");
  snapshot = await waitForState(
    (value) =>
      value.displayMode === nextDisplayMode &&
      value.mode === initialGameplayMode &&
      value.overlay == null,
    "Options did not rebuild and resume the selected save at the new display mode",
    320,
  );
  assert.notEqual(snapshot.displayMode, initialDisplayMode);
  assert.deepEqual(
    snapshot.stagePx,
    nextDisplayMode === "iphone" ? { w: 960, h: 640 } : { w: 1024, h: 768 },
  );
  assert.deepEqual(
    snapshot.screenPt,
    nextDisplayMode === "iphone" ? { w: 480, h: 320 } : { w: 512, h: 384 },
  );
  assert.equal(
    await page.locator("#content-title").count(),
    0,
    "applying Options returned to the archive picker",
  );
  await page.screenshot({ path: path.join(outputDir, "display-mode-applied.png"), timeout: 120_000 });

  await clickLabel("worldMenuButton");
  snapshot = await waitForState((value) => value.menu !== null, "MasterMenu did not open for Town Portal");
  await clickLabel("worldMenu:townPortal");
  snapshot = await waitForState(
    (value) => value.mode === "town" && value.town?.name,
    "Town Portal did not auto-enter the saved/default town",
    240,
  );
  assert.equal(snapshot.menu, null);
  await waitForState(
    (value) => value.mode === "town" && value.town?.exitEnabled && value.overlay == null,
    "Town Portal destination did not become interactive",
  );
  await advance(1_500);
  await page.screenshot({ path: path.join(outputDir, "town-portal-arrival.png"), timeout: 120_000 });

  // MainMenuMenuItem: exact warning, cancel stays in play, confirm rebuilds the title shell while
  // retaining the already-imported tab-local archive.
  await page.keyboard.press("Escape");
  await waitForState((value) => value.menu !== null, "MasterMenu did not open for Main Menu");
  await clickLabel("worldMenu:mainMenu");
  snapshot = await waitForState(
    (value) => value.overlay?.kind === "popup" &&
      value.overlay.popups.stack[0]?.buttons.join(",") === "Yes,No",
    "Main Menu warning did not present its Yes/No branches",
  );
  await clickLabel("popupButton:No");
  await waitForState(
    (value) => value.mode === "town" && value.overlay === null,
    "Main Menu warning No branch did not return to the live town",
  );
  await page.keyboard.press("Escape");
  await waitForState((value) => value.menu !== null, "MasterMenu did not reopen for Main Menu");
  await clickLabel("worldMenu:mainMenu");
  await waitForState(
    (value) => value.overlay?.kind === "popup",
    "Main Menu warning did not reopen",
  );
  await clickLabel("popupButton:Yes");
  snapshot = await waitForState(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "confirmed Main Menu did not rebuild the source title shell",
    320,
  );
  assert.equal(snapshot.startup.phase, "title");
  await page.screenshot({ path: path.join(outputDir, "main-menu-title.png"), timeout: 120_000 });
  await page.keyboard.press("Enter");
  await waitForState(
    (value) => value.mode === "start" && value.startup?.phase === "save-select",
    "rebuilt title was visible but not interactive",
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("world-menu: PASS (source layout + Main Menu warning/restart + contextual controls)");
} finally {
  await browser.close();
}
