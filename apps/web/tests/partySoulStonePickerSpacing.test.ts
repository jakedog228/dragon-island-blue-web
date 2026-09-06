import { Container, Rectangle, Texture, type Text } from "pixi.js";
import { Box } from "@dib/renderer";
import { describe, expect, it, vi } from "vitest";
import { dungeonLootDisplayMetrics } from "../src/dungeon/dungeonDisplayMath.js";
import {
  roundSourcePoint,
  sourcePointsPerPortPoint,
  unscaledIdiomPt,
} from "../src/displayMode.js";
import { DISPLAY_MODE } from "../src/runtimeSettings.js";
import {
  buildPartySoulStonePickerRow,
  partySoulStonePickerSourceLabelHeight,
  type PartySoulStonePickerOptions,
} from "../src/world/partySoulStonePicker.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
  Object.defineProperty(globalThis, "CanvasRenderingContext2D", {
    configurable: true,
    value: class CanvasRenderingContext2D {},
  });
  const context2d = {
    font: "",
    measureText: () => ({
      width: 40,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: 40,
      actualBoundingBoxAscent: 10,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 10,
      fontBoundingBoxDescent: 2,
    }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    clearRect: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    scale: () => undefined,
    setTransform: () => undefined,
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => ({ width: 1, height: 1, getContext: () => context2d }) },
  });
});

function texture(width: number, height: number): Texture {
  return new Texture({ source: Texture.WHITE.source, frame: new Rectangle(0, 0, width, height) });
}

describe("Insert Soul Stone source row spacing", () => {
  const options = {
    data: {
      soulStoneByElement: () => ({ enabledStats: ["Attack"] }),
    },
    soulStoneTextures: new Map([["Fire", texture(64, 64)]]),
    statTextures: new Map([["Attack", texture(48, 48)]]),
  } as unknown as PartySoulStonePickerOptions;

  it("pins captured native title/value line heights in both idioms", () => {
    expect(partySoulStonePickerSourceLabelHeight("title", "iphone")).toBe(20.25);
    expect(partySoulStonePickerSourceLabelHeight("statValue", "iphone")).toBe(11.25);
    expect(partySoulStonePickerSourceLabelHeight("title", "ipad")).toBe(20.25);
    expect(partySoulStonePickerSourceLabelHeight("statValue", "ipad")).toBe(9);
  });

  it("packs the captured CCLabelTTF value frame instead of browser Arial or outline ink", () => {
    const built = buildPartySoulStonePickerRow(options, {
      token: "stone-1",
      stone: { element: "Fire", level: 10, sourceType: "FireCub" },
    });
    const value = built.display.children
      .flatMap((child) => child.children)
      .flatMap((child) => child.children)
      .flatMap((child) => child.children)
      .find((child) => child.label?.startsWith("stonePickerStat:")) as Text | undefined;
    expect(value).toBeDefined();

    const metrics = dungeonLootDisplayMetrics(DISPLAY_MODE);
    const sourceValueHeight = partySoulStonePickerSourceLabelHeight("statValue", DISPLAY_MODE);
    const expectedHeight = DISPLAY_MODE === "iphone" ? 40 : 35.5;
    expect(value!.getLocalBounds().height * value!.scale.y).toBeGreaterThan(sourceValueHeight);
    expect(value!.y).toBe(
      metrics.bonusIconSide + metrics.rowGap - unscaledIdiomPt(2, DISPLAY_MODE),
    );
    expect(built.contentSize.h).toBe(expectedHeight);
    expect(built.root.boundsArea?.height).toBe(expectedHeight);
    expect(built.display.y).toBe(
      -(roundSourcePoint(expectedHeight / 2, DISPLAY_MODE) - expectedHeight / 2),
    );
  });

  it("reproduces the native 45pt phone / 38pt iPad row pitch without drift", () => {
    const rowCount = DISPLAY_MODE === "iphone" ? 4 : 5;
    const rowHeight = DISPLAY_MODE === "iphone" ? 40 : 35.5;
    const gap = DISPLAY_MODE === "iphone" ? 5 : 2.5;
    const pitch = DISPLAY_MODE === "iphone" ? 45 : 38;
    const column = new Box({
      gap,
      positiveAlignDirection: true,
      horizontalAlignment: 0,
      roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
    });
    const roots: Container[] = [];
    for (let index = 0; index < rowCount; index++) {
      const built = buildPartySoulStonePickerRow(options, {
        token: `stone-${index}`,
        stone: { element: "Fire", level: 10, sourceType: "FireCub" },
      });
      roots.push(built.root);
      column.addBoxChild(built.root, { contentSize: built.contentSize });
    }
    expect(roots.map(({ y }, index) => y - roots[0]!.y))
      .toEqual(Array.from({ length: rowCount }, (_unused, index) => index * pitch));
    expect(column.boxContentSize.h).toBe(rowCount * rowHeight + (rowCount - 1) * gap);
  });
});
