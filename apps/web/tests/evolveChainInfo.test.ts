import { describe, it, expect } from "vitest";
import type { MonsterDef } from "@dib/gamedata";
import { evolveChainInfoRows, evolveRowFontPt } from "../src/battle/evolveChainInfoMath.js";


function mon(shortType: string, evolveTo?: string, levelReq?: number): MonsterDef {
  return {
    path: `Test.${shortType}`,
    shortType,
    category: "Normal",
    element: "Fire",
    index: 0,
    quality: 1,
    eggUnlockQuality: 1, // loader-materialized native default (omitted key copies `quality`)
    stars: 1,
    rootStats: { Attack: 1, Defense: 1, Magic: 1, MaxHP: 1, Resist: 1, Speed: 1 },
    unarmedAttackType: "Bite",
    ...(evolveTo !== undefined ? { evolveData: { levelReq: levelReq!, newType: evolveTo } } : {}),
  };
}

const CHAIN = ["BatSquirrel", "GiantBat", "Doombat", "BatKing"] as const;
const MONSTERS = new Map<string, MonsterDef>([
  ["BatSquirrel", mon("BatSquirrel", "GiantBat", 10)],
  ["GiantBat", mon("GiantBat", "Doombat", 22)],
  ["Doombat", mon("Doombat", "BatKing", 33)],
  ["BatKing", mon("BatKing")],
]);
const byShortType = (t: string): MonsterDef => {
  const m = MONSTERS.get(t);
  if (!m) throw new Error(`unknown ${t}`);
  return m;
};

describe("evolveChainInfoRows (evolve-chain-rows.md §3)", () => {
  it("all unlocked: one row per evolving stage, last stage structurally never rows", () => {
    expect(evolveChainInfoRows([...CHAIN], () => true, byShortType)).toEqual([
      { shortType: "BatSquirrel", evolveLevel: 10 },
      { shortType: "GiantBat", evolveLevel: 22 },
      { shortType: "Doombat", evolveLevel: 33 },
    ]);
  });

  it("nothing unlocked: zero rows (failed gate skips the row entirely, no placeholder)", () => {
    expect(evolveChainInfoRows([...CHAIN], () => false, byShortType)).toEqual([]);
  });

  it("gate keys on the NEXT stage, not the row's own stage", () => {
    // Only Doombat discovered → exactly GiantBat's row (its NEXT stage is Doombat). Neither
    // BatSquirrel (next GiantBat, undiscovered) nor Doombat (next BatKing, undiscovered) rows —
    // the "don't spoil an undiscovered evolution path" design.
    expect(evolveChainInfoRows([...CHAIN], (t) => t === "Doombat", byShortType)).toEqual([
      { shortType: "GiantBat", evolveLevel: 22 },
    ]);
  });

  it("evolveLevel is the CURRENT stage's own evolveData.levelReq (not the next stage's)", () => {
    const rows = evolveChainInfoRows([...CHAIN], (t) => t === "GiantBat", byShortType);
    expect(rows).toEqual([{ shortType: "BatSquirrel", evolveLevel: 10 }]);
  });

  it("length-1 chain (non-evolving monster): zero rows — the section must not render", () => {
    expect(evolveChainInfoRows(["BatKing"], () => true, byShortType)).toEqual([]);
  });

  it("fails loudly on a next-having stage without evolveData (corrupt chain/data)", () => {
    expect(() =>
      evolveChainInfoRows(["BatKing", "Phantom"], () => true, byShortType),
    ).toThrow(/no evolveData/);
  });
});

describe("evolveRowFontPt (data_b5bec/data_b5bf0 = 16/32, a doubled idiom pair)", () => {
  it("is 16pt in iPhone mode", () => {
    expect(evolveRowFontPt("iphone")).toBe(16);
  });
  it("lands back on 16pt in normalized iPad mode (32 native / 2)", () => {
    expect(evolveRowFontPt("ipad")).toBe(16);
  });
});
