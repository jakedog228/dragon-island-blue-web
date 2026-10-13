import { setOwnedTexture } from "@dib/renderer";



import {
  Container,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Text,
} from "pixi.js";
import {
  Box,
  makeTtfLabel,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { Element } from "@dib/gamedata";
import { prepareMenuButton2 } from "../ui/menuButton2.js";
import { buildManagementItemBadge } from "../ui/managementItemBadge.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { unscaledIdiomPt } from "../displayMode.js";
import { SCREEN_H, SCREEN_W } from "./displayShared.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import {
  MANAGEMENT_BACKGROUND_SIZE_PT,
  MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX,
  MANAGEMENT_BACKGROUND_TINT,
  MANAGEMENT_CARD_SIZE_PT,
  MANAGEMENT_CAROUSEL_COCOS_Y_IPAD,
  MANAGEMENT_CAROUSEL_COCOS_Y_IPHONE,
  MANAGEMENT_DETAIL_COCOS_Y_IPAD,
  MANAGEMENT_DETAIL_COCOS_Y_IPHONE,
  MANAGEMENT_KO_FONT_PT,
  MANAGEMENT_LEVEL_FONT_PT,
  MANAGEMENT_STAR_COUNT_FONT_PT,
  MANAGEMENT_STAR_TEXT_GAP_PT,
  MANAGEMENT_TITLE_COCOS_Y,
  MANAGEMENT_TITLE_COLOR,
  MANAGEMENT_TITLE_FONT_PT,
  advanceCoverflowIndexFrames,
  coverflowProjectedQuad,
  coverflowEaseFrames,
  presentCoverflowIndex,
  coverflowLayout,
  coverflowTouchBoundsX,
  draggedCoverflowIndex,
  evolutionProgressPercent,
  managementDetailOpacity,
  managementSelectionControlsLayout,
  managementSummaryBoxPosition,
  managementStyleConfig,
  nearestManagementTouchable,
  pointInCoverflowBounds,
  showingCoverflowIndex,
  updateSelectionTouchState,
  type ManagementStyle,
} from "./monsterManagementMath.js";
import {
  CflowPerspectiveFilter,
  type CflowProjectedSprite,
} from "./cflowPerspectiveFilter.js";


let SELECTION_DISTANCE_PT = unscaledIdiomPt(15, DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  SELECTION_DISTANCE_PT = unscaledIdiomPt(15, DISPLAY_MODE);
});
const MANAGEMENT_Z_INDEX = 40;

export interface MonsterManagementEntry {
  id: string;
  shortType: string;
  level: number;
  stars: number;
  element: Element;
  rendererScale?: number;
  evolveLevel?: number;
  previousEvolveLevel?: number;


  dead?: boolean;
  soulStoneElement?: Element;
}

export interface MonsterManagementNodeOpts {
  assets: AssetLibrary;
  /** Required for styles 2/3's source MenuButton2 text controls. */
  scale9?: Scale9SpritesData;
  strings: LocalizedStrings;
  /** Styles 2/3 are source selection pickers; style 4 is the battle view-only screen. */
  style: ManagementStyle;
  entries: readonly MonsterManagementEntry[];
  onClose: () => void;
  onInspect: (id: string) => void;
  /** Style-2 confirmation. Centering or inspecting a card never commits it. */
  onSelect?: (id: string) => void;
  selectButtonText?: string;
  cancelButtonText?: string;


  onElementHelp: (element: Element) => void;
}

interface ManagementCard {
  entry: MonsterManagementEntry;
  node: Container;
  background: CflowProjectedSprite;
  badge: CflowProjectedSprite;
  perspective: CflowPerspectiveFilter;
}

interface PreparedTextControl {
  root: Container;
  label: Text;
  layoutContentSize: { w: number; h: number };
  visibleRect: { x: number; y: number; w: number; h: number };
}

interface PreparedSelectionControls {
  select: PreparedTextControl;
  cancel?: PreparedTextControl;
}

interface ActiveTouch {
  pointerId: number;
  owner: "controls" | "coverflow" | "screen";
  startX: number;
  startY: number;
  /** `CCTouch.selectionTouchState`: latches false after ANY excursion beyond 15 source points,
   * even if the pointer later returns near its start before release. */
  selectionTouch: boolean;
  anchorIndex: number;
}

