import { describe, expect, it } from "vitest";
import {
  CurrentLogicPackDescriptorV1Schema,
  GAME_COMMAND_TYPES_V1,
  GAME_PROTOCOL_VERSION,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  type GameCommandEnvelopeV1,
  type LogicPackCapabilitiesV1,
  type LogicPackDescriptorV1,
  type OfficialGameProjectionBodyV12,
} from "@dib/game-protocol";
import {
  AuthoritativeGameService,
  GameServiceError,
  InMemoryAuthoritativeSlotStore,
  ReducerFaultError,
  type GameCommandReducer,
} from "../src/index.js";

interface TestState {
  readonly poi: string;
  readonly visits: number;
}

const pack: LogicPackDescriptorV1 = {
  logicPackId: `logic-v1:${"a".repeat(64)}`,
  simulationVersion: "official-game-v11",
  trustTier: "official",
  capabilities: {
    slot: true,
    world: true,
    battle: false,
    capture: false,
    spirit: false,
    party: false,
    economy: false,
    dungeon: false,
    quests: false,
    plot: false,
    tournaments: false,
    commandTypes: ["slot.create", "world.navigate"],
  },
};

const reducer: GameCommandReducer<TestState> = {
  apply(context, command) {
    if (command.type === "slot.create") {
      if (context.state !== undefined) throw new Error("test reducer received duplicate creation");
      return {
        state: { poi: "First_City", visits: 0 },
        projection: projection("First_City", "decision-1"),
        events: [{ type: "slot.created" }],
      };
    }
    if (command.type === "world.navigate") {
      if (context.state === undefined) throw new Error("test reducer received missing state");
      const state = { poi: command.targetPoiId, visits: context.state.visits + 1 };
      return {
        state,
        projection: projection(state.poi, `decision-${context.previousRevision + 1}`),
        events: [{
          type: "world.arrived",
          worldId: "World_1-1",
          poiId: state.poi,
          movement: "walk",
          randomDraws: [],
        }],
      };
    }
    throw new GameServiceError("ACTION_NOT_ALLOWED", `${command.type} is not implemented by test reducer`);
  },
};

function projection(poi: string, decisionId: string) {
  return {
    player: {
      heroLevel: 1,
      heroTotalHighestLevels: 1,
      silver: 0,
      gold: 0,
      captureCards: { 1: 0, 2: 0, 3: 0 },
      party: [],
      battingOrderSize: 6,
      battingOrderIds: [],
      ownedSoulStones: [],
      highestCapturedLevels: {},
      learnedCombineRecipes: [],
      tutorialFlags: [],
      catchQuestsDone: [],
      items: {},
      spirit: { energy: 0, savedXp: {}, usedThisTrip: [] },
    },
    location: { kind: "world" as const, worldId: "World_1-1", poiId: poi },
    decision: {
      type: "world.ready" as const,
      decisionId,
      selectablePoiIds: ["First_City", "Forest"],
    },
  };
}

function command(
  commandId: string,
  expectedRevision: number,
  body: GameCommandEnvelopeV1["command"],
  expectedDecisionId?: string,
): GameCommandEnvelopeV1 {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    commandId,
    expectedRevision,
    ...(expectedDecisionId === undefined ? {} : { expectedDecisionId }),
    command: body,
  };
}

function currentCapabilities(
  commandTypes: LogicPackCapabilitiesV1["commandTypes"],
): LogicPackCapabilitiesV1 {
  return {
    slot: true,
    world: true,
    battle: false,
    capture: false,
    spirit: false,
    party: false,
    economy: false,
    dungeon: false,
    quests: false,
    plot: false,
    tournaments: false,
    commandTypes,
  };
}

const exactV12Pack: LogicPackDescriptorV1 = {
  logicPackId: `logic-v1:${"b".repeat(64)}`,
  simulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
  trustTier: "official",
  capabilities: currentCapabilities([...GAME_COMMAND_TYPES_V1]),
};

interface V12TestState {
  readonly claims: readonly string[];
}

