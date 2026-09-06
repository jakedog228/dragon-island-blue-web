import { Container, type FederatedPointerEvent, type Sprite, type Texture } from "pixi.js";
import { buttonHitRectLocal, MIN_TOUCH_SIZE, rectContainsPoint } from "./hitTest.js";
import { pointSprite } from "./pointSprite.js";
import type { Rect } from "./scale9Math.js";

export interface ButtonSpriteOpts {


  normalTexture: Texture;
  /** Frame swapped in while pressed. `widgets.md` §"ButtonSprite": "Press feedback = display-frame
   *  swap only — no scale, no tint, no opacity change anywhere in the class." Pass `null`/omit for
   *  a single-texture button — no press feedback at all, which the real class supports too (the
   *  ivar defaults nil and every `setDisplayFrame:activeFrame` call is itself nil-guarded). */
  activeTexture?: Texture | null;
  /** Cocos2d `userObject` — an arbitrary payload the caller round-trips through the button (e.g. a
   *  `PopupButtonConfig`/`PopupMenuItem` attaching itself so its handler can read `button.userObject`). */
  userObject?: unknown;


  minHitSize?: number;


  pressSound?: () => void;
  /** Optional deterministic/debug label for the internal visual sprite. */
  spriteLabel?: string;
  /** Optional visual alpha for interaction-proxy compositions; the sprite still defines bounds. */
  spriteAlpha?: number;
}


export class ButtonSprite extends Container {
  userObject: unknown;

  private readonly sprite: Sprite;
  private readonly normalTexture: Texture;
  private readonly activeTexture: Texture | null;
  private readonly minHitSize: number;
  private readonly pressSound: (() => void) | undefined;
  private handler: (() => void) | null = null;
  private pressed = false;
  private activePointerId: number | null = null;
  private readonly claimedPointerIds = new Set<number>();
  private _enabled = true;

  constructor(opts: ButtonSpriteOpts) {
    super();
    this.normalTexture = opts.normalTexture;
    this.activeTexture = opts.activeTexture ?? null;
    this.userObject = opts.userObject;
    this.minHitSize = opts.minHitSize ?? MIN_TOUCH_SIZE;
    this.pressSound = opts.pressSound;

    this.sprite = pointSprite(this.normalTexture);
    if (opts.spriteLabel !== undefined) this.sprite.label = opts.spriteLabel;
    if (opts.spriteAlpha !== undefined) this.sprite.alpha = opts.spriteAlpha;
    this.addChild(this.sprite);

    this.eventMode = "static";
    this.cursor = "pointer";
    // The 55pt-padded rect must gate Pixi's own hit test (see class doc) — without this the
    // MinTouchSizeMenu expansion would be dead code, since no event fires in the padding ring.
    this.hitArea = { contains: (x: number, y: number) => this.hitTestLocal(x, y) };
    this.on("pointerdown", this.handlePointerDown, this);
    this.on("globalpointermove", this.handlePointerMove, this);
    this.on("pointerup", this.handlePointerUp, this);
    this.on("pointerupoutside", this.handlePointerUpOutside, this);
    this.on("pointercancel", this.handlePointerCancel, this);
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    this._enabled = value;


    this.eventMode = value ? "static" : "none";
  }


  onPress(cb: () => void): void {
    this.handler = cb;
  }

  /** The hit rect in this container's LOCAL space (hitTest.ts `buttonHitRectLocal`): the sprite's
   *  point-space size (its 1/CSF fold makes `.width`/`.height` points) — i.e. the raw
   *  `scaledContentSize` = size x this node's OWN scale — floored to `minHitSize` (default 55),
   *  mapped back to local units. Recomputed per call, so
   *  texture swaps and scale changes are always reflected. */
  private localHitRect(): Rect {
    return buttonHitRectLocal(
      { w: this.sprite.width, h: this.sprite.height },
      { x: this.scale.x, y: this.scale.y },
      this.minHitSize,
    );
  }

  private hitTestLocal(x: number, y: number): boolean {
    return rectContainsPoint(this.localHitRect(), { x, y });
  }

  private handlePointerDown(e: FederatedPointerEvent): void {
    if (!this._enabled) return;
    const p = e.getLocalPosition(this);
    if (!this.hitTestLocal(p.x, p.y)) return;


    e.stopPropagation();
    this.claimedPointerIds.add(e.pointerId);
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.pressed = true;
    if (this.activeTexture) this.sprite.texture = this.activeTexture;
  }

  private handlePointerMove(e: FederatedPointerEvent): void {


    if (this.claimedPointerIds.has(e.pointerId)) e.stopPropagation();
    if (!this.pressed || e.pointerId !== this.activePointerId || !this.activeTexture) return;
    const p = e.getLocalPosition(this);
    this.sprite.texture = this.hitTestLocal(p.x, p.y) ? this.activeTexture : this.normalTexture;
  }

  private handlePointerUp(e: FederatedPointerEvent): void {
    if (this.claimedPointerIds.delete(e.pointerId)) e.stopPropagation();
    if (!this.pressed || e.pointerId !== this.activePointerId) return;
    const p = e.getLocalPosition(this);
    const wasInside = this.hitTestLocal(p.x, p.y);
    this.clearClaim();
    if (!this._enabled || !wasInside) return;
    this.pressSound?.();
    this.handler?.();
  }

  private handlePointerUpOutside(e: FederatedPointerEvent): void {
    if (this.claimedPointerIds.delete(e.pointerId)) e.stopPropagation();
    if (!this.pressed || e.pointerId !== this.activePointerId) return;
    this.clearClaim();
  }

  private handlePointerCancel(e: FederatedPointerEvent): void {
    if (this.claimedPointerIds.delete(e.pointerId)) e.stopPropagation();
    if (!this.pressed || e.pointerId !== this.activePointerId) return;
    this.clearClaim();
  }

  private clearClaim(): void {
    this.pressed = false;
    this.activePointerId = null;
    this.sprite.texture = this.normalTexture; // un-press without invoking
  }
}
