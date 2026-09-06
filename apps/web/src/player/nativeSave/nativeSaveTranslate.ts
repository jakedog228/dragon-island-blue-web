


import {
  heroLevelForXp,
  jobLevelAfterAward,
  jobXpCostOfNextLevel,
  jobXpForLevel,
  type GuildQuestProgress,
  type GuildQuestStateSnapshot,
  type PlayerMonsterInstance,
  type SoulStoneSetup,
} from "@dib/engine";
import type { Element, GameData } from "@dib/gamedata/browser";
import {
  PLAYER_LICENSE_ORDER,
  PlayerInventory,
  battingOrderSizeFor,
  type GemInventoryItem,
  type PlayerInventoryItem,
  type PlayerInventoryStateV1,
  type PlayerLicenseType,
  type PlayerStatName,
} from "@dib/player-domain";
import type { PlistValue } from "./binaryPlist.js";
import {
  ITEMS_FILE,
  MONSTERS_FILE,
  NativeSaveFormatError,
  compareText,
  integerMap,
  parray,
  pdict,
  pflags,
  pint,
  pmap,
  preal,
  pstr,
  readsAsTrue,
  requireDict,
  requireInteger,
  requireNumber,
  requireString,
  stringArray,
  trueKeys,
  type NativePlayerData,
  type NativeRenderableRecord,
  type NativeSaveDocument,
} from "./nativeSaveDocument.js";
import { parsePlayerGameStateSnapshot, type PlayerGameStateSnapshot, type WorldProgressStateSnapshotV2 } from "../gameState.js";
import { PlayerRuntimeState, type PlayerPartyStateSnapshot } from "../playerRuntimeState.js";
import { chainCollapsedHeroTotal, type PlayerProfileStateSnapshotV8 } from "../playerProfile.js";

/** `Items.plist` gem `slot` names, in the license-slot order `parseLegacyGemKey` already assumes. */
const GEM_SLOT_NAMES = ["Novice", "Veteran", "Elite", "Grandmaster"] as const;

const GEM_QUALITY_NAMES = ["Magic", "Epic", "Unique"] as const;
const PLAYER_STAT_ORDER: readonly PlayerStatName[] = Object.freeze([
  "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
]);
const ELEMENTS: readonly Element[] = Object.freeze([
  "Air", "Arcane", "Death", "Earth", "Fire", "Life", "Water",
]);
/** `collectionClaimId()`: a claim is a `props` flag under this prefix. */
const COLLECTION_CLAIM_PREFIX = "CollectionQuest";

/** `props` keys this translator owns. Anything else is reported as unrepresentable on import. */
const TRANSLATED_PROP_KEYS: readonly string[] = Object.freeze([
  "activeQuests", "battleRewardsGiven", "catchQuestsDone", "combineRecipes", "dayNumber",
  "dialogsSeen", "finishedQuests", "fixedEncountersFinished", "highestLevelMonsters",
  "infiniteHighestLevel", "lastSavedLevel", "lastTown", "questProgressData", "skillPoints",
  "spiritsData", "tournament", "visitedTowns", "visitedWorlds",
]);

/** `props` keys the port deliberately does not model, named so the warning can be specific. */
const KNOWN_UNMODELLED_PROP_KEYS: readonly string[] = Object.freeze([
  "analyticsKeys", "dealsBought", "dealsSeen", "dungeonMod",
  "monstersSeen", "sparklesNeeded",
]);

export interface NativeSaveContext {
  readonly data: GameData;
  /** `Worlds.plist` world name -> its POI names. Resolves `props.lastTown` back to its world. */
  readonly worldPoiNames: ReadonlyMap<string, readonly string[]>;
}

export interface NativeSaveWarning {
  readonly code: string;
  readonly message: string;
}

export interface NativeSaveSummary {
  readonly heroLevel: number;
  readonly partySize: number;
  readonly silver: number;
  readonly gold: number;
  readonly dayNumber: number;
  readonly lastTownName?: string;
}

export interface NativeSaveImportResult {
  readonly state: PlayerGameStateSnapshot;
  readonly warnings: readonly NativeSaveWarning[];
  readonly summary: NativeSaveSummary;
}

export interface NativeSaveExportResult {
  readonly document: NativeSaveDocument;
  readonly warnings: readonly NativeSaveWarning[];
}

class WarningLog {
  private readonly entries: NativeSaveWarning[] = [];
  private readonly seen = new Set<string>();

