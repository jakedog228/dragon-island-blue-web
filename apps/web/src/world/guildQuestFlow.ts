import {
  Container,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type Text,
  type Ticker,
} from "pixi.js";
import {
  Box,
  makeTtfLabel,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { QuestDefinition } from "@dib/gamedata/browser";
import {
  MAX_ACTIVE_GUILD_QUESTS,
  type GuildQuestRuntime,
} from "@dib/engine";
import type { AudioPlayer } from "../audio.js";
import type { LoadedGame } from "../loadGame.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import {
  screenPointsForMode,
} from "../displayMode.js";
import { localizedString } from "../localization.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import {
  popupMenuColumns,
  popupMenuGeometry,
  popupMenuLabelOutline,
} from "../ui/popupMenuMath.js";
import { Popup, PopupHost } from "../ui/popup.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  showGuildQuestChat,
  type GuildQuestChatHandle,
} from "./guildQuestChat.js";
import {
  guildQuestDescription,
  guildQuestProgress,
  guildQuestTitle,
} from "./guildQuestText.js";
import {
  guildQuestDisplayLayout,
  guildTavernBackgroundLayout,
  guildTavernLayout,
  guildTavernMenuGeometry,
} from "./guildQuestLayoutMath.js";

let SCREEN = screenPointsForMode(DISPLAY_MODE);
let TAVERN_LAYOUT = guildTavernLayout(DISPLAY_MODE);
let TAVERN_BACKGROUND_LAYOUT = guildTavernBackgroundLayout(DISPLAY_MODE);
let QUEST_LAYOUT = guildQuestDisplayLayout(DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  SCREEN = screenPointsForMode(DISPLAY_MODE);
  TAVERN_LAYOUT = guildTavernLayout(DISPLAY_MODE);
  TAVERN_BACKGROUND_LAYOUT = guildTavernBackgroundLayout(DISPLAY_MODE);
  QUEST_LAYOUT = guildQuestDisplayLayout(DISPLAY_MODE);
});

type TavernAction = "newQuest" | "claimReward" | "dropQuests" | "myQuests";








export function guildQuestListAvailable(
  assets: AssetLibrary,
  runtime: GuildQuestRuntime | undefined,
): runtime is GuildQuestRuntime {
  return (
    runtime !== undefined &&
    assets.hasSprite("backpack-hd") &&
    assets.hasSprite("quest-hd") &&
    assets.hasSprite("questComplete-hd")
  );
}

export interface GuildQuestFlowOptions {
  readonly parent: Container;
  readonly game: LoadedGame;
  readonly audio: AudioPlayer;
  readonly ticker: Ticker;
  readonly runtime: GuildQuestRuntime;
  readonly townName?: string;
  readonly questGiver?: string;
  readonly tavernBackgroundSpriteKey?: string;
  readonly onAcceptQuest?: (quest: QuestDefinition) => Promise<void>;
  readonly onDropAllQuests?: () => Promise<void>;





  readonly onClaimQuest?: (quest: QuestDefinition) => Promise<() => void | Promise<void>>;
  readonly onClaimReward: (quest: QuestDefinition) => void | Promise<void>;
  readonly onStateChanged: () => void;
  readonly onClose: () => void;
}

interface TavernButton {
  readonly action: TavernAction;
  readonly label: string;
  readonly badgeKind?: "available" | "completed";
}

/** Source Tavern + `QuestsMenuItem` presentation coordinator. */
export class GuildQuestFlow {
  private readonly owner = {};
  private tavernRoot: Container | undefined;
  private questPopup: Popup | undefined;
  private activeChat: GuildQuestChatHandle | undefined;
  private availableBadge: Text | undefined;
  private completedBadge: Text | undefined;
  private disposed = false;
  private mode: "tavern" | "quests" = "quests";

  private constructor(private readonly options: GuildQuestFlowOptions) {}

  static async showTavern(options: GuildQuestFlowOptions): Promise<GuildQuestFlow> {
    if (
      options.townName === undefined ||
      options.questGiver === undefined ||
      options.tavernBackgroundSpriteKey === undefined
    ) {
      throw new Error("TavernMenuItem requires its town name and authored questGiver");
    }
    const flow = new GuildQuestFlow(options);
    flow.mode = "tavern";
    await flow.buildTavern();
    return flow;
  }

