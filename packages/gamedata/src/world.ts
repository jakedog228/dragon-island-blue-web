/** Source-shaped, renderer-independent world data used by the browser importer and world engine. */

import {
  parseDungeonTreasureData,
  type DungeonBreederSpec,
  type DungeonTreasureData,
} from "./dungeon.js";
import { loadChatDefinition, type ChatDefinition } from "./chats.js";

export interface WorldResourceSource {
  has(path: string): boolean;
  plist(path: string): unknown;
}

export interface WorldPointValue { readonly x: number; readonly y: number }

export interface WorldRendererDefinition {
  readonly className: "CCSprite";
  readonly spriteFile: string;
  readonly anchor: WorldPointValue;
  readonly indent?: WorldPointValue;
}

export interface PointRendererDefinition {
  readonly className: "POINode" | "TownPOINode" | "PopupMenuPOINode";
  readonly spriteFile: string;
  readonly flagOffset?: WorldPointValue;
  readonly menuButtonOffset?: WorldPointValue;
}

export interface TownBuildingDefinition {
  readonly sourceIndex: number;
  readonly className?:
    | "MonsterManagementMenuItem"
    | "StoreMenuItem"
    | "TavernMenuItem"
    | "TownWarpMenuItem"
    | "MonsterpediaMenuItem"
    | "CharacterDisplayMenuItem"
    | "BlackMarketMenuItem"
    | "ArenaMenuItem";
  readonly position: WorldPointValue;
  readonly spriteFile: string;
  readonly iconSpriteFile?: string;
  readonly nameLabel?: string;
  /**
   * Menu-item argument retained where the source exposes it. In particular,
   * MonsterManagementMenuItem defaults this to true when the key is absent and opens
   * MonsterManagementNode style 0 (`editable ^ 1`).
   */
  readonly editable?: boolean;
  /** Tavern/Arena speaker portrait authored in the building's menu arguments. */
  readonly questGiver?: string;
  /** ArenaMenuItem source argument: early tutorial arenas expose Tournament/Back only. */
  readonly noLicense?: boolean;
  /** Tutorial flag whose absence makes this building's icon run FlashForeverAction. */
  readonly tutorialFlashKey?: string;
  readonly conditions?: TownBuildingConditions;
  readonly fake: boolean;
  readonly hasConditions: boolean;
}

export interface TownBuildingConditions {
  readonly chats?: string;
  readonly inProgressQuests?: string;
  readonly quests?: string;
}

export interface TownExitDefinition {
  readonly position: WorldPointValue;
  readonly spriteFile: string;
}

export interface TownEnterChatDefinition {
  readonly chat: ChatDefinition;
  /** Shipped town enter-chat conditions use only `Conditions.chats`. */
  readonly requiredSeenChat?: string;
}

export interface TownDefinition {
  readonly zoom: number;
  readonly buildings: readonly TownBuildingDefinition[];
  readonly exit: TownExitDefinition;
  readonly enterChats: readonly TownEnterChatDefinition[];
}

export interface WeightedMonsterType { readonly type: string; readonly chance: number }

export interface WorldRandomPopulator {
  readonly tier: number;
  readonly encounterLevelScalor: number;
  readonly itterationScalor: number;
  readonly populatorLevelScalor: number;
  readonly minMonstersPerPack: number;
  readonly maxMonstersPerPack: number;
  readonly types: readonly WeightedMonsterType[];
  readonly fixedEncounters: readonly WorldFixedEncounter[];
}

export interface WorldFixedMonster {
  readonly type: string;
  /** The misspelling is the shipped data key. */
  readonly levelScalor: number;
  readonly extraLivingArguments?: Readonly<Record<string, unknown>>;
}

export interface WorldChatGameFlowEvent {
  readonly className: "ChatGameFlowEvent";
  readonly chat: ChatDefinition;
}

export interface WorldFixedEncounter {
  readonly sourceIndex: number;
  readonly monsters: readonly WorldFixedMonster[];
  readonly exactFloor?: number;
  readonly everyXFloors?: number;
  readonly chanceToAppear: number;
  readonly uniqueKey?: string;
  readonly questKey?: string;
  readonly battleRewardKey?: string;
  readonly achievement?: string;
  readonly startEvent?: WorldChatGameFlowEvent;
  readonly winEvent?: WorldChatGameFlowEvent;
  readonly breeder?: DungeonBreederSpec;
  readonly treasureData?: DungeonTreasureData;
}

export type DemoSkippedInteraction =
  | "fixedEncounter"
  | "town"
  | "dungeon"
  | "customInteraction"
  | "questOrCondition";

export interface WorldZoneChange {
  readonly kind: "world" | "dungeon";
  readonly targetWorld?: string;
  readonly targetZoneChange?: string;
  readonly dungeon?: string;
  readonly dungeonFile?: string;
  readonly dungeonLevel?: number;





  readonly conditions?: SourceConditions;
}

export type SupportedPoiInteraction =
  | {
      readonly kind: "monsterCollection";
      readonly collectionType: string;
    };

export interface WorldPointOfInterest {
  readonly name: string;
  readonly type: string;
  readonly sourceClass: "PointOfInterest" | "TownPointOfInterest" | "PopupMenuPointOfInterest";
  readonly position: WorldPointValue;
  readonly renderer: PointRendererDefinition;
  readonly combatBackground?: string;


  readonly hasEncounterTable: boolean;
  readonly randomPopulators: readonly WorldRandomPopulator[];
  /**
   * Authored at `encounters.fixedEncounters`, but native PointOfInterest selects only the
   * threshold row's `monsterPopulator.arguments.fixedEncounters`. Retained for disclosure and
   * validation without fabricating runtime reachability.
   */
  readonly unusedEncounterFixedEncounters: readonly WorldFixedEncounter[];
  readonly zoneChange?: WorldZoneChange;
  readonly town?: TownDefinition;
  /** Narrow, statically supported projection of an otherwise generic source custom interaction. */
  readonly supportedInteraction?: SupportedPoiInteraction;
  readonly demoSkipped: readonly DemoSkippedInteraction[];
}

export interface WorldConnection {
  readonly poi1: string;
  readonly poi2: string;
  /** Native `Conditions.poisCleared`, populated from authored `conditions.pois`. */
  readonly requiredCompletedPoiNames?: readonly string[];
  /**
   * Shipped worlds contain a small number of stale endpoint strings. The source retains each
   * connection but creates/renderers nodes solely from pointsOfInterest; it never synthesizes a
   * node for one of these names.
   */
  readonly missingPointNames?: readonly string[];
  readonly demoSkipped: readonly DemoSkippedInteraction[];
}

export interface WorldData {
  readonly name: string;
  readonly map: WorldRendererDefinition;
  readonly challengeLevel: number;
  readonly combatBackground: string;
  readonly defaultItemSpawnChance: number;
  readonly encounterChance: number;
  readonly pointsOfInterest: readonly WorldPointOfInterest[];
  readonly connections: readonly WorldConnection[];
}

