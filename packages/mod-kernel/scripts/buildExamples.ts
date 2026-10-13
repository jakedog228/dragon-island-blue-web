import { copyFile, readFile, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { zipSync } from "fflate";

const workspace = resolve(import.meta.dirname, "../../..");
const examples = resolve(workspace, "examples/mods");
const output = resolve(examples, "dist");
// The curated Official catalog: every example with a `listing.json`, copied beside its store page.
// Servers publish this folder (DIB_OFFICIAL_MODS_DIR), so examples without a listing stay
// importable from dist/ without appearing as Official mods.
const official = resolve(output, "official");
// Gameplay captures from `pnpm mods:screenshots`. They render the operator's own IPA, so they are
// gitignored and optional: a checkout without them still builds listings, just without images.
const screenshots = resolve(examples, "screenshots");
const screenshotFiles = await readdir(screenshots).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return [] as string[];
  throw error;
});
const missingScreenshots: string[] = [];
const names = [
  "blue-dragon-overdrive",
  "devtools",
  "fire-cub-inferno-barrage",
  "less-rare-monsters",
  "mercy-stone",
  "pirate-panic-dancer",
  "realtime-combat",
  "wand-pointer-trail",
] as const;

await mkdir(output, { recursive: true });
// Rebuilt from scratch so an example whose listing was removed leaves the catalog too.
await rm(official, { recursive: true, force: true });
await mkdir(official);
// Before the catalog had its own folder, listings and screenshots were written beside every archive.
for (const stale of (await readdir(output)).filter((file) => file.endsWith(".listing.json") || /\.screenshot-[0-9]+\.png$/.test(file))) {
  await rm(resolve(output, stale));
}
const catalog: string[] = [];
for (const name of names) {
  const root = resolve(examples, name);
  const files: Record<string, Uint8Array> = {};
  for (const file of await sourceFiles(root)) {
    files[relative(root, file).replaceAll("\\", "/")] = new Uint8Array(await readFile(file));
  }
  const archive = zipSync(files, {
    level: 9,
    // ZIP's DOS timestamp is interpreted in local time; day two stays within the 1980 range in
    // every supported host timezone while remaining byte-for-byte reproducible.
    mtime: new Date("1980-01-02T00:00:00.000Z"),
  });
  await writeFile(resolve(output, `${name}.dibmod`), archive);
  console.log(`built examples/mods/dist/${name}.dibmod (${archive.byteLength} bytes)`);
  if (await writeListing(name, root)) {
    await writeFile(resolve(official, `${name}.dibmod`), archive);
    catalog.push(name);
  }
}
console.log(`published ${catalog.length} official mods to examples/mods/dist/official: ${catalog.join(", ")}`);
if (missingScreenshots.length > 0) {
  console.log(`no gameplay screenshot for ${missingScreenshots.join(", ")} (pnpm mods:screenshots captures them)`);
}

for (const [source, name] of [["pirate-panic-dancer/save/pirate-savefile0", "pirate-savefile0"]] as const) {
  await copyFile(resolve(examples, source), resolve(output, name));
  console.log(`copied examples/mods/dist/${name}`);
}

/**
 * Store-page text for the Official catalog, written to dist/official. It lives beside the archive,
 * never inside it, so package digests do not change with copy edits. Screenshots `<name>.png` /
 * `<name>-<n>.png` are copied beside it and listed in capture order. False when the example has no
 * listing, which keeps it out of the catalog.
 */
async function writeListing(name: string, root: string): Promise<boolean> {
  let listing: Record<string, unknown>;
  try { listing = JSON.parse(await readFile(resolve(root, "listing.json"), "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
  if ("screenshots" in listing) throw new Error(`${name}/listing.json must not list screenshots; they come from examples/mods/screenshots.`);
  // `<name>.png` sorts first, then `<name>-2.png`, `<name>-3.png`...; anything else is not ours.
  const order = (file: string): number | undefined => {
    if (file === `${name}.png`) return 0;
    const suffix = file.startsWith(`${name}-`) && file.endsWith(".png") ? file.slice(name.length + 1, -4) : "";
    return /^[0-9]+$/.test(suffix) ? Number(suffix) : undefined;
  };
  const shots = screenshotFiles
    .map((file) => ({ file, order: order(file) }))
    .filter((entry): entry is { file: string; order: number } => entry.order !== undefined)
    .sort((a, b) => a.order - b.order)
    .slice(0, 6);
  const images: string[] = [];
  for (const [index, shot] of shots.entries()) {
    const target = `${name}.screenshot-${index + 1}.png`;
    await copyFile(resolve(screenshots, shot.file), resolve(official, target));
    images.push(target);
  }
  if (images.length === 0) missingScreenshots.push(name);
  await writeFile(resolve(official, `${name}.listing.json`), `${JSON.stringify(images.length ? { ...listing, screenshots: images } : listing, null, 2)}\n`);
  return true;
}

async function sourceFiles(directory: string, root = directory): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Extractor bytecode embeds local interpreter/path state and is not package source.
    if (entry.name === "dist" || entry.name === ".gitignore" || (directory === root && entry.name === "listing.json") || entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(path, root));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}
