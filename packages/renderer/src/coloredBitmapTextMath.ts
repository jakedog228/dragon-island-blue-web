export interface ColoredBitmapTextSpan {
  /** UTF-16 offset in the markup-free string. */
  readonly start: number;
  /** UTF-16 length in the markup-free string. */
  readonly length: number;
  /** Exact RGB value encoded by the source `#RRGGBB` token. */
  readonly color: number;
}

export interface ParsedColoredBitmapText {
  readonly text: string;
  readonly spans: readonly ColoredBitmapTextSpan[];
}

/**
 * Parses `CCLabelColoredBMFont`'s shipped inline grammar:
 *
 *     ^#RRGGBBcolored text^^
 *
 * The source removes the control bytes before BMFont wrapping, then applies the RGB value to the
 * enclosed glyph range. Keeping this parser in the renderer makes every ChainedTextLabel consumer
 * share one implementation instead of interpreting localization markup ad hoc.
 */
export function parseColoredBitmapText(value: string): ParsedColoredBitmapText {
  let cursor = 0;
  let plain = "";
  const spans: ColoredBitmapTextSpan[] = [];

  while (cursor < value.length) {
    const open = value.indexOf("^#", cursor);
    if (open < 0) {
      const unmatchedClose = value.indexOf("^^", cursor);
      if (unmatchedClose >= 0) {
        throw new Error(`colored bitmap text has an unmatched closing token at ${unmatchedClose}`);
      }
      plain += value.slice(cursor);
      break;
    }

    const unmatchedClose = value.indexOf("^^", cursor);
    if (unmatchedClose >= 0 && unmatchedClose < open) {
      throw new Error(`colored bitmap text has an unmatched closing token at ${unmatchedClose}`);
    }
    plain += value.slice(cursor, open);

    const colorToken = value.slice(open + 2, open + 8);
    if (!/^[0-9a-fA-F]{6}$/.test(colorToken)) {
      throw new Error(`colored bitmap text has an invalid RGB token at ${open}`);
    }
    const contentStart = open + 8;
    const close = value.indexOf("^^", contentStart);
    if (close < 0) {
      throw new Error(`colored bitmap text has an unterminated span at ${open}`);
    }
    const nested = value.indexOf("^#", contentStart);
    if (nested >= 0 && nested < close) {
      throw new Error(`colored bitmap text does not support nested spans (at ${nested})`);
    }

    const content = value.slice(contentStart, close);
    const start = plain.length;
    plain += content;
    spans.push(Object.freeze({
      start,
      length: content.length,
      color: Number.parseInt(colorToken, 16),
    }));
    cursor = close + 2;
  }

  return Object.freeze({
    text: plain,
    spans: Object.freeze(spans),
  });
}

export function coloredBitmapTextColorAt(
  parsed: ParsedColoredBitmapText,
  utf16Offset: number,
): number {
  for (const span of parsed.spans) {
    if (utf16Offset >= span.start && utf16Offset < span.start + span.length) return span.color;
  }
  return 0xffffff;
}
