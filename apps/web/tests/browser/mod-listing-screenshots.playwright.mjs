
























import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
assert(archive && existsSync(archive), "Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");
const distDirectory = resolve(repositoryRoot, "examples/mods/dist");
const outputDirectory = resolve(repositoryRoot, "examples/mods/screenshots");
const extrasDirectory = process.env.DIB_MOD_SHOT_EXTRAS ? resolve(process.env.DIB_MOD_SHOT_EXTRAS) : null;
const modArchive = (name) => resolve(distDirectory, `${name}.dibmod`);

// Server-side listing limits: 5 MiB and 4096 px per side.
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 4096;
// A uniform (black/blank) 1440x960 frame compresses to a few kilobytes; real game art never does.
const MIN_PLAUSIBLE_BYTES = 60 * 1024;
// 3:2, the iPhone tier's 960x640 stage at 1.5x, so the canvas carries no letterbox bars.
const VIEWPORT = { width: 1440, height: 960 };

// ------------------------------------------------------------------------------------------------
// Shared harness
// ------------------------------------------------------------------------------------------------

/** Reads width/height straight from the PNG IHDR chunk. */
function pngSize(file) {
  const bytes = readFileSync(file);
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", `${file} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), bytes: bytes.length };
}

async function openSession(browser, name, { mods, init = {} }) {
  for (const mod of mods) {
    assert(existsSync(modArchive(mod)), `Missing ${modArchive(mod)}; run pnpm mods:examples first.`);
  }
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  // No authority service runs beside these Offline captures.
  await context.route("**/api/game/readiness", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ready: false, installedLogicPackIds: [] }),
  }));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.stack ?? error}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()} (${message.location().url ?? "unknown URL"})`);
  });
  await page.addInitScript((config) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone", textResolutionMode: "modern", sound: 0, music: 0,
    }));
    // Deterministic harness: the app swaps this provisional hook for its real ticker advancer.
    window.advanceTime = () => {};
    if (config.seed !== undefined) window.__DIB_TEST_BATTLE_SEED__ = config.seed;
    if (config.encounter !== undefined) window.__DIB_TEST_ENCOUNTER__ = config.encounter;
    for (const [key, value] of Object.entries(config.globals ?? {})) window[key] = value;
    for (const [key, value] of Object.entries(config.storage ?? {})) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }, init);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const archiveInput = page.locator('input[name="asset-archive"]');
  await archiveInput.waitFor({ state: "attached", timeout: 120_000 });
  await archiveInput.setInputFiles(archive);
  // The launcher keeps this input hidden; it is only ever driven through setInputFiles.
  await page.locator('input[name="mod-archives"]').setInputFiles(mods.map(modArchive));
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ state: "visible", timeout: 120_000 })
    .catch(async (error) => {
      throw new Error(`Offline gate did not validate: ${await page.locator("body").innerText()}`, { cause: error });
    });
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  await page.waitForFunction(() => typeof window.render_game_to_text === "function", undefined,
    { timeout: 120_000 });
  return { context, page, errors, harness: makeHarness(name, page, errors) };
}

function makeHarness(name, page, errors) {
  const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((value) => window.advanceTime(value), ms);
  const describe = (state) => JSON.stringify({
    mode: state?.mode, startup: state?.startup?.phase, presentation: state?.presentation?.state,
    popup: state?.activePopup, codeMods: state?.codeMods,
  }).slice(0, 1500);
  /** Polls state, advancing the deterministic clock by `step` between reads. */
  async function until(predicate, label, { step = 20, limit = 4000 } = {}) {
    let state;
    for (let index = 0; index < limit; index += 1) {
      state = await read();
      if (predicate(state)) return state;
      await advance(step);
      // Real-time yields are load-bearing: a tight advance loop starves asset fetches (pitfall 10).
      if (index % 10 === 0) await page.waitForTimeout(5);
    }
    throw new Error(`${label} not reached. ${describe(state)}; ` +
      `errors: ${errors.slice(0, 5).join(" | ") || "none"}`);
  }
  async function canvasBox() {
    const box = await page.locator("canvas").first().boundingBox();
    assert(box, "game canvas has no bounding box");
    return box;
  }
  /** Synchronous battle-point -> CSS mapper for the current canvas (stageGeometry.mjs). */
  async function geometry() {
    return stageGeometry(page, await canvasBox());
  }
  async function tapPoint(point) {
    const { toCss } = await geometry();
    const css = toCss(point);
    await page.mouse.click(css.x, css.y);
  }
  /** Title -> first scene. Retries: one blind tap after a phase flag is a race (pitfall 40). */
  async function passTitle(isPast) {
    await until((s) => s.startup?.phase === "title", "interactive title", { step: 25, limit: 2400 });
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await advance(100);
      await page.keyboard.press("Enter");
      for (let index = 0; index < 120; index += 1) {
        const state = await read();
        if (isPast(state)) return state;
        await advance(25);
        if (index % 10 === 0) await page.waitForTimeout(5);
      }
    }
    throw new Error(`title did not continue: ${describe(await read())}`);
  }
  const enterBattle = () => passTitle((s) => s.mode === "battle");
  const choice = (label = "player choice", options) => until(
    (s) => s.presentation?.state === "awaitingPlayerChoice" && s.panelVisible, label, options);
  /** The letterboxed stage inside the canvas, in CSS px, rounded inward. */
  async function stageClip() {
    const box = await canvasBox();
    const { stagePx } = await read();
    const scale = Math.min(box.width / stagePx.w, box.height / stagePx.h);
    const x = box.x + (box.width - stagePx.w * scale) / 2;
    const y = box.y + (box.height - stagePx.h * scale) / 2;
    const left = Math.ceil(x);
    const top = Math.ceil(y);
    return {
      x: left, y: top,
      width: Math.floor(x + stagePx.w * scale) - left,
      height: Math.floor(y + stagePx.h * scale) - top,
      scale: 1,
    };
  }
  /** Captures the stage only (no launcher/page chrome) after publishing the current Pixi frame. */
  async function shoot(file) {
    // The ticker is manual: render the current scene and let Chromium composite it, so the capture
    // cannot pick up the preceding canvas frame (offline-realtime-combat's recipe).
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => {
      window.__PIXI_APP__.render();
      requestAnimationFrame(() => requestAnimationFrame(done));
    })));
    const clip = await stageClip();
    assert(clip.width >= 960 && clip.height >= 640, `stage renders too small: ${JSON.stringify(clip)}`);
    const startedAt = Date.now();
    const cdp = await page.context().newCDPSession(page);
    try {
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, clip });
      writeFileSync(file, Buffer.from(shot.data, "base64"));
    } finally {
      await cdp.detach().catch(() => {});
    }
    const size = pngSize(file);
    console.log(`  ${file.split(/[\\/]/).at(-1)}: ${size.width}x${size.height}, ` +
      `${(size.bytes / 1024).toFixed(0)} KiB in ${Date.now() - startedAt}ms`);
    return size;
  }
  async function capture(file) {
    const size = await shoot(file);
    assert(size.bytes <= MAX_BYTES, `${file} is ${size.bytes} bytes, over the 5 MiB listing limit`);
    assert(size.width <= MAX_SIDE && size.height <= MAX_SIDE, `${file} exceeds ${MAX_SIDE}px`);
    assert(size.bytes >= MIN_PLAUSIBLE_BYTES,
      `${file} is only ${size.bytes} bytes; the frame is probably blank`);
    return size;
  }
  /** Alternative frames, written only when DIB_MOD_SHOT_EXTRAS names a directory. */
  async function extra(moment) {
    if (extrasDirectory === null) return;
    mkdirSync(extrasDirectory, { recursive: true });
    await shoot(resolve(extrasDirectory, `${name}--${moment}.png`));
  }
  /** Runs post-capture driving that exists only to produce extras; it can never fail the mod. */
  async function extras(body) {
    if (extrasDirectory === null) return;
    try {
      await body();
    } catch (error) {
      console.log(`  (extras stopped: ${error instanceof Error ? error.message.slice(0, 200) : error})`);
    }
  }
  /** Visible labelled Pixi nodes; bounds are canvas-global px (pitfall 20). */
  function findLabels(pattern) {
    return page.evaluate((source) => {
      const wanted = new RegExp(source);
      const shown = (node) => {
        for (let current = node; current; current = current.parent) {
          if (!current.visible || !current.renderable) return false;
        }
        return true;
      };
      const found = [];
      const stack = [window.__PIXI_APP__.stage];
      while (stack.length > 0) {
        const node = stack.pop();
        if (typeof node?.label === "string" && wanted.test(node.label) && shown(node)) {
          const b = node.getBounds();
          found.push({ label: node.label, x: b.x, y: b.y, w: b.width, h: b.height,
            text: typeof node.text === "string" ? node.text : undefined });
        }
        if (node?.children) stack.push(...node.children);
      }
      return found;
    }, pattern.source);
  }
  /** Clicks the on-canvas centre of the last visible node carrying exactly this label. */
  async function clickLabel(label) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const bounds = (await findLabels(new RegExp(`^${escaped}$`))).at(-1);
    assert(bounds, `missing visible Pixi node ${label}`);
    const box = await canvasBox();
    const left = Math.max(0, bounds.x);
    const right = Math.min(box.width, bounds.x + bounds.w);
    const top = Math.max(0, bounds.y);
    const bottom = Math.min(box.height, bounds.y + bounds.h);
    assert(right > left && bottom > top, `${label} has no on-canvas area`);
    await page.mouse.click(box.x + (left + right) / 2, box.y + (top + bottom) / 2);
    await advance(25);
  }
  /** Taps the first ability card whose path satisfies `match`, then the first live enemy. */
  async function attackFirstEnemy(state, match = (path) => path.startsWith("Offensive.")) {
    const card = state.abilityButtons.find((button) => match(button.abilityPath));
    assert(card, `no matching ability card: ${JSON.stringify(state.abilityButtons.map((b) => b.abilityPath))}`);
    await tapPoint(card.center);
    const picking = await until((s) => s.picking || s.presentation?.state !== "awaitingPlayerChoice",
      "target picker");
    if (picking.picking) {
      const enemy = picking.monsters.find((m) => m.team === 1 && m.hp > 0 && m.visible !== false);
      assert(enemy, "no live enemy to target");
      await tapPoint(enemy.targetPoint);
    }
  }
  return { page, read, advance, until, geometry, tapPoint, passTitle, enterBattle, choice, capture,
    extra, extras, canvasBox, findLabels, clickLabel, attackFirstEnemy, describe };
}

// ------------------------------------------------------------------------------------------------
// Per-mod recipes. Each `drive` lands on the moment, calls `h.capture(file)`, and returns a short
// description of what the frame shows.
// ------------------------------------------------------------------------------------------------

const recipes = {
  "pirate-panic-dancer": {
    mods: ["pirate-panic-dancer"],
    init: {
      seed: 23,
      encounter: {
        backgroundKey: "BeachCombat",
        playerTeam: [{ shortType: "PirateMan", level: 30 }],
        enemyTeam: [{ shortType: "Slime", level: 1 }],
      },
    },
    async drive(h, file) {
      const { page, read, advance, until } = h;
      await h.enterBattle();
      let state = await until((s) => s.codeMods?.piratePanic?.phase === "dialogue", "Pirate dialogue",
        { step: 50, limit: 1200 });
      // Let the chat presenter's opening fade finish, then take Pirate's panicked line.
      await advance(900);
      state = await read();
      assert.equal(state.codeMods?.piratePanic?.phase, "dialogue", "dialogue closed on its own");
      await h.capture(file);
      await h.extras(async () => {
        const box = await h.canvasBox();
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await until((s) => s.codeMods?.piratePanic?.phase === "dance" &&
          s.activeEffectNodes.some((node) => node.label === "piratePanicDance"), "Pirate dance",
          { step: 25, limit: 200 });
        let danced = 0;
        for (const ms of [0, 150, 300, 700]) {
          await advance(ms - danced);
          danced = ms;
          await h.extra(`dance-${ms}`);
        }
      });
      return `Pirate's panic line "${state.codeMods.piratePanic.line}" in the shipped chat presenter, before his dance`;
    },
  },

  "fire-cub-inferno-barrage": {
    mods: ["fire-cub-inferno-barrage"],
    init: {
      seed: 7,
      encounter: {
        backgroundKey: "ArenaCombat",
        playerTeam: [{ shortType: "FireCub", level: 100 }],
        enemyTeam: [
          { shortType: "BlueBabyDragon", level: 100 },
          { shortType: "BlueBabyDragon", level: 100 },
          { shortType: "BlueBabyDragon", level: 100 },
        ],
      },
    },
    async drive(h, file) {
      const { page, advance, until, tapPoint } = h;
      await h.enterBattle();
      let state = await h.choice();
      const barrage = state.abilityButtons.find((b) =>
        b.abilityPath === "DevDragonIslandBlueFireCub.FireCubInfernoBarrage");
      assert(barrage, "Inferno Barrage card missing");
      await tapPoint(barrage.center);
      state = await until((s) => s.codeMods?.infernoBarrage?.active === true, "barrage open",
        { step: 10, limit: 100 });
      const aimed = state.monsters.find((m) => m.team === 1 && m.hp > 0 &&
        m.id === "t1m1:BlueBabyDragon") ?? state.monsters.find((m) => m.team === 1 && m.hp > 0);
      const { toCss } = await h.geometry();
      const css = toCss(aimed.targetPoint);
      await page.mouse.move(css.x, css.y);
      const strikes = state.codeMods.infernoBarrage.completedStrikes;
      state = await until((s) => s.codeMods.infernoBarrage.completedStrikes >= strikes + 4,
        "barrage strikes", { step: 50, limit: 400 });
      await advance(60);
      await h.capture(file);
      return `Fire Cub's Inferno Barrage mid-volley (${state.codeMods.infernoBarrage.completedStrikes} strikes), aim ring on an enemy`;
    },
  },

  "realtime-combat": {
    mods: ["realtime-combat"],
    init: {
      seed: 7,
      encounter: {
        backgroundKey: "ArenaCombat",
        playerTeam: Array.from({ length: 5 }, () => ({ shortType: "FireCub", level: 30 })),
        enemyTeam: Array.from({ length: 5 }, () => ({ shortType: "SnowCub", level: 30 })),
      },
    },
    async drive(h, file) {
      const { advance, until } = h;
      await h.enterBattle();
      // The player's move cards stay open while enemy attacks keep landing around them.
      const state = await until((s) => {
        const rt = s.codeMods?.realtimeCombat;
        return rt && rt.automaticActions >= 2 && s.panelVisible &&
          s.presentation?.state === "awaitingPlayerChoice" && s.activeEffects >= 2;
      }, "overlapping enemy attacks during a choice", { step: 20, limit: 3000 });
      await h.extra("first-hits");
      // 200ms on, the next enemy claws are mid-swing over the still-open move cards.
      await advance(200);
      await h.capture(file);
      return `Realtime battle: enemy attacks landing while the move panel waits (${state.codeMods.realtimeCombat.readyFriendly.length} allies ready)`;
    },
  },

  "mercy-stone": {
    // The holder is the player's level-100 monster; its killing blow on a level-1 enemy is spared.
    mods: ["mercy-stone"],
    init: {
      seed: 7,
      encounter: {
        backgroundKey: "FieldCombat",
        playerTeam: [{
          shortType: "BlueBabyDragon", level: 100,
          soulStone: { element: "Mercy", level: 1, sourceType: "BlueBabyDragon" },
        }],
        enemyTeam: [{ shortType: "FireCub", level: 1 }],
      },
    },
    async drive(h, file) {
      const { page, read, advance, until } = h;
      await h.enterBattle();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const state = await h.choice("holder's turn");
        await h.attackFirstEnemy(state);
        for (let index = 0; index < 600; index += 1) {
          const floaters = await h.findLabels(/^floater:Mercy!$/);
          if (floaters.length > 0) {
            await advance(150);
            const after = await read();
            const spared = after.monsters.find((m) => m.id === after.codeMods?.mercyStone?.lastSparedId);
            await h.capture(file);
            return `Blue "Mercy!" floater over the spared enemy ${spared?.id ?? "?"} (holder: Water Hatchling)`;
          }
          const now = await read();
          if (now.presentation?.state === "awaitingPlayerChoice" && now.panelVisible) break;
          await advance(20);
          if (index % 10 === 0) await page.waitForTimeout(5);
        }
      }
      throw new Error(`no Mercy! floater: ${h.describe(await read())}`);
    },
  },

  "devtools": {
    // offline-devtools-menu's world fixture: start a save, open the master menu, open Devtools.
    mods: ["devtools"],
    init: {
      globals: {
        __DIB_TEST_WORLD_DEMO__: true,
        __DIB_TEST_DIALOGS_SEEN__: ["LeslieIntro1"],
        __DIB_TEST_PLAYER_PROFILE__: {
          heroLevel: 20,
          monsterPartyLevels: [20, 20, 20, 20, 20],
          silver: 2_000,
          gold: 1_000,
          captureCards: { 1: 0, 2: 0, 3: 0 },
          highestCapturedLevels: {},
          licenseType: "Apprentice",
          tutorialFlags: ["FirstShop", "Tutorial0", "Tutorial1"],
        },
      },
    },
    async drive(h, file) {
      const { page, read, advance, until } = h;
      const settle = (predicate, label, limit = 300) => until(predicate, label, { step: 25, limit });
      let state = await h.passTitle((s) => s.startup?.phase === "new-game-plot" ||
        s.startup?.phase === "pick-dragon" || ["world", "town", "dungeon"].includes(s.mode));
      if (state.startup?.phase === "new-game-plot") {
        await advance(2_050);
        await page.keyboard.press("Enter");
        state = await settle((s) => s.startup?.phase === "pick-dragon", "starter selection");
      }
      if (state.startup?.phase === "pick-dragon") await page.keyboard.press("1");
      state = await settle((s) => ["world", "town", "dungeon"].includes(s.mode), "gameplay scene");
      for (let index = 0; index < 20 && state.overlay?.kind === "townEnterChat"; index += 1) {
        await page.keyboard.press("Enter");
        await advance(50);
        state = await read();
      }
      if (state.mode === "town") {
        state = await settle((s) => s.mode === "town" && s.overlay === null && s.town?.exitEnabled,
          "interactive town");
        await advance(1_500);
      }
      for (let index = 0; index < 10 && state.tutorial !== undefined; index += 1) {
        await page.keyboard.press("Enter");
        await advance(100);
        state = await read();
      }
      state = await settle((s) => !s.chrome?.heroXp?.expanded && !s.chrome?.heroXp?.moving, "hero XP settles");
      if (state.mode === "town") {
        // Let the day banner retire, then walk out to the overworld map.
        state = await settle((s) => !s.town?.dayNotification?.visible, "day banner retires", 400);
        const exit = (await h.findLabels(/^town:.*:exit$/)).at(-1);
        assert(exit, "town exit is not rendered");
        const box = await h.canvasBox();
        await page.mouse.click(box.x + exit.x + exit.w / 2, box.y + exit.y + exit.h / 2);
        state = await settle((s) => s.mode === "world" && s.locked === false, "overworld after leaving town");
        await advance(1_500);
        state = await read();
        for (let index = 0; index < 10 && state.tutorial !== undefined; index += 1) {
          await page.keyboard.press("Enter");
          await advance(100);
          state = await read();
        }
        state = await settle((s) => s.tutorial === undefined && !s.chrome?.heroXp?.expanded &&
          !s.chrome?.heroXp?.moving, "overworld chrome settles");
      }
      await page.keyboard.press("Escape");
      state = await settle((s) => s.menu?.config === "MasterMenu", "master menu", 40).catch(async () => {
        // Esc is the web-native shortcut; the on-screen world menu button is the source route.
        await h.clickLabel("worldMenuButton");
        return settle((s) => s.menu?.config === "MasterMenu", "master menu");
      });
      await h.extra("master-menu");
      // The menu pops in over a few frames; retry the tap until the Devtools popup mounts.
      let mounted = false;
      for (let attempt = 0; attempt < 5 && !mounted; attempt += 1) {
        await advance(300);
        if ((await read()).menu?.config === "MasterMenu") await h.clickLabel("worldMenu:devtools");
        for (let index = 0; index < 40 && !mounted; index += 1) {
          mounted = (await h.findLabels(/^devtoolsContent$/)).length > 0;
          if (!mounted) await advance(25);
        }
      }
      assert(mounted, "Devtools popup did not mount");
      await advance(400);
      await h.clickLabel("devtools:noBattleDelays:on");
      await h.clickLabel("devtools:unlockShop:on");
      await advance(400);
      await h.capture(file);
      return `Devtools popup open over the ${state.mode} from the master menu, two toggles switched on`;
    },
  },

  "wand-pointer-trail": {
    mods: ["wand-pointer-trail"],
    init: {
      seed: 7,
      // The mod's own Options slider value (0.5-5x); 3x keeps the sparkles readable at card size.
      storage: { "dev.dragonislandblue.wand-pointer-trail.settings.v1": { scale: 3 } },
      encounter: {
        backgroundKey: "ForestCombat",
        playerTeam: [{ shortType: "Fairy", level: 20 }],
        enemyTeam: [
          { shortType: "Minotaur", level: 20 },
          { shortType: "UnhappyBird", level: 20 },
          { shortType: "Spark", level: 20 },
        ],
      },
    },
    async drive(h, file) {
      const { page, advance } = h;
      await h.enterBattle();
      await h.choice();
      const box = await h.canvasBox();
      // One quick wand flourish over the enemy line, held down while the frame is taken. The whole
      // stroke takes ~200ms of game time so its oldest sparkles (260-540ms lifetimes) are still
      // fading out at the tail rather than gone.
      const p0 = [0.34, 0.62], p1 = [0.46, 0.74], p2 = [0.58, 0.10], p3 = [0.76, 0.30];
      const at = (t) => {
        const u = 1 - t;
        const fx = u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0];
        const fy = u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1];
        return { x: box.x + box.width * fx, y: box.y + box.height * fy };
      };
      const start = at(0);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      try {
        await advance(10);
        for (let index = 1; index <= 20; index += 1) {
          const next = at(index / 20);
          await page.mouse.move(next.x, next.y, { steps: 3 });
          await advance(10);
        }
        const trail = await page.evaluate(() => {
          const stack = [window.__PIXI_APP__.stage];
          while (stack.length > 0) {
            const node = stack.pop();
            if (node?.label === "wandPointerTrail") {
              return { particles: node.particleCount, scale: node.effectScale };
            }
            if (node?.children) stack.push(...node.children);
          }
          return null;
        });
        assert(trail?.particles > 100, `held drag left no visible trail: ${JSON.stringify(trail)}`);
        assert.equal(trail.scale, 3, "the trail did not pick up its Options scale");
        await h.capture(file);
      } finally {
        await page.mouse.up();
      }
      return "Sparkle trail (Options scale 3x) swept over a Forest battle by a held pointer drag";
    },
  },

  "blue-dragon-overdrive": {
    mods: ["blue-dragon-overdrive"],
    init: {
      seed: 7,
      encounter: {
        backgroundKey: "BeachCombat",
        playerTeam: [{ shortType: "BlueBabyDragon", level: 40 }],
        enemyTeam: [
          { shortType: "Minotaur", level: 40 },
          { shortType: "Spark", level: 40 },
          { shortType: "UnhappyBird", level: 40 },
        ],
      },
    },
    async drive(h, file) {
      const { advance, until } = h;
      await h.enterBattle();
      let state = await h.choice();
      // The overdriven stats, on the hatchling's own info card.
      await h.clickLabel("turnPanel:actingCard");
      await until((s) => s.activePopup === "livingInfo:Water Hatchling", "Water Hatchling info",
        { step: 25, limit: 80 });
      await advance(400);
      await h.extra("info-card");
      await h.page.keyboard.press("Escape");
      state = await until((s) => s.activePopup === null && s.panelVisible &&
        s.presentation?.state === "awaitingPlayerChoice", "info card closed", { step: 25, limit: 80 });
      // The hatchling's Mother move: the blue dragon flies in from centre stage.
      await h.attackFirstEnemy(state, (path) => /Mother/.test(path));
      state = await until((s) => s.activeEffectNodes?.some((node) => /^mother:/.test(node.label ?? "")),
        "Water Hatchling Mother fly-in", { step: 20, limit: 600 });
      await advance(300);
      await h.capture(file);
      return "Overdriven Water Hatchling's Mother attack, the blue mother dragon flying in at an enemy";
    },
  },

  "less-rare-monsters": {
    mods: ["less-rare-monsters"],
    init: {
      seed: 7,
      // South Earlsome 3-3_Forest_4: the mod raises White Dragon's weight there; the POI fights on
      // ForestCombat.png with single-monster packs at levelScalor 45.
      encounter: {
        backgroundKey: "ForestCombat",
        playerTeam: [{ shortType: "FireCub", level: 45 }],
        enemyTeam: [{ shortType: "WhiteDragon", level: 45 }],
      },
    },
    async drive(h, file) {
      await h.enterBattle();
      await h.choice();
      await h.capture(file);
      return "Rare White Dragon encounter on South Earlsome's Forest combat background";
    },
  },
};

