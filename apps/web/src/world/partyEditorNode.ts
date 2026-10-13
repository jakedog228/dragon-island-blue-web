import { setOwnedTexture } from "@dib/renderer";
// PartyEditorNode — the editable MonsterManagementNode shared by the town (style 0) and the
// world/menu "Monsters" route (style 1). A modal, full-screen-touch-swallowing editor over a
// self-tinted MMScreen background:
//
// - one fixed-slot batting-order coverflow carousel (the shipped style-4 coverflow math);
// - style 0's reserve coverflow, its leading insertion-boundary placeholder prepended to the real
//   reserve cards — present only while the town party actually has a reserve monster;
// - a toolbox row of reorder arrows (`adjustBenchOrder:` step ±1 / jump ±999 on the CENTERED
//   card), an Insert-Soul-Stone icon+label, and a sort-cycle icon;
// - a top-right close (X); the coordinator commits staged ordering there;
// - style 0's "Drag Monsters up/down to change party" title; style 1 has no title.
//
// This node owns rendering + input only. All roster mutations and popup flows live in
// PartyEditorFlow.

import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
} from "pixi.js";
import {
  makeTtfLabel,
  minimumHitRectLocal,
  OUTLINE_FADE_ALPHA,
  pointSprite,
} from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { unscaledIdiomPt } from "../displayMode.js";
import type { LocalizedStrings } from "../localization.js";
import { ManagementSelectionSummary } from "../ui/managementSelectionSummary.js";
import { buildManagementItemBadge } from "../ui/managementItemBadge.js";
import { SCREEN_H, SCREEN_W } from "../battle/displayShared.js";
import {
  MANAGEMENT_BACKGROUND_SIZE_PT,
  MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX,
  MANAGEMENT_BACKGROUND_TINT,
  MANAGEMENT_CARD_SIZE_PT,
  MANAGEMENT_KO_FONT_PT,
  MANAGEMENT_TITLE_COCOS_Y,
  MANAGEMENT_TITLE_COLOR,
  MANAGEMENT_TITLE_FONT_PT,
  advanceCoverflowIndexFrames,
  coverflowEaseFrames,
  presentCoverflowIndex,
  coverflowLayout,
  coverflowProjectedQuad,
  coverflowTouchBoundsX,
  draggedCoverflowIndex,
  pointInCoverflowBounds,
  showingCoverflowIndex,
  updateSelectionTouchState,
} from "../battle/monsterManagementMath.js";
import {
  CflowPerspectiveFilter,
  type CflowProjectedSprite,
} from "../battle/cflowPerspectiveFilter.js";
import {
  EDITOR_INSERT_LABEL_COLOR,
  EDITOR_JUMP_DELTA,
  EDITOR_STEP_DELTA,
  editorCarouselCenter,
  editorArrowEnabled,
  editorHasReserveRow,
  editorInsertLabelFont,
  nearestEditorControl,
  editorPartyHeadingAnchor,
  editorPartyHeadingFont,
  editorPointInCflowStrip,
  editorRemoveAllCenter,
  editorReservesCenter,
  editorSelectionSummaryCenters,
  editorSortColumnLayout,
  editorToolboxLayout,
  type EditorSortOrder,
} from "./partyEditorMath.js";





let SELECTION_DISTANCE_PT = unscaledIdiomPt(15, DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  SELECTION_DISTANCE_PT = unscaledIdiomPt(15, DISPLAY_MODE);
});
const PARTY_EDITOR_Z_INDEX = 80;

export interface EditorMemberModel {
  instanceId: string;
  shortType: string;
  level: number;
  element: string;
  dead: boolean;
  stars: number;
  evolveLevel?: number;
  previousEvolveLevel?: number;
  soulStoneElement?: string;
  injury?: Readonly<{ injureTime: number; healTime: number }>;
  rendererScale?: number;
}

/** Preloaded textures for one editor session. The member set only ever SHRINKS during a session
 * (convert removes a card; reorder/insert never add one), so every monster/element texture the
 * node will need is loaded once up-front and keyed by shortType/element. Equipped-item textures
 * are NOT bounded that way — Convert To Soul Stone mints a new stone mid-session — so
 * `soulStoneByElement` carries every Soul Stone frame the atlas ships, matching the source's
 * draw-time frame-name lookup. */
export interface PartyEditorTextures {
  background: Texture;
  close: Texture;
  cardBackground: Texture;
  /** `notInBattingOrderBkg.png` — the reserves-row card frame (`inBattingOrder:NO`). */
  reserveCardBackground: Texture;
  /** `emptySlotHeads.png`/`emptySlotArrows.png` — the editable nil-slot hint overlay
   *  (geometry follow-up §4). The arrows flip vertically in the reserves row. */
  emptySlotHeads: Texture;
  emptySlotArrows: Texture;
  arrowOrderAllLeft: Texture;
  arrowOrderLeft: Texture;
  arrowOrderRight: Texture;
  arrowOrderAllRight: Texture;
  soulStone: Texture;
  removeAll: Texture;
  rarityStar: Texture;
  sortIcons: readonly [Texture, Texture, Texture];
  sortLabelButton?: {
    node: Container;
    contentSize: { w: number; h: number };
    visibleRect: { x: number; y: number; w: number; h: number };
  };
  monsterByShortType: ReadonlyMap<string, Texture>;
  elementByName: ReadonlyMap<string, Texture>;
  soulStoneByElement: ReadonlyMap<string, Texture>;
  statByName: ReadonlyMap<string, Texture>;
  injured?: Texture;
  injuredBw?: Texture;
}

export interface PartyEditorCallbacks {
  /** A reorder arrow: `delta` is the source `adjustBenchOrder:` argument (±1 step / ±999 jump),
   *  applied to the currently-centered member. */
  onReorder: (delta: number) => void;
  onInsertSoulStone: () => void;
  onSortCycle: () => void;
  onMoveBattingToReserves: (fromIndex: number, reserveIndex: number) => void;
  onMoveReserveToBatting: (reserveIndex: number, battingIndex: number) => void;
  onRemoveAll: () => void;
  /** Tap on the centered card — opens the member's info/convert popup. */
  onInspect: (instanceId: string) => void;
  /** Tap on a card's element badge — opens element help. */
  onElementHelp: (element: string) => void;
  /** Tap on the separately tagged injury decoration. */
  onInjury: (instanceId: string) => void;
  /** Top-right X — commit staged ordering once and close the editor. */
  onClose: () => void;
  onClick: () => void;
}

