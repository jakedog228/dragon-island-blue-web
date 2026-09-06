export const MONSTERPEDIA_PAGE_TURN_GRID = { columns: 16, rows: 12 } as const;
export const MONSTERPEDIA_PAGE_TURN_DURATION_MS = 200;
export const MONSTERPEDIA_PAGE_TURN_Z_EYE_DIVISOR = 1.1566;
export const MONSTERPEDIA_PAGE_TURN_NEAR = 0.5;
export const MONSTERPEDIA_PAGE_TURN_FAR = 1500;
const ENDPOINT_EPSILON = 1e-6;

export interface PageTurnVertex {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}


export function monsterpediaPageTurnVertex(
  original: Readonly<PageTurnVertex>,
  progress: number,
): PageTurnVertex {
  const t = Math.min(1 - ENDPOINT_EPSILON, Math.max(0, progress));
  const tt = Math.max(0, t - 0.25);
  const ay = -100 - tt * tt * 500;
  const theta = (Math.PI / 2) * (1 - Math.sqrt(t));
  const sinTheta = Math.sin(theta);
  const cosTheta = Math.cos(theta);
  const dy = original.y - ay;
  const radius = Math.hypot(original.x, dy);
  const curledRadius = radius * sinTheta;
  const alpha = Math.asin(original.x / radius);
  const beta = alpha / sinTheta;
  const cosBeta = Math.cos(beta);
  const curl = curledRadius * (1 - cosBeta);

  return {
    x: beta <= Math.PI ? curledRadius * Math.sin(beta) : 0,
    y: radius + ay - curl * sinTheta,
    z: Math.max((curl * cosTheta) / 7, 0.5),
  };
}

/**
 * Applies the source 60-degree perspective camera centered on the native-pixel page.
 * `depthRatio` is clip-space W and must be retained by the shader for perspective-correct UVs.
 */
export function projectMonsterpediaPageTurnVertex(
  vertex: Readonly<PageTurnVertex>,
  widthPx: number,
  heightPx: number,
): {
  readonly x: number;
  readonly y: number;
  readonly depthRatio: number;
  readonly clipZ: number;
} {
  const zEye = heightPx / MONSTERPEDIA_PAGE_TURN_Z_EYE_DIVISOR;
  const depth = zEye - vertex.z;
  const halfHeightAtDepth = depth * Math.tan(Math.PI / 6);
  const aspect = widthPx / heightPx;
  const ndcX = (vertex.x - widthPx / 2) / (halfHeightAtDepth * aspect);
  const ndcY = (vertex.y - heightPx / 2) / halfHeightAtDepth;
  return {
    x: (ndcX + 1) * widthPx / 2,
    y: (ndcY + 1) * heightPx / 2,
    depthRatio: depth / zEye,
    clipZ:
      (
        (MONSTERPEDIA_PAGE_TURN_FAR + MONSTERPEDIA_PAGE_TURN_NEAR) /
          (MONSTERPEDIA_PAGE_TURN_FAR - MONSTERPEDIA_PAGE_TURN_NEAR) -
        (
          2 * MONSTERPEDIA_PAGE_TURN_FAR * MONSTERPEDIA_PAGE_TURN_NEAR /
          (MONSTERPEDIA_PAGE_TURN_FAR - MONSTERPEDIA_PAGE_TURN_NEAR)
        ) / depth
      ) * (depth / zEye),
  };
}

export interface MonsterpediaPageTurnMeshData {
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
  readonly depthRatios: Float32Array;
  readonly clipDepths: Float32Array;
  readonly indices: Uint32Array;
}

/** Builds the source 16x12 landscape grid in Pixi point/Y-down coordinates. */
export function buildMonsterpediaPageTurnMesh(
  widthPt: number,
  heightPt: number,
  nativePixelsPerPoint: number,
  progress: number,
): MonsterpediaPageTurnMeshData {
  const { columns, rows } = MONSTERPEDIA_PAGE_TURN_GRID;
  const vertexCount = (columns + 1) * (rows + 1);
  const positions = new Float32Array(vertexCount * 2);
  const uvs = new Float32Array(vertexCount * 2);
  const depthRatios = new Float32Array(vertexCount);
  const clipDepths = new Float32Array(vertexCount);
  const widthPx = widthPt * nativePixelsPerPoint;
  const heightPx = heightPt * nativePixelsPerPoint;

  let vertexIndex = 0;
  for (let row = 0; row <= rows; row += 1) {
    const v = row / rows;
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const sourceY = heightPx * (1 - v);
      const deformed = monsterpediaPageTurnVertex(
        { x: widthPx * u, y: sourceY, z: 0 },
        progress,
      );
      const projected = projectMonsterpediaPageTurnVertex(deformed, widthPx, heightPx);
      positions[vertexIndex * 2] = projected.x / nativePixelsPerPoint;
      positions[vertexIndex * 2 + 1] =
        heightPt - projected.y / nativePixelsPerPoint;
      uvs[vertexIndex * 2] = u;
      uvs[vertexIndex * 2 + 1] = v;
      depthRatios[vertexIndex] = projected.depthRatio;
      clipDepths[vertexIndex] = projected.clipZ;
      vertexIndex += 1;
    }
  }

  const indices = new Uint32Array(columns * rows * 6);
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * (columns + 1) + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + columns + 1;
      const bottomRight = bottomLeft + 1;
      indices[index++] = topLeft;
      indices[index++] = bottomLeft;
      indices[index++] = topRight;
      indices[index++] = topRight;
      indices[index++] = bottomLeft;
      indices[index++] = bottomRight;
    }
  }

  return { positions, uvs, depthRatios, clipDepths, indices };
}
