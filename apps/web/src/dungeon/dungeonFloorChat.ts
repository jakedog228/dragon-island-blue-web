import { Container, type Sprite, type Ticker } from "pixi.js";
import {
  Scale9,
  bitmapFontFile,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { DisplayMode } from "../displayMode.js";
import { screenPointsForMode } from "../displayMode.js";
import {
  showChainedTextChat,
  type ChainedTextChatHandle,
} from "../ui/chainedTextChat.js";
import {
  dungeonFloorChatLayout,
  type DungeonFloorDetectionChatKey,
} from "./dungeonFloorChatMath.js";

export type { DungeonFloorDetectionChatKey } from "./dungeonFloorChatMath.js";

export async function showDungeonFloorDetectionChat(opts: {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly ticker: Ticker;
  readonly mode: DisplayMode;
  readonly key: DungeonFloorDetectionChatKey;
  readonly message: string;
  readonly onDismiss?: () => void;
}): Promise<ChainedTextChatHandle> {
  const layout = dungeonFloorChatLayout(opts.mode);
  const screen = screenPointsForMode(opts.mode);
  const [, background, finishTexture, portraitTexture] = await Promise.all([
    opts.assets.font(`${bitmapFontFile(layout.fontSize, true)}-hd`),
    Scale9.fromConfig(
      opts.scale9,
      "PopupBackgroundThin",
      opts.assets,
      layout.size,
    ),
    opts.assets.sprite(opts.assets.hasSprite("downArrow-hd") ? "downArrow-hd" : "downArrow"),
    opts.key === "DungeonBreederDetected"
      ? opts.assets.sprite(opts.assets.hasSprite("ClerkGirl-hd") ? "ClerkGirl-hd" : "ClerkGirl")
      : Promise.resolve(undefined),
  ]);

  let portrait: Sprite | undefined;
  if (portraitTexture !== undefined) {
    portrait = pointSprite(portraitTexture);
    portrait.anchor.set(0, 1);
  }

  return showChainedTextChat({
    parent: opts.parent,
    ticker: opts.ticker,
    background,
    finishTexture,
    message: opts.message,
    fontSize: layout.fontSize,
    size: layout.size,
    position: layout.position,
    screen,
    rootLabel: "dungeonFloorDetectionChat",
    textLabel: `dungeonFloorDetectionText:${opts.key}`,
    finishLabel: "dungeonFloorDetectionFinish",
    ...(portrait === undefined ? {} : {
      portrait,
      portraitLabel: "dungeonFloorDetectionPortrait:ClerkGirl",
    }),
    ...(opts.onDismiss === undefined ? {} : { onDismiss: opts.onDismiss }),
  });
}
