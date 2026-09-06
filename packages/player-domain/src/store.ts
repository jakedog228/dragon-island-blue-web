import type { PlayerStatName } from "./inventory.js";
import type { PlayerProfile } from "./playerProfile.js";
import { dungeonRandomGemStats } from "@dib/engine/dungeon";
import type { Rng } from "@dib/engine";

export type StoreCurrency = "silver" | "gold";

interface StoreStockBase {
  readonly id: string;
  readonly currency: StoreCurrency;
  readonly unitPrice: number;
}

export type StoreStock =
  | (StoreStockBase & {
      readonly kind: "usable";
      readonly definitionPath: string;
      readonly instanceName: string;
      readonly level: number;
    })
  | (StoreStockBase & {
      readonly kind: "gem";
      readonly definitionPath: string;
      readonly level: number;
      readonly quality: number;
      readonly slot: 0 | 1 | 2 | 3;
    })
  | (StoreStockBase & {
      readonly kind: "egg";
      readonly definitionPath: "DestroyOnPickup.Egg" | "DestroyOnPickup.MonsterEgg";
      readonly instanceName: "Egg" | "MonsterEgg";
      readonly onlyMonsters: boolean;
    })
  | (StoreStockBase & {
      readonly kind: "recipe";
      readonly combineName: string;
    })
  | (StoreStockBase & {
      readonly kind: "spiritTotem";
      readonly shortType: string;
    })
  | (StoreStockBase & {
      readonly kind: "silverExchange";
      readonly silverAmount: number;
    });


export const SOURCE_STORE_USABLE_STOCK: readonly StoreStock[] = Object.freeze([
  usable("card-1", "Usables.Card", "Card", 1, "silver", 50),
  usable("card-2", "Usables.CardSilver", "CardSilver", 2, "silver", 250),
  usable("card-3", "Usables.CardGold", "CardGold", 3, "gold", 100),
]);

export const SOURCE_STORE_EGG_STOCK: readonly StoreStock[] = Object.freeze([
  Object.freeze({
    id: "egg",
    kind: "egg",
    definitionPath: "DestroyOnPickup.Egg",
    instanceName: "Egg",
    onlyMonsters: false,
    currency: "gold",
    unitPrice: 100,
  }),
  Object.freeze({
    id: "monster-egg",
    kind: "egg",
    definitionPath: "DestroyOnPickup.MonsterEgg",
    instanceName: "MonsterEgg",
    onlyMonsters: true,
    currency: "gold",
    unitPrice: 298,
  }),
]);

export const SOURCE_STORE_GEM_STOCK: readonly StoreStock[] = Object.freeze([
  gem("gem-novice-plain", 100, 0, 10, 0, 0),
  gem("gem-novice-glow", 200, 0, 10, 1, 0),
  gem("gem-veteran-plain", 300, 0, 15, 0, 1),
  gem("gem-veteran-glow", 900, 0, 15, 1, 1),
  gem("gem-elite-plain", 2_000, 0, 35, 0, 2),
  gem("gem-elite-glow", 6_000, 0, 35, 1, 2),
  gem("gem-grandmaster-plain", 30_000, 0, 65, 0, 3),
  gem("gem-grandmaster-glow", 60_000, 0, 65, 1, 3),
]);

export const SOURCE_STORE_SILVER_EXCHANGES: readonly StoreStock[] = Object.freeze([
  Object.freeze({
    id: "silver-500",
    kind: "silverExchange",
    silverAmount: 500,
    currency: "gold",
    unitPrice: 10,
  }),
  Object.freeze({
    id: "silver-5000",
    kind: "silverExchange",
    silverAmount: 5_000,
    currency: "gold",
    unitPrice: 80,
  }),
]);

export const SOURCE_STORE_STOCK: readonly StoreStock[] = Object.freeze([
  ...SOURCE_STORE_USABLE_STOCK,
  ...SOURCE_STORE_EGG_STOCK,
  ...SOURCE_STORE_GEM_STOCK,
  ...SOURCE_STORE_SILVER_EXCHANGES,
]);

export function sourceStoreStock(stockId: string): StoreStock {
  const stock = SOURCE_STORE_STOCK.find(({ id }) => id === stockId);
  if (stock === undefined) throw new Error(`Store: unknown stock ${stockId}`);
  return stock;
}

