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
const mod = resolve(repositoryRoot, "examples/mods/dist/fire-cub-inferno-barrage.dibmod");
assert(existsSync(mod), "Run pnpm mods:examples before this scenario.");

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const screenshotDirectory = resolve(repositoryRoot, "output/offline-code-mods");
  const captureScreenshot = async (name) => {
    const screenshotPath = resolve(screenshotDirectory, name);
    const cdp = await page.context().newCDPSession(page);
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    mkdirSync(screenshotDirectory, { recursive: true });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    return screenshotPath;
  };
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript(() => {
    window.advanceTime = () => {};
    window.__DIB_TEST_BATTLE_SEED__ = 7;
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "GrassCombat",
      playerTeam: [{ shortType: "FireCub", level: 100 }],
      enemyTeam: [
        { shortType: "BlueBabyDragon", level: 100 },
        { shortType: "BlueBabyDragon", level: 1 },
        { shortType: "BlueBabyDragon", level: 100 },
      ],
    };
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const archiveInput = page.locator('input[name="asset-archive"]');
  try {
    await archiveInput.waitFor({ state: "attached", timeout: 120_000 });
  } catch (error) {
    const screenshot = await captureScreenshot("content-gate-boot-timeout.png");
    console.error("Offline content gate did not mount", {
      errors,
      screenshot,
      bodyText: await page.locator("body").innerText().catch(() => "<body unavailable>"),
    });
    throw error;
  }
  await archiveInput.setInputFiles(archive);
  await page.locator('input[name="mod-archives"]').setInputFiles(mod);
  await page.locator(".content-gate__mods-label").filter({ hasText: "1 Offline Mod selected" })
    .waitFor({ state: "visible" });
  assert.equal(
    await page.locator(".content-gate__mods-status").textContent(),
    "fire-cub-inferno-barrage.dibmod",
    "landing dashboard did not retain the single selected package",
  );
  await page.locator(".content-gate__mods-warning").waitFor({ state: "visible" });
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  try {
    await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
      .waitFor({ state: "visible", timeout: 120_000 });
  } catch (error) {
    const screenshot = await captureScreenshot("content-gate-timeout.png");
    const gateText = await page.locator(".content-gate").innerText().catch(() => "<gate unavailable>");
    console.error("Offline content gate did not become ready", { gateText, errors, screenshot });
    throw error;
  }
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).mode === "start",
    undefined,
    { timeout: 60_000 },
  );

  for (let index = 0; index < 300; index++) {
    await page.evaluate(async () => window.advanceTime?.(10));
    if (index % 20 === 0) await page.waitForTimeout(10);
  }
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "game canvas has no bounding box");
  await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  let state;
  for (let index = 0; index < 400; index++) {
    state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (
      state.mode === "battle" &&
      state.presentation?.state === "awaitingPlayerChoice" &&
      state.panelVisible
    ) break;
    await page.evaluate(async () => window.advanceTime?.(100));
    await page.waitForTimeout(10);
  }

  assert.equal(
    state?.mode,
    "battle",
    `modded battle did not build (browser errors: ${errors.join(" | ")}): ${JSON.stringify(state)}`,
  );
  const barrage = state.abilityButtons.find((button) =>
    button.abilityPath === "DevDragonIslandBlueFireCub.FireCubInfernoBarrage"
  );
  assert(barrage, `Inferno Barrage card missing: ${JSON.stringify(state.abilityButtons)}`);
  const canvasScaleX = canvasBox.width / state.screenPt.w;
  const canvasScaleY = canvasBox.height / state.screenPt.h;
  await page.mouse.click(
    canvasBox.x + barrage.center.x * canvasScaleX,
    canvasBox.y + barrage.center.y * canvasScaleY,
  );

  let during = state;
  for (let index = 0; index < 20; index++) {
    await page.evaluate(async () => window.advanceTime?.(10));
    await page.waitForTimeout(2);
    during = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (during.codeMods?.infernoBarrage?.active === true) break;
  }
  assert.equal(during.codeMods?.infernoBarrage?.active, true, "barrage coroutine did not open");
  assert(
    during.codeMods.infernoBarrage.reticleRadiusPt > 0,
    `the aiming ring reported no radius: ${JSON.stringify(during.codeMods.infernoBarrage)}`,
  );
  const aimedEnemy = during.monsters.find((monster) => monster.id === "t1m1:BlueBabyDragon");
  assert(aimedEnemy, "aim-target fixture enemy missing");
  const strikesBeforeAim = during.codeMods.infernoBarrage.completedStrikes;
  // Hovering is the whole gesture: the ring follows the pointer with no button held, which is what
  // removes the dead bands between enemy bodies that a per-sprite press had.
  await page.mouse.move(
    canvasBox.x + aimedEnemy.targetPoint.x * canvasScaleX,
    canvasBox.y + aimedEnemy.targetPoint.y * canvasScaleY,
  );

  for (let index = 0; index < 80; index++) {
    await page.evaluate(async () => window.advanceTime?.(100));
    await page.waitForTimeout(5);
    during = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (during.codeMods?.infernoBarrage?.completedStrikes >= strikesBeforeAim + 3) break;
  }
  assert.equal(during.codeMods.infernoBarrage.active, true);
  assert.equal(during.codeMods.infernoBarrage.focusedTargetId, aimedEnemy.id);
  assert.deepEqual(
    during.codeMods.infernoBarrage.targetIds.slice(strikesBeforeAim),
    Array(during.codeMods.infernoBarrage.completedStrikes - strikesBeforeAim).fill(aimedEnemy.id),
    "every strike under the ring should focus the aimed enemy",
  );
  assert.equal(during.activeAbilityPath, "DevDragonIslandBlueFireCub.FireCubInfernoBarrage");

  // Aim off the enemy row entirely. No monster is inside the ring there, which is the package's
  // documented fallback to the engine's own scripted random pick.
  await page.mouse.move(canvasBox.x + 4, canvasBox.y + canvasBox.height - 4);
  let released = during;
  for (let index = 0; index < 40; index++) {
    await page.evaluate(async () => window.advanceTime?.(100));
    await page.waitForTimeout(5);
    released = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (released.codeMods?.infernoBarrage?.focusedTargetId === null) break;
  }
  assert.equal(
    released.codeMods.infernoBarrage.focusedTargetId,
    null,
    `aiming off the enemies should hold no target: ${JSON.stringify(released.codeMods.infernoBarrage)}`,
  );

  let completed = released;
  for (let index = 0; index < 160; index++) {
    await page.evaluate(async () => window.advanceTime?.(100));
    await page.waitForTimeout(5);
    completed = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (completed.codeMods?.infernoBarrage?.active === false) break;
  }
  assert.equal(completed.codeMods.infernoBarrage.active, false);
  assert.equal(completed.codeMods.infernoBarrage.elapsedMs, 4000);
  assert.equal(completed.codeMods.infernoBarrage.completedStrikes, 20);
  assert.equal(completed.codeMods.infernoBarrage.targetIds.length, 20);
  assert.equal(completed.codeMods.infernoBarrage.damageAmounts.length, 20);
  const aimedDamage = completed.codeMods.infernoBarrage.targetIds.flatMap((targetId, index) =>
    targetId === aimedEnemy.id ? [completed.codeMods.infernoBarrage.damageAmounts[index]] : []
  );
  assert(
    aimedDamage.some((amount) => amount > 0) && aimedDamage.some((amount) => amount === 0),
    `defeated aimed enemy did not keep receiving zero-damage strikes: ${JSON.stringify(aimedDamage)}`,
  );
  assert(
    new Set(completed.codeMods.infernoBarrage.targetIds).size >= 2,
    `strikes aimed off the row did not resume random targeting: ${JSON.stringify(completed.codeMods.infernoBarrage.targetIds)}`,
  );
  assert.equal(completed.battleInput.latestPlayerSubmission.slot, "usable3");
  assert.deepEqual(errors, []);
  const screenshotPath = await captureScreenshot("inferno-barrage-final.png");
  console.log("offline Inferno Barrage package scenario passed", {
    archive: archive.split(/[\\/]/).at(-1),
    mod: mod.split(/[\\/]/).at(-1),
    screenshot: screenshotPath,
  });
} finally {
  await browser.close();
}
