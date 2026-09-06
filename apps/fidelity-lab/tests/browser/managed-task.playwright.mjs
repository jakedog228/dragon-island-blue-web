// Full dashboard-first task workflow. It launches disposable native/web runtimes and keeps audio muted.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const url = process.env.DIB_FIDELITY_LAB_URL ?? "http://127.0.0.1:4317";
const output = path.resolve(import.meta.dirname, "../../../../output/fidelity-lab/managed-task-browser");
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
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.getByText("Automated task", { exact: true }).click();
  await page.locator("#task-choice").selectOption("load-saved-town");
  await page.locator("#content-rights").check();
  await page.getByRole("button", { name: "Start and run task" }).click();
  await Promise.race([
    page.waitForURL((current) => current.port !== new URL(url).port, { timeout: 150_000 }),
    page.locator("#setup-error:not(.hidden)").waitFor({ timeout: 150_000 }).then(async () => {
      throw new Error(`Dashboard setup failed: ${await page.locator("#setup-error").textContent()}`);
    }),
  ]);
  await page.getByRole("heading", { name: "Fidelity Lab" }).waitFor();
  let status;
  const streamDeadline = Date.now() + 30_000;
  while (Date.now() < streamDeadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    if (status.liveStreams?.native?.clients === 1 && status.liveStreams?.port?.clients === 1 &&
        status.liveStreams.native.frames > 0 && status.liveStreams.port.frames > 0) break;
    await page.waitForTimeout(100);
  }
  const initialStreamFrames = {
    native: status.liveStreams.native.frames,
    port: status.liveStreams.port.frames,
  };
  await page.waitForTimeout(1_500);
  status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
  assert.equal(status.portAudio, "muted", "automated tasks must mute controlled-port output");
  assert(status.liveStreams.native.frames - initialStreamFrames.native >= 30,
    "automated task native viewer fell below 20 fps");
  assert(status.liveStreams.port.frames - initialStreamFrames.port >= 15,
    "automated task port viewer fell below 10 fps");
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    status = await page.evaluate(() => fetch("/api/status").then((response) => response.json()));
    if (["passed", "failed"].includes(status.task?.lastResult?.status)) break;
    await page.waitForTimeout(250);
  }
  assert.equal(status?.task?.lastResult?.status, "passed", status?.task?.lastResult?.error);
  const taps = status.task.lastResult.steps.filter(({ kind }) => kind === "tap");
  assert.equal(taps.length, 2);
  for (const step of taps) {
    assert.equal(step.input?.synchronization?.state, "synced", `${step.id} was not clock-synchronized`);
    assert(step.input.synchronization.maxSkewMs <= 100,
      `${step.id} port/native schedule skew was ${step.input.synchronization.maxSkewMs}ms`);
    assert.deepEqual(step.input.synchronization.phases.map(({ phase }) => phase), ["down", "up"]);
  }
  await page.locator("#evidence-panel").waitFor();
  assert.equal(await page.locator("#evidence-gallery .evidence-card").count(), 1);
  assert.equal(await page.locator("#evidence-gallery img").count(), 2);
  await page.locator("#evidence-panel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "completed-task.png"), fullPage: true });
  fs.writeFileSync(path.join(output, "status.json"), `${JSON.stringify(status, null, 2)}\n`);
  assert.deepEqual(errors, []);
  console.log("fidelity-lab-managed-task: PASS");
} finally {
  await browser.close();
}
