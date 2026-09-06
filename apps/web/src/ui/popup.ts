




































import { Container, Graphics, type FederatedPointerEvent, type Text, type Ticker } from "pixi.js";
import {
  Box,
  Scale9,
  makeTtfLabel,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import { tween } from "../tween.js";
import { prepareMenuButton2 } from "./menuButton2.js";
import { nearestMenuButton2Hit } from "./menuButton2Math.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { unscaledIdiomPt } from "../displayMode.js";
import { SCREEN_W, SCREEN_H } from "../battle/displayShared.js";
import { popupButtonCloses } from "./popupButtonMath.js";
import {
  SOURCE_POPUP_DIM_COLOR,
  SOURCE_POPUP_DIM_FADE_MS,
  SOURCE_POPUP_DIM_OPACITY,
} from "./sourcePopupPresentation.js";








export interface PopupOverlaySpec {
  /** Base sprite file name as the binary passes it (e.g. "ClerkGirl.png") — resolved to the
   *  "-hd" asset key like every other pointSprite source. */
  file: string;
  anchor: { x: number; y: number };
}





export const MONSTER_HATCH_OVERLAYS: readonly PopupOverlaySpec[] = [
  { file: "ClerkGirl.png", anchor: { x: -0.15, y: 0 } },
  { file: "TutorialRightSide.png", anchor: { x: 1, y: 0 } },
];




const POP_IN_MS = 200;

















let GAP_BEFORE_BUTTONS = unscaledIdiomPt(20, DISPLAY_MODE);



let TITLE_GAP = unscaledIdiomPt(5, DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  GAP_BEFORE_BUTTONS = unscaledIdiomPt(20, DISPLAY_MODE);
  TITLE_GAP = unscaledIdiomPt(5, DISPLAY_MODE);
});




const TITLE_FONT_SIZE = 16;




const BUTTON_ROW_GAP = 30;




const BUTTON_FONT_SIZE = 14;











export interface PopupButtonSpec {
  label: string;
  onPress: () => void | Promise<void>;
  /** Source `PopupMenuItem.closesPopup`. Defaults true. Nested actions such as Convert, Destroy,
   *  and help/info navigation set this false so the invoking popup remains on the notification
   *  stack and is restored when the child popup closes. */
  closesPopup?: boolean;
  /** default true — a disabled button plays `sfx.onButtonBlocked` instead of invoking, mirroring
   *  `PopupMenuItem.invoke`'s `enabled==0` branch (widgets.md §PopupMenuItem). */
  enabled?: boolean;
}

export interface PopupSfxHooks {
  /** `click.m4a` — an enabled button's successful invoke (widgets.md §PopupMenuItem `-invoke`). */
  onButtonPress?: () => void;
  /** `notAllowed.m4a` — a disabled button was tapped anyway (same method, `enabled==0` branch). */
  onButtonBlocked?: () => void;
}

export interface PopupOpts {
  assets: AssetLibrary;
  scale9: Scale9SpritesData;
  ticker: Ticker;










  backgroundKey?: string | null;
  title?: string;
  content: Container;
  /** Optional source-authored content box. Pixi display bounds include stroke/decorative overflow,
   * while native Scale9 sizing reads the owner's `contentSize`; use this to preserve that split. */
  contentLayoutBounds?: { x: number; y: number; w: number; h: number };
  buttons?: readonly PopupButtonSpec[];











  centeredChildren?: readonly {
    node: Container;
    offsetX: number;
    offsetY: number;
    /** Defaults to the card center. Source-owned edge chrome can instead use a card-relative
     * anchor without entering the card's authored measurement. */
    cardAnchor?: { x: number; y: number };
  }[];
  /** Screen-space children owned by the popup layer but not by its animated/measured card.
   * `LicenseDisplay` is mounted this way above the modal dim and below the pager card. */
  screenChildren?: readonly {
    node: Container;
    x: number;
    y: number;
  }[];




  overlays?: readonly PopupOverlaySpec[];

  dismissOnTap?: boolean;




  gapBeforeButtons?: number;
  /** Optional `zIndex` applied to the popup Container the moment it's mounted — BEFORE the pop-in
   *  tween starts (final-review fix): setting z only after `show()` resolves let the card animate in
   *  UNDERNEATH the HUD for the whole 0.2s pop-in. Requires the parent's `sortableChildren = true`. */
  zIndex?: number;
  /** Optional source-authored top inset for popup families that do not vertically center. */
  topInset?: number;




