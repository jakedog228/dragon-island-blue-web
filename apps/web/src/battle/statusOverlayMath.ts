











import type { StatusEffect } from "@dib/engine";
import type { DisplayMode } from "../displayMode.js";

export interface Point {
  x: number;
  y: number;
}












export function applyStatusCountDelta(
  current: number,
  delta: 1 | -1,
): { count: number; transition: "show" | "hide" | "none" } {
  if (delta === 1) {
    return { count: current + 1, transition: current === 0 ? "show" : "none" };
  }
  const count = Math.max(0, current - 1);
  return { count, transition: current === 1 ? "hide" : "none" };
}
















export const STATUS_SPAWN_INTERVAL_S = 0.8;

export const STATUS_DRIFT_SCALE_DURATION_S = 2.4;

export const STATUS_FADE_DELAY_S = 1.2;


export const STATUS_FADE_DURATION_S = 1.2;

export const STATUS_SPAWN_TARGET_SCALE = 0.4;

export function statusSpawnIntervalMs(): number {
  return STATUS_SPAWN_INTERVAL_S * 1000;
}
export function statusDriftScaleDurationMs(): number {
  return STATUS_DRIFT_SCALE_DURATION_S * 1000;
}
export function statusFadeDelayMs(): number {
  return STATUS_FADE_DELAY_S * 1000;
}
export function statusFadeDurationMs(): number {
  return STATUS_FADE_DURATION_S * 1000;
}

/** Device-idiom base pair for the drift vector — iPhone `(20,40)` / iPad `(40,80)`
 *  (status-effects-exact-sleep.md §5, both raw-decoded). The iPad pair is EXACTLY doubled, so in
 *  this port's uniform CSF-2 normalized point space it lands back on the iPhone values on both
 *  idioms (displayMode.ts header model) — one constant serves both modes, no `idiomPairPt` fold
 *  needed at the call site. */
export const STATUS_DRIFT_BASE: Point = { x: 20, y: 40 };

/**
 * The exact random drift (status-effects-exact-sleep.md §5, register-traced — this replaced the
 * prior "per-axis signed [-1,1] x 0.4" guess, which was wrong on every count):
 *
 *   RND = arc4random() * 2^-32                 // ONE draw per spawn, consumed by X only
 *   drift.x = Xbase * (0.8 + 0.4*RND)          // always positive (rightward), [16, 24)pt iPhone
 *   drift.y = Ybase                             // EXACT — no randomization, always up (40pt)
 *
 * i.e. every "Z"/swirl floats straight up by a fixed amount while wobbling only in how far RIGHT
 * it lands. Returned in Pixi-local Y-DOWN units (y negated from the Cocos Y-up `CCMoveBy` arg).
 * `rand` is caller-supplied. Local battle presentation receives the battle's process-equivalent
 * source stream; standalone/Official presentation uses `Math.random` so it cannot consume an
 * authority-owned mechanic tape.
 */
export function statusDriftOffset(rand: () => number): Point {
  return {
    x: STATUS_DRIFT_BASE.x * (0.8 + 0.4 * rand()),
    y: -STATUS_DRIFT_BASE.y,
  };
}







export const STATUS_ANCHOR_FRACTION_TOP: Point = { x: 0.5, y: 0.9 };


export const STATUS_ANCHOR_FRACTION_POISON: Point = { x: 0.5, y: 0.6 };

export function statusAnchorFraction(kind: StatusEffect): Point {
  return kind === "Poison" ? STATUS_ANCHOR_FRACTION_POISON : STATUS_ANCHOR_FRACTION_TOP;
}

/**
 * Cocos child-positioning rule: a Cocos node's LOCAL space for its children always originates at
 * its own untransformed content rect's BOTTOM-LEFT corner, regardless of `anchorPoint` — the
 * anchor only shifts where that whole rect sits in the PARENT's frame (Cocos folds
 * `-anchorPointInPixels` into the same local transform both the node's own draw and its children
 * inherit). Pixi's `Sprite`/`Container` anchor instead leaves local `(0,0)` at the node's own
 * `position` (the transform origin) and shifts only the sprite's OWN drawn quad — children are
 * NOT additionally shifted the way Cocos shifts them. This converts a Cocos content-rect fraction
 * into the Pixi-LOCAL child offset that reproduces the same on-screen placement when the child is
 * positioned relative to an anchored node of the given (width,height,anchor) — Y is negated
 * because the Cocos content rect is Y-UP from the bottom edge while this port's local frames are
 * Y-DOWN from the anchor point (the #1 coordinate-frame convention in this battle UI).
 */
