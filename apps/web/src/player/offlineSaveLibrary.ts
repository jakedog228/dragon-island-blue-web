import { SAVE_SLOT_IDS, type SaveSlotId } from "@dib/save-protocol";
import { describePlayProfileLabel, readPlayProfiles, type PlayProfileModRef } from "../content/playProfiles.js";
import { BrowserSaveConnection, type ReleaseDisposableBrowserStorage } from "./browserSaveClient.js";
import type { PlayerGameStateSnapshot } from "./gameState.js";
import type { SaveSession, SaveSlotStore } from "./saveStore.js";

export const OFFLINE_LIBRARY_KEY = "dib.offlineSaves.v1";
export interface OfflineLibraryStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export interface OfflineSaveEntry {
  readonly id: string;
  readonly namespace: string;
  readonly sourceSlot: SaveSlotId;
  readonly name: string;
  readonly lastMods: readonly PlayProfileModRef[] | null;
  readonly lastContent: string | null;
}
interface LibraryIndex {
  readonly schemaVersion: 1;
  page: number;
  entries: OfflineSaveEntry[];
}

/** A persisted ordering of stable save addresses. Migration never copies, deletes or rewrites
 * a legacy save (including its rollback). Paging only changes the three aliases given to Pixi. */
export class OfflineSaveLibrary implements SaveSlotStore {
  private index: LibraryIndex;
  constructor(
    private readonly storage: OfflineLibraryStorage,
    private readonly contentNamespace: string,
    private readonly mods: readonly PlayProfileModRef[],
    private readonly releaseDisposableStorage?: ReleaseDisposableBrowserStorage,
  ) {
    this.index = this.read();
    const known = new Set(this.index.entries.map(entry => entry.id));
    const profiles = new Map(readPlayProfiles(storage).map(record => [record.namespace, record]));
    // Collect before writing: localStorage enumeration order may change after a mutation.
    const addresses: { key: string; namespace: string; sourceSlot: SaveSlotId }[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      const match = key?.match(/^dib-save-v1:(.+):(slot-[123])$/);
      if (key && match && !known.has(key)) {
        addresses.push({ key, namespace: match[1]!, sourceSlot: match[2]! as SaveSlotId });
      }
    }
    addresses.sort((a, b) => a.key.localeCompare(b.key));
    for (const namespace of new Set(addresses.map(address => address.namespace))) {
      const profile = profiles.get(namespace);
      // Preserve the old slot numbers, including gaps, when first discovering a namespace.
      for (const sourceSlot of SAVE_SLOT_IDS) {
        const id = `dib-save-v1:${namespace}:${sourceSlot}`;
        if (known.has(id)) continue;
        this.index.entries.push({
          id, namespace, sourceSlot,
          name: profile === undefined ? `Save ${this.index.entries.length + 1}`
            : offlineSaveName(`${describePlayProfileLabel(profile, namespace)} - ${sourceSlot.replace("slot-", "Slot ")}`),
          lastMods: profile?.mods ?? null, lastContent: namespace,
        });
        known.add(id);
      }
    }
    while (this.index.entries.length === 0 || this.index.entries.length % 3 !== 0) {
      this.index.entries.push(this.emptyEntry());
    }
    this.persist();
  }

