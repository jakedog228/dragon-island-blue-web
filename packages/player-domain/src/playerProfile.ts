// Renderer-, browser-, and transport-free profile/economy aggregate shared by local and server authority.
import {
  CAPTURE_CARD_COSTS,
  HERO_SPIRIT_MAX_ENERGY,
  addSpiritEnergy,
  assertSpiritTierLevel,
  isSpiritEnergyFull,
  heroLevelForXp,
  heroXpForLevel,
  spiritSavedXpForUnlockedTierLevel,
  spiritTierLevelForXp,
  goldEggMonsterLevel,
  TournamentProgress,
  type TournamentProgressSnapshotV1,
  type CaptureCardLevel,
  type CaptureCardCost,
  type SpiritTierLevel,
} from "@dib/engine";
import {
  PlayerInventory,
  gemBonusForStat,
  migrateLegacyInventory,
  type GemInventoryItem,
  type InventoryItemId,
  type PlayerInventoryStateV1,
  type PlayerStatName,
} from "./inventory.js";

export type PlayerLicenseType =
  | "Novice"
  | "Apprentice"
  | "Veteran"
  | "Expert"
  | "Elite"
  | "Master"
  | "Grandmaster";

export const PLAYER_LICENSE_ORDER: readonly PlayerLicenseType[] = Object.freeze([
  "Novice", "Apprentice", "Veteran", "Expert", "Elite", "Master", "Grandmaster",
]);

export interface LicenseProgressionRequirements {
  readonly type: PlayerLicenseType;
  readonly heroLevelRequired: number;
  readonly completedQuestsRequired: number;
  readonly battingOrderSize: number;
  readonly gemSlots: number;
}

export interface LicenseQualification {
  readonly nextType?: PlayerLicenseType;
  readonly qualifies: boolean;
  readonly heroLevel: number;
  readonly heroLevelRequired: number;
  readonly completedQuests: number;
  readonly completedQuestsRequired: number;
}
const LICENSE_GEM_SLOTS = Object.freeze([0, 1, 2, 2, 3, 4, 4] as const);
const PLAYER_STAT_ORDER: readonly PlayerStatName[] = Object.freeze([
  "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
]);








export type EvolveChainLookup = (shortType: string) => readonly string[] | undefined;













export function chainCollapsedHeroTotal(
  registeredLevels: Readonly<Record<string, number>>,
  evolveChainOf: EvolveChainLookup = () => undefined,
): number {
  const countedChains = new Set<string>();
  let total = 0;
  for (const [shortType, level] of Object.entries(registeredLevels)) {
    const chain = evolveChainOf(shortType);
    if (chain === undefined || chain.length === 0) {
      total += level;
      continue;
    }
    const root = chain[0]!;
    if (countedChains.has(root)) continue;
    countedChains.add(root);
    total += chain.reduce((highest, member) => Math.max(highest, registeredLevels[member] ?? 0), 0);
  }
  return total;
}







export function minimumHeroTotalForLevel(level: number): number {
  return level <= 1 ? 0 : heroXpForLevel(level) + 1;
}
















export function battingOrderSizeFor(
  licenseBattingOrderSize: number,
  heroLevel: number,
  options: {
    readonly heroBattingOrderSizeBonus?: number;
    readonly infiniteDungeonHighestLevel?: number;
  } = {},
): number {
  if (!Number.isSafeInteger(licenseBattingOrderSize) || licenseBattingOrderSize < 0) {
    throw new Error(`battingOrderSizeFor: invalid license size ${licenseBattingOrderSize}`);
  }
  if (!Number.isSafeInteger(heroLevel) || heroLevel < 1) {
    throw new Error(`battingOrderSizeFor: invalid hero level ${heroLevel}`);
  }
  return licenseBattingOrderSize
    + (options.heroBattingOrderSizeBonus ?? 0)
    + Math.floor(heroLevel / 3)
    + Math.floor((options.infiniteDungeonHighestLevel ?? 0) / 10);
}










export function nextInfiniteDungeonUnlockFloor(highestLevel: number): number {
  if (!Number.isSafeInteger(highestLevel) || highestLevel < 0) {
    throw new Error(`nextInfiniteDungeonUnlockFloor: invalid highest level ${highestLevel}`);
  }
  return highestLevel + 10 - (highestLevel % 10);
}








export function isInfiniteDungeonInstance(instanceName: string): boolean {
  return instanceName === "Volcano" || instanceName === "VolcanoB";
}

/** One Infinite Dungeon floor entry, as {@link infiniteDungeonFloorEntry} decides it. */
export interface InfiniteDungeonFloorEntry {

  readonly previousHighest: number;
  /** `infiniteHighestLevel` after the branch — `floor` when `updated`, else `previousHighest`. */
  readonly highestLevel: number;
  /** `max(floor, previousHighest)`, the `submitScore:category:DIBlueInfiniteDungeon` value. */
  readonly leaderboardScore: number;

  readonly firstThreshold: number;

  readonly nextThreshold: number;

  readonly updated: boolean;

  readonly unlocked: boolean;
}






















export function infiniteDungeonFloorEntry(
  previousHighest: number,
  floor: number,
): InfiniteDungeonFloorEntry {
  if (!Number.isSafeInteger(previousHighest) || previousHighest < 0) {
    throw new Error(`infiniteDungeonFloorEntry: invalid highest level ${previousHighest}`);
  }
  if (!Number.isSafeInteger(floor) || floor < 1) {
    throw new Error(`infiniteDungeonFloorEntry: invalid floor ${floor}`);
  }
  const firstThreshold = nextInfiniteDungeonUnlockFloor(previousHighest);
  const updated = floor > previousHighest;
  const highestLevel = updated ? floor : previousHighest;
  return Object.freeze({
    previousHighest,
    highestLevel,
    leaderboardScore: Math.max(floor, previousHighest),
    firstThreshold,
    nextThreshold: nextInfiniteDungeonUnlockFloor(highestLevel),
    updated,
    unlocked: updated && floor >= firstThreshold,
  });
}

