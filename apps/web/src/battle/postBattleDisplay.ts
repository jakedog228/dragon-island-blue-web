import { Container } from "pixi.js";
import {
  BAR_GROW_SPEED,
  Box,
  ProgressBar,
  makeTtfLabel,
  OUTLINE_FADE_ALPHA,
  pointSprite,
  type AssetLibrary,
} from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { SourcePointParticleSystem } from "../sourcePointParticleSystem.js";
import { SCREEN_H, SCREEN_W } from "./displayShared.js";
import { shrinkToFitScale } from "./displayShared.js";
import { formatAwardXp, xpAwardLayoutMetrics } from "./postBattleMath.js";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";

export interface XpAwardEntry {
  id: string;
  shortType: string;
  beforeXp: number;
  afterXp: number;
  xpCostOfNextLevel: number;
}

export interface XpAwardDisplayState {
  amount: number;
  columns: number;
  rows: number;
  elapsedMs: number;
  targetStarted: boolean;
  entries: Array<{
    id: string;
    shortType: string;
    beforeXp: number;
    afterXp: number;
    xpCostOfNextLevel: number;
  }>;
  /** Authored (never ink-derived) span of the packed columns inside the rebased grid frame, and
   *  the grid's own contentSize — the box the popup card is cut from. `inkStart` must be 0 and
   *  `inkEnd` must equal `width`: anything else means a column is hanging outside the card. */
  grid: { width: number; inkStart: number; inkEnd: number };
}

/** `progressBarParticles.plist`, the emitter created by ProgressBar when particlesWhenFull is set. */
export class XpFullParticles extends Container {
  private emitter?: SourcePointParticleSystem;

  constructor(
    private readonly asset: Awaited<ReturnType<AssetLibrary["particle"]>>,
    private readonly particleRandom: () => number = Math.random,
  ) {
    super();
    this.visible = false;
  }

  update(dtMs: number, full: boolean): void {
    this.visible = full;
    if (!this.emitter) {
      if (!full) return;
      this.emitter = new SourcePointParticleSystem({
        asset: this.asset,
        configName: "progressBarParticles.plist",
        mode: DISPLAY_MODE,
        rand: this.particleRandom,
      });
      this.addChild(this.emitter);
      return;
    }
    // Native only toggles visibility after creation; the scheduled particle system keeps aging
    // and emitting while hidden if the percentage later falls below one.
    this.emitter.advance(dtMs / 1000);
  }

  get particleCount(): number { return this.emitter?.particleCount ?? 0; }
}

/** Live content of the source's hide-overlays MonsterHatchPopup XP award card. */
export class XpAwardDisplay {
  readonly content: Box;
  private readonly bars: Array<{ bar: ProgressBar; targetRatio: number; particles: XpFullParticles }> = [];
  private elapsedMs = 0;
  private targetStarted = false;
  private gridGeometry: XpAwardDisplayState["grid"] = { width: 0, inkStart: 0, inkEnd: 0 };

  private constructor(
    content: Box,
    private readonly amount: number,
    private readonly entries: readonly XpAwardEntry[],
    private readonly columns: number,
    private readonly rows: number,
  ) {
    this.content = content;
  }

