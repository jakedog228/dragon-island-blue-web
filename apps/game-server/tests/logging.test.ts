import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger, createRotatingFileSink, errorFields } from "../src/logging.js";

/**
 * The authority threat model forbids a login token, `Authorization` header, or the HMAC secret from
 * ever reaching a log sink. Redaction is enforced structurally rather than at each call site, so
 * these tests exist to keep that structural guarantee honest -- particularly the key-normalisation
 * that makes `X-Login-Token`, `login_token`, and `loginToken` all the same field.
 */

function capture(options: Parameters<typeof createLogger>[0] = {}) {
  const lines: string[] = [];
  const logger = createLogger({ now: () => 1_700_000_000_000, ...options, write: (line) => { lines.push(line); } });
  return {
    logger,
    records: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    raw: () => lines,
  };
}

describe("createLogger", () => {
  it("emits one JSON object per line", () => {
    const { logger, raw, records } = capture();
    logger.info("first");
    logger.info("second");
    expect(raw().every((line) => line.endsWith("\n"))).toBe(true);
    expect(raw().every((line) => line.trimEnd().includes("\n") === false)).toBe(true);
    expect(records()).toEqual([
      { time: "2023-11-14T22:13:20.000Z", level: "info", msg: "first" },
      { time: "2023-11-14T22:13:20.000Z", level: "info", msg: "second" },
    ]);
  });

  it("suppresses records below the configured level", () => {
    const { logger, records } = capture({ level: "warn" });
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    expect(records().map((record) => record["msg"])).toEqual(["w", "e"]);
  });

  it("stamps child fields onto every subsequent record", () => {
    const { logger, records } = capture();
    logger.child({ correlationId: "corr-1" }).info("handled", { status: 200 });
    expect(records()[0]).toMatchObject({ correlationId: "corr-1", status: 200 });
  });

  it("lets explicit fields override the base without dropping it", () => {
    const { logger, records } = capture();
    const child = logger.child({ route: "session", correlationId: "corr-1" });
    child.info("handled", { route: "commands" });
    expect(records()[0]).toMatchObject({ route: "commands", correlationId: "corr-1" });
  });
});

describe("redaction", () => {
  it("redacts secret-bearing fields regardless of key spelling", () => {
    const { logger, raw } = capture();
    logger.error("request failed", {
      loginToken: "invite-token-abcdefgh",
      "X-Login-Token": "invite-token-abcdefgh",
      login_token: "invite-token-abcdefgh",
      Authorization: "Bearer eyJhbGciOi",
      hmacSecret: "0123456789abcdef",
      playerId: "3f2a",
    });

    const line = raw()[0] as string;
    // Assert on the raw line: a value that survived anywhere in the JSON is a leak, whatever key
    // it ended up under.
    expect(line).not.toContain("invite-token-abcdefgh");
    expect(line).not.toContain("eyJhbGciOi");
    expect(line).not.toContain("0123456789abcdef");
    // Non-secret diagnostic fields must still survive, or redaction has cost the operator the log.
    expect(line).toContain("3f2a");
  });

  it("redacts prefixed and suffixed variants, not just the bare term", () => {
    const { logger, raw } = capture();
    logger.error("failed", {
      "X-Login-Token": "leak-a",
      sessionToken: "leak-b",
      hmacSecretFile: "leak-c",
      refreshCredentials: "leak-d",
      "SET-COOKIE": "leak-e",
    });
    // Header names arrive prefixed and wrapper fields arrive suffixed; exact-match redaction let
    // both straight through.
    expect(raw()[0]).not.toMatch(/leak-[a-e]/);
  });

  it("leaves ordinary diagnostic fields intact", () => {
    const { logger, records } = capture();
    logger.info("handled", {
      correlationId: "corr-9",
      playerId: "3f2a",
      logicPackId: "logic-v1:abcd",
      slotId: "slot-1",
      revision: 7,
      status: 200,
    });
    expect(records()[0]).toMatchObject({
      correlationId: "corr-9",
      playerId: "3f2a",
      logicPackId: "logic-v1:abcd",
      slotId: "slot-1",
      revision: 7,
      status: 200,
    });
  });

  it("redacts nested and array-held secrets", () => {
    const { logger, raw } = capture();
    logger.error("failed", {
      request: { headers: { authorization: "Bearer leaked-value" } },
      attempts: [{ token: "leaked-token" }],
    });
    const line = raw()[0] as string;
    expect(line).not.toContain("leaked-value");
    expect(line).not.toContain("leaked-token");
  });

  it("truncates rather than recursing forever on a cyclic object", () => {
    const { logger, raw } = capture();
    const cyclic: Record<string, unknown> = { name: "root" };
    cyclic["self"] = cyclic;
    // A log call that threw would take down the request it was reporting on.
    expect(() => { logger.error("cyclic", { cyclic }); }).not.toThrow();
    expect(raw()[0]).toContain("[truncated]");
  });
});

describe("errorFields", () => {
  it("carries the stack for the operator", () => {
    const fields = errorFields(new TypeError("boom"));
    expect(fields).toMatchObject({ errorName: "TypeError", errorMessage: "boom" });
    expect(String(fields["stack"])).toContain("TypeError: boom");
  });

  it("handles a thrown non-Error", () => {
    expect(errorFields("plain string")).toEqual({ errorMessage: "plain string" });
    expect(errorFields(undefined)).toEqual({ errorMessage: "undefined" });
  });

  it("records a cause", () => {
    const error = new Error("outer", { cause: new Error("inner") });
    expect(String(errorFields(error)["cause"])).toContain("inner");
  });
});

describe("createRotatingFileSink", () => {
  const directories: string[] = [];
  afterEach(async () => {
    for (const directory of directories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function sinkFixture(options: { maxBytes?: number; keep?: number } = {}) {
    const directory = await mkdtemp(join(tmpdir(), "dib-log-"));
    directories.push(directory);
    const path = join(directory, "nested", "game.log");
    return { path, sink: createRotatingFileSink({ path, ...options }) };
  }

  it("creates the directory and appends one line per record", async () => {
    const { path, sink } = await sinkFixture();
    sink("{\"a\":1}\n");
    sink("{\"a\":2}\n");
    expect(readFileSync(path, "utf8")).toBe("{\"a\":1}\n{\"a\":2}\n");
  });

  it("rolls by size and keeps a bounded number of generations", async () => {
    // 40 bytes holds two of these 20-byte lines, so every third write rolls.
    const { path, sink } = await sinkFixture({ maxBytes: 40, keep: 2 });
    for (let index = 0; index < 9; index += 1) sink(`${String(index).repeat(19)}\n`);

    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.1`)).toBe(true);
    expect(existsSync(`${path}.2`)).toBe(true);
    // The whole point of a bound: generation 3 must never accumulate.
    expect(existsSync(`${path}.3`)).toBe(false);

    // The newest generation holds the newest rolled content, not the oldest.
    expect(readFileSync(`${path}.1`, "utf8").trim()).toContain("7");
  });

  it("keeps serving the process when the log destination fails", async () => {
    const { path, sink } = await sinkFixture();
    sink("{\"a\":1}\n");
    // A directory where the log file belongs is the cheap stand-in for a full or unmounted volume:
    // every append fails. A logging fault must never become a request fault.
    rmSync(path);
    mkdirSync(path);
    expect(() => { sink("{\"a\":2}\n"); }).not.toThrow();
  });
});
