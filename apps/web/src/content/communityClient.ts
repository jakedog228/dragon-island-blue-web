import type { CatalogMod, CatalogPage, CatalogQuery, CatalogTag, CommunityInfo, ModSource } from "@dib/mod-kernel/catalog";
import { importCodeModArchive, matchesRange, resolveCodeModProfile, type CodeModPackage } from "@dib/mod-kernel";
import { type CachedModArchive, type ModArchiveCacheBackend, listCachedModArchives } from "./modArchiveCache.js";

export const COMMUNITY_API = "/api/community";
export class CommunityRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function communityJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${COMMUNITY_API}${path}`, { ...init, credentials: "omit" });
  let body: T & { message?: string };
  try { body = await response.json() as T & { message?: string }; }
  catch { throw new CommunityRequestError(response.status, "The mod service is unavailable. Installed mods still work Offline."); }
  if (!response.ok) throw new CommunityRequestError(response.status, body.message ?? `Request failed (${response.status}).`);
  return body;
}
export const communityInfo = (): Promise<CommunityInfo> => communityJson("/info");
export function catalogPage(query: CatalogQuery = {}): Promise<CatalogPage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
  return communityJson(`/mods?${params}`);
}
export const catalogTags = async (source?: ModSource): Promise<CatalogTag[]> =>
  (await communityJson<{ tags: CatalogTag[] }>(`/tags${source ? `?source=${source}` : ""}`)).tags;
/** Current public listings for installed provenance; withdrawn listings are simply absent. */
export async function catalogLookup(ids: readonly string[]): Promise<CatalogMod[]> {
  const unique = [...new Set(ids)];
  const found: CatalogMod[] = [];
  for (let at = 0; at < unique.length; at += 50) {
    found.push(...(await communityJson<{ mods: CatalogMod[] }>(`/mods/lookup?ids=${unique.slice(at, at + 50).join(",")}`)).mods);
  }
  return found;
}
export const catalogImageUrl = (mod: Pick<CatalogMod, "id">, digest: string): string =>
  `${COMMUNITY_API}/mods/${encodeURIComponent(mod.id)}/image/${digest}`;
/** `source` is absent on inventories written before official listings existed (all community). */
export interface InstalledCatalogMod { listingId: string; digest: string; modId: string; version: string; displayName: string; source?: ModSource }
const INVENTORY_KEY = "dib.community.installed.v1";
export function installedCatalogMods(): InstalledCatalogMod[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(INVENTORY_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((row): row is InstalledCatalogMod =>
      row && typeof row === "object" && ["listingId", "digest", "modId", "version", "displayName"].every((key) => typeof row[key] === "string") &&
      (row.source === undefined || row.source === "official" || row.source === "community")) : [];
  } catch { return []; }
}
export function forgetInstalledDigest(digest: string): void {
  localStorage.setItem(INVENTORY_KEY, JSON.stringify(installedCatalogMods().filter((entry) => entry.digest !== digest)));
}
export interface InstallPlanEntry { mod: CatalogMod; digest: string }
/** Resolve a bounded required-dependency tree. Kernel resolves cycles/conflicts after byte validation. */
export async function planCatalogInstall(mod: CatalogMod, digest: string): Promise<InstallPlanEntry[]> {
  const entries = new Map<string, InstallPlanEntry>();
  const add = async (candidate: CatalogMod, selected: string): Promise<void> => {
    if (entries.size >= 24) throw new Error("This dependency plan exceeds 24 mods.");
    const release = candidate.releases.find((entry) => entry.digest === selected);
    if (!release) throw new Error("This release is no longer available.");
    entries.set(candidate.modId, { mod: candidate, digest: selected });
    for (const [id, range] of Object.entries(release.dependencies)) {
      const existing = entries.get(id);
      if (existing) {
        const chosen = existing.mod.releases.find((entry) => entry.digest === existing.digest)!;
        if (!matchesRange(chosen.version, range)) throw new Error(`Dependencies require incompatible versions of ${id}.`);
        continue;
      }
      const dependency = await communityJson<CatalogMod>(`/mods/by-id/${encodeURIComponent(id)}`);
      const compatible = dependency?.releases.find((entry) => matchesRange(entry.version, range));
      if (!dependency || !compatible) throw new Error(`Required mod ${id} (${range}) is not published. Import it locally if you have a copy.`);
      await add(dependency, compatible.digest);
    }
  };
  await add(mod, digest);
  return [...entries.values()];
}
export async function installCatalogPlan(plan: readonly InstallPlanEntry[], cache: ModArchiveCacheBackend): Promise<void> {
  if (!cache.supported) throw new Error("This browser cannot store mods. Enable browser storage or import local files.");
  const packages: CodeModPackage[] = [];
  const downloaded: { entry: InstallPlanEntry; bytes: Blob; pkg: CodeModPackage }[] = [];
  let total = 0;
  for (const entry of plan) {
    const release = entry.mod.releases.find((candidate) => candidate.digest === entry.digest)!;
    total += release.byteLength;
    if (total > 64 * 1024 * 1024) throw new Error("This install exceeds the 64 MiB device mod budget.");
    const response = await fetch(`${COMMUNITY_API}/mods/${encodeURIComponent(entry.mod.id)}/download/${entry.digest}`, { credentials: "omit" });
    if (!response.ok) throw new Error(`Download failed (${response.status}).`);
    const bytes = await response.blob();
    if (bytes.size !== release.byteLength) throw new Error("Download size did not match its release.");
    const pkg = await importCodeModArchive(new Uint8Array(await bytes.arrayBuffer()), `${entry.mod.modId}.dibmod`);
    if (pkg.digest !== entry.digest || pkg.manifest.id !== entry.mod.modId || pkg.manifest.version !== release.version) throw new Error("Downloaded package did not match its release.");
    packages.push(pkg); downloaded.push({ entry, bytes, pkg });
  }
  await resolveCodeModProfile(packages);
  const before = await listCachedModArchives(cache);
  const addedSize = downloaded.filter(({ pkg }) => !before.some((entry) => entry.digest === pkg.digest)).reduce((sum, entry) => sum + entry.bytes.size, 0);
  if (before.reduce((sum, entry) => sum + entry.byteLength, 0) + addedSize > 64 * 1024 * 1024) {
    throw new Error("The device mod library would exceed 64 MiB. Remove unused versions first.");
  }
  const newDigests: string[] = [];
  try {
    const inventory = installedCatalogMods();
    for (const { entry, bytes, pkg } of downloaded) {
      const now = new Date().toISOString();
      if (!before.some((row) => row.digest === pkg.digest)) {
        await cache.store({ schemaVersion: 1, digest: pkg.digest, archiveName: `${pkg.manifest.id}.dibmod`,
          modId: pkg.manifest.id, version: pkg.manifest.version, displayName: pkg.manifest.displayName,
          byteLength: bytes.size, cachedAt: now, lastUsedAt: now, bytes });
        newDigests.push(pkg.digest);
      }
      if (!inventory.some((row) => row.digest === pkg.digest)) inventory.push({ listingId: entry.mod.id, source: entry.mod.source,
        digest: pkg.digest, modId: pkg.manifest.id, version: pkg.manifest.version, displayName: pkg.manifest.displayName });
    }
    localStorage.setItem(INVENTORY_KEY, JSON.stringify(inventory));
  } catch (error) {
    await Promise.allSettled(newDigests.map((digest) => cache.delete(digest)));
    throw error;
  }
}

/** Player choices that change how a selection resolves, beyond which files it holds. */
export interface SelectionResolveOptions {
  /** The player chose to load mods whose authors declared each other incompatible. */
  readonly allowDeclaredConflicts?: boolean;
}

/** Build one valid selection including cached required dependencies; never activates any code. */
export async function enableInstalledMod(files: readonly File[], cached: readonly CachedModArchive[], digest: string, options: SelectionResolveOptions = {}): Promise<File[]> {
  const selected = new Map<string, { file: File; pkg: CodeModPackage }>();
  for (const file of files) {
    const pkg = await importCodeModArchive(new Uint8Array(await file.arrayBuffer()), file.name);
    selected.set(pkg.manifest.id, { file, pkg });
  }
  const target = cached.find((row) => row.digest === digest);
  if (!target) throw new Error("Download this version again before enabling it.");
  const visited = new Set<string>();
  const add = async (row: CachedModArchive): Promise<void> => {
    if (visited.has(row.digest)) return;
    visited.add(row.digest);
    const file = new File([row.bytes], row.archiveName);
    const pkg = await importCodeModArchive(new Uint8Array(await file.arrayBuffer()), file.name);
    if (pkg.digest !== row.digest) throw new Error("Stored mod bytes failed their digest check. Download again.");
    selected.set(pkg.manifest.id, { file, pkg });
    for (const [id, range] of Object.entries(pkg.manifest.dependencies)) {
      const active = selected.get(id);
      if (active && matchesRange(active.pkg.manifest.version, range)) continue;
      const dependency = cached.find((entry) => entry.modId === id && matchesRange(entry.version, range));
      if (!dependency) throw new Error(`Install ${id} (${range}) before enabling this mod.`);
      await add(dependency);
    }
  };
  await add(target);
  await resolveCodeModProfile([...selected.values()].map((entry) => entry.pkg), options);
  return [...selected.values()].map((entry) => entry.file);
}

const PENDING_SELECTION = "dib.mods.pending-selection.v1";
export class PendingModSelectionError extends Error {}
type SelectionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export interface PendingModSelection { readonly digests: string[]; readonly allowDeclaredConflicts: boolean }
/**
 * Persist only validated package digests across the clean reload required by full-trust execution.
 * Load order needs nothing here: the launcher's manual priorities already live in localStorage.
 */
export async function stageModSelectionForReload(files: readonly File[], cache: ModArchiveCacheBackend, storage: SelectionStorage, options: SelectionResolveOptions = {}): Promise<void> {
  if (files.length && !cache.supported) throw new Error("Browser storage is unavailable. Clear mods and reload, then import your desired files again.");
  if (files.length > 24 || files.reduce((sum, file) => sum + file.size, 0) > 64 * 1024 * 1024) throw new Error("The reload selection exceeds the 24-mod / 64 MiB device budget.");
  const packages = await Promise.all(files.map(async (file) => importCodeModArchive(new Uint8Array(await file.arrayBuffer()), file.name)));
  if (packages.length > 0) await resolveCodeModProfile(packages, options);
  const now = new Date().toISOString();
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!, pkg = packages[index]!;
    await cache.store({ schemaVersion: 1, digest: pkg.digest, archiveName: file.name, modId: pkg.manifest.id,
      version: pkg.manifest.version, displayName: pkg.manifest.displayName, byteLength: file.size,
      cachedAt: now, lastUsedAt: now, bytes: file });
  }
  // Set last: a failed cache write must not instruct the next page to apply a partial selection.
  // A plain digest array is the common case; the object form only records an explicit override.
  const digests = packages.map((pkg) => pkg.digest);
  storage.setItem(PENDING_SELECTION, JSON.stringify(options.allowDeclaredConflicts ? { digests, allowDeclaredConflicts: true } : digests));
}
export function takePendingModSelection(storage: SelectionStorage): PendingModSelection | undefined {
  const raw = storage.getItem(PENDING_SELECTION);
  if (raw === null) return undefined;
  storage.removeItem(PENDING_SELECTION);
  const invalid = (): never => { throw new PendingModSelectionError("Pending mod selection is invalid."); };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { invalid(); }
  const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  if (record && (Object.keys(record).some((key) => key !== "digests" && key !== "allowDeclaredConflicts") || record["allowDeclaredConflicts"] !== true)) invalid();
  const digests = record ? record["digests"] : parsed;
  if (!Array.isArray(digests) || digests.length > 24 || digests.some((digest) => typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest))) invalid();
  return { digests: digests as string[], allowDeclaredConflicts: record !== undefined };
}
export async function restorePendingModSelection(digests: readonly string[], cache: readonly CachedModArchive[]): Promise<File[]> {
  const files: File[] = [];
  for (const digest of digests) {
    const row = cache.find((entry) => entry.digest === digest);
    if (!row) throw new Error("A selected mod is no longer stored on this device. Download it again.");
    const file = new File([row.bytes], row.archiveName);
    const pkg = await importCodeModArchive(new Uint8Array(await file.arrayBuffer()), file.name);
    if (pkg.digest !== digest) throw new Error("Stored mod bytes failed their digest check.");
    files.push(file);
  }
  return files;
}

/**
 * Drops one mod from a selection and, transitively, every selected mod that requires it, so a
 * single toggle can never leave an unresolvable selection. Returns the display names cascaded.
 */
export async function disableSelectedMod(files: readonly File[], modId: string, options: SelectionResolveOptions = {}): Promise<{ files: File[]; cascaded: string[] }> {
  const selected = await Promise.all(files.map(async (file) => ({ file, pkg: await importCodeModArchive(new Uint8Array(await file.arrayBuffer()), file.name) })));
  const removed = new Set([modId]);
  const cascaded: string[] = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const { pkg } of selected) {
      if (removed.has(pkg.manifest.id)) continue;
      if (Object.keys(pkg.manifest.dependencies).some((id) => removed.has(id))) {
        removed.add(pkg.manifest.id); cascaded.push(pkg.manifest.displayName); changed = true;
      }
    }
  }
  const remaining = selected.filter(({ pkg }) => !removed.has(pkg.manifest.id));
  if (remaining.length > 0) await resolveCodeModProfile(remaining.map(({ pkg }) => pkg), options);
  return { files: remaining.map(({ file }) => file), cascaded };
}

/** Validates a player-chosen file (never executing it) and keeps it in the device library. */
export async function storeLocalMod(file: File, cache: ModArchiveCacheBackend): Promise<{ file: File; pkg: CodeModPackage; stored: boolean }> {
  const pkg = await importCodeModArchive(new Uint8Array(await file.arrayBuffer()), file.name);
  if (!cache.supported) return { file, pkg, stored: false };
  const existing = await listCachedModArchives(cache);
  if (!existing.some((row) => row.digest === pkg.digest)) {
    if (existing.reduce((sum, row) => sum + row.byteLength, 0) + file.size > 64 * 1024 * 1024) {
      throw new Error("The device mod library would exceed 64 MiB. Remove unused mods first.");
    }
    const now = new Date().toISOString();
    await cache.store({ schemaVersion: 1, digest: pkg.digest, archiveName: file.name, modId: pkg.manifest.id,
      version: pkg.manifest.version, displayName: pkg.manifest.displayName, byteLength: file.size,
      cachedAt: now, lastUsedAt: now, bytes: file });
  }
  return { file, pkg, stored: true };
}
