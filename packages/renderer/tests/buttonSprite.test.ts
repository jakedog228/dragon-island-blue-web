import { describe, it, expect, vi } from "vitest";

// pixi.js cannot be imported for real under vitest's Node environment (module-scope browser
// sniffing reads `navigator`) — same mocking approach as assetLibrary.test.ts, but here the mock is
// a miniature scene-graph/event surface: a Container with an on/emit listener map and a Sprite
// whose width/height derive from its texture x scale (what pointSprite's 1/CSF fold produces).
//
// The dispatch helpers below replicate the pixi.js 8.19.0 EventBoundary behaviors under test,
// verified against lib/events/EventBoundary.mjs:
// - hitPruneFn (line 325): a container with `hitArea` set has the pointer mapped into LOCAL space
//   (worldTransform.applyInverse) and the whole subtree is pruned when `hitArea.contains` fails —
//   so pointerdown/pointerup only reach the button when its hitArea passes, and raw child-sprite
//   bounds are never consulted (hitTestFn line 351 returns true on hitArea alone).
// - mapPointerUp: a release that hit-tests elsewhere is delivered to the pressed target as
//   `pointerupoutside`.
// - mapPointerMove line 481 + hitTestMoveRecursive line 244: `globalpointermove` goes to every
//   interactive (eventMode static/dynamic) container via `all()`, REGARDLESS of hit position.
// All tests place the button at the world origin under an identity ancestor transform, so
// local == global and getLocalPosition can return the event's global point directly.
vi.mock("pixi.js", () => {
  const makePoint = (v: number) => ({
    x: v,
    y: v,
    set(a: number, b: number = a) {
      this.x = a;
      this.y = b;
    },
  });
  class Container {
    children: unknown[] = [];
    eventMode = "passive";
    cursor = "";
    hitArea: { contains(x: number, y: number): boolean } | null = null;
    position = makePoint(0);
    scale = makePoint(1);
    private listeners = new Map<string, { fn: (...a: unknown[]) => void; ctx: unknown }[]>();
    addChild<T>(c: T): T {
      this.children.push(c);
      return c;
    }
    on(ev: string, fn: (...a: unknown[]) => void, ctx?: unknown): this {
      const arr = this.listeners.get(ev) ?? [];
      arr.push({ fn, ctx });
      this.listeners.set(ev, arr);
      return this;
    }
    emit(ev: string, ...args: unknown[]): void {
      for (const { fn, ctx } of this.listeners.get(ev) ?? []) fn.apply(ctx, args);
    }
    getGlobalPosition(): { x: number; y: number } {
      return { x: this.position.x, y: this.position.y };
    }
  }
  class Sprite extends Container {
    texture: { width: number; height: number };
    anchor = makePoint(0);
    constructor(texture: { width: number; height: number }) {
      super();
      this.texture = texture;
    }
    get width(): number {
      return this.texture.width * this.scale.x;
    }
    get height(): number {
      return this.texture.height * this.scale.y;
    }
  }
  class Texture {}
  class Rectangle {}
  return { Container, Sprite, Texture, Rectangle };
});

import { ButtonSprite } from "../src/buttonSprite.js";
import type { Texture } from "pixi.js";


const tex = (w = 40, h = 20) => ({ width: w, height: h }) as unknown as Texture;

const evt = (x: number, y: number, pointerId = 1) => ({
  pointerId,
  global: { x, y },
  getLocalPosition: () => ({ x, y }),
  stopPropagation: vi.fn(),
});

