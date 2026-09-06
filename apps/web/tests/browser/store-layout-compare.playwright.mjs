// Opt-in Store layout comparison capture: reproduces the three original-emulator reference
// frames (root Currency card, Items aisle with a gem selected, Totems aisle) so the port's
// composition can be diffed against them. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { loadLocalContent } from "./localContent.mjs";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDir = path.resolve(import.meta.dirname, "../../../../output/store-layout-compare");
fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_WORLD_SEED__ = 0x53544f52;
    window.__DIB_TEST_WORLD_NAME__ = "World_1-2";
    window.__DIB_TEST_POI_NAME__ = "Capital_City";
    window.__DIB_TEST_FINISHED_QUEST_COUNT__ = 15;
    window.__DIB_TEST_PLAYER_PROFILE__ = {
      heroLevel: 20,
      monsterPartyLevels: [20, 20, 20, 20, 20],
      // Matches the reference emulator save's balances so the money group can be compared.
      silver: 738,
      gold: 100,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      licenseType: "Apprentice",
      tutorialFlags: ["FirstShop", "Tutorial0", "Tutorial1"],
    };
  });
  await page.goto(url);
  await loadLocalContent(page);

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = (ms) => page.evaluate((delta) => window.advanceTime(delta), ms);
  const waitFor = async (predicate, description, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    let snapshot;
    while (Date.now() < deadline) {
      snapshot = await state();
      if (await predicate(snapshot)) {
        await advance(25);
        return await state();
      }
      await advance(25);
      await page.waitForTimeout(1);
    }
    throw new Error(
      `${description}; overlay=${JSON.stringify(snapshot?.overlay)}; ` +
      `errors=${errors.join(" | ") || "none"}`,
    );
  };
  const boundsFor = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    let match = null;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && node.visible && node.renderable) {
        const b = node.getBounds();
        match = { x: b.x, y: b.y, w: b.width, h: b.height };
      }
      if (node?.children) stack.push(...node.children);
    }
    return match;
  }, label);
  const clickLabel = async (label) => {
    const bounds = await boundsFor(label);
    assert(bounds, `missing ${label}`);
    const canvas = await page.locator("canvas").first().boundingBox();
    const left = Math.max(canvas.x, canvas.x + bounds.x);
    const right = Math.min(canvas.x + canvas.width, canvas.x + bounds.x + bounds.w);
    const top = Math.max(canvas.y, canvas.y + bounds.y);
    const bottom = Math.min(canvas.y + canvas.height, canvas.y + bounds.y + bounds.h);
    await page.mouse.click((left + right) / 2, (top + bottom) / 2);
  };
  const capture = async (name) => {
    const png = await page.locator("canvas").evaluate((c) => c.toDataURL("image/png"));
    fs.writeFileSync(path.join(outputDir, name), Buffer.from(png.split(",", 2)[1], "base64"));
  };
  /** Every visible text node, so label positions can be compared against the reference frames. */
  const texts = () => page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    const found = [];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.visible && node?.renderable && typeof node.text === "string" && node.text.length) {
        const b = node.getBounds();
        found.push({
          text: node.text,
          x: Math.round(b.x), y: Math.round(b.y),
          w: Math.round(b.width), h: Math.round(b.height),
        });
      }
      if (node?.children) stack.push(...node.children);
    }
    return found.sort((l, r) => l.y - r.y);
  });

  await waitFor((value) => value.startup?.phase === "title", "startup title did not open");
  await page.keyboard.press("Enter");
  let startup = await waitFor(
    (value) =>
      value.startup?.phase === "new-game-plot" ||
      value.startup?.phase === "pick-dragon" ||
      value.mode === "town",
    "startup did not begin the world session",
  );
  if (startup.startup?.phase === "new-game-plot") {
    await advance(2_050);
    await page.keyboard.press("Enter");
    startup = await waitFor(
      (value) => value.startup?.phase === "pick-dragon",
      "starter picker did not open",
    );
  }
  if (startup.startup?.phase === "pick-dragon") await page.keyboard.press("1");
  startup = await waitFor((value) => value.mode === "town", "town did not open");
  await advance(1_000);
  startup = await state();
  for (let index = 0; startup.overlay?.kind === "townEnterChat" && index < 20; index += 1) {
    await advance(550);
    await clickLabel("guildQuestChat");
    startup = await state();
  }
  await advance(12_000);
  await waitFor(
    async () => await page.evaluate(() => typeof window.__DIB_TEST_OPEN_STORE__ === "function"),
    "World fixture did not install the Store test route",
  );

  await page.evaluate(() => { void window.__DIB_TEST_OPEN_STORE__(); });
  await waitFor((value) => value.overlay?.category === 0, "Store did not open");

  const settle = async () => {
    for (let i = 0; i < 40; i += 1) await advance(25);
  };
  const report = {};
  const record = async (name) => {
    await settle();
    await capture(`${name}.png`);
    report[name] = { texts: await texts(), state: (await state()).overlay };
  };

  /**
   * Side-card taps only recenter, so walk through the currently reachable neighbour. A card two
   * lanes away can have only its reflected/out-of-carousel bounds clipped onto the canvas; using
   * that sliver as a synthetic hit point does not represent a source-reachable tap.
   */
  const centerOn = async (index) => {
    let current = Math.round((await state()).overlay.visualIndex);
    while (current !== index) {
      const next = current + Math.sign(index - current);
      await clickLabel(`store:card:${next}`);
      await waitFor(
        (value) => Math.abs(value.overlay.visualIndex - next) < 0.01,
        `carousel did not settle on ${next} while walking to ${index}`,
      );
      current = next;
    }
  };
  const openCentered = async (expectedCategory) => {
    await clickLabel("store:selection");
    await waitFor(
      (value) => value.overlay?.category === expectedCategory &&
        value.overlay?.cards?.length === value.overlay?.stockCount,
      `category ${expectedCategory} did not open`,
    );
  };

  // 1. Root carousel, Currency card centered (reference: "Gold and Silver").
  await centerOn(2);
  await record("01-root-currency");

  // 2. Items aisle with a gem centered (reference: "Random Gem: Oval-Magic").
  await centerOn(0);
  await openCentered(1);
  await centerOn(3);
  await record("02-items-gem");

  // 3. Totems aisle (reference: "Fire Spirit Totem").
  await clickLabel("store:close");
  await waitFor((value) => value.overlay?.category === 0, "close did not pop back to the root");
  // The far edge of the five root cards is only partly on-canvas, so walk to it in two taps.
  await centerOn(2);
  await centerOn(4);
  await openCentered(5);
  await record("03-totems");

  fs.writeFileSync(
    path.join(outputDir, "labels.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  assert.equal(errors.length, 0, `page errors: ${errors.join(" | ")}`);
  console.log("captured to", outputDir);
} finally {
  await browser.close();
}
