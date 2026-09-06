import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  popupButtonCloses,
} from "../src/ui/popupButtonMath.js";
import { menuButton2HitRect, menuButton2HitTest } from "../src/ui/menuButton2Math.js";
import { popupMenuButtonAt } from "../src/ui/popupMenuMath.js";

describe("PopupMenuItem hit arbitration and dismissal", () => {
  it("uses the visible PopupMenu plates and squared Euclidean centre arbitration", () => {
    const layout = (background: { x: number; y: number; w: number; h: number }) => ({
      column: 0,
      row: 0,
      label: { x: background.x + 9, y: background.y + 6, w: 10, h: 8 },
      background,
    });
    const candidates = [
      // At the probe, `horizontal` has zero vertical distance but is much farther in X. The old
      // regression's vertical-only arbitration selected it; native squared distance selects tall.
      { value: "horizontal", layout: layout({ x: 0, y: 40, w: 200, h: 20 }), enabled: true },
      { value: "tall", layout: layout({ x: 30, y: -10, w: 40, h: 80 }), enabled: true },
    ] as const;
    expect(popupMenuButtonAt(candidates, { x: 50, y: 50 })).toBe("tall");
    const tied = [
      { value: "first", layout: layout({ x: 20, y: 30, w: 40, h: 40 }), enabled: true },
      { value: "second", layout: layout({ x: 40, y: 30, w: 40, h: 40 }), enabled: true },
    ] as const;
    expect(popupMenuButtonAt(tied, { x: 50, y: 50 })).toBe("first");
    expect(popupMenuButtonAt(
      [{ value: "disabled", layout: layout({ x: 0, y: 0, w: 100, h: 40 }), enabled: false }],
      { x: 50, y: 20 },
    )).toBeUndefined();
  });

  it("registers every pixel of a short visible MenuButton2 plate", () => {
    const plate = { x: -9, y: -6, w: 36, h: 26 };
    expect(menuButton2HitRect(plate)).toEqual(plate);
    expect(menuButton2HitTest(plate, { x: plate.x, y: plate.y })).toBe(true);
    expect(menuButton2HitTest(plate, { x: plate.x + plate.w - 0.01, y: plate.y + plate.h - 0.01 })).toBe(true);
    expect(menuButton2HitTest(plate, { x: plate.x - 0.01, y: 0 })).toBe(false);
    expect(menuButton2HitTest(plate, { x: plate.x + plate.w + 0.01, y: 0 })).toBe(false);
  });

  it("keeps a long button's brown overhang interactive instead of treating it as decoration", () => {
    const plate = { x: -9, y: -6, w: 98, h: 26 };
    expect(menuButton2HitTest(plate, { x: -8.99, y: 7 })).toBe(true);
    expect(menuButton2HitTest(plate, { x: 88.99, y: 7 })).toBe(true);
    expect(menuButton2HitTest(plate, { x: -9.01, y: 7 })).toBe(false);
    expect(menuButton2HitTest(plate, { x: 89.01, y: 7 })).toBe(false);
  });

  it("keeps Cancel on PopupMenuItem's default synchronous-dismiss path", () => {
    expect(popupButtonCloses(undefined)).toBe(true);
    expect(popupButtonCloses(true)).toBe(true);
    expect(popupButtonCloses(false)).toBe(false);
  });

  it("keeps every direct MenuButton2 Scale9 construction in the shared builder", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const offenders: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = `${directory}/${entry.name}`;
        if (entry.isDirectory()) visit(path);
        else if (
          entry.name.endsWith(".ts") &&
          /Scale9\.fromConfig\([\s\S]{0,200}?["']MenuButton2/.test(readFileSync(path, "utf8")) &&
          !path.replaceAll("\\", "/").endsWith("/ui/menuButton2.ts")
        ) {
          offenders.push(path);
        }
      }
    };
    visit(src);
    expect(offenders).toEqual([]);
  });
});
