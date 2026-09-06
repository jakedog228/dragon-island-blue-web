

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-authority-key";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/official-party-editor");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
assert(token.length >= 16, "DIB_TEST_AUTH_KEY must contain at least 16 characters");
fs.mkdirSync(outputDirectory, { recursive: true });

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const logicPackId = readiness.installedLogicPackIds[0];
const sessionResponse = await fetch(`${gameUrl}/api/game/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    protocolVersion: "game-protocol-v1",
    loginToken: token,
    logicPackId,
    supportedEventVersions: ["presentation-events-v1"],
  }),
});
if (sessionResponse.status !== 200) throw new Error(await sessionResponse.text());
const apiSession = await sessionResponse.json();
const authHeaders = {
  Authorization: `Bearer ${apiSession.token}`,
  "Content-Type": "application/json",
};
const occupied = apiSession.slots.find((slot) => slot.slotId === "slot-1");
if (occupied !== undefined) {
  const deleted = await fetch(`${gameUrl}/api/game/slots/slot-1`, {
    method: "DELETE",
    headers: authHeaders,
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      expectedRevision: occupied.revision,
    }),
  });
  if (deleted.status !== 200) throw new Error(await deleted.text());
}

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
  });
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await page.getByLabel("Login token").fill(token);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.locator(".content-gate__login-status--success").waitFor();
  await page.locator(".content-gate__rights input").check();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitFor = async (predicate, description, frames = 800) => {
    for (let index = 0; index < frames; index++) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`);
  };
  const targetForLabel = (label) => page.evaluate((wanted) => {
    const root = window.__PIXI_APP__?.stage;
    const boundary = window.__PIXI_APP__?.renderer?.events?.rootBoundary;
    const stack = root === undefined ? [] : [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted && node.visible && node.renderable) {
        const bounds = node.getBounds();
        const fractions = [0.5, 0.25, 0.75, 0.1, 0.9];
        for (const fy of fractions) {
          for (const fx of fractions) {
            const point = {
              x: bounds.x + bounds.width * fx,
              y: bounds.y + bounds.height * fy,
            };
            const hit = boundary?.hitTest?.(point.x, point.y);
            for (let current = hit; current; current = current.parent) {
              if (current === node) return { point, bounds };
            }
          }
        }
        return {
          point: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
          bounds,
        };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  }, label);
  const clickLabel = async (label) => {
    let target;
    for (let frame = 0; frame < 40 && target === undefined; frame++) {
      target = await targetForLabel(label) ?? undefined;
      if (target === undefined) await advance(25);
    }
    assert(target, `visible Pixi target ${label} was not mounted`);
    const canvasBox = await page.locator("canvas").first().boundingBox();
    assert(canvasBox, "game canvas has no CSS bounds");
    await page.mouse.click(canvasBox.x + target.point.x, canvasBox.y + target.point.y);
  };
  await waitFor(
    (snapshot) => snapshot.mode === "start" && snapshot.startup?.phase === "title",
    "official content did not reach the source title",
  );
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) =>
      value.startup?.phase === "save-select" ||
      value.startup?.phase === "new-game-plot",
    "title did not begin empty-slot selection",
  );
  const canvasBox = await page.locator("canvas").first().boundingBox();
  assert(canvasBox, "official client has no canvas");
  const geometry = await stageGeometry(page, canvasBox);
  if (snapshot.startup.phase === "save-select") {
    const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
    assert(slot?.enabled, `authoritative slot is unavailable: ${JSON.stringify(snapshot.startup)}`);
    await advance(500);
    const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
    await page.mouse.click(slotPoint.x, slotPoint.y);
  }
  snapshot = await waitFor(
    (value) => value.startup?.phase === "new-game-plot",
    "empty Official slot skipped the source introductory plot",
  );
  assert(snapshot.startup.intro.characterCount > 0, "source introductory plot has no dialogue");
  await advance(snapshot.startup.intro.scrollMs);
  await page.keyboard.press("Enter");
  await waitFor(
    (value) => value.startup?.phase === "pick-dragon",
    "introductory plot did not open the starter picker",
  );
  await page.keyboard.press("1");
  snapshot = await waitFor(
    (value) =>
      value.mode === "town" &&
      value.overlay?.kind === "townEnterChat" &&
      value.overlay.chatName === "LeslieIntro1",
    "fresh Official slot did not present LeslieIntro1",
  );
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await clickLabel("guildQuestChat");
    await advance(50);
    snapshot = await state();
  }
  await waitFor(
    (value) =>
      value.mode === "town" &&
      value.overlay === null &&
      value.town?.dayNotification?.visible !== true &&
      !value.locked,
    "occupied Official slot did not restore to an interactive town",
  );

  await clickLabel("town:First_City:menu:MonsterManagementMenuItem");
  await waitFor(
    (value) => value.overlay?.screen === "partyEditor" && value.overlay.style === 0,
    "town Monster Management did not open",
  );
  let tutorialState = await waitFor(
    (value) => value.tutorial?.key === "Tutorial4" && value.tutorial.okReady === true,
    "town Monster Management did not present its first-use tutorial",
  );
  for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
    const previousPage = tutorialState.tutorial.page;
    await page.keyboard.press("Enter");
    tutorialState = await waitFor(
      (value) =>
        value.tutorial === undefined ||
        (value.tutorial.okReady === true && value.tutorial.page !== previousPage),
      "town Monster Management tutorial did not advance",
    );
    if (tutorialState.tutorial === undefined) break;
  }
  assert.equal(tutorialState.tutorial, undefined, "town Monster Management tutorial did not finish");
  await clickLabel("partyEditorClose");
  await waitFor(
    (value) => value.mode === "town" && value.overlay === null,
    "town party editor did not close",
  );
  await clickLabel("town:First_City:exit");
  snapshot = await waitFor(
    (value) => value.mode === "world" && value.tutorial?.key === "Tutorial2" && value.tutorial.okReady,
    "leaving town did not present Tutorial2",
  );
  await page.keyboard.press("Enter");
  await waitFor(
    (value) => value.mode === "world" && value.tutorial === undefined && !value.locked,
    "Tutorial2 did not release world input",
  );

  await clickLabel("worldMenuButton");
  await waitFor((value) => value.menu?.config === "MasterMenu", "world menu did not open");
  await advance(500);
  await clickLabel("worldMenu:monsters");
  snapshot = await waitFor(
    (value) => value.overlay?.screen === "partyEditor" && value.overlay.style === 1,
    "outdoor Monster Management did not open",
  );
  const diagnostic = await page.evaluate(() => {
    const root = window.__PIXI_APP__?.stage;
    const boundary = window.__PIXI_APP__?.renderer?.events?.rootBoundary;
    const stack = root === undefined ? [] : [root];
    let close;
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === "partyEditorClose") {
        const bounds = node.getBounds();
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        const hit = boundary?.hitTest?.(point.x, point.y);
        const hitPath = [];
        for (let current = hit; current; current = current.parent) {
          hitPath.push({ label: current.label || null, eventMode: current.eventMode });
        }
        const ancestors = [];
        for (let current = node; current; current = current.parent) {
          ancestors.push({
            label: current.label || null,
            eventMode: current.eventMode,
            visible: current.visible,
            renderable: current.renderable,
          });
        }
        close = { bounds, point, hitPath, ancestors };
        break;
      }
      stack.push(...(node?.children ?? []));
    }
    return close;
  });
  assert(diagnostic, "party editor close diagnostic target was not mounted");
  if (process.env.DIB_BROWSER_TRACE === "1") {
    process.stdout.write(`${JSON.stringify(diagnostic)}\n`);
    await page.evaluate(() => {
      window.__DIB_PARTY_POINTER_TRACE__ = [];
      const recordNative = (event) => {
        window.__DIB_PARTY_POINTER_TRACE__.push({
          source: "native",
          type: event.type,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
        });
      };
      const recordPixi = (event) => {
        window.__DIB_PARTY_POINTER_TRACE__.push({
          source: "pixi",
          type: event.type,
          x: event.global.x,
          y: event.global.y,
          pointerId: event.pointerId,
          target: event.target?.label ?? null,
        });
      };
      const canvas = window.__PIXI_APP__.canvas;
      canvas.addEventListener("pointerdown", recordNative, { capture: true, once: true });
      canvas.addEventListener("pointerup", recordNative, { capture: true, once: true });
      window.__PIXI_APP__.stage.once("pointerdowncapture", recordPixi);
      window.__PIXI_APP__.stage.once("pointerupcapture", recordPixi);
    });
  }
  await clickLabel("partyEditorClose");
  if (process.env.DIB_BROWSER_TRACE === "1") {
    await page.waitForTimeout(50);
    process.stdout.write(`${JSON.stringify(await page.evaluate(
      () => window.__DIB_PARTY_POINTER_TRACE__,
    ))}\n`);
  }
  snapshot = await waitFor(
    (value) => value.mode === "world" && value.overlay === null && value.menu === null,
    `outdoor party editor did not close; diagnostic=${JSON.stringify(diagnostic)}`,
    100,
  );
  assert.equal(errors.length, 0, `browser errors: ${errors.join(" | ")}`);
  process.stdout.write("Official outdoor party editor close scenario passed.\n");
} finally {
  await browser.close();
}
