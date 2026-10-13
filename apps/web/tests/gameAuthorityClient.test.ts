import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GAME_PROTOCOL_VERSION,
  OFFICIAL_GAME_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V27_SIMULATION_VERSION,
  PRESENTATION_EVENT_VERSION,
  type LogicPackDescriptorV1,
} from "@dib/game-protocol";
import {
  RemoteGameAuthority,
  RemoteGameAuthorityError,
  OFFICIAL_CLIENT_SIMULATION_VERSION,
} from "../src/authority/gameAuthorityClient.js";

const logicPackId = `logic-v1:${"a".repeat(64)}`;
const pack: LogicPackDescriptorV1 = {
  logicPackId,
  simulationVersion: "dib-sim-v1",
  trustTier: "official",
  capabilities: {
    slot: true,
    world: true,
    battle: true,
    capture: true,
    spirit: true,
    party: true,
    economy: true,
    dungeon: false,
    quests: false,
    plot: false,
    tournaments: false,
    commandTypes: ["slot.create"],
  },
};

/** The installed simulation the running `pnpm game:dev` server actually serves. */
const v27Pack: LogicPackDescriptorV1 = {
  ...pack,
  simulationVersion: OFFICIAL_GAME_V27_SIMULATION_VERSION,
  capabilities: { ...pack.capabilities, commandTypes: ["slot.create", "world.navigate"] },
};