function projectionV12(poi: string, decisionId: string, claimedGoalIds: readonly string[] = []) {
  return {
    ...projection(poi, decisionId),
    collectionClaims: {
      schemaVersion: 1 as const,
      claimedGoalIds: [...claimedGoalIds],
    },
  } satisfies OfficialGameProjectionBodyV12;
}

const v12Reducer: GameCommandReducer<V12TestState, OfficialGameProjectionBodyV12> = {
  apply(context, body) {
    if (body.type === "slot.create") {
      return {
        state: { claims: [] },
        projection: projectionV12("First_City", "v12-decision-1"),
        events: [{ type: "slot.created" }],
      };
    }
    if (body.type === "collection.claim") {
      const claims = [...(context.state?.claims ?? []), body.goalId].sort();
      return {
        state: { claims },
        projection: projectionV12("First_City", "v12-decision-1", claims),
        events: [],
      };
    }
    throw new GameServiceError("ACTION_NOT_ALLOWED", `${body.type} is not implemented by v12 test reducer`);
  },
};

describe("AuthoritativeGameService", () => {
  it("does not commit reducer faults and lets a later independent intent proceed", async () => {
    const store = new InMemoryAuthoritativeSlotStore<TestState>();
    const cause = new Error("deterministic reducer defect");
    let fail = true;
    const service = new AuthoritativeGameService({
      pack, store,
      reducer: { apply: (context, body) => {
        if (fail) throw cause;
        return reducer.apply(context, body);
      } } satisfies GameCommandReducer<TestState>,
    });
    const create = command("reducer-fault-create-01", 0, { type: "slot.create", starterElement: "Water" });
    await expect(service.execute("p", "slot-1", create)).rejects.toMatchObject({
      name: "ReducerFaultError", code: "INTERNAL", cause, options: { retryable: false },
    });
    expect(await store.read("p", "slot-1")).toBeUndefined();
    fail = false;
    expect((await service.execute("p", "slot-1", { ...create, commandId: "reducer-recovered-01" })).revision)
      .toBe(1);
  });

  it("preserves typed reducer refusals and leaves storage uncertainty outside the fault boundary", async () => {
    const refusal = new GameServiceError("ACTION_NOT_ALLOWED", "typed refusal");
    const create = command("typed-refusal-create-01", 0, { type: "slot.create", starterElement: "Water" });
    const refusing = new AuthoritativeGameService<TestState>({
      pack, reducer: { apply: () => { throw refusal; } },
    });
    await expect(refusing.execute("p", "slot-1", create)).rejects.toBe(refusal);

    const diskFailure = new Error("storage outcome uncertain");
    const uncertain = new AuthoritativeGameService<TestState>({
      pack, reducer,
      store: {
        read: async () => undefined,
        list: async () => [],
        transact: async (_player, _slot, reduce) => {
          await reduce(undefined);
          throw diskFailure;
        },
      },
    });
    const rejected = uncertain.execute("p", "slot-1", create);
    await expect(rejected).rejects.toBe(diskFailure);
    await expect(rejected).rejects.not.toBeInstanceOf(ReducerFaultError);
  });

  it("creates state only through the trusted reducer", async () => {
    const service = new AuthoritativeGameService({ pack, reducer, now: () => 1_700_000_000_000 });
    const result = await service.execute("player-a", "slot-1", command(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Fire" },
    ));
    expect(result).toMatchObject({
      previousRevision: 0,
      revision: 1,
      events: [{ seq: 1, type: "slot.created" }],
      projection: {
        updatedAt: "2023-11-14T22:13:20.000Z",
        trustTier: "official",
        location: { poiId: "First_City" },
      },
    });
    expect(await service.listSlots("player-a")).toMatchObject([
      { slotId: "slot-1", revision: 1, activeDomain: "world" },
    ]);
  });

  it("returns the exact committed result for an identical retry without applying twice", async () => {
    const service = new AuthoritativeGameService({ pack, reducer });
    const create = command("command_create_0001", 0, { type: "slot.create", starterElement: "Water" });
    const first = await service.execute("player-a", "slot-1", create);
    const replay = await service.execute("player-a", "slot-1", create);
    expect(replay).toEqual({ ...first, idempotentReplay: true });
    expect((await service.bootstrap("player-a", "slot-1")).revision).toBe(1);
  });

  it("validates the persisted aggregate before receipts, bootstrap, and slot summaries", async () => {
    const store = new InMemoryAuthoritativeSlotStore<TestState>();
    const create = command("command_create_0001", 0, { type: "slot.create", starterElement: "Water" });
    const first = await new AuthoritativeGameService({ pack, reducer, store }).execute(
      "player-a",
      "slot-1",
      create,
    );
    await store.transact("player-a", "slot-1", async (current) => {
      if (current === undefined) throw new Error("test slot missing");
      return {
        record: { ...current, state: { ...current.state, poi: "foreign" } },
        value: undefined,
      };
    });
    let applications = 0;
    const guarded = new AuthoritativeGameService({
      pack,
      reducer: {
        apply(context, body) {
          applications += 1;
          return reducer.apply(context, body);
        },
      },
      store,
      validateRecord: ({ state }) => {
        if (state.poi === "foreign") throw new Error("persisted state is foreign");
      },
    });
    await expect(guarded.bootstrap("player-a", "slot-1")).rejects.toMatchObject({
      code: "STATE_CORRUPT",
    });
    await expect(guarded.listSlots("player-a")).rejects.toMatchObject({
      code: "STATE_CORRUPT",
    });
    await expect(guarded.execute("player-a", "slot-1", create)).rejects.toMatchObject({
      code: "STATE_CORRUPT",
    });
    expect(first.revision).toBe(1);
    expect(applications).toBe(0);
  });

  it("fails closed on an unmatched malformed receipt supplied by any store adapter", async () => {
    const store = new InMemoryAuthoritativeSlotStore<TestState>();
    const create = command("command_create_0001", 0, {
      type: "slot.create",
      starterElement: "Water",
    });
    await new AuthoritativeGameService({ pack, reducer, store }).execute(
      "player-a",
      "slot-1",
      create,
    );
    await store.transact("player-a", "slot-1", async (current) => {
      if (current === undefined) throw new Error("test slot missing");
      const receipts = new Map(current.receipts);
      receipts.set("unrelated_poison_0001", {
        canonicalEnvelope: "{}",
        result: { garbage: true },
      } as never);
      return { record: { ...current, receipts }, value: undefined };
    });

    await expect(new AuthoritativeGameService({ pack, reducer, store })
      .bootstrap("player-a", "slot-1")).rejects.toMatchObject({ code: "STATE_CORRUPT" });
    await expect(new AuthoritativeGameService({ pack, reducer, store })
      .listSlots("player-a")).rejects.toMatchObject({ code: "STATE_CORRUPT" });
    await expect(new AuthoritativeGameService({ pack, reducer, store })
      .execute("player-a", "slot-1", command(
        "command_nav_forest_1",
        1,
        { type: "world.navigate", targetPoiId: "Forest" },
        "decision-1",
      ))).rejects.toMatchObject({ code: "STATE_CORRUPT" });
  });

  it("fails closed on a well-shaped receipt pinned to another generation", async () => {
    const store = new InMemoryAuthoritativeSlotStore<TestState>();
    await new AuthoritativeGameService({ pack, reducer, store }).execute(
      "player-a",
      "slot-1",
      command("command_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
    );
    await store.transact("player-a", "slot-1", async (current) => {
      if (current === undefined) throw new Error("test slot missing");
      const receipts = new Map(current.receipts);
      const stored = receipts.get("command_create_0001");
      if (stored === undefined) throw new Error("test receipt missing");
      receipts.set("command_create_0001", {
        ...stored,
        result: {
          ...stored.result,
          projection: {
            ...stored.result.projection,
            simulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
          },
        },
      } as never);
      return { record: { ...current, receipts }, value: undefined };
    });

    await expect(new AuthoritativeGameService({ pack, reducer, store })
      .bootstrap("player-a", "slot-1")).rejects.toMatchObject({ code: "STATE_CORRUPT" });
  });

  it("fails closed on a receipt whose stored envelope is malformed or belongs to another key", async () => {
    for (const canonicalEnvelope of ["{", JSON.stringify(command(
      "another_command_id",
      0,
      { type: "slot.create", starterElement: "Water" },
    ))]) {
      const store = new InMemoryAuthoritativeSlotStore<TestState>();
      await new AuthoritativeGameService({ pack, reducer, store }).execute(
        "player-a",
        "slot-1",
        command("command_create_0001", 0, { type: "slot.create", starterElement: "Water" }),
      );
      await store.transact("player-a", "slot-1", async (current) => {
        if (current === undefined) throw new Error("test slot missing");
        const receipts = new Map(current.receipts);
        const stored = receipts.get("command_create_0001");
        if (stored === undefined) throw new Error("test receipt missing");
        receipts.set("command_create_0001", { ...stored, canonicalEnvelope });
        return { record: { ...current, receipts }, value: undefined };
      });
      await expect(new AuthoritativeGameService({ pack, reducer, store })
        .bootstrap("player-a", "slot-1")).rejects.toMatchObject({ code: "STATE_CORRUPT" });
    }
  });

  it("rejects command-id reuse with a different body before revision or RNG work", async () => {
    const service = new AuthoritativeGameService({ pack, reducer });
    await service.execute("player-a", "slot-1", command(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await expect(service.execute("player-a", "slot-1", command(
      "command_create_0001",
      1,
      { type: "world.navigate", targetPoiId: "Forest" },
      "decision-1",
    ))).rejects.toMatchObject({ code: "COMMAND_DUPLICATE_MISMATCH" });
  });

  it("serializes concurrent mutations so only one stale command can commit", async () => {
    const service = new AuthoritativeGameService({ pack, reducer });
    await service.execute("player-a", "slot-1", command(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    const attempts = await Promise.allSettled([
      service.execute("player-a", "slot-1", command(
        "command_nav_forest_1",
        1,
        { type: "world.navigate", targetPoiId: "Forest" },
        "decision-1",
      )),
      service.execute("player-a", "slot-1", command(
        "command_nav_city_0001",
        1,
        { type: "world.navigate", targetPoiId: "First_City" },
        "decision-1",
      )),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "REVISION_CONFLICT" } });
    expect((await service.bootstrap("player-a", "slot-1")).revision).toBe(2);
  });

  it("rejects a stale decision even when the revision is current", async () => {
    const service = new AuthoritativeGameService({ pack, reducer });
    await service.execute("player-a", "slot-1", command(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await expect(service.execute("player-a", "slot-1", command(
      "command_nav_forest_1",
      1,
      { type: "world.navigate", targetPoiId: "Forest" },
      "decision-old",
    ))).rejects.toMatchObject({ code: "DECISION_STALE" });
  });

  it("fails closed for a disabled mechanics capability", async () => {
    const service = new AuthoritativeGameService({ pack, reducer });
    await service.execute("player-a", "slot-1", command(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await expect(service.execute("player-a", "slot-1", command(
      "command_battle_00001",
      1,
      { type: "battle.delay", battleId: "battle-1", actorId: "monster-1" },
      "decision-1",
    ))).rejects.toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
  });

  it("rejects a historical settlement command from a current pack before reducer execution", async () => {
    const currentPack: LogicPackDescriptorV1 = {
      ...pack,
      capabilities: currentCapabilities(["slot.create"]),
    };
    expect(CurrentLogicPackDescriptorV1Schema.safeParse(currentPack).success).toBe(false);
    let applications = 0;
    const service = new AuthoritativeGameService<TestState>({
      pack: currentPack,
      reducer: {
        apply(context, body) {
          applications += 1;
          return reducer.apply(context, body);
        },
      },
    });
    await service.execute("player-a", "slot-1", command(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await expect(service.execute("player-a", "slot-1", command(
      "command_settle_live_0001",
      1,
      { type: "tournament.settlePrize" },
    ))).rejects.toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    expect(applications).toBe(1);
  });

  it("rejects historical settlement admission on the exact v12 pack", async () => {
    let applications = 0;
    const service = new AuthoritativeGameService<V12TestState>({
      pack: exactV12Pack,
      reducer: {
        apply(context, body) {
          applications += 1;
          return v12Reducer.apply(context, body);
        },
      },
    });
    await service.execute("v12-settlement-player", "slot-1", command(
      "command_v12_settlement_create",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await expect(service.execute("v12-settlement-player", "slot-1", command(
      "command_v12_settlement_live",
      1,
      { type: "tournament.settlePrize" },
    ))).rejects.toMatchObject({ code: "CAPABILITY_UNSUPPORTED" });
    expect(applications).toBe(1);
  });

  it("parses the installed descriptor before accepting or exposing the service pack", () => {
    const installedV11Pack: LogicPackDescriptorV1 = {
      ...pack,
    };
    const installedV12Pack: LogicPackDescriptorV1 = {
      ...pack,
      simulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
      capabilities: currentCapabilities(["slot.create"]),
    };
    expect(new AuthoritativeGameService({ pack: installedV11Pack, reducer }).pack)
      .toEqual(installedV11Pack);
    expect(new AuthoritativeGameService({ pack: installedV12Pack, reducer }).pack)
      .toEqual(installedV12Pack);

    const futureCommandsInV11: LogicPackDescriptorV1 = {
      ...pack,
      simulationVersion: "official-game-v11",
      capabilities: currentCapabilities(["slot.create", "egg.start"]),
    };
    expect(() => new AuthoritativeGameService({ pack: futureCommandsInV11, reducer }))
      .toThrow();

    const historicalCommandsInV12 = {
      ...pack,
      simulationVersion: "official-game-v12",
      capabilities: {
        ...pack.capabilities,
        commandTypes: ["slot.create", "tournament.settlePrize"],
      },
    } as unknown as LogicPackDescriptorV1;
    expect(() => new AuthoritativeGameService({ pack: historicalCommandsInV12, reducer }))
      .toThrow();
  });

  it("preserves opaque non-enumerable descriptor metadata only in the reducer context", async () => {
    const provenance = Symbol("operator-local-provenance");
    const metadata = Object.freeze({ supportIdentity: "operator-support-1" });
    const descriptor = Object.defineProperty({ ...pack }, provenance, {
      value: metadata,
      enumerable: false,
      writable: false,
      configurable: false,
    }) as LogicPackDescriptorV1;
    let contextPack: LogicPackDescriptorV1 | undefined;
    const contextReducer: GameCommandReducer<TestState> = {
      apply(context, body) {
        contextPack = context.pack;
        return reducer.apply(context, body);
      },
    };
    const store = new InMemoryAuthoritativeSlotStore<TestState>();
    const service = new AuthoritativeGameService({
      pack: descriptor,
      reducer: contextReducer,
      store,
    });

    expect(Object.isFrozen(service.pack)).toBe(true);
    expect(Object.keys(service.pack)).not.toContain(provenance.description);
    expect((service.pack as unknown as Record<symbol, unknown>)[provenance]).toBe(metadata);
    expect(JSON.stringify(service.pack)).not.toContain("operator-support-1");

    const result = await service.execute("opaque-player", "slot-1", command(
      "opaque-create-0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    expect(contextPack).toBe(service.pack);
    expect((contextPack as unknown as Record<symbol, unknown>)[provenance]).toBe(metadata);
    expect(JSON.stringify(result)).not.toContain("operator-support-1");
    const record = await store.read("opaque-player", "slot-1");
    expect(record).toBeDefined();
    expect(JSON.stringify(record)).not.toContain("operator-support-1");
  });

  it("keeps enumerable descriptor strictness while ignoring opaque symbol metadata", () => {
    const provenance = Symbol("operator-local-provenance");
    const descriptor = Object.defineProperty({ ...pack }, provenance, {
      value: Object.freeze({ supportIdentity: "operator-support-2" }),
      enumerable: false,
    }) as LogicPackDescriptorV1;
    expect(() => new AuthoritativeGameService({
      pack: { ...descriptor, unexpected: true } as LogicPackDescriptorV1,
      reducer,
    })).toThrow();
    expect(new AuthoritativeGameService({ pack: descriptor, reducer }).pack)
      .toMatchObject(pack);
  });

  it("rejects every unknown simulation version before store or reducer effects", async () => {
    const store = new InMemoryAuthoritativeSlotStore<TestState>();
    let applications = 0;
    // Deliberately one past the installed authority: v25 is installed, so v26 is genuinely
    // unknown until its layer actually exists.
    const unknownPack: LogicPackDescriptorV1 = {
      ...pack,
      simulationVersion: "official-game-v26",
    };
    expect(() => new AuthoritativeGameService({
      pack: unknownPack,
      store,
      reducer: {
        apply(context, body) {
          applications += 1;
          return reducer.apply(context, body);
        },
      },
    })).toThrow(/unsupported|installed|simulation version/i);
    expect(applications).toBe(0);
    expect(await store.read("unknown-version-player", "slot-1")).toBeUndefined();
  });

  it("gates an active continuation by its projected decision ID before reduction", async () => {
    let applications = 0;
    const service = new AuthoritativeGameService<V12TestState>({
      pack: exactV12Pack,
      reducer: {
        apply(context, body) {
          applications += 1;
          if (body.type !== "slot.create") return v12Reducer.apply(context, body);
          return {
            ...v12Reducer.apply(context, body),
            projection: {
              ...projectionV12("First_City", "decision-egg-1"),
              pendingEgg: {
                schemaVersion: 1 as const,
                decisionId: "decision-egg-1",
                continuationId: "egg-continuation-1",
                kind: "silver" as const,
                origin: "collection" as const,
                remainingRepeats: 1 as const,
                phase: "awaiting-spin" as const,
              },
              decision: {
                type: "egg.awaitingSpin" as const,
                decisionId: "decision-egg-1",
                continuationId: "egg-continuation-1",
                kind: "silver" as const,
                origin: "collection" as const,
                remainingRepeats: 1 as const,
              },
            },
          };
        },
      },
    });
    await service.execute("player-a", "slot-1", command(
      "command_create_0001",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    await expect(service.execute("player-a", "slot-1", command(
      "command_egg_gate_0001",
      1,
      { type: "egg.start" },
    ))).rejects.toMatchObject({ code: "DECISION_STALE" });
    await expect(service.execute("player-a", "slot-1", command(
      "command_egg_gate_0002",
      1,
      { type: "egg.start" },
      "decision-other",
    ))).rejects.toMatchObject({ code: "DECISION_STALE" });
    expect(applications).toBe(1);
  });

  it("persists, replays, lists, and bootstraps a strict v12 projection with claims", async () => {
    const service = new AuthoritativeGameService({
      pack: exactV12Pack,
      reducer: v12Reducer,
      now: () => 1_700_000_000_000,
    });
    const create = await service.execute("player-v12", "slot-1", command(
      "command_v12_create_0001",
      0,
      { type: "slot.create", starterElement: "Fire" },
    ));
    const claim = command(
      "command_v12_claim_0001",
      1,
      { type: "collection.claim", goalId: "goal-a" },
      "v12-decision-1",
    );
    const committed = await service.execute("player-v12", "slot-1", claim);
    expect(committed.projection.collectionClaims).toEqual({
      schemaVersion: 1,
      claimedGoalIds: ["goal-a"],
    });
    expect(JSON.stringify(await service.bootstrap("player-v12", "slot-1")))
      .toBe(JSON.stringify(committed.projection));
    expect((await service.listSlots("player-v12"))[0]).toMatchObject({
      simulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
      revision: 2,
    });

    const replay = await service.execute("player-v12", "slot-1", claim);
    expect(replay).toEqual({ ...committed, idempotentReplay: true });
    expect(JSON.stringify(replay.projection)).toBe(JSON.stringify(committed.projection));
    expect(create.projection.collectionClaims).toEqual({ schemaVersion: 1, claimedGoalIds: [] });
  });

  it("rejects an impossible v12 awaiting-spin projection and accepts a legitimate post-repeat projection", async () => {
    const impossiblePendingEgg = {
      schemaVersion: 1 as const,
      continuationId: "service-impossible-continuation",
      decisionId: "service-impossible-decision",
      kind: "silver" as const,
      origin: "collection" as const,
      remainingRepeats: 0 as const,
      phase: "awaiting-spin" as const,
    };
    const impossibleService = new AuthoritativeGameService({
      pack: exactV12Pack,
      reducer: {
        apply() {
          return {
            state: { claims: [] },
            projection: {
              ...projectionV12("First_City", "service-impossible-decision"),
              pendingEgg: impossiblePendingEgg,
              decision: {
                type: "egg.awaitingSpin" as const,
                decisionId: impossiblePendingEgg.decisionId,
                continuationId: impossiblePendingEgg.continuationId,
                kind: impossiblePendingEgg.kind,
                origin: impossiblePendingEgg.origin,
                remainingRepeats: impossiblePendingEgg.remainingRepeats,
              },
            },
            events: [{ type: "slot.created" as const }],
          };
        },
      },
    });
    await expect(impossibleService.execute("invalid-v12", "slot-1", command(
      "command_invalid_v12_01",
      0,
      { type: "slot.create", starterElement: "Water" },
    ))).rejects.toMatchObject({ code: "STATE_CORRUPT" });

    const postRepeatPendingEgg = {
      schemaVersion: 1 as const,
      continuationId: "service-post-repeat-continuation",
      decisionId: "service-post-repeat-decision",
      kind: "silver" as const,
      origin: "collection" as const,
      remainingRepeats: 0 as const,
      phase: "awaiting-repeat-or-finish" as const,
      settledPrize: { kind: "gold" as const, amount: 1 },
      resolution: { kind: "keep" as const },
    };
    const postRepeatService = new AuthoritativeGameService({
      pack: exactV12Pack,
      reducer: {
        apply() {
          return {
            state: { claims: [] },
            projection: {
              ...projectionV12("First_City", postRepeatPendingEgg.decisionId),
              pendingEgg: postRepeatPendingEgg,
              decision: {
                type: "egg.awaitingRepeatOrFinish" as const,
                decisionId: postRepeatPendingEgg.decisionId,
                continuationId: postRepeatPendingEgg.continuationId,
                kind: postRepeatPendingEgg.kind,
                origin: postRepeatPendingEgg.origin,
                remainingRepeats: postRepeatPendingEgg.remainingRepeats,
                settledPrize: postRepeatPendingEgg.settledPrize,
                resolution: postRepeatPendingEgg.resolution,
              },
            },
            events: [{ type: "slot.created" as const }],
          };
        },
      },
    });
    const accepted = await postRepeatService.execute("valid-v12", "slot-1", command(
      "command_valid_v12_01",
      0,
      { type: "slot.create", starterElement: "Water" },
    ));
    expect(accepted.projection.pendingEgg?.phase).toBe("awaiting-repeat-or-finish");
    expect(accepted.projection.pendingEgg?.remainingRepeats).toBe(0);
  });

  it("rejects v11/v12 projection shape mismatches before a slot is committed", async () => {
    const v12Store = new InMemoryAuthoritativeSlotStore<TestState>();
    const v12ServiceWithV11Reducer = new AuthoritativeGameService({
      pack: exactV12Pack,
      reducer,
      store: v12Store,
    });
    await expect(v12ServiceWithV11Reducer.execute("mismatch-v12", "slot-1", command(
      "command_mismatch_v12_01",
      0,
      { type: "slot.create", starterElement: "Water" },
    ))).rejects.toThrow();
    expect(await v12Store.read("mismatch-v12", "slot-1")).toBeUndefined();

    const v11Store = new InMemoryAuthoritativeSlotStore<V12TestState>();
    const v11ServiceWithV12Reducer = new AuthoritativeGameService({
      pack,
      reducer: v12Reducer,
      store: v11Store,
    });
    await expect(v11ServiceWithV12Reducer.execute("mismatch-v11", "slot-1", command(
      "command_mismatch_v11_01",
      0,
      { type: "slot.create", starterElement: "Earth" },
    ))).rejects.toThrow();
    expect(await v11Store.read("mismatch-v11", "slot-1")).toBeUndefined();
  });
});
