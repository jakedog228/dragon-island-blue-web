


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/content-gate-handoff");
const nativeSave = process.env.DIB_NATIVE_SAVE === undefined
  ? undefined
  : path.resolve(process.env.DIB_NATIVE_SAVE);
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
if (nativeSave !== undefined) {
  assert(fs.existsSync(nativeSave), `Missing operator-owned native save: ${nativeSave}`);
}
fs.mkdirSync(outputDirectory, { recursive: true });

const variants = [
  {
    label: "desktop-iphone",
    viewport: { width: 1280, height: 800 },
    displayMode: "iphone",
    reducedMotion: "no-preference",
  },
  {
    label: "phone-portrait",
    viewport: { width: 390, height: 844 },
    displayMode: "iphone",
    reducedMotion: "no-preference",
    isMobile: true,
    hasTouch: true,
  },
  {
    label: "tablet-ipad-reduced-motion",
    viewport: { width: 1024, height: 768 },
    displayMode: "ipad",
    reducedMotion: "reduce",
    isMobile: true,
    hasTouch: true,
  },
];

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const results = [];
  for (const variant of variants) {
    const context = await browser.newContext({
      viewport: variant.viewport,
      reducedMotion: variant.reducedMotion,
      isMobile: variant.isMobile ?? false,
      hasTouch: variant.hasTouch ?? false,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon")) {
        errors.push(`console: ${message.text()}`);
      }
    });
    await page.addInitScript((displayMode) => {
      localStorage.setItem("dib.portSettings.v1", JSON.stringify({
        displayMode,
        textResolutionMode: "modern",
        sound: 0,
        music: 0,
      }));
    }, variant.displayMode);
    await page.goto(webUrl, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      globalThis.__DIB_GATE_TRANSITIONS__ = [];
      document.addEventListener("transitionrun", (event) => {
        const target = event.target;
        if (!(event instanceof TransitionEvent) || !(target instanceof HTMLElement)) return;
        if (target.classList.contains("content-gate__backdrop")) {
          globalThis.__DIB_GATE_TRANSITIONS__.push({
            target: "backdrop",
            property: event.propertyName,
          });
        } else if (target.classList.contains("content-gate__privacy")) {
          globalThis.__DIB_GATE_TRANSITIONS__.push({
            target: "privacy",
            property: event.propertyName,
          });
        }
      }, true);
    });
    await page.locator('input[name="asset-archive"]').setInputFiles(archive);
    const backdrop = page.locator(".content-gate__backdrop--visible");
    await backdrop.waitFor({ state: "visible", timeout: 120_000 });
    await page.waitForFunction(() => {
      const node = document.querySelector(".content-gate__backdrop--visible");
      return node instanceof HTMLElement && Number.parseFloat(getComputedStyle(node).opacity) > .99;
    }, undefined, { timeout: 10_000 });

    const themed = await page.locator(".content-gate").evaluate((gate) => {
      const frame = gate.querySelector(".content-gate__backdrop-frame");
      const crop = gate.querySelector(".content-gate__backdrop-background");
      const image = gate.querySelector(".content-gate__backdrop-image");
      const card = gate.querySelector(".content-gate__card");
      const privacy = gate.querySelector(".content-gate__privacy");
      const gameContentHeading = gate.querySelector(
        ".content-gate__archive .content-gate__section-heading",
      );
      if (!(frame instanceof HTMLElement) || !(crop instanceof HTMLElement) ||
          !(image instanceof HTMLImageElement) || !(card instanceof HTMLElement) ||
          !(privacy instanceof HTMLElement) || !(gameContentHeading instanceof HTMLElement)) {
        throw new Error("the themed gate is missing its backdrop structure");
      }
      const rect = (node) => {
        const bounds = node.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      };
      return {
        gateClass: gate.className,
        frame: rect(frame),
        crop: rect(crop),
        image: rect(image),
        imageUrl: image.currentSrc || image.src,
        natural: { width: image.naturalWidth, height: image.naturalHeight },
        pointerEvents: getComputedStyle(gate.querySelector(".content-gate__backdrop")).pointerEvents,
        ariaHidden: gate.querySelector(".content-gate__backdrop")?.getAttribute("aria-hidden"),
        cardOpacity: getComputedStyle(card).opacity,
        privacyDisplay: getComputedStyle(privacy).display,
        privacyOpacity: getComputedStyle(privacy).opacity,
        privacyVisibility: getComputedStyle(privacy).visibility,
        privacyHeight: privacy.getBoundingClientRect().height,
        gameContentHeading: gameContentHeading.textContent?.trim(),
        gameContentHeadingDisplay: getComputedStyle(gameContentHeading).display,
        scrollable: gate.scrollHeight > gate.clientHeight,
      };
    });
    assert.match(themed.gateClass, /content-gate--themed/, `${variant.label}: gate was not themed`);
    assert.match(themed.imageUrl, /^blob:/, `${variant.label}: backdrop is not archive-local`);
    assert(themed.natural.width > 0 && themed.natural.height > 0,
      `${variant.label}: backdrop did not decode`);
    assert.equal(themed.pointerEvents, "none", `${variant.label}: backdrop intercepted input`);
    assert.equal(themed.ariaHidden, "true", `${variant.label}: decorative art entered the a11y tree`);
    assert.equal(themed.cardOpacity, "1", `${variant.label}: themed form is not readable`);
    assert.equal(themed.privacyDisplay, "grid", `${variant.label}: privacy note was removed abruptly`);
    assert.equal(themed.privacyOpacity, "0", `${variant.label}: privacy note did not fade out`);
    assert.equal(themed.privacyVisibility, "hidden", `${variant.label}: closed privacy note stayed exposed`);
    assert.equal(themed.privacyHeight, 0, `${variant.label}: closed privacy note retained layout height`);
    assert.equal(themed.gameContentHeading, "Game content", `${variant.label}: archive heading changed`);
    assert.notEqual(
      themed.gameContentHeadingDisplay,
      "none",
      `${variant.label}: archive heading disappeared after upload`,
    );
    assert.equal(themed.scrollable, false, `${variant.label}: ordered gate needs a scrollbar`);
    const transitions = await page.evaluate(() => globalThis.__DIB_GATE_TRANSITIONS__);
    if (variant.reducedMotion === "reduce") {
      // A reader who asked for reduced motion gets the same ORDER and the same end state, with no
      // animation to sit through: zero duration and zero delay produce no transition at all, which
      // is why the leaving-class wait below is skipped for this variant too. Asserting the absence
      // is what keeps the honored preference from silently regressing back into a fade.
      assert.deepEqual(
        transitions,
        [],
        `${variant.label}: reduced motion still animated the gate: ${JSON.stringify(transitions)}`,
      );
    } else {
      assert(
        transitions.some((entry) => entry.target === "privacy" && entry.property === "opacity"),
        `${variant.label}: privacy note closed without an opacity transition`,
      );
      assert(
        transitions.some((entry) => entry.target === "privacy" && entry.property === "grid-template-rows"),
        `${variant.label}: privacy note closed without a height transition`,
      );
      assert(
        transitions.some((entry) => entry.target === "backdrop" && entry.property === "opacity"),
        `${variant.label}: archive background populated without fading in`,
      );
    }

    const sourceSize = variant.displayMode === "ipad"
      ? { width: 512, height: 384 }
      : { width: 480, height: 320 };
    const scale = Math.min(
      variant.viewport.width / sourceSize.width,
      variant.viewport.height / sourceSize.height,
    );
    assert(Math.abs(themed.frame.width - sourceSize.width * scale) < 1,
      `${variant.label}: wrong source frame width: ${JSON.stringify(themed.frame)}`);
    assert(Math.abs(themed.frame.height - sourceSize.height * scale) < 1,
      `${variant.label}: wrong source frame height: ${JSON.stringify(themed.frame)}`);

    const modeBeforeSelection = await page.locator(".content-gate__save-mode").evaluate((section) => ({
      selected: section.querySelector('input[name="save-mode"]:checked')?.getAttribute("value") ?? null,
      complete: section.classList.contains("content-gate__section--complete"),
    }));
    assert.deepEqual(
      modeBeforeSelection,
      { selected: null, complete: false },
      `${variant.label}: play mode was preselected or prematurely complete`,
    );
    await page.getByRole("radio", { name: "Offline", exact: true }).check();
    const localSaveStatus = page.locator(
      '[data-local-save-status].content-gate__mode-detail-status--success',
    );
    await localSaveStatus.waitFor({ state: "visible", timeout: 120_000 });
    assert.match(
      (await localSaveStatus.textContent()) ?? "",
      /Page \d+ of \d+: \d+ saved games/i,
      `${variant.label}: Offline did not report browser-save detection`,
    );
    assert(
      await page.locator(".content-gate__save-mode")
        .evaluate((section) => section.classList.contains("content-gate__section--complete")),
      `${variant.label}: resolved Offline mode did not complete its section`,
    );

    const importsNativeSave = variant.label === "desktop-iphone" && nativeSave !== undefined;
    if (importsNativeSave) {
      await page.getByRole("button", { name: "Offline settings" }).click();
      const storageDialog = page.getByRole("dialog", { name: "Offline settings" });
      await storageDialog.getByText("Offline save slots").waitFor();
      page.once("dialog", async (prompt) => {
        assert.equal(prompt.type(), "prompt", "native-save import did not ask for a slot");
        await prompt.accept("1");
      });
      await storageDialog.locator('input[type="file"]').setInputFiles(nativeSave);
      await storageDialog.getByText(/Imported the save into slot-1\./).waitFor({ timeout: 30_000 });
      const importedDetail = (await storageDialog.locator(".content-gate__backup-slot-detail")
        .first().textContent()) ?? "";
      assert(!/^Empty$/i.test(importedDetail.trim()),
        `Offline settings did not refresh the imported slot: ${importedDetail}`);
      await storageDialog.getByRole("button", { name: "Close save settings" }).click();
    }

    await page.screenshot({
      path: path.join(outputDirectory, `${variant.label}-themed.png`),
      fullPage: false,
      timeout: 120_000,
    });
    await page.locator(".content-gate__rights input").check();

    const leaving = variant.reducedMotion === "reduce"
      ? undefined
      : page.waitForFunction(() =>
          document.querySelector(".content-gate")?.classList.contains("content-gate--leaving") === true,
        undefined,
        { timeout: 2_000 });
    await page.getByRole("button", { name: "Play Offline", exact: true }).click();
    await leaving;
    const bridge = page.locator(".source-loading-bridge");
    await bridge.waitFor({ state: "attached", timeout: 120_000 });
    const bridgeFrame = await bridge.locator(".source-loading-bridge__frame").evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    assert(Math.abs(bridgeFrame.width - themed.frame.width) < 1,
      `${variant.label}: handoff changed frame width`);
    assert(Math.abs(bridgeFrame.height - themed.frame.height) < 1,
      `${variant.label}: handoff changed frame height`);
    if (importsNativeSave) {
      const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
      const advance = async (ms) => {
        await page.evaluate((value) => window.advanceTime(value), ms);
        await page.waitForTimeout(2);
      };
      for (let index = 0; index < 480 && (await state()).startup?.phase !== "title"; index++) {
        await advance(25);
      }
      assert.equal((await state()).startup?.phase, "title",
        "startup did not reach the title after settings import");
      await page.keyboard.press("Enter");
      for (let index = 0; index < 480 && (await state()).startup?.phase !== "save-select"; index++) {
        await advance(25);
      }
      const startup = (await state()).startup;
      const slot = startup?.slots?.find((candidate) => candidate.slotId === "slot-1");
      assert(slot?.occupied,
        `startup used a stale connection after settings import: ${JSON.stringify(startup)}`);
    }
    await bridge.waitFor({ state: "detached", timeout: 120_000 });
    await page.screenshot({ path: path.join(outputDirectory, `${variant.label}-handoff.png`),
      fullPage: false, timeout: 120_000 });
    assert.equal(errors.length, 0, `${variant.label}: ${errors.join("\n")}`);
    results.push({
      label: variant.label,
      frame: themed.frame,
      reducedMotion: variant.reducedMotion,
      scrollable: themed.scrollable,
      importedSlot: importsNativeSave,
    });
    await context.close();
  }
  process.stdout.write(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
