import { nativePvpClick, nativePvpReady, nativePvpPoint, pickNativePvpTargets } from "./pvpCombatDriver.mjs";
// Opt-in. Use an isolated file-backed API + fresh Vite server and an operator-owned archive.
// DIB_PVP_HOST_TOKEN / DIB_PVP_GUEST_TOKEN optionally use disposable Official accounts (empty slots).
// No token means Offline. DIB_PVP_HOST_MOD may select a reviewed cosmetic package on the host only.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";
import { tapPixiLabel, pixiLabelVisible } from "./pixiInput.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const archive = process.env.DIB_CONTENT_ARCHIVE ?? path.resolve("Dragon_Island_Blue_1.1.0.ipa");
const displayMode = process.env.DIB_DISPLAY_MODE === "ipad" ? "ipad" : "iphone";
const output = path.resolve(process.env.DIB_PVP_OUTPUT ?? `output/pvp-${displayMode}`); fs.mkdirSync(output, { recursive: true });
const errors = [], tokens = [process.env.DIB_PVP_HOST_TOKEN, process.env.DIB_PVP_GUEST_TOKEN];
const mods = [process.env.DIB_PVP_HOST_MOD, process.env.DIB_PVP_GUEST_MOD];
const incompatible = process.env.DIB_PVP_EXPECT_INCOMPATIBLE === "1";
const spirits = process.env.DIB_PVP_SPIRITS === "1";
const fullBattle = process.env.DIB_PVP_FULL_BATTLE === "1";
const lostResponse = process.env.DIB_PVP_LOST_RESPONSE === "1";
const browsers = [];
const read = async (page) => { await page.bringToFront(); return page.evaluate(() => JSON.parse(window.render_game_to_text())); };
const pageScreenshot = (page, name) => page.screenshot({ path: path.join(output, name) });
const advance = (page, ms = 25) => page.evaluate((ms) => window.advanceTime(ms), ms);
async function wait(page, predicate, description) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const state = await read(page); if (await predicate(state)) return state;
    await advance(page); await page.waitForTimeout(20);
  }
  throw new Error(`${description}: ${JSON.stringify(await read(page))}; ${errors.join(" | ")}`);
}
// Real canvas pointer coordinates, including letterbox/scale; no direct handler invocation for PvP.
async function click(page, label) {
  console.log(`Click ${label}`);
  if (label.startsWith("pvp:") && await nativePvpClick(page, label)) { await advance(page); return; }
  // Async sprite loading can finish after the preceding deterministic frame.
  await advance(page);
  const point = await page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node.label === wanted) {
        const bounds = node.getBounds(); const canvas = window.__PIXI_APP__.canvas.getBoundingClientRect();
        return { x: canvas.x + (bounds.x + bounds.width / 2) * canvas.width / window.__PIXI_APP__.screen.width,
          y: canvas.y + (bounds.y + bounds.height / 2) * canvas.height / window.__PIXI_APP__.screen.height };
      }
      if (node.children) stack.push(...node.children);
    }
    throw new Error(`Missing ${wanted}`);
  }, label);
  await page.mouse.click(point.x, point.y); await advance(page);
  await wait(page, (s) => !s.overlay?.pvp?.board?.rendering, `Render after ${label}`);
}
async function openArena(page) {
  const town = (await read(page)).town;
  const arena = town?.buildings.find((building) => building.className === "ArenaMenuItem" && building.enabled);
  if (arena) await click(page, `town:${town.name}:building:${arena.sourceIndex}`);
  else await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await wait(page, async () => pixiLabelVisible(page, "guildQuestChatFinish"), "Arena greeting");
  await advance(page, 550); await tapPixiLabel(page, "guildQuestChat");
  await wait(page, (s) => s.overlay?.open && s.overlay?.buttons, "Arena menu");
  assert.ok((await read(page)).overlay.buttons.some(button => button.action === "pvp"));
  await page.waitForTimeout(200); await advance(page);
  await page.screenshot({ path: path.join(output, "arena-entry.png") });
  await click(page, "arena:pvp");
  await wait(page, s => s.overlay?.pvp, "PvP opened");
  await wait(page, (s) => s.overlay?.pvp?.busy === false, "PvP ready");
  await page.waitForTimeout(150); await advance(page);
  await page.screenshot({ path: path.join(output, "lobby.png") });
}
async function launch(index) {
  console.log(`Launching player ${index + 1}`);
  // Use separate storage contexts; explicitly foreground each client before driving it.
  const browser = browsers[0] ?? await chromium.launch({ channel: "chromium", headless: process.env.DIB_HEADED !== "1", args: ["--mute-audio", "--disable-features=CalculateNativeWinOcclusion", "--disable-gpu-vsync", "--disable-frame-rate-limit"] });
  if (!browsers.length) browsers.push(browser);
  const context = await browser.newContext({ viewport: {
    width: Number(process.env.DIB_PVP_VIEWPORT_WIDTH ?? 1280), height: Number(process.env.DIB_PVP_VIEWPORT_HEIGHT ?? 800),
  } });
  const page = await context.newPage();
  // Windows can occlude even separate headless windows; model two foreground devices.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text()); });
  await page.addInitScript(({ displayMode, roster, index, spirits }) => {
    window.advanceTime = () => Promise.resolve(); window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x504c4159; window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 15;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1", "HaraldDefeated"];
    if (roster || spirits) {
      window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
      window.__DIB_TEST_WORLD_PARTY__ = { size: 6, battingOrderSize: 6, levelRange: [1, 1],
        members: ["FireCub", "Minotaur", "Spark", "UnhappyBird", "Cockatrice", "Yeti"].map((shortType) => ({ shortType, level: spirits ? 30 : index === 0 ? 100 : 1 })) };
    }
    window.__DIB_TEST_PLAYER_PROFILE__ = { heroLevel: 20, monsterPartyLevels: [20, 20, 20, 20, 20], silver: 2000, gold: 1000,
      captureCards: { 1: 0, 2: 0, 3: 0 }, highestCapturedLevels: {}, licenseType: "Apprentice",
      ...(spirits ? { spiritReadiness: 1, spiritTierLevels: { Resistance: 0, Fire: 2 } } : {}),
      tutorialFlags: ["FirstShop", "FirstCharacterDisplay", "Tutorial0", "Tutorial1", "TournamentTutorial"] };
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode, textResolutionMode: "modern", sound: 0, music: 0 }));
  }, { displayMode, index, spirits: spirits && !tokens[index], roster: !tokens[index] && process.env.DIB_PVP_ROSTER === "1" });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log(`Player ${index + 1}: content gate`);
  await page.locator(".content-gate__mod-manager").click();
  const manager = page.getByRole("dialog", { name: "Mod Manager" });
  await manager.getByRole("tab", { name: /Installed/ }).click();
  await manager.getByRole("switch", { name: "Multiplayer PvP", exact: true }).click();
  await manager.getByRole("button", { name: "Apply", exact: true }).click();
  if (tokens[index]) {
    await page.locator('input[name="asset-archive"]').setInputFiles(archive);
    await page.getByLabel("Online (Beta)", { exact: true }).check();
    await page.getByLabel("Login token").fill(tokens[index]);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.locator(".content-gate__login-status--success").waitFor({ timeout: 60000 });
    await page.locator(".content-gate__rights input").check();
    await page.getByRole("button", { name: "Play Online", exact: true }).click();
  } else await loadLocalContent(page, archive, { modArchives: mods[index] ? mods[index].split(";") : [] });
  let state = await wait(page, (s) => s.startup?.phase === "title", "Title");
  await page.keyboard.press("Enter");
  state = await wait(page, (s) => ["new-game-plot", "pick-dragon", "save-select"].includes(s.startup?.phase) || s.mode === "town", "Start");
  if (state.startup?.phase === "save-select") {
    await advance(page, 550);
    const slot = state.startup.menu.buttons.find((button) => button.id === "slot-1");
    const geometry = await stageGeometry(page, await page.locator("canvas").boundingBox());
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(point.x, point.y);
    state = await wait(page, (s) => s.startup?.phase !== "save-select", "Slot 1");
  }
  if (state.startup?.phase === "new-game-plot") { await advance(page, 2050); await page.keyboard.press("Enter"); await wait(page, (s) => s.startup?.phase === "pick-dragon", "Starter"); }
  if ((await read(page)).startup?.phase === "pick-dragon") await page.keyboard.press("1");
  state = await wait(page, (s) => s.mode === "town", "Town"); await advance(page, 1000);
  for (let n = 0; n < 20 && (await read(page)).overlay?.kind === "townEnterChat"; n++) {
    const ready = await wait(page, async (s) => s.overlay?.kind !== "townEnterChat" || await pixiLabelVisible(page, "guildQuestChat"), "Town chat ready");
    if (ready.overlay?.kind !== "townEnterChat") break;
    await advance(page, 550); await tapPixiLabel(page, "guildQuestChat"); await page.waitForTimeout(20);
  }
  await advance(page, 12000); await openArena(page);
  // A retained active match resumes directly; surrender through the native confirmation.
  const retained = (await read(page)).overlay.pvp.match;
  if (retained?.status === "active") {
    await wait(page, s => ["awaitingPlayerChoice", "awaitingOpponent"].includes(s.overlay?.pvp?.board?.presentation?.state), "resumed decision");
    await page.keyboard.press("Escape"); await advance(page, 300); await click(page, "popupButton:Yes");
    await wait(page, s => s.overlay?.pvp?.match?.status === "ended" && !s.overlay.pvp.board, "Previous match ended");
    await advance(page, 300); await click(page, "popupButton:Ok");
    await click(page, "arena:pvp"); await wait(page, s => s.overlay?.pvp?.busy === false, "new lobby");
  } else if (retained?.status === "waiting") {
    await page.getByRole("button", { name: "Cancel invite", exact: true }).click();
    await wait(page, s => s.overlay.pvp.match.status === "cancelled", "Previous invite cancelled");
    await page.getByRole("button", { name: "New match", exact: true }).click();
  }
  console.log(`Player ${index + 1}: lobby ready`); return { context, page };
}
try {
  const players = [await launch(0), await launch(1)], pages = players.map((p) => p.page);
  const campaigns = await Promise.all(pages.map(async (page) => { const s = await read(page); return { player: s.player, party: s.party }; }));
  if (incompatible) {
    const rejected = pages.find((_, i) => mods[i]);
    assert.ok(rejected, "Select a gameplay mod on at least one client");
    await rejected.getByRole("alert").waitFor();
    const detail = await rejected.getByRole("alert").innerText();
    assert.match(detail, /cosmetic|gameplay/i); assert.match(detail, /disable/i);
    await pageScreenshot(rejected, "incompatibility.png");
    assert.equal((await read(rejected)).overlay.pvp.match, null);
    console.log(`Gameplay mods refused before entering PvP; inspect ${output}`);
  } else {
  await pages[0].bringToFront();
  await pages[0].getByRole("button", { name: "Create invite", exact: true }).click();
  console.log("Invite requested");
  const code = await pages[0].locator('output[aria-label="Invite code"]').innerText(); assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
  console.log("Invite ready");
  const cancelBox = await pages[0].getByRole("button", { name: "Cancel invite", exact: true }).boundingBox();
  assert.ok(cancelBox && cancelBox.y >= 0 && cancelBox.y + cancelBox.height <= pages[0].viewportSize().height,
    "Cancel invite remains on screen without scrolling");
  await pages[0].waitForTimeout(150); await advance(pages[0]);
  await pageScreenshot(pages[0], "invite.png");
  await pages[1].bringToFront();
  await pages[1].getByRole("textbox", { name: "Invite code" }).fill(code);
  console.log("Code entered");
  await pages[1].getByRole("button", { name: "Join match", exact: true }).click();
  console.log("Join requested");
  for (const page of pages) {
    await wait(page, (s) => s.overlay?.pvp?.match?.status === "active", "Paired match");
    assert.equal(await page.getByRole("dialog", { name: "Multiplayer PvP" }).isVisible(), false);
  }
  let match = (await read(pages[0])).overlay.pvp.match;
  assert.deepEqual(match.players.map((p) => p.source), tokens.map((token) => token ? "official" : "offline"));
  for (const [index, page] of pages.entries()) {
    await wait(page, (s) => !s.overlay.pvp.board?.rendering, "Initial board ready"); await advance(page);
    assert.equal((await read(page)).overlay.pvp.board.renderer, "BattleNode");
    await page.screenshot({ path: path.join(output, `initial-${index}.png`) });
  }
  let interceptedBody; const commandRequests = [];
  if (lostResponse) for (const page of pages) await page.route("**/api/pvp/matches/*/commands", async (route) => {
    commandRequests.push(route.request().postData());
    if (interceptedBody) { await route.continue(); return; }
    interceptedBody = route.request().postData();
    const response = await route.fetch(); assert.equal(response.status(), 200);
    // The server committed, but the client cannot parse the returned body. Retry must reuse it.
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });
  const spiritTeams = new Set();
  for (let turn = 0; turn < (fullBattle ? 100 : 3) && match.status === "active"; turn++) {
    console.log(`Turn ${turn + 1}, player ${match.turn + 1}`);
    const active = pages[match.turn];
    await wait(active, (s) => s.overlay?.pvp?.board?.revision === match.revision && nativePvpReady(s), "Turn controls");
    if (spirits && !tokens[match.turn] && !spiritTeams.has(match.turn)) {
      const team = match.turn, before = match.revision;
      const hero = (await read(active)).overlay.pvp.board.spirit.panelHero.point;
      const heroClient = await nativePvpPoint(active, hero); await active.mouse.click(heroClient.x, heroClient.y);
      const opened = await wait(active, state => state.overlay.pvp.board.spirit.menu, "native spirit menu");
      const menu = opened.overlay.pvp.board.spirit.menu;
      const option = menu.buttons.find(button => button.enabled && menu.columns[button.column][button.row].kind === "spirit");
      assert.ok(option, "Native spirit menu omitted an available spirit");
      const optionClient = await nativePvpPoint(active, { x: option.x, y: option.y });
      await pageScreenshot(active, `spirit-menu-${team}.png`); await active.mouse.click(optionClient.x, optionClient.y);
      await wait(active, state => state.overlay.pvp.match.revision > before, "committed spirit");
      match = (await read(active)).overlay.pvp.match;
      spiritTeams.add(team);
      for (const page of pages) await wait(page, state => {
        const board = state.overlay.pvp.board, id = board.summonIds[board.you === team ? 0 : 1];
        return id && board.monsters.some(monster => monster.id === id && (monster.visible || (board.you === team && board.panelVisible))) && board.displayedQueue.includes(id);
      }, "spirit visible in native field and queue");
      await pageScreenshot(pages[team === 0 ? 1 : 0], `opponent-spirit-${team}.png`);
      await wait(active, nativePvpReady, "native controls after spirit");
    }
    await click(active, "pvp:usable1");
    await pickNativePvpTargets(active, read, wait, click);
    if (lostResponse && turn === 0) {
      await wait(active, s => s.overlay.pvp.match.revision > match.revision && !s.overlay.pvp.error, "Automatic retry recovered");
      assert.equal(commandRequests[1], interceptedBody);
      assert.equal(await active.getByRole("dialog", { name: "Multiplayer PvP" }).isVisible(), false);
      await pageScreenshot(active, "retry.png");
    }
    await wait(active, (s) => s.overlay.pvp.match.revision > match.revision, "Committed move");
    match = (await read(active)).overlay.pvp.match;
    for (const page of pages) await wait(page, (s) => s.overlay.pvp.match.revision === match.revision, "Both clients agree");
  }
  for (const [index, page] of pages.entries()) {
    await advance(page, 1250); await page.screenshot({ path: path.join(output, `battle-${index}.png`) });
    fs.writeFileSync(path.join(output, `state-${index}.json`), JSON.stringify(await read(page), null, 2));
  }
  assert.deepEqual((await read(pages[0])).overlay.pvp.match.battle, (await read(pages[1])).overlay.pvp.match.battle);
  if (fullBattle) { assert.equal(match.status, "ended"); assert.equal(match.endReason, "defeat"); }
  else {
  const surrendering = pages[match.turn];
  await wait(surrendering, nativePvpReady, "Surrender controls");
  // Escape opens the existing retreat confirmation; cancelling preserves the exact match.
  await surrendering.keyboard.press("Escape");
  await wait(surrendering, s => s.overlay.pvp.board.activePopup === "confirmRetreat", "Native surrender confirmation");
  assert.equal(await surrendering.getByRole("dialog", { name: "Multiplayer PvP" }).isVisible(), false);
  await advance(surrendering, 300); await pageScreenshot(surrendering, "forfeit-confirmation.png");
  await surrendering.keyboard.press("Escape");
  await wait(surrendering, s => !s.overlay.pvp.board.activePopup, "Surrender cancelled");
  assert.equal((await read(surrendering)).overlay.pvp.match.revision, match.revision);
  await click(surrendering, "pvp:forfeit");
  for (const page of pages) await wait(page, s => s.overlay?.pvp?.match?.status === "ended", "Terminal result");
  assert.equal((await read(pages[0])).overlay.pvp.match.winner, match.turn === 0 ? 1 : 0);
  }
  await wait(pages[0], (s) => !s.overlay.pvp.board, "Result render"); await advance(pages[0]);
  // Let Chromium composite the modal backdrop over the final manually rendered canvas.
  await pages[0].waitForTimeout(150); await advance(pages[0]);
  await pages[0].screenshot({ path: path.join(output, "result.png") });
  for (const [index, page] of pages.entries()) {
    const s = await read(page);
    assert.deepEqual({ player: s.player, party: s.party }, campaigns[index], "PvP must preserve the campaign");
  }
  for (const page of pages) {
    await wait(page, s => !s.overlay.pvp.board, "Native result popup");
    assert.equal(await page.getByRole("dialog", { name: "Multiplayer PvP" }).isVisible(), false);
    await advance(page, 300); await click(page, "popupButton:Ok");
    await wait(page, s => !s.overlay?.pvp, "Return to Arena");
  }
  assert.deepEqual(errors, []); console.log(`PvP ${tokens.map((token) => token ? "Official" : "Offline").join("/")} passed; inspect ${output}`);
  }
} catch (error) {
  console.error(error);
  for (const [index, context] of browsers.flatMap((browser) => browser.contexts()).entries()) {
    const page = context.pages()[0];
    if (!page) continue;
    await page.screenshot({ path: path.join(output, `failure-${index}.png`) }).catch(() => {});
    fs.writeFileSync(path.join(output, `failure-${index}.json`), JSON.stringify(await read(page).catch(() => null), null, 2));
  }
  fs.writeFileSync(path.join(output, "errors.json"), JSON.stringify(errors, null, 2));
  throw error;
} finally { await Promise.all(browsers.map((browser) => browser.close())); }
