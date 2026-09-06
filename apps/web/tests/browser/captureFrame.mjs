


























import fs from "node:fs";
import path from "node:path";



const DEFAULT_TIMEOUT_MS = 180_000;

const withTimeout = async (promise, timeoutMs, message) => {
  let expiry;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        expiry = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(expiry);
  }
};

/**
 * Build a capture function bound to one page. Call it again for each new page: a CDP session
 * belongs to the page it was opened on and dies with it.
 *
 * @param {import("playwright").Page} page
 * @param {string} outputDirectory directory the PNGs are written into (created by the caller)
 * @returns {Promise<(fileName: string, options?: { fullPage?: boolean, timeoutMs?: number }) => Promise<string>>}
 */
export const createFrameCapture = async (page, outputDirectory) => {
  let cdp;
  return async (fileName, { fullPage = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
    const startedAt = Date.now();
    cdp ??= await page.context().newCDPSession(page);
    const captured = await withTimeout(
      cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        // Full-page is only meaningful for DOM evidence (the content gate, the options page); a
        // Pixi canvas never extends past the viewport.
        captureBeyondViewport: fullPage,
      }),
      timeoutMs,
      `CDP Page.captureScreenshot did not return within ${timeoutMs}ms for ${fileName}. ` +
        "Semantic assertions before this point passed. The first capture on a page costs 50-265s " +
        "under swiftshader; if this is that first capture, raise its timeoutMs rather than " +
        "reaching for a different capture API -- they all pay the same cost.",
    );
    const file = path.join(outputDirectory, fileName);
    fs.writeFileSync(file, Buffer.from(captured.data, "base64"));
    console.log(`captureFrame: ${fileName} in ${Date.now() - startedAt}ms`);
    return file;
  };
};
