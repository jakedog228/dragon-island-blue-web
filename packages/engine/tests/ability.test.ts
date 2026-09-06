import { describe, it, expect } from "vitest";
import { loadGameData } from "@dib/gamedata";
import type { AbilityDef, Element, StatName } from "@dib/gamedata";
import {
  performAbility,
  UnimplementedComponentError,
  type AbilityUse,
  type BattleWorld,
  type BuffListEntry,
} from "../src/ability.js";
import type { Rng } from "../src/rng.js";
import type { AbilityEffectText } from "../src/effectText.js";

const gd = loadGameData();

/** Stub Rng that returns a fixed sequence from next(), scripting the DiceRoller's single
 *  arc4random-equivalent draw per roll, deterministically, in call order. */
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
      throw new Error("not used by this slice");
    },
    chance: () => {
      throw new Error("not used by this slice");
    },
  };
}

/** Deterministic DiceRoller seam with an explicit record of its direct RNG draws. */
function tracingRng(values: number[]): { rng: Rng; nextCalls: number[] } {
  let i = 0;
  const nextCalls: number[] = [];
  return {
    rng: {
      next: () => {
        if (i >= values.length) throw new Error("tracingRng exhausted");
        const value = values[i];
        i++;
        nextCalls.push(value as number);
        return value as number;
      },
      intBelow: () => {
        throw new Error("not used by this slice");
      },
      chance: () => {
        throw new Error("not used by this slice");
      },
    },
    nextCalls,
  };
}

interface Actor {
  stats: Record<StatName, number>;
  element: Element;
  hp: number;
  level: number;
  destroyed?: boolean;
  path?: string;
  boss?: boolean;
}

/** Hand-rolled in-memory BattleWorld stub, per the brief's Step 3. Records every applyHpDelta
 *  call for assertions. */
function makeWorld(actors: Record<string, Actor>): BattleWorld & {
  calls: Array<[string, number, string]>;
  buffs: Array<[string, Record<string, unknown>]>;
  delays: Array<[string, number]>;
  authoredBuffs: Array<[string, BuffListEntry, string]>;
  effectTexts: Array<[string, AbilityEffectText]>;
  stuns: Array<[string, string, number]>;
} {
  const calls: Array<[string, number, string]> = [];
  const buffs: Array<[string, Record<string, unknown>]> = [];
  const delays: Array<[string, number]> = [];
  const authoredBuffs: Array<[string, BuffListEntry, string]> = [];
  const effectTexts: Array<[string, AbilityEffectText]> = [];
  const stuns: Array<[string, string, number]> = [];
  return {
    calls,
    buffs,
    delays,
    authoredBuffs,
    effectTexts,
    stuns,
    statsOf: (id) => {
      const a = actors[id];
      if (!a) throw new Error(`unknown actor: ${id}`);
      return a.stats;
    },
    elementOf: (id) => {
      const a = actors[id];
      if (!a) throw new Error(`unknown actor: ${id}`);
      return a.element;
    },
    hpOf: (id) => {
      const a = actors[id];
      if (!a) throw new Error(`unknown actor: ${id}`);
      return a.hp;
    },
    levelOf: (id) => {
      const a = actors[id];
      if (!a) throw new Error(`unknown actor: ${id}`);
      return a.level;
    },
    applyHpDelta: (id, delta, sourceId) => {
      const a = actors[id];
      if (!a) throw new Error(`unknown actor: ${id}`);
      a.hp += delta;
      calls.push([id, delta, sourceId]);
    },
    isDestroyed: (id) => actors[id]?.destroyed ?? false,
    addStatOnlyBuff: (id, spec) => {
      buffs.push([id, spec as unknown as Record<string, unknown>]);
      return true;
    },
    magnifyContext: (sourceId, targetId) => ({
      targetFullName: actors[targetId]?.path ?? targetId,
      targetStatuses: [],
      sourceTimeInCombat: 0,
      friendlyDeadCount: 0,
      enemyDeadCount: 0,
      friendlyActiveCount: 1,
      sourceKillsMade: 0,
    }),
    isBoss: (id) => actors[id]?.boss ?? false,
    addTimeDelay: (id, amount) => delays.push([id, amount]),
    removeStatusBuffs: () => {},
    removeAllBuffs: () => {},
    applyAuthoredBuff: (targetId, entry, sourceId) => authoredBuffs.push([targetId, entry, sourceId]),
    notifyDamageDealt: () => {},
    notifyEffectText: (targetId, effect) => effectTexts.push([targetId, effect]),
    notifyStunned: (targetId, sourceId, delay) => stuns.push([targetId, sourceId, delay]),
  };
}

