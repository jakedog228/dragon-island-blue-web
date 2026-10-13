// Opt-in, against a strict Vite dev server. No IPA or API required: exercises the real save
// library, comparison disclosure and persistence with scenario-owned saves in a fresh context.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, args: ["--mute-audio"] });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173");
    const result = await page.evaluate(async () => {
      const { OfflineSaveLibrary } = await import("/src/player/offlineSaveLibrary.ts");
      const { saveModDetails } = await import("/src/content/saveModDetails.ts");
      await import("/src/content/saveBackupPanel.css");
      const mod = (id, saveCompatibility) => ({ id, digest: id.repeat(64), displayName: id,
        version: "1.0.0", saveCompatibility });
      const content = mod("Content mod", "dependent"), hud = mod("HUD", "neutral");
      const first = new OfflineSaveLibrary(localStorage, "neutral-overlay", [content, hud], undefined, "fixture-content");
      await first.open("slot-1").save({ schemaVersion: 1, player: { schemaVersion: 1,
        profile: { schemaVersion: 1, heroLevel: 7 }, party: { kind: "standalone-levels", levels: [7] } } });
      const before = localStorage.getItem(first.entry("slot-1").id);
      const removed = new OfflineSaveLibrary(localStorage, "dependent-overlay", [content], undefined, "fixture-content");
      const dependentChanged = new OfflineSaveLibrary(localStorage, "neutral-only", [hud], undefined, "fixture-content");
      const contentChanged = new OfflineSaveLibrary(localStorage, "different-content", [content], undefined, "different-archive");
      const fixture = document.createElement("section");
      fixture.id = "save-neutral-fixture";
      fixture.className = "content-gate";
      fixture.style.cssText = "position:fixed;inset:0;z-index:99999;overflow:auto;padding:20px;background:white;color:black;display:block";
      for (const library of [removed, dependentChanged, contentChanged]) {
        fixture.append(saveModDetails(first.entry("slot-1").lastMods, library.selectedMods,
          library.contentChanged("slot-1")));
      }
      document.body.append(fixture);
      return { neutralWarning: removed.warning("slot-1") ?? null,
        dependentWarning: dependentChanged.warning("slot-1"), contentWarning: contentChanged.warning("slot-1"),
        preserved: before === localStorage.getItem(first.entry("slot-1").id),
        level: (await removed.loadSlotState("slot-1")).player.profile.heroLevel };
    });
    assert.equal(result.neutralWarning, null);
    assert.match(result.dependentWarning, /Different mods/);
    assert.match(result.contentWarning, /Different game content/);
    assert.equal(result.preserved, true);
    assert.equal(result.level, 7);
    const rows = page.locator("#save-neutral-fixture .save-mods");
    assert.equal(await rows.nth(0).getAttribute("data-kind"), "same");
    assert.equal(await rows.nth(1).getAttribute("data-kind"), "mods");
    assert.equal(await rows.nth(2).getAttribute("data-kind"), "content");
    await rows.nth(0).locator("summary").click();
    assert.match(await rows.nth(0).innerText(), /Save-neutral/);
    assert.match(await rows.nth(0).innerText(), /Removed/);
    assert.doesNotMatch(await rows.nth(0).innerText(), /Export a backup/);
    await mkdir("output/save-neutral-mods", { recursive: true });
    await page.screenshot({ path: `output/save-neutral-mods/${width}.png` });
    assert.deepEqual(errors, []);
    await context.close();
  }
} finally { await browser.close(); }