export interface MonsterManagementDebugState {
  open: true;
  style: ManagementStyle;
  editable: boolean;
  title: string;
  backgroundTint: number;
  backgroundAlpha: number;
  selectedIndex: number;
  actualSelectedIndex: number;
  /** The lane the cards were actually drawn from this frame; see `presentCoverflowIndex`. */
  presentedIndex: number;
  showingIndex: number;
  showingId: string;
  detail: { summary: string; evolution: string | null; summaryAlpha: number; evolutionAlpha: number };
  closeCenter: { x: number; y: number };
  selectCenter?: { x: number; y: number };
  cards: Array<{
    id: string;
    index: number;
    center: { x: number; y: number };
    badgeCenter: { x: number; y: number };
    visible: boolean;
    /** Source `setOpacity:` receiver: the background CCSprite only. */
    alpha: number;
    contentAlpha: number;
    scaleX: number;
    orbitDeg: number;
    projectedQuad: ReturnType<typeof coverflowProjectedQuad>;
  }>;
}

/** Async factory keeps all shipped-asset validation ahead of mounting the modal node. */
export async function createMonsterManagementNode(opts: MonsterManagementNodeOpts): Promise<MonsterManagementNode> {
  if (opts.style !== 2 && opts.style !== 3 && opts.style !== 4) {
    throw new Error(
      `MonsterManagementNode style ${opts.style} is not ported by this node`,
    );
  }
  if (opts.entries.length === 0) {
    throw new Error(`MonsterManagementNode style ${opts.style} requires at least one entry`);
  }
  if (opts.style === 2 || opts.style === 3) {
    if (!opts.onSelect) throw new Error(`MonsterManagementNode style ${opts.style} requires onSelect`);
    if (!opts.scale9) throw new Error(`MonsterManagementNode style ${opts.style} requires Scale9Sprites data`);
    if (!opts.selectButtonText || (opts.style === 2 && !opts.cancelButtonText)) {
      throw new Error(`MonsterManagementNode style ${opts.style} requires its source button text`);
    }
  }
  const [
    backgroundTexture,
    closeTexture,
    cardTexture,
    general,
    monsterpedia,
    inventoryItems,
    ...monsterTextures
  ] = await Promise.all([
    opts.assets.sprite("MMScreen"),
    opts.style === 4 ? opts.assets.sprite("PopupMenuCloseButton-hd") : Promise.resolve(undefined),
    opts.assets.sprite("inBattingOrderBkg-hd"),
    opts.assets.atlas("General-hd"),
    // initWithSelectionList retains `MonsterpediaFrames`; rarityStar.png lives there, while the
    // per-card Element<Name>.png badges live in General-hd.
    opts.assets.atlas("MonsterpediaFrames-hd"),
    opts.assets.atlas("InventoryItemFrames-hd"),
    ...opts.entries.map((entry) => opts.assets.sprite(`${entry.shortType}-hd`)),
  ]);
  const rarityStar = monsterpedia.textures["rarityStar.png"];
  if (!rarityStar) throw new Error("MonsterManagementNode: MonsterpediaFrames-hd is missing rarityStar.png");
  const elements = opts.entries.map((entry) => {
    const texture = general.textures[`Element${entry.element}.png`];
    if (!texture) throw new Error(`MonsterManagementNode: General-hd is missing Element${entry.element}.png`);
    return texture;
  });
  const selectionControls = opts.style === 2 || opts.style === 3
    ? await prepareSelectionControls(
        opts.assets,
        opts.scale9!,
        opts.selectButtonText!,
        opts.style === 2 ? opts.cancelButtonText! : undefined,
      )
    : undefined;
  return new MonsterManagementNode(
    opts,
    backgroundTexture,
    closeTexture,
    selectionControls,
    cardTexture,
    rarityStar,
    monsterTextures,
    elements,
    inventoryItems,
  );
}

async function prepareTextControl(
  assets: AssetLibrary,
  scale9: Scale9SpritesData,
  text: string,
): Promise<PreparedTextControl> {
  const layout = managementSelectionControlsLayout(DISPLAY_MODE);
  const label = makeTtfLabel(text, layout.fontPt, { outline: false });
  const prepared = await prepareMenuButton2({
    assets,
    scale9,
    label,
  });
  label.position.set(0, 0);
  return {
    root: prepared.node,
    label,
    layoutContentSize: prepared.layoutContentSize,
    visibleRect: prepared.visibleRect,
  };
}

