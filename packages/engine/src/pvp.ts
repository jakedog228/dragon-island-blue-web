import { requirePvpAdapters, validatePvpAdapters, type PvpAdapterIdentity, type PvpBattleAdapter, type PvpBattleAdapterInstance, type PvpIntent } from "./pvpAdapters.js";
import type { GameData } from "@dib/gamedata";
import type { BattleEvent, TeamMemberSetup } from "./events.js";
import { BattleSession, type PlayerChoice } from "./session.js";
import { replayableRng, type ReplayableRng } from "./rng.js";

/** PvP is a port extension. It never changes a campaign's roster, wallet, or rewards. */
export const PVP_SIMULATION_VERSION = "pvp-v1" as const;
export type PvpTeam = 0 | 1;
export type PvpAction =
  | { readonly type: "ability"; readonly actorId: string; readonly slot: string; readonly targets: readonly string[] }
  | { readonly type: "delay"; readonly actorId: string }
  | { readonly type: "adapter"; readonly actorId: string; readonly rulesId: string; readonly command: string; readonly input: PvpIntent }
  | { readonly type: "forfeit" };
export interface PvpCommand {
  readonly team: PvpTeam;
  readonly action: PvpAction;
}
export interface PvpBattleSnapshot {
  readonly simulationVersion: typeof PVP_SIMULATION_VERSION;
  readonly teams: readonly [readonly TeamMemberSetup[], readonly TeamMemberSetup[]];
  readonly fightingGroupSize: number;
  /** Committed draws only; never a seed or future randomness. */
  readonly randomDraws: readonly number[];
  readonly commands: readonly PvpCommand[];
  readonly adapters?: readonly PvpAdapterIdentity[];
}
export type PvpDecision =
  | { readonly type: "turn"; readonly team: PvpTeam; readonly actorId: string; readonly choices: readonly PlayerChoice[] }
  | { readonly type: "ended"; readonly winner: PvpTeam | "draw"; readonly reason: "defeat" | "forfeit" | "escape" | "turn-limit" };
export interface RestoredPvpBattle {
  readonly session: BattleSession;
  readonly decision: PvpDecision;
  readonly events: readonly BattleEvent[];
  readonly extensions: ReadonlyMap<string, PvpBattleAdapterInstance>;
}

/** A bounded exhibition protects the service against endless heal/delay or all-berserk matches. */
const MAX_TURNS = 2000;

function nextDecision(session: BattleSession): PvpDecision {
  for (let guard = 0; guard < MAX_TURNS; guard++) {
    if (session.events.filter((event) => event.type === "turnStarted").length >= MAX_TURNS) {
      return { type: "ended", winner: "draw", reason: "turn-limit" };
    }
    if (session.retreated) {
      const escaped = [...session.events].reverse().find((event) => event.type === "escaped");
      if (!escaped || escaped.type !== "escaped") throw new Error("PvP escape has no acting monster");
      return { type: "ended", winner: session.teamOf(escaped.living) === 0 ? 1 : 0, reason: "escape" };
    }
    const step = session.advanceForPresentation();
    if (step.type === "ended") return { type: "ended", winner: step.report.winner, reason: "defeat" };
    if (step.type === "awaitingPlayer") {
      return { type: "turn", team: session.teamOf(step.actorId), actorId: step.actorId, choices: step.choices };
    }
    // Disabled, berserk and native-spirit turns retain the engine's automatic behavior.
    session.submitEnemyAction();
  }
  return { type: "ended", winner: "draw", reason: "turn-limit" };
}

function apply(session: BattleSession, decision: PvpDecision, command: PvpCommand, extensions: ReadonlyMap<string, PvpBattleAdapterInstance>): PvpDecision {
  if (command.team !== 0 && command.team !== 1) throw new Error("PvP team must be 0 or 1");
  if (decision.type === "ended") throw new Error("This PvP match has already ended.");
  if (command.action.type === "forfeit") {
    return { type: "ended", winner: command.team === 0 ? 1 : 0, reason: "forfeit" };
  }
  if (decision.team !== command.team) throw new Error("It is your opponent's turn.");
  if (decision.actorId !== command.action.actorId) throw new Error("That monster is no longer taking its turn. Refresh the match.");
  const action = command.action;
  const handler = action.type === "adapter" ? extensions.get(action.rulesId)?.commands?.[action.command] : undefined;
  if (action.type === "adapter" && (!handler || !Object.hasOwn(extensions.get(action.rulesId)!.commands!, action.command))) {
    throw new Error(`Unsupported PvP adapter command ${action.rulesId}:${action.command}`);
  }
  const parsed = action.type === "adapter" ? handler!.parse(structuredClone(action.input)) : undefined;
  for (const extension of extensions.values()) extension.beforeCommand?.(command, decision);
  switch (command.action.type) {
    case "ability": session.submitPlayerAction(command.action.slot, [...command.action.targets]); break;
    case "delay": session.submitDelayAction(); break;
    case "adapter": handler!.execute(parsed, decision); break;
    default: throw new Error("Unknown PvP action.");
  }
  for (const extension of extensions.values()) extension.afterCommand?.(command, decision);
  return nextDecision(session);
}

