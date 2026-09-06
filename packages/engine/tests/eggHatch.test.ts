import { loadGameData, type GameData } from "@dib/gamedata";
import { describe, expect, it } from "vitest";
import {
  EGG_REEL_FRAME_SECONDS,
  EGG_REEL_FRICTION_MAX,
  EGG_REEL_FRICTION_MIN,
  EGG_REEL_FRICTION_RANGE,
  EGG_REEL_INITIAL_SPEED,
  EGG_REEL_MIN_HELD_FRAMES,
  EggReel,
  eggShuffle,
  eggRepeatCost,
  generateEggHatchPool,
  goldEggMonsterLevel,
  selectEggPreviewMonsters,
  type EggHatchPlayerView,
} from "../src/eggHatch.js";
import type { Rng } from "../src/rng.js";

const game = loadGameData();




const GOLDEN_REEL_FRAME_90 = {
  elapsedSeconds: 1.4999992847442627,
  index: 11.999994277954102,
  speed: 8,
  friction: 0,
  centerIndex: 4,
  stopped: false,
} as const;
const GOLDEN_REEL_FRAME_91_RELEASED = {
  elapsedSeconds: 1.5166659355163574,
  index: 12.13332748413086,
  speed: 8,
  friction: 3.1500000953674316,
  centerIndex: 5,
  stopped: false,
} as const;
const GOLDEN_REEL_STOP = {
  elapsedSeconds: 4.700006008148193,
  index: 22.358867645263672,
  speed: -2.0274834632873535,
  friction: 3.1500000953674316,
  centerIndex: 1,
  stopped: true,
} as const;

