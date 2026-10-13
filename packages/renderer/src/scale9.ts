import { setOwnedTexture } from "./ownedTexture.js";
import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { AssetLibrary } from "./assetLibrary.js";
import {
  cutScale9,
  layoutScale9,
  parseScale9Rect,
  resolveScale9Size,
  SCALE9_PATCH_ORDER,
  type Rect,
  type Size,
} from "./scale9Math.js";










export const CONTENT_SCALE_FACTOR = 2;

export interface Scale9ConfigEntry {



  contentRect: string;
  /** Base (non-"-hd") image name as it appears in Scale9Sprites.json, e.g. "PopupBackgroundThin.png". */
  image: string;
}

export type Scale9SpritesData = Record<string, Scale9ConfigEntry>;











export class Scale9 extends Container {
  private readonly cutRects: Rect[]; // bottom-left/Y-up, POINT space (scale9Math frame)
  private readonly patchPasses: Sprite[][];
  private currentSize: Size; // points

  private constructor(baseTexture: Texture, cutRects: Rect[], initialSize: Size) {
    super();
    this.cutRects = cutRects;
    this.currentSize = { w: initialSize.w, h: initialSize.h };

    // Build the 9 sub-textures once. The cut rects are in points (bottom-left/Y-up); PixiJS texture
    // frames address the hd PNG's raw pixel grid (top-left/Y-down), so scale by CSF and flip:
    // pixelY = texPixelH - (y + h)*CSF.
    const texPixelH = baseTexture.height;
    const buildPass = () => cutRects.map((r) => {
      const frame = new Rectangle(
        r.x * CONTENT_SCALE_FACTOR,
        texPixelH - (r.y + r.h) * CONTENT_SCALE_FACTOR,
        r.w * CONTENT_SCALE_FACTOR,
        r.h * CONTENT_SCALE_FACTOR,
      );
      const tex = new Texture({ source: baseTexture.source, frame });
      const sprite = new Sprite(tex);
      setOwnedTexture(sprite, tex);
      sprite.anchor.set(0, 0);
      this.addChild(sprite);
      return sprite;
    });



    this.patchPasses = [buildPass(), buildPass()];

    this.applyLayout();
  }























  static async fromConfig(
    configs: Scale9SpritesData,
    name: string,
    assets: AssetLibrary,
    contentDimensions: Size = { w: 0, h: 0 },
  ): Promise<Scale9> {
    const cfg = configs[name];
    if (!cfg) throw new Error(`unknown Scale9Sprites config: ${name}`);

    const centerRegion = parseScale9Rect(cfg.contentRect);
    const spriteKey = `${cfg.image.replace(/\.png$/i, "")}-hd`;
    if (!assets.hasSprite(spriteKey)) {
      throw new Error(`Scale9 config "${name}": no sprite "${spriteKey}" (from image "${cfg.image}")`);
    }
    const texture = await assets.sprite(spriteKey);

    // CCTexture2D contentSize = pixels / CSF (points) — followup-consts.md §6.
    const pointW = texture.width / CONTENT_SCALE_FACTOR;
    const pointH = texture.height / CONTENT_SCALE_FACTOR;
    const cutRects = cutScale9(pointW, pointH, centerRegion);
    const size = resolveScale9Size(centerRegion, contentDimensions);
    const s9 = new Scale9(texture, cutRects, size);
    return s9;
  }


  setContentSize(w: number, h: number): void {
    this.currentSize = { w, h };
    this.applyLayout();
  }

  /** Point-space content width (mirrors the original's contentSize.width). */
  get contentWidth(): number {
    return this.currentSize.w;
  }

  /** Point-space content height (mirrors the original's contentSize.height). */
  get contentHeight(): number {
    return this.currentSize.h;
  }

  private applyLayout(): void {
    const layout = layoutScale9(this.cutRects, this.currentSize);
    SCALE9_PATCH_ORDER.forEach((_name, i) => {
      const sprite = this.patchPasses[0]![i]!;
      const rect = this.cutRects[i]!;
      const { pos, scale } = layout[i]!;
      // Texture frames are CSF x the point cut, so fold a base 1/CSF into the sprite scale to
      // render each patch at (pointSize x layoutScale) — container space stays points.
      sprite.scale.set(scale.x / CONTENT_SCALE_FACTOR, scale.y / CONTENT_SCALE_FACTOR);
      // Flip the bottom-left/Y-up layout position into PixiJS's top-left/Y-down Container space:
      // the patch's displayed top edge is (contentSize.h - pos.y - scaledPointHeight) from the top.
      const scaledH = rect.h * scale.y;
      sprite.position.set(pos.x, this.currentSize.h - pos.y - scaledH);
    });
    SCALE9_PATCH_ORDER.forEach((_name, i) => {
      const first = this.patchPasses[0]![i]!;
      const second = this.patchPasses[1]![i]!;
      second.position.copyFrom(first.position);
      second.scale.copyFrom(first.scale);
    });
  }
}
