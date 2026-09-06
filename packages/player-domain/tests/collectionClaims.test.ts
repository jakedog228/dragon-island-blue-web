import { describe, expect, it } from "vitest";
import { CollectionClaims } from "../src/index.js";

describe("CollectionClaims", () => {
  it("tracks a claim once and rejects a repeated claim", () => {
    const claims = new CollectionClaims();

    expect(claims.has("CollectionQuestCollector")).toBe(false);
    claims.claim("CollectionQuestCollector");
    expect(claims.has("CollectionQuestCollector")).toBe(true);
    expect(() => claims.claim("CollectionQuestCollector")).toThrow(/already claimed/);
    expect(claims.snapshot()).toEqual(["CollectionQuestCollector"]);
  });

  it("normalizes restored IDs into a sorted frozen snapshot without changing membership", () => {
    const claims = new CollectionClaims([
      "CollectionQuestUsualSuspects",
      "CollectionQuestCollector",
      "CollectionQuestEggxactly",
    ]);

    const snapshot = claims.snapshot();
    expect(snapshot).toEqual([
      "CollectionQuestCollector",
      "CollectionQuestEggxactly",
      "CollectionQuestUsualSuspects",
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(claims.has("CollectionQuestUsualSuspects")).toBe(true);
  });

  it.each([
    [[""], /non-empty string/],
    [["CollectionQuestCollector", "CollectionQuestCollector"], /duplicate.*CollectionQuestCollector/],
    [[42] as unknown as string[], /non-empty string/],
  ])("rejects malformed restored claim IDs %j", (ids, message) => {
    expect(() => new CollectionClaims(ids)).toThrow(message);
  });

  it("rejects an empty ID at the mutation boundary without changing the snapshot", () => {
    const claims = new CollectionClaims(["CollectionQuestCollector"]);

    expect(() => claims.claim("")).toThrow(/non-empty string/);
    expect(claims.snapshot()).toEqual(["CollectionQuestCollector"]);
  });
});
