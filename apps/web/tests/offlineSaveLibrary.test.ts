import { describe, expect, it } from "vitest";
import { BrowserSaveConnection } from "../src/player/browserSaveClient.js";
import { OfflineSaveLibrary, OFFLINE_LIBRARY_KEY, offlineSaveName } from "../src/player/offlineSaveLibrary.js";
import { rememberPlayProfile, type PlayProfileModRef } from "../src/content/playProfiles.js";
import { SaveConflictError, SaveQuotaError } from "../src/player/saveErrors.js";
import type { PlayerGameStateSnapshot } from "../src/player/gameState.js";

class Storage {
  readonly values = new Map<string, string>();
  reject: RegExp | undefined;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    if (this.reject?.test(key)) throw new DOMException("Full", "QuotaExceededError");
    this.values.set(key, value);
  }
  removeItem(key: string) { this.values.delete(key); }
}
function state(level: number): PlayerGameStateSnapshot {
  return { schemaVersion: 1, player: { schemaVersion: 1,
    profile: { schemaVersion: 1, heroLevel: level } as never,
    party: { kind: "standalone-levels", levels: [level] } } };
}
const mod = (id: string): PlayProfileModRef => ({
  id, digest: id.repeat(64), version: "1.0.0", displayName: id, byteLength: undefined,
});
async function seed(storage: Storage, namespace: string, slot: "slot-1" | "slot-2" | "slot-3", level = 4) {
  const session = BrowserSaveConnection.forNamespace(namespace, storage).open(slot);
  await session.save(state(level));
  return session;
}
const level = (value: PlayerGameStateSnapshot | undefined) =>
  value?.player.profile.schemaVersion === 1 ? value.player.profile.heroLevel : undefined;