export const SOURCE_IAP_GOLD_AMOUNTS = Object.freeze([200, 550, 1_150, 3_000, 6_250, 13_000]);
export const SOURCE_TOTEM_GOLD_BY_WHOLE_STAR =
  Object.freeze([100, 100, 200, 400, 800, 1_500, 2_000, 4_000, 6_000, 8_000]);

export interface StorePurchaseResult {
  readonly stockId: string;
  readonly quantity: number;
  readonly currency: StoreCurrency;
  readonly spent: number;
  readonly balance: number;
  /** Immutable render data for objects already committed by this checkout. */
  readonly receivedItems: readonly StoreReceivedItem[];
  /** Destroy-on-pickup Eggs are presented/settled by SlotMachineNode, never stored as inventory. */
  readonly pendingEggKind?: "silver" | "gold";
}

export type StoreReceivedItem =
  | { readonly kind: "egg" }
  | { readonly kind: "monsterEgg" }
  | {
      readonly kind: "usable";
      readonly definitionPath: string;
      readonly instanceName: string;
      readonly level: number;
    }
  | {
      readonly kind: "gem";
      readonly definitionPath: string;
      readonly level: number;
      readonly quality: 0 | 1;
      readonly slot: 0 | 1 | 2 | 3;
      readonly enabledStats: readonly PlayerStatName[];
    };

/** `StoreNode` gameplay checkout. Price, quantity, cap, and identity all come from server/local
 * stock; the caller supplies only a selected stock ID and quantity. */
export function purchaseStoreStock(
  profile: PlayerProfile,
  stock: StoreStock,
  quantity = 1,
  rng?: Rng,
): StorePurchaseResult {
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error(`Store: quantity must be a positive safe integer; got ${quantity}`);
  }
  // The single-purchase kinds each carry a one-time ownership check below, which a quantity above
  // one would pass once and then settle repeatedly. Gate before any check so a crafted command
  // cannot buy one Totem 99 times or pay twice for the same Recipe.
  if (quantity > 1 && !storeStockAllowsMultiple(stock)) {
    throw new Error(`Store: ${stock.id} is a single-purchase stock; quantity must be 1`);
  }
  if (isCaptureCardStock(stock)) {
    const cards = storeCaptureCardCount(profile);
    if (cards >= SOURCE_STORE_CAPTURE_CARD_LIMIT) {
      throw new Error(`Store: capture-card inventory limit is ${SOURCE_STORE_CAPTURE_CARD_LIMIT}`);
    }
  }
  if (stock.kind === "recipe" && profile.hasCombineRecipe(stock.combineName)) {
    throw new Error(`Store: recipe ${stock.combineName} is already learned`);
  }
  if (stock.kind === "gem" && rng === undefined) {
    throw new Error("Store: Gem purchase requires an explicit RNG");
  }
  if (stock.kind === "spiritTotem") {
    try {
      profile.spiritSavedXp(stock.shortType);
      throw new Error(`Store: spirit ${stock.shortType} is already owned`);
    } catch (error) {
      if (error instanceof Error && !/not unlocked/.test(error.message)) throw error;
    }
  }
  const spent = stock.unitPrice * quantity;
  if (!Number.isSafeInteger(spent)) throw new Error("Store: purchase total is not a safe integer");
  const paid = stock.currency === "silver"
    ? profile.spendSilver(spent)
    : profile.spendGold(spent);
  if (!paid) throw new Error(`Store: insufficient ${stock.currency}`);

  const receivedItems: StoreReceivedItem[] = [];
  for (let index = 0; index < quantity; index += 1) {
    switch (stock.kind) {
      case "usable":
        profile.inventory.addUsable(stock.definitionPath, stock.instanceName, stock.level);
        receivedItems.push(Object.freeze({
          kind: "usable",
          definitionPath: stock.definitionPath,
          instanceName: stock.instanceName,
          level: stock.level,
        }));
        break;
      case "gem": {
        const enabledStats = dungeonRandomGemStats(
          stock.quality as 0 | 1,
          rng!,
        ) as readonly PlayerStatName[];
        profile.inventory.addGem({
          ...stock,
          enabledStats,
        });
        receivedItems.push(Object.freeze({
          kind: "gem",
          definitionPath: stock.definitionPath,
          level: stock.level,
          quality: stock.quality as 0 | 1,
          slot: stock.slot,
          enabledStats,
        }));
        break;
      }
      case "egg":
        // LootPageProvider still presents the transient Egg in New Items. Taking/closing that
        // page calls `Player.addItem:`, which immediately destroys it into SlotMachineNode; the
        // receipt entry is presentation data only and no durable Egg object is inserted.
        receivedItems.push(Object.freeze({
          kind: stock.onlyMonsters ? "monsterEgg" as const : "egg" as const,
        }));
        break;
      case "recipe":
        profile.learnCombineRecipe(stock.combineName);
        break;
      case "spiritTotem":
        profile.awardSpiritTotem(stock.shortType);
        break;
      case "silverExchange":
        profile.awardSilver(stock.silverAmount);
        break;
    }
  }
  return Object.freeze({
    stockId: stock.id,
    quantity,
    currency: stock.currency,
    spent,
    balance: stock.currency === "silver" ? profile.snapshot().silver : profile.snapshot().gold,
    receivedItems: Object.freeze(receivedItems),
    ...(stock.kind === "egg"
      ? { pendingEggKind: stock.onlyMonsters ? "gold" as const : "silver" as const }
      : {}),
  });
}


