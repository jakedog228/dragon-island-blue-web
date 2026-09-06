import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const outputDirectory = resolve(repositoryRoot, "output/local-content-import");
mkdirSync(outputDirectory, { recursive: true });
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
assert(archive, "Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // Force the deterministic harness path. If the selected archive does not contain the fixed
  // DIB demo species, main.ts must seed a sample from that archive's own roster instead.
  await page.addInitScript(() => {
    window.advanceTime = () => {};
  });
  const errors = [];
  const postSelectionNetworkWrites = [];
  let selected = false;
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      selected &&
      /^https?:/i.test(request.url()) &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    ) {
      postSelectionNetworkWrites.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  // Pixi's image-decoder worker performs this exact one-pixel data-URL fetch before choosing its
  // createImageBitmap path. It is governed by connect-src inside the blob worker (not img-src), so
  // a blob-only policy blocks boot without necessarily reaching page.on("console") in Playwright.
  const imageBitmapProbe = await page.evaluate(() => new Promise((resolve) => {
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";
    const workerUrl = URL.createObjectURL(new Blob([
      `fetch(${JSON.stringify(pixel)})\n` +
        `.then((response) => postMessage({ ok: response.ok, status: response.status }))\n` +
        `.catch((error) => postMessage({ ok: false, error: String(error) }));`,
    ], { type: "text/javascript" }));
    const worker = new Worker(workerUrl);
    const finish = (result) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      resolve(result);
    };
    worker.onmessage = (event) => finish(event.data);
    worker.onerror = (event) => finish({ ok: false, error: event.message });
  }));
  assert.deepEqual(imageBitmapProbe, { ok: true, status: 200 });
  await page.screenshot({ path: resolve(outputDirectory, "content-gate.png"), fullPage: true });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  selected = true;
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  try {
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).mode === "start",
      undefined,
      { timeout: 60_000 },
    );
  } catch (error) {
    await page.screenshot({ path: resolve(outputDirectory, "load-failure.png"), fullPage: true });
    console.error("local content state", await page.evaluate(() => window.render_game_to_text?.()));
    console.error("browser errors", errors);
    throw error;
  }

  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const layout = await page.evaluate(() => {
    const app = document.getElementById("app")?.getBoundingClientRect();
    const canvas = document.querySelector("canvas")?.getBoundingClientRect();
    return {
      viewport: { width: innerWidth, height: innerHeight },
      app: app && { x: app.x, y: app.y, width: app.width, height: app.height },
      canvas: canvas && { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      scroll: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    };
  });
  assert.deepEqual(layout.app, { x: 0, y: 0, ...layout.viewport }, "#app does not fill the viewport");
  assert.deepEqual(layout.canvas, { x: 0, y: 0, ...layout.viewport }, "canvas does not fill the viewport");
  assert.deepEqual(layout.scroll, layout.viewport, "loaded game left scrollable page overflow");
  await page.screenshot({ path: resolve(outputDirectory, "loaded-start.png"), fullPage: true });
  assert.equal(state.mode, "start");
  for (let i = 0; i < 300; i++) {
    await page.evaluate(async () => window.advanceTime?.(10));
    if (i % 20 === 0) await page.waitForTimeout(10);
  }

  // Cross the start overlay and prove the selected content can build a real battle scene. Tight
  // virtual-time loops can starve blob fetches, so yield one real millisecond between short steps.
  await page.locator("canvas").click({ position: { x: 640, y: 400 } });
  let battleState;
  for (let i = 0; i < 240; i++) {
    await page.evaluate(async () => window.advanceTime?.(50));
    await page.waitForTimeout(1);
    battleState = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (
      battleState.mode === "battle" &&
      battleState.presentation?.state !== "building" &&
      battleState.monsters?.length >= 6
    ) break;
  }
  assert.equal(battleState?.mode, "battle", `battle did not build: ${JSON.stringify(battleState)}`);
  assert.notEqual(battleState.presentation?.state, "building", "battle remained in asset-loading state");
  assert.ok(battleState.monsters?.length >= 6, "battle did not render both active teams");
  // Give Chromium's WebGL compositor one real frame after the final deterministic render. A
  // screenshot taken in the same microtask as the state transition can intermittently be black.
  await page.waitForTimeout(100);
  await page.evaluate(async () => window.advanceTime?.(16.67));
  await page.screenshot({ path: resolve(outputDirectory, "loaded-battle.png"), timeout: 120_000 });

  assert.equal(
    postSelectionNetworkWrites.length,
    0,
    `archive load made HTTP network writes: ${postSelectionNetworkWrites.join(", ")}`,
  );
  assert.deepEqual(errors, []);
  console.log("local content import scenario passed", {
    archive: archive.split(/[\\/]/).at(-1),
    startMode: state.mode,
    battleMode: battleState.mode,
    activeMonsters: battleState.monsters.length,
  });
} finally {
  await browser.close();
}