  dimImmediately?: boolean;
  /** Native `hidesWhenNotOnTop`. Background-less Scale9 popups default true; PagedNodeDisplay
   * overrides it to false so it remains visible beneath a nested item-information popup. */
  hidesWhenNotOnTop?: boolean;
  sfx?: PopupSfxHooks;
  /** Called synchronously after the popup is mounted on the notification host and before its
   *  dim/pop-in actions begin. This is the source-equivalent point for content-owned actions such
   *  as a particle system that must start with presentation without affecting pre-mount sizing. */
  onPresent?: () => void;
  /** Observability/lifecycle hook for callers that need to know when modal input is released. */
  onDismiss?: () => void;
  /** Optional flow/scene owner. `PopupHost.dismissOwnedBy` closes all popups opened by this owner,
   *  preventing stale nested dialogs from surviving scene disposal. */
  owner?: object;
  /** `PopupConfig.runScaleAction`; defaults true for the battle popup family. The source
   * OptionsMenuItem's MonsterHatchPopup leaves this false and appears at full scale. */
  runScaleAction?: boolean;
}

/**
 * `Scale9Popup`/`PopupMenu`/`PopupLayerNode` (see file header): a modal, full-screen-touch-
 * swallowing card — Scale9 background sized to fit title + content + an optional button row,
 * 0.2s scaleY pop-in, `dismiss()` (tap-anywhere or an explicit button). Callers build `content`
 * themselves (`infoDisplays.ts`'s job) and hand it to `Popup.show`.
 */
export const POPUP_HOST_Z_INDEX = 10_000;
/** Retained full-screen interfaces mounted directly on the director notification band. Equal-z
 * siblings preserve source add order, so a later SlotMachineNode paints above its StoreNode. */
export const DIRECTOR_INTERFACE_Z_INDEX = 900;










export interface NotificationOverlay {
  /** The mounted layer. A destroyed node is pruned from the walk. */
  readonly node: Container;

  setHiddenByLayerAbove(hidden: boolean): void;
}











export class PopupHost extends Container {
  private static readonly byParent = new WeakMap<Container, PopupHost>();
  private static readonly automaticPresentationRoots = new WeakMap<Container, Container>();
  private readonly stack: Popup[] = [];
  private readonly overlays: NotificationOverlay[] = [];
  private readonly byOwner = new Map<object, Set<Popup>>();
  private readonly cancelledOwners = new WeakSet<object>();

  private constructor() {
    super();
    this.label = "notificationPopupHost";
    this.zIndex = POPUP_HOST_Z_INDEX;
    this.sortableChildren = true;
  }





  static registerAutomaticPresentationRoot(stageRoot: Container, presentationRoot: Container): void {
    if (stageRoot === presentationRoot) {
      throw new Error("PopupHost: automatic presentation root must be a child of the stage root");
    }
    this.automaticPresentationRoots.set(stageRoot, presentationRoot);
  }

  static presentationParentFor(parent: Container): Container {
    let current: Container | null = parent;
    while (current !== null) {
      const presentationRoot = this.automaticPresentationRoots.get(current);
      if (
        presentationRoot !== undefined &&
        !presentationRoot.destroyed &&
        presentationRoot.parent !== null
      ) {
        return presentationRoot;
      }
      current = current.parent;
    }
    return parent;
  }

  static for(parent: Container): PopupHost {
    parent = this.presentationParentFor(parent);
    if (parent instanceof PopupHost) return parent;
    const existing = PopupHost.byParent.get(parent);
    if (existing !== undefined && !existing.destroyed && existing.parent === parent) return existing;
    const host = new PopupHost();
    parent.sortableChildren = true;
    parent.addChild(host);
    PopupHost.byParent.set(parent, host);
    return host;
  }

  get modalDepth(): number {
    return this.stack.length;
  }

  get debugState(): {
    depth: number;
    stack: Array<{
      visible: boolean;
      dismissed: boolean;
      contentLabel: string | null;
      buttons: string[];
    }>;
  } {
    return {
      depth: this.stack.length,
      stack: this.stack.map((popup) => popup.debugState),
    };
  }

