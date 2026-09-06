


import { Container, Rectangle, Texture, type Ticker } from "pixi.js";
import { CONTENT_SCALE_FACTOR, makeTtfLabel, pointSprite, type AssetLibrary } from "@dib/renderer";
import { easeElasticIn, easeElasticInOut, easeExponentialOut, tween } from "../tween.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { SCREEN_H, SCREEN_W } from "./displayShared.js";
import {
  EVOLVE_REVEAL_FLIP_MS,
  EVOLVE_REVEAL_FLIP_REPS,
  EVOLVE_SHAKE_MS,
  EVOLVE_SHAKE_REPS,
  EVOLVE_STAR_ROW_SHOW_DELAY_MS,
  EVOLVE_STAR_TWINKLE_MS,
  EVOLVE_STARS_PER_ROW,
  evolutionBannerLayoutPt,
  evolutionLayoutPt,
  evolutionOutlineOffsets,
  flipScaleX,
  isNewEvolutionStar,
} from "./evolutionMath.js";

/** Ticker-clocked sleep (same idiom as EnemyMonsterDisplay's local helper). */
const sleepOn = (ticker: Ticker, ms: number, signal?: AbortSignal): Promise<void> =>
  ms <= 0 ? Promise.resolve() : tween(ticker, ms, () => {}, (t) => t, signal);

/** Banner: opacity 0 / scale 0.75 -> FadeIn(0.3) then EaseElasticIn(ScaleTo(1.0, scale 1.0)). */
const BANNER_FADE_MS = 300;
const BANNER_SCALE_MS = 1000;
const BANNER_START_SCALE = 0.75;
let BANNER_LAYOUT = evolutionBannerLayoutPt(DISPLAY_MODE);


let LAYOUT = evolutionLayoutPt(DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  BANNER_LAYOUT = evolutionBannerLayoutPt(DISPLAY_MODE);
  LAYOUT = evolutionLayoutPt(DISPLAY_MODE);
});
/** Reveal name label: Delay(2.0) FadeIn(0.3) Delay(1.4) FadeAndRemove(0.3). */
const NAME_DELAY_MS = 2000;
const NAME_FADE_IN_MS = 300;
const NAME_HOLD_MS = 1400;
const NAME_FADE_OUT_MS = 300;
/** New-star twinkle: scale 0.01 then EaseElasticInOut(ScaleTo(4.0, scale 1.0)). */
const STAR_TWINKLE_START_SCALE = 0.01;

export interface EvolutionRevealOpts {
  shortType: string;
  displayName: string;
  /** Pre-evolution rarity, including a possible .5 half star. */
  oldStars: number;
  /** Evolved species' star count (may carry a .5 half star). */
  newStars: number;
  /** `RendererFactory`'s authored `rendererData.scale`; defaults to 1. */
  rendererScale?: number;
}

export interface EvolutionAssets {
  readonly banner: Texture;
  readonly star: Texture;
  readonly monsters: ReadonlyMap<string, Texture>;
}

/** Load every texture before `beginEvolve:` starts. Native constructs the full sequence
 * synchronously; allowing an evolved sprite fetch between tag-2 removal and reveal creates a
 * browser-only blank frame and lengthens the exact five-second iteration. */
export async function loadEvolutionAssets(
  assets: AssetLibrary,
  shortTypes: readonly string[],
): Promise<EvolutionAssets> {
  const uniqueTypes = [...new Set(shortTypes)];
  const [banner, star, ...monsterTextures] = await Promise.all([
    assets.sprite("monsterEvolved"),
    assets.sprite("largeRarityStar-hd"),
    ...uniqueTypes.map((shortType) => assets.sprite(`${shortType}-hd`)),
  ]);
  return {
    banner,
    star,
    monsters: new Map(uniqueTypes.map((shortType, i) => [shortType, monsterTextures[i]!])),
  };
}

/** Scene overlay for one battle's evolution chain. The long shake is fire-and-forget (the source
 * leaves it running and yanks the node — flow doc §6); tag cleanup aborts the corresponding
 * ticker work just as Cocos `removeFromParentAndCleanup:YES` stops descendant actions. */
