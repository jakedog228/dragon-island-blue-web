import { BitmapText } from "pixi.js";
import { BMFONT_SHARED_FACE } from "./bitmapFontFile.js";


export const BITMAP_FONT_FAMILY = BMFONT_SHARED_FACE;
export const BITMAP_FONT_ASSET = "arial_20_bold-hd";

export function makeText(text: string, fontSize: number, tint = 0xffffff): BitmapText {
  const t = new BitmapText({ text, style: { fontFamily: BITMAP_FONT_FAMILY, fontSize } });
  t.tint = tint;
  return t;
}