  dismissOwnedBy(owner: object): void {
    this.cancelledOwners.add(owner);
    const owned = [...(this.byOwner.get(owner) ?? [])];
    // Top-down avoids briefly revealing an owned parent between child dismissals.
    for (const popup of owned.reverse()) popup.dismiss();
  }

  dismissAll(): void {
    for (const popup of [...this.stack].reverse()) popup.dismiss();
  }

  /** Web-native back/cancel seam. Dismisses only the visible top layer and leaves any stacked
   * parent popup alive, matching the existing pointer-driven close path. */
  dismissTop(): boolean {
    const popup = this.stack[this.stack.length - 1];
    if (popup === undefined) return false;
    popup.dismiss();
    return true;
  }

  /** Dismisses the visible top layer only when it belongs to the expected flow. */
  dismissTopOwnedBy(owner: object): boolean {
    const popup = this.stack[this.stack.length - 1];
    if (popup === undefined || !popup.isOwnedBy(owner)) return false;
    popup.dismiss();
    return true;
  }

  isOwnerCancelled(owner: object): boolean {
    return this.cancelledOwners.has(owner);
  }

  /** Live chat layers, pruned of any node a scene teardown destroyed without dismissing. */
  private liveOverlays(): NotificationOverlay[] {
    const live = this.overlays.filter((overlay) => !overlay.node.destroyed);
    if (live.length !== this.overlays.length) this.overlays.splice(0, Infinity, ...live);
    return this.overlays;
  }







  registerOverlay(overlay: NotificationOverlay): boolean {
    const overlays = this.liveOverlays();
    const alreadyDimmed = this.stack.length > 0 || overlays.length > 0;
    for (const below of this.stack) below.visible = below.hidesWhenNotOnTop === false;
    for (const other of overlays) other.setHiddenByLayerAbove(true);
    overlays.push(overlay);
    return alreadyDimmed;
  }


  releaseOverlay(overlay: NotificationOverlay): void {
    const overlays = this.liveOverlays();
    const index = overlays.indexOf(overlay);
    if (index >= 0) overlays.splice(index, 1);
    this.revealTopLayer();
  }

  /** `setVisible:1` on the topmost remaining layer only. Chats sit above every popup here. */
  private revealTopLayer(): void {
    const topOverlay = this.liveOverlays().at(-1);
    if (topOverlay !== undefined) {
      topOverlay.setHiddenByLayerAbove(false);
      return;
    }
    const top = this.stack[this.stack.length - 1];
    if (top !== undefined) top.visible = true;
  }

  mount(popup: Popup, owner: object | undefined): boolean {
    const overlays = this.liveOverlays();
    const alreadyDimmed = this.stack.length > 0 || overlays.length > 0;
    for (const below of this.stack) below.visible = below.hidesWhenNotOnTop === false;
    for (const overlay of overlays) overlay.setHiddenByLayerAbove(true);
    this.stack.push(popup);
    if (owner !== undefined) {
      let owned = this.byOwner.get(owner);
      if (owned === undefined) {
        owned = new Set();
        this.byOwner.set(owner, owned);
      }
      owned.add(popup);
    }
    popup.zIndex = this.stack.length;
    this.addChild(popup);
    return alreadyDimmed;
  }

  release(popup: Popup, owner: object | undefined): void {
    const index = this.stack.indexOf(popup);
    if (index >= 0) this.stack.splice(index, 1);
    if (owner !== undefined) {
      const owned = this.byOwner.get(owner);
      owned?.delete(popup);
      if (owned?.size === 0) this.byOwner.delete(owner);
    }
    this.revealTopLayer();
  }
}

/** A completed but not-yet-parented card build. */
interface BuiltPopupCard {
  readonly card: Container;
  readonly cardW: number;
  readonly cardH: number;
  /** `undefined` means "leave the popup's existing screen-anchored children alone". */
  readonly screenChildren: Container[] | undefined;
  readonly buttonNodes: Array<{ label: string; node: Container }>;
}




