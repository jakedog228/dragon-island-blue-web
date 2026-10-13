// Isolated Official regression: hold an Egg release response beyond the entire provisional coast.
// A provisional stop must never become a prize or send a settlement command. Uses a scenario-owned local account; never accepts campaign credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { createFrameCapture } from "./captureFrame.mjs";
import { clickNativeLabel, waitNativeLabel } from "./nativeLabelInput.mjs";
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15306";
assert(["localhost", "127.0.0.1"].includes(new URL(webUrl).hostname), "Local isolated service only");
const mode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_EGG_RELEASE_OUTPUT ?? `output/official-egg-release-pending-${mode}`);
fs.mkdirSync(output, { recursive: true });
const credentialPath = path.resolve("output/official-egg-release-pending-account.json");
const api = (route, options) => fetch(new URL(`/api/game/${route}`, webUrl), options);
if (!fs.existsSync(credentialPath)) {
  const response = await api("accounts", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", username: `Egg${Date.now().toString(36)}`, publicScoreboard: false }) });
  assert.equal(response.status, 201, "Scenario account creation failed");
  fs.writeFileSync(credentialPath, JSON.stringify(await response.json()), { flag: "wx", mode: 0o600 });
}
const credential = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
const readiness = await api("readiness").then(response => response.json());
const sessionResponse = await api("session", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ protocolVersion: "game-protocol-v1", loginToken: credential.loginToken,
    logicPackId: readiness.installedLogicPackIds[0], supportedEventVersions: ["presentation-events-v1"] }) });
