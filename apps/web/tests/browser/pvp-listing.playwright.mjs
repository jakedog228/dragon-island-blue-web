// Opt-in. Tests the real manager with its online catalog, plus offline availability.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { zipSync, strToU8 } from "fflate";
import fs from "node:fs";
import path from "node:path";
const out = path.resolve("output/pvp-listing"); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const url = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15183";
const errors = [];
const screenshot = async (page, name) => {
  await page.waitForTimeout(250); // Let the manager's short CSS entrance animations finish.
  await page.screenshot({ path: path.join(out, name) });
};
try {
  for (const [name, width, height] of [["desktop", 1365, 900], ["phone", 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark" });
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await page.goto(url); await page.locator(".content-gate__mod-manager").click();
    const manager = page.getByRole("dialog", { name: "Mod Manager", exact: true });
    const orderCount = manager.locator('[data-tab="order"] .ml-tab__count');
    await manager.getByRole("tab", { name: /Browse/ }).click();
    const tile = manager.locator('.ml-tile[data-mod-id="dib.official.pvp"]');
    await tile.waitFor(); await tile.locator("img").evaluate(image => image.decode());
    await tile.scrollIntoViewIfNeeded();
    await screenshot(page, `${name}-browse.png`);
    await tile.getByRole("button", { name: "Multiplayer PvP", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "Multiplayer PvP", exact: true });
    await detail.locator(".ml-gallery img").evaluate(image => image.decode());
    assert.match(await detail.innerText(), /Arena/);
    assert.equal(await detail.getByText("Some details are missing", { exact: true }).count(), 0);
    assert.equal(await detail.getByRole("button", { name: "Remove from device" }).count(), 0);
    await screenshot(page, `${name}-detail.png`);
    await detail.getByRole("button", { name: "Enable", exact: true }).click();
    await detail.getByRole("button", { name: "Enabled", exact: true }).waitFor();
    await detail.getByRole("button", { name: "Close details" }).click();
    assert.equal(await orderCount.innerText(), "1");
    assert.match(await manager.locator(".ml-apply").textContent(), /1 mod will be enabled/);
    await manager.getByRole("button", { name: "Discard", exact: true }).click();
    await manager.locator(".ml-apply").waitFor({ state: "hidden" });
    assert.equal(await orderCount.innerText(), "0");
    await manager.getByRole("tab", { name: /Browse/ }).click();
    await tile.getByRole("button", { name: "Multiplayer PvP", exact: true }).click();
    await detail.getByRole("button", { name: "DIB Web", exact: true }).click();
    await tile.waitFor();
    await manager.getByRole("button", { name: /by DIB Web/ }).click();
    const moreTags = manager.locator('.ml-chips .ml-chip--more');
    if (await moreTags.count()) await moreTags.click();
    await manager.getByRole("button", { name: /^Multiplayer\s*\d/ }).click();
    await tile.waitFor();
    await manager.getByRole("button", { name: "All tags", exact: true }).click();
    await manager.getByRole("searchbox").fill("multiplayer");
    await tile.getByRole("button", { name: "Enable", exact: true }).click();
    await manager.getByRole("button", { name: /^Apply/ }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("dib.mods.builtin.pvp.v1")), "enabled");
    assert.match(await page.locator(".content-gate__mod-manager").innerText(), /1 mod enabled/);
    assert.equal(await page.locator(".content-gate__mods-status").innerText(), "Multiplayer PvP");
    await page.locator(".content-gate__mod-manager").click();
    await manager.getByRole("tab", { name: /Load order/ }).click();
    assert.equal(await orderCount.innerText(), "1");
    await manager.getByText("1 mod enabled", { exact: true }).waitFor();
    // A built-in and an imported mod contribute equally, without giving PvP a sortable position.
    const mod = zipSync({
      "manifest.json": strToU8(JSON.stringify({ schemaVersion: 4, id: "test.pvp-count", version: "1.0.0", displayName: "Count fixture", apiVersion: 4, mode: "offline", dependencies: {}, entry: "main.js" })),
      "main.js": strToU8("export function activate() {}"),
    });
    await manager.locator("input[type=file]").setInputFiles({ name: "count.dibmod", mimeType: "application/octet-stream", buffer: Buffer.from(mod) });
    await manager.getByText("Imported and enabled Count fixture. Apply to play with it.", { exact: true }).waitFor();
    await manager.getByRole("tab", { name: /Load order/ }).click();
    assert.equal(await orderCount.innerText(), "2");
    assert.match(await manager.locator(".ml-toolbar__summary").innerText(), /2 enabled mods/);
    assert.match(await manager.locator(".ml-apply").textContent(), /2 mods will be enabled/);
    assert.equal(await manager.locator(".ml-order__row").count(), 1);
    await manager.getByRole("button", { name: "Discard", exact: true }).click();
    await manager.locator(".ml-apply").waitFor({ state: "hidden" });
    assert.equal(await orderCount.innerText(), "1");
    await manager.getByRole("tab", { name: /Installed/ }).click();
    const installed = manager.locator('[data-mod-id="dib.official.pvp"]');
    assert.equal(await installed.getByRole("switch").getAttribute("aria-checked"), "true");
    await manager.getByRole("radio", { name: "List view" }).click();
    await screenshot(page, `${name}-installed-list.png`);
    await installed.getByRole("button", { name: "Multiplayer PvP", exact: true }).click();
    await detail.locator(".ml-gallery__main").click();
    const lightbox = page.getByRole("dialog", { name: "Multiplayer PvP screenshots" });
    await lightbox.waitFor(); await screenshot(page, `${name}-gallery.png`);
    await lightbox.getByRole("button", { name: "Close", exact: true }).click();
    await detail.getByRole("button", { name: "Close details" }).click();
    await installed.getByRole("switch").click();
    await manager.getByRole("button", { name: /^Apply/ }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("dib.mods.builtin.pvp.v1")), "disabled");
    assert.match(await page.locator(".content-gate__mod-manager").innerText(), /Optional Offline mods/);
    assert.equal(await page.locator(".content-gate__mods-status").isVisible(), false);
    await context.close();
  }
  const context = await browser.newContext(); const page = await context.newPage();
  await page.route("**/api/community/info", route => route.fulfill({ json: { enabled: false, authorOrigin: "", registrationEnabled: false } }));
  await page.goto(url); await page.locator(".content-gate__mod-manager").click();
  await page.getByRole("tab", { name: /Browse/ }).click();
  await page.getByRole("searchbox").fill("multiplayer");
  await page.locator('[data-mod-id="dib.official.pvp"]').waitFor();
  await page.getByRole("searchbox").fill("does-not-exist");
  await page.getByText("No mods match", { exact: true }).waitFor();
  await context.close(); assert.deepEqual(errors, []);
  console.log("PvP listing passed: desktop/phone, browse, detail/gallery, apply/discard, installed list, offline search.");
} finally { await browser.close(); }