const STATS_ZERO: Record<StatName, number> = {
  Attack: 0,
  Defense: 0,
  Magic: 0,
  MaxHP: 0,
  Resist: 0,
  Speed: 0,
};

describe("performAbility - Offensive.Air.Air (real GameData, DamageDealingAbilityComponent)", () => {
  // Offensive.Air.Air resolves to: activationLength "{4}" -> tier 4 -> TIER_TABLE[3] = 130;
  // components: [{type: "Offensive.MagicAttack"}] -> DamageDealingAbilityComponent,
  // roll.relatedStat "Magic"; eventData: only enemyTargetEventData (startDelay 0.5) -> source
  // phase fires first (countdown 0, always eligible), then enemy phase.
  const ability = gd.ability("Offensive.Air.Air");

  it("deals exactly the hand-computed damage for a single target and debits HP via applyHpDelta", () => {


    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Fire", hp: 1000, level: 1 },
      enemy: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["enemy"], ability, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5]), gd);

    expect(outcome.results).toEqual([{ target: "enemy", hpDelta: -125, element: "Fire" }]);
    expect(outcome.rngDraws).toBe(1);
    expect(world.calls).toEqual([["enemy", -125, "hero"]]);
  });

  it("skips a dead target in given array order, keeping the CONFIG numTargets (enemyTargets: 1 -> no divisor)", () => {
    // Air.Air's targetPicker declares `enemyTargets: 1`. Per damage.md §2 (VERIFIED), the roll's
    // numTargets is `[[abilitySource targetPickerData] numberOfEnemyTargets]` — fetched from the
    // ability's STATIC config, not the live result count — so even with 3 targets passed (one
    // dead), the roll uses numTargets=1: NO multi-target divisor, full single-target damage
    // (same derivation as the case above -> 125) to each live target, in given array order.
    // (A live-count numTargets=2 would instead give 75 — the pre-review bug this pins down.)
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Fire", hp: 1000, level: 1 },
      e1: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
      e2: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 0, level: 1 }, // dead
      e3: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["e1", "e2", "e3"], ability, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5, 0.5]), gd);

    expect(outcome.results).toEqual([
      { target: "e1", hpDelta: -125, element: "Fire" },
      { target: "e3", hpDelta: -125, element: "Fire" },
    ]);
    expect(outcome.rngDraws).toBe(2);
    expect(world.calls).toEqual([
      ["e1", -125, "hero"],
      ["e3", -125, "hero"],
    ]);
  });

  it("Offensive.Air.AirAll (allEnemies: true) hits all 3 living enemies in given order with the FIXED 3-target divisor", () => {


    const airAll = gd.ability("Offensive.Air.AirAll");
    expect(airAll.targetPicker?.["allEnemies"]).toBe(true);
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Fire", hp: 1000, level: 1 },
      e1: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
      e2: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
      e3: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["e1", "e2", "e3"], ability: airAll, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5, 0.5, 0.5]), gd);

    expect(outcome.results).toEqual([
      { target: "e1", hpDelta: -50, element: "Fire" },
      { target: "e2", hpDelta: -50, element: "Fire" },
      { target: "e3", hpDelta: -50, element: "Fire" },
    ]);
    expect(outcome.rngDraws).toBe(3);
    expect(world.calls).toEqual([
      ["e1", -50, "hero"],
      ["e2", -50, "hero"],
      ["e3", -50, "hero"],
    ]);
  });

  it("Offensive.Air.AirAll against only 2 live enemies STILL divides by the fixed 3, not the live count 2 (Part 1(b) regression)", () => {
    // Pins down the Part 1(b) fix concretely: with only 2 enemies standing, a live-count divisor
    // would give value=fround(125.3116/fround(2*0.84))=74.59024...->base=75, but
    // numberOfEnemyTargets's hardcoded literal 3 means the roll is STILL divided by 3*0.84 ->
    // base=50 (same derivation as the 3-live-enemy case above), regardless of live count.
    const airAll = gd.ability("Offensive.Air.AirAll");
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Fire", hp: 1000, level: 1 },
      e1: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
      e2: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["e1", "e2"], ability: airAll, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5, 0.5]), gd);

    expect(outcome.results).toEqual([
      { target: "e1", hpDelta: -50, element: "Fire" },
      { target: "e2", hpDelta: -50, element: "Fire" },
    ]);
  });

  it("Offensive.Air.DoubleAir (enemyTargets: 2) keeps numTargets=2 from config when one target is already dead", () => {
    // Regression for the review's concrete failure case: DoubleAir declares `enemyTargets: 2`;
    // cast at 2 pre-selected targets with one dead before the enemy phase fires, the survivor's
    // roll must still use numTargets=2 (config-fetched, damage.md §2 VERIFIED), NOT the live
    // count of 1 (which would skip the divisor and overdamage by ~68%).
    // Hand-computed: value = fround(125.3116 / fround(2*0.84)) = 74.59024047851562 -> base=75;
    // window: min=67.5; u=0.5 -> roll = round(67.5 + 0.5*75*0.2) = 75. magnification=0,
    // mitigation no-op -> final=75 (a live-count numTargets=1 would give 125 instead).
    const doubleAir = gd.ability("Offensive.Air.DoubleAir");
    expect(doubleAir.targetPicker?.["enemyTargets"]).toBe(2);
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Fire", hp: 1000, level: 1 },
      e1: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 0, level: 1 }, // dead
      e2: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["e1", "e2"], ability: doubleAir, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5]), gd);

    expect(outcome.results).toEqual([{ target: "e2", hpDelta: -75, element: "Fire" }]);
    expect(outcome.rngDraws).toBe(1);
    expect(world.calls).toEqual([["e2", -75, "hero"]]);
  });

  it("applies the args-over-dictionary activationLength precedence (ability.md §1) on a synthetic ability", () => {
    // Synthetic top-level AbilityDef (activationLength "{2}" = tier 2 = 70) whose sole component
    // is a REAL AbilityComponents.json path ("Offensive.MagicAttack" -> DamageDealingAbilityComponent,
    // relatedStat Magic), so GameData.abilityComponent resolution is exercised for real. The
    // caller-supplied `args.activationLength` ("{6}" = tier 6 = 200) must win.
    // Hand-computed for activationLength=200 (chosen to be clearly distinguishable from tier 2's
    // 70): factor = fround(Math.pow(fround(200*0.01), 0.86)) = fround(2^0.86) = 1.8153529...
    // scaledStat = fround(50 * factor) = 90.767646...; numTargets=1 -> base = round = 91;
    // window r=0.2: min=81.9; u=0 -> roll = round(81.9) = 82.
    const synthetic: AbilityDef = {
      path: "Test.Synthetic",
      className: "CombatAbility",
      activationLength: "{2}",
      components: [{ type: "Offensive.MagicAttack" }],
      raw: { eventData: { enemyTargetEventData: { startDelay: 0.5 } } },
    };
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 50 }, element: "Fire", hp: 1000, level: 1 },
      enemy: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 1000, level: 1 },
    });
    const use: AbilityUse = {
      source: "hero",
      targets: ["enemy"],
      ability: synthetic,
      args: { activationLength: "{6}" },
    };
    const outcome = performAbility(use, world, stubRng([0]), gd);

    // final = 82 (no mitigation, def=resist=5 < threshold=10 -> reduction=0)
    expect(outcome.results).toEqual([{ target: "enemy", hpDelta: -82, element: "Fire" }]);
  });
});

