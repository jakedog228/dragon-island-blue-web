


import type { Container, Ticker } from "pixi.js";
import { Container as PixiContainer, Graphics, type Sprite } from "pixi.js";
import {
  Box,
  CONTENT_SCALE_FACTOR,
  createRenderableSpriteNode,
  makeTtfLabel,
  pointSprite,
  renderableScaledContentSize,
  type AssetLibrary,
  type ParticleAsset,
  type Scale9SpritesData,
} from "@dib/renderer";
import type { GameData } from "@dib/gamedata/browser";
import type { StatName } from "@dib/gamedata";
import type {
  GuildQuestEvent,
  OwnedSoulStoneEntry,
  SoulStoneSetup,
  WorldTripParty,
} from "@dib/engine";
import {
  buildPlayerChoices,
  jobXpCostOfNextLevel,
  jobXpForLevel,
} from "@dib/engine";
import type { GameCommandV1 } from "@dib/game-protocol";
import { localizedRenderableName, localizedString, type LocalizedStrings } from "../localization.js";
import {
  buildAbilityInfoContent,
  buildElementHelpContent,
  evolveChainInfoRows,
  buildLivingInfoContent,
  buildSoulStoneInfoContent,
  soulStoneStatRows,
  ITEM_INFO_GAP_BEFORE_BUTTONS,
  LIVING_STAT_NAMES,
  type ElementHelpName,
  type LivingInfoAbility,
  type LivingInfoSnapshot,
} from "../battle/infoDisplays.js";
import {
  buildAbilityInfoModel,
  buildPassiveAbilityInfoModel,
  type AbilityInfoContext,
  type AbilityInfoModel,
} from "../battle/abilityInfo.js";
import { Popup, PopupHost } from "../ui/popup.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  buildMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { idiomPairPt, sourcePointsPerPortPoint } from "../displayMode.js";
import { prepareMenuButton2 } from "../ui/menuButton2.js";
import {
  compareEditorSortValues,
  editorHasReserveRow,
  editorHasTownTitle,
  editorNextSortOrder,
  type EditorSortOrder,
} from "./partyEditorMath.js";
import { PartyEditorSession } from "./partyEditorSession.js";
import {
  advanceDestroyParticleEmission,
  destroyParticlePlacement,
  destroyParticleLifetimeMs,
  destroyParticleSizePt,
} from "./destroyParticleMath.js";
import {
  PartyEditorNode,
  type EditorMemberModel,
  type PartyEditorNativePointerBridge,
  type PartyEditorTextures,
} from "./partyEditorNode.js";
import {
  destructivePopupLayout,
  editableLivingInfoHeaderGap,
} from "./partyEditorPopupMath.js";
import { SourcePointParticleSystem } from "../sourcePointParticleSystem.js";
import {
  buildPartySoulStonePickerRowDisplay,
  PARTY_SOUL_STONE_PICKER_NESTED_Z_INDEX,
  showPartySoulStonePicker,
  type PartySoulStonePickerOptions,
} from "./partySoulStonePicker.js";

const ELEMENT_HELP_NAMES: ReadonlySet<string> = new Set([
  "Life", "Death", "Water", "Fire", "Earth", "Air", "Arcane",
]);

/** Every Living stat the AbilityInfoDisplay description pipeline can magnify against. */

const STAT_ENUM: ReadonlyArray<readonly [1 | 2 | 3 | 4 | 5, StatName]> = [
  [1, "Attack"],
  [2, "Magic"],
  [3, "Speed"],
  [4, "Defense"],
  [5, "Resist"],
];

/** The part of a committed authoritative party-command result the editor consumes. */
export interface AuthoritativePartyCommandResult {
  readonly projection: {
    readonly player: {
      readonly ownedSoulStones: readonly {
        readonly stoneId: string;
        readonly element: string;
        readonly level: number;
        readonly sourceTypeId?: string | undefined;
      }[];
    };
  };
}

export interface PartyEditorFlowOpts {
  parent: Container;
  assets: AssetLibrary;
  scale9: Scale9SpritesData;
  strings: LocalizedStrings;
  ticker: Ticker;
  gd: GameData;
  party: WorldTripParty;
  /** Source entry style: town building = 0; world/general menu = 1. */
  style: 0 | 1;
  signal?: AbortSignal;
  nativePointerBridge?: PartyEditorNativePointerBridge;
  hasCapturedSimpleType: (shortType: string) => boolean;
  healInjury: (
    instanceId: string,
    nowSeconds: number,
  ) => { ok: true; cost: number } | { ok: false; cost: number } |
    Promise<{ ok: true; cost: number } | { ok: false; cost: number }>;

  submitAuthoritative?: (
    command: Extract<GameCommandV1, { type: `party.${string}` }>,
  ) => Promise<AuthoritativePartyCommandResult>;
  /**
   * Local-simulation quest events. Install only when no Official authority is active — the command
   * service already reduces the same mutation server-side. See `localGuildQuestEventOption`.
   */
  onQuestEvent?: (event: GuildQuestEvent) => void;
  onStateChanged: () => void;
  onClose: () => void;
  playSfx: (key: string) => void;
}

/** A modal party-editor session. `WorldNode` holds one at a time, drives `update`, and disposes it
 *  on close/reset — the same lifecycle it gave the old view-only `MonsterManagementNode`. */
export class PartyEditorFlow {
  private readonly opts: PartyEditorFlowOpts;
  private readonly node: PartyEditorNode;
  private readonly popupHost: PopupHost;
  private readonly session: PartyEditorSession;
  private readonly textures: PartyEditorTextures;
  private sortOrder: EditorSortOrder = 2;
  private disposed = false;
  private committed = false;
  private closing = false;
  /** Serializes popup-driven actions so a second tap can't open a duplicate picker/confirm. */
  private busy = false;
  /** Set while a screen that asked for its own modal band is open (see `popupEnvironment`). */
  private nestedPopupZIndex: number | undefined;
  private injuryUpdateMs = 0;

  private constructor(
    opts: PartyEditorFlowOpts,
    node: PartyEditorNode,
    popupHost: PopupHost,
    session: PartyEditorSession,
    textures: PartyEditorTextures,
  ) {
    this.opts = opts;
    this.node = node;
    this.popupHost = popupHost;
    this.session = session;
    this.textures = textures;
  }

