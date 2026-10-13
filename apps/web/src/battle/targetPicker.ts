


import {
  Container,
  RenderTexture,
  Sprite,
  type FederatedPointerEvent,
  type Renderer,
  type Ticker,
} from "pixi.js";
import {
  ButtonSprite,
  CONTENT_SCALE_FACTOR,
  minimumHitRectLocal,
  rectContainsPoint,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { PlayerChoice } from "@dib/engine";
import {
  beginTargetPicking,
  pickTarget,
  cancelTargetPicking,
  isTargetPickingDone,
  pickedIds,
  requestFromTargeting,
  outlineStampAnglesDeg,
  outlineRenderTextureGeometry,
  CANCEL_BUTTON_SCALE,
  cancelButtonPixiTopLeft,
  type TargetPickerState,
} from "./targetPickerMath.js";
import { type PopupSfxHooks } from "../ui/popup.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import { PopupHost } from "../ui/popup.js";
import { buildLivingInfoContent, buildAbilityInfoContent, buildElementHelpContent, buildSoulStoneInfoContent, ITEM_INFO_GAP_BEFORE_BUTTONS, LIVING_STAT_NAMES, type ElementHelpName, type LivingInfoAbility, type LivingInfoSnapshot, type LivingInfoSoulStone } from "./infoDisplays.js";
import type { AbilityInfoModel } from "./abilityInfo.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { SCREEN_W, SCREEN_H } from "./displayShared.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { tween } from "../tween.js";

export type { LivingInfoSnapshot } from "./infoDisplays.js";

export interface TargetRef {
  id: string;

  hitNode: Container;
  /** `statusEffectParent` sprite used only for outline presentation. */
  visualNode: Container;
  /** Full LivingDisplay's authored Cocos contentSize, excluding overflowing children. */
  contentSize: { w: number; h: number };
}

export interface TargetPickerSfx {


  onClick?: () => void;
  /** `notAllowed.m4a` — a miss (tapped somewhere that isn't a currently-pickable node), or a
   *  disabled popup button tapped anyway. */
  onNotAllowed?: () => void;
}

export interface TargetPickerOpts {
  assets: AssetLibrary;
  ticker: Ticker;
  renderer: Renderer;
  scale9: Scale9SpritesData;

  strings: LocalizedStrings;
  sfx?: TargetPickerSfx;
}


const FRIENDLY_OUTLINE_COLOR = 0x00ff00;

const ENEMY_OUTLINE_COLOR = 0xff0000;


const PULSE_PERIOD_MS = 500;
const PULSE_MIN_ALPHA = 0.0;
const PULSE_MAX_ALPHA = 1.0;

/** `ScaleInOutRepeatAction(duration:1.0f, scaleFactor:0.1f)` tagged 5 (turn-order-input.md §2): the
 *  CONFIRMED "already-picked" indicator, distinct from the outline pulse above (that one highlights
 *  nodes NOT yet picked; this one runs on a node the moment IT is picked, until the whole flow
 *  finishes/cancels). Read as a ±10% scale oscillation, 1.0s period. */
const SELECTED_PULSE_PERIOD_MS = 1000;
const SELECTED_PULSE_SCALE_DELTA = 0.1;


const AUTO_COMPLETE_DELAY_MS = 100;


const OUTLINE_STAMP_ANGLES = outlineStampAnglesDeg();

interface Highlight {
  node: Sprite;
  outline: Sprite;
  elapsedMs: number;
}

interface SelectedPulse {
  node: Container;
  baseScaleX: number;
  baseScaleY: number;
  elapsedMs: number;
}

/**
 * `TargetPickerGui` (turn-order-input.md §2) + its 3 info popups. One instance is meant to be
 * mounted once over the battlefield (added as a child of whatever Container hosts the team
 * displays) and reused across turns via repeated `begin()` calls.
 */
export class TargetPicker extends Container {
  private readonly assets: AssetLibrary;
  private readonly ticker: Ticker;
  private readonly renderer: Renderer;
  private readonly scale9: Scale9SpritesData;
  private readonly strings: LocalizedStrings;
  private readonly sfx: TargetPickerSfx;

  private state: TargetPickerState | undefined;
  private enemyRefs = new Map<string, TargetRef>();
  private friendRefs = new Map<string, TargetRef>();
  private highlights = new Map<string, Highlight>();
  private selectedPulses = new Map<string, SelectedPulse>();
  private cancelButton: ButtonSprite | undefined;
  private onDoneCb: ((targets: string[]) => void) | undefined;
  private onCancelCb: (() => void) | undefined;
  private runToken = 0;
  private activePopup: string | null = null;
  private activeAbilityInfo: AbilityInfoModel | null = null;

  private readonly pulseTickFn = (): void => this.onPulseTick();
  private readonly highlightTickFn = (): void => this.onHighlightTick();

  constructor(opts: TargetPickerOpts) {
    super();
    this.assets = opts.assets;
    this.ticker = opts.ticker;
    this.renderer = opts.renderer;
    this.scale9 = opts.scale9;
    this.strings = opts.strings;
    this.sfx = opts.sfx ?? {};
    this.label = "targetPicker";
    this.on("pointertap", this.handleOverlayTap);
  }


  async begin(
    choice: PlayerChoice,
    validEnemies: readonly TargetRef[],
    validFriends: readonly TargetRef[],
    onDone: (targets: string[]) => void,
    onCancel: () => void,
  ): Promise<void> {
    this.teardown();
    const token = ++this.runToken;

    this.enemyRefs = new Map(validEnemies.map((r) => [r.id, r]));
    this.friendRefs = new Map(validFriends.map((r) => [r.id, r]));
    this.onDoneCb = onDone;
    this.onCancelCb = onCancel;

    const request = requestFromTargeting(choice.targeting);
    const state = beginTargetPicking(
      request,
      validEnemies.map((r) => r.id),
      validFriends.map((r) => r.id),
    );
    this.state = state;


    if (isTargetPickingDone(state)) {
      // Auto-target fast path (turn-order-input.md §2): "skips the UI entirely" -- no cancel
      // button, no outlines, just the 0.1s delay then finish.
      await tween(this.ticker, AUTO_COMPLETE_DELAY_MS, () => {});
      if (token !== this.runToken) return; // superseded by a newer begin()/cancel() meanwhile
      this.finish(state);
      return;
    }

    this.eventMode = "static";
    this.hitArea = {
      contains: (x, y) => rectContainsPoint({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, { x, y }),
    };
    await this.showCancelButton();
    if (token !== this.runToken) return; // cancelled while the cancel-button sprite was loading
    this.refreshHighlights();
  }


  async showLockedAbilityPopup(): Promise<void> {
    await showMonsterHatchPopup(this.popupEnvironment(), {
      title: localizedString(this.strings, "LockedAbilityTitleKey"),
      content: buildLocalizedMonsterHatchMessageContent(this.strings, "LockedAbility"),
      buttons: [{ label: localizedString(this.strings, "OkButtonKey"), onPress: () => {} }],
    });
  }


  async showLivingInfo(
    snapshot: LivingInfoSnapshot,
    abilityInfoFor: (ability: LivingInfoAbility) => AbilityInfoModel,
  ): Promise<void> {
    const content = await buildLivingInfoContent(snapshot, this.assets, this.strings, {
      onElementTap: () => void this.showElementInfo(snapshot.monster.element as ElementHelpName),
      onStatTap: (statType) => void this.showMessagePopup(`Stat${LIVING_STAT_NAMES[statType]!}Info`),
      onXpTap: () => void this.showMessagePopup("XPInfo"),
      onAbilityTap: (ability) => void this.showAbilityInfo(abilityInfoFor(ability)),
      // Soul-stone row → the stone's own ItemInfoDisplay popup; section title → the generic
      // "ItemsInfo" explainer (soulstone-info-display.md §2's ccTouchEnded: dispatch).
      onSoulStoneTap: (stone) => void this.showSoulStoneInfo(stone),
      onSoulStoneTitleTap: () => void this.showMessagePopup("ItemsInfo"),
    }, {
      nativePointerCancelTarget: this.renderer.canvas,
    });
    this.activePopup = `livingInfo:${snapshot.name}`;
    await new Promise<void>((resolve) => {
      void showMonsterHatchPopup(this.popupEnvironment(), {
        content,
        buttons: [{ label: localizedString(this.strings, "OkButtonKey"), onPress: () => {} }],


        onDismiss: () => {
          this.activePopup = null;
          resolve();
        },
      });
    });
  }


  async showSoulStoneInfo(stone: LivingInfoSoulStone): Promise<void> {
    const content = await buildSoulStoneInfoContent(stone, this.assets, {
      onStatTap: (statType) => void this.showMessagePopup(`Stat${LIVING_STAT_NAMES[statType]!}Info`),
    });
    this.activePopup = `soulStone:${stone.name}`;
    await showMonsterHatchPopup(this.popupEnvironment(), {
      content,
      buttons: [{ label: localizedString(this.strings, "OkButtonKey"), onPress: () => {} }],
      gapBeforeButtons: ITEM_INFO_GAP_BEFORE_BUTTONS,
      onDismiss: () => { this.activePopup = null; },
    });
  }


  async showMessagePopup(name: string): Promise<void> {
    // Report the message's own key as the popup identity so a scenario can assert WHICH message
    // opened (e.g. a swipe refused with `message:NoRoomToAddMonster`) instead of only that some
    // popup exists. These are frequently NESTED — the stat/XP rows open one on top of an already
    // reported `livingInfo:` card — so dismissal restores the previous identity rather than
    // clearing it, keeping the underlying card's identity intact for the rest of a scenario.
    const previous = this.activePopup;
    this.activePopup = `message:${name}`;
    await showMonsterHatchPopup(this.popupEnvironment(), {
      title: localizedString(this.strings, `${name}TitleKey`),
      content: buildLocalizedMonsterHatchMessageContent(this.strings, name),
      buttons: [{ label: localizedString(this.strings, "OkButtonKey"), onPress: () => {} }],
      onDismiss: () => {
        this.activePopup = previous;
      },
    });
  }


  async showAbilityInfo(model: AbilityInfoModel): Promise<void> {
    this.activePopup = `ability:${model.name}`;
    this.activeAbilityInfo = model;
    await showMonsterHatchPopup(this.popupEnvironment(), {
      content: buildAbilityInfoContent(model),
      buttons: [{ label: localizedString(this.strings, "OkButtonKey"), onPress: () => {} }],
      hideOverlays: true,
      onDismiss: () => {
        this.activePopup = null;
        this.activeAbilityInfo = null;
      },
    });
  }


  async showElementInfo(element: ElementHelpName): Promise<void> {
    this.activePopup = `element:${element}`;
    await showMonsterHatchPopup(this.popupEnvironment(), {


      title: localizedString(this.strings, `Element${element}HelpTitleKey`),
      content: buildElementHelpContent(element, this.strings),
      buttons: [{ label: localizedString(this.strings, "OkButtonKey"), onPress: () => {} }],
      onDismiss: () => { this.activePopup = null; },
    });
  }

  get activePopupKind(): string | null {
    return this.activePopup;
  }

  get activeAbilityInfoState(): AbilityInfoModel | null {
    return this.activeAbilityInfo;
  }

  /** Dismisses only the visible top information/message popup, if any. */
  dismissTopPopup(): boolean {
    return PopupHost.for(this).dismissTop();
  }

  get hasOpenPopup(): boolean {
    return PopupHost.for(this).modalDepth > 0;
  }

  get visualState(): Record<string, unknown> {
    return {
      outlines: [...this.highlights.entries()].map(([id, { outline }]) => ({
        id,
        nodeType: "RenderTextureSprite",
        childCount: outline.children.length,
        alpha: outline.alpha,
        textureSize: { w: outline.texture.width, h: outline.texture.height },
        antialias: outline.texture.source.antialias,
        scaleMode: outline.texture.source.scaleMode,
      })),
      cancel: this.cancelButton
        ? {
            x: this.cancelButton.position.x,
            y: this.cancelButton.position.y,
            w: this.cancelButton.width,
            h: this.cancelButton.height,
          }
        : null,
    };
  }


  cancel(): void {
    if (!this.state) return;
    cancelTargetPicking(this.state);
    const cb = this.onCancelCb;
    this.teardown();
    cb?.();
  }


  cancelViaEscape(): void {
    this.cancel();
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.teardown();
    super.destroy(options);
  }


  private popupSfx(): PopupSfxHooks {
    return {
      ...(this.sfx.onClick ? { onButtonPress: this.sfx.onClick } : {}),
      ...(this.sfx.onNotAllowed ? { onButtonBlocked: this.sfx.onNotAllowed } : {}),
    };
  }

  private popupEnvironment() {
    return {
      parent: this,
      assets: this.assets,
      scale9: this.scale9,
      ticker: this.ticker,
      sfx: this.popupSfx(),
    };
  }

  private finish(state: TargetPickerState): void {
    const ids = pickedIds(state);
    const cb = this.onDoneCb;
    this.teardown();
    cb?.(ids);
  }

  private handleTap(id: string): void {
    if (!this.state) return;
    const { state, outcome } = pickTarget(this.state, id);
    this.state = state;
    if (outcome === "picked") {
      this.sfx.onClick?.();
      const ref = this.enemyRefs.get(id) ?? this.friendRefs.get(id);


      if (ref) this.startSelectedPulse(id, ref.hitNode);
      if (isTargetPickingDone(state)) {
        this.finish(state);
      } else {
        this.refreshHighlights();
      }
    } else if (outcome === "miss") {
      this.sfx.onNotAllowed?.();
    }


  }

  private readonly handleOverlayTap = (event: FederatedPointerEvent): void => {
    const state = this.state;
    if (state === undefined || (state.phase !== "enemies" && state.phase !== "friends")) return;
    event.stopPropagation();

    let nearest: { id: string; distance2: number } | undefined;
    for (const ref of [...this.enemyRefs.values(), ...this.friendRefs.values()]) {
      if (!ref.hitNode.visible) continue;
      const local = minimumHitRectLocal(
        { x: 0, y: 0, w: ref.contentSize.w, h: ref.contentSize.h },
        { x: ref.hitNode.scale.x, y: ref.hitNode.scale.y },
      );
      const corners = [
        ref.hitNode.toGlobal({ x: local.x, y: local.y }),
        ref.hitNode.toGlobal({ x: local.x + local.w, y: local.y }),
        ref.hitNode.toGlobal({ x: local.x, y: local.y + local.h }),
        ref.hitNode.toGlobal({ x: local.x + local.w, y: local.y + local.h }),
      ];
      const xs = corners.map(({ x }) => x);
      const ys = corners.map(({ y }) => y);
      const bounds = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
      if (!rectContainsPoint(bounds, event.global)) continue;
      const dx = bounds.x + bounds.w / 2 - event.global.x;
      const dy = bounds.y + bounds.h / 2 - event.global.y;
      const distance2 = dx * dx + dy * dy;
      if (nearest === undefined || distance2 < nearest.distance2) {
        nearest = { id: ref.id, distance2 };
      }
    }
    this.handleTap(nearest?.id ?? "__empty_target_picker_hit__");
  };

  private async showCancelButton(): Promise<void> {
    const texture = await this.assets.sprite("charscreenBackButton-hd");
    const btn = new ButtonSprite({ normalTexture: texture, ...(this.sfx.onClick ? { pressSound: this.sfx.onClick } : {}) });
    btn.scale.set(CANCEL_BUTTON_SCALE);
    // Source center: right edge winW-5, y=120 phone / 220 native iPad points (110 normalized).
    const position = cancelButtonPixiTopLeft({
      screenW: SCREEN_W,
      screenH: SCREEN_H,
      scaledW: btn.width,
      scaledH: btn.height,
      mode: DISPLAY_MODE,
    });
    btn.position.set(position.x, position.y);
    btn.label = "targetPickerCancel";
    btn.onPress(() => this.cancel());
    this.addChild(btn);
    this.cancelButton = btn;
  }

  private refreshHighlights(): void {
    this.clearHighlights();
    const state = this.state;
    if (!state) return;
    if (state.phase === "enemies") {
      for (const id of state.validEnemyIds) {
        if (state.pickedEnemies.includes(id)) continue;
        const ref = this.enemyRefs.get(id);
        if (ref) this.addHighlight(id, ref.visualNode, ENEMY_OUTLINE_COLOR, "enemy");
      }
    } else if (state.phase === "friends") {
      for (const id of state.validFriendIds) {
        if (state.pickedFriends.includes(id)) continue;
        const ref = this.friendRefs.get(id);
        if (ref) this.addHighlight(id, ref.visualNode, FRIENDLY_OUTLINE_COLOR, "friend");
      }
    }
  }


  private addHighlight(id: string, target: Container, color: number, side: "enemy" | "friend"): void {
    if (!(target instanceof Sprite)) {
      throw new Error(`TargetPicker.addHighlight(${id}): statusEffectParent is not a Sprite`);
    }
    const parent = target.parent;
    if (!parent) throw new Error(`TargetPicker.addHighlight(${id}): target has no parent`);

    const contentW = target.texture.width / CONTENT_SCALE_FACTOR;
    const contentH = target.texture.height / CONTENT_SCALE_FACTOR;
    const geometry = outlineRenderTextureGeometry({
      contentW,
      contentH,
      anchorX: target.anchor.x,
      anchorY: target.anchor.y,
      side,
      cocosScale: Math.abs(target.scale.x) * CONTENT_SCALE_FACTOR,
      mode: DISPLAY_MODE,
    });
    const texture = RenderTexture.create({
      width: geometry.textureW,
      height: geometry.textureH,
      resolution: CONTENT_SCALE_FACTOR,


      antialias: false,
      scaleMode: "nearest",
    });
    const renderTarget = this.cloneOutlineSubtree(target);
    try {
      renderTarget.scale.set(1 / CONTENT_SCALE_FACTOR);
      if (!(renderTarget instanceof Sprite)) throw new Error("TargetPicker: outline root clone is not a Sprite");
      renderTarget.tint = color;
      renderTarget.visible = true;


      renderTarget.blendMode = "add-npm";
      for (let i = 0; i < OUTLINE_STAMP_ANGLES.length; i += 1) {
        const angle = OUTLINE_STAMP_ANGLES[i]!;
        const radians = (angle * Math.PI) / 180;
        renderTarget.position.set(
          geometry.border + target.anchor.x * contentW + Math.cos(radians) * geometry.border,
          geometry.border + target.anchor.y * contentH + Math.sin(radians) * geometry.border,
        );
        this.renderer.render({
          container: renderTarget,
          target: texture,
          clear: i === 0,
          clearColor: [0, 0, 0, 0],
        });
      }
    } catch (error) {
      texture.destroy(true);
      throw error;
    } finally {
      // renderer.render() promotes this temporary Sprite to a render group. Return
      // its instruction identity to Pixi's pool before destroying the detached clone.
      renderTarget.disableRenderGroup();
      renderTarget.destroy({ children: true });
    }

    const outline = new Sprite(texture);
    outline.label = `targetOutline:${id}`;
    outline.eventMode = "none";
    outline.anchor.set(geometry.spriteAnchorX, geometry.spriteAnchorY);
    parent.addChildAt(outline, parent.getChildIndex(target));
    const highlight = { node: target, outline, elapsedMs: 0 };
    this.syncHighlightTransform(highlight);
    this.highlights.set(id, highlight);
    if (this.highlights.size === 1) this.ticker.add(this.highlightTickFn);
  }

  /** Detached `visit` input. Sprite/AnimatedSprite nodes retain their current texture; plain
   * Containers retain recursive child order. Unsupported renderable subclasses fail loudly. */
  private cloneOutlineSubtree(node: Container): Container {
    let clone: Container;
    if (node instanceof Sprite) {
      const sprite = new Sprite(node.texture);
      sprite.anchor.copyFrom(node.anchor);
      sprite.tint = node.tint;
      clone = sprite;
    } else if (node.constructor === Container) {
      clone = new Container();
    } else {
      throw new Error(`TargetPicker: unsupported outline child ${node.constructor.name}`);
    }
    clone.position.copyFrom(node.position);
    clone.scale.copyFrom(node.scale);
    clone.pivot.copyFrom(node.pivot);
    clone.skew.copyFrom(node.skew);
    clone.rotation = node.rotation;
    clone.alpha = node.alpha;
    clone.visible = node.visible;
    clone.blendMode = node.blendMode;
    clone.zIndex = node.zIndex;
    clone.sortableChildren = node.sortableChildren;
    for (const child of node.children) clone.addChild(this.cloneOutlineSubtree(child));
    return clone;
  }

  private clearHighlights(): void {
    for (const { outline } of this.highlights.values()) {
      outline.parent?.removeChild(outline);
      outline.texture.destroy(true);
      outline.destroy();
    }
    this.highlights.clear();
    this.ticker.remove(this.highlightTickFn);
  }

  private onHighlightTick(): void {
    const legMs = PULSE_PERIOD_MS / 2;
    for (const h of this.highlights.values()) {
      this.syncHighlightTransform(h);
      h.elapsedMs += this.ticker.deltaMS;
      // First CCFadeTo starts from the outline's initial full opacity and targets full opacity.
      if (h.elapsedMs <= legMs) {
        h.outline.alpha = PULSE_MAX_ALPHA;
        continue;
      }
      const legIndex = Math.floor((h.elapsedMs - legMs) / legMs);
      const t = ((h.elapsedMs - legMs) % legMs) / legMs;
      h.outline.alpha = legIndex % 2 === 0
        ? PULSE_MAX_ALPHA + (PULSE_MIN_ALPHA - PULSE_MAX_ALPHA) * t
        : PULSE_MIN_ALPHA + (PULSE_MAX_ALPHA - PULSE_MIN_ALPHA) * t;
    }
  }

  private syncHighlightTransform(highlight: Highlight): void {
    const { node, outline } = highlight;
    outline.position.copyFrom(node.position);
    outline.scale.set(
      node.scale.x * CONTENT_SCALE_FACTOR,
      node.scale.y * CONTENT_SCALE_FACTOR,
    );
    outline.rotation = node.rotation;
    outline.skew.copyFrom(node.skew);
    outline.pivot.set(
      node.pivot.x / CONTENT_SCALE_FACTOR,
      node.pivot.y / CONTENT_SCALE_FACTOR,
    );
  }

  private startSelectedPulse(id: string, node: Container): void {
    this.selectedPulses.set(id, { node, baseScaleX: node.scale.x, baseScaleY: node.scale.y, elapsedMs: 0 });
    if (this.selectedPulses.size === 1) this.ticker.add(this.pulseTickFn);
  }

  private onPulseTick(): void {
    const dt = this.ticker.deltaMS;
    for (const p of this.selectedPulses.values()) {
      p.elapsedMs += dt;
      const half = SELECTED_PULSE_PERIOD_MS / 2;
      let factor: number;
      if (p.elapsedMs <= half) {
        factor = 1 + SELECTED_PULSE_SCALE_DELTA * (p.elapsedMs / half);
      } else {
        const legIndex = Math.floor((p.elapsedMs - half) / half);
        const t = ((p.elapsedMs - half) % half) / half;
        factor = legIndex % 2 === 0
          ? 1 + SELECTED_PULSE_SCALE_DELTA - SELECTED_PULSE_SCALE_DELTA * 2 * t
          : 1 - SELECTED_PULSE_SCALE_DELTA + SELECTED_PULSE_SCALE_DELTA * 2 * t;
      }
      p.node.scale.set(p.baseScaleX * factor, p.baseScaleY * factor);
    }
  }

  private stopSelectedPulses(): void {
    for (const p of this.selectedPulses.values()) p.node.scale.set(p.baseScaleX, p.baseScaleY);
    this.selectedPulses.clear();
    this.ticker.remove(this.pulseTickFn);
  }

  private teardown(): void {
    this.eventMode = "passive";
    this.hitArea = null;
    this.clearHighlights();
    this.stopSelectedPulses();
    this.cancelButton?.destroy({ children: true });
    this.cancelButton = undefined;
    this.enemyRefs = new Map();
    this.friendRefs = new Map();
    this.state = undefined;
    this.onDoneCb = undefined;
    this.onCancelCb = undefined;
  }
}
