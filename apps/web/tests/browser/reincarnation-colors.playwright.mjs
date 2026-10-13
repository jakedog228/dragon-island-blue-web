// Earned-campaign regression: a full enemy row casts Reincarnation. CallMonster first benches
// a new identity; sacrificeChance then removes the caster and promotes that identity. Presentation
// must release the caster's color before displaying the replacement, despite the final engine
// roster already showing it as active when the monsterAdded event is replayed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { loadLocalContent } from "./localContent.mjs";
const output = path.resolve(process.env.DIB_REINCARNATION_OUTPUT ?? "output/reincarnation-colors");
const displayMode = process.env.DIB_DISPLAY_MODE ?? "iphone";
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text()); });
let snapshot, result;
try {
  await page.addInitScript(displayMode => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode, sound: 0, music: 0 }));
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "ForestCombat",
      playerTeam: Array.from({ length: 3 }, () => ({ shortType: "SpikeBall", level: 50 })),
      enemyTeam: Array.from({ length: 3 }, () => ({ shortType: "DevilWorm", level: 20 })),
    };
  }, displayMode);
  await page.goto(process.env.DIB_WEB_URL ?? "http://127.0.0.1:15303");
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
  await advance(3500);
  await page.mouse.click(480, 320);
  const box = await page.locator("canvas").first().boundingBox();
  const geometry = await stageGeometry(page, box);
  let replacement, removed, settled = false;
  for (let i = 0; i < 6000; i++) {
    snapshot = await state();
    assert.deepEqual(errors, [], `Browser errors: ${errors.join(" | ")}`);
    if (snapshot.mode !== "battle") { await advance(100); continue; }
    replacement ??= snapshot.monsters.find(m => m.team === 1 && !/^t1m[012]:DevilWorm$/.test(m.id))?.id;
    removed ??= snapshot.monsters.find(m => m.team === 1 && /^t1m[012]:DevilWorm$/.test(m.id) && m.hp === 0)?.id;
    if (replacement && removed && snapshot.presentation.state === "awaitingPlayerChoice" && !snapshot.turnOrderAnimating) {
      // Source reserve entry starts after a separate 1s delay; player choice can resume first.
      // Let that presentation finish without submitting another turn.
      await advance(2000);
      snapshot = await state();
      assert.deepEqual(errors, [], `Browser errors: ${errors.join(" | ")}`);
      const members = snapshot.enemyMemberPositions.filter(member => member.parented);
      assert.equal(members.length, 3, "Reincarnation must finish with exactly three field displays");
      assert(members.some(member => member.id === replacement));
      assert(!members.some(member => member.id === removed));
      const expected = [0x7070bf, 0xbf4b4b, 0x4bbf4b][Number(removed.match(/^t1m(\d+)/)[1])];
      assert.equal(snapshot.turnOrderEntries.find(entry => entry.id === replacement)?.labelFill, expected,
        "Reincarnation replacement did not inherit the sacrificed caster's color");
      settled = true; break;
    }
    if (snapshot.statusText.visible) await page.keyboard.press("Enter");
    else if (snapshot.presentation.state === "awaitingPlayerChoice" && snapshot.panelVisible && !snapshot.turnOrderAnimating) {
      const guard = snapshot.abilityButtons.find(button => button.abilityPath === "Defensive.GuardUp");
      assert(guard, "Spike Ball's harmless guard card is missing");
      const p = geometry.toCss(guard.center); await page.mouse.click(p.x, p.y);
    }
    await advance(100);
  }
  assert(settled, "No complete enemy Reincarnation observed");
  result = { passed: true, replacement, removed, errors };
} catch (error) {
  result = { passed: false, error: error.stack ?? String(error), errors };
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "state.json"), JSON.stringify(snapshot, null, 2));
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(output, "final.png") });
  await browser.close();
  console.log(JSON.stringify(result));
}