  static async show(opts: PartyEditorFlowOpts): Promise<PartyEditorFlow | undefined> {
    const popupHost = PopupHost.for(opts.parent);
    if (opts.party.monsters().length === 0) {
      throw new Error("PartyEditorFlow: the world party must not be empty");
    }
    if (opts.party.purgeExpiredInjuries(Date.now() / 1000)) opts.onStateChanged();
    const session = new PartyEditorSession(
      opts.party.battingOrderSize,
      opts.party.battingOrderMonsters().map((member) => member.instanceId),
      opts.party.reserveMonsters().map((member) => member.instanceId),
    );


    if (opts.style === 0) {
      session.sortReserves(compareSessionIds(opts, 2));
    }
    const textures = await loadEditorTextures(
      opts.assets,
      opts.scale9,
      opts.strings,
      opts.gd,
      opts.party,
      opts.style,
    );
    if (opts.signal?.aborted) return undefined;
    const members = buildSessionBattingModels(opts.gd, opts.party, session);
    const reserves = opts.style === 0
      ? buildSessionReserveModels(opts.gd, opts.party, session)
      : [];
    // Callback closures capture `flow` before construction completes; they only ever fire from
    // pointer events after `show()` has resolved.
    let flow!: PartyEditorFlow;
    const node = new PartyEditorNode(
      {
        ...(editorHasTownTitle(opts.style)
          ? { title: localizedString(opts.strings, "TownGroupKey") }
          : {}),
        partyHeading: localizedString(opts.strings, "BattleGroupKey"),
        insertSoulStone: localizedString(opts.strings, "InsertSoulStoneKey"),
        battingOrderSlots: opts.party.battingOrderSize,
        style: opts.style,
        strings: opts.strings,
      },
      textures,
      members,
      reserves,
      {
        onReorder: (delta) => flow.handleReorder(delta),
        onInsertSoulStone: () => void flow.handleInsertSoulStone(),
        onSortCycle: () => flow.handleSortCycle(),
        onMoveBattingToReserves: (fromIndex, reserveIndex) =>
          flow.handleMoveBattingToReserves(fromIndex, reserveIndex),
        onMoveReserveToBatting: (reserveIndex, battingIndex) =>
          flow.handleMoveReserveToBatting(reserveIndex, battingIndex),
        onRemoveAll: () => void flow.handleRemoveAll(),
        onInspect: (instanceId) => void flow.handleInspect(instanceId),
        onElementHelp: (element) => void flow.handleElementHelp(element),
        onInjury: (instanceId) => void flow.handleInjury(instanceId),
        onClose: () => void flow.handleClose(),
        onClick: () => opts.playSfx("click"),
      },
    );
    flow = new PartyEditorFlow(opts, node, popupHost, session, textures);
    node.setSortOrder(2);
    opts.parent.sortableChildren = true;
    opts.parent.addChild(node);
    if (opts.nativePointerBridge !== undefined) {
      node.installNativeCloseBridge(opts.nativePointerBridge);
    }
    return flow;
  }

