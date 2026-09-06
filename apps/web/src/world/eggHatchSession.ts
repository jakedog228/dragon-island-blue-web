import {
  EggReel,
  eggShuffle,
  eggRepeatCost,
  generateEggHatchPool,
  selectEggPreviewMonsters,
  type EggHatchKind,
  type EggHatchPlayerView,
  type EggHatchPool,
  type EggHatchPrize,
  type EggReelState,
  type Rng,
} from "@dib/engine";
import type { GameData } from "@dib/gamedata";
import type {
  GameCommandV1,
  OfficialEggContinuationV1,
  PresentationEventV1,
} from "@dib/game-protocol";

/** The pool and previews one spin renders. Identical in shape whoever generated them. */
export interface EggHatchSpin {
  readonly pool: EggHatchPool;
  readonly previewMonsterShortTypes: readonly string[];
}

/**
 * The landing, decided only after the player's release point was committed.
 *
 * `friction` is the single random value in a spin. A local session draws it the instant the reel is
 * released; an official session receives it from the server, which drew it *after* accepting the
 * held-frame count. Either way the browser reproduces the coast from it rather than inventing one.
 */
export interface EggReleaseCommitment {
  readonly friction: number;
  readonly finalReelState: EggReelState;
}

export type EggPrizeResolution =
  | { readonly kind: "keep" }
  | { readonly kind: "feed"; readonly recipientInstanceId: string };

/**
 * What the renderer's retained player aggregate has to copy from a committed settlement.
 *
 * Online the authority is the one that mints party identities (`nextMonsterSequence`), so a kept
 * monster carries its committed id back here; the mirror must adopt that id rather than allocate a
 * competing one. A local session mints nothing and leaves the field absent.
 */
export interface EggSettlementMirror {
  readonly joinedInstanceId?: string;
}

export type EggRepeatOutcome =
  | { readonly kind: "spun"; readonly spin: EggHatchSpin }
  | { readonly kind: "unaffordable" };

/**
 * Where the flow picks the Egg up.
 *
 * Only `spin` renders a reel. `-[SlotMachineNode update:]` removes the node from its parent the
 * moment the reel stops, so a continuation resumed at or past its landing has no slot machine on
 * screen in the source either — the popups alone are the whole presentation.
 */
export type EggHatchEntry =
  | { readonly phase: "spin" }
  | {
      readonly phase: "prize";
      readonly landedPrize: EggHatchPrize;
    }
  | {
      readonly phase: "repeat";
      readonly settledPrize: EggHatchPrize;
      readonly resolution: EggPrizeResolution;
    };

/**
 * Everything an Egg hatch mutates, behind one seam.
 *
 * The renderer never decides a prize, a landing, or a repeat's affordability; it asks the session,
 * which either owns a local RNG stream (demo/offline play) or drives the authoritative v12 Egg
 * continuation over the wire. Presentation is identical in both.
 */
export interface EggHatchSession {
  /** Where this session's continuation already stands when the flow opens. */
  readonly entry: EggHatchEntry;
  /**
   * True when a kept prize may be applied as the repeat question presents, which is the source's
   * own order (`Egg` appends after the popup is on screen). An authoritative session cannot: the
   * server admits neither `egg.repeat` nor `egg.finish` until `egg.resolvePrize` is accepted, so
   * the flow settles first and mirrors the committed result before presenting.
   */
  readonly settlesAtPresentation: boolean;
  /** `Egg.allowSecondSpin` for a local session; the continuation's remaining repeat online. */
  canRepeat(): boolean;
  /** Cost shown on the repeat button. */
  repeatCost(): number;
  begin(): Promise<EggHatchSpin>;
  /** `heldFrames` is how many native 1/60-second reel updates ran before the release. */
  release(heldFrames: number): Promise<EggReleaseCommitment>;
  resolve(resolution: EggPrizeResolution): Promise<EggSettlementMirror>;
  repeat(): Promise<EggRepeatOutcome>;
  finish(): Promise<void>;
}

