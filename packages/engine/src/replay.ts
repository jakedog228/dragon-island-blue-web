import type { GameData } from "@dib/gamedata";
import type { BattleEvent, TeamMemberSetup } from "./events.js";
import { mulberry32, replayableRng, type ReplayableRng, type Rng } from "./rng.js";
import {
  BattleSession,
  type PlayerChoice,
  type PresentationSessionStep,
} from "./session.js";

export interface BattleReplaySnapshotV1 {
  readonly schemaVersion: 1;
  /** Private server state. This snapshot is never part of a public authority projection. */
  readonly seed?: number;
  /**
   * Private exact random tape. Unlike a deterministic seed, committed prefixes may be disclosed
   * to a presentation client without disclosing any future server randomness.
   */
  readonly randomDraws?: readonly number[];
  readonly teams: readonly [
    readonly TeamMemberSetup[],
    readonly TeamMemberSetup[],
  ];
  readonly options: {
    readonly fightingGroupSize?: number;
    readonly blockCapture?: boolean;
    readonly silver?: number;
  };
  readonly commands: readonly BattleReplayCommandV1[];
}

export type BattleReplayCommandV1 =
  | {
      readonly type: "ability";
      readonly actorId: string;
      readonly slot: string;
      readonly targetIds: readonly string[];
    }
  | {
      readonly type: "capture";
      readonly actorId: string;
      readonly targetId: string;
      readonly cardLevel: 1 | 2 | 3;
      /** Private server-derived value retained solely for exact deterministic replay. */
      readonly partyLevel: number;
      /** Shared-wallet capture-card purchase debit applied at this exact transcript position. */
      readonly externalSilverDebit?: number;
    }
  | { readonly type: "delay"; readonly actorId: string }
  | { readonly type: "retreat"; readonly actorId: string }
  | {
      readonly type: "summonSpirit";
      readonly actorId: string;
      readonly shortType: string;
      /** Private server-derived saved XP, never accepted from a public battle command. */
      readonly savedXp: number;
    };

export interface RestoredBattleReplay {
  readonly session: BattleSession;
  readonly step: BattleReplayStep;
  readonly events: readonly BattleEvent[];
  readonly decisionId?: string;
  /** Present for draw-tape snapshots; includes trusted-source extensions made during restore. */
  readonly randomDraws?: readonly number[];
}

export type BattleReplayStep =
  | PresentationSessionStep
  | { readonly type: "retreated" };

/**
 * Restores an active battle by replaying its server-private seed and accepted semantic commands.
 * This is deliberately a correctness-first snapshot codec: it retains every RNG draw and queue
 * ordering without attempting to serialize callback-bearing engine internals. A later structural
 * snapshot may optimize long battles but must remain differential with this implementation.
 */
export function restoreBattleReplay(
  data: GameData,
  value: BattleReplaySnapshotV1,
  options: {
    readonly randomSource?: () => number;
    /** Shared presentation tape that may receive committed suffixes after reconnect. */
    readonly replayRng?: ReplayableRng;
  } = {},
): RestoredBattleReplay {
  validateSnapshot(value);
  if (options.replayRng !== undefined && value.randomDraws === undefined) {
    throw new Error("restoreBattleReplay replayRng requires a random-draw snapshot");
  }
  if (
    options.replayRng !== undefined &&
    JSON.stringify(options.replayRng.draws) !== JSON.stringify(value.randomDraws)
  ) {
    throw new Error("restoreBattleReplay replayRng does not match the committed snapshot tape");
  }
  const tape = options.replayRng ?? (value.randomDraws === undefined
    ? undefined
    : replayableRng(value.randomDraws, options.randomSource));
  return restoreBattleReplayWithRng(
    data,
    value,
    tape ?? mulberry32(value.seed!),
    tape,
  );
}