  update(dtMs: number): void {
    if (this.disposed) return;
    this.node.update(dtMs);
    this.injuryUpdateMs += dtMs;
    if (this.injuryUpdateMs < 1000) return;
    this.injuryUpdateMs %= 1000;
    if (!this.opts.party.purgeExpiredInjuries(Date.now() / 1000)) return;
    this.captureSelections();
    this.opts.onStateChanged();
    this.refreshNode(
      this.session.selectedBattingIndex(),
      this.session.selectedReserveIndex(),
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.popupHost.dismissOwnedBy(this);
    this.node.close();
  }

  private popupEnvironment() {
    return {
      parent: this.popupHost,
      // A popup that asks for no band keeps its small stack-depth zIndex, which is BELOW a screen
      // that asked for one — so anything raised while the paged Insert Soul Stone display is open
      // has to join its nested band or it renders and hit-tests behind that display.
      ...(this.nestedPopupZIndex === undefined ? {} : { zIndex: this.nestedPopupZIndex }),
      assets: this.opts.assets,
      scale9: this.opts.scale9,
      ticker: this.opts.ticker,
      owner: this,
      sfx: {
        onButtonPress: () => this.opts.playSfx("click"),
        onButtonBlocked: () => this.opts.playSfx("notAllowed"),
      },
    };
  }

  get debugState(): Record<string, unknown> {
    const reserveIds = this.opts.style === 0 ? this.session.reserveOrderIds() : [];
    const reserves = reserveIds.map((id) => this.opts.party.monster(id));
    const centeredReserveVisualIndex = this.node.centeredReserveIndex();
    return {
      open: true,
      screen: "partyEditor",
      style: this.opts.style,
      titleVisible: editorHasTownTitle(this.opts.style),
      reserveRowVisible: editorHasReserveRow(this.opts.style, reserveIds.length),
      sortOrder: this.sortOrder,
      activeIds: this.session.compactActiveIds(),
      activeSlotIds: this.session.battingSlotIds().map((id) => id ?? null),
      reserveIds: this.opts.style === 0
        ? reserves.map((m) => m.instanceId)
        : [],
      reserveEntries: reserves.map((member) => ({
        instanceId: member.instanceId,
        name: localizedRenderableName(this.opts.strings, [member.shortType]),
        stars: this.opts.gd.monsterByShortType(member.shortType).stars,
        level: member.level,
      })),
      members: this.session.compactActiveIds(),
      // The CFlow's showing slot — what every centered-card action (reorder, Insert Soul Stone)
      // operates on. Exposed so harnesses can assert/drive selection instead of guessing.
      centeredBattingIndex: this.node.centeredMemberIndex(),
      centeredBattingId: this.session.battingSlotIds()[this.node.centeredMemberIndex()] ?? null,
      centeredReserveVisualIndex,
      centeredReserveId: centeredReserveVisualIndex === 0
        ? null
        : reserveIds[centeredReserveVisualIndex - 1] ?? null,
      coverflow: this.node.perspectiveDebugState(),
      ownedSoulStones: this.opts.party.ownedSoulStones().length,
      popups: this.popupHost.debugState,
    };
  }

  /** Contextual web back: close the top nested popup first, otherwise mirror the editor's X.
   * The X commits staged batting priority, so this intentionally does not call dispose(). */
  requestBack(): void {
    if (this.disposed) return;
    if (this.popupHost.dismissTop()) return;
    if (this.busy) return;
    this.handleClose();
  }

  // --- callbacks ---------------------------------------------------------------------------

  private handleReorder(delta: number): void {
    if (this.busy) return;
    const fromIndex = this.node.centeredMemberIndex();
    if (!this.session.canMoveBatting(fromIndex, delta)) return;
    this.captureSelections();
    const toIndex = this.session.moveBatting(fromIndex, delta);
    this.refreshNode(toIndex);
  }

  private handleSortCycle(): void {
    this.sortOrder = editorNextSortOrder(this.sortOrder);
    this.node.setSortOrder(this.sortOrder);
    // Style 1 still advances/retextures its icon, but the native reserve collection is nil.
    if (this.opts.style !== 0) return;
    this.captureSelections();
    this.session.sortReserves(compareSessionIds(this.opts, this.sortOrder));
    this.refreshNode(this.node.centeredMemberIndex(), this.node.centeredReserveIndex());
  }

  private handleMoveBattingToReserves(fromIndex: number, reserveIndex: number): void {
    if (this.busy || this.opts.style !== 0) return;
    this.captureSelections();
    if (!this.session.moveBattingToReserve(fromIndex, reserveIndex)) return;
    this.refreshNode(
      this.session.selectedBattingIndex(),
      this.session.selectedReserveIndex(),
    );
  }

  private handleMoveReserveToBatting(reserveIndex: number, battingIndex: number): void {
    if (this.busy || this.opts.style !== 0) return;
    if (this.session.freeSpace() === 0) {
      void this.showMessage("BattingOrderFull");
      return;
    }
    this.captureSelections();
    if (!this.session.moveReserveToBatting(reserveIndex, battingIndex)) return;
    this.refreshNode(
      this.session.selectedBattingIndex(),
      this.session.selectedReserveIndex(),
    );
  }

  private async handleRemoveAll(): Promise<void> {
    if (this.busy || this.opts.style !== 0) return;
    if (this.session.compactActiveIds().length === 0) {
      await this.showMessage("CannotRemoveAllFromBattingOrder");
      return;
    }
    this.busy = true;
    try {
      const confirmed = await this.showConfirmation("ConfirmRemoveAllFromBattingOrder");
      if (!confirmed || this.disposed) return;
      this.captureSelections();
      this.session.removeAll(compareSessionIds(this.opts, this.sortOrder));
      this.refreshNode(0, 0);
    } finally {
      this.busy = false;
    }
  }

  private async handleInsertSoulStone(): Promise<void> {
    if (this.busy) return;
    this.captureSelections();
    const index = this.node.centeredMemberIndex();
    const member = buildSessionBattingModels(this.opts.gd, this.opts.party, this.session)[index];
    if (member === undefined) {
      await this.showMessage("NoCreatureSelectedForSoulStone");
      return;
    }
    const stones = this.opts.party.ownedSoulStoneEntries();
    if (stones.length === 0) {
      await this.showMessage("NoSoulStones");
      return;
    }
    const chosen = await this.showStonePicker();
    if (chosen === null || this.disposed) return;
    const committed = await this.opts.submitAuthoritative?.({
      type: "party.insertSoulStone",
      instanceId: member.instanceId,
      stoneId: chosen,
    });
    this.opts.party.insertSoulStoneByToken(member.instanceId, chosen);
    this.adoptCommittedSoulStoneIds(committed);
    this.opts.onStateChanged();
    this.refreshNode(
      this.session.selectedBattingIndex(),
      this.session.selectedReserveIndex(),
    );
  }

  private async handleInspect(instanceId: string): Promise<void> {
    if (this.busy) return;
    this.captureSelections();
    this.busy = true;
    try {
      const snapshot = this.buildInfoSnapshot(instanceId);
      const infoPopup = new PickerHandle();
      const destroyAction = await this.buildDestroyInfoAction(instanceId, () => infoPopup.dismiss());
      const livingInfo = await buildLivingInfoContent(snapshot, this.opts.assets, this.opts.strings, {
        onElementTap: () => void this.handleElementHelp(snapshot.monster.element),
        onStatTap: (statType) => void this.showMessage(`Stat${LIVING_STAT_NAMES[statType]!}Info`),
        onXpTap: () => void this.showMessage("XPInfo"),
        onAbilityTap: (ability) => void this.showAbilityInfo(this.abilityInfoFor(instanceId, ability)),
        onSoulStoneTap: (stone) => void this.showSoulStoneInfo(stone),
        onSoulStoneTitleTap: () => void this.showMessage("ItemsInfo"),
      }, {
        leadingHeaderAction: {
          node: destroyAction.node,
          gapAfter: editableLivingInfoHeaderGap(DISPLAY_MODE),
          onPress: destroyAction.onPress,
        },
      });
      await new Promise<void>((resolve) => {
        void showMonsterHatchPopup(this.popupEnvironment(), {
          content: livingInfo,
          buttons: [
            {
              label: localizedString(this.opts.strings, "ConvertToSoulStoneKey"),
              closesPopup: false,
              onPress: async () => {
                if (await this.handleConvertConfirm(instanceId)) infoPopup.dismiss();
              },
            },
            { label: localizedString(this.opts.strings, "OkButtonKey"), onPress: () => {} },
          ],
          onDismiss: () => resolve(),
        }).then((popup) => infoPopup.bind(popup));
      });
    } finally {
      this.busy = false;
    }
  }

  private async handleConvertConfirm(instanceId: string): Promise<boolean> {
    if (this.opts.party.monsters().length < 2) {
      await this.showMessage("CannotDestroyLastGuy");
      return false;
    }
    return await this.showDestructiveConfirm(instanceId, "ConfirmMakeSoulStone", async () => {
      const committed = await this.opts.submitAuthoritative?.({
        type: "party.convertToSoulStone",
        instanceId,
      });
      const stone = this.opts.party.convertToSoulStone(instanceId);
      this.adoptCommittedSoulStoneIds(committed);


      this.opts.onQuestEvent?.({ id: 3 });
      this.session.removeMonster(instanceId);
      this.opts.onStateChanged();
      this.refreshNode(
        this.session.selectedBattingIndex(),
        this.session.selectedReserveIndex(),
      );
      await this.showStoneReveal(stone);
    });
  }

  private async handleDestroyConfirm(instanceId: string): Promise<boolean> {
    if (this.opts.party.monsters().length < 2) {
      await this.showMessage("CannotDestroyLastGuy");
      return false;
    }
    return await this.showDestructiveConfirm(instanceId, "ConfirmDestroy", async () => {
      await this.opts.submitAuthoritative?.({
        type: "party.destroyMonster",
        instanceId,
      });
      this.opts.party.destroyMonster(instanceId);
      this.session.removeMonster(instanceId);
      this.opts.onStateChanged();
      this.refreshNode(
        this.session.selectedBattingIndex(),
        this.session.selectedReserveIndex(),
      );
    });
  }

  /**
   * After the local mirror of a committed convert/insert, take the authority's ids for the pool so
   * the next insert echoes a server-issued id instead of a client-minted one.
   */
  private adoptCommittedSoulStoneIds(committed: AuthoritativePartyCommandResult | undefined): void {
    if (committed === undefined) return;
    this.opts.party.adoptOwnedSoulStoneIds(committed.projection.player.ownedSoulStones);
  }

  private handleElementHelp(element: string): void {
    this.opts.playSfx("click");
    if (!ELEMENT_HELP_NAMES.has(element)) return;
    void showMonsterHatchPopup(this.popupEnvironment(), {
      content: buildElementHelpContent(element as ElementHelpName, this.opts.strings),
      buttons: [{ label: localizedString(this.opts.strings, "OkButtonKey"), onPress: () => {} }],
    });
  }

  private async handleClose(): Promise<void> {
    if (this.disposed || this.committed || this.closing) return;
    this.closing = true;
    try {
      this.captureSelections();
      const activeInstanceIds = this.session.compactActiveIds();
      await this.opts.submitAuthoritative?.({
        type: "party.commitBattingPriority",
        activeInstanceIds: [...activeInstanceIds],
      });
      this.opts.party.commitBattingPriority(activeInstanceIds);
      this.committed = true;
      this.opts.onStateChanged();
      this.opts.onClose();
    } finally {
      if (!this.committed) this.closing = false;
    }
  }

  private async handleInjury(instanceId: string): Promise<void> {
    if (this.busy) return;
    this.captureSelections();
    this.busy = true;
    try {
      const nowSeconds = Date.now() / 1000;
      const member = this.opts.party.monster(instanceId);
      if (member.injureTime === undefined || member.healTime === undefined) return;
      if (member.healTime <= nowSeconds) {
        if (this.opts.party.purgeExpiredInjuries(nowSeconds)) {
          this.opts.onStateChanged();
          this.refreshNode(
            this.session.selectedBattingIndex(),
            this.session.selectedReserveIndex(),
          );
        }
        return;
      }
      const displayedCost = this.opts.party.injuryHealCost(instanceId, nowSeconds);
      const confirmed = await new Promise<boolean>((resolve) => {
        let accepted = false;
        void showMonsterHatchPopup(this.popupEnvironment(), {
          title: localizedString(this.opts.strings, "InjuredMonsterIconTouchTitleKey"),
          content: buildMonsterHatchMessageContent(
            localizedString(this.opts.strings, "InjuredMonsterIconTouchMessageKey")
              .replace("%d", String(displayedCost)),
          ),
          buttons: [
            {
              label: localizedString(this.opts.strings, "YesGoldFormatKey")
                .replace("%d", String(displayedCost)),
              onPress: () => { accepted = true; },
            },
            {
              label: localizedString(this.opts.strings, "NoButtonKey"),
              onPress: () => {},
            },
          ],
          onDismiss: () => resolve(accepted),
        });
      });
      if (!confirmed || this.disposed) return;
      const result = await this.opts.healInjury(instanceId, Date.now() / 1000);
      if (!result.ok) {
        await this.showMessage("NotEnoughGold");
        return;
      }
      this.refreshNode(
        this.session.selectedBattingIndex(),
        this.session.selectedReserveIndex(),
      );
    } finally {
      this.busy = false;
    }
  }

  // --- helpers -----------------------------------------------------------------------------

  private refreshNode(selectedIndex: number, selectedReserveIndex = this.node.centeredReserveIndex()): void {
    this.session.setSelections(selectedIndex, selectedReserveIndex);
    this.node.refresh(
      buildSessionBattingModels(this.opts.gd, this.opts.party, this.session),
      this.opts.style === 0
        ? buildSessionReserveModels(this.opts.gd, this.opts.party, this.session)
        : [],
      this.session.selectedBattingIndex(),
      this.session.selectedReserveIndex(),
    );
  }

  private captureSelections(): void {
    this.session.setSelections(
      this.node.centeredMemberIndex(),
      this.node.centeredReserveIndex(),
    );
  }

  private async buildDestroyInfoAction(
    instanceId: string,
    dismissInfo: () => void,
  ): Promise<{ node: Sprite; onPress: () => void }> {


    const destroy = pointSprite(await this.opts.assets.sprite("destroyMonster-hd"));
    destroy.label = "destroyMonsterAction";
    destroy.eventMode = "none";
    destroy.cursor = "pointer";
    let invoking = false;
    const onPress = (): void => {
      if (invoking || this.disposed) return;
      invoking = true;
      this.opts.playSfx("click");
      void this.handleDestroyConfirm(instanceId).then((destroyed) => {
        if (destroyed) dismissInfo();
      }).finally(() => { invoking = false; });
    };
    return { node: destroy, onPress };
  }

  private async showDestructiveConfirm(
    instanceId: string,
    messageName: "ConfirmMakeSoulStone" | "ConfirmDestroy",
    onConfirm: () => void | Promise<void>,
  ): Promise<boolean> {
    const destructive = await this.buildDestructiveContent(instanceId, messageName);
    return await new Promise<boolean>((resolve) => {
      let result = false;
      void showMonsterHatchPopup(this.popupEnvironment(), {
        // LivingInfoDisplay convert/destroy both call popupConfigurationForContent: directly
        // after buildDestroyBoxForText:; neither source path sets a title on the popup.
        content: destructive.content,
        buttons: [
          {
            label: localizedString(this.opts.strings, "DestroyMyMonsterForeverKey"),
            onPress: async () => {
              if (this.disposed) return;
              await onConfirm();
              if (!this.disposed) result = true;
            },
          },
          { label: localizedString(this.opts.strings, "CancelButtonKey"), onPress: () => {} },
        ],
        onPresent: destructive.startParticles,
        onDismiss: () => resolve(result),
      });
    });
  }

  private async buildDestructiveContent(
    instanceId: string,
    messageName: "ConfirmMakeSoulStone" | "ConfirmDestroy",
  ): Promise<{ content: PixiContainer; startParticles: () => void }> {
    const member = this.opts.party.monster(instanceId);
    const monsterData = this.opts.gd.monsterByShortType(member.shortType);
    const [monsterTexture, particleAsset] = await Promise.all([
      this.opts.assets.sprite(`${member.shortType}-hd`),
      this.opts.assets.particle("destroyMonsterParticles.plist"),
    ]);

    const layout = destructivePopupLayout(DISPLAY_MODE);
    // The source Box advances negatively in Cocos Y-up. Pixi's Y-down adapter must advance
    // positively to keep the identical authored order: description first, renderer BELOW it.
    const root = new Box({
      horizontal: false,
      positiveAlignDirection: true,
      gap: layout.gap,
      roundingScale: layout.roundingScale,
    });
    root.label = `destructiveConfirm:${instanceId}`;
    const message = makeTtfLabel(
      localizedString(this.opts.strings, `${messageName}MessageKey`),
      layout.messageFontSize,
      { outline: false, wordWrapWidth: layout.messageWidth, align: "center" },
    );
    message.anchor.set(0.5);
    message.position.set(layout.messageWidth / 2, layout.messageHeight / 2);
    const messageBox = new PixiContainer();
    messageBox.addChild(message);
    root.addBoxChild(messageBox, {
      contentSize: { w: layout.messageWidth, h: layout.messageHeight },
    });

    const monsterNode = createRenderableSpriteNode({
      texture: monsterTexture,
      rendererData: monsterData.rendererData,
      label: `renderable:${member.shortType}`,
    });
    root.addBoxChild(monsterNode);
    if (monsterNode.position.y !== layout.rendererY) {
      throw new Error(
        `LivingInfoDisplay: renderer Y ${monsterNode.position.y} != source layout ${layout.rendererY}`,
      );
    }


    const particlePlacement = destroyParticlePlacement({
      position: monsterNode.position,
      scaledContentSize: renderableScaledContentSize(monsterNode),
    });
    const particles = new SourcePointParticleSystem({
      asset: particleAsset,
      configName: "destroyMonsterParticles.plist",
      mode: DISPLAY_MODE,
      ticker: this.opts.ticker,
      positionVariance: particlePlacement.positionVariance,
      presentationScale: () => {
        const matrix = this.opts.parent.parent?.getGlobalTransform();
        return matrix ? Math.hypot(matrix.a, matrix.b) : 1;
      },
    });
    particles.label = "destroyMonsterParticles";
    particles.position.set(particlePlacement.position.x, particlePlacement.position.y);
    particles.visible = false;
    root.addChild(particles);

    return {
      content: root,
      startParticles: () => {
        if (particles.destroyed || root.destroyed) return;
        particles.visible = true;
        particles.start();
      },
    };
  }

  private buildInfoSnapshot(instanceId: string): LivingInfoSnapshot {
    const member = this.opts.party.monster(instanceId);
    const monster = this.opts.gd.monsterByShortType(member.shortType);
    const level = member.level;
    const stone = member.soulStone;
    // The party aggregate owns the effective-stat accumulator (species/level + stone + the
    // permanent hero-skill/Gem buff children), so the card shows exactly what a heal or a battle
    // would compute for this monster.
    const effective = this.opts.party.statsOf(instanceId);
    const stats = STAT_ENUM.map(([statType, statName]) => ({
      statType,
      value: effective[statName],
    })).filter((row) => row.value >= 1);

    const abilities: LivingInfoAbility[] = buildPlayerChoices(this.opts.gd, member.shortType).map((choice) => ({
      kind: "usable",
      choice: {
        ...choice,
        displayName: localizedRenderableName(this.opts.strings, [
          choice.displayName,
          choice.abilityPath.split(".").at(-1)!,
        ]),
      },
    }));
    for (const ref of this.opts.gd.jobAbilitiesOrEmpty(member.shortType)) {
      if (/^usable\d+$/.test(ref.slot)) continue;
      const typeName = ref.type.split(".").at(-1)!;
      const instanceName = ref.arguments["instanceName"];
      abilities.push({
        kind: "passive",
        ref,
        displayName: localizedRenderableName(this.opts.strings, [
          typeof instanceName === "string" ? instanceName : typeName,
          typeName,
        ]),
      });
    }

    const soulStones = stone === undefined
      ? []
      : [{
          name: localizedRenderableName(this.opts.strings, [`${stone.element}SoulStone`]),
          stats: soulStoneStatRows(stone.level, this.opts.gd.soulStoneByElement(stone.element).enabledStats),
        }];

    const penalty = this.opts.gd.jobXpPenalty(member.shortType);
    return {
      name: localizedRenderableName(this.opts.strings, [member.shortType]),
      monster,
      level,
      hp: member.currentHp,
      maxHp: effective["MaxHP"],
      xpThisLevel: member.cumulativeXp - jobXpForLevel(level, penalty),
      xpCostOfNextLevel: jobXpCostOfNextLevel(level, penalty),
      stats,
      abilities,
      soulStones,
      // The editable card uses the same collection-gated evolution rows as the battle/view card.
      evolveRows: evolveChainInfoRows(
        this.opts.gd.evolveChainOf(member.shortType),
        this.opts.hasCapturedSimpleType,
        (shortType) => this.opts.gd.monsterByShortType(shortType),
      ),
    };
  }


  private abilityInfoFor(instanceId: string, ability: LivingInfoAbility): AbilityInfoModel {
    const member = this.opts.party.monster(instanceId);
    const monster = this.opts.gd.monsterByShortType(member.shortType);
    const stats = this.opts.party.statsOf(instanceId);
    const context: AbilityInfoContext = { level: member.level, stats, element: monster.element };
    return ability.kind === "usable"
      ? buildAbilityInfoModel(
          this.opts.gd,
          this.opts.strings,
          member.shortType,
          ability.choice,
          context,
        )
      : buildPassiveAbilityInfoModel(
          this.opts.gd,
          this.opts.strings,
          ability.ref,
          ability.displayName,
          context,
        );
  }


  private async showAbilityInfo(model: AbilityInfoModel): Promise<void> {
    await showMonsterHatchPopup(this.popupEnvironment(), {
      content: buildAbilityInfoContent(model),
      buttons: [{ label: localizedString(this.opts.strings, "OkButtonKey"), onPress: () => {} }],
      hideOverlays: true,
    });
  }

  private async showStonePicker(): Promise<string | null> {
    this.busy = true;
    this.nestedPopupZIndex = PARTY_SOUL_STONE_PICKER_NESTED_Z_INDEX;
    try {
      return await showPartySoulStonePicker({
        parent: this.popupHost,
        owner: this,
        assets: this.opts.assets,
        scale9: this.opts.scale9,
        strings: this.opts.strings,
        ticker: this.opts.ticker,
        data: this.opts.gd,
        title: localizedString(this.opts.strings, "InsertSoulStoneKey"),
        entries: () => this.opts.party.ownedSoulStoneEntries(),
        soulStoneTextures: this.textures.soulStoneByElement,
        statTextures: this.textures.statByName,
        buildRowDisplay: (pickerOpts, entry) => this.buildStonePickerRowDisplay(pickerOpts, entry),
        onClick: () => this.opts.playSfx("click"),
        onBlocked: () => this.opts.playSfx("notAllowed"),
        // Official v22 does not advertise a soul-stone discard intent. Keep that action
        // fail-closed there; local play uses the source's generic item-drop transaction.
        ...(this.opts.submitAuthoritative === undefined
          ? {
              onDrop: (token: string) => {
                this.opts.party.dropSoulStoneByToken(token);
                this.opts.onStateChanged();
              },
            }
          : {}),
        onInfo: (stone) => this.showSoulStoneInfo({
          name: this.stoneName(stone),
          stats: soulStoneStatRows(
            stone.level,
            this.opts.gd.soulStoneByElement(stone.element).enabledStats,
          ),
        }),
      });
    } finally {
      this.busy = false;
      this.nestedPopupZIndex = undefined;
    }
  }

  /** One owned-stone picker row's `SmallItemDisplay` body, kept as an instance member so an item
   *  the shipped positive-stat strip cannot describe can be composed here instead. The paged
   *  screen still owns the row wrapper, selection, hit arbitration, and Drop/Insert/Info. */
  private buildStonePickerRowDisplay(
    opts: PartySoulStonePickerOptions,
    entry: OwnedSoulStoneEntry,
  ): Box {
    return buildPartySoulStonePickerRowDisplay(opts, entry);
  }

  private stoneName(stone: SoulStoneSetup): string {
    return localizedRenderableName(this.opts.strings, [`${stone.element}SoulStone`]);
  }

  private async showSoulStoneInfo(stone: { name: string; stats: readonly { statType: 0 | 1 | 2 | 3 | 4 | 5; value: number }[] }): Promise<void> {
    const content = await buildSoulStoneInfoContent(stone, this.opts.assets, {
      onStatTap: (statType) => void this.showMessage(`Stat${LIVING_STAT_NAMES[statType]!}Info`),
    });
    await showMonsterHatchPopup(this.popupEnvironment(), {
      content,
      buttons: [{ label: localizedString(this.opts.strings, "OkButtonKey"), onPress: () => {} }],
      gapBeforeButtons: ITEM_INFO_GAP_BEFORE_BUTTONS,
    });
  }

  private async showStoneReveal(stone: SoulStoneSetup): Promise<void> {
    if (this.disposed) return;
    const content = await buildSoulStoneInfoContent(
      {
        name: this.stoneName(stone),
        stats: soulStoneStatRows(stone.level, this.opts.gd.soulStoneByElement(stone.element).enabledStats),
      },
      this.opts.assets,
      {},
    );
    if (this.disposed) {
      content.destroy({ children: true });
      return;
    }
    await showMonsterHatchPopup(this.popupEnvironment(), {
      content,
      buttons: [{ label: localizedString(this.opts.strings, "OkButtonKey"), onPress: () => {} }],
      gapBeforeButtons: ITEM_INFO_GAP_BEFORE_BUTTONS,
    });
  }

  private async showConfirmation(name: string): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      let confirmed = false;
      void showMonsterHatchPopup(this.popupEnvironment(), {
        title: localizedString(this.opts.strings, `${name}TitleKey`),
        content: buildLocalizedMonsterHatchMessageContent(this.opts.strings, name),
        buttons: [
          {
            label: localizedString(this.opts.strings, "YesButtonKey"),
            onPress: () => { confirmed = true; },
          },
          {
            label: localizedString(this.opts.strings, "NoButtonKey"),
            onPress: () => {},
          },
        ],
        onDismiss: () => resolve(confirmed),
      });
    });
  }

  private async showMessage(name: string): Promise<void> {
    await new Promise<void>((resolve) => {
      void showMonsterHatchPopup(this.popupEnvironment(), {
        title: localizedString(this.opts.strings, `${name}TitleKey`),
        content: buildLocalizedMonsterHatchMessageContent(this.opts.strings, name),
        buttons: [{ label: localizedString(this.opts.strings, "OkButtonKey"), onPress: () => {} }],
        onDismiss: () => resolve(),
      });
    });
  }

}

