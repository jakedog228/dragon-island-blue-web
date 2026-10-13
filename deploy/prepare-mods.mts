// Run through @dib/game-server's tsx. Snapshot only the catalog, never the adjacent example saves.
import { copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { loadOfficialMods } from "../apps/game-server/src/officialMods.js";

const [sourceArg, targetArg] = process.argv.slice(2);
if (!sourceArg || !targetArg) throw new Error("usage: prepare-mods.mts <catalog-directory> <new-snapshot-directory>");
const source = resolve(sourceArg), target = resolve(targetArg);
await mkdir(target); // Must be new: no stale or unreviewed files may enter the snapshot.
const names = (await readdir(source)).sort();
for (const name of names) {
  const info = await lstat(join(source, name));
  if (!info.isFile() || info.isSymbolicLink() || !/^[a-z0-9-]+(?:\.dibmod|\.listing\.json|\.screenshot-[0-9]+\.png)$/.test(name)) {
    throw new Error(`Unexpected catalog entry: ${name}`);
  }
  await copyFile(join(source, name), join(target, name));
}
const mods = await loadOfficialMods(target);
if (mods.length === 0) throw new Error("Refusing to publish an empty catalog.");
const referenced = new Set<string>();
for (const name of names.filter(name => name.endsWith(".dibmod"))) {
  referenced.add(name);
  const sidecar = name.replace(/\.dibmod$/, ".listing.json");
  const listing = JSON.parse(await readFile(join(target, sidecar), "utf8"));
  referenced.add(sidecar);
  for (const screenshot of listing.screenshots ?? []) referenced.add(screenshot);
}
for (const name of names) if (!referenced.has(name)) throw new Error(`Unreferenced catalog file: ${name}`);
const manifest = mods.map(({ view }) => ({
  id: view.id, modId: view.modId, title: view.title, summary: view.summary,
  author: view.author.displayName, screenshots: view.screenshots,
  releases: view.releases.map(({ version, digest, byteLength }) => ({ version, digest, byteLength })),
}));
await writeFile(join(target, "publish-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
const hashes = [];
for (const name of [...names, "publish-manifest.json"]) {
  const digest = createHash("sha256").update(await readFile(join(target, name))).digest("hex");
  hashes.push(`${digest}  ${name}`);
}
await writeFile(join(target, "SHA256SUMS"), hashes.join("\n") + "\n");
console.log(`Validated ${mods.length} listings: ${mods.map(mod => mod.view.title).join(", ")}`);
