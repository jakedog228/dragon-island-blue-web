















const SHIPPED_BITMAP_FONTS = new Set(["arial_14", "arial_14_bold", "arial_18_bold", "arial_20_bold"]);

/**
 * The four (size, bold) pairs backing `SHIPPED_BITMAP_FONTS` above, for callers that need to preload
 * every bitmap font up front (e.g. `apps/web/src/main.ts`, which no longer gets away with loading
 * just one -- see `AssetLibrary.font()`'s per-alias registration).
 */
export const SHIPPED_BITMAP_FONT_SIZES: ReadonlyArray<readonly [size: number, bold: boolean]> = [
  [14, false],
  [14, true],
  [18, true],
  [20, true],
];







export const BMFONT_SHARED_FACE = "Arial Narrow";

/**
 * Rewrites the single `face="..."` attribute on a text BMFont descriptor's single `info` line to
 * `face="<family>"`, so PixiJS's face-name-keyed `BitmapFontManager` cache sees manifest asset
 * identities rather than author-selected font-family names. This supports both the original files
 * and independently authored fonts without granting either format preference.
 *
 * Throws (fail-loud) for a missing/duplicate info line, a missing/duplicate face attribute, or a
 * family that cannot be represented safely in the quoted BMFont field. These checks keep a
 * malformed descriptor from being partially or ambiguously patched.
 */
export function patchFntFaceName(fntText: string, family: string, source?: string): string {
  const location = source ? ` in ${source}` : "";
  if (/["><\r\n]/.test(family)) {
    throw new Error(
      `patchFntFaceName(${JSON.stringify(family)}${source ? `, ${source}` : ""}): ` +
        "family contains a character that is unsafe in a quoted BMFont face attribute",
    );
  }

  const infoLines = fntText.split(/\r?\n/).filter((line) => /^info(?:\s|$)/.test(line));
  if (infoLines.length !== 1) {
    throw new Error(`bitmap font${location} must contain exactly one info line; found ${infoLines.length}`);
  }
  const infoLine = infoLines[0]!;
  const faceAttributes = [...infoLine.matchAll(/(?:^|\s)face="[^"]*"/g)];
  if (faceAttributes.length !== 1) {
    throw new Error(
      `bitmap font${location} info line must contain exactly one quoted face attribute; found ${faceAttributes.length}`,
    );
  }
  const patchedInfo = infoLine.replace(/(^|\s)face="[^"]*"/, `$1face="${family}"`);
  return fntText.replace(infoLine, patchedInfo);
}


export interface BitmapFontPadding {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}














export function parseBitmapFontPadding(fntText: string, source?: string): BitmapFontPadding {
  const location = source ? ` in ${source}` : "";
  const infoLines = fntText.split(/\r?\n/).filter((line) => /^info(?:\s|$)/.test(line));
  if (infoLines.length !== 1) {
    throw new Error(`bitmap font${location} must contain exactly one info line; found ${infoLines.length}`);
  }
  const match = /(?:^|\s)padding=(-?\d+),(-?\d+),(-?\d+),(-?\d+)/.exec(infoLines[0]!);
  if (match === null) {
    // The original degrades rather than failing: its fixed `nextObject` walk lands on some other
    // token and `intValue` returns 0 for anything non-numeric. A descriptor without padding
    // therefore wraps on bare `xAdvance + kerning`, which is what a zero padding reproduces. The
    // shipped faces all declare `padding=1,1,1,1` and are pinned by `bitmapTextWrap.test.ts`.
    void location;
    return Object.freeze({ left: 0, top: 0, right: 0, bottom: 0 });
  }
  const [, top, right, bottom, left] = match;
  return Object.freeze({
    top: Number(top),
    right: Number(right),
    bottom: Number(bottom),
    left: Number(left),
  });
}

/** Pixi's `BitmapFont` discards the descriptor's `padding`, so the loader stashes it here under the
 *  same asset key `makeBitmapLabel` resolves its `fontFamily` through. */
const bitmapFontPaddings = new Map<string, BitmapFontPadding>();

export function registerBitmapFontPadding(family: string, padding: BitmapFontPadding): void {
  bitmapFontPaddings.set(family, padding);
}

/** Fail-loud: `padding_.right` is a term in EVERY bitmap glyph advance (both shipped
 *  `createFontChars` paths) as well as in the break scan, so a label whose padding never registered
 *  would silently render narrow and break late — precisely the defect this table exists to close. */
export function bitmapFontPaddingFor(family: string): BitmapFontPadding {
  const padding = bitmapFontPaddings.get(family);
  if (padding === undefined) {
    throw new Error(
      `bitmap font "${family}" has no registered padding — every glyph advance needs it; ` +
        "load the font through AssetLibrary.font() or call registerBitmapFontPadding()",
    );
  }
  return padding;
}

/**
 * The global-`Cache` key PixiJS's `BitmapFontManager.getFont` looks up for a given
 * `style.fontFamily` (pixi.js 8.19.0, lib/scene/text-bitmap/BitmapFontManager.js:
 * `` `${style.fontFamily}-bitmap` ``). `AssetLibrary.font()` registers each loaded font under this
 * key so that `makeBitmapLabel`'s `fontFamily = <asset key>` resolves.
 */
export function bitmapFontCacheKey(family: string): string {
  return `${family}-bitmap`;
}

/**
 * Resolves the (size, bold) pair to its .fnt asset key, e.g. `bitmapFontFile(20, true)` ->
 * `"arial_20_bold"`. This is the base name as the original names it (pre "-hd"); this port ships
 * only the retina tier (`scale9.ts` `CONTENT_SCALE_FACTOR`), so callers that need the actual
 * manifest/cache key append "-hd" themselves (see `labels.ts`'s `makeBitmapLabel` and
 * `AssetLibrary.font()`).
 */
export function bitmapFontFile(size: number, bold: boolean): string {
  const key = `arial_${size}${bold ? "_bold" : ""}`;
  if (!SHIPPED_BITMAP_FONTS.has(key)) {
    throw new Error(
      `bitmapFontFile(${size}, ${bold}): no shipped .fnt for "${key}.fnt" -- the bundle ships only ` +
        `arial_14, arial_14_bold, arial_18_bold, arial_20_bold`,
    );
  }
  return key;
}
