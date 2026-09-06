import { Container } from "pixi.js";
import {
  packBox,
  type BoxBounds,
  type BoxItem,
  type BoxLayoutOpts,
  type BoxSize,
} from "./boxLayout.js";

export interface BoxOpts {

  horizontal?: boolean;

  gap?: number;

  positiveAlignDirection?: boolean;
  /** See `BoxLayoutOpts.roundingScale`; defaults to 1. */
  roundingScale?: number;
  /** Box.horizontalAlignment / verticalAlignment ivars @ 0xf4 / 0xf8 — see
   *  `BoxLayoutOpts.horizontalAlignment` for the decoded 0/1 semantics. Omit for the source's
   *  default 2 ("skip"), which leaves the pack loop's cross-centering in place. */
  horizontalAlignment?: 0 | 1;
  verticalAlignment?: 0 | 1;
}

interface BoxChildEntry {
  node: Container;
  gapBefore?: number;
  /** Authored Cocos `contentSize`, before the child's own scale. Pixi bounds can include
   * descendants that deliberately overflow that content box. */
  contentSize?: BoxSize;
}




















export class Box extends Container {
  horizontal: boolean;
  gap: number;
  positiveAlignDirection: boolean;
  roundingScale: number;
  /** undefined = the source's default 2 "skip" sentinel; see BoxOpts. */
  horizontalAlignment: 0 | 1 | undefined;
  verticalAlignment: 0 | 1 | undefined;

  private readonly boxChildren: BoxChildEntry[] = [];
  boxContentSize: BoxSize = { w: 0, h: 0 };
  /** Authored child-frame origin plus `boxContentSize`; never derived from descendant ink. */
  boxLayoutBounds: BoxBounds = { x: 0, y: 0, w: 0, h: 0 };

  constructor(opts: BoxOpts = {}) {
    super();
    this.horizontal = opts.horizontal ?? false;
    this.gap = opts.gap ?? 5.0;
    this.positiveAlignDirection = opts.positiveAlignDirection ?? false;
    this.roundingScale = opts.roundingScale ?? 1;
    this.horizontalAlignment = opts.horizontalAlignment;
    this.verticalAlignment = opts.verticalAlignment;
  }



  addBoxChild(node: Container, opts?: { gapBefore?: number; contentSize?: BoxSize }): void {
    this.addChild(node);
    this.boxChildren.push({
      node,
      ...(opts?.gapBefore === undefined ? {} : { gapBefore: opts.gapBefore }),
      ...(opts?.contentSize === undefined ? {} : { contentSize: opts.contentSize }),
    });
    this.layoutChildren();
  }











  removeBoxChild(node: Container): void {
    const idx = this.boxChildren.findIndex((c) => c.node === node);
    if (idx === -1) return;
    this.boxChildren.splice(idx, 1);
    this.removeChild(node);
  }

  /** Removes and destroys every tracked child — a full reset for callers that rebuild the box's
   *  contents from scratch (e.g. `EnemyTeamDisplay.initTeam` on rematch), since `boxChildren` is
   *  private tracked state that a plain `removeChildren()` on the Container wouldn't clear. */
  clearBoxChildren(): void {
    this.boxChildren.forEach(({ node }) => node.destroy({ children: true }));
    this.boxChildren.length = 0;
    this.removeChildren();
    this.layoutChildren();
  }





  layoutChildren(): void {
    const items: BoxItem[] = this.boxChildren.map(({ node, gapBefore, contentSize }) => {
      const measured = contentSize
        ? contentSize
        : (() => {
            const bounds = node.getLocalBounds();
            return { w: bounds.width, h: bounds.height };
          })();
      const w = measured.w * node.scale.x;
      const h = measured.h * node.scale.y;
      return gapBefore === undefined ? { w, h } : { w, h, gapBefore };
    });
    const layoutOpts: BoxLayoutOpts = {
      horizontal: this.horizontal,
      gap: this.gap,
      positiveAlignDirection: this.positiveAlignDirection,
      roundingScale: this.roundingScale,
      ...(this.horizontalAlignment === undefined ? {} : { horizontalAlignment: this.horizontalAlignment }),
      ...(this.verticalAlignment === undefined ? {} : { verticalAlignment: this.verticalAlignment }),
    };
    const { offsets, contentSize, layoutBounds } = packBox(items, layoutOpts);
    this.boxChildren.forEach(({ node }, i) => {
      const o = offsets[i]!;
      // `packBox` emits where the child's INK must begin (boxLayout.ts header). Pixi children
      // normally start their ink at their own origin, but a negative-direction Box lays its own
      // descendants out behind it, so subtract that authored origin back out — the port-frame
      // equivalent of the source's nested-Box arm, whose `±contentSize` / `±contentSize/2` terms
      // exist for exactly this case (`-[Box layoutChildren] @ 0x5865c`, followup-layout.md
      // §1.3a). Zero for every plain node and for positive-direction Boxes.
      const ink = node instanceof Box ? node.boxLayoutBounds : undefined;
      node.position.set(
        o.x - (ink ? ink.x * node.scale.x : 0),
        o.y - (ink ? ink.y * node.scale.y : 0),
      );
    });
    this.boxContentSize = contentSize;
    this.boxLayoutBounds = layoutBounds;
  }
}
