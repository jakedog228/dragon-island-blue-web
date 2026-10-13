import { describe, expect, it } from "vitest";
import {
  ACCOUNT_USERNAME_MAX_LENGTH,
  ACCOUNT_USERNAME_MIN_LENGTH,
  AccountResponseV1Schema,
  AccountUsernameV1Schema,
  CreateAccountRequestV1Schema,
  CreateAccountResponseV1Schema,
  CreateGameSessionResponseV1Schema,
  normalizeAccountUsername,
  RegistrationInfoV1Schema,
  SCOREBOARD_MAX_ENTRIES,
  ScoreboardEntryV1Schema,
  ScoreboardResponseV1Schema,
  UpdateAccountSettingsRequestV1Schema,
  CurrentGameCommandEnvelopeV1Schema,
  CurrentGameCommandV1Schema,
  CurrentLogicPackDescriptorV1Schema,
  EGG_RELEASE_MAX_HELD_FRAMES_V1,
  GAME_PROTOCOL_VERSION,
  OFFICIAL_GAME_V12_SIMULATION_VERSION,
  OFFICIAL_GAME_V14_SIMULATION_VERSION,
  OFFICIAL_GAME_V15_SIMULATION_VERSION,
  OFFICIAL_GAME_V16_SIMULATION_VERSION,
  OFFICIAL_GAME_V17_SIMULATION_VERSION,
  OFFICIAL_GAME_V18_SIMULATION_VERSION,
  OFFICIAL_GAME_V19_SIMULATION_VERSION,
  OFFICIAL_GAME_V20_SIMULATION_VERSION,
  OFFICIAL_GAME_V21_SIMULATION_VERSION,
  OFFICIAL_GAME_V22_SIMULATION_VERSION,
  SOURCE_EGG_POOL_MAX_ENTRIES,
  CollectionClaimsV1Schema,
  DecisionViewV1Schema,
  OfficialGameCommandResultV12Schema,
  OfficialGameCommandResultV15Schema,
  OfficialGameCommandResultV16Schema,
  OfficialGameCommandResultV17Schema,
  OfficialGameCommandResultV18Schema,
  OfficialGameCommandResultV19Schema,
  OfficialGameCommandResultV20Schema,
  OfficialGameCommandResultV21Schema,
  OfficialGameCommandResultV22Schema,
  GameCommandResultV1Schema,
  GameCommandEnvelopeV1Schema,
  LogicPackCapabilitiesV1Schema,
  LogicPackDescriptorV1Schema,
  HistoricalLogicPackDescriptorV1Schema,
  OfficialDefeatDecisionV1Schema,
  OfficialDungeonBattleReturnV1Schema,
  OfficialEggContinuationV1Schema,
  OfficialEggSpinningV1Schema,
  OfficialGameProjectionV12Schema,
  OfficialGameProjectionV14Schema,
  OfficialGameProjectionV15Schema,
  OfficialGameProjectionV16Schema,
  OfficialGameProjectionV17Schema,
  OfficialGameProjectionV18Schema,
  OfficialGameProjectionV19Schema,
  OfficialGameProjectionV20Schema,
  OfficialGameProjectionV21Schema,
  OfficialGameProjectionV22Schema,
  EggContinuationDecisionV1Schema,
  parseCurrentGameCommandEnvelopeV1,
  parseHistoricalGameCommandEnvelopeV1,
  SlotProjectionV1Schema,
  type GameCommandEnvelopeV1,
  type HistoricalGameCommandEnvelopeV1,
} from "../src/index.js";

const envelope = (command: HistoricalGameCommandEnvelopeV1["command"]): unknown => ({
  protocolVersion: GAME_PROTOCOL_VERSION,
  commandId: "command_01J8Y4R6X2N3M4P5",
  expectedRevision: 7,
  expectedDecisionId: "decision-8",
  command,
});

const continuationCommands: readonly GameCommandEnvelopeV1["command"][] = [
  { type: "collection.claim", goalId: "collection-goal-1" },
  { type: "battle.resolveDefeat", battleId: "battle-4", recovery: "return" },
  { type: "egg.start" },
  { type: "egg.release" },
  { type: "egg.release", heldFrames: 91 },
  { type: "egg.resolvePrize", resolution: { kind: "keep" } },
  {
    type: "egg.resolvePrize",
    resolution: { kind: "feed", recipientInstanceId: "monster-2" },
  },
  { type: "egg.repeat" },
  { type: "egg.finish" },
];

const forbiddenCommandFields = [
  "price",
  "seed",
  "draws",
  "friction",
  "landing",
  "prize",
  "timestamp",
  "elapsedMs",
  "state",
  "reward",
  "entityId",
] as const;

const historicalReceiptProjection = {
  slotId: "slot-1" as const,
  revision: 1,
  logicPackId: `logic-v1:${"a".repeat(64)}`,
  simulationVersion: "official-game-v11",
  trustTier: "official" as const,
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
  location: { kind: "none" as const },
  decision: { type: "none" as const },
};

const descriptorCapabilities = {
  slot: true,
  world: false,
  battle: false,
  capture: false,
  spirit: false,
  party: false,
  economy: false,
  dungeon: false,
  quests: false,
  plot: false,
  tournaments: false,
};

const standardSilverPool = [
  ...Array.from({ length: 44 }, (_, index) => ({
    kind: "monster" as const,
    shortType: `Monster${index}`,
    level: 1,
    prizeMonster: false,
  })),
  ...Array.from({ length: 4 }, () => ({ kind: "gold" as const, amount: 50 })),
  ...Array.from({ length: 2 }, () => ({ kind: "gold" as const, amount: 150 })),
  ...Array.from({ length: 2 }, () => ({ kind: "silver" as const, amount: 500 })),
  ...Array.from({ length: 2 }, () => ({ kind: "silver" as const, amount: 1_500 })),
  { kind: "recipe" as const, combineName: "CombineRecipe" },
  { kind: "spiritTotem" as const, shortType: "SpiritTotem" },
  ...Array.from({ length: 2 }, () => ({
    kind: "item" as const,
    definitionPath: "Usables.CardSilver",
    level: 2,
  })),
  ...Array.from({ length: 2 }, () => ({
    kind: "item" as const,
    definitionPath: "Usables.CardGold",
    level: 3,
  })),
  ...Array.from({ length: 4 }, () => ({
    kind: "gem" as const,
    level: 42,
    quality: 0 as const,
    slot: 0 as const,
    enabledStats: ["Attack" as const],
  })),
  ...Array.from({ length: 2 }, () => ({
    kind: "gem" as const,
    level: 42,
    quality: 1 as const,
    slot: 0 as const,
    enabledStats: ["Attack" as const],
  })),
] as const;

