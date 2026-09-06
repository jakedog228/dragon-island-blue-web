import type { DisplayMode } from "../displayMode.js";
import {
  idiomPairPt,
  screenPointsForMode,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
} from "../displayMode.js";
import {
  popupMenuGeometry,
  type PopupMenuGeometry,
  type PopupMenuSize,
} from "../ui/popupMenuMath.js";

export interface GuildTavernLayout {
  itemFontSize: number;
  itemGap: number;
  columnGap: number;
  itemIconGap: number;
  notificationFontSize: number;
  backgroundMarginX: number;
  backgroundMarginY: number;
  closeInset: number;
  outlineWidth: number;
}

export interface GuildQuestDisplayLayout {
  itemFontSize: number;
  titleFontSize: number;
  itemGap: number;
  itemIconGap: number;
  boxGap: number;
  outlineWidth: number;
  roundingScale: number;
}

export interface GuildTavernBackgroundLayout {
  textureRectPx: { x: number; y: number; w: number; h: number };
  sizePt: { w: number; h: number };
  positionPt: { x: number; y: number };
}


export function guildTavernBackgroundLayout(mode: DisplayMode): GuildTavernBackgroundLayout {
  const screen = screenPointsForMode(mode);
  const sizePt = { w: 512, h: 384 };
  return {
    textureRectPx: { x: 0, y: 0, w: 1024, h: 768 },
    sizePt,
    positionPt: {
      x: (screen.w - sizePt.w) / 2,
      y: (screen.h - sizePt.h) / 2,
    },
  };
}


export function guildTavernLayout(mode: DisplayMode): GuildTavernLayout {
  return {
    itemFontSize: idiomPairPt(20, 40, mode),
    itemGap: idiomPairPt(40, 80, mode),
    columnGap: idiomPairPt(50, 100, mode),
    itemIconGap: idiomPairPt(10, 20, mode),
    notificationFontSize: idiomPairPt(13, 26, mode),
    backgroundMarginX: idiomPairPt(9, 18, mode),
    backgroundMarginY: idiomPairPt(6, 12, mode),
    closeInset: unscaledIdiomPt(10, mode),
    outlineWidth: unscaledIdiomPt(2, mode),
  };
}


export function guildTavernMenuGeometry(
  mode: DisplayMode,
  columnItemSizes: readonly (readonly PopupMenuSize[])[],
): PopupMenuGeometry {
  const screen = screenPointsForMode(mode);
  const layout = guildTavernLayout(mode);
  return popupMenuGeometry(
    screen,
    null,
    columnItemSizes,
    {
      itemGap: layout.itemGap,
      columnGap: layout.columnGap,
      titleGap: 0,
      backgroundMarginX: layout.backgroundMarginX,
      backgroundMarginY: layout.backgroundMarginY,
    },
    mode,
  );
}


export function guildQuestDisplayLayout(mode: DisplayMode): GuildQuestDisplayLayout {
  return {
    itemFontSize: idiomPairPt(20, 40, mode),
    titleFontSize: idiomPairPt(25, 50, mode),
    itemGap: idiomPairPt(20, 40, mode),
    itemIconGap: idiomPairPt(10, 20, mode),
    boxGap: unscaledIdiomPt(5, mode),
    outlineWidth: unscaledIdiomPt(2, mode),
    roundingScale: sourcePointsPerPortPoint(mode),
  };
}
