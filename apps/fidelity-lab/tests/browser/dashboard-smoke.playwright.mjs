// Opt-in Fidelity Lab dashboard acceptance check. Start the lab first, then run this script.
// It never sends game input. Chromium is muted per repository browser policy.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_FIDELITY_LAB_URL ?? "http://127.0.0.1:4317";
const output = path.resolve(import.meta.dirname, "../../../../output/fidelity-lab/dashboard-smoke");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: process.env.DIB_HEADED !== "1",
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Fidelity Lab" }).waitFor();
  const comparison = page.locator("#comparison");
  assert.match(await comparison.getAttribute("class"), /side/);
  for (const mode of ["wipe", "overlay", "diff", "side"]) {
    await page.locator("#view-mode").selectOption(mode);
    await page.waitForTimeout(250);
    const className = await comparison.getAttribute("class");
    assert.match(className, new RegExp(mode === "side" ? "side" : mode));
  }
  await page.screenshot({ path: path.join(output, "dashboard.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("fidelity-lab-dashboard: PASS");
} finally {
  await browser.close();
}
