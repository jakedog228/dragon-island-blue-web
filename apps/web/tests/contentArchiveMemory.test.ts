import { describe, expect, it } from "vitest";
import {
  CONTENT_GATE_MEMORY_KEY,
  archiveCacheDecision,
  hasRememberedAttestation,
  loadRememberedContentArchive,
  readContentGateMemory,
  rememberContentArchive,
  sha256ArchiveBytes,
  shouldRestoreLastModProfile,
  withRememberedAttestation,
  withRememberedModProfileRestore,
  withRememberedMode,
  writeContentGateMemory,
  type CachedContentArchive,
  type ContentArchiveCacheBackend,
  type KeyValueStorage,
} from "../src/content/contentArchiveMemory.js";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

class MemoryKeyValueStorage implements KeyValueStorage {
  readonly values = new Map<string, string>();
  rejectWrites = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.rejectWrites) throw new Error("quota exceeded");
    this.values.set(key, value);
  }
}

class MemoryArchiveCache implements ContentArchiveCacheBackend {
  readonly supported = true;
  value: unknown | undefined;
  rejectWithQuota = false;
  clearCalls = 0;

  async load(): Promise<unknown | undefined> {
    return this.value;
  }

  async store(record: CachedContentArchive): Promise<void> {
    if (this.rejectWithQuota) {
      const error = new Error("quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.value = record;
  }

  async clear(): Promise<boolean> {
    this.clearCalls++;
    this.value = undefined;
    return true;
  }
}

describe("remembered content archive", () => {
  it("remembers only supported play modes and an exact versioned archive attestation", () => {
    const storage = new MemoryKeyValueStorage();
    let memory = withRememberedMode(readContentGateMemory(storage), "local");
    memory = withRememberedAttestation(memory, DIGEST_A, true);
    writeContentGateMemory(memory, storage);

    const restored = readContentGateMemory(storage);
    expect(restored.lastMode).toBe("local");
    expect(hasRememberedAttestation(restored, DIGEST_A)).toBe(true);
    expect(hasRememberedAttestation(restored, DIGEST_B)).toBe(false);

    writeContentGateMemory(withRememberedAttestation(restored, DIGEST_A, false), storage);
    expect(hasRememberedAttestation(readContentGateMemory(storage), DIGEST_A)).toBe(false);
  });

  it("persists an explicit mod clear without changing the backward-compatible restore default", () => {
    const storage = new MemoryKeyValueStorage();
    expect(shouldRestoreLastModProfile(readContentGateMemory(storage))).toBe(true);

    let memory = withRememberedModProfileRestore(readContentGateMemory(storage), false);
    writeContentGateMemory(memory, storage);
    expect(shouldRestoreLastModProfile(readContentGateMemory(storage))).toBe(false);

    memory = withRememberedModProfileRestore(readContentGateMemory(storage), true);
    writeContentGateMemory(memory, storage);
    expect(shouldRestoreLastModProfile(readContentGateMemory(storage))).toBe(true);
  });

  it("fails closed on stale or malformed preference records and ignores preference quota errors", () => {
    const storage = new MemoryKeyValueStorage();
    storage.values.set(CONTENT_GATE_MEMORY_KEY, JSON.stringify({
      schemaVersion: 1,
      lastMode: "scenario",
      restoreLastModProfile: "yes",
      attestedArchiveDigest: DIGEST_A,
      attestationVersion: 0,
    }));
    expect(readContentGateMemory(storage)).toEqual({ schemaVersion: 1 });

    storage.rejectWrites = true;
    expect(() => writeContentGateMemory({ schemaVersion: 1, lastMode: "official" }, storage))
      .not.toThrow();
  });

  it("hashes the exact raw archive bytes", async () => {
    expect(await sha256ArchiveBytes(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("reserves the existing 80-percent pressure boundary for saves", () => {
    expect(archiveCacheDecision({ usageBytes: 50, quotaBytes: 100 }, 29)).toBe("store");
    expect(archiveCacheDecision({ usageBytes: 50, quotaBytes: 100 }, 30)).toBe("skip");
    // Replacing a 30-byte prior pack does not count both copies against the steady-state policy.
    expect(archiveCacheDecision({ usageBytes: 70, quotaBytes: 100 }, 30, 30)).toBe("store");
    expect(archiveCacheDecision({}, 1_000_000)).toBe("store");
  });

  it("keeps exactly the last pack, reuses an identical record, and clears invalid records", async () => {
    const cache = new MemoryArchiveCache();
    const first = await rememberContentArchive(
      cache,
      { archiveName: "first.ipa", digest: DIGEST_A, bytes: new Blob(["first"]) },
      { supported: true, newlyGranted: false, usageBytes: 0, quotaBytes: 100 },
    );
    expect(first).toBe("stored");
    expect((await loadRememberedContentArchive(cache))?.archiveName).toBe("first.ipa");

    const already = await rememberContentArchive(
      cache,
      { archiveName: "first.ipa", digest: DIGEST_A, bytes: new Blob(["first"]) },
      { supported: true, newlyGranted: false, usageBytes: 5, quotaBytes: 100 },
    );
    expect(already).toBe("already-stored");

    cache.value = { schemaVersion: 1, archiveName: "broken", bytes: "not a blob" };
    await expect(loadRememberedContentArchive(cache)).resolves.toBeUndefined();
    expect(cache.value).toBeUndefined();
  });

  it("deletes the disposable cache instead of pressuring saves", async () => {
    const cache = new MemoryArchiveCache();
    cache.value = {
      schemaVersion: 1,
      archiveName: "old.ipa",
      digest: DIGEST_A,
      byteLength: 3,
      cachedAt: new Date().toISOString(),
      bytes: new Blob(["old"]),
    } satisfies CachedContentArchive;

    await expect(rememberContentArchive(
      cache,
      { archiveName: "large.ipa", digest: DIGEST_B, bytes: new Blob(["x".repeat(40)]) },
      { supported: true, newlyGranted: false, usageBytes: 75, quotaBytes: 100 },
    )).resolves.toBe("skipped-storage-pressure");
    expect(cache.value).toBeUndefined();

    cache.rejectWithQuota = true;
    await expect(rememberContentArchive(
      cache,
      { archiveName: "next.ipa", digest: DIGEST_B, bytes: new Blob(["next"]) },
      { supported: true, newlyGranted: false, usageBytes: 0, quotaBytes: 100 },
    )).resolves.toBe("quota-rejected");
    expect(cache.value).toBeUndefined();
  });
});
