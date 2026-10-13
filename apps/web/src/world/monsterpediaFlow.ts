import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type Renderer,
  type Text,
  type Ticker,
} from "pixi.js";
import {
  Box,
  OUTLINE_FADE_ALPHA,
  StrokeRecognizer,
  makeTtfLabel,
  minimumHitRectLocal,
  nearestMinimumHit,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";

function sourceMinimumHitArea(node: Container): Rectangle {
  const bounds = node.getLocalBounds();
  const hit = minimumHitRectLocal(
    { x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height },
    node.scale,
  );
  return new Rectangle(hit.x, hit.y, hit.w, hit.h);
}
import type { GameData, MonsterDef } from "@dib/gamedata/browser";
import type { StatName } from "@dib/gamedata";
import {
  buildPlayerChoices,
  jobXpCostOfNextLevel,
  jobXpForLevel,
  monsterStats,
  type MonsterStatChildren,
  type PlayerBuffBonuses,
  type SoulStoneSetup,
} from "@dib/engine";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import {
  localizedRenderableName,
  localizedString,
  type LocalizedStrings,
} from "../localization.js";
import {
  LIVING_STAT_NAMES,
  buildAbilityInfoContent,
  buildElementHelpContent,
  buildLivingInfoContent,
  evolveChainInfoRows,
  soulStoneStatRows,
  type ElementHelpName,
  type LivingInfoAbility,
  type LivingInfoSnapshot,
} from "../battle/infoDisplays.js";
import {
  buildAbilityInfoModel,
  buildPassiveAbilityInfoModel,
  type AbilityInfoContext,
  type AbilityInfoModel,
} from "../battle/abilityInfo.js";
import {
  PopupHost,
} from "../ui/popup.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  createMonsterManagementNode,
  type MonsterManagementEntry,
  type MonsterManagementDebugState,
  type MonsterManagementNode,
} from "../battle/monsterManagementNode.js";
import { tween } from "../tween.js";
import { SCREEN_H, SCREEN_W } from "../battle/displayShared.js";
import {
  monsterpediaIngredientFlashAlpha,
  monsterpediaSelectedLabelTint,
  stepMonsterpediaCocosInterval,
} from "./monsterpediaAnimationMath.js";
import { runMonsterpediaPageTurn } from "./monsterpediaPageTurn.js";
import {
  MONSTERPEDIA_CARD_SIZE,
  createMonsterpediaCard,
  loadMonsterpediaCardAssets,
  type MonsterpediaCardAssets,
  type MonsterpediaCardHandle,
} from "./monsterpediaCard.js";
import {
  MONSTERPEDIA_BOOK_SIZE_PT,
  MONSTERPEDIA_BOOK_TEXTURE_RECT_PX,
  MONSTERPEDIA_EXPANSION_GREY_ALPHA,
  MONSTERPEDIA_EXPANSION_MS,
  MONSTERPEDIA_HELP_DELAY_MS,
  MONSTERPEDIA_HELP_FADE_MS,
  monsterpediaBookLayout,
  monsterpediaCompleteListLayout,
  monsterpediaExpansionLayout,
  monsterpediaHelpLabelOffset,
} from "./monsterpediaLayoutMath.js";
import {
  MONSTERPEDIA_CATEGORIES,
  MONSTERPEDIA_CATEGORY_LOCALIZATION_KEYS,
  MONSTERPEDIA_CATEGORY_TAB_FRAMES,
  buildMonsterpediaCategory,
  canSatisfyCombineRecipe,
  clampMonsterpediaPage,
  combineIngredientCandidates,
  completeListPageStart,
  formatMonsterpediaText,
  monsterpediaCompletionPercent,
  monsterpediaDisplayLevel,
  monsterpediaEntriesPerPage,
  monsterpediaFoundCount,
  monsterpediaInspectionLevel,
  monsterpediaIngredientVisualState,
  monsterpediaPageCount,
  type MonsterpediaCategory,
  type MonsterpediaEntry,
  type MonsterpediaProfileView,
  type MonsterpediaRecipeEntry,
} from "./monsterpediaModel.js";

let BOOK_LAYOUT = monsterpediaBookLayout(DISPLAY_MODE);
let COMPLETE_LAYOUT = monsterpediaCompleteListLayout(DISPLAY_MODE);
let EXPANSION_LAYOUT = monsterpediaExpansionLayout(DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  BOOK_LAYOUT = monsterpediaBookLayout(DISPLAY_MODE);
  COMPLETE_LAYOUT = monsterpediaCompleteListLayout(DISPLAY_MODE);
  EXPANSION_LAYOUT = monsterpediaExpansionLayout(DISPLAY_MODE);
});
const ELEMENTS = new Set(["Life", "Death", "Water", "Fire", "Earth", "Air", "Arcane"]);
const STAT_ENUM: ReadonlyArray<readonly [1 | 2 | 3 | 4 | 5, StatName]> = [
  [1, "Attack"],
  [2, "Magic"],
  [3, "Speed"],
  [4, "Defense"],
  [5, "Resist"],
];

export interface MonsterpediaPartyMember {
  readonly instanceId: string;
  readonly shortType: string;
  readonly level: number;
  readonly cumulativeXp: number;
  readonly currentHp?: number;
  readonly soulStone?: SoulStoneSetup;
  /** Permanent hero-skill/Gem buff children, supplied by the party aggregate that owns them
   * (`WorldTripParty.playerBuffsOf`). Absent for template previews, which are species rows rather
   * than a monster the player owns. */
  readonly playerBuffs?: PlayerBuffBonuses;
}

type MonsterpediaInspectionSource =
  | {
      readonly kind: "historyPreview";
      readonly monster: MonsterDef;
      readonly level: number;
    }
  | {
      readonly kind: "partyInstance";
      readonly monster: MonsterDef;
      readonly instance: MonsterpediaPartyMember;
    };

export interface MonsterpediaCombineRequest {
  readonly resultShortType: string;
  readonly firstIngredientId: string;
  readonly secondIngredientId: string;
}

export interface MonsterpediaFlowOpts {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly renderer: Renderer;
  readonly gd: GameData;
  readonly profile: MonsterpediaProfileView;
  /** Live durable party projection, snapshotted with both ordered candidate lists before picker 1. */
  readonly partyMembers: () => readonly MonsterpediaPartyMember[];
  readonly editable: boolean;
  /** Build the incoming scene off-stage so a source scene fade can mount it at the opaque midpoint. */
  readonly deferPresentation?: boolean;
  /** Owning world lifetime; initial async construction must not outlive its scene. */
  readonly signal?: AbortSignal;

  readonly showCategoryName: (text: string) => void;
  /** Integration seam: the route adapter owns result-ID creation and durable mutation. */
  readonly combineMonsters: (
    request: MonsterpediaCombineRequest,
  ) => void | Promise<void>;
  readonly claimTutorialFlag?: (flag: string) => Promise<void>;
  /** Scene owner performs the matching midpoint swap; plain callers may return synchronously. */
  readonly onClose: () => void | Promise<void>;
  readonly playSfx: (key: string) => void;
}

interface TabTextures {
  readonly normal: Texture;
  readonly selected: Texture;
  readonly closeIcon: Texture;
  readonly leaveIcon: Texture;
  readonly helpLine: Texture;
  readonly allPrevious: Texture;
  readonly allCancel: Texture;
  readonly allNext: Texture;
  readonly categoryIcons: Readonly<Record<MonsterpediaCategory, Texture>>;
}

interface RepeatingSpriteAction {
  readonly sprite: Container;
  elapsedMs: number;
  firstTick: boolean;
  running: boolean;
}

interface RepeatingLabelAction {
  readonly label: Text;
  elapsedMs: number;
  firstTick: boolean;
  running: boolean;
}

interface ExpandedPresentation {
  readonly overlay: Container;
  readonly grey: Graphics;
  readonly fadingNodes: readonly Container[];
  readonly helpNodes: readonly Container[];
  readonly cards: readonly Container[];
  readonly cardStates: readonly {
    readonly node: Container;
    readonly shortType: string;
    readonly known: boolean;
  }[];
  readonly sourceTopLeft: { readonly x: number; readonly y: number };
  readonly originalCard?: Container;
}

interface MonsterpediaInspectionDebug {
  readonly kind: MonsterpediaInspectionSource["kind"];
  readonly instanceId?: string;
  readonly xpThisLevel: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly soulStoneCount: number;
  readonly evolveRows: readonly {
    shortType: string;
    evolveLevel: number;
    rendererScale?: number;
  }[];
}

/**
 * Retained Monsterpedia scene shared by the menu (`editable=false`) and town
 * (`editable=true`). Page changes retain outgoing and detached incoming surfaces through the
 * source 0.2-second page-turn transaction, then atomically commit destination ownership.
 */