function restoreBattleReplayWithRng(
  data: GameData,
  value: BattleReplaySnapshotV1,
  rng: Rng,
  tape?: ReplayableRng,
): RestoredBattleReplay {
  const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
    value.teams[0].map(cloneSetup),
    value.teams[1].map(cloneSetup),
  ];
  const session = new BattleSession(data, teams, rng, value.options);
  let step: BattleReplayStep = advanceThroughAutomaticTurns(session);
  for (const [index, command] of value.commands.entries()) {
    if (step.type !== "awaitingPlayer") {
      throw new Error(`battle replay command ${index} exists while battle is ${step.type}`);
    }
    if (step.actorId !== command.actorId) {
      throw new Error(
        `battle replay command ${index} actor ${command.actorId} does not match ${step.actorId}`,
      );
    }
    if (command.type === "summonSpirit") {
      session.summonSpirit(command.shortType, command.savedXp);
      // Hero summon is a side command and does not consume the pending player's turn.
      continue;
    }
    applyTurnCommand(session, step.choices, command);
    step = session.retreated ? { type: "retreated" } : advanceThroughAutomaticTurns(session);
  }
  return {
    session,
    step,
    events: session.events,
    ...(step.type === "awaitingPlayer"
      ? { decisionId: battleReplayDecisionId(value.commands.length, step.actorId) }
      : {}),
    ...(tape === undefined ? {} : { randomDraws: tape.draws }),
  };
}

export interface AdvancedBattleReplay {
  readonly snapshot: BattleReplaySnapshotV1;
  readonly restored: RestoredBattleReplay;
  readonly committedDraws: readonly number[];
}

/**
 * Applies one player command to a private replay snapshot and resolves every automatic turn up to
 * the next decision. The command and every newly consumed draw are returned together so callers
 * can atomically persist them with terminal settlement.
 */
export function advanceBattleReplay(
  data: GameData,
  snapshot: BattleReplaySnapshotV1,
  command: BattleReplayCommandV1,
  randomSource: () => number,
): AdvancedBattleReplay {
  if (snapshot.randomDraws === undefined) {
    throw new Error("advanceBattleReplay requires a random-draw snapshot");
  }
  validateSnapshot(snapshot);
  const tape = replayableRng(snapshot.randomDraws, randomSource);
  const restored = restoreBattleReplayWithRng(data, snapshot, tape, tape);
  if (restored.step.type !== "awaitingPlayer") {
    throw new Error(`cannot apply a battle command while battle is ${restored.step.type}`);
  }
  if (restored.step.actorId !== command.actorId) {
    throw new Error(
      `battle command actor ${command.actorId} does not match ${restored.step.actorId}`,
    );
  }
  if (command.type === "summonSpirit") {
    restored.session.summonSpirit(command.shortType, command.savedXp);
  } else {
    applyTurnCommand(restored.session, restored.step.choices, command);
  }
  const step = command.type === "summonSpirit"
    ? restored.step
    : restored.session.retreated
      ? { type: "retreated" as const }
      : advanceThroughAutomaticTurns(restored.session);
  const commands = Object.freeze([...snapshot.commands, freezeCommand(command)]);
  const nextSnapshot: BattleReplaySnapshotV1 = Object.freeze({
    ...snapshot,
    randomDraws: tape.draws,
    commands,
  });
  const nextRestored: RestoredBattleReplay = {
    session: restored.session,
    step,
    events: restored.session.events,
    randomDraws: tape.draws,
    ...(step.type === "awaitingPlayer"
      ? { decisionId: battleReplayDecisionId(commands.length, step.actorId) }
      : {}),
  };
  return {
    snapshot: nextSnapshot,
    restored: nextRestored,
    committedDraws: tape.draws.slice(snapshot.randomDraws.length),
  };
}

export function appendBattleReplayCommand(
  snapshot: BattleReplaySnapshotV1,
  command: BattleReplayCommandV1,
): BattleReplaySnapshotV1 {
  validateSnapshot(snapshot);
  return Object.freeze({
    ...snapshot,
    commands: Object.freeze([...snapshot.commands, freezeCommand(command)]),
  });
}

export function battleReplayDecisionId(commandCount: number, actorId: string): string {
  if (!Number.isSafeInteger(commandCount) || commandCount < 0) {
    throw new Error(`battle replay command count is invalid: ${commandCount}`);
  }
  if (actorId.length === 0) throw new Error("battle replay actor id must not be empty");
  return `battle-decision-${commandCount}-${actorId.replace(/[^A-Za-z0-9._:-]/g, "_")}`;
}

function advanceThroughAutomaticTurns(session: BattleSession): PresentationSessionStep {
  for (let guard = 0; guard < 10_000; guard += 1) {
    const step = session.advanceForPresentation();
    if (step.type !== "awaitingEnemy") return step;
    session.submitEnemyAction();
  }
  throw new Error("battle replay automatic-turn guard exceeded");
}

