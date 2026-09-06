import { describe, it, expect } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { BattleSession } from "../src/session.js";
import { baseStatRaw } from "../src/stats.js";
import type { Rng } from "../src/rng.js";

const gd = loadGameData();

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

function sequenceRng(values: number[]): Rng & { draws: number } {
  let draws = 0;
  const next = (): number => {
    const value = values[draws];
    if (value === undefined) throw new Error(`sequenceRng exhausted after ${draws} draws`);
    draws++;
    return value;
  };
  return {
    next,
    intBelow: (n) => Math.floor(next() * n),
    chance: (p) => next() < p,
    get draws() {
      return draws;
    },
  };
}

const oneVsOne = () =>
  new BattleSession(
    gd,
    [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
    constantRng(0.5),
    { fightingGroupSize: 1 },
  );

describe("BattleSession - player turn surfacing (FireCub vs SnowCub 1v1, constant U=0.5)", () => {
  it("first advance() stops at the player's FireCub with both usable slots as choices", () => {
    const s = oneVsOne();
    const step = s.advance();
    // Same tie-break as battle.test.ts's 1v1: identical delays, team 0 seeded first -> FireCub acts first.
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    expect(step.actorId).toBe("t0m0:FireCub");
    expect(step.choices).toEqual([
      {
        slot: "usable1",
        abilityPath: "Offensive.Attack",
        displayName: "Claw",
        tier: 5,
        activationLength: 160, // TIER_TABLE[5-1]
        targeting: { kind: "enemies", count: 1 },
      },
      {
        slot: "usable2",
        abilityPath: "Offensive.Fire.Fire",
        displayName: "Flame",
        tier: 4,
        activationLength: 130, // TIER_TABLE[4-1] -- turn-panel.md §2b's cited "TU:130" example
        targeting: { kind: "enemies", count: 1 },
      },
    ]);
    // battleStarted is already in the full log even though no turn has resolved
    expect(s.events[0]?.type).toBe("battleStarted");
  });

  it("submitPlayerAction resolves the turn with the battle.test.ts-anchored damage (Flame on SnowCub = 16)", () => {
    const s = oneVsOne();
    s.advance();
    const events = s.submitPlayerAction("usable2", ["t1m0:SnowCub"]);
    expect(events[0]).toEqual({ type: "turnStarted", living: "t0m0:FireCub", time: expect.any(Number) });
    expect(events[1]).toEqual({
      type: "abilityUsed",
      source: "t0m0:FireCub",
      ability: "Offensive.Fire.Fire",
      targets: ["t1m0:SnowCub"],
    });
    // Anchor from battle.test.ts's 1v1 trace: Fire vs Water element = 16 under constant U=0.5.
    expect(events[2]).toMatchObject({ type: "damageDealt", target: "t1m0:SnowCub", amount: 16 });
  });

  it("then the enemy SnowCub turn auto-resolves with the anchored 43 damage and carries tier metadata", () => {
    const s = oneVsOne();
    s.advance();
    s.submitPlayerAction("usable2", ["t1m0:SnowCub"]);
    const step = s.advance();
    expect(step.type).toBe("enemyTurnResolved");
    if (step.type !== "enemyTurnResolved") return;
    expect(step.actorId).toBe("t1m0:SnowCub");
    // Corrected slot>=1 AI gate: SnowCub's weighted pick (floor(0.5*290)=145) lands in usable1
    // Attack's 160-bucket, matching battle.test.ts's 1v1 trace: tier "{5}", 43 damage
    // (Water -> Fire amplified) against the still-full-HP FireCub.
    expect(step.abilityPath).toBe("Offensive.Attack");
    expect(step.tier).toBe(5);
    expect(step.events.some((e) => e.type === "damageDealt" && e.amount === 43)).toBe(true);
  });

  it("player slot-1 basic attack is usable (Claw) — the same slot the corrected AI gate can also pick", () => {
    const s = oneVsOne();
    s.advance();
    const events = s.submitPlayerAction("usable1", ["t1m0:SnowCub"]);
    expect(events.some((e) => e.type === "damageDealt")).toBe(true);
  });

  it("battle runs to an ended step and the report matches the accumulated event log", () => {
    const s = oneVsOne();
    for (let i = 0; i < 100; i++) {
      const step = s.advance();
      if (step.type === "awaitingPlayer") s.submitPlayerAction("usable2", ["t1m0:SnowCub"]);
      if (step.type === "ended") {
        expect(step.report.winner).toBe(1); // FireCub loses the elemental matchup, as in battle.test.ts
        expect(step.report.events).toEqual(s.events);
        return;
      }
    }
    throw new Error("battle did not end");
  });
});

describe("BattleSession - determinism", () => {
  it("same seed + same scripted actions => identical event logs", () => {
    const run = () => {
      const s = oneVsOne();
      for (let i = 0; i < 100; i++) {
        const step = s.advance();
        if (step.type === "awaitingPlayer") s.submitPlayerAction("usable2", ["t1m0:SnowCub"]);
        if (step.type === "ended") return step.report.events;
      }
      throw new Error("did not end");
    };
    expect(run()).toEqual(run());
  });
});

describe("BattleSession - player sacrifice path (UnhappyBird Detonate, allEnemies, sacrificeChance 1)", () => {
  it("Detonate needs no targets, damages the enemy, then self-kills the player's UnhappyBird", () => {
    const s = new BattleSession(
      gd,
      [[{ shortType: "UnhappyBird", level: 5 }], [{ shortType: "SnowCub", level: 10 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    let step = s.advance();
    if (step.type === "enemyTurnResolved") step = s.advance(); // SnowCub L10 may act first (faster)
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    const actorId = step.actorId;
    const detonate = step.choices.find((c) => c.slot === "usable2");
    expect(detonate?.targeting).toEqual({ kind: "allEnemies" });
    const events = s.submitPlayerAction("usable2", []);
    const selfKill = events.find(
      (e) => e.type === "damageDealt" && e.source === actorId && e.target === actorId,
    );
    expect(selfKill).toBeDefined();
    expect(events.some((e) => e.type === "died" && e.living === actorId)).toBe(true);
  });
});

describe("BattleSession - mixed friendly/enemy target phases", () => {
  it("SleepAllTeams applies once to each side instead of reusing the combined target list twice", () => {
    const rng = sequenceRng(Array<number>(20).fill(0));
    const s = new BattleSession(
      gd,
      [[{ shortType: "Megaslug", level: 50 }], [{ shortType: "SnowCub", level: 1 }]],
      rng,
      { fightingGroupSize: 1 },
    );
    const step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;


    expect(step.choices.find((choice) => choice.slot === "usable3")?.targeting).toEqual({
      kind: "mixed",
      enemyCount: 0,
      friendlyCount: 0,
      allEnemies: true,
      allFriends: true,
    });

    const drawsBefore = rng.draws;
    const events = s.submitPlayerAction("usable3", ["t1m0:SnowCub", "t0m0:Megaslug"]);
    expect(rng.draws - drawsBefore).toBe(3); // one status roll per living + sacrificeChance roll
    expect(s.statusEffectsOf("t0m0:Megaslug")).toContain("Sleep");
    expect(s.statusEffectsOf("t1m0:SnowCub")).toContain("Sleep");
    expect(events.filter((event) => event.type === "buffAdded")).toHaveLength(2);
  });
});

describe("BattleSession - turn-order/bench accessors (queueOrder/timeDelayOf/benchCountOf)", () => {
  it("queueOrder()[0] matches the actor reported by the next awaitingPlayer step; front's timeDelayOf is 0, others >0; bench counts are 0", () => {
    // FireCub L10 (Speed 82) vs SnowCub L5 (Speed 47): distinct (non-tied) initial delays, unlike
    // the tied-Speed oneVsOne() fixture used elsewhere in this file — needed so the non-front
    // living's timeDelayOf is strictly > 0 rather than tied at 0.
    const s = new BattleSession(
      gd,
      [[{ shortType: "FireCub", level: 10 }], [{ shortType: "SnowCub", level: 5 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    const step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    const order = s.queueOrder();
    expect(order[0]).toBe(step.actorId);
    expect(order).toContain("t1m0:SnowCub");
    expect(s.timeDelayOf(order[0]!)).toBe(0);
    for (const id of order.slice(1)) {
      expect(s.timeDelayOf(id)).toBeGreaterThan(0);
    }
    expect(s.benchCountOf(0)).toBe(0);
    expect(s.benchCountOf(1)).toBe(0);
    expect(s.benchIdsOf(0)).toEqual([]);
    expect(s.benchIdsOf(1)).toEqual([]);
  });

  it("queueOrder()[0] matches the actor reported by the next enemyTurnResolved step", () => {
    const s = oneVsOne();
    s.advance();
    s.submitPlayerAction("usable2", ["t1m0:SnowCub"]);
    const predictedFront = s.queueOrder()[0];
    const step = s.advance();
    expect(step.type).toBe("enemyTurnResolved");
    if (step.type !== "enemyTurnResolved") return;
    expect(predictedFront).toBe(step.actorId);
  });

  it("presentation staging keeps an enemy at TU 0 until submitEnemyAction resolves it", () => {
    const s = oneVsOne();
    s.advance();
    s.submitPlayerAction("usable2", ["t1m0:SnowCub"]);
    const step = s.advanceForPresentation();
    expect(step).toEqual({ type: "awaitingEnemy", actorId: "t1m0:SnowCub", forcedLooseTurn: false });
    expect(s.queueOrder()[0]).toBe("t1m0:SnowCub");
    expect(s.timeDelayOf("t1m0:SnowCub")).toBe(0);

    const resolved = s.submitEnemyAction();
    expect(resolved.type).toBe("enemyTurnResolved");
    expect(resolved.actorId).toBe("t1m0:SnowCub");
    expect(s.queueOrder()[0]).not.toBe("t1m0:SnowCub");
  });

  it("determinism: two sessions with the same seed produce identical queueOrder()", () => {
    const order = () => {
      const s = oneVsOne();
      s.advance();
      return s.queueOrder();
    };
    expect(order()).toEqual(order());
  });
});

describe("BattleSession - validation failures throw", () => {
  it("advance() while awaiting a player action throws", () => {
    const s = oneVsOne();
    s.advance();
    expect(() => s.advance()).toThrow(/pending actor action/);
  });
  it("advance() while awaiting an enemy action throws", () => {
    const s = oneVsOne();
    s.advance();
    s.submitPlayerAction("usable2", ["t1m0:SnowCub"]);
    expect(s.advanceForPresentation().type).toBe("awaitingEnemy");
    expect(() => s.advanceForPresentation()).toThrow(/pending actor action/);
  });
  it("submit without an awaited player turn throws", () => {
    const s = oneVsOne();
    expect(() => s.submitPlayerAction("usable1", ["t1m0:SnowCub"])).toThrow(/no player turn/);
  });
  it("unknown slot throws", () => {
    const s = oneVsOne();
    s.advance();
    expect(() => s.submitPlayerAction("usable9", ["t1m0:SnowCub"])).toThrow(/usable9/);
  });
  it("wrong target count throws", () => {
    const s = oneVsOne();
    s.advance();
    expect(() => s.submitPlayerAction("usable2", [])).toThrow(/1 target/);
  });
  it("clamps a two-enemy move to the sole remaining enemy", () => {
    const s = new BattleSession(
      gd,
      [[{ shortType: "Cockatrice", level: 50 }], [{ shortType: "SnowCub", level: 1 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    const step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    expect(step.choices.find((choice) => choice.slot === "usable3")?.targeting).toEqual({
      kind: "enemies",
      count: 2,
    });

    const events = s.submitPlayerAction("usable3", ["t1m0:SnowCub"]);
    expect(events).toContainEqual({
      type: "abilityUsed",
      source: "t0m0:Cockatrice",
      ability: "Offensive.DoubleAttack",
      targets: ["t1m0:SnowCub"],
    });
  });
  it("targeting a friendly with an enemies-kind ability throws", () => {
    const s = oneVsOne();
    s.advance();
    expect(() => s.submitPlayerAction("usable2", ["t0m0:FireCub"])).toThrow(/enemy/);
  });
  it("targeting a benched (inactive) enemy throws — only live targetableMembers are legal", () => {
    // fightingGroupSize 1 with a 2-monster enemy team: t1m1 starts on the bench.
    const s = new BattleSession(
      gd,
      [
        [{ shortType: "FireCub", level: 5 }],
        [
          { shortType: "SnowCub", level: 5 },
          { shortType: "SnowCub", level: 6 },
          { shortType: "Minotaur", level: 7 },
        ],
      ],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    expect(s.benchIdsOf(1)).toEqual(["t1m1:SnowCub", "t1m2:Minotaur"]);
    s.advance();
    expect(() => s.submitPlayerAction("usable2", ["t1m1:SnowCub"])).toThrow(/targetable/);
  });
});

describe("BattleSession - Analyze ability event", () => {
  it("emits native ability event 0 with nil arguments from the source phase", () => {
    const s = new BattleSession(
      gd,
      [[{ shortType: "Penguin", level: 12 }], [{ shortType: "Minotaur", level: 12 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    const step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    const analyze = step.choices.find((choice) => choice.abilityPath === "Utility.Analyze");
    expect(analyze).toBeDefined();

    const events = s.submitPlayerAction(analyze!.slot, []);
    expect(events).toContainEqual({ type: "abilityEvent", event: 0, arguments: null });
  });
});

describe("BattleSession - source toolbar actions", () => {
  it("skip-turn queues Utility.Delay for soonest opposing TU + 1, floored at 2", () => {
    const s = new BattleSession(
      gd,
      [[{ shortType: "FireCub", level: 10 }], [{ shortType: "SnowCub", level: 5 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    const step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    const opposingDelay = s.timeDelayOf("t1m0:SnowCub");
    expect(opposingDelay).toBeGreaterThan(1);

    const result = s.submitDelayAction();
    expect(result.activationLength).toBe(opposingDelay + 1);
    expect(result.events).toEqual([
      expect.objectContaining({ type: "turnStarted", living: "t0m0:FireCub" }),
      { type: "abilityUsed", source: "t0m0:FireCub", ability: "Utility.Delay", targets: [] },
    ]);
  });

  it("skip-turn floors a tied opposing TU 0 to activation length 2", () => {
    const s = oneVsOne();
    s.advance();
    expect(s.timeDelayOf("t1m0:SnowCub")).toBe(0);
    expect(s.submitDelayAction().activationLength).toBe(2);
  });

  it("skip-turn scans only active targetable opponents, excluding reserves", () => {
    const s = new BattleSession(
      gd,
      [
        [{ shortType: "FireCub", level: 100 }],
        [
          { shortType: "Minotaur", level: 5 },
          { shortType: "Spark", level: 100 },
        ],
      ],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    expect(s.advance().type).toBe("awaitingPlayer");
    const activeOpponentDelay = s.timeDelayOf("t1m0:Minotaur");
    expect(s.submitDelayAction().activationLength).toBe(Math.max(2, activeOpponentDelay + 1));
  });

  it("retreat succeeds when arc4random%100 is 29, emits terminal state 6, and consumes one draw", () => {
    const rng = sequenceRng([0.5, 0.5, 0.29]); // two initial delays, then retreat roll
    const s = new BattleSession(
      gd,
      [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
      rng,
      { fightingGroupSize: 1 },
    );
    s.advance();
    const result = s.submitRetreatAction(30);
    expect(result).toEqual({
      success: true,
      actorId: "t0m0:FireCub",
      events: [],
    });
    expect(rng.draws).toBe(3);
    expect(() => s.advanceForPresentation()).toThrow("battle already ended by retreat");
  });

  it("retreat fails when arc4random%100 is 30, appends RunAwayFailKey semantics, then queues LooseTurn", () => {
    const rng = sequenceRng([0.5, 0.5, 0.3, 0.5]); // final draw is LooseTurn sacrifice check
    const s = new BattleSession(
      gd,
      [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
      rng,
      { fightingGroupSize: 1 },
    );
    s.advance();
    const result = s.submitRetreatAction(30);
    expect(result).toMatchObject({
      success: false,
      actorId: "t0m0:FireCub",
      abilityPath: "Utility.LooseTurn",
      statusTextKey: "RunAwayFailKey",
    });
    expect(result.events).toEqual([
      expect.objectContaining({ type: "turnStarted", living: "t0m0:FireCub" }),
      { type: "abilityUsed", source: "t0m0:FireCub", ability: "Utility.LooseTurn", targets: [] },
    ]);
    expect(rng.draws).toBe(4);
  });
});

describe("BattleSession - StatOnly modifier integration", () => {
  it("applies Defensive.HasteUp with the native negative sign and stack identity", () => {
    const s = new BattleSession(
      gd,
      [[{ shortType: "BatSquirrel", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    let step = s.advance();
    while (step.type === "enemyTurnResolved") step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    const haste = step.choices.find((choice) => choice.abilityPath === "Defensive.HasteUp");
    expect(haste?.targeting).toEqual({ kind: "self" });
    s.submitPlayerAction(haste!.slot, []);
    expect(s.hasteOf(step.actorId)).toBe(Math.fround(-0.6));
    expect(s.activeBuffsOf(step.actorId)).toEqual([
      expect.objectContaining({ stackName: "hasteUp", duration: 500, stats: [] }),
    ]);
  });

  it("adds the source-level Defense bonus before the final stat round", () => {
    const level = 5;
    const s = new BattleSession(
      gd,
      [[{ shortType: "GiantCrab", level }], [{ shortType: "SnowCub", level: 1 }]],
      constantRng(0.5),
      { fightingGroupSize: 1 },
    );
    let step = s.advance();
    while (step.type === "enemyTurnResolved") step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    const defenseUp = step.choices.find((choice) => choice.abilityPath === "Defensive.DefenseUp");
    expect(defenseUp).toBeDefined();
    s.submitPlayerAction(defenseUp!.slot, []);
    const monster = gd.monsterByShortType("GiantCrab");
    expect(s.effectiveStatsOf(step.actorId).Defense).toBe(
      Math.round(Math.fround(baseStatRaw(monster, "Defense", level) + Math.fround(level * 1.5))),
    );
  });
});

describe("BattleSession - disabling status turn flow", () => {
  it("rejects Confuse on a boss", () => {
    const s = new BattleSession(
      gd,
      [[{ shortType: "BatFiend", level: 5 }], [{ shortType: "SnowCub", level: 5, boss: true }]],
      constantRng(0),
      { fightingGroupSize: 1 },
    );
    let step = s.advance();
    while (step.type === "enemyTurnResolved") step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    const confuse = step.choices.find((choice) => choice.abilityPath === "Offensive.Confuse.Confuse");
    s.submitPlayerAction(confuse!.slot, ["t1m0:SnowCub"]);
    expect(s.statusEffectsOf("t1m0:SnowCub")).toEqual([]);
  });

  it("Confuse can replace the affected monster's action with Utility.LooseTurn", () => {
    const s = new BattleSession(
      gd,
      [[{ shortType: "BatFiend", level: 5 }], [{ shortType: "SnowCub", level: 5 }]],
      constantRng(0),
      { fightingGroupSize: 1 },
    );
    let step = s.advance();
    while (step.type === "enemyTurnResolved") step = s.advance();
    expect(step.type).toBe("awaitingPlayer");
    if (step.type !== "awaitingPlayer") return;
    const confuse = step.choices.find((choice) => choice.abilityPath === "Offensive.Confuse.Confuse");
    s.submitPlayerAction(confuse!.slot, ["t1m0:SnowCub"]);
    expect(s.statusEffectsOf("t1m0:SnowCub")).toContain("Confuse");

    for (let i = 0; i < 5; i++) {
      const next = s.advanceForPresentation();
      if (next.type === "awaitingEnemy") {
        const resolved = s.submitEnemyAction();
        expect(resolved.abilityPath).toBe("Utility.LooseTurn");
        expect(resolved.events).toContainEqual(
          expect.objectContaining({ type: "abilityUsed", ability: "Utility.LooseTurn" }),
        );
        return;
      }
      if (next.type === "awaitingPlayer") {
        s.submitPlayerAction(confuse!.slot, ["t1m0:SnowCub"]);
      }
    }
    throw new Error("confused enemy did not reach its turn");
  });
});

describe("BattleSession - native Hero spirit side command", () => {
  it("installs an autonomous spirit without consuming the pending player action", () => {
    const s = oneVsOne();
    const pending = s.advanceForPresentation();
    expect(pending).toMatchObject({ type: "awaitingPlayer", actorId: "t0m0:FireCub" });

    const summoned = s.summonSpirit("Resistance", 0);
    expect(summoned.id).toContain(":Resistance");
    expect(summoned.events).toEqual([
      {
        type: "summonChanged",
        team: 0,
        removed: undefined,
        added: summoned.id,
        shortType: "Resistance",
        level: 12,
        origin: "spirit",
      },
    ]);
    expect(s.summonIdOf(0)).toBe(summoned.id);
    expect(s.targetableIdsOf(0)).toEqual(["t0m0:FireCub", summoned.id]);
    expect(s.queueOrder()).toContain(summoned.id);
    expect(s.isAiControlled(summoned.id)).toBe(true);

    // The already-pending FireCub turn is still valid and resolves normally.
    expect(() => s.submitPlayerAction("usable1", ["t1m0:SnowCub"])).not.toThrow();
  });

  it("replaces a previous spirit immediately and preserves the one-slot invariant", () => {
    const s = oneVsOne();
    s.advanceForPresentation();
    const first = s.summonSpirit("Resistance", 0);
    const second = s.summonSpirit("Fire", 400);
    expect(second.events).toEqual([
      expect.objectContaining({
        type: "summonChanged",
        team: 0,
        removed: first.id,
        added: second.id,
        shortType: "Fire",
        level: 23,
        origin: "spirit",
      }),
    ]);
    expect(s.summonIdOf(0)).toBe(second.id);
    expect(s.targetableIdsOf(0)).toEqual(["t0m0:FireCub", second.id]);
    expect(s.queueOrder()).not.toContain(first.id);
  });
});
