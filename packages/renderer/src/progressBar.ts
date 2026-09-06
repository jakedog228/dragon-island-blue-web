import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import { BAR_GROW_SPEED, cropTextureRect, easeBarStep, formatBarFraction, type PixelRect } from "./barMath.js";
import { pointSprite } from "./pointSprite.js";

export interface ProgressBarBarOffset {
  x: number;
  y: number;
}

export interface ProgressBarOpts {
  /** `+[ProgressBar spriteWithSpriteFrameName:]` (team-displays.md §5): the `ProgressBar` node
   *  itself carries the *background* frame (it's a `CCSprite` subclass). Never cropped. */
  backgroundTexture: Texture;





  foregroundTexture: Texture;
  /** Position of the foreground sprite relative to the background's origin, in POINTS
   *  (the widget kit's layout unit — see the unit note on the class doc). Default (0,0). */
  barOffset?: ProgressBarBarOffset;
  /** `setupBarWithForegroundSpriteFrameName:labelFontFile:barOffset:`: non-null -> the bar owns a
   *  `"%d/%d"` `CCLabelBMFont` (e.g. `arial_14.fnt` for friendly cards, followup-consts.md §3);
   *  null -> no label (the enemy-bar case, which shows its own separate name label instead). This
   *  is a marker only — `makeLabel` is what actually builds/rebuilds the label node, since Task 5
   *  (bitmap font resolver) hasn't landed yet; this keeps `ProgressBar` decoupled from font-file ->
   *  `BitmapText` plumbing so Task 10 can inject the real thing without changing this class. */
  labelFontFile: string | null;




  makeLabel?: (text: string) => Container;
  /** `-[ProgressBar init]`: `max` default 100.0. */
  max?: number;
  /** `-[ProgressBar init]`: `horizontal` default true (monster HP bars never set this false). */
  horizontal?: boolean;
  /** `-[ProgressBar init]`: `textureRevalBackwards` default false (never set by either HP bar). */
  textureRevalBackwards?: boolean;
  /** Per-scheduled-update ease step. `-[ProgressBar init]` defaults to 0.025; the battle award
   * popup explicitly reads that value and writes back half (0.0125) before animating XP. */
  barGrowSpeed?: number;
}























export class ProgressBar extends Container {
  private readonly background: Sprite;
  private readonly foreground: Sprite;
  private readonly foregroundInset: { x: number; y: number };
  private readonly fullForegroundRect: PixelRect;
  private readonly horizontal: boolean;
  private readonly backwards: boolean;
  private readonly barOffset: ProgressBarBarOffset;
  private readonly makeLabel: ((text: string) => Container) | undefined;
  private readonly barGrowSpeed: number;

  // Named `labelNode` (not `label`) to avoid colliding with PixiJS's own `Container.label` string
  // property (the debug/display-name field), which TypeScript won't let us shadow.
  private labelNode: Container | null = null;
  private max: number;
  private targetRatio = 0;
  private currentPercent = 0;





  private first = true;

  constructor(opts: ProgressBarOpts) {
    super();

    if (opts.foregroundTexture.rotate !== 0) {
      throw new Error("ProgressBar: rotated foreground atlas frame is not supported");
    }

    this.horizontal = opts.horizontal ?? true;
    this.backwards = opts.textureRevalBackwards ?? false;
    this.max = opts.max ?? 100;
    this.barOffset = opts.barOffset ?? { x: 0, y: 0 };
    this.makeLabel = opts.makeLabel;
    this.barGrowSpeed = opts.barGrowSpeed ?? BAR_GROW_SPEED;











    this.foreground = pointSprite(opts.foregroundTexture);
    const f = opts.foregroundTexture.frame;
    this.fullForegroundRect = { x: f.x, y: f.y, w: f.width, h: f.height };
    this.addChild(this.foreground); // added first -> renders below the backing

    this.background = pointSprite(opts.backgroundTexture);
    this.addChild(this.background);

    this.foregroundInset = {
      x: (this.background.width - this.foreground.width) / 2,
      y: (this.background.height - this.foreground.height) / 2,
    };
    this.foreground.position.set(this.foregroundInset.x + this.barOffset.x, this.foregroundInset.y + this.barOffset.y);

    if (opts.labelFontFile != null) {
      if (!this.makeLabel) {
        throw new Error("ProgressBar: labelFontFile given but no makeLabel factory provided");
      }
      this.labelNode = this.makeLabel(this.formatLabel());
      this.addChild(this.labelNode);
      this.placeLabel();
    }

    this.applyCrop();
  }