assert.equal(sessionResponse.status, 200, "Scenario account login failed");
const session = await sessionResponse.json();
const headers = { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" };
const occupied = session.slots.find(slot => slot.slotId === "slot-1");
if (occupied) {
  const response = await api("slots/slot-1", { method: "DELETE", headers,
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", expectedRevision: occupied.revision }) });
  assert.equal(response.status, 200, "Could not reset the scenario-owned slot");
}
let committed, serial = 0;
for (const command of [{ type: "slot.create", starterElement: "Water" },
  { type: "player.claimDialog", dialogId: "LeslieIntro1" },
  { type: "store.purchase", stockId: "egg", quantity: 1 }]) {
  const response = await api("slots/slot-1/commands", { method: "POST", headers,
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", commandId: `skills-fixture-${++serial}`,
      expectedRevision: committed?.revision ?? 0,
      ...(committed?.projection.decision?.decisionId ? { expectedDecisionId: committed.projection.decision.decisionId } : {}), command }) });
  assert.equal(response.status, 200, `Fixture command failed: ${command.type}`);
  committed = await response.json();
}
const browser = await chromium.launch({ channel: "chromium", headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
const captureFrame = await createFrameCapture(page, output);
const capture = async name => { await page.evaluate(() => window.__PIXI_APP__.render()); await captureFrame(name); };
const errors = [], commands = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
page.on("request", request => {
  if (new URL(request.url()).pathname.endsWith("/commands")) commands.push(request.postDataJSON().command);
});
let release, held = false, heldRevision, landedPrize, result, snapshot;
const responseGate = new Promise(resolve => { release = resolve; });
try {
  await page.addInitScript(mode => {
    window.advanceTime = () => Promise.resolve(); window.__DIB_TEST_WORLD_DEMO__ = true;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({ displayMode: mode, sound: 0, music: 0 }));
  }, mode);
  await page.goto(webUrl);
  await page.locator('input[name="asset-archive"]').setInputFiles(process.env.DIB_CONTENT_ARCHIVE ?? "Dragon_Island_Blue_1.1.0.ipa");
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await page.getByLabel("Login token").fill(credential.loginToken);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.locator(".content-gate__login-status--success").waitFor({ timeout: 120000 });
  await page.locator(".content-gate__rights input").check();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();
  await page.waitForFunction(() => typeof window.render_game_to_text === "function");
  const state = () => page.evaluate(() => { const s = JSON.parse(window.render_game_to_text()); return { ...s, overlay: s.eggHatch ?? s.overlay }; });
  const advance = async ms => { await page.evaluate(ms => window.advanceTime(ms), ms); await page.waitForTimeout(5); };
  const wait = async predicate => {
    for (let i = 0; i < 1600; i++) {
      snapshot = await state(); assert.deepEqual(errors, []);
      if (predicate(snapshot)) return snapshot;
      await advance(50);
    }
    throw new Error(`State did not settle: ${snapshot.mode}`);
  };
  await wait(s => s.startup?.phase === "title");
  await advance(500); await page.keyboard.press("Enter");
  await wait(s => s.startup?.phase === "save-select");
  await advance(500);
  const box = await page.locator("canvas").first().boundingBox(), geometry = await stageGeometry(page, box);
  const click = async point => { const p = geometry.toCss(point); await page.mouse.click(p.x, p.y); };
  const slot = snapshot.startup.menu.buttons.find(button => button.id === "slot-1");
  await click({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
  await wait(s => s.overlay?.kind === "silver" && s.overlay.phase === "rolling");
  await advance(500);
  const restoredScale = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node.label === "eggHatch:silver") {
        const origin = node.toGlobal({ x: 0, y: 0 });
        const unit = node.toGlobal({ x: 1, y: 0 });
        return Math.hypot(unit.x - origin.x, unit.y - origin.y);
      }
      if (node.children) stack.push(...node.children);
    }
    throw new Error("Restored Egg root is missing");
  });
  assert(Math.abs(restoredScale - 2 * geometry.scale) < 1e-6, "Restored Egg lost its point-to-stage scale");
  const tap = async label => assert(await clickNativeLabel(page, label), `Missing control ${label}`);
  await page.route("**/api/game/slots/*/commands", async route => {
    if (route.request().postDataJSON().command.type !== "egg.release") return route.continue();
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    const committedRelease = await response.json();
    heldRevision = committedRelease.revision;
    landedPrize = committedRelease.projection.pendingEgg.landedPrize;
    held = true; await responseGate; await route.fulfill({ response });
  });
  await advance(500);
  const point = geometry.toCss({ x: geometry.screenPt.w / 2, y: geometry.screenPt.h / 2 });
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await advance(1600);
  fs.writeFileSync(path.join(output, "held.json"), JSON.stringify(await state(), null, 2));
  await page.mouse.up();
  for (let i = 0; i < 300 && !held; i++) await page.waitForTimeout(10);
  assert(held, "Physical release did not submit Egg command");
  await advance(15000);
  snapshot = await state();
  await capture("pending.png");
  fs.writeFileSync(path.join(output, "pending.json"), JSON.stringify(snapshot, null, 2));
  assert.deepEqual(errors, []);
  assert.equal(snapshot.overlay?.phase, "rolling", "Provisional stop exposed an uncommitted prize");
  assert.equal(snapshot.overlay.selected, null);
  assert.equal(snapshot.overlay.reel.stopped, true, "Test must outlast the provisional coast");
  assert.equal(commands.filter(command => command.type === "egg.resolvePrize").length, 0);
  release();
  await wait(s => ["reward", "question"].includes(s.overlay?.phase));
  assert.deepEqual(snapshot.overlay.selected, landedPrize, "Displayed prize must equal committed landing");
  await waitNativeLabel(page, landedPrize.kind === "monster" ? "popupButton:Keep" : "popupButton:Ok");
  await advance(500);
  await capture("committed.png");
  if (landedPrize.kind === "monster") await tap("popupButton:Keep");
  await wait(s => s.overlay?.phase === "question");
  await advance(500);
  await tap("popupButton:Ok");
  await wait(s => !s.overlay);
  await advance(250);
  assert.equal(commands.filter(command => command.type === "egg.release").length, 1);
  assert.equal(commands.filter(command => command.type === "egg.resolvePrize").length, 1);
  assert.equal(commands.filter(command => command.type === "egg.finish").length, 1);
  assert.deepEqual(errors, []);
  result = { passed: true, mode, heldRevision, landedPrize, releaseCommands: 1, prizeCommands: 1,
    finishCommands: 1, provisionalPrizeBlocked: true, errors };
} catch (error) {
  result = { passed: false, mode, error: error.stack ?? String(error), errors }; process.exitCode = 1;
} finally {
  release();
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(output, "final-state.json"), JSON.stringify(await page.evaluate(() => JSON.parse(window.render_game_to_text())), null, 2));
  await capture("final.png");
  await browser.close(); console.log(JSON.stringify(result));
}
