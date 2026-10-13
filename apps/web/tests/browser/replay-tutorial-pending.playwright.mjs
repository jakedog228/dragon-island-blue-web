// Isolated Offline fixture: delay real Replay Battle popup mounting. This uses the Vite
// module to wrap a presentation method; it is not Official network or campaign evidence.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { clickNativeLabel } from "./nativeLabelInput.mjs";
import { stageGeometry } from "./stageGeometry.mjs";
import { createFrameCapture } from "./captureFrame.mjs";
const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15306";
const mode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(`output/replay-tutorial-pending-${mode}`);
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const capture = await createFrameCapture(page, output);
const errors = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
const wait = async predicate => {
  for (let i = 0; i < 1600; i++) {
    const s = await state(); assert.deepEqual(errors, []);
    if (predicate(s)) return s;
    await advance(50);
  }
  throw new Error("Replay tutorial fixture did not settle");
};
const tap = async label => assert(await clickNativeLabel(page, label), `Missing ${label}`);
let result;
try {
  await page.addInitScript(mode => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode: mode, sound: 0, music: 0 }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    window.__DIB_TEST_POI_NAME__ = "1-1_Field_1";
    window.__DIB_TEST_WORLD_POI_WINS__ = { "1-1_Field_1": 1 };
    window.__DIB_TEST_WORLD_COMPLETED_POIS__ = ["1-1_Field_1"];
    window.__DIB_TEST_WORLD_SEED__ = 7;
    window.__DIB_TEST_WORLD_PARTY__ = { size: 3, battingOrderSize: 3, levelRange: [100,100] };
    window.__DIB_TEST_PLAYER_PROFILE__ = { heroLevel: 100, monsterPartyLevels: [100,100,100],
      silver: 1000, gold: 200, captureCards: { 1: 1, 2: 0, 3: 0 },
      tutorialFlags: ["Tutorial0", "Tutorial1", "Tutorial2", "flashTownExit"] };
  }, mode);
  await page.goto(url); await loadLocalContent(page);
  await wait(s => s.startup?.phase === "title");
  await advance(500); await tap("sourceTitleTouchLayer");
  await wait(s => ["save-select", "pick-dragon"].includes(s.startup?.phase) || s.mode === "world");
  if ((await state()).startup?.phase === "save-select") {
    await advance(400); await tap("sourcePopupButton:slot-1");
  }
  if ((await state()).startup?.phase === "pick-dragon") await tap("starter:BlueBabyDragon");
  await wait(s => s.mode === "world" && !s.locked && !s.walking);
  await page.evaluate(async () => {
    const loadedModule = performance.getEntriesByType("resource").map(entry => entry.name)
      .find(name => /\/src\/world\/worldNode\.(?:js|ts)(?:\?|$)/.test(name));
    if (!loadedModule) throw new Error("Vite WorldNode module was not observed");
    const { WorldNode } = await import(loadedModule);
    const original = WorldNode.prototype.mountReplayBattleTutorial;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    window.__REPLAY_PENDING_PROBE__ = { calls: 0, release };
    WorldNode.prototype.mountReplayBattleTutorial = async function () {
      window.__REPLAY_PENDING_PROBE__.calls++;
      await gate;
      return original.call(this);
    };
  });
  const geometry = await stageGeometry(page, await page.locator("canvas").first().boundingBox());
  const poi = async name => {
    const target = (await state()).pois.find(poi => poi.name === name);
    assert(target); const p = geometry.toCss(target.position);
    await page.mouse.click(p.x, p.y);
  };
  await poi("1-1_Field_2");
  await wait(s => s.currentPoi === "1-1_Field_2" && !s.walking);
  assert.equal(await page.evaluate(() => window.__REPLAY_PENDING_PROBE__.calls), 1);
  await advance(2000);
  await poi("1-1_Field_1"); await advance(1000);
  const pending = await state();
  await capture("pending.png");
  assert.equal(pending.currentPoi, "1-1_Field_2", "Navigation escaped pending tutorial");
  assert.equal(pending.inputBlockers.modalOpening, true);
  assert.equal(pending.transitionFailure ?? null, null);
  await page.evaluate(() => window.__REPLAY_PENDING_PROBE__.release());
  await wait(s => s.overlay?.popups?.stack?.at(-1)?.contentLabel === "replayBattleTutorial");
  await advance(600); await page.evaluate(() => window.__PIXI_APP__.render());
  await capture("tutorial.png"); await tap("popupButton:Ok"); await advance(400);
  await poi("1-1_Field_1");
  await wait(s => s.currentPoi === "1-1_Field_1" && !s.walking);
  assert.equal(await page.evaluate(() => window.__REPLAY_PENDING_PROBE__.calls), 1);
  assert.deepEqual(errors, []);
  result = { passed: true, mode, tutorialMounts: 1, blockedThenNavigated: true, errors };
} catch (error) {
  result = { passed: false, mode, error: error.stack ?? String(error), errors }; process.exitCode = 1;
} finally {
  await capture("final.png").catch(() => {});
  fs.writeFileSync(path.join(output, "final.json"), JSON.stringify(await state().catch(() => null), null, 2));
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result)); await browser.close();
}
