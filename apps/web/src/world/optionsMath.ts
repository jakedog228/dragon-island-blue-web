import type { DisplayMode } from "../displayMode.js";
import { idiomPairPt, unscaledIdiomPt } from "../displayMode.js";

export function optionsLayout(mode: DisplayMode) {
  return {
    fontSize: idiomPairPt(16, 30, mode),
    labelX: unscaledIdiomPt(50, mode),
    controlX: idiomPairPt(120, 240, mode),
    rowGap: idiomPairPt(40, 80, mode),
    numberGap: idiomPairPt(40, 60, mode),
    // Port adaptation for two-choice display/text rows; derived from the source number-row gap.
    portChoiceGap: idiomPairPt(40, 60, mode) / 2,
    // Existing outlineFadeBackgroundNode visual approximation; the exact source pixels remain debt.
    outlineWidth: unscaledIdiomPt(2, mode),
  };
}