async function prepareSelectionControls(
  assets: AssetLibrary,
  scale9: Scale9SpritesData,
  selectText: string,
  cancelText: string | undefined,
): Promise<PreparedSelectionControls> {
  const [select, cancel] = await Promise.all([
    prepareTextControl(assets, scale9, selectText),
    cancelText === undefined ? Promise.resolve(undefined) : prepareTextControl(assets, scale9, cancelText),
  ]);
  select.root.label = "monsterManagement:select";
  select.label.label = "monsterManagement:selectLabel";
  if (cancel) {
    cancel.root.label = "monsterManagement:cancel";
    cancel.label.label = "monsterManagement:cancelLabel";
  }
  return { select, ...(cancel === undefined ? {} : { cancel }) };
}

export class MonsterManagementNode extends Container {
  private readonly strings: LocalizedStrings;
  private readonly style: ManagementStyle;
  private readonly entries: readonly MonsterManagementEntry[];
  private readonly closeCallback: () => void;
  private readonly inspectCallback: (id: string) => void;
  private readonly selectCallback: ((id: string) => void) | undefined;
  private readonly elementHelpCallback: (element: Element) => void;
  private readonly rarityStarTexture: Texture;
  private readonly cards: ManagementCard[] = [];
  private readonly background: Sprite;
  private readonly closeButton: Container | undefined;
  private readonly selectionControls: PreparedSelectionControls | undefined;
  private readonly selectionControlsBox: Box | undefined;
  private readonly carousel = new Container();
  private readonly detailRoot = new Container();
  private readonly titleLabel: Text;
  private summaryNode: Container | undefined;
  private evolutionLabel: Text | undefined;
  private summaryText = "";
  private evolutionText: string | null = null;
  private selectedIndex = 0;
  private actualSelectedIndex = 0;
  private detailIndex = -1;
  private detailElapsedMs = 0;
  /** Sub-frame presentation time carried between ticks so the CFlow blend runs at the source's
   *  fixed 60fps rather than the browser's refresh rate (see COVERFLOW_FRAME_MS). */
  private easeCarryMs = 0;
  private activeTouch: ActiveTouch | undefined;
  private closed = false;

  constructor(
    opts: MonsterManagementNodeOpts,
    backgroundTexture: Texture,
    closeTexture: Texture | undefined,
    selectionControls: PreparedSelectionControls | undefined,
    cardTexture: Texture,
    rarityStarTexture: Texture,
    monsterTextures: Texture[],
    elementTextures: Texture[],
    inventoryItems: Awaited<ReturnType<AssetLibrary["atlas"]>>,
  ) {
    super();
    const config = managementStyleConfig(opts.style);
    this.label = `monsterManagement:style${opts.style}`;
    this.zIndex = MANAGEMENT_Z_INDEX;
    this.sortableChildren = true;
    this.strings = opts.strings;
    this.style = opts.style;
    this.entries = [...opts.entries];
    this.closeCallback = opts.onClose;
    this.inspectCallback = opts.onInspect;
    this.selectCallback = opts.onSelect;
    this.elementHelpCallback = opts.onElementHelp;
    this.rarityStarTexture = rarityStarTexture;
    this.selectionControls = selectionControls;

    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, SCREEN_W, SCREEN_H);
    this.on("pointerdown", this.onPointerDown);
    this.on("pointermove", this.onPointerMove);
    this.on("pointerup", this.onPointerUp);
    this.on("pointerupoutside", this.onPointerUp);
    this.on("pointercancel", this.onPointerCancel);
    this.on("pointertap", this.swallowTap);
    this.on("wheel", this.onWheel);

    if (
      backgroundTexture.width < MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.w ||
      backgroundTexture.height < MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.h
    ) {
      throw new Error(
        `MMScreen is ${backgroundTexture.width}x${backgroundTexture.height}px; ` +
          `the source texture rect requires ${MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.w}x${MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.h}`,
      );
    }


