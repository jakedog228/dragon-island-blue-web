


export interface BoxItem {
  w: number;
  h: number;
  /** Models a GapNode child inserted at this slot (followup-layout.md §1.3/§1.5): replaces the
   *  uniform `gap` for the transition immediately before this item instead of stacking with it. */
  gapBefore?: number;
}

export interface BoxLayoutOpts {
  /** Box.horizontal ivar @ 0xf4 — true packs along width (x), false packs along height (y). */
  horizontal: boolean;

  gap: number;


  positiveAlignDirection: boolean;
  /** Number of source-device points represented by one caller-space point. Box rounds in native
   * source coordinates before converting back, preserving normalized iPad half-points such as
   * `(200 + bare 5) / 2 = 102.5`. Defaults to 1. */
  roundingScale?: number;




















  horizontalAlignment?: 0 | 1;
  verticalAlignment?: 0 | 1;
}

export interface BoxOffset {
  x: number;
  y: number;
}

export interface BoxSize {
  w: number;
  h: number;
}

export interface BoxBounds extends BoxSize {
  x: number;
  y: number;
}

export interface BoxPackResult {
  offsets: BoxOffset[];
  contentSize: BoxSize;
  /** The source-authored frame in this port's local coordinates. Unlike a Pixi
   *  `getLocalBounds()`, this includes transparent/unused space inside each child's
   *  `scaledContentSize` and therefore cannot move when a sprite's painted pixels change. */
  layoutBounds: BoxBounds;
}






function roundf(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}














export function packBox(items: BoxItem[], opts: BoxLayoutOpts): BoxPackResult {
  const roundingScale = opts.roundingScale ?? 1;
  if (!Number.isFinite(roundingScale) || roundingScale <= 0) {
    throw new Error(`Box roundingScale must be finite and positive, got ${roundingScale}`);
  }
  const sourceRound = (value: number): number => roundf(value * roundingScale) / roundingScale;
  const sign = opts.positiveAlignDirection ? 1 : -1;
  let running = 0;
  let crossMax = 0;
  const primaryOffsets: number[] = [];

  const crossSizes: number[] = [];
  items.forEach((item, i) => {
    const primarySize = opts.horizontal ? item.w : item.h;
    const crossSize = opts.horizontal ? item.h : item.w;
    if (i > 0) {
      const gap = item.gapBefore ?? opts.gap;
      running += gap * sign;
    }
    // Near edge of the child's own interval: `running` going up, `running - size` going down.
    primaryOffsets.push(sign > 0 ? running : running - primarySize);
    crossSizes.push(crossSize);
    running += primarySize * sign;
    if (crossSize > crossMax) crossMax = crossSize;
  });














  const primaryAlignment = opts.horizontal ? opts.horizontalAlignment : opts.verticalAlignment;
  if (primaryAlignment !== undefined) {
    throw new Error(
      `Box ${opts.horizontal ? "horizontal" : "vertical"}Alignment aligns the PRIMARY axis of this box; ` +
        "the source's packed-run displacement for that case is unported (followup-layout.md §1.4)",
    );
  }
  const crossAlignment = opts.horizontal ? opts.verticalAlignment : opts.horizontalAlignment;
  const crossOffset = (childCross: number): number =>
    crossAlignment === undefined
      ? (crossMax - childCross) / 2
      : crossAlignment === 0
        ? 0
        : crossMax - childCross;

  const offsets: BoxOffset[] = primaryOffsets.map((v, i) => {
    const p = sourceRound(v);
    const c = sourceRound(crossOffset(crossSizes[i]!));
    return opts.horizontal ? { x: p, y: c } : { x: c, y: p };
  });

  // `primaryExtent = |runningAfterLastChild - gap*sign|`, where the source's running offset
  // carries a TRAILING gap it then subtracts back off (hence N children ⇒ N−1 gaps, which is
  // what `running` already holds here). With NO children it has no trailing gap to remove, so
  // the subtraction runs anyway and an empty Box measures exactly one `gap` on its primary axis
  // — `q7:8` and the cross max are zeroed before the `if (count != 0)` enumeration guard
  // (`-[Box layoutChildren] @ 0x5865c`), and the tail is unguarded. The single-participant XP
  // grid builds four such boxes for its empty column; there they only feed a cross-axis max.
  const primaryExtent = sourceRound(items.length === 0 ? Math.abs(opts.gap) : Math.abs(running));
  const crossExtent = sourceRound(crossMax);
  const contentSize: BoxSize = opts.horizontal
    ? { w: primaryExtent, h: crossExtent }
    : { w: crossExtent, h: primaryExtent };
  // Positive-direction boxes start at zero; negative-direction boxes run from `-primaryExtent`
  // up to the origin, because each child ENDS at its running offset (see the header). Either way
  // the packed run now covers exactly `contentSize` from this origin — an invariant the old
  // "first child at 0" emission only held for equal-size children. Keep that authored origin
  // separately: consumers occasionally need to rebase a Box without consulting descendant ink
  // bounds (notably performAwardLogic's XP grid).
  const layoutBounds: BoxBounds = offsets.length === 0
    ? { x: 0, y: 0, w: 0, h: 0 }
    : {
        x: Math.min(...offsets.map((offset) => offset.x)),
        y: Math.min(...offsets.map((offset) => offset.y)),
        w: contentSize.w,
        h: contentSize.h,
      };

  return { offsets, contentSize, layoutBounds };
}