describe("performAbility - Offensive.Attack (real GameData, AttackAbilityComponent — Part 1(a))", () => {


  const ability = gd.ability("Offensive.Attack");

  it("deals hand-computed damage via the Attack stat (not Magic) and mitigates via Defense (not Resist)", () => {
    // stat = 100 (attacker Attack, NOT Magic — proves relatedStat routing through the shared
    // roll dict on AttackAbilityComponent's own resolved component def); activationLength=130 ->
    // same factor as the Air.Air anchor (fround(1.3^0.86)) -> scaledStat = fround(100*factor) =
    // 125.31159973144531; numTargets=1 (config, enemyTargets:1) -> base = round = 125; window
    // r=0.2: min=112.5; u=0.5 -> roll = round(112.5+0.5*125*0.2) = round(125) = 125.
    // magnification=0 -> baseAmount=125. Mitigation: sourceStat "Attack" -> uses
    // defenderDefense=10 (NOT defenderResist=999, which would give a very different result if
    // wrongly routed) -> threshold=9*1+1=10; def(10) >= threshold(10) -> reduction=trunc(10/10)=1
    // -> mitFrac=min(0.9,0.35*1)=0.35 -> final=trunc(125*0.65)=trunc(81.25)=81. Elemental:
    // attacker "Fire" vs defender "Death" is neutral (same pairing as the Air.Air anchor).
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Attack: 100 }, element: "Fire", hp: 1000, level: 1 },
      enemy: { stats: { ...STATS_ZERO, Defense: 10, Resist: 999 }, element: "Death", hp: 1000, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["enemy"], ability, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5]), gd);

    expect(outcome.results).toEqual([{ target: "enemy", hpDelta: -81, element: "Fire" }]);
    expect(outcome.rngDraws).toBe(1);
    expect(world.calls).toEqual([["enemy", -81, "hero"]]);
  });
});

