import { describe, expect, it } from "vitest";
import { LocalRewardCheckpoint } from "../src/player/localRewardCheckpoint.js";

describe("Offline modal reward durability", () => {
  it("reloads an unclaimed quest throughout loot and Egg presentation, then commits claim and prize together", () => {
    const boundary = new LocalRewardCheckpoint<{ claimed: boolean; items: string[]; gold: number }>();
    const live = { claimed: false, items: [] as string[], gold: 100 };
    const before = structuredClone(live);
    const finish = boundary.begin(live);
    live.claimed = true;
    expect(boundary.snapshot(() => live)).toEqual(before);
    live.items.push("first reward");
    live.gold -= 50; // A paid repeat inside the still-pending Egg is part of the same boundary.
    expect(boundary.snapshot(() => live)).toEqual(before);
    live.items.push("egg prize");
    finish();
    expect(boundary.snapshot(() => live)).toEqual({ claimed: true, items: ["first reward", "egg prize"], gold: 50 });
  });

  it("keeps the recovery snapshot isolated and does not release a later claim from an old callback", () => {
    const boundary = new LocalRewardCheckpoint<{ items: string[] }>();
    const live = { items: ["earned"] };
    const first = boundary.begin(live);
    boundary.snapshot(() => live).items.length = 0;
    live.items.push("partial");
    expect(boundary.snapshot(() => live).items).toEqual(["earned"]);
    expect(() => boundary.begin(live)).toThrow("already pending");
    first();
    const second = boundary.begin(live);
    live.items.push("later partial");
    first();
    expect(boundary.snapshot(() => live).items).toEqual(["earned", "partial"]);
    second();
    expect(boundary.snapshot(() => live).items).toHaveLength(3);
  });
});
