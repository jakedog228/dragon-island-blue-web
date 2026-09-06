import { describe, it, expect } from "vitest";
import { mulberry32 } from "../src/rng.js";
import type { Rng } from "../src/rng.js";
import { rollDamage, applyMagnification, applyDamage } from "../src/damage.js";
import type { RollParams, HitParams } from "../src/damage.js";

/** Stub Rng that returns a fixed sequence from next(), used to script the DiceRoller's
 *  single arc4random-equivalent draw deterministically. */
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
      throw new Error("not used by rollDamage");
    },
    chance: () => {
      throw new Error("not used by rollDamage");
    },
  };
}

function baseParams(overrides: Partial<RollParams> = {}): RollParams {
  return {
    abilityScalor: 1.0,
    stat: 50,
    activationLength: 0,
    scaleByActivationLength: false,
    randomness: 0.2,
    numTargets: 1,
    ...overrides,
  };
}

describe("rollDamage", () => {


  it("returns the min of the roll window when u=0 (exactly one rng draw)", () => {
    const rng = stubRng([0]);
    expect(rollDamage(baseParams(), rng)).toBe(45);
  });

  it("returns the midpoint when u=0.5", () => {
    const rng = stubRng([0.5]);
    expect(rollDamage(baseParams(), rng)).toBe(50);
  });

  it("returns the max of the roll window when u is close to 1", () => {
    const rng = stubRng([0.999999]);
    expect(rollDamage(baseParams(), rng)).toBe(55);
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
    rollDamage(baseParams(), rng);
    expect(draws).toBe(1);
  });

  it("clamps to a minimum of 1 when stat/scalor produce a near-zero base", () => {
    const rng = stubRng([0]);
    expect(rollDamage(baseParams({ stat: 0 }), rng)).toBe(1);
  });

  it("applies the multi-target divisor (value / (numTargets * 0.84)) when numTargets >= 2", () => {
    // stat=50, numTargets=3: value = 50/(3*0.84) = 50/2.52 = 19.8412... -> base=round=20
    // min=20*0.9=18, max=20*1.1=22
    const rngMin = stubRng([0]);
    const rngMax = stubRng([0.999999]);
    expect(rollDamage(baseParams({ numTargets: 3 }), rngMin)).toBe(18);
    expect(rollDamage(baseParams({ numTargets: 3 }), rngMax)).toBe(22);
  });

  it("applies non-degenerate activationLength scaling via powf(activationLength*0.01, 0.86)", () => {


    const params = () => baseParams({ scaleByActivationLength: true, activationLength: 400 });
    expect(rollDamage(params(), stubRng([0]))).toBe(149);
    expect(rollDamage(params(), stubRng([0.5]))).toBe(165);
    expect(rollDamage(params(), stubRng([0.999999]))).toBe(181);
  });

  it("stays within [min,max] and hits both endpoints over 10k mulberry32 draws", () => {
    const rng = mulberry32(42);
    const params = baseParams();
    let minSeen = Infinity;
    let maxSeen = -Infinity;
    for (let i = 0; i < 10_000; i++) {
      const v = rollDamage(params, rng);
      minSeen = Math.min(minSeen, v);
      maxSeen = Math.max(maxSeen, v);
      expect(v).toBeGreaterThanOrEqual(45);
      expect(v).toBeLessThanOrEqual(55);
    }
    expect(minSeen).toBe(45);
    expect(maxSeen).toBe(55);
  });
});

describe("applyMagnification", () => {

  it("returns the roll unchanged when magnification is 0", () => {
    expect(applyMagnification(50, 0)).toBe(50);
  });

  it("scales up for positive magnification: (1+mag)*roll, truncated", () => {
    expect(applyMagnification(50, 0.5)).toBe(75);
  });

  it("scales down for negative magnification: roll/(1-mag), truncated", () => {
    expect(applyMagnification(50, -0.5)).toBe(33); // trunc(50/1.5) = trunc(33.333) = 33
  });

  it("drops the whole hit (returns 0) if the truncated result is < 1", () => {
    expect(applyMagnification(0, 0)).toBe(0);
    expect(applyMagnification(1, -0.9999)).toBe(0);
  });
});