export class MonsterpediaFlow {
  private readonly root = new Container();
  private readonly sceneRoot = new Container();
  private readonly pageRoot = new Container();
  private readonly tabRoot = new Container();
  private readonly overlayRoot = new Container();
  private readonly opts: MonsterpediaFlowOpts;
  private readonly popupOwner = {};
  private readonly popupHost: PopupHost;
  private readonly lifecycle = new AbortController();
  private readonly cardAssets: MonsterpediaCardAssets;
  private readonly tabTextures: TabTextures;
  private cards = new Map<string, MonsterpediaCardHandle>();
  private ingredientFlashActions: RepeatingSpriteAction[] = [];
  private completeListTintActions: RepeatingLabelAction[] = [];
  private readonly strokeRecognizer: StrokeRecognizer;
  private category: MonsterpediaCategory;
  private page: number;
  /** `MonsterpediaAllNode.selectedMonsterLabel`, distinct from its page-window `currentIndex`. */
  private completeListSelectedIndex = 0;
  private disposed = false;
  private presented = false;
  private closing = false;
  private busy = false;
  private transitionLocked = false;
  private pageBuildSerial = 0;
  private inspectionSerial = 0;
  private inspectionPending = false;
  private picker: MonsterManagementNode | undefined;
  private expanded = false;
  private editable: boolean;
  private expandedPresentation: ExpandedPresentation | undefined;
  private expandedExitBusy = false;
  private bookPageTexture: Texture | undefined;
  private inspectionDebug: MonsterpediaInspectionDebug | null = null;

  private constructor(
    opts: MonsterpediaFlowOpts,
    cardAssets: MonsterpediaCardAssets,
    tabTextures: TabTextures,
    category: MonsterpediaCategory,
    page: number,
  ) {
    this.opts = opts;
    this.popupHost = PopupHost.for(opts.parent);
    this.cardAssets = cardAssets;
    this.tabTextures = tabTextures;
    this.category = category;
    this.page = page;
    this.editable = opts.editable;
    this.root.label = `monsterpedia:${opts.editable ? "editable" : "viewOnly"}`;
    this.root.zIndex = 90;
    this.root.sortableChildren = true;
    this.root.eventMode = "static";
    this.root.hitArea = new Rectangle(0, 0, SCREEN_W, SCREEN_H);
    this.root.on("pointertap", (event) => event.stopPropagation());
    this.root.on("pointermove", (event) => event.stopPropagation());
    this.strokeRecognizer = new StrokeRecognizer(this.root, {
      patterns: new Map([
        ["leftToRight", /^456$/],
        ["rightToLeft", /^654$/],
      ]),
    });
    this.strokeRecognizer.onStroke(({ name }) => {
      if (name === "leftToRight") this.changePage(-1);
      else if (name === "rightToLeft") this.changePage(1);
    });
  }

  static async show(
    opts: MonsterpediaFlowOpts,
    state: { readonly category?: MonsterpediaCategory; readonly page?: number } = {},
  ): Promise<MonsterpediaFlow | undefined> {
    const [bookTexture, leaveIcon, allPrevious, allCancel, allNext, cardAssets, atlas] = await Promise.all([
      opts.assets.sprite("bookPage"),
      opts.assets.sprite("leaveIcon"),
      opts.assets.sprite("orderLeftArrow-hd"),
      opts.assets.sprite("cancelMonsterPickButton-hd"),
      opts.assets.sprite("orderRightArrow-hd"),
      loadMonsterpediaCardAssets(opts.assets),
      opts.assets.atlas("MonsterpediaFrames-hd"),
    ]);
    if (opts.signal?.aborted || opts.parent.destroyed) return undefined;
    const required = (name: string): Texture => {
      const texture = atlas.textures[name];
      if (!texture) throw new Error(`MonsterpediaFrames-hd is missing ${name}`);
      return texture;
    };
    const categoryIcons = Object.fromEntries(
      MONSTERPEDIA_CATEGORIES.map((category) => [
        category,
        required(MONSTERPEDIA_CATEGORY_TAB_FRAMES[category]),
      ]),
    ) as unknown as Record<MonsterpediaCategory, Texture>;
    const flow = new MonsterpediaFlow(
      opts,
      cardAssets,
      {
        normal: required("monsterpediaTab.png"),
        selected: required("monsterpediaTabLong.png"),
        closeIcon: required("xTabIcon.png"),
        leaveIcon,
        helpLine: required("helpLine.png"),
        allPrevious,
        allCancel,
        allNext,
        categoryIcons,
      },
      state.category ?? 0,
      state.page ?? 0,
    );
    flow.root.addChild(flow.sceneRoot);
    flow.buildBookBackground(bookTexture);
    flow.sceneRoot.addChild(flow.pageRoot, flow.tabRoot, flow.overlayRoot);
    const disposeOnAbort = (): void => flow.dispose();
    opts.signal?.addEventListener("abort", disposeOnAbort, { once: true });
    try {
      // Build off-stage so a failed first page never leaves a full-screen input consumer mounted.
      await flow.rebuildPage(false);
      if (flow.disposed || opts.signal?.aborted || opts.parent.destroyed) {
        flow.dispose();
        return undefined;
      }
      if (opts.deferPresentation !== true) flow.present();
      return flow;
    } catch (error) {
      flow.dispose();
      throw error;
    } finally {
      opts.signal?.removeEventListener("abort", disposeOnAbort);
    }
  }

