import { Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import {
  ButtonSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode } from "../displayMode.js";
import type { LocalizedStrings } from "../localization.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { PopupHost } from "../ui/popup.js";
import { tween } from "../tween.js";
import {
  buildWorldMenuItems,
  worldMenuColumns,
  worldMenuGeometry,
  worldMenuLayout,
  type WorldMenuAction,
  type WorldMenuItemModel,
} from "./worldMenuMath.js";

const DIM_OPACITY = 200 / 255;
const DIM_FADE_MS = 500;

export interface WorldMenuOpts {
  assets: AssetLibrary;
  scale9: Scale9SpritesData;
  strings: LocalizedStrings;
  ticker: Ticker;
  enabledActions: ReadonlySet<WorldMenuAction>;
  context?: "world" | "dungeon";
  /** Argument passed to `showMenuWithEditable:world:dungeon:`; town YES, outdoor NO. */
  editable: boolean;
  onSelect: (action: WorldMenuAction) => void;
  onClose: () => void;
  onClick: () => void;
}

/** Source `MasterMenu`: titleless shared PopupMenu over the dimmed live WorldNode. */
export class WorldMenu extends Container {
  readonly items: readonly WorldMenuItemModel[];
  readonly columns: readonly (readonly WorldMenuItemModel[])[];
  private readonly buttonPoints: Array<Record<string, unknown>> = [];
  private contentRect = { x: 0, y: 0, w: 0, h: 0 };
  private closeCenter = { x: 0, y: 0 };
  private closed = false;

  private constructor(
    items: WorldMenuItemModel[],
    private readonly editable: boolean,
  ) {
    super();
    this.items = items;
    this.columns = worldMenuColumns(items);
  }

  static async show(parent: Container, opts: WorldMenuOpts): Promise<WorldMenu> {

    parent = PopupHost.presentationParentFor(parent);
    const screen = screenPointsForMode(DISPLAY_MODE);
    const layoutMetrics = worldMenuLayout(DISPLAY_MODE);
    const items = buildWorldMenuItems(
      opts.strings,
      opts.enabledActions,
      opts.context,
    );
    const menu = new WorldMenu(items, opts.editable);
    menu.label = opts.context === "dungeon" ? "dungeonMasterMenu" : "worldMasterMenu";
    menu.zIndex = 80;
    menu.eventMode = "static";
    menu.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    for (const event of ["pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove"] as const) {
      menu.on(event, (e) => e.stopPropagation());
    }

    const dim = new Graphics().rect(0, 0, screen.w, screen.h).fill(0x000000);
    dim.alpha = 0;
    dim.eventMode = "static";
    menu.addChild(dim);

    const view = await buildPopupMenuView({
      parent: menu,
      assets: opts.assets,
      scale9: opts.scale9,
      columns: menu.columns.map((column) => column.map((item) => ({
        value: item,
        label: item.label,
        enabled: item.enabled,
      }))),
      itemStyle: (item) => ({
        fontSize: layoutMetrics.itemSize,
        fill: item.enabled ? 0xffffff : 0x000000,
        outlineWidth: 0,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: layoutMetrics.backgroundMarginX,
      backgroundMarginY: layoutMetrics.backgroundMarginY,
      geometry: (_titleSize, columnItemSizes) =>
        worldMenuGeometry(screen, columnItemSizes, DISPLAY_MODE),
      buttonLabel: (item) => `worldMenu:${item.value.action}`,
    });
    const geometry = view.geometry;
    menu.contentRect = geometry.content;

    for (const button of view.buttons) {
        const { item: viewItem, layout: buttonLayout } = button;
        const item = viewItem.value;
        // PopupMenu only adds enabled label nodes to menuItems. Disabled plates remain visible but
        // inert; the full-screen modal owns and swallows their touches.
        (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
          if (!item.enabled || menu.closed) return;
          opts.onClick();
          const action = item.action;
          menu.close(opts.onClose);
          opts.onSelect(action);
        });
        menu.buttonPoints.push({
          action: item.action,
          label: item.label,
          enabled: item.enabled,
          column: buttonLayout.column,
          row: buttonLayout.row,
          center: {
            x: buttonLayout.label.x + buttonLayout.label.w / 2,
            y: buttonLayout.label.y + buttonLayout.label.h / 2,
          },
          labelBounds: { ...buttonLayout.label },
          backgroundBounds: { ...buttonLayout.background },
        });
    }

    const closeTexture = await opts.assets.sprite("PopupMenuCloseButton-hd");
    const close = new ButtonSprite({ normalTexture: closeTexture, pressSound: opts.onClick });
    close.label = "worldMenu:close";
    close.position.set(
      screen.w - layoutMetrics.closeInset - closeTexture.width / 2,
      layoutMetrics.closeInset,
    );
    close.onPress(() => menu.close(opts.onClose));
    menu.closeCenter = {
      x: close.position.x + closeTexture.width / 4,
      y: close.position.y + closeTexture.height / 4,
    };
    menu.addChild(close);

    parent.sortableChildren = true;
    parent.addChild(menu);
    void tween(opts.ticker, DIM_FADE_MS, (t) => {
      if (!menu.closed) dim.alpha = t * DIM_OPACITY;
    });
    return menu;
  }

  close(onClose: () => void): void {
    if (this.closed) return;
    this.closed = true;
    onClose();
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }

  get debugState(): Record<string, unknown> {
    return {
      open: true,
      config: "MasterMenu",
      editable: this.editable,
      content: { ...this.contentRect },
      closeCenter: { ...this.closeCenter },
      columns: this.columns.map((column) => column.map((item) => ({ ...item }))),
      buttons: this.buttonPoints.map((point) => ({ ...point })),
    };
  }
}
