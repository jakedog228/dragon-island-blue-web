import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectWorldSpriteFiles,
  loadTownPortalDestinations,
  loadWorldData,
  resolveTownPortalDestination,
  WorldDataError,
  type WorldResourceSource,
} from "../src/world.js";
import { resolveDataDir } from "../src/dataDir.js";


function shippedSource(): WorldResourceSource {
  const dataDir = resolveDataDir();
  return {
    has: (path) => path.endsWith(".plist")
      ? existsSync(resolve(dataDir, `${path.slice(0, -6)}.json`))
      : true,
    plist: (path) => JSON.parse(readFileSync(
      resolve(dataDir, `${path.slice(0, -6)}.json`),
      "utf8",
    )) as unknown,
  };
}

function fixture(mutator?: (files: Map<string, unknown>) => void): WorldResourceSource {
  const files = new Map<string, unknown>([
    ["Worlds.plist", { Demo: { class: "World", rendererData: { class: "CCSprite", anchor: "{0,0}", spriteFile: "demo.png" } } }],
    ["PointsOfInterest.plist", { Outdoor: { Generic: { class: "PointOfInterest", rendererData: { class: "POINode", spriteFile: "empty.png" } } } }],
    ["Demo.plist", {
      challengeLevel: 4,
      combatBackground: "FieldCombat.png",
      defaultItemSpawnChance: .4,
      encounterChance: .2,
      connections: [{ type: "Connection", arguments: { poi1: "A", poi2: "B" } }],
      pointsOfInterest: [
        { type: "Outdoor.Generic", arguments: { instanceName: "A", position: "{20,30}" } },
        { type: "Outdoor.Generic", arguments: { instanceName: "B", position: "{300,200}", encounters: {
          levelScalor: 2, itterationScalor: .5, table: { "1": { monsterPopulator: { class: "DefaultMonsterPopulator", arguments: {
            fixedEncounters: [{
              chanceToAppear: 1,
              exactFloor: 1,
              monsters: [{ type: "Slime", levelScalor: 2 }],
            }],
            levelScalor: 1.25, minMonstersPerPack: 1, maxMonstersPerPack: 3,
            types: [{ type: "Slime", chance: 70 }, { type: "Bat", chance: 30 }],
          } } } },
        } } },
      ],
    }],
    ["demo.png", true], ["empty.png", true], ["FieldCombat.png", true],
    ["walkArrow.png", true], ["ipadBorder.png", true],
  ]);
  mutator?.(files);
  return { has: (path) => files.has(path), plist: (path) => files.get(path) };
}

function popupMenuPoiFixture(
  menuClass: unknown,
  menuArguments: unknown,
): WorldResourceSource {
  return fixture((files) => {
    files.set("PointsOfInterest.plist", {
      Outdoor: {
        Generic: {
          class: "PointOfInterest",
          rendererData: { class: "POINode", spriteFile: "empty.png" },
        },
        CollectionHut: {
          class: "PopupMenuPointOfInterest",
          rendererData: { class: "PopupMenuPOINode", spriteFile: "empty.png" },
        },
      },
    });
    const raw = structuredClone(files.get("Demo.plist")) as {
      pointsOfInterest: Array<Record<string, unknown>>;
    };
    raw.pointsOfInterest.push({
      type: "Outdoor.CollectionHut",
      arguments: {
        instanceName: "Collection_Hut",
        position: "{207,142}",
        menuClass,
        menuArguments,
      },
    });
    files.set("Demo.plist", raw);
  });
}

function townPortalFixture(towns: Record<string, unknown>): WorldResourceSource {
  const files = new Map<string, unknown>([
    ["Worlds.plist", {
      Demo: { class: "World", rendererData: { class: "CCSprite", spriteFile: "demo.png" } },
    }],
    ["PointsOfInterest.plist", {
      Outdoor: {
        Town: {
          class: "TownPointOfInterest",
          rendererData: { class: "TownPOINode", spriteFile: "empty.png" },
        },
      },
    }],
    ["Demo.plist", {
      pointsOfInterest: Object.keys(towns).map((townName) => ({
        type: "Outdoor.Town",
        arguments: { instanceName: townName },
      })),
    }],
    ["Towns.plist", towns],
  ]);
  return { has: (path) => files.has(path), plist: (path) => files.get(path) };
}

