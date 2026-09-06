import {
  loadDungeonData,
  type DungeonDefinition,
  type DungeonResourceSource,
  type DungeonZoneChange,
} from "@dib/gamedata/dungeon";
import {
  DungeonSession,
  dungeonDefinitionId,
  normalizeDungeonMonster,
  type DungeonEncounter,
  type DungeonFixedEncounterGateSnapshot,
  type DungeonMonster,
  type DungeonFloorSnapshot,
  type DungeonGenerationContext,
  type DungeonLoot,
  type DungeonRoomEntryAction,
  type DungeonZoneActivation,
} from "./dungeon.js";
import type { Rng } from "./rng.js";
import {
  assertExactObjectKeys,
  assertJsonSafeTree,
  assertOrdinaryArray,
  assertPlainObject,
} from "./jsonSafe.js";

export type DungeonRollbackRegistration = (rollback: () => void) => void;

export interface DungeonRouteDescriptor {
  readonly typeName: string;
  readonly sourceFile: string;
  readonly floor: number;
  /** Named source zone used only when a floor is generated for the first time. */
  readonly entryZoneName?: string;
}

/** Stable identity of one source terminal Save Me/Store/onExit flow. The route is part of the
 * identity because encounter ids repeat across floors and linked dungeon files. */
export interface DungeonTerminalFlowIdentity {
  readonly route: DungeonRouteDescriptor;
  readonly id: string;
}

/** Build an externally supplied terminal identity without coupling the engine to an authority
 * package. A later committed server battle id can use this same pure boundary. */
export function dungeonTerminalFlowIdentity(
  route: DungeonRouteDescriptor,
  id: string,
): DungeonTerminalFlowIdentity {
  return Object.freeze({ route: waypointRoute(normalizeRoute(route)), id: nonempty(id, "terminal flow id") });
}

/** Build the source-shaped durable id for a captured monster without mutating a runtime. */
export function dungeonCaptureInstanceId(
  runSeed: number,
  route: DungeonRouteDescriptor,
  encounterId: string,
  captureSerial: number,
  shortType: string,
): string {
  if (!Number.isSafeInteger(runSeed) || runSeed < 0) {
    throw new Error("dungeon capture run seed must be a nonnegative safe integer");
  }
  nonempty(encounterId, "dungeon encounter id");
  nonempty(shortType, "captured monster type");
  if (!Number.isSafeInteger(captureSerial) || captureSerial < 1) {
    throw new Error("dungeon capture serial must be a positive safe integer");
  }
  const normalized = waypointRoute(normalizeRoute(route));
  return [
    "dungeon",
    runSeed,
    normalized.typeName,
    normalized.sourceFile,
    normalized.floor,
    encounterId,
    captureSerial,
    shortType,
  ].map(instanceIdSegment).join("-");
}

export interface DungeonRuntimeContext {
  readonly resources: DungeonResourceSource;
  readonly monsterTypes: readonly string[];
  /** Debug-only shared source stream supplied by the local Fidelity Lab. */
  readonly fidelityRng?: Rng;
  /** Debug-only Foundation traversal normalization shared with the emulator harness. */
  readonly fidelityFoundationOrder?: "lexicographic";
  /** Frozen compatibility behavior for Official simulation versions before v16. */
  readonly legacyWholeRowPopulationSelection?: boolean;
  /** Frozen generator behavior for immutable Official simulation versions through v22. */
  readonly legacyDungeonGenerationSemantics?: boolean;
  /** Local-save compatibility only. If a strict restore against the current generator fails,
   * retry the complete run against the frozen pre-correction generator. The retry still validates
   * every room, encounter, treasure, roster, and cached floor before it is accepted. */
  readonly allowLegacyDungeonGenerationRestore?: boolean;
  readonly isCompletionSet?: (key: string) => boolean;
  readonly isQuestUsable?: (questKey: string) => boolean;
  readonly isMonsterRegistered?: (shortType: string) => boolean;
  readonly isCatchQuestDone?: (instanceName: string) => boolean;
  /** Durable `UserSavedData` waypoint floors for one dungeon instance. */
  readonly waypointFloorsForDungeon?: (instanceName: string) => readonly number[];
  /** Called only for a newly reached waypoint, after the floor session accepts it. */
  readonly onWaypointRegistered?: (instanceName: string, floor: number) => void;











  readonly onDungeonFloorEntered?: (instanceName: string, floor: number) => void;
  /** Source event 4 after a successfully prepared terminal roster transaction. */
  readonly onDungeonRoomRosterUpdated?: (
    instanceName: string,
    floor: number,
    survivingMonstersByRoom: readonly number[],
    flow: DungeonTerminalFlowIdentity,
    registerRollback: DungeonRollbackRegistration,
  ) => void | DungeonRoomRosterUpdateHooks;
  /** Optional dependency-injection seam for tests or pre-indexed archives. */
  readonly definitionFor?: (route: DungeonRouteDescriptor) => DungeonDefinition;
  /** Persisted salt for every deterministic floor seed in this run. Required for new runs. */
  readonly runSeed?: number;
  /** Test/host override; production uses the stable route hash below. */
  readonly seedFor?: (route: DungeonRouteDescriptor, runSeed: number) => number;
}

/** Optional application-owned rollback/accept hooks around an event-4 transaction. Both hooks run
 * before durable persistence/engine assignment: `commit` accepts the prepared external state, while
 * `rollback` restores it after any prepare, persistence, accept, or assignment failure. */
export interface DungeonRoomRosterUpdateHooks {
  readonly rollback?: () => void;
  readonly commit?: () => void;
}

/** Application-owned choices made against the prospective terminal session before its single
 * durable snapshot. This is intentionally limited to source dungeon entry actions; it is not a
 * general transaction callback. */
export interface DungeonTerminalPreparation {
  readonly entryActions: readonly DungeonRoomEntryAction[];
  readonly consumeTreasure: (treasureId: string) => void;
  /** Stage the run-owned capture serial in the same prospective terminal snapshot. */
  readonly setCaptureSerial: (captureSerial: number) => void;
  /** Register application rollback before making any fallible staged mutation. The engine invokes
   * each registered callback at most once if preparation or the surrounding transaction fails. */
  readonly registerRollback: DungeonRollbackRegistration;
}

export interface DungeonCachedFloorSnapshot {
  readonly route: DungeonRouteDescriptor;
  readonly session: DungeonFloorSnapshot;
}

export interface DungeonWaypointSnapshot {
  readonly route: DungeonRouteDescriptor;
}

export interface DungeonRunSnapshot {
  readonly schemaVersion: 1;
  readonly runSeed: number;
  /** Monotonic run-owned suffix for durable captured-monster instance ids. */
  readonly captureSerial: number;
  /** Monotonic run-owned serial used for local terminal flow identities. */
  readonly terminalFlowSerial: number;
  readonly current: DungeonCachedFloorSnapshot;
  readonly cachedFloors: readonly DungeonCachedFloorSnapshot[];
  /** Route-aware native DungeonCache waypoints. Present on every newly written snapshot. */
  readonly registeredWaypoints: readonly DungeonWaypointSnapshot[];
  /** Read-only migration seam for snapshots produced by the early floor-only implementation. */
  readonly registeredWaypointFloors?: readonly number[];
  readonly completedKeys: readonly string[];
  readonly catchTypes: readonly string[];
  /** Source `catchQuestsDone`, keyed by dungeon instance. Optional on early schema-1 snapshots. */
  readonly completedCatchQuestInstances?: readonly string[];
  /** Legacy/current-route projection retained for schema-1 compatibility. */
  readonly catchRewardCollected: boolean;
}

interface DungeonRuntimeWorkingState {
  readonly definition: DungeonDefinition;
  readonly route: DungeonRouteDescriptor;
  readonly session: DungeonSession;
  readonly cache: readonly (readonly [string, DungeonCachedFloorSnapshot])[];
  readonly waypoints: readonly (readonly [string, DungeonRouteDescriptor])[];
  readonly floorPresence: readonly string[];
  readonly completedKeys: readonly string[];
  readonly catchTypes: readonly string[];
  readonly completedCatchQuestInstances: readonly string[];
  readonly lastPresentedCatchTypes: readonly (readonly [string, string])[];
  readonly captureSerial: number;
  readonly terminalFlowSerial: number;
  readonly migratedLegacyTopology: boolean;
}

