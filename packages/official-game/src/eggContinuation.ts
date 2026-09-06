import {
  EGG_REEL_MIN_RELEASE_SECONDS,
  EggReel,
  eggRepeatCost,
  generateEggHatchPool,
  selectEggPreviewMonsters,
  type EggHatchPlayerView,
  type EggHatchPrize,
  type EggHatchKind,
  type EggReelState,
  type Rng,
  type EggRngRules,
} from "@dib/engine";
import type { GameData } from "@dib/gamedata";
import {
  EGG_RELEASE_MAX_HELD_FRAMES_V1,
  OfficialEggContinuationV1Schema,
  OFFICIAL_EGG_POOL_MAX_ENTRIES,
  SOURCE_EGG_POOL_MAX_ENTRIES,
  type OfficialEggAwaitingPrizeResolutionV1,
  type OfficialEggAwaitingRepeatOrFinishV1,
  type OfficialEggAwaitingSpinV1,
  type OfficialEggContinuationV1,
  type OfficialEggOriginV1,
  type OfficialEggPrizeV1,
  type OfficialEggSpinningV1,
} from "@dib/game-protocol";
import { GameServiceError } from "@dib/game-service";

/** The source-tagged origins accepted by the authoritative Egg aggregate. */
export type OfficialEggOrigin = OfficialEggOriginV1;
export type OfficialEggContinuation = OfficialEggContinuationV1;
export type OfficialEggAwaitingSpin = OfficialEggAwaitingSpinV1;
export type OfficialEggSpinning = OfficialEggSpinningV1;
export type OfficialEggAwaitingPrizeResolution = OfficialEggAwaitingPrizeResolutionV1;
export type OfficialEggAwaitingRepeatOrFinish = OfficialEggAwaitingRepeatOrFinishV1;
export type OfficialEggPrize = OfficialEggPrizeV1;

export type OfficialEggPrizeResolution =
  | { readonly kind: "keep" }
  | { readonly kind: "feed"; readonly recipientInstanceId: string };

/** A server-owned identity source. Client commands never provide either ID. */
export interface OfficialEggDecisionAllocator {
  readonly nextDecisionId: () => string;
}

export interface CreateOfficialEggInput {
  readonly kind: EggHatchKind;
  readonly origin: OfficialEggOrigin;
  readonly continuationId: string;
  readonly decisionId: string;
  readonly remainingRepeats?: 0 | 1;
}

export interface OfficialEggStartInput {
  readonly rngRules?: EggRngRules;
  readonly continuation: OfficialEggContinuation;
  readonly game: GameData;
  readonly player: EggHatchPlayerView;
  readonly rng: Rng;
  readonly identity: OfficialEggDecisionAllocator;
}

export interface OfficialEggReleaseInput {
  readonly rngRules?: EggRngRules;
  readonly continuation: OfficialEggContinuation;
  readonly rng: Rng;
  readonly identity: OfficialEggDecisionAllocator;


  readonly heldFrames?: number;
}

export interface OfficialEggResolveInput {
  readonly continuation: OfficialEggContinuation;
  readonly resolution: OfficialEggPrizeResolution;
  /** Read-only server-owned party view. It returns only an eligible target's pre-feed level. */
  readonly recipientResolver?: OfficialEggFeedRecipientResolver;
  readonly identity: OfficialEggDecisionAllocator;
}

export interface OfficialEggFeedRecipientResolver {
  /** Missing, ineligible, or non-party IDs return undefined without mutating the party. */
  readonly resolveRecipient: (recipientInstanceId: string) =>
    | { readonly level: number }
    | undefined;
}

/** A server-owned balance snapshot. It deliberately has no debit or profile mutator. */
export interface OfficialEggGoldBalanceView {
  readonly gold: number;
}

export interface OfficialEggRepeatInput {
  readonly rngRules?: EggRngRules;
  readonly continuation: OfficialEggContinuation;
  readonly game: GameData;
  readonly player: EggHatchPlayerView;
  readonly rng: Rng;
  readonly goldBalance: OfficialEggGoldBalanceView;
  readonly identity: OfficialEggDecisionAllocator;
}

export type OfficialEggKeepReward =
  | { readonly kind: "monsterJoin"; readonly shortType: string; readonly jobLevel: number }
  | Exclude<EggHatchPrize, { readonly kind: "monster" }>;

