import { describe, expect, it } from "vitest";
import { BrowserSaveConnection } from "../src/player/browserSaveClient.js";
import type { ContentFingerprint } from "../src/content/contentFingerprint.js";
import { SaveConflictError, SaveQuotaError } from "../src/player/saveErrors.js";
import type { PlayerGameStateSnapshot } from "../src/player/gameState.js";

class MemoryStorage {
  readonly values = new Map<string, string>();
  /** Keys matching this reject writes, standing in for a full origin. */
  rejectKeys: RegExp | undefined;
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void {
    if (this.rejectKeys?.test(key) === true) {
      const error = new Error("quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.values.set(key, value);
  }
  removeItem(key: string): void { this.values.delete(key); }
}

function state(heroLevel: number): PlayerGameStateSnapshot {
  return {
    schemaVersion: 1,
    player: {
      schemaVersion: 1,
      profile: { schemaVersion: 1, heroLevel } as never,
      party: { kind: "standalone-levels", levels: [heroLevel] },
    },
  };
}

function stateWithClaims(
  heroLevel: number,
  claimedCollectionGoalIds: readonly string[],
): PlayerGameStateSnapshot {
  const schema1 = state(heroLevel);
  return {
    ...schema1,
    player: {
      ...schema1.player,
      schemaVersion: 2,
      claimedCollectionGoalIds,
    },
  };
}

const fingerprint: ContentFingerprint = {
  algorithm: "SHA-256",
  scope: "dib-identity-plists-v7",
  digest: "current-v7",
  previousV6: {
    algorithm: "SHA-256",
    scope: "dib-identity-plists-v6",
    digest: "previous-v6",
  },
  previousV5: {
    algorithm: "SHA-256",
    scope: "dib-identity-plists-v5",
    digest: "previous-v5",
  },
  previousV4: {
    algorithm: "SHA-256",
    scope: "dib-identity-plists-v4",
    digest: "previous-v4",
  },
  previousV3: {
    algorithm: "SHA-256",
    scope: "dib-identity-plists-v3",
    digest: "previous-v3",
  },
  previousV2: {
    algorithm: "SHA-256",
    scope: "dib-identity-plists-v2",
    digest: "previous-v2",
  },
  legacyV1: {
    algorithm: "SHA-256",
    scope: "dib-identity-plists-v1",
    digest: "legacy-v1",
  },
};

function namespace(projection: {
  readonly algorithm: string;
  readonly scope: string;
  readonly digest: string;
}): string {
  return `${projection.algorithm}:${projection.scope}:${projection.digest}`;
}

function liveKey(projection: {
  readonly algorithm: string;
  readonly scope: string;
  readonly digest: string;
}, slotId: "slot-1" | "slot-2" | "slot-3"): string {
  return `dib-save-v1:${namespace(projection)}:${slotId}`;
}

describe("browser-local three-slot save store", () => {
  it("persists namespaced JSON state and advances revisions", async () => {
    const storage = new MemoryStorage();
    const connection = BrowserSaveConnection.forNamespace("archive-a", storage);
    const session = connection.open("slot-2");
    expect(await session.load()).toBeUndefined();
    await session.save(state(4));
    await session.save(state(5));
    await session.flush();

    expect(connection.summary("slot-2")).toMatchObject({
      slotId: "slot-2",
      revision: 2,
      compatible: true,
    });
    expect(connection.slots.map((slot) => slot.slotId)).toEqual(["slot-2"]);
    const raw = storage.getItem("dib-save-v1:archive-a:slot-2")!;
    expect(raw).not.toContain("data:image");
    expect(JSON.parse(raw)).toMatchObject({ revision: 2, state: { schemaVersion: 1 } });
    expect((await connection.loadSlotState("slot-2"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [5],
    });
  });

  it("isolates archive fingerprints and retains all three source slot ids", async () => {
    const storage = new MemoryStorage();
    const first = BrowserSaveConnection.forNamespace("archive-a", storage);
    await first.open("slot-1").save(state(1));
    await first.open("slot-3").save(state(3));

    expect(first.slots.map((slot) => slot.slotId)).toEqual(["slot-1", "slot-3"]);
    const other = BrowserSaveConnection.forNamespace("archive-b", storage);
    expect(other.slots).toEqual([]);
    expect(await other.loadSlotState("slot-1")).toBeUndefined();
  });

  it("clones an explicitly selected foreign slot while preserving its source", async () => {
    const storage = new MemoryStorage();
    const source = BrowserSaveConnection.forNamespace("archive-a", storage);
    await source.open("slot-2").save(state(14));
    const target = BrowserSaveConnection.forNamespace("archive-b", storage);

    await target.cloneSlotFromNamespace(source.saveNamespace, "slot-2");

    expect((await source.loadSlotState("slot-2"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [14],
    });
    expect((await target.loadSlotState("slot-2"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [14],
    });
    expect(source.summary("slot-2")?.revision).toBe(1);
    expect(target.summary("slot-2")?.revision).toBe(1);
  });

  it("refuses to overwrite a destination during a cross-content clone", async () => {
    const storage = new MemoryStorage();
    const source = BrowserSaveConnection.forNamespace("archive-a", storage);
    const target = BrowserSaveConnection.forNamespace("archive-b", storage);
    await source.open("slot-1").save(state(4));
    await target.open("slot-1").save(state(9));

    await expect(target.cloneSlotFromNamespace("archive-a", "slot-1"))
      .rejects.toThrow(/already has a save/);
    expect((await target.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [9],
    });
  });

  it("uses a preview without another storage read and returns defensive snapshots", async () => {
    const storage = new MemoryStorage();
    const connection = BrowserSaveConnection.forNamespace("archive", storage);
    await connection.open("slot-1").save(state(8));
    const preview = await connection.loadSlotState("slot-1");
    expect(preview).toBeDefined();
    const session = connection.open("slot-1", preview);
    const loaded = await session.load();
    expect(loaded).toEqual(preview);
    expect(loaded).not.toBe(preview);
  });

  it("rejects stale cross-tab writes and erasures", async () => {
    const storage = new MemoryStorage();
    const first = BrowserSaveConnection.forNamespace("archive", storage);
    const second = BrowserSaveConnection.forNamespace("archive", storage);
    const stale = first.open("slot-1");
    const winner = second.open("slot-1");
    await winner.save(state(2));
    await expect(stale.save(state(9))).rejects.toThrow(SaveConflictError);
    await expect(stale.save(state(9))).rejects.toThrow(/expected revision null, found 1/);

    const staleDelete = BrowserSaveConnection.forNamespace("archive", storage);
    await winner.save(state(3));
    await expect(staleDelete.deleteSlot("slot-1")).rejects.toThrow(
      /expected revision 1, found 2/,
    );
    expect((await second.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [3],
    });
  });

  it("does not silently take over a slot another tab owns until told to", async () => {
    const storage = new MemoryStorage();
    const mine = BrowserSaveConnection.forNamespace("archive", storage).open("slot-1");
    const otherTab = BrowserSaveConnection.forNamespace("archive", storage).open("slot-1");
    await mine.save(state(1));
    await otherTab.save(state(50)).catch(() => {});
    await otherTab.adoptStoredRevision();
    await otherTab.save(state(50));

    // The tab that lost the race keeps failing rather than clobbering the winner...
    await expect(mine.save(state(2))).rejects.toThrow(SaveConflictError);
    expect((await BrowserSaveConnection.forNamespace("archive", storage)
      .loadSlotState("slot-1"))?.player.party).toEqual({ kind: "standalone-levels", levels: [50] });

    // ...until the player explicitly chooses to take the slot over.
    await mine.adoptStoredRevision();
    await mine.save(state(2));
    expect((await BrowserSaveConnection.forNamespace("archive", storage)
      .loadSlotState("slot-1"))?.player.party).toEqual({ kind: "standalone-levels", levels: [2] });
  });

  it("retains the revision each write replaced and can roll back to it", async () => {
    const storage = new MemoryStorage();
    const connection = BrowserSaveConnection.forNamespace("archive", storage);
    const session = connection.open("slot-1");
    await session.save(state(10));
    expect(connection.previousRevision("slot-1")).toBeUndefined();

    await session.save(state(11));
    expect(connection.previousRevision("slot-1")).toMatchObject({
      revision: 1,
      state: { player: { party: { kind: "standalone-levels", levels: [10] } } },
    });

    await connection.restorePreviousRevision("slot-1");
    expect((await connection.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [10],
    });
    // A rollback is itself undoable exactly once: what it replaced becomes the new undo point.
    expect(connection.previousRevision("slot-1")).toMatchObject({
      state: { player: { party: { kind: "standalone-levels", levels: [11] } } },
    });
    expect(connection.summary("slot-1")?.revision).toBe(3);
  });

  it("drops the rollback copy rather than the save when storage is full", async () => {
    const storage = new MemoryStorage();
    const connection = BrowserSaveConnection.forNamespace("archive", storage);
    const session = connection.open("slot-1");
    await session.save(state(10));
    storage.rejectKeys = /:previous$/;

    await expect(session.save(state(11))).resolves.toBeUndefined();
    expect((await connection.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [11],
    });
    expect(connection.previousRevision("slot-1")).toBeUndefined();
  });

  it("reports a full origin as a typed quota failure", async () => {
    const storage = new MemoryStorage();
    const connection = BrowserSaveConnection.forNamespace("archive", storage);
    storage.rejectKeys = /slot-1/;
    await expect(connection.open("slot-1").save(state(1))).rejects.toThrow(SaveQuotaError);
  });

  it("clears disposable archive storage and retries a save exactly once on quota", async () => {
    const storage = new MemoryStorage();
    storage.rejectKeys = /slot-1/;
    let releases = 0;
    const connection = BrowserSaveConnection.forNamespace("archive", storage, async () => {
      releases++;
      storage.rejectKeys = undefined;
      return true;
    });

    await expect(connection.open("slot-1").save(state(12))).resolves.toBeUndefined();
    expect(releases).toBe(1);
    expect((await connection.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [12],
    });
  });

  it("preserves the save quota error when disposable cleanup cannot release space", async () => {
    const storage = new MemoryStorage();
    storage.rejectKeys = /slot-1/;
    let releases = 0;
    const connection = BrowserSaveConnection.forNamespace("archive", storage, async () => {
      releases++;
      throw new Error("IndexedDB unavailable");
    });

    await expect(connection.open("slot-1").save(state(1))).rejects.toThrow(SaveQuotaError);
    expect(releases).toBe(1);
  });

  it("does not let flush certify a failed latest write", async () => {
    const storage = new MemoryStorage();
    const session = BrowserSaveConnection.forNamespace("archive", storage).open("slot-1");
    await session.save(state(1));
    storage.rejectKeys = /slot-1/;
    void session.save(state(2)).catch(() => {});

    await expect(session.flush()).rejects.toThrow(SaveQuotaError);
  });

  it("erases the retained revision along with the slot", async () => {
    const storage = new MemoryStorage();
    const connection = BrowserSaveConnection.forNamespace("archive", storage);
    const session = connection.open("slot-1");
    await session.save(state(1));
    await session.save(state(2));
    expect(connection.previousRevision("slot-1")).toBeDefined();

    await connection.deleteSlot("slot-1");
    expect(connection.previousRevision("slot-1")).toBeUndefined();
    expect([...storage.values.keys()].filter((key) => key.includes("slot-1"))).toEqual([]);
  });

  it("deletes one slot without disturbing the others", async () => {
    const storage = new MemoryStorage();
    const connection = BrowserSaveConnection.forNamespace("archive", storage);
    await connection.open("slot-1").save(state(1));
    await connection.open("slot-2").save(state(2));
    await connection.deleteSlot("slot-1");
    expect(connection.summary("slot-1")).toBeUndefined();
    expect(connection.summary("slot-2")?.revision).toBe(1);
  });

  it("fails loudly on corrupt envelopes", () => {
    const storage = new MemoryStorage();
    storage.setItem("dib-save-v1:archive:slot-1", "not-json");
    expect(() => BrowserSaveConnection.forNamespace("archive", storage)).toThrow(/invalid JSON/);
  });

  it("reads a v6 schema-1 slot and lazily promotes it to v7 on first write", async () => {
    const storage = new MemoryStorage();
    const v6 = BrowserSaveConnection.forNamespace(namespace(fingerprint.previousV6), storage);
    await v6.open("slot-1").save(state(6));
    const current = BrowserSaveConnection.forContent(fingerprint, storage);
    expect((await current.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [6],
    });
    await current.open("slot-1").save(state(7));
    expect(storage.values.has(liveKey(fingerprint.previousV6, "slot-1"))).toBe(false);
    expect(storage.values.has(liveKey(fingerprint, "slot-1"))).toBe(true);
  });

  it("reads and promotes a v6 schema-2 slot only when its claim list is empty", async () => {
    const storage = new MemoryStorage();
    const v6 = BrowserSaveConnection.forNamespace(namespace(fingerprint.previousV6), storage);
    await v6.open("slot-1").save(stateWithClaims(6, []));

    const current = BrowserSaveConnection.forContent(fingerprint, storage);
    expect((await current.loadSlotState("slot-1"))?.player.schemaVersion).toBe(2);
    await current.open("slot-1").save(stateWithClaims(7, ["CollectionQuestBase1"]));

    expect(storage.values.has(liveKey(fingerprint.previousV6, "slot-1"))).toBe(false);
    expect(storage.values.has(liveKey(fingerprint, "slot-1"))).toBe(true);
  });

  it("surfaces v6 and older slots with claims as incompatible and preserves them", async () => {
    const storage = new MemoryStorage();
    const v6 = BrowserSaveConnection.forNamespace(namespace(fingerprint.previousV6), storage);
    const v2 = BrowserSaveConnection.forNamespace(namespace(fingerprint.previousV2), storage);
    await v6.open("slot-1").save(stateWithClaims(7, []));
    await v6.open("slot-1").save(stateWithClaims(8, ["CollectionQuestBase1"]));
    await v2.open("slot-3").save(stateWithClaims(9, ["CollectionQuestBase2"]));

    const current = BrowserSaveConnection.forContent(fingerprint, storage);
    expect(current.summary("slot-1")).toMatchObject({
      slotId: "slot-1",
      revision: 2,
      compatible: false,
    });
    expect(current.summary("slot-3")).toMatchObject({
      slotId: "slot-3",
      revision: 1,
      compatible: false,
    });
    expect(current.slots.map((slot) => slot.slotId)).toEqual(["slot-1", "slot-3"]);
    await expect(current.loadSlotState("slot-1")).resolves.toBeUndefined();
    await expect(current.loadSlotState("slot-3")).resolves.toBeUndefined();
    expect(current.previousRevision("slot-1")).toBeUndefined();
    await expect(current.open("slot-1").save(state(10))).rejects.toThrow(/incompatible/);
    expect(current.summary("slot-1")?.compatible).toBe(false);
    expect(current.summary("slot-3")?.compatible).toBe(false);

    await current.open("slot-2").save(state(10));
    await current.deleteSlot("slot-2");
    expect(storage.values.has(liveKey(fingerprint.previousV6, "slot-1"))).toBe(true);
    expect(storage.values.has(liveKey(fingerprint.previousV2, "slot-3"))).toBe(true);
  });

  it("lets a current v7 slot shadow an incompatible historical record", async () => {
    const storage = new MemoryStorage();
    await BrowserSaveConnection.forNamespace(namespace(fingerprint.previousV6), storage)
      .open("slot-1").save(stateWithClaims(6, ["CollectionQuestBase1"]));
    await BrowserSaveConnection.forNamespace(namespace(fingerprint), storage)
      .open("slot-1").save(stateWithClaims(11, ["CollectionQuestBase2"]));

    const current = BrowserSaveConnection.forContent(fingerprint, storage);
    expect(current.summary("slot-1")?.compatible).toBe(true);
    expect((await current.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [11],
    });
  });

  it("removes only eligible historical live and previous keys after promotion", async () => {
    const storage = new MemoryStorage();
    const v6 = BrowserSaveConnection.forNamespace(namespace(fingerprint.previousV6), storage);
    const v2 = BrowserSaveConnection.forNamespace(namespace(fingerprint.previousV2), storage);
    const v6Session = v6.open("slot-1");
    await v6Session.save(state(5));
    await v6Session.save(state(6));
    const v2Session = v2.open("slot-1");
    await v2Session.save(stateWithClaims(7, ["CollectionQuestBase1"]));
    await v2Session.save(stateWithClaims(8, ["CollectionQuestBase2"]));

    const current = BrowserSaveConnection.forContent(fingerprint, storage);
    expect((await current.loadSlotState("slot-1"))?.player.party).toEqual({
      kind: "standalone-levels",
      levels: [6],
    });
    await current.open("slot-1").save(stateWithClaims(9, ["CollectionQuestBase3"]));

    expect(storage.values.has(liveKey(fingerprint.previousV6, "slot-1"))).toBe(false);
    expect(storage.values.has(`${liveKey(fingerprint.previousV6, "slot-1")}:previous`)).toBe(false);
    expect(storage.values.has(liveKey(fingerprint.previousV2, "slot-1"))).toBe(true);
    expect(storage.values.has(`${liveKey(fingerprint.previousV2, "slot-1")}:previous`)).toBe(true);
  });
});
