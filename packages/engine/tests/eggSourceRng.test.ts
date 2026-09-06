import { loadGameData, type GameData } from "@dib/gamedata";
import { describe, expect, it } from "vitest";
import { EggReel, generateEggHatchPool, selectEggPreviewMonsters,
  type EggHatchPlayerView } from "../src/eggHatch.js";
import { touchHleArc4Random, type Rng } from "../src/rng.js";
import silverVector from "./fixtures/egg-source-rng.json";
import nativeSilver from "./fixtures/egg-native-silver-rng.json";

const game = loadGameData();
const player: EggHatchPlayerView = {
  highestRegisteredLevel: () => 0,
  highestRegisteredLivingLevel: 0,
  goldEggMonsterLevel: 1,
  availableGemSlots: [],
  hasCombineRecipe: () => false,
  spiritSavedXp: () => 0,
};

// Independently translated from BNDB branches and shipped plist data using Python, not captured
// from the implementation under test.
describe("source Egg RNG sequence", () => {
  it("scans licensed slots in source order without duplicate choices", () => {
    const a = touchHleArc4Random(1);
    const b = touchHleArc4Random(1);
    const canonical = generateEggHatchPool(game, { ...player, availableGemSlots: [0, 2] }, "silver", a);
    const unordered = generateEggHatchPool(game, { ...player, availableGemSlots: [2, 0, 2] }, "silver", b);
    expect(unordered).toEqual(canonical);
    expect(a.cursor).toBe(b.cursor);
    expect(a.rawState).toBe(b.rawState);
  });
  it("matches the reported native Silver shuffle and Cockatrice winning slot", () => {
    const rng = touchHleArc4Random(0xfd0411e6);
    const registered: Record<string, number> = nativeSilver.registered;
    const pool = generateEggHatchPool(game, {
      ...player, highestRegisteredLevel: (key) => registered[key] ?? 0,
      highestRegisteredLivingLevel: 8,
    }, "silver", rng, "lexicographic");
    expect(pool.providers).toEqual(nativeSilver.providers);
    expect(pool.reel).toEqual(nativeSilver.reelProviderIndices.map((index) => nativeSilver.providers[index]));
    expect(rng.cursor + 575).toBe(652);
    expect(selectEggPreviewMonsters(game, pool.providers, rng)).toEqual(["Drake", "DireWolf"]);
    rng.intBelow(1);
    expect(rng.cursor + 575).toBe(655);
    expect(rng.rawState).toBe(0xc5e76855);
    expect(pool.reel[35]).toMatchObject({ kind: "monster", shortType: "Cockatrice" });
    expect(pool.providers[12]).toMatchObject({ kind: "monster", shortType: "Cockatrice" });
  });

  it("normalizes recipe keys and decimal Monsterpedia ordinals for equal-star optional prizes", () => {
    const monsters = Array.from({ length: 12 }, (_, i) => ({
      shortType: i === 1 ? "ASecond" : i === 9 ? "ZTenth" : `Other${i}`,
      path: `Fixture.${i}`, index: (i + 1) * 100, quality: 1, eggUnlockQuality: 1, stars: 1,
      category: i === 1 || i === 9 ? "Summon" : "Combine",
    }));
    const fixture = {
      allMonsters: () => [...monsters].reverse(),
      monsterByShortType: (key: string) => monsters.find((m) => m.shortType === key)!,
      evolveChainOf: (key: string) => [key],
      allCombineRecipes: () => [{ resultShortType: "Other8" }, { resultShortType: "Other0" }],
    } as unknown as GameData;
    const rng: Rng = { next: () => 0, intBelow: () => 0, chance: () => true };
    const pool = generateEggHatchPool(fixture, player, "silver", rng, "lexicographic");
    expect(pool.providers.find((p) => p.kind === "recipe"))
      .toEqual({ kind: "recipe", combineName: "Other0" });
    // String ordinal "10" precedes "2" despite raw index 1000>200 and name Z>A.
    expect(pool.providers.find((p) => p.kind === "spiritTotem"))
      .toEqual({ kind: "spiritTotem", shortType: "ZTenth" });
  });
  it("matches Silver's independently derived prizes, Gem stats, shuffle, previews and release stream", () => {
    const rng = touchHleArc4Random(1);
    const pool = generateEggHatchPool(game, player, "silver", rng, "lexicographic");
    expect(pool.providers).toEqual(silverVector.providers);
    expect(pool.reel).toEqual(silverVector.reelProviderIndices.map((index) => silverVector.providers[index]));
    expect(rng.cursor).toBe(silverVector.shuffleDrawEnd);
    expect(selectEggPreviewMonsters(game, pool.providers, rng)).toEqual(silverVector.previews);
    expect(rng.cursor).toBe(silverVector.previewDrawEnd);
    expect(rng.rawState).toBe(silverVector.stateAfterPreviews);
    rng.intBelow(1); // SlotMachineNode.onEnter selects the sole Casino track.
    expect(rng.rawState).toBe(silverVector.stateBeforeRelease);
    const reel = new EggReel(pool.reel.length, rng);
    reel.advanceFrames(137);
    expect(reel.release()).toBe(true);
    expect(rng.rawState).toBe(silverVector.releaseU32);
    expect(reel.state().friction).toBe(silverVector.friction);
  });
  it("matches the full-path Gold candidate, baby, shuffle, and preview vector", () => {
    const rng = touchHleArc4Random(1);
    const pool = generateEggHatchPool(game, player, "gold", rng, "lexicographic");
    const names = (prizes: typeof pool.providers) => prizes.map((p) => p.kind === "monster" && p.shortType);
    expect(names(pool.providers)).toEqual([
      "WhitePiranha", "WhitePiranha", "Wolf", "Wolf", "BatSquirrel", "BatSquirrel",
      "BatFiend", "BatFiend", "RedBabyDragon",
    ]);
    expect(names(pool.reel)).toEqual([
      "BatFiend", "Wolf", "WhitePiranha", "RedBabyDragon", "BatSquirrel", "BatFiend",
      "BatSquirrel", "WhitePiranha", "Wolf",
    ]);
    expect(rng.cursor).toBe(14); // four rare + baby + nine shuffle, including %1
    expect(selectEggPreviewMonsters(game, pool.providers, rng)).toEqual(["BatFiend", "Wolf"]);
    expect(rng.cursor).toBe(16);
    expect(rng.rawState).toBe(3385103793);
  });

  it("consumes ten discarded Silver constructor draws before parity, but none for Gold", () => {
    for (const kind of ["silver", "gold"] as const) {
      const source = touchHleArc4Random(1);
      const calls: (number | "discard")[] = [];
      const rng: Rng = {
        next: () => { calls.push("discard"); return source.next(); },
        intBelow: (n) => { calls.push(n); return source.intBelow(n); },
        chance: () => { throw new Error("unexpected chance draw"); },
      };
      generateEggHatchPool(game, player, kind, rng, "lexicographic");
      expect(calls.slice(0, 4)).toEqual([4, 3, 2, 1]);
      if (kind === "silver") {
        expect(calls.slice(4, 16)).toEqual([...Array(10).fill("discard"), 2, 2]);
      } else {
        expect(calls).not.toContain("discard");
        expect(calls.slice(4)).toEqual([4, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      }
    }
  });

  it.each([
    [0, 2.6999998092651367],
    [1, 2.6999998092651367],
    [0x35565843, 2.8250091075897217],
    [0x80000000, 2.999999761581421],
    [0xc0000000, 3.1499998569488525],
    [0xffffffff, 3.299999713897705],
  ])("matches raw ARM friction for U32 %i with exactly one accepted-release draw", (raw, friction) => {
    let draws = 0;
    const rng: Rng = {
      next: () => { draws++; return raw / 2 ** 32; },
      intBelow: () => { throw new Error("release uses the normalized float channel"); },
      chance: () => { throw new Error("unexpected chance draw"); },
    };
    const reel = new EggReel(45, rng);
    reel.advance(1.5);
    expect(reel.release()).toBe(false);
    expect(draws).toBe(0);
    reel.advance(0.02);
    expect(reel.release()).toBe(true);
    expect(reel.state().friction).toBe(friction);
    expect(reel.release()).toBe(false);
    expect(draws).toBe(1);
  });
});
