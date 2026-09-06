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
const mod = resolve(repositoryRoot, "examples/mods/dist/mercy-stone.dibmod");
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
  // The stone is worn by the AI side so the rule is exercised without driving the turn panel: a
  // level-100 holder opens against a level-1 opponent whose every hit would otherwise be lethal.
  await page.addInitScript(() => {
    window.advanceTime = () => {};
    window.__DIB_TEST_BATTLE_SEED__ = 7;
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "GrassCombat",
      playerTeam: [{ shortType: "FireCub", level: 1 }],
      enemyTeam: [{
        shortType: "BlueBabyDragon",
        level: 100,
        soulStone: { element: "Mercy", level: 1, sourceType: "BlueBabyDragon" },
      }],
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
  for (let index = 0; index < 600; index += 1) {
    state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
    if (state.mode === "battle" && state.codeMods?.mercyStone?.sparedBlows >= 1) break;
    await page.evaluate(async () => window.advanceTime?.(50));
    if (index % 20 === 0) await page.waitForTimeout(10);
  }

  assert.equal(
    state?.mode,
    "battle",
    `mercy battle did not build (browser errors: ${errors.join(" | ")}): ${JSON.stringify(state)}`,
  );
  assert(
    state.codeMods?.mercyStone?.sparedBlows >= 1,
    `the holder never withheld a killing blow: ${JSON.stringify(state.codeMods)}`,
  );
  assert(
    state.codeMods.mercyStone.lastWithheldDamage > 0,
    `a spared blow must have withheld damage: ${JSON.stringify(state.codeMods.mercyStone)}`,
  );

  // The call-out. `spawnFloater` labels its label node `floater:<text>` and the tween removes it
  // when the message finishes rising, so this polls for the node rather than a single frame.
  const mercyFloater = () => page.evaluate(() => {
    const root = globalThis.__PIXI_APP__?.stage;
    if (!root) throw new Error("Pixi stage is unavailable");
    let found = null;
    const visit = (node) => {
      if (node.label === "floater:Mercy!") {
        found = { text: node.text ?? null, fill: node.style?.fill ?? null };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(root);
    return found;
  });
  let floater = await mercyFloater();
  for (let index = 0; index < 200 && floater === null; index += 1) {
    await page.evaluate(async () => window.advanceTime?.(25));
    if (index % 20 === 0) await page.waitForTimeout(10);
    floater = await mercyFloater();
  }
  assert(floater, "a spared blow painted no Mercy! floater");
  assert.equal(floater.text, "Mercy!");
  // The clamp is recorded the moment it runs, but the battle projection reports each creature's
  // DISPLAYED HP, which the presentation commits after the hit's floater. Let the display catch up
  // rather than reading the frame the clamp landed in.
  const sparedId = state.codeMods.mercyStone.lastSparedId;
  let spared;
  for (let index = 0; index < 200; index += 1) {
    spared = state.monsters.find(({ id }) => id === sparedId);
    if (spared?.hp === 1) break;
    await page.evaluate(async () => window.advanceTime?.(50));
    if (index % 20 === 0) await page.waitForTimeout(10);
    state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  }
  assert(spared, `spared living missing from the projection: ${sparedId}`);
  assert.equal(
    spared.hp,
    1,
    `the spared creature should settle at exactly 1 HP: ${JSON.stringify(spared)}`,
  );
  assert.equal(spared.team, 0);
  assert.deepEqual(errors, []);

  const screenshotDirectory = resolve(repositoryRoot, "output/offline-mercy-stone");
  mkdirSync(screenshotDirectory, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  const screenshotPath = resolve(screenshotDirectory, "spared-at-one-hp.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log("offline Mercy Stone package scenario passed", {
    archive: archive.split(/[\\/]/).at(-1),
    mod: mod.split(/[\\/]/).at(-1),
    sparedBlows: state.codeMods.mercyStone.sparedBlows,
    screenshot: screenshotPath,
  });
} finally {
  await browser.close();
}
