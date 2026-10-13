// Authorized, muted regression: startup must not depend on a browser RAF observing
// a transient Pixi scene. Hold RAF after mounting the DOM bridge, then play normally.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createFrameCapture } from "./captureFrame.mjs";
import { clickNativeLabel, waitNativeLabel } from "./nativeLabelInput.mjs";

const output = path.resolve(process.env.DIB_LOADING_OUTPUT ?? "output/loading-handoff");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const results = [];
try {
  for (const displayMode of ["iphone", "ipad"]) {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 },
      reducedMotion: "reduce", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
      if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
    });
    await page.addInitScript(mode => {
      localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode: mode,
        textResolutionMode: "modern", sound: 0, music: 0 }));
      window.advanceTime = () => Promise.resolve();
      window.__DIB_TEST_WORLD_DEMO__ = true;
      window.__DIB_TEST_EXTERNAL_STARTUP_CLOCK__ = true;
      const raf = window.requestAnimationFrame.bind(window);
      let held = false, id = -1;
      window.__heldFrames = new Map();
      window.requestAnimationFrame = callback => {
        if (!held && document.querySelector(".source-loading-bridge")) held = true;
        if (!held) return raf(callback);
        const handle = id--;
        window.__heldFrames.set(handle, callback);
        return handle;
      };
      window.__releaseFrames = () => {
        window.requestAnimationFrame = raf;
        for (const callback of window.__heldFrames.values()) raf(callback);
        window.__heldFrames.clear();
      };
      const cancel = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = handle => {
        window.__heldFrames.delete(handle);
        cancel(handle);
      };
    }, displayMode);
    await page.goto(process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173");
    await page.locator('input[name="asset-archive"]').setInputFiles(
      path.resolve(process.env.DIB_CONTENT_ARCHIVE ?? "Dragon_Island_Blue_1.1.0.ipa"));
    await page.getByRole("radio", { name: "Offline", exact: true }).check();
    await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
      .waitFor({ timeout: 120000 });
    await page.locator(".content-gate__rights input").check();
    await page.getByRole("button", { name: "Play Offline", exact: true }).click();
    await page.locator(".source-loading-bridge").waitFor({ timeout: 120000 });
    await page.waitForFunction(() => typeof window.render_game_to_text === "function",
      null, { timeout: 120000, polling: 20 });
    await waitNativeLabel(page, "sourceTitleTouchLayer");
    await page.evaluate(() => window.advanceTime(500));
    const capture = await createFrameCapture(page, output);
    const bridgeAtTitle = await page.locator(".source-loading-bridge").count();
    const heldFrames = await page.evaluate(() => window.__heldFrames.size);
    await capture(`${displayMode}-title.png`);
    const result = { displayMode, bridgeAtTitle, heldFrames, errors };
    results.push(result);
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    assert.equal(bridgeAtTitle, 0, "Rendered title is obscured by the DOM loading screen");
    // Resume browser input scheduling, then start a fresh game with real input.
    await page.evaluate(() => window.__releaseFrames());
    await page.waitForTimeout(100);
    await clickNativeLabel(page, "sourceTitleTouchLayer");
    let state;
    for (let attempt = 0; attempt < 100; attempt++) {
      await page.evaluate(() => window.advanceTime(100));
      await page.waitForTimeout(10);
      state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
      if (state.startup?.phase === "new-game-plot") break;
    }
    await page.evaluate(() => window.advanceTime(1500));
    const bridgeAtIntro = await page.locator(".source-loading-bridge").count();
    await capture(`${displayMode}-intro.png`);
    Object.assign(result, { bridgeAtIntro, state });
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(results, null, 2));
    assert.equal(state.startup.phase, "new-game-plot");
    assert.equal(bridgeAtIntro, 0, "New game is obscured by the DOM loading screen");
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log("Loading handoff passed on iPhone and iPad with browser RAF held.");
