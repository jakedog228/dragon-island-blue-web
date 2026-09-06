import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
assert(archive, "Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");
const mod = resolve(repositoryRoot, "examples/mods/dist/devtools.dibmod");
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
    localStorage.setItem("dev.dragonislandblue.devtools.settings.v1", JSON.stringify({
      noBattleDelays: true,
      speedUp: false,
      unlockLocations: false,
      unlockShop: false,
    }));
    window.__DIB_TEST_BATTLE_SEED__ = 7;
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "GrassCombat",
      playerTeam: [{ shortType: "FireCub", level: 100 }],
      enemyTeam: [
        { shortType: "BlueBabyDragon", level: 100 },
        { shortType: "BlueBabyDragon", level: 100 },
        { shortType: "BlueBabyDragon", level: 100 },
      ],
    };
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const archiveInput = page.locator('input[name="asset-archive"]');
  await archiveInput.waitFor({ state: "attached", timeout: 120_000 });
  await archiveInput.setInputFiles(archive);
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
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "game canvas has no bounding box");
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);

  let state;
  for (let index = 0; index < 400; index += 1) {
    state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (
      state.mode === "battle" &&
      state.presentation?.state === "awaitingPlayerChoice" &&
      state.panelVisible
    ) break;
    await page.evaluate(async () => window.advanceTime?.(25));
    if (index % 20 === 0) await page.waitForTimeout(10);
  }

  assert.equal(
    state?.mode,
    "battle",
    `Devtools battle did not build (browser errors: ${errors.join(" | ")}): ${JSON.stringify(state)}`,
  );
  assert.equal(state.codeMods?.devtools?.features?.noBattleDelays, true);
  assert(
    state.codeMods.devtools.battle.skippedTimeDelays >= 1,
    `the ordinary next-actor hold was not intercepted: ${JSON.stringify(state.codeMods)}`,
  );
  assert.equal(state.codeMods.devtools.battle.lastTimeDelayMs, 1_000);
  assert.deepEqual(errors, []);

  const screenshotDirectory = resolve(repositoryRoot, "output/offline-devtools");
  mkdirSync(screenshotDirectory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  const screenshotPath = resolve(screenshotDirectory, "first-choice-no-delay.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log("offline Devtools package scenario passed", {
    archive: archive.split(/[\\/]/).at(-1),
    mod: mod.split(/[\\/]/).at(-1),
    skippedTimeDelays: state.codeMods.devtools.battle.skippedTimeDelays,
    screenshot: screenshotPath,
  });
} finally {
  await browser.close();
}
