// Opt-in production-only proof. Build and serve with:
// pnpm content:boundary
// pnpm --filter @dib/web exec vite preview --host 127.0.0.1 --port 4173 --strictPort
// pnpm scenario:offline-pwa
// Set DIB_CONTENT_ARCHIVE to test another operator-owned IPA/ZIP. This does not emulate iOS
// installation/storage policy: repeat the documented Home Screen airplane-mode check on device.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../../../..");
const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:4173/";
assert(process.env.DIB_CONTENT_ARCHIVE, "Set DIB_CONTENT_ARCHIVE to your compatible local IPA/ZIP.");
const archive = path.resolve(process.env.DIB_CONTENT_ARCHIVE);
assert(fs.existsSync(archive), `Missing compatible local archive: ${archive}`);
const output = process.env.DIB_OFFLINE_PWA_OUTPUT ?? path.join(root, "output/offline-pwa");
fs.mkdirSync(output, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dib-offline-pwa-"));
const options = {
  headless: process.env.DIB_HEADED !== "1",
  viewport: { width: 844, height: 390 },
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
};
let context;
const errors = [];
const authorityRequests = [];
const authorityFailures = [];
const authorityResponses = [];
function observe(page, offline) {
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/api/game/readiness")) {
      errors.push(message.text());
    }
  });
  if (offline) page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/game/")) {
      authorityRequests.push({ url: request.url(), method: request.method() });
    }
  });
  if (offline) page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/game/")) {
      authorityFailures.push({ url: request.url(), error: request.failure()?.errorText });
    }
  });
  if (offline) page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/game/")) authorityResponses.push(response.url());
  });
}
async function play(page) {
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success').waitFor({ timeout: 120_000 });
  await page.getByRole("checkbox", { name: "I have the right to use the content in this archive on this device." }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  await page.waitForFunction(() => JSON.parse(window.render_game_to_text?.() ?? "{}").mode === "start", undefined, { timeout: 120_000 });
}
try {
  context = await chromium.launchPersistentContext(profile, options);
  let page = await context.newPage();
  observe(page, false);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.locator('[data-offline-shell="ready"]').waitFor({ timeout: 120_000 });
  console.log("Engine cache ready; importing local content");
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await play(page);
  console.log("Online warmup reached title; restarting browser offline");
  await context.close();

  // Restart the entire browser, retaining only on-disk storage, and disable networking before
  // navigating. A successful title screen now requires cached HTML, chunks, fonts and archive.
  context = await chromium.launchPersistentContext(profile, options);
  await context.setOffline(true);
  page = await context.newPage();
  observe(page, true);
  const response = await page.goto(url + "?offline-proof=1", { waitUntil: "domcontentloaded" });
  assert(response?.fromServiceWorker(), "Cold offline navigation must be served by the worker");
  await page.locator('[data-offline-shell="ready"]').waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: "Play Offline", exact: true }).waitFor({ timeout: 120_000 });
  assert(await page.getByRole("radio", { name: "Online (Beta)", exact: true }).isDisabled());
  await page.locator('[data-offline-shell="ready"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "offline-launcher.png"), fullPage: true });
  await play(page);
  console.log("Cold offline startup reached title with remembered archive");
  const state = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  fs.writeFileSync(path.join(output, "offline-state.json"), JSON.stringify(state, null, 2));
  await page.screenshot({ path: path.join(output, "offline-title.png"), fullPage: true });

  // Losing disposable archive storage must still allow selecting a downloaded file offline.
  await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("dib-content-archive-v1", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const tx = database.transaction("archives", "readwrite");
      tx.objectStore("archives").clear();
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => { database.close(); reject(tx.error); };
    };
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await play(page);
  console.log("Offline file recovery reached title");
  // Chromium's emulator can leave navigator.onLine true for an external HTTPS origin while
  // rejecting every connection. The application deliberately treats that flag as a hint: an
  // unconfirmed connection may attempt only its bounded, read-only readiness probe.
  assert.deepEqual(authorityResponses, [], "Offline startup must not receive cached or network API responses");
  assert(authorityRequests.every(request => request.method === "GET" &&
    new URL(request.url).pathname === "/api/game/readiness"), "Offline play must never submit authority commands");
  assert.equal(authorityFailures.length, authorityRequests.length, "Every attempted readiness probe must fail offline");
  assert(authorityFailures.every(failure => failure.error === "net::ERR_INTERNET_DISCONNECTED"));
  const navigatorOnline = await page.evaluate(() => navigator.onLine);
  if (navigatorOnline === false) assert.deepEqual(authorityRequests, [], "Known offline startup must skip readiness probes");
  fs.writeFileSync(path.join(output, "network-proof.json"), JSON.stringify({
    navigatorOnline, authorityRequests, authorityFailures, authorityResponses,
  }, null, 2));
  assert.deepEqual(errors, [], "No unexpected browser errors");
  console.log(`Offline PWA proof passed; screenshots and state: ${output}`);
} catch (error) {
  const page = context?.pages().at(-1);
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
    fs.writeFileSync(path.join(output, "failure.json"), JSON.stringify({
      errors, authorityRequests, authorityFailures, authorityResponses,
      state: await page.evaluate(() => window.render_game_to_text?.()).catch(String),
    }, null, 2));
  }
  throw error;
} finally {
  await context?.close();
  // Keep the isolated temporary profile for diagnosing failed browser runs; never touch a user's
  // browser profile or saves. Its path is printed for explicit operator cleanup.
  console.log(`Isolated browser profile: ${profile}`);
}
