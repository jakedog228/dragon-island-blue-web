import { describe, expect, it } from "vitest";
import {
  composePlayProfileViews,
  describePlayProfileLabel,
  dismissPlayProfile,
  formatShortFileSize,
  forgetPlayProfile,
  lastUsedPlayProfile,
  readDismissedProfiles,
  readPlayProfiles,
  readSaveSlotIndex,
  rememberPlayProfile,
  type PlayProfileRecord,
} from "../src/content/playProfiles.js";
import {
  planModCacheRetention,
  modCacheDecision,
  parseCachedModArchive,
} from "../src/content/modArchiveCache.js";

const digest = (seed: string): string => seed.repeat(64).slice(0, 64);
const ARCHIVE = digest("a");
const DEVTOOLS = digest("b");
const BARRAGE = digest("c");

class MemoryStorage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function storageWithSaves(entries: readonly (readonly [string, unknown])[]): MemoryStorage {
  const storage = new MemoryStorage();
  for (const [key, value] of entries) storage.setItem(key, JSON.stringify(value));
  return storage;
}

const record = (overrides: Partial<PlayProfileRecord> = {}): PlayProfileRecord => ({
  schemaVersion: 1,
  namespace: "sha-256:dib-content-v7:feed",
  archiveDigest: ARCHIVE,
  archiveName: "dib-1.0.ipa",
  archiveByteLength: 12 * 1024 * 1024,
  mods: [{
    digest: DEVTOOLS,
    id: "dev.dragonislandblue.devtools",
    version: "1.0.0",
    displayName: "Devtools",
    byteLength: 4_494,
  }],
  lastUsedAt: "2026-08-24T00:00:00.000Z",
  ...overrides,
});

describe("play profile records", () => {
  it("retains release-specific neutrality and treats legacy metadata conservatively", () => {
    const storage = new MemoryStorage();
    const legacy = record().mods[0]!;
    rememberPlayProfile(storage, record({ mods: [legacy, { ...legacy, id: "dev.example.hud", saveCompatibility: "neutral" }] }));
    expect(readPlayProfiles(storage)[0]!.mods.map(mod => mod.saveCompatibility)).toEqual(["dependent", "neutral"]);
  });
  it("remembers newest first, refreshes in place, and forgets without touching saves", () => {
    const storage = new MemoryStorage();
    storage.setItem("dib-save-v1:sha-256:dib-content-v7:feed:slot-1", "{}");

    rememberPlayProfile(storage, record({ lastUsedAt: "2026-08-24T00:00:00.000Z" }));
    rememberPlayProfile(storage, record({
      namespace: "sha-256:dib-content-v7:beef",
      mods: [],
      lastUsedAt: "2026-08-24T01:00:00.000Z",
    }));
    expect(readPlayProfiles(storage).map((row) => row.namespace)).toEqual([
      "sha-256:dib-content-v7:beef",
      "sha-256:dib-content-v7:feed",
    ]);

    // Relaunching an older pairing moves it back to the front rather than duplicating it.
    rememberPlayProfile(storage, record({ lastUsedAt: "2026-08-24T02:00:00.000Z" }));
    const refreshed = readPlayProfiles(storage);
    expect(refreshed).toHaveLength(2);
    expect(refreshed[0]?.namespace).toBe("sha-256:dib-content-v7:feed");

    forgetPlayProfile(storage, "sha-256:dib-content-v7:feed");
    expect(readPlayProfiles(storage).map((row) => row.namespace))
      .toEqual(["sha-256:dib-content-v7:beef"]);
    expect(storage.getItem("dib-save-v1:sha-256:dib-content-v7:feed:slot-1")).toBe("{}");
  });

  it("ignores malformed records instead of losing the whole registry", () => {
    const storage = new MemoryStorage();
    storage.setItem("dib.playProfiles.v1", JSON.stringify([
      record(),
      { schemaVersion: 1, namespace: "x", archiveDigest: "not-a-digest", archiveName: "a", mods: [], lastUsedAt: "t" },
      "nonsense",
    ]));
    expect(readPlayProfiles(storage)).toHaveLength(1);

    const legacy = record({ archiveByteLength: undefined, mods: record().mods.map((mod) => ({
      ...mod,
      byteLength: undefined,
    })) });
    storage.setItem("dib.playProfiles.v1", JSON.stringify([legacy]));
    expect(readPlayProfiles(storage)[0]).toMatchObject({
      archiveByteLength: undefined,
      mods: [{ byteLength: undefined }],
    });

    storage.setItem("dib.playProfiles.v1", JSON.stringify([
      record({ archiveByteLength: -1 }),
      record({ mods: record().mods.map((mod) => ({ ...mod, byteLength: 1.5 })) }),
    ]));
    expect(readPlayProfiles(storage)).toEqual([]);

    const broken = new MemoryStorage();
    broken.setItem("dib.playProfiles.v1", "{not json");
    expect(readPlayProfiles(broken)).toEqual([]);
  });
});

