import { describe, it, expect } from "vitest";
import {
  cutScale9,
  layoutScale9,
  parseScale9Rect,
  resolveScale9Size,
  SCALE9_PATCH_ORDER,
  type Rect,
} from "../src/scale9Math.js";


const TEX_W = 82; // 164 px / CSF 2.0
const TEX_H = 54; // 108 px / CSF 2.0
const CENTER_REGION_STR = "{{20,20},{42,14}}";

describe("parseScale9Rect", () => {
  it("parses the cocos rect grammar", () => {
    expect(parseScale9Rect(CENTER_REGION_STR)).toEqual({ x: 20, y: 20, w: 42, h: 14 });
  });

  it("is whitespace-tolerant", () => {
    expect(parseScale9Rect("{ { 20 , 20 } , { 42 , 14 } }")).toEqual({ x: 20, y: 20, w: 42, h: 14 });
  });

  it("parses negative and fractional numbers", () => {
    expect(parseScale9Rect("{{-1.5,2},{3,4.25}}")).toEqual({ x: -1.5, y: 2, w: 3, h: 4.25 });
  });

  it("throws on malformed input (fail loud)", () => {
    expect(() => parseScale9Rect("{20,20,42,14}")).toThrow(/not a cocos rect string/);
    expect(() => parseScale9Rect("")).toThrow(/not a cocos rect string/);
    expect(() => parseScale9Rect("{{20,20},{42}}")).toThrow(/not a cocos rect string/);
  });
});

describe("cutScale9", () => {
  const centerRegion = parseScale9Rect(CENTER_REGION_STR);
  const patches = cutScale9(TEX_W, TEX_H, centerRegion);

  it("returns the 9 patches in ivar-release order", () => {
    expect(patches).toHaveLength(9);
    expect(SCALE9_PATCH_ORDER).toEqual([
      "topLeft",
      "top",
      "topRight",
      "left",
      "center",
      "right",
      "bottomLeft",
      "bottom",
      "bottomRight",
    ]);
  });

  it("center patch is centerRegion verbatim", () => {
    const center = patches[SCALE9_PATCH_ORDER.indexOf("center")]!;
    expect(center).toEqual(centerRegion);
  });

  it("standard 9-cut for PopupBackgroundThin (82x54 pt texture, centerRegion {{20,20},{42,14}})", () => {
    const byName: Record<string, Rect> = Object.fromEntries(
      SCALE9_PATCH_ORDER.map((name, i) => [name, patches[i]!]),
    );
    expect(byName["bottomLeft"]).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(byName["bottom"]).toEqual({ x: 20, y: 0, w: 42, h: 20 });
    expect(byName["bottomRight"]).toEqual({ x: 62, y: 0, w: 20, h: 20 });
    expect(byName["left"]).toEqual({ x: 0, y: 20, w: 20, h: 14 });
    expect(byName["center"]).toEqual({ x: 20, y: 20, w: 42, h: 14 });
    expect(byName["right"]).toEqual({ x: 62, y: 20, w: 20, h: 14 });
    expect(byName["topLeft"]).toEqual({ x: 0, y: 34, w: 20, h: 20 });
    expect(byName["top"]).toEqual({ x: 20, y: 34, w: 42, h: 20 });
    expect(byName["topRight"]).toEqual({ x: 62, y: 34, w: 20, h: 20 });
  });

  // Pins the point-space reading of the texture dimensions: with W,H = pixels/CSF
  // (followup-consts.md §6, data_267374 = 2.0) both Scale9Sprites.json entries that share
  // PopupBackgroundThin.png produce exactly symmetric margins. Under a raw-pixel reading
  // (164x108) the margins come out lopsided (e.g. L20/R102/B20/T74) — so this test fails if the
  // CSF division is ever dropped.
  it("PopupBackgroundThin margins are symmetric (20 pt) on all four sides in point space", () => {
    const byName: Record<string, Rect> = Object.fromEntries(
      SCALE9_PATCH_ORDER.map((name, i) => [name, patches[i]!]),
    );
    const left = byName["bottomLeft"]!.w;
    const right = byName["bottomRight"]!.w;
    const bottom = byName["bottomLeft"]!.h;
    const top = byName["topLeft"]!.h;
    expect([left, right, bottom, top]).toEqual([20, 20, 20, 20]);
  });

  it("PopupBackgroundCompact ({{6,6},{70,42}}, same 82x54 pt texture) has symmetric 6 pt margins", () => {
    const compact = cutScale9(TEX_W, TEX_H, parseScale9Rect("{{6,6},{70,42}}"));
    const byName: Record<string, Rect> = Object.fromEntries(
      SCALE9_PATCH_ORDER.map((name, i) => [name, compact[i]!]),
    );
    expect([byName["bottomLeft"]!.w, byName["bottomRight"]!.w, byName["bottomLeft"]!.h, byName["topLeft"]!.h]).toEqual([
      6, 6, 6, 6,
    ]);
    expect(byName["center"]).toEqual({ x: 6, y: 6, w: 70, h: 42 });
  });
});