// EventBoundary simulation (identity transform: local == global). See the mock header for the
// verified source-line citations each branch replicates.
function pressAt(btn: ButtonSprite, x: number, y: number, pointerId = 1): void {
  const b = btn as unknown as { eventMode: string; hitArea: { contains(x: number, y: number): boolean } | null };
  if (b.eventMode === "none") return; // _interactivePrune
  if (b.hitArea && b.hitArea.contains(x, y)) {
    (btn as unknown as { emit(e: string, a: unknown): void }).emit("pointerdown", evt(x, y, pointerId));
  }
}
function moveTo(btn: ButtonSprite, x: number, y: number, pointerId = 1): void {
  const b = btn as unknown as { eventMode: string };
  if (b.eventMode === "none") return;
  (btn as unknown as { emit(e: string, a: unknown): void }).emit("globalpointermove", evt(x, y, pointerId)); // delivered regardless of position
}
function releaseAt(btn: ButtonSprite, x: number, y: number, pointerId = 1): void {
  const b = btn as unknown as { eventMode: string; hitArea: { contains(x: number, y: number): boolean } | null };
  if (b.eventMode === "none") return;
  const inside = b.hitArea !== null && b.hitArea.contains(x, y);
  (btn as unknown as { emit(e: string, a: unknown): void }).emit(
    inside ? "pointerup" : "pointerupoutside",
    evt(x, y, pointerId),
  );
}
function cancel(btn: ButtonSprite, pointerId = 1): void {
  (btn as unknown as { emit(e: string, a: unknown): void }).emit("pointercancel", evt(0, 0, pointerId));
}
function emitPointer(
  btn: ButtonSprite,
  type: "pointerdown" | "globalpointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
  pointerId: number,
) {
  const event = evt(x, y, pointerId);
  (btn as unknown as { emit(e: string, a: unknown): void }).emit(type, event);
  return event;
}
function displayedTexture(btn: ButtonSprite): unknown {
  return (btn as unknown as { children: { texture: unknown }[] }).children[0]!.texture;
}
function hitArea(btn: ButtonSprite): { contains(x: number, y: number): boolean } {
  const area = (btn as unknown as { hitArea: { contains(x: number, y: number): boolean } | null }).hitArea;
  if (!area) throw new Error("ButtonSprite did not install a hitArea");
  return area;
}

function makeButton(
  extra: { pressSound?: () => void; activeTexture?: Texture | null; minHitSize?: number } = {},
) {
  const normal = tex();
  const active = "activeTexture" in extra ? extra.activeTexture : tex();
  const onPress = vi.fn();
  const btn = new ButtonSprite({
    normalTexture: normal,
    activeTexture: active,
    ...(extra.pressSound ? { pressSound: extra.pressSound } : {}),
    ...(extra.minHitSize !== undefined ? { minHitSize: extra.minHitSize } : {}),
  });
  btn.onPress(onPress);
  return { btn, normal, active, onPress };
}