describe("applyDamage", () => {
  function baseHit(overrides: Partial<HitParams> = {}): HitParams {
    return {
      amount: 100,
      // Fire -> Death is a neutral matchup (weaknessOf(Death)=Life != Fire;
      // weaknessOf(Fire)=Water != Death) - keeps the elemental step a no-op so these
      // defaults isolate whichever math a given test cares about.
      damageElement: "Fire",
      sourceStat: "Attack",
      defenderElement: "Death",
      defenderDefense: 5,
      defenderResist: 5,
      defenderCurrentHp: 1000,
      level: 1, // threshold = 9*1+1 = 10; def=5 -> reduction=(10-10)/10=0 -> mitFrac=0 (no-op mitigation)
      ...overrides,
    };
  }


  describe("mitigation anchors (neutral elements, isolate Defense/Resist math)", () => {
    it("amplifies when defense is well below threshold/2 (negative reduction)", () => {
      // defense=20 < 46: reduction=(40-46)/46=-0.130435, mitFrac=-0.045652, final=trunc(100*1.045652)=104
      const result = applyDamage(
        baseHit({ defenderDefense: 20, defenderResist: 20, level: 5, defenderCurrentHp: 100000 }),
      );
      expect(result).toBe(104);
    });

    it("mitigates partially when defense is between threshold/2 and threshold", () => {
      // defense=100 >= threshold(46): reduction=trunc(100/46)=2, mitFrac=0.7, final=trunc(100*0.3)=30
      const result = applyDamage(
        baseHit({ defenderDefense: 100, defenderResist: 100, level: 5, defenderCurrentHp: 100000 }),
      );
      expect(result).toBe(30);
    });

    it("caps mitigation at 0.9 for very high defense", () => {
      // defense=1000: reduction=trunc(1000/46)=21, mitFrac=min(0.9,7.35)=0.9, final=trunc(100*0.1)=10
      const result = applyDamage(
        baseHit({ defenderDefense: 1000, defenderResist: 1000, level: 5, defenderCurrentHp: 100000 }),
      );
      expect(result).toBe(10);
    });
  });

  describe("elemental anchors (mitigation held at a deliberate no-op: def=threshold/2)", () => {
    // level=1 -> threshold=10; def=5 -> reduction=(10-10)/10=0 -> mitFrac=0, mitigation is exactly a no-op.
    it("applies the x3.5 weakness factor for Life -> Death", () => {
      const result = applyDamage(
        baseHit({ damageElement: "Life", defenderElement: "Death", amount: 100, level: 1, defenderDefense: 5, defenderResist: 5 }),
      );
      expect(result).toBe(350);
    });

    it("applies the /1.5 resist factor for Death -> Life", () => {
      const result = applyDamage(
        baseHit({ damageElement: "Death", defenderElement: "Life", amount: 100, level: 1, defenderDefense: 5, defenderResist: 5 }),
      );
      expect(result).toBe(66); // trunc(100/1.5) = trunc(66.666) = 66
    });
  });

  it("uses Resist instead of Defense when sourceStat is Magic", () => {
    // Same numbers as the "caps mitigation at 0.9" case, but via Resist: defenderResist=1000,
    // defenderDefense deliberately different (0) to prove Defense is ignored.
    const result = applyDamage(
      baseHit({
        sourceStat: "Magic",
        defenderResist: 1000,
        defenderDefense: 0,
        level: 5,
        defenderCurrentHp: 100000,
      }),
    );
    expect(result).toBe(10);
  });

  it("derives the mitigation threshold (9*level+1) from the `level` param the caller resolves as max(attackerLevel, defenderLevel)", () => {
    // Per the HitParams contract, the caller (not applyDamage) computes max(attackerLevel,
    // defenderLevel) and passes it as `level`. This just confirms threshold sensitivity to it.
    const low = applyDamage(baseHit({ defenderDefense: 100, defenderResist: 100, level: 1, defenderCurrentHp: 100000 }));
    const high = applyDamage(baseHit({ defenderDefense: 100, defenderResist: 100, level: 5, defenderCurrentHp: 100000 }));
    expect(low).not.toBe(high);
  });

  it("caps the final damage at the defender's current HP", () => {
    const result = applyDamage(baseHit({ defenderCurrentHp: 50 }));
    expect(result).toBe(50);
  });

  it("clamps to 0 when mitigation fraction truncates the amount to less than 1", () => {
    // amount=5, mitFrac=0.9 (very high defense) -> trunc(5 - 4.5) = trunc(0.5) = 0
    const result = applyDamage(
      baseHit({ amount: 5, defenderElement: "Air", damageElement: "Fire", defenderDefense: 10000, defenderResist: 0, level: 1, defenderCurrentHp: 1000 }),
    );
    expect(result).toBe(0);
  });

  it("never returns negative damage", () => {
    const result = applyDamage(baseHit({ amount: 0, defenderDefense: 1000, defenderResist: 1000, level: 5 }));
    expect(result).toBeGreaterThanOrEqual(0);
  });
});
