import { describe, expect, it } from "vitest";
import {
  collectDungeonSpriteFiles,
  inspectDungeonCapability,
  loadDungeonData,
  parseDungeonTreasureData,
  selectDungeonFloorPopulation,
  type DungeonDefinition,
  type DungeonResourceSource,
} from "../src/dungeon.js";
import type { ItemDef } from "../src/types.js";

function capabilitySource(
  omit = new Set<string>(),
  audioExtension: ".m4a" | ".mp3" | ".wav" | undefined = undefined,
): DungeonResourceSource {
  const files = new Map<string, unknown>();
  const required = [
    "Dungeons.plist", "Rooms.plist", "ZoneChanges.plist", "Sparkle.plist",
    "HeroWalkFrames-hd.plist", "HeroWalkFrames-hd.png",
    "InventoryItemFrames-hd.plist", "InventoryItemFrames-hd.png", "MonsterPortraits-hd.plist", "MonsterPortraits-hd.png",
    "General-hd.plist", "General-hd.png",
    "downArrow.png", "downArrow-hd.png", "menuButton.png", "menuButton-hd.png",
    "TestDungeonRoomFrames-hd.plist", "TestDungeonRoomFrames-hd.png", "Dungeon_1.plist",
  ];
  for (const path of required) if (!omit.has(path)) files.set(path, true);
  for (const [stem, originalExtension] of [
    ["Dungeon1", ".mp3"],
    ["Dungeon2", ".mp3"],
    ["Encounter", ".m4a"],
    ["Stairs_EnterDungeon", ".m4a"],
  ] as const) {
    const path = `${stem}${audioExtension ?? originalExtension}`;
    if (!omit.has(path)) files.set(path, true);
  }
  files.set("Dungeon_1.plist", { populatorData: {} });
  files.set("Dungeons.plist", {
    Test: {
      spritesheets: ["TestDungeonRoomFrames"],
      floorRendererData: { spriteFrameFormat: "floor%d.png", spriteFrameCount: 1 },
    },
  });
  return { has: (path) => files.has(path), plist: (path) => files.get(path), list: () => [...files.keys()] };
}

function capabilitySourceWithResolvedGeneralBacking(): DungeonResourceSource {
  const source = capabilitySource(new Set(["General-hd.png"]));
  const listed = new Set(source.list!());
  listed.add("General-custom.png");
  return {
    has: (path) => path === "General-custom.png" || source.has(path),
    plist: source.plist,
    list: () => [...listed],
    resolveAtlasBackingFile: (path) => path === "General-hd.plist"
      ? "General-custom.png"
      : "TestDungeonRoomFrames-hd.png",
  };
}

function capabilitySourceWithResolver(
  resolve: (atlasPath: string) => unknown,
  extraFiles: readonly string[] = [],
): DungeonResourceSource {
  const source = capabilitySource();
  const listed = new Set(source.list!());
  for (const path of extraFiles) listed.add(path);
  return {
    has: (path) => listed.has(path),
    plist: source.plist,
    list: () => [...listed],
    resolveAtlasBackingFile: (path) => resolve(path) as string,
  };
}