describe("performAbility - Defensive.Heal (real GameData, HealingAbilityComponent)", () => {
  // Defensive.Heal resolves to: no activationLength key -> default 100 (a convenient anchor:
  // powf(100*0.01, 0.86) == powf(1, 0.86) == 1, so scaledStat == stat exactly); components:
  // [{type: "Defensive.Heal"}] -> HealingAbilityComponent, roll.relatedStat "Magic"; eventData:
  // only friendlyTargetEventData -> friends phase fires (source phase is a no-op for this
  // ability, since none of our 3 known components run in the source phase).
  const ability = gd.ability("Defensive.Heal");

  it("restores the hand-computed amount for a single target", () => {
    // stat=100, activationLength=100 -> factor=1 -> value=100; numTargets=1 -> base=round(100)=100
    // window: min=90; u=0.5 -> roll=round(90+0.5*100*0.2)=round(100)=100. magnification=0 ->
    // amount=100 (n<2, no split divisor). amount>=1 -> heal +100.
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Water", hp: 500, level: 1 },
      ally: { stats: STATS_ZERO, element: "Water", hp: 500, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["ally"], ability, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5]), gd);

    expect(outcome.results).toEqual([{ target: "ally", hpDelta: 100, element: null }]);
    expect(outcome.rngDraws).toBe(1);
    expect(world.calls).toEqual([["ally", 100, "hero"]]);
  });

  it("keeps the ROLL numTargets at the config's friendlyTargets=1 while the SPLIT n uses the live count of 2", () => {


    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Water", hp: 500, level: 1 },
      a1: { stats: STATS_ZERO, element: "Water", hp: 500, level: 1 },
      a2: { stats: STATS_ZERO, element: "Water", hp: 500, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["a1", "a2"], ability, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5, 0.5]), gd);

    expect(outcome.results).toEqual([
      { target: "a1", hpDelta: 71, element: null },
      { target: "a2", hpDelta: 71, element: null },
    ]);
    expect(outcome.rngDraws).toBe(2);
  });

  it("Defensive.HealAll (allFriends: true) uses literal roll numTargets 1 and the live-count 0.7 split divisor", () => {


    const healAll = gd.ability("Defensive.HealAll");
    expect(healAll.targetPicker?.["allFriends"]).toBe(true);
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 100 }, element: "Water", hp: 500, level: 1 },
      a1: { stats: STATS_ZERO, element: "Water", hp: 500, level: 1 },
      a2: { stats: STATS_ZERO, element: "Water", hp: 500, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["a1", "a2"], ability: healAll, args: {} };
    const outcome = performAbility(use, world, stubRng([0.5, 0.5]), gd);

    expect(outcome.results).toEqual([
      { target: "a1", hpDelta: 71, element: null },
      { target: "a2", hpDelta: 71, element: null },
    ]);
    expect(outcome.rngDraws).toBe(2);
  });
});

