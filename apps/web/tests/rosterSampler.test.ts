import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import {
  encounterUsesKnownMonsters,
  RANDOM_LEVEL_RANGE,
  RANDOM_TEAM_SIZE,
  rosterRng,
  sampleEncounter,
} from "../src/battle/rosterSampler.js";
import { DEMO_ENCOUNTER } from "../src/battle/encounter.js";
import { DEMO_FEATURE_ROLLS } from "../src/battle/encounter.js";

const gd = loadGameData();

describe("sampleEncounter", () => {
  it("detects whether a fixed encounter belongs to the selected content roster", () => {
    expect(encounterUsesKnownMonsters(gd, DEMO_ENCOUNTER)).toBe(true);
    expect(
      encounterUsesKnownMonsters(gd, {
        ...DEMO_ENCOUNTER,
        enemyTeam: [{ shortType: "IndependentCleanRoomSpecies", level: 1 }],
      }),
    ).toBe(false);
  });

  it("draws 9 per side, all 18 distinct, levels inside RANDOM_LEVEL_RANGE", () => {
    const enc = sampleEncounter(gd, rosterRng(1234));
    expect(enc.playerTeam).toHaveLength(RANDOM_TEAM_SIZE);
    expect(enc.enemyTeam).toHaveLength(RANDOM_TEAM_SIZE);
    const all = [...enc.playerTeam, ...enc.enemyTeam];
    expect(new Set(all.map((m) => m.shortType)).size).toBe(RANDOM_TEAM_SIZE * 2);
    const [min, max] = RANDOM_LEVEL_RANGE;
    for (const m of all) {
      expect(m.level).toBeGreaterThanOrEqual(min);
      expect(m.level).toBeLessThanOrEqual(max);
    }
  });

  it("is deterministic under a fixed seed and varies across seeds", () => {
    const a = sampleEncounter(gd, rosterRng(42));
    const b = sampleEncounter(gd, rosterRng(42));
    const c = sampleEncounter(gd, rosterRng(43));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("samples only real roster monsters and can reach the whole roster", () => {
    const roster = new Set(gd.allMonsters().map((m) => m.shortType));
    const seen = new Set<string>();
    for (let seed = 0; seed < 200; seed++) {
      const enc = sampleEncounter(gd, rosterRng(seed));
      for (const m of [...enc.playerTeam, ...enc.enemyTeam]) {
        expect(roster.has(m.shortType)).toBe(true);
        seen.add(m.shortType);
      }
    }
    // 200 draws x 18 slots over a 224-monster pool: every monster should have appeared. The
    // probability any single monster misses all 3600 uniform slots is (1-18/224)^200 ~ 5e-8.
    expect(seen.size).toBe(roster.size);
  });

  it("builds a clean roster with no feature rolls unless opted in", () => {
    // The reusable-builder default: without `featureRolls` a real encounter carries only its
    // explicit conditions — no boss, no soul stone, no non-capturable is ever synthesized.
    for (let seed = 0; seed < 40; seed++) {
      const enc = sampleEncounter(gd, rosterRng(seed));
      for (const m of [...enc.playerTeam, ...enc.enemyTeam]) {
        expect(m.boss).toBeUndefined();
        expect(m.soulStone).toBeUndefined();
        expect(m.capturable).toBeUndefined();
      }
    }
  });

  it("opt-in featureRolls randomizes boss / soul stones with data-valid stones, never non-capturable", () => {
    const stoneElements = new Set(gd.allMonsters().map((m) => m.element));
    let bosses = 0;
    let noncapturable = 0;
    let stones = 0;
    for (let seed = 0; seed < 40; seed++) {
      const enc = sampleEncounter(gd, rosterRng(seed), { featureRolls: DEMO_FEATURE_ROLLS });
      for (const m of [...enc.playerTeam, ...enc.enemyTeam]) {
        if (m.boss) bosses++;
        if (m.capturable === false) noncapturable++;
        if (m.soulStone) {
          stones++;
          // Every random stone must resolve against the shipped Items.json entries fail-free.
          expect(stoneElements.has(m.soulStone.element)).toBe(true);
          expect(gd.soulStoneByElement(m.soulStone.element).element).toBe(m.soulStone.element);
          expect(Number.isInteger(m.soulStone.level)).toBe(true);
          expect(m.soulStone.level).toBeGreaterThanOrEqual(1);
        }
      }
    }
    // 40 seeds x 18 slots = 720 rolls: boss/stone features must actually occur at their opt-in
    // rate, while `capturable` is never randomly stripped (only explicit pins turn it off).
    expect(bosses).toBeGreaterThan(0);
    expect(noncapturable).toBe(0);
    expect(stones).toBeGreaterThan(0);
  });

  it("never rolls a random soul stone onto a Utility.Desoul carrier (fail-loud perform)", () => {
    const carriers = gd
      .allMonsters()
      .map((m) => m.shortType)
      .filter((t) => gd.jobAbilitiesOrEmpty(t).some((a) => a.type === "Utility.Desoul"));
    expect(carriers.length).toBeGreaterThan(0); // data premise: the guard has something to guard
    const carrier = carriers[0]!;
    for (let seed = 0; seed < 60; seed++) {
      const enc = sampleEncounter(gd, rosterRng(seed), {
        playerTeam: [{ shortType: carrier }],
        featureRolls: DEMO_FEATURE_ROLLS,
      });
      expect(enc.playerTeam[0]!.soulStone).toBeUndefined();
    }
    // An explicit pin bypasses the guard on purpose.
    const pinned = sampleEncounter(gd, rosterRng(1), {
      playerTeam: [{ shortType: carrier, soulStone: { element: "Death", level: 5 } }],
    });
    expect(pinned.playerTeam[0]!.soulStone).toEqual({ element: "Death", level: 5 });
  });

  it("pins any field by position on either side, randomizing the rest", () => {
    for (let seed = 0; seed < 25; seed++) {
      const enc = sampleEncounter(gd, rosterRng(seed), {
        playerTeam: [
          { shortType: "KemetGod" },
          undefined, // hole: slot 2 fully randomized
          { level: 30, boss: true, soulStone: null },
        ],
        enemyTeam: [
          undefined,
          { shortType: "Minotaur", capturable: false, soulStone: { element: "Fire", level: 10 } },
        ],
      });
      expect(enc.playerTeam[0]!.shortType).toBe("KemetGod");
      expect(enc.playerTeam[2]).toMatchObject({ level: 30, boss: true });
      expect(enc.playerTeam[2]!.soulStone).toBeUndefined();
      expect(enc.enemyTeam[1]).toMatchObject({
        shortType: "Minotaur",
        capturable: false,
        soulStone: { element: "Fire", level: 10 },
      });
      // Random picks stay distinct from each other AND from every pinned type.
      const types = [...enc.playerTeam, ...enc.enemyTeam].map((m) => m.shortType);
      expect(new Set(types).size).toBe(RANDOM_TEAM_SIZE * 2);
    }
  });

  it("pinned duplicate shortTypes are allowed; random picks never collide with them", () => {
    const enc = sampleEncounter(gd, rosterRng(5), {
      playerTeam: [{ shortType: "SnowCub" }],
      enemyTeam: [{ shortType: "SnowCub" }],
    });
    expect(enc.playerTeam[0]!.shortType).toBe("SnowCub");
    expect(enc.enemyTeam[0]!.shortType).toBe("SnowCub");
    const rest = [...enc.playerTeam.slice(1), ...enc.enemyTeam.slice(1)].map((m) => m.shortType);
    expect(rest).not.toContain("SnowCub");
    expect(new Set(rest).size).toBe(rest.length);
  });

  it("team sizes: explicit override, auto-growth to the pin array, and undersize rejection", () => {
    const sized = sampleEncounter(gd, rosterRng(9), { playerTeamSize: 3, enemyTeamSize: 12 });
    expect(sized.playerTeam).toHaveLength(3);
    expect(sized.enemyTeam).toHaveLength(12);

    const grown = sampleEncounter(gd, rosterRng(9), {
      playerTeam: Array.from({ length: 11 }, () => ({})),
    });
    expect(grown.playerTeam).toHaveLength(11);
    expect(grown.enemyTeam).toHaveLength(RANDOM_TEAM_SIZE);

    expect(() =>
      sampleEncounter(gd, rosterRng(9), { playerTeam: [{}, {}], playerTeamSize: 1 }),
    ).toThrow(/playerTeamSize 1 < 2/);
  });

  it("levelRange override bounds every random level; invalid inputs throw", () => {
    const enc = sampleEncounter(gd, rosterRng(3), { levelRange: [20, 20] });
    for (const m of [...enc.playerTeam, ...enc.enemyTeam]) expect(m.level).toBe(20);

    expect(() => sampleEncounter(gd, rosterRng(3), { levelRange: [5, 4] })).toThrow(/levelRange/);
    expect(() =>
      sampleEncounter(gd, rosterRng(3), { enemyTeam: [{ shortType: "NotAMonster" }] }),
    ).toThrow(/unknown shortType "NotAMonster" \(enemyTeam\[0\]\)/);
    expect(() => sampleEncounter(gd, rosterRng(3), { playerTeam: [{ level: 0 }] })).toThrow(
      /bad level 0 \(playerTeam\[0\]\)/,
    );
  });

  it("every sampled monster produces at least one player choice (full-roster validity)", () => {
    // Cheap standing guard: the sampler intentionally has NO eligibility filter, so every
    // monster in the pool must be player-usable.
    const enc = sampleEncounter(gd, rosterRng(7));
    for (const m of enc.playerTeam) {
      expect(gd.jobAbilitiesOrEmpty(m.shortType).length).toBeGreaterThan(0);
    }
  });
});
