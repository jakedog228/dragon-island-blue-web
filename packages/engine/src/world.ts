import type { WorldFixedEncounter } from "@dib/gamedata";
import type { PlayerReward } from "./rewards.js";
import { generateFixedEncounterRewards } from "./dungeon.js";
import type { GuildQuestEvent } from "./quests.js";
import type { Rng } from "./rng.js";

/** `World._init`'s bit-exact float32 fallback, not mathematical 1/3. */
export const DEFAULT_WORLD_ENCOUNTER_CHANCE = Math.fround(0.333);

export interface WorldConnectionDefinition {
  readonly poi1: string;
  readonly poi2: string;
  /** Native `Conditions.poisCleared`; `!name` requires durable completion to be absent. */
  readonly requiredCompletedPoiNames?: readonly string[];
}

export interface WeightedMonsterTypeDefinition {
  readonly type: string;
  readonly chance: number;
}

export interface DefaultMonsterPopulatorDefinition {
  readonly class?: "DefaultMonsterPopulator";
  readonly minMonstersPerPack?: number;
  readonly maxMonstersPerPack?: number;
  readonly levelScalor?: number;
  readonly types: readonly (string | WeightedMonsterTypeDefinition)[];
  readonly fixedEncounters?: readonly WorldFixedEncounter[];
}

export interface UnsupportedMonsterPopulatorDefinition {
  readonly class: string;
  readonly [key: string]: unknown;
}

export interface EncounterTableEntryDefinition {
  readonly monsterPopulator:
    | DefaultMonsterPopulatorDefinition
    | UnsupportedMonsterPopulatorDefinition;
}

export interface PointOfInterestEncounterDefinition {
  readonly levelScalor?: number;
  /** The misspelling is the shipped data key. */
  readonly itterationScalor?: number;
  readonly table: Readonly<Record<string, EncounterTableEntryDefinition | null | undefined>>;
}

export interface WorldPointOfInterestDefinition {
  readonly instanceName: string;
  readonly encounter?: PointOfInterestEncounterDefinition;
}

export interface WorldDefinition {





  readonly instanceName?: string;
  readonly challengeLevel?: number;
  readonly encounterChance?: number;
  readonly pointsOfInterest: readonly WorldPointOfInterestDefinition[];
  readonly connections: readonly WorldConnectionDefinition[];
}

export interface GeneratedWorldMonster {
  readonly type: string;
  readonly level: number;
  readonly extraLivingArguments?: Readonly<Record<string, unknown>>;
}

export interface GeneratedWorldEncounter {
  readonly kind: "ordinary" | "fixed";
  readonly poiName: string;
  readonly forced: boolean;
  readonly tableKey: string;
  readonly poiWinsBeforeEncounter: number;
  readonly challengeLevel: number;
  readonly monsters: readonly GeneratedWorldMonster[];
  readonly completionKey?: string;
  readonly questKey?: string;
  readonly battleRewardKey?: string;
  readonly achievement?: string;
  readonly startEvent?: WorldFixedEncounter["startEvent"];
  readonly winEvent?: WorldFixedEncounter["winEvent"];
  readonly breeder?: WorldFixedEncounter["breeder"];
  readonly rewards?: readonly PlayerReward[];
}

/** `POINode.state`: green, red, blue/current, hidden, walk-arrow. */
export type WorldPoiState = 0 | 1 | 2 | 3 | 4;

export interface WorldMovement {
  readonly adjacent: boolean;
  readonly kind: "walk" | "teleport";
}

export type WorldArrivalResult =
  | {
      readonly kind: "none";
      readonly poiName: string;
      readonly reason:
        | "first-arrival"
        | "no-encounter-table"
        | "no-eligible-encounter"
        | "completed-this-refresh"
        | "occurrence-roll-failed";
      readonly movement?: WorldMovement;
    }
  | {
      readonly kind: "skipped";
      readonly poiName: string;
      readonly reason: "easy-ordinary-encounter";
      readonly encounter: GeneratedWorldEncounter;
      readonly movement: WorldMovement;
    }
  | {
      readonly kind: "encounter";
      readonly poiName: string;
      readonly encounter: GeneratedWorldEncounter;
      readonly movement: WorldMovement;
    };

export class WorldDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorldDataError";
  }
}

export class UnsupportedWorldEncounterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedWorldEncounterError";
  }
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) throw new WorldDataError(`${name} must be finite; got ${value}`);
}

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WorldDataError(`${name} must be a positive safe integer; got ${value}`);
  }
}

function roundf(value: number): number {
  const narrowed = Math.fround(value);
  return narrowed < 0 ? -Math.round(-narrowed) : Math.round(narrowed);
}

function truncfProduct(left: number, right: number): number {
  return Math.trunc(Math.fround(Math.fround(left) * Math.fround(right)));
}

interface WeightedType {
  readonly type: string;
  readonly weight: number;
}

function weightedTypesOf(
  types: readonly (string | WeightedMonsterTypeDefinition)[],
): readonly WeightedType[] {
  if (types.length === 0) throw new WorldDataError("monster populator types must not be empty");

  return types.map((entry, index) => {
    if (typeof entry === "string") {
      if (entry.length === 0) throw new WorldDataError(`types[${index}] must not be empty`);
      return { type: entry, weight: 100 };
    }
    if (entry.type.length === 0) throw new WorldDataError(`types[${index}].type must not be empty`);
    assertPositiveInteger(`types[${index}].chance`, entry.chance);
    return { type: entry.type, weight: entry.chance };
  });
}

function selectWeightedType(types: readonly WeightedType[], rng: Rng): string {
  const totalWeight = types.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isSafeInteger(totalWeight)) {
    throw new WorldDataError(`total monster type weight is not a safe integer: ${totalWeight}`);
  }
  const roll = rng.intBelow(totalWeight);
  let cumulative = 0;
  for (const entry of types) {
    cumulative += entry.weight;
    if (roll < cumulative) return entry.type;
  }
  throw new Error(`Rng.intBelow(${totalWeight}) returned out-of-range value ${roll}`);
}

function selectRandomMonsterType(randomMonsterTypes: readonly string[], rng: Rng): string {
  if (randomMonsterTypes.length === 0) {
    throw new WorldDataError('the special "Random" type requires a nonempty monster roster');
  }
  return randomMonsterTypes[rng.intBelow(randomMonsterTypes.length)]!;
}

function defaultPopulator(
  definition: EncounterTableEntryDefinition["monsterPopulator"],
): DefaultMonsterPopulatorDefinition {
  if (definition.class !== undefined && definition.class !== "DefaultMonsterPopulator") {
    throw new UnsupportedWorldEncounterError(
      `unsupported monster populator class ${JSON.stringify(definition.class)}`,
    );
  }
  const ordinary = definition as DefaultMonsterPopulatorDefinition;
  return ordinary;
}





export function selectEncounterTableEntry(
  table: PointOfInterestEncounterDefinition["table"],
  poiWins: number,
): { readonly key: string; readonly entry: EncounterTableEntryDefinition } | undefined {
  if (!Number.isSafeInteger(poiWins) || poiWins < 0) {
    throw new WorldDataError(`poiWins must be a nonnegative safe integer; got ${poiWins}`);
  }

  const candidates = Object.entries(table)
    .map(([key, entry]) => {
      if (!/^-?\d+$/.test(key)) throw new WorldDataError(`encounter table key is not an integer: ${key}`);
      const threshold = Number(key);
      if (!Number.isSafeInteger(threshold)) {
        throw new WorldDataError(`encounter table key is not a safe integer: ${key}`);
      }
      return { key, threshold, entry };
    })
    .sort((a, b) => a.threshold - b.threshold);

  const nonnil = candidates.filter(
    (candidate): candidate is typeof candidate & { entry: EncounterTableEntryDefinition } =>
      candidate.entry != null,
  );

  if (nonnil.length === 0) return undefined;

  const winsSelector = poiWins + 1;
  let selected = nonnil[0]!;
  for (const candidate of nonnil) {
    if (candidate.threshold <= winsSelector) selected = candidate;
  }
  return { key: selected.key, entry: selected.entry };
}