export type PopupConfigurationUpdate = Pick<PopupOpts, "content"> & Partial<Pick<
  PopupOpts,
  | "title"
  | "buttons"
  | "backgroundKey"
  | "overlays"
  | "screenChildren"
  | "centeredChildren"
  | "contentLayoutBounds"
  | "gapBeforeButtons"
  | "topInset"
>>;

export class Popup extends Container {
  private card = new Container();
  private buttonNodes: Array<{ label: string; node: Container }> = [];
  private screenChildNodes: Container[] = [];
  /** Discriminates overlapping `newConfiguration` builds; only the newest may be attached. */
  private configurationGeneration = 0;
  private showOpts: PopupOpts | undefined;
  private dismissed = false;
  private onDismiss: (() => void) | undefined;
  private host: PopupHost | undefined;
  private owner: object | undefined;
  private contentLabel: string | null = null;
  readonly hidesWhenNotOnTop: boolean = true;

  private constructor() {
    super();
  }

  /** True once the modal has synchronously released its input layer and destroyed itself. */
  get isDismissed(): boolean {
    return this.dismissed;
  }

  isOwnedBy(owner: object): boolean {
    return this.owner === owner;
  }

  get debugState(): {
    visible: boolean;
    dismissed: boolean;
    contentLabel: string | null;
    buttons: string[];
  } {
    return {
      visible: this.visible,
      dismissed: this.dismissed,
      contentLabel: this.contentLabel,
      buttons: this.buttonNodes.map(({ label }) => label),
    };
  }





