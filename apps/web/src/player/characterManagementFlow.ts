import {
  ButtonSprite,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type {
  InventoryItemId,
  PlayerProfile,
  PlayerStatName,
} from "@dib/player-domain";
import type { GameData } from "@dib/gamedata/browser";
import { Container, Rectangle, type Ticker } from "pixi.js";
import { idiomPairPt, screenPointsForMode, unscaledIdiomPt } from "../displayMode.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { PopupHost } from "../ui/popup.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import { popupMenuGeometry } from "../ui/popupMenuMath.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { CharacterSkillsNode } from "./characterSkillsNode.js";
import {
  showInventoryManagement,
  type InventoryManagementHandle,
} from "./inventoryManagementFlow.js";

type CharacterManagementAction = "gems" | "skills";

export interface CharacterManagementOptions {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly data: GameData;
  readonly profile: PlayerProfile;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly onClose: () => void;
  readonly isMutationPending?: () => boolean;
  readonly onFirstGemDisplay?: () => void | Promise<void>;
  readonly mutateInventory?: (
    action: "drop" | "equip" | "unequip",
    itemId: InventoryItemId,
  ) => void | Promise<void>;
  readonly mutateSkill?: (
    action: "increment" | "decrement",
    stat: PlayerStatName,
  ) => void | Promise<void>;
}

/** `CharacterDisplayMenuItem.activate:`: the named HeroManagement menu remains mounted while its
 * non-auto-closing Gems and Skills children are presented over it. */
export class CharacterManagementFlow extends Container {
  private child:
    | InventoryManagementHandle
    | CharacterSkillsNode
    | undefined;
  private closed = false;
  private readonly buttonPoints: Array<Record<string, unknown>> = [];

  private constructor(private readonly opts: CharacterManagementOptions) {
    super();
  }

  static async show(opts: CharacterManagementOptions): Promise<CharacterManagementFlow> {
    const flow = new CharacterManagementFlow(opts);
    await flow.build();
    const parent = PopupHost.presentationParentFor(opts.parent);
    parent.sortableChildren = true;
    parent.addChild(flow);
    return flow;
  }

  requestBack(): boolean {
    if (this.child !== undefined) {
      this.child.requestClose();
      this.child = undefined;
      return true;
    }
    this.dispose();
    return true;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.child?.requestClose();
    this.child = undefined;
    this.opts.onClose();
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }

  get debugState(): Record<string, unknown> {
    return {
      open: !this.closed,
      config: "HeroManagement",
      buttons: this.buttonPoints,
      child: this.child?.debugState ?? null,
    };
  }

  private async build(): Promise<void> {
    const screen = screenPointsForMode(DISPLAY_MODE);
    this.label = "characterManagement";
    this.zIndex = 900;
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    for (const event of [
      "pointerdown",
      "pointerup",
      "pointerupoutside",
      "pointertap",
      "pointermove",
    ] as const) {
      this.on(event, (pointer) => pointer.stopPropagation());
    }

    const background = sourceFullscreenSprite(
      await this.opts.assets.sprite("HeroScreen"),
      DISPLAY_MODE,
      "HeroScreen",
    );
    background.eventMode = "none";
    this.addChild(background);

    const metrics = {
      itemGap: idiomPairPt(40, 80, DISPLAY_MODE),
      columnGap: idiomPairPt(50, 100, DISPLAY_MODE),
      titleGap: idiomPairPt(30, 60, DISPLAY_MODE),
      backgroundMarginX: idiomPairPt(9, 18, DISPLAY_MODE),
      backgroundMarginY: idiomPairPt(6, 12, DISPLAY_MODE),
    };
    const items = [
      { value: "gems" as const, label: localizedString(this.opts.strings, "GemsKey"), enabled: true },
      { value: "skills" as const, label: localizedString(this.opts.strings, "SkillsKey"), enabled: true },
    ];
    const view = await buildPopupMenuView<CharacterManagementAction>({
      parent: this,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      columns: [items],
      title: {
        value: localizedString(this.opts.strings, "HeroManagementKey"),
        style: {
          fontSize: idiomPairPt(25, 50, DISPLAY_MODE),
          fill: 0xffff88,
          outlineWidth: 2,
        },
      },
      itemStyle: () => ({
        fontSize: idiomPairPt(20, 40, DISPLAY_MODE),
        fill: 0xffffff,
        outlineWidth: 2,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: metrics.backgroundMarginX,
      backgroundMarginY: metrics.backgroundMarginY,
      geometry: (titleSize, sizes) =>
        popupMenuGeometry(screen, titleSize, sizes, metrics, DISPLAY_MODE),
      buttonLabel: ({ value }) => `characterManagement:${value}`,
    });
    for (const button of view.buttons) {
      const { item, layout } = button;
      (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
        void this.activate(item.value);
      });
      this.buttonPoints.push({
        action: item.value,
        center: {
          x: layout.label.x + layout.label.w / 2,
          y: layout.label.y + layout.label.h / 2,
        },
      });
    }

    const closeTexture = await this.opts.assets.sprite("PopupMenuCloseButton-hd");
    const close = new ButtonSprite({
      normalTexture: closeTexture,
      pressSound: this.opts.onClick,
    });
    close.label = "characterManagement:close";
    const closeBounds = close.getLocalBounds();
    close.position.set(
      screen.w - unscaledIdiomPt(10, DISPLAY_MODE) -
        (closeBounds.x + closeBounds.width),
      unscaledIdiomPt(10, DISPLAY_MODE) - closeBounds.y,
    );
    close.onPress(() => this.dispose());
    this.addChild(close);
  }

  private async activate(action: CharacterManagementAction): Promise<void> {
    if (this.closed || this.child !== undefined || this.opts.isMutationPending?.()) return;
    this.opts.onClick();
    if (action === "gems") {
      let child: InventoryManagementHandle | undefined;
      child = await showInventoryManagement({
        parent: this,
        owner: this,
        assets: this.opts.assets,
        scale9: this.opts.scale9,
        strings: this.opts.strings,
        ticker: this.opts.ticker,
        data: this.opts.data,
        profile: this.opts.profile,
        type: 0,
        title: localizedString(this.opts.strings, "GemManagementKey"),
        onClick: this.opts.onClick,
        onBlocked: this.opts.onBlocked,
        onClose: () => {
          if (this.child === child) {
            this.child = undefined;
            this.visible = true;
          }
        },
        ...(this.opts.isMutationPending === undefined ? {} : { isMutationPending: this.opts.isMutationPending }),
        ...(this.opts.mutateInventory === undefined
          ? {}
          : { mutate: this.opts.mutateInventory }),
      });
      if (child === undefined) return;
      this.child = child;


      await this.opts.onFirstGemDisplay?.();
      return;
    }
    let child: CharacterSkillsNode | undefined;
    child = await CharacterSkillsNode.show({
      parent: this,
      owner: this,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      strings: this.opts.strings,
      ticker: this.opts.ticker,
      profile: this.opts.profile,
      onClick: this.opts.onClick,
      onBlocked: this.opts.onBlocked,
      onClose: () => {
        if (this.child === child) {
          this.child = undefined;
          this.visible = true;
        }
      },
      ...(this.opts.mutateSkill === undefined ? {} : { mutate: this.opts.mutateSkill }),
    });
    this.child = child;
  }
}
