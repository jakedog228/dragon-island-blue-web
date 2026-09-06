// Opt-in platform-shell contract. Start a strict Vite server, then run
// `pnpm scenario:fullscreen-shell`. Browser execution requires explicit authorization; Chromium
// is always muted. This fixture does not need a game-content archive.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const webUrl = process.env.DIB_WEB_URL ?? "http://localhost:5173";
const outputDirectory = path.resolve(import.meta.dirname, "../../../../output/fullscreen-shell");
fs.mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  headless: process.env.DIB_HEADED !== "1",
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--mute-audio"],
});

try {
  const iphone = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 Mobile/15E148 Brave/1.90",
  });
  const iphonePage = await iphone.newPage();
  const iphoneErrors = [];
  iphonePage.on("pageerror", (error) => iphoneErrors.push(`pageerror: ${String(error)}`));
  iphonePage.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      iphoneErrors.push(`console: ${message.text()}`);
    }
  });
  await iphonePage.addInitScript(() => {
    Object.defineProperty(Document.prototype, "fullscreenEnabled", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });
  });
  await iphonePage.goto(webUrl, { waitUntil: "domcontentloaded" });

  const manifest = await iphonePage.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]')?.href;
    if (!href) throw new Error("manifest link is missing");
    const response = await fetch(href);
    if (!response.ok) throw new Error(`manifest fetch failed: ${response.status}`);
    return response.json();
  });
  assert.equal(manifest.display, "fullscreen");
  assert.equal(manifest.orientation, "landscape");
  assert.deepEqual(manifest.icons, [
    { src: "./app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "./app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    {
      src: "./app-icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ]);

  await iphonePage.getByRole("button", { name: "Fullscreen" }).click();
  const dialog = iphonePage.locator("[data-fullscreen-guidance]");
  await dialog.waitFor({ state: "visible" });
  assert.match(await dialog.innerText(), /Add to Home Screen/);
  assert.match(await dialog.innerText(), /open this page in Safari/i);
  assert.match(await dialog.innerText(), /separate offline saves and settings/i);
  await iphonePage.screenshot({
    path: path.join(outputDirectory, "iphone-install-guidance.png"),
    fullPage: true,
  });
  await dialog.getByRole("button", { name: "Close" }).click();
  assert.deepEqual(iphoneErrors, []);
  await iphone.close();

  // Installed/Home Screen mode has no useful fullscreen action. More importantly, a portrait ->
  // landscape resize must use the new window geometry even if a mobile engine publishes viewport
  // measurements in stages. This shell-level case needs no archive; the archive-backed
  // `mobile-viewport` scenario below covers the Pixi host and renderer too.
  const installed = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 Mobile/15E148",
  });
  const installedPage = await installed.newPage();
  await installedPage.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "standalone", {
      configurable: true,
      get: () => true,
    });
  });
  await installedPage.goto(webUrl, { waitUntil: "domcontentloaded" });
  assert.equal(await installedPage.getByRole("button", { name: "Fullscreen" }).count(), 0);
  assert.equal(
    await installedPage.evaluate(() => document.documentElement.dataset.appViewportSource),
    "window",
  );
  await installedPage.setViewportSize({ width: 844, height: 390 });
  await installedPage.waitForFunction(() => {
    const bounds = document.getElementById("app")?.getBoundingClientRect();
    return bounds?.width === 844 && bounds.height === 390;
  });
  assert.deepEqual(await installedPage.evaluate(() => {
    const bounds = document.getElementById("app")?.getBoundingClientRect();
    return bounds && {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
    };
  }), { x: 0, y: 0, width: 844, height: 390, scrollWidth: 844, scrollHeight: 390 });
  await installedPage.screenshot({
    path: path.join(outputDirectory, "installed-landscape-shell.png"),
    fullPage: true,
  });
  await installed.close();

  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desktopPage = await desktop.newPage();
  const desktopErrors = [];
  desktopPage.on("pageerror", (error) => desktopErrors.push(`pageerror: ${String(error)}`));
  desktopPage.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      desktopErrors.push(`console: ${message.text()}`);
    }
  });
  await desktopPage.addInitScript(() => {
    Object.defineProperty(Document.prototype, "fullscreenEnabled", {
      configurable: true,
      get: () => true,
    });
    Object.defineProperty(Element.prototype, "requestFullscreen", {
      configurable: true,
      value: async function requestFullscreen() {
        globalThis.__DIB_FULLSCREEN_TARGET__ = this.tagName;
      },
    });
    Object.defineProperty(screen, "orientation", {
      configurable: true,
      value: {
        angle: 0,
        type: "landscape-primary",
        lock: async (orientation) => {
          globalThis.__DIB_ORIENTATION_LOCK__ = orientation;
        },
      },
    });
  });
  await desktopPage.goto(webUrl, { waitUntil: "domcontentloaded" });
  await desktopPage.getByRole("button", { name: "Fullscreen" }).click();
  await desktopPage.waitForFunction(() => globalThis.__DIB_FULLSCREEN_TARGET__ === "HTML");
  assert.deepEqual(await desktopPage.evaluate(() => ({
    target: globalThis.__DIB_FULLSCREEN_TARGET__,
    orientation: globalThis.__DIB_ORIENTATION_LOCK__,
  })), { target: "HTML", orientation: "landscape" });
  assert.equal(await desktopPage.locator("[data-fullscreen-guidance]").count(), 0);
  assert.deepEqual(desktopErrors, []);
  await desktop.close();

  console.log(JSON.stringify({
    manifest: "ok",
    iphoneGuidance: "ok",
    installedRotation: "ok",
    fullscreenApi: "ok",
  }, null, 2));
} finally {
  await browser.close();
}
