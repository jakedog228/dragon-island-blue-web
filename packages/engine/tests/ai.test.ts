import { describe, it, expect } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { assignAbility, redirectEnemyTargets, type AiWorld } from "../src/ai.js";
import type { Rng } from "../src/rng.js";

const gd = loadGameData();

/** Scripted Rng: returns each value in `values` in order for BOTH `next()` and `intBelow()`
 *  (intBelow floors `v*n`), throwing loudly if exhausted — makes draw-order/draw-count
 *  assertions exact. */
function seqRng(values: number[]): Rng {
  let i = 0;
  const draw = (): number => {
    if (i >= values.length) throw new Error(`seqRng exhausted at draw ${i}`);
    return values[i++] as number;
  };
  return {
    next: () => draw(),
    intBelow: (n) => Math.floor(draw() * n),
    chance: (p) => draw() < p,
  };
}

function makeWorld(overrides: Partial<AiWorld> & { shortType: string }): AiWorld {
  return {
    shortTypeOf: () => overrides.shortType,
    enemyPoolOf: overrides.enemyPoolOf ?? (() => []),
    friendlyPoolOf: overrides.friendlyPoolOf ?? (() => []),
  };
}

describe("assignAbility - BatFiend real ability pair (battle.md §4a single slot>=1 gate)", () => {






  const world = makeWorld({ shortType: "BatFiend", enemyPoolOf: () => ["enemy1"] });

  it("weighted roll past Air.Air's 70-bucket (floor(0.5*320)=160) picks Confuse.Confuse, then one enemy-target draw", () => {
    const decision = assignAbility("hero", world, gd, seqRng([0.5, 0.5, 0.5, 0.5]));
    expect(decision.ability.path).toBe("Offensive.Confuse.Confuse");
    // 2 aiChance gate draws (usable1, usable2) + 1 weighted-pick draw + 1 enemy-target draw
    // (Confuse.Confuse's targetPicker declares enemyTargets: 1 against a 1-enemy pool).
    expect(decision.rngDraws).toBe(4);
    expect(decision.enemyTargets).toEqual(["enemy1"]);
    expect(decision.friendlyTargets).toEqual([]);
    expect(decision.args).toEqual({ activationLength: "{7}", instanceName: "Confusion" });
  });

  it("weighted roll inside Air.Air's 70-bucket (floor(0.1*320)=32) picks the SLOT-1 ability — the fixed behavior", () => {



    const decision = assignAbility("hero", world, gd, seqRng([0.99, 0.1, 0.1, 0.1]));
    expect(decision.ability.path).toBe("Offensive.Air.Air");
    expect(decision.rngDraws).toBe(4); // 2 gates + 1 pick + 1 enemy-target draw
    expect(decision.enemyTargets).toEqual(["enemy1"]);
  });
});

