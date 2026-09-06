// Opt-in installed-mobile viewport contract. Start a strict Vite server and provide a compatible
// local archive, then run `pnpm scenario:mobile-viewport`. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDirectory = path.resolve(import.meta.dirname, "../../../../output/mobile-viewport");
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 Mobile/15E148",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    Object.defineProperty(Navigator.prototype, "standalone", {
      configurable: true,
      get: () => true,
    });
  });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  assert.equal(await page.getByRole("button", { name: "Fullscreen" }).count(), 0);

  // Scoping guard: the gameplay policy below must not reach the pre-game gate, whose text is
  // meant to be readable/copyable and whose form controls must stay editable.
  await page.locator('input[name="asset-archive"]').waitFor({ state: "attached" });
  const gatePolicy = await page.evaluate(() => {
    const gate = document.querySelector(".content-gate");
    if (!(gate instanceof HTMLElement)) throw new Error("content gate missing");
    const selectstart = new Event("selectstart", { bubbles: true, cancelable: true });
    gate.dispatchEvent(selectstart);
    return {
      bodyUserSelect: getComputedStyle(document.body).userSelect,
      gateUserSelect: getComputedStyle(gate).userSelect,
      gateSelectstartCanceled: selectstart.defaultPrevented,
    };
  });
  assert.notEqual(gatePolicy.bodyUserSelect, "none", "document selection was suppressed globally");
  assert.notEqual(gatePolicy.gateUserSelect, "none", "content gate text became unselectable");
  assert.equal(gatePolicy.gateSelectstartCanceled, false, "content gate selection was canceled");

  await loadLocalContent(page);

  // The original routes a held finger from a native EAGLView straight into CCTouchDispatcher, so
  // no browser selection/callout/drag layer exists on the gameplay surface. Chromium cannot prove
  // the iOS callout or loupe is gone -- that needs a physical device -- but it does prove the
  // policy is actually applied to the live viewport and canvas.
  const surfacePolicy = await page.evaluate(() => {
    const viewport = document.querySelector(".game-viewport");
    const canvas = document.querySelector("canvas");
    if (!(viewport instanceof HTMLElement) || !(canvas instanceof HTMLCanvasElement)) {
      throw new Error("game surface missing");
    }
    const viewportStyle = getComputedStyle(viewport);
    const canvasStyle = getComputedStyle(canvas);
    // Propagation must survive cancellation: Pixi's event system and the scenes listen upstream.
    const reachedViewport = [];
    const cancellation = {};
    for (const type of ["contextmenu", "selectstart", "dragstart"]) {
      const observe = () => reachedViewport.push(type);
      viewport.addEventListener(type, observe);
      const event = new Event(type, { bubbles: true, cancelable: true });
      canvas.dispatchEvent(event);
      viewport.removeEventListener(type, observe);
      cancellation[type] = event.defaultPrevented;
    }
    return {
      viewport: { touchAction: viewportStyle.touchAction, userSelect: viewportStyle.userSelect },
      canvas: {
        touchAction: canvasStyle.touchAction,
        userSelect: canvasStyle.userSelect,
        webkitUserSelect: canvasStyle.webkitUserSelect,
        draggable: canvas.draggable,
      },
      cancellation,
      reachedViewport,
    };
  });
  assert.deepEqual(surfacePolicy.viewport, { touchAction: "none", userSelect: "none" },
    "game viewport does not declare the application-surface policy");
  assert.deepEqual(surfacePolicy.canvas,
    { touchAction: "none", userSelect: "none", webkitUserSelect: "none", draggable: false },
    "gameplay canvas is still selectable/draggable document content");
  assert.deepEqual(surfacePolicy.cancellation,
    { contextmenu: true, selectstart: true, dragstart: true },
    "browser-owned canvas actions are not canceled");
  assert.deepEqual(surfacePolicy.reachedViewport, ["contextmenu", "selectstart", "dragstart"],
    "canvas guards stopped propagation, which would starve Pixi and scene input");

  const assertFitted = async ({ width, height }, description) => {
    await page.setViewportSize({ width, height });
    await page.waitForFunction(({ expectedWidth, expectedHeight }) => {
      const app = document.getElementById("app")?.getBoundingClientRect();
      const host = document.querySelector(".game-viewport")?.getBoundingClientRect();
      const canvas = document.querySelector("canvas")?.getBoundingClientRect();
      const renderer = globalThis.__PIXI_APP__?.renderer;
      return app?.width === expectedWidth && app.height === expectedHeight &&
        host?.width === expectedWidth && host.height === expectedHeight &&
        canvas?.width === expectedWidth && canvas.height === expectedHeight &&
        renderer?.screen.width === expectedWidth && renderer.screen.height === expectedHeight;
    }, { expectedWidth: width, expectedHeight: height });

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const bounds = document.querySelector(selector)?.getBoundingClientRect();
        return bounds && { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      const state = JSON.parse(window.render_game_to_text());
      const root = globalThis.__PIXI_APP__?.stage.children.find((node) => node.mask != null);
      return {
        viewport: { width: innerWidth, height: innerHeight },
        source: document.documentElement.dataset.appViewportSource,
        app: rect("#app"),
        host: rect(".game-viewport"),
        canvas: rect("canvas"),
        renderer: {
          width: globalThis.__PIXI_APP__?.renderer.screen.width,
          height: globalThis.__PIXI_APP__?.renderer.screen.height,
        },
        stagePx: state.stagePx,
        root: root && {
          scaleX: root.scale.x,
          scaleY: root.scale.y,
          x: root.position.x,
          y: root.position.y,
        },
        scroll: {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
        },
      };
    });
    const viewportRect = { x: 0, y: 0, width, height };
    assert.equal(layout.source, "window", `${description}: installed mode did not use window metrics`);
    assert.deepEqual(layout.viewport, { width, height }, `${description}: window geometry is stale`);
    assert.deepEqual(layout.app, viewportRect, `${description}: #app does not fill the screen`);
    assert.deepEqual(layout.host, viewportRect, `${description}: safe-area host is clipped`);
    assert.deepEqual(layout.canvas, viewportRect, `${description}: canvas retained an old orientation`);
    assert.deepEqual(layout.renderer, { width, height }, `${description}: Pixi renderer is stale`);
    assert.deepEqual(layout.scroll, { width, height }, `${description}: page overflowed the screen`);
    const expectedScale = Math.min(width / layout.stagePx.w, height / layout.stagePx.h);
    assert(Math.abs(layout.root.scaleX - expectedScale) < 0.001, `${description}: wrong stage scale`);
    assert(Math.abs(layout.root.scaleY - expectedScale) < 0.001, `${description}: non-uniform stage scale`);
    assert(Math.abs(layout.root.x - (width - layout.stagePx.w * expectedScale) / 2) < 0.01,
      `${description}: stage is not horizontally centered`);
    assert(Math.abs(layout.root.y - (height - layout.stagePx.h * expectedScale) / 2) < 0.01,
      `${description}: stage is not vertically centered`);
  };

  await assertFitted({ width: 390, height: 844 }, "initial portrait");
  await assertFitted({ width: 844, height: 390 }, "first landscape rotation");
  await page.screenshot({
    path: path.join(outputDirectory, "installed-landscape-game.png"),
    fullPage: true,
  });
  await assertFitted({ width: 412, height: 915 }, "tall Android portrait");
  await assertFitted({ width: 915, height: 412 }, "wide Android landscape");
  await page.screenshot({
    path: path.join(outputDirectory, "installed-wide-landscape-game.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log(
    "mobile viewport: PASS (installed rotation + Pixi resize + letterbox fit + surface policy)",
  );
  await context.close();
} finally {
  await browser.close();
}
