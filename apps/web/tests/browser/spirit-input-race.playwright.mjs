// Opt-in regression for the earned Official summon/ability race (campaign input 7792).
// Run against Vite dev: the fixture delays AssetLibrary.sprite, never changes battle outcomes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const root = path.resolve(import.meta.dirname, "../../../..");
const mode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_SPIRIT_RACE_OUTPUT ?? `output/spirit-input-race-${mode}`);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
let result;
try {
  await page.addInitScript(mode => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode: mode, sound: 0, music: 0 }));
    window.__DIB_TEST_ENCOUNTER__ = { backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "BlueDragonling", level: 20 }],
      enemyTeam: [{ shortType: "Minotaur", level: 50 }] };
    window.__DIB_TEST_PLAYER_PROFILE__ = { heroLevel: 20, monsterPartyLevels: [20], silver: 0, gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 }, tutorialFlags: ["Tutorial0", "Tutorial1"],
      spiritReadiness: 1, spiritTierLevels: { Resistance: 5 } };
  }, mode);
  await page.goto(process.env.DIB_WEB_URL ?? "http://127.0.0.1:15306");
  await loadLocalContent(page);
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
  await advance(3500);
  const box = await page.locator("canvas").first().boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let s;
  for (let i = 0; i < 2000; i++) {
    s = await state();
    assert.deepEqual(errors, []);
    if (s.mode === "battle" && s.presentation.state === "awaitingPlayerChoice" && s.panelVisible) break;
    await advance(25);
  }
  assert.equal(s.presentation?.state, "awaitingPlayerChoice");
  const geometry = await stageGeometry(page, box);
  const click = async point => { const p = geometry.toCss(point); await page.mouse.click(p.x, p.y); };
  await click(s.spirit.panelHero.point);
  for (let i = 0; i < 100 && (await state()).activePopup !== "spiritMenu"; i++) await advance(25);
  await advance(600);
  s = await state();
  const spirit = s.spirit.menu.buttons.find(button => button.label.startsWith("Resistance"));
  assert(spirit);
  await page.evaluate(async moduleUrl => {
    const { AssetLibrary } = await import(moduleUrl);
    const original = AssetLibrary.prototype.sprite;
    const gate = new Promise(resolve => { window.__releaseSpiritSprite = resolve; });
    AssetLibrary.prototype.sprite = async function(name) {
      if (name === "Resistance-hd") {
        window.__spiritSpriteHeld = true;
        await gate;
      }
      return original.call(this, name);
    };
  }, `/@fs/${root.replaceAll("\\", "/")}/packages/renderer/src/assetLibrary.ts`);
  await click(spirit);
  await page.waitForFunction(() => window.__spiritSpriteHeld === true);
  await advance(600); // Let the closing menu stop swallowing the rapid ability tap.
  const held = await state();
  assert.equal(held.spirit.selectionPending, true);
  assert(held.summonIds[0]?.endsWith(":Resistance"));
  assert.equal(held.friendlySummon, null, "Fixture must hold construction before the card exists");
  const ability = held.abilityButtons.find(button => button.slot === 3) ?? held.abilityButtons[0];
  assert(ability);
  await click(ability.center);
  await page.keyboard.press(String(ability.slot));
  await advance(50);
  const during = await state();
  assert.deepEqual(errors, []);
  assert.equal(during.presentation.state, "awaitingPlayerChoice");
  assert.equal(during.picking, false);
  assert.equal(during.activeActorId, held.activeActorId);
  assert.equal(during.battleInput.playerAbilitySubmissionCount, held.battleInput.playerAbilitySubmissionCount);
  await page.screenshot({ path: path.join(output, "held-input.png") });
  await page.evaluate(() => window.__releaseSpiritSprite());
  for (let i = 0; i < 300 && (await state()).spirit.selectionPending; i++) await advance(25);
  const ready = await state();
  assert.equal(ready.spirit.selectionPending, false);
  assert(ready.friendlySummon?.id.endsWith(":Resistance"));
  assert(ready.turnOrderEntries.some(entry => entry.id === ready.friendlySummon.id));
  await click(ability.center);
  await advance(50);
  const picking = await state();
  assert.equal(picking.presentation.state, "targetPicking");
  const target = picking.monsters.find(monster => monster.team === 1 && monster.hp > 0);
  await click(target.targetPoint);
  await advance(100);
  const after = await state();
  assert(after.battleInput.playerAbilitySubmissionCount > held.battleInput.playerAbilitySubmissionCount);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "resumed-input.png") });
  result = { pass: true, mode, held, during, ready, after, errors };
} catch (error) {
  result = { pass: false, mode, error: error.stack, errors };
  await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  await browser.close();
}
console.log(`spirit-input-race: PASS (${mode}, delayed display blocks inputs, release resumes same turn)`);
