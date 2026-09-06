


import { Container, Graphics, type Container as PixiContainer, type Sprite, type Texture, type Ticker } from "pixi.js";
import { pointSprite } from "@dib/renderer";
import type { BattleEvent } from "@dib/engine";
import { StatusTextBuffer, formatEventLines } from "./statusTextQueue.js";

/** Dialogs.json "StatusText".fixedSize (phone tier — this port's point-space convention). */
export const STATUS_TEXT_SIZE = { w: 300, h: 70 };


const BACKDROP_COLOR = 0x000000;
const BACKDROP_ALPHA = 0x50 / 255;


const BACKDROP_SCALE_W = 1.11;
const BACKDROP_SCALE_H = 1.5;
/** `CCBlink actionWithDuration:1.0f blinks:1` — one full on/off cycle per second. */
const BLINK_HALF_PERIOD_MS = 500;

export interface StatusTextDisplayOpts {
  /** `PopupBackgroundThin` `Scale9` background, already sized to `size` by the caller (mirrors
   *  progressBar.ts's already-resolved-Texture convention — this class does no async asset
   *  loading). Positioned centered on this node's own origin, per the class doc above. */
  background: PixiContainer;
  /** `downArrow.png` (-hd) finish-node texture — the blinking tap-to-continue cursor. */
  finishTexture: Texture;
  /** Builds the `arial_20_bold` label `Container` from the current combined ("\n"-joined) status
   *  text. Decouples this class from bitmap-font asset loading (`labels.ts`'s `makeBitmapLabel`
   *  contract requires its font to already be preloaded) — mirrors `progressBar.ts`'s `makeLabel`.
   *  Must produce a LEFT-aligned label wrapped at the box width (status-text-geometry.md — the
   *  original passes wrapWidth = fixedSize.width, alignment 0, unbounded height). Typical caller:
   *  `(text) => makeBitmapLabel(text, 20, true, { wordWrapWidth: STATUS_TEXT_SIZE.w, align: "left" })`. */
  makeLabel: (text: string) => PixiContainer;
  /** Drives the finish-node blink and the 5s auto-advance timer (same injectable-ticker pattern as
   *  `tween.ts`/`LogDrawer` — tests can pass any object exposing `add`/`remove`/`deltaMS`). */
  ticker: Ticker;
  /** Fixed box size in points — default `{300,70}` (Dialogs.json "StatusText".fixedSize, phone). */
  size?: { w: number; h: number };
  /** Initial node position (see the "Position of the StatusTextDisplay node ITSELF" note above). */
  position?: { x: number; y: number };
}

export type StatusTextAcknowledgment = "manual" | "wait-limit" | "none";

/**
 * `AbilityStatusTextDisplay` (`ChainedTextLabel` subclass, followup-consts.md §7): the battle
 * combat-log dialog box. Tap anywhere on it, or wait `buffer.autoAdvanceAfter` (5.0s), to
 * acknowledge it; `push`/`pushEvents` feed it new lines (accumulate/cap semantics owned by
 * `StatusTextBuffer`).
 *
 * Acknowledging is NOT clearing — see `advance()`. The box is emptied only by `clearStatusText()`,
 * which `BattleNode` calls on Battle state-2 entry. Across a run of status-skipped turns (which
 * never reach state 2) the block therefore persists and accumulates, exactly as the original does.
 */
export class StatusTextDisplay extends Container {
  readonly buffer = new StatusTextBuffer();

  private readonly boxSize: { w: number; h: number };
  private readonly ticker: Ticker;
  private readonly makeLabel: (text: string) => PixiContainer;
  private readonly finishSprite: Sprite;
  // Named `labelNode` (not `label`) to avoid colliding with PixiJS's own `Container.label` string
  // property (the debug/display-name field) — same naming dodge as progressBar.ts.
  private labelNode: PixiContainer | null = null;
  private elapsedMs = 0;
  private blinkElapsedMs = 0;
  private dismissalWaiters: Array<(cause: StatusTextAcknowledgment) => void> = [];


  private pages: string[] = [];


  private finishInvocations: Array<() => void> = [];
  private readonly tickFn = (): void => this.onTick();

  constructor(opts: StatusTextDisplayOpts) {
    super();
    this.boxSize = opts.size ?? STATUS_TEXT_SIZE;
    this.ticker = opts.ticker;
    this.makeLabel = opts.makeLabel;
    if (opts.position) this.position.set(opts.position.x, opts.position.y);

    const { w, h } = this.boxSize;

    // CCLayerColor backdrop, z=-1 (added first -> renders behind everything else added after it),
    // rgba(0,0,0,80), sized round(contentSize*1.11), centered on this node's own local origin
    // (battle-node.md scene-tree row).
    const bw = Math.round(w * BACKDROP_SCALE_W);
    const bh = Math.round(h * BACKDROP_SCALE_H);
    const backdrop = new Graphics().rect(0, 0, bw, bh).fill({ color: BACKDROP_COLOR, alpha: BACKDROP_ALPHA });
    backdrop.position.set(-Math.round(bw / 2), -Math.round(bh / 2));
    this.addChild(backdrop);


    const bgBounds = opts.background.getLocalBounds();
    opts.background.position.set(-bgBounds.width / 2 - bgBounds.x, -bgBounds.height / 2 - bgBounds.y);
    this.addChild(opts.background);


    this.finishSprite = pointSprite(opts.finishTexture);
    this.finishSprite.position.set(
      w / 2 - this.finishSprite.width,
      h / 2 - this.finishSprite.height,
    );
    this.finishSprite.visible = false;
    this.addChild(this.finishSprite);


    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = { contains: () => true };
    this.on("pointertap", (event) => {
      event?.stopPropagation?.();
      this.advance("manual");
    });

    this.ticker.add(this.tickFn);
    this.visible = false;
  }


