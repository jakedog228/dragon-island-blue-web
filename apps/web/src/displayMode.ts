


export type DisplayMode = "iphone" | "ipad";

export interface SizePt {
  w: number;
  h: number;
}

/** Cocos winSize in this port's point space per device idiom (see header model). */
export function screenPointsForMode(mode: DisplayMode): SizePt {
  return mode === "ipad" ? { w: 512, h: 384 } : { w: 480, h: 320 };
}

/** FixedStage logical pixel size: points x CONTENT_SCALE_FACTOR (2 — scale9.ts), i.e. the
 *  device's native pixel grid (960x640 retina iPhone, 1024x768 iPad). */
export function stagePixelsForMode(mode: DisplayMode): SizePt {
  const pt = screenPointsForMode(mode);
  return { w: pt.w * 2, h: pt.h * 2 };
}


export function unscaledIdiomPt(literalPt: number, mode: DisplayMode): number {
  return mode === "ipad" ? literalPt / 2 : literalPt;
}

/** Number of source-device Cocos points represented by one point in the port's normalized
 * coordinate space. The retina-iPhone tier is already 1:1; native iPad Cocos coordinates are
 * halved to fit the port's uniform CSF-2 space. */
export function sourcePointsPerPortPoint(mode: DisplayMode): number {
  return mode === "ipad" ? 2 : 1;
}

/** Selects a source-native iPhone/iPad constant pair, then normalizes it into port points.
 *
 * Keep this distinct from `unscaledIdiomPt`: a proven pair may be doubled (15/30), non-doubled
 * (14/20), or otherwise asymmetric (75/172). Selecting first and normalizing second preserves
 * every one of those source behaviors and makes an accidental phone-only constant conspicuous. */
export function idiomPairPt(phonePt: number, padPt: number, mode: DisplayMode): number {
  return (mode === "ipad" ? padPt : phonePt) / sourcePointsPerPortPoint(mode);
}


export function roundSourcePoint(valuePt: number, mode: DisplayMode): number {
  const scale = sourcePointsPerPortPoint(mode);
  const native = valuePt * scale;
  const roundedNative = native < 0 ? Math.ceil(native - 0.5) : Math.floor(native + 0.5);
  return roundedNative / scale;
}

/** Mirrors a source `vcvt.s32.f32`/integer-argument truncation before display normalization. */
export function truncateSourcePoint(valuePt: number, mode: DisplayMode): number {
  const scale = sourcePointsPerPortPoint(mode);
  return Math.trunc(valuePt * scale) / scale;
}

/** Encounter data's `combatBackground` values are shipped file names ("ForestCombat.png",
 *  battle-node.md §2 / Worlds' pointsOfInterest arguments); AssetLibrary manifest keys drop
 *  the extension. Fails loudly on a name outside the shipped `<Biome>Combat.png` vocabulary
 *  so a config typo can't silently resolve to a non-battle sprite. */
export function combatBackgroundSpriteKey(fileName: string): string {
  if (!/^[A-Za-z]+Combat\.png$/.test(fileName)) {
    throw new Error(`not a <Biome>Combat.png combat background: ${fileName}`);
  }
  return fileName.replace(/\.png$/, "");
}