    this.background = new Sprite(new Texture({
      source: backgroundTexture.source,
      frame: new Rectangle(
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.x,
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.y,
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.w,
        MANAGEMENT_BACKGROUND_TEXTURE_RECT_PX.h,
      ),
    }));
    setOwnedTexture(this.background, this.background.texture);
    this.background.width = MANAGEMENT_BACKGROUND_SIZE_PT.w;
    this.background.height = MANAGEMENT_BACKGROUND_SIZE_PT.h;
    this.background.position.set(
      (SCREEN_W - MANAGEMENT_BACKGROUND_SIZE_PT.w) / 2,
      (SCREEN_H - MANAGEMENT_BACKGROUND_SIZE_PT.h) / 2,
    );
    this.background.tint = MANAGEMENT_BACKGROUND_TINT;
    this.background.zIndex = -9999;
    this.addChild(this.background);

    const carouselCocosY = DISPLAY_MODE === "ipad"
      ? MANAGEMENT_CAROUSEL_COCOS_Y_IPAD
      : MANAGEMENT_CAROUSEL_COCOS_Y_IPHONE;
    // CFlow's wrapper position is the bottom-center anchor of its 80pt background. Port card
    // contents are center-origin, so place that center half a card above the source baseline.
    this.carousel.position.set(
      SCREEN_W / 2,
      SCREEN_H - carouselCocosY - MANAGEMENT_CARD_SIZE_PT / 2,
    );
    this.carousel.sortableChildren = true;
    this.addChild(this.carousel);

    this.entries.forEach((entry, index) => {
      const card = this.buildCard(
        entry,
        cardTexture,
        monsterTextures[index]!,
        elementTextures[index]!,
        inventoryItems,
      );
      this.cards.push(card);
      this.carousel.addChild(card.node);
    });

    const detailCocosY = DISPLAY_MODE === "ipad"
      ? MANAGEMENT_DETAIL_COCOS_Y_IPAD
      : MANAGEMENT_DETAIL_COCOS_Y_IPHONE;
    this.detailRoot.position.set(SCREEN_W / 2, SCREEN_H - detailCocosY);
    this.addChild(this.detailRoot);


    this.titleLabel = makeTtfLabel(localizedString(this.strings, config.titleKey), MANAGEMENT_TITLE_FONT_PT, {
      fill: MANAGEMENT_TITLE_COLOR,
      outline: false,
    });
    this.titleLabel.anchor.set(0.5, 1);
    this.titleLabel.position.set(SCREEN_W / 2, SCREEN_H - MANAGEMENT_TITLE_COCOS_Y);
    this.addChild(this.titleLabel);


    if (this.style === 2 || this.style === 3) {
      if (!selectionControls) throw new Error(`MonsterManagementNode style ${this.style} controls were not prepared`);
      const rowLayout = managementSelectionControlsLayout(DISPLAY_MODE);
      const controls = new Box({
        horizontal: true,
        positiveAlignDirection: true,
        gap: rowLayout.gapPt,
        roundingScale: rowLayout.roundingScale,
      });
      controls.label = "monsterManagement:selectionControls";
      // Nonnil-text style 2 uses label-sized MenuButton2 nodes, appended tag 3 Select then tag 4
      // Cancel. Chrome overhang stays outside Box measurement.
      controls.addBoxChild(selectionControls.select.root, {
        contentSize: selectionControls.select.layoutContentSize,
      });
      if (selectionControls.cancel) {
        controls.addBoxChild(selectionControls.cancel.root, {
          contentSize: selectionControls.cancel.layoutContentSize,
        });
      }
      const controlsPosition = rowLayout.positionForSize(controls.boxContentSize);
      controls.position.set(controlsPosition.x, controlsPosition.y);
      this.selectionControlsBox = controls;
      this.closeButton = selectionControls.cancel?.root;
      this.addChild(controls);
    } else {
      if (!closeTexture) throw new Error("MonsterManagementNode style 4 close texture was not loaded");
      this.selectionControlsBox = undefined;
      const close = pointSprite(closeTexture);
      close.anchor.set(1, 0);
      close.position.set(
        SCREEN_W + unscaledIdiomPt(-10, DISPLAY_MODE),
        -unscaledIdiomPt(-10, DISPLAY_MODE),
      );
      this.closeButton = close;
      this.addChild(close);
    }