export function cocosContentFractionToPixiLocalOffset(
  width: number,
  height: number,
  anchor: Point,
  fraction: Point,
): Point {
  return {
    x: (fraction.x - anchor.x) * width,
    y: -(fraction.y - anchor.y) * height,
  };
}

// --- ParalyzeEffect — 3 static bolts, permanent shake, no spawn/despawn cycle ---
// (status-effects-exact-paralyze.md — this replaced the prior "symmetric fan" guess entirely.)

export interface ParalyzeBoltSpec {
  /** Pixi-local position within the holder, in points (Y negated from the Cocos Y-up original). */
  position: Point;
  /** Degrees, clockwise-positive (Cocos `setRotation:` and Pixi screen rotation agree). */
  rotationDeg: number;
}











export function paralyzeBoltLayout(boltW: number, boltH: number): readonly ParalyzeBoltSpec[] {
  return [
    { position: { x: -boltW, y: 0 }, rotationDeg: -65.0 },
    { position: { x: 0, y: -boltH * 0.5 }, rotationDeg: 0 },
    { position: { x: boltW, y: 0 }, rotationDeg: 45.0 },
  ];
}








export const PARALYZE_SHAKE_MS = 500;
/** Cocos offset pair (x right, y UP — negate y when applying in Pixi space). */
export const PARALYZE_SHAKE_OFFSET: Point = { x: 2.0, y: 4.0 };











export function poisonSpawnIntervalMs(maxParticles: number, particleLifespanS: number): number {
  if (!(maxParticles > 0) || !(particleLifespanS > 0)) {
    throw new Error(
      `PoisonParticles: invalid maxParticles/particleLifespan (${maxParticles}/${particleLifespanS})`,
    );
  }
  return (particleLifespanS / maxParticles) * 1000;
}






export function advancePoisonEmission(
  counterSeconds: number,
  dtSeconds: number,
  emissionRate: number,
  availableSlots: number,
): Readonly<{ counterSeconds: number; spawnCount: number }> {
  if (!(emissionRate > 0) || availableSlots <= 0) {
    return Object.freeze({ counterSeconds, spawnCount: 0 });
  }
  const interval = 1 / emissionRate;
  let counter = counterSeconds + dtSeconds;
  let spawnCount = 0;
  while (counter > interval && spawnCount < availableSlots) {
    counter -= interval;
    spawnCount += 1;
  }
  return Object.freeze({ counterSeconds: counter, spawnCount });
}







export function poisonParticleLifeS(
  baseS: number,
  varianceS: number,
  rand: () => number,
): number {
  return Math.max(0, baseS + varianceS * (rand() * 2 - 1));
}











export function poisonSpatialIdiomScale(mode: DisplayMode): number {
  return mode === "ipad" ? 0.5 : 1;
}







export const IMAGE_EFFECT_DEFAULT_LENGTH_S = 1.0;
export const IMAGE_EFFECT_FADE_MS = 250;

export function imageEffectHoldMs(length: number | undefined): number {
  return (length ?? IMAGE_EFFECT_DEFAULT_LENGTH_S) * 1000;
}

// --- status-effects.md §7 item 2: buffAdded friendly/enemy phase-dict selection ---

/** `abilityRenderer.ts`'s existing `phaseDictFor` picks `enemyTargetEventData` for `damageDealt`
 *  and `friendlyTargetEventData` for `healed` purely by EVENT TYPE, because damage always targets
 *  an enemy and heals always target a friendly in the real corpus. A `buffAdded` event carries no
 *  such implicit team information (a buff can land on either team — a self-buff, an ally heal-
 *  adjacent buff, or a debuff on an enemy), so this selection instead needs the actual team
 *  relationship between the acting ability's source and the buffed target — resolved by the
 *  caller (battleNode.ts's `nodeLookup.sameTeam`) and passed in here as a plain boolean. */
export function buffTargetPhaseKey(sameTeam: boolean): "friendlyTargetEventData" | "enemyTargetEventData" {
  return sameTeam ? "friendlyTargetEventData" : "enemyTargetEventData";
}
