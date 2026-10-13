// Read-only local transport proof. No account, archive, save or campaign state is created.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15309";
assert(["127.0.0.1", "localhost"].includes(new URL(url).hostname));
const output = path.resolve(process.env.DIB_KEEPALIVE_OUTPUT ?? "output/local-api-keepalive");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", headless: true,
  args: ["--mute-audio", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage();
const network = await page.context().newCDPSession(page);
await network.send("Network.enable");
const responses = [], errors = [];
network.on("Network.responseReceived", ({ response }) => {
  if (new URL(response.url).pathname !== "/api/game/health") return;
  responses.push({ status: response.status, connectionId: response.connectionId,
    reused: response.connectionReused, connection: Object.entries(response.headers)
      .find(([key]) => key.toLowerCase() === "connection")?.[1] });
});
page.on("pageerror", error => errors.push(String(error)));
page.on("console", message => { if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text()); });
let result;
try {
  await page.goto(url);
  await page.evaluate(async () => {
    for (let i = 0; i < 25; i++) {
      const response = await fetch("/api/game/health", { cache: "no-store" });
      if (!response.ok) throw new Error(`Health probe failed: ${response.status}`);
      await response.arrayBuffer();
    }
  });
  await page.waitForTimeout(100);
  assert.equal(responses.length, 25);
  assert.deepEqual(errors, []);
  assert(responses.every(response => response.connection === "keep-alive"));
  // The app's asset loads can leave several pooled connections. The browser may reuse any
  // of those; it need not pin all requests to one socket as the Node integration test does.
  assert(new Set(responses.map(response => response.connectionId)).size < responses.length);
  assert(responses.slice(1).every(response => response.reused));
  result = { passed: true, url, responses, errors };
} catch (error) {
  result = { passed: false, url, error: error.stack ?? String(error), responses, errors };
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify(result, null, 2));
  await page.screenshot({ path: path.join(output, "final.png") });
  await browser.close();
  console.log(JSON.stringify({ passed: result.passed, requests: responses.length,
    connections: new Set(responses.map(response => response.connectionId)).size, errors }));
}
