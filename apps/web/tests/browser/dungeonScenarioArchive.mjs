import { build } from "plist";
import { strToU8, zlibSync, zipSync } from "fflate";

const PNG_SIGNATURE = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
]);

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = strToU8(type);
  const body = concatBytes(typeBytes, payload);
  const trailer = new Uint8Array(4);
  new DataView(trailer.buffer).setUint32(0, crc32(body));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length);
  return concatBytes(length, body, trailer);
}

/** Complete RGBA PNGs, including zlib-compressed scanlines and CRC-valid chunks. */
function pngSize(width, height) {
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rowLength = width * 4 + 1;
  const raw = new Uint8Array(rowLength * height);
  for (let y = 0; y < height; y++) {
    const row = y * rowLength;
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const pixel = row + 1 + x * 4;
      raw[pixel] = 32;
      raw[pixel + 1] = 96;
      raw[pixel + 2] = 160;
      raw[pixel + 3] = 255;
    }
  }
  return concatBytes(
    PNG_SIGNATURE,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibSync(raw)),
    pngChunk("IEND", new Uint8Array()),
  );
}

/**
 * Scenario-only placeholder media. Every generated file is a RIFF/WAV with a matching .wav
 * suffix. Manifest keys remain extensionless logical identities, so existing source callers still
 * resolve Field1, Dungeon1, click, and the other shipped names. Browser decoding is intentionally
 * unrun under the opt-in verification policy.
 */
function scenarioAudio() {
  const sampleRate = 8000;
  const sampleCount = 800;
  const dataLength = sampleCount * 2;
  const bytes = new Uint8Array(44 + dataLength);
  const view = new DataView(bytes.buffer);
  const text = (offset, value) => [...value].forEach((char, index) => bytes[offset + index] = char.charCodeAt(0));
  text(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, dataLength, true);
  return bytes;
}

const PNG = pngSize(1, 1);
const AUDIO = scenarioAudio();
const frame = {
  frame: "{{0,0},{1,1}}",
  sourceColorRect: "{{0,0},{1,1}}",
  sourceSize: "{1,1}",
  rotated: false,
};
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
};

export const DUNGEON_SCENARIO_FIXTURES = Object.freeze([
  {
    label: "Cave",
    route: { typeName: "Cave", sourceFile: "Dungeon_1.plist", floor: 1, entryZoneName: "ScenarioCaveEntry" },
    instanceName: "ScenarioCave",
    expectedRuntimeDiagnostics: [],
  },
  {
    label: "Dungeon",
    route: { typeName: "Dungeon", sourceFile: "Dungeon_3.plist", floor: 1, entryZoneName: "ScenarioDungeonEntry" },
    instanceName: "ScenarioDungeon",
    expectedRuntimeDiagnostics: [],
  },
  {
    label: "Forest",
    route: { typeName: "Forest", sourceFile: "Dungeon_9.plist", floor: 1, entryZoneName: "ScenarioForestEntry" },
    instanceName: "ScenarioForest",
    expectedRuntimeDiagnostics: ["forest-tree-allValues-order"],
  },
  {
    label: "Water",
    route: { typeName: "Water", sourceFile: "Dungeon_7.plist", floor: 1, entryZoneName: "ScenarioWaterEntry" },
    instanceName: "ScenarioWater",
    expectedRuntimeDiagnostics: [],
  },
  {
    label: "Volcano",
    route: { typeName: "Cave", sourceFile: "Dungeon_15.plist", floor: 1, entryZoneName: "ScenarioVolcanoEntry" },
    instanceName: "Volcano",
    // The unlock branch is implemented; the GameKit submission of step 3 is the only step with no
    // local equivalent, and it reports through the shared platform-score hook.
    expectedRuntimeDiagnostics: ["leaderboard-platform-hook-unavailable"],
  },
  {
    label: "VolcanoB",
    route: { typeName: "Cave", sourceFile: "Dungeon_15b.plist", floor: 211, entryZoneName: "ScenarioVolcanoBEntry" },
    instanceName: "VolcanoB",
    expectedRuntimeDiagnostics: ["leaderboard-platform-hook-unavailable"],
  },
]);

