// Browser proof for the popup-title, acting-card, target-outline, and cancel-arrow regressions.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const outputDir = path.resolve("output/visual-fidelity-regressions");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

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
  window.__DIB_TEST_BATTLE_SEED__ = 7;
  window.__DIB_TEST_ENCOUNTER__ = {
    backgroundKey: "ForestCombat",
    allowRetreat: true,
    playerTeam: [{ shortType: "FireCub", level: 5 }],
    enemyTeam: [{ shortType: "SnowCub", level: 5 }],
  };
});

const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
const assertClose = (actual, expected, message) => {
  assert(Math.abs(actual - expected) < 1e-9, message ?? `${actual} != ${expected}`);
};

try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  while ((await state()).mode !== "start") await advance(50);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  for (let i = 0; i < 1200 && !(await state()).panelVisible; i += 1) {
    await advance(25);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  const geometry = await stageGeometry(page, canvasBox);

  const initial = await state();
  assert.equal(initial.presentation?.state, "awaitingPlayerChoice", `battle panel did not become ready: ${JSON.stringify(initial)}`);
  const card = initial.actingCardLayout;
  assert(card, "missing acting-card layout state");
  const expectedFit = Math.min(
    1,
    card.fitBox.w / card.monsterTexturePointSize.w,
    card.fitBox.h / card.monsterTexturePointSize.h,
  );
  assert(Math.abs(card.monsterCocosScale - expectedFit) < 1e-9);
  assert.equal(card.hpContentSize.h, 13, "HP contentSize must be the backing, not child bounds");
  const expectedInset = initial.displayMode === "ipad" ? 2.5 : 5;
  assert.equal(card.nodePosition.x, expectedInset);
  assertClose(initial.screenPt.h - card.nodePosition.y - card.contentSize.h, expectedInset);
  assert.deepEqual(
    card.hpCenterCocos,
    initial.displayMode === "ipad" ? { x: 42.5, y: 6.5 } : { x: 40, y: 7 },
  );
  assert.deepEqual(
    card.namePositionCocos,
    initial.displayMode === "ipad" ? { x: 2.5, y: 14 } : { x: 5, y: 16 },
  );

  const benchCard = initial.friendlyCardLayouts[0];
  assert(benchCard, "missing friendly-row card layout state");
  assertClose(benchCard.nodePosition.x, initial.screenPt.w / 5 + expectedInset);
  assertClose(initial.screenPt.h - benchCard.nodePosition.y - benchCard.contentSize.h, expectedInset);
  assert.deepEqual(
    benchCard.hpCenterCocos,
    initial.displayMode === "ipad" ? { x: 51, y: 6.5 } : { x: 48, y: 7 },
  );
  assert.deepEqual(
    benchCard.namePositionCocos,
    initial.displayMode === "ipad" ? { x: 2.5, y: 14 } : { x: 5, y: 16 },
  );
  await page.screenshot({ path: path.join(outputDir, "acting-card-layout.png"), timeout: 120_000 });

  const clickBattlePoint = async (point) => {
    const css = geometry.toCss(point);
    await page.mouse.click(css.x, css.y);
  };

  const delay = initial.secondaryActions.find((action) => action.kind === "delay");
  assert(delay);
  await clickBattlePoint(delay.center);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "confirmSkip");
  await advance(250);
  await page.waitForFunction(() => {
    let found = false;
    const visit = (node) => {
      if (node.label === "popupTitle") found = true;
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  });
  await advance(250);

  const popupAlignment = await page.evaluate(() => {
    let title = null;
    let background = null;
    const visit = (node) => {
      if (node.label === "popupTitle") title = node;
      if (node.label === "popupBackground") background = node;
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    if (!title || !background) return {
      missing: { title: !title, background: !background },
      labels: (() => {
        const labels = [];
        const collect = (node) => {
          if (node.label) labels.push(node.label);
          for (const child of node.children ?? []) collect(child);
        };
        collect(window.__PIXI_APP__.stage);
        return labels;
      })(),
    };
    const titleBounds = title.getBounds();
    const backgroundBounds = background.getBounds();
    return {
      titleCenterX: titleBounds.x + titleBounds.width / 2,
      backgroundCenterX: backgroundBounds.x + backgroundBounds.width / 2,
    };
  });
  assert(popupAlignment);
  assert(!popupAlignment.missing, JSON.stringify(popupAlignment));
  assert(Math.abs(popupAlignment.titleCenterX - popupAlignment.backgroundCenterX) < 0.01);
  await page.screenshot({ path: path.join(outputDir, "skip-title-centered.png"), timeout: 120_000 });

  const noPoint = await page.evaluate(() => {
    let found = null;
    const visit = (node) => {
      if (!found && node.text === "No") {
        const bounds = node.getBounds();
        found = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  });
  assert(noPoint);
  const appScreen = await page.evaluate(() => ({
    w: window.__PIXI_APP__.screen.width,
    h: window.__PIXI_APP__.screen.height,
  }));
  const appScale = Math.min(canvasBox.width / appScreen.w, canvasBox.height / appScreen.h);
  const appOffsetX = (canvasBox.width - appScreen.w * appScale) / 2;
  const appOffsetY = (canvasBox.height - appScreen.h * appScale) / 2;
  await page.mouse.click(
    canvasBox.x + appOffsetX + noPoint.x * appScale,
    canvasBox.y + appOffsetY + noPoint.y * appScale,
  );
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);

  const slotOne = (await state()).abilityInfoButtons.find((button) => button.slot === 1);
  assert(slotOne);
  await clickBattlePoint({ x: slotOne.tuCenter.x, y: (await state()).screenPt.h - 66 });
  await page.waitForFunction(() => {
    const current = JSON.parse(window.render_game_to_text());
    return current.picking && current.targetPickerVisuals.outlines.length === 1;
  });

  const picking = await state();
  const outline = picking.targetPickerVisuals.outlines[0];
  assert.equal(outline.nodeType, "RenderTextureSprite");
  assert.equal(outline.childCount, 0, "the twelve visits must be baked, not live child stamps");
  assert.equal(outline.antialias, false, "source CCRenderTexture is not multisampled");
  assert.equal(outline.scaleMode, "nearest", "source calls setAliasTexParameters");
  const cancel = picking.targetPickerVisuals.cancel;
  assert(cancel);


  const cancelMarginPt = picking.displayMode === "ipad" ? 2.5 : 5;
  assert(
    Math.abs(cancel.x + cancel.w - (picking.screenPt.w - cancelMarginPt)) < 0.01,
    `cancel right edge ${cancel.x + cancel.w} != ${picking.screenPt.w - cancelMarginPt}`,
  );
  const expectedCancelCenterY = picking.displayMode === "ipad"
    ? picking.screenPt.h - 110
    : picking.screenPt.h - 120;
  assert(Math.abs(cancel.y + cancel.h / 2 - expectedCancelCenterY) < 0.01);
  await advance(1);
  const redTracePixels = await page.evaluate((current) => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
    if (!canvas || !gl) return null;
    const enemy = current.monsters.find((monster) => monster.team === 1);
    if (!enemy) return null;
    const scaleX = canvas.width / current.screenPt.w;
    const scaleY = canvas.height / current.screenPt.h;
    const left = Math.max(0, Math.floor((enemy.targetPoint.x - enemy.targetSize.w / 2 - 4) * scaleX));
    const top = Math.max(0, Math.floor((enemy.targetPoint.y - enemy.targetSize.h / 2 - 4) * scaleY));
    const width = Math.min(canvas.width - left, Math.ceil((enemy.targetSize.w + 8) * scaleX));
    const height = Math.min(canvas.height - top, Math.ceil((enemy.targetSize.h + 8) * scaleY));
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(left, canvas.height - top - height, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let red = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] > 100 && pixels[i] > pixels[i + 1] * 1.5 && pixels[i] > pixels[i + 2] * 1.5) red += 1;
    }
    return red;
  }, picking);
  assert(redTracePixels && redTracePixels > 20, `missing red silhouette pixels: ${redTracePixels}`);
  await page.screenshot({ path: path.join(outputDir, "sprite-outline-full.png"), timeout: 120_000 });

  await advance(375);
  const pulsed = (await state()).targetPickerVisuals.outlines[0];
  assert(pulsed.alpha > 0.35 && pulsed.alpha < 0.65, `unexpected pulse alpha ${pulsed.alpha}`);
  await page.screenshot({ path: path.join(outputDir, "sprite-outline-and-cancel.png"), timeout: 120_000 });

  await clickBattlePoint({ x: cancel.x + cancel.w / 2, y: cancel.y + cancel.h / 2 });
  await page.waitForFunction(() => {
    const current = JSON.parse(window.render_game_to_text());
    return !current.picking && current.panelVisible;
  });
  const cancelled = await state();
  assert.deepEqual(cancelled.targetPickerVisuals, { outlines: [], cancel: null });
  assert.deepEqual(errors, []);

  console.log("visual-fidelity-regressions: PASS (popup, acting card, baked outline, cancel arrow)");
} finally {
  await page.close();
  await browser.close();
}
