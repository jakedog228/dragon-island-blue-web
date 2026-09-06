import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  joinWrappedBitmapLines,
  wrapBitmapCharacters,
  type BitmapWrapFont,
} from "../src/bitmapTextWrap.js";
import { parseBitmapFontPadding } from "../src/bitmapFontFile.js";





const FONT_DIR = resolve(import.meta.dirname, "../../../Payload/DragonIsland.app");
const FNT = resolve(FONT_DIR, "arial_18_bold-hd.fnt");

/** Minimal .fnt reader — deliberately independent of Pixi's parser so the pin measures the shipped
 *  descriptor, not our loader. */
function shippedFont(paddingOverride?: { left: number; right: number }): BitmapWrapFont {
  const text = readFileSync(FNT, "utf8");
  const advances = new Map<string, number>();
  const kernings = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const fields = Object.fromEntries(
      [...line.matchAll(/(\w+)=(-?\d+)/g)].map(([, k, v]) => [k, Number(v)]),
    );
    if (line.startsWith("char ")) {
      advances.set(String.fromCodePoint(fields["id"]!), fields["xadvance"]!);
    } else if (line.startsWith("kerning ")) {
      const first = String.fromCodePoint(fields["first"]!);
      const second = String.fromCodePoint(fields["second"]!);
      kernings.set(`${first}\u0000${second}`, fields["amount"]!);
    }
  }
  const padding = parseBitmapFontPadding(text, FNT);
  return {
    xAdvance: (character) => advances.get(character) ?? 0,
    kerning: (first, second) =>
      first === undefined ? 0 : kernings.get(`${first}\u0000${second}`) ?? 0,
    paddingLeft: paddingOverride?.left ?? padding.left,
    paddingRight: paddingOverride?.right ?? padding.right,
  };
}

function wrapped(value: string, limit: number, font: BitmapWrapFont, align = "left"): string[] {
  const characters = [...value];
  const lines = wrapBitmapCharacters(characters, limit, font);
  return joinWrappedBitmapLines(characters, lines, align !== "left").join("").split("\n");
}

const OLD_SAGE =
  'Old Sage:\n"Welcome to my humble abode. Though I look simple, I hold the key to great power. ' +
  'Prove your mastery over monsters and I will reward you."';

describe("shipped .fnt padding", () => {
  it("every shipped face declares padding=1,1,1,1, so the wrap measures +1 unit per character", () => {
    for (const face of ["arial_14", "arial_14_bold", "arial_18_bold", "arial_20_bold"]) {
      for (const tier of ["", "-hd"]) {
        const path = resolve(FONT_DIR, `${face}${tier}.fnt`);
        expect(parseBitmapFontPadding(readFileSync(path, "utf8"), path))
          .toEqual({ left: 1, top: 1, right: 1, bottom: 1 });
      }
    }
  });

  it("reads BMFont's top,right,bottom,left order", () => {
    const info = 'info face="F" size=36 bold=1 padding=2,3,4,5 spacing=1,1\ncommon lineHeight=36\n';
    expect(parseBitmapFontPadding(info)).toEqual({ top: 2, right: 3, bottom: 4, left: 5 });
  });

  // The original's fixed `nextObject` walk plus `intValue` yields 0 for a descriptor that omits
  // padding, so an authored font without it wraps on bare `xAdvance + kerning` rather than failing.
  it("degrades a padding-less descriptor to zero, and still rejects a malformed info block", () => {
    expect(parseBitmapFontPadding('info face="F" size=36\ncommon lineHeight=36\n'))
      .toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(() => parseBitmapFontPadding("common lineHeight=36\n")).toThrow(/exactly one info line/);
  });
});

describe("wrapBitmapCharacters", () => {


  it("breaks the Old Sage line onto three body lines at the iPhone 880 px limit", () => {
    expect(wrapped(OLD_SAGE, 880, shippedFont())).toEqual([
      "Old Sage:",
      '"Welcome to my humble abode. Though I look simple, I hold the ',
      "key to great power. Prove your mastery over monsters and I will ",
      'reward you."',
    ]);
  });

  it("breaks it onto two body lines at the iPad 942 px limit", () => {
    expect(wrapped(OLD_SAGE, 942, shippedFont())).toEqual([
      "Old Sage:",
      '"Welcome to my humble abode. Though I look simple, I hold the key to ',
      'great power. Prove your mastery over monsters and I will reward you."',
    ]);
  });



  it("without the padding term the iPhone limit reproduces the source's iPad layout", () => {
    const unpadded = shippedFont({ left: 0, right: 0 });
    expect(wrapped(OLD_SAGE, 880, unpadded)).toEqual(wrapped(OLD_SAGE, 942, shippedFont()));
  });

  it("keeps the breaking space on a left-aligned line and trims it for centre/right", () => {
    const font = shippedFont();
    expect(wrapped(OLD_SAGE, 880, font)[1]!.endsWith(" ")).toBe(true);
    expect(wrapped(OLD_SAGE, 880, font, "center")[1]!.endsWith(" ")).toBe(false);
  });

  it("emits exactly one newline for an authored hard break, never two", () => {
    expect(wrapped("a\nb", 10_000, shippedFont())).toEqual(["a", "b"]);
  });

  it("hard-breaks mid-token when a line holds no space to retreat to", () => {
    // 'M' is the widest glyph; a 200 px limit cannot fit the run, so the scan finds no space and
    // cuts at the overflowing character instead of looping.
    const lines = wrapped("MMMMMMMMMMMMMMMM", 200, shippedFont());
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("")).toBe("MMMMMMMMMMMMMMMM");
  });

  it("measures code points at or above 0x800 as '?' without altering the emitted text", () => {
    const font = shippedFont();
    const exotic = "\u4e00\u4e00\u4e00";
    const questions = "???";
    expect(wrapBitmapCharacters([...exotic], 60, font))
      .toEqual(wrapBitmapCharacters([...questions], 60, font));
    expect(wrapped(exotic, 10_000, font)).toEqual([exotic]);
  });

  it("returns one empty line for empty input and rejects a non-finite limit", () => {
    expect(wrapBitmapCharacters([], 880, shippedFont())).toEqual([{ start: 0, end: 0 }]);
    expect(() => wrapBitmapCharacters(["a"], Number.NaN, shippedFont())).toThrow(/invalid limit/);
  });
});
