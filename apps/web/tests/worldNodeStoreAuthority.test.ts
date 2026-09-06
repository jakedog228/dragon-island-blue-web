import { replayableRng } from "@dib/engine";
import {
  PlayerProfile,
  SOURCE_STORE_EGG_STOCK,
  SOURCE_STORE_USABLE_STOCK,
  type StorePurchaseResult,
  type StoreStock,
} from "@dib/player-domain";
import { describe, expect, it, vi } from "vitest";
import { WorldNode } from "../src/world/worldNode.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

describe("WorldNode Official Store settlement", () => {
  it("mirrors the committed receipt without re-deciding price, stock or RNG", async () => {
    const profile = new PlayerProfile({
      heroLevel: 10,
      monsterPartyLevels: [1],
      silver: 1_000,
      gold: 100,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    });
    const before = profile.snapshot();
    const submitStore = vi.fn(async () => ({
      events: [{
        seq: 1,
        type: "store.purchased" as const,
        stockId: "card-1",
        quantity: 1,
        currency: "silver" as const,
        spent: 50,
        balance: 950,
        randomDraws: [],
        receivedItems: [{
          kind: "usable" as const,
          definitionPath: "Usables.Card",
          instanceName: "Card",
          level: 1,
        }],
      }],
    }));
    const pendingEgg = vi.fn(() => undefined);
    const receiver = {
      deps: {
        authority: { submitStore, egg: { pendingEgg } },
        playerRuntime: { profile },
        questRewardRng: replayableRng([]),
        onStateChanged: vi.fn(),
      },
      refreshHeroXp: vi.fn(),
      // The prototype method under test is invoked against a hand-built receiver, so the private
      // mirror it delegates to has to be carried across explicitly.
      mirrorOfficialStorePurchase: (WorldNode.prototype as unknown as {
        mirrorOfficialStorePurchase: unknown;
      }).mirrorOfficialStorePurchase,
    };
    const purchaseStoreItem = (WorldNode.prototype as unknown as {
      purchaseStoreItem(
        this: typeof receiver,
        stock: StoreStock,
        quantity: number,
      ): Promise<StorePurchaseResult>;
    }).purchaseStoreItem;

    const result = await purchaseStoreItem.call(
      receiver,
      SOURCE_STORE_USABLE_STOCK[0]!,
      1,
    );

    expect(submitStore).toHaveBeenCalledWith({
      type: "store.purchase",
      stockId: "card-1",
      quantity: 1,
    });
    expect(result.receivedItems).toEqual([{
      kind: "usable",
      definitionPath: "Usables.Card",
      instanceName: "Card",
      level: 1,
    }]);


    expect(before.silver).toBe(1_000);
    expect(profile.snapshot().silver).toBe(950);
    expect(profile.snapshot().gold).toBe(before.gold);
    expect(profile.inventory.countByInstanceName("Card")).toBe(1);
    expect(pendingEgg).toHaveBeenCalled();
  });

  it("carries the Egg kind the authority's own continuation recorded", async () => {
    const profile = new PlayerProfile({
      heroLevel: 10,
      monsterPartyLevels: [1],
      silver: 1_000,
      gold: 300,
      captureCards: { 1: 0, 2: 0, 3: 0 },
    });
    const eggStock = SOURCE_STORE_EGG_STOCK.find((stock) => stock.id === "monster-egg");
    if (eggStock === undefined || eggStock.kind !== "egg") {
      throw new Error("source Store stock has no MonsterEgg entry");
    }
    const submitStore = vi.fn(async () => ({
      events: [{
        seq: 1,
        type: "store.purchased" as const,
        stockId: eggStock.id,
        quantity: 1,
        currency: eggStock.currency,
        spent: eggStock.unitPrice,
        balance: 0,
        randomDraws: [],
        // LootPageProvider presents this transient row before addItem destroys it into a hatch.
        receivedItems: [{ kind: "monsterEgg" as const }],
      }],
    }));
    const receiver = {
      deps: {
        authority: {
          submitStore,
          egg: { pendingEgg: () => ({ phase: "awaiting-spin", kind: "gold" }) },
        },
        playerRuntime: { profile },
        questRewardRng: replayableRng([]),
        onStateChanged: vi.fn(),
      },
      refreshHeroXp: vi.fn(),
      // The prototype method under test is invoked against a hand-built receiver, so the private
      // mirror it delegates to has to be carried across explicitly.
      mirrorOfficialStorePurchase: (WorldNode.prototype as unknown as {
        mirrorOfficialStorePurchase: unknown;
      }).mirrorOfficialStorePurchase,
    };
    const purchaseStoreItem = (WorldNode.prototype as unknown as {
      purchaseStoreItem(
        this: typeof receiver,
        stock: StoreStock,
        quantity: number,
      ): Promise<StorePurchaseResult>;
    }).purchaseStoreItem;

    const result = await purchaseStoreItem.call(receiver, eggStock, 1);

    // Not `stock.onlyMonsters`: the continuation the server opened is the authority on which Egg
    // this checkout produced, and it is the thing `onEggPurchased` must hatch.
    expect(result.pendingEggKind).toBe("gold");
    expect(result.receivedItems).toEqual([{ kind: "monsterEgg" }]);
  });
});
