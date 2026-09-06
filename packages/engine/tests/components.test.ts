


import { describe, it, expect } from "vitest";
import { loadGameData } from "@dib/gamedata";
import type { AbilityDef, Element, StatName } from "@dib/gamedata";
import {
  blockUseReason,
  performAbility,
  applyMagnification,
  rollDamage,
  applyDamage,
  type BattleWorld,
} from "../src/index.js";
import { BattleCore } from "../src/core.js";
import { BattleSession } from "../src/session.js";
import { assignAbility, type AiDecision } from "../src/ai.js";
import { battleLivingId, type BattleEvent, type TeamMemberSetup } from "../src/events.js";
import { mulberry32, type Rng } from "../src/rng.js";

const gd = loadGameData();
const f = Math.fround;

type ScriptStep = ["next", number] | ["intBelow", number];

/** Typed-channel scripted Rng: each draw must arrive on the scripted channel, in order — this
 *  doubles as a draw-ORDER assertion (e.g. Dice's queue-time intBelow(7) precedes every roll). */
function scriptedRng(script: ScriptStep[]): Rng & { drawsMade: () => number } {
  let i = 0;
  const take = (kind: "next" | "intBelow"): number => {
    const step = script[i];
    if (!step) throw new Error(`scriptedRng exhausted after ${i} draws (wanted ${kind})`);
    if (step[0] !== kind) {
      throw new Error(`scriptedRng: draw ${i} is ${kind} but script says ${step[0]}`);
    }
    i++;
    return step[1];
  };
  return {
    next: () => take("next"),
    intBelow: (n) => {
      const v = take("intBelow");
      if (v >= n) throw new Error(`scriptedRng: scripted intBelow value ${v} >= bound ${n}`);
      return v;
    },
    chance: () => {
      throw new Error("scriptedRng: chance not scripted");
    },
    drawsMade: () => i,
  };
}

interface Actor {
  stats: Record<StatName, number>;
  element: Element;
  hp: number;
  level: number;
}

/** Minimal in-memory BattleWorld (ability.test.ts's harness shape) for direct performAbility
 *  anchors. Only the surfaces DrainLife/Dice touch are wired. */
type HpDeltaCall = [string, number, string, Record<string, unknown> | undefined];

function makeWorld(actors: Record<string, Actor>): BattleWorld & { calls: HpDeltaCall[] } {
  const calls: HpDeltaCall[] = [];
  const get = (id: string): Actor => {
    const a = actors[id];
    if (!a) throw new Error(`unknown actor ${id}`);
    return a;
  };
  return {
    calls,
    statsOf: (id) => get(id).stats,
    elementOf: (id) => get(id).element,
    hpOf: (id) => get(id).hp,
    levelOf: (id) => get(id).level,
    applyHpDelta: (id, delta, sourceId, opts) => {
      const a = get(id);
      a.hp = Math.max(0, Math.min(9999, a.hp + delta));
      calls.push([id, delta, sourceId, opts]);
    },
    notifyDamageDealt: () => {},
  };
}

const STATS: Record<StatName, number> = {
  Attack: 100,
  Defense: 10,
  Magic: 100,
  MaxHP: 500,
  Resist: 10,
  Speed: 50,
};

function eventsOf<T extends BattleEvent["type"]>(events: readonly BattleEvent[], type: T) {
  return events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === type);
}

function decisionFor(
  shortType: string,
  slot: string,
  targets: { enemyTargets?: string[]; friendlyTargets?: string[] },
): AiDecision {
  const ref = gd.jobAbilitiesOrEmpty(shortType).find((r) => r.slot === slot);
  if (!ref) throw new Error(`${shortType} has no ${slot}`);
  return {
    ability: gd.ability(ref.type),
    args: ref.arguments,
    enemyTargets: targets.enemyTargets ?? [],
    friendlyTargets: targets.friendlyTargets ?? [],
    rngDraws: 0,
  };
}

/** Inert pass-the-turn ability (authoredBuffs.test.ts's NOOP convention): zero components, so a
 *  turn spent on it draws only the shared sacrifice roll. */
const NOOP_ABILITY: AbilityDef = {
  path: "Test.Noop",
  className: "CombatAbility",
  components: [],
  targetPicker: {},
  raw: {},
};

/** `resolveTurn` always acts with the queue FRONT — burn other actors' turns on a no-op until
 *  the desired living holds initiative, so an injected decision is cast by the right monster. */
function advanceUntilFront(core: BattleCore, id: string): void {
  for (let guard = 0; guard < 24; guard++) {
    core.skipDeadFront();
    if (core.frontActorId() === id) return;
    core.resolveTurn(() => ({
      ability: NOOP_ABILITY,
      args: { activationLength: 100, noHaste: true },
      enemyTargets: [],
      friendlyTargets: [],
      rngDraws: 0,
    }));
  }
  throw new Error(`advanceUntilFront: ${id} never reached the queue front`);
}

