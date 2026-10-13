import { compareModVersions, ModPackageError, type CodeModManifestV4 } from "@dib/mod-kernel";
import type { CatalogMod, ModRelease, ModSource } from "@dib/mod-kernel/catalog";
import type { InstalledCatalogMod } from "./communityClient.js";

/** Where an installed package came from. `local` is a file the player imported themselves. */
export type LibraryOrigin = ModSource | "local";
export const LIBRARY_ORIGINS: readonly LibraryOrigin[] = ["official", "community", "local"];

export interface StoredVersion {
  readonly digest: string;
  readonly version: string;
  readonly byteLength: number;
  /** False for catalog provenance whose bytes the launch-time cache evicted. */
  readonly stored: boolean;
}
export interface LibraryEntry {
  readonly modId: string;
  readonly displayName: string;
  readonly origin: LibraryOrigin;
  readonly listingId: string | undefined;
  /** Newest first. */
  readonly versions: readonly StoredVersion[];
  /** Digest chosen in the not-yet-applied selection. */
  readonly stagedDigest: string | undefined;
  /** Digest in the selection the launcher currently holds. */
  readonly appliedDigest: string | undefined;
  /** Current public listing, when the catalog answered. */
  readonly listing: CatalogMod | undefined;
  /** Newer catalog release than every stored version. */
  readonly update: ModRelease | undefined;
}
export interface DevicePackage {
  readonly digest: string;
  readonly modId: string;
  readonly version: string;
  readonly displayName: string;
  readonly byteLength: number;
}
export interface SelectedPackage { readonly digest: string; readonly modId: string }

/**
 * One row per mod ID. Provenance comes from the install inventory; anything else on the device
 * (or held only in the launcher's selection) is a local import. Pure: no storage or network.
 */
export function buildLibrary(input: {
  device: readonly DevicePackage[];
  inventory: readonly InstalledCatalogMod[];
  staged: readonly SelectedPackage[];
  applied: readonly SelectedPackage[];
  listings: readonly CatalogMod[];
}): LibraryEntry[] {
  interface Group { displayName: string; displayVersion: string; origin: LibraryOrigin; listingId?: string; versions: Map<string, StoredVersion> }
  const groups = new Map<string, Group>();
  const touch = (modId: string, displayName: string, version: string): Group => {
    const group: Group = groups.get(modId) ?? { displayName, displayVersion: version, origin: "local", versions: new Map() };
    if (compareModVersions(version, group.displayVersion) > 0) { group.displayName = displayName; group.displayVersion = version; }
    groups.set(modId, group);
    return group;
  };
  for (const row of input.device) {
    touch(row.modId, row.displayName, row.version).versions.set(row.digest,
      { digest: row.digest, version: row.version, byteLength: row.byteLength, stored: true });
  }
  for (const row of input.inventory) {
    const group = touch(row.modId, row.displayName, row.version);
    group.origin = row.source ?? "community";
    group.listingId = row.listingId;
    if (!group.versions.has(row.digest)) group.versions.set(row.digest, { digest: row.digest, version: row.version, byteLength: 0, stored: false });
  }
  const entries: LibraryEntry[] = [];
  for (const [modId, group] of groups) {
    const versions = [...group.versions.values()].sort((a, b) => compareModVersions(b.version, a.version));
    const listing = group.listingId ? input.listings.find((mod) => mod.id === group.listingId) : undefined;
    const newestStored = versions[0]?.version;
    const latest = listing?.releases[0];
    entries.push({
      modId, displayName: listing?.title ?? group.displayName, origin: group.origin, listingId: group.listingId, versions,
      stagedDigest: input.staged.find((entry) => entry.modId === modId)?.digest,
      appliedDigest: input.applied.find((entry) => entry.modId === modId)?.digest,
      listing,
      update: latest && newestStored && compareModVersions(latest.version, newestStored) > 0 ? latest : undefined,
    });
  }
  return entries.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));
}

/** How a catalog listing relates to this device, which decides its one primary action. */
export type ListingState = "available" | "installed" | "enabled" | "update";
export function listingState(mod: CatalogMod, library: readonly LibraryEntry[]): ListingState {
  const entry = library.find((row) => row.modId === mod.modId);
  if (!entry || !entry.versions.some((version) => version.stored)) return "available";
  const latest = mod.releases[0];
  if (latest && !entry.versions.some((version) => version.stored && version.digest === latest.digest) &&
      compareModVersions(latest.version, entry.versions[0]!.version) > 0) return "update";
  return entry.stagedDigest ? "enabled" : "installed";
}

/** Number of mods whose staged choice differs from what the launcher holds. */
export function pendingChanges(staged: readonly SelectedPackage[], applied: readonly SelectedPackage[]): number {
  const ids = new Set([...staged, ...applied].map((entry) => entry.modId));
  let changes = 0;
  for (const id of ids) {
    if (staged.find((entry) => entry.modId === id)?.digest !== applied.find((entry) => entry.modId === id)?.digest) changes++;
  }
  return changes;
}

/**
 * The launcher's load-order choices. The Mod Manager stages them beside the selection and hands
 * them back on Apply; the launcher owns persistence (manual priorities live in localStorage).
 */
export interface LoadOrderChoice {
  readonly priorityOverrides: Readonly<Record<string, number>>;
  readonly allowDeclaredConflicts: boolean;
}

/**
 * Puts one mod at `index` of a resolved activation order (a drop in the Load order list). The
 * whole order is rewritten as explicit priorities so the result is total and predictable; declared
 * dependency and load-order edges still win when the kernel resolves it, so a move the relations
 * forbid visibly snaps back. Returns undefined when nothing would move or the index leaves the list.
 */
