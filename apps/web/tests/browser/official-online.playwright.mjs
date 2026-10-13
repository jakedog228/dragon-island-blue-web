

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const token = process.env.DIB_TEST_AUTH_KEY ?? "browser-official-authority-key";
const shortSmoke = process.env.DIB_OFFICIAL_SMOKE_SHORT === "1";
const postCombatNavigation = process.env.DIB_OFFICIAL_POST_COMBAT_NAVIGATION === "1";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/official-online");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
assert(token.length >= 16, "DIB_TEST_AUTH_KEY must contain at least 16 characters");
fs.mkdirSync(outputDirectory, { recursive: true });

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const logicPackId = readiness.installedLogicPackIds[0];
const createSession = async () => {
  const response = await fetch(`${gameUrl}/api/game/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      loginToken: token,
      logicPackId,
      supportedEventVersions: ["presentation-events-v1"],
    }),
  });
  if (response.status !== 200) throw new Error(await response.text());
  return response.json();
};
let apiSession = await createSession();
assert.equal(apiSession.pack.simulationVersion, "official-game-v25");
const authHeaders = () => ({
  Authorization: `Bearer ${apiSession.token}`,
  "Content-Type": "application/json",
});






const clearSlotOne = async () => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const occupied = apiSession.slots.find((slot) => slot.slotId === "slot-1");
    if (!occupied) return;
    const deleted = await fetch(`${gameUrl}/api/game/slots/slot-1`, {
      method: "DELETE",
      headers: authHeaders(),
      body: JSON.stringify({
        protocolVersion: "game-protocol-v1",
        expectedRevision: occupied.revision,
      }),
    });
    if (deleted.status === 200) return;
    const body = await deleted.text();
    if (attempt > 0 || !body.includes("REVISION_CONFLICT")) {
      throw new Error(
        `could not clear slot-1 (${deleted.status}): ${body}. Another writer holds this ` +
          "slot -- run the Official family one scenario at a time against its own authority.",
      );
    }
    console.log(`official-online: slot-1 revision moved under us, re-reading (${body})`);
    apiSession = await createSession();
  }
};
await clearSlotOne();

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  await (async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const gameRequests = [];
  const commandResponses = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (!request.url().includes("/api/game/")) return;
    const body = request.postData();
    gameRequests.push({
      path: new URL(request.url()).pathname,
      method: request.method(),
      body: body === null ? undefined : JSON.parse(body),
    });
  });
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.match(/^\/api\/game\/slots\/slot-[123]\/commands$/) === null) {
      return;
    }
    commandResponses.push(Promise.resolve({
      status: response.status(),
      serverTiming: response.headers()["server-timing"],
    }));
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
  // The ordered gate deliberately keeps future play modes collapsed until an archive has passed
  // the first client-side selection step. Select it before waiting on the now-visible mode rows.
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByLabel("Offline", { exact: true }).waitFor();
  await page.getByLabel("Online (Beta)", { exact: true }).waitFor();
  await page.getByLabel("Offline", { exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success').waitFor();

  await page.getByRole("button", { name: "Offline settings" }).click();
  let storageDialog = page.getByRole("dialog", { name: "Offline settings" });
  await storageDialog.getByRole("navigation", { name: "Offline save pages" }).waitFor();
  assert.equal(
    await storageDialog.getByRole("button", { name: /^Export Slot /, includeHidden: true }).count(),
    3,
    "Offline settings omitted a slot export control",
  );
  assert.equal(
    await storageDialog.getByRole("button", { name: /^Undo last save in Slot /, includeHidden: true }).count(),
    3,
    "Offline settings omitted rollback controls",
  );
  assert.equal(
    await storageDialog.getByRole("button", { name: "Import save file" }).count(),
    1,
    "Offline settings omitted backup import",
  );
  await storageDialog.getByRole("button", { name: "Close save settings" }).click();

  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await page.getByLabel("Login token").fill(token);
  assert(
    await page.locator(".content-gate__rights input").isDisabled(),
    "Online completion was enabled before explicit login",
  );
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.locator(".content-gate__login-status--success").waitFor({ timeout: 30_000 });
  await page.locator(".content-gate__rights input").check();
  const requestsBeforeOnlineSettings = gameRequests.length;
  await page.getByRole("button", { name: "Online settings" }).click();
  storageDialog = page.getByRole("dialog", { name: "Online settings" });
  await storageDialog.getByText("Online save slots").waitFor();
  assert.equal(
    await storageDialog.getByRole("button", { name: /^Export Slot / }).count(),
    3,
    "Online settings omitted a slot export control",
  );
  assert.equal(
    await storageDialog.getByRole("button", { name: /^Undo last save in Slot /, includeHidden: true }).count(),
    0,
    "Online settings exposed rollback",
  );
  assert.equal(
    await storageDialog.getByRole("button", { name: "Import backup" }).count(),
    0,
    "Online settings exposed import",
  );
  assert(
    gameRequests.slice(requestsBeforeOnlineSettings).every((request) =>
      request.path === "/api/game/session" || request.method === "GET"),
    `Online settings modified server state: ${
      JSON.stringify(gameRequests.slice(requestsBeforeOnlineSettings))
    }`,
  );
  await page.screenshot({
    path: path.join(outputDirectory, "online-export-settings.png"),
    fullPage: true,
    timeout: 120_000,
  });
  await storageDialog.getByRole("button", { name: "Close save settings" }).click();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();
  const firstLoadScreen = page.locator(".source-loading-bridge");
  await firstLoadScreen.waitFor({ state: "visible", timeout: 120_000 });
  assert(
    (await firstLoadScreen.locator("img").getAttribute("src"))?.startsWith("blob:"),
    "first-load screen did not use the selected archive's source background",
  );
  const loadingGeometry = await firstLoadScreen.evaluate((bridge) => {
    const frame = bridge.querySelector(".source-loading-bridge__frame");
    const background = bridge.querySelector(".source-loading-bridge__background");
    const image = bridge.querySelector(".source-loading-bridge__background-image");
    const label = bridge.querySelector(".source-loading-bridge__label");
    if (
      !(frame instanceof HTMLElement) ||
      !(background instanceof HTMLElement) ||
      !(image instanceof HTMLElement) ||
      !(label instanceof HTMLElement)
    ) {
      throw new Error("first-load screen geometry nodes are missing");
    }
    const bridgeBounds = bridge.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    const backgroundBounds = background.getBoundingClientRect();
    const imageBounds = image.getBoundingClientRect();
    const labelBounds = label.getBoundingClientRect();
    return {
      bridge: bridgeBounds.toJSON(),
      frame: frameBounds.toJSON(),
      background: backgroundBounds.toJSON(),
      image: imageBounds.toJSON(),
      label: labelBounds.toJSON(),
    };
  });
  const nearlyEqual = (left, right, tolerance = 1) => Math.abs(left - right) <= tolerance;
  assert(
    nearlyEqual(
      loadingGeometry.frame.x + loadingGeometry.frame.width / 2,
      loadingGeometry.bridge.x + loadingGeometry.bridge.width / 2,
    ) &&
      nearlyEqual(
        loadingGeometry.frame.y + loadingGeometry.frame.height / 2,
        loadingGeometry.bridge.y + loadingGeometry.bridge.height / 2,
      ),
    "first-load source frame was not centered in the viewport",
  );
  assert(
    nearlyEqual(
      loadingGeometry.background.x + loadingGeometry.background.width / 2,
      loadingGeometry.frame.x + loadingGeometry.frame.width / 2,
    ) &&
      nearlyEqual(
        loadingGeometry.background.y + loadingGeometry.background.height / 2,
        loadingGeometry.frame.y + loadingGeometry.frame.height / 2,
      ) &&
      loadingGeometry.background.width >= loadingGeometry.frame.width &&
      loadingGeometry.background.height >= loadingGeometry.frame.height &&
      nearlyEqual(loadingGeometry.image.x, loadingGeometry.background.x) &&
      nearlyEqual(loadingGeometry.image.y, loadingGeometry.background.y) &&
      nearlyEqual(loadingGeometry.image.width, loadingGeometry.background.width) &&
      loadingGeometry.image.height > loadingGeometry.background.height,
    "first-load background did not reproduce the source texture crop",
  );
  assert(
    loadingGeometry.label.y >= loadingGeometry.frame.y &&
      loadingGeometry.label.y + loadingGeometry.label.height <=
        loadingGeometry.frame.y + loadingGeometry.frame.height,
    "first-load label was rendered outside the source frame",
  );
  await page.screenshot({
    path: path.join(outputDirectory, "source-first-load.png"),
    fullPage: true,
    timeout: 120_000,
  });

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitFor = async (predicate, description, frames = 1600) => {
    for (let index = 0; index < frames; index++) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(`${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`);
  };
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
  // This contract is about the network authority boundary, not ButtonSprite arbitration (covered
  // by secondary-actions.playwright.mjs). Activate the live Pixi control deterministically so a
  // stale renderer interaction-boundary cache cannot make the server/reconnect proof flaky.
  // Emitting on the row node reaches nothing: a source PopupMenu owns one `menuItems` list,
  // so this port keeps rows inert and routes the tap through the menu that owns them.
  // `tapPixiLabel` delivers to that owner and reports its label, so a missing control still
  // throws rather than passing silently.
  const activatePixiControl = async (label) => (await tapPixiLabel(page, label)) !== undefined;
  const clickStagePoint = async (point) => {
    const box = await page.locator("canvas").first().boundingBox();
    assert(box, "canvas disappeared before stage click");
    // Pixi getBounds() is already canvas-global after FixedStage's letterbox/scale transform.
    // Reapplying app-screen scaling here misses compact popup/menu controls.
    await page.mouse.click(box.x + point.x, box.y + point.y);
  };
  const visibleTextPoint = (wanted) => page.evaluate((text) => {
    const visible = (node) => {
      for (let current = node; current; current = current.parent) {
        if (!current.visible || !current.renderable) return false;
      }
      return true;
    };
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node?.text === text && visible(node)) {
        const bounds = node.getBounds();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  }, wanted);
  const clickVisibleText = async (wanted) => {
    let point = null;
    for (let index = 0; index < 240 && point === null; index++) {
      point = await visibleTextPoint(wanted);
      if (point === null) await advance(25);
    }
    assert(point, `visible text ${wanted} was not mounted`);
    await clickStagePoint(point);
  };
  await waitFor(
    (snapshot) => snapshot.mode === "start" && snapshot.startup?.phase === "title",
    "official content did not reach the source title",
  );
  await firstLoadScreen.waitFor({ state: "detached" });
  await page.keyboard.press("Enter");
  let snapshot = await waitFor(
    (value) =>
      value.startup?.phase === "save-select" ||
      value.startup?.phase === "new-game-plot",
    "title did not begin empty-slot selection",
  );
  const canvas = page.locator("canvas").first();
  const canvasBox = await canvas.boundingBox();
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
  assert.equal(snapshot.startup.intro.image, "plot_start1.png");
  assert(
    snapshot.startup.intro.characterCount > 0,
    `source introductory plot has no dialogue: ${JSON.stringify(snapshot.startup.intro)}`,
  );
  await advance(750);
  await page.screenshot({
    path: path.join(outputDirectory, "official-new-game-plot.png"),
    fullPage: true,
    timeout: 120_000,
  });
  await advance(Math.max(50, snapshot.startup.intro.scrollMs - 700));
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "pick-dragon",
    "Official introductory plot did not open the starter picker",
  );
  assert.deepEqual(
    snapshot.startup.intro.choices.map(({ shortType }) => shortType),
    ["BlueBabyDragon", "RedBabyDragon", "WhiteBabyDragon", "GoldBabyDragon"],
  );
  await page.keyboard.press("1");
  snapshot = await waitFor(
    (value) =>
      value.mode === "town" &&
      value.overlay?.kind === "townEnterChat" &&
      value.overlay.chatName === "LeslieIntro1",
    "fresh Official slot did not present LeslieIntro1",
  );
  assert.equal(snapshot.party[0].instanceId, "monster-1");
  if (shortSmoke) {
    const commands = gameRequests.filter((request) => request.path.endsWith("/commands"));
    assert(
      commands.some((request) => request.body?.command?.type === "slot.create"),
      "short Official smoke did not create its authoritative slot",
    );
    assert.equal(errors.length, 0, errors.join("\n"));
    process.stdout.write(JSON.stringify({
      simulationVersion: apiSession.pack.simulationVersion,
      commands: commands.map((request) => request.body.command.type),
      reached: { mode: snapshot.mode, chatName: snapshot.overlay.chatName },
    }, null, 2));
    return;
  }
  for (let pageIndex = 0; snapshot.overlay?.kind === "townEnterChat" && pageIndex < 20; pageIndex++) {
    await advance(550);
    await waitFor(
      async () => (await pixiCenter("guildQuestChat")) !== null,
      "initial Corova story chat visual was not mounted",
    );
    const chat = await pixiCenter("guildQuestChat");
    assert(chat, "initial Corova story chat was not mounted");
    await clickStagePoint(chat);
    await advance(25);
    snapshot = await state();
  }
  await waitFor((value) => value.overlay === null, "initial Corova story chat did not finish");
  await waitFor(
    (value) => value.town?.dayNotification?.visible !== true && !value.locked,
    "initial Corova presentation did not release town input",
  );

  const managementBuilding = await pixiCenter(
    "town:First_City:menu:MonsterManagementMenuItem",
  );
  assert(managementBuilding, "Corova Monster Management building was not mounted");
  await clickStagePoint(managementBuilding);
  snapshot = await waitFor(
    (value) => value.overlay?.screen === "partyEditor" && value.overlay.style === 0,
    "Official town Monster Management did not open",
  );
  await page.screenshot({
    path: path.join(outputDirectory, "official-party-editor-open.png"),
    fullPage: true,
    timeout: 120_000,
  });
  const partyEditorClose = await pixiCenter("partyEditorClose");
  assert(partyEditorClose, "Official party editor close control was not mounted");
  await clickStagePoint(partyEditorClose);
  snapshot = await waitFor(
    (value) => value.mode === "town" && value.overlay === null && !value.locked,
    "Official party editor did not close",
  );

  const afterFreshStart = await fetch(
    `${gameUrl}/api/game/slots/slot-1/bootstrap`,
    { headers: authHeaders() },
  ).then((response) => response.json());
  const fabricatedTutorial = await fetch(`${gameUrl}/api/game/slots/slot-1/commands`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      commandId: "browser_fabricated_tutorial_0001",
      expectedRevision: afterFreshStart.revision,
      command: { type: "player.claimTutorialFlag", flag: "callerInventedFlag" },
    }),
  });
  assert.equal(fabricatedTutorial.status, 422, "fabricated tutorial flag reached the reducer");
  assert.equal((await fabricatedTutorial.json()).error.code, "ACTION_NOT_ALLOWED");
  const afterFabrication = await fetch(
    `${gameUrl}/api/game/slots/slot-1/bootstrap`,
    { headers: authHeaders() },
  ).then((response) => response.json());
  assert.equal(
    afterFabrication.revision,
    afterFreshStart.revision,
    "rejected fabricated tutorial command advanced authoritative state",
  );

  for (let pageIndex = 0; pageIndex < 8 && (await state()).tutorial !== undefined; pageIndex++) {
    const tutorialState = await waitFor(
      (value) => value.tutorial === undefined || value.tutorial.okReady === true,
      "town tutorial did not become dismissible",
    );
    if (tutorialState.tutorial === undefined) break;
    await page.keyboard.press("Enter");
    await advance(25);
  }
  assert.equal((await state()).tutorial, undefined, "town tutorial did not finish");

  const exitPoint = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node?.label === "town:First_City:exit") {
        const bounds = node.getBounds();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  });
  assert(exitPoint, "town exit was not mounted");
  await page.mouse.click(canvasBox.x + exitPoint.x, canvasBox.y + exitPoint.y);
  snapshot = await waitFor((value) => value.mode === "world" && !value.locked, "town did not exit");
  if (snapshot.tutorial?.key === "Tutorial2") {
    await waitFor(
      (value) => value.tutorial?.key === "Tutorial2" && value.tutorial.okReady,
      "field tutorial did not become dismissible before opening the world menu",
    );
    await page.keyboard.press("Enter");
    snapshot = await waitFor(
      (value) => value.mode === "world" && value.tutorial === undefined,
      "field tutorial did not release world input",
    );
  }
  assert(await activatePixiControl("worldMenuButton"), "Official world menu button was not mounted");
  await waitFor((value) => value.menu?.config === "MasterMenu", "Official world menu did not open");
  assert(await activatePixiControl("worldMenu:monsters"), "Official world menu omitted Monsters");
  snapshot = await waitFor(
    (value) => value.overlay?.screen === "partyEditor" && value.overlay.style === 1,
    "Official world party editor did not open",
  );
  const worldPartyEditorClose = await pixiCenter("partyEditorClose");
  assert(worldPartyEditorClose, "Official world party editor close control was not mounted");
  await clickStagePoint(worldPartyEditorClose);
  snapshot = await waitFor(
    (value) => value.mode === "world" && value.overlay === null && value.menu === null,
    "Official world party editor did not close",
    100,
  );
  const target = snapshot.pois.find((poi) => poi.state === 4 && poi.name !== snapshot.currentPoi);
  assert(target, `world has no selectable neighbor: ${JSON.stringify(snapshot.poiStates)}`);
  const targetPoint = geometry.toCss({ x: target.position.x + 8, y: target.position.y });
  await page.mouse.click(targetPoint.x, targetPoint.y);
  await waitFor(
    (value) => value.currentPoi === target.name || value.mode === "battle",
    "authoritative POI navigation did not commit",
  );

  snapshot = await state();
  if (snapshot.tutorial) {
    await waitFor((value) => value.tutorial?.okReady === true, "field tutorial did not become dismissible");
    assert(await pixiCenter("plotTutorialOkBackground"), "field tutorial OK button was not mounted");
    await page.keyboard.press("Enter");
  }
  snapshot = await waitFor(
    (value) => value.mode === "world" && !value.walking && value.tutorial === undefined,
    "world did not settle after tutorial traversal",
  );
  const worldSceneInstanceIdBeforeBattle = snapshot.sceneInstanceId;
  const field = snapshot.pois.find((poi) => poi.name === "1-1_Field_1" && poi.state !== 3);
  assert(field, `Field 1 was not unlocked: ${JSON.stringify(snapshot.poiStates)}`);
  const fieldPoint = geometry.toCss({ x: field.position.x + 8, y: field.position.y });
  await page.mouse.click(fieldPoint.x, fieldPoint.y);
  await waitFor(
    (value) => value.mode === "battle",
    "server-authored Field 1 encounter did not mount",
  );
  for (let frame = 0; frame < 1_600; frame++) {
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
  snapshot = await waitFor(
    (value) => value.mode === "battle" && value.panelVisible,
    "authoritative battle did not reach a player decision",
  );
  const delay = snapshot.secondaryActions.find((action) => action.kind === "delay");
  assert(delay, "battle panel omitted Delay");
  assert(await activatePixiControl("secondary:delay"), "battle panel omitted the live Delay button");
  await waitFor(
    (value) => value.activePopup === "confirmSkip",
    "Delay did not open its confirmation",
    120,
  );
  await advance(250);
  assert(await activatePixiControl("popupButton:Yes"), "Delay confirmation omitted Yes");
  await waitFor(
    () => gameRequests.some((request) => request.body?.command?.type === "battle.delay"),
    "confirmed Delay did not reach the authority",
  );
  await waitFor(
    (value) => value.mode === "battle" && value.panelVisible,
    "battle did not advance to the next committed decision",
  );
  await advance(50);
  if (postCombatNavigation) {
    for (let attempt = 0; attempt < 30; attempt++) {
      snapshot = await waitFor(
        (value) =>
          value.presentation.state === "retreated" ||
          (value.mode === "battle" && value.panelVisible),
        "Official battle did not settle for retreat",
      );
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
      if (snapshot.presentation.state === "retreated") break;
      const statusAcknowledge = geometry.toCss({ x: 240, y: 260 });
      await page.mouse.click(statusAcknowledge.x, statusAcknowledge.y);
    }
    snapshot = await state();
    assert.equal(
      snapshot.presentation.state,
      "retreated",
      "Official retreat did not succeed within 30 attempts",
    );
    await clickVisibleText("Ok");
    snapshot = await waitFor(
      (value) => value.mode === "world" && !value.locked && !value.walking,
      "Official battle did not restore the retained world",
    );
    assert.equal(
      snapshot.sceneInstanceId,
      worldSceneInstanceIdBeforeBattle,
      "Official battle return rebuilt the world instead of retaining its scene",
    );
    const currentPoi = snapshot.pois.find((poi) => poi.state === 2);
    assert(currentPoi, "returned Official world omitted its current state-2 POI");
    await page.screenshot({
      path: path.join(outputDirectory, "official-post-combat-world.png"),
      fullPage: true,
      timeout: 120_000,
    });
    const currentPoiPoint = geometry.toCss({
      x: currentPoi.position.x + 8,
      y: currentPoi.position.y,
    });
    await page.mouse.click(currentPoiPoint.x, currentPoiPoint.y);
    snapshot = await waitFor(
      (value) => value.mode === "battle",
      "Official post-combat navigation did not mount the next encounter",
      400,
    );
    await page.screenshot({
      path: path.join(outputDirectory, "official-post-combat-next-encounter.png"),
      fullPage: true,
      timeout: 120_000,
    });
    assert.equal(errors.length, 0, errors.join("\n"));
    process.stdout.write("Official post-combat navigation scenario passed.\n");
    return;
  }
  const beforeReload = await state();
  assert.equal(
    beforeReload.encounter.winChat,
    "LeslieSaved",
    "live Official fixed encounter omitted its post-win chat",
  );
  await page.screenshot({
    path: path.join(outputDirectory, "official-battle-before-reload.png"),
    fullPage: true,
    timeout: 120_000,
  });



  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await page.getByLabel("Login token").fill(token);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.locator(".content-gate__login-status--success").waitFor({ timeout: 30_000 });
  await page.locator(".content-gate__rights input").check();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();
  await waitFor(
    (value) => value.mode === "start" && value.startup?.phase === "title",
    "reloaded official content did not reach title",
  );
  await page.keyboard.press("Enter");
  snapshot = await waitFor(
    (value) => value.startup?.phase === "save-select",
    "reload did not reopen authoritative save selection",
  );
  assert(
    !snapshot.startup.menu.buttons.some((button) => button.id === "erase"),
    "Official save selection exposed server-side slot deletion",
  );
  const reloadedCanvasBox = await page.locator("canvas").first().boundingBox();
  assert(reloadedCanvasBox, "reloaded client has no canvas");
  const reloadedGeometry = await stageGeometry(page, reloadedCanvasBox);
  const reloadedSlot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(reloadedSlot?.enabled, "reloaded authoritative slot is unavailable");
  await advance(500);
  const reloadedSlotPoint = reloadedGeometry.toCss({
    x: reloadedSlot.x + reloadedSlot.w / 2,
    y: reloadedSlot.y + reloadedSlot.h / 2,
  });
  await page.mouse.click(reloadedSlotPoint.x, reloadedSlotPoint.y);
  snapshot = await waitFor(
    (value) => value.mode === "battle" && value.panelVisible,
    "active authoritative battle did not resume after reload",
  );
  assert.equal(snapshot.presentation.state, "awaitingPlayerChoice");
  assert.deepEqual(
    snapshot.monsters.map(({ id, hp, maxHp }) => ({ id, hp, maxHp })),
    beforeReload.monsters.map(({ id, hp, maxHp }) => ({ id, hp, maxHp })),
    "reloaded battle HP diverged from the committed pre-reload presentation",
  );
  assert.deepEqual(snapshot.queue, beforeReload.queue, "reloaded battle queue diverged");
  assert.equal(snapshot.activeActorId, beforeReload.activeActorId, "reloaded active actor diverged");
  assert.equal(
    snapshot.encounter.winChat,
    beforeReload.encounter.winChat,
    "reloaded Official battle dropped its post-win chat",
  );

  const commands = gameRequests.filter((request) => request.path.endsWith("/commands"));
  assert(commands.some((request) => request.body?.command?.type === "world.leaveTown"));
  assert(commands.some((request) => request.body?.command?.type === "world.navigate"));
  assert(commands.some((request) => request.body?.command?.type === "battle.delay"));
  assert(commands.some((request) => request.body?.command?.type === "player.claimDialog"));
  assert(commands.some((request) => request.body?.command?.type === "party.commitBattingPriority"));
  const tutorialFlags = commands
    .filter((request) => request.body?.command?.type === "player.claimTutorialFlag")
    .map((request) => request.body.command.flag);
  assert(tutorialFlags.includes("flashTownExit"), "town exit tutorial was not server-committed");
  assert(tutorialFlags.includes("Tutorial2"), "field tutorial was not server-committed");
  const allowedTutorialFlags = new Set([
    "Tutorial0",
    "Tutorial1",
    "Tutorial2",
    "Tutorial4",
    "flashTownExit",
    "FirstMonsterpedia",
    "FirstAllMonsterpedia",
  ]);
  for (const flag of tutorialFlags) {
    assert(allowedTutorialFlags.has(flag), `browser submitted unreviewed tutorial flag ${flag}`);
  }
  for (const request of commands) {
    const text = JSON.stringify(request.body);
    for (const forbidden of ['"state"', '"seed"', '"chance"', '"reward"', '"damage"', '"xp"', '"price"']) {
      assert(!text.includes(forbidden), `official request leaked caller-authored ${forbidden}: ${text}`);
    }
  }
  const committedResponses = await Promise.all(commandResponses);
  assert.equal(committedResponses.length, commands.length, "command response timing census drifted");
  for (const response of committedResponses) {
    assert.equal(response.status, 200, "an observed official command did not commit");
    assert.match(
      response.serverTiming ?? "",
      /^queue-read;dur=\d+\.\d{3}, validation;dur=\d+\.\d{3}, reduction;dur=\d+\.\d{3}, finalize;dur=\d+\.\d{3}, persistence;dur=\d+\.\d{3}, command;dur=\d+\.\d{3}$/,
      "official command omitted its Server-Timing phase breakdown",
    );
  }
  assert(
    gameRequests.every((request) => !request.path.startsWith("/api/saves")),
    "official play used the legacy snapshot endpoint",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  await advance(50);
  await page.screenshot({
    path: path.join(outputDirectory, "official-world.png"),
    fullPage: true,
    timeout: 120_000,
  });
  process.stdout.write(JSON.stringify({
    commands: commands.map((request) => request.body.command.type),
    final: await state(),
  }, null, 2));
  })();
} finally {
  await browser.close();
}