export interface DungeonEncounterResolution {
  readonly outcome: "victory" | "defeat" | "retreat";
  readonly entryActions: readonly DungeonRoomEntryAction[];
}

export type DungeonRuntimeTransition =
  | { readonly kind: "blocked"; readonly activation: Extract<DungeonZoneActivation, { kind: "blocked" }> }
  | { readonly kind: "floor"; readonly route: DungeonRouteDescriptor; readonly restoredFromCache: boolean }
  | { readonly kind: "dungeon"; readonly route: DungeonRouteDescriptor; readonly restoredFromCache: boolean }
  | { readonly kind: "world"; readonly change: Extract<DungeonZoneChange, { kind: "worldExit" }> };

/**
 * Source-shaped owner of a complete dungeon run. DungeonSession deliberately models one floor;
 * this controller supplies the native DungeonCache responsibilities around it: durable floor
 * instances, run-wide fixed-event/catch state, route-aware waypoints, and linked-dungeon travel.
 */
export class DungeonRuntimeController {
  private definitionValue: DungeonDefinition;
  private sessionValue: DungeonSession;
  private routeValue: DungeonRouteDescriptor;
  private cache = new Map<string, DungeonCachedFloorSnapshot>();
  private waypoints = new Map<string, DungeonRouteDescriptor>();
  /** Non-permanent dungeon `presence` property: retained by a cached floor only for this run. */
  private floorPresence = new Set<string>();
  private completedKeys = new Set<string>();
  private catchTypes = new Set<string>();
  private completedCatchQuestInstances = new Set<string>();
  private lastPresentedCatchTypes = new Map<string, string>();
  private uncommittedTerminalFlow: {
    readonly flow: DungeonTerminalFlowIdentity;
    readonly before: DungeonRuntimeWorkingState;
  } | undefined;
  private captureSerial = 0;
  private terminalFlowSerial = 0;
  private migratedLegacyTopologyValue = false;
  private restoredLegacyGenerationValue = false;

  private constructor(
    private readonly context: DungeonRuntimeContext,
    readonly runSeed: number,
    route: DungeonRouteDescriptor,
    definition: DungeonDefinition,
    session: DungeonSession,
  ) {
    this.routeValue = waypointRoute(route);
    this.definitionValue = definition;
    this.sessionValue = session;
    this.seedDurableWaypoints(definition, this.routeValue);
    if (context.isCatchQuestDone?.(definition.instanceName) === true) {
      this.completedCatchQuestInstances.add(definition.instanceName);
    }
    for (const type of definition.catchQuest?.types ?? []) {
      if (context.isMonsterRegistered?.(type) === true) {
        this.sessionValue.recordCapturedMonster(type);
      }
    }
    this.sessionValue = this.restoreWithRunProgress(
      definition,
      this.routeValue,
      this.sessionValue.snapshot(),
    );
    this.absorbSessionProgress();
  }

  static enter(context: DungeonRuntimeContext, route: DungeonRouteDescriptor): DungeonRuntimeController {
    if (context.runSeed === undefined) throw new Error("DungeonRuntimeController.enter requires context.runSeed");
    const runSeed = normalizeSeed(context.runSeed);
    const normalized = normalizeRoute(route);
    const definition = loadDefinition(context, normalized);
    const session = DungeonSession.create(
      definition,
      normalized.floor,
      floorSeed(context, normalized, runSeed),
      generationContext(context, normalized.entryZoneName),
    );
    const controller = new DungeonRuntimeController(context, runSeed, normalized, definition, session);
    context.onDungeonFloorEntered?.(definition.instanceName, controller.route.floor);
    return controller;
  }

  static restore(context: DungeonRuntimeContext, value: DungeonRunSnapshot | unknown): DungeonRuntimeController {
    const snapshot = parseDungeonRunSnapshot(value);
    validateLegacyPreviousRoomIds(snapshot);
    const legacyDefinitions = dungeonRunUsesLegacyTopology(snapshot)
      ? validateLegacyTopologyState(context, snapshot)
      : undefined;
    const route = snapshot.current.route;
    const definition = legacyDefinitions?.get(cacheKey(route)) ?? loadDefinition(context, route);
    if (legacyDefinitions !== undefined) {
      // The pre-3143dfc generator serialized synthetic `room-N` identities. Native generated
      // rooms use template/CGPoint identities and a different graph, so encounter/treasure IDs
      // from that floor cannot be mapped honestly. Preserve run-level progress and regenerate the
      // active route from its saved seed; discard only obsolete floor geometry/cache progress.
      const session = DungeonSession.create(
        definition,
        snapshot.current.session.floor,
        snapshot.current.session.seed,
        generationContext(context, route.entryZoneName),
      );
      const controller = new DungeonRuntimeController(
        context,
        snapshot.runSeed,
        route,
        definition,
        session,
      );
      controller.cache.clear();
      for (const waypoint of snapshot.registeredWaypoints) {
        const routeWithoutEntry = waypointRoute(waypoint.route);
        controller.waypoints.set(cacheKey(routeWithoutEntry), routeWithoutEntry);
      }
      for (const key of snapshot.completedKeys) controller.completedKeys.add(key);
      for (const type of snapshot.catchTypes) controller.catchTypes.add(type);
      for (const instanceName of snapshot.completedCatchQuestInstances ?? []) {
        controller.completedCatchQuestInstances.add(instanceName);
      }
      if (snapshot.catchRewardCollected) {
        controller.completedCatchQuestInstances.add(definition.instanceName);
      }
      controller.captureSerial = snapshot.captureSerial;
      controller.terminalFlowSerial = snapshot.terminalFlowSerial;
      controller.sessionValue = controller.restoreWithRunProgress(
        definition,
        route,
        session.snapshot(),
      );
      controller.absorbSessionProgress();
      controller.migratedLegacyTopologyValue = true;
      return controller;
    }
    // Cached floors must regenerate with the host's external eligibility only. Run completion keys
    // are overlaid after generation; feeding them into generation would remove a fixed encounter
    // and invalidate room/encounter ids recorded in the snapshot.
    const restoreFloors = (candidateContext: DungeonRuntimeContext): {
      readonly definition: DungeonDefinition;
      readonly session: DungeonSession;
    } => {
      const currentDefinition = loadDefinition(candidateContext, route);
      const currentSession = DungeonSession.restore(
        currentDefinition,
        snapshot.current.session,
        generationContext(candidateContext, route.entryZoneName),
      );
      for (const entry of snapshot.cachedFloors) {
        if (cacheKey(entry.route) === cacheKey(route)) continue;
        const cachedDefinition = loadDefinition(candidateContext, entry.route);
        DungeonSession.restore(
          cachedDefinition,
          entry.session,
          generationContext(candidateContext, entry.route.entryZoneName),
        );
      }
      return { definition: currentDefinition, session: currentSession };
    };

    let effectiveContext = context;
    let restoredFloors: ReturnType<typeof restoreFloors>;
    let restoredLegacyGeneration = false;
    try {
      restoredFloors = restoreFloors(context);
    } catch (currentGenerationError) {
      if (
        context.allowLegacyDungeonGenerationRestore !== true ||
        context.legacyDungeonGenerationSemantics === true
      ) {
        throw currentGenerationError;
      }
      const legacyContext: DungeonRuntimeContext = {
        ...context,
        legacyDungeonGenerationSemantics: true,
        allowLegacyDungeonGenerationRestore: false,
      };
      try {
        restoredFloors = restoreFloors(legacyContext);
      } catch {
        // Preserve the current-generator diagnostic for malformed snapshots. The historical retry
        // is a compatibility proof, not a second family of user-facing validation errors.
        throw currentGenerationError;
      }
      effectiveContext = legacyContext;
      restoredLegacyGeneration = true;
    }
    const controller = new DungeonRuntimeController(
      effectiveContext,
      snapshot.runSeed,
      route,
      restoredFloors.definition,
      restoredFloors.session,
    );
    controller.cache.clear();
    for (const entry of snapshot.cachedFloors) controller.cache.set(cacheKey(entry.route), entry);
    for (const waypoint of snapshot.registeredWaypoints) {
      const routeWithoutEntry = waypointRoute(waypoint.route);
      controller.waypoints.set(cacheKey(routeWithoutEntry), routeWithoutEntry);
    }
    for (const key of snapshot.completedKeys) controller.completedKeys.add(key);
    for (const type of snapshot.catchTypes) controller.catchTypes.add(type);
    for (const instanceName of snapshot.completedCatchQuestInstances ?? []) {
      controller.completedCatchQuestInstances.add(instanceName);
    }
    if (snapshot.catchRewardCollected) {
      controller.completedCatchQuestInstances.add(definition.instanceName);
    }
    controller.captureSerial = snapshot.captureSerial;
    controller.terminalFlowSerial = snapshot.terminalFlowSerial;
    controller.sessionValue = controller.restoreWithRunProgress(
      restoredFloors.definition,
      route,
      snapshot.current.session,
    );
    controller.absorbSessionProgress();
    controller.restoredLegacyGenerationValue = restoredLegacyGeneration;
    return controller;
  }

