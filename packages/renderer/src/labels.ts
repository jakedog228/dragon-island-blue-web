import {
  BitmapText,
  Cache,
  Container,
  Rectangle,
  Text,
  getBitmapTextLayout,
  type BitmapFont,
} from "pixi.js";
import { CONTENT_SCALE_FACTOR } from "./scale9.js";
import { bitmapFontFile, bitmapFontCacheKey, bitmapFontPaddingFor } from "./bitmapFontFile.js";
import {
  joinWrappedBitmapLines,
  wrapBitmapCharacters,
  type BitmapWrapFont,
} from "./bitmapTextWrap.js";
import { currentTtfBakeResolution } from "./ttfTextResolution.js";
import {
  coloredBitmapTextColorAt,
  parseColoredBitmapText,
} from "./coloredBitmapTextMath.js";

export { bitmapFontFile, SHIPPED_BITMAP_FONT_SIZES } from "./bitmapFontFile.js";
export {
  coloredBitmapTextColorAt,
  parseColoredBitmapText,
  type ColoredBitmapTextSpan,
  type ParsedColoredBitmapText,
} from "./coloredBitmapTextMath.js";

export interface TtfLabelOptions {
  /** Pixi fill color/string; the original's CCLabelTTF defaults to opaque white. */
  fill?: number | string;














  outline?: boolean;




  outlineWidthPt?: number;










  outlineAlpha?: number;
  /** Texture sampling requested by source `setAliasTexParameters` calls. */
  textureScaleMode?: "nearest" | "linear";







  bold?: boolean;
  /** Wrap width in POINTS (the `CCLabelTTF labelWithString:dimensions:...` width constraint) —
   *  folded by CONTENT_SCALE_FACTOR like the font size. Omit for a single unwrapped line. */
  wordWrapWidth?: number;
  /** Multi-line alignment (the `CCLabelTTF ...alignment:` parameter; iOS UITextAlignment
   *  left=0/center=1/right=2). Only observable with `wordWrapWidth`. Default "left". */
  align?: "left" | "center" | "right";







  fontFamily?: string | string[];
}





































export function makeTtfLabel(str: string, sizePt: number, opts: TtfLabelOptions = {}): Text {
  const fill = opts.fill ?? 0xffffff;
  // Opt-in: a source CCLabelTTF is bare (see TtfLabelOptions.outline). Supplying an explicit
  // borderWidth or alpha IS the opt-in — silently discarding a width the caller spelled out would
  // trade over-outlining for the equally wrong under-outlining. `outline: false` still overrides.
  const outline = opts.outline
    ?? (opts.outlineWidthPt !== undefined || opts.outlineAlpha !== undefined);
  const outlineWidthPt = opts.outlineWidthPt ?? 2;
  const outlineAlpha = opts.outlineAlpha ?? 1;
  const bold = opts.bold ?? true; // app default font is "Arial-BoldMT" — see TtfLabelOptions.bold
  // null → Pixi auto-resolution (devicePixelRatio); modern mode pins a denser bake.
  const resolution = currentTtfBakeResolution();
  const text = new Text({
    text: str,
    ...(resolution !== null ? { resolution } : {}),
    ...(opts.textureScaleMode ? { textureStyle: { scaleMode: opts.textureScaleMode } } : {}),
    style: {
      fontFamily: opts.fontFamily ?? "Arial",
      fontWeight: bold ? "bold" : "normal",
      fontSize: sizePt * CONTENT_SCALE_FACTOR,
      fill,
      ...(outline
        ? {



            stroke: {
              color: outlineAlpha === 1 ? 0x000000 : `rgba(0,0,0,${outlineAlpha})`,
              // `* 2` converts the source's outward radius into a CENTRED canvas stroke; see the
              // function header. Do not "simplify" this back to a bare borderWidth.
              width: outlineWidthPt * 2 * CONTENT_SCALE_FACTOR,
              join: "round" as const,
            },
          }
        : {}),
      ...(opts.wordWrapWidth !== undefined
        ? { wordWrap: true, wordWrapWidth: opts.wordWrapWidth * CONTENT_SCALE_FACTOR }
        : {}),
      ...(opts.align !== undefined ? { align: opts.align } : {}),
    },
  });
  text.scale.set(1 / CONTENT_SCALE_FACTOR);
  return text;
}