/** Exact float32 schedule from `PointOfInterest.buildEncounterForWorld:`. */
export function worldEncounterChallengeLevel(
  worldChallengeLevel: number,
  poiWins: number,
  levelScalor = 1,
  itterationScalor = 0,
): number {
  if (!Number.isSafeInteger(worldChallengeLevel)) {
    throw new WorldDataError(`world challenge level must be a safe integer; got ${worldChallengeLevel}`);
  }
  if (!Number.isSafeInteger(poiWins) || poiWins < 0) {
    throw new WorldDataError(`poiWins must be a nonnegative safe integer; got ${poiWins}`);
  }
  assertFinite("levelScalor", levelScalor);
  assertFinite("itterationScalor", itterationScalor);

  const iterated = Math.fround(
    Math.fround(worldChallengeLevel) +
      Math.fround(Math.fround(poiWins) * Math.fround(itterationScalor)),
  );
  return roundf(Math.fround(iterated * Math.fround(levelScalor)));
}

/** `DefaultMonsterPopulator` ordinary path, preserving every conditional draw. */
export function populateOrdinaryWorldEncounter(
  definition: DefaultMonsterPopulatorDefinition,
  challengeLevel: number,
  randomMonsterTypes: readonly string[],
  rng: Rng,
): readonly GeneratedWorldMonster[] {
  if (!Number.isSafeInteger(challengeLevel)) {
    throw new WorldDataError(`challengeLevel must be a safe integer; got ${challengeLevel}`);
  }
  const min = definition.minMonstersPerPack ?? 1;
  const max = definition.maxMonstersPerPack ?? 4;
  assertPositiveInteger("minMonstersPerPack", min);
  assertPositiveInteger("maxMonstersPerPack", max);
  if (max < min) {
    throw new WorldDataError(`maxMonstersPerPack ${max} is below minMonstersPerPack ${min}`);
  }
  const levelScalor = definition.levelScalor ?? 1;
  assertFinite("monster populator levelScalor", levelScalor);
  const types = weightedTypesOf(definition.types);

  const count = max > min ? min + rng.intBelow(max + 1 - min) : min;
  const baseLevel = truncfProduct(challengeLevel, levelScalor);
  const variance = roundf(Math.fround(Math.fround(baseLevel) * Math.fround(0.1)));
  const monsters: GeneratedWorldMonster[] = [];

  for (let index = 0; index < count; index += 1) {
    let type = selectWeightedType(types, rng);
    if (type === "Random") {
      if (randomMonsterTypes.length === 0) {
        throw new WorldDataError('the special "Random" type requires a nonempty monster roster');
      }
      type = randomMonsterTypes[rng.intBelow(randomMonsterTypes.length)]!;
    }

    const level = Math.max(
      1,
      variance >= 2
        ? baseLevel - variance + rng.intBelow(variance * 2)
        : baseLevel,
    );
    monsters.push({ type, level });
  }
  return monsters;
}

function float32Average(levels: readonly number[], label: string): number {
  if (levels.length === 0) throw new WorldDataError(`${label} must not be empty`);
  let sum = Math.fround(0);
  for (const level of levels) {
    if (!Number.isSafeInteger(level) || level < 1) {
      throw new WorldDataError(`${label} contains invalid level ${level}`);
    }
    sum = Math.fround(sum + Math.fround(level));
  }
  return Math.fround(sum / Math.fround(levels.length));
}

/** `WorldEncounter.allowSkip`; fixed encounters can never be skipped. */
export function allowSkipWorldEncounter(
  fixed: boolean,
  playerActiveLevels: readonly number[],
  enemyActiveLevels: readonly number[],
): boolean {
  if (fixed) return false;
  const playerAverage = float32Average(playerActiveLevels, "playerActiveLevels");
  // `WorldEncounter.allowSkip` reads the current fighting Team. A generated
  // fourth monster is a replacement reserve and is not part of that average.
  const enemyAverage = float32Average(enemyActiveLevels.slice(0, 3), "enemyActiveLevels");
  return (
    playerAverage >= Math.fround(7) &&
    playerAverage >= Math.fround(Math.fround(enemyAverage) + Math.fround(enemyAverage))
  );
}

export interface WorldTripOptions {
  readonly randomMonsterTypes: readonly string[];
  readonly initialPoiWins?: Readonly<Record<string, number>>;
  readonly sharedState?: WorldTripSharedState;
  readonly hasCompletedFixedEncounter?: (key: string) => boolean;
  readonly canUseQuestKey?: (key: string) => boolean;






  readonly onQuestEvent?: (event: GuildQuestEvent) => void;
}

/** Source `PointOfInterest` refresh dictionaries are process-global for one trip away from town,
 * so cardinal world-screen changes must reuse these maps rather than rerolling per WorldNode. */
