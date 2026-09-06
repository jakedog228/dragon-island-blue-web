


import {
  idiomPairPt,
  screenPointsForMode,
  sourcePointsPerPortPoint,
  type DisplayMode,
} from "../displayMode.js";
import { nearestMinimumHit } from "@dib/renderer/hitTest";

export interface ManagementTouchable<T> {
  readonly value: T;
  /** Authored content rect in the MonsterManagementNode coordinate frame. */
  readonly rect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}


export function nearestManagementTouchable<T>(
  candidates: readonly ManagementTouchable<T>[],
  point: Readonly<{ x: number; y: number }>,
): T | undefined {
  return nearestMinimumHit(
    candidates.map(({ value, rect }) => ({
      value,
      contentRect: rect,
      ownScale: { x: 1, y: 1 },
    })),
    point,
  );
}

export const MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX = { x: 0, y: 0, w: 1024, h: 768 } as const;
export const MANAGEMENT_BACKGROUND_SIZE_PT = { w: 512, h: 384 } as const;


export const MANAGEMENT_BACKGROUND_TINT = 0x505050;
export const MANAGEMENT_CARD_SIZE_PT = 80;
export const MANAGEMENT_VISIBLE_EACH_SIDE = 3;
export const MANAGEMENT_SIDE_ORBIT_DEG = 75;


export const MANAGEMENT_PERSPECTIVE_Z_EYE_DIVISOR = Math.fround(1.1566);

export const MANAGEMENT_ORBIT_RADIANS_PER_DEGREE = Math.fround(Math.PI / 180);


export const MANAGEMENT_PERSPECTIVE_HEIGHT_SCALE_IPHONE = 1;
export const MANAGEMENT_PERSPECTIVE_HEIGHT_SCALE_IPAD = 1;
export const MANAGEMENT_SELECTED_ALPHA = 255;
export const MANAGEMENT_SIDE_ALPHA_BASE = 128;
export const MANAGEMENT_SIDE_ALPHA_RANGE = 127;


export const MANAGEMENT_CAROUSEL_COCOS_Y_IPHONE = 130;
export const MANAGEMENT_CAROUSEL_COCOS_Y_IPAD = 150;
export const MANAGEMENT_CAROUSEL_EDITABLE_COCOS_Y_IPHONE = 170;
export const MANAGEMENT_CAROUSEL_EDITABLE_COCOS_Y_IPAD = 200;


export const MANAGEMENT_DETAIL_COCOS_Y_IPHONE = 260;
export const MANAGEMENT_DETAIL_COCOS_Y_IPAD = 300;
export const MANAGEMENT_RESERVES_DETAIL_COCOS_Y_IPHONE = 142;
export const MANAGEMENT_RESERVES_DETAIL_COCOS_Y_IPAD = 175;
export const MANAGEMENT_TITLE_COCOS_Y = 5;
export const MANAGEMENT_DETAIL_HOLD_MS = 2000;
export const MANAGEMENT_DETAIL_FADE_MS = 200;


export const MANAGEMENT_STAR_COUNT_FONT_PT = 16;
export const MANAGEMENT_LEVEL_FONT_PT = 18;
export const MANAGEMENT_STAR_TEXT_GAP_PT = 2;

export interface ManagementSummarySize {
  readonly w: number;
  readonly h: number;
}


export function managementSummaryBoxPosition(size: ManagementSummarySize): {
  readonly x: number;
  readonly y: number;
} {
  return { x: -size.w / 2, y: -size.h / 2 };
}

export const MANAGEMENT_KO_FONT_PT = 30;
/** Title label: fontSize data_acc30/acc34 = 16/32 (an idiom PAIR — lands on 16 in normalized
 *  space on both tiers), color ccColor3B(0x93,0xcd,0xdd) @ setColor:, position
 *  winSize·(0.5,0) + (0, 5/10). */
export const MANAGEMENT_TITLE_FONT_PT = 16;
export const MANAGEMENT_TITLE_COLOR = 0x93cddd;
/** `r0_11` child enumeration in style 2: tag 3 is appended before tag 4. */
export const MANAGEMENT_SELECTION_CONTROL_ORDER = ["select", "cancel"] as const;

export interface ManagementSelectionControlsLayout {
  readonly fontPt: number;
  readonly gapPt: number;
  readonly roundingScale: number;
  readonly cocosCenterY: number;
  /** Pixi top-left for the Box after the localized label-sized row has been measured. */
  positionForSize(size: { readonly w: number; readonly h: number }): {
    readonly x: number;
    readonly y: number;
  };
}


