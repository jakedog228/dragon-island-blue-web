

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
assert(archive, "Set DIB_CONTENT_ARCHIVE to an archive containing PirateMan-hd.png.");
const mod = resolve(repositoryRoot, "examples/mods/dist/pirate-panic-dancer.dibmod");
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
    window.__DIB_TEST_BATTLE_SEED__ = 23;
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "GrassCombat",
      playerTeam: [{ shortType: "PirateMan", level: 30 }],
      enemyTeam: [{ shortType: "Slime", level: 1 }],
    };
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.locator('input[name="mod-archives"]').setInputFiles(mod);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ state: "visible", timeout: 120_000 });
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).mode === "start",
    undefined,
    { timeout: 60_000 },
  );
  for (let index = 0; index < 300; index += 1) {
    await page.evaluate(async () => window.advanceTime?.(10));
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, "game canvas has no bounding box");
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  let state;
  for (let index = 0; index < 800; index += 1) {
    state = await read();
    if (state.codeMods?.piratePanic?.phase === "dialogue") break;
    await page.evaluate(async () => window.advanceTime?.(50));
    if (index % 10 === 0) await page.waitForTimeout(5);
  }
  assert.equal(state?.mode, "battle", `Pirate battle did not build: ${JSON.stringify(state)}`);
  assert.equal(state.monsters.find((monster) => monster.team === 0)?.aiControlled, true);
  assert.equal(state.abilityButtons.length, 0, "Pirate must not receive usable move cards");
  assert.equal(state.codeMods?.piratePanic?.phase, "dialogue", JSON.stringify(state));

  const screenshotDirectory = resolve(repositoryRoot, "output/offline-pirate-panic-dancer");
  mkdirSync(screenshotDirectory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const dialogueShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const dialoguePath = resolve(screenshotDirectory, "pirate-dialogue.png");
  writeFileSync(dialoguePath, Buffer.from(dialogueShot.data, "base64"));

  const seen = new Set();
  for (let turn = 0; turn < 4; turn += 1) {
    state = await read();
    const panic = state.codeMods?.piratePanic;
    assert.equal(panic?.phase, "dialogue", `turn ${turn + 1} dialogue missing: ${JSON.stringify(state)}`);
    assert(!seen.has(panic.line), `dialogue repeated early: ${panic.line}`);
    seen.add(panic.line);

    // Pirate's chat accepts this tap immediately, without advancing through the opening fade.
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    for (let index = 0; index < 80; index += 1) {
      state = await read();
      if (state.codeMods?.piratePanic?.phase === "dance" &&
          state.activeEffectNodes.some((node) => node.label === "piratePanicDance")) break;
      await page.evaluate(async () => window.advanceTime?.(25));
    }
    assert.equal(state.codeMods?.piratePanic?.phase, "dance");
    assert(state.activeEffectNodes.some((node) => node.label === "piratePanicDance"));
    if (turn === 0) {
      const danceShot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
      writeFileSync(
        resolve(screenshotDirectory, "pirate-dance.png"),
        Buffer.from(danceShot.data, "base64"),
      );
    }

    // Click outside the text box: one click must cancel the dance before its 2600ms duration
    // and remember the status acknowledgment even when BattleNode has not reached its wait.
    if (turn < 3) {
      await page.mouse.click(canvasBox.x + canvasBox.width * 0.8, canvasBox.y + canvasBox.height * 0.25);
    }
    for (let index = 0; index < 140; index += 1) {
      await page.evaluate(async () => window.advanceTime?.(25));
      state = await read();
      if (state.codeMods?.piratePanic?.phase === "complete") break;
      if (turn < 3) assert(index < 20, "dance did not complete promptly after skip");
    }
    assert(!state.activeEffectNodes.some((node) => node.label === "piratePanicDance"));
    if (turn < 3) {
      assert(!state.statusText?.text?.includes("buffoon"),
        "early skip was lost: Dance status still holds the next turn");
    }
    if (turn === 3 && state.statusText?.visible) {
      await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    }
    if (turn < 3) {
      const priorTurn = panic.turn;
      for (let index = 0; index < 1000; index += 1) {
        await page.evaluate(async () => window.advanceTime?.(50));
        if (index % 10 === 0) await page.waitForTimeout(5);
        state = await read();
        if (state.codeMods?.piratePanic?.phase === "dialogue" &&
            state.codeMods.piratePanic.turn > priorTurn) break;
      }
    }
  }
  assert.equal(seen.size, 4);
  assert.deepEqual(errors, []);
  console.log("Pirate panic-dancer scenario passed", {
    dialogueScreenshot: dialoguePath,
    danceScreenshot: resolve(screenshotDirectory, "pirate-dance.png"),
  });
} finally {
  await browser.close();
}
