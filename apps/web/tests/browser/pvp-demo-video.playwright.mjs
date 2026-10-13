import { assertNativePvpOnTop, nativePvpClick, nativePvpReady } from "./pvpCombatDriver.mjs";


































import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { pixiLabelVisible, tapPixiLabel } from "./pixiInput.mjs";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const webRoot = resolve(repositoryRoot, "apps/web");
const serverRoot = resolve(repositoryRoot, "apps/game-server");
const argv = process.argv.slice(2);
const option = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };

const displayMode = process.env.DIB_DISPLAY_MODE === "ipad" ? "ipad" : "iphone";
// One CSS pixel per stage pixel: no letterbox, no resampling before the encoder.
const VIEWPORT = displayMode === "ipad" ? { width: 1024, height: 768 } : { width: 960, height: 640 };
const PACE = Number(process.env.DIB_PVP_DEMO_PACE ?? "1");
const FPS = 30;
const HEADER_HEIGHT = 92;
const DIVIDER = 4;
const MAX_COMMANDS = 90;
const apiPort = Number(process.env.DIB_PVP_DEMO_API_PORT ?? 18889);
const webPort = Number(process.env.DIB_PVP_DEMO_WEB_PORT ?? 15283);
const webUrl = `http://127.0.0.1:${webPort}`;

// Six-monster parties exercise ordinary abilities, statuses and reserve promotion.
const PARTIES = process.env.DIB_PVP_DEMO_PARTIES
  ? JSON.parse(readFileSync(resolve(process.env.DIB_PVP_DEMO_PARTIES), "utf8"))
  : {
      host: [["Angel", 25], ["FireTiger", 25], ["DireWolf", 25], ["Drake", 25], ["TerrorClaw", 25], ["GoldLion", 25]]
        .map(([shortType, level]) => ({ shortType, level })),
      guest: [["MerKing", 26], ["Vampire", 26], ["ElephantFighter", 26], ["Imp", 26], ["SnowPanther", 26], ["Cockatrice", 26]]
        .map(([shortType, level]) => ({ shortType, level })),
    };
const WAND_ARCHIVE = resolve(repositoryRoot, "examples/mods/dist/wand-pointer-trail.dibmod");
const WAND_SCALE = Number(process.env.DIB_PVP_DEMO_WAND_SCALE ?? 3);
const SIDES = [
  { key: "host", title: "Player 1 · Host", party: PARTIES.host, wandScale: WAND_SCALE,
    mods: [WAND_ARCHIVE],
    modNames: ["Multiplayer PvP", "Wand Pointer Trail (cosmetic)"] },
  { key: "guest", title: "Player 2 · Guest", party: PARTIES.guest,
    mods: [],
    modNames: ["Multiplayer PvP"] },
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pause = (ms) => sleep(ms * PACE);
const now = () => Date.now() / 1000;
function log(message) { console.log(`[pvp-demo ${new Date().toISOString().slice(11, 19)}] ${message}`); }

// ------------------------------------------------------------------------------------------------
// Isolated servers
// ------------------------------------------------------------------------------------------------

const children = [];
let stopping = false;
function killChildren() {
  stopping = true;
  for (const child of children.splice(0)) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
  }
}
process.on("exit", killChildren);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { killChildren(); process.exit(130); });

function assertPortFree(port) {
  return new Promise((done, fail) => {
    const probe = createServer().once("error", () => fail(new Error(
      `Port ${port} is in use. Stop that process or set DIB_PVP_DEMO_API_PORT / DIB_PVP_DEMO_WEB_PORT.`)));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done()));
  });
}
// The real node binary, never a version-manager shim: shims can depend on per-shell state.
function runNode(args, options) {
  const result = spawnSync(process.execPath, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`node ${args.join(" ")} failed with ${result.status}`);
}
function startNode(name, args, options, logDirectory) {
  const out = openSync(join(logDirectory, `${name}.log`), "a");
  const child = spawn(process.execPath, args, { stdio: ["ignore", out, out], detached: process.platform !== "win32", ...options });
  children.push(child);
  child.once("exit", (code) => { if (!stopping && code !== null && code !== 0) log(`${name} exited with ${code}; see ${join(logDirectory, `${name}.log`)}`); });
  return child;
}
async function waitForHttp(url, child, name) {
  const end = Date.now() + 120000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`${name} exited before it was ready`);
    try { if ((await fetch(url)).ok) return; } catch { /* still starting */ }
    await sleep(250);
  }
  throw new Error(`${name} did not answer ${url}`);
}