  private async buildCard(opts: PopupOpts, dismissOnTap: boolean): Promise<BuiltPopupCard> {
    const card = new Container();
    card.label = "popupCard";
    // Collected locally: a build that is dismissed or superseded before `attach` must not leave
    // destroyed button nodes behind in the live popup's list.
    const buttonNodes: Array<{ label: string; node: Container }> = [];
    // --- Measure title/content/buttons BEFORE building the Scale9 background (its size depends
    // on theirs) — none of these three are parented yet, so getLocalBounds() reflects only their
    // own content. ---
    let titleLabel: Text | undefined;
    if (opts.title !== undefined) {
      // MonsterHatchPopup's PopupTextConfig title (16pt, no outline — see TITLE_FONT_SIZE) — in the
      // source the title is the first child of the content Box; this kit keeps it as a separate
      // chrome slot but reproduces the same stack (title, 5pt Box gap, message).
      titleLabel = makeTtfLabel(opts.title, TITLE_FONT_SIZE, { outline: false });
      // CCLabelTTF uses anchor (0.5, 0). Text.anchor is the equivalent transform. `.width` already
      // includes makeTtfLabel's 1/CSF scale while `pivot` is unscaled local units, so width/2 was
      // only half the required local pivot and visibly shifted every titled popup.
      titleLabel.anchor.set(0.5, 0);
      titleLabel.label = "popupTitle";
    }

    const buttonRow = opts.buttons?.length
      ? await Popup.buildButtonRow(opts, this, buttonNodes)
      : undefined;




    const contentBounds = opts.contentLayoutBounds ?? (() => {
      const bounds = opts.content.getLocalBounds();
      return { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height };
    })();
    const titleH = titleLabel ? titleLabel.height + TITLE_GAP : 0;
    const gapBeforeButtons = opts.gapBeforeButtons ?? GAP_BEFORE_BUTTONS;
    const buttonH = buttonRow ? gapBeforeButtons + buttonRow.boxContentSize.h : 0;
    const innerW = Math.max(
      titleLabel?.width ?? 0,
      contentBounds.w,
      buttonRow?.boxContentSize.w ?? 0,
    );
    const innerH = titleH + contentBounds.h + buttonH;









    const backgroundKey = opts.backgroundKey === undefined ? "PopupBackgroundThin" : opts.backgroundKey;
    card.sortableChildren = true;
    let cardW = innerW;
    let cardH = innerH;
    if (backgroundKey !== null) {
      const bg = await Scale9.fromConfig(opts.scale9, backgroundKey, opts.assets, {
        w: innerW,
        h: innerH,
      });
      bg.label = "popupBackground";

      bg.zIndex = -1;
      cardW = bg.contentWidth;
      cardH = bg.contentHeight;
      card.addChild(bg);
    }








    if (opts.overlays?.length) {
      const cardLeft = (SCREEN_W - cardW) / 2;
      const cardTop = opts.topInset ?? (SCREEN_H - cardH) / 2;
      for (const spec of opts.overlays) {
        const sprite = pointSprite(await opts.assets.sprite(`${spec.file.replace(/\.png$/i, "")}-hd`));
        // Popup configuration overlays are purely decorative CCSprites. Leaving Pixi's inherited
        // event mode on them lets a screen-edge overlay win hit testing above the button row
        // (notably TutorialRightSide over the destructive popup's Cancel label), even though the
        // source sprite owns no touch delegate.
        sprite.eventMode = "none";
        // Cocos: position = winSize*anchor with anchorPoint = anchor => bottom-left corner at
        // anchor*(winSize - spriteSize); converted to Pixi top-left/Y-down, then to card-local.
        const x = spec.anchor.x * (SCREEN_W - sprite.width);
        const yTop = SCREEN_H - sprite.height - spec.anchor.y * (SCREEN_H - sprite.height);
        sprite.position.set(x - cardLeft, yTop - cardTop);
        sprite.zIndex = 1;
        card.addChild(sprite);
      }
    }



    const padX = (cardW - innerW) / 2;
    let y = (cardH - innerH) / 2;
    if (titleLabel) {
      titleLabel.position.set(cardW / 2, y);
      card.addChild(titleLabel);
      y += titleH;
    }
    opts.content.position.set(padX + (innerW - contentBounds.w) / 2 - contentBounds.x, y - contentBounds.y);
    card.addChild(opts.content);
    if (buttonRow) {
      y += contentBounds.h + gapBeforeButtons;
      // Scale9Popup centers the authored Box contentSize. Button chrome intentionally overhangs
      // each label-sized Box child and therefore does not inflate this measurement.
      buttonRow.position.set(padX + (innerW - buttonRow.boxContentSize.w) / 2, y);
      card.addChild(buttonRow);
    }

    // After all measurement/placement, so these never enter the card's own sizing (see the option's
    // doc) but still ride the pop-in below.
    for (const { node, offsetX, offsetY, cardAnchor } of opts.centeredChildren ?? []) {
      node.position.set(
        cardW * (cardAnchor?.x ?? 0.5) + offsetX,
        cardH * (cardAnchor?.y ?? 0.5) + offsetY,
      );
      card.addChild(node);
    }

    card.position.set((SCREEN_W - cardW) / 2, opts.topInset ?? (SCREEN_H - cardH) / 2);
    // Only wire a card-wide dismiss when there's no button row: a button's own "pointertap"
    // bubbles up to this card (Pixi propagates pointer events up the scene graph), so wiring both
    // would make even a DISABLED button's tap dismiss the popup via the bubbled event, not just an
    // enabled button's own explicit `this.dismiss()` call. (Every current battle-UI caller now
    // passes `dismissOnTap: false` + a real button — see the header's retired-simplification
    // note — so this branch only matters for future button-less callers.)
    if (dismissOnTap && !buttonRow) {
      card.eventMode = "static";
      card.hitArea = { contains: (x, y2) => x >= 0 && x < cardW && y2 >= 0 && y2 < cardH };
      card.on("pointertap", () => this.dismiss());
    }





    card.pivot.set(cardW / 2, cardH / 2);
    card.position.set(card.position.x + cardW / 2, card.position.y + cardH / 2);
    const screenChildren = opts.screenChildren === undefined
      ? undefined
      : opts.screenChildren.map(({ node, x, y }) => {
        node.position.set(x, y);
        return node;
      });
    return { card, cardW, cardH, screenChildren, buttonNodes };
  }












  async newConfiguration(configuration: PopupConfigurationUpdate): Promise<void> {
    if (this.dismissed) return;
    if (this.showOpts === undefined) {
      throw new Error("Popup.newConfiguration before the popup was shown");
    }
    const { screenChildren, ...retained } = this.showOpts;
    const opts: PopupOpts = {
      ...retained,
      ...configuration,
      ...(configuration.screenChildren === undefined
        ? {}
        : { screenChildren: configuration.screenChildren }),
    };
    const generation = (this.configurationGeneration += 1);
    const built = await this.buildCard(opts, opts.dismissOnTap ?? true);
    // Dismissal or a newer configuration can land while this build awaits its assets. Discard the
    // whole build rather than letting a stale one replace live content.
    if (this.dismissed || generation !== this.configurationGeneration) {
      built.card.destroy({ children: true });
      for (const node of built.screenChildren ?? []) node.destroy({ children: true });
      return;
    }
    const outgoing = this.card;
    this.showOpts = opts;
    this.contentLabel = opts.content.label || null;
    this.attach(built);
    outgoing.destroy({ children: true });
  }

