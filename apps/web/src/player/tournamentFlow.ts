import { setOwnedTexture } from "@dib/renderer";
import {
  makeTtfLabel,
  OUTLINE_FADE_ALPHA,
  placeTtfLabelInk,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { GameData, TournamentDef } from "@dib/gamedata/browser";
import type { PlayerReward } from "@dib/engine";
import { TournamentPrizeList } from "./tournamentPrizeList.js";
import type { PlayerProfile } from "@dib/player-domain";
import { Container, Rectangle, Texture, type Ticker } from "pixi.js";
import { idiomPairPt, screenPointsForMode } from "../displayMode.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { popupMenuGeometry } from "../ui/popupMenuMath.js";
import {
  TOURNAMENT_UNKNOWN_SCALE,
  tournamentMenuGeometry,
  tournamentPortraitMaxHeight,
  tournamentPortraitWidth,
  tournamentRewardLayout,
  tournamentRewardsButtonLayout,
  tournamentRoundLayout,
  tournamentTitleLayout,
} from "./tournamentDisplayMath.js";
import { buildTournamentRewardNode } from "./tournamentRewardNode.js";
import {
  buildMonsterHatchMessageBlock,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import { PopupHost } from "../ui/popup.js";

/** `outlineFadeBackgroundNode`'s borderWidth for all three title labels (`widgets.md` §6). */
const TITLE_OUTLINE_WIDTH_PT = 2;

type TournamentAction = "primary" | "rewards" | "back";

export interface TournamentFlowOptions {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly data: GameData;
  readonly profile: PlayerProfile;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly onStateChanged: () => void;
  readonly onBattle: (tournament: TournamentDef, round: number) => void | Promise<void>;
  readonly onClaimPrize: (tournament: TournamentDef) => void | Promise<void>;
  readonly roundPortraitFile: (tournament: TournamentDef, round: number) => string | undefined;
  /** `-[Tournament itemRewards]`, for the prize list's per-row reward render. */
  readonly prizeRewards: (tournament: TournamentDef) => readonly PlayerReward[];
  /** Present TournamentFinished inside this scene so it owns foreground draw/input priority. */
  readonly onFinished: (parent: Container) => void | Promise<void>;
  /** Prepare the scene off-stage for the ArenaMenuItem `CCTransitionFade` midpoint. */
  readonly deferPresentation?: boolean;

  readonly onRequestExit?: (reason: "back" | "prize" | "finished") => void | Promise<void>;
  readonly onClose: () => void;
  readonly nowSeconds?: () => number;
}

/** Source TournamentNode's durable four-round surface. The native UIKit-only prize-list overlay is
 * represented by the same ordered catalog in a modal message; the battle/status/prize mechanics
 * remain owned by the source-equivalent TournamentProgress aggregate. */
export class TournamentFlow extends Container {
  private closed = false;
  private readonly buttons: Array<Record<string, unknown>> = [];
  private glowAgeMs = 0;
  private prizeList: TournamentPrizeList | undefined;
  private presented = false;
  private exitPending = false;
  private finishedTournament = false;

  private constructor(private readonly opts: TournamentFlowOptions) {
    super();
  }

  static async show(opts: TournamentFlowOptions): Promise<TournamentFlow> {
    const flow = new TournamentFlow(opts);
    await flow.build();
    if (opts.deferPresentation !== true) flow.present();
    return flow;
  }

  present(): void {
    if (this.closed || this.presented) return;
    this.presented = true;
    this.opts.parent.addChild(this);
  }

  get debugState(): Record<string, unknown> {
    const progress = this.opts.profile.tournament;
    return {
      kind: "tournament",
      open: !this.closed,
      index: progress.index,
      round: progress.round,
      status: progress.status,
      tournament: this.opts.data.tournament(progress.index)?.name ?? null,
      timeToNext: progress.timeToNextTournament(this.now()),
      buttons: this.buttons,
      popups: PopupHost.for(this).debugState,
      ...(this.prizeList === undefined ? {} : { prizeList: this.prizeList.debugState }),
    };
  }

  requestBack(): boolean {
    if (this.prizeList !== undefined) return this.prizeList.requestBack();
    void this.requestExit("back");
    return true;
  }

  async showFirstEntryTutorial(): Promise<void> {
    if (this.closed) return;
    await this.showMessage(
      localizedString(this.opts.strings, "TournamentTutorialMessageKey"),
      localizedString(this.opts.strings, "TournamentTutorialTitleKey"),
    );
  }

  /** `TournamentNode init` runs TournamentFinished and its finish selector is `back:`. */
  async presentFinishedPlotIfNeeded(): Promise<boolean> {
    if (!this.finishedTournament || this.closed) return false;
    await this.opts.onFinished(this);
    await this.requestExit("finished");
    return true;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.prizeList?.dispose();
    this.prizeList = undefined;
    this.opts.ticker.remove(this.tickGlow);
    this.opts.onClose();
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }

  private now(): number {
    return this.opts.nowSeconds?.() ?? Date.now() / 1_000;
  }

  private async build(): Promise<void> {
    const screen = screenPointsForMode(DISPLAY_MODE);
    this.label = "tournament";
    this.zIndex = 910;
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    for (const event of [
      "pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove",
    ] as const) this.on(event, (pointer) => pointer.stopPropagation());

    const background = sourceFullscreenSprite(
      await this.opts.assets.sprite("saveSlotBackground"),
      DISPLAY_MODE,
      "saveSlotBackground",
    );
    background.eventMode = "none";
    this.addChild(background);

    const tournament = this.opts.data.tournament(this.opts.profile.tournament.index);
    if (tournament === undefined) {
      this.finishedTournament = true;
      return;
    } else {
      // `-[TournamentNode init]` retains the `MonsterpediaFrames` spritesheet purely to draw
      // `questionmark.png` over every matchup the player has not reached yet.
      const monsterpedia = await this.opts.assets.atlas("MonsterpediaFrames-hd");
      const unknownTexture = monsterpedia.textures["questionmark.png"];
      if (unknownTexture === undefined) {
        throw new Error("TournamentFlow: MonsterpediaFrames-hd is missing questionmark.png");
      }













      const fitCard = (
        sprite: ReturnType<typeof pointSprite>,
        bottomY: number,
        clampHeight: boolean,
      ): void => {
        const width = tournamentPortraitWidth(DISPLAY_MODE);
        const maxHeight = tournamentPortraitMaxHeight(DISPLAY_MODE);
        const scale = width / sprite.width;
        sprite.scale.set(sprite.scale.x * scale, sprite.scale.y * scale);
        if (clampHeight && sprite.height > maxHeight) {
          const frame = sprite.texture.frame;
          const keep = Math.max(1, Math.floor(frame.height * (maxHeight / sprite.height)));
          setOwnedTexture(sprite, new Texture({
            source: sprite.texture.source,
            frame: new Rectangle(frame.x, frame.y, frame.width, keep),
          }));
        }
        sprite.anchor.set(0.5, 1);
        sprite.position.set(sprite.position.x, bottomY);
        sprite.eventMode = "none";
      };

      for (let round = 0; round < 4; round += 1) {
        const layout = tournamentRoundLayout(round, DISPLAY_MODE);
        // Source gate: rounds past the current one reveal neither fighter, only the placeholder.
        const revealed = round <= this.opts.profile.tournament.round;
        if (revealed) {
          const hero = pointSprite(await this.opts.assets.sprite("heroBattlePortrait-hd"));
          hero.label = `tournament:hero:${round}`;
          hero.position.x = layout.x;
          fitCard(hero, layout.heroBottomY, true);
          this.addChild(hero);
        }
        const portraitFile = revealed
          ? this.opts.roundPortraitFile(tournament, round)
          : undefined;
        if (portraitFile !== undefined) {
          const portrait = pointSprite(await this.opts.assets.sprite(spriteStem(portraitFile)));
          portrait.label = `tournament:opponent:${round}`;
          portrait.position.x = layout.x;
          fitCard(portrait, layout.opponentBottomY, false);
          this.addChild(portrait);
        }
        if (!revealed) {


          const unknown = pointSprite(unknownTexture);
          unknown.label = `tournament:unknown:${round}`;
          unknown.anchor.set(0.5, 1);
          unknown.scale.set(
            unknown.scale.x * TOURNAMENT_UNKNOWN_SCALE,
            unknown.scale.y * TOURNAMENT_UNKNOWN_SCALE,
          );
          unknown.position.set(layout.x, layout.unknownBottomY);
          unknown.eventMode = "none";
          this.addChild(unknown);
        }
        if (round < this.opts.profile.tournament.round) {
          const glow = pointSprite(await this.opts.assets.sprite("tournamentBracketGlow-hd"));
          glow.label = `tournament:completedGlow:${round}`;
          glow.anchor.set(0.5);
          glow.position.set(layout.glow.x, layout.glow.y);
          glow.eventMode = "none";
          this.addChild(glow);
        }
      }





      const prize = this.opts.prizeRewards(tournament)[0];
      if (prize !== undefined) {
        const reward = tournamentRewardLayout(DISPLAY_MODE);
        const node = await buildTournamentRewardNode(
          prize,
          this.opts.assets,
          this.opts.data,
          "tournament:reward",
        );
        node.label = "tournament:reward";
        const bounds = node.boundsArea;
        if (bounds === null || bounds.width <= 0 || bounds.height <= 0) {
          throw new Error("TournamentFlow: prize renderable has no content size");
        }
        // `fminf` of the two ratios with NO `1.0` clamp — the source upscales a small prize.
        const scale = Math.min(
          reward.maxWidth / bounds.width,
          reward.maxHeight / bounds.height,
        );
        node.scale.set(scale);
        // Source anchorPoint (0.5,0.5); the port's renderable root spans [0, size*scale].
        node.position.set(
          reward.center.x - bounds.width * scale / 2,
          reward.center.y - bounds.height * scale / 2,
        );
        node.eventMode = "none";
        this.addChild(node);
      }

      // Source add order puts `tournamentBrackets.png` after every portrait, so the card frames
      // overlap the portraits they hold — which is what lets a 58pt-wide portrait sit inside a
      // 49.5pt-wide card interior without its edges showing.
      const bracket = pointSprite(await this.opts.assets.sprite("tournamentBrackets-hd"));
      bracket.anchor.set(0.5);
      bracket.position.set(screen.w / 2, screen.h / 2);
      bracket.eventMode = "none";
      this.addChild(bracket);
      if (this.opts.profile.tournament.round > 0) this.opts.ticker.add(this.tickGlow);
















      const inkPad = 2 * TITLE_OUTLINE_WIDTH_PT;
      const captionSizePt = idiomPairPt(20, 40, DISPLAY_MODE);
      const captionStyle = {
        outline: true,
        outlineWidthPt: TITLE_OUTLINE_WIDTH_PT,
        outlineAlpha: OUTLINE_FADE_ALPHA,
      } as const;

      const title = makeTtfLabel(tournament.name, idiomPairPt(50, 100, DISPLAY_MODE), {
        ...captionStyle,
        fill: 0xffffff,
        textureScaleMode: "nearest",
      });
      const titles = tournamentTitleLayout(title.width - inkPad, DISPLAY_MODE);

      const tournamentLabel = makeTtfLabel(
        localizedString(this.opts.strings, "DragonIslandTournamentKey"),
        captionSizePt,
        captionStyle,
      );
      tournamentLabel.label = "tournament:subtitleLabel";

      tournamentLabel.anchor.set(1, 0);
      placeTtfLabelInk(
        tournamentLabel,
        titles.captionRight,
        titles.topY,
        TITLE_OUTLINE_WIDTH_PT,
      );

      const classLabel = makeTtfLabel(
        localizedString(this.opts.strings, "ClassKey"),
        captionSizePt,
        captionStyle,
      );
      classLabel.label = "tournament:classLabel";


      classLabel.anchor.set(1, 0);
      placeTtfLabelInk(
        classLabel,
        titles.captionRight,
        titles.topY + (tournamentLabel.height - inkPad),
        TITLE_OUTLINE_WIDTH_PT,
      );

      title.label = "tournament:classLetter";

      title.anchor.set(0, 0);
      placeTtfLabelInk(title, titles.letterX, titles.topY, TITLE_OUTLINE_WIDTH_PT);


      this.addChild(tournamentLabel);
      this.addChild(title);
      this.addChild(classLabel);
    }

    const primaryKey = this.opts.profile.tournament.status === 0
      ? "StartTournamentKey"
      : this.opts.profile.tournament.status === 1
        ? "ContinueTournamentKey"
        : "FinishTournamentKey";
    const primaryItem = {
      value: "primary" as const,
      label: localizedString(this.opts.strings, primaryKey),
      enabled: tournament !== undefined,
    };
    const rewardsItem = {
      value: "rewards" as const,
      label: localizedString(this.opts.strings, "RewardsButtonKey"),
      enabled: true,
    };
    const backItem = {
      value: "back" as const,
      label: localizedString(this.opts.strings, "BackButtonKey"),
      enabled: true,
    };
    const metrics = {
      itemGap: idiomPairPt(30, 60, DISPLAY_MODE),
      columnGap: idiomPairPt(20, 40, DISPLAY_MODE),
      titleGap: idiomPairPt(5, 10, DISPLAY_MODE),
      backgroundMarginX: idiomPairPt(9, 18, DISPLAY_MODE),
      backgroundMarginY: idiomPairPt(6, 12, DISPLAY_MODE),
    };
    const menuRoot = new Container();
    this.addChild(menuRoot);
    const view = await buildPopupMenuView<TournamentAction>({
      parent: menuRoot,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      // Native item order is [primary, Rewards, Back], but PopupMenu excludes the custom-position
      // Rewards item from Box flow. Model the resulting two-row left flow and independent plate.
      columns: [[primaryItem, backItem], [rewardsItem]],
      itemStyle: ({ enabled }) => ({




        fontSize: idiomPairPt(20, 40, DISPLAY_MODE),
        fill: enabled ? 0xffffff : 0x444444,
        outlineWidth: 2,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: metrics.backgroundMarginX,
      backgroundMarginY: metrics.backgroundMarginY,
      geometry: (titleSize, sizes) => {
        if (titleSize !== null || sizes.length !== 2 || sizes[0]?.length !== 2 || sizes[1]?.length !== 1) {
          throw new Error("TournamentFlow menu geometry received an unexpected source item shape");
        }
        const flowed = tournamentMenuGeometry(
          popupMenuGeometry(screen, null, [sizes[0]], metrics, DISPLAY_MODE),
          DISPLAY_MODE,
        );
        const rewardSeed = popupMenuGeometry(
          screen,
          null,
          [sizes[1]],
          metrics,
          DISPLAY_MODE,
        ).buttons[0]![0]!;
        return {
          ...flowed,
          buttons: [
            flowed.buttons[0]!,
            [tournamentRewardsButtonLayout(flowed, rewardSeed, DISPLAY_MODE)],
          ],
        };
      },
      buttonLabel: ({ value }) => `tournament:${value}`,
    });
    for (const button of view.buttons) {
      const { item, layout } = button;
      (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
        if (!item.enabled) {
          this.opts.onBlocked();
          return;
        }
        void this.activate(item.value);
      });
      this.buttons.push({
        action: item.value,
        enabled: item.enabled,
        center: {
          x: layout.label.x + layout.label.w / 2,
          y: layout.label.y + layout.label.h / 2 + menuRoot.position.y,
        },
      });
    }
  }

  /**
   * `CCRepeatForever(CCSequence(CCFadeTo(1s, 200), CCFadeTo(1s, 255)))`: a linear ramp, not a
   * sine. The sprite starts fully opaque and the sequence's first leg fades it down to 200, so
   * the cycle is 255 -> 200 over the first second and 200 -> 255 over the second.
   */
  private readonly tickGlow = (): void => {
    this.glowAgeMs += this.opts.ticker.deltaMS;
    const phase = (this.glowAgeMs % 2_000) / 1_000;
    const opacity = phase < 1 ? 255 - 55 * phase : 200 + 55 * (phase - 1);
    const alpha = opacity / 255;
    for (const child of this.children) {
      if (child.label?.startsWith("tournament:completedGlow:")) child.alpha = alpha;
    }
  };

  private async activate(action: TournamentAction): Promise<void> {
    if (this.closed || this.exitPending) return;
    this.opts.onClick();
    if (action === "back") {
      await this.requestExit("back");
      return;
    }
    if (action === "rewards") {
      await this.showRewards();
      return;
    }
    const progress = this.opts.profile.tournament;
    const tournament = this.opts.data.tournament(progress.index);
    if (tournament === undefined) {
      await this.showMessage(localizedString(this.opts.strings, "TournamentFinishedPlotKey"));
      return;
    }
    if (progress.status === 2) {





      await this.opts.onClaimPrize(tournament);
      if (!this.closed) await this.requestExit("prize");
      return;
    }
    const remaining = progress.beginBattle(this.now());
    if (remaining > 0) {
      const duration = formatDuration(remaining);
      await this.showMessage(
        localizedString(this.opts.strings, "TournamentTimeMessageFormatKey")
          .replace("%@", duration),
        localizedString(this.opts.strings, "TournamentTimeTitleKey"),
      );
      return;
    }
    this.opts.onStateChanged();
    const round = progress.round;
    await this.opts.onBattle(tournament, round);
    if (!this.closed) this.dispose();
  }

  private async requestExit(reason: "back" | "prize" | "finished"): Promise<void> {
    if (this.closed || this.exitPending) return;
    this.exitPending = true;
    try {
      if (this.opts.onRequestExit === undefined) this.dispose();
      else await this.opts.onRequestExit(reason);
    } finally {
      if (!this.closed) this.dispose();
    }
  }

  /**
   * `-[TournamentNode showRewards:]` presents `TournamentPrizeListViewController`.
   *
   * Row text is source-accurate as the raw plist value:
   * `-[TournamentPrizeListTableCell setupWithTournament:]` runs `name`/`subtitle` through
   * `localizedStringForKey:value:@"" table:nil`, but no shipped Tournaments.plist name ("K".."S")
   * or subtitle ("CLASS........") exists in Localizable.strings, so NSBundle's key-echo returns
   * the key itself.
   */
  private async showRewards(): Promise<void> {
    if (this.prizeList !== undefined) return;
    this.prizeList = await TournamentPrizeList.show({
      parent: this,
      assets: this.opts.assets,
      ticker: this.opts.ticker,
      data: this.opts.data,
      currentTournamentIndex: this.opts.profile.tournament.index,
      // The source cell reads the LAST round's chat portrait: `encounterDataForRound:` at
      // `monsterPopulators.count - 1`, then `Chats.plist[chatKey].images[0]`.
      finalRoundPortraitFile: (tournament) =>
        this.opts.roundPortraitFile(tournament, tournament.monsterPopulators.length - 1),
      prizeRewards: this.opts.prizeRewards,
      onClick: this.opts.onClick,
      onClose: () => { this.prizeList = undefined; },
    });
  }

  private async showMessage(message: string, title?: string): Promise<void> {
    await showMonsterHatchPopup({
      parent: this,
      owner: this,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      ticker: this.opts.ticker,
      zIndex: 1100,
      sfx: { onButtonPress: this.opts.onClick, onButtonBlocked: this.opts.onBlocked },
    }, {
      content: buildMonsterHatchMessageBlock(
        title === undefined ? message : `${title}\n${message}`,
      ).root,
      buttons: [{
        label: localizedString(this.opts.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
    });
  }
}

function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(whole / 3_600);
  const minutes = Math.floor((whole % 3_600) / 60);
  const secs = whole % 60;
  return `${String(hours).padStart(2, "0")}h:${String(minutes).padStart(2, "0")}m:${String(secs).padStart(2, "0")}s`;
}

function spriteStem(file: string): string {
  return file.replace(/\.png$/i, "");
}