  add(code: string, message: string): void {
    const key = `${code}:${message}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.entries.push(Object.freeze({ code, message }));
  }

  snapshot(): readonly NativeSaveWarning[] {
    return Object.freeze([...this.entries]);
  }
}

// =================================================================================================
// Import: native document -> PlayerGameStateSnapshot
// =================================================================================================

export function importNativeSave(
  document: NativeSaveDocument,
  context: NativeSaveContext,
): NativeSaveImportResult {
  const warnings = new WarningLog();
  const props = document.props;

  const monsters = document.player.savedMonsters.map((record, index) =>
    importMonster(record, index, context, warnings));
  if (monsters.length === 0) {
    throw new NativeSaveFormatError(
      "this save has no monsters on the bench, so there is nothing to restore",
    );
  }

  const licenseType = importLicenseType(document.player.savedLicenseType, warnings);
  const inventory = importInventory(document.player, context, warnings);
  const ownedSoulStones = importLooseSoulStones(document.player.savedItems, context, warnings);
  const profile = importProfile(document, licenseType, inventory, context, warnings);

  const party: PlayerPartyStateSnapshot = {
    kind: "world-trip-party",


    battingOrderSize: battingOrderSizeFor(
      context.data.license(licenseType).battingOrderSize,
      profile.hero.level,
      { infiniteDungeonHighestLevel: profile.infiniteDungeonHighestLevel },
    ),
    monsters,
    soulStones: ownedSoulStones,
  };

  const world = importWorldProgress(document, context, warnings);
  const quests = importQuests(props, warnings);
  const claimedCollectionGoalIds = importCollectionClaims(props);

  reportUnmodelledSections(document, warnings);


  const draft = {
    schemaVersion: 1 as const,
    player: {
      schemaVersion: 2 as const,
      profile,
      party,
      claimedCollectionGoalIds,
    },
    ...(quests === undefined ? {} : { quests }),
    ...(world === undefined ? {} : { world }),
  };
  const runtime = PlayerRuntimeState.fromStateSnapshot(context.data, draft.player);
  runtime.party?.fullRestoreAndReapplyPermanentBuffs();

  const state = parsePlayerGameStateSnapshot({ ...draft, player: runtime.stateSnapshot() });
  return Object.freeze({
    state,
    warnings: warnings.snapshot(),
    summary: Object.freeze({
      heroLevel: profile.hero.level,
      partySize: monsters.length,
      silver: profile.silver,
      gold: profile.gold,
      dayNumber: world?.dayNumber ?? 1,
      ...(world?.lastTownName === undefined ? {} : { lastTownName: world.lastTownName }),
    }),
  });
}

function importMonster(
  record: NativeRenderableRecord,
  index: number,
  context: NativeSaveContext,
  warnings: WarningLog,
): PlayerMonsterInstance {
  const label = `savedMonsters[${index}]`;
  if (record.creationFile !== MONSTERS_FILE) {
    throw new NativeSaveFormatError(
      `${label} was created from ${record.creationFile}, not ${MONSTERS_FILE}`,
    );
  }
  const shortType = resolveMonsterShortType(record.name, label, context, warnings);
  const penalty = context.data.jobXpPenalty(shortType);
  const { level, cumulativeXp } = importJobProgress(record, label, penalty, warnings);
  const injury = importInjury(record, label);
  const stone = importEquippedSoulStone(record, label, context, warnings);

  return {
    // The native format carries no per-monster identity, so one is synthesized. Bench position is
    // the only stable discriminator the source has, and it is what the batting order reads.
    instanceId: `native-${index + 1}-${shortType}`,
    shortType,
    level,
    cumulativeXp,
    // Replaced by the real MaxHP once the aggregate heals; a positive placeholder only has to
    // satisfy the party invariant on the way in.
    currentHp: 1,
    ...injury,
    ...(stone === undefined ? {} : { soulStone: stone }),
  };
}


function resolveMonsterShortType(
  name: string,
  label: string,
  context: NativeSaveContext,
  warnings: WarningLog,
): string {
  const byPath = context.data.allMonsters().find((monster) => monster.path === name);
  if (byPath !== undefined) return byPath.shortType;
  const shortType = name.slice(name.lastIndexOf(".") + 1);
  let fallback: { readonly path: string } | undefined;
  try {
    fallback = context.data.monsterByShortType(shortType);
  } catch {
    fallback = undefined;
  }
  if (fallback === undefined) {
    throw new NativeSaveFormatError(
      `${label} is a "${name}", which this content archive does not define`,
    );
  }
  warnings.add(
    "monster-path-moved",
    `${label}: "${name}" is not a path in this archive; matched "${fallback.path}" by species name.`,
  );
  return shortType;
}

function importJobProgress(
  record: NativeRenderableRecord,
  label: string,
  penalty: number,
  warnings: WarningLog,
): { level: number; cumulativeXp: number } {
  const prop = record.properties.get("JobLevelProp");
  if (prop === undefined) {
    // `-[Job loadFinishedWithRootParent:]` falls back to the raw cumulative total when the
    // fractional property is absent (pre-`levelAsDouble` saves).
    const legacy = record.properties.get("JobXpProp");
    if (legacy === undefined) {
      throw new NativeSaveFormatError(`${label} has neither JobLevelProp nor JobXpProp`);
    }
    const cumulativeXp = requireInteger(legacy, `${label}.JobXpProp`);
    if (cumulativeXp < 0) throw new NativeSaveFormatError(`${label}.JobXpProp is negative`);
    return { level: jobLevelAfterAward(1, cumulativeXp, penalty), cumulativeXp };
  }

  const raw = requireNumber(prop, `${label}.JobLevelProp`);
  // The source compares against 1.0 before flooring, so a nonpositive prop restores at level 1.
  const clamped = Math.max(1, raw);
  const band = Math.floor(clamped);
  const bandFloor = jobXpForLevel(band, penalty);
  const bandCost = jobXpCostOfNextLevel(band, penalty);
  const cumulativeXp = roundTiesToEven(bandFloor + (clamped - band) * bandCost);
  if (!Number.isSafeInteger(cumulativeXp) || cumulativeXp < 0) {
    throw new NativeSaveFormatError(`${label}.JobLevelProp ${raw} does not invert to a valid XP total`);
  }

  // The native loop starts from the Job's creation level. Starting from the band the property
  // itself names reaches the same answer for any save the game wrote, and cannot produce the
  // degenerate "level above its own XP band" state that the port's party invariant rejects.
  const creationLevel = readCreationJobLevel(record);
  if (creationLevel !== undefined && creationLevel > band) {
    warnings.add(
      "monster-creation-level-above-xp",
      `${label}: creation level ${creationLevel} is above the level ${band} its XP supports; ` +
        `restoring at level ${band}.`,
    );
  }
  return { level: jobLevelAfterAward(band, cumulativeXp, penalty), cumulativeXp };
}

function readCreationJobLevel(record: NativeRenderableRecord): number | undefined {
  const jobArguments = record.creationArguments.get("jobArguments");
  if (jobArguments === undefined || jobArguments.kind !== "dict") return undefined;
  const level = jobArguments.value.get("level");
  if (level === undefined || (level.kind !== "int" && level.kind !== "real")) return undefined;
  return Math.trunc(level.value);
}

/** ARM `vcvtr` rounds ties to even; `Math.round` rounds them up. */
function roundTiesToEven(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value % 1) === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}

function importInjury(
  record: NativeRenderableRecord,
  label: string,
): { injureTime?: number; healTime?: number } {
  const injureTime = record.monsterSaveData.get("injureTime");
  const healTime = record.monsterSaveData.get("healTime");
  if (injureTime === undefined || healTime === undefined) return {};
  return {
    injureTime: requireNumber(injureTime, `${label}.injureTime`),
    healTime: requireNumber(healTime, `${label}.healTime`),
  };
}

function importEquippedSoulStone(
  record: NativeRenderableRecord,
  label: string,
  context: NativeSaveContext,
  warnings: WarningLog,
): SoulStoneSetup | undefined {
  const stones = record.children.filter((child) => soulStoneElementOf(child.name) !== undefined);
  if (stones.length === 0) {
    for (const child of record.children) {
      warnings.add(
        "monster-child-dropped",
        `${label}: equipped "${child.name}" has no port equivalent and was not restored.`,
      );
    }
    return undefined;
  }
  if (stones.length > 1) {
    warnings.add(
      "monster-extra-soul-stones",
      `${label} carries ${stones.length} soul stones; the source allows one, so the first was kept.`,
    );
  }
  return importSoulStone(stones[0]!, `${label}.soulStone`, context, warnings);
}

function soulStoneElementOf(name: string): Element | undefined {
  const match = /^SoulStones\.(.+)SoulStone$/.exec(name);
  if (match === null) return undefined;
  return ELEMENTS.find((element) => element === match[1]);
}

function importSoulStone(
  record: NativeRenderableRecord,
  label: string,
  context: NativeSaveContext,
  warnings: WarningLog,
): SoulStoneSetup {
  const element = soulStoneElementOf(record.name);
  if (element === undefined) {
    throw new NativeSaveFormatError(`${label} names an unknown soul stone "${record.name}"`);
  }
  context.data.soulStoneByElement(element);
  const rawLevel = record.creationArguments.get("level");
  const level = rawLevel === undefined ? 1 : requireInteger(rawLevel, `${label}.level`);
  if (level < 1) throw new NativeSaveFormatError(`${label} has a non-positive level ${level}`);


  const sourceTypeValue = record.properties.get("sourceType");
  let sourceType: string | undefined;
  if (sourceTypeValue !== undefined) {
    const candidate = requireString(sourceTypeValue, `${label}.sourceType`);
    try {
      context.data.monsterByShortType(candidate);
      sourceType = candidate;
    } catch {
      warnings.add(
        "soul-stone-source-unknown",
        `${label}: sacrificed species "${candidate}" is not in this archive, so Desoul cannot ` +
          "revive from this stone.",
      );
    }
  }
  return { element, level, ...(sourceType === undefined ? {} : { sourceType }) };
}

function importLooseSoulStones(
  records: readonly NativeRenderableRecord[],
  context: NativeSaveContext,
  warnings: WarningLog,
): readonly SoulStoneSetup[] {
  return records.flatMap((record, index) =>
    soulStoneElementOf(record.name) === undefined
      ? []
      : [importSoulStone(record, `savedItems[${index}]`, context, warnings)]);
}

function importLicenseType(name: string, warnings: WarningLog): PlayerLicenseType {
  const match = PLAYER_LICENSE_ORDER.find((license) => license === name);
  if (match !== undefined) return match;

  warnings.add(
    "license-unknown",
    `Unknown license "${name}"; restoring as Novice, exactly as the original game does.`,
  );
  return "Novice";
}


function importInventory(
  player: NativePlayerData,
  context: NativeSaveContext,
  warnings: WarningLog,
): PlayerInventoryStateV1 {
  const inventory = new PlayerInventory();
  for (const [index, record] of player.savedItems.entries()) {
    if (soulStoneElementOf(record.name) !== undefined) continue; // handled as the loose stone pool
    addInventoryItem(inventory, record, `savedItems[${index}]`, context, warnings);
  }
  const equipped: GemInventoryItem[] = [];
  for (const [index, record] of player.savedGemsInLicense.entries()) {
    const item = addInventoryItem(
      inventory,
      record,
      `savedGemsInLicense[${index}]`,
      context,
      warnings,
    );
    if (item?.kind === "gem") equipped.push(item);
  }
  const gemSlots = licenseGemSlots(importLicenseType(player.savedLicenseType, warnings));
  for (const gem of equipped) {
    if (gem.slot >= gemSlots) {
      warnings.add(
        "gem-slot-unavailable",
        `An equipped ${GEM_SLOT_NAMES[gem.slot]} Gem needs a license slot this save's license ` +
          "does not have; it was returned to the bag.",
      );
      continue;
    }
    inventory.equipGem(gem.id, (slot) => slot < gemSlots);
  }
  return inventory.stateSnapshot();
}