describe("paged Offline saves", () => {
  it("migrates all old namespaces, dismissed profiles, gaps and rollback bytes without rewriting them", async () => {
    const storage = new Storage();
    for (const version of [1, 2, 3, 4, 5, 6, 7]) {
      const session = await seed(storage, `SHA-256:dib-identity-plists-v${version}:data`, "slot-2", version);
      await session.save(state(version + 10));
    }
    storage.setItem("dib.playProfiles.dismissed.v1", JSON.stringify(["SHA-256:dib-identity-plists-v1:data"]));
    const before = new Map(storage.values);
    const library = new OfflineSaveLibrary(storage, "new-data", []);
    expect(library.pageCount).toBe(7);
    for (let page = 0; page < 7; page++) {
      library.selectPage(page);
      expect(library.summary("slot-1")).toBeUndefined();
      expect(level(await library.loadSlotState("slot-2"))).toBe(page + 11);
      expect(level(library.previousRevision("slot-2")?.state)).toBe(page + 1);
    }
    for (const [key, value] of before) expect(storage.getItem(key)).toBe(value);
    expect(new OfflineSaveLibrary(storage, "new-data", []).pageCount).toBe(7);
  });

  it("keeps more than three saves across reload, content changes and selected-page changes", async () => {
    const storage = new Storage();
    const library = new OfflineSaveLibrary(storage, "content", []);
    await library.open("slot-1").save(state(5));
    library.addPage();
    await library.open("slot-3").save(state(9));
    const reload = new OfflineSaveLibrary(storage, "different-content", [mod("a")]);
    expect(reload.page).toBe(1);
    expect(level(await reload.loadSlotState("slot-3"))).toBe(9);
    expect(reload.warning("slot-3")).toContain("Different mods");
    reload.selectPage(0);
    expect(level(await reload.loadSlotState("slot-1"))).toBe(5);
    expect(reload.warning("slot-2")).toBeUndefined();
  });

  it("uses old profile mods as migration evidence, including exact package order", async () => {
    const storage = new Storage();
    await seed(storage, "old", "slot-1");
    rememberPlayProfile(storage, { namespace: "old", archiveName: "Game.ipa", archiveDigest: "f".repeat(64),
      archiveByteLength: undefined, mods: [mod("a"), mod("b")] });
    const library = new OfflineSaveLibrary(storage, "old", [mod("b"), mod("a")]);
    expect(library.entry("slot-1").name).toContain("Game");
    expect(library.warning("slot-1")).toContain("Different mods");
    const before = storage.getItem(OFFLINE_LIBRARY_KEY);
    await library.loadSlotState("slot-1"); // browsing / export is not playing
    library.previousRevision("slot-1");
    expect(storage.getItem(OFFLINE_LIBRARY_KEY)).toBe(before);
    library.open("slot-1", (await library.loadSlotState("slot-1"))!);
    expect(library.warning("slot-1")).toBeUndefined();
    expect(new OfflineSaveLibrary(storage, "old", [mod("a"), mod("b")]).warning("slot-1"))
      .toContain("Different mods");
  });

  it("does not attribute one slot's play to other slots on the page", async () => {
    const storage = new Storage();
    await seed(storage, "old", "slot-1");
    await seed(storage, "old", "slot-2");
    const library = new OfflineSaveLibrary(storage, "old", []);
    expect(library.warning("slot-1")).toContain("unknown");
    await library.open("slot-1").load();
    expect(library.warning("slot-1")).toBeUndefined();
    expect(library.warning("slot-2")).toContain("unknown");
  });

  it("moves stable addresses across pages, preserving names, revisions, mods and undo history", async () => {
    const storage = new Storage();
    const library = new OfflineSaveLibrary(storage, "data", [mod("a")]);
    const session = library.open("slot-1");
    await session.save(state(7));
    await session.save(state(8));
    library.rename("slot-1", "My dragon");
    const original = library.entry("slot-1");
    library.addPage();
    library.selectPage(0);
    library.move("slot-1", 5);
    expect(library.page).toBe(1);
    expect(library.entry("slot-3")).toEqual(original);
    expect(library.summary("slot-3")?.revision).toBe(2);
    expect(level(library.previousRevision("slot-3")?.state)).toBe(7);
    await session.save(state(9)); // captured before reordering
    expect(level(await library.loadSlotState("slot-3"))).toBe(9);
    expect(library.summary("slot-1")).toBeUndefined();
  });

  it("merges metadata with another tab's edits without redirecting active sessions", async () => {
    const storage = new Storage();
    const first = new OfflineSaveLibrary(storage, "data", []);
    const session = first.open("slot-1");
    await session.save(state(1));
    const second = new OfflineSaveLibrary(storage, "data", []);
    second.rename("slot-1", "Other tab name");
    second.addPage();
    second.selectPage(0);
    second.move("slot-1", 4);
    await session.save(state(2));
    const reload = new OfflineSaveLibrary(storage, "data", []);
    expect(reload.page).toBe(1);
    expect(reload.entry("slot-2").name).toBe("Other tab name");
    expect(level(await reload.loadSlotState("slot-2"))).toBe(2);
  });

  it("retains optimistic conflict checks for active saves", async () => {
    const storage = new Storage();
    const first = new OfflineSaveLibrary(storage, "data", []);
    const second = new OfflineSaveLibrary(storage, "data", []);
    const one = first.open("slot-1");
    const two = second.open("slot-1");
    await one.save(state(3));
    await expect(two.save(state(4))).rejects.toBeInstanceOf(SaveConflictError);
    await expect(two.flush()).rejects.toBeInstanceOf(SaveConflictError);
    expect(level(await first.loadSlotState("slot-1"))).toBe(3);
  });

  it("isolates unreadable saves while preserving the original bytes", async () => {
    const storage = new Storage();
    await seed(storage, "old", "slot-2");
    storage.setItem("dib-save-v1:old:slot-1", "broken");
    const library = new OfflineSaveLibrary(storage, "data", []);
    expect(library.summary("slot-1")?.compatible).toBe(false);
    expect(level(await library.loadSlotState("slot-2"))).toBe(4);
    expect(storage.getItem("dib-save-v1:old:slot-1")).toBe("broken");
  });

  it("imports names without changing game state; import and rollback have unknown mod history", async () => {
    const storage = new Storage();
    const library = new OfflineSaveLibrary(storage, "data", [mod("a")]);
    await library.open("slot-1").save(state(3));
    await library.importSave("slot-1", state(8), "My expedition");
    expect(library.entry("slot-1").name).toBe("My expedition");
    expect(library.warning("slot-1")).toContain("unknown");
    expect(level(await library.loadSlotState("slot-1"))).toBe(8);
    await library.restorePreviousRevision("slot-1");
    expect(level(await library.loadSlotState("slot-1"))).toBe(3);
    expect(library.warning("slot-1")).toContain("unknown");
    await library.deleteSlot("slot-1");
    expect(library.summary("slot-1")).toBeUndefined();
    expect(library.previousRevision("slot-1")).toBeUndefined();
    expect(new OfflineSaveLibrary(storage, "data", []).summary("slot-1")).toBeUndefined();
  });

  it("does not replace a malformed index or lose saves when migration exceeds quota", async () => {
    const storage = new Storage();
    await seed(storage, "old", "slot-1");
    const original = storage.getItem("dib-save-v1:old:slot-1");
    storage.reject = /offlineSaves/;
    expect(() => new OfflineSaveLibrary(storage, "data", [])).toThrow();
    expect(storage.getItem("dib-save-v1:old:slot-1")).toBe(original);
    storage.reject = undefined;
    const library = new OfflineSaveLibrary(storage, "data", []);
    storage.reject = /offlineSaves/;
    expect(() => library.addPage()).toThrow();
    expect(library.pageCount).toBe(1);
    storage.reject = undefined;
    storage.setItem(OFFLINE_LIBRARY_KEY, '{"schemaVersion":99,"entries":[]}');
    expect(() => new OfflineSaveLibrary(storage, "data", [])).toThrow(/preserved/);
    expect(storage.getItem("dib-save-v1:old:slot-1")).toBe(original);
    expect(storage.getItem(OFFLINE_LIBRARY_KEY)).toContain("99");
  });

  it("still releases disposable cache under save pressure and reports failed writes", async () => {
    const storage = new Storage();
    let releases = 0;
    const library = new OfflineSaveLibrary(storage, "data", [], async () => {
      releases++; storage.reject = undefined; return true;
    });
    storage.reject = /^dib-save-v1:/;
    await library.open("slot-1").save(state(8));
    expect(releases).toBe(1);
    const noRecovery = new OfflineSaveLibrary(storage, "data", []);
    storage.reject = /^dib-save-v1:/;
    const session = noRecovery.open("slot-1");
    await expect(session.save(state(9))).rejects.toBeInstanceOf(SaveQuotaError);
    await expect(session.flush()).rejects.toBeInstanceOf(SaveQuotaError);
    expect(level(await noRecovery.loadSlotState("slot-1"))).toBe(8);
  });

  it("sanitizes filename-only labels", () => {
    expect(offlineSaveName("  Boss/run:*  ")).toBe("Boss_run__");
    expect(offlineSaveName("CON")).toBe("_CON");
    expect(() => offlineSaveName("...")).toThrow();
    expect(offlineSaveName("a".repeat(100))).toHaveLength(80);
  });
});
