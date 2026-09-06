import { describe, expect, it } from "vitest";
import type { DungeonRouteDescriptor } from "@dib/engine/dungeon-runtime";
import {
  dungeonWaypointLayout,
  nextWaypointIndex,
  waypointFloorOptions,
} from "../src/dungeon/dungeonWaypointMath.js";

function route(
  floor: number,
  typeName = "Cave",
  sourceFile = "Dungeon_Cave",
): DungeonRouteDescriptor {
  return { floor, typeName, sourceFile };
}

describe("dungeon waypoint source math", () => {
  it("normalizes every recovered iPhone/iPad layout constant explicitly", () => {
    expect(dungeonWaypointLayout("iphone")).toEqual({
      labelFontSize: 16,
      goFontSize: 14,
      incrementerGap: 20,
      arrowGap: 30,
      controlGap: 30,
      outerGap: 5,
      contentHeightExtension: 10,
      textMinimumWidth: 300,
    });
    expect(dungeonWaypointLayout("ipad")).toEqual({
      labelFontSize: 16,
      goFontSize: 12,
      incrementerGap: 20,
      arrowGap: 15,
      controlGap: 30,
      outerGap: 2.5,
      contentHeightExtension: 10,
      textMinimumWidth: 300,
    });
  });

  it("sorts current-dungeon floors, includes the current floor, and rejects foreign/future routes", () => {
    const current = route(5);
    expect(waypointFloorOptions(current, [
      route(5),
      route(1),
      route(7),
      route(3),
      route(2, "Forest", "Dungeon_Forest"),
      route(2, "Cave", "Dungeon_CaveB"),
    ], 5)).toEqual([
      route(1),
      route(3),
      route(5),
    ]);
  });

  it("moves one option per released arrow and clamps gray endpoints", () => {
    expect(nextWaypointIndex(1, 3, "up")).toBe(2);
    expect(nextWaypointIndex(2, 3, "up")).toBe(2);
    expect(nextWaypointIndex(1, 3, "down")).toBe(0);
    expect(nextWaypointIndex(0, 3, "down")).toBe(0);
  });
});
