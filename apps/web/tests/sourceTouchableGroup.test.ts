import { describe, expect, it, vi } from "vitest";

// pixi.js probes the browser environment at module scope.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

import { Container, EventBoundary, extensions, FederatedContainer, Graphics } from "pixi.js";
import { SourceTouchableGroup } from "../src/battle/infoDisplays.js";

// `Container`'s event methods are a mixin that pixi installs from `events/init` when a renderer is
// created; there is no renderer here, so install it directly.
extensions.mixin(Container, FederatedContainer);

const box = (x: number, y: number, w: number, h: number): Graphics =>
  new Graphics().rect(x, y, w, h).fill(0xffffff);












function harness(): {
  stage: Container;
  owner: Container;
  descendant: Graphics;
  target: Graphics;
  boundary: EventBoundary;
  taps: number;
} {
  const stage = new Container();
  const owner = new Container();
  // A 10x10 target at the top of the card, standing in for the element icon / HP label.
  const target = box(0, 0, 10, 10);
  // An interactive descendant far below every target, standing in for the scroll region's bars and
  // content rows. It is added BEFORE install(), exactly as the scroll region is.
  const descendant = box(0, 200, 20, 20);
  descendant.eventMode = "static";
  owner.addChild(descendant);
  stage.addChild(owner);

  const state = { taps: 0 };
  const group = new SourceTouchableGroup(owner);
  group.add(target, () => {
    state.taps += 1;
  });
  owner.addChild(target);
  group.install();

  return {
    stage,
    owner,
    descendant,
    target,
    boundary: new EventBoundary(stage),
    get taps() {
      return state.taps;
    },
  };
}

describe("SourceTouchableGroup", () => {
  it("does not install a pruning hit area on the owner", () => {
    const { owner } = harness();
    expect(owner.hitArea ?? null).toBeNull();
  });

  it("leaves interactive descendants reachable outside the group's own targets", () => {
    const { boundary, descendant } = harness();
    // Dead at the regressed HEAD: the owner's whitelist rejected this point and pruned the subtree.
    expect(boundary.hitTest(10, 210)).toBe(descendant);
  });

  it("still claims its own targets, expanded to the shared 55pt minimum", () => {
    const { boundary, owner } = harness();
    const layer = owner.children[0]!;
    expect(layer.label).toBe("sourceTouchableHitLayer");
    // The 10x10 target finalizes to 55x55 centred on it: x/y in [-22.5, 32.5).
    expect(boundary.hitTest(-20, -20)).toBe(layer);
    expect(boundary.hitTest(5, 5)).toBe(layer);
    expect(boundary.hitTest(-23, -23)).toBeNull();
  });

  it("yields an overlapping point to nested card content, as the source dispatcher does", () => {
    const { boundary, owner } = harness();
    const layer = owner.children[0]!;






    const overlapping = box(0, 20, 20, 20);
    overlapping.eventMode = "static";
    owner.addChild(overlapping);
    // y = 25 is inside BOTH the target's finalized ring (which reaches y = 32.5) and the content.
    expect(boundary.hitTest(10, 25)).toBe(overlapping);
    // Ring-only points still belong to the group.
    expect(boundary.hitTest(10, 15)).toBe(layer);
  });

  it("ranks a child added at index 0 after install() below the group", () => {
    const { boundary, owner } = harness();
    const layer = owner.children[0]!;
    // The card's port-only scroll-wheel layer relies on this: it has no source delegate, so it must
    // never outrank a real target.
    const below = box(0, 20, 20, 20);
    below.eventMode = "static";
    owner.addChildAt(below, 0);
    expect(boundary.hitTest(10, 25)).toBe(layer);
    expect(boundary.hitTest(10, 35)).toBe(below);
  });

  it("adds no bounds of its own", () => {
    const bare = new Container();
    bare.addChild(box(0, 200, 20, 20));
    const before = bare.getLocalBounds().rectangle.toString();
    const { owner } = harness();
    // Same content, plus the installed layer and the 10x10 target.
    expect(owner.getLocalBounds().rectangle.toString()).toBe(
      (() => {
        const expected = new Container();
        expected.addChild(box(0, 200, 20, 20));
        expected.addChild(box(0, 0, 10, 10));
        return expected.getLocalBounds().rectangle.toString();
      })(),
    );
    expect(before).toBe(bare.getLocalBounds().rectangle.toString());
  });

  it("installs nothing when the display has no tappable nodes", () => {
    const owner = new Container();
    const group = new SourceTouchableGroup(owner);
    group.add(box(0, 0, 10, 10), undefined);
    group.install();
    expect(owner.children).toHaveLength(0);
    expect(owner.hitArea ?? null).toBeNull();
  });
});
















