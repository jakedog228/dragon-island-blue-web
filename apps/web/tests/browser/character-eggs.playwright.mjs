// Opt-in only. New-save intro ordering, adding character mods to an existing save, and reload.
// Run pnpm mods:examples, start the web client, then node this file. Chromium stays muted.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const workspace = resolve(import.meta.dirname, "../../../..");
const displayMode = process.env.DIB_EGG_DISPLAY_MODE ?? "iphone";
assert(["iphone", "ipad"].includes(displayMode));
const output = resolve(workspace, `output/character-eggs-${displayMode}`);
await mkdir(output, { recursive: true });
const mods = ["pirate-panic-dancer"]
  .map(name => resolve(workspace, `examples/mods/dist/${name}.dibmod`));
const characters = ["PirateMan"];
const browser = await chromium.launch({ headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  for (const existing of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.addInitScript(mode => {
      window.advanceTime = () => Promise.resolve();
      window.__DIB_TEST_WORLD_DEMO__ = true;
      window.__DIB_TEST_WORLD_SEED__ = 17;
      localStorage.setItem("dib.portSettings.v1", JSON.stringify({
        displayMode: mode, textResolutionMode: "modern", sound: 0, music: 0,
      }));
    }, displayMode);
    const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(1); };
    const wait = async (predicate, label) => {
      for (let i = 0; i < 4000; i++) {
        const s = await state(); if (await predicate(s)) return s;
        await advance(25);
      }
      throw new Error(`${label}: ${JSON.stringify(await state())}; ${errors.join(" | ")}`);
    };
    const bounds = label => page.evaluate(label => {
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length) {
        const node = stack.pop();
        if (node.label === label && node.visible && node.renderable) {
          const b = node.getBounds(); const screen = window.__PIXI_APP__.renderer.screen;
          return { x: b.x + b.width / 2, y: b.y + b.height / 2, width: screen.width, height: screen.height };
        }
        stack.push(...(node.children ?? []));
      }
      return null;
    }, label);
    const click = async label => {
      await wait(async () => (await bounds(label)) !== null, label);
      const box = await page.locator("canvas").first().boundingBox(); assert(box);
      const p = await bounds(label);
      // getBounds is already renderer-global pixels, not Cocos battle points.
      await page.mouse.click(box.x + p.x * box.width / p.width, box.y + p.y * box.height / p.height);
    };
    const boot = async (selected, reload = false) => {
      if (reload) await page.reload({ waitUntil: "domcontentloaded" });
      else await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173");
      await loadLocalContent(page, undefined, { modArchives: selected });
      await wait(s => s.startup?.phase === "title", "title");
      await page.keyboard.press("Enter");
      if (reload) {
        await wait(s => s.startup?.phase === "save-select", "save selector");
        await click("sourcePopupButton:slot-1");
      } else {
        await wait(s => s.startup?.phase === "new-game-plot", "intro plot");
        await advance(2050); await page.keyboard.press("Enter");
        await wait(s => s.startup?.phase === "pick-dragon", "starter picker");
        assert.equal((await state()).modStartup, undefined);
        await page.keyboard.press("1");
      }
    };
    await boot(existing ? [] : mods);
    if (existing) {
      await wait(s => s.mode === "town", "unmodded town");
      // Let all startup checkpoints finish before selecting mods for the existing save.
      await advance(1200); await page.waitForTimeout(300);
      await boot(mods, true);
    }
    const received = new Set();
    while (received.size < characters.length) {
      const s = await wait(s => s.modStartup?.eggHatch?.phase === "rolling", "gift reel");
      const type = s.modStartup.character;
      assert(characters.includes(type) && !received.has(type));
      assert.notEqual(s.mode, "town", "town/Leslie started before the gifts finished");
      assert.equal(s.modStartup.eggHatch.kind, "gold");
      assert(s.modStartup.eggHatch.providers.every(p => p.kind === "monster" && p.shortType === type));
      await advance(1800);
      await page.screenshot({ path: resolve(output, `${existing ? "existing" : "new"}-${type}.png`) });
      await click("eggHatch:gold");
      await wait(s => s.modStartup?.eggHatch?.phase === "reward", "prize");
      await advance(400); await click("popupButton:Keep");
      await wait(s => s.modStartup?.eggHatch?.phase === "question", "finished question");
      await advance(400); await click("popupButton:Ok");
      received.add(type);
    }
    let s = await wait(s => s.mode === "town" && !s.modStartup, "town after gifts");
    for (const type of characters) assert.equal(s.player.party.filter(m => m.shortType === type).length, 1);
    if (!existing) await wait(s => s.overlay?.kind === "townEnterChat", "Leslie after gifts");
    await advance(1200); await page.waitForTimeout(300);
    await boot(mods, true);
    s = await wait(s => {
      assert.equal(s.modStartup, undefined, "reload offered a duplicate egg");
      return s.mode === "town";
    }, "reload town");
    for (const type of characters) assert.equal(s.player.party.filter(m => m.shortType === type).length, 1);
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