/**
 * Measures the source `CCLabelTTF.contentSize` for a label that may be visibly outlined.
 *
 * Native `outline...BackgroundNode` attaches a separate child and therefore never changes the
 * label's own content size. Pixi folds its centred stroke into `Text` bounds. `Box` callers must
 * pass this bare, pre-transform size explicitly or the outline becomes layout padding. The result
 * intentionally remains in the label's local pre-scale coordinates; `Box` applies the label's
 * `1 / CONTENT_SCALE_FACTOR` transform exactly once when packing it.
 */
export function ttfLabelSourceContentSize(
  str: string,
  sizePt: number,
  opts: TtfLabelOptions = {},
): Readonly<{ w: number; h: number }> {
  const probe = makeTtfLabel(str, sizePt, { ...opts, outline: false });
  const bounds = probe.getLocalBounds();
  const size = Object.freeze({ w: bounds.width, h: bounds.height });
  probe.destroy();
  return size;
}

/**
 * Position delta that makes an OUTLINED `makeTtfLabel` land where the source's `CCLabelTTF`
 * `contentSize` box lands, for a given Pixi anchor.
 *
 * The header's "residual approximation" is not only a measuring problem — it displaces the drawn
 * glyphs too, and by default nothing corrects for it. Pixi pads the `Text` bounds by
 * `strokeWidth / 2` on every side (`CanvasTextMetrics._adjustWidthForStyle` adds a whole
 * `strokeWidth` to the line width, and the single-line height is
 * `fontProperties.fontSize + strokeWidth`), which `makeTtfLabel`'s `outlineWidthPt * 2` stroke
 * makes exactly `outlineWidthPt` points per side. `AbstractText`'s bounds then apply the anchor to
 * that PADDED box (`x1 = -width * anchor.x`), so the ink sits `outlineWidthPt` inside whichever
 * edge the anchor names. A Cocos label's outline is a separate child node at z -1, so its own
 * position and `contentSize` are untouched by it and the ink box IS the anchored box.
 *
 * With ink size `(W, H)`, pad `p`, anchor `(ax, ay)` and a desired source-anchored point `(X, Y)`:
 *
 * ```text
 * px - ax*(W + 2p) + p = X - ax*W   ->   px = X + p*(2*ax - 1)
 * ```
 *
 * so the correction depends only on `p` and the anchor, never on the string. It vanishes at
 * `0.5` — which is why centred labels (popup titles, menu items) never showed this, and why it
 * surfaces on edge-anchored groups like the tournament title corner.
 *
 * Returns zero for a bare label; pass the same `outlineWidthPt` the label was built with.
 */
export function ttfInkAnchorOffsetPt(
  outlineWidthPt: number,
  anchor: { readonly x: number; readonly y: number },
): { readonly dx: number; readonly dy: number } {
  return {
    dx: outlineWidthPt * (2 * anchor.x - 1),
    dy: outlineWidthPt * (2 * anchor.y - 1),
  };
}

/**
 * Places `label` so its INK box is anchored at `(x, y)` — i.e. exactly where a source
 * `CCLabelTTF` with the same anchor and position would put its `contentSize` box. See
 * `ttfInkAnchorOffsetPt`. `outlineWidthPt` must match the label's own; pass 0 for a bare label.
 */
export function placeTtfLabelInk(
  label: Text,
  x: number,
  y: number,
  outlineWidthPt: number,
): void {
  const offset = ttfInkAnchorOffsetPt(outlineWidthPt, label.anchor);
  label.position.set(x + offset.dx, y + offset.dy);
}

















export function makeBitmapLabel(
  str: string,
  size: number,
  bold: boolean,
  opts: {
    /** `CCLabelBMFont initWithString:fntFile:width:alignment:` wrap width in POINTS — folded by
     *  CONTENT_SCALE_FACTOR like the font size. Omit for a single unwrapped line. */
    wordWrapWidth?: number;
    /** Multi-line alignment (Cocos kCCTextAlignment left=0/center=1/right=2). Only observable
     *  with `wordWrapWidth`. Default "left" — CCLabelBMFont's own default. */
    align?: "left" | "center" | "right";
    /** Glyph tint. The source defaults to opaque white. */
    fill?: number;
  } = {},
): BitmapText {
  const fontFamily = `${bitmapFontFile(size, bold)}-hd`;
  const font = Cache.get<BitmapFont>(bitmapFontCacheKey(fontFamily));
  if (!font) {
    throw new Error(
      `makeBitmapLabel(${size}, ${bold}): font "${fontFamily}" is not loaded — await ` +
        `assets.font("${fontFamily}") before constructing this label`,
    );
  }







  const letterSpacing = bitmapFontPaddingFor(fontFamily).right;
  // Line breaking belongs to `BMFontStringFormatter`, not to the label: its scan overshoots by a
  // glyph and then backtracks, which Pixi's word-based wrapper does not reproduce. So pre-break
  // exactly as `wrapString:` does and hand the label a string that already carries its newlines,
  // mirroring the source's own `wrapString:` -> `setString:` split.
  const text = new BitmapText({
    text: opts.wordWrapWidth === undefined
      ? str
      : wrapBitmapText(str, opts.wordWrapWidth, fontFamily, font, opts.align ?? "left"),
    style: {
      fontFamily,
      fontSize: size * CONTENT_SCALE_FACTOR,
      letterSpacing,
      ...(opts.align !== undefined ? { align: opts.align } : {}),
      ...(opts.fill !== undefined ? { fill: opts.fill } : {}),
    },
  });











  text.pivot.y = font.baseLineOffset;
  text.scale.set(1 / CONTENT_SCALE_FACTOR);
  return text;
}

