import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import { CommunityHttp } from "./community.js";
import type { OfficialMod } from "./officialMods.js";

/**
 * Development-only HTTP surface for Offline work: the public mod catalog without the authoritative
 * game API, its HMAC secret, extracted data or player state. Every other route answers 503, which
 * the client already reports as "Online unavailable", so this process can never pass for an
 * Official server. There is no author origin, so uploads and author sign-in stay disabled (404).
 */
export function createCatalogOnlyServer(options: {
  readonly official: readonly OfficialMod[];
  /** Read-only community catalog directory; a missing directory is an empty catalog. */
  readonly communityDirectory: string;
}): Server {
  const community = new CommunityHttp({
    directory: options.communityDirectory,
    accountDirectory: options.communityDirectory,
    // Only author sign-in derives player IDs from it, and author routes are disabled here.
    hmacSecret: randomBytes(32).toString("hex"),
    official: options.official,
    registrationEnabled: false,
    maxAccounts: 0,
    trustProxy: false,
  });
  return createServer((request, response) => {
    if (request.url?.startsWith("/api/community/")) {
      void community.handle(request, response);
      return;
    }
    response.statusCode = 503;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.end(JSON.stringify({ message: "This development server only hosts the mod catalog. Start the game API for Online play." }));
  });
}
