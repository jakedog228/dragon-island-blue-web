/**
 * Source-shaped, renderer-independent dungeon data recovered from Dragon Island Blue 1.1.0.
 *
 * The source merges Dungeons.plist.<theme>.creationData with Dungeon_*.plist.creationData,
 * selects the greatest numeric populator key <= the active floor, and retains Objective-C event,
 * quest, breeder, reward, and achievement dictionaries for higher integration layers.
 */

import { loadChatDefinition } from "./chats.js";
import type { ItemDef } from "./types.js";

export interface DungeonResourceSource {
  has(path: string): boolean;
  plist(path: string): unknown;
  list?(): readonly string[];
  /**
   * Optional neutral resolver supplied by an archive boundary for metadata-backed atlas sheets.
   * When present, its non-empty PNG result is authoritative; callers must not derive a fallback.
   */
  resolveAtlasBackingFile?(atlasPlistPath: string): string;
}

export interface DungeonPoint { readonly x: number; readonly y: number }

export interface DungeonRoomTemplate {
  readonly key: string;
  readonly width: number;
  readonly height: number;
  readonly frequency: number;
  readonly rotations: readonly number[];
  readonly rendererClass: "RoomNode";
  readonly anchor: DungeonPoint;
}

export interface DungeonThemePresentation {
  readonly typeName: string;
  readonly style?: string;
  readonly atlasNames: readonly string[];
  readonly floorFrameFormat: string;
  readonly floorFrameCount: number;
  readonly floorOverlayFrame?: string;
  readonly backgroundImage?: string;
  readonly wallFrameFormat: string;
  readonly wallFrameCount: number;
  readonly wallItemFrameFormat?: string;
  readonly wallItemCount: number;
  readonly doorFrameFormat: string;
  readonly doorFrameCount: number;
  readonly northDoorFrame: string;
  readonly combatBackgroundFile: string;
  readonly chestFrame: "chest.png";
  readonly portalFrame: "portal.png";
  readonly stairsUpFrame: "stairsUp.png";
  readonly stairsDownFrame: "stairsDown.png";
}

export type DungeonRoomChoiceBiasClass =
  | "DefaultRoomChoiceBias"
  | "DirectedRoomChoiceBias"
  | "PlusShapeRoomChoiceBias";

export interface DungeonCreationData {
  readonly lastFloor: number;
  readonly density: number;
  readonly roomsMin: number;
  readonly roomsMax: number;
  readonly retryChance: number;
  readonly doorCycleAttempts: number;
  readonly nonHallwaysNeeded: number;
  readonly waypointEvery: number;
  readonly monsterLevelBase: number;
  /** The misspelling is the shipped key. */
  readonly monsterLevelFloorScalor: number;
  readonly defaultItemSpawnChance: number;
  readonly roomChoiceBiasClass: DungeonRoomChoiceBiasClass;
  readonly roomChoiceBiasDirection: DungeonPoint;
  readonly roomChoiceBiasRandom: boolean;
  readonly roomTemplates: readonly DungeonRoomTemplate[];
}

export interface DungeonWeightedMonsterType { readonly type: string; readonly chance: number }
export interface DungeonMonsterSpec {
  readonly type: string;
  /** The misspelling is the shipped key. */
  readonly levelScalor: number;
  readonly extraLivingArguments?: Readonly<Record<string, unknown>>;
}
export interface DungeonOpaqueEvent {
  readonly className: string;
  readonly data: Readonly<Record<string, unknown>>;
}
export interface DungeonBreederSpec {
  readonly type: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

export type DungeonFixedItemData =
  | { readonly kind: "spiritTotem"; readonly shortType: string; readonly rawType: "DestroyOnPickup.SpiritTotem" }
  | { readonly kind: "recipe"; readonly combineName: string; readonly rawType: "DestroyOnPickup.Recipe" }
  | { readonly kind: "egg"; readonly rawType: "DestroyOnPickup.Egg" }
  | { readonly kind: "monsterEgg"; readonly rawType: "DestroyOnPickup.MonsterEgg" }
  | {
      readonly kind: "repeatEgg";
      readonly definitionPath: string;
      readonly instanceName: string;
      readonly numRepeats: number;
      readonly rawType: string;
    }
  | {
      readonly kind: "usable";
      readonly definitionPath: string;
      readonly instanceName: string;
      readonly level: number;
      readonly rawType: string;
    }
  | {
      readonly kind: "monsterJoin";
      readonly shortType: string;
      readonly jobLevel: number;
      readonly rawType: "DestroyOnPickup.MonsterJoin";
    };

export type DungeonTreasureSpawn =
  | { readonly kind: "silver"; readonly chance?: number; readonly levelScalor: number }
  | { readonly kind: "gold"; readonly chance?: number; readonly levelScalor: number }
  | { readonly kind: "random"; readonly chance?: number; readonly levelScalor: number }
  | { readonly kind: "randomGem"; readonly chance?: number; readonly levelScalor: number }
  | { readonly kind: "fixed"; readonly chance?: number; readonly levelScalor: number; readonly data: DungeonFixedItemData };

export interface DungeonTreasureData {
  readonly challengeLevelOverride?: number;
  /** `TreasureData.defaultSpawnChance`, used only when an item omits its own `chance`. */
  readonly defaultSpawnChance?: number;
  /** The misspelling is the shipped key. */
  readonly levelScalor: number;
  readonly items: readonly DungeonTreasureSpawn[];
}

export interface DungeonFixedEncounter {
  readonly sourceIndex: number;
  readonly monsters: readonly DungeonMonsterSpec[];
  readonly exactFloor: number;
  readonly everyXFloors?: number;
  readonly chanceToAppear: number;
  readonly uniqueKey?: string;
  readonly questKey?: string;
  readonly battleRewardKey?: string;
  readonly achievement?: string;
  readonly startEvent?: DungeonOpaqueEvent;
  readonly winEvent?: DungeonOpaqueEvent;
  readonly breeder?: DungeonBreederSpec;
  readonly treasureData?: DungeonTreasureData;
}

export interface DungeonMonsterPopulator {
  readonly className: "DefaultMonsterPopulator";
  readonly minMonstersPerPack: number;
  readonly maxMonstersPerPack: number;
  /** The misspelling is the shipped key. */
  readonly levelScalor: number;
  readonly density: number;
  readonly types: readonly DungeonWeightedMonsterType[];
  readonly fixedEncounters: readonly DungeonFixedEncounter[];
}

export interface DungeonTreasurePopulator {
  readonly className: "DefaultTreasurePopulator";
  /**
   * `-[DefaultTreasurePopulator setup:]` reads `unguardedTreasureChance`. The shipped data
   * misspells that key as `unguardedTreasureDensity`, so every original dungeon keeps the native
   * 0.05 default.
   */
  readonly unguardedTreasureChance: number;
  readonly treasureData: DungeonTreasureData;
}

export type DungeonZoneChange =
  | { readonly kind: "stairsUp"; readonly sourceType: "Up" }
  | { readonly kind: "stairsDown"; readonly sourceType: "Down" }
  | {
      readonly kind: "worldExit";
      readonly sourceType: "DungeonExit";
      readonly instanceName: string;
      readonly targetZoneChange: string;
      readonly targetWorld: string;
    }
  | {
      readonly kind: "dungeonExit";
      readonly sourceType: "DungeonExit" | "DungeonStairsDown" | "DungeonStairsUp";
      readonly instanceName: string;
      readonly targetZoneChange: string;
      readonly dungeonType: string;
      readonly dungeonFile: string;
      readonly dungeonLevel?: number;
    };

export interface DungeonFloorPopulation {
  readonly sourceFloor: number;
  readonly monsterPopulator?: DungeonMonsterPopulator;
  readonly treasurePopulator?: DungeonTreasurePopulator;


