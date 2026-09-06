import { describe, expect, it } from "vitest";
import {
  PlayerProfile,
  restrictPlayerProfileToRoster,
  type PlayerProfileStateSnapshotV2,
  type PlayerProfileStateSnapshotV4,
} from "../src/player/playerProfile.js";
import {
  DEMO_PLAYER_PROFILE_DEFAULTS,
  establishedPlayerTutorialFlags,
  INTRO_TUTORIAL_FLAGS,
  sourceNewGameProfileDefaults,
} from "../src/player/demoPlayerProfile.js";

function profile() {
  return new PlayerProfile({
    heroLevel: 9,
    monsterPartyLevels: [4, 12, 7],
    silver: 300,
    gold: 99,
    captureCards: { 1: 1, 2: 0, 3: 0 },
    highestCapturedLevels: { Minotaur: 8 },
    spiritReadiness: 0,
    spiritTierLevels: { Resistance: 0, Fire: 2 },
  });
}

function legacyV4(p = profile()): PlayerProfileStateSnapshotV4 {
  const current = p.stateSnapshot();
  const {
    inventory: _inventory,
    licenseType: _licenseType,
    skillPoints: _skillPoints,
    ...shared
  } = current;
  return {
    ...shared,
    schemaVersion: 4,
    captureCards: p.snapshot().captureCards,
    dungeonItems: p.inventory.legacyItemCounts(),
  };
}

describe("PlayerProfile capture economy seam", () => {
  it("starts source new games with the slot defaults and two ordinary capture cards", () => {
    const defaults = sourceNewGameProfileDefaults("GoldBabyDragon");
    expect(defaults).toMatchObject({
      heroLevel: 1,
      heroTotalHighestLevels: 1,
      silver: 1_000,
      gold: 100,
      captureCards: { 1: 2, 2: 0, 3: 0 },
      highestCapturedLevels: { GoldBabyDragon: 1 },
      spiritReadiness: 0,
      spiritTierLevels: {},
      tutorialFlags: [],
    });
  });

  it("uses the source highest-level-as-average quirk and preserves configured hero level", () => {
    const p = profile();
    expect(p.heroLevel).toBe(9);
    expect(p.capturePartyLevel()).toBe(12);
    expect(p.highestRegisteredLevel("Minotaur")).toBe(8);
    expect(p.highestRegisteredLevel("UnhappyBird")).toBe(0);
  });

  it("keeps the complete persistent Living maximum without filtering definition keys", () => {
    const p = new PlayerProfile({
      heroLevel: 9,
      monsterPartyLevels: [4],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      highestCapturedLevels: { Minotaur: 8, "Living.CustomCarrier": 72 },
    });

    expect(p.highestRegisteredLivingLevel()).toBe(72);
  });

  it("consumes owned cards before currency, then buys at exact silver cost", () => {
    const p = profile();
    expect(p.spendCaptureCard(1)).toEqual({ ok: true, source: "owned" });
    expect(p.snapshot().silver).toBe(300);
    expect(p.spendCaptureCard(2)).toEqual({
      ok: true,
      source: "purchased",
      cost: { currency: "silver", amount: 250 },
    });
    expect(p.snapshot().silver).toBe(50);
  });

  it("does not mutate balances on insufficient gold", () => {
    const p = profile();
    expect(p.spendCaptureCard(3)).toEqual({
      ok: false,
      reason: "insufficientFunds",
      cost: { currency: "gold", amount: 100 },
    });
    expect(p.snapshot().gold).toBe(99);
  });

  it("debits town-service gold atomically and rejects invalid or unaffordable spends", () => {
    const p = profile();
    let checkpoints = 0;
    p.setChangeListener(() => { checkpoints += 1; });
    expect(p.spendGold(25)).toBe(true);
    expect(p.snapshot().gold).toBe(74);
    expect(checkpoints).toBe(1);
    expect(p.spendGold(75)).toBe(false);
    expect(p.snapshot().gold).toBe(74);
    expect(checkpoints).toBe(1);
    expect(() => p.spendGold(-1)).toThrow(/nonnegative safe integer/);
  });

  it("observes live party changes without copying them into profile state", () => {
    const monsters = [
      { shortType: "FireCub", level: 14 },
      { shortType: "SnowCub", level: 6 },
    ];
    const p = new PlayerProfile({
      heroLevel: 9,
      monsterPartyLevels: [1],
      silver: 300,
      gold: 99,
      captureCards: { 1: 1, 2: 0, 3: 0 },
    }, { monsters: () => monsters });
    expect(p.capturePartyLevel()).toBe(14);
    expect(p.highestRegisteredLevel("FireCub")).toBe(0);
    expect(p.highestOwnedLevel("FireCub")).toBe(14);
    p.recordCapturedMonster("UnhappyBird", 11);
    p.recordCapturedMonster("UnhappyBird", 8);
    expect(p.highestRegisteredLevel("UnhappyBird")).toBe(11);

    monsters[0]!.level = 18;
    monsters[1]!.level = 12;
    expect(p.capturePartyLevel()).toBe(18);
    expect(p.highestRegisteredLevel("FireCub")).toBe(0);
    expect(p.highestOwnedLevel("FireCub")).toBe(18);
    expect(p.highestOwnedLevel("SnowCub")).toBe(12);
  });
});

