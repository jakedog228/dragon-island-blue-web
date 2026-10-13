import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CatalogPage, CommunityInfo } from "@dib/mod-kernel/catalog";
import { createCatalogOnlyServer } from "../src/devCatalog.js";
import { loadOfficialMods } from "../src/officialMods.js";
import { zipMod } from "./helpers/communityFixtures.js";

const dirs: string[] = [], servers: ReturnType<typeof createCatalogOnlyServer>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("development catalog server", () => {
  it("serves official mods read-only and never answers as an Online server", async () => {
    const official = await mkdtemp(join(tmpdir(), "dib-dev-official-")); dirs.push(official);
    await writeFile(join(official, "trail.dibmod"), zipMod("dev.official.trail", "1.0.0"));
    await writeFile(join(official, "trail.listing.json"), JSON.stringify({ title: "Wand Trail", summary: "Sparkles." }));
    const scratch = await mkdtemp(join(tmpdir(), "dib-dev-community-")); dirs.push(scratch);
    // A directory that does not exist yet is an empty community catalog, and reads never create it.
    const communityDirectory = join(scratch, "missing");
    const server = createCatalogOnlyServer({ official: await loadOfficialMods(official), communityDirectory });
    servers.push(server);
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const info = await (await fetch(`${base}/api/community/info`)).json() as CommunityInfo;
    expect(info).toEqual({ enabled: true, authorOrigin: "", registrationEnabled: false });
    const page = await (await fetch(`${base}/api/community/mods?source=official`)).json() as CatalogPage;
    expect(page.mods.map((mod) => [mod.modId, mod.title, mod.summary])).toEqual([["dev.official.trail", "Wand Trail", "Sparkles."]]);
    expect((await (await fetch(`${base}/api/community/mods?source=community`)).json() as CatalogPage).total).toBe(0);

    // Author routes stay closed without an author origin.
    expect((await fetch(`${base}/api/community/session`, { method: "POST", body: "{}" })).status).toBe(404);
    // The readiness probe sees an unavailable API, so the launcher keeps Online disabled.
    const readiness = await fetch(`${base}/api/game/readiness`);
    expect(readiness.status).toBe(503);
    expect(await readiness.json()).toMatchObject({ message: expect.stringContaining("only hosts the mod catalog") });
    await expect(import("node:fs/promises").then((fs) => fs.stat(communityDirectory))).rejects.toThrow();
  });
});
