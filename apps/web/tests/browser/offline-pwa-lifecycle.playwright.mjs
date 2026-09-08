// Exercises the actual built worker against two server revisions without changing dist on disk.
// The API probe is a test-owned endpoint, never a production account or save.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../../../..");
const dist = path.join(root, "apps/web/dist");
const output = path.join(root, "output/offline-pwa-lifecycle");
await fs.mkdir(output, { recursive: true });
const worker = await fs.readFile(path.join(dist, "sw.js"), "utf8");
const config = JSON.parse(worker.match(/const \{ revision, entries \} = (\{[^\n]+\});/)[1]);
const files = new Map(await Promise.all(config.entries.map(async ({ path: name }) =>
  ["/" + name, await fs.readFile(path.join(dist, name))])));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png", ".ttf": "font/ttf", ".md": "text/markdown" };
let version = "A";
let calls = 0;
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  response.setHeader("Cache-Control", "no-cache");
  if (url.pathname.startsWith("/api/game/")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(url.pathname === "/api/game/readiness"
      ? { ready: true, installedLogicPackIds: ["test-owned-pack"] }
      : { call: ++calls, method: request.method }));
    return;
  }
  if (url.pathname === "/sw.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(worker.replace(config.revision, config.revision + version));
    return;
  }
  const name = url.pathname === "/" ? "/index.html" : url.pathname;
  const bytes = files.get(name);
  if (!bytes) { response.writeHead(404); response.end(); return; }
  response.setHeader("Content-Type", types[path.extname(name)] ?? "application/octet-stream");
  response.end(bytes);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const errors = [];
try {
  const context = await browser.newContext();
  let page = await context.newPage();
  const observe = (tab) => {
    tab.on("pageerror", error => errors.push(String(error)));
    tab.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  };
  observe(page);
  await page.goto(origin);
  await page.locator('[data-offline-shell="ready"]').waitFor();
  await page.reload();
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller));
  await page.evaluate(() => localStorage.setItem("dib-offline-lifecycle-sentinel", "preserve"));
  const a = await page.evaluate(() => caches.keys());
  assert.equal(a.length, 1);
  const probe = () => page.evaluate(async () => {
    const get = await fetch("/api/game/probe").then(r => r.json());
    const post = await fetch("/api/game/probe", { method: "POST", body: "test" }).then(r => r.json());
    return { get, post };
  });
  const first = await probe();
  const second = await probe();
  assert(second.get.call > first.post.call);
  assert.equal(second.post.method, "POST");

  const guide = await context.newPage();
  observe(guide);
  await context.setOffline(true);
  assert((await guide.goto(origin + "/modding.html"))?.fromServiceWorker());
  await context.setOffline(false);
  version = "B";
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
  await page.locator('[data-offline-shell="update"]').waitFor({ timeout: 30_000 });
  await page.locator('[data-offline-shell="update"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "waiting-update.png"), fullPage: true });
  const before = await page.evaluate(() => caches.keys());
  assert(before.includes(a[0]) && before.length === 2);
  assert(await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r.waiting)));
  await page.close();
  // An open guide is also a controlled client and must hold the old version alive.
  assert(await guide.evaluate(() => navigator.serviceWorker.getRegistration().then(r => !!r.waiting)));
  await guide.close();
  page = await context.newPage();
  observe(page);
  await page.goto(origin);
  await page.locator('[data-offline-shell="ready"]').waitFor();
  await page.waitForFunction(async () => (await caches.keys()).length === 1);
  const after = await page.evaluate(() => caches.keys());
  assert(after[0].endsWith("B") && !after.includes(a[0]));
  assert.equal(await page.evaluate(() => localStorage.getItem("dib-offline-lifecycle-sentinel")), "preserve");
  const requests = await page.evaluate(async () => (await (await caches.open((await caches.keys())[0])).keys()).map(r => r.url));
  assert(requests.every(url => !url.includes("/api/")));
  await context.setOffline(true);
  assert((await page.reload())?.fromServiceWorker());
  await page.locator('[data-offline-shell="ready"]').waitFor();
  assert(await page.evaluate(async () => {
    try { await fetch("/api/game/probe"); return false; } catch { return true; }
  }));
  // The intentional offline API fetch above is expected to produce one browser network error.
  assert(errors.every(message => message.includes("ERR_INTERNET_DISCONNECTED")), errors.join("\n"));
  await fs.writeFile(path.join(output, "result.json"), JSON.stringify({ before, after, first, second, errors }, null, 2));
  console.log("offline-pwa-lifecycle: PASS (API bypass, offline guide, waiting update, activation, cleanup, preserved local data, offline new version)");
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