  get definition(): DungeonDefinition { return this.definitionValue; }
  get session(): DungeonSession { return this.sessionValue; }
  get route(): DungeonRouteDescriptor { return this.routeValue; }
  get migratedLegacyTopology(): boolean { return this.migratedLegacyTopologyValue; }
  get restoredLegacyGeneration(): boolean { return this.restoredLegacyGenerationValue; }

  catchQuestProgress(): ReturnType<DungeonSession["catchQuestProgress"]> {
    return this.sessionValue.catchQuestProgress();
  }

  /**
   * Native `tempCatchQuestFound` is run-transient: dungeon entry presents only when the owned
   * required-type set changed, while an explicit menu request can still show the current state.
   */
  takeChangedCatchQuestProgress(): ReturnType<DungeonSession["catchQuestProgress"]> {
    const progress = this.sessionValue.catchQuestProgress();
    if (progress === undefined || progress.rewardCollected) return undefined;
    const definitionKey = dungeonDefinitionId(this.definitionValue);
    const key = [...progress.captured].sort().join("\u0000");
    if (this.lastPresentedCatchTypes.get(definitionKey) === key) return undefined;
    this.lastPresentedCatchTypes.set(definitionKey, key);
    return progress;
  }






  seedCurrentCatchQuestPresentation(catchTypesBeforeBattle: readonly string[]): void {
    const progress = this.sessionValue.catchQuestProgress();
    if (progress === undefined || progress.rewardCollected) return;
    const capturedBefore = new Set(catchTypesBeforeBattle);
    const key = progress.required
      .filter((shortType) => capturedBefore.has(shortType))
      .sort()
      .join("\u0000");
    this.lastPresentedCatchTypes.set(dungeonDefinitionId(this.definitionValue), key);
  }

  /**
   * `tempCatchQuestFound` is presentation-transient player state, not durable dungeon geometry.
   * Official projection adoption rebuilds the serializable controller after each committed
   * command; carry the non-serialized source presentation values across that replacement so an
   * unchanged challenge or cached-floor presence is not presented again after every battle or
   * route transition.
   */
  inheritTransientPresentationState(previous: DungeonRuntimeController): void {
    this.floorPresence.clear();
    for (const key of previous.floorPresence) this.floorPresence.add(key);
    this.lastPresentedCatchTypes.clear();
    for (const [definitionId, catchTypes] of previous.lastPresentedCatchTypes) {
      this.lastPresentedCatchTypes.set(definitionId, catchTypes);
    }
  }

  /**
   * Allocate a save-stable capture id without relying on process-local counters. A retreat may
   * preserve a capture while leaving the encounter active, so the serial must live in the run
   * snapshot rather than being reconstructed from cleared encounters.
   */
  nextCaptureInstanceId(encounterId: string, shortType: string): string {
    nonempty(encounterId, "dungeon encounter id");
    nonempty(shortType, "captured monster type");
    this.captureSerial += 1;
    return dungeonCaptureInstanceId(
      this.runSeed,
      this.routeValue,
      encounterId,
      this.captureSerial,
      shortType,
    );
  }

  /** Allocate a deterministic local terminal-flow identity at dungeon battle start. The caller
   * must checkpoint the run after allocation so a reload cannot reuse the serial. */
  allocateTerminalFlowIdentity(encounterId: string): DungeonTerminalFlowIdentity {
    nonempty(encounterId, "dungeon encounter id");
    this.uncommittedTerminalFlow = undefined;
    const before = this.captureWorkingState();
    this.terminalFlowSerial += 1;
    const flow = dungeonTerminalFlowIdentity(
      this.routeValue,
      `local-${this.runSeed}-${this.terminalFlowSerial}-${instanceIdSegment(encounterId)}`,
    );
    this.uncommittedTerminalFlow = { flow, before };
    return flow;
  }

  /** Undo only a flow serial allocated immediately before a required pre-battle checkpoint.
   * This is intentionally guarded: once roster work is pending or another serial was allocated,
   * restoring an older snapshot would discard a later terminal transaction. */
  rollbackUncommittedTerminalFlow(
    flow: DungeonTerminalFlowIdentity,
    before: DungeonRunSnapshot,
  ): void {
    const identity = this.validateTerminalFlowIdentity(flow);
    const pending = this.uncommittedTerminalFlow;
    if (
      pending === undefined ||
      pending.flow.id !== identity.id ||
      this.terminalFlowSerial !== before.terminalFlowSerial + 1 ||
      pending.before.terminalFlowSerial !== before.terminalFlowSerial ||
      cacheKey(identity.route) !== cacheKey(this.routeValue)
    ) {
      throw new Error("terminal flow rollback no longer matches the allocated serial");
    }
    this.restoreWorkingState(pending.before);
    this.uncommittedTerminalFlow = undefined;
  }

  registerWaypoint(): void {
    this.sessionValue.registerWaypoint();
    const route = waypointRoute(this.routeValue);
    this.waypoints.set(cacheKey(route), route);
    this.context.onWaypointRegistered?.(this.definitionValue.instanceName, route.floor);
    this.absorbSessionProgress();
    this.cacheCurrentFloor();
  }

  availableWaypoints(): readonly DungeonRouteDescriptor[] {
    return Object.freeze([...this.waypoints.values()].sort(compareRoutes));
  }

  /** Source-owned durable identities represented by the runtime's route-aware working set. */
  waypointDiscoveries(): readonly Readonly<{ instanceName: string; floor: number }>[] {
    return Object.freeze(this.availableWaypoints().map((route) => Object.freeze({
      instanceName: loadDefinition(this.context, route).instanceName,
      floor: route.floor,
    })));
  }

  /** Compatibility/convenience view used by floor-number-only source menus. */
  availableWaypointFloors(): readonly number[] {
    return Object.freeze(this.availableWaypoints()
      .filter((route) => sameDungeon(route, this.routeValue))
      .map((route) => route.floor));
  }

  travelToWaypoint(destination: DungeonRouteDescriptor | number): boolean {
    const route = typeof destination === "number"
      ? this.routeForWaypointFloor(destination)
      : waypointRoute(normalizeRoute(destination));
    const key = cacheKey(route);
    if (!this.waypoints.has(key)) throw new Error(`Dungeon waypoint ${key} is not registered`);
    if (key === cacheKey(this.routeValue)) {
      this.sessionValue.arriveAtWaypoint();
      this.cacheCurrentFloor();
      return true;
    }
    // `DungeonCache.cachedDungeonForDictionary:level:` retrieves or creates the destination.
    return this.switchRoute(route, "waypoint", false, (session) => session.arriveAtWaypoint());
  }

  resolveEncounter(
    encounter: Pick<DungeonEncounter, "id">,
    outcome: "victory" | "defeat" | "retreat",
    capturedTypes: readonly string[] = [],
  ): DungeonEncounterResolution {
    if (outcome !== "victory" && capturedTypes.length > 0) {
      throw new Error("Dungeon encounter capture types are accepted only on victory");
    }
    const entryActions = this.sessionValue.resolveEncounter(encounter.id, outcome);
    if (outcome === "victory") {
      for (const type of capturedTypes) this.sessionValue.recordCapturedMonster(type);
      this.absorbSessionProgress();
    }
    this.cacheCurrentFloor();
    return Object.freeze({
      outcome,
      entryActions,
    });
  }

