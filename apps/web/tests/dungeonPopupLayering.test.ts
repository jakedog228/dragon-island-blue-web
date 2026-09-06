import { describe, expect, it } from "vitest";
import {
  DUNGEON_LAYER_Z,
  DUNGEON_POPUP_ROOT_Z_INDEX,
} from "../src/dungeon/dungeonDisplayMath.js";
import { WORLD_NOTIFICATION_Z_INDEX } from "../src/world/worldDisplayMath.js";


describe("dungeon scene layering", () => {
  it("keeps the dungeon popup root below the director notification layer", () => {
    expect(DUNGEON_POPUP_ROOT_Z_INDEX).toBeLessThan(WORLD_NOTIFICATION_Z_INDEX);
  });

  it("still keeps the dungeon popup root above the dungeon scene content", () => {
    expect(DUNGEON_POPUP_ROOT_Z_INDEX).toBeGreaterThan(DUNGEON_LAYER_Z.world);
    expect(DUNGEON_POPUP_ROOT_Z_INDEX).toBeGreaterThan(DUNGEON_LAYER_Z.chrome);
  });
});
