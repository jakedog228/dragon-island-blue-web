// Isolated Official regression: rapid town inputs while the first departure flag is pending.
// Uses the sequential skills fixture account; never accepts campaign credentials.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { createFrameCapture } from "./captureFrame.mjs";
import { clickNativeLabel } from "./nativeLabelInput.mjs";
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15306";
assert(["localhost", "127.0.0.1"].includes(new URL(webUrl).hostname), "Local isolated service only");
const mode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_TOWN_CLAIM_OUTPUT ?? `output/official-town-claim-pending-${mode}`);
fs.mkdirSync(output, { recursive: true });
const credentialPath = path.resolve("output/official-skills-pending-account.json");
const api = (route, options) => fetch(new URL(`/api/game/${route}`, webUrl), options);
if (!fs.existsSync(credentialPath)) {
  const response = await api("accounts", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", username: `Skills${Date.now().toString(36)}`, publicScoreboard: false }) });
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
  { type: "player.claimTutorialFlag", flag: "Tutorial2" }]) {
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
let release, held = false, heldRevision, result, snapshot;
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
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
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
  await wait(s => s.mode === "town" && !s.locked && !s.tutorial);
  await advance(1000);
  const tap = async label => assert(await clickNativeLabel(page, label), `Missing control ${label}`);
  await page.route("**/api/game/slots/*/commands", async route => {
    const command = route.request().postDataJSON().command;
    if (command.type !== "player.claimTutorialFlag" || command.flag !== "flashTownExit") return route.continue();
    const response = await route.fetch(); assert.equal(response.status(), 200);
    heldRevision = (await response.json()).revision; held = true;
    await responseGate; await route.fulfill({ response });
  });
  await tap("town:First_City:exit");
  for (let i = 0; i < 400 && !held; i++) await advance(50);
  assert(held, "First exit did not claim its tutorial flag");
  await tap("town:First_City:exit");
  await tap("town:First_City:menu:CharacterDisplayMenuItem");
  await advance(500);
  snapshot = await state();
  fs.writeFileSync(path.join(output, "pending.json"), JSON.stringify(snapshot, null, 2));
  await capture("pending.png");
  assert.equal(snapshot.overlay, null, "Hero opened over the pending departure flag");
  assert.equal(snapshot.inputBlockers.hasModal, true);
  assert.equal(snapshot.transitionFailure ?? null, null);
  assert.equal(commands.filter(command => command.type === "world.leaveTown").length, 0);
  release();
  await wait(s => s.mode === "world" && !s.locked && !s.walking);
  assert.equal(commands.filter(command => command.type === "player.claimTutorialFlag" && command.flag === "flashTownExit").length, 1);
  assert.equal(commands.filter(command => command.type === "world.leaveTown").length, 1);
  assert.deepEqual(errors, []);
  result = { passed: true, mode, heldRevision, tutorialClaims: 1, departures: 1, errors };
} catch (error) {
  result = { passed: false, mode, error: error.stack ?? String(error), errors }; process.exitCode = 1;
} finally {
  release();
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(output, "final-state.json"), JSON.stringify(await page.evaluate(() => JSON.parse(window.render_game_to_text())), null, 2));
  await capture("final.png");
  await browser.close(); console.log(JSON.stringify(result));
}