describe("authoritative command protocol", () => {
  it("accepts every strict continuation intent variant", () => {
    for (const command of continuationCommands) {
      expect(GameCommandEnvelopeV1Schema.parse(envelope(command)).command).toEqual(command);
    }
  });

  it.each(continuationCommands.flatMap((command) =>
    forbiddenCommandFields.map((field) => [command, field] as const),
  ))("rejects %s on continuation intent %s", (command, field) => {
    const value = envelope(command) as { command: Record<string, unknown> };
    value.command[field] = 1;
    expect(GameCommandEnvelopeV1Schema.safeParse(value).success).toBe(false);
  });

  it.each([
    { kind: "keep" },
    { kind: "feed", recipientInstanceId: "monster-2" },
  ] as const)("rejects every forbidden field inside egg resolution %j", (resolution) => {
    for (const field of forbiddenCommandFields) {
      const value = envelope({
        type: "egg.resolvePrize",
        resolution: { ...resolution, [field]: 1 },
      } as never);
      expect(GameCommandEnvelopeV1Schema.safeParse(value).success)
        .toBe(false);
    }
  });

  it("bounds the egg release held-frame count", () => {
    for (const heldFrames of [1, 91, 600, EGG_RELEASE_MAX_HELD_FRAMES_V1]) {
      expect(GameCommandEnvelopeV1Schema.safeParse(
        envelope({ type: "egg.release", heldFrames }),
      ).success).toBe(true);
    }
    for (const heldFrames of [0, -1, 1.5, EGG_RELEASE_MAX_HELD_FRAMES_V1 + 1, "91"]) {
      expect(GameCommandEnvelopeV1Schema.safeParse(
        envelope({ type: "egg.release", heldFrames } as never),
      ).success).toBe(false);
    }
  });

  it("still reads a pre-2026-08-07 egg.release receipt with no held-frame count", () => {
    // Persisted receipts must keep replaying to their committed landing, so the count is optional
    // rather than required.
    const parsed = parseHistoricalGameCommandEnvelopeV1(envelope({ type: "egg.release" }));
    expect(parsed.command).toEqual({ type: "egg.release" });
    expect(CurrentGameCommandV1Schema.parse({ type: "egg.release" }))
      .toEqual({ type: "egg.release" });
  });

  it("rejects resolution fields at the outer command level", () => {
    for (const resolution of [
      { kind: "keep" },
      { kind: "feed", recipientInstanceId: "monster-2" },
    ] as const) {
      const value = envelope({
        type: "egg.resolvePrize",
        resolution,
        recipientInstanceId: "monster-2",
      } as never);
      expect(GameCommandEnvelopeV1Schema.safeParse(value).success).toBe(false);
    }
  });

  it("projects source-tagged egg phases and a server-fact-only defeat decision", () => {
    const prize = { kind: "gold" as const, amount: 50 };
    const reelState = {
      elapsedSeconds: 2,
      index: 17.25,
      speed: -2.1,
      friction: 3,
      centerIndex: 1,
      stopped: true,
    };
    const common = {
      schemaVersion: 1 as const,
      decisionId: "decision-egg-1",
      continuationId: "egg-continuation-1",
      kind: "silver" as const,
      origin: "collection" as const,
      remainingRepeats: 1 as const,
    };
    const phases = [
      {
        ...common,
        phase: "awaiting-spin" as const,
      },
      {
        ...common,
        phase: "spinning" as const,
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: ["BlueBabyDragon"],
      },
      {
        ...common,
        phase: "awaiting-prize-resolution" as const,
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: ["BlueBabyDragon"],
        finalReelState: reelState,
        landedPrize: prize,
      },
      {
        ...common,
        phase: "awaiting-repeat-or-finish" as const,
        settledPrize: prize,
        resolution: { kind: "keep" as const },
      },
    ];
    for (const continuation of phases) {
      expect(OfficialEggContinuationV1Schema.parse(continuation)).toEqual(continuation);
      const { schemaVersion: _schemaVersion, phase, ...decisionFields } = continuation;
      const type = phase === "awaiting-spin"
        ? "egg.awaitingSpin"
        : phase === "spinning"
          ? "egg.spinning"
          : phase === "awaiting-prize-resolution"
            ? "egg.awaitingPrizeResolution"
            : "egg.awaitingRepeatOrFinish";
      expect(DecisionViewV1Schema.parse({ type, ...decisionFields }))
        .toMatchObject({ decisionId: "decision-egg-1" });
    }

    expect(OfficialEggContinuationV1Schema.safeParse({
      ...phases[0],
      providers: [prize],
    }).success).toBe(false);
    expect(OfficialEggContinuationV1Schema.safeParse({
      ...phases[1],
      landedPrize: prize,
    }).success).toBe(false);
    expect(OfficialEggContinuationV1Schema.safeParse({
      ...phases[2],
      seed: 0,
    }).success).toBe(false);

    const defeat = {
      schemaVersion: 1 as const,
      kind: "defeat" as const,
      decisionId: "decision-defeat-1",
      battleId: "battle-4",
      canSaveMe: true,
    };
    expect(OfficialDefeatDecisionV1Schema.parse(defeat)).toEqual(defeat);
    expect(DecisionViewV1Schema.parse({
      type: "battle.defeatRecovery",
      decisionId: defeat.decisionId,
      battleId: defeat.battleId,
      canSaveMe: defeat.canSaveMe,
    })).toMatchObject({ decisionId: "decision-defeat-1" });
    expect(DecisionViewV1Schema.safeParse({
      type: "battle.defeatRecovery",
      decisionId: defeat.decisionId,
      battleId: defeat.battleId,
      canSaveMe: defeat.canSaveMe,
      reward: { kind: "gold", amount: 999 },
    }).success).toBe(false);
  });

  it("requires Store Eggs to have no remaining repeat while preserving non-Store repeats", () => {
    const prize = { kind: "gold" as const, amount: 50 };
    const reelState = {
      elapsedSeconds: 2,
      index: 17.25,
      speed: -2.1,
      friction: 3,
      centerIndex: 1,
      stopped: true,
    };
    const storeCommon = {
      schemaVersion: 1 as const,
      decisionId: "decision-store-1",
      continuationId: "egg-store-1",
      kind: "silver" as const,
      origin: "store" as const,
      remainingRepeats: 0 as const,
    };
    const storePhases = [
      { ...storeCommon, phase: "awaiting-spin" as const },
      {
        ...storeCommon,
        phase: "spinning" as const,
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: ["BlueBabyDragon"],
      },
      {
        ...storeCommon,
        phase: "awaiting-prize-resolution" as const,
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: ["BlueBabyDragon"],
        finalReelState: reelState,
        landedPrize: prize,
      },
      {
        ...storeCommon,
        phase: "awaiting-repeat-or-finish" as const,
        settledPrize: prize,
        resolution: { kind: "keep" as const },
      },
    ];
    for (const continuation of storePhases) {
      expect(OfficialEggContinuationV1Schema.parse(continuation)).toEqual(continuation);
      expect(OfficialEggContinuationV1Schema.safeParse({
        ...continuation,
        remainingRepeats: 1,
      }).success).toBe(false);
    }

    const storeDecisionCommon = {
      decisionId: storeCommon.decisionId,
      continuationId: storeCommon.continuationId,
      kind: storeCommon.kind,
      origin: storeCommon.origin,
      remainingRepeats: storeCommon.remainingRepeats,
    };
    const storeDecisions = [
      { ...storeDecisionCommon, type: "egg.awaitingSpin" as const },
      {
        ...storeDecisionCommon,
        type: "egg.spinning" as const,
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: ["BlueBabyDragon"],
      },
      {
        ...storeDecisionCommon,
        type: "egg.awaitingPrizeResolution" as const,
        providers: [prize],
        reel: [prize],
        previewMonsterShortTypes: ["BlueBabyDragon"],
        finalReelState: reelState,
        landedPrize: prize,
      },
      {
        ...storeDecisionCommon,
        type: "egg.awaitingRepeatOrFinish" as const,
        settledPrize: prize,
        resolution: { kind: "keep" as const },
      },
    ];
    for (const decision of storeDecisions) {
      expect(EggContinuationDecisionV1Schema.parse(decision)).toEqual(decision);
      expect(EggContinuationDecisionV1Schema.safeParse({
        ...decision,
        remainingRepeats: 1,
      }).success).toBe(false);
      expect(DecisionViewV1Schema.safeParse({ ...decision, remainingRepeats: 1 }).success)
        .toBe(false);
    }

    for (const remainingRepeats of [0, 1] as const) {
      expect(OfficialEggContinuationV1Schema.safeParse({
        schemaVersion: 1,
        decisionId: "decision-collection-1",
        continuationId: "egg-collection-1",
        kind: "silver",
        origin: "collection",
        remainingRepeats,
        phase: "awaiting-spin",
      }).success).toBe(remainingRepeats === 1);
      expect(EggContinuationDecisionV1Schema.safeParse({
        type: "egg.awaitingSpin",
        decisionId: "decision-collection-1",
        continuationId: "egg-collection-1",
        kind: "silver",
        origin: "collection",
        remainingRepeats,
      }).success).toBe(true);
    }
    expect(OfficialEggContinuationV1Schema.safeParse({
      schemaVersion: 1,
      decisionId: "decision-collection-post-repeat",
      continuationId: "egg-collection-post-repeat",
      kind: "silver",
      origin: "collection",
      remainingRepeats: 0,
      phase: "spinning",
      providers: [prize],
      reel: [prize],
      previewMonsterShortTypes: [],
    }).success).toBe(true);
  });

  it("retains the legacy 66-entry compatibility cap while publishing the corrected source maximum", () => {
    expect(SOURCE_EGG_POOL_MAX_ENTRIES).toBe(46);
    expect(standardSilverPool).toHaveLength(66);
    expect(standardSilverPool.filter((prize) => prize.kind === "monster")).toHaveLength(44);
    expect(standardSilverPool.filter((prize) => prize.kind !== "monster")).toHaveLength(22);

    const continuation = {
      schemaVersion: 1 as const,
      decisionId: "decision-egg-66",
      continuationId: "egg-continuation-66",
      kind: "silver" as const,
      origin: "collection" as const,
      remainingRepeats: 1 as const,
      phase: "spinning" as const,
      providers: standardSilverPool,
      reel: [...standardSilverPool].reverse(),
      previewMonsterShortTypes: ["Monster0", "Monster1"],
    };
    const serialized = JSON.parse(JSON.stringify(continuation));
    expect(OfficialEggSpinningV1Schema.parse(serialized)).toEqual(serialized);
    expect(OfficialEggContinuationV1Schema.parse(serialized)).toEqual(serialized);
    expect(DecisionViewV1Schema.parse({
      type: "egg.spinning",
      continuationId: serialized.continuationId,
      decisionId: serialized.decisionId,
      kind: serialized.kind,
      origin: serialized.origin,
      remainingRepeats: serialized.remainingRepeats,
      providers: serialized.providers,
      reel: serialized.reel,
      previewMonsterShortTypes: serialized.previewMonsterShortTypes,
    })).toMatchObject({ decisionId: "decision-egg-66" });

    const tooMany = {
      ...serialized,
      providers: [...serialized.providers, serialized.providers[0]],
      reel: [...serialized.reel, serialized.reel[0]],
    };
    expect(OfficialEggContinuationV1Schema.safeParse(tooMany).success).toBe(false);
    expect(DecisionViewV1Schema.safeParse({
      type: "egg.spinning",
      continuationId: tooMany.continuationId,
      decisionId: tooMany.decisionId,
      kind: tooMany.kind,
      origin: tooMany.origin,
      remainingRepeats: tooMany.remainingRepeats,
      providers: tooMany.providers,
      reel: tooMany.reel,
      previewMonsterShortTypes: tooMany.previewMonsterShortTypes,
    }).success).toBe(false);

    expect(OfficialEggContinuationV1Schema.safeParse({
      ...serialized,
      reel: serialized.reel.slice(0, -1),
    }).success).toBe(false);
  });

  it("keeps deprecated tournament settlement parseable only as historical wire/receipt data", () => {
    const historical = envelope({ type: "tournament.settlePrize" });
    expect(GameCommandEnvelopeV1Schema.parse(historical)).toMatchObject({
      command: { type: "tournament.settlePrize" },
    });
    expect(parseHistoricalGameCommandEnvelopeV1(historical).command.type)
      .toBe("tournament.settlePrize");
    expect(() => parseCurrentGameCommandEnvelopeV1(historical)).toThrow();

    const receipt = {
      commandId: "command_historical_0001",
      canonicalEnvelope: JSON.stringify(historical),
      result: {
        protocolVersion: GAME_PROTOCOL_VERSION,
        commandId: "command_historical_0001",
        previousRevision: 0,
        revision: 1,
        eventCursorStart: 1,
        eventCursorEnd: 1,
        events: [{ seq: 1, type: "tournament.prizeClaimed", tournamentIndex: 0 }],
        projection: {
          ...historicalReceiptProjection,
          pendingEgg: { schemaVersion: 1, kind: "silver" },
        },
        idempotentReplay: false,
      },
    };
    expect(GameCommandEnvelopeV1Schema.parse(JSON.parse(receipt.canonicalEnvelope))).toMatchObject({
      command: { type: "tournament.settlePrize" },
    });
    expect(GameCommandResultV1Schema.parse(receipt.result).events).toEqual(receipt.result.events);

    expect(LogicPackCapabilitiesV1Schema.safeParse({
      ...descriptorCapabilities,
      commandTypes: ["tournament.settlePrize"],
    }).success).toBe(false);

    expect(CurrentGameCommandV1Schema.safeParse({ type: "tournament.settlePrize" }).success)
      .toBe(false);
    expect(CurrentGameCommandEnvelopeV1Schema.safeParse(historical).success).toBe(false);
    expect(CurrentLogicPackDescriptorV1Schema.safeParse({
      logicPackId: `logic-v1:${"c".repeat(64)}`,
      simulationVersion: "official-game-v12",
      trustTier: "official",
      capabilities: { ...descriptorCapabilities, commandTypes: ["tournament.settlePrize"] },
    }).success).toBe(false);
    expect(LogicPackDescriptorV1Schema.safeParse({
      logicPackId: `logic-v1:${"c".repeat(64)}`,
      simulationVersion: "official-game-v12",
      trustTier: "official",
      capabilities: { ...descriptorCapabilities, commandTypes: ["tournament.settlePrize"] },
    }).success).toBe(false);
    expect(HistoricalLogicPackDescriptorV1Schema.safeParse({
      logicPackId: `logic-v1:${"c".repeat(64)}`,
      simulationVersion: "official-game-v11",
      trustTier: "official",
      capabilities: { ...descriptorCapabilities, commandTypes: ["tournament.settlePrize"] },
    }).success).toBe(true);
    expect(HistoricalLogicPackDescriptorV1Schema.safeParse({
      logicPackId: `logic-v1:${"c".repeat(64)}`,
      simulationVersion: "official-game-v11",
      trustTier: "official",
      capabilities: { ...descriptorCapabilities, commandTypes: ["egg.start"] },
    }).success).toBe(false);
  });

  it("requires pending continuations and DecisionView to share one server decision identity", () => {
    const pendingEgg = {
      schemaVersion: 1 as const,
      decisionId: "decision-egg-1",
      continuationId: "egg-continuation-1",
      kind: "silver" as const,
      origin: "collection" as const,
      remainingRepeats: 1 as const,
      phase: "awaiting-spin" as const,
    };
    const eggDecision = {
      type: "egg.awaitingSpin" as const,
      decisionId: pendingEgg.decisionId,
      continuationId: pendingEgg.continuationId,
      kind: pendingEgg.kind,
      origin: pendingEgg.origin,
      remainingRepeats: pendingEgg.remainingRepeats,
    };
    const currentReceiptProjection = {
      ...historicalReceiptProjection,
      simulationVersion: "official-game-v12",
    };
    expect(SlotProjectionV1Schema.safeParse({
      ...currentReceiptProjection,
      pendingEgg,
      decision: eggDecision,
    }).success).toBe(true);
    expect(SlotProjectionV1Schema.safeParse({
      ...currentReceiptProjection,
      pendingEgg,
      decision: { ...eggDecision, decisionId: "decision-other" },
    }).success).toBe(false);
    expect(SlotProjectionV1Schema.safeParse({
      ...currentReceiptProjection,
      pendingEgg,
      decision: { type: "none" },
    }).success).toBe(false);

    const pendingDefeat = {
      schemaVersion: 1 as const,
      kind: "defeat" as const,
      decisionId: "decision-defeat-1",
      battleId: "battle-4",
      canSaveMe: true,
    };
    const defeatDecision = {
      type: "battle.defeatRecovery" as const,
      decisionId: pendingDefeat.decisionId,
      battleId: pendingDefeat.battleId,
      canSaveMe: pendingDefeat.canSaveMe,
    };
    expect(SlotProjectionV1Schema.safeParse({
      ...currentReceiptProjection,
      pendingDefeat,
      decision: defeatDecision,
    }).success).toBe(true);
    expect(SlotProjectionV1Schema.safeParse({
      ...currentReceiptProjection,
      pendingDefeat,
      decision: { type: "none" },
    }).success).toBe(false);

    // Historical v11 projections may contain the old one-bit Egg marker and no active decision.
    expect(SlotProjectionV1Schema.safeParse({
      ...historicalReceiptProjection,
      pendingEgg: { schemaVersion: 1, kind: "silver" },
      decision: { type: "none" },
    }).success).toBe(true);
    expect(SlotProjectionV1Schema.safeParse({
      ...historicalReceiptProjection,
      pendingEgg,
      decision: eggDecision,
    }).success).toBe(false);
    expect(SlotProjectionV1Schema.safeParse({
      ...historicalReceiptProjection,
      pendingDefeat,
      decision: defeatDecision,
    }).success).toBe(false);
    expect(SlotProjectionV1Schema.safeParse({
      ...currentReceiptProjection,
      pendingEgg: { schemaVersion: 1, kind: "silver" },
      decision: { type: "none" },
    }).success).toBe(false);
    expect(SlotProjectionV1Schema.safeParse({
      ...historicalReceiptProjection,
      pendingEgg: { schemaVersion: 1, kind: "silver" },
      pendingDefeat,
      decision: defeatDecision,
    }).success).toBe(false);
  });

  it("accepts semantic intent without caller-authored outcomes", () => {
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "battle.chooseAbility",
      battleId: "battle-4",
      actorId: "monster-2",
      slot: "usable3",
      targetIds: ["monster-9"],
    }))).toMatchObject({ expectedRevision: 7 });
  });

  it("accepts a tutorial acknowledgement as a semantic player command", () => {
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "player.claimTutorialFlag",
      flag: "Tutorial0",
    }))).toMatchObject({
      command: { type: "player.claimTutorialFlag", flag: "Tutorial0" },
    });
  });

  it("accepts tournament battle and prize commands", () => {
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "tournament.startBattle",
    }))).toMatchObject({
      command: { type: "tournament.startBattle" },
    });
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "tournament.claimPrize",
    }))).toMatchObject({
      command: { type: "tournament.claimPrize" },
    });
  });

  it("accepts an exact durable story-dialog acknowledgement", () => {
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "player.claimDialog",
      dialogId: "LeslieIntro1",
    }))).toMatchObject({
      command: { type: "player.claimDialog", dialogId: "LeslieIntro1" },
    });
  });

  it("parses the historical Tournament prize settlement command", () => {
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "tournament.settlePrize",
    }))).toMatchObject({
      command: { type: "tournament.settlePrize" },
    });
  });

  it("accepts only semantic Guild quest choices without caller-authored progress or rewards", () => {
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "quest.accept",
      questId: "MacworldCatch",
    }))).toMatchObject({
      command: { type: "quest.accept", questId: "MacworldCatch" },
    });
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "quest.claim",
      questId: "MacworldCatch",
    }))).toMatchObject({
      command: { type: "quest.claim", questId: "MacworldCatch" },
    });
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "quest.dropAll",
    }))).toMatchObject({
      command: { type: "quest.dropAll" },
    });
    expect(GameCommandEnvelopeV1Schema.safeParse(envelope({
      type: "quest.claim",
      questId: "MacworldCatch",
      rewards: [{ kind: "gold", amount: 999 }],
    } as never)).success).toBe(false);
  });

  it.each(["seed", "chance", "reward", "damage", "xp", "timestamp", "state", "price", "result"])(
    "rejects the forbidden caller-controlled field %s",
    (field) => {
      const value = envelope({
        type: "battle.retreat",
        battleId: "battle-4",
        actorId: "monster-2",
      });
      (value as { command: Record<string, unknown> }).command[field] = 999;
      expect(GameCommandEnvelopeV1Schema.safeParse(value).success).toBe(false);
    },
  );

  it("rejects a generic state replacement command", () => {
    expect(GameCommandEnvelopeV1Schema.safeParse(envelope({
      type: "slot.replaceState",
      state: { silver: 999999 },
    } as never)).success).toBe(false);
  });

  it("rejects the fabricated anywhere-in-dungeon exit shortcut", () => {
    expect(GameCommandEnvelopeV1Schema.safeParse(envelope({
      type: "dungeon.exit",
    } as never)).success).toBe(false);
  });

  it("accepts only the chosen waypoint floor and rejects client-authored route/cache state", () => {
    expect(GameCommandEnvelopeV1Schema.parse(envelope({
      type: "dungeon.travelToWaypoint",
      floor: 4,
    }))).toMatchObject({
      command: { type: "dungeon.travelToWaypoint", floor: 4 },
    });
    expect(GameCommandEnvelopeV1Schema.safeParse(envelope({
      type: "dungeon.travelToWaypoint",
      floor: 4,
      route: { typeName: "Cave", sourceFile: "Dungeon_1.plist" },
    } as never)).success).toBe(false);
  });
});