  get page(): number { return this.index.page; }
  get pageCount(): number { return this.index.entries.length / 3; }
  get entries(): readonly OfflineSaveEntry[] { return this.index.entries; }
  get selectedMods(): readonly PlayProfileModRef[] { return this.mods; }
  get selectedContentNamespace(): string { return this.contentNamespace; }
  entry(slot: SaveSlotId): OfflineSaveEntry {
    return this.index.entries[this.page * 3 + SAVE_SLOT_IDS.indexOf(slot)]!;
  }
  get slots() {
    return SAVE_SLOT_IDS.flatMap(slot => {
      const summary = this.summary(slot);
      return summary === undefined ? [] : [summary];
    });
  }
  summary(slot: SaveSlotId) {
    const entry = this.entry(slot);
    // An unreadable migrated save remains visible, and does not hide healthy siblings.
    try {
      const summary = this.connection(entry).summary(entry.sourceSlot);
      return summary === undefined ? undefined : { ...summary, slotId: slot };
    } catch {
      return { slotId: slot, revision: 1, updatedAt: "Unreadable save", compatible: false };
    }
  }
  async loadSlotState(slot: SaveSlotId) {
    const entry = this.entry(slot);
    return this.connection(entry).loadSlotState(entry.sourceSlot);
  }
  previousRevision(slot: SaveSlotId) {
    const entry = this.entry(slot);
    try { return this.connection(entry).previousRevision(entry.sourceSlot); }
    catch { return undefined; }
  }
  async restorePreviousRevision(slot: SaveSlotId): Promise<void> {
    const entry = this.entry(slot);
    await this.connection(entry).restorePreviousRevision(entry.sourceSlot);
    // The rollback may predate the last mod selection; never claim to know its provenance.
    this.edit(entry.id, { lastMods: null, lastContent: null });
  }
  async deleteSlot(slot: SaveSlotId): Promise<void> {
    const entry = this.entry(slot);
    await this.connection(entry).deleteSlot(entry.sourceSlot);
    this.edit(entry.id, { lastMods: null, lastContent: null });
  }
  open(slot: SaveSlotId, preloadedState?: PlayerGameStateSnapshot): SaveSession {
    // Capture the stable address now: reordering in another tab cannot redirect an autosave.
    const entry = this.entry(slot);
    const session = this.connection(entry).open(entry.sourceSlot, preloadedState);
    const remember = () => this.edit(entry.id, {
      lastMods: this.mods, lastContent: this.contentNamespace,
    });
    if (preloadedState !== undefined) remember();
    let latest: Promise<void> = Promise.resolve();
    return {
      slotId: slot,
      load: async () => {
        const state = await session.load();
        if (state !== undefined) remember();
        return state;
      },
      save: state => {
        latest = session.save(state).then(remember);
        return latest;
      },
      flush: async () => { await latest; await session.flush(); },
      adoptStoredRevision: () => session.adoptStoredRevision(),
    };
  }
  /** Imports are not play sessions. Native files have no mod-history metadata. */
  async importSave(slot: SaveSlotId, state: PlayerGameStateSnapshot, fileName: string): Promise<void> {
    const entry = this.entry(slot);
    const name = offlineSaveName(fileName);
    await this.connection(entry).open(entry.sourceSlot).save(state);
    this.edit(entry.id, { name, lastMods: null, lastContent: null });
  }
  rename(slot: SaveSlotId, name: string): void {
    this.edit(this.entry(slot).id, { name: offlineSaveName(name) });
  }
  move(slot: SaveSlotId, destination: number): void {
    const id = this.entry(slot).id;
    this.index = this.read();
    if (!Number.isInteger(destination) || destination < 0 || destination >= this.index.entries.length) {
      throw new Error("Choose an existing save position.");
    }
    const source = this.index.entries.findIndex(entry => entry.id === id);
    if (source < 0) throw new Error("The Offline save entry is missing.");
    const [entry] = this.index.entries.splice(source, 1);
    this.index.entries.splice(destination, 0, entry!);
    this.index.page = Math.floor(destination / 3);
    this.persist();
  }
  selectPage(page: number): void {
    this.index = this.read();
    if (!Number.isInteger(page) || page < 0 || page >= this.pageCount) throw new Error("Invalid save page.");
    this.index.page = page;
    this.persist();
  }
  addPage(): void {
    this.index = this.read();
    this.index.page = this.pageCount;
    for (let i = 0; i < 3; i++) this.index.entries.push(this.emptyEntry());
    this.persist();
  }
  warning(slot: SaveSlotId): string | undefined {
    const entry = this.entry(slot);
    if (this.storage.getItem(entry.id) === null) return undefined;
    if (entry.lastMods === null) return "Previous mods unknown. Check compatibility before playing.";
    const same = entry.lastMods.length === this.mods.length &&
      entry.lastMods.every((mod, i) => mod.digest === this.mods[i]?.digest);
    if (!same) return `Different mods selected. Last played with: ${entry.lastMods.length === 0
      ? "no mods" : entry.lastMods.map(mod => `${mod.displayName} ${mod.version}`).join(", ")}.`;
    if (entry.lastContent !== this.contentNamespace) return "Different game content selected. Check compatibility before playing.";
    return undefined;
  }
  private connection(entry: OfflineSaveEntry): BrowserSaveConnection {
    return BrowserSaveConnection.forStoredSlot(entry.namespace, entry.sourceSlot, this.storage,
      this.releaseDisposableStorage);
  }
  private emptyEntry(): OfflineSaveEntry {
    const namespace = `offline-library:${globalThis.crypto.randomUUID()}`;
    return { id: `dib-save-v1:${namespace}:slot-1`, namespace, sourceSlot: "slot-1",
      name: `Save ${this.index.entries.length + 1}`, lastMods: null, lastContent: null };
  }
  private edit(id: string, fields: Partial<Pick<OfflineSaveEntry, "name" | "lastMods" | "lastContent">>): void {
    // Read/merge synchronous mutations so other tabs' names, ordering and selection survive.
    const current = this.read();
    const position = current.entries.findIndex(entry => entry.id === id);
    if (position < 0) throw new Error("The Offline save entry is missing.");
    if (!Object.entries(fields).every(([key, value]) =>
      JSON.stringify(current.entries[position]![key as keyof OfflineSaveEntry]) === JSON.stringify(value))) {
      current.entries[position] = { ...current.entries[position]!, ...fields };
      this.storage.setItem(OFFLINE_LIBRARY_KEY, JSON.stringify(current));
    }
    // Preserve this session's page/address mapping even if another tab has reordered the library.
    this.index.entries = this.index.entries.map(entry => entry.id === id ? { ...entry, ...fields } : entry);
  }
  private persist(): void {
    const next = JSON.stringify(this.index);
    if (this.storage.getItem(OFFLINE_LIBRARY_KEY) === next) return;
    try { this.storage.setItem(OFFLINE_LIBRARY_KEY, next); }
    catch (error) { this.index = this.read(); throw error; }
  }
  private read(): LibraryIndex {
    const raw = this.storage.getItem(OFFLINE_LIBRARY_KEY);
    if (raw === null) return { schemaVersion: 1, page: 0, entries: [] };
    const parsed = JSON.parse(raw) as LibraryIndex;
    if (parsed?.schemaVersion !== 1 || !Array.isArray(parsed.entries) ||
        !Number.isInteger(parsed.page) || parsed.page < 0 ||
        parsed.entries.length % 3 !== 0 || parsed.page >= parsed.entries.length / 3 ||
        new Set(parsed.entries.map(entry => entry?.id)).size !== parsed.entries.length ||
        !parsed.entries.every(validEntry)) {
      throw new Error("Offline save list is invalid; existing saves have been preserved.");
    }
    return parsed;
  }
}

/** Names are shell/file labels only, never player-state fields. Also safe as a download name. */
export function offlineSaveName(value: string): string {
  const name = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim().replace(/[. ]+$/g, "").slice(0, 80);
  if (!name) throw new Error("Enter a save name.");
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
}
function validEntry(entry: OfflineSaveEntry): boolean {
  return entry !== null && typeof entry === "object" && typeof entry.namespace === "string" &&
    entry.namespace.length > 0 && SAVE_SLOT_IDS.includes(entry.sourceSlot) &&
    entry.id === `dib-save-v1:${entry.namespace}:${entry.sourceSlot}` &&
    typeof entry.name === "string" && entry.name.length > 0 &&
    (entry.lastContent === null || typeof entry.lastContent === "string") &&
    (entry.lastMods === null || (Array.isArray(entry.lastMods) && entry.lastMods.every(mod =>
      mod && typeof mod.digest === "string" && typeof mod.id === "string" &&
      typeof mod.version === "string" && typeof mod.displayName === "string")));
}