function addInventoryItem(
  inventory: PlayerInventory,
  record: NativeRenderableRecord,
  label: string,
  context: NativeSaveContext,
  warnings: WarningLog,
): PlayerInventoryItem | undefined {
  if (record.creationFile !== ITEMS_FILE) {
    warnings.add(
      "item-file-unknown",
      `${label} was created from ${record.creationFile}; it was not restored.`,
    );
    return undefined;
  }
  let definition;
  try {
    definition = context.data.item(record.name);
  } catch {
    warnings.add(
      "item-unknown",
      `${label} is a "${record.name}", which this content archive does not define; it was dropped.`,
    );
    return undefined;
  }

  switch (definition.className) {
    case "Gem":
      return inventory.addGem({
        definitionPath: definition.path,
        level: readItemLevel(record, label, 1),
        quality: readGemQuality(record, label, warnings),
        slot: gemSlotFor(definition.slot, label),
        enabledStats: readGemStats(record, label, warnings),
      });
    case "Egg":
    case "CustomEgg":
      return inventory.addEgg({
        definitionPath: definition.path,
        instanceName: definition.instanceName,
        onlyMonsters: definition.onlyMonsters,
        repeats: definition.repeats,
      });
    default:
      return inventory.addUsable(
        definition.path,
        definition.instanceName,
        readItemLevel(record, label, 1),
      );
  }
}

function readItemLevel(record: NativeRenderableRecord, label: string, fallback: number): number {
  const level = record.creationArguments.get("level");
  if (level === undefined) return fallback;
  const value = requireInteger(level, `${label}.level`);
  return value < 1 ? fallback : value;
}

