import { isQuotaExceeded } from "../player/saveErrors.js";
import {
  STORAGE_PRESSURE_THRESHOLD,
  type StoragePersistenceReport,
} from "../player/storagePersistence.js";

const CACHE_DATABASE_NAME = "dib-mod-archive-v1";
const CACHE_DATABASE_VERSION = 1;
const CACHE_STORE_NAME = "mods";


export const MOD_CACHE_MAX_ENTRIES = 24;
export const MOD_CACHE_MAX_BYTES = 64 * 1024 * 1024;

export interface CachedModArchive {
  readonly schemaVersion: 1;
  /** SHA-256 of the archive bytes — the same package identity the profile digest binds. */
  readonly digest: string;
  readonly archiveName: string;
  readonly modId: string;
  readonly version: string;
  readonly displayName: string;
  readonly byteLength: number;
  readonly cachedAt: string;
  readonly lastUsedAt: string;
  readonly bytes: Blob;
}

export interface ModArchiveCacheBackend {
  readonly supported: boolean;
  list(): Promise<readonly unknown[]>;
  store(record: CachedModArchive): Promise<void>;
  delete(digest: string): Promise<boolean>;
  clear(): Promise<boolean>;
}

export type RememberModArchivesResult =
  | "stored"
  | "skipped-storage-pressure"
  | "quota-rejected"
  | "unsupported";

export interface ModCacheLimits {
  readonly maxEntries: number;
  readonly maxBytes: number;
}

const DEFAULT_LIMITS: ModCacheLimits = {
  maxEntries: MOD_CACHE_MAX_ENTRIES,
  maxBytes: MOD_CACHE_MAX_BYTES,
};

export class BrowserModArchiveCache implements ModArchiveCacheBackend {
  readonly supported: boolean;

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {
    this.supported = factory !== undefined;
  }

  async list(): Promise<readonly unknown[]> {
    if (this.factory === undefined) return [];
    return await this.withStore("readonly", (store) => store.getAll());
  }

  async store(record: CachedModArchive): Promise<void> {
    if (this.factory === undefined) return;
    await this.withStore("readwrite", (store) => store.put(record, record.digest));
  }

  async delete(digest: string): Promise<boolean> {
    if (this.factory === undefined) return false;
    await this.withStore("readwrite", (store) => store.delete(digest));
    return true;
  }

  async clear(): Promise<boolean> {
    if (this.factory === undefined) return false;
    await this.withStore("readwrite", (store) => store.clear());
    return true;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    try {
      const transaction = database.transaction(CACHE_STORE_NAME, mode);
      const completion = transactionCompletion(transaction);
      const result = await requestResult(operation(transaction.objectStore(CACHE_STORE_NAME)));
      await completion;
      return result;
    } finally {
      database.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    const factory = this.factory;
    if (factory === undefined) throw new Error("IndexedDB is unavailable");
    return new Promise((resolve, reject) => {
      const request = factory.open(CACHE_DATABASE_NAME, CACHE_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
          request.result.createObjectStore(CACHE_STORE_NAME);
        }
      };
      request.onsuccess = () => { resolve(request.result); };
      request.onerror = () => { reject(request.error ?? new Error("IndexedDB open failed")); };
    });
  }
}

/** Every well-formed cached package, newest use first. Malformed rows are ignored, not thrown. */
export async function listCachedModArchives(
  backend: ModArchiveCacheBackend,
): Promise<readonly CachedModArchive[]> {
  if (!backend.supported) return [];
  const rows = await backend.list();
  return rows
    .map((row) => parseCachedModArchive(row))
    .filter((row): row is CachedModArchive => row !== undefined)
    .sort((left, right) => compareText(right.lastUsedAt, left.lastUsedAt));
}

export interface ModArchiveToCache {
  readonly digest: string;
  readonly archiveName: string;
  readonly modId: string;
  readonly version: string;
  readonly displayName: string;
  readonly bytes: Blob;
}


