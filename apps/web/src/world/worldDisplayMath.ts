import type { DisplayMode } from "../displayMode.js";
import { screenPointsForMode, sourcePointsPerPortPoint } from "../displayMode.js";


export const WORLD_VIEWPORT_TEXTURE_RECTS_PX = {
  iphone: { x: 0, y: 0, w: 960, h: 640 },
  ipad: { x: 0, y: 0, w: 1024, h: 768 },
} as const;

export const WORLD_NORMAL_MAP_TEXTURE_RECT_PX = { x: 0, y: 0, w: 960, h: 640 } as const;
export const WORLD_INDENTED_MAP_TEXTURE_RECT_PX = { x: 0, y: 0, w: 1024, h: 768 } as const;
export const WORLD_IPAD_BORDER_TEXTURE_RECT_PX = { x: 0, y: 0, w: 1024, h: 768 } as const;

export const WORLD_IPAD_MAP_INSET_SOURCE_PT = { x: 32, y: 64 } as const;
/** All state textures land at this scale in the port's normalized CSF-2 point space. */
export const WORLD_STATE_SPRITE_SCALE = 1 / 2;

export const WORLD_ADJACENT_MOVE_MS = 250;
export const WORLD_TELEPORT_FADE_OUT_MS = 250;
export const WORLD_TELEPORT_FADE_IN_MS = 500;
export const WORLD_WALK_FRAME_MS = 100;
export const WORLD_BATTLE_ZOOM_MS = 2000;
export const WORLD_RETURN_FADE_MS = 500;
export const WORLD_CARDINAL_SLIDE_MS = 1000;
export const WORLD_HERO_SCALE = { x: 0.8, y: 0.7 } as const;

/** GotoTownMenuItem is reachable from both WorldNode and DungeonNode MasterMenu callers. */
export function isTownPortalOutgoingScene(
  sceneKind: string | undefined,
): sceneKind is "world" | "dungeon" {
  return sceneKind === "world" || sceneKind === "dungeon";
}

export type WorldWalkDirection = "front" | "back" | "left" | "right";

export interface Point2 {
  x: number;
  y: number;
}

export interface WorldZoomTransform {
  readonly pivot: Point2;
  readonly finalPosition: Point2;
  readonly focus: Point2;
  readonly scale: 2;
  readonly zoomAndFadeInMs: number;
  readonly fadeOutMs: number;
}

export function worldMapTextureRect(
  _mode: DisplayMode,
  hasIndent = false,
): { x: number; y: number; w: number; h: number } {
  return hasIndent
    ? { ...WORLD_INDENTED_MAP_TEXTURE_RECT_PX }
    : { ...WORLD_NORMAL_MAP_TEXTURE_RECT_PX };
}

/** The device viewport folded from source pixels into the port's uniform CSF-2 space. */
export function worldMapSizePt(mode: DisplayMode): { w: number; h: number } {
  const rect = WORLD_VIEWPORT_TEXTURE_RECTS_PX[mode];
  return { w: rect.w / 2, h: rect.h / 2 };
}

export function worldMapSpriteSizePt(mode: DisplayMode, hasIndent = false): { w: number; h: number } {
  const rect = worldMapTextureRect(mode, hasIndent);
  return { w: rect.w / 2, h: rect.h / 2 };
}

/** Source sets rendererData.indent directly on the shared map/POI container on phone and clears
 * it on iPad. Convert only that translation vector from Cocos Y-up to Pixi Y-down; callers which
 * place a top-left-anchored Pixi map must also account for the map/viewport height difference. */
export function worldMapIndentToPixi(indent: Point2 | undefined, mode: DisplayMode): Point2 {
  if (indent === undefined || mode === "ipad") return { x: 0, y: 0 };
  return { x: indent.x, y: -indent.y };
}

export function hasWorldMapIndent(indent: Point2 | undefined): boolean {
  return indent !== undefined && (indent.x !== 0 || indent.y !== 0);
}

/**
 * Shared map/POI-container placement from `WorldNode.initWithWorld:autoEnterTown:`. A normal iPad
 * world keeps the phone's 960x640 map and places it at native (32,64) inside ipadBorder.png. The
 * port divides native iPad points by two. Indented maps instead use their phone indent and clear
 * it on iPad; they do not create the border.
 */
export function worldMapPositionToPixi(indent: Point2 | undefined, mode: DisplayMode): Point2 {
  if (hasWorldMapIndent(indent)) {
    const translation = worldMapIndentToPixi(indent, mode);
    const viewport = worldMapSizePt(mode);
    const map = worldMapSpriteSizePt(mode, true);
    return {
      x: translation.x,
      // Cocos anchors the 384pt-tall map at its bottom-left while Pixi anchors it at its top-left.
      // On phone the viewport is only 320pt tall, so negating indent.y alone places the background
      // 64pt below the POIs. Shift by viewportHeight-mapHeight to keep both in one local frame.
      y: translation.y + viewport.h - map.h,
    };
  }
  if (mode === "iphone") return { x: 0, y: 0 };
  const normalize = sourcePointsPerPortPoint(mode);
  return {
    x: WORLD_IPAD_MAP_INSET_SOURCE_PT.x / normalize,
    y: WORLD_IPAD_MAP_INSET_SOURCE_PT.y / normalize,
  };
}

/**
 * Source iPad multiplies authored POI coordinates by 2, then this port normalizes native iPad
 * points by the same factor. Keeping both operations explicit documents why the authored point is
 * numerically unchanged here instead of accidentally copying the phone tier into shared geometry.
 */