describe("layoutScale9", () => {
  const centerRegion = parseScale9Rect(CENTER_REGION_STR);
  const patches = cutScale9(TEX_W, TEX_H, centerRegion);

  it("corners are unscaled and sit at the 4 corners of the target box", () => {
    const layout = layoutScale9(patches, { w: 200, h: 150 });
    const byName = Object.fromEntries(SCALE9_PATCH_ORDER.map((name, i) => [name, layout[i]!]));

    expect(byName["bottomLeft"]).toEqual({ pos: { x: 0, y: 0 }, scale: { x: 1, y: 1 } });
    expect(byName["bottomRight"]!.scale).toEqual({ x: 1, y: 1 });
    expect(byName["topLeft"]!.scale).toEqual({ x: 1, y: 1 });
    expect(byName["topRight"]!.scale).toEqual({ x: 1, y: 1 });

    // Corner positions land on the exact edges of the 200x150 target box (corner sizes unscaled:
    // all four margins 20pt for this texture).
    expect(byName["bottomRight"]!.pos).toEqual({ x: 180, y: 0 }); // 200 - 20
    expect(byName["topLeft"]!.pos).toEqual({ x: 0, y: 130 }); // 150 - 20
    expect(byName["topRight"]!.pos).toEqual({ x: 180, y: 130 });
  });

  it("edge/center scale = sizable/patchSize (-[Scale9Sprite setContentSize:] @ 0xc2910)", () => {
    const layout = layoutScale9(patches, { w: 200, h: 150 });
    const byName = Object.fromEntries(SCALE9_PATCH_ORDER.map((name, i) => [name, layout[i]!]));

    // sizableWidth = 200 - topLeft.w(20) - topRight.w(20) = 160;
    // sizableHeight = 150 - topLeft.h(20) - bottomRight.h(20) = 110.
    const sizableWidth = 160;
    const sizableHeight = 110;

    expect(byName["center"]!.scale.x).toBeCloseTo(sizableWidth / 42, 10); // center.w = 42
    expect(byName["center"]!.scale.y).toBeCloseTo(sizableHeight / 14, 10); // center.h = 14
    expect(byName["top"]!.scale.x).toBeCloseTo(sizableWidth / 42, 10); // top.w = 42
    expect(byName["bottom"]!.scale.x).toBeCloseTo(sizableWidth / 42, 10); // bottom.w = 42
    expect(byName["left"]!.scale.y).toBeCloseTo(sizableHeight / 14, 10); // left.h = 14
    expect(byName["right"]!.scale.y).toBeCloseTo(sizableHeight / 14, 10);


    expect(byName["center"]!.pos).toEqual({ x: 20, y: 20 });
    expect(byName["top"]!.pos).toEqual({ x: 20, y: 130 });
    expect(byName["left"]!.pos).toEqual({ x: 0, y: 20 });
  });

  it("throws when not given exactly 9 patches", () => {
    expect(() => layoutScale9(patches.slice(0, 8), { w: 200, h: 150 })).toThrow(/expected 9 patches/);
  });
});

describe("resolveScale9Size", () => {


  it("adds 2*origin around the passed inner content (PopupBackgroundThin {{20,20},{42,14}})", () => {
    expect(resolveScale9Size({ x: 20, y: 20, w: 42, h: 14 }, { w: 260, h: 60 })).toEqual({ w: 300, h: 100 });
  });

  it("MenuButton2 {{9,6},{84,17}}: a label-sized content yields label + (18,12) chrome", () => {
    expect(resolveScale9Size({ x: 9, y: 6, w: 84, h: 17 }, { w: 22, h: 16 })).toEqual({ w: 40, h: 28 });
  });

  it("zero content yields just the 2*origin border shell", () => {
    expect(resolveScale9Size({ x: 20, y: 20, w: 42, h: 14 }, { w: 0, h: 0 })).toEqual({ w: 40, h: 40 });
  });

  it("centerRegion size does not participate in the final size at all", () => {
    const a = resolveScale9Size({ x: 6, y: 6, w: 70, h: 42 }, { w: 100, h: 50 });
    const b = resolveScale9Size({ x: 6, y: 6, w: 999, h: 1 }, { w: 100, h: 50 });
    expect(a).toEqual(b);
    expect(a).toEqual({ w: 112, h: 62 });
  });
});
