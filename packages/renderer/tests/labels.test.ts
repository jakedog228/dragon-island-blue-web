import { describe, it, expect } from "vitest";


import { BMFONT_SHARED_FACE, bitmapFontCacheKey, bitmapFontFile, patchFntFaceName } from "../src/bitmapFontFile.js";


describe("bitmapFontFile", () => {
  it("14pt regular -> arial_14", () => {
    expect(bitmapFontFile(14, false)).toBe("arial_14");
  });

  it("14pt bold -> arial_14_bold", () => {
    expect(bitmapFontFile(14, true)).toBe("arial_14_bold");
  });

  it("18pt bold -> arial_18_bold", () => {
    expect(bitmapFontFile(18, true)).toBe("arial_18_bold");
  });

  it("20pt bold -> arial_20_bold", () => {
    expect(bitmapFontFile(20, true)).toBe("arial_20_bold");
  });

  it("throws on an unshipped size (18pt regular has no .fnt in the bundle)", () => {
    expect(() => bitmapFontFile(18, false)).toThrow();
  });

  it("throws on an unshipped size (20pt regular has no .fnt in the bundle)", () => {
    expect(() => bitmapFontFile(20, false)).toThrow();
  });

  it("throws on a size the bundle never ships at all (16, bold or not)", () => {
    expect(() => bitmapFontFile(16, true)).toThrow();
    expect(() => bitmapFontFile(16, false)).toThrow();
  });
});

// The original four .fnt files declare the same face="Arial Narrow" (a raw-data collision), while
// clean packages can declare an independently authored family. AssetLibrary.font() patches either
// form to its asset key so PixiJS's face-keyed cache can hold every manifest font independently.
describe("patchFntFaceName", () => {
  const fntFixture =
    'info face="Arial Narrow" size=40 bold=1 italic=0 charset="" unicode=1\n' +
    "common lineHeight=40 base=32 scaleW=512 scaleH=512 pages=1\n" +
    'page id=0 file="arial_20_bold_0-hd.png"\n';

  it("rewrites the original shared face to the given family, leaving the rest of the file intact", () => {
    const patched = patchFntFaceName(fntFixture, "arial_20_bold-hd");
    expect(patched).toContain('info face="arial_20_bold-hd" size=40');
    expect(patched).not.toContain(`face="${BMFONT_SHARED_FACE}"`);
    expect(patched).toContain('page id=0 file="arial_20_bold_0-hd.png"');
  });

  it("also rewrites an independently authored face", () => {
    const clean = fntFixture.replace("Arial Narrow", "DejaVu Sans");
    const patched = patchFntFaceName(clean, "arial_14-hd");
    expect(patched).toContain('info face="arial_14-hd" size=40');
    expect(patched).not.toContain('face="DejaVu Sans"');
  });

  it("accepts CRLF text descriptors", () => {
    const patched = patchFntFaceName(fntFixture.replaceAll("\n", "\r\n"), "arial_18_bold-hd");
    expect(patched).toContain('info face="arial_18_bold-hd" size=40 bold=1 italic=0 charset="" unicode=1\r\n');
  });

  it.each([
    ["missing info line", 'common lineHeight=40\npage id=0 file="page.png"\n', /exactly one info line/],
    ["missing face attribute", "info size=40 bold=0\n", /exactly one quoted face attribute/],
    ["duplicate face attributes", 'info face="One" face="Two" size=40\n', /exactly one quoted face attribute/],
    ["duplicate info lines", 'info face="One" size=40\ninfo face="Two" size=40\n', /exactly one info line/],
  ])("throws (fail-loud) for a malformed descriptor with %s", (_label, descriptor, expected) => {
    expect(() => patchFntFaceName(descriptor, "arial_14-hd", "clean.fnt")).toThrow(expected);
  });

  it("rejects a family that could break the quoted descriptor field", () => {
    expect(() => patchFntFaceName(fntFixture, 'bad" face')).toThrow(/unsafe/);
  });
});

describe("bitmapFontCacheKey", () => {
  it("matches PixiJS BitmapFontManager.getFont's `${fontFamily}-bitmap` lookup key", () => {
    // pixi.js 8.19.0, lib/scene/text-bitmap/BitmapFontManager.js line 59.
    expect(bitmapFontCacheKey("arial_14-hd")).toBe("arial_14-hd-bitmap");
  });
});