describe("DrainLifeAbilityComponent (components-full.md §3) — performAbility anchors", () => {
  // Synthetic 3-phase carrier around the REAL Offensive.DrainHealth component so the friends
  // phase (unexercised by shipped kits) is reachable. startDelays force enemy -> source -> friends,
  // matching the real carrier's deliberate enemy-before-source ordering.
  function drainAbility(healPercent: number, friendly: boolean): AbilityDef {
    const eventData: Record<string, unknown> = {
      sourceEventData: { startDelay: 0.6 },
      enemyTargetEventData: { startDelay: 0.5 },
    };
    if (friendly) eventData["friendlyTargetEventData"] = { startDelay: 0.7 };
    return {
      path: "Test.Drain",
      className: "CombatAbility",
      components: [{ type: "Offensive.DrainHealth", arguments: { healPercent } }],
      targetPicker: { enemyTargets: 1 },
      raw: { eventData },
    };
  }

  it("real carrier shape: enemy-phase attack lands first, then the source heal-back = trunc32(total * healPercent)", () => {
    const actors = {
      src: { stats: STATS, element: "Fire" as Element, hp: 100, level: 10 },
      foe: { stats: STATS, element: "Fire" as Element, hp: 400, level: 10 },
    };
    const world = makeWorld(actors);
    const rng = scriptedRng([["next", 0.5]]); // ONE roll draw; the heal-back draws nothing
    const outcome = performAbility(
      { source: "src", targets: [], enemyTargets: ["foe"], friendlyTargets: [], ability: drainAbility(0.5, false), args: {} },
      world,
      rng,
      gd,
    );
    expect(outcome.rngDraws).toBe(1);
    // First call: the inherited DamageDealing enemy phase; second: the source-phase heal.
    expect(world.calls).toHaveLength(2);
    const [foeHit, srcHeal] = world.calls;
    expect(foeHit![0]).toBe("foe");
    const landed = -foeHit![1];
    expect(landed).toBeGreaterThanOrEqual(1);
    expect(srcHeal![0]).toBe("src");
    expect(srcHeal![1]).toBe(Math.trunc(f(f(landed) * f(0.5)))); // trunc32(f32(total) * healPercent)
  });

  it("negative healPercent: direct self-damage bypassing elemental/mitigation entirely", () => {
    const actors = {
      // Absurd Defense/Resist prove the self-damage skips mitigation (a mitigated hit would shrink).
      src: { stats: { ...STATS, Defense: 9999, Resist: 9999 }, element: "Fire" as Element, hp: 300, level: 10 },
      foe: { stats: STATS, element: "Fire" as Element, hp: 400, level: 10 },
    };
    const world = makeWorld(actors);
    const outcome = performAbility(
      { source: "src", targets: [], enemyTargets: ["foe"], friendlyTargets: [], ability: drainAbility(-0.5, false), args: {} },
      world,
      scriptedRng([["next", 0.5]]),
      gd,
    );
    const landed = -world.calls[0]![1];
    const selfHit = world.calls[1]!;
    expect(selfHit[0]).toBe("src");
    expect(selfHit[1]).toBe(-Math.trunc(f(f(landed) * f(0.5)))); // trunc32(total * -healPercent), unmitigated
    expect(selfHit[3]).toMatchObject({
      bypassDamageTakenListeners: true,
      suppressKillCredit: true,
    });
    expect(selfHit[3]).toHaveProperty("sourceOfDeath", undefined);
    expect(outcome.results.some((r) => r.target === "src" && (r.hpDelta ?? 0) < 0)).toBe(true);
  });

  it("friends phase splits floorf(total * healPercent / n) per target", () => {
    const actors = {
      src: { stats: STATS, element: "Fire" as Element, hp: 50, level: 10 },
      ally: { stats: STATS, element: "Fire" as Element, hp: 50, level: 10 },
      foe: { stats: STATS, element: "Fire" as Element, hp: 400, level: 10 },
    };
    const world = makeWorld(actors);
    performAbility(
      {
        source: "src",
        targets: [],
        enemyTargets: ["foe"],
        friendlyTargets: ["src", "ally"],
        ability: drainAbility(0.5, true),
        args: {},
      },
      world,
      scriptedRng([["next", 0.5]]),
      gd,
    );
    const landed = -world.calls[0]![1];
    const perTarget = Math.floor(f(f(f(landed) * f(0.5)) / f(2)));
    // calls: foe hit, source-phase heal (full 0.5 of total), then the two friends-phase splits.
    expect(world.calls.slice(2)).toEqual([
      ["src", perTarget, "src", undefined],
      ["ally", perTarget, "src", undefined],
    ]);
  });
});

describe("Wendigo Desperate Attack direct-recoil semantics", () => {
  const wendigoId = battleLivingId(0, 0, "Wendigo");
  const foeId = battleLivingId(1, 0, "FireCub");

  it("does not wake Sleep or trigger reflection listeners on its recoil", () => {
    const core = new BattleCore(
      gd,
      [[{ shortType: "Wendigo", level: 20 }], [{ shortType: "FireCub", level: 10 }]],
      mulberry32(0xdecafbad),
      { fightingGroupSize: 1 },
    );
    core.seedAndStart();
    advanceUntilFront(core, wendigoId);
    core.resolveTurn(() => ({
      ability: {
        path: "Test.DirectRecoilListeners",
        className: "CombatAbility",
        components: [],
        targetPicker: {},
        raw: {
          sourceBuffs: [
            { type: "Offensive.Sleep", arguments: { duration: 5000 } },
            { type: "Offensive.FixedReflection", arguments: { duration: 5000 } },
          ],
        },
      },
      args: { activationLength: 100, noHaste: true },
      enemyTargets: [],
      friendlyTargets: [],
      rngDraws: 0,
    }));
    expect(core.rawBuffsOf(wendigoId).some((buff) => buff.statusEffects.includes("Sleep"))).toBe(true);
    expect(core.rawBuffsOf(wendigoId).some((buff) => buff.kind === "reflective")).toBe(true);

    advanceUntilFront(core, wendigoId);
    const recoilHitsBefore = eventsOf(core.events, "damageDealt").filter((event) => event.target === wendigoId).length;
    core.resolveTurn(() => decisionFor("Wendigo", "usable4", { enemyTargets: [foeId] }));
    const recoilHitsAfter = eventsOf(core.events, "damageDealt").filter((event) => event.target === wendigoId).length;

    expect(recoilHitsAfter - recoilHitsBefore).toBe(1);
    expect(eventsOf(core.events, "buffTriggered")).toHaveLength(0);
    expect(core.rawBuffsOf(wendigoId).some((buff) => buff.statusEffects.includes("Sleep"))).toBe(true);
  });

  it("can kill its user without awarding a Living kill or revenge source", () => {
    const durableFoeId = battleLivingId(1, 0, "Wendigo");
    const core = new BattleCore(
      gd,
      [[{ shortType: "Wendigo", level: 1, currentHp: 1 }], [{ shortType: "Wendigo", level: 150 }]],
      mulberry32(0x12345678),
      { fightingGroupSize: 1 },
    );
    core.seedAndStart();
    advanceUntilFront(core, wendigoId);
    core.resolveTurn(() => decisionFor("Wendigo", "usable4", { enemyTargets: [durableFoeId] }));

    expect(core.isAlive(wendigoId)).toBe(false);
    expect(core.isAlive(durableFoeId)).toBe(true);
    expect(core.magnifySourceContextOf(wendigoId).sourceKillsMade).toBe(0);
  });
});

