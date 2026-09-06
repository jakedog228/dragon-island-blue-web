import type { TownPortalDestination } from "@dib/gamedata/browser";
import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";
import { popupMenuColumns, popupMenuGeometry, type PopupMenuSize } from "../ui/popupMenuMath.js";

export interface TownWarpLayout {
  readonly screen: PopupMenuSize;
  readonly itemFontSize: number;
  readonly titleFontSize: number;
  readonly itemGap: number;
  readonly columnGap: number;
  readonly titleGap: number;
  readonly itemIconGap: number;
  readonly questCountFontSize: number;
  readonly legendCountFontSize: number;
  readonly legendTextFontSize: number;
  readonly legendGap: number;
  readonly legendBottomInset: number;
  readonly backgroundMarginX: number;
  readonly backgroundMarginY: number;
  readonly closeInset: number;
  readonly outlineWidth: number;
  readonly background: {
    readonly textureRectPx: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
    readonly sizePt: PopupMenuSize;
    readonly positionPt: { readonly x: number; readonly y: number };
  };
}

export interface TownWarpItemModel {
  readonly townName: string;
  readonly label: string;
  readonly visited: boolean;
  readonly questCount: number;
  readonly showQuestBadge: boolean;
}


export function townWarpLayout(mode: DisplayMode): TownWarpLayout {
  const screen = screenPointsForMode(mode);
  const backgroundSize = { w: 512, h: 384 };
  return {
    screen,
    itemFontSize: idiomPairPt(14, 28, mode),
    titleFontSize: idiomPairPt(25, 50, mode),
    itemGap: idiomPairPt(40, 80, mode),
    columnGap: idiomPairPt(50, 100, mode),
    titleGap: idiomPairPt(10, 20, mode),
    itemIconGap: idiomPairPt(10, 20, mode),
    // Raw data_d3b2c..d3b40 pairs: 10/22, 12/22, and 12/24 native points.
    questCountFontSize: idiomPairPt(10, 22, mode),
    legendCountFontSize: idiomPairPt(12, 22, mode),
    legendTextFontSize: idiomPairPt(12, 24, mode),
    // Box's default child gap and the final native 10pt lower-edge literal are not idiom pairs.
    legendGap: unscaledIdiomPt(5, mode),
    legendBottomInset: unscaledIdiomPt(10, mode),
    backgroundMarginX: idiomPairPt(9, 18, mode),
    backgroundMarginY: idiomPairPt(6, 12, mode),
    closeInset: unscaledIdiomPt(10, mode),
    outlineWidth: unscaledIdiomPt(2, mode),
    background: {
      textureRectPx: { x: 0, y: 0, w: 1024, h: 768 },
      sizePt: backgroundSize,
      positionPt: {
        x: (screen.w - backgroundSize.w) / 2,
        y: (screen.h - backgroundSize.h) / 2,
      },
    },
  };
}

export function townWarpItems(
  destinations: readonly TownPortalDestination[],
  visitedTownNames: ReadonlySet<string>,
  localizedName: (townName: string) => string,
  questsAvailable: (townName: string) => number,
): readonly TownWarpItemModel[] {
  return Object.freeze(destinations.map((destination) => {
    const visited = visitedTownNames.has(destination.townName);
    const questCount = visited ? questsAvailable(destination.townName) : 0;
    if (!Number.isSafeInteger(questCount) || questCount < 0) {
      throw new Error(`invalid available quest count ${questCount} for ${destination.townName}`);
    }
    return Object.freeze({
      townName: destination.townName,
      label: visited ? localizedName(destination.townName) : "??????",
      visited,
      questCount,
      // Unlike Tavern, source TownWarp attaches the badge for every visited destination even
      // when `questsAvailableInTown:` returns zero.
      showQuestBadge: visited,
    });
  }));
}

export function townWarpColumns<T>(items: readonly T[]): readonly (readonly T[])[] {
  return popupMenuColumns(items, 3);
}

export function townWarpGeometry(
  titleSize: PopupMenuSize | null,
  itemSizes: readonly (readonly PopupMenuSize[])[],
  mode: DisplayMode,
) {
  const layout = townWarpLayout(mode);
  return popupMenuGeometry(
    layout.screen,
    titleSize,
    itemSizes,
    {
      itemGap: layout.itemGap,
      columnGap: layout.columnGap,
      titleGap: layout.titleGap,
      backgroundMarginX: layout.backgroundMarginX,
      backgroundMarginY: layout.backgroundMarginY,
    },
    mode,
    true,
  );
}
