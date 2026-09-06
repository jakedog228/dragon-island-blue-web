// Opt-in Guild progression/banner fixture. Do not run without operator authorization.
// Requires an original-format archive in DIB_CONTENT_ARCHIVE; Chromium is always muted.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone", textResolutionMode: "modern", sound: 0, music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    // Continuing from the title lands in the source new-game plot, which this file has no reason
    // to walk: it asserts quest progress, and `main.ts` gates that intro on this flag so a fixture
    // can reach the world directly.
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_GUILD_QUEST_NAMES__ = ["Defeat20Monsters"];
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  for (let i = 0; i < 300; i++) {
    const snapshot = await state();
    if (snapshot.startup?.phase === "title") break;
    await page.waitForTimeout(25);
    await advance(25);
  }
  await page.keyboard.press("Enter");
  for (let i = 0; i < 300; i++) {
    const snapshot = await state();
    if (snapshot.mode === "world") break;
    await page.waitForTimeout(25);
    await advance(25);
  }

  let snapshot = await state();
  assert.equal(snapshot.guildQuests.activeQuests[0].progress, "0 of 10 monsters defeated");
  await page.evaluate(() => window.__DIB_TEST_FIRE_GUILD_QUEST_EVENT__({
    id: 0,
    target: { shortType: "FireCub", inEnemyDeadMembers: true },
  }));
  snapshot = await state();
  assert.equal(snapshot.guildQuests.activeQuests[0].progress, "1 of 10 monsters defeated");
  assert.deepEqual(snapshot.guildQuests.notification, {
    kind: "progress",
    questName: "Defeat20Monsters",
    title: 'Progress On Quest "Defeat 10 Monsters"',
    message: "1 of 10 monsters defeated",
    image: "Icon@2x.png",
    visible: true,
  });
  assert.equal(snapshot.guildQuests.queuedNotificationCount, 0);
  await advance(3_000);
  assert.equal((await state()).guildQuests.notification, undefined);
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("guild-quest-progress: PASS (0 -> 1 persistence text + top FIFO banner)");
} finally {
  await browser.close();
}