describe("DiceAbilityComponent (components-full.md §8) — hit-or-total-miss gamble", () => {
  const diceRef = gd.jobAbilitiesOrEmpty("Teddy").find((r) => r.slot === "usable4")!;
  const diceAbility = gd.ability(diceRef.type); // Offensive.DiceNuke, allEnemies, Magic roll

  function teddyWorld(foeElement: Element) {
    return makeWorld({
      src: { stats: STATS, element: "Arcane" as Element, hp: 300, level: 10 },
      foe: { stats: STATS, element: foeElement, hp: 400, level: 10 },
    });
  }

  it("element match: one queue-time intBelow(7) BEFORE the roll, damage magnified by matchMagnification", () => {
    const world = teddyWorld("Fire");
    const u = 0.5;
    // Script order asserts the element pick precedes the roll draw. Index 3 = "Fire" (damage.md
    // element enum 0=Life 1=Death 2=Water 3=Fire 4=Earth 5=Air 6=Arcane) — a MATCH for the foe.
    const rng = scriptedRng([["intBelow", 3], ["next", u]]);
    const outcome = performAbility(
      { source: "src", targets: [], enemyTargets: ["foe"], friendlyTargets: [], ability: diceAbility, args: diceRef.arguments },
      world,
      rng,
      gd,
    );
    expect(outcome.rngDraws).toBe(2);
    // Hand-recomputed expectation through the exported pipeline pieces: roll (Magic stat,
    // activationLength {2}=70, allEnemies -> numTargets 3), matchMagnification from the REAL
    // component ref (5 -> a 6x multiplier), then the normal elemental/mitigation pass.
    const roll = rollDamage(
      { abilityScalor: 1, stat: STATS.Magic, activationLength: 70, scaleByActivationLength: true, randomness: 0.2, numTargets: 3 },
      scriptedRng([["next", u]]),
    );
    const diceComponentRef = diceAbility.components[0]! as { type: string; arguments?: Record<string, unknown> };
    const matchMagnification = (diceComponentRef.arguments?.["matchMagnification"] ??
      gd.abilityComponent(diceComponentRef.type).raw["matchMagnification"]) as number;
    expect(matchMagnification).toBe(5); // Teddy's authored 6x gamble
    const magnified = applyMagnification(applyMagnification(roll, 0), matchMagnification);
    const expected = applyDamage({
      amount: magnified,
      damageElement: "Arcane",
      sourceStat: "Magic",
      defenderElement: "Fire",
      defenderDefense: STATS.Defense,
      defenderResist: STATS.Resist,
      defenderCurrentHp: 400,
      level: 10,
    });
    expect(world.calls).toEqual([
      ["foe", -expected, "src", { element: "Arcane", sourceStat: "Magic", displayZeroDamage: true }],
    ]);
  });

  it("element mismatch: the roll draw still happens but the target takes exactly zero", () => {
    const world = teddyWorld("Fire");
    // Index 0 = "Life" — a MISMATCH for the Fire foe. Roll draw still consumed after it.
    const rng = scriptedRng([["intBelow", 0], ["next", 0.5]]);
    const outcome = performAbility(
      { source: "src", targets: [], enemyTargets: ["foe"], friendlyTargets: [], ability: diceAbility, args: diceRef.arguments },
      world,
      rng,
      gd,
    );
    expect(rng.drawsMade()).toBe(2);


    expect(world.calls).toEqual([
      ["foe", 0, "src", { element: "Arcane", sourceStat: "Magic", displayZeroDamage: true }],
    ]);
    expect(outcome.results).toEqual([{ target: "foe", hpDelta: 0, element: "Arcane" }]);
  });
});