  update(dtMs: number): void {
    if (this.disposed) return;
    this.picker?.update(dtMs);
    for (let index = this.ingredientFlashActions.length - 1; index >= 0; index -= 1) {
      const action = this.ingredientFlashActions[index]!;
      if (action.sprite.destroyed) {
        this.ingredientFlashActions.splice(index, 1);
        continue;
      }
      if (!action.running) continue;
      const next = stepMonsterpediaCocosInterval(action.elapsedMs, dtMs, action.firstTick);
      action.elapsedMs = next.elapsedMs;
      action.firstTick = next.firstTick;
      action.sprite.alpha = monsterpediaIngredientFlashAlpha(action.elapsedMs);
    }
    for (let index = this.completeListTintActions.length - 1; index >= 0; index -= 1) {
      const action = this.completeListTintActions[index]!;
      if (action.label.destroyed) {
        this.completeListTintActions.splice(index, 1);
        continue;
      }
      if (!action.running) continue;
      const next = stepMonsterpediaCocosInterval(action.elapsedMs, dtMs, action.firstTick);
      action.elapsedMs = next.elapsedMs;
      action.firstTick = next.firstTick;
      action.label.tint = monsterpediaSelectedLabelTint(action.elapsedMs);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pageBuildSerial += 1;
    this.inspectionSerial += 1;
    this.lifecycle.abort();
    this.strokeRecognizer.setEnabled(false);
    this.picker?.close();
    this.picker = undefined;
    this.popupHost.dismissOwnedBy(this.popupOwner);
    this.root.removeAllListeners();
    this.root.parent?.removeChild(this.root);
    this.root.destroy({ children: true });
    // The crop Texture is flow-owned but shares the archive-managed source texture.
    this.bookPageTexture?.destroy(false);
    this.bookPageTexture = undefined;
  }

  /** Mounts a prebuilt Monsterpedia scene at a `CCTransitionFade` opaque midpoint. */
  present(): void {
    if (this.disposed || this.presented) return;
    if (this.opts.parent.destroyed) {
      this.dispose();
      return;
    }
    this.presented = true;
    this.opts.parent.sortableChildren = true;
    this.opts.parent.addChild(this.root);
    this.opts.showCategoryName(
      localizedString(
        this.opts.strings,
        MONSTERPEDIA_CATEGORY_LOCALIZATION_KEYS[this.category],
      ),
    );
    void this.showCurrentScreenTutorial();
  }

  private popupEnvironment() {
    return {
      parent: this.opts.parent,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      ticker: this.opts.ticker,
      owner: this.popupOwner,
      sfx: { onButtonPress: () => this.opts.playSfx("click") },
    };
  }

  get debugState(): {
    open: true;
    screen: "monsterpedia" | "monsterpediaAll";
    editable: boolean;
    category: MonsterpediaCategory;
    categoryName: string;
    /** Ordinary-book page number; Complete List keeps this at 0 and exposes selection separately. */
    page: number;
    pageCount: number;
    completeList?: {
      selectedIndex: number;
      windowIndex: number;
      windowStart: number;
      windowEndExclusive: number;
    };
    transitionLocked: boolean;
    stroke: StrokeRecognizer["debugState"];
    presented: boolean;
    closing: boolean;
    busy: boolean;
    pageBuildSerial: number;
    pickerOpen: boolean;
    picker: MonsterManagementDebugState | null;
    expanded: boolean;
    expandedCards: Array<{
      shortType: string;
      known: boolean;
      x: number;
      y: number;
      zIndex: number;
    }>;
    expandedHelpAlphas: number[];
    popups: PopupHost["debugState"];
    cards: Array<MonsterpediaCardHandle["debug"]>;
    ingredientAlphas: number[];
    selectedLabelTints: number[];
    inspection: MonsterpediaInspectionDebug | null;
  } {
    const entries = buildMonsterpediaCategory(this.opts.gd, this.opts.profile, this.category);
    return {
      open: true,
      screen: this.category === 5 ? "monsterpediaAll" : "monsterpedia",
      editable: this.editable,
      category: this.category,
      categoryName: localizedString(
        this.opts.strings,
        MONSTERPEDIA_CATEGORY_LOCALIZATION_KEYS[this.category],
      ),
      page: this.category === 5 ? 0 : this.page,
      pageCount: this.category === 5
        ? Math.max(1, Math.ceil(entries.length / COMPLETE_LAYOUT.visibleLabels))
        : monsterpediaPageCount(entries.length, this.category),
      ...(this.category === 5
        ? {
            completeList: {
              selectedIndex: this.completeListSelectedIndex,
              windowIndex: Math.floor(this.page / COMPLETE_LAYOUT.visibleLabels),
              windowStart: this.page,
              windowEndExclusive: Math.min(
                entries.length,
                this.page + COMPLETE_LAYOUT.visibleLabels,
              ),
            },
          }
        : {}),
      transitionLocked: this.transitionLocked,
      stroke: this.strokeRecognizer.debugState,
      presented: this.presented,
      closing: this.closing,
      busy: this.busy,
      pageBuildSerial: this.pageBuildSerial,
      pickerOpen: this.picker !== undefined,
      picker: this.picker?.debugState ?? null,
      expanded: this.expanded,
      expandedCards: this.expandedPresentation?.cardStates.map(({ node, shortType, known }) => ({
        shortType,
        known,
        x: node.position.x,
        y: node.position.y,
        zIndex: node.zIndex,
      })) ?? [],
      expandedHelpAlphas: this.expandedPresentation?.helpNodes.map((node) => node.alpha) ?? [],
      popups: this.popupHost.debugState,
      cards: [...this.cards.values()].map((card) => card.debug),
      ingredientAlphas: this.ingredientFlashActions
        .filter((action) => !action.sprite.destroyed)
        .map((action) => action.sprite.alpha),
      selectedLabelTints: this.completeListTintActions
        .filter((action) => !action.label.destroyed)
        .map((action) => action.label.tint as number),
      inspection: this.inspectionDebug,
    };
  }

  /** Contextual web back following the visible flow hierarchy instead of destroying the book:
   * popup -> picker -> expanded chain -> Complete List -> ordinary book. */
  requestBack(): void {
    if (this.disposed) return;
    if (this.popupHost.dismissTop()) return;
    if (this.transitionLocked || this.expandedExitBusy || this.inspectionPending) return;
    if (this.picker !== undefined) {
      this.picker.close();
      return;
    }
    if (this.expanded) {
      void this.hideExpanded();
      return;
    }
    if (this.busy) return;
    if (this.category === 5) {
      this.resetFromCompleteList();
      return;
    }
    void this.handleClose();
  }

  private buildBookBackground(fullTexture: Texture): void {
    if (
      fullTexture.width < MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.w ||
      fullTexture.height < MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.h
    ) {
      throw new Error(
        `bookPage is ${fullTexture.width}x${fullTexture.height}px; source crop requires ` +
          `${MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.w}x${MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.h}`,
      );
    }
    this.bookPageTexture = new Texture({
      source: fullTexture.source,
      frame: new Rectangle(
        MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.x,
        MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.y,
        MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.w,
        MONSTERPEDIA_BOOK_TEXTURE_RECT_PX.h,
      ),
    });
    this.sceneRoot.addChild(this.createBookBackground());
  }

  private createBookBackground(): Sprite {
    if (!this.bookPageTexture) throw new Error("Monsterpedia book texture was not initialized");
    const page = pointSprite(this.bookPageTexture);
    page.label = "monsterpediaBookPage";
    page.width = MONSTERPEDIA_BOOK_SIZE_PT.w;
    page.height = MONSTERPEDIA_BOOK_SIZE_PT.h;
    page.position.set(BOOK_LAYOUT.bookTopLeft.x, BOOK_LAYOUT.bookTopLeft.y);
    return page;
  }

  private buildTabs(target: Container = this.tabRoot): void {
    target.removeChildren().forEach((child) => child.destroy({ children: true }));
    if (this.category === 5) {
      const controls = new Box({
        horizontal: true,
        positiveAlignDirection: true,
        gap: COMPLETE_LAYOUT.controlGap,
        roundingScale: COMPLETE_LAYOUT.roundingScale,
      });
      controls.label = "monsterpediaAll:controls";
      const specs = [
        { name: "previous", texture: this.tabTextures.allPrevious, action: () => this.changeCompleteListPage(-1) },
        { name: "cancel", texture: this.tabTextures.allCancel, action: () => this.resetFromCompleteList() },
        { name: "next", texture: this.tabTextures.allNext, action: () => this.changeCompleteListPage(1) },
      ] as const;
      for (const spec of specs) {
        const button = pointSprite(spec.texture);
        button.label = `monsterpediaAll:${spec.name}`;
        button.eventMode = "static";
        button.cursor = "pointer";
        button.hitArea = sourceMinimumHitArea(button);
        button.on("pointertap", (event) => {
          event.stopPropagation();
          if (this.busy) return;
          this.opts.playSfx("click");
          spec.action();
        });
        controls.addBoxChild(button, {
          // Box consumes authored contentSize and multiplies by the child's pointSprite scale.
          contentSize: { w: button.texture.width, h: button.texture.height },
        });
      }
      controls.position.set(
        COMPLETE_LAYOUT.controlsLeft(controls.boxContentSize.w),
        COMPLETE_LAYOUT.controlsTop(controls.boxContentSize.h),
      );
      target.addChild(controls);
      return;
    }

    MONSTERPEDIA_CATEGORIES.forEach((category) => {
      const selected = category === this.category;
      const tab = pointSprite(selected ? this.tabTextures.selected : this.tabTextures.normal);
      tab.label = `monsterpediaTab:${category}`;
      tab.position.set(
        BOOK_LAYOUT.tab.left(tab.width),
        BOOK_LAYOUT.tab.categoryTop(category),
      );
      tab.eventMode = "static";
      tab.cursor = "pointer";
      // A child of a pointSprite inherits the parent's 0.5 HD fold. Keep the child at raw atlas
      // scale and position it in the tab's raw texture coordinates so normalization occurs once.
      const icon = new Sprite(this.tabTextures.categoryIcons[category]);
      icon.label = `monsterpediaTabIcon:${category}`;
      icon.anchor.set(0.5);
      icon.position.set(
        tab.texture.width / 2,
        tab.texture.height / 2,
      );
      tab.addChild(icon);
      tab.hitArea = sourceMinimumHitArea(tab);
      tab.on("pointertap", (event) => {
        event.stopPropagation();
        if (this.busy || this.category === category) return;
        this.opts.playSfx("click");
        if (category === 5) this.completeListSelectedIndex = 0;
        this.category = category;
        this.page = 0;
        this.opts.showCategoryName(
          localizedString(
            this.opts.strings,
            MONSTERPEDIA_CATEGORY_LOCALIZATION_KEYS[category],
          ),
        );
        void this.rebuildPage(true);
      });
      target.addChild(tab);
    });

    const closeTab = pointSprite(this.tabTextures.normal);
    closeTab.label = "monsterpediaTab:close";
    closeTab.position.set(
      BOOK_LAYOUT.tab.left(closeTab.width),
      BOOK_LAYOUT.tab.closeTop,
    );
    closeTab.eventMode = "static";
    closeTab.cursor = "pointer";
    const closeIcon = new Sprite(this.tabTextures.closeIcon);
    closeIcon.label = "monsterpediaTabIcon:close";
    closeIcon.anchor.set(0.5);
    closeIcon.position.set(closeTab.texture.width / 2, closeTab.texture.height / 2);
    closeTab.addChild(closeIcon);
    closeTab.hitArea = sourceMinimumHitArea(closeTab);
    closeTab.on("pointertap", (event) => {
      event.stopPropagation();
      if (this.busy) return;
      this.opts.playSfx("click");
      void this.handleClose();
    });
    target.addChild(closeTab);
  }

  private async rebuildPage(lockInput: boolean, backwards = false): Promise<void> {
    const serial = ++this.pageBuildSerial;
    const nextCards = new Map<string, MonsterpediaCardHandle>();
    const nextFlashActions: RepeatingSpriteAction[] = [];
    const nextTintActions: RepeatingLabelAction[] = [];
    this.busy = true;
    this.strokeRecognizer.setEnabled(false);
    let next: Container | undefined;
    let nextTabs: Container | undefined;
    let incomingScene: Container | undefined;
    try {
      const entries = buildMonsterpediaCategory(this.opts.gd, this.opts.profile, this.category);
      this.page = this.category === 5
        ? Math.min(Math.max(0, Math.trunc(this.page)), Math.max(0, entries.length - 1))
        : clampMonsterpediaPage(this.page, entries.length, this.category);
      if (this.category === 5) {
        const windowEnd = Math.min(entries.length, this.page + COMPLETE_LAYOUT.visibleLabels);
        if (
          this.completeListSelectedIndex < this.page ||
          this.completeListSelectedIndex >= windowEnd
        ) {
          this.completeListSelectedIndex = this.page;
        }
      }
      next = new Container();
      next.label = `monsterpediaPage:${this.category}:${this.page}`;
      const nextCardRoot = new Container();
      next.addChild(nextCardRoot);

      const pageEntries = this.visibleEntries(entries);
      await Promise.all(pageEntries.map(async (entry, index) => {
        const card = await createMonsterpediaCard(
          this.opts.assets,
          this.cardAssets,
          this.opts.gd,
          this.opts.strings,
          entry,
          {
            ...(entry.kind === "recipe"
              ? {
                  ingredientRegistered: [
                    this.ingredientVisualState(entry, 0).tint === "color",
                    this.ingredientVisualState(entry, 1).tint === "color",
                  ] as const,
                }
              : {}),
            onOpen: () => void this.handleCardOpen(entry),
          },
        );
        const position = this.cardPosition(index);
        card.root.position.set(position.x, position.y);
        nextCardRoot.addChild(card.root);
        nextCards.set(entry.monster.shortType, card);
        if (entry.kind === "recipe" && entry.recipeKnown) {
          this.registerIngredientFlash(entry, card, nextFlashActions);
        }
      }));
      if (serial !== this.pageBuildSerial || this.disposed) return;

      if (this.category === 5) {
        this.buildCompleteListLabels(next, entries, nextTintActions);
        this.buildCompleteListSummary(next, entries);
      } else {
        this.buildBookFooter(next, entries);
      }

      nextTabs = new Container();
      this.buildTabs(nextTabs);
      const page = next;
      const tabs = nextTabs;
      // Swapping the live scene must stay synchronous and must run on the page turn's own final
      // frame; see the commit contract in monsterpediaPageTurn.ts. Reparenting `page` out of the
      // incoming capture scene is implicit in addChild.
      const commitPage = (): void => {
        if (serial !== this.pageBuildSerial || this.disposed) return;
        const oldPageChildren = this.pageRoot.removeChildren();
        const oldTabChildren = this.tabRoot.removeChildren();
        this.pageRoot.addChild(page);
        next = undefined;
        this.tabRoot.addChild(...tabs.removeChildren());
        tabs.destroy();
        nextTabs = undefined;
        oldPageChildren.forEach((child) => child.destroy({ children: true }));
        oldTabChildren.forEach((child) => child.destroy({ children: true }));
        this.cards = nextCards;
        this.ingredientFlashActions = nextFlashActions;
        this.completeListTintActions = nextTintActions;
        this.startIngredientFlashActions();
        this.startCompleteListTintActions();
      };

      if (lockInput && !this.lifecycle.signal.aborted) {
        this.transitionLocked = true;
        incomingScene = new Container();
        incomingScene.label = "monsterpediaPageTurn:incoming";
        incomingScene.addChild(this.createBookBackground(), page, tabs);
        const completed = await runMonsterpediaPageTurn({
          renderer: this.opts.renderer,
          ticker: this.opts.ticker,
          host: this.root,
          outgoing: this.sceneRoot,
          incoming: incomingScene,
          widthPt: SCREEN_W,
          heightPt: SCREEN_H,
          backwards,
          commit: commitPage,
          signal: this.lifecycle.signal,
        });
        if (!completed || serial !== this.pageBuildSerial || this.disposed) return;
        // Only the captured book background is left; `page`/`tabs` were reparented by the commit.
        incomingScene.destroy({ children: true });
        incomingScene = undefined;
      } else {
        commitPage();
      }
      if (lockInput) await this.showCurrentScreenTutorial();
    } finally {
      incomingScene?.destroy({ children: true });
      if (next !== undefined && !next.destroyed) next.destroy({ children: true });
      if (nextTabs !== undefined && !nextTabs.destroyed) nextTabs.destroy({ children: true });
      this.pruneActions();
      if (serial === this.pageBuildSerial) this.transitionLocked = false;
      if (!this.disposed && serial === this.pageBuildSerial) {
        this.busy = false;
        this.strokeRecognizer.setEnabled(!this.expanded && this.category !== 5);
      }
    }
  }

  private visibleEntries(entries: readonly MonsterpediaEntry[]): readonly MonsterpediaEntry[] {
    if (this.category === 5) {
      return entries.slice(
        this.completeListSelectedIndex,
        this.completeListSelectedIndex + 1,
      );
    }
    const perPage = monsterpediaEntriesPerPage(this.category);
    return entries.slice(this.page * perPage, (this.page + 1) * perPage);
  }

  private cardPosition(index: number): { x: number; y: number } {
    if (this.category === 5) return COMPLETE_LAYOUT.cardTopLeft;
    const positions = this.category === 2
      ? BOOK_LAYOUT.recipeCardTopLeft
      : BOOK_LAYOUT.ordinaryCardTopLeft;
    const position = positions[index];
    if (!position) throw new Error(`Monsterpedia card index ${index} exceeds category grid`);
    return position;
  }

  private buildBookFooter(
    parent: Container,
    entries: readonly MonsterpediaEntry[],
  ): void {
    const complete = buildMonsterpediaCategory(this.opts.gd, this.opts.profile, 5);
    const found = monsterpediaFoundCount(complete);
    const completion = makeTtfLabel(
      formatMonsterpediaText(
        localizedString(this.opts.strings, "CompletionFormatKey"),
        monsterpediaCompletionPercent(found, complete.length),
      ),
      BOOK_LAYOUT.footer.fontPt,
      { fill: 0x000000, outline: false },
    );
    const page = makeTtfLabel(
      formatMonsterpediaText(
        localizedString(this.opts.strings, "PageFormatKey"),
        Math.max(1, this.page + 1),
        monsterpediaPageCount(entries.length, this.category),
      ),
      BOOK_LAYOUT.footer.fontPt,
      { fill: 0x000000, outline: false },
    );
    completion.anchor.set(0, 0);
    page.anchor.set(0, 0);
    const width = Math.max(completion.width, page.width);
    const centerX =
      BOOK_LAYOUT.screen.w -
      BOOK_LAYOUT.footer.rightInset -
      width / 2;
    completion.position.set(
      centerX - completion.width / 2,
      BOOK_LAYOUT.screen.h -
        BOOK_LAYOUT.footer.cocosBottom -
        completion.height,
    );
    page.position.set(
      centerX - page.width / 2,
      BOOK_LAYOUT.screen.h -
        BOOK_LAYOUT.footer.cocosBottom -
        completion.height -
        BOOK_LAYOUT.footer.gap -
        page.height,
    );
    const footer = new Container();
    footer.label = "monsterpediaFooter";
    footer.addChild(completion, page);
    parent.addChild(footer);
  }

  private buildCompleteListLabels(
    parent: Container,
    entries: readonly MonsterpediaEntry[],
    tintActions: RepeatingLabelAction[],
  ): void {
    const start = this.page;
    const end = Math.min(entries.length, start + COMPLETE_LAYOUT.visibleLabels);
    const labels = new Container();
    labels.label = "monsterpediaAll:labels";
    labels.position.set(COMPLETE_LAYOUT.labelsOrigin.x, COMPLETE_LAYOUT.labelsOrigin.y);
    for (let index = start; index < end; index += 1) {
      const entry = entries[index]!;
      const displayName = entry.known
        ? localizedRenderableName(this.opts.strings, [entry.monster.shortType])
        : "???";
      const label = makeTtfLabel(
        formatMonsterpediaText("%3d)%@", entry.ordinal, displayName),
        COMPLETE_LAYOUT.labelFontPt,
        { fill: 0x000000, outline: false },
      );
      label.label = `monsterpediaAll:label:${entry.monster.shortType}`;
      label.anchor.set(0, 0);
      const localIndex = index - start;
      const column = Math.floor(localIndex / COMPLETE_LAYOUT.rows);
      const row = localIndex % COMPLETE_LAYOUT.rows;
      label.position.set(
        column * COMPLETE_LAYOUT.cell.w,
        row * COMPLETE_LAYOUT.cell.h,
      );
      label.eventMode = "static";
      label.cursor = "pointer";
      label.on("pointertap", (event) => {
        event.stopPropagation();
        if (this.busy || index === this.completeListSelectedIndex) return;
        this.opts.playSfx("click");
        this.completeListSelectedIndex = index;
        void this.rebuildPage(false);
      });
      if (index === this.completeListSelectedIndex) {
        label.tint = 0x000000;
        tintActions.push({
          label,
          elapsedMs: 0,
          firstTick: true,
          running: false,
        });
      }
      labels.addChild(label);
    }
    parent.addChild(labels);
  }

  private buildCompleteListSummary(
    parent: Container,
    entries: readonly MonsterpediaEntry[],
  ): void {
    const found = monsterpediaFoundCount(entries);
    const pageCount = Math.max(
      1,
      Math.ceil(entries.length / COMPLETE_LAYOUT.visibleLabels),
    );
    const currentPage = Math.floor(this.page / COMPLETE_LAYOUT.visibleLabels) + 1;
    const labels = [
      formatMonsterpediaText(
        localizedString(this.opts.strings, "PageFormatKey"),
        currentPage,
        pageCount,
      ),
      localizedString(this.opts.strings, "MonstersFoundKey"),
      formatMonsterpediaText("%d/%d", found, entries.length),
    ].map((text) => {
      const label = makeTtfLabel(text, COMPLETE_LAYOUT.summary.fontPt, {
        fill: 0x000000,
        outline: false,
      });
      label.anchor.set(0, 0);
      return label;
    });
    const summary = new Box({
      horizontal: false,
      positiveAlignDirection: true,
      gap: COMPLETE_LAYOUT.summary.gapPt,
      roundingScale: COMPLETE_LAYOUT.roundingScale,
    });
    summary.label = "monsterpediaAll:summary";
    for (const label of labels) {
      // `makeTtfLabel` bakes at 2x and scales its node to 0.5. Box must therefore measure the
      // unscaled local content bounds before applying that node scale; `label.width` is already
      // scaled and would be halved a second time, pushing this right-aligned stack off-screen.
      summary.addBoxChild(label);
    }
    const position = COMPLETE_LAYOUT.summary.positionForSize(summary.boxContentSize);
    summary.position.set(position.x, position.y);
    parent.addChild(summary);
  }

  private async handleCardOpen(entry: MonsterpediaEntry): Promise<void> {
    if (this.busy || this.expanded) return;
    this.opts.playSfx("click");
    if (this.category === 5) {
      await this.lookAtCompleteListMonster(entry);
      return;
    }
    const chain = this.opts.gd.evolveChainOf(entry.monster.shortType).map(
      (shortType) => this.opts.gd.monsterByShortType(shortType),
    );
    const selectedKnown =
      monsterpediaInspectionLevel(entry.monster, this.opts.profile) !== undefined;

    if (entry.kind === "recipe") {
      if (!entry.recipeKnown) {
        await this.showMessage("NoRecipe");
        return;
      }
      if (chain.length >= 2 && selectedKnown) {
        await this.showExpanded(entry, chain);
      } else {
        await this.showMakeMonsterQuestion(entry);
      }
      return;
    }
    if (chain.length >= 2 && selectedKnown) {
      await this.showExpanded(entry, chain);
      return;
    }
    await this.lookAtMonster(entry);
  }

  private async showMakeMonsterQuestion(entry: MonsterpediaRecipeEntry): Promise<void> {
    let action: "make" | "look" | null = null;
    const content = buildLocalizedMonsterHatchMessageContent(this.opts.strings, "MakeMonsterQuestion");
    await new Promise<void>((resolve, reject) => {
      void showMonsterHatchPopup(this.popupEnvironment(), {
        title: localizedString(this.opts.strings, "MakeMonsterQuestionTitleKey"),
        content,
        buttons: [
          {
            label: localizedString(this.opts.strings, "MakeButtonKey"),
            onPress: () => { action = "make"; },
          },
          {
            label: localizedString(this.opts.strings, "LookButtonKey"),
            onPress: () => { action = "look"; },
          },
        ],
        onDismiss: resolve,
      }).catch(reject);
    });
    if (this.disposed) return;
    if (action === "make") await this.handleCombine(entry, false);
    else if (action === "look") await this.lookMonster(entry);
  }

  private async lookMonster(entry: MonsterpediaEntry): Promise<void> {
    const level = monsterpediaInspectionLevel(entry.monster, this.opts.profile);
    if (level === undefined) {
      await this.showMessage("NeverSeenMonster");
      return;
    }
    await this.showLivingInfo({ kind: "historyPreview", monster: entry.monster, level });
  }

  /** Complete List is inspection-only, including Combine-category entries. */
  private async lookAtCompleteListMonster(entry: MonsterpediaEntry): Promise<void> {
    const level = monsterpediaInspectionLevel(entry.monster, this.opts.profile);
    if (level === undefined) {
      await this.showMessage("NeverSeenMonster");
      return;
    }
    await this.showLivingInfo({ kind: "historyPreview", monster: entry.monster, level });
  }

  private async lookAtMonster(entry: MonsterpediaEntry): Promise<void> {
    const level = monsterpediaInspectionLevel(entry.monster, this.opts.profile);
    if (level === undefined) {
      await this.showMessage("NeverSeenMonster");
      return;
    }
    const { monster } = entry;
    if (monster.category === "Combine") {
      const entry = buildMonsterpediaCategory(this.opts.gd, this.opts.profile, 2)
        .find((candidate): candidate is MonsterpediaRecipeEntry =>
          candidate.kind === "recipe" &&
          candidate.monster.shortType === monster.shortType
        );
      if (!entry) throw new Error(`Monsterpedia: missing combine entry for ${monster.shortType}`);
      await this.showMakeMonsterQuestion(entry);
      return;
    }
    await this.showLivingInfo({ kind: "historyPreview", monster, level });
  }

  private async showLivingInfo(
    source: MonsterpediaInspectionSource,
  ): Promise<void> {
    const monster = source.monster;
    const level = source.kind === "partyInstance" ? source.instance.level : source.level;
    if (this.inspectionPending || this.disposed) return;
    const serial = ++this.inspectionSerial;
    const pageSerial = this.pageBuildSerial;
    const ownsBusy = !this.busy;
    this.inspectionPending = true;
    if (ownsBusy) {
      this.busy = true;
      this.strokeRecognizer.setEnabled(false);
    }
    try {
      const snapshot = this.buildInfoSnapshot(source);
      this.inspectionDebug = {
        kind: source.kind,
        ...(source.kind === "partyInstance" ? { instanceId: source.instance.instanceId } : {}),
        xpThisLevel: snapshot.xpThisLevel,
        hp: snapshot.hp,
        maxHp: snapshot.maxHp,
        soulStoneCount: snapshot.soulStones.length,
        evolveRows: snapshot.evolveRows,
      };
      const content = await buildLivingInfoContent(
        snapshot,
        this.opts.assets,
        this.opts.strings,
        {
          onElementTap: () => void this.showElementHelp(monster.element),
          onStatTap: (statType) => {
            const statName = LIVING_STAT_NAMES[statType];
            if (statName) void this.showMessage(`Stat${statName}Info`);
          },
          onXpTap: () => void this.showMessage("XPInfo"),
          onAbilityTap: (ability) => void this.showAbilityInfo(
            this.abilityInfoFor(
              monster,
              level,
              ability,
              source.kind === "partyInstance" ? source.instance.soulStone : undefined,
              source.kind === "partyInstance" ? source.instance.playerBuffs : undefined,
            ),
          ),
        },
      );
      if (
        this.disposed ||
        serial !== this.inspectionSerial ||
        pageSerial !== this.pageBuildSerial
      ) {
        content.destroy({ children: true });
        return;
      }
      await new Promise<void>((resolve, reject) => {
        void showMonsterHatchPopup(this.popupEnvironment(), {
          content,
          buttons: [{
            label: localizedString(this.opts.strings, "OkButtonKey"),
            onPress: () => {},
          }],
          onDismiss: resolve,
        }).catch(reject);
      });
    } finally {
      if (serial === this.inspectionSerial) this.inspectionDebug = null;
      if (serial === this.inspectionSerial) this.inspectionPending = false;
      if (
        ownsBusy &&
        !this.disposed &&
        serial === this.inspectionSerial &&
        pageSerial === this.pageBuildSerial
      ) {
        this.busy = false;
        this.strokeRecognizer.setEnabled(!this.expanded && this.category !== 5);
      }
    }
  }

  private buildInfoSnapshot(
    source: MonsterpediaInspectionSource,
  ): LivingInfoSnapshot {
    const monster = source.monster;
    const level = source.kind === "partyInstance" ? source.instance.level : source.level;
    const currentHp = source.kind === "partyInstance" ? source.instance.currentHp : undefined;
    const soulStone = source.kind === "partyInstance" ? source.instance.soulStone : undefined;
    const abilities: LivingInfoAbility[] = buildPlayerChoices(
      this.opts.gd,
      monster.shortType,
    ).map((choice) => ({
      kind: "usable",
      choice: {
        ...choice,
        displayName: localizedRenderableName(this.opts.strings, [
          choice.displayName,
          choice.abilityPath.split(".").at(-1)!,
        ]),
      },
    }));
    for (const ref of this.opts.gd.jobAbilitiesOrEmpty(monster.shortType)) {
      if (/^usable\d+$/.test(ref.slot)) continue;
      const typeName = ref.type.split(".").at(-1)!;
      const instanceName = ref.arguments["instanceName"];
      abilities.push({
        kind: "passive",
        ref,
        displayName: localizedRenderableName(this.opts.strings, [
          typeof instanceName === "string" ? instanceName : typeName,
          typeName,
        ]),
      });
    }
    const effective = monsterStats(
      monster,
      level,
      this.statChildren(soulStone, source.kind === "partyInstance" ? source.instance.playerBuffs : undefined),
    );
    const effectiveStat = (stat: StatName): number => effective[stat];
    const maxHp = effectiveStat("MaxHP");
    const xpPenalty = this.opts.gd.jobXpPenalty(monster.shortType);
    const summonSavedXp = monster.category === "Summon"
      ? this.opts.profile.spiritSnapshot().spirits.find(
          (candidate) => candidate.shortType === monster.shortType,
        )?.savedXp
      : undefined;
    return {
      name: localizedRenderableName(this.opts.strings, [monster.shortType]),
      monster,
      level,
      hp: Math.min(maxHp, Math.max(0, currentHp ?? maxHp)),
      maxHp,
      xpThisLevel: source.kind === "partyInstance"
        ? source.instance.cumulativeXp - jobXpForLevel(level, xpPenalty)
        : summonSavedXp === undefined
          ? 0
          : Math.max(0, summonSavedXp - jobXpForLevel(level, xpPenalty)),
      xpCostOfNextLevel: jobXpCostOfNextLevel(level, xpPenalty),
      stats: STAT_ENUM.map(([statType, statName]) => ({
        statType,
        value: effectiveStat(statName),
      })).filter((row) => row.value >= 1),
      abilities,
      soulStones: soulStone === undefined
        ? []
        : [{
            name: localizedRenderableName(this.opts.strings, [`${soulStone.element}SoulStone`]),
            stats: soulStoneStatRows(
              soulStone.level,
              this.opts.gd.soulStoneByElement(soulStone.element).enabledStats,
            ),
          }],
      evolveRows: evolveChainInfoRows(
        this.opts.gd.evolveChainOf(monster.shortType),
        (shortType) => this.opts.profile.highestRegisteredLevel(shortType) > 0,
        (shortType) => this.opts.gd.monsterByShortType(shortType),
      ).map((row) => {
        const rowMonster = this.opts.gd.monsterByShortType(row.shortType);
        const scale = (rowMonster.rendererData as Record<string, unknown> | undefined)?.["scale"];
        return {
          ...row,
          ...(typeof scale === "number" ? { rendererScale: scale } : {}),
        };
      }),
    };
  }

  /** Resolve a card subject's Living children for `monsterStats` — the shared
   *  `valueForCachedStat:` accumulator every stat display goes through. */
  private statChildren(
    soulStone: SoulStoneSetup | undefined,
    playerBuffs: PlayerBuffBonuses | undefined,
  ): MonsterStatChildren {
    return {
      ...(soulStone === undefined
        ? {}
        : {
            soulStone: {
              level: soulStone.level,
              enabledStats: this.opts.gd.soulStoneByElement(soulStone.element).enabledStats,
            },
          }),
      ...(playerBuffs === undefined ? {} : { playerBuffs }),
    };
  }

  private abilityInfoFor(
    monster: MonsterDef,
    level: number,
    ability: LivingInfoAbility,
    soulStone?: SoulStoneSetup,
    playerBuffs?: PlayerBuffBonuses,
  ): AbilityInfoModel {
    const stats = monsterStats(monster, level, this.statChildren(soulStone, playerBuffs));
    const context: AbilityInfoContext = { level, stats, element: monster.element };
    return ability.kind === "usable"
      ? buildAbilityInfoModel(
          this.opts.gd,
          this.opts.strings,
          monster.shortType,
          ability.choice,
          context,
        )
      : buildPassiveAbilityInfoModel(
          this.opts.gd,
          this.opts.strings,
          ability.ref,
          ability.displayName,
          context,
        );
  }

  private async showAbilityInfo(model: AbilityInfoModel): Promise<void> {
    const content = buildAbilityInfoContent(model);
    await new Promise<void>((resolve, reject) => {
      void showMonsterHatchPopup(this.popupEnvironment(), {
        content,
        buttons: [{
          label: localizedString(this.opts.strings, "OkButtonKey"),
          onPress: () => {},
        }],
        hideOverlays: true,
        onDismiss: resolve,
      }).catch(reject);
    });
  }

  private async showExpanded(
    entry: MonsterpediaEntry,
    chain: readonly MonsterDef[],
  ): Promise<void> {
    const monster = entry.monster;
    this.expanded = true;
    this.expandedExitBusy = false;
    this.strokeRecognizer.setEnabled(false);
    const originalCard = this.cards.get(monster.shortType)?.root;
    if (originalCard) originalCard.visible = false;

    const overlay = new Container();
    overlay.label = `monsterpediaExpanded:${monster.shortType}`;
    overlay.eventMode = "static";
    overlay.hitArea = new Rectangle(0, 0, SCREEN_W, SCREEN_H);
    overlay.on("pointertap", (event) => event.stopPropagation());
    const grey = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    grey.alpha = 0;
    grey.eventMode = "static";
    grey.label = "monsterpediaGreyout";
    grey.on("pointertap", (event) => event.stopPropagation());
    const cardLayer = new Container();
    cardLayer.label = "monsterpediaExpanded:cards";
    cardLayer.sortableChildren = true;
    overlay.addChild(grey, cardLayer);
    this.overlayRoot.addChild(overlay);

    const selectedIndex = chain.findIndex(
      (candidate) => candidate.shortType === monster.shortType,
    );
    if (selectedIndex < 0) {
      throw new Error(`Monsterpedia expansion group is missing ${monster.shortType}`);
    }
    const sourceGlobal = originalCard?.getGlobalPosition();
    const sourceLocal = sourceGlobal === undefined
      ? {
          x: SCREEN_W / 2 - MONSTERPEDIA_CARD_SIZE.w / 2,
          y: EXPANSION_LAYOUT.selectedTopLeft.y,
        }
      : overlay.toLocal(sourceGlobal);
    const chainTargets: Array<{
      readonly card: Container;
      readonly x: number;
      readonly y: number;
    }> = [];

    const cloneSpecs: Array<{
      readonly chainMonster: MonsterDef;
      readonly known: boolean;
      readonly targetX: number;
      readonly targetY: number;
      readonly zIndex: 1 | 2;
    }> = [{
      chainMonster: monster,
      known: true,
      targetX: EXPANSION_LAYOUT.selectedTopLeft.x,
      targetY: EXPANSION_LAYOUT.selectedTopLeft.y,
      zIndex: 2,
    }];
    for (let index = 0; index < selectedIndex; index += 1) {
      cloneSpecs.push({
        chainMonster: chain[index]!,
        known: true,
        targetX: EXPANSION_LAYOUT.bottomColumnX[index]!,
        targetY: EXPANSION_LAYOUT.bottomTop,
        zIndex: 1,
      });
    }
    if (selectedIndex + 1 < chain.length) {
      cloneSpecs.push({
        chainMonster: chain[selectedIndex + 1]!,
        known: false,
        targetX: EXPANSION_LAYOUT.bottomColumnX[2],
        targetY: EXPANSION_LAYOUT.bottomTop,
        zIndex: 1,
      });
    }

    const chainHandles = await Promise.all(cloneSpecs.map(async (spec) => {
      const { chainMonster } = spec;
      const highestLevel = monsterpediaDisplayLevel(chainMonster, this.opts.profile);
      const cloneEntry: MonsterpediaEntry = {
        kind: "monster",
        chain,
        monster: chainMonster,
        ordinal: this.opts.gd.monsterBookIndex(chainMonster.shortType),
        known: spec.known,
        highestLevel,
      };
      const card = await createMonsterpediaCard(
        this.opts.assets,
        this.cardAssets,
        this.opts.gd,
        this.opts.strings,
        cloneEntry,
        { onOpen: () => void this.lookAtMonster(cloneEntry) },
      );
      card.root.position.set(sourceLocal.x, sourceLocal.y);
      card.root.zIndex = spec.zIndex;
      chainTargets.push({
        card: card.root,
        x: spec.targetX,
        y: spec.targetY,
      });
      return { card, spec };
    }));
    const chainCards = chainHandles.map(({ card }) => card.root);
    if (this.disposed || !this.expanded || overlay.destroyed) {
      chainCards.forEach((card) => card.destroy({ children: true }));
      return;
    }
    cardLayer.addChild(...chainCards);

    const helpRoots: Container[] = [];
    for (const help of EXPANSION_LAYOUT.helpLines) {
      const line = this.makeExpandedHelpLine(help.name, help.flipX, help.flipY);
      line.position.set(help.x, help.y);
      line.alpha = 0;
      helpRoots.push(line);
      overlay.addChild(line);
    }

    // Source uses bare `leaveIcon.png` via spriteWithFile:, not an HD-folded point sprite.
    const close = new Sprite(this.tabTextures.leaveIcon);
    close.label = "monsterpediaExpandedClose";
    close.anchor.set(0, 0);
    close.position.set(
      EXPANSION_LAYOUT.closeTopLeft.x,
      EXPANSION_LAYOUT.closeTopLeft.y,
    );
    close.eventMode = "static";
    close.cursor = "pointer";
    close.hitArea = sourceMinimumHitArea(close);
    close.on("pointertap", (event) => {
      event.stopPropagation();
      this.opts.playSfx("click");
      void this.hideExpanded();
    });
    overlay.addChild(close);
    this.expandedPresentation = {
      overlay,
      grey,
      fadingNodes: [...helpRoots, close],
      helpNodes: helpRoots,
      cards: chainCards,
      cardStates: chainHandles.map(({ card, spec }) => ({
        node: card.root,
        shortType: spec.chainMonster.shortType,
        known: spec.known,
      })),
      sourceTopLeft: sourceLocal,
      ...(originalCard === undefined ? {} : { originalCard }),
    };

    const cardEntry = tween(
      this.opts.ticker,
      MONSTERPEDIA_EXPANSION_MS,
      (t) => {
        if (!grey.destroyed) grey.alpha = MONSTERPEDIA_EXPANSION_GREY_ALPHA * t;
        for (const target of chainTargets) {
          if (target.card.destroyed) continue;
          target.card.position.set(
            sourceLocal.x + (target.x - sourceLocal.x) * t,
            sourceLocal.y + (target.y - sourceLocal.y) * t,
          );
        }
      },
      (t) => t,
      this.lifecycle.signal,
    );
    const helpEntry = (async () => {
      await tween(
        this.opts.ticker,
        MONSTERPEDIA_HELP_DELAY_MS,
        () => {},
        (t) => t,
        this.lifecycle.signal,
      );
      if (this.disposed || !this.expanded || overlay.destroyed) return;
      await tween(
        this.opts.ticker,
        MONSTERPEDIA_HELP_FADE_MS,
        (t) => {
          if (this.expandedExitBusy) return;
          for (const line of helpRoots) if (!line.destroyed) line.alpha = t;
        },
        (t) => t,
        this.lifecycle.signal,
      );
    })();
    await Promise.all([cardEntry, helpEntry]);
  }

  private makeExpandedHelpLine(
    name: string,
    flipX: boolean,
    flipY: boolean,
  ): Container {
    const line = new Container();
    line.label = `monsterpediaHelp:${name}`;


    const label = makeTtfLabel(
      localizedString(this.opts.strings, `${name}Key`),
      EXPANSION_LAYOUT.helpFontPt,
      { fill: 0xffffff, outline: true, outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    label.anchor.set(flipX ? 1 : 0, 1);
    const helpLine = pointSprite(this.tabTextures.helpLine);
    const helpLineWidth = Math.abs(helpLine.width);
    const helpLineHeight = Math.abs(helpLine.height);
    // Cocos flip changes UVs without changing the quad. With Pixi negative scale as the local
    // texture-flip mechanism, a fixed far-edge anchor preserves the source quadrant in all cases.
    helpLine.anchor.set(1, 1);
    helpLine.scale.set(
      flipX ? -Math.abs(helpLine.scale.x) : Math.abs(helpLine.scale.x),
      flipY ? -Math.abs(helpLine.scale.y) : Math.abs(helpLine.scale.y),
    );
    const labelOffset = monsterpediaHelpLabelOffset(
      { w: helpLineWidth, h: helpLineHeight },
      EXPANSION_LAYOUT.helpLabelInset,
      flipX,
      flipY,
    );
    label.position.set(labelOffset.x, labelOffset.y);
    line.addChild(helpLine, label);
    line.eventMode = "static";
    const onTap = (event: { stopPropagation(): void }) => {
        event.stopPropagation();
        this.opts.playSfx("click");
        void this.showMessage(name);
    };
    helpLine.eventMode = "none";
    helpLine.cursor = "pointer";
    label.eventMode = "none";
    label.cursor = "pointer";
    const targetAt = (point: Readonly<{ x: number; y: number }>) => nearestMinimumHit(
      [helpLine, label].map((node) => {
        const bounds = node.getLocalBounds();
        const corners = [
          line.toLocal(node.toGlobal({ x: bounds.x, y: bounds.y })),
          line.toLocal(node.toGlobal({ x: bounds.x + bounds.width, y: bounds.y })),
          line.toLocal(node.toGlobal({ x: bounds.x, y: bounds.y + bounds.height })),
          line.toLocal(node.toGlobal({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })),
        ];
        const xs = corners.map(({ x }) => x);
        const ys = corners.map(({ y }) => y);
        const x = Math.min(...xs);
        const y = Math.min(...ys);
        return {
          value: node,
          contentRect: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y },
          ownScale: { x: 1, y: 1 },
        };
      }),
      point,
    );
    line.hitArea = { contains: (x, y) => targetAt({ x, y }) !== undefined };
    line.on("pointertap", onTap);
    return line;
  }

  private async hideExpanded(): Promise<void> {
    if (!this.expanded || this.expandedExitBusy) return;
    const presentation = this.expandedPresentation;
    if (presentation === undefined) return;
    this.expandedExitBusy = true;
    const exitTarget = {
      x: presentation.sourceTopLeft.x + this.tabTextures.leaveIcon.width,
      y: presentation.sourceTopLeft.y + this.tabTextures.leaveIcon.height,
    };
    const starts = presentation.cards.map((card) => ({
      card,
      x: card.position.x,
      y: card.position.y,
    }));
    const greyStartAlpha = presentation.grey.alpha;
    const fadeStarts = presentation.fadingNodes.map((node) => ({
      node,
      alpha: node.alpha,
    }));
    await tween(
      this.opts.ticker,
      MONSTERPEDIA_EXPANSION_MS,
      (t) => {
        if (!presentation.grey.destroyed) {
          presentation.grey.alpha = greyStartAlpha * (1 - t);
        }
        for (const start of fadeStarts) {
          if (!start.node.destroyed) start.node.alpha = start.alpha * (1 - t);
        }
        for (const start of starts) {
          if (start.card.destroyed) continue;
          start.card.position.set(
            start.x + (exitTarget.x - start.x) * t,
            start.y + (exitTarget.y - start.y) * t,
          );
        }
      },
      (t) => t,
      this.lifecycle.signal,
    );
    if (this.disposed) return;
    presentation.overlay.parent?.removeChild(presentation.overlay);
    presentation.overlay.destroy({ children: true });
    if (presentation.originalCard && !presentation.originalCard.destroyed) {
      presentation.originalCard.visible = true;
    }
    this.expandedPresentation = undefined;
    this.expanded = false;
    this.expandedExitBusy = false;
    this.strokeRecognizer.setEnabled(this.category !== 5 && !this.busy);
  }

  private async handleCombine(
    entry: MonsterpediaRecipeEntry,
    playClick = true,
  ): Promise<void> {
    if (this.busy) return;
    if (playClick) this.opts.playSfx("click");
    if (!this.editable) {
      await this.showMessage("OnlyMakeMonstersInTown");
      return;
    }
    if (!entry.recipeKnown) {
      await this.showMessage("NoRecipe");
      return;
    }
    if (!canSatisfyCombineRecipe(this.opts.partyMembers(), entry.recipe)) {
      await this.showMessage("MakeMonsterFail");
      return;
    }

    this.busy = true;
    this.strokeRecognizer.setEnabled(false);
    this.root.visible = false;
    const picked: string[] = [];
    const partySnapshot = this.opts.partyMembers();
    const candidateLists = entry.recipe.ingredients.map((ingredientType) =>
      combineIngredientCandidates(partySnapshot, ingredientType, new Set())
    );
    let completed = false;
    try {
      for (let slot = 0; slot < candidateLists.length; slot += 1) {
        const candidates = candidateLists[slot]!.filter(
          (instanceId) => !picked.includes(instanceId),
        );
        const selected = await this.pickIngredient(candidates, partySnapshot);
        if (selected === null) return;
        picked.push(selected);
      }
      await this.opts.combineMonsters({
        resultShortType: entry.recipe.resultShortType,
        firstIngredientId: picked[0]!,
        secondIngredientId: picked[1]!,
      });
      completed = true;
    } finally {
      if (!this.disposed) {
        this.root.visible = true;
        if (completed) {
          await this.rebuildPage(true);
        } else {
          this.busy = false;
          this.strokeRecognizer.setEnabled(!this.expanded && this.category !== 5);
        }
      }
    }
  }

  private async pickIngredient(
    candidateIds: readonly string[],
    partySnapshot: readonly MonsterpediaPartyMember[],
  ): Promise<string | null> {
    if (candidateIds.length === 0) return null;
    const byId = new Map(partySnapshot.map((member) => [member.instanceId, member]));
    const entries: MonsterManagementEntry[] = candidateIds.map((id) => {
      const member = byId.get(id);
      if (!member) throw new Error(`Monsterpedia picker: missing party member ${id}`);
      const monster = this.opts.gd.monsterByShortType(member.shortType);
      const rendererScale = (monster.rendererData as Record<string, unknown> | undefined)?.["scale"];
      return {
        id,
        shortType: member.shortType,
        level: member.level,
        stars: monster.stars,
        element: monster.element,
        ...(typeof rendererScale === "number" ? { rendererScale } : {}),
        ...(monster.evolveData === undefined
          ? {}
          : { evolveLevel: monster.evolveData.levelReq }),
        ...(member.currentHp === undefined ? {} : { dead: member.currentHp <= 0 }),
        ...(member.soulStone === undefined
          ? {}
          : { soulStoneElement: member.soulStone.element }),
      };
    });
    return await new Promise<string | null>((resolve, reject) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        const picker = this.picker;
        this.picker = undefined;
        if (picker && !picker.destroyed) picker.close();
        resolve(value);
      };
      void createMonsterManagementNode({
        assets: this.opts.assets,
        scale9: this.opts.scale9,
        strings: this.opts.strings,
        style: 2,
        entries,
        onClose: () => finish(null),
        onInspect: (id) => {
          const member = byId.get(id);
          if (!member) throw new Error(`Monsterpedia picker: missing inspected member ${id}`);
          void this.showLivingInfo({
            kind: "partyInstance",
            monster: this.opts.gd.monsterByShortType(member.shortType),
            instance: member,
          });
        },
        onSelect: (id) => finish(id),
        selectButtonText: localizedString(this.opts.strings, "ChooseButtonKey"),
        cancelButtonText: localizedString(this.opts.strings, "CancelButtonKey"),
        onElementHelp: (element) => void this.showElementHelp(element),
      }).then((picker) => {
        if (settled || this.disposed) {
          picker.close();
          return;
        }
        this.picker = picker;
        this.opts.parent.addChild(picker);
      }).catch(reject);
    });
  }

