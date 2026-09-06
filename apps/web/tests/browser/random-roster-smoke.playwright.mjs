// Smoke scenario for the randomized full-roster demo composition (rosterSampler.ts): boots the
// REAL sampler path via __DIB_TEST_ROSTER_SEED__ (a seeded 9v9 uniform sample over all 224
// monsters — the same code path a live page load takes, minus Math.random), lets the opening
// turns play out, and screenshots the field. Asserts the sampled roster actually loaded (3v3
// active + 6-deep benches in the turn/bench state), and that no page/console error fired — the
// error listener is the real assertion here, since any unimplemented mechanic in a random kit
// fails loudly by design.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const seed = Number(process.env.DIB_ROSTER_SEED ?? 777);
const outputDir = path.resolve("output/random-roster-smoke");
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript((rosterSeed) => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_ROSTER_SEED__ = rosterSeed;
  }, seed);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = async () => JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  const advance = (ms) => page.evaluate((amount) => window.advanceTime(amount), ms);

  for (let i = 0; i < 300 && (await state()).mode !== "start"; i++) {
    await page.waitForTimeout(100);
  }
  assert.equal((await state()).mode, "start", `boot stalled: ${errors.join(" | ")}`);
  for (let i = 0; i < 300; i++) {
    await advance(10);
    if (i % 20 === 0) await page.waitForTimeout(10);
  }
  console.log(`random-roster-smoke: booted (roster seed ${seed})`);

  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox);
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  // buildScene awaits REAL asset fetches; a tight advanceTime loop would starve them and leave
  // the scene in "building" forever (verification pitfall). Give it wall-clock time first.
  for (let i = 0; i < 240 && (await state()).mode !== "battle"; i++) {
    await advance(50);
    await page.waitForTimeout(250);
  }
  // Entrance choreography, then a stretch of automatic (enemy/AI) turns. Player turns pause the
  // loop awaiting input — bounded advances simply stop progressing there, which is fine for a
  // load-and-first-turns smoke.
  for (let i = 0; i < 40; i++) await advance(500);
  const s = await state();
  assert.equal(s.mode ?? "battle", "battle", "battle scene never started");
  assert(Array.isArray(s.displayedQueue) && s.displayedQueue.length >= 6,
    `expected a full 3v3 active field in the queue, got ${JSON.stringify(s.displayedQueue)}`);

  const shot = path.join(outputDir, `random-roster-seed${seed}.png`);
  await advance(16); // one more deterministic tick -> stage.app.render() presents a fresh frame
  // 18 random monsters upload far more texture data than the fixed demo scenarios — swiftshader
  // needs more than the default 30s to compose the first full screenshot.
  await page.screenshot({ path: shot, timeout: 120_000 });
  console.log(`random-roster-smoke: screenshot ${shot}`);

  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log("random-roster-smoke: PASS (seeded 9v9 sample booted, opening turns ran clean)");
} finally {
  await browser.close();
}