export function managementSelectionControlsLayout(
  mode: DisplayMode,
): ManagementSelectionControlsLayout {
  const screen = screenPointsForMode(mode);
  const cocosCenterY = idiomPairPt(60, 240, mode);
  return {
    fontPt: idiomPairPt(14, 24, mode),
    gapPt: idiomPairPt(30, 60, mode),
    roundingScale: sourcePointsPerPortPoint(mode),
    cocosCenterY,
    positionForSize: ({ w, h }) => ({
      x: screen.w * 0.5 - w * 0.5,
      // Native Box children straddle the Box's Cocos y origin. The renderer Box owns a top-left
      // local rectangle, so flip the row center and subtract half its measured height.
      y: screen.h - cocosCenterY - h * 0.5,
    }),
  };
}

export type ManagementStyle = 0 | 1 | 2 | 3 | 4;

export interface ManagementStyleConfig {
  titleKey: string;

  editable: boolean;


  hasReservesRow: boolean;


  hasSelectButton: boolean;
  hasCloseButton: boolean;
  /** Styles 0/1 build the orderAll arrows / sort / soul-stone toolbox (label_ab8b8). */
  hasEditorToolbox: boolean;
}


export function managementStyleConfig(style: ManagementStyle): ManagementStyleConfig {
  const titleKey =
    style === 2 ? "MonsterpediaSelectionTitleKey"
    : style === 3 ? "RepeatEggSelectionTitleKey"
    : style === 4 ? "MonsterpediaViewOnlyTitleKey"
    : "TownGroupKey";
  return {
    titleKey,
    editable: style === 0 || style === 1,
    hasReservesRow: style === 0,
    hasSelectButton: style === 2 || style === 3,
    hasCloseButton: style !== 3,
    hasEditorToolbox: style === 0 || style === 1,
  };
}

export interface CoverflowCardLayout {
  visible: boolean;
  x: number;
  opacity: number;
  orbitDeg: number;
  zIndex: number;
}

export interface CoverflowProjectedPoint {
  readonly x: number;
  readonly y: number;
  /** Perspective clip W relative to the unrotated z=0 plane. Retaining this in the renderer is
   *  what makes texture interpolation follow the source plane instead of an affine quad. */
  readonly depthRatio: number;
}

export interface CoverflowProjectedQuad {
  readonly topLeft: CoverflowProjectedPoint;
  readonly topRight: CoverflowProjectedPoint;
  readonly bottomLeft: CoverflowProjectedPoint;
  readonly bottomRight: CoverflowProjectedPoint;
}

export function managementPerspectiveZEyePt(
  screenHeightPt: number,
  mode: DisplayMode,
): number {
  const projectionHeightScale = mode === "ipad"
    ? MANAGEMENT_PERSPECTIVE_HEIGHT_SCALE_IPAD
    : MANAGEMENT_PERSPECTIVE_HEIGHT_SCALE_IPHONE;
  return Math.fround(
    Math.fround(screenHeightPt * projectionHeightScale) /
      MANAGEMENT_PERSPECTIVE_Z_EYE_DIVISOR,
  );
}


export function managementPerspectiveFocalPt(screenHeightPt: number): number {
  const halfAngle = Math.fround(60 * Math.fround(Math.PI / 360));
  const tangent = Math.fround(Math.tan(halfAngle));
  return Math.fround(screenHeightPt / Math.fround(2 * tangent));
}

/** Float32 operation boundaries from CCOrbitCamera init/update. The host Math transcendental is
 * rounded to the imported `sinf`/`cosf` result width before reaching the GPU. */
export function sourceCoverflowOrbitTrig(degrees: number): { sin: number; cos: number } {
  const radians = Math.fround(Math.fround(degrees) * MANAGEMENT_ORBIT_RADIANS_PER_DEGREE);
  return {
    sin: Math.fround(Math.sin(radians)),
    cos: Math.fround(Math.cos(radians)),
  };
}


