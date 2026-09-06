import { describe, expect, it } from "vitest";
import { popupTextLayout } from "../src/ui/popupTextMath.js";

describe("PopupTextConfig TTF sizing", () => {
  it("widens by the source bare 50-point step until measured height is no longer greater", () => {
    const constraints: number[] = [];
    const layout = popupTextLayout(300, 14, "iphone", (constraint) => {
      constraints.push(constraint);
      return constraint === 300
        ? { width: 180, height: 220 }
        : { width: 315, height: 80 };
    });

    expect(constraints).toEqual([300, 350]);
    expect(layout).toEqual({
      width: 345,
      height: 99,
      wrapWidth: 345,
      measuredWidth: 315,
      measuredHeight: 80,
    });
  });

  it("normalizes every proven bare literal independently for the iPad tier", () => {
    const constraints: number[] = [];
    const layout = popupTextLayout(300, 14, "ipad", (constraint) => {
      constraints.push(constraint);
      return constraint === 300
        ? { width: 140, height: 160 }
        : { width: 280, height: 90 };
    });

    expect(constraints).toEqual([300, 325]);
    expect(layout).toEqual({
      width: 295,
      height: 106.5,
      wrapWidth: 295,
      measuredWidth: 280,
      measuredHeight: 90,
    });
  });
});
