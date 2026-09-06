export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, n). */
  intBelow(n: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
}

/** A deterministic RNG whose exact draw state can be detached for a transaction. */
export interface ForkableRng extends Rng {
  fork(): ForkableRng;
}

/** Diagnostic surface for the exact PRNG used by the maintained TouchHLE build. */
export interface TouchHleArc4RandomRng extends ForkableRng {
  /** Raw xorshift32 state after the most recent draw (zero before the first draw). */
  readonly rawState: number;
  /** Number of raw `arc4random()` values consumed by this stream. */
  readonly cursor: number;
}

export interface ReplayableRng extends Rng {
  /** Complete JSON-safe draw tape, including draws appended by the trusted source. */
  readonly draws: readonly number[];
  /** Number of draws consumed by the simulation instance. */
  readonly cursor: number;
  /**
   * Extends a presentation-only tape after an authoritative response commits more draws.
   * Existing entries must be supplied as a strict suffix; historical draws are immutable.
   */
  appendCommittedDraws(draws: readonly number[]): void;
}

/**
 * Exact draw-tape RNG used at the authority/presentation boundary.
 *
 * A restoring server supplies its private random source and extends the tape only after every
 * committed historical draw has been consumed. A browser supplies no source: it can reproduce
 * committed mechanics, but attempting to predict one draw beyond the committed tape fails loudly.
 */
export function replayableRng(
  committedDraws: readonly number[],
  randomSource?: () => number,
): ReplayableRng {
  const draws = committedDraws.map((draw, index) => requireUnitDraw(draw, `draws[${index}]`));
  let cursor = 0;
  const next = (): number => {
    const committed = draws[cursor];
    if (committed !== undefined) {
      cursor += 1;
      return committed;
    }
    if (randomSource === undefined) {
      throw new Error(`ReplayableRng: committed draw tape exhausted at cursor ${cursor}`);
    }
    const generated = requireUnitDraw(randomSource(), `randomSource draw ${cursor}`);
    draws.push(generated);
    cursor += 1;
    return generated;
  };
  return {
    get draws() {
      return Object.freeze([...draws]);
    },
    get cursor() {
      return cursor;
    },
    appendCommittedDraws: (committedSuffix) => {
      for (const [index, draw] of committedSuffix.entries()) {
        draws.push(requireUnitDraw(draw, `committed suffix[${index}]`));
      }
    },
    next,
    intBelow: (n) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`intBelow(${n})`);
      return Math.floor(next() * n);
    },
    chance: (p) => next() < p,
  };
}

/** Deterministic seeded PRNG. Distribution fidelity only — the original
 *  binary uses arc4random; we match probabilities, not its stream. */
export function mulberry32(seed: number): ForkableRng {
  return createMulberry32(seed >>> 0);
}

/**
 * Exact host-side counterpart of touchHLE's `arc4random` compatibility implementation.
 *
 * This is a fidelity-lab adapter, not the production game's random source. It deliberately keeps
 * both native consumption channels: float callers observe `raw / 2^32`, while integer callers
 * observe `raw % n`. Replacing the latter with `floor(next()*n)` changes deterministic outcomes.
 */
export function touchHleArc4Random(
  initialState = 0,
  skip = 0,
): TouchHleArc4RandomRng {
  if (!Number.isSafeInteger(initialState) || initialState < 0 || initialState > 0xffffffff) {
    throw new Error(`touchHleArc4Random initialState must be uint32, got ${initialState}`);
  }
  if (!Number.isSafeInteger(skip) || skip < 0) {
    throw new Error(`touchHleArc4Random skip must be a nonnegative integer, got ${skip}`);
  }
  const rng = createTouchHleArc4Random(initialState >>> 0, 0);
  for (let index = 0; index < skip; index++) rng.next();
  return rng;
}

function createTouchHleArc4Random(initialState: number, initialCursor: number): TouchHleArc4RandomRng {
  let state = initialState >>> 0;
  let cursor = initialCursor;
  const raw = (): number => {
    // Mirrors `prng` in the maintained TouchHLE source snapshot. State zero is promoted to one.
    state = Math.max(state, 1) >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    cursor++;
    return state;
  };
  return {
    get rawState() { return state; },
    get cursor() { return cursor; },
    fork: () => createTouchHleArc4Random(state, cursor),
    next: () => raw() / 4294967296,
    intBelow: (n) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`intBelow(${n})`);
      return raw() % n;
    },
    chance: (p) => raw() / 4294967296 < p,
  };
}

function createMulberry32(initialState: number): ForkableRng {
  let a = initialState >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    fork: () => createMulberry32(a),
    next,
    intBelow: (n) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`intBelow(${n})`);
      return Math.floor(next() * n);
    },
    chance: (p) => next() < p,
  };
}

function requireUnitDraw(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`ReplayableRng: ${label} must be in [0,1); got ${value}`);
  }
  return value;
}
