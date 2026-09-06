import {
  ColorMatrixFilter,
  Container,
  Rectangle,
  Sprite,
  type Ticker,
} from "pixi.js";
import {
  createRenderableSpriteNode,
  makeTtfLabel,
  minimumHitRectLocal,
  pointSprite,
  type AssetLibrary,
} from "@dib/renderer";
import type { DungeonDefinition } from "@dib/gamedata/dungeon";
import type { DungeonCatchQuestProgress } from "@dib/engine/dungeon";
import type { LoadedGame } from "../loadGame.js";
import type { AudioPlayer } from "../audio.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { idiomPairPt, roundSourcePoint, screenPointsForMode } from "../displayMode.js";
import {
  Popup,
} from "../ui/popup.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  localizedString,
} from "../localization.js";
import { SourceFlashingSprite } from "../ui/flashingSprite.js";

let MONSTER_TARGET_PT = idiomPairPt(80, 160, DISPLAY_MODE);
let MONSTER_GAP_PT = idiomPairPt(15, 30, DISPLAY_MODE);
let CONTENT_GAP_PT = idiomPairPt(30, 60, DISPLAY_MODE);
let HEADING_FONT_PT = idiomPairPt(19, 38, DISPLAY_MODE);






let OUTLINE_RADIUS_PT = idiomPairPt(3, 6, DISPLAY_MODE);




let CLOSE_OFFSET_Y_PT = roundSourcePoint(0.4 * screenPointsForMode(DISPLAY_MODE).h, DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  MONSTER_TARGET_PT = idiomPairPt(80, 160, DISPLAY_MODE);
  MONSTER_GAP_PT = idiomPairPt(15, 30, DISPLAY_MODE);
  CONTENT_GAP_PT = idiomPairPt(30, 60, DISPLAY_MODE);
  HEADING_FONT_PT = idiomPairPt(19, 38, DISPLAY_MODE);
  OUTLINE_RADIUS_PT = idiomPairPt(3, 6, DISPLAY_MODE);
  CLOSE_OFFSET_Y_PT = roundSourcePoint(
    0.4 * screenPointsForMode(DISPLAY_MODE).h,
    DISPLAY_MODE,
  );
});

export interface DungeonCatchQuestDisplayOptions {
  readonly parent: Container;
  readonly owner: object;
  readonly game: LoadedGame;
  readonly audio: AudioPlayer;
  readonly ticker: Ticker;
  readonly definition: DungeonDefinition;
  readonly progress: DungeonCatchQuestProgress | undefined;
  readonly onClaim: () => void | Promise<void>;
}

