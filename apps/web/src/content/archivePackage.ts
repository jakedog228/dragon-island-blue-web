import { unzipSync, type UnzipFileInfo, type Unzipped } from "fflate";
import { parse as parsePlist, type PlistValue } from "plist";
import type { Manifest } from "@dib/renderer";
import type { AnimationsData } from "@dib/renderer/animations";
import type { MeleeAttacksData } from "../battle/abilityRendererMath.js";
import type { LocalizedStrings } from "../localization.js";
import { dungeonGemPresentationProjection, dungeonTreasureSpawnChance } from "@dib/engine";
import {
  CollectionDataError,
  collectDungeonSpriteFiles,
  collectWorldSpriteFiles,
  DungeonDataError,
  GameData,
  inspectDungeonCapability,
  loadCollectionCatalog,
  parseDungeonTreasureData,
  loadQuestCatalog,
  loadTownPortalDestinations,
  loadWorldData,
  QuestDataError,
  WorldDataError,
  type CollectionGoalDefinition,
  type DungeonCapabilityReport,
} from "@dib/gamedata/browser";

const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_ENTRY_COUNT = 5_000;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const PLOT_FRAME_FILES = new Set([
  "plot_start1.png",
  "battleTutorial1.png",
  "battleTutorial2.png",
  "catchTutorial.png",
  "fieldMovement.png",
  "dungeonMovement.png",
  "monsterChange1.png",
  "monsterChange2.png",
  "soulStoneTutorial1.png",
  "soulStoneTutorial2.png",
  "soulStoneTutorial3.png",
  "insertSoulStoneTutorial1.png",
  "insertSoulStoneTutorial2.png",
  "spiritTutorial.png",
  "combineTutorial1.png",
  "combineTutorial2.png",
]);

const textEncoder = new TextEncoder();

type Dict = Record<string, unknown>;

export type ReadonlyPlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | readonly ReadonlyPlistValue[]
  | { readonly [key: string]: ReadonlyPlistValue }
  | null;

/**
 * Format-neutral access to the retained resource files inside the selected app archive.
 * Paths are always relative to the app resource root, regardless of whether the user selected
 * an IPA-shaped archive or a flat ZIP. Parsed plist values are isolated read-only snapshots;
 * callers never receive the archive's mutable byte arrays or the importer's parse cache.
 */
export interface ImportedResourceCatalog {
  list(): readonly string[];
  has(relativePath: string): boolean;
  plist(relativePath: string): ReadonlyPlistValue;
  text(relativePath: string): string;
  url(relativePath: string): string;
  /** Importer-owned, cached, validated atlas backing selected from the source metadata. */
  resolveAtlasBackingFile?(atlasPlistPath: string): string;
}

export interface ImportedGameData {
  monsters: Dict;
  combines: Dict;
  jobs: Dict;
  abilities: Dict;
  abilityComponents: Dict;
  buffs: Dict;
  items?: Dict;
  licenses?: Dict;
  tournaments?: readonly unknown[];
  /** `ThingsInWorld.plist` — display-only world names for Recipe/SpiritTotem long descriptions.
   *  Optional so archives predating its extraction still import. */
  thingsInWorld?: Dict;
  anims: AnimationsData;
  meleeAttacks: MeleeAttacksData;
  scale9: Dict;
  strings: LocalizedStrings;
}

export interface ImportedContentPackage {
  /** The archive is intentionally classified by structure, never by title/vendor identity. */
  sourceKind: "app-archive";
  archiveName: string;
  appDirectory: string;
  data: ImportedGameData;
  resources: ImportedResourceCatalog;
  manifest: Manifest;
  combatBackgroundKeys: readonly string[];
  /** Structurally available source world identifiers; an empty list means this package has no world capability. */
  worldNames: readonly string[];
  /** True only when the strict world scan found at least one source-shaped town POI. */
  hasTownCapability: boolean;
  /** Strict source-data + presentation-role capability, never inferred from archive branding. */
  hasDungeonCapability: boolean;
  /** Source dungeon renderer classes and instance plist files retained by the archive. */
  dungeonTypes: readonly string[];
  dungeonFiles: readonly string[];
  hasProvenanceDocument: boolean;
  urlFor(relativePath: string): string;
  dispose(): void;
}

export class ContentArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentArchiveError";
  }
}

/**
 * Converts either an IPA-shaped ZIP (`Payload/<anything>.app`) or a ZIP whose root is the app
 * resource directory into the one in-memory package contract consumed by the web runtime.
 * Nothing is uploaded, written to a server, or placed in a public Vite directory.
 */