function compareSessionIds(
  opts: Pick<PartyEditorFlowOpts, "party" | "gd" | "strings">,
  order: EditorSortOrder,
): (leftId: string, rightId: string) => number {
  return (leftId, rightId) => {
    const left = opts.party.monster(leftId);
    const right = opts.party.monster(rightId);
    return compareEditorSortValues(order, {
      localizedName: localizedRenderableName(opts.strings, [left.shortType]),
      stars: opts.gd.monsterByShortType(left.shortType).stars,
      level: left.level,
    }, {
      localizedName: localizedRenderableName(opts.strings, [right.shortType]),
      stars: opts.gd.monsterByShortType(right.shortType).stars,
      level: right.level,
    });
  };
}

function buildMemberModels(
  gd: GameData,
  members: ReturnType<WorldTripParty["monsters"]>,
): EditorMemberModel[] {
  return members.map((member) => {
    const monster = gd.monsterByShortType(member.shortType);
    const rendererScale = rendererScaleOf(monster.rendererData);
    return {
      instanceId: member.instanceId,
      shortType: member.shortType,
      level: member.level,
      element: monster.element,
      dead: member.currentHp === 0,
      stars: monster.stars,
      ...(monster.evolveData === undefined
        ? {}
        : { evolveLevel: monster.evolveData.levelReq }),
      ...previousEvolveLevel(gd, member.shortType),
      ...(member.soulStone === undefined
        ? {}
        : { soulStoneElement: member.soulStone.element }),
      ...(member.injureTime === undefined || member.healTime === undefined
        ? {}
        : { injury: { injureTime: member.injureTime, healTime: member.healTime } }),
      ...(rendererScale !== undefined ? { rendererScale } : {}),
    };
  });
}

