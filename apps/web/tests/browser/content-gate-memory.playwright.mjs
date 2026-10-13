// Opt-in browser contract for client-only last-profile, play-mode, and rights memory.
// Run `pnpm mods:examples`, start a strict Vite server, optionally set DIB_CONTENT_ARCHIVE and
// DIB_MOD_ARCHIVE, then run `pnpm scenario:content-gate-memory`. Every Chromium instance is muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "clean_room/CinderHarbor_RuntimeCompatible.ipa"),
);
const mod = path.resolve(
  process.env.DIB_MOD_ARCHIVE ?? path.join(repositoryRoot, "examples/mods/dist/devtools.dibmod"),
);
const outputDirectory = path.join(repositoryRoot, "output/content-gate-memory");
assert(fs.existsSync(archive), `Missing compatible archive: ${archive}`);
assert(fs.existsSync(mod), `Missing mod archive (run pnpm mods:examples): ${mod}`);
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  const mutatingRequests = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (!(["GET", "HEAD"].includes(request.method()))) {
      mutatingRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.locator('input[name="mod-archives"]').setInputFiles(mod);
  await page.locator(".content-gate__mods-label").filter({ hasText: "1 mod enabled" })
    .waitFor({ timeout: 120_000 });
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator(
    '[data-local-save-status].content-gate__mode-detail-status--success',
  ).waitFor({ timeout: 120_000 });
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  await page.locator(".source-loading-bridge").waitFor({ timeout: 120_000 });

  const firstSessionMemory = await page.evaluate(async () => {
    const preferences = JSON.parse(localStorage.getItem("dib.contentGate.v1") ?? "null");
    const cached = await new Promise((resolve, reject) => {
      const request = indexedDB.open("dib-content-archive-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("archives", "readonly");
        const get = transaction.objectStore("archives").get("last");
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const value = get.result;
          database.close();
          resolve(value === undefined
            ? null
            : {
                archiveName: value.archiveName,
                byteLength: value.byteLength,
                blobSize: value.bytes?.size,
                digest: value.digest,
              });
        };
      };
    });
    const profiles = JSON.parse(localStorage.getItem("dib.playProfiles.v1") ?? "[]");
    const cachedMods = await new Promise((resolve, reject) => {
      const request = indexedDB.open("dib-mod-archive-v1", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("mods", "readonly");
        const get = transaction.objectStore("mods").getAll();
        get.onerror = () => reject(get.error);
        get.onsuccess = () => {
          const values = get.result.map((value) => ({
            archiveName: value.archiveName,
            byteLength: value.byteLength,
            blobSize: value.bytes?.size,
            digest: value.digest,
          }));
          database.close();
          resolve(values);
        };
      };
    });
    return { preferences, cached, profiles, cachedMods };
  });
  assert.equal(firstSessionMemory.preferences?.lastMode, "local");
  assert.equal(firstSessionMemory.preferences?.attestationVersion, 1);
  assert.match(firstSessionMemory.preferences?.attestedArchiveDigest ?? "", /^[0-9a-f]{64}$/);
  assert.equal(firstSessionMemory.cached?.archiveName, path.basename(archive));
  assert.equal(firstSessionMemory.cached?.byteLength, fs.statSync(archive).size);
  assert.equal(firstSessionMemory.cached?.blobSize, fs.statSync(archive).size);
  assert.equal(
    firstSessionMemory.cached?.digest,
    firstSessionMemory.preferences?.attestedArchiveDigest,
  );
  assert.equal(firstSessionMemory.profiles?.[0]?.archiveByteLength, fs.statSync(archive).size);
  assert.equal(firstSessionMemory.profiles?.[0]?.mods?.[0]?.byteLength, fs.statSync(mod).size);
  assert.equal(firstSessionMemory.cachedMods?.[0]?.archiveName, path.basename(mod));
  assert.equal(firstSessionMemory.cachedMods?.[0]?.byteLength, fs.statSync(mod).size);
  assert.equal(firstSessionMemory.cachedMods?.[0]?.blobSize, fs.statSync(mod).size);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".content-gate__status").filter({ hasText: " + Devtools from this device." })
    .waitFor({ timeout: 120_000 });
  await page.locator(
    '[data-local-save-status].content-gate__mode-detail-status--success',
  ).waitFor({ timeout: 120_000 });

  const restored = await page.locator(".content-gate").evaluate((gate) => {
    const fileInput = gate.querySelector('input[name="asset-archive"]');
    const mode = gate.querySelector('input[name="save-mode"]:checked');
    const rights = gate.querySelector('.content-gate__rights input[type="checkbox"]');
    const play = gate.querySelector(".content-gate__finish > button");
    const label = gate.querySelector(".content-gate__file-label");
    const modLabel = gate.querySelector(".content-gate__mods-label");
    const modStatus = gate.querySelector(".content-gate__mods-status");
    if (!(fileInput instanceof HTMLInputElement) || !(mode instanceof HTMLInputElement) ||
        !(rights instanceof HTMLInputElement) || !(play instanceof HTMLButtonElement)) {
      throw new Error("restored content gate is incomplete");
    }
    return {
      pickerFiles: fileInput.files?.length ?? -1,
      mode: mode.value,
      rightsChecked: rights.checked,
      rightsDisabled: rights.disabled,
      playDisabled: play.disabled,
      label: label?.textContent?.trim(),
      modLabel: modLabel?.textContent?.trim(),
      modStatus: modStatus?.textContent?.trim(),
    };
  });
  assert.equal(restored.pickerFiles, 0, "reload depended on a retained native file-input value");
  assert.equal(restored.mode, "local");
  assert.equal(restored.rightsChecked, true);
  assert.equal(restored.rightsDisabled, false);
  assert.equal(restored.playDisabled, false);
  assert.equal(restored.label, `Remembered asset archive: ${path.basename(archive)}`);
  assert.equal(restored.modLabel, "1 mod enabled");
  assert.equal(restored.modStatus, "Devtools");

  // Load order and conflicts live in the Mod Manager, beside the restored selection.
  await page.locator(".content-gate__mod-manager").click();
  const manager = page.getByRole("dialog", { name: "Mod Manager" });
  await manager.getByRole("tab", { name: /Load order/ }).click();
  await manager.locator(".ml-order__row").filter({ hasText: "Devtools" })
    .waitFor({ timeout: 120_000 });
  assert.match(await manager.locator(".ml-main").innerText(), /1 enabled mod, activated top to bottom/);
  await manager.getByRole("button", { name: "Close", exact: true }).click();
  await manager.waitFor({ state: "detached", timeout: 120_000 });
  // Saves now live in Offline settings; Profiles is no longer a separate gate button.
  assert.equal(await page.getByRole("button", { name: "Saved profiles" }).count(), 0);
  await page.getByRole("button", { name: "Offline settings", exact: true }).click();
  const saves = page.getByRole("dialog", { name: "Offline settings", exact: true });
  await saves.getByRole("navigation", { name: "Offline save pages" }).waitFor();
  assert.match(await saves.innerText(), /Page 1 of 1/);
  await saves.getByRole("button", { name: "Add page", exact: true }).click();
  await saves.getByRole("navigation").filter({ hasText: "Page 2 of 2" }).waitFor();
  await saves.getByRole("button", { name: "Rename Slot 1", exact: true }).click();
  const name = saves.getByRole("textbox", { name: "Name for Slot 1", exact: true });
  await name.fill("Expedition B");
  await name.press("Enter");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("dib.offlineSaves.v1")).entries[3].name), "Expedition B");
  await saves.getByRole("button", { name: "Close save settings" }).click();

  await page.screenshot({
    path: path.join(outputDirectory, "restored-mobile.png"),
    fullPage: false,
    timeout: 120_000,
  });

  // Disabling every mod of an activated profile must survive the clean-tab reload that Online
  // requires. The package remains cached in the Mod Manager; only automatic
  // selection stops.
  await page.locator(".content-gate__mod-manager").click();
  const clearing = page.getByRole("dialog", { name: "Mod Manager" });
  await clearing.getByRole("button", { name: "Disable all" }).click();
  await clearing.getByRole("button", { name: "Apply & reload" }).click();
  await page.locator(".content-gate__status")
    .filter({ hasText: "Restored the last asset archive from this device." })
    .waitFor({ timeout: 120_000 });
  assert.equal(
    await page.evaluate(() => JSON.parse(
      localStorage.getItem("dib.contentGate.v1") ?? "null",
    )?.restoreLastModProfile),
    false,
  );
  const clearedReload = await page.locator(".content-gate").evaluate((gate) => {
    const online = gate.querySelector('input[name="save-mode"][value="official"]');
    return {
      modLabel: gate.querySelector(".content-gate__mods-label")?.textContent?.trim(),
      onlineDisabled: online instanceof HTMLInputElement ? online.disabled : undefined,
    };
  });
  assert.equal(clearedReload.modLabel, "Optional Offline mods");
  assert.equal(clearedReload.onlineDisabled, false);
  await page.screenshot({
    path: path.join(outputDirectory, "cleared-profile-clean-reload.png"),
    fullPage: false,
    timeout: 120_000,
  });
  assert.deepEqual(mutatingRequests, [], "remembering content performed a network mutation");
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({ firstSessionMemory, restored }, null, 2));
  await context.close();
} finally {
  await browser.close();
}
