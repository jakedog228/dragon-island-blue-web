









import { DISPLAY_MODE } from "../runtimeSettings.js";
import {
  idiomPairPt,
  screenPointsForMode,
  unscaledIdiomPt,
  type DisplayMode,
} from "../displayMode.js";
import { nearestMinimumHit } from "@dib/renderer/hitTest";

/** Source `touchableNodes` arbitration shared by editable MonsterManagement styles 0/1. */
export function nearestEditorControl<T>(
  controls: readonly {
    readonly value: T;
    readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  }[],
  point: Readonly<{ x: number; y: number }>,
): T | undefined {
  return nearestMinimumHit(
    controls.map(({ value, rect }) => ({
      value,
      contentRect: rect,
      ownScale: { x: 1, y: 1 },
    })),
    point,
  );
}

/** `MonsterManagementNode editable` is true only for styles 0/1; its transition callback uses
 * that same ivar to gate the one-time Tutorial4 Plot event. */
export function partyManagementShowsFirstUseTutorial(style: number): boolean {
  return style === 0 || style === 1;
}




export const EDITOR_CAROUSEL_COCOS_Y_IPHONE = 170;
export const EDITOR_CAROUSEL_COCOS_Y_IPAD = 200;



export const EDITOR_RESERVES_COCOS_Y = 50;






export function editorToolboxTopGap(mode: DisplayMode = DISPLAY_MODE): number {
  return unscaledIdiomPt(5, mode);
}

/** The row Box's uniform gap: idiom pair `data_acc38/acc3c` = 20/40 native -> 20 normalized in
 *  both modes (monster-management.md Q5a). */
export const EDITOR_TOOLBOX_GAP_PT = 20;
/** Explicit `NSNumber(30)` GapNodes flank the Insert-Soul-Stone sub-box, REPLACING the uniform
 *  gap at those two slots (Box GapNode semantics, monster-management.md Q6). This proven bare
 *  literal is 30 phone / 15 normalized iPad. */
export function editorToolboxInsertGap(mode: DisplayMode = DISPLAY_MODE): number {
  return unscaledIdiomPt(30, mode);
}
/** Insert-Soul-Stone icon+label vertical sub-box gap: idiom pair `data_ac580/ac584` = 0/2 native
 *  -> 0 iPhone / 1 normalized iPad. */
export function editorInsertSubBoxGap(mode: DisplayMode = DISPLAY_MODE): number {
  return idiomPairPt(0, 2, mode);
}



export const EDITOR_INSERT_LABEL_FONT_PT = 15;
export const EDITOR_INSERT_LABEL_COLOR = 0x93cddd;

export function editorInsertLabelFont(mode: DisplayMode = DISPLAY_MODE): number {
  return idiomPairPt(15, 30, mode);
}

export function editorPartyHeadingFont(mode: DisplayMode = DISPLAY_MODE): number {
  return idiomPairPt(20, 40, mode);
}

/** Sort-column edge unit (`data_ac578/ac57c`) = 5 phone / 20 native iPad. The source placement
 * uses twice this unit from the lower-left edge. */
export function editorSortInset(mode: DisplayMode = DISPLAY_MODE): number {
  return idiomPairPt(5, 20, mode);
}

/** userObject tags, raw-confirmed (monster-management-editor.md Q2). */
export const EDITOR_TAG_ORDER_ALL_LEFT = 5;
export const EDITOR_TAG_ORDER_LEFT = 0;
export const EDITOR_TAG_INSERT_SOUL_STONE = 2;
export const EDITOR_TAG_ORDER_RIGHT = 1;
export const EDITOR_TAG_ORDER_ALL_RIGHT = 6;
export const EDITOR_TAG_SORT = 7;

export function editorHasTownTitle(style: 0 | 1): boolean {
  return style === 0;
}








export function editorHasReserveRow(style: 0 | 1, reserveCount: number): boolean {
  return style === 0 && reserveCount > 0;
}

/** `adjustBenchOrder:` deltas (monster-management-editor.md Q3): a ±1 step and a jump-to-
 *  front/back (`±999`, clamped inside the move). */
export const EDITOR_STEP_DELTA = 1;
export const EDITOR_JUMP_DELTA = 999;



export function editorArrowEnabled<T>(
  slots: readonly (T | undefined)[],
  selectedIndex: number,
  delta: number,
): boolean {
  if (
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= slots.length ||
    slots[selectedIndex] === undefined ||
    !Number.isInteger(delta)
  ) {
    return false;
  }
  const target = Math.min(slots.length - 1, Math.max(0, selectedIndex + delta));
  return target !== selectedIndex;
}

/** Sort modes cycle Name -> Stars -> Level (`sortReserves` / `imageForSortOrder`,
 *  monster-management-editor.md Q4). Inert in style 1 (reserves are nil) but the icon still
 *  advances + retextures each tap. */