function readGemQuality(
  record: NativeRenderableRecord,
  label: string,
  warnings: WarningLog,
): number {
  const quality = record.creationArguments.get("quality");
  if (quality === undefined) return 0;
  if (quality.kind === "int") return Math.max(0, quality.value);
  const name = requireString(quality, `${label}.quality`);
  const index = GEM_QUALITY_NAMES.indexOf(name as (typeof GEM_QUALITY_NAMES)[number]);
  if (index >= 0) return index;
  warnings.add("gem-quality-unknown", `${label} has quality "${name}"; treated as Magic.`);
  return 0;
}

function readGemStats(
  record: NativeRenderableRecord,
  label: string,
  warnings: WarningLog,
): readonly PlayerStatName[] {
  const stats = record.creationArguments.get("stats");
  if (stats === undefined) return [];
  const enabled: PlayerStatName[] = [];
  for (const [name, value] of requireDict(stats, `${label}.stats`)) {
    if (!readsAsTrue(value)) continue;
    const stat = PLAYER_STAT_ORDER.find((candidate) => candidate === name);
    if (stat === undefined) {
      warnings.add("gem-stat-unknown", `${label} boosts unknown stat "${name}"; it was ignored.`);
      continue;
    }
    enabled.push(stat);
  }
  return enabled.sort((left, right) =>
    PLAYER_STAT_ORDER.indexOf(left) - PLAYER_STAT_ORDER.indexOf(right));
}

function gemSlotFor(slot: string, label: string): 0 | 1 | 2 | 3 {
  const index = GEM_SLOT_NAMES.indexOf(slot as (typeof GEM_SLOT_NAMES)[number]);
  if (index < 0) throw new NativeSaveFormatError(`${label} has unsupported Gem slot "${slot}"`);
  return index as 0 | 1 | 2 | 3;
}

function licenseGemSlots(license: PlayerLicenseType): number {
  return [0, 1, 2, 2, 3, 4, 4][PLAYER_LICENSE_ORDER.indexOf(license)] ?? 0;
}

function importProfile(
  document: NativeSaveDocument,
  licenseType: PlayerLicenseType,
  inventory: PlayerInventoryStateV1,
  context: NativeSaveContext,
  warnings: WarningLog,
): PlayerProfileStateSnapshotV8 {
  const props = document.props;
  const highestCapturedLevels = Object.fromEntries(
    [...integerMap(props.get("highestLevelMonsters"), "props.highestLevelMonsters")]
      .sort(([left], [right]) => compareText(left, right)),
  );


  const totalHighestLevels = chainCollapsedHeroTotal(
    highestCapturedLevels,
    (shortType) => context.data.evolveChainOrUndefined(shortType),
  );
  const heroLevel = heroLevelForXp(totalHighestLevels);
  const declared = props.get("lastSavedLevel");
  if (declared !== undefined) {
    const stated = requireInteger(declared, "props.lastSavedLevel");
    if (stated !== heroLevel) {


      warnings.add(
        "hero-level-mismatch",
        `The save records hero level ${stated}, but its collection history derives ${heroLevel}. ` +
          `The derived level was used, as the original game does.`,
      );
    }
  }

  return {
    schemaVersion: 8,
    hero: { level: heroLevel, totalHighestLevels },
    silver: Math.max(0, document.silver),
    gold: importGold(document, warnings),
    inventory,
    licenseType,
    skillPoints: importSkillPoints(props, heroLevel, warnings),
    highestCapturedLevels,
    learnedCombineRecipes: trueKeys(dictAt(props, "combineRecipes")).filter((shortType) => {
      if (context.data.combineRecipeOrUndefined(shortType) !== undefined) return true;
      warnings.add(
        "combine-recipe-unknown",
        `The learned recipe for "${shortType}" has no definition in this archive and was dropped.`,
      );
      return false;
    }),
    tutorialFlags: trueKeys(document.tutorialFlags),
    catchQuestsDone: [...stringArray(props.get("catchQuestsDone"), "props.catchQuestsDone")]
      .sort(compareText),
    dungeonWaypoints: importWaypoints(document.waypoints),
    infiniteDungeonHighestLevel: importInfiniteHighestLevel(props, warnings),
    tournament: importTournament(props, warnings),
    // `HeroData.energyPercent` and `Player.spiritsSummonedThisTrip` are per-trip and appear in no
    // saved section, so both restore empty exactly as the original does.
    spiritEnergy: 0,
    spiritSavedXp: importSpiritXp(props),
    spiritsUsedThisTrip: [],
  };
}


function importInfiniteHighestLevel(
  props: ReadonlyMap<string, PlistValue>,
  warnings: WarningLog,
): number {
  const raw = props.get("infiniteHighestLevel");
  if (raw === undefined) return 0;
  const value = requireInteger(raw, "props.infiniteHighestLevel");
  if (value < 0) {
    warnings.add(
      "infinite-dungeon-floor-invalid",
      `The save records a deepest Infinite Dungeon floor of ${value}, which the game never writes. ` +
        `It was read as 0.`,
    );
    return 0;
  }
  return value;
}


function importGold(document: NativeSaveDocument, warnings: WarningLog): number {
  const balance = document.goldFound - document.goldSpent;
  if (balance < 0) {
    warnings.add(
      "gold-purchased-missing",
      `This save spent ${document.goldSpent} gold against ${document.goldFound} found, so the ` +
        "remainder came from purchased gold that lives outside the save file. Gold was restored " +
        "as 0.",
    );
    return 0;
  }
  return balance;
}

