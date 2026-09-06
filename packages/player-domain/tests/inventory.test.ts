import { describe, expect, it } from "vitest";
import {
  PlayerInventory,
  gemBonusForStat,
  migrateLegacyInventory,
} from "../src/inventory.js";

describe("PlayerInventory", () => {
  it("migrates counters into independent source objects with deterministic ids", () => {
    const state = migrateLegacyInventory(
      { 1: 2, 2: 1, 3: 0 },
      {
        Egg: 2,
        "GemLevel:63:Quality:1:Slot:2:Stats:Defense,Magic": 2,
        MonsterEgg: 1,
      },
    );
    expect(state.looseItems).toHaveLength(8);
    expect(state.looseItems.map(({ id }) => id)).toEqual(
      Array.from({ length: 8 }, (_, index) => `item-${index + 1}`),
    );
    expect(state.nextItemSequence).toBe(9);
    expect(state.looseItems.filter(({ instanceName }) => instanceName === "Card")).toHaveLength(2);
  });

  it("groups usable duplicates transiently while saving independent objects", () => {
    const inventory = new PlayerInventory();
    const first = inventory.addUsable("Usables.Card", "Card");
    inventory.addUsable("Usables.Card", "Card");
    inventory.addUsable("Usables.Feather", "Feather");
    expect(inventory.usableGroups()).toEqual([
      { instanceName: "Card", representativeId: first.id, count: 2 },
      { instanceName: "Feather", representativeId: "item-3", count: 1 },
    ]);
    expect(inventory.stateSnapshot().looseItems).toHaveLength(3);
    expect(JSON.stringify(inventory.stateSnapshot())).not.toContain("stackCount");
  });

  it("consumes the exact usable only when the caller completes its ability", () => {
    const inventory = new PlayerInventory();
    const selected = inventory.addUsable("Usables.Bomb", "Bomb");
    const other = inventory.addUsable("Usables.Bomb", "Bomb");
    expect(inventory.looseItems()).toHaveLength(2);
    expect(inventory.consumeUsableAfterAbility(selected.id).id).toBe(selected.id);
    expect(inventory.looseItems().map(({ id }) => id)).toEqual([other.id]);
    expect(() => inventory.consumeUsableAfterAbility(selected.id)).toThrow(/not found/);
  });

  it("equips, losslessly swaps, and safely unequips exact Gem objects", () => {
    const inventory = new PlayerInventory();
    const first = inventory.addGem({
      definitionPath: "Gems.RandomNovice",
      level: 7,
      quality: 0,
      slot: 0,
      enabledStats: ["Attack"],
    });
    const second = inventory.addGem({
      definitionPath: "Gems.RandomNovice",
      level: 10,
      quality: 1,
      slot: 0,
      enabledStats: ["Defense", "Magic"],
    });
    inventory.equipGem(first.id, () => true);
    expect(inventory.isLoose(first.id)).toBe(false);
    expect(inventory.equipGem(second.id, () => true).displaced?.id).toBe(first.id);
    expect(inventory.isLoose(first.id)).toBe(true);
    expect(inventory.unequipGem(second.id).id).toBe(second.id);
    expect(inventory.isLoose(second.id)).toBe(true);
  });

  it("preserves the equipped-Gem Drop no-op and license slot rejection", () => {
    const inventory = new PlayerInventory();
    const gem = inventory.addGem({
      definitionPath: "Gems.RandomVeteran",
      level: 15,
      quality: 0,
      slot: 1,
      enabledStats: ["Speed"],
    });
    expect(() => inventory.equipGem(gem.id, (slot) => slot === 0)).toThrow(/does not allow/);
    inventory.equipGem(gem.id, () => true);
    expect(inventory.drop(gem.id)).toBe(false);
    expect(inventory.gemInSlot(1)?.id).toBe(gem.id);
  });

  it("uses source Gem flat-stat weights", () => {
    const gem = {
      level: 11,
      enabledStats: ["MaxHP", "Defense"] as const,
    };
    expect(gemBonusForStat(gem, "MaxHP")).toBe(11);
    expect(gemBonusForStat(gem, "Defense")).toBe(16.5);
    expect(gemBonusForStat(gem, "Magic")).toBe(0);
  });

  it("fails loudly on unknown legacy tokens", () => {
    expect(() => migrateLegacyInventory(
      { 1: 0, 2: 0, 3: 0 },
      { UnknownFutureItem: 1 },
    )).toThrow(/unsupported legacy item key/);
  });
});