function buildSessionBattingModels(
  gd: GameData,
  party: WorldTripParty,
  session: PartyEditorSession,
): Array<EditorMemberModel | undefined> {
  return session.battingSlotIds().map((id) =>
    id === undefined ? undefined : buildMemberModels(gd, [party.monster(id)])[0]!);
}

function buildSessionReserveModels(
  gd: GameData,
  party: WorldTripParty,
  session: PartyEditorSession,
): EditorMemberModel[] {
  return buildMemberModels(
    gd,
    session.reserveOrderIds().map((id) => party.monster(id)),
  );
}

async function loadEditorTextures(
  assets: AssetLibrary,
  scale9: Scale9SpritesData,
  strings: LocalizedStrings,
  gd: GameData,
  party: WorldTripParty,
  style: 0 | 1,
): Promise<PartyEditorTextures> {
  const members = style === 0 ? party.monsters() : party.battingOrderMonsters();
  const hasInjury = members.some(
    (member) => member.injureTime !== undefined && member.healTime !== undefined,
  );
  const shortTypes = [...new Set(members.map((m) => m.shortType))];
  const [
    background,
    close,
    cardBackground,
    reserveCardBackground,
    emptySlotHeads,
    emptySlotArrows,
    arrowOrderAllLeft,
    arrowOrderLeft,
    arrowOrderRight,
    arrowOrderAllRight,
    soulStone,
    removeAll,
    sortName,
    sortStars,
    sortLevel,
    general,
    monsterpedia,
    inventoryItems,
    injured,
    injuredBw,
    ...monsterTextures
  ] = await Promise.all([
    assets.sprite("MMScreen"),
    assets.sprite("PopupMenuCloseButton-hd"),
    assets.sprite("inBattingOrderBkg-hd"),
    assets.sprite("notInBattingOrderBkg-hd"),
    assets.sprite("emptySlotHeads-hd"),
    assets.sprite("emptySlotArrows-hd"),
    assets.sprite("orderAllLeftArrow-hd"),
    assets.sprite("orderLeftArrow-hd"),
    assets.sprite("orderRightArrow-hd"),
    assets.sprite("orderAllRightArrow-hd"),
    assets.sprite("soulStoneButton-hd"),
    assets.sprite("removeAllFromBattingOrder-hd"),
    assets.sprite("sortByName-hd"),
    assets.sprite("sortByStars-hd"),
    assets.sprite("sortByLevel-hd"),
    assets.atlas("General-hd"),
    assets.atlas("MonsterpediaFrames-hd"),
    assets.atlas("InventoryItemFrames-hd"),
    hasInjury ? assets.sprite("injured-hd") : Promise.resolve(undefined),
    hasInjury ? assets.sprite("injured_bw-hd") : Promise.resolve(undefined),
    ...shortTypes.map((shortType) => assets.sprite(`${shortType}-hd`)),
  ]);
  const rarityStar = monsterpedia.textures["rarityStar.png"];
  if (!rarityStar) {
    throw new Error("PartyEditorFlow: MonsterpediaFrames-hd is missing rarityStar.png");
  }
  const monsterByShortType = new Map<string, import("pixi.js").Texture>();
  shortTypes.forEach((shortType, i) => monsterByShortType.set(shortType, monsterTextures[i]!));
  const elementByName = new Map<string, import("pixi.js").Texture>();
  const soulStoneByElement = new Map<string, import("pixi.js").Texture>();
  const statByName = new Map<string, import("pixi.js").Texture>();
  for (const statName of LIVING_STAT_NAMES) {
    const texture = general.textures[`Stat${statName}.png`];
    if (!texture) throw new Error(`PartyEditorFlow: General-hd is missing Stat${statName}.png`);
    statByName.set(statName, texture);
  }
  const requiredElements = new Set<string>(party.ownedSoulStones().map((stone) => stone.element));
  for (const shortType of shortTypes) {
    requiredElements.add(gd.monsterByShortType(shortType).element);
  }
  for (const element of requiredElements) {
    const texture = general.textures[`Element${element}.png`];
    if (!texture) throw new Error(`PartyEditorFlow: General-hd is missing Element${element}.png`);
    elementByName.set(element, texture);
  }
  // The source resolves each equipped item's sprite by frame name out of the fully loaded
  // `InventoryItemFrames-hd` cache at draw time, so it has no notion of a preloaded element set.
  // Keying only the elements present at open breaks Convert To Soul Stone, which MINTS a stone of
  // the sacrificed monster's element mid-session and can then be equipped through Insert Soul
  // Stone. Mirror the source and key every Soul Stone frame the atlas ships.
  for (const [frameName, texture] of Object.entries(inventoryItems.textures)) {
    const element = /^(.+)SoulStone\.png$/.exec(frameName)?.[1];
    if (element !== undefined) soulStoneByElement.set(element, texture);
  }
  const itemElements = new Set<string>(party.ownedSoulStones().map((stone) => stone.element));
  for (const member of party.monsters()) {
    if (member.soulStone !== undefined) itemElements.add(member.soulStone.element);
  }
  for (const element of itemElements) {
    if (!soulStoneByElement.has(element)) {
      throw new Error(
        `PartyEditorFlow: InventoryItemFrames-hd is missing ${element}SoulStone.png`,
      );
    }
  }
  let sortLabelButton: PartyEditorTextures["sortLabelButton"];
  if (style === 0) {
    const label = makeTtfLabel(
      localizedString(strings, "SortButtonKey"),
      idiomPairPt(16, 32, DISPLAY_MODE),
      { outline: false },
    );
    const prepared = await prepareMenuButton2({
      assets,
      scale9,
      label,
    });
    sortLabelButton = {
      node: prepared.node,
      contentSize: prepared.layoutContentSize,
      visibleRect: prepared.visibleRect,
    };
  }
  return {
    background,
    close,
    cardBackground,
    reserveCardBackground,
    emptySlotHeads,
    emptySlotArrows,
    arrowOrderAllLeft,
    arrowOrderLeft,
    arrowOrderRight,
    arrowOrderAllRight,
    soulStone,
    removeAll,
    rarityStar,
    sortIcons: [sortName, sortStars, sortLevel],
    ...(sortLabelButton === undefined ? {} : { sortLabelButton }),
    monsterByShortType,
    elementByName,
    soulStoneByElement,
    statByName,
    ...(injured === undefined || injuredBw === undefined ? {} : { injured, injuredBw }),
  };
}