describe("self-service account schemas", () => {
  it("accepts the usernames a person would actually type and rejects the rest", () => {
    for (const username of ["Ada", "ada lovelace", "Ada_Lovelace", "player-1", "AB", "a".repeat(16)]) {
      expect(AccountUsernameV1Schema.safeParse(username).success).toBe(true);
    }
    for (
      const username of [
        "a",
        "a".repeat(17),
        " Ada",
        "Ada ",
        "Ada  Lovelace",
        "Ada!",
        "-ada",
        "ada-",
        "",
      ]
    ) {
      expect(AccountUsernameV1Schema.safeParse(username).success).toBe(false);
    }
  });

  it("normalises the surrounding and inner whitespace a form will send", () => {
    expect(normalizeAccountUsername("  Ada   Lovelace \n")).toBe("Ada Lovelace");
    expect(AccountUsernameV1Schema.safeParse(normalizeAccountUsername(" Ada  Lovelace ")).success)
      .toBe(true);
  });

  it("keeps the registration request and response strict", () => {
    const request = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      username: "Ada",
      publicScoreboard: true,
    };
    expect(CreateAccountRequestV1Schema.parse(request)).toEqual(request);
    // An unknown key is a client the server does not understand, not a field to ignore.
    expect(CreateAccountRequestV1Schema.safeParse({ ...request, admin: true }).success).toBe(false);
    expect(CreateAccountRequestV1Schema.safeParse({ ...request, publicScoreboard: "yes" }).success)
      .toBe(false);

    const account = {
      username: "Ada",
      publicScoreboard: true,
      createdAt: "2023-11-14T22:13:20.000Z",
    };
    const response = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      loginToken: "a".repeat(32),
      playerId: "b".repeat(64),
      account,
    };
    expect(CreateAccountResponseV1Schema.parse(response)).toEqual(response);
    // The player id is the HMAC digest, so a non-hex or short value is a protocol break.
    expect(CreateAccountResponseV1Schema.safeParse({ ...response, playerId: "B".repeat(64) })
      .success).toBe(false);
    expect(CreateAccountResponseV1Schema.safeParse({ ...response, loginToken: "short" }).success)
      .toBe(false);
    expect(AccountResponseV1Schema.parse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      account,
    })).toEqual({ protocolVersion: GAME_PROTOCOL_VERSION, account });
    expect(UpdateAccountSettingsRequestV1Schema.safeParse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      publicScoreboard: false,
    }).success).toBe(true);
  });

  it("makes the session account optional so operator invites still parse", () => {
    expect(RegistrationInfoV1Schema.parse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      enabled: false,
      usernameMinLength: ACCOUNT_USERNAME_MIN_LENGTH,
      usernameMaxLength: ACCOUNT_USERNAME_MAX_LENGTH,
    }).enabled).toBe(false);

    const session = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      selectedEventVersion: "presentation-events-v1" as const,
      token: "session-token-with-enough-length",
      expiresAt: "2023-11-14T22:13:20.000Z",
      pack: {
        logicPackId: `logic-v1:${"a".repeat(64)}`,
        simulationVersion: "dib-sim-v1",
        trustTier: "official" as const,
        capabilities: {
          slot: true, world: true, battle: false, capture: false, spirit: false, party: false,
          economy: false, dungeon: false, quests: false, plot: false, tournaments: false,
          commandTypes: ["slot.create"],
        },
      },
      slots: [],
    };
    expect(CreateGameSessionResponseV1Schema.parse(session)).not.toHaveProperty("account");
    expect(CreateGameSessionResponseV1Schema.parse({
      ...session,
      account: { username: "Ada", publicScoreboard: false, createdAt: "2023-11-14T22:13:20.000Z" },
    }).account?.username).toBe("Ada");
  });
});