export interface PlayerProfileConfig {
  heroLevel: number;
  /** Authored starting hero total (`sumHighestLevels` over the registration). Defaults to
   *  {@link minimumHeroTotalForLevel}. The profile derives
   *  `heroPriorHistoryXp = this - chainCollapsedHeroTotal(highestCapturedLevels)` so the enumerable
   *  registration and the unenumerable remainder together reproduce this total; a real save simply
   *  carries the complete registration (prior 0). Must be ≥ that collapsed total. */
  heroTotalHighestLevels?: number;





  evolveChainOf?: EvolveChainLookup;




  licenseBattingOrderSize?: number;
  monsterPartyLevels: readonly number[];
  silver: number;
  gold: number;
  captureCards: Readonly<Record<CaptureCardLevel, number>>;
  inventory?: PlayerInventoryStateV1;
  licenseType?: PlayerLicenseType;
  skillPoints?: Readonly<Partial<Record<PlayerStatName, number>>>;
  /** Existing Monsterpedia/save levels rendered on `MonsterCardNode` after a successful catch. */
  highestCapturedLevels?: Readonly<Record<string, number>>;
  /** `UserSavedData.properties["combineRecipes"]` keys whose bool value is true. */
  learnedCombineRecipes?: readonly string[];
  /** Durable UserSavedData tutorial flags already claimed before their presentation begins. */
  tutorialFlags?: readonly string[];
  /** `UserSavedData.properties["catchQuestsDone"]`: completed dungeon instance names. */
  catchQuestsDone?: readonly string[];
  /** `UserSavedData.properties["waypoints"]`: dungeon instance -> discovered numeric floors. */
  dungeonWaypoints?: Readonly<Record<string, readonly number[]>>;
  /** `UserSavedData.properties["infiniteHighestLevel"]`: deepest Infinite Dungeon floor ever
   *  entered. Feeds {@link battingOrderSizeFor} and the Abyss's own bonus-floor readout. */
  infiniteDungeonHighestLevel?: number;
  /** Durable non-card dungeon pickups (eggs, gem tokens, unresolved random item tokens). */
  dungeonItems?: Readonly<Record<string, number>>;
  /** Initial `HeroData.energyPercent` for the demo, expressed as fill 0..1. */
  spiritReadiness?: number;
  /** Unlocked spirit short type -> displayed grade index (0=F-, ..., 18=S). */
  spiritTierLevels?: Readonly<Record<string, number>>;
  tournament?: TournamentProgressSnapshotV1;
}

/** Minimal live-party projection needed by capture/collection UI. The trip aggregate remains the
 * sole owner of species and levels; profile code observes it without acquiring battle or Pixi
 * dependencies. */
export interface PlayerPartyReadModel {
  monsters(): readonly {
    readonly shortType: string;
    readonly level: number;
  }[];
  /** Native `Player.battingOrderSize` is derived from the current license. Runtime parties expose
   * this narrow write so a successful license mutation can refresh the derived capacity without
   * making the profile a second owner of bench ordering. */
  setBattingOrderSize?(size: number): void;
}

/** Storage-neutral profile payload. Party state is serialized by PlayerRuntimeState so this value
 * never becomes a second owner of the live monster roster. */
export interface PlayerProfileStateSnapshotV1 {
  readonly schemaVersion: 1;
  readonly heroLevel: number;
  readonly silver: number;
  readonly gold: number;
  readonly captureCards: Readonly<Record<CaptureCardLevel, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}

export interface PlayerProfileStateSnapshotV2 {
  readonly schemaVersion: 2;
  readonly hero: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  readonly silver: number;
  readonly gold: number;
  readonly captureCards: Readonly<Record<CaptureCardLevel, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}

export interface PlayerProfileStateSnapshotV3 {
  readonly schemaVersion: 3;
  readonly hero: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  readonly silver: number;
  readonly gold: number;
  readonly captureCards: Readonly<Record<CaptureCardLevel, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly learnedCombineRecipes: readonly string[];
  /** Optional for schema-3 saves written before dungeon inventory was implemented. */
  readonly dungeonItems?: Readonly<Record<string, number>>;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}

export interface PlayerProfileStateSnapshotV4 {
  readonly schemaVersion: 4;
  readonly hero: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  readonly silver: number;
  readonly gold: number;
  readonly captureCards: Readonly<Record<CaptureCardLevel, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly learnedCombineRecipes: readonly string[];
  readonly tutorialFlags: readonly string[];
  /** Optional for schema-4 saves written before catch-quest completion moved into player state. */
  readonly catchQuestsDone?: readonly string[];
  /** Optional for schema-4 saves written before durable waypoint discovery was represented. */
  readonly dungeonWaypoints?: Readonly<Record<string, readonly number[]>>;
  /** Optional for schema-4 saves written before dungeon inventory was implemented. */
  readonly dungeonItems?: Readonly<Record<string, number>>;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}

export interface PlayerProfileStateSnapshotV5 {
  readonly schemaVersion: 5;
  readonly hero: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  readonly silver: number;
  readonly gold: number;
  readonly inventory: PlayerInventoryStateV1;
  readonly licenseType: PlayerLicenseType;
  readonly skillPoints: Readonly<Record<PlayerStatName, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly learnedCombineRecipes: readonly string[];
  readonly tutorialFlags: readonly string[];
  readonly catchQuestsDone: readonly string[];
  readonly dungeonWaypoints: Readonly<Record<string, readonly number[]>>;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}

export interface PlayerProfileStateSnapshotV6 {
  readonly schemaVersion: 6;
  readonly hero: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  readonly silver: number;
  readonly gold: number;
  readonly inventory: PlayerInventoryStateV1;
  readonly licenseType: PlayerLicenseType;
  readonly skillPoints: Readonly<Record<PlayerStatName, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly learnedCombineRecipes: readonly string[];
  readonly tutorialFlags: readonly string[];
  readonly catchQuestsDone: readonly string[];
  readonly dungeonWaypoints: Readonly<Record<string, readonly number[]>>;
  readonly tournament: TournamentProgressSnapshotV1;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}











export interface PlayerProfileStateSnapshotV7 {
  readonly schemaVersion: 7;
  readonly hero: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  readonly silver: number;
  readonly gold: number;
  readonly inventory: PlayerInventoryStateV1;
  readonly licenseType: PlayerLicenseType;
  readonly skillPoints: Readonly<Record<PlayerStatName, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly learnedCombineRecipes: readonly string[];
  readonly tutorialFlags: readonly string[];
  readonly catchQuestsDone: readonly string[];
  readonly dungeonWaypoints: Readonly<Record<string, readonly number[]>>;
  readonly tournament: TournamentProgressSnapshotV1;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}







