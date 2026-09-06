import type { DungeonLoot } from "@dib/engine/dungeon";

export const DUNGEON_LOOT_COLUMNS = 1;
export const DUNGEON_LOOT_ITEMS_PER_PAGE = 4;

/** `PagedNodeDisplay` selection action: FadeTo opacity 100 over 1s, then FadeTo 0 over 1s,
 * repeated forever. Pixi alpha is normalized from the source byte opacity. */
export function dungeonLootSelectionOpacity(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) throw new Error("Dungeon loot selection time must be finite");
  const cycle = ((elapsedMs % 2_000) + 2_000) % 2_000;
  const phase = cycle <= 1_000 ? cycle / 1_000 : (2_000 - cycle) / 1_000;
  return phase * (100 / 255);
}

/** `GlowingGemNode` quality-1 pulse: 255â†’150 in 1s, then 150â†’255 in 1s. */
export function dungeonGemGlowAlpha(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) throw new Error("Dungeon Gem glow time must be finite");
  const cycle = ((elapsedMs % 2_000) + 2_000) % 2_000;
  const opacity = cycle <= 1_000
    ? 255 - 105 * (cycle / 1_000)
    : 150 + 105 * ((cycle - 1_000) / 1_000);
  return opacity / 255;
}

export class DungeonLootPageModel<T extends object = DungeonLoot> {
  readonly items: readonly T[];
  private selectedIndexValue: number | undefined;
  private pageValue = 0;
  private closed = false;

  constructor(items: readonly T[]) {
    this.items = Object.freeze(items.map((item) => Object.freeze({ ...item })));
  }

  get page(): number { return this.pageValue; }
  get pageCount(): number { return Math.max(1, Math.ceil(this.items.length / DUNGEON_LOOT_ITEMS_PER_PAGE)); }
  get selectedIndex(): number | undefined { return this.selectedIndexValue; }
  get canPrevious(): boolean { return this.pageValue > 0; }
  get canNext(): boolean { return this.pageValue + 1 < this.pageCount; }

  pageItems(): readonly Readonly<{ index: number; item: T }>[] {
    const start = this.pageValue * DUNGEON_LOOT_ITEMS_PER_PAGE;
    return Object.freeze(this.items.slice(start, start + DUNGEON_LOOT_ITEMS_PER_PAGE)
      .map((item, offset) => Object.freeze({ index: start + offset, item })));
  }

  select(index: number): "selected" | "info" {
    if (!Number.isInteger(index) || index < 0 || index >= this.items.length) {
      throw new Error(`Dungeon loot selection ${index} is out of range`);
    }
    if (this.selectedIndexValue === index) return "info";
    this.selectedIndexValue = index;
    return "selected";
  }

  previous(): void {
    if (!this.canPrevious) throw new Error("Dungeon loot provider has no previous page");
    this.pageValue--;
    this.selectedIndexValue = undefined;
  }

  next(): void {
    if (!this.canNext) throw new Error("Dungeon loot provider has no next page");
    this.pageValue++;
    this.selectedIndexValue = undefined;
  }

  closeTakeAll(): readonly T[] {
    if (this.closed) return Object.freeze([]);
    this.closed = true;
    return this.items;
  }
}
