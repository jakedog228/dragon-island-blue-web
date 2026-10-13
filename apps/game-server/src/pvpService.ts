import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import type { GameData } from "@dib/gamedata";
import { validatePvpAdapters, requirePvpAdapters, advancePvpBattle, createPvpBattle, restorePvpBattle, type PvpBattleAdapter, type PvpBattleSnapshot, type RestoredPvpBattle, type TeamMemberSetup } from "@dib/engine";
import {
  PVP_PROTOCOL_VERSION, PvpBattleSnapshotV1Schema, PvpCommandV1Schema, PvpInviteRequestV1Schema,
  PvpJoinRequestV1Schema, PvpMatchViewV1Schema, PvpRosterMemberV1Schema,
  type PvpClientSetupV1, type PvpCompatibilityIssueV1, type PvpEntryV1, type PvpErrorV1, type PvpMatchViewV1,
} from "@dib/game-protocol";
import type { SaveSlotId } from "@dib/save-protocol";
import { PvpCompatibilityRegistry } from "./pvpCompatibility.js";
import type { PvpMatchRecord, PvpParticipant, PvpStore, PvpStoreState } from "./pvpStore.js";
import { secureUnitRandom } from "./secureRandom.js";

const INVITE_TTL = 10 * 60_000;
const TURN_TTL = 5 * 60_000;
const RECEIPT_RETENTION = 24 * 60 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class PvpServiceError extends Error {
  constructor(readonly code: PvpErrorV1["code"], message: string, readonly issues: readonly PvpCompatibilityIssueV1[] = []) {
    super(message); this.name = "PvpServiceError";
  }
}
/** Supplied by authentication; never read from a player request body. */
export interface PvpPrincipal {
  readonly id: string;
  readonly name: string;
  readonly officialPlayerId?: string;
}
export interface PvpServiceOptions {
  readonly store: PvpStore;
  readonly compatibility: PvpCompatibilityRegistry;
  readonly profiles: ReadonlyMap<string, GameData>;
  readonly adapters?: ReadonlyMap<string, readonly PvpBattleAdapter[]>;
  /** Read a committed Official slot, verify its rules and that its party can enter an exhibition. */
  readonly officialParty: (playerId: string, slotId: SaveSlotId, logicPackId: string) => Promise<readonly TeamMemberSetup[]>;
  readonly now?: () => number;
  readonly randomSource?: () => number;
}

/** Isolated server-owned exhibition lifecycle. No method writes a campaign slot or awards rewards. */
export class PvpService {
  private readonly now: () => number;
  private readonly randomSource: () => number;
  constructor(private readonly options: PvpServiceOptions) {
    for (const id of options.profiles.keys()) {
      const rules = options.compatibility.rulesForProfile(id);
      const adapters = options.adapters?.get(id) ?? [];
      validatePvpAdapters(adapters);
      if (!rules || rules.length !== adapters.length || rules.some((rule, index) => rule !== adapters[index]?.rulesId)) {
        throw new Error(`PvP profile ${id} must execute exactly its declared adapters`);
      }
    }
    this.now = options.now ?? Date.now;
    this.randomSource = options.randomSource ?? secureUnitRandom;
  }

  private data(record: PvpMatchRecord): GameData {
    const data = record.profileId ? this.options.profiles.get(record.profileId) : undefined;
    if (!data) throw new PvpServiceError("UNAVAILABLE", "This match's battle rules are temporarily unavailable on the server. Try again after the server's rules are restored.");
    const compatible = this.options.compatibility.negotiate(record.players[0]!.setup, (record.players[1] ?? record.players[0])!.setup);
    if (!compatible.compatible || compatible.profileId !== record.profileId) {
      throw new PvpServiceError("UNAVAILABLE", "This match requires its original server rules and reviewed mod releases. The server must restore them before the match can continue.");
    }
    return data;
  }
  private adapters(record: PvpMatchRecord): readonly PvpBattleAdapter[] {
    const adapters = this.options.adapters?.get(record.profileId!) ?? [];
    try {
      if (record.battle) requirePvpAdapters(record.battle.adapters ?? [], adapters);
    } catch {
      throw new PvpServiceError("UNAVAILABLE", "This match requires its original ordered PvP adapters and exact rules digests. Ask the operator to restore them, or forfeit the match.");
    }
    return adapters;
  }
  private restore(record: PvpMatchRecord): RestoredPvpBattle {
    if (!record.battle) throw new Error("PvP record has no battle");
    return restorePvpBattle(this.data(record), record.battle as PvpBattleSnapshot, this.adapters(record));
  }
  private decisionId(record: PvpMatchRecord): string { return `pvp-${record.id}-${record.revision}`; }

