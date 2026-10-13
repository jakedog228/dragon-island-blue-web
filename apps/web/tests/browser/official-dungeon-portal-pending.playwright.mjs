// Isolated real-HTTP Town Portal input-ownership regression. Never uses campaign accounts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const webUrl = process.env.DIB_WEB_URL ?? "http://127.0.0.1:15304";
assert(["localhost", "127.0.0.1"].includes(new URL(webUrl).hostname));
process.env.DIB_WEB_URL = webUrl;
const gameUrl = process.env.DIB_GAME_URL ?? "http://127.0.0.1:18896";
assert(["localhost", "127.0.0.1"].includes(new URL(gameUrl).hostname));
process.env.DIB_GAME_URL = gameUrl;
const credentialPath = path.resolve("output/official-dungeon-portal-pending-account.json");
fs.mkdirSync(path.dirname(credentialPath), { recursive: true });
if (!fs.existsSync(credentialPath)) {
  const response = await fetch(new URL("/api/game/accounts", gameUrl), { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ protocolVersion: "game-protocol-v1",
      username: `Portal${Date.now().toString(36)}`, publicScoreboard: false }) });
  assert.equal(response.status, 201, "Scenario account creation failed");
  fs.writeFileSync(credentialPath, JSON.stringify(await response.json()), { flag: "wx", mode: 0o600 });
}
const { loginToken } = JSON.parse(fs.readFileSync(credentialPath, "utf8"));
process.env.DIB_TEST_AUTH_KEY = loginToken;
process.env.DIB_OFFICIAL_DUNGEON_PORTAL_PENDING = "1";
process.env.DIB_OFFICIAL_DUNGEON_OUTPUT ??= "output/official-dungeon-portal-pending";
try { await import("./official-dungeon-restore.playwright.mjs"); }
catch (error) { throw new Error((error.stack ?? String(error)).replaceAll(loginToken, "[redacted login token]")); }
