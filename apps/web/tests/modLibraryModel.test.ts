import { describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
import type { CatalogMod } from "@dib/mod-kernel/catalog";
import { disableSelectedMod, storeLocalMod } from "../src/content/communityClient.js";
import type { CachedModArchive, ModArchiveCacheBackend } from "../src/content/modArchiveCache.js";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import {
  brokenRules, buildLibrary, describeRule, formatBytes, formatRelative, isOverridableConflict, isWorkInProgress, LIBRARY_VIEW_KEY,
  listingState, listPhrase, missingDetails, moveInLoadOrder, orderOfPriorities, orderRules, pendingChanges, placeInLoadOrder,
  readLibraryView, writeLibraryView, type DevicePackage,
} from "../src/content/modLibraryModel.js";

const author = { id: "a", username: "alice", displayName: "Alice", bio: "", website: "", revision: 1 };
function listing(id: string, modId: string, versions: string[], source: "official" | "community" = "community"): CatalogMod {
  return { id, modId, source, title: `${modId} title`, summary: "", description: "", tags: [], screenshots: [], author, published: true, revision: 1,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
    releases: versions.map((version) => ({ version, digest: `${modId}@${version}`, byteLength: 10, createdAt: "2026-01-01T00:00:00Z", dependencies: {}, apiVersion: 4 })) };
}
const device = (modId: string, version: string): DevicePackage => ({ digest: `${modId}@${version}`, modId, version, displayName: modId, byteLength: 100 });

describe("mod library model", () => {
  it("labels installed versions individually instead of borrowing the latest release's neutrality", () => {
    const entries = buildLibrary({ device: [device("dev.a", "1.0.0"),
      { ...device("dev.a", "1.1.0"), saveCompatibility: "neutral" }],
      inventory: [], staged: [], applied: [], listings: [] });
    expect(entries[0]!.versions.map(version => version.saveCompatibility)).toEqual(["neutral", "dependent"]);
  });
  it("groups versions per mod, keeps provenance separate from local imports, and flags updates", () => {
    const library = buildLibrary({
      device: [device("dev.a", "1.0.0"), device("dev.a", "1.1.0"), device("dev.local", "0.1.0"), device("dev.off", "2.0.0")],
      inventory: [
        { listingId: "L-a", digest: "dev.a@1.0.0", modId: "dev.a", version: "1.0.0", displayName: "dev.a" },
        { listingId: "L-off", digest: "dev.off@2.0.0", modId: "dev.off", version: "2.0.0", displayName: "dev.off", source: "official" },
        { listingId: "L-gone", digest: "dev.gone@1.0.0", modId: "dev.gone", version: "1.0.0", displayName: "dev.gone" },
      ],
      staged: [{ modId: "dev.a", digest: "dev.a@1.1.0" }],
      applied: [{ modId: "dev.a", digest: "dev.a@1.0.0" }],
      listings: [listing("L-a", "dev.a", ["1.2.0", "1.1.0", "1.0.0"]), listing("L-off", "dev.off", ["2.0.0"], "official")],
    });
    const byId = Object.fromEntries(library.map((entry) => [entry.modId, entry]));
    expect(byId["dev.a"]).toMatchObject({ origin: "community", stagedDigest: "dev.a@1.1.0", appliedDigest: "dev.a@1.0.0", displayName: "dev.a title" });
    expect(byId["dev.a"]!.versions.map((version) => version.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(byId["dev.a"]!.update?.version).toBe("1.2.0");
    expect(byId["dev.off"]).toMatchObject({ origin: "official", update: undefined });
    expect(byId["dev.local"]).toMatchObject({ origin: "local", listingId: undefined });
    // Evicted bytes stay visible so the player can download them again.
    expect(byId["dev.gone"]!.versions).toEqual([{ digest: "dev.gone@1.0.0", version: "1.0.0", byteLength: 0, stored: false, saveCompatibility: "dependent" }]);
  });
  it("derives one primary action per listing", () => {
    const mod = listing("L-a", "dev.a", ["1.1.0", "1.0.0"]);
    const library = (stored: string[], staged?: string) => buildLibrary({ device: stored.map((version) => device("dev.a", version)),
      inventory: [], staged: staged ? [{ modId: "dev.a", digest: `dev.a@${staged}` }] : [], applied: [], listings: [] });
    expect(listingState(mod, library([]))).toBe("available");
    expect(listingState(mod, library(["1.0.0"]))).toBe("update");
    expect(listingState(mod, library(["1.1.0"]))).toBe("installed");
    expect(listingState(mod, library(["1.1.0"], "1.1.0"))).toBe("enabled");
    // Holding a newer local build than the catalog is not an update.
    expect(listingState(mod, library(["2.0.0"]))).toBe("installed");
  });
  it("counts changed mods between the staged and applied selections", () => {
    expect(pendingChanges([], [])).toBe(0);
    expect(pendingChanges([{ modId: "a", digest: "1" }], [{ modId: "a", digest: "1" }])).toBe(0);
    expect(pendingChanges([{ modId: "a", digest: "2" }, { modId: "b", digest: "1" }], [{ modId: "a", digest: "1" }, { modId: "c", digest: "1" }])).toBe(3);
  });
  it("formats stable presentation values", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1048576)).toBe("3.0 MB");
    const now = Date.parse("2026-09-10T00:00:00Z");
    expect(formatRelative("2026-09-09T23:59:30Z", now)).toBe("just now");
    expect(formatRelative("2026-09-07T00:00:00Z", now)).toBe("3 days ago");
  });
  it("rewrites the whole load order when one mod moves, and refuses moves off the list", () => {
    expect(moveInLoadOrder(["a", "b", "c"], "c", -1)).toEqual({ a: 0, c: 10, b: 20 });
    expect(moveInLoadOrder(["a", "b", "c"], "a", 1)).toEqual({ b: 0, a: 10, c: 20 });
    expect(moveInLoadOrder(["a", "b"], "a", -1)).toBeUndefined();
    expect(moveInLoadOrder(["a", "b"], "b", 1)).toBeUndefined();
    expect(moveInLoadOrder(["a"], "missing", 1)).toBeUndefined();
  });
  it("drops a mod anywhere in the order as explicit priorities the kernel resolves in that order", async () => {
    expect(placeInLoadOrder(["a", "b", "c", "d"], "d", 0)).toEqual({ d: 0, a: 10, b: 20, c: 30 });
    expect(placeInLoadOrder(["a", "b", "c", "d"], "a", 2)).toEqual({ b: 0, c: 10, a: 20, d: 30 });
    for (const index of [0, 2, -1, 0.5]) expect(placeInLoadOrder(["a", "b"], "a", index)).toBeUndefined();
    expect(placeInLoadOrder(["a", "b"], "missing", 0)).toBeUndefined();
    expect(orderOfPriorities({ c: 10, b: 0, a: 10 })).toEqual(["b", "a", "c"]);
    const packages = await Promise.all(["dev.a", "dev.b", "dev.c"].map(async (id) => importCodeModArchive(new Uint8Array(await pkg(id).arrayBuffer()), id)));
    const dropped = placeInLoadOrder(["dev.a", "dev.b", "dev.c"], "dev.c", 0)!;
    const profile = await resolveCodeModProfile(packages, { priorityOverrides: dropped });
    expect(profile.packages.map((entry) => entry.manifest.id)).toEqual(orderOfPriorities(dropped));
  });
  it("lists declared ordering rules, which ones a requested order breaks, and why", async () => {
    const none = { dependencies: {}, optionalDependencies: {}, loadAfter: [], loadBefore: [] };
    const rules = orderRules([
      { ...none, id: "rt", loadAfter: ["dev", "absent"] },
      { ...none, id: "dev" },
      { ...none, id: "add", dependencies: { dev: "*" }, loadBefore: ["v1"] },
      { ...none, id: "v1", optionalDependencies: { dev: "^1.0.0" }, loadAfter: ["dev"] },
    ]);
    // Relations to unselected mods are inert, and a pair is reported once (by its first declaration).
    expect(rules).toEqual([
      { before: "dev", after: "rt", reason: "loadAfter", declaredBy: "rt" },
      { before: "dev", after: "add", reason: "dependency", declaredBy: "add" },
      { before: "add", after: "v1", reason: "loadBefore", declaredBy: "add" },
      { before: "dev", after: "v1", reason: "optional", declaredBy: "v1" },
    ]);
    expect(brokenRules(rules, ["dev", "add", "v1", "rt"])).toEqual([]);
    expect(brokenRules(rules, ["rt", "dev", "v1", "add"]).map((rule) => `${rule.before}<${rule.after}`)).toEqual(["dev<rt", "add<v1"]);
    expect(rules.map((rule) => describeRule(rule, (id) => id.toUpperCase()))).toEqual([
      "RT asks to load after DEV", "ADD needs DEV, so it loads after it", "ADD asks to load before V1", "V1 works with DEV and loads after it"]);
    // A drop that breaks a rule is exactly one the kernel refuses to follow.
    const late = await importCodeModArchive(new Uint8Array(await pkg("dev.late", {}, { loadAfter: ["dev.early"] }).arrayBuffer()), "late");
    const early = await importCodeModArchive(new Uint8Array(await pkg("dev.early").arrayBuffer()), "early");
    const requested = placeInLoadOrder(["dev.early", "dev.late"], "dev.late", 0)!;
    const resolved = await resolveCodeModProfile([late, early], { priorityOverrides: requested });
    expect(resolved.packages.map((entry) => entry.manifest.id)).toEqual(["dev.early", "dev.late"]);
    expect(brokenRules(orderRules([late.manifest, early.manifest]), orderOfPriorities(requested))).toHaveLength(1);
  });
  it("flags work-in-progress tags and names what a details page has nothing to show for", () => {
    expect(isWorkInProgress(["Battle", "Work in progress"])).toBe(true);
    expect(isWorkInProgress([" WIP "])).toBe(true);
    expect(isWorkInProgress(["work-in-progress"])).toBe(true);
    expect(isWorkInProgress(["Progress", "Battle", "WIPE"])).toBe(false);
    // An imported file has only a manifest; a listing lacks what its author left out.
    expect(missingDetails({ description: undefined, screenshots: 0, tags: 0, author: false })).toEqual(["description", "screenshots", "author", "tags"]);
    expect(missingDetails({ description: " ", screenshots: 2, tags: 1, author: true, releases: 0 })).toEqual(["description", "downloadable release"]);
    expect(missingDetails({ description: "x", screenshots: 1, tags: 1, author: true, releases: 1 })).toEqual([]);
    expect([listPhrase([]), listPhrase(["a"]), listPhrase(["a", "b"]), listPhrase(["a", "b", "c"], "and")]).toEqual(["", "a", "a or b", "a, b and c"]);
  });
  it("remembers the grid/list layout per device and survives blocked storage", () => {
    const rows = new Map<string, string>();
    const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } };
    expect(readLibraryView(storage)).toBe("grid");
    writeLibraryView(storage, "list");
    expect(rows.get(LIBRARY_VIEW_KEY)).toBe("list");
    expect(readLibraryView(storage)).toBe("list");
    const blocked = { getItem: (): string => { throw new Error("denied"); }, setItem: (): void => { throw new Error("denied"); } };
    expect(readLibraryView(blocked)).toBe("grid");
    expect(() => writeLibraryView(blocked, "list")).not.toThrow();
    expect(readLibraryView(undefined)).toBe("grid");
  });
});

