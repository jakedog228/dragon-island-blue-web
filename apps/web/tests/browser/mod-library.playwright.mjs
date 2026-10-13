// Opt-in only. Start the API and the two Vite origins described in docs/mod-library.md first.
import { chromium } from "playwright";
import { zipSync, strToU8 } from "fflate";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const gameUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const authorUrl = process.env.DIB_AUTHOR_URL ?? "http://localhost:5174";
assert.notEqual(new URL(gameUrl).origin, new URL(authorUrl).origin);
const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
const context = await browser.newContext();
const errors = [];
context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
const author = await context.newPage();
const name = `Mod${Date.now().toString(36)}`;
const modId = `test.${name.toLowerCase()}.example`;
try {
  await author.goto(`${authorUrl}/community.html`);
  await author.getByRole("radio", { name: "Create account" }).click();
  await author.getByLabel("Username", { exact: true }).fill(name);
  await author.getByRole("button", { name: "Create account", exact: true }).click();
  await author.getByRole("button", { name: "I saved my key" }).click();
  await author.getByRole("button", { name: "New mod", exact: true }).first().click();
  await author.getByLabel("Mod ID").fill(modId);
  await author.getByLabel("Title", { exact: true }).fill("Browser test mod");
  await author.getByLabel("Description", { exact: true }).fill("A scenario-owned mod. It must not execute until Offline launch.");
  await author.getByRole("button", { name: "Create listing" }).click();
  const bytes = zipSync({
    "manifest.json": strToU8(JSON.stringify({ schemaVersion: 4, id: modId, version: "1.0.0", displayName: "Browser test mod", apiVersion: 4, mode: "offline", saveCompatibility: "neutral", dependencies: {}, entry: "main.js" })),
    "main.js": strToU8("globalThis.__CATALOG_TEST_EXECUTED__ = true;"),
  });
  await author.locator(".mlp-drop input[type=file]").setInputFiles({ name: "test.dibmod", mimeType: "application/octet-stream", buffer: Buffer.from(bytes) });
  await author.getByText("Version 1.0.0 uploaded.").waitFor();
  await author.getByRole("button", { name: "Publish", exact: true }).click();
  await author.locator(".ml-sheet").getByRole("button", { name: "Publish", exact: true }).click();
  await author.getByText("Published. Players can find it under Browse.").waitFor();
  const game = await context.newPage(); await game.goto(gameUrl);
  const openManager = () => game.locator(".content-gate__mod-manager").click();
  await openManager();
  const manager = game.getByRole("dialog", { name: "Mod Manager" });
  // Official and community listings share one Browse tab.
  await game.getByRole("tab", { name: /Browse/ }).click();
  await game.getByRole("searchbox", { name: "Search mods" }).fill(modId);
  // Browse opens in the screenshot grid by default.
  const tile = game.locator(`.ml-tile[data-mod-id="${modId}"]`);
  assert.doesNotMatch(await tile.innerText(), /Save-neutral|Save-dependent/);
  assert.equal(await tile.locator(".ml-tile__version").innerText(), "v1.0.0");
  await tile.getByRole("button", { name: "Install" }).click();
  await game.locator(".ml-sheet").getByRole("button", { name: "Install", exact: true }).click();
  await game.getByText("installed and enabled").waitFor();
  assert.equal(await game.evaluate(() => globalThis.__CATALOG_TEST_EXECUTED__), undefined);

  // Details open in their own window over the manager and say what the listing lacks.
  await tile.getByRole("button", { name: "Browser test mod" }).click();
  const details = game.getByRole("dialog", { name: "Browser test mod" });
  await details.getByText("Some details are missing").waitFor();
  assert.match(await details.locator(".ml-facts").innerText(), /Save-neutral/);
  assert.match(await details.locator(".ml-detail__byline").innerText(), new RegExp(`^by ${name} \\(@${name}\\)$`));
  await details.getByText("No screenshots").waitFor();
  await game.keyboard.press("Escape");
  await details.waitFor({ state: "hidden" });
  assert.equal(await manager.isVisible(), true, "Escape in the details window closed the whole manager");

  // An imported file has no store page; its details window still opens and says so.
  const localId = `zz.local.${name.toLowerCase()}`;
  const local = zipSync({
    "manifest.json": strToU8(JSON.stringify({ schemaVersion: 4, id: localId, version: "0.1.0", displayName: "Imported test mod", apiVersion: 4, mode: "offline", dependencies: {}, entry: "main.js" })),
    "main.js": strToU8("globalThis.__LOCAL_TEST_EXECUTED__ = true;"),
  });
  await manager.locator("input[type=file]").setInputFiles({ name: "local.dibmod", mimeType: "application/octet-stream", buffer: Buffer.from(local) });
  await game.getByText("Imported and enabled Imported test mod").waitFor();
  // The list layout is remembered per device; switch once and the rest of the run uses rows.
  await game.getByRole("radio", { name: "List view" }).click();
  await game.locator(`.ml-row[data-mod-id="${localId}"]`).getByRole("button", { name: "Imported test mod" }).click();
  const localDetails = game.getByRole("dialog", { name: "Imported test mod" });
  await localDetails.getByText("No store page").waitFor();
  assert.match(await localDetails.locator(".ml-facts").innerText(), /Save-dependent/);
  await localDetails.getByText("unknown author").waitFor();
  await localDetails.getByText("No screenshots").waitFor();
  await localDetails.getByRole("button", { name: "Close details" }).click();
  await localDetails.waitFor({ state: "hidden" });

  // Load order is drag-and-drop, and shows where each mod's own priority would put it.
  await manager.getByRole("tab", { name: /Load order/ }).click();
  const orderRows = manager.locator(".ml-order__row");
  const orderedIds = () => orderRows.evaluateAll((rows) => rows.map((row) => row.dataset.modId));
  await orderRows.nth(1).waitFor();
  assert.doesNotMatch(await orderRows.filter({ hasText: "Browser test mod" }).innerText(), /Save-neutral|Save-dependent/);
  assert.deepEqual(await orderedIds(), [modId, localId]);
  assert.equal(await manager.getByText("Recommended priority: 0", { exact: true }).count(), 2);
  assert.equal(await manager.getByRole("button", { name: /Move (up|down)/ }).count(), 0);
  const handle = await manager.locator(`.ml-order__row[data-mod-id="${localId}"] .ml-order__handle`).boundingBox();
  const above = await manager.locator(`.ml-order__row[data-mod-id="${modId}"]`).boundingBox();
  await game.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await game.mouse.down();
  // Several steps, so the pointer passes the drag threshold and the other row slides aside.
  await game.mouse.move(handle.x + handle.width / 2, above.y + 4, { steps: 8 });
  await game.mouse.up();
  await manager.getByRole("button", { name: "Use recommended order" }).waitFor();
  assert.deepEqual(await orderedIds(), [localId, modId]);
  assert.equal(await manager.getByText("Recommended priority: 0", { exact: true }).count(), 2,
    "Manual order must not replace the author's recommended priority");
  assert.equal(await manager.locator(`.ml-order__row[data-mod-id="${localId}"] .ml-order__rec`).innerText(), "Recommended: 2nd");
  await manager.getByRole("button", { name: "Use recommended order" }).click();
  await manager.locator(".ml-order__status").waitFor();
  assert.deepEqual(await orderedIds(), [modId, localId]);

  await game.locator(".ml-apply").getByRole("button", { name: /^Apply/ }).click();
  await openManager();
  const row = game.locator(`.ml-row[data-mod-id="${modId}"]`);
  await row.getByRole("switch").click();
  await game.getByText("will be disabled when you apply").waitFor();
  await game.locator(".ml-apply").getByRole("button", { name: /^Apply/ }).click();
  await openManager();
  await row.getByRole("button", { name: "Remove from device" }).click();
  await game.locator(".ml-sheet").getByRole("button", { name: "Remove", exact: true }).click();
  await game.getByText("removed from this device").waitFor();
  await mkdir("output/mod-library", { recursive: true });
  await author.screenshot({ path: "output/mod-library/author.png", fullPage: true });
  await game.screenshot({ path: "output/mod-library/installed.png", fullPage: true });
  await author.getByRole("button", { name: "Delete", exact: true }).click();
  await author.locator(".ml-sheet").getByRole("button", { name: "Delete listing" }).click();
  await author.getByText("Listing deleted.").waitFor();
  assert.deepEqual(errors, []);
  console.log("Mod library scenario passed; inspect output/mod-library screenshots.");
} finally { await browser.close(); }
