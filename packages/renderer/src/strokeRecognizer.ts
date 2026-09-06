
























import { Container, type FederatedPointerEvent } from "pixi.js";
import { BATTLE_STROKES, gridSequence, matchStroke, resampleStrokePath, strokeBounds } from "./strokeGrid.js";
import type { Point, Rect } from "./scale9Math.js";

export interface StrokeRecognizerOpts {











  bounds?: () => Rect;
  /** Registered (name, pattern) pairs, matched in iteration order (`gestureMatchingPath:`).
   *  Defaults to the battle turn panel's 4 swipe-direction patterns (`BATTLE_STROKES`). */
  patterns?: ReadonlyMap<string, RegExp>;
}

export interface StrokeMatch {
  name: string;
  path: readonly Point[];
  bounds: Rect;
  midpoint: Point;
}


















export class StrokeRecognizer {
  private readonly target: Container;
  private readonly boundsFn: (() => Rect) | undefined;
  private readonly patterns: ReadonlyMap<string, RegExp>;
  private strokeCb: ((match: StrokeMatch) => void) | null = null;
  private enabled = true;

  private activePointerId: number | null = null;
  private path: Point[] = [];
  private lastSequence: string | null = null;
  private lastMatchName: string | null = null;

  constructor(target: Container, opts: StrokeRecognizerOpts) {
    this.target = target;
    this.boundsFn = opts.bounds;
    this.patterns = opts.patterns ?? BATTLE_STROKES;

    target.eventMode = "static";
    target.on("pointerdown", this.handlePointerDown, this);




    target.on("globalpointermove", this.handlePointerMove, this);
    target.on("pointerup", this.handlePointerEnd, this);
    target.on("pointerupoutside", this.handlePointerEnd, this);
    target.on("pointercancel", this.handlePointerCancel, this);
  }

  /** Registers the stroke-matched callback (`FRCall` target/action in the original —
   *  `addTarget:action:`, invoked when `state` transitions to "recognized"). */
  onStroke(cb: (match: StrokeMatch) => void): void {
    this.strokeCb = cb;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.resetPointer();
  }

  /** Concise live input diagnostics for `render_game_to_text` browser choreography. */
  get debugState(): {
    readonly enabled: boolean;
    readonly activePointerId: number | null;
    readonly sampledPointCount: number;
    readonly lastSequence: string | null;
    readonly lastMatchName: string | null;
  } {
    return {
      enabled: this.enabled,
      activePointerId: this.activePointerId,
      sampledPointCount: this.path.length,
      lastSequence: this.lastSequence,
      lastMatchName: this.lastMatchName,
    };
  }

  private handlePointerDown(e: FederatedPointerEvent): void {
    if (!this.enabled) return;
    if (this.activePointerId !== null) return; // first pointer-down wins; see class doc
    this.activePointerId = e.pointerId;
    this.path = [this.localPoint(e)];
  }

  private handlePointerMove(e: FederatedPointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerId !== this.activePointerId) return;
    this.path.push(this.localPoint(e));
  }

  private handlePointerEnd(e: FederatedPointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerId !== this.activePointerId) return;


    const path = [...this.path, this.localPoint(e)];
    const bounds = this.boundsFn?.() ?? strokeBounds(path, true);
    const seq = gridSequence(resampleStrokePath(path, bounds), bounds);
    this.resetPointer();
    const name = matchStroke(seq, this.patterns);
    this.lastSequence = seq;
    this.lastMatchName = name;
    if (name !== null) {
      this.strokeCb?.({
        name,
        path,
        bounds,
        midpoint: { x: bounds.x + bounds.w * 0.5, y: bounds.y + bounds.h * 0.5 },
      });
    }
  }

  private handlePointerCancel(e: FederatedPointerEvent): void {
    if (!this.enabled) return;
    if (e.pointerId !== this.activePointerId) return;
    this.resetPointer(); // a cancelled stroke never matches, per FRCall's "no invokeCallback" path
  }

  private resetPointer(): void {
    this.activePointerId = null;
    this.path = [];
  }

  /** `e.getLocalPosition(target)` isn't available on a raw `FederatedPointerEvent` without the
   *  target — `target` is captured via the event's own `currentTarget`, mirroring
   *  `buttonSprite.ts`'s `e.getLocalPosition(this)` pattern (both classes are Container-scoped
   *  listeners so `currentTarget` is always the attached `Container`). */
  private localPoint(e: FederatedPointerEvent): Point {
    const p = e.getLocalPosition(this.target);
    return { x: p.x, y: p.y };
  }
}