function rendererScaleOf(rendererData: unknown): number | undefined {
  if (rendererData === null || typeof rendererData !== "object") return undefined;
  const scale = (rendererData as Record<string, unknown>)["scale"];
  return typeof scale === "number" ? scale : undefined;
}

function previousEvolveLevel(
  gd: GameData,
  shortType: string,
): { previousEvolveLevel?: number } {
  const chain = gd.evolveChainOf(shortType);
  const index = chain.indexOf(shortType);
  if (index <= 0) return {};
  const predecessor = gd.monsterByShortType(chain[index - 1]!);
  return predecessor.evolveData === undefined
    ? {}
    : { previousEvolveLevel: predecessor.evolveData.levelReq };
}

interface DestroyParticle {
  readonly sprite: Sprite;
  ageMs: number;
  readonly lifeMs: number;
  vx: number;
  vy: number;
  readonly startSize: number;
  readonly finishSize: number;
  readonly start: readonly [number, number, number, number];
  readonly finish: readonly [number, number, number, number];
}

/** Continuous `destroyMonsterParticles.plist` emitter used by the original destructive card. */
class DestroyMonsterParticles extends PixiContainer {
  private readonly particles: DestroyParticle[] = [];

  private emitCounterSeconds = 0;
  private started = false;
  /** Point-space plist quantities — emitter origin, speed, gravity — all live in the node's own
   *  Cocos coordinate space, so they convert from source points to port points per idiom. Particle
   *  SIZE does not: see `destroyParticleSizePt`, which is pixel-space and idiom-independent. */
  private readonly spaceScale = 1 / sourcePointsPerPortPoint(DISPLAY_MODE);
  private readonly updateFn = (): void => this.update(this.ticker.deltaMS);

