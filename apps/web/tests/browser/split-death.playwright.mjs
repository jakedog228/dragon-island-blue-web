// Regression for campaign battle-46: a 1-HP Sludge splits, and its zero-HP clone dies in the
// same event batch before the browser's display roster has registered it. Fixture only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";
const displayMode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_SPLIT_OUTPUT ?? `output/split-death-${displayMode}`);
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
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode, sound: 0, music: 0 }));
    window.__DIB_TEST_ENCOUNTER__ = { backgroundKey: "BeachCombat",
      playerTeam: [{ shortType: "TurtleKing", level: 50 }],
      enemyTeam: [{ shortType: "Sludge", level: 5, currentHp: 1 }] };
  }, displayMode);
  await page.goto(process.env.DIB_WEB_URL ?? "http://127.0.0.1:15306");
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
  await advance(3500);
  await page.mouse.click(480, 320);
  const box = await page.locator("canvas").first().boundingBox();
  const geometry = await stageGeometry(page, box);
  let splitObserved = false, won = false;
  for (let i = 0; i < 6000; i++) {
    snapshot = await state();
    assert.deepEqual(errors, []);
    splitObserved ||= snapshot.activeAbilityPath === "Utility.AddMonster";
    if (snapshot.activePopup === "xpAward") { won = true; break; }
    if (snapshot.mode === "battle") {
      if (snapshot.statusText.visible) await page.keyboard.press("Enter");
      else if (snapshot.presentation.state === "awaitingPlayerChoice" && snapshot.panelVisible && !snapshot.turnOrderAnimating) {
        const guard = snapshot.abilityButtons.find(button => button.abilityPath === "Defensive.GuardUp");
        assert(guard, "Turtle King's harmless guard is missing");
        const point = geometry.toCss(guard.center); await page.mouse.click(point.x, point.y);
      }
    }
    await advance(100);
  }
  assert(splitObserved, "Fixture must exercise Sludge Split");
  assert(won, "Zero-HP split did not reach normal victory/XP settlement");
  assert.equal(snapshot.monsters.filter(monster => monster.team === 1 && monster.hp > 0).length, 0);
  await page.screenshot({ path: path.join(output, "victory.png") });
  fs.writeFileSync(path.join(output, "victory.json"), JSON.stringify(snapshot, null, 2));
  const point = geometry.toCss(snapshot.postBattleButtons[0].point);
  await page.mouse.click(point.x, point.y);
  await advance(3000);
  assert.deepEqual(errors, []);
  result = { passed: true, displayMode, splitObserved, won, errors };
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
