import { describe, expect, it } from "vitest";
import {
  dungeonFloorChatLayout,
  dungeonFloorDetectionChatKey,
} from "../src/dungeon/dungeonFloorChatMath.js";

describe("dungeon floor-content chat", () => {
  it("normalizes the source-native iPhone/iPad geometry", () => {
    expect(dungeonFloorChatLayout("iphone")).toEqual({
      size: { w: 440, h: 80 },
      position: { x: 240, y: 260 },
      fontSize: 18,
    });
    expect(dungeonFloorChatLayout("ipad")).toEqual({
      size: { w: 471, h: 80 },
      position: { x: 256, y: 324 },
      fontSize: 18,
    });
  });

  it("uses the combined source chat when both special room families are present", () => {
    expect(dungeonFloorDetectionChatKey(false, false)).toBeUndefined();
    expect(dungeonFloorDetectionChatKey(false, true)).toBe("DungeonWaypointDetected");
    expect(dungeonFloorDetectionChatKey(true, false)).toBe("DungeonBreederDetected");
    expect(dungeonFloorDetectionChatKey(true, true)).toBe("DungeonBreederAndWaypointDetected");
  });
});