export function importContentArchive(bytes: Uint8Array, archiveName: string): ImportedContentPackage {
  if (bytes.byteLength === 0) throw new ContentArchiveError("The selected archive is empty.");
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new ContentArchiveError(`Archive exceeds the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB limit.`);
  }

  let entryCount = 0;
  let expandedBytes = 0;
  let files: Unzipped;
  try {
    files = unzipSync(bytes, {
      filter: (entry) => {
        validateEntry(entry);
        entryCount++;
        expandedBytes += entry.originalSize;
        if (entryCount > MAX_ENTRY_COUNT) {
          throw new ContentArchiveError(`Archive contains more than ${MAX_ENTRY_COUNT} entries.`);
        }
        if (expandedBytes > MAX_UNCOMPRESSED_BYTES) {
          throw new ContentArchiveError(
            `Archive expands beyond the ${MAX_UNCOMPRESSED_BYTES / 1024 / 1024} MiB limit.`,
          );
        }
        return shouldReadEntry(entry.name);
      },
    });
  } catch (error) {
    if (error instanceof ContentArchiveError) throw error;
    throw new ContentArchiveError(`Could not read ${archiveName} as an IPA/ZIP: ${errorMessage(error)}`);
  }

  const root = findResourceRoot(files);
  const resourceFiles = new Map<string, Uint8Array>();
  for (const [path, value] of Object.entries(files)) {
    if (!path.startsWith(root)) continue;
    const relative = path.slice(root.length);
    if (relative && !relative.endsWith("/")) resourceFiles.set(relative, value);
  }

  const parsedPlists = new Map<string, PlistValue>();
  const plist = (relativePath: string): PlistValue => {
    const cached = parsedPlists.get(relativePath);
    if (cached !== undefined) return cached;
    const raw = resourceFiles.get(relativePath);
    if (!raw) throw new ContentArchiveError(`Required resource is missing: ${relativePath}`);
    try {
      const isBinary = raw.byteLength >= 8 && decodeAscii(raw.subarray(0, 8)) === "bplist00";
      const parsed = parsePlist(isBinary ? raw : new TextDecoder("utf-8").decode(raw));
      parsedPlists.set(relativePath, parsed);
      return parsed;
    } catch (error) {
      throw new ContentArchiveError(`Invalid property list ${relativePath}: ${errorMessage(error)}`);
    }
  };

  const worldNames = resourceFiles.has("Worlds.plist")
    ? Object.freeze(Object.keys(asDict(plist("Worlds.plist"), "Worlds.plist")).sort())
    : Object.freeze([] as string[]);
  const hasTownCapability = worldNames.length > 0 && worldResourcesContainTown(plist);
  if (hasTownCapability) {
    try {
      loadTownPortalDestinations({
        has: (path) => resourceFiles.has(path),
        plist,
      });
    } catch (error) {
      if (error instanceof WorldDataError) {
        throw new ContentArchiveError(`Invalid Town Portal registry: ${error.message}`);
      }
      throw error;
    }
  }
  if (resourceFiles.has("Quests.plist")) {
    try {
      loadQuestCatalog({ has: (path) => resourceFiles.has(path), plist });
    } catch (error) {
      if (error instanceof QuestDataError) {
        throw new ContentArchiveError(`Invalid Guild quest catalog: ${error.message}`);
      }
      throw error;
    }
  }
  const resolvedAtlasBackings = new Map<string, string>();
  const resolveCachedAtlasBackingFile = (atlasPlistPath: string): string => {
    const cached = resolvedAtlasBackings.get(atlasPlistPath);
    if (cached !== undefined) return cached;
    const resolved = resolveAtlasBackingFile(resourceFiles, plist(atlasPlistPath), atlasPlistPath);
    resolvedAtlasBackings.set(atlasPlistPath, resolved);
    return resolved;
  };
  const dungeonCapability = scanDungeonCapability(resourceFiles, plist, resolveCachedAtlasBackingFile);
  const data = buildData(plist, resourceFiles);
  validateQuestRewardCatalog(resourceFiles, plist, data);
  validateCollectionCapability(resourceFiles, plist, worldNames, data);
  validateStartupResources(resourceFiles, plist, data.scale9, data.strings);
  validateEggHatchResources(resourceFiles, plist, data.strings);
  const virtualFiles = new Map<string, Uint8Array>();
  const manifest = buildManifest(
    resourceFiles,
    plist,
    virtualFiles,
    hasTownCapability,
    dungeonCapability,
    resolveCachedAtlasBackingFile,
  );
  const urls = new LocalObjectUrls(resourceFiles, virtualFiles);
  const resources = new LocalResourceCatalog(
    resourceFiles,
    plist,
    urls,
    resolveCachedAtlasBackingFile,
  );
  const combatBackgroundKeys = Object.keys(manifest.sprites)
    .filter((key) => key.endsWith("Combat") && !key.endsWith("-hd"))
    .sort();

  if (combatBackgroundKeys.length === 0) {
    urls.dispose();
    throw new ContentArchiveError("No bare <Biome>Combat.png battle background was found.");
  }

  const appDirectory = root === "" ? "/" : root.replace(/\/$/, "");
  return {
    sourceKind: "app-archive",
    archiveName,
    appDirectory,
    data,
    resources,
    manifest,
    combatBackgroundKeys,
    worldNames,
    hasTownCapability,
    hasDungeonCapability: dungeonCapability.available,
    dungeonTypes: dungeonCapability.dungeonTypes,
    dungeonFiles: dungeonCapability.dungeonFiles,
    hasProvenanceDocument: hasProvenance(resourceFiles),
    urlFor: (relativePath) => urls.urlFor(relativePath),
    dispose: () => urls.dispose(),
  };
}

function validateQuestRewardCatalog(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  data: ImportedGameData,
): void {
  if (!files.has("Quests.plist")) return;
  const gameData = GameData.fromRaw({
    monsters: data.monsters,
    combines: data.combines,
    jobs: data.jobs,
    abilities: data.abilities,
    abilityComponents: data.abilityComponents,
    buffs: data.buffs,
    ...(data.items === undefined ? {} : { items: data.items }),
  });
  try {
    const catalog = loadQuestCatalog({ has: (path) => files.has(path), plist });
    for (const definition of catalog.definitions) {
      parseDungeonTreasureData(
        definition.treasureData,
        `Quests.plist.${definition.name}.treasureData`,
        1,
        gameData,
      );
    }
  } catch (error) {
    if (error instanceof QuestDataError || error instanceof DungeonDataError) {
      throw new ContentArchiveError(`Invalid Guild quest reward catalog: ${error.message}`);
    }
    throw error;
  }
}

function validateEntry(entry: UnzipFileInfo): void {
  const normalized = entry.name.replaceAll("\\", "/");
  if (
    normalized !== entry.name ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new ContentArchiveError(`Unsafe archive path: ${JSON.stringify(entry.name)}`);
  }
  if (entry.originalSize > MAX_ENTRY_BYTES) {
    throw new ContentArchiveError(
      `Archive entry ${entry.name} exceeds the ${MAX_ENTRY_BYTES / 1024 / 1024} MiB per-file limit.`,
    );
  }
  if (entry.compression !== 0 && entry.compression !== 8) {
    throw new ContentArchiveError(`Unsupported ZIP compression method ${entry.compression}: ${entry.name}`);
  }
}

function shouldReadEntry(path: string): boolean {
  if (path.endsWith("/")) return false;
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  return [".plist", ".strings", ".png", ".fnt", ".m4a", ".mp3", ".wav", ".json", ".txt", ".csv"].includes(ext);
}

function findResourceRoot(files: Unzipped): string {
  const monsterPaths = Object.keys(files).filter((path) => path.endsWith("Monsters.plist"));
  const candidates = monsterPaths
    .map((path) => path.slice(0, -"Monsters.plist".length))
    .filter((root) => root === "" || /^Payload\/[^/]+\.app\/$/.test(root))
    .filter((root) => files[`${root}Jobs.plist`] && files[`${root}Abilities.plist`]);

  if (candidates.length === 0) {
    const hasCleanSource = Object.keys(files).some((path) => path.endsWith("plists/Monsters.plist"));
    if (hasCleanSource) {
      throw new ContentArchiveError(
        "This is a clean-room source bundle, not its generated app archive. Run its builder and select the generated IPA/ZIP.",
      );
    }
    throw new ContentArchiveError(
      "No app resource root containing Monsters.plist, Jobs.plist, and Abilities.plist was found.",
    );
  }
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) {
    throw new ContentArchiveError(`Archive contains ${unique.length} candidate game resource roots; expected exactly one.`);
  }
  return unique[0]!;
}

function buildData(
  plist: (relativePath: string) => PlistValue,
  files: ReadonlyMap<string, Uint8Array>,
): ImportedGameData {
  const requiredDict = (name: string): Dict => asDict(plist(`${name}.plist`), `${name}.plist`);
  const optionalDict = (name: string): Dict | undefined =>
    files.has(`${name}.plist`) ? asDict(plist(`${name}.plist`), `${name}.plist`) : undefined;
  const stringsPath = files.has("en.lproj/Localizable.strings")
    ? "en.lproj/Localizable.strings"
    : "Localizable.strings";
  const strings = asStringDict(plist(stringsPath), stringsPath);
  const items = optionalDict("Items");
  const licenses = optionalDict("Licenses");
  const tournaments = files.has("Tournaments.plist")
    ? asArray(plist("Tournaments.plist"), "Tournaments.plist")
    : undefined;
  const thingsInWorld = optionalDict("ThingsInWorld");

  return {
    monsters: requiredDict("Monsters"),
    combines: requiredDict("Combines"),
    jobs: requiredDict("Jobs"),
    abilities: requiredDict("Abilities"),
    abilityComponents: requiredDict("AbilityComponents"),
    buffs: optionalDict("Buffs") ?? {},
    ...(items !== undefined ? { items } : {}),
    ...(licenses !== undefined ? { licenses } : {}),
    ...(tournaments !== undefined ? { tournaments } : {}),
    ...(thingsInWorld !== undefined ? { thingsInWorld } : {}),
    anims: (optionalDict("Animations") ?? {}) as AnimationsData,
    meleeAttacks: (optionalDict("MeleeAttacks") ?? {}) as MeleeAttacksData,
    scale9: optionalDict("Scale9Sprites") ?? {},
    strings,
  };
}