  constructor(
    private readonly asset: ParticleAsset,
    private readonly ticker: Ticker,
    private readonly positionVariance: Readonly<{ x: number; y: number }>,
  ) {
    super();
    this.label = "destroyMonsterParticles";
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.ticker.add(this.updateFn);
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    if (this.started) this.ticker.remove(this.updateFn);
    super.destroy(options);
  }

  private number(key: string): number {
    const value = this.asset.config[key];
    if (typeof value !== "number") throw new Error(`destroyMonsterParticles.plist is missing numeric ${key}`);
    return value;
  }

  private variance(baseKey: string, varianceKey: string): number {
    return this.number(baseKey) + (Math.random() * 2 - 1) * this.number(varianceKey);
  }

  private optionalNumber(key: string): number {
    const value = this.asset.config[key];
    return typeof value === "number" ? value : 0;
  }

  private color(prefix: "start" | "finish"): [number, number, number, number] {
    const channel = (name: "Red" | "Green" | "Blue" | "Alpha"): number =>
      Math.max(0, Math.min(1,
        this.number(`${prefix}Color${name}`) +
        (Math.random() * 2 - 1) * this.optionalNumber(`${prefix}ColorVariance${name}`),
      ));
    return [channel("Red"), channel("Green"), channel("Blue"), channel("Alpha")];
  }