describe("assignAbility - BatSquirrel usable2's non-default aiChance=0.3 (Bernoulli threshold direction)", () => {
  // BatSquirrel: usable1 = Offensive.DrainHealth (slot 1, weight "{2}" -> 70, aiChance default
  // 1.0 -> always a candidate), usable2 = Defensive.HasteUp (slot 2, weight "{3}" -> 100,
  // aiChance 0.3 from the JOB-REF ARGUMENTS — HasteUp's own ability dictionary has no aiChance
  // key, so ability.md §7's "dictionary wins, args is the fallback" precedence resolves to the
  // args value here). HasteUp's targetPicker is selfOnly (inherited from SelfOnlyRoot) -> no
  // target draws when selected.
  const world = makeWorld({ shortType: "BatSquirrel" });

  it("U < aiChance (0.2 < 0.3) passes the gate -> two-candidate list, floor(0.5*170)=85 lands in HasteUp's bucket, 3 draws", () => {
    const decision = assignAbility("hero", world, gd, seqRng([0.9, 0.2, 0.5]));
    expect(decision.ability.path).toBe("Defensive.HasteUp");
    expect(decision.friendlyTargets).toEqual(["hero"]);
    expect(decision.enemyTargets).toEqual([]);
    // 2 aiChance draws + 1 weighted-pick draw (cumulative [70, 170]) — no target draws (selfOnly).
    expect(decision.rngDraws).toBe(3);
  });

  it("U >= aiChance (0.5 >= 0.3) rejects HasteUp -> DrainHealth remains the sole candidate (NOT a Delay fallback), 3 draws", () => {
    // Pre-fix this asserted Utility.Delay: with the phantom slot>1 gate BatSquirrel had no
    // eligible ability once HasteUp's roll failed. Corrected rule: slot-1 DrainHealth is always
    // in the list. Its targetPicker asks enemyTargets:1, but this bare world's enemy pool is
    // empty, so the without-replacement pick stops with zero draws and zero targets.
    const decision = assignAbility("hero", world, gd, seqRng([0.9, 0.5, 0.5]));
    expect(decision.ability.path).toBe("Offensive.DrainHealth");
    expect(decision.enemyTargets).toEqual([]);
    expect(decision.friendlyTargets).toEqual([]);
    expect(decision.rngDraws).toBe(3); // 2 gates + 1 single-item weighted pick
  });

  it("the Utility.Delay fallback still exists for a roster with NO job abilities at all (0 draws)", () => {
    // No shipped monster can idle every turn any more (a corpus scan found zero jobs whose every
    // usable slot has effective aiChance 0 — matching the original game, where enemies visibly
    // never skip). The fallback branch itself (battle.md §4a "Ai found no abilitys to use")
    // remains reachable only for empty/unknown kits, queued with no target-building draws.
    const decision = assignAbility("hero", makeWorld({ shortType: "NoSuchMonster" }), gd, seqRng([]));
    expect(decision.ability.path).toBe("Utility.Delay");
    expect(decision.enemyTargets).toEqual([]);
    expect(decision.friendlyTargets).toEqual([]);
    expect(decision.rngDraws).toBe(0);
  });
});