  readonly hasAuthoredZoneChanges?: boolean;
  readonly zoneChanges: readonly DungeonZoneChange[];
}

export interface DungeonCatchQuest {
  readonly challengeLevel: number;
  readonly types: readonly string[];
  readonly treasureData: DungeonTreasureData;
}

export interface DungeonDefinition {
  readonly typeName: string;
  readonly sourceFile: string;
  readonly instanceName: string;
  readonly startFloor: number;
  /** Dormant in shipped content: no original plist authors this source key. */
  readonly mustClearFloor: boolean;
  readonly presentation: DungeonThemePresentation;
  readonly creation: DungeonCreationData;
  readonly floorPopulations: readonly DungeonFloorPopulation[];
  readonly catchQuest?: DungeonCatchQuest;
}

export interface DungeonCapabilityReport {
  readonly available: boolean;
  readonly dungeonTypes: readonly string[];
  readonly dungeonFiles: readonly string[];
  readonly missing: readonly string[];
}

export class DungeonDataError extends Error {
  constructor(message: string) { super(message); this.name = "DungeonDataError"; }
}

const ROOT_KEYS = new Set(["class", "combatBackground", "creationData", "doorRendererData", "floorRendererData", "northDoorRendererData", "spritesheets", "style", "wallRendererData"]);
const INSTANCE_KEYS = new Set(["catchQuestData", "creationData", "instanceName", "mustClearFloor", "populatorData"]);
const CREATION_KEYS = new Set(["defaultItemSpawnChance", "density", "doorCycleAttempts", "lastFloor", "monsterLevelBase", "monsterLevelFloorScalor", "nonHallwaysNeeded", "retryChance", "roomChoiceBiasArguments", "roomChoiceBiasClass", "roomsMax", "roomsMin", "roomTypes", "waypointEvery"]);
const FLOOR_KEYS = new Set(["monsterPopulator", "treasurePopulator", "zoneChanges"]);
const FIXED_KEYS = new Set(["achievement", "battleRewardKey", "breeder", "chanceToAppear", "everyXFloors", "exactFloor", "monsters", "questKey", "startEvent", "treasureData", "uniqueKey", "winEvent"]);
const TREASURE_DATA_KEYS = new Set(["challengeLevelOverride", "items", "levelScalor"]);
const TREASURE_ITEM_KEYS = new Set(["chance", "data", "levelScalor", "spawnType"]);

export function loadDungeonData(
  source: DungeonResourceSource,
  typeName: string,
  sourceFile: string,
  startFloor: number,
  knownMonsterTypes: ReadonlySet<string>,
): DungeonDefinition {
  positiveInteger(startFloor, "startFloor");
  requireFile(source, "Dungeons.plist", "dungeon registry");
  requireFile(source, "Rooms.plist", "room registry");
  requireFile(source, "ZoneChanges.plist", "zone-change registry");
  requireFile(source, sourceFile, `dungeon instance ${sourceFile}`);

  const registry = dict(source.plist("Dungeons.plist"), "Dungeons.plist");
  const theme = dict(registry[typeName], `Dungeons.plist.${typeName}`);
  exactKeys(theme, ROOT_KEYS, `Dungeons.plist.${typeName}`);
  expect(theme.class === "Dungeon", `Dungeons.plist.${typeName}.class must be Dungeon.`);
  const instance = dict(source.plist(sourceFile), sourceFile);
  exactKeys(instance, INSTANCE_KEYS, sourceFile);

  const themeCreation = dict(theme.creationData, `Dungeons.plist.${typeName}.creationData`);
  const instanceCreation = dict(instance.creationData, `${sourceFile}.creationData`);
  exactKeys(themeCreation, CREATION_KEYS, `Dungeons.plist.${typeName}.creationData`);
  exactKeys(instanceCreation, CREATION_KEYS, `${sourceFile}.creationData`);
  const merged = { ...themeCreation, ...instanceCreation };
  const biasArgs = parseBiasArgs(merged.roomChoiceBiasArguments, `${sourceFile}.creationData.roomChoiceBiasArguments`);
  const roomTypes = dict(merged.roomTypes, `${sourceFile}.creationData.roomTypes`);
  const roomsMin = positiveInteger(merged.roomsMin ?? 20, `${sourceFile}.creationData.roomsMin`);
  const roomsMax = positiveInteger(merged.roomsMax ?? 30, `${sourceFile}.creationData.roomsMax`);
  expect(roomsMax >= roomsMin, `${sourceFile}: roomsMax is below roomsMin.`);
  const creation: DungeonCreationData = Object.freeze({
    lastFloor: positiveInteger(merged.lastFloor ?? 1, `${sourceFile}.creationData.lastFloor`),
    density: positiveFinite(merged.density ?? 3, `${sourceFile}.creationData.density`),
    roomsMin,
    roomsMax,
    retryChance: probability(merged.retryChance ?? 0.3, `${sourceFile}.creationData.retryChance`),
    doorCycleAttempts: nonnegativeFinite(merged.doorCycleAttempts ?? 0.4, `${sourceFile}.creationData.doorCycleAttempts`),
    nonHallwaysNeeded: nonnegativeInteger(merged.nonHallwaysNeeded ?? 0, `${sourceFile}.creationData.nonHallwaysNeeded`),
    waypointEvery: nonnegativeInteger(merged.waypointEvery ?? 0, `${sourceFile}.creationData.waypointEvery`),
    monsterLevelBase: finite(merged.monsterLevelBase ?? 1, `${sourceFile}.creationData.monsterLevelBase`),
    monsterLevelFloorScalor: finite(merged.monsterLevelFloorScalor ?? 0, `${sourceFile}.creationData.monsterLevelFloorScalor`),
    defaultItemSpawnChance: probability(merged.defaultItemSpawnChance ?? 0.25, `${sourceFile}.creationData.defaultItemSpawnChance`),
    roomChoiceBiasClass: parseBiasClass(merged.roomChoiceBiasClass ?? "DefaultRoomChoiceBias", `${sourceFile}.creationData.roomChoiceBiasClass`),
    roomChoiceBiasDirection: biasArgs.direction,
    roomChoiceBiasRandom: biasArgs.random,
    roomTemplates: Object.freeze(parseRoomTemplates(source, roomTypes)),
  });

  const result: DungeonDefinition = {
    typeName,
    sourceFile,
    instanceName: nonempty(instance.instanceName, `${sourceFile}.instanceName`),
    startFloor,
    mustClearFloor: boolean(instance.mustClearFloor ?? false, `${sourceFile}.mustClearFloor`),
    presentation: parsePresentation(source, typeName, theme),
    creation,
    floorPopulations: Object.freeze(parseFloorPopulations(source, instance.populatorData, sourceFile, creation.defaultItemSpawnChance, knownMonsterTypes)),
    ...(instance.catchQuestData === undefined ? {} : {
      catchQuest: parseCatchQuest(instance.catchQuestData, `${sourceFile}.catchQuestData`, creation.defaultItemSpawnChance, knownMonsterTypes),
    }),
  };
  return Object.freeze(result);
}

export type DungeonFloorPopulationProperty = "monsterPopulator" | "treasurePopulator";

/**
 * Select the source's threshold row for one populator property. `Dungeon customizeRooms:` invokes
 * the native helper separately for monsters and treasure, so a newer sparse row must not mask an
 * older value of the other property.
 */
export function selectDungeonFloorPopulation(
  definition: Pick<DungeonDefinition, "floorPopulations">,
  floor: number,
  property: DungeonFloorPopulationProperty,
): DungeonFloorPopulation | undefined {
  positiveInteger(floor, "floor");
  let selected: DungeonFloorPopulation | undefined;
  for (const row of definition.floorPopulations) {
    if (row.sourceFloor > floor) break;
    if (row[property] !== undefined) selected = row;
  }
  return selected;
}

/** Structural package capability scan. Presentation frame validation remains importer-owned. */
export function inspectDungeonCapability(source: DungeonResourceSource): DungeonCapabilityReport {
  const listed = sourceList(source);
  const marker = source.has("Dungeons.plist") || source.has("Rooms.plist") || listed.some((p) => /^Dungeon_[^/]+\.plist$/.test(p));
  if (!marker) return Object.freeze({ available: false, dungeonTypes: Object.freeze([]), dungeonFiles: Object.freeze([]), missing: Object.freeze([]) });
  const required = [
    "Dungeons.plist", "Rooms.plist", "ZoneChanges.plist",
    // `RoomNode.setupWithRoom:` unconditionally constructs this continuous child for every chest;
    // admitting a dungeon without it would require silently dropping reachable presentation.
    "Sparkle.plist",
    "HeroWalkFrames-hd.plist", "HeroWalkFrames-hd.png",
    "InventoryItemFrames-hd.plist", "InventoryItemFrames-hd.png",
    "MonsterPortraits-hd.plist", "MonsterPortraits-hd.png",
    "General-hd.plist",
    "downArrow.png", "downArrow-hd.png", "menuButton.png", "menuButton-hd.png",
    // Accept the source's original containers and structurally equivalent WAV packages. The
    // importer keeps each audio manifest identity extensionless and applies its actual MIME type.
  ];
  const missing = required.filter((p) => !source.has(p));
  for (const stem of ["Dungeon1", "Dungeon2", "Encounter", "Stairs_EnterDungeon"]) {
    if (![".m4a", ".mp3", ".wav"].some((extension) => source.has(`${stem}${extension}`))) {
      missing.push(`${stem} audio`);
    }
  }
  if (source.has("General-hd.plist")) {
    inspectAtlasBackingFile(source, "General", "General atlas texture", missing);
  }
  let types: string[] = [];
  if (source.has("Dungeons.plist")) {
    types = Object.keys(dict(source.plist("Dungeons.plist"), "Dungeons.plist")).sort();
    for (const type of types) {
      const raw = dict(dict(source.plist("Dungeons.plist"), "Dungeons.plist")[type], `Dungeons.plist.${type}`);
      for (const atlas of strings(raw.spritesheets, `Dungeons.plist.${type}.spritesheets`)) {
        const plistPath = `${atlas}-hd.plist`;
        if (!source.has(plistPath)) {
          missing.push(plistPath);
          continue;
        }
        inspectAtlasBackingFile(source, atlas, `${type} atlas texture`, missing);
      }
    }
  }
  const files = listed.filter((p) => /^Dungeon_[^/]+\.plist$/.test(p)).sort();
  if (files.length === 0) missing.push("Dungeon_*.plist");
  return Object.freeze({
    available: missing.length === 0,
    dungeonTypes: Object.freeze(types),
    dungeonFiles: Object.freeze(files),
    missing: Object.freeze([...new Set(missing)].sort()),
  });
}

/** Root-level PNGs referenced outside retained HD atlases and therefore needed in the manifest. */
export function collectDungeonSpriteFiles(source: DungeonResourceSource): readonly string[] {
  if (!source.has("Dungeons.plist")) return Object.freeze([]);
  const result = new Set<string>([
    "downArrow.png", "downArrow-hd.png", "menuButton.png", "menuButton-hd.png",
  ]);
  const registry = dict(source.plist("Dungeons.plist"), "Dungeons.plist");
  for (const [name, value] of Object.entries(registry)) {
    const raw = dict(value, `Dungeons.plist.${name}`);
    const floor = dict(raw.floorRendererData, `Dungeons.plist.${name}.floorRendererData`);
    if (floor.backgroundImage !== undefined) {
      const file = png(floor.backgroundImage, `Dungeons.plist.${name}.floorRendererData.backgroundImage`);
      result.add(file);
      const hd = file.replace(/\.png$/i, "-hd.png");
      if (source.has(hd)) result.add(hd);
    }
  }
  for (const sourceFile of sourceList(source).filter((path) => /^Dungeon_[^/]+\.plist$/.test(path))) {
    const instance = dict(source.plist(sourceFile), sourceFile);
    if (instance.populatorData === undefined) continue;
    const populations = dict(instance.populatorData, `${sourceFile}.populatorData`);
    for (const [floor, populationValue] of Object.entries(populations)) {
      const populationPath = `${sourceFile}.populatorData.${floor}`;
      const population = dict(populationValue, populationPath);
      if (population.monsterPopulator === undefined) continue;
      const populator = typedObject(population.monsterPopulator, `${populationPath}.monsterPopulator`);
      const args = dict(populator.arguments, `${populationPath}.monsterPopulator.arguments`);
      if (args.fixedEncounters === undefined) continue;
      const fixedPath = `${populationPath}.monsterPopulator.arguments.fixedEncounters`;
      for (const [fixedIndex, fixedValue] of array(args.fixedEncounters, fixedPath).entries()) {
        const encounterPath = `${fixedPath}[${fixedIndex}]`;
        const encounter = dict(fixedValue, encounterPath);
        for (const eventKey of ["startEvent", "winEvent"] as const) {
          if (encounter[eventKey] === undefined) continue;
          const eventPath = `${encounterPath}.${eventKey}`;
          const event = dict(encounter[eventKey], eventPath);
          if (event.class === "ChatGameFlowEvent") {
            const imageFile = loadChatDefinition(
              source,
              nonempty(event.chatKey, `${eventPath}.chatKey`),
            ).imageFile;
            if (imageFile !== undefined && source.has(imageFile)) result.add(imageFile);
          }
        }
      }
    }
  }
  for (const file of result) requireFile(source, file, "dungeon structural sprite");
  return Object.freeze([...result].sort());
}

function parsePresentation(source: DungeonResourceSource, typeName: string, raw: Record<string, unknown>): DungeonThemePresentation {
  const base = `Dungeons.plist.${typeName}`;
  const atlases = strings(raw.spritesheets, `${base}.spritesheets`);
  expect(atlases.length > 0, `${base}.spritesheets must not be empty.`);
  for (const atlas of atlases) {
    requireFile(source, `${atlas}-hd.plist`, `${typeName} atlas descriptor`);
    atlasBackingFile(source, atlas, `${typeName} atlas texture`);
  }
  const floor = dict(raw.floorRendererData, `${base}.floorRendererData`);
  exactKeys(floor, new Set(["backgroundImage", "overlay", "spriteFrameCount", "spriteFrameFormat"]), `${base}.floorRendererData`);
  const wall = dict(raw.wallRendererData, `${base}.wallRendererData`);
  exactKeys(wall, new Set(["spriteFrameCount", "spriteFrameFormat", "wallItemCount", "wallItemSpriteFrameFormat"]), `${base}.wallRendererData`);
  const door = dict(raw.doorRendererData, `${base}.doorRendererData`);
  exactKeys(door, new Set(["spriteFrameCount", "spriteFrameFormat"]), `${base}.doorRendererData`);
  const north = dict(raw.northDoorRendererData, `${base}.northDoorRendererData`);
  exactKeys(north, new Set(["anchor", "class", "spriteFrame"]), `${base}.northDoorRendererData`);
  expect(north.class === "CCSprite", `${base}.northDoorRendererData.class must be CCSprite.`);
  point(north.anchor, `${base}.northDoorRendererData.anchor`);
  const combat = png(raw.combatBackground, `${base}.combatBackground`);
  requireFile(source, combat, `${typeName} combat background`);
  return Object.freeze({
    typeName,
    ...(raw.style === undefined ? {} : { style: nonempty(raw.style, `${base}.style`) }),
    atlasNames: Object.freeze(atlases),
    floorFrameFormat: printf(rawFrame(floor, "spriteFrameFormat", `${base}.floorRendererData`), 1, `${base}.floorRendererData.spriteFrameFormat`),
    floorFrameCount: positiveInteger(floor.spriteFrameCount, `${base}.floorRendererData.spriteFrameCount`),
    ...(floor.overlay === undefined ? {} : { floorOverlayFrame: png(floor.overlay, `${base}.floorRendererData.overlay`) }),
    ...(floor.backgroundImage === undefined ? {} : { backgroundImage: png(floor.backgroundImage, `${base}.floorRendererData.backgroundImage`) }),
    wallFrameFormat: printfAny(rawFrame(wall, "spriteFrameFormat", `${base}.wallRendererData`), [1, 3], `${base}.wallRendererData.spriteFrameFormat`),
    wallFrameCount: positiveInteger(wall.spriteFrameCount, `${base}.wallRendererData.spriteFrameCount`),
    ...(wall.wallItemSpriteFrameFormat === undefined ? {} : { wallItemFrameFormat: printf(wall.wallItemSpriteFrameFormat, 1, `${base}.wallRendererData.wallItemSpriteFrameFormat`) }),
    wallItemCount: nonnegativeInteger(wall.wallItemCount ?? 0, `${base}.wallRendererData.wallItemCount`),
    doorFrameFormat: printf(rawFrame(door, "spriteFrameFormat", `${base}.doorRendererData`), 1, `${base}.doorRendererData.spriteFrameFormat`),
    doorFrameCount: positiveInteger(door.spriteFrameCount, `${base}.doorRendererData.spriteFrameCount`),
    northDoorFrame: png(north.spriteFrame, `${base}.northDoorRendererData.spriteFrame`),
    combatBackgroundFile: combat,
    chestFrame: "chest.png",
    portalFrame: "portal.png",
    stairsUpFrame: "stairsUp.png",
    stairsDownFrame: "stairsDown.png",
  });
}

/**
 * Resolve a dungeon atlas through the archive-owned validated filename when one is installed.
 * Standalone structural/authoring sources retain the source-named PNG fallback because they do
 * not expose archive metadata resolution.
 */
function atlasBackingFile(source: DungeonResourceSource, atlas: string, role: string): string {
  const plistPath = `${atlas}-hd.plist`;
  if (source.resolveAtlasBackingFile === undefined) {
    const literal = `${atlas}-hd.png`;
    requireFile(source, literal, role);
    return literal;
  }
  const resolved = source.resolveAtlasBackingFile(plistPath);
  expect(typeof resolved === "string" && resolved.trim().length > 0, `${plistPath} resolver must return a non-empty atlas texture filename.`);
  expect(resolved.toLowerCase().endsWith(".png"), `${plistPath} resolver must return a PNG atlas texture: ${String(resolved)}.`);
  requireFile(source, resolved, role);
  return resolved;
}

function inspectAtlasBackingFile(
  source: DungeonResourceSource,
  atlas: string,
  role: string,
  missing: string[],
): void {
  if (source.resolveAtlasBackingFile === undefined) {
    const literal = `${atlas}-hd.png`;
    if (!source.has(literal)) missing.push(literal);
    return;
  }
  atlasBackingFile(source, atlas, role);
}

function parseRoomTemplates(source: DungeonResourceSource, selected: Record<string, unknown>): DungeonRoomTemplate[] {
  const rooms = dict(source.plist("Rooms.plist"), "Rooms.plist");
  const result: DungeonRoomTemplate[] = [];


  for (const key of Object.keys(selected).sort()) {
    const raw = resolveDotted(rooms, key, `Rooms.plist.${key}`);
    exactKeys(raw, new Set(["class", "dimensions", "frequency", "rendererData", "roomImageRendererData"]), `Rooms.plist.${key}`);
    expect(raw.class === "Room", `Rooms.plist.${key}.class must be Room.`);
    const renderer = dict(raw.rendererData, `Rooms.plist.${key}.rendererData`);
    exactKeys(renderer, new Set(["anchor", "class"]), `Rooms.plist.${key}.rendererData`);
    expect(renderer.class === "RoomNode", `Rooms.plist.${key}.rendererData.class must be RoomNode.`);
    const dims = point(raw.dimensions, `Rooms.plist.${key}.dimensions`);
    expect(Number.isSafeInteger(dims.x) && dims.x > 0 && Number.isSafeInteger(dims.y) && dims.y > 0, `Rooms.plist.${key}.dimensions must be positive integers.`);
    const image = dict(raw.roomImageRendererData, `Rooms.plist.${key}.roomImageRendererData`);
    exactKeys(image, new Set(["rotations"]), `Rooms.plist.${key}.roomImageRendererData`);
    result.push(Object.freeze({
      key,
      width: dims.x,
      height: dims.y,
      frequency: positiveInteger(raw.frequency, `Rooms.plist.${key}.frequency`),
      rotations: Object.freeze(numbers(image.rotations, `Rooms.plist.${key}.roomImageRendererData.rotations`)),
      rendererClass: "RoomNode",
      anchor: point(renderer.anchor, `Rooms.plist.${key}.rendererData.anchor`),
    }));
  }
  expect(result.length > 0, "Dungeon creationData.roomTypes must select at least one room.");
  return result;
}

function parseFloorPopulations(
  source: DungeonResourceSource,
  value: unknown,
  file: string,
  defaultItemChance: number,
  known: ReadonlySet<string>,
): DungeonFloorPopulation[] {
  const table = dict(value, `${file}.populatorData`);
  return Object.entries(table).map(([key, rawValue]) => {
    const floor = Number(key);
    expect(Number.isSafeInteger(floor) && floor > 0, `${file}.populatorData key ${key} must be a positive integer.`);
    const raw = dict(rawValue, `${file}.populatorData.${key}`);
    exactKeys(raw, FLOOR_KEYS, `${file}.populatorData.${key}`);
    return Object.freeze({
      sourceFloor: floor,
      ...(raw.monsterPopulator === undefined ? {} : { monsterPopulator: parseMonsterPopulator(raw.monsterPopulator, `${file}.populatorData.${key}.monsterPopulator`, defaultItemChance, known) }),
      ...(raw.treasurePopulator === undefined ? {} : { treasurePopulator: parseTreasurePopulator(raw.treasurePopulator, `${file}.populatorData.${key}.treasurePopulator`, defaultItemChance) }),
      hasAuthoredZoneChanges: raw.zoneChanges !== undefined,
      zoneChanges: Object.freeze((raw.zoneChanges === undefined ? [] : array(raw.zoneChanges, `${file}.populatorData.${key}.zoneChanges`)).map((z, i) => parseZoneChange(source, z, `${file}.populatorData.${key}.zoneChanges[${i}]`))),
    });
  }).sort((a, b) => a.sourceFloor - b.sourceFloor);
}

function parseMonsterPopulator(value: unknown, path: string, defaultItemChance: number, known: ReadonlySet<string>): DungeonMonsterPopulator {
  const raw = typedObject(value, path);
  expect(raw.type === "DefaultMonsterPopulator", `${path}.class is unsupported.`);
  const args = dict(raw.arguments, `${path}.arguments`);
  exactKeys(args, new Set(["density", "fixedEncounters", "levelScalor", "maxMonstersPerPack", "minMonstersPerPack", "types"]), `${path}.arguments`);
  const min = positiveInteger(args.minMonstersPerPack ?? 1, `${path}.arguments.minMonstersPerPack`);
  const max = positiveInteger(args.maxMonstersPerPack ?? 4, `${path}.arguments.maxMonstersPerPack`);
  expect(max >= min, `${path}: maxMonstersPerPack is below minMonstersPerPack.`);
  const types = (args.types === undefined ? [] : array(args.types, `${path}.arguments.types`)).map((entry, i) => {
    const item = typeof entry === "string" ? { type: entry, chance: 100 } : dict(entry, `${path}.arguments.types[${i}]`);
    if (typeof entry !== "string") exactKeys(item, new Set(["chance", "type"]), `${path}.arguments.types[${i}]`);
    const type = nonempty(item.type, `${path}.arguments.types[${i}].type`);
    expect(type === "Random" || type === "Any" || known.has(type), `${path} references unknown monster ${type}.`);
    return Object.freeze({ type, chance: positiveFinite(item.chance ?? 100, `${path}.arguments.types[${i}].chance`) });
  });
  const fixed = (args.fixedEncounters === undefined ? [] : array(args.fixedEncounters, `${path}.arguments.fixedEncounters`)).map((entry, i) => parseFixedEncounter(entry, `${path}.arguments.fixedEncounters[${i}]`, i, defaultItemChance, known));
  expect(types.length > 0 || fixed.length > 0, `${path} has neither ordinary types nor fixed encounters.`);
  return Object.freeze({
    className: "DefaultMonsterPopulator",
    minMonstersPerPack: min,
    maxMonstersPerPack: max,
    levelScalor: finite(args.levelScalor ?? 1, `${path}.arguments.levelScalor`),
    density: nonnegativeFinite(args.density ?? 0.2, `${path}.arguments.density`),
    types: Object.freeze(types),
    fixedEncounters: Object.freeze(fixed),
  });
}

function parseFixedEncounter(value: unknown, path: string, sourceIndex: number, defaultItemChance: number, known: ReadonlySet<string>): DungeonFixedEncounter {
  const raw = dict(value, path);
  exactKeys(raw, FIXED_KEYS, path);
  const monsters = array(raw.monsters, `${path}.monsters`).map((entry, i) => {
    const m = dict(entry, `${path}.monsters[${i}]`);
    exactKeys(m, new Set(["extraLivingArguments", "levelScalor", "type"]), `${path}.monsters[${i}]`);
    const type = nonempty(m.type, `${path}.monsters[${i}].type`);
    expect(type === "Random" || type === "Any" || known.has(type), `${path} references unknown monster ${type}.`);
    return Object.freeze({
      type,
      levelScalor: finite(m.levelScalor ?? 1, `${path}.monsters[${i}].levelScalor`),
      ...(m.extraLivingArguments === undefined ? {} : { extraLivingArguments: clone(dict(m.extraLivingArguments, `${path}.monsters[${i}].extraLivingArguments`)) }),
    });
  });
  expect(monsters.length > 0, `${path}.monsters must not be empty.`);
  return Object.freeze({
    sourceIndex,
    monsters: Object.freeze(monsters),
    exactFloor: positiveInteger(raw.exactFloor, `${path}.exactFloor`),
    ...(raw.everyXFloors === undefined ? {} : { everyXFloors: positiveInteger(raw.everyXFloors, `${path}.everyXFloors`) }),
    chanceToAppear: probability(raw.chanceToAppear ?? 1, `${path}.chanceToAppear`),
    ...optionalString(raw, "uniqueKey", path),
    ...optionalString(raw, "questKey", path),
    ...optionalString(raw, "battleRewardKey", path),
    ...optionalString(raw, "achievement", path),
    ...(raw.startEvent === undefined ? {} : { startEvent: parseOpaqueEvent(raw.startEvent, `${path}.startEvent`) }),
    ...(raw.winEvent === undefined ? {} : { winEvent: parseOpaqueEvent(raw.winEvent, `${path}.winEvent`) }),
    ...(raw.breeder === undefined ? {} : { breeder: parseBreeder(raw.breeder, `${path}.breeder`) }),
    ...(raw.treasureData === undefined ? {} : { treasureData: parseDungeonTreasureData(raw.treasureData, `${path}.treasureData`, defaultItemChance) }),
  });
}

function parseTreasurePopulator(value: unknown, path: string, defaultItemChance: number): DungeonTreasurePopulator {
  const raw = typedObject(value, path);
  expect(raw.type === "DefaultTreasurePopulator", `${path}.class is unsupported.`);
  const args = dict(raw.arguments, `${path}.arguments`);
  // Preserve the shipped misspelling at the structural boundary, but do not reinterpret it as the
  // different selector the executable actually reads.
  exactKeys(args, new Set(["treasureData", "unguardedTreasureChance", "unguardedTreasureDensity"]), `${path}.arguments`);
  return Object.freeze({
    className: "DefaultTreasurePopulator",
    unguardedTreasureChance: probability(args.unguardedTreasureChance ?? 0.05, `${path}.arguments.unguardedTreasureChance`),
    treasureData: parseDungeonTreasureData(args.treasureData, `${path}.arguments.treasureData`, defaultItemChance),
  });
}

export function parseDungeonTreasureData(
  value: unknown,
  path: string,
  defaultItemChance: number,
  itemCatalog?: Pick<{ item(path: string): ItemDef }, "item">,
): DungeonTreasureData {
  const raw = dict(value, path);
  exactKeys(raw, TREASURE_DATA_KEYS, path);
  return Object.freeze({
    ...(raw.challengeLevelOverride === undefined ? {} : { challengeLevelOverride: positiveFinite(raw.challengeLevelOverride, `${path}.challengeLevelOverride`) }),
    defaultSpawnChance: probability(defaultItemChance, `${path}.defaultSpawnChance`),
    levelScalor: finite(raw.levelScalor ?? 1, `${path}.levelScalor`),
    items: Object.freeze(array(raw.items, `${path}.items`).map((entry, i) => {
      const item = dict(entry, `${path}.items[${i}]`);
      exactKeys(item, TREASURE_ITEM_KEYS, `${path}.items[${i}]`);
      const kind = nonempty(item.spawnType, `${path}.items[${i}].spawnType`);
      const common = {
        ...(item.chance === undefined
          ? {}
          : { chance: probability(item.chance, `${path}.items[${i}].chance`) }),
        levelScalor: finite(item.levelScalor ?? 1, `${path}.items[${i}].levelScalor`),
      };
      if (kind === "silver" || kind === "gold" || kind === "random" || kind === "randomGem") return Object.freeze({ kind, ...common });
      expect(kind === "fixed", `${path}.items[${i}].spawnType ${kind} is unsupported.`);
      return Object.freeze({
        kind: "fixed" as const,
        ...common,
        data: parseFixedItem(item.data, `${path}.items[${i}].data`, itemCatalog),
      });
    })),
  });
}

function parseFixedItem(
  value: unknown,
  path: string,
  itemCatalog: Pick<{ item(path: string): ItemDef }, "item"> | undefined,
): DungeonFixedItemData {
  const raw = typedObject(value, path);
  const args = raw.arguments === undefined ? {} : dict(raw.arguments, `${path}.arguments`);
  let catalogDefinition: ItemDef | undefined;
  if (itemCatalog !== undefined) {
    try {
      catalogDefinition = itemCatalog.item(raw.type);
    } catch {
      throw new DungeonDataError(`${path}.type ${raw.type} is not defined in Items.plist.`);
    }
  }
  switch (raw.type) {
    case "DestroyOnPickup.SpiritTotem":
      expectItemClass(catalogDefinition, "SpiritTotem", path);
      exactKeys(args, new Set(["shortType"]), `${path}.arguments`);
      return Object.freeze({ kind: "spiritTotem", shortType: nonempty(args.shortType, `${path}.arguments.shortType`), rawType: raw.type });
    case "DestroyOnPickup.Recipe":
      expectItemClass(catalogDefinition, "Recipe", path);
      exactKeys(args, new Set(["combineName"]), `${path}.arguments`);
      return Object.freeze({ kind: "recipe", combineName: nonempty(args.combineName, `${path}.arguments.combineName`), rawType: raw.type });
    case "DestroyOnPickup.Egg":
      expectItemClass(catalogDefinition, "Egg", path);
      exactKeys(args, new Set(), `${path}.arguments`);
      return Object.freeze({ kind: "egg", rawType: raw.type });
    case "DestroyOnPickup.MonsterEgg":
      expectItemClass(catalogDefinition, "Egg", path);
      exactKeys(args, new Set(), `${path}.arguments`);
      return Object.freeze({ kind: "monsterEgg", rawType: raw.type });
    case "DestroyOnPickup.MonsterJoin":
      expectItemClass(catalogDefinition, "MonsterJoin", path);
      exactKeys(args, new Set(["jobLevel", "shortType"]), `${path}.arguments`);
      return Object.freeze({
        kind: "monsterJoin",
        shortType: nonempty(args.shortType, `${path}.arguments.shortType`),
        jobLevel: positiveInteger(args.jobLevel, `${path}.arguments.jobLevel`),
        rawType: raw.type,
      });
    default: {
      if (itemCatalog === undefined) {
        throw new DungeonDataError(
          `${path}.type ${raw.type} requires Items.plist catalog validation.`,
        );
      }
      const definition = catalogDefinition!;
      switch (definition.className) {
        case "Item":
          exactKeys(args, new Set(["level"]), `${path}.arguments`);
          return Object.freeze({
            kind: "usable",
            definitionPath: definition.path,
            instanceName: definition.instanceName,
            level: definition.level ?? positiveInteger(args.level ?? 1, `${path}.arguments.level`),
            rawType: raw.type,
          });
        case "Egg": {
          exactKeys(args, new Set(["numRepeats"]), `${path}.arguments`);
          const numRepeats = positiveInteger(
            args.numRepeats,
            `${path}.arguments.numRepeats`,
          );
          return Object.freeze({
            kind: "repeatEgg",
            definitionPath: definition.path,
            instanceName: definition.instanceName,
            numRepeats,
            rawType: raw.type,
          });
        }
        default:
          throw new DungeonDataError(
            `${path}.type ${raw.type} resolves to unsupported Items.plist class ${definition.className}.`,
          );
      }
    }
  }
}

function expectItemClass(
  definition: ItemDef | undefined,
  expected: ItemDef["className"],
  path: string,
): void {
  if (definition !== undefined && definition.className !== expected) {
    throw new DungeonDataError(
      `${path}.type ${definition.path} resolves to Items.plist class ${definition.className}; expected ${expected}.`,
    );
  }
}

function parseCatchQuest(value: unknown, path: string, defaultItemChance: number, known: ReadonlySet<string>): DungeonCatchQuest {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["challengeLevel", "treasureData", "types"]), path);
  const types = strings(raw.types, `${path}.types`);
  for (const type of types) expect(known.has(type), `${path} references unknown monster ${type}.`);
  return Object.freeze({
    challengeLevel: positiveFinite(raw.challengeLevel, `${path}.challengeLevel`),
    types: Object.freeze(types),
    treasureData: parseDungeonTreasureData(raw.treasureData, `${path}.treasureData`, defaultItemChance),
  });
}

