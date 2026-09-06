



























import type { Ticker } from "pixi.js";

/** Structural view of the one target type this runner drives. PixiJS `Container` satisfies it. */
export interface CocosActionTarget {
  x: number;
  y: number;
  rotation: number;
  readonly scale: { x: number; y: number };
  /** Pixi nulls a destroyed container's transform; every action write is gated on this. */
  readonly destroyed?: boolean;
}

/** `CCFiniteTimeAction`. */
export abstract class CocosAction {
  readonly duration: number;
  protected target: CocosActionTarget | undefined;

  constructor(duration: number) {
    this.duration = duration;
  }

  startWithTarget(target: CocosActionTarget): void {
    this.target = target;
  }

  stop(): void {
    this.target = undefined;
  }

  abstract step(dtMs: number): void;
  abstract update(t: number): void;
  abstract get isDone(): boolean;
}

/**
 * `CCActionInterval`. Note `step:`'s first-tick rule: the frame after `runAction:` reports
 * elapsed 0 and calls `update(0)`, so an action's opening frame never moves anything — it only
 * publishes the start state that `startWithTarget:` captured.
 */
export abstract class CocosActionInterval extends CocosAction {
  private elapsed = 0;
  private firstTick = true;

  override startWithTarget(target: CocosActionTarget): void {
    super.startWithTarget(target);
    this.elapsed = 0;
    this.firstTick = true;
  }

  override get isDone(): boolean {
    return this.elapsed >= this.duration;
  }

  override step(dtMs: number): void {
    if (this.firstTick) this.firstTick = false;
    else this.elapsed += dtMs;
    this.update(Math.max(0, Math.min(1, this.elapsed / Math.max(this.duration, Number.EPSILON))));
  }
}

/** `CCActionInstant`: zero duration, always done, fires once on its single `step:`. */
export abstract class CocosActionInstant extends CocosAction {
  constructor() {
    super(0);
  }

  override get isDone(): boolean {
    return true;
  }

  override step(_dtMs: number): void {
    this.update(1);
  }
}

/** `CCScaleTo` — captures BOTH current scale components when the phase starts. */
export class ScaleTo extends CocosActionInterval {
  private startX = 0;
  private startY = 0;
  private deltaX = 0;
  private deltaY = 0;

  constructor(durationMs: number, private readonly endX: number, private readonly endY: number) {
    super(durationMs);
  }

  override startWithTarget(target: CocosActionTarget): void {
    super.startWithTarget(target);
    this.startX = target.scale.x;
    this.startY = target.scale.y;
    this.deltaX = this.endX - this.startX;
    this.deltaY = this.endY - this.startY;
  }

  override update(t: number): void {
    const target = this.target;
    if (!target || target.destroyed) return;
    target.scale.x = this.startX + this.deltaX * t;
    target.scale.y = this.startY + this.deltaY * t;
  }
}

/** `CCMoveTo` (interpolated by `CCMoveBy update:`) — captures current position at phase start. */
export class MoveTo extends CocosActionInterval {
  private startX = 0;
  private startY = 0;
  private deltaX = 0;
  private deltaY = 0;

  constructor(durationMs: number, private readonly endX: number, private readonly endY: number) {
    super(durationMs);
  }

  override startWithTarget(target: CocosActionTarget): void {
    super.startWithTarget(target);
    this.startX = target.x;
    this.startY = target.y;
    this.deltaX = this.endX - this.startX;
    this.deltaY = this.endY - this.startY;
  }

  override update(t: number): void {
    const target = this.target;
    if (!target || target.destroyed) return;
    target.x = this.startX + this.deltaX * t;
    target.y = this.startY + this.deltaY * t;
  }
}

/**
 * `CCRotateTo`. Cocos stores rotation in clockwise DEGREES and normalizes the captured start into
 * (-360, 360) before taking the shortest arc to the destination; this port's targets carry Pixi
 * radians, so the same wrap is expressed against 2*PI. Constructed with radians.
 */
export class RotateTo extends CocosActionInterval {
  private startAngle = 0;
  private diffAngle = 0;

  constructor(durationMs: number, private readonly endRadians: number) {
    super(durationMs);
  }

  override startWithTarget(target: CocosActionTarget): void {
    super.startWithTarget(target);
    const full = Math.PI * 2;
    const current = target.rotation;
    this.startAngle = current > 0 ? current % full : -((-current) % full);
    let diff = this.endRadians - this.startAngle;
    if (diff > Math.PI) diff -= full;
    if (diff < -Math.PI) diff += full;
    this.diffAngle = diff;
  }

