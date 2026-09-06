import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadCollectionCatalog,
  loadGameData,
  type DungeonResourceSource,
} from "../src/index.js";

const data = loadGameData();

function source(collection: unknown): DungeonResourceSource {
  return {
    has: (path) => path === "Collection.plist",
    plist: (path) => {
      if (path !== "Collection.plist") throw new Error(`missing ${path}`);
      return collection;
    },
  };
}

function emptyReward(): Record<string, unknown> {
  return { items: [] };
}

function explicitGoal(
  key: string,
  monsters: readonly string[] = ["Spikey"],
): Record<string, unknown> {
  return { key, monsters: [...monsters], treasureData: emptyReward() };
}

function categoryGoal(key: string, category: string): Record<string, unknown> {
  return {
    key,
    inclusionRuleClass: "CategoryMonsterInclusionRule",
    inclusionRuleArguments: { category },
    treasureData: emptyReward(),
  };
}

const specialDictionaryFactories = [
  ["Map", () => new Map<string, unknown>([["Base", []]])],
  ["Set", () => new Set(["Base"])],
  ["Date", () => new Date(0)],
  ["Uint8Array", () => new Uint8Array([1])],
] as const;

describe("Collection.plist catalog", () => {
  it("loads shipped Base goals in authored order with exact explicit and Monsterpedia-index vectors", () => {
    const collection = JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../../extracted/data/Collection.json"), "utf8"),
    ) as unknown;

    const goals = loadCollectionCatalog(source(collection), data).get("Base");

    expect(goals?.map(({ key }) => key)).toEqual([
      "UsualSuspects",
      "RecipeForDestruction",
      "Eggxactly",
      "Collector",
    ]);
    expect(goals?.map(({ collectionType }) => collectionType)).toEqual([
      "Base",
      "Base",
      "Base",
      "Base",
    ]);
    expect(goals?.[0]?.monsterTypes).toEqual([
      "BatSquirrel", "WhitePiranha", "SnowCub", "FireCub", "GiantWasp", "GiantCrab",
      "GiantTurtle", "Bitewing", "UnhappyBird", "BabyNessie", "GiantAnt", "Sludge",
      "Fairy", "Wolf", "Drake", "EvilEye", "Penguin", "Goblin", "BeastKnight", "Stinger",
      "MetalSludge", "Cockatrice", "MerWarrior", "SpikeBall", "Assassin", "Tsuchinoko",
      "BlueSeahorse", "Reptilo", "SunPriest", "TigerFish", "WhiteDolphin", "Spartan",
      "DevilWorm", "Mask", "Bones", "IronFish", "ArmorFish", "Finder", "GoldLion", "Spark",
      "Cherub", "Treehead", "BatFiend", "SteelSnake", "Manticore", "Shark", "Samurai",
      "Kappa", "Imp", "DreamEater", "Beastman", "Sphinxling", "Minotaur", "ElephantFighter",
      "Kaguya", "Megaslug", "Yeti", "BloodPriest", "DarkPriest", "MutantFish",
      "SerpentKnight", "Lich", "LightCrawler", "KemetKing", "Bane", "Grimoire",
      "Abomination", "Sasquatch", "Bon", "Doki", "SnowMan",
    ]);
    expect(goals?.[1]?.monsterTypes).toEqual([
      "Carnoraptor", "SkullCrow", "FallenAngel", "LichKing", "Cyclops", "Demios",
      "GriffinRider", "Dementor", "Titan", "Juggernaut", "WolfGod", "BlueDragonKnight",
      "GoldDragonKnight", "RedDragonKnight", "WhiteDragonKnight", "Pyrohydra", "Cryohydra",
      "BoneDragon", "AquaHorror", "Blademaster", "KingMetal", "Leo", "UltimateDragon",
    ]);
    expect(goals?.[2]?.monsterTypes).toEqual([
      "RedBabyDragon", "RedDragonling", "RedDragon", "FireDragon", "BlueBabyDragon",
      "BlueDragonling", "BlueDragon", "WaterDragon", "WhiteBabyDragon", "WhiteDragonling",
      "WhiteDragon", "SnowDragon", "GoldBabyDragon", "GoldDragonling", "GoldDragon",
      "LightDragon",
    ]);
    expect(goals?.[3]?.monsterTypes).toEqual(["ShadowTiger", "Teddy", "Spikey"]);
    expect(goals?.map(({ treasureData }) => treasureData.items[0])).toEqual([
      {
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "Spikey",
          jobLevel: 5,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      },
      {
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "ShadowTiger",
          jobLevel: 5,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      },
      {
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "Teddy",
          jobLevel: 5,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      },
      {
        kind: "fixed",
        levelScalor: 1,
        data: {
          kind: "monsterJoin",
          shortType: "CatRider1",
          jobLevel: 5,
          rawType: "DestroyOnPickup.MonsterJoin",
        },
      },
    ]);
  });

  it("keeps only Normal evolution roots and directly matches the other four exact categories", () => {
    const catalog = loadCollectionCatalog(source({
      Base: [
        categoryGoal("Normal", "Normal"),
        categoryGoal("Summon", "Summon"),
        categoryGoal("Combine", "Combine"),
        categoryGoal("Egg", "Egg"),
        categoryGoal("Collection", "Collection"),
      ],
    }), data);
    const goals = catalog.get("Base")!;

    expect(goals[0]!.monsterTypes).toContain("BatSquirrel");
    expect(goals[0]!.monsterTypes).not.toContain("GiantBat");
    expect(goals[1]!.monsterTypes).toEqual([
      "Resistance", "Fire", "Fate", "Aggression", "Energy", "Karma", "Evil", "Fear",
      "Thought", "Divine", "Time", "Shenron",
    ]);
    expect(goals[2]!.monsterTypes).toHaveLength(23);
    expect(goals[3]!.monsterTypes).toHaveLength(16);
    expect(goals[4]!.monsterTypes).toEqual([
      "ShadowTiger", "Teddy", "CatRider1", "CatRider2", "CatRider3", "Spikey",
      "UltimatePanther",
    ]);
  });

  it("preserves explicit duplicate monster occurrences in authored order", () => {
    const goals = loadCollectionCatalog(source({
      Base: [explicitGoal("Duplicates", ["Spikey", "Spikey", "Teddy"])],
    }), data).get("Base")!;

    expect(goals[0]!.monsterTypes).toEqual(["Spikey", "Spikey", "Teddy"]);
  });

  it("accepts null-prototype dictionaries at root, goal, and rule-argument levels", () => {
    const args = Object.assign(Object.create(null) as Record<string, unknown>, {
      category: "Collection",
    });
    const goal = Object.assign(Object.create(null) as Record<string, unknown>, {
      key: "NullPrototype",
      inclusionRuleClass: "CategoryMonsterInclusionRule",
      inclusionRuleArguments: args,
      treasureData: emptyReward(),
    });
    const root = Object.assign(Object.create(null) as Record<string, unknown>, { Base: [goal] });

    expect(loadCollectionCatalog(source(root), data).get("Base")?.[0]?.key)
      .toBe("NullPrototype");
  });

  it.each(specialDictionaryFactories)("rejects %s values as the root dictionary", (_name, make) => {
    expect(() => loadCollectionCatalog(source(make()), data))
      .toThrow(/Collection\.plist must be a dictionary/);
  });

  it.each(specialDictionaryFactories)("rejects %s values as goal dictionaries", (_name, make) => {
    expect(() => loadCollectionCatalog(source({ Base: [make()] }), data))
      .toThrow(/Collection\.plist\.Base\[0\] must be a dictionary/);
  });

  it.each(specialDictionaryFactories)(
    "rejects %s values as rule-argument dictionaries",
    (_name, make) => {
      const goal = categoryGoal("Goal", "Normal");
      goal.inclusionRuleArguments = make();
      expect(() => loadCollectionCatalog(source({ Base: [goal] }), data))
        .toThrow(/inclusionRuleArguments must be a dictionary/);
    },
  );

  it("accepts explicit empty arrays and returns a frozen, genuinely immutable ReadonlyMap", () => {
    const catalog = loadCollectionCatalog(source({ Base: [explicitGoal("Empty", [])] }), data);
    const goals = catalog.get("Base")!;

    expect(goals).toEqual([{
      collectionType: "Base",
      key: "Empty",
      monsterTypes: [],
      treasureData: {
        defaultSpawnChance: 1,
        levelScalor: 1,
        items: [],
      },
    }]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(goals)).toBe(true);
    expect(Object.isFrozen(goals[0])).toBe(true);
    expect(Object.isFrozen(goals[0]!.monsterTypes)).toBe(true);
    expect(Object.isFrozen(goals[0]!.treasureData)).toBe(true);
    expect(Object.isFrozen(goals[0]!.treasureData.items)).toBe(true);
    expect(catalog.size).toBe(1);
    expect(catalog.has("Base")).toBe(true);
    expect([...catalog.keys()]).toEqual(["Base"]);
    expect([...catalog.values()]).toEqual([goals]);
    expect([...catalog.entries()]).toEqual([["Base", goals]]);
    expect([...catalog]).toEqual([["Base", goals]]);
    const visits: Array<[string, readonly unknown[], ReadonlyMap<string, readonly unknown[]>]> = [];
    catalog.forEach((value, key, owner) => visits.push([key, value, owner]));
    expect(visits).toEqual([["Base", goals, catalog]]);
    expect((catalog as unknown as Record<string, unknown>).set).toBeUndefined();
    expect((catalog as unknown as Record<string, unknown>).delete).toBeUndefined();
    expect((catalog as unknown as Record<string, unknown>).clear).toBeUndefined();
  });

  it.each([
    ["unknown goal keys", { Base: [{ ...explicitGoal("Goal"), invented: true }] }, /unsupported key invented/],
    ["unknown rule classes", { Base: [{ ...categoryGoal("Goal", "Normal"), inclusionRuleClass: "OtherRule" }] }, /unsupported inclusionRuleClass OtherRule/],
    ["unknown categories", { Base: [categoryGoal("Goal", "Boss")] }, /unsupported category Boss/],
    ["unknown collection types", { Base: [], Seasonal: [] }, /unsupported collection type Seasonal/],
    ["duplicate goal keys", { Base: [explicitGoal("Same"), explicitGoal("Same")] }, /duplicate goal key Same/],
    ["unknown explicit monster identities", { Base: [explicitGoal("Goal", ["NoSuchMonster"])] }, /unknown monster NoSuchMonster/],
    [
      "missing monster selection forms",
      { Base: [{ key: "Goal", treasureData: emptyReward() }] },
      /must use exactly one monster selection form/,
    ],
    [
      "rule forms missing arguments",
      {
        Base: [{
          key: "Goal",
          inclusionRuleClass: "CategoryMonsterInclusionRule",
          treasureData: emptyReward(),
        }],
      },
      /must use exactly one monster selection form/,
    ],
    [
      "rule forms missing their class",
      {
        Base: [{
          key: "Goal",
          inclusionRuleArguments: { category: "Normal" },
          treasureData: emptyReward(),
        }],
      },
      /must use exactly one monster selection form/,
    ],
    [
      "unknown reward monster identities",
      {
        Base: [{
          key: "Goal",
          monsters: [],
          treasureData: {
            items: [{
              spawnType: "fixed",
              data: {
                type: "DestroyOnPickup.MonsterJoin",
                arguments: { shortType: "NoSuchMonster", jobLevel: 1 },
              },
            }],
          },
        }],
      },
      /unknown reward monster NoSuchMonster/,
    ],
    [
      "malformed rewards",
      {
        Base: [{
          key: "Goal",
          monsters: [],
          treasureData: {
            items: [{
              spawnType: "fixed",
              data: {
                type: "DestroyOnPickup.MonsterJoin",
                arguments: { shortType: "Spikey" },
              },
            }],
          },
        }],
      },
      /jobLevel must be finite/,
    ],
    [
      "unknown reward shapes",
      {
        Base: [{
          key: "Goal",
          monsters: [],
          treasureData: { items: [{ spawnType: "invented" }] },
        }],
      },
      /spawnType invented is unsupported/,
    ],
    [
      "both explicit and rule selection forms",
      {
        Base: [{
          ...categoryGoal("Goal", "Normal"),
          monsters: ["Spikey"],
        }],
      },
      /must use exactly one monster selection form/,
    ],
  ])("rejects %s", (_label, collection, message) => {
    expect(() => loadCollectionCatalog(source(collection), data)).toThrow(message);
  });
});
