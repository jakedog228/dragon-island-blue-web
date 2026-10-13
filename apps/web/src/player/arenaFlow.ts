import type { PvpFlowHandle } from "../pvp/pvpFlow.js";
import {
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { GameData, LicenseDef } from "@dib/gamedata/browser";
import type { PlayerProfile } from "@dib/player-domain";
import { Container, Rectangle, type Ticker } from "pixi.js";
import { idiomPairPt, screenPointsForMode } from "../displayMode.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { PopupHost } from "../ui/popup.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import { popupMenuGeometry } from "../ui/popupMenuMath.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { showGuildQuestChat } from "../world/guildQuestChat.js";
import {
  characterLicenseQualification,
  nextLicense,
} from "./characterProgressionModel.js";

type ArenaAction = "current" | "next" | "battle" | "tournament" | "pvp" | "back";

export interface ArenaFlowOptions {
  readonly parent: Container;
  readonly owner: object;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly data: GameData;
  readonly profile: PlayerProfile;
  readonly completedQuests: number;
  readonly noLicense: boolean;
  readonly tournamentEnabled: boolean;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly onClose: () => void;
  readonly onChallenge: (license: LicenseDef) => void | Promise<void>;
  readonly onPvp?: (parent: Container, onClose: () => void) => PvpFlowHandle;
  readonly onTournament: () => void | Promise<void>;
}

/** ArenaMenuItem's source action order and Licenses.plist qualification surface. */
export class ArenaFlow extends Container {
  private closed = false;
  private pvp: PvpFlowHandle | undefined;
  private messagePending = false;
  private readonly buttons: Array<Record<string, unknown>> = [];

  private constructor(private readonly opts: ArenaFlowOptions) {
    super();
  }

  static async show(opts: ArenaFlowOptions): Promise<ArenaFlow> {
    const flow = new ArenaFlow(opts);
    await flow.build();
    const parent = PopupHost.presentationParentFor(opts.parent);
    parent.sortableChildren = true;
    parent.addChild(flow);
    return flow;
  }

  requestBack(): boolean {
    if (this.pvp) return this.pvp.requestBack();
    this.dispose();
    return true;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.pvp?.dispose(); this.pvp = undefined;
    this.opts.onClose();
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }

  get debugState(): Record<string, unknown> {
    const next = nextLicense(this.opts.data, this.opts.profile);
    return {
      open: !this.closed,
      noLicense: this.opts.noLicense,
      currentLicense: this.opts.profile.licenseType,
      nextLicense: next?.type ?? null,
      qualification: characterLicenseQualification(
        this.opts.data,
        this.opts.profile,
        this.opts.completedQuests,
      ),
      buttons: this.buttons,
      ...(this.pvp ? { pvp: this.pvp.debugState } : {}),
    };
  }

  private async build(): Promise<void> {
    const screen = screenPointsForMode(DISPLAY_MODE);
    this.label = "arena";
    this.zIndex = 900;
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    for (const event of [
      "pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove",
    ] as const) this.on(event, (pointer) => pointer.stopPropagation());
    const background = sourceFullscreenSprite(
      await this.opts.assets.sprite("ArenaCombat"),
      DISPLAY_MODE,
      "ArenaCombat",
    );
    background.eventMode = "none";
    this.addChild(background);

    const sourceItems: Array<{ value: ArenaAction; key: string; enabled: boolean }> =
      this.opts.noLicense
        ? [
            { value: "tournament", key: "TournamentKey", enabled: this.opts.tournamentEnabled },
            { value: "back", key: "BackButtonKey", enabled: true },
          ]
        : [
            { value: "current", key: "MyLicenseKey", enabled: true },
            { value: "next", key: "NextLicenseKey", enabled: true },
            { value: "battle", key: "BattleKey", enabled: true },
            { value: "tournament", key: "TournamentKey", enabled: this.opts.tournamentEnabled },
            { value: "back", key: "BackButtonKey", enabled: true },
          ];
    // Optional port-extension row, adjacent to Tournament; the baseline source menu is unchanged.
    if (this.opts.onPvp) sourceItems.splice(sourceItems.length - 1, 0, { value: "pvp", key: "PvpMenuKey", enabled: true });
    const metrics = {
      itemGap: idiomPairPt(30, 60, DISPLAY_MODE),
      columnGap: idiomPairPt(30, 60, DISPLAY_MODE),
      titleGap: idiomPairPt(10, 20, DISPLAY_MODE),
      backgroundMarginX: idiomPairPt(9, 18, DISPLAY_MODE),
      backgroundMarginY: idiomPairPt(6, 12, DISPLAY_MODE),
    };
    const items = sourceItems.map((item) => ({
      value: item.value,
      label: localizedOrFallback(this.opts.strings, item.key, arenaFallback(item.value)),
      enabled: item.enabled,
    }));
    const view = await buildPopupMenuView<ArenaAction>({
      parent: this,
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      columns: [items],
      itemStyle: ({ enabled }) => ({
        fontSize: idiomPairPt(20, 40, DISPLAY_MODE),
        fill: enabled ? 0xffffff : 0x000000,
        outlineWidth: 2,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: metrics.backgroundMarginX,
      backgroundMarginY: metrics.backgroundMarginY,
      geometry: (titleSize, sizes) =>
        popupMenuGeometry(screen, titleSize, sizes, metrics, DISPLAY_MODE),
      buttonLabel: ({ value }) => `arena:${value}`,
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
          y: layout.label.y + layout.label.h / 2,
        },
      });
    }
  }

  private async activate(action: ArenaAction): Promise<void> {
    if (this.closed || this.pvp || this.messagePending || PopupHost.for(this).modalDepth > 0) return;
    this.opts.onClick();
    if (action === "pvp") { this.pvp = this.opts.onPvp?.(this, () => { this.pvp = undefined; }); return; }
    if (action === "back") {
      this.dispose();
      return;
    }
    if (action === "current") {
      if (this.opts.profile.licenseOrdinal === 0) {
        await this.showMessage(localizedString(this.opts.strings, "ArenaNoLicenseChatKey"));
      } else {
        await this.showMessage(licenseDescription(
          this.opts.strings,
          this.opts.data.allLicenses()[this.opts.profile.licenseOrdinal - 1],
          this.opts.data.license(this.opts.profile.licenseType),
        ));
      }
      return;
    }
    const next = nextLicense(this.opts.data, this.opts.profile);
    if (action === "next") {
      if (next === undefined) {
        await this.showMessage(localizedString(this.opts.strings, "ArenaHighestLicenseChatKey"));
      } else {
        await this.showMessage(licenseDescription(
          this.opts.strings,
          this.opts.data.license(this.opts.profile.licenseType),
          next,
        ));
      }
      return;
    }
    if (action === "battle") {
      if (next === undefined) {
        await this.showMessage(localizedString(this.opts.strings, "ArenaHighestLicenseChatKey"));
        return;
      }
      const qualification = characterLicenseQualification(
        this.opts.data,
        this.opts.profile,
        this.opts.completedQuests,
      );
      if (!qualification.qualifies) {
        let requirementIndex = 0;
        const requirementValues = [
          qualification.completedQuestsRequired,
          qualification.heroLevelRequired,
          qualification.completedQuests,
          qualification.heroLevel,
        ];
        const requirement = localizedString(
          this.opts.strings,
          "LicenseUpgradeFailFormatKey",
        ).replace(/%d/g, () => String(requirementValues[requirementIndex++] ?? 0));
        await this.showMessage(
          localizedString(this.opts.strings, "LicenseUpgradeFailChatKey")
            .replace("%@", localizedOrFallback(
              this.opts.strings,
              `License${next.type}NameKey`,
              next.type,
            ))
            .replace("%@", requirement),
        );
        return;
      }
      this.dispose();
      await this.opts.onChallenge(next);
      return;
    }
    if (action === "tournament") {
      this.dispose();
      await this.opts.onTournament();
    }
  }











  private async showMessage(message: string): Promise<void> {
    this.messagePending = true;
    try {
      const chat = await showGuildQuestChat({
        parent: this,
        assets: this.opts.assets,
        scale9: this.opts.scale9,
        ticker: this.opts.ticker,
        message,
      });
      await chat.closed;
    } finally { this.messagePending = false; }
  }
}

function licenseDescription(
  strings: LocalizedStrings,
  previous: LicenseDef | undefined,
  license: LicenseDef,
): string {
  const name = localizedString(strings, `License${license.type}NameKey`);
  const slots = license.gemSlots === 0
    ? ""
    : Array.from({ length: license.gemSlots }, (_, slot) =>
        localizedString(
          strings,
          `${["Novice", "Veteran", "Elite", "Grandmaster"][slot]}SlotKey`,
        )).join(",");
  let index = 0;
  const values = [
    name,
    String(license.battingOrderSize - (previous?.battingOrderSize ?? 0)),
    slots,
  ];
  return localizedString(strings, "ArenaLicenseDescriptionChatKey")
    .replace(/%@|%d/g, () => values[index++] ?? "");
}

function arenaFallback(action: ArenaAction): string {
  return {
    current: "My License",
    next: "Next License",
    battle: "Battle",
    tournament: "Tournament",
    pvp: "PvP",
    back: "Back",
  }[action];
}

function localizedOrFallback(strings: LocalizedStrings, key: string, fallback: string): string {
  try {
    return localizedString(strings, key);
  } catch {
    return fallback;
  }
}