export const EDITOR_SORT_ORDER_SPRITES = ["sortByName", "sortByStars", "sortByLevel"] as const;
export type EditorSortOrder = 0 | 1 | 2;

export function editorNextSortOrder(order: EditorSortOrder): EditorSortOrder {
  return ((order + 1) % 3) as EditorSortOrder;
}

export interface EditorSortValue {
  readonly localizedName: string;
  readonly stars: number;
  readonly level: number;
}










export function compareEditorSortValues(
  order: EditorSortOrder,
  left: EditorSortValue,
  right: EditorSortValue,
): number {
  if (order === 0) {
    return left.localizedName < right.localizedName
      ? -1
      : left.localizedName > right.localizedName ? 1 : 0;
  }
  if (order === 1) return right.stars - left.stars;
  return right.level - left.level;
}

export interface EditorControlSize {
  w: number;
  h: number;
}

export interface EditorToolboxSizes {
  arrowAllLeft: EditorControlSize;
  arrowLeft: EditorControlSize;
  soulStone: EditorControlSize;
  arrowRight: EditorControlSize;
  arrowAllRight: EditorControlSize;
  insertLabel: EditorControlSize;
}

export interface EditorToolboxControl {
  key: "orderAllLeftArrow" | "orderLeftArrow" | "soulStoneButton" | "orderRightArrow" | "orderAllRightArrow";
  tag: number;
  center: { x: number; y: number };
}

export interface EditorToolboxLayout {
  controls: readonly EditorToolboxControl[];
  insertLabelCenter: { x: number; y: number };
  /** The whole row Box's content height (drives the raw-confirmed `5 + h/2` center). */
  rowHeight: number;
}

/**
 * §1b's row layout in Pixi screen points: `{allLeft, left, GAP(30), insertSubBox, GAP(30), right,
 * allRight}` in a horizontal 20pt-gap Box, the whole box horizontally centered with its vertical
 * center at `editorToolboxTopGap(mode) + rowHeight/2`. Box children are cross-axis-centered on the
 * box line (`-[Box layoutChildren]` — followup-layout.md §1.3), so the arrows center on the row
 * line while the insert sub-box (label above icon, sub-gap idiom 0/2) centers as one unit.
 */
export function editorToolboxLayout(
  sizes: EditorToolboxSizes,
  mode: DisplayMode = DISPLAY_MODE,
): EditorToolboxLayout {
  const screen = screenPointsForMode(mode);
  const subGap = editorInsertSubBoxGap(mode);
  const insertGap = editorToolboxInsertGap(mode);
  const insertBoxH = sizes.soulStone.h + subGap + sizes.insertLabel.h;
  const insertBoxW = Math.max(sizes.soulStone.w, sizes.insertLabel.w);
  const rowHeight = Math.max(
    sizes.arrowAllLeft.h,
    sizes.arrowLeft.h,
    insertBoxH,
    sizes.arrowRight.h,
    sizes.arrowAllRight.h,
  );
  const rowCenterY = editorToolboxTopGap(mode) + rowHeight / 2;

  interface Slot {
    key: EditorToolboxControl["key"] | "insertBox";
    w: number;
    gapBefore: number;
  }
  const slots: Slot[] = [
    { key: "orderAllLeftArrow", w: sizes.arrowAllLeft.w, gapBefore: 0 },
    { key: "orderLeftArrow", w: sizes.arrowLeft.w, gapBefore: EDITOR_TOOLBOX_GAP_PT },
    { key: "insertBox", w: insertBoxW, gapBefore: insertGap },
    { key: "orderRightArrow", w: sizes.arrowRight.w, gapBefore: insertGap },
    { key: "orderAllRightArrow", w: sizes.arrowAllRight.w, gapBefore: EDITOR_TOOLBOX_GAP_PT },
  ];
  const totalWidth = slots.reduce((sum, slot) => sum + slot.gapBefore + slot.w, 0);
  const tags: Record<string, number> = {
    orderAllLeftArrow: EDITOR_TAG_ORDER_ALL_LEFT,
    orderLeftArrow: EDITOR_TAG_ORDER_LEFT,
    insertBox: EDITOR_TAG_INSERT_SOUL_STONE,
    orderRightArrow: EDITOR_TAG_ORDER_RIGHT,
    orderAllRightArrow: EDITOR_TAG_ORDER_ALL_RIGHT,
  };

  let cursor = screen.w / 2 - totalWidth / 2;
  const controls: EditorToolboxControl[] = [];
  let insertBoxCenterX = screen.w / 2;
  for (const slot of slots) {
    cursor += slot.gapBefore;
    const centerX = cursor + slot.w / 2;
    cursor += slot.w;
    if (slot.key === "insertBox") {
      insertBoxCenterX = centerX;
      // Negative vertical Box enumerates [label, icon], so label is visually above the icon.
      controls.push({
        key: "soulStoneButton",
        tag: tags[slot.key]!,
        center: {
          x: centerX,
          y: rowCenterY - insertBoxH / 2 + sizes.insertLabel.h + subGap + sizes.soulStone.h / 2,
        },
      });
    } else {
      controls.push({ key: slot.key, tag: tags[slot.key]!, center: { x: centerX, y: rowCenterY } });
    }
  }

  return {
    controls,
    insertLabelCenter: {
      x: insertBoxCenterX,
      y: rowCenterY - insertBoxH / 2 + sizes.insertLabel.h / 2,
    },
    rowHeight,
  };
}

