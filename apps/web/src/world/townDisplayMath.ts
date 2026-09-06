import { idiomPairPt, unscaledIdiomPt, type DisplayMode } from "../displayMode.js";


export const TOWN_ENTRY_ZOOM_MS = 5_000;
export const TOWN_ENTRY_REVEAL_DELAY_MS = 1_000;
export const TOWN_MENU_FADE_MS = 500;
export const TOWN_EXIT_ZOOM_MS = 1_000;

export const TOWN_FIELD_MENU_FADE_OUT_MS = 500;
export const TOWN_FIELD_FLAGS_FADE_OUT_MS = 500;

export const TOWN_FIELD_RESTORE_FADE_MS = 500;


export function townHouseSpriteScale(_mode: DisplayMode): number {
  return 1 / 3;
}


export function townLabelFontSize(mode: DisplayMode): number {
  return idiomPairPt(13, 16, mode);
}


export function townBuildingIconOffsetY(mode: DisplayMode): number {
  return idiomPairPt(15, 30, mode);
}


export const TOWN_EXIT_SPRITE_SCALE = 1 / 4;

/** Implemented source destinations. Unknown/unported building classes remain visibly inert. */
export function townBuildingEnabled(className: string | undefined): boolean {
  return className === "MonsterManagementMenuItem" ||
    className === "MonsterpediaMenuItem" ||
    className === "TavernMenuItem" ||
    className === "CharacterDisplayMenuItem" ||
    className === "StoreMenuItem" ||
    className === "TownWarpMenuItem" ||
    className === "BlackMarketMenuItem" ||
    className === "ArenaMenuItem";
}

export function townCounterScale(zoom: number): number {
  if (!(zoom > 0) || !Number.isFinite(zoom)) throw new Error(`invalid town zoom: ${zoom}`);
  return 1 / zoom;
}

/** Native label position is `(houseWidth/2, houseHeight/3)` in a centered CCSprite. Converted to
 * a centered Pixi sibling, that is one-sixth of the already-scaled house height below center. */
export function townBuildingLabelOffsetY(houseRenderedHeight: number): number {
  if (!(houseRenderedHeight >= 0) || !Number.isFinite(houseRenderedHeight)) {
    throw new Error(`invalid town house height: ${houseRenderedHeight}`);
  }
  return houseRenderedHeight / 6;
}

export interface TownPoint {
  readonly x: number;
  readonly y: number;
}

/** Town building/exit offsets are source-authored Cocos coordinates (+y up). TownPOINode
 * multiplies them by the global idiom scale (1 phone / 2 iPad); normalized iPad mode divides by
 * two again, leaving the authored numeric value unchanged before the Pixi Y flip. */
export function townRelativePointToPixi(point: TownPoint, mode: DisplayMode): TownPoint {
  return {
    x: idiomPairPt(point.x, point.x * 2, mode),
    y: -idiomPairPt(point.y, point.y * 2, mode),
  };
}

/** Retained-map target used by `TownPOINode.performVisitLogic`: clamp the scene-space focus
 * (including the normal-iPad inset or phone underworld indent) so the zoomed viewport cannot expose
 * outside the world rectangle, then express that focus as a map-local pivot at screen center. */
export function townMapZoomTarget(
  screen: { readonly w: number; readonly h: number },
  focus: TownPoint,
  zoom: number,
  mapPosition: TownPoint = { x: 0, y: 0 },
): {
  readonly pivot: TownPoint;
  readonly position: TownPoint;
  readonly scale: number;
} {
  if (!(screen.w > 0) || !(screen.h > 0) || !Number.isFinite(screen.w) || !Number.isFinite(screen.h)) {
    throw new Error(`invalid town screen: ${screen.w}x${screen.h}`);
  }
  if (!Number.isFinite(focus.x) || !Number.isFinite(focus.y)) {
    throw new Error(`invalid town focus: ${focus.x},${focus.y}`);
  }
  if (!Number.isFinite(mapPosition.x) || !Number.isFinite(mapPosition.y)) {
    throw new Error(`invalid town map position: ${mapPosition.x},${mapPosition.y}`);
  }
  if (!(zoom > 1) || !Number.isFinite(zoom)) throw new Error(`invalid town zoom: ${zoom}`);
  const halfVisible = { x: screen.w / (2 * zoom), y: screen.h / (2 * zoom) };
  const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(maximum, Math.max(minimum, value));
  const sceneFocus = {
    x: focus.x + mapPosition.x,
    y: focus.y + mapPosition.y,
  };
  return {
    pivot: {
      x: clamp(sceneFocus.x, halfVisible.x, screen.w - halfVisible.x) - mapPosition.x,
      y: clamp(sceneFocus.y, halfVisible.y, screen.h - halfVisible.y) - mapPosition.y,
    },
    position: { x: screen.w / 2, y: screen.h / 2 },
    scale: zoom,
  };
}

/** Whole-WorldNode target used by `TownPOINode.performVisitLogic`. Native runs `CCScaleTo(z)` and
 * `CCMoveTo((W/2-z*C.x, H/2-z*C.y))` concurrently on the retained WorldNode, whose anchor/pivot
 * remains zero. Encoding the same final matrix as `pivot=C, position=screen/2` is NOT equivalent
 * during the five-second tween because Pixi would interpolate the pivot as a third action. */
export function townWorldZoomTarget(
  screen: { readonly w: number; readonly h: number },
  focus: TownPoint,
  zoom: number,
  mapPosition: TownPoint = { x: 0, y: 0 },
): {
  readonly pivot: TownPoint;
  readonly position: TownPoint;
  readonly scale: number;
} {
  const local = townMapZoomTarget(screen, focus, zoom, mapPosition);
  const sceneFocus = {
    x: local.pivot.x + mapPosition.x,
    y: local.pivot.y + mapPosition.y,
  };
  return {
    pivot: { x: 0, y: 0 },
    position: {
      x: screen.w / 2 - zoom * sceneFocus.x,
      y: screen.h / 2 - zoom * sceneFocus.y,
    },
    scale: local.scale,
  };
}

/** `TownPOINode.performVisitLogic`: a distinct town menu is attached to the POI at
 * `(-winW/(2z), +winH/(2z)) + menuButtonOffset`, then counter-scaled by `1/z`. Convert Cocos Y-up
 * to Pixi Y-down here; unlike the normal world menu this has no iPad viewport inset. */
export function townMenuLocalPosition(
  screen: { readonly w: number; readonly h: number },
  mode: DisplayMode,
  zoom: number,
  sourceOffset?: TownPoint,
): TownPoint {
  if (!(zoom > 1) || !Number.isFinite(zoom)) throw new Error(`invalid town zoom: ${zoom}`);
  const offset = sourceOffset === undefined
    ? { x: 0, y: 0 }
    : {
        x: unscaledIdiomPt(sourceOffset.x, mode),
        y: -unscaledIdiomPt(sourceOffset.y, mode),
      };
  return {
    x: -screen.w / (2 * zoom) + offset.x,
    y: -screen.h / (2 * zoom) + offset.y,
  };
}