  static async create(opts: {
    assets: AssetLibrary;
    strings: LocalizedStrings;
    amount: number;
    entries: readonly XpAwardEntry[];
    /** Deterministic test seam for libc `random()`-backed progress-bar particles. */
    particleRandom?: () => number;
  }): Promise<XpAwardDisplay> {
    const metrics = xpAwardLayoutMetrics(opts.entries.length, SCREEN_W, SCREEN_H, DISPLAY_MODE);
    const content = new Box({
      horizontal: false,
      // Source packs toward negative Cocos Y; Pixi's +Y-down adaptation preserves visual order.
      positiveAlignDirection: true,
      gap: metrics.boxGap,
    });
    const display = new XpAwardDisplay(content, opts.amount, opts.entries, metrics.columns, metrics.rows);

    // This is content, not Popup.title: performAwardLogic creates a 16/24pt label and calls the
    // label category's outlineFadeBackgroundNode before stacking it above the monster grid.
    const headingText = formatAwardXp(localizedString(opts.strings, "AwardXPKey"), opts.amount);
    const heading = makeTtfLabel(headingText, metrics.headingFontSize, {
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });







    const bareHeading = makeTtfLabel(headingText, metrics.headingFontSize, { outline: false });
    const bareBounds = bareHeading.getLocalBounds();
    // Pre-transform bounds: Box multiplies by the node's own 1/CONTENT_SCALE_FACTOR scale.
    const headingContentSize = { w: bareBounds.width, h: bareBounds.height };
    bareHeading.destroy();
    content.addBoxChild(heading, { contentSize: headingContentSize });

    const [general, particleAsset] = await Promise.all([
      opts.assets.atlas("General-hd"),
      opts.assets.particle("progressBarParticles.plist"),
    ]);
    const barBackTexture = general.textures["monsterHpBarBack.png"];
    const barTexture = general.textures["monsterHpBar.png"];
    if (!barBackTexture || !barTexture) {
      throw new Error("General-hd is missing the XP ProgressBar frames");
    }


    const columnEntries = Array.from({ length: metrics.columns }, () => [] as XpAwardEntry[]);
    opts.entries.forEach((entry, i) => columnEntries[i % metrics.columns]!.push(entry));
    const columnFrames: Box[] = [];

    const grid = new Box({
      horizontal: true,
      positiveAlignDirection: false,
      gap: metrics.boxGap,



      verticalAlignment: 0,
    });
    for (const entries of columnEntries) {
      const monsters = new Box({
        horizontal: false,
        positiveAlignDirection: true,
        gap: metrics.itemGap,
      });
      const bars = new Box({
        horizontal: false,
        positiveAlignDirection: true,
        gap: metrics.itemGap,
      });

      for (const entry of entries) {
        const monsterCell = new Container();
        const monster = pointSprite(await opts.assets.sprite(`${entry.shortType}-hd`));
        const monsterScale = shrinkToFitScale(
          monster.width,
          monster.height,
          metrics.cellWidth,
          metrics.cellHeight,
        );



        monster.scale.set(monster.scale.x * monsterScale, monster.scale.y * monsterScale);
        monster.position.set(
          (metrics.cellWidth - monster.width) / 2,
          (metrics.cellHeight - monster.height) / 2,
        );
        monsterCell.addChild(monster);
        monsters.addBoxChild(monsterCell, {
          contentSize: { w: metrics.cellWidth, h: metrics.cellHeight },
        });

        const max = Math.max(1, Math.trunc(entry.xpCostOfNextLevel));
        const bar = new ProgressBar({
          backgroundTexture: barBackTexture,
          foregroundTexture: barTexture,
          labelFontFile: null,
          max,
          barGrowSpeed: BAR_GROW_SPEED * 0.5,
        });
        bar.setTint(0xffff00);
        bar.setRatio(entry.beforeXp / max);
        const barScale = shrinkToFitScale(
          bar.contentWidth,
          bar.contentHeight,
          metrics.barMaxWidth,
          metrics.cellHeight,
        );
        bar.scale.set(barScale);
        const particles = new XpFullParticles(particleAsset, opts.particleRandom);
        particles.position.set(bar.contentWidth, bar.contentHeight / 2);
        bar.addChild(particles);
        const barCell = new Container();
        bar.position.y = (metrics.cellHeight - bar.contentHeight * barScale) / 2;
        barCell.addChild(bar);
        bars.addBoxChild(barCell, {
          contentSize: { w: bar.contentWidth * barScale, h: metrics.cellHeight },
        });
        display.bars.push({
          bar,
          targetRatio: Math.min(entry.afterXp, max) / max,
          particles,
        });
      }

      const pair = new Box({
        horizontal: true,
        positiveAlignDirection: true,
        gap: metrics.boxGap,
      });
      pair.addBoxChild(monsters, { contentSize: monsters.boxContentSize });
      pair.addBoxChild(bars, { contentSize: bars.boxContentSize });
      grid.addBoxChild(pair, { contentSize: pair.boxContentSize });
      columnFrames.push(pair);
    }

    // A negative-direction source Box still reports a positive contentSize to its parent. Pixi's
    // descendants occupy negative local x — exactly `contentSize` of it, ending at the origin —
    // so normalize that AUTHORED frame before the parent Box cross-centers it. With one
    // participant the columns are `[[entry], []]` and the empty one is only `Box.gap` wide, so
    // this rebase is the step that would expose any error in where `packBox` puts a
    // negative-direction child (it did, until 2026-09-06; boxLayout.ts header).
    // `getLocalBounds()` is deliberately forbidden here: it starts at the first
    // painted sprite pixel, not the monster cell edge, and the Fire Cub's ~30.5pt transparent/cell
    // padding would then translate every monster and XP bar that far left.
    const gridFrame = new Container();
    const gridBounds = grid.boxLayoutBounds;
    grid.position.set(-gridBounds.x, -gridBounds.y);
    gridFrame.addChild(grid);
    content.addBoxChild(gridFrame, { contentSize: grid.boxContentSize });
    gridFrame.x -= metrics.gridShiftX;
    // Authored column spans, for the debug snapshot's closure check (see XpAwardDisplayState.grid).
    const columnStarts = columnFrames.map((pair) => grid.position.x + pair.x);
    display.gridGeometry = {
      width: grid.boxContentSize.w,
      inkStart: Math.min(...columnStarts),
      inkEnd: Math.max(...columnStarts.map((start, i) => start + columnFrames[i]!.boxContentSize.w)),
    };
    return display;
  }

  /** The source schedules DelayTime(0.5) then setCurrent(min(afterXp, needed)). */
  update(dtMs: number): void {
    this.elapsedMs += dtMs;
    if (!this.targetStarted && this.elapsedMs >= 500) {
      this.targetStarted = true;
      for (const { bar, targetRatio } of this.bars) bar.setRatio(targetRatio);
    }
    for (const { bar, particles } of this.bars) {
      bar.update(dtMs);
      particles.update(dtMs, bar.displayedRatio >= 1);
    }
  }

  get debugState(): XpAwardDisplayState {
    return {
      amount: this.amount,
      columns: this.columns,
      rows: this.rows,
      elapsedMs: this.elapsedMs,
      targetStarted: this.targetStarted,
      entries: this.entries.map((entry) => ({ ...entry })),
      grid: { ...this.gridGeometry },
    };
  }
}