export interface PartyEditorNativePointerBridge {
  readonly canvas: HTMLCanvasElement;
  readonly toRendererPoint: (event: PointerEvent) => { readonly x: number; readonly y: number };
}

interface EditorCard {
  /** Absent for a nil batting-order slot's placeholder card. */
  member?: EditorMemberModel;
  node: Container;
  background: CflowProjectedSprite;
  perspective: CflowPerspectiveFilter;
  badge?: CflowProjectedSprite;
  injury?: {
    root: Container;
    color: Sprite;
    mask?: Graphics | undefined;
    perspective?: CflowPerspectiveFilter;
    label: ReturnType<typeof makeTtfLabel>;
    injureTime: number;
    healTime: number;
  };
}

interface ActiveTouch {
  pointerId: number;
  owner: "control" | "batting" | "reserves" | "other";
  control?: EditorControl;
  startX: number;
  startY: number;
  /** `CCTouch.selectionTouchState`: latches false after ANY excursion beyond 15 source points,
   * even if the pointer later returns near its start before release. */
  selectionTouch: boolean;
  anchorIndex: number;
}

interface EditorControl {
  readonly node: Container;
  readonly action: () => void;
  readonly enabled?: () => boolean;
  readonly contentRect: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
}

export class PartyEditorNode extends Container {
  private readonly textures: PartyEditorTextures;
  private readonly callbacks: PartyEditorCallbacks;
  private readonly carousel = new Container();
  private readonly cards: EditorCard[] = [];
  private readonly reservesCarousel = new Container();
  private readonly reserveCards: EditorCard[] = [];
  private members: Array<EditorMemberModel | undefined>;
  private reserveMembers: EditorMemberModel[];
  private readonly style: 0 | 1;
  private selectedIndex = 0;
  private actualSelectedIndex = 0;
  private selectedReserveIndex = 0;
  private actualSelectedReserveIndex = 0;
  private sortOrder: EditorSortOrder = 2;
  private sortSprite: Sprite | undefined;
  private readonly arrowControls: Array<{ node: Sprite; delta: number }> = [];
  private readonly controls: EditorControl[] = [];
  private activeTouch: ActiveTouch | undefined;
  private closed = false;
  /** Sub-frame presentation time carried between ticks so both CFlow blends run at the source's
   *  fixed 60fps rather than the browser's refresh rate (see COVERFLOW_FRAME_MS). */
  private easeCarryMs = 0;
  private readonly carouselCenter = editorCarouselCenter();
  private readonly reservesCenter = editorReservesCenter();
  private readonly battingSummary: ManagementSelectionSummary;
  private readonly reservesSummary: ManagementSelectionSummary;
  private closeRect: Rectangle | undefined;
  private nativeCloseAbort: AbortController | undefined;
  private nativeClosePointerId: number | undefined;

  private readonly insertLabelText: string;
  /** Fixed batting-order slot count (`FixedSizeArray` size) — slots beyond the member count
   *  render the source's nil-placeholder hint cards. */
  private readonly battingOrderSlots: number;

  constructor(
    labels: {
      title?: string;
      partyHeading: string;
      insertSoulStone: string;
      battingOrderSlots: number;
      style: 0 | 1;
      strings: LocalizedStrings;
    },
    textures: PartyEditorTextures,
    members: readonly (EditorMemberModel | undefined)[],
    reserveMembers: readonly EditorMemberModel[],
    callbacks: PartyEditorCallbacks,
  ) {
    super();
    this.textures = textures;
    this.callbacks = callbacks;
    this.members = [...members];
    this.reserveMembers = [...reserveMembers];
    this.style = labels.style;
    this.insertLabelText = labels.insertSoulStone;
    this.battingOrderSlots = labels.battingOrderSlots;
    this.battingSummary = new ManagementSelectionSummary(textures.rarityStar, labels.strings);
    this.reservesSummary = new ManagementSelectionSummary(textures.rarityStar, labels.strings);
    if (members.length !== this.battingOrderSlots) {
      throw new Error(
        `PartyEditorNode: received ${members.length} batting slots for capacity ${this.battingOrderSlots}`,
      );
    }
    this.label = "partyEditor";
    this.zIndex = PARTY_EDITOR_Z_INDEX;
    this.sortableChildren = true;

    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, SCREEN_W, SCREEN_H);
    this.on("pointerdown", this.onPointerDown);
    this.on("pointermove", this.onPointerMove);
    this.on("pointerup", this.onPointerUp);
    this.on("pointerupoutside", this.onPointerUp);
    this.on("pointercancel", this.onPointerCancel);
    this.on("pointertap", (e) => e.stopPropagation());
    this.on("wheel", this.onWheel);

    this.buildBackground();
    this.carousel.position.set(this.carouselCenter.x, this.carouselCenter.y);
    this.carousel.sortableChildren = true;
    this.addChild(this.carousel);
    this.rebuildCards();
    const summaryCenters = editorSelectionSummaryCenters();
    this.battingSummary.position.set(summaryCenters.batting.x, summaryCenters.batting.y);
    this.reservesSummary.position.set(summaryCenters.reserves.x, summaryCenters.reserves.y);
    this.addChild(this.battingSummary, this.reservesSummary);