describe("public scoreboard schema", () => {
  const entry = { rank: 1, username: "Ada Lovelace", heroLevel: 21, totalXp: 4820 };
  const board = {
    protocolVersion: GAME_PROTOCOL_VERSION,
    generatedAt: "2026-08-08T00:00:00.000Z",
    entries: [entry],
  };

  it("round-trips a board and accepts an empty one", () => {
    expect(ScoreboardResponseV1Schema.parse(board)).toEqual(board);
    // Nobody opted in yet is a normal state of a live server, not a malformed response.
    expect(ScoreboardResponseV1Schema.parse({ ...board, entries: [] }).entries).toEqual([]);
  });

  it("carries no player identity, so an added one is a protocol break", () => {
    // The board is public and the player id is a durable correlation handle. A client that starts
    // sending one, or a server that starts publishing one, must fail loudly rather than leak it.
    expect(ScoreboardEntryV1Schema.safeParse({ ...entry, playerId: "a".repeat(64) }).success)
      .toBe(false);
    expect(ScoreboardEntryV1Schema.safeParse({ ...entry, slotId: "slot-1" }).success).toBe(false);
    expect(ScoreboardResponseV1Schema.safeParse({ ...board, self: entry }).success).toBe(false);
  });

  it("keeps ranks and totals to the numbers a board can actually hold", () => {
    expect(ScoreboardEntryV1Schema.safeParse({ ...entry, rank: 0 }).success).toBe(false);
    expect(ScoreboardEntryV1Schema.safeParse({ ...entry, rank: 1.5 }).success).toBe(false);
    expect(ScoreboardEntryV1Schema.safeParse({ ...entry, totalXp: -1 }).success).toBe(false);
    // Level matches the projection's own floor of 1 (`heroLevelForXp(0) === 1`), so a zero here is
    // a projection the board should never have been handed rather than a brand-new player.
    expect(ScoreboardEntryV1Schema.safeParse({ ...entry, heroLevel: 0 }).success).toBe(false);
    // Total XP does start at zero: a level-1 hero has captured nothing yet.
    expect(ScoreboardEntryV1Schema.safeParse({ ...entry, totalXp: 0 }).success).toBe(true);
    // The response cap and the aggregation cap are the same number, so a full board still parses.
    expect(ScoreboardResponseV1Schema.safeParse({
      ...board,
      entries: Array.from({ length: SCOREBOARD_MAX_ENTRIES }, () => entry),
    }).success).toBe(true);
    expect(ScoreboardResponseV1Schema.safeParse({
      ...board,
      entries: Array.from({ length: SCOREBOARD_MAX_ENTRIES + 1 }, () => entry),
    }).success).toBe(false);
  });
});