async function startServers(runDirectory) {
  const logs = resolve(runDirectory, "logs"); mkdirSync(logs, { recursive: true });
  await assertPortFree(apiPort); await assertPortFree(webPort);
  assert(existsSync(WAND_ARCHIVE), `Missing ${WAND_ARCHIVE}; run pnpm mods:examples first.`);
  // The server reviews Wand releases only from its installed official-mods directory.
  const officialMods = resolve(runDirectory, "official-mods"); mkdirSync(officialMods, { recursive: true });
  copyFileSync(WAND_ARCHIVE, resolve(officialMods, "wand-pointer-trail.dibmod"));
  // A frozen production build: an HMR reload mid-recording would wreck the take.
  const webBuild = resolve(repositoryRoot, "output/pvp-demo/.web-build");
  log("Building the web client");
  runNode([resolve(webRoot, "node_modules/vite/bin/vite.js"), "build", "--outDir", webBuild, "--emptyOutDir", "--logLevel", "error"], { cwd: webRoot });
  log(`Starting isolated PvP API on ${apiPort}`);
  const api = startNode("api", [resolve(serverRoot, "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", "serve"], {
    cwd: serverRoot,
    env: { ...process.env, DIB_GAME_PORT: String(apiPort), DIB_GAME_DATA_DIR: resolve(runDirectory, "api-data"),
      DIB_GAME_HMAC_SECRET: randomBytes(32).toString("hex"), DIB_OFFICIAL_MODS_DIR: officialMods,
      DIB_PVP_ADAPTERS_MODULE: "", DIB_PVP_ENABLED: "1",
      DIB_GAME_ALLOWED_ORIGINS: `${webUrl},http://localhost:${webPort}` },
  }, logs);
  await waitForHttp(`http://127.0.0.1:${apiPort}/api/pvp/info`, api, "PvP API");
  log(`Starting preview on ${webUrl}`);
  const preview = startNode("preview", [resolve(webRoot, "node_modules/vite/bin/vite.js"), "preview", "--outDir", webBuild,
    "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
  { cwd: webRoot, env: { ...process.env, DIB_GAME_PROXY_PORT: String(apiPort) } }, logs);
  await waitForHttp(`${webUrl}/api/pvp/info`, preview, "web preview");
}

// ------------------------------------------------------------------------------------------------
// Recording
// ------------------------------------------------------------------------------------------------

/** CDP screencast: compositor frames with wall-clock timestamps, so both sides share one clock. */
class Screencast {
  // Headless Chromium can deliver ~90 frames/s; the video is 30 fps. Keep at most one frame per
  // gap, but always the newest: a superseded frame waits briefly and is replaced, never lost.
  static MIN_GAP = 1 / 40;
  constructor(page, directory) { this.page = page; this.directory = directory; this.frames = []; this.writes = []; }
  async start() {
    mkdirSync(this.directory, { recursive: true });
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      this.cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const frame = { data, t: metadata.timestamp ?? now() };
      clearTimeout(this.timer);
      const since = frame.t - (this.last ?? -Infinity);
      if (since >= Screencast.MIN_GAP) { this.pending = undefined; this.keep(frame); return; }
      this.pending = frame;
      this.timer = setTimeout(() => this.flush(), (Screencast.MIN_GAP - since) * 1000 + 5);
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: VIEWPORT.width, maxHeight: VIEWPORT.height, everyNthFrame: 1 });
  }
  keep(frame) {
    this.last = frame.t;
    const file = `${String(this.frames.length).padStart(6, "0")}.jpg`;
    this.frames.push({ file, t: frame.t });
    this.writes.push(writeFile(join(this.directory, file), Buffer.from(frame.data, "base64")));
  }
  flush() { if (this.pending) { const frame = this.pending; this.pending = undefined; this.keep(frame); } }
  async stop() {
    await this.cdp?.send("Page.stopScreencast").catch(() => {});
    clearTimeout(this.timer); this.flush();
    await Promise.all(this.writes);
  }
}

const timeline = { captions: [], cuts: [] };
function caption(text) { log(`caption: ${text}`); timeline.captions.push({ t: now(), text }); }
/** For steps both clients run concurrently: caption when the first one gets there. */
function once(marks, key, text) { if (!marks[`caption:${key}`]) { marks[`caption:${key}`] = true; caption(text); } }

/** Recording aid: an arrow that follows the real pointer events, kept above modal dialogs. */
function installDemoCursor() {
  if (window.top !== window) return;
  const start = () => {
    const cursor = document.createElement("div");
    cursor.setAttribute("popover", "manual");
    Object.assign(cursor.style, { position: "fixed", inset: "auto", left: "-60px", top: "-60px", width: "0", height: "0",
      margin: "0", padding: "0", border: "0", background: "transparent", overflow: "visible", pointerEvents: "none" });
    cursor.innerHTML = '<svg width="24" height="30" viewBox="0 0 24 30" style="position:absolute;left:-3px;top:-2px;filter:drop-shadow(0 1px 2px #000c)">' +
      '<path d="M3 2 L3 23 L8.6 17.8 L12.3 26.6 L15.9 25 L12.3 16.5 L20 16.5 Z" fill="#fff" stroke="#111" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    const raise = () => { try { cursor.hidePopover(); } catch { /* not showing */ } try { cursor.showPopover(); } catch { /* not connected */ } };
    raise();

    new MutationObserver(raise).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    addEventListener("pointermove", (event) => { cursor.style.left = `${event.clientX}px`; cursor.style.top = `${event.clientY}px`; }, { capture: true, passive: true });
    addEventListener("pointerdown", () => {
      const ring = document.createElement("div");
      Object.assign(ring.style, { position: "absolute", left: "-16px", top: "-16px", width: "32px", height: "32px", borderRadius: "50%",
        border: "3px solid #ffe08a", boxSizing: "border-box" });
      cursor.append(ring);
      ring.animate([{ transform: "scale(0.3)", opacity: 1 }, { transform: "scale(1.5)", opacity: 0 }], { duration: 450, easing: "ease-out" })
        .finished.then(() => ring.remove());
    }, { capture: true, passive: true });
  };
  if (document.body) start(); else addEventListener("DOMContentLoaded", start, { once: true });
}

// ------------------------------------------------------------------------------------------------
// Driving helpers (real pointer input on real coordinates; never direct handler invocation)
// ------------------------------------------------------------------------------------------------

