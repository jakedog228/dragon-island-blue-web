import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const root = resolve(import.meta.dirname, "../../../..");
const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(root)
  .map((name) => resolve(root, name)).find((path) => /\.ipa$/i.test(path));
assert(archive && existsSync(archive), "Set DIB_CONTENT_ARCHIVE to your compatible archive");
const mod = resolve(root, "examples/mods/dist/realtime-combat.dibmod");
assert(existsSync(mod), "Run pnpm mods:examples");
const companions = (process.env.DIB_REALTIME_COMPANION_MODS ?? "").split(";").filter(Boolean)
  .map((path) => resolve(root, path));
const berserkQueue = process.env.DIB_REALTIME_BERSERK_QUEUE === "1";
assert(!berserkQueue || !companions.length, "Run the Berserk FIFO fixture without companion mods");
companions.forEach((path) => assert(existsSync(path), `Missing companion mod: ${path}`));
const coParty = companions.length ? [
  companions.some((path) => /pirate-panic-dancer/i.test(path)) ? "PirateMan" : "FireCub",
  companions.some((path) => /cat-berserk-dancer/i.test(path)) ? "Cat" : "FireCub",
  companions.some((path) => /leslie-circle-caster/i.test(path)) ? "Leslie" : "FireCub",
] : undefined;
const displayMode = process.env.DIB_DISPLAY_MODE ?? "iphone";
assert(["iphone", "ipad"].includes(displayMode));
const output = resolve(root, `output/realtime-combat/${displayMode}`);
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (error) => errors.push(error.stack ?? String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript(({ displayMode, coParty, berserkQueue }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode, sound: 0, music: 0 }));
    window.advanceTime = () => {};
    window.__DIB_TEST_BATTLE_SEED__ = 7;
    window.__DIB_TEST_ENCOUNTER__ = {
      backgroundKey: "GrassCombat",
      playerTeam: berserkQueue ? ["FireCub", "Yeti"].map((shortType) => ({ shortType, level: 80 }))
        : coParty ? [...coParty, "FireCub", "FireCub"].map((shortType) => ({ shortType, level: 80 }))
        : Array.from({ length: 5 }, () => ({ shortType: "FireCub", level: 30 })),
      enemyTeam: Array.from({ length: 5 }, () => ({ shortType: "SnowCub", level: 30 })),
    };
  }, { displayMode, coParty, berserkQueue });
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((amount) => window.advanceTime(amount), ms);

    await page.waitForTimeout(5);
    assert.deepEqual(errors, []);
  };
  const wait = async (predicate, label, limit = 1600) => {
    for (let i = 0; i < limit; i++) {
      const current = await state();
      if (predicate(current)) return current;
      if (i % 100 === 99) console.log(label, { phase: current.presentation?.state,
        popup: current.activePopup, picking: current.picking, realtime: current.codeMods?.realtimeCombat });
      if (current.codeMods?.realtimeCombat?.ended) {
        await screenshot("unexpected-terminal");
        throw new Error(`Battle ended while waiting for ${label}`);
      }
      await advance(20);
    }
    throw new Error(`${label}: ${JSON.stringify(await state())}`);
  };
  const screenshot = async (name) => {
    await page.waitForTimeout(50);
    await advance(0);
    // Publish the completed Pixi render to Chromium's compositor; CDP otherwise sometimes
    // captures the preceding canvas frame although the accompanying state is already newer.
    // The fixture's ticker is manual, so these native frames consume no combat time.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      window.__PIXI_APP__.render();
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })));
    const cdp = await page.context().newCDPSession(page);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    writeFileSync(resolve(output, `${name}.png`), Buffer.from(shot.data, "base64"));
    writeFileSync(resolve(output, `${name}.json`), JSON.stringify(await state(), null, 2));
    await cdp.detach();
  };
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.locator('input[name="mod-archives"]').setInputFiles([...companions, mod]);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ state: "visible", timeout: 120000 });
  await page.getByRole("checkbox", { name: "I have the right to use the content in this archive on this device." }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", undefined, { timeout: 120000 });
  await wait((s) => s.mode === "start", "startup");
  await advance(3000);
  const box = await page.locator("canvas").first().boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  if (berserkQueue) {
    let s = await wait((s) => s.codeMods?.realtimeCombat?.readyFriendly.length === 2 &&
      s.panelVisible && s.presentation.state === "awaitingPlayerChoice", "manual ally followed by ready Berserk ally");
    const [manual, berserk] = s.codeMods.realtimeCombat.readyFriendly;
    assert.equal(s.codeMods.realtimeCombat.promptedActor, manual);
    const before = s.codeMods.realtimeCombat;
    await advance(1000);
    s = await state();
    assert.equal(s.codeMods.realtimeCombat.elapsedTu - before.elapsedTu, 50);
    assert.equal(s.codeMods.realtimeCombat.promptedActor, manual);
    assert.equal(s.codeMods.realtimeCombat.tu[berserk], 0, "Berserk ally cut in during the choice");
    assert.deepEqual(s.codeMods.realtimeCombat.readyFriendly, [manual, berserk]);
    await screenshot("berserk-waits-in-line");
    const geometry = await stageGeometry(page, box);
    const click = async (point) => {
      const p = geometry.toCss(point);
      await page.mouse.click(p.x, p.y);
      await page.waitForTimeout(10);
    };
    await click(s.abilityButtons.find((button) => button.slot === 1).center);
    s = await wait((s) => s.picking && s.targetPickerVisuals.outlines.length > 0, "FIFO target picker");
    await click(s.monsters.find((m) => m.team === 1 && m.hp > 0).targetPoint);
    s = await wait((s) => s.codeMods.realtimeCombat.playerActions === 1 &&
      s.codeMods.realtimeCombat.tu[berserk] > 0, "Berserk acts after manual submission");
    assert(s.codeMods.realtimeCombat.tu[manual] > 0);
    await screenshot("berserk-takes-next-turn");
    assert.deepEqual(errors, []);
    console.log("Realtime Berserk FIFO smoke passed", { output });
  } else if (companions.length) {
    const first = await wait((s) => s.codeMods?.realtimeCombat?.automaticActions >= 3 &&
      s.codeMods.realtimeCombat.elapsedTu >= 100, "co-loaded character combat");
    await advance(1000);
    const after = await state();
    assert.equal(after.codeMods.realtimeCombat.elapsedTu - first.codeMods.realtimeCombat.elapsedTu, 50);
    assert(after.codeMods.realtimeCombat.ready.every((id) => after.monsters.some((m) => m.id === id && m.hp > 0)));
    if (after.codeMods.realtimeCombat.promptedActor !== null) {
      assert.equal(after.codeMods.realtimeCombat.promptedActor, after.codeMods.realtimeCombat.readyFriendly[0],
        "Manual and automatic allies must share one FIFO");
    }
    await screenshot("co-load");
    assert.deepEqual(errors, []);
    console.log("Realtime character co-load smoke passed", { companions, output });
  } else {
  let s = await wait((s) => s.codeMods?.realtimeCombat?.readyFriendly.length >= 3 && s.panelVisible,
    "three friendlies waiting");
  const initial = s.codeMods.realtimeCombat;
  assert.equal(initial.promptedActor, initial.readyFriendly[0]);
  assert(initial.automaticActions >= 1, "enemies should attack while the player waits");
  await screenshot("waiting-queue");
  const startTu = initial.elapsedTu;
  await advance(1000);
  s = await state();
  assert.equal(s.codeMods.realtimeCombat.elapsedTu - startTu, 50);
  assert(s.codeMods.realtimeCombat.readyFriendly.every((id) => s.codeMods.realtimeCombat.tu[id] === 0));

  const geometry = await stageGeometry(page, box);
  const click = async (point) => {
    const p = geometry.toCss(point);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(10);
  };
  s = await wait((s) => s.panelVisible && s.presentation.state === "awaitingPlayerChoice", "player controls");
  const first = s.codeMods.realtimeCombat.promptedActor;
  const next = s.codeMods.realtimeCombat.readyFriendly[1];
  const ability = s.abilityButtons.find((button) => button.slot === 1);
  assert(ability, `ability control missing: ${JSON.stringify(s.abilityButtons)}`);
  await click(ability.center);
  assert.equal((await state()).picking, true, "ability centre did not open the picker");
  s = await wait((s) => s.picking && s.targetPickerVisuals.outlines.length > 0, "target picker");
  await screenshot("target-picker-under-fire");
  const target = s.monsters.find((enemy) => enemy.team === 1 && enemy.hp > 0);
  await click(target.targetPoint);
  s = await wait((s) => s.codeMods.realtimeCombat.playerActions === 1 && s.panelVisible, "next friendly");
  assert.equal(s.codeMods.realtimeCombat.promptedActor, next);
  assert(s.codeMods.realtimeCombat.tu[first] > 0);
  await screenshot("next-ready-friendly");

  // Leave a real target picker open across a lethal enemy turn. Its old target callbacks and
  // actor choice must be cancelled before the replacement prompt appears.
  await click(s.abilityButtons.find((button) => button.slot === 1).center);
  await wait((s) => s.picking, "second target picker");
  const invalidationsBefore = s.codeMods.realtimeCombat.invalidatedChoices;

  // Let enemies finish the unattended battle. This crosses multiple friendly deaths, reserve
  // promotions, cancelled prompts and overlapping effects before one terminal transition.
  const actionsBefore = s.codeMods.realtimeCombat.automaticActions;
  s = await wait((s) => s.codeMods?.realtimeCombat?.invalidatedChoices > invalidationsBefore && s.panelVisible,
    "death cancels the current choice");
  assert(s.codeMods.realtimeCombat.automaticActions > actionsBefore);
  assert(s.codeMods.realtimeCombat.readyFriendly.every((id) => id in s.codeMods.realtimeCombat.tu));
  assert.equal(s.picking, false, "a stale target picker survived a death");
  await screenshot("reserve-promotion");

  // Also hold the capture chooser through a roster change: merely opening the popup must
  // never spend a card, even if its actor dies before the player picks a card level.
  const wallet = s.capture.inventory;
  const hit = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node.label === "captureCardHit") {
        const b = node.getBounds();
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      stack.push(...node.children ?? []);
    }
    throw new Error("No capture card hit target");
  });
  await page.mouse.click(box.x + hit.x, box.y + hit.y);
  s = await wait((s) => s.activePopup === "captureChooser", "capture chooser");
  await page.waitForFunction(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node.label === "captureChooserContent") return true;
      stack.push(...node.children ?? []);
    }
    return false;
  });
  // The actor may die during the opening tween: opening must remain free even in that case.
  await advance(100);
  await screenshot("capture-under-fire");
  const captureInvalidations = s.codeMods.realtimeCombat.invalidatedChoices;
  s = await wait((s) => s.codeMods.realtimeCombat.invalidatedChoices > captureInvalidations,
    "capture actor/roster invalidated");
  assert.deepEqual(s.capture.inventory, wallet, "cancelled capture spent currency/cards");
  assert.notEqual(s.activePopup, "captureChooser");
  s = await wait((s) => s.codeMods?.realtimeCombat?.ended, "terminal battle", 15000);
  const endTu = s.codeMods.realtimeCombat.elapsedTu;
  await advance(1000);
  assert.equal((await state()).codeMods.realtimeCombat.elapsedTu, endTu);
  await screenshot("terminal");
  assert.deepEqual(errors, []);
  console.log("Realtime Combat browser scenario passed", { endTu, output });
  }
} catch (error) {
  console.error("Browser errors:", errors);
  throw error;
} finally { await browser.close(); }
