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
  await page.locator(".content-gate__mods-label").filter({ hasText: "1 Offline Mod selected" })
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
  assert.equal(restored.modLabel, "1 Offline Mod selected");
  assert.equal(restored.modStatus, path.basename(mod));

  await page.getByRole("button", { name: "Load order and conflicts" }).click();
  const loadOrderText = await page.locator('[aria-labelledby="selection-dialog-title"]')
    .innerText();
  const shortSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
    const value = bytes / (1024 ** (unitIndex + 1));
    return `${value.toFixed(value < 10 ? 1 : 0).replace(/\.0$/, "")} ${units[unitIndex]}`;
  };
  assert.match(loadOrderText, new RegExp(shortSize(fs.statSync(archive).size).replace(".", "\\.")));
  assert.match(loadOrderText, new RegExp(shortSize(fs.statSync(mod).size).replace(".", "\\.")));
  await page.getByRole("button", { name: "Close Load order" }).click();

  // Profile rows are save-backed. Add a disposable index row after the real save probe has
  // finished, then prove both remembered sizes render in the profile modal without feeding this
  // placeholder to BrowserSaveConnection.
  const profileNamespace = firstSessionMemory.profiles?.[0]?.namespace;
  assert.equal(typeof profileNamespace, "string");
  await page.evaluate((namespace) => {
    localStorage.setItem(`dib-save-v1:${namespace}:slot-1`, JSON.stringify({ revision: 1 }));
  }, profileNamespace);
  const foreignNamespace = `SHA-256:dib-identity-plists-v7:${"f".repeat(64)}`;
  await page.evaluate((namespace) => {
    localStorage.setItem(`dib-save-v1:${namespace}:slot-2`, JSON.stringify({
      revision: 1,
      updatedAt: "2026-09-03T12:00:00.000Z",
      state: {
        schemaVersion: 1,
        player: {
          schemaVersion: 1,
          profile: { schemaVersion: 1 },
          party: { kind: "standalone-levels", levels: [1] },
        },
      },
    }));
  }, foreignNamespace);
  await page.getByRole("button", { name: "Saved profiles" }).click();
  await page.locator(".content-gate__profile-content-state")
    .filter({ hasText: `cached · ${shortSize(fs.statSync(mod).size)}` })
    .waitFor({ timeout: 120_000 });
  const profileText = await page.locator('[aria-labelledby="profiles-dialog-title"]')
    .innerText();
  const foreignProfile = page.locator(".content-gate__profile")
    .filter({ hasText: "Unidentified content" });
  page.once("dialog", (dialog) => dialog.accept());
  await foreignProfile.getByRole("button", { name: "Try here" }).click();
  await page.locator(".content-gate__status")
    .filter({ hasText: "slot-2 was cloned for a risky compatibility attempt" })
    .waitFor({ timeout: 120_000 });
  const cloneKeys = await page.evaluate(({ source, target }) => ({
    source: localStorage.getItem(`dib-save-v1:${source}:slot-2`),
    target: localStorage.getItem(`dib-save-v1:${target}:slot-2`),
  }), { source: foreignNamespace, target: profileNamespace });
  assert.notEqual(cloneKeys.source, null, "risky compatibility clone removed its source");
  assert.notEqual(cloneKeys.target, null, "risky compatibility clone did not create its destination");
  page.once("dialog", (dialog) => dialog.dismiss());
  await foreignProfile.getByRole("button", { name: "Delete" }).click();
  assert.notEqual(
    await page.evaluate((namespace) => localStorage.getItem(`dib-save-v1:${namespace}:slot-2`), foreignNamespace),
    null,
    "cancelling native save deletion removed the slot",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await foreignProfile.getByRole("button", { name: "Delete" }).click();
  await page.locator(".content-gate__status")
    .filter({ hasText: "slot-2 was permanently deleted" })
    .waitFor({ timeout: 120_000 });
  assert.equal(
    await page.evaluate((namespace) => localStorage.getItem(`dib-save-v1:${namespace}:slot-2`), foreignNamespace),
    null,
    "confirmed native save deletion retained the slot",
  );
  assert.notEqual(
    await page.evaluate((namespace) => localStorage.getItem(`dib-save-v1:${namespace}:slot-2`), profileNamespace),
    null,
    "deleting the source profile also deleted the cloned destination",
  );
  assert.match(profileText, new RegExp(`cached · ${shortSize(fs.statSync(archive).size).replace(".", "\\.")}`));
  assert.match(profileText, new RegExp(`cached · ${shortSize(fs.statSync(mod).size).replace(".", "\\.")}`));
  await page.evaluate((namespace) => {
    localStorage.removeItem(`dib-save-v1:${namespace}:slot-1`);
    localStorage.removeItem(`dib-save-v1:${namespace}:slot-2`);
  }, profileNamespace);
  await page.getByRole("button", { name: "Close Profiles" }).click();

  await page.screenshot({
    path: path.join(outputDirectory, "restored-mobile.png"),
    fullPage: false,
    timeout: 120_000,
  });

  // Clearing an activated profile must survive the clean-tab reload that Online requires. The
  // package remains cached for the save-linked Profiles surface; only automatic selection stops.
  await page.getByRole("button", { name: "Clear mods" }).click();
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
  assert.equal(clearedReload.modLabel, "Optional Offline Mods (.dibmod)");
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
