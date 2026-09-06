import { Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import { ButtonSprite, type AssetLibrary, type Scale9SpritesData } from "@dib/renderer";
import {
  completeSourceTutorialCatalog,
  type SourceTutorialTopic,
} from "@dib/gamedata/browser";
import type { KeyboardShortcutRouter } from "../keyboardShortcuts.js";
import type { LocalizedStrings } from "../localization.js";
import type { LoadedGame } from "../loadGame.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode } from "../displayMode.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { PopupHost } from "../ui/popup.js";
import {
  showPlotTutorial,
  type PlotTutorialDebugState,
  type PlotTutorialHandle,
} from "../ui/plotGameFlow.js";
import { tween } from "../tween.js";
import { worldMenuGeometry, worldMenuLayout } from "./worldMenuMath.js";
import {
  buildTutorialMenuModel,
  TUTORIAL_MENU_TITLE_COLOR,
  TUTORIAL_MENU_TITLE_FONT_SIZE,
  type TutorialMenuEntry,
} from "./tutorialMenuMath.js";

const DIM_OPACITY = 200 / 255;
const DIM_FADE_MS = 500;

export type TutorialMenuDebugState = Readonly<Record<string, unknown>> & {
  readonly kind: "tutorials";
  readonly screen: "topics";
  readonly title: string;
  readonly columns: readonly (readonly {
    readonly action: string;
    readonly label: string;
  }[])[];
  readonly tutorial: PlotTutorialDebugState | null;
};

export function hasCompleteSourceTutorialSurface(game: LoadedGame): boolean {
  return completeSourceTutorialCatalog(game.sourceTutorialTopics) &&
    game.sourceTutorialTopics.every((topic) =>
      topic.images.every((image) => game.assets.hasSprite(stem(image))));
}

export function hasSourceTutorialTopicSurface(
  game: LoadedGame,
  topic: SourceTutorialTopic | undefined,
): topic is SourceTutorialTopic {
  return topic !== undefined &&
    topic.images.every((image) => game.assets.hasSprite(stem(image)));
}

/**
 * Source `TutorialMenuItem`: a two-column MasterMenu which remains mounted while the selected
 * PlotGameFlowEvent runs. Only Back (and the inherited close icon) closes the topic menu.
 */
export class TutorialMenu extends Container {
  private activeTutorial: PlotTutorialHandle | undefined;
  private tutorialState: PlotTutorialDebugState | undefined;
  private openingTutorial = false;
  private closed = false;
  private readonly titleText: string;
  private readonly columns: readonly (readonly TutorialMenuEntry[])[];

  private constructor(private readonly opts: {
    readonly parent: Container;
    readonly assets: AssetLibrary;
    readonly scale9: Scale9SpritesData;
    readonly strings: LocalizedStrings;
    readonly ticker: Ticker;
    readonly keyboard: KeyboardShortcutRouter;
    readonly topics: readonly SourceTutorialTopic[];
    readonly onClick: () => void;
    readonly onClose: () => void;
    readonly onStateChanged?: () => void;
  }) {
    super();
    const model = buildTutorialMenuModel(opts.topics, opts.strings);
    this.titleText = model.title;
    this.columns = model.columns;
  }

  static async show(opts: {
    readonly parent: Container;
    readonly assets: AssetLibrary;
    readonly scale9: Scale9SpritesData;
    readonly strings: LocalizedStrings;
    readonly ticker: Ticker;
    readonly keyboard: KeyboardShortcutRouter;
    readonly topics: readonly SourceTutorialTopic[];
    readonly onClick: () => void;
    readonly onClose: () => void;
    readonly onStateChanged?: () => void;
  }): Promise<TutorialMenu> {
    const presentationParent = PopupHost.presentationParentFor(opts.parent);
    if (!completeSourceTutorialCatalog(opts.topics)) {
      throw new Error("TutorialMenu requires the complete ordered Tutorial0..Tutorial8 catalog");
    }
    const screen = screenPointsForMode(DISPLAY_MODE);
    const layout = worldMenuLayout(DISPLAY_MODE);
    const menu = new TutorialMenu({ ...opts, parent: presentationParent });
    menu.label = "tutorialTopicsMenu";
    menu.zIndex = 80;
    menu.sortableChildren = true;
    menu.eventMode = "static";
    menu.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    for (const event of [
      "pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove",
    ] as const) {
      menu.on(event, (pointer) => pointer.stopPropagation());
    }

    const dim = new Graphics().rect(0, 0, screen.w, screen.h).fill(0x000000);
    dim.alpha = 0;
    dim.eventMode = "static";
    menu.addChild(dim);

    const view = await buildPopupMenuView({
      parent: menu,
      assets: opts.assets,
      scale9: opts.scale9,
      columns: menu.columns.map((column) => column.map((entry) => ({
        value: entry,
        label: entry.label,
        enabled: true,
      }))),
      title: {
        value: menu.titleText,
        style: {
          fontSize: TUTORIAL_MENU_TITLE_FONT_SIZE,
          fill: TUTORIAL_MENU_TITLE_COLOR,
          outlineWidth: 0,
          textureScaleMode: "nearest",
        },
      },
      itemStyle: () => ({
        fontSize: layout.itemSize,
        fill: 0xffffff,
        outlineWidth: 0,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: layout.backgroundMarginX,
      backgroundMarginY: layout.backgroundMarginY,
      geometry: (titleSize, columnItemSizes) =>
        worldMenuGeometry(screen, columnItemSizes, DISPLAY_MODE, titleSize),
      buttonLabel: (entry) =>
        entry.value.kind === "topic"
          ? `tutorialMenu:${entry.value.topic.key}`
          : "tutorialMenu:back",
    });

    for (const button of view.buttons) {
      const { item } = button;
      (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
        if (menu.closed || menu.openingTutorial || menu.activeTutorial !== undefined) return;
        opts.onClick();
        if (item.value.kind === "back") {
          menu.close();
          return;
        }
        void menu.present(item.value.topic);
      });
    }

    const closeTexture = await opts.assets.sprite("PopupMenuCloseButton-hd");
    const close = new ButtonSprite({ normalTexture: closeTexture, pressSound: opts.onClick });
    close.label = "tutorialMenu:close";
    close.position.set(
      screen.w - layout.closeInset - closeTexture.width / 2,
      layout.closeInset,
    );
    close.onPress(() => menu.close());
    menu.addChild(close);

    presentationParent.sortableChildren = true;
    presentationParent.addChild(menu);
    void tween(opts.ticker, DIM_FADE_MS, (t) => {
      if (!menu.closed) dim.alpha = t * DIM_OPACITY;
    });
    return menu;
  }

  requestBack(): boolean {
    if (this.closed) return false;
    // The source PlotGameFlowEvent is a swallowing modal above the retained topic menu. A browser
    // Escape adaptation must not leak through and close that underlay.
    if (this.activeTutorial !== undefined || this.openingTutorial) return true;
    this.close();
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.activeTutorial?.dismiss();
    this.activeTutorial = undefined;
    this.opts.onClose();
    this.removeFromParent();
    this.destroy({ children: true });
  }

  get debugState(): TutorialMenuDebugState {
    return {
      kind: "tutorials",
      screen: "topics",
      title: this.titleText,
      columns: this.columns.map((column) => column.map((entry) => ({
        action: entry.kind === "topic" ? entry.topic.key : "back",
        label: entry.label,
      }))),
      tutorial: this.tutorialState ?? null,
    };
  }

  private async present(topic: SourceTutorialTopic): Promise<void> {
    this.openingTutorial = true;
    this.opts.onStateChanged?.();
    try {
      const handle = await showPlotTutorial({
        parent: this.opts.parent,
        owner: this,
        assets: this.opts.assets,
        scale9: this.opts.scale9,
        strings: this.opts.strings,
        ticker: this.opts.ticker,
        keyboard: this.opts.keyboard,
        key: topic.key,
        images: topic.images,
        onClick: this.opts.onClick,
        onStateChanged: (state) => {
          this.tutorialState = state;
          this.opts.onStateChanged?.();
        },
      });
      if (this.closed) {
        handle.dismiss();
        return;
      }
      this.activeTutorial = handle;
      void handle.done.then(() => {
        if (this.activeTutorial === handle) this.activeTutorial = undefined;
        this.opts.onStateChanged?.();
      });
    } finally {
      this.openingTutorial = false;
      this.opts.onStateChanged?.();
    }
  }
}

function stem(file: string): string {
  return file.replace(/\.png$/i, "");
}