  /** Cocos `contentSize` belongs to the ProgressBar's background sprite; labels are children and
   * do not enlarge it. Parent layout must use these values instead of Pixi union bounds. */
  get contentWidth(): number {
    return this.background.width;
  }

  get contentHeight(): number {
    return this.background.height;
  }

  /** Current eased fill, used by the source's particlesWhenFull presentation adapter. */
  get displayedRatio(): number {
    return this.currentPercent;
  }

  /** The un-eased target `setRatio` last received. Read by deterministic traces/tests that need
   *  the value a caller committed, independent of how far `update()` has eased toward it. */
  get ratio(): number {
    return this.targetRatio;
  }

  /** Target fill fraction (0..1) that `update()` eases `currentPercent` toward. */
  setRatio(r: number): void {
    this.targetRatio = r;
  }

  /** Label denominator (also feeds the eased-numerator recompute on the next `update()`).
   *  Refreshes the label immediately so the denominator is never stale while the eased percent
   *  happens to be at rest (no pending `update()` step to trigger the rebuild). */
  setMax(max: number): void {
    this.max = max;
    if (this.labelNode) this.refreshLabel();
  }

  /** `[[hpBar foregroundBar] setColor:]` (followup-consts.md §1) — tints the foreground sprite. */
  setTint(color: number): void {
    this.foreground.tint = color;
  }





  update(_dt: number): void {
    if (this.first) {
      this.snapToTarget();
      return;
    }
    const next = easeBarStep(this.currentPercent, this.targetRatio, this.barGrowSpeed);
    if (next === this.currentPercent) return;
    this.currentPercent = next;
    this.applyCrop();
    if (this.labelNode) this.refreshLabel();
  }






  snapToTarget(): void {
    this.first = false;
    if (this.currentPercent === this.targetRatio) return;
    this.currentPercent = this.targetRatio;
    this.applyCrop();
    if (this.labelNode) this.refreshLabel();
  }

  private applyCrop(): void {
    const cropped = cropTextureRect(this.fullForegroundRect, this.currentPercent, this.horizontal, this.backwards);
    const base = this.foreground.texture;
    this.foreground.texture = new Texture({
      source: base.source,
      frame: new Rectangle(cropped.x, cropped.y, cropped.w, cropped.h),
    });
  }

  private formatLabel(): string {
    // team-displays.md §5 -- see barMath.ts's formatBarFraction for the full citation.
    return formatBarFraction(this.currentPercent, this.max);
  }

  private refreshLabel(): void {
    if (!this.makeLabel || !this.labelNode) return;
    this.removeChild(this.labelNode);
    // Destroy the old node, not just detach it — a full 0->1 bar transition rebuilds ~40 labels,
    // which would otherwise accumulate as leaked Containers.
    this.labelNode.destroy({ children: true });
    this.labelNode = this.makeLabel(this.formatLabel());
    this.addChild(this.labelNode);
    this.placeLabel();
  }













  private placeLabel(): void {
    if (!this.labelNode) return;
    const bounds = this.labelNode.getLocalBounds();
    this.labelNode.position.set(
      this.background.width / 2 - (bounds.x + bounds.width / 2) * this.labelNode.scale.x,
      this.background.height / 2 - (bounds.y + bounds.height / 2) * this.labelNode.scale.y,
    );
  }
}
