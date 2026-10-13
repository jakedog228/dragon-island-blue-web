// Isolated navigation transport proof: fail before commit, then lose a committed response.
// The physical Retry control must resend the exact envelope and settle only once.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { createFrameCapture } from "./captureFrame.mjs";
import { clickNativeLabel } from "./nativeLabelInput.mjs";
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15304";
assert(["localhost", "127.0.0.1"].includes(new URL(webUrl).hostname), "Local isolated service only");
const mode = process.env.DIB_DISPLAY_MODE ?? "iphone";
const output = path.resolve(process.env.DIB_NAVIGATION_RETRY_OUTPUT ?? `output/official-navigation-retry-${mode}`);
fs.mkdirSync(output, { recursive: true });
const credentialPath = path.resolve("output/official-navigation-retry-account.json");
const api = (route, options) => fetch(new URL(`/api/game/${route}`, webUrl), options);
if (!fs.existsSync(credentialPath)) {
  const response = await api("accounts", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", username: `Retry${Date.now().toString(36)}`, publicScoreboard: false }) });
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
  { type: "player.claimTutorialFlag", flag: "FirstCharacterDisplay" },
  { type: "player.claimTutorialFlag", flag: "flashTownExit" },
  { type: "player.claimTutorialFlag", flag: "Tutorial2" }]) {
  const response = await api("slots/slot-1/commands", { method: "POST", headers,
    body: JSON.stringify({ protocolVersion: "game-protocol-v1", commandId: `navigation-fixture-${++serial}`,
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
const errors = [], commands = [], transportErrors = [], failedRequests = [];
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() !== "error") return;
  if (message.text() === "Failed to load resource: net::ERR_FAILED" &&
    /\/api\/game\/slots\/slot-1\/commands$/.test(message.location().url)) transportErrors.push(message.text());
  else errors.push(message.text()); });
page.on("request", request => {
  if (new URL(request.url()).pathname.endsWith("/commands")) commands.push(request.postDataJSON());
});
let result, snapshot;
page.on("requestfailed", request => failedRequests.push({
  path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
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
  const cases = [];
  for (const loss of ["before-commit", "after-commit"]) {
    await tap("town:First_City:exit");
    await wait(s => s.mode === "world" && !s.locked && !s.tutorial);
    await advance(1000);
    const before = await api("slots/slot-1/bootstrap", { headers }).then(r => r.json());
    const requests = [], replies = [];
    await page.route("**/api/game/slots/*/commands", async route => {
      const envelope = route.request().postDataJSON();
      if (envelope.command.type !== "world.navigate") return route.continue();
      requests.push(envelope);
      if (requests.length === 1 && loss === "before-commit") return route.abort("failed");
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      replies.push(await response.json());
      if (requests.length === 1) return route.abort("failed");
      await route.fulfill({ response });
    });
    const city = snapshot.pois.find(poi => poi.name === "First_City");
    assert(snapshot.selectablePois.includes(city.name));
    await click(city.position);
    await page.getByRole("alertdialog").waitFor();
    await capture(`${loss}-interrupted.png`);
    assert.equal(requests.length, 1, "No duplicate intent while recovery prompt owns input");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await wait(s => s.mode === "town" && !s.locked && !s.tutorial);
    await advance(750);
    assert.equal(requests.length, 2, "One physical navigation must retry once");
    assert.deepEqual(requests[1], requests[0], "Retry changed the command envelope");
    assert.equal(replies.at(-1).revision, before.revision + 1, "Navigation settled more than once");
    if (loss === "after-commit") {
      assert.equal(replies[0].idempotentReplay, false);
      assert.equal(replies[1].idempotentReplay, true);
      assert.deepEqual({ ...replies[1], idempotentReplay: false }, replies[0], "Lost reply changed committed result");
    }
    const after = await api("slots/slot-1/bootstrap", { headers }).then(r => r.json());
    assert.equal(after.revision, before.revision + 1);
    await capture(`${loss}.png`);
    fs.writeFileSync(path.join(output, `${loss}.json`), JSON.stringify(snapshot, null, 2));
    cases.push({ loss, requests: requests.length, revisionBefore: before.revision,
      revisionAfter: after.revision, identicalEnvelope: true, identicalCommittedReply: loss === "after-commit" });
    await page.unroute("**/api/game/slots/*/commands");
  }
  assert.equal(failedRequests.length, 2);
  assert(failedRequests.every(request => request.path === "/api/game/slots/slot-1/commands" && request.error === "net::ERR_FAILED"));
  assert.equal(transportErrors.length, 2);
  assert.deepEqual(errors, []);
  result = { passed: true, mode, cases, expectedInjectedTransportErrors: transportErrors, errors };
} catch (error) {
  result = { passed: false, mode, error: error.stack ?? String(error), errors, transportErrors, failedRequests };
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(output, "final-state.json"), JSON.stringify(await page.evaluate(() => JSON.parse(window.render_game_to_text())), null, 2));
  await capture("final.png");
  await browser.close(); console.log(JSON.stringify(result));
}