describe("AddMonsterAbilityComponent (components-full.md §1) — real carriers via BattleCore", () => {
  it('Slime "Split" (hpStyle split): clone joins the caster\'s team, both at floor(hp/2)', () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Slime", level: 10 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const core = new BattleCore(gd, teams, mulberry32(7), { fightingGroupSize: 3 });
    core.seedAndStart();
    const slimeId = battleLivingId(0, 0, "Slime");
    advanceUntilFront(core, slimeId); // the Slime itself must be the caster
    const hpBefore = core.hpOf(slimeId);
    const half = Math.floor(hpBefore / 2);

    core.resolveTurn(() => decisionFor("Slime", "usable2", { friendlyTargets: [slimeId] }));

    const added = eventsOf(core.events, "monsterAdded");
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ shortType: "Slime", level: 10, team: 0, summoner: slimeId });
    const cloneId = added[0]!.living;
    expect(cloneId).toBe(battleLivingId(0, 1, "Slime"));
    expect(core.hpOf(slimeId)).toBe(half);
    expect(core.hpOf(cloneId)).toBe(half);
    // Front line had open slots (1 of 3) and the bench was empty, so the clone was promoted
    // straight through the bench (addNewMonster -> addReplacementMonster) into the active roster.
    expect(core.activeIdsOf(0)).toEqual([slimeId, cloneId]);
    expect(core.benchIdsOf(0)).toEqual([]);
    expect(core.queueOrder()).toContain(cloneId);
    // The summoner's halving surfaced as a real damage event (adjustHP through the hp pipeline).
    expect(
      eventsOf(core.events, "damageDealt").some((e) => e.target === slimeId && e.amount === hpBefore - half),
    ).toBe(true);
  });

  it('Kaguya "Puppet" (enemy phase, default 100% hp): clones the TARGET\'s species onto the CASTER\'s team', () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Kaguya", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const core = new BattleCore(gd, teams, mulberry32(11), { fightingGroupSize: 3 });
    core.seedAndStart();
    const kaguyaId = battleLivingId(0, 0, "Kaguya");
    const foeId = battleLivingId(1, 0, "FireCub");
    advanceUntilFront(core, kaguyaId);
    const foeHpBefore = core.hpOf(foeId);

    core.resolveTurn(() => decisionFor("Kaguya", "usable4", { enemyTargets: [foeId] }));

    const added = eventsOf(core.events, "monsterAdded");
    expect(added).toHaveLength(1);
    // Species stolen from the enemy target; team + level from the caster; natural full HP.
    expect(added[0]).toMatchObject({ shortType: "FireCub", level: 12, team: 0, summoner: kaguyaId });
    const cloneId = added[0]!.living;
    expect(core.hpOf(cloneId)).toBe(core.maxHpOf(cloneId));
    expect(core.hpOf(foeId)).toBe(foeHpBefore); // the target itself is untouched
    expect(core.activeIdsOf(0)).toEqual([kaguyaId, cloneId]);
  });

  it("blockUseReason: NoRoomToAddMonster unless (open front-line slot AND empty bench)", () => {
    const split = gd.ability("Utility.AddMonster");
    const ok = { fightingGroupSize: 3, hasSoulStoneEquipped: false };
    expect(blockUseReason(split, {}, gd, { ...ok, activeCount: 1, benchCount: 0 })).toBeUndefined();
    expect(blockUseReason(split, {}, gd, { ...ok, activeCount: 3, benchCount: 0 })).toBe("NoRoomToAddMonster");

    expect(blockUseReason(split, {}, gd, { ...ok, activeCount: 1, benchCount: 2 })).toBe("NoRoomToAddMonster");
  });
});

describe("CallMonsterAbilityComponent (components-full.md §2) — real carriers via BattleCore", () => {
  const normalShortTypes = new Set(
    gd.allMonsters().filter((m) => m.category === "Normal").map((m) => m.shortType),
  );

  it('Manticore "Reincarnation": random Normal-catalog summon, then the ability-level sacrificeChance:1 self-kill', () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Manticore", level: 15 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const core = new BattleCore(gd, teams, mulberry32(3), { fightingGroupSize: 1 });
    core.seedAndStart();
    const manticoreId = battleLivingId(0, 0, "Manticore");
    advanceUntilFront(core, manticoreId);

    core.resolveTurn(() => decisionFor("Manticore", "usable4", { friendlyTargets: [manticoreId] }));

    const added = eventsOf(core.events, "monsterAdded");
    expect(added).toHaveLength(1);
    expect(normalShortTypes.has(added[0]!.shortType)).toBe(true); // category-0 == "Normal" pool
    expect(added[0]!.level).toBe(15); // summoner's level
    expect(core.xpStateOf(manticoreId)).toMatchObject({ summoned: false, noReward: false });
    expect(core.xpStateOf(added[0]!.living)).toMatchObject({ summoned: true, noReward: true });
    // sacrificeChance: 1 — the summoner self-kills right after its turn completes...
    expect(eventsOf(core.events, "died").map((e) => e.living)).toContain(manticoreId);
    // ...and the just-summoned monster (benched: the 1-slot front line was full) is promoted.
    expect(core.activeIdsOf(0)).toEqual([added[0]!.living]);
    expect(core.postBattleXpSummary()).toEqual({
      participantIds: [manticoreId, added[0]!.living],
      awardedIds: [manticoreId],
      defeatedIds: [],
      amount: 0,
    });
    expect(core.winner).toBeUndefined(); // battle continues — reincarnation, not suicide
  });

  it('Doki "BigBrother" (minStars 5): every summon has stars >= 5 and is Normal-category', () => {
    for (let seed = 0; seed < 12; seed++) {
      const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
        [{ shortType: "Doki", level: 10 }],
        [{ shortType: "FireCub", level: 10 }],
      ];
      const core = new BattleCore(gd, teams, mulberry32(1000 + seed), { fightingGroupSize: 1 });
      core.seedAndStart();
      const dokiId = battleLivingId(0, 0, "Doki");
      core.resolveTurn(() => decisionFor("Doki", "usable1", { friendlyTargets: [dokiId] }));
      const added = eventsOf(core.events, "monsterAdded")[0]!;
      const monster = gd.monsterByShortType(added.shortType);
      expect(monster.category).toBe("Normal");
      expect(monster.stars).toBeGreaterThanOrEqual(5);
    }
  });
});