export interface WorldTripSharedState {
  readonly occurrenceThisRefresh: Map<string, boolean>;
  readonly completedThisRefresh: Set<string>;
  readonly poiWins: Map<string, number>;
  /** Durable `UserSavedData.hasEverCompletedPOI:` registry, shared across WorldNode instances. */
  readonly everCompletedPois: Set<string>;






  readonly notifiedCompletedPois: Set<string>;
  /** Persisted `UserSavedData.dayNumber`; the shipped default is 1 and town entry increments it
   *  before building the `DayFormatKey` notification. */
  dayNumber: number;
}

export function createWorldTripSharedState(): WorldTripSharedState {
  return {
    occurrenceThisRefresh: new Map<string, boolean>(),
    completedThisRefresh: new Set<string>(),
    poiWins: new Map<string, number>(),
    everCompletedPois: new Set<string>(),
    notifiedCompletedPois: new Set<string>(),
    dayNumber: 1,
  };
}

export function advanceWorldDay(state: WorldTripSharedState): number {
  if (!Number.isSafeInteger(state.dayNumber) || state.dayNumber < 1) {
    throw new WorldDataError(`invalid persisted dayNumber ${state.dayNumber}`);
  }
  if (state.dayNumber === Number.MAX_SAFE_INTEGER) {
    throw new WorldDataError("persisted dayNumber cannot be incremented safely");
  }
  state.dayNumber += 1;
  return state.dayNumber;
}

/** `+[Player enteredTown:]`: clear this trip's POI caches and complete the entered town. */
export function refreshWorldTripAtTown(
  state: Pick<
    WorldTripSharedState,
    "occurrenceThisRefresh" | "completedThisRefresh" | "everCompletedPois"
  >,
  townPoiName: string,
): void {
  if (townPoiName.length === 0) throw new WorldDataError("town POI name must not be empty");
  state.occurrenceThisRefresh.clear();
  state.completedThisRefresh.clear();
  state.completedThisRefresh.add(townPoiName);
  state.everCompletedPois.add(townPoiName);
}

/**
 * Pure town-trip navigation state. `begin()` consumes the source's first-arrival
 * suppression; subsequent `navigate()` calls enforce the unconditional graph.
 */
export class WorldTrip {
  readonly #world: WorldDefinition;
  readonly #rng: Rng;
  readonly #pois = new Map<string, WorldPointOfInterestDefinition>();
  readonly #randomMonsterTypes: readonly string[];
  readonly #occurrenceThisRefresh: Map<string, boolean>;
  readonly #completedThisRefresh: Set<string>;
  readonly #poiWins: Map<string, number>;
  readonly #everCompletedPois: Set<string>;
  readonly #notifiedCompletedPois: Set<string>;
  readonly #hasCompletedFixedEncounter: (key: string) => boolean;
  readonly #canUseQuestKey: (key: string) => boolean;
  readonly #onQuestEvent: ((event: GuildQuestEvent) => void) | undefined;
  #currentPoiName: string;
  #begun = false;

