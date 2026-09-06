import { describe, it, expect } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { HeadlessBattle } from "../src/battle.js";
import { rollDamage, applyDamage } from "../src/damage.js";
import type { Rng } from "../src/rng.js";

const gd = loadGameData();

/** A constant-U Rng: every `next()`/`intBelow()`/`chance()` call sees the SAME `v`. This makes
 *  the entire battle deterministic (aiChance gates, weighted picks, target picks, sacrifice
 *  checks, initial-delay spreads) regardless of exactly how many draws any given step consumes,
 *  which is what makes a full multi-turn integration battle hand-traceable without needing to
 *  enumerate every draw's position in the stream up front. With `v=0.5` specifically, every
 *  `rollDamage` roll degenerates to exactly `round(value)` (the pre-randomness base), since
 *  `min + 0.5*base*r == base*(1-r/2) + base*r/2 == base` for any `r` — see battle.test.ts's
 *  damage cross-checks below, which reuse this identity via `rollDamage`/`applyDamage` directly. */
function constantRng(v: number): Rng {
  return {
    next: () => v,
    intBelow: (n) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`intBelow(${n})`);
      return Math.floor(v * n);
    },
    chance: (p) => v < p,
  };
}

describe("HeadlessBattle - 1v1 real GameData, damage-only kits (brief Step 2(b))", () => {


  const rng = constantRng(0.5);
  const battle = new HeadlessBattle(
    gd,
    [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
    rng,
    { fightingGroupSize: 1 },
  );
  const report = battle.runToCompletion(50);

  it("emits battleStarted -> alternating turns -> died -> battleEnded, and SnowCub's team wins", () => {
    expect(report.events[0]).toEqual({
      type: "battleStarted",
      teams: [["t0m0:FireCub"], ["t1m0:SnowCub"]],
    });
    expect(report.events.at(-1)).toEqual({ type: "battleEnded", winner: 1, time: report.elapsed });
    expect(report.winner).toBe(1);

    // Both monsters share identical rootStats/stars (verified via GameData) and identical
    // activationLength (both pick their usable1 Attack, tier "{5}" -> 160) and identical Speed,
    // so initialBattleDelay ties exactly under the constant-0.5 Rng — team 0 (FireCub) wins the
    // TimedQueue insertion-order tie-break (scheduler.md §0), acting first every alternating turn.
    const turnLivings = report.events.filter((e) => e.type === "turnStarted").map((e) => e.living);
    expect(turnLivings).toEqual([
      "t0m0:FireCub",
      "t1m0:SnowCub",
      "t0m0:FireCub",
      "t1m0:SnowCub",
    ]);

    const died = report.events.filter((e) => e.type === "died");
    expect(died).toEqual([{ type: "died", living: "t0m0:FireCub" }]);
  });

  it("every abilityUsed picks the usable1 physical Attack (weighted roll 145 always inside its 160-bucket)", () => {
    const used = report.events.filter((e) => e.type === "abilityUsed");
    expect(used.every((e) => e.type === "abilityUsed" && e.ability === "Offensive.Attack")).toBe(true);
    expect(used.filter((e) => e.type === "abilityUsed" && e.source === "t0m0:FireCub")).toHaveLength(2);
    expect(used.filter((e) => e.type === "abilityUsed" && e.source === "t1m0:SnowCub")).toHaveLength(2);
  });

  it("every damageDealt.amount matches an independent rollDamage/applyDamage recomputation from the same recorded U=0.5 draws", () => {
    // Level-5 effective stats (via GameData/baseStat, both monsters identical): Attack=23,
    // Defense=33, Resist=33. Both usable1 Attacks resolve activationLength "{5}" -> tier 5 ->
    // 160 (AttackAbilityComponent, roll.relatedStat=Attack, targetPicker enemyTargets:1 ->
    // numTargets=1, no multi-target divisor). With U=0.5, rollDamage's roll collapses to
    // round(value) exactly (the constantRng header comment's identity) -> recompute directly:
    const attackerAttack = 23;
    const defenderDefense = 33;
    const defenderResist = 33;
    const activationLength = 160;
    const level = 5;

    const rollFor = () =>
      rollDamage(
        { abilityScalor: 1, stat: attackerAttack, activationLength, scaleByActivationLength: true, randomness: 0.2, numTargets: 1 },
        constantRng(0.5),
      );

    // FireCub (Fire) -> SnowCub (Water): Fire is weak AGAINST Water (weaknessOf(Fire)===Water)
    // -> resisted, divided by weaknessFactor(Water)=1.5.
    const fireToSnow = applyDamage({
      amount: rollFor(),
      damageElement: "Fire",
      sourceStat: "Attack",
      defenderElement: "Water",
      defenderDefense,
      defenderResist,
      defenderCurrentHp: 10_000, // uncapped reference value; real clamp checked separately below
      level,
    });
    // SnowCub (Water) -> FireCub (Fire): Fire is weak to Water (weaknessOf(defender=Fire)===Water)
    // -> defender amplified, multiplied by weaknessFactor(Fire)=1.5.
    const snowToFire = applyDamage({
      amount: rollFor(),
      damageElement: "Water",
      sourceStat: "Attack",
      defenderElement: "Fire",
      defenderDefense,
      defenderResist,
      defenderCurrentHp: 10_000,
      level,
    });

    const damageDealt = report.events.filter((e) => e.type === "damageDealt");
    expect(damageDealt.length).toBe(4);
    // The LAST SnowCub->FireCub hit lands when FireCub has only 34 HP left, so applyDamage's own
    // defenderCurrentHp clamp caps it below the uncapped snowToFire recomputation (43) — every
    // other hit (including both FireCub->SnowCub hits, which never come close to lethal) matches
    // the uncapped recomputation exactly.
    damageDealt.forEach((e, i) => {
      if (e.type !== "damageDealt") return;
      if (e.source === "t0m0:FireCub") {
        expect(e.amount).toBe(fireToSnow);
        expect(e.element).toBe("Fire");
      } else {
        expect(e.element).toBe("Water");
        expect(e.amount).toBe(i === damageDealt.length - 1 ? 34 : snowToFire);
      }
    });

    // Concretely: fireToSnow=18, snowToFire=43 (except the last hit, clamped to FireCub's
    // remaining 34 HP by applyDamage's own defenderCurrentHp clamp — see the next assertion).
    expect(fireToSnow).toBe(18);
    expect(snowToFire).toBe(43);
  });

  it("HP track exactly: FireCub 77->34->0(clamped from 43 to 34), SnowCub 77->59->41", () => {
    const hpAfter = (id: string) =>
      report.events.filter((e) => e.type === "damageDealt" && e.target === id).map((e) => (e.type === "damageDealt" ? e.hpAfter : -1));
    expect(hpAfter("t1m0:SnowCub")).toEqual([59, 41]);
    expect(hpAfter("t0m0:FireCub")).toEqual([34, 0]);

    const lastFireCubHit = report.events.filter((e) => e.type === "damageDealt" && e.target === "t0m0:FireCub").at(-1);
    expect(lastFireCubHit).toMatchObject({ amount: 34 }); // clamped from the "full" 43
  });
});

describe("HeadlessBattle - dead-front replacement (brief Step 2(c))", () => {
  // fightingGroupSize:1, team1 fields TWO SnowCubs (only the first is active; the second
  // benched). Team0's FireCub is heavily overleveled so it one-shots both SnowCubs in turn,
  // exercising Team.replaceDeadMonster's bench-backfill (battle.md §2/§5): the SAME living id
  // (t1m1:SnowCub, assigned from its ORIGINAL construction-order index, not its live active-slot
  // position) must appear acting and dying after t1m0 dies, proving the backfill promoted the
  // bench monster into the vacated active slot under its stable id.
  const rng = constantRng(0.5);
  const battle = new HeadlessBattle(
    gd,
    [
      [{ shortType: "FireCub", level: 50 }],
      [
        { shortType: "SnowCub", level: 1 },
        { shortType: "SnowCub", level: 1 },
      ],
    ],
    rng,
    { fightingGroupSize: 1 },
  );
  const report = battle.runToCompletion(50);

  it("battleStarted lists both team1 monsters (active + bench) under their stable original-index ids", () => {
    expect(report.events[0]).toEqual({
      type: "battleStarted",
      teams: [["t0m0:FireCub"], ["t1m0:SnowCub", "t1m1:SnowCub"]],
    });
  });

  it("t1m0 dies first, then t1m1 (the bench monster) acts and dies under its OWN stable id, then team0 wins", () => {
    const timeline = report.events.map((e) => (e.type === "died" || e.type === "turnStarted" ? `${e.type}:${e.living}` : null)).filter(
      (x): x is string => x !== null,
    );
    // t0m0 acts first (one-shots t1m0) -> t1m0 dies -> the replacement (t1m1) is scheduled and
    // becomes the new front -> t1m1 acts (dealing some damage back) -> t0m0 acts again
    // (one-shots t1m1) -> t1m1 dies -> team1's active roster (and bench) are both empty -> win.
    expect(timeline).toEqual([
      "turnStarted:t0m0:FireCub",
      "died:t1m0:SnowCub",
      "turnStarted:t1m1:SnowCub",
      "turnStarted:t0m0:FireCub",
      "died:t1m1:SnowCub",
    ]);
    expect(report.winner).toBe(0);
    expect(report.events.at(-1)).toEqual({ type: "battleEnded", winner: 0, time: report.elapsed });
  });

  it("both SnowCub deaths take the exact same one-shot damage (identical level/stats), proving the replacement is a full, independently-alive Living, not a stale reference", () => {
    const hits = report.events.filter((e) => e.type === "damageDealt" && e.source === "t0m0:FireCub");
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ target: "t1m0:SnowCub", hpAfter: 0 });
    expect(hits[1]).toMatchObject({ target: "t1m1:SnowCub", hpAfter: 0 });
    if (hits[0]!.type === "damageDealt" && hits[1]!.type === "damageDealt") {
      expect(hits[0]!.amount).toBe(hits[1]!.amount); // same monster/level -> same computed damage
    }
  });
});

