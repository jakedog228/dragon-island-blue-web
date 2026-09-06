import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";







vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

const FNT = resolve(
  import.meta.dirname,
  "../../../Payload/DragonIsland.app/arial_18_bold-hd.fnt",
);

const OLD_SAGE =
  'Old Sage:\n"Welcome to my humble abode. Though I look simple, I hold the key to great power. ' +
  'Prove your mastery over monsters and I will reward you."';

async function buildLabel(wordWrapWidthPt: number | undefined, source = OLD_SAGE) {
  const { Cache, bitmapFontTextParser } = await import("pixi.js");
  const { makeColoredBitmapLabel } = await import("../src/labels.js");
  const { bitmapFontCacheKey, parseBitmapFontPadding, registerBitmapFontPadding } =
    await import("../src/bitmapFontFile.js");

  const fntText = readFileSync(FNT, "utf8");
  const data = bitmapFontTextParser.parse(fntText) as unknown as Record<string, unknown>;
  // A metrics-only stand-in for BitmapFont: the layout pass reads chars/lineHeight/baseLineOffset
  // and the two base font sizes, none of which need GPU textures.
  const font = {
    chars: data["chars"],
    lineHeight: data["lineHeight"],
    baseLineOffset: data["baseLineOffset"],
    fontFamily: data["fontFamily"],
    baseMeasurementFontSize: data["fontSize"],
    baseRenderedFontSize: data["fontSize"],
    distanceField: { type: "none", range: 0 },
  };
  const family = "arial_18_bold-hd";
  if (!Cache.has(bitmapFontCacheKey(family))) Cache.set(bitmapFontCacheKey(family), font as never);
  registerBitmapFontPadding(family, parseBitmapFontPadding(fntText, FNT));

  return makeColoredBitmapLabel(source, 18, true, {
    ...(wordWrapWidthPt === undefined ? {} : { wordWrapWidth: wordWrapWidthPt }),
    align: "left",
  });
}

async function renderedLines(wordWrapWidthPt: number): Promise<string[]> {
  const root = await buildLabel(wordWrapWidthPt);
  return root.children.map((child) => (child as unknown as { text: string }).text);
}

describe("makeColoredBitmapLabel glyph advance", () => {




  it("widens a line by one font unit per glyph, in points", async () => {
    const line = "Welcome to my humble abode.";
    const root = await buildLabel(undefined, line);
    // boundsArea is in points: font units / CONTENT_SCALE_FACTOR.
    const widthPt = root.boundsArea.width;
    // Sum of xAdvance + kerning over this line in the -hd font's 36-unit space, from the shipped
    // descriptor: 376. The source draws it at 376 + 27 = 403.
    expect(Math.round(widthPt * 2)).toBe(376 + line.length);
  });
});

describe("makeColoredBitmapLabel word wrap", () => {
  // Dialogs.Chat fixedSize {440,80}: 440 pt x CC_CONTENT_SCALE_FACTOR 2 = 880 px.
  it("breaks the Old Sage line onto three lines at the iPhone chat width", async () => {
    expect(await renderedLines(440)).toEqual([
      "Old Sage:",
      '"Welcome to my humble abode. Though I look simple, I hold the ',
      "key to great power. Prove your mastery over monsters and I will ",
      'reward you."',
    ]);
  });

  // fixedSizeIPad {942,160}, normalized to 471 pt in the port's uniform CSF-2 point space.
  it("breaks it onto two lines at the iPad chat width", async () => {
    expect(await renderedLines(471)).toEqual([
      "Old Sage:",
      '"Welcome to my humble abode. Though I look simple, I hold the key to ',
      'great power. Prove your mastery over monsters and I will reward you."',
    ]);
  });
});