function presentationSourceWithResolvedDungeonBacking(): DungeonResourceSource {
  const creationData = {
    lastFloor: 1,
    density: 1,
    roomsMin: 1,
    roomsMax: 1,
    retryChance: 0,
    doorCycleAttempts: 0,
    nonHallwaysNeeded: 0,
    waypointEvery: 0,
    monsterLevelBase: 1,
    monsterLevelFloorScalor: 0,
    defaultItemSpawnChance: 0.25,
    roomChoiceBiasClass: "DefaultRoomChoiceBias",
    roomChoiceBiasArguments: { biasDirection: "{0,0}", biasRandom: false },
    roomTypes: { Basic: {} },
  };
  const files = new Map<string, unknown>([
    ["Dungeons.plist", {
      Test: {
        class: "Dungeon",
        combatBackground: "ForestCombat.png",
        creationData: { roomTypes: { Basic: {} } },
        doorRendererData: { spriteFrameFormat: "door%d.png", spriteFrameCount: 1 },
        floorRendererData: { spriteFrameFormat: "floor%d.png", spriteFrameCount: 1 },
        northDoorRendererData: { class: "CCSprite", anchor: "{0,0}", spriteFrame: "north.png" },
        spritesheets: ["DungeonFrames"],
        wallRendererData: { spriteFrameFormat: "wall%d.png", spriteFrameCount: 1, wallItemCount: 0 },
      },
    }],
    ["Rooms.plist", {
      Basic: {
        class: "Room",
        dimensions: "{1,1}",
        frequency: 1,
        rendererData: { class: "RoomNode", anchor: "{0,0}" },
        roomImageRendererData: { rotations: [] },
      },
    }],
    ["ZoneChanges.plist", {}],
    ["Dungeon_1.plist", {
      instanceName: "TestDungeon",
      mustClearFloor: false,
      creationData,
      populatorData: {},
    }],
    ["DungeonFrames-hd.plist", { frames: {}, metadata: { size: "{1,1}" } }],
    ["DungeonFrames-custom.png", true],
    ["ForestCombat.png", true],
  ]);
  return {
    has: (path) => files.has(path),
    plist: (path) => files.get(path),
    list: () => [...files.keys()],
    resolveAtlasBackingFile: (path) => {
      if (path === "DungeonFrames-hd.plist") return "DungeonFrames-custom.png";
      throw new Error(`unexpected atlas ${path}`);
    },
  };
}