describe("ButtonSprite hitArea (shared sub_64564 minimum)", () => {
  it("a plain button receives the source 55pt symmetric floor", () => {
    const { btn } = makeButton();
    expect(hitArea(btn).contains(25, 25)).toBe(true);
    expect(hitArea(btn).contains(-17.5, -22.5)).toBe(true);
    expect(hitArea(btn).contains(37.5, 0)).toBe(false);
    expect(hitArea(btn).contains(100, 100)).toBe(false);
  });

  it("a tap in the source padding ring fires onPress", () => {
    const { btn, onPress } = makeButton();
    pressAt(btn, 25, 25);
    releaseAt(btn, 25, 25);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("an explicit zero override retains a raw-bounds escape hatch", () => {
    const { btn, onPress } = makeButton({ minHitSize: 0 });
    expect(hitArea(btn).contains(19, 9)).toBe(true);
    expect(hitArea(btn).contains(20, 5)).toBe(false);
    expect(hitArea(btn).contains(25, 25)).toBe(false);
    pressAt(btn, 25, 25);
    releaseAt(btn, 25, 25);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("hitArea is live: a floored item's own-scale change is reflected without re-installation", () => {
    const { btn } = makeButton();
    expect(hitArea(btn).contains(25, 25)).toBe(true); // scale 1 padded rect
    (btn as unknown as { scale: { set(v: number): void } }).scale.set(2);
    // scaledContentSize now 40x20pt -> world pads (7.5, 17.5) -> LOCAL rect [-3.75,23.75)x[-8.75,18.75).
    expect(hitArea(btn).contains(25, 25)).toBe(false);
    expect(hitArea(btn).contains(23, 18)).toBe(true);
    expect(hitArea(btn).contains(-3.75, -8.75)).toBe(true);
  });
});

describe("ButtonSprite press/release (ccTouchBegan @ 0x598ac / ccTouchEnded @ 0x59a40)", () => {
  it("pointerdown swaps to the active frame; release inside restores normal and invokes", () => {
    const { btn, normal, active, onPress } = makeButton();
    expect(displayedTexture(btn)).toBe(normal);
    pressAt(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(active);
    releaseAt(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(normal); // always restores normalFrame
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("release outside un-presses without invoking (ccTouchEnded miss -> pointerupoutside)", () => {
    const { btn, normal, onPress } = makeButton();
    pressAt(btn, 10, 5);
    releaseAt(btn, 200, 200);
    expect(displayedTexture(btn)).toBe(normal);
    expect(onPress).not.toHaveBeenCalled();
    // The press was consumed — a later release inside must not retro-invoke.
    releaseAt(btn, 10, 5);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("a single-texture button (activeTexture null) never swaps frames but still resolves", () => {
    const { btn, normal, onPress } = makeButton({ activeTexture: null });
    pressAt(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(normal); // nil-guarded setDisplayFrame:activeFrame
    moveTo(btn, 200, 200);
    moveTo(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(normal);
    releaseAt(btn, 10, 5);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("plays the injected press sound exactly once per successful resolution, never on a miss", () => {
    const pressSound = vi.fn();
    const { btn, onPress } = makeButton({ pressSound });
    pressAt(btn, 10, 5);
    releaseAt(btn, 200, 200); // cancelled — no sound
    expect(pressSound).not.toHaveBeenCalled();
    pressAt(btn, 10, 5);
    releaseAt(btn, 10, 5);
    expect(pressSound).toHaveBeenCalledTimes(1);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("ButtonSprite drag re-arm (ccTouchMoved @ 0x599a4)", () => {
  it("dragging off reverts to the normal frame; dragging back on re-shows the active frame", () => {
    const { btn, normal, active } = makeButton();
    pressAt(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(active);
    moveTo(btn, 200, 200); // drag off -> normalFrame, still armed
    expect(displayedTexture(btn)).toBe(normal);
    moveTo(btn, 15, 8); // drag back on -> activeFrame
    expect(displayedTexture(btn)).toBe(active);
  });

  it("resolution stays on release-point containment: off, back on, release inside -> invokes", () => {
    const { btn, onPress } = makeButton();
    pressAt(btn, 0, 0);
    moveTo(btn, 200, 200);
    moveTo(btn, 15, 9);
    releaseAt(btn, 15, 9);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("dragging off and releasing outside never invokes", () => {
    const { btn, normal, onPress } = makeButton();
    pressAt(btn, 10, 5);
    moveTo(btn, 200, 200);
    releaseAt(btn, 200, 200);
    expect(displayedTexture(btn)).toBe(normal);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("moves while not pressed do nothing (ccTouchMoved only matters mid-press)", () => {
    const { btn, normal } = makeButton();
    moveTo(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(normal);
  });
});

describe("ButtonSprite claimed-pointer ownership (targeted swallowing delegate @ 0x595f8)", () => {
  it("lets only the claiming pointer control moved containment", () => {
    const { btn, normal, active } = makeButton();
    pressAt(btn, 10, 5, 11);

    moveTo(btn, 100, 100, 22);
    expect(displayedTexture(btn)).toBe(active);

    moveTo(btn, 100, 100, 11);
    expect(displayedTexture(btn)).toBe(normal);
  });

  it("ignores another pointer's release and invokes only for the claiming pointer", () => {
    const { btn, active, onPress } = makeButton();
    pressAt(btn, 10, 5, 11);
    pressAt(btn, 10, 5, 22);

    releaseAt(btn, 10, 5, 22);
    expect(displayedTexture(btn)).toBe(active);
    expect(onPress).not.toHaveBeenCalled();

    releaseAt(btn, 10, 5, 11);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("ignores another pointer's cancel but clears the claiming pointer without invoking", () => {
    const { btn, normal, active, onPress } = makeButton();
    pressAt(btn, 10, 5, 11);

    cancel(btn, 22);
    expect(displayedTexture(btn)).toBe(active);

    cancel(btn, 11);
    expect(displayedTexture(btn)).toBe(normal);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("does not swallow an unrelated pointer that began outside and later crosses the held button", () => {
    const { btn, active, onPress } = makeButton();
    pressAt(btn, 10, 5, 11);

    const foreignMove = emitPointer(btn, "globalpointermove", 10, 5, 22);
    const foreignUp = emitPointer(btn, "pointerup", 10, 5, 22);

    expect(foreignMove.stopPropagation).not.toHaveBeenCalled();
    expect(foreignUp.stopPropagation).not.toHaveBeenCalled();
    expect(displayedTexture(btn)).toBe(active);
    expect(onPress).not.toHaveBeenCalled();

    releaseAt(btn, 10, 5, 11);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("swallows an additional pointer that begins inside without transferring ownership", () => {
    const { btn, active, onPress } = makeButton();
    pressAt(btn, 10, 5, 11);

    const secondaryDown = emitPointer(btn, "pointerdown", 10, 5, 22);
    const secondaryMove = emitPointer(btn, "globalpointermove", 15, 5, 22);
    const secondaryUp = emitPointer(btn, "pointerup", 15, 5, 22);

    expect(secondaryDown.stopPropagation).toHaveBeenCalledTimes(1);
    expect(secondaryMove.stopPropagation).toHaveBeenCalledTimes(1);
    expect(secondaryUp.stopPropagation).toHaveBeenCalledTimes(1);
    expect(displayedTexture(btn)).toBe(active);
    expect(onPress).not.toHaveBeenCalled();

    releaseAt(btn, 10, 5, 11);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("ButtonSprite release containment (ccTouchEnded @ 0x59a40)", () => {
  it("a release far from the press point but inside the hit rect invokes", () => {
    const { btn, normal, onPress } = makeButton();
    pressAt(btn, 0, 0);
    releaseAt(btn, 15, 9);
    expect(displayedTexture(btn)).toBe(normal);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("a stationary release inside the hit rect invokes", () => {
    const { btn, onPress } = makeButton();
    pressAt(btn, 0, 0);
    releaseAt(btn, 0, 0);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("ButtonSprite enabled=false is fully inert", () => {
  it("detaches event delivery (eventMode none) so no press ever starts", () => {
    const { btn, normal, onPress } = makeButton();
    btn.enabled = false;
    expect((btn as unknown as { eventMode: string }).eventMode).toBe("none");
    pressAt(btn, 10, 5);
    releaseAt(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(normal);
    expect(onPress).not.toHaveBeenCalled();
  });

  it("belt-and-suspenders: even a stray direct event causes no visual, sound, or handler", () => {
    const pressSound = vi.fn();
    const { btn, normal, onPress } = makeButton({ pressSound });
    btn.enabled = false;
    const b = btn as unknown as { emit(e: string, a: unknown): void };
    b.emit("pointerdown", evt(10, 5));
    expect(displayedTexture(btn)).toBe(normal);
    b.emit("pointerup", evt(10, 5));
    expect(onPress).not.toHaveBeenCalled();
    expect(pressSound).not.toHaveBeenCalled();
  });

  it("a delivered disabled end restores the normal frame and invokes nothing", () => {
    const { btn, normal, active, onPress } = makeButton();
    pressAt(btn, 10, 5);
    expect(displayedTexture(btn)).toBe(active);
    btn.enabled = false;
    expect(displayedTexture(btn)).toBe(active);
    const b = btn as unknown as { emit(e: string, a: unknown): void };
    b.emit("pointerup", evt(10, 5));
    expect(displayedTexture(btn)).toBe(normal);
    expect(onPress).not.toHaveBeenCalled();
  });
});
