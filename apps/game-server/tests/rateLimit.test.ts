import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PROTOCOL_VERSION, type LogicPackDescriptorV1 } from "@dib/game-protocol";
import { AuthoritativeGameService, GameServiceError, type GameCommandReducer } from "@dib/game-service";
import { createGameServer } from "../src/gameServer.js";
import { RateLimiter, resolveClientAddress } from "../src/rateLimit.js";

/**
 * `POST /api/game/session` is unauthenticated and converts a caller-supplied login token into a
 * player identity, so an unthrottled one is an online guessing oracle. These tests pin the two
 * properties that make the throttle worth having: it actually rejects, and it cannot be bypassed
 * by a client that writes its own `X-Forwarded-For`.
 */

const running: Array<ReturnType<typeof createGameServer>> = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

describe("RateLimiter", () => {
  it("admits the burst, then rejects with a whole-second retry hint", () => {
    let clock = 0;
    const limiter = new RateLimiter({ perMinute: 60, burst: 3, now: () => clock });

    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(true);

    const rejected = limiter.take("a");
    expect(rejected.allowed).toBe(false);
    // 60/minute is one token per second, and Retry-After has whole-second resolution.
    expect(rejected.retryAfterSeconds).toBe(1);
  });

  it("refills over time rather than resetting on a fixed window", () => {
    let clock = 0;
    const limiter = new RateLimiter({ perMinute: 60, burst: 2, now: () => clock });
    limiter.take("a");
    limiter.take("a");
    expect(limiter.take("a").allowed).toBe(false);

    clock += 1_000;
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);

    // A fixed window would have handed back the whole burst here; a bucket hands back one token.
    clock += 500;
    expect(limiter.take("a").allowed).toBe(false);
  });

  it("never refills past the burst depth", () => {
    let clock = 0;
    const limiter = new RateLimiter({ perMinute: 60, burst: 2, now: () => clock });
    clock += 3_600_000;
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(true);
    // An hour idle must not bank an hour of tokens.
    expect(limiter.take("a").allowed).toBe(false);
  });

  it("keys are independent", () => {
    const limiter = new RateLimiter({ perMinute: 60, burst: 1, now: () => 0 });
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
    expect(limiter.take("b").allowed).toBe(true);
  });

  describe("bounded key table", () => {
    it("evicts the least recently used key instead of growing without limit", () => {
      const limiter = new RateLimiter({ perMinute: 60, burst: 1, maxTrackedKeys: 3, now: () => 0 });
      for (let index = 0; index < 100; index += 1) limiter.take(`key-${index}`);
      // Without a bound, an attacker choosing 100k distinct addresses turns a request-rate problem
      // into a memory-exhaustion one.
      expect(limiter.trackedKeyCount).toBeLessThanOrEqual(3);
    });

    it("eviction cannot be used to refill an exhausted bucket", () => {
      const limiter = new RateLimiter({ perMinute: 60, burst: 1, maxTrackedKeys: 3, now: () => 0 });
      expect(limiter.take("victim").allowed).toBe(true);
      expect(limiter.take("victim").allowed).toBe(false);

      // Touching `victim` between the flood entries keeps it most-recently-used, so the flood
      // evicts its own keys rather than the exhausted one.
      for (let index = 0; index < 50; index += 1) {
        limiter.take(`flood-${index}`);
        expect(limiter.take("victim").allowed).toBe(false);
      }
    });
  });

  it("rejects nonsensical settings at construction", () => {
    expect(() => new RateLimiter({ perMinute: 0, burst: 1 })).toThrow(/perMinute/);
    expect(() => new RateLimiter({ perMinute: 60, burst: 0 })).toThrow(/burst/);
  });
});

describe("resolveClientAddress", () => {
  it("ignores X-Forwarded-For when no proxy is trusted", () => {
    // The header is caller-controlled. Honouring it on a directly exposed port would let any
    // client mint a fresh bucket per request.
    expect(resolveClientAddress("203.0.113.9", "198.51.100.4", false)).toBe("198.51.100.4");
  });

  it("takes the LAST hop when a proxy is trusted", () => {
    // Earlier entries were supplied by the client and may be forged; only the final entry is the
    // address the trusted proxy itself observed.
    expect(resolveClientAddress("1.1.1.1, 2.2.2.2, 203.0.113.9", "10.0.0.2", true))
      .toBe("203.0.113.9");
  });

  it("joins a repeated header before taking the last hop", () => {
    expect(resolveClientAddress(["1.1.1.1", "203.0.113.9"], "10.0.0.2", true)).toBe("203.0.113.9");
  });

  it("falls back to the socket address for an empty header", () => {
    expect(resolveClientAddress("  ,  ", "10.0.0.2", true)).toBe("10.0.0.2");
  });

  it("never returns undefined", () => {
    expect(resolveClientAddress(undefined, undefined, true)).toBe("unknown");
  });
});

