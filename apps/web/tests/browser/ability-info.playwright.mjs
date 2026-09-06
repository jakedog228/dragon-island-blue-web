import assert from "node:assert/strict";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter } from "./fixtures.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const readState = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await pinEncounter(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).startup?.phase === "title",
    undefined,
    { timeout: 30_000 },
  );

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).presentation?.state === "awaitingPlayerChoice",
    undefined,
    { timeout: 30_000 },
  );
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.panelVisible && state.abilityInfoButtons?.length > 0;
  }, undefined, { timeout: 15_000 });

  const before = await readState(page);
  assert(before.abilityInfoButtons.length > 0, "player panel must expose an info button for each rendered move");
  for (const button of before.abilityInfoButtons) {
    assert.equal(button.center.x - button.tuCenter.x, 30, `slot ${button.slot} info center must be 30pt right of slot/TU center`);
    assert.equal(button.center.y, button.tuCenter.y, `slot ${button.slot} info and TU centers must share a y coordinate`);
  }

  const { toCss } = await stageGeometry(page, box);
  const first = before.abilityInfoButtons[0];
  const click = toCss(first.center);
  await page.mouse.click(click.x, click.y);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup?.startsWith("ability:"));
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).abilityInfo?.extraDescription?.includes("Time Units(TU):"));
  await page.waitForFunction(() => {
    const values = [];
    const visit = (node) => {
      if (typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return values.some((text) => text.includes("Time Units(TU):"));
  }, undefined, { timeout: 15_000 });

  const opened = await readState(page);
  assert.equal(opened.activePopup, `ability:${opened.abilityInfo.name}`);
  assert.match(opened.abilityInfo.extraDescription, /targets 1 foe/);
  assert.match(opened.abilityInfo.extraDescription, /Deals \d+(?:-\d+)? \w+ damage \(Physical\)/);
  assert.match(opened.abilityInfo.extraDescription, /Time Units\(TU\): \d+/);

  const rendered = await page.evaluate(({ name, description }) => {
    const values = [];
    let nameBounds = null;
    let descriptionBounds = null;
    const visit = (node) => {
      if (typeof node.text === "string") {
        values.push(node.text);
        const bounds = node.getBounds();
        if (node.text === name) nameBounds = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
        if (node.text === description) descriptionBounds = { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return { values, nameBounds, descriptionBounds };
  }, { name: opened.abilityInfo.name, description: opened.abilityInfo.extraDescription });
  assert(rendered.values.includes(opened.abilityInfo.name), "popup must render the localized move name");
  assert(rendered.values.includes(opened.abilityInfo.extraDescription), "popup must render the generated native description");
  assert(rendered.nameBounds && rendered.descriptionBounds);
  assert(
    rendered.nameBounds.y + rendered.nameBounds.h <= rendered.descriptionBounds.y,
    "move name must sit above, not overlap, the generated description",
  );

  await page.waitForTimeout(500);
  await page.screenshot({ path: "output/ability-info-popup.png" });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);

  // Numeric shortcuts activate the exact same rendered ability slot. This fixture's first move is
  // a one-enemy move, so it must enter the ordinary picker and Esc must restore the panel.
  await page.keyboard.press(String(first.slot));
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).picking === true);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => {
    const snapshot = JSON.parse(window.render_game_to_text());
    return snapshot.picking === false && snapshot.panelVisible === true;
  });
  assert.deepEqual(errors, []);
  console.log(`ability-info: PASS (${opened.abilityInfo.name}; popup Esc + numeric slot + picker Esc)`);
} finally {
  await browser.close();
}
