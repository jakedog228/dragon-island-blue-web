import type { OwnedSoulStoneEntry } from "@dib/engine";
import type { DisplayMode } from "../displayMode.js";

export type SoulStonePickerSelectionAction = "selected" | "info";


export class PartySoulStonePickerModel {
  private entriesValue: readonly OwnedSoulStoneEntry[];
  private pageValue = 0;
  private selectedTokenValue: string | undefined;

  constructor(entries: readonly OwnedSoulStoneEntry[], readonly mode: DisplayMode) {
    this.entriesValue = [...entries];
  }

  get itemsPerPage(): number { return this.mode === "ipad" ? 5 : 4; }
  get entries(): readonly OwnedSoulStoneEntry[] { return this.entriesValue; }
  get page(): number { return this.pageValue; }
  get pageCount(): number {
    return Math.max(1, Math.ceil(this.entriesValue.length / this.itemsPerPage));
  }
  /** Native's forward scan starts from the retained current page and assumes it is valid. */
  get displayedPageCount(): number { return Math.max(this.pageCount, this.pageValue + 1); }
  get selectedToken(): string | undefined { return this.selectedTokenValue; }

  pageEntries(): readonly OwnedSoulStoneEntry[] {
    const start = this.pageValue * this.itemsPerPage;
    return this.entriesValue.slice(start, start + this.itemsPerPage);
  }

  selectedEntry(): OwnedSoulStoneEntry | undefined {
    return this.entriesValue.find(({ token }) => token === this.selectedTokenValue);
  }

  select(token: string): SoulStonePickerSelectionAction {
    if (!this.pageEntries().some((entry) => entry.token === token)) {
      throw new Error(
        `PartySoulStonePickerModel: stone ${token} is not on page ${this.pageValue}`,
      );
    }
    if (this.selectedTokenValue === token) return "info";
    this.selectedTokenValue = token;
    return "selected";
  }

  previous(): boolean {
    if (this.pageValue === 0) return false;
    this.pageValue -= 1;
    while (this.pageValue > 0 && this.pageValue >= this.pageCount) this.pageValue -= 1;
    this.selectedTokenValue = undefined;
    return true;
  }

  next(): boolean {
    if (this.pageValue + 1 >= this.pageCount) return false;
    this.pageValue += 1;
    this.selectedTokenValue = undefined;
    return true;
  }

  replaceEntries(entries: readonly OwnedSoulStoneEntry[]): void {
    this.entriesValue = [...entries];
    if (!this.entriesValue.some(({ token }) => token === this.selectedTokenValue)) {
      this.selectedTokenValue = undefined;
    }
  }
}
