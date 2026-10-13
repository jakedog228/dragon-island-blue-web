import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipMod, screenshot, crc32 } from "./helpers/communityFixtures.js";
import { afterEach, describe, expect, it } from "vitest";
import { ModCatalog, sanitizePng } from "../src/modCatalog.js";

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "dib-catalog-")); dirs.push(directory);
  const catalog = new ModCatalog(directory, { authorBytes: 1024 ** 2, totalBytes: 4 * 1024 ** 2, minFreeBytes: 0 });
  await catalog.profile("alice", "Alice"); await catalog.profile("bob", "Bob");
  return { catalog, directory };
}
const fields = { modId: "test.author.mod", title: "A mod", description: "Test description", tags: ["Gameplay"] };
describe("community catalog", () => {
  it("makes a restorable snapshot and supports operator takedowns that authors cannot undo", async () => {
    const { catalog, directory } = await setup();
    const draft = await catalog.create("alice", fields);
    const uploaded = await catalog.upload("alice", draft.id, 1, zipMod());
    const published = await catalog.edit("alice", draft.id, { ...fieldsWithoutId(), published: true, revision: uploaded.revision, screenshots: [] });
    const destination = directory + "-snapshot"; dirs.push(destination);
    await catalog.backup(destination);
    expect(JSON.parse(await readFile(join(destination, "snapshot-complete.json"), "utf8")).blobs).toEqual([published.releases[0]!.digest]);
    const restored = new ModCatalog(destination);
    expect(await restored.blob(draft.id, published.releases[0]!.digest, false)).toEqual(zipMod());
    await catalog.moderate(draft.id, true);
    await expect(catalog.get(draft.id)).rejects.toThrow("not found");
    await expect(catalog.edit("alice", draft.id, { ...fieldsWithoutId(), published: true, revision: published.revision + 1, screenshots: [] })).rejects.toThrow("hidden by");
    await catalog.moderate(draft.id, false);
    await expect(catalog.get(draft.id)).rejects.toThrow("not found");
  });
  it("keeps drafts private, validates without executing, persists immutable releases and omits private ownership", async () => {
    const { catalog, directory } = await setup();
    const draft = await catalog.create("alice", fields);
    expect((await catalog.list()).mods).toEqual([]);
    await expect(catalog.get(draft.id)).rejects.toThrow("not found");
    const uploaded = await catalog.upload("alice", draft.id, draft.revision, zipMod());
    expect(uploaded.releases[0]?.version).toBe("1.0.0");
    const published = await catalog.edit("alice", draft.id, { ...fieldsWithoutId(), published: true, revision: uploaded.revision, screenshots: [] });
    const restarted = new ModCatalog(directory);
    expect((await restarted.list()).mods).toEqual([published]);
    expect(JSON.stringify(published)).not.toContain('"owner"');
    expect(published.author.id).not.toBe("alice");
    expect(await restarted.blob(draft.id, published.releases[0]!.digest, false)).toEqual(zipMod());
    await expect(catalog.upload("alice", draft.id, published.revision, zipMod())).rejects.toThrow("Version already exists");
    await expect(catalog.upload("bob", draft.id, published.revision, zipMod())).rejects.toThrow("not found");
  });
  it("serializes writers, rejects stale edits and reserves deleted IDs", async () => {
    const { catalog, directory } = await setup();
    const mod = await catalog.create("alice", fields);
    const other = new ModCatalog(directory);
    const results = await Promise.allSettled([catalog.edit("alice", mod.id, { ...fieldsWithoutId(), revision: 1, published: false, screenshots: [] }),
      other.edit("alice", mod.id, { ...fieldsWithoutId(), revision: 1, published: false, screenshots: [] })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    await expect(catalog.remove("bob", mod.id, 2)).rejects.toThrow("not found");
    await catalog.remove("alice", mod.id, 2);
    await expect(catalog.get(mod.id, "alice")).rejects.toThrow("not found");
    await expect(catalog.create("bob", fields)).rejects.toThrow("already reserved");
  });
  it("rejects invalid packages, forged media references, and publication without a release", async () => {
    const { catalog } = await setup(); const mod = await catalog.create("alice", fields);
    await expect(catalog.upload("alice", mod.id, 1, zipMod("test.other.mod"))).rejects.toThrow("Manifest ID");
    await expect(catalog.upload("alice", mod.id, 1, Buffer.from("not a zip"))).rejects.toThrow("Invalid .dibmod");
    await expect(catalog.edit("alice", mod.id, { ...fieldsWithoutId(), revision: 1, published: true, screenshots: [] })).rejects.toThrow("Upload a release");
    await expect(catalog.edit("alice", mod.id, { ...fieldsWithoutId(), revision: 1, published: false, screenshots: ["a".repeat(64)] })).rejects.toThrow("Invalid screenshot");
  });
  it("enforces quota without committing a release and preserves profile privacy", async () => {
    const { catalog, directory } = await setup(); const mod = await catalog.create("alice", fields);
    const tiny = new ModCatalog(directory, { authorBytes: 5, totalBytes: 10, minFreeBytes: 0 });
    await expect(tiny.upload("alice", mod.id, 1, zipMod())).rejects.toThrow("quota");
    expect((await catalog.get(mod.id, "alice")).releases).toEqual([]);
    await expect(catalog.author(mod.author.id)).rejects.toThrow("not found");
    await expect(catalog.editProfile("alice", { displayName: "Alice", bio: "", website: "javascript:alert(1)", revision: 1 })).rejects.toThrow("HTTPS");
    await catalog.editProfile("alice", { displayName: "A", bio: "About", website: "https://example.com", revision: 1 });
    expect((await catalog.get(mod.id, "alice")).author.bio).toBe("About");
    expect(await readFile(join(directory, "catalog.json"), "utf8")).not.toContain("loginToken");
  });
  it("sanitizes screenshots and rejects corrupt CRC, HTML and oversized decoded dimensions", async () => {
    const png = screenshot(); const clean = sanitizePng(png);
    expect(clean.includes(Buffer.from("private metadata"))).toBe(false);
    expect(sanitizePng(clean)).toEqual(clean);
    const corrupt = Buffer.from(png); corrupt[45] = corrupt[45]! ^ 1;
    expect(() => sanitizePng(corrupt)).toThrow("valid RGB");
    expect(() => sanitizePng(Buffer.from("<svg></svg>"))).toThrow("valid RGB");
    const huge = Buffer.from(png); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(crc32(huge.subarray(12, 29)), 29);
    expect(() => sanitizePng(huge)).toThrow("valid RGB");
    const { catalog } = await setup(); const mod = await catalog.create("alice", fields);
    const uploaded = await catalog.upload("alice", mod.id, 1, png, true);
    expect(await catalog.blob(mod.id, uploaded.screenshots[0]!, true, "alice")).toEqual(clean);
    await expect(catalog.blob(mod.id, uploaded.screenshots[0]!, true)).rejects.toThrow("not found");
  });
});
function fieldsWithoutId() { return { title: fields.title, description: fields.description, tags: fields.tags }; }