  private view(record: PvpMatchRecord, principalId: string): PvpMatchViewV1 {
    const you = record.players.findIndex((player) => player.principalId === principalId);
    if (you !== 0 && you !== 1) throw new PvpServiceError("NOT_FOUND", "This PvP match is unavailable.");
    const turn = record.status === "active" ? this.restore(record).decision : undefined;
    return PvpMatchViewV1Schema.parse({
      protocolVersion: PVP_PROTOCOL_VERSION, matchId: record.id, revision: record.revision, status: record.status,
      logicPackId: record.players[0]!.setup.logicPackId,
      you, players: record.players.map(({ name, source }) => ({ name, source })), expiresAt: record.expiresAt,
      notes: record.notes,
      ...(record.status === "waiting" ? { code: record.code } : {}),
      ...(record.profileId ? { profileId: record.profileId } : {}),
      ...(record.battle ? { battle: record.battle } : {}),
      ...(turn?.type === "turn" ? { decisionId: this.decisionId(record), turn: turn.team } : {}),
      ...(record.winner !== undefined ? { winner: record.winner, endReason: record.endReason } : {}),
    });
  }

  private sweep(state: PvpStoreState): void {
    const now = this.now();
    state.matches = state.matches.filter((record) => record.status === "active" || record.status === "waiting" || now - record.updatedAt < RECEIPT_RETENTION);
    for (const record of state.matches) {
      if (record.expiresAt > now || (record.status !== "waiting" && record.status !== "active")) continue;
      if (record.status === "waiting") record.status = "expired";
      else {
        if (record.turn === undefined) throw new Error("Active PvP match has no player decision");
        record.status = "ended"; record.winner = record.turn === 0 ? 1 : 0; record.endReason = "timeout";
        delete record.turn;
      }
      record.revision++; record.updatedAt = now;
    }
  }

  private retry(state: PvpStoreState, principalId: string, requestId: string, body: string): PvpMatchViewV1 | undefined {
    for (const record of state.matches) {
      const receipt = record.receipts.find((item) => item.principalId === principalId && item.requestId === requestId);
      if (!receipt) continue;
      if (receipt.body !== body) throw new PvpServiceError("COMMAND_CONFLICT", "This request ID was already used for a different PvP action.");
      const battle = receipt.commands === undefined ? undefined : {
        ...record.battle!, commands: record.battle!.commands.slice(0, receipt.commands), randomDraws: record.battle!.randomDraws.slice(0, receipt.draws),
      };
      return PvpMatchViewV1Schema.parse({ ...receipt.view,
        logicPackId: receipt.view.logicPackId ?? record.players[0]!.setup.logicPackId,
        ...(battle ? { battle } : {}) });
    }
    return undefined;
  }
  private receipt(record: PvpMatchRecord, principalId: string, requestId: string, body: string): PvpMatchViewV1 {
    const result = this.view(record, principalId);
    const { battle, ...view } = result;
    record.receipts.push({ principalId, requestId, body, view,
      ...(battle ? { commands: battle.commands.length, draws: battle.randomDraws.length } : {}) });
    return result;
  }
  private requireAvailable(state: PvpStoreState, principalId: string): void {
    if (state.matches.some((record) => (record.status === "waiting" || record.status === "active") && record.players.some((player) => player.principalId === principalId))) {
      throw new PvpServiceError("ALREADY_ACTIVE", "You already have an open invitation or match. Resume it or leave it before starting another.");
    }
  }
  private async participant(principal: PvpPrincipal, setup: PvpClientSetupV1, entry: PvpEntryV1): Promise<PvpParticipant> {
    let party: readonly TeamMemberSetup[];
    if (entry.source === "official") {
      if (!principal.officialPlayerId) throw new PvpServiceError("UNAUTHORIZED", "Sign in to use an Official party for PvP.");
      party = await this.options.officialParty(principal.officialPlayerId, entry.slotId, setup.logicPackId);
    } else party = entry.party as TeamMemberSetup[];
    // Strip campaign identity and current HP from trusted Official rosters too.
    const sanitized = party.map(({ currentHp: _hp, sourceInstanceId: _id, capturable: _capture, ...member }) => PvpRosterMemberV1Schema.parse(member));
    return { principalId: principal.id, name: principal.name, source: entry.source, setup, party: sanitized };
  }
  private settle(record: PvpMatchRecord, restored: RestoredPvpBattle): void {
    record.updatedAt = this.now(); record.expiresAt = this.now() + TURN_TTL;
    if (restored.decision.type === "ended") {
      record.status = "ended"; record.winner = restored.decision.winner; record.endReason = restored.decision.reason;
      delete record.turn;
    } else record.turn = restored.decision.team;
  }