describe("SacrificeAbilityComponent (components-full.md §4) — Ganesha via BattleCore", () => {
  it("kills a random bench member and magnifies the SAME phase's later MagicAttack roll", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [
        { shortType: "Ganesha", level: 20 },
        { shortType: "FireCub", level: 20 }, // the doomed bench member
      ],
      [{ shortType: "FireCub", level: 10 }],
    ];
    // Scripted stream: 2x initialBattleDelay (active livings only — the bench is NOT seeded),
    // then within the enemy phase: Sacrifice's bench pick (intBelow), THEN MagicAttack's roll
    // (next) — order is itself the §4 assertion — then the ability-level sacrificeChance draw.
    const u = 0.5;
    const rng = scriptedRng([
      ["next", 0], ["next", 0],
      ["intBelow", 0], // bench pick: the lone FireCub
      ["next", u], // MagicAttack roll, AFTER the magnification was added
      ["next", 0.99], // sacrificeChance 0 -> never self-kills; draw still consumed
    ]);
    const core = new BattleCore(gd, teams, rng, { fightingGroupSize: 1 });
    core.seedAndStart();
    const ganeshaId = battleLivingId(0, 0, "Ganesha");
    const benchId = battleLivingId(0, 1, "FireCub");
    const foeId = battleLivingId(1, 0, "FireCub");
    // Initiative assumption behind the scripted draw stream: the L20 Ganesha outspeeds the L10
    // FireCub with both initialBattleDelay draws scripted to u=0.
    expect(core.frontActorId()).toBe(ganeshaId);
    const ganeshaMagic = core.effectiveStatsOf(ganeshaId).Magic;
    const foeStats = core.effectiveStatsOf(foeId);
    const foeHp = core.hpOf(foeId);

    core.resolveTurn(() => decisionFor("Ganesha", "usable3", { enemyTargets: [foeId] }));

    // The bench victim died FIRST, through the replacement-kill path: straight to deadMembers,
    // no promotion (the active roster was never touched), no revenge, no kill credit. (The
    // magnified L20-vs-L10 nuke may well have killed the foe afterwards — irrelevant here.)
    expect(eventsOf(core.events, "died")[0]!.living).toBe(benchId);
    expect(core.benchIdsOf(0)).toEqual([]);
    expect(core.activeIdsOf(0)).toEqual([ganeshaId]);

    // Damage anchor: magnification = f32(victimLevel) * levelMultiplier = 20 * 0.03.
    const magnification = f(f(20) * f(0.03));
    const roll = rollDamage(
      { abilityScalor: 1, stat: ganeshaMagic, activationLength: 250, scaleByActivationLength: true, randomness: 0.2, numTargets: 1 },
      scriptedRng([["next", u]]),
    );
    const expected = applyDamage({
      amount: applyMagnification(roll, magnification),
      damageElement: gd.monsterByShortType("Ganesha").element,
      sourceStat: "Magic",
      defenderElement: gd.monsterByShortType("FireCub").element,
      defenderDefense: foeStats.Defense,
      defenderResist: foeStats.Resist,
      defenderCurrentHp: foeHp,
      level: 20,
    });
    const hits = eventsOf(core.events, "damageDealt").filter((e) => e.target === foeId);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.amount).toBe(expected);
  });

  it("blockUseReason: NoReplacementMembers when the caster's bench is empty", () => {
    const ref = gd.jobAbilitiesOrEmpty("Ganesha").find((r) => r.slot === "usable3")!;
    const ability = gd.ability(ref.type);
    const ctx = { activeCount: 1, fightingGroupSize: 1, hasSoulStoneEquipped: false };
    expect(blockUseReason(ability, ref.arguments, gd, { ...ctx, benchCount: 0 })).toBe("NoReplacementMembers");
    expect(blockUseReason(ability, ref.arguments, gd, { ...ctx, benchCount: 1 })).toBeUndefined();
  });
});

describe("SwitchAbilityComponent (components-full.md §5) — Abomination via BattleCore", () => {
  it("swaps the caster out into the reserve's old bench slot; the reserve is appended active and scheduled", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [
        { shortType: "Abomination", level: 12 },
        { shortType: "FireCub", level: 12 },
        { shortType: "Kaguya", level: 12 },
      ],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const rng = scriptedRng([
      ["next", 0], ["next", 0], // seed: 2 active livings (fgs 1 -> bench of 2 unseeded)
      ["intBelow", 1], // reserve pick: index 1 = Kaguya
      ["next", 0.5], // incoming reserve's initialBattleDelay (fireMonsterEntered scheduling)
      ["next", 0.99], // ability-level sacrificeChance draw (0 -> no-op) — actor is ALIVE, so drawn
    ]);
    const core = new BattleCore(gd, teams, rng, { fightingGroupSize: 1 });
    core.seedAndStart();
    const abomId = battleLivingId(0, 0, "Abomination");
    const cubId = battleLivingId(0, 1, "FireCub");
    const kaguyaId = battleLivingId(0, 2, "Kaguya");
    // Initiative assumption behind the scripted stream (L12 Abomination vs L10 FireCub, u=0 both).
    expect(core.frontActorId()).toBe(abomId);

    core.resolveTurn(() => decisionFor("Abomination", "usable3", { friendlyTargets: [abomId] }));

    expect(eventsOf(core.events, "switched")).toEqual([
      expect.objectContaining({ out: abomId, in: kaguyaId, team: 0 }),
    ]);
    expect(core.activeIdsOf(0)).toEqual([kaguyaId]); // appended (sole slot here)
    expect(core.benchIdsOf(0)).toEqual([cubId, abomId]); // outgoing took Kaguya's OLD bench slot
    expect(core.queueOrder()).not.toContain(abomId); // off the field = out of the queue
    expect(core.queueOrder()).toContain(kaguyaId);
    expect(core.isAlive(abomId)).toBe(true); // benched, not dead — no requeue crash either
  });
});