const read = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));
async function wait(side, predicate, description, timeout = 90000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const state = await read(side.page).catch(() => undefined);
    if (state && await predicate(state)) return state;
    // Before the switch to real time the app runs on the deterministic harness clock.
    if (!side.realtime) await side.page.evaluate((ms) => window.advanceTime(ms), 25).catch(() => {});
    await sleep(20);
  }
  throw new Error(`${side.key}: timed out waiting for ${description}`);
}
async function glide(page, x, y) {
  const from = page.__demoPointer ?? { x: VIEWPORT.width * 0.5, y: VIEWPORT.height * 0.75 };
  const steps = Math.max(6, Math.min(28, Math.round(Math.hypot(x - from.x, y - from.y) / 16)));
  await page.mouse.move(x, y, { steps });
  page.__demoPointer = { x, y };
}
async function press(page, x, y) {
  await glide(page, x, y); await pause(160);
  // Held briefly: Wand Pointer Trail emits while the button is down.
  await page.mouse.down(); await sleep(170); await page.mouse.up();
}
async function domClick(page, locator) {

  for (let attempt = 0; ; attempt++) {
    try {
      await locator.waitFor({ state: "visible" });
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      if (!box || box.width < 4 || box.height < 4) { await locator.click(); return; }
      await press(page, box.x + box.width / 2, box.y + box.height / 2);
      return;
    } catch (error) {
      if (attempt >= 8) throw error;
      await sleep(250);
    }
  }
}
async function domCheck(page, locator) {
  await domClick(page, locator).catch(() => {});
  if (!await locator.isChecked()) await locator.check();
}
async function pixiPoint(page, label) {
  return page.evaluate((wanted) => {
    const shown = (node) => { for (let n = node; n; n = n.parent) if (!n.visible || !n.renderable) return false; return true; };
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node.label === wanted && !node.destroyed && shown(node)) {
        const bounds = node.getBounds(); const canvas = window.__PIXI_APP__.canvas.getBoundingClientRect();
        return { x: canvas.x + (bounds.x + bounds.width / 2) * canvas.width / window.__PIXI_APP__.screen.width,
          y: canvas.y + (bounds.y + bounds.height / 2) * canvas.height / window.__PIXI_APP__.screen.height };
      }
      if (node.children) stack.push(...node.children);
    }
    return undefined;
  }, label);
}
async function pixiClick(side, label) {
  if (label.startsWith("pvp:") && await nativePvpClick(side.page, label, (x, y) => press(side.page, x, y))) return;
  let point;
  for (let attempt = 0; attempt < 100 && !point; attempt++) { point = await pixiPoint(side.page, label); if (!point) await sleep(50); }
  if (!point) throw new Error(`${side.key}: missing visible Pixi node ${label}`);
  await press(side.page, point.x, point.y);
  await wait(side, (s) => !s.overlay?.pvp?.board?.rendering, `render after ${label}`);
}
/** Taps a node whose owner is not the node itself (chat/menu owners), after showing the pointer. */
async function pixiTap(side, label) {
  const point = await pixiPoint(side.page, label);
  if (point) { await glide(side.page, point.x, point.y); await pause(120); }
  await tapPixiLabel(side.page, label);
}

// ------------------------------------------------------------------------------------------------
// Client boot: content gate, mod selection, title, town, Arena -> PvP
// ------------------------------------------------------------------------------------------------

async function launch(browser, side) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // Two "foreground devices": headless windows can otherwise be treated as occluded on Windows.
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  page.setDefaultTimeout(30000);
  side.errors = [];
  page.on("pageerror", (error) => side.errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("favicon")) side.errors.push(message.text()); });
  await page.addInitScript(({ displayMode, party, wandScale }) => {
    // The deterministic harness hook makes the proven browser fixtures apply; the script switches
    // the app to its normal real-time ticker once the town is up.
    window.advanceTime = () => Promise.resolve(); window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x504c4159; window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 15;
    window.__DIB_TEST_DIALOGS_SEEN__ = ["LeslieIntro1", "HaraldDefeated"];
    window.__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__ = true;
    const levels = party.map((member) => member.level);
    window.__DIB_TEST_WORLD_PARTY__ = { size: party.length, battingOrderSize: party.length,
      levelRange: [Math.min(...levels), Math.max(...levels)], members: party };
    window.__DIB_TEST_PLAYER_PROFILE__ = { heroLevel: 20, monsterPartyLevels: levels, silver: 2000, gold: 1000,
      captureCards: { 1: 0, 2: 0, 3: 0 }, highestCapturedLevels: {}, licenseType: "Apprentice",
      tutorialFlags: ["FirstShop", "FirstCharacterDisplay", "Tutorial0", "Tutorial1", "TournamentTutorial"] };
    try {
      localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode, textResolutionMode: "modern", sound: 0, music: 0 }));
      if (wandScale) localStorage.setItem("dev.dragonislandblue.wand-pointer-trail.settings.v1", JSON.stringify({ scale: wandScale }));
    } catch { /* opaque origin */ }
    // Anything that drives the harness clock stops the ticker; keep real time once requested.
    setInterval(() => { const ticker = window.__PIXI_APP__?.ticker; if (window.__DIB_DEMO_REALTIME__ && ticker && !ticker.started) ticker.start(); }, 100);
  }, { displayMode, party: side.party, wandScale: side.wandScale });
  await page.addInitScript(installDemoCursor);
  Object.assign(side, { context, page, realtime: false });
  side.recorder = new Screencast(page, resolve(side.runDirectory, `${side.key}-frames`));
}