// -------------------------------------------------------------------------------------------------
// HTTP boundary
// -------------------------------------------------------------------------------------------------

const pack: LogicPackDescriptorV1 = {
  logicPackId: `logic-v1:${"c".repeat(64)}`,
  simulationVersion: "official-game-v11",
  trustTier: "official",
  capabilities: {
    slot: true, world: false, battle: false, capture: false, spirit: false, party: false,
    economy: false, dungeon: false, quests: false, plot: false, tournaments: false,
    commandTypes: ["slot.create"],
  },
};

const reducer: GameCommandReducer<{ readonly poi: string }> = {
  apply() {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "unused by these tests");
  },
};

type RateLimitConfig = NonNullable<Parameters<typeof createGameServer>[0]["rateLimit"]>;

async function harness(rateLimit: RateLimitConfig | undefined) {
  const service = new AuthoritativeGameService({ pack, reducer, now: () => 1_700_000_000_000 });
  const server = createGameServer({
    hmacSecret: "x".repeat(32),
    services: [service],
    isInvited: () => true,
    now: () => 1_700_000_000_000,
    // `exactOptionalPropertyTypes` distinguishes an absent key from an explicit undefined.
    ...(rateLimit === undefined ? {} : { rateLimit }),
  });
  running.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

function sessionRequest(endpoint: string, headers: Record<string, string> = {}) {
  return fetch(`${endpoint}/api/game/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      protocolVersion: GAME_PROTOCOL_VERSION,
      loginToken: "invite-token-with-enough-length",
      logicPackId: pack.logicPackId,
      supportedEventVersions: ["presentation-events-v1"],
    }),
  });
}

describe("session route throttling", () => {
  it("returns 429 with RATE_LIMITED and Retry-After once the burst is spent", async () => {
    const endpoint = await harness({ session: { perMinute: 60, burst: 2 } });

    expect((await sessionRequest(endpoint)).status).toBe(200);
    expect((await sessionRequest(endpoint)).status).toBe(200);

    const throttled = await sessionRequest(endpoint);
    expect(throttled.status).toBe(429);
    expect(throttled.headers.get("retry-after")).toBe("1");
    expect(await throttled.json()).toMatchObject({
      // Reuses the protocol's existing code, so the client's retry handling needs no new branch.
      error: { code: "RATE_LIMITED", retryable: true },
    });
  });

  it("does not leak whether the login token was valid", async () => {
    const endpoint = await harness({ session: { perMinute: 60, burst: 1 } });
    await sessionRequest(endpoint);

    const throttled = await sessionRequest(endpoint);
    const body = await throttled.text();
    // A throttled response that distinguished a known token from an unknown one would restore the
    // oracle the limit exists to close.
    expect(body).not.toContain("invite-token");
    expect(body).not.toContain("UNAUTHORIZED");
  });

  it("ignores a client-supplied X-Forwarded-For when the proxy is not trusted", async () => {
    const endpoint = await harness({ session: { perMinute: 60, burst: 2 } });
    // Every request claims a different origin address; without trustProxy they must all land in
    // the same socket-keyed bucket.
    expect((await sessionRequest(endpoint, { "X-Forwarded-For": "203.0.113.1" })).status).toBe(200);
    expect((await sessionRequest(endpoint, { "X-Forwarded-For": "203.0.113.2" })).status).toBe(200);
    expect((await sessionRequest(endpoint, { "X-Forwarded-For": "203.0.113.3" })).status).toBe(429);
  });

  it("separates buckets by forwarded address when the proxy is trusted", async () => {
    const service = new AuthoritativeGameService({ pack, reducer, now: () => 1_700_000_000_000 });
    const server = createGameServer({
      hmacSecret: "x".repeat(32),
      services: [service],
      isInvited: () => true,
      now: () => 1_700_000_000_000,
      trustProxy: true,
      rateLimit: { session: { perMinute: 60, burst: 1 } },
    });
    running.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    expect((await sessionRequest(endpoint, { "X-Forwarded-For": "203.0.113.1" })).status).toBe(200);
    expect((await sessionRequest(endpoint, { "X-Forwarded-For": "203.0.113.1" })).status).toBe(429);
    // A genuinely different client behind the same proxy is not collateral damage.
    expect((await sessionRequest(endpoint, { "X-Forwarded-For": "203.0.113.2" })).status).toBe(200);
  });

  it("is unlimited when no rate limit is configured", async () => {
    const endpoint = await harness(undefined);
    for (let index = 0; index < 5; index += 1) {
      expect((await sessionRequest(endpoint)).status).toBe(200);
    }
  });
});
