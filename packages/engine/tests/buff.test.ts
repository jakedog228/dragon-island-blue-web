import { describe, expect, it } from "vitest";
import { loadGameData, type AbilityDef } from "@dib/gamedata";
import {
  advanceStatOnlyBuffs,
  allowsStatOnlyBuff,
  createStatOnlyBuff,
  statOnlyBonus,
} from "../src/buff.js";
import { BattleCore } from "../src/core.js";
import { baseStatRaw } from "../src/stats.js";
import type { Rng } from "../src/rng.js";

const gd = loadGameData();

const constantRng: Rng = {
  next: () => 0.5,
  intBelow: (n) => Math.floor(n / 2),
  chance: (p) => 0.5 < p,
};

describe("Buffs.StatOnly", () => {
  it("derives level from the source, applies native stat weights, and preserves sign", () => {
    const up = createStatOnlyBuff({
      sourceId: "caster",
      sourceLevel: 5,
      stats: ["Attack", "Defense", "Resist"],
    });
    expect(up.level).toBe(5);
    expect(statOnlyBonus(up, "Attack")).toBe(5);
    expect(statOnlyBonus(up, "Defense")).toBe(7.5);
    expect(statOnlyBonus(up, "Resist")).toBe(7.5);
    expect(statOnlyBonus(up, "Magic")).toBe(0);

    const down = createStatOnlyBuff({
      sourceId: "caster",
      sourceLevel: 5,
      stats: ["Defense"],
      statsHelp: false,
    });
    expect(statOnlyBonus(down, "Defense")).toBe(-7.5);

    const scaled = createStatOnlyBuff({
      sourceId: "caster",
      sourceLevel: 5,
      sourceLevelScalor: 0.5,
      stats: ["Magic"],
    });
    expect(scaled.level).toBe(3);
    expect(statOnlyBonus(scaled, "Magic")).toBe(3);
  });

  it("rejects an equal non-nil stackName but allows anonymous and opposite haste stacks", () => {
    const hasteUp = createStatOnlyBuff({
      sourceId: "caster",
      sourceLevel: 1,
      haste: -0.6,
      stackName: "hasteUp",
    });
    const anotherUp = createStatOnlyBuff({
      sourceId: "caster",
      sourceLevel: 1,
      haste: -0.6,
      stackName: "hasteUp",
    });
    const hasteDown = createStatOnlyBuff({
      sourceId: "caster",
      sourceLevel: 1,
      haste: 0.3,
      stackName: "hasteDown",
    });
    const anonymous = createStatOnlyBuff({ sourceId: "caster", sourceLevel: 1 });
    expect(allowsStatOnlyBuff([hasteUp], anotherUp)).toBe(false);
    expect(allowsStatOnlyBuff([hasteUp], hasteDown)).toBe(true);
    expect(allowsStatOnlyBuff([anonymous], anonymous)).toBe(true);
  });

  it("expires only after queue-time notifications reduce durationLeft to zero or below", () => {
    const timed = createStatOnlyBuff({ sourceId: "caster", sourceLevel: 1, duration: 500 });
    const permanent = createStatOnlyBuff({ sourceId: "caster", sourceLevel: 1 });
    let active = advanceStatOnlyBuffs([timed, permanent], 499);
    expect(active).toHaveLength(2);
    expect(timed.durationLeft).toBe(1);
    active = advanceStatOnlyBuffs(active, 1);
    expect(active).toEqual([permanent]);
  });

  it("clamps current HP from the pre-round accumulator only when a MaxHP modifier changes", () => {
    const level = 5;
    const core = new BattleCore(
      gd,
      [[{ shortType: "FireCub", level }], [{ shortType: "SnowCub", level }]],
      constantRng,
      { fightingGroupSize: 1 },
    );
    core.seedAndStart();
    const ability: AbilityDef = {
      path: "Test.MaxHpDown",
      className: "CombatAbility",
      activationLength: "100",
      components: [{ type: "Utility.StatMod", arguments: { stat: "MaxHP", help: false } }],
      targetPicker: { selfOnly: true },
      raw: { eventData: { friendlyTargetEventData: {} } },
    };
    let actorId = "";
    core.resolveTurn((id) => {
      actorId = id;
      return {
        ability,
        args: {},
        enemyTargets: [],
        friendlyTargets: [id],
        rngDraws: 0,
      };
    });
    const monster = gd.monsterByShortType(core.shortTypeOf(actorId));
    const rawMaxHp = Math.fround(baseStatRaw(monster, "MaxHP", level) - level);
    expect(core.maxHpOf(actorId)).toBe(Math.max(0, Math.round(rawMaxHp)));
    expect(core.hpOf(actorId)).toBe(Math.trunc(rawMaxHp));
  });
});