    this.applyCarouselLayout();
    this.rebuildDetail(0);
  }

  private buildCard(
    entry: MonsterManagementEntry,
    backgroundTexture: Texture,
    monsterTexture: Texture,
    elementTexture: Texture,
    inventoryItems: Awaited<ReturnType<AssetLibrary["atlas"]>>,
  ): ManagementCard {
    const root = new Container();
    root.label = `managementCard:${entry.id}`;
    root.eventMode = "none";

    const background = pointSprite(backgroundTexture);
    background.anchor.set(0.5, 0.5);
    root.addChild(background);

    const monster = pointSprite(monsterTexture);
    monster.anchor.set(0.5, 0.5);
    const rendererScale = entry.rendererScale ?? 1;
    monster.scale.set(monster.scale.x * rendererScale, monster.scale.y * rendererScale);


    const fit = Math.min(1, MANAGEMENT_CARD_SIZE_PT / monster.width, MANAGEMENT_CARD_SIZE_PT / monster.height);
    monster.scale.set(monster.scale.x * fit, monster.scale.y * fit);
    root.addChild(monster);

    if (entry.dead) {


      const ko = makeTtfLabel("K.O.", unscaledIdiomPt(MANAGEMENT_KO_FONT_PT, DISPLAY_MODE), { outline: false });
      ko.anchor.set(0.5, 0.5);
      ko.zIndex = 2;
      root.addChild(ko);
    }


    const element = pointSprite(elementTexture);
    element.anchor.set(1, 1);
    element.position.set(MANAGEMENT_CARD_SIZE_PT / 2, MANAGEMENT_CARD_SIZE_PT / 2);
    element.zIndex = 3;
    root.addChild(element);
    if (entry.soulStoneElement !== undefined) {
      const itemTexture = inventoryItems.textures[`${entry.soulStoneElement}SoulStone.png`];
      if (!itemTexture) {
        throw new Error(
          `MonsterManagementNode: InventoryItemFrames-hd is missing ` +
          `${entry.soulStoneElement}SoulStone.png`,
        );
      }
      const item = buildManagementItemBadge(itemTexture);
      item.zIndex = 3;
      root.addChild(item);
    }
    root.sortableChildren = true;
    const perspective = new CflowPerspectiveFilter(
      root,
      this,
      { w: SCREEN_W, h: SCREEN_H },
      DISPLAY_MODE,
    );
    return {
      entry,
      node: root,
      background: perspective.projectedSprite(background),
      badge: perspective.projectedSprite(element),
      perspective,
    };
  }

  /** Called from BattleNode's single presentation ticker. */
  update(dtMs: number): void {
    if (this.closed) return;
    this.detailElapsedMs += dtMs;
    const ease = coverflowEaseFrames(this.easeCarryMs + dtMs);
    this.easeCarryMs = ease.remainderMs;
    this.selectedIndex = advanceCoverflowIndexFrames(
      this.selectedIndex,
      this.actualSelectedIndex,
      ease.frames,
    );
    this.applyCarouselLayout();
    const showing = showingCoverflowIndex(this.selectedIndex, this.entries.length);
    if (showing !== this.detailIndex) this.rebuildDetail(showing);
    this.applyDetailOpacity();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.activeTouch = undefined;
    this.removeAllListeners();
    this.parent?.removeChild(this);
    for (const card of this.cards) {
      card.perspective.destroy(false);
    }
    this.destroy({ children: true });
    this.closeCallback();
  }

  /** Web-native equivalent of pressing the style-specific close/cancel control. */
  requestClose(): void {
    this.close();
  }

  get debugState(): MonsterManagementDebugState {
    const showingIndex = showingCoverflowIndex(this.selectedIndex, this.entries.length);
    const closeCenter = this.selectionControls?.cancel && this.selectionControlsBox
      ? this.textControlCenter(this.selectionControls.cancel)
      : this.closeButton === undefined
        ? { x: -1, y: -1 }
        : {
            x: this.closeButton.position.x - this.closeButton.width / 2,
            y: this.closeButton.position.y + this.closeButton.height / 2,
          };
    const selectCenter = this.selectionControls && this.selectionControlsBox
      ? this.textControlCenter(this.selectionControls.select)
      : undefined;
    return {
      open: true,
      style: this.style,
      editable: managementStyleConfig(this.style).editable,
      title: this.titleLabel.text,
      backgroundTint: this.background.tint as number,
      backgroundAlpha: this.background.alpha,
      selectedIndex: this.selectedIndex,
      actualSelectedIndex: this.actualSelectedIndex,
      presentedIndex: this.presentedIndex(),
      showingIndex,
      showingId: this.entries[showingIndex]!.id,
      detail: {
        summary: this.summaryText,
        evolution: this.evolutionText,
        summaryAlpha: this.summaryNode?.alpha ?? 0,
        evolutionAlpha: this.evolutionLabel?.alpha ?? 0,
      },
      closeCenter,
      ...(selectCenter === undefined ? {} : { selectCenter }),
      cards: this.cards.map(({ entry, node, background, badge }, index) => {
        // Must match the lane `applyCarouselLayout` drew from, or reported orbit disagrees with
        // the reported card positions.
        const layout = coverflowLayout(index, this.presentedIndex());
        const pivot = {
          x: this.carousel.position.x + node.position.x,
          y: this.carousel.position.y + MANAGEMENT_CARD_SIZE_PT / 2,
        };
        const badgeBounds = badge.getBounds();
        const badgeGlobalCenter = {
          x: badgeBounds.x + badgeBounds.width / 2,
          y: badgeBounds.y + badgeBounds.height / 2,
        };
        const badgeLocal = this.parent
          ? this.parent.toLocal(badgeGlobalCenter)
          : badgeGlobalCenter;
        return {
          id: entry.id,
          index,
          center: { x: this.carousel.position.x + node.position.x, y: this.carousel.position.y },
          badgeCenter: { x: badgeLocal.x, y: badgeLocal.y },
          visible: node.visible,
          alpha: background.alpha,
          contentAlpha: node.alpha,
          scaleX: node.scale.x,
          orbitDeg: layout.orbitDeg,
          projectedQuad: coverflowProjectedQuad({
            pivot,
            screen: { w: SCREEN_W, h: SCREEN_H },
            mode: DISPLAY_MODE,
            orbitDeg: layout.orbitDeg,
          }),
        };
      }),
    };
  }

  /** The DISPLAY index: the eased lane carried across the sub-frame time banked in
   *  `easeCarryMs`, equal to `selectedIndex` at every source frame boundary. Layout reads this;
   *  drag gain and `showingCoverflowIndex` keep reading the exact source lane. */
  private presentedIndex(): number {
    return presentCoverflowIndex(this.selectedIndex, this.actualSelectedIndex, this.easeCarryMs);
  }

  private applyCarouselLayout(): void {
    const presented = this.presentedIndex();
    this.cards.forEach(({ node, background, perspective }, index) => {
      const layout = coverflowLayout(index, presented);
      node.visible = layout.visible;
      node.position.set(layout.x, 0);


      node.alpha = 1;
      background.alpha = layout.opacity / 255;
      // CCOrbitCamera applies a genuine perspective plane transform to the complete subtree.
      // Keep the container affine transform neutral and let the filter retain projective clip W.
      node.scale.set(1);
      perspective.setOrbitDegrees(layout.orbitDeg);
      node.zIndex = layout.zIndex;
    });
  }

  private rebuildDetail(index: number): void {
    this.detailRoot.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.detailIndex = index;
    this.detailElapsedMs = 0;
    this.summaryNode = undefined;
    this.evolutionLabel = undefined;
    const entry = this.entries[index]!;


    const summary = new Box({
      horizontal: true,
      positiveAlignDirection: true,
      gap: unscaledIdiomPt(5, DISPLAY_MODE),
    });
    const star = pointSprite(this.rarityStarTexture);
    summary.addBoxChild(star);
    const starText = Number.isInteger(entry.stars) ? `${entry.stars}` : `${Math.floor(entry.stars)}.5`;
    summary.addBoxChild(
      makeTtfLabel(starText, unscaledIdiomPt(MANAGEMENT_STAR_COUNT_FONT_PT, DISPLAY_MODE), { outline: false }),
      { gapBefore: unscaledIdiomPt(MANAGEMENT_STAR_TEXT_GAP_PT, DISPLAY_MODE) },
    );
    const levelText = `${localizedString(this.strings, "LevelShortKey")}:${entry.level}`;
    summary.addBoxChild(
      makeTtfLabel(levelText, unscaledIdiomPt(MANAGEMENT_LEVEL_FONT_PT, DISPLAY_MODE), { outline: false }),
    );


    const summaryPosition = managementSummaryBoxPosition(summary.boxContentSize);
    summary.position.set(summaryPosition.x, summaryPosition.y);
    this.detailRoot.addChild(summary);
    this.summaryNode = summary;
    this.summaryText = `${starText} ${levelText}`;

    this.evolutionText = null;
    if (entry.evolveLevel !== undefined) {
      const percent = evolutionProgressPercent(entry.level, entry.evolveLevel, entry.previousEvolveLevel ?? 1);
      const format = localizedString(this.strings, "EvolvedProgressFormatKey");
      // NSString stringWithFormat interprets the shipped `%d%% Evolved` as one numeric
      // substitution followed by one literal percent sign. A plain JS `%d` replacement would
      // leave the escaped pair visible as `%%`.
      const text = format.replace("%d%%", `${percent}%`);


      const evolution = makeTtfLabel(text, unscaledIdiomPt(MANAGEMENT_LEVEL_FONT_PT, DISPLAY_MODE), { outline: false });
      evolution.anchor.set(0.5, 0.5);
      evolution.alpha = 0;
      this.detailRoot.addChild(evolution);
      this.evolutionLabel = evolution;
      this.evolutionText = text;
    }
    this.applyDetailOpacity();
  }

  private applyDetailOpacity(): void {
    const opacity = this.evolutionLabel
      ? managementDetailOpacity(this.detailElapsedMs)
      : { summary: 1, evolution: 0 };
    if (this.summaryNode) this.summaryNode.alpha = opacity.summary;
    if (this.evolutionLabel) this.evolutionLabel.alpha = opacity.evolution;
  }

  private readonly onPointerDown = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (this.closed || this.activeTouch) return;
    const point = event.getLocalPosition(this);
    const control = this.controlAt(point.x, point.y);
    const owner = control !== undefined
      ? "controls"
      : this.pointInCoverflow(point.x, point.y)
        ? "coverflow"
        : "screen";
    this.activeTouch = {
      pointerId: event.pointerId,
      owner,
      startX: point.x,
      startY: point.y,
      selectionTouch: true,
      anchorIndex: this.actualSelectedIndex,
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
    if (touch.owner !== "coverflow") return;
    this.actualSelectedIndex = draggedCoverflowIndex({
      anchorIndex: touch.anchorIndex,
      startX: touch.startX,
      currentX: point.x,
      selectedIndex: this.selectedIndex,
      actualSelectedIndex: this.actualSelectedIndex,
      itemCount: this.entries.length,
    });
    this.applyCarouselLayout();
  };

  private readonly onPointerUp = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    const touch = this.activeTouch;
    if (!touch || touch.pointerId !== event.pointerId) return;
    this.activeTouch = undefined;
    const point = event.getLocalPosition(this);
    const selectionTouch = updateSelectionTouchState({
      selectable: touch.selectionTouch,
      startX: touch.startX,
      startY: touch.startY,
      currentX: point.x,
      currentY: point.y,
      threshold: SELECTION_DISTANCE_PT,
    });

    if (touch.owner === "controls") {


      const control = selectionTouch ? this.controlAt(point.x, point.y) : undefined;
      if (control === "close") {
        this.close();
      } else if (control === "select") {
        const showing = showingCoverflowIndex(this.selectedIndex, this.entries.length);
        this.selectCallback?.(this.entries[showing]!.id);
        // Tag 3 closes the source picker after invoking the selection target. A callback may have
        // already closed this node; preserve idempotence.
        if (!this.closed) this.close();
      }
      return;
    }
    if (touch.owner !== "coverflow") return;
    if (!selectionTouch) {
      this.actualSelectedIndex = showingCoverflowIndex(this.actualSelectedIndex, this.entries.length);
      return;
    }
    const hit = this.hitCardAtGlobal(event.global.x, event.global.y);
    if (hit === null) return;
    const showing = showingCoverflowIndex(this.selectedIndex, this.entries.length);


    if (hit !== showing) {
      this.actualSelectedIndex = hit;
      return;
    }
    if (this.pointInBadge(this.cards[hit]!, event.global.x, event.global.y)) {
      this.elementHelpCallback(this.cards[hit]!.entry.element);
      return;
    }
    this.inspectCallback(this.entries[hit]!.id);
  };

  private readonly onPointerCancel = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
    if (!this.activeTouch || this.activeTouch.pointerId !== event.pointerId) return;
    this.activeTouch = undefined;
    this.actualSelectedIndex = showingCoverflowIndex(this.actualSelectedIndex, this.entries.length);
  };

  private readonly swallowTap = (event: FederatedPointerEvent): void => {
    event.stopPropagation();
  };

  /**
   * Desktop scroll-wheel navigation over the coverflow band (the touch-only source has no wheel
   * path). One notch steps the selection by a single card and eases to it exactly like tapping a
   * side card (`actualSelectedIndex = hit`): stepping from the settled *showing* index means a
   * notch mid-glide still advances one card, and the [0, count-1] clamp mirrors safeSetIndex.
   * Positive deltaY (scroll down) moves forward through the list. Ignored while a drag is active.
   */
  private readonly onWheel = (event: FederatedWheelEvent): void => {
    event.stopPropagation();
    if (this.closed || this.activeTouch || event.deltaY === 0) return;
    const point = event.getLocalPosition(this);
    if (!this.pointInCoverflow(point.x, point.y)) return;
    const showing = showingCoverflowIndex(this.selectedIndex, this.entries.length);
    this.actualSelectedIndex = Math.min(
      this.entries.length - 1,
      Math.max(0, showing + Math.sign(event.deltaY)),
    );
  };

  private textControlVisibleRect(control: PreparedTextControl): { x: number; y: number; w: number; h: number } {
    const box = this.selectionControlsBox;
    if (!box) throw new Error("MonsterManagementNode selection controls are not mounted");
    return {
      x: box.position.x + control.root.position.x + control.visibleRect.x,
      y: box.position.y + control.root.position.y + control.visibleRect.y,
      w: control.visibleRect.w,
      h: control.visibleRect.h,
    };
  }

  private controlAt(x: number, y: number): "select" | "close" | undefined {
    const candidates: Array<{
      value: "select" | "close";
      rect: { x: number; y: number; w: number; h: number };
    }> = [];
    if (this.selectionControls) {
      candidates.push({
        value: "select",
        rect: this.textControlVisibleRect(this.selectionControls.select),
      });
      if (this.selectionControls.cancel) {
        candidates.push({
          value: "close",
          rect: this.textControlVisibleRect(this.selectionControls.cancel),
        });
      }
    } else if (this.closeButton) {
      candidates.push({
        value: "close",
        rect: {
          x: this.closeButton.position.x - this.closeButton.width,
          y: this.closeButton.position.y,
          w: this.closeButton.width,
          h: this.closeButton.height,
        },
      });
    }
    return nearestManagementTouchable(candidates, { x, y });
  }

  private textControlCenter(control: PreparedTextControl): { x: number; y: number } {
    const box = this.selectionControlsBox;
    if (!box) throw new Error("MonsterManagementNode selection controls are not mounted");
    return {
      x: box.position.x + control.root.position.x + control.visibleRect.x + control.visibleRect.w / 2,
      y: box.position.y + control.root.position.y + control.visibleRect.y + control.visibleRect.h / 2,
    };
  }

  /** `CFlowNode.isPointInBounds:` over the band `updateValues` accumulated from the cards as they
   *  currently sit. The earlier fixed +/-2-card rectangle approximated a full seven-card arc and
   *  was both too generous at the ends of a short list and unable to follow the arc mid-glide. */
  private pointInCoverflow(x: number, y: number): boolean {
    return pointInCoverflowBounds({
      x,
      y,
      originX: this.carousel.position.x,
      originY: this.carousel.position.y,
      bounds: coverflowTouchBoundsX(
        this.cards.map(({ node }) => ({ visible: node.visible, x: node.position.x })),
      ),
    });
  }

  private pointInBadge(card: ManagementCard, globalX: number, globalY: number): boolean {
    if (!card.node.visible) return false;
    const bounds = card.badge.getBounds();
    return (
      globalX >= bounds.x && globalX <= bounds.x + bounds.width &&
      globalY >= bounds.y && globalY <= bounds.y + bounds.height
    );
  }

  private hitCardAtGlobal(globalX: number, globalY: number): number | null {
    const showing = showingCoverflowIndex(this.selectedIndex, this.entries.length);
    const order = this.cards
      .map(({ node }, index) => ({ node, index, priority: index === showing ? 100 : node.zIndex }))
      .sort((a, b) => b.priority - a.priority);
    for (const { node, index } of order) {
      if (!node.visible) continue;
      const bounds = node.getBounds();
      if (
        globalX >= bounds.x && globalX <= bounds.x + bounds.width &&
        globalY >= bounds.y && globalY <= bounds.y + bounds.height
      ) return index;
    }
    return null;
  }
}