async function bootToLobby(side, archive, marks) {
  const { page } = side;
  await page.goto(webUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.locator('input[name="asset-archive"]').waitFor({ state: "attached" });
  await pause(1500);
  // File pickers are native OS dialogs; select through the same File API inputs the gate uses.
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.locator('input[name="mod-archives"]').setInputFiles(side.mods);
  await pause(1500);
  await domClick(page, page.locator(".content-gate__mod-manager"));
  const manager = page.getByRole("dialog", { name: "Mod Manager" });
  await manager.waitFor({ state: "visible" }); await pause(900);
  const installed = manager.getByRole("tab", { name: /Installed/ });
  if (await installed.getAttribute("aria-selected") !== "true") await domClick(page, installed);
  await pause(2200);
  await domClick(page, manager.getByRole("switch", { name: "Multiplayer PvP", exact: true }));
  await pause(1300);
  await domClick(page, manager.getByRole("button", { name: "Apply", exact: true }));
  await pause(900);
  // Apply hands the manager's staged selection back to the gate; keep exactly this side's mods.
  const status = page.locator(".content-gate__mods-label");
  if (side.mods.length && !(await status.innerText()).startsWith(`${side.mods.length} mod`)) {
    log(`${side.key}: re-selecting mods after Apply (gate showed "${await status.innerText()}")`);
    await page.locator('input[name="mod-archives"]').setInputFiles(side.mods);
  }
  await domCheck(page, page.getByRole("radio", { name: "Offline", exact: true }));
  await page.locator("[data-local-save-status].content-gate__mode-detail-status--success").waitFor({ state: "visible", timeout: 60000 });
  await domCheck(page, page.getByRole("checkbox", { name: "I have the right to use the content in this archive on this device." }));
  await pause(1200);
  await domClick(page, page.getByRole("button", { name: "Play Offline", exact: true }));
  marks.played = Math.max(marks.played ?? 0, now());
  let state = await wait(side, (s) => s.startup?.phase === "title", "title screen", 180000);
  marks.title = Math.min(marks.title ?? Infinity, now());
  once(marks, "title", "Each player starts an Offline game with their own six-monster party");
  await pause(1200);
  await page.keyboard.press("Enter");
  state = await wait(side, (s) => ["new-game-plot", "pick-dragon", "save-select"].includes(s.startup?.phase) || s.mode === "town", "start");
  if (state.startup?.phase === "save-select") {
    await side.page.evaluate(() => window.advanceTime(550));
    const slot = state.startup.menu.buttons.find((button) => button.id === "slot-1");
    const geometry = await stageGeometry(page, await page.locator("canvas").boundingBox());
    const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await press(page, point.x, point.y);
    state = await wait(side, (s) => s.startup?.phase !== "save-select", "slot 1");
  }
  if (state.startup?.phase === "new-game-plot") {
    await page.evaluate(() => window.advanceTime(2050)); await page.keyboard.press("Enter");
    await wait(side, (s) => s.startup?.phase === "pick-dragon", "starter");
  }
  if ((await read(page)).startup?.phase === "pick-dragon") await page.keyboard.press("1");
  await wait(side, (s) => s.mode === "town", "town");
  await page.evaluate(() => window.advanceTime(1000));
  for (let n = 0; n < 20 && (await read(page)).overlay?.kind === "townEnterChat"; n++) {
    const ready = await wait(side, async (s) => s.overlay?.kind !== "townEnterChat" || await pixiLabelVisible(page, "guildQuestChat"), "town chat");
    if (ready.overlay?.kind !== "townEnterChat") break;
    await page.evaluate(() => window.advanceTime(550)); await pixiTap(side, "guildQuestChat"); await sleep(20);
  }
  await page.evaluate(() => window.advanceTime(12000));
  // From here on the app runs on its own real-time ticker, exactly as a player sees it.
  await page.evaluate(() => { window.__DIB_DEMO_REALTIME__ = true; window.__PIXI_APP__.ticker.start(); });
  side.realtime = true;
  await pause(1800);
  once(marks, "arena", "Town → Arena → PvP: the entry the Multiplayer PvP mod adds to the Arena menu");
  await openPvp(side);
}

async function openPvp(side) {
  const { page } = side;
  const town = (await read(page)).town;
  const arena = town?.buildings.find((building) => building.className === "ArenaMenuItem" && building.enabled);
  if (arena) await pixiClick(side, `town:${town.name}:building:${arena.sourceIndex}`);
  else await page.evaluate(() => { void window.__DIB_TEST_OPEN_ARENA__(); });
  await wait(side, async () => pixiLabelVisible(page, "guildQuestChatFinish"), "Arena greeting");
  await pause(1400);
  await pixiTap(side, "guildQuestChat");
  const menu = await wait(side, (s) => s.overlay?.open && s.overlay?.buttons, "Arena menu");
  await pause(1000);
  if (menu.overlay.buttons.some((button) => button.action === "pvp")) await pixiClick(side, "arena:pvp");
  else {
    // Older layout: PvP lives on the Tournament screen.
    await pixiTap(side, "arena:tournament");
    await wait(side, (s) => s.overlay?.kind === "tournament" && !s.overlay.entryPending, "Tournament");
    await pixiClick(side, "tournament:pvp");
  }
  await page.getByRole("dialog", { name: "Multiplayer PvP" }).waitFor();
  await wait(side, (s) => s.overlay?.pvp?.busy === false, "PvP lobby");
}

// ------------------------------------------------------------------------------------------------
// Battle policy (mirrors the roster simulation)
// ------------------------------------------------------------------------------------------------

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const random = seededRandom(Number(process.env.DIB_PVP_DEMO_SEED ?? 20261005));

/** The live replayed session behind the board, for choosing a move. Presentation only reads it. */
function boardModel(page) {
  return page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage]; let view;
    while (stack.length && !view) { const node = stack.pop(); if (node.label === "pvp-battle" && !node.destroyed) view = node; else if (node.children) stack.push(...node.children); }
    if (!view?.restored) return undefined;
    const { session, decision } = view.restored; const strings = view.game.strings; const gd = view.game.gd;
    // localizedRenderableName: the first Renderable<name>NameKey hit, else the last raw name.
    const text = (...keys) => keys.map((key) => strings[`Renderable${key}NameKey`]).find((value) => typeof value === "string") ?? keys.at(-1);
    const describe = (choice) => {
      const ability = gd.ability(choice.abilityPath); const types = ability.components.map((component) => component.type);
      const status = ["Sleep", "Stun", "Paralyze", "Confuse"].find((kind) => types.some((type) => type.startsWith(`Offensive.${kind}`)) && !choice.abilityPath.includes("AllTeams"))
        ?? (choice.abilityPath.startsWith("Offensive.Poison.") ? "Poison" : undefined);
      return { slot: choice.slot, path: choice.abilityPath, name: text(choice.displayName, choice.abilityPath.split(".").at(-1)), targeting: choice.targeting,
        blocked: Boolean(choice.blockReason), length: choice.activationLength, status,
        damage: types.some((type) => type === "Offensive.Attack" || type === "Offensive.MagicAttack" || type === "Offensive.DrainHealth"),
        magic: types.includes("Offensive.MagicAttack"), scalor: ability.raw?.abilityScalor ?? 1,
        heal: choice.abilityPath.startsWith("Defensive.Heal"), buff: choice.abilityPath.startsWith("Defensive.") && !choice.abilityPath.startsWith("Defensive.Heal") };
    };
    const field = (team) => session.targetableIdsOf(team).map((id) => ({ id, name: text(session.shortTypeOf(id)), hp: session.hpOf(id), maxHp: session.maxHpOf(id), statuses: session.statusEffectsOf(id) }));
    return { revision: view.match?.revision, you: view.match?.you, field: [field(0), field(1)], bench: [session.benchCountOf(0), session.benchCountOf(1)],
      decision: decision.type !== "turn" ? decision : { type: "turn", team: decision.team, actorId: decision.actorId, actor: text(session.shortTypeOf(decision.actorId)),
        stats: session.effectiveStatsOf(decision.actorId), choices: decision.choices.map(describe) } };
  });
}