describe("living-info card event arbitration", () => {
  function card(): {
    boundary: EventBoundary;
    outerLayer: Container;
    abilityLayer: Container;
    bar: Graphics;
    wheelLayer: Container;
  } {
    const stage = new Container();
    const root = new Container();
    stage.addChild(root);

    // Outer LivingInfoDisplay group: the HP label, 70x10, so its 55pt-minimum ring keeps its width
    // (x in [0, 70]) and grows vertically to y in [-22.5, 32.5] — reaching 2.5pt into the scroll
    // viewport that starts at y = 30, exactly the intrusion the real card's HP/XP rings make.
    const outer = new SourceTouchableGroup(root);
    const hp = box(0, 0, 70, 10);
    outer.add(hp, () => {});
    root.addChild(hp);

    // The scroll region: `static` so the drag's globalpointermove and bubbled wheel still reach it,
    // but with NO hitArea, so it can never be the hit target itself.
    const scrollRegion = new Container();
    scrollRegion.eventMode = "static";
    const sections = new Container();
    scrollRegion.addChild(sections);

    // A nested AbilityList group. The row is 10x8, so its ring is x in [-22.5, 32.5],
    // y in [6.5, 61.5] — overlapping the outer ring's left half but not its right.
    const abilities = new SourceTouchableGroup(sections);
    const row = box(0, 30, 10, 8);
    abilities.add(row, () => {});
    sections.addChild(row);
    abilities.install();

    // The ScrollingNode bar, x in [60, 72], y in [30, 90] — inside the outer ring's width.
    const bar = box(60, 30, 12, 60);
    bar.eventMode = "static";
    scrollRegion.addChild(bar);
    root.addChild(scrollRegion);

    outer.install();

    // Port-only wheel target, added at index 0 AFTER install() so it ranks below everything.
    const wheelLayer = new Container();
    wheelLayer.eventMode = "static";
    wheelLayer.hitArea = { contains: (x, y) => x >= 0 && x <= 80 && y >= 30 && y <= 120 };
    root.addChildAt(wheelLayer, 0);

    return {
      boundary: new EventBoundary(stage),
      outerLayer: root.children.find((c) => c.label === "sourceTouchableHitLayer")!,
      abilityLayer: sections.children.find((c) => c.label === "sourceTouchableHitLayer")!,
      bar,
      wheelLayer,
    };
  }

  it("gives an ability row the point where the outer HP ring overlaps it", () => {
    const { boundary, abilityLayer } = card();
    // (5, 31) is inside BOTH the HP ring (x <= 70, y <= 32.5) and the row's ring (x <= 32.5).
    expect(boundary.hitTest(5, 31)).toBe(abilityLayer);
  });

  it("keeps outer targets above the scroll region's body", () => {
    const { boundary, outerLayer } = card();



    expect(boundary.hitTest(45, 31)).toBe(outerLayer);
  });

  it("keeps the scrollbar above outer targets", () => {
    const { boundary, bar } = card();
    // (65, 35) is inside the HP ring too; ScrollingNode registers later, so the bar takes it.
    expect(boundary.hitTest(65, 35)).toBe(bar);
  });

  it("ranks the port-only wheel layer below every source target", () => {
    const { boundary, wheelLayer, abilityLayer } = card();
    // Covered by a row ring -> the row wins and the wheel reaches applyWheel by bubbling instead.
    expect(boundary.hitTest(5, 40)).toBe(abilityLayer);
    // A viewport gap below every ring and beside the bar -> the wheel layer is the last claimant.
    expect(boundary.hitTest(20, 100)).toBe(wheelLayer);
  });
});
