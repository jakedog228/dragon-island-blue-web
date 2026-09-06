export const BLACK_MARKET_CLOSE_SPRITE_KEYS = [
  "PopupMenuCloseButton-hd",
  "PopupMenuCloseButton",
] as const;

export type BlackMarketCloseSpriteKey = typeof BLACK_MARKET_CLOSE_SPRITE_KEYS[number];

export interface SpriteAvailability {
  hasSprite(name: string): boolean;
}

/** Selects the one structural close sprite shared by the Black Market startup and modal paths. */
export function resolveBlackMarketCloseSpriteKey(
  assets: SpriteAvailability,
): BlackMarketCloseSpriteKey | undefined {
  for (const key of BLACK_MARKET_CLOSE_SPRITE_KEYS) {
    if (assets.hasSprite(key)) return key;
  }
  return undefined;
}
