import { selectDungeonFloorPopulation } from "@dib/gamedata/dungeon";
import type {
  DungeonFloorPopulationProperty,
  DungeonBreederSpec,
  DungeonDefinition,
  DungeonFixedEncounter,
  DungeonFixedItemData,
  DungeonFloorPopulation,
  DungeonMonsterPopulator,
  DungeonOpaqueEvent,
  DungeonRoomTemplate,
  DungeonTreasureData,
  DungeonTreasureSpawn,
  DungeonZoneChange,
} from "@dib/gamedata/dungeon";
import type { ForkableRng, Rng } from "./rng.js";
import { mulberry32 } from "./rng.js";
import {
  assertExactObjectKeys,
  assertJsonSafeTree,
  assertOrdinaryArray,
  assertPlainObject,
  cloneJsonSafeRecord,
  cloneJsonSafeValue,
} from "./jsonSafe.js";
import {
  REWARD_GEM_STATS,
  type GemReward,
  type PlayerReward,
  type RewardGemQuality,
  type RewardGemSlot,
  type RewardGemStat,
} from "./rewards.js";

export type DungeonDirection = "north" | "east" | "south" | "west";
export const DUNGEON_DIRECTIONS: readonly DungeonDirection[] = Object.freeze([
  "north", "east", "south", "west",
]);

export interface DungeonMonster {
  readonly type: string;
  readonly level: number;
  readonly extraLivingArguments?: Readonly<Record<string, unknown>>;
}

export interface DungeonFixedEncounterGateSnapshot {
  /** Index in the authored fixed-encounter array consumed by generation for this pack slot. */
  readonly fixedIndex: number;
  /** Whether completion/quest eligibility passed when this floor was generated. */
  readonly eligible: boolean;
}

export interface DungeonEncounterRosterSnapshot {
  readonly encounterId: string;
  readonly monsters: readonly DungeonMonster[];
  /** Stable terminal Save Me/Store flow identity; absent only on legacy schema-1 saves. */
  readonly terminalFlowId?: string;
}

/** Validated, prepared room-roster transaction. The commit closure is intentionally the only
 * mutation phase; callers must invoke it only after the external event callback succeeds. */
export interface DungeonEncounterRosterUpdatePlan {
  readonly changed: boolean;
  readonly encounterId: string;
  readonly terminalFlowId: string;
  readonly monsters: readonly DungeonMonster[];
  readonly survivingMonsterCountsByRoom: readonly number[];
  readonly nextSnapshot: DungeonFloorSnapshot;
  readonly commit: () => void;
}

export interface DungeonEncounter {
  readonly id: string;
  readonly kind: "ordinary" | "fixed";
  readonly monsters: readonly DungeonMonster[];
  readonly completionKey?: string;
  readonly questKey?: string;
  readonly battleRewardKey?: string;
  readonly achievement?: string;
  readonly startEvent?: DungeonOpaqueEvent;
  readonly winEvent?: DungeonOpaqueEvent;
  readonly breeder?: DungeonBreederSpec;
  readonly treasure?: DungeonTreasure;
}

/** Dungeon compatibility names for the provider-neutral reward vocabulary. */
export type DungeonGemQuality = RewardGemQuality;
export type DungeonGemSlot = RewardGemSlot;
export const DUNGEON_GEM_STATS = REWARD_GEM_STATS;
export type DungeonGemStat = RewardGemStat;
export type DungeonGemLoot = GemReward;
export type DungeonLoot = PlayerReward;

export interface DungeonTreasure {
  readonly id: string;
  readonly guarded: boolean;
  readonly loot: readonly DungeonLoot[];
}

export interface DungeonPlacedZone {
  readonly id: string;
  readonly sourceIndex: number;
  readonly change: DungeonZoneChange;
}

export interface DungeonRoomLink {
  readonly targetRoomId: string;
  /** Boundary tile coordinate in this room: west x=-1, east x=width, south y=-1, north y=height. */
  readonly offset: Readonly<{ x: number; y: number }>;
}

export interface DungeonRoom {
  readonly id: string;
  readonly sourceIndex: number;
  readonly templateKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly links: readonly DungeonRoomLink[];
  readonly zones: readonly DungeonPlacedZone[];
  readonly waypoint: boolean;
  readonly explored: boolean;
  readonly encounter?: DungeonEncounter;
  readonly treasure?: DungeonTreasure;
}

export interface DungeonFloor {
  readonly definitionId: string;
  readonly floor: number;
  readonly seed: number;
  readonly challengeLevel: number;
  readonly startRoomId: string;
  readonly currentRoomId: string;
  readonly rooms: readonly DungeonRoom[];
  readonly selectedPopulationFloor?: number;
  readonly diagnostics: readonly DungeonDiagnostic[];
}

/** Public diagnostic identity shared with the renderer boundary. */
export const ZONE_ROOM_CHOICE_TIE_ORDER_DIAGNOSTIC =
  "zone-room-choice-tie-order" as const;