describe("SpendSilverAbilityComponent (components-full.md §6) — MoneySlap via BattleCore", () => {
  function moneySlap(silver: number, seed: number): BattleCore {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Abomination", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const core = new BattleCore(gd, teams, mulberry32(seed), { fightingGroupSize: 1, silver });
    core.seedAndStart();
    const foeId = battleLivingId(1, 0, "FireCub");
    advanceUntilFront(core, battleLivingId(0, 0, "Abomination")); // identical burn in both runs
    core.resolveTurn(() => decisionFor("Abomination", "usable1", { enemyTargets: [foeId] }));
    return core;
  }

  it("spends level*10 silver yet deals UNCHANGED damage (the per-phase magnification reset wipes the bonus)", () => {
    const paid = moneySlap(1000, 42);
    const broke = moneySlap(0, 42); // identical seed; spendSilver draws nothing so streams align

    expect(eventsOf(paid.events, "silverSpent")).toEqual([
      expect.objectContaining({ amount: 120, remaining: 880 }), // level 12 * 10
    ]);
    expect(paid.silver).toBe(880);
    expect(eventsOf(broke.events, "silverSpent")).toHaveLength(0); // unaffordable -> silent no-op
    expect(broke.silver).toBe(0);

    // The authored damageMagnifier:2 is functionally dead (§6): the source phase pays, then the
    // enemy phase's dispatcher resets magnification before MagicAttack reads it. Faithfully
    // ported — the payer and the non-payer deal EXACTLY the same damage.
    const paidHits = eventsOf(paid.events, "damageDealt").map((e) => e.amount);
    const brokeHits = eventsOf(broke.events, "damageDealt").map((e) => e.amount);
    expect(paidHits).toEqual(brokeHits);
    expect(paidHits.length).toBeGreaterThan(0);
  });
});

describe("MoveToFrontAbilityComponent (components-full.md §7) — Pass via BattleCore", () => {
  it("repositions the target to the queue head", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [
        { shortType: "Abomination", level: 12 },
        { shortType: "Kaguya", level: 12 },
      ],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const core = new BattleCore(gd, teams, mulberry32(5), { fightingGroupSize: 2 });
    core.seedAndStart();
    core.skipDeadFront();
    const actorId = core.frontActorId();
    const abomId = battleLivingId(0, 0, "Abomination");
    const kaguyaId = battleLivingId(0, 2 - 1, "Kaguya");
    const targetId = actorId === abomId ? kaguyaId : abomId;

    core.resolveTurn(() => decisionFor("Abomination", "usable4", { friendlyTargets: [targetId] }));

    expect(eventsOf(core.events, "movedToFront")).toEqual([
      expect.objectContaining({ target: targetId }),
    ]);
    // The passed-to ally acts next: it was pinned at timeAtFront while the actor was pushed
    // back by its own ability cost.
    expect(core.queueOrder()[0]).toBe(targetId);
  });
});

describe("EscapeAbilityComponent (components-full.md §10) — guaranteed retreat via BattleSession", () => {
  it("Cockatrice's Escape ends the battle in retreat (terminal, no winner) with one wasted-but-real draw", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Cockatrice", level: 10 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(9), { fightingGroupSize: 1 });
    // Advance until the Cockatrice gets a turn (the enemy may act first).
    let step = session.advance();
    while (step.type === "enemyTurnResolved") step = session.advance();
    if (step.type !== "awaitingPlayer") throw new Error(`unexpected step ${step.type}`);
    const escape = step.choices.find((c) => c.abilityPath === "Utility.Escape");
    expect(escape).toBeDefined();
    expect(escape!.blockReason).toBeUndefined();

    const events = session.submitPlayerAction(escape!.slot, []);
    expect(eventsOf(events, "abilityEvent")).toEqual([expect.objectContaining({ event: 1 })]);
    expect(eventsOf(events, "escaped")).toHaveLength(1);
    expect(session.retreated).toBe(true);
    // Terminal without a winner: advancing again is a caller error, exactly like player retreat.
    expect(() => session.advance()).toThrow(/retreat/);
  });
});

