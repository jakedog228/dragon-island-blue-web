import { describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { build, buildBinary, parse as parsePlist } from "plist";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  ContentArchiveError,
  importContentArchive,
  importedResourceMimeType,
} from "../src/content/archivePackage.js";
import { GameData, loadWorldData } from "@dib/gamedata/browser";
import { loadDungeonData } from "@dib/gamedata/dungeon";

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([73, 72, 68, 82], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
const eggLocalization = {
  WinPrizeTitleFormatKey: "You won %@",
  WonMonsterMessageKey: "A monster hatched.",
  KeepKey: "Keep",
  FeedToButtonKey: "Feed To",
  CancelButtonKey: "Cancel",
  SpinFedFullMessageFormatKey: "%@ could not be fed.",
  SpinFedMessageFormatKey: "%@ was fed.",
  SpinAgainMessageKey: "You won %@. Spin again?",
  SpinFinishedMessageFormatKey: "You won %@.",
  SpinAgainTitleKey: "Spin Again?",
  SpinFinishedTitleKey: "Finished",
  YesGoldFormatKey: "Yes (%d Gold)",
  CannotAffordThingTitleKey: "Cannot Afford",
  CannotAffordThingMessageKey: "You do not have enough gold.",
  RenderableGoldNameKey: "%d Gold",
  RenderableSilverNameKey: "%d Silver",
  RenderableRecipeNameKey: "%@ Recipe",
  RenderableSpiritTotemNameKey: "%@ Totem",
  NoviceSlotKey: "Novice",
  VeteranSlotKey: "Veteran",
  EliteSlotKey: "Elite",
  GemItemLevel1Key: "Gem I",
  GemItemLevel2Key: "Gem II",
  GemItemLevel3Key: "Gem III",
  GemItemLevel4Key: "Gem IV",
  GemItemLevel5Key: "Gem V",
  GemItemLevel6Key: "Gem VI",
} as const;

function plist(value: Parameters<typeof build>[0]): Uint8Array {
  return strToU8(build(value));
}

function fixture(prefix: string, binaryMonsters = false): Uint8Array {
  const monsters = {
    RootMonster: { class: "Monster", category: "Normal" },
    Fire: {
      Testling: {
        parent: "RootMonster",
        element: "Fire",
        index: 1,
        quality: 1,
        stars: 1,
        rootStats: { Attack: 1, Defense: 1, Magic: 1, MaxHP: 10, Resist: 1, Speed: 1 },
        unarmedAttackType: "Impact",
      },
    },
  };
  const heroFrames: Record<string, Parameters<typeof build>[0]> = {};
  for (const direction of ["Front", "Back", "Left", "Right"]) {
    for (let index = 1; index <= 8; index++) {
      heroFrames[`herowalk${direction}_${index}.png`] = {
        frame: "{{0,0},{1,1}}", sourceColorRect: "{{0,0},{1,1}}", sourceSize: "{1,1}", rotated: false,
      };
    }
  }
  const generalFrames = Object.fromEntries(["heroXpFrame.png", "heroXpBar.png"].map((name) => [name, {
    frame: "{{0,0},{1,1}}", sourceColorRect: "{{0,0},{1,1}}", sourceSize: "{1,1}", rotated: false,
  }]));
  const atlasFrame = {
    frame: "{{0,0},{1,1}}",
    sourceColorRect: "{{0,0},{1,1}}",
    sourceSize: "{1,1}",
    rotated: false,
  };
  const inventoryFrames = Object.fromEntries([
    "pileGold.png",
    "pileSilver.png",
    "Item_Recipe.png",
    "Item_Totem.png",
    "Item_Card2.png",
    "Item_Card3.png",
    "NoviceGem1.png",
    "NoviceGemGlow.png",
    "VeteranGem1.png",
    "VeteranGemGlow.png",
    "EliteGem1.png",
    "EliteGemGlow.png",
  ].map((name) => [name, atlasFrame]));
  const entries: Record<string, Uint8Array> = {
    [`${prefix}Monsters.plist`]: binaryMonsters ? buildBinary(monsters) : plist(monsters),
    [`${prefix}Combines.plist`]: plist({}),
    [`${prefix}Jobs.plist`]: plist({}),
    [`${prefix}Abilities.plist`]: plist({}),
    [`${prefix}AbilityComponents.plist`]: plist({}),
    [`${prefix}Buffs.plist`]: plist({}),
    [`${prefix}Animations.plist`]: plist({}),
    [`${prefix}Scale9Sprites.plist`]: plist({
      MenuButton2: { image: "PopupMenuButton2.png", contentRect: "{{9,6},{84,17}}" },
      PopupBackgroundThin: { image: "PopupBackgroundThin.png", contentRect: "{{20,20},{42,14}}" },
    }),
    [`${prefix}Credits.plist`]: plist([{ type: "title", value: "CreditsButtonKey" }]),
    [`${prefix}Info.plist`]: plist({ CFBundleShortVersionString: "1.1.0" }),
    [`${prefix}Worlds.plist`]: plist({
      Harbor: { class: "World", rendererData: { class: "CCSprite", spriteFile: "harbor.png" } },
    }),
    [`${prefix}Harbor.plist`]: plist({ challengeLevel: 1, combatBackground: "ForestCombat.png", connections: [], pointsOfInterest: [] }),
    [`${prefix}PointsOfInterest.plist`]: plist({ Outdoor: { Generic: { class: "PointOfInterest", rendererData: { class: "POINode", spriteFile: "empty.png" } } } }),
    [`${prefix}HeroWalkFrames-hd.plist`]: plist({ frames: heroFrames, metadata: { size: "{1,1}", realTextureFileName: "HeroWalkFrames-hd.png" } }),
    [`${prefix}General-hd.plist`]: plist({ frames: generalFrames, metadata: { size: "{1,1}", realTextureFileName: "General-hd.png" } }),
    [`${prefix}InventoryItemFrames-hd.plist`]: plist({
      frames: inventoryFrames,
      metadata: { size: "{1,1}", realTextureFileName: "InventoryItemFrames-hd.png" },
    }),
    [`${prefix}MonsterpediaFrames-hd.plist`]: plist({
      frames: { "rarityStar.png": atlasFrame },
      metadata: { size: "{1,1}", realTextureFileName: "MonsterpediaFrames-hd.png" },
    }),
    [`${prefix}en.lproj/Localizable.strings`]: plist({
      LevelShortKey: "Lv",
      LoadingKey: "Loading Please Wait",
      "First-Time Loading On 3GS May Take A While": "First-Time Loading On 3GS May Take A While",
      TouchToContinueKey: "Touch To Continue",
      PickSaveSlotKey: "Pick Save Slot",
      NewGameButtonKey: "New Game",
      GameDisplayFormatKey: "Level %d @ %@",
      EraseGameButtonKey: "Erase Game",
      CreditsButtonKey: "Credits",
      OptionsKey: "Options",
      BackButtonKey: "Back",
      PickEraseSaveSlotKey: "ERASE which save slot?",
      EraseGameAreYouSureTitleKey: "Erase Game?",
      EraseGameAreYouSureMessageKey: "Are you sure?",
      YesButtonKey: "Yes",
      NoButtonKey: "No",
      MusicVolumeKey: "Music",
      SoundVolumeKey: "Sound",
      OkButtonKey: "Ok",
      ...eggLocalization,
    }),
    [`${prefix}README.txt`]: strToU8("Operator-authored content\n"),
    [`${prefix}ForestCombat.png`]: png,
    [`${prefix}mainscreenBackground.png`]: png,
    [`${prefix}saveSlotBackground.png`]: png,
    [`${prefix}plot_start1.png`]: png,
    [`${prefix}fieldMovement.png`]: png,
    [`${prefix}PopupMenuButton2-hd.png`]: png,
    [`${prefix}PopupBackgroundThin-hd.png`]: png,
    [`${prefix}ClerkGirl-hd.png`]: png,
    [`${prefix}TutorialRightSide-hd.png`]: png,
    [`${prefix}harbor.png`]: png,
    [`${prefix}empty.png`]: png,
    [`${prefix}walkArrow.png`]: png,
    [`${prefix}ipadBorder.png`]: png,
    [`${prefix}greenFlag-hd.png`]: png,
    [`${prefix}redFlag-hd.png`]: png,
    [`${prefix}blueFlag-hd.png`]: png,
    [`${prefix}menuButton-hd.png`]: png,
    [`${prefix}namePlate-hd.png`]: png,
    [`${prefix}bigmap.png`]: png,
    [`${prefix}bookPage.png`]: png,
    [`${prefix}leaveIcon.png`]: png,
    [`${prefix}Icon.png`]: png,
    [`${prefix}Icon@2x.png`]: png,
    [`${prefix}HeroWalkFrames-hd.png`]: png,
    [`${prefix}General-hd.png`]: png,
    [`${prefix}InventoryItemFrames-hd.png`]: png,
    [`${prefix}MonsterpediaFrames-hd.png`]: png,
    [`${prefix}SlotBackground-hd.png`]: pngHeader(960, 640),
    [`${prefix}SlotBackground-ipadhd.png`]: pngHeader(1024, 768),
    [`${prefix}SlotBacking-hd.png`]: pngHeader(364, 203),
    [`${prefix}SlotBacking-ipadhd.png`]: pngHeader(426, 238),
    [`${prefix}SlotArrow-hd.png`]: pngHeader(94, 62),
    [`${prefix}largeRarityStar-hd.png`]: pngHeader(64, 59),
    [`${prefix}Field1.mp3`]: new Uint8Array([0x49, 0x44, 0x33]),
    [`${prefix}Opening1.mp3`]: new Uint8Array([0x49, 0x44, 0x33]),
    [`${prefix}Casino1.mp3`]: new Uint8Array([0x49, 0x44, 0x33]),
    [`${prefix}click.m4a`]: new Uint8Array([0, 0, 0, 0]),
    [`${prefix}Testling-hd.png`]: png,
    [`${prefix}ASSET_PROVENANCE.csv`]: strToU8("destination_path,status\nTestling-hd.png,approved\n"),
    // Must be ignored: importing content resources never retains or executes an app binary.
    [`${prefix}SomeExecutable`]: new Uint8Array([1, 2, 3]),
  };
  return zipSync(entries);
}

function collectionRouteFiles(): Record<string, Uint8Array> {
  const files = unzipSync(fixture(""));
  files["PointsOfInterest.plist"] = plist({
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
  files["Harbor.plist"] = plist({
    challengeLevel: 1,
    combatBackground: "ForestCombat.png",
    connections: [],
    pointsOfInterest: [{
      type: "Outdoor.CollectionHut",
      arguments: {
        instanceName: "Collection_Hut",
        position: "{100,100}",
        menuClass: "MonsterCollectionMenuItem",
        menuArguments: { collectionType: "Base" },
      },
    }],
  });
  files["Collection.plist"] = plist({
    Base: [{
      key: "Collector",
      monsters: ["Testling"],
      treasureData: { items: [{ spawnType: "gold" }] },
    }],
  });
  return files;
}

function replaceAudioStem(
  files: Record<string, Uint8Array>,
  audioStem: string,
  extension: ".m4a" | ".mp3" | ".wav",
): void {
  for (const candidate of [".m4a", ".mp3", ".wav"] as const) delete files[`${audioStem}${candidate}`];
  files[`${audioStem}${extension}`] = new Uint8Array([1, 2, 3, 4]);
}

function addCollectionPresentationRoles(files: Record<string, Uint8Array>): void {
  addCollectionBasePresentationRoles(files);
  const strings = parsePlist(
    new TextDecoder().decode(files["en.lproj/Localizable.strings"]!),
  );
  files["en.lproj/Localizable.strings"] = plist({
    ...(strings as Record<string, unknown>),
    CollectionGoalKey: "Collection Goal",
    AlreadyFinishedCollectionQuestTitleKey: "Already Finished",
    AlreadyFinishedCollectionQuestMessageKey: "This collection is already finished.",
    CollectorCollectionQuestTitleKey: "Collector",
    CollectorCollectionQuestDescriptionKey: "Collect this monster.",
    NewItemsKey: "New Items",
    TakeAllKey: "Take All",
    ExtraDescriptionGold: "Gold reward.",
    PopupMenuCloseButtonKey: "Close",
  });
  files["rightArrow-hd.png"] = png;
}

function addCollectionBasePresentationRoles(files: Record<string, Uint8Array>): void {
  const strings = parsePlist(
    new TextDecoder().decode(files["en.lproj/Localizable.strings"]!),
  );
  files["en.lproj/Localizable.strings"] = plist({
    ...(strings as Record<string, unknown>),
    CollectionHutListTitleKey: "Collection Hut",
    MonsterCollectionChatKey: "Welcome to the collection hut.",
  });
  for (const name of ["PopupMenuCloseButton-hd.png", "downArrow-hd.png"]) {
    files[name] = png;
  }
  files["arial_18_bold-hd.fnt"] = strToU8('info face="Arial" size=18\npage id=0 file="arial_18_bold.png"\n');
  files["arial_18_bold-hd.png"] = png;
}

function addCollectionGoalPresentationRoles(files: Record<string, Uint8Array>): void {
  const strings = parsePlist(
    new TextDecoder().decode(files["en.lproj/Localizable.strings"]!),
  );
  files["en.lproj/Localizable.strings"] = plist({
    ...(strings as Record<string, unknown>),
    CollectionGoalKey: "Collection Goal",
    AlreadyFinishedCollectionQuestTitleKey: "Already Finished",
    AlreadyFinishedCollectionQuestMessageKey: "This collection is already finished.",
    CollectorCollectionQuestTitleKey: "Collector",
    CollectorCollectionQuestDescriptionKey: "Collect this monster.",
  });
}

function setCollectionReward(
  files: Record<string, Uint8Array>,
  spawnType: "gold" | "randomGem" | "random" | "fixed",
  chance?: number,
): void {
  const item = {
    spawnType,
    ...(chance === undefined ? {} : { chance }),
    ...(spawnType === "fixed"
      ? { data: { type: "DestroyOnPickup.SpiritTotem", arguments: { shortType: "Fire" } } }
      : {}),
  };
  files["Collection.plist"] = plist({
    Base: [{
      key: "Collector",
      monsters: ["Testling"],
      treasureData: { items: [item] },
    }],
  });
  if (spawnType === "fixed") {
    const items = files["Items.plist"] === undefined
      ? {}
      : parsePlist(new TextDecoder().decode(files["Items.plist"]!)) as Record<string, unknown>;
    files["Items.plist"] = plist({
      ...items,
      SoulStones: Object.fromEntries([
        "Life", "Death", "Water", "Fire", "Earth", "Air", "Arcane",
      ].map((element) => [`${element}SoulStone`, {
        class: "SoulStone",
        slot: "Monster",
        stats: {},
      }])),
      DestroyOnPickup: {
        SpiritTotem: {
          class: "SpiritTotem",
          slot: "Other",
          rendererData: { class: "CCSprite", spriteFrame: "Item_Totem.png" },
        },
      },
    });
  }
}

function addMinimalDungeonCapability(
  files: Record<string, Uint8Array>,
  generalBacking = "General-hd.png",
  dungeonBacking = "DungeonFrames-hd.png",
): void {
  const frame = {
    frame: "{{0,0},{1,1}}",
    sourceColorRect: "{{0,0},{1,1}}",
    sourceSize: "{1,1}",
    rotated: false,
  };
  files["Dungeons.plist"] = plist({
    TestDungeon: {
      class: "Dungeon",
      combatBackground: "ForestCombat.png",
      spritesheets: ["DungeonFrames"],
      creationData: { roomTypes: { Basic: {} } },
      floorRendererData: { spriteFrameFormat: "floor%d.png", spriteFrameCount: 1 },
      wallRendererData: { spriteFrameFormat: "wall%d.png", spriteFrameCount: 1, wallItemCount: 0 },
      doorRendererData: { spriteFrameFormat: "door%d.png", spriteFrameCount: 1 },
      northDoorRendererData: { class: "CCSprite", anchor: "{0,0}", spriteFrame: "north.png" },
    },
  });
  files["Rooms.plist"] = plist({ Basic: {
    class: "Room",
    dimensions: "{1,1}",
    frequency: 1,
    rendererData: { class: "RoomNode", anchor: "{0,0}" },
    roomImageRendererData: { rotations: [] },
  } });
  files["ZoneChanges.plist"] = plist({});
  files["Dungeon_1.plist"] = plist({
    instanceName: "TestDungeon",
    mustClearFloor: false,
    creationData: {
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
    },
    populatorData: {},
  });
  files["DungeonFrames-hd.plist"] = plist({
    frames: Object.fromEntries([
      "floor1.png", "wall1.png", "door1.png", "north.png", "chest.png", "portal.png",
      "stairsUp.png", "stairsDown.png",
    ].map((name) => [name, frame])),
    metadata: { size: "{1,1}", realTextureFileName: dungeonBacking },
  });
  files["DungeonFrames-hd.png"] = png;
  if (dungeonBacking !== "DungeonFrames-hd.png") {
    delete files["DungeonFrames-hd.png"];
    files[dungeonBacking] = png;
  }
  files["MonsterPortraits-hd.plist"] = plist({
    frames: {},
    metadata: { size: "{1,1}", realTextureFileName: "MonsterPortraits-hd.png" },
  });
  files["MonsterPortraits-hd.png"] = png;
  for (const name of ["downArrow.png", "downArrow-hd.png", "menuButton.png", "menuButton-hd.png"]) {
    files[name] = png;
  }
  files["Dungeon1.mp3"] = new Uint8Array([0x49, 0x44, 0x33]);
  files["Dungeon2.mp3"] = new Uint8Array([0x49, 0x44, 0x33]);
  files["Encounter.m4a"] = new Uint8Array([0, 0, 0, 0]);
  files["Stairs_EnterDungeon.m4a"] = new Uint8Array([0, 0, 0, 0]);
  files["particleTexture.png"] = png;
  files["Sparkle.plist"] = plist({
    maxParticles: 18,
    particleLifespan: 0.8553,
    particleLifespanVariance: 0.06,
    duration: -1,
    emitterType: 0,
    angle: 0,
    angleVariance: 360,
    speed: 10,
    speedVariance: 0.1,
    gravityx: 0,
    gravityy: 0,
    startParticleSize: 2,
    startParticleSizeVariance: 9,
    finishParticleSize: 16.8421059,
    finishParticleSizeVariance: 0,
    rotationStart: 0,
    rotationStartVariance: 0,
    rotationEnd: 0,
    rotationEndVariance: 0,
    startColorRed: 0.8,
    startColorGreen: 0.8,
    startColorBlue: 0,
    startColorAlpha: 1,
    finishColorRed: 1,
    finishColorGreen: 1,
    finishColorBlue: 0,
    finishColorAlpha: 0,
    blendFuncSource: 770,
    blendFuncDestination: 1,
    textureFileName: "particleTexture.png",
  });
  for (const name of ["Egg.png", "MonsterEgg.png"]) {
    const inventory = parsePlist(new TextDecoder().decode(files["InventoryItemFrames-hd.plist"]!)) as {
      frames: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
    inventory.frames[name] = frame;
    files["InventoryItemFrames-hd.plist"] = plist(inventory as Parameters<typeof build>[0]);
  }
  if (generalBacking !== "General-hd.png") {
    const general = parsePlist(new TextDecoder().decode(files["General-hd.plist"]!)) as {
      frames: Record<string, unknown>;
      metadata: Record<string, unknown>;
    };
    general.metadata.realTextureFileName = generalBacking;
    files["General-hd.plist"] = plist(general as Parameters<typeof build>[0]);
    delete files["General-hd.png"];
    files[generalBacking] = png;
  }
}

function addGeneralStatFrames(files: Record<string, Uint8Array>): void {
  const general = parsePlist(
    new TextDecoder().decode(files["General-hd.plist"]!),
  ) as { frames: Record<string, unknown>; metadata: Record<string, unknown> };
  const frame = {
    frame: "{{0,0},{1,1}}",
    sourceColorRect: "{{0,0},{1,1}}",
    sourceSize: "{1,1}",
    rotated: false,
  };
  for (const name of ["StatMaxHP.png", "StatAttack.png", "StatMagic.png", "StatSpeed.png", "StatDefense.png", "StatResist.png"]) {
    general.frames[name] = frame;
  }
  files["General-hd.plist"] = plist(general as Parameters<typeof build>[0]);
}

function collectionRouteFilesWithRoles(): Record<string, Uint8Array> {
  const files = collectionRouteFiles();
  addCollectionPresentationRoles(files);
  return files;
}

describe("local IPA/ZIP content importer", () => {
  const repositoryRoot = resolve(import.meta.dirname, "../../..");
  const localIpa = readdirSync(repositoryRoot).find((name) => name.toLowerCase().endsWith(".ipa"));

  it("accepts any app-directory name through the same structural path", () => {
    const first = importContentArchive(fixture("Payload/First.app/"), "first.ipa");
    const second = importContentArchive(fixture("Payload/UnrelatedName.app/"), "custom.zip");
    try {
      expect(first.sourceKind).toBe("app-archive");
      expect(second.sourceKind).toBe("app-archive");
      expect(first.appDirectory).toBe("Payload/First.app");
      expect(second.appDirectory).toBe("Payload/UnrelatedName.app");
      expect(Object.keys(first.data.monsters)).toEqual(Object.keys(second.data.monsters));
      expect(first.manifest.sprites).toEqual(second.manifest.sprites);
      expect(first.combatBackgroundKeys).toEqual(["ForestCombat"]);
      expect(first.worldNames).toEqual(["Harbor"]);
      expect(first.hasTownCapability).toBe(false);
      expect(first.manifest.sprites.harbor).toBe("archive/harbor.png");
      expect(first.manifest.sprites.bigmap).toBe("archive/bigmap.png");
      expect(first.manifest.sprites.bookPage).toBe("archive/bookPage.png");
      expect(first.manifest.sprites.leaveIcon).toBe("archive/leaveIcon.png");
      expect(first.manifest.sprites["Icon@2x"]).toBe("archive/Icon@2x.png");
      expect(first.manifest.sprites.mainscreenBackground).toBe("archive/mainscreenBackground.png");
      expect(first.manifest.sprites.saveSlotBackground).toBe("archive/saveSlotBackground.png");
      expect(first.manifest.sprites.plot_start1).toBe("archive/plot_start1.png");
      expect(first.manifest.sprites.fieldMovement).toBe("archive/fieldMovement.png");
      expect(first.manifest.audio.Opening1).toBe("archive/Opening1.mp3");
      expect(first.manifest.atlases["HeroWalkFrames-hd"]).toBeDefined();
      expect(first.hasProvenanceDocument).toBe(true);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("accepts a flat resource ZIP and parses original-style binary plists", () => {
    const content = importContentArchive(fixture("", true), "resources.zip");
    try {
      expect(content.appDirectory).toBe("/");
      expect(content.data.monsters).toHaveProperty("Fire.Testling.index", 1);
      expect(content.manifest.sprites).toMatchObject({
        ForestCombat: "archive/ForestCombat.png",
        "Testling-hd": "archive/Testling-hd.png",
      });
    } finally {
      content.dispose();
    }
  });

  it("fails early on malformed startup credits and scale-9 roles", () => {
    const invalidCredits = unzipSync(fixture(""));
    invalidCredits["Credits.plist"] = plist([{ type: "space", value: 0 }]);
    expect(() => importContentArchive(zipSync(invalidCredits), "credits.zip")).toThrow(
      /Credits\.plist row 0 has an invalid type\/value/,
    );

    const invalidScale9 = unzipSync(fixture(""));
    invalidScale9["Scale9Sprites.plist"] = plist({
      MenuButton2: { image: "Missing.png", contentRect: "{{9,6},{84,17}}" },
      PopupBackgroundThin: {
        image: "PopupBackgroundThin.png",
        contentRect: "{{20,20},{42,14}}",
      },
    });
    expect(() => importContentArchive(zipSync(invalidScale9), "scale9.zip")).toThrow(
      /MenuButton2 requires Missing-hd\.png/,
    );
  });

  it("strictly parses a present Collection.plist even without a promoted route", () => {
    const files = unzipSync(fixture(""));
    files["Collection.plist"] = plist({ Seasonal: [] });
    expect(() => importContentArchive(zipSync(files), "collection-invalid.zip")).toThrow(
      /Invalid Collection resources: Collection\.plist contains unsupported collection type Seasonal/,
    );
  });

  it("requires Collection.plist when an archive promotes a Collection POI", () => {
    const files = collectionRouteFiles();
    delete files["Collection.plist"];
    expect(() => importContentArchive(zipSync(files), "collection-missing.zip")).toThrow(
      /Collection route Collection_Hut requires Collection\.plist/,
    );
  });

  it("requires the exact Collection root named by every promoted POI", () => {
    const files = collectionRouteFiles();
    files["Harbor.plist"] = plist({
      challengeLevel: 1,
      combatBackground: "ForestCombat.png",
      connections: [],
      pointsOfInterest: [{
        type: "Outdoor.CollectionHut",
        arguments: {
          instanceName: "Collection_Hut",
          position: "{100,100}",
          menuClass: "MonsterCollectionMenuItem",
          menuArguments: { collectionType: "Seasonal" },
        },
      }],
    });
    expect(() => importContentArchive(zipSync(files), "collection-root.zip")).toThrow(
      /Collection route Collection_Hut references missing collection type Seasonal/,
    );
  });

  it("accepts a promoted empty Collection root with only base presentation roles", () => {
    const files = collectionRouteFiles();
    files["Collection.plist"] = plist({ Base: [] });
    addCollectionBasePresentationRoles(files);
    const content = importContentArchive(zipSync(files), "collection-empty.zip");
    try {
      expect(content.worldNames).toEqual(["Harbor"]);
    } finally {
      content.dispose();
    }
  });

  it("requires the CenteredWithClose Back label even for an empty Collection root", () => {
    const files = collectionRouteFiles();
    files["Collection.plist"] = plist({ Base: [] });
    addCollectionBasePresentationRoles(files);
    const strings = parsePlist(
      new TextDecoder().decode(files["en.lproj/Localizable.strings"]!),
    );
    delete (strings as Record<string, unknown>).BackButtonKey;
    files["en.lproj/Localizable.strings"] = plist(strings);

    expect(() => importContentArchive(zipSync(files), "collection-back-label.zip")).toThrow(
      /Collection route resources require localization key BackButtonKey/,
    );
  });

  it("accepts WAV startup, egg, and world audio roles with extensionless manifest identities", () => {
    const files = unzipSync(fixture(""));
    for (const audioStem of ["Opening1", "click", "Casino1", "Field1"]) {
      replaceAudioStem(files, audioStem, ".wav");
    }
    const content = importContentArchive(zipSync(files), "wav-core-audio.zip");
    try {
      expect(content.manifest.audio).toMatchObject({
        Opening1: "archive/Opening1.wav",
        click: "archive/click.wav",
        Casino1: "archive/Casino1.wav",
        Field1: "archive/Field1.wav",
      });
      expect(importedResourceMimeType("archive/Opening1.wav")).toBe("audio/wav");
      expect(importedResourceMimeType("archive/click.m4a")).toBe("audio/mp4");
      expect(importedResourceMimeType("archive/Field1.mp3")).toBe("audio/mpeg");
    } finally {
      content.dispose();
    }
  });

  it("allows a strict unpromoted catalog without Collection-only presentation roles", () => {
    const files = unzipSync(fixture(""));
    files["Collection.plist"] = plist({
      Base: [{
        key: "Collector",
        monsters: ["Testling"],
        treasureData: { items: [{ spawnType: "gold" }] },
      }],
    });
    const content = importContentArchive(zipSync(files), "collection-unpromoted.zip");
    try {
      expect(content.worldNames).toEqual(["Harbor"]);
    } finally {
      content.dispose();
    }
  });

  it("requires the live Collection presentation roles for a promoted route", () => {
    const files = collectionRouteFiles();
    addCollectionPresentationRoles(files);
    delete files["PopupMenuCloseButton-hd.png"];
    expect(() => importContentArchive(zipSync(files), "collection-presentation.zip")).toThrow(
      /Collection route resources require PopupMenuCloseButton-hd\.png/,
    );
  });

  it("accepts a promoted route only when its strict catalog and consumed roles are present", () => {
    const content = importContentArchive(
      zipSync(collectionRouteFilesWithRoles()),
      "collection-valid.zip",
    );
    try {
      expect(content.worldNames).toEqual(["Harbor"]);
    } finally {
      content.dispose();
    }
  });

  it("requires every reachable generated-Gem stat frame before import", () => {
    const files = collectionRouteFilesWithRoles();
    setCollectionReward(files, "randomGem");
    addGeneralStatFrames(files);
    const general = parsePlist(
      new TextDecoder().decode(files["General-hd.plist"]!),
    ) as { frames: Record<string, unknown>; metadata: Record<string, unknown> };
    delete general.frames["StatResist.png"];
    files["General-hd.plist"] = plist(general as Parameters<typeof build>[0]);
    expect(() => importContentArchive(zipSync(files), "collection-gem-stat.zip")).toThrow(
      /General-hd\.plist is missing Collection reward frame StatResist\.png/,
    );
  });

  it("accepts a promoted reward atlas whose backing comes from metadata", () => {
    const files = collectionRouteFilesWithRoles();
    const general = parsePlist(
      new TextDecoder().decode(files["General-hd.plist"]!),
    ) as { frames: Record<string, unknown>; metadata: Record<string, unknown> };
    general.metadata.realTextureFileName = "General-custom.png";
    files["General-hd.plist"] = plist(general as Parameters<typeof build>[0]);
    delete files["General-hd.png"];
    files["General-custom.png"] = png;
    const content = importContentArchive(zipSync(files), "collection-atlas-backing.zip");
    try {
      expect(content.manifest.atlases["General-hd"]!.image).toBe("archive/General-custom.png");
    } finally {
      content.dispose();
    }
  });

  it("does not require presentation roles for zero-chance reward spawns", () => {
    for (const spawnType of ["random", "randomGem", "fixed"] as const) {
      const files = collectionRouteFiles();
      setCollectionReward(files, spawnType, 0);
      addCollectionBasePresentationRoles(files);
      addCollectionGoalPresentationRoles(files);
      const content = importContentArchive(zipSync(files), `collection-zero-${spawnType}.zip`);
      content.dispose();
    }
  });

  it.each([
    ["random", 1],
    ["randomGem", 1],
    ["fixed", undefined],
  ] as const)("requires presentation roles for a reachable %s reward", (spawnType, chance) => {
    const files = collectionRouteFiles();
    setCollectionReward(files, spawnType, chance);
    addCollectionPresentationRoles(files);
    const strings = parsePlist(
      new TextDecoder().decode(files["en.lproj/Localizable.strings"]!),
    );
    files["en.lproj/Localizable.strings"] = plist({
      ...(strings as Record<string, unknown>),
      ExtraDescriptionSilver: "Silver reward.",
      ExtraDescriptionSpiritTotem: "Spirit totem reward.",
      RenderableSpiritTotemNameKey: "%@ Totem",
    });
    delete files["rightArrow-hd.png"];
    expect(() => importContentArchive(zipSync(files), `collection-reachable-${spawnType}.zip`)).toThrow(
      /Collection reward resources require rightArrow-hd\.png/,
    );
  });

  it("rejects a present non-PNG atlas backing before manifest construction", () => {
    const files = unzipSync(fixture(""));
    const general = parsePlist(
      new TextDecoder().decode(files["General-hd.plist"]!),
    ) as { frames: Record<string, unknown>; metadata: Record<string, unknown> };
    general.metadata.realTextureFileName = "General-custom.jpg";
    files["General-hd.plist"] = plist(general as Parameters<typeof build>[0]);
    delete files["General-hd.png"];
    files["General-custom.jpg"] = png;
    expect(() => importContentArchive(zipSync(files), "atlas-invalid-type.zip")).toThrow(
      /Atlas General-hd\.plist must reference a PNG texture/,
    );
  });

  it("accepts a dungeon-capable archive with alternate General atlas backing", () => {
    const files = unzipSync(fixture(""));
    addMinimalDungeonCapability(files, "General-custom.png");
    const content = importContentArchive(zipSync(files), "dungeon-atlas-backing.zip");
    try {
      expect(content.hasDungeonCapability).toBe(true);
      expect(content.manifest.atlases["General-hd"]!.image).toBe("archive/General-custom.png");
    } finally {
      content.dispose();
    }
  });

  it("reports missing startup, egg, and world audio roles by extension-neutral stem", () => {
    const missingStartup = unzipSync(fixture(""));
    delete missingStartup["Opening1.mp3"];
    expect(() => importContentArchive(zipSync(missingStartup), "missing-startup-audio.zip")).toThrow(
      /Startup resources require audio stem Opening1 \(\.m4a, \.mp3, or \.wav\)\./,
    );

    const missingEgg = unzipSync(fixture(""));
    delete missingEgg["Casino1.mp3"];
    expect(() => importContentArchive(zipSync(missingEgg), "missing-egg-audio.zip")).toThrow(
      /Egg hatch resources require audio stem Casino1 \(\.m4a, \.mp3, or \.wav\)\./,
    );

    const missingWorld = unzipSync(fixture(""));
    delete missingWorld["Field1.mp3"];
    expect(() => importContentArchive(zipSync(missingWorld), "missing-world-audio.zip")).toThrow(
      /World resources require audio stem Field1 \(\.m4a, \.mp3, or \.wav\)\./,
    );
  });

  it("accepts WAV dungeon audio roles and reports missing roles without a fabricated extension", () => {
    const files = collectionRouteFiles();
    addCollectionPresentationRoles(files);
    addMinimalDungeonCapability(files);
    for (const audioStem of ["Dungeon1", "Dungeon2", "Encounter", "Stairs_EnterDungeon"]) {
      replaceAudioStem(files, audioStem, ".wav");
    }
    const content = importContentArchive(zipSync(files), "wav-dungeon-audio.zip");
    try {
      expect(content.hasDungeonCapability).toBe(true);
      expect(content.manifest.audio).toMatchObject({
        Dungeon1: "archive/Dungeon1.wav",
        Dungeon2: "archive/Dungeon2.wav",
        Encounter: "archive/Encounter.wav",
        Stairs_EnterDungeon: "archive/Stairs_EnterDungeon.wav",
      });
    } finally {
      content.dispose();
    }
    delete files["Dungeon2.wav"];
    expect(() => importContentArchive(zipSync(files), "wav-dungeon-missing.zip")).toThrow(
      /Incomplete dungeon resources: Dungeon2 audio\./,
    );
  });

  it("keeps alternate General and dungeon atlas backings available to the runtime parser", () => {
    const files = unzipSync(fixture(""));
    addMinimalDungeonCapability(files, "General-custom.png", "nested/DungeonFrames-custom.png");
    const content = importContentArchive(zipSync(files), "runtime-dungeon-atlas-backing.zip");
    try {
      expect(content.resources.resolveAtlasBackingFile?.("General-hd.plist")).toBe("General-custom.png");
      expect(content.resources.resolveAtlasBackingFile?.("DungeonFrames-hd.plist")).toBe("nested/DungeonFrames-custom.png");
      const definition = loadDungeonData(
        content.resources,
        "TestDungeon",
        "Dungeon_1.plist",
        1,
        new Set(),
      );
      expect(definition.presentation.atlasNames).toEqual(["DungeonFrames"]);
    } finally {
      content.dispose();
    }
  });

  it("rejects a non-canonical metadata atlas backing before runtime exposure", () => {
    const files = unzipSync(fixture(""));
    addMinimalDungeonCapability(files, "General-hd.png", "./DungeonFrames-custom.png");
    expect(() => importContentArchive(zipSync(files), "dungeon-unsafe-atlas-backing.zip")).toThrow(
      /Invalid content resource path: \"\.\/DungeonFrames-custom\.png\"/,
    );
  });

  it("fails early when the destroy-on-pickup egg presentation is incomplete", () => {
    const missingReelArt = unzipSync(fixture(""));
    delete missingReelArt["SlotArrow-hd.png"];
    expect(() => importContentArchive(zipSync(missingReelArt), "egg-art.zip")).toThrow(
      /Egg hatch resources require SlotArrow-hd\.png/,
    );

    const wrongBackingGeometry = unzipSync(fixture(""));
    wrongBackingGeometry["SlotBacking-hd.png"] = pngHeader(364, 204);
    expect(() => importContentArchive(zipSync(wrongBackingGeometry), "egg-size.zip")).toThrow(
      /SlotBacking-hd\.png must be 364x203px; got 364x204px/,
    );

    const missingProviderFrame = unzipSync(fixture(""));
    missingProviderFrame["InventoryItemFrames-hd.plist"] = plist({
      frames: {},
      metadata: { size: "{1,1}", realTextureFileName: "InventoryItemFrames-hd.png" },
    });
    expect(() => importContentArchive(zipSync(missingProviderFrame), "egg-atlas.zip")).toThrow(
      /missing egg-hatch frame pileGold\.png/,
    );
  });

  it("exposes every retained file through a neutral read-only resource catalog", () => {
    const content = importContentArchive(fixture("Payload/Catalog.app/"), "catalog.zip");
    try {
      expect(content.resources.list()).toEqual([...content.resources.list()].sort());
      expect(content.resources.list()).toContain("Worlds.plist");
      expect(content.resources.list()).not.toContain("SomeExecutable");
      expect(Object.isFrozen(content.resources.list())).toBe(true);
      expect(content.resources.has("Worlds.plist")).toBe(true);
      expect(content.resources.has("FutureSystem.plist")).toBe(false);

      const first = content.resources.plist("Worlds.plist");
      const second = content.resources.plist("Worlds.plist");
      expect(first).toEqual(second);
      expect(first).not.toBe(second);
      expect(Object.isFrozen(first)).toBe(true);
      expect(first).toHaveProperty("Harbor.rendererData.spriteFile", "harbor.png");
      expect(content.resources.plist("en.lproj/Localizable.strings")).toHaveProperty("LevelShortKey", "Lv");
      expect(content.resources.text("README.txt")).toBe("Operator-authored content\n");

      const imageUrl = content.resources.url("ForestCombat.png");
      expect(imageUrl).toBe(content.urlFor("archive/ForestCombat.png"));
      expect(imageUrl).toMatch(/^blob:/);
    } finally {
      content.dispose();
    }
  });

  it("fails clearly for missing, wrongly typed, and unsafe catalog lookups", () => {
    const content = importContentArchive(fixture(""), "catalog-errors.zip");
    try {
      expect(() => content.resources.plist("Missing.plist")).toThrow(/content resource is missing: Missing\.plist/i);
      expect(() => content.resources.text("Missing.txt")).toThrow(/content resource is missing: Missing\.txt/i);
      expect(() => content.resources.url("Missing.png")).toThrow(/content resource is missing: Missing\.png/i);
      expect(() => content.resources.plist("README.txt")).toThrow(/not a property list/i);
      expect(() => content.resources.text("Worlds.plist")).toThrow(/not a supported text resource/i);
      expect(() => content.resources.has("../Worlds.plist")).toThrow(/invalid content resource path/i);
    } finally {
      content.dispose();
    }
  });

  it("requires source-named presentation, management, and localization roles for town-capable worlds", () => {
    const files = unzipSync(fixture(""));
    files["Worlds.plist"] = plist({
      Harbor: { class: "World", rendererData: { class: "CCSprite", spriteFile: "harbor.png" } },
      Townland: { class: "World", rendererData: { class: "CCSprite", spriteFile: "townland.png" } },
    });
    files["townland.png"] = png;
    files["PointsOfInterest.plist"] = plist({
      Outdoor: {
        Town: {
          class: "TownPointOfInterest",
          rendererData: { class: "TownPOINode", spriteFile: "empty.png" },
        },
      },
    });
    files["Townland.plist"] = plist({
      challengeLevel: 1,
      combatBackground: "ForestCombat.png",
      connections: [],
      pointsOfInterest: [{
        type: "Outdoor.Town",
        arguments: {
          instanceName: "HarborTown",
          position: "{100,100}",
          zoom: 3,
          buildings: [{
            class: "StoreMenuItem",
            position: "{0,0}",
            spriteFile: "house.png",
            iconSpriteFile: "shop.png",
            nameLabel: "StoreNameKey",
          }],
          exit: { position: "{-20,0}", spriteFile: "exit.png" },
        },
      }],
    });
    files["Towns.plist"] = plist({
      HarborTown: { class: "Town", sortOrder: 0, world: "Townland" },
    });
    for (const name of ["house.png", "shop.png", "exit.png"]) files[name] = png;
    expect(() => importContentArchive(zipSync(files), "town.zip")).toThrow(
      /Town resources require audio stem night \(\.m4a, \.mp3, or \.wav\)/,
    );
    files["night.wav"] = new Uint8Array([1]);
    files["rooster.wav"] = new Uint8Array([2]);
    files["Town1.wav"] = new Uint8Array([3]);
    expect(() => importContentArchive(zipSync(files), "town.zip")).toThrow(
      /Town resources require sunrise-hd\.png/,
    );
    files["sunrise-hd.png"] = png;
    expect(() => importContentArchive(zipSync(files), "town.zip")).toThrow(
      /Town resources require removeAllFromBattingOrder-hd\.png/,
    );
    files["removeAllFromBattingOrder-hd.png"] = png;
    expect(() => importContentArchive(zipSync(files), "town.zip")).toThrow(
      /Town resources require localization key DayFormatKey/,
    );
    // The shared importer accepts either the localized subdirectory or the app-root fallback.
    // Exercise the latter here so town-role validation cannot accidentally narrow that boundary.
    files["Localizable.strings"] = plist({
      LevelShortKey: "Lv",
      LoadingKey: "Loading Please Wait",
      "First-Time Loading On 3GS May Take A While": "First-Time Loading On 3GS May Take A While",
      TouchToContinueKey: "Touch To Continue",
      PickSaveSlotKey: "Pick Save Slot",
      NewGameButtonKey: "New Game",
      GameDisplayFormatKey: "Level %d @ %@",
      EraseGameButtonKey: "Erase Game",
      CreditsButtonKey: "Credits",
      OptionsKey: "Options",
      BackButtonKey: "Back",
      PickEraseSaveSlotKey: "ERASE which save slot?",
      EraseGameAreYouSureTitleKey: "Erase Game?",
      EraseGameAreYouSureMessageKey: "Are you sure?",
      YesButtonKey: "Yes",
      NoButtonKey: "No",
      MusicVolumeKey: "Music",
      SoundVolumeKey: "Sound",
      OkButtonKey: "Ok",
      DayFormatKey: "Day %d",
      DayEndKey: "The day is over. Monsters respawn",
      BattleGroupKey: "Party",
      SortButtonKey: "Sort",
      BattingOrderFullTitleKey: "Batting Order Full",
      BattingOrderFullMessageKey: "Move a monster out first.",
      CannotRemoveAllFromBattingOrderTitleKey: "Cannot Remove All",
      CannotRemoveAllFromBattingOrderMessageKey: "The batting order is already empty.",
      ConfirmRemoveAllFromBattingOrderTitleKey: "Are You Sure?",
      ConfirmRemoveAllFromBattingOrderMessageKey:
        "This will remove all monsters from the top row and move then to the bottom.",
      ...eggLocalization,
    });
    delete files["en.lproj/Localizable.strings"];
    const content = importContentArchive(zipSync(files), "town.zip");
    try {
      expect(content.worldNames).toEqual(["Harbor", "Townland"]);
      expect(content.hasTownCapability).toBe(true);
      expect(content.manifest.sprites).toMatchObject({
        "sunrise-hd": "archive/sunrise-hd.png",
        "removeAllFromBattingOrder-hd": "archive/removeAllFromBattingOrder-hd.png",
      });
      expect(content.manifest.audio).toMatchObject({
        night: "archive/night.wav",
        rooster: "archive/rooster.wav",
        Town1: "archive/Town1.wav",
      });
    } finally {
      content.dispose();
    }
  });

  it("explains that a clean-room source bundle must be built before import", () => {
    const source = zipSync({
      "plists/Monsters.plist": plist({}),
      "plists/Jobs.plist": plist({}),
      "plists/Abilities.plist": plist({}),
    });
    expect(() => importContentArchive(source, "clean-source.zip")).toThrow(/source bundle.*generated app archive/i);
  });

  it("rejects unsafe paths before decompression", () => {
    const archive = zipSync({ "../Monsters.plist": plist({}) });
    expect(() => importContentArchive(archive, "unsafe.zip")).toThrow(ContentArchiveError);
    expect(() => importContentArchive(archive, "unsafe.zip")).toThrow(/unsafe archive path/i);
  });

  it.runIf(localIpa !== undefined)("imports the operator's original-format IPA without naming its app", () => {
    const path = resolve(repositoryRoot, localIpa!);
    const content = importContentArchive(new Uint8Array(readFileSync(path)), localIpa!);
    try {
      expect(content.sourceKind).toBe("app-archive");
      expect(content.data.monsters).toBeTypeOf("object");
      const data = GameData.fromRaw({
        monsters: content.data.monsters,
        combines: content.data.combines,
        jobs: content.data.jobs,
        abilities: content.data.abilities,
        abilityComponents: content.data.abilityComponents,
        buffs: content.data.buffs,
        ...(content.data.items !== undefined ? { items: content.data.items } : {}),
      });
      expect(data.allMonsters().length).toBeGreaterThan(200);
      expect(Object.keys(content.manifest.sprites).length).toBeGreaterThan(100);
      expect(Object.keys(content.manifest.atlases).length).toBeGreaterThan(10);
      expect(Object.keys(content.manifest.fonts)).toHaveLength(4);
      expect(content.combatBackgroundKeys.length).toBeGreaterThan(0);
      expect(content.manifest.sprites).toHaveProperty(
        "GuildOfCorova",
        expect.stringMatching(/GuildOfCorova\.png$/),
      );
      expect(content.manifest.sprites).toHaveProperty(
        "OrdinaryMan",
        expect.stringMatching(/OrdinaryMan\.png$/),
      );
      const world = loadWorldData(
        content.resources,
        "World_3-1",
        new Set(data.allMonsters().map((monster) => monster.shortType)),
      );
      expect(world.pointsOfInterest.length).toBe(11);
      expect(world.connections.length).toBe(12);
    } finally {
      content.dispose();
    }
  });
});