  /** Parents a completed build: screen-anchored children first, then the card above them, matching
   *  the order the initial presentation establishes. */
  private attach(built: BuiltPopupCard): void {
    if (built.screenChildren !== undefined) {
      for (const previous of this.screenChildNodes) previous.destroy({ children: true });
      this.screenChildNodes = built.screenChildren;
      for (const node of built.screenChildren) this.addChild(node);
    }
    this.buttonNodes = built.buttonNodes;
    this.card = built.card;
    this.addChild(built.card);
  }

  /** Builds and mounts the popup on the scene's notification host, already pop-in-animated. */
  static async show(parent: Container, opts: PopupOpts): Promise<Popup> {
    const popup = new Popup();
    const host = PopupHost.for(parent);
    popup.host = host;
    popup.owner = opts.owner;
    Object.defineProperty(popup, "hidesWhenNotOnTop", {
      value: opts.hidesWhenNotOnTop ?? true,
    });
    popup.contentLabel = opts.content.label || null;
    popup.onDismiss = opts.onDismiss;
    const dismissOnTap = opts.dismissOnTap ?? true;












    popup.eventMode = "static";
    for (const swallowed of [
      "pointerdown",
      "pointerup",
      "pointerupoutside",
      "pointertap",
      "pointermove",
      "pointercancel",
    ] as const) {
      popup.on(swallowed, (e) => e.stopPropagation());
    }






    const backdrop = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill({
      color: SOURCE_POPUP_DIM_COLOR,
      alpha: 1,
    });
    backdrop.label = "popupDim";
    backdrop.eventMode = "static";
    if (dismissOnTap) backdrop.on("pointertap", () => popup.dismiss());
    popup.addChild(backdrop);
    // The notification-host stack operation is deliberately deferred until all async card assets
    // have loaded. That keeps half-built popups out of the live stack and lets owner cancellation
    // prevent a stale popup from mounting after its flow has already been disposed.

    const built = await popup.buildCard(opts, dismissOnTap);
    const { cardW, cardH } = built;
    popup.showOpts = opts;
    popup.attach(built);

    // A flow can be disposed while this async builder is still loading scale9/overlay assets.
    // Treat its owner token as cancelled before mounting so a stale popup cannot reappear after
    // `dismissOwnedBy` has already drained the scene's notification stack.
    if (opts.owner !== undefined && host.isOwnerCancelled(opts.owner)) {
      popup.dismissed = true;
      try {
        popup.onDismiss?.();
      } finally {
        popup.destroy({ children: true });
      }
      return popup;
    }





    const alreadyDimmed = host.mount(popup, opts.owner);
    opts.onPresent?.();
    if (alreadyDimmed || opts.dimImmediately === true) {
      backdrop.alpha = SOURCE_POPUP_DIM_OPACITY;
    } else {
      backdrop.alpha = 0;
      // Runs concurrently with the pop-in below (the original starts both actions on present).
      void tween(opts.ticker, SOURCE_POPUP_DIM_FADE_MS, (t) => {
        if (popup.dismissed) return;
        backdrop.alpha = t * SOURCE_POPUP_DIM_OPACITY;
      });
    }

    // z BEFORE the tween (final-review fix): otherwise the card pops in underneath the HUD for the
    // whole 0.2s animation. The host itself is above scene content; this preserves legacy bands
    // among popups while adding stack depth so nested popups with the same band remain ordered.
    if (opts.zIndex !== undefined) popup.zIndex = opts.zIndex * 1_000 + host.modalDepth;

    // 0.2s scaleY pop-in from 0 (widgets.md §9). `buildCard` has already centre-pivoted the card
    // so this squashes it about its own centre rather than its top-left corner.
    popup.card.scale.set(1, opts.runScaleAction === false ? 1 : 0);
    // Guard each tween tick against a mid-pop-in dismiss (final-review fix): a backdrop tap can
    // `dismiss()` → destroy the card while this tween is still scheduled; a later tick calling
    // `scale.set` on a destroyed Pixi v8 Container throws. `dismissed` short-circuits every
    // remaining tick (the tween itself keeps running to completion harmlessly).
    if (opts.runScaleAction !== false) {
      await tween(opts.ticker, POP_IN_MS, (t) => {
        if (popup.dismissed) return;
        popup.card.scale.set(1, t);
      });
    }

    return popup;
  }





