// Opt-in regression using an operator-owned earned checkpoint. Never touches its original profile.
// DIB_DUNGEON_RESTORE_SAVE is a campaign *-saves.json containing a pending dungeon treasure.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
const input = process.env.DIB_DUNGEON_RESTORE_SAVE;
assert(input, "Set DIB_DUNGEON_RESTORE_SAVE to the earned pending-loot *-saves.json");
const saves = JSON.parse(fs.readFileSync(input, "utf8"));
const [saveKey, raw] = Object.entries(saves).find(([key]) => key.endsWith(":slot-1")) ?? [];
assert(raw, "Fixture has no slot-1");
const before = JSON.parse(raw).state;
assert(before.dungeon?.current, "Fixture has no active dungeon");
const mode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_DUNGEON_RESTORE_OUTPUT ?? `output/dungeon-pending-loot-restore-${mode}`);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text()); });
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const advance = async (ms = 100) => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(10); };
const control = label => page.evaluate(label => {
  const app = window.__PIXI_APP__; app.render(); const stack = [app.stage];
  while (stack.length) {
    const node = stack.pop(); if (!node.visible || !node.renderable) continue;
    if (node.label === label) {
      const b = node.getBounds(), x = b.x + b.width / 2, y = b.y + b.height / 2;
      // Source PopupMenu rows are inert; their containing menu owns coordinate arbitration.
      let owner = node;
      while (owner && !["pointertap", "pointerdown", "pointerup"].some(type => owner.listenerCount?.(type))) owner = owner.parent;
      let target = app.renderer.events.rootBoundary.hitTest(x, y), ownsHit = false;
      const hitPath = [];
      for (; target; target = target.parent) { hitPath.push(target.label); if (target === owner) ownsHit = true; }
      const c = app.canvas.getBoundingClientRect();
      return { x: c.x + x * c.width / app.screen.width, y: c.y + y * c.height / app.screen.height, ownsHit, hitPath };
    }
    if (node.children) stack.push(...node.children);
  }
  return null;
}, label);
async function click(label) {
  const p = await control(label); assert(p?.ownsHit, `${label} blocked: ${JSON.stringify(p)}`);
  await page.mouse.click(p.x, p.y); await advance(300);
}
async function launch() {
  await loadLocalContent(page);
  for (let i = 0; i < 200 && (await state()).startup?.phase !== "title"; i++) await advance();
  await advance(600); await click("sourceTitleTouchLayer");
  for (let i = 0; i < 200 && (await state()).startup?.phase !== "save-select"; i++) await advance();
  await advance(600); await click("sourcePopupButton:slot-1");
  for (let i = 0; i < 200; i++) {
    await advance();
    const s = await state();
    if (s.mode === "dungeon" && !(await control("startupTransitionShade"))) return s;
  }
  throw new Error(`Dungeon restore never released startup shade: ${JSON.stringify(await control("popupButton:Take All"))}`);
}
let result;
try {
  await page.addInitScript(({ saves, mode }) => {
    window.advanceTime = () => Promise.resolve(); window.__DIB_TEST_WORLD_DEMO__ = true;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode: mode, sound: 0, music: 0 }));
    if (!localStorage.getItem("dib-pending-loot-fixture-installed")) {
      for (const [key, value] of Object.entries(saves)) localStorage.setItem(key, value);
      localStorage.setItem("dib-pending-loot-fixture-installed", "1");
    }
  }, { saves, mode });
  await page.goto(process.env.DIB_WEB_URL ?? "http://127.0.0.1:15303");
  await launch();
  await page.screenshot({ path: path.join(output, "restored.png") });
  let tookLoot = false, closedCatch = false;
  for (let i = 0; i < 300; i++) {
    const take = await control("popupButton:Take All"), close = await control("catchQuestClose");
    if (close?.ownsHit) { await click("catchQuestClose"); closedCatch = true; }
    else if (take?.ownsHit) { await click("popupButton:Take All"); tookLoot = true; }
    else if ((await state()).floorDetectionChat) await page.keyboard.press("Enter");
    const s = await state();
    if (tookLoot && !s.lootProvider && !s.popups.persistent.depth && !s.locked) break;
    await advance();
  }
  assert(tookLoot, "Pending treasure could not be collected by a real pointer click");
  const settled = await state();
  assert(!settled.lootProvider && !settled.popups.persistent.depth, "Restored popups did not settle");
  const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert(saved.state.player.profile.silver > before.player.profile.silver, "Silver reward was not persisted");
  await page.screenshot({ path: path.join(output, "collected.png") });
  await page.reload(); await launch();
  for (let i = 0; i < 100; i++) {
    const close = await control("catchQuestClose");
    if (close?.ownsHit) await click("catchQuestClose");
    else if ((await state()).floorDetectionChat) await page.keyboard.press("Enter");
    await advance();
  }
  assert(!(await state()).lootProvider, "Collected treasure reopened after reload");
  const reloaded = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(reloaded.state.player.profile.silver, saved.state.player.profile.silver, "Reload duplicated the reward");
  assert.deepEqual(errors, []);
  result = { passed: true, closedCatch, silverBefore: before.player.profile.silver,
    silverAfter: saved.state.player.profile.silver, errors };
} catch (error) { result = { passed: false, error: error.stack ?? String(error), errors }; process.exitCode = 1; }
finally {
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(output, "state.json"), JSON.stringify(await state().catch(() => null), null, 2));
  await page.screenshot({ path: path.join(output, "final.png") }); await browser.close();
  console.log(JSON.stringify(result));
}
