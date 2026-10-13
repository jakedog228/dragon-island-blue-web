import { copyFile, readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { zipSync } from "fflate";

const workspace = resolve(import.meta.dirname, "../../..");
const examples = resolve(workspace, "examples/mods");
const output = resolve(examples, "dist");
const names = ["blue-dragon-overdrive", "devtools", "fire-cub-inferno-barrage", "mercy-stone", "pirate-panic-dancer", "realtime-combat", "wand-pointer-trail"] as const;

await mkdir(output, { recursive: true });
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
}

for (const [source, name] of [["pirate-panic-dancer/save/pirate-savefile0", "pirate-savefile0"]] as const) {
  await copyFile(resolve(examples, source), resolve(output, name));
  console.log(`copied examples/mods/dist/${name}`);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    // Extractor bytecode embeds local interpreter/path state and is not package source.
    if (entry.name === "dist" || entry.name === ".gitignore" || entry.name === "__pycache__" || entry.name.endsWith(".pyc")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(path));
    else if (entry.isFile()) found.push(path);
  }
  return found.sort();
}
