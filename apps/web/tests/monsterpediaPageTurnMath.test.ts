import { describe, expect, it } from "vitest";
import {
  MONSTERPEDIA_PAGE_TURN_GRID,
  buildMonsterpediaPageTurnMesh,
  monsterpediaPageTurnVertex,
} from "../src/world/monsterpediaPageTurnMath.js";

describe("Monsterpedia page-turn source math", () => {
  it.each([
    [0, 240, 160, 0.5],
    [0.25, 217.547990, 164.304764, 12.790194],
    [0.5, 167.540302, 173.120662, 21.051593],
    [0.75, 43.186261, 191.259112, 25.025823],
  ])("matches the recovered golden vertex at t=%s", (t, x, y, z) => {
    const actual = monsterpediaPageTurnVertex({ x: 240, y: 160, z: 0 }, t);
    expect(actual.x).toBeCloseTo(x, 5);
    expect(actual.y).toBeCloseTo(y, 5);
    expect(actual.z).toBeCloseTo(z, 5);
  });

  it("builds the exact 16x12 indexed landscape grid without endpoint NaNs", () => {
    const mesh = buildMonsterpediaPageTurnMesh(480, 320, 2, 1);
    const vertexCount =
      (MONSTERPEDIA_PAGE_TURN_GRID.columns + 1) *
      (MONSTERPEDIA_PAGE_TURN_GRID.rows + 1);
    expect(mesh.positions).toHaveLength(vertexCount * 2);
    expect(mesh.uvs).toHaveLength(vertexCount * 2);
    expect(mesh.depthRatios).toHaveLength(vertexCount);
    expect(mesh.clipDepths).toHaveLength(vertexCount);
    expect(mesh.indices).toHaveLength(16 * 12 * 2 * 3);
    expect(
      [...mesh.positions, ...mesh.depthRatios, ...mesh.clipDepths].every(Number.isFinite),
    ).toBe(true);
  });

  it("normalizes the same native grid into point space and covers both display tiers", () => {
    const normalized = buildMonsterpediaPageTurnMesh(480, 320, 2, 0.5);
    const native = buildMonsterpediaPageTurnMesh(960, 640, 1, 0.5);
    for (let index = 0; index < normalized.positions.length; index += 1) {
      expect(normalized.positions[index]! * 2).toBeCloseTo(native.positions[index]!, 4);
    }
    const ipad = buildMonsterpediaPageTurnMesh(512, 384, 2, 0.5);
    expect(
      [...ipad.positions, ...ipad.depthRatios, ...ipad.clipDepths].every(Number.isFinite),
    ).toBe(true);
  });
});