export type OfficialEggPrizeSettlement =
  | {
      readonly kind: "keep";
      readonly prize: OfficialEggPrize;
      readonly reward: OfficialEggKeepReward;
    }
  | {
      readonly kind: "feed";
      readonly prize: Extract<OfficialEggPrize, { readonly kind: "monster" }>;
      readonly recipientInstanceId: string;
      readonly recipientLevel: number;
    }
  | {
      readonly kind: "discard";
      readonly prize: Extract<OfficialEggPrize, { readonly kind: "monster" }>;
      readonly recipientInstanceId: string;
      readonly recipientLevel: 150;
      readonly reason: "recipient-full";
    };


export function createOfficialEgg(input: CreateOfficialEggInput): OfficialEggAwaitingSpin {
  const remainingRepeats = input.remainingRepeats ?? (input.origin === "store" ? 0 : 1);
  if (remainingRepeats !== (input.origin === "store" ? 0 : 1)) {
    throw new Error(
      input.origin === "store"
        ? "Official Egg Store origin cannot retain a repeat"
        : "Official Egg origin must start with one remaining repeat",
    );
  }
  requireId(input.continuationId, "continuationId");
  requireId(input.decisionId, "decisionId");
  return checkedContinuation({
    schemaVersion: 1,
    continuationId: input.continuationId,
    decisionId: input.decisionId,
    kind: input.kind,
    origin: input.origin,
    remainingRepeats,
    phase: "awaiting-spin",
  }) as OfficialEggAwaitingSpin;
}

/** `egg.start`: generate and persist the source pool, reel, and two preview selections. */
export function startOfficialEgg(input: OfficialEggStartInput): OfficialEggSpinning {
  const current = requirePhase(input.continuation, "awaiting-spin", "egg.start");
  const generated = generateSpin(input.game, input.player, current.kind, input.rng, input.rngRules);
  const decisionId = nextDecisionId(input.identity);
  return checkedContinuation({
    schemaVersion: 1,
    continuationId: current.continuationId,
    decisionId,
    kind: current.kind,
    origin: current.origin,
    remainingRepeats: current.remainingRepeats,
    phase: "spinning",
    providers: generated.providers,
    reel: generated.reel,
    previewMonsterShortTypes: generated.previewMonsterShortTypes,
  }) as OfficialEggSpinning;
}


export function releaseOfficialEgg(input: OfficialEggReleaseInput): OfficialEggAwaitingPrizeResolution {
  const spinning = requirePhase(input.continuation, "spinning", "egg.release");
  assertPool(spinning.providers, spinning.reel);

  const reel = new EggReel(spinning.reel.length, input.rng, input.rngRules);
  let state: EggReelState;
  if (input.heldFrames === undefined) {
    state = reel.advanceFrame();
    while (state.elapsedSeconds <= EGG_REEL_MIN_RELEASE_SECONDS) {
      state = reel.advanceFrame();
    }
  } else {
    if (
      !Number.isSafeInteger(input.heldFrames) ||
      input.heldFrames < 1 ||
      input.heldFrames > EGG_RELEASE_MAX_HELD_FRAMES_V1
    ) {
      throw new GameServiceError("ACTION_NOT_ALLOWED", "Egg release held-frame count is out of range");
    }
    state = reel.advanceFrames(input.heldFrames);
  }
  if (!reel.release()) {
    // Reachable client input now, not an internal invariant: the native reel refuses a touch that
    // ends within the first 1.5 seconds, so a short count is a rejected release, not a corruption.
    throw new GameServiceError(
      "ACTION_NOT_ALLOWED",
      "Egg release is before the native 1.5s release gate",
    );
  }
  while (!state.stopped) state = reel.advanceFrame();

  const landedPrize = spinning.reel[state.centerIndex];
  if (landedPrize === undefined) {
    throw new Error(`Official Egg landing index ${state.centerIndex} is outside the committed reel`);
  }
  const decisionId = nextDecisionId(input.identity);
  return checkedContinuation({
    schemaVersion: 1,
    continuationId: spinning.continuationId,
    decisionId,
    kind: spinning.kind,
    origin: spinning.origin,
    remainingRepeats: spinning.remainingRepeats,
    phase: "awaiting-prize-resolution",
    providers: spinning.providers,
    reel: spinning.reel,
    previewMonsterShortTypes: spinning.previewMonsterShortTypes,
    finalReelState: state,
    landedPrize,
  }) as OfficialEggAwaitingPrizeResolution;
}