describe("command result cursor invariants", () => {
  const projection = {
    slotId: "slot-1",
    revision: 1,
    logicPackId: `logic-v1:${"a".repeat(64)}`,
    simulationVersion: "dib-sim-v1",
    trustTier: "official",
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
    location: { kind: "none" },
    decision: { type: "none" },
  };

  it("accepts a one-revision atomic result", () => {
    expect(GameCommandResultV1Schema.safeParse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" }],
      projection,
      idempotentReplay: false,
    }).success).toBe(true);
  });

  it("accepts server-authored multi-stat gem inventory keys", () => {
    expect(GameCommandResultV1Schema.safeParse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" }],
      projection: {
        ...projection,
        player: {
          ...projection.player,
          items: {
            "GemLevel:7:Quality:1:Slot:0:Stats:Defense,MaxHP": 1,
          },
        },
      },
      idempotentReplay: false,
    }).success).toBe(true);
  });

  it("accepts server-owned Guild state and its committed random reward batch", () => {
    expect(GameCommandResultV1Schema.safeParse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{
        seq: 1,
        type: "quest.rewardClaimed",
        questId: "MacworldCatch",
        rewards: [{ kind: "egg" }],
        randomDraws: [0.25],
      }],
      projection: {
        ...projection,
        quests: {
          activeQuestNames: [],
          finishedQuestNames: ["MacworldCatch"],
          progressByQuestName: {},
          dialogsSeen: ["LeslieSaved"],
          completedFixedEncounterKeys: ["Field1Fixed"],
          receivedBattleRewardKeys: [],
        },
      },
      idempotentReplay: false,
    }).success).toBe(true);
  });

  it("accepts the exact committed reward batch for a battle loot presentation", () => {
    expect(GameCommandResultV1Schema.safeParse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{
        seq: 1,
        type: "battle.rewardsGranted",
        battleId: "battle-1",
        rewards: [{
          kind: "gem",
          level: 7,
          quality: 1,
          slot: 0,
          enabledStats: ["Defense", "MaxHP"],
        }],
      }],
      projection,
      idempotentReplay: false,
    }).success).toBe(true);
  });

  it("rejects a cursor interval that cannot describe its event batch", () => {
    expect(GameCommandResultV1Schema.safeParse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 8,
      events: [{ seq: 1, type: "slot.created" }],
      projection,
      idempotentReplay: false,
    }).success).toBe(false);
  });

  it("accepts only committed battle draws and rejects a leaked seed", () => {
    const active = {
      ...projection,
      location: {
        kind: "battle",
        worldId: "World_1-1",
        poiId: "Forest",
        battleId: "battle-1",
      },
      battle: {
        battleId: "battle-1",
        backgroundKey: "ForestCombat-hd",
        allowRetreat: true,
        teams: [
          [{ shortType: "BlueBabyDragon", level: 1, sourceInstanceId: "monster-1" }],
          [{ shortType: "FireCub", level: 1 }],
        ],
        options: { silver: 100 },
        randomDraws: [0.25],
        commands: [],
      },
    };
    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "battle.started", battleId: "battle-1" }],
      projection: active,
      idempotentReplay: false,
    };
    expect(GameCommandResultV1Schema.safeParse(result).success).toBe(true);
    expect(GameCommandResultV1Schema.safeParse({
      ...result,
      projection: {
        ...active,
        battle: { ...active.battle, seed: 1234 },
      },
    }).success).toBe(false);
  });
});