describe("assignAbility - weight = activationLength, multi-candidate weighted pick (battle.md §4a point 2)", () => {
  // Animal.Cockatrice: usable1 Offensive.Attack (slot 1, aiChance default 1.0 -> ALWAYS a
  // candidate under the corrected single slot>=1 gate, weight = ref-override activationLength
  // "{5}" -> 160), usable2 Utility.Escape (slot 2, aiChance=0 baked into ITS OWN ability
  // dictionary -> ability.md §7's "dictionary wins" precedence means the 0.2-style job-ref
  // override pattern can't rescue it -> NEVER added), usable3 Offensive.DoubleAttack (slot 3,
  // aiChance default 1.0 -> ALWAYS passes, weight = ref-override activationLength "{2}" -> 70),
  // usable4 Utility.StatusRemove.StatusRemoveAll (slot 4, aiChance 0.2 from job-ref arguments —
  // its own dictionary has no aiChance key -> args is the fallback here, weight = ref-override
  // activationLength "{4}" -> 130, targetPicker allFriends:true+friendlyTargets:1 with
  // allFriends checked first -> whole friendly pool, no draws).
  const world: AiWorld = {
    shortTypeOf: () => "Cockatrice",
    enemyPoolOf: () => ["e1", "e2", "e3"],
    friendlyPoolOf: () => ["f1", "f2"],
  };

  it("StatusRemoveAll's gate fails (U=0.5 >= 0.2) -> [Attack(160), DoubleAttack(70)]; floor(0.8*230)=184 -> DoubleAttack, 2 uniform-without-replacement enemy targets", () => {
    const decision = assignAbility("hero", world, gd, seqRng([0.5, 0.5, 0.5, 0.5, 0.8, 0, 0]));
    expect(decision.ability.path).toBe("Offensive.DoubleAttack");
    // 4 aiChance gate draws (usable1..4) + 1 weighted-pick draw (cumulative [160, 230]) + 2
    // enemy-target draws (enemyTargets: 2 against a 3-enemy pool, uniform without replacement).
    expect(decision.rngDraws).toBe(7);
    expect(decision.enemyTargets).toEqual(["e1", "e2"]);
    expect(decision.friendlyTargets).toEqual([]);
  });

  it("the weighted roll inside Attack's 160-bucket (floor(0.5*230)=115) picks the slot-1 Attack — the fixed behavior", () => {
    const decision = assignAbility("hero", world, gd, seqRng([0.5, 0.5, 0.5, 0.5, 0.5, 0]));
    expect(decision.ability.path).toBe("Offensive.Attack");
    // 4 gates + 1 pick + 1 enemy-target draw (Attack's targetPicker asks enemyTargets: 1).
    expect(decision.rngDraws).toBe(6);
    expect(decision.enemyTargets).toEqual(["e1"]);
    expect(decision.friendlyTargets).toEqual([]);
  });

  it("clamps DoubleAttack's target draws when only one enemy remains", () => {
    const reducedWorld: AiWorld = {
      ...world,
      enemyPoolOf: () => ["lastEnemy"],
    };
    const decision = assignAbility(
      "hero",
      reducedWorld,
      gd,
      seqRng([0.5, 0.5, 0.5, 0.5, 0.8, 0]),
    );
    expect(decision.ability.path).toBe("Offensive.DoubleAttack");
    expect(decision.enemyTargets).toEqual(["lastEnemy"]);
    // 4 gates + weighted pick + one possible target draw; no draw is attempted from an empty pool.
    expect(decision.rngDraws).toBe(6);
  });

  it("all three qualify -> the weighted draw (floor(0.9*360)=324) lands past Attack's and DoubleAttack's buckets -> StatusRemoveAll picked", () => {
    const decision = assignAbility("hero", world, gd, seqRng([0.5, 0.5, 0.5, 0.1, 0.9]));
    expect(decision.ability.path).toBe("Utility.StatusRemove.StatusRemoveAll");
    // 4 aiChance gate draws + 1 weighted-pick draw (cumulative [160, 230, 360]); allFriends:true
    // -> whole pool, no target draws.
    expect(decision.rngDraws).toBe(5);
    expect(decision.friendlyTargets).toEqual(["f1", "f2"]);
    expect(decision.enemyTargets).toEqual([]);
  });
});

