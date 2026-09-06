import { describe, expect, it } from "vitest";
import { heroLevelForXp } from "@dib/engine";
import {
  PlayerProfile,
  battingOrderSizeFor,
  chainCollapsedHeroTotal,
  minimumHeroTotalForLevel,
  type PlayerProfileStateSnapshot,
} from "../src/playerProfile.js";

/** A three-stage line, a two-stage line, and a species that never evolves. */
const CHAINS: Readonly<Record<string, readonly string[]>> = {
  FallenAngel: ["FallenAngel", "Demon", "Archdemon"],
  Demon: ["FallenAngel", "Demon", "Archdemon"],
  Archdemon: ["FallenAngel", "Demon", "Archdemon"],
  BatSquirrel: ["BatSquirrel", "GiantBat"],
  GiantBat: ["BatSquirrel", "GiantBat"],
  Minotaur: ["Minotaur"],
};
const evolveChainOf = (shortType: string): readonly string[] | undefined => CHAINS[shortType];

function profileWith(
  registered: Record<string, number>,
  options: { chains?: boolean; licenseBattingOrderSize?: number } = {},
  party?: { monsters(): readonly { shortType: string; level: number }[];
            setBattingOrderSize?(size: number): void },
): PlayerProfile {
  const total = chainCollapsedHeroTotal(
    registered,
    options.chains === false ? undefined : evolveChainOf,
  );
  return new PlayerProfile({
    heroLevel: heroLevelForXp(total),
    heroTotalHighestLevels: total,
    monsterPartyLevels: [1],
    silver: 0,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
    highestCapturedLevels: registered,
    ...(options.chains === false ? {} : { evolveChainOf }),
    ...(options.licenseBattingOrderSize === undefined
      ? {}
      : { licenseBattingOrderSize: options.licenseBattingOrderSize }),
  }, party);
}

describe("sumHighestLevels: one contribution per evolution chain", () => {
  it("counts a line once, at its highest registered stage", () => {


    expect(chainCollapsedHeroTotal(
      { FallenAngel: 16, Demon: 53, Archdemon: 60 },
      evolveChainOf,
    )).toBe(60);
    // The max is over the chain, not the last-registered stage: a lower stage carried further wins.
    expect(chainCollapsedHeroTotal({ FallenAngel: 71, Demon: 53 }, evolveChainOf)).toBe(71);
  });

  it("adds chainless and archive-unknown species individually", () => {
    // A species with no chain entry adds its own value — the same rule for a chain of one.
    expect(chainCollapsedHeroTotal({ Minotaur: 8, Cleanling: 5 }, evolveChainOf)).toBe(13);
  });

  it("sums every species when no chain index is supplied", () => {
    expect(chainCollapsedHeroTotal({ FallenAngel: 16, Demon: 53, Archdemon: 60 })).toBe(129);
  });

  it("moves the hero total only as far as a registration pushes its chain's maximum", () => {
    const player = profileWith({ Archdemon: 60 });
    expect(player.heroTotalHighestLevels).toBe(60);

    // An ancestor below the line's high-water mark: registered, but worth no hero XP.
    expect(player.recordCapturedMonster("Demon", 53)).toBe(true);
    expect(player.highestRegisteredLevel("Demon")).toBe(53);
    expect(player.heroTotalHighestLevels).toBe(60);

    // A different line adds its own contribution.
    expect(player.recordCapturedMonster("BatSquirrel", 10)).toBe(true);
    expect(player.heroTotalHighestLevels).toBe(70);

    // Pushing the same line past its maximum adds only the difference.
    expect(player.recordCapturedMonster("GiantBat", 24)).toBe(true);
    expect(player.heroTotalHighestLevels).toBe(84);

    // And the whole-registry recomputation agrees with the incremental accounting.
    expect(player.heroTotalHighestLevels).toBe(chainCollapsedHeroTotal({
      Archdemon: 60, Demon: 53, BatSquirrel: 10, GiantBat: 24,
    }, evolveChainOf));
  });

  it("restates a pre-v7 snapshot's total under the collapsed reading", () => {
    // v6 stored `prior + Σ(registration)`; the same collection under the source's own rule is
    // `prior + chain maxima`, which is what v7 stores.
    const legacy = {
      schemaVersion: 6,
      hero: { level: heroLevelForXp(129 + 20), totalHighestLevels: 129 + 20 },
      silver: 0,
      gold: 0,
      inventory: { schemaVersion: 1, nextItemSequence: 1, looseItems: [], equippedGems: {} },
      licenseType: "Novice",
      skillPoints: { MaxHP: 0, Attack: 0, Magic: 0, Speed: 0, Defense: 0, Resist: 0 },
      highestCapturedLevels: { FallenAngel: 16, Demon: 53, Archdemon: 60 },
      learnedCombineRecipes: [],
      tutorialFlags: [],
      catchQuestsDone: [],
      dungeonWaypoints: {},
      tournament: { schemaVersion: 1, index: 0, round: 0, status: 0 },
      spiritEnergy: 0,
      spiritSavedXp: {},
      spiritsUsedThisTrip: [],
    } as unknown as PlayerProfileStateSnapshot;

    const restored = PlayerProfile.fromStateSnapshot(legacy, [1], undefined, { evolveChainOf });
    // The 20 points of unenumerable prior history survive; the 69 points of double-counted
    // evolution stages do not.
    expect(restored.heroTotalHighestLevels).toBe(60 + 20);
    const snapshot = restored.stateSnapshot();
    expect(snapshot.schemaVersion).toBe(8);
    expect(snapshot.hero.totalHighestLevels).toBe(80);

    // The collapsed total is a fixed point: reloading it does not move the total again.
    const again = PlayerProfile.fromStateSnapshot(snapshot, [1], undefined, { evolveChainOf });
    expect(again.heroTotalHighestLevels).toBe(80);
    expect(again.heroLevel).toBe(restored.heroLevel);
  });
});

describe("battingOrderSize: license, hero level, Infinite Dungeon", () => {
  it("adds one slot per three hero levels and one per ten Infinite floors", () => {
    expect(battingOrderSizeFor(5, 1)).toBe(5);
    expect(battingOrderSizeFor(5, 3)).toBe(6);
    expect(battingOrderSizeFor(5, 8)).toBe(7);
    expect(battingOrderSizeFor(7, 9)).toBe(10);
    expect(battingOrderSizeFor(16, 36)).toBe(28);
    expect(battingOrderSizeFor(5, 1, { infiniteDungeonHighestLevel: 29 })).toBe(7);
    expect(battingOrderSizeFor(5, 1, { heroBattingOrderSizeBonus: 2 })).toBe(7);
  });

  it("refreshes the party capacity when a registration moves the hero level", () => {
    let capacity = 0;
    const party = {
      monsters: () => [{ shortType: "Minotaur", level: 1 }],
      setBattingOrderSize: (size: number) => { capacity = size; },
    };
    // Hero level 1 at construction: the license size alone.
    const player = profileWith({}, { licenseBattingOrderSize: 5 }, party);
    expect(capacity).toBe(5);
    expect(player.heroLevel).toBe(1);

    // minimumHeroTotalForLevel(3) worth of registration takes the hero to level 3, and with it a
    // sixth slot — the source recomputes `battingOrderSize` on every read.
    player.recordCapturedMonster("Minotaur", minimumHeroTotalForLevel(3));
    expect(player.heroLevel).toBe(3);
    expect(capacity).toBe(6);
  });
});
