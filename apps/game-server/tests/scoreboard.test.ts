import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SCOREBOARD_MAX_ENTRIES } from "@dib/game-protocol";
import { createScoreboardDirectory, type ScoreboardSlotSource } from "../src/scoreboard.js";
import { createAccount, authorizeLoginToken, generateLoginToken } from "../src/invites.js";
import { createLogger } from "../src/logging.js";

const secret = "test-secret-with-at-least-thirty-two-bytes-long";
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dib-scoreboard-"));
  directories.push(directory);
  return directory;
}

/** One slot's worth of the only two projection fields the board reads. */
function slot(heroLevel: number, heroTotalHighestLevels: number) {
  return { projection: { player: { heroLevel, heroTotalHighestLevels } } };
}

/**
 * A slot store standing in for `FileAuthoritativeSlotStore`. Reads are recorded so the cache tests
 * can assert on how often the fan-out actually ran, and a player id may be armed to throw.
 */
function fakeStore(
  slots: Record<string, ReturnType<typeof slot>[]>,
  failures: Record<string, Error> = {},
): ScoreboardSlotSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    list: async (playerId) => {
      reads.push(playerId);
      const failure = failures[playerId];
      if (failure !== undefined) throw failure;
      return slots[playerId] ?? [];
    },
  };
}

async function register(
  dataDirectory: string,
  username: string,
  publicScoreboard: boolean,
  issuedAtMs = 1_700_000_000_000,
): Promise<string> {
  const created = await createAccount({
    dataDirectory,
    hmacSecret: secret,
    username,
    publicScoreboard,
    maxAccounts: 1000,
    now: () => issuedAtMs,
  });
  return created.playerId;
}