describe("dungeon capability boundary", () => {
  it("requires the complete source data, UI, audio, and HD atlas role set", () => {
    expect(inspectDungeonCapability(capabilitySource())).toEqual({
      available: true,
      dungeonTypes: ["Test"],
      dungeonFiles: ["Dungeon_1.plist"],
      missing: [],
    });
    const partial = inspectDungeonCapability(capabilitySource(new Set(["menuButton.png", "Dungeon2.mp3"])));
    expect(partial.available).toBe(false);
    expect(partial.missing).toEqual(["Dungeon2 audio", "menuButton.png"]);
  });

  it("accepts WAV for every strict dungeon audio stem", () => {
    expect(inspectDungeonCapability(capabilitySource(new Set(), ".wav"))).toMatchObject({
      available: true,
      missing: [],
    });
  });

  it("uses the caller-resolved General atlas backing when provided", () => {
    expect(inspectDungeonCapability(capabilitySourceWithResolvedGeneralBacking())).toMatchObject({
      available: true,
      missing: [],
    });
  });

  it.each([
    ["General", "General-hd.png"],
    ["declared dungeon", "TestDungeonRoomFrames-hd.png"],
  ] as const)("reports a missing literal backing for a present %s descriptor", (_label, backing) => {
    const source = capabilitySource(new Set([backing]));
    expect(source.resolveAtlasBackingFile).toBeUndefined();
    const report = inspectDungeonCapability(source);
    expect(report.available).toBe(false);
    expect(report.missing).toEqual([backing]);
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["missing", "Missing-atlas.png"],
    ["invalid", "General-hd.jpg"],
  ] as const)("fails loudly when the installed resolver returns %s", (_label, result) => {
    expect(() => inspectDungeonCapability(
      capabilitySourceWithResolver(() => result, result === "General-hd.jpg" ? [result] : []),
    )).toThrow();
  });

  it.each([
    ["General", "General-hd.plist", "General-hd.png"],
    ["declared dungeon", "TestDungeonRoomFrames-hd.plist", "TestDungeonRoomFrames-hd.png"],
  ] as const)("reports a missing %s atlas descriptor without fabricating its backing", (_label, descriptor, backing) => {
    const report = inspectDungeonCapability(capabilitySource(new Set([descriptor, backing])));
    expect(report.available).toBe(false);
    expect(report.missing).toContain(descriptor);
    expect(report.missing).not.toContain(backing);
  });

  it.each([
    ["General", "General-hd.plist", "General-hd.png"],
    ["declared dungeon", "TestDungeonRoomFrames-hd.plist", "TestDungeonRoomFrames-hd.png"],
  ] as const)("does not call an installed resolver for a missing %s atlas descriptor", (_label, descriptor, backing) => {
    const base = capabilitySource(new Set([descriptor]));
    const calls: string[] = [];
    const source: DungeonResourceSource = {
      has: base.has,
      plist: base.plist,
      list: base.list!,
      resolveAtlasBackingFile: (path) => {
        calls.push(path);
        return path === "General-hd.plist" ? "General-hd.png" : "TestDungeonRoomFrames-hd.png";
      },
    };
    const report = inspectDungeonCapability(source);
    expect(report.available).toBe(false);
    expect(report.missing).toEqual([descriptor]);
    expect(calls).not.toContain(descriptor);
  });

  it("uses a resolved declared dungeon atlas backing when loading presentation", () => {
    const definition = loadDungeonData(
      presentationSourceWithResolvedDungeonBacking(),
      "Test",
      "Dungeon_1.plist",
      1,
      new Set(),
    );
    expect(definition.presentation.atlasNames).toEqual(["DungeonFrames"]);
  });

  it("fails loudly when a no-resolver source omits the declared dungeon atlas PNG", () => {
    const resolvedSource = presentationSourceWithResolvedDungeonBacking();
    const sourceWithoutResolver: DungeonResourceSource = {
      has: resolvedSource.has,
      plist: resolvedSource.plist,
      list: resolvedSource.list!,
    };
    expect(sourceWithoutResolver.has("DungeonFrames-hd.png")).toBe(false);
    expect(() => loadDungeonData(
      sourceWithoutResolver,
      "Test",
      "Dungeon_1.plist",
      1,
      new Set(),
    )).toThrow(/DungeonFrames-hd\.png/);
  });

  it("projects binary-owned navigation/chrome sprites and optional theme backgrounds", () => {
    const source = capabilitySource();
    const dungeonRegistry = source.plist("Dungeons.plist") as Record<string, Record<string, unknown>>;
    dungeonRegistry.Test!.floorRendererData = {
      spriteFrameFormat: "floor%d.png", spriteFrameCount: 1, backgroundImage: "mist.png",
    };
    const listed = new Set(source.list!());
    listed.add("mist.png"); listed.add("mist-hd.png");
    const wrapped: DungeonResourceSource = {
      has: (path) => listed.has(path), plist: source.plist.bind(source), list: () => [...listed],
    };
    expect(collectDungeonSpriteFiles(wrapped)).toContain("menuButton.png");
    expect(collectDungeonSpriteFiles(wrapped)).toContain("menuButton-hd.png");
    expect(collectDungeonSpriteFiles(wrapped)).not.toContain("dungeonMovement.png");
    expect(collectDungeonSpriteFiles(wrapped)).toContain("mist-hd.png");
  });

  it("projects fixed-encounter chat portraits while renderer overrides remain atlas frames", () => {
    const source = capabilitySource();
    const files = new Map(source.list!().map((path) => [path, source.plist(path)]));
    files.set("Chats.plist", {
      Guardian: { images: ["guardianPortrait.png"], messages: ["GuardianLine"] },
    });
    files.set("guardianPortrait.png", true);
    files.set("guardianBoss.png", true);
    files.set("Dungeon_1.plist", {
      populatorData: {
        "1": {
          monsterPopulator: {
            class: "DefaultMonsterPopulator",
            arguments: {
              fixedEncounters: [{
                exactFloor: 1,
                monsters: [{
                  type: "Guardian",
                  extraLivingArguments: {
                    rendererData: { class: "CCSprite", spriteFile: "guardianBoss.png" },
                  },
                }],
                startEvent: { class: "ChatGameFlowEvent", chatKey: "Guardian" },
              }],
            },
          },
        },
      },
    });
    const wrapped: DungeonResourceSource = {
      has: (path) => files.has(path),
      plist: (path) => files.get(path),
      list: () => [...files.keys()],
    };
    expect(collectDungeonSpriteFiles(wrapped)).toContain("guardianPortrait.png");
    expect(collectDungeonSpriteFiles(wrapped)).not.toContain("guardianBoss.png");
  });

  it("selects monster and treasure population thresholds independently", () => {
    const definition = { floorPopulations: [
      {
        sourceFloor: 1,
        monsterPopulator: { className: "DefaultMonsterPopulator", minMonstersPerPack: 1,
          maxMonstersPerPack: 1, levelScalor: 1, density: 0,
          types: [{ type: "Slime", chance: 1 }], fixedEncounters: [] },
        treasurePopulator: { className: "DefaultTreasurePopulator", unguardedTreasureChance: 0.05,
          treasureData: { levelScalor: 1, items: [] } },
        zoneChanges: [],
      },
      {
        sourceFloor: 4,
        monsterPopulator: { className: "DefaultMonsterPopulator", minMonstersPerPack: 1,
          maxMonstersPerPack: 1, levelScalor: 1, density: 0,
          types: [{ type: "Bat", chance: 1 }], fixedEncounters: [] },
        zoneChanges: [],
      },
      {
        sourceFloor: 9,
        treasurePopulator: { className: "DefaultTreasurePopulator", unguardedTreasureChance: 0.05,
          treasureData: { levelScalor: 1, items: [] } },
        zoneChanges: [],
      },
    ] } satisfies Pick<DungeonDefinition, "floorPopulations">;
    expect(selectDungeonFloorPopulation(definition, 3, "monsterPopulator")?.sourceFloor).toBe(1);
    expect(selectDungeonFloorPopulation(definition, 4, "monsterPopulator")?.sourceFloor).toBe(4);
    expect(selectDungeonFloorPopulation(definition, 8, "treasurePopulator")?.sourceFloor).toBe(1);
    expect(selectDungeonFloorPopulation(definition, 200, "treasurePopulator")?.sourceFloor).toBe(9);
  });

  it("resolves arbitrary fixed Item rewards through Items.plist and preserves definition level precedence", () => {
    const healingCard = itemDef("Usables.ModHealingCard", "Item", { level: 7 });
    const parsed = parseDungeonTreasureData({
      items: [{
        spawnType: "fixed",
        data: { type: healingCard.path, arguments: { level: 99 } },
      }],
    }, "Quest.reward", 1, {
      item: (path) => {
        if (path !== healingCard.path) throw new Error("missing item");
        return healingCard;
      },
    });

    expect(parsed.items[0]).toMatchObject({
      kind: "fixed",
      data: {
        kind: "usable",
        definitionPath: "Usables.ModHealingCard",
        instanceName: "ModHealingCard",
        level: 7,
      },
    });
  });

  it("accepts the catalog Clone Egg arguments and rejects undeclared fixed paths", () => {
    const repeatEgg = itemDef("DestroyOnPickup.RepeatEgg", "Egg");
    const reward = {
      items: [{
        spawnType: "fixed",
        data: { type: repeatEgg.path, arguments: { numRepeats: 3 } },
      }],
    };
    expect(parseDungeonTreasureData(reward, "Quest.reward", 1, {
      item: () => repeatEgg,
    }).items[0]).toMatchObject({
      data: {
        kind: "repeatEgg",
        definitionPath: "DestroyOnPickup.RepeatEgg",
        numRepeats: 3,
      },
    });
    expect(() => parseDungeonTreasureData(reward, "Quest.reward", 1, {
      item: () => { throw new Error("missing item"); },
    })).toThrow(/not defined in Items\.plist/);
  });
});

function itemDef(
  path: string,
  className: ItemDef["className"],
  extra: Partial<ItemDef> = {},
): ItemDef {
  return Object.freeze({
    path,
    instanceName: path.slice(path.lastIndexOf(".") + 1),
    className,
    slot: className === "Item" ? "Useable" : "Other",
    abilities: Object.freeze([]),
    enabledStats: Object.freeze([]),
    holderBuffs: Object.freeze([]),
    repeats: false,
    onlyMonsters: false,
    ...extra,
  });
}
