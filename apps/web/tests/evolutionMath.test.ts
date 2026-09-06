import { describe, expect, it } from "vitest";
import type { MonsterDef } from "@dib/gamedata";
import {
  EVOLVE_STAR_ROW_SHOW_DELAY_MS,
  EVOLVE_STAR_TWINKLE_MS,
  canEvolveAt,
  evolutionBannerLayoutPt,
  evolutionBattingPrefix,
  evolutionLayoutPt,
  evolutionOutlineOffsets,
  evolutionRenderableTypes,
  firstEvolveCandidate,
  flipScaleX,
  isNewEvolutionStar,
} from "../src/battle/evolutionMath.js";

function def(shortType: string, evolveData?: { levelReq: number; newType: string }): MonsterDef {
  return {
    path: `Test.${shortType}`,
    shortType,
    category: "Normal",
    element: "Fire",
    index: 0,
    quality: 1,
    eggUnlockQuality: 1, // loader-materialized native default (omitted key copies `quality`)
    stars: 2,
    rootStats: { Attack: 1, Defense: 1, Magic: 1, MaxHP: 1, Resist: 1, Speed: 1 },
    unarmedAttackType: "Bite",
    ...(evolveData ? { evolveData } : {}),
  };
}

const defs = new Map<string, MonsterDef>([
  ["Hatchling", def("Hatchling", { levelReq: 10, newType: "Drake" })],
  ["Drake", def("Drake", { levelReq: 20, newType: "Wyvern" })],
  ["Wyvern", def("Wyvern")],
  ["Pup", def("Pup", { levelReq: 5, newType: "Wolf" })],
  ["Wolf", def("Wolf")],
]);
const defOf = (shortType: string): MonsterDef => defs.get(shortType)!;

describe("canEvolveAt (canEvolve @ 0x86cd8)", () => {
  it("requires evolveData and level >= levelReq", () => {
    expect(canEvolveAt(defOf("Hatchling"), 9)).toBe(false);
    expect(canEvolveAt(defOf("Hatchling"), 10)).toBe(true);
    expect(canEvolveAt(defOf("Wyvern"), 150)).toBe(false); // no evolveData
  });
});

describe("firstEvolveCandidate (the beginEvolve:/performEvolution first-match scans)", () => {
  it("returns the FIRST eligible entry in list order, or undefined", () => {
    const list = [
      { shortType: "Wyvern", level: 99 },
      { shortType: "Hatchling", level: 12 },
      { shortType: "Pup", level: 7 },
    ];
    expect(firstEvolveCandidate(list, defOf)?.shortType).toBe("Hatchling");
    expect(firstEvolveCandidate([{ shortType: "Hatchling", level: 3 }], defOf)).toBeUndefined();
  });


  it("agrees with the bench scan for every prefix, since batting is a bench prefix", () => {
    const bench = [
      { shortType: "Wyvern", level: 99 },
      { shortType: "Hatchling", level: 12 },
      { shortType: "Wolf", level: 40 },
      { shortType: "Pup", level: 7 },
    ];
    const benchPick = firstEvolveCandidate(bench, defOf);
    expect(benchPick?.shortType).toBe("Hatchling");
    for (let n = 1; n <= bench.length; n++) {
      const batting = bench.slice(0, n);
      const battingPick = firstEvolveCandidate(batting, defOf);
      // Whenever the prefix scan finds anyone at all, it is the very same object the full
      // bench scan picks — never merely an equal-looking one.
      if (battingPick) expect(battingPick).toBe(benchPick);
    }
  });

  it("diverges if batting is NOT a bench prefix — the shape of the fixed port bug", () => {
    const bench = [
      { shortType: "Hatchling", level: 12 },
      { shortType: "Pup", level: 7 },
    ];


    const deadFirstBatting = [...bench].reverse();
    expect(firstEvolveCandidate(deadFirstBatting, defOf)?.shortType).toBe("Pup");
    expect(firstEvolveCandidate(bench, defOf)?.shortType).toBe("Hatchling");
  });
});

describe("evolutionBattingPrefix (trip-owned post-battle identity)", () => {
  it("observes a same-battle level-up and terminates after the bench member evolves", () => {
    const bench = [
      { id: "hatchling", shortType: "Hatchling", level: 9 },
      { id: "reserve", shortType: "Pup", level: 7 },
    ];
    const batting = evolutionBattingPrefix(bench, 1);

    expect(batting[0]).toBe(bench[0]);
    expect(firstEvolveCandidate(batting, defOf)).toBeUndefined();

    // performAwardLogic mutates the bench model after crossing the threshold.
    bench[0]!.level = 10;
    expect(firstEvolveCandidate(batting, defOf)).toBe(bench[0]);

    // performEvolution mutates that same object. The following beginEvolve scan must clear;
    // a separately mapped batting copy would remain an eligible Hatchling forever.
    bench[0]!.shortType = "Drake";
    expect(firstEvolveCandidate(batting, defOf)).toBeUndefined();
    expect(firstEvolveCandidate(bench, defOf)?.id).toBe("reserve");
  });

  it("rejects a prefix length outside the concrete bench", () => {
    expect(() => evolutionBattingPrefix([{ id: "only" }], 2)).toThrow(
      "length must be an integer in [0, 1]",
    );
  });
});

