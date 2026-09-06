import { SCOREBOARD_MAX_ENTRIES, type ScoreboardEntryV1 } from "@dib/game-protocol";
import type { ScoreboardDirectory } from "./gameServer.js";
import { listInvites } from "./invites.js";
import { errorFields, type Logger } from "./logging.js";

/**
 * The public most-XP board.
 *
 * There is no cross-player index anywhere in the authority: the slot store is addressed by
 * `(playerId, slotId)` and nothing enumerates players. The invite registry is the only list of who
 * exists, and it already carries both halves this needs -- the player id to join on and the
 * `publicScoreboard` opt-in -- so ranking is a fan-out over that list rather than a query.
 *
 * That makes a read O(accounts x slots) file reads, which is why every read goes through the cache
 * below instead of touching the disk directly.
 */

/**
 * The slice of the slot store the board reads. Narrowing it here keeps the aggregation independent
 * of the installed simulation's state type, and documents that the board never loads or replays
 * state -- only the already-validated projection the store persisted alongside it.
 */
export interface ScoreboardSlotSource {
  list(playerId: string): Promise<readonly {
    readonly projection: {
      readonly player: {
        readonly heroLevel: number;
        readonly heroTotalHighestLevels: number;
      };
    };
  }[]>;
}

export interface ScoreboardOptions {
  readonly dataDirectory: string;
  readonly store: ScoreboardSlotSource;
  /** How long an aggregation may be served before it is rebuilt. */
  readonly cacheTtlMs: number;
  /** Players read concurrently. Unbounded fan-out would open three descriptors per account at once. */
  readonly concurrency?: number;
  readonly now?: () => number;
  readonly logger?: Logger;
}

interface Board {
  readonly generatedAt: string;
  readonly entries: readonly ScoreboardEntryV1[];
}

const DEFAULT_CONCURRENCY = 8;

export function createScoreboardDirectory(options: ScoreboardOptions): ScoreboardDirectory {
  const now = options.now ?? Date.now;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  let cached: { readonly board: Board; readonly builtAt: number } | undefined;
  let inFlight: Promise<Board> | undefined;

  return {
    async list(): Promise<Board> {
      const current = cached;
      if (current !== undefined && now() - current.builtAt < options.cacheTtlMs) return current.board;
      // Single-flight: a burst of readers arriving on a cold cache shares one aggregation rather
      // than each starting its own fan-out over the whole registry.
      if (inFlight !== undefined) return inFlight;
      // A rejection is never cached -- only the fulfilled branch writes `cached` -- so an outage
      // costs the next reader a retry rather than being served for the rest of the TTL.
      const build = buildBoard(options, now, concurrency).then((board) => {
        cached = { board, builtAt: now() };
        return board;
      }).finally(() => {
        if (inFlight === build) inFlight = undefined;
      });
      inFlight = build;
      return build;
    },
  };
}

async function buildBoard(
  options: ScoreboardOptions,
  now: () => number,
  concurrency: number,
): Promise<Board> {
  const accounts = (await listInvites(options.dataDirectory)).filter(
    (record): record is typeof record & { username: string } =>
      record.username !== undefined && record.publicScoreboard === true,
  );

  const scored: {
    username: string;
    totalXp: number;
    heroLevel: number;
    createdAt: string;
  }[] = [];
  for (let index = 0; index < accounts.length; index += concurrency) {
    const batch = accounts.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (account) => {
      try {
        const slots = await options.store.list(account.playerId);
        // One entry per account, scored by its best slot: a player experimenting in a second save
        // never displaces their own first one. Level and total are taken from that *same* slot's
        // projection -- the pair the authority itself computed -- so they can never disagree.
        let best: { totalXp: number; heroLevel: number } | undefined;
        for (const slot of slots) {
          const total = slot.projection.player.heroTotalHighestLevels;
          if (best === undefined || total > best.totalXp) {
            best = { totalXp: total, heroLevel: slot.projection.player.heroLevel };
          }
        }
        // A registered player who has never played has no slots. They would all tie at the bottom
        // and pad the board, so they are simply not on it yet.
        if (best === undefined) return undefined;
        return { username: account.username, ...best, createdAt: account.issuedAt };
      } catch (error) {
        // One unreadable or corrupt save must not take the whole board down: that player drops out
        // of this aggregation and the operator gets a record of why.
        options.logger?.warn("scoreboard skipped an unreadable player", {
          playerId: account.playerId,
          ...errorFields(error),
        });
        return undefined;
      }
    }));
    for (const result of results) {
      if (result !== undefined) scored.push(result);
    }
  }

  scored.sort((left, right) => {
    if (left.totalXp !== right.totalXp) return right.totalXp - left.totalXp;
    // Deterministic tie-break so repeated reads agree: older account first, then by name. This
    // decides *display order* only; the ranks assigned below stay equal.
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? -1 : 1;
    return left.username.localeCompare(right.username);
  });

  const entries: ScoreboardEntryV1[] = [];
  let rank = 0;
  let previousXp: number | undefined;
  for (const [index, entry] of scored.slice(0, SCOREBOARD_MAX_ENTRIES).entries()) {
    // Competition ranking (1, 2, 2, 4): equal totals share a rank, so the arbitrary tie-break above
    // never presents one player as having beaten another they actually drew with.
    if (previousXp === undefined || entry.totalXp !== previousXp) rank = index + 1;
    previousXp = entry.totalXp;
    entries.push({
      rank,
      username: entry.username,
      heroLevel: entry.heroLevel,
      totalXp: entry.totalXp,
    });
  }

  return { generatedAt: new Date(now()).toISOString(), entries };
}
