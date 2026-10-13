import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { importCodeModArchive, type CodeModPackage } from "@dib/mod-kernel";
import { zipMod } from "./helpers/communityFixtures.js";
import { reviewedPvpMod } from "../src/pvpSupportedMods.js";
import { PvpCompatibilityRegistry } from "../src/pvpCompatibility.js";

const root = resolve(import.meta.dirname, "../../../examples/mods/wand-pointer-trail");
async function archive(options: { sourceSuffix?: string; extra?: boolean; version?: string } = {}): Promise<CodeModPackage> {
  const manifest = JSON.parse(await readFile(resolve(root, "manifest.json"), "utf8"));
  if (options.version) manifest.version = options.version;
  const base = await importCodeModArchive(zipMod(manifest.id, manifest.version), "trail.dibmod");
  const source = await readFile(resolve(root, "scripts/main.js"), "utf8") + (options.sourceSuffix ?? "");
  return { ...base, manifest: { ...base.manifest, entry: "scripts/main.js" }, source,
    files: new Map(Object.entries({ "manifest.json": Buffer.from(JSON.stringify(manifest)), "scripts/main.js": Buffer.from(source),
      ...(options.extra ? { "scripts/extra.js": Buffer.from("alterBattle()") } : {}) })) };
}
describe("reviewed installed PvP mods", () => {
  it("reconciles the actual shipped cosmetic package with a baseline player", async () => {
    const pkg = await archive(), reviewed = reviewedPvpMod(pkg)!;
    expect(reviewed.support).toEqual({ kind: "presentation" });
    const logicPackId = `logic-v1:${"a".repeat(64)}`;
    const registry = new PvpCompatibilityRegistry([reviewed], [{ id: "base", logicPackId, rules: [] }]);
    expect(registry.negotiate({ logicPackId, mods: [{ id: reviewed.id, version: reviewed.version, digest: reviewed.digest }] }, { logicPackId, mods: [] })).toMatchObject({ compatible: true, profileId: "base" });
  });
  it("refuses changed code, added modules and unknown releases even with the same trusted name", async () => {
    expect(reviewedPvpMod(await archive({ sourceSuffix: "\n// changed" }))).toBeUndefined();
    expect(reviewedPvpMod(await archive({ extra: true }))).toBeUndefined();
    expect(reviewedPvpMod(await archive({ version: "9.0.0" }))).toBeUndefined();
  });
});