export function projectCoverflowCardPoint(opts: {
  readonly localX: number;
  readonly localY: number;
  readonly pivot: { readonly x: number; readonly y: number };
  readonly screen: { readonly w: number; readonly h: number };
  readonly mode: DisplayMode;
  readonly orbitDeg: number;
}): CoverflowProjectedPoint {
  const trig = sourceCoverflowOrbitTrig(opts.orbitDeg);
  const zEye = managementPerspectiveZEyePt(opts.screen.h, opts.mode);
  const focal = managementPerspectiveFocalPt(opts.screen.h);
  const sourceUnitsPerPortPoint = opts.mode === "ipad" ? 2 : 1;
  const worldZ = Math.fround(
    Math.fround(trig.sin * Math.fround(opts.localX)) -
      Math.pow(2, -23) / sourceUnitsPerPortPoint,
  );
  const cameraDistance = Math.fround(zEye - worldZ);
  const depthRatio = Math.fround(cameraDistance / zEye);
  const rotatedX = Math.fround(
    Math.fround(opts.pivot.x) + Math.fround(trig.cos * Math.fround(opts.localX)),
  );
  const worldY = Math.fround(Math.fround(opts.pivot.y) + Math.fround(opts.localY));
  const cameraX = Math.fround(opts.screen.w / 2);
  const cameraY = Math.fround(opts.screen.h / 2);
  return {
    x: Math.fround(cameraX + Math.fround(focal * Math.fround(rotatedX - cameraX)) / cameraDistance),
    y: Math.fround(cameraY + Math.fround(focal * Math.fround(worldY - cameraY)) / cameraDistance),
    depthRatio,
  };
}

/** Four source card corners in draw order, including the asymmetric near/far edge heights. */
export function coverflowProjectedQuad(opts: {
  readonly pivot: { readonly x: number; readonly y: number };
  readonly screen: { readonly w: number; readonly h: number };
  readonly mode: DisplayMode;
  readonly orbitDeg: number;
  readonly width?: number;
  readonly height?: number;
}): CoverflowProjectedQuad {
  const halfWidth = (opts.width ?? MANAGEMENT_CARD_SIZE_PT) / 2;
  const height = opts.height ?? MANAGEMENT_CARD_SIZE_PT;
  const project = (localX: number, localY: number): CoverflowProjectedPoint =>
    projectCoverflowCardPoint({
      localX,
      localY,
      pivot: opts.pivot,
      screen: opts.screen,
      mode: opts.mode,
      orbitDeg: opts.orbitDeg,
    });
  return {
    topLeft: project(-halfWidth, -height),
    topRight: project(halfWidth, -height),
    bottomLeft: project(-halfWidth, 0),
    bottomRight: project(halfWidth, 0),
  };
}

function sourceRoundPositive(value: number): number {
  return Math.floor(value + 0.5);
}

/** Integer-index layout recovered from CFlowNode's usesBackgrounds branch. */
function integerLayout(itemIndex: number, selectedIndex: number): CoverflowCardLayout {
  const distance = itemIndex - selectedIndex;
  const abs = Math.abs(distance);
  const visible = abs <= MANAGEMENT_VISIBLE_EACH_SIDE;
  if (distance === 0) {
    return {
      visible: true,
      x: 0,
      opacity: MANAGEMENT_SELECTED_ALPHA,
      orbitDeg: 0,
      zIndex: MANAGEMENT_VISIBLE_EACH_SIDE + 1,
    };
  }
  const sign = Math.sign(distance);
  return {
    visible,
    x: Math.fround(sign * Math.fround(
      Math.fround(MANAGEMENT_CARD_SIZE_PT / 2) +
        Math.fround(Math.fround(abs / 3) * MANAGEMENT_CARD_SIZE_PT),
    )),
    opacity: Math.trunc(
      MANAGEMENT_SIDE_ALPHA_BASE +
        MANAGEMENT_SIDE_ALPHA_RANGE * (1 - abs / (MANAGEMENT_VISIBLE_EACH_SIDE + 1)),
    ),
    orbitDeg: sign * MANAGEMENT_SIDE_ORBIT_DEG,
    zIndex: MANAGEMENT_VISIBLE_EACH_SIDE - abs,
  };
}

/**
 * CFlowNode lays out around roundf(selectedIndex), then linearly blends toward the adjacent
 * integer arrangement by the fractional distance. Style 4 opens at instantSetSelectedIndex:0.
 */
