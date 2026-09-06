/**
 * Presentation-quality control for canvas TTF labels (`makeTtfLabel` / `CCLabelTTF`).
 *
 * The battle scene is authored for a fixed logical stage (960×640 / 1024×768) and then
 * letterboxed into the browser viewport. Pixi's default Text auto-resolution only tracks
 * `devicePixelRatio`, so any letterbox scale > 1 upsamples a low-density text texture and
 * looks soft on large monitors. Bitmap fonts (status dialog, HP fractions) are out of
 * scope — they are fixed shipped atlases.
 *
 * - `"original"`: leave Pixi auto-resolution alone (retina-era density; default).
 * - `"modern"`: bake each TTF label at `devicePixelRatio × max(1, presentationScale)` so
 *   letterbox upscale does not soften glyphs. Layout/world size is unchanged (resolution
 *   only densifies the texture).
 *
 * Mode is process-global so `apps/web` can apply the persisted setting at boot without
 * threading an option through every call site. Presentation scale is updated from
 * `FixedStage`'s letterbox fit.
 */

export type TtfTextResolutionMode = "original" | "modern";

let mode: TtfTextResolutionMode = "original";
/** Current FixedStage letterbox scale (CSS stage size / logical stage size). */
let presentationScale = 1;

/** Boot/config entry: select original (source density) vs modern (display-sharp) TTF bakes. */
export function configureTtfTextResolution(next: TtfTextResolutionMode): void {
  if (next !== "original" && next !== "modern") {
    throw new Error(`configureTtfTextResolution: unsupported mode "${String(next)}"`);
  }
  mode = next;
}

/** Letterbox / outer-stage scale for modern bake density. Fail-loud on non-positive values. */
export function setTtfTextPresentationScale(scale: number): void {
  if (!(scale > 0) || !Number.isFinite(scale)) {
    throw new Error(`setTtfTextPresentationScale: expected positive finite scale, got ${scale}`);
  }
  presentationScale = scale;
}

export function ttfTextResolutionMode(): TtfTextResolutionMode {
  return mode;
}

export function ttfTextPresentationScale(): number {
  return presentationScale;
}

/**
 * Pure bake resolution for a TTF label.
 * @returns `null` when the caller should leave Pixi auto-resolution alone (`"original"`).
 */
export function ttfBakeResolution(
  resolutionMode: TtfTextResolutionMode,
  devicePixelRatio: number,
  letterboxScale: number,
): number | null {
  if (resolutionMode === "original") return null;
  const dpr = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const scale = letterboxScale > 0 && Number.isFinite(letterboxScale) ? letterboxScale : 1;
  // Floor scale at 1 so a tiny (letterbox < 1) window never bakes lower than the auto path.
  return dpr * Math.max(1, scale);
}

/** Live resolution for `makeTtfLabel` construction (reads module mode + presentation scale). */
export function currentTtfBakeResolution(): number | null {
  const dpr =
    typeof globalThis.devicePixelRatio === "number" && globalThis.devicePixelRatio > 0
      ? globalThis.devicePixelRatio
      : 1;
  return ttfBakeResolution(mode, dpr, presentationScale);
}
