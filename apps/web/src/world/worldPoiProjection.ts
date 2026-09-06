import type { WorldPoiState } from "@dib/engine";

export type WorldPoiProjection =
  | {
      readonly materialized: true;
      readonly renderedState: Exclude<WorldPoiState, 3>;
      readonly renderedTextureKey: string;
    }
  | {
      readonly materialized: false;
      readonly renderedState: null;
      readonly renderedTextureKey: null;
    };

const STATE_TEXTURE_KEYS: Record<Exclude<WorldPoiState, 3>, string> = {
  0: "greenFlag-hd",
  1: "redFlag-hd",
  2: "blueFlag-hd",
  4: "walkArrow",
};

/** Canonical persistent-Pixi equivalent of native `POINode.setState:` sprite replacement. */
export function projectWorldPoiState(
  logicalState: WorldPoiState,
  routeBlocked: boolean,
): WorldPoiProjection {
  if (logicalState === 3 || routeBlocked) {
    return {
      materialized: false,
      renderedState: null,
      renderedTextureKey: null,
    };
  }
  return {
    materialized: true,
    renderedState: logicalState,
    renderedTextureKey: STATE_TEXTURE_KEYS[logicalState],
  };
}