// ------------------------------------------------------------------------------------------------

const requested = process.argv.slice(2);
for (const name of requested) {
  assert(Object.hasOwn(recipes, name), `Unknown mod ${name}; expected one of ${Object.keys(recipes).join(", ")}`);
}
// Only catalog entries show a screenshot; the other recipes stay for anyone who republishes them.
const published = (name) => existsSync(resolve(repositoryRoot, "examples/mods", name, "listing.json"));
const selected = requested.length > 0 ? requested : Object.keys(recipes).filter(published);
mkdirSync(outputDirectory, { recursive: true });

const browserChannel = process.env.DIB_MOD_SHOT_BROWSER_CHANNEL;
const browser = await chromium.launch({
  headless: true,
  ...(browserChannel ? { channel: browserChannel } : {}),
  args: ["--use-gl=angle", browserChannel && process.platform === "win32"
    ? "--use-angle=d3d11" : "--use-angle=swiftshader", "--mute-audio"],
});
const failures = [];
const results = [];
try {
  for (const name of selected) {
    const recipe = recipes[name];
    const file = resolve(outputDirectory, `${name}.png`);
    // Never let a previous run's frame pass for this one (stale-screenshot pitfall).
    rmSync(file, { force: true });
    const startedAt = Date.now();
    console.log(`${name}:`);
    let session;
    try {
      session = await openSession(browser, name, recipe);
      const description = await recipe.drive(session.harness, file);
      assert(existsSync(file), `${name} finished without capturing`);
      assert(statSync(file).mtimeMs >= startedAt - 1000, `${file} predates this run`);
      results.push({ name, file, ...pngSize(file), description });
      if (session.errors.length > 0) {
        console.log(`  browser errors (${session.errors.length}): ${session.errors.slice(0, 3).join(" | ")}`);
      }
      console.log(`  ok in ${((Date.now() - startedAt) / 1000).toFixed(0)}s: ${description}`);
    } catch (error) {
      rmSync(file, { force: true });
      await session?.harness.extra("failure").catch(() => {});
      failures.push({ name, error });
      console.error(`  FAILED: ${error instanceof Error ? error.stack ?? error.message : error}`);
      if (session?.errors.length) console.error(`  browser errors: ${session.errors.slice(0, 5).join(" | ")}`);
    } finally {
      await session?.context.close().catch(() => {});
    }
  }
} finally {
  await browser.close();
}
console.log("");
for (const result of results) {
  console.log(`${result.name}: ${result.file} ${result.width}x${result.height} - ${result.description}`);
}
if (failures.length > 0) {
  console.error(`Could not capture: ${failures.map(({ name }) => name).join(", ")}`);
  process.exit(1);
}
