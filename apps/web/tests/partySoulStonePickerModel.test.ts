import { describe, expect, it } from "vitest";
import type { OwnedSoulStoneEntry } from "@dib/engine";
import { PartySoulStonePickerModel } from "../src/world/partySoulStonePickerModel.js";

function entries(count: number): OwnedSoulStoneEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    token: `stone-${index + 1}`,
    stone: { element: "Fire", level: index + 1, sourceType: "FireCub" },
  }));
}

describe("Insert Soul Stone source paging model", () => {
  it("uses four iPhone rows and five iPad rows", () => {
    const phone = new PartySoulStonePickerModel(entries(11), "iphone");
    const pad = new PartySoulStonePickerModel(entries(11), "ipad");

    expect(phone.itemsPerPage).toBe(4);
    expect(phone.pageCount).toBe(3);
    expect(phone.pageEntries().map(({ token }) => token)).toEqual([
      "stone-1", "stone-2", "stone-3", "stone-4",
    ]);
    expect(pad.itemsPerPage).toBe(5);
    expect(pad.pageCount).toBe(3);
    expect(pad.pageEntries().map(({ token }) => token)).toEqual([
      "stone-1", "stone-2", "stone-3", "stone-4", "stone-5",
    ]);
  });

  it("clears selection on page turns and treats a repeat selection as an info request", () => {
    const model = new PartySoulStonePickerModel(entries(6), "iphone");
    expect(model.select("stone-2")).toBe("selected");
    expect(model.select("stone-2")).toBe("info");
    expect(model.selectedEntry()?.token).toBe("stone-2");

    expect(model.next()).toBe(true);
    expect(model.page).toBe(1);
    expect(model.selectedToken).toBeUndefined();
    expect(model.pageEntries().map(({ token }) => token)).toEqual(["stone-5", "stone-6"]);
    expect(model.next()).toBe(false);
    expect(model.previous()).toBe(true);
  });

  it("keeps the source's empty last-page edge after Drop and removes the dropped selection", () => {
    const original = entries(9);
    const model = new PartySoulStonePickerModel(original, "iphone");
    model.next();
    model.next();
    model.select("stone-9");

    model.replaceEntries(original.slice(0, 4));
    // `InventoryPageProvider confirmDrop:` rebuilds directly without `validatePage`; native stays
    // on its now-empty page until Previous is pressed.
    expect(model.page).toBe(2);
    expect(model.pageCount).toBe(1);
    expect(model.displayedPageCount).toBe(3);
    expect(model.pageEntries()).toEqual([]);
    expect(model.selectedToken).toBeUndefined();
    expect(model.previous()).toBe(true);
    expect(model.page).toBe(0);
  });
});
