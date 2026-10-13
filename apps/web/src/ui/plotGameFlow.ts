import { setOwnedTexture } from "@dib/renderer";
import { Container, Graphics, Rectangle, Sprite, Texture, type Ticker } from "pixi.js";
import { makeTtfLabel, pointSprite, type AssetLibrary, type Scale9SpritesData } from "@dib/renderer";
import type { KeyboardShortcutRouter } from "../keyboardShortcuts.js";
import { isAdvanceShortcut } from "../keyboardShortcuts.js";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import {
  easeExponentialIn,
  easeExponentialInOut,
  easeExponentialOut,
} from "../tween.js";
import { prepareMenuButton2 } from "./menuButton2.js";
import {
  PLOT_BACKGROUND_TEXTURE_RECT_PX,
  PLOT_OK_DELAY_MS,
  PLOT_OK_MOVE_MS,
  PLOT_SLIDE_MS,
  plotOkButtonY,
  plotPageLayout,
} from "./plotGameFlowMath.js";

export interface PlotTutorialDebugState {
  readonly key: string;
  readonly page: number;
  readonly pageCount: number;
  readonly image: string;
  readonly okReady: boolean;
  readonly entering: boolean;
}

export interface PlotTutorialHandle {
  readonly done: Promise<void>;
  readonly debugState: PlotTutorialDebugState;
  dismiss(): void;
}

