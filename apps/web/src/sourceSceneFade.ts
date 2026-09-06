import { Container, Graphics, Rectangle, type Ticker } from "pixi.js";
import { tweenWithResult } from "./tween.js";
import {
  SOURCE_BLACK_SCENE_FADE_HALF_MS,
  SOURCE_BLACK_SCENE_FADE_MS,
} from "./sourceSceneFadeMath.js";

export { SOURCE_BLACK_SCENE_FADE_HALF_MS, SOURCE_BLACK_SCENE_FADE_MS };

export type SourceBlackSceneFadePhase = "covering" | "revealing";

export interface SourceBlackSceneFadeState {
  readonly route: string;
  readonly phase: SourceBlackSceneFadePhase;
  readonly alpha: number;
}

export interface SourceBlackSceneFadeOptions {
  readonly parent: Container;
  readonly ticker: Ticker;
  readonly width: number;
  readonly height: number;
  readonly route: string;
  readonly onMidpoint: () => void | Promise<void>;
  readonly signal?: AbortSignal;
  readonly onState?: (state: SourceBlackSceneFadeState | undefined) => void;
  readonly label?: string;
}









export async function runSourceBlackSceneFade(
  opts: SourceBlackSceneFadeOptions,
): Promise<boolean> {
  if (opts.signal?.aborted || opts.parent.destroyed) return false;
  const shade = new Graphics().rect(0, 0, opts.width, opts.height).fill(0x000000);
  shade.label = opts.label ?? `sourceBlackSceneFade:${opts.route}`;
  shade.alpha = 0;
  shade.zIndex = 1_000_000;
  shade.eventMode = "static";
  shade.hitArea = new Rectangle(0, 0, opts.width, opts.height);
  opts.parent.sortableChildren = true;
  opts.parent.addChild(shade);

  const publish = (phase: SourceBlackSceneFadePhase, alpha: number): void => {
    opts.onState?.({ route: opts.route, phase, alpha });
  };

  try {
    publish("covering", 0);
    const covered = await tweenWithResult(
      opts.ticker,
      SOURCE_BLACK_SCENE_FADE_HALF_MS,
      (alpha) => {
        shade.alpha = alpha;
        publish("covering", alpha);
      },
      undefined,
      opts.signal,
    );
    if (covered === "cancelled" || opts.parent.destroyed) return false;

    shade.alpha = 1;
    publish("covering", 1);
    await opts.onMidpoint();
    if (opts.signal?.aborted || opts.parent.destroyed) return false;

    publish("revealing", 1);
    const revealed = await tweenWithResult(
      opts.ticker,
      SOURCE_BLACK_SCENE_FADE_HALF_MS,
      (progress) => {
        shade.alpha = 1 - progress;
        publish("revealing", 1 - progress);
      },
      undefined,
      opts.signal,
    );
    return revealed === "completed";
  } finally {
    opts.onState?.(undefined);
    if (!shade.destroyed) shade.destroy();
  }
}
