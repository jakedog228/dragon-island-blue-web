import type { GameData } from "@dib/gamedata/browser";
import {
  localizedRenderableName,
  localizedString,
  type LocalizedStrings,
} from "../localization.js";
import {
  SOURCE_IAP_GOLD_AMOUNTS,
  SOURCE_STORE_EGG_STOCK,
  SOURCE_STORE_GEM_STOCK,
  SOURCE_STORE_SILVER_EXCHANGES,
  SOURCE_STORE_USABLE_STOCK,
  recipeStoreStock,
  spiritTotemStoreStock,
  storeHasHalfStar,
  storeStockAllowsMultiple,
  storeWholeStars,
  type PlayerProfile,
  type StoreStock,
} from "@dib/player-domain";

export type StoreCategory = 1 | 2 | 3 | 4 | 5;

export type StoreDisplayStock =
  | StoreStock
  | {
      readonly id: string;
      readonly kind: "iapGold";
      readonly tier: number;
      readonly goldAmount: number;
      readonly canBuyMoreThanOne: false;
    };

export const SOURCE_STORE_CATEGORY_ORDER: readonly StoreCategory[] =
  Object.freeze([1, 2, 3, 4, 5]);

export function storeCategoryLocalizationKey(category: StoreCategory): string {
  return {
    1: "ItemsCategoryKey",
    2: "EggsCategoryKey",
    3: "CurrencyCategoryKey",
    4: "RecipesCategoryKey",
    5: "TotemsCategoryKey",
  }[category];
}

export function storeCategoryAsset(category: StoreCategory): string {
  return {
    1: "ItemsCategory-hd",
    2: "EggsCategory-hd",
    3: "CurrencyCategory-hd",
    4: "RecipesCategory-hd",
    5: "TotemsCategory-hd",
  }[category];
}

export function storeStockForCategory(
  category: StoreCategory,
  data: GameData,
  profile: PlayerProfile,
): readonly StoreDisplayStock[] {
  switch (category) {
    case 1:
      return Object.freeze([...SOURCE_STORE_USABLE_STOCK, ...SOURCE_STORE_GEM_STOCK]);
    case 2:
      return SOURCE_STORE_EGG_STOCK;
    case 3:
      return Object.freeze([
        ...SOURCE_IAP_GOLD_AMOUNTS.map((goldAmount, index) => Object.freeze({
          id: `iap-gold-${index + 1}`,
          kind: "iapGold" as const,
          tier: index + 1,
          goldAmount,
          canBuyMoreThanOne: false as const,
        })),
        ...SOURCE_STORE_SILVER_EXCHANGES,
      ]);
    case 4:
      return Object.freeze(data.allCombineRecipes()
        .filter(({ resultShortType }) => !profile.hasCombineRecipe(resultShortType))
        .map(({ resultShortType }) => recipeStoreStock(
          resultShortType,
          storeWholeStars(data.monsterByShortType(resultShortType).stars),
        )));
    case 5:


      return Object.freeze(data.monsterBookOrder()
        .map(({ monster }) => monster)
        .filter(({ category: monsterCategory }) => monsterCategory === "Summon")
        .filter(({ shortType }) => {
          try {
            return profile.spiritSavedXp(shortType) === 0;
          } catch {
            return true;
          }
        })
        .map(({ shortType, stars }) =>
          spiritTotemStoreStock(shortType, storeWholeStars(stars), storeHasHalfStar(stars))));
  }
}


export function storeCanBuyMultiple(stock: StoreDisplayStock): boolean {
  return stock.kind === "iapGold" ? false : storeStockAllowsMultiple(stock);
}


export function storeStockDisplayName(
  stock: StoreDisplayStock,
  strings: LocalizedStrings,
): string {
  switch (stock.kind) {
    case "iapGold":
      return localizedString(strings, "GoldIAPFormatKey")
        .replace("%d", String(stock.goldAmount));
    case "usable":
    case "egg":
      return localizedRenderableName(strings, [stock.instanceName]);
    case "gem":
      return `${localizedString(strings, "RandomGemKey")}: ${
        localizedString(strings, `${STORE_GEM_SLOT_NAMES[stock.slot]}SlotKey`)
      }-${
        localizedString(strings, `ItemType${STORE_GEM_QUALITY_NAMES[stock.quality]}Key`)
      }`;
    case "silverExchange":
      return localizedString(strings, "RenderableSilverNameKey")
        .replace("%d", String(stock.silverAmount));
    case "recipe":
      return localizedString(strings, "RenderableRecipeNameKey")
        .replace("%@", localizedRenderableName(strings, [stock.combineName]));
    case "spiritTotem":
      return localizedString(strings, "RenderableSpiritTotemNameKey")
        .replace("%@", localizedRenderableName(strings, [stock.shortType]));
  }
}

const STORE_GEM_SLOT_NAMES = ["Novice", "Veteran", "Elite", "Grandmaster"] as const;


const STORE_GEM_QUALITY_NAMES = ["Magic", "Epic", "Unique"] as const;


export function storeStockLongDescription(
  stock: StoreDisplayStock,
  strings: LocalizedStrings,
  data: GameData,
): string {
  switch (stock.kind) {
    case "spiritTotem": {
      const world = data.totemWorldName(stock.shortType);
      if (world === undefined) return "";
      return localizedString(strings, "SpiritTotemLongDescriptionFormatKey")
        .replace("%@", localizedRenderableName(strings, [stock.shortType]))
        .replace("%@", localizedRenderableName(strings, [world]));
    }
    case "recipe": {
      const world = data.recipeWorldName(stock.combineName);
      if (world === undefined) return "";
      return localizedString(strings, "RecipeLongDescriptionKey")
        .replace("%@", localizedRenderableName(strings, [world]));
    }
    case "silverExchange":
      return localizedString(strings, "SilverLongDescriptionKey");
    case "gem":
      return localizedString(strings, "GemLongDescriptionKey");
    case "egg":
      return localizedString(
        strings,
        stock.onlyMonsters ? "GoldEggLongDescriptionKey" : "SilverEggLongDescriptionKey",
      );
    case "usable":
      // `Card%dLongDescriptionKey` off the item's own level; any other usable has no long copy.
      return stock.instanceName.startsWith("Card")
        ? localizedString(strings, `Card${stock.level}LongDescriptionKey`)
        : "";
    case "iapGold":
      return "";
  }
}
