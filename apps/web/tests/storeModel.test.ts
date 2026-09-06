import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it } from "vitest";
import { GameData } from "@dib/gamedata/browser";
import { PlayerProfile } from "@dib/player-domain";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const combines = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Combines.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const licenses = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Licenses.json", import.meta.url), "utf8"));
const thingsInWorld = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/ThingsInWorld.json", import.meta.url), "utf8"));
const strings = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/LocalizableStrings.json", import.meta.url), "utf8"));
import {
  SOURCE_STORE_CATEGORY_ORDER,
  storeCanBuyMultiple,
  storeStockDisplayName,
  storeStockForCategory,
  storeStockLongDescription,
} from "../src/player/storeModel.js";
import {
  SOURCE_ITEM_QUALITY_COLORS,
  SOURCE_STORE_REFLECTION_ARGS,
  storeCarouselCardLayout,
  storeGemGlowAlpha,
  storeReflectionFit,
  storeReflectionTextureRect,
} from "../src/player/playerScreenLayoutMath.js";

const rawBase = { monsters, jobs, abilities, abilityComponents, buffs, combines, items, licenses };
// GameData resolves item inheritance into the raw node it is handed, so the inputs are single-use.
// Snapshot them before the first construction to keep a pristine set for the no-ThingsInWorld case.
const rawWithoutWorlds = structuredClone(rawBase);
const data = GameData.fromRaw({ ...rawBase, thingsInWorld });
const profile = new PlayerProfile({
  heroLevel: 1,
  monsterPartyLevels: [1],
  silver: 1_000,
  gold: 100,
  captureCards: { 1: 2, 2: 0, 3: 0 },
});

