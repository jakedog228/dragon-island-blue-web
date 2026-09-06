// Opt-in documentation UI check. No content archive or authority server required.
// Start Vite separately; set DIB_WEB_URL to its strict port, then run this file with node.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const output = path.resolve(import.meta.dirname, "../../../../output/modding-guide");
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  // Model a static host's SPA fallback. HTML must not be mistaken for a published archive.
  await page.route("**/downloads/**", (route) => route.fulfill({
    status: 200, contentType: "text/html", body: "<html>Not a download</html>",
  }));
  await page.goto(`${webUrl}/modding.html`, { waitUntil: "networkidle" });
  await page.addStyleTag({ content: "html { scroll-behavior: auto !important; }" });
  const search = page.locator("#doc-search");
  await search.waitFor({ state: "visible" });
  assert.equal(await page.locator('[data-available="false"]').count(), 2);
  assert.match(await (await page.request.get(`${webUrl}/code-mod-api.md`)).text(), /Full-Trust Offline Mod Runtime v4/);

  for (const [query, anchor] of [
    ["Offline code mods", "code-mods"],
    ["dibMod.intercept", "mod-api"],
    ["Archive expands beyond the 512 MiB limit.", "gate-container"],
  ]) {
    await search.fill(query);
    await page.waitForFunction(() => !document.getElementById("doc-search-results").hidden);
    await search.press("ArrowDown");
    const selected = await search.getAttribute("aria-activedescendant");
    assert(selected);
    assert.equal(await page.locator(`#${selected}`).getAttribute("href"), `#${anchor}`);
    await search.press("Enter");
    await page.waitForURL(`**/modding.html#${anchor}`);
    assert.equal(await search.getAttribute("aria-activedescendant"), null);
  }
  await search.fill("dibMod");
  await search.press("ArrowUp");
  assert.equal(await search.getAttribute("aria-activedescendant"),
    `doc-search-option-${await page.locator("#doc-search-results a").count() - 1}`);
  await search.press("Escape");

  await page.locator('.rail a[href="#mod-quick-start"]').click();
  await page.waitForURL("**/modding.html#mod-quick-start");
  await page.waitForFunction(() => document.querySelector('.rail a[aria-current="true"]')?.hash === "#mod-quick-start");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(webUrl).origin });
  const manifestBlock = page.locator('pre:has([data-example="mod-manifest"])');
  await manifestBlock.hover();
  await manifestBlock.getByRole("button", { name: "Copy code block" }).click();
  await page.waitForFunction(() => document.querySelector('pre:has([data-example="mod-manifest"]) .copy')?.textContent === "Copied");
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
    await manifestBlock.locator("code").textContent());
  await page.screenshot({ path: path.join(output, "desktop.png") });
  const theme = page.locator("[data-gate-theme-toggle]");
  await theme.click();
  const mode = await page.locator("html").getAttribute("data-gate-mode");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("html").getAttribute("data-gate-mode"), mode);

  await page.setViewportSize({ width: 390, height: 844 });
  const toggle = page.locator("[data-nav-toggle]");
  await toggle.click();
  await page.locator('.rail a[href="#mod-profiles"]').click();
  await page.waitForURL("**/modding.html#mod-profiles");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  await page.keyboard.press("Escape");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await toggle.evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.evaluate(() =>
    document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "mobile.png") });
  assert.deepEqual(errors, []);

  const staticPage = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  await staticPage.goto(`${webUrl}/modding.html`);
  assert.equal(await staticPage.locator('.rail a[href="#mod-quick-start"]').isVisible(), true);
  await staticPage.close();
  console.log(`Modding guide checks passed; inspect screenshots in ${output}`);
} finally {
  await browser.close();
}
