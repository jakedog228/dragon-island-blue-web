


import type { AbilityEffectText } from "@dib/engine";
import { idiomPairPt, type DisplayMode } from "../displayMode.js";

export interface Point {
  x: number;
  y: number;
}

/** The target Living display's authored content rectangle after conversion into the effect
 *  layer's local coordinates (`convertToWorldSpace:CGPointZero` + `contentSize` in the source). */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}


export const CAPTURE_INITIAL_FLIGHT_MS = 750;
export const CAPTURE_SHAKE_MS = 800;
export const CAPTURE_FAILURE_ACTION_MS = 750;
export const CAPTURE_FAILURE_MOVE_MS = 500;
export const CAPTURE_SUCCESS_REVEAL_MS = 500;
export const CAPTURE_SUCCESS_LINGER_MS = 1000;
export const CAPTURE_FAIL_SOUND_AT_MS =
  CAPTURE_INITIAL_FLIGHT_MS + CAPTURE_SHAKE_MS + CAPTURE_FAILURE_ACTION_MS;


export function captureCardStarRowPosition(
  frameWidth: number,
  frameHeight: number,
  rowWidth: number,
  rowHeight: number,
): Point {
  return {
    x: Math.round((frameWidth - rowWidth) / 2),
    y: frameHeight - 42 - rowHeight / 2,
  };
}

export function rectMid(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** Forms a display area solely from the two mapped authored-content corners. Keeping this pure
 * makes the source's origin+contentSize rule explicit and prevents accidental bounds reuse. */
export function rectFromCorners(topLeft: Point, bottomRight: Point): Rect {
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}


export function parseCocosPoint(s: string): Point {
  const m = /^\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}$/.exec(s.trim());
  if (!m) throw new Error(`malformed Cocos2d point string: "${s}"`);
  return { x: Number(m[1]), y: Number(m[2]) };
}

/** `CGRectFromString`-equivalent for a Cocos2d rect string `"{{x,y},{w,h}}"` — the format
 *  `MeleeAttacks.json`'s frameSlide `relativeStart`/`relativeEnd` use (fractions of the frame's
 *  own size, fed to `TextureRectSlideAction`'s relative params — effects-info.md §6 branch 3b).
 *  Fail-loud on malformed input, same convention as `parseCocosPoint`. */
export function parseCocosRect(s: string): { x: number; y: number; w: number; h: number } {
  const m = /^\{\s*\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}\s*,\s*\{\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\}\s*\}$/.exec(
    s.trim(),
  );
  if (!m) throw new Error(`malformed Cocos2d rect string: "${s}"`);
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}


export function effectPosition(displayArea: Rect, offset?: string): Point {
  const mid = rectMid(displayArea);
  if (offset === undefined) return mid;
  const o = parseCocosPoint(offset);
  return { x: mid.x + o.x, y: mid.y - o.y };
}

/** Confirmed literal `0x18` (§3 step 2). */
export const DEFAULT_FPS = 24;


export function frameDelaySeconds(fps: number | undefined): number {
  const f = fps !== undefined && fps > 0 ? fps : DEFAULT_FPS;
  return 1 / f;
}

export function frameDelayMs(fps: number | undefined): number {
  return frameDelaySeconds(fps) * 1000;
}

/** §3's "Net total on-screen duration" = `(numFrames - 2*startFrame)/fps` seconds; real data's
 *  `startFrame` is always `0` (doc-confirmed full-file scan) so this degenerates to
 *  `numFrames/fps` — computed here (not via `animations.ts`'s `animationDurationMs`) because that
 *  helper divides by the RAW `entry.fps` without this section's confirmed <=0/absent->24 default. */
export function effectAnimationLifetimeMs(numFrames: number, fps: number | undefined): number {
  return numFrames * frameDelayMs(fps);
}


export const DAMAGE_FLOATER_COLOR = 0xff0000;

export const HEAL_FLOATER_COLOR = 0x00ff00;


export const MESSAGE_DEFAULT_COLOR = 0xffffff;


export const MISS_FLOATER_COLOR = 0xff0000;


export const LABEL_BIRTH_COLOR = 0xffffff;


export const FRAME_SLIDE_MS = 250;
export const FRAME_SLIDE_FADE_MS = 200;


export const FLOATER_FONT_SIZE_PT = 16;
export const FLOATER_DISTANCE_PT = 30;
export const FLOATER_MS_PER_CHARACTER = 300;
export const FLOATER_FADE_MS = 500;


export const FLOATER_MIN_LIFETIME_MS = 2000;
export const FLOATER_MAX_LIFETIME_MS = 15000;

/** Source idiom pairs: font 16/24, motion 30/60, message offset 20/40, result-row step 20/30. */
export function floaterFontSizePt(mode: DisplayMode): number {
  return idiomPairPt(16, 24, mode);
}

export function floaterDistancePt(mode: DisplayMode): number {
  return idiomPairPt(30, 60, mode);
}

export function parameterMessageOffsetPt(mode: DisplayMode): number {
  return idiomPairPt(20, 40, mode);
}

export function parameterRowStepPt(mode: DisplayMode): number {
  return idiomPairPt(20, 30, mode);
}


export function parameterFloaterPosition(
  displayArea: Rect,
  row: number,
  kind: "numeric" | "message" | "blocked",
  mode: DisplayMode,
): Point {
  const center = effectPosition(displayArea);
  if (kind === "blocked") return center;
  return {
    x: center.x,
    y: center.y - row * parameterRowStepPt(mode) + (kind === "message" ? parameterMessageOffsetPt(mode) : 0),
  };
}