  synchronizeEncounterRoomRoster(
    encounter: Pick<DungeonEncounter, "id">,
    flow: DungeonTerminalFlowIdentity,
    survivingMonsters: readonly DungeonMonster[],
  ): boolean {
    const identity = this.validateTerminalFlowIdentity(flow);
    const before = this.captureWorkingState();
    let hooks: DungeonRoomRosterUpdateHooks | undefined;
    const rollbackCallbacks: Array<() => void> = [];
    const registerRollback: DungeonRollbackRegistration = (rollback) => {
      if (typeof rollback !== "function") throw new Error("Dungeon rollback must be a function");
      if (!rollbackCallbacks.includes(rollback)) rollbackCallbacks.push(rollback);
    };
    try {
      const plan = this.sessionValue.prepareEncounterRoomRoster(
        encounter.id,
        identity.id,
        survivingMonsters,
      );
      if (!plan.changed) return false;

      // This is the transaction boundary. All validation, prospective counts, and the exact cached
      // floor snapshot are complete before the external event callback. A throwing callback leaves
      // the session, marker, cache, and this run's durable snapshot untouched. After it succeeds,
      // commit is only direct assignment/Map.set over the already validated plan.
      hooks = normalizeRosterHooks(this.context.onDungeonRoomRosterUpdated?.(
        this.definitionValue.instanceName,
        this.routeValue.floor,
        plan.survivingMonsterCountsByRoom,
        identity,
        registerRollback,
      ));
      // The hook is still external here, so complete it before assigning any durable engine
      // state. Once plan.commit/cache.set begin, only direct validated assignments remain.
      hooks?.commit?.();
      plan.commit();
      this.cache.set(cacheKey(this.routeValue), Object.freeze({
        route: this.routeValue,
        session: plan.nextSnapshot,
      }));
      return true;
    } catch (error) {
      throw this.rollbackTransaction(error, hooks, before, rollbackCallbacks);
    }
  }

  /**
   * Full local Save Me/Store terminal transaction. The prospective session is forked and
   * settled off to the side, event 4 is delivered against the application transaction, and the
   * complete post-outcome run snapshot is persisted before the runtime/cache assignment commits.
   * A rejected checkpoint therefore leaves the original roster, flow marker, cache, and quest
   * transaction untouched and can retry with the same flow identity.
   */
  async settleEncounterTerminal(
    encounter: Pick<DungeonEncounter, "id">,
    flow: DungeonTerminalFlowIdentity,
    outcome: "victory" | "defeat" | "retreat",
    survivingMonsters: readonly DungeonMonster[],
    capturedTypes: readonly string[],
    persist: (snapshot: DungeonRunSnapshot) => Promise<void>,
    prepare?: (preparation: DungeonTerminalPreparation) => void,
  ): Promise<DungeonEncounterResolution> {
    if (outcome !== "victory" && capturedTypes.length > 0) {
      throw new Error("Dungeon encounter capture types are accepted only on victory");
    }
    const identity = this.validateTerminalFlowIdentity(flow);
    const before = this.captureWorkingState();
    let hooks: DungeonRoomRosterUpdateHooks | undefined;
    const rollbackCallbacks: Array<() => void> = [];
    const registerRollback: DungeonRollbackRegistration = (rollback) => {
      if (typeof rollback !== "function") throw new Error("Dungeon rollback must be a function");
      if (!rollbackCallbacks.includes(rollback)) rollbackCallbacks.push(rollback);
    };
    try {
      const prospective = this.sessionValue.fork();
      let prospectiveCaptureSerial = this.captureSerial;
      const rosterPlan = prospective.prepareEncounterRoomRoster(
        encounter.id,
        identity.id,
        survivingMonsters,
      );
      if (rosterPlan.changed) rosterPlan.commit();
      const entryActions = prospective.resolveEncounter(encounter.id, outcome);
      if (outcome === "victory") {
        for (const type of capturedTypes) prospective.recordCapturedMonster(type);
      }
      const consumedTreasureIds = new Set<string>();
      prepare?.({
        entryActions,
        consumeTreasure: (treasureId) => {
          const treasure = entryActions.find((action) =>
            action.kind === "treasure" && action.treasure.id === treasureId,
          );
          if (treasure === undefined) {
            throw new Error(`Dungeon terminal preparation: unknown treasure ${treasureId}`);
          }
          prospective.collectTreasure(treasureId);
          consumedTreasureIds.add(treasureId);
        },
        setCaptureSerial: (captureSerial) => {
          if (!Number.isSafeInteger(captureSerial) || captureSerial < this.captureSerial) {
            throw new Error("Dungeon terminal preparation: invalid capture serial");
          }
          prospectiveCaptureSerial = captureSerial;
        },
        registerRollback,
      });
      const visibleEntryActions = entryActions.filter((action) =>
        action.kind !== "treasure" || !consumedTreasureIds.has(action.treasure.id),
      );
      const nextSession = prospective.snapshot();
      const nextRun = this.snapshotWithCurrentFloor(nextSession, prospectiveCaptureSerial);
      const nextCache = new Map(this.cache);
      nextCache.set(cacheKey(this.routeValue), Object.freeze({
        route: this.routeValue,
        session: nextSession,
      }));
      const nextCompletedKeys = new Set(this.completedKeys);
      for (const key of nextSession.completedKeys) nextCompletedKeys.add(key);
      const nextCatchTypes = new Set(this.catchTypes);
      for (const type of nextSession.catchTypes) nextCatchTypes.add(type);
      const nextCompletedCatchQuestInstances = new Set(this.completedCatchQuestInstances);
      if (nextSession.catchRewardCollected) {
        nextCompletedCatchQuestInstances.add(this.definitionValue.instanceName);
      }
      hooks = rosterPlan.changed
        ? normalizeRosterHooks(this.context.onDungeonRoomRosterUpdated?.(
            this.definitionValue.instanceName,
            this.routeValue.floor,
            rosterPlan.survivingMonsterCountsByRoom,
            identity,
            registerRollback,
          ))
        : undefined;
      // Application acceptance is deliberately before persist. Once persist resolves, the
      // irreversible boundary contains no callback or reconstruction: only these prebuilt
      // references are assigned to the engine fields below.
      const result = Object.freeze({ outcome, entryActions: visibleEntryActions });
      hooks?.commit?.();
      await persist(nextRun);
      this.sessionValue = prospective;
      this.cache = nextCache;
      this.completedKeys = nextCompletedKeys;
      this.catchTypes = nextCatchTypes;
      this.completedCatchQuestInstances = nextCompletedCatchQuestInstances;
      this.captureSerial = prospectiveCaptureSerial;
      this.uncommittedTerminalFlow = undefined;
      return result;
    } catch (error) {
      throw this.rollbackTransaction(error, hooks, before, rollbackCallbacks);
    }
  }

  /** Restore exact runtime objects without consulting mutable external completion/quest context. */
  private restoreWorkingState(state: DungeonRuntimeWorkingState): void {
    this.definitionValue = state.definition;
    this.sessionValue = state.session.fork();
    this.routeValue = state.route;
    this.cache.clear();
    for (const [key, entry] of state.cache) this.cache.set(key, entry);
    this.waypoints.clear();
    for (const [key, route] of state.waypoints) this.waypoints.set(key, route);
    this.floorPresence.clear();
    for (const key of state.floorPresence) this.floorPresence.add(key);
    this.completedKeys.clear();
    for (const key of state.completedKeys) this.completedKeys.add(key);
    this.catchTypes.clear();
    for (const type of state.catchTypes) this.catchTypes.add(type);
    this.completedCatchQuestInstances.clear();
    for (const instanceName of state.completedCatchQuestInstances) {
      this.completedCatchQuestInstances.add(instanceName);
    }
    this.lastPresentedCatchTypes.clear();
    for (const [key, value] of state.lastPresentedCatchTypes) this.lastPresentedCatchTypes.set(key, value);
    this.captureSerial = state.captureSerial;
    this.terminalFlowSerial = state.terminalFlowSerial;
    this.migratedLegacyTopologyValue = state.migratedLegacyTopology;
  }

  private captureWorkingState(): DungeonRuntimeWorkingState {
    this.cacheCurrentFloor();
    return {
      definition: this.definitionValue,
      route: this.routeValue,
      session: this.sessionValue.fork(),
      cache: [...this.cache.entries()],
      waypoints: [...this.waypoints.entries()],
      floorPresence: [...this.floorPresence],
      completedKeys: [...this.completedKeys],
      catchTypes: [...this.catchTypes],
      completedCatchQuestInstances: [...this.completedCatchQuestInstances],
      lastPresentedCatchTypes: [...this.lastPresentedCatchTypes.entries()],
      captureSerial: this.captureSerial,
      terminalFlowSerial: this.terminalFlowSerial,
      migratedLegacyTopology: this.migratedLegacyTopologyValue,
    };
  }

