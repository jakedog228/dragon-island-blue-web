import { setOwnedTexture } from "@dib/renderer";
import {
  bitmapFontFile,
  Box,
  CONTENT_SCALE_FACTOR,
  ButtonSprite,
  makeBitmapLabel,
  makeTtfLabel,
  minimumHitRectLocal,
  OUTLINE_FADE_ALPHA,
  pointSprite,
  rectContainsPoint,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import { dungeonGemItemTier } from "@dib/engine/dungeon";
import {
  SOURCE_STORE_CAPTURE_CARD_LIMIT,
  storeCaptureCardCount,
  type PlayerProfile,
  type StoreReceivedItem,
  type StorePurchaseResult,
  type StoreStock,
} from "@dib/player-domain";
import type { GameData } from "@dib/gamedata/browser";
import {
  type BitmapText,
  Container,
  defaultFilterVert,
  Filter,
  GlProgram,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type Text,
  type Ticker,
  UniformGroup,
} from "pixi.js";
import {
  advanceCoverflowIndexFrames,
  coverflowEaseFrames,
  presentCoverflowIndex,
} from "../battle/monsterManagementMath.js";
import { idiomPairPt, screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { DIRECTOR_INTERFACE_Z_INDEX, PopupHost } from "../ui/popup.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import {
  buildMonsterHatchMessageBlock,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  SOURCE_STORE_CATEGORY_ORDER,
  storeCanBuyMultiple,
  storeCategoryAsset,
  storeCategoryLocalizationKey,
  storeStockDisplayName,
  storeStockForCategory,
  storeStockLongDescription,
  type StoreCategory,
  type StoreDisplayStock,
} from "./storeModel.js";
import {
  SOURCE_ITEM_QUALITY_COLORS,
  SOURCE_STORE_REFLECTION_ARGS,
  storeCarouselCardLayout,
  storeCarouselLayout,
  storeGemGlowAlpha,
  storeReflectionFit,
  storeReflectionTextureRect,
} from "./playerScreenLayoutMath.js";
import {
  nextStorePurchaseQuantity,
  SOURCE_STORE_INCREMENTER_DISABLED_TINT,
  SOURCE_STORE_PURCHASE_MAX_QUANTITY,
  SOURCE_STORE_PURCHASE_MIN_QUANTITY,
  SOURCE_STORE_PURCHASE_PRICE_PLACEHOLDER,
  storePurchaseLayout,
  type StorePurchaseLayout,
} from "./storePurchaseMath.js";

export interface StoreFlowOptions {
  readonly parent: Container;
  readonly owner: object;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly data: GameData;
  readonly profile: PlayerProfile;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly onClose: () => void;
  readonly onFirstShop: () => void | Promise<void>;
  /** A recovery continuation may show Store category 3 while the authority admits no purchase
   * command. When present, Buy fails closed through Store's existing purchase-error popup. */
  readonly purchaseUnavailableMessage?: string;
  readonly purchase: (
    stock: StoreStock,
    quantity: number,
  ) => StorePurchaseResult | Promise<StorePurchaseResult>;
  readonly presentCommittedRewards: (items: readonly StoreReceivedItem[]) => void | Promise<void>;
  readonly onEggPurchased: (kind: "silver" | "gold") => void | Promise<void>;
}

/** Source StoreNode interaction shell: category 0 and category 1..5 selections share one retained
 * full-screen ShopScreen, release/swipe selection, dedicated buy control, and close/back ID. */
export class StoreFlow extends Container {
  private category: 0 | StoreCategory = 0;
  private selectedIndex = 0;
  private visualIndex = 0;
  private lastRootIndex = 0;
  /** `StoreNode.popCategoryOverride` — set only by the Buy Gold route; see showGoldPurchaseCategory. */
  private popCategoryOverride: { category: 0 | StoreCategory; index: number } | undefined;
  /** Defeat recovery mounts Currency as Store's root, so its first back request closes Store. */
  private currencyIsInitialCategory = false;
  private quantity = 1;
  private closed = false;
  private resolveClosePromise!: () => void;
  private readonly closePromise = new Promise<void>((resolve) => {
    this.resolveClosePromise = resolve;
  });
  private purchasePending = false;
  private pointerStart: {
    id: number;
    x: number;
    y: number;
    anchorIndex: number;
    moved: boolean;
  } | undefined;
  private title!: Text;
  private description!: Text;
  /** The two source price rows; only the selection's own currency is ever visible. */
  private goldPrice!: PriceRow;
  private silverPrice!: PriceRow;
  private playerAssets!: Box;
  private playerGold!: PriceRow;
  private playerSilver!: PriceRow;
  private selectionSprite: Container | undefined;
  private carouselRoot: Container | undefined;
  private carouselCards: Array<{
    readonly index: number;
    readonly node: Container;
    readonly width: number;
    readonly height: number;
  }> = [];
  private largestCarouselWidth = 0;
  private tallestCarouselHeight = 0;
  private easeRemainderMs = 0;
  private refreshSerial = 0;
  private glowSprites: Container[] = [];
  private glowElapsedMs = 0;
  private readonly centers = {
    selection: { x: 0, y: 0 },
    buy: { x: 0, y: 0 },
    close: { x: 0, y: 0 },
  };

  private constructor(private readonly opts: StoreFlowOptions) {
    super();
  }

  static async show(opts: StoreFlowOptions): Promise<StoreFlow> {
    const flow = new StoreFlow(opts);
    await flow.build();
    const parent = PopupHost.presentationParentFor(opts.parent);
    parent.sortableChildren = true;
    parent.addChild(flow);
    await opts.onFirstShop();
    return flow;
  }


  showGoldPurchaseCategory(): void {
    if (this.closed) return;
    if (this.category === 3) {
      this.selectedIndex = 5;
      this.visualIndex = 5;
      this.updateCarouselValues();
      return;
    }
    this.popCategoryOverride = { category: this.category, index: this.displayedIndex() };
    this.category = 3;
    this.selectedIndex = 2;
    this.visualIndex = 2;
    this.quantity = 1;
    void this.refreshSelection();
  }


  showGoldPurchaseCategoryAndWait(): Promise<void> {
    if (this.closed) return this.closePromise;
    this.currencyIsInitialCategory = true;
    this.popCategoryOverride = undefined;
    this.category = 3;
    this.selectedIndex = 2;
    this.visualIndex = 2;
    this.quantity = 1;
    void this.refreshSelection();
    return this.closePromise;
  }

  requestBack(): boolean {
    if (this.currencyIsInitialCategory) {
      this.dispose();
      return true;
    }
    const override = this.popCategoryOverride;
    if (override !== undefined) {
      this.popCategoryOverride = undefined;
      this.category = override.category;
      this.selectedIndex = override.index;
      this.visualIndex = override.index;
      this.quantity = 1;
      void this.refreshSelection();
      return true;
    }
    if (this.category !== 0) {
      this.category = 0;
      this.selectedIndex = this.lastRootIndex;
      this.visualIndex = this.lastRootIndex;
      this.quantity = 1;
      void this.refreshSelection();
      return true;
    }
    this.dispose();
    return true;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.opts.ticker.remove(this.updateCarousel);
    try {
      this.opts.onClose();
    } finally {
      try {
        this.parent?.removeChild(this);
        this.destroy({ children: true });
      } finally {
        this.resolveClosePromise();
      }
    }
  }

  get debugState(): Record<string, unknown> {
    const selected = this.selected();
    return {
      open: !this.closed,
      category: this.category,
      selectedIndex: this.selectedIndex,
      visualIndex: this.visualIndex,
      presentedIndex: this.presentedIndex(),
      selectedId: selected?.id ?? null,
      quantity: this.quantity,
      purchasePending: this.purchasePending,
      stockCount: this.entries().length,
      cards: this.carouselCards.map(({ index, node }) => ({
        index,
        x: node.position.x,
        scale: node.scale.x,
        visible: node.visible,
        zIndex: node.zIndex,
      })),
      centers: this.centers,
      balances: {
        silver: this.opts.profile.snapshot().silver,
        gold: this.opts.profile.snapshot().gold,
      },
    };
  }

  private async build(): Promise<void> {
    const screen = screenPointsForMode(DISPLAY_MODE);
    const layout = storeCarouselLayout(DISPLAY_MODE);
    this.label = "store";
    this.zIndex = DIRECTOR_INTERFACE_Z_INDEX;
    this.eventMode = "static";
    this.cursor = "pointer";
    this.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    const background = sourceFullscreenSprite(
      await this.opts.assets.sprite("ShopScreen"),
      DISPLAY_MODE,
      "ShopScreen",
    );
    background.tint = 0x969696;
    background.eventMode = "none";
    this.addChild(background);

    // StoreNode has no title. Keep a zero-sized retained label so refresh/debug code does not
    // manufacture a second composition path.
    this.title = makeTtfLabel("", idiomPairPt(22, 44, DISPLAY_MODE), {
      fill: 0xffff88,
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    this.title.visible = false;
    this.title.anchor.set(0.5);
    this.title.position.set(screen.w / 2, idiomPairPt(32, 64, DISPLAY_MODE));
    this.addChild(this.title);
    this.description = makeTtfLabel("", idiomPairPt(18, 36, DISPLAY_MODE), {
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
      wordWrapWidth: idiomPairPt(300, 600, DISPLAY_MODE),
    });
    this.description.anchor.set(0.5, 0);
    this.description.position.set(screen.w / 2, layout.descriptionInset);
    this.addChild(this.description);
    const inventory = await this.opts.assets.atlas("InventoryItemFrames-hd");
    // Both persistent numeric groups are CCLabelBMFont; make sure their .fnt is resolved before
    // any label is constructed (makeBitmapLabel throws on a cold cache).
    await Promise.all([
      this.opts.assets.font(`${bitmapFontFile(20, true)}-hd`),
      this.opts.assets.font(`${bitmapFontFile(18, true)}-hd`),
    ]);
    const frame = (name: string): Texture => {
      const texture = inventory.textures[name];
      if (texture === undefined) throw new Error(`InventoryItemFrames-hd is missing ${name}`);
      return texture;
    };


    this.goldPrice = this.buildPriceRow(frame("spendGold.png"), "store:price:gold");
    this.silverPrice = this.buildPriceRow(frame("spendSilver.png"), "store:price:silver");
    for (const row of [this.goldPrice, this.silverPrice]) {
      row.root.position.set(
        Math.round((screen.w - row.root.boxContentSize.w) / 2),
        idiomPairPt(50, 100, DISPLAY_MODE) - row.root.boxContentSize.h / 2,
      );
      row.root.visible = false;
      this.addChild(row.root);
    }


    const assets = new Box({ gap: 0, positiveAlignDirection: true });
    assets.label = "store:playerAssets";
    assets.addBoxChild(makeTtfLabel(
      localizedString(this.opts.strings, "PlayerAssetsKey"),
      idiomPairPt(18, 36, DISPLAY_MODE),
      { outline: true, outlineAlpha: OUTLINE_FADE_ALPHA },
    ));
    this.playerGold = this.buildAssetRow(frame("pileGold.png"), "store:assets:gold");
    this.playerSilver = this.buildAssetRow(frame("pileSilver.png"), "store:assets:silver");
    for (const row of [this.playerGold, this.playerSilver]) {
      assets.addBoxChild(row.root, { contentSize: row.root.boxContentSize });
    }
    assets.position.set(
      unscaledIdiomPt(10, DISPLAY_MODE),
      screen.h - unscaledIdiomPt(10, DISPLAY_MODE) - assets.boxContentSize.h,
    );
    this.playerAssets = assets;
    this.addChild(assets);
    this.refreshPlayerAssets();


    const closeTexture = await this.opts.assets.sprite("PopupMenuCloseButton-hd");
    const close = new ButtonSprite({ normalTexture: closeTexture, pressSound: this.opts.onClick });
    close.label = "store:close";
    const closeBox = new Box({
      horizontal: true,
      gap: idiomPairPt(50, 100, DISPLAY_MODE),
      positiveAlignDirection: true,
    });
    closeBox.addBoxChild(close);
    closeBox.position.set(
      Math.round((screen.w - closeBox.boxContentSize.w) / 2),
      screen.h - unscaledIdiomPt(10, DISPLAY_MODE) - closeBox.boxContentSize.h,
    );
    close.onPress(() => this.requestBack());
    this.centers.close = {
      x: closeBox.position.x + closeBox.boxContentSize.w / 2,
      y: closeBox.position.y + closeBox.boxContentSize.h / 2,
    };
    this.addChild(closeBox);

    this.on("pointerdown", this.pointerDown);
    this.on("pointermove", this.pointerMoved);
    this.on("pointerup", this.pointerEnded);
    this.on("pointerupoutside", this.pointerEnded);
    this.opts.ticker.add(this.updateCarousel);
    await this.refreshSelection();
  }

  private readonly pointerDown = (event: FederatedPointerEvent): void => {
    if (this.purchasePending) return;
    const local = this.toLocal(event.global);
    if (!this.carouselContains(local.x, local.y)) return;
    event.stopPropagation();
    this.pointerStart = {
      id: event.pointerId,
      x: local.x,
      y: local.y,
      anchorIndex: this.selectedIndex,
      moved: false,
    };
  };

  private readonly pointerMoved = (event: FederatedPointerEvent): void => {
    const start = this.pointerStart;
    if (start === undefined || start.id !== event.pointerId || this.purchasePending) return;
    const local = this.toLocal(event.global);
    const dx = local.x - start.x;
    const dy = local.y - start.y;
    if (!start.moved && Math.hypot(dx, dy) > unscaledIdiomPt(15, DISPLAY_MODE)) {
      start.moved = true;
    }
    if (!start.moved || !(this.largestCarouselWidth > 0)) return;
    event.stopPropagation();
    const gain = 1 + Math.abs(this.visualIndex - this.selectedIndex) * 0.2;
    this.selectedIndex = Math.min(
      this.entries().length - 1,
      Math.max(0, start.anchorIndex + ((start.x - local.x) * gain) / this.largestCarouselWidth),
    );
    this.updateCarouselValues();
  };

  private readonly pointerEnded = (event: FederatedPointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = undefined;
    if (start === undefined || start.id !== event.pointerId || this.purchasePending) return;
    event.stopPropagation();
    if (start.moved) {
      this.selectedIndex = Math.floor(this.selectedIndex + 0.5);
      this.quantity = 1;
      this.updateCarouselValues();
      return;
    }
    const hit = [...this.carouselCards].reverse().find(({ node }) =>
      node.visible && node.getBounds().containsPoint(event.global.x, event.global.y));
    if (hit === undefined) {
      return;
    }
    const showingIndex = Math.floor(this.visualIndex + 0.5);
    if (hit.index !== showingIndex) {
      this.selectedIndex = hit.index;
      this.quantity = 1;
      this.updateCarouselValues();
      return;
    }
    if (this.category === 0) {
      this.lastRootIndex = showingIndex;
      this.category = SOURCE_STORE_CATEGORY_ORDER[showingIndex]!;
      this.selectedIndex = 0;
      this.visualIndex = 0;
      this.quantity = 1;
      void this.refreshSelection();
      return;
    }
    void this.performBuy();
  };

  private entries(): readonly StoreDisplayStock[] {
    return this.category === 0
      ? SOURCE_STORE_CATEGORY_ORDER.map((category) => ({
          id: `category-${category}`,
          kind: "iapGold" as const,
          tier: category,
          goldAmount: 0,
          canBuyMoreThanOne: false as const,
        }))
      : storeStockForCategory(this.category, this.opts.data, this.opts.profile);
  }

  private selected(): StoreDisplayStock | undefined {
    return this.entries()[this.displayedIndex()];
  }

  private async refreshSelection(): Promise<void> {
    const serial = ++this.refreshSerial;
    this.carouselRoot?.destroy({ children: true });
    this.carouselRoot = undefined;
    this.carouselCards = [];
    this.selectionSprite = undefined;
    const layout = storeCarouselLayout(DISPLAY_MODE);
    const entries = this.entries();
    if (entries.length === 0) {
      this.selectedIndex = 0;
      this.visualIndex = 0;
      this.description.text = localizedString(this.opts.strings, "AlreadyHaveMessageKey");
      this.refreshPrice();
      return;
    }
    this.selectedIndex = Math.min(this.selectedIndex, entries.length - 1);
    this.visualIndex = Math.min(this.visualIndex, entries.length - 1);
    const presentations = await Promise.all(entries.map(async (entry, index) => {
      if (this.category === 0) {
        const category = SOURCE_STORE_CATEGORY_ORDER[index]!;
        const node = pointSprite(await this.opts.assets.sprite(storeCategoryAsset(category)));
        return measureStoreContent(node);
      }
      return buildStoreProductContent(entry, this.opts);
    }));
    if (this.closed || serial !== this.refreshSerial) {
      presentations.forEach(({ node }) => node.destroy({ children: true }));
      return;
    }
    const largestWidth = Math.max(...presentations.map(({ sourceWidth }) => sourceWidth));
    const tallestHeight = Math.max(...presentations.map(({ visualHeight }) => visualHeight));
    if (!(largestWidth > 0) || !(tallestHeight > 0)) {
      throw new Error("Store CFlow content has invalid width");
    }
    this.largestCarouselWidth = largestWidth;
    this.tallestCarouselHeight = tallestHeight;
    const carousel = new Container();
    carousel.label = "store:carousel";
    carousel.sortableChildren = true;
    carousel.position.set(layout.center.x, layout.center.y);
    for (let index = 0; index < presentations.length; index += 1) {
      const presentation = presentations[index]!;
      const content = presentation.node;
      const bounds = content.getLocalBounds();
      const width = presentation.sourceWidth;
      const height = presentation.visualHeight;
      const card = new Container();
      card.label = `store:card:${index}`;
      content.position.set(
        -(bounds.x + bounds.width / 2) * content.scale.x,
        -(bounds.y + bounds.height) * content.scale.y,
      );
      card.addChild(content);
      const reflection = await this.buildReflection(entries[index]!, index, presentation, width);
      if (this.closed || serial !== this.refreshSerial) {
        card.destroy({ children: true });
        reflection?.destroy({ children: true });
        continue;
      }
      if (reflection !== undefined) {
        reflection.label = `store:reflection:${index}`;
        card.addChildAt(reflection, 0);
      }
      card.eventMode = "none";
      carousel.addChild(card);
      this.carouselCards.push({
        index,
        node: card,
        width,
        height,
      });
    }
    this.carouselRoot = carousel;
    this.glowSprites = [];
    const collectGlows = (node: Container): void => {
      if (node.label === STORE_GEM_GLOW_LABEL) this.glowSprites.push(node);
      for (const child of node.children) collectGlows(child as Container);
    };
    collectGlows(carousel);
    this.addChildAt(carousel, 1);
    this.centers.selection = layout.center;
    this.centers.buy = layout.center;
    this.updateCarouselValues();
  }

  private displayedIndex(): number {
    const count = this.entries().length;
    if (count === 0) return 0;
    return Math.min(count - 1, Math.max(0, Math.floor(this.visualIndex + 0.5)));
  }

  private readonly updateCarousel = (): void => {
    if (this.closed || this.carouselCards.length === 0) return;
    if (this.glowSprites.length > 0) {
      this.glowElapsedMs += this.opts.ticker.deltaMS;
      const alpha = storeGemGlowAlpha(this.glowElapsedMs);
      for (const glow of this.glowSprites) glow.alpha = alpha;
    }
    const timing = coverflowEaseFrames(
      this.easeRemainderMs + this.opts.ticker.deltaMS,
    );
    this.easeRemainderMs = timing.remainderMs;
    // No early return on `frames === 0`: the sub-frame presentation lane below still advances on
    // browser frames that do not complete a source frame.
    this.visualIndex = advanceCoverflowIndexFrames(
      this.visualIndex,
      this.selectedIndex,
      timing.frames,
    );
    this.updateCarouselValues();
  };

  /** The DISPLAY index: `visualIndex` carried across the sub-frame time banked in
   *  `easeRemainderMs`, equal to it at every source frame boundary. Card layout reads this;
   *  `displayedIndex` (selection, description, buy target) and the drag gain keep reading the
   *  exact source lane. */
  private presentedIndex(): number {
    return presentCoverflowIndex(this.visualIndex, this.selectedIndex, this.easeRemainderMs);
  }

  private updateCarouselValues(): void {
    const count = this.carouselCards.length;
    if (count === 0) return;
    const rounded = this.displayedIndex();
    const presented = this.presentedIndex();
    const centeredWidth = this.carouselCards[rounded]?.width;
    if (!(centeredWidth !== undefined && centeredWidth > 0)) {
      throw new Error("Store CFlow centered card has invalid width");
    }
    for (const card of this.carouselCards) {
      const cardLayout = storeCarouselCardLayout(
        card.index,
        presented,
        this.largestCarouselWidth,
        centeredWidth,
        count,
      );
      card.node.position.x = cardLayout.x;
      card.node.scale.set(cardLayout.scale);
      card.node.visible = cardLayout.visible;
      card.node.zIndex = cardLayout.zIndex;
      card.node.label = card.index === rounded
        ? this.category === 0 ? "store:selection" : "store:buy"
        : `store:card:${card.index}`;
    }
    this.selectionSprite = this.carouselCards[rounded]?.node;
    if (this.category === 0) {
      const category = SOURCE_STORE_CATEGORY_ORDER[rounded]!;
      this.description.text = localizedString(
        this.opts.strings,
        storeCategoryLocalizationKey(category),
      );
      this.refreshPrice();
    } else {
      const selected = this.entries()[rounded];
      this.description.text = selected === undefined
        ? localizedString(this.opts.strings, "AlreadyHaveMessageKey")
        : storeStockDisplayName(selected, this.opts.strings);
      this.refreshPrice();
    }
  }

  private carouselContains(x: number, y: number): boolean {
    if (this.carouselCards.length === 0) return false;
    const layout = storeCarouselLayout(DISPLAY_MODE);
    let left = Number.POSITIVE_INFINITY;
    let right = Number.NEGATIVE_INFINITY;
    for (const card of this.carouselCards) {
      if (!card.node.visible) continue;
      const halfWidth = card.width * card.node.scale.x / 2;
      left = Math.min(left, layout.center.x + card.node.position.x - halfWidth);
      right = Math.max(right, layout.center.x + card.node.position.x + halfWidth);
    }
    return x >= left && x <= right &&
      y >= layout.center.y - this.tallestCarouselHeight - layout.topBuffer &&
      y <= layout.center.y + layout.bottomBuffer;
  }


  private async buildReflection(
    entry: StoreDisplayStock,
    index: number,
    presentation: StoreContentPresentation,
    /** The card's own `contentSize.width`: `reflectionForSprite:` fits the mirror to it. */
    cardWidth: number,
  ): Promise<Container | undefined> {
    if (this.category === 0) {
      const category = SOURCE_STORE_CATEGORY_ORDER[index]!;


      const dedicated = category === 2
        ? "EggsCategoryReflection-hd"
        : category === 5
          ? "TotemsCategoryReflection-hd"
          : category === 4
            ? "RecipesCategoryReflection-hd"
            : undefined;
      if (dedicated !== undefined) {
        const args = SOURCE_STORE_REFLECTION_ARGS.categoryArt;
        return sourceReflection(
          await this.opts.assets.sprite(dedicated),
          args.percentOfHeight,
          args.fadeStart,
          args.fadeTo,
          cardWidth,
        );
      }


    }
    if (entry.kind === "recipe" || entry.kind === "spiritTotem") {
      const shortType = entry.kind === "recipe" ? entry.combineName : entry.shortType;
      const monster = pointSprite(await this.opts.assets.sprite(`${shortType}-hd`));
      const renderer = this.opts.data.monsterByShortType(shortType).rendererData as
        | { readonly scale?: unknown }
        | undefined;
      if (renderer?.scale !== undefined) {
        if (typeof renderer.scale !== "number" || !Number.isFinite(renderer.scale)) {
          throw new Error(`Store reflection ${shortType} has invalid renderer scale`);
        }
        monster.scale.set(
          monster.scale.x * renderer.scale,
          monster.scale.y * renderer.scale,
        );
      }


      void renderer;
      const args = entry.kind === "recipe"
        ? SOURCE_STORE_REFLECTION_ARGS.recipe
        : SOURCE_STORE_REFLECTION_ARGS.totem;
      return sourceReflection(
        monster.texture,
        args.percentOfHeight,
        args.fadeStart,
        args.fadeTo,
        cardWidth,
      );
    }
    // Everything left declined `addOwnReflectionToNode:`, so `CFlowNode` cuts the mirror from the
    // content node's own single texture rect.
    if (presentation.reflectionTexture === undefined) {
      throw new Error(`Store CFlow content ${index} has no texture to reflect`);
    }
    return genericReflection(presentation.reflectionTexture);
  }

  private buildPriceRow(icon: Texture, label: string): PriceRow {
    return this.buildIconValueRow(icon, label, idiomPairPt(20, 40, DISPLAY_MODE));
  }

  private buildAssetRow(icon: Texture, label: string): PriceRow {
    return this.buildIconValueRow(icon, label, idiomPairPt(18, 36, DISPLAY_MODE));
  }

  private buildIconValueRow(icon: Texture, label: string, sizePt: number): PriceRow {
    const root = new Box({
      horizontal: true,
      gap: idiomPairPt(5, 10, DISPLAY_MODE),
      positiveAlignDirection: true,
    });
    root.label = label;
    const value = makeBitmapLabel("0", sizePt, true);
    root.addBoxChild(pointSprite(icon));
    root.addBoxChild(value);
    return { root, value };
  }


  private refreshPrice(): void {
    const stock = this.selected();
    const cost = stock === undefined || this.category === 0 || stock.kind === "iapGold"
      ? 0
      : stock.unitPrice;
    const gold = cost > 0 && stock !== undefined && stock.kind !== "iapGold" &&
      stock.currency === "gold";
    this.goldPrice.root.visible = cost > 0 && gold;
    this.silverPrice.root.visible = cost > 0 && !gold;
    if (cost > 0) {
      (gold ? this.goldPrice : this.silverPrice).value.text = String(cost);
    }
  }

  private refreshPlayerAssets(): void {
    const snapshot = this.opts.profile.snapshot();
    this.playerGold.value.text = `:${snapshot.gold}`;
    this.playerSilver.value.text = `:${snapshot.silver}`;
    this.playerAssets.layoutChildren();
  }

  private async performBuy(): Promise<void> {
    const stock = this.selected();
    if (this.category === 0 || stock === undefined || this.purchasePending) return;
    if (this.opts.purchaseUnavailableMessage !== undefined) {
      this.opts.onBlocked();
      await this.showPurchaseError(this.opts.purchaseUnavailableMessage);
      return;
    }
    if (stock.kind === "iapGold") {


      this.opts.onBlocked();
      await this.showPurchaseError(EXTERNAL_PURCHASE_UNAVAILABLE);
      return;
    }
    this.purchasePending = true;
    try {
      await this.confirmPurchase(stock);
    } finally {
      this.purchasePending = false;
    }
  }

  private async confirmPurchase(stock: StoreStock): Promise<void> {
    this.quantity = 1;
    const layout = storePurchaseLayout(DISPLAY_MODE);
    const content = new Box({
      gap: layout.outerGap,
      // Native authors a negative-direction Cocos/Y-up Box. Enumerating toward positive Pixi Y
      // is the equivalent top-to-bottom picture after the coordinate-frame conversion.
      positiveAlignDirection: true,
      horizontalAlignment: 0,
      roundingScale: layout.roundingScale,
    });
    content.label = "store:purchase";
    const name = makeTtfLabel(
      storeStockDisplayName(stock, this.opts.strings),
      layout.nameFontSize,
      { outline: false },
    );
    name.label = "store:purchase:name";
    content.addBoxChild(name);
    const longDescription = storeStockLongDescription(
      stock,
      this.opts.strings,
      this.opts.data,
    );


    const description = makeTtfLabel(longDescription, layout.descriptionFontSize, {
      align: "left",
      wordWrapWidth: layout.descriptionWrapWidth,
      outline: false,
    });
    description.label = "store:purchase:description";
    content.addBoxChild(description);

    const priceLabel = makeTtfLabel(
      SOURCE_STORE_PURCHASE_PRICE_PLACEHOLDER,
      layout.priceFontSize,
      { outline: true, outlineWidthPt: layout.outlineWidth },
    );
    priceLabel.label = "store:purchase:price:value";
    const priceLabelContentSize = bareTtfContentSize(
      SOURCE_STORE_PURCHASE_PRICE_PLACEHOLDER,
      layout.priceFontSize,
    );
    const inventory = await this.opts.assets.atlas("InventoryItemFrames-hd");
    const priceIconTexture = inventory.textures[
      stock.currency === "gold" ? "spendGold.png" : "spendSilver.png"
    ];
    if (priceIconTexture === undefined) {
      throw new Error(`Store purchase popup is missing ${stock.currency} price icon`);
    }
    const priceRow = new Box({
      horizontal: true,
      gap: layout.priceGap,
      positiveAlignDirection: true,
      roundingScale: layout.roundingScale,
    });
    priceRow.label = "store:purchase:price";
    priceRow.addBoxChild(pointSprite(priceIconTexture));
    priceRow.addBoxChild(priceLabel, { contentSize: priceLabelContentSize });
    if (storeCanBuyMultiple(stock)) {
      const incrementer = await this.buildPurchaseIncrementer(stock, priceLabel, layout);
      content.addBoxChild(incrementer, { contentSize: incrementer.boxContentSize });
    } else {
      priceLabel.text = String(stock.unitPrice);
    }
    content.addBoxChild(priceRow, { contentSize: priceRow.boxContentSize });
    await showMonsterHatchPopup({
      parent: this,
      owner: this,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      ticker: this.opts.ticker,
      zIndex: 1100,
      sfx: { onButtonPress: this.opts.onClick, onButtonBlocked: this.opts.onBlocked },
    }, {
      content,
      contentLayoutBounds: content.boxLayoutBounds,
      hideOverlays: true,
      runScaleAction: false,
      buttons: [
        {
          label: localizedString(this.opts.strings, "PurchaseKey"),
          onPress: async () => {
            try {
              const result = await this.opts.purchase(stock, this.quantity);
              // Native purchase confirmation is gone before ItemPurchase mounts LootPageProvider.
              // Keeping this async popup alive hid both New Items and SlotMachineNode beneath its
              // modal layer, which made players close the Shop before they could hatch an Egg.
              if (!PopupHost.for(this).dismissTopOwnedBy(this)) {
                throw new Error("Store purchase confirmation lost popup ownership");
              }
              this.quantity = 1;
              this.refreshPlayerAssets();
              await this.refreshSelection();
              if (result.receivedItems.length > 0) {
                await this.opts.presentCommittedRewards(result.receivedItems);
              }
              if (result.pendingEggKind !== undefined) {
                await this.opts.onEggPurchased(result.pendingEggKind);
              }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (/insufficient silver/.test(message)) await this.showNamedMessage("NotEnoughSilver");
              else if (/insufficient gold/.test(message)) await this.showGoldPurchaseQuestion();
              else if (/capture-card inventory limit/.test(message)) await this.showMaxItemsMessage();


              else if (/already/.test(message)) {
                await this.showPurchaseError(
                  localizedString(this.opts.strings, "AlreadyHaveMessageKey"),
                );
              } else throw error;
            }
          },
        },
        {
          label: localizedString(this.opts.strings, "CloseButtonKey"),
          onPress: () => undefined,
        },
      ],
    });
  }


  private async buildPurchaseIncrementer(
    stock: StoreStock,
    priceLabel: Text,
    layout: StorePurchaseLayout,
  ): Promise<Box> {
    const prefix = localizedString(this.opts.strings, "PurchaseQuantityKey");
    const maximumText = `${prefix}${SOURCE_STORE_PURCHASE_MAX_QUANTITY}`;
    const quantityLabel = makeTtfLabel(maximumText, layout.quantityFontSize, {
      // Incramenter setCurrentIndex: sends outlineFadeBackgroundNode after every update.
      outline: true,
      outlineWidthPt: layout.outlineWidth,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    quantityLabel.label = "store:purchase:quantity:value";
    const quantityContentSize = bareTtfContentSize(maximumText, layout.quantityFontSize);

    const arrowTexture = await this.opts.assets.sprite(
      this.opts.assets.hasSprite("downArrow-hd") ? "downArrow-hd" : "downArrow",
    );
    const up = storePurchaseArrow(pointSprite(arrowTexture), "up", true);
    const down = storePurchaseArrow(pointSprite(arrowTexture), "down", false);
    const arrows = new Box({
      gap: layout.quantityArrowGap,
      positiveAlignDirection: true,
      roundingScale: layout.roundingScale,
    });
    arrows.label = "store:purchase:quantity:arrows";
    // Source enumerates [down, flipped-up] in Cocos Y-up. This is the equivalent visual order in
    // Pixi Y-down: the flipped up arrow is above the unmodified down arrow.
    arrows.addBoxChild(up.node, { contentSize: up.size });
    arrows.addBoxChild(down.node, { contentSize: down.size });

    const root = new Box({
      horizontal: true,
      gap: layout.quantityRootGap,
      positiveAlignDirection: true,
      roundingScale: layout.roundingScale,
    });
    root.label = "store:purchase:quantity";
    root.addBoxChild(arrows, { contentSize: arrows.boxContentSize });
    root.addBoxChild(quantityLabel, { contentSize: quantityContentSize });

    const arrowAt = (point: { readonly x: number; readonly y: number }): "up" | "down" | undefined => {
      const localX = point.x - arrows.position.x;
      const localY = point.y - arrows.position.y;
      const inNode = (
        node: Container,
        size: { readonly w: number; readonly h: number },
      ): boolean => rectContainsPoint(
        minimumHitRectLocal(
          { x: node.position.x, y: node.position.y, w: size.w, h: size.h },
          { x: 1, y: 1 },
        ),
        { x: localX, y: localY },
      );
      if (inNode(up.node, up.size)) return "up";
      if (inNode(down.node, down.size)) return "down";
      return undefined;
    };
    root.hitArea = { contains: (x, y) => arrowAt({ x, y }) !== undefined };
    root.eventMode = "static";
    root.cursor = "pointer";

    const update = (): void => {
      quantityLabel.text = `${prefix}${this.quantity}`;
      priceLabel.text = String(stock.unitPrice * this.quantity);
      up.sprite.tint = this.quantity === SOURCE_STORE_PURCHASE_MAX_QUANTITY
        ? SOURCE_STORE_INCREMENTER_DISABLED_TINT
        : 0xffffff;
      down.sprite.tint = this.quantity === SOURCE_STORE_PURCHASE_MIN_QUANTITY
        ? SOURCE_STORE_INCREMENTER_DISABLED_TINT
        : 0xffffff;
    };
    let tracking = false;
    const finish = (event: FederatedPointerEvent): void => {
      if (!tracking) return;
      tracking = false;
      const released = arrowAt(event.getLocalPosition(root));
      if (released !== undefined) {
        this.quantity = nextStorePurchaseQuantity(this.quantity, released);
        update();
      }
      event.stopPropagation();
    };
    root.on("pointerdown", (event: FederatedPointerEvent) => {
      if (arrowAt(event.getLocalPosition(root)) === undefined) return;
      tracking = true;
      event.stopPropagation();
    });
    root.on("pointerup", finish);
    root.on("pointerupoutside", finish);
    root.on("pointercancel", () => { tracking = false; });
    update();
    return root;
  }


  private async showNamedMessage(name: string): Promise<void> {
    await this.showMessagePopup(
      localizedString(this.opts.strings, `${name}TitleKey`),
      localizedString(this.opts.strings, `${name}MessageKey`),
      [{
        label: localizedString(this.opts.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
    );
  }


  private async showPurchaseError(message: string): Promise<void> {
    await this.showMessagePopup(
      localizedString(this.opts.strings, "UnableToBuyTitleKey"),
      message,
      [{
        label: localizedString(this.opts.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
    );
  }


  private async showGoldPurchaseQuestion(): Promise<void> {
    await this.showMessagePopup(
      localizedString(this.opts.strings, "BuyGoldTitleKey"),
      localizedString(this.opts.strings, "BuyGoldMessageKey"),
      [
        {
          label: localizedString(this.opts.strings, "YesButtonKey"),
          onPress: () => this.showGoldPurchaseCategory(),
        },
        {
          label: localizedString(this.opts.strings, "NoButtonKey"),
          onPress: () => undefined,
        },
      ],
    );
  }


  private async showMaxItemsMessage(): Promise<void> {
    await this.showPurchaseError(
      localizedString(this.opts.strings, "MaxItemsFormatKey")
        .replace("%d", String(SOURCE_STORE_CAPTURE_CARD_LIMIT))
        .replace("%d", String(storeCaptureCardCount(this.opts.profile))),
    );
  }

  private async showMessagePopup(
    title: string,
    message: string,
    buttons: readonly { label: string; onPress: () => void }[],
  ): Promise<void> {
    await showMonsterHatchPopup({
      parent: this,
      owner: this,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      ticker: this.opts.ticker,
      zIndex: 1200,
      sfx: { onButtonPress: this.opts.onClick, onButtonBlocked: this.opts.onBlocked },
    }, {
      title,
      content: buildMonsterHatchMessageBlock(message).root,
      buttons: [...buttons],
    });
  }
}

function bareTtfContentSize(
  value: string,
  fontSize: number,
): { readonly w: number; readonly h: number } {
  // Native outline nodes are separate children and never enlarge CCLabelTTF.contentSize. A bare
  // probe gives Box the label's actual source-owned content rectangle while the visible label can
  // retain its opaque outline.
  const probe = makeTtfLabel(value, fontSize, { outline: false });
  const bounds = probe.getLocalBounds();
  const size = { w: bounds.width, h: bounds.height };
  probe.destroy();
  return size;
}

function storePurchaseArrow(
  sprite: Sprite,
  direction: "up" | "down",
  flipY: boolean,
): {
  readonly node: Container;
  readonly sprite: Sprite;
  readonly size: { readonly w: number; readonly h: number };
} {
  const size = { w: sprite.width, h: sprite.height };
  const node = new Container();
  node.label = `store:quantity:${direction === "up" ? "plus" : "minus"}`;
  sprite.anchor.set(0.5);
  sprite.position.set(size.w / 2, size.h / 2);
  if (flipY) sprite.scale.y *= -1;
  sprite.eventMode = "none";
  node.addChild(sprite);
  return { node, sprite, size };
}

const STORE_GEM_GLOW_LABEL = "store:gemGlow";

interface PriceRow {
  readonly root: Box;
  readonly value: BitmapText;
}

/** Port-owned text: the source reaches StoreKit here, so there is no shipped string for a refusal.
 *  Kept out of the localized table so it can never be mistaken for recovered source copy. */
const EXTERNAL_PURCHASE_UNAVAILABLE = "Gold purchases are not available in this build.";

async function buildStoreProductContent(
  stock: StoreDisplayStock,
  opts: Pick<StoreFlowOptions, "assets" | "data">,
): Promise<StoreContentPresentation> {
  if (stock.kind === "iapGold") {
    return measureStoreContent(
      pointSprite(await opts.assets.sprite(`DIBlueGoldTier${stock.tier}-hd`)),
    );
  }
  if (stock.kind === "silverExchange") {
    return measureStoreContent(pointSprite(await opts.assets.sprite(
      stock.silverAmount === 500 ? "silverSmall-hd" : "silverBig-hd",
    )));
  }

  const atlas = await opts.assets.atlas("InventoryItemFrames-hd");
  let frame: string;
  if (stock.kind === "usable") {
    const renderer = opts.data.item(stock.definitionPath).rendererData as
      | { readonly spriteFrame?: unknown }
      | undefined;
    if (typeof renderer?.spriteFrame !== "string") {
      throw new Error(`Store item ${stock.definitionPath} has no spriteFrame`);
    }
    frame = renderer.spriteFrame;
  } else if (stock.kind === "egg") {
    frame = stock.onlyMonsters ? "MonsterEgg.png" : "Egg.png";
  } else if (stock.kind === "recipe") {
    frame = "Item_Recipe.png";
  } else if (stock.kind === "spiritTotem") {
    frame = "Item_Totem.png";
  } else {
    const slot = ["Novice", "Veteran", "Elite", "Grandmaster"][stock.slot]!;
    frame = `${slot}Gem${dungeonGemItemTier(stock.level)}.png`;
  }
  const texture = atlas.textures[frame];
  if (texture === undefined) throw new Error(`Store product atlas is missing ${frame}`);
  const root = new Container();
  const item = pointSprite(texture);
  root.addChild(item);
  if (stock.kind === "gem" && stock.quality > 0) {
    const slot = ["Novice", "Veteran", "Elite", "Grandmaster"][stock.slot]!;
    const glowTexture = atlas.textures[`${slot}GemGlow.png`];
    if (glowTexture === undefined) throw new Error(`Store product atlas is missing ${slot}GemGlow.png`);
    const glow = pointSprite(glowTexture);


    glow.tint = SOURCE_ITEM_QUALITY_COLORS[stock.quality] ?? 0x000000;
    glow.label = STORE_GEM_GLOW_LABEL;
    // Centre the glow on the gem the way `setPosition:(contentSize.width*0.5,
    // contentSize.height*0.5)` with a 0.5 anchor does. `getLocalBounds()` is in UNSCALED texture
    // pixels while `position` is in the parent's points, so each centre must be taken through its
    // own sprite scale — mixing the two displaced the halo by exactly one `pointSprite` factor.
    const itemBounds = item.getLocalBounds();
    const glowBounds = glow.getLocalBounds();
    glow.position.set(
      (itemBounds.x + itemBounds.width / 2) * item.scale.x -
        (glowBounds.x + glowBounds.width / 2) * glow.scale.x,
      (itemBounds.y + itemBounds.height / 2) * item.scale.y -
        (glowBounds.y + glowBounds.height / 2) * glow.scale.y,
    );
    root.addChildAt(glow, 0);
    // `-[GlowingGemNode setupForRenderable:context:]` adds the glow as a z=-1 CHILD and never
    // touches the node's own `contentSize`, which stays the gem's. Measuring the composed bounds
    // instead let the halo inflate the card, widening CFlow spacing and the reflection fit.
    return measureStoreContent(root, 1, item);
  }
  return measureStoreContent(root, 1, item);
}

interface StoreContentPresentation {
  readonly node: Container;
  /** Native Cocos `contentSize.width`, excluding runtime node scale and reflection children. */
  readonly sourceWidth: number;
  /** Native `scaledContentSize.height`, used only to construct the CFlow touch band. */
  readonly visualHeight: number;
  /**
   * The node's own `[sprite texture]`/`textureRect` as `reflectionForSprite:` reads them — the
   * single frame the generic mirror is cut from, never the composed children.
   */
  readonly reflectionTexture: Texture | undefined;
}

function measureStoreContent(
  node: Container,
  runtimeScale = 1,
  /** Source `contentSize` carrier when the node composes extra children the size excludes. */
  measured: Container = node,
): StoreContentPresentation {
  if (!(runtimeScale > 0)) throw new Error(`invalid Store content runtime scale ${runtimeScale}`);
  const bounds = measured.getLocalBounds();
  const sourceWidth = bounds.width * Math.abs(measured.scale.x) / runtimeScale;
  const visualHeight = bounds.height * Math.abs(measured.scale.y);
  if (!(sourceWidth > 0) || !(visualHeight > 0)) {
    throw new Error("Store content has an invalid source size");
  }
  return Object.freeze({
    node,
    sourceWidth,
    visualHeight,
    reflectionTexture: measured instanceof Sprite ? measured.texture : undefined,
  });
}


function sourceReflection(
  texture: Texture,
  percentOfHeight: number,
  fadeStart: number,
  fadeTo: number,
  /** `parentOverride.contentSize.width`, or `undefined` when the sprite is its own parent. */
  fitWidth: number | undefined,
): Container {
  const cut = storeReflectionTextureRect(texture.frame, percentOfHeight);
  const cropped = new Texture({
    source: texture.source,
    frame: new Rectangle(cut.x, cut.y, cut.width, cut.height),
  });
  const sprite = pointSprite(cropped);
  setOwnedTexture(sprite, cropped);


  const fit = storeReflectionFit(texture.frame.width / CONTENT_SCALE_FACTOR, fitWidth);
  // Bottom-centre anchor plus the negated Y scale: the mirror grows DOWNWARD from the card base.
  sprite.anchor.set(0.5, 1);
  sprite.scale.set(sprite.scale.x * fit, -sprite.scale.y * fit);
  sprite.filters = [storeReflectionFade(fadeStart, fadeTo)];
  return sprite;
}


function genericReflection(texture: Texture): Container {
  const { percentOfHeight, fadeStart, fadeTo } = SOURCE_STORE_REFLECTION_ARGS.cflow;
  return sourceReflection(texture, percentOfHeight, fadeStart, fadeTo, undefined);
}

const STORE_REFLECTION_FRAGMENT = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec2 uFade;
uniform highp vec4 uInputClamp;

void main(void) {
  float span = max(uInputClamp.w, 1e-5);
  float fade = mix(uFade.x, uFade.y, clamp(vTextureCoord.y / span, 0.0, 1.0));
  finalColor = texture(uTexture, vTextureCoord) * fade;
}
`;

function storeReflectionFade(startAlpha: number, endAlpha: number): Filter {
  return new Filter({
    glProgram: GlProgram.from({
      name: "store-reflection-fade",
      vertex: defaultFilterVert,
      fragment: STORE_REFLECTION_FRAGMENT,
    }),
    resources: {
      fadeUniforms: new UniformGroup({
        uFade: {
          value: new Float32Array([startAlpha / 255, endAlpha / 255]),
          type: "vec2<f32>",
        },
      }),
    },
  });
}
