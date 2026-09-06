import { Container, type Sprite, type Ticker } from "pixi.js";
import {
  Scale9,
  bitmapFontFile,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode } from "../displayMode.js";
import { dungeonFloorChatLayout } from "../dungeon/dungeonFloorChatMath.js";
import {
  showChainedTextChat,
  type ChainedTextChatHandle,
} from "../ui/chainedTextChat.js";








export type GuildQuestChatHandle = ChainedTextChatHandle;

export async function showGuildQuestChat(opts: {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly ticker: Ticker;
  readonly message: string;
  readonly portraitFile?: string;
  readonly onDismiss?: () => void;
}): Promise<GuildQuestChatHandle> {
  const layout = dungeonFloorChatLayout(DISPLAY_MODE);
  const screen = screenPointsForMode(DISPLAY_MODE);
  const portraitKey = opts.portraitFile === undefined
    ? undefined
    : spriteKey(opts.assets, opts.portraitFile);
  const [, background, finishTexture, portraitTexture] = await Promise.all([
    opts.assets.font(`${bitmapFontFile(layout.fontSize, true)}-hd`),
    Scale9.fromConfig(opts.scale9, "PopupBackgroundThin", opts.assets, layout.size),
    opts.assets.sprite(opts.assets.hasSprite("downArrow-hd") ? "downArrow-hd" : "downArrow"),
    portraitKey === undefined ? Promise.resolve(undefined) : opts.assets.sprite(portraitKey),
  ]);

  let portrait: Sprite | undefined;
  if (portraitTexture !== undefined && opts.portraitFile !== undefined) {
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
    rootLabel: "guildQuestChat",
    textLabel: "guildQuestChatText",
    finishLabel: "guildQuestChatFinish",
    ...(portrait === undefined ? {} : {
      portrait,
      portraitLabel: `guildQuestPortrait:${opts.portraitFile}`,
    }),
    ...(opts.onDismiss === undefined ? {} : { onDismiss: opts.onDismiss }),
  });
}

function spriteKey(assets: AssetLibrary, file: string): string {
  const stem = file.replace(/\.png$/i, "");
  return assets.hasSprite(`${stem}-hd`) ? `${stem}-hd` : stem;
}