  private rollbackTransaction(
    primary: unknown,
    hooks: DungeonRoomRosterUpdateHooks | undefined,
    before: DungeonRuntimeWorkingState,
    rollbackCallbacks: readonly (() => void)[] = [],
  ): unknown {
    const errors: unknown[] = [primary];
    const invoked = new Set<() => void>();
    const rollback = (callback: (() => void) | undefined): void => {
      if (callback === undefined || invoked.has(callback)) return;
      invoked.add(callback);
      try {
        callback();
      } catch (error) {
        errors.push(error);
      }
    };
    for (const callback of rollbackCallbacks) {
      rollback(callback);
    }
    rollback(hooks?.rollback);
    try {
      this.restoreWorkingState(before);
    } catch (error) {
      errors.push(error);
    }
    return errors.length === 1
      ? primary
      : new AggregateError(errors, "Dungeon runtime transaction rollback failed");
  }






  claimCurrentFloorPresence(): boolean {
    const key = cacheKey(this.routeValue);
    if (this.floorPresence.has(key)) return false;
    this.floorPresence.add(key);
    return true;
  }

  claimCatchQuestReward(): readonly DungeonLoot[] {
    const loot = this.sessionValue.claimCatchQuestReward();
    if (this.sessionValue.snapshot().catchRewardCollected) {
      this.absorbSessionProgress();
      this.cacheCurrentFloor();
    }
    return loot;
  }







  reenterFromWorld(route: DungeonRouteDescriptor): boolean {
    const normalized = normalizeRoute(route);
    return this.switchRoute(
      normalized,
      "dungeon",
      false,
      normalized.entryZoneName === undefined
        ? undefined
        : (session) => session.arriveAtZone(normalized.entryZoneName!),
    );
  }

  activateZone(zoneId: string): DungeonRuntimeTransition {
    const activation = this.sessionValue.activateZone(zoneId);
    if (activation.kind === "blocked") return Object.freeze({ kind: "blocked", activation });
    if (activation.kind === "worldExit") {
      this.cacheCurrentFloor();
      return Object.freeze({ kind: "world", change: activation.change });
    }
    if (activation.kind === "stairs") {
      const route = freezeRoute({
        typeName: this.routeValue.typeName,
        sourceFile: this.routeValue.sourceFile,
        floor: activation.targetFloor,
      });
      const restoredFromCache = this.switchRoute(
        route,
        "floor",
        false,
        (session) => session.arriveFromStairs(activation.direction),
      );
      return Object.freeze({ kind: "floor", route: this.routeValue, restoredFromCache });
    }
    const route = routeFromDungeonExit(activation.change);
    const restoredFromCache = this.switchRoute(
      route,
      "dungeon",
      false,
      (session) => session.arriveAtZone(activation.change.targetZoneChange),
    );
    return Object.freeze({ kind: "dungeon", route: this.routeValue, restoredFromCache });
  }

  /**
   * A DungeonNode owns the exact one-floor session it was built from. Route switching replaces
   * `sessionValue` before the incoming scene finishes loading, so an outgoing node that survives a
   * failed scene build must not dispatch one of its local zone ids into the replacement session.
   */
  activateZoneForSession(
    expectedSession: DungeonSession,
    zoneId: string,
  ): DungeonRuntimeTransition | undefined {
    if (this.sessionValue !== expectedSession) return undefined;
    return this.activateZone(zoneId);
  }

  /**
   * Restores the authoritative session of an outgoing scene when construction/activation of its
   * replacement failed. The target route was already cached by `switchRoute`; the still-visible
   * scene must become interactive against its own session again.
   */
  rollbackToScene(
    route: DungeonRouteDescriptor,
    definition: DungeonDefinition,
    session: DungeonSession,
  ): void {
    if (!session.ownsDefinition(definition)) {
      throw new Error("Dungeon scene rollback definition does not own its session");
    }
    this.routeValue = waypointRoute(normalizeRoute(route));
    this.definitionValue = definition;
    this.sessionValue = session;
    this.cacheCurrentFloor();
  }

  snapshot(): DungeonRunSnapshot {
    this.cacheCurrentFloor();
    const current = this.cache.get(cacheKey(this.routeValue));
    if (current === undefined) throw new Error("Dungeon runtime failed to cache its current floor");
    return Object.freeze({
      schemaVersion: 1,
      runSeed: this.runSeed,
      captureSerial: this.captureSerial,
      terminalFlowSerial: this.terminalFlowSerial,
      current,
      cachedFloors: Object.freeze([...this.cache.values()].sort((left, right) =>
        compareRoutes(left.route, right.route))),
      registeredWaypoints: Object.freeze(this.availableWaypoints().map((route) => Object.freeze({ route }))),
      completedKeys: Object.freeze([...this.completedKeys].sort()),
      catchTypes: Object.freeze([...this.catchTypes].sort()),
      completedCatchQuestInstances: Object.freeze([...this.completedCatchQuestInstances].sort()),
      catchRewardCollected: this.completedCatchQuestInstances.has(this.definitionValue.instanceName),
    });
  }

  private validateTerminalFlowIdentity(flow: DungeonTerminalFlowIdentity): DungeonTerminalFlowIdentity {
    if (typeof flow !== "object" || flow === null) {
      throw new Error("Dungeon terminal flow identity must be an object");
    }
    const identity = dungeonTerminalFlowIdentity(flow.route, flow.id);
    if (cacheKey(identity.route) !== cacheKey(this.routeValue)) {
      throw new Error(
        `Dungeon terminal flow route ${cacheKey(identity.route)} does not own current route ${cacheKey(this.routeValue)}`,
      );
    }
    return identity;
  }

  private snapshotWithCurrentFloor(
    session: DungeonFloorSnapshot,
    captureSerial = this.captureSerial,
  ): DungeonRunSnapshot {
    const current = Object.freeze({ route: this.routeValue, session });
    const cachedFloors = [...this.cache.values()]
      .filter((entry) => cacheKey(entry.route) !== cacheKey(this.routeValue));
    cachedFloors.push(current);
    return Object.freeze({
      schemaVersion: 1,
      runSeed: this.runSeed,
      captureSerial,
      terminalFlowSerial: this.terminalFlowSerial,
      current,
      cachedFloors: Object.freeze(cachedFloors.sort((left, right) => compareRoutes(left.route, right.route))),
      registeredWaypoints: Object.freeze(this.availableWaypoints().map((route) => Object.freeze({ route }))),
      completedKeys: Object.freeze([...new Set([...this.completedKeys, ...session.completedKeys])].sort()),
      catchTypes: Object.freeze([...new Set([...this.catchTypes, ...session.catchTypes])].sort()),
      completedCatchQuestInstances: Object.freeze([
        ...new Set([
          ...this.completedCatchQuestInstances,
          ...(session.catchRewardCollected ? [this.definitionValue.instanceName] : []),
        ]),
      ].sort()),
      catchRewardCollected:
        session.catchRewardCollected ||
        this.completedCatchQuestInstances.has(this.definitionValue.instanceName),
    });
  }

  private routeForWaypointFloor(floor: number): DungeonRouteDescriptor {
    positiveInteger(floor, "waypoint floor");
    const matches = this.availableWaypoints().filter((route) =>
      sameDungeon(route, this.routeValue) && route.floor === floor);
    if (matches.length !== 1) {
      throw new Error(`Dungeon waypoint floor ${floor} is not registered for ${this.routeValue.typeName}`);
    }
    return matches[0]!;
  }

  private switchRoute(
    route: DungeonRouteDescriptor,
    kind: "floor" | "dungeon" | "waypoint",
    requireCached: boolean,
    arrive?: (session: DungeonSession) => void,
  ): boolean {
    this.cacheCurrentFloor();
    const normalized = normalizeRoute(route);
    const stableRoute = waypointRoute(normalized);
    const definition = loadDefinition(this.context, normalized);
    this.seedDurableWaypoints(definition, stableRoute);
    const cached = this.cache.get(cacheKey(stableRoute));
    if (cached === undefined && requireCached) {
      throw new Error(`Dungeon ${kind} route ${cacheKey(normalized)} is not cached`);
    }
    const session = cached === undefined
      ? DungeonSession.create(
          definition,
          normalized.floor,
          floorSeed(this.context, normalized, this.runSeed),
          generationContext(this.context, normalized.entryZoneName, this.completedKeys),
        )
      : DungeonSession.restore(
          definition,
          cached.session,
          generationContext(this.context, normalized.entryZoneName),
        );
    this.routeValue = stableRoute;
    this.definitionValue = definition;
    this.sessionValue = this.restoreWithRunProgress(definition, stableRoute, session.snapshot());
    arrive?.(this.sessionValue);
    this.absorbSessionProgress();
    this.cacheCurrentFloor();
    this.context.onDungeonFloorEntered?.(definition.instanceName, stableRoute.floor);
    return cached !== undefined;
  }