  dismiss(): void {
    if (this.dismissed) return;
    this.dismissed = true;
    this.host?.release(this, this.owner);
    try {
      this.onDismiss?.();
    } finally {
      this.destroy({ children: true });
    }
  }

  /** Live button centers for deterministic browser choreography; coordinates are world-space. */
  get buttonCenters(): Array<{ label: string; x: number; y: number }> {
    return this.buttonNodes.map(({ label, node }) => {
      const bounds = node.getBounds();
      return { label, x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    });
  }

  private static async buildButtonRow(
    opts: PopupOpts,
    popup: Popup,
    buttonNodes: Array<{ label: string; node: Container }>,
  ): Promise<Box> {





    const box = new Box({ horizontal: true, gap: BUTTON_ROW_GAP, positiveAlignDirection: true });
    const candidates: Array<{
      node: Container;
      visibleRect: { x: number; y: number; w: number; h: number };
      invoke: () => void;
    }> = [];
    for (const spec of opts.buttons!) {
      const enabled = spec.enabled ?? true;


      const label = makeTtfLabel(spec.label, BUTTON_FONT_SIZE, { outline: false });



      const prepared = await prepareMenuButton2({
        assets: opts.assets,
        scale9: opts.scale9,
        label,
      });
      const btn = prepared.node;
      btn.label = `popupButton:${spec.label}`;



      if (!enabled) label.tint = 0xa6a6a6;
      label.position.set(0, 0);
      btn.eventMode = "none";
      btn.cursor = "pointer";
      let invoking = false;
      const invoke = (): void => {






        if (popup.dismissed || invoking) return;
        if (!enabled) {
          opts.sfx?.onButtonBlocked?.();
          return;
        }
        invoking = true;
        opts.sfx?.onButtonPress?.();
        let action: void | Promise<void>;
        try {
          action = spec.onPress();
        } catch (error) {
          invoking = false;
          throw error;
        }
        if (action === undefined) {
          // Preserve the source/previous port's synchronous close for ordinary button selectors.
          if (popupButtonCloses(spec.closesPopup) && !popup.dismissed) popup.dismiss();
          if (!popup.dismissed) invoking = false;
          return;
        }
        void action.then(
          () => {
            if (popupButtonCloses(spec.closesPopup) && !popup.dismissed) popup.dismiss();
          },
          (error) => {
            // Restore the button before surfacing the failure. This avoids permanently wedging a
            // source-style `closesPopup:NO` action after a rejected async child flow.
            invoking = false;
            queueMicrotask(() => { throw error; });
          },
        ).finally(() => {
          if (!popup.dismissed) invoking = false;
        });
      };
      buttonNodes.push({ label: spec.label, node: btn });
      box.addBoxChild(btn, { contentSize: prepared.layoutContentSize });
      candidates.push({ node: btn, visibleRect: prepared.visibleRect, invoke });
    }
    const candidateAt = (point: Readonly<{ x: number; y: number }>) => nearestMenuButton2Hit(
      candidates.map((candidate) => ({
        value: candidate,
        visibleRect: {
          x: candidate.node.position.x + candidate.visibleRect.x,
          y: candidate.node.position.y + candidate.visibleRect.y,
          w: candidate.visibleRect.w,
          h: candidate.visibleRect.h,
        },
      })),
      point,
    );
    box.eventMode = "static";
    box.hitArea = { contains: (x, y) => candidateAt({ x, y }) !== undefined };
    box.on("pointertap", (event: FederatedPointerEvent) => {
      const candidate = candidateAt(event.getLocalPosition(box));
      if (!candidate) return;
      event.stopPropagation();
      candidate.invoke();
    });
    return box;
  }
}
