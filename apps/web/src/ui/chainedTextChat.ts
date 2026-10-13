import { setOwnedTexture } from "@dib/renderer";
import {
  Container,
  Graphics,
  Rectangle,
  Texture,
  type FederatedPointerEvent,
  type Sprite,
  type Ticker,
} from "pixi.js";
import {
  cropTextureRect,
  makeColoredBitmapLabel,
  pointSprite,
  type PixelRect,
} from "@dib/renderer";
import {
  CHAINED_TEXT_CHAT_DIM_FADE_MS,
  chainedTextChatDimAlpha,
  chainedTextChatPortraitRevealFraction,
} from "./chainedTextChatMath.js";
import { PopupHost, type NotificationOverlay } from "./popup.js";

export interface ChainedTextChatHandle {
  readonly root: Container;
  readonly closed: Promise<void>;
  dismiss(force?: boolean): void;
}









export const CHAINED_TEXT_CHAT_Z_INDEX = 20_000;

/**
 * Shared non-Japanese `ChainedTextLabel` presentation path.
 *
 * All `Dialogs.Chat` consumers belong here: it centrally removes/applies the source color codes,
 * uses the shipped BMFont before wrapping, and reproduces the presenter's full-screen black dim.
 */
export function showChainedTextChat(opts: {
  readonly parent: Container;
  readonly ticker: Ticker;
  readonly background: Container;
  readonly finishTexture: Texture;
  readonly message: string;
  readonly fontSize: number;
  readonly size: { readonly w: number; readonly h: number };
  readonly position: { readonly x: number; readonly y: number };
  readonly screen: { readonly w: number; readonly h: number };
  readonly rootLabel: string;
  readonly textLabel: string;
  readonly finishLabel: string;
  readonly portrait?: Sprite;
  readonly portraitLabel?: string;
  readonly onDismiss?: () => void;
}): ChainedTextChatHandle {


  const parent = PopupHost.presentationParentFor(opts.parent);
  const host = PopupHost.for(parent);

  const root = new Container();
  root.label = opts.rootLabel;
  root.position.set(opts.position.x, opts.position.y);
  root.zIndex = CHAINED_TEXT_CHAT_Z_INDEX;
  root.eventMode = "static";
  root.cursor = "pointer";
  root.hitArea = { contains: () => true };
  root.sortableChildren = true;

  // The presenter's first pass hides every automatic layer already on the notification node whose
  // `hidesWhenNotOnTop` is YES — which is every Scale9Popup — and returns whether a dim is already
  // up. The dungeon's floor notice therefore covers the waypoint selector raised earlier in the
  // same turn, and the selector comes back when the notice is tapped away.
  const overlay: NotificationOverlay = {
    node: root,
    setHiddenByLayerAbove: (hidden) => {
      if (!root.destroyed) root.visible = !hidden;
    },
  };
  const stacked = host.registerOverlay(overlay);

  const dim = new Graphics()
    .rect(-opts.position.x, -opts.position.y, opts.screen.w, opts.screen.h)
    .fill({ color: 0x000000 });
  dim.label = `${opts.rootLabel}Dim`;
  dim.alpha = chainedTextChatDimAlpha(0, stacked);
  dim.eventMode = "none";
  dim.zIndex = -9_999;
  root.addChild(dim);

  const backgroundBounds = opts.background.getLocalBounds();
  opts.background.label = `${opts.rootLabel}Background`;
  opts.background.position.set(
    -backgroundBounds.width / 2 - backgroundBounds.x,
    -backgroundBounds.height / 2 - backgroundBounds.y,
  );
  opts.background.eventMode = "none";
  opts.background.zIndex = -10;
  root.addChild(opts.background);

  let portraitToaster: PortraitToaster | undefined;
  if (opts.portrait !== undefined) {
    opts.portrait.label = opts.portraitLabel ?? `${opts.rootLabel}Portrait`;
    opts.portrait.position.set(-opts.position.x, -0.75 * opts.size.h);
    opts.portrait.zIndex = -20;
    opts.portrait.eventMode = "none";
    root.addChild(opts.portrait);
    portraitToaster = startPortraitToaster(opts.portrait);
  }

  const label = makeColoredBitmapLabel(opts.message, opts.fontSize, true, {
    wordWrapWidth: opts.size.w,
    align: "left",
  });
  label.label = opts.textLabel;
  label.position.set(-opts.size.w / 2, -opts.size.h / 2);
  label.eventMode = "none";
  root.addChild(label);

  const finish = pointSprite(opts.finishTexture);
  finish.label = opts.finishLabel;
  finish.position.set(opts.size.w / 2 - finish.width, opts.size.h / 2 - finish.height);
  finish.eventMode = "none";
  root.addChild(finish);

  let elapsedMs = 0;
  let blinkElapsedMs = 0;
  // The portrait's ToasterAction owns a separate accumulator from the presenter's dim: it is an
  // action on the sprite, not part of the label's own `update:`, and `CCActionInterval` reports
  // elapsed 0 on its first tick.
  let portraitToasterMs = 0;
  let portraitToasterFirstTick = true;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const tick = (): void => {
    elapsedMs += opts.ticker.deltaMS;
    dim.alpha = chainedTextChatDimAlpha(elapsedMs, stacked);
    if (portraitToaster !== undefined) {
      if (portraitToasterFirstTick) portraitToasterFirstTick = false;
      else portraitToasterMs += opts.ticker.deltaMS;
      applyPortraitReveal(
        portraitToaster,
        chainedTextChatPortraitRevealFraction(portraitToasterMs),
      );
    }
    blinkElapsedMs += opts.ticker.deltaMS;
    if (blinkElapsedMs < 500) return;
    blinkElapsedMs %= 500;
    finish.visible = !finish.visible;
  };
  const dismiss = (event?: FederatedPointerEvent, force = false): void => {
    event?.stopPropagation();
    if ((!force && elapsedMs < CHAINED_TEXT_CHAT_DIM_FADE_MS) || root.destroyed) return;
    opts.ticker.remove(tick);
    host.releaseOverlay(overlay);
    root.parent?.removeChild(root);
    root.destroy({ children: true });
    opts.onDismiss?.();
    resolveClosed();
  };
  root.on("pointertap", (event) => dismiss(event));
  parent.sortableChildren = true;
  parent.addChild(root);
  opts.ticker.add(tick);
  return {
    root,
    closed,
    dismiss: (force = false) => dismiss(undefined, force),
  };
}

/** Live state of one portrait's `ToasterAction`: the sprite, the full `textureRect`
 *  `startWithTarget:` cached from it, and the fraction of that rect currently applied. */
interface PortraitToaster {
  readonly sprite: Sprite;
  readonly full: PixelRect;
  fraction: number;
}






function startPortraitToaster(sprite: Sprite): PortraitToaster {
  if (sprite.texture.rotate !== 0) {
    // A rotated atlas frame would need the crop axis remapped; fail loud rather than silently
    // slicing the wrong edge (same guard ProgressBar applies to its own textureRect crop).
    throw new Error("chained text chat portrait: rotated atlas frame is not supported");
  }
  const frame = sprite.texture.frame;
  const toaster: PortraitToaster = {
    sprite,
    full: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
    fraction: Number.NaN,
  };
  applyPortraitReveal(toaster, 0);
  return toaster;
}






function applyPortraitReveal(toaster: PortraitToaster, fraction: number): void {
  if (toaster.fraction === fraction) return;
  toaster.fraction = fraction;
  const rect = cropTextureRect(toaster.full, fraction, false, false);
  setOwnedTexture(toaster.sprite, new Texture({
    source: toaster.sprite.texture.source,
    frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
  }));
}