/**
 * `CCLabelColoredBMFont` equivalent used by every non-Japanese `ChainedTextLabel`.
 *
 * Pixi BitmapText has one tint per node, so this preserves Pixi's own BMFont wrap/kerning layout
 * and emits one child label for each contiguous same-color run on each laid-out line. Run origins
 * come from the full uncolored layout, which keeps a formatting boundary from changing wrapping
 * or horizontal placement.
 */
export function makeColoredBitmapLabel(
  source: string,
  size: number,
  bold: boolean,
  opts: {
    wordWrapWidth?: number;
    align?: "left" | "center" | "right";
  } = {},
): Container {
  const parsed = parseColoredBitmapText(source);
  const fontFamily = `${bitmapFontFile(size, bold)}-hd`;
  const font = Cache.get<BitmapFont>(bitmapFontCacheKey(fontFamily));
  if (!font) {
    throw new Error(
      `makeColoredBitmapLabel(${size}, ${bold}): font "${fontFamily}" is not loaded — await ` +
        `assets.font("${fontFamily}") before constructing this label`,
    );
  }



  const { wordWrapWidth, ...styleOpts } = opts;
  const measurement = makeBitmapLabel(parsed.text, size, bold, styleOpts);
  // `graphemes` keeps each entry's index into the ORIGINAL source so colour lookup stays anchored;
  // a break inserts a `\n` entry with no source index, which the run walker below skips exactly as
  // it already skips the authored newlines Pixi drops from `line.chars`.
  const graphemes = wordWrapWidth === undefined
    ? segmentGraphemes(parsed.text)
    : breakGraphemes(
        segmentGraphemes(parsed.text),
        wordWrapWidth,
        fontFamily,
        font,
        opts.align ?? "left",
      );
  const layout = getBitmapTextLayout(
    graphemes.map((entry) => entry.segment),
    measurement.style,
    font,
    true,
  );
  measurement.destroy();

  const root = new Container();
  root.label = "coloredBitmapText";
  const pointScale = layout.scale / CONTENT_SCALE_FACTOR;
  const lineHeightPt = font.lineHeight * pointScale;
  let sourceGrapheme = 0;

  for (let lineIndex = 0; lineIndex < layout.lines.length; lineIndex += 1) {
    const line = layout.lines[lineIndex]!;
    let runStart = 0;
    while (runStart < line.chars.length) {
      while (
        sourceGrapheme < graphemes.length &&
        (graphemes[sourceGrapheme]!.segment === "\r" || graphemes[sourceGrapheme]!.segment === "\n")
      ) {
        sourceGrapheme += 1;
      }
      const first = graphemes[sourceGrapheme];
      if (first === undefined) break;
      const color = coloredBitmapTextColorAt(parsed, first.index);
      let runEnd = runStart;
      let runText = "";
      while (runEnd < line.chars.length) {
        while (
          sourceGrapheme < graphemes.length &&
          (graphemes[sourceGrapheme]!.segment === "\r" || graphemes[sourceGrapheme]!.segment === "\n")
        ) {
          sourceGrapheme += 1;
        }
        const entry = graphemes[sourceGrapheme];
        if (entry === undefined) break;
        const entryColor = coloredBitmapTextColorAt(parsed, entry.index);
        if (runEnd > runStart && entryColor !== color) break;
        runText += line.chars[runEnd]!;
        runEnd += 1;
        sourceGrapheme += 1;
      }
      if (runEnd === runStart) break;

      // Pixi records every breaking-space entry in `line.charPositions` as zero because BitmapText
      // never draws a quad for it. That value is harmless to Pixi's own single-node pipe, but it
      // cannot be used as the origin of a split color run: a white run beginning with the space
      // after `^#00FF00northwest^^` would restart at x=0 and overlap the preceding sentence.
      // Spaces have no ink, so omit them from the child label and anchor the run at its first
      // drawable grapheme's position from the full, markup-free layout.
      let drawableStart = runStart;
      while (
        drawableStart < runEnd &&
        line.chars[drawableStart]!.trim().length === 0
      ) {
        drawableStart += 1;
      }
      if (drawableStart === runEnd) {
        runStart = runEnd;
        continue;
      }
      runText = line.chars.slice(drawableStart, runEnd).join("");

      const run = makeBitmapLabel(runText, size, bold, { fill: color });
      run.label = `coloredBitmapRun:${color.toString(16).padStart(6, "0")}`;
      run.position.set(
        (line.charPositions[drawableStart] ?? 0) * pointScale,
        lineIndex * lineHeightPt,
      );
      run.eventMode = "none";
      root.addChild(run);
      runStart = runEnd;
    }
  }

  root.boundsArea = new Rectangle(
    0,
    0,
    layout.width * pointScale,
    (layout.height + layout.offsetY) * pointScale,
  );
  return root;
}