describe("performAbility - source-derived modifier components", () => {
  it("builds a 1200-TU Attack StatOnly buff from Defensive.AttackUp", () => {
    const ability = gd.ability("Defensive.AttackUp");
    const world = makeWorld({ hero: { stats: STATS_ZERO, element: "Air", hp: 100, level: 7 } });
    performAbility({ source: "hero", targets: ["hero"], ability, args: {} }, world, stubRng([]), gd);
    expect(world.buffs).toEqual([
      ["hero", {
        sourceId: "hero",
        sourceLevel: 7,
        duration: 1200,
        stats: ["Attack"],
        statsHelp: true,
      }],
    ]);
    expect(world.effectTexts).toEqual([["hero", {
      kind: "stat", stat: "Attack", direction: "up", amount: 7,
    }]]);
  });

  it("uses the binary's inverted haste signs and 500-TU duration", () => {
    const world = makeWorld({
      hero: { stats: STATS_ZERO, element: "Air", hp: 100, level: 3 },
      enemy: { stats: STATS_ZERO, element: "Earth", hp: 100, level: 3 },
    });
    performAbility(
      { source: "hero", targets: ["hero"], ability: gd.ability("Defensive.HasteUp"), args: {} },
      world,
      stubRng([]),
      gd,
    );
    performAbility(
      { source: "hero", targets: ["enemy"], ability: gd.ability("Offensive.HasteDown"), args: {} },
      world,
      stubRng([]),
      gd,
    );
    expect(world.buffs[0]).toEqual([
      "hero",
      expect.objectContaining({ haste: Math.fround(-0.6), duration: 500, stackName: "hasteUp" }),
    ]);
    expect(world.buffs[1]).toEqual([
      "enemy",
      expect.objectContaining({ haste: Math.fround(0.3), duration: 500, stackName: "hasteDown" }),
    ]);
    expect(world.effectTexts).toEqual([
      ["hero", { kind: "haste", direction: "up", amount: 37 }],
      ["enemy", { kind: "haste", direction: "down", amount: 30 }],
    ]);
  });

  it("runs job-ref Magnify before base Attack", () => {
    const ability = gd.ability("Offensive.Attack");
    const ref = gd.jobAbilities("DonPen").find((candidate) => candidate.slot === "usable1");
    expect(ref).toBeDefined();
    const actors = () => ({
      hero: { stats: { ...STATS_ZERO, Attack: 100 }, element: "Air" as const, hp: 1000, level: 1 },
      enemy: {
        stats: STATS_ZERO,
        element: "Fire" as const,
        hp: 1000,
        level: 1,
        path: "Humanoid.Minotaur",
      },
    });
    const base = performAbility(
      { source: "hero", targets: ["enemy"], ability, args: { activationLength: "{5}" } },
      makeWorld(actors()),
      stubRng([0.5]),
      gd,
    );
    const magnified = performAbility(
      { source: "hero", targets: ["enemy"], ability, args: ref!.arguments },
      makeWorld(actors()),
      stubRng([0.5]),
      gd,
    );
    expect(base.results[0]?.hpDelta).toBe(-202);
    // DonPen supplies abilityScalor 0.9 and Humanoid magnification +1: the native order yields
    // round(202 * 0.9) = 182, then applyMod(182, 1) = 364.
    expect(magnified.results[0]?.hpDelta).toBe(-364);
  });
});

