// Opt-in operator-owned-archive regression for North Cave's complete native RNG stream.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const launcherUrl = "http://127.0.0.1:4317";
const output = path.resolve(import.meta.dirname, "../../../../output/fidelity-lab/north-cave-current-browser");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(launcherUrl, { waitUntil: "domcontentloaded" });
  let setup = await page.evaluate(() => fetch("/api/setup").then((response) => response.json()));
  if (setup.activeSession && setup.activeSession.state !== "stopped") {
    await page.evaluate((id) => fetch(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST" }), setup.activeSession.id);
  }
  const session = await page.evaluate(() => fetch("/api/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workflow: "live",
      archiveId: "repository-archive",
      saveId: "matched-fidelity-save",
      contentRights: true,
    }),
  }).then((response) => response.json()));
  assert(session.id, `failed to create session: ${JSON.stringify(session)}`);
  const readyDeadline = Date.now() + 150_000;
  let managed = session;
  while (Date.now() < readyDeadline) {
    managed = await page.evaluate((id) => fetch(`/api/sessions/${encodeURIComponent(id)}`).then((response) => response.json()), session.id);
    if (managed.state === "ready" || managed.state === "error") break;
    await sleep(250);
  }
  assert.equal(managed.state, "ready", managed.error ?? "managed session did not become ready");
  await page.goto(managed.dashboardUrl, { waitUntil: "domcontentloaded" });
  const frameDeadline = Date.now() + 60_000;
  let status;
  while (Date.now() < frameDeadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    if (status.native?.frameReady && status.port?.frameReady && status.port?.state?.mode === "start") break;
    await sleep(200);
  }
  assert.equal(status?.port?.state?.mode, "start", "port did not settle at title");

  const taps = [
    [0.765, 0.607, 2_800],
    [0.506, 0.334, 3_100],
    [0.133, 0.476, 2_150],
    [0.368, 0.673, 1_150],
    [0.307, 0.595, 1_200],
    [0.351, 0.438, 1_000],
    [0.484, 0.759, 1_300],
    [0.354, 0.438, 800],
    [0.368, 0.311, 800],
    [0.270, 0.283, 12_000],
  ];
  for (let index = 0; index < taps.length; index++) {
    const [x, y, settle] = taps[index];
    await page.evaluate(({ index, x, y }) => fetch("/api/gesture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: `north-cave-${index}`, events: [
        { phase: "down", x, y, tMs: 0 },
        { phase: "up", x, y, tMs: 120 },
      ] }),
    }).then((response) => response.json()), { index, x, y });
    await sleep(settle);
  }

  status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
  assert.equal(status.port?.state?.mode, "dungeon", `port ended in ${status.port?.state?.mode}`);
  assert(status.native?.scene?.nodes?.some(({ className }) => className === "DungeonNode"), "native did not enter dungeon");
  assert.equal(status.port?.state?.rooms?.length, 20, "port did not build the native 20-room floor");
  assert.equal(status.dungeonTopology?.matchedRooms, status.dungeonTopology?.nativeObservedRooms,
    JSON.stringify(status.dungeonTopology));
  assert.deepEqual(status.dungeonTopology?.alignmentErrors, [], JSON.stringify(status.dungeonTopology));
  assert.equal(status.rngSync?.native?.calls, 210);
  assert.equal(status.rngSync?.port?.calls, 210);
  assert.equal(status.rngSync?.drift, 0);
  assert.equal(status.rngSync?.stateMatches, true);
  assert.deepEqual(status.browserErrors, []);
  await page.evaluate(() => fetch("/api/capture", { method: "POST" }));
  await page.screenshot({ path: path.join(output, "dashboard.png"), fullPage: true });
  const checkpoint = await page.evaluate(() => fetch("/api/checkpoint", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      label: "North Cave after generator alignment",
      comparison: { nativeCalls: 210, portCalls: 210, topologyEndpoint: 169, generationEndpoint: 203 },
      note: "Fresh matched-save replay after the topology and population RNG fixes.",
    }),
  }).then((response) => response.json()));
  console.log(JSON.stringify({ session: session.id, dashboard: managed.dashboardUrl, checkpoint, rngSync: status.rngSync, dungeonTopology: status.dungeonTopology, errors }, null, 2));
} finally {
  await browser.close();
}
