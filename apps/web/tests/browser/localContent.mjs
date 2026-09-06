import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");

/**
 * Select the user-owned archive through the same File API gate used by normal sessions.
 *
 * `options.modArchives` adds packaged `.dibmod` files to the gate's own mod picker, so a scenario
 * exercises an external package through the same activation route a player uses.
 */
export async function loadLocalContent(page, explicitArchive, options = {}) {
  const archive = explicitArchive ?? process.env.DIB_CONTENT_ARCHIVE ?? readdirSync(repositoryRoot)
    .map((name) => resolve(repositoryRoot, name))
    .find((path) => /\.(?:ipa|zip)$/i.test(path) && existsSync(path));
  if (!archive) throw new Error("Set DIB_CONTENT_ARCHIVE to a compatible local IPA/ZIP.");

  const input = page.locator('input[name="asset-archive"]');
  await input.waitFor({ state: "attached" });
  await input.setInputFiles(archive);
  const modArchives = options.modArchives ?? [];
  if (modArchives.length > 0) {
    await page.locator('input[name="mod-archives"]').setInputFiles(modArchives);
  }
  await page.getByRole("radio", { name: "Offline", exact: true }).check();
  await page.locator('[data-local-save-status].content-gate__mode-detail-status--success')
    .waitFor({ state: "visible", timeout: 60_000 });
  await page.getByRole("checkbox", {
    name: "I have the right to use the content in this archive on this device.",
  }).check();
  await page.getByRole("button", { name: "Play Offline", exact: true }).click();
  try {
    await Promise.race([
      page.waitForFunction(
        () => JSON.parse(window.render_game_to_text()).mode === "start",
        undefined,
        { timeout: 60_000 },
      ),
      page.getByRole("heading", { name: "Local content cannot start" })
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(async () => {
          const detail = await page.locator("details pre").textContent();
          throw new Error(`Local content did not reach the start screen: ${detail?.trim() ?? "unknown error"}`);
        }),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Local content did not reach")) throw error;
    const fatalDetail = await page.locator("details pre").textContent().catch(() => null);
    throw new Error(
      `Local content did not reach the start screen` +
        (fatalDetail ? `: ${fatalDetail.trim()}` : ""),
      { cause: error },
    );
  }
}