export interface DungeonDiagnostic {
  readonly code:
    | "topology-order-approximation"
    | typeof ZONE_ROOM_CHOICE_TIE_ORDER_DIAGNOSTIC
    | "generation-retry";
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface DungeonGenerationContext {
  readonly monsterTypes: readonly string[];
  /** Debug-only source stream override. Production/restores continue to derive a stream from seed. */
  readonly fidelityRng?: Rng;
  /** Fidelity-Lab-only normalization for Foundation collections whose native API leaves order
   * unspecified. Production generation deliberately keeps its canonical platform order. */
  readonly fidelityFoundationOrder?: "lexicographic";
  /** Compatibility seam for frozen pre-v16 Official simulations. Local/current generation uses
   * the source's independent property lookup when this is absent. */
  readonly legacyWholeRowPopulationSelection?: boolean;
  /** Frozen topology/weighted-choice behavior for Official simulation versions through v22.
   * Local/current generation uses the source-correct behavior when this is absent. */
  readonly legacyDungeonGenerationSemantics?: boolean;
  readonly isCompletionSet?: (key: string) => boolean;
  readonly isQuestUsable?: (questKey: string) => boolean;
  readonly entryZoneName?: string;
  /** Run-owned generation decisions used when restoring a serialized floor. */
  readonly fixedEncounterGateOverrides?: readonly DungeonFixedEncounterGateSnapshot[];
  /** Internal capture seam used to freeze the gate result into a new floor snapshot. */
  readonly onFixedEncounterGateEvaluated?: (fixedIndex: number, eligible: boolean) => void;
}

export interface DungeonFloorSnapshot {
  readonly schemaVersion: 1;
  readonly definitionId: string;
  readonly floor: number;
  readonly seed: number;
  readonly currentRoomId: string;
  /** Durable route back to the room that led into the current room, when one exists. */
  readonly previousRoomId?: string;
  readonly exploredRoomIds: readonly string[];
  readonly clearedEncounterIds: readonly string[];
  readonly collectedTreasureIds: readonly string[];
  readonly registeredWaypointFloors: readonly number[];
  readonly completedKeys: readonly string[];
  readonly catchTypes: readonly string[];
  readonly catchRewardCollected: boolean;
  /** Present in snapshots written after a dungeon battle loss/retreat; absent in early schema-1 saves. */
  readonly encounterRosters?: readonly DungeonEncounterRosterSnapshot[];
  /** Present in new snapshots; omission is the legacy live-gate restore path. */
  readonly generationGateDecisions?: readonly DungeonFixedEncounterGateSnapshot[];
}

/**
 * A structurally valid persisted floor no longer agrees with the floor regenerated from its
 * durable definition/seed. Callers may use this narrow classification to abandon an offline
 * active run while preserving the outer player save; authoritative restores must still fail.
 */
export class DungeonSnapshotCompatibilityError extends Error {
  override readonly name = "DungeonSnapshotCompatibilityError";
}

export type DungeonRoomEntryAction =
  | { readonly kind: "waypoint"; readonly floor: number; readonly roomId: string }
  | { readonly kind: "encounter"; readonly roomId: string; readonly encounter: DungeonEncounter }
  | { readonly kind: "treasure"; readonly roomId: string; readonly treasure: DungeonTreasure };

export interface DungeonMoveResult {
  readonly fromRoomId: string;
  readonly toRoomId: string;
  readonly direction: DungeonDirection;
  readonly actions: readonly DungeonRoomEntryAction[];
}

/**
 * Source `DungeonNode.setCurrentRoom:` selection result. Scene touch selection is wider than the
 * direct-link/directional movement helpers: any already materialized room may be selected.
 */
export type DungeonRoomSelectionResult =
  | {
      readonly kind: "same-room";
      readonly roomId: string;
    }
  | {
      readonly kind: "changed-room";
      readonly fromRoomId: string;
      readonly toRoomId: string;
      readonly transition: "door-walk" | "fade-teleport";
      /** Present only when the target owns the reciprocal door used by the two walking legs. */
      readonly direction?: DungeonDirection;
      readonly actions: readonly DungeonRoomEntryAction[];
    };

export interface DungeonCatchQuestProgress {
  readonly required: readonly string[];
  readonly captured: readonly string[];
  readonly complete: boolean;
  readonly rewardCollected: boolean;
}

export type DungeonZoneActivation =
  | { readonly kind: "blocked"; readonly reason: "mustClearFloor"; readonly remainingEncounterCount: number }
  | { readonly kind: "stairs"; readonly direction: "up" | "down"; readonly targetFloor: number }
  | { readonly kind: "worldExit"; readonly change: Extract<DungeonZoneChange, { kind: "worldExit" }> }
  | { readonly kind: "dungeonExit"; readonly change: Extract<DungeonZoneChange, { kind: "dungeonExit" }> };

interface MutableRoom {
  id: string;
  sourceIndex: number;
  templateKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  links: DungeonRoomLink[];
  zones: DungeonPlacedZone[];
  waypoint: boolean;
  explored: boolean;
  encounter?: DungeonEncounter;
  treasure?: DungeonTreasure;
}

interface MutableFloor {
  definitionId: string;
  floor: number;
  seed: number;
  challengeLevel: number;
  startRoomId: string;
  currentRoomId: string;
  rooms: MutableRoom[];
  selectedPopulationFloor?: number;
  diagnostics: DungeonDiagnostic[];
}

/** Objective-C roundf semantics; unlike Math.round this is also correct for negative halves. */
export function dungeonRoundf(value: number): number {
  if (!Number.isFinite(value)) throw new Error(`dungeonRoundf(${value})`);
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

/** Source `monsterLevelBase + floor * monsterLevelFloorScalor`, rounded by roundf. */
export function dungeonChallengeLevel(definition: Pick<DungeonDefinition, "creation">, floor: number): number {
  assertPositiveInteger(floor, "floor");
  return Math.max(
    1,
    definition.creation.monsterLevelBase +
      dungeonRoundf((floor - 1) * definition.creation.monsterLevelFloorScalor),
  );
}

/** Source inclusive room-count draw: min + arc4random_uniform(max + 1 - min). */
export function dungeonTargetRoomCount(
  creation: Pick<DungeonDefinition["creation"], "roomsMin" | "roomsMax">,
  rng: Rng,
): number {
  return creation.roomsMax <= creation.roomsMin
    ? creation.roomsMin
    : creation.roomsMin + rng.intBelow(creation.roomsMax + 1 - creation.roomsMin);
}


export function dungeonPointIsReserved(width: number, height: number, x: number, y: number): boolean {
  for (const [value, label] of [[width, "width"], [height, "height"], [x, "x"], [y, "y"]] as const) {
    if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`);
  }
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x >= width || y >= height) return true;
  return width === 1 || height === 1 ||
    (x === width - 1 && y === height - 1) ||
    (x === 0 && y === height - 1) ||
    (x === width - 1 && y === 0);
}

/** Greatest authored threshold key <= floor that defines the requested property. Omitting the
 * property preserves the port's pre-v16 whole-row selection for frozen Official simulations. */
export function dungeonPopulationForFloor(
  definition: Pick<DungeonDefinition, "floorPopulations">,
  floor: number,
  property?: DungeonFloorPopulationProperty,
): DungeonFloorPopulation | undefined {
  assertPositiveInteger(floor, "floor");
  if (property === undefined) {
    let selected: DungeonFloorPopulation | undefined;
    for (const row of definition.floorPopulations) {
      if (row.sourceFloor > floor) break;
      selected = row;
    }
    return selected;
  }
  return selectDungeonFloorPopulation(definition, floor, property);
}







export function dungeonZoneChangesForFloor(
  definition: Pick<DungeonDefinition, "creation" | "floorPopulations">,
  floor: number,
): readonly DungeonZoneChange[] {
  assertPositiveInteger(floor, "floor");
  const exact = definition.floorPopulations.find((row) => row.sourceFloor === floor);
  const hasAuthored = exact !== undefined &&
    (exact.hasAuthoredZoneChanges ?? exact.zoneChanges.length > 0);
  if (hasAuthored) {
    return Object.freeze(exact.zoneChanges.filter((change) =>
      change.kind !== "stairsDown" || floor !== definition.creation.lastFloor));
  }
  return Object.freeze([
    { kind: "stairsUp", sourceType: "Up" } as const,
    ...(floor === definition.creation.lastFloor
      ? []
      : [{ kind: "stairsDown", sourceType: "Down" } as const]),
  ]);
}

export function dungeonDefinitionId(definition: Pick<DungeonDefinition, "typeName" | "sourceFile" | "instanceName">): string {
  return `${definition.typeName}:${definition.sourceFile}:${definition.instanceName}`;
}

/**
 * Per-floor replay positions for a Fidelity Lab generation stream, keyed by the stream itself so a
 * lab session's bookkeeping cannot outlive it.
 *
 * `generateDungeonFloor` normally derives its stream from `seed`, which is what lets every
 * regeneration of an already generated floor — `DungeonSession.restore`'s validation pass, the
 * run-progress overlay in `DungeonRuntimeController`'s constructor, a cached floor, a reload —
 * reproduce that exact floor and match the room, encounter, and treasure identities recorded
 * against it. The lab replaces that with one shared, ever-advancing TouchHLE stream so the port
 * draws what the emulator draws, and a shared stream ignores `seed`: the second generation
 * continued from wherever the first left off and produced a different graph, so every dungeon
 * entry under the lab failed with `Dungeon snapshot current room is missing`.
 *
 * Recording the stream position each floor identity first generated from repairs that without
 * weakening the comparison: the first generation still advances the shared stream in native draw
 * order, and a regeneration replays those same draws from a detached fork rather than consuming
 * draws the emulator never made.
 */
const fidelityFloorStreams = new WeakMap<Rng, Map<string, ForkableRng>>();

function generationRng(
  definition: DungeonDefinition,
  floor: number,
  seed: number,
  context: DungeonGenerationContext,
): Rng {
  const fidelity = context.fidelityRng;
  if (fidelity === undefined) return mulberry32(seed);
  if (typeof (fidelity as Partial<ForkableRng>).fork !== "function") {
    throw new Error("A Fidelity Lab dungeon generation stream must be forkable to stay replayable");
  }
  let streams = fidelityFloorStreams.get(fidelity);
  if (streams === undefined) {
    streams = new Map();
    fidelityFloorStreams.set(fidelity, streams);
  }
  const key = `${dungeonDefinitionId(definition)}|${floor}|${seed >>> 0}`;
  const recorded = streams.get(key);
  if (recorded !== undefined) return recorded.fork();
  streams.set(key, (fidelity as ForkableRng).fork());
  return fidelity;
}

/** Generates one source-shaped floor with the native reservation-grid/frontier topology pass. */
export function generateDungeonFloor(
  definition: DungeonDefinition,
  floor: number,
  seed: number,
  context: DungeonGenerationContext,
): DungeonFloor {
  assertPositiveInteger(floor, "floor");
  if (!Number.isInteger(seed)) throw new Error("seed must be an integer");
  if (context.monsterTypes.length === 0) throw new Error("monsterTypes must not be empty");
  const rng = generationRng(definition, floor, seed, context);
  const target = dungeonTargetRoomCount(definition.creation, rng);
  const roomChoiceBias = effectiveRoomChoiceBias(definition, rng);
  const diagnostics: DungeonDiagnostic[] = [];
  const rooms = generateTopology(
    definition,
    target,
    roomChoiceBias,
    rng,
    context.fidelityFoundationOrder,
    context.legacyDungeonGenerationSemantics === true,
  );
  if (rooms.length === 0) throw new Error(`Dungeon ${definition.instanceName} has no non-hallway room template`);

  const challenge = dungeonChallengeLevel(definition, floor);
  const legacyPopulation = context.legacyWholeRowPopulationSelection === true
    ? dungeonPopulationForFloor(definition, floor)
    : undefined;
  const monsterPopulation = legacyPopulation ??
    dungeonPopulationForFloor(definition, floor, "monsterPopulator");
  const treasurePopulation = legacyPopulation ??
    dungeonPopulationForFloor(definition, floor, "treasurePopulator");
  const selectedPopulation = monsterPopulation ?? treasurePopulation;
  const zonePlacement = placeZones(
    rooms,
    dungeonZoneChangesForFloor(definition, floor),
    definition.creation.roomChoiceBiasClass,
    roomChoiceBias,
    rng,
    diagnostics,
    context.fidelityFoundationOrder,
    context.legacyDungeonGenerationSemantics === true,
  );
  const start = chooseStartRoom(rooms, context.entryZoneName);
  const waypoint = definition.creation.waypointEvery > 0 && floor % definition.creation.waypointEvery === 0;
  if (waypoint) {
    const waypointRoom = zonePlacement.remaining[
      Math.min(zonePlacement.lastZoneRoomIndex, zonePlacement.remaining.length - 1)
    ];
    if (waypointRoom === undefined) {
      throw new Error(`Dungeon ${definition.instanceName} floor ${floor} has no waypoint-eligible room`);
    }
    waypointRoom.waypoint = true;
  }
  if (monsterPopulation?.monsterPopulator !== undefined) {
    populateMonsters(rooms, monsterPopulation.monsterPopulator, floor, challenge, rng, context, diagnostics);
  }
  if (treasurePopulation?.treasurePopulator !== undefined) {
    populateTreasure(rooms, treasurePopulation.treasurePopulator.unguardedTreasureChance,
      treasurePopulation.treasurePopulator.treasureData, challenge, rng, diagnostics);
  }
  const mutable: MutableFloor = {
    definitionId: dungeonDefinitionId(definition),
    floor,
    seed: seed >>> 0,
    challengeLevel: challenge,
    startRoomId: start.id,
    currentRoomId: start.id,
    rooms,
    ...(selectedPopulation === undefined
      ? {}
      : { selectedPopulationFloor: selectedPopulation.sourceFloor }),
    diagnostics,
  };
  return freezeFloor(mutable);
}

function generateTopology(
  definition: DungeonDefinition,
  target: number,
  roomChoiceBias: Readonly<{ x: number; y: number }>,
  rng: Rng,
  foundationOrder?: "lexicographic",
  legacy = false,
): MutableRoom[] {
  const allTemplates = definition.creation.roomTemplates;
  const firstPool = [...allTemplates];
  let firstTemplate: DungeonRoomTemplate | undefined;
  while (firstPool.length > 0) {
    const [candidate] = firstPool.splice(rng.intBelow(firstPool.length), 1);
    if (candidate !== undefined && !isHallwayTemplate(candidate)) {
      firstTemplate = candidate;
      break;
    }
  }
  if (firstTemplate === undefined) return [];

  const first = createRoom(0, firstTemplate, 0, 0);
  const rooms: MutableRoom[] = [first];
  const grid = new Map<string, 0 | 1>();
  reserveRoom(grid, first);
  const frontier = [first];




  let hallwayPlacementsRemaining = definition.creation.nonHallwaysNeeded || 2;

  while (frontier.length > 0 && rooms.length < target) {
    const parent = pickTopologyParent(
      frontier,
      definition.creation.roomChoiceBiasClass,
      roomChoiceBias,
      rng,
      foundationOrder,
      legacy,
    );
    const allowed = allowedAttachmentPoints(parent, grid);
    const pointBias = buildTopologyPointBias(
      allowed,
      definition.creation.roomChoiceBiasClass,
      roomChoiceBias,
      foundationOrder,
      legacy,
    );
    const retryRoll = legacy ? rng.next() : Math.fround(rng.next());
    if (
      definition.creation.density >= 1 &&
      (!legacy || retryRoll < definition.creation.retryChance)
    ) {
      for (let pointAttempt = 0; pointAttempt < definition.creation.density; pointAttempt++) {
        if (allowed.size === 0) break;
        const point = pickTopologyPoint(
          allowed,
          pointBias,
          definition.creation.roomChoiceBiasClass,
          rng,
          foundationOrder,
          legacy,
        );
        const templatePool = [...allTemplates];
        while (templatePool.length > 0) {
          let template = removeWeightedTemplate(templatePool, rng, legacy);
          if (
            !isHallwayTemplate(template) &&
            hallwayPlacementsRemaining > 0 &&
            rng.intBelow(5) < rooms.length &&
            templatePool.length > 0
          ) {
            do {
              template = removeWeightedTemplate(templatePool, rng, legacy);
            } while (isHallwayTemplate(template) && templatePool.length > 0);
            if (isHallwayTemplate(template)) break;
          }
          const child = tryPlaceAndLink(
            rooms.length,
            point,
            template,
            grid,
            allowed,
            parent,
            rng,
          );
          if (child !== undefined) {
            rooms.push(child);
            frontier.push(child);
            if (legacy ? !isHallwayTemplate(template) : isHallwayTemplate(template)) {
              hallwayPlacementsRemaining--;
            }
            break;
          }
        }
        allowed.delete(pointKey(point));




        if (!legacy && !(retryRoll < Math.fround(definition.creation.retryChance))) break;
      }
    }
    frontier.splice(frontier.indexOf(parent), 1);
  }

  for (let pass = 0; pass < 20 && rooms.length < target; pass++) {
    addMoreNonHallwayRooms(
      rooms,
      allTemplates.filter((template) => !isHallwayTemplate(template)),
      target,
      definition.creation.density,
      definition.creation.roomChoiceBiasClass,
      roomChoiceBias,
      rng,
      foundationOrder,
      legacy,
    );
  }
  return rooms;
}

function isHallwayTemplate(template: Pick<DungeonRoomTemplate, "width" | "height">): boolean {
  return template.width === 1 || template.height === 1;
}

function removeWeightedTemplate(
  templates: DungeonRoomTemplate[],
  rng: Rng,
  legacy = false,
): DungeonRoomTemplate {
  if (templates.length === 1) return templates.pop()!;
  const weights = templates.map((template) => template.frequency);
  const index = legacy ? pickWeightedIndex(weights, rng) : pickWeightedRemovalIndex(weights, rng);
  return templates.splice(index, 1)[0]!;
}

function createRoom(
  index: number,
  template: DungeonRoomTemplate,
  x: number,
  y: number,
): MutableRoom {
  return {
    id: `${template.key}-{${x}, ${y}}`,
    sourceIndex: index,
    templateKey: template.key,
    x,
    y,
    width: template.width,
    height: template.height,
    rotation: 0,
    links: [], zones: [], waypoint: false, explored: false,
  };
}

function gridKey(x: number, y: number): string {
  return `${x},${y}`;
}

function pointKey(point: Readonly<{ x: number; y: number }>): string {
  return gridKey(point.x, point.y);
}

function foundationTextCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function foundationOrderedMapValues<T>(
  values: ReadonlyMap<string, T>,
  order?: "lexicographic",
): T[] {
  const entries = [...values.entries()];
  if (order === "lexicographic") {
    entries.sort(([left], [right]) => foundationTextCompare(left, right));
  }
  return entries.map(([, value]) => value);
}

function foundationRectKey(
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
): string {
  return `{{${rect.x}, ${rect.y}}, {${rect.width}, ${rect.height}}}`;
}

function roomFits(grid: ReadonlyMap<string, 0 | 1>, room: MutableRoom): boolean {
  for (let dx = -1; dx <= room.width; dx++) {
    for (let dy = -1; dy <= room.height; dy++) {
      const inner = dx >= 0 && dx < room.width && dy >= 0 && dy < room.height;
      const value = grid.get(gridKey(room.x + dx, room.y + dy));
      if (inner ? value !== undefined : value === 1) return false;
    }
  }
  return true;
}

function reserveRoom(
  grid: Map<string, 0 | 1>,
  room: MutableRoom,
  allowed?: Map<string, { readonly x: number; readonly y: number }>,
): void {
  for (let dx = -1; dx <= room.width; dx++) {
    for (let dy = -1; dy <= room.height; dy++) {
      const inner = dx >= 0 && dx < room.width && dy >= 0 && dy < room.height;
      const key = gridKey(room.x + dx, room.y + dy);
      const previous = grid.get(key);
      if ((inner && previous !== undefined) || (!inner && previous === 1)) {
        throw new Error(`Dungeon room reservation collision at ${key}`);
      }
      if (inner || previous === undefined) grid.set(key, inner ? 1 : 0);
      allowed?.delete(key);
    }
  }
}

function allowedAttachmentPoints(
  parent: MutableRoom,
  grid: ReadonlyMap<string, 0 | 1>,
): Map<string, { readonly x: number; readonly y: number }> {
  const points = new Map<string, { readonly x: number; readonly y: number }>();
  const add = (x: number, y: number): void => {
    const key = gridKey(x, y);
    if (!grid.has(key)) points.set(key, Object.freeze({ x, y }));
  };





  for (let y = 0; y < parent.height; y++) add(parent.x - 2, parent.y + y);
  for (let x = 0; x < parent.width; x++) {
    add(parent.x + x, parent.y - 2);
    add(parent.x + x, parent.y + parent.height + 1);
  }
  for (let y = 0; y < parent.height; y++) add(parent.x + parent.width + 1, parent.y + y);
  return points;
}

interface TopologyPointBias {
  readonly entries: Array<{
    readonly key: string;
    readonly point: { readonly x: number; readonly y: number };
    readonly weight: number;
  }>;
}

function buildTopologyPointBias(
  allowed: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  kind: DungeonDefinition["creation"]["roomChoiceBiasClass"],
  bias: Readonly<{ x: number; y: number }>,
  foundationOrder?: "lexicographic",
  legacy = false,
): TopologyPointBias {
  const points = foundationOrderedMapValues(allowed, foundationOrder);
  if (kind === "DefaultRoomChoiceBias") return { entries: [] };
  const weights = kind === "DirectedRoomChoiceBias"
    ? (legacy ? legacyDirectedRoomChoiceWeights : dungeonDirectedRoomChoiceWeights)(



      points.map((point) => ({ ...point, width: 1, height: 1 })),
      bias,
    )
    : points.map((point) => Math.max(
      1,
      Math.trunc(100 * 0.5 / Math.max(0.1, Math.max(Math.abs(point.x), Math.abs(point.y)))),
    ));
  return {
    entries: points.map((point, index) => ({
      key: pointKey(point),
      point,
      weight: weights[index]!,
    })),
  };
}

function pickTopologyParent(
  rooms: readonly MutableRoom[],
  kind: DungeonDefinition["creation"]["roomChoiceBiasClass"],
  bias: Readonly<{ x: number; y: number }>,
  rng: Rng,
  foundationOrder?: "lexicographic",
  legacy = false,
): MutableRoom {
  if (kind !== "DirectedRoomChoiceBias") return rooms[rng.intBelow(rooms.length)]!;
  if (legacy) {
    return rooms[pickWeightedIndex(legacyDirectedRoomChoiceWeights(rooms, bias), rng)]!;
  }




  const first = rooms[0]!;
  const startPoint = Object.freeze({
    x: Math.fround(first.x + first.width * 0.5),
    y: Math.fround(first.y + first.height * 0.5),
  });
  const ordered = foundationOrder === "lexicographic"
    ? [...rooms].sort((left, right) => foundationTextCompare(
      foundationRectKey(left),
      foundationRectKey(right),
    ))
    : rooms;
  return ordered[pickWeightedIndex(
    dungeonDirectedRoomChoiceWeights(ordered, bias, startPoint),
    rng,
  )]!;
}

function pickWeightedIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng.intBelow(total);
  for (let index = 0; index < weights.length; index++) {
    if (roll < weights[index]!) return index;
    roll -= weights[index]!;
  }
  throw new Error("Weighted dungeon choice exhausted its cumulative range");
}






function pickWeightedRemovalIndex(weights: readonly number[], rng: Rng): number {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const roll = rng.intBelow(total);
  let cumulative = 0;
  for (let index = 0; index < weights.length; index++) {
    cumulative += weights[index]!;
    if (cumulative >= roll) return index;
  }
  throw new Error("Weighted dungeon removal exhausted its cumulative range");
}

function removeWeightedPoint(
  entries: TopologyPointBias["entries"],
  rng: Rng,
  legacy = false,
): TopologyPointBias["entries"][number] {
  if (entries.length === 1) return entries.pop()!;
  const weights = entries.map((entry) => entry.weight);
  const index = legacy ? pickWeightedIndex(weights, rng) : pickWeightedRemovalIndex(weights, rng);
  return entries.splice(index, 1)[0]!;
}

function pickTopologyPoint(
  allowed: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  pointBias: TopologyPointBias,
  kind: DungeonDefinition["creation"]["roomChoiceBiasClass"],
  rng: Rng,
  foundationOrder?: "lexicographic",
  legacy = false,
): { readonly x: number; readonly y: number } {
  if (kind === "DefaultRoomChoiceBias") {
    const values = foundationOrderedMapValues(allowed, foundationOrder);
    return values[rng.intBelow(values.length)]!;
  }
  while (pointBias.entries.length > 0) {
    const entry = removeWeightedPoint(pointBias.entries, rng, legacy);
    if (allowed.has(entry.key)) return entry.point;
  }
  throw new Error("Dungeon point bias exhausted before allowed attachment points");
}

function tryPlaceAndLink(
  index: number,
  point: Readonly<{ x: number; y: number }>,
  template: DungeonRoomTemplate,
  grid: Map<string, 0 | 1>,
  allowed: Map<string, { readonly x: number; readonly y: number }>,
  parent: MutableRoom,
  rng: Rng,
): MutableRoom | undefined {
  const candidates: Array<{ readonly x: number; readonly y: number }> = [];
  for (let x = point.x - (template.width - 1); x <= point.x; x++) {
    for (let y = point.y - (template.height - 1); y <= point.y; y++) {
      candidates.push(Object.freeze({ x, y }));
    }
  }
  while (candidates.length > 0) {
    const [position] = candidates.splice(rng.intBelow(candidates.length), 1);
    const child = createRoom(index, template, position!.x, position!.y);
    if (!roomFits(grid, child)) continue;
    reserveRoom(grid, child, allowed);
    linkRoomsAtPoint(parent, child, point);
    return child;
  }
  return undefined;
}

function linkRoomsAtPoint(
  parent: MutableRoom,
  child: MutableRoom,
  point: Readonly<{ x: number; y: number }>,
): void {
  const parentOffset = {
    x: point.x - parent.x,
    y: point.y - parent.y,
  };
  if (point.x < parent.x) parentOffset.x += 1;
  if (point.x >= parent.x + parent.width) parentOffset.x -= 1;
  if (point.y < parent.y) parentOffset.y += 1;
  if (point.y >= parent.y + parent.height) parentOffset.y -= 1;
  let childOffset: { x: number; y: number };
  if (parentOffset.x === -1) {
    childOffset = { x: child.width, y: parent.y + parentOffset.y - child.y };
  } else if (parentOffset.x === parent.width) {
    childOffset = { x: -1, y: parent.y + parentOffset.y - child.y };
  } else if (parentOffset.y === -1) {
    childOffset = { x: parent.x + parentOffset.x - child.x, y: child.height };
  } else {
    childOffset = { x: parent.x + parentOffset.x - child.x, y: -1 };
  }
  parent.links.push(Object.freeze({
    targetRoomId: child.id,
    offset: Object.freeze(parentOffset),
  }));
  child.links.push(Object.freeze({
    targetRoomId: parent.id,
    offset: Object.freeze(childOffset),
  }));
}

function addMoreNonHallwayRooms(
  rooms: MutableRoom[],
  templates: readonly DungeonRoomTemplate[],
  target: number,
  density: number,
  kind: DungeonDefinition["creation"]["roomChoiceBiasClass"],
  bias: Readonly<{ x: number; y: number }>,
  rng: Rng,
  foundationOrder?: "lexicographic",
  legacy = false,
): void {
  if (templates.length === 0) return;
  const grid = new Map<string, 0 | 1>();
  for (const room of rooms) reserveRoom(grid, room);
  const parents = [...rooms];
  while (parents.length > 0 && rooms.length < target) {
    const parent = pickTopologyParent(parents, kind, bias, rng, foundationOrder, legacy);
    const allowed = allowedAttachmentPoints(parent, grid);
    const pointBias = buildTopologyPointBias(allowed, kind, bias, foundationOrder, legacy);
    while (allowed.size > 0) {
      const point = pickTopologyPoint(allowed, pointBias, kind, rng, foundationOrder, legacy);
      const templatePool = [...templates];
      for (let attempt = 0; attempt < density + 3 && templatePool.length > 0; attempt++) {
        const template = removeWeightedTemplate(templatePool, rng, legacy);
        const child = tryPlaceAndLink(
          rooms.length,
          point,
          template,
          grid,
          allowed,
          parent,
          rng,
        );
        if (child !== undefined) {
          rooms.push(child);
          break;
        }
      }
      allowed.delete(pointKey(point));
    }
    parents.splice(parents.indexOf(parent), 1);
  }
}

function placeZones(
  rooms: MutableRoom[],
  changes: readonly DungeonZoneChange[],
  kind: DungeonDefinition["creation"]["roomChoiceBiasClass"],
  bias: Readonly<{ x: number; y: number }>,
  rng: Rng,
  diagnostics: DungeonDiagnostic[],
  foundationOrder?: "lexicographic",
  legacy = false,
): { readonly remaining: readonly MutableRoom[]; readonly lastZoneRoomIndex: number } {
  const candidates = [...rooms];
  const remainingChanges = [...changes];
  let lastZoneRoomIndex = 0;
  for (let index = 0; remainingChanges.length > 0; index++) {
    if (candidates.length === 0) break;






    lastZoneRoomIndex = kind === "DirectedRoomChoiceBias"
      ? directedZoneRoomIndex(candidates, bias, index, rng, diagnostics, foundationOrder, legacy)
      : rng.intBelow(candidates.length);
    const [room] = candidates.splice(lastZoneRoomIndex, 1);
    if (room === undefined) break;
    const changeIndex = kind === "DefaultRoomChoiceBias"
      ? rng.intBelow(remainingChanges.length)
      : 0;
    const [change] = remainingChanges.splice(changeIndex, 1);
    if (change === undefined) break;
    room.zones.push(Object.freeze({ id: `zone-${index}`, sourceIndex: index, change }));
  }
  return Object.freeze({ remaining: Object.freeze(candidates), lastZoneRoomIndex });
}

function effectiveRoomChoiceBias(
  definition: DungeonDefinition,
  rng: Rng,
): Readonly<{ x: number; y: number }> {
  const authored = definition.creation.roomChoiceBiasDirection;
  if (!definition.creation.roomChoiceBiasRandom) return authored;
  const xMagnitude = Math.fround(Math.fround(rng.next()) * Math.fround(authored.x));
  const yMagnitude = Math.fround(Math.fround(rng.next()) * Math.fround(authored.y));
  const x = rng.intBelow(2) === 0 ? -xMagnitude : xMagnitude;
  const y = rng.intBelow(2) === 0 ? -yMagnitude : yMagnitude;
  return Object.freeze({ x, y });
}

function directedZoneRoomIndex(
  candidates: readonly MutableRoom[],
  bias: Readonly<{ x: number; y: number }>,
  zoneIndex: number,
  rng: Rng,
  diagnostics: DungeonDiagnostic[],
  foundationOrder?: "lexicographic",
  legacy = false,
): number {
  const weights = legacy
    ? legacyDirectedRoomChoiceWeights(candidates, bias)
    : dungeonDirectedRoomChoiceWeights(candidates, bias);
  const weighted = weights.map((weight, candidateIndex) => Object.freeze({
    candidateIndex,
    weight,
    key: foundationRectKey(candidates[candidateIndex]!),
  }));
  if (foundationOrder === "lexicographic") {
    weighted.sort((left, right) => foundationTextCompare(left.key, right.key));
  }
  const pool = legacy
    ? [...weighted]
      .sort((left, right) => zoneIndex === 0
        ? left.weight - right.weight
        : right.weight - left.weight)
      .slice(0, Math.min(3, weighted.length))
    : dungeonExtremalWeightPool(weighted, 3, zoneIndex === 0 ? "lowest" : "highest");
  const selected = new Set(pool.map((entry) => entry.candidateIndex));
  const cutoff = pool.length === 0
    ? undefined
    : zoneIndex === 0
      ? Math.max(...pool.map((entry) => entry.weight))
      : Math.min(...pool.map((entry) => entry.weight));
  if (
    cutoff !== undefined &&
    weighted.some((entry) => !selected.has(entry.candidateIndex) && entry.weight === cutoff)
  ) {
    addDiagnosticOnce(diagnostics, {
      code: ZONE_ROOM_CHOICE_TIE_ORDER_DIAGNOSTIC,
      message: "Directed zone weights tie at the three-room cutoff; native Foundation dictionary enumeration order is unresolved.",
    });
  }
  return pool[rng.intBelow(pool.length)]!.candidateIndex;
}


export function dungeonExtremalWeightPool<T extends { readonly weight: number }>(
  entries: readonly T[],
  count: number,
  kind: "lowest" | "highest",
): readonly T[] {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Dungeon extremal pool count must be a nonnegative integer, got ${count}`);
  }
  const slots: Array<T | undefined> = Array.from({ length: count });
  const slotWeights = Array.from({ length: count }, () => 0);
  for (const entry of entries) {
    let replacement = -1;
    for (let index = 0; index < count; index++) {
      const eligible = slots[index] === undefined || (kind === "lowest"
        ? entry.weight < slotWeights[index]!
        : entry.weight > slotWeights[index]!);
      if (!eligible) continue;
      if (replacement === -1 || (kind === "lowest"
        ? slotWeights[index]! > slotWeights[replacement]!
        : slotWeights[index]! < slotWeights[replacement]!)) {
        replacement = index;
      }
    }
    if (replacement !== -1) {
      slots[replacement] = entry;
      slotWeights[replacement] = entry.weight;
    }
  }
  return Object.freeze(slots.filter((entry): entry is T => entry !== undefined));
}

/** Frozen pre-correction implementation retained only by immutable Official simulations through
 * v22. It intentionally uses tight candidate bounds, their center as every origin, and the old
 * float-rounding approximation. */
function legacyDirectedRoomChoiceWeights(
  candidates: readonly Pick<DungeonRoom, "x" | "y" | "width" | "height">[],
  bias: Readonly<{ x: number; y: number }>,
): readonly number[] {
  if (candidates.length === 0) return Object.freeze([]);
  const minX = Math.min(...candidates.map((room) => room.x));
  const minY = Math.min(...candidates.map((room) => room.y));
  const maxX = Math.max(...candidates.map((room) => room.x + room.width));
  const maxY = Math.max(...candidates.map((room) => room.y + room.height));
  const width = maxX - minX;
  const height = maxY - minY;
  const targetX = Math.fround(
    Math.fround((minX + maxX) * 0.5) +
    Math.fround(Math.max(-1, Math.min(1, bias.x)) * Math.fround(width * 0.5)),
  );
  const targetY = Math.fround(
    Math.fround((minY + maxY) * 0.5) +
    Math.fround(Math.max(-1, Math.min(1, bias.y)) * Math.fround(height * 0.5)),
  );
  const biasLength = Math.fround(Math.hypot(Math.fround(bias.x), Math.fround(bias.y)));
  const metrics = candidates.map((room) => {
    const centerX = Math.fround(room.x + room.width * 0.5);
    const centerY = Math.fround(room.y + room.height * 0.5);
    const distance = Math.fround(Math.hypot(
      Math.fround(centerX - targetX),
      Math.fround(centerY - targetY),
    ));
    return Math.max(0.25, Math.fround(biasLength * distance));
  });
  const minimum = Math.min(...metrics);
  return Object.freeze(metrics.map((metric) =>
    Math.trunc(Math.max(
      1,
      Math.fround(1000 * Math.fround(Math.fround(minimum / metric) ** 2)),
    )),
  ));
}

export function dungeonDirectedRoomChoiceWeights(
  candidates: readonly Pick<DungeonRoom, "x" | "y" | "width" | "height">[],
  bias: Readonly<{ x: number; y: number }>,
  startPoint?: Readonly<{ x: number; y: number }>,
): readonly number[] {
  if (candidates.length === 0) return Object.freeze([]);




  const minX = Math.min(0, ...candidates.map((room) => room.x));
  const minY = Math.min(0, ...candidates.map((room) => room.y));
  const maxX = Math.max(0, ...candidates.map((room) => room.x + room.width));
  const maxY = Math.max(0, ...candidates.map((room) => room.y + room.height));
  const width = maxX - minX;
  const height = maxY - minY;
  const originX = startPoint?.x ?? Math.fround((minX + maxX) * 0.5);
  const originY = startPoint?.y ?? Math.fround((minY + maxY) * 0.5);
  const targetX = Math.fround(
    Math.fround(originX) +
    Math.fround(Math.max(-1, Math.min(1, bias.x)) * Math.fround(width * 0.5)),
  );
  const targetY = Math.fround(
    Math.fround(originY) +
    Math.fround(Math.max(-1, Math.min(1, bias.y)) * Math.fround(height * 0.5)),
  );
  const floatHypot = (x: number, y: number): number => Math.fround(Math.sqrt(Math.fround(
    Math.fround(Math.fround(x) * Math.fround(x)) +
    Math.fround(Math.fround(y) * Math.fround(y)),
  )));



  const biasLength = floatHypot(bias.x, bias.y);
  const metrics = candidates.map((room) => {
    const centerX = Math.fround(room.x + room.width * 0.5);
    const centerY = Math.fround(room.y + room.height * 0.5);
    const distance = floatHypot(
      Math.fround(centerX - targetX),
      Math.fround(centerY - targetY),
    );
    return Math.max(0.25, Math.fround(biasLength * distance));
  });
  const minimum = Math.min(...metrics);
  return Object.freeze(metrics.map((metric) => {




    const scaled = (minimum * minimum) / (metric * metric) * 1000;
    return scaled > 1 ? Math.trunc(Math.fround(scaled)) : 1;
  }));
}

function chooseStartRoom(rooms: MutableRoom[], entryZoneName: string | undefined): MutableRoom {
  if (entryZoneName !== undefined) {
    const match = rooms.find((room) => room.zones.some((zone) =>
      (zone.change.kind === "worldExit" || zone.change.kind === "dungeonExit") &&
      zone.change.instanceName === entryZoneName));
    if (match !== undefined) return match;
  }
  const stairUp = rooms.find((room) => room.zones.some((zone) => zone.change.kind === "stairsUp"));
  return stairUp ?? rooms[0]!;
}

function populateMonsters(
  rooms: MutableRoom[],
  populator: DungeonMonsterPopulator,
  floor: number,
  challenge: number,
  rng: Rng,
  context: DungeonGenerationContext,
  diagnostics: DungeonDiagnostic[],
): void {





  const available = rooms.filter((room) => room.zones.length === 0 && !room.waypoint);
  // Every room takes exactly one `buildEncounterDataForChallengeLevel:` call, and that call yields
  // *either* the next authored fixed entry or a freshly rolled ordinary pack — never both.  A floor
  // therefore holds `numberOfMonsterPacksToAddWithRoomCount:` encounters in total, and because
  // `fixedEncounterIndex` advances once per slot and is never rewound, only the first `packs`
  // authored entries are ever tested at all.
  const packs = Math.max(0, dungeonRoundf(available.length * populator.density));
  const state: EncounterBuildState = { fixedIndex: 0, ordinaryIndex: 0 };
  for (let slot = 0; slot < packs && available.length > 0; slot++) {
    // `objectAtIndex:(arc4random % count)` then `removeObject:`, drawn before the encounter itself.
    const room = available.splice(rng.intBelow(available.length), 1)[0]!;
    const encounter = buildEncounterData(
      state, populator, floor, challenge, rng, context, diagnostics,
    );
    if (encounter !== undefined) room.encounter = encounter;
  }
}

interface EncounterBuildState {
  fixedIndex: number;
  ordinaryIndex: number;
}






function buildEncounterData(
  state: EncounterBuildState,
  populator: DungeonMonsterPopulator,
  floor: number,
  challenge: number,
  rng: Rng,
  context: DungeonGenerationContext,
  diagnostics: DungeonDiagnostic[],
): DungeonEncounter | undefined {
  const accepted = nextFixedEncounter(state, populator, floor, rng, context);
  if (accepted !== undefined) {
    const { fixed, completionKey } = accepted;
    const monsters = Object.freeze(fixed.monsters.map((spec) => Object.freeze({
      type: resolveMonsterType(spec.type, context.monsterTypes, rng),
      level: dungeonFixedMonsterLevel(challenge, populator.levelScalor, spec.levelScalor),
      ...(spec.extraLivingArguments === undefined ? {} : {
        extraLivingArguments: cloneJsonSafeRecord(
          spec.extraLivingArguments,
          `Dungeon fixed encounter ${fixed.sourceIndex} extraLivingArguments`,
        ),
      }),
    })));
    const treasure = fixed.treasureData === undefined
      ? undefined
      : generateTreasure(
        `treasure-fixed-${fixed.sourceIndex}`,
        fixed.treasureData,
        challenge,
        monsters.reduce((sum, monster) => sum + monster.level, 0),
        true,
        rng,
        diagnostics,
      );

    if (monsters.length > 0 || (treasure !== undefined && treasure.loot.length > 0)) {
      return Object.freeze({
        id: `encounter-fixed-${fixed.sourceIndex}`,
        kind: "fixed",
        monsters,
        ...(completionKey === undefined ? {} : { completionKey }),
        ...(fixed.questKey === undefined ? {} : { questKey: fixed.questKey }),
        ...(fixed.battleRewardKey === undefined ? {} : { battleRewardKey: fixed.battleRewardKey }),
        ...(fixed.achievement === undefined ? {} : { achievement: fixed.achievement }),
        ...(fixed.startEvent === undefined ? {} : {
          startEvent: cloneJsonSafeValue(
            fixed.startEvent,
            `Dungeon fixed encounter ${fixed.sourceIndex} startEvent`,
          ) as DungeonOpaqueEvent,
        }),
        ...(fixed.winEvent === undefined ? {} : {
          winEvent: cloneJsonSafeValue(
            fixed.winEvent,
            `Dungeon fixed encounter ${fixed.sourceIndex} winEvent`,
          ) as DungeonOpaqueEvent,
        }),
        ...(fixed.breeder === undefined ? {} : {
          breeder: cloneJsonSafeValue(
            fixed.breeder,
            `Dungeon fixed encounter ${fixed.sourceIndex} breeder`,
          ) as DungeonBreederSpec,
        }),






        ...(treasure === undefined || treasure.loot.length === 0 ? {} : { treasure }),
      });
    }
  }
  if (populator.types.length === 0) return undefined;

  const count = populator.maxMonstersPerPack > populator.minMonstersPerPack
    ? populator.minMonstersPerPack +
      rng.intBelow(populator.maxMonstersPerPack + 1 - populator.minMonstersPerPack)
    : populator.minMonstersPerPack;
  if (count < 1) return undefined;
  const monsters: DungeonMonster[] = [];
  for (let index = 0; index < count; index++) {
    const weighted = context.legacyDungeonGenerationSemantics === true
      ? legacyWeightedMonsterType(populator.types, rng)
      : dungeonWeightedMonsterType(populator.types, rng);
    monsters.push(Object.freeze({
      type: resolveMonsterType(weighted, context.monsterTypes, rng),
      level: monsterLevel(challenge, populator.levelScalor, 1, rng),
    }));
  }
  return Object.freeze({
    id: `encounter-pack-${state.ordinaryIndex++}`,
    kind: "ordinary",
    monsters: Object.freeze(monsters),
  });
}






function nextFixedEncounter(
  state: EncounterBuildState,
  populator: DungeonMonsterPopulator,
  floor: number,
  rng: Rng,
  context: DungeonGenerationContext,
): { fixed: DungeonFixedEncounter; completionKey: string | undefined } | undefined {
  if (state.fixedIndex >= populator.fixedEncounters.length) return undefined;
  const fixedIndex = state.fixedIndex++;
  const fixed = populator.fixedEncounters[fixedIndex]!;
  const completionKey = fixedCompletionKey(fixed, floor);
  const override = context.fixedEncounterGateOverrides?.find((entry) => entry.fixedIndex === fixedIndex);
  const eligible = override === undefined
    ? !(
        (completionKey !== undefined && context.isCompletionSet?.(completionKey) === true) ||
        (fixed.questKey !== undefined && context.isQuestUsable?.(fixed.questKey) === false)
      )
    : override.eligible;
  context.onFixedEncounterGateEvaluated?.(fixedIndex, eligible);
  if (!eligible) return undefined;
  if (!rng.chance(fixed.chanceToAppear)) return undefined;
  if (!fixedEncounterMatchesFloor(fixed, floor)) return undefined;
  return { fixed, completionKey };
}







function fixedCompletionKey(fixed: DungeonFixedEncounter, floor: number): string | undefined {
  if (fixed.uniqueKey === undefined) return undefined;
  if (fixed.everyXFloors === undefined || fixed.everyXFloors === 0) return fixed.uniqueKey;
  return `${fixed.uniqueKey}${Math.trunc((floor - fixed.exactFloor) / fixed.everyXFloors)}`;
}

/**
 * `exactFloor == 0` is unrestricted; otherwise the floor must match exactly, or fall on the
 * `everyXFloors` cadence.  The native test is a bare `___modsi3` with no lower bound — a cadence
 * entry below its own `exactFloor` is unreachable in the shipped corpus (the earliest floor keyed
 * to `Dungeon_15`/`Dungeon_15b`'s populator is 99/211 against `exactFloor` 100/220, and neither
 * negative delta divides 10), so no invented `floor >= exactFloor` guard belongs here.
 */
function fixedEncounterMatchesFloor(fixed: DungeonFixedEncounter, floor: number): boolean {
  if (fixed.exactFloor === 0 || fixed.exactFloor === floor) return true;
  if (fixed.everyXFloors === undefined || fixed.everyXFloors === 0) return false;
  return (floor - fixed.exactFloor) % fixed.everyXFloors === 0;
}






export function dungeonWeightedMonsterType(
  types: DungeonMonsterPopulator["types"],
  rng: Rng,
): string {
  const total = types.reduce((sum, entry) => sum + entry.chance, 0);
  let roll = rng.intBelow(total);
  for (const entry of types) {
    if (roll < entry.chance) return entry.type;
    roll -= entry.chance;
  }
  return types[types.length - 1]!.type;
}

function legacyWeightedMonsterType(
  types: DungeonMonsterPopulator["types"],
  rng: Rng,
): string {
  const total = types.reduce((sum, entry) => sum + entry.chance, 0);
  let roll = rng.next() * total;
  for (const entry of types) {
    roll -= entry.chance;
    if (roll < 0) return entry.type;
  }
  return types[types.length - 1]!.type;
}

function resolveMonsterType(type: string, catalog: readonly string[], rng: Rng): string {
  return type === "Any" || type === "Random" ? catalog[rng.intBelow(catalog.length)]! : type;
}

function monsterLevel(
  challenge: number,
  populatorScalor: number,
  monsterScalor: number,
  rng: Rng,
): number {
  // DefaultMonsterPopulator computes a float32-scaled base, then applies the same ±10% integer
  // variance gate used by world encounters.  The upper endpoint is exclusive in the binary.
  const base = Math.max(1, Math.trunc(Math.fround(
    Math.fround(Math.fround(challenge) * Math.fround(populatorScalor)) * Math.fround(monsterScalor),
  )));
  const variance = dungeonRoundf(Math.fround(Math.fround(base) * Math.fround(0.1)));
  return variance >= 2 ? Math.max(1, base - variance + rng.intBelow(variance * 2)) : base;
}

export function dungeonFixedMonsterLevel(
  challenge: number,
  populatorScalor: number,
  monsterScalor: number,
): number {
  return Math.max(1, Math.trunc(Math.fround(
    Math.fround(Math.fround(challenge) * Math.fround(populatorScalor)) *
      Math.fround(monsterScalor),
  )));
}

function populateTreasure(
  rooms: MutableRoom[],
  chance: number,
  data: DungeonTreasureData,
  challenge: number,
  rng: Rng,
  diagnostics: DungeonDiagnostic[],
): void {
  let index = 0;
  for (const room of rooms) {




    if (room.width === 1 || room.height === 1 || room.zones.length > 0 || room.waypoint) continue;




    if (room.encounter?.treasure !== undefined) continue;
    const guarded = room.encounter !== undefined;
    if (!guarded && !rng.chance(chance)) continue;
    const monsterLevelSum = room.encounter?.monsters.reduce((sum, monster) => sum + monster.level, 0) ?? 0;
    const treasure = generateTreasure(
      `treasure-random-${index++}`,
      data,
      challenge,
      monsterLevelSum,
      guarded,
      rng,
      diagnostics,
    );
    if (treasure.loot.length === 0) continue;
    if (room.encounter !== undefined) {
      room.encounter = Object.freeze({ ...room.encounter, treasure });
    } else {
      room.treasure = treasure;
    }
  }
}

function generateTreasure(
  id: string,
  data: DungeonTreasureData,
  challenge: number,
  monsterLevelSum: number,
  guarded: boolean,
  rng: Rng,
  diagnostics: DungeonDiagnostic[],
  defaultSpawnChanceOverride?: number,
): DungeonTreasure {
  const effectiveLevel = dungeonTreasureChallengeLevel(
    challenge,
    data.levelScalor,
    data.challengeLevelOverride,
  );


  const adjustment = data.challengeLevelOverride === undefined
    ? Math.fround(monsterLevelSum / (2 * effectiveLevel))
    : 0;
  const loot: DungeonLoot[] = [];
  for (const spawn of data.items) {
    const chance = dungeonTreasureSpawnChance(data, spawn, defaultSpawnChanceOverride);
    if (!rng.chance(chance)) continue;
    loot.push(spawnLoot(spawn, effectiveLevel, adjustment, rng, diagnostics));
  }
  return Object.freeze({ id, guarded, loot: Object.freeze(loot) });
}

/** Effective per-item chance used by every TreasureData generation path. */
export function dungeonTreasureSpawnChance(
  data: DungeonTreasureData,
  spawn: DungeonTreasureSpawn,
  defaultSpawnChanceOverride?: number,
): number {
  return spawn.chance ?? defaultSpawnChanceOverride ?? data.defaultSpawnChance ?? 0.25;
}

/**
 * Shared `TreasureData` path used by fixed world encounters. Unlike quest rewards, authored
 * fixed treasure keeps its normal per-entry/default spawn chances and includes the fighting
 * monsters in the source's guarded-treasure level adjustment.
 */
export function generateFixedEncounterRewards(
  data: DungeonTreasureData,
  challengeLevel: number,
  monsterLevelSum: number,
  rng: Rng,
): readonly PlayerReward[] {
  return generateTreasure(
    "fixed-encounter-reward",
    data,
    challengeLevel,
    monsterLevelSum,
    true,
    rng,
    [],
  ).loot;
}





export function generateQuestRewards(
  data: DungeonTreasureData,
  challengeLevel: number,
  rng: Rng,
): readonly PlayerReward[] {
  return generateTreasure(
    "quest-reward",
    data,
    challengeLevel,
    0,
    false,
    rng,
    [],
    1,
  ).loot;
}

/** Float32 multiply + truncation used before TreasureData dispatch; a non-zero override replaces
 * the scaled value after the source's minimum-one clamp. */
export function dungeonTreasureChallengeLevel(
  challenge: number,
  levelScalor: number,
  challengeLevelOverride: number | undefined,
): number {
  const scaled = Math.max(1, Math.trunc(Math.fround(
    Math.fround(challenge) * Math.fround(levelScalor),
  )));
  return challengeLevelOverride === undefined
    ? scaled
    : Math.max(1, Math.trunc(challengeLevelOverride));
}


export function dungeonAdjustedTreasureLevel(level: number, adjustment: number): number {
  const x = Math.fround(level);
  const y = Math.fround(adjustment);
  const adjusted = y < 0
    ? Math.fround(x / Math.fround(1 - y))
    : Math.fround(x * Math.fround(1 + y));
  return Math.max(1, Math.trunc(adjusted));
}


export function dungeonSilverQuantityForLevel(level: number, rng: Rng): number {
  const sourceLevel = Math.max(1, Math.trunc(level));
  const base = Math.max(1, Math.trunc(Math.pow(
    Math.fround(Math.fround(sourceLevel) * Math.fround(30)),
    0.800000011920929,
  )));
  // The binary converts arc4random to float32 and multiplies by 2^-32 before applying the
  // [0.9, 1.1) spread. Math.fround preserves that precision boundary for injected RNGs.
  const unit = Math.fround(rng.next());
  const low = Math.fround(Math.fround(base) * Math.fround(0.8999999761581421));
  const spread = Math.fround(
    Math.fround(base) * Math.fround(Math.fround(unit) * Math.fround(0.20000000298023224)),
  );
  return Math.trunc(Math.fround(low + spread));
}


export function dungeonGoldQuantityForLevel(level: number): number {
  return Math.min(20, Math.max(1, Math.trunc(level / 20)));
}

export type DungeonRandomTreasureKind = "gold" | "silver" | "gem";

/** Native WeightedRandomList insertion order: Gold(1), Silver(15), Gem(1). */
export function dungeonRandomTreasureKind(rng: Rng): DungeonRandomTreasureKind {
  const roll = rng.intBelow(17);
  return roll === 0 ? "gold" : roll <= 15 ? "silver" : "gem";
}

export function dungeonGemSlotWeights(level: number): readonly number[] {
  const sourceLevel = Math.max(1, Math.trunc(level));
  return Object.freeze([
    30,
    sourceLevel >= 21 ? Math.trunc(sourceLevel / 5) + 1 : 0,
    sourceLevel >= 41 ? Math.trunc(sourceLevel / 7) + 1 : 0,
    sourceLevel >= 61 ? Math.trunc(sourceLevel / 9) + 1 : 0,
  ]);
}

const DUNGEON_GEM_STAT_WEIGHTS = Object.freeze([100, 30, 20, 10, 30, 20] as const);



export function dungeonRandomGemStats(
  quality: DungeonGemQuality,
  rng: Rng,
): readonly DungeonGemStat[] {
  const enabled: DungeonGemStat[] = [];
  const total = DUNGEON_GEM_STAT_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  for (let draw = 0; draw < quality + 1; draw++) {
    let roll = rng.intBelow(total);
    let statIndex = 0;
    for (let index = 0; index < DUNGEON_GEM_STAT_WEIGHTS.length; index++) {
      roll -= DUNGEON_GEM_STAT_WEIGHTS[index]!;
      if (roll < 0) {
        statIndex = index;
        break;
      }
    }
    if (enabled.includes(DUNGEON_GEM_STATS[statIndex]!)) {
      statIndex = (statIndex + 1) % DUNGEON_GEM_STATS.length;
    }
    enabled.push(DUNGEON_GEM_STATS[statIndex]!);
  }
  return Object.freeze(enabled);
}

/** Enabled generated-Gem bonus: float32(level * stat weight). */
export function dungeonGemBonusForStat(
  gem: Pick<DungeonGemLoot, "level" | "enabledStats">,
  stat: DungeonGemStat,
): number {
  if (!gem.enabledStats.includes(stat)) return 0;
  const weight = stat === "Defense" || stat === "Resist" ? 1.5 : 1;
  return Math.fround(Math.fround(gem.level) * Math.fround(weight));
}

/** Gem art/localization tier: `min(6, trunc(level / 12) + 1)`. */
export function dungeonGemItemTier(level: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.trunc(Math.max(1, level) / 12) + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

export interface DungeonGemPresentationProjection {
  readonly level: number;
  readonly tier: 1 | 2 | 3 | 4 | 5 | 6;
  readonly maxSlot: DungeonGemSlot;
}

/** Reachable quest-loot Gem art for `generateQuestRewards(data, 1, rng)`. This is a read-only
 * projection: it deliberately performs no RNG draw, while retaining the random/randomGem branch
 * identity that determines whether this Gem path is reachable. */
export function dungeonGemPresentationProjection(
  data: Pick<DungeonTreasureData, "levelScalor" | "challengeLevelOverride">,
  spawn: Extract<DungeonTreasureSpawn, { readonly kind: "random" | "randomGem" }>,
): DungeonGemPresentationProjection {
  const effectiveLevel = dungeonTreasureChallengeLevel(
    1,
    data.levelScalor,
    data.challengeLevelOverride,
  );
  const level = dungeonGemLevelForTreasure(effectiveLevel, spawn.levelScalor, 0);
  const weights = dungeonGemSlotWeights(level);
  let maxSlot: DungeonGemSlot = 0;
  for (let index = 0; index < weights.length; index++) {
    if (weights[index]! > 0) maxSlot = index as DungeonGemSlot;
  }
  return Object.freeze({ level, tier: dungeonGemItemTier(level), maxSlot });
}


export function dungeonRandomGemForLevel(level: number, rng: Rng): DungeonGemLoot {
  const sourceLevel = Math.max(1, Math.trunc(level));
  const quality: DungeonGemQuality = rng.intBelow(100) > 95 ? 1 : 0;
  const weights = dungeonGemSlotWeights(sourceLevel);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let roll = rng.intBelow(total);
  let slot: DungeonGemSlot = 0;
  for (let index = 0; index < weights.length; index++) {
    roll -= weights[index]!;
    if (roll < 0) {
      slot = index as DungeonGemSlot;
      break;
    }
  }
  const enabledStats = dungeonRandomGemStats(quality, rng);
  return Object.freeze({ kind: "gem", level: sourceLevel, quality, slot, enabledStats });
}

function spawnLoot(
  spawn: DungeonTreasureSpawn,
  effectiveLevel: number,
  adjustment: number,
  rng: Rng,
  diagnostics: DungeonDiagnostic[],
): DungeonLoot {
  switch (spawn.kind) {
    case "silver":
      return Object.freeze({
        kind: "silver",
        amount: dungeonSilverQuantityForLevel(
          dungeonAdjustedTreasureLevel(effectiveLevel, adjustment),
          rng,
        ),
      });
    case "gold":
      return Object.freeze({ kind: "gold", amount: dungeonGoldQuantityForLevel(effectiveLevel) });
    case "random": {
      // Native insertion order is Gold(1), Silver(15), Gem(1), then integer-modulo weighted pick.
      const selected = dungeonRandomTreasureKind(rng);
      if (selected === "gold") {
        return Object.freeze({ kind: "gold", amount: dungeonGoldQuantityForLevel(effectiveLevel) });
      }
      if (selected === "silver") {
        return Object.freeze({
          kind: "silver",
          amount: dungeonSilverQuantityForLevel(
            dungeonAdjustedTreasureLevel(effectiveLevel, adjustment),
            rng,
          ),
        });
      }
      return generatedGem(spawn, effectiveLevel, adjustment, rng, diagnostics);
    }
    case "randomGem":
      // WeightedRandomList still performs `arc4random() % 1` for its sole Gem entry.
      rng.intBelow(1);
      return generatedGem(spawn, effectiveLevel, adjustment, rng, diagnostics);
    case "fixed": return fixedLoot(spawn.data);
  }
}

function generatedGem(
  spawn: Extract<DungeonTreasureSpawn, { readonly kind: "random" | "randomGem" }>,
  effectiveLevel: number,
  adjustment: number,
  rng: Rng,
  diagnostics: DungeonDiagnostic[],
): DungeonGemLoot {
  const level = dungeonGemLevelForTreasure(effectiveLevel, spawn.levelScalor, adjustment);
  return dungeonRandomGemForLevel(level, rng);
}

function dungeonGemLevelForTreasure(
  effectiveLevel: number,
  levelScalor: number,
  adjustment: number,
): number {
  const scaled = Math.fround(
    Math.fround(effectiveLevel) * Math.fround(levelScalor),
  );
  return dungeonAdjustedTreasureLevel(scaled, adjustment);
}

function fixedLoot(data: DungeonFixedItemData): DungeonLoot {
  switch (data.kind) {
    case "spiritTotem": return Object.freeze({ kind: "spiritTotem", shortType: data.shortType });
    case "recipe": return Object.freeze({ kind: "recipe", combineName: data.combineName });
    case "egg": return Object.freeze({ kind: "egg" });
    case "monsterEgg": return Object.freeze({ kind: "monsterEgg" });
    case "repeatEgg":
      return Object.freeze({
        kind: "repeatEgg",
        definitionPath: data.definitionPath,
        instanceName: data.instanceName,
        numRepeats: data.numRepeats,
      });
    case "usable":
      return Object.freeze({
        kind: "usable",
        definitionPath: data.definitionPath,
        instanceName: data.instanceName,
        level: data.level,
      });
    case "monsterJoin":
      return Object.freeze({
        kind: "monsterJoin",
        shortType: data.shortType,
        jobLevel: data.jobLevel,
      });
  }
}

function addDiagnosticOnce(diagnostics: DungeonDiagnostic[], diagnostic: DungeonDiagnostic): void {
  if (!diagnostics.some((entry) => entry.code === diagnostic.code)) diagnostics.push(diagnostic);
}

function freezeFloor(floor: MutableFloor): DungeonFloor {
  return Object.freeze({
    definitionId: floor.definitionId,
    floor: floor.floor,
    seed: floor.seed,
    challengeLevel: floor.challengeLevel,
    startRoomId: floor.startRoomId,
    currentRoomId: floor.currentRoomId,
    rooms: Object.freeze(floor.rooms.map((room, index) => freezeRoom(room, `Dungeon room[${index}]`))),
    ...(floor.selectedPopulationFloor === undefined ? {} : { selectedPopulationFloor: floor.selectedPopulationFloor }),
    diagnostics: Object.freeze(floor.diagnostics.map((entry, index) =>
      cloneJsonSafeValue(entry, `Dungeon diagnostic[${index}]`) as DungeonDiagnostic)),
  });
}

function freezeRoom(room: MutableRoom, label = "Dungeon room"): DungeonRoom {
  const copied = cloneRoomGraph(room, label);
  return Object.freeze({
    ...copied,
    links: Object.freeze(copied.links),
    zones: Object.freeze(copied.zones),
  });
}

function cloneRoomGraph(room: MutableRoom | DungeonRoom, label: string): MutableRoom {
  return {
    id: room.id,
    sourceIndex: room.sourceIndex,
    templateKey: room.templateKey,
    x: room.x,
    y: room.y,
    width: room.width,
    height: room.height,
    rotation: room.rotation,
    links: room.links.map((link, index) =>
      cloneJsonSafeValue(link, `${label}.links[${index}]`) as DungeonRoomLink),
    zones: room.zones.map((zone, index) =>
      cloneJsonSafeValue(zone, `${label}.zones[${index}]`) as DungeonPlacedZone),
    waypoint: room.waypoint,
    explored: room.explored,
    ...(room.encounter === undefined ? {} : {
      encounter: cloneJsonSafeValue(room.encounter, `${label}.encounter`) as DungeonEncounter,
    }),
    ...(room.treasure === undefined ? {} : {
      treasure: cloneJsonSafeValue(room.treasure, `${label}.treasure`) as DungeonTreasure,
    }),
  };
}

/** Mutable runtime over one generated floor; state snapshots regenerate geometry from seed. */
export class DungeonSession {
  readonly definition: DungeonDefinition;
  readonly context: DungeonGenerationContext;
  /**
   * The runtime uses the provider's definition object only as an ownership token when restoring
   * an outgoing scene. It is never used as session data; all data reads use the cloned definition.
   */
  private readonly definitionIdentity: DungeonDefinition;
  private floor: MutableFloor;
  private previousRoomId: string | undefined;
  private readonly clearedEncounterIds = new Set<string>();
  private readonly collectedTreasureIds = new Set<string>();
  private readonly registeredWaypointFloors = new Set<number>();
  private readonly completedKeys = new Set<string>();
  private readonly catchTypes = new Set<string>();
  private readonly encounterRosters = new Map<string, {
    readonly terminalFlowId?: string;
    readonly monsters: readonly DungeonMonster[];
  }>();
  private readonly authoredEncounterRosters = new Map<string, readonly DungeonMonster[]>();
  private readonly generationGateDecisions: readonly DungeonFixedEncounterGateSnapshot[];
  private catchRewardCollected = false;

  private constructor(
    definition: DungeonDefinition,
    context: DungeonGenerationContext,
    floor: DungeonFloor,
    generationGateDecisions: readonly DungeonFixedEncounterGateSnapshot[],
    definitionIdentity: DungeonDefinition,
  ) {
    this.definitionIdentity = definitionIdentity;
    this.definition = cloneJsonSafeValue(definition, "Dungeon definition") as DungeonDefinition;
    const fixedEncounterGateOverrides = context.fixedEncounterGateOverrides === undefined
      ? undefined
      : cloneJsonSafeValue(
          context.fixedEncounterGateOverrides,
          "Dungeon generation fixedEncounterGateOverrides",
        ) as readonly DungeonFixedEncounterGateSnapshot[];
    this.context = Object.freeze({
      ...context,
      monsterTypes: Object.freeze([...context.monsterTypes]),
      ...(fixedEncounterGateOverrides === undefined ? {} : { fixedEncounterGateOverrides }),
    });
    this.floor = thawFloor(floor);
    this.generationGateDecisions = Object.freeze(generationGateDecisions.map((entry) =>
      Object.freeze({ fixedIndex: entry.fixedIndex, eligible: entry.eligible })));
    for (const room of this.floor.rooms) {
      if (room.encounter !== undefined) {
        this.authoredEncounterRosters.set(room.encounter.id, room.encounter.monsters);
      }
    }
  }

  static create(
    definition: DungeonDefinition,
    floor: number,
    seed: number,
    context: DungeonGenerationContext,
  ): DungeonSession {
    const generationGateDecisions: DungeonFixedEncounterGateSnapshot[] = [];
    const generated = generateDungeonFloor(definition, floor, seed, {
      ...context,
      onFixedEncounterGateEvaluated: (fixedIndex, eligible) => {
        generationGateDecisions.push({ fixedIndex, eligible });
      },
    });
    return new DungeonSession(definition, context, generated, generationGateDecisions, definition);
  }

  static restore(
    definition: DungeonDefinition,
    snapshot: DungeonFloorSnapshot,
    context: DungeonGenerationContext,
  ): DungeonSession {
    assertJsonSafeTree(snapshot, "Dungeon snapshot");
    assertExactObjectKeys(snapshot, [
      "schemaVersion", "definitionId", "floor", "seed", "currentRoomId", "previousRoomId",
      "exploredRoomIds", "clearedEncounterIds", "collectedTreasureIds", "registeredWaypointFloors",
      "completedKeys", "catchTypes", "catchRewardCollected", "encounterRosters", "generationGateDecisions",
    ], "Dungeon snapshot");
    if (snapshot.schemaVersion !== 1) throw new Error(`Unsupported dungeon snapshot ${snapshot.schemaVersion}`);
    if (snapshot.definitionId !== dungeonDefinitionId(definition)) {
      throw new DungeonSnapshotCompatibilityError("Dungeon snapshot definition mismatch");
    }
    const generationGateDecisions = snapshot.generationGateDecisions === undefined
      ? undefined
      : normalizeGenerationGateDecisions(snapshot.generationGateDecisions, "Dungeon snapshot generationGateDecisions");
    const session = DungeonSession.create(definition, snapshot.floor, snapshot.seed, {
      ...context,
      ...(generationGateDecisions === undefined
        ? {}
        : { fixedEncounterGateOverrides: generationGateDecisions }),
    });
    if (
      generationGateDecisions !== undefined &&
      !equalGenerationGateDecisions(session.generationGateDecisions, generationGateDecisions)
    ) {
      throw new DungeonSnapshotCompatibilityError(
        "Dungeon snapshot generation gate decisions disagree with generated floor",
      );
    }
    const roomIds = new Set(session.floor.rooms.map((room) => room.id));
    const encounterIds = new Set(session.floor.rooms.flatMap((room) =>
      room.encounter === undefined ? [] : [room.encounter.id]));
    const treasureIds = new Set(session.floor.rooms.flatMap((room) => {
      const result: string[] = [];
      if (room.encounter?.treasure !== undefined) result.push(room.encounter.treasure.id);
      if (room.treasure !== undefined) result.push(room.treasure.id);
      return result;
    }));
    if (!roomIds.has(snapshot.currentRoomId)) {
      throw new DungeonSnapshotCompatibilityError("Dungeon snapshot current room is missing");
    }
    session.floor.currentRoomId = snapshot.currentRoomId;
    for (const id of snapshot.exploredRoomIds) {
      if (!roomIds.has(id)) {
        throw new DungeonSnapshotCompatibilityError(`Dungeon snapshot explored room ${id} is missing`);
      }
      session.requireRoom(id).explored = true;
    }
    if (snapshot.previousRoomId !== undefined) {
      if (!roomIds.has(snapshot.previousRoomId)) {
        throw new DungeonSnapshotCompatibilityError(
          `Dungeon snapshot previous room ${snapshot.previousRoomId} is missing`,
        );
      }
      if (snapshot.previousRoomId === snapshot.currentRoomId) {
        throw new Error("Dungeon snapshot previous room must differ from current room");
      }
      if (!session.requireRoom(snapshot.previousRoomId).explored) {
        throw new Error(`Dungeon snapshot previous room ${snapshot.previousRoomId} is not explored`);
      }
      session.previousRoomId = snapshot.previousRoomId;
    }
    for (const id of snapshot.clearedEncounterIds) {
      if (!encounterIds.has(id)) {
        throw new DungeonSnapshotCompatibilityError(`Dungeon snapshot encounter ${id} is missing`);
      }
      session.clearedEncounterIds.add(id);
    }
    // New-format snapshots have an explicit roster lifecycle. Preserve the source's zero-member
    // cleared room on restore; omission remains the legacy schema-1 migration path.
    if (Object.prototype.hasOwnProperty.call(snapshot, "encounterRosters")) {
      for (const id of session.clearedEncounterIds) {
        const room = session.floor.rooms.find((entry) => entry.encounter?.id === id);
        if (room?.encounter !== undefined) {
          room.encounter = Object.freeze({ ...room.encounter, monsters: Object.freeze([]) });
        }
      }
    }
    for (const id of snapshot.collectedTreasureIds) {
      if (!treasureIds.has(id)) {
        throw new DungeonSnapshotCompatibilityError(`Dungeon snapshot treasure ${id} is missing`);
      }
      session.collectedTreasureIds.add(id);
    }
    for (const value of snapshot.registeredWaypointFloors) {
      assertPositiveInteger(value, "registered waypoint floor");
      session.registeredWaypointFloors.add(value);
    }
    for (const key of snapshot.completedKeys) {
      if (key.length === 0) throw new Error("Dungeon snapshot completion key must not be empty");
      session.completedKeys.add(key);
    }
    for (const type of snapshot.catchTypes) {
      if (type.length === 0) throw new Error("Dungeon snapshot catch type must not be empty");
      session.catchTypes.add(type);
    }
    if (typeof snapshot.catchRewardCollected !== "boolean") {
      throw new Error("Dungeon snapshot catchRewardCollected must be boolean");
    }
    session.catchRewardCollected = snapshot.catchRewardCollected;
    if (snapshot.encounterRosters !== undefined) {
      assertOrdinaryArray(snapshot.encounterRosters, "Dungeon snapshot encounterRosters");
    }
    for (const roster of snapshot.encounterRosters ?? []) {
      assertExactObjectKeys(roster, ["encounterId", "monsters", "terminalFlowId"], "Dungeon snapshot encounter roster");
      if (!encounterIds.has(roster.encounterId)) {
        throw new DungeonSnapshotCompatibilityError(
          `Dungeon snapshot encounter ${roster.encounterId} is missing`,
        );
      }
      if (session.encounterRosters.has(roster.encounterId)) {
        throw new Error(`Dungeon snapshot encounter ${roster.encounterId} roster is duplicated`);
      }
      const room = session.floor.rooms.find((entry) => entry.encounter?.id === roster.encounterId)!;
      if (!room.explored) {
        throw new Error(`Dungeon snapshot encounter ${roster.encounterId} is unexplored`);
      }
      if (session.clearedEncounterIds.has(roster.encounterId)) {
        throw new Error(`Dungeon snapshot encounter ${roster.encounterId} is cleared`);
      }
      const monsters = Object.freeze(roster.monsters.map((monster, index) =>
        normalizeDungeonMonster(monster, `Dungeon snapshot encounter ${roster.encounterId} roster[${index}]`)));
      if (roster.terminalFlowId !== undefined) {
        assertNonemptyString(roster.terminalFlowId, "Dungeon snapshot terminal flow id");
      }
      const authored = session.authoredEncounterRosters.get(roster.encounterId);
      if (authored === undefined || !isOrderedDungeonMonsterSubsequence(monsters, authored)) {
        throw new DungeonSnapshotCompatibilityError(
          `Dungeon snapshot encounter ${roster.encounterId} roster is not an ordered subsequence`,
        );
      }
      const encounter = room.encounter;
      if (encounter === undefined) {
        throw new DungeonSnapshotCompatibilityError(
          `Dungeon snapshot encounter ${roster.encounterId} is missing`,
        );
      }
      room.encounter = Object.freeze({ ...encounter, monsters });
      session.encounterRosters.set(roster.encounterId, Object.freeze({
        ...(roster.terminalFlowId === undefined ? {} : { terminalFlowId: roster.terminalFlowId }),
        monsters,
      }));
    }
    return session;
  }



  fork(): DungeonSession {
    const fork = new DungeonSession(
      this.definition,
      this.context,
      thawFloor(this.floor),
      this.generationGateDecisions,
      this.definitionIdentity,
    );
    fork.previousRoomId = this.previousRoomId;
    fork.clearedEncounterIds.clear();
    for (const id of this.clearedEncounterIds) fork.clearedEncounterIds.add(id);
    fork.collectedTreasureIds.clear();
    for (const id of this.collectedTreasureIds) fork.collectedTreasureIds.add(id);
    fork.registeredWaypointFloors.clear();
    for (const floor of this.registeredWaypointFloors) fork.registeredWaypointFloors.add(floor);
    fork.completedKeys.clear();
    for (const key of this.completedKeys) fork.completedKeys.add(key);
    fork.catchTypes.clear();
    for (const type of this.catchTypes) fork.catchTypes.add(type);
    fork.encounterRosters.clear();
    for (const [id, roster] of this.encounterRosters) {
      fork.encounterRosters.set(id, Object.freeze({
        ...(roster.terminalFlowId === undefined ? {} : { terminalFlowId: roster.terminalFlowId }),
        monsters: cloneMonsterList(roster.monsters, `Dungeon fork roster ${id}`),
      }));
    }
    fork.authoredEncounterRosters.clear();
    for (const [id, roster] of this.authoredEncounterRosters) {
      fork.authoredEncounterRosters.set(id, cloneMonsterList(roster, `Dungeon fork authored roster ${id}`));
    }
    fork.catchRewardCollected = this.catchRewardCollected;
    return fork;
  }

  /** Internal runtime ownership check; the identity is deliberately not part of serialized data. */
  ownsDefinition(definition: DungeonDefinition): boolean {
    return this.definitionIdentity === definition;
  }

  get state(): DungeonFloor { return freezeFloor(this.floor); }
  get currentRoom(): DungeonRoom { return freezeRoom(this.requireRoom(this.floor.currentRoomId)); }

  availableDirections(): readonly DungeonDirection[] {
    const room = this.requireRoom(this.floor.currentRoomId);
    return Object.freeze([...new Set(room.links.map((link) => directionForRoomLink(room, link)))]);
  }

  linkedRoomId(direction: DungeonDirection): string | undefined {
    const room = this.requireRoom(this.floor.currentRoomId);
    return room.links.find((link) => directionForRoomLink(room, link) === direction)?.targetRoomId;
  }

  availableRoomIds(): readonly string[] {
    return this.linkedRoomIds();
  }

  /** Direct graph neighbors, retained for directional controls rather than scene touch gating. */
  linkedRoomIds(): readonly string[] {
    return Object.freeze(this.requireRoom(this.floor.currentRoomId).links.map((link) => link.targetRoomId));
  }

  /**
   * Repositions a restored/generated floor at the named authored exit without consuming the room's
   * entry actions. The owning DungeonNode invokes enterCurrentRoom only after the scene transition
   * has completed, preserving native waypoint -> encounter -> chest ordering on arrival.
   */
  arriveAtZone(instanceName: string): void {
    if (instanceName.length === 0) throw new Error("Dungeon arrival zone must not be empty");
    const room = this.floor.rooms.find((candidate) => candidate.zones.some((zone) =>
      (zone.change.kind === "worldExit" || zone.change.kind === "dungeonExit") &&
      zone.change.instanceName === instanceName));
    if (room === undefined) {
      throw new Error(`Dungeon floor has no arrival zone ${instanceName}`);
    }
    this.previousRoomId = undefined;
    this.floor.currentRoomId = room.id;
  }

  /** Arrives beside the stair opposite the one used on the previous floor. */
  arriveFromStairs(directionTaken: "up" | "down"): void {
    const destinationKind = directionTaken === "down" ? "stairsUp" : "stairsDown";
    const room = this.floor.rooms.find((candidate) =>
      candidate.zones.some((zone) => zone.change.kind === destinationKind));
    if (room === undefined) {
      throw new Error(`Dungeon floor has no ${destinationKind} arrival stair`);
    }
    this.previousRoomId = undefined;
    this.floor.currentRoomId = room.id;
  }

  /** Repositions to this floor's registered waypoint without replaying room actions yet. */
  arriveAtWaypoint(): void {
    const room = this.floor.rooms.find((candidate) => candidate.waypoint);
    if (room === undefined) throw new Error(`Dungeon floor ${this.floor.floor} has no waypoint room`);
    this.previousRoomId = undefined;
    this.floor.currentRoomId = room.id;
  }

  enterCurrentRoom(): readonly DungeonRoomEntryAction[] {
    const room = this.requireRoom(this.floor.currentRoomId);
    room.explored = true;
    this.revealLinkedRoomsWhenClear(room);
    const actions: DungeonRoomEntryAction[] = [];
    if (room.waypoint && !this.registeredWaypointFloors.has(this.floor.floor)) {
      actions.push(Object.freeze({ kind: "waypoint", floor: this.floor.floor, roomId: room.id }));
    }
    if (room.encounter !== undefined && !this.isEncounterResolved(room)) {
      actions.push(Object.freeze({ kind: "encounter", roomId: room.id, encounter: room.encounter }));
    }
    const treasure = this.visibleTreasure(room);
    if (treasure !== undefined) actions.push(Object.freeze({ kind: "treasure", roomId: room.id, treasure }));
    return Object.freeze(actions);
  }

  move(direction: DungeonDirection): DungeonMoveResult {
    const from = this.requireRoom(this.floor.currentRoomId);
    const link = from.links.find((candidate) => directionForRoomLink(from, candidate) === direction);
    if (link === undefined) throw new Error(`No ${direction} link from ${from.id}`);
    return this.moveToRoom(link.targetRoomId);
  }

  moveToRoom(targetRoomId: string): DungeonMoveResult {
    const from = this.requireRoom(this.floor.currentRoomId);
    const link = from.links.find((candidate) => candidate.targetRoomId === targetRoomId);
    if (link === undefined) throw new Error(`Room ${targetRoomId} is not linked from ${from.id}`);
    const to = this.requireRoom(link.targetRoomId);
    this.previousRoomId = from.id;
    this.floor.currentRoomId = to.id;
    return Object.freeze({
      fromRoomId: from.id,
      toRoomId: to.id,
      direction: directionForRoomLink(from, link),
      actions: this.enterCurrentRoom(),
    });
  }







  selectMaterializedRoom(targetRoomId: string): DungeonRoomSelectionResult {
    const from = this.requireRoom(this.floor.currentRoomId);
    const to = this.requireRoom(targetRoomId);
    if (!to.explored) throw new Error(`Room ${targetRoomId} is not materialized`);
    if (to.id === from.id) {
      return Object.freeze({ kind: "same-room", roomId: to.id });
    }

    const reciprocal = to.links.find((link) => link.targetRoomId === from.id);
    this.previousRoomId = from.id;
    this.floor.currentRoomId = to.id;
    const actions = this.enterCurrentRoom();
    if (reciprocal === undefined) {
      return Object.freeze({
        kind: "changed-room",
        fromRoomId: from.id,
        toRoomId: to.id,
        transition: "fade-teleport",
        actions,
      });
    }
    return Object.freeze({
      kind: "changed-room",
      fromRoomId: from.id,
      toRoomId: to.id,
      transition: "door-walk",
      direction: oppositeDungeonDirection(directionForRoomLink(to, reciprocal)),
      actions,
    });
  }

  registerWaypoint(): void {
    const room = this.requireRoom(this.floor.currentRoomId);
    if (!room.waypoint) throw new Error("Current room has no waypoint");
    this.registeredWaypointFloors.add(this.floor.floor);
  }

  resolveEncounter(encounterId: string, outcome: "victory" | "defeat" | "retreat"): readonly DungeonRoomEntryAction[] {
    const room = this.floor.rooms.find((entry) => entry.encounter?.id === encounterId);
    if (room === undefined || room.encounter === undefined) throw new Error(`Unknown encounter ${encounterId}`);
    if (outcome === "retreat") {
      if (this.previousRoomId !== undefined) this.floor.currentRoomId = this.previousRoomId;
      this.previousRoomId = undefined;
      return Object.freeze([]);
    }
    if (outcome !== "victory") return Object.freeze([]);
    this.clearedEncounterIds.add(encounterId);
    this.encounterRosters.delete(encounterId);
    room.encounter = Object.freeze({ ...room.encounter, monsters: Object.freeze([]) });
    if (room.id === this.floor.currentRoomId) this.revealLinkedRoomsWhenClear(room);
    if (room.encounter.completionKey !== undefined) this.completedKeys.add(room.encounter.completionKey);
    const treasure = this.visibleTreasure(room);
    return treasure === undefined
      ? Object.freeze([])
      : Object.freeze([{ kind: "treasure", roomId: room.id, treasure } as const]);
  }

  /**
   * Source `Room.updateMonstersForDungeon:` survivor mutation. Battle HP and temporary buffs are
   * deliberately not copied: a dungeon room stores only the monster identity/level arguments,
   * and rebuilding the encounter therefore creates full-HP, buff-free survivors. The terminal
   * flow marker is also persisted in the floor snapshot, including an empty roster when every
   * enemy died or was captured.
   */
  synchronizeEncounterRoomRoster(
    encounterId: string,
    terminalFlowId: string,
    survivingMonsters: readonly DungeonMonster[],
  ): boolean {
    const plan = this.prepareEncounterRoomRoster(encounterId, terminalFlowId, survivingMonsters);
    if (!plan.changed) return false;
    plan.commit();
    return true;
  }

  /** Validate a complete terminal roster update without changing room or snapshot state. */
  prepareEncounterRoomRoster(
    encounterId: string,
    terminalFlowId: string,
    survivingMonsters: readonly DungeonMonster[],
  ): DungeonEncounterRosterUpdatePlan {
    assertNonemptyString(terminalFlowId, `Dungeon encounter ${encounterId} terminal flow id`);
    assertOrdinaryArray(survivingMonsters, `Dungeon encounter ${encounterId} survivors`);
    const room = this.floor.rooms.find((entry) => entry.encounter?.id === encounterId);
    if (room === undefined || room.encounter === undefined) {
      throw new Error(`Unknown encounter ${encounterId}`);
    }
    if (!room.explored) throw new Error(`Dungeon encounter ${encounterId} is unexplored`);
    if (this.clearedEncounterIds.has(encounterId)) {
      throw new Error(`Dungeon encounter ${encounterId} is cleared`);
    }
    const monsters = Object.freeze(survivingMonsters.map((monster, index) =>
      normalizeDungeonMonster(monster, `Dungeon encounter ${encounterId} survivor[${index}]`)));
    const authored = this.authoredEncounterRosters.get(encounterId);
    if (authored === undefined || !isOrderedDungeonMonsterSubsequence(monsters, authored)) {
      throw new Error(`Dungeon encounter ${encounterId} survivor roster is not an ordered subsequence`);
    }
    const previous = this.encounterRosters.get(encounterId);
    if (previous?.terminalFlowId === terminalFlowId) {
      if (!equalDungeonMonsterLists(monsters, previous.monsters)) {
        throw new Error(`Dungeon encounter ${encounterId} terminal flow ${terminalFlowId} conflicts with synchronized state`);
      }
      return Object.freeze({
        changed: false,
        encounterId,
        terminalFlowId,
        monsters: previous.monsters,
        survivingMonsterCountsByRoom: this.survivingMonsterCountsByRoom(),
        nextSnapshot: this.snapshot(),
        commit: () => undefined,
      });
    }
    // A later Save Me/Store flow may only remove members from the currently durable roster. This
    // check is deliberately in addition to the authored-roster check above: it rejects expansion
    // and reordering even when the fabricated tuple happens to exist in the original encounter.
    if (!isOrderedDungeonMonsterSubsequence(monsters, room.encounter.monsters)) {
      throw new Error(`Dungeon encounter ${encounterId} survivor roster is not an ordered subsequence of synchronized state`);
    }
    const nextEntry = Object.freeze({ terminalFlowId, monsters });
    const counts = Object.freeze(this.floor.rooms.map((candidate) =>
      candidate.encounter === undefined || this.isEncounterResolved(candidate)
        ? 0
        : candidate.encounter.id === encounterId
          ? monsters.length
          : candidate.encounter.monsters.length));
    const nextSnapshot = this.snapshotWithEncounterRoster(encounterId, nextEntry);
    return Object.freeze({
      changed: true,
      encounterId,
      terminalFlowId,
      monsters,
      survivingMonsterCountsByRoom: counts,
      nextSnapshot,
      commit: () => {
        const encounter = room.encounter;
        if (encounter === undefined) throw new Error(`Unknown encounter ${encounterId}`);
        room.encounter = Object.freeze({ ...encounter, monsters });
        this.encounterRosters.set(encounterId, nextEntry);
      },
    });
  }

  collectTreasure(treasureId: string): readonly DungeonLoot[] {
    // `LootPageProvider` is mounted by the current RoomNode's visible treasure action. A semantic
    // caller cannot collect a deterministic ID from another/unexplored room or after the current
    // room has hidden an already-collected/guarded chest.
    const room = this.requireRoom(this.floor.currentRoomId);
    const owned = room.encounter?.treasure ?? room.treasure;
    if (owned?.id !== treasureId) {
      throw new Error(`Treasure ${treasureId} is not owned by the current room`);
    }
    const treasure = this.visibleTreasure(room);
    if (treasure?.id !== treasureId) throw new Error(`Treasure ${treasureId} is not available`);
    this.collectedTreasureIds.add(treasureId);
    return treasure.loot;
  }

  recordCapturedMonster(shortType: string): readonly DungeonLoot[] {
    const quest = this.definition.catchQuest;
    if (quest === undefined || !quest.types.includes(shortType) || this.catchRewardCollected) return Object.freeze([]);
    this.catchTypes.add(shortType);
    return Object.freeze([]);
  }

  /**
   * `CatchQuestDisplay` owns reward collection. Completing the required set only makes its chest
   * claimable; capture resolution itself never silently grants the authored treasure.
   */
  claimCatchQuestReward(): readonly DungeonLoot[] {
    const quest = this.definition.catchQuest;
    if (
      quest === undefined ||
      this.catchRewardCollected ||
      !quest.types.every((type) => this.catchTypes.has(type))
    ) {
      return Object.freeze([]);
    }
    const diagnostics = this.floor.diagnostics;


    const reward = generateTreasure(
      "catch-quest-reward",
      quest.treasureData,
      quest.challengeLevel,
      0,
      false,
      mulberry32(this.floor.seed ^ 0xc471c4),
      diagnostics,
      1,
    );
    this.catchRewardCollected = true;
    return reward.loot;
  }

  catchQuestProgress(): DungeonCatchQuestProgress | undefined {
    const quest = this.definition.catchQuest;
    if (quest === undefined) return undefined;
    const captured = quest.types.filter((type) => this.catchTypes.has(type));
    return Object.freeze({
      required: quest.types,
      captured: Object.freeze(captured),
      complete: captured.length === quest.types.length,
      rewardCollected: this.catchRewardCollected,
    });
  }

  activateZone(zoneId: string): DungeonZoneActivation {
    const room = this.requireRoom(this.floor.currentRoomId);
    const zone = room.zones.find((entry) => entry.id === zoneId);
    if (zone === undefined) throw new Error(`Current room has no zone ${zoneId}`);
    const targetFloor = dungeonZoneTargetFloor(zone.change, this.floor.floor);
    const remaining = this.remainingEncounterCount();
    if (this.definition.mustClearFloor && targetFloor !== undefined &&
        targetFloor > this.floor.floor && remaining > 0) {
      return Object.freeze({
        kind: "blocked",
        reason: "mustClearFloor",
        remainingEncounterCount: remaining,
      });
    }
    switch (zone.change.kind) {
      case "stairsUp": return Object.freeze({ kind: "stairs", direction: "up", targetFloor: Math.max(1, this.floor.floor - 1) });
      case "stairsDown": return Object.freeze({ kind: "stairs", direction: "down", targetFloor: this.floor.floor + 1 });
      case "worldExit": return Object.freeze({ kind: "worldExit", change: zone.change });
      case "dungeonExit": return Object.freeze({ kind: "dungeonExit", change: zone.change });
    }
  }

  remainingEncounterCount(): number {
    return this.floor.rooms.reduce((count, room) =>
      count + (room.encounter !== undefined && !this.isEncounterResolved(room) ? 1 : 0), 0);
  }

  /** Source ClearDungeonQuest event projection: cleared rooms have no surviving monsters. */
  survivingMonsterCountsByRoom(): readonly number[] {
    return Object.freeze(this.floor.rooms.map((room) =>
      room.encounter === undefined || this.isEncounterResolved(room)
        ? 0
        : room.encounter.monsters.length));
  }

  snapshot(): DungeonFloorSnapshot {
    return this.snapshotWithEncounterRoster();
  }

  private snapshotWithEncounterRoster(
    replacementEncounterId?: string,
    replacement?: { readonly terminalFlowId: string; readonly monsters: readonly DungeonMonster[] },
  ): DungeonFloorSnapshot {
    const rosters = new Map(this.encounterRosters);
    if (replacementEncounterId !== undefined && replacement !== undefined) {
      rosters.set(replacementEncounterId, replacement);
    }
    return Object.freeze({
      schemaVersion: 1,
      definitionId: this.floor.definitionId,
      floor: this.floor.floor,
      seed: this.floor.seed,
      currentRoomId: this.floor.currentRoomId,
      ...(this.previousRoomId === undefined ? {} : { previousRoomId: this.previousRoomId }),
      exploredRoomIds: Object.freeze(this.floor.rooms.filter((room) => room.explored).map((room) => room.id)),
      clearedEncounterIds: Object.freeze([...this.clearedEncounterIds].sort()),
      collectedTreasureIds: Object.freeze([...this.collectedTreasureIds].sort()),
      registeredWaypointFloors: Object.freeze([...this.registeredWaypointFloors].sort((a, b) => a - b)),
      completedKeys: Object.freeze([...this.completedKeys].sort()),
      catchTypes: Object.freeze([...this.catchTypes].sort()),
      catchRewardCollected: this.catchRewardCollected,
      generationGateDecisions: Object.freeze(this.generationGateDecisions.map((entry) =>
        Object.freeze({ fixedIndex: entry.fixedIndex, eligible: entry.eligible }))),
      encounterRosters: Object.freeze([...rosters.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([encounterId, roster]) => {
          if (this.clearedEncounterIds.has(encounterId)) {
            throw new Error(`Dungeon snapshot encounter ${encounterId} roster conflicts with cleared state`);
          }
          return Object.freeze({
            encounterId,
            monsters: Object.freeze(roster.monsters.map((monster) =>
              normalizeDungeonMonster(monster, "Dungeon snapshot monster"))),
            ...(roster.terminalFlowId === undefined ? {} : { terminalFlowId: roster.terminalFlowId }),
          });
        })),
    });
  }

  private visibleTreasure(room: MutableRoom): DungeonTreasure | undefined {
    const treasure = room.encounter?.treasure ?? room.treasure;
    if (treasure === undefined || this.collectedTreasureIds.has(treasure.id)) return undefined;
    if (treasure.guarded && room.encounter !== undefined && !this.isEncounterResolved(room)) return undefined;
    return treasure;
  }

  isWaypointRegistered(): boolean {
    return this.registeredWaypointFloors.has(this.floor.floor);
  }

  private revealLinkedRoomsWhenClear(room: MutableRoom): void {
    if (room.encounter !== undefined && !this.isEncounterResolved(room)) return;
    for (const link of room.links) this.requireRoom(link.targetRoomId).explored = true;
  }

  private isEncounterResolved(room: Pick<MutableRoom, "encounter">): boolean {
    return room.encounter === undefined ||
      room.encounter.monsters.length === 0 ||
      this.clearedEncounterIds.has(room.encounter.id);
  }

  private requireRoom(id: string): MutableRoom {
    const room = this.floor.rooms.find((entry) => entry.id === id);
    if (room === undefined) throw new Error(`Unknown dungeon room ${id}`);
    return room;
  }
}

function dungeonZoneTargetFloor(change: DungeonZoneChange, currentFloor: number): number | undefined {
  switch (change.kind) {
    case "stairsDown": return currentFloor + 1;
    case "stairsUp": return Math.max(1, currentFloor - 1);
    case "dungeonExit": return change.dungeonLevel;
    case "worldExit": return undefined;
  }
}

function thawFloor(floor: DungeonFloor): MutableFloor {
  return {
    definitionId: floor.definitionId,
    floor: floor.floor,
    seed: floor.seed,
    challengeLevel: floor.challengeLevel,
    startRoomId: floor.startRoomId,
    currentRoomId: floor.currentRoomId,
    rooms: floor.rooms.map((room, index) => cloneRoomGraph(room, `Dungeon room[${index}]`)),
    ...(floor.selectedPopulationFloor === undefined ? {} : { selectedPopulationFloor: floor.selectedPopulationFloor }),
    diagnostics: floor.diagnostics.map((entry, index) =>
      cloneJsonSafeValue(entry, `Dungeon diagnostic[${index}]`) as DungeonDiagnostic),
  };
}

function directionVector(direction: DungeonDirection): { readonly x: number; readonly y: number } {
  switch (direction) {
    case "north": return { x: 0, y: 1 };
    case "east": return { x: 1, y: 0 };
    case "south": return { x: 0, y: -1 };
    case "west": return { x: -1, y: 0 };
  }
}

export function directionForRoomLink(
  room: Pick<DungeonRoom, "width" | "height">,
  link: Pick<DungeonRoomLink, "offset">,
): DungeonDirection {
  if (link.offset.x === -1) return "west";
  if (link.offset.x === room.width) return "east";
  if (link.offset.y === -1) return "south";
  if (link.offset.y === room.height) return "north";
  throw new Error(`Dungeon room link offset (${link.offset.x},${link.offset.y}) is not on a room boundary`);
}

function oppositeDungeonDirection(direction: DungeonDirection): DungeonDirection {
  switch (direction) {
    case "north": return "south";
    case "east": return "west";
    case "south": return "north";
    case "west": return "east";
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
}

function assertNonemptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be non-empty`);
}

export function normalizeDungeonMonster(value: unknown, label: string): DungeonMonster {
  assertPlainObject(value, label);
  const raw = value as Readonly<Record<string, unknown>>;
  assertExactObjectKeys(raw, ["type", "level", "extraLivingArguments"], label);
  const type = raw["type"];
  if (typeof type !== "string" || type.length === 0) throw new Error(`${label}.type must be non-empty`);
  const level = raw["level"];
  if (typeof level !== "number" || !Number.isSafeInteger(level) || level <= 0) {
    throw new Error(`${label}.level must be a positive integer`);
  }
  if (!Object.prototype.hasOwnProperty.call(raw, "extraLivingArguments")) {
    return Object.freeze({ type, level });
  }
  const extra = raw["extraLivingArguments"];
  if (typeof extra !== "object" || extra === null || Array.isArray(extra)) {
    throw new Error(`${label}.extraLivingArguments must be an object`);
  }
  return Object.freeze({
    type,
    level,
    extraLivingArguments: cloneJsonSafeRecord(extra, `${label}.extraLivingArguments`),
  });
}

function cloneMonsterList(
  monsters: readonly DungeonMonster[],
  label: string,
): readonly DungeonMonster[] {
  return Object.freeze(monsters.map((monster, index) =>
    normalizeDungeonMonster(monster, `${label}[${index}]`)));
}

function normalizeGenerationGateDecisions(
  value: unknown,
  label: string,
): readonly DungeonFixedEncounterGateSnapshot[] {
  assertOrdinaryArray(value, label);
  const seen = new Set<number>();
  return Object.freeze(value.map((entry, index) => {
    assertExactObjectKeys(entry, ["fixedIndex", "eligible"], `${label}[${index}]`);
    const item = entry as Record<string, unknown>;
    const fixedIndex = item["fixedIndex"];
    if (typeof fixedIndex !== "number" || !Number.isSafeInteger(fixedIndex) || fixedIndex < 0) {
      throw new Error(`${label}[${index}].fixedIndex must be a non-negative integer`);
    }
    if (seen.has(fixedIndex)) throw new Error(`${label} contains duplicate fixed index ${fixedIndex}`);
    seen.add(fixedIndex);
    if (typeof item["eligible"] !== "boolean") {
      throw new Error(`${label}[${index}].eligible must be boolean`);
    }
    return Object.freeze({ fixedIndex, eligible: item["eligible"] });
  }));
}

function equalGenerationGateDecisions(
  left: readonly DungeonFixedEncounterGateSnapshot[],
  right: readonly DungeonFixedEncounterGateSnapshot[],
): boolean {
  return left.length === right.length && left.every((entry, index) =>
    entry.fixedIndex === right[index]!.fixedIndex && entry.eligible === right[index]!.eligible);
}

function isOrderedDungeonMonsterSubsequence(
  roster: readonly DungeonMonster[],
  authored: readonly DungeonMonster[],
): boolean {
  let authoredIndex = 0;
  for (const monster of roster) {
    let found = false;
    while (authoredIndex < authored.length) {
      if (equalDungeonMonster(monster, authored[authoredIndex]!)) {
        found = true;
        authoredIndex += 1;
        break;
      }
      authoredIndex += 1;
    }
    if (!found) return false;
  }
  return true;
}

function equalDungeonMonster(left: DungeonMonster, right: DungeonMonster): boolean {
  if (left.type !== right.type || left.level !== right.level) return false;
  return equalJsonSafeValue(left.extraLivingArguments, right.extraLivingArguments);
}

function equalDungeonMonsterLists(
  left: readonly DungeonMonster[],
  right: readonly DungeonMonster[],
): boolean {
  return left.length === right.length && left.every((monster, index) =>
    equalDungeonMonster(monster, right[index]!));
}

function equalJsonSafeValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => equalJsonSafeValue(entry, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && equalJsonSafeValue(leftRecord[key], rightRecord[key]));
}
