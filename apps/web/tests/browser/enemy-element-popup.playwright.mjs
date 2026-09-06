import assert from "node:assert/strict";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { loadLocalContent } from "./localContent.mjs";
import { pinEncounter } from "./fixtures.mjs";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";

const readState = (page) => page.evaluate(() => JSON.parse(window.render_game_to_text()));

const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await pinEncounter(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await loadLocalContent(page);
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).mode === "start", undefined, { timeout: 30_000 });

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).presentation?.state === "awaitingPlayerChoice",
    undefined,
    { timeout: 30_000 },
  );

  const before = await readState(page);
  const minotaur = before.monsters.find((monster) => monster.id.includes("Minotaur"));
  assert(minotaur?.elementPoint, "Minotaur element badge must expose its runtime center");
  // FixedStage letterboxes the logical stage inside the full host canvas; battle points are
  // mounted at x2 inside that stage. Geometry read from the page (display-mode agnostic).
  const { toCss } = await stageGeometry(page, box);
  const icon = toCss(minotaur.elementPoint);
  await page.mouse.click(icon.x, icon.y);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === "element:Earth");
  // `Popup.show` fetches its background/button/overlay sprites asynchronously after the
  // `activePopup` flag flips — wait for the card to actually mount before reading the stage.
  await page.waitForFunction(() => {
    const values = [];
    const visit = (node) => {
      if (typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return values.includes("Earth");
  }, undefined, { timeout: 15_000 });

  const opened = await readState(page);
  assert.equal(opened.activePopup, "element:Earth");
  const renderedTexts = await page.evaluate(() => {
    const values = [];
    const visit = (node) => {
      if (typeof node.text === "string") values.push(node.text);
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return values;
  });
  assert(renderedTexts.includes("Earth"));
  assert(renderedTexts.includes("Earth creatures are strong against air creatures and weak against fire creatures."));
  assert.equal(
    opened.monsters.find((monster) => monster.id.includes("Minotaur")).starGroups,
    minotaur.starGroups,
    "element badge must return before the body monsterTouched/star route",
  );
  // Let the 0.2s scaleY pop-in finish so the eyeball screenshot shows the settled card.
  await page.waitForTimeout(500);
  await page.screenshot({ path: "output/enemy-element-popup.png" });


  await page.mouse.click(box.x + box.width / 4, box.y + box.height / 8);
  await page.waitForTimeout(400);
  assert.equal((await readState(page)).activePopup, "element:Earth", "backdrop tap must not dismiss");
  // ...then close through the real OkButtonKey button (located via its rendered Text node).
  const okPos = await page.evaluate(() => {
    let found = null;
    const visit = (node) => {
      if (!found && typeof node.text === "string" && node.text === "Ok") {
        const b = node.getBounds();
        found = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      for (const child of node.children ?? []) visit(child);
    };
    visit(window.__PIXI_APP__.stage);
    return found;
  });
  assert(okPos, "popup must render an Ok button");
  await page.mouse.click(box.x + okPos.x, box.y + okPos.y);
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text()).activePopup === null);

  assert.deepEqual(errors, []);
  console.log("enemy-element-popup: PASS (exact Earth help + badge priority + Ok-only modal release)");
} finally {
  await browser.close();
}
