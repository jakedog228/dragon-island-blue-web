import { readFileSync, readdirSync } from "node:fs";
import { resolve, relative } from "node:path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { importCodeModArchive, resolveCodeModProfile } from "@dib/mod-kernel";
import { GameData, loadWorldData } from "@dib/gamedata/browser";
import { createFullTrustCodeModRuntime } from "../src/content/codeModRuntime.js";
import { importContentArchive, type ImportedContentPackage, type ReadonlyPlistValue } from "../src/content/archivePackage.js";
import { fingerprintContentPackage } from "../src/content/contentFingerprint.js";
import { compareSaveMods, saveContentChanged } from "../src/content/saveModComparison.js";

const workspace = resolve(import.meta.dirname, "../../..");
const root = resolve(workspace, "examples/mods/less-rare-monsters");
const targets = [
  ["1-1", "1-1_Turtorial_Hut_2", "BlueBabyDragon", 6],
  ["1-1", "Breeder_Hut_2", "Cherub", 5],
  ["1-3", "1-3_Forest_1", "RedDragonling", 6],
  ["2-1", "2-1_Forest_1", "MetalSludge", 15],
  ["2-1", "2-1_Forest_2", "MetalSludge", 15],
  ["2-1", "2-1_Forest_4", "MetalSludge", 9],
  ["2-3", "2-3_Field_5", "Kappa", 11],
  ["2-3", "2-3_Forest_1", "MetalSludge", 2],
  ["2-4", "2-4_Field_1", "Kappa", 9],
  ["3-1", "3-1_Field_3", "GoldDragon", 7],
  ["3-1", "3-1_Field_4", "MetalSludge", 15],
  ["3-1", "3-1_Field_5", "MetalSludge", 15],
  ["3-1", "3-1_Field_6", "MetalSludge", 15],
  ["3-1", "3-1_Forest_1", "MetalSludge", 15],
  ["3-3", "3-3_Forest_4", "WhiteDragon", 6],
] as const;

async function activate() {
  const files: Record<string, Uint8Array> = {};
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[relative(root, path).replaceAll("\\", "/")] = readFileSync(path);
    }
  }
  visit(root);
  const pkg = await importCodeModArchive(zipSync(files), "less-rare-monsters.dibmod");
  return createFullTrustCodeModRuntime(await resolveCodeModProfile([pkg]));
}

function fixture(): ImportedContentPackage {
  const files: Record<string, ReadonlyPlistValue> = {};
  for (const file of readdirSync(resolve(workspace, "extracted/data"))) {
    if (file.endsWith(".json")) files[file.replace(/\.json$/, ".plist")] =
      JSON.parse(readFileSync(resolve(workspace, "extracted/data", file), "utf8"));
  }
  return {
    sourceKind: "app-archive", archiveName: "fixture.zip", appDirectory: "/",
    data: {
      monsters: {}, jobs: {}, abilities: {}, abilityComponents: {}, buffs: {},
      combines: {}, anims: {}, meleeAttacks: {}, scale9: {}, strings: {},
    },
    manifest: { atlases: {}, sprites: {}, fonts: {}, audio: {}, particles: {} },
    combatBackgroundKeys: [], worldNames: [], hasTownCapability: false,
    hasDungeonCapability: false, dungeonTypes: [], dungeonFiles: [],
    hasProvenanceDocument: false, urlFor: () => "blob:original", dispose: () => {},
    resources: {
      list: () => Object.keys(files),
      has: (path: string) => Object.hasOwn(files, path),
      plist: (path: string) => structuredClone(files[path]!),
      text: () => "original text",
      url: () => "blob:original",
    },
  };
}

// Independent release table above drives the expected full-document result.
function expectedWorld(original: ReadonlyPlistValue, world: string) {
  const expected = structuredClone(original) as { pointsOfInterest: Array<{
    arguments: { instanceName: string; encounters: { table: Record<string, {
      monsterPopulator: { arguments: { types: Array<{ type: string; chance: number }> } };
    }> } };
  }> };
  for (const [id, poi, monster, weight] of targets) {
    if (world !== `World_${id}.plist`) continue;
    const point = expected.pointsOfInterest.find((p) => p.arguments.instanceName === poi)!;
    const entry = point.arguments.encounters.table["1"]!.monsterPopulator.arguments.types.find((m) => m.type === monster)!;
    entry.chance = weight;
  }
  return expected;
}

