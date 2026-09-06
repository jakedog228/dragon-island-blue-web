// Opt-in Guild quest foundation smoke check. Run only with operator authorization; Chromium is
// muted. The maintained custom package's Harbor_Town first quest is ChoosePartner.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
// Harbor_Town/ChoosePartner belong to the maintained clean-room package, not to the retail
// IPA. `loadLocalContent` otherwise falls back to the first IPA/ZIP at the repository root,
// so an unset archive silently ran this against content that cannot satisfy the fixture and
// the failure read as an empty quest array. Demand the archive by name instead.
const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "clean_room/CinderHarbor_RuntimeCompatible.ipa"),
);
assert(
  fs.existsSync(archive),
  `missing the maintained custom package this scenario asserts against: ${archive}. ` +
    "Build it per docs/content-package-authoring.md, or point DIB_CONTENT_ARCHIVE at a " +
    "package whose Harbor_Town first quest is ChoosePartner. The retail IPA has neither name.",
);
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
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    // This file asserts quest state, not the source intro. `main.ts` gates the plot/pick-dragon
    // flow on this flag precisely so a fixture can reach the world without walking it.
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_GUILD_QUEST_TOWN__ = "Harbor_Town";
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page, archive);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advanceUntil = async (predicate, description, iterations = 400) => {
    for (let index = 0; index < iterations; index++) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await page.evaluate(() => window.advanceTime(25));
      if (index % 10 === 0) await page.waitForTimeout(2);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}`);
  };
  // The world demo starts behind the source title, and the guild-quest state this file asserts
  // belongs to the running game rather than to the startup shell -- `guildQuests` only appears
  // once a slot has launched. Continue through the title the way a player does before reading it.
  await advanceUntil((value) => value.startup?.phase === "title", "startup never reached the title");
  await page.keyboard.press("Enter");
  const snapshot = await advanceUntil(
    (value) => value.guildQuests !== undefined,
    "world demo never published its guild-quest state",
  );
  assert.deepEqual(
    snapshot.guildQuests.activeQuestNames,
    ["ChoosePartner"],
    `archive=${archive} did not start Harbor_Town's ChoosePartner: ${JSON.stringify(snapshot)}`,
  );
  assert.deepEqual(snapshot.guildQuests.completedActiveQuestNames, []);
  assert.deepEqual(snapshot.guildQuests.finishedQuestNames, []);
  assert.deepEqual(snapshot.guildQuests.usableQuestKeys, []);
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