/** Showcase ordinary abilities and a confirmed Delay through native battle controls. */
function choose(model, index, ownIndex, side, beats) {
  const turn = model.decision; const team = turn.team;
  const foes = [...model.field[team === 0 ? 1 : 0]].sort((a, b) => a.hp - b.hp);
  const friends = [...model.field[team]].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
  const choices = turn.choices.filter((choice) => !choice.blocked);
  const fill = (choice) => {
    const t = choice.targeting;
    if (t.kind === "enemies") return foes.slice(0, Math.min(t.count, foes.length));
    if (t.kind === "friends") return friends.slice(0, Math.min(t.count, friends.length));
    if (t.kind === "mixed") return [...(t.allEnemies ? [] : foes.slice(0, Math.min(t.enemyCount, foes.length))), ...(t.allFriends ? [] : friends.slice(0, Math.min(t.friendlyCount, friends.length)))];
    return [];
  };
  const use = (choice, why, targets = fill(choice)) => ({ kind: "ability", choice, targets, why });
  if (index >= 2 && !beats.delayed) { beats.delayed = true; return { kind: "delay", why: "delay" }; }
  if (friends.some((friend) => friend.hp / friend.maxHp < 0.55)) {
    const support = choices.filter((choice) => choice.targeting.kind === "friends" || choice.targeting.kind === "allFriends");
    const pick = support.find((choice) => choice.heal) ?? support.find((choice) => choice.buff);
    if (pick) return use(pick, pick.heal ? "heal" : "buff");
  }
  if (foes.length >= 2) {
    const multi = choices.filter((choice) => choice.targeting.kind === "allEnemies" || (choice.targeting.kind === "enemies" && choice.targeting.count >= 2));
    const pick = multi.find((choice) => choice.damage) ?? multi[0];
    if (pick && random() < 0.4) return use(pick, "multi");
  }
  const status = choices.find((choice) => choice.status && (choice.targeting.kind === "enemies" || choice.targeting.kind === "allEnemies")
    && foes.some((foe) => !foe.statuses.includes(choice.status)));
  if (status && random() < 0.3) {
    if (status.targeting.kind === "allEnemies") return use(status, "status");
    const fresh = foes.filter((foe) => !foe.statuses.includes(status.status));
    return use(status, "status", [...fresh, ...foes.filter((foe) => !fresh.includes(foe))].slice(0, Math.min(status.targeting.count, foes.length)));
  }
  let best, bestScore = -1;
  for (const choice of choices) {
    if (!(choice.targeting.kind === "enemies" || choice.targeting.kind === "allEnemies") || !choice.damage) continue;
    const count = choice.targeting.kind === "allEnemies" ? foes.length : Math.min(choice.targeting.count, foes.length);
    const score = (choice.magic ? turn.stats.Magic : turn.stats.Attack) * choice.scalor * count / choice.length;
    if (score > bestScore) { bestScore = score; best = choice; }
  }
  if (best) return use(best, "attack");
  const any = choices.find((choice) => choice.targeting.kind === "enemies");
  return any ? use(any, "attack") : { kind: "delay", why: "delay" };
}

