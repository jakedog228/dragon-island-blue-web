import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { restorePvpBattle, type PvpBattleSnapshot } from "@dib/engine";
import { PvpErrorV1Schema, PvpMatchViewV1Schema } from "@dib/game-protocol";
import { createGameServer, createLogger } from "../src/gameServer.js";
import { PvpCompatibilityRegistry } from "../src/pvpCompatibility.js";
import { PvpService } from "../src/pvpService.js";
import { InMemoryPvpStore } from "../src/pvpStore.js";

const servers: ReturnType<typeof createGameServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map(async (server) => {
    const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed;
  }));
});
const secret = "pvp-http-tests-secret-32-characters-long";
const data = loadGameData();
const logicPackId = `logic-v1:${"a".repeat(64)}`;
const setup = { logicPackId, mods: [] };
const body = (shortType = "FireCub") => ({ requestId: randomUUID(), setup, entry: { source: "offline", party: [{ shortType, level: 5 }] } });
async function start(enabled = true) {
  let time = 1_000_000;
  let invited = true;
  const officialParty = vi.fn(async () => [{ shortType: "FireCub", level: 5 }]);
  const service = new PvpService({ store: new InMemoryPvpStore(), profiles: new Map([["base", data]]),
    compatibility: new PvpCompatibilityRegistry([], [{ id: "base", logicPackId, rules: [] }]),
    officialParty, now: () => time, randomSource: () => 0.5 });
  const server = createGameServer({ hmacSecret: secret, services: [], isInvited: () => invited,
    ...(enabled ? { pvp: service } : {}), now: () => time, allowedOrigins: ["https://allowed.example"],
    logger: createLogger({ level: "error" }) });
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (path: string, token?: string, input?: unknown, headers: Record<string, string> = {}) => fetch(`${url}${path}`, {
    method: input === undefined ? "GET" : "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(input === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const session = async (name: string) => {
    const result = await call("/api/pvp/session", undefined, { name });
    expect(result.status).toBe(201);
    return (await result.json() as { token: string }).token;
  };
  return { call, session, url, officialParty, advance: (ms: number) => { time += ms; }, revoke: () => { invited = false; } };
}

describe("PvP HTTP boundary", () => {
  it("runs a real two-client battle from invite through terminal outcome", async () => {
    const { call, session, advance } = await start();
    const tokens = [await session("Host"), await session("Guest")];
    const invitation = PvpMatchViewV1Schema.parse(await (await call("/api/pvp/invites", tokens[0], body())).json());
    let match = PvpMatchViewV1Schema.parse(await (await call("/api/pvp/join", tokens[1], { ...body("SnowCub"), code: invitation.code!.toLowerCase() })).json());
    for (let step = 0; step < 100 && match.status === "active"; step++) {
      const replay = restorePvpBattle(data, match.battle as PvpBattleSnapshot);
      if (replay.decision.type !== "turn") throw new Error("missing turn");
      const actor = replay.decision.actorId;
      const team = replay.decision.team;
      const targets = replay.session.activeIdsOf(team === 0 ? 1 : 0).slice(0, 1);
      const response = await call(`/api/pvp/matches/${match.matchId}/commands`, tokens[team], {
        commandId: randomUUID(), expectedRevision: match.revision, decisionId: match.decisionId,
        action: { type: "ability", actorId: actor, slot: "usable1", targets },
      });
      expect(response.status).toBe(200);
      match = PvpMatchViewV1Schema.parse(await response.json());
      advance(1000);
    }
    expect(match.status).toBe("ended");
    expect(match.endReason).toBe("defeat");
    for (const token of tokens) {
      const response = await call(`/api/pvp/matches/${match.matchId}`, token);
      const view = PvpMatchViewV1Schema.parse(await response.json());
      expect(view.battle).toEqual(match.battle);
      expect(view.winner).toBe(match.winner);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("guest tokens cannot authorize Official APIs or select Official rosters", async () => {
    const { call, session, officialParty } = await start();
    const token = await session("Offline");
    expect((await call("/api/game/slots", token)).status).toBe(401);
    const response = await call("/api/pvp/invites", token, { requestId: randomUUID(), setup, entry: { source: "official", slotId: "slot-1" } });
    expect(response.status).toBe(401);
    expect(PvpErrorV1Schema.parse((await response.json() as { error: unknown }).error).code).toBe("UNAUTHORIZED");
    expect(officialParty).not.toHaveBeenCalled();
  });

  it("accepts an authenticated Official session but rechecks revoked accounts", async () => {
    const { call, officialParty, revoke } = await start();
    const playerId = "b".repeat(64);
    const encoded = Buffer.from(JSON.stringify({ playerId, logicPackId, expiresAt: 2_000_000 })).toString("base64url");
    const signature = createHmac("sha256", secret).update(`session\0${encoded}`).digest("hex");
    const token = `${encoded}.${signature}`;
    const response = await call("/api/pvp/invites", token, { requestId: randomUUID(), setup, entry: { source: "official", slotId: "slot-1" } });
    expect(response.status).toBe(200);
    expect(officialParty).toHaveBeenCalledWith(playerId, "slot-1", logicPackId);
    revoke();
    expect((await call("/api/pvp/matches/current", token)).status).toBe(401);
  });

  it("applies origin checks and rejects expired or tampered guest credentials", async () => {
    const { call, session, advance } = await start();
    expect((await call("/api/pvp/info", undefined, undefined, { Origin: "https://evil.example" })).status).toBe(403);
    const allowed = await call("/api/pvp/info", undefined, undefined, { Origin: "https://allowed.example" });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    const token = await session("Guest");
    expect((await call("/api/pvp/matches/current", `${token}0`)).status).toBe(401);
    expect((await call("/api/pvp/matches/current")).status).toBe(401);
    advance(7 * 24 * 60 * 60_000);
    expect((await call("/api/pvp/matches/current", token)).status).toBe(401);
  });

  it("bounds anonymous session creation and malformed requests", async () => {
    const { call, session } = await start();
    const token = await session("Player");
    const invalid = await call("/api/pvp/invites", token, { ...body(), seed: 123 });
    expect(invalid.status).toBe(400);
    expect(PvpErrorV1Schema.parse((await invalid.json() as { error: unknown }).error).code).toBe("INVALID_REQUEST");
    const large = await call("/api/pvp/invites", token, { data: "x".repeat(65536) });
    expect(large.status).toBe(400);
    for (let n = 0; n < 5; n++) await session(`Guest ${n}`);
    const limited = await call("/api/pvp/session", undefined, { name: "Too many" });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).not.toBeNull();
  });

  it("reports unavailable service without minting useless credentials", async () => {
    const { call } = await start(false);
    expect(await (await call("/api/pvp/info")).json()).toMatchObject({ enabled: false });
    expect((await call("/api/pvp/session", undefined, { name: "Guest" })).status).toBe(503);
  });
});