  private async showElementHelp(element: string): Promise<void> {
    if (!ELEMENTS.has(element)) return;
    const content = buildElementHelpContent(
      element as ElementHelpName,
      this.opts.strings,
    );
    await new Promise<void>((resolve, reject) => {
      void showMonsterHatchPopup(this.popupEnvironment(), {
        content,
        buttons: [{
          label: localizedString(this.opts.strings, "OkButtonKey"),
          onPress: () => {},
        }],
        onDismiss: resolve,
      }).catch(reject);
    });
  }

  private registerIngredientFlash(
    entry: MonsterpediaRecipeEntry,
    card: MonsterpediaCardHandle,
    actions: RepeatingSpriteAction[],
  ): void {
    for (let index = 0; index < card.ingredientNodes.length; index += 1) {
      const sprite = card.ingredientNodes[index]!;
      if (!this.ingredientVisualState(entry, index).pulse) continue;
      sprite.alpha = 1;
      actions.push({
        sprite,
        elapsedMs: 0,
        firstTick: true,
        running: false,
      });
    }
  }

  private ingredientVisualState(entry: MonsterpediaRecipeEntry, slot: number) {
    const shortType = entry.recipe.ingredients[slot];
    if (shortType === undefined) {
      throw new Error(`Monsterpedia recipe ${entry.recipe.resultShortType} has no ingredient ${slot}`);
    }
    return monsterpediaIngredientVisualState(
      entry.recipeKnown,
      this.opts.profile.highestRegisteredLevel(shortType) > 0,
      this.opts.partyMembers().some((member) => member.shortType === shortType),
    );
  }

