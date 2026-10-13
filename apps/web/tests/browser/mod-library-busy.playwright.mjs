// Opt-in real pointer regression for the initially busy built-in PvP switch.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const output = path.resolve(process.env.DIB_BUSY_OUTPUT ?? "output/mod-library-busy");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "chromium", args: ["--mute-audio"], headless: true });
let release;
const held = new Promise(resolve => { release = resolve; });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  let intercepted = false;
  await page.route("**/api/community/info", async route => {
    const response = await route.fetch(); intercepted = true;
    await held; await route.fulfill({ response });
  });
  await page.goto(process.env.DIB_WEB_URL ?? "http://127.0.0.1:15304");
  await page.locator(".content-gate__mod-manager").click();
  const manager = page.getByRole("dialog", { name: "Mod Manager" });
  await manager.getByRole("tab", { name: /Installed/ }).click();
  const toggle = manager.getByRole("switch", { name: "Multiplayer PvP", exact: true });
  for (let i = 0; !intercepted && i < 200; i++) await page.waitForTimeout(25);
  assert(intercepted, "Catalog load was not held");
  assert.equal(await manager.getAttribute("aria-busy"), "true");
  await page.screenshot({ path: path.join(output, "busy.png") });
  assert.equal(await toggle.isDisabled(), true, "Busy switch advertised a click that would be discarded");
  const box = await toggle.boundingBox(); assert(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  assert.equal(await toggle.getAttribute("aria-checked"), "false");
  release();
  await page.waitForFunction(() => !document.querySelector('dialog[aria-label="Mod Manager"]')?.hasAttribute("aria-busy"));
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  await manager.getByRole("button", { name: "Apply", exact: true }).click();
  await manager.waitFor({ state: "hidden" });
  await page.locator(".content-gate__mod-manager").click();
  await manager.getByRole("tab", { name: /Installed/ }).click();
  assert.equal(await toggle.getAttribute("aria-checked"), "true");
  await page.screenshot({ path: path.join(output, "enabled.png") });
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ passed: true, errors }, null, 2));
  console.log("mod-library-busy: PASS");
} finally { release(); await browser.close(); }
