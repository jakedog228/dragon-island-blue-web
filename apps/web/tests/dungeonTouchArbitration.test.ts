import { describe, expect, it } from "vitest";
import {
  dungeonSameRoomInteraction,
  dungeonTouchRequiresRoomSelection,
} from "../src/dungeon/dungeonTouchArbitration.js";

describe("RoomNode same-room touch arbitration", () => {
  it("prioritizes the first hit zone, then waypoint, then the encounter fallback", () => {
    expect(dungeonSameRoomInteraction(
      ["stairs", "exit"],
      new Set(["stairs", "exit"]),
      true,
      "encounter",
    )).toEqual({ kind: "zone", zoneId: "stairs" });
    expect(dungeonSameRoomInteraction(["stairs"], new Set(), true, "encounter"))
      .toEqual({ kind: "waypoint" });
    expect(dungeonSameRoomInteraction(["stairs"], new Set(), false, "encounter"))
      .toEqual({ kind: "encounter", encounterId: "encounter" });
  });

  it("does nothing outside local presentations when no encounter remains", () => {
    expect(dungeonSameRoomInteraction(["stairs"], new Set(), false)).toEqual({ kind: "none" });
  });

  it("submits room selection only when the touched room differs from the current room", () => {
    expect(dungeonTouchRequiresRoomSelection("room-a", "room-a")).toBe(false);
    expect(dungeonTouchRequiresRoomSelection("room-b", "room-a")).toBe(true);
  });
});