function buildManifest(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  virtualFiles: Map<string, Uint8Array>,
  hasTownCapability: boolean,
  dungeonCapability: DungeonCapabilityReport,
  resolveAtlasBacking: (atlasPlistPath: string) => string,
): Manifest {
  const manifest: Manifest = { atlases: {}, sprites: {}, fonts: {}, audio: {}, particles: {} };
  const atlasPngs = new Set<string>();
  let worldSpriteFiles: ReadonlySet<string> = new Set();
  let dungeonSpriteFiles: ReadonlySet<string> = new Set();
  let popupMenuSpriteFiles: ReadonlySet<string> = new Set();
  if (files.has("Worlds.plist")) {
    const source = { has: (path: string) => files.has(path), plist };
    try {
      worldSpriteFiles = new Set(collectWorldSpriteFiles(source));
      validateWorldPresentationRoles(files, plist, hasTownCapability);
    } catch (error) {
      if (error instanceof WorldDataError) throw new ContentArchiveError(`Invalid world resources: ${error.message}`);
      throw error;
    }
  }
  if (dungeonCapability.available) {
    const source = { has: (path: string) => files.has(path), plist, list: () => [...files.keys()] };
    try {
      dungeonSpriteFiles = new Set(collectDungeonSpriteFiles(source));
      validateDungeonPresentationRoles(files, plist, dungeonCapability);
    } catch (error) {
      if (error instanceof DungeonDataError) throw new ContentArchiveError(`Invalid dungeon resources: ${error.message}`);
      throw error;
    }
  }
  if (files.has("Menus.plist")) {
    popupMenuSpriteFiles = collectPopupMenuStructuralSprites(files, plist);
  }

  for (const name of sortedNames(files, ".plist")) {
    const parsed = plist(name);
    if (!isAtlas(parsed) || !stem(name).endsWith("-hd")) continue;
    const sheet = atlasToPixi(parsed, name);
    const png = resolveAtlasBacking(name);
    const sheetPath = `generated/atlases/${stem(name)}.json`;
    virtualFiles.set(sheetPath, textEncoder.encode(JSON.stringify(sheet)));
    const imagePath = `archive/${png}`;
    atlasPngs.add(png);
    manifest.atlases[stem(name)] = { sheet: sheetPath, image: imagePath };
  }

  for (const name of sortedNames(files, ".png")) {
    const key = stem(name);
    const wanted = key.endsWith("-hd") || key.endsWith("-ipadhd") || key.endsWith("Combat") || worldSpriteFiles.has(name) ||
      popupMenuSpriteFiles.has(name) ||
      dungeonSpriteFiles.has(name) ||
      name === "mainscreenBackground.png" || name === "saveSlotBackground.png" ||
      name === "monsterEvolved.png" || name === "MMScreen.png" || name === "ShopScreen.png" ||
      name === "buy.png" ||
      name === "bigmap.png" ||
      name === "bookPage.png" || name === "leaveIcon.png" ||
      name === "Icon.png" || name === "Icon@2x.png" ||
      // `TournamentPrizeListTableCell~*.nib`'s `lockImage`. Retina-only here: the nib centres the
      // image at native size, so the port wants the 2x asset in its CSF-2 point space.
      name === "lock@2x.png" ||
      PLOT_FRAME_FILES.has(name);
    if (!wanted || atlasPngs.has(name)) continue;
    manifest.sprites[key] = `archive/${name}`;
  }

  for (const name of sortedNames(files, ".fnt")) {
    if (!stem(name).endsWith("-hd")) continue;
    const text = decodeLatin1(files.get(name)!);
    const page = /file="([^"]+)"/.exec(text)?.[1];
    if (!page) throw new ContentArchiveError(`Bitmap font ${name} has no page texture.`);
    const dot = page.lastIndexOf(".");
    const hdPage = dot === -1 ? `${page}-hd` : `${page.slice(0, dot)}-hd${page.slice(dot)}`;
    const texture = files.has(hdPage) ? hdPage : page;
    if (!files.has(texture)) throw new ContentArchiveError(`Bitmap font ${name} references missing texture ${texture}.`);
    manifest.fonts[stem(name)] = { fnt: `archive/${name}`, texture: `archive/${texture}` };
  }

  for (const name of sortedNames(files, ".plist")) {
    const parsed = plist(name);
    if (!isDict(parsed) || typeof parsed["textureFileName"] !== "string" || isAtlas(parsed)) continue;
    const texture = parsed["textureFileName"];
    if (!files.has(texture)) throw new ContentArchiveError(`Particle ${name} references missing texture ${texture}.`);
    const configPath = `generated/particles/${stem(name)}.json`;
    virtualFiles.set(configPath, textEncoder.encode(JSON.stringify(parsed)));
    manifest.particles[name] = { config: configPath, texture: `archive/${texture}` };
  }

  for (const name of [...sortedNames(files, ".m4a"), ...sortedNames(files, ".mp3"), ...sortedNames(files, ".wav")]) {
    const key = stem(name);


    manifest.audio[key] = `archive/${name}`;
  }
  return manifest;
}

function collectPopupMenuStructuralSprites(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
): ReadonlySet<string> {
  const menus = asDict(plist("Menus.plist"), "Menus.plist");
  const result = new Set<string>();
  for (const [name, value] of Object.entries(menus)) {
    const config = asDict(value, `Menus.plist.${name}`);
    const background = config["fullScreenBackground"];
    if (background === undefined) continue;
    if (
      typeof background !== "string" ||
      background.length === 0 ||
      background.includes("/") ||
      background.includes("\\") ||
      !background.toLowerCase().endsWith(".png")
    ) {
      throw new ContentArchiveError(
        `Menus.plist.${name}.fullScreenBackground must be a root-level PNG resource.`,
      );
    }
    if (!files.has(background)) {
      throw new ContentArchiveError(
        `Menus.plist.${name}.fullScreenBackground references missing ${background}.`,
      );
    }
    result.add(background);
  }
  return result;
}

