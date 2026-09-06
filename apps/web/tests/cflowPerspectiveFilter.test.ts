import { describe, expect, it, vi } from "vitest";

describe("CflowPerspectiveFilter", () => {
  it("uses current transforms on the first frame of a rebuilt card", async () => {
    vi.stubGlobal("navigator", { userAgent: "" });
    const [{ Container, Shader, Sprite, Texture }, { CflowPerspectiveFilter }] = await Promise.all([
      import("pixi.js"),
      import("../src/battle/cflowPerspectiveFilter.js"),
    ]);
    const shaderFrom = vi.spyOn(Shader, "from").mockReturnValue({
      texture: Texture.EMPTY,
      destroy: vi.fn(),
    } as never);
    const screenRoot = new Container({ isRenderGroup: true });
    screenRoot.position.set(20, 30);
    screenRoot.scale.set(2);

    const carousel = new Container();
    carousel.position.set(240, 110);
    screenRoot.addChild(carousel);

    const card = new Container();
    card.addChild(new Sprite(Texture.EMPTY));
    const perspective = new CflowPerspectiveFilter(
      card,
      screenRoot,
      { w: 480, h: 320 },
      "iphone",
    );

    // PartyEditorNode constructs the perspective owner before attaching and laying out the card.
    carousel.addChild(card);
    card.position.set(40, 0);

    const stalePivot = card.toGlobal({ x: 0, y: 40 }, undefined, true);
    const currentPivot = card.toGlobal({ x: 0, y: 40 });
    expect(stalePivot.x).toBe(0);
    expect(currentPivot.x).toBe(580);

    card.onRender?.(undefined as never);

    const cameraState = perspective as unknown as {
      pivotEyeSinCos: Float32Array;
      cameraFocalEpsilon: Float32Array;
    };
    expect(cameraState.pivotEyeSinCos[0]).toBe(currentPivot.x);
    expect(cameraState.cameraFocalEpsilon[0]).toBe(500);
    expect(cameraState.cameraFocalEpsilon[1]).toBe(350);

    perspective.destroy();
    screenRoot.destroy({ children: true });
    shaderFrom.mockRestore();
    vi.unstubAllGlobals();
  });
});