function importSkillPoints(
  props: ReadonlyMap<string, PlistValue>,
  heroLevel: number,
  warnings: WarningLog,
): Record<PlayerStatName, number> {
  const saved = integerMap(props.get("skillPoints"), "props.skillPoints");
  const allocation = Object.fromEntries(
    PLAYER_STAT_ORDER.map((stat) => [stat, Math.max(0, saved.get(stat) ?? 0)]),
  ) as Record<PlayerStatName, number>;
  for (const key of saved.keys()) {
    if (!PLAYER_STAT_ORDER.includes(key as PlayerStatName)) {
      warnings.add("skill-stat-unknown", `props.skillPoints names unknown stat "${key}".`);
    }
  }


  let total = PLAYER_STAT_ORDER.reduce((sum, stat) => sum + allocation[stat], 0);
  if (total > heroLevel) {
    warnings.add(
      "skill-points-over-budget",
      `This save allocates ${total} skill points at hero level ${heroLevel}. The excess was ` +
        "dropped from the lowest-priority stats.",
    );
    for (let index = PLAYER_STAT_ORDER.length - 1; index >= 0 && total > heroLevel; index -= 1) {
      const stat = PLAYER_STAT_ORDER[index]!;
      const removed = Math.min(allocation[stat], total - heroLevel);
      allocation[stat] -= removed;
      total -= removed;
    }
  }
  return allocation;
}

function importWaypoints(
  waypoints: ReadonlyMap<string, PlistValue>,
): Record<string, readonly number[]> {
  const result: Record<string, readonly number[]> = {};
  for (const [instanceName, value] of [...waypoints].sort(([left], [right]) => compareText(left, right))) {
    const floors: number[] = [];
    for (const [floor, flag] of requireDict(value, `waypoints.${instanceName}`)) {
      if (!readsAsTrue(flag)) continue;
      const parsed = Number(floor);
      if (Number.isSafeInteger(parsed) && parsed > 0) floors.push(parsed);
    }
    if (floors.length > 0) result[instanceName] = floors.sort((left, right) => left - right);
  }
  return result;
}

function importTournament(
  props: ReadonlyMap<string, PlistValue>,
  warnings: WarningLog,
): PlayerProfileStateSnapshotV8["tournament"] {
  const tournament = props.get("tournament");
  const empty = { schemaVersion: 1 as const, index: 0, round: 0, status: 0 as const };
  if (tournament === undefined) return empty;
  const entries = requireDict(tournament, "props.tournament");
  const index = Math.max(0, readOptionalInteger(entries, "index", 0));
  const round = Math.max(0, readOptionalInteger(entries, "round", 0));
  const status = readOptionalInteger(entries, "status", 0);
  const timeLast = entries.has("timeLast")
    ? requireNumber(entries.get("timeLast")!, "props.tournament.timeLast")
    : undefined;
  if (status !== 0 && status !== 1 && status !== 2) {
    warnings.add("tournament-status-unknown", `Tournament status ${status} was reset to idle.`);
    return empty;
  }


  if ((status === 2) !== (round === 4)) {
    warnings.add(
      "tournament-state-inconsistent",
      `Tournament round ${round} with status ${status} is not a state the original produces; ` +
        "tournament progress was reset.",
    );
    return empty;
  }
  return {
    schemaVersion: 1,
    index,
    round,
    status,
    ...(timeLast === undefined ? {} : { timeLast }),
  };
}

function readOptionalInteger(
  entries: ReadonlyMap<string, PlistValue>,
  key: string,
  fallback: number,
): number {
  const value = entries.get(key);
  return value === undefined ? fallback : requireInteger(value, key);
}

/** `props.spiritsData` is `{shortType: {xp: int}}` (`addExperience:toSpiritWithShortType:`). */
function importSpiritXp(props: ReadonlyMap<string, PlistValue>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [shortType, value] of dictAt(props, "spiritsData")) {
    const xp = requireDict(value, `props.spiritsData.${shortType}`).get("xp");
    if (xp === undefined) continue;
    const amount = requireInteger(xp, `props.spiritsData.${shortType}.xp`);
    if (amount > 0) result[shortType] = amount;
  }
  return result;
}

function importQuests(
  props: ReadonlyMap<string, PlistValue>,
  warnings: WarningLog,
): GuildQuestStateSnapshot | undefined {
  const activeQuestNames = unique(stringArray(props.get("activeQuests"), "props.activeQuests"));
  const finishedQuestNames = unique(stringArray(props.get("finishedQuests"), "props.finishedQuests"));
  const dialogsSeen = trueKeys(dictAt(props, "dialogsSeen"));
  const completedFixedEncounterKeys = trueKeys(dictAt(props, "fixedEncountersFinished"));
  const receivedBattleRewardKeys = trueKeys(dictAt(props, "battleRewardsGiven"));
  const progressByQuestName: Record<string, GuildQuestProgress> = {};
  for (const [questName, value] of dictAt(props, "questProgressData")) {
    const progress = plistToJson(value, `props.questProgressData.${questName}`, warnings);
    if (progress === null || typeof progress !== "object" || Array.isArray(progress)) {
      warnings.add(
        "quest-progress-shape",
        `Progress for quest "${questName}" is not a dictionary; it was dropped.`,
      );
      continue;
    }
    progressByQuestName[questName] = progress as GuildQuestProgress;
  }
  if (
    activeQuestNames.length === 0 &&
    finishedQuestNames.length === 0 &&
    dialogsSeen.length === 0 &&
    completedFixedEncounterKeys.length === 0 &&
    receivedBattleRewardKeys.length === 0 &&
    Object.keys(progressByQuestName).length === 0
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    activeQuestNames,
    finishedQuestNames,
    progressByQuestName,
    dialogsSeen,
    completedFixedEncounterKeys,
    receivedBattleRewardKeys,
  };
}

function importCollectionClaims(props: ReadonlyMap<string, PlistValue>): readonly string[] {
  return [...props]
    .filter(([key, value]) => key.startsWith(COLLECTION_CLAIM_PREFIX) && readsAsTrue(value))
    .map(([key]) => key)
    .sort(compareText);
}

/**
 * The world the player will resume in.
 *
 * `props.lastTown` is the only stored position — a native save is always written standing in a
 * town or on the map, never mid-dungeon (there is no dungeon-run section at all) — so the world is
 * whichever one owns that POI. Per-trip refresh state (`completedThisRefresh`, occurrence rolls)
 * is likewise not saved, so it restores empty, exactly as the source begins a fresh refresh.
 */