function replay(data: GameData, snapshot: PvpBattleSnapshot, tape: ReplayableRng, adapters: readonly PvpBattleAdapter[]): RestoredPvpBattle {
  requirePvpAdapters(snapshot.adapters ?? [], adapters);
  if (snapshot.simulationVersion !== PVP_SIMULATION_VERSION) throw new Error("Unsupported PvP simulation version.");
  if (!Number.isInteger(snapshot.fightingGroupSize) || snapshot.fightingGroupSize < 1 || snapshot.fightingGroupSize > 3) {
    throw new Error("PvP fighting group size must be 1, 2 or 3.");
  }
  if (snapshot.commands.length > MAX_TURNS + 1) throw new Error("PvP command limit exceeded.");
  const session = new BattleSession(data, structuredClone(snapshot.teams) as [TeamMemberSetup[], TeamMemberSetup[]], tape,
    { fightingGroupSize: snapshot.fightingGroupSize, humanTeams: [0, 1], blockCapture: true, silver: 0 });
  const extensions = new Map(adapters.map((adapter) => [adapter.rulesId, adapter.create({ data, session, random: () => tape.next() })]));
  let decision = nextDecision(session);
  for (const command of snapshot.commands) decision = apply(session, decision, command, extensions);
  return { session, decision, events: session.events, extensions };
}

export function createPvpBattle(
  data: GameData,
  teams: PvpBattleSnapshot["teams"],
  randomSource: () => number,
  fightingGroupSize = 3,
  adapters: readonly PvpBattleAdapter[] = [],
): { snapshot: PvpBattleSnapshot; restored: RestoredPvpBattle } {
  validatePvpAdapters(adapters);
  // No campaign identities or damage carry into this exhibition. Equipment and stat bonuses do.
  const exhibitionTeams = teams.map((team) => team.map(({ currentHp: _hp, sourceInstanceId: _id, ...member }) =>
    ({ ...member, capturable: false }))) as [TeamMemberSetup[], TeamMemberSetup[]];
  const initial: PvpBattleSnapshot = { simulationVersion: PVP_SIMULATION_VERSION, teams: structuredClone(exhibitionTeams),
    fightingGroupSize, randomDraws: [], commands: [],
    ...(adapters.length ? { adapters: adapters.map(({ rulesId, digest }) => ({ rulesId, digest })) } : {}) };
  const tape = replayableRng([], randomSource);
  const restored = replay(data, initial, tape, adapters);
  return { snapshot: { ...initial, randomDraws: tape.draws }, restored };
}

/** Restoring committed state may not consume new randomness, even on the authority. */
export function restorePvpBattle(data: GameData, snapshot: PvpBattleSnapshot, adapters: readonly PvpBattleAdapter[] = []): RestoredPvpBattle {
  const tape = replayableRng(snapshot.randomDraws);
  const restored = replay(data, snapshot, tape, adapters);
  if (tape.cursor !== snapshot.randomDraws.length) throw new Error("PvP snapshot has unused random draws.");
  return restored;
}

/** Detached replay gives the service rollback on invalid commands, mechanics errors or write failure. */
export function advancePvpBattle(
  data: GameData, snapshot: PvpBattleSnapshot, command: PvpCommand, randomSource: () => number,
  adapters: readonly PvpBattleAdapter[] = [],
): { snapshot: PvpBattleSnapshot; restored: RestoredPvpBattle } {
  const tape = replayableRng(snapshot.randomDraws);
  replay(data, snapshot, tape, adapters);
  if (tape.cursor !== snapshot.randomDraws.length) throw new Error("PvP snapshot has unused random draws.");
  // Restore with a fresh extensible tape only after validating the committed prefix in full.
  const nextTape = replayableRng(snapshot.randomDraws, randomSource);
  const next = replay(data, snapshot, nextTape, adapters);
  const decision = apply(next.session, next.decision, command, next.extensions);
  return {
    snapshot: { ...structuredClone(snapshot), commands: [...snapshot.commands, structuredClone(command)], randomDraws: nextTape.draws },
    restored: { session: next.session, decision, events: next.session.events, extensions: next.extensions },
  };
}