export interface TownPortalDestination {
  readonly townName: string;
  readonly worldName: string;
  readonly sortOrder: number;
  readonly portalConditions?: SourceConditions;
}

/** Source `Conditions` dictionary used by town portals and other world admission gates. */
export interface SourceConditions {
  readonly chats?: readonly string[];
  readonly battles?: readonly string[];
  readonly quests?: readonly string[];
  readonly inProgressQuests?: readonly string[];
  /** Authored dictionary key `pois`; Objective-C accessor `poisCleared`. */
  readonly pois?: readonly string[];
  readonly minIAPMade?: number;
  readonly maxIAPMade?: number;
  readonly andCondition?: SourceConditions;
  readonly orCondition?: SourceConditions;
}

export class WorldDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldDataError";
  }
}

const WORLD_KEYS = new Set(["challengeLevel", "combatBackground", "connections", "defaultItemSpawnChance", "encounterChance", "pointsOfInterest"]);
const POI_ARG_KEYS = new Set(["buildings", "combatBackground", "encounters", "enterChats", "exit", "instanceName", "menuArguments", "menuClass", "position", "zoneChange", "zoom"]);
const TOWN_BUILDING_KEYS = new Set(["arguments", "class", "conditions", "fake", "iconSpriteFile", "nameLabel", "position", "spriteFile", "tutorialFlashKey"]);
const TOWN_BUILDING_CLASSES = new Set([
  "MonsterManagementMenuItem", "StoreMenuItem", "TavernMenuItem", "TownWarpMenuItem",
  "MonsterpediaMenuItem", "CharacterDisplayMenuItem", "BlackMarketMenuItem", "ArenaMenuItem",
]);
const TOWN_BUILDING_ARGUMENT_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  MonsterManagementMenuItem: new Set(["editable"]),
  StoreMenuItem: new Set<string>(),
  TavernMenuItem: new Set(["questGiver"]),
  TownWarpMenuItem: new Set<string>(),
  MonsterpediaMenuItem: new Set(["editable"]),
  CharacterDisplayMenuItem: new Set<string>(),
  BlackMarketMenuItem: new Set<string>(),
  ArenaMenuItem: new Set(["noLicense", "questGiver"]),
});
const TOWN_BUILDING_CONDITION_KEYS = new Set(["chats", "inProgressQuests", "quests"]);
const TOWN_PORTAL_KEYS = new Set(["class", "portalConditions", "sortOrder", "world"]);
const SOURCE_CONDITION_KEYS = new Set([
  "andCondition",
  "battles",
  "chats",
  "inProgressQuests",
  "maxIAPMade",
  "minIAPMade",
  "orCondition",
  "pois",
  "quests",
]);

/**
 * Source `Town.worldForTown:` data used by the Master Menu's direct-return Town Portal action.
 * The in-town `TownWarpMenuItem` picker additionally evaluates the retained `portalConditions`.
 */
export function loadTownPortalDestinations(
  source: WorldResourceSource,
): readonly TownPortalDestination[] {
  expect(source.has("Towns.plist"), "Town Portal requires Towns.plist.");
  const towns = dict(source.plist("Towns.plist"), "Towns.plist");
  const worlds = dict(source.plist("Worlds.plist"), "Worlds.plist");
  const poiDefinitions = dict(source.plist("PointsOfInterest.plist"), "PointsOfInterest.plist");
  const destinations = Object.entries(towns).map(([townName, value]) => {
    nonempty(townName, "Towns.plist town name");
    const path = `Towns.plist.${townName}`;
    const raw = dict(value, path);
    exactKeys(raw, TOWN_PORTAL_KEYS, path);
    expect(raw.class === "Town", `${path}.class must be Town.`);
    const worldName = nonempty(raw.world, `${path}.world`);
    expect(worlds[worldName] !== undefined, `${path} references unknown world ${worldName}.`);
    requireFile(source, `${worldName}.plist`, `world data for town ${townName}`);
    const world = dict(source.plist(`${worldName}.plist`), `${worldName}.plist`);
    const townPoi = array(world.pointsOfInterest, `${worldName}.plist.pointsOfInterest`).find((value) => {
      const point = typedObject(value, `${worldName}.plist.pointsOfInterest[]`);
      return dict(point.arguments, `${worldName}.plist.pointsOfInterest[].arguments`).instanceName === townName;
    });
    expect(townPoi !== undefined, `${path} references missing town POI ${worldName}.${townName}.`);
    const point = typedObject(townPoi, `${worldName}.plist town ${townName}`);
    const pointArgs = dict(point.arguments, `${worldName}.plist town ${townName}.arguments`);
    const pointDefinition = resolveDotted(
      poiDefinitions,
      point.type,
      `PointsOfInterest.${point.type}`,
    );
    expect(
      pointDefinition.class === "TownPointOfInterest" || pointArgs.buildings !== undefined,
      `${path} references non-town POI ${worldName}.${townName}.`,
    );
    const sortOrder = integer(raw.sortOrder, `${path}.sortOrder`);
    expect(sortOrder >= 0, `${path}.sortOrder must be nonnegative.`);
    const portalConditions = raw.portalConditions === undefined
      ? undefined
      : parseSourceConditions(raw.portalConditions, `${path}.portalConditions`);
    return Object.freeze({
      townName,
      worldName,
      sortOrder,
      ...(portalConditions === undefined ? {} : { portalConditions }),
    });
  });
  expect(destinations.length > 0, "Towns.plist must contain at least one town.");
  destinations.sort((left, right) =>
    left.sortOrder - right.sortOrder ||
    (left.townName < right.townName ? -1 : left.townName > right.townName ? 1 : 0));
  return Object.freeze(destinations);
}

export function parseSourceConditions(value: unknown, path = "conditions"): SourceConditions {
  const raw = dict(value, path);
  exactKeys(raw, SOURCE_CONDITION_KEYS, path);
  const chats = optionalConditionNames(raw.chats, `${path}.chats`);
  const battles = optionalConditionNames(raw.battles, `${path}.battles`);
  const quests = optionalConditionNames(raw.quests, `${path}.quests`);
  const inProgressQuests = optionalConditionNames(
    raw.inProgressQuests,
    `${path}.inProgressQuests`,
  );
  const pois = optionalConditionNames(raw.pois, `${path}.pois`);
  const minIAPMade = raw.minIAPMade === undefined
    ? undefined
    : nonnegativeInteger(raw.minIAPMade, `${path}.minIAPMade`);
  const maxIAPMade = raw.maxIAPMade === undefined
    ? undefined
    : nonnegativeInteger(raw.maxIAPMade, `${path}.maxIAPMade`);
  if (minIAPMade !== undefined && maxIAPMade !== undefined) {
    expect(minIAPMade <= maxIAPMade, `${path}.minIAPMade must not exceed maxIAPMade.`);
  }
  const andCondition = raw.andCondition === undefined
    ? undefined
    : parseSourceConditions(raw.andCondition, `${path}.andCondition`);
  const orCondition = raw.orCondition === undefined
    ? undefined
    : parseSourceConditions(raw.orCondition, `${path}.orCondition`);
  return Object.freeze({
    ...(chats === undefined ? {} : { chats }),
    ...(battles === undefined ? {} : { battles }),
    ...(quests === undefined ? {} : { quests }),
    ...(inProgressQuests === undefined ? {} : { inProgressQuests }),
    ...(pois === undefined ? {} : { pois }),
    ...(minIAPMade === undefined ? {} : { minIAPMade }),
    ...(maxIAPMade === undefined ? {} : { maxIAPMade }),
    ...(andCondition === undefined ? {} : { andCondition }),
    ...(orCondition === undefined ? {} : { orCondition }),
  });
}


