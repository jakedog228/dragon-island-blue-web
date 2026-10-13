import { Container } from "pixi.js";
import { parseScale9Rect, type AssetLibrary, type Scale9SpritesData } from "@dib/renderer";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import { screenPointsForMode, type DisplayMode } from "../displayMode.js";

/** PvP is a port extension. Its responsive sizes are winSize-relative; artwork and nine-slice
 * cuts come from the same package/configuration as Tournament and the shared popup kit. */
export function pvpCssSlices(rect: { x: number; y: number; w: number; h: number }, width: number, height: number) {
  // Config is Cocos points, bottom-left; CSS slices are image pixels, top/right/bottom/left.
  return [height - (rect.y + rect.h) * 2, width - (rect.x + rect.w) * 2, rect.y * 2, rect.x * 2];
}

export function pvpViewportUnit(mode: DisplayMode): string {
  const screen = screenPointsForMode(mode);
  return `min(${100 / screen.w}vw, ${100 / screen.h}dvh)`;
}

export async function preparePvpAppearance(assets: AssetLibrary, scale9: Scale9SpritesData, mode: DisplayMode, dialog: HTMLElement): Promise<Container> {
  dialog.style.setProperty("--pvp-unit", pvpViewportUnit(mode));
  for (const [property, key] of [["panel", "PopupBackgroundThin"], ["button", "MenuButton2"]] as const) {
    const config = scale9[key];
    if (!config) throw new Error(`PvP requires Scale9 ${key}`);
    const name = `${config.image.replace(/\.png$/i, "")}-hd`;
    const texture = await assets.sprite(name);
    dialog.style.setProperty(`--pvp-${property}-image`, `url("${assets.spriteUrl(name)}")`);
    dialog.style.setProperty(`--pvp-${property}-slice`, pvpCssSlices(parseScale9Rect(config.contentRect), texture.width, texture.height).join(" "));
  }
  const root = new Container(); root.label = "pvp:tournament-background";
  root.addChild(sourceFullscreenSprite(await assets.sprite("saveSlotBackground"), mode, "saveSlotBackground"));
  root.eventMode = "none";
  return root;
}