  push(line: string): void {
    this.buffer.append(line);
    this.showBacklog();
  }


  get hasText(): boolean {
    return this.buffer.hasText;
  }


  showFinishNode(): void {
    if (!this.visible) return;
    this.blinkElapsedMs = 0;
    this.finishSprite.visible = true;
  }


  removeFinishNode(): void {
    this.finishSprite.visible = false;
  }


  clearStatusText(): void {
    this.buffer.clear();
    this.pages.length = 0;
    if (this.labelNode) {
      this.removeChild(this.labelNode);
      this.labelNode.destroy({ children: true });
      this.labelNode = null;
    }
    this.elapsedMs = 0;
    this.blinkElapsedMs = 0;
    this.finishSprite.visible = false;
    this.visible = false;
  }

  /** Formats `events` (`formatEventLines`, moved from `BattleScreen.logEvents`) and `push`es each
   *  resulting line in order. `nameOf` resolves living ids to short-type names (the caller's
   *  `session.shortTypeOf`, per the Task 8 brief's "reuse existing logEvents formatting"). */
  pushEvents(events: readonly BattleEvent[], nameOf: (id: string) => string): void {
    for (const line of formatEventLines(events, nameOf)) this.push(line);
  }


  showPages(pages: readonly string[], onFinish?: () => void): void {
    if (pages.length === 0) throw new Error("StatusTextDisplay.showPages requires at least one page");
    // Seed the queue with the backlog the source already parked at index 0. Guarded on an empty
    // queue so a second showPages appends plainly, exactly as repeated addStrings: would.
    if (this.pages.length === 0) {
      const backlog = this.buffer.combined;
      if (backlog !== null) this.pages.push(backlog);
    }
    this.pages.push(...pages);
    if (onFinish) this.finishInvocations.push(onFinish);
    this.showCurrentPage();
  }

  /** Pages queued but not yet advanced past (debug/test observability). */
  get pendingPages(): readonly string[] {
    return this.pages;
  }


  advance(cause: Exclude<StatusTextAcknowledgment, "none"> = "manual"): void {
    this.elapsedMs = 0;
    this.blinkElapsedMs = 0;
    if (this.pages.length > 0) {
      this.pages.shift();
      if (this.pages.length > 0) {
        this.showCurrentPage();
        return;
      }
      this.visible = false;
      this.finishSprite.visible = false;
      const waiters = this.dismissalWaiters.splice(0);
      for (const resolve of waiters) resolve(cause);
      const invocations = this.finishInvocations.splice(0);
      for (const run of invocations) run();
      return;
    }


    this.removeFinishNode();
    const waiters = this.dismissalWaiters.splice(0);
    for (const resolve of waiters) resolve(cause);
  }


  waitForAcknowledgment(): Promise<StatusTextAcknowledgment> {
    if (!this.buffer.hasText) return Promise.resolve("none");
    return new Promise((resolve) => this.dismissalWaiters.push(resolve));
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.ticker.remove(this.tickFn);
    this.pages.length = 0;
    this.finishInvocations.length = 0; // dropped, not fired — a destroyed box finishes nothing
    const waiters = this.dismissalWaiters.splice(0);
    for (const resolve of waiters) resolve("none");
    super.destroy(options);
  }


  private showCurrentPage(): void {
    const text = this.pages[0];
    if (text === undefined) return;
    this.elapsedMs = 0;
    this.blinkElapsedMs = 0;
    this.setText(text);
    this.visible = true;
    this.finishSprite.visible = true;
  }


  private showBacklog(): void {
    const text = this.buffer.combined;
    if (text === null) return;
    this.elapsedMs = 0;
    this.blinkElapsedMs = 0;
    this.setText(text);
    this.visible = true;


  }

  private setText(text: string): void {
    if (this.labelNode) {
      this.removeChild(this.labelNode);
      this.labelNode.destroy({ children: true });
    }
    this.labelNode = this.makeLabel(text);
    // lettersPerSecond 0 -- no typewriter effect; the label is shown fully-formed immediately.
    // Raw-ARM layout (status-text-geometry.md, supersedes the prior best-effort centering): the
    // label is anchored TOP-LEFT (anchorPoint (0,1) in Cocos y-up) at the box's own top-left
    // corner, left-aligned, wrapped at exactly the box width with an unbounded (2000pt sentinel)
    // wrap height — multi-line text grows top-down and may overflow below the 70pt box, which is
    // the original's actual behavior. The caller's makeLabel owns the wrap/align construction
    // (CCLabelBMFont width:alignment:); this class only pins the corner. In this class's
    // center-origin Pixi frame the box top-left is (-w/2, -h/2).
    this.labelNode.position.set(-this.boxSize.w / 2, -this.boxSize.h / 2);
    this.addChild(this.labelNode);
  }

  private onTick(): void {
    const dt = this.ticker.deltaMS;
    if (!this.visible) return;

    this.elapsedMs += dt;
    if (this.elapsedMs >= this.buffer.autoAdvanceAfter * 1000) {
      this.advance("wait-limit");
      return;
    }


    this.blinkElapsedMs += dt;
    if (this.blinkElapsedMs >= BLINK_HALF_PERIOD_MS) {
      this.blinkElapsedMs %= BLINK_HALF_PERIOD_MS;
      this.finishSprite.visible = !this.finishSprite.visible;
    }
  }
}
