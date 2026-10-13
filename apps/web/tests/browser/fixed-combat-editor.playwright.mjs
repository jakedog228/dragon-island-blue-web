

import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const archive = process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
  .map((name) => resolve(repositoryRoot, name))
  .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
if (!archive) throw new Error("Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
const errors = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error}`));
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("favicon")) {
    errors.push(`console: ${message.text()}`);
  }
});

try {
  await page.goto(process.env.DIB_WEB_URL ?? "http://localhost:5173", {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.locator('input[name="save-mode"][value="scenario"]').check();
  await page.locator('select[name="scenario-kind"]').selectOption("combat");

  const preset = page.locator('select[name="scenario-combat-example"]');
  assert.deepEqual(await preset.locator("option").evaluateAll((options) =>
    options.map((option) => ({ value: option.value, disabled: option.disabled }))), [
    { value: "random", disabled: false },
    { value: "reserve", disabled: false },
    { value: "starter", disabled: false },
    { value: "ice-storm", disabled: false },
  ]);
  await expectVisible(page.locator("[data-scenario-builder-open]"));
  await expectCenteredIcons(page);
  assert(await page.locator(".content-gate__scenario-seed-controls").isVisible());

  for (const [value, playerCount, enemyCount] of [
    ["reserve", 6, 6],
    ["starter", 3, 3],
    ["ice-storm", 2, 2],
  ]) {
    await preset.selectOption(value);
    assert.equal(await page.locator(".content-gate__scenario-seed-controls").isVisible(), false);
    await page.locator("[data-scenario-builder-open]").click();
    const dialog = page.locator(".content-gate__scenario-dialog");
    await expectVisible(dialog);
    await expectCenteredIcons(dialog);
    assert.equal(await dialog.locator('[data-scenario-rows="player"] > article').count(), playerCount);
    assert.equal(await dialog.locator('[data-scenario-rows="enemy"] > article').count(), enemyCount);
    for (const row of await dialog.locator("[data-scenario-rows] > article").all()) {
      assert.equal(await row.locator("[data-scenario-kit-slot]").count(), 4);
      assert((await row.locator("[data-scenario-kit-slot]").evaluateAll((inputs) =>
        inputs.some((input) => input.value.length > 0))), "a populated combatant has an empty kit");
    }
    const layout = await dialog.evaluate((node) => {
      const card = node.querySelector(".content-gate__scenario-dialog-card");
      const builder = node.querySelector(".content-gate__scenario-builder");
      const rect = node.getBoundingClientRect();
      return {
        open: node.open,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        cardHeight: card?.getBoundingClientRect().height ?? 0,
        dialogHeight: node.clientHeight,
        builderOverflowY: builder === null ? "missing" : getComputedStyle(builder).overflowY,
      };
    });
    assert(layout.open && layout.left >= 0 && layout.right <= 1100 && layout.top >= 0 && layout.bottom <= 760,
      `editor escaped the viewport: ${JSON.stringify(layout)}`);
    assert(Math.abs(layout.cardHeight - layout.dialogHeight) < 2, `editor card is jumbled: ${JSON.stringify(layout)}`);
    assert.equal(layout.builderOverflowY, "auto");
    await dialog.locator("[data-scenario-builder-done]").click();
  }

  await preset.selectOption("starter");
  await page.locator("[data-scenario-builder-open]").click();
  const dialog = page.locator(".content-gate__scenario-dialog");
  const before = await dialog.locator('[data-scenario-rows="player"] > article').count();
  await dialog.locator('[data-scenario-add="player"]').click();
  const added = dialog.locator('[data-scenario-rows="player"] > article').nth(before);
  assert.equal(await added.locator("[data-scenario-kit-slot]").count(), 4);
  assert(await added.locator("[data-scenario-kit-slot]").evaluateAll((inputs) =>
    inputs.some((input) => input.value.length > 0)), "new monster did not receive its native kit");
  assert.equal(await dialog.locator("[data-scenario-gem-slot]").count(), 4);
  assert((await dialog.locator("[data-scenario-spirit]").count()) > 0, "archive Spirits were not exposed");
  assert.equal(await dialog.locator('[data-scenario-field="soul-enabled"]:not([disabled])').count(),
    (before + 1) + await dialog.locator('[data-scenario-rows="enemy"] > article').count());

  await added.locator('[data-scenario-field="level"]').fill("77");
  await added.locator("[data-scenario-combatant-reset]").click();
  await expectVisible(page.locator(".content-gate__scenario-confirm"));
  await page.locator("[data-scenario-confirm-cancel]").click();
  assert.equal(await added.locator('[data-scenario-field="level"]').inputValue(), "77");
  await added.locator("[data-scenario-combatant-reset]").click();
  await page.locator("[data-scenario-confirm-accept]").click();
  assert.equal(await added.locator('[data-scenario-field="level"]').inputValue(), "12");

  await added.locator("[data-scenario-remove]").click();
  await page.locator("[data-scenario-confirm-cancel]").click();
  assert.equal(await dialog.locator('[data-scenario-rows="player"] > article').count(), before + 1);
  await added.locator("[data-scenario-remove]").click();
  await page.locator("[data-scenario-confirm-accept]").click();
  assert.equal(await dialog.locator('[data-scenario-rows="player"] > article').count(), before);

  await dialog.locator("[data-scenario-json-toggle]").click();
  await expectCenteredIcons(dialog);
  const jsonText = dialog.locator("[data-scenario-json-text]");
  const document = JSON.parse(await jsonText.inputValue());
  assert.equal(document.kind, "dragon-island-blue-fixed-combat");
  assert.equal(document.version, 1);
  document.encounter.playerTeam[0].level = 42;
  await jsonText.fill(JSON.stringify(document));
  await dialog.locator("[data-scenario-json-apply]").click();
  assert.equal(await dialog.locator('[data-scenario-rows="player"] > article').first()
    .locator('[data-scenario-field="level"]').inputValue(), "42");

  document.encounter.playerTeam[0].level = 43;
  await dialog.locator("[data-scenario-json-file]").setInputFiles({
    name: "fixed-combat.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  assert.equal(await dialog.locator('[data-scenario-rows="player"] > article').first()
    .locator('[data-scenario-field="level"]').inputValue(), "43");
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Fixed combat editor contract passed");
} finally {
  await browser.close();
}

async function expectVisible(locator) {
  await locator.waitFor({ state: "visible" });
  assert(await locator.isVisible());
}

async function expectCenteredIcons(root) {
  const geometry = await root.locator(".content-gate__scenario-icon-button").evaluateAll((buttons) =>
    buttons.flatMap((button) => {
      const icon = button.querySelector("svg");
      const buttonRect = button.getBoundingClientRect();
      const iconRect = icon?.getBoundingClientRect();
      if (!iconRect || buttonRect.width === 0 || buttonRect.height === 0) return [];
      const style = getComputedStyle(button);
      return [{
        label: button.getAttribute("aria-label"),
        width: buttonRect.width,
        height: buttonRect.height,
        padding: style.padding,
        centerDeltaX: Math.abs(
          (buttonRect.left + buttonRect.width / 2) - (iconRect.left + iconRect.width / 2),
        ),
        centerDeltaY: Math.abs(
          (buttonRect.top + buttonRect.height / 2) - (iconRect.top + iconRect.height / 2),
        ),
      }];
    }),
  );
  assert(geometry.length > 0, "no visible scenario icon buttons found");
  for (const icon of geometry) {
    assert.equal(icon.width, 38, `${icon.label} button width`);
    assert.equal(icon.height, 38, `${icon.label} button height`);
    assert.equal(icon.padding, "0px", `${icon.label} button padding`);
    assert(icon.centerDeltaX <= 0.5, `${icon.label} is horizontally off-center: ${JSON.stringify(icon)}`);
    assert(icon.centerDeltaY <= 0.5, `${icon.label} is vertically off-center: ${JSON.stringify(icon)}`);
  }
}