describe("PlayerProfile hero spirit seam", () => {
  it("registers only new per-species highest levels into persisted HeroData XP", () => {
    const p = new PlayerProfile({
      heroLevel: 1,
      heroTotalHighestLevels: 0,
      monsterPartyLevels: [1],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    });
    p.recordCapturedMonster("FireCub", 7);
    p.recordCapturedMonster("FireCub", 5);
    p.recordCapturedMonster("SnowCub", 4);
    expect(p.heroTotalHighestLevels).toBe(11);
    expect(p.heroLevel).toBe(2);
    expect(p.stateSnapshot()).toMatchObject({
      schemaVersion: 8,
      hero: { level: 2, totalHighestLevels: 11 },
      highestCapturedLevels: { FireCub: 7, SnowCub: 4 },
      learnedCombineRecipes: [],
    });
  });

  it("drops demo identities that do not exist in a selected custom roster", () => {
    const restricted = restrictPlayerProfileToRoster(
      {
        heroLevel: 9,
        monsterPartyLevels: [9],
        silver: 10,
        gold: 2,
        captureCards: { 1: 0, 2: 0, 3: 0 },
        highestCapturedLevels: { Minotaur: 8, Cleanling: 5 },
        spiritTierLevels: { Resistance: 2, Cleanling: 1 },
        learnedCombineRecipes: ["Carnoraptor", "Cleanling"],
      },
      ["Cleanling"],
    );
    expect(restricted.highestCapturedLevels).toEqual({ Cleanling: 5 });
    expect(restricted.spiritTierLevels).toEqual({ Cleanling: 1 });
    expect(restricted.learnedCombineRecipes).toEqual(["Cleanling"]);
    expect(new PlayerProfile(restricted).spiritSnapshot().spirits).toHaveLength(1);
  });

  it("loads configured tiers as saved XP and starts at the configured readiness fill", () => {
    const p = profile();
    expect(p.spiritSnapshot()).toMatchObject({
      energy: 0,
      readiness: 0,
      full: false,
      spirits: [
        { shortType: "Resistance", savedXp: 1, tierLevel: 0, usedThisTrip: false },
        { shortType: "Fire", savedXp: 400, tierLevel: 2, usedThisTrip: false },
      ],
    });
  });

  it("migrates a legacy present-zero spirit record to the source-valid unlocked sentinel once", () => {
    const snapshot = profile().stateSnapshot();
    const legacyZero = {
      ...snapshot,
      spiritSavedXp: { ...snapshot.spiritSavedXp, Resistance: 0 },
    };
    const restored = PlayerProfile.fromStateSnapshot(legacyZero, [4, 12, 7]);
    expect(restored.spiritSavedXp("Resistance")).toBe(1);
    expect(restored.stateSnapshot().spiritSavedXp["Resistance"]).toBe(1);
    expect(
      PlayerProfile.fromStateSnapshot(restored.stateSnapshot(), [4, 12, 7])
        .spiritSavedXp("Resistance"),
    ).toBe(1);
  });

  it("charges from the exact level-ratio directions and saturates at 100", () => {
    const p = profile();
    expect(p.chargeSpiritForDealtDamage(20, 10)).toBe(5); // target/source = .5
    expect(p.chargeSpiritForTakenDamage(10, 20)).toBe(10); // source/target = 2 -> clamp 10
    for (let i = 0; i < 20; i++) p.chargeSpiritForDealtDamage(1, 1);
    expect(p.spiritSnapshot()).toMatchObject({ energy: 100, readiness: 1, full: true });
  });

  it("spends all energy, grants 33 XP, and disables only that spirit for the trip", () => {
    const p = profile();
    for (let i = 0; i < 10; i++) p.chargeSpiritForDealtDamage(1, 1);
    expect(p.useSpirit("Resistance")).toEqual({ savedXpBefore: 1, savedXpAfter: 34 });
    expect(p.spiritSnapshot()).toMatchObject({ energy: 0, full: false });
    expect(p.hasSummonedSpiritThisTrip("Resistance")).toBe(true);
    expect(p.hasSummonedSpiritThisTrip("Fire")).toBe(false);
    expect(() => p.useSpirit("Resistance")).toThrow(/not full/);

    p.resetSpiritsForTownReturn();
    expect(p.hasSummonedSpiritThisTrip("Resistance")).toBe(false);
  });

  it("fails loudly on invalid fill, tier, or unknown spirit", () => {
    const base = {
      heroLevel: 1,
      monsterPartyLevels: [1],
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 } as const,
    };
    expect(() => new PlayerProfile({ ...base, spiritReadiness: 1.1 })).toThrow(/between 0 and 1/);
    expect(() => new PlayerProfile({ ...base, spiritTierLevels: { Fire: 19 } })).toThrow(/0 to 18/);
    expect(() => profile().spiritSavedXp("Time")).toThrow(/not unlocked/);
  });
});

