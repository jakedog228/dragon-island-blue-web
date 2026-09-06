// Opt-in matched-save Warp Gate evidence. The native save is loaded unchanged by both TouchHLE
// and this browser scenario. Run on a fresh strict Vite server; Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ?? path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const nativeSave = path.resolve(
  process.env.DIB_NATIVE_SAVE ?? path.join(repositoryRoot, "working/saves/savefile1"),
);
const outputDirectory = path.resolve(
  process.env.DIB_TOWN_WARP_ENDGAME_OUTPUT ??
    path.join(repositoryRoot, "output/town-warp-endgame-browser"),
);
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
assert(fs.existsSync(nativeSave), `Missing matched native save: ${nativeSave}`);
fs.mkdirSync(outputDirectory, { recursive: true });

const expectedCounts = Object.freeze({
  First_City: 0,
  Valley_City: 0,
  Rainy_City: 0,
  Longdale_City: 0,
  HolyCity: 0,
  Secret_City: 0,
});

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: process.env.DIB_HEADED !== "1",
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
  });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ timeout: 120_000 });

  await page.getByRole("button", { name: "Offline settings" }).click();
  const storageDialog = page.getByRole("dialog", { name: "Offline settings" });
  await storageDialog.getByText("Offline save slots").waitFor();
  page.once("dialog", async (prompt) => {
    assert.equal(prompt.type(), "prompt", "native-save import did not ask for a slot");
    await prompt.accept("1");
  });
  await storageDialog.locator('input[type="file"]').setInputFiles(nativeSave);
  await storageDialog.getByText(/Imported the save into slot-1\./).waitFor({ timeout: 30_000 });
  await storageDialog.getByRole("button", { name: "Close save settings" }).click();
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitForState = async (predicate, message, attempts = 800) => {
    for (let index = 0; index < attempts; index++) {
      const current = await state();
      if (predicate(current)) return current;
      await advance(25);
    }
    throw new Error(`${message}: ${JSON.stringify(await state())}`);
  };

  await waitForState((value) => value.startup?.phase === "title", "startup did not reach title");
  await page.keyboard.press("Enter");
  await waitForState(
    (value) => value.startup?.phase === "save-select",
    "startup did not reach save selection",
  );
  // PopupMenu publishes its model before the source 0.2-second input transition completes.
  await advance(300);
  const canvas = page.locator("canvas").first();
  const canvasBounds = await canvas.boundingBox();
  assert(canvasBounds, "Pixi canvas is unavailable");
  const startup = await state();
  const slot = startup.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, `slot-1 must be enabled: ${JSON.stringify(startup.startup)}`);
  const geometry = await stageGeometry(page, canvasBounds);
  const slotCenter = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotCenter.x, slotCenter.y);
  await waitForState(
    (value) => value.mode === "town" && value.town?.name === "HolyCity" &&
      value.overlay === null && value.locked === false,
    "matched native save did not settle in Holy City",
  );
  // The native capture waits six seconds after slot load, by which point the resumptive day
  // notification is gone. Drain the browser's deterministic queue to compare the same visual state.
  await advance(12_000);

  const nodeCenter = (label) => page.evaluate((wanted) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && visible(node)) {
        const bounds = node.getBounds();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  }, label);
  const warpCenter = await nodeCenter("town:HolyCity:menu:TownWarpMenuItem");
  assert(warpCenter, "Holy City Warp Gate icon is not physically reachable");

  await page.screenshot({
    path: path.join(outputDirectory, "frame-00-before-touch.png"),
    timeout: 120_000,
  });
  await page.mouse.click(canvasBounds.x + warpCenter.x, canvasBounds.y + warpCenter.y);

  let overlayFrame = -1;
  for (let frame = 1; frame <= 60; frame++) {
    await advance(1_000 / 60);
    const current = await state();
    if (current.overlay?.kind === "townWarp" && overlayFrame < 0) overlayFrame = frame;
    await page.screenshot({
      path: path.join(outputDirectory, `frame-${String(frame).padStart(2, "0")}.png`),
      timeout: 120_000,
    });
    if (overlayFrame > 0 && frame >= overlayFrame + 12) break;
  }
  assert(overlayFrame > 0, "Warp picker did not become visible in the frame capture window");

  const snapshot = await state();
  assert.equal(snapshot.overlay.kind, "townWarp");
  const actualCounts = Object.fromEntries(
    snapshot.overlay.destinations.map(({ townName, questCount }) => [townName, questCount]),
  );
  assert.deepEqual(actualCounts, expectedCounts);
  assert.deepEqual(snapshot.guildQuests.activeQuestNames, ["LiberateTownsQuest"]);
  assert.equal(snapshot.guildQuests.finishedQuestNames.length, 82);
  assert(snapshot.overlay.destinations.every(({ questBadgeVisible }) => questBadgeVisible === true));
  assert.deepEqual(errors, []);

  fs.writeFileSync(path.join(outputDirectory, "result.json"), JSON.stringify({
    nativeSave,
    overlayFrame,
    counts: actualCounts,
    errors,
  }, null, 2));
  console.log(`town-warp-endgame: PASS (first picker frame ${overlayFrame}; ${JSON.stringify(actualCounts)})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
