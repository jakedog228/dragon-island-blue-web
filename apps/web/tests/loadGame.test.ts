import { readFileSync as __readCorpusFile } from "node:fs";
import { describe, expect, it, vi } from "vitest";
const monsters = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Monsters.json", import.meta.url), "utf8"));
const combines = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Combines.json", import.meta.url), "utf8"));
const jobs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Jobs.json", import.meta.url), "utf8"));
const abilities = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Abilities.json", import.meta.url), "utf8"));
const abilityComponents = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/AbilityComponents.json", import.meta.url), "utf8"));
const buffs = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Buffs.json", import.meta.url), "utf8"));
const items = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Items.json", import.meta.url), "utf8"));
const collection = JSON.parse(__readCorpusFile(new URL("../../../extracted/data/Collection.json", import.meta.url), "utf8"));
import type {
  ImportedContentPackage,
  ImportedResourceCatalog,
} from "../src/content/archivePackage.js";
import { loadGame } from "../src/loadGame.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

function contentFixture(options: {
  readonly collection?: unknown;
  readonly collectionType?: string;
  readonly otherWorldCollectionType?: string;
} = {}): ImportedContentPackage {
  const pointsOfInterest: unknown[] = [{
    type: "Outdoor.Generic",
    arguments: { instanceName: "Start", position: "{20,30}" },
  }];
  const poiDefinitions: Record<string, unknown> = {
    Generic: {
      class: "PointOfInterest",
      rendererData: { class: "POINode", spriteFile: "empty.png" },
    },
  };
  if (options.collectionType !== undefined || options.otherWorldCollectionType !== undefined) {
    poiDefinitions.CollectionHut = {
      class: "PopupMenuPointOfInterest",
      rendererData: { class: "PopupMenuPOINode", spriteFile: "empty.png" },
    };
  }
  if (options.collectionType !== undefined) {
    pointsOfInterest.push({
      type: "Outdoor.CollectionHut",
      arguments: {
        instanceName: "Collection_Hut",
        position: "{207,142}",
        menuClass: "MonsterCollectionMenuItem",
        menuArguments: { collectionType: options.collectionType },
      },
    });
  }

  const worlds: Record<string, unknown> = {
    Demo: {
      class: "World",
      rendererData: { class: "CCSprite", anchor: "{0,0}", spriteFile: "demo.png" },
    },
  };
  const files = new Map<string, unknown>([
    ["Worlds.plist", worlds],
    ["PointsOfInterest.plist", { Outdoor: poiDefinitions }],
    ["Demo.plist", {
      challengeLevel: 1,
      combatBackground: "FieldCombat.png",
      connections: [],
      pointsOfInterest,
    }],
    ["demo.png", true],
    ["empty.png", true],
    ["FieldCombat.png", true],
  ]);
  if (options.otherWorldCollectionType !== undefined) {
    worlds.Other = {
      class: "World",
      rendererData: { class: "CCSprite", anchor: "{0,0}", spriteFile: "demo.png" },
    };
    files.set("Other.plist", {
      challengeLevel: 1,
      combatBackground: "FieldCombat.png",
      connections: [],
      pointsOfInterest: [
        { type: "Outdoor.Generic", arguments: { instanceName: "OtherStart", position: "{20,30}" } },
        {
          type: "Outdoor.CollectionHut",
          arguments: {
            instanceName: "Other_Collection_Hut",
            position: "{207,142}",
            menuClass: "MonsterCollectionMenuItem",
            menuArguments: { collectionType: options.otherWorldCollectionType },
          },
        },
      ],
    });
  }
  if (options.collection !== undefined) files.set("Collection.plist", options.collection);

  const resources: ImportedResourceCatalog = {
    list: () => Object.freeze([...files.keys()]),
    has: (path) => files.has(path),
    plist: (path) => {
      if (!files.has(path)) throw new Error(`missing ${path}`);
      return files.get(path) as never;
    },
    text: (path) => String(files.get(path)),
    url: (path) => `memory:${path}`,
  };

  return {
    sourceKind: "app-archive",
    archiveName: "collection-fixture.zip",
    appDirectory: "/",
    data: {
      monsters,
      combines,
      jobs,
      abilities,
      abilityComponents,
      buffs,
      items,
      anims: {},
      meleeAttacks: {},
      scale9: {},
      strings: {},
    },
    resources,
    manifest: { atlases: {}, audio: {}, fonts: {}, particles: {}, sprites: {} },
    combatBackgroundKeys: ["FieldCombat"],
    worldNames: options.otherWorldCollectionType === undefined ? ["Demo"] : ["Demo", "Other"],
    hasTownCapability: false,
    hasDungeonCapability: false,
    dungeonTypes: [],
    dungeonFiles: [],
    hasProvenanceDocument: false,
    urlFor: (path) => `memory:${path}`,
    dispose: () => undefined,
  };
}

describe("loaded Collection content", () => {
  it("accepts a package with no promoted Collection route and no Collection.plist", () => {
    const game = loadGame(contentFixture());

    expect(game.collectionCatalog.size).toBe(0);
    expect(game.hasCollectionRoute).toBe(false);
    expect(Object.isFrozen(game.collectionCatalog)).toBe(true);
    expect((game.collectionCatalog as unknown as Record<string, unknown>).set).toBeUndefined();
  });

  it("strictly parses a present Collection.plist even when no route uses it", () => {
    expect(() => loadGame(contentFixture({ collection: { Base: "not-an-array" } })))
      .toThrow(/Collection\.plist\.Base must be an array/);
  });

  it("does not promote a retained Collection.plist without a promoted route", () => {
    const game = loadGame(contentFixture({ collection }));

    expect(game.hasCollectionRoute).toBe(false);
    expect(game.collectionCatalog.get("Base")?.map(({ key }) => key)).toEqual([
      "UsualSuspects",
      "RecipeForDestruction",
      "Eggxactly",
      "Collector",
    ]);
  });

  it("requires Collection.plist when a promoted Collection route is reachable", () => {
    expect(() => loadGame(contentFixture({ collectionType: "Base" })))
      .toThrow(/Collection route Collection_Hut requires Collection\.plist/);
  });

  it("requires the exact authored collectionType root for every promoted route", () => {
    expect(() => loadGame(contentFixture({ collection, collectionType: "Seasonal" })))
      .toThrow(/Collection route Collection_Hut references missing collection type Seasonal/);
  });

  it("exposes the shipped Base catalog in authored goal order", () => {
    const game = loadGame(contentFixture({ collection, collectionType: "Base" }));

    expect(game.hasCollectionRoute).toBe(true);
    expect(game.collectionCatalog.get("Base")?.map(({ key }) => key)).toEqual([
      "UsualSuspects",
      "RecipeForDestruction",
      "Eggxactly",
      "Collector",
    ]);
  });

  it("derives the route capability from every loaded world, not only the initial world", () => {
    const game = loadGame(contentFixture({
      collection,
      otherWorldCollectionType: "Base",
    }));

    expect(game.hasCollectionRoute).toBe(true);
  });
});