/** `egg.resolvePrize`: record the source resolution and return an unapplied settlement. */
export function resolveOfficialEggPrize(input: OfficialEggResolveInput): {
  readonly continuation: OfficialEggAwaitingRepeatOrFinish;
  readonly settlement: OfficialEggPrizeSettlement;
} {
  const current = requirePhase(
    input.continuation,
    "awaiting-prize-resolution",
    "egg.resolvePrize",
  );
  const resolution = validateResolution(input.resolution);
  const settlement = settlePrize(
    current.landedPrize,
    resolution,
    input.recipientResolver,
  );
  const decisionId = nextDecisionId(input.identity);
  const continuation = checkedContinuation({
    schemaVersion: 1,
    continuationId: current.continuationId,
    decisionId,
    kind: current.kind,
    origin: current.origin,
    remainingRepeats: current.remainingRepeats,
    phase: "awaiting-repeat-or-finish",
    settledPrize: current.landedPrize,
    resolution,
  }) as OfficialEggAwaitingRepeatOrFinish;
  return Object.freeze({ continuation, settlement });
}

/** `egg.repeat`: validate the read-only balance, then build a fresh committed reel. */
export function repeatOfficialEgg(input: OfficialEggRepeatInput): {
  readonly continuation: OfficialEggSpinning;
  readonly goldCost: 100 | 298;
} {
  const current = requirePhase(
    input.continuation,
    "awaiting-repeat-or-finish",
    "egg.repeat",
  );
  if (current.remainingRepeats !== 1) {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "this Egg has no repeat remaining");
  }
  const goldCost = eggRepeatCost(current.kind);
  if (!Number.isSafeInteger(input.goldBalance.gold) || input.goldBalance.gold < goldCost) {
    throw new GameServiceError("INSUFFICIENT_FUNDS", "cannot afford the Egg repeat");
  }

  const generated = generateSpin(input.game, input.player, current.kind, input.rng, input.rngRules);
  const decisionId = nextDecisionId(input.identity);
  const continuation = checkedContinuation({
    schemaVersion: 1,
    continuationId: current.continuationId,
    decisionId,
    kind: current.kind,
    origin: current.origin,
    remainingRepeats: 0,
    phase: "spinning",
    providers: generated.providers,
    reel: generated.reel,
    previewMonsterShortTypes: generated.previewMonsterShortTypes,
  }) as OfficialEggSpinning;
  return Object.freeze({ continuation, goldCost });
}

/** `egg.finish`: only an already-settled continuation may be cleared by the aggregate. */
export function finishOfficialEgg(continuation: OfficialEggContinuation): undefined {
  requirePhase(continuation, "awaiting-repeat-or-finish", "egg.finish");
  return undefined;
}

/** Replay a committed landing from persisted reel/final-state data without consuming RNG. */
export function replayOfficialEggLanding(
  continuation: OfficialEggContinuation,
): OfficialEggPrize {
  const current = requirePhase(
    continuation,
    "awaiting-prize-resolution",
    "egg.replayLanding",
  );
  if (!current.finalReelState.stopped) {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "Egg landing is not yet committed");
  }
  const replayed = current.reel[current.finalReelState.centerIndex];
  if (replayed === undefined) {
    throw new Error(
      `Official Egg landing index ${current.finalReelState.centerIndex} is outside the committed reel`,
    );
  }
  if (JSON.stringify(replayed) !== JSON.stringify(current.landedPrize)) {
    throw new Error("Official Egg committed landing disagrees with its reel state");
  }
  return replayed;
}

function generateSpin(
  game: GameData,
  player: EggHatchPlayerView,
  kind: EggHatchKind,
  rng: Rng,
  rngRules: EggRngRules = "source",
): {
  readonly providers: OfficialEggPrizeV1[];
  readonly reel: OfficialEggPrizeV1[];
  readonly previewMonsterShortTypes: string[];
} {
  const pool = generateEggHatchPool(game, player, kind, rng, undefined, rngRules);
  assertPool(pool.providers, pool.reel, SOURCE_EGG_POOL_MAX_ENTRIES, "source");
  // SlotMachineNode scans the original provider array after the reel shuffle has consumed its
  // draws. Reusing the shuffled reel here preserves draw count but changes candidate identity for
  // the same preview-index draws, so Official and local play must both retain provider order.
  const previewMonsterShortTypes = selectEggPreviewMonsters(game, pool.providers, rng);
  if (previewMonsterShortTypes.length > 2) {
    throw new Error("Official Egg preview exceeds the protocol's two-monster bound");
  }
  // Keep the native Casino selection draw in the source stream without retaining media data.
  if (rngRules === "source") rng.intBelow(1);
  const providers = pool.providers.map(toOfficialPrize);
  const reel = pool.reel.map(toOfficialPrize);
  return Object.freeze({
    providers: frozenArray(providers),
    reel: frozenArray(reel),
    previewMonsterShortTypes: frozenArray(previewMonsterShortTypes),
  });
}

