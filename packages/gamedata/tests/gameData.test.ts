import { describe, it, expect } from "vitest";
import { buildMonsterBookIndex, GameData } from "../src/gameData.js";
import { loadGameData } from "../src/loadNode.js";
import { resolveDataDir } from "../src/dataDir.js";
import { loadRawJson } from "../src/rawLoad.js";

const gd = loadGameData();

describe("GameData", () => {
  it("loads all 224 monsters with valid schemas", () => {
    expect(gd.allMonsters()).toHaveLength(224);
  });

  it("strictly loads the complete item and license catalogs", () => {
    expect(gd.allItems()).toHaveLength(26);
    expect(gd.item("Usables.Card")).toMatchObject({
      instanceName: "Card",
      className: "Item",
      slot: "Other",
      abilities: ["Utility.Capture"],
    });
    expect(gd.item("Gems.Uniques.Reflector")).toMatchObject({
      className: "Gem",
      slot: "Novice",
      holderBuffs: [{ type: "Offensive.PercentReflection" }],
    });
    expect(gd.allLicenses().map(({ type, gemSlots, battingOrderSize }) => ({
      type, gemSlots, battingOrderSize,
    }))).toEqual([
      { type: "Novice", gemSlots: 0, battingOrderSize: 5 },
      { type: "Apprentice", gemSlots: 1, battingOrderSize: 7 },
      { type: "Veteran", gemSlots: 2, battingOrderSize: 8 },
      { type: "Expert", gemSlots: 2, battingOrderSize: 10 },
      { type: "Elite", gemSlots: 3, battingOrderSize: 12 },
      { type: "Master", gemSlots: 4, battingOrderSize: 14 },
      { type: "Grandmaster", gemSlots: 4, battingOrderSize: 16 },
    ]);
    expect(gd.license("Apprentice")).toMatchObject({
      heroLevelRequired: 3,
      completedQuestsRequired: 5,
      challengeLevel: 8,
    });
  });

  it("loads and result-index-sorts all 23 authored combine recipes", () => {
    const recipes = gd.allCombineRecipes();
    expect(recipes).toHaveLength(23);
    expect(recipes[0]).toEqual({
      resultShortType: "Carnoraptor",
      ingredients: ["Bitewing", "Wolf"],
    });
    expect(gd.combineRecipe("WolfGod")).toEqual({
      resultShortType: "WolfGod",
      ingredients: ["ThunderWolf", "ThunderWolf"],
    });
    expect(recipes.map((recipe) => gd.monsterByShortType(recipe.resultShortType).index)).toEqual(
      [...recipes]
        .map((recipe) => gd.monsterByShortType(recipe.resultShortType).index)
        .sort((left, right) => left - right),
    );
    expect(Object.isFrozen(recipes)).toBe(true);
    expect(Object.isFrozen(recipes[0])).toBe(true);
    expect(Object.isFrozen(recipes[0]!.ingredients)).toBe(true);
  });

  it("resolves BatFiend correctly (known values from extracted data)", () => {
    const m = gd.monsterByShortType("BatFiend");
    expect(m.index).toBe(11700);
    expect(m.element).toBe("Air");
    expect(m.stars).toBe(2);
    expect(m.rootStats).toEqual({ Attack: 1.5, Defense: 2, Magic: 2.5, MaxHP: 8.9, Resist: 4, Speed: 6 });
    expect(gd.monsterByIndex(11700).shortType).toBe("BatFiend");
  });

  it("materializes an omitted eggUnlockQuality as the leaf's own quality", () => {


    const explicit = gd.monsterByShortType("Wendigo");
    expect(explicit.quality).toBe(12);
    expect(explicit.eggUnlockQuality).toBe(9);

    const omitted = gd.monsterByShortType("DeathCrawler");
    expect(omitted.quality).toBe(15);
    expect(omitted.eggUnlockQuality).toBe(15);

    // Every leaf inherits from `RootMonster`, which does not declare the field, so no leaf may be
    // left undefined by inheritance either.
    const catalog = gd.allMonsters();
    expect(catalog).toHaveLength(224);
    expect(catalog.filter((monster) => monster.eggUnlockQuality === undefined)).toEqual([]);
    // Census of the shipped plist: 49 leaves declare the key and every declared value differs
    // from that leaf's quality; the remaining 175 inherit the initializer's quality default.
    expect(catalog.filter((monster) => monster.eggUnlockQuality !== monster.quality)).toHaveLength(49);
    expect(catalog.filter((monster) => monster.eggUnlockQuality === monster.quality)).toHaveLength(175);
  });

  it("derives the one contiguous `-[Monster index]` book ordinal every card renders", () => {
    const order = gd.monsterBookOrder();
    expect(order).toHaveLength(224);
    expect(order.map((entry) => entry.ordinal)).toEqual(
      Array.from({ length: 224 }, (_, offset) => offset + 1),
    );
    expect(order.map((entry) => entry.resolvedSortKey)).toEqual(
      [...order].map((entry) => entry.resolvedSortKey).sort((left, right) => left - right),
    );
    // Authored keys are sparse (100..806000), so the ordinal is never the raw key.
    expect(gd.monsterBookIndex("Slime")).toBe(45);
    expect(gd.monsterBookIndex("Yacare")).toBe(86);
    expect(gd.monsterBookIndex("Bane")).toBe(165);
    expect(gd.monsterBookIndex("KingMetal")).toBe(192);
    expect(gd.monsterBookIndex("Resistance")).toBe(193);
    expect(gd.monsterBookIndex("Fate")).toBe(195);
    expect(gd.monsterBookIndex("Time")).toBe(203);
    expect(gd.monsterBookIndex("Shenron")).toBe(204);
    expect(gd.monsterBookIndex("SnowMan")).toBe(224);
    expect(gd.monsterBookIndex("BatFiend")).not.toBe(gd.monsterByShortType("BatFiend").index);
    expect(() => gd.monsterBookIndex("NoSuchMonster")).toThrow(/unknown monster shortType/);
  });

  it("resolves authored index collisions in traversal order before ordering the book", () => {


    const [first, second, third] = gd.allMonsters().slice(0, 3);
    const collision = buildMonsterBookIndex([
      { ...first!, index: 100 },
      { ...second!, index: 100 },
      { ...third!, index: 101 },
    ]);
    expect(collision.map(({ monster, resolvedSortKey, ordinal }) => ({
      shortType: monster.shortType,
      resolvedSortKey,
      ordinal,
    }))).toEqual([
      { shortType: first!.shortType, resolvedSortKey: 100, ordinal: 1 },
      { shortType: second!.shortType, resolvedSortKey: 101, ordinal: 2 },
      { shortType: third!.shortType, resolvedSortKey: 102, ordinal: 3 },
    ]);
  });

  it("exposes job abilities by short type", () => {
    const abilities = gd.jobAbilities("BatFiend");
    expect(abilities.map((a) => a.type)).toEqual(["Offensive.Air.Air", "Offensive.Confuse.Confuse"]);
    expect(abilities[0]?.slot).toBe("usable1");
    expect(gd.jobXpPenalty("BatFiend")).toBe(1);
  });

  it("resolves ability inheritance on demand", () => {
    const air = gd.ability("Offensive.Air.Air");
    expect(air.className).toBe("CombatAbility");
    expect(air.components).toEqual([{ type: "Offensive.MagicAttack" }]);
    expect(air.activationLength).toBe("{4}");
    const comp = gd.abilityComponent("Offensive.MagicAttack");

    expect(comp.className).toBe("DamageDealingAbilityComponent");
    expect(comp.raw["roll"]).toEqual({ relatedStat: "Magic" });
  });

  it("every job ability of every monster resolves to a valid AbilityDef whose components all resolve", () => {
    for (const m of gd.allMonsters()) {
      for (const ref of gd.jobAbilitiesOrEmpty(m.shortType)) {
        const ab = gd.ability(ref.type);
        for (const c of ab.components) gd.abilityComponent(c.type);
      }
    }
  });

  it("evolveData.newType always names a real monster", () => {
    for (const m of gd.allMonsters()) {
      if (m.evolveData) expect(() => gd.monsterByShortType(m.evolveData!.newType)).not.toThrow();
    }
  });


  it("evolveChainOf returns the full root→leaf chain for any member", () => {

    const chain = ["BatSquirrel", "GiantBat", "Doombat", "BatKing"];
    expect(gd.evolveChainOf("BatSquirrel")).toEqual(chain);
    expect(gd.evolveChainOf("Doombat")).toEqual(chain); // mid-chain member → same array
    expect(gd.evolveChainOf("BatKing")).toEqual(chain); // leaf → same array
    // BatFiend → Vampire (levelReq 22) → DarkSpirit.
    expect(gd.evolveChainOf("BatFiend")).toEqual(["BatFiend", "Vampire", "DarkSpirit"]);
    // Every monster resolves, chains are internally link-consistent, and every member keys
    // the identical chain (the native all-members dict invariant).
    for (const m of gd.allMonsters()) {
      const c = gd.evolveChainOf(m.shortType);
      expect(c).toContain(m.shortType);
      for (let i = 0; i + 1 < c.length; i++) {
        expect(gd.monsterByShortType(c[i]!).evolveData?.newType).toBe(c[i + 1]);
      }
      for (const member of c) expect(gd.evolveChainOf(member)).toEqual(c);
    }
  });
});