export async function showPlotTutorial(opts: {
  readonly parent: Container;
  readonly owner: object;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly keyboard: KeyboardShortcutRouter;
  readonly key: string;
  readonly images: readonly string[];
  readonly onClick?: () => void;
  readonly onStateChanged?: (state: PlotTutorialDebugState | undefined) => void;
}): Promise<PlotTutorialHandle> {
  if (opts.images.length === 0) throw new Error(`${opts.key} requires at least one tutorial page`);
  const textures = await Promise.all(opts.images.map((image) => opts.assets.sprite(stem(image))));
  const layout = plotPageLayout(DISPLAY_MODE);
  const root = new Container();
  root.label = `plotTutorial:${opts.key}`;
  root.sortableChildren = true;
  root.zIndex = 90_000;
  root.eventMode = "static";
  root.hitArea = new Rectangle(0, 0, layout.screen.w, layout.screen.h);
  opts.parent.sortableChildren = true;
  opts.parent.addChild(root);

  let page = 0;
  let okReady = false;
  let entering = true;
  let disposed = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => { resolveDone = resolve; });
  const tickers = new Set<(ticker: Ticker) => void>();
  let keyboardCleanup = () => {};

  const state = (): PlotTutorialDebugState => ({
    key: opts.key,
    page,
    pageCount: textures.length,
    image: opts.images[page]!,
    okReady,
    entering,
  });
  const publish = (): void => opts.onStateChanged?.(state());
  const clearTickers = (): void => {
    for (const tick of tickers) opts.ticker.remove(tick);
    tickers.clear();
  };
  const dismiss = (): void => {
    if (disposed) return;
    disposed = true;
    clearTickers();
    keyboardCleanup();
    root.removeFromParent();
    root.destroy({ children: true });
    opts.onStateChanged?.(undefined);
    resolveDone();
  };
  const animate = (
    durationMs: number,
    update: (t: number) => void,
    complete?: () => void,
  ): void => {
    let elapsed = 0;
    const tick = (): void => {
      elapsed += opts.ticker.deltaMS;
      const t = Math.min(1, elapsed / durationMs);
      update(t);
      if (t < 1) return;
      opts.ticker.remove(tick);
      tickers.delete(tick);
      complete?.();
    };
    tickers.add(tick);
    opts.ticker.add(tick);
  };
  const after = (durationMs: number, complete: () => void): void => {
    animate(durationMs, () => {}, complete);
  };

  const advance = (): void => {
    if (!okReady || disposed) return;
    opts.onClick?.();
    if (page + 1 < textures.length) {
      page += 1;
      clearTickers();
      void renderPage(false);
      return;
    }
    okReady = false;
    publish();
    animate(PLOT_SLIDE_MS, (raw) => {
      root.y = layout.screen.h * easeExponentialIn(raw);
    }, dismiss);
  };

  const renderPage = async (first: boolean): Promise<void> => {
    if (disposed) return;
    root.removeChildren().forEach((child) => child.destroy({ children: true }));
    root.y = first ? layout.screen.h : 0;
    entering = first;
    okReady = !first;
    const full = textures[page]!;
    if (
      full.width < PLOT_BACKGROUND_TEXTURE_RECT_PX.w ||
      full.height < PLOT_BACKGROUND_TEXTURE_RECT_PX.h
    ) {
      throw new Error(
        `${opts.images[page]} is ${full.width}x${full.height}; plot crop requires 1024x768`,
      );
    }
    const background = pointSprite(new Texture({
      source: full.source,
      frame: new Rectangle(
        PLOT_BACKGROUND_TEXTURE_RECT_PX.x,
        PLOT_BACKGROUND_TEXTURE_RECT_PX.y,
        PLOT_BACKGROUND_TEXTURE_RECT_PX.w,
        PLOT_BACKGROUND_TEXTURE_RECT_PX.h,
      ),
    }));
    setOwnedTexture(background, background.texture);
    background.label = `plotBackground:${opts.images[page]}`;
    background.position.set(layout.background.x, layout.background.y);
    background.eventMode = "none";
    root.addChild(background);

    const label = makeTtfLabel(
      localizedString(opts.strings, "OkButtonKey"),
      layout.okFontSize,
      { outlineWidthPt: 2, textureScaleMode: "nearest" },
    );
    label.anchor.set(0.5);
    const prepared = await prepareMenuButton2({
      assets: opts.assets,
      scale9: opts.scale9,
      label,
    });
    // ButtonLabel centers its label and MenuButton2 chrome on the same content box. A centered
    // anchor at the node origin put the port's "Ok" ink up-left of the visible plate.
    label.label = "plotTutorialOkLabel";
    label.position.set(
      prepared.layoutContentSize.w / 2,
      prepared.layoutContentSize.h / 2,
    );
    const button = prepared.node;
    button.label = "plotTutorialOk";
    button.children[0]!.label = "plotTutorialOkBackground";
    button.pivot.set(prepared.layoutContentSize.w / 2, prepared.layoutContentSize.h / 2);
    const buttonY = plotOkButtonY(DISPLAY_MODE, prepared.layoutContentSize.h);
    button.position.set(layout.okX, first ? buttonY.initial : buttonY.final);
    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointertap", (event) => {
      event.stopPropagation();
      advance();
    });
    root.addChild(button);

    const blocker = new Graphics()
      .rect(0, 0, layout.screen.w, layout.screen.h)
      .fill({ color: 0, alpha: 0.001 });
    blocker.eventMode = "static";
    blocker.zIndex = -1;
    root.addChild(blocker);

    publish();
    if (!first) return;
    // The source button is registered as soon as it is constructed. Its 0.25s DelayTime overlaps
    // the page's own 0.75s entry; it is not a 2.5s input lock after the tutorial arrives.
    okReady = true;
    publish();
    animate(PLOT_SLIDE_MS, (raw) => {
      root.y = layout.screen.h * (1 - easeExponentialOut(raw));
    }, () => {
      entering = false;
      publish();
    });
    after(PLOT_OK_DELAY_MS, () => {
      animate(PLOT_OK_MOVE_MS, (raw) => {
        const t = easeExponentialInOut(raw);
        button.y = buttonY.initial + (buttonY.final - buttonY.initial) * t;
      });
    });
  };

  keyboardCleanup = opts.keyboard.register(({ key }) => {
    if (!isAdvanceShortcut(key) || !okReady) return false;
    advance();
    return true;
  });
  await renderPage(true);
  return {
    done,
    get debugState() { return state(); },
    dismiss,
  };
}

function stem(file: string): string {
  return file.replace(/\.png$/i, "");
}