describe("DesoulAbilityComponent (components-full.md §11 + soulstones.md §10) — summon-and-consume", () => {
  /** Drive the session to the given actor's player turn and return its choices. */
  function untilPlayerTurn(session: BattleSession, actorShortType?: string) {
    for (let i = 0; i < 200; i++) {
      const step = session.advance();
      if (step.type === "ended") throw new Error("battle ended before the player turn");
      if (step.type !== "awaitingPlayer") continue;
      if (actorShortType === undefined || step.actorId.includes(`:${actorShortType}`)) return step;
      session.submitDelayAction();
    }
    throw new Error("player turn never arrived");
  }

  it('without a stone the choice carries blockReason "MonsterHasNoSoulStone" and cannot be submitted', () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Manticore", level: 10 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(2), { fightingGroupSize: 1 });
    const step = untilPlayerTurn(session);
    const desoul = step.choices.find((c) => c.abilityPath === "Utility.Desoul");
    expect(desoul).toBeDefined();
    expect(desoul!.blockReason).toBe("MonsterHasNoSoulStone");
    expect(() => session.submitPlayerAction(desoul!.slot, [])).toThrow(/MonsterHasNoSoulStone/);
  });

  it("casting revives the stone's sourceType at the CASTER's level into the summon slot and consumes the stone", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      // Fire stone (Attack only) so the consumed flat term is observable on one stat.
      [{ shortType: "Manticore", level: 10, soulStone: { element: "Fire", level: 7, sourceType: "FireCub" } }],
      [{ shortType: "SnowCub", level: 10 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(2), { fightingGroupSize: 1 });
    const manticoreId = battleLivingId(0, 0, "Manticore");
    const attackWithStone = session.effectiveStatsOf(manticoreId).Attack;

    const step = untilPlayerTurn(session);
    const desoul = step.choices.find((c) => c.abilityPath === "Utility.Desoul");
    expect(desoul!.blockReason).toBeUndefined();
    const events = session.submitPlayerAction(desoul!.slot, []);

    // One summonChanged (the native replacedSummon:withNewSummon: analog), NOT monsterAdded.
    const changes = eventsOf(events, "summonChanged");
    expect(changes).toEqual([
      expect.objectContaining({
        team: 0,
        removed: undefined,
        shortType: "FireCub",
        level: 10, // caster's level — NOT the stone's own level 7
        summoner: manticoreId,
      }),
    ]);
    expect(eventsOf(events, "monsterAdded")).toHaveLength(0);
    const summonId = (changes[0] as { added: string }).added;
    expect(summonId).toContain(":FireCub");

    // §10.1: outside the front line but on the field — targetable, never active.
    expect(session.summonIdOf(0)).toBe(summonId);
    expect(session.xpStateOf(summonId)).toMatchObject({ summoned: false, noReward: false });
    expect(session.isAiControlled(summonId!)).toBe(false); // DeSoul remains player-controlled
    expect(session.activeIdsOf(0)).toEqual([manticoreId]);
    expect(session.targetableIdsOf(0)).toEqual([manticoreId, summonId]);
    // §10.4: scheduled in the shared queue (timeDelayOf throws for unscheduled ids).
    expect(session.timeDelayOf(summonId)).toBeGreaterThanOrEqual(0);


    expect(session.effectiveStatsOf(manticoreId).Attack).toBe(attackWithStone - 7);
    const again = untilPlayerTurn(session, "Manticore");
    const desoul2 = again.choices.find((c) => c.abilityPath === "Utility.Desoul");
    expect(desoul2!.blockReason).toBe("MonsterHasNoSoulStone");
  });

  it("a native autonomous spirit can replace a player-controlled DeSoul occupant", () => {
    const session = new BattleSession(
      gd,
      [[{ shortType: "Manticore", level: 10, soulStone: { element: "Fire", level: 7, sourceType: "FireCub" } }],
        [{ shortType: "SnowCub", level: 10 }]],
      mulberry32(12),
      { fightingGroupSize: 1 },
    );
    const step = untilPlayerTurn(session, "Manticore");
    const desoul = step.choices.find((choice) => choice.abilityPath === "Utility.Desoul")!;
    const desoulEvent = eventsOf(session.submitPlayerAction(desoul.slot, []), "summonChanged")[0]!;
    const controlledId = desoulEvent.added!;
    expect(session.isAiControlled(controlledId)).toBe(false);

    const native = session.summonSpirit("Resistance", 0);
    expect(native.events).toEqual([
      expect.objectContaining({
        type: "summonChanged",
        team: 0,
        removed: controlledId,
        added: native.id,
        origin: "spirit",
      }),
    ]);
    expect(session.isAiControlled(native.id)).toBe(true);
    expect(session.xpStateOf(native.id)).toMatchObject({ summoned: false, noReward: false });
    expect(session.targetableIdsOf(0)).toEqual(["t0m0:Manticore", native.id]);
    expect(session.queueOrder()).not.toContain(controlledId);
  });

  it("consuming a MaxHP-enabled (Life) stone re-derives cached MaxHP without clamping current hp", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Manticore", level: 10, soulStone: { element: "Life", level: 10, sourceType: "SnowCub" } }],
      [{ shortType: "SnowCub", level: 10 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(2), { fightingGroupSize: 1 });
    const manticoreId = battleLivingId(0, 0, "Manticore");
    const maxWithStone = session.maxHpOf(manticoreId);

    const step = untilPlayerTurn(session, "Manticore");
    const desoul = step.choices.find((c) => c.abilityPath === "Utility.Desoul");
    const hpBeforeCast = session.hpOf(manticoreId);
    session.submitPlayerAction(desoul!.slot, []);

    // Life stone enables MaxHP at weight 1.0 -> flat 10 gone from the live max; the consume
    // itself never touches current hp (natively hp only meets the lower max at the next
    // adjustHP:), so hp is unchanged across the cast even though the max dropped.
    expect(session.maxHpOf(manticoreId)).toBe(maxWithStone - 10);
    expect(session.hpOf(manticoreId)).toBe(hpBeforeCast);
  });

  it("a second Desoul on the same team properly evicts the first summon (§10.2, not a silent overwrite)", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [
        { shortType: "Manticore", level: 10, soulStone: { element: "Fire", level: 5, sourceType: "FireCub" } },
        { shortType: "GriffinRider", level: 10, soulStone: { element: "Air", level: 5, sourceType: "SnowCub" } },
      ],
      [{ shortType: "SnowCub", level: 10 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(4));
    const first = untilPlayerTurn(session, "Manticore");
    const d1 = first.choices.find((c) => c.abilityPath === "Utility.Desoul");
    const firstSummon = (eventsOf(session.submitPlayerAction(d1!.slot, []), "summonChanged")[0] as { added: string }).added;
    expect(session.summonIdOf(0)).toBe(firstSummon);

    const second = untilPlayerTurn(session, "GriffinRider");
    const d2 = second.choices.find((c) => c.abilityPath === "Utility.Desoul");
    const change = eventsOf(session.submitPlayerAction(d2!.slot, []), "summonChanged");
    expect(change).toEqual([
      expect.objectContaining({ team: 0, removed: firstSummon, shortType: "SnowCub" }),
    ]);
    const secondSummon = (change[0] as { added: string }).added;
    expect(session.summonIdOf(0)).toBe(secondSummon);
    // The evicted summon left the queue for good (timeDelayOf only reads scheduled ids).
    expect(() => session.timeDelayOf(firstSummon)).toThrow();
  });

  it("a live summon does NOT hold off defeat — win/loss checks monsterMembers only (§10.1/battle.md §3)", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      // The caster survives the opening exchange (L12) but the L18 Minotaur grinds the
      // delay-only player side down; the battle must end the moment the lone ACTIVE member
      // dies, regardless of summon-slot liveness.
      [{ shortType: "Manticore", level: 12, soulStone: { element: "Fire", level: 2, sourceType: "FireCub" } }],
      [{ shortType: "Minotaur", level: 18 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(7), { fightingGroupSize: 1 });
    const step = untilPlayerTurn(session, "Manticore");
    const desoul = step.choices.find((c) => c.abilityPath === "Utility.Desoul");
    const summonId = eventsOf(session.submitPlayerAction(desoul!.slot, []), "summonChanged")[0]!.added!;

    let sawSummonCleared = false;
    for (let i = 0; i < 500; i++) {
      const s = session.advance();
      if (s.type === "ended") {
        expect(s.report.winner).toBe(1);
        // Team.summon deaths emit `died` for presentation but never enter native deadMembers.
        expect(session.deadIdsOf(0)).toEqual([battleLivingId(0, 0, "Manticore")]);
        expect(session.deadIdsOf(0)).not.toContain(summonId);
        expect(session.postBattleXpSummary()).toMatchObject({
          participantIds: [battleLivingId(0, 0, "Manticore")],
          awardedIds: [battleLivingId(0, 0, "Manticore")],
        });
        const cleared = s.report.events.filter(
          (e) => e.type === "summonChanged" && e.added === undefined,
        );
        if (cleared.length > 0) {
          // The summon happened to die first: its death cleared the slot with no bench
          // backfill and the battle CONTINUED until the active Manticore fell.
          expect(session.summonIdOf(0)).toBeUndefined();
          sawSummonCleared = true;
        } else {
          // The active Manticore fell first: defeat fired with the summon slot still occupied.
          expect(session.summonIdOf(0)).toBeDefined();
        }
        return;
      }
      if (s.type === "awaitingPlayer") session.submitDelayAction();
    }
    throw new Error(`battle did not end (summonCleared=${sawSummonCleared})`);
  });

  it("construction rejects a sourceType-less stone ONLY on a Desoul carrier", () => {
    expect(
      () =>
        new BattleCore(
          gd,
          [
            [{ shortType: "Manticore", level: 10, soulStone: { element: "Fire", level: 5 } }],
            [{ shortType: "FireCub", level: 10 }],
          ],
          mulberry32(1),
        ),
    ).toThrow(/needs\s+sourceType/);
    expect(
      () =>
        new BattleCore(
          gd,
          [
            [{ shortType: "SnowCub", level: 10, soulStone: { element: "Fire", level: 5 } }],
            [{ shortType: "FireCub", level: 10 }],
          ],
          mulberry32(1),
        ),
    ).not.toThrow();
  });

  it("an ENEMY Desoul carrier with a stone never crashes the AI (aiChance 0 — Desoul is never drawn)", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "FireCub", level: 30 }],
      [{ shortType: "GriffinRider", level: 10, soulStone: { element: "Air", level: 5, sourceType: "SnowCub" } }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(11), { fightingGroupSize: 1 });
    for (let i = 0; i < 300; i++) {
      const s = session.advance();
      if (s.type === "ended") {
        // No enemy-side summon ever appeared (§10.7: aiChance 0 keeps Desoul out of the
        // weighted candidate list entirely).
        expect(s.report.events.filter((e) => e.type === "summonChanged")).toHaveLength(0);
        return;
      }
      if (s.type === "awaitingPlayer") session.submitDelayAction();
    }
    throw new Error("battle did not end");
  });
});

