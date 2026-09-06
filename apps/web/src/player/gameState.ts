import {
  parseGuildQuestStateSnapshot,
  type GuildQuestStateSnapshot,
  type WorldTripSharedState,
  cloneJsonSafeRecord,
  assertExactObjectKeys,
} from "@dib/engine";
import { parseDungeonRunSnapshot, type DungeonRunSnapshot } from "@dib/engine/dungeon-runtime";
import { CollectionClaims } from "@dib/player-domain";
import type { PlayerRuntimeStateSnapshot } from "./playerRuntimeState.js";

export interface WorldProgressStateSnapshotV1 {
  readonly schemaVersion: 1;
  readonly worldName: string;
  readonly currentPoiName: string;
  readonly refresh: {
    readonly occurrenceByPoi: Readonly<Record<string, boolean>>;
    readonly completedPois: readonly string[];
  };
  readonly poiWins: Readonly<Record<string, number>>;
  /** Optional for schema-1 saves written before the town day notification was implemented. */
  readonly dayNumber?: number;
  /** Permanent UserSavedData-style completion registry, kept separate from per-trip refresh data. */
  readonly everCompletedPois: readonly string[];
  /** `UserSavedData.lastTown`; absent legacy/new-game state uses the content registry fallback. */
  readonly lastTownName?: string;
}

export interface WorldProgressStateSnapshotV2 {
  readonly schemaVersion: 2;
  readonly worldName: string;
  readonly currentPoiName: string;
  readonly refresh: WorldProgressStateSnapshotV1["refresh"];
  readonly poiWins: Readonly<Record<string, number>>;
  readonly dayNumber: number;
  readonly everCompletedPois: readonly string[];
  readonly lastTownName?: string;
  /** `UserSavedData.properties["visitedTowns"]`, independent of portal conditions. */
  readonly visitedTownNames: readonly string[];
}

export type WorldProgressStateSnapshot =
  | WorldProgressStateSnapshotV1
  | WorldProgressStateSnapshotV2;

/** Versioned, JSON-safe state crossing app scenes and storage adapters. Each domain owns its own
 * nested schema so inventory, quests, towns, tournaments, and settings can be added/migrated
 * without teaching BattleNode or SceneCoordinator about persistence. */
export interface PlayerGameStateSnapshot {
  readonly schemaVersion: 1;
  readonly player: PlayerRuntimeStateSnapshot;
  /** Global Guild/story state; absent schema-1 saves migrate to the source empty state. */
  readonly quests?: GuildQuestStateSnapshot;
  readonly world?: WorldProgressStateSnapshot;
  /** Active source-shaped dungeon cache. Absence means the player is not inside a dungeon run. */
  readonly dungeon?: DungeonRunSnapshot;

  readonly pendingBattleRewardKeys?: Readonly<Record<string, string>>;
}

