import { setOwnedTexture } from "@dib/renderer";
import {
  Container,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type Text,
  type Ticker,
} from "pixi.js";
import {
  makeTtfLabel,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { TownPortalDestination } from "@dib/gamedata/browser";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import type { LocalizedStrings } from "../localization.js";
import { localizedRenderableName, localizedString } from "../localization.js";
import { buildPopupMenuView, type PopupMenuItemAccessory } from "../ui/popupMenuView.js";
import { PopupHost } from "../ui/popup.js";
import {
  townWarpColumns,
  townWarpGeometry,
  townWarpItems,
  townWarpLayout,
  type TownWarpItemModel,
} from "./townWarpMath.js";

let LAYOUT = townWarpLayout(DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => { LAYOUT = townWarpLayout(DISPLAY_MODE); });

export interface TownWarpFlowOptions {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly backgroundSpriteKey: string;
  readonly destinations: readonly TownPortalDestination[];
  readonly visitedTownNames: ReadonlySet<string>;
  readonly questsAvailableInTown: (townName: string) => number;
  readonly onClick: () => void;
  readonly onUnknownTown: (townName: string) => void | Promise<void>;
  readonly onTravel: (townName: string) => void | Promise<void>;
  readonly onClose: () => void;
  /** The owning scene retains input during the first-use claim and tutorial mounting. */
  readonly isInputBlocked?: () => boolean;
}


export class TownWarpFlow {
  private root: Container | undefined;
  private closed = false;
  private invoking = false;
  private contentRect = { x: 0, y: 0, w: 0, h: 0 };
  private readonly buttonState: Array<Record<string, unknown>> = [];

  private constructor(private readonly options: TownWarpFlowOptions) {}

  static async show(options: TownWarpFlowOptions): Promise<TownWarpFlow> {
    const flow = new TownWarpFlow(options);
    await flow.build();
    return flow;
  }

  requestClose(): void {
    if (this.inputBlocked) return;
    this.dispose();
  }

  private get inputBlocked(): boolean {
    return this.closed || this.invoking || this.options.isInputBlocked?.() === true ||
      PopupHost.for(this.options.parent).modalDepth > 0;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.root?.destroy({ children: true });
    this.root = undefined;
    this.options.onClose();
  }

  get debugState(): Record<string, unknown> {
    return {
      kind: "townWarp",
      open: !this.closed,
      config: "TownWarp",
      inputBlocked: this.inputBlocked,
      content: { ...this.contentRect },
      popups: PopupHost.for(this.options.parent).debugState,
      destinations: this.buttonState.map((state) => ({ ...state })),
    };
  }

  private async build(): Promise<void> {
    const parent = PopupHost.presentationParentFor(this.options.parent);
    const root = new Container();
    root.label = "townWarp";
    root.zIndex = 9_000;
    root.sortableChildren = true;
    root.eventMode = "static";
    root.hitArea = new Rectangle(0, 0, LAYOUT.screen.w, LAYOUT.screen.h);
    for (const event of [
      "pointerdown",
      "pointerup",
      "pointerupoutside",
      "pointertap",
      "pointermove",
      "pointercancel",
    ] as const) {
      root.on(event, (pointerEvent) => pointerEvent.stopPropagation());
    }

    const fullTexture = await this.options.assets.sprite(this.options.backgroundSpriteKey);
    const rect = LAYOUT.background.textureRectPx;
    if (fullTexture.width < rect.w || fullTexture.height < rect.h) {
      throw new Error(
        `TownWarp background ${this.options.backgroundSpriteKey} is ` +
          `${fullTexture.width}x${fullTexture.height}px; source requires ${rect.w}x${rect.h}`,
      );
    }
    const background = new Sprite(new Texture({
      source: fullTexture.source,
      frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
    }));
    setOwnedTexture(background, background.texture);
    background.label = "townWarp:background";
    background.width = LAYOUT.background.sizePt.w;
    background.height = LAYOUT.background.sizePt.h;
    background.position.set(
      LAYOUT.background.positionPt.x,
      LAYOUT.background.positionPt.y,
    );
    background.eventMode = "none";
    background.zIndex = -10;
    root.addChild(background);

    const items = townWarpItems(
      this.options.destinations,
      this.options.visitedTownNames,
      (townName) => localizedRenderableName(this.options.strings, [townName]),
      this.options.questsAvailableInTown,
    );
    const accessories = new Map<string, PopupMenuItemAccessory>();
    for (const item of items) {
      if (!item.showQuestBadge) continue;
      accessories.set(item.townName, await this.buildQuestBadge(item));
    }
    const columns = townWarpColumns(items);
    const view = await buildPopupMenuView({
      parent: root,
      assets: this.options.assets,
      scale9: this.options.scale9,
      title: {
        value: localizedString(this.options.strings, "WarpQuestionKey"),
        style: {
          fontSize: LAYOUT.titleFontSize,
          fill: 0xffff88,
          outlineWidth: LAYOUT.outlineWidth,
          textureScaleMode: "nearest",
        },
      },
      columns: columns.map((column) => column.map((item) => ({
        value: item,
        label: item.label,
        enabled: true,
      }))),



      allowEmptyColumns: true,
      itemStyle: () => ({
        fontSize: LAYOUT.itemFontSize,
        fill: 0xffffff,
        outlineWidth: LAYOUT.outlineWidth,
        textureScaleMode: "nearest",
      }),
      itemAccessory: (item) => accessories.get(item.value.townName),
      displayMode: DISPLAY_MODE,
      backgroundMarginX: LAYOUT.backgroundMarginX,
      backgroundMarginY: LAYOUT.backgroundMarginY,
      geometry: (titleSize, itemSizes) => townWarpGeometry(titleSize, itemSizes, DISPLAY_MODE),
      buttonLabel: (item) => `townWarp:${item.value.townName}`,
    });
    this.contentRect = { ...view.geometry.content };

    for (const button of view.buttons) {
      const { item: viewItem, layout } = button;
      const item = viewItem.value;
      (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
        this.invoke(item);
      });
      this.buttonState.push({
        townName: item.townName,
        label: item.label,
        visited: item.visited,
        questCount: item.questCount,
        questBadgeVisible: item.showQuestBadge,
        autoCloseOnInvoke: item.visited,
        column: layout.column,
        row: layout.row,
        labelBounds: { ...layout.label },
        backgroundBounds: { ...layout.background },
      });
    }

    this.buildLegend(root, await this.buildLegendIcon());

    const close = pointSprite(await this.options.assets.sprite("PopupMenuCloseButton-hd"));
    close.label = "townWarp:close";
    close.anchor.set(1, 0);
    close.position.set(
      LAYOUT.screen.w - LAYOUT.closeInset,
      LAYOUT.closeInset,
    );
    close.eventMode = "static";
    close.cursor = "pointer";
    close.on("pointertap", (event) => {
      event.stopPropagation();
      if (this.inputBlocked) return;
      this.options.onClick();
      this.requestClose();
    });
    root.addChild(close);

    this.root = root;
    parent.sortableChildren = true;
    parent.addChild(root);
  }

  private invoke(item: TownWarpItemModel): void {
    if (this.inputBlocked) return;
    this.options.onClick();
    if (!item.visited) {
      void Promise.resolve(this.options.onUnknownTown(item.townName));
      return;
    }
    this.invoking = true;
    // Source autoCloseOnInvoke=YES for visited destinations; unknown rows stay open.
    this.dispose();
    void Promise.resolve(this.options.onTravel(item.townName)).catch((error: unknown) => {
      queueMicrotask(() => { throw error; });
    });
  }

  private async buildQuestBadge(item: TownWarpItemModel): Promise<PopupMenuItemAccessory> {
    const root = new Container();
    root.label = `townWarp:badge:${item.townName}`;
    const icon = pointSprite(await this.options.assets.sprite("notification-hd"));
    icon.anchor.set(0, 0);
    const label = makeTtfLabel(String(item.questCount), LAYOUT.questCountFontSize, {
      outline: false,
      textureScaleMode: "nearest",
    });
    label.anchor.set(0.5);
    label.position.set(icon.width / 2, icon.height / 2);
    root.addChild(icon, label);
    return {
      node: root,
      side: "right",
      gap: LAYOUT.itemIconGap,
      contentSize: { w: icon.width, h: icon.height },
    };
  }

  private async buildLegendIcon(): Promise<Container> {
    const root = new Container();
    const icon = pointSprite(await this.options.assets.sprite("notification-hd"));
    icon.anchor.set(0, 0);
    const count = makeTtfLabel("#", LAYOUT.legendCountFontSize, {
      outline: false,
      textureScaleMode: "nearest",
    });
    count.anchor.set(0.5);
    count.position.set(icon.width / 2, icon.height / 2);
    root.addChild(icon, count);
    return root;
  }

  private buildLegend(root: Container, icon: Container): void {
    const text = makeTtfLabel(
      localizedString(this.options.strings, "ExplainTownWarpKey"),
      LAYOUT.legendTextFontSize,
      {
        outlineWidthPt: LAYOUT.outlineWidth,
        outlineAlpha: 0.5,
        textureScaleMode: "nearest",
      },
    );
    text.anchor.set(0, 0);
    const legend = new Container();
    legend.label = "townWarp:legend";
    const iconBounds = icon.getLocalBounds();
    icon.position.set(-iconBounds.x, -iconBounds.y);
    text.position.set(iconBounds.width + LAYOUT.legendGap, (iconBounds.height - text.height) / 2);
    legend.addChild(icon, text);
    const bounds = legend.getLocalBounds();
    legend.position.set(
      (LAYOUT.screen.w - bounds.width) / 2 - bounds.x,
      LAYOUT.screen.h - LAYOUT.legendBottomInset - bounds.height - bounds.y,
    );
    legend.eventMode = "none";
    root.addChild(legend);
  }
}