function describePlan(side, model, plan) {
  const who = `${side.key === "host" ? "Host" : "Guest"} · ${model.decision.actor}`;
  if (plan.kind === "delay") return `${who}: Delay (gives up this turn's position in the queue)`;
  const targets = plan.targets.length ? ` → ${plan.targets.map((target) => target.name).join(", ")}` : "";
  const kind = plan.choice.targeting.kind;
  const scope = kind === "allEnemies" ? " → all opponents" : kind === "allFriends" ? " → whole team" : kind === "self" ? " (self)" : "";
  const note = { heal: " (heal)", buff: " (team buff)", status: plan.choice.status ? ` (${plan.choice.status})` : "", multi: "" }[plan.why] ?? "";
  return `${who}: ${plan.choice.name}${targets}${scope}${note}`;
}

async function perform(side, plan) {
  if (plan.kind === "delay") { await pixiClick(side, "pvp:delay"); return; }
  await pixiClick(side, `pvp:${plan.choice.slot}`);
  const t = plan.choice.targeting;
  const picks = t.kind === "enemies" || t.kind === "friends" || (t.kind === "mixed" && (!t.allEnemies || !t.allFriends));
  if (!picks || plan.targets.length === 0) return;
  await pause(500);
  for (const target of plan.targets) { await pixiClick(side, `pvp:monster:${target.id}`); await pause(300); }
  await pause(250);
  // The native picker commits immediately after the last target.
}

// ------------------------------------------------------------------------------------------------
// The take
// ------------------------------------------------------------------------------------------------

async function record(runDirectory, archive) {
  const browser = await chromium.launch({ channel: "chromium", headless: process.env.DIB_HEADED !== "1",
    args: ["--mute-audio", "--disable-features=CalculateNativeWinOcclusion", "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"] });
  const sides = SIDES.map((side) => ({ ...side, runDirectory }));
  const [host, guest] = sides;
  let failure;
  try {
    for (const side of sides) await launch(browser, side);
    await Promise.all(sides.map((side) => side.recorder.start()));
    timeline.startedAt = now();
    caption("Both players choose their content archive and mods, then enable Multiplayer PvP in the Mod Manager");
    const marks = {};
    // Stagger the guest slightly so the two cursors are not in lockstep.
    await Promise.all([bootToLobby(host, archive, marks), sleep(700).then(() => bootToLobby(guest, archive, marks))]);
    // Content import is dead air on both screens; keep a moment of it either side of the cut.
    if (marks.title - marks.played > 4) timeline.cuts.push({ from: marks.played + 1.5, to: marks.title - 1 });
    await pause(1500);

    caption("Host creates an invite code");
    await domClick(host.page, host.page.getByRole("button", { name: "Create invite", exact: true }));
    const code = await host.page.locator('output[aria-label="Invite code"]').innerText();
    assert.match(code, /^[A-HJ-NP-Z2-9]{8}$/);
    await pause(2200);
    caption(`Guest joins with code ${code} — the server reconciles the mod selections`);
    const input = guest.page.getByRole("textbox", { name: "Invite code" });
    await domClick(guest.page, input);
    await input.pressSequentially(code, { delay: 140 * PACE });
    await pause(700);
    await domClick(guest.page, guest.page.getByRole("button", { name: "Join match", exact: true }));
    for (const side of sides) await wait(side, (s) => s.overlay?.pvp?.match?.status === "active", "paired match");
    const notes = (await read(guest.page)).overlay.pvp.match.notes;
    caption(notes.length ? `Matched: ${notes.join(" ")}` : "Matched");
    await pause(3200);
    for (const side of sides) {
      const state = await wait(side, (s) => s.overlay?.pvp?.board && !s.overlay.pvp.board?.rendering, "initial board");
      side.team = state.overlay.pvp.match.you;
      await assertNativePvpOnTop(side.page, side.key);
    }
    const campaigns = await Promise.all(sides.map(async (side) => { const s = await read(side.page); return { player: s.player, party: s.party }; }));
    caption("Battle: each player sees their own team at the bottom");
    await pause(2500);

    let match = (await read(host.page)).overlay.pvp.match;
    const ownCounts = [0, 0], beats = {};
    for (let index = 0; match.status === "active" && index < MAX_COMMANDS; index++) {
      const side = sides.find((candidate) => candidate.team === match.turn);
      await wait(side, (s) => s.overlay?.pvp?.board?.revision === match.revision && nativePvpReady(s), "turn controls");
      const model = await boardModel(side.page);
      assert.equal(model?.decision.type, "turn"); assert.equal(model.decision.team, side.team);
      const plan = choose(model, index, ownCounts[side.team]++, side, beats);
      caption(describePlan(side, model, plan));
      await pause(700);
      await perform(side, plan);
      const before = model.field.map((team) => team.map((monster) => monster.id));
      const committed = await wait(side, (s) => s.overlay?.pvp?.match?.revision > match.revision && !s.overlay.pvp.busy, "committed move");
      match = committed.overlay.pvp.match;
      for (const other of sides) await wait(other, (s) => s.overlay?.pvp?.match?.revision === match.revision && !s.overlay.pvp.board?.rendering, "both clients agree");
      const after = await boardModel(side.page);
      const entered = after ? [0, 1].flatMap((team) => after.field[team].filter((monster) => !before[team].includes(monster.id)).map((monster) => monster.name)) : [];
      if (entered.length) caption(`Reserve ${entered.join(" and ")} ${entered.length > 1 ? "enter" : "enters"} the field`);
      await pause(entered.length ? 2200 : 1300);
    }
    if (match.status === "active") {
      caption("Demo turn budget reached — active player surrenders to finish the recording");
      const active = sides.find(side => side.team === match.turn);
      await wait(active, nativePvpReady, "surrender controls");
      await pixiClick(active, "pvp:forfeit");
    }
    for (const side of sides) await wait(side, (s) => s.overlay?.pvp?.match?.status === "ended", "result");
    const finals = await Promise.all(sides.map((side) => read(side.page)));
    const result = finals[0].overlay.pvp.match;
    const [winnerName, loserName] = result.winner === host.team ? ["Host", "Guest"] : ["Guest", "Host"];
    const reason = { defeat: `${loserName}'s last monster is down`, forfeit: `${loserName} forfeits`, escape: `${loserName} escaped`, "turn-limit": "turn limit" }[result.endReason] ?? result.endReason;
    caption(result.winner === "draw" ? `Draw (${reason}) after ${result.battle.commands.length} commands`
      : `${winnerName} wins — ${reason} after ${result.battle.commands.length} commands. Neither campaign save changed`);
    await pause(3500);
    assert.deepEqual(finals[1].overlay.pvp.match.battle, result.battle, "Both clients must hold the same committed transcript");
    finals.forEach((state, index) => assert.deepEqual({ player: state.player, party: state.party }, campaigns[index], "PvP must leave the campaign unchanged"));
    await pause(5000);
    writeFileSync(resolve(runDirectory, "match.json"), JSON.stringify(result, null, 2));
  } catch (error) {
    failure = error;
    console.error(error);
    for (const side of sides) {
      if (!side.page) continue;
      await side.page.screenshot({ path: resolve(runDirectory, `failure-${side.key}.png`) }).catch(() => {});
      writeFileSync(resolve(runDirectory, `failure-${side.key}.json`), JSON.stringify(await read(side.page).catch(() => null), null, 2));
    }
  } finally {
    timeline.endedAt = now();
    await Promise.all(sides.map((side) => side.recorder?.stop()));
    for (const side of sides) if (side.errors?.length) log(`${side.key} console errors: ${side.errors.join(" | ")}`);
    timeline.viewport = VIEWPORT; timeline.displayMode = displayMode;
    timeline.sides = sides.map((side) => ({ key: side.key, title: side.title, modNames: side.modNames, frames: side.recorder?.frames ?? [] }));
    writeFileSync(resolve(runDirectory, "timeline.json"), JSON.stringify(timeline, null, 2));
  }
  return { browser, failure };
}