describe("HeadlessBattle - sacrificeChance self-kill path (battle.md §1 advanceQueWithCounter:)", () => {
  // Animal.UnhappyBird: usable1 Offensive.Attack "{3}" -> weight 100 ("EggBomb"), usable2
  // Offensive.AttackAll "{7}" -> weight 250 with job-ref `sacrificeChance: 1` ("Detonate").
  // Under constant U=0.5 the weighted pick floor(0.5*350)=175 always lands in AttackAll's
  // bucket — a fully-implemented AttackAbilityComponent kit whose post-ability sacrifice draw
  // (U=0.5 < 1) ALWAYS triggers the self-kill (`adjustHP:-hp ... sourceOfAdjust:nil`). 19 job
  // refs in the real corpus carry sacrificeChance; this is the regression anchor for that whole
  // branch (which previously crashed: the pendingDamageElement stash was cleared before the
  // sacrifice roll ran).
  const battle = new HeadlessBattle(
    gd,
    [[{ shortType: "UnhappyBird", level: 5 }], [{ shortType: "SnowCub", level: 10 }]],
    constantRng(0.5),
    { fightingGroupSize: 1 },
  );
  const report = battle.runToCompletion(50);

  it("emits a self-sourced damageDealt for the actor's FULL remaining hp (own element), then died, then battleEnded", () => {
    // Deterministic trace under constant U=0.5: SnowCub L10 acts first (faster -> lower initial
    // delay), physical Attack for 39 (86 -> 47; its weighted pick lands in usable1 Attack's
    // 160-bucket, same as the 1v1 describe above); UnhappyBird then casts AttackAll (122 to
    // SnowCub — its own weighted roll floor(0.5*350)=175 lands past usable1's 100-bucket), and
    // the sacrifice draw self-kills it for exactly its remaining 47 hp.
    const events = report.events;
    const selfKillIdx = events.findIndex(
      (e) => e.type === "damageDealt" && e.source === "t0m0:UnhappyBird" && e.target === "t0m0:UnhappyBird",
    );
    expect(events[selfKillIdx]).toEqual({
      type: "damageDealt",
      source: "t0m0:UnhappyBird",
      target: "t0m0:UnhappyBird",
      amount: 47,
      element: "Air", // the actor's OWN element (port-defined event semantics, battle.ts header #6)
      hpAfter: 0,
      cause: "sacrifice", // events.ts CollateralHpCause: not the cast's own hit
    });
    expect(events[selfKillIdx + 1]).toEqual({ type: "died", living: "t0m0:UnhappyBird" });
    expect(events[selfKillIdx + 2]).toEqual({ type: "battleEnded", winner: 1, time: 97 });
    expect(report.winner).toBe(1);
  });

  it("the sacrificed actor is never rescheduled (exactly one UnhappyBird turn)", () => {
    const turns = report.events.filter((e) => e.type === "turnStarted").map((e) => e.living);
    expect(turns).toEqual(["t1m0:SnowCub", "t0m0:UnhappyBird"]);
  });
});

