import { loadGameData, type GameData, type MonsterDef } from "@dib/gamedata";
import {
  EGG_REEL_MIN_HELD_FRAMES,
  WorldTripParty,
  jobXpForLevel,
  type EggHatchPlayerView,
  type EggHatchPrize,
  type Rng,
} from "@dib/engine";
import {
  EGG_RELEASE_MAX_HELD_FRAMES_V1,
  OfficialEggContinuationV1Schema,
  OfficialEggSpinningV1Schema,
} from "@dib/game-protocol";
import { PlayerProfile, sourceNewGameProfileDefaults } from "@dib/player-domain";
import { describe, expect, it } from "vitest";
import {
  createOfficialEgg,
  finishOfficialEgg,
  releaseOfficialEgg,
  repeatOfficialEgg,
  resolveOfficialEggPrize,
  startOfficialEgg,
  replayOfficialEggLanding,
  type OfficialEggFeedRecipientResolver,
  type OfficialEggPrize,
  type OfficialEggAwaitingPrizeResolution,
  type OfficialEggAwaitingSpin,
  type OfficialEggSpinning,
} from "../src/eggContinuation.js";

const game = loadGameData();

const eggStartFixtureStats = {
  Attack: 1,
  Defense: 1,
  Magic: 1,
  MaxHP: 1,
  Resist: 1,
  Speed: 1,
};

const eggStartFixtureMonsters = [
  {
    path: "Fixture.Alpha",
    shortType: "Alpha",
    category: "Normal",
    element: "Fire",
    index: 1,
    quality: 1,
    // Loader-materialized native default (omitted key copies `quality`).
    eggUnlockQuality: 1,
    stars: 1,
    rootStats: eggStartFixtureStats,
    unarmedAttackType: "Melee",
  },
  {
    path: "Fixture.Beta",
    shortType: "Beta",
    category: "Normal",
    element: "Water",
    index: 2,
    quality: 1,
    // Loader-materialized native default (omitted key copies `quality`).
    eggUnlockQuality: 1,
    stars: 2,
    rootStats: eggStartFixtureStats,
    unarmedAttackType: "Melee",
  },
  {
    path: "Fixture.Gamma",
    shortType: "Gamma",
    category: "Normal",
    element: "Earth",
    index: 3,
    quality: 1,
    // Loader-materialized native default (omitted key copies `quality`).
    eggUnlockQuality: 1,
    stars: 4,
    rootStats: eggStartFixtureStats,
    unarmedAttackType: "Melee",
  },
] satisfies readonly MonsterDef[];

const eggStartFixtureByShortType = new Map(
  eggStartFixtureMonsters.map((monster) => [monster.shortType, monster]),
);

// This is the smallest GameData surface used by the Gold Egg start path: three ordinary
// monsters exercise eligibility/order, duplicate provider construction, shuffle, and the
// second-score preview cutoff without invoking the real catalog or any filler branch.
const eggStartFixture = {
  allMonsters: () => eggStartFixtureMonsters,
  evolveChainOf: (shortType: string): readonly string[] => {
    if (!eggStartFixtureByShortType.has(shortType)) {
      throw new Error(`unknown fixture monster: ${shortType}`);
    }
    return [shortType];
  },
  monsterByShortType: (shortType: string): MonsterDef => {
    const monster = eggStartFixtureByShortType.get(shortType);
    if (monster === undefined) throw new Error(`unknown fixture monster: ${shortType}`);
    return monster;
  },
} satisfies Pick<GameData, "allMonsters" | "evolveChainOf" | "monsterByShortType">;

const eggStartFixturePlayer: EggHatchPlayerView = {
  highestRegisteredLevel: () => 0,
  highestRegisteredLivingLevel: 0,
  goldEggMonsterLevel: 25,
  availableGemSlots: [],
  hasCombineRecipe: () => false,
  spiritSavedXp: () => 0,
};

class RecordingRng implements Rng {
  readonly bounds: number[] = [];
  readonly operations: string[] = [];
  nextCalls = 0;
  private cursor = 0;

  constructor(
    private readonly values: readonly number[] = [0.5],
    private readonly failWhenExhausted = false,
  ) {}

