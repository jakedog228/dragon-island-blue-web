import { describe, expect, it, vi } from "vitest";
import {
  describeStoragePersistence,
  formatBytes,
  isUnderStoragePressure,
  requestPersistentStorage,
} from "../src/player/storagePersistence.js";

function manager(overrides: Partial<StorageManager>): StorageManager {
  return overrides as StorageManager;
}

describe("storage persistence", () => {
  it("reports gracefully when the browser has no storage manager", async () => {
    const report = await requestPersistentStorage(undefined);
    expect(report).toEqual({ supported: false, newlyGranted: false });
    expect(describeStoragePersistence(report)).toMatch(/best-effort storage/);
  });

  it("requests persistence only when the origin is not already persistent", async () => {
    const persist = vi.fn(async () => true);
    const report = await requestPersistentStorage(manager({
      persisted: async () => true,
      persist,
      estimate: async () => ({ usage: 1024, quota: 4096 }),
    }));
    expect(persist).not.toHaveBeenCalled();
    expect(report).toMatchObject({ persisted: true, newlyGranted: false, usedFraction: 0.25 });
  });

  it("marks a fresh grant so the console line says it changed something", async () => {
    const report = await requestPersistentStorage(manager({
      persisted: async () => false,
      persist: async () => true,
      estimate: async () => ({ usage: 10, quota: 100 }),
    }));
    expect(report).toMatchObject({ persisted: true, newlyGranted: true });
    expect(describeStoragePersistence(report)).toMatch(/persistent \(granted just now\)/);
  });

  it("describes a denial as best-effort rather than an error", async () => {
    const report = await requestPersistentStorage(manager({
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({ usage: 5_242_880, quota: 52_428_800 }),
    }));
    expect(report.persisted).toBe(false);
    expect(report.error).toBeUndefined();
    expect(describeStoragePersistence(report)).toBe(
      "Save storage is best-effort; using 5.0 MB of 50 MB (10.0%).",
    );
  });

  it("captures a thrown storage manager instead of failing boot", async () => {
    const report = await requestPersistentStorage(manager({
      persisted: async () => { throw new Error("denied by policy"); },
    }));
    expect(report).toMatchObject({ supported: true, error: "denied by policy" });
    expect(describeStoragePersistence(report)).toMatch(/check failed: denied by policy/);
  });

  it("flags storage pressure at the threshold", async () => {
    const near = await requestPersistentStorage(manager({
      persisted: async () => true,
      estimate: async () => ({ usage: 80, quota: 100 }),
    }));
    const clear = await requestPersistentStorage(manager({
      persisted: async () => true,
      estimate: async () => ({ usage: 79, quota: 100 }),
    }));
    expect(isUnderStoragePressure(near)).toBe(true);
    expect(isUnderStoragePressure(clear)).toBe(false);
    expect(isUnderStoragePressure({ supported: true, newlyGranted: false })).toBe(false);
  });

  it("omits the usage clause when the browser reports no estimate", async () => {
    const report = await requestPersistentStorage(manager({ persisted: async () => true }));
    expect(describeStoragePersistence(report)).toBe("Save storage is persistent.");
  });
});

describe("byte formatting", () => {
  it("uses whole units below 10 and one decimal above", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(52_428_800)).toBe("50 MB");
  });
});
