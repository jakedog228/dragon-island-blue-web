import {
  idiomPairPt,
  unscaledIdiomPt,
  type DisplayMode,
  type SizePt,
} from "../displayMode.js";
import { popupMenuHorizontalItemLayout } from "../ui/popupMenuMath.js";

export interface CollectionMenuMetrics {
  readonly configName: "CenteredWithClose";
  readonly columnCount: 1;
  readonly alignment: "center";
  readonly titleFontSize: number;
  readonly rowFontSize: number;
  readonly itemGap: number;
  readonly columnGap: number;
  readonly titleGap: number;
  readonly outlineWidth: number;
  readonly closeInset: number;
  readonly closeItemGap: number;
  readonly backgroundMarginX: number;
  readonly backgroundMarginY: number;
}


export function formatCollectionRowLabel(localizedTitle: string, percentComplete: number): string {
  if (!Number.isInteger(percentComplete)) {
    throw new Error("Collection row percent must be an integer");
  }
  return `${localizedTitle} (${percentComplete}%)`;
}

/**
 * Shared PopupMenu defaults plus `Menus.plist.CenteredWithClose`.
 *
 * The font/gap/margin values are source-native idiom pairs. The 2pt outline and 10pt close inset
 * are proven bare literals and therefore halve in the port's normalized iPad point space.
 */
export function collectionMenuMetrics(mode: DisplayMode): CollectionMenuMetrics {
  return {
    configName: "CenteredWithClose",
    columnCount: 1,
    alignment: "center",
    titleFontSize: idiomPairPt(25, 50, mode),
    rowFontSize: idiomPairPt(20, 40, mode),
    itemGap: idiomPairPt(30, 60, mode),
    columnGap: idiomPairPt(30, 60, mode),
    titleGap: idiomPairPt(10, 20, mode),
    outlineWidth: unscaledIdiomPt(2, mode),
    closeInset: unscaledIdiomPt(10, mode),
    closeItemGap: idiomPairPt(10, 20, mode),
    backgroundMarginX: idiomPairPt(9, 18, mode),
    backgroundMarginY: idiomPairPt(6, 12, mode),
  };
}







export function collectionCompletedRowTint(elapsedMs: number): number {
  const phaseMs = elapsedMs % 1_000;
  const yellowProgress = phaseMs <= 500
    ? phaseMs / 500
    : (1_000 - phaseMs) / 500;
  const blue = Math.round(255 * (1 - yellowProgress));
  return 0xffff00 | blue;
}

/**
 * `Menus.plist.CenteredWithClose` authors both `closeImage` and `closeButtonKey`. PopupMenu builds
 * one icon-left horizontal Box (10/20 native gap), then anchors the WHOLE item at the source
 * top-right inset. The icon-only control formerly used by the port omitted the visible Back label
 * and gave the wrong input bounds.
 */
export function collectionCloseItemLayout(
  screen: SizePt,
  mode: DisplayMode,
  labelSize: SizePt,
  iconSize: SizePt,
): {
  readonly position: { readonly x: number; readonly y: number };
  readonly contentSize: SizePt;
  readonly label: { readonly x: number; readonly y: number };
  readonly icon: { readonly x: number; readonly y: number };
} {
  const metrics = collectionMenuMetrics(mode);
  const item = popupMenuHorizontalItemLayout(
    labelSize,
    iconSize,
    "left",
    metrics.closeItemGap,
    mode,
  );
  return {
    position: {
      x: screen.w - metrics.closeInset - item.content.w,
      y: metrics.closeInset,
    },
    contentSize: item.content,
    label: item.label,
    icon: item.accessory,
  };
}
