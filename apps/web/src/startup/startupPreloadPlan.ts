import { resolveBlackMarketCloseSpriteKey } from "../world/blackMarketCloseSprite.js";
import type { StartupLoadTask } from "./startupSequence.js";

interface StartupSpriteAssets {
  hasSprite(name: string): boolean;
  sprite(name: string): Promise<unknown>;
}

/**
 * Builds the structural sprite tasks used by the real application startup sequence.
 * The Black Market close sprite is selected from the package rather than assuming the HD name.
 */
export function createStartupSpritePreloadTasks(
  assets: StartupSpriteAssets,
): StartupLoadTask[] {
  const closeSpriteKey = resolveBlackMarketCloseSpriteKey(assets);
  if (closeSpriteKey === undefined) {
    throw new Error(
      "Black Market startup requires PopupMenuCloseButton-hd or PopupMenuCloseButton",
    );
  }
  return [
    "saveSlotBackground",
    "PopupMenuButton2-hd",
    "PopupBackgroundThin-hd",
    "ClerkGirl-hd",
    "TutorialRightSide-hd",
    "MMScreen",
    closeSpriteKey,
    "inBattingOrderBkg-hd",
    "sleepZ-hd",
    "confusionStatus-hd",
    "paralyzeBolt-hd",
  ].map((key) => ({
    label: `sprite ${key}`,
    run: async (): Promise<void> => { await assets.sprite(key); },
  }));
}
