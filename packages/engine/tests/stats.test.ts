import { describe, it, expect } from "vitest";
import { loadGameData } from "@dib/gamedata";
import type { StatName } from "@dib/gamedata";
import { baseStat, maxHp } from "../src/stats.js";

const gd = loadGameData();

describe("baseStat", () => {
  it("matches hand-computed BatFiend values (stars=2, integer S)", () => {
    // rootStats: Attack 1.5, MaxHP 8.9, Speed 6 (see gamedata/tests/gameData.test.ts)
    const m = gd.monsterByShortType("BatFiend");
    expect(baseStat(m, "Attack", 1)).toBe(5);
    expect(baseStat(m, "Attack", 10)).toBe(18);
    expect(baseStat(m, "Attack", 22)).toBe(36);

    expect(baseStat(m, "MaxHP", 1)).toBe(28);
    expect(baseStat(m, "MaxHP", 10)).toBe(108);
    expect(baseStat(m, "MaxHP", 22)).toBe(215);

    expect(baseStat(m, "Speed", 1)).toBe(19);
    expect(baseStat(m, "Speed", 10)).toBe(73);
    expect(baseStat(m, "Speed", 22)).toBe(145);
  });

  it("matches hand-computed values for a half-star monster (stars=1.5, fractional S)", () => {
    // Animal.Bitewing: stars=1.5, rootStats.Attack=2 (verified against extracted/data/Monsters.json).
    // S=1.5 -> starsMul = 1.5/3 + 5/1.5 = 0.5 + 3.333333 = 3.833333 (float32)
    // L1:  round(2 * 3.833333)              = round(7.666667) = 8
    // L10: round(2 * (3.833333 + 9))        = round(25.666667) = 26
    const m = gd.monsterByShortType("Bitewing");
    expect(m.stars).toBe(1.5);
    expect(m.rootStats.Attack).toBe(2);
    expect(baseStat(m, "Attack", 1)).toBe(8);
    expect(baseStat(m, "Attack", 10)).toBe(26);
  });

  it("clamps level to [1,150] like the binary's spawn-time clamp", () => {
    const m = gd.monsterByShortType("BatFiend");
    expect(baseStat(m, "Attack", 0)).toBe(baseStat(m, "Attack", 1));
    expect(baseStat(m, "Attack", -5)).toBe(baseStat(m, "Attack", 1));
    expect(baseStat(m, "Attack", 150)).toBe(baseStat(m, "Attack", 200));
    expect(baseStat(m, "Attack", 151)).toBe(baseStat(m, "Attack", 150));
  });

  it("is monotonically non-decreasing in level for every monster, every stat, L1..150", () => {
    const stats: StatName[] = ["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"];
    const monsters = gd.allMonsters();
    expect(monsters.length).toBe(224);
    for (const m of monsters) {
      for (const stat of stats) {
        let prev = baseStat(m, stat, 1);
        for (let level = 2; level <= 150; level++) {
          const cur = baseStat(m, stat, level);
          expect(cur).toBeGreaterThanOrEqual(prev);
          prev = cur;
        }
      }
    }
  });

  it("matches an independent term-by-term float32 oracle for every monster/stat/level 1..150", () => {
    // Independently-written reference: the two float32 products are computed and rounded to
    // float32 SEPARATELY, then summed and rounded once — mirroring the binary's op order
    // (Monster.modifyBaseStat term1, Job.bonusForStat term2, Living.valueForCachedStat sum+round).
    // This is the guard that catches the folded-formula bug: `base*(starsMul+level-1)` is a
    // real-number identity but NOT a float32 identity, and diverges at 142 triples.
    const oracle = (rawBase: number, S: number, level: number): number => {
      const f = Math.fround;


      const base = f(rawBase);
      const starsMul = f(f(S / 3) + f(5 / S));
      const term1 = f(base * starsMul);
      const term2 = f(base * (level - 1));
      const raw = f(term1 + term2);
      return Math.max(0, Math.round(raw));
    };
    const stats: StatName[] = ["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"];
    const monsters = gd.allMonsters();
    expect(monsters.length).toBe(224);
    for (const m of monsters) {
      for (const stat of stats) {
        const base = m.rootStats[stat];
        for (let level = 1; level <= 150; level++) {
          expect(baseStat(m, stat, level)).toBe(oracle(base, m.stars, level));
        }
      }
    }
  });

  it("maxHp(m, l) is equivalent to baseStat(m, 'MaxHP', l)", () => {
    for (const m of gd.allMonsters()) {
      for (const level of [1, 10, 22, 75, 150]) {
        expect(maxHp(m, level)).toBe(baseStat(m, "MaxHP", level));
      }
    }
  });
});
