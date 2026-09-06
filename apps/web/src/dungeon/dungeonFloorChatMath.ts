import type { DisplayMode } from "../displayMode.js";
import {
  idiomPairPt,
  screenPointsForMode,
} from "../displayMode.js";

export type DungeonFloorDetectionChatKey =
  | "DungeonWaypointDetected"
  | "DungeonBreederDetected"
  | "DungeonBreederAndWaypointDetected";

export interface DungeonFloorChatLayout {
  readonly size: { readonly w: number; readonly h: number };
  readonly position: { readonly x: number; readonly y: number };
  readonly fontSize: number;
}

/** Shipped `Dialogs.json.Chat`, with the Cocos Y-up offset converted into Pixi Y-down. */
export function dungeonFloorChatLayout(mode: DisplayMode): DungeonFloorChatLayout {
  const screen = screenPointsForMode(mode);
  const sourceY = idiomPairPt(60, 120, mode);
  return Object.freeze({
    size: Object.freeze({
      w: idiomPairPt(440, 942, mode),
      h: idiomPairPt(80, 160, mode),
    }),
    position: Object.freeze({
      x: idiomPairPt(240, 512, mode),
      y: screen.h - sourceY,
    }),
    fontSize: idiomPairPt(18, 36, mode),
  });
}

export function dungeonFloorDetectionChatKey(
  hasBreeder: boolean,
  hasWaypoint: boolean,
): DungeonFloorDetectionChatKey | undefined {
  if (hasBreeder && hasWaypoint) return "DungeonBreederAndWaypointDetected";
  if (hasBreeder) return "DungeonBreederDetected";
  if (hasWaypoint) return "DungeonWaypointDetected";
  return undefined;
}
