import { describe, expect, it } from "vitest";
import { BattleRoster } from "../src/battle/battleRoster.js";
import { DEMO_ENCOUNTER } from "../src/battle/encounter.js";

describe("BattleRoster", () => {
  it("centralizes stable battle ids and immutable construction facts", () => {
    const roster = new BattleRoster({
      backgroundKey: "ForestCombat",
      playerTeam: [
        { shortType: "FireCub", level: 12, sourceInstanceId: "owned-7" },
        { shortType: "SnowCub", level: 8 },
      ],
      enemyTeam: [{ shortType: "Minotaur", level: 15 }],
    });

    expect(roster.entries().map((entry) => entry.id)).toEqual([
      "t0m0:FireCub",
      "t0m1:SnowCub",
      "t1m0:Minotaur",
    ]);
    expect(roster.entryOf("t0m0:FireCub")).toMatchObject({
      team: 0,
      constructionIndex: 0,
      setup: { shortType: "FireCub", level: 12, sourceInstanceId: "owned-7" },
      createdMidBattle: false,
    });
  });

  it("uses constructed levels for display and capture without rewriting encounter or legacy facts", () => {
    const encounter = { backgroundKey: "ForestCombat", playerTeam: [{ shortType: "FireCub", level: 150 }],
      enemyTeam: [{ shortType: "Centurion", level: 151 }] };
    const current = new BattleRoster(encounter, 0, () => 150);
    expect(current.entryOf("t1m0:Centurion").setup.level).toBe(150);
    expect(encounter.enemyTeam[0]!.level).toBe(151);
    const historical = new BattleRoster(encounter, 0, id => id.startsWith("t1") ? 151 : 150);
    expect(historical.entryOf("t1m0:Centurion").setup.level).toBe(151);
    const guest = new BattleRoster(encounter, 1, id => id.startsWith("t0") ? 149 : 150);
    expect(guest.entryOf("t0m0:Centurion").setup.level).toBe(149);
  });

  it("fails loudly for an id outside the encounter", () => {
    const roster = new BattleRoster({
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "FireCub", level: 12 }],
      enemyTeam: [{ shortType: "Spark", level: 12 }],
    });
    expect(() => roster.entryOf("t0m9:FireCub")).toThrow(/unknown living id/);
  });

  it("registers mid-battle summons (monsterAdded) with the engine's own construction index, idempotently", () => {
    const roster = new BattleRoster({
      backgroundKey: "ForestCombat",
      playerTeam: [{ shortType: "Slime", level: 10 }],
      enemyTeam: [{ shortType: "Spark", level: 12 }],
    });
    // A Slime "Split" clone: the engine's per-team counter continues past the initial roster.
    roster.registerMidBattle("t0m1:Slime", 0, { shortType: "Slime", level: 10 });
    expect(roster.entryOf("t0m1:Slime")).toMatchObject({
      team: 0,
      constructionIndex: 1,
      setup: { shortType: "Slime", level: 10 },
      createdMidBattle: true,
    });
    // Idempotent: a replayed presentation run must not duplicate the entry.
    roster.registerMidBattle("t0m1:Slime", 0, { shortType: "Slime", level: 10 });
    expect(roster.entries().filter((entry) => entry.id === "t0m1:Slime")).toHaveLength(1);
  });

  it("keeps the demo's original active trio first and provides three ordered reserves per side", () => {
    expect(DEMO_ENCOUNTER.playerTeam).toHaveLength(6);
    expect(DEMO_ENCOUNTER.enemyTeam).toHaveLength(6);
    expect(DEMO_ENCOUNTER.playerTeam.map((member) => member.shortType)).toEqual([
      // KemetGod first for testing (6-jobAbility carrier: passive rows + card scroll overflow).
      "KemetGod", "SnowCub", "WhiteDragonling", "Penguin", "Fairy", "Kingpen",
    ]);
    expect(DEMO_ENCOUNTER.enemyTeam.map((member) => member.shortType)).toEqual([
      "Minotaur", "Spark", "UnhappyBird", "FireCub", "SnowCub", "WhiteDragonling",
    ]);
  });
});