  next(): number {
    this.operations.push("next");
    this.nextCalls += 1;
    if (this.failWhenExhausted && this.cursor >= this.values.length) {
      throw new Error(`test RNG tape exhausted at ${this.cursor}`);
    }
    const value = this.values[Math.min(this.cursor++, this.values.length - 1)];
    if (value === undefined) throw new Error("test RNG has no value");
    return value;
  }

  intBelow(n: number): number {
    this.operations.push(`intBelow:${n}`);
    this.bounds.push(n);
    return Math.floor(this.next() * n);
  }

  chance(probability: number): boolean {
    this.operations.push(`chance:${probability}`);
    return this.next() < probability;
  }
}

function playerView(overrides: Partial<EggHatchPlayerView> = {}): EggHatchPlayerView {
  return {
    highestRegisteredLevel: () => 0,
    highestRegisteredLivingLevel: 0,
    goldEggMonsterLevel: 25,
    availableGemSlots: [0, 2],
    hasCombineRecipe: () => false,
    spiritSavedXp: () => 0,
    ...overrides,
  };
}

function identity(prefix: string): { readonly nextDecisionId: () => string } {
  let sequence = 0;
  return { nextDecisionId: () => `${prefix}-decision-${++sequence}` };
}

function awaitingSpin(
  kind: "silver" | "gold" = "silver",
  origin: "store" | "tournament" | "battle" | "quest" | "dungeonTreasure" | "dungeonCatch" | "collection" = "collection",
): OfficialEggAwaitingSpin {
  return createOfficialEgg({
    kind,
    origin,
    continuationId: `${origin}-continuation-1`,
    decisionId: `${origin}-decision-1`,
  });
}

function onePrizeSpinning(
  prize: EggHatchPrize,
  kind: "silver" | "gold" = "silver",
  remainingRepeats: 0 | 1 = 1,
): OfficialEggSpinning {
  const officialPrize = prize.kind === "gem"
    ? { ...prize, enabledStats: [...prize.enabledStats] }
    : { ...prize };
  return OfficialEggSpinningV1Schema.parse({
    ...awaitingSpin(kind),
    phase: "spinning",
    providers: [officialPrize],
    reel: [officialPrize],
    previewMonsterShortTypes: [],
    remainingRepeats,
  }) as OfficialEggSpinning;
}

function onePrizeAwaitingResolution(
  prize: EggHatchPrize,
  kind: "silver" | "gold" = "silver",
  remainingRepeats: 0 | 1 = 1,
  origin: "store" | "tournament" | "battle" | "quest" | "dungeonTreasure" | "dungeonCatch" | "collection" = "collection",
): OfficialEggAwaitingPrizeResolution {
  const spinning = origin === "collection"
    ? onePrizeSpinning(prize, kind, remainingRepeats)
    : spinningFixture([prize.kind === "gem" ? { ...prize, enabledStats: [...prize.enabledStats] } : { ...prize }], {
      kind,
      origin,
      remainingRepeats,
    });
  const released = releaseOfficialEgg({
    continuation: spinning,
    rng: new RecordingRng([0.5]),
    identity: identity("release-fixture"),
  });
  return released;
}

function spinningFixture(
  reel: readonly OfficialEggPrize[],
  options: {
    readonly kind?: "silver" | "gold";
    readonly origin?: "store" | "tournament" | "battle" | "quest" | "dungeonTreasure" | "dungeonCatch" | "collection";
    readonly remainingRepeats?: 0 | 1;
  } = {},
): OfficialEggSpinning {
  const kind = options.kind ?? "silver";
  const origin = options.origin ?? "collection";
  return OfficialEggSpinningV1Schema.parse({
    schemaVersion: 1,
    continuationId: `${origin}-fixture-continuation`,
    decisionId: `${origin}-fixture-decision`,
    kind,
    origin,
    remainingRepeats: options.remainingRepeats ?? (origin === "store" ? 0 : 1),
    phase: "spinning",
    providers: reel,
    reel,
    previewMonsterShortTypes: [],
  }) as OfficialEggSpinning;
}

function feedResolver(party: WorldTripParty): OfficialEggFeedRecipientResolver {
  return {
    resolveRecipient(recipientInstanceId) {
      const member = party.monsters().find(({ instanceId }) => instanceId === recipientInstanceId);
      if (member === undefined || member.level < 1 || member.level > 150) return undefined;
      return { level: member.level };
    },
  };
}

