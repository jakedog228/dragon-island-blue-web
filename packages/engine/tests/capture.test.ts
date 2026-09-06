import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import {
  BattleSession,
  CAPTURE_CARD_COSTS,
  captureChance,
  captureChancePercent,
  type Rng,
} from "../src/index.js";

const gd = loadGameData();

function constantRng(value: number): Rng {
  return {
    next: () => value,
    intBelow: (n) => Math.floor(value * n),
    chance: (p) => value < p,
  };
}

describe("source capture math", () => {
  it("pins binary-derived costs and representative float32 formula vectors", () => {
    expect(CAPTURE_CARD_COSTS).toEqual({
      1: { currency: "silver", amount: 50 },
      2: { currency: "silver", amount: 250 },
      3: { currency: "gold", amount: 100 },
    });
    expect(captureChance(1, 5, 5, 4, 1)).toBe(0.09473228454589844);
    expect(captureChancePercent(captureChance(1, 10, 5, 4, 0.25))).toBe(54);
    expect(captureChance(2, 10, 8, 7, 0.5)).toBe(0.15482808649539948);
    expect(captureChance(3, 5, 20, 20, 0.1)).toBe(1);
  });

  it("preserves the special level-1..3 health divisor and clamps to zero/one", () => {
    expect(captureChance(1, 1, 1, 2, 1)).toBe(0.75);
    expect(captureChance(1, 1, 50, 20, 1)).toBe(0);
    expect(captureChance(3, 10, 10, 0, 0.5)).toBe(1);
  });
});

describe("capture battle mechanics", () => {
  function session(rngValue: number, capturable = true, reserve = false): BattleSession {
    return new BattleSession(
      gd,
      [
        [{ shortType: "FireCub", level: 5 }],
        [
          { shortType: "SnowCub", level: 5, capturable },
          ...(reserve ? [{ shortType: "Minotaur", level: 5 }] : []),
        ],
      ],
      constantRng(rngValue),
      { fightingGroupSize: 1 },
    );
  }

  it("fails once, emits the exact result payload, and marks the monster already-tried", () => {
    const s = session(0.5);
    expect(s.advance().type).toBe("awaitingPlayer");
    expect(s.captureStatusOf("t1m0:SnowCub")).toBe("available");
    const chance = s.captureChanceOf("t1m0:SnowCub", 1, 5);
    const events = s.submitCaptureAction("t1m0:SnowCub", 1, 5);
    expect(events).toContainEqual({
      type: "captureResolved",
      source: "t0m0:FireCub",
      target: "t1m0:SnowCub",
      cardLevel: 1,
      chance,
      success: false,
    });
    expect(s.captureStatusOf("t1m0:SnowCub")).toBe("alreadyTried");
    expect(s.capturedIds()).toEqual([]);
  });

  it("captures, removes from the active queue, and promotes a reserve", () => {
    const s = session(0, true, true);
    expect(s.advance().type).toBe("awaitingPlayer");
    const events = s.submitCaptureAction("t1m0:SnowCub", 3, 5);
    expect(events).toContainEqual({
      type: "captured",
      living: "t1m0:SnowCub",
      source: "t0m0:FireCub",
      cardLevel: 3,
    });
    expect(events.some((event) => event.type === "died")).toBe(false);
    expect(s.capturedIds()).toEqual(["t1m0:SnowCub"]);
    expect(s.activeIdsOf(1)).toEqual(["t1m1:Minotaur"]);
    expect(s.queueOrder()).not.toContain("t1m0:SnowCub");
  });

  it("honors per-instance and battle-wide uncapturable states", () => {
    const perMonster = session(0, false);
    expect(perMonster.captureStatusOf("t1m0:SnowCub")).toBe("uncapturable");

    const blocked = new BattleSession(
      gd,
      [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
      constantRng(0),
      { fightingGroupSize: 1, blockCapture: true },
    );
    expect(blocked.captureStatusOf("t1m0:SnowCub")).toBe("uncapturable");
  });
});
