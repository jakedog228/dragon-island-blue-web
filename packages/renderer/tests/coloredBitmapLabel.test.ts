import { beforeEach, describe, expect, it, vi } from "vitest";

const layout = vi.hoisted(() => ({
  width: 25,
  height: 20,
  offsetY: 0,
  scale: 1,
  lines: [{
    width: 25,
    // Pixi deliberately gives a breaking space position 0: it emits no glyph quad for it.
    charPositions: [0, 5, 0, 13],
    spaceWidth: 3,
    spacesIndex: [2],
    chars: ["A", "B", " ", "C"],
  }, {
    width: 0,
    charPositions: [],
    spaceWidth: 0,
    spacesIndex: [],
    chars: [],
  }],
}));

vi.mock("pixi.js", () => {
  class BitmapText {
    readonly text: string;
    readonly style: Record<string, unknown>;
    readonly pivot = { y: 0 };
    readonly scale = { set: vi.fn() };
    readonly position = {
      x: 0,
      y: 0,
      set: (x: number, y: number) => {
        this.position.x = x;
        this.position.y = y;
      },
    };
    label = "";
    eventMode = "";

    constructor(options: { text: string; style: Record<string, unknown> }) {
      this.text = options.text;
      this.style = options.style;
    }

    destroy(): void {}
  }

  class Container {
    readonly children: BitmapText[] = [];
    label = "";
    boundsArea: unknown;

    addChild(child: BitmapText): BitmapText {
      this.children.push(child);
      return child;
    }
  }

  return {
    BitmapText,
    Cache: {
      get: () => ({
        baseLineOffset: 0,
        lineHeight: 20,
      }),
    },
    Container,
    Rectangle: class {
      constructor(
        readonly x: number,
        readonly y: number,
        readonly width: number,
        readonly height: number,
      ) {}
    },
    Text: class {},
    getBitmapTextLayout: vi.fn(() => layout),
  };
});

import { makeColoredBitmapLabel } from "../src/labels.js";
import { registerBitmapFontPadding } from "../src/bitmapFontFile.js";

// Every bitmap label advances each glyph by `padding_.right` (both shipped `createFontChars`
// paths), so the label builder now needs the descriptor's padding even without word wrap.
// The shipped faces all declare padding=1,1,1,1; the mocked layout above is unaffected by it.
registerBitmapFontPadding("arial_20_bold-hd", { left: 1, top: 1, right: 1, bottom: 1 });

describe("makeColoredBitmapLabel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("anchors a post-color run at its first drawable glyph instead of Pixi's zero-position space", () => {
    const label = makeColoredBitmapLabel("A^#00ff00B^^ C", 20, true);
    const runs = label.children as unknown as Array<{
      readonly text: string;
      readonly label: string;
      readonly position: { readonly x: number; readonly y: number };
    }>;

    expect(runs.map((run) => ({
      text: run.text,
      color: run.label,
      x: run.position.x,
    }))).toEqual([
      { text: "A", color: "coloredBitmapRun:ffffff", x: 0 },
      { text: "B", color: "coloredBitmapRun:00ff00", x: 5 / 2 },
      { text: "C", color: "coloredBitmapRun:ffffff", x: 13 / 2 },
    ]);
  });
});