describe("source-shaped world data", () => {
  it("enumerates the shipped Towns portal corpus and pins the Liberate truth-table shape", () => {
    const destinations = loadTownPortalDestinations(shippedSource());
    expect(destinations.map(({ townName }) => townName)).toEqual([
      "First_City",
      "Capital_City",
      "Rainy_City",
      "Valley_City",
      "Ancient_City",
      "Longdale_City",
      "HolyCity",
      "SaintWesburn",
      "Secret_City",
    ]);
    expect(destinations).toHaveLength(9);
    const normal = destinations.filter(({ townName }) => townName !== "Secret_City");
    expect(normal).toHaveLength(8);
    for (const destination of normal) {
      expect(destination.portalConditions).toEqual({
        quests: ["LiberateTownsQuest"],
        orCondition: {
          battles: [`Renderable${destination.townName}NameKey`],
          inProgressQuests: ["LiberateTownsQuest"],
          orCondition: { inProgressQuests: ["!LiberateTownsQuest"] },
        },
      });
    }
    expect(destinations.find(({ townName }) => townName === "Longdale_City")?.portalConditions)
      .toEqual({
        quests: ["LiberateTownsQuest"],
        orCondition: {
          battles: ["RenderableLongdale_CityNameKey"],
          inProgressQuests: ["LiberateTownsQuest"],
          orCondition: { inProgressQuests: ["!LiberateTownsQuest"] },
        },
      });
    expect(destinations.find(({ townName }) => townName === "Secret_City")?.portalConditions)
      .toEqual({
        quests: ["LiberateTownsQuest"],
        orCondition: { inProgressQuests: ["LiberateTownsQuest"] },
      });
  });

  it("loads source-sorted Town Portal destinations and resolves lastTown/default policy", () => {
    const source = townPortalFixture({
      Later_City: { class: "Town", sortOrder: 4, world: "Demo" },
      First_City: {
        class: "Town",
        portalConditions: { quests: "StoryQuest" },
        sortOrder: 0,
        world: "Demo",
      },
    });
    const destinations = loadTownPortalDestinations(source);
    expect(destinations).toEqual([
      {
        townName: "First_City",
        worldName: "Demo",
        sortOrder: 0,
        portalConditions: { quests: ["StoryQuest"] },
      },
      { townName: "Later_City", worldName: "Demo", sortOrder: 4 },
    ]);
    expect(resolveTownPortalDestination(destinations, "Later_City").townName).toBe("Later_City");
    expect(resolveTownPortalDestination(destinations, undefined).townName).toBe("First_City");
    expect(() => resolveTownPortalDestination(destinations, "Missing")).toThrow(/unavailable/);
  });

  it("uses the first authored town for an independently named package fallback", () => {
    const source = townPortalFixture({
      Harbor_Town: { class: "Town", sortOrder: 0, world: "Demo" },
      Pass_Camp: { class: "Town", sortOrder: 2, world: "Demo" },
    });
    expect(resolveTownPortalDestination(loadTownPortalDestinations(source), undefined).townName)
      .toBe("Harbor_Town");
  });

  it("rejects malformed Town Portal registry data", () => {
    const badOrder = townPortalFixture({
      Broken: { class: "Town", sortOrder: -1, world: "Demo" },
    });
    expect(() => loadTownPortalDestinations(badOrder)).toThrow(/sortOrder must be nonnegative/);
    const badWorld = townPortalFixture({
      Broken: { class: "Town", sortOrder: 0, world: "Missing" },
    });
    expect(() => loadTownPortalDestinations(badWorld)).toThrow(/unknown world Missing/);
    const badCondition = townPortalFixture({
      Broken: {
        class: "Town",
        sortOrder: 0,
        world: "Demo",
        portalConditions: { invented: "StoryQuest" },
      },
    });
    expect(() => loadTownPortalDestinations(badCondition)).toThrow(/unsupported key invented/);
  });

  it("loads authored points, an undirected graph, random populations, and source defaults", () => {
    const world = loadWorldData(fixture(), "Demo", new Set(["Slime", "Bat"]));
    expect(world.map.spriteFile).toBe("demo.png");
    expect(world.connections).toEqual([{ poi1: "A", poi2: "B", demoSkipped: [] }]);
    expect(world.pointsOfInterest[1]?.randomPopulators[0]).toMatchObject({
      tier: 1, encounterLevelScalor: 2, itterationScalor: .5, populatorLevelScalor: 1.25,
      minMonstersPerPack: 1,
      maxMonstersPerPack: 3,
      fixedEncounters: [{
        sourceIndex: 0,
        chanceToAppear: 1,
        exactFloor: 1,
        monsters: [{ type: "Slime", levelScalor: 2 }],
      }],
    });
    expect(world.pointsOfInterest[1]?.demoSkipped).not.toContain("fixedEncounter");
  });

  it("retains the exact shipped Monster Collection interaction and authored collection type", () => {
    const collection = loadWorldData(
      popupMenuPoiFixture("MonsterCollectionMenuItem", { collectionType: "Base" }),
      "Demo",
      new Set(["Slime", "Bat"]),
    ).pointsOfInterest[2];

    expect(collection).toMatchObject({
      name: "Collection_Hut",
      sourceClass: "PopupMenuPointOfInterest",
      supportedInteraction: { kind: "monsterCollection", collectionType: "Base" },
      demoSkipped: ["customInteraction"],
    });
  });

  it.each([
    [undefined, /menuArguments must be a dictionary/],
    [{}, /collectionType must be a non-empty string/],
    [{ collectionType: "" }, /collectionType must be a non-empty string/],
    [{ collectionType: 4 }, /collectionType must be a non-empty string/],
    [{ collectionType: "Base", invented: true }, /unsupported key invented/],
  ])("rejects malformed Monster Collection arguments %#", (menuArguments, message) => {
    expect(() => loadWorldData(
      popupMenuPoiFixture("MonsterCollectionMenuItem", menuArguments),
      "Demo",
      new Set(["Slime", "Bat"]),
    )).toThrow(message);
  });

  it("keeps every unknown popup menu class blocked without interpreting its arguments", () => {
    const point = loadWorldData(
      popupMenuPoiFixture("PackageSelectedMenuItem", { packageDefined: true }),
      "Demo",
      new Set(["Slime", "Bat"]),
    ).pointsOfInterest[2];

    expect(point).not.toHaveProperty("supportedInteraction");
    expect(point?.demoSkipped).toContain("customInteraction");
  });

  it("retains the durable POI-completion predicate on conditioned world connections", () => {
    const source = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as {
        connections: Array<{ arguments: Record<string, unknown> }>;
      };
      raw.connections[0]!.arguments.conditions = { pois: "A" };
      files.set("Demo.plist", raw);
    });
    expect(loadWorldData(source, "Demo", new Set(["Slime", "Bat"])).connections).toEqual([{
      poi1: "A",
      poi2: "B",
      requiredCompletedPoiNames: ["A"],
      demoSkipped: [],
    }]);
  });

  it("uses the World source defaults when optional probabilities are absent", () => {
    const source = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as Record<string, unknown>;
      delete raw.defaultItemSpawnChance; delete raw.encounterChance; delete raw.challengeLevel; files.set("Demo.plist", raw);
    });
    const world = loadWorldData(source, "Demo", new Set(["Slime", "Bat"]));
    expect(world.defaultItemSpawnChance).toBe(.25);
    expect(world.encounterChance).toBe(Math.fround(.333));
    expect(world.challengeLevel).toBe(1);
  });

  it("fails loudly for off-canvas coordinates and unknown monsters", () => {
    const mutatePoint = (change: (point: Record<string, unknown>) => void) => fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { pointsOfInterest: Array<Record<string, unknown>> };
      change(raw.pointsOfInterest[1]!); files.set("Demo.plist", raw);
    });
    expect(() => loadWorldData(mutatePoint((point) => { (point.arguments as Record<string, unknown>).position = "{481,0}"; }), "Demo", new Set(["Slime", "Bat"]))).toThrow(/outside the 480x320/);
    expect(() => loadWorldData(fixture(), "Demo", new Set(["Slime"]))).toThrow(/unknown monster Bat/);
  });

  it("preserves and tags source-tolerated dangling connection strings without creating a POI", () => {
    const source = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { connections: Array<{ arguments: Record<string, unknown> }> };
      raw.connections[0]!.arguments.poi2 = "RemovedPoint";
      files.set("Demo.plist", raw);
    });
    const world = loadWorldData(source, "Demo", new Set(["Slime", "Bat"]));
    expect(world.connections[0]).toEqual({
      poi1: "A",
      poi2: "RemovedPoint",
      missingPointNames: ["RemovedPoint"],
      demoSkipped: [],
    });
    expect(world.pointsOfInterest.map((point) => point.name)).toEqual(["A", "B"]);
  });

  it("still rejects malformed connection names, self-edges, and unknown keys", () => {
    const connectionSource = (argumentsValue: Record<string, unknown>) => fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { connections: Array<{ arguments: Record<string, unknown> }> };
      raw.connections[0]!.arguments = argumentsValue;
      files.set("Demo.plist", raw);
    });
    expect(() => loadWorldData(connectionSource({ poi1: "A", poi2: "" }), "Demo", new Set(["Slime", "Bat"]))).toThrow(/poi2 must be a non-empty string/);
    expect(() => loadWorldData(connectionSource({ poi1: "A", poi2: "A" }), "Demo", new Set(["Slime", "Bat"]))).toThrow(/cannot connect a point to itself/);
    expect(() => loadWorldData(connectionSource({ poi1: "A", poi2: "B", invented: true }), "Demo", new Set(["Slime", "Bat"]))).toThrow(/unsupported key invented/);
  });

  it("accepts the source Random roster sentinel without fabricating a monster definition", () => {
    const source = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { pointsOfInterest: Array<{ arguments: Record<string, unknown> }> };
      const encounters = raw.pointsOfInterest[1]!.arguments.encounters as { table: Record<string, { monsterPopulator: { arguments: { types: Array<{ type: string }> } } }> };
      encounters.table["1"]!.monsterPopulator.arguments.types[1]!.type = "Random";
      files.set("Demo.plist", raw);
    });
    expect(loadWorldData(source, "Demo", new Set(["Slime"])).pointsOfInterest[1]?.randomPopulators[0]?.types[1]?.type).toBe("Random");
  });

  it("preserves the original dungeon descriptor's optional integer dungeonLevel", () => {
    const source = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { pointsOfInterest: Array<Record<string, unknown>> };
      raw.pointsOfInterest.push({
        type: "Outdoor.Generic",
        arguments: {
          instanceName: "Dungeon",
          position: "{400,100}",
          zoneChange: {
            type: "Generic",
            arguments: {
              targetZoneChange: "Entrance",
              dungeon: { type: "Cave", arguments: "Dungeon.plist", dungeonLevel: 3 },
            },
          },
        },
      });
      files.set("Demo.plist", raw);
      files.set("Dungeon.plist", {});
    });
    const point = loadWorldData(source, "Demo", new Set(["Slime", "Bat"])).pointsOfInterest[2];
    expect(point?.zoneChange).toEqual({
      kind: "dungeon",
      dungeon: "Cave",
      dungeonFile: "Dungeon.plist",
      dungeonLevel: 3,
      targetZoneChange: "Entrance",
    });
    expect(point?.demoSkipped).toContain("dungeon");
  });

  it("rejects unknown dungeon descriptor keys and non-integer dungeon levels", () => {
    const dungeonSource = (descriptor: Record<string, unknown>) => fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { pointsOfInterest: Array<Record<string, unknown>> };
      raw.pointsOfInterest.push({
        type: "Outdoor.Generic",
        arguments: {
          instanceName: "Dungeon",
          position: "{400,100}",
          zoneChange: { type: "Generic", arguments: { targetZoneChange: "Entrance", dungeon: descriptor } },
        },
      });
      files.set("Demo.plist", raw);
      files.set("Dungeon.plist", {});
    });
    expect(() => loadWorldData(dungeonSource({ type: "Cave", arguments: "Dungeon.plist", invented: true }), "Demo", new Set(["Slime", "Bat"]))).toThrow(/unsupported key invented/);
    expect(() => loadWorldData(dungeonSource({ type: "Cave", arguments: "Dungeon.plist", dungeonLevel: 1.5 }), "Demo", new Set(["Slime", "Bat"]))).toThrow(/dungeonLevel must be an integer/);
  });

  it("retains fixed-only tiers as runnable data and accepts source string type entries", () => {
    const fixedOnly = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { pointsOfInterest: Array<{ arguments: Record<string, unknown> }> };
      const populator = ((raw.pointsOfInterest[1]!.arguments.encounters as { table: Record<string, { monsterPopulator: { arguments: Record<string, unknown> } }> }).table["1"]!.monsterPopulator.arguments);
      delete populator.types;
      files.set("Demo.plist", raw);
    });
    const fixed = loadWorldData(fixedOnly, "Demo", new Set(["Slime", "Bat"])).pointsOfInterest[1]!;
    expect(fixed.randomPopulators[0]).toMatchObject({
      types: [],
      fixedEncounters: [{ monsters: [{ type: "Slime" }] }],
    });
    expect(fixed.demoSkipped).not.toContain("fixedEncounter");

    const stringType = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as { pointsOfInterest: Array<{ arguments: Record<string, unknown> }> };
      const populator = ((raw.pointsOfInterest[1]!.arguments.encounters as { table: Record<string, { monsterPopulator: { arguments: Record<string, unknown> } }> }).table["1"]!.monsterPopulator.arguments);
      populator.types = ["Slime"];
      files.set("Demo.plist", raw);
    });
    expect(loadWorldData(stringType, "Demo", new Set(["Slime"])).pointsOfInterest[1]!.randomPopulators[0]!.types)
      .toEqual([{ type: "Slime", chance: 100 }]);
  });

  it("accepts source-tolerated empty encounter dictionaries without weakening typed rows", () => {
    const withEncounters = (encounters: Record<string, unknown>): WorldResourceSource =>
      fixture((files) => {
        const raw = structuredClone(files.get("Demo.plist")) as {
          pointsOfInterest: Array<{ arguments: Record<string, unknown> }>;
        };
        raw.pointsOfInterest[1]!.arguments.encounters = encounters;
        files.set("Demo.plist", raw);
      });

    for (const [encounters, hasEncounterTable] of [
      [{}, false],
      [{ table: {} }, true],
      [{ table: { "1": {} } }, true],
      [{ table: { "1": { monsterPopulator: {} } } }, true],
    ] as const) {
      const source = withEncounters(encounters);
      const point = loadWorldData(source, "Demo", new Set(["Slime", "Bat"]))
        .pointsOfInterest[1]!;
      expect(point.hasEncounterTable).toBe(hasEncounterTable);
      expect(point.randomPopulators).toEqual([]);
      // The archive's earlier fixed-chat census must tolerate the same shape.
      expect(() => collectWorldSpriteFiles(source)).not.toThrow();
    }

    for (const monsterPopulator of [
      { class: "DefaultMonsterPopulator" },
      { class: "DefaultMonsterPopulator", arguments: {} },
    ]) {
      const source = withEncounters({ table: { "1": { monsterPopulator } } });
      const point = loadWorldData(source, "Demo", new Set(["Slime", "Bat"]))
        .pointsOfInterest[1]!;
      expect(point.hasEncounterTable).toBe(true);
      expect(point.randomPopulators).toMatchObject([{
        tier: 1,
        minMonstersPerPack: 1,
        maxMonstersPerPack: 4,
        types: [],
        fixedEncounters: [],
      }]);
      expect(() => collectWorldSpriteFiles(source)).not.toThrow();
    }

    const unsafeExplicitEmptyTypes = withEncounters({
      table: {
        "1": {
          monsterPopulator: {
            class: "DefaultMonsterPopulator",
            arguments: { types: [] },
          },
        },
      },
    });
    expect(() => loadWorldData(
      unsafeExplicitEmptyTypes,
      "Demo",
      new Set(["Slime", "Bat"]),
    )).toThrow(/neither ordinary types nor fixed encounters/);
  });

  it("collects data-referenced bare sprites plus binary-owned world roles", () => {
    expect(collectWorldSpriteFiles(fixture())).toEqual(["demo.png", "empty.png", "ipadBorder.png", "walkArrow.png"]);
  });

  it("retains fixed-monster atlas-frame overrides without requiring a duplicate bare PNG", () => {
    const source = fixture((files) => {
      const raw = structuredClone(files.get("Demo.plist")) as {
        pointsOfInterest: Array<{ arguments: Record<string, unknown> }>;
      };
      const encounters = raw.pointsOfInterest[1]!.arguments.encounters as {
        table: Record<string, {
          monsterPopulator: {
            arguments: {
              fixedEncounters: Array<{ monsters: Array<Record<string, unknown>> }>;
            };
          };
        }>;
      };
      encounters.table["1"]!.monsterPopulator.arguments.fixedEncounters[0]!.monsters[0]!
        .extraLivingArguments = {
          rendererData: { class: "CCSprite", spriteFile: "fixedBoss.png" },
        };
      files.set("Demo.plist", raw);
    });
    const fixed = loadWorldData(source, "Demo", new Set(["Slime", "Bat"]))
      .pointsOfInterest[1]!.randomPopulators[0]!.fixedEncounters[0]!;
    expect(fixed.monsters[0]?.extraLivingArguments).toEqual({
      rendererData: { class: "CCSprite", spriteFile: "fixedBoss.png" },
    });
    expect(collectWorldSpriteFiles(source)).not.toContain("fixedBoss.png");
  });

  it("preserves town zoom/building/exit data in source order and projects every town sprite", () => {
    const source = fixture((files) => {
      files.set("PointsOfInterest.plist", {
        Outdoor: { Generic: { class: "PointOfInterest", rendererData: { class: "POINode", spriteFile: "empty.png" } } },
        Town: { Generic: { class: "TownPointOfInterest", rendererData: { class: "TownPOINode", spriteFile: "empty.png" } } },
      });
      const raw = structuredClone(files.get("Demo.plist")) as { pointsOfInterest: Array<Record<string, unknown>> };
      raw.pointsOfInterest.push({
        type: "Town.Generic",
        arguments: {
          instanceName: "First_City",
          position: "{231,78}",
          zoom: 3,
          buildings: [
            {
              class: "MonsterManagementMenuItem",
              position: "{5,-43}",
              spriteFile: "house4.png",
              iconSpriteFile: "monstersIcon.png",
              nameLabel: "ManagementNameKey",
              tutorialFlashKey: "FirstManagementFlash",
            },
            {
              class: "TavernMenuItem",
              arguments: { questGiver: "OrdinaryMan.png" },
              conditions: { chats: "LeslieSaved", quests: "!LiberateTownsQuest" },
              position: "{20,-20}",
              spriteFile: "house3.png",
              iconSpriteFile: "arenaIcon.png",
              nameLabel: "RenderableFirst_CityNameKey",
            },
            { fake: true, position: "{-20,20}", spriteFile: "house2.png" },
          ],
          exit: { position: "{-58,0}", spriteFile: "leaveTownIcon.png" },
          enterChats: [{ chatKey: "Welcome", conditions: { chats: "LeslieSaved" } }],
        },
      });
      files.set("Demo.plist", raw);
      files.set("Chats.plist", {
        Welcome: { alwaysShow: false, images: ["ClerkGirl.png"] },
      });
      for (const name of [
        "house4.png", "monstersIcon.png", "house3.png", "arenaIcon.png",
        "OrdinaryMan.png", "house2.png", "leaveTownIcon.png", "ClerkGirl.png",
      ]) files.set(name, true);
    });
    const town = loadWorldData(source, "Demo", new Set(["Slime", "Bat"])).pointsOfInterest[2]!.town;
    expect(town).toEqual({
      zoom: 3,
      buildings: [
        {
          sourceIndex: 0,
          className: "MonsterManagementMenuItem",
          position: { x: 5, y: -43 },
          spriteFile: "house4.png",
          iconSpriteFile: "monstersIcon.png",
          nameLabel: "ManagementNameKey",
          editable: true,
          tutorialFlashKey: "FirstManagementFlash",
          fake: false,
          hasConditions: false,
        },
        {
          sourceIndex: 1,
          className: "TavernMenuItem",
          position: { x: 20, y: -20 },
          spriteFile: "house3.png",
          iconSpriteFile: "arenaIcon.png",
          nameLabel: "RenderableFirst_CityNameKey",
          questGiver: "OrdinaryMan.png",
          conditions: { chats: "LeslieSaved", quests: "!LiberateTownsQuest" },
          fake: false,
          hasConditions: true,
        },
        {
          sourceIndex: 2,
          position: { x: -20, y: 20 },
          spriteFile: "house2.png",
          fake: true,
          hasConditions: false,
        },
      ],
      exit: { position: { x: -58, y: 0 }, spriteFile: "leaveTownIcon.png" },
      enterChats: [{
        chat: {
          name: "Welcome",
          alwaysShow: false,
          imageFile: "ClerkGirl.png",
          messageKeys: [],
        },
        requiredSeenChat: "LeslieSaved",
      }],
    });
    expect(collectWorldSpriteFiles(source)).toEqual([
      "ClerkGirl.png", "OrdinaryMan.png", "arenaIcon.png", "demo.png", "empty.png", "house2.png",
      "house3.png", "house4.png", "ipadBorder.png", "leaveTownIcon.png", "monstersIcon.png",
      "walkArrow.png",
    ]);
  });

  it("retains explicit menu editability and rejects unknown nested town-menu arguments", () => {
    const townSource = (argumentsValue: Record<string, unknown>) => fixture((files) => {
      files.set("PointsOfInterest.plist", {
        Outdoor: {
          Generic: {
            class: "PointOfInterest",
            rendererData: { class: "POINode", spriteFile: "empty.png" },
          },
          Town: {
            class: "TownPointOfInterest",
            rendererData: { class: "TownPOINode", spriteFile: "empty.png" },
          },
        },
      });
      const raw = structuredClone(files.get("Demo.plist")) as {
        pointsOfInterest: Array<Record<string, unknown>>;
      };
      raw.pointsOfInterest.push({
        type: "Outdoor.Town",
        arguments: {
          instanceName: "Town",
          position: "{100,100}",
          zoom: 3,
          buildings: [{
            class: "MonsterManagementMenuItem",
            arguments: argumentsValue,
            position: "{0,0}",
            spriteFile: "house.png",
            iconSpriteFile: "monsters.png",
            nameLabel: "ManagementNameKey",
          }],
          exit: { position: "{-20,0}", spriteFile: "exit.png" },
        },
      });
      files.set("Demo.plist", raw);
      for (const name of ["house.png", "monsters.png", "exit.png"]) files.set(name, true);
    });
    expect(
      loadWorldData(townSource({ editable: false }), "Demo", new Set(["Slime", "Bat"]))
        .pointsOfInterest[2]!.town!.buildings[0],
    ).toMatchObject({ className: "MonsterManagementMenuItem", editable: false });
    expect(() =>
      loadWorldData(townSource({ invented: true }), "Demo", new Set(["Slime", "Bat"])),
    ).toThrow(/unsupported key invented/);
  });

  it("fails if a referenced structural sprite is absent", () => {
    expect(() => collectWorldSpriteFiles(fixture((files) => files.delete("walkArrow.png")))).toThrow(WorldDataError);
  });
});
