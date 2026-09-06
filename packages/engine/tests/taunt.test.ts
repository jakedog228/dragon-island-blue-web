// Taunt-redirect integration (targeting-passives.md §A) + BerserkAbility (§C) against real
// GameData carriers, through BattleCore/BattleSession. The redirect ALGORITHM's branch anchors
// (weights, clamps, sole-element fast path, permutation property) live in ai.test.ts; this file
// covers the world-side plumbing: `targetPriorityOf` aggregation (static passives + live buffs)
// and the queAbility-time rewrite actually landing hits on the taunter.

import { describe, it, expect } from "vitest";
import { loadGameData, type AbilityDef } from "@dib/gamedata";
import { BattleCore } from "../src/core.js";
import { BattleSession } from "../src/session.js";
import { battleLivingId, type TeamMemberSetup } from "../src/events.js";
import { mulberry32 } from "../src/rng.js";
import type { AiDecision } from "../src/ai.js";

const gd = loadGameData();

const NOOP_ABILITY: AbilityDef = {
  path: "Test.Noop",
  className: "CombatAbility",
  components: [],
  targetPicker: {},
  raw: {},
};

function noopDecision(): AiDecision {
  return {
    ability: NOOP_ABILITY,
    args: { activationLength: 100, noHaste: true },
    enemyTargets: [],
    friendlyTargets: [],
    rngDraws: 0,
  };
}

const ATTACK_ABILITY: AbilityDef = {
  path: "Test.Attack",
  className: "CombatAbility",
  components: [{ type: "Offensive.Attack" }],
  targetPicker: { enemyTargets: 1 },
  raw: { eventData: { enemyTargetEventData: {} } },
};

describe("targetPriorityOf aggregation (targeting-passives.md §A's per-candidate sum)", () => {
  it("CrabKing's static EasyTarget passive contributes +50; a cast Scapegoat self-buff adds +9999 on top", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "FireCub", level: 10 }],
      [{ shortType: "CrabKing", level: 10 }],
    ];
    const core = new BattleCore(gd, teams, mulberry32(1), { fightingGroupSize: 1 });
    core.seedAndStart();
    const cubId = battleLivingId(0, 0, "FireCub");
    const crabId = battleLivingId(1, 0, "CrabKing");

    // Static passive only (args-over-dict read of the "EasyTarget" Passive.Generic ref).
    expect(core.aiWorld.targetPriorityOf!(crabId)).toBe(50);
    expect(core.aiWorld.targetPriorityOf!(cubId)).toBe(0);

    // Cast CrabKing's own usable4 (Defensive.Scapegoat: sourceBuffs StatOnly with
    // targetPriorityAdjustment 9999, duration 500) — buildBuff threads the value automatically.
    for (let i = 0; i < 10 && core.frontActorId() !== crabId; i++) {
      core.resolveTurn(() => noopDecision());
    }
    const scapegoatRef = gd.jobAbilitiesOrEmpty("CrabKing").find((r) => r.slot === "usable4")!;
    expect(gd.ability(scapegoatRef.type).path).toBe("Defensive.Scapegoat");
    core.resolveTurn(() => ({
      ability: gd.ability(scapegoatRef.type),
      args: scapegoatRef.arguments,
      enemyTargets: [],
      friendlyTargets: [crabId],
      rngDraws: 0,
    }));
    expect(core.aiWorld.targetPriorityOf!(crabId)).toBe(50 + 9999);
  });
});

describe("queAbility-time redirect against a real EasyTarget carrier", () => {
  /** One seeded 1-vs-2 battle: the player FireCub attacks the plain enemy FireCub while a
   *  CrabKing (EasyTarget +50) stands beside it. Returns who actually got hit. */
  function runOnce(seed: number): { hitCrab: boolean; altered: boolean } {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "FireCub", level: 10 }],
      [
        { shortType: "FireCub", level: 10 },
        { shortType: "CrabKing", level: 10 },
      ],
    ];
    const core = new BattleCore(gd, teams, mulberry32(seed), { fightingGroupSize: 2 });
    core.seedAndStart();
    const heroId = battleLivingId(0, 0, "FireCub");
    const plainId = battleLivingId(1, 0, "FireCub");
    const crabId = battleLivingId(1, 1, "CrabKing");

    for (let i = 0; i < 10 && core.frontActorId() !== heroId; i++) {
      core.resolveTurn(() => noopDecision());
    }
    const before = core.events.length;
    core.resolveTurn(() => ({
      ability: ATTACK_ABILITY,
      args: {},
      enemyTargets: [plainId], // the player PICKED the plain FireCub — never the CrabKing
      friendlyTargets: [],
      rngDraws: 0,
    }));
    const turnEvents = core.events.slice(before);
    const hits = turnEvents.filter((e) => e.type === "damageDealt" && e.source === heroId);
    const altered = turnEvents.some((e) => e.type === "targetAltered" && e.target === crabId);
    return { hitCrab: hits.some((e) => e.type === "damageDealt" && e.target === crabId), altered };
  }

  it("across seeds, EasyTarget steals the picked hit sometimes (weight 50 vs the original's 100) — and the two outcomes agree with targetAltered", () => {
    let stolen = 0;
    let kept = 0;
    for (let seed = 0; seed < 40; seed++) {
      const { hitCrab, altered } = runOnce(seed);
      expect(altered).toBe(hitCrab); // targetAltered fires exactly when a non-original was drawn
      if (hitCrab) stolen++;
      else kept++;
    }
    // Weight 50/(100+50): expected ~1/3 steals over 40 seeds — assert both outcomes occur, not
    // an exact split (mulberry32 seeds are arbitrary but deterministic).
    expect(stolen).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(0);
  });
});

describe("BerserkAbility (targeting-passives.md §C) — Yeti's Passive.Berserk", () => {
  it("a player-team Yeti is AI-piloted for the whole battle: never awaitingPlayer, battle completes", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Yeti", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(4), { fightingGroupSize: 1 });

    let steps = 0;
    for (;;) {
      if (++steps > 400) throw new Error("berserk battle did not terminate");
      const step = session.advance();
      if (step.type === "ended") break;
      // A Berserk'd team-0 monster resolves through the AI path (enemyTurnResolved), exactly
      // like a wild monster whose `ai` was never nil. awaitingPlayer must never surface.
      expect(step.type).toBe("enemyTurnResolved");
    }
  });

  it("a plain player-team monster still awaits player input (control: Berserk is the only trigger)", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "FireCub", level: 10 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = new BattleSession(gd, teams, mulberry32(4), { fightingGroupSize: 1 });
    let step = session.advance();
    while (step.type === "enemyTurnResolved") step = session.advance();
    expect(step.type).toBe("awaitingPlayer");
  });
});