/**
 * Adapts a loaded Pixi `BitmapFont` plus its descriptor's `padding` to the pure source scanner.
 * Pixi stores each pair's kerning on the SECOND character keyed by the first, which is the same
 * shape `+[BMFontStringFormatter kerningAmountForFirst:second:configuration:]` looks up.
 */
function wrapFontFor(family: string, font: BitmapFont): BitmapWrapFont {
  const padding = bitmapFontPaddingFor(family);
  return {
    xAdvance: (character) => font.chars[character]?.xAdvance ?? 0,
    kerning: (first, second) =>
      (first === undefined ? 0 : font.chars[second]?.kerning?.[first] ?? 0),
    paddingLeft: padding.left,
    paddingRight: padding.right,
  };
}

/** `wrapString:` over a whole string, for the plain (single-tint) label path. */
function wrapBitmapText(
  value: string,
  wordWrapWidthPt: number,
  family: string,
  font: BitmapFont,
  align: "left" | "center" | "right",
): string {
  const characters = segmentGraphemes(value).map((entry) => entry.segment);
  const lines = wrapBitmapCharacters(
    characters,
    wordWrapWidthPt * CONTENT_SCALE_FACTOR,
    wrapFontFor(family, font),
  );
  return joinWrappedBitmapLines(characters, lines, align !== "left").join("");
}

/** `wrapString:` over an already-segmented run, preserving each surviving grapheme's source index
 *  so `makeColoredBitmapLabel` can still resolve colours after the breaks are inserted. */
function breakGraphemes(
  graphemes: Array<{ readonly segment: string; readonly index: number }>,
  wordWrapWidthPt: number,
  family: string,
  font: BitmapFont,
  align: "left" | "center" | "right",
): Array<{ readonly segment: string; readonly index: number }> {
  const characters = graphemes.map((entry) => entry.segment);
  const lines = wrapBitmapCharacters(
    characters,
    wordWrapWidthPt * CONTENT_SCALE_FACTOR,
    wrapFontFor(family, font),
  );
  const out: Array<{ readonly segment: string; readonly index: number }> = [];
  let consumed = 0;
  for (const line of lines) {
    let end = line.end;
    if (align !== "left") {
      while (end > line.start && /^\s$/.test(characters[end - 1]!)) end -= 1;
    }
    // Inserted breaks carry index -1; they are skipped before any colour lookup reads an index.
    if (out.length > 0 && characters[line.start] !== "\n") out.push({ segment: "\n", index: -1 });
    for (let i = line.start; i < end; i += 1) out.push(graphemes[i]!);
    consumed = Math.max(consumed, end);
  }
  if (consumed < graphemes.length && align === "left") {
    throw new Error("makeColoredBitmapLabel: wrap dropped trailing graphemes");
  }
  return out;
}

function segmentGraphemes(value: string): Array<{ readonly segment: string; readonly index: number }> {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)]
      .map(({ segment, index }) => ({ segment, index }));
  }
  const result: Array<{ segment: string; index: number }> = [];
  let index = 0;
  for (const segment of value) {
    result.push({ segment, index });
    index += segment.length;
  }
  return result;
}