function assertPool(
  providers: readonly EggHatchPrize[],
  reel: readonly EggHatchPrize[],
  maximum: number = OFFICIAL_EGG_POOL_MAX_ENTRIES,
  boundName = "protocol compatibility",
): void {
  if (
    providers.length < 1 ||
    providers.length > maximum ||
    reel.length < 1 ||
    reel.length > maximum
  ) {
    throw new Error(
      `Official Egg pool exceeds the ${boundName} bound of ${maximum}`,
    );
  }
  if (providers.length !== reel.length) {
    throw new Error("Official Egg providers and reel must have identical lengths");
  }
}

function settlePrize(
  prize: OfficialEggPrize,
  resolution: OfficialEggPrizeResolution,
  recipientResolver: OfficialEggFeedRecipientResolver | undefined,
): OfficialEggPrizeSettlement {
  if (resolution.kind === "keep") {
    return Object.freeze({
      kind: "keep",
      prize,
      reward: prizeToKeepReward(prize),
    });
  }
  if (prize.kind !== "monster") {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "only a monster Egg prize can be fed");
  }
  const recipient = recipientResolver?.resolveRecipient(resolution.recipientInstanceId);
  if (recipient === undefined) {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "feed recipient is missing or ineligible");
  }
  const recipientLevel = recipient.level;
  if (!Number.isSafeInteger(recipientLevel) || recipientLevel < 1 || recipientLevel > 150) {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "feed recipient is missing or ineligible");
  }
  if (recipientLevel === 150) {
    return Object.freeze({
      kind: "discard",
      prize,
      recipientInstanceId: resolution.recipientInstanceId,
      recipientLevel: 150,
      reason: "recipient-full",
    });
  }
  return Object.freeze({
    kind: "feed",
    prize,
    recipientInstanceId: resolution.recipientInstanceId,
    recipientLevel,
  });
}

function prizeToKeepReward(prize: OfficialEggPrize): OfficialEggKeepReward {
  if (prize.kind === "monster") {
    return Object.freeze({
      kind: "monsterJoin",
      shortType: prize.shortType,
      jobLevel: prize.level,
    });
  }
  return prize;
}

function toOfficialPrize(prize: EggHatchPrize): OfficialEggPrizeV1 {
  if (prize.kind === "gem") return { ...prize, enabledStats: [...prize.enabledStats] };
  return { ...prize };
}

function validateResolution(value: OfficialEggPrizeResolution): OfficialEggPrizeResolution {
  if (value === null || typeof value !== "object") {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "Egg prize resolution is invalid");
  }
  if (value.kind === "keep") return Object.freeze({ kind: "keep" });
  if (
    value.kind === "feed" &&
    typeof value.recipientInstanceId === "string" &&
    value.recipientInstanceId.length > 0
  ) {
    return Object.freeze({ kind: "feed", recipientInstanceId: value.recipientInstanceId });
  }
  throw new GameServiceError("ACTION_NOT_ALLOWED", "Egg prize resolution is invalid");
}

function requirePhase<Phase extends OfficialEggContinuation["phase"]>(
  continuation: OfficialEggContinuation,
  phase: Phase,
  action: string,
): Extract<OfficialEggContinuation, { readonly phase: Phase }> {
  const parsed = parseContinuation(continuation);
  if (parsed.phase !== phase) {
    throw new GameServiceError("ACTION_NOT_ALLOWED", `${action} is not allowed during ${continuation.phase}`);
  }
  return parsed as Extract<OfficialEggContinuation, { readonly phase: Phase }>;
}

function nextDecisionId(input: OfficialEggDecisionAllocator): string {
  const decisionId = input.nextDecisionId();
  return requireId(decisionId, "decisionId");
}

function requireId(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) {
    throw new Error(`Official Egg ${label} must be a nonempty bounded server ID`);
  }
  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new Error(`Official Egg ${label} contains unsupported characters`);
  }
  return value;
}

function checkedContinuation(value: OfficialEggContinuation): OfficialEggContinuation {
  const parsed = OfficialEggContinuationV1Schema.parse(value) as OfficialEggContinuation;
  return Object.freeze(parsed);
}

function parseContinuation(value: OfficialEggContinuation): OfficialEggContinuation {
  try {
    return OfficialEggContinuationV1Schema.parse(value) as OfficialEggContinuation;
  } catch {
    throw new GameServiceError("ACTION_NOT_ALLOWED", "invalid Egg continuation");
  }
}

function frozenArray<T>(values: readonly T[]): T[] {
  return Object.freeze([...values]) as unknown as T[];
}
