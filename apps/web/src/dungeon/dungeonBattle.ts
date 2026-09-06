import type { DungeonDefinition } from "@dib/gamedata/dungeon";
import type { DungeonEncounter, DungeonMonster, DungeonRoomEntryAction } from "@dib/engine/dungeon";
import type {
  DungeonRunSnapshot,
  DungeonTerminalFlowIdentity,
  DungeonTerminalPreparation,
} from "@dib/engine/dungeon-runtime";
import type { TeamMemberSetup } from "@dib/engine";
import { isInfiniteDungeonInstance } from "@dib/player-domain";

import type { BattleTeamMemberSetup, EncounterConfig } from "../battle/encounter.js";
import type { DefeatRecoveryAdapter } from "../battle/battleNode.js";
import { combatBackgroundSpriteKey } from "../displayMode.js";
import type { InstalledSlotProjection } from "../authority/gameAuthorityClient.js";
import {
  DUNGEON_DIAGNOSTIC_CODES,
  type DungeonBattleDiagnosticCode,
} from "./dungeonDiagnostics.js";

const STAT_NAMES = ["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"] as const;
type StatName = (typeof STAT_NAMES)[number];

export interface DungeonBattleDiagnostic {
  readonly code: DungeonBattleDiagnosticCode;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface DungeonBattleBuild {
  readonly encounter: EncounterConfig;
  readonly diagnostics: readonly DungeonBattleDiagnostic[];
}

export interface DungeonBattleBuildOptions {
  readonly authority: "local" | "official";
}

export type DungeonBattleLifecycleOutcome = "victory" | "retreat" | "defeat";

/** The terminal path's source reward identity: authored battle rewards take precedence over the
 * legacy quest-key fallback, and both are settled by the local/Official terminal owner. */
export function dungeonBattleRewardKey(
  encounter: Pick<DungeonEncounter, "battleRewardKey" | "questKey">,
): string | undefined {
  return encounter.battleRewardKey ?? encounter.questKey;
}

/** Apply the source reward-key branch to the prospective local terminal only. The engine owns the
 * detached room snapshot; LocalDungeonTerminal owns durable key consumption, so this helper keeps
 * precedence and duplicate prevention at the production settlement seam. */
export function stageDungeonBattleReward(
  outcome: DungeonBattleLifecycleOutcome,
  encounter: Pick<DungeonEncounter, "battleRewardKey" | "questKey">,
  preparation: Pick<DungeonTerminalPreparation, "entryActions" | "consumeTreasure">,
  rewardOwner: Pick<
    DungeonBattleRewardOwner,
    "hasReceivedBattleReward" | "setPendingBattleReward"
  >,
): void {
  if (outcome !== "victory") return;
  const rewardKey = dungeonBattleRewardKey(encounter);
  const treasureAction = preparation.entryActions.find(
    (action): action is Extract<DungeonRoomEntryAction, { kind: "treasure" }> =>
      action.kind === "treasure",
  );
  if (rewardKey === undefined || treasureAction === undefined) return;
  if (rewardOwner.hasReceivedBattleReward(rewardKey)) {
    preparation.consumeTreasure(treasureAction.treasure.id);
    return;
  }
  rewardOwner.setPendingBattleReward(treasureAction.treasure.id, rewardKey);
}

export interface DungeonBattleRewardOwner {
  readonly hasReceivedBattleReward: (key: string) => boolean;
  readonly setPendingBattleReward: (treasureId: string, rewardKey: string) => void;
}

/** Diagnostics whose source seam is after `BattleNode.performWinLogic`, not battle construction.
 * Retreat and defeat never enter that lifecycle, so they deliberately produce no entries. */
export function dungeonBattleLifecycleDiagnostics(
  encounter: Pick<DungeonEncounter, "id" | "winEvent" | "achievement">,
  outcome: DungeonBattleLifecycleOutcome,
): readonly DungeonBattleDiagnostic[] {
  if (outcome !== "victory") return Object.freeze([]);
  const diagnostics: DungeonBattleDiagnostic[] = [];
  if (encounter.winEvent !== undefined && encounter.winEvent.className !== "ChatGameFlowEvent") {
    pushBattleDiagnostic(
      diagnostics,
      DUNGEON_DIAGNOSTIC_CODES.opaqueWinEvent,
      `Dungeon encounter ${encounter.id} retains unsupported win event ${encounter.winEvent.className}.`,
      { event: encounter.winEvent },
    );
  }
  if (encounter.achievement !== undefined) {
    pushBattleDiagnostic(
      diagnostics,
      DUNGEON_DIAGNOSTIC_CODES.opaqueAchievement,
      `Dungeon encounter ${encounter.id} retains unsupported achievement ${encounter.achievement}.`,
      { achievement: encounter.achievement },
    );
  }
  return Object.freeze(diagnostics);
}

/** Exact-once is owned by one battle lifecycle. A later encounter receives a new reporter and is
 * therefore not suppressed by historical diagnostics from an earlier lifecycle. */
export function createDungeonBattleLifecycleDiagnosticReporter(
  encounter: Pick<DungeonEncounter, "id" | "winEvent" | "achievement">,
  report: (diagnostic: DungeonBattleDiagnostic) => void,
): (outcome: DungeonBattleLifecycleOutcome) => void {
  let reported = false;
  return (outcome) => {
    if (reported || outcome !== "victory") return;
    reported = true;
    for (const diagnostic of dungeonBattleLifecycleDiagnostics(encounter, outcome)) report(diagnostic);
  };
}

/** Official terminal commands settle the run in the reducer. The browser adopts that committed
 * projection before it derives any return scene or defeat route, and never repeats the local
 * roster/event-4 transaction. */
export function adoptOfficialDungeonTerminalProjection(
  authority: {
    readonly projection: () => InstalledSlotProjection;
    readonly adoptProjection: () => void;
  },
  outcome: "victory" | "retreat" | "defeat",
): InstalledSlotProjection {
  const committed = authority.projection();
  if (committed.location.kind === "battle" || committed.battle !== undefined) {
    throw new Error("official dungeon terminal projection is still in battle state");
  }
  if (outcome === "defeat") {
    if (committed.location.kind !== "town" || committed.dungeon !== undefined) {
      throw new Error("official dungeon defeat projection did not clear the dungeon at town");
    }
  } else if (committed.location.kind !== "dungeon" || committed.dungeon === undefined) {
    throw new Error("official dungeon terminal projection is missing its dungeon state");
  }
  authority.adoptProjection();
  const adopted = authority.projection();
  if (adopted.location.kind === "battle" || adopted.battle !== undefined) {
    throw new Error("adopted official dungeon terminal projection is still in battle state");
  }
  if (outcome === "defeat") {
    if (adopted.location.kind !== "town" || adopted.dungeon !== undefined) {
      throw new Error("adopted official dungeon defeat projection is inconsistent");
    }
  } else if (adopted.location.kind !== "dungeon" || adopted.dungeon === undefined) {
    throw new Error("adopted official dungeon terminal projection is missing dungeon state");
  }
  return adopted;
}


export function officialDungeonBattleReturnActions(
  outcome: DungeonBattleLifecycleOutcome,
  session: { readonly enterCurrentRoom: () => readonly DungeonRoomEntryAction[] },
): readonly DungeonRoomEntryAction[] | null {
  return outcome === "victory" ? session.enterCurrentRoom() : null;
}

export function allocateDungeonTerminalFlow(
  mode: "local" | "official",
  allocate: () => DungeonTerminalFlowIdentity,
): DungeonTerminalFlowIdentity | undefined {
  return mode === "official" ? undefined : allocate();
}

/** The local defeat terminal save contains the post-battle player/quest state but no live dungeon.
 * A nullable override lets the caller write that one committed checkpoint before navigation clears
 * the in-memory feature, avoiding a second fallible terminal save. */
export function terminalDungeonCheckpointOverride(
  outcome: "victory" | "retreat" | "defeat",
  snapshot: DungeonRunSnapshot,
): DungeonRunSnapshot | null {
  return outcome === "defeat" ? null : snapshot;
}

export function terminalDungeonMonsterRoster(
  encounter: DungeonEncounter,
  survivingConstructionIndices: readonly number[],
): readonly DungeonMonster[] {
  return Object.freeze(survivingConstructionIndices.map((index) => {
    const monster = encounter.monsters[index];
    if (monster === undefined) {
      throw new Error(`Dungeon encounter ${encounter.id} has no monster at construction index ${index}`);
    }
    return monster;
  }));
}

/** Source terminal ordering: Room.updateMonstersForDungeon/quest projection completes before the
 * encounter's victory/retreat/defeat resolution mutates navigation or clears a room. */
export function resolveDungeonBattleTerminal<T>(
  run: {
    synchronizeEncounterRoomRoster(
      encounter: Pick<DungeonEncounter, "id">,
      flow: DungeonTerminalFlowIdentity,
      roster: readonly DungeonMonster[],
    ): boolean;
    resolveEncounter(
      encounter: Pick<DungeonEncounter, "id">,
      outcome: "victory" | "defeat" | "retreat",
      capturedTypes: readonly string[],
    ): T;
  },
  encounter: Pick<DungeonEncounter, "id">,
  flow: DungeonTerminalFlowIdentity,
  outcome: "victory" | "defeat" | "retreat",
  survivingMonsters: readonly DungeonMonster[],
  capturedTypes: readonly string[],
): T {
  run.synchronizeEncounterRoomRoster(encounter, flow, survivingMonsters);
  return run.resolveEncounter(encounter, outcome, capturedTypes);
}

/** Compatibility seam for callers that still decorate Save Me recovery. Roster/event-4 work is
 * owned by DungeonRuntimeController.settleEncounterTerminal and therefore cannot run during the
 * read-only eligibility/recovery flow. */
export function withDungeonRoomRosterLoss(
  recovery: DefeatRecoveryAdapter,
  _applyRoomRosterLoss: () => void,
): DefeatRecoveryAdapter {
  return {
    canOffer: () => recovery.canOffer(),
    markTutorialSeen: () => recovery.markTutorialSeen(),
    acceptSaveMe: () => recovery.acceptSaveMe(),
    openGoldStore: () => recovery.openGoldStore(),
  };
}

/**
 * App-boundary translation from source Dungeon room state into the reusable battle scene.
 *
 * The native fixed-encounter path creates its team, then calls `Breeder.applyToTeam:` before the
 * Battle begins. The shipped corpus uses only breeder type `Normal`; its `stats` dictionary is a
 * flat integer bonus applied to every enemy, and `xpBonus` is the aggregate post-battle XP
 * multiplier. Fixed monsters additionally carry per-instance `extraLivingArguments` (boss,
 * displayName, rendererData). Keeping that translation here prevents either the pure dungeon
 * engine or GameData's immutable monster definitions from acquiring presentation dependencies.
 */
export function buildDungeonBattle(
  definition: Pick<DungeonDefinition, "instanceName" | "presentation">,
  encounter: DungeonEncounter,
  playerTeam: readonly TeamMemberSetup[],
  options: DungeonBattleBuildOptions = { authority: "local" },
): DungeonBattleBuild {
  if (playerTeam.length === 0) throw new Error("Dungeon battle requires an alive player batting prefix");
  const diagnostics: DungeonBattleDiagnostic[] = [];
  const breeder = parseBreeder(encounter, diagnostics);
  const enemyTeam = encounter.monsters.map((monster, index) => {
    const setup: BattleTeamMemberSetup = {
      shortType: monster.type,
      level: monster.level,
    };
    applyExtraLivingArguments(setup, monster.extraLivingArguments, encounter.id, index, diagnostics);
    if (Object.keys(breeder.stats).length !== 0) setup.flatStatBonuses = breeder.stats;
    // `Breeder.applyToTeam:` runs after living construction and overwrites every active/reserve
    // member's capturable flag. Missing `allowCapture` is Objective-C `nil.boolValue == false`.
    if (breeder.present) setup.capturable = breeder.allowCapture;
    return setup;
  });
  if (enemyTeam.length === 0) throw new Error(`Dungeon encounter ${encounter.id} has no monsters`);

  if (encounter.startEvent !== undefined && encounter.startEvent.className !== "ChatGameFlowEvent") {
    pushBattleDiagnostic(diagnostics, DUNGEON_DIAGNOSTIC_CODES.opaqueStartEvent,
      `Dungeon encounter ${encounter.id} retains unsupported start event ${encounter.startEvent.className}.`,
      { event: encounter.startEvent });
  }


  const isAbyss = isInfiniteDungeonInstance(definition.instanceName);
  const blockSaveMe = isAbyss;
  if (blockSaveMe) pushBattleDiagnostic(diagnostics, DUNGEON_DIAGNOSTIC_CODES.saveMeDisabled,
    `${definition.instanceName} blocks Save Me in the source.`,
    { authority: options.authority, instanceName: definition.instanceName });

  return Object.freeze({
    encounter: {
      backgroundKey: combatBackgroundSpriteKey(definition.presentation.combatBackgroundFile),
      allowRetreat: true,
      blockSaveMe,
      ...(isAbyss ? { blockCapture: true } : {}),
      ...(breeder.xpBonus === undefined ? {} : { breederXpBonus: breeder.xpBonus }),
      ...(encounter.questKey === undefined ? {} : { questKey: encounter.questKey }),
      ...(encounter.completionKey === undefined ? {} : { uniqueKey: encounter.completionKey }),
      difficultyModifier: 0,
      playerTeam: playerTeam.map((member) => ({ ...member })),
      enemyTeam,
    },
    diagnostics: Object.freeze(diagnostics),
  });
}

interface ParsedBreeder {
  readonly present: boolean;
  readonly stats: Partial<Record<StatName, number>>;
  readonly xpBonus?: number;
  readonly allowCapture: boolean;
}

function parseBreeder(
  encounter: DungeonEncounter,
  diagnostics: DungeonBattleDiagnostic[],
): ParsedBreeder {
  const breeder = encounter.breeder;
  if (breeder === undefined) {
    return Object.freeze({ present: false, stats: Object.freeze({}), allowCapture: true });
  }
  if (breeder.type !== "Normal") {
    pushBattleDiagnostic(diagnostics, DUNGEON_DIAGNOSTIC_CODES.unsupportedBreederType,
      `Dungeon encounter ${encounter.id} uses unsupported breeder ${breeder.type}.`,
      { type: breeder.type, arguments: breeder.arguments });
    return Object.freeze({ present: true, stats: Object.freeze({}), allowCapture: false });
  }

  const stats: Partial<Record<StatName, number>> = {};
  let xpBonus: number | undefined;
  let allowCapture = false;
  for (const [key, value] of Object.entries(breeder.arguments)) {
    if (key === "stats") {
      if (!isRecord(value)) throw new Error(`Dungeon encounter ${encounter.id} breeder.stats must be an object`);
      for (const [stat, amount] of Object.entries(value)) {
        if (!isStatName(stat)) {
          pushBattleDiagnostic(diagnostics, DUNGEON_DIAGNOSTIC_CODES.unsupportedBreederStat,
            `Dungeon encounter ${encounter.id} breeder has unknown stat ${stat}.`,
            { stat, amount });
          continue;
        }
        if (typeof amount !== "number" || !Number.isSafeInteger(amount)) {
          throw new Error(`Dungeon encounter ${encounter.id} breeder.stats.${stat} must be a safe integer`);
        }
        // `NormalBreeder.applyToTeam:` only adds authored positive bonuses.
        if (amount > 0) stats[stat] = amount;
      }
      continue;
    }
    if (key === "xpBonus") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        throw new Error(`Dungeon encounter ${encounter.id} breeder.xpBonus must be a non-negative number`);
      }
      xpBonus = value;
      continue;
    }
    if (key === "allowCapture") {
      if (typeof value !== "boolean") {
        throw new Error(`Dungeon encounter ${encounter.id} breeder.allowCapture must be boolean`);
      }
      allowCapture = value;
      continue;
    }
    pushBattleDiagnostic(diagnostics, DUNGEON_DIAGNOSTIC_CODES.unsupportedBreederArgument,
      `Dungeon encounter ${encounter.id} breeder has unknown argument ${key}.`,
      { key, value });
  }
  return Object.freeze({
    present: true,
    stats: Object.freeze(stats),
    // Native Breeder defaults this ivar to 1.0. Presence therefore remains the exact
    // `Battle.breeder != nil` signal used by BattleNode's BossBattle music branch.
    xpBonus: xpBonus ?? 1,
    allowCapture,
  });
}