export function resolveTownPortalDestination(
  destinations: readonly TownPortalDestination[],
  lastTownName: string | undefined,
): TownPortalDestination {
  if (destinations.length === 0) throw new WorldDataError("Town Portal has no destinations.");
  if (lastTownName !== undefined) {
    const saved = destinations.find(({ townName }) => townName === lastTownName);
    if (saved === undefined) {
      throw new WorldDataError(`Town Portal saved town ${lastTownName} is unavailable.`);
    }
    return saved;
  }
  return destinations.find(({ townName }) => townName === "First_City") ?? destinations[0]!;
}

export function loadWorldData(
  source: WorldResourceSource,
  worldName: string,
  knownMonsterTypes: ReadonlySet<string>,
): WorldData {
  const worlds = dict(source.plist("Worlds.plist"), "Worlds.plist");
  const worldDef = dict(worlds[worldName], `Worlds.plist.${worldName}`);
  exactKeys(worldDef, new Set(["class", "rendererData"]), `Worlds.plist.${worldName}`);
  expect(worldDef.class === "World", `Worlds.plist.${worldName}.class must be World.`);
  const map = parseWorldRenderer(worldDef.rendererData, `Worlds.plist.${worldName}.rendererData`);
  requireFile(source, map.spriteFile, `world map for ${worldName}`);

  const worldPath = `${worldName}.plist`;
  requireFile(source, worldPath, `world data for ${worldName}`);
  const raw = dict(source.plist(worldPath), worldPath);
  exactKeys(raw, WORLD_KEYS, worldPath);
  const combatBackground = png(raw.combatBackground, `${worldPath}.combatBackground`);
  requireFile(source, combatBackground, `combat background for ${worldName}`);
  const poiDefinitions = dict(source.plist("PointsOfInterest.plist"), "PointsOfInterest.plist");
  const defaultItemSpawnChance = optionalProbability(
    raw.defaultItemSpawnChance,
    .25,
    `${worldPath}.defaultItemSpawnChance`,
  );
  const rawPoints = array(raw.pointsOfInterest, `${worldPath}.pointsOfInterest`);
  const points = rawPoints.map((value, index) =>
    parsePoi(
      source,
      worlds,
      poiDefinitions,
      value,
      `${worldPath}.pointsOfInterest[${index}]`,
      knownMonsterTypes,
      defaultItemSpawnChance,
    ));
  const names = new Set<string>();
  for (const point of points) {
    expect(!names.has(point.name), `${worldPath} contains duplicate point ${point.name}.`);
    names.add(point.name);
  }
  const connections = array(raw.connections, `${worldPath}.connections`).map((value, index) =>
    parseConnection(value, `${worldPath}.connections[${index}]`, names),
  );
  return Object.freeze({
    name: worldName,
    map,
    challengeLevel: Math.max(raw.challengeLevel === undefined ? 0 : integer(raw.challengeLevel, `${worldPath}.challengeLevel`), 1),
    combatBackground,
    defaultItemSpawnChance,
    encounterChance: optionalProbability(raw.encounterChance, Math.fround(.333), `${worldPath}.encounterChance`),
    pointsOfInterest: Object.freeze(points),
    connections: Object.freeze(connections),
  });
}