describe("evolutionLayoutPt (dual-mode)", () => {
  it("keeps the iPhone point values in iphone mode", () => {
    expect(evolutionLayoutPt("iphone")).toEqual({
      nameGapPt: 10,
      nameFontPt: 20,
      nameOutlineRadiusPt: 3,
      starGapPt: 5,
    });
  });

  it("halves every bare literal in normalized iPad space (unscaledIdiomPt class)", () => {
    expect(evolutionLayoutPt("ipad")).toEqual({
      nameGapPt: 5,
      nameFontPt: 10,
      nameOutlineRadiusPt: 1.5,
      starGapPt: 2.5,
    });
  });

  it("uses sub_660cc's twelve 30-degree outline samples", () => {
    const offsets = evolutionOutlineOffsets(3);
    expect(offsets).toHaveLength(12);
    expect(offsets[0]).toEqual({ x: 3, y: 0 });
    expect(offsets[3]!.x).toBeCloseTo(0, 12);
    expect(offsets[3]!.y).toBeCloseTo(3, 12);
    expect(offsets[6]!.x).toBeCloseTo(-3, 12);
    expect(offsets[6]!.y).toBeCloseTo(0, 12);
  });
});

describe("evolutionRenderableTypes (pre-animation synchronous asset set)", () => {
  it("includes each current species and only the stages reachable at its current level", () => {
    expect(evolutionRenderableTypes([
      { shortType: "Hatchling", level: 10 },
      { shortType: "Pup", level: 4 },
    ], defOf)).toEqual(["Hatchling", "Drake", "Pup"]);
    expect(evolutionRenderableTypes([{ shortType: "Hatchling", level: 20 }], defOf)).toEqual([
      "Hatchling",
      "Drake",
      "Wyvern",
    ]);
  });

  it("fails loudly on an eligible evolve-chain cycle", () => {
    const cyclic = new Map<string, MonsterDef>([
      ["A", def("A", { levelReq: 1, newType: "B" })],
      ["B", def("B", { levelReq: 1, newType: "A" })],
    ]);
    expect(() => evolutionRenderableTypes([{ shortType: "A", level: 1 }], (name) => cyclic.get(name)!))
      .toThrow("evolve-chain cycle at A");
  });
});

describe("evolution banner geometry (beginEvolve: @ 0xc6b38..0xc6c0c)", () => {
  it("uses source top-center anchoring and CCTexture2D's normalized half-size on iPhone", () => {
    const layout = evolutionBannerLayoutPt("iphone");
    expect(layout).toEqual({
      anchor: { x: 0.5, y: 0 },
      position: { x: 240, y: 10 },
      textureScale: 0.5,
    });
    expect({
      left: layout.position.x - 380 * layout.textureScale * layout.anchor.x,
      top: layout.position.y,
      right: layout.position.x + 380 * layout.textureScale * (1 - layout.anchor.x),
      bottom: layout.position.y + 23 * layout.textureScale,
    }).toEqual({ left: 145, top: 10, right: 335, bottom: 21.5 });
  });

  it("halves the bare top inset but preserves the same normalized texture size on iPad", () => {
    const layout = evolutionBannerLayoutPt("ipad");
    expect(layout).toEqual({
      anchor: { x: 0.5, y: 0 },
      position: { x: 256, y: 5 },
      textureScale: 0.5,
    });
    expect({
      left: layout.position.x - 380 * layout.textureScale * layout.anchor.x,
      top: layout.position.y,
      right: layout.position.x + 380 * layout.textureScale * (1 - layout.anchor.x),
      bottom: layout.position.y + 23 * layout.textureScale,
    }).toEqual({ left: 161, top: 5, right: 351, bottom: 16.5 });
  });
});

describe("evolution rarity-star reveal (performEvolution @ 0xc7356..0xc7944)", () => {
  it("runs the 4s elastic scale immediately and reveals both hidden rows at 1s", () => {
    expect(EVOLVE_STAR_TWINKLE_MS).toBe(4000);
    expect(EVOLVE_STAR_ROW_SHOW_DELAY_MS).toBe(1000);
  });

  it("uses native integer-stars + halfStar comparisons, including half-to-full transitions", () => {
    expect(isNewEvolutionStar(1, 1, false)).toBe(false);
    expect(isNewEvolutionStar(1, 2, false)).toBe(true);
    expect(isNewEvolutionStar(1, 1, true)).toBe(true); // 1 -> 1.5
    expect(isNewEvolutionStar(1.5, 1, true)).toBe(false);
    expect(isNewEvolutionStar(1.5, 2, false)).toBe(true); // 1.5 -> 2.0
    expect(isNewEvolutionStar(1.5, 2, true)).toBe(true); // 1.5 -> 2.5
  });
});

describe("flipScaleX (Repeat(ScaleBy(·, -1x, 1x), reps) mirror-flip math)", () => {
  it("starts at +1, mirrors through 0 each rep, and lands back at +1 after an even rep count", () => {
    expect(flipScaleX(12, 0)).toBe(1);
    expect(flipScaleX(12, 1)).toBe(1);
    expect(flipScaleX(4, 1)).toBe(1);
  });

  it("is at -start mid-way through an odd rep boundary and 0 at each quarter-flip", () => {
    // eased progress 0.5/12 reps -> exactly the end of rep 6 -> scaleX back at +1
    expect(flipScaleX(12, 6 / 12)).toBe(1);
    // end of rep 1 (progress 1/12): one full flip -> -1
    expect(flipScaleX(12, 1 / 12)).toBeCloseTo(-1, 12);
    // half of rep 1: squashed through zero
    expect(flipScaleX(12, 0.5 / 12)).toBeCloseTo(0, 12);
  });
});