describe("performAbility - disabling status components", () => {
  it("applies Confuse for its computed duration only when U < the default 0.75 chance", () => {
    const ability = gd.ability("Offensive.Confuse.Confuse");
    const actors = () => ({
      hero: { stats: STATS_ZERO, element: "Air" as const, hp: 100, level: 4 },
      enemy: { stats: STATS_ZERO, element: "Earth" as const, hp: 100, level: 4 },
    });
    const successWorld = makeWorld(actors());
    const success = performAbility(
      { source: "hero", targets: ["enemy"], ability, args: {} },
      successWorld,
      stubRng([0.74]),
      gd,
    );
    expect(success.rngDraws).toBe(1);
    expect(success.results).toEqual([{ target: "enemy", statusApplied: "Confuse" }]);
    expect(successWorld.buffs[0]).toEqual([
      "enemy",
      expect.objectContaining({ duration: 227, statusEffects: ["Confuse"] }),
    ]);

    const failedWorld = makeWorld(actors());
    const failed = performAbility(
      { source: "hero", targets: ["enemy"], ability, args: {} },
      failedWorld,
      stubRng([0.75]),
      gd,
    );
    expect(failed.results).toEqual([]);
    expect(failedWorld.buffs).toEqual([]);
    expect(failedWorld.effectTexts).toEqual([["enemy", { kind: "miss" }]]);
  });

  it("Stun adds native queue delay instead of creating a status buff", () => {
    const ability = gd.ability("Offensive.Stun.Stun");
    const world = makeWorld({
      hero: { stats: STATS_ZERO, element: "Air", hp: 100, level: 1 },
      enemy: { stats: STATS_ZERO, element: "Earth", hp: 100, level: 1 },
    });
    const outcome = performAbility(
      { source: "hero", targets: ["enemy"], ability, args: {} },
      world,
      stubRng([0]),
      gd,
    );
    expect(outcome.results).toEqual([{ target: "enemy", stunDelay: 162 }]);
    expect(world.delays).toEqual([["enemy", 162]]);
    expect(world.stuns).toEqual([["enemy", "hero", 162]]);
    expect(world.buffs).toEqual([]);
  });

  it("Stun consumes its chance draw but does not delay a boss", () => {
    const ability = gd.ability("Offensive.Stun.Stun");
    const world = makeWorld({
      hero: { stats: STATS_ZERO, element: "Air", hp: 100, level: 1 },
      enemy: { stats: STATS_ZERO, element: "Earth", hp: 100, level: 1, boss: true },
    });
    const outcome = performAbility(
      { source: "hero", targets: ["enemy"], ability, args: {} },
      world,
      stubRng([0]),
      gd,
    );
    expect(outcome.rngDraws).toBe(1);
    expect(outcome.results).toEqual([]);
    expect(world.delays).toEqual([]);
  });
});