  async invite(principal: PvpPrincipal, value: unknown): Promise<PvpMatchViewV1> {
    const input = PvpInviteRequestV1Schema.parse(value);
    const body = JSON.stringify({ type: "invite", ...input });
    return this.options.store.transaction(async (state) => {
      this.sweep(state);
      const retry = this.retry(state, principal.id, input.requestId, body);
      if (retry) return retry;
      this.requireAvailable(state, principal.id);
      if (state.matches.length >= 1024) throw new PvpServiceError("UNAVAILABLE", "The PvP server is at capacity. Please try again later.");
      // Discover unsupported personal setups before giving the player a code to share.
      const compatible = this.options.compatibility.negotiate(input.setup, input.setup);
      if (!compatible.compatible) throw new PvpServiceError("INCOMPATIBLE", "Your setup needs changes before it can enter PvP.", compatible.issues);
      let code: string;
      do { code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(""); }
      while (state.matches.some((record) => record.code === code));
      const host = await this.participant(principal, input.setup, input.entry);
      const record: PvpMatchRecord = { id: randomUUID(), code, revision: 0, status: "waiting", players: [host],
        expiresAt: this.now() + INVITE_TTL, updatedAt: this.now(), notes: [], receipts: [] };
      state.matches.push(record);
      return this.receipt(record, principal.id, input.requestId, body);
    });
  }

  async join(principal: PvpPrincipal, value: unknown): Promise<PvpMatchViewV1> {
    const input = PvpJoinRequestV1Schema.parse(value);
    const body = JSON.stringify({ type: "join", ...input });
    return this.options.store.transaction(async (state) => {
      this.sweep(state);
      const retry = this.retry(state, principal.id, input.requestId, body);
      if (retry) return retry;
      const record = state.matches.find((candidate) => candidate.code === input.code);
      if (!record) throw new PvpServiceError("NOT_FOUND", "No invitation matches that code. Check the code with your opponent.");
      if (record.players[0]!.principalId === principal.id) throw new PvpServiceError("SELF_JOIN", "Share your code with another player; you cannot join your own invitation.");
      if (record.status === "expired") throw new PvpServiceError("INVITE_EXPIRED", "That invitation has expired. Ask your opponent for a new code.");
      if (record.status !== "waiting") throw new PvpServiceError("INVITE_UNAVAILABLE", "That invitation has already been used or cancelled. Ask for a new code.");
      this.requireAvailable(state, principal.id);
      const compatible = this.options.compatibility.negotiate(record.players[0]!.setup, input.setup);
      if (!compatible.compatible) throw new PvpServiceError("INCOMPATIBLE", "These setups cannot fight together yet.", compatible.issues);
      record.profileId = compatible.profileId;
      const guest = await this.participant(principal, input.setup, input.entry);
      let battle;
      try {
        battle = createPvpBattle(this.data(record), [record.players[0]!.party as TeamMemberSetup[], guest.party as TeamMemberSetup[]], this.randomSource, 3, this.adapters(record));
      } catch (error) {
        if (error instanceof PvpServiceError) throw error;
        throw new PvpServiceError("INCOMPATIBLE", "A selected party cannot be simulated by this server.", [{ code: "PARTY_UNSUPPORTED", path: "entry.party",
          message: String(error instanceof Error ? error.message : error).slice(0, 500), suggestion: "Check the named monster or ability and use a server-supported mod release." }]);
      }
      record.players.push(guest); record.status = "active"; record.revision++;
      record.notes = [...compatible.notes]; record.battle = PvpBattleSnapshotV1Schema.parse(battle.snapshot);
      this.settle(record, battle.restored);
      return this.receipt(record, principal.id, input.requestId, body);
    });
  }

