import { once } from "node:events";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogMod, CatalogPage, CatalogTag, CommunityInfo } from "@dib/mod-kernel/catalog";
import { CommunityHttp } from "../src/community.js";
import { createGameServer } from "../src/gameServer.js";
import { CatalogError, ModCatalog, parseCatalogQuery } from "../src/modCatalog.js";
import { creditedAuthor, loadOfficialMods, OFFICIAL_AUTHOR, officialListingId } from "../src/officialMods.js";
import { screenshot, zipMod } from "./helpers/communityFixtures.js";

const dirs: string[] = [], servers: ReturnType<typeof createGameServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function officialDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dib-official-")); dirs.push(dir);
  await writeFile(join(dir, "trail-1.dibmod"), zipMod("dev.official.trail", "1.0.0"));
  await writeFile(join(dir, "trail-2.dibmod"), zipMod("dev.official.trail", "1.2.0"));
  await writeFile(join(dir, "trail-2.listing.json"), JSON.stringify({ title: "Wand Trail", description: "Sparkles follow the pointer. Great for streams.\nMore detail.", tags: ["Presentation"], screenshots: ["trail.png"] }));
  await writeFile(join(dir, "trail-1.listing.json"), JSON.stringify({ title: "Old title" }));
  await writeFile(join(dir, "trail.png"), screenshot());
  await writeFile(join(dir, "tools.dibmod"), zipMod("dev.official.tools", "0.1.0"));
  await writeFile(join(dir, "tools.listing.json"), JSON.stringify({ author: "wolfs0", summary: "  Hand-written card line.  ", description: "Long form. Not the card line." }));
  await writeFile(join(dir, "notes.txt"), "ignored");
  return dir;
}
describe("official mods", () => {
  it("groups releases by manifest id, newest first, with the newest sidecar and sanitized screenshots", async () => {
    const mods = await loadOfficialMods(await officialDir());
    expect(mods.map((mod) => mod.view.modId).sort()).toEqual(["dev.official.tools", "dev.official.trail"]);
    const trail = mods.find((mod) => mod.view.modId === "dev.official.trail")!.view;
    expect(trail).toMatchObject({ id: officialListingId("dev.official.trail"), source: "official", title: "Wand Trail",
      summary: "Sparkles follow the pointer.", tags: ["Presentation"], published: true, author: OFFICIAL_AUTHOR });
    expect(trail.releases.map((release) => release.version)).toEqual(["1.2.0", "1.0.0"]);
    expect(trail.screenshots).toHaveLength(1);
    expect(officialListingId("dev.official.trail")).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
    // A sidecar without a title falls back to the manifest's display name; an explicit summary
    // replaces the derived first sentence on cards.
    const tools = mods.find((mod) => mod.view.modId === "dev.official.tools")!.view;
    expect(tools).toMatchObject({ title: "Test mod", summary: "Hand-written card line.", description: "Long form. Not the card line." });
    // A credited listing is by its original author; the same name always maps to the same profile.
    expect(OFFICIAL_AUTHOR.displayName).toBe("DIB Web");
    expect(tools.author).toEqual(creditedAuthor("wolfs0"));
    expect(tools.author).toMatchObject({ displayName: "wolfs0", username: "wolfs0" });
    expect(creditedAuthor(" Wolfs0 ").id).toBe(tools.author.id);
    expect(tools.author.id).not.toBe(OFFICIAL_AUTHOR.id);
    expect(tools.author.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  });
  it("fails loudly on a malformed package, duplicate version or sidecar", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dib-official-bad-")); dirs.push(dir);
    await writeFile(join(dir, "bad.dibmod"), "not a zip");
    await expect(loadOfficialMods(dir)).rejects.toThrow("bad.dibmod is invalid");
    await rm(join(dir, "bad.dibmod"));
    await writeFile(join(dir, "a.dibmod"), zipMod("dev.official.a", "1.0.0"));
    await writeFile(join(dir, "b.dibmod"), zipMod("dev.official.a", "1.0.0"));
    await expect(loadOfficialMods(dir)).rejects.toThrow("twice");
    await rm(join(dir, "b.dibmod"));
    await writeFile(join(dir, "a.listing.json"), JSON.stringify({ title: "x", unknown: true }));
    await expect(loadOfficialMods(dir)).rejects.toThrow("listing.json");
    await writeFile(join(dir, "a.listing.json"), JSON.stringify({ summary: "x".repeat(161) }));
    await expect(loadOfficialMods(dir)).rejects.toThrow("summary?");
    for (const author of ["", "   ", "two\nlines", "x".repeat(61), 7]) {
      await writeFile(join(dir, "a.listing.json"), JSON.stringify({ author }));
      await expect(loadOfficialMods(dir)).rejects.toThrow("author?");
    }
    await writeFile(join(dir, "a.listing.json"), JSON.stringify({ screenshots: ["../escape.png"] }));
    await expect(loadOfficialMods(dir)).rejects.toThrow("plain .png");
  });
  it("lists official beside community, filters, sorts, and reserves official mod IDs", async () => {
    const official = await loadOfficialMods(await officialDir());
    const directory = await mkdtemp(join(tmpdir(), "dib-catalog-mixed-")); dirs.push(directory);
    const catalog = new ModCatalog(directory, undefined, official);
    await catalog.profile("alice", "Alice");
    await expect(catalog.create("alice", { modId: "dev.official.trail", title: "Squat", description: "", tags: [] })).rejects.toThrow("reserved");
    const draft = await catalog.create("alice", { modId: "dev.alice.zeta", title: "Zeta", description: "Community thing", tags: ["presentation", "Battle"] });
    const uploaded = await catalog.upload("alice", draft.id, draft.revision, zipMod("dev.alice.zeta"));
    await catalog.edit("alice", draft.id, { title: "Zeta", description: "Community thing", tags: ["presentation", "Battle"], published: true, revision: uploaded.revision, screenshots: [] });

    expect((await catalog.list()).total).toBe(3);
    expect((await catalog.list({ source: "official" })).mods.map((mod) => mod.modId).sort()).toEqual(["dev.official.tools", "dev.official.trail"]);
    expect((await catalog.list({ source: "community" })).mods.map((mod) => mod.source)).toEqual(["community"]);
    expect((await catalog.list({ tag: "PRESENTATION" })).mods.map((mod) => mod.modId).sort()).toEqual(["dev.alice.zeta", "dev.official.trail"]);
    expect((await catalog.list({ author: OFFICIAL_AUTHOR.id })).mods.map((mod) => mod.modId)).toEqual(["dev.official.trail"]);
    expect((await catalog.list({ author: creditedAuthor("wolfs0").id })).mods.map((mod) => mod.modId)).toEqual(["dev.official.tools"]);
    expect((await catalog.list({ q: "sparkles" })).mods.map((mod) => mod.modId)).toEqual(["dev.official.trail"]);
    expect((await catalog.list({ q: "WOLFS0" })).mods.map((mod) => mod.modId)).toEqual(["dev.official.tools"]);
    expect((await catalog.list({ sort: "name" })).mods.map((mod) => mod.title)).toEqual(["Test mod", "Wand Trail", "Zeta"]);
    expect(await catalog.tags()).toEqual([{ tag: "Presentation", count: 2 }, { tag: "Battle", count: 1 }]);
    expect(await catalog.tags("community")).toEqual([{ tag: "Battle", count: 1 }, { tag: "presentation", count: 1 }]);
    expect((await catalog.lookup([draft.id, officialListingId("dev.official.tools"), "00000000-0000-4000-8000-000000000000"])).map((mod) => mod.modId).sort())
      .toEqual(["dev.alice.zeta", "dev.official.tools"]);
    expect((await catalog.byModId("dev.official.trail")).source).toBe("official");
    expect(await catalog.author(OFFICIAL_AUTHOR.id)).toEqual(OFFICIAL_AUTHOR);
    expect(await catalog.author(creditedAuthor("wolfs0").id)).toEqual(creditedAuthor("wolfs0"));
    await expect(catalog.author(creditedAuthor("nobody").id)).rejects.toThrow("Author not found");
    const trail = await catalog.get(officialListingId("dev.official.trail"));
    expect(await catalog.blob(trail.id, trail.releases[0]!.digest, false)).toEqual(zipMod("dev.official.trail", "1.2.0"));
    expect((await catalog.blob(trail.id, trail.screenshots[0]!, true)).subarray(0, 8)).toEqual(screenshot().subarray(0, 8));
    await expect(catalog.blob(trail.id, trail.releases[0]!.digest, true)).rejects.toThrow("not found");
    // Official listings never enter the writable catalog or its backups.
    await expect(catalog.edit("alice", trail.id, { title: "x", description: "", tags: [], published: false, revision: 1, screenshots: [] })).rejects.toThrow("not found");
  });
  it("publishes exactly the curated examples, each with a hand-written card summary", async () => {
    const examples = join(import.meta.dirname, "../../../examples/mods");
    const dir = await mkdtemp(join(tmpdir(), "dib-official-examples-")); dirs.push(dir);
    const summaries = new Map<string, string | undefined>();
    const published: string[] = [];
    for (const entry of await readdir(examples, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const listing = await readFile(join(examples, entry.name, "listing.json"), "utf8").catch(() => undefined);
      if (listing === undefined) continue;
      published.push(entry.name);
      const modId = `dev.example.${entry.name.replaceAll("-", "")}`;
      summaries.set(modId, (JSON.parse(listing) as { summary?: string }).summary);
      await writeFile(join(dir, `${entry.name}.dibmod`), zipMod(modId, "1.0.0"));
      await writeFile(join(dir, `${entry.name}.listing.json`), listing);
    }
    // A listing.json is what puts an example in the Official catalog (pnpm mods:examples).
    expect(published.sort()).toEqual(["devtools", "less-rare-monsters", "mercy-stone",
      "realtime-combat", "wand-pointer-trail"]);
    const mods = await loadOfficialMods(dir);
    expect(mods).toHaveLength(summaries.size);
    const byName = (name: string): CatalogMod => mods.find((mod) => mod.view.modId === `dev.example.${name.replaceAll("-", "")}`)!.view;
    expect(byName("realtime-combat")).toMatchObject({ title: "Realtime Combat (WIP)", tags: ["Work in progress", "Battle", "Overhaul"] });
    expect(byName("less-rare-monsters").author.displayName).toBe("wolfs0");
    for (const name of ["devtools", "mercy-stone", "wand-pointer-trail", "realtime-combat"]) {
      expect(byName(name).author).toEqual(OFFICIAL_AUTHOR);
    }
    for (const { view } of mods) {
      expect(view.title).not.toBe("Test mod");
      expect(view.description.length).toBeGreaterThan(0);
      expect(view.summary).toBe(summaries.get(view.modId));
      // Screenshots are generated into dist by `pnpm mods:examples`, never named in source.
      expect(view.screenshots).toEqual([]);
    }
  });
  it("parses public queries strictly", () => {
    expect(parseCatalogQuery(new URLSearchParams("q=abc&source=official&sort=name&tag=Battle&offset=24")))
      .toEqual({ q: "abc", source: "official", sort: "name", tag: "Battle", offset: 24 });
    for (const bad of ["source=mine", "sort=popular", "offset=-1", "author=alice"]) {
      expect(() => parseCatalogQuery(new URLSearchParams(bad))).toThrow(CatalogError);
    }
  });
  it("serves official mods without an author portal and refuses every private route", async () => {
    const official = await loadOfficialMods(await officialDir());
    const dir = await mkdtemp(join(tmpdir(), "dib-official-http-")); dirs.push(dir);
    await mkdir(join(dir, "community"));
    const community = new CommunityHttp({ directory: join(dir, "community"), accountDirectory: dir, hmacSecret: "test-secret-at-least-thirty-two-bytes",
      registrationEnabled: true, maxAccounts: 10, trustProxy: false, official });
    const server = createGameServer({ hmacSecret: "test-secret-at-least-thirty-two-bytes", services: [], isInvited: () => true, community });
    server.listen(0, "127.0.0.1"); servers.push(server); await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/community`;
    expect(await (await fetch(`${base}/info`)).json()).toEqual({ enabled: true, authorOrigin: "", registrationEnabled: false } satisfies CommunityInfo);
    const page = await (await fetch(`${base}/mods?source=official&sort=name`)).json() as CatalogPage;
    expect(page).toMatchObject({ total: 2, next: null });
    expect((await (await fetch(`${base}/tags?source=official`)).json() as { tags: CatalogTag[] }).tags).toEqual([{ tag: "Presentation", count: 1 }]);
    const trail = page.mods.find((mod) => mod.modId === "dev.official.trail")!;
    const lookup = await (await fetch(`${base}/mods/lookup?ids=${trail.id}`)).json() as { mods: CatalogMod[] };
    expect(lookup.mods.map((mod) => mod.id)).toEqual([trail.id]);
    expect((await fetch(`${base}/mods/lookup?ids=nope`)).status).toBe(400);
    expect((await fetch(`${base}/mods?sort=bogus`)).status).toBe(400);
    const image = await fetch(`${base}/mods/${trail.id}/image/${trail.screenshots[0]}`);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("cache-control")).toContain("immutable");
    const download = await fetch(`${base}/mods/${trail.id}/download/${trail.releases[0]!.digest}`);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(zipMod("dev.official.trail", "1.2.0"));
    expect(download.headers.get("cache-control")).toBe("no-store");
    for (const path of ["/session", "/accounts", "/me"]) {
      const response = await fetch(`${base}${path}`, { method: "POST", body: "{}" });
      expect(response.status).toBe(404);
    }
  });
});