function applyTurnCommand(
  session: BattleSession,
  choices: readonly PlayerChoice[],
  command: Exclude<BattleReplayCommandV1, { type: "summonSpirit" }>,
): void {
  switch (command.type) {
    case "ability": {
      if (!choices.some((choice) => choice.slot === command.slot)) {
        throw new Error(`battle replay ability slot ${command.slot} is not in the current decision`);
      }
      session.submitPlayerAction(command.slot, [...command.targetIds]);
      return;
    }
    case "capture":
      if (command.externalSilverDebit !== undefined) {
        session.applyExternalSilverDebit(command.externalSilverDebit);
      }
      session.submitCaptureAction(command.targetId, command.cardLevel, command.partyLevel);
      return;
    case "delay":
      session.submitDelayAction();
      return;
    case "retreat":
      session.submitRetreatAction();
      return;
  }
}

function validateSnapshot(value: BattleReplaySnapshotV1): void {
  if (value.schemaVersion !== 1) {
    throw new Error(`unsupported battle replay schema ${String(value.schemaVersion)}`);
  }
  const hasSeed = value.seed !== undefined;
  const hasDraws = value.randomDraws !== undefined;
  if (hasSeed === hasDraws) {
    throw new Error("battle replay must contain exactly one of seed or randomDraws");
  }
  if (hasSeed && !Number.isInteger(value.seed)) {
    throw new Error("battle replay seed must be an integer");
  }
  if (hasDraws) {
    if (!Array.isArray(value.randomDraws)) throw new Error("battle replay randomDraws must be an array");
    for (const [index, draw] of value.randomDraws.entries()) {
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
        throw new Error(`battle replay random draw ${index} is outside [0,1)`);
      }
    }
  }
  if (!Array.isArray(value.teams) || value.teams.length !== 2) {
    throw new Error("battle replay must contain exactly two teams");
  }
  if (!Array.isArray(value.commands)) throw new Error("battle replay commands must be an array");
  for (const [team, members] of value.teams.entries()) {
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error(`battle replay team ${team} must not be empty`);
    }
    for (const member of members) validateSetup(member);
  }
  for (const command of value.commands) {
    if (command.actorId.length === 0) throw new Error("battle replay command actor must not be empty");
    if (command.type === "ability") {
      if (!/^usable[0-9]+$/.test(command.slot)) throw new Error(`invalid replay slot ${command.slot}`);
      if (!Array.isArray(command.targetIds)) throw new Error("replay targets must be an array");
    } else if (command.type === "capture") {
      if (![1, 2, 3].includes(command.cardLevel)) throw new Error("invalid replay capture card");
      if (!Number.isSafeInteger(command.partyLevel) || command.partyLevel < 1) {
        throw new Error("invalid replay capture party level");
      }
      if (
        command.externalSilverDebit !== undefined &&
        (!Number.isSafeInteger(command.externalSilverDebit) || command.externalSilverDebit < 0)
      ) {
        throw new Error("invalid replay external silver debit");
      }
    } else if (command.type === "summonSpirit") {
      if (command.shortType.length === 0) throw new Error("replay spirit type must not be empty");
      if (!Number.isSafeInteger(command.savedXp) || command.savedXp < 1) {
        throw new Error("invalid replay spirit XP");
      }
    }
  }
}

function validateSetup(member: TeamMemberSetup): void {
  if (member.shortType.length === 0) throw new Error("battle replay monster type must not be empty");
  if (!Number.isSafeInteger(member.level) || member.level < 1) {
    throw new Error(`battle replay monster level is invalid: ${member.level}`);
  }
}

function cloneSetup(member: TeamMemberSetup): TeamMemberSetup {
  return {
    ...member,
    ...(member.flatStatBonuses === undefined ? {} : { flatStatBonuses: { ...member.flatStatBonuses } }),
    ...(member.playerBuffs === undefined ? {} : { playerBuffs: { ...member.playerBuffs } }),
    ...(member.soulStone === undefined ? {} : { soulStone: { ...member.soulStone } }),
  };
}

function freezeCommand(command: BattleReplayCommandV1): BattleReplayCommandV1 {
  return command.type === "ability"
    ? Object.freeze({ ...command, targetIds: Object.freeze([...command.targetIds]) })
    : Object.freeze({ ...command });
}