export function storeStockAllowsMultiple(stock: StoreStock): boolean {
  return stock.kind === "usable" || stock.kind === "gem" || stock.kind === "silverExchange";
}

/** Silver capture cards are the one capped stock. `MaxItemsFormatKey` reports both numbers. */
export const SOURCE_STORE_CAPTURE_CARD_LIMIT = 5;

export function storeCaptureCardCount(profile: PlayerProfile): number {
  return profile.inventory.looseItems().filter(
    (item) => item.kind === "usable" && item.instanceName.startsWith("Card"),
  ).length;
}

function isCaptureCardStock(stock: StoreStock): boolean {
  return stock.kind === "usable" &&
    stock.instanceName.startsWith("Card") &&
    stock.currency === "silver";
}

/** Shipped `Monsters.plist` stores rarity as one fractional `stars` value (Carnoraptor is 3.5).
 * Source display and pricing split it into a whole-star count plus a half-star flag; passing the
 * combined float straight into the store constructors is what crashed the Recipes category. */
export function storeWholeStars(stars: number): number {
  if (!Number.isFinite(stars)) throw new Error(`Store: invalid stars ${stars}`);
  return Math.max(1, Math.floor(stars));
}

export function storeHasHalfStar(stars: number): boolean {
  if (!Number.isFinite(stars)) throw new Error(`Store: invalid stars ${stars}`);
  return stars % 1 !== 0;
}


export function recipeStoreStock(combineName: string, wholeStars: number): StoreStock {
  requireName(combineName, "combineName");
  if (!Number.isSafeInteger(wholeStars) || wholeStars < 1) {
    throw new Error(`Store: invalid recipe whole-star count ${wholeStars}`);
  }
  return Object.freeze({
    id: `recipe-${combineName}`,
    kind: "recipe",
    combineName,
    currency: "gold",
    unitPrice: 150 * wholeStars,
  });
}

export function spiritTotemStoreStock(
  shortType: string,
  wholeStars: number,
  halfStar: boolean,
): StoreStock {
  requireName(shortType, "shortType");
  const base = SOURCE_TOTEM_GOLD_BY_WHOLE_STAR[wholeStars - 1] ?? 100;
  return Object.freeze({
    id: `totem-${shortType}`,
    kind: "spiritTotem",
    shortType,
    currency: "gold",
    unitPrice: base + (halfStar ? 50 : 0),
  });
}

/** External StoreKit ownership is deliberately absent from the port's trusted/local simulator. */
export function requestExternalGoldPurchase(_tier: number): never {
  throw new Error("Store: external gold purchases require an authorized platform purchase provider");
}

function usable(
  id: string,
  definitionPath: string,
  instanceName: string,
  level: number,
  currency: StoreCurrency,
  unitPrice: number,
): StoreStock {
  return Object.freeze({
    id,
    kind: "usable",
    definitionPath,
    instanceName,
    level,
    currency,
    unitPrice,
  });
}

function gem(
  id: string,
  silver: number,
  gold: number,
  level: number,
  quality: number,
  slot: 0 | 1 | 2 | 3,
): StoreStock {
  return Object.freeze({
    id,
    kind: "gem",
    definitionPath: [
      "Gems.RandomNovice", "Gems.RandomVeteran", "Gems.RandomElite", "Gems.RandomGrandmaster",
    ][slot]!,
    level,
    quality,
    slot,
    currency: gold < 1 ? "silver" : "gold",
    unitPrice: gold < 1 ? silver : gold,
  });
}

function requireName(value: string, label: string): void {
  if (value.length === 0) throw new Error(`Store: ${label} must not be empty`);
}