describe("PlayerProfile combine recipe persistence", () => {
  it("learns each result once, notifies once, and round-trips deterministic current state", () => {
    const p = profile();
    let changes = 0;
    p.setChangeListener(() => { changes += 1; });
    expect(p.hasCombineRecipe("Carnoraptor")).toBe(false);
    expect(p.learnCombineRecipe("WolfGod")).toBe(true);
    expect(p.learnCombineRecipe("Carnoraptor")).toBe(true);
    expect(p.learnCombineRecipe("Carnoraptor")).toBe(false);
    expect(changes).toBe(2);
    expect(p.learnedCombineRecipes()).toEqual(["Carnoraptor", "WolfGod"]);

    const snapshot = p.stateSnapshot();
    expect(snapshot).toMatchObject({
      schemaVersion: 8,
      learnedCombineRecipes: ["Carnoraptor", "WolfGod"],
    });
    const restored = PlayerProfile.fromStateSnapshot(snapshot, [4, 12, 7]);
    expect(restored.hasCombineRecipe("Carnoraptor")).toBe(true);
    expect(restored.learnedCombineRecipes()).toEqual(["Carnoraptor", "WolfGod"]);
  });

  it("migrates schema-1/2 state with no learned recipes", () => {
    const current = legacyV4();
    const {
      learnedCombineRecipes: _recipes,
      tutorialFlags: _tutorialFlags,
      ...withoutRecipes
    } = current;
    const legacyV2: PlayerProfileStateSnapshotV2 = {
      ...withoutRecipes,
      schemaVersion: 2,
    };
    expect(PlayerProfile.fromStateSnapshot(legacyV2, [4, 12, 7]).learnedCombineRecipes()).toEqual([]);
  });

  it("rejects empty recipe keys", () => {
    expect(() => profile().learnCombineRecipe("")).toThrow(/must not be empty/);
  });
});

