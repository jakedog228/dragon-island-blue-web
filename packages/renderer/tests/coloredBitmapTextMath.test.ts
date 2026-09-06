import { describe, expect, it } from "vitest";
import {
  coloredBitmapTextColorAt,
  parseColoredBitmapText,
} from "../src/coloredBitmapTextMath.js";

describe("CCLabelColoredBMFont control codes", () => {
  it("removes source markup and records exact RGB glyph ranges before wrapping", () => {
    const parsed = parseColoredBitmapText(
      "Go ^#00FF00northwest^^, then use ^#ff0000ELEMENTS!^^",
    );

    expect(parsed).toEqual({
      text: "Go northwest, then use ELEMENTS!",
      spans: [
        { start: 3, length: 9, color: 0x00ff00 },
        { start: 23, length: 9, color: 0xff0000 },
      ],
    });
    expect(coloredBitmapTextColorAt(parsed, 2)).toBe(0xffffff);
    expect(coloredBitmapTextColorAt(parsed, 3)).toBe(0x00ff00);
    expect(coloredBitmapTextColorAt(parsed, 11)).toBe(0x00ff00);
    expect(coloredBitmapTextColorAt(parsed, 12)).toBe(0xffffff);
  });

  it("keeps a colored span active across a newline while removing both control tokens", () => {
    const parsed = parseColoredBitmapText("^#123AbCfirst\nsecond^^");
    expect(parsed.text).toBe("first\nsecond");
    expect(parsed.spans).toEqual([{ start: 0, length: 12, color: 0x123abc }]);
    expect(coloredBitmapTextColorAt(parsed, 6)).toBe(0x123abc);
  });

  it.each([
    ["bad color", "^#GG0000text^^", /invalid RGB/],
    ["short color", "^#00FFtext^^", /invalid RGB/],
    ["unterminated", "^#00FF00text", /unterminated/],
    ["unmatched close", "text^^", /unmatched closing/],
    ["nested", "^#00FF00one ^#FF0000two^^^^", /nested/],
  ])("fails loudly for malformed source markup: %s", (_label, source, expected) => {
    expect(() => parseColoredBitmapText(source)).toThrow(expected);
  });
});
