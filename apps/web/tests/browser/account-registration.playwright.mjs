



import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { stageGeometry } from "./stageGeometry.mjs";
import { createFrameCapture } from "./captureFrame.mjs";
import { tapPixiLabel } from "./pixiInput.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:5173";
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:8788";
const username = process.env.DIB_TEST_ACCOUNT_USERNAME ?? "ScoreTester";
const archive = path.resolve(
  process.env.DIB_CONTENT_ARCHIVE ??
    path.join(repositoryRoot, "Dragon_Island_Blue_1.1.0.ipa"),
);
const outputDirectory = path.join(repositoryRoot, "output/account-registration");
assert(fs.existsSync(archive), `Missing operator-owned archive: ${archive}`);
fs.mkdirSync(outputDirectory, { recursive: true });

const readiness = await fetch(`${gameUrl}/api/game/readiness`).then((response) => response.json());
assert.equal(readiness.ready, true, `game server is not ready: ${JSON.stringify(readiness)}`);
const logicPackId = readiness.installedLogicPackIds[0];

const registration = await fetch(`${gameUrl}/api/game/registration`).then((r) => r.json());
assert.equal(registration.enabled, true, "registration is disabled; this scenario needs it on");

/** Reads the account straight from the authority, bypassing the client's cached copy. */
const readAccountFromServer = async (loginToken) => {
  const session = await fetch(`${gameUrl}/api/game/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: "game-protocol-v1",
      loginToken,
      logicPackId,
      supportedEventVersions: ["presentation-events-v1"],
    }),
  });
  // Read the body once: `assert.equal`'s message argument is eager, so `await response.text()`
  // inside it consumes the stream even when the assertion passes.
  const sessionBody = await session.text();
  assert.equal(session.status, 200, `session refused the minted token: ${sessionBody}`);
  const opened = JSON.parse(sessionBody);
  const account = await fetch(`${gameUrl}/api/game/account`, {
    headers: { Authorization: `Bearer ${opened.token}` },
  });
  const accountBody = await account.text();
  assert.equal(account.status, 200, `GET /api/game/account failed: ${accountBody}`);
  return { sessionAccount: opened.account, account: JSON.parse(accountBody).account };
};

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(
    ["clipboard-read", "clipboard-write"],
    { origin: new URL(webUrl).origin },
  );
  const page = await context.newPage();
  const captureFrame = await createFrameCapture(page, outputDirectory);
  const errors = [];
  const gameRequests = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  // The throttle phase deliberately provokes a 429, and Chromium logs every 4xx fetch as a console
  // error. Suppress that one by its originating URL only — a 429 from anywhere else still fails.
  let throttleConsoleErrors = 0;
  const expectedNetworkError = (message) => {
    if (!message.text().includes("429")) return false;
    if (!(message.location()?.url ?? "").endsWith("/api/game/accounts")) return false;
    throttleConsoleErrors += 1;
    return true;
  };
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("favicon") &&
      !expectedNetworkError(message)
    ) {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    if (!request.url().includes("/api/game/")) return;
    gameRequests.push({ path: new URL(request.url()).pathname, method: request.method() });
  });
  await page.addInitScript(() => {
    window.advanceTime = () => Promise.resolve();
    // Stubbing advanceTime marks this a deterministic harness, which otherwise boots the sampled
    // demo battle instead of the world; the world flow is where the Options row lives.
    window.__DIB_TEST_WORLD_DEMO__ = true;
    localStorage.setItem("dib.portSettings.v1", JSON.stringify({
      displayMode: "iphone",
      textResolutionMode: "modern",
      sound: 0,
      music: 0,
    }));
  });

  // ---------------------------------------------------------------- gate: create a login token
  await page.goto(webUrl, { waitUntil: "domcontentloaded" });
  // Wait on the FIRST ordered prompt. The ordered gate reveals the play-mode row only after an
  // archive is chosen, so waiting for a mode radio to be visible here waits for a step this
  // scenario has not reached yet.
  await page.locator('input[name="asset-archive"]').waitFor({ state: "visible" });
  const gateLayout = await page.locator(".content-gate").evaluate((gate) => {
    const card = gate.querySelector(".content-gate__card");
    if (!(card instanceof HTMLElement)) throw new Error("content gate card is missing");
    return {
      overflowY: getComputedStyle(gate).overflowY,
      gateTop: gate.getBoundingClientRect().top,
      cardTop: card.getBoundingClientRect().top,
      clientHeight: gate.clientHeight,
      scrollHeight: gate.scrollHeight,
    };
  });
  assert.equal(gateLayout.overflowY, "auto", "the gate lost its constrained fallback");
  assert(
    gateLayout.cardTop >= gateLayout.gateTop && gateLayout.scrollHeight === gateLayout.clientHeight,
    `the main content gate does not fit its viewport: ${JSON.stringify(gateLayout)}`,
  );
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  const orderedGate = await page.evaluate(() => ({
    selectedFiles: document.querySelector('input[name="asset-archive"]')?.files?.length ?? 0,
    storageDisabled: document.querySelector(".content-gate__save-mode")?.disabled,
  }));
  assert.deepEqual(
    orderedGate,
    { selectedFiles: 1, storageDisabled: false },
    `archive selection did not unlock the next form group: ${JSON.stringify(orderedGate)}`,
  );

  const registerBlock = page.locator(".content-gate__register");
  assert(
    await registerBlock.isHidden(),
    "offline gate exposed account creation before Online was selected",
  );
  assert(
    !gameRequests.some((request) => request.path === "/api/game/registration"),
    "the registration probe fired before the player asked for Online play",
  );

  await page.getByLabel("Online (Beta)", { exact: true }).check();
  assert(
    await page.locator(".content-gate__rights input").isDisabled(),
    "usage-rights confirmation was enabled before Online login",
  );
  const loginCredentialContract = await page.locator("#official-login-form").evaluate((form) => {
    const usernameInput = form.querySelector('input[name="username"]');
    const passwordInput = form.querySelector('input[name="password"]');
    const submitButton = form.querySelector('button[type="submit"]');
    if (!(form instanceof HTMLFormElement) || !(usernameInput instanceof HTMLInputElement) ||
        !(passwordInput instanceof HTMLInputElement) || !(submitButton instanceof HTMLButtonElement)) {
      throw new Error("Online login is not a conventional credential form");
    }
    return {
      method: form.method,
      action: new URL(form.action).pathname,
      autocomplete: form.autocomplete,
      username: {
        id: usernameInput.id,
        type: usernameInput.type,
        autocomplete: usernameInput.autocomplete,
      },
      password: {
        id: passwordInput.id,
        type: passwordInput.type,
        autocomplete: passwordInput.autocomplete,
        required: passwordInput.required,
      },
      submitType: submitButton.type,
    };
  });
  assert.deepEqual(loginCredentialContract, {
    method: "post",
    action: "/api/game/session",
    autocomplete: "on",
    username: {
      id: "official-login-username",
      type: "text",
      autocomplete: "username",
    },
    password: {
      id: "official-login-token",
      type: "password",
      autocomplete: "current-password",
      required: true,
    },
    submitType: "submit",
  }, `login password-manager contract drifted: ${JSON.stringify(loginCredentialContract)}`);
  const registerOpen = registerBlock.getByRole("button", { name: "Create account" });
  await registerOpen.waitFor({ state: "visible", timeout: 30_000 });
  await captureFrame("gate-register-affordance.png", { fullPage: true });

  await registerOpen.click();
  // Not filtered by text: the reveal replaces the dialog body, so any content filter stops matching
  // exactly when the token appears. Only one gate dialog is ever mounted at a time.
  const dialog = page.locator("dialog.content-gate__storage-dialog");
  await dialog.waitFor({ state: "visible" });
  const registrationCredentialContract = await dialog
    .locator("#official-account-registration-form")
    .evaluate((form) => {
      const usernameInput = form.querySelector('input[name="username"]');
      const submitButton = form.querySelector('button[type="submit"]');
      if (!(form instanceof HTMLFormElement) || !(usernameInput instanceof HTMLInputElement) ||
          !(submitButton instanceof HTMLButtonElement)) {
        throw new Error("Account creation is not a conventional registration form");
      }
      return {
        method: form.method,
        action: new URL(form.action).pathname,
        autocomplete: form.autocomplete,
        usernameId: usernameInput.id,
        usernameAutocomplete: usernameInput.autocomplete,
        usernameRequired: usernameInput.required,
        submitType: submitButton.type,
      };
    });
  assert.deepEqual(registrationCredentialContract, {
    method: "post",
    action: "/api/game/accounts",
    autocomplete: "on",
    usernameId: "official-account-username",
    usernameAutocomplete: "username",
    usernameRequired: true,
    submitType: "submit",
  }, `registration password-manager contract drifted: ${JSON.stringify(registrationCredentialContract)}`);
  const submit = dialog.locator(".content-gate__register-submit");
  assert(await submit.isDisabled(), "Create token was enabled before a username was typed");
  await dialog.locator('input[name="username"]').fill("a");
  assert(
    await submit.isDisabled(),
    `Create token accepted a name under ${registration.usernameMinLength} characters`,
  );
  await dialog.locator('input[name="username"]').fill(username);
  await dialog.locator('input[name="publicScoreboard"]').check();
  await captureFrame("register-dialog.png", { fullPage: true });

  // Hold the one-time-token request at the browser boundary. A successful server commit cannot
  // be undone, so every dismissal path must stay blocked until the response has been revealed.
  let acknowledgeCreateRequest;
  const createRequestSeen = new Promise((resolve) => {
    acknowledgeCreateRequest = resolve;
  });
  let releaseCreateRequest;
  const createRequestRelease = new Promise((resolve) => {
    releaseCreateRequest = resolve;
  });
  const holdCreateRequest = async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    acknowledgeCreateRequest();
    await createRequestRelease;
    await route.continue();
  };
  await page.route("**/api/game/accounts", holdCreateRequest);
  await submit.click();
  await createRequestSeen;
  assert(
    await dialog.getByRole("button", { name: "Close account creation" }).isDisabled(),
    "the one-time-token dialog close button stayed active during account creation",
  );
  assert(
    await dialog.getByRole("button", { name: "Cancel" }).isDisabled(),
    "the one-time-token dialog cancel button stayed active during account creation",
  );
  await page.keyboard.press("Escape");
  assert(await dialog.isVisible(), "Escape discarded an in-flight one-time token response");
  releaseCreateRequest();

  const revealed = dialog.locator(".content-gate__register-token code");
  await revealed.waitFor({ state: "visible", timeout: 30_000 });
  await page.unroute("**/api/game/accounts", holdCreateRequest);
  const loginToken = (await revealed.textContent())?.trim() ?? "";
  assert(loginToken.length >= 16, `revealed login token is too short: ${JSON.stringify(loginToken)}`);
  assert.equal(
    await dialog.locator('input[name="username"]').count(),
    0,
    "the reveal left the creation form mounted; a second Create could burn the rate-limit window",
  );
  assert(
    (await dialog.locator(".content-gate__register-warning").textContent())?.includes(username),
    "the one-time reveal did not name the account the token plays as",
  );
  assert.equal(
    await page.locator('#official-login-token').inputValue(),
    "",
    "account creation bypassed the user-entered login that password managers observe",
  );
  assert.equal(
    await page.locator('#official-login-username').inputValue(),
    username,
    "the login form did not retain the new credential's username association",
  );
  await captureFrame("register-token-reveal.png", { fullPage: true });
  await dialog.getByRole("button", { name: "Copy" }).click();
  await dialog.getByText("Token copied to the clipboard.").waitFor();
  await dialog.getByRole("button", { name: "Continue to login" }).click();
  await dialog.waitFor({ state: "detached" });
  const loginTokenInput = page.locator("#official-login-token");
  assert(await loginTokenInput.evaluate((input) => input === document.activeElement),
    "account creation did not hand focus to the login-token field");
  await loginTokenInput.press("Control+V");
  assert.equal(
    await loginTokenInput.inputValue(),
    loginToken,
    "the copied token was not pasted into the password-manager-visible login field",
  );
  await page.locator("#official-login-form").getByRole("button", { name: "Log in" }).click();
  await page.waitForFunction(() => {
    const status = document.querySelector(".content-gate__login-status");
    return status?.classList.contains("content-gate__login-status--success") ||
      status?.classList.contains("content-gate__login-status--error");
  }, undefined, { timeout: 30_000 });
  const createdLoginState = await page.locator(".content-gate__login-status").evaluate((status) => ({
    className: status.className,
    text: status.textContent,
  }));
  assert(
    createdLoginState.className.includes("content-gate__login-status--success"),
    `account creation did not authenticate the new token: ${JSON.stringify(createdLoginState)}`,
  );
  assert(
    (await page.locator(".content-gate__login-status").textContent())?.includes(username),
    "account creation did not finish in a named logged-in state",
  );
  assert(
    await page.locator("#official-login-form").isHidden(),
    "successful AJAX login did not hide the submitted credential form",
  );
  assert(
    await page.locator(".content-gate__rights input").isEnabled(),
    "usage-rights confirmation stayed blocked after Online login",
  );
  await captureFrame("gate-logged-in.png", { fullPage: true });

  const minted = await readAccountFromServer(loginToken);
  assert.deepEqual(
    { username: minted.account.username, publicScoreboard: minted.account.publicScoreboard },
    { username, publicScoreboard: true },
    `the authority did not store what the dialog collected: ${JSON.stringify(minted.account)}`,
  );
  assert.equal(
    minted.sessionAccount?.username,
    username,
    "the session response did not carry the account",
  );

  // ------------------------------------------------------------------- gate: the 5-minute throttle
  await page.getByLabel("Offline", { exact: true }).check();
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await registerOpen.waitFor({ state: "visible" });
  await registerOpen.click();
  const throttled = page.locator("dialog.content-gate__storage-dialog");
  await throttled.waitFor({ state: "visible" });
  await throttled.locator('input[name="username"]').fill(`${username}Two`);
  await throttled.locator(".content-gate__register-submit").click();
  const throttleStatus = throttled.locator(".content-gate__backup-status--error");
  await throttleStatus.waitFor({ state: "visible", timeout: 30_000 });
  const throttleText = (await throttleStatus.textContent()) ?? "";
  assert(
    /too many|retry|rate/i.test(throttleText),
    `second registration inside five minutes did not report a throttle: ${throttleText}`,
  );
  assert.equal(
    await throttled.locator(".content-gate__register-token").count(),
    0,
    "a throttled registration still revealed a token",
  );
  await captureFrame("register-throttled.png", { fullPage: true });
  await throttled.getByRole("button", { name: "Cancel" }).click();
  await throttled.waitFor({ state: "detached" });
  await page.locator("#official-login-form").getByRole("button", { name: "Log in" }).click();
  await page.locator(".content-gate__login-status--success").waitFor({ timeout: 30_000 });

  // ------------------------------------------------------------------------- into the world
  const state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));
  const advance = async (ms) => {
    await page.evaluate((value) => window.advanceTime(value), ms);
    await page.waitForTimeout(2);
  };
  const waitFor = async (predicate, description, frames = 1600) => {
    for (let index = 0; index < frames; index++) {
      const snapshot = await state();
      if (await predicate(snapshot)) return snapshot;
      await advance(25);
    }
    throw new Error(
      `${description}; state=${JSON.stringify(await state())}; errors=${errors.join(" | ")}`,
    );
  };
  const pixiCenter = (label) => page.evaluate((wanted) => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node?.label === wanted && node.visible && node.renderable) {
        const bounds = node.getBounds();
        return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  }, label);
  // Emitting on the row node reaches nothing: a source PopupMenu owns one `menuItems` list,
  // so this port keeps rows inert and routes the tap through the menu that owns them.
  // `tapPixiLabel` delivers to that owner and reports its label, so a missing control still
  // throws rather than passing silently.
  const activatePixiControl = async (label) => (await tapPixiLabel(page, label)) !== undefined;
  const clickStagePoint = async (point) => {
    const box = await page.locator("canvas").first().boundingBox();
    assert(box, "canvas disappeared before stage click");
    await page.mouse.click(box.x + point.x, box.y + point.y);
  };

  /** Title -> slot-1. Returns the settled world/town snapshot. */
  const enterSlotOne = async () => {
    await waitFor(
      (value) => value.mode === "start" && value.startup?.phase === "title",
      "official content did not reach the source title",
    );
    await page.keyboard.press("Enter");
    let snapshot = await waitFor(
      (value) => value.startup?.phase === "save-select" || value.startup?.phase === "new-game-plot",
      "title did not begin slot selection",
    );
    if (snapshot.startup.phase === "save-select") {
      assert(
        await activatePixiControl("sourcePopupButton:options"),
        "save-select menu omitted Options",
      );
      await waitFor(
        (value) => value.startup?.phase === "options",
        "save-select Options did not open",
      );
      const coveredMenu = await page.evaluate(() => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length) {
          const node = stack.pop();
          if (node?.label === "sourceMainMenuPopup") {
            return { visible: node.visible, eventMode: node.eventMode };
          }
          stack.push(...(node?.children ?? []));
        }
        return null;
      });
      assert.deepEqual(
        coveredMenu,
        { visible: false, eventMode: "none" },
        "save-select menu remained rendered or interactive underneath Options",
      );
      await advance(17);
      await captureFrame("startup-options-scoreboard.png", { fullPage: true });
      assert(await activatePixiControl("popupButton:Ok"), "startup Options omitted its OK button");
      snapshot = await waitFor(
        (value) => value.startup?.phase === "save-select" &&
          Array.isArray(value.startup.menu?.buttons),
        "closing startup Options did not restore save-select",
      );
      const restoredMenu = await page.evaluate(() => {
        const stack = [window.__PIXI_APP__.stage];
        while (stack.length) {
          const node = stack.pop();
          if (node?.label === "sourceMainMenuPopup") {
            return { visible: node.visible, eventMode: node.eventMode };
          }
          stack.push(...(node?.children ?? []));
        }
        return null;
      });
      assert.deepEqual(
        restoredMenu,
        { visible: true, eventMode: "static" },
        "closing startup Options did not restore the save-select menu",
      );
      const canvasBox = await page.locator("canvas").first().boundingBox();
      assert(canvasBox, "client has no canvas");
      const geometry = await stageGeometry(page, canvasBox);
      const slot = snapshot.startup.menu.buttons.find((button) => button.id === "slot-1");
      assert(slot?.enabled, `authoritative slot is unavailable: ${JSON.stringify(snapshot.startup)}`);
      await advance(500);
      const point = geometry.toCss({ x: slot.x + slot.w / 2, y: slot.y + slot.h / 2 });
      await page.mouse.click(point.x, point.y);
      snapshot = await state();
    }
    return snapshot;
  };

  await page.locator(".content-gate__rights input").check();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();
  let snapshot = await enterSlotOne();
  if (snapshot.startup?.phase !== undefined) {
    snapshot = await waitFor(
      (value) => value.startup?.phase === "new-game-plot",
      "empty Official slot skipped the introductory plot",
    );
    await advance(Math.max(50, snapshot.startup.intro.scrollMs - 100));
    await page.keyboard.press("Enter");
    await waitFor(
      (value) => value.startup?.phase === "pick-dragon",
      "introductory plot did not open the starter picker",
    );
    await page.keyboard.press("1");
    snapshot = await waitFor(
      (value) => value.mode === "town" && value.overlay?.kind === "townEnterChat",
      "fresh Official slot did not present the Corova intro chat",
    );
    for (let index = 0; snapshot.overlay?.kind === "townEnterChat" && index < 20; index++) {
      await advance(550);
      await waitFor(
        async () => (await pixiCenter("guildQuestChat")) !== null,
        "initial Corova story chat visual was not mounted",
      );
      const chat = await pixiCenter("guildQuestChat");
      assert(chat, "initial Corova story chat was not mounted");
      await clickStagePoint(chat);
      await advance(25);
      snapshot = await state();
    }
    await waitFor((value) => value.overlay === null, "initial Corova story chat did not finish");
    await waitFor(
      (value) => value.town?.dayNotification?.visible !== true && !value.locked,
      "initial Corova presentation did not release town input",
    );
    for (let index = 0; index < 8 && (await state()).tutorial !== undefined; index++) {
      const tutorialState = await waitFor(
        (value) => value.tutorial === undefined || value.tutorial.okReady === true,
        "town tutorial did not become dismissible",
      );
      if (tutorialState.tutorial === undefined) break;
      await page.keyboard.press("Enter");
      await advance(25);
    }
    const exit = await pixiCenter("town:First_City:exit");
    assert(exit, "town exit was not mounted");
    await clickStagePoint(exit);
    snapshot = await waitFor((value) => value.mode === "world" && !value.locked, "town did not exit");
    if (snapshot.tutorial?.key === "Tutorial2") {
      await waitFor(
        (value) => value.tutorial?.key === "Tutorial2" && value.tutorial.okReady,
        "field tutorial did not become dismissible",
      );
      await page.keyboard.press("Enter");
      await waitFor(
        (value) => value.mode === "world" && value.tutorial === undefined,
        "field tutorial did not release world input",
      );
    }
  }
  await waitFor((value) => value.mode === "world" && !value.locked, "client did not settle in the world");

  // ----------------------------------------------------------- world menu -> Options -> Scoreboard
  const openOptions = async () => {
    assert(await activatePixiControl("worldMenuButton"), "world menu button was not mounted");
    await waitFor((value) => value.menu?.config === "MasterMenu", "world menu did not open");
    assert(await activatePixiControl("worldMenu:options"), "world menu omitted Options");
    return waitFor(
      (value) => value.overlay?.open === true && Array.isArray(value.overlay.rows),
      "Options popup did not open",
    );
  };

  snapshot = await openOptions();
  const rowNames = snapshot.overlay.rows.map((row) => row.name);
  assert.deepEqual(
    rowNames,
    ["music", "sound", "display", "text", "scoreboard"],
    `Options did not append the Scoreboard row after Text: ${JSON.stringify(rowNames)}`,
  );
  assert.equal(
    snapshot.overlay.scoreboard,
    "public",
    "Scoreboard row did not reflect the opt-in chosen at registration",
  );
  await captureFrame("options-scoreboard-public.png", { fullPage: true });

  // The row label shares a fixed-width column with the source audio rows, so an over-long word
  // prints straight through the first choice instead of wrapping or pushing it aside. Only the
  // renderer can catch that: `debugState()` reports the row either way.
  const rowLabelBox = await page.evaluate(() => {
    const stack = [window.__PIXI_APP__.stage];
    while (stack.length) {
      const node = stack.pop();
      if (node?.label === "portOptionsContent" && node.visible) {
        const choice = node.children
          .flatMap((child) => child.children ?? [])
          .find((child) => child.label === "optionsChoice:scoreboard:public");
        // The row's own label is the text node immediately preceding its controls container.
        const controls = node.children.find((child) => (child.children ?? []).includes(choice));
        const label = node.children[node.children.indexOf(controls) - 1];
        if (choice === undefined || label === undefined) return null;
        return { labelRight: label.getBounds().right, choiceLeft: choice.getBounds().left };
      }
      stack.push(...(node?.children ?? []));
    }
    return null;
  });
  assert(rowLabelBox, "could not measure the Scoreboard row against its first choice");
  assert(
    rowLabelBox.labelRight <= rowLabelBox.choiceLeft,
    `the Scoreboard row label overlaps its first choice: ${JSON.stringify(rowLabelBox)}`,
  );

  assert(
    await activatePixiControl("optionsChoice:scoreboard:private"),
    "Scoreboard row omitted the Private choice",
  );
  snapshot = await waitFor(
    (value) => value.overlay?.scoreboard === "private",
    "tapping Private did not repaint the Scoreboard row",
    200,
  );
  await captureFrame("options-scoreboard-private.png", { fullPage: true });
  assert.equal(
    snapshot.overlay.settings.displayMode,
    "iphone",
    "the Scoreboard write disturbed local port settings",
  );

  const afterFlip = await readAccountFromServer(loginToken);
  assert.equal(
    afterFlip.account.publicScoreboard,
    false,
    "the Options row did not persist the scoreboard flag server-side",
  );
  assert.equal(afterFlip.account.username, username, "the settings write mutated the username");

  // Close and reopen inside the same session: the row reads the gateway, not a stale copy.
  assert(await activatePixiControl("popupButton:Ok"), "Options popup omitted its OK button");
  await waitFor(
    (value) => value.mode === "world" && value.overlay === null && value.menu === null,
    "Options popup did not close",
    300,
  );
  snapshot = await openOptions();
  assert.equal(
    snapshot.overlay.scoreboard,
    "private",
    "reopening Options lost the new scoreboard value",
  );
  assert(await activatePixiControl("popupButton:Ok"), "Options popup omitted its OK button");
  await waitFor(
    (value) => value.mode === "world" && value.overlay === null && value.menu === null,
    "Options popup did not close before reload",
    300,
  );

  // ------------------------------------------------- a fresh client paints it from the authority
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('input[name="asset-archive"]').setInputFiles(archive);
  await page.getByLabel("Online (Beta)", { exact: true }).check();
  await page.locator('#official-login-token').fill(loginToken);
  assert(
    await page.locator(".content-gate__rights input").isDisabled(),
    "reloaded gate enabled completion before validating the token",
  );
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.locator(".content-gate__login-status--success").waitFor({ timeout: 30_000 });
  await page.locator(".content-gate__rights input").check();
  await page.getByRole("button", { name: "Play Online", exact: true }).click();
  await enterSlotOne();
  await waitFor(
    (value) => value.mode === "world" && !value.locked,
    "reloaded client did not resume in the world",
  );
  snapshot = await openOptions();
  assert.equal(
    snapshot.overlay.scoreboard,
    "private",
    "a reloaded client did not read the scoreboard flag back from the server",
  );
  await captureFrame("options-scoreboard-after-reload.png", { fullPage: true });

  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(
    throttleConsoleErrors,
    1,
    "the throttled registration never reached the network as a 429",
  );
  process.stdout.write(JSON.stringify({
    username,
    accountRoutes: [...new Set(
      gameRequests
        .filter((request) => request.path.includes("account") || request.path.includes("registration"))
        .map((request) => `${request.method} ${request.path}`),
    )],
    finalScoreboard: snapshot.overlay.scoreboard,
    serverAccount: afterFlip.account,
  }, null, 2));
} finally {
  await browser.close();
}