  private cacheCurrentFloor(): void {
    this.absorbSessionProgress();
    this.cache.set(cacheKey(this.routeValue), Object.freeze({
      route: this.routeValue,
      session: this.sessionValue.snapshot(),
    }));
  }

  private absorbSessionProgress(): void {
    const snapshot = this.sessionValue.snapshot();
    // DungeonSession only knows numeric floors. Interpret the current floor's registration in the
    // current route namespace; never propagate floor 1 from one linked dungeon into another.
    if (snapshot.registeredWaypointFloors.includes(this.routeValue.floor)) {
      const route = waypointRoute(this.routeValue);
      this.waypoints.set(cacheKey(route), route);
    }
    for (const key of snapshot.completedKeys) this.completedKeys.add(key);
    for (const type of snapshot.catchTypes) this.catchTypes.add(type);
    if (snapshot.catchRewardCollected) {
      this.completedCatchQuestInstances.add(this.definitionValue.instanceName);
    }
  }

  private seedDurableWaypoints(
    definition: DungeonDefinition,
    route: DungeonRouteDescriptor,
  ): void {
    for (const floor of this.context.waypointFloorsForDungeon?.(definition.instanceName) ?? []) {
      positiveInteger(floor, `waypoint floor for ${definition.instanceName}`);
      const waypoint = waypointRoute({ ...route, floor });
      this.waypoints.set(cacheKey(waypoint), waypoint);
    }
  }

  private restoreWithRunProgress(
    definition: DungeonDefinition,
    route: DungeonRouteDescriptor,
    floor: DungeonFloorSnapshot,
  ): DungeonSession {
    const hasWaypoint = this.waypoints.has(cacheKey(route));
    return DungeonSession.restore(definition, Object.freeze({
      ...floor,
      registeredWaypointFloors: Object.freeze(hasWaypoint ? [route.floor] : []),
      completedKeys: Object.freeze([...new Set([...floor.completedKeys, ...this.completedKeys])]),
      catchTypes: Object.freeze([...new Set([...floor.catchTypes, ...this.catchTypes])]),
      catchRewardCollected:
        floor.catchRewardCollected ||
        this.completedCatchQuestInstances.has(definition.instanceName) ||
        this.context.isCatchQuestDone?.(definition.instanceName) === true,
    }), generationContext(this.context, route.entryZoneName));
  }
}

function routeFromDungeonExit(change: Extract<DungeonZoneChange, { kind: "dungeonExit" }>): DungeonRouteDescriptor {
  return freezeRoute({
    typeName: change.dungeonType,
    sourceFile: change.dungeonFile,
    floor: change.dungeonLevel ?? 1,
    entryZoneName: change.targetZoneChange,
  });
}

function generationContext(
  context: DungeonRuntimeContext,
  entryZoneName: string | undefined,
  runCompletedKeys?: ReadonlySet<string>,
): DungeonGenerationContext {
  const externalCompletion = context.isCompletionSet;
  const completion = runCompletedKeys === undefined && externalCompletion === undefined
    ? undefined
    : (key: string): boolean => runCompletedKeys?.has(key) === true || externalCompletion?.(key) === true;
  return {
    monsterTypes: context.monsterTypes,
    ...(context.fidelityRng === undefined ? {} : { fidelityRng: context.fidelityRng }),
    ...(context.fidelityFoundationOrder === undefined
      ? {}
      : { fidelityFoundationOrder: context.fidelityFoundationOrder }),
    ...(context.legacyWholeRowPopulationSelection === true
      ? { legacyWholeRowPopulationSelection: true }
      : {}),
    ...(context.legacyDungeonGenerationSemantics === true
      ? { legacyDungeonGenerationSemantics: true }
      : {}),
    ...(completion === undefined ? {} : { isCompletionSet: completion }),
    ...(context.isQuestUsable === undefined ? {} : { isQuestUsable: context.isQuestUsable }),
    ...(entryZoneName === undefined ? {} : { entryZoneName }),
  };
}

function loadDefinition(context: DungeonRuntimeContext, route: DungeonRouteDescriptor): DungeonDefinition {
  if (context.definitionFor !== undefined) return context.definitionFor(route);
  return loadDungeonData(
    context.resources,
    route.typeName,
    route.sourceFile,
    route.floor,
    new Set(context.monsterTypes),
  );
}

function floorSeed(context: DungeonRuntimeContext, route: DungeonRouteDescriptor, runSeed: number): number {
  if (context.seedFor !== undefined) return normalizeSeed(context.seedFor(route, runSeed));
  let hash = (0x811c9dc5 ^ runSeed) >>> 0;
  const text = cacheKey(route);
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Avoid a zero-only diagnostic seed while preserving a one-to-one deterministic mapping.
  return (hash ^ 0x9e3779b9) >>> 0;
}

function cacheKey(route: DungeonRouteDescriptor): string {
  return `${route.typeName}:${route.sourceFile}:${route.floor}`;
}

function waypointRoute(route: DungeonRouteDescriptor): DungeonRouteDescriptor {
  return freezeRoute({ typeName: route.typeName, sourceFile: route.sourceFile, floor: route.floor });
}

function normalizeCached(value: unknown, label: string): DungeonCachedFloorSnapshot {
  const entry = record(value, label);
  assertExactObjectKeys(entry, ["route", "session"], label);
  const route = normalizeRoute(entry["route"]);
  const session = parseFloorSnapshot(entry["session"], `${label}.session`);
  if (route.floor !== session.floor) throw new Error(`${label} route/session floor mismatch`);
  return Object.freeze({ route, session });
}

function normalizeRoute(value: unknown): DungeonRouteDescriptor {
  const route = record(value, "dungeon route");
  assertExactObjectKeys(route, ["typeName", "sourceFile", "floor", "entryZoneName"], "dungeon route");
  return freezeRoute({
    typeName: nonempty(route["typeName"], "dungeon type"),
    sourceFile: nonempty(route["sourceFile"], "dungeon file"),
    floor: positiveInteger(route["floor"], "dungeon floor"),
    ...(route["entryZoneName"] === undefined
      ? {}
      : { entryZoneName: nonempty(route["entryZoneName"], "entry zone") }),
  });
}

function freezeRoute(route: DungeonRouteDescriptor): DungeonRouteDescriptor {
  return Object.freeze({ ...route });
}

function compareRoutes(left: DungeonRouteDescriptor, right: DungeonRouteDescriptor): number {
  return left.typeName.localeCompare(right.typeName) ||
    left.sourceFile.localeCompare(right.sourceFile) || left.floor - right.floor;
}

function sameDungeon(left: DungeonRouteDescriptor, right: DungeonRouteDescriptor): boolean {
  return left.typeName === right.typeName && left.sourceFile === right.sourceFile;
}

function normalizeSeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Dungeon seed must be an integer; got ${String(value)}`);
  }
  return value >>> 0;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must not be empty`);
  return value;
}