export class EvolutionOverlay extends Container {
  private shakeOrRevealNode: Container | null = null; // Cocos tag 2
  private banner: Container | null = null; // Cocos tag 3
  private tag2Actions: AbortController | null = null;
  private bannerActions: AbortController | null = null;
  private evolutionAssets: EvolutionAssets | undefined;

  constructor(private readonly ticker: Ticker) {
    super();
    // `beginEvolve:` sets BattleNode.locked=YES; its high-priority targeted touch delegate claims
    // and swallows every touch until the final no-candidate pass. This topmost full-screen hit area
    // is the Pixi equivalent and prevents field/card callbacks from leaking through the reveal.
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, SCREEN_W, SCREEN_H);
    for (const eventName of [
      "pointerdown",
      "pointermove",
      "pointerup",
      "pointerupoutside",
      "pointertap",
    ] as const) {
      this.on(eventName, (event) => event.stopPropagation());
    }
  }

  /** Installs the bundle loaded before native-equivalent animation time begins. Kept separate
   * from construction so the full-screen locked-touch consumer can mount before an emergency
   * fallback preload finishes. */
  setAssets(assets: EvolutionAssets): void {
    if (this.evolutionAssets) throw new Error("EvolutionOverlay: assets already installed");
    this.evolutionAssets = assets;
  }

  /** `runEvolutionStartAnimationForMonster:` — pre-evolution monster, screen-centered, flip-shake
   *  ~8.4s eased exponential-out. Resolves once the node is on screen (the animation outlives the
   *  1.0s `performEvolution` schedule by design and is cut short when the node is removed). */
  showShake(shortType: string, rendererScale = 1): void {
    const sprite = pointSprite(this.monsterTexture(shortType));
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(SCREEN_W / 2, SCREEN_H / 2);
    const authoredScale = checkedRendererScale(rendererScale);
    sprite.scale.set(sprite.scale.x * authoredScale, sprite.scale.y * authoredScale);
    const signal = this.setTag2(sprite)!;
    this.runFlip(sprite, EVOLVE_SHAKE_MS, EVOLVE_SHAKE_REPS, signal);
  }

  /** `beginEvolve:`'s banner add + previous-banner removal quirk (see module header). */
  showBanner(): void {
    const previous = this.banner;
    const previousActions = this.bannerActions;
    // Although the file is bare, CCTexture2D.contentSize divides its pixels by phone CSF=2;
    // native iPad coordinates normalize by the same factor in this port. pointSprite supplies
    // that 0.5 fold. Source anchor is Cocos top-center (0.5,1), i.e. Pixi (0.5,0).
    const banner = pointSprite(this.assets().banner);
    banner.anchor.set(BANNER_LAYOUT.anchor.x, BANNER_LAYOUT.anchor.y);
    banner.position.set(BANNER_LAYOUT.position.x, BANNER_LAYOUT.position.y);
    banner.alpha = 0;
    const bannerRestScale = BANNER_LAYOUT.textureScale;
    banner.scale.set(bannerRestScale * BANNER_START_SCALE);
    this.addChild(banner);
    this.banner = banner;
    const actions = new AbortController();
    this.bannerActions = actions;
    previousActions?.abort();
    previous?.destroy({ children: true });
    void (async () => {
      await tween(
        this.ticker,
        BANNER_FADE_MS,
        (t) => {
          if (!banner.destroyed) banner.alpha = t;
        },
        (t) => t,
        actions.signal,
      );
      if (banner.destroyed) return;
      await tween(
        this.ticker,
        BANNER_SCALE_MS,
        (t) => {
          if (!banner.destroyed) {
            banner.scale.set(bannerRestScale * (BANNER_START_SCALE + (1 - BANNER_START_SCALE) * t));
          }
        },
        easeElasticIn,
        actions.signal,
      );
    })();
  }

  /** `performEvolution`'s tag-2 removal (the shake node) before the reveal replaces it. */
  removeShake(): void {
    this.setTag2(null);
  }

  /** `performEvolution`'s reveal: evolved sprite (short flip), outlined name label fade
   *  sequence, star rows with new-star twinkles. Resolves when the reveal is mounted. */
  showReveal(opts: EvolutionRevealOpts): void {
    const reveal = new Container();
    // RendererFactory returns a content-sized Cocos node whose local origin remains bottom-left
    // while its transform pivots about the center. This wrapper gives Pixi the equivalent
    // top-left local content frame plus a centered pivot, so child star Boxes inherit the flip.
    const monsterNode = new Container();
    const sprite = pointSprite(this.monsterTexture(opts.shortType));
    const monsterW = sprite.width;
    const monsterH = sprite.height;
    monsterNode.pivot.set(monsterW / 2, monsterH / 2);
    monsterNode.position.set(SCREEN_W / 2, SCREEN_H / 2);
    monsterNode.scale.set(checkedRendererScale(opts.rendererScale ?? 1));
    monsterNode.addChild(sprite);
    reveal.addChild(monsterNode);


    const label = this.buildNameLabel(opts.displayName);
    const labelY = SCREEN_H / 2 - monsterH / 2 - LAYOUT.nameGapPt;
    label.position.set(SCREEN_W / 2, labelY);
    label.alpha = 0;
    reveal.addChild(label);
    const signal = this.setTag2(reveal)!;
    this.runFlip(monsterNode, EVOLVE_REVEAL_FLIP_MS, EVOLVE_REVEAL_FLIP_REPS, signal);
    void (async () => {
      await sleepOn(this.ticker, NAME_DELAY_MS, signal);
      if (label.destroyed) return;
      await tween(
        this.ticker,
        NAME_FADE_IN_MS,
        (t) => {
          if (!label.destroyed) label.alpha = t;
        },
        (t) => t,
        signal,
      );
      await sleepOn(this.ticker, NAME_HOLD_MS, signal);
      if (label.destroyed) return;
      await tween(
        this.ticker,
        NAME_FADE_OUT_MS,
        (t) => {
          if (!label.destroyed) label.alpha = 1 - t;
        },
        (t) => t,
        signal,
      );
      if (!label.destroyed) label.destroy();
    })();

    this.buildStarRows(monsterNode, this.assets().star, opts, monsterW, monsterH, signal);
  }

  /** `endEvolve`'s tag-2 removal (the reveal) before looping back into `beginEvolve:`. */
  removeReveal(): void {
    this.setTag2(null);
  }

  /** The final `beginEvolve:` pass's cleanup after `endBattle` — drops the last banner. */
  clearBanner(): void {
    this.bannerActions?.abort();
    this.bannerActions = null;
    this.banner?.destroy({ children: true });
    this.banner = null;
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.tag2Actions?.abort();
    this.bannerActions?.abort();
    this.tag2Actions = null;
    this.bannerActions = null;
    this.shakeOrRevealNode = null;
    this.banner = null;
    super.destroy(options);
  }

  private setTag2(node: Container | null): AbortSignal | undefined {
    this.tag2Actions?.abort();
    this.tag2Actions = null;
    this.shakeOrRevealNode?.destroy({ children: true });
    this.shakeOrRevealNode = node;
    if (!node) return undefined;
    const actions = new AbortController();
    this.tag2Actions = actions;
    this.addChild(node);
    return actions.signal;
  }

  /** The Repeat(ScaleBy(·, -1x, 1x), reps) mirror-flip under EaseExponentialOut, cut short
   *  whenever the node is destroyed (the source never stops the action either — it removes
   *  the target node, flow doc §6). */
  private runFlip(node: Container, totalMs: number, reps: number, signal: AbortSignal): void {
    const baseScaleX = node.scale.x;
    void tween(
      this.ticker,
      totalMs,
      (t) => {
        if (!node.destroyed) node.scale.x = baseScaleX * flipScaleX(reps, t);
      },
      easeExponentialOut,
      signal,
    );
  }


  private buildStarRows(
    monsterNode: Container,
    starTexture: Texture,
    opts: EvolutionRevealOpts,
    monsterW: number,
    monsterH: number,
    signal: AbortSignal,
  ): void {
    const fullCount = Math.floor(opts.newStars);
    const hasHalf = opts.newStars - fullCount >= 0.5;
    const total = fullCount + (hasHalf ? 1 : 0);
    if (total <= 0) return;
    const halfTexture = hasHalf
      ? new Texture({
          source: starTexture.source,
          frame: new Rectangle(
            starTexture.frame.x,
            starTexture.frame.y,
            starTexture.frame.width / 2,
            starTexture.frame.height,
          ),
        })
      : undefined;
    const probe = pointSprite(starTexture);
    const starW = probe.width;
    const starH = probe.height;
    probe.destroy();

    for (let rowStart = 0; rowStart < total; rowStart += EVOLVE_STARS_PER_ROW) {
      const rowIndex = rowStart / EVOLVE_STARS_PER_ROW;
      const rowCount = Math.min(EVOLVE_STARS_PER_ROW, total - rowStart);
      const row = new Container();
      // Cocos row positions: first=(node.w/2,node.h/2), overflow=(node.w/2,
      // node.h/2-row2.h). Convert the latter from Y-up into this top-left/Y-down local frame.
      row.position.set(monsterW / 2, monsterH / 2 + rowIndex * starH);
      row.visible = false;
      monsterNode.addChild(row);
      void (async () => {
        await sleepOn(this.ticker, EVOLVE_STAR_ROW_SHOW_DELAY_MS, signal);
        if (!row.destroyed) row.visible = true;
      })();

      let slotX = 0;
      for (let i = 0; i < rowCount; i++) {
        const starIndex = rowStart + i;
        const isHalf = hasHalf && starIndex === total - 1;
        const star = pointSprite(isHalf && halfTexture ? halfTexture : starTexture);
        star.anchor.set(0.5, 0.5);
        // Box first lays out anchor-(0,0) children at running x and Cocos y=-h/2. The source
        // then changes anchors to (0.5,0.5) without repositioning. Pixi Y-down maps that raw
        // layout point to +h/2; keeping x=slot start preserves the same post-layout shift.
        star.position.set(slotX, starH / 2);
        slotX += (isHalf ? starW / 2 : starW) + LAYOUT.starGapPt;
        row.addChild(star);
        const naturalScale = { x: star.scale.x, y: star.scale.y };
        const isNewStar = isNewEvolutionStar(
          opts.oldStars,
          isHalf ? fullCount : starIndex + 1,
          isHalf,
        );
        if (isNewStar) {
          star.scale.set(
            naturalScale.x * STAR_TWINKLE_START_SCALE,
            naturalScale.y * STAR_TWINKLE_START_SCALE,
          );
          void tween(
            this.ticker,
            EVOLVE_STAR_TWINKLE_MS,
            (t) => {
              if (star.destroyed) return;
              const s = STAR_TWINKLE_START_SCALE + (1 - STAR_TWINKLE_START_SCALE) * t;
              star.scale.set(naturalScale.x * s, naturalScale.y * s);
            },
            easeElasticInOut,
            signal,
          );
        }
      }
    }
  }

  private monsterTexture(shortType: string): Texture {
    const texture = this.assets().monsters.get(shortType);
    if (!texture) throw new Error(`EvolutionOverlay: renderable ${shortType} was not preloaded`);
    return texture;
  }

  private assets(): EvolutionAssets {
    if (!this.evolutionAssets) throw new Error("EvolutionOverlay: assets not installed");
    return this.evolutionAssets;
  }

  private buildNameLabel(displayName: string): Container {
    const root = new Container();
    const outlined = new Container();
    for (const offset of evolutionOutlineOffsets(LAYOUT.nameOutlineRadiusPt)) {
      const sample = makeTtfLabel(displayName, LAYOUT.nameFontPt, { fill: 0x000000, outline: false });
      sample.anchor.set(0.5, 0.5);
      sample.position.set(offset.x, offset.y);
      outlined.addChild(sample);
    }


    const renderedCenter = makeTtfLabel(displayName, LAYOUT.nameFontPt, { outline: false });
    renderedCenter.anchor.set(0.5, 0.5);
    outlined.addChild(renderedCenter);
    outlined.cacheAsTexture({ resolution: CONTENT_SCALE_FACTOR, scaleMode: "nearest", antialias: false });
    root.addChild(outlined);

    const original = makeTtfLabel(displayName, LAYOUT.nameFontPt, { outline: false });
    original.anchor.set(0.5, 0.5);
    root.addChild(original);
    return root;
  }
}

function checkedRendererScale(scale: number): number {
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new Error(`EvolutionOverlay: invalid rendererData.scale ${scale}`);
  }
  return scale;
}