function importWorldProgress(
  document: NativeSaveDocument,
  context: NativeSaveContext,
  warnings: WarningLog,
): WorldProgressStateSnapshotV2 | undefined {
  const props = document.props;
  const lastTown = props.has("lastTown")
    ? requireString(props.get("lastTown")!, "props.lastTown")
    : undefined;
  const visitedWorlds = stringArray(props.get("visitedWorlds"), "props.visitedWorlds");

  const owningWorld = lastTown === undefined
    ? undefined
    : [...context.worldPoiNames].find(([, pois]) => pois.includes(lastTown))?.[0];
  const worldName = owningWorld
    ?? [...visitedWorlds].reverse().find((name) => context.worldPoiNames.has(name));
  if (worldName === undefined) {
    warnings.add(
      "world-unresolved",
      lastTown === undefined
        ? "This save records no last town, so world progress could not be restored."
        : `This archive has no world containing "${lastTown}", so world progress was not restored.`,
    );
    return undefined;
  }
  const pois = context.worldPoiNames.get(worldName)!;
  const currentPoiName = lastTown !== undefined && pois.includes(lastTown) ? lastTown : pois[0];
  if (currentPoiName === undefined) {
    warnings.add("world-empty", `World "${worldName}" defines no points of interest.`);
    return undefined;
  }

  const everCompletedPois: string[] = [];
  const poiWins: Record<string, number> = {};
  for (const [poiName, value] of [...document.poiData].sort(([left], [right]) => compareText(left, right))) {
    const common = requireDict(value, `poiData.${poiName}`).get("common");
    if (common === undefined) continue;
    const entries = requireDict(common, `poiData.${poiName}.common`);
    const completed = entries.get("completed");
    if (completed !== undefined && readsAsTrue(completed)) everCompletedPois.push(poiName);
    const wins = entries.get("encounterWins");
    if (wins !== undefined) {
      const count = requireInteger(wins, `poiData.${poiName}.common.encounterWins`);
      if (count > 0) poiWins[poiName] = count;
    }
  }


  const visitedTownNames = sortedUnique(stringArray(props.get("visitedTowns"), "props.visitedTowns"));
  const dayNumber = props.has("dayNumber")
    ? Math.max(1, requireInteger(props.get("dayNumber")!, "props.dayNumber"))
    : 1;
  if (visitedWorlds.length > 1) {
    warnings.add(
      "world-single-active",
      `This save has visited ${visitedWorlds.length} worlds; the port tracks progress for the ` +
        `active one ("${worldName}") and re-derives the rest from POI completion.`,
    );
  }

  return {
    schemaVersion: 2,
    worldName,
    currentPoiName,
    refresh: { occurrenceByPoi: {}, completedPois: [] },
    poiWins,
    dayNumber,
    everCompletedPois,
    ...(lastTown === undefined ? {} : { lastTownName: lastTown }),
    visitedTownNames,
  };
}

function reportUnmodelledSections(document: NativeSaveDocument, warnings: WarningLog): void {
  const carried: string[] = [];
  if (document.options.size > 0) carried.push("options");
  if (document.variables.size > 0) carried.push("variables");
  for (const key of document.props.keys()) {
    if (TRANSLATED_PROP_KEYS.includes(key)) continue;
    if (key.startsWith(COLLECTION_CLAIM_PREFIX)) continue;
    if (KNOWN_UNMODELLED_PROP_KEYS.includes(key)) {
      carried.push(`props.${key}`);
      continue;
    }
    warnings.add(
      "props-key-unrecognised",
      `props."${key}" is not a section this port knows; it was not restored.`,
    );
  }
  if (carried.length > 0) {
    warnings.add(
      "sections-not-modelled",
      `These sections have no equivalent in the port and will not survive a re-export: ` +
        `${carried.sort(compareText).join(", ")}.`,
    );
  }
}

function dictAt(
  props: ReadonlyMap<string, PlistValue>,
  key: string,
): ReadonlyMap<string, PlistValue> {
  const value = props.get(key);
  return value === undefined ? new Map() : requireDict(value, `props.${key}`);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

/** For sections the port stores in canonical order; the native file stores them chronologically. */
function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareText);
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function plistToJson(value: PlistValue, label: string, warnings: WarningLog): JsonValue {
  switch (value.kind) {
    case "bool":
    case "int":
    case "real":
    case "string":
      return value.value;
    case "date":
      return value.value;
    case "data":
      warnings.add("binary-data-dropped", `${label} holds binary data, which was dropped.`);
      return null;
    case "array":
      return value.value.map((item, index) => plistToJson(item, `${label}[${index}]`, warnings));
    case "dict": {
      const result: { [key: string]: JsonValue } = Object.create(null) as { [key: string]: JsonValue };
      for (const [key, item] of value.value) {
        result[key] = plistToJson(item, `${label}.${key}`, warnings);
      }
      return { ...result };
    }
  }
}

function jsonToPlist(value: JsonValue): PlistValue {
  if (typeof value === "boolean") return { kind: "bool", value };
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? pint(value) : preal(value);
  }
  if (typeof value === "string") return pstr(value);
  if (Array.isArray(value)) return parray(value.map(jsonToPlist));
  if (value === null) return pint(0);
  return pmap(Object.entries(value).map(([key, item]) => [key, jsonToPlist(item)] as const));
}

// =================================================================================================
// Export: PlayerGameStateSnapshot -> native document
// =================================================================================================

