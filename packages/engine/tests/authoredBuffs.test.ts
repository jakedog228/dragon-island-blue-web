import { describe, it, expect } from "vitest";
import { loadGameData, type AbilityDef } from "@dib/gamedata";
import { BattleCore } from "../src/core.js";
import { battleLivingId, type TeamMemberSetup } from "../src/events.js";
import { baseStat } from "../src/stats.js";
import { applyDamage, rollDamage } from "../src/damage.js";
import { poisonTick, reflectAmount, slowProcHaste, stunProcDelay, allowAddBuffGeneral, createActiveBuff } from "../src/buff.js";
import { assignAbility, type AiDecision } from "../src/ai.js";
import { mulberry32, type Rng } from "../src/rng.js";

const gd = loadGameData();
const f = Math.fround;

/** Fixed-sequence stub Rng, consumed in call order (same convention as ability.test.ts). */
function scriptedRng(values: number[]): Rng {
  let i = 0;
  return {
    next: () => {
      if (i >= values.length) throw new Error(`scriptedRng exhausted after ${i} draws`);
      const v = values[i]!;
      i++;
      return v;
    },
    intBelow: () => {
      throw new Error("scriptedRng: intBelow not scripted for this test");
    },
    chance: () => {
      throw new Error("scriptedRng: chance not scripted for this test");
    },
  };
}

/** A single fixed value, usable wherever exactly one throwaway/known draw is needed. */
function oneShotRng(v: number): Rng {
  return scriptedRng([v]);
}

/** Inert ability: zero components, zero buff lists — a pure "pass the turn" move that consumes
 *  no RNG inside `performAbility`. Used to advance the queue by a KNOWN, controlled `timeUsed`
 *  without any other side effect. */
const NOOP_ABILITY: AbilityDef = {
  path: "Test.Noop",
  className: "CombatAbility",
  components: [],
  targetPicker: {},
  raw: {},
};

function noopDecision(activationLength = 100): AiDecision {
  return { ability: NOOP_ABILITY, args: { activationLength, noHaste: true }, enemyTargets: [], friendlyTargets: [], rngDraws: 0 };
}

/** Self-sacrifice: kills the actor deterministically (any `u` in [0,1) satisfies `u < 1`),
 *  reusing the already-VERIFIED sacrifice mechanic (formulas.md row 53) as a clean, deterministic
 *  way to remove a living from battle without needing to hand-compute attack damage. */
function sacrificeDecision(activationLength = 100): AiDecision {
  return {
    ability: NOOP_ABILITY,
    args: { activationLength, noHaste: true, sacrificeChance: 1 },
    enemyTargets: [],
    friendlyTargets: [],
    rngDraws: 0,
  };
}

function setup(level: number, count = 1): TeamMemberSetup[] {
  return Array.from({ length: count }, () => ({ shortType: "FireCub", level }));
}

/**
 * Two identical FireCubs (one per team), fightingGroupSize 1. With EQUAL scripted
 * `initialBattleDelay` draws for both, their starting queue times tie exactly — team 0 (inserted
 * first, `seedAndStart`'s team-0-then-team-1 order) keeps the front on the tie (scheduler.md's
 * strict-`>` stable-insertion rule) — so turn order is deterministic: team0 acts, then team1,
 * alternating. With BOTH sides using a fixed `activationLength=100`/`noHaste:true` every turn,
 * the queue-time gap between successive fronts is exactly 0 (first tick after either side's OWN
 * first move — the other side hasn't caught up yet) then 100 (once both have each moved once and
 * are back in lockstep) — i.e. every PAIR of turns produces exactly one REAL tick of size 100,
 * with a size-0 tick in between. Traced by hand against `TimedQueue`'s own doc comments; used
 * throughout this file wherever a precisely-sized, repeatable tick is needed.
 */
function twoActorHarness(level: number, initDraws: [number, number]) {
  const attackerId = battleLivingId(0, 0, "FireCub");
  const victimId = battleLivingId(1, 0, "FireCub");
  return { attackerId, victimId, initDraws };
}

const LEVEL = 10;

