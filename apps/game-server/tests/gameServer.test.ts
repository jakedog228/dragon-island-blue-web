import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GAME_PROTOCOL_VERSION,
  GameErrorV1Schema,
  type GameCommandEnvelopeV1,
  type LogicPackDescriptorV1,
} from "@dib/game-protocol";
import {
  AuthoritativeGameService,
  GameServiceError,
  type GameCommandReducer,
} from "@dib/game-service";
import {
  createGameServer,
  createLogger,
  type AccountDirectory,
  type ScoreboardDirectory,
} from "../src/gameServer.js";
import {
  authorizeLoginToken,
  countInvites,
  createAccount,
  generateLoginToken,
  readAccount,
  readAuthorizedPlayerIds,
  updateAccountSettings,
} from "../src/invites.js";

const running: Array<ReturnType<typeof createGameServer>> = [];
const accountDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
  for (const directory of accountDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

const pack: LogicPackDescriptorV1 = {
  logicPackId: `logic-v1:${"b".repeat(64)}`,
  simulationVersion: "official-game-v11",
  trustTier: "official",
  capabilities: {
    slot: true, world: true, battle: false, capture: false, spirit: false, party: false,
    economy: false, dungeon: false, quests: false, plot: false, tournaments: false,
    commandTypes: ["slot.create", "world.navigate"],
  },
};

interface State { readonly poi: string }
const reducer: GameCommandReducer<State> = {
  apply(context, command) {
    if (command.type === "slot.create") {
      return { state: { poi: "Town" }, projection: projection("Town", "decision-1"), events: [{ type: "slot.created" }] };
    }
    if (command.type === "world.navigate" && context.state !== undefined) {
      return {
        state: { poi: command.targetPoiId },
        projection: projection(command.targetPoiId, `decision-${context.previousRevision + 1}`),
        events: [{ type: "world.arrived", worldId: "World_1-1", poiId: command.targetPoiId, movement: "walk", randomDraws: [] }],
      };
    }
    throw new GameServiceError("ACTION_NOT_ALLOWED", `${command.type} is unavailable`);
  },
};

function projection(poi: string, decisionId: string) {
  return {
    player: {
      heroLevel: 1,
      heroTotalHighestLevels: 1,
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      party: [],
      battingOrderSize: 6,
      battingOrderIds: [],
      ownedSoulStones: [],
      highestCapturedLevels: {},
      learnedCombineRecipes: [],
      tutorialFlags: [],
      catchQuestsDone: [],
      items: {},
      spirit: { energy: 0, savedXp: {}, usedThisTrip: [] },
    },
    location: { kind: "world" as const, worldId: "World_1-1", poiId: poi },
    decision: { type: "world.ready" as const, decisionId, selectablePoiIds: ["Town", "Forest"] },
  };
}

async function harness(allowedOrigins: readonly string[] = []) {
  const service = new AuthoritativeGameService({ pack, reducer, now: () => 1_700_000_000_000 });
  const server = createGameServer({
    hmacSecret: "x".repeat(32),
    services: [service],
    isInvited: () => true,
    now: () => 1_700_000_000_000,
    allowedOrigins,
  });
  running.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${address.port}`;
  const session = await fetch(`${endpoint}/api/game/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      protocolVersion: GAME_PROTOCOL_VERSION,
      loginToken: "invite-token-with-enough-length",
      logicPackId: pack.logicPackId,
      supportedEventVersions: ["presentation-events-v1"],
    }),
  });
  const sessionBody = await session.json() as { token: string };
  return { endpoint, token: sessionBody.token };
}

function envelope(
  commandId: string,
  expectedRevision: number,
  command: GameCommandEnvelopeV1["command"],
  expectedDecisionId?: string,
): GameCommandEnvelopeV1 {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    commandId,
    expectedRevision,
    ...(expectedDecisionId === undefined ? {} : { expectedDecisionId }),
    command,
  };
}