  private startIngredientFlashActions(): void {
    for (let index = 0; index < this.ingredientFlashActions.length; index += 1) {
      const action = this.ingredientFlashActions[index]!;
      if (!action.sprite.destroyed) action.running = true;
    }
  }

  private startCompleteListTintActions(): void {
    for (let index = 0; index < this.completeListTintActions.length; index += 1) {
      const action = this.completeListTintActions[index]!;
      if (!action.label.destroyed) action.running = true;
    }
  }

  private pruneActions(): void {
    for (let index = this.ingredientFlashActions.length - 1; index >= 0; index -= 1) {
      if (this.ingredientFlashActions[index]!.sprite.destroyed) {
        this.ingredientFlashActions.splice(index, 1);
      }
    }
    for (let index = this.completeListTintActions.length - 1; index >= 0; index -= 1) {
      if (this.completeListTintActions[index]!.label.destroyed) {
        this.completeListTintActions.splice(index, 1);
      }
    }
  }

  private async showMessage(name: string): Promise<void> {
    const title = this.opts.strings[`${name}TitleKey`];
    if (this.opts.strings[`${name}MessageKey`] === undefined) {
      throw new Error(`Monsterpedia popup missing ${name}MessageKey`);
    }
    const content = buildLocalizedMonsterHatchMessageContent(this.opts.strings, name);
    await new Promise<void>((resolve, reject) => {
      void showMonsterHatchPopup(this.popupEnvironment(), {
        ...(title === undefined ? {} : { title }),
        content,
        buttons: [{
          label: localizedString(this.opts.strings, "OkButtonKey"),
          onPress: () => {},
        }],
        onDismiss: resolve,
      }).catch(reject);
    });
  }

