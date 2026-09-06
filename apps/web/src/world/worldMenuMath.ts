import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, unscaledIdiomPt } from "../displayMode.js";
import { popupMenuColumns, popupMenuGeometry } from "../ui/popupMenuMath.js";

export type WorldMenuAction =
  | "items"
  | "monsters"
  | "monsterpedia"
  | "quests"
  | "worldMap"
  | "catchQuest"
  | "highscores"
  | "achievements"
  | "townPortal"
  | "tutorials"
  | "options"
  | "mainMenu";

export interface WorldMenuItemModel {
  action: WorldMenuAction;
  label: string;
  enabled: boolean;
}


export function enabledDungeonMenuActions(
  townPortalAvailable: boolean,
  tutorialsAvailable = false,
  questListAvailable = false,
  scoreboardAvailable = false,
): ReadonlySet<WorldMenuAction> {
  return new Set<WorldMenuAction>([
    "items",
    "monsters",
    "monsterpedia",
    ...(questListAvailable ? ["quests" as const] : []),
    "catchQuest",
    ...(scoreboardAvailable ? ["highscores" as const] : []),
    ...(townPortalAvailable ? ["townPortal" as const] : []),
    ...(tutorialsAvailable ? ["tutorials" as const] : []),
    "options",
    "mainMenu",
  ]);
}

const SOURCE_ITEMS_PREFIX: readonly [WorldMenuAction, string][] = [
  ["items", "ItemsInfoTitleKey"],
  ["monsters", "MonstersKey"],
  ["monsterpedia", "MonsterpediaKey"],
  ["quests", "QuestsKey"],
];

const SOURCE_ITEMS_SUFFIX: readonly [WorldMenuAction, string][] = [
  ["highscores", "ShowLeaderboardsKey"],
  ["achievements", "ShowAchievementsKey"],
  ["townPortal", "GotoTownKey"],
  ["tutorials", "TutorialKey"],
  ["options", "OptionsKey"],
  ["mainMenu", "GotoMainMenuKey"],
];

export function buildWorldMenuItems(
  strings: LocalizedStrings,
  enabledActions: ReadonlySet<WorldMenuAction>,
  context: "world" | "dungeon" = "world",
): WorldMenuItemModel[] {
  const branch: readonly [WorldMenuAction, string] = context === "world"
    ? ["worldMap", "BigMapKey"]


    : ["catchQuest", "DungeonChallengeKey"];
  return [...SOURCE_ITEMS_PREFIX, branch, ...SOURCE_ITEMS_SUFFIX].map(([action, key]) => ({
    action,
    label: localizedString(strings, key),
    enabled: enabledActions.has(action),
  }));
}

export function worldMenuColumns<T>(items: readonly T[]): [T[], T[], T[]] {
  return popupMenuColumns(items, 3) as [T[], T[], T[]];
}

export function worldMenuLayout(mode: DisplayMode) {
  return {
    itemSize: idiomPairPt(16, 32, mode),
    itemGap: idiomPairPt(40, 80, mode),
    columnGap: idiomPairPt(50, 100, mode),
    titleGap: idiomPairPt(10, 20, mode),
    backgroundMarginX: idiomPairPt(9, 18, mode),
    backgroundMarginY: idiomPairPt(6, 12, mode),
    closeInset: unscaledIdiomPt(10, mode),
  };
}

export function worldMenuGeometry(
  screen: { w: number; h: number },
  columnItemSizes: readonly (readonly { w: number; h: number }[])[],
  mode: DisplayMode,
  titleSize: { w: number; h: number } | null = null,
) {
  return popupMenuGeometry(screen, titleSize, columnItemSizes, worldMenuLayout(mode), mode);
}
