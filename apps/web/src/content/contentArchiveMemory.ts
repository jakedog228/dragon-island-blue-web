import { isQuotaExceeded } from "../player/saveErrors.js";
import {
  STORAGE_PRESSURE_THRESHOLD,
  type StoragePersistenceReport,
} from "../player/storagePersistence.js";

const CACHE_DATABASE_NAME = "dib-content-archive-v1";
const CACHE_DATABASE_VERSION = 1;
const CACHE_STORE_NAME = "archives";
const LAST_ARCHIVE_KEY = "last";

export const CONTENT_GATE_MEMORY_KEY = "dib.contentGate.v1";
export const CONTENT_RIGHTS_ATTESTATION_VERSION = 1;

export type RememberedPlayMode = "local" | "official";

export interface ContentGateMemory {
  readonly schemaVersion: 1;
  readonly lastMode?: RememberedPlayMode;
  /** False after an explicit Clear mods action; absent keeps the pre-field restore behaviour. */
  readonly restoreLastModProfile?: boolean;
  readonly attestedArchiveDigest?: string;
  readonly attestationVersion?: typeof CONTENT_RIGHTS_ATTESTATION_VERSION;
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CachedContentArchive {
  readonly schemaVersion: 1;
  readonly archiveName: string;
  readonly digest: string;
  readonly byteLength: number;
  readonly cachedAt: string;
  readonly bytes: Blob;
}

export interface ContentArchiveCacheBackend {
  readonly supported: boolean;
  load(): Promise<unknown | undefined>;
  store(record: CachedContentArchive): Promise<void>;
  clear(): Promise<boolean>;
}

export type RememberArchiveResult =
  | "stored"
  | "already-stored"
  | "skipped-storage-pressure"
  | "quota-rejected"
  | "unsupported";

export class BrowserContentArchiveCache implements ContentArchiveCacheBackend {
  readonly supported: boolean;

  constructor(private readonly factory: IDBFactory | undefined = globalThis.indexedDB) {
    this.supported = factory !== undefined;
  }

  async load(): Promise<unknown | undefined> {
    if (this.factory === undefined) return undefined;
    return await this.withStore("readonly", (store) => store.get(LAST_ARCHIVE_KEY));
  }

  async store(record: CachedContentArchive): Promise<void> {
    if (this.factory === undefined) throw new Error("IndexedDB is unavailable");
    await this.withStore("readwrite", (store) => store.put(record, LAST_ARCHIVE_KEY));
  }

  async clear(): Promise<boolean> {
    if (this.factory === undefined) return false;
    await this.withStore("readwrite", (store) => store.delete(LAST_ARCHIVE_KEY));
    // Retrying a save once is harmless when this database was empty, and avoids a separate read
    // whose result could become stale before the deletion transaction starts.
    return true;
  }

  private async withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    try {
      const transaction = database.transaction(CACHE_STORE_NAME, mode);
      const completed = transactionCompletion(transaction);
      const result = await requestResult(operation(transaction.objectStore(CACHE_STORE_NAME)));
      await completed;
      return result;
    } finally {
      database.close();
    }
  }