/** Source `CatchQuestDisplay` modal, including its claim-on-close completion behavior. */
export async function showDungeonCatchQuestDisplay(
  options: DungeonCatchQuestDisplayOptions,
): Promise<void> {
  if (options.progress === undefined) {
    await showMessagePopup(options, "NoCatchQuest");
    return;
  }
  const { progress } = options;
  const claimable = progress.complete && !progress.rewardCollected;
  const heading = makeTtfLabel(
    localizedString(
      options.game.strings,
      claimable || progress.rewardCollected
        ? "CatchQuestFinishedKey"
        : "CatchQuestNotFinishedKey",
    ),
    HEADING_FONT_PT,
    { outline: false },
  );
  heading.label = "catchQuestHeading";

  const row = new Container();
  row.label = "catchQuestMonsterRow";
  const captured = new Set(progress.captured);
  let rowX = 0;
  for (const shortType of progress.required) {
    const portrait = await buildQuestPortrait(options.game.assets, options.game, shortType);
    portrait.position.set(rowX, 0);
    portrait.eventMode = "static";
    portrait.cursor = "pointer";
    portrait.hitArea = new Rectangle(0, 0, MONSTER_TARGET_PT, MONSTER_TARGET_PT);
    portrait.on("pointertap", (event) => {
      event.stopPropagation();
      void showMessagePopup(
        options,
        captured.has(shortType) ? "HaveCatchQuestMonster" : "NotHaveCatchQuestMonster",
      );
    });
    if (!captured.has(shortType)) {
      const original = portrait.getChildByLabel(`catchQuestOriginal:${shortType}`);
      if (original instanceof Container) {
        for (const child of original.children) {
          if (child instanceof Sprite) child.tint = 0x000000;
        }
      }
    }
    row.addChild(portrait);
    rowX += MONSTER_TARGET_PT + MONSTER_GAP_PT;
  }
  const rowWidth = Math.max(0, rowX - MONSTER_GAP_PT);

  const chestTexture = await dungeonThemeFrame(options.game, options.definition, "chest.png");
  const chest = pointSprite(chestTexture);
  chest.label = claimable ? "catchQuestClaimChest" : "catchQuestChest";
  chest.eventMode = claimable ? "static" : "none";
  chest.cursor = claimable ? "pointer" : "default";
  const chestBounds = chest.getLocalBounds();
  const chestHit = minimumHitRectLocal(
    { x: chestBounds.x, y: chestBounds.y, w: chestBounds.width, h: chestBounds.height },
    chest.scale,
  );
  chest.hitArea = new Rectangle(chestHit.x, chestHit.y, chestHit.w, chestHit.h);

  const contentWidth = Math.max(heading.width, chest.width, rowWidth);
  const content = new Container();
  content.label = "catchQuestDisplay";
  heading.position.set((contentWidth - heading.width) / 2, 0);
  chest.position.set((contentWidth - chest.width) / 2, heading.height + CONTENT_GAP_PT);
  row.position.set(
    (contentWidth - rowWidth) / 2,
    chest.position.y + chest.height + CONTENT_GAP_PT,
  );
  content.addChild(heading, chest, row);

  let popup: Popup | undefined;
  let claiming = false;
  let claimRequestedBeforeReady = false;
  const finishClaim = async (): Promise<void> => {
    popup?.dismiss();
    if (claimable) await options.onClaim();
  };
  const claimOrClose = async (): Promise<void> => {
    if (claiming) return;
    claiming = true;
    // `Popup.show()` mounts the interactive content before its 0.2s pop-in promise resolves. A
    // fast press can therefore reach the chest/close listener while this local is still awaiting
    // that promise. Preserve the first source-style invocation and finish it as soon as the popup
    // instance is returned; otherwise the modal remains mounted and the rejected async handler is
    // only observable as an unhandled browser error.
    if (popup === undefined) {
      claimRequestedBeforeReady = true;
      return;
    }
    await finishClaim();
  };
  if (claimable) {
    chest.on("pointertap", (event) => {
      event.stopPropagation();
      void claimOrClose();
    });
  }

  const [closeTexture] = await Promise.all([
    options.game.assets.sprite("PopupMenuCloseButton-hd"),
  ]);
  const flash = claimable
    ? new SourceFlashingSprite(content, chest, options.ticker, 1000)
    : undefined;

  const close = pointSprite(closeTexture);
  close.label = "catchQuestClose";
  close.anchor.set(0.5);
  close.eventMode = "static";
  close.cursor = "pointer";
  const closeBounds = close.getLocalBounds();
  const closeHit = minimumHitRectLocal(
    { x: closeBounds.x, y: closeBounds.y, w: closeBounds.width, h: closeBounds.height },
    close.scale,
  );
  close.hitArea = new Rectangle(closeHit.x, closeHit.y, closeHit.w, closeHit.h);
  close.on("pointertap", (event) => {
    event.stopPropagation();
    options.audio.playSfx("click");
    void claimOrClose();
  });

  popup = await showMonsterHatchPopup(catchQuestPopupEnvironment(options, 1000), {
    content,
    // `PopupConfig.scale9Name` is nil for this display (live-hud-binary-evidence.md
    // §"CatchQuestDisplay: exact construction and controls"): the heading/chest/monster-row stack
    // sits straight on the dim. It keeps the MonsterHatchPopup overlays, which is why ClerkGirl and
    // TutorialRightSide still frame it in the original with no card behind them.
    backgroundKey: null,


    centeredChildren: [{ node: close, offsetX: 0, offsetY: CLOSE_OFFSET_Y_PT }],
    onPresent: () => {
      flash?.start();
    },
    onDismiss: () => flash?.destroy(),
  });
  if (claimRequestedBeforeReady) await finishClaim();
}