describe("offline save slot index", () => {
  it("reads namespaces straight from save keys and skips previous-revision siblings", () => {
    const storage = storageWithSaves([
      ["dib-save-v1:sha-256:dib-content-v7:feed:slot-1", { revision: 4, updatedAt: "2026-08-20T00:00:00.000Z" }],
      ["dib-save-v1:sha-256:dib-content-v7:feed:slot-3", { revision: 2, updatedAt: "2026-08-21T00:00:00.000Z" }],
      ["dib-save-v1:sha-256:dib-content-v7:feed:slot-1:previous", { revision: 3 }],
      ["dib-save-v1:sha-256:dib-content-v7:beef:slot-2", { revision: 1, updatedAt: "2026-08-19T00:00:00.000Z" }],
      ["dib.contentGate.v1", { schemaVersion: 1 }],
    ]);

    const index = readSaveSlotIndex(storage);
    expect([...index.keys()].sort()).toEqual([
      "sha-256:dib-content-v7:beef",
      "sha-256:dib-content-v7:feed",
    ]);
    expect(index.get("sha-256:dib-content-v7:feed")?.map((slot) => slot.slotId))
      .toEqual(["slot-1", "slot-3"]);
    expect(index.get("sha-256:dib-content-v7:feed")?.[0]).toMatchObject({ revision: 4 });
  });
});