/** Returns source-referenced structural PNGs that must be projected into a runtime manifest. */
export function collectWorldSpriteFiles(source: WorldResourceSource): readonly string[] {
  if (!source.has("Worlds.plist")) return Object.freeze([]);
  expect(source.has("PointsOfInterest.plist"), "Worlds.plist requires PointsOfInterest.plist.");
  const result = new Set<string>(["walkArrow.png", "ipadBorder.png"]);
  const worlds = dict(source.plist("Worlds.plist"), "Worlds.plist");
  const definitions = dict(source.plist("PointsOfInterest.plist"), "PointsOfInterest.plist");
  for (const [name, value] of Object.entries(worlds)) {
    const def = dict(value, `Worlds.plist.${name}`);
    result.add(parseWorldRenderer(def.rendererData, `Worlds.plist.${name}.rendererData`).spriteFile);
    const worldPath = `${name}.plist`;
    requireFile(source, worldPath, `world data for ${name}`);
    const world = dict(source.plist(worldPath), worldPath);
    for (const [index, pointValue] of array(world.pointsOfInterest, `${worldPath}.pointsOfInterest`).entries()) {
      const pointRaw = typedObject(pointValue, `${worldPath}.pointsOfInterest[${index}]`);
      const args = dict(pointRaw.arguments, `${worldPath}.pointsOfInterest[${index}].arguments`);
      const definition = resolveDotted(
        definitions,
        pointRaw.type,
        `PointsOfInterest.${pointRaw.type}`,
      );
      const isTown = definition.class === "TownPointOfInterest" || args.buildings !== undefined;
      if (isTown) {
        const town = parseTown(source, args, `${worldPath}.pointsOfInterest[${index}].arguments`);
        for (const building of town.buildings) {
          result.add(building.spriteFile);
          if (building.iconSpriteFile !== undefined) result.add(building.iconSpriteFile);
          if (building.questGiver !== undefined) result.add(building.questGiver);
        }
        for (const { chat } of town.enterChats) {
          // Original portraits are commonly atlas-frame names; independently-authored packages
          // may instead provide a bare PNG that must be projected explicitly.
          if (chat.imageFile !== undefined && source.has(chat.imageFile)) result.add(chat.imageFile);
        }
        result.add(town.exit.spriteFile);
      }
      const encounters = args.encounters;
      if (encounters !== undefined) {
        for (const chatKey of fixedEncounterChatKeys(encounters, `${worldPath}.pointsOfInterest[${index}].arguments.encounters`)) {
          const imageFile = loadChatDefinition(source, chatKey).imageFile;
          // Original portraits are commonly atlas-frame names; independently-authored packages
          // may instead provide a bare PNG that must be projected explicitly.
          if (imageFile !== undefined && source.has(imageFile)) result.add(imageFile);
        }
      }
    }
  }
  const walk = (value: unknown, path: string): void => {
    const node = dict(value, path);
    if ("rendererData" in node) {
      result.add(parsePointRenderer(node.rendererData, `${path}.rendererData`).spriteFile);
      return;
    }
    for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`);
  };
  walk(definitions, "PointsOfInterest.plist");
  for (const file of result) requireFile(source, file, "world structural sprite");
  return Object.freeze([...result].sort());
}

function parseWorldRenderer(value: unknown, path: string): WorldRendererDefinition {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["anchor", "class", "indent", "spriteFile"]), path);
  expect(raw.class === "CCSprite", `${path}.class must be CCSprite.`);
  const indent = raw.indent === undefined ? undefined : point(raw.indent, `${path}.indent`);
  return Object.freeze({ className: "CCSprite", spriteFile: png(raw.spriteFile, `${path}.spriteFile`), anchor: point(raw.anchor ?? "{0,0}", `${path}.anchor`), ...(indent ? { indent } : {}) });
}

function parsePointRenderer(value: unknown, path: string): PointRendererDefinition {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["class", "flagOffset", "menuButtonOffset", "spriteFile"]), path);
  expect(raw.class === "POINode" || raw.class === "TownPOINode" || raw.class === "PopupMenuPOINode", `${path}.class is unsupported.`);
  const flagOffset = raw.flagOffset === undefined ? undefined : point(raw.flagOffset, `${path}.flagOffset`);
  const menuButtonOffset = raw.menuButtonOffset === undefined ? undefined : point(raw.menuButtonOffset, `${path}.menuButtonOffset`);
  return Object.freeze({ className: raw.class, spriteFile: png(raw.spriteFile, `${path}.spriteFile`), ...(flagOffset ? { flagOffset } : {}), ...(menuButtonOffset ? { menuButtonOffset } : {}) });
}

function parsePoi(
  source: WorldResourceSource,
  worlds: Record<string, unknown>,
  definitions: Record<string, unknown>,
  value: unknown,
  path: string,
  known: ReadonlySet<string>,
  defaultItemSpawnChance: number,
): WorldPointOfInterest {
  const raw = typedObject(value, path);
  const args = dict(raw.arguments, `${path}.arguments`);
  exactKeys(args, POI_ARG_KEYS, `${path}.arguments`);
  const definition = resolveDotted(definitions, raw.type, `PointsOfInterest.${raw.type}`);
  exactKeys(definition, new Set(["class", "rendererData"]), `PointsOfInterest.${raw.type}`);
  expect(definition.class === "PointOfInterest" || definition.class === "TownPointOfInterest" || definition.class === "PopupMenuPointOfInterest", `PointsOfInterest.${raw.type}.class is unsupported.`);
  const renderer = parsePointRenderer(definition.rendererData, `PointsOfInterest.${raw.type}.rendererData`);
  requireFile(source, renderer.spriteFile, `point renderer ${raw.type}`);
  const position = point(args.position, `${path}.arguments.position`);
  expect(position.x >= 0 && position.x <= 480 && position.y >= 0 && position.y <= 320, `${path}.arguments.position is outside the 480x320 authored world.`);
  const name = nonempty(args.instanceName, `${path}.arguments.instanceName`);
  const combatBackground = args.combatBackground === undefined ? undefined : png(args.combatBackground, `${path}.arguments.combatBackground`);
  if (combatBackground) requireFile(source, combatBackground, `combat background for ${name}`);
  const parsedEncounters = args.encounters === undefined
    ? {
        hasEncounterTable: false,
        populators: [] as WorldRandomPopulator[],
        unused: [] as WorldFixedEncounter[],
      }
    : parseEncounters(
      source,
      args.encounters,
      `${path}.arguments.encounters`,
      known,
      defaultItemSpawnChance,
    );
  const randomPopulators = parsedEncounters.populators;
  const zoneChange = args.zoneChange === undefined ? undefined : parseZoneChange(source, worlds, args.zoneChange, `${path}.arguments.zoneChange`);
  const isTown = definition.class === "TownPointOfInterest" || args.buildings !== undefined;
  const town = isTown ? parseTown(source, args, `${path}.arguments`) : undefined;
  const supportedInteraction = parseSupportedPoiInteraction(args, `${path}.arguments`);
  const skipped = new Set<DemoSkippedInteraction>();
  if (isTown) skipped.add("town");
  if (zoneChange?.kind === "dungeon") skipped.add("dungeon");
  if (parsedEncounters.unused.length > 0) skipped.add("fixedEncounter");
  if (args.enterChats !== undefined || args.menuArguments !== undefined || args.menuClass !== undefined || args.exit !== undefined || args.zoom !== undefined) skipped.add("customInteraction");
  return Object.freeze({
    name,
    type: raw.type,
    sourceClass: definition.class,
    position,
    renderer,
    ...(combatBackground ? { combatBackground } : {}),
    hasEncounterTable: parsedEncounters.hasEncounterTable,
    randomPopulators: Object.freeze(randomPopulators),
    unusedEncounterFixedEncounters: Object.freeze(parsedEncounters.unused),
    ...(zoneChange ? { zoneChange } : {}),
    ...(town ? { town } : {}),
    ...(supportedInteraction ? { supportedInteraction } : {}),
    demoSkipped: Object.freeze([...skipped]),
  });
}

function parseSupportedPoiInteraction(
  args: Record<string, unknown>,
  path: string,
): SupportedPoiInteraction | undefined {
  if (args.menuClass !== "MonsterCollectionMenuItem") return undefined;
  const menuArguments = dict(args.menuArguments, `${path}.menuArguments`);
  exactKeys(menuArguments, new Set(["collectionType"]), `${path}.menuArguments`);
  return Object.freeze({
    kind: "monsterCollection",
    collectionType: nonempty(
      menuArguments.collectionType,
      `${path}.menuArguments.collectionType`,
    ),
  });
}

function parseTown(source: WorldResourceSource, args: Record<string, unknown>, path: string): TownDefinition {
  const buildings = array(args.buildings, `${path}.buildings`).map((value, sourceIndex) => {
    const buildingPath = `${path}.buildings[${sourceIndex}]`;
    const raw = dict(value, buildingPath);
    exactKeys(raw, TOWN_BUILDING_KEYS, buildingPath);
    const fake = raw.fake === undefined ? false : boolean(raw.fake, `${buildingPath}.fake`);
    const className = raw.class === undefined ? undefined : nonempty(raw.class, `${buildingPath}.class`);
    if (fake) expect(className === undefined, `${buildingPath}.class must be absent for a fake building.`);
    if (!fake) {
      expect(className !== undefined, `${buildingPath}.class is required for an interactive building.`);
      expect(TOWN_BUILDING_CLASSES.has(className), `${buildingPath}.class ${String(className)} is unsupported.`);
    }
    const spriteFile = png(raw.spriteFile, `${buildingPath}.spriteFile`);
    requireFile(source, spriteFile, `town building ${sourceIndex}`);
    const iconSpriteFile = raw.iconSpriteFile === undefined ? undefined : png(raw.iconSpriteFile, `${buildingPath}.iconSpriteFile`);
    if (iconSpriteFile) requireFile(source, iconSpriteFile, `town building icon ${sourceIndex}`);
    const nameLabel = raw.nameLabel === undefined ? undefined : nonempty(raw.nameLabel, `${buildingPath}.nameLabel`);
    if (!fake) {
      expect(iconSpriteFile !== undefined, `${buildingPath}.iconSpriteFile is required for an interactive building.`);
      expect(nameLabel !== undefined, `${buildingPath}.nameLabel is required for an interactive building.`);
    }
    const menuArguments = raw.arguments === undefined
      ? {}
      : dict(raw.arguments, `${buildingPath}.arguments`);
    if (className !== undefined) {
      exactKeys(
        menuArguments,
        TOWN_BUILDING_ARGUMENT_KEYS[className] ?? new Set(),
        `${buildingPath}.arguments`,
      );
    } else {
      exactKeys(menuArguments, new Set(), `${buildingPath}.arguments`);
    }
    const explicitEditable = menuArguments.editable === undefined
      ? undefined
      : boolean(menuArguments.editable, `${buildingPath}.arguments.editable`);
    const editable = className === "MonsterManagementMenuItem"
      ? explicitEditable ?? true
      : explicitEditable;
    const questGiver = menuArguments.questGiver === undefined
      ? undefined
      : png(menuArguments.questGiver, `${buildingPath}.arguments.questGiver`);
    if (questGiver !== undefined) requireFile(source, questGiver, `town building quest giver ${sourceIndex}`);
    const noLicense = menuArguments.noLicense === undefined
      ? undefined
      : boolean(menuArguments.noLicense, `${buildingPath}.arguments.noLicense`);
    const conditions = raw.conditions === undefined
      ? undefined
      : parseTownBuildingConditions(raw.conditions, `${buildingPath}.conditions`);
    const tutorialFlashKey = raw.tutorialFlashKey === undefined
      ? undefined
      : nonempty(raw.tutorialFlashKey, `${buildingPath}.tutorialFlashKey`);
    return Object.freeze({
      sourceIndex,
      ...(className ? { className: className as Exclude<TownBuildingDefinition["className"], undefined> } : {}),
      position: point(raw.position, `${buildingPath}.position`),
      spriteFile,
      ...(iconSpriteFile ? { iconSpriteFile } : {}),
      ...(nameLabel ? { nameLabel } : {}),
      ...(editable === undefined ? {} : { editable }),
      ...(questGiver === undefined ? {} : { questGiver }),
      ...(noLicense === undefined ? {} : { noLicense }),
      ...(tutorialFlashKey === undefined ? {} : { tutorialFlashKey }),
      ...(conditions === undefined ? {} : { conditions }),
      fake,
      hasConditions: conditions !== undefined,
    });
  });
  expect(buildings.length > 0, `${path}.buildings must not be empty.`);
  const exitPath = `${path}.exit`;
  const exitRaw = dict(args.exit, exitPath);
  exactKeys(exitRaw, new Set(["position", "spriteFile"]), exitPath);
  const exitSpriteFile = png(exitRaw.spriteFile, `${exitPath}.spriteFile`);
  requireFile(source, exitSpriteFile, "town exit");
  const zoom = finite(args.zoom, `${path}.zoom`);
  expect(zoom > 1, `${path}.zoom must be greater than 1.`);
  const enterChats = args.enterChats === undefined
    ? []
    : array(args.enterChats, `${path}.enterChats`).map((value, index) =>
        parseTownEnterChat(source, value, `${path}.enterChats[${index}]`));
  return Object.freeze({
    zoom,
    buildings: Object.freeze(buildings),
    exit: Object.freeze({ position: point(exitRaw.position, `${exitPath}.position`), spriteFile: exitSpriteFile }),
    enterChats: Object.freeze(enterChats),
  });
}

function parseTownEnterChat(
  source: WorldResourceSource,
  value: unknown,
  path: string,
): TownEnterChatDefinition {
  if (typeof value === "string") {
    return Object.freeze({ chat: loadChatDefinition(source, nonempty(value, path)) });
  }
  const raw = dict(value, path);
  exactKeys(raw, new Set(["chatKey", "conditions"]), path);
  const chatKey = nonempty(raw.chatKey, `${path}.chatKey`);
  const conditions = dict(raw.conditions, `${path}.conditions`);
  exactKeys(conditions, new Set(["chats"]), `${path}.conditions`);
  const requiredSeenChat = nonempty(conditions.chats, `${path}.conditions.chats`);
  return Object.freeze({
    chat: loadChatDefinition(source, chatKey),
    requiredSeenChat,
  });
}

function parseTownBuildingConditions(value: unknown, path: string): TownBuildingConditions {
  const raw = dict(value, path);
  exactKeys(raw, TOWN_BUILDING_CONDITION_KEYS, path);
  const result: {
    chats?: string;
    inProgressQuests?: string;
    quests?: string;
  } = {};
  for (const key of ["chats", "inProgressQuests", "quests"] as const) {
    if (raw[key] !== undefined) result[key] = nonempty(raw[key], `${path}.${key}`);
  }
  expect(Object.keys(result).length > 0, `${path} must not be empty.`);
  return Object.freeze(result);
}

function parseEncounters(
  source: WorldResourceSource,
  value: unknown,
  path: string,
  known: ReadonlySet<string>,
  defaultItemSpawnChance: number,
): {
  hasEncounterTable: boolean;
  populators: WorldRandomPopulator[];
  unused: WorldFixedEncounter[];
} {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["fixedEncounters", "itterationScalor", "levelScalor", "table"]), path);
  const level = raw.levelScalor === undefined ? 1 : finite(raw.levelScalor, `${path}.levelScalor`);
  const iteration = raw.itterationScalor === undefined ? 0 : finite(raw.itterationScalor, `${path}.itterationScalor`);
  const encounterFixed = (raw.fixedEncounters === undefined
    ? []
    : array(raw.fixedEncounters, `${path}.fixedEncounters`))
    .map((entry, index) =>
      parseWorldFixedEncounter(
        source,
        entry,
        `${path}.fixedEncounters[${index}]`,
        index,
        known,
        defaultItemSpawnChance,
      ));
  // `objectForKey:@"table"` leaves the ivar nil when the key is absent, while an authored empty
  // NSDictionary remains nonnil and therefore participates in `hasEncounter`. Preserve that
  // distinction even though neither shape can build a battle.
  const hasEncounterTable = raw.table !== undefined;
  const table = raw.table === undefined ? {} : dict(raw.table, `${path}.table`);
  const populators: WorldRandomPopulator[] = [];
  for (const [tierText, tierRaw] of Object.entries(table)) {
    const tier = Number(tierText);
    expect(Number.isInteger(tier) && tier > 0, `${path}.table key ${tierText} must be a positive integer.`);
    const row = dict(tierRaw, `${path}.table.${tierText}`);
    exactKeys(row, new Set(["monsterPopulator"]), `${path}.table.${tierText}`);

    if (row.monsterPopulator === undefined) continue;
    const populator = dict(row.monsterPopulator, `${path}.table.${tierText}.monsterPopulator`);
    exactKeys(populator, new Set(["arguments", "class"]), `${path}.table.${tierText}.monsterPopulator`);
    // `monsterPopulatorForDictionary:` logs a missing class and returns nil. It never asks the
    // empty dictionary for arguments, so retaining no normalized row is the faithful projection.
    if (populator.class === undefined) continue;
    expect(populator.class === "DefaultMonsterPopulator", `${path}.table.${tierText}.monsterPopulator.class is unsupported.`);
    const args = populator.arguments === undefined
      ? {}
      : dict(populator.arguments, `${path}.table.${tierText}.monsterPopulator.arguments`);
    exactKeys(args, new Set(["fixedEncounters", "levelScalor", "maxMonstersPerPack", "minMonstersPerPack", "types"]), `${path}.table.${tierText}.monsterPopulator.arguments`);
    const min = args.minMonstersPerPack === undefined ? 1 : positiveInt(args.minMonstersPerPack, `${path}.table.${tierText}.minMonstersPerPack`);
    const max = args.maxMonstersPerPack === undefined ? 4 : positiveInt(args.maxMonstersPerPack, `${path}.table.${tierText}.maxMonstersPerPack`);
    expect(max >= min, `${path}.table.${tierText} maxMonstersPerPack is below minMonstersPerPack.`);
    const types = (args.types === undefined ? [] : array(args.types, `${path}.table.${tierText}.types`)).map((entry, index) => {
      const item = typeof entry === "string"
        ? { type: entry, chance: 100 }
        : dict(entry, `${path}.table.${tierText}.types[${index}]`);
      if (typeof entry !== "string") {
        exactKeys(item, new Set(["chance", "type"]), `${path}.table.${tierText}.types[${index}]`);
      }
      const type = nonempty(item.type, `${path}.table.${tierText}.types[${index}].type`);
      // `Random` is a source sentinel resolved from the eligible roster, not a Monsters.plist leaf.
      expect(type === "Random" || known.has(type), `${path}.table.${tierText} references unknown monster ${type}.`);
      const chance = finite(item.chance, `${path}.table.${tierText}.types[${index}].chance`);
      expect(chance > 0, `${path}.table.${tierText}.types[${index}].chance must be positive.`);
      return Object.freeze({ type, chance });
    });
    const fixed = (args.fixedEncounters === undefined
      ? []
      : array(args.fixedEncounters, `${path}.table.${tierText}.fixedEncounters`))
      .map((entry, index) =>
        parseWorldFixedEncounter(
          source,
          entry,
          `${path}.table.${tierText}.monsterPopulator.arguments.fixedEncounters[${index}]`,
          index,
          known,
          defaultItemSpawnChance,
        ));
    expect(
      args.types === undefined || types.length > 0 || fixed.length > 0,
      `${path}.table.${tierText} has neither ordinary types nor fixed encounters.`,
    );
    populators.push(Object.freeze({
      tier,
      encounterLevelScalor: level,
      itterationScalor: iteration,
      populatorLevelScalor: args.levelScalor === undefined
        ? 1
        : finite(args.levelScalor, `${path}.table.${tierText}.levelScalor`),
      minMonstersPerPack: min,
      maxMonstersPerPack: max,
      types: Object.freeze(types),
      fixedEncounters: Object.freeze(fixed),
    }));
  }
  return { hasEncounterTable, populators, unused: encounterFixed };
}

const WORLD_FIXED_KEYS = new Set([
  "achievement",
  "battleRewardKey",
  "breeder",
  "chanceToAppear",
  "everyXFloors",
  "exactFloor",
  "monsters",
  "questKey",
  "startEvent",
  "treasureData",
  "uniqueKey",
  "winEvent",
]);

function parseWorldFixedEncounter(
  source: WorldResourceSource,
  value: unknown,
  path: string,
  sourceIndex: number,
  known: ReadonlySet<string>,
  defaultItemSpawnChance: number,
): WorldFixedEncounter {
  const raw = dict(value, path);
  exactKeys(raw, WORLD_FIXED_KEYS, path);
  const monsters = array(raw.monsters, `${path}.monsters`).map((entry, index) => {
    const monsterPath = `${path}.monsters[${index}]`;
    const monster = dict(entry, monsterPath);
    exactKeys(monster, new Set(["extraLivingArguments", "levelScalor", "type"]), monsterPath);
    const type = nonempty(monster.type, `${monsterPath}.type`);
    expect(type === "Random" || known.has(type), `${monsterPath} references unknown monster ${type}.`);
    const extra = monster.extraLivingArguments === undefined
      ? undefined
      : parseExtraLivingArguments(monster.extraLivingArguments, `${monsterPath}.extraLivingArguments`);
    return Object.freeze({
      type,
      levelScalor: finite(monster.levelScalor ?? 1, `${monsterPath}.levelScalor`),
      ...(extra === undefined ? {} : { extraLivingArguments: extra }),
    });
  });
  expect(monsters.length > 0, `${path}.monsters must not be empty.`);
  const exactFloor = raw.exactFloor === undefined
    ? undefined
    : positiveInt(raw.exactFloor, `${path}.exactFloor`);
  const everyXFloors = raw.everyXFloors === undefined
    ? undefined
    : positiveInt(raw.everyXFloors, `${path}.everyXFloors`);
  const breeder = raw.breeder === undefined
    ? undefined
    : parseWorldBreeder(raw.breeder, `${path}.breeder`);
  return Object.freeze({
    sourceIndex,
    monsters: Object.freeze(monsters),
    ...(exactFloor === undefined ? {} : { exactFloor }),
    ...(everyXFloors === undefined ? {} : { everyXFloors }),
    chanceToAppear: optionalProbability(raw.chanceToAppear, 1, `${path}.chanceToAppear`),
    ...optionalFixedString(raw, "uniqueKey", path),
    ...optionalFixedString(raw, "questKey", path),
    ...optionalFixedString(raw, "battleRewardKey", path),
    ...optionalFixedString(raw, "achievement", path),
    ...(raw.startEvent === undefined
      ? {}
      : { startEvent: parseWorldChatEvent(source, raw.startEvent, `${path}.startEvent`) }),
    ...(raw.winEvent === undefined
      ? {}
      : { winEvent: parseWorldChatEvent(source, raw.winEvent, `${path}.winEvent`) }),
    ...(breeder === undefined ? {} : { breeder }),
    ...(raw.treasureData === undefined
      ? {}
      : {
          treasureData: parseDungeonTreasureData(
            raw.treasureData,
            `${path}.treasureData`,
            defaultItemSpawnChance,
          ),
        }),
  });
}

function parseWorldChatEvent(
  source: WorldResourceSource,
  value: unknown,
  path: string,
): WorldChatGameFlowEvent {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["chatKey", "class"]), path);
  expect(raw.class === "ChatGameFlowEvent", `${path}.class must be ChatGameFlowEvent.`);
  const chatKey = nonempty(raw.chatKey, `${path}.chatKey`);
  return Object.freeze({
    className: "ChatGameFlowEvent",
    chat: loadChatDefinition(source, chatKey),
  });
}

function parseWorldBreeder(value: unknown, path: string): DungeonBreederSpec {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["arguments", "type"]), path);
  const type = nonempty(raw.type, `${path}.type`);
  expect(type === "Normal", `${path}.type ${type} is unsupported.`);
  const args = dict(raw.arguments, `${path}.arguments`);
  exactKeys(args, new Set(["allowCapture", "stats", "xpBonus"]), `${path}.arguments`);
  const parsed: Record<string, unknown> = {};
  if (args.stats !== undefined) {
    const stats = dict(args.stats, `${path}.arguments.stats`);
    const allowedStats = new Set(["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"]);
    for (const [stat, amount] of Object.entries(stats)) {
      expect(allowedStats.has(stat), `${path}.arguments.stats contains unsupported stat ${stat}.`);
      parsed[stat] = amount;
      integer(amount, `${path}.arguments.stats.${stat}`);
    }
    parsed["stats"] = Object.freeze({ ...stats });
    for (const stat of Object.keys(stats)) delete parsed[stat];
  }
  if (args.xpBonus !== undefined) {
    parsed["xpBonus"] = nonnegativeFinite(args.xpBonus, `${path}.arguments.xpBonus`);
  }
  if (args.allowCapture !== undefined) {
    parsed["allowCapture"] = boolean(args.allowCapture, `${path}.arguments.allowCapture`);
  }
  return Object.freeze({ type, arguments: Object.freeze(parsed) });
}

function parseExtraLivingArguments(value: unknown, path: string): Readonly<Record<string, unknown>> {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["allowCapture", "boss", "capturable", "displayName", "rendererData"]), path);
  const result: Record<string, unknown> = {};
  for (const key of ["allowCapture", "boss", "capturable"] as const) {
    if (raw[key] !== undefined) result[key] = boolean(raw[key], `${path}.${key}`);
  }
  if (raw.displayName !== undefined) result["displayName"] = nonempty(raw.displayName, `${path}.displayName`);
  if (raw.rendererData !== undefined) {
    const renderer = dict(raw.rendererData, `${path}.rendererData`);
    exactKeys(renderer, new Set(["class", "spriteFile"]), `${path}.rendererData`);
    expect(renderer.class === "CCSprite", `${path}.rendererData.class must be CCSprite.`);
    const spriteFile = png(renderer.spriteFile, `${path}.rendererData.spriteFile`);
    result["rendererData"] = Object.freeze({ class: "CCSprite", spriteFile });
  }
  return Object.freeze(result);
}

interface AuthoredFixedEncounter {
  readonly value: unknown;
  readonly path: string;
}

function authoredFixedEncounters(value: unknown, path: string): readonly AuthoredFixedEncounter[] {
  const raw = dict(value, path);
  const fixed: AuthoredFixedEncounter[] = [];
  if (raw.fixedEncounters !== undefined) {
    for (const [index, encounter] of array(raw.fixedEncounters, `${path}.fixedEncounters`).entries()) {
      fixed.push({ value: encounter, path: `${path}.fixedEncounters[${index}]` });
    }
  }
  const table = raw.table === undefined ? {} : dict(raw.table, `${path}.table`);
  for (const [tier, rowValue] of Object.entries(table)) {
    const row = dict(rowValue, `${path}.table.${tier}`);
    if (row.monsterPopulator === undefined) continue;
    const populator = dict(row.monsterPopulator, `${path}.table.${tier}.monsterPopulator`);
    if (populator.arguments === undefined) continue;
    const args = dict(populator.arguments, `${path}.table.${tier}.monsterPopulator.arguments`);
    if (args.fixedEncounters !== undefined) {
      const fixedPath = `${path}.table.${tier}.monsterPopulator.arguments.fixedEncounters`;
      for (const [index, encounter] of array(args.fixedEncounters, fixedPath).entries()) {
        fixed.push({ value: encounter, path: `${fixedPath}[${index}]` });
      }
    }
  }
  return Object.freeze(fixed);
}

function fixedEncounterChatKeys(value: unknown, path: string): readonly string[] {
  const result: string[] = [];
  for (const authored of authoredFixedEncounters(value, path)) {
    const encounter = dict(authored.value, authored.path);
    for (const eventKey of ["startEvent", "winEvent"] as const) {
      if (encounter[eventKey] === undefined) continue;
      const event = dict(encounter[eventKey], `${authored.path}.${eventKey}`);
      if (event.class === "ChatGameFlowEvent") {
        result.push(nonempty(event.chatKey, `${authored.path}.${eventKey}.chatKey`));
      }
    }
  }
  return Object.freeze(result);
}

function optionalFixedString<
  K extends "uniqueKey" | "questKey" | "battleRewardKey" | "achievement",
>(
  raw: Record<string, unknown>,
  key: K,
  path: string,
): { [P in K]?: string } {
  return raw[key] === undefined ? {} : { [key]: nonempty(raw[key], `${path}.${key}`) } as { [P in K]?: string };
}

function parseZoneChange(source: WorldResourceSource, worlds: Record<string, unknown>, value: unknown, path: string): WorldZoneChange {
  const raw = typedObject(value, path);
  expect(raw.type === "Generic", `${path}.type is unsupported.`);
  const args = dict(raw.arguments, `${path}.arguments`);
  exactKeys(args, new Set(["conditions", "dungeon", "targetZoneChange", "world"]), `${path}.arguments`);
  const conditions = args.conditions === undefined
    ? undefined
    : parseSourceConditions(args.conditions, `${path}.arguments.conditions`);
  if (args.dungeon !== undefined) {
    const dungeonPath = `${path}.arguments.dungeon`;
    const dungeon = dict(args.dungeon, dungeonPath);
    exactKeys(dungeon, new Set(["arguments", "dungeonLevel", "type"]), dungeonPath);
    const dungeonType = nonempty(dungeon.type, `${dungeonPath}.type`);
    const dungeonFile = nonempty(dungeon.arguments, `${dungeonPath}.arguments`);
    const dungeonLevel = dungeon.dungeonLevel === undefined
      ? undefined
      : integer(dungeon.dungeonLevel, `${dungeonPath}.dungeonLevel`);
    requireFile(source, dungeonFile, `dungeon data for ${dungeon.type}`);
    return Object.freeze({
      kind: "dungeon",
      dungeon: dungeonType,
      dungeonFile,
      ...(dungeonLevel === undefined ? {} : { dungeonLevel }),
      targetZoneChange: nonempty(args.targetZoneChange, `${path}.arguments.targetZoneChange`),
      ...(conditions === undefined ? {} : { conditions }),
    });
  }
  const target = typedObject(args.world, `${path}.arguments.world`);
  expect(target.arguments === undefined, `${path}.arguments.world must not have arguments.`);
  expect(worlds[target.type] !== undefined, `${path} references unknown world ${target.type}.`);
  requireFile(source, `${target.type}.plist`, `target world ${target.type}`);
  const targetName = nonempty(args.targetZoneChange, `${path}.arguments.targetZoneChange`);
  const targetRaw = dict(source.plist(`${target.type}.plist`), `${target.type}.plist`);
  const exists = array(targetRaw.pointsOfInterest, `${target.type}.plist.pointsOfInterest`).some((candidate) => {
    const item = typedObject(candidate, `${target.type}.plist.pointsOfInterest[]`);
    return dict(item.arguments, `${target.type}.plist.pointsOfInterest[].arguments`).instanceName === targetName;
  });
  expect(exists, `${path} references missing target point ${target.type}.${targetName}.`);
  return Object.freeze({
    kind: "world",
    targetWorld: target.type,
    targetZoneChange: targetName,
    ...(conditions === undefined ? {} : { conditions }),
  });
}

function parseConnection(value: unknown, path: string, names: ReadonlySet<string>): WorldConnection {
  const raw = typedObject(value, path);
  expect(raw.type === "Connection", `${path}.type must be Connection.`);
  const args = dict(raw.arguments, `${path}.arguments`);
  exactKeys(args, new Set(["conditions", "poi1", "poi2"]), `${path}.arguments`);
  const poi1 = nonempty(args.poi1, `${path}.arguments.poi1`);
  const poi2 = nonempty(args.poi2, `${path}.arguments.poi2`);
  expect(poi1 !== poi2, `${path} cannot connect a point to itself.`);
  const missingPointNames = [poi1, poi2].filter((name) => !names.has(name));
  const requiredCompletedPoiNames = args.conditions === undefined
    ? undefined
    : parseConnectionConditions(args.conditions, `${path}.arguments.conditions`);
  return Object.freeze({
    poi1,
    poi2,
    ...(requiredCompletedPoiNames === undefined ? {} : { requiredCompletedPoiNames }),
    ...(missingPointNames.length === 0
      ? {}
      : { missingPointNames: Object.freeze(missingPointNames) }),
    demoSkipped: Object.freeze([]),
  });
}

function parseConnectionConditions(value: unknown, path: string): readonly string[] {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["pois"]), path);
  const poiName = nonempty(raw.pois, `${path}.pois`);
  expect(poiName.replace(/^!/, "").length > 0, `${path}.pois must name a POI after an optional ! prefix.`);
  return Object.freeze([poiName]);
}

function typedObject(value: unknown, path: string): { type: string; arguments?: unknown } {
  const raw = dict(value, path);
  exactKeys(raw, new Set(["arguments", "type"]), path);
  return { type: nonempty(raw.type, `${path}.type`), ...(raw.arguments === undefined ? {} : { arguments: raw.arguments }) };
}

function resolveDotted(root: Record<string, unknown>, dotted: string, path: string): Record<string, unknown> {
  let value: unknown = root;
  for (const segment of dotted.split(".")) value = dict(value, path)[segment];
  return dict(value, path);
}

function point(value: unknown, path: string): WorldPointValue {
  expect(typeof value === "string", `${path} must be a Cocos point string.`);
  const match = /^\s*\{\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\}\s*$/.exec(value);
  expect(match !== null, `${path} must be a Cocos point string.`);
  const x = Number(match[1]); const y = Number(match[2]);
  expect(Number.isFinite(x) && Number.isFinite(y), `${path} must contain finite coordinates.`);
  return Object.freeze({ x, y });
}

function png(value: unknown, path: string): string {
  const file = nonempty(value, path);
  expect(!file.includes("/") && !file.includes("\\") && file.toLowerCase().endsWith(".png"), `${path} must be a root-level PNG resource.`);
  return file;
}

function dict(value: unknown, path: string): Record<string, unknown> {
  expect(typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array), `${path} must be a dictionary.`);
  return value as Record<string, unknown>;
}
function array(value: unknown, path: string): unknown[] { expect(Array.isArray(value), `${path} must be an array.`); return value; }
function nonempty(value: unknown, path: string): string { expect(typeof value === "string" && value.length > 0, `${path} must be a non-empty string.`); return value; }
function finite(value: unknown, path: string): number { expect(typeof value === "number" && Number.isFinite(value), `${path} must be a finite number.`); return value; }
function nonnegativeFinite(value: unknown, path: string): number { const number = finite(value, path); expect(number >= 0, `${path} must be nonnegative.`); return number; }
function boolean(value: unknown, path: string): boolean { expect(typeof value === "boolean", `${path} must be a boolean.`); return value; }
function positiveInt(value: unknown, path: string): number { const number = finite(value, path); expect(Number.isInteger(number) && number > 0, `${path} must be a positive integer.`); return number; }
function integer(value: unknown, path: string): number { const number = finite(value, path); expect(Number.isInteger(number), `${path} must be an integer.`); return number; }
function nonnegativeInteger(value: unknown, path: string): number { const number = integer(value, path); expect(number >= 0, `${path} must be nonnegative.`); return number; }
function optionalProbability(value: unknown, fallback: number, path: string): number { if (value === undefined) return fallback; const number = finite(value, path); expect(number >= 0 && number <= 1, `${path} must be between zero and one.`); return number; }
function exactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void { for (const key of Object.keys(value)) expect(allowed.has(key), `${path} contains unsupported key ${key}.`); }
function requireFile(source: WorldResourceSource, file: string, role: string): void { expect(source.has(file), `Missing ${role}: ${file}.`); }
function expect(condition: unknown, message: string): asserts condition { if (!condition) throw new WorldDataError(message); }

function optionalConditionNames(
  value: unknown,
  path: string,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : [value];
  expect(values.length > 0, `${path} must not be empty.`);
  return Object.freeze(values.map((entry, index) => {
    const expression = nonempty(entry, `${path}[${index}]`);
    expect(
      expression.replace(/^!/, "").length > 0,
      `${path}[${index}] must name an identity after an optional ! prefix.`,
    );
    return expression;
  }));
}
