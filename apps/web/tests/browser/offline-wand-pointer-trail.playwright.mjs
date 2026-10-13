import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const mod = resolve(repositoryRoot, "examples/mods/dist/wand-pointer-trail.dibmod");
assert(existsSync(mod), "Run pnpm mods:examples before this scenario.");

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.advanceTime = () => {};
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page, undefined, { modArchives: [mod] });

  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "game canvas has no bounding box");
  const point = (x, y) => ({
    x: canvasBox.x + canvasBox.width * x,
    y: canvasBox.y + canvasBox.height * y,
  });
  const trailState = () => page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "wandPointerTrail") {
        return {
          activePointers: node.activePointerCount,
          particles: node.particleCount,
          scale: node.effectScale,
          eventMode: node.eventMode,
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  });

  assert.deepEqual(await trailState(), {
    activePointers: 0,
    particles: 0,
    scale: 1,
    eventMode: "none",
  });

  const start = point(0.3, 0.7);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.evaluate(() => window.advanceTime?.(40));
    for (let index = 1; index <= 8; index += 1) {
      const next = point(0.3 + index * 0.055, 0.7 - Math.sin(index / 2) * 0.13);
      await page.mouse.move(next.x, next.y, { steps: 2 });
      await page.evaluate(() => window.advanceTime?.(25));
    }

    const held = await trailState();
    assert.equal(held?.activePointers, 1);
    assert.equal(held?.eventMode, "none");
    assert(
      held.particles > 20,
      `held drag did not leave a visible particle trail: ${JSON.stringify(held)}`,
    );

    const screenshotDirectory = resolve(repositoryRoot, "output/offline-wand-pointer-trail");
    mkdirSync(screenshotDirectory, { recursive: true });
    const cdp = await page.context().newCDPSession(page);
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    writeFileSync(
      resolve(screenshotDirectory, "held-drag.png"),
      Buffer.from(screenshot.data, "base64"),
    );
  } finally {
    await page.mouse.up();
  }

  const released = await trailState();
  assert.equal(released?.activePointers, 0);
  assert(
    released.particles > 0,
    `release removed the after-effect immediately: ${JSON.stringify(released)}`,
  );
  for (let index = 0; index < 12; index += 1) {
    await page.evaluate(() => window.advanceTime?.(50));
  }
  assert.deepEqual(await trailState(), {
    activePointers: 0,
    particles: 0,
    scale: 1,
    eventMode: "none",
  });

  // Title -> save selection -> the shared Options body. The mod extends this same popup in
  // startup, world, and dungeon, so one startup proof exercises the common integration seam.
  // The real drag above can also advance the title. Reopen the shell before its selector proof.
  await page.reload({ waitUntil: "domcontentloaded" });
  await loadLocalContent(page, undefined, { modArchives: [mod] });
  for (let frame = 0; frame < 400; frame++) {
    if (await page.evaluate(() => JSON.parse(window.render_game_to_text()).startup?.phase === "title")) break;
    await page.evaluate(() => window.advanceTime(25));
    await page.waitForTimeout(1);
  }
  const phaseAfterTrail = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()).startup?.phase,
  );
  if (phaseAfterTrail !== "save-select") {
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
  }
  for (let index = 0; index < 400; index += 1) {
    const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (state.startup?.phase === "save-select") break;
    await page.evaluate(() => window.advanceTime?.(25));
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  await page.evaluate(() => window.advanceTime(550));
  assert(
    await tapPixiLabel(page, "sourcePopupButton:options"),
    "save selection omitted its Options action",
  );
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).startup?.phase === "options",
    undefined,
    { timeout: 10_000 },
  );
  await page.evaluate(() => window.advanceTime(550));
  const sliderPoints = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "optionsChoice:wandTrailScale:slider") {
        return {
          start: node.toGlobal({ x: 65, y: 0 }),
          end: node.toGlobal({ x: 130, y: 0 }),
        };
      }
      if (node?.children) stack.push(...node.children);
    }
    return null;
  });
  assert(sliderPoints, "Options popup omitted the Wand Pointer Trail scale slider");
  await page.mouse.move(canvasBox.x + sliderPoints.start.x, canvasBox.y + sliderPoints.start.y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + sliderPoints.end.x, canvasBox.y + sliderPoints.end.y, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => window.advanceTime?.(25));
  assert.equal((await trailState())?.scale, 5, "slider did not update the live trail scale");
  assert.equal(
    await page.evaluate(() => JSON.parse(
      localStorage.getItem("dev.dragonislandblue.wand-pointer-trail.settings.v1"),
    ).scale),
    5,
    "slider did not persist its scale",
  );
  const sliderText = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "wandTrailScaleValue") return node.text;
      if (node?.children) stack.push(...node.children);
    }
    return null;
  });
  assert.equal(sliderText, "5.00x");
  const screenshotDirectory = resolve(repositoryRoot, "output/offline-wand-pointer-trail");
  mkdirSync(screenshotDirectory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const optionsScreenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  writeFileSync(
    resolve(screenshotDirectory, "options-scale-max.png"),
    Buffer.from(optionsScreenshot.data, "base64"),
  );
  assert.deepEqual(errors, []);
  console.log("offline Wand Pointer Trail scenario passed", {
    mod: mod.split(/[\\/]/).at(-1),
    screenshot: resolve(repositoryRoot, "output/offline-wand-pointer-trail/held-drag.png"),
  });
} finally {
  await browser.close();
}