describe("blockUseReason in the native BadguyAI candidate gate (components-full.md §13)", () => {
  it("a blocked ability never enters the weighted candidate list (aiChance draws unchanged)", () => {
    // Slime's Split (usable2, aiChance 0.6) is blocked whenever the bench is nonempty. Two
    // Slimes at fightingGroupSize 1 give team 1 a nonempty bench, so even a PASSING aiChance
    // roll must not make Split selectable — the candidate list is exactly
    // [Ooze(usable1, "{2}" -> 70), Awaken(usable3, "{3}" -> 100)], never Split.
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "FireCub", level: 10 }],
      [
        { shortType: "Slime", level: 10 },
        { shortType: "Slime", level: 10 },
      ],
    ];
    const core = new BattleCore(gd, teams, mulberry32(1), { fightingGroupSize: 1 });
    core.seedAndStart();
    const slimeId = battleLivingId(1, 0, "Slime");

    // Draw script: u=0 passes EVERY aiChance gate (usable1, usable2, usable3 in slot order),
    // then one weighted-pick INTEGER draw (WeightedRandomList getRandomElement = intBelow) over
    // [Ooze(70), Awaken(100)] — roll 100 lands past Ooze's cumulative 70, picking Awaken.
    // Awaken (allFriends) builds targets without further draws.
    const rng = scriptedRng([
      ["next", 0], ["next", 0], ["next", 0],
      ["intBelow", 100], // weighted pick: cumulative [70, 170], 100 -> Awaken
    ]);
    const decision = assignAbility(slimeId, core.aiWorld, gd, rng);
    expect(decision.ability.path).toBe("Utility.StatusRemove.StatusRemoveAll"); // Awaken, never Split
  });
});
