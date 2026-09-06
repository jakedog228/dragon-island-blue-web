// Opt-in source-composition contract for PickSaveSlotNode's runtime dim. Start a fresh strict-port
// Vite server, set DIB_CONTENT_ARCHIVE to an operator-owned compatible IPA/ZIP, then run
// `pnpm scenario:save-selector-dim`. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/save-selector-dim");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  for (const displayMode of ["iphone", "ipad"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon")) {
        errors.push(`console: ${message.text()}`);
      }
    });
    await page.addInitScript((mode) => {
      window.advanceTime = () => Promise.resolve();
      window.__DIB_TEST_SESSION_RESTARTS__ = true;
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
    const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
    const waitFor = async (predicate, description, timeoutMs = 60_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const snapshot = await state();
        if (predicate(snapshot)) return snapshot;
        await advance(25);
        await page.waitForTimeout(2);
      }
      throw new Error(
        `${displayMode}: ${description}; errors=${errors.join(" | ") || "none"}; ` +
        `state=${JSON.stringify(await state())}`,
      );
    };

    await waitFor(
      (snapshot) => snapshot.startup?.phase === "title",
      "startup title did not become interactive",
    );
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
    await waitFor(
      (snapshot) => snapshot.startup?.phase === "save-select",
      "presentation restart did not open Pick Save Slot",
    );
    await advance(500);

    const composition = await page.evaluate(() => {
      const nodes = [];
      const visit = (node) => {
        nodes.push(node);
        for (const child of node.children ?? []) visit(child);
      };
      visit(window.__PIXI_APP__.stage);
      const dim = nodes.find((node) => node.label === "sourcePopupDim");
      const background = nodes.find(
        (node) => node.label === "sourceStartupBackground:saveSlotBackground",
      );
      const menu = nodes.find((node) => node.label === "sourceMainMenuPopup");
      const overlays = nodes.filter((node) => node.label?.startsWith("sourcePopupOverlay:"));
      if (!dim || !background || !menu) return null;
      const bounds = dim.getLocalBounds();
      return {
        dim: {
          alpha: dim.alpha,
          zIndex: dim.zIndex,
          parent: dim.parent?.label ?? null,
          bounds: { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
        },
        background: { tint: background.tint, alpha: background.alpha, zIndex: background.zIndex },
        menu: { zIndex: menu.zIndex },
        overlays: overlays.map((node) => ({ tint: node.tint, zIndex: node.zIndex })),
      };
    });
    assert(composition, `${displayMode}: save-selector composition nodes are missing`);
    assert.deepEqual(composition.dim.bounds, displayMode === "iphone"
      ? { x: 0, y: 0, w: 480, h: 320 }
      : { x: 0, y: 0, w: 512, h: 384 });
    assert.equal(composition.dim.parent, "sourceMainMenuPopup");
    assert.equal(composition.dim.zIndex, -9_999);
    assert(Math.abs(composition.dim.alpha - 200 / 255) < 1e-6,
      `${displayMode}: dim did not settle at source opacity 200: ${composition.dim.alpha}`);
    assert.deepEqual(composition.background, { tint: 0xffffff, alpha: 1, zIndex: -100 },
      `${displayMode}: the shipped background was tinted instead of shaded by popup composition`);
    assert.equal(composition.menu.zIndex, 20);
    assert.equal(composition.overlays.length, 2);
    assert(composition.overlays.every(({ tint, zIndex }) => tint === 0xffffff && zIndex === 1),
      `${displayMode}: character overlays did not remain above the dim: ${JSON.stringify(composition.overlays)}`);

    await page.screenshot({
      path: path.join(outputDir, `save-selector-${displayMode}.png`),
      fullPage: false,
      timeout: 120_000,
    });
    assert.deepEqual(errors, [], `${displayMode}: ${errors.join("\n")}`);
    await page.close();
  }
  console.log("save-selector-dim: PASS (iPhone + iPad)");
} finally {
  await browser.close();
}
