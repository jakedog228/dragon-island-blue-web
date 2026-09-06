import type {
  GemInventoryItem,
  InventoryGroup,
  InventoryItemId,
  PlayerInventory,
  PlayerInventoryItem,
} from "@dib/player-domain";
import type { DisplayMode } from "../displayMode.js";

export type InventoryPageType = 0 | 2;
export type InventoryPageSelectionAction = "selected" | "info";

export interface InventoryPageEntry {
  readonly id: InventoryItemId;
  readonly item: PlayerInventoryItem;
  readonly count: number;
  readonly equipped: boolean;
}

/** Pure source `InventoryPageProvider` state: type-owned item source, source page counts, and
 * select-once / repeat-for-info behavior. */
export class InventoryPageModel {
  private selectedIdValue: InventoryItemId | undefined;
  private pageValue = 0;

  constructor(
    private readonly inventory: PlayerInventory,
    readonly type: InventoryPageType,
    readonly mode: DisplayMode,
  ) {}

  get itemsPerPage(): number {
    return this.mode === "ipad" ? 5 : this.type === 0 ? 3 : 4;
  }

  get entries(): readonly InventoryPageEntry[] {
    if (this.type === 0) {
      return this.inventory.looseItems()
        .filter((item): item is GemInventoryItem => item.kind === "gem")
        .map((item) => Object.freeze({
          id: item.id,
          item,
          count: 1,
          equipped: false,
        }));
    }
    return this.inventory.usableGroups().map((group) =>
      entryForUsableGroup(this.inventory, group));
  }

  get equippedEntries(): readonly InventoryPageEntry[] {
    if (this.type !== 0) return [];
    return this.inventory.equippedGems().map((item) => Object.freeze({
      id: item.id,
      item,
      count: 1,
      equipped: true,
    }));
  }

  get page(): number { return this.pageValue; }
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.entries.length / this.itemsPerPage));
  }
  get selectedId(): InventoryItemId | undefined { return this.selectedIdValue; }

  pageEntries(): readonly InventoryPageEntry[] {
    const start = this.pageValue * this.itemsPerPage;
    return this.entries.slice(start, start + this.itemsPerPage);
  }

  select(id: InventoryItemId): InventoryPageSelectionAction {
    if (![...this.pageEntries(), ...this.equippedEntries].some((entry) => entry.id === id)) {
      throw new Error(`InventoryPageModel: item ${id} is not on page ${this.pageValue}`);
    }
    if (this.selectedIdValue === id) return "info";
    this.selectedIdValue = id;
    return "selected";
  }

  previous(): boolean {
    if (this.pageValue === 0) return false;
    this.pageValue -= 1;
    this.selectedIdValue = undefined;
    return true;
  }

  next(): boolean {
    if (this.pageValue + 1 >= this.pageCount) return false;
    this.pageValue += 1;
    this.selectedIdValue = undefined;
    return true;
  }

  refreshAfterMutation(): void {
    const maximum = Math.max(0, this.pageCount - 1);
    this.pageValue = Math.min(this.pageValue, maximum);
    if (![...this.entries, ...this.equippedEntries].some(({ id }) => id === this.selectedIdValue)) {
      this.selectedIdValue = undefined;
    }
  }
}

function entryForUsableGroup(
  inventory: PlayerInventory,
  group: InventoryGroup,
): InventoryPageEntry {
  const item = inventory.item(group.representativeId);
  if (item.kind !== "usable") {
    throw new Error(`InventoryPageModel: usable group ${group.instanceName} is not usable`);
  }
  return Object.freeze({
    id: item.id,
    item,
    count: group.count,
    equipped: false,
  });
}
