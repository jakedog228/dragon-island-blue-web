import { describe, expect, it } from "vitest";
import type { ImportedContentPackage, ReadonlyPlistValue } from "../src/content/archivePackage.js";
import { identifyContentLogicPack } from "../src/content/logicPackIdentity.js";

function content(overrides: Record<string, ReadonlyPlistValue> = {}): ImportedContentPackage {
  const files: Record<string, ReadonlyPlistValue> = {
    "Monsters.plist": { Cub: { index: 1, rendererData: { spriteFile: "Cub.png" } } },
    "Jobs.plist": { Cub: { xpPenalty: 1 } },
    "Abilities.plist": { Attack: { power: 2 } },
    "AbilityComponents.plist": {},
    "Buffs.plist": {},
    "Items.plist": {},
    "Combines.plist": {},
    "Worlds.plist": { World_1: {} },
    "PointsOfInterest.plist": {},
    "World_1.plist": { challengeLevel: 1 },
    ...overrides,
  };
  return {
    sourceKind: "app-archive",
    archiveName: "test.ipa",
    appDirectory: "/",
    data: {} as ImportedContentPackage["data"],
    resources: {
      list: () => Object.keys(files),
      has: (path) => path in files,
      plist: (path) => files[path]!,
      text: () => "",
      url: () => "blob:test",
    },
    manifest: { atlases: {}, sprites: {}, fonts: {}, audio: {}, particles: {} },
    combatBackgroundKeys: [],
    worldNames: ["World_1"],
    hasTownCapability: false,
    hasDungeonCapability: false,
    dungeonTypes: [],
    dungeonFiles: [],
    hasProvenanceDocument: false,
    urlFor: () => "blob:test",
    dispose: () => {},
  };
}

describe("browser logic-pack identity", () => {
  it("ignores presentation fields but binds world mechanics", async () => {
    const original = await identifyContentLogicPack(content());
    const art = await identifyContentLogicPack(content({
      "Monsters.plist": { Cub: { index: 1, rendererData: { spriteFile: "Other.png" } } },
    }));
    const mechanics = await identifyContentLogicPack(content({
      "World_1.plist": { challengeLevel: 2 },
    }));
    expect(art.logicPackId).toBe(original.logicPackId);
    expect(mechanics.logicPackId).not.toBe(original.logicPackId);
  });
});
