// Shared display-mode-agnostic coordinate mapping for the browser scenario harnesses.
// Reads the structured geometry `render_game_to_text` exposes (stagePx = FixedStage logical
// pixels, screenPt = battle points) instead of hardcoding the 960x640 iPhone tier, so the
// scenarios keep working with either persisted display-mode selection.

/** Returns { stagePx, screenPt, displayMode, scale, offsetX, offsetY, toCss } for the given
 *  canvas bounding box. `toCss({x,y})` maps BATTLE POINTS -> CSS page coordinates (points are
 *  mounted x2 on the logical stage, which is letterbox-fit into the canvas). */
export async function stageGeometry(page, box) {
  const g = await page.evaluate(() => {
    const s = JSON.parse(window.render_game_to_text());
    if (!s.stagePx || !s.screenPt) throw new Error("render_game_to_text lacks stagePx/screenPt");
    return { stagePx: s.stagePx, screenPt: s.screenPt, displayMode: s.displayMode };
  });
  const scale = Math.min(box.width / g.stagePx.w, box.height / g.stagePx.h);
  const offsetX = (box.width - g.stagePx.w * scale) / 2;
  const offsetY = (box.height - g.stagePx.h * scale) / 2;
  const toCss = (point) => ({
    x: box.x + offsetX + point.x * 2 * scale,
    y: box.y + offsetY + point.y * 2 * scale,
  });
  return { ...g, scale, offsetX, offsetY, toCss };
}