function parseZoneChange(source: DungeonResourceSource, value: unknown, path: string): DungeonZoneChange {
  if (value === "Up") return Object.freeze({ kind: "stairsUp", sourceType: "Up" });
  if (value === "Down") return Object.freeze({ kind: "stairsDown", sourceType: "Down" });
  const raw = typedObject(value, path);
  expect(raw.type === "DungeonExit" || raw.type === "DungeonStairsDown" || raw.type === "DungeonStairsUp", `${path}.type ${raw.type} is unsupported.`);
  const args = dict(raw.arguments, `${path}.arguments`);
  if (args.world !== undefined) {
    exactKeys(args, new Set(["instanceName", "targetZoneChange", "world"]), `${path}.arguments`);
    const world = typedObject(args.world, `${path}.arguments.world`);
    expect(world.arguments === undefined, `${path}.arguments.world must not have arguments.`);
    return Object.freeze({
      kind: "worldExit",
      sourceType: "DungeonExit",
      instanceName: nonempty(args.instanceName, `${path}.arguments.instanceName`),
      targetZoneChange: nonempty(args.targetZoneChange, `${path}.arguments.targetZoneChange`),
      targetWorld: world.type,
    });
  }
  exactKeys(args, new Set(["dungeon", "instanceName", "targetZoneChange"]), `${path}.arguments`);
  const dungeon = dict(args.dungeon, `${path}.arguments.dungeon`);
  exactKeys(dungeon, new Set(["arguments", "dungeonLevel", "type"]), `${path}.arguments.dungeon`);
  const file = nonempty(dungeon.arguments, `${path}.arguments.dungeon.arguments`);
  requireFile(source, file, "target dungeon instance");
  return Object.freeze({
    kind: "dungeonExit",
    sourceType: raw.type,
    instanceName: nonempty(args.instanceName, `${path}.arguments.instanceName`),
    targetZoneChange: nonempty(args.targetZoneChange, `${path}.arguments.targetZoneChange`),
    dungeonType: nonempty(dungeon.type, `${path}.arguments.dungeon.type`),
    dungeonFile: file,
    ...(dungeon.dungeonLevel === undefined ? {} : { dungeonLevel: positiveInteger(dungeon.dungeonLevel, `${path}.arguments.dungeon.dungeonLevel`) }),
  });
}