  private async showCurrentScreenTutorial(): Promise<void> {
    if (this.disposed) return;
    const flag = this.category === 5 ? "FirstAllMonsterpedia" : "FirstMonsterpedia";
    if (this.opts.profile.hasTutorialFlag(flag)) return;
    // present() starts this outside rebuildPage's busy scope. The first-use claim must
    // own tabs, swipes and close too, or a second page can submit another claim mid-flight.
    const ownsBusy = !this.busy;
    if (ownsBusy) {
      this.busy = true;
      this.strokeRecognizer.setEnabled(false);
    }
    try {
      await this.opts.claimTutorialFlag?.(flag);
      if (this.disposed || !this.opts.profile.claimTutorialFlag(flag)) return;
      await this.showMessage(flag);
    } finally {
      if (ownsBusy && !this.disposed) {
        this.busy = false;
        this.strokeRecognizer.setEnabled(!this.expanded && this.category !== 5);
      }
    }
  }

  private async handleClose(): Promise<void> {
    if (this.disposed || this.closing) return;
    if (this.category === 5) {
      this.resetFromCompleteList();
      return;
    }
    this.closing = true;
    this.transitionLocked = true;
    this.strokeRecognizer.setEnabled(false);
    try {
      await this.opts.onClose();
    } finally {
      if (!this.disposed) this.dispose();
    }
  }