export interface EditorSortColumnLayout {
  readonly iconCenter: { readonly x: number; readonly y: number };
  readonly labelCenter?: { readonly x: number; readonly y: number };
}




export function editorSortColumnLayout(
  icon: EditorControlSize,
  label: EditorControlSize | undefined,
  mode: DisplayMode = DISPLAY_MODE,
): EditorSortColumnLayout {
  const screen = screenPointsForMode(mode);
  const edge = editorSortInset(mode);
  const gap = idiomPairPt(10, 30, mode);
  const boxWidth = Math.max(icon.w, label?.w ?? 0);
  const centerX = 2 * edge + boxWidth / 2;
  return {
    iconCenter: {
      x: centerX,
      y: screen.h - (2 * edge + icon.h / 2),
    },
    ...(label === undefined
      ? {}
      : {
          labelCenter: {
            x: centerX,
            y: screen.h - (2 * edge + icon.h + gap + label.h / 2),
          },
        }),
  };
}



export function editorPartyHeadingAnchor(
  mode: DisplayMode = DISPLAY_MODE,
): { readonly x: number; readonly y: number } {
  return {
    x: editorSortInset(mode) + idiomPairPt(40, 60, mode),
    y: unscaledIdiomPt(110, mode),
  };
}


export function editorRemoveAllCenter(
  mode: DisplayMode = DISPLAY_MODE,
): { readonly x: number; readonly y: number } {
  const screen = screenPointsForMode(mode);
  return {
    x: idiomPairPt(70, 140, mode),
    y: screen.h - idiomPairPt(166, 330, mode),
  };
}

export const EDITOR_CARD_HEIGHT_PT = 80;

function editorCenterFromCocosBaseline(screenHeight: number, baselineY: number): number {
  return screenHeight - (baselineY + EDITOR_CARD_HEIGHT_PT / 2);
}

/** Editable batting-order card center converted from the CFlow's Cocos lower baseline. */
export function editorCarouselCenter(mode: DisplayMode = DISPLAY_MODE): { x: number; y: number } {
  const screen = screenPointsForMode(mode);
  const cocosY = mode === "ipad" ? EDITOR_CAROUSEL_COCOS_Y_IPAD : EDITOR_CAROUSEL_COCOS_Y_IPHONE;
  return { x: screen.w / 2, y: editorCenterFromCocosBaseline(screen.h, cocosY) };
}

/** Reserves-row center — below the batting order (follow-up §3's y=50/100 idiom pair, sharing X:
 *  50 normalized in both port modes). */
export function editorReservesCenter(mode: DisplayMode = DISPLAY_MODE): { x: number; y: number } {
  const screen = screenPointsForMode(mode);
  return {
    x: screen.w / 2,
    y: editorCenterFromCocosBaseline(
      screen.h,
      idiomPairPt(EDITOR_RESERVES_COCOS_Y, EDITOR_RESERVES_COCOS_Y * 2, mode),
    ),
  };
}



export function editorSelectionSummaryCenters(
  mode: DisplayMode = DISPLAY_MODE,
): {
  readonly batting: { readonly x: number; readonly y: number };
  readonly reserves: { readonly x: number; readonly y: number };
} {
  const screen = screenPointsForMode(mode);
  return {
    batting: {
      x: screen.w / 2,
      y: screen.h - idiomPairPt(260, 600, mode),
    },
    reserves: {
      x: screen.w / 2,
      y: screen.h - idiomPairPt(142, 350, mode),
    },
  };
}















export function editorPointInCflowStrip(
  point: Readonly<{ x: number; y: number }>,
  center: Readonly<{ x: number; y: number }>,
  largestWidth: number = EDITOR_CARD_HEIGHT_PT,
  tallestChild: number = EDITOR_CARD_HEIGHT_PT,
): boolean {
  return (
    Math.abs(point.x - center.x) < largestWidth &&
    point.y >= center.y - tallestChild / 2 &&
    point.y <= center.y + tallestChild / 2
  );
}