export interface PlayerProfileStateSnapshotV8 {
  readonly schemaVersion: 8;
  readonly hero: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  readonly silver: number;
  readonly gold: number;
  readonly inventory: PlayerInventoryStateV1;
  readonly licenseType: PlayerLicenseType;
  readonly skillPoints: Readonly<Record<PlayerStatName, number>>;
  readonly highestCapturedLevels: Readonly<Record<string, number>>;
  readonly learnedCombineRecipes: readonly string[];
  readonly tutorialFlags: readonly string[];
  readonly catchQuestsDone: readonly string[];
  readonly dungeonWaypoints: Readonly<Record<string, readonly number[]>>;
  readonly infiniteDungeonHighestLevel: number;
  readonly tournament: TournamentProgressSnapshotV1;
  readonly spiritEnergy: number;
  readonly spiritSavedXp: Readonly<Record<string, number>>;
  readonly spiritsUsedThisTrip: readonly string[];
}

export type PlayerProfileStateSnapshot =
  | PlayerProfileStateSnapshotV1
  | PlayerProfileStateSnapshotV2
  | PlayerProfileStateSnapshotV3
  | PlayerProfileStateSnapshotV4
  | PlayerProfileStateSnapshotV5
  | PlayerProfileStateSnapshotV6
  | PlayerProfileStateSnapshotV7
  | PlayerProfileStateSnapshotV8;

export interface CaptureInventorySnapshot {
  silver: number;
  gold: number;
  captureCards: Record<CaptureCardLevel, number>;
}

export interface SpiritProfileSnapshot {
  energy: number;
  readiness: number;
  full: boolean;
  spirits: Array<{
    shortType: string;
    savedXp: number;
    tierLevel: SpiritTierLevel;
    usedThisTrip: boolean;
  }>;
}

export type CaptureCardSpendResult =
  | { ok: true; source: "owned" | "purchased"; cost?: CaptureCardCost }
  | { ok: false; reason: "insufficientFunds"; cost: CaptureCardCost };

/** Restricts demo/save stand-ins to identities present in the selected content package. Custom
 * archives are allowed to define wholly independent species names; carrying DIB-specific captured
 * levels or spirit unlocks across that boundary would make later UI/runtime lookups fail. Numeric
 * economy/profile state is unchanged. A real save migration layer will own this filtering once
 * durable profiles and package identities exist. */
export function restrictPlayerProfileToRoster(
  config: PlayerProfileConfig,
  knownShortTypes: Iterable<string>,
): PlayerProfileConfig {
  const known = new Set(knownShortTypes);
  const filter = (values: Readonly<Record<string, number>> | undefined): Record<string, number> | undefined => {
    if (values === undefined) return undefined;
    return Object.fromEntries(Object.entries(values).filter(([shortType]) => known.has(shortType)));
  };
  const highestCapturedLevels = filter(config.highestCapturedLevels);
  const spiritTierLevels = filter(config.spiritTierLevels);
  const learnedCombineRecipes = config.learnedCombineRecipes?.filter((shortType) => known.has(shortType));
  return {
    ...config,
    ...(highestCapturedLevels !== undefined ? { highestCapturedLevels } : {}),
    ...(spiritTierLevels !== undefined ? { spiritTierLevels } : {}),
    ...(learnedCombineRecipes !== undefined ? { learnedCombineRecipes } : {}),
  };
}

/** Mutable in-memory profile used by the demo. Its location outside `battle/` is intentional:
 * durable save state will replace the storage implementation while retaining this battle-facing
 * behavior until wider inventory/economy commands are modeled. */
export class PlayerProfile {
  /** Unenumerable prior collection history — see the {@link heroTotalHighestLevels} model note.
   *  0 for a faithful real save (the registration dict is complete); a positive stand-in only for
   *  the demo's off-screen play, which cannot be itemized per species. */
  private readonly heroPriorHistoryXp: number;
  /** `sumHighestLevels` over the per-species Monsterpedia registration (`capturedLevels`) — one
   *  contribution per evolution chain, not per species; the enumerable half of the hero total.
   *  Maintained incrementally by {@link recordCapturedMonster}. */
  private registeredLevelSum: number;
  private readonly evolveChainOf: EvolveChainLookup;
  private licenseBattingOrderSize: number | undefined;
  private readonly configuredParty: PlayerPartyReadModel;
  private silverValue: number;
  private goldValue: number;
  readonly inventory: PlayerInventory;
  private licenseTypeValue: PlayerLicenseType;
  private readonly allocatedSkills: Record<PlayerStatName, number>;
  private readonly capturedLevels: Record<string, number>;
  private readonly combineRecipes = new Set<string>();
  private readonly claimedTutorialFlags = new Set<string>();
  private readonly completedCatchQuests = new Set<string>();
  private readonly dungeonWaypointFloors = new Map<string, Set<number>>();
  private infiniteDungeonHighestLevelValue: number;
  private spiritEnergyValue: number;
  private readonly spiritXp = new Map<string, number>();
  private readonly spiritsUsedThisTrip = new Set<string>();
  readonly tournament: TournamentProgress;
  private onChanged: () => void;
  private onSpiritExperienceAdded: (shortType: string, amount: number) => void = () => {};

