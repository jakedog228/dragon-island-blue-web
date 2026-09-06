// Opt-in machine-task acceptance check. Start the lab with --task first.
// The controlled port browser is already muted by the lab; this dashboard browser is muted too.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_FIDELITY_LAB_URL ?? "http://127.0.0.1:4317";
const output = path.resolve(import.meta.dirname, "../../../../output/fidelity-lab/task-browser");
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
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text());
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: "Fidelity Lab" }).waitFor();
  const title = await page.locator("#task-title").textContent();
  assert(title && title !== "No machine task loaded", "lab did not expose the loaded task");
  await page.getByRole("button", { name: "Run loaded task" }).click();
  const deadline = Date.now() + 180_000;
  let status;
  while (Date.now() < deadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    if (["passed", "failed"].includes(status.task?.lastResult?.status)) break;
    await page.waitForTimeout(250);
  }
  assert(status?.task?.lastResult, "task did not finish within 180 seconds");
  await page.screenshot({ path: path.join(output, `${status.task.loaded.id}.png`), fullPage: true });
  fs.writeFileSync(
    path.join(output, `${status.task.loaded.id}-status.json`),
    `${JSON.stringify(status, null, 2)}\n`,
  );
  assert.equal(status.task.lastResult.status, "passed", status.task.lastResult.error);
  assert.deepEqual(errors, []);
  console.log(`fidelity-lab-task ${status.task.loaded.id}: PASS`);
} finally {
  await browser.close();
}
