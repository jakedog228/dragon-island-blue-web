import { describe, expect, it } from "vitest";
import { installGameSurfaceGuards } from "../src/gameSurface.js";
import { LifecycleScope } from "../src/lifecycle.js";

/** Stand-in for the Pixi DOM canvas: `HTMLCanvasElement` satisfies the same structural contract. */
class FakeSurface extends EventTarget {
  draggable = true;
}

const dispatch = (surface: EventTarget, type: string): boolean => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  surface.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("installGameSurfaceGuards", () => {
  it("cancels the browser default actions that can claim a press or drag", () => {
    const surface = new FakeSurface();
    installGameSurfaceGuards(surface, new LifecycleScope());

    expect(surface.draggable).toBe(false);
    expect(dispatch(surface, "contextmenu")).toBe(true);
    expect(dispatch(surface, "selectstart")).toBe(true);
    expect(dispatch(surface, "dragstart")).toBe(true);
  });

  it("leaves gameplay input events alone", () => {
    const surface = new FakeSurface();
    installGameSurfaceGuards(surface, new LifecycleScope());

    expect(dispatch(surface, "pointerdown")).toBe(false);
    expect(dispatch(surface, "touchstart")).toBe(false);
    expect(dispatch(surface, "pointermove")).toBe(false);
  });

  it("keeps dispatching to later listeners: propagation must reach Pixi and the scenes", () => {
    const surface = new FakeSurface();
    installGameSurfaceGuards(surface, new LifecycleScope());
    let observed = 0;
    surface.addEventListener("contextmenu", () => observed++);

    expect(dispatch(surface, "contextmenu")).toBe(true);
    expect(observed).toBe(1);
  });

  it("releases every listener on disposal so a renderer restart cannot accumulate them", () => {
    const surface = new FakeSurface();
    const lifecycle = new LifecycleScope();
    installGameSurfaceGuards(surface, lifecycle);
    installGameSurfaceGuards(surface, lifecycle);

    lifecycle.dispose();

    expect(dispatch(surface, "contextmenu")).toBe(false);
    expect(dispatch(surface, "selectstart")).toBe(false);
    expect(dispatch(surface, "dragstart")).toBe(false);
  });
});
