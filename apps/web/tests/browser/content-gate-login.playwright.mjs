


import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/content-gate-login");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
fs.mkdirSync(outputDirectory, { recursive: true });

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const username = `Gate${Date.now().toString().slice(-10)}`;






const retryBudgetMs = Number(process.env.DIB_REGISTRATION_RETRY_BUDGET_MS ?? 330_000);
const registerAccount = async () => {
  const attempts = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(`${gameUrl}/api/game/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: "game-protocol-v1",
        username,
        publicScoreboard: false,
      }),
    });
    const body = await response.json();
    if (response.status === 201) return body;
    attempts.push(`${response.status} ${JSON.stringify(body)}`);
    if (attempt > 0 || response.status !== 429 || body?.retryable !== true) break;
    // `Retry-After` is whole seconds until the bucket holds a token again.
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitMs = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 300) * 1000;
    if (waitMs > retryBudgetMs) break;
    console.log(`content-gate-login: registration throttled, retrying once in ${waitMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitMs + 1_000));
  }
  assert.fail(
    "account setup never returned 201. Give this scenario its own authority process and a " +
      "fresh DIB_GAME_DATA_DIR -- the registration bucket is per process and per client " +
      `address, and \`account-registration\` deliberately drains it. attempts=${JSON.stringify(attempts)}`,
  );
};
const accountBody = await registerAccount();
const loginToken = accountBody.loginToken;
assert.equal(typeof loginToken, "string", "account setup omitted its one-time login token");

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const sessionRequests = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/game/session") sessionRequests.push(request);
  });

  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  const gate = page.locator(".content-gate");
  const storage = page.locator(".content-gate__save-mode");
  const rights = page.locator(".content-gate__rights input");
  // The ordered gate keeps the finish action `display: none` until it is actionable (this file
  // asserts exactly that below, as `futureFinishDisplay`), so a role locator cannot see the button
  // in the states where its DISABLED-ness is the thing under test. Address the element itself and
  // check the label where the flow expects it to read "Play Online".
  const play = page.locator(".content-gate__finish > button");
  const login = page.getByRole("button", { name: "Log in", exact: true });
  const loginStatus = page.locator(".content-gate__login-status");

  assert(
    await storage.evaluate((element) => element.disabled),
    "storage choices were active before an archive was selected",
  );
  const initialLayout = await gate.evaluate((element) => {
    const card = element.querySelector(".content-gate__card");
    const archiveStep = element.querySelector('[data-gate-section="archive"]');
    const storageStep = element.querySelector('[data-gate-section="storage"]');
    const finishStep = element.querySelector('[data-gate-section="finish"]');
    const futureMode = element.querySelector(".content-gate__save-mode-row");
    const futureFinish = element.querySelector(".content-gate__finish > button");
    if (!(card instanceof HTMLElement) || !(archiveStep instanceof HTMLElement) ||
        !(storageStep instanceof HTMLElement) || !(finishStep instanceof HTMLElement) ||
        !(futureMode instanceof HTMLElement) || !(futureFinish instanceof HTMLElement)) {
      throw new Error("the ordered content gate is missing a required step");
    }
    return {
      overflowY: getComputedStyle(element).overflowY,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      scrollbarColor: getComputedStyle(document.documentElement).scrollbarColor,
      cardWidth: card.getBoundingClientRect().width,
      cardTop: card.getBoundingClientRect().top,
      gateTop: element.getBoundingClientRect().top,
      archiveTop: archiveStep.getBoundingClientRect().top,
      storageTop: storageStep.getBoundingClientRect().top,
      finishTop: finishStep.getBoundingClientRect().top,
      futureModeDisplay: getComputedStyle(futureMode).display,
      futureFinishDisplay: getComputedStyle(futureFinish).display,
    };
  });
  assert.equal(initialLayout.overflowY, "auto", "the content gate lost its constrained fallback");
  assert(
    initialLayout.scrollHeight === initialLayout.clientHeight &&
      initialLayout.cardTop >= initialLayout.gateTop,
    `the main content gate does not fit its viewport: ${JSON.stringify(initialLayout)}`,
  );
  assert.match(initialLayout.colorScheme, /dark/, "native controls are not using the dark theme");
  assert.notEqual(initialLayout.scrollbarColor, "auto", "fallback scrollbars are not dark-themed");
  assert(
    initialLayout.cardWidth <= 680,
    `the ordered gate became a wide layout: ${JSON.stringify(initialLayout)}`,
  );
  assert(
    initialLayout.archiveTop < initialLayout.storageTop &&
      initialLayout.storageTop < initialLayout.finishTop,
    `the gate prompts are not vertically ordered: ${JSON.stringify(initialLayout)}`,
  );
  assert.equal(
    initialLayout.futureModeDisplay,
    "none",
    "future play modes expanded before archive selection",
  );
  assert.equal(
    initialLayout.futureFinishDisplay,
    "none",
    "future attestation expanded before it was actionable",
  );

  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  assert(
    !(await storage.evaluate((element) => element.disabled)),
    "archive selection did not unlock play/storage choices",
  );
  assert.notEqual(
    await storage.locator(".content-gate__save-mode-row").first().evaluate((element) =>
      getComputedStyle(element).display),
    "none",
    "archive selection did not reveal the next ordered prompt",
  );
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  assert(await login.isDisabled(), "Log in enabled before a plausible token was entered");
  assert(await rights.isDisabled(), "usage-rights confirmation enabled before Online login");
  assert(await play.isDisabled(), "Play Online enabled before Online login");

  await page.getByLabel("Login token").fill(loginToken);
  assert(await login.isEnabled(), "Log in stayed disabled after archive and token were ready");
  await login.click();
  await page.locator(".content-gate__login-status--success").waitFor({ timeout: 30_000 });
  assert.equal(
    (await loginStatus.textContent())?.trim(),
    `Logged in as ${username}.`,
    "successful login did not identify the authenticated account",
  );
  assert(await rights.isEnabled(), "successful login did not unlock usage-rights confirmation");
  // A successful fetch-driven login hides the submitted password form. That is the explicit
  // password-manager success signal in contentGate.ts; the token is no longer a user-editable
  // surface until the archive binding is revoked below.
  assert(
    await page.locator("#official-login-form").isHidden(),
    "successful Online login retained the submitted password form",
  );
  await rights.check();
  assert(await play.isEnabled(), "the completed Online flow did not enable Play Online");
  assert.equal(
    (await play.textContent())?.trim(),
    "Play Online",
    "the completed Online flow did not label its finish action for Online play",
  );
  assert.equal(sessionRequests.length, 1, "login was not one request per explicit authentication");

  const readyLayout = await gate.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  assert.equal(
    readyLayout.scrollHeight,
    readyLayout.clientHeight,
    `the completed Online gate does not fit its viewport: ${JSON.stringify(readyLayout)}`,
  );
  await page.screenshot({
    path: path.join(outputDirectory, "online-ready.png"),
    timeout: 120_000,
  });

  // The attestation names the selected archive. Replacing that File must revoke both the
  // authenticated package binding and the affirmative rights choice, even when the replacement
  // happens to have the same bytes and filename.
  await page.locator('input[name="asset-archive"]').setInputFiles([]);
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  assert(!(await rights.isChecked()), "archive replacement retained the previous rights attestation");
  assert(await rights.isDisabled(), "archive replacement retained the previous authenticated binding");
  assert(await play.isDisabled(), "archive replacement left Online play enabled");
  assert(
    !(await loginStatus.getAttribute("class"))?.includes("content-gate__login-status--success"),
    "archive replacement left the previous login marked valid",
  );
  await page.screenshot({
    path: path.join(outputDirectory, "archive-replacement-reset.png"),
    timeout: 120_000,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  process.stdout.write(JSON.stringify({ username, sessionRequests: sessionRequests.length }, null, 2));
} finally {
  await browser.close();
}