describe("StoreNode source catalog", () => {
  it("preserves root category order and exact fixed stock ordering", () => {
    expect(SOURCE_STORE_CATEGORY_ORDER).toEqual([1, 2, 3, 4, 5]);
    expect(storeStockForCategory(1, data, profile).map(({ id }) => id)).toEqual([
      "card-1", "card-2", "card-3",
      "gem-novice-plain", "gem-novice-glow",
      "gem-veteran-plain", "gem-veteran-glow",
      "gem-elite-plain", "gem-elite-glow",
      "gem-grandmaster-plain", "gem-grandmaster-glow",
    ]);
    expect(storeStockForCategory(2, data, profile).map(({ id }) => id))
      .toEqual(["egg", "monster-egg"]);
    expect(storeStockForCategory(3, data, profile).map(({ id }) => id))
      .toEqual([
        "iap-gold-1", "iap-gold-2", "iap-gold-3", "iap-gold-4", "iap-gold-5", "iap-gold-6",
        "silver-500", "silver-5000",
      ]);
  });

  it("builds every Recipe and Totem card from shipped fractional rarity", () => {
    // Twelve of the 23 shipped Combines results carry a half star (Carnoraptor 3.5, Cryohydra 9.5,
    // ...). Feeding that float to recipeStoreStock threw, so opening Recipes crashed on real data.
    const recipes = storeStockForCategory(4, data, profile)
      .filter((stock) => stock.kind === "recipe");
    expect(recipes).toHaveLength(data.allCombineRecipes().length);
    expect(recipes.every(({ unitPrice }) =>
      Number.isSafeInteger(unitPrice) && unitPrice % 150 === 0)).toBe(true);
    expect(recipes.find(({ id }) => id === "recipe-Carnoraptor")?.unitPrice).toBe(450);
    expect(recipes.find(({ id }) => id === "recipe-Cryohydra")?.unitPrice).toBe(1_350);




    const totems = storeStockForCategory(5, data, profile)
      .filter((stock) => stock.kind === "spiritTotem");
    expect(totems.length).toBe(storeStockForCategory(5, data, profile).length);
    expect(totems.map(({ shortType }) => shortType)).toEqual(
      data.monsterBookOrder()
        .map(({ monster }) => monster)
        .filter(({ category }) => category === "Summon")
        .map(({ shortType }) => shortType),
    );
    expect(totems).toHaveLength(12);
    expect(totems.map(({ shortType }) => shortType).sort()).toEqual([
      "Aggression", "Divine", "Energy", "Evil", "Fate", "Fear",
      "Fire", "Karma", "Resistance", "Shenron", "Thought", "Time",
    ]);
    expect(totems.every(({ unitPrice }) => Number.isSafeInteger(unitPrice))).toBe(true);
    // Fire is 3.5 stars: whole-star table entry 3 (200) plus 50 for the half star.
    expect(totems.find(({ id }) => id === "totem-Fire")?.unitPrice).toBe(250);
  });

  it("allows quantities for ordinary Items, Gems, and Silver exchanges but not IAP or Eggs", () => {
    expect(storeCanBuyMultiple(storeStockForCategory(1, data, profile)[0]!)).toBe(true);
    expect(storeCanBuyMultiple(storeStockForCategory(2, data, profile)[0]!)).toBe(false);
    const currency = storeStockForCategory(3, data, profile);
    expect(storeCanBuyMultiple(currency[0]!)).toBe(false);


    const silverExchange = currency.find((stock) => stock.kind === "silverExchange")!;
    expect(storeCanBuyMultiple(silverExchange)).toBe(true);
    expect(storeCanBuyMultiple(storeStockForCategory(4, data, profile)[0]!)).toBe(false);
    expect(storeCanBuyMultiple(storeStockForCategory(5, data, profile)[0]!)).toBe(false);
  });

  it("names and describes stock from the shipped Renderable and long-description keys", () => {
    const items = storeStockForCategory(1, data, profile);
    const card3 = items.find((stock) => stock.id === "card-3")!;
    expect(storeStockLongDescription(card3, strings, data))
      .toBe(strings["Card3LongDescriptionKey"]);



    const glowGem = items.find((stock) => stock.id === "gem-veteran-glow")!;
    expect(storeStockDisplayName(glowGem, strings)).toBe("Random Gem: Square-Imbued");
    expect(storeStockLongDescription(glowGem, strings, data))
      .toBe(strings["GemLongDescriptionKey"]);

    // Singular Renderable*NameKey formats, not the plural aisle headings.
    const recipe = storeStockForCategory(4, data, profile)
      .find((stock) => stock.id === "recipe-Carnoraptor")!;
    expect(storeStockDisplayName(recipe, strings)).toBe("Carnoraptor Recipe");
    expect(storeStockLongDescription(recipe, strings, data))
      .toBe(strings["RecipeLongDescriptionKey"]!.replace("%@", "Southern Alvalon"));

    const totem = storeStockForCategory(5, data, profile)
      .find((stock) => stock.id === "totem-Fire")!;
    expect(storeStockDisplayName(totem, strings)).toBe("Fire Spirit Totem");
    expect(storeStockLongDescription(totem, strings, data))
      .toBe(strings["SpiritTotemLongDescriptionFormatKey"]!
        .replace("%@", "Fire")
        .replace("%@", "Northern Alvalon"));

    const eggs = storeStockForCategory(2, data, profile);
    expect(storeStockLongDescription(eggs[0]!, strings, data))
      .toBe(strings["SilverEggLongDescriptionKey"]);
    expect(storeStockLongDescription(eggs[1]!, strings, data))
      .toBe(strings["GoldEggLongDescriptionKey"]);

    // An archive without ThingsInWorld resolves no world, so those two fall back to the source's
    // empty-string default rather than printing a placeholder.
    const withoutWorlds = GameData.fromRaw(rawWithoutWorlds);
    expect(storeStockLongDescription(recipe, strings, withoutWorlds)).toBe("");
    expect(storeStockLongDescription(totem, strings, withoutWorlds)).toBe("");
  });

  it("keeps the Store selection and four source CFlow neighbors visible", () => {
    expect(storeCarouselCardLayout(5, 5, 90, 60, 11)).toEqual({
      x: 0,
      scale: 1,
      visible: true,
      zIndex: 25,
      roundedIndex: 5,
    });


    expect(storeCarouselCardLayout(4, 5, 90, 60, 11)).toEqual({
      x: -97.5,
      scale: 0.88,
      visible: true,
      zIndex: 11,
      roundedIndex: 5,
    });
    // Distance 4 is the outermost visible card: 30 + 4 * 90 * 3/4.
    expect(storeCarouselCardLayout(9, 5, 90, 60, 11)).toEqual({
      x: 300,
      scale: 0.52,
      visible: true,
      zIndex: 34,
      roundedIndex: 5,
    });
    expect(storeCarouselCardLayout(10, 5, 90, 60, 11).visible).toBe(false);
  });

  it("interpolates the source position and scale between rounded layouts", () => {
    // 0.75 * 0 + 0.25 * -(30 + 67.5): only X and scale blend, never the discrete lanes.
    expect(storeCarouselCardLayout(5, 5.25, 90, 60, 11)).toEqual({
      x: -24.375,
      scale: 0.97,
      visible: true,
      zIndex: 25,
      roundedIndex: 5,
    });
    expect(storeCarouselCardLayout(6, 5.25, 90, 60, 11)).toEqual({
      x: 73.125,
      scale: 0.91,
      visible: true,
      zIndex: 31,
      roundedIndex: 5,
    });
  });

  it("pins the source gem-glow quality colours and pulse", () => {


    expect(SOURCE_ITEM_QUALITY_COLORS[1]).toBe(0x3ff1ff);
    expect(SOURCE_ITEM_QUALITY_COLORS[2]).toBe(0xe7ec19);

    // `pulseActionWithDuration:2.0 maxOpacity:255 minOpacity:150`, linear down then back up.
    expect(storeGemGlowAlpha(0)).toBeCloseTo(1, 6);
    expect(storeGemGlowAlpha(1_000)).toBeCloseTo(150 / 255, 6);
    expect(storeGemGlowAlpha(2_000)).toBeCloseTo(1, 6);
    expect(storeGemGlowAlpha(500)).toBeCloseTo((1 + 150 / 255) / 2, 6);
    expect(storeGemGlowAlpha(4_500)).toBeCloseTo(storeGemGlowAlpha(500), 6);
    expect(() => storeGemGlowAlpha(-1)).toThrow(/invalid Store gem glow/);
  });

  it("pins each Store reflection to the arguments its source call site passes", () => {


    expect(SOURCE_STORE_REFLECTION_ARGS.categoryArt)
      .toEqual({ percentOfHeight: 1, fadeStart: 255, fadeTo: 25, fitsToParent: true });
    expect(SOURCE_STORE_REFLECTION_ARGS.recipe)
      .toEqual({ percentOfHeight: 1, fadeStart: 255, fadeTo: 25, fitsToParent: true });

    expect(SOURCE_STORE_REFLECTION_ARGS.totem)
      .toEqual({ percentOfHeight: 1, fadeStart: 255, fadeTo: 10, fitsToParent: true });


    expect(SOURCE_STORE_REFLECTION_ARGS.cflow)
      .toEqual({ percentOfHeight: 0.75, fadeStart: 128, fadeTo: 0, fitsToParent: false });
  });

  it("crops the reflection texture rect instead of squashing the sprite", () => {
    const frame = { x: 12, y: 30, width: 96, height: 64 };
    // percentOfHeight 1.0 keeps the whole rect: `roundf(64 * 1.0) == 64`, so y is unmoved.
    expect(storeReflectionTextureRect(frame, 1)).toEqual({ x: 12, y: 30, width: 96, height: 64 });
    // 0.75 keeps the BOTTOM 48 rows — `y + height - h'` = 30 + 64 - 48. A vertical squash would
    // have kept all 64 rows at 0.75 scale, which is the picture the port used to draw.
    expect(storeReflectionTextureRect(frame, 0.75))
      .toEqual({ x: 12, y: 46, width: 96, height: 48 });
    // `roundf`, not truncation: 0.75 * 65 = 48.75 rounds up to 49.
    expect(storeReflectionTextureRect({ ...frame, height: 65 }, 0.75))
      .toEqual({ x: 12, y: 46, width: 96, height: 49 });
    expect(() => storeReflectionTextureRect(frame, 0)).toThrow(/percentOfHeight/);
    expect(() => storeReflectionTextureRect(frame, 1.5)).toThrow(/percentOfHeight/);
    expect(() => storeReflectionTextureRect({ ...frame, height: 0 }, 1))
      .toThrow(/positive texture frame/);
  });

  it("applies the uniform fit only when the sprite is not its own parentOverride", () => {

    expect(storeReflectionFit(120, 60)).toBe(0.5);
    expect(storeReflectionFit(60, 120)).toBe(2);

    expect(storeReflectionFit(120, undefined)).toBe(1);
    expect(() => storeReflectionFit(0, 60)).toThrow(/positive texture width/);
    expect(() => storeReflectionFit(120, 0)).toThrow(/positive card width/);
  });
});