export function coverflowLayout(itemIndex: number, selectedIndex: number): CoverflowCardLayout {
  const showingIndex = sourceRoundPositive(selectedIndex);
  const fraction = Math.fround(Math.fround(selectedIndex) - showingIndex);
  const nextIndex = showingIndex + Math.sign(fraction);
  const weight = Math.fround(Math.abs(fraction));
  const from = integerLayout(itemIndex, showingIndex);
  if (weight === 0) return from;
  const to = integerLayout(itemIndex, nextIndex);
  return {
    // updateValues decides visibility from the rounded/current index before calculating the
    // neighboring arrangement. The neighbor can therefore be distance four (one beyond the
    // three-card window), and its real geometry must still participate in interpolation. It is
    // not an invisible layout at the origin: substituting zero made outgoing cards reverse back
    // toward center and narrowed the outside of the arc before they disappeared.
    visible: from.visible,
    x: Math.fround(
      Math.fround(from.x * Math.fround(1 - weight)) + Math.fround(to.x * weight),
    ),
    opacity: Math.trunc(Math.fround(
      Math.fround(Math.fround(
        MANAGEMENT_SIDE_ALPHA_BASE +
          Math.fround(MANAGEMENT_SIDE_ALPHA_RANGE * Math.fround(
            1 - Math.abs(itemIndex - showingIndex) / (MANAGEMENT_VISIBLE_EACH_SIDE + 1),
          )),
      ) * Math.fround(1 - weight)) +
      Math.fround(Math.fround(
        MANAGEMENT_SIDE_ALPHA_BASE +
          Math.fround(MANAGEMENT_SIDE_ALPHA_RANGE * Math.fround(
            1 - Math.abs(itemIndex - nextIndex) / (MANAGEMENT_VISIBLE_EACH_SIDE + 1),
          )),
      ) * weight),
    )),
    orbitDeg: Math.fround(
      Math.fround(from.orbitDeg * Math.fround(1 - weight)) +
        Math.fround(to.orbitDeg * weight),
    ),
    // reorderChild:z: is selected from the rounded/current distance; z is not interpolated.
    zIndex: from.zIndex,
  };
}


export function coverflowTouchBoundsX(
  cards: readonly { readonly visible: boolean; readonly x: number }[],
  itemWidth = MANAGEMENT_CARD_SIZE_PT,
): { readonly left: number; readonly right: number } {
  let left = 9999;
  let right = 0;
  for (const card of cards) {
    if (!card.visible) continue;
    left = Math.min(left, card.x - itemWidth / 2);
    right = Math.max(right, card.x + itemWidth / 2);
  }
  return { left, right };
}


export function pointInCoverflowBounds(opts: {
  readonly x: number;
  readonly y: number;
  readonly originX: number;
  readonly originY: number;
  readonly bounds: { readonly left: number; readonly right: number };
  readonly tallestChild?: number;
}): boolean {
  const tallest = opts.tallestChild ?? MANAGEMENT_CARD_SIZE_PT;
  return (
    opts.x >= opts.originX + opts.bounds.left &&
    opts.x <= opts.originX + opts.bounds.right &&
    opts.y >= opts.originY - tallest / 2 &&
    opts.y <= opts.originY + tallest / 2
  );
}

/** -[CFlowNode updateValues]: selected = selected*0.9 + actual*0.1, in float32. */
export function advanceCoverflowIndex(selectedIndex: number, actualSelectedIndex: number): number {
  if (selectedIndex === actualSelectedIndex) return selectedIndex;
  return Math.fround(Math.fround(selectedIndex * 0.9) + Math.fround(actualSelectedIndex * 0.1));
}


export const COVERFLOW_FRAME_MS = 1000 / 60;

/**
 * Splits accumulated presentation time into whole source frames plus the carry-over remainder.
 *
 * The epsilon is a float-accumulation guard, not a fudge: summing a display's tick length (e.g.
 * 1000/144) never lands exactly on a multiple of 1000/60, so without it a run of ticks covering a
 * true second would yield 59 frames instead of 60 and the flow would drift permanently slow. A
 * nanosecond is orders of magnitude below any timing this mechanism can observe.
 */
const EASE_FRAME_EPSILON_MS = 1e-9;

export function coverflowEaseFrames(accumulatedMs: number): {
  readonly frames: number;
  readonly remainderMs: number;
} {
  if (!(accumulatedMs > 0)) return { frames: 0, remainderMs: 0 };
  const frames = Math.floor((accumulatedMs + EASE_FRAME_EPSILON_MS) / COVERFLOW_FRAME_MS);
  return { frames, remainderMs: Math.max(0, accumulatedMs - frames * COVERFLOW_FRAME_MS) };
}