describe("profile views", () => {
  const slots = readSaveSlotIndex(storageWithSaves([
    ["dib-save-v1:sha-256:dib-content-v7:feed:slot-1", { revision: 1, updatedAt: "2026-08-20T00:00:00.000Z" }],
    ["dib-save-v1:sha-256:dib-content-v7:orphan:slot-2", { revision: 1, updatedAt: "2026-08-18T00:00:00.000Z" }],
  ]));

  it("marks a pairing restorable only when every package is on this device", () => {
    const complete = composePlayProfileViews([record()], slots, {
      archiveDigest: ARCHIVE,
      modDigests: new Set([DEVTOOLS]),
    });
    const view = complete.find((entry) => entry.namespace.endsWith("feed"));
    expect(view?.restorable).toBe(true);
    expect(view?.contents.map((entry) => entry.cached)).toEqual([true, true]);
    expect(view?.contents.map((entry) => entry.byteLength)).toEqual([12 * 1024 * 1024, 4_494]);

    const missingMod = composePlayProfileViews([record()], slots, {
      archiveDigest: ARCHIVE,
      modDigests: new Set(),
    });
    const ghost = missingMod.find((entry) => entry.namespace.endsWith("feed"));
    expect(ghost?.restorable).toBe(false);
    expect(ghost?.contents.map((entry) => entry.cached)).toEqual([true, false]);

    const legacy = composePlayProfileViews([
      record({
        archiveByteLength: undefined,
        mods: record().mods.map((mod) => ({ ...mod, byteLength: undefined })),
      }),
    ], slots, {
      archiveDigest: ARCHIVE,
      archiveByteLength: 99,
      modDigests: new Set([DEVTOOLS]),
      modByteLengths: new Map([[DEVTOOLS, 77]]),
    });
    expect(legacy.find((entry) => entry.namespace.endsWith("feed"))?.contents
      .map((entry) => entry.byteLength)).toEqual([99, 77]);
  });

  it("keeps saves whose pairing was never recorded, as unidentified content", () => {
    const views = composePlayProfileViews([record()], slots, {
      archiveDigest: undefined,
      modDigests: new Set(),
    });
    const orphan = views.find((entry) => entry.namespace.endsWith("orphan"));
    expect(orphan).toMatchObject({ record: undefined, restorable: false, contents: [] });
    expect(orphan?.label).toContain("Unidentified content");
    expect(orphan?.saveSlots.map((slot) => slot.slotId)).toEqual(["slot-2"]);
  });

  it("shows nothing for a recorded pairing whose saves are gone", () => {
    const views = composePlayProfileViews(
      [record({ namespace: "sha-256:dib-content-v7:deleted" })],
      slots,
      { archiveDigest: ARCHIVE, modDigests: new Set([DEVTOOLS]) },
    );
    expect(views.some((entry) => entry.namespace.endsWith("deleted"))).toBe(false);
  });

  it("hides a dismissed namespace without disturbing its saves or record", () => {
    const storage = new MemoryStorage();
    storage.setItem("dib-save-v1:sha-256:dib-content-v7:feed:slot-1", JSON.stringify({ revision: 1 }));
    dismissPlayProfile(storage, "sha-256:dib-content-v7:feed");

    expect([...readDismissedProfiles(storage)]).toEqual(["sha-256:dib-content-v7:feed"]);
    const hidden = composePlayProfileViews([record()], slots,
      { archiveDigest: ARCHIVE, modDigests: new Set([DEVTOOLS]) },
      readDismissedProfiles(storage));
    expect(hidden.some((view) => view.namespace.endsWith("feed"))).toBe(false);
    // The orphan row is untouched, and so is the save the dismissed row was standing for.
    expect(hidden.some((view) => view.namespace.endsWith("orphan"))).toBe(true);
    expect(storage.getItem("dib-save-v1:sha-256:dib-content-v7:feed:slot-1")).not.toBeNull();
  });

  it("dismisses an unidentified namespace, which has no record to forget", () => {
    const storage = new MemoryStorage();
    dismissPlayProfile(storage, "sha-256:dib-content-v7:orphan");
    const views = composePlayProfileViews([record()], slots,
      { archiveDigest: ARCHIVE, modDigests: new Set([DEVTOOLS]) },
      readDismissedProfiles(storage));
    expect(views.map((view) => view.namespace)).toEqual(["sha-256:dib-content-v7:feed"]);
  });

  it("brings a dismissed pairing back when it is played again", () => {
    const storage = new MemoryStorage();
    dismissPlayProfile(storage, "sha-256:dib-content-v7:feed");
    rememberPlayProfile(storage, record());
    expect([...readDismissedProfiles(storage)]).toEqual([]);
    const views = composePlayProfileViews(readPlayProfiles(storage), slots,
      { archiveDigest: ARCHIVE, modDigests: new Set([DEVTOOLS]) },
      readDismissedProfiles(storage));
    expect(views.some((view) => view.namespace.endsWith("feed"))).toBe(true);
  });

  it("labels a pairing by its archive and mod count", () => {
    expect(describePlayProfileLabel(record({ mods: [] }), "n")).toBe("dib-1.0 (no mods)");
    expect(describePlayProfileLabel(record(), "n")).toBe("dib-1.0 + Devtools");
    expect(describePlayProfileLabel(record({
      mods: [
        { digest: DEVTOOLS, id: "a.b", version: "1.0.0", displayName: "Devtools", byteLength: 100 },
        { digest: BARRAGE, id: "a.c", version: "2.0.0", displayName: "Barrage", byteLength: 200 },
      ],
    }), "n")).toBe("dib-1.0 + 2 mods");
  });

  it("selects the newest used profile even when storage rows are out of order", () => {
    const newest = record({
      namespace: "sha-256:dib-content-v7:newest",
      lastUsedAt: "2026-08-24T03:00:00.000Z",
    });
    expect(lastUsedPlayProfile([
      newest,
      record({ lastUsedAt: "2026-08-24T04:00:00.000Z", namespace: "sha-256:dib-content-v7:last" }),
      record({ lastUsedAt: "2026-08-24T02:00:00.000Z" }),
    ])?.namespace).toBe("sha-256:dib-content-v7:last");
    expect(lastUsedPlayProfile([])).toBeUndefined();
  });

  it("formats compact profile file sizes", () => {
    expect(formatShortFileSize(665)).toBe("665 B");
    expect(formatShortFileSize(4_494)).toBe("4.4 KB");
    expect(formatShortFileSize(12 * 1024 * 1024)).toBe("12 MB");
    expect(() => formatShortFileSize(-1)).toThrow("Invalid file size");
  });
});