export interface LocalEggHatchSessionOptions {
  readonly game: GameData;
  readonly kind: EggHatchKind;
  readonly rng: Rng;
  readonly foundationDictionaryOrder?: "lexicographic";

  readonly playerView: () => EggHatchPlayerView;
  readonly spendGold: (cost: number) => boolean;
  readonly allowSecondSpin: boolean;
  /** Clone Egg's transient `eggPicks`: these are the complete providers, once each, in pick order. */
  readonly scriptedProviders?: readonly EggHatchPrize[];
}

/**
 * Demo/offline hatching. Draw order is `generateEggHatchPool` → `selectEggPreviewMonsters` →
 * friction, exactly as `-[Egg slotProviders]` then `SlotMachineNode` consume the stream.
 */
export function createLocalEggHatchSession(
  options: LocalEggHatchSessionOptions,
): EggHatchSession {
  let reelLength = 0;
  const spin = (): EggHatchSpin => {
    const pool = options.scriptedProviders === undefined
      ? generateEggHatchPool(
          options.game,
          options.playerView(),
          options.kind,
          options.rng,
          options.foundationDictionaryOrder,
        )
      : Object.freeze({
          kind: options.kind,
          providers: Object.freeze([...options.scriptedProviders]),
          reel: eggShuffle(options.scriptedProviders, options.rng),
        });
    // `SlotMachineNode` scans the original providers after reel shuffle has consumed its draws.
    // The Official continuation uses this same ordering so both modes preserve preview identity.
    const previewMonsterShortTypes = selectEggPreviewMonsters(
      options.game,
      pool.providers,
      options.rng,
    );
    // SlotMachineNode.onEnter -> sub_9174e draws even for the single Casino track.
    options.rng.intBelow(1);
    reelLength = pool.reel.length;
    return Object.freeze({ pool, previewMonsterShortTypes });
  };
  return {
    entry: Object.freeze({ phase: "spin" }),
    settlesAtPresentation: true,
    canRepeat: () => options.allowSecondSpin,
    repeatCost: () => eggRepeatCost(options.kind),
    begin: async () => spin(),
    release: async (heldFrames) => {
      // The same replay the server runs, against the same stream this pool came from.
      const reel = new EggReel(reelLength, options.rng);
      let state = reel.advanceFrames(heldFrames);
      if (!reel.release()) {
        throw new Error("local Egg release was refused by the native 1.5s gate");
      }
      while (!state.stopped) state = reel.advanceFrame();
      return Object.freeze({ friction: state.friction, finalReelState: state });
    },
    resolve: async () => Object.freeze({}),
    repeat: async () => {
      if (!options.spendGold(eggRepeatCost(options.kind))) {
        return Object.freeze({ kind: "unaffordable" });
      }
      return Object.freeze({ kind: "spun", spin: spin() });
    },
    finish: async () => undefined,
  };
}

export type EggCommandV1 = Extract<GameCommandV1, { type: `egg.${string}` }>;

export interface OfficialEggHatchAuthority {
  /**
   * Submits one Egg continuation command and adopts the resulting projection before resolving,
   * returning the events it committed so the caller can mirror them into retained renderer state.
   */
  submitEgg(command: EggCommandV1): Promise<readonly PresentationEventV1[]>;
  /** The adopted projection's pending Egg continuation. */
  pendingEgg(): OfficialEggContinuationV1 | undefined;
  /**
   * Mirrors the gold the authority already spent on a repeat. Returning false means the retained
   * aggregate disagrees with the balance the server just debited, which is a synchronization bug
   * rather than an affordability refusal — the authority had already accepted the command.
   */
  spendRepeatGold(cost: number): boolean;
}

/**
 * Authoritative online hatching.
 *
 * The pool, the landing, the settlement, and the repeat's affordability are all the server's. The
 * only thing this session sends upward is the player's release point, and it sends it before the
 * server draws the friction that decides where the reel stops.
 */