export function exportNativeSave(
  state: PlayerGameStateSnapshot,
  context: NativeSaveContext,
): NativeSaveExportResult {
  const warnings = new WarningLog();
  const party = state.player.party;
  if (party.kind !== "world-trip-party") {
    throw new NativeSaveFormatError(
      "only a world-trip save can be exported to the original game's format",
    );
  }
  const profile = state.player.profile;
  if (profile.schemaVersion !== 8) {
    throw new NativeSaveFormatError(
      `this slot holds an older profile (schema ${profile.schemaVersion}); load it once in the ` +
        "game to migrate it before exporting",
    );
  }

  const savedMonsters = party.monsters.map((monster) => exportMonster(monster, context, warnings));
  const savedItems = [
    ...exportInventoryItems(profile.inventory, warnings),
    ...(party.soulStones ?? []).map(exportSoulStone),
  ];
  const savedGemsInLicense = Object.values(profile.inventory.equippedGems)
    .filter((gem): gem is GemInventoryItem => gem !== undefined)
    .map((gem) => exportGem(gem, warnings));

  if (state.dungeon !== undefined) {
    warnings.add(
      "dungeon-run-dropped",
      "You are inside a dungeon. The original game has no section for an in-progress dungeon run, " +
        "so the exported save resumes in town.",
    );
  }
  if (Object.keys(state.pendingBattleRewardKeys ?? {}).length > 0) {
    warnings.add(
      "pending-rewards-dropped",
      "Treasure picked up but not yet claimed has no place in the original save format and was " +
        "not exported.",
    );
  }

  const props = exportProps(state, profile, warnings);
  const gold = exportGold(profile.gold, warnings);

  return Object.freeze({
    document: Object.freeze({
      silver: profile.silver,
      goldFound: gold.goldFound,
      goldSpent: gold.goldSpent,
      // Every shipped save carries both as empty dictionaries, and `loadFromFile` nil-guards each.
      options: new Map<string, PlistValue>(),
      variables: new Map<string, PlistValue>(),
      tutorialFlags: pflags(profile.tutorialFlags),
      waypoints: exportWaypoints(profile.dungeonWaypoints),
      poiData: exportPoiData(state.world),
      props,
      player: Object.freeze({
        savedLicenseType: profile.licenseType,
        savedMonsters,
        savedItems,
        savedGemsInLicense,
      }),
    }),
    warnings: warnings.snapshot(),
  });
}

function exportMonster(
  monster: PlayerMonsterInstance,
  context: NativeSaveContext,
  warnings: WarningLog,
): NativeRenderableRecord {
  const definition = context.data.monsterByShortType(monster.shortType);
  const penalty = context.data.jobXpPenalty(monster.shortType);
  const properties = new Map<string, PlistValue>([
    ["JobLevelProp", preal(levelAsDouble(monster, penalty))],
  ]);
  const monsterSaveData = new Map<string, PlistValue>();
  if (monster.injureTime !== undefined && monster.healTime !== undefined) {
    monsterSaveData.set("injureTime", preal(monster.injureTime));
    monsterSaveData.set("healTime", preal(monster.healTime));
  }
  if (monster.currentHp === 0) {
    warnings.add(
      "monster-fainted",
      `${monster.shortType} is knocked out. The original save format stores no HP, so it will ` +
        "load at full health.",
    );
  }
  return {
    name: definition.path,
    creationFile: MONSTERS_FILE,
    // `renderableFromSaveData:` builds the Monster from these before `loadFinishedWithRootParent:`
    // overwrites XP from `JobLevelProp`, and the level-up loop then runs from here. Writing the
    // monster's own level keeps the two consistent for any reader of the file.
    creationArguments: new Map<string, PlistValue>([
      ["jobArguments", pdict({ level: pint(monster.level) })],
    ]),
    properties,
    monsterSaveData,
    children: monster.soulStone === undefined ? [] : [exportSoulStone(monster.soulStone)],
  };
}


function levelAsDouble(monster: PlayerMonsterInstance, penalty: number): number {
  const cost = jobXpCostOfNextLevel(monster.level, penalty);
  if (cost <= 0) return Math.max(0, monster.level);
  const xpThisLevel = monster.cumulativeXp - jobXpForLevel(monster.level, penalty);
  return Math.max(0, monster.level + xpThisLevel / cost);
}

function exportSoulStone(stone: SoulStoneSetup): NativeRenderableRecord {
  return {
    name: `SoulStones.${stone.element}SoulStone`,
    creationFile: ITEMS_FILE,
    creationArguments: new Map<string, PlistValue>([["level", pint(stone.level)]]),


    properties: stone.sourceType === undefined
      ? new Map<string, PlistValue>()
      : new Map<string, PlistValue>([["sourceType", pstr(stone.sourceType)]]),
    monsterSaveData: new Map<string, PlistValue>(),
    children: [],
  };
}

function exportInventoryItems(
  inventory: PlayerInventoryStateV1,
  warnings: WarningLog,
): readonly NativeRenderableRecord[] {
  return inventory.looseItems.map((item) =>
    item.kind === "gem" ? exportGem(item, warnings) : exportSimpleItem(item));
}

function exportSimpleItem(
  item: Exclude<PlayerInventoryItem, GemInventoryItem>,
): NativeRenderableRecord {
  const creationArguments = new Map<string, PlistValue>();
  // Shipped `Usables.Card` records carry no creation arguments, so only a non-default level is
  // written back.
  if (item.kind === "usable" && item.level !== 1) creationArguments.set("level", pint(item.level));
  return {
    name: item.definitionPath,
    creationFile: ITEMS_FILE,
    creationArguments,
    properties: new Map<string, PlistValue>(),
    monsterSaveData: new Map<string, PlistValue>(),
    children: [],
  };
}

function exportGem(gem: GemInventoryItem, warnings: WarningLog): NativeRenderableRecord {
  const qualityName = GEM_QUALITY_NAMES[gem.quality];
  if (qualityName === undefined) {
    warnings.add(
      "gem-quality-unrepresentable",
      `A Gem of quality ${gem.quality} has no name in the original format; it was written as Magic.`,
    );
  }
  return {
    name: gem.definitionPath,
    creationFile: ITEMS_FILE,
    creationArguments: pdictMap({
      instanceName: pstr(GEM_SLOT_NAMES[gem.slot] ?? "Novice"),
      level: pint(gem.level),
      quality: pstr(qualityName ?? "Magic"),
      stats: { kind: "dict", value: pflags(gem.enabledStats) },
    }),
    properties: new Map<string, PlistValue>(),
    monsterSaveData: new Map<string, PlistValue>(),
    children: [],
  };
}