describe("HeadlessBattle - runToCompletion throws past maxTurns on a non-terminating battle (brief Step 2(d))", () => {


  const delayForever = () => ({
    ability: gd.ability("Utility.Delay"),
    args: {},
    enemyTargets: [],
    friendlyTargets: [],
    rngDraws: 0,
  });

  it("two Reptilos scripted to skip every turn stalemate on Utility.Delay forever", () => {
    const battle = new HeadlessBattle(
      gd,
      [[{ shortType: "Reptilo", level: 5 }], [{ shortType: "Reptilo", level: 5 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    expect(() => battle.runToCompletion(50, delayForever)).toThrow(/exceeded maxTurns=50/);
  });

  it("defaults maxTurns to 1000 when called with no argument", () => {
    const battle = new HeadlessBattle(
      gd,
      [[{ shortType: "Reptilo", level: 5 }], [{ shortType: "Reptilo", level: 5 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    expect(() => battle.runToCompletion(undefined, delayForever)).toThrow(/exceeded maxTurns=1000/);
  });

  it("two Reptilos under the real AI now FIGHT (usable1 Offensive.Attack is selectable) and the battle terminates", () => {
    // Regression companion to the guard tests above: the identical roster that used to stalemate
    // resolves normally once the slot-1 ability is a real candidate.
    const battle = new HeadlessBattle(
      gd,
      [[{ shortType: "Reptilo", level: 5 }], [{ shortType: "Reptilo", level: 5 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    const report = battle.runToCompletion(200);
    const used = report.events.filter((e) => e.type === "abilityUsed").map((e) => (e.type === "abilityUsed" ? e.ability : ""));
    expect(used.length).toBeGreaterThan(0);
    expect(used.every((a) => a === "Offensive.Attack")).toBe(true);
    expect(report.winner === 0 || report.winner === 1).toBe(true);
  });
});

describe("HeadlessBattle - fightingGroupSize default", () => {
  it("defaults to 3 (Battle's designated initializer hardcodes fightingGroupSize=3 for both teams, battle.md §2)", () => {
    // 4 FireCubs on team0 (3 active + 1 benched) vs 1 SnowCub on team1; no opts passed.
    const battle = new HeadlessBattle(
      gd,
      [
        [
          { shortType: "FireCub", level: 50 },
          { shortType: "FireCub", level: 50 },
          { shortType: "FireCub", level: 50 },
          { shortType: "FireCub", level: 50 },
        ],
        [{ shortType: "SnowCub", level: 1 }],
      ],
      constantRng(0.5),
    );
    const report = battle.runToCompletion(50);
    expect(report.events[0]).toEqual({
      type: "battleStarted",
      teams: [
        ["t0m0:FireCub", "t0m1:FireCub", "t0m2:FireCub", "t0m3:FireCub"],
        ["t1m0:SnowCub"],
      ],
    });
    // Only the first 3 FireCubs (t0m0..t0m2) ever get a turn — the 4th (t0m3) stays benched the
    // whole battle since team0 never loses an active member.
    const actors = new Set(report.events.filter((e) => e.type === "turnStarted").map((e) => e.living));
    expect(actors.has("t0m3:FireCub")).toBe(false);
    expect(report.winner).toBe(0);
  });
});

describe("HeadlessBattle - construction guards", () => {
  it("throws if either team is given zero monsters", () => {
    expect(() => new HeadlessBattle(gd, [[], [{ shortType: "FireCub", level: 5 }]], constantRng(0.5))).toThrow();
    expect(() => new HeadlessBattle(gd, [[{ shortType: "FireCub", level: 5 }], []], constantRng(0.5))).toThrow();
  });

  it("throws if runToCompletion is called a second time on the same instance", () => {
    const battle = new HeadlessBattle(
      gd,
      [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    battle.runToCompletion(50);
    expect(() => battle.runToCompletion(50)).toThrow();
  });
});
