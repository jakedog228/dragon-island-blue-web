// Dashboard-first setup acceptance check. Start the launcher with --no-open first.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_FIDELITY_LAB_URL ?? "http://127.0.0.1:4317";
const output = path.resolve(import.meta.dirname, "../../../../output/fidelity-lab/launcher-smoke");
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: process.env.DIB_HEADED !== "1",
  args: ["--enable-unsafe-swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "What do you want to compare?" }).waitFor();
  assert.equal(await page.locator("#wait-for-viewer-sync").isChecked(), false,
    "wait viewer should be optional and off by default");
  assert(await page.getByText(/Hold the faster web panel until TouchHLE's matching framebuffer is ready/).isVisible());
  assert(await page.getByText("TouchHLE ready").isVisible());
  assert((await page.locator("#archive-choice option").count()) > 0);
  assert((await page.locator("#save-choice option").count()) > 0);
  await page.getByText("Automated task", { exact: true }).click();
  await page.locator("#task-step").waitFor();
  assert(await page.locator("#task-preview h3").isVisible());
  assert(await page.getByText(/Matched save ready/).isVisible());
  await page.screenshot({ path: path.join(output, "setup-task.png"), fullPage: true });
  await page.getByText("Live comparison", { exact: true }).click();
  assert(await page.locator("#task-step").evaluate((element) => element.classList.contains("hidden")));
  await page.locator("#wait-for-viewer-sync").check();
  assert.match(await page.locator("#launch-summary").textContent(), /advances both panels together/);
  await page.screenshot({ path: path.join(output, "setup-live.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("fidelity-lab-launcher: PASS");
} finally {
  await browser.close();
}