export function worldPoiPointToPort(pointCocos: Point2, mode: DisplayMode): Point2 {
  const sourceMultiplier = mode === "ipad" ? 2 : 1;
  const normalize = sourcePointsPerPortPoint(mode);
  return {
    x: (pointCocos.x * sourceMultiplier) / normalize,
    y: (pointCocos.y * sourceMultiplier) / normalize,
  };
}

/**
 * Cocos bottom-left/Y-up authored point -> Pixi top-left/Y-down map-local point. Normal maps use
 * the source's 960x640 gameplay rectangle in both idioms; every indented map uses its full
 * 1024x768 crop as the local coordinate frame. Container placement is deliberately separate.
 */
export function worldPoiPointToPixi(
  pointCocos: Point2,
  mode: DisplayMode,
  hasIndent = false,
): Point2 {
  const point = worldPoiPointToPort(pointCocos, mode);
  const localHeight = hasIndent
    ? worldMapSpriteSizePt(mode, true).h
    : WORLD_NORMAL_MAP_TEXTURE_RECT_PX.h / 2;
  return { x: point.x, y: localHeight - point.y };
}

/** Authored POI point in scene coordinates, after the source map-container placement. */
export function worldPoiPointToScenePixi(
  pointCocos: Point2,
  mode: DisplayMode,
  mapIndent?: Point2,
): Point2 {
  const point = worldPoiPointToPixi(pointCocos, mode, hasWorldMapIndent(mapIndent));
  const mapPosition = worldMapPositionToPixi(mapIndent, mode);
  return { x: point.x + mapPosition.x, y: point.y + mapPosition.y };
}


export function worldBattleZoomTransform(
  pointCocos: Point2,
  mode: DisplayMode,
  mapIndent?: Point2,
): WorldZoomTransform {
  const point = worldPoiPointToScenePixi(pointCocos, mode, mapIndent);
  const size = screenPointsForMode(mode);
  const pivot = { x: size.w / 2, y: size.h / 2 };
  const halfVisible = { x: size.w / 4, y: size.h / 4 };
  const focus = {
    x: Math.min(size.w - halfVisible.x, Math.max(halfVisible.x, point.x)),
    y: Math.min(size.h - halfVisible.y, Math.max(halfVisible.y, point.y)),
  };
  return {
    pivot,
    focus,
    finalPosition: {
      x: pivot.x + 2 * (pivot.x - focus.x),
      y: pivot.y + 2 * (pivot.y - focus.y),
    },
    scale: 2,
    zoomAndFadeInMs: WORLD_BATTLE_ZOOM_MS * 0.66,
    fadeOutMs: WORLD_BATTLE_ZOOM_MS * 0.33,
  };
}

/** Dominant-axis direction used by WorldNode's idle/walk frame selectors. */
export function worldWalkDirection(fromCocos: Point2, toCocos: Point2): WorldWalkDirection {
  const dx = toCocos.x - fromCocos.x;
  const dy = toCocos.y - fromCocos.y;
  if (dx === 0 && dy === 0) return "front";
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "front" : "back";
}

/** Native walk completion uses the new walk direction; a teleport preserves `lastWalkDir`. */
export function worldSettledDirection(
  fromCocos: Point2,
  toCocos: Point2,
  movement: "walk" | "teleport",
  lastWalkDirection: WorldWalkDirection,
): WorldWalkDirection {
  return movement === "walk"
    ? worldWalkDirection(fromCocos, toCocos)
    : lastWalkDirection;
}

export function worldWalkFrameName(direction: WorldWalkDirection, frame: number): string {
  if (!Number.isInteger(frame) || frame < 1 || frame > 8) {
    throw new Error(`world walk frame must be an integer in [1,8], got ${frame}`);
  }
  const stem = direction[0]!.toUpperCase() + direction.slice(1);
  return `herowalk${stem}_${frame}.png`;
}

export function isCardinalWorldStep(fromWorld: string, toWorld: string): boolean {
  const a = parseWorldGrid(fromWorld);
  const b = parseWorldGrid(toWorld);
  return a !== null && b !== null && Math.abs(b.x - a.x) + Math.abs(b.y - a.y) === 1;
}

export function cardinalWorldSlideDelta(
  fromWorld: string,
  toWorld: string,
  mode: DisplayMode,
): Point2 | null {
  const a = parseWorldGrid(fromWorld);
  const b = parseWorldGrid(toWorld);
  if (a === null || b === null) return null;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  const screen = screenPointsForMode(mode);
  // World grid y is a logical row. Pixi's visual y grows downward, hence the sign inversion.
  return {
    x: dx === 0 ? 0 : dx * screen.w,
    y: dy === 0 ? 0 : -dy * screen.h,
  };
}

export type WorldTransitionPresentation =
  | {
      readonly kind: "cardinal-slide";
      readonly delta: Point2;
    }
  | { readonly kind: "fade" };


export function worldTransitionPresentation(
  fromWorld: string,
  toWorld: string,
  mode: DisplayMode,
): WorldTransitionPresentation {
  const delta = cardinalWorldSlideDelta(fromWorld, toWorld, mode);
  return delta === null ? { kind: "fade" } : { kind: "cardinal-slide", delta };
}

function parseWorldGrid(value: string): Point2 | null {
  const match = /^World_(\d+)-(\d+)$/.exec(value);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

/**
 * Stage-root z of the director notification layer (`WorldNotificationHost`, the Pixi counterpart of
 * `CCDirector.notificationNode`).
 *
 * Every scene root that routes its popups here through `registerAutomaticPresentationRoot` must
 * sort BELOW this value, or it renders and hit-tests over its own popups.
 */
export const WORLD_NOTIFICATION_Z_INDEX = 30_000;
