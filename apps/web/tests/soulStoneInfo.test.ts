import { describe, it, expect } from "vitest";
import {
  soulStoneSmallItemStatRows,
  soulStoneStatRows,
  LIVING_STAT_NAMES,
} from "../src/battle/soulStoneInfoMath.js";


describe("soulStoneStatRows (ItemInfoDisplay's stat table, soulstone-info-display.md §3.1)", () => {
  it("FireSoulStone (Attack only): one row, value = level * 1.0", () => {
    expect(soulStoneStatRows(100, ["Attack"])).toEqual([{ statType: 1, value: 100 }]);
  });

  it("keeps MaxHP — the removeObjectForKey:\"0\" strip is LivingInfoDisplay-only, not the item path", () => {
    // Life stone enables MaxHP/Defense/Resist (gameData.test.ts).
    expect(soulStoneStatRows(10, ["MaxHP", "Defense", "Resist"])).toEqual([
      { statType: 0, value: 10 },
      { statType: 4, value: 15 },
      { statType: 5, value: 15 },
    ]);
  });

  it("truncates toward zero, not rounds: level 23 x Resist weight 1.5 = 34.5 -> 34", () => {
    expect(soulStoneStatRows(23, ["Defense", "Resist"])).toEqual([
      { statType: 4, value: 34 },
      { statType: 5, value: 34 },
    ]);
  });

  it("drops a stat whose truncated value is < 1 (the (int)v >= 1 inclusion gate)", () => {
    // level 0 stone: every product is 0 — nothing renders.
    expect(soulStoneStatRows(0, ["Attack", "Resist"])).toEqual([]);
  });

  it("emits rows in fixed stat-enum order regardless of enabledStats order", () => {
    const rows = soulStoneStatRows(50, ["Resist", "Attack", "Magic", "Defense"]);
    expect(rows.map((r) => r.statType)).toEqual([1, 2, 4, 5]);
    expect(rows.map((r) => LIVING_STAT_NAMES[r.statType])).toEqual([
      "Attack",
      "Magic",
      "Defense",
      "Resist",
    ]);
  });

  it("Arcane spread at an odd level: 1.0-weight stats stay integral, 1.5-weight stats truncate", () => {
    expect(soulStoneStatRows(7, ["Attack", "Magic", "Defense", "Resist"])).toEqual([
      { statType: 1, value: 7 },
      { statType: 2, value: 7 },
      { statType: 4, value: 10 }, // 10.5 -> 10
      { statType: 5, value: 10 },
    ]);
  });
});

describe("soulStoneSmallItemStatRows (Insert Soul Stone's SmallItemDisplay)", () => {
  it("uses source roundf rather than ItemInfoDisplay's truncation", () => {
    expect(soulStoneSmallItemStatRows(23, ["MaxHP", "Defense", "Resist"])).toEqual([
      { statType: 0, value: 23 },
      { statType: 4, value: 35 },
      { statType: 5, value: 35 },
    ]);
  });

  it("preserves fixed enum order and positive-only filtering", () => {
    expect(soulStoneSmallItemStatRows(7, ["Resist", "Attack", "Magic", "Defense"]))
      .toEqual([
        { statType: 1, value: 7 },
        { statType: 2, value: 7 },
        { statType: 4, value: 11 },
        { statType: 5, value: 11 },
      ]);
    expect(soulStoneSmallItemStatRows(0, ["Attack"])).toEqual([]);
  });
});