  constructor(config: PlayerProfileConfig, party?: PlayerPartyReadModel, onChanged: () => void = () => {}) {
    if (config.monsterPartyLevels.length === 0) {
      throw new Error("PlayerProfile: monsterPartyLevels must contain at least one level");
    }
    const baselineTotal = config.heroTotalHighestLevels ?? minimumHeroTotalForLevel(config.heroLevel);
    if (heroLevelForXp(baselineTotal) !== config.heroLevel) {
      throw new Error(
        `PlayerProfile: hero total ${baselineTotal} does not belong to level ${config.heroLevel}`,
      );
    }
    // Hero total & level are DERIVED, never stored: total = priorHistory + sumHighestLevels(
    // registration), level = heroLevelForXp(total) (source `+[HeroData xpForLevel:]`). The authored
    // baseline already accounts for the authored registration, so priorHistory = baseline - that
    // total; a real save carries the complete registration and priorHistory collapses to 0.
    this.evolveChainOf = config.evolveChainOf ?? (() => undefined);
    this.licenseBattingOrderSize = config.licenseBattingOrderSize;
    this.registeredLevelSum = chainCollapsedHeroTotal(
      config.highestCapturedLevels ?? {},
      this.evolveChainOf,
    );
    if (baselineTotal < this.registeredLevelSum) {
      throw new Error(
        `PlayerProfile: registered levels ${this.registeredLevelSum} exceed hero total ${baselineTotal} ` +
        `for level ${config.heroLevel}`,
      );
    }
    this.heroPriorHistoryXp = baselineTotal - this.registeredLevelSum;
    this.onChanged = onChanged;
    const configuredLevels = [...config.monsterPartyLevels];
    this.configuredParty = party ?? {
      monsters: () => configuredLevels.map((level) => ({ shortType: "", level })),
    };
    this.silverValue = config.silver;
    this.goldValue = config.gold;
    this.inventory = new PlayerInventory(
      config.inventory ?? migrateLegacyInventory(config.captureCards, config.dungeonItems ?? {}),
      () => this.onChanged(),
    );
    this.tournament = new TournamentProgress(config.tournament);
    this.licenseTypeValue = config.licenseType ?? "Novice";
    if (!PLAYER_LICENSE_ORDER.includes(this.licenseTypeValue)) {
      throw new Error(`PlayerProfile: invalid license ${this.licenseTypeValue}`);
    }
    this.allocatedSkills = Object.fromEntries(PLAYER_STAT_ORDER.map((stat) => {
      const value = config.skillPoints?.[stat] ?? 0;
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`PlayerProfile: invalid ${stat} skill value ${value}`);
      }
      return [stat, value];
    })) as Record<PlayerStatName, number>;
    if (PLAYER_STAT_ORDER.reduce((sum, stat) => sum + this.allocatedSkills[stat], 0) > config.heroLevel) {
      throw new Error("PlayerProfile: allocated skill points exceed hero level");
    }
    this.capturedLevels = { ...config.highestCapturedLevels };
    for (const shortType of config.learnedCombineRecipes ?? []) {
      if (shortType.length === 0) {
        throw new Error("PlayerProfile: learned combine recipe must not be empty");
      }
      this.combineRecipes.add(shortType);
    }
    for (const flag of config.tutorialFlags ?? []) {
      if (flag.length === 0) throw new Error("PlayerProfile: tutorial flag must not be empty");
      this.claimedTutorialFlags.add(flag);
    }
    for (const instanceName of config.catchQuestsDone ?? []) {
      if (instanceName.length === 0) {
        throw new Error("PlayerProfile: completed catch-quest instance must not be empty");
      }
      this.completedCatchQuests.add(instanceName);
    }
    for (const [instanceName, floors] of Object.entries(config.dungeonWaypoints ?? {})) {
      requireDungeonInstanceName(instanceName);
      const registered = new Set<number>();
      for (const floor of floors) {
        requireDungeonWaypointFloor(floor);
        if (registered.has(floor)) {
          throw new Error(
            `PlayerProfile: duplicate waypoint floor ${floor} for dungeon ${instanceName}`,
          );
        }
        registered.add(floor);
      }
      if (registered.size > 0) this.dungeonWaypointFloors.set(instanceName, registered);
    }
    const infiniteHighest = config.infiniteDungeonHighestLevel ?? 0;
    if (!Number.isSafeInteger(infiniteHighest) || infiniteHighest < 0) {
      throw new Error(`PlayerProfile: invalid infinite dungeon highest level ${infiniteHighest}`);
    }
    this.infiniteDungeonHighestLevelValue = infiniteHighest;
    const readiness = config.spiritReadiness ?? 0;
    if (!Number.isFinite(readiness) || readiness < 0 || readiness > 1) {
      throw new Error(`PlayerProfile: spiritReadiness must be between 0 and 1; got ${readiness}`);
    }
    this.spiritEnergyValue = readiness * HERO_SPIRIT_MAX_ENERGY;
    for (const [shortType, tier] of Object.entries(config.spiritTierLevels ?? {})) {
      assertSpiritTierLevel(tier);
      this.spiritXp.set(shortType, spiritSavedXpForUnlockedTierLevel(tier));
    }



    this.refreshBattingOrderSize();
  }

  get heroLevel(): number {
    return heroLevelForXp(this.heroTotalHighestLevels);
  }










  get heroTotalHighestLevels(): number {
    return this.heroPriorHistoryXp + this.registeredLevelSum;
  }

  setChangeListener(listener: () => void): void {
    this.onChanged = listener;
    this.inventory.setChangeListener(listener);
  }

  get licenseType(): PlayerLicenseType {
    return this.licenseTypeValue;
  }

  get licenseOrdinal(): number {
    return PLAYER_LICENSE_ORDER.indexOf(this.licenseTypeValue);
  }

  get licenseGemSlots(): number {
    return LICENSE_GEM_SLOTS[this.licenseOrdinal]!;
  }

  get skillPointsAvailable(): number {
    return Math.max(
      0,
      this.heroLevel - PLAYER_STAT_ORDER.reduce(
        (total, stat) => total + this.allocatedSkills[stat],
        0,
      ),
    );
  }

  skillValue(stat: PlayerStatName): number {
    requirePlayerStat(stat);
    return this.allocatedSkills[stat];
  }

  incrementSkill(stat: PlayerStatName): boolean {
    requirePlayerStat(stat);
    if (this.skillPointsAvailable < 1) return false;
    this.allocatedSkills[stat] += 1;
    this.onChanged();
    return true;
  }

  decrementSkill(stat: PlayerStatName): boolean {
    requirePlayerStat(stat);
    if (this.allocatedSkills[stat] < 1) return false;
    this.allocatedSkills[stat] -= 1;
    this.onChanged();
    return true;
  }

  playerStatBonus(stat: PlayerStatName): number {
    requirePlayerStat(stat);
    const weight = stat === "Defense" || stat === "Resist" ? 1.5 : 1;
    const skill = Math.fround(Math.fround(this.allocatedSkills[stat]) * Math.fround(weight));
    return this.inventory.equippedGems()
      .reduce((total, gem) => Math.fround(total + gemBonusForStat(gem, stat)), skill);
  }

  /** Hero skill plus equipped-Gem providers, retained as float32 contributions until each
   * Living's normal final stat round. */
  battleStatBonuses(): Readonly<Partial<Record<PlayerStatName, number>>> {
    return Object.freeze(Object.fromEntries(
      PLAYER_STAT_ORDER
        .map((stat) => [stat, this.playerStatBonus(stat)] as const)
        .filter(([, bonus]) => bonus !== 0),
    ));
  }

  licenseQualification(
    next: LicenseProgressionRequirements | undefined,
    completedQuests: number,
  ): LicenseQualification {
    if (!Number.isSafeInteger(completedQuests) || completedQuests < 0) {
      throw new Error(`PlayerProfile: invalid completed quest count ${completedQuests}`);
    }
    const expected = PLAYER_LICENSE_ORDER[this.licenseOrdinal + 1];
    if (expected === undefined) {
      return Object.freeze({
        qualifies: false,
        heroLevel: this.heroLevel,
        heroLevelRequired: this.heroLevel,
        completedQuests,
        completedQuestsRequired: completedQuests,
      });
    }
    if (next === undefined || next.type !== expected) {
      throw new Error(`PlayerProfile: expected next license ${expected}`);
    }
    if (next.gemSlots < this.licenseGemSlots || next.gemSlots > 4) {
      throw new Error(`PlayerProfile: invalid ${next.type} Gem slot count ${next.gemSlots}`);
    }
    return Object.freeze({
      nextType: expected,
      qualifies:
        this.heroLevel >= next.heroLevelRequired &&
        completedQuests >= next.completedQuestsRequired,
      heroLevel: this.heroLevel,
      heroLevelRequired: next.heroLevelRequired,
      completedQuests,
      completedQuestsRequired: next.completedQuestsRequired,
    });
  }

  increaseLicenseAfterChallenge(next: LicenseProgressionRequirements): PlayerLicenseType {
    const expected = PLAYER_LICENSE_ORDER[this.licenseOrdinal + 1];
    if (expected === undefined || next.type !== expected) {
      throw new Error(`PlayerProfile: cannot increase ${this.licenseTypeValue} license to ${next.type}`);
    }
    if (!Number.isSafeInteger(next.battingOrderSize) || next.battingOrderSize < 1) {
      throw new Error(`PlayerProfile: invalid ${next.type} batting-order size ${next.battingOrderSize}`);
    }
    this.licenseTypeValue = expected;
    this.licenseBattingOrderSize = next.battingOrderSize;
    this.refreshBattingOrderSize();
    this.onChanged();
    return expected;
  }




  private refreshBattingOrderSize(): void {
    if (this.licenseBattingOrderSize === undefined) return;
    this.configuredParty.setBattingOrderSize?.(
      battingOrderSizeFor(this.licenseBattingOrderSize, this.heroLevel, {
        infiniteDungeonHighestLevel: this.infiniteDungeonHighestLevelValue,
      }),
    );
  }

  equipGem(id: InventoryItemId): {
    readonly equipped: GemInventoryItem;
    readonly displaced?: GemInventoryItem;
  } {
    return this.inventory.equipGem(id, (slot) => slot < this.licenseGemSlots);
  }

  unequipGem(id: InventoryItemId): GemInventoryItem {
    return this.inventory.unequipGem(id);
  }

  /** Source quirk: `captureStatusForCardLevel:` effectively uses the highest party level. */
  capturePartyLevel(): number {
    const members = this.configuredParty.monsters();
    if (members.length === 0) throw new Error("PlayerProfile: live monster party must not be empty");
    return Math.max(...members.map((member) => member.level));
  }








  goldEggMonsterLevel(): number {
    return goldEggMonsterLevel(this.configuredParty.monsters().map((member) => member.level));
  }

  /** Source persistent `highestLevelMonsters` table; current ownership never changes this read. */
  highestRegisteredLevel(shortType: string): number {
    return this.capturedLevels[shortType] ?? 0;
  }

  /**
   * Source `-[UserSavedData highestLevelMonsterEver]` scans every value in the persistent
   * `highestLevelMonsters` dictionary without filtering its keys back to Monster definitions.
   */
  highestRegisteredLivingLevel(): number {
    return Object.values(this.capturedLevels).reduce(
      (highest, level) => Math.max(highest, level),
      0,
    );
  }

  /** Highest level among concrete monsters currently present on the live bench/party. */
  highestOwnedLevel(shortType: string): number {
    return this.configuredParty.monsters()
      .filter((monster) => monster.shortType === shortType)
      .reduce((highest, monster) => Math.max(highest, monster.level), 0);
  }

  ownsMonster(shortType: string): boolean {
    return this.highestOwnedLevel(shortType) > 0;
  }

  /** Successful Encounter.performWinLogic capture award; loss/retreat never call this. */
  recordCapturedMonster(shortType: string, level: number): boolean {
    if (shortType.length === 0 || !Number.isInteger(level) || level < 1) {
      throw new Error(`PlayerProfile: invalid captured monster ${shortType} level ${level}`);
    }
    const previous = this.capturedLevels[shortType] ?? 0;
    if (level <= previous) return false;
    // The chain this species belongs to contributes its highest registered level once, so a
    // registration only moves the hero total by however far it pushes that chain's maximum past
    // where it already stood — nothing at all when a later stage of the same line outranks it.
    const chainHighestBefore = this.chainHighest(shortType);
    this.capturedLevels[shortType] = level;
    const levelBefore = this.heroLevel;
    this.registeredLevelSum += Math.max(0, this.chainHighest(shortType) - chainHighestBefore);
    if (this.heroLevel !== levelBefore) this.refreshBattingOrderSize();
    this.onChanged();
    return true;
  }

  /** Highest level registered anywhere in the evolution chain containing `shortType`. */
  private chainHighest(shortType: string): number {
    const chain = this.evolveChainOf(shortType) ?? [shortType];
    return chain.reduce((highest, member) => Math.max(highest, this.capturedLevels[member] ?? 0), 0);
  }


  hasCombineRecipe(shortType: string): boolean {
    return this.combineRecipes.has(shortType);
  }



  learnCombineRecipe(shortType: string): boolean {
    if (shortType.length === 0) {
      throw new Error("PlayerProfile: combine recipe type must not be empty");
    }
    if (this.combineRecipes.has(shortType)) return false;
    this.combineRecipes.add(shortType);
    this.onChanged();
    return true;
  }

  learnedCombineRecipes(): readonly string[] {
    return [...this.combineRecipes].sort();
  }

  hasTutorialFlag(flag: string): boolean {
    return this.claimedTutorialFlags.has(flag);
  }

  /** Source `showTutorialForFlag:` semantics: claim and dirty the save before opening the popup. */
  claimTutorialFlag(flag: string): boolean {
    if (flag.length === 0) throw new Error("PlayerProfile: tutorial flag must not be empty");
    if (this.claimedTutorialFlags.has(flag)) return false;
    this.claimedTutorialFlags.add(flag);
    this.onChanged();
    return true;
  }

  tutorialFlags(): readonly string[] {
    return [...this.claimedTutorialFlags].sort();
  }

  hasCompletedCatchQuest(instanceName: string): boolean {
    if (instanceName.length === 0) {
      throw new Error("PlayerProfile: catch-quest instance must not be empty");
    }
    return this.completedCatchQuests.has(instanceName);
  }

  /** Native reward branch appends `dungeon.instanceName` to `catchQuestsDone` once. */
  completeCatchQuest(instanceName: string): boolean {
    if (instanceName.length === 0) {
      throw new Error("PlayerProfile: catch-quest instance must not be empty");
    }
    if (this.completedCatchQuests.has(instanceName)) return false;
    this.completedCatchQuests.add(instanceName);
    this.onChanged();
    return true;
  }

  catchQuestsDone(): readonly string[] {
    return [...this.completedCatchQuests].sort();
  }

  hasDungeonWaypoint(instanceName: string, floor: number): boolean {
    requireDungeonInstanceName(instanceName);
    requireDungeonWaypointFloor(floor);
    return this.dungeonWaypointFloors.get(instanceName)?.has(floor) === true;
  }


  registerDungeonWaypoint(instanceName: string, floor: number): boolean {
    requireDungeonInstanceName(instanceName);
    requireDungeonWaypointFloor(floor);
    const registered = this.dungeonWaypointFloors.get(instanceName) ?? new Set<number>();
    if (registered.has(floor)) return false;
    registered.add(floor);
    this.dungeonWaypointFloors.set(instanceName, registered);
    this.onChanged();
    return true;
  }

  dungeonWaypointsFor(instanceName: string): readonly number[] {
    requireDungeonInstanceName(instanceName);
    return [...(this.dungeonWaypointFloors.get(instanceName) ?? [])].sort((a, b) => a - b);
  }

  dungeonWaypoints(): Readonly<Record<string, readonly number[]>> {
    return Object.fromEntries(
      [...this.dungeonWaypointFloors]
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([instanceName]) => [instanceName, this.dungeonWaypointsFor(instanceName)]),
    );
  }

  /** `UserSavedData.properties["infiniteHighestLevel"]`; 0 when the key was never written. */
  get infiniteDungeonHighestLevel(): number {
    return this.infiniteDungeonHighestLevelValue;
  }

  /** The floor that grants the next `+1 Max Monsters!` bonus — {@link nextInfiniteDungeonUnlockFloor}
   *  of the current deepest floor, which is what the Abyss's corner label prints. */
  nextInfiniteDungeonUnlockFloor(): number {
    return nextInfiniteDungeonUnlockFloor(this.infiniteDungeonHighestLevelValue);
  }












  recordInfiniteDungeonFloor(floor: number): InfiniteDungeonFloorEntry {
    if (!Number.isSafeInteger(floor) || floor < 1) {
      throw new Error(`PlayerProfile: invalid infinite dungeon floor ${floor}`);
    }
    const entry = infiniteDungeonFloorEntry(this.infiniteDungeonHighestLevelValue, floor);
    if (!entry.updated) return entry;
    this.infiniteDungeonHighestLevelValue = entry.highestLevel;
    this.refreshBattingOrderSize();
    this.onChanged();
    return entry;
  }

  awardSilver(amount: number): number {
    requirePositiveItemCount(amount, "silver");
    this.silverValue += amount;
    this.onChanged();
    return this.silverValue;
  }

  awardGold(amount: number): number {
    requirePositiveItemCount(amount, "gold");
    this.goldValue += amount;
    this.onChanged();
    return this.goldValue;
  }

  dungeonItemCount(key: string): number {
    return this.itemCount(key);
  }

  /** Provider-neutral durable item inventory. The serialized `dungeonItems` key is retained for
   * backward-compatible save migration; rewards are not dungeon-owned. */
  itemCount(key: string): number {
    if (key.length === 0) throw new Error("PlayerProfile: item key must not be empty");
    return this.inventory.legacyItemCounts()[key] ?? 0;
  }

  awardDungeonItem(key: string, amount = 1): number {
    return this.awardItem(key, amount);
  }

  awardItem(key: string, amount = 1): number {
    if (key.length === 0) throw new Error("PlayerProfile: item key must not be empty");
    requirePositiveItemCount(amount, key);
    for (let index = 0; index < amount; index += 1) this.inventory.addLegacyItem(key);
    return this.itemCount(key);
  }







  setSpiritExperienceListener(listener: (shortType: string, amount: number) => void): void {
    this.onSpiritExperienceAdded = listener;
  }







  private addExperienceToSpirit(amount: number, shortType: string): number {
    if (shortType.length === 0) throw new Error("PlayerProfile: spirit totem type must not be empty");
    const before = this.spiritXp.get(shortType) ?? 0;
    if (amount <= 0) return before;
    this.onSpiritExperienceAdded(shortType, amount);
    const after = before + amount;
    this.spiritXp.set(shortType, after);
    this.onChanged();
    return after;
  }





  awardSpiritTotem(shortType: string): { firstTime: boolean; savedXpBefore: number; savedXpAfter: number } {
    if (shortType.length === 0) throw new Error("PlayerProfile: spirit totem type must not be empty");
    const before = this.spiritXp.get(shortType) ?? 0;
    const firstTime = before === 0;
    const after = this.addExperienceToSpirit(firstTime ? 1 : 100, shortType);
    return { firstTime, savedXpBefore: before, savedXpAfter: after };
  }

  snapshot(): CaptureInventorySnapshot {
    return {
      silver: this.silverValue,
      gold: this.goldValue,
      captureCards: this.captureCardCounts(),
    };
  }

  /** `-[Player spendGold:logName:]`: an all-or-nothing gold debit used by town services. */
  spendGold(amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`PlayerProfile: gold spend must be a nonnegative safe integer; got ${amount}`);
    }
    if (this.goldValue < amount) return false;
    this.goldValue -= amount;
    this.onChanged();
    return true;
  }

  /** Shared save-wallet debit used by SpendSilver battle components and capture-card purchases. */
  spendSilver(amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`PlayerProfile: silver spend must be a nonnegative safe integer; got ${amount}`);
    }
    if (this.silverValue < amount) return false;
    this.silverValue -= amount;
    this.onChanged();
    return true;
  }

  /** Complete profile-owned state for a future IndexedDB/save adapter. */
  stateSnapshot(): PlayerProfileStateSnapshotV8 {
    return {
      schemaVersion: 8,
      hero: {
        level: this.heroLevel,
        totalHighestLevels: this.heroTotalHighestLevels,
      },
      silver: this.silverValue,
      gold: this.goldValue,
      inventory: this.inventory.stateSnapshot(),
      licenseType: this.licenseTypeValue,
      skillPoints: { ...this.allocatedSkills },
      highestCapturedLevels: { ...this.capturedLevels },
      learnedCombineRecipes: this.learnedCombineRecipes(),
      tutorialFlags: this.tutorialFlags(),
      catchQuestsDone: this.catchQuestsDone(),
      dungeonWaypoints: this.dungeonWaypoints(),
      infiniteDungeonHighestLevel: this.infiniteDungeonHighestLevelValue,
      tournament: this.tournament.stateSnapshot(),
      spiritEnergy: this.spiritEnergyValue,
      spiritSavedXp: Object.fromEntries(this.spiritXp),
      spiritsUsedThisTrip: [...this.spiritsUsedThisTrip],
    };
  }

  /** Rehydrate profile-owned state while binding party reads to the restored party aggregate. */
  static fromStateSnapshot(
    snapshot: PlayerProfileStateSnapshot,
    fallbackPartyLevels: readonly number[],
    party?: PlayerPartyReadModel,
    options: {
      readonly evolveChainOf?: EvolveChainLookup;
      readonly licenseBattingOrderSize?: number;
    } = {},
  ): PlayerProfile {
    const hero = snapshot.schemaVersion === 1
      // A v1 snapshot stores only the level, so the total is synthesized as the smallest one that
      // belongs to it — a level is reached once its threshold is *passed*.
      ? { level: snapshot.heroLevel, totalHighestLevels: minimumHeroTotalForLevel(snapshot.heroLevel) }
      : snapshot.hero;
    if (!Number.isFinite(snapshot.spiritEnergy) || snapshot.spiritEnergy < 0 || snapshot.spiritEnergy > HERO_SPIRIT_MAX_ENERGY) {
      throw new Error(`PlayerProfile: invalid saved spirit energy ${snapshot.spiritEnergy}`);
    }
    // Before v7 the stored total read `priorHistory + Σ(registration)`; from v7 it reads
    // `priorHistory + chainCollapsedHeroTotal(registration)`. Recover the prior term under the
    // reading the snapshot was written with, then restate the total under the current one. Hero
    // level is derived, so it is recomputed rather than trusted — the source treats its own stored
    // `lastSavedLevel` as a check value for the same reason.
    const registered = snapshot.highestCapturedLevels;
    const priorHistory = snapshot.schemaVersion === 7 || snapshot.schemaVersion === 8
      ? hero.totalHighestLevels - chainCollapsedHeroTotal(registered, options.evolveChainOf)
      : hero.totalHighestLevels - Object.values(registered).reduce((sum, level) => sum + level, 0);
    const totalHighestLevels = Math.max(0, priorHistory)
      + chainCollapsedHeroTotal(registered, options.evolveChainOf);
    // Aliased discriminant checks: every field below was introduced by one schema version and is
    // present in all later ones, so the migration reads as "this version or newer" instead of an
    // ever-growing equality chain.
    const atLeastV4 = snapshot.schemaVersion === 4 || snapshot.schemaVersion === 5
      || snapshot.schemaVersion === 6 || snapshot.schemaVersion === 7 || snapshot.schemaVersion === 8;
    const atLeastV5 = snapshot.schemaVersion === 5 || snapshot.schemaVersion === 6
      || snapshot.schemaVersion === 7 || snapshot.schemaVersion === 8;
    const profile = new PlayerProfile({
      heroLevel: heroLevelForXp(totalHighestLevels),
      heroTotalHighestLevels: totalHighestLevels,
      ...(options.evolveChainOf === undefined ? {} : { evolveChainOf: options.evolveChainOf }),
      ...(options.licenseBattingOrderSize === undefined
        ? {}
        : { licenseBattingOrderSize: options.licenseBattingOrderSize }),
      monsterPartyLevels: fallbackPartyLevels,
      silver: snapshot.silver,
      gold: snapshot.gold,
      captureCards: atLeastV5 ? { 1: 0, 2: 0, 3: 0 } : snapshot.captureCards,
      ...(atLeastV5 ? {
        inventory: snapshot.inventory,
        licenseType: snapshot.licenseType,
        skillPoints: snapshot.skillPoints,
      } : {}),
      highestCapturedLevels: snapshot.highestCapturedLevels,
      learnedCombineRecipes:
        snapshot.schemaVersion === 3 || snapshot.schemaVersion === 4 || atLeastV5
          ? snapshot.learnedCombineRecipes
          : [],
      tutorialFlags: atLeastV4 ? snapshot.tutorialFlags : [],
      catchQuestsDone: atLeastV4 ? snapshot.catchQuestsDone ?? [] : [],
      dungeonWaypoints: atLeastV4 ? snapshot.dungeonWaypoints ?? {} : {},
      infiniteDungeonHighestLevel:
        snapshot.schemaVersion === 8 ? snapshot.infiniteDungeonHighestLevel : 0,
      dungeonItems:
        snapshot.schemaVersion === 3 || snapshot.schemaVersion === 4
          ? snapshot.dungeonItems ?? {}
          : {},
      ...(snapshot.schemaVersion === 6 || snapshot.schemaVersion === 7 || snapshot.schemaVersion === 8
        ? { tournament: snapshot.tournament }
        : {}),
      spiritReadiness: snapshot.spiritEnergy / HERO_SPIRIT_MAX_ENERGY,
    }, party);
    // Restore the stored meter itself. Dividing by 100 for constructor readiness and multiplying
    // back introduces fractional noise (e.g. 7 -> 7.000000000000001), which corrupts an otherwise
    // integral Official projection. Preserve valid fractional imported meters exactly as well.
    profile.spiritEnergyValue = snapshot.spiritEnergy;
    for (const [shortType, savedXp] of Object.entries(snapshot.spiritSavedXp)) {
      if (shortType.length === 0 || !Number.isSafeInteger(savedXp) || savedXp < 0) {
        throw new Error(`PlayerProfile: invalid saved spirit ${shortType} XP ${savedXp}`);
      }
      // Present-zero records were emitted only by the old port. Source unlock writers reject
      // nonpositive awards before creating a record, so a present record is unlocked and >= 1.
      profile.spiritXp.set(shortType, Math.max(1, savedXp));
    }
    for (const shortType of snapshot.spiritsUsedThisTrip) {
      if (!profile.spiritXp.has(shortType)) {
        throw new Error(`PlayerProfile: used spirit ${shortType} is not unlocked`);
      }
      profile.spiritsUsedThisTrip.add(shortType);
    }
    return profile;
  }

  spiritSnapshot(): SpiritProfileSnapshot {
    return {
      energy: this.spiritEnergyValue,
      readiness: this.spiritEnergyValue / HERO_SPIRIT_MAX_ENERGY,
      full: isSpiritEnergyFull(this.spiritEnergyValue),
      spirits: [...this.spiritXp].map(([shortType, savedXp]) => ({
        shortType,
        savedXp,
        tierLevel: spiritTierLevelForXp(savedXp),
        usedThisTrip: this.spiritsUsedThisTrip.has(shortType),
      })),
    };
  }

  hasAnySpirits(): boolean {
    return this.spiritXp.size > 0;
  }

  spiritSavedXp(shortType: string): number {
    const xp = this.spiritXp.get(shortType);
    if (xp === undefined) throw new Error(`PlayerProfile: spirit ${shortType} is not unlocked`);
    return xp;
  }

  hasSummonedSpiritThisTrip(shortType: string): boolean {
    return this.spiritsUsedThisTrip.has(shortType);
  }

  /** Friendly dealt-damage charge: target level / friendly source level. */
  chargeSpiritForDealtDamage(sourceLevel: number, targetLevel: number): number {
    return this.chargeSpirit(targetLevel / sourceLevel);
  }

  /** Friendly took-damage charge: hostile source level / friendly target level. */
  chargeSpiritForTakenDamage(targetLevel: number, sourceLevel: number): number {
    return this.chargeSpirit(sourceLevel / targetLevel);
  }






  useSpirit(shortType: string): { savedXpBefore: number; savedXpAfter: number } {
    const before = this.spiritSavedXp(shortType);
    if (!isSpiritEnergyFull(this.spiritEnergyValue)) {
      throw new Error("PlayerProfile: hero spirit energy is not full");
    }
    if (this.spiritsUsedThisTrip.has(shortType)) {
      throw new Error(`PlayerProfile: spirit ${shortType} was already summoned this trip`);
    }
    const after = this.addExperienceToSpirit(33, shortType);
    this.spiritsUsedThisTrip.add(shortType);
    this.spiritEnergyValue = 0;
    this.onChanged();
    return { savedXpBefore: before, savedXpAfter: after };
  }

  /** Future town-entry hook; battle rematches intentionally do not call it. */
  resetSpiritsForTownReturn(): void {
    if (this.spiritsUsedThisTrip.size === 0) return;
    this.spiritsUsedThisTrip.clear();
    this.onChanged();
  }

  private chargeSpirit(levelRatio: number): number {
    const before = this.spiritEnergyValue;
    this.spiritEnergyValue = addSpiritEnergy(before, levelRatio);
    if (this.spiritEnergyValue !== before) this.onChanged();
    return this.spiritEnergyValue - before;
  }

  /** Owned cards are consumed first; otherwise the source-priced card is bought and used once. */
  spendCaptureCard(level: CaptureCardLevel): CaptureCardSpendResult {
    if (this.inventory.removeFirstLooseByInstanceName(captureCardInstanceName(level)) !== undefined) {
      return { ok: true, source: "owned" };
    }
    const cost = CAPTURE_CARD_COSTS[level];
    if (cost.currency === "silver") {
      if (this.silverValue < cost.amount) return { ok: false, reason: "insufficientFunds", cost };
      this.silverValue -= cost.amount;
    } else {
      if (this.goldValue < cost.amount) return { ok: false, reason: "insufficientFunds", cost };
      this.goldValue -= cost.amount;
    }
    this.onChanged();
    return { ok: true, source: "purchased", cost };
  }

  private captureCardCounts(): Record<CaptureCardLevel, number> {
    return {
      1: this.inventory.countByInstanceName("Card"),
      2: this.inventory.countByInstanceName("CardSilver"),
      3: this.inventory.countByInstanceName("CardGold"),
    };
  }
}

function requirePositiveItemCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`PlayerProfile: ${label} amount must be a positive integer; got ${value}`);
  }
}

function requireDungeonInstanceName(instanceName: string): void {
  if (instanceName.length === 0) {
    throw new Error("PlayerProfile: dungeon waypoint instance must not be empty");
  }
}

function requireDungeonWaypointFloor(floor: number): void {
  if (!Number.isSafeInteger(floor) || floor <= 0) {
    throw new Error(`PlayerProfile: dungeon waypoint floor must be a positive integer; got ${floor}`);
  }
}

function requirePlayerStat(stat: PlayerStatName): void {
  if (!PLAYER_STAT_ORDER.includes(stat)) {
    throw new Error(`PlayerProfile: unknown player stat ${stat}`);
  }
}

function captureCardInstanceName(level: CaptureCardLevel): string {
  return level === 1 ? "Card" : level === 2 ? "CardSilver" : "CardGold";
}
