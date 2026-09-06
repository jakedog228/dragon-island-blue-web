// Opt-in same-save North Cave timing evidence. This imports the exact native save used by the
// TouchHLE capture, enters floor 4 with iPhone geometry, taps a visible encounter room, and stores
// every deterministic 60 Hz presentation frame. Chromium is always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ?? path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const nativeSave = path.resolve(process.env.DIB_NATIVE_SAVE ?? "");
const outputDirectory = path.resolve(
  process.env.DIB_DUNGEON_LOCKSTEP_OUTPUT ??
    path.join(repositoryRoot, "output/dungeon-frame-lockstep/browser"),
);
const dungeonSeed = Number(process.env.DIB_DUNGEON_LOCKSTEP_SEED ?? 20260814);
const frameCount = Number(process.env.DIB_DUNGEON_LOCKSTEP_FRAMES ?? 130);
const captureScreenshots = process.env.DIB_DUNGEON_LOCKSTEP_CAPTURE !== "0";
assert(Number.isSafeInteger(frameCount) && frameCount >= 130,
  `DIB_DUNGEON_LOCKSTEP_FRAMES must be an integer >= 130, got ${frameCount}`);
assert(nativeSave !== repositoryRoot && fs.existsSync(nativeSave),
  "DIB_NATIVE_SAVE must name the copied save used by TouchHLE");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: process.env.DIB_HEADED !== "1",
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({ viewport: { width: 960, height: 640 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  await page.addInitScript(({ seed }) => {
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
    window.advanceTime = () => Promise.resolve();
    window.__DIB_TEST_WORLD_DEMO__ = true;
    window.__DIB_TEST_DUNGEON_SEED__ = seed;
    window.__DIB_TEST_DUNGEON_ROUTE__ = {
      typeName: "Cave",
      sourceFile: "Dungeon_1.plist",
      floor: 4,
    };
  }, { seed: dungeonSeed });

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: "Offline settings" }).click();
  const storageDialog = page.getByRole("dialog", { name: "Offline settings" });
  await storageDialog.getByText("Offline save slots").waitFor();
  page.once("dialog", async (prompt) => { await prompt.accept("1"); });
  await storageDialog.locator('input[type="file"]').setInputFiles(nativeSave);
  await storageDialog.getByText(/Imported the save into slot-1\./).waitFor({ timeout: 30_000 });
  await storageDialog.getByRole("button", { name: "Close save settings" }).click();
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();

  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitForState = async (predicate, message, attempts = 800) => {
    for (let index = 0; index < attempts; index++) {
      const current = await state();
      if (predicate(current)) return current;
      await advance(25);
    }
    throw new Error(`${message}: ${JSON.stringify(await state())}`);
  };
  await waitForState((value) => value.startup?.phase === "title", "startup did not reach title");
  await page.keyboard.press("Enter");
  await waitForState(
    (value) => value.startup?.phase === "save-select",
    "startup did not reach save selection",
  );
  await advance(300);
  const canvas = page.locator("canvas").first();
  const canvasBounds = await canvas.boundingBox();
  assert(canvasBounds, "Pixi canvas is unavailable");
  const geometry = await stageGeometry(page, canvasBounds);
  let snapshot = await state();
  const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
  assert(slot?.enabled, `slot-1 must be enabled: ${JSON.stringify(snapshot.startup)}`);
  const slotPoint = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await page.mouse.click(slotPoint.x, slotPoint.y);
  snapshot = await waitForState(
    (value) => value.mode === "dungeon" && value.floor === 4,
    "matched native save did not enter North Cave floor 4",
    1600,
  );
  // The source arrival/name-plate chain can publish the numeric selector after mode=dungeon.
  // Settle that delayed arrival before draining its selector and the following presence chat.
  await advance(8_000);
  snapshot = await state();
  for (let index = 0; index < 12; index++) {
    const popupLabels = snapshot.popups?.scene?.stack?.map((popup) => popup.contentLabel) ?? [];
    if (!popupLabels.includes("dungeonWaypointSelection") && snapshot.floorDetectionChat === undefined) {
      break;
    }
    await page.keyboard.press("Enter");
    await advance(popupLabels.includes("dungeonWaypointSelection") ? 1_000 : 500);
    snapshot = await state();
  }
  assert(!(snapshot.popups?.scene?.stack ?? [])
    .some((popup) => popup.contentLabel === "dungeonWaypointSelection"),
  "waypoint selection retained input");
  assert.equal(snapshot.floorDetectionChat, undefined, "floor presence chat retained input");

  const roomScreenCenter = (current, room) => ({
    x: current.camera.x + (room.x * 60 + room.width * 30) * current.camera.scale,
    y: current.camera.y + (-(room.y + room.height) * 60 + room.height * 30) * current.camera.scale,
  });
  const visibleRoomPoint = (point) => ({
    x: Math.max(5, Math.min(475, point.x)),
    y: Math.max(5, Math.min(315, point.y)),
  });
  const byId = new Map(snapshot.rooms.map((room) => [room.id, room]));
  const parent = new Map([[snapshot.currentRoomId, undefined]]);
  const queue = [snapshot.currentRoomId];
  const reachableEncounters = [];
  while (queue.length > 0) {
    const currentId = queue.shift();
    const current = byId.get(currentId);
    if (current === undefined) continue;
    for (const link of current.links) {
      if (parent.has(link.targetRoomId)) continue;
      const candidate = byId.get(link.targetRoomId);
      if (candidate === undefined) continue;
      parent.set(candidate.id, currentId);
      if (candidate.encounter !== undefined) {
        reachableEncounters.push(candidate);
        continue;
      }
      // A treasure popup would add an unrelated input to the matched sequence. Keep the reveal
      // route on ordinary rooms; the final guarded encounter may itself also own treasure.
      if (candidate.treasure === undefined) queue.push(candidate.id);
    }
  }
  const target = reachableEncounters.find((room) => room.encounter === "encounter-pack-0") ??
    reachableEncounters[0];
  assert(target, `seed ${dungeonSeed} has no clear-room path to an encounter`);
  const pathToEncounter = [];
  for (let id = target.id; id !== undefined; id = parent.get(id)) pathToEncounter.push(id);
  pathToEncounter.reverse();
  for (const nextId of pathToEncounter.slice(1, -1)) {
    snapshot = await state();
    const next = snapshot.rooms.find((room) => room.id === nextId);
    assert(next, `missing reveal-path room ${nextId}`);
    const point = visibleRoomPoint(roomScreenCenter(snapshot, next));
    const css = geometry.toCss(point);
    await page.mouse.click(css.x, css.y);
    snapshot = await waitForState(
      (value) => value.currentRoomId === nextId && value.locked === false,
      `dungeon did not settle in reveal-path room ${nextId}`,
    );
  }
  snapshot = await state();
  const targetPoint = visibleRoomPoint(roomScreenCenter(snapshot, target));
  const encounterLabel = `dungeonEncounter:${target.encounter}`;

  const presentation = () => page.evaluate((wanted) => {
    const found = {};
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length > 0) {
      const node = stack.pop();
      if (node?.label === wanted) found.encounter = node;
      if (node?.label === "dungeonHero") found.hero = node;
      if (node?.label === "dungeonWorld") found.world = node;
      if (node?.label === "dungeonBattleTransitionShade") found.shade = node;
      if (node?.children) stack.push(...node.children);
    }
    const center = (node) => {
      if (node === undefined) return null;
      const bounds = node.getBounds();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    };
    return {
      hero: center(found.hero),
      encounter: found.encounter === undefined ? null : {
        center: center(found.encounter),
        parent: found.encounter.parent?.label ?? null,
        scale: found.encounter.scale.x,
      },
      camera: found.world === undefined ? null : {
        x: found.world.x,
        y: found.world.y,
        scale: found.world.scale.x,
      },
      shadeAlpha: found.shade?.alpha ?? null,
    };
  }, encounterLabel);
  const captureFrame = async (index) => {
    const screenshot = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    fs.writeFileSync(
      path.join(outputDirectory, `frame-${String(index).padStart(3, "0")}.png`),
      Buffer.from(screenshot.data, "base64"),
    );
  };

  const timeline = [];
  const sample = async (frame) => {
    const current = await state();
    timeline.push({
      frame,
      timeMs: frame * 1000 / 60,
      mode: current.mode,
      locked: current.locked,
      pendingAction: current.pendingAction ?? null,
      currentRoomId: current.currentRoomId ?? null,
      entry: current.entry ?? null,
      battle: current.mode === "battle" ? {
        presentation: current.presentation ?? null,
        banner: current.banner ?? null,
        tutorial: current.tutorial ?? null,
        activeActorId: current.activeActorId ?? null,
        activeAbilityPath: current.activeAbilityPath ?? null,
        displayedQueue: current.displayedQueue ?? [],
      } : null,
      presentation: await presentation(),
    });
    if (captureScreenshots) await captureFrame(frame);
  };
  await sample(0);
  const targetCss = geometry.toCss(targetPoint);
  await page.mouse.click(targetCss.x, targetCss.y);
  for (let frame = 1; frame <= frameCount; frame++) {
    await advance(1000 / 60);
    await sample(frame);
  }
  assert.equal((await state()).mode, "battle", `encounter did not reach battle in ${frameCount} frames`);
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(outputDirectory, "timeline.json"), `${JSON.stringify({
    archive,
    nativeSave,
    dungeonSeed,
    targetRoomId: target.id,
    targetEncounterId: target.encounter,
    clearRoomPath: pathToEncounter.slice(1, -1),
    targetScreenPoint: targetPoint,
    frameCount,
    captureScreenshots,
    frames: timeline,
    errors,
  }, null, 2)}\n`);
  console.log(`dungeon-frame-lockstep: PASS (${timeline.length} frames; ${target.encounter})`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
