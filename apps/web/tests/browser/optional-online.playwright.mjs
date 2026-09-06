// Opt-in: start only Vite, then run node apps/web/tests/browser/optional-online.playwright.mjs.
// DIB_WEB_URL and DIB_CONTENT_ARCHIVE may override the local defaults. No API is required.
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? path.join(root, "Dragon_Island_Blue_1.1.0.ipa");
const output = path.join(root, "output/optional-online");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  for (const ready of [false, true]) {
    const page = await browser.newPage();
    const errors = [];
    const apiRequests = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    // Model a static host with no API, then an available service, independently of local setup.
    await page.route("**/api/game/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      apiRequests.push(pathname);
      assert.equal(pathname, "/api/game/readiness", "Offline made an account/session request");
      await route.fulfill(ready
        ? { json: { ready: true, installedLogicPackIds: ["fixture-pack"] } }
        : { contentType: "text/html", body: "<html>static host</html>" });
    });
    await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173");
    await page.locator('input[name="asset-archive"]').setInputFiles(archive);
    await page.waitForFunction((expected) => {
      const input = document.querySelector('input[name="save-mode"][value="official"]');
      return input && input.disabled === !expected &&
        !document.body.textContent.includes("Checking Online availability");
    }, ready);
    const offline = page.locator('input[name="save-mode"][value="local"]');
    await offline.check();
    await page.locator(".content-gate__rights input").check();
    assert.equal(await page.locator(".content-gate__finish > button").isEnabled(), true);
    assert.equal(await page.locator('input[name="save-mode"][value="official"]').isDisabled(), !ready);
    await page.screenshot({ path: path.join(output, ready ? "available.png" : "offline-only.png") });
    assert.deepEqual(apiRequests, ["/api/game/readiness"]);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
