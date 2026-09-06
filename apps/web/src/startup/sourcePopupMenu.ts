import { Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import {
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { popupMenuGeometry } from "../ui/popupMenuMath.js";
import { sourcePopupDimSpec } from "../ui/sourcePopupPresentation.js";
import { tween } from "../tween.js";
import { MAIN_MENU_OVERLAYS, STARTUP_LAYOUT } from "./startupConstants.js";

let SCREEN = STARTUP_LAYOUT.screen;
let LAYOUT = STARTUP_LAYOUT.mainMenu;
registerRuntimeSettingsRefresh(() => {
  SCREEN = STARTUP_LAYOUT.screen;
  LAYOUT = STARTUP_LAYOUT.mainMenu;
});

export interface SourcePopupMenuItem<T> {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly enabled?: boolean;
  /** PopupMenuItem.closesPopup; defaults true. */
  readonly autoClose?: boolean;
}

export interface SourcePopupMenuOpts<T> {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly ticker: Ticker;
  readonly title: string;
  readonly columns: readonly (readonly SourcePopupMenuItem<T>[])[];
  readonly onInvoke: (item: SourcePopupMenuItem<T>) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
  readonly onClick?: () => void;
  readonly overlays?: boolean;
  readonly zIndex?: number;
}

export interface SourcePopupMenuDebugState {
  readonly title: string;
  readonly content: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly titleBounds: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  readonly buttons: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly enabled: boolean;
    readonly autoClose: boolean;
    readonly column: number;
    readonly row: number;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  }>;
  readonly closed: boolean;
}





export class SourcePopupMenu<T> extends Container {
  private closed = false;
  private invoking = false;
  private dimFadeAbort: AbortController | undefined;
  private dim: Graphics | undefined;
  private dimTargetAlpha = 0;
  private dimDurationMs = 0;
  private readonly buttonState: Array<{
    id: string;
    label: string;
    enabled: boolean;
    autoClose: boolean;
    column: number;
    row: number;
    x: number;
    y: number;
    w: number;
    h: number;
  }> = [];
  private contentRect = { x: 0, y: 0, w: 0, h: 0 };
  private titleRect = { x: 0, y: 0, w: 0, h: 0 };

  private constructor(
    private readonly titleValue: string,
    private readonly ticker: Ticker,
  ) {
    super();
  }

  static async show<T>(opts: SourcePopupMenuOpts<T>): Promise<SourcePopupMenu<T>> {
    if (opts.columns.length === 0 || opts.columns.some((column) => column.length === 0)) {
      throw new Error("source PopupMenu requires one or more non-empty columns");
    }
    const menu = new SourcePopupMenu<T>(opts.title, opts.ticker);
    menu.label = "sourceMainMenuPopup";
    menu.zIndex = opts.zIndex ?? 20;
    menu.sortableChildren = true;
    menu.eventMode = "static";
    menu.hitArea = new Rectangle(0, 0, SCREEN.w, SCREEN.h);
    for (const event of [
      "pointerdown",
      "pointerup",
      "pointerupoutside",
      "pointertap",
      "pointermove",
      "pointercancel",
    ] as const) {
      menu.on(event, (pointerEvent) => pointerEvent.stopPropagation());
    }




    const dimSpec = sourcePopupDimSpec(DISPLAY_MODE);
    const dim = new Graphics()
      .rect(dimSpec.x, dimSpec.y, dimSpec.w, dimSpec.h)
      .fill({ color: dimSpec.color, alpha: 1 });
    dim.label = "sourcePopupDim";
    dim.alpha = 0;
    dim.eventMode = "static";
    dim.zIndex = dimSpec.zIndex;
    menu.addChild(dim);
    menu.dim = dim;
    menu.dimTargetAlpha = dimSpec.targetAlpha;
    menu.dimDurationMs = dimSpec.durationMs;

    const view = await buildPopupMenuView({
      parent: menu,
      assets: opts.assets,
      scale9: opts.scale9,
      title: {
        value: opts.title,
        style: {
          fontSize: LAYOUT.titleSize,
          fill: LAYOUT.titleColor,
          outlineWidth: LAYOUT.outlineWidth,
          outlineAlpha: 1,
          textureScaleMode: "nearest",
        },
      },
      columns: opts.columns.map((column) => column.map((item) => ({
        value: item,
        label: item.label,
        enabled: item.enabled !== false,
      }))),
      itemStyle: (item) => ({
        fontSize: LAYOUT.itemSize,
        fill: item.enabled ? LAYOUT.itemColor : LAYOUT.disabledColor,
        outlineWidth: LAYOUT.outlineWidth,
        outlineAlpha: 1,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: LAYOUT.backgroundMarginX,
      backgroundMarginY: LAYOUT.backgroundMarginY,
      geometry: (titleSize, columnItemSizes) => popupMenuGeometry(
        SCREEN,
        titleSize,
        columnItemSizes,
        {
          itemGap: LAYOUT.itemGap,
          columnGap: LAYOUT.columnGap,
          titleGap: LAYOUT.titleGap,
          backgroundMarginX: LAYOUT.backgroundMarginX,
          backgroundMarginY: LAYOUT.backgroundMarginY,
        },
        DISPLAY_MODE,
      ),
      buttonLabel: (item) => `sourcePopupButton:${item.value.id}`,
    });
    const geometry = view.geometry;
    if (geometry.title === null) throw new Error("source PopupMenu title geometry is missing");
    menu.contentRect = geometry.content;
    menu.titleRect = geometry.title;

    for (const button of view.buttons) {
        const { item: viewItem, layout } = button;
        const item = viewItem.value;
        const enabled = item.enabled !== false;
        if (enabled) {
          (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
            if (menu.closed || menu.invoking) return;
            menu.invoking = true;
            opts.onClick?.();
            const shouldClose = item.autoClose !== false;
            if (shouldClose) menu.close();
            void Promise.resolve(opts.onInvoke(item))
              .catch((error: unknown) => {
                console.error("source PopupMenu action failed", error);
                if (opts.onError !== undefined) opts.onError(error);
                else queueMicrotask(() => { throw error; });
              })
              .finally(() => {
                if (!menu.closed) menu.invoking = false;
              });
          });
        }
        button.node.zIndex = 0;
        menu.buttonState.push({
          id: item.id,
          label: item.label,
          enabled,
          autoClose: item.autoClose !== false,
          column: layout.column,
          row: layout.row,
          x: layout.background.x,
          y: layout.background.y,
          w: layout.background.w,
          h: layout.background.h,
        });
    }

    if (opts.overlays !== false) {
      for (const spec of MAIN_MENU_OVERLAYS) {
        const key = `${spec.file.replace(/\.png$/i, "")}-hd`;
        const sprite = pointSprite(await opts.assets.sprite(key));
        sprite.label = `sourcePopupOverlay:${spec.file}`;
        sprite.eventMode = "none";
        // PopupMenu overlay contract: source position and anchor are the same ratio vector.
        sprite.position.set(
          spec.anchor.x * (SCREEN.w - sprite.width),
          SCREEN.h - sprite.height - spec.anchor.y * (SCREEN.h - sprite.height),
        );
        sprite.zIndex = 1;
        menu.addChild(sprite);
      }
    }

    opts.parent.sortableChildren = true;
    opts.parent.addChild(menu);
    return menu;
  }


  present(): void {
    if (this.destroyed || this.dim === undefined || this.dimFadeAbort !== undefined) return;
    this.dimFadeAbort = new AbortController();
    const dim = this.dim;
    void tween(
      this.ticker,
      this.dimDurationMs,
      (t) => { dim.alpha = t * this.dimTargetAlpha; },
      (t) => t,
      this.dimFadeAbort.signal,
    );
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.destroy({ children: true });
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.dimFadeAbort?.abort();
    this.dimFadeAbort = undefined;
    super.destroy(options);
  }

  get debugState(): SourcePopupMenuDebugState {
    return {
      title: this.titleValue,
      content: { ...this.contentRect },
      titleBounds: { ...this.titleRect },
      buttons: this.buttonState.map((button) => ({ ...button })),
      closed: this.closed,
    };
  }
}
