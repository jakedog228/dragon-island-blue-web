import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { importCodeModArchive } from "@dib/mod-kernel";
import type { CatalogMod } from "@dib/mod-kernel/catalog";
import { enableInstalledMod, installCatalogPlan, installedCatalogMods, planCatalogInstall, stageModSelectionForReload, takePendingModSelection, restorePendingModSelection } from "../src/content/communityClient.js";
import type { CachedModArchive, ModArchiveCacheBackend } from "../src/content/modArchiveCache.js";

afterEach(() => vi.unstubAllGlobals());
const owner = { id: "public-author", username: "Alice", displayName: "Alice", bio: "", website: "", revision: 1 };
async function fixture(id: string, dependencies: Record<string, string> = {}, manifest: Record<string, unknown> = {}) {
  const bytes = new Uint8Array(zipSync({ "manifest.json": strToU8(JSON.stringify({ schemaVersion: 4, id, version: "1.0.0", apiVersion: 4, mode: "offline", displayName: id, dependencies, entry: "main.js", ...manifest })), "main.js": strToU8("throw new Error('must never execute');") }));
  const pkg = await importCodeModArchive(bytes, `${id}.dibmod`);
  const mod: CatalogMod = { id, modId: id, source: "community", title: id, summary: "", description: "", tags: [], screenshots: [], author: owner, published: true, revision: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    releases: [{ digest: pkg.digest, version: "1.0.0", byteLength: bytes.length, dependencies, apiVersion: 4, createdAt: new Date().toISOString() }] };
  const cached: CachedModArchive = { schemaVersion: 1, digest: pkg.digest, archiveName: `${id}.dibmod`, modId: id, version: "1.0.0", displayName: id, byteLength: bytes.length, bytes: new Blob([bytes]), cachedAt: "now", lastUsedAt: "now" };
  return { bytes, pkg, mod, cached };
}
function storage() {
  const rows = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); } });
}
function cache(failSecond = false): ModArchiveCacheBackend & { rows: Map<string, CachedModArchive> } {
  const rows = new Map<string, CachedModArchive>();
  return { rows, supported: true, list: async () => [...rows.values()], store: async (entry) => {
    if (failSecond && rows.size === 1) throw new Error("quota exceeded"); rows.set(entry.digest, entry);
  }, delete: async (digest) => rows.delete(digest), clear: async () => { rows.clear(); return true; } };
}
describe("community installation", () => {
  it("carries exact selections, including disabling all mods, through a clean reload", async () => {
    const main = await fixture("test.main.mod"), backend = cache();
    const values = new Map<string, string>();
    const pending = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    await stageModSelectionForReload([new File([main.bytes], "main.dibmod")], backend, pending);
    const { digests, allowDeclaredConflicts } = takePendingModSelection(pending)!;
    expect(digests).toEqual([main.pkg.digest]); expect(allowDeclaredConflicts).toBe(false);
    expect(takePendingModSelection(pending)).toBeUndefined();
    expect((await restorePendingModSelection(digests, [...backend.rows.values()]))[0]?.name).toBe("main.dibmod");
    await expect(restorePendingModSelection(digests, [])).rejects.toThrow("no longer stored");
    await stageModSelectionForReload([], backend, pending);
    expect(takePendingModSelection(pending)).toEqual({ digests: [], allowDeclaredConflicts: false });
    // An explicit "load anyway" survives the reload; anything else in the object form is refused.
    await stageModSelectionForReload([new File([main.bytes], "main.dibmod")], backend, pending, { allowDeclaredConflicts: true });
    expect(takePendingModSelection(pending)).toEqual({ digests: [main.pkg.digest], allowDeclaredConflicts: true });
    pending.setItem("dib.mods.pending-selection.v1", JSON.stringify({ digests: [], allowDeclaredConflicts: false }));
    expect(() => takePendingModSelection(pending)).toThrow("invalid");
    pending.setItem("dib.mods.pending-selection.v1", JSON.stringify({ digests: [], allowDeclaredConflicts: true, extra: 1 }));
    expect(() => takePendingModSelection(pending)).toThrow("invalid");
  });
  it("plans required dependencies and refuses missing or incompatible dependencies", async () => {
    const dep = await fixture("test.shared.library"), main = await fixture("test.main.mod", { "test.shared.library": "^1.0.0" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(dep.mod))));
    const plan = await planCatalogInstall(main.mod, main.pkg.digest);
    expect(plan.map((entry) => entry.mod.modId)).toEqual([main.mod.modId, dep.mod.modId]);
    const bad = await fixture("test.other.mod", { "test.shared.library": "^2.0.0" });
    await expect(planCatalogInstall(bad.mod, bad.pkg.digest)).rejects.toThrow("not published");
  });
  it("verifies bytes, installs without execution, and keeps digest provenance", async () => {
    storage(); const main = await fixture("test.main.mod"); const backend = cache();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(main.bytes)));
    await installCatalogPlan([{ mod: main.mod, digest: main.pkg.digest }], backend);
    expect(backend.rows.size).toBe(1);
    expect(installedCatalogMods()[0]?.digest).toBe(main.pkg.digest);
    const changed = await fixture("test.fake.mod");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(changed.bytes)));
    await expect(installCatalogPlan([{ mod: main.mod, digest: main.pkg.digest }], backend)).rejects.toThrow(/match/);
  });
  it("rolls back newly stored bytes when a dependency hits storage quota", async () => {
    storage(); const dep = await fixture("test.shared.lib"), main = await fixture("test.main.mod", { "test.shared.lib": "*" }); const backend = cache(true);
    vi.stubGlobal("fetch", vi.fn(async (path: string) => new Response(path.includes(dep.pkg.digest) ? dep.bytes : main.bytes)));
    await expect(installCatalogPlan([{ mod: main.mod, digest: main.pkg.digest }, { mod: dep.mod, digest: dep.pkg.digest }], backend)).rejects.toThrow("quota");
    expect(backend.rows.size).toBe(0); expect(installedCatalogMods()).toEqual([]);
  });
  it("enables only the requested mod and its required dependencies", async () => {
    const dep = await fixture("test.shared.lib"), main = await fixture("test.main.mod", { "test.shared.lib": "*" }), unrelated = await fixture("test.other.mod");
    const files = await enableInstalledMod([], [main.cached, dep.cached, unrelated.cached], main.pkg.digest);
    expect(files.map((file) => file.name)).toEqual(["test.main.mod.dibmod", "test.shared.lib.dibmod"]);
    await expect(enableInstalledMod([], [main.cached], main.pkg.digest)).rejects.toThrow("Install test.shared.lib");
  });
  it("co-enables a declared conflict only when the player insists", async () => {
    const left = await fixture("test.left.mod"), right = await fixture("test.right.mod", {}, { conflicts: { "test.left.mod": "*" } });
    const cached = [left.cached, right.cached];
    const leftOnly = await enableInstalledMod([], cached, left.pkg.digest);
    await expect(enableInstalledMod(leftOnly, cached, right.pkg.digest)).rejects.toThrow("declares a conflict with");
    const both = await enableInstalledMod(leftOnly, cached, right.pkg.digest, { allowDeclaredConflicts: true });
    expect(both.map((file) => file.name).sort()).toEqual(["test.left.mod.dibmod", "test.right.mod.dibmod"]);
  });
});