function stringArray(value: unknown, label: string): readonly string[] {
  assertOrdinaryArray(value, label);
  const result = value.map((entry, index) => nonempty(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze(result);
}

function positiveIntegerArray(value: unknown, label: string): readonly number[] {
  assertOrdinaryArray(value, label);
  const result = value.map((entry, index) => positiveInteger(entry, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicates`);
  return Object.freeze(result);
}

function record(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  assertPlainObject(value, label);
  return value as Readonly<Record<string, unknown>>;
}

function parseFloorSnapshot(value: unknown, label: string): DungeonFloorSnapshot {
  const snapshot = record(value, label);
  assertExactObjectKeys(snapshot, [
    "schemaVersion", "definitionId", "floor", "seed", "currentRoomId", "previousRoomId", "exploredRoomIds",
    "clearedEncounterIds", "collectedTreasureIds", "registeredWaypointFloors", "completedKeys",
    "catchTypes", "catchRewardCollected", "encounterRosters", "generationGateDecisions",
  ], label);
  if (snapshot["schemaVersion"] !== 1) throw new Error(`${label} has unsupported schema`);
  const seed = normalizeSeed(snapshot["seed"]);
  const catchRewardCollected = snapshot["catchRewardCollected"];
  if (typeof catchRewardCollected !== "boolean") throw new Error(`${label}.catchRewardCollected must be boolean`);
  const encounterRosters = !Object.prototype.hasOwnProperty.call(snapshot, "encounterRosters")
    ? undefined
    : parseEncounterRosters(snapshot["encounterRosters"], `${label}.encounterRosters`);
  const generationGateDecisions = !Object.prototype.hasOwnProperty.call(snapshot, "generationGateDecisions")
    ? undefined
    : parseGenerationGateDecisions(snapshot["generationGateDecisions"], `${label}.generationGateDecisions`);
  return Object.freeze({
    schemaVersion: 1,
    definitionId: nonempty(snapshot["definitionId"], `${label}.definitionId`),
    floor: positiveInteger(snapshot["floor"], `${label}.floor`),
    seed,
    currentRoomId: nonempty(snapshot["currentRoomId"], `${label}.currentRoomId`),
    ...(snapshot["previousRoomId"] === undefined
      ? {}
      : { previousRoomId: nonempty(snapshot["previousRoomId"], `${label}.previousRoomId`) }),
    exploredRoomIds: stringArray(snapshot["exploredRoomIds"], `${label}.exploredRoomIds`),
    clearedEncounterIds: stringArray(snapshot["clearedEncounterIds"], `${label}.clearedEncounterIds`),
    collectedTreasureIds: stringArray(snapshot["collectedTreasureIds"], `${label}.collectedTreasureIds`),
    registeredWaypointFloors: positiveIntegerArray(
      snapshot["registeredWaypointFloors"], `${label}.registeredWaypointFloors`,
    ),
    completedKeys: stringArray(snapshot["completedKeys"], `${label}.completedKeys`),
    catchTypes: stringArray(snapshot["catchTypes"], `${label}.catchTypes`),
    catchRewardCollected,
    ...(encounterRosters === undefined ? {} : { encounterRosters }),
    ...(generationGateDecisions === undefined ? {} : { generationGateDecisions }),
  });
}

function parseEncounterRosters(value: unknown, label: string): readonly {
  readonly encounterId: string;
  readonly monsters: readonly DungeonMonster[];
}[] {
  assertOrdinaryArray(value, label);
  const ids = new Set<string>();
  const result = value.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    assertExactObjectKeys(item, ["encounterId", "monsters", "terminalFlowId"], `${label}[${index}]`);
    const encounterId = nonempty(item["encounterId"], `${label}[${index}].encounterId`);
    if (ids.has(encounterId)) throw new Error(`${label} contains duplicate encounter ${encounterId}`);
    ids.add(encounterId);
    assertOrdinaryArray(item["monsters"], `${label}[${index}].monsters`);
    const terminalFlowId = Object.prototype.hasOwnProperty.call(item, "terminalFlowId")
      ? nonempty(item["terminalFlowId"], `${label}[${index}].terminalFlowId`)
      : undefined;
    const monsters = item["monsters"].map((monster, monsterIndex) =>
      normalizeDungeonMonster(monster, `${label}[${index}].monsters[${monsterIndex}]`));
    return Object.freeze({
      encounterId,
      monsters: Object.freeze(monsters),
      ...(terminalFlowId === undefined ? {} : { terminalFlowId }),
    });
  });
  return Object.freeze(result);
}

function parseGenerationGateDecisions(
  value: unknown,
  label: string,
): readonly DungeonFixedEncounterGateSnapshot[] {
  assertOrdinaryArray(value, label);
  const seen = new Set<number>();
  return Object.freeze(value.map((entry, index) => {
    const item = record(entry, `${label}[${index}]`);
    assertExactObjectKeys(item, ["fixedIndex", "eligible"], `${label}[${index}]`);
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

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") throw new Error("cannot canonicalize non-JSON value");
  const object = value as Readonly<Record<string, unknown>>;
  return `{${Object.getOwnPropertyNames(object).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}

/** Strict, JSON-safe parser used at the save boundary and by DungeonRuntimeController.restore. */
export function parseDungeonRunSnapshot(value: unknown): DungeonRunSnapshot {
  assertJsonSafeTree(value, "dungeon run snapshot");
  const raw = record(value, "dungeon run snapshot");
  assertExactObjectKeys(raw, [
    "schemaVersion", "runSeed", "captureSerial", "terminalFlowSerial", "current", "cachedFloors",
    "registeredWaypoints", "registeredWaypointFloors", "completedKeys", "catchTypes",
    "completedCatchQuestInstances", "catchRewardCollected",
  ], "dungeon run snapshot");
  if (raw["schemaVersion"] !== 1) throw new Error("Unsupported dungeon-run snapshot");
  const current = normalizeCached(raw["current"], "dungeon run current");
  assertOrdinaryArray(raw["cachedFloors"], "dungeon run cachedFloors");
  const cachedFloors = raw["cachedFloors"].map((entry, index) =>
    normalizeCached(entry, `dungeon run cachedFloors[${index}]`));
  const cache = new Map<string, DungeonCachedFloorSnapshot>();
  for (const entry of cachedFloors) {
    const key = cacheKey(entry.route);
    if (cache.has(key)) throw new Error(`dungeon run contains duplicate cached floor ${key}`);
    cache.set(key, entry);
  }
  const currentCached = cache.get(cacheKey(current.route));
  if (currentCached === undefined) throw new Error("dungeon run current floor is absent from cachedFloors");
  if (canonicalJson(currentCached) !== canonicalJson(current)) {
    throw new Error("dungeon run current floor disagrees with cachedFloors");
  }

  const runSeed = raw["runSeed"] === undefined
    ? current.session.seed // migration from the early floor-only cache
    : normalizeSeed(raw["runSeed"]);
  const captureSerial = raw["captureSerial"] === undefined
    ? 0 // migration from snapshots written before dungeon captures were durable
    : nonnegativeInteger(raw["captureSerial"], "dungeon run captureSerial");
  const terminalFlowSerial = raw["terminalFlowSerial"] === undefined
    ? 0
    : nonnegativeInteger(raw["terminalFlowSerial"], "dungeon run terminalFlowSerial");
  const waypoints: DungeonWaypointSnapshot[] = [];
  const waypointKeys = new Set<string>();
  const hasRegisteredWaypoints = Object.prototype.hasOwnProperty.call(raw, "registeredWaypoints");
  const hasLegacyWaypointFloors = Object.prototype.hasOwnProperty.call(raw, "registeredWaypointFloors");
  const legacyFloors = hasLegacyWaypointFloors
    ? positiveIntegerArray(raw["registeredWaypointFloors"], "dungeon run registeredWaypointFloors")
    : undefined;
  if (hasRegisteredWaypoints) {
    assertOrdinaryArray(raw["registeredWaypoints"], "dungeon run registeredWaypoints");
    raw["registeredWaypoints"].forEach((value, index) => {
      const item = record(value, `dungeon run registeredWaypoints[${index}]`);
      assertExactObjectKeys(item, ["route"], `dungeon run registeredWaypoints[${index}]`);
      const route = waypointRoute(normalizeRoute(item["route"]));
      const key = cacheKey(route);
      if (waypointKeys.has(key)) throw new Error(`dungeon run contains duplicate waypoint ${key}`);
      waypointKeys.add(key);
      waypoints.push(Object.freeze({ route }));
    });
  } else {
    const floors = legacyFloors;
    if (floors === undefined) throw new Error("dungeon run registeredWaypoints is absent");
    for (const floor of floors) {
      const route = waypointRoute({ ...current.route, floor });
      const key = cacheKey(route);
      waypointKeys.add(key);
      waypoints.push(Object.freeze({ route }));
    }
  }
  waypoints.sort((left, right) => compareRoutes(left.route, right.route));

  const completedKeys = stringArray(raw["completedKeys"], "dungeon run completedKeys");
  const catchTypes = stringArray(raw["catchTypes"], "dungeon run catchTypes");
  const completedCatchQuestInstances = raw["completedCatchQuestInstances"] === undefined
    ? Object.freeze([] as string[])
    : stringArray(
        raw["completedCatchQuestInstances"],
        "dungeon run completedCatchQuestInstances",
      );
  const catchRewardCollected = raw["catchRewardCollected"];
  if (typeof catchRewardCollected !== "boolean") {
    throw new Error("dungeon run catchRewardCollected must be boolean");
  }
  return Object.freeze({
    schemaVersion: 1,
    runSeed,
    captureSerial,
    terminalFlowSerial,
    current,
    cachedFloors: Object.freeze(cachedFloors),
    registeredWaypoints: Object.freeze(waypoints),
    completedKeys,
    catchTypes,
    completedCatchQuestInstances,
    catchRewardCollected,
  });
}

/** Compatibility signature for the synthetic topology written before native room IDs landed. */
export function dungeonRunUsesLegacyTopology(snapshot: DungeonRunSnapshot): boolean {
  const floors = [snapshot.current, ...snapshot.cachedFloors];
  return floors.some(({ session }) =>
    /^room-\d+$/.test(session.currentRoomId) ||
    session.exploredRoomIds.some((id) => /^room-\d+$/.test(id)),
  );
}

/**
 * Legacy schema-1 floor snapshots carry synthetic `room-N` geometry. The native generator cannot
 * prove that a legacy encounter, chest, or roster id denotes the same authored entity, so those
 * floor-scoped mutations are accepted only in their safe empty/omitted form. Run-level progress
 * remains usable when its duplicated floor projection is consistent with the run projection.
 */
function validateLegacyTopologyState(
  context: DungeonRuntimeContext,
  snapshot: DungeonRunSnapshot,
): ReadonlyMap<string, DungeonDefinition> {
  const registeredWaypointKeys = new Set(snapshot.registeredWaypoints.map(({ route }) => cacheKey(route)));
  const completedKeys = new Set(snapshot.completedKeys);
  const catchTypes = new Set(snapshot.catchTypes);
  const cachedEntries = new Map<string, DungeonCachedFloorSnapshot>();
  const definitions = new Map<string, DungeonDefinition>();

  for (const entry of [snapshot.current, ...snapshot.cachedFloors]) {
    const key = cacheKey(entry.route);
    const definition = loadDefinition(context, entry.route);
    if (entry.session.definitionId !== dungeonDefinitionId(definition)) {
      throw new Error(
        `Dungeon legacy floor ${key} definition mismatch: ` +
        `${entry.session.definitionId} does not match ${dungeonDefinitionId(definition)}`,
      );
    }
    cachedEntries.set(key, entry);
    definitions.set(key, definition);
  }

  const completedCatchQuestInstances = new Set(snapshot.completedCatchQuestInstances ?? []);
  const catchDefinitionsByInstance = new Map(
    [...definitions.values()].map((definition) => [definition.instanceName, definition.catchQuest !== undefined]),
  );
  const definitionInstanceNames = new Set(catchDefinitionsByInstance.keys());
  for (const instanceName of completedCatchQuestInstances) {
    if (!definitionInstanceNames.has(instanceName) || catchDefinitionsByInstance.get(instanceName) !== true) {
      throw new Error(
        `Dungeon legacy catch instance ${instanceName} cannot be verified against cached definitions`,
      );
    }
  }
  const currentKey = cacheKey(snapshot.current.route);
  const currentDefinition = definitions.get(currentKey)!;
  const currentRewardCollected = snapshot.current.session.catchRewardCollected;
  if (currentRewardCollected && currentDefinition.catchQuest === undefined) {
    throw new Error(
      `Dungeon legacy current catch reward cannot be verified for a floor without a catch quest`,
    );
  }
  if (currentRewardCollected !== snapshot.catchRewardCollected) {
    throw new Error(
      `Dungeon legacy current catch reward cannot be verified: it disagrees with the top-level catch reward projection`,
    );
  }
  if (currentRewardCollected !== completedCatchQuestInstances.has(currentDefinition.instanceName)) {
    throw new Error(
      `Dungeon legacy current catch reward and instance completion cannot be verified to coexist consistently`,
    );
  }

  for (const waypoint of snapshot.registeredWaypoints) {
    const key = cacheKey(waypoint.route);
    if (!cachedEntries.has(key) || !definitions.has(key)) {
      throw new Error(
        `Dungeon legacy waypoint ${key} cannot be verified against an accepted cached definition`,
      );
    }
  }

  for (const { route, session } of [snapshot.current, ...snapshot.cachedFloors]) {
    if (session.floor !== route.floor) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} floor does not match its route`);
    }
    if (!/^room-\d+$/.test(session.currentRoomId)) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} current room is unsupported`);
    }
    if (!session.exploredRoomIds.includes(session.currentRoomId)) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} current room is not explored`);
    }
    if (session.exploredRoomIds.some((id) => !/^room-\d+$/.test(id))) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} explored room state is unsupported`);
    }
    if (session.previousRoomId !== undefined && !/^room-\d+$/.test(session.previousRoomId)) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} previous room is unsupported`);
    }
    if (session.registeredWaypointFloors.some((floor) => floor !== route.floor)) {
      throw new Error(
        `Dungeon legacy floor ${cacheKey(route)} waypoint state cannot be verified for another floor`,
      );
    }
    if (session.clearedEncounterIds.length > 0) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} cleared encounters cannot be verified`);
    }
    if (session.collectedTreasureIds.length > 0) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} collected treasure cannot be verified`);
    }
    if (Object.prototype.hasOwnProperty.call(session, "encounterRosters")) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} encounter rosters cannot be verified`);
    }
    if (Object.prototype.hasOwnProperty.call(session, "generationGateDecisions")) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} generation decisions cannot be verified`);
    }
    for (const floor of session.registeredWaypointFloors) {
      const waypoint = waypointRoute({ ...route, floor });
      if (!registeredWaypointKeys.has(cacheKey(waypoint))) {
        throw new Error(`Dungeon legacy floor ${cacheKey(route)} waypoint state cannot be verified`);
      }
    }
    for (const key of session.completedKeys) {
      if (!completedKeys.has(key)) {
        throw new Error(
          `Dungeon legacy floor ${cacheKey(route)} completed key cannot be verified as run-level progress`,
        );
      }
    }
    for (const type of session.catchTypes) {
      if (!catchTypes.has(type)) {
        throw new Error(
          `Dungeon legacy floor ${cacheKey(route)} catch progress cannot be verified as run-level progress`,
        );
      }
    }
    const definition = definitions.get(cacheKey(route))!;
    if (session.catchRewardCollected && definition.catchQuest === undefined) {
      throw new Error(
        `Dungeon legacy floor ${cacheKey(route)} catch reward cannot be verified for a floor without a catch quest`,
      );
    }
    if (session.catchRewardCollected !== completedCatchQuestInstances.has(definition.instanceName)) {
      throw new Error(
        `Dungeon legacy floor ${cacheKey(route)} catch reward cannot be verified against its catch instance`,
      );
    }
  }
  return definitions;
}

function validateLegacyPreviousRoomIds(snapshot: DungeonRunSnapshot): void {
  for (const { route, session } of [snapshot.current, ...snapshot.cachedFloors]) {
    const previousRoomId = session.previousRoomId;
    if (previousRoomId === undefined) continue;
    const serializedRoomIds = new Set([session.currentRoomId, ...session.exploredRoomIds]);
    if (!serializedRoomIds.has(previousRoomId)) {
      throw new Error(
        `Dungeon legacy floor ${cacheKey(route)} previous room ${previousRoomId} is missing or unsupported`,
      );
    }
    if (previousRoomId === session.currentRoomId) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} previous room must differ from current room`);
    }
    if (!session.exploredRoomIds.includes(previousRoomId)) {
      throw new Error(`Dungeon legacy floor ${cacheKey(route)} previous room ${previousRoomId} is not explored`);
    }
  }
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function instanceIdSegment(value: string | number): string {
  return encodeURIComponent(String(value)).replaceAll("%", "_");
}

function normalizeRosterHooks(
  value: void | DungeonRoomRosterUpdateHooks | undefined,
): DungeonRoomRosterUpdateHooks | undefined {
  return value === undefined ? undefined : value as DungeonRoomRosterUpdateHooks;
}

/** Stable identifier exposed for diagnostics and save migrations. */
export function dungeonRuntimeDefinitionId(controller: Pick<DungeonRuntimeController, "definition">): string {
  return dungeonDefinitionId(controller.definition);
}