describe("Less Rare Monsters native conversion", () => {
  it("loads through v4 and changes exactly the 15 upstream leaves without mutating base or returned snapshots", async () => {
    const runtime = await activate();
    try {
      const base = fixture();
      const before = new Map(base.resources.list().map((path) => [path, base.resources.plist(path)]));
      const modded = await runtime.runPhase("content:loaded", base);
      const worlds = new Set(targets.map(([id]) => `World_${id}.plist`));
      for (const [path, original] of before) {
        expect(modded.resources.plist(path)).toEqual(worlds.has(path) ? expectedWorld(original, path) : original);
        expect(base.resources.plist(path)).toEqual(original);
      }
      const snapshot = modded.resources.plist("World_1-1.plist") as Record<string, unknown>;
      snapshot["pointsOfInterest"] = [];
      expect(modded.resources.plist("World_1-1.plist")).toEqual(expectedWorld(before.get("World_1-1.plist")!, "World_1-1.plist"));
      expect(modded.resources.text("anything")).toBe("original text");
      expect(modded.resources.url("anything")).toBe("blob:original");
      const originalHash = await fingerprintContentPackage(base);
      const overlayHash = await fingerprintContentPackage(modded);
      expect(overlayHash.digest).not.toBe(originalHash.digest);
      const pkg = runtime.profile.packages[0]!;
      expect(pkg.manifest.saveCompatibility).toBe("neutral");
      const selected = [{ ...pkg.manifest, digest: pkg.digest, byteLength: undefined }];
      const previous = { lastMods: selected, lastContent: overlayHash.digest, lastBaseContent: originalHash.digest };
      expect(compareSaveMods(selected, [], saveContentChanged(previous, [], originalHash.digest, originalHash.digest)).kind).toBe("same");
      expect(saveContentChanged({ lastMods: [], lastContent: originalHash.digest }, selected, overlayHash.digest, originalHash.digest)).toBe(false);
    } finally { runtime.dispose(); }
  });

  it.each(["missing", "ambiguous"])("fails atomically on %s targets", async (kind) => {
    const runtime = await activate();
    try {
      const base = fixture();
      const read = base.resources.plist;
      base.resources.plist = (path) => {
        const value = read(path);
        if (path !== "World_1-1.plist") return value;
        const world = value as { pointsOfInterest: ReadonlyPlistValue[] };
        world.pointsOfInterest = kind === "missing" ? [] : [...world.pointsOfInterest, ...world.pointsOfInterest];
        return world;
      };
      await expect(runtime.runPhase("content:loaded", base)).rejects.toThrow(/matched (0|2) entries/);
      expect(read("World_1-1.plist")).toEqual(fixture().resources.plist("World_1-1.plist"));
    } finally { runtime.dispose(); }
  });

  it.skipIf(!process.env["DIB_TEST_CONTENT_ARCHIVE"])("imports the operator archive and parses all changed worlds", async () => {
    const base = importContentArchive(readFileSync(resolve(workspace, process.env["DIB_TEST_CONTENT_ARCHIVE"]!)), "operator.ipa");
    const runtime = await activate();
    try {
      const modded = await runtime.runPhase("content:loaded", base);
      const data = GameData.fromRaw(modded.data);
      const types = new Set(data.allMonsters().map((monster) => monster.shortType));
      for (const id of new Set(targets.map(([world]) => world))) {
        const path = `World_${id}.plist`;
        expect(modded.resources.plist(path)).toEqual(expectedWorld(base.resources.plist(path), path));
        expect(loadWorldData(modded.resources, `World_${id}`, types)).toBeDefined();
      }
    } finally { runtime.dispose(); base.dispose(); }
  }, 60_000);
});