function plist(value) {
  return strToU8(build(value));
}

function dungeonPresentation(combatBackground, style) {
  return {
    class: "Dungeon",
    combatBackground,
    ...(style === undefined ? {} : { style }),
    spritesheets: ["DungeonFrames"],
    creationData: { roomTypes: { Basic: {} } },
    floorRendererData: { spriteFrameFormat: "floor%d.png", spriteFrameCount: 1 },
    wallRendererData: { spriteFrameFormat: "wall%d.png", spriteFrameCount: 1, wallItemCount: 0 },
    doorRendererData: { spriteFrameFormat: "door%d.png", spriteFrameCount: 1 },
    northDoorRendererData: { class: "CCSprite", anchor: "{0,0}", spriteFrame: "north.png" },
  };
}

function dungeonInstance(fixture) {
  return {
    instanceName: fixture.instanceName,
    mustClearFloor: false,
    creationData: {
      lastFloor: fixture.label === "VolcanoB" ? 999 : 1,
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
    populatorData: {
      [fixture.route.floor]: {
        zoneChanges: [{
          type: "DungeonExit",
          arguments: {
            instanceName: fixture.route.entryZoneName,
            targetZoneChange: "ScenarioWorldExit",
            world: { type: "Harbor" },
          },
        }],
      },
    },
  };
}

/** Build only structural, independently-authored content. No original game bytes are included. */
export function createDungeonScenarioArchive() {
  const scenarioMonsters = Object.fromEntries(Array.from({ length: 19 }, (_, index) => {
    const shortType = index === 0 ? "Testling" : `Testling${index + 1}`;
    return [shortType, {
      parent: "RootMonster",
      element: "Fire",
      index: index + 1,
      quality: 1,
      stars: 1,
      rootStats: { Attack: 1, Defense: 1, Magic: 1, MaxHP: 10, Resist: 1, Speed: 1 },
      unarmedAttackType: "Impact",
    }];
  }));
  const scenarioJobs = Object.fromEntries(Object.keys(scenarioMonsters).map((shortType) => [
    shortType,
    // Shipped Jobs.json uses xpPenalty 1 for ordinary job leaves. Zero collapses the XP curve and
    // cannot represent even a level-1 WorldTripParty member.
    { class: "Job", slots: [], xpPenalty: 1, jobAbilities: {} },
  ]));
  const entries = {
    "Monsters.plist": plist({
      RootMonster: { class: "Monster", category: "Normal" },
      Fire: scenarioMonsters,
    }),
    "Combines.plist": plist({}),
    // `boot()` derives the profile's `licenseBattingOrderSize` from `gd.license("Novice")` whenever
    // `__DIB_TEST_PLAYER_PROFILE__` is set, so every fixture here needs the table. `loadLicenses`
    // demands exactly the seven shipped types; the numbers below are scenario-owned placeholders,
    // not the shipped progression, because no dungeon assertion reads them.
    "Licenses.plist": plist(Object.fromEntries(
      ["Novice", "Apprentice", "Veteran", "Expert", "Elite", "Master", "Grandmaster"]
        .map((type, ordinal) => [type, {
          heroLevelRequired: ordinal,
          completedQuestsRequired: ordinal,
          challengeLevel: ordinal + 1,
          battingOrderSize: ordinal + 1,
          gemSlots: Math.min(ordinal, 4),
          monsterPopulator: {},
        }]),
    )),
    "Jobs.plist": plist(scenarioJobs),
    "Abilities.plist": plist({}),
    "AbilityComponents.plist": plist({}),
    "Buffs.plist": plist({}),
    "Animations.plist": plist({}),
    "Scale9Sprites.plist": plist({
      MenuButton2: { image: "PopupMenuButton2.png", contentRect: "{{9,6},{84,17}}" },
      PopupBackgroundThin: { image: "PopupBackgroundThin.png", contentRect: "{{20,20},{42,14}}" },
    }),
    "Credits.plist": plist([{ type: "title", value: "CreditsButtonKey" }]),
    "Info.plist": plist({ CFBundleShortVersionString: "1.1.0" }),
    "Worlds.plist": plist({ Harbor: { class: "World", rendererData: { class: "CCSprite", spriteFile: "harbor.png" } } }),
    "Harbor.plist": plist({
      challengeLevel: 1,
      combatBackground: "CaveCombat.png",
      connections: [],
      pointsOfInterest: [{
        type: "Outdoor.Generic",
        arguments: { instanceName: "ScenarioStart", position: "{120,120}" },
      }],
    }),
    "PointsOfInterest.plist": plist({ Outdoor: { Generic: { class: "PointOfInterest", rendererData: { class: "POINode", spriteFile: "empty.png" } } } }),
    "Rooms.plist": plist({ Basic: {
      class: "Room",
      dimensions: "{2,2}",
      frequency: 1,
      rendererData: { class: "RoomNode", anchor: "{0,0}" },
      roomImageRendererData: { rotations: [] },
    } }),
    "ZoneChanges.plist": plist({}),
    "Dungeons.plist": plist({
      Cave: dungeonPresentation("CaveCombat.png"),
      Dungeon: dungeonPresentation("DungeonCombat.png"),
      Forest: dungeonPresentation("ForestCombat.png", "forest"),
      Water: dungeonPresentation("WaterCombat.png"),
    }),
    "DungeonFrames-hd.plist": plist({
      frames: Object.fromEntries(["floor1.png", "wall1.png", "tree1.png", "door1.png", "north.png", "chest.png", "portal.png", "stairsUp.png", "stairsDown.png"].map((name) => [name, frame])),
      metadata: { size: "{1,1}", realTextureFileName: "DungeonFrames-hd.png" },
    }),
    "HeroWalkFrames-hd.plist": plist({
      frames: Object.fromEntries(["Front", "Back", "Left", "Right"].flatMap((direction) =>
        Array.from({ length: 8 }, (_, index) => [`herowalk${direction}_${index + 1}.png`, frame]))),
      metadata: { size: "{1,1}", realTextureFileName: "HeroWalkFrames-hd.png" },
    }),
    "General-hd.plist": plist({
      frames: { "heroXpFrame.png": frame, "heroXpBar.png": frame },
      metadata: { size: "{1,1}", realTextureFileName: "General-hd.png" },
    }),
    "InventoryItemFrames-hd.plist": plist({
      frames: Object.fromEntries(["Item_Totem.png", "Item_Recipe.png", "Egg.png", "MonsterEgg.png", "pileSilver.png", "pileGold.png", "Item_Card2.png", "Item_Card3.png", "NoviceGem1.png", "NoviceGemGlow.png", "VeteranGem1.png", "VeteranGemGlow.png", "EliteGem1.png", "EliteGemGlow.png"].map((name) => [name, frame])),
      metadata: { size: "{1,1}", realTextureFileName: "InventoryItemFrames-hd.png" },
    }),
    "MonsterpediaFrames-hd.plist": plist({
      frames: { "rarityStar.png": frame },
      metadata: { size: "{1,1}", realTextureFileName: "MonsterpediaFrames-hd.png" },
    }),
    "MonsterPortraits-hd.plist": plist({
      frames: { "Testling_icon.png": frame },
      metadata: { size: "{1,1}", realTextureFileName: "MonsterPortraits-hd.png" },
    }),
    "en.lproj/Localizable.strings": plist({
      LevelShortKey: "Lv",
      DungeonLevelKey: "Level",
      DungeonMonstersCaughtFormatString: "Caught %d/%d",
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


      InfiniteDungeonUnlockFormatKey: "Next bonus at floor: %d",
      NewInfiniteMonsterSlotTitleKey: "New Monster Slot Unlocked!",
      NewInfiniteMonsterSlotMessageShortKey: "+1 Max Monsters!",
      NewInfiniteMonsterSlotMessageKey:
        "You got deep enough in the infinite dungeon to earn a new monster slot! You will be " +
        "able to take 1 extra monster with you when you leave town.",
      ...eggLocalization,
    }),
    "README.txt": strToU8("Task-owned synthetic dungeon scenario package\n"),
    "Field1.wav": AUDIO,
    "Opening1.wav": AUDIO,
    "Dungeon1.wav": AUDIO,
    "Dungeon2.wav": AUDIO,
    "Casino1.wav": AUDIO,
    "Encounter.wav": AUDIO,
    "Stairs_EnterDungeon.wav": AUDIO,
    "click.wav": AUDIO,
    "notAllowed.wav": AUDIO,
    "CaptureSuccess.wav": AUDIO,
    "CaptureFail.wav": AUDIO,
    "Escape.wav": AUDIO,
  };

  for (const fixture of DUNGEON_SCENARIO_FIXTURES) {
    entries[fixture.route.sourceFile] = plist(dungeonInstance(fixture));
  }
  for (const shortType of Object.keys(scenarioMonsters)) entries[`${shortType}-hd.png`] = PNG;
  for (const name of [
    "CaveCombat.png", "DungeonCombat.png", "ForestCombat.png", "WaterCombat.png",
    "mainscreenBackground.png", "saveSlotBackground.png", "plot_start1.png", "fieldMovement.png",
    "PopupMenuButton2-hd.png", "PopupBackgroundThin-hd.png", "PopupMenuCloseButton-hd.png",
    "ClerkGirl-hd.png", "TutorialRightSide-hd.png", "MMScreen.png", "inBattingOrderBkg-hd.png",
    "sleepZ-hd.png", "confusionStatus-hd.png", "paralyzeBolt-hd.png", "particleTexture.png",
    "progressParticle.png",
    "harbor.png", "empty.png",
    "walkArrow.png", "ipadBorder.png", "greenFlag-hd.png", "redFlag-hd.png", "blueFlag-hd.png",
    "menuButton-hd.png", "namePlate-hd.png", "bigmap.png", "bookPage.png", "leaveIcon.png",
    "Icon.png", "Icon@2x.png", "HeroWalkFrames-hd.png", "General-hd.png",
    "InventoryItemFrames-hd.png", "MonsterPortraits-hd.png", "MonsterpediaFrames-hd.png", "DungeonFrames-hd.png", "FXSheet-hd.png", "Testling-hd.png",
    "downArrow.png", "downArrow-hd.png", "menuButton.png", "Testling_icon.png",
    "arial_14-hd.png", "arial_14_bold-hd.png", "arial_18_bold-hd.png", "arial_20_bold-hd.png",
  ]) entries[name] = PNG;
  for (const [name, width, height] of [
    ["harbor.png", 960, 640],
    ["mainscreenBackground.png", 1024, 768],
    ["saveSlotBackground.png", 1024, 768],
    ["ipadBorder.png", 1024, 768],
    ["MMScreen.png", 1024, 768],
  ]) entries[name] = pngSize(width, height);
  for (const [name, font] of [
    ["arial_14-hd.fnt", "arial_14"],
    ["arial_14_bold-hd.fnt", "arial_14_bold"],
    ["arial_18_bold-hd.fnt", "arial_18_bold"],
    ["arial_20_bold-hd.fnt", "arial_20_bold"],
  ]) {
    entries[name] = strToU8([
      `info face="Arial Narrow" size=14 bold=0 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=1,1`,
      "common lineHeight=14 base=11 scaleW=1 scaleH=1 pages=1 packed=0",
      `page id=0 file="${font}-hd.png"`,
      "chars count=1",
      "char id=32 x=0 y=0 width=1 height=1 xoffset=0 yoffset=0 xadvance=4 page=0 chnl=0",
      "",
    ].join("\n"));
  }
  entries["FXSheet-hd.plist"] = plist({
    frames: {},
    metadata: { size: "{1,1}", realTextureFileName: "FXSheet-hd.png" },
  });
  entries["PoisonParticles.plist"] = plist({
    maxParticles: 50,
    particleLifespan: 0.32894736528396606,
    particleLifespanVariance: 0.8552631735801697,
    startParticleSize: 20,
    startParticleSizeVariance: 10,
    finishParticleSize: 0,
    gravityx: 0,
    gravityy: -30,
    sourcePositionx: 0,
    sourcePositiony: 0,
    sourcePositionVariancex: 40,
    sourcePositionVariancey: 15,
    speed: 30,
    speedVariance: 5,
    textureFileName: "particleTexture.png",
  });
  // `main.ts` preloads this alongside PoisonParticles so the source XP-award card never fetches a
  // particle config mid-battle; a scenario archive without it fails the runtime content contract
  // outright ("unknown particle: progressBarParticles.plist"). Values mirror the shipped
  // `progressBarParticles.plist`, including its own `progressParticle.png` texture.
  entries["progressBarParticles.plist"] = plist({
    maxParticles: 8,
    particleLifespan: 1.3815789222717285,
    particleLifespanVariance: 0.05999999865889549,
    duration: -1,
    emitterType: 0,
    angle: 90,
    angleVariance: 360,
    speed: 20,
    speedVariance: 10,
    gravityx: 0,
    gravityy: 0,
    radialAcceleration: 0,
    radialAccelVariance: 0,
    tangentialAcceleration: 0,
    tangentialAccelVariance: 0,
    minRadius: 41.04999923706055,
    maxRadius: 66.31999969482422,
    maxRadiusVariance: 60,
    rotatePerSecond: 45,
    rotatePerSecondVariance: 125.52999877929688,
    sourcePositionx: 0,
    sourcePositiony: 0,
    sourcePositionVariancex: 10,
    sourcePositionVariancey: 10,
    startParticleSize: 16,
    startParticleSizeVariance: 0,
    finishParticleSize: 0,
    finishParticleSizeVariance: 0,
    rotationStart: 0,
    rotationStartVariance: 0,
    rotationEnd: 0,
    rotationEndVariance: 0,
    startColorRed: 1,
    startColorGreen: 1,
    startColorBlue: 0.25999999046325684,
    startColorAlpha: 1,
    startColorVarianceRed: 0,
    startColorVarianceGreen: 0,
    startColorVarianceBlue: 0,
    startColorVarianceAlpha: 1,
    finishColorRed: 0.6200000047683716,
    finishColorGreen: 0.14000000059604645,
    finishColorBlue: 0,
    finishColorAlpha: 1,
    finishColorVarianceRed: 0,
    finishColorVarianceGreen: 0,
    finishColorVarianceBlue: 0,
    finishColorVarianceAlpha: 1,
    blendFuncSource: 1,
    blendFuncDestination: 1,
    textureFileName: "progressParticle.png",
  });
  entries["Sparkle.plist"] = plist({
    maxParticles: 18,
    particleLifespan: 0.8553000092506409,
    particleLifespanVariance: 0.05999999865889549,
    duration: -1,
    emitterType: 0,
    angle: 0,
    angleVariance: 360,
    speed: 10,
    speedVariance: 0.1000000014901161,
    gravityx: 0,
    gravityy: 0,
    radialAcceleration: 0,
    radialAccelVariance: 0,
    tangentialAcceleration: 0,
    tangentialAccelVariance: 0,
    startParticleSize: 2,
    startParticleSizeVariance: 9,
    finishParticleSize: 16.84210586547852,
    finishParticleSizeVariance: 0,
    rotationStart: 0,
    rotationStartVariance: 0,
    rotationEnd: 0,
    rotationEndVariance: 0,
    startColorRed: 0.8,
    startColorGreen: 0.8,
    startColorBlue: 0,
    startColorAlpha: 1,
    startColorVarianceRed: 0,
    startColorVarianceGreen: 0,
    startColorVarianceBlue: 0,
    startColorVarianceAlpha: 0.2,
    finishColorRed: 1,
    finishColorGreen: 1,
    finishColorBlue: 0,
    finishColorAlpha: 0,
    finishColorVarianceRed: 0,
    finishColorVarianceGreen: 0,
    finishColorVarianceBlue: 0,
    finishColorVarianceAlpha: 0,
    blendFuncSource: 770,
    blendFuncDestination: 1,
    textureFileName: "particleTexture.png",
  });
  Object.assign(entries, {
    "SlotBackground-hd.png": pngSize(960, 640),
    "SlotBackground-ipadhd.png": pngSize(1024, 768),
    "SlotBacking-hd.png": pngSize(364, 203),
    "SlotBacking-ipadhd.png": pngSize(426, 238),
    "SlotArrow-hd.png": pngSize(94, 62),
    "largeRarityStar-hd.png": pngSize(64, 59),
  });
  return zipSync(entries);
}
