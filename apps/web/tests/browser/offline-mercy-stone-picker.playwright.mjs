// Mercy Stone presentation contract: the external package's stone is an ordinary member of the
// source-paged Insert Soul Stone list.
//
// The shipped row body describes a stone by its positive stat strip and refuses one that has none,
// so the package supplies its own body for this element through the flow's row seam. Everything
// around it must still be the shipped screen: the paged wrapper, the selection pulse, the
// nearest-hit arbitration, and the Drop/Insert/Info actions. This scenario pins one ordinary Fire
// stone next to one Mercy Stone so the two rows are compared in the same list, then walks
// select -> info -> insert.
//
// Run with an operator-owned compatible archive and a built package:
//   pnpm mods:examples
//   $env:DIB_CONTENT_ARCHIVE="$PWD\Dragon_Island_Blue_1.1.0.ipa"
//   $env:DIB_WEB_URL="http://localhost:5273"
//   node apps/web/tests/browser/offline-mercy-stone-picker.playwright.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5199";
const displayMode = process.env.DIB_PARTY_DISPLAY_MODE ?? "ipad";
if (displayMode !== "iphone" && displayMode !== "ipad") {
  throw new Error(`DIB_PARTY_DISPLAY_MODE must be "iphone" or "ipad", got ${JSON.stringify(displayMode)}`);
}
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const mod = path.resolve(repositoryRoot, "examples/mods/dist/mercy-stone.dibmod");
assert(fs.existsSync(mod), "Run pnpm mods:examples before this scenario.");
const outputDir = path.resolve(repositoryRoot, `output/offline-mercy-stone-picker-${displayMode}`);
fs.mkdirSync(outputDir, { recursive: true });
for (const name of [
  "01-picker-mercy-row.png",
  "02-mercy-stone-rule-popup.png",
  "03-editor-with-equipped-mercy-stone.png",
  "failure.png",
]) fs.rmSync(path.join(outputDir, name), { force: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

let page;
try {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });

  await page.addInitScript((mode) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: mode,
      textResolutionMode: "modern",
      sound: 0.25,
      music: 0.5,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1"];
    window.__DIB_TEST_WORLD_SEED__ = 20260824;
    // One ordinary stone and one Mercy Stone in the same owned pool: the shipped builder still
    // owns the Fire row's stat strip while the package owns the Mercy row's name.
    window.__DIB_TEST_WORLD_PARTY__ = {
      size: 2,
      battingOrderSize: 2,
      levelRange: [5, 5],
      members: [
        { shortType: "FireCub", level: 5 },
        { shortType: "SnowCub", level: 5 },
      ],
      soulStones: [
        { element: "Fire", level: 5, sourceType: "FireCub" },
        { element: "Mercy", level: 1 },
      ],
    };
  }, displayMode);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page, undefined, { modArchives: [mod] });
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);
  const waitForState = async (predicate, description, iterations = 240) => {
    for (let i = 0; i < iterations; i++) {
      const snapshot = await state();
      if (predicate(snapshot)) {
        await advance(25);
        return await state();
      }
      // AssetLibrary fetch/decode continuations need real event-loop time; a tight advanceTime
      // loop can strand a healthy scene in its async building phase.
      await page.waitForTimeout(50);
      await advance(25);
    }
    throw new Error(
      `${description}; browser errors: ${errors.join(" | ") || "none"}; ` +
      `final state: ${JSON.stringify(await state())}`,
    );
  };
  const screenshot = async (name) => {
    // Popup.show mounts before its source 0.2s scaleY action finishes; settle it so the frame
    // documents the final composition.
    for (let i = 0; i < 9; i++) await advance(25);
    await page.screenshot({ path: path.join(outputDir, name), timeout: 120_000 });
  };

  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "game canvas must have CSS bounds");

  // Pixi getBounds() is already canvas-global (fixed-stage mount and letterboxing included), so
  // only the canvas element's page origin is added.
  const nodeReport = (label) => page.evaluate((wanted) => {
    const root = window.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (current.visible === false || current.renderable === false) return false;
      }
      return true;
    };
    const matches = [];
    const visit = (node) => {
      if (node.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        matches.push({ bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height } });
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return matches.at(-1) ?? null;
  }, label);
  const stableBounds = async (label) => {
    let previous = null;
    for (let i = 0; i < 80; i++) {
      const current = await nodeReport(label);
      if (
        current !== null && previous !== null &&
        current.bounds.w > 0 && current.bounds.h > 0 &&
        Math.abs(current.bounds.x - previous.bounds.x) < 0.25 &&
        Math.abs(current.bounds.y - previous.bounds.y) < 0.25 &&
        Math.abs(current.bounds.w - previous.bounds.w) < 0.25 &&
        Math.abs(current.bounds.h - previous.bounds.h) < 0.25
      ) return current.bounds;
      previous = current;
      await page.waitForTimeout(25);
      await advance(25);
    }
    throw new Error(
      `visible Pixi target ${label} did not settle; last ${JSON.stringify(previous)}; ` +
      `browser errors: ${errors.join(" | ") || "none"}`,
    );
  };
  const clickLabel = async (label) => {
    const bounds = await stableBounds(label);
    await page.mouse.click(
      canvasBox.x + bounds.x + bounds.w / 2,
      canvasBox.y + bounds.y + bounds.h / 2,
    );
  };
  const visibleTexts = () => page.evaluate(() => {
    const values = [];
    const visit = (node, ancestorsVisible) => {
      const visible = ancestorsVisible && node.visible !== false && node.renderable !== false;
      if (visible && typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child, visible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return values;
  });

  const popupButtonLabels = () => page.evaluate(() => {
    const labels = [];
    const visit = (node, ancestorsVisible) => {
      const visible = ancestorsVisible && node.visible !== false && node.renderable !== false;
      if (visible && typeof node.label === "string" && node.label.startsWith("popupButton:")) {
        labels.push(node.label);
      }
      for (const child of node.children ?? []) visit(child, visible);
    };
    visit(window.__PIXI_APP__.stage, true);
    return labels;
  });

  // One row report per owned stone: which item frame it draws, and whether the row's body is the
  // shipped stat strip or the package's name.
  const pickerRows = () => page.evaluate(() => {
    const root = window.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    const rows = [];
    const visit = (node) => {
      const label = typeof node.label === "string" ? node.label : "";
      if (label.startsWith("stonePickerRow:")) {
        const row = {
          token: label.slice("stonePickerRow:".length),
          items: [],
          stats: [],
          names: [],
          highlights: [],
          bodyLabels: [],
          bounds: (() => {
            const value = node.getBounds();
            return { x: value.x, y: value.y, w: value.width, h: value.height };
          })(),
        };
        const walk = (child) => {
          const childLabel = typeof child.label === "string" ? child.label : "";
          if (childLabel.startsWith("stonePickerItem:")) row.items.push(childLabel);
          if (childLabel.startsWith("stonePickerStat:")) row.stats.push(childLabel);
          if (childLabel.startsWith("stonePickerName:")) {
            row.names.push({ label: childLabel, text: child.text ?? null });
          }
          if (childLabel.startsWith("stonePickerHighlight:")) row.highlights.push(childLabel);
          if (childLabel.startsWith("stonePickerRowDisplay:")) row.bodyLabels.push(childLabel);
          for (const grandchild of child.children ?? []) walk(grandchild);
        };
        for (const child of node.children ?? []) walk(child);
        rows.push(row);
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return rows;
  });
  const highlightAlphas = () => page.evaluate(() => {
    const root = window.__PIXI_APP__?.stage;
    const values = {};
    const visit = (node) => {
      const label = typeof node.label === "string" ? node.label : "";
      if (label.startsWith("stonePickerHighlight:")) {
        values[label.slice("stonePickerHighlight:".length)] = node.alpha;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return values;
  });

  await waitForState((value) => value.startup?.phase === "title", "title did not become interactive");
  await page.keyboard.press("Enter");
  let snapshot = await waitForState(
    (value) => value.startup?.phase === "save-select" || value.mode === "world" || value.mode === "town",
    "title did not advance into the world session",
  );
  if (snapshot.startup?.phase === "save-select") {
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.mode === "world" || value.mode === "town",
      "save selection did not enter the world session",
    );
  }
  for (let index = 0; snapshot.mode === "town" && index < 20; index++) {
    await advance(550);
    if ((await nodeReport("guildQuestChat")) === null) break;
    await clickLabel("guildQuestChat");
    snapshot = await state();
  }
  if (snapshot.mode === "town") {
    await waitForState((value) => value.overlay === null, "initial town chat did not finish");
    await advance(1_100);
    await clickLabel("town:First_City:exit");
  }
  await waitForState((value) => value.mode === "world", "world scene did not open");
  snapshot = await waitForState(
    (value) => !value.chrome.heroXp.expanded && !value.chrome.heroXp.moving,
    "world chrome did not settle",
  );
  assert.equal(snapshot.displayMode, displayMode);

  await clickLabel("worldMenuButton");
  await waitForState((value) => value.menu !== null, "MasterMenu did not open");
  await clickLabel("worldMenu:monsters");
  snapshot = await waitForState(
    (value) => value.overlay?.screen === "partyEditor",
    "style-1 party editor did not open",
  );
  for (let index = 0; snapshot.tutorial?.key === "Tutorial4" && index < 3; index++) {
    snapshot = await waitForState(
      (value) => value.tutorial?.key === "Tutorial4" && value.tutorial.okReady === true,
      "Tutorial4 page did not become dismissible",
    );
    const priorPage = snapshot.tutorial.page;
    await page.keyboard.press("Enter");
    snapshot = await waitForState(
      (value) => value.tutorial === undefined || value.tutorial.page !== priorPage,
      "Tutorial4 did not advance",
    );
  }
  assert.equal(snapshot.tutorial, undefined, "Tutorial4 did not return to the party editor");
  assert.equal(
    snapshot.overlay.ownedSoulStones,
    2,
    `the pinned Fire and Mercy stones are not both in the pool: ${JSON.stringify(snapshot.overlay)}`,
  );

  await clickLabel("partyEditorControl:soulStoneButton");
  await waitForState(
    (value) => value.overlay?.popups?.depth === 1 &&
      value.overlay.popups.stack[0].contentLabel === "soulStonePicker",
    "source-paged Insert Soul Stone display did not open",
  );
  await stableBounds("soulStonePicker:items");
  await screenshot("01-picker-mercy-row.png");

  const rows = await pickerRows();
  assert.equal(rows.length, 2, `the picker did not list both owned stones: ${JSON.stringify(rows)}`);
  const [fireRow, mercyRow] = rows;

  // The shipped body still owns the ordinary stone.
  assert.deepEqual(fireRow.items, ["stonePickerItem:soul-stone-1:Fire"]);
  assert(
    fireRow.stats.length > 0,
    `the Fire row lost its shipped stat strip: ${JSON.stringify(fireRow)}`,
  );
  assert.deepEqual(fireRow.names, [], `the Fire row must not carry a name row: ${JSON.stringify(fireRow)}`);

  // The package's body replaces the strip it cannot fill, for its element only.
  assert.deepEqual(mercyRow.items, ["stonePickerItem:soul-stone-2:Mercy"]);
  assert.deepEqual(
    mercyRow.stats,
    [],
    `a stone with no positive bonuses must show no stat cells: ${JSON.stringify(mercyRow)}`,
  );
  assert.deepEqual(mercyRow.names, [
    { label: "stonePickerName:soul-stone-2", text: "Mercy Stone" },
  ]);
  // The paged screen, not the package, still owns the row wrapper and its selection pulse.
  assert.deepEqual(mercyRow.highlights, ["stonePickerHighlight:soul-stone-2"]);
  assert.deepEqual(mercyRow.bodyLabels, ["stonePickerRowDisplay:soul-stone-2"]);
  assert(
    mercyRow.bounds.w > 0 && mercyRow.bounds.h > 0,
    `the Mercy row has no rendered extent: ${JSON.stringify(mercyRow)}`,
  );
  // Row heights legitimately differ (a name body is shorter than a stat-cell body); what the
  // paged column owns is the stacking, so the rows must not collide or reorder.
  assert(
    mercyRow.bounds.y >= fireRow.bounds.y + fireRow.bounds.h - 1,
    `the picker column overlapped its rows: ${JSON.stringify({ fireRow, mercyRow })}`,
  );

  // First tap selects and pulses through the shipped nearest-hit arbitration.
  await clickLabel("stonePickerRow:soul-stone-2");
  for (let index = 0; index < 8; index++) await advance(60);
  const alphas = await highlightAlphas();
  assert(
    alphas["soul-stone-2"] > 0,
    `selecting the Mercy row did not pulse the shipped highlight: ${JSON.stringify(alphas)}`,
  );
  assert.equal(
    alphas["soul-stone-1"],
    0,
    `an unselected shipped row was highlighted: ${JSON.stringify(alphas)}`,
  );

  const pickerButtons = await popupButtonLabels();
  assert(
    pickerButtons.includes("popupButton:Insert"),
    `the picker lost its shipped actions: ${JSON.stringify(pickerButtons)}`,
  );

  // Second tap opens item info. A stat table cannot describe this stone, so the package routes it
  // to the flow's own message popup instead.
  await clickLabel("stonePickerRow:soul-stone-2");
  await waitForState(
    (value) => value.overlay?.popups?.depth === 2,
    "the Mercy Stone info popup did not stack over the picker",
  );
  await screenshot("02-mercy-stone-rule-popup.png");
  const infoTexts = await visibleTexts();
  assert(
    infoTexts.includes("Mercy Stone"),
    `the info popup is not titled for the stone: ${JSON.stringify(infoTexts)}`,
  );
  assert(
    infoTexts.some((text) => text.includes("can never land a killing blow")),
    `the info popup did not state the package's rule: ${JSON.stringify(infoTexts)}`,
  );
  // Tree order is zIndex-sorted and the picker asked for a high modal band, so its own Drop/Insert
  // buttons can sort after the nested popup's. Address the new button by exclusion instead.
  const okLabel = (await popupButtonLabels())
    .find((label) => !pickerButtons.includes(label)) ?? null;
  assert(okLabel, "the info popup exposed no button to dismiss");
  await clickLabel(okLabel);
  await waitForState(
    (value) => value.overlay?.popups?.depth === 1,
    "dismissing the rule popup did not return to the picker",
  );

  if (process.env.DIB_BROWSER_TRACE === "1") {
    console.log("after rule popup", JSON.stringify(await page.evaluate(() => {
      const labels = [];
      const visit = (node, ancestorsVisible) => {
        const visible = ancestorsVisible && node.visible !== false && node.renderable !== false;
        if (typeof node.label === "string" && node.label.startsWith("popupButton:")) {
          labels.push({ label: node.label, visible, own: node.visible });
        }
        for (const child of node.children ?? []) visit(child, visible);
      };
      visit(window.__PIXI_APP__.stage, true);
      return labels;
    })), JSON.stringify((await state()).overlay.popups));
  }

  // Insert equips the selection through the shipped action and closes the one retained popup.
  await clickLabel("popupButton:Insert");
  snapshot = await waitForState(
    (value) => value.overlay?.popups?.depth === 0,
    "Insert did not close the Insert Soul Stone display",
  );
  assert.equal(
    snapshot.overlay.ownedSoulStones,
    1,
    `Insert did not consume the Mercy Stone: ${JSON.stringify(snapshot.overlay)}`,
  );
  await screenshot("03-editor-with-equipped-mercy-stone.png");
  // The stone is durable party state now, and the card badge resolves its baked item frame — a
  // missing texture there throws out of PartyEditorNode rather than drawing nothing.
  const holder = snapshot.party.find(
    ({ instanceId }) => instanceId === snapshot.overlay.centeredBattingId,
  );
  assert(holder, `the centered holder is missing from the projection: ${JSON.stringify(snapshot.party)}`);
  assert.deepEqual(
    { element: holder.soulStone?.element, level: holder.soulStone?.level },
    { element: "Mercy", level: 1 },
    `Insert did not equip the Mercy Stone on the centered card: ${JSON.stringify(holder)}`,
  );
  assert.deepEqual(errors, [], `browser reported errors: ${errors.join(" | ")}`);
  console.log("offline Mercy Stone picker scenario passed", {
    displayMode,
    mod: mod.split(/[\/]/).at(-1),
    holder: holder.shortType,
    output: outputDir,
  });
} catch (error) {
  if (page !== undefined) {
    await page.screenshot({ path: path.join(outputDir, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