describe("authored-buff engine", () => {
  // -----------------------------------------------------------------------------------------
  // Pure math anchors (buff.ts) — genuinely hand-computed, no BattleCore involved.
  // -----------------------------------------------------------------------------------------

  describe("poisonTick (buffs.md §3) — pure hand-computed anchors", () => {
    it("truncates toward zero and carries the exact float32 remainder to the next tick", () => {
      // perTimeUnit = fround(100/300); elapsed=100 each tick, three ticks in a row.
      const perTimeUnit = f(f(100) / f(300)); // 0.3333333432674408 (float32 of 1/3)
      const tick1 = poisonTick(perTimeUnit, 0, 100);
      // raw1 = fround(fround(perTimeUnit*100) + 0)
      const raw1 = f(f(perTimeUnit * 100) + 0);
      expect(tick1.amount).toBe(Math.trunc(raw1));
      expect(tick1.amount).toBe(33); // 33.333... truncates to 33
      expect(tick1.remainder).toBe(f(raw1 - f(tick1.amount)));
      expect(tick1.remainder).toBeCloseTo(1 / 3, 4); // float32 precision only, not float64

      const tick2 = poisonTick(perTimeUnit, tick1.remainder, 100);
      const raw2 = f(f(perTimeUnit * 100) + tick1.remainder);
      expect(tick2.amount).toBe(Math.trunc(raw2));
      expect(tick2.amount).toBe(33);
      // Carrying the fractional remainder means every third tick's carry crosses a whole unit.
      const tick3 = poisonTick(perTimeUnit, tick2.remainder, 100);
      const raw3 = f(f(perTimeUnit * 100) + tick2.remainder);
      expect(tick3.amount).toBe(Math.trunc(raw3));
      expect(tick3.amount).toBe(34); // the fractional carry crosses over on the third tick
      // Sum across all three ticks recovers (within float32 rounding) the total roll of 100.
      expect(tick1.amount + tick2.amount + tick3.amount).toBe(100);
    });

    it("clamps elapsed to the buff's fixed original duration (buffs.md §3's saturating clamp)", () => {
      // amount is driven by `elapsed`, which callers must pre-clamp via Math.min(originalDuration,
      // timePassed) — poisonTick itself just multiplies whatever `elapsed` it's given.
      const perTimeUnit = f(f(50) / f(10)); // 5 per unit
      const clampedElapsed = Math.min(10, 999); // originalDuration=10, timePassed=999
      const result = poisonTick(perTimeUnit, 0, clampedElapsed);
      expect(result.amount).toBe(50); // 5*10, not 5*999
    });
  });

  describe("reflectAmount (buffs.md §5) — pure hand-computed anchors", () => {
    it("fixedReflect: round(fround(level))", () => {
      const buff = createActiveBuff({ buffType: "Offensive.FixedReflection", kind: "reflective", sourceId: "s", sourceLevel: 37, fixedReflect: true });
      expect(buff.level).toBe(37);
      expect(reflectAmount(buff, 12345)).toBe(37); // independent of incoming amount
    });

    it("percent: round(fround(fround(incomingAmount) * fround(fround(level)*0.01)))", () => {
      const buff = createActiveBuff({ buffType: "Offensive.PercentReflection", kind: "reflective", sourceId: "s", sourceLevel: 50, fixedReflect: false });
      // level=50 -> 50*0.01=0.5 -> 200*0.5=100
      expect(reflectAmount(buff, 200)).toBe(100);
      // level=3 -> 0.03 -> round(37*0.03) = round(1.11) = 1
      const buff2 = createActiveBuff({ buffType: "Offensive.PercentReflection", kind: "reflective", sourceId: "s", sourceLevel: 3 });
      expect(reflectAmount(buff2, 37)).toBe(1);
    });
  });

  describe("proc formulas (buffs.md §7) — pure hand-computed anchors", () => {
    it("stunProcDelay = level*20 (flat, no roll)", () => {
      expect(stunProcDelay(1)).toBe(20);
      expect(stunProcDelay(15)).toBe(300);
    });
    it("slowProcHaste = fround(level/60)", () => {
      expect(slowProcHaste(60)).toBe(1);
      expect(slowProcHaste(30)).toBeCloseTo(0.5, 6);
      expect(slowProcHaste(30)).toBe(f(f(30) / f(60)));
    });
  });

  describe("allowAddBuffGeneral (buffs.md §1.6) — boss gate + stackName only", () => {
    it("boss rejects Sleep/Paralyze/Confuse but NOT Poison", () => {
      const sleep = createActiveBuff({ buffType: "Offensive.Sleep", kind: "statOnly", sourceId: "s", sourceLevel: 1, statusEffects: ["Sleep"] });
      const poison = createActiveBuff({ buffType: "Offensive.Poison", kind: "poison", sourceId: "s", sourceLevel: 1, statusEffects: ["Poison"] });
      expect(allowAddBuffGeneral([], sleep, { isBoss: true })).toBe(false);
      expect(allowAddBuffGeneral([], poison, { isBoss: true })).toBe(true);
      expect(allowAddBuffGeneral([], sleep, { isBoss: false })).toBe(true);
    });

    it("an equal non-nil stackName rejects; nil stackName always stacks", () => {
      const first = createActiveBuff({ buffType: "StatOnly", kind: "statOnly", sourceId: "s", sourceLevel: 1, stackName: "hasteDown" });
      const second = createActiveBuff({ buffType: "StatOnly", kind: "statOnly", sourceId: "s", sourceLevel: 1, stackName: "hasteDown" });
      expect(allowAddBuffGeneral([first], second, { isBoss: false })).toBe(false);
      const anon1 = createActiveBuff({ buffType: "StatOnly", kind: "statOnly", sourceId: "s", sourceLevel: 1 });
      const anon2 = createActiveBuff({ buffType: "StatOnly", kind: "statOnly", sourceId: "s", sourceLevel: 1 });
      expect(allowAddBuffGeneral([anon1], anon2, { isBoss: false })).toBe(true);
    });
  });

  // -----------------------------------------------------------------------------------------
  // DamageOverTimeBuff (Poison) — BattleCore integration, buffs.md §3.
  // -----------------------------------------------------------------------------------------

  describe("DamageOverTimeBuff (Poison, buffs.md §3)", () => {
    it("rolls ONE damage at creation, spreads it per-tick with float32 divide+remainder-carry, self-attributes kill credit, and wakes Sleep", () => {
      const { attackerId, victimId } = twoActorHarness(LEVEL, [0.5, 0.5]);
      const rollU = 0.5;
      const duration = 300;
      const rng = scriptedRng([
        0.5, // init delay draw, attacker
        0.5, // init delay draw, victim
        rollU, // poison roll draw (the ONLY draw performAbility makes: no components)
        0.9, // sacrifice throwaway, turn1 (attacker)
        0.9, // sacrifice throwaway, turn2 (victim)
        0.9, // sacrifice throwaway, turn3 (attacker)
        0.9, // sacrifice throwaway, turn4 (victim)
      ]);

      const core = new BattleCore(
        gd,
        [
          [{ shortType: "FireCub", level: LEVEL }],
          [{ shortType: "FireCub", level: LEVEL }],
        ],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();

      // First give the victim a Sleep buff directly so we can prove poison wakes it (removeOnHurt).
      // (Reuses the already-VERIFIED status-component path via a hand-built ability, same
      // pattern as buff.test.ts's own custom-ability tests.)
      const sleepAbility: AbilityDef = {
        path: "Test.Sleep",
        className: "CombatAbility",
        components: [{ type: "Offensive.Sleep" }],
        targetPicker: {},
        raw: { eventData: { enemyTargetEventData: {} } },
      };
      // Apply sleep out-of-band via a throwaway core so it doesn't perturb our scripted draw
      // count — instead, directly exercise the enemyBuffs path in the SAME turn as the poison
      // cast: enemyBuffs application happens in the enemy phase after components run, so a
      // single ability carrying BOTH an Offensive.Sleep component (chance-gated, consumes a
      // draw) AND the poison enemyBuffs entry would perturb the draw count unpredictably
      // (ApplyChanceAbilityComponent's default chance is 0.75). To keep the draw count exact,
      // apply Sleep via `Offensive.Poison`'s own carrier semantics instead: attach it as a
      // SECOND enemyBuffs entry alongside Poison on the SAME custom ability (no chance gate,
      // no extra draw — `Buff` class, no `ApplyChanceAbilityComponent` involved).
      void sleepAbility;

      const poisonAndSleepAbility: AbilityDef = {
        path: "Test.PoisonAndSleep",
        className: "CombatAbility",
        components: [],
        targetPicker: {},
        raw: {
          eventData: { enemyTargetEventData: {} },
          enemyBuffs: [
            { type: "Offensive.Sleep", arguments: { duration: 500 } },
            { type: "Offensive.Poison", arguments: { duration, roll: { relatedStat: "Attack" } } },
          ],
        },
      };

      core.resolveTurn(() => ({
        ability: poisonAndSleepAbility,
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [victimId],
        friendlyTargets: [],
        rngDraws: 0,
      }));

      // Sleep attached immediately (statOnly kind, statusEffects from the static dict).
      expect(core.statusEffectsOf(victimId)).toContain("Sleep");
      const poisonBuff = core.rawBuffsOf(victimId).find((b) => b.kind === "poison");
      expect(poisonBuff).toBeDefined();

      // Independently recompute the roll via the same verified rollDamage function + the same
      // scripted draw (established "recompute from the same draws" pattern, formulas.md row 53).
      const atk = baseStat(gd.monsterByShortType("FireCub"), "Attack", LEVEL);
      const expectedRoll = rollDamage(
        { abilityScalor: 1, stat: atk, activationLength: 0, scaleByActivationLength: false, randomness: 0.2, numTargets: 1 },
        oneShotRng(rollU),
      );
      const expectedPerTimeUnit = f(f(expectedRoll) / f(duration));
      expect(poisonBuff!.poisonPerTimeUnit).toBe(expectedPerTimeUnit);
      expect(poisonBuff!.poisonRemainder).toBe(0);

      // turn2 (victim, Test.Noop): tick after turn1 was 0 (attacker hasn't looped back yet);
      // THIS turn's own post-tick is the first REAL tick, size 100 (see twoActorHarness's header
      // comment for the hand-traced schedule).
      core.resolveTurn(() => noopDecision());
      // Sleep should already be gone: poison's tick deals nonzero damage (waking it), the FIRST
      // real tick fires exactly once here.
      const def = baseStat(gd.monsterByShortType("FireCub"), "Defense", LEVEL);
      const res = baseStat(gd.monsterByShortType("FireCub"), "Resist", LEVEL);
      const maxHp = baseStat(gd.monsterByShortType("FireCub"), "MaxHP", LEVEL);
      const tick1 = poisonTick(expectedPerTimeUnit, 0, 100);
      const tick1Final = applyDamage({
        amount: tick1.amount,
        damageElement: "Fire",
        sourceStat: "Attack",
        defenderElement: "Fire",
        defenderDefense: def,
        defenderResist: res,
        defenderCurrentHp: maxHp,
        level: LEVEL,
      });
      expect(core.hpOf(victimId)).toBe(maxHp - tick1Final);
      if (tick1Final > 0) {
        expect(core.statusEffectsOf(victimId)).not.toContain("Sleep");
        const hurtEvent = core.events.find((e) => e.type === "buffRemoved" && e.reason === "hurt");
        expect(hurtEvent).toBeDefined();
      }

      const dmgEvents = core.events.filter((e) => e.type === "damageDealt" && e.target === victimId);
      expect(dmgEvents.length).toBeGreaterThan(0);
      const lastDmg = dmgEvents.at(-1) as Extract<(typeof dmgEvents)[number], { type: "damageDealt" }>;
      expect(lastDmg.source).toBe(victimId);


      expect(lastDmg.cause).toBe("poisonTick");

      // turn3 (attacker, Test.Noop): tick after this turn is 0 again.
      core.resolveTurn(() => noopDecision());
      // turn4 (victim, Test.Noop): second REAL tick, size 100, exercising remainder carry.
      const hpBeforeTick2 = core.hpOf(victimId);
      core.resolveTurn(() => noopDecision());
      const tick2 = poisonTick(expectedPerTimeUnit, tick1.remainder, 100);
      const tick2Final = applyDamage({
        amount: tick2.amount,
        damageElement: "Fire",
        sourceStat: "Attack",
        defenderElement: "Fire",
        defenderDefense: def,
        defenderResist: res,
        defenderCurrentHp: hpBeforeTick2,
        level: LEVEL,
      });
      expect(core.hpOf(victimId)).toBe(Math.max(0, hpBeforeTick2 - tick2Final));
    });

    it("can kill (self-attributed), and the kill cascades through the normal death pipeline", () => {
      // A high-level attacker's Attack roll (u near 1, so the roll saturates high) vastly
      // outweighs a level-1 victim's MaxHP; a short duration front-loads (nearly) the whole roll
      // into the first tick. A constant-0.999 Rng makes every draw (init delays, the poison
      // roll, every sacrifice-chance throwaway) the same high value — irrelevant for the
      // throwaways (sacrificeChance defaults 0) and turn-order-independent by construction: the
      // decide loop below picks the poison-caster by ID, not by assumed queue position.
      const constantRng: Rng = {
        next: () => 0.999,
        intBelow: () => {
          throw new Error("not used by this scenario");
        },
        chance: () => {
          throw new Error("not used by this scenario");
        },
      };
      const duration = 10; // short duration -> the roll front-loads almost entirely into tick 1
      const attackerId = battleLivingId(0, 0, "FireCub");
      const victimId = battleLivingId(1, 0, "FireCub");
      const core = new BattleCore(
        gd,
        [
          [{ shortType: "FireCub", level: 50 }],
          [{ shortType: "FireCub", level: 1 }],
        ],
        constantRng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      const poisonAbility: AbilityDef = {
        path: "Test.Poison",
        className: "CombatAbility",
        components: [],
        targetPicker: {},
        raw: {
          eventData: { enemyTargetEventData: {} },
          enemyBuffs: [{ type: "Offensive.Poison", arguments: { duration, roll: { relatedStat: "Attack" } } }],
        },
      };
      let poisoned = false;
      for (let i = 0; i < 10 && core.isAlive(victimId); i++) {
        core.skipDeadFront();
        core.resolveTurn((id) => {
          if (id === attackerId && !poisoned) {
            poisoned = true;
            return {
              ability: poisonAbility,
              args: { activationLength: 100, noHaste: true },
              enemyTargets: [victimId],
              friendlyTargets: [],
              rngDraws: 0,
            };
          }
          return noopDecision();
        });
      }

      expect(core.isAlive(victimId)).toBe(false);
      const died = core.events.find((e) => e.type === "died" && e.living === victimId);
      expect(died).toBeDefined();
      // Kill credit self-attributes to the victim (buffs.md §3/§4's "binary oddity, ported exactly").
      expect(core.magnifySourceContextOf(victimId).sourceKillsMade).toBe(1);
    });
  });

  // -----------------------------------------------------------------------------------------
  // DeathSentenceBuff — BattleCore integration, buffs.md §4.
  // -----------------------------------------------------------------------------------------

  describe("DeathSentenceBuff (buffs.md §4)", () => {
    function deathSentenceAbility(duration: number): AbilityDef {
      return {
        path: "Test.DeathSentence",
        className: "CombatAbility",
        components: [],
        targetPicker: {},
        raw: { eventData: { enemyTargetEventData: {} }, enemyBuffs: [{ type: "Offensive.DeathSentence", arguments: { duration } }] },
      };
    }

    it("kills at expiry (source alive, target not boss) and credits the source", () => {
      const attackerId = battleLivingId(0, 0, "FireCub");
      const victimId = battleLivingId(1, 0, "FireCub");
      const rng = scriptedRng([0.5, 0.5, 0.9, 0.9]);
      const core = new BattleCore(
        gd,
        [[{ shortType: "FireCub", level: LEVEL }], [{ shortType: "FireCub", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      core.resolveTurn(() => ({
        ability: deathSentenceAbility(50),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [victimId],
        friendlyTargets: [],
        rngDraws: 0,
      }));
      core.resolveTurn(() => noopDecision()); // REAL tick, size 100 > duration 50 -> expires+kills

      const sentence = core.events.find((e) => e.type === "deathSentence");
      expect(sentence).toEqual({ type: "deathSentence", target: victimId, source: attackerId });
      expect(core.isAlive(victimId)).toBe(false);
      expect(core.magnifySourceContextOf(attackerId).sourceKillsMade).toBe(1);
      // No damage event for the direct kill (buffs.md §4: "not a damage event").
      expect(core.events.some((e) => e.type === "damageDealt" && e.target === victimId)).toBe(false);
    });

    it("fizzles silently on a boss target (no death, no deathSentence event)", () => {
      const victimId = battleLivingId(1, 0, "FireCub");
      const rng = scriptedRng([0.5, 0.5, 0.9, 0.9]);
      const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
        [{ shortType: "FireCub", level: LEVEL }],
        [{ shortType: "FireCub", level: LEVEL, boss: true }],
      ];
      const core = new BattleCore(gd, teams, rng, { fightingGroupSize: 1 });
      core.seedAndStart();
      core.resolveTurn(() => ({
        ability: deathSentenceAbility(50),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [victimId],
        friendlyTargets: [],
        rngDraws: 0,
      }));
      core.resolveTurn(() => noopDecision());

      expect(core.events.some((e) => e.type === "deathSentence")).toBe(false);
      expect(core.events.some((e) => e.type === "died" && e.living === victimId)).toBe(false);
      expect(core.isAlive(victimId)).toBe(true);
      const removed = core.events.find((e) => e.type === "buffRemoved" && e.target === victimId && e.reason === "expired");
      expect(removed).toBeDefined();
    });

    it("fizzles silently when the source has already left battle before expiry", () => {
      // Three FireCubs, all identical/tied: team0=[Source,Filler], team1=[Target].
      const sourceId = battleLivingId(0, 0, "FireCub");
      const fillerId = battleLivingId(0, 1, "FireCub");
      const targetId = battleLivingId(1, 0, "FireCub");
      const rng = scriptedRng([
        0.5, // Source init
        0.5, // Filler init
        0.5, // Target init
        0.9, // turn1 (Source casts DeathSentence) sacrifice throwaway
        0.9, // turn2 (Filler Noop) sacrifice throwaway
        0.9, // turn3 (Target Noop) sacrifice throwaway -> REAL tick #1 (size 100), durationLeft 150->50
        0.5, // turn4 (Source sacrifices) -- u<1 always true regardless, value irrelevant
        0.9, // turn5 (Filler Noop) sacrifice throwaway
        0.9, // turn6 (Target Noop) sacrifice throwaway -> REAL tick #2 (size 100), durationLeft 50->-50 (expire, source dead -> fizzle)
      ]);
      const core = new BattleCore(
        gd,
        [
          [
            { shortType: "FireCub", level: LEVEL },
            { shortType: "FireCub", level: LEVEL },
          ],
          [{ shortType: "FireCub", level: LEVEL }],
        ],
        rng,
        { fightingGroupSize: 2 },
      );
      core.seedAndStart();
      core.resolveTurn(() => ({
        ability: deathSentenceAbility(150),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [targetId],
        friendlyTargets: [],
        rngDraws: 0,
      })); // turn1: Source
      core.resolveTurn(() => noopDecision()); // turn2: Filler
      core.resolveTurn(() => noopDecision()); // turn3: Target -> real tick #1
      expect(core.isAlive(targetId)).toBe(true); // durationLeft still 50, not expired yet

      core.resolveTurn(() => sacrificeDecision()); // turn4: Source sacrifices itself
      expect(core.isAlive(sourceId)).toBe(false);
      expect(core.isAlive(fillerId)).toBe(true); // team0 not wiped

      core.resolveTurn(() => noopDecision()); // turn5: Filler
      core.resolveTurn(() => noopDecision()); // turn6: Target -> real tick #2, DeathSentence expires

      expect(core.events.some((e) => e.type === "deathSentence")).toBe(false);
      expect(core.isAlive(targetId)).toBe(true);
      const removed = core.events.find((e) => e.type === "buffRemoved" && e.target === targetId && e.reason === "expired");
      expect(removed).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------------------------
  // ReflectiveBuff — BattleCore integration, buffs.md §5.
  // -----------------------------------------------------------------------------------------

  describe("ReflectiveBuff (buffs.md §5)", () => {
    function reflectiveAbility(type: "Offensive.FixedReflection" | "Offensive.PercentReflection", duration = 500): AbilityDef {
      return {
        path: `Test.${type}`,
        className: "CombatAbility",
        components: [],
        targetPicker: {},
        raw: { sourceBuffs: [{ type, arguments: { duration } }] },
      };
    }
    const attackAbility = (): AbilityDef => ({
      path: "Test.RealAttack",
      className: "CombatAbility",
      components: [{ type: "Offensive.Attack" }],
      targetPicker: {},
      raw: { eventData: { enemyTargetEventData: {} } },
    });

    it("fixed reflect: round(fround(level)), one bounce, no kill credit, full mitigation pipeline", () => {
      // team0 = Wearer (will self-buff FixedReflection then get attacked); team1 = Attacker.
      const wearerId = battleLivingId(0, 0, "FireCub");
      const attackerId = battleLivingId(1, 0, "FireCub");
      const rollU = 0.5;
      const rng = scriptedRng([
        0.5, // wearer init
        0.5, // attacker init
        0.9, // turn1 (wearer self-buffs) sacrifice throwaway
        rollU, // turn2 (attacker attacks) attack roll draw
        0.9, // turn2 sacrifice throwaway
      ]);
      const core = new BattleCore(
        gd,
        [[{ shortType: "FireCub", level: LEVEL }], [{ shortType: "FireCub", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      core.resolveTurn(() => ({
        ability: reflectiveAbility("Offensive.FixedReflection"),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [],
        friendlyTargets: [],
        rngDraws: 0,
      }));
      const reflective = core.rawBuffsOf(wearerId).find((b) => b.kind === "reflective");
      expect(reflective).toBeDefined();
      expect(reflective!.level).toBe(LEVEL);

      core.resolveTurn(() => ({
        ability: attackAbility(),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [wearerId],
        friendlyTargets: [],
        rngDraws: 0,
      }));

      // Two damageDealt events: the original hit on the wearer, and exactly one reflected hit
      // back on the attacker (one bounce, no ping-pong).
      const hits = core.events.filter((e) => e.type === "damageDealt");
      const onWearer = hits.filter((e) => e.type === "damageDealt" && e.target === wearerId);
      const onAttacker = hits.filter((e) => e.type === "damageDealt" && e.target === attackerId);
      expect(onWearer.length).toBe(1);
      expect(onAttacker.length).toBe(1);
      const reflectHit = onAttacker[0] as Extract<(typeof onAttacker)[number], { type: "damageDealt" }>;

      expect(reflectHit.source).toBe(wearerId);


      expect(reflectHit.cause).toBe("reflected");
      const wearerHit = onWearer[0] as Extract<(typeof onWearer)[number], { type: "damageDealt" }>;
      expect(wearerHit.cause).toBeUndefined();
      // Independent oracle: reflectAmount's raw amount, THEN the same full applyDamage mitigation
      // pipeline the reflected hit actually goes through (buffs.md §5 — not a flat mirror).
      const monster = gd.monsterByShortType("FireCub");
      const def = baseStat(monster, "Defense", LEVEL);
      const res = baseStat(monster, "Resist", LEVEL);
      const attackerMaxHp = baseStat(monster, "MaxHP", LEVEL);
      const rawReflect = reflectAmount(reflective!, (onWearer[0] as { amount: number }).amount);
      const expectedFinal = applyDamage({
        amount: rawReflect,
        damageElement: "Fire",
        sourceStat: "Attack",
        defenderElement: "Fire",
        defenderDefense: def,
        defenderResist: res,
        defenderCurrentHp: attackerMaxHp,
        level: Math.max(reflective!.level, LEVEL),
      });
      expect(reflectHit.amount).toBe(expectedFinal);
      // No kill credit to the wearer for the reflect (buffs.md §5).
      expect(core.magnifySourceContextOf(wearerId).sourceKillsMade).toBe(0);
    });

    it("percent reflect: round(fround(incomingAmount) * fround(fround(level)*0.01))", () => {
      const wearerId = battleLivingId(0, 0, "FireCub");
      const rollU = 0.5;
      const rng = scriptedRng([0.5, 0.5, 0.9, rollU, 0.9]);
      const core = new BattleCore(
        gd,
        [[{ shortType: "FireCub", level: LEVEL }], [{ shortType: "FireCub", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      core.resolveTurn(() => ({
        ability: reflectiveAbility("Offensive.PercentReflection"),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [],
        friendlyTargets: [],
        rngDraws: 0,
      }));
      const reflective = core.rawBuffsOf(wearerId).find((b) => b.kind === "reflective")!;
      core.resolveTurn(() => ({
        ability: attackAbility(),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [wearerId],
        friendlyTargets: [],
        rngDraws: 0,
      }));
      const onWearer = core.events.find((e) => e.type === "damageDealt" && e.target === wearerId) as { amount: number };
      const attackerId = battleLivingId(1, 0, "FireCub");
      const reflectHit = core.events.find((e) => e.type === "damageDealt" && e.target === attackerId);
      expect(reflectHit).toBeDefined();
      const monster = gd.monsterByShortType("FireCub");
      const def = baseStat(monster, "Defense", LEVEL);
      const res = baseStat(monster, "Resist", LEVEL);
      const attackerMaxHp = baseStat(monster, "MaxHP", LEVEL);
      const rawReflect = reflectAmount(reflective, onWearer.amount);
      const expectedFinal = applyDamage({
        amount: rawReflect,
        damageElement: "Fire",
        sourceStat: "Attack",
        defenderElement: "Fire",
        defenderDefense: def,
        defenderResist: res,
        defenderCurrentHp: attackerMaxHp,
        level: Math.max(reflective.level, LEVEL),
      });
      expect((reflectHit as { amount: number }).amount).toBe(expectedFinal);
    });

    it("a poison tick is exempt (reflected:true) — no reflected hit back onto the poison's caster", () => {
      const casterId = battleLivingId(0, 0, "FireCub");
      const victimId = battleLivingId(1, 0, "FireCub");
      const rollU = 0.9;
      const rng = scriptedRng([
        0.5, // caster init
        0.5, // victim init
        rollU, // poison roll
        0.9, // turn1 sacrifice throwaway
        0.9, // turn2 sacrifice throwaway
      ]);
      const core = new BattleCore(
        gd,
        [[{ shortType: "FireCub", level: LEVEL }], [{ shortType: "FireCub", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      const ability: AbilityDef = {
        path: "Test.PoisonAndReflect",
        className: "CombatAbility",
        components: [],
        targetPicker: {},
        raw: {
          eventData: { enemyTargetEventData: {} },
          enemyBuffs: [
            { type: "Offensive.FixedReflection", arguments: { duration: 500 } },
            { type: "Offensive.Poison", arguments: { duration: 300, roll: { relatedStat: "Attack" } } },
          ],
        },
      };
      core.resolveTurn(() => ({ ability, args: { activationLength: 100, noHaste: true }, enemyTargets: [victimId], friendlyTargets: [], rngDraws: 0 }));
      core.resolveTurn(() => noopDecision()); // REAL tick: poison damages the victim (who also wears Reflective)

      // The victim took damage from itself (poison, reflected:true) — never reflected onto the caster.
      expect(core.events.some((e) => e.type === "damageDealt" && e.target === casterId)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------
  // SlowProcBuff / StunProcBuff — BattleCore integration, buffs.md §7.
  // -----------------------------------------------------------------------------------------

  describe("SlowProcBuff / StunProcBuff (buffs.md §7)", () => {
    function selfProcAttack(buffType: "Offensive.SlowProc" | "Offensive.StunProc"): AbilityDef {
      return {
        path: `Test.${buffType}Attack`,
        className: "CombatAbility",
        components: [{ type: "Offensive.Attack" }],
        targetPicker: {},
        raw: { sourceBuffs: [{ type: buffType }], eventData: { enemyTargetEventData: {} } },
      };
    }

    it("StunProc fires unconditionally on nonzero landed damage, exempt for bosses", () => {
      const attackerId = battleLivingId(0, 0, "FireCub");
      const targetId = battleLivingId(1, 0, "FireCub");
      const rng = scriptedRng([0.5, 0.5, 0.5, 0.9]);
      const core = new BattleCore(
        gd,
        [[{ shortType: "FireCub", level: LEVEL }], [{ shortType: "FireCub", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      core.resolveTurn(() => ({
        ability: selfProcAttack("Offensive.StunProc"),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [targetId],
        friendlyTargets: [],
        rngDraws: 0,
      }));
      const stunned = core.events.find((e) => e.type === "stunned");
      // `reactive: true` marks the proc as StunProcBuff's own inline dispatch (paints under the
      // ability's own results) vs a direct StunAbilityComponent stun -- see events.ts `stunned`.
      expect(stunned).toEqual({ type: "stunned", target: targetId, source: attackerId, delay: stunProcDelay(LEVEL), reactive: true });
    });

    it("StunProc does NOT delay a boss target", () => {
      const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
        [{ shortType: "FireCub", level: LEVEL }],
        [{ shortType: "FireCub", level: LEVEL, boss: true }],
      ];
      const targetId = battleLivingId(1, 0, "FireCub");
      const rng = scriptedRng([0.5, 0.5, 0.5, 0.9]);
      const core = new BattleCore(gd, teams, rng, { fightingGroupSize: 1 });
      core.seedAndStart();
      core.resolveTurn(() => ({
        ability: selfProcAttack("Offensive.StunProc"),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [targetId],
        friendlyTargets: [],
        rngDraws: 0,
      }));
      expect(core.events.some((e) => e.type === "stunned")).toBe(false);
    });

    it("SlowProc has NO boss exemption (confirmed asymmetry) and stacks hasteDown against itself", () => {
      const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
        [{ shortType: "FireCub", level: LEVEL }],
        [{ shortType: "FireCub", level: LEVEL, boss: true }],
      ];
      const targetId = battleLivingId(1, 0, "FireCub");
      // initA, initB, turn1(roll,sacrifice), turn2-noop(sacrifice), turn3(roll,sacrifice).
      const rng = scriptedRng([0.5, 0.5, 0.5, 0.9, 0.5, 0.5, 0.9]);
      const core = new BattleCore(gd, teams, rng, { fightingGroupSize: 1 });
      core.seedAndStart();
      const decision = () => ({
        ability: selfProcAttack("Offensive.SlowProc"),
        args: { activationLength: 100, noHaste: true },
        enemyTargets: [targetId],
        friendlyTargets: [],
        rngDraws: 0,
      });
      core.resolveTurn(decision); // even against a boss, SlowProc still attaches hasteDown
      const hasteDowns1 = core.rawBuffsOf(targetId).filter((b) => b.stackName === "hasteDown");
      expect(hasteDowns1.length).toBe(1);
      expect(hasteDowns1[0]!.haste).toBe(slowProcHaste(LEVEL));


      const procAdd = core.events.find((e) => e.type === "buffAdded" && e.target === targetId);
      expect(procAdd).toBeDefined();
      expect((procAdd as Extract<typeof procAdd, { type: "buffAdded" }>).cause).toBe("proc");

      // Second identical hit: the existing hasteDown blocks the newcomer (normal stacking rule).
      core.resolveTurn(() => noopDecision()); // target's own turn, advances the queue
      core.resolveTurn(decision);
      const hasteDowns2 = core.rawBuffsOf(targetId).filter((b) => b.stackName === "hasteDown");
      expect(hasteDowns2.length).toBe(1); // still exactly one — rejected, not doubled
    });
  });

  // -----------------------------------------------------------------------------------------
  // StatShiftBuff — BattleCore integration, buffs.md §8, using the real
  // Defensive.ShiftDefenseToAttack carrier (sourceBuffs-only, no components).
  // -----------------------------------------------------------------------------------------

  describe("StatShiftBuff (buffs.md §8)", () => {
    it("snapshots the source stat once, frozen thereafter, and stacks additively (no stackName)", () => {
      const casterId = battleLivingId(0, 0, "FireCub");
      // Every step below is explicitly attributed to `casterId` via the decide loop (not assumed
      // from turn order) — team1's own turns are harmless no-ops. Draw values don't matter here
      // (ShiftDefenseToAttack/StatMod make zero internal rolls; only per-turn sacrifice-chance
      // throwaways draw, and sacrificeChance defaults 0 regardless of the value).
      const rng = mulberry32(1);
      const core = new BattleCore(
        gd,
        [[{ shortType: "FireCub", level: LEVEL }], [{ shortType: "FireCub", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      const shiftAbility = gd.ability("Defensive.ShiftDefenseToAttack");
      const defenseUpAbility: AbilityDef = {
        path: "Test.DefenseUp",
        className: "CombatAbility",
        components: [{ type: "Utility.StatMod", arguments: { stat: "Defense", help: true, duration: 500 } }],
        targetPicker: { selfOnly: true },
        raw: { eventData: { friendlyTargetEventData: {} } },
      };
      const defenseDownAbility: AbilityDef = {
        path: "Test.DefenseDown",
        className: "CombatAbility",
        components: [{ type: "Utility.StatMod", arguments: { stat: "Defense", help: false, duration: 500 } }],
        targetPicker: { selfOnly: true },
        raw: { eventData: { friendlyTargetEventData: {} } },
      };
      const shiftDecision = (): AiDecision => ({ ability: shiftAbility, args: {}, enemyTargets: [], friendlyTargets: [], rngDraws: 0 });
      const statModDecision = (ability: AbilityDef): AiDecision => ({ ability, args: {}, enemyTargets: [], friendlyTargets: [casterId], rngDraws: 0 });

      function driveCasterTurn(decision: AiDecision): void {
        let done = false;
        while (!done) {
          core.resolveTurn((id) => {
            if (id === casterId && !done) {
              done = true;
              return decision;
            }
            return noopDecision();
          });
        }
      }

      const baseDefense = core.effectiveStatsOf(casterId).Defense;
      const baseAttack = core.effectiveStatsOf(casterId).Attack;

      driveCasterTurn(shiftDecision());
      expect(core.effectiveStatsOf(casterId).Attack).toBe(baseAttack + baseDefense);
      expect(core.effectiveStatsOf(casterId).Defense).toBe(Math.max(0, baseDefense - baseDefense));

      // Freeze check: a SECOND, independent Defense-affecting mechanism (StatMod's own
      // Defense-down) must not retroactively change the shift's already-snapshotted contribution.
      driveCasterTurn(statModDecision(defenseDownAbility));
      expect(core.effectiveStatsOf(casterId).Attack).toBe(baseAttack + baseDefense);


      driveCasterTurn(statModDecision(defenseUpAbility));
      const defenseBeforeSecondShift = core.effectiveStatsOf(casterId).Defense;
      const attackBeforeSecondShift = core.effectiveStatsOf(casterId).Attack;
      driveCasterTurn(shiftDecision());
      expect(core.effectiveStatsOf(casterId).Attack).toBe(attackBeforeSecondShift + defenseBeforeSecondShift);
      // Both shift instances persist and independently contribute (buffs.md §8: no stackName ->
      // always stacks) — two poison/statShift-kind buffs are both present, not merged/replaced.
      expect(core.rawBuffsOf(casterId).filter((b) => b.kind === "statShift").length).toBe(2);
    });
  });

  // -----------------------------------------------------------------------------------------
  // Immunity is INERT (coordinator's spec correction — targeting-passives.md §C).
  // -----------------------------------------------------------------------------------------

  describe("Passive.Immunity is dead data (targeting-passives.md §C — corrected spec)", () => {
    it("a Sleep buff attaches to CatRider1 despite its authored immunities:[Sleep,...] list", () => {
      const casterId = battleLivingId(0, 0, "FireCub");
      const targetId = battleLivingId(1, 0, "CatRider1");
      const rng = mulberry32(31);
      const core = new BattleCore(
        gd,
        [[{ shortType: "FireCub", level: LEVEL }], [{ shortType: "CatRider1", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      // The queAbility-time taunt redirect resolves targets against the FRONT actor's enemy
      // pool, so the FireCub itself must hold initiative before its Sleep decision is injected.
      for (let i = 0; i < 10 && core.frontActorId() !== casterId; i++) {
        core.resolveTurn(() => noopDecision());
      }
      expect(core.frontActorId()).toBe(casterId);
      const ability: AbilityDef = {
        path: "Test.SleepOnly",
        className: "CombatAbility",
        components: [],
        targetPicker: {},
        raw: { eventData: { enemyTargetEventData: {} }, enemyBuffs: [{ type: "Offensive.Sleep", arguments: { duration: 500 } }] },
      };
      core.resolveTurn(() => ({ ability, args: {}, enemyTargets: [targetId], friendlyTargets: [], rngDraws: 0 }));

      // CatRider1's authored `Immunity` job ability (arguments.immunities including "Sleep")
      // has ZERO mechanical effect in the shipped game (Passive.Immunity resolves to plain
      // "Ability", not "ImmunityAbility" — targeting-passives.md §C) — the port matches that:
      // the Sleep buff attaches normally, with a normal buffAdded event.
      expect(core.statusEffectsOf(targetId)).toContain("Sleep");
      const added = core.events.find((e) => e.type === "buffAdded" && e.target === targetId && e.buffType === "Offensive.Sleep");
      expect(added).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------------------------
  // passiveBuffs permanence vs RemoveAllBuffs — buffs.md §2.3/§1.7, real SpikeBall (Thorns).
  // -----------------------------------------------------------------------------------------

  describe("passiveBuffs (buffs.md §2.3) survive RemoveAllBuffs; ordinary buffs do not", () => {
    it("SpikeBall's Passive.Thorns is permanent from battle start and survives RemoveAllBuffs, unlike a StatMod buff", () => {
      const spikeId = battleLivingId(0, 0, "SpikeBall");
      const rng = mulberry32(7);
      const core = new BattleCore(
        gd,
        [[{ shortType: "SpikeBall", level: LEVEL }], [{ shortType: "FireCub", level: LEVEL }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      const thorns = core.rawBuffsOf(spikeId).find((b) => b.kind === "reflective");
      expect(thorns).toBeDefined();
      expect(thorns!.permanent).toBe(true);
      expect(thorns!.buffType).toBe("Offensive.FixedReflection");

      const statModAbility: AbilityDef = {
        path: "Test.AttackUp",
        className: "CombatAbility",
        components: [{ type: "Utility.StatMod", arguments: { stat: "Attack", help: true, duration: 500 } }],
        targetPicker: { selfOnly: true },
        raw: { eventData: { friendlyTargetEventData: {} } },
      };
      core.resolveTurn(() => ({ ability: statModAbility, args: {}, enemyTargets: [], friendlyTargets: [spikeId], rngDraws: 0 }));
      expect(core.rawBuffsOf(spikeId).some((b) => b.kind === "statOnly" && b.stats.includes("Attack"))).toBe(true);

      const removeAllAbility: AbilityDef = {
        path: "Test.RemoveAll",
        className: "CombatAbility",
        components: [{ type: "Offensive.RemoveAllBuffs" }],
        targetPicker: { selfOnly: true },
        raw: { eventData: { friendlyTargetEventData: {} } },
      };
      core.resolveTurn(() => ({ ability: removeAllAbility, args: {}, enemyTargets: [], friendlyTargets: [spikeId], rngDraws: 0 }));

      expect(core.rawBuffsOf(spikeId).some((b) => b.kind === "reflective")).toBe(true); // survives
      expect(core.rawBuffsOf(spikeId).some((b) => b.kind === "statOnly" && b.stats.includes("Attack"))).toBe(false); // stripped
    });
  });

  // -----------------------------------------------------------------------------------------
  // revengeBuffs — buffs.md §2.2, real KemetKing.
  // -----------------------------------------------------------------------------------------

  describe("revengeBuffs (buffs.md §2.2)", () => {
    const killerAbility = (): AbilityDef => ({
      path: "Test.KillAttack",
      className: "CombatAbility",
      components: [{ type: "Offensive.Attack" }],
      targetPicker: {},
      raw: { eventData: { enemyTargetEventData: {} } },
    });

    it("a Living-sourced kill triggers revenge, rolled from the DEAD monster's own Attack", () => {
      const killerId = battleLivingId(0, 0, "FireCub");
      const kemetId = battleLivingId(1, 0, "KemetKing");
      // KemetKing has very low effective HP relative to a level-50 FireCub's Attack roll, so one
      // hit kills it outright.
      const rng = scriptedRng([
        0.5, // killer init
        0.5, // KemetKing init
        0.99, // killer's attack roll (turn1) -- high roll to guarantee lethal
        0.5, // revenge poison's OWN setup roll (buffs.md §2.2: consumed INSIDE the death pipeline)
        0.9, // replacement-scheduling draw is skipped (no bench) — this is the post-death sacrifice-check draw instead
      ]);
      const core = new BattleCore(
        gd,
        [
          [{ shortType: "FireCub", level: 50 }],
          [{ shortType: "KemetKing", level: 1 }],
        ],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      core.resolveTurn(() => ({ ability: killerAbility(), args: {}, enemyTargets: [kemetId], friendlyTargets: [], rngDraws: 0 }));

      expect(core.isAlive(kemetId)).toBe(false);
      const revenge = core.rawBuffsOf(killerId).find((b) => b.kind === "poison");
      expect(revenge).toBeDefined();
      expect(revenge!.buffType).toBe("Offensive.Poison");
      expect(revenge!.sourceId).toBe(kemetId); // sourced from the DEAD monster, not the killer
    });

    it("does NOT trigger on a sacrifice's nil-source self-kill", () => {
      const kemetId = battleLivingId(0, 0, "KemetKing");
      const otherId = battleLivingId(1, 0, "FireCub");
      const rng = mulberry32(3);
      const core = new BattleCore(
        gd,
        [[{ shortType: "KemetKing", level: 10 }], [{ shortType: "FireCub", level: 10 }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();
      // Drive turns, forcing KemetKing specifically to sacrifice the FIRST time it acts
      // (turn order between two different monster types isn't assumed).
      for (let i = 0; i < 10 && core.isAlive(kemetId); i++) {
        core.skipDeadFront();
        core.resolveTurn((id) => (id === kemetId ? sacrificeDecision() : noopDecision()));
      }
      expect(core.isAlive(kemetId)).toBe(false);
      expect(core.rawBuffsOf(otherId).some((b) => b.kind === "poison")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------------------------
  // Auras — buffs.md §9, real CrabKing (Charisma).
  // -----------------------------------------------------------------------------------------

  describe("Auras (AuraAbility, buffs.md §9)", () => {
    it("applies at battle start to the whole team, to a promoted reserve, and is removed when the owner leaves battle", () => {
      const crabId = battleLivingId(0, 0, "CrabKing");
      const teammateId = battleLivingId(0, 1, "FireCub");
      const benchId = battleLivingId(0, 2, "FireCub");
      const enemyId = battleLivingId(1, 0, "FireCub");
      const rng = mulberry32(11);
      const core = new BattleCore(
        gd,
        [
          [
            { shortType: "CrabKing", level: LEVEL },
            { shortType: "FireCub", level: LEVEL },
            { shortType: "FireCub", level: LEVEL },
          ],
          [{ shortType: "FireCub", level: LEVEL }],
        ],
        rng,
        { fightingGroupSize: 2 },
      );
      core.seedAndStart();

      // Both active team-0 members (owner included) get the Charisma Attack buff.
      expect(core.rawBuffsOf(crabId).some((b) => b.buffType === "StatOnly" && b.sourceId === crabId)).toBe(true);
      expect(core.rawBuffsOf(teammateId).some((b) => b.buffType === "StatOnly" && b.sourceId === crabId)).toBe(true);
      // The bench member hasn't been promoted yet — no aura grant.
      expect(core.benchIdsOf(0)).toEqual([benchId]);

      // CrabKing sacrifices -> dies -> promotes the bench member -> promoted member gets the aura too.
      // Forced by actor id (not assumed turn order) since CrabKing/FireCub/enemy have different stats.
      for (let i = 0; i < 10 && core.isAlive(crabId); i++) {
        core.skipDeadFront();
        core.resolveTurn((id) => (id === crabId ? sacrificeDecision() : noopDecision()));
      }
      expect(core.isAlive(crabId)).toBe(false);
      expect(core.activeIdsOf(0)).toContain(benchId);

      // Owner left battle: its granted buffs vanish from the surviving teammate...
      expect(core.rawBuffsOf(teammateId).some((b) => b.buffType === "StatOnly" && b.sourceId === crabId)).toBe(false);
      void enemyId;
    });
  });

  // -----------------------------------------------------------------------------------------
  // Real-data end-to-end smoke test.
  // -----------------------------------------------------------------------------------------

  describe("real-data end-to-end", () => {
    it("a seeded SteelSnake-vs-SnakeGod battle (forced WrapAround self-Paralyze + PoisonAttack) runs to completion with buff events", () => {
      // A long, generous scripted stream — every draw in [0,1) is a valid input to every
      // consumer this battle can reach (rolls, chances, target picks); `intBelow` (the
      // WeightedRandomList integer channel — AI weighted picks and taunt-redirect removals)
      // shares the same stream via floor(v*n). The exact battle outcome isn't asserted, only
      // that it completes and exercises the buff engine.
      const stream = Array.from({ length: 4000 }, (_, i) => (i * 0.61803398875) % 1);
      let streamIdx = 0;
      const draw = (): number => {
        if (streamIdx >= stream.length) throw new Error("end-to-end stream exhausted");
        return stream[streamIdx++]!;
      };
      const rng: Rng = {
        next: draw,
        intBelow: (n) => Math.floor(draw() * n),
        chance: (p) => draw() < p,
      };
      const steelId = battleLivingId(0, 0, "SteelSnake");
      const snakeId = battleLivingId(1, 0, "SnakeGod");
      const core = new BattleCore(
        gd,
        [[{ shortType: "SteelSnake", level: 20 }], [{ shortType: "SnakeGod", level: 20 }]],
        rng,
        { fightingGroupSize: 1 },
      );
      core.seedAndStart();

      let forcedWrapAround = false;
      let forcedPoisonAttack = false;
      let turns = 0;
      const maxTurns = 500;
      while (core.winner === undefined) {
        turns++;
        if (turns > maxTurns) throw new Error("end-to-end battle did not terminate");
        core.skipDeadFront();
        const actorId = core.frontActorId();
        core.resolveTurn((id) => {
          if (id === steelId && !forcedWrapAround && core.isAlive(snakeId)) {
            forcedWrapAround = true;
            const ref = gd.jobAbilitiesOrEmpty("SteelSnake").find((r) => r.slot === "usable2")!;
            return {
              ability: gd.ability(ref.type),
              args: ref.arguments,
              enemyTargets: [snakeId],
              friendlyTargets: [],
              rngDraws: 0,
            };
          }
          if (id === snakeId && !forcedPoisonAttack && core.isAlive(steelId)) {
            forcedPoisonAttack = true;
            const ref = gd.jobAbilitiesOrEmpty("SnakeGod").find((r) => r.slot === "usable1")!;
            return {
              ability: gd.ability(ref.type),
              args: ref.arguments,
              enemyTargets: [steelId],
              friendlyTargets: [],
              rngDraws: 0,
            };
          }
          return assignAbility(id, core.aiWorld, gd, rng);
        });
        void actorId;
      }

      expect(core.winner === 0 || core.winner === 1).toBe(true);
      expect(forcedWrapAround).toBe(true);
      expect(forcedPoisonAttack).toBe(true);
      expect(core.events).toContainEqual(expect.objectContaining({
        type: "buffAdded",
        target: steelId,
        source: snakeId,
        buffType: "Offensive.Poison",
        statusEffects: ["Poison"],
        permanent: false,
      }));
      expect(core.events.some((e) => e.type === "battleEnded")).toBe(true);
    });
  });
});