function validateCollectionCapability(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  worldNames: readonly string[],
  data: ImportedGameData,
): void {
  const gameData = GameData.fromRaw({
    monsters: data.monsters,
    combines: data.combines,
    jobs: data.jobs,
    abilities: data.abilities,
    abilityComponents: data.abilityComponents,
    buffs: data.buffs,
    ...(data.items === undefined ? {} : { items: data.items }),
  });
  const knownMonsterTypes = new Set(gameData.allMonsters().map(({ shortType }) => shortType));
  const source = { has: (path: string) => files.has(path), plist };
  const routes: Array<{ readonly poiName: string; readonly collectionType: string }> = [];
  try {
    for (const worldName of worldNames) {
      for (const point of loadWorldData(source, worldName, knownMonsterTypes).pointsOfInterest) {
        if (point.supportedInteraction?.kind !== "monsterCollection") continue;
        routes.push({
          poiName: point.name,
          collectionType: point.supportedInteraction.collectionType,
        });
      }
    }
  } catch (error) {
    if (error instanceof WorldDataError) {
      throw new ContentArchiveError(`Invalid world resources: ${error.message}`);
    }
    throw error;
  }

  if (routes.length === 0 && !files.has("Collection.plist")) return;
  if (routes.length > 0 && !files.has("Collection.plist")) {
    throw new ContentArchiveError(
      `Collection route ${routes[0]!.poiName} requires Collection.plist`,
    );
  }

  let catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>;
  try {
    catalog = loadCollectionCatalog(source, gameData);
  } catch (error) {
    if (error instanceof CollectionDataError) {
      throw new ContentArchiveError(`Invalid Collection resources: ${error.message}`);
    }
    throw error;
  }
  for (const route of routes) {
    if (!catalog.has(route.collectionType)) {
      throw new ContentArchiveError(
        `Collection route ${route.poiName} references missing collection type ${route.collectionType}`,
      );
    }
  }
  if (routes.length > 0) validateCollectionPresentationRoles(files, plist, data.strings, catalog, routes);
}

function validateCollectionPresentationRoles(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  strings: LocalizedStrings,
  catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>,
  routes: readonly { readonly poiName: string; readonly collectionType: string }[],
): void {
  for (const name of ["PopupMenuCloseButton-hd.png", "arial_18_bold-hd.fnt"]) {
    if (!files.has(name)) throw new ContentArchiveError(`Collection route resources require ${name}.`);
  }
  if (!files.has("downArrow-hd.png")) {
    throw new ContentArchiveError("Collection route resources require downArrow-hd.png.");
  }
  for (const key of [
    "CollectionHutListTitleKey",
    "MonsterCollectionChatKey",
    "BackButtonKey",
  ]) {
    requireCollectionLocalization(strings, key);
  }

  const goalKeys = new Set<string>();
  const goals: CollectionGoalDefinition[] = [];
  for (const route of routes) {
    for (const goal of catalog.get(route.collectionType)!) {
      const identity = `${goal.collectionType}:${goal.key}`;
      if (goalKeys.has(identity)) continue;
      goalKeys.add(identity);
      goals.push(goal);
    }
  }

  if (goals.length === 0) return;
  for (const key of [
    "CollectionGoalKey",
    "OkButtonKey",
    "AlreadyFinishedCollectionQuestTitleKey",
    "AlreadyFinishedCollectionQuestMessageKey",
  ]) requireCollectionLocalization(strings, key);
  for (const goal of goals) {
    requireCollectionLocalization(strings, `${goal.key}CollectionQuestTitleKey`);
    requireCollectionLocalization(strings, `${goal.key}CollectionQuestDescriptionKey`);
  }

  const frameNames = new Set<string>();
  let hasSupportedLoot = false;
  let hasGeneratedGem = false;
  for (const goal of goals) {
    for (const spawn of goal.treasureData.items) {
      if (dungeonTreasureSpawnChance(goal.treasureData, spawn, 1) === 0) continue;
      if (spawn.kind === "silver") {
        hasSupportedLoot = true;
        frameNames.add("pileSilver.png");
        requireCollectionLocalization(strings, "RenderableSilverNameKey");
        requireCollectionLocalization(strings, "ExtraDescriptionSilver");
      } else if (spawn.kind === "gold") {
        hasSupportedLoot = true;
        frameNames.add("pileGold.png");
        requireCollectionLocalization(strings, "RenderableGoldNameKey");
        requireCollectionLocalization(strings, "ExtraDescriptionGold");
      } else if (spawn.kind === "random" || spawn.kind === "randomGem") {
        hasSupportedLoot = true;
        hasGeneratedGem = true;
        if (spawn.kind === "random") {
          frameNames.add("pileSilver.png");
          frameNames.add("pileGold.png");
          requireCollectionLocalization(strings, "RenderableSilverNameKey");
          requireCollectionLocalization(strings, "RenderableGoldNameKey");
          requireCollectionLocalization(strings, "ExtraDescriptionSilver");
          requireCollectionLocalization(strings, "ExtraDescriptionGold");
        }
        const gemRoles = collectionGemPresentationRoles(goal, spawn);
        for (const frame of gemRoles.frames) frameNames.add(frame);
        for (const key of gemRoles.localization) {
          requireCollectionLocalization(strings, key);
        }
      } else if (spawn.kind === "fixed") {
        switch (spawn.data.kind) {
          case "spiritTotem":
            hasSupportedLoot = true;
            frameNames.add("Item_Totem.png");
            requireCollectionLocalization(strings, "RenderableSpiritTotemNameKey");
            requireCollectionLocalization(strings, "ExtraDescriptionSpiritTotem");
            break;
          case "recipe":
            hasSupportedLoot = true;
            frameNames.add("Item_Recipe.png");
            requireCollectionLocalization(strings, "RenderableRecipeNameKey");
            requireCollectionLocalization(strings, "ExtraDescriptionRecipe");
            break;
          case "monsterJoin":
            hasSupportedLoot = true;
            if (!files.has(`${spawn.data.shortType}-hd.png`)) {
              throw new ContentArchiveError(
                `Collection reward resources require ${spawn.data.shortType}-hd.png for MonsterJoin.`,
              );
            }
            break;
          case "egg":
          case "monsterEgg":
            // Local claims fail closed before generation until the hatch continuation is owned.
            break;
        }
      }
    }
  }
  if (!hasSupportedLoot) return;
  requireCollectionLocalization(strings, "NewItemsKey");
  requireCollectionLocalization(strings, "TakeAllKey");
  if (!files.has("rightArrow-hd.png")) {
    throw new ContentArchiveError("Collection reward resources require rightArrow-hd.png.");
  }
  if (!files.has("General-hd.plist")) {
    throw new ContentArchiveError("Collection reward resources require General-hd.plist.");
  }
  resolveAtlasBackingFile(files, plist("General-hd.plist"), "General-hd.plist");
  if (hasGeneratedGem) {
    const general = asDict(plist("General-hd.plist"), "General-hd.plist");
    const generalFrames = asDict(general["frames"], "General-hd.plist.frames");
    for (const name of [
      "StatMaxHP.png",
      "StatAttack.png",
      "StatMagic.png",
      "StatSpeed.png",
      "StatDefense.png",
      "StatResist.png",
    ]) {
      if (!(name in generalFrames)) {
        throw new ContentArchiveError(`General-hd.plist is missing Collection reward frame ${name}.`);
      }
    }
  }
  const inventory = atlasFrameNames(plist, "InventoryItemFrames-hd.plist");
  for (const name of frameNames) {
    if (!inventory.has(name)) {
      throw new ContentArchiveError(
        `InventoryItemFrames-hd.plist is missing Collection reward frame ${name}.`,
      );
    }
  }
}

function requireCollectionLocalization(strings: LocalizedStrings, key: string): void {
  if (typeof strings[key] !== "string") {
    throw new ContentArchiveError(`Collection route resources require localization key ${key}.`);
  }
}