describe("mod archive cache retention", () => {
  const blob = (size: number) => new Blob([new Uint8Array(size)]);

  it("always keeps what was just used and evicts the least recently used rest", () => {
    const plan = planModCacheRetention(
      [
        { digest: digest("1"), byteLength: 10, lastUsedAt: "2026-08-01T00:00:00.000Z" },
        { digest: digest("2"), byteLength: 10, lastUsedAt: "2026-08-03T00:00:00.000Z" },
        { digest: digest("3"), byteLength: 10, lastUsedAt: "2026-08-02T00:00:00.000Z" },
      ],
      [{ digest: DEVTOOLS, bytes: blob(10) }],
      { maxEntries: 3, maxBytes: 1_000 },
    );
    expect(plan.keep).toEqual([DEVTOOLS]);
    // Oldest use loses its place; the two newer ones stay.
    expect(plan.evict).toEqual([digest("1")]);
  });

  it("evicts on the byte ceiling as well as the entry ceiling", () => {
    const plan = planModCacheRetention(
      [{ digest: digest("1"), byteLength: 900, lastUsedAt: "2026-08-01T00:00:00.000Z" }],
      [{ digest: DEVTOOLS, bytes: blob(200) }],
      { maxEntries: 10, maxBytes: 1_000 },
    );
    expect(plan.keep).toEqual([DEVTOOLS]);
    expect(plan.evict).toEqual([digest("1")]);
  });

  it("refuses to crowd out save storage", () => {
    expect(modCacheDecision({ usageBytes: 10, quotaBytes: 1_000 }, 10)).toBe("store");
    expect(modCacheDecision({ usageBytes: 900, quotaBytes: 1_000 }, 50)).toBe("skip");
    // A browser that reports no quota at all must not be treated as under pressure.
    expect(modCacheDecision({}, 10)).toBe("store");
  });

  it("rejects a cached row whose bytes do not match its recorded length", () => {
    const valid = {
      schemaVersion: 1,
      digest: DEVTOOLS,
      archiveName: "devtools.dibmod",
      modId: "dev.dragonislandblue.devtools",
      version: "1.0.0",
      displayName: "Devtools",
      byteLength: 4,
      cachedAt: "2026-08-24T00:00:00.000Z",
      lastUsedAt: "2026-08-24T00:00:00.000Z",
      bytes: blob(4),
    };
    expect(parseCachedModArchive(valid)).toBeDefined();
    expect(parseCachedModArchive({ ...valid, byteLength: 5 })).toBeUndefined();
    expect(parseCachedModArchive({ ...valid, digest: "short" })).toBeUndefined();
    expect(parseCachedModArchive(undefined)).toBeUndefined();
  });
});
