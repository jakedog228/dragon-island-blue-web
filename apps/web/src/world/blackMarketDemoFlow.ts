import {
  makeTtfLabel,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import {
  Container,
  Graphics,
  Rectangle,
  type FederatedPointerEvent,
  type Texture,
} from "pixi.js";
import type { DisplayMode } from "../displayMode.js";
import { screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";
import { PopupHost } from "../ui/popup.js";
import { prepareMenuButton2 } from "../ui/menuButton2.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import {
  BLACK_MARKET_DEMO_CARDS,
  openBlackMarketDemoCard,
  type BlackMarketDemoCard,
  type DemoImageLoadHandle,
  type DemoImageLoader,
  type DemoImageLoadResult,
  type ExternalPageOpener,
} from "./blackMarketDemoModel.js";
import { blackMarketDemoLayout } from "./blackMarketDemoMath.js";
import { resolveBlackMarketCloseSpriteKey } from "./blackMarketCloseSprite.js";

export interface BlackMarketDemoDebugState {
  readonly kind: "black-market-demo";
  readonly adaptation: "DEMO CONTENT";
  readonly cardIds: readonly BlackMarketDemoCard["id"][];
  readonly imageStatus: Readonly<Record<BlackMarketDemoCard["id"], ImageStatus>>;
}

export interface BlackMarketDemoFlowOptions {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly displayMode: DisplayMode;
  /** The resolved structural Menus.plist BlackMarket background key. Defaults to NewsScreen. */
  readonly backgroundSpriteKey?: string;
  readonly imageLoader: DemoImageLoader<Texture>;
  readonly opener: ExternalPageOpener;
  readonly onClose: () => void;
}

type ImageStatus = "loading" | "loaded" | "fallback";
type CardId = BlackMarketDemoCard["id"];

interface CardVisualMetrics {
  readonly imageX: number;
  readonly imageY: number;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly titleX: number;
  readonly titleY: number;
  readonly bodyX: number;
  readonly bodyY: number;
  readonly bodyWidth: number;
  readonly bodyFontSize: number;
  readonly titleFontSize: number;
  readonly fallbackFontSize: number;
}

/**
 * PORT ADAPTATION / DEMO CONTENT.
 *
 * The image windows, title/body positions, and text sizes below are invented presentation
 * geometry for this demo. They are paired explicitly for the two supported idioms; none is a
 * native BlackMarket value. The MenuButton2 frame and close placement are the only structural
 * menu assets used here.
 */
function cardVisualMetrics(mode: DisplayMode): CardVisualMetrics {
  return mode === "ipad"
    ? {
        imageX: 10,
        imageY: 38,
        imageWidth: 209,
        imageHeight: 120,
        titleX: 13,
        titleY: 170,
        bodyX: 13,
        bodyY: 198,
        bodyWidth: 203,
        bodyFontSize: 12,
        titleFontSize: 15,
        fallbackFontSize: 12,
      }
    : {
        imageX: 10,
        imageY: 34,
        imageWidth: 194,
        imageHeight: 100,
        titleX: 13,
        titleY: 142,
        bodyX: 13,
        bodyY: 169,
        bodyWidth: 188,
        bodyFontSize: 11,
        titleFontSize: 14,
        fallbackFontSize: 11,
      };
}

// Native `Menus.plist.BlackMarket.itemBackgroundScale9 = MenuButton2`; these are that shipped
// Scale9 center-region origin in points, not invented card padding.
const CARD_FRAME_MARGIN_X = 9;
const CARD_FRAME_MARGIN_Y = 6;
// PORT ADAPTATION / DEMO CONTENT: this neutral local color is the error-panel treatment for a
// retired image host; it is not a shipped Black Market color.
const IMAGE_FALLBACK_COLOR = 0x777777;
// PORT ADAPTATION / DEMO CONTENT: the fallback copy is local and intentionally host-independent.
const IMAGE_FALLBACK_TEXT = "Image unavailable";

/** App-owned presentation modal for the retired Black Market destination. */
export class BlackMarketDemoFlow extends Container {
  private readonly imageStatus: Record<CardId, ImageStatus> = {
    preservation: "loading",
    community: "loading",
  };
  private readonly pendingLoads = new Map<CardId, DemoImageLoadHandle>();
  private readonly acceptedImages = new Map<CardId, DemoImageLoadResult<Texture>>();
  private readonly releasedResults = new WeakSet<object>();
  private readonly imageLayers = new Map<CardId, Container>();
  /** Textures made by this flow (currently the source crop); asset-library textures stay shared. */
  private readonly ownedTextures = new Set<Texture>();
  private mountedParent: Container | undefined;
  private mounted = false;
  private closed = false;

  constructor(private readonly options: BlackMarketDemoFlowOptions) {
    super();
  }

  static async show(options: BlackMarketDemoFlowOptions): Promise<BlackMarketDemoFlow> {
    const flow = new BlackMarketDemoFlow(options);
    await flow.mount();
    return flow;
  }

  async mount(): Promise<void> {
    if (this.closed) throw new Error("BlackMarketDemoFlow: cannot mount a disposed flow");
    if (this.mounted) throw new Error("BlackMarketDemoFlow: flow is already mounted");
    try {
      const built = await this.build();
      if (this.closed || !built) return;
      const parent = PopupHost.presentationParentFor(this.options.parent);
      if (this.closed) return;
      parent.sortableChildren = true;
      parent.addChild(this);
      this.mountedParent = parent;
      this.mounted = true;
      this.startImageLoads();
    } catch (error) {
      // A WorldNode may dispose its owned flow while a structural sprite promise is pending.
      // That disposal already performed ownership release and display cleanup; once the awaited
      // promise rejects, resolve the abandoned mount instead of leaking an unhandled rejection.
      // Active structural failures still dispose and rethrow so callers can fail loudly and retry.
      if (this.closed) return;
      this.dispose();
      throw error;
    }
  }

  /** WorldNode's Escape/back seam. */
  requestBack(): boolean {
    if (this.closed) return false;
    this.dispose();
    return true;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    const pending = [...this.pendingLoads.values()];
    this.pendingLoads.clear();
    for (const handle of pending) handle.cancel();
    this.mountedParent?.removeChild(this);
    this.mountedParent = undefined;
    try {
      this.options.onClose();
    } finally {
      this.destroyDisplayAndOwnedResources();
    }
  }

  /** This shape is intentionally exact: it is the deterministic debug contract for Task 2. */
  get debugState(): BlackMarketDemoDebugState {
    return {
      kind: "black-market-demo",
      adaptation: "DEMO CONTENT",
      cardIds: BLACK_MARKET_DEMO_CARDS.map((card) => card.id),
      imageStatus: {
        preservation: this.imageStatus.preservation,
        community: this.imageStatus.community,
      },
    };
  }

  private async build(): Promise<boolean> {
    const screen = screenPointsForMode(this.options.displayMode);
    const layout = blackMarketDemoLayout(this.options.displayMode);
    const metrics = cardVisualMetrics(this.options.displayMode);
    this.label = "blackMarketDemo";
    this.zIndex = 900;
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    for (const event of [
      "pointerdown",
      "pointerup",
      "pointerupoutside",
      "pointertap",
      "pointermove",
      "pointercancel",
    ] as const) {
      this.on(event, (pointerEvent) => pointerEvent.stopPropagation());
    }

    const backgroundTexture = await this.options.assets.sprite(
      this.options.backgroundSpriteKey ?? "NewsScreen",
    );
    if (this.closed) return false;
    const background = sourceFullscreenSprite(
      backgroundTexture,
      this.options.displayMode,
      "NewsScreen",
    );
    this.ownedTextures.add(background.texture);
    background.eventMode = "none";
    background.zIndex = -10;
    this.addChild(background);

    const heading = makeTtfLabel("DEMO CONTENT", layout.label.fontSize, {
      fill: 0xffff88,
      outlineWidthPt: 2,
      textureScaleMode: "nearest",
    });
    heading.label = "blackMarketDemo:heading";
    heading.anchor.set(0.5);
    heading.position.set(layout.label.x, layout.label.y);
    heading.eventMode = "none";
    this.addChild(heading);

    for (const [index, card] of BLACK_MARKET_DEMO_CARDS.entries()) {
      const builtCard = await this.buildCard(card, layout.cards[index]!, metrics);
      if (this.closed || !builtCard) return false;
    }

    const closeKey = resolveBlackMarketCloseSpriteKey(this.options.assets);
    if (closeKey === undefined) {
      throw new Error(
        "BlackMarketDemoFlow: missing PopupMenuCloseButton-hd or PopupMenuCloseButton",
      );
    }
    const closeTexture = await this.options.assets.sprite(closeKey);
    if (this.closed) return false;
    const close = pointSprite(closeTexture);
    close.label = "blackMarketDemo:close";
    close.anchor.set(1, 0);
    close.eventMode = "static";
    close.cursor = "pointer";
    close.position.set(
      screen.w - unscaledIdiomPt(10, this.options.displayMode),
      unscaledIdiomPt(10, this.options.displayMode),
    );
    close.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (!this.closed) this.dispose();
    });
    this.addChild(close);
    return true;
  }

  private async buildCard(
    card: BlackMarketDemoCard,
    layout: BlackMarketDemoLayoutCard,
    metrics: CardVisualMetrics,
  ): Promise<boolean> {
    const cardNode = new Container();
    cardNode.label = `blackMarketDemo:card:${card.id}`;
    cardNode.position.set(layout.x, layout.y);
    cardNode.eventMode = "static";
    cardNode.hitArea = new Rectangle(0, 0, layout.width, layout.height);
    cardNode.cursor = "pointer";
    cardNode.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (this.closed) return;
      openBlackMarketDemoCard(card.id, this.options.opener);
    });

    const frameLabel = makeTtfLabel("", 1, { outline: false });
    frameLabel.visible = false;
    let preparedFrame: Awaited<ReturnType<typeof prepareMenuButton2>>;
    try {
      preparedFrame = await prepareMenuButton2({
        scale9: this.options.scale9,
        assets: this.options.assets,
        label: frameLabel,
        layoutContentSize: { w: layout.width, h: layout.height },
        backgroundContentSize: {
          w: layout.width - 2 * CARD_FRAME_MARGIN_X,
          h: layout.height - 2 * CARD_FRAME_MARGIN_Y,
        },
        backgroundPosition: { x: 0, y: 0 },
      });
    } catch (error) {
      cardNode.destroy({ children: true });
      throw error;
    }
    if (this.closed) {
      preparedFrame.node.destroy({ children: true });
      cardNode.destroy({ children: true });
      return false;
    }
    preparedFrame.node.label = `blackMarketDemo:frame:${card.id}`;
    preparedFrame.node.eventMode = "none";
    cardNode.addChild(preparedFrame.node);

    const imageLayer = new Container();
    imageLayer.label = `blackMarketDemo:imageWindow:${card.id}`;
    imageLayer.position.set(metrics.imageX, metrics.imageY);
    imageLayer.eventMode = "none";
    this.imageLayers.set(card.id, imageLayer);
    cardNode.addChild(imageLayer);
    this.renderLoading(card.id, metrics);

    const title = makeTtfLabel(card.title, metrics.titleFontSize, {
      fill: 0xffffff,
      outlineWidthPt: 1,
      textureScaleMode: "nearest",
    });
    title.label = `blackMarketDemo:title:${card.id}`;
    title.position.set(metrics.titleX, metrics.titleY);
    title.eventMode = "none";
    cardNode.addChild(title);

    const body = makeTtfLabel(card.body, metrics.bodyFontSize, {
      fill: 0xffffff,
      outline: false,
      wordWrapWidth: metrics.bodyWidth,
      textureScaleMode: "nearest",
    });
    body.label = `blackMarketDemo:body:${card.id}`;
    body.position.set(metrics.bodyX, metrics.bodyY);
    body.eventMode = "none";
    cardNode.addChild(body);

    this.addChild(cardNode);
    return true;
  }

  private startImageLoads(): void {
    for (const card of BLACK_MARKET_DEMO_CARDS) {
      let settled = false;
      const onLoad = (result: DemoImageLoadResult<Texture>): void => {
        if (this.acceptedImages.get(card.id) === result) return;
        if (this.closed || settled || this.imageStatus[card.id] !== "loading") {
          this.releaseResultOnce(result);
          return;
        }
        settled = true;
        this.pendingLoads.delete(card.id);
        this.imageStatus[card.id] = "loaded";
        this.acceptedImages.set(card.id, result);
        try {
          this.renderLoaded(card.id, result.image);
        } catch (error) {
          this.acceptedImages.delete(card.id);
          this.releaseResultOnce(result);
          throw error;
        }
      };
      const onError = (): void => {
        if (this.closed || settled || this.imageStatus[card.id] !== "loading") return;
        settled = true;
        this.pendingLoads.delete(card.id);
        this.imageStatus[card.id] = "fallback";
        this.renderFallback(card.id);
      };
      const handle = this.options.imageLoader.load(card.imageUrl, onLoad, onError);
      if (!settled && !this.closed) {
        this.pendingLoads.set(card.id, handle);
      } else if (this.closed) {
        handle.cancel();
      }
    }
  }

  private releaseResultOnce(result: DemoImageLoadResult<Texture>): void {
    if (this.releasedResults.has(result)) return;
    this.releasedResults.add(result);
    result.release();
  }

  private renderLoading(cardId: CardId, metrics: CardVisualMetrics): void {
    const layer = this.imageLayers.get(cardId);
    if (layer === undefined) return;
    const loading = new Graphics()
      .rect(0, 0, metrics.imageWidth, metrics.imageHeight)
      .fill({ color: 0x555555 });
    loading.label = `blackMarketDemo:loading:${cardId}`;
    loading.eventMode = "none";
    layer.addChild(loading);
  }

  private renderLoaded(cardId: CardId, image: Texture): void {
    const layer = this.imageLayers.get(cardId);
    if (layer === undefined) return;
    const metrics = cardVisualMetrics(this.options.displayMode);
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const sprite = pointSprite(image);
    sprite.label = `blackMarketDemo:image:${cardId}`;
    sprite.width = metrics.imageWidth;
    sprite.height = metrics.imageHeight;
    sprite.eventMode = "none";
    layer.addChild(sprite);
  }

  private renderFallback(cardId: CardId): void {
    const layer = this.imageLayers.get(cardId);
    if (layer === undefined) return;
    const metrics = cardVisualMetrics(this.options.displayMode);
    layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const fallback = new Container();
    fallback.label = `blackMarketDemo:fallback:${cardId}`;
    fallback.eventMode = "none";
    const background = new Graphics()
      .rect(0, 0, metrics.imageWidth, metrics.imageHeight)
      .fill({ color: IMAGE_FALLBACK_COLOR });
    background.label = `blackMarketDemo:fallbackBackground:${cardId}`;
    background.eventMode = "none";
    fallback.addChild(background);
    const message = makeTtfLabel(IMAGE_FALLBACK_TEXT, metrics.fallbackFontSize, {
      fill: 0xffffff,
      outline: false,
      textureScaleMode: "nearest",
    });
    message.label = `blackMarketDemo:fallbackMessage:${cardId}`;
    message.anchor.set(0.5);
    message.position.set(metrics.imageWidth / 2, metrics.imageHeight / 2);
    message.eventMode = "none";
    fallback.addChild(message);
    layer.addChild(fallback);
  }

  private destroyDisplayAndOwnedResources(): void {
    const ownedTextures = [...this.ownedTextures];
    const acceptedResults = [...this.acceptedImages.values()];
    this.imageLayers.clear();
    this.acceptedImages.clear();
    try {
      this.destroy({ children: true });
    } finally {
      this.ownedTextures.clear();
      for (const texture of ownedTextures) texture.destroy(false);
      for (const result of acceptedResults) this.releaseResultOnce(result);
    }
  }
}

type BlackMarketDemoLayoutCard = ReturnType<typeof blackMarketDemoLayout>["cards"][number];

export async function showBlackMarketDemoFlow(
  options: BlackMarketDemoFlowOptions,
): Promise<BlackMarketDemoFlow> {
  return BlackMarketDemoFlow.show(options);
}