function realFeedParty(level: number, instanceId = "recipient"): WorldTripParty {
  const shortType = "BlueBabyDragon";
  return new WorldTripParty(game, [{
    instanceId,
    shortType,
    level,
    cumulativeXp: jobXpForLevel(level, game.jobXpPenalty(shortType)),
    currentHp: 1,
  }], 1);
}

function expectActionError(action: () => unknown, code: "ACTION_NOT_ALLOWED" | "INSUFFICIENT_FUNDS"): void {
  try {
    action();
    throw new Error("expected action to throw");
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe("official Egg continuation source vectors", () => {
  it("starts by persisting the generated provider, reel, and preview results in source draw order", () => {
    const tape = [
      0,
      0.5,
      0.2,
      0.75,
      0.5,
      0,
      0.8,
      0.25,
      0.7,
      0.1,
      0,
      0.99,
      0,
      0.75,
      0.5, 0, 0.8, 0.25, 0.7, 0.1, 0, 0.99, 0, 0.5, 0.25, 0.75, 0.1, 0.9, 0.3, 0.6, 0,
      0.99, 0,
      0, // singleton Casino music selection
    ] as const;
    const actualRng = new RecordingRng(tape, true);
    const actual = startOfficialEgg({
      continuation: awaitingSpin("gold"),
      game: eggStartFixture as unknown as GameData,
      player: eggStartFixturePlayer,
      rng: actualRng,
      identity: identity("start"),
    });

    expect(actual).toEqual({
      schemaVersion: 1,
      continuationId: "collection-continuation-1",
      decisionId: "start-decision-1",
      phase: "spinning",
      kind: "gold",
      origin: "collection",
      remainingRepeats: 1,
      providers: [
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Alpha", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Alpha", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Beta", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Beta", level: 25, prizeMonster: false },
        ...Array.from({ length: 10 }, () => ({
          kind: "monster" as const,
          shortType: "Gamma",
          level: 25,
          prizeMonster: false,
        })),
        { kind: "monster", shortType: "GoldBabyDragon", level: 1, prizeMonster: true },
      ],
      reel: [
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Beta", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Alpha", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "GoldBabyDragon", level: 1, prizeMonster: true },
        { kind: "monster", shortType: "Alpha", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Beta", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
        { kind: "monster", shortType: "Gamma", level: 25, prizeMonster: false },
      ],
      previewMonsterShortTypes: ["Beta", "Gamma"],
    });
    expect(actualRng.nextCalls).toBe(34);
    expect(actualRng.bounds).toEqual([
      6, 6, 6,
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      4,
      17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      2, 1, 1, // previews then Casino
    ]);
    expect(actualRng.operations).toEqual([
      "intBelow:6", "next",
      "intBelow:6", "next",
      "intBelow:6", "next",
      ...Array.from({ length: 10 }, () => ["intBelow:1", "next"]).flat(),
      "intBelow:4", "next",
      ...Array.from({ length: 17 }, (_, index) => [`intBelow:${17 - index}`, "next"]).flat(),
      "intBelow:2", "next",
      "intBelow:1", "next",
      "intBelow:1", "next", // Casino
    ]);
    expect(OfficialEggContinuationV1Schema.parse(actual)).toEqual(actual);
  });

  it("selects previews from provider order even when the shuffled reel reverses the candidates", () => {
    const actual = startOfficialEgg({
      continuation: awaitingSpin("gold"),
      game: eggStartFixture as unknown as GameData,
      player: eggStartFixturePlayer,
      rng: new RecordingRng([
        // Paired unseen providers, ten retained-ordinary fill draws, then the prize dragon.
        0, 0.5, 0.2,
        0.75, 0.5, 0, 0.8, 0.25, 0.7, 0.1, 0, 0.99, 0,
        0.75,
        // Shuffle Beta ahead of Gamma. These draws must happen before preview selection, but the
        // resulting reel order must not become the preview candidate order.
        0.25, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        // Pick candidate index 1, then the sole remainder from provider order [Gamma, Beta].
        0.99, 0,
        0, // singleton Casino music selection
      ], true),
      identity: identity("provider-order"),
    });

    expect(actual.reel.find((entry) => entry.kind === "monster" && !entry.prizeMonster))
      .toMatchObject({ kind: "monster", shortType: "Beta", prizeMonster: false });
    expect(actual.previewMonsterShortTypes).toEqual(["Beta", "Gamma"]);
  });

  it("releases at the first fixed tick strictly past 1.5 seconds, draws friction once, and commits the landing", () => {
    const reel = Array.from({ length: 7 }, (_, index) => ({
      kind: "gold" as const,
      amount: index + 1,
    }));
    const spinning = spinningFixture(reel);

    const actualRng = new RecordingRng([0.75]);
    const actual = releaseOfficialEgg({
      continuation: spinning,
      rng: actualRng,
      identity: identity("release"),
    });

    expect(actual.phase).toBe("awaiting-prize-resolution");
    if (actual.phase !== "awaiting-prize-resolution") throw new Error("release phase drifted");
    expect(actual.finalReelState).toEqual({
      elapsedSeconds: 4.700006008148193,
      index: 22.358867645263672,
      speed: -2.0274834632873535,
      friction: 3.1499998569488525,
      centerIndex: 1,
      stopped: true,
    });
    expect(actual.landedPrize).toEqual(reel[1]);
    expect(actualRng.nextCalls).toBe(1);
    expect(actualRng.bounds).toEqual([]);
    expect(OfficialEggContinuationV1Schema.parse(JSON.parse(JSON.stringify(actual))))
      .toEqual(actual);
  });

  it("lets the player's held-frame count move the landing", () => {
    const reel = Array.from({ length: 7 }, (_, index) => ({
      kind: "gold" as const,
      amount: index + 1,
    }));
    // Same friction draw for every count: only the release point differs, which is exactly the
    // skill the source's reel rewards.
    const landings = [
      EGG_REEL_MIN_HELD_FRAMES,
      EGG_REEL_MIN_HELD_FRAMES + 1,
      EGG_REEL_MIN_HELD_FRAMES + 3,
      120,
      600,
    ].map((heldFrames) => {
      const released = releaseOfficialEgg({
        continuation: spinningFixture(reel),
        rng: new RecordingRng([0.75]),
        identity: identity(`held-${heldFrames}`),
        heldFrames,
      });
      if (released.phase !== "awaiting-prize-resolution") throw new Error("release phase drifted");
      return { heldFrames, centerIndex: released.finalReelState.centerIndex };
    });
    expect(new Set(landings.map((landing) => landing.centerIndex)).size).toBeGreaterThan(1);
  });

  it("reproduces the legacy fixed release when the count names the same frame", () => {
    const reel = Array.from({ length: 7 }, (_, index) => ({
      kind: "gold" as const,
      amount: index + 1,
    }));
    const legacy = releaseOfficialEgg({
      continuation: spinningFixture(reel),
      rng: new RecordingRng([0.75]),
      identity: identity("legacy"),
    });
    const counted = releaseOfficialEgg({
      continuation: spinningFixture(reel),
      rng: new RecordingRng([0.75]),
      identity: identity("legacy"),
      heldFrames: EGG_REEL_MIN_HELD_FRAMES,
    });
    if (legacy.phase !== "awaiting-prize-resolution") throw new Error("release phase drifted");
    if (counted.phase !== "awaiting-prize-resolution") throw new Error("release phase drifted");

    expect(counted.finalReelState).toEqual(legacy.finalReelState);
    expect(counted.landedPrize).toEqual(legacy.landedPrize);
  });

  it("draws friction only after the held-frame count is committed", () => {
    const reel = Array.from({ length: 7 }, (_, index) => ({
      kind: "gold" as const,
      amount: index + 1,
    }));
    // The same release point under two different draws must be able to land elsewhere, otherwise
    // the client could solve for a prize from the reel it already holds.
    const landings = [0, 0.5, 0.999].map((draw) => {
      const released = releaseOfficialEgg({
        continuation: spinningFixture(reel),
        rng: new RecordingRng([draw]),
        identity: identity(`draw-${draw}`),
        heldFrames: 300,
      });
      if (released.phase !== "awaiting-prize-resolution") throw new Error("release phase drifted");
      return released.finalReelState.centerIndex;
    });
    expect(new Set(landings).size).toBeGreaterThan(1);
  });

  it.each([
    ["before the native gate", EGG_REEL_MIN_HELD_FRAMES - 1],
    ["at zero", 0],
    ["above the wire cap", EGG_RELEASE_MAX_HELD_FRAMES_V1 + 1],
    ["fractional", 120.5],
  ])("rejects a held-frame count %s", (_label, heldFrames) => {
    const reel = Array.from({ length: 7 }, (_, index) => ({
      kind: "gold" as const,
      amount: index + 1,
    }));
    const rng = new RecordingRng([0.75]);
    expect(() => releaseOfficialEgg({
      continuation: spinningFixture(reel),
      rng,
      identity: identity("rejected"),
      heldFrames,
    })).toThrowError(/held-frame count is out of range|before the native 1.5s release gate/);
    // A rejected release must not have consumed the draw.
    expect(rng.nextCalls).toBe(0);
  });

  it("replays the committed landing from persisted reel state without RNG", () => {
    const reel = Array.from({ length: 7 }, (_, index) => ({
      kind: "gold" as const,
      amount: index + 1,
    }));
    const releaseRng = new RecordingRng([0.75]);
    const released = releaseOfficialEgg({
      continuation: spinningFixture(reel),
      rng: releaseRng,
      identity: identity("replay-release"),
    });
    const persisted = OfficialEggContinuationV1Schema.parse(
      JSON.parse(JSON.stringify(released)),
    );
    const replayed = replayOfficialEggLanding(persisted);
    expect(replayed).toEqual(reel[1]);
    expect(replayed).toEqual(released.landedPrize);
    expect(releaseRng.nextCalls).toBe(1);
  });

  it.each([
    [
      { kind: "monster", shortType: "BlueBabyDragon", level: 7, prizeMonster: true },
      { kind: "monsterJoin", shortType: "BlueBabyDragon", jobLevel: 7 },
    ],
    [{ kind: "gold", amount: 50 }, { kind: "gold", amount: 50 }],
    [{ kind: "silver", amount: 500 }, { kind: "silver", amount: 500 }],
    [{ kind: "gem", level: 42, quality: 1, slot: 2, enabledStats: ["Attack", "Defense"] },
      { kind: "gem", level: 42, quality: 1, slot: 2, enabledStats: ["Attack", "Defense"] }],
    [{ kind: "recipe", combineName: "Recipe" }, { kind: "recipe", combineName: "Recipe" }],
    [{ kind: "spiritTotem", shortType: "Spirit" }, { kind: "spiritTotem", shortType: "Spirit" }],
    [{ kind: "item", definitionPath: "Usables.CardSilver", level: 2 },
      { kind: "item", definitionPath: "Usables.CardSilver", level: 2 }],
  ] as const)("settles a Keep for every source prize kind: %j", (prize, reward) => {
    const resolved = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution(prize),
      resolution: { kind: "keep" },
      identity: identity("keep"),
    });
    expect(resolved.continuation.phase).toBe("awaiting-repeat-or-finish");
    expect(resolved.continuation.resolution).toEqual({ kind: "keep" });
    expect(resolved.settlement).toEqual({ kind: "keep", prize, reward });
  });

  it("treats feed cancellation as Keep and preserves source full-target behavior at levels 149 and 150", () => {
    const prize = {
      kind: "monster" as const,
      shortType: "BlueBabyDragon",
      level: 1,
      prizeMonster: true,
    };
    const cancelled = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution(prize),
      resolution: { kind: "keep" },
      identity: identity("cancel"),
    });
    expect(cancelled.settlement).toMatchObject({ kind: "keep", prize });

    const level149Party = realFeedParty(149);
    const fed = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution(prize),
      resolution: { kind: "feed", recipientInstanceId: "recipient" },
      recipientResolver: feedResolver(level149Party),
      identity: identity("feed-149"),
    });
    expect(fed.settlement).toEqual({
      kind: "feed",
      prize,
      recipientInstanceId: "recipient",
      recipientLevel: 149,
    });
    expect(level149Party.monster("recipient")).toMatchObject({ level: 149 });

    const level150Party = realFeedParty(150);
    const full = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution(prize),
      resolution: { kind: "feed", recipientInstanceId: "recipient" },
      recipientResolver: feedResolver(level150Party),
      identity: identity("feed-150"),
    });
    expect(full.settlement).toEqual({
      kind: "discard",
      prize,
      recipientInstanceId: "recipient",
      recipientLevel: 150,
      reason: "recipient-full",
    });
    expect(level150Party.monster("recipient")).toMatchObject({ level: 150 });
  });

  it("rejects missing and ineligible Feed targets before advancing the continuation", () => {
    const prize = {
      kind: "monster" as const,
      shortType: "BlueBabyDragon",
      level: 1,
      prizeMonster: true,
    };
    const continuation = onePrizeAwaitingResolution(prize);
    const allocator = identity("feed-invalid");
    const party = realFeedParty(149);
    const partyResolver = feedResolver(party);
    const resolver: OfficialEggFeedRecipientResolver = {
      resolveRecipient(recipientInstanceId) {
        if (recipientInstanceId === "ineligible") return undefined;
        return partyResolver.resolveRecipient(recipientInstanceId);
      },
    };

    const before = JSON.stringify(continuation);
    expectActionError(() => resolveOfficialEggPrize({
      continuation,
      resolution: { kind: "feed", recipientInstanceId: "missing" },
      recipientResolver: resolver,
      identity: allocator,
    }), "ACTION_NOT_ALLOWED");
    expect(JSON.stringify(continuation)).toBe(before);

    expectActionError(() => resolveOfficialEggPrize({
      continuation,
      resolution: { kind: "feed", recipientInstanceId: "ineligible" },
      recipientResolver: resolver,
      identity: identity("feed-ineligible"),
    }), "ACTION_NOT_ALLOWED");
    expect(JSON.stringify(continuation)).toBe(before);
  });

  it.each([
    ["silver", 100],
    ["gold", 298],
  ] as const)("charges the server-derived %s repeat cost and consumes the one repeat", (kind, cost) => {
    const wallet = { gold: 10_000 };
    const current = onePrizeAwaitingResolution({ kind: "gold", amount: 50 }, kind);
    const settled = resolveOfficialEggPrize({
      continuation: current,
      resolution: { kind: "keep" },
      identity: identity("resolve-repeat"),
    }).continuation;
    const rng = new RecordingRng([0.5]);
    const repeated = repeatOfficialEgg({
      continuation: settled,
      game,
      player: playerView(),
      rng,
      goldBalance: wallet,
      identity: identity("repeat"),
    });
    expect(repeated.goldCost).toBe(cost);
    expect(wallet.gold).toBe(10_000);
    const expectedDraws = kind === "silver" ? 61 : 17;
    expect(rng.nextCalls).toBe(expectedDraws);
    expect(rng.operations).toHaveLength(expectedDraws * 2 - (kind === "silver" ? 10 : 0));
    if (kind === "silver") expect(rng.operations.slice(8, 18)).toEqual(Array(10).fill("next"));
    const choiceOperations = kind === "silver"
      ? [...rng.operations.slice(0, 8), ...rng.operations.slice(18)]
      : rng.operations;
    expect(choiceOperations.every((operation, index) =>
      index % 2 === 0 ? operation.startsWith("intBelow:") : operation === "next")).toBe(true);
    expect(rng.operations.slice(0, 6)).toEqual([
      "intBelow:4", "next", "intBelow:3", "next", "intBelow:2", "next",
    ]);
    expect(repeated.continuation.phase).toBe("spinning");
    expect(repeated.continuation.remainingRepeats).toBe(0);
  });

  it("rejects insufficient funds before debit or any repeat RNG draw", () => {
    const wallet = { gold: 99 };
    const rng = new RecordingRng([0.5]);
    const settled = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution({ kind: "gold", amount: 50 }),
      resolution: { kind: "keep" },
      identity: identity("insufficient-resolve"),
    }).continuation;
    expectActionError(() => repeatOfficialEgg({
      continuation: settled,
      game,
      player: playerView(),
      rng,
      goldBalance: wallet,
      identity: identity("insufficient-repeat"),
    }), "INSUFFICIENT_FUNDS");
    expect(wallet.gold).toBe(99);
    expect(rng.nextCalls).toBe(0);
  });

  it("does not mutate a profile-like wallet when replacement generation fails", () => {
    const profile = new PlayerProfile({
      ...sourceNewGameProfileDefaults("BlueBabyDragon"),
      monsterPartyLevels: [1],
      gold: 10_000,
    });
    const before = profile.stateSnapshot();
    const settled = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution({ kind: "gold", amount: 50 }),
      resolution: { kind: "keep" },
      identity: identity("repeat-failure-resolve"),
    }).continuation;
    expect(() => repeatOfficialEgg({
      continuation: settled,
      game,
      player: playerView({ availableGemSlots: [3] }),
      rng: new RecordingRng([0.5]),
      goldBalance: { gold: profile.stateSnapshot().gold },
      identity: identity("repeat-failure"),
    })).toThrow(/source slots/);
    expect(profile.stateSnapshot()).toEqual(before);
  });

  it("keeps Store Eggs at remainingRepeats zero and forbids a second non-Store repeat", () => {
    const store = awaitingSpin("silver", "store");
    expect(store.remainingRepeats).toBe(0);
    expect(() => createOfficialEgg({
      kind: "silver",
      origin: "collection",
      remainingRepeats: 0,
      continuationId: "invalid-continuation",
      decisionId: "invalid-decision",
    })).toThrow(/one remaining repeat/);
    const storeSettled = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution({ kind: "gold", amount: 50 }, "silver", 0, "store"),
      resolution: { kind: "keep" },
      identity: identity("store-resolve"),
    }).continuation;
    expectActionError(() => repeatOfficialEgg({
      continuation: storeSettled,
      game,
      player: playerView(),
      rng: new RecordingRng(),
      goldBalance: { gold: 10_000 },
      identity: identity("store-repeat"),
    }), "ACTION_NOT_ALLOWED");

    const firstSettled = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution({ kind: "gold", amount: 50 }, "silver", 1),
      resolution: { kind: "keep" },
      identity: identity("repeat-1-resolve"),
    }).continuation;
    const repeated = repeatOfficialEgg({
      continuation: firstSettled,
      game,
      player: playerView(),
      rng: new RecordingRng(),
      goldBalance: { gold: 10_000 },
      identity: identity("repeat-1"),
    });
    const secondSettled = resolveOfficialEggPrize({
      continuation: releaseOfficialEgg({
        continuation: repeated.continuation,
        rng: new RecordingRng(),
        identity: identity("repeat-2-release"),
      }),
      resolution: { kind: "keep" },
      identity: identity("repeat-2-resolve"),
    }).continuation;
    expect(secondSettled.remainingRepeats).toBe(0);
    expectActionError(() => repeatOfficialEgg({
      continuation: secondSettled,
      game,
      player: playerView(),
      rng: new RecordingRng(),
      goldBalance: { gold: 10_000 },
      identity: identity("repeat-2"),
    }), "ACTION_NOT_ALLOWED");
  });

  it("fails phase-invalid actions before RNG, debit, or mutation, and finish clears only settled state", () => {
    const rng = new RecordingRng();
    const wallet = { gold: 10_000 };
    const base = awaitingSpin();
    expectActionError(() => startOfficialEgg({
      continuation: { ...base, phase: "spinning", providers: [], reel: [], previewMonsterShortTypes: [] },
      game,
      player: playerView(),
      rng,
      identity: identity("bad-start"),
    }), "ACTION_NOT_ALLOWED");
    expectActionError(() => startOfficialEgg({
      continuation: {
        ...base,
        origin: "store",
        remainingRepeats: 1,
      } as never,
      game,
      player: playerView(),
      rng,
      identity: identity("bad-store"),
    }), "ACTION_NOT_ALLOWED");
    expectActionError(() => releaseOfficialEgg({
      continuation: base,
      rng,
      identity: identity("bad-release"),
    }), "ACTION_NOT_ALLOWED");
    expectActionError(() => resolveOfficialEggPrize({
      continuation: base,
      resolution: { kind: "keep" },
      identity: identity("bad-resolve"),
    }), "ACTION_NOT_ALLOWED");
    expectActionError(() => repeatOfficialEgg({
      continuation: base,
      game,
      player: playerView(),
      rng,
      goldBalance: wallet,
      identity: identity("bad-repeat"),
    }), "ACTION_NOT_ALLOWED");
    expectActionError(() => finishOfficialEgg(base), "ACTION_NOT_ALLOWED");
    expect(rng.nextCalls).toBe(0);

    const settled = resolveOfficialEggPrize({
      continuation: onePrizeAwaitingResolution({ kind: "gold", amount: 50 }),
      resolution: { kind: "keep" },
      identity: identity("finish"),
    }).continuation;
    expect(finishOfficialEgg(settled)).toBeUndefined();
    expectActionError(
      () => finishOfficialEgg({
        ...settled,
        phase: "awaiting-repeat-or-finish",
        settledPrize: undefined,
      } as never),
      "ACTION_NOT_ALLOWED",
    );
  });
});
