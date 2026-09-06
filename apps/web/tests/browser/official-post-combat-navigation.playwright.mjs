// Opt-in regression for Official combat -> retained world -> next encounter navigation. It seeds
// only the pre-battle world position through semantic commands, then drives both navigations and
// the combat exit through the real browser. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-authority-key";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/official-post-combat-navigation");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
assert(token.length >= 16, "DIB_TEST_AUTH_KEY must contain at least 16 characters");
fs.mkdirSync(outputDirectory, { recursive: true });

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const logicPackId = readiness.installedLogicPackIds[0];
assert(logicPackId, "game server has no installed logic pack");
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
assert.match(apiSession.pack.simulationVersion, /^official-game-v\d+$/);
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

let serial = 0;
let committed;
const execute = async (command) => {
  const decision = committed?.projection.decision;
  const response = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      commandId: `browser_post_combat_navigation_${String(++serial).padStart(4, "0")}`,
      expectedRevision: committed?.revision ?? 0,
      ...(decision?.decisionId === undefined ? {} : { expectedDecisionId: decision.decisionId }),
      command,
    }),
  });
  if (response.status !== 200) {
    throw new Error(`${command.type} failed: ${await response.text()}`);
  }
  committed = await response.json();
  return committed;
};

// Leave the authority at Tutorial Hut. Browser-owned Field 1 entry must create and retain the
// exact WorldNode whose dependencies are later refreshed after combat.
await execute({ type: "slot.create", starterElement: "Water" });
await execute({ type: "player.claimDialog", dialogId: "LeslieIntro1" });
await execute({ type: "player.claimTutorialFlag", flag: "flashTownExit" });
await execute({ type: "world.leaveTown" });
await execute({ type: "player.claimTutorialFlag", flag: "Tutorial2" });
await execute({ type: "world.navigate", targetPoiId: "1-1_Turtorial_Hut_1" });
assert.deepEqual(committed.projection.location, {
  kind: "world",
  worldId: "World_1-1",
  poiId: "1-1_Turtorial_Hut_1",
});
process.stdout.write("official-post-combat-navigation: authority seeded at Tutorial Hut\n");

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const browserCommands = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (!request.url().includes("/commands")) return;
    browserCommands.push(request.postDataJSON()?.command?.type ?? "unknown");
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
  const loginStatus = page.locator(".content-gate__login-status");
  await page.waitForFunction(() => {
    const status = document.querySelector(".content-gate__login-status");
    return status?.classList.contains("content-gate__login-status--success") ||
      status?.classList.contains("content-gate__login-status--error");
  }, undefined, { timeout: 30_000 });
  assert(
    await loginStatus.evaluate((status) =>
      status.classList.contains("content-gate__login-status--success")),
    `Official login failed: ${(await loginStatus.textContent())?.trim()}`,
  );
  process.stdout.write("official-post-combat-navigation: content gate authenticated\n");
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
      const exhaustion = errors.find((error) => error.includes("committed draw tape exhausted"));
      if (exhaustion !== undefined) throw new Error(`${description}; ${exhaustion}`);
      await advance(25);
    }
    throw new Error(
      `${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`,
    );
  };
  // Emitting on the row node reaches nothing: a source PopupMenu owns one `menuItems` list,
  // so this port keeps rows inert and routes the tap through the menu that owns them.
  // `tapPixiLabel` delivers to that owner and reports its label, so a missing control still
  // throws rather than passing silently.
  const activatePixiControl = async (label) => (await tapPixiLabel(page, label)) !== undefined;
  const pixiCenter = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node?.label === wanted && node.visible && node.renderable) {
        const bounds = node.getBounds();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  }, label);
  const clickStagePoint = async (point) => {
    const box = await page.locator("canvas").first().boundingBox();
    assert(box, "canvas disappeared before stage click");
    await page.mouse.click(
      box.x + geometry.offsetX + point.x * geometry.scale,
      box.y + geometry.offsetY + point.y * geometry.scale,
    );
  };
  const captureCanvas = async (filename) => {
    const dataUrl = await page.evaluate(() =>
      document.querySelector("canvas").toDataURL("image/png"));
    fs.writeFileSync(
      path.join(outputDirectory, filename),
      Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
    );
  };

  await waitFor(
    (snapshot) => snapshot.mode === "start" && snapshot.startup?.phase === "title",
    "Official content did not reach the title",
  );
  process.stdout.write("official-post-combat-navigation: title ready\n");
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "Official title did not open save selection",
  );
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
  assert(canvasBox, "Official client has no canvas");
  const geometry = await stageGeometry(page, canvasBox);
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, "prepared Official slot is unavailable");
  await advance(500);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);
  snapshot = await waitFor(
    (value) =>
      value.mode === "world" &&
      value.currentPoi === "1-1_Turtorial_Hut_1" &&
      !value.locked &&
      !value.walking &&
      value.tutorial === undefined,
    "prepared Official world did not become interactive",
  );
  process.stdout.write("official-post-combat-navigation: Tutorial Hut world ready\n");
  const retainedSceneInstanceId = snapshot.sceneInstanceId;
  const field = snapshot.pois.find(
    (poi) => poi.name === "1-1_Field_1" && poi.state === 4,
  );
  assert(field, `Tutorial Hut did not expose Field 1: ${JSON.stringify(snapshot.poiStates)}`);
  const fieldPoint = geometry.toCss({ x: field.position.x + 8, y: field.position.y });
  await page.mouse.click(fieldPoint.x, fieldPoint.y);
  await waitFor((value) => value.mode === "battle", "Field 1 battle did not mount");
  process.stdout.write("official-post-combat-navigation: Field 1 battle mounted\n");

  for (let frame = 0; frame < 400; frame++) {
    snapshot = await state();
    if (snapshot.mode === "battle" && snapshot.panelVisible) break;
    if (snapshot.tutorial?.okReady === true) {
      await page.keyboard.press("Enter");
      await advance(25);
      continue;
    }
    if (snapshot.activePopup === "encounterChat") {
      await advance(550);
      const chat = await pixiCenter("guildQuestChat");
      assert(chat, "encounter chat was not mounted");
      await clickStagePoint(chat);
      await advance(25);
      continue;
    }
    await advance(25);
  }
  snapshot = await state();
  assert(
    snapshot.mode === "battle" && snapshot.panelVisible,
    `Field 1 battle did not reach a player decision: ${JSON.stringify({
      presentation: snapshot.presentation,
      activePopup: snapshot.activePopup,
      entry: snapshot.entry,
      statusText: snapshot.statusText,
      errors,
    })}`,
  );
  process.stdout.write("official-post-combat-navigation: player decision ready\n");

  for (let attempt = 0; attempt < 30; attempt++) {
    if (snapshot.presentation.state === "retreated") break;
    assert(
      await activatePixiControl("secondary:retreat"),
      "Official battle panel omitted Retreat",
    );
    await waitFor(
      (value) => value.activePopup === "confirmRetreat",
      "Retreat did not open its confirmation",
      120,
    );
    await advance(250);
    assert(
      await activatePixiControl("popupButton:Yes"),
      "Retreat confirmation omitted Yes",
    );
    snapshot = await waitFor(
      (value) =>
        value.presentation.state === "retreated" ||
        value.presentation.state === "retreatFailedAwaitingStatus",
      "Official retreat did not commit a result",
    );
    process.stdout.write(
      `official-post-combat-navigation: retreat ${attempt + 1} -> ${snapshot.presentation.state}\n`,
    );
    if (snapshot.presentation.state === "retreated") break;
    await waitFor(
      (value) => value.statusText?.visible === true,
      "failed retreat status text did not become dismissible",
      120,
    );
    const statusAcknowledge = geometry.toCss({ x: 240, y: 260 });
    await page.mouse.click(statusAcknowledge.x, statusAcknowledge.y);
    snapshot = await waitFor(
      (value) => value.mode === "battle" && value.panelVisible,
      "failed retreat did not advance to the next player decision",
      400,
    );
  }
  assert.equal(
    snapshot.presentation.state,
    "retreated",
    "Official retreat did not succeed within 30 attempts",
  );
  await advance(550);
  await advance(250);
  assert(
    await activatePixiControl("popupButton:Ok"),
    "retreat popup omitted its visible Ok button",
  );
  snapshot = await waitFor(
    (value) => value.mode === "world" && !value.locked && !value.walking,
    "Official combat did not restore the retained world",
  );
  process.stdout.write("official-post-combat-navigation: retained world restored\n");
  assert.equal(
    snapshot.sceneInstanceId,
    retainedSceneInstanceId,
    "Official combat return rebuilt the world instead of retaining it",
  );
  const currentPoi = snapshot.pois.find((poi) => poi.state === 2);
  assert.equal(currentPoi?.name, "1-1_Field_1", "returned world lost its current Field 1 POI");
  await captureCanvas("returned-world.png");

  const repeatPoint = geometry.toCss({
    x: currentPoi.position.x + 8,
    y: currentPoi.position.y,
  });
  await page.mouse.click(repeatPoint.x, repeatPoint.y);
  process.stdout.write("official-post-combat-navigation: post-combat Field 1 clicked\n");
  snapshot = await waitFor(
    (value) => value.mode === "battle",
    "Official post-combat click did not mount the next encounter",
  );
  await waitFor(
    (value) => value.mode === "battle" && value.entry.transitionFinished,
    "post-combat encounter did not finish its entry transition",
  );
  await captureCanvas("next-encounter.png");
  assert.deepEqual(
    browserCommands.filter((command) => command === "world.navigate"),
    ["world.navigate", "world.navigate"],
    `browser did not submit exactly the entry and post-combat navigation commands: ${JSON.stringify(browserCommands)}`,
  );
  assert.deepEqual(errors, [], errors.join(" | "));
  await page.evaluate(() => window.__PIXI_APP__.ticker.stop());
  await page.close({ runBeforeUnload: false });
  process.stdout.write(
    "Official post-combat navigation: PASS (retained world, committed replay, next encounter)\n",
  );
} finally {
  await browser.close();
}