function collectionGemPresentationRoles(
  goal: CollectionGoalDefinition,
  spawn: { readonly kind: "random" | "randomGem"; readonly levelScalor: number },
): { readonly frames: readonly string[]; readonly localization: readonly string[] } {
  const projection = dungeonGemPresentationProjection(goal.treasureData, spawn);
  const slotNames = ["Novice", "Veteran", "Elite", "Grandmaster"];
  const frames: string[] = [];
  const localization: string[] = [`GemItemLevel${projection.tier}Key`];
  for (let slot = 0; slot <= projection.maxSlot; slot++) {
    const name = slotNames[slot]!;
    frames.push(`${name}Gem${projection.tier}.png`, `${name}GemGlow.png`);
    localization.push(`${name}SlotKey`);
  }
  return { frames, localization };
}

function validateStartupResources(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  scale9: Dict,
  strings: LocalizedStrings,
): void {
  for (const name of [
    "Info.plist",
    "Credits.plist",
    "mainscreenBackground.png",
    "saveSlotBackground.png",
    "PopupMenuButton2-hd.png",
    "PopupBackgroundThin-hd.png",
    "ClerkGirl-hd.png",
    "TutorialRightSide-hd.png",
  ]) {
    if (!files.has(name)) {
      throw new ContentArchiveError(`Startup resources require ${name}.`);
    }
  }
  for (const audioStem of ["Opening1", "click"]) {
    requireAudioStem(files, "Startup resources", audioStem);
  }
  const info = asDict(plist("Info.plist"), "Info.plist");
  const version = info["CFBundleShortVersionString"] ?? info["CFBundleVersion"];
  if (typeof version !== "string" || version.length === 0) {
    throw new ContentArchiveError(
      "Info.plist requires CFBundleShortVersionString or CFBundleVersion.",
    );
  }
  const credits = plist("Credits.plist");
  if (!Array.isArray(credits) || credits.length === 0) {
    throw new ContentArchiveError("Credits.plist must be a non-empty array.");
  }
  credits.forEach((row, index) => {
    if (!isDict(row)) {
      throw new ContentArchiveError(`Credits.plist row ${index} must be a dictionary.`);
    }
    const type = row["type"];
    const value = row["value"];
    const validText = (type === "title" || type === "entry") &&
      typeof value === "string" && value.length > 0;
    const validSpace = type === "space" && typeof value === "number" &&
      Number.isFinite(value) && value > 0;
    if (!validText && !validSpace) {
      throw new ContentArchiveError(`Credits.plist row ${index} has an invalid type/value.`);
    }
  });
  for (const key of ["MenuButton2", "PopupBackgroundThin"]) {
    const entry = scale9[key];
    if (!isDict(entry)) {
      throw new ContentArchiveError(`Scale9Sprites.plist requires ${key}.`);
    }
    const image = entry["image"];
    if (typeof image !== "string" || !/\.png$/i.test(image)) {
      throw new ContentArchiveError(`Scale9Sprites.plist ${key} requires a PNG image.`);
    }
    if (typeof entry["contentRect"] !== "string") {
      throw new ContentArchiveError(`Scale9Sprites.plist ${key} requires contentRect.`);
    }
    const hdImage = `${image.replace(/\.png$/i, "")}-hd.png`;
    if (!files.has(hdImage)) {
      throw new ContentArchiveError(`Scale9Sprites.plist ${key} requires ${hdImage}.`);
    }
  }
  for (const key of [
    "LoadingKey",
    "First-Time Loading On 3GS May Take A While",
    "TouchToContinueKey",
    "PickSaveSlotKey",
    "NewGameButtonKey",
    "GameDisplayFormatKey",
    "EraseGameButtonKey",
    "CreditsButtonKey",
    "OptionsKey",
    "BackButtonKey",
    "PickEraseSaveSlotKey",
    "EraseGameAreYouSureTitleKey",
    "EraseGameAreYouSureMessageKey",
    "YesButtonKey",
    "NoButtonKey",
    "MusicVolumeKey",
    "SoundVolumeKey",
    "OkButtonKey",
  ]) {
    if (typeof strings[key] !== "string") {
      throw new ContentArchiveError(`Startup resources require localization key ${key}.`);
    }
  }
}

/**
 * Silver/Gold eggs are ordinary destroy-on-pickup quest/treasure rewards, so their presentation
 * roles belong to every accepted runtime package rather than the optional dungeon capability.
 */
function validateEggHatchResources(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  strings: LocalizedStrings,
): void {
  for (const [name, width, height] of [
    ["SlotBackground-hd.png", 960, 640],
    ["SlotBackground-ipadhd.png", 1024, 768],
    ["SlotBacking-hd.png", 364, 203],
    ["SlotBacking-ipadhd.png", 426, 238],
    ["SlotArrow-hd.png", 94, 62],
    ["largeRarityStar-hd.png", 64, 59],
  ] as const) {
    if (!files.has(name)) throw new ContentArchiveError(`Egg hatch resources require ${name}.`);
    const actual = pngPixelSize(files.get(name)!, name);
    if (actual.width !== width || actual.height !== height) {
      throw new ContentArchiveError(
        `Egg hatch resource ${name} must be ${width}x${height}px; got ` +
        `${actual.width}x${actual.height}px.`,
      );
    }
  }
  if (!hasAudioStem(files, "Casino1")) {
    throw new ContentArchiveError(
      "Egg hatch resources require audio stem Casino1 (.m4a, .mp3, or .wav).",
    );
  }
  const inventory = atlasFrameNames(plist, "InventoryItemFrames-hd.plist");
  for (const name of [
    "pileGold.png",
    "pileSilver.png",
    "Item_Recipe.png",
    "Item_Totem.png",
    "Item_Card2.png",
    "Item_Card3.png",
  ]) {
    if (!inventory.has(name)) {
      throw new ContentArchiveError(`InventoryItemFrames-hd.plist is missing egg-hatch frame ${name}.`);
    }
  }
  for (const rank of ["Novice", "Veteran", "Elite"]) {
    if (![...inventory].some((name) => name.startsWith(`${rank}Gem`) && /Gem\d+\.png$/.test(name))) {
      throw new ContentArchiveError(
        `InventoryItemFrames-hd.plist has no egg-hatch ${rank} Gem frames.`,
      );
    }
    if (!inventory.has(`${rank}GemGlow.png`)) {
      throw new ContentArchiveError(
        `InventoryItemFrames-hd.plist is missing egg-hatch frame ${rank}GemGlow.png.`,
      );
    }
  }
  const monsterpedia = atlasFrameNames(plist, "MonsterpediaFrames-hd.plist");
  if (!monsterpedia.has("rarityStar.png")) {
    throw new ContentArchiveError(
      "MonsterpediaFrames-hd.plist is missing egg-hatch frame rarityStar.png.",
    );
  }
  for (const key of [
    "WinPrizeTitleFormatKey",
    "WonMonsterMessageKey",
    "KeepKey",
    "FeedToButtonKey",
    "CancelButtonKey",
    "SpinFedFullMessageFormatKey",
    "SpinFedMessageFormatKey",
    "SpinAgainMessageKey",
    "SpinFinishedMessageFormatKey",
    "SpinAgainTitleKey",
    "SpinFinishedTitleKey",
    "YesGoldFormatKey",
    "NoButtonKey",
    "OkButtonKey",
    "CannotAffordThingTitleKey",
    "CannotAffordThingMessageKey",
    "RenderableGoldNameKey",
    "RenderableSilverNameKey",
    "RenderableRecipeNameKey",
    "RenderableSpiritTotemNameKey",
    "NoviceSlotKey",
    "VeteranSlotKey",
    "EliteSlotKey",
    "GemItemLevel1Key",
    "GemItemLevel2Key",
    "GemItemLevel3Key",
    "GemItemLevel4Key",
    "GemItemLevel5Key",
    "GemItemLevel6Key",
  ]) {
    if (typeof strings[key] !== "string") {
      throw new ContentArchiveError(`Egg hatch resources require localization key ${key}.`);
    }
  }
}