describe("redirectEnemyTargets — Team.alternateTargetListWithOriginalTargets: @ 0x74290 (targeting-passives.md §A/§B)", () => {
  function redirectWorld(priorities: Record<string, number>): AiWorld {
    return {
      shortTypeOf: () => "unused",
      enemyPoolOf: () => Object.keys(priorities),
      friendlyPoolOf: () => [],
      targetPriorityOf: (id) => priorities[id] ?? 0,
    };
  }

  it("single original target, no adjustments anywhere: pool of one — returned directly, ZERO draws", () => {
    const world = redirectWorld({ a: 0, b: 0, c: 0 });
    // b/c have sum 0 and are not originals -> excluded; the pool is exactly [a].
    const result = redirectEnemyTargets("hero", ["a"], world, seqRng([])); // exhausts on ANY draw
    expect(result).toEqual(["a"]);
  });

  it("a taunting non-original (EasyTarget +50) enters the pool and can steal a single-target hit", () => {
    const world = redirectWorld({ a: 0, taunter: 50 });
    // Pool insertion order = enemyPoolOf order: a (original, weight 100), taunter (weight 50);
    // endValue 150, cumulative [100, 150]. roll floor(0.9*150)=135 -> past a's bucket -> taunter.
    expect(redirectEnemyTargets("hero", ["a"], world, seqRng([0.9]))).toEqual(["taunter"]);
    // roll floor(0.5*150)=75 -> inside a's 100 bucket -> the original keeps the hit.
    expect(redirectEnemyTargets("hero", ["a"], world, seqRng([0.5]))).toEqual(["a"]);
  });

  it("uses removeRandomElement's inclusive cumulative boundary rather than getRandomElement's strict boundary", () => {
    const world = redirectWorld({ a: 0, taunter: 50 });
    // endValue 150, cumulative [100, 150], exact integer roll 100. Native removal selects the
    // first entry because cumulative >= roll; the ordinary getRandomElement scan would select
    // taunter because its bucket test is cumulative > roll.
    expect(redirectEnemyTargets("hero", ["a"], world, seqRng([100 / 150]))).toEqual(["a"]);
  });

  it("a Detaunt'd original (-50) still enters at max(sum+100,1) and a deep-negative one clamps to 1", () => {
    // Detaunt -50: weight max(-50+100,1) = 50 vs a plain original's 100.
    const world = redirectWorld({ detaunted: -50, plain: 0 });
    // endValue 150, order [detaunted(50), plain(100)] -> cumulative [50, 150].
    // Two originals: first draw floor(0.9*150)=135 -> plain; pool shrinks to [detaunted] -> free.
    expect(redirectEnemyTargets("hero", ["detaunted", "plain"], world, seqRng([0.9]))).toEqual([
      "plain",
      "detaunted",
    ]);

    const clampWorld = redirectWorld({ ghost: -9999, plain: 0 });
    // weights [1, 100], endValue 101; roll floor(0.005*101)=0 -> cumulative 1 > 0 -> ghost STILL
    // reachable at weight 1 (never fully excluded when originally targeted).
    expect(redirectEnemyTargets("hero", ["ghost", "plain"], clampWorld, seqRng([0.005]))).toEqual([
      "ghost",
      "plain",
    ]);
  });

  it("multi-target no-adjustment redirect: a permutation of the originals, consuming n-1 draws", () => {
    const world = redirectWorld({ a: 0, b: 0, c: 0 });
    // 3 originals at weight 100 each; endValue 300. Draw1 floor(0.7*300)=210 -> c (cumulative
    // 100/200/300). Pool [a(100), b(100)], endValue 200. Draw2 floor(0.3*200)=60 -> a.
    // Pool [b] -> free. Result is a REORDERING — target order randomizes even with no taunts.
    const result = redirectEnemyTargets("hero", ["a", "b", "c"], world, seqRng([0.7, 0.3]));
    expect(result).toEqual(["c", "a", "b"]);
    expect([...result].sort()).toEqual(["a", "b", "c"]); // always the same SET when no adjustments
  });

  it("Scapegoat's +9999 self-buff makes the taunter overwhelmingly (but not certainly) the target", () => {
    const world = redirectWorld({ a: 0, scapegoat: 9999 });
    // Pool [a(100), scapegoat(9999)], endValue 10099. roll floor(0.5*10099)=5049 -> scapegoat.
    expect(redirectEnemyTargets("hero", ["a"], world, seqRng([0.5]))).toEqual(["scapegoat"]);
    // The original keeps only the first 100 of 10099: roll floor(0.009*10099)=90 -> a.
    expect(redirectEnemyTargets("hero", ["a"], world, seqRng([0.009]))).toEqual(["a"]);
  });

  it("assignAbility itself never consumes redirect draws (they belong to queAbility/resolveTurn)", () => {
    // BatFiend picks Confuse.Confuse with exactly 4 draws (gates + pick + 1 target) even when
    // the enemy pool contains a real CrabKing-style taunter — the redirect runs later, in core.
    const world: AiWorld = {
      shortTypeOf: (id) => (id === "hero" ? "BatFiend" : "CrabKing"),
      enemyPoolOf: () => ["tauntingEnemy"],
      friendlyPoolOf: () => ["hero"],
    };
    const decision = assignAbility("hero", world, gd, seqRng([0.5, 0.5, 0.5, 0.5]));
    expect(decision.rngDraws).toBe(4);
    expect(decision.enemyTargets).toEqual(["tauntingEnemy"]);
  });
});