describe("official v12 projection and result wire", () => {
  const projectionV12 = {
    ...historicalReceiptProjection,
    updatedAt: "2026-01-01T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V12_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("requires canonical claims and parses the full v12 projection and result", () => {
    expect(CollectionClaimsV1Schema.parse({
      schemaVersion: 1,
      claimedGoalIds: ["goal-a", "goal-b"],
    })).toEqual({ schemaVersion: 1, claimedGoalIds: ["goal-a", "goal-b"] });
    expect(OfficialGameProjectionV12Schema.parse(projectionV12)).toEqual(projectionV12);

    const result = OfficialGameCommandResultV12Schema.parse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" }],
      projection: projectionV12,
      idempotentReplay: false,
    });
    expect(result.projection.collectionClaims).toEqual({
      schemaVersion: 1,
      claimedGoalIds: [],
    });
    expect(OfficialGameCommandResultV12Schema.safeParse({
      ...result,
      extra: true,
    }).success).toBe(false);
    expect(OfficialGameCommandResultV12Schema.safeParse({
      ...result,
      projection: {
        ...result.projection,
        collectionClaims: undefined,
      },
    }).success).toBe(false);
  });

  it("rejects missing, malformed, noncanonical, and extra claims in v12", () => {
    const { collectionClaims: _missing, ...missingClaims } = projectionV12;
    expect(OfficialGameProjectionV12Schema.safeParse(missingClaims).success).toBe(false);
    expect(OfficialGameProjectionV12Schema.safeParse({
      ...projectionV12,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: "not-an-array" },
    }).success).toBe(false);
    expect(OfficialGameProjectionV12Schema.safeParse({
      ...projectionV12,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: ["goal-b", "goal-a"] },
    }).success).toBe(false);
    expect(OfficialGameProjectionV12Schema.safeParse({
      ...projectionV12,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: ["goal-a", "goal-a"] },
    }).success).toBe(false);
    expect(OfficialGameProjectionV12Schema.safeParse({
      ...projectionV12,
      collectionClaims: {
        schemaVersion: 1,
        claimedGoalIds: [],
        extra: true,
      },
    }).success).toBe(false);
    expect(OfficialGameProjectionV12Schema.safeParse({
      ...projectionV12,
      extra: true,
    }).success).toBe(false);
  });

  it("keeps v11 projection and historical receipt parsing unchanged", () => {
    expect(SlotProjectionV1Schema.safeParse({
      ...historicalReceiptProjection,
      pendingEgg: { schemaVersion: 1, kind: "silver" },
    }).success).toBe(true);
    expect(SlotProjectionV1Schema.safeParse({
      ...historicalReceiptProjection,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    }).success).toBe(false);
    expect(OfficialGameProjectionV12Schema.safeParse({
      ...historicalReceiptProjection,
      collectionClaims: { schemaVersion: 1, claimedGoalIds: [] },
    }).success).toBe(false);
  });

  it("enforces the Task 2 Egg repeat invariant in v12 projections and results", () => {
    const impossiblePendingEgg = {
      schemaVersion: 1 as const,
      continuationId: "continuation-impossible",
      decisionId: "decision-impossible",
      kind: "silver" as const,
      origin: "collection" as const,
      remainingRepeats: 0 as const,
      phase: "awaiting-spin" as const,
    };
    const impossibleProjection = {
      ...projectionV12,
      pendingEgg: impossiblePendingEgg,
      decision: {
        type: "egg.awaitingSpin" as const,
        decisionId: impossiblePendingEgg.decisionId,
        continuationId: impossiblePendingEgg.continuationId,
        kind: impossiblePendingEgg.kind,
        origin: impossiblePendingEgg.origin,
        remainingRepeats: impossiblePendingEgg.remainingRepeats,
      },
    };
    expect(OfficialGameProjectionV12Schema.safeParse(impossibleProjection).success).toBe(false);
    expect(OfficialGameCommandResultV12Schema.safeParse({
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_impossible_0001",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" }],
      projection: impossibleProjection,
      idempotentReplay: false,
    }).success).toBe(false);

    const legitimatePostRepeat = {
      ...projectionV12,
      pendingEgg: {
        ...impossiblePendingEgg,
        continuationId: "continuation-post-repeat",
        decisionId: "decision-post-repeat",
        remainingRepeats: 0 as const,
        phase: "awaiting-repeat-or-finish" as const,
        settledPrize: { kind: "gold" as const, amount: 1 },
        resolution: { kind: "keep" as const },
      },
      decision: {
        type: "egg.awaitingRepeatOrFinish" as const,
        decisionId: "decision-post-repeat",
        continuationId: "continuation-post-repeat",
        kind: "silver" as const,
        origin: "collection" as const,
        remainingRepeats: 0 as const,
        settledPrize: { kind: "gold" as const, amount: 1 },
        resolution: { kind: "keep" as const },
      },
    };
    expect(OfficialGameProjectionV12Schema.parse(legitimatePostRepeat)).toEqual(
      legitimatePostRepeat,
    );
  });
});