  static async showQuestList(options: GuildQuestFlowOptions): Promise<GuildQuestFlow> {
    const flow = new GuildQuestFlow(options);
    flow.mode = "quests";
    await flow.openQuestList(false);
    return flow;
  }

  requestBack(): void {



    if (this.activeChat !== undefined) {
      this.activeChat.dismiss();
      return;
    }
    const popupHost = PopupHost.for(this.options.parent);
    if (popupHost.modalDepth > 0) {
      popupHost.dismissTop();
      return;
    }
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    PopupHost.for(this.options.parent).dismissOwnedBy(this.owner);
    this.activeChat?.dismiss(true);
    this.activeChat = undefined;
    this.tavernRoot?.destroy({ children: true });
    this.tavernRoot = undefined;
    this.options.onClose();
  }

  get debugState(): Record<string, unknown> {
    return {
      kind: "guildQuests",
      mode: this.mode,
      townName: this.options.townName ?? null,
      tavernOpen: this.tavernRoot !== undefined,
      questListOpen: this.questPopup !== undefined && !this.questPopup.isDismissed,
      chatOpen: this.activeChat !== undefined,
      activeQuestNames: this.options.runtime.activeQuestNames(),
      completedQuestNames: this.options.runtime.completedActiveQuestNames(),
      availableCount: this.options.townName === undefined
        ? null
        : this.options.runtime.questsAvailableInTown(this.options.townName),
    };
  }

  private async buildTavern(): Promise<void> {
    const root = new Container();
    root.label = "guildTavern";
    root.zIndex = 9_000;
    root.sortableChildren = true;
    root.eventMode = "static";
    root.hitArea = new Rectangle(0, 0, SCREEN.w, SCREEN.h);
    for (const event of [
      "pointerdown",
      "pointerup",
      "pointerupoutside",
      "pointertap",
      "pointermove",
      "pointercancel",
    ] as const) {
      root.on(event, (pointerEvent) => pointerEvent.stopPropagation());
    }

    const backgroundTexture = await this.options.game.assets.sprite(
      this.options.tavernBackgroundSpriteKey!,
    );
    if (
      backgroundTexture.width < TAVERN_BACKGROUND_LAYOUT.textureRectPx.w ||
      backgroundTexture.height < TAVERN_BACKGROUND_LAYOUT.textureRectPx.h
    ) {
      throw new Error(
        `Tavern background ${this.options.tavernBackgroundSpriteKey} is ` +
          `${backgroundTexture.width}x${backgroundTexture.height}px; the source texture rect ` +
          `requires ${TAVERN_BACKGROUND_LAYOUT.textureRectPx.w}x` +
          `${TAVERN_BACKGROUND_LAYOUT.textureRectPx.h}`,
      );
    }
    const background = new Sprite(new Texture({
      source: backgroundTexture.source,
      frame: new Rectangle(
        TAVERN_BACKGROUND_LAYOUT.textureRectPx.x,
        TAVERN_BACKGROUND_LAYOUT.textureRectPx.y,
        TAVERN_BACKGROUND_LAYOUT.textureRectPx.w,
        TAVERN_BACKGROUND_LAYOUT.textureRectPx.h,
      ),
    }));
    background.label = "guildTavernBackground";
    background.width = TAVERN_BACKGROUND_LAYOUT.sizePt.w;
    background.height = TAVERN_BACKGROUND_LAYOUT.sizePt.h;
    background.position.set(
      TAVERN_BACKGROUND_LAYOUT.positionPt.x,
      TAVERN_BACKGROUND_LAYOUT.positionPt.y,
    );
    background.zIndex = -10;
    background.eventMode = "none";
    root.addChild(background);

    const actions: TavernButton[] = [
      {
        action: "newQuest",
        label: localizedString(this.options.game.strings, "NewQuestKey"),
        badgeKind: "available",
      },
      {
        action: "claimReward",
        label: localizedString(this.options.game.strings, "FinishedQuestKey"),
        badgeKind: "completed",
      },
      {
        action: "dropQuests",
        label: localizedString(this.options.game.strings, "DropQuestsKey"),
      },
      {
        action: "myQuests",
        label: localizedString(this.options.game.strings, "MyQuestsKey"),
      },
    ];
    const columns = popupMenuColumns(actions, 2);
    const badges = new Map<TavernAction, Awaited<ReturnType<GuildQuestFlow["buildNotificationBadge"]>>>();
    for (const action of actions) {
      if (action.badgeKind !== undefined) {
        badges.set(action.action, await this.buildNotificationBadge(action.badgeKind));
      }
    }
    const view = await buildPopupMenuView({
      parent: root,
      assets: this.options.game.assets,
      scale9: this.options.game.scale9,




      columns: columns.map((column) => column.map((item) => ({
        value: item,
        label: item.label,
        enabled: true,
      }))),
      itemStyle: () => ({
        fontSize: TAVERN_LAYOUT.itemFontSize,
        fill: 0xffffff,
        outlineWidth: TAVERN_LAYOUT.outlineWidth,
        textureScaleMode: "nearest",
      }),
      itemAccessory: (item) => {
        const badge = badges.get(item.value.action);
        return badge === undefined
          ? undefined
          : {
              node: badge.root,
              side: "right",
              gap: TAVERN_LAYOUT.itemIconGap,
              contentSize: badge.contentSize,
            };
      },
      displayMode: DISPLAY_MODE,
      backgroundMarginX: TAVERN_LAYOUT.backgroundMarginX,
      backgroundMarginY: TAVERN_LAYOUT.backgroundMarginY,
      geometry: (_titleSize, itemSizes) => guildTavernMenuGeometry(DISPLAY_MODE, itemSizes),
      buttonLabel: (item) => `guildTavern:${item.value.action}`,
    });

    for (const button of view.buttons) {
      const { item: viewItem } = button;
      const item = viewItem.value;
      (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))(() => {
        this.options.audio.playSfx("click");
        void this.activateTavernAction(item.action);
      });
      if (item.badgeKind !== undefined) {
        const badge = badges.get(item.action);
        if (badge === undefined) throw new Error(`Tavern badge ${item.action} was not built`);
        if (item.badgeKind === "available") this.availableBadge = badge.label;
        else this.completedBadge = badge.label;
      }
    }

