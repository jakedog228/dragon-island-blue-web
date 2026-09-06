import {
  touchHleArc4Random,
  type Rng,
  type TouchHleArc4RandomRng,
} from "@dib/engine";

interface FidelityLabConfig {
  readonly foundationDictionaryOrder?: "lexicographic";
  readonly rng?: {
    readonly kind: "touchhle-xorshift32";
    readonly initialState?: number;
    readonly skip?: number;
  };
}

export interface FidelityLabRuntime {
  readonly foundationDictionaryOrder?: "lexicographic";





  readonly rng: TouchHleArc4RandomRng;
  /** Adopt a transactionally forked local stream after the gameplay owner accepts it. */
  adopt(rng: Rng): void;







  anchor(rawState: number, nativeCalls?: number): Readonly<{
    priorRawState: number;
    priorCursor: number;
    nativeRawState: number;
    nativeCalls?: number;
    correction?: number;
  }>;
  snapshot(): Readonly<Record<string, unknown>>;
}

/**
 * Installs no global hooks and is unreachable unless the local debug controller supplied a valid
 * pre-boot configuration. This keeps comparison-only RNG state out of deployed gameplay.
 */
export function createFidelityLabRuntime(): FidelityLabRuntime | undefined {
  const value = (globalThis as Record<string, unknown>)["__DIB_FIDELITY_LAB__"];
  if (value === undefined) return undefined;
  if (!import.meta.env.DEV) throw new Error("The Fidelity Lab runtime is development-only");
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("__DIB_FIDELITY_LAB__ must be an object");
  }
  const config = value as FidelityLabConfig;
  if (config.rng?.kind !== "touchhle-xorshift32") {
    throw new Error("Fidelity Lab requires rng.kind=touchhle-xorshift32");
  }
  if (
    config.foundationDictionaryOrder !== undefined &&
    config.foundationDictionaryOrder !== "lexicographic"
  ) {
    throw new Error("Fidelity Lab foundationDictionaryOrder must be lexicographic");
  }
  const initialState = config.rng.initialState ?? 0;
  const skip = config.rng.skip ?? 0;
  let activeRng = touchHleArc4Random(initialState, skip);
  // Draws made before the most recent anchor. Reporting them keeps `cursor` a running total across
  // anchors, which is what the dashboard compares against the emulator's own call count.
  let cursorOffset = 0;
  let anchors = 0;
  let anchoredState: number | undefined;
  const rng: TouchHleArc4RandomRng = Object.freeze({
    get rawState() { return activeRng.rawState; },
    get cursor() { return cursorOffset + activeRng.cursor; },
    fork: () => activeRng.fork(),
    next: () => activeRng.next(),
    intBelow: (n: number) => activeRng.intBelow(n),
    chance: (p: number) => activeRng.chance(p),
  });
  return Object.freeze({
    ...(config.foundationDictionaryOrder === undefined
      ? {}
      : { foundationDictionaryOrder: config.foundationDictionaryOrder }),
    rng,
    adopt: (adopted: Rng) => {
      if (!("rawState" in adopted) || !("cursor" in adopted)) {
        throw new Error("Fidelity Lab can only adopt a TouchHLE arc4random fork");
      }
      // A fork continues the active stream, so its own cursor already counts from the same origin;
      // the offset established by the last anchor still applies unchanged.
      activeRng = adopted as TouchHleArc4RandomRng;
    },
    anchor: (rawState: number, nativeCalls?: number) => {
      if (!Number.isSafeInteger(rawState) || rawState < 0 || rawState > 0xffffffff) {
        throw new Error(`Fidelity Lab anchor state must be uint32, got ${rawState}`);
      }
      if (
        nativeCalls !== undefined &&
        (!Number.isSafeInteger(nativeCalls) || nativeCalls < 0)
      ) {
        throw new Error(`Fidelity Lab anchor draw count must be a nonnegative integer, got ${nativeCalls}`);
      }
      // Read the running total before the swap: `rng.cursor` is derived from the stream about to
      // be replaced.
      const priorCursor = rng.cursor;
      const priorRawState = rng.rawState;
      activeRng = touchHleArc4Random(rawState, 0);
      cursorOffset = nativeCalls ?? priorCursor;
      anchors++;
      anchoredState = rawState;
      return Object.freeze({
        priorRawState,
        priorCursor,
        nativeRawState: rawState,
        ...(nativeCalls === undefined ? {} : {
          nativeCalls,
          correction: priorCursor - nativeCalls,
        }),
      });
    },
    snapshot: () => Object.freeze({
      active: true,
      ...(config.foundationDictionaryOrder === undefined
        ? {}
        : { foundationDictionaryOrder: config.foundationDictionaryOrder }),
      rng: Object.freeze({
        kind: "touchhle-xorshift32",
        initialState,
        initialSkip: skip,
        cursor: rng.cursor,
        rawState: rng.rawState,
        anchors,
        ...(anchoredState === undefined ? {} : { anchoredState }),
      }),
    }),
  });
}
