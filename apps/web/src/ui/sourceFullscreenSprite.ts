import { setOwnedTexture } from "@dib/renderer";
import { pointSprite } from "@dib/renderer";
import { Rectangle, Texture, type Sprite } from "pixi.js";
import type { DisplayMode } from "../displayMode.js";
import {
  SOURCE_FULLSCREEN_TEXTURE_RECT_PX,
  sourceFullscreenPosition,
} from "./sourceFullscreenMath.js";


export function sourceFullscreenSprite(
  full: Texture,
  mode: DisplayMode,
  assetName: string,
): Sprite {
  const rect = SOURCE_FULLSCREEN_TEXTURE_RECT_PX;
  if (full.width < rect.w || full.height < rect.h) {
    throw new Error(
      `${assetName} is ${full.width}x${full.height}; source full-screen crop requires ` +
        `${rect.w}x${rect.h}`,
    );
  }
  const sprite = pointSprite(new Texture({
    source: full.source,
    frame: new Rectangle(rect.x, rect.y, rect.w, rect.h),
  }));
  setOwnedTexture(sprite, sprite.texture);
  sprite.label = `sourceFullscreen:${assetName}`;
  const position = sourceFullscreenPosition(mode);
  sprite.position.set(position.x, position.y);
  return sprite;
}