/** `advanceCoverflowIndex` applied once per elapsed source frame. */
export function advanceCoverflowIndexFrames(
  selectedIndex: number,
  actualSelectedIndex: number,
  frames: number,
): number {
  let value = selectedIndex;
  for (let frame = 0; frame < frames; frame += 1) {
    value = advanceCoverflowIndex(value, actualSelectedIndex);
  }
  return value;
}


export function presentCoverflowIndex(
  selectedIndex: number,
  actualSelectedIndex: number,
  remainderMs: number,
): number {
  if (selectedIndex === actualSelectedIndex) return selectedIndex;
  if (!(remainderMs > 0)) return selectedIndex;
  const next = advanceCoverflowIndex(selectedIndex, actualSelectedIndex);
  const fraction = remainderMs / COVERFLOW_FRAME_MS;
  if (fraction >= 1) return next;
  // (1 - 0.9^f)/(1 - 0.9) rises 0 -> 1 across the frame along the blend's own exponential, so the
  // visual residual decays continuously instead of stepping.
  const progress = (1 - Math.pow(0.9, fraction)) / (1 - 0.9);
  return selectedIndex + (next - selectedIndex) * Math.min(1, Math.max(0, progress));
}


export function draggedCoverflowIndex(opts: {
  anchorIndex: number;
  startX: number;
  currentX: number;
  selectedIndex: number;
  actualSelectedIndex: number;
  itemCount: number;
}): number {
  if (!Number.isInteger(opts.itemCount) || opts.itemCount < 1) {
    throw new Error(`invalid coverflow item count: ${opts.itemCount}`);
  }
  const drag = opts.startX - opts.currentX;
  const gain = 1 + Math.abs(opts.selectedIndex - opts.actualSelectedIndex) * 0.2;
  const requested = opts.anchorIndex + (drag * gain) / MANAGEMENT_CARD_SIZE_PT;
  return Math.min(opts.itemCount - 1, Math.max(0, requested));
}

export function showingCoverflowIndex(selectedIndex: number, itemCount: number): number {
  if (!Number.isInteger(itemCount) || itemCount < 1) throw new Error(`invalid coverflow item count: ${itemCount}`);
  return Math.min(itemCount - 1, Math.max(0, sourceRoundPositive(selectedIndex)));
}


export function updateSelectionTouchState(opts: {
  selectable: boolean;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  threshold: number;
}): boolean {
  return opts.selectable && Math.hypot(opts.currentX - opts.startX, opts.currentY - opts.startY) <= opts.threshold;
}


export function evolutionProgressPercent(level: number, evolveLevel: number, previousEvolveLevel = 1): number {
  const span = Math.max(0, evolveLevel - previousEvolveLevel);
  const remaining = evolveLevel - level;
  if (span <= 0 || remaining >= span) return 1;
  const roundedRemainingPercent = Math.round((remaining / span) * 100);
  return Math.min(99, Math.max(1, 100 - roundedRemainingPercent));
}

/** Opacity pair for the two 2.0s hold + 0.2s cross-fade repeating detail sequences. */
export function managementDetailOpacity(elapsedMs: number): { summary: number; evolution: number } {
  const cycle = 2 * (MANAGEMENT_DETAIL_HOLD_MS + MANAGEMENT_DETAIL_FADE_MS);
  const t = ((elapsedMs % cycle) + cycle) % cycle;
  if (t < MANAGEMENT_DETAIL_HOLD_MS) return { summary: 1, evolution: 0 };
  if (t < MANAGEMENT_DETAIL_HOLD_MS + MANAGEMENT_DETAIL_FADE_MS) {
    const p = (t - MANAGEMENT_DETAIL_HOLD_MS) / MANAGEMENT_DETAIL_FADE_MS;
    return { summary: 1 - p, evolution: p };
  }
  if (t < MANAGEMENT_DETAIL_HOLD_MS * 2 + MANAGEMENT_DETAIL_FADE_MS) {
    return { summary: 0, evolution: 1 };
  }
  const p = (t - (MANAGEMENT_DETAIL_HOLD_MS * 2 + MANAGEMENT_DETAIL_FADE_MS)) / MANAGEMENT_DETAIL_FADE_MS;
  return { summary: p, evolution: 1 - p };
}