  override update(t: number): void {
    const target = this.target;
    if (!target || target.destroyed) return;
    target.rotation = this.startAngle + this.diffAngle * t;
  }
}

/** `CCDelayTime`. */
export class DelayTime extends CocosActionInterval {
  override update(_t: number): void {
    /* holds the timeline open and writes nothing */
  }
}

/** `CCCallFunc`/`CCCallFuncO`: an instant action whose `update:` runs the block exactly once. */
export class CallFunc extends CocosActionInstant {
  constructor(private readonly fn: () => void) {
    super();
  }

  override update(_t: number): void {
    this.fn();
  }
}

/** `CCActionEase`: remaps the outer progress and forwards it to the wrapped interval. */
export class Ease extends CocosActionInterval {
  constructor(private readonly inner: CocosActionInterval, private readonly ease: (t: number) => number) {
    super(inner.duration);
  }

  override startWithTarget(target: CocosActionTarget): void {
    super.startWithTarget(target);
    this.inner.startWithTarget(target);
  }

  override stop(): void {
    this.inner.stop();
    super.stop();
  }

  override update(t: number): void {
    this.inner.update(this.ease(t));
  }
}

/**
 * `CCSequence` is BINARY in Cocos — `+[CCSequence actions:]` left-folds N actions into nested
 * pairs. `update:` is transcribed from `CCActionInterval.m`: crossing the split finalizes the
 * first child (`update:1.0` then `stop`) and STARTS the second, which is precisely where the
 * second child's phase-start capture reads the transform the first child left behind.
 */
class SequenceTwo extends CocosActionInterval {
  private split = 0;
  private last = -1;

  constructor(private readonly one: CocosAction, private readonly two: CocosAction) {
    super(one.duration + two.duration);
  }

  private child(index: number): CocosAction {
    return index === 0 ? this.one : this.two;
  }

  override startWithTarget(target: CocosActionTarget): void {
    super.startWithTarget(target);
    this.split = this.duration > 0 ? this.one.duration / this.duration : 0;
    this.last = -1;
  }

  override stop(): void {
    if (this.last !== -1) this.child(this.last).stop();
    super.stop();
  }

  override update(t: number): void {
    const target = this.target;
    if (!target) return;
    let found: number;
    let newT: number;
    if (t < this.split) {
      found = 0;
      newT = this.split !== 0 ? t / this.split : 1;
    } else {
      found = 1;
      newT = this.split === 1 ? 1 : (t - this.split) / (1 - this.split);
    }
    if (found === 1) {
      if (this.last === -1) {
        // Zero-duration first child (a `CallFunc`, or a capture-less `DelayTime(0)`): it never
        // gets a frame of its own, so Cocos starts, completes, and stops it inline.
        this.one.startWithTarget(target);
        this.one.update(1);
        this.one.stop();
      } else if (this.last === 0) {
        this.one.update(1);
        this.one.stop();
      }
    }
    if (this.last !== found) this.child(found).startWithTarget(target);
    this.child(found).update(newT);
    this.last = found;
  }
}

/**
 * `CCSpawn`, also binary, also left-folded. Cocos pads the shorter child with a `CCDelayTime` so
 * both run the full spawn duration — which is why `CCSpawn(ScaleTo(0.5), CCCallFuncO)` fires its
 * callback on the spawn's very first update rather than at the end of the restore leg.
 */
class SpawnTwo extends CocosActionInterval {
  constructor(private readonly one: CocosAction, private readonly two: CocosAction, durationMs: number) {
    super(durationMs);
  }

  override startWithTarget(target: CocosActionTarget): void {
    super.startWithTarget(target);
    this.one.startWithTarget(target);
    this.two.startWithTarget(target);
  }

  override stop(): void {
    this.one.stop();
    this.two.stop();
    super.stop();
  }

  override update(t: number): void {
    this.one.update(t);
    this.two.update(t);
  }
}

/** `+[CCSequence actions:]`'s left fold over the supplied children. */
export function sequence(actions: readonly CocosAction[]): CocosAction {
  if (actions.length === 0) throw new Error("sequence() needs at least one action");
  return actions.reduce((prev, next) => new SequenceTwo(prev, next));
}

/** `+[CCSpawn actions:]`'s left fold, including Cocos' shorter-child `CCDelayTime` padding. */
export function spawn(actions: readonly CocosAction[]): CocosAction {
  if (actions.length === 0) throw new Error("spawn() needs at least one action");
  return actions.reduce((prev, next) => {
    const d1 = prev.duration;
    const d2 = next.duration;
    const one = d1 < d2 ? new SequenceTwo(prev, new DelayTime(d2 - d1)) : prev;
    const two = d2 < d1 ? new SequenceTwo(next, new DelayTime(d1 - d2)) : next;
    return new SpawnTwo(one, two, Math.max(d1, d2));
  });
}