export function parsePlayerGameStateSnapshot(value: unknown): PlayerGameStateSnapshot {
  const state = cloneJsonSafeRecord(value, "game state") as Partial<PlayerGameStateSnapshot>;
  assertExactObjectKeys(
    state,
    ["schemaVersion", "player", "quests", "world", "dungeon", "pendingBattleRewardKeys"],
    "game state",
  );
  if (state.schemaVersion !== 1) throw new Error(`unsupported game-state schema ${String(state.schemaVersion)}`);
  if (
    typeof state.player !== "object" ||
    state.player === null ||
    (state.player.schemaVersion !== 1 && state.player.schemaVersion !== 2)
  ) {
    throw new Error("game state is missing a supported player schema");
  }
  assertExactObjectKeys(
    state.player,
    state.player.schemaVersion === 2
      ? ["schemaVersion", "profile", "party", "claimedCollectionGoalIds"]
      : ["schemaVersion", "profile", "party"],
    "game state player",
  );
  if (state.player.party === undefined || typeof state.player.party !== "object" || state.player.party === null) {
    throw new Error("game state player party is missing");
  }
  assertExactObjectKeys(
    state.player.party,
    state.player.party.kind === "world-trip-party"
      ? Object.prototype.hasOwnProperty.call(state.player.party, "members") &&
        !Object.prototype.hasOwnProperty.call(state.player.party, "monsters")
        ? ["kind", "members"]
        : [
            "kind", "battingOrderSize", "battingOrderLength", "battingOrderSlotIds", "reserveOrderIds",
            "monsters", "soulStones",
          ]
      : ["kind", "levels"],
    "game state player party",
  );
  if (state.player.schemaVersion === 2) validateCollectionClaimSnapshot(
    state.player.claimedCollectionGoalIds,
  );
  if (
    state.player.profile?.schemaVersion !== 1 &&
    state.player.profile?.schemaVersion !== 2 &&
    state.player.profile?.schemaVersion !== 3 &&
    state.player.profile?.schemaVersion !== 4 &&
    state.player.profile?.schemaVersion !== 5 &&
    state.player.profile?.schemaVersion !== 6 &&
    state.player.profile?.schemaVersion !== 7 &&
    state.player.profile?.schemaVersion !== 8
  ) {
    throw new Error("game state has an unsupported profile schema");
  }
  if (state.player.party?.kind !== "standalone-levels" && state.player.party?.kind !== "world-trip-party") {
    throw new Error("game state has an unsupported party domain");
  }
  const pendingBattleRewardKeys = parsePendingBattleRewardKeys(state.pendingBattleRewardKeys);
  if (state.world !== undefined) restoreWorldTripSharedState(state.world);
  const quests = state.quests === undefined
    ? undefined
    : parseGuildQuestStateSnapshot(state.quests);
  const dungeon = state.dungeon === undefined ? undefined : (() => {
    if (state.world === undefined || state.player?.party?.kind !== "world-trip-party") {
      throw new Error("active dungeon state requires a world-trip player and world progress");
    }
    return parseDungeonRunSnapshot(state.dungeon);
  })();
  return Object.freeze({
    ...state,
    ...(quests === undefined ? {} : { quests }),
    ...(dungeon === undefined ? {} : { dungeon }),
    ...(pendingBattleRewardKeys === undefined ? {} : { pendingBattleRewardKeys }),
  }) as PlayerGameStateSnapshot;
}

function parsePendingBattleRewardKeys(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("pending battle reward bookkeeping must be an object");
  }
  const entries = Object.entries(value);
  const sortedKeys = entries.map(([treasureId]) => treasureId).sort(compareText);
  if (sortedKeys.some((key, index) => key !== entries[index]![0])) {
    throw new Error("pending battle reward bookkeeping must be sorted");
  }
  for (const [treasureId, rewardKey] of entries) {
    if (treasureId.length === 0 || typeof rewardKey !== "string" || rewardKey.length === 0) {
      throw new Error("pending battle reward bookkeeping identities must not be empty");
    }
  }
  return Object.freeze(Object.fromEntries(entries));
}

function validateCollectionClaimSnapshot(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new Error("game state player schema 2 claimedCollectionGoalIds must be an array");
  }
  const claims = new CollectionClaims(value as readonly string[]);
  const canonical = claims.snapshot();
  if (
    canonical.length !== value.length ||
    canonical.some((goalId, index) => goalId !== value[index])
  ) {
    throw new Error("game state claimedCollectionGoalIds must be sorted and unique");
  }
}

export function snapshotWorldProgress(
  worldName: string,
  currentPoiName: string,
  shared: WorldTripSharedState,
  previousEverCompleted: Iterable<string> = [],
  lastTownName?: string,
  visitedTownNames: Iterable<string> = [],
): WorldProgressStateSnapshotV2 {
  const everCompleted = new Set([...previousEverCompleted, ...shared.everCompletedPois]);
  for (const poi of shared.completedThisRefresh) everCompleted.add(poi);
  for (const [poi, wins] of shared.poiWins) if (wins > 0) everCompleted.add(poi);
  for (const poi of everCompleted) shared.everCompletedPois.add(poi);
  return {
    schemaVersion: 2,
    worldName: requireName(worldName, "worldName"),
    currentPoiName: requireName(currentPoiName, "currentPoiName"),
    refresh: {
      occurrenceByPoi: Object.fromEntries([...shared.occurrenceThisRefresh].sort(([a], [b]) => compareText(a, b))),
      completedPois: [...shared.completedThisRefresh].sort(),
    },
    poiWins: Object.fromEntries([...shared.poiWins].sort(([a], [b]) => compareText(a, b))),
    dayNumber: shared.dayNumber,
    everCompletedPois: [...everCompleted].sort(),
    ...(lastTownName === undefined ? {} : { lastTownName: requireName(lastTownName, "lastTownName") }),
    visitedTownNames: sortedUniqueNames(visitedTownNames, "visited town"),
  };
}