describe("official v15 projection and result wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-09T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V15_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("keeps v14 historical while installing an exact v15 wire identity", () => {
    expect(OfficialGameProjectionV15Schema.parse(projection)).toEqual(projection);
    expect(OfficialGameProjectionV15Schema.safeParse({
      ...projection,
      simulationVersion: OFFICIAL_GAME_V14_SIMULATION_VERSION,
    }).success).toBe(false);
    expect(OfficialGameProjectionV14Schema.safeParse({
      ...projection,
      simulationVersion: OFFICIAL_GAME_V14_SIMULATION_VERSION,
    }).success).toBe(true);

    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" }],
      projection,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV15Schema.parse(result).projection.simulationVersion)
      .toBe(OFFICIAL_GAME_V15_SIMULATION_VERSION);
    expect(OfficialGameCommandResultV15Schema.safeParse({
      ...result,
      projection: {
        ...projection,
        simulationVersion: OFFICIAL_GAME_V14_SIMULATION_VERSION,
      },
    }).success).toBe(false);
  });
});

describe("official v16 projection and result wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-09T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V16_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("keeps v15 historical while installing the semantic win-chat wire", () => {
    const active = {
      ...projection,
      location: {
        kind: "battle" as const,
        worldId: "World_1-1",
        poiId: "1-1_Field_4",
        battleId: "battle-1",
      },
      battle: {
        battleId: "battle-1",
        scene: { kind: "world" as const, worldId: "World_1-1", poiId: "1-1_Field_4" },
        allowRetreat: true,
        teams: [
          [{ shortType: "BlueBabyDragon", level: 1, sourceInstanceId: "monster-1" }],
          [{ shortType: "Drake", level: 5, boss: true }],
        ],
        options: { silver: 100 },
        randomDraws: [0.25],
        commands: [],
        winChat: {
          name: "LeslieSaved",
          alwaysShow: false,
          messageKeys: ["LeslieSavedChatKey"],
        },
      },
    };
    expect(OfficialGameProjectionV16Schema.parse(active)).toEqual(active);
    expect(OfficialGameProjectionV15Schema.safeParse({
      ...active,
      simulationVersion: OFFICIAL_GAME_V15_SIMULATION_VERSION,
    }).success).toBe(false);
    expect(OfficialGameProjectionV16Schema.safeParse({
      ...active,
      battle: { ...active.battle, winChat: { ...active.battle.winChat, imageFile: "ClerkGirl.png" } },
    }).success).toBe(false);

    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "battle.started", battleId: "battle-1" }],
      projection: active,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV16Schema.parse(result).projection.battle?.winChat?.name)
      .toBe("LeslieSaved");
  });
});