export function placeInLoadOrder(ids: readonly string[], id: string, index: number): Record<string, number> | undefined {
  const from = ids.indexOf(id);
  if (from < 0 || index < 0 || index >= ids.length || index === from || !Number.isInteger(index)) return undefined;
  const next = ids.filter((entry) => entry !== id);
  next.splice(index, 0, id);
  return Object.fromEntries(next.map((entry, at) => [entry, at * 10]));
}
/** One step earlier (-1) or later (+1); the keyboard counterpart of a drag. */
export function moveInLoadOrder(ids: readonly string[], id: string, delta: number): Record<string, number> | undefined {
  return placeInLoadOrder(ids, id, ids.indexOf(id) + delta);
}
/** Activation order implied by explicit priorities, lowest first (ties by id, as the kernel breaks them). */
export function orderOfPriorities(priorities: Readonly<Record<string, number>>): string[] {
  return Object.keys(priorities).sort((a, b) => priorities[a]! - priorities[b]! || (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * A declared relation between two selected mods: `before` always activates ahead of `after`.
 * `declaredBy` is the mod whose manifest says so, which is where the Load order list shows it.
 */
export interface OrderRule {
  readonly before: string;
  readonly after: string;
  readonly reason: "dependency" | "optional" | "loadAfter" | "loadBefore";
  readonly declaredBy: string;
}
type OrderManifest = Pick<CodeModManifestV4, "id" | "dependencies" | "optionalDependencies" | "loadAfter" | "loadBefore">;
/** Every ordering edge among the selected manifests; relations to unselected mods are inert. */
export function orderRules(manifests: readonly OrderManifest[]): OrderRule[] {
  const present = new Set(manifests.map((manifest) => manifest.id));
  const rules: OrderRule[] = [];
  const add = (before: string, after: string, reason: OrderRule["reason"], declaredBy: string): void => {
    if (before === after || !present.has(before) || !present.has(after)) return;
    if (!rules.some((rule) => rule.before === before && rule.after === after)) rules.push({ before, after, reason, declaredBy });
  };
  for (const manifest of manifests) {
    for (const id of Object.keys(manifest.dependencies)) add(id, manifest.id, "dependency", manifest.id);
    for (const id of Object.keys(manifest.optionalDependencies)) add(id, manifest.id, "optional", manifest.id);
    for (const id of manifest.loadAfter) add(id, manifest.id, "loadAfter", manifest.id);
    for (const id of manifest.loadBefore) add(manifest.id, id, "loadBefore", manifest.id);
  }
  return rules;
}
/** Rules a requested order breaks, i.e. why the resolved order did not follow it. */
export function brokenRules(rules: readonly OrderRule[], ids: readonly string[]): OrderRule[] {
  return rules.filter((rule) => ids.indexOf(rule.before) > ids.indexOf(rule.after));
}
/** "Trail needs Devtools" style sentence for a rule, using display names. */
export function describeRule(rule: OrderRule, name: (id: string) => string): string {
  switch (rule.reason) {
    case "dependency": return `${name(rule.after)} needs ${name(rule.before)}, so it loads after it`;
    case "optional": return `${name(rule.after)} works with ${name(rule.before)} and loads after it`;
    case "loadAfter": return `${name(rule.after)} asks to load after ${name(rule.before)}`;
    case "loadBefore": return `${name(rule.before)} asks to load before ${name(rule.after)}`;
  }
}

/** A `Work in progress` (or `WIP`) tag marks an unfinished mod; the manager flags it everywhere. */
export function isWorkInProgress(tags: readonly string[]): boolean {
  return tags.some((tag) => /^(wip|work[ -]in[ -]progress)$/i.test(tag.trim()));
}
/**
 * What a details page has nothing to show for. An imported file carries only its manifest, so it
 * is missing everything a store page adds; a listing is missing whatever its author left out.
 */
export function missingDetails(input: {
  readonly description: string | undefined;
  readonly screenshots: number;
  readonly tags: number;
  readonly author: boolean;
  readonly releases?: number;
}): string[] {
  const missing: string[] = [];
  if (!input.description?.trim()) missing.push("description");
  if (input.screenshots === 0) missing.push("screenshots");
  if (!input.author) missing.push("author");
  if (input.tags === 0) missing.push("tags");
  if (input.releases === 0) missing.push("downloadable release");
  return missing;
}
/** "a, b or c". */
export function listPhrase(items: readonly string[], joiner = "or"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items.at(-1)}`;
}

/**
 * A declared conflict is one author's claim about another package, not an integrity failure, so
 * the player may insist. Missing dependencies and cycles are never overridable.
 */
export function isOverridableConflict(error: unknown): boolean {
  return error instanceof ModPackageError && error.message.includes("declares a conflict with");
}

/** Mod lists render as a screenshot grid or as dense rows; a per-device convenience only. */
export type LibraryView = "grid" | "list";
export const LIBRARY_VIEW_KEY = "dib.mods.view.v1";
export function readLibraryView(storage: Pick<Storage, "getItem"> | undefined): LibraryView {
  try { return storage?.getItem(LIBRARY_VIEW_KEY) === "list" ? "list" : "grid"; } catch { return "grid"; }
}
export function writeLibraryView(storage: Pick<Storage, "setItem"> | undefined, view: LibraryView): void {
  try { storage?.setItem(LIBRARY_VIEW_KEY, view); } catch { /* storage disabled: the choice lasts this visit */ }
}

/** Stable, readable byte size. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
/** "3 days ago" style relative time; absolute date past a month. */
export function formatRelative(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 90) return "just now";
  const minutes = seconds / 60, hours = minutes / 60, days = hours / 24;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  if (days < 30) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