describe("public most-XP scoreboard", () => {
  it("ranks opted-in accounts by their best slot and omits everyone else", async () => {
    const dataDirectory = await tempDir();
    const ada = await register(dataDirectory, "Ada", true);
    const grace = await register(dataDirectory, "Grace", true);
    const shy = await register(dataDirectory, "Shy", false);
    const fresh = await register(dataDirectory, "Fresh", true);
    const operator = await authorizeLoginToken({
      dataDirectory,
      hmacSecret: secret,
      token: generateLoginToken(),
      label: "operator",
    });

    const store = fakeStore({
      // The best slot wins, and its own level travels with it: a second save at a lower total
      // never displaces the first, and never lends it a level it did not earn.
      [ada]: [slot(9, 900), slot(21, 4820), slot(3, 40)],
      [grace]: [slot(30, 9001)],
      [shy]: [slot(40, 50_000)],
      [operator]: [slot(50, 90_000)],
      [fresh]: [],
    });
    const directory = createScoreboardDirectory({ dataDirectory, store, cacheTtlMs: 1000 });

    const board = await directory.list();
    expect(board.entries).toEqual([
      { rank: 1, username: "Grace", heroLevel: 30, totalXp: 9001 },
      { rank: 2, username: "Ada", heroLevel: 21, totalXp: 4820 },
    ]);
    // A private account, an account-less operator token, and a player who has never opened a slot
    // are all absent — the last would otherwise sit at zero and pad the board.
    expect(store.reads).not.toContain(operator);
    expect(JSON.stringify(board.entries)).not.toContain("Shy");
    expect(JSON.stringify(board.entries)).not.toContain("Fresh");
  });

  it("gives equal totals the same rank and skips the one after", async () => {
    const dataDirectory = await tempDir();
    const first = await register(dataDirectory, "First", true, 1_700_000_000_000);
    const tiedEarly = await register(dataDirectory, "TiedEarly", true, 1_700_000_001_000);
    const tiedLate = await register(dataDirectory, "TiedLate", true, 1_700_000_002_000);
    const last = await register(dataDirectory, "Last", true, 1_700_000_003_000);
    const store = fakeStore({
      [first]: [slot(10, 500)],
      [tiedEarly]: [slot(8, 300)],
      [tiedLate]: [slot(9, 300)],
      [last]: [slot(2, 100)],
    });

    const board = await createScoreboardDirectory({
      dataDirectory,
      store,
      cacheTtlMs: 1000,
    }).list();
    // Competition ranking: the pair share rank 2 and the next player is 4th, so the arbitrary
    // display order inside the tie never reads as one having beaten the other.
    expect(board.entries.map((entry) => [entry.rank, entry.username])).toEqual([
      [1, "First"],
      [2, "TiedEarly"],
      [2, "TiedLate"],
      [4, "Last"],
    ]);
  });

  it("truncates to the published maximum", async () => {
    const dataDirectory = await tempDir();
    const slots: Record<string, ReturnType<typeof slot>[]> = {};
    const total = SCOREBOARD_MAX_ENTRIES + 7;
    for (let index = 0; index < total; index += 1) {
      const playerId = await register(dataDirectory, `player-${index}`, true);
      slots[playerId] = [slot(1, index)];
    }

    const board = await createScoreboardDirectory({
      dataDirectory,
      store: fakeStore(slots),
      cacheTtlMs: 1000,
      concurrency: 4,
    }).list();

    expect(board.entries).toHaveLength(SCOREBOARD_MAX_ENTRIES);
    expect(board.entries[0]).toMatchObject({ rank: 1, totalXp: total - 1 });
    expect(board.entries.at(-1)).toMatchObject({ rank: SCOREBOARD_MAX_ENTRIES });
  });

  it("drops one unreadable player instead of failing the whole board", async () => {
    const dataDirectory = await tempDir();
    const ada = await register(dataDirectory, "Ada", true);
    const broken = await register(dataDirectory, "Broken", true);
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", write: (line) => { lines.push(line); } });

    const board = await createScoreboardDirectory({
      dataDirectory,
      store: fakeStore(
        { [ada]: [slot(4, 120)] },
        { [broken]: new Error("persisted projection is corrupt") },
      ),
      cacheTtlMs: 1000,
      logger,
    }).list();

    expect(board.entries).toEqual([{ rank: 1, username: "Ada", heroLevel: 4, totalXp: 120 }]);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      level: "warn",
      msg: "scoreboard skipped an unreadable player",
      playerId: broken,
    });
  });

  it("serves one aggregation for the whole TTL and rebuilds after it", async () => {
    const dataDirectory = await tempDir();
    const ada = await register(dataDirectory, "Ada", true);
    const store = fakeStore({ [ada]: [slot(4, 120)] });
    let clock = 1_000;
    const directory = createScoreboardDirectory({
      dataDirectory,
      store,
      cacheTtlMs: 30_000,
      now: () => clock,
    });

    const first = await directory.list();
    expect(store.reads).toHaveLength(1);
    expect(first.generatedAt).toBe(new Date(1_000).toISOString());

    clock = 29_999;
    expect(await directory.list()).toBe(first);
    expect(store.reads).toHaveLength(1);

    clock = 31_001;
    const rebuilt = await directory.list();
    expect(store.reads).toHaveLength(2);
    expect(rebuilt.generatedAt).toBe(new Date(31_001).toISOString());
  });

  it("shares one fan-out between readers that arrive on a cold cache together", async () => {
    const dataDirectory = await tempDir();
    const ada = await register(dataDirectory, "Ada", true);
    const store = fakeStore({ [ada]: [slot(4, 120)] });
    const directory = createScoreboardDirectory({ dataDirectory, store, cacheTtlMs: 30_000 });

    const boards = await Promise.all([directory.list(), directory.list(), directory.list()]);
    expect(store.reads).toHaveLength(1);
    expect(boards[1]).toBe(boards[0]);
    expect(boards[2]).toBe(boards[0]);
  });

  it("does not cache a failure", async () => {
    const dataDirectory = await tempDir();
    const ada = await register(dataDirectory, "Ada", true);
    const registry = join(dataDirectory, "invites.json");
    const healthy = await readFile(registry, "utf8");
    // A registry that cannot be read at all, unlike one player's unreadable save: there is no
    // board to serve, so this reaches the caller instead of being reported as an empty one.
    await writeFile(registry, "{\"schemaVersion\":1,\"invites\":{\"bad\":{}}}");

    const store = fakeStore({ [ada]: [slot(4, 120)] });
    const directory = createScoreboardDirectory({ dataDirectory, store, cacheTtlMs: 30_000 });
    await expect(directory.list()).rejects.toThrow("invite registry is corrupt");

    // The next reader retries rather than being served the outage for the rest of the TTL.
    await writeFile(registry, healthy);
    expect((await directory.list()).entries).toEqual([
      { rank: 1, username: "Ada", heroLevel: 4, totalXp: 120 },
    ]);
  });
});
