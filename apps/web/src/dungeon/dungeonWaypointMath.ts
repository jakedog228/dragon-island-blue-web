import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, unscaledIdiomPt } from "../displayMode.js";
import type { DungeonRouteDescriptor } from "@dib/engine/dungeon-runtime";

export interface DungeonWaypointLayout {
  readonly labelFontSize: number;
  readonly goFontSize: number;
  readonly incrementerGap: number;
  readonly arrowGap: number;
  readonly controlGap: number;
  readonly outerGap: number;
  readonly contentHeightExtension: number;
  readonly textMinimumWidth: number;
}


export function dungeonWaypointLayout(mode: DisplayMode): DungeonWaypointLayout {
  return Object.freeze({
    labelFontSize: idiomPairPt(16, 32, mode),
    // Source's adjacent ButtonLabel is the asymmetric 14/24 pair, not MonsterHatchPopup's 14/28.
    goFontSize: idiomPairPt(14, 24, mode),
    incrementerGap: idiomPairPt(20, 40, mode),
    arrowGap: unscaledIdiomPt(30, mode),
    controlGap: idiomPairPt(30, 60, mode),
    outerGap: unscaledIdiomPt(5, mode),
    contentHeightExtension: idiomPairPt(10, 20, mode),
    textMinimumWidth: idiomPairPt(300, 600, mode),
  });
}

/** Numeric `options:` are saved floors for the current dungeon only, sorted by `compare:`. */
export function waypointFloorOptions(
  current: DungeonRouteDescriptor,
  destinations: readonly DungeonRouteDescriptor[],
  lastFloor: number,
): readonly DungeonRouteDescriptor[] {
  return Object.freeze(destinations
    .filter((route) =>
      route.typeName === current.typeName &&
      route.sourceFile === current.sourceFile &&
      route.floor <= lastFloor)
    .sort((left, right) => left.floor - right.floor));
}

/** `ccTouchEnded:` clamps at either endpoint but still calls `setCurrentIndex:`. */
export function nextWaypointIndex(
  currentIndex: number,
  optionCount: number,
  releasedArrow: "up" | "down",
): number {
  if (!Number.isSafeInteger(optionCount) || optionCount <= 0) {
    throw new Error(`Waypoint incrementer option count must be positive; got ${optionCount}`);
  }
  if (!Number.isSafeInteger(currentIndex) || currentIndex < 0 || currentIndex >= optionCount) {
    throw new Error(`Waypoint incrementer index ${currentIndex} is outside ${optionCount} options`);
  }
  return releasedArrow === "up"
    ? Math.min(currentIndex + 1, optionCount - 1)
    : Math.max(currentIndex - 1, 0);
}
