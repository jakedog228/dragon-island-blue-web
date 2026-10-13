import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { PvpBattleSnapshotV1Schema, PvpClientSetupV1Schema, PvpMatchViewV1Schema, PvpRosterMemberV1Schema, PvpSpiritSetupV1Schema } from "@dib/game-protocol";
import { durableWriteFile } from "./durableWrite.js";

const participant = z.object({
  principalId: z.string().min(1).max(200),
  name: z.string().min(1).max(60), source: z.enum(["official", "offline"]),
  setup: PvpClientSetupV1Schema,
  party: z.array(PvpRosterMemberV1Schema).min(1).max(32),
  spirits: PvpSpiritSetupV1Schema.optional(),
}).strict();
// Store response metadata once, with replay-prefix lengths instead of quadratic transcript copies.
const receipt = z.object({
  principalId: z.string().min(1).max(200), requestId: z.uuid(), body: z.string().max(65536),
  // The first local prototype omitted the redundant rules identity from receipts. It remains
  // provable from the match's immutable participant setup; current responses always include it.
  view: PvpMatchViewV1Schema.partial({ logicPackId: true }).omit({ battle: true }),
  commands: z.number().int().nonnegative().optional(), draws: z.number().int().nonnegative().optional(),
}).strict();
const record = z.object({
  id: z.uuid(), code: z.string().regex(/^[A-HJ-NP-Z2-9]{8}$/), revision: z.number().int().nonnegative(),
  status: z.enum(["waiting", "active", "ended", "cancelled", "expired"]),
  players: z.array(participant).min(1).max(2),
  expiresAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  profileId: z.string().min(1).max(160).optional(), notes: z.array(z.string().max(500)).max(16),
  battle: PvpBattleSnapshotV1Schema.optional(),
  turn: z.union([z.literal(0), z.literal(1)]).optional(),
  winner: z.union([z.literal(0), z.literal(1), z.literal("draw")]).optional(),
  endReason: z.enum(["defeat", "forfeit", "escape", "turn-limit", "timeout"]).optional(),
  receipts: z.array(receipt).max(2005),
}).strict();
export const PvpStoreStateSchema = z.object({ schemaVersion: z.literal(1), matches: z.array(record).max(1024) }).strict()
  .superRefine((state, ctx) => {
    const ids = new Set<string>();
    const codes = new Set<string>();
    const activePlayers = new Set<string>();
    const requests = new Set<string>();
    for (const match of state.matches) {
      const fail = (message: string) => ctx.addIssue({ code: "custom", message: `PvP ${match.id}: ${message}` });
      if (ids.has(match.id) || codes.has(match.code)) fail("duplicate match ID or invite code");
      ids.add(match.id); codes.add(match.code);
      if (new Set(match.players.map((player) => player.principalId)).size !== match.players.length) fail("a player occupies both sides");
      if (match.status === "waiting" || match.status === "active") {
        for (const player of match.players) {
          if (activePlayers.has(player.principalId)) fail("player has multiple active matches");
          activePlayers.add(player.principalId);
        }
      }
      const hasBattle = match.status === "active" || match.status === "ended";
      if (hasBattle !== (match.battle !== undefined) || hasBattle !== (match.players.length === 2)) fail("battle lifecycle is inconsistent");
      if (hasBattle && !match.profileId) fail("battle has no installed profile");
      if ((match.status === "active") !== (match.turn !== undefined)) fail("turn owner is inconsistent");
      if ((match.status === "ended") !== (match.winner !== undefined && match.endReason !== undefined)) fail("terminal result is inconsistent");
      for (const item of match.receipts) {
        const requestKey = `${item.principalId}:${item.requestId}`;
        if (requests.has(requestKey)) fail("duplicate request receipt");
        requests.add(requestKey);
        if (!match.players.some((player) => player.principalId === item.principalId)) fail("receipt belongs to a nonparticipant");
        if (item.view.matchId !== match.id || item.view.revision > match.revision) fail("receipt version is inconsistent");
        if (item.view.logicPackId !== undefined && item.view.logicPackId !== match.players[0]!.setup.logicPackId) fail("receipt rules identity is inconsistent");
        if ((item.commands === undefined) !== (item.draws === undefined)) fail("receipt has a partial battle prefix");
        if (item.commands !== undefined && (!match.battle || item.commands > match.battle.commands.length || item.draws! > match.battle.randomDraws.length)) fail("receipt exceeds battle transcript");
      }
    }
  });
export type PvpStoreState = z.infer<typeof PvpStoreStateSchema>;
function parseState(value: unknown): PvpStoreState {
  const parsed = PvpStoreStateSchema.safeParse(value);
  if (!parsed.success) throw new Error("PvP store failed integrity validation", { cause: parsed.error });
  return parsed.data;
}
export type PvpMatchRecord = PvpStoreState["matches"][number];
export type PvpParticipant = PvpMatchRecord["players"][number];
export interface PvpStore {
  transaction<T>(operation: (state: PvpStoreState) => Promise<T> | T): Promise<T>;
}

/** One process, like FileAuthoritativeSlotStore. A database transaction is required for replicas. */
const queues = new Map<string, Promise<unknown>>();
export class FilePvpStore implements PvpStore {
  private readonly path: string;
  constructor(directory: string) { this.path = join(resolve(directory), "pvp.json"); }
  transaction<T>(operation: (state: PvpStoreState) => Promise<T> | T): Promise<T> {
    const next = (queues.get(this.path) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      let state: PvpStoreState;
      try { state = parseState(JSON.parse(await readFile(this.path, "utf8"))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        state = { schemaVersion: 1, matches: [] };
      }
      const before = JSON.stringify(state);
      const result = await operation(state);
      const after = JSON.stringify(parseState(state));
      if (after !== before) await durableWriteFile(this.path, after);
      return structuredClone(result);
    });
    queues.set(this.path, next);
    void next.finally(() => { if (queues.get(this.path) === next) queues.delete(this.path); }).catch(() => undefined);
    return next;
  }
}

/** Test/development only, with the same serialization and rollback semantics as the file store. */
export class InMemoryPvpStore implements PvpStore {
  private state: PvpStoreState = { schemaVersion: 1, matches: [] };
  private queue: Promise<unknown> = Promise.resolve();
  transaction<T>(operation: (state: PvpStoreState) => Promise<T> | T): Promise<T> {
    const next = this.queue.catch(() => undefined).then(async () => {
      const pending = structuredClone(this.state);
      const result = await operation(pending);
      this.state = parseState(pending);
      return structuredClone(result);
    });
    this.queue = next;
    return next;
  }
}
