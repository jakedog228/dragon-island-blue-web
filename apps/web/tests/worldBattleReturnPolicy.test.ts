import { describe, expect, it } from "vitest";
import { worldBattleReturnsToOriginTown } from "../src/world/worldBattleReturnPolicy.js";

describe("world battle return policy", () => {
  it.each(["victory", "retreat", "saveMe"] as const)(
    "auto-enters a town after %s at that town's encounter",
    (outcome) => {
      expect(worldBattleReturnsToOriginTown(outcome, true)).toBe(true);
    },
  );

  it.each(["victory", "retreat", "saveMe"] as const)(
    "keeps an ordinary field return on the map after %s",
    (outcome) => {
      expect(worldBattleReturnsToOriginTown(outcome, false)).toBe(false);
    },
  );
});