/** A committed v27 projection exactly as the authoritative service emits it on the wire. */
function v27Projection(revision: number, poi = "Town"): Record<string, unknown> {
  return {
    slotId: "slot-1",
    revision,
    updatedAt: "2026-08-01T00:00:00.000Z",
    logicPackId,
    simulationVersion: OFFICIAL_GAME_V27_SIMULATION_VERSION,
    trustTier: "official",
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
    location: { kind: "world", worldId: "World_1-1", poiId: poi },
    decision: {
      type: "world.ready",
      decisionId: `decision-${revision}`,
      selectablePoiIds: ["Town", "Forest"],
    },
    collectionClaims: { schemaVersion: 1, claimedGoalIds: ["goal-a"] },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function stubCurrentSession(handler: (url: string, init: RequestInit) => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url === "/api/game/session") {
      return jsonResponse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        selectedEventVersion: PRESENTATION_EVENT_VERSION,
        token: "signed-session-token-long-enough",
        expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
        pack: v27Pack,
        slots: [{
          slotId: "slot-1",
          revision: 1,
          updatedAt: "2026-08-01T00:00:00.000Z",
          logicPackId,
          simulationVersion: OFFICIAL_GAME_V27_SIMULATION_VERSION,
          trustTier: "official",
          activeDomain: "world",
        }],
      });
    }
    return handler(url, init);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RemoteGameAuthority", () => {
  it.each(["lost", "truncated"])("keeps the exact command through a %s response and user retry", async (failure) => {
    const bodies: unknown[] = [];
    stubCurrentSession((_url, init) => {
      bodies.push(init.body);
      if (bodies.length === 1) {
        if (failure === "lost") throw new TypeError("connection lost after commit");
        return new Response("{", { status: 200 });
      }
      const envelope = JSON.parse(String(init.body));
      return jsonResponse({
        protocolVersion: GAME_PROTOCOL_VERSION, commandId: envelope.commandId,
        previousRevision: 1, revision: 2, eventCursorStart: 0, eventCursorEnd: 0,
        events: [], projection: v27Projection(2), idempotentReplay: true,
      });
    });
    const authority = await RemoteGameAuthority.authenticate({ endpoint: "", loginToken: "invited-login-token", logicPackId });
    let retry!: () => void;
    const prompt = vi.fn(() => new Promise<void>((resolve) => { retry = resolve; }));
    authority.setRecoveryPrompt(prompt);
    const pending = authority.command("slot-1", {
      protocolVersion: GAME_PROTOCOL_VERSION, commandId: "unchanged-command-01", expectedRevision: 1,
      command: { type: "world.navigate", targetPoiId: "Forest" },
    });
    await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    expect(bodies).toHaveLength(1);
    retry();
    expect((await pending).idempotentReplay).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("uses the authenticated PvP transport and renews an expired session without resending a new action", async () => {
    const requests: RequestInit[] = [];
    stubCurrentSession((url, init) => {
      expect(url).toBe("/api/pvp/invites"); requests.push(init);
      return requests.length === 1 ? new Response("expired", { status: 401 }) : jsonResponse({ accepted: true });
    });
    const authority = await RemoteGameAuthority.authenticate({ endpoint: "", loginToken: "private-login-token", logicPackId });
    const body = JSON.stringify({ requestId: "unchanged" });
    expect((await authority.pvpTransport("/api/pvp/invites", { method: "POST", body })).status).toBe(200);
    expect(requests.map((request) => request.body)).toEqual([body, body]);
    expect(requests.map((request) => new Headers(request.headers).get("Authorization"))).toEqual([
      "Bearer signed-session-token-long-enough", "Bearer signed-session-token-long-enough",
    ]);
    await expect(authority.pvpTransport("https://another.example/", {})).rejects.toThrow("Invalid PvP route");
  });
  it("uses the shared Official simulation identity", () => {
    expect(OFFICIAL_CLIENT_SIMULATION_VERSION).toBe(OFFICIAL_GAME_SIMULATION_VERSION);
  });

  it("authenticates against the authoritative endpoint with bounded protocol fields", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      new Response(JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        selectedEventVersion: PRESENTATION_EVENT_VERSION,
        token: "signed-session-token-long-enough",
        expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
        pack,
        slots: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const authority = await RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
    });

    expect(authority.pack).toEqual(pack);
    expect(authority.slots).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/game/session");
    expect(JSON.parse(String(init.body))).toEqual({
      protocolVersion: GAME_PROTOCOL_VERSION,
      loginToken: "invited-login-token",
      logicPackId,
      supportedEventVersions: [PRESENTATION_EVENT_VERSION],
    });
  });

  it("explains how to recover when the Official server is stopped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const error = await RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RemoteGameAuthorityError);
    expect(error).toMatchObject({
      code: "INTERNAL",
      retryable: true,
      message: expect.stringMatching(/Official online is unavailable.*pnpm game:dev/),
    });
  });

  it("fails closed before gameplay when the running server still uses historical v18", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        selectedEventVersion: PRESENTATION_EVENT_VERSION,
        token: "signed-session-token-long-enough",
        expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
        pack: { ...pack, simulationVersion: OFFICIAL_GAME_V18_SIMULATION_VERSION },
        slots: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    ));

    const error = await RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
      expectedSimulationVersion: OFFICIAL_CLIENT_SIMULATION_VERSION,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RemoteGameAuthorityError);
    expect(error).toMatchObject({
      code: "PACK_UNAVAILABLE",
      retryable: false,
      message: expect.stringMatching(
        /server is running official-game-v18.*requires official-game-v27.*same checkout.*pnpm game:dev.*reload/,
      ),
    });
  });

  it("turns a Vite proxy failure into the same actionable stopped-server error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("proxy connection refused", { status: 500 })
    ));

    await expect(RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
    })).rejects.toThrow(/Official online is unavailable \(HTTP 500\).*pnpm game:dev/);
  });

  it("bootstraps the installed v27 projection including its Collection claims sibling", async () => {
    stubCurrentSession((url) => {
      expect(url).toBe("/api/game/slots/slot-1/bootstrap");
      return jsonResponse(v27Projection(1));
    });

    const authority = await RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
      expectedSimulationVersion: OFFICIAL_CLIENT_SIMULATION_VERSION,
    });

    const projection = await authority.bootstrap("slot-1");
    expect(projection.revision).toBe(1);
    expect(projection).toMatchObject({
      collectionClaims: { schemaVersion: 1, claimedGoalIds: ["goal-a"] },
    });
  });

  it("accepts a committed v27 command receipt", async () => {
    stubCurrentSession((url, init) => {
      expect(url).toBe("/api/game/slots/slot-1/commands");
      expect(init.method).toBe("POST");
      return jsonResponse({
        protocolVersion: GAME_PROTOCOL_VERSION,
        commandId: "command_01J8Y4R6X2N3M4P5",
        previousRevision: 1,
        revision: 2,
        eventCursorStart: 1,
        eventCursorEnd: 1,
        events: [{
          seq: 1,
          type: "world.arrived",
          worldId: "World_1-1",
          poiId: "Forest",
          movement: "walk",
          randomDraws: [],
        }],
        projection: v27Projection(2, "Forest"),
        idempotentReplay: false,
      });
    });

    const authority = await RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
      expectedSimulationVersion: OFFICIAL_CLIENT_SIMULATION_VERSION,
    });

    const result = await authority.command("slot-1", {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      expectedRevision: 1,
      command: { type: "world.navigate", targetPoiId: "Forest" },
    });

    expect(result.revision).toBe(2);
    expect(result.projection.location).toEqual({
      kind: "world",
      worldId: "World_1-1",
      poiId: "Forest",
    });
  });

  it("rejects a v27 projection that omits its required Collection claims", async () => {
    const { collectionClaims: _omitted, ...withoutClaims } = v27Projection(1);
    stubCurrentSession(() => jsonResponse(withoutClaims));

    const authority = await RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
      expectedSimulationVersion: OFFICIAL_CLIENT_SIMULATION_VERSION,
    });

    await expect(authority.bootstrap("slot-1")).rejects.toThrow(/collectionClaims/);
  });

  it("renews an expired bearer session once and retries the unchanged authorized request", async () => {
    let sessionCount = 0;
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/game/session") {
        sessionCount += 1;
        return new Response(JSON.stringify({
          protocolVersion: GAME_PROTOCOL_VERSION,
          selectedEventVersion: PRESENTATION_EVENT_VERSION,
          token: sessionCount === 1 ? "expired-session-token-value" : "renewed-session-token-value",
          expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
          pack,
          slots: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      const authorization = new Headers(init.headers).get("Authorization");
      if (authorization === "Bearer expired-session-token-value") {
        return new Response(JSON.stringify({
          error: {
            code: "SESSION_EXPIRED",
            message: "expired",
            retryable: false,
            correlationId: "corr-session-expired",
          },
        }), { status: 401, headers: { "Content-Type": "application/json" } });
      }
      expect(authorization).toBe("Bearer renewed-session-token-value");
      return new Response(JSON.stringify({
        protocolVersion: GAME_PROTOCOL_VERSION,
        slots: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const authority = await RemoteGameAuthority.authenticate({
      endpoint: "",
      loginToken: "invited-login-token",
      logicPackId,
    });
    await expect(authority.refreshSlots()).resolves.toEqual([]);
    expect(sessionCount).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("Official session renewal before expiry", () => {
  it("shares one renewal across campaign and PvP requests without changing their bodies", async () => {
    let now = Date.parse("2026-10-07T00:00:00Z"), sessions = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const requests: Array<{ url: string; authorization: string | null; body: BodyInit | null | undefined }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      if (url === "/api/game/session") {
        sessions++;
        if (sessions === 2) await held;
        return jsonResponse({ protocolVersion: GAME_PROTOCOL_VERSION, selectedEventVersion: PRESENTATION_EVENT_VERSION,
          token: `session-${sessions}-long-enough-token`, expiresAt: new Date(now + 60_000).toISOString(), pack: v27Pack, slots: [] });
      }
      requests.push({ url, authorization: new Headers(init.headers).get("Authorization"), body: init.body });
      if (url.endsWith("/commands")) return jsonResponse({ protocolVersion: GAME_PROTOCOL_VERSION,
        commandId: "renewal-command-01", previousRevision: 1, revision: 2, eventCursorStart: 0,
        eventCursorEnd: 0, events: [], projection: v27Projection(2), idempotentReplay: false });
      return jsonResponse(url.startsWith("/api/pvp/") ? { accepted: true } : { protocolVersion: GAME_PROTOCOL_VERSION, slots: [] });
    }));
    const authority = await RemoteGameAuthority.authenticate({ endpoint: "", loginToken: "private-login-token", logicPackId });
    now += 29_999;
    await authority.refreshSlots();
    expect(sessions).toBe(1);
    expect(requests[0]?.authorization).toBe("Bearer session-1-long-enough-token");
    now++;
    const envelope = { protocolVersion: GAME_PROTOCOL_VERSION, commandId: "renewal-command-01", expectedRevision: 1,
      command: { type: "world.navigate" as const, targetPoiId: "Forest" } };
    const command = authority.command("slot-1", envelope);
    const pvpBody = JSON.stringify({ requestId: "unchanged-pvp" });
    const pvp = authority.pvpTransport("/api/pvp/invites", { method: "POST", body: pvpBody });
    const slots = authority.refreshSlots();
    expect(sessions).toBe(2);
    expect(requests).toHaveLength(1);
    release(); await Promise.all([command, pvp, slots]);
    expect(sessions).toBe(2);
    expect(requests.slice(1).map(request => request.authorization)).toEqual(Array(3).fill("Bearer session-2-long-enough-token"));
    expect(requests.find(request => request.url.endsWith("/commands"))?.body).toBe(JSON.stringify(envelope));
    expect(requests.find(request => request.url.startsWith("/api/pvp/"))?.body).toBe(pvpBody);
  });

  it("does not dispatch a protected request when proactive renewal fails", async () => {
    let now = Date.parse("2026-10-07T00:00:00Z"), sessions = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const commands = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url !== "/api/game/session") { commands(); throw new Error("Must not dispatch game command"); }
      if (++sessions > 1) return new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED",
        message: "login revoked", retryable: false, correlationId: "corr-revoked" } }), { status: 401 });
      return jsonResponse({ protocolVersion: GAME_PROTOCOL_VERSION, selectedEventVersion: PRESENTATION_EVENT_VERSION,
        token: "first-session-token-long-enough", expiresAt: new Date(now + 60_000).toISOString(), pack: v27Pack, slots: [] });
    }));
    const authority = await RemoteGameAuthority.authenticate({ endpoint: "", loginToken: "private-login-token", logicPackId });
    now += 60_001;
    await expect(authority.refreshSlots()).rejects.toMatchObject({ code: "AUTH_REQUIRED", retryable: false });
    expect(commands).not.toHaveBeenCalled();
    expect(sessions).toBe(2);
  });

  it("rejects a simulation change during proactive renewal before sending gameplay", async () => {
    let now = Date.parse("2026-10-07T00:00:00Z"), sessions = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      expect(url).toBe("/api/game/session"); sessions++;
      return jsonResponse({ protocolVersion: GAME_PROTOCOL_VERSION, selectedEventVersion: PRESENTATION_EVENT_VERSION,
        token: "session-token-long-enough", expiresAt: new Date(now + 60_000).toISOString(),
        pack: sessions === 1 ? v27Pack : { ...v27Pack, simulationVersion: OFFICIAL_GAME_V18_SIMULATION_VERSION }, slots: [] });
    }));
    const authority = await RemoteGameAuthority.authenticate({ endpoint: "", loginToken: "private-login-token", logicPackId });
    now += 30_000;
    await expect(authority.refreshSlots()).rejects.toMatchObject({ code: "PACK_UNAVAILABLE" });
    expect(sessions).toBe(2);
  });
});
