import { Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import type { GameData } from "@dib/gamedata";
import { type AssetLibrary, type Scale9SpritesData } from "@dib/renderer";
import type { BattlePlayerProfile } from "../player/battlePlayerState.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { tween } from "../tween.js";
import { SCREEN_H, SCREEN_W } from "./displayShared.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import {
  buildSpiritMenuItems,
  spiritMenuColumns,
  spiritMenuGeometry,
  spiritMenuLayout,
  type SpiritMenuItemModel,
} from "./spiritMenuMath.js";









const DIM_OPACITY = 200 / 255;
const DIM_FADE_MS = 500;

let LAYOUT = spiritMenuLayout(DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  LAYOUT = spiritMenuLayout(DISPLAY_MODE);
});

export interface SpiritMenuOpts {
  assets: AssetLibrary;
  scale9: Scale9SpritesData;
  ticker: Ticker;
  gameData: GameData;
  strings: LocalizedStrings;
  profile: BattlePlayerProfile;
  onSelect: (item: SpiritMenuItemModel) => void;
  onClose: () => void;
  onClick: () => void;
}

/** Native modal PopupMenu using Menus.plist `CenteredWithoutClose`. */
export class SpiritMenu extends Container {
  readonly items: readonly SpiritMenuItemModel[];
  readonly columns: readonly (readonly SpiritMenuItemModel[])[];
  private readonly titleValue: string;
  private readonly buttonPoints: Array<{
    label: string;
    enabled: boolean;
    column: number;
    row: number;
    x: number;
    y: number;
    w: number;
    h: number;
    labelW: number;
    labelH: number;
  }> = [];
  private dim: Graphics | undefined;
  private contentRect = { x: 0, y: 0, w: 0, h: 0 };
  private titleRect = { x: 0, y: 0, w: 0, h: 0 };
  private closed = false;
  private closeCallback: (() => void) | undefined;

  private constructor(items: SpiritMenuItemModel[], title: string) {
    super();
    this.items = items;
    this.columns = spiritMenuColumns(items);
    this.titleValue = title;
  }

  static async show(parent: Container, opts: SpiritMenuOpts): Promise<SpiritMenu> {
    const items = buildSpiritMenuItems(opts.profile.spiritSnapshot(), opts.gameData, opts.strings);
    const titleValue = localizedString(opts.strings, "SpiritsKey");
    const menu = new SpiritMenu(items, titleValue);
    menu.closeCallback = opts.onClose;
    menu.zIndex = 60;
    menu.eventMode = "static";
    menu.hitArea = new Rectangle(0, 0, SCREEN_W, SCREEN_H);
    for (const event of ["pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove"] as const) {
      menu.on(event, (e) => e.stopPropagation());
    }




    const dim = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0x000000);
    dim.alpha = 0;
    dim.eventMode = "static";
    menu.addChild(dim);
    menu.dim = dim;

    const view = await buildPopupMenuView({
      parent: menu,
      assets: opts.assets,
      scale9: opts.scale9,
      title: {
        value: titleValue,
        style: {
          fontSize: LAYOUT.titleSize,
          fill: 0xffff88,
          outlineWidth: LAYOUT.outlineWidth,
          outlineAlpha: LAYOUT.outlineAlpha,
          textureScaleMode: "nearest",
        },
      },
      columns: menu.columns.map((column) => column.map((item) => ({
        value: item,
        label: item.label,
        enabled: item.enabled,
      }))),
      itemStyle: (item) => ({
        fontSize: LAYOUT.itemSize,
        fill: item.enabled ? 0xffffff : 0x000000,
        outlineWidth: LAYOUT.outlineWidth,
        outlineAlpha: LAYOUT.outlineAlpha,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: LAYOUT.backgroundMarginX,
      backgroundMarginY: LAYOUT.backgroundMarginY,


      allowEmptyColumns: true,
      geometry: (titleSize, columnItemSizes) => {
        if (titleSize === null) throw new Error("Spirit Totems title measurement is missing");
        return spiritMenuGeometry(
          { w: SCREEN_W, h: SCREEN_H },
          titleSize,
          columnItemSizes,
          DISPLAY_MODE,
        );
      },
    });
    const geometry = view.geometry;
    if (geometry.title === null) throw new Error("Spirit Totems title geometry is missing");
    menu.contentRect = geometry.content;
    menu.titleRect = geometry.title;

    for (const button of view.buttons) {
        const { item: viewItem, layout } = button;
        const item = viewItem.value;
        (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
          // `PopupMenu.rebuildMenu` omits disabled nodes from its hit-testable `menuItems`; the
          // modal still swallows the tap, but it does not invoke the generic notAllowed branch.
          if (!item.enabled) return;
          opts.onClick();
          if (item.kind === "back") {
            menu.requestClose();
            return;
          }
          opts.onSelect(item);
          menu.requestClose();
        });
        menu.buttonPoints.push({
          label: item.label,
          enabled: item.enabled,
          column: layout.column,
          row: layout.row,
          x: layout.label.x + layout.label.w / 2,
          y: layout.label.y + layout.label.h / 2,
          w: layout.background.w,
          h: layout.background.h,
          labelW: layout.label.w,
          labelH: layout.label.h,
        });
    }
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
    this.destroy({ children: true });
  }

  /** Web-native equivalent of selecting the menu's Back row. */
  requestClose(): void {
    this.close(this.closeCallback ?? (() => {}));
  }

  get debugState(): Record<string, unknown> {
    return {
      title: this.titleValue,
      dimAlpha: this.dim?.alpha ?? 0,
      content: { ...this.contentRect },
      titleBounds: { ...this.titleRect },
      columns: this.columns.map((column) => column.map((item) => ({ ...item }))),
      buttons: this.buttonPoints.map((point) => ({ ...point })),
    };
  }
}
