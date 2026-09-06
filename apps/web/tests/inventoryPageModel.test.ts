import { describe, expect, it } from "vitest";
import { PlayerInventory } from "@dib/player-domain";
import { InventoryPageModel } from "../src/player/inventoryPageModel.js";

describe("InventoryPageModel", () => {
  it("uses source type/mode page sizes and groups type-2 duplicates transiently", () => {
    const inventory = new PlayerInventory();
    for (let index = 0; index < 5; index += 1) {
      inventory.addUsable(`Usables.Item${index}`, `Item${index}`);
    }
    inventory.addUsable("Usables.Item0", "Item0");
    const phone = new InventoryPageModel(inventory, 2, "iphone");
    const pad = new InventoryPageModel(inventory, 2, "ipad");
    expect(phone.itemsPerPage).toBe(4);
    expect(phone.pageCount).toBe(2);
    expect(phone.entries[0]).toMatchObject({ count: 2 });
    expect(pad.itemsPerPage).toBe(5);
    expect(pad.pageCount).toBe(1);
  });

  it("lists loose and equipped Gems and clears selection on paging", () => {
    const inventory = new PlayerInventory();
    const gems = Array.from({ length: 5 }, (_, slot) => inventory.addGem({
      definitionPath: `Gems.Gem${slot}`,
      level: slot + 1,
      quality: 0,
      slot: (slot % 4) as 0 | 1 | 2 | 3,
      enabledStats: ["Attack"],
    }));
    inventory.equipGem(gems[0]!.id, () => true);
    const model = new InventoryPageModel(inventory, 0, "iphone");
    expect(model.itemsPerPage).toBe(3);
    expect(model.entries.find(({ id }) => id === gems[0]!.id)).toBeUndefined();
    expect(model.equippedEntries.find(({ id }) => id === gems[0]!.id)?.equipped).toBe(true);
    expect(model.select(gems[1]!.id)).toBe("selected");
    expect(model.select(gems[1]!.id)).toBe("info");
    expect(model.next()).toBe(true);
    expect(model.selectedId).toBeUndefined();
  });
});
