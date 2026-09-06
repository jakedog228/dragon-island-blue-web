import type { GameData } from "@dib/gamedata";
import { spiritCombatLevel, spiritGradeForXp } from "@dib/engine";
import type { SpiritProfileSnapshot } from "../player/playerProfile.js";
import { localizedRenderableName, type LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, unscaledIdiomPt } from "../displayMode.js";
import {
  popupMenuColumns,
  popupMenuGeometry,
  type PopupMenuButtonLayout as SpiritMenuButtonLayout,
  type PopupMenuGeometry as SharedPopupMenuGeometry,
} from "../ui/popupMenuMath.js";

export interface SpiritMenuItemModel {
  kind: "spirit" | "back";
  label: string;
  enabled: boolean;
  shortType?: string;
  savedXp?: number;
  grade?: string;
  combatLevel?: number;
}

export function buildSpiritMenuItems(
  snapshot: SpiritProfileSnapshot,
  gd: GameData,
  strings: LocalizedStrings,
): SpiritMenuItemModel[] {
  const items = snapshot.spirits.map((entry): SpiritMenuItemModel => {
    const monster = gd.monsterByShortType(entry.shortType);
    const grade = spiritGradeForXp(entry.savedXp);
    return {
      kind: "spirit",
      shortType: entry.shortType,
      savedXp: entry.savedXp,
      grade,
      combatLevel: spiritCombatLevel(monster, entry.savedXp),
      label: `${localizedRenderableName(strings, [entry.shortType])} [${grade}]`,
      enabled: !entry.usedThisTrip,
    };
  });
  items.push({ kind: "back", label: localizedString(strings, "BackButtonKey"), enabled: true });
  return items;
}

export function spiritMenuLayout(mode: DisplayMode): {
  titleSize: number;
  itemSize: number;
  titleGap: number;
  itemGap: number;
  columnGap: number;
  outlineWidth: number;
  outlineAlpha: number;
  backgroundMarginX: number;
  backgroundMarginY: number;
} {
  return {
    titleSize: idiomPairPt(25, 50, mode),

    itemSize: idiomPairPt(12, 40, mode),
    titleGap: idiomPairPt(10, 20, mode),
    itemGap: idiomPairPt(30, 60, mode),
    columnGap: idiomPairPt(30, 60, mode),
    outlineWidth: unscaledIdiomPt(2, mode),
    outlineAlpha: 128 / 255,
    // MenuButton2 centerRegion origin, selected/scaled before this port normalizes iPad points.
    backgroundMarginX: idiomPairPt(9, 18, mode),
    backgroundMarginY: idiomPairPt(6, 12, mode),
  };
}

export interface SpiritMenuLabelSize {
  w: number;
  h: number;
}

export type { SpiritMenuButtonLayout };

export interface SpiritMenuGeometry {
  title: { x: number; y: number; w: number; h: number };
  content: { x: number; y: number; w: number; h: number };
  buttons: SpiritMenuButtonLayout[][];
}


export function spiritMenuGeometry(
  screen: SpiritMenuLabelSize,
  titleSize: SpiritMenuLabelSize,
  columnItemSizes: readonly (readonly SpiritMenuLabelSize[])[],
  mode: DisplayMode,
): SpiritMenuGeometry {
  const constants = spiritMenuLayout(mode);
  if (columnItemSizes.length !== 3) {
    throw new Error(`Spirit Totems requires exactly three PopupMenu columns, got ${columnItemSizes.length}`);
  }


  const geometry: SharedPopupMenuGeometry = popupMenuGeometry(
    screen,
    titleSize,
    columnItemSizes,
    constants,
    mode,
    true,
  );
  if (!geometry.title) throw new Error("Spirit Totems title geometry is missing");
  return { title: geometry.title, content: geometry.content, buttons: geometry.buttons };
}


export function spiritMenuColumns<T>(items: readonly T[]): [T[], T[], T[]] {
  return popupMenuColumns(items, 3) as [T[], T[], T[]];
}