  private open(): Promise<IDBDatabase> {
    const factory = this.factory;
    if (factory === undefined) return Promise.reject(new Error("IndexedDB is unavailable"));
    return new Promise((resolve, reject) => {
      const request = factory.open(CACHE_DATABASE_NAME, CACHE_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(CACHE_STORE_NAME)) {
          request.result.createObjectStore(CACHE_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Could not open archive cache"));
      request.onblocked = () => reject(new Error("Archive cache upgrade is blocked"));
    });
  }
}

export function readContentGateMemory(
  storage: KeyValueStorage | undefined = browserLocalStorage(),
): ContentGateMemory {
  if (storage === undefined) return { schemaVersion: 1 };
  try {
    const raw = storage.getItem(CONTENT_GATE_MEMORY_KEY);
    if (raw === null) return { schemaVersion: 1 };
    return parseContentGateMemory(JSON.parse(raw));
  } catch {
    return { schemaVersion: 1 };
  }
}

export function writeContentGateMemory(
  memory: ContentGateMemory,
  storage: KeyValueStorage | undefined = browserLocalStorage(),
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(CONTENT_GATE_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Preferences are disposable. A full origin must not turn a mode/checkmark write into a gate
    // or save failure.
  }
}

export function withRememberedMode(
  memory: ContentGateMemory,
  mode: RememberedPlayMode,
): ContentGateMemory {
  return { ...memory, schemaVersion: 1, lastMode: mode };
}

export function withRememberedModProfileRestore(
  memory: ContentGateMemory,
  restore: boolean,
): ContentGateMemory {
  return { ...memory, schemaVersion: 1, restoreLastModProfile: restore };
}

export function shouldRestoreLastModProfile(memory: ContentGateMemory): boolean {
  return memory.restoreLastModProfile !== false;
}

export function withRememberedAttestation(
  memory: ContentGateMemory,
  digest: string,
  attested: boolean,
): ContentGateMemory {
  if (!isSha256Digest(digest)) throw new Error("archive attestation requires a SHA-256 digest");
  if (attested) {
    return {
      ...memory,
      schemaVersion: 1,
      attestedArchiveDigest: digest,
      attestationVersion: CONTENT_RIGHTS_ATTESTATION_VERSION,
    };
  }
  if (memory.attestedArchiveDigest !== digest) return memory;
  const { attestedArchiveDigest: _digest, attestationVersion: _version, ...remaining } = memory;
  return { ...remaining, schemaVersion: 1 };
}

export function hasRememberedAttestation(
  memory: ContentGateMemory,
  digest: string,
): boolean {
  return memory.attestationVersion === CONTENT_RIGHTS_ATTESTATION_VERSION &&
    memory.attestedArchiveDigest === digest;
}

export async function sha256ArchiveBytes(
  bytes: Uint8Array<ArrayBuffer>,
  subtle: Pick<SubtleCrypto, "digest"> | undefined = globalThis.crypto?.subtle,
): Promise<string> {
  if (subtle === undefined) throw new Error("Web Crypto is unavailable");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function loadRememberedContentArchive(
  backend: ContentArchiveCacheBackend,
): Promise<CachedContentArchive | undefined> {
  if (!backend.supported) return undefined;
  const value = await backend.load();
  const parsed = parseCachedContentArchive(value);
  if (value !== undefined && parsed === undefined) await backend.clear();
  return parsed;
}

export async function rememberContentArchive(
  backend: ContentArchiveCacheBackend,
  archive: Omit<CachedContentArchive, "schemaVersion" | "cachedAt" | "byteLength">,
  storage: StoragePersistenceReport,
): Promise<RememberArchiveResult> {
  if (!backend.supported) return "unsupported";
  const previous = await loadRememberedContentArchive(backend);
  if (
    previous?.digest === archive.digest &&
    previous.archiveName === archive.archiveName &&
    previous.byteLength === archive.bytes.size
  ) {
    return "already-stored";
  }
  const decision = archiveCacheDecision(storage, archive.bytes.size, previous?.byteLength ?? 0);
  if (decision === "skip") {
    // A different cached package is no longer the last-used package. Removing it also preserves
    // the space reservation that caused this write to be skipped.
    await backend.clear();
    return "skipped-storage-pressure";
  }
  await backend.clear();
  try {
    await backend.store({
      schemaVersion: 1,
      archiveName: archive.archiveName,
      digest: archive.digest,
      byteLength: archive.bytes.size,
      cachedAt: new Date().toISOString(),
      bytes: archive.bytes,
    });
    return "stored";
  } catch (error) {
    if (!isQuotaExceeded(error)) throw error;
    await backend.clear().catch(() => false);
    return "quota-rejected";
  }
}

export function archiveCacheDecision(
  storage: Pick<StoragePersistenceReport, "usageBytes" | "quotaBytes">,
  archiveByteLength: number,
  replacedArchiveByteLength = 0,
): "store" | "skip" {
  const { usageBytes, quotaBytes } = storage;
  if (
    usageBytes === undefined ||
    quotaBytes === undefined ||
    quotaBytes <= 0
  ) {
    return "store";
  }
  const usageWithoutReplacedArchive = Math.max(0, usageBytes - replacedArchiveByteLength);
  const projectedFraction = (usageWithoutReplacedArchive + archiveByteLength) / quotaBytes;
  return projectedFraction >= STORAGE_PRESSURE_THRESHOLD ? "skip" : "store";
}

function parseContentGateMemory(value: unknown): ContentGateMemory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { schemaVersion: 1 };
  }
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== 1) return { schemaVersion: 1 };
  const lastMode = record["lastMode"];
  const restoreLastModProfile = record["restoreLastModProfile"];
  const digest = record["attestedArchiveDigest"];
  const version = record["attestationVersion"];
  return {
    schemaVersion: 1,
    ...(lastMode === "local" || lastMode === "official" ? { lastMode } : {}),
    ...(typeof restoreLastModProfile === "boolean" ? { restoreLastModProfile } : {}),
    ...(isSha256Digest(digest) && version === CONTENT_RIGHTS_ATTESTATION_VERSION
      ? {
          attestedArchiveDigest: digest,
          attestationVersion: CONTENT_RIGHTS_ATTESTATION_VERSION,
        }
      : {}),
  };
}

function parseCachedContentArchive(value: unknown): CachedContentArchive | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const cachedAt = record["cachedAt"];
  const bytes = record["bytes"];
  if (
    record["schemaVersion"] !== 1 ||
    typeof record["archiveName"] !== "string" ||
    record["archiveName"].length === 0 ||
    !isSha256Digest(record["digest"]) ||
    !Number.isSafeInteger(record["byteLength"]) ||
    (record["byteLength"] as number) <= 0 ||
    typeof cachedAt !== "string" ||
    Number.isNaN(new Date(cachedAt).getTime()) ||
    !(bytes instanceof Blob) ||
    bytes.size !== record["byteLength"]
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    archiveName: record["archiveName"],
    digest: record["digest"],
    byteLength: record["byteLength"] as number,
    cachedAt,
    bytes,
  };
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function browserLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Archive cache request failed"));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(
      transaction.error ?? new Error("Archive cache transaction failed"),
    );
    transaction.onabort = () => reject(
      transaction.error ?? new Error("Archive cache transaction was aborted"),
    );
  });
}