  private spawn(): void {
    const lifeMs = destroyParticleLifetimeMs(
      this.number("particleLifespan"),
      this.number("particleLifespanVariance"),
      Math.random() * 2 - 1,
    );
    const angle = (this.variance("angle", "angleVariance") * Math.PI) / 180;
    const speed = this.variance("speed", "speedVariance") * this.spaceScale;
    const sprite = pointSprite(this.asset.texture);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    const randomSigned = (): number => Math.random() * 2 - 1;
    sprite.position.set(
      this.number("sourcePositionx") * this.spaceScale + this.positionVariance.x * randomSigned(),
      -this.number("sourcePositiony") * this.spaceScale + this.positionVariance.y * randomSigned(),
    );
    const startSize = destroyParticleSizePt(
      this.number("startParticleSize"),
      this.number("startParticleSizeVariance"),
      Math.random() * 2 - 1,
      CONTENT_SCALE_FACTOR,
    );
    const finishSize = destroyParticleSizePt(
      this.number("finishParticleSize"),
      this.number("finishParticleSizeVariance"),
      Math.random() * 2 - 1,
      CONTENT_SCALE_FACTOR,
    );
    sprite.width = startSize;
    sprite.height = startSize;
    this.addChild(sprite);
    this.particles.push({
      sprite,
      ageMs: 0,
      lifeMs,
      vx: Math.cos(angle) * speed,
      vy: -Math.sin(angle) * speed,
      startSize,
      finishSize,
      start: this.color("start"),
      finish: this.color("finish"),
    });
  }

  private update(dtMs: number): void {
    const maxParticles = Math.max(1, Math.trunc(this.number("maxParticles")));
    const baseLife = this.number("particleLifespan");
    // `initWithDictionary:` derives emissionRate as totalParticles/life; `update:` accumulates
    // elapsed seconds and emits only while counter > 1/rate (strict, not >=).
    const emissionRate = baseLife === 0 ? 0 : maxParticles / baseLife;
    const emission = advanceDestroyParticleEmission(
      this.emitCounterSeconds,
      dtMs / 1000,
      emissionRate,
      maxParticles - this.particles.length,
    );
    this.emitCounterSeconds = emission.emitCounterSeconds;
    for (let i = 0; i < emission.spawnCount; i++) this.spawn();

    const gravityX = this.number("gravityx") * this.spaceScale;
    const gravityY = -this.number("gravityy") * this.spaceScale;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i]!;
      particle.ageMs += dtMs;
      // A source-clamped zero-life particle is initialized, then removed in the same update.
      const t = particle.lifeMs <= 0 ? 1 : Math.min(1, particle.ageMs / particle.lifeMs);
      const dt = dtMs / 1000;
      particle.vx += gravityX * dt;
      particle.vy += gravityY * dt;
      particle.sprite.position.x += particle.vx * dt;
      particle.sprite.position.y += particle.vy * dt;
      const size = particle.startSize + (particle.finishSize - particle.startSize) * t;
      particle.sprite.width = size;
      particle.sprite.height = size;
      const rgb = particle.start.slice(0, 3).map((value, index) =>
        value + (particle.finish[index]! - value) * t,
      );
      particle.sprite.tint =
        (Math.round(Math.max(0, Math.min(1, rgb[0]!)) * 255) << 16) |
        (Math.round(Math.max(0, Math.min(1, rgb[1]!)) * 255) << 8) |
        Math.round(Math.max(0, Math.min(1, rgb[2]!)) * 255);
      particle.sprite.alpha = particle.start[3] + (particle.finish[3] - particle.start[3]) * t;
      if (t >= 1) {
        particle.sprite.destroy();
        this.particles.splice(i, 1);
      }
    }
  }
}

/** Thin late-bindable holder so a picker row tap can dismiss the popup created in the same
 *  Promise executor (the Popup instance only exists after `show()` resolves). */
class PickerHandle {
  private popup: Popup | undefined;
  private pendingDismiss = false;

  bind(popup: Popup): void {
    this.popup = popup;
    if (this.pendingDismiss) popup.dismiss();
  }

  dismiss(): void {
    if (this.popup === undefined) {
      this.pendingDismiss = true;
      return;
    }
    this.popup.dismiss();
  }
}