describe("official v17 dungeon battle-return wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-10T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V17_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("keeps v16 immutable while accepting the historical v17 identity", () => {
    expect(OfficialGameProjectionV17Schema.parse(projection)).toEqual(projection);
    expect(OfficialGameProjectionV16Schema.safeParse(projection).success).toBe(false);
    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P5",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" as const }],
      projection,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV17Schema.parse(result).projection.simulationVersion)
      .toBe(OFFICIAL_GAME_V17_SIMULATION_VERSION);
    expect(OfficialGameCommandResultV16Schema.safeParse(result).success).toBe(false);
  });

  it("strictly validates the durable handoff and rejects incoherent projection ownership", () => {
    const handoff = {
      schemaVersion: 1 as const,
      battleId: "battle-9",
      outcome: "victory" as const,
      dungeonId: "Dungeon_1",
      floor: 3,
      roomId: "room-1",
      catchTypesBeforeBattle: ["Slime"],
    };
    expect(OfficialDungeonBattleReturnV1Schema.parse(handoff)).toEqual(handoff);
    expect(OfficialDungeonBattleReturnV1Schema.safeParse({
      ...handoff,
      catchTypesBeforeBattle: ["Slime", "Slime"],
    }).success).toBe(false);
    expect(OfficialDungeonBattleReturnV1Schema.safeParse({
      ...handoff,
      callerAuthoredOutcome: true,
    }).success).toBe(false);
    expect(OfficialGameProjectionV17Schema.safeParse({
      ...projection,
      dungeonBattleReturn: handoff,
    }).success).toBe(false);
  });
});

describe("official v18 town-battle lifecycle wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-12T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V18_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("keeps v17 immutable while accepting the installed v18 identity", () => {
    expect(OfficialGameProjectionV18Schema.parse(projection)).toEqual(projection);
    expect(OfficialGameProjectionV17Schema.safeParse(projection).success).toBe(false);
    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P6",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" as const }],
      projection,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV18Schema.parse(result).projection.simulationVersion)
      .toBe(OFFICIAL_GAME_V18_SIMULATION_VERSION);
    expect(OfficialGameCommandResultV17Schema.safeParse(result).success).toBe(false);
  });
});

describe("official v19 Tournament Escape wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-12T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V19_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("is shape-preserving above v18 and keeps the historical parser immutable", () => {
    expect(OfficialGameProjectionV19Schema.parse(projection)).toEqual(projection);
    expect(OfficialGameProjectionV18Schema.safeParse(projection).success).toBe(false);
    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P7",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" as const }],
      projection,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV19Schema.parse(result).projection.simulationVersion)
      .toBe(OFFICIAL_GAME_V19_SIMULATION_VERSION);
    expect(OfficialGameCommandResultV18Schema.safeParse(result).success).toBe(false);
  });
});

describe("official v20 Tournament Save Me wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-13T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V20_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("is shape-preserving above v19 and keeps the historical parser immutable", () => {
    expect(OfficialGameProjectionV20Schema.parse(projection)).toEqual(projection);
    expect(OfficialGameProjectionV19Schema.safeParse(projection).success).toBe(false);
    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P8",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" as const }],
      projection,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV20Schema.parse(result).projection.simulationVersion)
      .toBe(OFFICIAL_GAME_V20_SIMULATION_VERSION);
    expect(OfficialGameCommandResultV19Schema.safeParse(result).success).toBe(false);
  });
});

describe("official v21 Arena Escape recovery wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-14T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V21_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("is shape-preserving above v20 and keeps the historical parser immutable", () => {
    expect(OfficialGameProjectionV21Schema.parse(projection)).toEqual(projection);
    expect(OfficialGameProjectionV20Schema.safeParse(projection).success).toBe(false);
    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4P9",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" as const }],
      projection,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV21Schema.parse(result).projection.simulationVersion)
      .toBe(OFFICIAL_GAME_V21_SIMULATION_VERSION);
    expect(OfficialGameCommandResultV20Schema.safeParse(result).success).toBe(false);
  });
});

describe("official v22 source Save Me return wire", () => {
  const projection = {
    ...historicalReceiptProjection,
    updatedAt: "2026-08-21T00:00:00.000Z",
    simulationVersion: OFFICIAL_GAME_V22_SIMULATION_VERSION,
    collectionClaims: { schemaVersion: 1 as const, claimedGoalIds: [] as string[] },
  };

  it("is shape-preserving above v21 and keeps the historical parser immutable", () => {
    expect(OfficialGameProjectionV22Schema.parse(projection)).toEqual(projection);
    expect(OfficialGameProjectionV21Schema.safeParse(projection).success).toBe(false);
    const result = {
      protocolVersion: GAME_PROTOCOL_VERSION,
      commandId: "command_01J8Y4R6X2N3M4Q0",
      previousRevision: 0,
      revision: 1,
      eventCursorStart: 1,
      eventCursorEnd: 1,
      events: [{ seq: 1, type: "slot.created" as const }],
      projection,
      idempotentReplay: false,
    };
    expect(OfficialGameCommandResultV22Schema.parse(result).projection.simulationVersion)
      .toBe(OFFICIAL_GAME_V22_SIMULATION_VERSION);
    expect(OfficialGameCommandResultV21Schema.safeParse(result).success).toBe(false);
  });
});


describe("source-sized batting order wire admission", () => {
  it("admits eighteen active members and retains the party envelope ceiling", () => {
    const ids = Array.from({ length: 18 }, (_, i) => `monster-${i}`);
    expect(CurrentGameCommandV1Schema.parse({ type: "party.commitBattingPriority", activeInstanceIds: ids }))
      .toEqual({ type: "party.commitBattingPriority", activeInstanceIds: ids });
    expect(CurrentGameCommandV1Schema.safeParse({ type: "party.commitBattingPriority",
      activeInstanceIds: Array.from({ length: 257 }, (_, i) => `monster-${i}`) }).success).toBe(false);
  });
});