  async read(principal: PvpPrincipal, matchId?: string): Promise<PvpMatchViewV1 | undefined> {
    if (matchId !== undefined) z.uuid().parse(matchId);
    return this.options.store.transaction((state) => {
      this.sweep(state);
      const owned = [...state.matches].reverse().filter((candidate) => candidate.players.some((player) => player.principalId === principal.id));
      const record = matchId ? state.matches.find((candidate) => candidate.id === matchId) :
        owned.find((candidate) => candidate.status === "active" || candidate.status === "waiting") ?? owned[0];
      if (!record) {
        if (matchId) throw new PvpServiceError("NOT_FOUND", "This PvP match is unavailable.");
        return undefined;
      }
      return this.view(record, principal.id);
    });
  }

  async command(principal: PvpPrincipal, matchId: string, value: unknown): Promise<PvpMatchViewV1> {
    z.uuid().parse(matchId);
    const input = PvpCommandV1Schema.parse(value);
    const body = JSON.stringify({ type: "command", matchId, ...input });
    return this.options.store.transaction((state) => {
      this.sweep(state);
      const retry = this.retry(state, principal.id, input.commandId, body);
      if (retry) return retry;
      const record = state.matches.find((candidate) => candidate.id === matchId);
      const team = record?.players.findIndex((player) => player.principalId === principal.id);
      if (!record || (team !== 0 && team !== 1)) throw new PvpServiceError("NOT_FOUND", "This PvP match is unavailable.");
      if (record.status !== "active") throw new PvpServiceError("MATCH_ENDED", "This PvP match is no longer active.");
      if (record.revision !== input.expectedRevision || this.decisionId(record) !== input.decisionId) {
        throw new PvpServiceError("STALE_DECISION", "The match has moved on. Refresh it before choosing your next action.");
      }
      // Forfeit changes only match ownership/outcome. It must remain available if an operator
      // removes the old rules during a match; no mechanical replay or new randomness is needed.
      if (input.action.type === "forfeit") {
        record.battle = PvpBattleSnapshotV1Schema.parse({ ...record.battle!,
          commands: [...record.battle!.commands, { team, action: input.action }] });
        record.status = "ended"; record.winner = team === 0 ? 1 : 0; record.endReason = "forfeit";
        delete record.turn;
        record.revision++; record.updatedAt = this.now();
        return this.receipt(record, principal.id, input.commandId, body);
      }
      const restored = this.restore(record);
      if (restored.decision.type === "turn" && restored.decision.team !== team) {
        throw new PvpServiceError("NOT_YOUR_TURN", "It is your opponent's turn.");
      }
      let advanced;
      try { advanced = advancePvpBattle(this.data(record), record.battle as PvpBattleSnapshot, { team, action: input.action }, this.randomSource, this.adapters(record)); }
      catch (error) { throw new PvpServiceError("INVALID_REQUEST", String(error instanceof Error ? error.message : error).slice(0, 500)); }
      record.battle = PvpBattleSnapshotV1Schema.parse(advanced.snapshot); record.revision++;
      this.settle(record, advanced.restored);
      return this.receipt(record, principal.id, input.commandId, body);
    });
  }

  async cancel(principal: PvpPrincipal, matchId: string, requestId: string): Promise<PvpMatchViewV1> {
    z.uuid().parse(matchId); z.uuid().parse(requestId);
    const body = JSON.stringify({ type: "cancel", matchId, requestId });
    return this.options.store.transaction((state) => {
      this.sweep(state);
      const retry = this.retry(state, principal.id, requestId, body);
      if (retry) return retry;
      const record = state.matches.find((candidate) => candidate.id === matchId && candidate.players[0]!.principalId === principal.id);
      if (!record) throw new PvpServiceError("NOT_FOUND", "This PvP match is unavailable.");
      if (record.status !== "waiting") throw new PvpServiceError("INVITE_UNAVAILABLE", "This invitation is no longer waiting. Open the match to leave it.");
      record.status = "cancelled"; record.revision++; record.updatedAt = this.now();
      return this.receipt(record, principal.id, requestId, body);
    });
  }
}
