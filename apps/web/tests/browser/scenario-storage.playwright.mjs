

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
if (!archive) throw new Error("Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

async function clickStageLabel(page, label) {
  const point = await page.evaluate((wanted) => {
    let result = null;
    const visit = (node) => {
      if (result || node.destroyed || node.visible === false) return;
      if (node.label === wanted) {
        const bounds = node.getBounds();
        result = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        return;
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return result;
  }, label);
  assert(point, `visible stage label ${label} was not found`);
  await page.mouse.click(point.x, point.y);
}

try {
  for (const scenario of [
    { kind: "egg", ready: (state) => state.overlay?.open === true && state.overlay?.phase === "rolling" },
    { kind: "arena", ready: (state) => state.overlay?.open === true &&
      state.overlay?.buttons?.some((button) => button.action === "battle") },
    { kind: "combat", ready: (state) => state.mode === "battle" },
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon")) {
        errors.push(`console: ${message.text()}`);
      }
    });
    await page.addInitScript(() => {
      window.advanceTime = () => Promise.resolve();
      // This contract exercises Scenario transport, not first-visit dialogue choreography.
      window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1", "HaraldDefeated"];
    });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="asset-archive"]').setInputFiles(archive);
    await page.locator('input[name="save-mode"][value="scenario"]').check();
    await page.locator('select[name="scenario-kind"]').selectOption(scenario.kind);
    await page.locator('select[name="scenario-transport"]').selectOption("online");
    await page.getByRole("checkbox", {
      name: "I have the right to use the content in this archive on this device.",
    }).check();
    await page.getByRole("button", { name: "Run Scenario", exact: true }).click();

    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const deadline = Date.now() + 90_000;
    let snapshot;
    while (Date.now() < deadline) {
      snapshot = await state();
      if (scenario.ready(snapshot)) break;
      if (scenario.kind === "arena" && snapshot.overlay?.kind === "townEnterChat") {
        await page.evaluate(() => window.advanceTime(550));
        await clickStageLabel(page, "guildQuestChat");
      } else if (scenario.kind === "arena" && snapshot.activePopup === "guildQuestChat") {
        await page.keyboard.press("Enter");
      }
      await page.evaluate(() => window.advanceTime(25));
      await page.waitForTimeout(1);
    }
    assert(snapshot && scenario.ready(snapshot), `${scenario.kind} did not launch: ${JSON.stringify(snapshot)}`);
    assert.equal(snapshot.scenario.kind, scenario.kind);
    assert.equal(snapshot.scenario.transport, "online");
    assert.equal(snapshot.scenario.transient, true);
    assert.equal(errors.length, 0, errors.join("\n"));
    await page.close();
  }
  console.log("Scenario storage matrix passed");
} finally {
  await browser.close();
}
