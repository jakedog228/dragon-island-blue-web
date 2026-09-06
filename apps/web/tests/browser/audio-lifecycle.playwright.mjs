// Opt-in browser adapter smoke test. Start a strict Vite server, then run:
// node apps/web/tests/browser/audio-lifecycle.playwright.mjs
// Uses a generated tone, no archive or autoplay-policy bypass. Synthetic visibility checks
// exercise our adapter; actual iPhone lock/background behavior still needs a device check.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--mute-audio"] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const origin = process.env.DIB_WEB_URL ?? "http://localhost:5173";
  // A fixture document avoids booting a second game while loading the real Vite audio module.
  await page.route("**/__audio_lifecycle_fixture__", (route) => route.fulfill({
    contentType: "text/html",
    body: '<button id="start">Start audio</button><button id="retry">Retry audio</button>',
  }));
  await page.goto(`${origin}/__audio_lifecycle_fixture__`);
  await page.evaluate(async () => {
    const { AudioPlayer } = await import("/src/audio.ts");
    const player = new AudioPlayer({ sound: 0.75, music: 0.5 });
    player.installLifecycle(document);
    const sampleRate = 8000;
    const wav = new ArrayBuffer(44 + sampleRate * 2);
    const view = new DataView(wav);
    const text = (offset, value) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, wav.byteLength - 8, true); text(8, "WAVE");
    text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, sampleRate * 2, true);
    for (let i = 0; i < sampleRate; i++) view.setInt16(44 + i * 2, Math.sin(i * 440 * 2 * Math.PI / sampleRate) * 1000, true);
    const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
    document.querySelector("#start").onclick = () => {
      player.unlock();
      player.playMusic(url, { loop: true, assetName: "fixture" });
    };
    window.fixture = {
      snapshot: () => player.debugState,
      hidden: (value) => {
        Object.defineProperty(document, "hidden", { configurable: true, value });
        document.dispatchEvent(new Event("visibilitychange"));
      },
      denyNextPlay: () => {
        const original = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function () {
          HTMLMediaElement.prototype.play = original;
          return Promise.reject(new DOMException("Fixture autoplay denial", "NotAllowedError"));
        };
        player.playMusic(url, { loop: true, assetName: "blocked" });
      },
      dispose: () => { player.dispose(); URL.revokeObjectURL(url); },
    };
  });
  await page.click("#start");
  await page.waitForFunction(() => window.fixture.snapshot().musicPaused === false);
  await page.evaluate(() => window.fixture.hidden(true));
  await page.waitForFunction(() => window.fixture.snapshot().contextState === "suspended");
  assert.equal(await page.evaluate(() => window.fixture.snapshot().musicPaused), true);
  await page.evaluate(() => window.fixture.hidden(false));
  await page.waitForFunction(() => window.fixture.snapshot().contextState === "running" && !window.fixture.snapshot().musicPaused);
  await page.evaluate(() => window.fixture.denyNextPlay());
  await page.waitForFunction(() => window.fixture.snapshot().musicNeedsGesture);
  await page.click("#retry");
  await page.waitForFunction(() => !window.fixture.snapshot().musicNeedsGesture && !window.fixture.snapshot().musicPaused);
  await page.evaluate(() => window.fixture.dispose());
  assert.deepEqual(errors, []);
  console.log("audio-lifecycle: PASS (visibility pause/recovery and trusted gesture retry)");
} finally {
  await browser.close();
}