function pngPixelSize(
  bytes: Uint8Array,
  name: string,
): { readonly width: number; readonly height: number } {
  if (
    bytes.length < 24 ||
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47 ||
    decodeLatin1(bytes.subarray(12, 16)) !== "IHDR"
  ) {
    throw new ContentArchiveError(`Egg hatch resource ${name} is not a complete PNG header.`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function scanDungeonCapability(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  resolveAtlasBacking: (atlasPlistPath: string) => string,
): DungeonCapabilityReport {
  const source = {
    has: (path: string) => files.has(path),
    plist,
    list: () => [...files.keys()],
    resolveAtlasBackingFile: resolveAtlasBacking,
  };
  try {
    const report = inspectDungeonCapability(source);
    if (!report.available && report.missing.length > 0) {
      throw new ContentArchiveError(`Incomplete dungeon resources: ${report.missing.join(", ")}.`);
    }
    return report;
  } catch (error) {
    if (error instanceof ContentArchiveError) throw error;
    if (error instanceof DungeonDataError) throw new ContentArchiveError(`Invalid dungeon resources: ${error.message}`);
    throw error;
  }
}

function validateDungeonPresentationRoles(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  report: DungeonCapabilityReport,
): void {
  const sparkle = asDict(plist("Sparkle.plist"), "Sparkle.plist");
  const sparkleTexture = requiredString(sparkle["textureFileName"], "Sparkle.plist.textureFileName");
  if (!files.has(sparkleTexture)) {
    throw new ContentArchiveError(`Sparkle.plist references missing texture ${sparkleTexture}.`);
  }
  const registry = asDict(plist("Dungeons.plist"), "Dungeons.plist");
  const roomRegistry = asDict(plist("Rooms.plist"), "Rooms.plist");
  for (const typeName of report.dungeonTypes) {
    const theme = asDict(registry[typeName], `Dungeons.plist.${typeName}`);
    const creation = asDict(theme["creationData"], `Dungeons.plist.${typeName}.creationData`);
    const rooms = selectedDungeonRoomDimensions(roomRegistry, asDict(creation["roomTypes"], `Dungeons.plist.${typeName}.creationData.roomTypes`));
    const sheets = stringArray(theme["spritesheets"], `Dungeons.plist.${typeName}.spritesheets`);
    const frames = new Set<string>();
    for (const sheet of sheets) {
      const atlasPath = `${sheet}-hd.plist`;
      const atlas = asDict(plist(atlasPath), atlasPath);
      for (const name of Object.keys(asDict(atlas["frames"], `${atlasPath}.frames`))) frames.add(name);
    }
    const floor = asDict(theme["floorRendererData"], `Dungeons.plist.${typeName}.floorRendererData`);
    const wall = asDict(theme["wallRendererData"], `Dungeons.plist.${typeName}.wallRendererData`);
    const door = asDict(theme["doorRendererData"], `Dungeons.plist.${typeName}.doorRendererData`);
    const north = asDict(theme["northDoorRendererData"], `Dungeons.plist.${typeName}.northDoorRendererData`);
    requireFormattedFrames(frames, requiredString(floor["spriteFrameFormat"], `${typeName}.floor.spriteFrameFormat`), integerValue(floor["spriteFrameCount"]), [], typeName, "floor");
    requireFormattedFrames(frames, requiredString(door["spriteFrameFormat"], `${typeName}.door.spriteFrameFormat`), integerValue(door["spriteFrameCount"]), [], typeName, "door");
    requireDungeonFrame(frames, requiredString(north["spriteFrame"], `${typeName}.northDoor.spriteFrame`), typeName);
    const wallFormat = requiredString(wall["spriteFrameFormat"], `${typeName}.wall.spriteFrameFormat`);
    const wallCount = integerValue(wall["spriteFrameCount"]);
    if ((wallFormat.match(/%d/g) ?? []).length === 3) {
      for (const room of rooms) requireFormattedFrames(frames, wallFormat, wallCount, [room.w, room.h], typeName, "wall");
    } else {
      requireFormattedFrames(frames, wallFormat, wallCount, [], typeName, "wall");
    }
    if (wall["wallItemSpriteFrameFormat"] !== undefined) {
      requireFormattedFrames(frames, requiredString(wall["wallItemSpriteFrameFormat"], `${typeName}.wall.wallItemSpriteFrameFormat`), integerValue(wall["wallItemCount"]), [], typeName, "wall item");
    }
    for (const name of ["chest.png", "portal.png", "stairsUp.png", "stairsDown.png"]) requireDungeonFrame(frames, name, typeName);
    if (floor["overlay"] !== undefined) requireDungeonFrame(frames, requiredString(floor["overlay"], `${typeName}.floor.overlay`), typeName);
  }

  const inventory = atlasFrameNames(plist, "InventoryItemFrames-hd.plist");
  for (const name of ["Item_Totem.png", "Item_Recipe.png", "Egg.png", "MonsterEgg.png", "pileSilver.png", "pileGold.png"]) {
    if (!inventory.has(name)) throw new ContentArchiveError(`InventoryItemFrames-hd.plist is missing dungeon frame ${name}.`);
  }
  if (![...inventory].some((name) => /^(?:Novice|Veteran|Elite|Grandmaster)Gem\d+\.png$/.test(name))) {
    throw new ContentArchiveError("InventoryItemFrames-hd.plist has no random-gem frames.");
  }
  const portraits = atlasFrameNames(plist, "MonsterPortraits-hd.plist");
  for (const shortType of collectSpiritTotemTypes(report.dungeonFiles, plist)) {
    if (!portraits.has(`${shortType}_icon.png`)) {
      throw new ContentArchiveError(`MonsterPortraits-hd.plist is missing spirit portrait ${shortType}_icon.png.`);
    }
  }
}

function selectedDungeonRoomDimensions(
  root: Dict,
  selected: Dict,
): readonly { readonly w: number; readonly h: number }[] {
  const found = new Map<string, { w: number; h: number }>();
  for (const dotted of Object.keys(selected)) {
    let value: unknown = root;
    for (const segment of dotted.split(".")) value = asDict(value, `Rooms.plist.${dotted}`)[segment];
    const room = asDict(value, `Rooms.plist.${dotted}`);
    const [w, h] = parsePoint(room["dimensions"], `Rooms.plist.${dotted}.dimensions`);
    found.set(`${w}x${h}`, { w, h });
  }
  return [...found.values()];
}

function requireFormattedFrames(
  frames: ReadonlySet<string>,
  format: string,
  count: number,
  tail: readonly number[],
  typeName: string,
  role: string,
): void {
  for (let index = 1; index <= count; index++) {
    const values = [index, ...tail];
    let cursor = 0;
    const name = format.replace(/%d/g, () => String(values[cursor++]));
    if (cursor !== values.length) throw new ContentArchiveError(`Unsupported ${typeName} ${role} format ${format}.`);
    requireDungeonFrame(frames, name, typeName);
  }
}

function requireDungeonFrame(frames: ReadonlySet<string>, name: string, typeName: string): void {
  if (!frames.has(name)) throw new ContentArchiveError(`${typeName} dungeon atlas is missing frame ${name}.`);
}

function atlasFrameNames(plist: (relativePath: string) => PlistValue, path: string): ReadonlySet<string> {
  const atlas = asDict(plist(path), path);
  return new Set(Object.keys(asDict(atlas["frames"], `${path}.frames`)));
}

function collectSpiritTotemTypes(
  files: readonly string[],
  plist: (relativePath: string) => PlistValue,
): readonly string[] {
  const result = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const child of value) walk(child); return; }
    if (!isDict(value)) return;
    if (value["type"] === "DestroyOnPickup.SpiritTotem") {
      const args = asDict(value["arguments"], "SpiritTotem.arguments");
      result.add(requiredString(args["shortType"], "SpiritTotem.arguments.shortType"));
    }
    for (const child of Object.values(value)) walk(child);
  };
  for (const file of files) walk(plist(file));
  return [...result].sort();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new ContentArchiveError(`${label} must be an array.`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) throw new ContentArchiveError(`${label}[${index}] must be a string.`);
    return entry;
  });
}

function integerValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ContentArchiveError(`Expected a nonnegative integer, got ${String(value)}.`);
  }
  return value;
}

const HERO_DIRECTIONS = ["Front", "Back", "Left", "Right"] as const;

function validateWorldPresentationRoles(
  files: ReadonlyMap<string, Uint8Array>,
  plist: (relativePath: string) => PlistValue,
  hasTown: boolean,
): void {
  requireAudioStem(files, "World resources", "Field1");
  if (hasTown) {
    for (const audioStem of ["night", "rooster", "Town1"]) {
      requireAudioStem(files, "Town resources", audioStem);
    }
    for (const name of ["sunrise-hd.png", "removeAllFromBattingOrder-hd.png"]) {
      if (!files.has(name)) {
        throw new ContentArchiveError(`Town resources require ${name}.`);
      }
    }
    const stringsPath = files.has("en.lproj/Localizable.strings")
      ? "en.lproj/Localizable.strings"
      : "Localizable.strings";
    const strings = asDict(plist(stringsPath), stringsPath);
    for (const key of [
      "DayFormatKey",
      "DayEndKey",
      "BattleGroupKey",
      "SortButtonKey",
      "BattingOrderFullTitleKey",
      "BattingOrderFullMessageKey",
      "CannotRemoveAllFromBattingOrderTitleKey",
      "CannotRemoveAllFromBattingOrderMessageKey",
      "ConfirmRemoveAllFromBattingOrderTitleKey",
      "ConfirmRemoveAllFromBattingOrderMessageKey",
    ]) {
      if (typeof strings[key] !== "string") {
        throw new ContentArchiveError(`Town resources require localization key ${key}.`);
      }
    }
  }
  for (const name of [
    "greenFlag-hd.png",
    "redFlag-hd.png",
    "blueFlag-hd.png",
    "menuButton-hd.png",
    "namePlate-hd.png",
    "General-hd.plist",
  ]) {
    if (!files.has(name)) throw new ContentArchiveError(`World resources require ${name}.`);
  }
  resolveAtlasBackingFile(files, plist("General-hd.plist"), "General-hd.plist");
  const general = asDict(plist("General-hd.plist"), "General-hd.plist");
  const generalFrames = asDict(general["frames"], "General-hd.plist.frames");
  for (const name of ["heroXpFrame.png", "heroXpBar.png"]) {
    if (!(name in generalFrames)) throw new ContentArchiveError(`General-hd.plist is missing frame ${name}.`);
  }
  for (const name of ["HeroWalkFrames-hd.plist", "HeroWalkFrames-hd.png"]) {
    if (!files.has(name)) throw new ContentArchiveError(`World resources require ${name}.`);
  }
  const atlas = asDict(plist("HeroWalkFrames-hd.plist"), "HeroWalkFrames-hd.plist");
  const frames = asDict(atlas["frames"], "HeroWalkFrames-hd.plist.frames");
  for (const direction of HERO_DIRECTIONS) {
    for (let index = 1; index <= 8; index++) {
      const name = `herowalk${direction}_${index}.png`;
      if (!(name in frames)) throw new ContentArchiveError(`HeroWalkFrames-hd.plist is missing frame ${name}.`);
    }
  }
}

function worldResourcesContainTown(plist: (relativePath: string) => PlistValue): boolean {
  const worlds = asDict(plist("Worlds.plist"), "Worlds.plist");
  for (const name of Object.keys(worlds)) {
    const worldPath = `${name}.plist`;
    const world = asDict(plist(worldPath), worldPath);
    const points = world["pointsOfInterest"];
    if (!Array.isArray(points)) {
      throw new ContentArchiveError(`${worldPath}.pointsOfInterest must be an array.`);
    }
    for (let index = 0; index < points.length; index++) {
      const point = asDict(points[index], `${worldPath}.pointsOfInterest[${index}]`);
      const argumentsValue = asDict(
        point["arguments"],
        `${worldPath}.pointsOfInterest[${index}].arguments`,
      );
      if (Object.hasOwn(argumentsValue, "buildings")) return true;
    }
  }
  return false;
}

function atlasToPixi(value: PlistValue, source: string): Dict {
  const atlas = asDict(value, source);
  const metadata = asDict(atlas["metadata"], `${source}.metadata`);
  const framesIn = asDict(atlas["frames"], `${source}.frames`);
  const [width, height] = parsePoint(metadata["size"], `${source}.metadata.size`);
  const frames: Dict = {};
  for (const [name, raw] of Object.entries(framesIn)) {
    const frame = asDict(raw, `${source}.frames.${name}`);
    const [x, y, w, h] = parseRect(frame["frame"], `${source}.frames.${name}.frame`);
    const [sx, sy] = parseRect(frame["sourceColorRect"], `${source}.frames.${name}.sourceColorRect`);
    const [sw, sh] = parsePoint(frame["sourceSize"], `${source}.frames.${name}.sourceSize`);
    frames[name] = {
      frame: { x, y, w, h },
      rotated: boolValue(frame["rotated"] ?? false, `${source}.frames.${name}.rotated`),
      trimmed: true,
      spriteSourceSize: { x: sx, y: sy, w, h },
      sourceSize: { w: sw, h: sh },
    };
  }
  return { frames, meta: { image: "resolved-by-AssetLibrary", size: { w: width, h: height }, scale: "1" } };
}

function resolveAtlasBackingFile(
  files: ReadonlyMap<string, Uint8Array>,
  value: PlistValue,
  source: string,
): string {
  const atlas = asDict(value, source);
  const metadata = asDict(atlas["metadata"], `${source}.metadata`);
  const derivedPng = `${stem(source)}.png`;
  const metadataPng = stringValue(metadata["realTextureFileName"] ?? metadata["textureFileName"]);
  const png = files.has(derivedPng) ? derivedPng : metadataPng;
  if (png !== undefined) validateResourceLookupPath(png);
  if (png !== undefined && !png.toLowerCase().endsWith(".png")) {
    throw new ContentArchiveError(`Atlas ${source} must reference a PNG texture; got ${png}.`);
  }
  if (!png || !files.has(png)) {
    throw new ContentArchiveError(`Atlas ${source} references missing texture ${png ?? "<none>"}.`);
  }
  return png;
}

