import { describe, expect, it } from "vitest";
import type { CollectionGoalDefinition } from "@dib/gamedata";
import {
  collectionClaimId,
  collectionGoalProgress,
} from "../src/index.js";

function goal(key: string, monsterTypes: readonly string[]): CollectionGoalDefinition {
  return {
    collectionType: "Base",
    key,
    monsterTypes,
    treasureData: Object.freeze({
      defaultSpawnChance: 1,
      levelScalor: 1,
      items: Object.freeze([]),
    }),
  };
}

describe("Collection goal progress", () => {
  it("uses the native durable property identity and reports whether that exact ID is claimed", () => {
    const definition = goal("UsualSuspects", ["Spikey"]);

    expect(collectionClaimId(definition)).toBe("CollectionQuestUsualSuspects");
    expect(collectionGoalProgress(
      definition,
      () => 5,
      new Set(["CollectionQuestUsualSuspects"]),
    )).toEqual({
      goalId: "CollectionQuestUsualSuspects",
      owned: 1,
      total: 1,
      percentComplete: 100,
      complete: true,
      claimed: true,
    });
  });

  it("returns the native 100/0 endpoints for empty, full, and wholly missing goals", () => {
    const emptyQueries: string[] = [];
    expect(collectionGoalProgress(
      goal("Empty", []),
      (shortType) => { emptyQueries.push(shortType); return 0; },
      new Set(),
    )).toMatchObject({ owned: 0, total: 0, percentComplete: 100, complete: true });
    expect(emptyQueries).toEqual([]);

    expect(collectionGoalProgress(goal("Full", ["Spikey", "Teddy"]), () => 1, new Set()))
      .toMatchObject({ owned: 2, total: 2, percentComplete: 100, complete: true });
    expect(collectionGoalProgress(goal("Missing", ["Spikey", "Teddy"]), () => 0, new Set()))
      .toMatchObject({ owned: 0, total: 2, percentComplete: 0, complete: false });
  });

  it("counts duplicate authored occurrences and queries each one in authored order", () => {
    const queries: string[] = [];
    const progress = collectionGoalProgress(
      goal("Duplicates", ["Spikey", "Spikey", "Teddy"]),
      (shortType) => {
        queries.push(shortType);
        return shortType === "Spikey" ? 4 : 0;
      },
      new Set(),
    );

    expect(queries).toEqual(["Spikey", "Spikey", "Teddy"]);
    expect(progress).toMatchObject({
      owned: 2,
      total: 3,
      percentComplete: 67,
      complete: false,
    });
  });

  it("preserves the source float32 partial rounding schedule", () => {
    const monsterTypes = Array.from({ length: 40 }, (_, index) => `Monster${index}`);
    const progress = collectionGoalProgress(
      goal("Float32Boundary", monsterTypes),
      (shortType) => Number(shortType.slice("Monster".length)) < 21 ? 1 : 0,
      new Set(),
    );

    // 21 / 40 narrows to 52.499996f before roundf, so the native result is 52, not 53.
    expect(progress.percentComplete).toBe(52);
  });

  it.each([
    [1, 1],
    [200, 99],
  ])("clamps the partial %i-of-201 endpoint to %i percent", (owned, expected) => {
    const monsterTypes = Array.from({ length: 201 }, (_, index) => `Monster${index}`);
    const progress = collectionGoalProgress(
      goal("PartialClamp", monsterTypes),
      (shortType) => Number(shortType.slice("Monster".length)) < owned ? 1 : 0,
      new Set(),
    );

    expect(progress.percentComplete).toBe(expected);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid durable highest-captured level %s",
    (invalidLevel) => {
      expect(() => collectionGoalProgress(
        goal("Invalid", ["Spikey"]),
        () => invalidLevel,
        new Set(),
      )).toThrow(/invalid highest captured level.*Spikey/);
    },
  );
});