export function restoreWorldTripSharedState(snapshot: WorldProgressStateSnapshot): WorldTripSharedState {
  if (typeof snapshot !== "object" || snapshot === null) throw new Error("world progress must be an object");
  if (snapshot.schemaVersion !== 1 && snapshot.schemaVersion !== 2) {
    throw new Error("world progress: unsupported schema");
  }
  assertExactObjectKeys(
    snapshot,
    snapshot.schemaVersion === 1
      ? ["schemaVersion", "worldName", "currentPoiName", "refresh", "poiWins", "dayNumber", "everCompletedPois", "lastTownName"]
      : ["schemaVersion", "worldName", "currentPoiName", "refresh", "poiWins", "dayNumber", "everCompletedPois", "lastTownName", "visitedTownNames"],
    "world progress",
  );
  requireName(snapshot.worldName, "worldName");
  requireName(snapshot.currentPoiName, "currentPoiName");
  if (typeof snapshot.refresh !== "object" || snapshot.refresh === null) {
    throw new Error("world progress: refresh state is missing");
  }
  assertExactObjectKeys(snapshot.refresh, ["occurrenceByPoi", "completedPois"], "world progress refresh");
  if (typeof snapshot.refresh.occurrenceByPoi !== "object" || snapshot.refresh.occurrenceByPoi === null) {
    throw new Error("world progress: occurrence registry is missing");
  }
  if (!Array.isArray(snapshot.refresh.completedPois) || !Array.isArray(snapshot.everCompletedPois)) {
    throw new Error("world progress: completion registries must be arrays");
  }
  if (snapshot.lastTownName !== undefined) requireName(snapshot.lastTownName, "lastTownName");
  if (snapshot.schemaVersion === 2) {
    if (!Array.isArray(snapshot.visitedTownNames)) {
      throw new Error("world progress: visitedTownNames must be an array");
    }
    const visited = sortedUniqueNames(snapshot.visitedTownNames, "visited town");
    if (
      visited.length !== snapshot.visitedTownNames.length ||
      visited.some((name, index) => name !== snapshot.visitedTownNames[index])
    ) {
      throw new Error("world progress: visitedTownNames must be sorted and unique");
    }
  }
  if (typeof snapshot.poiWins !== "object" || snapshot.poiWins === null) {
    throw new Error("world progress: POI win registry is missing");
  }
  const occurrenceThisRefresh = new Map<string, boolean>();
  for (const [poi, occurs] of Object.entries(snapshot.refresh.occurrenceByPoi)) {
    requireName(poi, "occurrence POI");
    if (typeof occurs !== "boolean") throw new Error(`world progress: occurrence for ${poi} is not boolean`);
    occurrenceThisRefresh.set(poi, occurs);
  }
  const completedThisRefresh = new Set(snapshot.refresh.completedPois.map((poi) => requireName(poi, "completed POI")));
  for (const poi of snapshot.everCompletedPois) requireName(poi, "ever-completed POI");
  const poiWins = new Map<string, number>();
  for (const [poi, wins] of Object.entries(snapshot.poiWins)) {
    requireName(poi, "win POI");
    if (!Number.isSafeInteger(wins) || wins < 0) throw new Error(`world progress: invalid wins for ${poi}`);
    poiWins.set(poi, wins);
  }
  const dayNumber = snapshot.dayNumber ?? 1;
  if (!Number.isSafeInteger(dayNumber) || dayNumber < 1) {
    throw new Error(`world progress: invalid dayNumber ${String(dayNumber)}`);
  }
  return {
    occurrenceThisRefresh,
    completedThisRefresh,
    poiWins,
    everCompletedPois: new Set(snapshot.everCompletedPois),
    // Source `data_26a444` is a process-global, so a save never carries the event-2 notify gate.
    notifiedCompletedPois: new Set<string>(),
    dayNumber,
  };
}

function requireName(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`world progress: ${label} must not be empty`);
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUniqueNames(values: Iterable<string>, label: string): string[] {
  const names = [...values].map((value) => requireName(value, label)).sort(compareText);
  if (new Set(names).size !== names.length) {
    throw new Error(`world progress: ${label} values must be unique`);
  }
  return names;
}