export async function rememberModArchives(
  backend: ModArchiveCacheBackend,
  incoming: readonly ModArchiveToCache[],
  storage: Pick<StoragePersistenceReport, "usageBytes" | "quotaBytes">,
  limits: ModCacheLimits = DEFAULT_LIMITS,
): Promise<RememberModArchivesResult> {
  if (!backend.supported) return "unsupported";
  if (incoming.length === 0) return "stored";
  const existing = await listCachedModArchives(backend);
  const addedBytes = incoming
    .filter((entry) => !existing.some((row) => row.digest === entry.digest))
    .reduce((total, entry) => total + entry.bytes.size, 0);
  if (modCacheDecision(storage, addedBytes) === "skip") return "skipped-storage-pressure";

  const plan = planModCacheRetention(existing, incoming, limits);
  const now = new Date().toISOString();
  try {
    for (const digest of plan.evict) await backend.delete(digest);
    for (const entry of incoming) {
      if (!plan.keep.includes(entry.digest)) continue;
      const previous = existing.find((row) => row.digest === entry.digest);
      await backend.store({
        schemaVersion: 1,
        digest: entry.digest,
        archiveName: entry.archiveName,
        modId: entry.modId,
        version: entry.version,
        displayName: entry.displayName,
        byteLength: entry.bytes.size,
        cachedAt: previous?.cachedAt ?? now,
        lastUsedAt: now,
        bytes: entry.bytes,
      });
    }
    return "stored";
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
    return "quota-rejected";
  }
}

/**
 * Which packages survive this write. Packages that were just used always win a place; the rest
 * are retained newest-use-first until an entry or byte ceiling is reached.
 */
export function planModCacheRetention(
  existing: readonly Pick<CachedModArchive, "digest" | "byteLength" | "lastUsedAt">[],
  incoming: readonly Pick<ModArchiveToCache, "digest" | "bytes">[],
  limits: ModCacheLimits = DEFAULT_LIMITS,
): { readonly keep: readonly string[]; readonly evict: readonly string[] } {
  const keep: string[] = [];
  let entries = 0;
  let bytes = 0;
  for (const entry of incoming) {
    if (keep.includes(entry.digest)) continue;
    if (entries + 1 > limits.maxEntries || bytes + entry.bytes.size > limits.maxBytes) continue;
    keep.push(entry.digest);
    entries += 1;
    bytes += entry.bytes.size;
  }
  const survivors = [...existing]
    .filter((row) => !keep.includes(row.digest))
    .sort((left, right) => compareText(right.lastUsedAt, left.lastUsedAt));
  const evict: string[] = [];
  for (const row of survivors) {
    if (entries + 1 > limits.maxEntries || bytes + row.byteLength > limits.maxBytes) {
      evict.push(row.digest);
      continue;
    }
    entries += 1;
    bytes += row.byteLength;
  }
  return { keep: Object.freeze(keep), evict: Object.freeze(evict) };
}

/** Mirrors the asset-archive rule: never let a convenience cache crowd out save storage. */
export function modCacheDecision(
  storage: Pick<StoragePersistenceReport, "usageBytes" | "quotaBytes">,
  addedByteLength: number,
): "store" | "skip" {
  const { usageBytes, quotaBytes } = storage;
  if (usageBytes === undefined || quotaBytes === undefined || quotaBytes <= 0) return "store";
  return (usageBytes + addedByteLength) / quotaBytes >= STORAGE_PRESSURE_THRESHOLD ? "skip" : "store";
}

export function parseCachedModArchive(value: unknown): CachedModArchive | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const bytes = record["bytes"];
  if (
    record["schemaVersion"] !== 1 ||
    !isSha256Digest(record["digest"]) ||
    !isNonEmptyString(record["archiveName"]) ||
    !isNonEmptyString(record["modId"]) ||
    !isNonEmptyString(record["version"]) ||
    !isNonEmptyString(record["displayName"]) ||
    !isNonEmptyString(record["cachedAt"]) ||
    !isNonEmptyString(record["lastUsedAt"]) ||
    typeof record["byteLength"] !== "number" ||
    !(bytes instanceof Blob) ||
    bytes.size !== record["byteLength"]
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    digest: record["digest"],
    archiveName: record["archiveName"],
    modId: record["modId"],
    version: record["version"],
    displayName: record["displayName"],
    byteLength: record["byteLength"],
    cachedAt: record["cachedAt"],
    lastUsedAt: record["lastUsedAt"],
    bytes,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { resolve(request.result); };
    request.onerror = () => { reject(request.error ?? new Error("IndexedDB request failed")); };
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { resolve(); };
    transaction.onabort = () => { reject(transaction.error ?? new Error("IndexedDB aborted")); };
    transaction.onerror = () => { reject(transaction.error ?? new Error("IndexedDB failed")); };
  });
}
