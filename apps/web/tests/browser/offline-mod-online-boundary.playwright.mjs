import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
assert(archive, "Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");
const mod = resolve(repositoryRoot, "examples/mods/dist/fire-cub-inferno-barrage.dibmod");
assert(existsSync(mod), "Run pnpm mods:examples before this scenario.");

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(url, { waitUntil: "domcontentloaded" });
  const archiveInput = page.locator('input[name="asset-archive"]');
  await archiveInput.waitFor({ state: "attached", timeout: 120_000 });
  await archiveInput.setInputFiles(archive);

  const offline = page.getByRole("radio", { name: "Offline", exact: true });
  const online = page.getByRole("radio", { name: /Online \(Beta\)/ });
  await online.waitFor({ state: "visible", timeout: 120_000 });
  await online.check();
  assert.equal(await online.isChecked(), true, "clean content should still allow Online selection");

  await page.locator('input[name="mod-archives"]').setInputFiles(mod);
  await page.locator(".content-gate__mode-unavailable")
    .filter({ hasText: "Online is unavailable while Offline mods are selected." })
    .waitFor({ state: "visible", timeout: 120_000 });
  assert.equal(await online.isDisabled(), true, "selected Offline mods must disable Online");
  assert.equal(await online.isChecked(), false, "mod selection must leave Online mode");
  assert.equal(await offline.isChecked(), true, "mod selection must choose Offline mode");

  // The ready local-save probe proves the full-trust profile finished activating in this tab.
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ state: "visible", timeout: 120_000 });
  await page.locator(".content-gate__mod-manager").click();
  const manager = page.getByRole("dialog", { name: "Mod Manager" });
  await manager.getByRole("button", { name: "Disable all" }).click();
  await manager.getByRole("button", { name: "Apply & reload" }).click();
  await page.locator(".content-gate__mods-label")
    .filter({ hasText: "Optional Offline mods" })
    .waitFor({ state: "visible", timeout: 120_000 });
  assert.equal(
    await page.locator('[data-mode-row="official"]').getAttribute("aria-disabled"),
    "false",
    "clearing activated full-trust mods must reload into a clean Online-eligible document",
  );

  const output = resolve(repositoryRoot, "output/offline-mod-online-boundary");
  mkdirSync(output, { recursive: true });
  await page.screenshot({
    path: resolve(output, "online-eligible-after-clearing-mods.png"),
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log("Offline mod / Online boundary scenario passed");
} finally {
  await browser.close();
}
