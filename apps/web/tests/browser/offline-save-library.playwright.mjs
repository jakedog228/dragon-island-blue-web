// Opt-in: DIB_WEB_URL (strict local Vite server), DIB_CONTENT_ARCHIVE, DIB_NATIVE_SAVE.
// Exercises legacy migration, pages, naming, moves, warnings and native round trips. Always muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? path.join(root, "Dragon_Island_Blue_1.1.0.ipa");
const nativeSave = process.env.DIB_NATIVE_SAVE ?? path.join(root, "working/saves/savefile1");
assert(fs.existsSync(archive), "Set DIB_CONTENT_ARCHIVE to a compatible archive.");
assert(fs.existsSync(nativeSave), "Set DIB_NATIVE_SAVE to a compatible native save.");
const out = path.join(root, "output/offline-save-library");
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"] });
try {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
    const context = await browser.newContext({ viewport, acceptDownloads: true,
      colorScheme: viewport.width < 600 ? "light" : "dark" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => {
      // This Offline scenario intentionally runs without the optional Official service.
      if (message.type() === "error" && message.text().includes("503") &&
        new URL(message.location().url).pathname === "/api/game/readiness") return;
      if (message.type() === "error") errors.push(`${message.text()} ${message.location().url}`);
    });
    await page.addInitScript(() => {
      window.advanceTime = async () => {};
      if (localStorage.getItem("fixture-seeded")) return;
      localStorage.setItem("fixture-seeded", "true");
      for (const [namespace, slot, level] of [["legacy-a", "slot-2", 4], ["legacy-b", "slot-3", 8]]) {
        const value = JSON.stringify({ revision: 2, updatedAt: "2026-09-01T00:00:00Z",
          state: { schemaVersion: 1, player: { schemaVersion: 1,
            profile: { schemaVersion: 1, heroLevel: level },
            party: { kind: "standalone-levels", levels: [level] } } } });
        localStorage.setItem(`dib-save-v1:${namespace}:${slot}`, value);
        localStorage.setItem(`dib-save-v1:${namespace}:${slot}:previous`, value);
      }
      localStorage.setItem("dib.playProfiles.v1", JSON.stringify([{
        schemaVersion: 1, namespace: "legacy-a", archiveDigest: "f".repeat(64),
        archiveName: "Old game.ipa", lastUsedAt: "2026-09-01T00:00:00Z",
        mods: Array.from({ length: 40 }, (_, index) => ({
          digest: index.toString(16).padStart(64, "0"), id: `old.mod${index}`, version: "1.0.0",
          displayName: `Old mod ${index + 1} with a long descriptive name for the save comparison`,
        })),
      }]));
      localStorage.setItem("dib.playProfiles.dismissed.v1", JSON.stringify(["legacy-b"]));
    });
    await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173", { waitUntil: "domcontentloaded" });
    const ready = async () => {
      await page.locator('input[name="asset-archive"]').setInputFiles(archive);
      await page.getByRole("radio", { name: "Offline", exact: true }).check();
      await page.locator('[data-local-save-status].content-gate__mode-detail-status--success').waitFor({ timeout: 120000 });
      await page.getByRole("button", { name: "Offline settings", exact: true }).click();
      await page.getByRole("navigation", { name: "Offline save pages" }).waitFor();
    };
    await ready();
    await page.mouse.move(0, 0);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, `overview-${viewport.width}.png`) });
    assert.equal(await page.getByRole("button", { name: "Saved profiles" }).count(), 0);
    const dialog = page.getByRole("dialog", { name: "Offline settings", exact: true });
    const pagePicker = dialog.getByRole("combobox", { name: "Save page", exact: true });
    await pagePicker.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await pagePicker.inputValue(), "1", "native page selection lost keyboard support");
    await pagePicker.selectOption("0");
    await pagePicker.click();
    await page.screenshot({ path: path.join(out, `dropdown-${viewport.width}.png`) });
    await page.keyboard.press("Escape");
    assert(await dialog.isVisible(), "dismissing the dropdown closed the modal");
    assert.equal(await dialog.getByRole("combobox", { name: "Save page", exact: true }).inputValue(), "0");
    const oldRow = dialog.locator('[data-save-slot="slot-2"]');
    assert.match(await oldRow.innerText(), /Mod setup changed/);
    assert.doesNotMatch(await oldRow.innerText(), /Old mod 40/);
    const comparison = oldRow.locator(".save-mods");
    await comparison.locator("summary").click();
    assert.equal(await comparison.locator("li").count(), 40);
    assert(await comparison.locator(".save-mods__metadata").first().evaluate(node => {
      const [version, change] = [...node.children].map(child => child.getBoundingClientRect());
      return Math.abs(version.y - change.y) < 2;
    }), "mod version and change label needlessly stack");
    const scrollRegion = comparison.getByRole("region", { name: "Mod lists in load order" });
    assert(await scrollRegion.evaluate(node => node.scrollHeight > node.clientHeight), "long mod lists were not bounded");
    await scrollRegion.focus();
    await page.keyboard.press("End");
    await page.screenshot({ path: path.join(out, `mod-comparison-${viewport.width}.png`) });
    await comparison.locator("summary").click();
    await oldRow.getByRole("button", { name: "Rename Slot 2", exact: true }).click();
    await page.screenshot({ path: path.join(out, `rename-${viewport.width}.png`) });
    const name = oldRow.getByRole("textbox");
    await name.fill("Legacy expedition");
    await name.press("Enter");
    await oldRow.getByRole("button", { name: "Rename Slot 2", exact: true }).click();
    await name.fill("Discarded name");
    await name.press("Escape");
    assert.equal(await oldRow.locator(".save-library__name").innerText(), "Legacy expedition");
    assert(await dialog.isVisible(), "Escape while renaming closed the dialog");
    await page.keyboard.press("Enter");
    await name.fill("   ");
    await name.press("Enter");
    assert.equal(await name.getAttribute("aria-invalid"), "true");
    await oldRow.getByRole("button", { name: "Cancel renaming Slot 2", exact: true }).click();
    assert.equal(await oldRow.locator(".save-library__name").innerText(), "Legacy expedition");
    await oldRow.getByRole("button", { name: "Manage Slot 2", exact: true }).click();
    await oldRow.getByRole("combobox", { name: "Destination page for Slot 2", exact: true }).selectOption("1");
    await oldRow.getByRole("combobox", { name: "Destination slot for Slot 2", exact: true }).selectOption("0");
    assert.equal(await dialog.getByRole("combobox", { name: "Save page", exact: true }).inputValue(), "0", "choosing a move destination moved the save without submitting");
    await page.screenshot({ path: path.join(out, `manage-${viewport.width}.png`) });
    await oldRow.getByRole("button", { name: "Move save", exact: true }).click();
    assert.equal(await dialog.getByRole("combobox", { name: "Save page", exact: true }).inputValue(), "1");
    await page.waitForFunction(() => document.activeElement?.matches('[data-save-slot="slot-1"] [data-manage-save]'));
    assert.equal(await dialog.locator('[data-save-slot="slot-1"] .save-library__name').innerText(), "Legacy expedition");
    await dialog.getByRole("button", { name: "Add page", exact: true }).click();
    assert.equal(await dialog.getByRole("combobox", { name: "Save page", exact: true }).inputValue(), "2");
    page.once("dialog", prompt => prompt.accept("2"));
    await dialog.locator('input[type="file"]').setInputFiles(nativeSave);
    await dialog.getByText(/Imported the save into slot-2/).waitFor({ timeout: 30000 });
    const imported = dialog.locator('[data-save-slot="slot-2"]');
    assert.equal(await imported.locator(".save-library__name").innerText(), path.basename(nativeSave));
    await imported.getByRole("button", { name: "Rename Slot 2", exact: true }).click();
    assert.match(await imported.innerText(), /Previous mods unknown/);
    await imported.getByRole("textbox").fill("My expedition");
    await imported.getByRole("textbox").press("Enter");
    await imported.getByRole("button", { name: "Manage Slot 2", exact: true }).click();
    await page.keyboard.press("Escape");
    assert(await dialog.isVisible(), "Escape in management closed the entire settings dialog");
    assert.equal(await imported.getByRole("button", { name: "Manage Slot 2", exact: true }).getAttribute("aria-expanded"), "false");
    const downloaded = page.waitForEvent("download");
    await imported.getByRole("button", { name: "Export Slot 2", exact: true }).click();
    const download = await downloaded;
    assert.equal(download.suggestedFilename(), "My expedition");
    const backup = path.join(out, `roundtrip-${viewport.width}`);
    await download.saveAs(backup);
    assert.equal(fs.readFileSync(backup).subarray(0, 8).toString(), "bplist00");
    const original = await page.evaluate(() => localStorage.getItem("dib-save-v1:legacy-a:slot-2"));
    await page.screenshot({ path: path.join(out, `settings-${viewport.width}.png`) });
    await page.reload({ waitUntil: "domcontentloaded" });
    await ready();
    assert.equal(await dialog.getByRole("combobox", { name: "Save page", exact: true }).inputValue(), "2");
    assert.equal(await dialog.locator('[data-save-slot="slot-2"] .save-library__name').innerText(), "My expedition");
    assert.equal(await page.evaluate(() => localStorage.getItem("dib-save-v1:legacy-a:slot-2")), original);
    page.once("dialog", prompt => prompt.accept("3"));
    await dialog.locator('input[type="file"]').setInputFiles(backup);
    await dialog.getByText(/Imported the save into slot-3/).waitFor({ timeout: 30000 });
    assert.equal(await dialog.locator('[data-save-slot="slot-3"] .save-library__name').innerText(), path.basename(backup));
    const layout = await dialog.evaluate(node => ({
      overflow: node.scrollWidth > node.clientWidth,
      smallTargets: [...node.querySelectorAll("button, input, select, summary")]
        .filter(control => control.getClientRects().length && !control.hidden)
        .filter(control => control.getBoundingClientRect().height < 44).map(control => control.outerHTML),
    }));
    assert.equal(layout.overflow, false, "settings overflowed horizontally");
    assert.deepEqual(layout.smallTargets, [], "settings have undersized touch targets");
    const closeBounds = await dialog.getByRole("button", { name: "Close save settings" }).boundingBox();
    assert(closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= viewport.height,
      "modal close button scrolled out of view");
    const smallViewport = viewport.width < 600 ? { width: 320, height: 568 } : { width: 900, height: 430 };
    await page.setViewportSize(smallViewport);
    await dialog.locator(".save-library").evaluate(node => { node.scrollTop = 0; });
    assert.equal(await dialog.evaluate(node => node.scrollWidth > node.clientWidth), false);
    assert(await pagePicker.evaluate(node => {
      const style = getComputedStyle(node);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      context.font = style.font;
      return context.measureText(node.selectedOptions[0].text).width <=
        node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    }), "selected page label is clipped at narrow widths");
    assert(await dialog.evaluate(node => [...node.querySelectorAll(".save-library__page-arrow, .content-gate__dialog-close")].every(button => {
      const control = button.getBoundingClientRect();
      const icon = button.querySelector("svg").getBoundingClientRect();
      return Math.abs((control.x + control.width / 2) - (icon.x + icon.width / 2)) < 1 &&
        Math.abs((control.y + control.height / 2) - (icon.y + icon.height / 2)) < 1;
    })), "icon-only controls are off-center");
    const narrowName = dialog.getByRole("button", { name: "Rename Slot 2", exact: true });
    await narrowName.click();
    assert.equal(await dialog.locator(".save-library").evaluate(node => node.scrollWidth > node.clientWidth), false);
    await page.screenshot({ path: path.join(out, `compact-${smallViewport.width}.png`) });
    await page.keyboard.press("Escape");
    await imported.locator(".save-mods summary").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, `compact-warning-${smallViewport.width}.png`) });
    await page.setViewportSize(viewport);
    await dialog.getByRole("button", { name: "Close save settings" }).click();
    assert.match(await page.locator("[data-local-save-status]").innerText(), /Page 3 of 3: 2 saved games/);
    await page.getByRole("checkbox", { name: "I have the right to use the content in this archive on this device." }).check();
    await page.getByRole("button", { name: "Play Offline", exact: true }).click();
    await page.waitForFunction(() => typeof window.render_game_to_text === "function" && typeof window.advanceTime === "function", undefined, { timeout: 120000 });
    const gameState = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
    const advance = async () => {
      await page.evaluate(() => window.advanceTime(25));
      await page.waitForTimeout(5);
    };
    for (let i = 0; i < 480 && (await gameState()).startup?.phase !== "title"; i++) await advance();
    assert.equal((await gameState()).startup?.phase, "title");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 480 && (await gameState()).startup?.phase !== "save-select"; i++) await advance();
    const startup = (await gameState()).startup;
    assert.equal(startup?.phase, "save-select");
    assert.deepEqual(startup.slots.map(slot => slot.occupied), [false, true, true], "startup ignored the selected save page");
    fs.writeFileSync(path.join(out, `startup-${viewport.width}.json`), JSON.stringify(await gameState(), null, 2));
    await page.screenshot({ path: path.join(out, `startup-${viewport.width}.png`) });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("Offline save migration, pagination, names, moves, warnings and round trips passed.");
} finally { await browser.close(); }