    const closeTexture = await this.options.game.assets.sprite("PopupMenuCloseButton-hd");
    const close = pointSprite(closeTexture);
    close.label = "guildTavern:close";
    close.anchor.set(1, 0);
    close.position.set(
      SCREEN.w - TAVERN_LAYOUT.closeInset,
      TAVERN_LAYOUT.closeInset,
    );
    close.eventMode = "static";
    close.cursor = "pointer";
    close.on("pointertap", (event) => {
      event.stopPropagation();
      this.options.audio.playSfx("click");
      this.dispose();
    });
    root.addChild(close);

    this.tavernRoot = root;
    this.refreshTavernBadges();
    this.options.parent.sortableChildren = true;
    this.options.parent.addChild(root);
  }

  private async buildNotificationBadge(
    kind: "available" | "completed",
  ): Promise<{
    readonly root: Container;
    readonly label: Text;
    readonly contentSize: { readonly w: number; readonly h: number };
  }> {
    const root = new Container();
    root.label = `guildTavernBadge:${kind}`;
    const icon = pointSprite(await this.options.game.assets.sprite("notification-hd"));
    icon.anchor.set(0, 0.5);
    icon.eventMode = "none";
    const label = makeTtfLabel("", TAVERN_LAYOUT.notificationFontSize, {
      outline: false,
      textureScaleMode: "nearest",
    });
    label.anchor.set(0.5);
    label.position.set(icon.width / 2, 0);
    label.eventMode = "none";
    root.addChild(icon, label);
    return { root, label, contentSize: { w: icon.width, h: icon.height } };
  }

  private refreshTavernBadges(): void {
    if (this.options.townName === undefined) return;
    this.updateBadge(
      this.availableBadge,
      this.options.runtime.questsAvailableInTown(this.options.townName),
    );
    this.updateBadge(
      this.completedBadge,
      this.options.runtime.completedActiveQuestNames().length,
    );
  }

  private updateBadge(label: Text | undefined, count: number): void {
    if (label === undefined) return;
    label.text = String(count);
    if (label.parent !== null) label.parent.visible = count > 0;
  }

  private async activateTavernAction(action: TavernAction): Promise<void> {
    if (this.disposed || this.activeChat !== undefined || this.questPopup !== undefined) return;
    switch (action) {
      case "newQuest":
        await this.newQuest();
        return;
      case "claimReward":
        await this.claimReward();
        return;
      case "dropQuests":
        if (this.options.onDropAllQuests === undefined) {
          this.options.runtime.clearAllQuests();
        } else {
          await this.options.onDropAllQuests();
        }
        this.options.onStateChanged();
        this.refreshTavernBadges();
        await this.showMessagePopup("DroppedQuests");
        return;
      case "myQuests":
        await this.openQuestList(true);
    }
  }

  private async newQuest(): Promise<void> {
    if (this.options.townName === undefined) throw new Error("Tavern has no town name");
    if (this.options.runtime.activeQuestNames().length >= MAX_ACTIVE_GUILD_QUESTS) {
      await this.showNamedChat("TavernQuestsFull");
      return;
    }
    const quest = this.options.runtime.firstAvailableQuestInTown(this.options.townName);
    if (quest === undefined) {
      await this.showNamedChat(
        this.options.runtime.activeQuestNames().length === 0
          ? "TavernQuestsAllFinished"
          : "TavernQuestsOnlyActiveLeft",
      );
      return;
    }
    if (this.options.onAcceptQuest === undefined) {
      if (!this.options.runtime.startQuest(quest.name)) {
        throw new Error(`Tavern failed to accept available quest ${quest.name}`);
      }
    } else {
      await this.options.onAcceptQuest(quest);
      if (!this.options.runtime.activeQuestNames().includes(quest.name)) {
        throw new Error(`Authority did not commit accepted quest ${quest.name}`);
      }
    }
    this.options.onStateChanged();
    this.refreshTavernBadges();
    await this.showQuestDescription(quest, this.options.questGiver);
  }

  private async claimReward(): Promise<void> {
    const name = this.options.runtime.completedActiveQuestNames()[0];
    if (name === undefined) {
      await this.showNamedChat("TavernNoFinishedQuests");
      return;
    }
    const quest = this.options.runtime.catalog.requireQuest(name);
    let presentRewards: () => void | Promise<void>;
    if (this.options.onClaimQuest === undefined) {
      if (!this.options.runtime.completeQuest(name)) {
        throw new Error(`Tavern failed to claim completed quest ${name}`);
      }
      presentRewards = () => this.options.onClaimReward(quest);
    } else {
      presentRewards = await this.options.onClaimQuest(quest);
      if (this.options.runtime.activeQuestNames().includes(name)) {
        throw new Error(`Authority did not commit claimed quest ${name}`);
      }
    }
    // `completeQuest:` has already removed the active/completed entry before the shared loot
    // provider starts. Egg rewards can keep that provider's notification-node flow alive for
    // several seconds, so publish the committed Guild state now instead of leaving the stale
    // completed badge visible until the entire reel is dismissed.
    this.options.onStateChanged();
    this.refreshTavernBadges();






    this.startRewardPresentation(presentRewards);
    await this.showNamedChat("TavernQuestFinished");
  }

  /**
   * Starts a claim's reward presentation and leaves it running underneath the Guild chat. Failures
   * surface the same way as the other detached presentations this flow starts.
   */
  private startRewardPresentation(present: () => void | Promise<void>): void {
    const running = present();
    if (running !== undefined) void running;
  }

  private async openQuestList(returnToTavern: boolean): Promise<void> {
    const quests = this.options.runtime.activeQuests();
    if (quests.length === 0) {
      await this.showMessagePopup("NoQuests", returnToTavern ? undefined : () => this.dispose());
      return;
    }
    const content = new Box({
      horizontal: false,
      gap: QUEST_LAYOUT.boxGap,
      positiveAlignDirection: true,
      roundingScale: QUEST_LAYOUT.roundingScale,
    });
    content.label = "guildQuestList";
    let dismissedForAction = false;
    const header = await this.buildQuestHeader();
    const rows = new Box({
      horizontal: false,
      gap: QUEST_LAYOUT.itemGap,
      positiveAlignDirection: true,
      roundingScale: QUEST_LAYOUT.roundingScale,
    });
    for (const quest of quests) {
      const row = await this.buildQuestRow(quest);
      row.on("pointertap", (event: FederatedPointerEvent) => {
        event.stopPropagation();
        this.options.audio.playSfx("click");
        dismissedForAction = true;
        this.questPopup?.dismiss();
        void this.showQuestDescription(quest, returnToTavern ? this.options.questGiver : undefined, (
          returnToTavern ? undefined : () => this.dispose()
        ));
      });
      rows.addBoxChild(row, { contentSize: row.boxContentSize });
    }
    const back = this.buildBackRow();
    back.node.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.options.audio.playSfx("click");
      dismissedForAction = true;
      this.questPopup?.dismiss();
      if (!returnToTavern) this.dispose();
    });
    rows.addBoxChild(back.node, { contentSize: back.contentSize });
    for (const child of rows.children) child.position.x = 0;
    content.addBoxChild(header, { contentSize: header.boxContentSize });
    content.addBoxChild(rows, { contentSize: rows.boxContentSize });
    for (const child of content.children) child.position.x = 0;

    this.questPopup = await Popup.show(this.options.parent, {
      assets: this.options.game.assets,
      scale9: this.options.game.scale9,
      ticker: this.options.ticker,
      content,
      contentLayoutBounds: {
        x: 0,
        y: 0,
        w: content.boxContentSize.w,
        h: content.boxContentSize.h,
      },
      dismissOnTap: false,
      runScaleAction: false,
      owner: this.owner,
      zIndex: 10_000,
      onDismiss: () => {
        this.questPopup = undefined;
        if (!dismissedForAction && !returnToTavern && !this.disposed) this.dispose();
      },
    });
  }

  private async buildQuestHeader(): Promise<Box> {
    const root = new Box({
      horizontal: true,
      gap: QUEST_LAYOUT.boxGap,
      positiveAlignDirection: true,
      roundingScale: QUEST_LAYOUT.roundingScale,
    });
    root.label = "guildQuestListHeader";
    const icon = pointSprite(await this.options.game.assets.sprite("backpack-hd"));
    const title = measuredPopupMenuLabel(
      localizedString(this.options.game.strings, "QuestsKey"),
      QUEST_LAYOUT.titleFontSize,
      0xffff88,
      QUEST_LAYOUT.outlineWidth,
    );
    root.addBoxChild(icon);
    root.addBoxChild(title.label, { contentSize: title.boxChildContentSize });
    return root;
  }

  private async buildQuestRow(quest: QuestDefinition): Promise<Box> {
    const root = new Box({
      horizontal: true,
      gap: QUEST_LAYOUT.itemIconGap,
      positiveAlignDirection: true,
      roundingScale: QUEST_LAYOUT.roundingScale,
    });
    root.label = `guildQuestRow:${quest.name}`;
    root.eventMode = "static";
    root.cursor = "pointer";
    const iconKey = this.options.runtime.isComplete(quest.name)
      ? "questComplete-hd"
      : "quest-hd";
    const icon = pointSprite(await this.options.game.assets.sprite(iconKey));
    const text = measuredPopupMenuLabel(
      `${guildQuestTitle(this.options.game.strings, quest)}\n   ${
        guildQuestProgress(this.options.game.strings, this.options.runtime, quest)
      }`,
      QUEST_LAYOUT.itemFontSize,
      0xffffff,
      QUEST_LAYOUT.outlineWidth,
    );
    root.addBoxChild(icon);
    root.addBoxChild(text.label, { contentSize: text.boxChildContentSize });
    root.hitArea = new Rectangle(0, 0, root.boxContentSize.w, root.boxContentSize.h);
    return root;
  }

  private buildBackRow(): {
    readonly node: Container;
    readonly contentSize: { readonly w: number; readonly h: number };
  } {
    const root = new Container();
    root.label = "guildQuestBack";
    root.eventMode = "static";
    root.cursor = "pointer";
    const entry = measuredPopupMenuLabel(
      localizedString(this.options.game.strings, "BackButtonKey"),
      QUEST_LAYOUT.itemFontSize,
      0xffffff,
      QUEST_LAYOUT.outlineWidth,
    );
    root.hitArea = new Rectangle(0, 0, entry.contentSize.w, entry.contentSize.h);
    root.addChild(entry.label);
    return { node: root, contentSize: entry.contentSize };
  }

  private async showQuestDescription(
    quest: QuestDefinition,
    portraitFile?: string,
    onDismiss?: () => void,
  ): Promise<void> {
    const dialogName = `Quest${quest.name}Description`;
    if (!this.options.runtime.requestChatPresentation(dialogName, true)) return;
    this.options.onStateChanged();
    this.activeChat = await showGuildQuestChat({
      parent: this.options.parent,
      assets: this.options.game.assets,
      scale9: this.options.game.scale9,
      ticker: this.options.ticker,
      message: guildQuestDescription(this.options.game.strings, quest),
      ...(portraitFile === undefined ? {} : { portraitFile }),
      onDismiss: () => {
        this.activeChat = undefined;
        onDismiss?.();
      },
    });
  }

  private async showNamedChat(name: string): Promise<void> {
    if (!this.options.runtime.requestChatPresentation(name, true)) return;
    this.options.onStateChanged();
    this.activeChat = await showGuildQuestChat({
      parent: this.options.parent,
      assets: this.options.game.assets,
      scale9: this.options.game.scale9,
      ticker: this.options.ticker,
      message: localizedString(this.options.game.strings, `${name}ChatKey`),
      onDismiss: () => { this.activeChat = undefined; },
    });
  }

  private async showMessagePopup(name: string, afterDismiss?: () => void): Promise<void> {
    await showMonsterHatchPopup({
      parent: this.options.parent,
      assets: this.options.game.assets,
      scale9: this.options.game.scale9,
      ticker: this.options.ticker,
      owner: this.owner,
      zIndex: 10_000,
      sfx: {
        onButtonPress: () => this.options.audio.playSfx("click"),
        onButtonBlocked: () => this.options.audio.playSfx("notAllowed"),
      },
    }, {
      title: localizedString(this.options.game.strings, `${name}TitleKey`),
      content: buildLocalizedMonsterHatchMessageContent(this.options.game.strings, name),
      buttons: [{
        label: localizedString(this.options.game.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
      ...(afterDismiss === undefined ? {} : { onDismiss: afterDismiss }),
    });
  }
}

function measuredPopupMenuLabel(
  value: string,
  fontSize: number,
  fill: number,
  outlineWidth: number,
): {
  readonly label: Text;
  readonly contentSize: { readonly w: number; readonly h: number };
  /**
   * Box measures an authored contentSize before applying the child's transform. TTF labels are
   * baked at 2x and scaled to 0.5, so passing the point-space `Text.width` here would apply that
   * scale twice and make PopupMenu's frame half-size.
   */
  readonly boxChildContentSize: { readonly w: number; readonly h: number };
} {
  const measurement = makeTtfLabel(value, fontSize, {
    fill,
    outline: false,
    textureScaleMode: "nearest",
  });
  const contentSize = { w: measurement.width, h: measurement.height };
  const measurementBounds = measurement.getLocalBounds();
  const boxChildContentSize = { w: measurementBounds.width, h: measurementBounds.height };
  measurement.destroy();



  const label = makeTtfLabel(value, fontSize, {
    fill,
    outline: popupMenuLabelOutline(outlineWidth).outline,
    textureScaleMode: "nearest",
  });
  label.eventMode = "none";
  return { label, contentSize, boxChildContentSize };
}
