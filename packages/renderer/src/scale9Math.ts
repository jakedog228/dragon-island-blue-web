


export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  w: number;
  h: number;
}

export interface Scale9Patch {
  pos: Point;
  scale: Point;
}


export const SCALE9_PATCH_ORDER = [
  "topLeft",
  "top",
  "topRight",
  "left",
  "center",
  "right",
  "bottomLeft",
  "bottom",
  "bottomRight",
] as const;

export type Scale9PatchName = (typeof SCALE9_PATCH_ORDER)[number];

const _NUM = String.raw`-?\d+(?:\.\d+)?`;
const RECT_RE = new RegExp(
  String.raw`^\s*\{\s*\{\s*(${_NUM})\s*,\s*(${_NUM})\s*\}\s*,\s*\{\s*(${_NUM})\s*,\s*(${_NUM})\s*\}\s*\}\s*$`,
);

/**
 * Parses a Cocos2d rect string `{{x,y},{w,h}}` (same grammar as `CGRectFromString`, ported from
 * `tools/dib_extract/cocos.py::parse_rect`). Whitespace-tolerant; throws on malformed input
 * (repo fail-loud convention — never silently default a bad rect).
 */
export function parseScale9Rect(s: string): Rect {
  const m = RECT_RE.exec(s);
  if (!m) throw new Error(`not a cocos rect string: ${JSON.stringify(s)}`);
  return { x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) };
}


export function cutScale9(texW: number, texH: number, centerRegion: Rect): Rect[] {
  const { x: cx, y: cy, w: cw, h: ch } = centerRegion;
  const leftW = cx;
  const rightX = cx + cw;
  const rightW = texW - rightX;
  const bottomH = cy;
  const topY = cy + ch;
  const topH = texH - topY;

  const byName: Record<Scale9PatchName, Rect> = {
    bottomLeft: { x: 0, y: 0, w: leftW, h: bottomH },
    bottom: { x: cx, y: 0, w: cw, h: bottomH },
    bottomRight: { x: rightX, y: 0, w: rightW, h: bottomH },
    left: { x: 0, y: cy, w: leftW, h: ch },
    center: { x: cx, y: cy, w: cw, h: ch },
    right: { x: rightX, y: cy, w: rightW, h: ch },
    topLeft: { x: 0, y: topY, w: leftW, h: topH },
    top: { x: cx, y: topY, w: cw, h: topH },
    topRight: { x: rightX, y: topY, w: rightW, h: topH },
  };
  return SCALE9_PATCH_ORDER.map((name) => byName[name]);
}


export function layoutScale9(patches: Rect[], contentSize: Size): Scale9Patch[] {
  if (patches.length !== 9) throw new Error(`layoutScale9: expected 9 patches, got ${patches.length}`);
  const [topLeft, top, topRight, left, center, right, bottomLeft, bottom, bottomRight] = patches as [
    Rect, Rect, Rect, Rect, Rect, Rect, Rect, Rect, Rect,
  ];

  const sizableWidth = contentSize.w - topLeft.w - topRight.w;
  const sizableHeight = contentSize.h - topLeft.h - bottomRight.h;

  const leftW = bottomLeft.w;
  const bottomH = bottomLeft.h;

  const scaleXFor = (patch: Rect): number => sizableWidth / patch.w;
  const scaleYFor = (patch: Rect): number => sizableHeight / patch.h;

  const byName: Record<Scale9PatchName, Scale9Patch> = {
    bottomLeft: { pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 } },
    bottom: { pos: { x: leftW, y: 0 }, scale: { x: scaleXFor(bottom), y: 1 } },
    bottomRight: { pos: { x: leftW + sizableWidth, y: 0 }, scale: { x: 1, y: 1 } },
    left: { pos: { x: 0, y: bottomH }, scale: { x: 1, y: scaleYFor(left) } },
    center: { pos: { x: leftW, y: bottomH }, scale: { x: scaleXFor(center), y: scaleYFor(center) } },
    right: { pos: { x: leftW + sizableWidth, y: bottomH }, scale: { x: 1, y: scaleYFor(right) } },
    topLeft: { pos: { x: 0, y: bottomH + sizableHeight }, scale: { x: 1, y: 1 } },
    top: { pos: { x: leftW, y: bottomH + sizableHeight }, scale: { x: scaleXFor(top), y: 1 } },
    topRight: { pos: { x: leftW + sizableWidth, y: bottomH + sizableHeight }, scale: { x: 1, y: 1 } },
  };
  return SCALE9_PATCH_ORDER.map((name) => byName[name]);
}


export function resolveScale9Size(centerRegion: Rect, contentDimensions: Size): Size {
  return {
    w: contentDimensions.w + 2 * centerRegion.x,
    h: contentDimensions.h + 2 * centerRegion.y,
  };
}