  constructor(
    world: WorldDefinition,
    initialPoiName: string,
    rng: Rng,
    options: WorldTripOptions,
  ) {
    this.#world = world;
    this.#rng = rng;
    this.#randomMonsterTypes = [...options.randomMonsterTypes];
    this.#hasCompletedFixedEncounter = options.hasCompletedFixedEncounter ?? (() => false);
    this.#canUseQuestKey = options.canUseQuestKey ?? (() => false);
    this.#onQuestEvent = options.onQuestEvent;
    if (this.#onQuestEvent !== undefined && world.instanceName === undefined) {
      throw new WorldDataError("WorldTrip.onQuestEvent requires WorldDefinition.instanceName");
    }
    const sharedState = options.sharedState ?? createWorldTripSharedState();
    this.#occurrenceThisRefresh = sharedState.occurrenceThisRefresh;
    this.#completedThisRefresh = sharedState.completedThisRefresh;
    this.#poiWins = sharedState.poiWins;
    this.#everCompletedPois = sharedState.everCompletedPois;
    this.#notifiedCompletedPois = sharedState.notifiedCompletedPois;
    for (const poi of world.pointsOfInterest) {
      if (poi.instanceName.length === 0) throw new WorldDataError("POI instanceName must not be empty");
      if (this.#pois.has(poi.instanceName)) {
        throw new WorldDataError(`duplicate POI instanceName ${poi.instanceName}`);
      }
      this.#pois.set(poi.instanceName, poi);
    }
    this.#requirePoi(initialPoiName);
    this.#currentPoiName = initialPoiName;

    for (const connection of world.connections) {
      if (typeof connection.poi1 !== "string" || connection.poi1.length === 0) {
        throw new WorldDataError("connection poi1 must be a nonempty string");
      }
      if (typeof connection.poi2 !== "string" || connection.poi2.length === 0) {
        throw new WorldDataError("connection poi2 must be a nonempty string");
      }
      if (connection.poi1 === connection.poi2) {
        throw new WorldDataError(`connection cannot join POI ${connection.poi1} to itself`);
      }
      for (const condition of connection.requiredCompletedPoiNames ?? []) {
        if (typeof condition !== "string" || condition.replace(/^!/, "").length === 0) {
          throw new WorldDataError(`connection completion condition is invalid: ${String(condition)}`);
        }
      }
    }
    for (const [poiName, wins] of Object.entries(options.initialPoiWins ?? {})) {
      this.#requirePoi(poiName);
      if (!Number.isSafeInteger(wins) || wins < 0) {
        throw new WorldDataError(`initial POI wins for ${poiName} are invalid: ${wins}`);
      }
      this.#poiWins.set(poiName, wins);
    }
    this.#normalizedWorldChallenge();
    this.#normalizedEncounterChance();
  }

  get currentPoiName(): string {
    return this.#currentPoiName;
  }

