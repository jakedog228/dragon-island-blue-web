import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL(".", import.meta.url));
const require = createRequire(new URL("../../packages/mod-kernel/package.json", import.meta.url));
const { zipSync, strToU8 } = require("fflate");
const out = resolve(root, "dist"); await mkdir(out, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rules = [], mods = [];
for (const name of ["echo-strike", "turn-counter"]) {
  const source = (await readFile(resolve(root, `${name}.rules.js`), "utf8")).replaceAll("\r\n", "\n");
  const digest = hash(source), factory = new Function(source)(), adapter = factory(digest);
  const id = `example.pvp.${name}`;
  const manifest = { schemaVersion: 4, id, version: "1.0.0", displayName: `PvP Example: ${name}`,
    apiVersion: 4, mode: "offline", dependencies: name === "turn-counter" ? { "example.pvp.echo-strike": "1.0.0" } : {},
    entry: "main.js" };
  const files = { "manifest.json": strToU8(JSON.stringify(manifest)), "rules.js": strToU8(source),
    "rules-identity.json": strToU8(JSON.stringify({ digest })),
    "main.js": strToU8((await readFile(resolve(root, `${name}.client.js`), "utf8")).replaceAll("\r\n", "\n")) };
  const archive = zipSync(files, { level: 9, mtime: new Date("1980-01-02T00:00:00Z") });
  await writeFile(resolve(out, `${name}.dibmod`), archive);
  mods.push({ id, version: manifest.version, digest: hash(archive), support: { kind: "rules", rulesId: adapter.rulesId } });
  rules.push(`(() => { ${source}\n})()(${JSON.stringify(digest)})`);
}
// Self-contained operator module. No request or uploaded package ever selects executable code.
await writeFile(resolve(out, "server.mjs"), `export const apiVersion = "pvp-server-adapters-v1";
const adapters = [${rules.join(",\n")}];
export function install({ data, logicPackId }) {
  return { mods: ${JSON.stringify(mods)}, profiles: [1, 2].map(count => ({
    id: "example-pvp-v1-" + count + "-" + adapters.slice(0, count).map(a => a.digest.slice(0, 12)).join("-"),
    data, logicPackId, rules: adapters.slice(0, count).map(a => a.rulesId), adapters: adapters.slice(0, count),
  })) };
}
`);
console.log(`Built two .dibmod packages and server.mjs in ${out}`);