    if (this.hasReserveRow()) this.buildReservesRow();
    if (labels.title !== undefined) this.buildTitle(labels.title);
    this.buildToolbox();
    this.buildSortControls();
    // Both nodes latch the constructor's initial reserve count. Native never refreshes their
    // visibility after drag, deletion, or Remove All during the same session.
    if (this.style === 0 && reserveMembers.length > 0) {
      this.buildPartyHeading(labels.partyHeading);
      this.buildRemoveAll();
    }
    this.buildClose();
    this.applyCarouselLayout();
    this.updateArrowEnablement();
    this.updateSelectionSummaries(0);
  }

  /** Rebuild the carousel after a coordinator mutation (reorder/convert). `selectedIndex` is the
   *  member index to center on afterward (clamped). */
  refresh(
    members: readonly (EditorMemberModel | undefined)[],
    reserveMembers: readonly EditorMemberModel[],
    selectedIndex: number,
    selectedReserveIndex = this.centeredReserveIndex(),
  ): void {
    this.members = [...members];
    this.reserveMembers = [...reserveMembers];
    this.syncReserveRow();
    const clamped = Math.min(Math.max(0, selectedIndex), this.slotCount() - 1);
    this.selectedIndex = clamped;
    this.actualSelectedIndex = clamped;
    const reserveClamped = this.hasReserveRow()
      ? Math.min(Math.max(0, selectedReserveIndex), this.reserveSlotCount() - 1)
      : 0;
    this.selectedReserveIndex = reserveClamped;
    this.actualSelectedReserveIndex = reserveClamped;
    this.rebuildCards();
    if (this.hasReserveRow()) this.rebuildReserveCards();
    this.applyCarouselLayout();
    this.applyReserveCarouselLayout();
    this.updateArrowEnablement();
    this.updateSelectionSummaries(0);
  }

  /** The centered SLOT index; may point at a nil placeholder (the flow's "Which Creature?" gate). */
  centeredMemberIndex(): number {


    return showingCoverflowIndex(this.actualSelectedIndex, this.slotCount());
  }

  centeredReserveIndex(): number {
    return this.hasReserveRow()
      ? showingCoverflowIndex(this.actualSelectedReserveIndex, this.reserveSlotCount())
      : 0;
  }




  private presentedIndex(): number {
    return presentCoverflowIndex(this.selectedIndex, this.actualSelectedIndex, this.easeCarryMs);
  }

  private presentedReserveIndex(): number {
    return presentCoverflowIndex(
      this.selectedReserveIndex,
      this.actualSelectedReserveIndex,
      this.easeCarryMs,
    );
  }

  perspectiveDebugState(): Record<string, unknown> {
    const row = (
      cards: readonly EditorCard[],
      selectedIndex: number,
      center: Readonly<{ x: number; y: number }>,
    ) => cards.map(({ node, background }, index) => {
      const layout = coverflowLayout(index, selectedIndex);
      return {
        index,
        visible: node.visible,
        backgroundAlpha: background.alpha,
        contentAlpha: node.alpha,
        scaleX: node.scale.x,
        orbitDeg: layout.orbitDeg,
        projectedQuad: coverflowProjectedQuad({
          pivot: {
            x: center.x + node.position.x,
            y: center.y + MANAGEMENT_CARD_SIZE_PT / 2,
          },
          screen: { w: SCREEN_W, h: SCREEN_H },
          mode: DISPLAY_MODE,
          orbitDeg: layout.orbitDeg,
        }),
      };
    });
    return {
      batting: row(this.cards, this.presentedIndex(), this.carouselCenter),
      reserves: row(this.reserveCards, this.presentedReserveIndex(), this.reservesCenter),
      // The drawn lane and the source lanes it is derived from, so a pacing scenario can assert
      // per-frame visual motion and per-source-frame sample exactness separately.
      motion: {
        battingLogical: this.selectedIndex,
        battingActual: this.actualSelectedIndex,
        battingPresented: this.presentedIndex(),
        reserveLogical: this.selectedReserveIndex,
        reserveActual: this.actualSelectedReserveIndex,
        reservePresented: this.presentedReserveIndex(),
        easeCarryMs: this.easeCarryMs,
      },
    };
  }

  /** Advance the sort icon to a new mode's texture (the source retextures on each cycle even
   *  though style-1 sorting is a visual no-op). */
  setSortOrder(order: EditorSortOrder): void {
    this.sortOrder = order;
    if (this.sortSprite) this.sortSprite.texture = this.textures.sortIcons[order];
  }

  update(dtMs: number): void {
    if (this.closed) return;
    // Both rows are children of one director, so they share a frame budget (COVERFLOW_FRAME_MS).
    const ease = coverflowEaseFrames(this.easeCarryMs + dtMs);
    this.easeCarryMs = ease.remainderMs;
    this.selectedIndex = advanceCoverflowIndexFrames(
      this.selectedIndex,
      this.actualSelectedIndex,
      ease.frames,
    );
    if (this.hasReserveRow()) {
      this.selectedReserveIndex = advanceCoverflowIndexFrames(
        this.selectedReserveIndex,
        this.actualSelectedReserveIndex,
        ease.frames,
      );
    }
    this.applyCarouselLayout();
    this.applyReserveCarouselLayout();
    this.updateArrowEnablement();
    this.updateSelectionSummaries(dtMs);
    this.updateInjuries(Date.now() / 1000);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.activeTouch = undefined;
    this.nativeCloseAbort?.abort();
    this.nativeCloseAbort = undefined;
    this.nativeClosePointerId = undefined;
    this.removeAllListeners();
    this.parent?.removeChild(this);
    for (const card of [...this.cards, ...this.reserveCards]) {
      card.node.filters = null;
      card.perspective.destroy(false);
    }
    this.destroy({ children: true });
  }

  installNativeCloseBridge(bridge: PartyEditorNativePointerBridge): void {
    if (this.nativeCloseAbort !== undefined) {
      throw new Error("PartyEditorNode: native close bridge is already installed");
    }
    const abort = new AbortController();
    this.nativeCloseAbort = abort;
    const contains = (event: PointerEvent): boolean => {
      if (this.closed || this.eventMode === "none" || this.closeRect === undefined) return false;
      const point = this.toLocal(bridge.toRendererPoint(event));
      return this.closeRect.contains(point.x, point.y);
    };
    bridge.canvas.addEventListener("pointerdown", (event) => {
      if (contains(event)) this.nativeClosePointerId = event.pointerId;
    }, { signal: abort.signal });
    bridge.canvas.addEventListener("pointerup", (event) => {
      if (this.nativeClosePointerId !== event.pointerId) return;
      this.nativeClosePointerId = undefined;
      if (!contains(event)) return;
      this.callbacks.onClick();
      this.callbacks.onClose();
    }, { signal: abort.signal });
    const cancel = (event: PointerEvent): void => {
      if (this.nativeClosePointerId === event.pointerId) this.nativeClosePointerId = undefined;
    };
    bridge.canvas.addEventListener("pointercancel", cancel, { signal: abort.signal });
    bridge.canvas.addEventListener("pointerleave", cancel, { signal: abort.signal });
  }

  private buildBackground(): void {
    const bg = new Sprite(new Texture({
      source: this.textures.background.source,
      frame: new Rectangle(
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.x,
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.y,
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.w,
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.h,
      ),
    }));
    setOwnedTexture(bg, bg.texture);
    bg.width = MANAGEMENT_BACKGROUND_SIZE_PT.w;
    bg.height = MANAGEMENT_BACKGROUND_SIZE_PT.h;
    bg.position.set((SCREEN_W - MANAGEMENT_BACKGROUND_SIZE_PT.w) / 2, (SCREEN_H - MANAGEMENT_BACKGROUND_SIZE_PT.h) / 2);
    bg.tint = MANAGEMENT_BACKGROUND_TINT;
    bg.zIndex = -9999;
    bg.eventMode = "none";
    this.addChild(bg);
  }

  private buildTitle(title: string): void {
    const label = makeTtfLabel(title, MANAGEMENT_TITLE_FONT_PT, { fill: MANAGEMENT_TITLE_COLOR, outline: false });
    label.anchor.set(0.5, 1);
    label.position.set(SCREEN_W / 2, SCREEN_H - MANAGEMENT_TITLE_COCOS_Y);
    label.eventMode = "none";
    this.addChild(label);
  }

  private buildToolbox(): void {
    // Measure the label first — the row's raw-confirmed `5 + boxHeight/2` center depends on the
    // insert sub-box (icon over label) being the tallest child.
    const insertLabel = makeTtfLabel(
      this.insertLabelText,
      editorInsertLabelFont(),
      { fill: EDITOR_INSERT_LABEL_COLOR, outline: false },
    );
    const sizeOf = (t: Texture): { w: number; h: number } => {
      const sprite = pointSprite(t);
      const size = { w: sprite.width, h: sprite.height };
      sprite.destroy();
      return size;
    };
    const layout = editorToolboxLayout({
      arrowAllLeft: sizeOf(this.textures.arrowOrderAllLeft),
      arrowLeft: sizeOf(this.textures.arrowOrderLeft),
      soulStone: sizeOf(this.textures.soulStone),
      arrowRight: sizeOf(this.textures.arrowOrderRight),
      arrowAllRight: sizeOf(this.textures.arrowOrderAllRight),
      insertLabel: { w: insertLabel.width, h: insertLabel.height },
    });
    const textureFor = (key: string): Texture => {
      switch (key) {
        case "orderAllLeftArrow": return this.textures.arrowOrderAllLeft;
        case "orderLeftArrow": return this.textures.arrowOrderLeft;
        case "orderRightArrow": return this.textures.arrowOrderRight;
        case "orderAllRightArrow": return this.textures.arrowOrderAllRight;
        default: return this.textures.soulStone;
      }
    };
    const actionFor = (key: string): (() => void) => {
      switch (key) {
        case "orderAllLeftArrow": return () => this.callbacks.onReorder(-EDITOR_JUMP_DELTA);
        case "orderLeftArrow": return () => this.callbacks.onReorder(-EDITOR_STEP_DELTA);
        case "orderRightArrow": return () => this.callbacks.onReorder(EDITOR_STEP_DELTA);
        case "orderAllRightArrow": return () => this.callbacks.onReorder(EDITOR_JUMP_DELTA);
        default: return () => this.callbacks.onInsertSoulStone();
      }
    };
    for (const control of layout.controls) {
      const sprite = pointSprite(textureFor(control.key));
      sprite.label = `partyEditorControl:${control.key}`;
      sprite.anchor.set(0.5, 0.5);
      sprite.position.set(control.center.x, control.center.y);
      const delta = control.key === "orderAllLeftArrow"
        ? -EDITOR_JUMP_DELTA
        : control.key === "orderLeftArrow"
          ? -EDITOR_STEP_DELTA
          : control.key === "orderRightArrow"
            ? EDITOR_STEP_DELTA
            : control.key === "orderAllRightArrow"
              ? EDITOR_JUMP_DELTA
              : undefined;
      this.attachButton(
        sprite,
        actionFor(control.key),
        delta === undefined ? undefined : () => this.canReorder(delta),
      );
      if (delta !== undefined) this.arrowControls.push({ node: sprite, delta });
    }
    insertLabel.anchor.set(0.5, 0.5);
    insertLabel.position.set(layout.insertLabelCenter.x, layout.insertLabelCenter.y);
    insertLabel.eventMode = "none";
    this.addChild(insertLabel);

  }

  private buildSortControls(): void {
    const sort = pointSprite(this.textures.sortIcons[this.sortOrder]);
    sort.label = "partyEditorControl:sort";
    sort.anchor.set(0.5, 0.5);
    const labelButton = this.style === 0 ? this.textures.sortLabelButton : undefined;
    if (this.style === 0 && labelButton === undefined) {
      throw new Error("PartyEditorNode: style 0 requires its localized Sort button");
    }
    const layout = editorSortColumnLayout(
      { w: sort.width, h: sort.height },
      labelButton?.contentSize,
    );
    sort.position.set(layout.iconCenter.x, layout.iconCenter.y);
    this.sortSprite = sort;
    this.attachButton(sort, () => this.callbacks.onSortCycle());
    if (labelButton !== undefined && layout.labelCenter !== undefined) {
      labelButton.node.label = "partyEditorControl:sortLabel";
      labelButton.node.position.set(
        layout.labelCenter.x - labelButton.contentSize.w / 2,
        layout.labelCenter.y - labelButton.contentSize.h / 2,
      );
      this.attachButton(
        labelButton.node,
        () => this.callbacks.onSortCycle(),
        undefined,
        labelButton.visibleRect,
      );
    }
  }

  private buildPartyHeading(text: string): void {

    const heading = makeTtfLabel(text, editorPartyHeadingFont(), {
      fill: MANAGEMENT_TITLE_COLOR,
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    heading.label = "partyEditorPartyHeading";
    heading.anchor.set(0, 0.5);
    const anchor = editorPartyHeadingAnchor();
    heading.position.set(anchor.x, anchor.y);
    heading.eventMode = "none";
    this.addChild(heading);
  }

  /** Style 0 prepends the reserve CFlow's insertion boundary to the real reserve cards. The row
   * only exists at all while at least one real reserve does (`addNewCflowNodes`'s
   * `[items count] != 0` gate); style 1 omits it entirely. */
  private buildReservesRow(): void {
    this.reservesCarousel.label = "editorReservesRow";
    this.reservesCarousel.eventMode = "none";
    this.reservesCarousel.sortableChildren = true;
    this.reservesCarousel.position.set(this.reservesCenter.x, this.reservesCenter.y);
    this.addChild(this.reservesCarousel);
    this.rebuildReserveCards();
    this.applyReserveCarouselLayout();
  }

  private hasReserveRow(): boolean {
    return editorHasReserveRow(this.style, this.reserveMembers.length);
  }

  private syncReserveRow(): void {
    if (this.hasReserveRow()) {
      if (this.reservesCarousel.parent !== this) this.buildReservesRow();
      return;
    }
    for (const card of this.reserveCards) this.destroyCard(card);
    this.reserveCards.length = 0;
    this.reservesCarousel.removeChildren();
    this.reservesCarousel.parent?.removeChild(this.reservesCarousel);
  }

  private buildRemoveAll(): void {
    const remove = pointSprite(this.textures.removeAll);
    remove.label = "partyEditorControl:removeAll";
    remove.anchor.set(0.5, 0.5);
    const center = editorRemoveAllCenter();
    remove.position.set(center.x, center.y);
    this.attachButton(remove, () => this.callbacks.onRemoveAll());
  }

  /** The editable nil-slot hint card (§4): background frame + emptySlotHeads/emptySlotArrows at
   *  anchor (0,0) — the card's bottom-left in Cocos, i.e. lower-left growing up; in this
   *  center-origin Y-down card frame both sprites pin to the card's bottom-left corner. */
  private buildPlaceholderCard(inBattingOrder: boolean): { node: Container; background: Sprite } {
    const root = new Container();
    root.label = `editorPlaceholder:${inBattingOrder ? "batting" : "reserves"}`;
    const background = pointSprite(inBattingOrder ? this.textures.cardBackground : this.textures.reserveCardBackground);
    background.anchor.set(0.5, 0.5);
    root.addChild(background);
    const heads = pointSprite(this.textures.emptySlotHeads);
    heads.anchor.set(0, 1);
    heads.position.set(-MANAGEMENT_CARD_SIZE_PT / 2, MANAGEMENT_CARD_SIZE_PT / 2);
    root.addChild(heads);
    const arrows = pointSprite(this.textures.emptySlotArrows);
    arrows.position.set(-MANAGEMENT_CARD_SIZE_PT / 2, MANAGEMENT_CARD_SIZE_PT / 2);
    // `arrowSprite setFlipY: !inBattingOrder` — Cocos flips the texture IN PLACE (same rect).
    // Pixi equivalent: negate scale.y and swap the anchor's y lane so the drawn rect is unchanged.
    if (inBattingOrder) {
      arrows.anchor.set(0, 1);
    } else {
      arrows.anchor.set(0, 0);
      arrows.scale.y *= -1;
    }
    root.addChild(arrows);
    return { node: root, background };
  }

  private attachCardPerspective(node: Container): CflowPerspectiveFilter {
    const perspective = new CflowPerspectiveFilter(
      node,
      this,
      { w: SCREEN_W, h: SCREEN_H },
      DISPLAY_MODE,
    );
    return perspective;
  }

  private destroyCard(card: EditorCard): void {
    card.perspective.destroy(false);
    card.node.destroy({ children: true });
  }

  private buildClose(): void {
    const close = pointSprite(this.textures.close);
    close.label = "partyEditorClose";
    // Keep the visual above the style-1 batting carousel; its touch is arbitrated by the root
    // (`attachButton` below), which owns the whole `touchableNodes` list.
    close.zIndex = 1;
    close.anchor.set(1, 0);
    close.position.set(SCREEN_W + unscaledIdiomPt(-10, DISPLAY_MODE), unscaledIdiomPt(10, DISPLAY_MODE));
    const localBounds = close.getLocalBounds();
    const contentRect = {
      x: localBounds.x,
      y: localBounds.y,
      w: localBounds.width,
      h: localBounds.height,
    };
    this.attachButton(close, () => this.callbacks.onClose(), undefined, contentRect);
    const rect = this.controlRectInRoot(this.controls[this.controls.length - 1]!);
    const finalized = minimumHitRectLocal(rect, { x: 1, y: 1 });
    this.closeRect = new Rectangle(finalized.x, finalized.y, finalized.w, finalized.h);
  }

  /**
   * Adds one native `touchableNodes` member. MonsterManagement owns one delegate for the complete
   * list; the children stay inert so overlapping 55pt regions are resolved by source-nearest
   * centre rather than Pixi paint order.
   */
  private attachButton(
    node: Container,
    action: () => void,
    enabled: (() => boolean) | undefined = undefined,
    authoredContentRect?: { readonly x: number; readonly y: number; readonly w: number; readonly h: number },
  ): void {
    const bounds = node.getLocalBounds();
    const contentRect = authoredContentRect ?? {
      x: bounds.x,
      y: bounds.y,
      w: bounds.width,
      h: bounds.height,
    };
    node.eventMode = "none";
    node.cursor = "pointer";
    this.addChild(node);
    this.controls.push({
      node,
      action,
      ...(enabled === undefined ? {} : { enabled }),
      contentRect,
    });
  }

  private controlRectInRoot(control: EditorControl): { x: number; y: number; w: number; h: number } {
    const { node, contentRect } = control;
    const corners = [
      this.toLocal(node.toGlobal({ x: contentRect.x, y: contentRect.y })),
      this.toLocal(node.toGlobal({ x: contentRect.x + contentRect.w, y: contentRect.y })),
      this.toLocal(node.toGlobal({ x: contentRect.x, y: contentRect.y + contentRect.h })),
      this.toLocal(node.toGlobal({ x: contentRect.x + contentRect.w, y: contentRect.y + contentRect.h })),
    ];
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  private controlAt(point: Readonly<{ x: number; y: number }>): EditorControl | undefined {
    return nearestEditorControl(
      this.controls
        .filter(({ enabled }) => enabled?.() !== false)
        .map((control) => ({
          value: control,
          rect: this.controlRectInRoot(control),
        })),
      point,
    );
  }

  private canReorder(delta: number): boolean {
    return editorArrowEnabled(this.members, this.centeredMemberIndex(), delta);
  }

  private updateArrowEnablement(): void {
    for (const { node, delta } of this.arrowControls) {
      const enabled = this.canReorder(delta);
      node.tint = enabled ? 0xffffff : 0x646464;
      node.cursor = enabled ? "pointer" : "default";
    }
  }

  private updateSelectionSummaries(dtMs: number): void {
    const battingIndex = showingCoverflowIndex(this.selectedIndex, this.slotCount());
    this.battingSummary.setEntry(this.cards[battingIndex]?.member);
    const reserveIndex = this.hasReserveRow()
      ? showingCoverflowIndex(this.selectedReserveIndex, this.reserveSlotCount())
      : -1;
    this.reservesSummary.setEntry(
      reserveIndex < 0 ? undefined : this.reserveCards[reserveIndex]?.member,
    );
    this.battingSummary.update(dtMs);
    this.reservesSummary.update(dtMs);
  }

  /** Total carousel slot count — the fixed `battingOrderArray` size, nil slots included. */
  private slotCount(): number {
    return Math.max(this.battingOrderSlots, 1);
  }

  private reserveSlotCount(): number {
    return this.hasReserveRow() ? this.reserveMembers.length + 1 : 0;
  }

  private rebuildCards(): void {
    for (const card of this.cards) this.destroyCard(card);
    this.cards.length = 0;
    this.carousel.removeChildren();
    for (const member of this.members) {
      if (member === undefined) {
        const { node, background } = this.buildPlaceholderCard(true);
        node.eventMode = "none";
        const perspective = this.attachCardPerspective(node);
        this.cards.push({
          node,
          background: perspective.projectedSprite(background),
          perspective,
        });
        this.carousel.addChild(node);
      } else {
        const card = this.buildCard(member);
        this.cards.push(card);
        this.carousel.addChild(card.node);
      }
    }
  }

  private rebuildReserveCards(): void {
    for (const card of this.reserveCards) this.destroyCard(card);
    this.reserveCards.length = 0;
    this.reservesCarousel.removeChildren();


    const placeholder = this.buildPlaceholderCard(false);
    placeholder.node.eventMode = "none";
    const placeholderPerspective = this.attachCardPerspective(placeholder.node);
    this.reserveCards.push({
      node: placeholder.node,
      background: placeholderPerspective.projectedSprite(placeholder.background),
      perspective: placeholderPerspective,
    });
    this.reservesCarousel.addChild(placeholder.node);
    for (const member of this.reserveMembers) {
      const card = this.buildCard(member, false);
      this.reserveCards.push(card);
      this.reservesCarousel.addChild(card.node);
    }
  }

  private buildCard(member: EditorMemberModel, inBattingOrder = true): EditorCard {
    const root = new Container();
    root.label = `editorCard:${member.instanceId}`;
    root.eventMode = "none";
    root.sortableChildren = true;

    const background = pointSprite(
      inBattingOrder ? this.textures.cardBackground : this.textures.reserveCardBackground,
    );
    background.anchor.set(0.5, 0.5);
    root.addChild(background);

    const monsterTexture = this.textures.monsterByShortType.get(member.shortType);
    if (monsterTexture) {
      const monster = pointSprite(monsterTexture);
      monster.anchor.set(0.5, 0.5);
      const rendererScale = member.rendererScale ?? 1;
      monster.scale.set(monster.scale.x * rendererScale, monster.scale.y * rendererScale);
      const fit = Math.min(1, MANAGEMENT_CARD_SIZE_PT / monster.width, MANAGEMENT_CARD_SIZE_PT / monster.height);
      monster.scale.set(monster.scale.x * fit, monster.scale.y * fit);
      root.addChild(monster);
    }

    if (member.dead) {
      const ko = makeTtfLabel("K.O.", unscaledIdiomPt(MANAGEMENT_KO_FONT_PT, DISPLAY_MODE), { outline: false });
      ko.anchor.set(0.5, 0.5);
      ko.zIndex = 2;
      root.addChild(ko);
    }

    const elementTexture = this.textures.elementByName.get(member.element);
    const badge = elementTexture ? pointSprite(elementTexture) : new Sprite(Texture.EMPTY);
    badge.anchor.set(1, 1);
    badge.position.set(MANAGEMENT_CARD_SIZE_PT / 2, MANAGEMENT_CARD_SIZE_PT / 2);
    badge.zIndex = 3;
    root.addChild(badge);
    if (member.soulStoneElement !== undefined) {
      const itemTexture = this.textures.soulStoneByElement.get(member.soulStoneElement);
      if (itemTexture === undefined) {
        throw new Error(
          `PartyEditorNode: missing ${member.soulStoneElement} Soul Stone item texture`,
        );
      }
      const item = buildManagementItemBadge(itemTexture);
      item.zIndex = 3;
      root.addChild(item);
    }
    const injury = member.injury === undefined
      ? undefined
      : this.buildInjury(member.injury);
    if (injury !== undefined) {
      root.addChild(injury.root, injury.label);
      this.updateInjury(injury, Date.now() / 1000);
    }
    const perspective = this.attachCardPerspective(root);
    if (injury !== undefined) {
      injury.color.mask = null;
      injury.mask?.parent?.removeChild(injury.mask);
      injury.mask?.destroy();
      injury.mask = undefined;
      injury.perspective = perspective;
      this.updateInjury(injury, Date.now() / 1000);
    }
    return {
      member,
      node: root,
      background: perspective.projectedSprite(background),
      badge: perspective.projectedSprite(badge),
      perspective,
      ...(injury === undefined ? {} : { injury }),
    };
  }

  private buildInjury(
    injury: Readonly<{ injureTime: number; healTime: number }>,
  ): NonNullable<EditorCard["injury"]> {
    if (this.textures.injured === undefined || this.textures.injuredBw === undefined) {
      throw new Error("PartyEditorNode: injured member requires injured and injured_bw textures");
    }
    const root = new Container();
    root.label = "editorInjury";
    root.zIndex = 3;
    const bw = pointSprite(this.textures.injuredBw);
    bw.anchor.set(0, 0);
    const color = pointSprite(this.textures.injured);
    color.anchor.set(0, 0);
    const mask = new Graphics();
    color.mask = mask;
    root.addChild(bw, color, mask);
    root.position.set(
      MANAGEMENT_CARD_SIZE_PT / 2 - bw.width,
      -MANAGEMENT_CARD_SIZE_PT / 2,
    );
    root.hitArea = new Rectangle(0, 0, bw.width, bw.height);
    const label = makeTtfLabel("", unscaledIdiomPt(20, DISPLAY_MODE), {
      outline: true,
    });
    label.label = "editorInjuryTimer";
    label.anchor.set(0.5, 0.5);
    label.zIndex = 3;
    return {
      root,
      color,
      mask,
      label,
      injureTime: injury.injureTime,
      healTime: injury.healTime,
    };
  }

  private updateInjuries(nowSeconds: number): void {
    for (const card of [...this.cards, ...this.reserveCards]) {
      if (card.injury !== undefined) this.updateInjury(card.injury, nowSeconds);
    }
  }

  private updateInjury(
    injury: NonNullable<EditorCard["injury"]>,
    nowSeconds: number,
  ): void {
    const remainingSeconds = Math.trunc(injury.healTime - nowSeconds);
    const visible = remainingSeconds > 0;
    injury.root.visible = visible;
    injury.label.visible = visible;
    if (!visible) return;
    const minutes = Math.trunc(remainingSeconds / 60);
    const seconds = remainingSeconds % 60;
    injury.label.text = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    const duration = injury.healTime - injury.injureTime;
    const progress = duration <= 0
      ? 1
      : Math.max(0, Math.min(1, (nowSeconds - injury.injureTime) / duration));
    const width = injury.color.width;
    const height = injury.color.height;
    if (injury.perspective !== undefined) {
      injury.perspective.setVerticalReveal(injury.color, progress);
    } else {
      injury.mask?.clear()
        .rect(0, height * (1 - progress), width, height * progress)
        .fill(0xffffff);
    }
  }

  private applyCarouselLayout(): void {
    const presented = this.presentedIndex();
    this.cards.forEach(({ node, background, perspective }, index) => {
      const layout = coverflowLayout(index, presented);
      node.visible = layout.visible;
      node.position.set(layout.x, 0);
      node.alpha = 1;
      background.alpha = layout.opacity / 255;
      node.scale.set(1);
      perspective.setOrbitDegrees(layout.orbitDeg);
      node.zIndex = layout.zIndex;
    });
  }

  private applyReserveCarouselLayout(): void {
    if (!this.hasReserveRow()) return;
    const presented = this.presentedReserveIndex();
    this.reserveCards.forEach(({ node, background, perspective }, index) => {
      const layout = coverflowLayout(index, presented);
      node.visible = layout.visible;
      node.position.set(layout.x, 0);
      node.alpha = 1;
      background.alpha = layout.opacity / 255;
      node.scale.set(1);
      perspective.setOrbitDegrees(layout.orbitDeg);
      node.zIndex = layout.zIndex;
    });
  }










  private flowAt(x: number, y: number): ActiveTouch["owner"] {
    const inFlow = (cards: readonly EditorCard[], centre: { x: number; y: number }): boolean =>
      pointInCoverflowBounds({
        x,
        y,
        originX: centre.x,
        originY: centre.y,
        bounds: coverflowTouchBoundsX(
          cards.map(({ node }) => ({ visible: node.visible, x: node.position.x })),
        ),
      });
    if (inFlow(this.cards, this.carouselCenter)) return "batting";
    if (this.hasReserveRow() && inFlow(this.reserveCards, this.reservesCenter)) return "reserves";
    return "other";
  }





  private rowAt(x: number, y: number): ActiveTouch["owner"] {
    if (editorPointInCflowStrip({ x, y }, this.carouselCenter, MANAGEMENT_CARD_SIZE_PT)) {
      return "batting";
    }
    if (
      this.hasReserveRow() &&
      editorPointInCflowStrip({ x, y }, this.reservesCenter, MANAGEMENT_CARD_SIZE_PT)
    ) {
      return "reserves";
    }
    return "other";
  }

  private readonly onPointerDown = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (this.closed || this.activeTouch) return;
    const point = event.getLocalPosition(this);
    const control = this.controlAt(point);
    const owner = control === undefined ? this.flowAt(point.x, point.y) : "control";
    this.activeTouch = {
      pointerId: event.pointerId,
      owner,
      ...(control === undefined ? {} : { control }),
      startX: point.x,
      startY: point.y,
      selectionTouch: true,
      anchorIndex: owner === "reserves"
        ? this.actualSelectedReserveIndex
        : this.actualSelectedIndex,
    };
  };

  private readonly onPointerMove = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    const touch = this.activeTouch;
    if (!touch || touch.pointerId !== event.pointerId) return;
    const point = event.getLocalPosition(this);
    touch.selectionTouch = updateSelectionTouchState({
      selectable: touch.selectionTouch,
      startX: touch.startX,
      startY: touch.startY,
      currentX: point.x,
      currentY: point.y,
      threshold: SELECTION_DISTANCE_PT,
    });
    if (touch.owner === "control" || touch.owner === "other") return;
    const currentSelected = touch.owner === "reserves"
      ? this.selectedReserveIndex
      : this.selectedIndex;
    const currentActual = touch.owner === "reserves"
      ? this.actualSelectedReserveIndex
      : this.actualSelectedIndex;
    const nextIndex = draggedCoverflowIndex({
      anchorIndex: touch.anchorIndex,
      startX: touch.startX,
      currentX: point.x,
      selectedIndex: currentSelected,
      actualSelectedIndex: currentActual,
      itemCount: touch.owner === "reserves" ? this.reserveSlotCount() : this.slotCount(),
    });
    if (touch.owner === "reserves") {
      this.actualSelectedReserveIndex = nextIndex;
      this.applyReserveCarouselLayout();
    } else {
      this.actualSelectedIndex = nextIndex;
      this.applyCarouselLayout();
    }
  };

  private readonly onPointerUp = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    const touch = this.activeTouch;
    if (!touch || touch.pointerId !== event.pointerId) return;
    this.activeTouch = undefined;
    const point = event.getLocalPosition(this);
    if (touch.owner === "control") {


      const control = this.controlAt(point);
      if (control !== undefined) {
        this.callbacks.onClick();
        control.action();
      }
      return;
    }
    if (touch.owner === "other") return;
    const selectionTouch = updateSelectionTouchState({
      selectable: touch.selectionTouch,
      startX: touch.startX,
      startY: touch.startY,
      currentX: point.x,
      currentY: point.y,
      threshold: SELECTION_DISTANCE_PT,
    });

    const releaseRow = this.rowAt(point.x, point.y);
    if (!selectionTouch && this.style === 0 && releaseRow !== touch.owner) {
      if (touch.owner === "batting" && releaseRow === "reserves") {
        const fromIndex = showingCoverflowIndex(this.actualSelectedIndex, this.slotCount());
        if (this.cards[fromIndex]?.member !== undefined) {
          // Destination is the visual insertion-boundary index directly: 0 before first, 1 after
          // first, and so on.
          this.callbacks.onMoveBattingToReserves(
            fromIndex,
            this.centeredReserveIndex(),
          );
          return;
        }
      }
      if (touch.owner === "reserves" && releaseRow === "batting") {
        const reserveIndex = showingCoverflowIndex(
          this.actualSelectedReserveIndex,
          this.reserveSlotCount(),
        );
        if (this.reserveCards[reserveIndex]?.member !== undefined) {
          this.callbacks.onMoveReserveToBatting(reserveIndex - 1, this.centeredMemberIndex());
          return;
        }
      }
    }

    if (!selectionTouch) {
      if (touch.owner === "reserves") {
        this.actualSelectedReserveIndex = showingCoverflowIndex(
          this.actualSelectedReserveIndex,
          this.reserveSlotCount(),
        );
      } else {
        this.actualSelectedIndex = showingCoverflowIndex(
          this.actualSelectedIndex,
          this.slotCount(),
        );
      }
      return;
    }

    const reserveRow = touch.owner === "reserves";
    const rowCards = reserveRow ? this.reserveCards : this.cards;
    const rowSelected = reserveRow ? this.selectedReserveIndex : this.selectedIndex;
    const rowCount = reserveRow ? this.reserveSlotCount() : this.slotCount();
    const hit = this.hitCardAtGlobal(
      rowCards,
      rowSelected,
      rowCount,
      event.global.x,
      event.global.y,
    );
    if (hit === null) return;
    const showing = showingCoverflowIndex(rowSelected, rowCount);



    if (hit !== showing) {
      if (reserveRow) this.actualSelectedReserveIndex = hit;
      else this.actualSelectedIndex = hit;
      return;
    }
    const card = rowCards[hit]!;
    if (card.member !== undefined && this.pointInInjury(card, event.global.x, event.global.y)) {
      this.callbacks.onInjury(card.member.instanceId);
      return;
    }
    if (card.member !== undefined && this.pointInBadge(card, event.global.x, event.global.y)) {
      this.callbacks.onElementHelp(card.member.element);
      return;
    }
    // A centered nil placeholder has no info popup (`notifyTouchOnUserObject:` returns on nil).
    if (card.member !== undefined) this.callbacks.onInspect(card.member.instanceId);
  };

  private readonly onPointerCancel = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (!this.activeTouch || this.activeTouch.pointerId !== event.pointerId) return;
    this.activeTouch = undefined;
    this.actualSelectedIndex = showingCoverflowIndex(this.actualSelectedIndex, this.slotCount());
    if (this.hasReserveRow()) {
      this.actualSelectedReserveIndex = showingCoverflowIndex(
        this.actualSelectedReserveIndex,
        this.reserveSlotCount(),
      );
    }
  };

  private readonly onWheel = (event: FederatedWheelEvent): void => {
    event.stopPropagation();
    if (this.closed || this.activeTouch || event.deltaY === 0) return;
    const point = event.getLocalPosition(this);
    // Desktop-only affordance, but it should answer over the same area a finger can grab.
    const row = this.flowAt(point.x, point.y);
    if (row === "other") return;
    if (row === "reserves") {
      const showing = showingCoverflowIndex(this.selectedReserveIndex, this.reserveSlotCount());
      this.actualSelectedReserveIndex = Math.min(
        this.reserveSlotCount() - 1,
        Math.max(0, showing + Math.sign(event.deltaY)),
      );
    } else {
      const showing = showingCoverflowIndex(this.selectedIndex, this.slotCount());
      this.actualSelectedIndex = Math.min(
        this.slotCount() - 1,
        Math.max(0, showing + Math.sign(event.deltaY)),
      );
    }
  };

  private hitCardAtGlobal(
    cards: readonly EditorCard[],
    selectedIndex: number,
    count: number,
    globalX: number,
    globalY: number,
  ): number | null {
    const showing = showingCoverflowIndex(selectedIndex, count);
    const order = cards
      .map(({ node }, index) => ({ node, index, priority: index === showing ? 100 : node.zIndex }))
      .sort((a, b) => b.priority - a.priority);
    for (const { node, index } of order) {
      if (!node.visible) continue;
      const bounds = node.getBounds();
      if (globalX >= bounds.x && globalX <= bounds.x + bounds.width && globalY >= bounds.y && globalY <= bounds.y + bounds.height) {
        return index;
      }
    }
    return null;
  }

  private pointInBadge(card: EditorCard, globalX: number, globalY: number): boolean {
    if (!card.node.visible || card.badge === undefined) return false;
    const bounds = card.badge.getBounds();
    return globalX >= bounds.x && globalX <= bounds.x + bounds.width && globalY >= bounds.y && globalY <= bounds.y + bounds.height;
  }

  private pointInInjury(card: EditorCard, globalX: number, globalY: number): boolean {
    if (!card.node.visible || card.injury === undefined || !card.injury.root.visible) return false;
    const bounds = card.injury.root.getBounds();
    return globalX >= bounds.x && globalX <= bounds.x + bounds.width &&
      globalY >= bounds.y && globalY <= bounds.y + bounds.height;
  }
}
