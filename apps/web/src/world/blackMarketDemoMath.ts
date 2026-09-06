import type { DisplayMode } from "../displayMode.js";

export interface BlackMarketDemoLayout {
  readonly label: { readonly x: number; readonly y: number; readonly fontSize: number };
  readonly cards: readonly {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}

/**
 * PORT ADAPTATION / DEMO CONTENT.
 *
 * The binary does not contain an illustrated Black Market card screen. These are deliberately
 * small, explicit layouts for the two-card demo and are not recovered BlackMarket constants.
 * Keeping both idioms literal makes the adaptation visible and prevents an iPhone layout from
 * silently becoming shared runtime geometry.
 */
const IPHONE_LAYOUT: BlackMarketDemoLayout = Object.freeze({
  label: Object.freeze({ x: 240, y: 24, fontSize: 22 }),
  cards: Object.freeze([
    Object.freeze({ x: 18, y: 50, width: 214, height: 254 }),
    Object.freeze({ x: 248, y: 50, width: 214, height: 254 }),
  ]),
});

const IPAD_LAYOUT: BlackMarketDemoLayout = Object.freeze({
  label: Object.freeze({ x: 256, y: 27, fontSize: 24 }),
  cards: Object.freeze([
    Object.freeze({ x: 22, y: 58, width: 229, height: 304 }),
    Object.freeze({ x: 261, y: 58, width: 229, height: 304 }),
  ]),
});

export function blackMarketDemoLayout(displayMode: DisplayMode): BlackMarketDemoLayout {
  return displayMode === "ipad" ? IPAD_LAYOUT : IPHONE_LAYOUT;
}