export interface EffectTextPresentation {
  text: string;
  color: number;
}


export function effectTextPresentation(
  effect: AbilityEffectText,
  localizedString: (key: string) => string,
): EffectTextPresentation {
  if (effect.kind === "miss") {
    return { text: localizedString("MissKey"), color: MISS_FLOATER_COLOR };
  }
  const direction = effect.direction === "up" ? "UP" : "DOWN";
  const color = effect.direction === "up" ? HEAL_FLOATER_COLOR : DAMAGE_FLOATER_COLOR;
  if (effect.kind === "haste") {
    return { text: `${localizedString("HasteKey")} ${direction}:${effect.amount}`, color };
  }
  return {
    text: `${localizedString(`Stat${effect.stat}InfoTitleKey`)} ${direction}:${effect.amount}`,
    color,
  };
}


export function floaterLifetimeMs(text: string): number {
  const raw = text.length * FLOATER_MS_PER_CHARACTER;
  return Math.min(FLOATER_MAX_LIFETIME_MS, Math.max(FLOATER_MIN_LIFETIME_MS, raw));
}

export function floaterAlphaAt(elapsedMs: number, lifetimeMs: number): number {
  const fadeStart = Math.max(0, lifetimeMs - FLOATER_FADE_MS);
  if (elapsedMs <= fadeStart) return 1;
  return Math.max(0, 1 - (elapsedMs - fadeStart) / FLOATER_FADE_MS);
}

/** CONFIRMED format string `"-%d"` (§6 branch 1) — damage numbers are always minus-prefixed. */
export function damageFloaterText(amount: number): string {
  return `-${amount}`;
}

/** CONFIRMED format string `"+%d"` (§6 branch 2) — heal numbers are always plus-prefixed. */
export function healFloaterText(amount: number): string {
  return `+${amount}`;
}


export class UnimplementedEffectBuilderError extends Error {
  constructor(builderClass: string, abilityPath: string) {
    super(`effect builder class not implemented in this port: ${builderClass} (ability ${abilityPath})`);
    this.name = "UnimplementedEffectBuilderError";
  }
}

/**
 * Every effect-builder class the full data corpus reaches is now implemented (status-effects.md
 * §5's census): `AnimationEffectBuilder`/`ParticleEffectBuilder`/`CaptureEffectBuilder`/
 * `ImageEffectBuilder` (status-effects.md §7 item 4 — `Offensive.FixedReflection`'s `thorns.png`
 * is its only real corpus use) and `MotherEffectBuilder` (effects-info.md §2 — the four
 * `Offensive.{Air,Earth,Fire,Water}Mother` dragon fly-ins, carried by the four BabyDragons'
 * usable2, so a random full-roster sample can reach it). Anything else (a future data edit)
 * throws `UnimplementedEffectBuilderError` instead of silently rendering nothing.
 */
export function requireImplementedEffectBuilder(
  builderClass: unknown,
  abilityPath: string,
):
  | "AnimationEffectBuilder"
  | "ParticleEffectBuilder"
  | "CaptureEffectBuilder"
  | "ImageEffectBuilder"
  | "MotherEffectBuilder" {
  if (
    builderClass !== "AnimationEffectBuilder" &&
    builderClass !== "ParticleEffectBuilder" &&
    builderClass !== "CaptureEffectBuilder" &&
    builderClass !== "ImageEffectBuilder" &&
    builderClass !== "MotherEffectBuilder"
  ) {
    throw new UnimplementedEffectBuilderError(String(builderClass), abilityPath);
  }
  return builderClass;
}


export const MOTHER_FLY_MS = 500;
export const MOTHER_SCALE_MS = 200;
export const MOTHER_SCALE_PEAK = 1.3;
export const MOTHER_FLASH_MS = 300;
export const MOTHER_FLASH_COUNT = 6;

// --- MeleeAttacks.json (§6 branch 3) ---

export interface MeleeAttackFrame {
  spriteFrameName: string;
  scaleValues: string;
  relativeStart: string;
  relativeEnd: string;
}

export interface MeleeAttackEntry {
  /** `"animation"` | `"frameSlide"` (both CONFIRMED literals) — anything else is the original's
   *  logged-but-not-fatal `"Unknown melee attack type:%@"` case; this port throws instead. */
  type: string;
  /** CONFIRMED key — every real entry carries one (`.m4a` filename), played alongside the visual. */
  soundFile: string;
  /** Present when `type === "animation"`: recurses into `AnimationEffectBuilder` with this
   *  sub-dict (CONFIRMED key `"effectData"`). */
  effectData?: { animationName: string; offset?: string };
  /** Present when `type === "frameSlide"` (CONFIRMED key `"frames"`) — procedural per-element
   *  frame-swap data (`spriteFrameName`/`scaleValues`/`relativeStart`/`relativeEnd`, all
   *  CONFIRMED keys), rendered by `abilityRenderer.ts`'s `spawnFrameSlide` as a masked
   *  wipe-reveal (the `TextureRectSlideAction` equivalent). */
  frames?: MeleeAttackFrame[];
}

export type MeleeAttacksData = Record<string, MeleeAttackEntry>;


export function resolveMeleeAttack(table: MeleeAttacksData, key: string): MeleeAttackEntry {
  const entry = table[key];
  if (!entry) throw new Error(`unknown melee attack type: "${key}"`);
  return entry;
}