// ------------------------------------------------------------------------------------------------
// Stitching
// ------------------------------------------------------------------------------------------------

/** Removes the cut windows from [from, to) and returns the remaining duration. */
function keptDuration(from, to, cuts) {
  let kept = Math.max(0, to - from);
  for (const cut of cuts) kept -= Math.max(0, Math.min(to, cut.to) - Math.max(from, cut.from));
  return kept;
}
function concatList(entries, start, end, cuts) {
  // entries: [{ file, t }] sorted; each file shows from its t until the next entry's t.
  const lines = ["ffconcat version 1.0"];
  let last;
  entries.forEach((entry, index) => {
    const from = Math.max(start, entry.t), to = Math.min(end, entries[index + 1]?.t ?? end);
    if (to <= from) return;
    const duration = keptDuration(from, to, cuts);
    if (duration <= 0.0005) return;
    lines.push(`file '${entry.file.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`, `duration ${duration.toFixed(6)}`);
    last = entry.file;
  });
  assert(last, "Nothing to stitch");
  lines.push(`file '${last.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`);
  return `${lines.join("\n")}\n`;
}
function escapeHtml(text) { return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

async function stitch(runDirectory, browser) {
  const data = JSON.parse(readFileSync(resolve(runDirectory, "timeline.json"), "utf8"));
  const { width, height } = data.viewport;
  const totalWidth = width * 2 + DIVIDER;
  const start = data.startedAt, end = data.endedAt, cuts = data.cuts ?? [];
  const stitchDirectory = resolve(runDirectory, "stitch"); mkdirSync(stitchDirectory, { recursive: true });
  const ownBrowser = browser ?? await chromium.launch({ channel: "chromium", args: ["--mute-audio"] });
  // Header strips: one image per caption, rendered by Chromium rather than ffmpeg drawtext fonts.
  const page = await ownBrowser.newPage({ viewport: { width: totalWidth, height: HEADER_HEIGHT } });
  const captions = data.captions.length ? data.captions : [{ t: start, text: "" }];
  const headerEntries = [];
  for (const [index, entry] of captions.entries()) {
    const side = (info) => `<div class="side"><b>${escapeHtml(info.title)}</b>${info.modNames.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`;
    await page.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; } body { margin: 0; width: ${totalWidth}px; height: ${HEADER_HEIGHT}px; background: #0b1418; color: #e9f0f2;
        font-family: "Segoe UI", system-ui, sans-serif; overflow: hidden; }
      .caption { height: 46px; display: flex; align-items: center; justify-content: center; padding: 0 24px; font-size: 21px; font-weight: 600;
        color: #ffe08a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; border-bottom: 1px solid #22343b; }
      .sides { display: flex; height: ${HEADER_HEIGHT - 46}px; } .divider { width: ${DIVIDER}px; background: #22343b; }
      .side { width: ${width}px; display: flex; align-items: center; gap: 8px; padding: 0 16px; font-size: 15px; white-space: nowrap; overflow: hidden; }
      .side b { font-size: 17px; margin-right: 6px; } .side span { background: #1d3540; border: 1px solid #3f6270; border-radius: 999px; padding: 2px 10px; color: #cfe3ea; }
    </style></head><body><div class="caption">${escapeHtml(entry.text)}</div>
    <div class="sides">${side(data.sides[0])}<div class="divider"></div>${side(data.sides[1])}</div></body></html>`);
    const file = resolve(stitchDirectory, `header-${String(index).padStart(3, "0")}.png`);
    await page.screenshot({ path: file });
    // The first strip also covers any moment before the first caption, so every track spans start..end.
    headerEntries.push({ file, t: index === 0 ? start : Math.max(start, entry.t) });
  }
  // A black lead-in, at pane size, covers any moment before a side's first frame. It must be a
  // JPEG like the frames: the concat demuxer decodes a whole list with its first file's codec.
  const blank = resolve(stitchDirectory, "blank.jpg");
  await page.setViewportSize({ width, height });
  await page.setContent("<body style='margin:0;background:#000'></body>");
  await page.screenshot({ path: blank, type: "jpeg", quality: 90 });
  await page.close();
  if (!browser) await ownBrowser.close();
  const lists = [];
  writeFileSync(lists[0] = resolve(stitchDirectory, "header.ffconcat"), concatList(headerEntries, start, end, cuts));
  data.sides.forEach((side, index) => {
    const frames = side.frames.map((frame) => ({ file: resolve(runDirectory, `${side.key}-frames`, frame.file), t: frame.t }));
    const entries = [{ file: blank, t: start }, ...frames];
    writeFileSync(lists[index + 1] = resolve(stitchDirectory, `${side.key}.ffconcat`), concatList(entries, start, end, cuts));
  });
  // Soft captions with the same cut-adjusted times.
  const srt = captions.map((entry, index) => {
    const from = keptDuration(start, Math.max(start, entry.t), cuts), to = keptDuration(start, captions[index + 1]?.t ?? end, cuts);
    return `${index + 1}\n${srtTime(from)} --> ${srtTime(Math.max(to, from + 0.5))}\n${entry.text}\n`;
  }).join("\n");
  writeFileSync(resolve(runDirectory, "captions.srt"), srt);
  const output = resolve(runDirectory, "pvp-demo.mp4");
  const pane = `fps=${FPS},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p`;
  const filter = [
    `[0:v]fps=${FPS},scale=${totalWidth}:${HEADER_HEIGHT},setsar=1,format=yuv420p[header]`,
    `[1:v]${pane}[host]`, `[2:v]${pane}[guest]`,
    `color=c=0x22343b:s=${DIVIDER}x${height}:r=${FPS},format=yuv420p[divider]`,
    "[host][divider][guest]hstack=inputs=3:shortest=1[panes]",
    "[header][panes]vstack=inputs=2:shortest=1[video]",
  ].join(";");
  const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
  const args = ["-y", "-hide_banner", "-loglevel", "error", ...lists.flatMap((list) => ["-f", "concat", "-safe", "0", "-i", list]),
    "-filter_complex", filter, "-map", "[video]", "-r", String(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", output];
  log("Encoding with ffmpeg");
  const result = spawnSync(ffmpeg, args, { stdio: "inherit" });
  if (result.error) throw new Error(`Could not run ${ffmpeg} (${result.error.message}); install ffmpeg with libx264 or set FFMPEG.`);
  if (result.status !== 0) throw new Error(`ffmpeg failed with ${result.status}`);
  const seconds = keptDuration(start, end, cuts);
  log(`Wrote ${output} (${totalWidth}x${HEADER_HEIGHT + height}, ${seconds.toFixed(1)}s, ${(statSync(output).size / 1048576).toFixed(1)} MiB)`);
  return output;
}

// ------------------------------------------------------------------------------------------------

/** Checked before the build and the take, so a missing encoder does not cost a whole recording. */
function assertFfmpeg() {
  const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
  const probe = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) throw new Error(`Could not run ${ffmpeg}; install ffmpeg with libx264 or set FFMPEG.`);
  assert(/\blibx264\b/.test(probe.stdout), `${ffmpeg} has no libx264 encoder; install a GPL build or set FFMPEG.`);
}

async function main() {
  const stitchOnly = option("--stitch-only");
  assertFfmpeg();
  if (stitchOnly) { await stitch(resolve(stitchOnly)); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runDirectory = resolve(repositoryRoot, "output/pvp-demo", stamp);
  mkdirSync(runDirectory, { recursive: true });
  await startServers(runDirectory);
  if (argv.includes("--serve-only")) {
    log(`Serving ${webUrl} (API ${apiPort}); Ctrl+C to stop.`);
    await new Promise(() => {});
  }
  const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
    .map((name) => resolve(repositoryRoot, name)).find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
  assert(archive && existsSync(archive), "Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");
  const { browser, failure } = await record(runDirectory, archive);
  try { await stitch(runDirectory, browser); } finally { await browser.close(); killChildren(); }
  if (!argv.includes("--keep-frames") && !failure) {
    for (const side of SIDES) rmSync(resolve(runDirectory, `${side.key}-frames`), { recursive: true, force: true });
    rmSync(resolve(runDirectory, "stitch"), { recursive: true, force: true });
  }
  if (failure) { console.error(`Recording failed; the partial video and failure-*.png are in ${runDirectory}`); process.exitCode = 1; return; }
  // A stable path for the newest complete take; failed takes never replace it.
  const latest = resolve(repositoryRoot, "output/pvp-demo/latest");
  rmSync(latest, { recursive: true, force: true }); mkdirSync(latest, { recursive: true });
  for (const file of ["pvp-demo.mp4", "captions.srt", "match.json"]) copyFileSync(resolve(runDirectory, file), resolve(latest, file));
  writeFileSync(resolve(latest, "source.txt"), `${runDirectory}\n`);
  log(`Done: ${resolve(runDirectory, "pvp-demo.mp4")} (also ${resolve(latest, "pvp-demo.mp4")})`);
}

await main().catch((error) => { console.error(error); killChildren(); process.exitCode = 1; });