function parseOpaqueEvent(value: unknown, path: string): DungeonOpaqueEvent {
  const raw = dict(value, path);
  const className = nonempty(raw.class, `${path}.class`);
  const data = { ...raw }; delete data.class;
  return Object.freeze({ className, data: clone(data) });
}
function parseBreeder(value: unknown, path: string): DungeonBreederSpec {
  const raw = typedObject(value, path);
  return Object.freeze({ type: raw.type, arguments: clone(dict(raw.arguments ?? {}, `${path}.arguments`)) });
}
function parseBiasArgs(value: unknown, path: string): { direction: DungeonPoint; random: boolean } {
  if (value === undefined) return { direction: Object.freeze({ x: 0, y: 0 }), random: false };
  const raw = dict(value, path);
  exactKeys(raw, new Set(["biasDirection", "biasRandom"]), path);
  return { direction: point(raw.biasDirection ?? "{0,0}", `${path}.biasDirection`), random: boolean(raw.biasRandom ?? false, `${path}.biasRandom`) };
}
function parseBiasClass(value: unknown, path: string): DungeonRoomChoiceBiasClass {
  const name = nonempty(value, path);
  expect(name === "DefaultRoomChoiceBias" || name === "DirectedRoomChoiceBias" || name === "PlusShapeRoomChoiceBias", `${path} ${name} is unsupported.`);
  return name;
}
function optionalString<K extends "uniqueKey" | "questKey" | "battleRewardKey" | "achievement">(raw: Record<string, unknown>, key: K, path: string): { [P in K]?: string } {
  return raw[key] === undefined ? {} : { [key]: nonempty(raw[key], `${path}.${key}`) } as { [P in K]?: string };
}
function sourceList(source: DungeonResourceSource): readonly string[] {
  if (source.list !== undefined) return source.list();
  const common = ["Dungeon_1.plist", "Dungeon_3.plist", "Dungeon_4.plist", "Dungeon_6a.plist", "Dungeon_6b.plist", "Dungeon_7.plist", "Dungeon_9.plist", "Dungeon_11.plist", "Dungeon_12.plist", "Dungeon_13.plist", "Dungeon_14.plist", "Dungeon_15.plist", "Dungeon_15b.plist", "Dungeon_16.plist", "Dungeon_17.plist"];
  return common.filter((p) => source.has(p));
}
function typedObject(value: unknown, path: string): { type: string; arguments?: unknown } {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["arguments", "class", "type"]), path);
  const type = nonempty(raw.type ?? raw.class, `${path}.type/class`);
  return { type, ...(raw.arguments === undefined ? {} : { arguments: raw.arguments }) };
}
function resolveDotted(root: Record<string, unknown>, dotted: string, path: string): Record<string, unknown> {
  let value: unknown = root;
  for (const segment of dotted.split(".")) value = dict(value, path)[segment];
  return dict(value, path);
}
function rawFrame(raw: Record<string, unknown>, key: string, path: string): unknown { return raw[key] ?? (() => { throw new DungeonDataError(`${path}.${key} is missing.`); })(); }
function clone(value: Record<string, unknown>): Readonly<Record<string, unknown>> {
  return deepFreezeCopy(value) as Readonly<Record<string, unknown>>;
}
function deepFreezeCopy(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(deepFreezeCopy));
  if (typeof value === "object" && value !== null) {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) output[key] = deepFreezeCopy(entry);
    return Object.freeze(output);
  }
  return value;
}
function printf(value: unknown, count: number, path: string): string { const text = nonempty(value, path); expect((text.match(/%d/g) ?? []).length === count, `${path} must contain ${count} %d placeholder(s).`); return text; }
function printfAny(value: unknown, counts: readonly number[], path: string): string { const text = nonempty(value, path); expect(counts.includes((text.match(/%d/g) ?? []).length), `${path} has an unsupported %d placeholder count.`); return text; }
function png(value: unknown, path: string): string { const text = nonempty(value, path); expect(!text.includes("/") && !text.includes("\\") && text.toLowerCase().endsWith(".png"), `${path} must be a root-level PNG.`); return text; }
function point(value: unknown, path: string): DungeonPoint { expect(typeof value === "string", `${path} must be a Cocos point string.`); const m = /^\s*\{\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\}\s*$/.exec(value); expect(m !== null, `${path} must be a Cocos point string.`); return Object.freeze({ x: Number(m[1]), y: Number(m[2]) }); }
function numbers(value: unknown, path: string): number[] { return array(value, path).map((v, i) => finite(v, `${path}[${i}]`)); }
function strings(value: unknown, path: string): string[] { return array(value, path).map((v, i) => nonempty(v, `${path}[${i}]`)); }
function dict(value: unknown, path: string): Record<string, unknown> { expect(typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array), `${path} must be a dictionary.`); return value as Record<string, unknown>; }
function array(value: unknown, path: string): unknown[] { expect(Array.isArray(value), `${path} must be an array.`); return value; }
function nonempty(value: unknown, path: string): string { expect(typeof value === "string" && value.length > 0, `${path} must be a non-empty string.`); return value; }
function boolean(value: unknown, path: string): boolean { expect(typeof value === "boolean", `${path} must be boolean.`); return value; }
function finite(value: unknown, path: string): number { const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value; expect(typeof n === "number" && Number.isFinite(n), `${path} must be finite.`); return n; }
function positiveFinite(value: unknown, path: string): number { const n = finite(value, path); expect(n > 0, `${path} must be positive.`); return n; }
function nonnegativeFinite(value: unknown, path: string): number { const n = finite(value, path); expect(n >= 0, `${path} must be nonnegative.`); return n; }
function positiveInteger(value: unknown, path: string): number { const n = finite(value, path); expect(Number.isSafeInteger(n) && n > 0, `${path} must be a positive integer.`); return n; }
function nonnegativeInteger(value: unknown, path: string): number { const n = finite(value, path); expect(Number.isSafeInteger(n) && n >= 0, `${path} must be a nonnegative integer.`); return n; }
function probability(value: unknown, path: string): number { const n = finite(value, path); expect(n >= 0 && n <= 1, `${path} must be between zero and one.`); return n; }
function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void { for (const key of Object.keys(value)) expect(allowed.has(key), `${path} contains unsupported key ${key}.`); }
function requireFile(source: DungeonResourceSource, path: string, role: string): void { expect(source.has(path), `Missing ${role}: ${path}.`); }
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new DungeonDataError(message); }