class ConstantRng implements Rng {
  draws = 0;
  constructor(private readonly value: number) {}
  next(): number {
    this.draws += 1;
    return this.value;
  }
  intBelow(n: number): number {
    if (!Number.isSafeInteger(n) || n < 1) throw new Error(`intBelow(${n})`);
    return Math.floor(this.next() * n);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

class RecordingZeroRng extends ConstantRng {
  readonly bounds: number[] = [];
  override intBelow(n: number): number {
    this.bounds.push(n);
    return super.intBelow(n);
  }
}

function playerView(overrides: Partial<EggHatchPlayerView> = {}): EggHatchPlayerView {
  return {
    highestRegisteredLevel: () => 0,
    highestRegisteredLivingLevel: 0,
    goldEggMonsterLevel: 25,
    availableGemSlots: [0, 2],
    hasCombineRecipe: () => false,
    spiritSavedXp: () => 0,
    ...overrides,
  };
}

describe("source egg reel", () => {
  it("accepts every press but ignores release through exactly 1.5 seconds", () => {
    const rng = new ConstantRng(0.5);
    const reel = new EggReel(16, rng);

    expect(reel.press()).toBe(true);
    reel.advance(1.5);
    expect(reel.release()).toBe(false);
    expect(rng.draws).toBe(0);
    expect(reel.state()).toMatchObject({
      elapsedSeconds: 1.5,
      index: 12,
      speed: EGG_REEL_INITIAL_SPEED,
      friction: 0,
      stopped: false,
    });

    reel.advance(0.001);
    expect(reel.release()).toBe(true);
    expect(reel.release()).toBe(false);
    expect(rng.draws).toBe(1);
    expect(reel.state().friction).toBeCloseTo(
      EGG_REEL_FRICTION_MIN + EGG_REEL_FRICTION_RANGE * 0.5,
    );
  });

  it("moves only by nonnegative speed and finishes below -2 slots/second", () => {
    const reel = new EggReel(7, new ConstantRng(0));
    reel.advance(1.5001);
    expect(reel.release()).toBe(true);
    let beforeStop = reel.state();
    while (!beforeStop.stopped) beforeStop = reel.advance(0.1);

    const stopped = reel.state();
    expect(stopped.speed).toBeLessThan(-2);
    expect(stopped.centerIndex).toBe(Math.floor(stopped.index) % 7);
    expect(reel.advance(1)).toEqual(stopped);
  });

  it("exposes the Official fixed replay frame and crosses the release gate only on its 91st frame", () => {
    const reel = new EggReel(16, new ConstantRng(0.5));
    for (let frame = 0; frame < 90; frame += 1) reel.advanceFrame();
    expect(reel.state().elapsedSeconds).toBeLessThanOrEqual(1.5);
    expect(reel.release()).toBe(false);

    reel.advanceFrame();
    expect(reel.state().elapsedSeconds).toBeGreaterThan(1.5);
    expect(reel.release()).toBe(true);
    expect(reel.state().friction).toBeCloseTo(
      EGG_REEL_FRICTION_MIN + EGG_REEL_FRICTION_RANGE * 0.5,
    );
    expect(reel.state().elapsedSeconds).toBeCloseTo(91 * EGG_REEL_FRAME_SECONDS, 5);
  });

  it("preserves the historical Official f32 frame, friction, stop-frame, and landing vectors", () => {
    const rng = new ConstantRng(0.75);
    const reel = new EggReel(7, rng, "legacy-v22");

    for (let frame = 0; frame < 90; frame += 1) reel.advanceFrame();
    expect(reel.state()).toEqual(GOLDEN_REEL_FRAME_90);
    expect(reel.release()).toBe(false);

    reel.advanceFrame();
    expect(reel.release()).toBe(true);
    expect(reel.state()).toEqual(GOLDEN_REEL_FRAME_91_RELEASED);
    expect(rng.draws).toBe(1);

    let frame = 91;
    while (!reel.state().stopped) {
      reel.advanceFrame();
      frame += 1;
    }
    expect(frame).toBe(282);
    expect(reel.state()).toEqual(GOLDEN_REEL_STOP);
    expect(reel.state().centerIndex).toBe(1);
  });
});

describe("authoritative egg reel replay", () => {
  it("names the 91st frame as the fewest holdable frames", () => {
    expect(EGG_REEL_MIN_HELD_FRAMES).toBe(91);
  });

  it("makes the free spin a pure function of the frame count, consuming no RNG", () => {
    // This is what lets the browser animate the spin unaided while the server reproduces the exact
    // same float32 position from the committed count alone.
    const rng = new ConstantRng(0.5);
    const counted = new EggReel(16, rng);
    const stepped = new EggReel(16, new ConstantRng(0.5));
    for (let frame = 0; frame < 137; frame += 1) stepped.advanceFrame();

    expect(counted.advanceFrames(137)).toEqual(stepped.state());
    expect(rng.draws).toBe(0);
    expect(counted.state().speed).toBe(EGG_REEL_INITIAL_SPEED);
  });

  it("reproduces a committed friction without a second draw", () => {
    const drawn = new EggReel(7, new ConstantRng(0.75));
    drawn.advanceFrames(EGG_REEL_MIN_HELD_FRAMES);
    expect(drawn.release()).toBe(true);
    const committed = drawn.state().friction;

    const replayRng = new ConstantRng(0.75);
    const replay = new EggReel(7, replayRng);
    replay.advanceFrames(EGG_REEL_MIN_HELD_FRAMES);
    expect(replay.replayRelease(committed)).toBe(true);
    expect(replayRng.draws).toBe(0);

    while (!drawn.state().stopped) drawn.advanceFrame();
    while (!replay.state().stopped) replay.advanceFrame();
    expect(replay.state()).toEqual(drawn.state());
  });

  it("refuses a replay friction outside the source range or before the gate", () => {
    const early = new EggReel(7, new ConstantRng(0));
    early.advanceFrames(EGG_REEL_MIN_HELD_FRAMES - 1);
    expect(early.replayRelease(3)).toBe(false);

    const reel = new EggReel(7, new ConstantRng(0));
    reel.advanceFrames(EGG_REEL_MIN_HELD_FRAMES);
    expect(() => reel.replayRelease(EGG_REEL_FRICTION_MIN - 0.01)).toThrowError(/outside the source range/);
    expect(() => reel.replayRelease(EGG_REEL_FRICTION_MAX + 0.01)).toThrowError(/outside the source range/);
    expect(reel.replayRelease(EGG_REEL_FRICTION_MAX)).toBe(true);
  });

  it("keeps every drawable friction inside the replayable range", () => {
    for (const draw of [0, 0.25, 0.5, 0.75, 0.999999]) {
      const reel = new EggReel(7, new ConstantRng(draw));
      reel.advanceFrames(EGG_REEL_MIN_HELD_FRAMES);
      reel.release();
      const friction = reel.state().friction;
      expect(friction).toBeGreaterThanOrEqual(EGG_REEL_FRICTION_MIN);
      expect(friction).toBeLessThanOrEqual(EGG_REEL_FRICTION_MAX);
    }
  });

  it("rejects a negative or fractional frame count", () => {
    const reel = new EggReel(7, new ConstantRng(0));
    expect(() => reel.advanceFrames(-1)).toThrowError(/nonnegative integer/);
    expect(() => reel.advanceFrames(1.5)).toThrowError(/nonnegative integer/);
  });
});

describe("source egg repeat pricing", () => {
  it("keeps the source Silver and Gold repeat prices", () => {
    expect(eggRepeatCost("silver")).toBe(100);
    expect(eggRepeatCost("gold")).toBe(298);
  });
});

describe("source egg provider construction", () => {
  it("shuffle removes one uniform object per output, including the final modulo-one draw", () => {
    const rng = new ConstantRng(0.999999);
    expect(eggShuffle(["a", "b", "c"], rng)).toEqual(["c", "b", "a"]);
    expect(rng.draws).toBe(3);
  });

  it("previews draw from every distinct species tied at or above the second-highest score", () => {
    const rng = new ConstantRng(0);
    const reel = [
      { kind: "monster", shortType: "BatKing", level: 1, prizeMonster: false },
      { kind: "monster", shortType: "BatKing", level: 1, prizeMonster: false },
      { kind: "monster", shortType: "FairyQueen", level: 1, prizeMonster: false },
      { kind: "monster", shortType: "Minotaur", level: 1, prizeMonster: false },
      { kind: "monster", shortType: "BlueBabyDragon", level: 1, prizeMonster: true },
    ] as const;
    const selected = selectEggPreviewMonsters(game, reel, rng);
    expect(selected).toHaveLength(2);
    expect(new Set(selected).size).toBe(2);
    expect(selected).not.toContain("BlueBabyDragon");
    expect(rng.draws).toBe(2);
  });

  it("counts tied scores in the preview cutoff after de-duplicating names", () => {
    const scoreGame = {
      monsterByShortType: (shortType: string) => ({
        stars: ({ A: 5, B: 5, C: 4, D: 4 } as Record<string, number>)[shortType]!,
      }),
    } as GameData;
    const prize = { kind: "monster", shortType: "Prize", level: 1, prizeMonster: true } as const;
    const provider = (shortType: string) =>
      ({ kind: "monster", shortType, level: 1, prizeMonster: false } as const);

    const tiedTopRng = new RecordingZeroRng(0);
    expect(selectEggPreviewMonsters(
      scoreGame,
      [provider("A"), provider("B"), provider("C"), prize],
      tiedTopRng,
    )).toEqual(["A", "B"]);
    expect(tiedTopRng.bounds).toEqual([2, 1]);

    const tiedSecondRng = new RecordingZeroRng(0);
    expect(selectEggPreviewMonsters(
      scoreGame,
      [provider("A"), provider("C"), provider("D"), prize],
      tiedSecondRng,
    )).toEqual(["A", "C"]);
    expect(tiedSecondRng.bounds).toEqual([3, 2]);
  });

  it("builds Golden Egg entirely from regular monsters plus its guaranteed baby dragon", () => {
    const pool = generateEggHatchPool(game, playerView(), "gold", new ConstantRng(0.999999));

    expect(pool.providers.every((prize) => prize.kind === "monster")).toBe(true);
    expect(pool.providers.filter((prize) =>
      prize.kind === "monster" && prize.prizeMonster)).toEqual([
      {
        kind: "monster",
        shortType: "GoldBabyDragon",
        level: 1,
        prizeMonster: true,
      },
    ]);
    for (const prize of pool.providers) {
      if (prize.kind !== "monster" || prize.prizeMonster) continue;
      const monster = game.monsterByShortType(prize.shortType);
      const root = game.monsterByShortType(game.evolveChainOf(prize.shortType)[0]!);
      expect(root.category).toBe("Normal");
      expect(prize.level).toBe(
        monster.evolveData === undefined
          ? 25
          : Math.min(25, Math.max(1, monster.evolveData.levelReq - 1)),
      );
    }
  });

  it("normalizes equal-quality Foundation ties only for Fidelity Lab generation", () => {
    const pool = generateEggHatchPool(
      game,
      playerView(),
      "gold",
      new ConstantRng(0),
      "lexicographic",
    );
    expect(pool.providers.filter((prize) => prize.kind === "monster").slice(0, 8)
      .map((prize) => prize.shortType)).toEqual([
        "BatFiend", "BatFiend", "WhitePiranha", "WhitePiranha",
        "Wolf", "Wolf", "BatSquirrel", "BatSquirrel",
      ]);
  });

  it("draws paired ordinary providers only from unseen species and keeps 16 as the progressed-player floor", () => {
    const pool = generateEggHatchPool(game, playerView({
      highestRegisteredLevel: () => 25,
    }), "gold", new ConstantRng(0.999999));

    // With no unseen ordinary species, source skips the paired loop and fills the monster portion
    // to 16 from the retained all-ordinary array, then appends the one guaranteed baby dragon.
    expect(pool.providers).toHaveLength(17);
    expect(pool.providers.filter((prize) =>
      prize.kind === "monster" && prize.prizeMonster)).toHaveLength(1);
  });

  it("keeps every shipped Gold progression prefix at or below the source's 25-entry maximum", () => {
    const catalog = game.allMonsters();
    let maximum = 0;
    for (let registeredCount = 0; registeredCount <= catalog.length; registeredCount += 1) {
      const registered = new Set(catalog.slice(0, registeredCount).map(({ shortType }) => shortType));
      const pool = generateEggHatchPool(game, playerView({
        highestRegisteredLevel: (shortType) => registered.has(shortType) ? 25 : 0,
      }), "gold", new ConstantRng(0.999999));
      maximum = Math.max(maximum, pool.providers.length);
      expect(pool.providers.length).toBeLessThanOrEqual(25);
    }
    expect(maximum).toBe(25);
  });

  it("gives ordinary Gold monsters the second-highest bench level, never the maximum", () => {


    expect(goldEggMonsterLevel([])).toBe(1);
    expect(goldEggMonsterLevel([80])).toBe(1);
    expect(goldEggMonsterLevel([80, 20])).toBe(20);
    expect(goldEggMonsterLevel([20, 80])).toBe(20);
    expect(goldEggMonsterLevel([80, 80])).toBe(80);
    expect(goldEggMonsterLevel([80, 60, 20])).toBe(60);
    expect(goldEggMonsterLevel([20, 60, 80])).toBe(60);
    expect(goldEggMonsterLevel([5, 5, 5])).toBe(5);
  });

  it("clamps the Gold level to evolveLevel - 1 and keeps every Silver monster at level 1", () => {
    // A non-evolving template must show the bench level unchanged, and an evolving one must clamp,
    // so a maximum-versus-second-highest regression cannot hide behind the clamp.
    const gold = generateEggHatchPool(game, playerView({ goldEggMonsterLevel: 9 }), "gold",
      new ConstantRng(0.999999));
    for (const prize of gold.providers) {
      if (prize.kind !== "monster" || prize.prizeMonster) continue;
      const evolveData = game.monsterByShortType(prize.shortType).evolveData;
      expect(prize.level).toBe(
        evolveData === undefined ? 9 : Math.min(9, Math.max(1, evolveData.levelReq - 1)),
      );
    }


    const silver = generateEggHatchPool(game, playerView({ goldEggMonsterLevel: 80 }), "silver",
      new ConstantRng(0.999999));
    for (const prize of silver.providers) {
      if (prize.kind !== "monster") continue;
      expect(prize.level).toBe(1);
    }
  });

  it("takes the progression threshold from the effective eggUnlockQuality, not a zero default", () => {
    // Wendigo declares 9 explicitly; DeathCrawler omits the key and so contributes its own
    // quality of 15. The threshold is 15, which keeps the four quality-10 species KingSlime,
    // Yacare, BloodKnight, and Shogun ordinary. Substituting zero for the omitted key drops the
    // threshold to 9, admits those four as rare, and inflates the Gold reel from 17 to 25.
    const registered = new Set(["Wendigo", "DeathCrawler"]);
    const pool = generateEggHatchPool(game, playerView({
      highestRegisteredLevel: (shortType) => registered.has(shortType) ? 25 : 0,
    }), "gold", new ConstantRng(0.999999));

    expect(pool.providers).toHaveLength(17);
    expect(pool.providers.filter((prize) =>
      prize.kind === "monster" && prize.prizeMonster)).toHaveLength(1);
    expect(pool.providers).toHaveLength(pool.reel.length);
    // Classification, not just count: threshold 15 leaves the rare array empty, so the rare loop
    // appends nothing and the head of the list is a paired unseen-ordinary draw from the tail of
    // the quality sort. Under a threshold of 9 the rare array fills from the quality-10 band
    // (`KingSlime`, `Yacare`, `BloodKnight`, `Shogun`, `Megaslug` — which four is Foundation
    // tie order, so assert the band rather than named species) and those open the list instead.
    for (const prize of pool.providers.slice(0, 4)) {
      expect(prize.kind).toBe("monster");
      if (prize.kind !== "monster") continue;
      expect(game.monsterByShortType(prize.shortType).quality).toBeGreaterThan(10);
    }
  });

  it("is not a one-way overpopulation: an omitted threshold can also raise the reel", () => {
    // BatKing has quality 6 and omits the key, so the source threshold is 6 and the reel reaches
    // the 25-entry maximum. A zero default would leave the threshold at its seed of 1 and yield
    // 17 entries, so neither "cap at 17" nor "cap at 25" repairs fidelity.
    expect(game.monsterByShortType("BatKing").quality).toBe(6);
    expect(game.monsterByShortType("BatKing").eggUnlockQuality).toBe(6);
    const pool = generateEggHatchPool(game, playerView({
      highestRegisteredLevel: (shortType) => shortType === "BatKing" ? 25 : 0,
    }), "gold", new ConstantRng(0.999999));
    expect(pool.providers).toHaveLength(25);
  });

  it("keeps a fully registered low-quality prefix at the 17-entry fill floor", () => {
    // Registering every eligible quality<=3 species empties the unseen array, so the paired loop
    // is skipped and the fill-to-16 tail runs against the retained all-ordinary array. The
    // pre-fix port mutated all-ordinary in the paired loop instead and reached 45 here.
    const registered = new Set(
      game.allMonsters().filter(({ quality }) => quality <= 3).map(({ shortType }) => shortType),
    );
    const pool = generateEggHatchPool(game, playerView({
      highestRegisteredLevel: (shortType) => registered.has(shortType) ? 25 : 0,
    }), "gold", new ConstantRng(0.999999));
    expect(pool.providers).toHaveLength(17);
  });

  it("uses the raw-confirmed four-entry Gold prize-monster order", () => {
    const expected = [
      [0, "BlueBabyDragon"],
      [0.25, "RedBabyDragon"],
      [0.5, "WhiteBabyDragon"],
      [0.75, "GoldBabyDragon"],
    ] as const;
    for (const [draw, shortType] of expected) {
      const pool = generateEggHatchPool(game, playerView(), "gold", new ConstantRng(draw));
      expect(pool.providers.find((prize) =>
        prize.kind === "monster" && prize.prizeMonster)).toMatchObject({ shortType, level: 1 });
    }
  });

  it("adds the exact nonrandom Silver Egg filler multiplicities and persistent-best gem level", () => {
    const registered = new Map([["BatKing", 42]]);
    const pool = generateEggHatchPool(game, playerView({
      highestRegisteredLevel: (shortType) => registered.get(shortType) ?? 0,
      highestRegisteredLivingLevel: 42,
    }), "silver", new ConstantRng(0.999999));

    expect(pool.providers.filter((prize) => prize.kind === "monster").length)
      .toBeGreaterThanOrEqual(8);
    expect(pool.providers.filter((prize) =>
      prize.kind === "gold" && prize.amount === 50)).toHaveLength(4);
    expect(pool.providers.filter((prize) =>
      prize.kind === "gold" && prize.amount === 150)).toHaveLength(2);
    expect(pool.providers.filter((prize) =>
      prize.kind === "silver" && prize.amount === 500)).toHaveLength(2);
    expect(pool.providers.filter((prize) =>
      prize.kind === "silver" && prize.amount === 1_500)).toHaveLength(2);
    expect(pool.providers.filter((prize) =>
      prize.kind === "item" && prize.definitionPath === "Usables.CardSilver")).toHaveLength(2);
    expect(pool.providers.filter((prize) =>
      prize.kind === "item" && prize.definitionPath === "Usables.CardGold")).toHaveLength(2);
    const gems = pool.providers.filter((prize) => prize.kind === "gem");
    expect(gems).toHaveLength(6);
    expect(gems.map((gem) => gem.level)).toEqual(Array(6).fill(42));
    expect(gems.map((gem) => gem.quality)).toEqual([0, 0, 0, 0, 1, 1]);
    // `randomItemStatsDictionaryForQuality:` runs quality+1 draws. In the standard Silver-Egg
    // pool, the two cyan GlowingGemNode prizes are therefore exactly the two-stat prizes.
    expect(gems.map((gem) => gem.enabledStats.length)).toEqual([1, 1, 1, 1, 2, 2]);
    expect(gems.every((gem) => gem.slot === 2)).toBe(true);
  });

  it("retains the lowest-score missing Recipe and empty Spirit Totem on the optional draws", () => {
    const pool = generateEggHatchPool(game, playerView(), "silver", new ConstantRng(0));
    const recipe = pool.providers.find((prize) => prize.kind === "recipe");
    const totem = pool.providers.find((prize) => prize.kind === "spiritTotem");
    const lowestRecipeScore = Math.min(...game.allCombineRecipes()
      .map(({ resultShortType }) => game.monsterByShortType(resultShortType).stars * 2));
    const lowestTotemScore = Math.min(...game.allMonsters()
      .filter(({ category }) => category === "Summon")
      .map(({ stars }) => stars * 2));

    expect(recipe?.kind).toBe("recipe");
    expect(game.monsterByShortType(recipe!.combineName).stars * 2).toBe(lowestRecipeScore);
    expect(totem?.kind).toBe("spiritTotem");
    expect(game.monsterByShortType(totem!.shortType).stars * 2).toBe(lowestTotemScore);
  });

  it("uses the complete persistent Living maximum for generated Gem levels", () => {
    const pool = generateEggHatchPool(game, playerView({
      highestRegisteredLevel: () => 3,
      highestRegisteredLivingLevel: 77,
    }), "silver", new ConstantRng(0.999999));

    expect(pool.providers.filter((prize) => prize.kind === "gem")
      .every((prize) => prize.kind === "gem" && prize.level === 77)).toBe(true);
  });

  it("rejects the fourth inventory slot because Egg.slotProviders probes only 0..2", () => {
    expect(() => generateEggHatchPool(
      game,
      playerView({ availableGemSlots: [3] }),
      "silver",
      new ConstantRng(0),
    )).toThrow(/only source slots 0, 1, and 2/);
  });

  it("uses nil-to-zero with no slot draw when the license exposes none of slots 0..2", () => {
    const emptyRng = new ConstantRng(0.999999);
    const oneRng = new ConstantRng(0.999999);
    const empty = generateEggHatchPool(
      game,
      playerView({ availableGemSlots: [] }),
      "silver",
      emptyRng,
    );
    generateEggHatchPool(
      game,
      playerView({ availableGemSlots: [0] }),
      "silver",
      oneRng,
    );
    expect(empty.providers.filter((prize) => prize.kind === "gem")
      .every((prize) => prize.kind === "gem" && prize.slot === 0)).toBe(true);
    expect(oneRng.draws - emptyRng.draws).toBe(6);
  });
});
