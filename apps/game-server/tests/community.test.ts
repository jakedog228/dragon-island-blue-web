import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { request as httpRequest } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CommunityHttp } from "../src/community.js";
import { createGameServer } from "../src/gameServer.js";
import { authorizeLoginToken, readAccount, revokeInvite } from "../src/invites.js";
import { zipMod } from "./helpers/communityFixtures.js";
import type { CatalogMod } from "@dib/mod-kernel/catalog";

const dirs: string[] = [], servers: ReturnType<typeof createGameServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "dib-community-http-")); dirs.push(dir);
  const secret = "test-secret-at-least-thirty-two-bytes";
  const owner = await authorizeLoginToken({ dataDirectory: dir, hmacSecret: secret, token: "existing-login-key-123456", username: "Alice" });
  const options = { directory: join(dir, "community"), accountDirectory: dir, hmacSecret: secret, authorOrigin: "http://authors.local", registrationEnabled: true, maxAccounts: 100, trustProxy: false };
  const community = new CommunityHttp(options);
  const server = createGameServer({ hmacSecret: secret, services: [], isInvited: () => true, community });
  server.listen(0, "127.0.0.1"); servers.push(server); await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (path: string, body: unknown = {}, token = "", origin = "http://authors.local", host = "authors.local", method = "POST") => new Promise<Response>((resolve, reject) => {
    const req = httpRequest(`${base}/api/community${path}`, { method,
      headers: { Host: host, Origin: origin, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) } }, (res) => {
      const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500 })));
    });
    req.on("error", reject); req.end(method === "GET" ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body));
  });
  return { dir, owner, request, base };
}
describe("author session boundary", () => {
  it("serves uploaded bytes only after owner publication and removes public access on deletion", async () => {
    const { request, base } = await setup();
    const session = await (await request("/session", { loginToken: "existing-login-key-123456" })).json() as { token: string };
    const created = await request("/me/mods", { modId: "test.author.mod", title: "Mod", description: "Desc", tags: [] }, session.token);
    const draft = await created.json() as CatalogMod;
    // Raw upload revisions travel in If-Match, so use the native HTTP client for the body/header.
    const result = await new Promise<Response>((resolve, reject) => {
      const req = httpRequest(`${base}/api/community/me/mods/${draft.id}/release`, { method: "POST", headers: {
        Host: "authors.local", Origin: "http://authors.local", Authorization: `Bearer ${session.token}`, "If-Match": "1", "Content-Type": "application/octet-stream",
      } }, (res) => { const chunks: Buffer[] = []; res.on("data", (chunk: Buffer) => chunks.push(chunk)); res.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 500 }))); });
      req.on("error", reject); req.end(zipMod());
    });
    expect(result.status).toBe(200); const uploaded = await result.json() as CatalogMod;
    const download = `${base}/api/community/mods/${draft.id}/download/${uploaded.releases[0]!.digest}`;
    expect((await fetch(download)).status).toBe(404);
    expect((await request(`/me/mods/${draft.id}`, { title: "Mod", description: "Desc", tags: [], published: true, screenshots: [], revision: uploaded.revision }, session.token, undefined, undefined, "PATCH")).status).toBe(200);
    expect(Buffer.from(await (await fetch(download)).arrayBuffer())).toEqual(zipMod());
    expect((await request(`/me/mods/${draft.id}`, { title: "Mod", description: "Desc", tags: [], published: false, screenshots: [], revision: uploaded.revision + 1 }, session.token, undefined, undefined, "PATCH")).status).toBe(200);
    expect((await fetch(download)).status).toBe(404);
  });
  it("reuses an existing account without a logic pack and rejects game-origin credentials", async () => {
    const { request, base } = await setup();
    expect((await fetch(`${base}/api/community/info`)).status).toBe(200);
    const login = await request("/session", { loginToken: "existing-login-key-123456" });
    expect(login.status).toBe(200);
    const session = await login.json() as { token: string; profile: { username: string } };
    expect(session.profile.username).toBe("Alice");
    expect((await request("/me", {}, session.token)).status).toBe(200);
    expect((await request("/me", {}, session.token, "http://game.local")).status).toBe(403);
    expect((await request("/me", {}, session.token, "http://authors.local", "game.local")).status).toBe(403);
    expect((await request("/me", {}, session.token, "null")).status).toBe(403);
    const game = await fetch(`${base}/api/game/slots`, { headers: { Authorization: `Bearer ${session.token}` } });
    expect(game.status).toBe(401);
    await request("/logout", {}, session.token);
    expect((await request("/me", {}, session.token)).status).toBe(401);
  });
  it("creates named accounts with private scoreboard and observes immediate registry revocation", async () => {
    const { dir, request, owner } = await setup();
    const signup = await request("/accounts", { username: "Bob" });
    expect(signup.status).toBe(200);
    const created = await signup.json() as { token: string; loginToken: string; profile: { username: string } };
    expect(created.loginToken.length).toBeGreaterThan(20); expect(created.profile.username).toBe("Bob");
    const login = await request("/session", { loginToken: "existing-login-key-123456" });
    const session = await login.json() as { token: string };
    expect((await readAccount(dir, owner))?.publicScoreboard).toBe(false);
    await revokeInvite(dir, owner);
    expect((await request("/me", {}, session.token)).status).toBe(401);
  });
});
