import { describe, it, expect } from "vitest";
import type { Rng } from "../src/rng.js";
import { AbilityPhaseScheduler, initialBattleDelay, abilityTimeCost, TimedQueue } from "../src/scheduler.js";

/** Stub Rng that returns a fixed sequence from next(), used to script the single
 *  arc4random-equivalent draw in initialBattleDelay deterministically. Mirrors
 *  damage.test.ts's stubRng. */
function stubRng(values: number[]): Rng {
  let i = 0;
  return {
    next: () => {
      if (i >= values.length) throw new Error("stubRng exhausted");
      const v = values[i];
      i++;
      return v as number;
    },
    intBelow: () => {
      throw new Error("not used by initialBattleDelay");
    },
    chance: () => {
      throw new Error("not used by initialBattleDelay");
    },
  };
}

describe("initialBattleDelay", () => {

  it("speed=300, U=0 -> 50", () => {
    expect(initialBattleDelay(300, stubRng([0]))).toBe(50);
  });

  it("speed=300, U=1 -> 60", () => {
    expect(initialBattleDelay(300, stubRng([1]))).toBe(60);
  });

  it("speed=0, U=0 -> 100", () => {
    expect(initialBattleDelay(0, stubRng([0]))).toBe(100);
  });

  it("draws exactly once from rng per call", () => {
    let draws = 0;
    const rng: Rng = {
      next: () => {
        draws++;
        return 0.5;
      },
      intBelow: () => {
        throw new Error("unused");
      },
      chance: () => {
        throw new Error("unused");
      },
    };
    initialBattleDelay(150, rng);
    expect(draws).toBe(1);
  });
});

describe("abilityTimeCost", () => {


  it("(400, 0, false) -> 400", () => {
    expect(abilityTimeCost(400, 0, false)).toBe(400);
  });

  it("(400, 0, true) -> 400 (noHaste bypasses applyMod entirely)", () => {
    expect(abilityTimeCost(400, 0, true)).toBe(400);
  });

  it("(400, 0.5, false) -> 600 (positive haste lengthens the wait)", () => {
    expect(abilityTimeCost(400, 0.5, false)).toBe(600);
  });

  it("(400, -0.5, false) -> 266 (negative haste shortens the wait, trunc toward zero)", () => {
    expect(abilityTimeCost(400, -0.5, false)).toBe(266);
  });
});

describe("AbilityPhaseScheduler", () => {
  it("advances [0.25, 0.25, 0.75] by 0.5, dispatches only phase 0, then dispatches phase 1 at zero time", () => {
    const scheduler = new AbilityPhaseScheduler([0.25, 0.25, 0.75]);


    expect(scheduler.advance(0.5)).toBe(0);
    expect(scheduler.snapshot()).toEqual({
      countdowns: [-0.25, -0.25, 0.25],
      completed: [true, false, false],
    });

    // Zero-time continuation skips completed phase 0 and selects equal-overdue phase 1.
    expect(scheduler.advance(0)).toBe(1);
    expect(scheduler.snapshot()).toEqual({
      countdowns: [-0.25, -0.25, 0.25],
      completed: [true, true, false],
    });
  });
});

