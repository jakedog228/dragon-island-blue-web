import { Container, Rectangle } from "pixi.js";
import { CONTENT_SCALE_FACTOR } from "./scale9.js";
import {
  OUTLINE_PLAIN_ALPHA,
  outlineRenderTextureBounds,
  outlineSampleOffsets,
} from "./outlineBackgroundMath.js";

export * from "./outlineBackgroundMath.js";

export interface OutlineBackgroundSpec {
  /** Builds one stamp of the outlined node's own content, in the node's local frame. */
  readonly sample: (index: number) => Container;
  /** Source node `contentSize`, excluding the outline itself, in caller-local points. */
  readonly contentSize: Readonly<{ w: number; h: number }>;
  /** Native Cocos points represented by one caller-local point (1 iPhone, 2 normalized iPad). */
  readonly sourcePointsPerLocalPoint: number;
  /** `borderWidth` in points — the stamp circle's radius, not a stroke half-width. */
  readonly radiusPt: number;
  /** ccColor3B passed to the outline's `setColor:`. */
  readonly color: number;
  /** Outline sprite opacity / 255. `outlineFadeBackgroundNode` uses 128/255. */
  readonly alpha?: number;
  readonly label?: string;
}

/**
 * Builds the flattened outline background. The result is positioned in the SAME local frame as the
 * stamps, so a caller that stamps its own content node's copies can add this at the content
 * node's own position (the original's equivalent is a centre-anchored render texture placed at
 * `contentSize * 0.5`; both land the outline concentric with the content).
 */
export function outlineBackgroundNode(spec: OutlineBackgroundSpec): Container {
  const root = new Container();
  root.label = spec.label ?? "outlineBackground";
  root.blendMode = "normal";
  const bounds = outlineRenderTextureBounds(
    spec.contentSize,
    spec.radiusPt,
    spec.sourcePointsPerLocalPoint,
  );
  // Pixi otherwise ceils the stamps' inferred bounds. Native allocates and centres its integer
  // render target first (Bitewing is 96x67 source points, not an inferred 96x68).
  root.boundsArea = new Rectangle(bounds.x, bounds.y, bounds.w, bounds.h);
  outlineSampleOffsets(spec.radiusPt).forEach((offset, index) => {
    const sample = spec.sample(index);
    sample.tint = spec.color;


    sample.blendMode = "add-npm";
    // Native stamps at `border + anchor*content + circle`, then centers the integer render target
    // on `content/2`. Preserve the fractional residual left by truncation (Bitewing: +0.25pt Y).
    sample.position.set(
      bounds.x + spec.radiusPt + offset.x,
      bounds.y + spec.radiusPt + offset.y,
    );
    root.addChild(sample);
  });
  root.cacheAsTexture({ resolution: CONTENT_SCALE_FACTOR, scaleMode: "nearest", antialias: false });
  root.alpha = spec.alpha ?? OUTLINE_PLAIN_ALPHA;
  return root;
}
