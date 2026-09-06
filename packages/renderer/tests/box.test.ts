import { describe, expect, it, vi } from "vitest";

vi.stubGlobal("navigator", { userAgent: "node" });


describe("Box authored child contentSize", () => {
  it("keeps fixed slots when descendants overflow their content boxes", async () => {
    const [{ Container, Rectangle }, { Box }] = await Promise.all([import("pixi.js"), import("../src/box.js")]);
    const box = new Box({ horizontal: true, gap: 0, positiveAlignDirection: true });
    const children = [40, 320, 900].map((overflowWidth) => {
      const node = new Container();
      node.boundsArea = new Rectangle(-overflowWidth / 2, 0, overflowWidth, 250);
      box.addBoxChild(node, { contentSize: { w: 128, h: 210 } });
      return node;
    });

    expect(children.map((child) => child.position.x)).toEqual([0, 128, 256]);
    expect(children.map((child) => child.position.y)).toEqual([0, 0, 0]);
    expect(box.boxContentSize).toEqual({ w: 384, h: 210 });
  });

  it("applies the child's own scale to an authored contentSize", async () => {
    const [{ Container }, { Box }] = await Promise.all([import("pixi.js"), import("../src/box.js")]);
    const box = new Box({ horizontal: true, gap: 5, positiveAlignDirection: true });
    const first = new Container();
    first.scale.set(0.5, 2);
    const second = new Container();

    box.addBoxChild(first, { contentSize: { w: 100, h: 20 } });
    box.addBoxChild(second, { contentSize: { w: 10, h: 10 } });

    expect({ x: first.position.x, y: first.position.y }).toEqual({ x: 0, y: 0 });
    expect({ x: second.position.x, y: second.position.y }).toEqual({ x: 55, y: 15 });
    expect(box.boxContentSize).toEqual({ w: 65, h: 40 });
  });
});

// `performAwardLogic`'s XP grid, reduced to its geometry: a negative-direction horizontal Box
// holding one real monster+bar column and the empty column `sub_65ae0` hands back whenever the
// participant count does not fill `columns`. Everything visible has to stay inside the grid's own
// contentSize, because `-[Scale9Popup newConfiguration:]` sizes the popup card from it.
describe("Box negative-direction packing", () => {
  it("keeps a lone wide column inside the grid frame beside an empty one", async () => {
    const [{ Container }, { Box }] = await Promise.all([import("pixi.js"), import("../src/box.js")]);
    const grid = new Box({ horizontal: true, gap: 5, positiveAlignDirection: false, verticalAlignment: 0 });
    const wide = new Container();
    const empty = new Container();
    grid.addBoxChild(wide, { contentSize: { w: 218, h: 192 } });
    grid.addBoxChild(empty, { contentSize: { w: 5, h: 0 } });

    expect(grid.boxContentSize).toEqual({ w: 228, h: 192 });
    // Rebasing by the authored frame is what XpAwardDisplay does before handing the grid to the
    // outer Box; afterwards the columns must span exactly 0..228, empty column first.
    const originX = grid.boxLayoutBounds.x;
    expect(wide.position.x - originX).toBe(10);
    expect(empty.position.x - originX).toBe(0);
    expect(wide.position.x - originX + 218).toBe(grid.boxContentSize.w);
  });

  it("re-seats a negative-direction child Box onto its own authored origin", async () => {
    const { Box } = await import("../src/box.js");
    const outer = new Box({ horizontal: true, gap: 5, positiveAlignDirection: true });
    const inner = new Box({ horizontal: true, gap: 0, positiveAlignDirection: false });
    const leading = new Box({ horizontal: true, gap: 0, positiveAlignDirection: true });
    inner.addBoxChild(new (await import("pixi.js")).Container(), { contentSize: { w: 40, h: 10 } });
    outer.addBoxChild(leading, { contentSize: { w: 30, h: 10 } });
    outer.addBoxChild(inner, { contentSize: inner.boxContentSize });

    // `inner`'s descendants sit at -40..0 in its own frame, so its origin belongs at the far edge
    // of its slot — the port-frame form of the source's nested-Box `±contentSize` term.
    expect(inner.boxLayoutBounds.x).toBe(-40);
    expect(inner.position.x).toBe(75);
    expect(outer.boxContentSize).toEqual({ w: 75, h: 10 });
  });
});