function pdictMap(entries: Record<string, PlistValue>): ReadonlyMap<string, PlistValue> {
  return new Map(Object.entries(entries));
}


function exportGold(gold: number, warnings: WarningLog): { goldFound: number; goldSpent: number } {
  if (gold > 0) {
    warnings.add(
      "gold-ledger-flattened",
      "Gold is written as the current balance. If the device you load this on has previously " +
        "purchased gold, that purchased amount is added on top of it.",
    );
  }
  return { goldFound: Math.max(0, gold), goldSpent: 0 };
}

function exportWaypoints(
  waypoints: Readonly<Record<string, readonly number[]>>,
): ReadonlyMap<string, PlistValue> {
  const result = new Map<string, PlistValue>();
  for (const instanceName of Object.keys(waypoints).sort(compareText)) {
    const floors = waypoints[instanceName]!;
    if (floors.length === 0) continue;

    result.set(instanceName, pmap(
      [...floors].sort((left, right) => left - right)
        .map((floor) => [String(floor), { kind: "bool", value: true }] as const),
    ));
  }
  return result;
}

function exportPoiData(
  world: PlayerGameStateSnapshot["world"],
): ReadonlyMap<string, PlistValue> {
  const result = new Map<string, PlistValue>();
  if (world === undefined) return result;
  const names = new Set<string>([
    ...world.everCompletedPois,
    ...Object.keys(world.poiWins),
  ]);
  for (const poiName of [...names].sort(compareText)) {
    const common = new Map<string, PlistValue>();
    if (world.everCompletedPois.includes(poiName)) common.set("completed", { kind: "bool", value: true });
    const wins = world.poiWins[poiName];
    if (wins !== undefined && wins > 0) common.set("encounterWins", pint(wins));
    result.set(poiName, pmap([["common", { kind: "dict", value: common }]]));
  }
  return result;
}

function exportProps(
  state: PlayerGameStateSnapshot,
  profile: PlayerProfileStateSnapshotV8,
  warnings: WarningLog,
): ReadonlyMap<string, PlistValue> {
  const props = new Map<string, PlistValue>();
  const quests = state.quests;
  const world = state.world;

  props.set("activeQuests", parray((quests?.activeQuestNames ?? []).map(pstr)));
  props.set("finishedQuests", parray((quests?.finishedQuestNames ?? []).map(pstr)));
  props.set("dialogsSeen", { kind: "dict", value: pflags(quests?.dialogsSeen ?? []) });
  props.set("fixedEncountersFinished", {
    kind: "dict",
    value: pflags(quests?.completedFixedEncounterKeys ?? []),
  });
  props.set("battleRewardsGiven", {
    kind: "dict",
    value: pflags(quests?.receivedBattleRewardKeys ?? []),
  });
  props.set("questProgressData", pmap(
    Object.entries(quests?.progressByQuestName ?? {})
      .sort(([left], [right]) => compareText(left, right))
      .map(([questName, progress]) => [questName, jsonToPlist(progress as JsonValue)] as const),
  ));

  props.set("highestLevelMonsters", pmap(
    Object.entries(profile.highestCapturedLevels)
      .sort(([left], [right]) => compareText(left, right))
      .map(([shortType, level]) => [shortType, pint(level)] as const),
  ));


  props.set("lastSavedLevel", pint(profile.hero.level));
  props.set("catchQuestsDone", parray(profile.catchQuestsDone.map(pstr)));
  // Written only once the Abyss has been entered: `setPropertyValue:forKey:` is reached only from
  // inside the `floor > stored` branch, so a save from a player who never went there has no key at
  // all. Emitting a 0 would be a value the original never writes.
  if (profile.infiniteDungeonHighestLevel > 0) {
    props.set("infiniteHighestLevel", pint(profile.infiniteDungeonHighestLevel));
  }
  props.set("combineRecipes", { kind: "dict", value: pflags(profile.learnedCombineRecipes) });
  props.set("spiritsData", pmap(
    Object.entries(profile.spiritSavedXp)
      .sort(([left], [right]) => compareText(left, right))
      .map(([shortType, xp]) => [shortType, pdict({ xp: pint(xp) })] as const),
  ));

  const allocatedSkills = Object.entries(profile.skillPoints).filter(([, value]) => value > 0);
  if (allocatedSkills.length > 0) {
    props.set("skillPoints", pmap(
      allocatedSkills
        .sort(([left], [right]) => compareText(left, right))
        .map(([stat, value]) => [stat, pint(value)] as const),
    ));
  }

  const tournament = profile.tournament;
  if (tournament.index > 0 || tournament.round > 0 || tournament.status !== 0) {
    props.set("tournament", pmap([
      ["index", pint(tournament.index)],
      ["round", pint(tournament.round)],
      ["status", pint(tournament.status)],
      ...(tournament.timeLast === undefined
        ? []
        : [["timeLast", preal(tournament.timeLast)] as const]),
    ]));
  }

  if (world !== undefined) {
    props.set("dayNumber", pint(world.dayNumber ?? 1));
    props.set("visitedWorlds", parray([pstr(world.worldName)]));
    const visitedTowns = world.schemaVersion === 2 ? world.visitedTownNames : [];
    props.set("visitedTowns", parray([...visitedTowns].sort(compareText).map(pstr)));
    const lastTown = world.lastTownName;
    if (lastTown !== undefined) props.set("lastTown", pstr(lastTown));
    else {
      warnings.add(
        "last-town-missing",
        "This save has not recorded a town yet, so the original game will start it at its own " +
          "default location.",
      );
    }
  }


  props.set("dungeonMod", pint(0));

  for (const goalId of state.player.schemaVersion === 2 ? state.player.claimedCollectionGoalIds : []) {
    props.set(goalId, { kind: "bool", value: true });
  }
  return props;
}

export function nativeSaveWarningText(warnings: readonly NativeSaveWarning[]): string {
  return warnings.map(({ message }) => message).join(" ");
}