function isAtlas(value: PlistValue): value is { [key: string]: PlistValue } {
  return isDict(value) && isDict(value["frames"]) && isDict(value["metadata"]);
}

function parsePoint(value: unknown, label: string): [number, number] {
  if (typeof value !== "string") throw new ContentArchiveError(`${label} is not a Cocos point string.`);
  const match = /^\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}\s*$/.exec(value);
  if (!match) throw new ContentArchiveError(`${label} is not a Cocos point string: ${value}`);
  return [Number(match[1]), Number(match[2])];
}

function parseRect(value: unknown, label: string): [number, number, number, number] {
  if (typeof value !== "string") throw new ContentArchiveError(`${label} is not a Cocos rect string.`);
  const n = "(-?\\d+(?:\\.\\d+)?)";
  const match = new RegExp(`^\\s*\\{\\s*\\{\\s*${n}\\s*,\\s*${n}\\s*\\}\\s*,\\s*\\{\\s*${n}\\s*,\\s*${n}\\s*\\}\\s*\\}\\s*$`).exec(value);
  if (!match) throw new ContentArchiveError(`${label} is not a Cocos rect string: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
}

class LocalObjectUrls {
  private readonly urls = new Map<string, string>();

  constructor(
    private readonly archiveFiles: ReadonlyMap<string, Uint8Array>,
    private readonly virtualFiles: ReadonlyMap<string, Uint8Array>,
  ) {}

  urlFor(relativePath: string): string {
    const cached = this.urls.get(relativePath);
    if (cached) return cached;
    const raw = relativePath.startsWith("archive/")
      ? this.archiveFiles.get(relativePath.slice("archive/".length))
      : this.virtualFiles.get(relativePath);
    if (!raw) throw new ContentArchiveError(`Unknown package asset path: ${relativePath}`);
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    const url = URL.createObjectURL(new Blob([copy.buffer], { type: importedResourceMimeType(relativePath) }));
    this.urls.set(relativePath, url);
    return url;
  }

  dispose(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

class LocalResourceCatalog implements ImportedResourceCatalog {
  private readonly paths: readonly string[];

  constructor(
    private readonly files: ReadonlyMap<string, Uint8Array>,
    private readonly parsePlist: (relativePath: string) => PlistValue,
    private readonly urls: LocalObjectUrls,
    private readonly resolveAtlasBacking: (atlasPlistPath: string) => string,
  ) {
    this.paths = Object.freeze([...files.keys()].sort());
  }

  list(): readonly string[] {
    return this.paths;
  }

  has(relativePath: string): boolean {
    validateResourceLookupPath(relativePath);
    return this.files.has(relativePath);
  }

  plist(relativePath: string): ReadonlyPlistValue {
    validateResourceLookupPath(relativePath);
    if (!isPlistResource(relativePath)) {
      throw new ContentArchiveError(
        `Resource ${relativePath} is not a property list; expected a .plist or .strings path.`,
      );
    }
    this.require(relativePath);
    return clonePlistValue(this.parsePlist(relativePath));
  }

  text(relativePath: string): string {
    validateResourceLookupPath(relativePath);
    if (!isTextResource(relativePath)) {
      throw new ContentArchiveError(
        `Resource ${relativePath} is not a supported text resource; expected .txt, .csv, .json, or .fnt.`,
      );
    }
    const raw = this.require(relativePath);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch (error) {
      throw new ContentArchiveError(`Resource ${relativePath} is not valid UTF-8 text: ${errorMessage(error)}`);
    }
  }

  url(relativePath: string): string {
    validateResourceLookupPath(relativePath);
    this.require(relativePath);
    return this.urls.urlFor(`archive/${relativePath}`);
  }

  resolveAtlasBackingFile(atlasPlistPath: string): string {
    validateResourceLookupPath(atlasPlistPath);
    return this.resolveAtlasBacking(atlasPlistPath);
  }

  private require(relativePath: string): Uint8Array {
    const raw = this.files.get(relativePath);
    if (!raw) throw new ContentArchiveError(`Content resource is missing: ${relativePath}`);
    return raw;
  }
}

function validateResourceLookupPath(relativePath: string): void {
  const parts = relativePath.split("/");
  if (
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:\//.test(relativePath) ||
    parts.some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new ContentArchiveError(`Invalid content resource path: ${JSON.stringify(relativePath)}`);
  }
}

function isPlistResource(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return lower.endsWith(".plist") || lower.endsWith(".strings");
}

function isTextResource(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return [".txt", ".csv", ".json", ".fnt"].some((extension) => lower.endsWith(extension));
}

function clonePlistValue(value: PlistValue): ReadonlyPlistValue {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof Date) return Object.freeze(new Date(value.getTime()));
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => clonePlistValue(entry)));
  if (isDict(value)) {
    const copy: Record<string, ReadonlyPlistValue> = {};
    for (const [key, entry] of Object.entries(value)) copy[key] = clonePlistValue(entry);
    return Object.freeze(copy);
  }
  return value;
}

function hasProvenance(files: ReadonlyMap<string, Uint8Array>): boolean {
  return [...files.keys()].some((name) => /(^|\/)(asset_provenance\.csv|third_party_assets\.txt)$/i.test(name));
}

function sortedNames(files: ReadonlyMap<string, Uint8Array>, suffix: string): string[] {
  return [...files.keys()].filter((name) => name.toLowerCase().endsWith(suffix)).sort();
}

function stem(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

function asDict(value: unknown, label: string): Dict {
  if (!isDict(value)) throw new ContentArchiveError(`${label} must contain a dictionary.`);
  return value as Dict;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new ContentArchiveError(`${label} must contain an array.`);
  return value;
}

function asStringDict(value: unknown, label: string): Record<string, string> {
  const dict = asDict(value, label);
  for (const [key, entry] of Object.entries(dict)) {
    if (typeof entry !== "string") throw new ContentArchiveError(`${label} contains non-string value at ${key}.`);
  }
  return dict as Record<string, string>;
}

function isDict(value: unknown): value is { [key: string]: PlistValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array) && !(value instanceof Date);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ContentArchiveError(`${label} must be a non-empty string.`);
  }
  return value;
}

function boolValue(value: unknown, label: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  throw new ContentArchiveError(`${label} is not boolean.`);
}

function decodeLatin1(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

function decodeAscii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

export function importedResourceMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".fnt")) return "text/plain";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function hasAudioStem(files: ReadonlyMap<string, Uint8Array>, audioStem: string): boolean {
  return [".m4a", ".mp3", ".wav"].some((extension) => files.has(`${audioStem}${extension}`));
}

function requireAudioStem(
  files: ReadonlyMap<string, Uint8Array>,
  role: string,
  audioStem: string,
): void {
  if (!hasAudioStem(files, audioStem)) {
    throw new ContentArchiveError(
      `${role} require audio stem ${audioStem} (.m4a, .mp3, or .wav).`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
