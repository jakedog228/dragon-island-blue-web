import { ZONE_ROOM_CHOICE_TIE_ORDER_DIAGNOSTIC } from "@dib/engine/dungeon";
import { isInfiniteDungeonInstance } from "@dib/player-domain";


export const DUNGEON_DIAGNOSTIC_CODES = Object.freeze({
  unsupportedBreederType: "unsupported-breeder-type",
  unsupportedBreederArgument: "unsupported-breeder-argument",
  unsupportedBreederStat: "unsupported-breeder-stat",
  unsupportedLivingArgument: "unsupported-living-argument",
  opaqueStartEvent: "opaque-start-event",
  opaqueWinEvent: "opaque-win-event",
  opaqueAchievement: "opaque-achievement",
  leaderboardPlatformHook: "leaderboard-platform-hook-unavailable",
  saveMeDisabled: "save-me-disabled",
  zoneRoomChoiceTieOrder: ZONE_ROOM_CHOICE_TIE_ORDER_DIAGNOSTIC,
  forestTreeAllValuesOrder: "forest-tree-allValues-order",
} as const);

export type DungeonDiagnosticCode =
  (typeof DUNGEON_DIAGNOSTIC_CODES)[keyof typeof DUNGEON_DIAGNOSTIC_CODES];

/** Codes currently reachable from shipped dungeon data or source-reachable runtime surfaces. */
export const DUNGEON_RUNTIME_DIAGNOSTIC_CODES = Object.freeze([
  ...Object.values(DUNGEON_DIAGNOSTIC_CODES),
] as DungeonDiagnosticCode[]);

/** Reserved for future package extensions; shipped content must not emit these codes. */
export const DUNGEON_RESERVED_DIAGNOSTIC_CODES = Object.freeze([
  "opaque-battle-reward",
] as const);

export type DungeonBattleDiagnosticCode = Extract<DungeonDiagnosticCode,
  | "unsupported-breeder-type"
  | "unsupported-breeder-argument"
  | "unsupported-breeder-stat"
  | "unsupported-living-argument"
  | "opaque-start-event"
  | "opaque-win-event"
  | "opaque-achievement"
  | "save-me-disabled"
>;

export const LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC =
  DUNGEON_DIAGNOSTIC_CODES.leaderboardPlatformHook;
export const LEADERBOARD_PLATFORM_HOOK_MESSAGE =
  "Dungeon leaderboard/platform score hook is unavailable in this port.";

/** Existing public message spelling retained for the unresolved Forest identity debt. */
export const FOREST_TREE_ALL_VALUES_ORDER_DIAGNOSTIC =
  "UNVERIFIED: forest-tree-allValues-order" as const;
export const FOREST_TREE_ALL_VALUES_ORDER_CODE =
  DUNGEON_DIAGNOSTIC_CODES.forestTreeAllValuesOrder;


export const isVolcanoInfiniteDungeonInstance = isInfiniteDungeonInstance;