  private resetFromCompleteList(): void {
    if (this.disposed || this.category !== 5) return;
    // MonsterpediaAllNode Cancel constructs a new editable category-0/index-0 book.
    this.editable = true;
    this.root.label = "monsterpedia:editable";
    this.category = 0;
    this.page = 0;
    this.completeListSelectedIndex = 0;
    this.opts.showCategoryName(
      localizedString(
        this.opts.strings,
        MONSTERPEDIA_CATEGORY_LOCALIZATION_KEYS[0],
      ),
    );
    void this.rebuildPage(true);
  }

  private changePage(delta: number): void {
    if (this.busy || this.expanded || this.category === 5 || delta === 0) return;
    const entries = buildMonsterpediaCategory(this.opts.gd, this.opts.profile, this.category);
    const lastPage = monsterpediaPageCount(entries.length, this.category) - 1;
    const oldCategory = this.category;
    let category: MonsterpediaCategory = this.category;
    let page = this.page;
    if (delta < 0) {
      if (page > 0) page -= 1;
      else if (category > 0) {
        category = (category - 1) as MonsterpediaCategory;
        const previousEntries = buildMonsterpediaCategory(
          this.opts.gd,
          this.opts.profile,
          category,
        );
        page = monsterpediaPageCount(previousEntries.length, category) - 1;
      } else return;
    } else if (page < lastPage) {
      page += 1;
    } else if (category <= 3) {
      category = (category + 1) as MonsterpediaCategory;
      page = 0;
    } else return;
    this.opts.playSfx("click");
    this.category = category;
    this.page = page;
    if (category !== oldCategory) {
      this.opts.showCategoryName(
        localizedString(
          this.opts.strings,
          MONSTERPEDIA_CATEGORY_LOCALIZATION_KEYS[category],
        ),
      );
    }
    void this.rebuildPage(true, delta < 0);
  }

  private changeCompleteListPage(delta: number): void {
    if (this.busy || this.expanded || this.category !== 5 || delta === 0) return;
    const entries = buildMonsterpediaCategory(this.opts.gd, this.opts.profile, 5);
    const target = completeListPageStart(
      this.page,
      entries.length,
      COMPLETE_LAYOUT.visibleLabels,
      delta,
    );
    if (target === this.page) return;
    this.page = target;
    this.completeListSelectedIndex = target;
    void this.rebuildPage(false);
  }
}
