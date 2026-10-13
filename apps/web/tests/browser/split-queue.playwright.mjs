// Regression: acknowledge status while an older queue flip overlaps a new Split impact.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";
const displayMode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_SPLIT_QUEUE_OUTPUT ?? `output/split-queue-${displayMode}`);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
let snapshot, result;
try {
  await page.addInitScript(displayMode => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_BATTLE_SEED__ = 7;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode, sound: 0, music: 0 }));
    window.__DIB_TEST_ENCOUNTER__ = { backgroundKey: "BeachCombat",
      playerTeam: Array.from({ length: 3 }, () => ({ shortType: "Penguin", level: 150 })),
      enemyTeam: Array.from({ length: 2 }, () => ({ shortType: "KingSlime", level: 10 })) };
  }, displayMode);
  await page.goto(process.env.DIB_WEB_URL ?? "http://127.0.0.1:15306");
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
  await advance(3500);
  await page.mouse.click(480, 320);
  const box = await page.locator("canvas").first().boundingBox();
  const geometry = await stageGeometry(page, box);
  let splitObserved = false, cloned = false, acknowledgments = 0, settledAfterClone = 0;
  for (let i = 0; i < 6000; i++) {
    snapshot = await state();
    if (i % 100 === 0) fs.writeFileSync(path.join(output, "live.json"), JSON.stringify(snapshot, null, 2));
    assert.deepEqual(errors, []);
    splitObserved ||= snapshot.activeAbilityPath === "Utility.AddMonster";
    cloned ||= snapshot.monsters.some(monster => /^t1m([2-9]|[1-9][0-9]+):KingSlime$/.test(monster.id));
    if (cloned && ++settledAfterClone > 150 && acknowledgments >= 6) break;
    if (snapshot.mode === "battle") {
      if (snapshot.statusText.visible) { await page.keyboard.press("Enter"); acknowledgments++; }
      else if (snapshot.presentation.state === "awaitingPlayerChoice" && snapshot.panelVisible && !snapshot.turnOrderAnimating) {
        const guard = snapshot.abilityButtons.find(button => button.abilityPath === "Utility.Analyze");
        assert(guard, "Penguin's harmless Analyze is missing");
        const point = geometry.toCss(guard.center); await page.mouse.click(point.x, point.y);
      }
    }
    await advance(100);
  }
  assert(splitObserved && cloned, "Fixture must exercise a queued KingSlime Split");
  assert(acknowledgments >= 6 && settledAfterClone > 150, "Queue did not survive rapid status acknowledgments");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "settled.png") });
  result = { passed: true, displayMode, splitObserved, cloned, acknowledgments, settledAfterClone, errors };
} catch (error) {
  result = { passed: false, displayMode, error: error.stack ?? String(error), errors };
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "state.json"), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(output, "final.png") });
  await browser.close();
  console.log(JSON.stringify(result));
}