export function createOfficialEggHatchSession(
  authority: OfficialEggHatchAuthority,
): EggHatchSession {
  const current = (): OfficialEggContinuationV1 => {
    const pending = authority.pendingEgg();
    if (pending === undefined) {
      throw new Error("official Egg session has no pending continuation");
    }
    return pending;
  };
  const requirePhase = <Phase extends OfficialEggContinuationV1["phase"]>(
    phase: Phase,
  ): Extract<OfficialEggContinuationV1, { readonly phase: Phase }> => {
    const pending = current();
    if (pending.phase !== phase) {
      throw new Error(`official Egg continuation is ${pending.phase}, expected ${phase}`);
    }
    return pending as Extract<OfficialEggContinuationV1, { readonly phase: Phase }>;
  };
  const spinOf = (
    continuation: Extract<OfficialEggContinuationV1, { readonly phase: "spinning" }>,
  ): EggHatchSpin => Object.freeze({
    pool: Object.freeze({
      kind: continuation.kind,
      providers: Object.freeze([...continuation.providers]) as readonly EggHatchPrize[],
      reel: Object.freeze([...continuation.reel]) as readonly EggHatchPrize[],
    }),
    previewMonsterShortTypes: Object.freeze([...continuation.previewMonsterShortTypes]),
  });

  const opened = current();
  const entry: EggHatchEntry = opened.phase === "awaiting-prize-resolution"
    ? Object.freeze({ phase: "prize", landedPrize: opened.landedPrize })
    : opened.phase === "awaiting-repeat-or-finish"
      ? Object.freeze({
          phase: "repeat",
          settledPrize: opened.settledPrize,
          resolution: opened.resolution,
        })
      : Object.freeze({ phase: "spin" });

  return {
    entry,
    settlesAtPresentation: false,
    canRepeat: () => authority.pendingEgg()?.remainingRepeats === 1,
    repeatCost: () => eggRepeatCost(current().kind),
    begin: async () => {
      if (current().phase === "awaiting-spin") {
        await authority.submitEgg({ type: "egg.start" });
      }
      return spinOf(requirePhase("spinning"));
    },
    release: async (heldFrames) => {
      await authority.submitEgg({ type: "egg.release", heldFrames });
      const resolved = requirePhase("awaiting-prize-resolution");
      return Object.freeze({
        friction: resolved.finalReelState.friction,
        finalReelState: Object.freeze({ ...resolved.finalReelState }),
      });
    },
    resolve: async (resolution) => {
      const events = await authority.submitEgg({ type: "egg.resolvePrize", resolution });
      const joined = events.find(
        (event) => event.type === "player.monsterAdded" && event.reason === "hatch",
      );
      return Object.freeze(
        joined === undefined || joined.type !== "player.monsterAdded"
          ? {}
          : { joinedInstanceId: joined.instanceId },
      );
    },
    repeat: async () => {
      const cost = eggRepeatCost(current().kind);
      try {
        await authority.submitEgg({ type: "egg.repeat" });
      } catch (error) {
        // The balance check is the server's; an affordability refusal is the native CannotAfford
        // popup, not a failed command. Anything else is a real transport/state failure.
        if (isInsufficientFunds(error)) return Object.freeze({ kind: "unaffordable" });
        throw error;
      }
      if (!authority.spendRepeatGold(cost)) {
        throw new Error("retained gold disagrees with the Egg repeat the authority committed");
      }
      return Object.freeze({ kind: "spun", spin: spinOf(requirePhase("spinning")) });
    },
    finish: async () => {
      await authority.submitEgg({ type: "egg.finish" });
    },
  };
}

function isInsufficientFunds(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const code = (error as { readonly code?: unknown }).code;
  if (code === "INSUFFICIENT_FUNDS") return true;
  const cause = (error as { readonly cause?: unknown }).cause;
  return cause !== undefined && cause !== error && isInsufficientFunds(cause);
}