describe("authoritative game HTTP boundary", () => {
  it.each([undefined, "official-game-v10"])("rejects a session from simulation %s before a command reaches the reducer", async (simulationVersion) => {
    const { endpoint, token } = await harness();
    const claims = JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
    if (simulationVersion === undefined) delete claims.simulationVersion;
    else claims.simulationVersion = simulationVersion;
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", "x".repeat(32)).update(`session\0${encoded}`).digest("hex");
    const response = await fetch(`${endpoint}/api/game/slots/slot-1/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${encoded}.${signature}`, "Content-Type": "application/json" },
      body: JSON.stringify(envelope("version_guard_0001", 0, { type: "slot.create", starterElement: "Water" })),
    });
    expect(await response.json()).toMatchObject({ error: { code: "PACK_UNAVAILABLE", retryable: false } });
    const slots = await fetch(`${endpoint}/api/game/slots`, { headers: { Authorization: `Bearer ${token}` } });
    expect(await slots.json()).toMatchObject({ slots: [] });
  });

  it("accepts same-origin proxy traffic and rejects unlisted cross-origin traffic", async () => {
    const { endpoint } = await harness();
    const requestSession = (origin: string) => fetch(`${endpoint}/api/game/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        loginToken: "invite-token-with-enough-length",
        logicPackId: pack.logicPackId,
        supportedEventVersions: ["presentation-events-v1"],
      }),
    });

    expect((await requestSession(endpoint)).status).toBe(200);
    expect((await requestSession("https://untrusted.example")).status).toBe(403);
  });

  it("permits an explicitly configured cross-origin browser", async () => {
    const origin = "https://play.example";
    const { endpoint } = await harness([origin]);
    const response = await fetch(`${endpoint}/api/game/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        loginToken: "invite-token-with-enough-length",
        logicPackId: pack.logicPackId,
        supportedEventVersions: ["presentation-events-v1"],
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
  });

  it("executes intent commands and returns idempotent committed results", async () => {
    const { endpoint, token } = await harness();
    const create = envelope(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    );
    const first = await fetch(`${endpoint}/api/game/slots/slot-1/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(create),
    });
    expect(first.status).toBe(200);
    expect(first.headers.get("server-timing")).toMatch(
      /^queue-read;dur=\d+\.\d{3}, validation;dur=\d+\.\d{3}, reduction;dur=\d+\.\d{3}, finalize;dur=\d+\.\d{3}, persistence;dur=\d+\.\d{3}, command;dur=\d+\.\d{3}$/,
    );
    expect(await first.json()).toMatchObject({ revision: 1, idempotentReplay: false });
    const retry = await fetch(`${endpoint}/api/game/slots/slot-1/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(create),
    });
    expect(await retry.json()).toMatchObject({ revision: 1, idempotentReplay: true });
  });

  it("rejects state uploads and multipart/archive-shaped requests", async () => {
    const { endpoint, token } = await harness();
    const stateUpload = await fetch(`${endpoint}/api/game/slots/slot-1/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(envelope("command_upload_0001", 0, {
        type: "slot.replaceState",
        state: { silver: 999999 },
      } as never)),
    });
    expect(stateUpload.status).toBe(400);

    const multipart = await fetch(`${endpoint}/api/game/slots/slot-1/commands`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data; boundary=x" },
      body: "--x\r\nContent-Disposition: form-data; name=\"archive\"\r\n\r\nPK\r\n--x--",
    });
    expect(multipart.status).toBe(415);
  });

  it("has no generic authoritative state-write route", async () => {
    const { endpoint, token } = await harness();
    const response = await fetch(`${endpoint}/api/game/slots/slot-1/state`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: { silver: 999999 } }),
    });
    expect(response.status).toBe(404);
  });

  describe("infrastructure probes", () => {
    // deploy/Caddyfile points its upstream `health_uri` at /health and the Dockerfile HEALTHCHECK
    // at /readiness. Both are unauthenticated by necessity -- a probe has no session -- so the
    // shapes they return are part of the deployment contract, not incidental.
    it("answers /health without a session", async () => {
      const { endpoint } = await harness();
      const response = await fetch(`${endpoint}/api/game/health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });

    it("reports ready with the installed pack ids once a pack is serving", async () => {
      const { endpoint } = await harness();
      const response = await fetch(`${endpoint}/api/game/readiness`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        ready: true,
        installedLogicPackIds: [pack.logicPackId],
      });
    });

    it("reports 503 from readiness while no pack is installed", async () => {
      const server = createGameServer({
        hmacSecret: "x".repeat(32),
        services: [],
        isInvited: () => true,
        now: () => 1_700_000_000_000,
      });
      running.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

      // This is why the container healthcheck targets readiness rather than health: a process that
      // is listening but has nothing to serve must not be declared healthy, or the proxy starts
      // dispatching into it mid-boot.
      const readiness = await fetch(`${endpoint}/api/game/readiness`);
      expect(readiness.status).toBe(503);
      expect(await readiness.json()).toEqual({ ready: false, installedLogicPackIds: [] });

      // Liveness stays 200: the process is alive and should not be restarted for this.
      expect((await fetch(`${endpoint}/api/game/health`)).status).toBe(200);
    });

    it("only answers probes on GET", async () => {
      const { endpoint } = await harness();
      // The unauthenticated probe handling is gated on GET, so a POST falls through to the
      // authenticated router and is rejected there. What matters is that the probe paths are not
      // an unauthenticated write surface.
      expect((await fetch(`${endpoint}/api/game/health`, { method: "POST" })).status).toBe(401);
      expect((await fetch(`${endpoint}/api/game/readiness`, { method: "POST" })).status).toBe(401);
    });
  });

  describe("access logging", () => {
    // The deployment has no analytics beacon by design, so this log is the only record that anyone
    // played. Its fields are consumed by deploy/traffic-report.sh and are a contract.
    async function loggingHarness() {
      const records: Array<{ msg: string; fields: Record<string, unknown> }> = [];
      const capture = {
        debug: (msg: string, fields?: Record<string, unknown>) => { records.push({ msg, fields: fields ?? {} }); },
        info: (msg: string, fields?: Record<string, unknown>) => { records.push({ msg, fields: fields ?? {} }); },
        warn: () => {},
        error: () => {},
        child() { return capture; },
      };
      const service = new AuthoritativeGameService({ pack, reducer, now: () => 1_700_000_000_000 });
      const server = createGameServer({
        hmacSecret: "x".repeat(32),
        services: [service],
        isInvited: () => true,
        now: () => 1_700_000_000_000,
        logger: capture,
      });
      running.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      return { endpoint, records };
    }

    // "close" can land a tick after fetch() resolves, so settle the event loop before asserting.
    const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); };

    it("records one request line carrying method, path, status and duration", async () => {
      const { endpoint, records } = await loggingHarness();
      await fetch(`${endpoint}/api/game/scoreboard`);
      await settle();

      const logged = records.filter((entry) => entry.msg === "game request");
      expect(logged).toHaveLength(1);
      expect(logged[0]?.fields).toMatchObject({
        method: "GET",
        path: "/api/game/scoreboard",
        status: 404,
      });
      expect(typeof logged[0]?.fields["durationMs"]).toBe("number");
      // Unauthenticated traffic must not invent an identity.
      expect(logged[0]?.fields["playerId"]).toBeUndefined();
    });

    it("attributes an authenticated request to the player that made it", async () => {
      const { endpoint, records } = await loggingHarness();
      const session = await fetch(`${endpoint}/api/game/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          loginToken: "invite-token-with-enough-length",
          logicPackId: pack.logicPackId,
          supportedEventVersions: ["presentation-events-v1"],
        }),
      });
      const { token } = await session.json() as { token: string };
      records.length = 0;

      await fetch(`${endpoint}/api/game/slots/slot-1`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      await settle();

      const logged = records.filter((entry) => entry.msg === "game request");
      expect(logged).toHaveLength(1);
      // A 64-char hex pseudonym, which is what makes "how many people played" answerable without
      // ever storing a credential.
      expect(logged[0]?.fields["playerId"]).toMatch(/^[a-f0-9]{64}$/);
    });

    it("never lets a bearer token reach the log through the access record", async () => {
      const { endpoint, records } = await loggingHarness();
      await fetch(`${endpoint}/api/game/slots/slot-1`, {
        headers: { Authorization: "Bearer definitely-not-a-valid-token" },
      });
      await settle();

      const serialized = JSON.stringify(records);
      expect(serialized).not.toContain("definitely-not-a-valid-token");
      const logged = records.filter((entry) => entry.msg === "game request");
      expect(logged[0]?.fields).toMatchObject({ status: 401 });
      expect(logged[0]?.fields["playerId"]).toBeUndefined();
    });
  });

  describe("self-service accounts", () => {
    const secret = "x".repeat(32);

    async function accountHarness(
      options: { registrationEnabled?: boolean; registrationBurst?: number } = {},
    ) {
      const dataDirectory = await mkdtemp(join(tmpdir(), "dib-game-accounts-"));
      accountDirectories.push(dataDirectory);
      const accounts: AccountDirectory = {
        create: async ({ username, publicScoreboard }) =>
          createAccount({
            dataDirectory,
            hmacSecret: secret,
            username,
            publicScoreboard,
            maxAccounts: 100,
          }),
        read: async (playerId) => readAccount(dataDirectory, playerId),
        updateSettings: async (playerId, patch) =>
          updateAccountSettings(dataDirectory, playerId, patch),
      };
      const server = createGameServer({
        hmacSecret: secret,
        services: [new AuthoritativeGameService({ pack, reducer, now: () => 1_700_000_000_000 })],
        isInvited: async (playerId) => (await readAuthorizedPlayerIds(dataDirectory)).has(playerId),
        now: () => 1_700_000_000_000,
        accounts,
        ...(options.registrationEnabled === undefined
          ? {}
          : { registrationEnabled: options.registrationEnabled }),
        // The shipped default: one registration per five minutes, no accumulated burst.
        rateLimit: {
          registration: { perMinute: 0.2, burst: options.registrationBurst ?? 1 },
        },
      });
      running.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const register = (username: string, publicScoreboard: boolean) =>
        fetch(`${endpoint}/api/game/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            protocolVersion: GAME_PROTOCOL_VERSION,
            username,
            publicScoreboard,
          }),
        });
      const openSession = (loginToken: string) => fetch(`${endpoint}/api/game/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          loginToken,
          logicPackId: pack.logicPackId,
          supportedEventVersions: ["presentation-events-v1"],
        }),
      });
      return { endpoint, dataDirectory, register, openSession };
    }

    it("mints a token that immediately opens a session carrying the account", async () => {
      const { register, openSession } = await accountHarness();
      const created = await register("Ada Lovelace", true);
      expect(created.status).toBe(201);
      const body = await created.json() as {
        loginToken: string;
        account: { username: string; publicScoreboard: boolean };
      };
      expect(body.account).toMatchObject({ username: "Ada Lovelace", publicScoreboard: true });
      expect(body.loginToken.length).toBeGreaterThanOrEqual(16);

      const session = await openSession(body.loginToken);
      expect(session.status).toBe(200);
      expect(await session.json()).toMatchObject({
        account: { username: "Ada Lovelace", publicScoreboard: true },
      });
    });

    it("throttles a second registration from the same address and creates nothing", async () => {
      const { register, dataDirectory } = await accountHarness();
      expect((await register("first", false)).status).toBe(201);
      const throttled = await register("second", false);
      expect(throttled.status).toBe(429);
      expect(await throttled.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
      expect(await countInvites(dataDirectory)).toBe(1);
    });

    it("round-trips the scoreboard flag over the authenticated routes", async () => {
      const { endpoint, register, openSession } = await accountHarness();
      const created = await (await register("Ada", true)).json() as { loginToken: string };
      const session = await (await openSession(created.loginToken)).json() as { token: string };
      const authorized = { Authorization: `Bearer ${session.token}` };

      expect((await fetch(`${endpoint}/api/game/account`)).status).toBe(401);
      expect((await fetch(`${endpoint}/api/game/account/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: GAME_PROTOCOL_VERSION, publicScoreboard: false }),
      })).status).toBe(401);

      const updated = await fetch(`${endpoint}/api/game/account/settings`, {
        method: "POST",
        headers: { ...authorized, "Content-Type": "application/json" },
        body: JSON.stringify({ protocolVersion: GAME_PROTOCOL_VERSION, publicScoreboard: false }),
      });
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ account: { publicScoreboard: false } });

      const read = await fetch(`${endpoint}/api/game/account`, { headers: authorized });
      expect(await read.json()).toMatchObject({
        account: { username: "Ada", publicScoreboard: false },
      });
    });

    it("reports a taken username and a malformed one as client-fixable failures", async () => {
      // Burst 3 so the throttle is not what rejects the later calls; the account rules are.
      const { register, dataDirectory } = await accountHarness({ registrationBurst: 3 });
      expect((await register("Ada", false)).status).toBe(201);
      const duplicate = await register("ada", false);
      expect(duplicate.status).toBe(422);
      expect(await duplicate.json()).toMatchObject({
        error: { code: "ACTION_NOT_ALLOWED", message: expect.stringContaining("already taken") },
      });
      expect(await countInvites(dataDirectory)).toBe(1);

      // Schema rejection happens before any durable work, and costs the caller a token either way.
      const malformed = await register("!!", false);
      expect(malformed.status).toBe(400);
      expect(await countInvites(dataDirectory)).toBe(1);
    });

    it("closes registration without locking existing accounts out of their settings", async () => {
      const open = await accountHarness();
      const created = await (await open.register("Ada", true)).json() as { loginToken: string };

      const closed = await accountHarness({ registrationEnabled: false });
      expect(await (await fetch(`${closed.endpoint}/api/game/registration`)).json())
        .toMatchObject({ enabled: false });
      expect((await closed.register("Bob", false)).status).toBe(403);

      // The same directory-backed routes stay live on the open server for an existing account.
      expect(await (await fetch(`${open.endpoint}/api/game/registration`)).json())
        .toMatchObject({ enabled: true, usernameMinLength: 2, usernameMaxLength: 16 });
      const session = await (await open.openSession(created.loginToken)).json() as { token: string };
      expect((await fetch(`${open.endpoint}/api/game/account`, {
        headers: { Authorization: `Bearer ${session.token}` },
      })).status).toBe(200);
    });

    it("tells an operator-issued token that it owns no account", async () => {
      const { endpoint, dataDirectory, openSession } = await accountHarness();
      const token = generateLoginToken();
      await authorizeLoginToken({ dataDirectory, hmacSecret: secret, token, label: "operator" });
      const session = await openSession(token);
      expect(session.status).toBe(200);
      expect(await session.json()).not.toHaveProperty("account");

      const claims = await openSession(token).then((response) => response.json()) as
        { token: string };
      const response = await fetch(`${endpoint}/api/game/account`, {
        headers: { Authorization: `Bearer ${claims.token}` },
      });
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "ACTION_NOT_ALLOWED", message: "this login token has no account" },
      });
    });
  });

  describe("public scoreboard route", () => {
    async function boardHarness(options: {
      scoreboard?: ScoreboardDirectory;
      allowedOrigins?: readonly string[];
      burst?: number;
    } = {}) {
      const server = createGameServer({
        hmacSecret: "x".repeat(32),
        services: [new AuthoritativeGameService({ pack, reducer, now: () => 1_700_000_000_000 })],
        isInvited: () => true,
        now: () => 1_700_000_000_000,
        ...(options.allowedOrigins === undefined
          ? {}
          : { allowedOrigins: options.allowedOrigins }),
        ...(options.scoreboard === undefined ? {} : { scoreboard: options.scoreboard }),
        rateLimit: { scoreboard: { perMinute: 60, burst: options.burst ?? 10 } },
      });
      running.push(server);
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    }

    const board: ScoreboardDirectory = {
      list: async () => ({
        generatedAt: "2026-08-08T00:00:00.000Z",
        entries: [{ rank: 1, username: "Ada Lovelace", heroLevel: 12, totalXp: 4820 }],
      }),
    };

    it("serves the board to a caller holding no token at all", async () => {
      const endpoint = await boardHarness({ scoreboard: board });
      const response = await fetch(`${endpoint}/api/game/scoreboard`);
      expect(response.status).toBe(200);
      // The one cacheable response the service has, and the only one not marked `no-store`.
      expect(response.headers.get("cache-control")).toBe("public, max-age=30");
      expect(await response.json()).toEqual({
        protocolVersion: GAME_PROTOCOL_VERSION,
        generatedAt: "2026-08-08T00:00:00.000Z",
        entries: [{ rank: 1, username: "Ada Lovelace", heroLevel: 12, totalXp: 4820 }],
      });
    });

    it("keeps the CORS allowlist between a browser and the board", async () => {
      const endpoint = await boardHarness({
        scoreboard: board,
        allowedOrigins: ["https://play.example"],
      });
      // No `Origin` at all is a server-side or `curl` read, which the allowlist never governed.
      expect((await fetch(`${endpoint}/api/game/scoreboard`)).status).toBe(200);
      const allowed = await fetch(`${endpoint}/api/game/scoreboard`, {
        headers: { Origin: "https://play.example" },
      });
      expect(allowed.status).toBe(200);
      expect(allowed.headers.get("access-control-allow-origin")).toBe("https://play.example");
      // "Public" means no token is required, not that any page may embed the board.
      expect((await fetch(`${endpoint}/api/game/scoreboard`, {
        headers: { Origin: "https://evil.example" },
      })).status).toBe(403);
    });

    it("reports itself unavailable when the operator publishes no board", async () => {
      const endpoint = await boardHarness();
      const response = await fetch(`${endpoint}/api/game/scoreboard`);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "ENTITY_NOT_FOUND", message: "this server publishes no scoreboard" },
      });
    });

    it("throttles an address that reads faster than the cache is rebuilt", async () => {
      const endpoint = await boardHarness({ scoreboard: board, burst: 1 });
      expect((await fetch(`${endpoint}/api/game/scoreboard`)).status).toBe(200);
      const throttled = await fetch(`${endpoint}/api/game/scoreboard`);
      expect(throttled.status).toBe(429);
      expect(await throttled.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    });
  });

  it("keeps an over-long service error parseable instead of degrading to a transport failure", async () => {
    // A STATE_CORRUPT message carrying a serialized Zod issue array easily clears 500 characters,
    // and an error body the client cannot parse reads to the player as "malformed HTTP response" —
    // hiding the one detail that explains the failure.
    const detail = `corrupt authoritative slot slot-1: ${"unrecognized key collectionClaims; ".repeat(40)}`;
    expect(detail.length).toBeGreaterThan(500);
    const server = createGameServer({
      hmacSecret: "x".repeat(32),
      services: [{
        pack,
        listSlots: async () => {
          throw new GameServiceError("STATE_CORRUPT", detail);
        },
        bootstrap: async () => { throw new Error("unused"); },
        execute: async () => { throw new Error("unused"); },
        deleteSlot: async () => {},
      }],
      isInvited: () => true,
      now: () => 1_700_000_000_000,
    });
    running.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${address.port}/api/game/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        loginToken: "invite-token-with-enough-length",
        logicPackId: pack.logicPackId,
        supportedEventVersions: ["presentation-events-v1"],
      }),
    });
    const parsed = GameErrorV1Schema.safeParse(await response.json());
    expect(parsed.success).toBe(true);
    const relayed = parsed.data?.error;
    expect(relayed?.code).toBe("STATE_CORRUPT");
    expect(relayed?.message).toHaveLength(500);
    expect(relayed?.message.startsWith("corrupt authoritative slot slot-1:")).toBe(true);
    expect(relayed?.message.endsWith("…")).toBe(true);
  });

  it("classifies server-side schema failures as internal instead of blaming the client", async () => {
    const logLines: string[] = [];
    const logger = createLogger({ level: "error", write: (line) => { logLines.push(line); } });
    const server = createGameServer({
      hmacSecret: "x".repeat(32),
      services: [{
        pack,
        listSlots: async () => [],
        bootstrap: async () => {
          const error = new Error("invalid persisted projection");
          error.name = "ZodError";
          throw error;
        },
        execute: async () => {
          throw new Error("unused");
        },
        deleteSlot: async () => {},
      }],
      isInvited: () => true,
      now: () => 1_700_000_000_000,
      logger,
    });
    running.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${address.port}`;
    const session = await fetch(`${endpoint}/api/game/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        loginToken: "invite-token-with-enough-length",
        logicPackId: pack.logicPackId,
        supportedEventVersions: ["presentation-events-v1"],
      }),
    }).then((response) => response.json()) as { token: string };

    const response = await fetch(`${endpoint}/api/game/slots/slot-1/bootstrap`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      error: { code: "INTERNAL", retryable: true },
    });
    // The operator gets the detail; the client gets only the opaque correlation id.
    expect(logLines).toHaveLength(1);
    const logged = JSON.parse(logLines[0] as string) as Record<string, unknown>;
    expect(logged).toMatchObject({ level: "error", msg: "authoritative game request failed" });
    expect(logged["correlationId"]).toMatch(/^corr-/);
  });
});
