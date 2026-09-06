

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const displayMode = process.env.DIB_DISPLAY_MODE ?? "iphone";
assert(
  displayMode === "iphone" || displayMode === "ipad",
  `DIB_DISPLAY_MODE must be iphone or ipad, got ${displayMode}`,
);
const outputDir = path.resolve("output/intro-chat");
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 17;
    window.__DIB_TEST_BATTLE_SEED__ = 5;
  });
  await page.addInitScript((mode) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: mode,
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
  }, displayMode);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(1);
  };
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  const geometry = await stageGeometry(page, box);
  for (let i = 0; i < 200 && (await state()).startup?.phase !== "title"; i++) await advance(25);
  assert.equal((await state()).startup?.phase, "title", "startup title did not become interactive");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 480; i++) {
    const snapshot = await state();
    if (
      snapshot.mode === "town" ||
      snapshot.startup?.phase === "save-select" ||
      snapshot.startup?.phase === "new-game-plot"
    ) break;
    await advance(25);
  }
  if ((await state()).startup?.phase === "save-select") {
    const startup = await state();
    const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `save slot 1 unavailable: ${JSON.stringify(startup.startup)}`);
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
  }
  if ((await state()).startup?.phase === "new-game-plot") {
    // PlotGameFlowEvent cannot be skipped for its first two seconds.
    await advance(2_050);
    await page.keyboard.press("Enter");
    for (let i = 0; i < 480 && (await state()).startup?.phase !== "pick-dragon"; i++) {
      await advance(25);
    }
    assert.equal((await state()).startup?.phase, "pick-dragon");
    await page.keyboard.press("1");
  }
  for (let i = 0; i < 480; i++) {
    const snapshot = await state();
    if (
      snapshot.mode === "town" &&
      typeof snapshot.currentPoi === "string" &&
      snapshot.locked === false
    ) break;
    await advance(25);
  }

  const clickPoi = async (name) => {
    const snapshot = await state();
    const poi = snapshot.pois.find((candidate) => candidate.name === name);
    assert(poi, `missing POI ${name}`);
    const stateSpriteCenter = await page.evaluate((position) => {
      let result = null;
      const visit = (node) => {
        if (
          result === null &&
          Math.abs((node.position?.x ?? Number.NaN) - position.x) < 1e-3 &&
          Math.abs((node.position?.y ?? Number.NaN) - position.y) < 1e-3
        ) {
          const stateSprite = (node.children ?? []).find(
            (child) => child.visible && child.cursor === "pointer" && child.texture !== undefined,
          );
          if (stateSprite !== undefined) {
            const bounds = stateSprite.getBounds();
            result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
          }
        }
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return result;
    }, poi.position);
    if (stateSpriteCenter !== null) {
      // Pixi bounds are already canvas-global; only add the canvas's CSS origin.
      await page.mouse.click(box.x + stateSpriteCenter.x, box.y + stateSpriteCenter.y);
      return;
    }
    const fallback = geometry.toCss(poi.position);
    await page.mouse.click(fallback.x, fallback.y);
  };
  const nodeCenter = (label) => page.evaluate((wanted) => {
    let result = null;
    const visit = (node) => {
      if (result === null && node.label === wanted) {
        const bounds = node.getBounds();
        result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return result;
  }, label);
  const clickNode = async (label) => {
    const point = await nodeCenter(label);
    assert(point, `missing ${label}`);
    await page.mouse.click(box.x + point.x, box.y + point.y);
  };
  const waitFor = async (predicate, label, frames = 500) => {
    for (let i = 0; i < frames; i++) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${label}: ${JSON.stringify(await state())}`);
  };

  let snapshot = await state();
  assert.equal(snapshot.currentPoi, "First_City");
  assert.equal(
    snapshot.pois.find((poi) => poi.name === "1-1_Forest_1")?.state,
    3,
    "the Forest shortcut must stay gated before completing 1-1_Field_1",
  );

  snapshot = await waitFor(
    (value) => value.mode === "town" &&
      value.overlay?.kind === "townEnterChat" &&
      value.overlay?.chatName === "LeslieIntro1",
    "fresh First City did not present LeslieIntro1",
  );
  for (let i = 0; i < 200 && !(await nodeCenter("guildQuestChat")); i++) await advance(25);
  assert(await nodeCenter("guildQuestChat"), "LeslieIntro1 state published before its chat mounted");
  // Step past the 500ms just-launched swallow gate; exact float sums can land infinitesimally
  // below the threshold depending on boot duration.
  await advance(525);
  const chat = await page.evaluate(() => {
    const find = (label) => {
      let found = null;
      const visit = (node) => {
        if (found === null && node.label === label) found = node;
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      return found;
    };
    const root = find("guildQuestChat");
    const dim = find("guildQuestChatDim");
    const text = find("guildQuestChatText");
    const background = find("guildQuestChatBackground");
    if (!root || !dim || !text || !background) {
      throw new Error("missing shared ChainedTextLabel presentation nodes");
    }
    const visibleText = [];
    const runs = [];
    const visitText = (node) => {
      if (typeof node.text === "string") visibleText.push(node.text);
      if (typeof node.label === "string" && node.label.startsWith("coloredBitmapRun:")) {
        const bounds = node.getBounds();
        runs.push({
          label: node.label,
          text: node.text,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
        });
      }
      for (const child of node.children ?? []) visitText(child);
    };
    visitText(text);
    const textBounds = text.getBounds();
    const backgroundBounds = background.getBounds();
    return {
      dimAlpha: dim.alpha,
      visibleText: visibleText.join(""),
      runs,
      textBounds: {
        x: textBounds.x, y: textBounds.y, w: textBounds.width, h: textBounds.height,
      },
      backgroundBounds: {
        x: backgroundBounds.x,
        y: backgroundBounds.y,
        w: backgroundBounds.width,
        h: backgroundBounds.height,
      },
    };
  });
  await page.screenshot({
    path: path.join(outputDir, `leslie-intro-${displayMode}.png`),
    timeout: 120_000,
  });
  assert(Math.abs(chat.dimAlpha - 200 / 255) < 1e-6, `wrong chat dim: ${chat.dimAlpha}`);
  assert(
    chat.runs.some((run) => run.label === "coloredBitmapRun:00ff00"),
    JSON.stringify(chat.runs),
  );
  assert(!chat.visibleText.includes("^#") && !chat.visibleText.includes("^^"), chat.visibleText);
  assert(chat.textBounds.x >= chat.backgroundBounds.x);
  assert(chat.textBounds.y >= chat.backgroundBounds.y);
  assert(chat.textBounds.x + chat.textBounds.w <= chat.backgroundBounds.x + chat.backgroundBounds.w);
  assert(chat.textBounds.y + chat.textBounds.h <= chat.backgroundBounds.y + chat.backgroundBounds.h);
  for (let i = 0; i < chat.runs.length; i++) {
    for (let j = i + 1; j < chat.runs.length; j++) {
      const a = chat.runs[i];
      const b = chat.runs[j];
      const overlapX = Math.min(a.bounds.x + a.bounds.w, b.bounds.x + b.bounds.w) -
        Math.max(a.bounds.x, b.bounds.x);
      const overlapY = Math.min(a.bounds.y + a.bounds.h, b.bounds.y + b.bounds.h) -
        Math.max(a.bounds.y, b.bounds.y);
      assert(
        overlapX <= 1e-3 || overlapY <= 1e-3,
        `colored bitmap runs overlap: ${JSON.stringify({ a, b, overlapX, overlapY })}`,
      );
    }
  }

  await clickNode("guildQuestChat");
  await waitFor(
    (value) => value.mode === "town" && value.overlay === null,
    "LeslieIntro1 did not dismiss",
  );
  await clickNode("town:First_City:exit");
  await waitFor(
    (value) => value.mode === "world" && !value.locked,
    "First City did not return to the world",
  );
  snapshot = await state();
  if (snapshot.tutorial?.key === "Tutorial2") {
    await waitFor(
      (value) => value.tutorial?.key === "Tutorial2" && value.tutorial.okReady,
      "field movement tutorial did not become dismissible",
    );
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.tutorial === undefined,
      "field movement tutorial did not dismiss",
    );
  }
  assert.equal(
    snapshot.pois.find((poi) => poi.name === "1-1_Turtorial_Hut_1")?.state,
    4,
    "leaving the completed starting town must expose the Tutorial Hut route",
  );
  await clickPoi("1-1_Turtorial_Hut_1");
  await waitFor(
    (value) => value.mode === "world" && value.currentPoi === "1-1_Turtorial_Hut_1" && !value.locked,
    "Tutorial Hut walk did not finish",
  );
  // The town-return nameplate is a stage-global notification that can still be mid-sequence when
  // the short Tutorial Hut walk settles. Let that presentation finish before targeting Field 1.
  await advance(3_000);
  await waitFor(
    (value) => value.notifications?.namePlate?.visible !== true,
    "town-return nameplate did not finish",
  );
  await clickPoi("1-1_Field_1");
  snapshot = await waitFor(
    (value) => value.mode === "battle",
    "Leslie staged encounter did not launch",
    800,
  );
  snapshot = await waitFor(
    (value) => value.activePopup === "plotTutorial" || value.activePopup === "encounterChat",
    "first-battle prelude did not present a tutorial or encounter chat",
    800,
  );
  while (snapshot.tutorial != null) {
    snapshot = await waitFor(
      (value) => value.tutorial == null || value.tutorial.okReady,
      `${snapshot.tutorial.key} did not become dismissible`,
      480,
    );
    if (snapshot.tutorial == null) break;
    const previousPage = snapshot.tutorial.page;
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.tutorial == null || value.tutorial.page !== previousPage,
      `${snapshot.tutorial.key} did not advance`,
      480,
    );
  }
  snapshot = await waitFor(
    (value) => value.mode === "battle" && value.activePopup === "encounterChat",
    "Leslie staged encounter chat did not open",
    800,
  );
  assert.equal(snapshot.encounter.startChat, "Leslie");
  assert.equal(snapshot.presentation.state, "startEvent");
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(
    `intro-chat-progression: PASS (${displayMode}; non-overlapping Leslie color runs + ` +
      "town intro + fresh gate + source dim)",
  );
} finally {
  await browser.close();
}