function pkg(id: string, dependencies: Record<string, string> = {}, manifest: Record<string, unknown> = {}): File {
  const bytes = zipSync({ "manifest.json": strToU8(JSON.stringify({ schemaVersion: 4, id, version: "1.0.0", apiVersion: 4, mode: "offline", displayName: id, dependencies, entry: "main.js", ...manifest })),
    "main.js": strToU8("throw new Error('must never execute');") });
  return new File([new Uint8Array(bytes)], `${id}.dibmod`);
}
describe("selection helpers", () => {
  it("treats only declared conflicts as something the player may override", async () => {
    const left = await importCodeModArchive(new Uint8Array(await pkg("dev.left").arrayBuffer()), "left.dibmod");
    const right = await importCodeModArchive(new Uint8Array(await pkg("dev.right", {}, { conflicts: { "dev.left": "*" } }).arrayBuffer()), "right.dibmod");
    const needy = await importCodeModArchive(new Uint8Array(await pkg("dev.needy", { "dev.absent": "*" }).arrayBuffer()), "needy.dibmod");
    const conflict = await resolveCodeModProfile([left, right]).catch((error: unknown) => error);
    expect(isOverridableConflict(conflict)).toBe(true);
    expect((await resolveCodeModProfile([left, right], { allowDeclaredConflicts: true })).packages).toHaveLength(2);
    expect(isOverridableConflict(await resolveCodeModProfile([needy]).catch((error: unknown) => error))).toBe(false);
    expect(isOverridableConflict(new Error("declares a conflict with x"))).toBe(false);
  });
  it("disables dependents transitively so the selection always resolves", async () => {
    const files = [pkg("dev.base"), pkg("dev.mid", { "dev.base": "*" }), pkg("dev.top", { "dev.mid": "*" }), pkg("dev.other")];
    const result = await disableSelectedMod(files, "dev.base");
    expect(result.files.map((file) => file.name)).toEqual(["dev.other.dibmod"]);
    expect(result.cascaded).toEqual(["dev.mid", "dev.top"]);
    expect((await disableSelectedMod(files, "dev.other")).cascaded).toEqual([]);
  });
  it("stores imported files once and reports when storage is unavailable", async () => {
    const rows = new Map<string, CachedModArchive>();
    const cache: ModArchiveCacheBackend = { supported: true, list: async () => [...rows.values()], store: async (row) => { rows.set(row.digest, row); },
      delete: async (digest) => rows.delete(digest), clear: async () => { rows.clear(); return true; } };
    const file = pkg("dev.local");
    const first = await storeLocalMod(file, cache);
    await storeLocalMod(file, cache);
    expect(first.stored).toBe(true);
    expect([...rows.values()].map((row) => row.modId)).toEqual(["dev.local"]);
    expect((await storeLocalMod(file, { ...cache, supported: false })).stored).toBe(false);
  });
});
