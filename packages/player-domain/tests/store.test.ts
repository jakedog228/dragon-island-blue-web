import { describe, expect, it } from "vitest";
import { replayableRng } from "@dib/engine";
import { PlayerProfile } from "../src/playerProfile.js";
import {
  SOURCE_STORE_EGG_STOCK,
  SOURCE_STORE_GEM_STOCK,
  SOURCE_STORE_SILVER_EXCHANGES,
  SOURCE_STORE_USABLE_STOCK,
  purchaseStoreStock,
  recipeStoreStock,
  requestExternalGoldPurchase,
  spiritTotemStoreStock,
  storeHasHalfStar,
  storeStockAllowsMultiple,
  storeWholeStars,
} from "../src/store.js";

function profile(silver = 100_000, gold = 20_000): PlayerProfile {
  return new PlayerProfile({
    heroLevel: 10,
    monsterPartyLevels: [1],
    silver,
    gold,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
}

describe("source Store transactions", () => {
  it("pins exact card, egg, Gem, and silver-exchange prices", () => {


    expect(SOURCE_STORE_USABLE_STOCK.map(({ currency, unitPrice }) => `${unitPrice} ${currency}`))
      .toEqual(["50 silver", "250 silver", "100 gold"]);
    expect(SOURCE_STORE_EGG_STOCK.map(({ unitPrice }) => unitPrice)).toEqual([100, 298]);
    expect(SOURCE_STORE_GEM_STOCK.map(({ unitPrice }) => unitPrice))
      .toEqual([100, 200, 300, 900, 2_000, 6_000, 30_000, 60_000]);
    expect(SOURCE_STORE_SILVER_EXCHANGES).toMatchObject([
      { silverAmount: 500, unitPrice: 10 },
      { silverAmount: 5_000, unitPrice: 80 },
    ]);
  });

  it("debits before adding independent item objects and preserves the silver-card cap predicate", () => {
    const player = profile();
    const card = SOURCE_STORE_USABLE_STOCK[0]!;
    expect(purchaseStoreStock(player, card, 2)).toMatchObject({
      currency: "silver",
      spent: 100,
      balance: 99_900,
    });
    expect(player.inventory.countByInstanceName("Card")).toBe(2);
    purchaseStoreStock(player, card, 3);
    expect(() => purchaseStoreStock(player, card)).toThrow(/limit is 5/);
    expect(player.snapshot().silver).toBe(99_750);

    // The cap gates silver Card stock only (`hasPrefix:"Card"` AND `goldCost == 0`). The gold card
    // stays purchasable at five held cards, though it still counts toward the silver cards' cap.
    const goldCard = SOURCE_STORE_USABLE_STOCK[2]!;
    expect(purchaseStoreStock(player, goldCard)).toMatchObject({
      currency: "gold",
      spent: 100,
    });
    expect(player.inventory.countByInstanceName("CardGold")).toBe(1);
  });

  it("uses explicit RNG for generated Gem stats and never spends on missing RNG", () => {
    const player = profile();
    const stock = SOURCE_STORE_GEM_STOCK[1]!;
    expect(() => purchaseStoreStock(player, stock)).toThrow(/explicit RNG/);
    expect(player.snapshot().silver).toBe(100_000);
    purchaseStoreStock(player, stock, 1, replayableRng([0, 0]));
    const gem = player.inventory.looseItems().find((item) => item.kind === "gem");
    expect(gem).toMatchObject({ level: 10, quality: 1, slot: 0 });
    expect(gem?.kind === "gem" ? gem.enabledStats : []).toHaveLength(2);
  });

  it("returns the already-committed usable and Gem objects for Store reward presentation", () => {
    const player = profile();
    const card = SOURCE_STORE_USABLE_STOCK[0]!;
    const cardPurchase = purchaseStoreStock(player, card);
    expect(cardPurchase).toMatchObject({
      receivedItems: [{
        kind: "usable",
        definitionPath: "Usables.Card",
        instanceName: "Card",
        level: 1,
      }],
    });
    expect(player.inventory.countByInstanceName("Card")).toBe(1);
    expect(player.snapshot().silver).toBe(99_950);

    const gem = SOURCE_STORE_GEM_STOCK[1]!;
    if (gem.kind !== "gem") throw new Error("Store Gem fixture must resolve to Gem stock");
    const gemPurchase = purchaseStoreStock(player, gem, 1, replayableRng([0, 0]));
    expect(gemPurchase).toMatchObject({
      receivedItems: [{
        kind: "gem",
        definitionPath: gem.definitionPath,
        level: gem.level,
        quality: gem.quality,
        slot: gem.slot,
        enabledStats: ["MaxHP", "Attack"],
      }],
    });
    expect(player.inventory.looseItems().filter((item) => item.kind === "gem")).toHaveLength(1);
    expect(player.snapshot().silver).toBe(99_750);
  });

  it("returns the transient Egg row that LootPageProvider shows before hatching", () => {
    const player = profile();
    expect(purchaseStoreStock(player, SOURCE_STORE_EGG_STOCK[0]!)).toMatchObject({
      receivedItems: [{ kind: "egg" }],
      pendingEggKind: "silver",
    });
    expect(purchaseStoreStock(player, SOURCE_STORE_EGG_STOCK[1]!)).toMatchObject({
      receivedItems: [{ kind: "monsterEgg" }],
      pendingEggKind: "gold",
    });
  });

  it("applies recipe/totem identity gates and fails closed for external gold", () => {
    const player = profile();
    const recipe = recipeStoreStock("Carnoraptor", 3);
    expect(recipe.unitPrice).toBe(450);
    purchaseStoreStock(player, recipe);
    expect(() => purchaseStoreStock(player, recipe)).toThrow(/already learned/);

    const totem = spiritTotemStoreStock("Fire", 4, true);
    expect(totem.unitPrice).toBe(450);
    purchaseStoreStock(player, totem);
    expect(() => purchaseStoreStock(player, totem)).toThrow(/already owned/);
    expect(() => requestExternalGoldPurchase(1)).toThrow(/authorized platform/);
  });

  it("splits shipped fractional rarity into whole stars plus a half-star flag", () => {
    // Twelve of the 23 shipped Combines results carry a fractional `stars` value; passing it
    // straight into the constructors is what made the Recipes category throw on open.
    for (const [stars, whole, half] of [
      [3.5, 3, true],
      [9.5, 9, true],
      [4, 4, false],
      [1, 1, false],
      [0.5, 1, true],
    ] as const) {
      expect(storeWholeStars(stars)).toBe(whole);
      expect(storeHasHalfStar(stars)).toBe(half);
    }
    expect(recipeStoreStock("Carnoraptor", storeWholeStars(3.5)).unitPrice).toBe(450);
    expect(spiritTotemStoreStock("Fire", storeWholeStars(5.5), storeHasHalfStar(5.5)).unitPrice)
      .toBe(850);
    expect(() => recipeStoreStock("Carnoraptor", 3.5)).toThrow(/whole-star/);
  });

  it("refuses a quantity above one for every single-purchase stock", () => {
    const player = profile();
    const recipe = recipeStoreStock("Carnoraptor", 3);
    const totem = spiritTotemStoreStock("Fire", 4, true);
    const egg = SOURCE_STORE_EGG_STOCK[0]!;
    for (const stock of [recipe, totem, egg]) {
      expect(storeStockAllowsMultiple(stock)).toBe(false);
      expect(() => purchaseStoreStock(player, stock, 99)).toThrow(/single-purchase/);
    }
    // Nothing was charged: the gate runs before the ownership checks and the debit.
    expect(player.snapshot().gold).toBe(20_000);
    expect(player.hasCombineRecipe("Carnoraptor")).toBe(false);

    for (const stock of [
      SOURCE_STORE_USABLE_STOCK[0]!,
      SOURCE_STORE_GEM_STOCK[0]!,
      SOURCE_STORE_SILVER_EXCHANGES[0]!,
    ]) {
      expect(storeStockAllowsMultiple(stock)).toBe(true);
    }
    expect(purchaseStoreStock(player, SOURCE_STORE_SILVER_EXCHANGES[0]!, 3)).toMatchObject({
      spent: 30,
      currency: "gold",
    });
    expect(player.snapshot().silver).toBe(101_500);
  });
});
