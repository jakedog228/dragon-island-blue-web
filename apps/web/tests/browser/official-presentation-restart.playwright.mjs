// Opt-in Official-mode town presentation-restart contract. It creates a fresh authoritative slot
// through semantic commands, boots the real browser client, and proves renderer-only restarts do
// not mutate the projection mirror or emit gameplay commands. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-authority-key";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/official-presentation-restart");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
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
const createdResponse = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({
    protocolVersion: "game-protocol-v1",
    commandId: `official_presentation_restart_${Date.now().toString(36)}`,
    expectedRevision: 0,
    command: { type: "slot.create", starterElement: "Water" },
  }),
});
if (createdResponse.status !== 200) throw new Error(await createdResponse.text());
const created = await createdResponse.json();
const claimedIntroResponse = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
  method: "POST",
  headers: authHeaders,
  body: JSON.stringify({
    protocolVersion: "game-protocol-v1",
    commandId: `official_presentation_intro_${Date.now().toString(36)}`,
    expectedRevision: created.revision,
    ...(created.projection.decision?.decisionId === undefined
      ? {}
      : { expectedDecisionId: created.projection.decision.decisionId }),
    command: { type: "player.claimDialog", dialogId: "LeslieIntro1" },
  }),
});
if (claimedIntroResponse.status !== 200) throw new Error(await claimedIntroResponse.text());

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const gameplayCommands = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (!request.url().includes("/commands")) return;
    gameplayCommands.push(request.postDataJSON()?.command?.type ?? "unknown");
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_SESSION_RESTARTS__ = true;
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
  const waitFor = async (predicate, description, frames = 1_600) => {
    for (let index = 0; index < frames; index++) {
      const snapshot = await state();
      if (predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`);
  };

  await waitFor(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "Official title did not become interactive",
  );
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "Official save selection did not open",
  );
  const canvas = page.locator("canvas").first();
  let canvasBox = await canvas.boundingBox();
  assert(canvasBox, "Official client has no canvas");
  let geometry = await stageGeometry(page, canvasBox);
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, "fresh Official slot is unavailable");
  await advance(500);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);
  snapshot = await waitFor((value) => value.mode === "town" && !value.locked, "Official town did not restore");
  for (let index = 0; index < 20 && snapshot.overlay !== null; index++) {
    await page.keyboard.press("Enter");
    await advance(600);
    snapshot = await state();
  }
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.overlay === null && !value.locked,
    "Official town did not become presentation-stable",
  );

  const projectionMirrorBefore = await page.evaluate(
    () => window.__DIB_TEST_RESTART_SESSION__.snapshot(),
  );
  const commandsBeforeRestarts = gameplayCommands.length;
  const restartTown = async (displayMode, textResolutionMode, description) => {
    await page.evaluate(({ displayMode: mode, textResolutionMode: textMode }) => {
      const key = "dib.portSettings.v1";
      const saved = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({
        ...saved,
        displayMode: mode,
        textResolutionMode: textMode,
      }));
    }, { displayMode, textResolutionMode });
    await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.presentation());
    const restored = await waitFor(
      (value) =>
        value.mode === "town" &&
        value.displayMode === displayMode &&
        value.textResolutionMode === textResolutionMode &&
        value.overlay === null &&
        !value.locked,
      description,
    );
    await advance(500);
    assert.deepEqual(
      await page.evaluate(() => window.__DIB_TEST_RESTART_SESSION__.snapshot()),
      projectionMirrorBefore,
      `${description}: projection mirror changed`,
    );
    return restored;
  };

  await restartTown("ipad", "modern", "Official town did not resume in iPad mode");
  await restartTown("iphone", "modern", "Official town did not resume back in iPhone mode");
  snapshot = await restartTown(
    "iphone",
    "original",
    "Official town did not resume after a text-only change",
  );
  assert.equal(
    gameplayCommands.length,
    commandsBeforeRestarts,
    `presentation restarts emitted gameplay commands: ${JSON.stringify(gameplayCommands)}`,
  );
  assert.equal(snapshot.town.name, "First_City");
  canvasBox = await canvas.boundingBox();
  assert(canvasBox, "Official town canvas disappeared after restarts");
  geometry = await stageGeometry(page, canvasBox);
  assert.deepEqual(geometry.stagePx, { w: 960, h: 640 });
  await page.screenshot({
    path: path.join(outputDirectory, "official-town-restored.png"),
    fullPage: true,
    timeout: 120_000,
  });
  assert.deepEqual(errors, [], errors.join(" | "));
  console.log("official-presentation-restart: PASS (town display reciprocal + text-only)");
} finally {
  await browser.close();
}
