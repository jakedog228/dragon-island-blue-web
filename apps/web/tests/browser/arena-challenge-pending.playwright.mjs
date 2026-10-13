


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { clickNativeLabel, waitNativeLabel } from "./nativeLabelInput.mjs";
import { createFrameCapture } from "./captureFrame.mjs";
const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15306";
const mode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_ARENA_PENDING_OUTPUT ?? `output/arena-challenge-pending-${mode}`);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const captureFrame = await createFrameCapture(page, output);
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
const tap = async label => assert(await clickNativeLabel(page, label), `Missing ${label}`);
const wait = async predicate => {
  for (let i = 0; i < 1600; i++) {
    const s = await state(); assert.deepEqual(errors, []);
    if (predicate(s)) return s;
    await advance(50);
  }
  throw new Error(`State did not settle: ${JSON.stringify(await state()).slice(0, 700)}`);
};
let result;
try {
  await page.addInitScript(mode => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode: mode, sound: 0, music: 0 }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_WORLD_NAME__ = "World_1-2";
    window.__DIB_TEST_POI_NAME__ = "Capital_City";
    window.__DIB_TEST_WORLD_SEED__ = 0x4152454e;
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 5;
    window.__DIB_TEST_WORLD_PARTY__ = { size: 1, battingOrderSize: 1, levelRange: [100,100],
      members: [{ shortType: "Cockatrice", level: 100 }] };
    window.__DIB_TEST_PLAYER_PROFILE__ = { heroLevel: 3, monsterPartyLevels: [100], silver: 2000,
      gold: 1000, captureCards: { 1: 0, 2: 0, 3: 0 }, highestCapturedLevels: {}, licenseType: "Novice",
      tutorialFlags: ["FirstShop", "FirstCharacterDisplay", "Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"] };
  }, mode);
  await page.goto(url); await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await wait(s => s.startup?.phase === "title");
  await advance(500); await tap("sourceTitleTouchLayer");
  await wait(s => ["save-select", "pick-dragon"].includes(s.startup?.phase) || s.mode === "town");
  if ((await state()).startup?.phase === "save-select") {
    await advance(500); await tap("sourcePopupButton:slot-1");
  }
  await wait(s => s.startup?.phase === "pick-dragon" || s.mode === "town");
  if ((await state()).startup?.phase === "pick-dragon") await page.keyboard.press("1");
  await wait(s => s.mode === "town" && !s.locked);
  for (let frame = 0; frame < 240; frame++) await advance(50);
  for (let pageIndex = 0; pageIndex < 16 && (await state()).inputBlockers.activeTownEnterChat; pageIndex++) {
    await advance(600); await tap("guildQuestChat"); await advance(100);
  }
  await wait(s => !s.locked && !s.inputBlockers.modalOpening && !s.inputBlockers.hasModal);
  fs.writeFileSync(path.join(output, "before-arena.json"), JSON.stringify(await state(), null, 2));
  await tap("town:Capital_City:menu:ArenaMenuItem");
  await waitNativeLabel(page, "guildQuestChat"); await advance(600); await tap("guildQuestChat");
  await wait(s => s.overlay?.currentLicense && !s.inputBlockers?.modalOpening);
  // Delay the same scene-owned callback that waits for the Official start command. This is
  // latency instrumentation only: releasing it calls the original callback with its exact request.
  await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    const arena = (() => {
      while (stack.length) {
        const node = stack.pop();
        if (node.label === "arena") return node;
        if (node.children) stack.push(...node.children);
      }
    })();
    if (!arena?.opts?.owner?.deps?.onArenaChallenge) throw new Error("Arena owner is not mounted");
    const owner = arena.opts.owner, original = owner.deps.onArenaChallenge;
    let release; const gate = new Promise(resolve => { release = resolve; });
    window.__ARENA_PENDING_PROBE__ = { calls: 0, release };
    owner.deps.onArenaChallenge = async request => {
      window.__ARENA_PENDING_PROBE__.calls++;
      await gate; return original(request);
    };
  });
  await tap("arena:battle");
  assert.equal(await page.evaluate(() => window.__ARENA_PENDING_PROBE__.calls), 1);
  await advance(2000);
  await tap("town:Capital_City:exit");
  await advance(1500);
  if ((await state()).mode === "town") await tap("town:Capital_City:menu:StoreMenuItem");
  await advance(500);
  const pending = await state();
  fs.writeFileSync(path.join(output, "pending.json"), JSON.stringify(pending, null, 2));
  await captureFrame("pending.png");
  assert.equal(pending.mode, "town", "Town input escaped the pending Arena handoff");
  assert.equal(pending.locked, true);
  assert.equal(pending.overlay, null, "A second menu opened over pending combat");
  assert.equal(pending.transitionFailure ?? null, null);
  await page.evaluate(() => window.__ARENA_PENDING_PROBE__.release());
  await wait(s => s.mode === "battle" && s.buildPhase === "ready");
  for (let step = 0; step < 1600; step++) {
    const s = await state();
    if (s.presentation?.state === "awaitingPlayerChoice") break;
    if (s.activePopup === "encounterChat") { await advance(600); await tap("guildQuestChat"); }
    else await advance(50);
  }
  assert.equal((await state()).presentation.state, "awaitingPlayerChoice");
  // AwaitingPlayerChoice starts before its ability-card entrance finishes.
  for (let frame = 0; frame < 12; frame++) await advance(50);
  await page.evaluate(() => window.__PIXI_APP__.render());
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => window.__ARENA_PENDING_PROBE__.calls), 1);
  result = { passed: true, mode, handoffs: 1, townStayedLocked: true, errors };
} catch (error) {
  result = { passed: false, mode, error: error.stack ?? String(error), errors }; process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(output, "final.json"), JSON.stringify(await state(), null, 2));
  await captureFrame("final.png");
  await browser.close(); console.log(JSON.stringify(result));
}