export interface ActionHandle {
  readonly action: CocosAction;
  /** Resolves when the action completes OR is stopped. NEVER a gate on admitting the next one. */
  readonly finished: Promise<void>;
  /** True once the action left the manager, however it left. */
  readonly settled: boolean;
}

interface TargetElement {
  target: CocosActionTarget;
  actions: CocosAction[];
  handles: Map<CocosAction, { resolve: () => void; handle: { settled: boolean } }>;
}

/**
 * `CCActionManager`. One insertion-ordered action array per target; `update:` steps every action
 * and removes the ones that finished on that step.
 */
export class CocosActionManager {
  private readonly elements: TargetElement[] = [];

  runAction(target: CocosActionTarget, action: CocosAction): ActionHandle {
    let element = this.elements.find((candidate) => candidate.target === target);
    if (!element) {
      element = { target, actions: [], handles: new Map() };
      this.elements.push(element);
    }
    const state = { settled: false };
    let resolve!: () => void;
    const finished = new Promise<void>((r) => {
      resolve = r;
    });
    element.actions.push(action);
    element.handles.set(action, { resolve, handle: state });
    // `-[CCActionManager addAction:target:paused:]` starts the action immediately; the first
    // `step:` arrives on the next manager update and reports t = 0.
    action.startWithTarget(target);
    return {
      action,
      finished,
      get settled() {
        return state.settled;
      },
    };
  }

  /**
   * Steps every live action. Targets and per-target action arrays are snapshotted, so an action
   * admitted from inside a `CallFunc` this frame takes its first step on the NEXT frame — where
   * `CCActionInterval.step:`'s first-tick rule would have made it a no-op anyway.
   */
  update(dtMs: number): void {
    for (const element of [...this.elements]) {
      if (element.target.destroyed) {
        this.stopActionsForElement(element);
        continue;
      }
      for (const action of [...element.actions]) {
        if (!element.actions.includes(action)) continue; // a callback stopped it mid-pass
        action.step(dtMs);
        if (action.isDone) {
          action.stop();
          this.removeAction(element, action);
        }
      }
    }
  }

  /** Cancels everything on one target (scene teardown, or an entry that is being destroyed). */
  stopActions(target: CocosActionTarget): void {
    const element = this.elements.find((candidate) => candidate.target === target);
    if (element) this.stopActionsForElement(element);
  }

  stopAllActions(): void {
    for (const element of [...this.elements]) this.stopActionsForElement(element);
  }

  get activeActionCount(): number {
    return this.elements.reduce((total, element) => total + element.actions.length, 0);
  }

  private stopActionsForElement(element: TargetElement): void {
    for (const action of [...element.actions]) {
      action.stop();
      this.removeAction(element, action);
    }
  }

  private removeAction(element: TargetElement, action: CocosAction): void {
    const index = element.actions.indexOf(action);
    if (index >= 0) element.actions.splice(index, 1);
    const record = element.handles.get(action);
    if (record) {
      element.handles.delete(action);
      record.handle.settled = true;
      record.resolve();
    }
    if (element.actions.length === 0) {
      const elementIndex = this.elements.indexOf(element);
      if (elementIndex >= 0) this.elements.splice(elementIndex, 1);
    }
  }
}

/**
 * Binds one `CocosActionManager` to the app ticker with a single, stably-ordered listener — the
 * scheduler slot Cocos gives `CCActionManager` itself. Aborting the owning scene's signal stops
 * every action and detaches the listener, so nothing writes through a destroyed Pixi transform.
 */
export class TickerActionRunner {
  readonly manager = new CocosActionManager();
  private readonly ticker: Ticker;
  private readonly step: () => void;
  private detached = false;

  constructor(ticker: Ticker, signal: AbortSignal) {
    this.ticker = ticker;
    this.step = () => this.manager.update(ticker.deltaMS);
    if (signal.aborted) {
      this.detached = true;
      return;
    }
    ticker.add(this.step);
    signal.addEventListener("abort", () => this.detach(), { once: true });
  }

  runAction(target: CocosActionTarget, action: CocosAction): ActionHandle {
    if (this.detached) {
      action.stop();
      return { action, finished: Promise.resolve(), settled: true };
    }
    return this.manager.runAction(target, action);
  }

  stopActions(target: CocosActionTarget): void {
    this.manager.stopActions(target);
  }

  get activeActionCount(): number {
    return this.manager.activeActionCount;
  }

  private detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.ticker.remove(this.step);
    this.manager.stopAllActions();
  }
}