async function showMessagePopup(
  options: Pick<
    DungeonCatchQuestDisplayOptions,
    "parent" | "owner" | "game" | "audio" | "ticker"
  >,
  name: string,
): Promise<void> {
  await showMonsterHatchPopup(catchQuestPopupEnvironment(options, 1001), {
    title: localizedString(options.game.strings, `${name}TitleKey`),
    content: buildLocalizedMonsterHatchMessageContent(options.game.strings, name),
    buttons: [{
      label: localizedString(options.game.strings, "OkButtonKey"),
      onPress: () => undefined,
    }],
  });
}

function catchQuestPopupEnvironment(
  options: Pick<
    DungeonCatchQuestDisplayOptions,
    "parent" | "owner" | "game" | "audio" | "ticker"
  >,
  zIndex: number,
) {
  return {
    parent: options.parent,
    assets: options.game.assets,
    scale9: options.game.scale9,
    ticker: options.ticker,
    owner: options.owner,
    zIndex,
    sfx: {
      onButtonPress: () => options.audio.playSfx("click"),
      onButtonBlocked: () => options.audio.playSfx("notAllowed"),
    },
  };
}

async function buildQuestPortrait(
  assets: AssetLibrary,
  game: LoadedGame,
  shortType: string,
): Promise<Container> {
  const monster = game.gd.monsterByShortType(shortType);
  const texture = await assets.sprite(`${shortType}-hd`);
  const boundsNode = createRenderableSpriteNode({
    texture,
    rendererData: monster.rendererData,
  });
  const bounds = boundsNode.boundsArea;
  if (bounds === null) throw new Error(`CatchQuestDisplay renderer ${shortType} has no content size`);
  const fit = Math.min(1, MONSTER_TARGET_PT / bounds.width, MONSTER_TARGET_PT / bounds.height);
  boundsNode.destroy({ children: true });

  const root = new Container();
  root.label = `catchQuestMonster:${shortType}`;
  const centerOffset = {
    x: (MONSTER_TARGET_PT - bounds.width * fit) / 2,
    y: (MONSTER_TARGET_PT - bounds.height * fit) / 2,
  };
  const white = new ColorMatrixFilter();
  white.matrix = [
    0, 0, 0, 0, 1,
    0, 0, 0, 0, 1,
    0, 0, 0, 0, 1,
    0, 0, 0, 1, 0,
  ];




  const outlineRadius = OUTLINE_RADIUS_PT * fit;
  for (let step = 0; step < 12; step++) {
    const radians = step * Math.PI * 2 / 12;
    const outline = createRenderableSpriteNode({ texture });
    outline.scale.set(fit);
    outline.position.set(
      centerOffset.x + Math.cos(radians) * outlineRadius,
      centerOffset.y + Math.sin(radians) * outlineRadius,
    );
    outline.filters = [white];
    outline.eventMode = "none";
    root.addChild(outline);
  }
  const original = createRenderableSpriteNode({
    texture,
    rendererData: monster.rendererData,
    label: `catchQuestOriginal:${shortType}`,
  });

  original.scale.set(fit);
  original.position.set(centerOffset.x, centerOffset.y);
  original.eventMode = "none";
  root.addChild(original);
  return root;
}

async function dungeonThemeFrame(
  game: LoadedGame,
  definition: DungeonDefinition,
  frameName: string,
) {
  for (const atlasName of definition.presentation.atlasNames) {
    const atlas = await game.assets.atlas(`${atlasName}-hd`);
    const texture = atlas.textures[frameName];
    if (texture !== undefined) return texture;
  }
  throw new Error(`Dungeon ${definition.instanceName} is missing ${frameName}`);
}