describe("PlayerProfile tutorial persistence", () => {
  it("claims once, notifies before presentation, and round-trips schema 4", () => {
    const p = profile();
    let changes = 0;
    p.setChangeListener(() => { changes += 1; });
    expect(p.claimTutorialFlag("FirstMonsterpedia")).toBe(true);
    expect(p.claimTutorialFlag("FirstMonsterpedia")).toBe(false);
    expect(changes).toBe(1);
    expect(p.tutorialFlags()).toEqual(["FirstMonsterpedia"]);
    const restored = PlayerProfile.fromStateSnapshot(p.stateSnapshot(), [4, 12, 7]);
    expect(restored.hasTutorialFlag("FirstMonsterpedia")).toBe(true);
  });

  it("migrates schema 3 without claiming tutorials", () => {
    const current = legacyV4();
    const { tutorialFlags: _tutorialFlags, ...schema4 } = current;
    const legacy = { ...schema4, schemaVersion: 3 as const };
    const restored = PlayerProfile.fromStateSnapshot(legacy, [4, 12, 7]);
    expect(restored.tutorialFlags()).toEqual([]);
  });

  it("treats an established player as having claimed every authored first-visit flash key", () => {


    const flags = establishedPlayerTutorialFlags(["FirstTavernFlash", "FirstManagementFlash"]);
    for (const flag of INTRO_TUTORIAL_FLAGS) expect(flags).toContain(flag);
    expect(flags).toContain("FirstTavernFlash");
    expect(flags).toContain("FirstManagementFlash");
    // Deduplicated and stable so save round-trips do not churn.
    expect([...flags]).toEqual([...new Set(flags)].sort());
    expect(establishedPlayerTutorialFlags([])).toEqual(
      [...INTRO_TUTORIAL_FLAGS, "TownWarpTutorial"].sort(),
    );
  });

  it("keeps the new-game profile empty and the fixture profile past the intro", () => {
    expect(sourceNewGameProfileDefaults("BlueBabyDragon").tutorialFlags).toEqual([]);
    expect(DEMO_PLAYER_PROFILE_DEFAULTS.tutorialFlags).toEqual(INTRO_TUTORIAL_FLAGS);
  });
});

describe("PlayerProfile dungeon challenge persistence", () => {
  it("tracks completion by dungeon instance, not by the current run, and round-trips schema 4", () => {
    const p = profile();
    let changes = 0;
    p.setChangeListener(() => { changes += 1; });

    expect(p.completeCatchQuest("NorthCave")).toBe(true);
    expect(p.completeCatchQuest("NorthCave")).toBe(false);
    expect(p.completeCatchQuest("WestCave")).toBe(true);
    expect(changes).toBe(2);
    expect(p.catchQuestsDone()).toEqual(["NorthCave", "WestCave"]);

    const restored = PlayerProfile.fromStateSnapshot(p.stateSnapshot(), [4, 12, 7]);
    expect(restored.hasCompletedCatchQuest("NorthCave")).toBe(true);
    expect(restored.hasCompletedCatchQuest("WestCave")).toBe(true);
    expect(restored.hasCompletedCatchQuest("SouthCave")).toBe(false);
  });

  it("migrates older schema-4 snapshots with no catchQuestsDone field", () => {
    const current = legacyV4();
    const { catchQuestsDone: _catchQuestsDone, ...legacy } = current;
    const restored = PlayerProfile.fromStateSnapshot(legacy, [4, 12, 7]);
    expect(restored.catchQuestsDone()).toEqual([]);
  });
});

describe("PlayerProfile dungeon waypoint persistence", () => {
  it("stores source instance/floor keys durably and notifies only for first discovery", () => {
    const p = profile();
    let changes = 0;
    p.setChangeListener(() => { changes += 1; });

    expect(p.registerDungeonWaypoint("NorthCave", 4)).toBe(true);
    expect(p.registerDungeonWaypoint("NorthCave", 2)).toBe(true);
    expect(p.registerDungeonWaypoint("NorthCave", 2)).toBe(false);
    expect(p.registerDungeonWaypoint("WestCave", 3)).toBe(true);
    expect(changes).toBe(3);
    expect(p.dungeonWaypoints()).toEqual({
      NorthCave: [2, 4],
      WestCave: [3],
    });

    const restored = PlayerProfile.fromStateSnapshot(p.stateSnapshot(), [4, 12, 7]);
    expect(restored.dungeonWaypointsFor("NorthCave")).toEqual([2, 4]);
    expect(restored.hasDungeonWaypoint("WestCave", 3)).toBe(true);
  });

  it("migrates older schema-4 snapshots with no waypoint dictionary", () => {
    const current = legacyV4();
    const { dungeonWaypoints: _dungeonWaypoints, ...legacy } = current;
    const restored = PlayerProfile.fromStateSnapshot(legacy, [4, 12, 7]);
    expect(restored.dungeonWaypoints()).toEqual({});
  });
});