  begin(): WorldArrivalResult {
    if (this.#begun) throw new Error("WorldTrip.begin() may only be called once");
    this.#begun = true;
    if (this.#requirePoi(this.#currentPoiName).encounter === undefined) {
      this.#recordPoiCompleted(this.#currentPoiName);
    }
    return { kind: "none", poiName: this.#currentPoiName, reason: "first-arrival" };
  }

  unconditionalNeighbors(poiName = this.#currentPoiName): readonly string[] {
    this.#requirePoi(poiName);
    const neighbors: string[] = [];
    for (const connection of this.#world.connections) {
      if (!this.#connectionConditionsAreMet(connection)) continue;
      if (connection.poi1 === poiName && this.#pois.has(connection.poi2)) {
        neighbors.push(connection.poi2);
      } else if (connection.poi2 === poiName && this.#pois.has(connection.poi1)) {
        neighbors.push(connection.poi1);
      }
    }
    return neighbors;
  }

  isUnconditionallyAdjacent(left: string, right: string): boolean {
    this.#requirePoi(left);
    this.#requirePoi(right);
    return this.unconditionalNeighbors(left).includes(right);
  }

  /**
   * `WorldNode.updatePOIAvailability`: completion propagates visibility outward;
   * incomplete frontier nodes remain visible but do not propagate it farther.
   */
  poiStates(): ReadonlyMap<string, WorldPoiState> {
    const states = new Map<string, WorldPoiState>();
    for (const poiName of this.#pois.keys()) states.set(poiName, 3);

    const directNeighbors = new Set(this.unconditionalNeighbors(this.#currentPoiName));
    const queued = new Set<string>([this.#currentPoiName]);
    const processed = new Set<string>();
    const queue = [this.#currentPoiName];

    while (queue.length !== 0) {
      const poiName = queue.shift()!;
      queued.delete(poiName);
      processed.add(poiName);
      states.set(
        poiName,
        poiName === this.#currentPoiName
          ? 2
          : directNeighbors.has(poiName)
            ? 4
            : this.#completedThisRefresh.has(poiName)
              ? 0
              : 1,
      );

      const mayExpandAll = this.#completedThisRefresh.has(poiName);
      for (const neighbor of this.unconditionalNeighbors(poiName)) {
        if (processed.has(neighbor) || queued.has(neighbor)) continue;
        const completedNeighborFromCurrent =
          poiName === this.#currentPoiName && this.#completedThisRefresh.has(neighbor);
        if (mayExpandAll || completedNeighborFromCurrent) {
          queue.push(neighbor);
          queued.add(neighbor);
        }
      }
    }
    return states;
  }

  poiState(poiName: string): WorldPoiState {
    this.#requirePoi(poiName);
    return this.poiStates().get(poiName)!;
  }

  selectablePoiNames(): readonly string[] {
    return [...this.poiStates()].filter(([, state]) => state !== 3).map(([poiName]) => poiName);
  }

  navigate(targetPoiName: string, playerActiveLevels: readonly number[]): WorldArrivalResult {
    if (!this.#begun) throw new Error("call WorldTrip.begin() before navigating");
    this.#requirePoi(targetPoiName);
    if (this.poiState(targetPoiName) === 3) {
      throw new WorldDataError(`POI ${targetPoiName} is unavailable (state 3)`);
    }
    const previousPoiName = this.#currentPoiName;
    const forced = targetPoiName === this.#currentPoiName;
    const adjacent = this.isUnconditionallyAdjacent(previousPoiName, targetPoiName);
    const movement: WorldMovement = { adjacent, kind: adjacent ? "walk" : "teleport" };
    this.#currentPoiName = targetPoiName;
    const poi = this.#requirePoi(targetPoiName);

    if (poi.encounter === undefined) {
      this.#recordPoiCompleted(targetPoiName);
      return { kind: "none", poiName: targetPoiName, reason: "no-encounter-table", movement };
    }
    if (!forced && this.#completedThisRefresh.has(targetPoiName)) {
      return { kind: "none", poiName: targetPoiName, reason: "completed-this-refresh", movement };
    }
    const definition = poi.encounter;
    const wins = this.poiWins(poi.instanceName);
    const selected = selectEncounterTableEntry(definition.table, wins);
    if (selected === undefined) {
      this.#recordPoiCompleted(targetPoiName);
      return { kind: "none", poiName: targetPoiName, reason: "no-eligible-encounter", movement };
    }
    const populator = defaultPopulator(selected.entry.monsterPopulator);
    const challengeLevel = worldEncounterChallengeLevel(
      this.#normalizedWorldChallenge(),
      wins,
      definition.levelScalor ?? 1,
      definition.itterationScalor ?? 0,
    );
    const fixed = this.#buildFixedEncounter(populator, challengeLevel, wins + 1);
    let encounter: GeneratedWorldEncounter;
    if (fixed !== undefined) {
      encounter = {
        kind: "fixed",
        poiName: poi.instanceName,
        forced,
        tableKey: selected.key,
        poiWinsBeforeEncounter: wins,
        challengeLevel,
        ...fixed,
      };
    } else {
      if (populator.types.length === 0) {
        this.#recordPoiCompleted(targetPoiName);
        return { kind: "none", poiName: targetPoiName, reason: "no-eligible-encounter", movement };
      }
      encounter = {
        kind: "ordinary",
        poiName: poi.instanceName,
        forced,
        tableKey: selected.key,
        poiWinsBeforeEncounter: wins,
        challengeLevel,
        monsters: populateOrdinaryWorldEncounter(
          populator,
          challengeLevel,
          this.#randomMonsterTypes,
          this.#rng,
        ),
      };




      if (!forced && !this.#occursThisRefresh(targetPoiName)) {
        this.#recordPoiCompleted(targetPoiName);
        return { kind: "none", poiName: targetPoiName, reason: "occurrence-roll-failed", movement };
      }
    }
    if (
      !forced &&
      allowSkipWorldEncounter(
        encounter.kind === "fixed",
        playerActiveLevels,
        encounter.monsters.map((monster) => monster.level),
      )
    ) {
      this.#recordPoiCompleted(targetPoiName);
      return {
        kind: "skipped",
        poiName: targetPoiName,
        reason: "easy-ordinary-encounter",
        encounter,
        movement,
      };
    }
    return { kind: "encounter", poiName: targetPoiName, encounter, movement };
  }


  recordEncounterWin(poiName = this.#currentPoiName): number {
    this.#requirePoi(poiName);
    // `addPOIEncounterWin:` runs ahead of the completion gate, so a repeat win still counts.
    const wins = this.poiWins(poiName) + 1;
    this.#poiWins.set(poiName, wins);

    if (this.#completedThisRefresh.has(poiName)) return wins;
    this.#recordPoiCompleted(poiName);
    // Source fires event 1 after `notifyCompletedInWorld:`, so ClearWorldQuest's own POI walk
    // already sees this POI as `completedThisRefresh`.
    this.#emitWorldQuestEvent(1);
    return wins;
  }

  poiWins(poiName: string): number {
    this.#requirePoi(poiName);
    return this.#poiWins.get(poiName) ?? 0;
  }

  isCompletedThisRefresh(poiName: string): boolean {
    this.#requirePoi(poiName);
    return this.#completedThisRefresh.has(poiName);
  }

  hasEverCompletedPoi(poiName: string): boolean {
    return this.#everCompletedPois.has(poiName);
  }

  everCompletedPoiNames(): readonly string[] {
    return [...this.#everCompletedPois];
  }

  refreshAtTown(): void {
    // `Player.enteredTown:` refreshes every POI cache, then `TownPOINode.showNameplate`
    // unconditionally sends `notifyCompletedInWorld:` for the current town. A town's authored
    // encounter table does not participate in this completion step: an inactive quest-gated
    // fixed encounter (notably First_City's Ralph fight) must not close the town's world frontier.
    refreshWorldTripAtTown({
      occurrenceThisRefresh: this.#occurrenceThisRefresh,
      completedThisRefresh: this.#completedThisRefresh,
      everCompletedPois: this.#everCompletedPois,
    }, this.#currentPoiName);
    // `showNameplate`'s `notifyCompletedInWorld:` still runs through the once-per-run event 2 gate.
    if (!this.#notifiedCompletedPois.has(this.#currentPoiName)) {
      this.#notifiedCompletedPois.add(this.#currentPoiName);
      this.#emitWorldQuestEvent(2);
    }
  }


  #recordPoiCompleted(poiName: string): void {
    this.#completedThisRefresh.add(poiName);
    this.#everCompletedPois.add(poiName);
    if (this.#notifiedCompletedPois.has(poiName)) return;
    this.#notifiedCompletedPois.add(poiName);
    this.#emitWorldQuestEvent(2);
  }






  #emitWorldQuestEvent(id: 1 | 2): void {
    const onQuestEvent = this.#onQuestEvent;
    const instanceName = this.#world.instanceName;
    if (onQuestEvent === undefined || instanceName === undefined) return;
    let encounterPoiCount = 0;
    let completedEncounterPoiCount = 0;
    for (const poi of this.#pois.values()) {
      if (poi.encounter === undefined) continue;
      encounterPoiCount += 1;
      if (this.#completedThisRefresh.has(poi.instanceName)) completedEncounterPoiCount += 1;
    }
    const world = { instanceName, encounterPoiCount, completedEncounterPoiCount };
    onQuestEvent(id === 1 ? { id: 1, world } : { id: 2, world });
  }

  #connectionConditionsAreMet(connection: WorldConnectionDefinition): boolean {
    return (connection.requiredCompletedPoiNames ?? []).every((condition) => {
      const negated = condition.startsWith("!");
      const poiName = negated ? condition.slice(1) : condition;
      const completed = this.#everCompletedPois.has(poiName);
      return negated ? !completed : completed;
    });
  }

  #requirePoi(poiName: string): WorldPointOfInterestDefinition {
    const poi = this.#pois.get(poiName);
    if (poi === undefined) throw new WorldDataError(`unknown POI ${poiName}`);
    return poi;
  }

  #normalizedWorldChallenge(): number {
    const authored = this.#world.challengeLevel ?? 1;
    if (!Number.isSafeInteger(authored)) {
      throw new WorldDataError(`world challengeLevel must be a safe integer; got ${authored}`);
    }
    return Math.max(authored, 1);
  }

  #normalizedEncounterChance(): number {
    const chance = this.#world.encounterChance ?? DEFAULT_WORLD_ENCOUNTER_CHANCE;
    assertFinite("world encounterChance", chance);
    if (chance < 0 || chance > 1) {
      throw new WorldDataError(`world encounterChance must be in [0,1]; got ${chance}`);
    }
    return Math.fround(chance);
  }

  #occursThisRefresh(poiName: string): boolean {
    const cached = this.#occurrenceThisRefresh.get(poiName);
    if (cached !== undefined) return cached;
    const rawDraw = this.#rng.next();
    if (!Number.isFinite(rawDraw) || rawDraw < 0 || rawDraw >= 1) {
      throw new Error(`Rng.next() returned out-of-range value ${rawDraw}`);
    }
    // The source converts a valid uint32-scaled draw to float32 before the
    // comparison. Values near one can therefore narrow to exactly 1.0.
    const normalizedDraw = Math.fround(rawDraw);
    const occurs = normalizedDraw < this.#normalizedEncounterChance();
    this.#occurrenceThisRefresh.set(poiName, occurs);
    return occurs;
  }

  #buildFixedEncounter(
    populator: DefaultMonsterPopulatorDefinition,
    challengeLevel: number,
    floor: number,
  ): Pick<
    GeneratedWorldEncounter,
    | "monsters"
    | "completionKey"
    | "questKey"
    | "battleRewardKey"
    | "achievement"
    | "startEvent"
    | "winEvent"
    | "breeder"
    | "rewards"
  > | undefined {
    // The shipped world corpus has at most one candidate in a selected populator. The source
    // advances one candidate per build and never seeks a later candidate after a rejection.
    const candidate = populator.fixedEncounters?.[0];
    if (candidate === undefined) return undefined;

    const completionKey = cadenceCompletionKey(candidate, floor);
    if (completionKey !== undefined && this.#hasCompletedFixedEncounter(completionKey)) {
      return undefined;
    }
    if (candidate.questKey !== undefined && !this.#canUseQuestKey(candidate.questKey)) {
      return undefined;
    }
    const draw = this.#rng.next();
    if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
      throw new Error(`Rng.next() returned out-of-range value ${draw}`);
    }
    if (!(Math.fround(draw) < Math.fround(candidate.chanceToAppear))) return undefined;
    if (!fixedEncounterMatchesFloor(candidate, floor)) return undefined;

    const populatorScale = populator.levelScalor ?? 1;
    const monsters = candidate.monsters.map((monster) => {
      const type = monster.type === "Random"
        ? selectRandomMonsterType(this.#randomMonsterTypes, this.#rng)
        : monster.type;
      const level = Math.max(1, truncfProduct(
        Math.fround(Math.fround(challengeLevel) * Math.fround(populatorScale)),
        monster.levelScalor,
      ));
      return Object.freeze({
        type,
        level,
        ...(monster.extraLivingArguments === undefined
          ? {}
          : { extraLivingArguments: monster.extraLivingArguments }),
      });
    });
    const monsterLevelSum = monsters.reduce((sum, monster) => sum + monster.level, 0);
    const rewards = candidate.treasureData === undefined
      ? undefined
      : generateFixedEncounterRewards(
          candidate.treasureData,
          challengeLevel,
          monsterLevelSum,
          this.#rng,
        );
    return {
      monsters: Object.freeze(monsters),
      ...(completionKey === undefined ? {} : { completionKey }),
      ...(candidate.questKey === undefined ? {} : { questKey: candidate.questKey }),
      ...(candidate.battleRewardKey === undefined
        ? {}
        : { battleRewardKey: candidate.battleRewardKey }),
      ...(candidate.achievement === undefined ? {} : { achievement: candidate.achievement }),
      ...(candidate.startEvent === undefined ? {} : { startEvent: candidate.startEvent }),
      ...(candidate.winEvent === undefined ? {} : { winEvent: candidate.winEvent }),
      ...(candidate.breeder === undefined ? {} : { breeder: candidate.breeder }),
      ...(rewards === undefined ? {} : { rewards }),
    };
  }
}


export function fixedEncounterCompletionKey(
  fixed: Pick<WorldFixedEncounter, "uniqueKey" | "exactFloor" | "everyXFloors">,
  floor: number,
): string | undefined {
  return cadenceCompletionKey(fixed, floor);
}

function cadenceCompletionKey(
  fixed: Pick<WorldFixedEncounter, "uniqueKey" | "exactFloor" | "everyXFloors">,
  floor: number,
): string | undefined {
  if (fixed.uniqueKey === undefined) return undefined;
  if (fixed.everyXFloors === undefined) return fixed.uniqueKey;
  const exactFloor = fixed.exactFloor ?? 0;
  return `${fixed.uniqueKey}${Math.trunc((floor - exactFloor) / fixed.everyXFloors)}`;
}

function fixedEncounterMatchesFloor(
  fixed: Pick<WorldFixedEncounter, "exactFloor" | "everyXFloors">,
  floor: number,
): boolean {




  const exactFloor = fixed.exactFloor ?? 0;
  if (exactFloor === 0 || exactFloor === floor) return true;
  if (fixed.everyXFloors === undefined || fixed.everyXFloors === 0) return false;
  return (floor - exactFloor) % fixed.everyXFloors === 0;
}