describe("performAbility - unimplemented components (fail loudly)", () => {
  it("throws UnimplementedComponentError for an unsupported real component class", () => {
    const ability: AbilityDef = {
      path: "Test.Feather",
      className: "CombatAbility",
      components: [{ type: "Utility.Feather" }],
      targetPicker: { enemyTargets: 1 },
      raw: { eventData: { enemyTargetEventData: {} } },
    };
    const world = makeWorld({
      hero: { stats: STATS_ZERO, element: "Air", hp: 100, level: 1 },
      enemy: { stats: STATS_ZERO, element: "Earth", hp: 100, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["enemy"], ability, args: {} };

    expect(() => performAbility(use, world, stubRng([]), gd)).toThrow(UnimplementedComponentError);
    expect(() => performAbility(use, world, stubRng([]), gd)).toThrow(/FeatherAbilityComponent/);
  });

  it("applies a buff-only ability's sourceBuffs list to the caster (Defensive.Scapegoat: no components + sourceBuffs)", () => {


    const ability = gd.ability("Defensive.Scapegoat");
    const world = makeWorld({
      hero: { stats: STATS_ZERO, element: "Air", hp: 100, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["hero"], ability, args: {} };

    performAbility(use, world, stubRng([]), gd);

    expect(world.calls).toEqual([]);
    expect(world.authoredBuffs).toEqual([
      ["hero", { type: "StatOnly", arguments: { duration: 500, targetPriorityAdjustment: 9999 } }, "hero"],
    ]);
  });

  it("throws before mutating world state (no partial HP application)", () => {
    const ability: AbilityDef = {
      path: "Test.AttackThenFeather",
      className: "CombatAbility",
      components: [{ type: "Offensive.Attack" }, { type: "Utility.Feather" }],
      targetPicker: { enemyTargets: 1 },
      raw: { eventData: { enemyTargetEventData: {} } },
    };
    const world = makeWorld({
      hero: { stats: STATS_ZERO, element: "Air", hp: 100, level: 1 },
      enemy: { stats: STATS_ZERO, element: "Earth", hp: 100, level: 1 },
    });
    const use: AbilityUse = { source: "hero", targets: ["enemy"], ability, args: {} };

    expect(() => performAbility(use, world, stubRng([]), gd)).toThrow();
    expect(world.calls).toEqual([]);
  });
});

describe("performAbility - recovered phase and DiceRoller component boundaries", () => {
  it("keeps phase 0 ahead of phase 1 for the equal overdue [0.25, 0.25, 0.75] countdown vector", () => {


    const ability: AbilityDef = {
      path: "Test.EqualOverduePhaseTie",
      className: "CombatAbility",
      components: [
        { type: "Utility.Analyze" },
        { type: "Defensive.Heal" },
        { type: "Offensive.MagicAttack" },
      ],
      raw: {
        eventData: {
          sourceEventData: { startDelay: 0.25 },
          friendlyTargetEventData: { startDelay: 0.25 },
          enemyTargetEventData: { startDelay: 0.75 },
        },
      },
    };
    const world = makeWorld({
      hero: { stats: STATS_ZERO, element: "Fire", hp: 100, level: 1 },
      ally: { stats: STATS_ZERO, element: "Water", hp: 100, level: 1 },
      enemy: { stats: STATS_ZERO, element: "Death", hp: 100, level: 1 },
    });
    const phases: string[] = [];
    world.notifyAbilityEvent = () => phases.push("source");
    world.notifyPhaseResolved = (phase) => phases.push(phase);

    const outcome = performAbility(
      { source: "hero", targets: [], friendlyTargets: ["ally"], enemyTargets: ["enemy"], ability, args: {} },
      world,
      stubRng([0, 0]),
      gd,
    );

    expect(phases).toEqual(["source", "friends", "enemy"]);
    expect(outcome.rngDraws).toBe(2);
  });

  const allFriendsHealing: AbilityDef = {
    path: "Test.AllFriendsHealing",
    className: "CombatAbility",
    components: [{ type: "Defensive.Heal" }],
    targetPicker: { allFriends: true },
    raw: { eventData: { friendlyTargetEventData: { startDelay: 0 } } },
  };

  it("heals every current result in enumeration order with literal numTargets 1 and roundf split amounts", () => {
    // With Magic=12 and U=[0, 0.5, 0.9], the three numTargets=1 DiceRoller values are
    // [11, 12, 13]. At n=3, roundf(roll / (0.7f * 3)) yields [5, 6, 6].
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 12 }, element: "Water", hp: 100, level: 1 },
      a: { stats: STATS_ZERO, element: "Water", hp: 100, level: 1 },
      b: { stats: STATS_ZERO, element: "Water", hp: 100, level: 1 },
      c: { stats: STATS_ZERO, element: "Water", hp: 100, level: 1 },
    });
    const traced = tracingRng([0, 0.5, 0.9]);

    const outcome = performAbility(
      { source: "hero", targets: [], friendlyTargets: ["a", "b", "c"], ability: allFriendsHealing, args: {} },
      world,
      traced.rng,
      gd,
    );

    expect(outcome.results).toEqual([
      { target: "a", hpDelta: 5, element: null },
      { target: "b", hpDelta: 6, element: null },
      { target: "c", hpDelta: 6, element: null },
    ]);
    expect(world.calls).toEqual([
      ["a", 5, "hero"],
      ["b", 6, "hero"],
      ["c", 6, "hero"],
    ]);
    expect(outcome.rngDraws).toBe(3);
    expect(traced.nextCalls).toEqual([0, 0.5, 0.9]);
  });

  it("does not apply the all-target 0.7 divisor to a single healing result", () => {
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 12 }, element: "Water", hp: 100, level: 1 },
      ally: { stats: STATS_ZERO, element: "Water", hp: 100, level: 1 },
    });
    const traced = tracingRng([0]);

    const outcome = performAbility(
      { source: "hero", targets: [], friendlyTargets: ["ally"], ability: allFriendsHealing, args: {} },
      world,
      traced.rng,
      gd,
    );

    expect(outcome.results).toEqual([{ target: "ally", hpDelta: 11, element: null }]);
    expect(world.calls).toEqual([["ally", 11, "hero"]]);
    expect(outcome.rngDraws).toBe(1);
    expect(traced.nextCalls).toEqual([0]);
  });

  it("does not invoke DiceRoller when healing enumerates zero current results", () => {
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 12 }, element: "Water", hp: 100, level: 1 },
    });
    const traced = tracingRng([]);

    const outcome = performAbility(
      { source: "hero", targets: [], friendlyTargets: [], ability: allFriendsHealing, args: {} },
      world,
      traced.rng,
      gd,
    );

    expect(outcome.results).toEqual([]);
    expect(world.calls).toEqual([]);
    expect(outcome.rngDraws).toBe(0);
    expect(traced.nextCalls).toEqual([]);
  });

  it("uses the damage ability's recovered enemy-target count once per friendly all-target result", () => {
    // The caster is friendly, but DamageDealing still reads numberOfEnemyTargets. With
    // Magic=12 and picker enemyTargets=2, U=[0, 0.5, 0.9] yields [6, 7, 8]; substituting
    // the three-result count would instead yield [5, 5, 5].
    const ability: AbilityDef = {
      path: "Test.FriendlyAllTargetDamage",
      className: "CombatAbility",
      components: [{ type: "Offensive.MagicAttack" }],
      targetPicker: { enemyTargets: 2 },
      raw: { eventData: { enemyTargetEventData: { startDelay: 0 } } },
    };
    const world = makeWorld({
      hero: { stats: { ...STATS_ZERO, Magic: 12 }, element: "Fire", hp: 100, level: 1 },
      a: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 100, level: 1 },
      b: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 100, level: 1 },
      c: { stats: { ...STATS_ZERO, Defense: 5, Resist: 5 }, element: "Death", hp: 100, level: 1 },
    });
    const traced = tracingRng([0, 0.5, 0.9]);

    const outcome = performAbility(
      { source: "hero", targets: [], enemyTargets: ["a", "b", "c"], ability, args: {} },
      world,
      traced.rng,
      gd,
    );

    expect(outcome.results).toEqual([
      { target: "a", hpDelta: -6, element: "Fire" },
      { target: "b", hpDelta: -7, element: "Fire" },
      { target: "c", hpDelta: -8, element: "Fire" },
    ]);
    expect(world.calls).toEqual([
      ["a", -6, "hero"],
      ["b", -7, "hero"],
      ["c", -8, "hero"],
    ]);
    expect(outcome.rngDraws).toBe(3);
    expect(traced.nextCalls).toEqual([0, 0.5, 0.9]);
  });
});