describe("TimedQueue", () => {
  it("hand-traced 6-turn schedule for a 3-actor queue matches the exact expected sequence", () => {
    const q = new TimedQueue<string>();
    q.setTime("A", 3);
    q.setTime("B", 1);
    q.setTime("C", 2);

    const trace: Array<[string, number]> = [];
    for (let i = 0; i < 6; i++) {
      const d = q.advanceTimeToNext();
      const who = q.front() as string;
      trace.push([who, d]);
      q.addTime(who, 5);
    }

    expect(trace).toEqual([
      ["B", 1],
      ["C", 1],
      ["A", 1],
      ["B", 3],
      ["C", 1],
      ["A", 1],
    ]);
  });

  it("tie-break: equal times keep stable FIFO order; a later reposition to the same time goes behind existing ties", () => {
    const q = new TimedQueue<string>();
    q.setTime("X", 5);
    q.setTime("Y", 5);
    expect(q.order()).toEqual(["X", "Y"]);
    expect(q.front()).toBe("X");

    q.setTime("Z", 5);
    expect(q.order()).toEqual(["X", "Y", "Z"]);

    q.addTime("X", 3); // X: 5 -> 8
    expect(q.order()).toEqual(["Y", "Z", "X"]);
  });

  it("setTime repositions an already-queued item rather than duplicating it", () => {
    const q = new TimedQueue<string>();
    q.setTime("A", 10);
    q.setTime("B", 20);
    q.setTime("A", 5); // reposition, not insert
    expect(q.order()).toEqual(["A", "B"]);
    expect(q.items().length).toBe(2);
    expect(q.timeForItem("A")).toBe(5);
  });

  it("setTime rejects non-integer times", () => {
    const q = new TimedQueue<string>();
    expect(() => q.setTime("A", 1.5)).toThrow();
  });

  it("remove drops an item from the queue and is a no-op if the item isn't queued", () => {
    const q = new TimedQueue<string>();
    q.setTime("A", 1);
    q.setTime("B", 2);
    q.remove("A");
    expect(q.order()).toEqual(["B"]);
    expect(q.has("A")).toBe(false);
    expect(() => q.remove("A")).not.toThrow(); // no-op, already absent
    expect(q.order()).toEqual(["B"]);
  });

  it("moveToFront forces an item to the head at the current timeAtFront baseline", () => {
    const q = new TimedQueue<string>();
    q.setTime("A", 1);
    q.setTime("B", 2);
    q.setTime("C", 3);
    q.advanceTimeToNext(); // timeAtFront becomes 1 (A's time)

    q.moveToFront("C");
    expect(q.front()).toBe("C");
    expect(q.timeForItem("C")).toBe(q.timeAtFront());
    expect(q.order()).toEqual(["C", "A", "B"]);
  });

  it("moveToFront throws for an item not in the queue", () => {
    const q = new TimedQueue<string>();
    q.setTime("A", 1);
    expect(() => q.moveToFront("Z")).toThrow();
  });

  it("addTime throws for an item not in the queue", () => {
    const q = new TimedQueue<string>();
    q.setTime("A", 1);
    expect(() => q.addTime("Z", 5)).toThrow();
  });

  it("timeForItem throws for an item not in the queue", () => {
    const q = new TimedQueue<string>();
    expect(() => q.timeForItem("Z")).toThrow();
  });

  it("front() and has() behave correctly on an empty queue", () => {
    const q = new TimedQueue<string>();
    expect(q.front()).toBeUndefined();
    expect(q.has("A")).toBe(false);
    expect(q.order()).toEqual([]);
    expect(q.items()).toEqual([]);
    expect(q.timeAtFront()).toBe(0);
  });

  it("advanceTimeToNext throws (fails loudly) on an empty queue rather than returning a meaningless delta", () => {
    const q = new TimedQueue<string>();
    expect(() => q.advanceTimeToNext()).toThrow();
  });

  it("addTime repositions relative to the item's own current stored time, not timeAtFront", () => {
    const q = new TimedQueue<string>();
    q.setTime("A", 1);
    q.setTime("B", 100);
    q.advanceTimeToNext(); // timeAtFront becomes 1
    q.addTime("A", 5); // A: 1 -> 6, NOT timeAtFront(1) + 5 == 6 (coincidentally equal here)
    expect(q.timeForItem("A")).toBe(6);

    // Disambiguate from a timeAtFront-relative interpretation with a second step.
    q.advanceTimeToNext(); // timeAtFront becomes 6 (A is front)
    q.addTime("B", 5); // B currently at 100 -> 105, NOT timeAtFront(6)+5==11
    expect(q.timeForItem("B")).toBe(105);
  });
});