describe("GameData.fromRaw", () => {
  it("loads a parent-only Jobs child and retains every inherited ability slot", () => {
    const dir = resolveDataDir(undefined);
    const monsters = loadRawJson(dir, "Monsters.json");
    const jobs = loadRawJson(dir, "Jobs.json");
    (monsters as Record<string, unknown>)["Mod"] = {
      InheritedBat: {
        parent: "Animal.BatFiend",
        index: 9_999_999,
      },
    };
    (jobs as Record<string, unknown>)["Mod"] = {
      InheritedBat: { parent: "Animal.BatFiend" },
    };
    const custom = GameData.fromRaw({
      monsters,
      jobs,
      abilities: loadRawJson(dir, "Abilities.json"),
      abilityComponents: loadRawJson(dir, "AbilityComponents.json"),
      buffs: loadRawJson(dir, "Buffs.json"),
    });

    expect(custom.jobAbilities("InheritedBat")).toEqual(custom.jobAbilities("BatFiend"));
    expect(custom.jobXpPenalty("InheritedBat")).toBe(custom.jobXpPenalty("BatFiend"));
  });

  it("constructs from pre-fetched raw objects identically to loadGameData()", () => {
    const dir = resolveDataDir(undefined);
    const raw = {
      monsters: loadRawJson(dir, "Monsters.json"),
      jobs: loadRawJson(dir, "Jobs.json"),
      abilities: loadRawJson(dir, "Abilities.json"),
      abilityComponents: loadRawJson(dir, "AbilityComponents.json"),
      buffs: loadRawJson(dir, "Buffs.json"),
      combines: loadRawJson(dir, "Combines.json"),
      items: loadRawJson(dir, "Items.json"),
      licenses: loadRawJson(dir, "Licenses.json"),
    };
    const fromRaw = GameData.fromRaw(raw);
    expect(fromRaw.allMonsters().length).toBe(gd.allMonsters().length);
    expect(fromRaw.ability("Offensive.Fire.Fire")).toEqual(gd.ability("Offensive.Fire.Fire"));
    expect(fromRaw.jobAbilities("FireCub")).toEqual(gd.jobAbilities("FireCub"));
    expect(fromRaw.buff("Offensive.Poison").className).toBe("DamageOverTimeBuff");
    expect(fromRaw.allCombineRecipes()).toEqual(gd.allCombineRecipes());
  });

  it("reuses one complete raw object without changing its LifeSoulStone node", () => {
    const dir = resolveDataDir(undefined);
    const raw = {
      monsters: loadRawJson(dir, "Monsters.json"),
      jobs: loadRawJson(dir, "Jobs.json"),
      abilities: loadRawJson(dir, "Abilities.json"),
      abilityComponents: loadRawJson(dir, "AbilityComponents.json"),
      buffs: loadRawJson(dir, "Buffs.json"),
      combines: loadRawJson(dir, "Combines.json"),
      items: loadRawJson(dir, "Items.json"),
      licenses: loadRawJson(dir, "Licenses.json"),
    };
    const rawSoulStones = raw.items.SoulStones as Record<string, unknown>;
    const rawLifeSoulStone = rawSoulStones.LifeSoulStone;
    const rawLifeSoulStoneSnapshot = structuredClone(rawLifeSoulStone);

    const first = GameData.fromRaw(raw);
    const second = GameData.fromRaw(raw);

    expect(first.item("Usables.Card")).toEqual(second.item("Usables.Card"));
    expect(first.soulStoneByElement("Life")).toEqual(second.soulStoneByElement("Life"));
    expect(first.ability("Offensive.Fire.Fire")).toEqual(second.ability("Offensive.Fire.Fire"));
    expect(raw.items.SoulStones).toBe(rawSoulStones);
    expect(rawSoulStones.LifeSoulStone).toBe(rawLifeSoulStone);
    expect(rawSoulStones.LifeSoulStone).toEqual(rawLifeSoulStoneSnapshot);
  });

  it("without optional data: feature-specific accessors fail loudly instead of resolving empty state", () => {
    const dir = resolveDataDir(undefined);
    const noItems = GameData.fromRaw({
      monsters: loadRawJson(dir, "Monsters.json"),
      jobs: loadRawJson(dir, "Jobs.json"),
      abilities: loadRawJson(dir, "Abilities.json"),
      abilityComponents: loadRawJson(dir, "AbilityComponents.json"),
      buffs: loadRawJson(dir, "Buffs.json"),
    });
    expect(() => noItems.soulStoneByElement("Fire")).toThrow(/Items\.json was not provided/);
    expect(() => noItems.allCombineRecipes()).toThrow(/Combines data was not loaded/);
    expect(() => noItems.allItems()).toThrow(/Items data was not loaded/);
    expect(() => noItems.allLicenses()).toThrow(/Licenses data was not loaded/);
  });

  it("rejects malformed recipes and invalid result/ingredient references at load time", () => {
    const dir = resolveDataDir(undefined);
    const base = {
      monsters: loadRawJson(dir, "Monsters.json"),
      jobs: loadRawJson(dir, "Jobs.json"),
      abilities: loadRawJson(dir, "Abilities.json"),
      abilityComponents: loadRawJson(dir, "AbilityComponents.json"),
      buffs: loadRawJson(dir, "Buffs.json"),
    };
    expect(() => GameData.fromRaw({
      ...base,
      combines: { Carnoraptor: ["Bitewing"] },
    })).toThrow(/exactly two/);
    expect(() => GameData.fromRaw({
      ...base,
      combines: { FireCub: ["Bitewing", "Wolf"] },
    })).toThrow(/category Normal, expected Combine/);
    expect(() => GameData.fromRaw({
      ...base,
      combines: { Carnoraptor: ["MissingMonster", "Wolf"] },
    })).toThrow(/unknown monster shortType: MissingMonster/);
  });
});

describe("soul stones (Items.json SoulStones.*)", () => {
  it("resolves all 7 element stones with their exact per-element stat sets, in LivingStat index order", () => {
    expect(gd.soulStoneByElement("Life").enabledStats).toEqual(["MaxHP", "Defense", "Resist"]);
    expect(gd.soulStoneByElement("Death").enabledStats).toEqual(["Attack", "Magic"]);
    expect(gd.soulStoneByElement("Water").enabledStats).toEqual(["Magic"]);
    expect(gd.soulStoneByElement("Fire").enabledStats).toEqual(["Attack"]);
    expect(gd.soulStoneByElement("Earth").enabledStats).toEqual(["Defense", "Resist"]);
    expect(gd.soulStoneByElement("Air").enabledStats).toEqual(["Speed"]);
    expect(gd.soulStoneByElement("Arcane").enabledStats).toEqual(["Attack", "Magic", "Defense", "Resist"]);
    expect(gd.soulStoneByElement("Fire").path).toBe("SoulStones.FireSoulStone");
  });
});