function applyExtraLivingArguments(
  setup: BattleTeamMemberSetup,
  value: Readonly<Record<string, unknown>> | undefined,
  encounterId: string,
  index: number,
  diagnostics: DungeonBattleDiagnostic[],
): void {
  if (value === undefined) return;
  for (const [key, argument] of Object.entries(value)) {
    if (key === "boss") {
      if (typeof argument !== "boolean") throw livingArgumentError(encounterId, index, key, "boolean");
      setup.boss = argument;
      continue;
    }
    if (key === "capturable" || key === "allowCapture") {
      if (typeof argument !== "boolean") throw livingArgumentError(encounterId, index, key, "boolean");
      setup.capturable = argument;
      continue;
    }
    if (key === "displayName") {
      if (typeof argument !== "string" || argument.length === 0) {
        throw livingArgumentError(encounterId, index, key, "non-empty string");
      }
      setup.displayName = argument;
      continue;
    }
    if (key === "rendererData") {
      if (!isRecord(argument)) throw livingArgumentError(encounterId, index, key, "object");
      setup.rendererData = Object.freeze({ ...argument });
      continue;
    }
    pushBattleDiagnostic(diagnostics, DUNGEON_DIAGNOSTIC_CODES.unsupportedLivingArgument,
      `Dungeon encounter ${encounterId} monster ${index} has unknown living argument ${key}.`,
      { key, value: argument, monsterIndex: index });
  }
}

function pushBattleDiagnostic(
  diagnostics: DungeonBattleDiagnostic[],
  code: DungeonBattleDiagnosticCode,
  message: string,
  detail: Readonly<Record<string, unknown>>,
): void {
  diagnostics.push(Object.freeze({
    code,
    message,
    detail: Object.freeze({ code, ...detail }),
  }));
}

function livingArgumentError(encounterId: string, index: number, key: string, expected: string): Error {
  return new Error(`Dungeon encounter ${encounterId} monster ${index} ${key} must be ${expected}`);
}

function isStatName(value: string): value is StatName {
  return (STAT_NAMES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
