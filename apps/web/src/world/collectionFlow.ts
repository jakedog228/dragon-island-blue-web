import { QuestCatalog, type CollectionGoalDefinition } from "@dib/gamedata/browser";
import {
  emptyGuildQuestStateSnapshot,
  GuildQuestRuntime,
  type CollectionGoalProgress,
  type GuildQuestStateSnapshot,
  type PlayerReward,
  type Rng,
} from "@dib/engine";
import type { AppliedPlayerReward } from "@dib/player-domain";
import {
  makeTtfLabel,
  minimumHitRectLocal,
  pointSprite,
  type AssetLibrary,
  type Scale9SpritesData,
} from "@dib/renderer";
import {
  Container,
  Rectangle,
  type FederatedPointerEvent,
  type Text,
  type Ticker,
} from "pixi.js";
import type { LocalizedStrings } from "../localization.js";
import { localizedString } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode } from "../displayMode.js";
import { buildPopupMenuView } from "../ui/popupMenuView.js";
import { popupMenuGeometry } from "../ui/popupMenuMath.js";
import { Popup, PopupHost } from "../ui/popup.js";
import {
  buildMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  showGuildQuestChat,
  type GuildQuestChatHandle,
} from "./guildQuestChat.js";
import {
  collectionCloseItemLayout,
  collectionCompletedRowTint,
  collectionMenuMetrics,
  formatCollectionRowLabel,
} from "./collectionMath.js";

export interface CollectionFlowRowState {
  readonly goalKey: string;
  readonly label: string;
  readonly percentComplete: number;
  readonly complete: boolean;
  readonly claimed: boolean;
  readonly enabled: true;
  readonly tint: number;
}

export type CollectionClaimResult =
  | {
      readonly ok: false;
      readonly reason: "incomplete" | "already-claimed";
      readonly progress: CollectionGoalProgress;
    }
  | {
      readonly ok: true;
      readonly progress: CollectionGoalProgress;
      readonly rewards: readonly PlayerReward[];
      readonly applied: readonly AppliedPlayerReward[];
      /** Destroy-on-pickup Eggs the claim generated but could not settle; the flow hatches them. */
      readonly pendingEggs: readonly (
        | "silver"
        | "gold"
        | { readonly kind: "silver"; readonly repeatPicks: number }
      )[];
    };

export interface CollectionFlowRuntime {
  collectionGoalProgress(goal: CollectionGoalDefinition): CollectionGoalProgress;
  /**
   * Settles one complete goal. The local runtime commits synchronously; the Official runtime awaits
   * the authority's `collection.claim` before mirroring the committed rewards, so the flow awaits
   * the result either way.
   */
  claimCollectionGoal(
    goal: CollectionGoalDefinition,
    rng: Rng,
    allocateMonsterInstanceId: (shortType: string, level: number) => string,
  ): CollectionClaimResult | Promise<CollectionClaimResult>;
}

/** Presentation boundary for the owner-scoped Collection controller. The Pixi implementation
 * lives beside this controller; tests can exercise durable branching without fabricating assets. */
export interface CollectionFlowPresentation {
  mountBase(options: {
    readonly title: string;
    readonly rows: readonly CollectionFlowRowState[];
    readonly onSelect: (goalKey: string) => void;
    readonly onClose: () => void;
  }): Promise<void>;
  installCompletedTint(goalKeys: readonly string[]): void;
  updateRows(rows: readonly CollectionFlowRowState[]): void;
  setBaseVisible(visible: boolean): void;
  showMessage(options: {
    readonly title: string;
    readonly message: string;
    readonly okLabel: string;
  }): Promise<void>;
  showChat(message: string, onDismiss: () => void): Promise<void>;
  showRewards(rewards: readonly PlayerReward[]): Promise<void>;
  requestBack(): boolean;
  dispose(): void;
}

export interface CollectionFlowOptions {
  readonly catalog: ReadonlyMap<string, readonly CollectionGoalDefinition[]>;
  readonly strings: LocalizedStrings;
  readonly runtime: CollectionFlowRuntime;
  readonly rng: Rng;
  readonly allocateMonsterInstanceId: (shortType: string, level: number) => string;
  readonly requestChatPresentation: (name: string, alwaysShow: boolean) => boolean;
  /**
   * Runs one Egg hatch to completion. The world owns this because the hatch is the same
   * presentation quest loot and the Store use, and online it is a server continuation rather than
   * anything the Collection claim can settle by itself.
   */
  readonly hatchEgg: (
    kind: "silver" | "gold",
    options?: { readonly repeatPicks?: number },
  ) => Promise<void>;
  readonly presentation: CollectionFlowPresentation;
  readonly onClose: () => void;
}

export interface WorldCollectionAdapter {
  /**
   * Which authority settles a claim. The world scene asserts this against its own mode: an Official
   * session must never reach the browser-local claim path, and an offline session has no authority
   * to reach.
   */
  readonly mode: "local" | "official";
  requestChatPresentation(name: string, alwaysShow: boolean): boolean;
  allocateMonsterInstanceId(shortType: string, level: number): string;
  /**
   * Claim owner for this mode. Absent locally, where the world's own player aggregate is the owner;
   * present online, where the aggregate may only mirror what the authority already committed.
   */
  readonly runtime?: CollectionFlowRuntime;
}

/** Local packages may promote Collection without carrying the separate Guild/story quest catalog. */
export function createCollectionDialogRuntime(
  snapshot?: GuildQuestStateSnapshot,
): GuildQuestRuntime {
  if (snapshot !== undefined && hasQuestSpecificState(snapshot)) {
    throw new Error("Collection-only package: saved quest state requires Quests.plist");
  }
  return new GuildQuestRuntime(
    new QuestCatalog([]),
    snapshot ?? emptyGuildQuestStateSnapshot(),
  );
}

/** Selects the local dialog-only persistence owner from the already-validated Collection route.
 * A restored snapshot may not disappear merely because the package has no Guild quest catalog. */
export function createLocalCollectionDialogRuntime(options: {
  readonly official: boolean;
  readonly hasCollectionRoute: boolean;
  readonly snapshot?: GuildQuestStateSnapshot;
}): GuildQuestRuntime | undefined {
  if (options.snapshot !== undefined && (options.official || !options.hasCollectionRoute)) {
    throw new Error("saved game contains Guild quest state, but the selected package has no Quests.plist");
  }
  if (options.official || !options.hasCollectionRoute) return undefined;
  return createCollectionDialogRuntime(options.snapshot);
}

function hasQuestSpecificState(snapshot: GuildQuestStateSnapshot): boolean {
  return snapshot.activeQuestNames.length > 0 ||
    snapshot.finishedQuestNames.length > 0 ||
    Object.keys(snapshot.progressByQuestName).length > 0 ||
    snapshot.completedFixedEncounterKeys.length > 0 ||
    snapshot.receivedBattleRewardKeys.length > 0;
}

/** Installs the source dialog/identity seams only for a local session with durable dialog state. */
export function createLocalCollectionAdapter(options: {
  readonly official: boolean;
  readonly hasCollectionRoute: boolean;
  readonly dialogs: {
    requestChatPresentation(name: string, alwaysShow: boolean): boolean;
  } | undefined;
  readonly nextPartyInstanceId: (prefix: string, shortType: string) => string;
}): WorldCollectionAdapter | undefined {
  if (options.official || !options.hasCollectionRoute || options.dialogs === undefined) return undefined;
  return {
    mode: "local",
    requestChatPresentation: (name, alwaysShow) =>
      options.dialogs!.requestChatPresentation(name, alwaysShow),
    allocateMonsterInstanceId: (shortType) =>
      options.nextPartyInstanceId("collection-reward", shortType),
  };
}

/**
 * The live player aggregate an Official claim mirrors into. Only the two Collection seams are
 * required, so a test can supply a stub and `PlayerRuntimeState` satisfies it structurally.
 */
export interface OfficialCollectionMirror {
  collectionGoalProgress(goal: CollectionGoalDefinition): CollectionGoalProgress;
  mirrorCommittedCollectionClaim(
    goal: CollectionGoalDefinition,
    rewards: readonly PlayerReward[],
    committedMonsterIds: readonly string[],
  ): {
    readonly progress: CollectionGoalProgress;
    readonly rewards: readonly PlayerReward[];
    readonly applied: readonly AppliedPlayerReward[];
    readonly pendingEggs: readonly (
      | "silver"
      | "gold"
      | { readonly kind: "silver"; readonly repeatPicks: number }
    )[];
  };
}

export interface OfficialCollectionClaimCommit {
  readonly rewards: readonly PlayerReward[];
  /** Instance ids the authority minted for this claim's `monsterJoin` rewards, in reward order. */
  readonly committedMonsterIds: readonly string[];
}

/**
 * Official Collection seams. The authority owns the claim, the reward roll and every minted monster
 * id; this side only mirrors the committed result into the live aggregate the scene already holds.
 *
 * The intro chat has no authoritative home — `player.claimDialog` is town-enter only and
 * `player.claimTutorialFlag` is allowlist-gated, so neither can record `MonsterCollection` — but it
 * needs none. `Chats.plist` has no `MonsterCollection` record, so the source synthesizes one whose
 * absent `alwaysShow` stays 1 and whose gate `!seen || alwaysShow` never suppresses. The
 * caller-supplied seen-set below is therefore inert for this name and exists only so the seam stays
 * honest for an authored record that does ask to be shown once.
 */
export function createOfficialCollectionAdapter(options: {
  readonly official: boolean;
  readonly hasCollectionRoute: boolean;
  /** Resolved per call — projection adoption replaces the aggregate the world scene holds. */
  readonly mirror: () => OfficialCollectionMirror;
  readonly claim: (goalId: string) => Promise<OfficialCollectionClaimCommit>;
  readonly introChatSeen: Set<string>;
}): WorldCollectionAdapter | undefined {
  if (!options.official || !options.hasCollectionRoute) return undefined;
  return {
    mode: "official",
    requestChatPresentation: (name, alwaysShow) => {
      if (options.introChatSeen.has(name)) return alwaysShow;
      options.introChatSeen.add(name);
      return true;
    },
    allocateMonsterInstanceId: () => {
      throw new Error("official Collection rewards carry authority-minted instance ids");
    },
    runtime: {
      collectionGoalProgress: (goal) => options.mirror().collectionGoalProgress(goal),
      claimCollectionGoal: async (goal): Promise<CollectionClaimResult> => {
        const progress = options.mirror().collectionGoalProgress(goal);


        if (!progress.complete) return Object.freeze({ ok: false, reason: "incomplete", progress });
        if (progress.claimed) {
          return Object.freeze({ ok: false, reason: "already-claimed", progress });
        }
        const commit = await options.claim(progress.goalId);
        return Object.freeze({
          ok: true,
          ...options.mirror().mirrorCommittedCollectionClaim(
            goal,
            commit.rewards,
            commit.committedMonsterIds,
          ),
        });
      },
    },
  };
}

export interface PixiCollectionFlowPresentationOptions {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly scale9: Scale9SpritesData;
  readonly strings: LocalizedStrings;
  readonly ticker: Ticker;
  readonly onClick: () => void;
  readonly onBlocked: () => void;
  readonly presentRewards: (rewards: readonly PlayerReward[], owner: object) => Promise<void>;
}

/** Real notification-layer presentation for CollectionFlow. */
export class PixiCollectionFlowPresentation implements CollectionFlowPresentation {
  private readonly owner = {};
  private readonly buttons = new Map<string, { readonly node: Container; readonly label: Text }>();
  private readonly completedTintGoalKeys = new Set<string>();
  private rows: readonly CollectionFlowRowState[] = [];
  private basePopup: Popup | undefined;
  private activeChat: GuildQuestChatHandle | undefined;
  private disposed = false;

  constructor(private readonly options: PixiCollectionFlowPresentationOptions) {}

  async mountBase(options: {
    readonly title: string;
    readonly rows: readonly CollectionFlowRowState[];
    readonly onSelect: (goalKey: string) => void;
    readonly onClose: () => void;
  }): Promise<void> {
    if (this.disposed) throw new Error("Collection presentation is disposed");
    if (this.basePopup !== undefined) throw new Error("Collection base menu is already mounted");
    const metrics = collectionMenuMetrics(DISPLAY_MODE);
    const screen = screenPointsForMode(DISPLAY_MODE);
    const content = new Container();
    content.label = "collectionMenu";
    const view = await buildPopupMenuView({
      parent: content,
      assets: this.options.assets,
      scale9: this.options.scale9,
      title: {
        value: options.title,
        style: {
          fontSize: metrics.titleFontSize,
          fill: 0xffff88,
          outlineWidth: metrics.outlineWidth,
          textureScaleMode: "nearest",
        },
      },
      columns: [options.rows.map((row) => ({
        value: row.goalKey,
        label: row.label,
        enabled: true,
      }))],
      itemStyle: () => ({
        fontSize: metrics.rowFontSize,
        fill: 0xffffff,
        outlineWidth: metrics.outlineWidth,
        textureScaleMode: "nearest",
      }),
      backgroundMarginX: metrics.backgroundMarginX,
      backgroundMarginY: metrics.backgroundMarginY,
      allowEmptyColumns: true,
      // CenteredWithClose is modal. Source `ccTouchBegan:` claims every screen touch and resolves
      // the invoked item only from the release point, so the Popup root owns the sequence below.
      installParentInput: false,
      geometry: (titleSize, columnSizes) => popupMenuGeometry(
        screen,
        titleSize,
        columnSizes,
        metrics,
        DISPLAY_MODE,
        true,
      ),
      buttonLabel: (item) => `collection:${item.value}`,
    });
    for (const button of view.buttons) {
      const { item, node, label } = button;
      const goalKey = item.value;
      (button.onPress ?? ((handler) => button.node.on("pointertap", handler)))((event: FederatedPointerEvent) => {
        event.stopPropagation();
        if (this.disposed) return;
        this.options.onClick();
        options.onSelect(goalKey);
      });
      this.buttons.set(goalKey, { node, label });
    }

    const closeIcon = pointSprite(await this.options.assets.sprite(
      this.options.assets.hasSprite("PopupMenuCloseButton-hd")
        ? "PopupMenuCloseButton-hd"
        : "PopupMenuCloseButton",
    ));
    closeIcon.eventMode = "none";
    const closeLabel = makeTtfLabel(
      localizedString(this.options.strings, "BackButtonKey"),
      metrics.rowFontSize,
      {
        fill: 0xffffff,
        outline: false,
        textureScaleMode: "nearest",
      },
    );
    closeLabel.eventMode = "none";
    const closeLayout = collectionCloseItemLayout(
      screen,
      DISPLAY_MODE,
      { w: closeLabel.width, h: closeLabel.height },
      { w: closeIcon.width, h: closeIcon.height },
    );
    closeIcon.position.set(closeLayout.icon.x, closeLayout.icon.y);
    closeLabel.position.set(closeLayout.label.x, closeLayout.label.y);
    const close = new Container();
    close.label = "collection:close";
    close.eventMode = "none";
    close.cursor = "pointer";
    close.addChild(closeIcon, closeLabel);
    // This combined close icon + label has no MenuButton2 plate. It is one of the callers that
    // really does use the native 55pt minimum finalizer; keep it separate from brown-button input.
    const closeHit = minimumHitRectLocal({
      x: 0,
      y: 0,
      w: closeLayout.contentSize.w,
      h: closeLayout.contentSize.h,
    }, { x: 1, y: 1 });
    close.hitArea = new Rectangle(closeHit.x, closeHit.y, closeHit.w, closeHit.h);
    this.rows = Object.freeze(options.rows.map((row) => Object.freeze({ ...row })));
    this.basePopup = await Popup.show(this.options.parent, {
      assets: this.options.assets,
      scale9: this.options.scale9,
      ticker: this.options.ticker,
      backgroundKey: null,
      content,
      contentLayoutBounds: { ...view.geometry.content },
      screenChildren: [{
        node: close,
        x: closeLayout.position.x,
        y: closeLayout.position.y,
      }],
      dismissOnTap: false,
      runScaleAction: false,
      owner: this.owner,
      onDismiss: () => {
        this.basePopup = undefined;
        if (!this.disposed) options.onClose();
      },
    });
    const popup = this.basePopup;
    const claimedPointerIds = new Set<number>();
    popup.on("pointerdown", (event: FederatedPointerEvent) => {
      if (!this.disposed) claimedPointerIds.add(event.pointerId);
    });
    popup.on("pointerup", (event: FederatedPointerEvent) => {
      if (!claimedPointerIds.delete(event.pointerId) || this.disposed || popup.isDismissed) return;
      // Rows precede close in native `menuItems`, so preserve that enumeration priority even though
      // the top-right close target cannot overlap the centered shipped rows.
      if (view.invokeAt(event.getLocalPosition(content), event)) return;
      const point = event.getLocalPosition(close);
      if (!close.hitArea?.contains(point.x, point.y)) return;
      event.stopPropagation();
      this.options.onClick();
      popup.dismiss();
    });
    const cancelPointer = (event: FederatedPointerEvent): void => {
      claimedPointerIds.delete(event.pointerId);
    };
    popup.on("pointerupoutside", cancelPointer);
    popup.on("pointercancel", cancelPointer);
    this.updateRows(options.rows);
  }

  installCompletedTint(goalKeys: readonly string[]): void {
    for (const goalKey of goalKeys) {
      if (!this.buttons.has(goalKey)) {
        throw new Error(`Collection presentation cannot tint unknown goal ${goalKey}`);
      }
      this.completedTintGoalKeys.add(goalKey);
    }
  }

  updateRows(rows: readonly CollectionFlowRowState[]): void {
    for (const row of rows) {
      const button = this.buttons.get(row.goalKey);
      if (button === undefined) {
        throw new Error(`Collection presentation cannot update unknown goal ${row.goalKey}`);
      }
      button.label.text = row.label;
      button.label.tint = row.tint;
    }
    this.rows = Object.freeze(rows.map((row) => Object.freeze({ ...row })));
  }

  setBaseVisible(visible: boolean): void {
    if (this.basePopup !== undefined && !this.basePopup.isDismissed) {
      this.basePopup.visible = visible;
    }
  }

  async showMessage(options: {
    readonly title: string;
    readonly message: string;
    readonly okLabel: string;
  }): Promise<void> {
    let resolveDismissed!: () => void;
    const dismissed = new Promise<void>((resolve) => { resolveDismissed = resolve; });
    await showMonsterHatchPopup({
      parent: this.options.parent,
      assets: this.options.assets,
      scale9: this.options.scale9,
      ticker: this.options.ticker,
      owner: this.owner,
      sfx: {
        onButtonPress: this.options.onClick,
        onButtonBlocked: this.options.onBlocked,
      },
    }, {
      title: options.title,
      content: buildMonsterHatchMessageContent(options.message),
      buttons: [{ label: options.okLabel, onPress: () => undefined }],
      onDismiss: resolveDismissed,
    });
    await dismissed;
  }

  async showChat(message: string, onDismiss: () => void): Promise<void> {
    let handle: GuildQuestChatHandle | undefined;
    handle = await showGuildQuestChat({
      parent: this.options.parent,
      assets: this.options.assets,
      scale9: this.options.scale9,
      ticker: this.options.ticker,
      message,
      onDismiss: () => {
        if (this.activeChat === handle) this.activeChat = undefined;
        onDismiss();
      },
    });
    if (this.disposed) {
      handle.dismiss(true);
      return;
    }
    this.activeChat = handle;
  }

  async showRewards(rewards: readonly PlayerReward[]): Promise<void> {
    if (this.disposed) return;
    await this.options.presentRewards(rewards, this.owner);
  }

  requestBack(): boolean {
    if (this.disposed) return false;
    if (this.activeChat !== undefined) {
      this.activeChat.dismiss();
      return true;
    }
    return PopupHost.for(this.options.parent).dismissTop();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    PopupHost.for(this.options.parent).dismissOwnedBy(this.owner);
    this.activeChat?.dismiss(true);
    this.activeChat = undefined;
    this.basePopup = undefined;
    this.buttons.clear();
  }

  get debugState(): Record<string, unknown> {
    return {
      mounted: this.basePopup !== undefined && !this.basePopup.isDismissed,
      chatOpen: this.activeChat !== undefined,
      completedTintGoalKeys: [...this.completedTintGoalKeys],
      rows: this.rows.map((row) => ({ ...row })),
    };
  }
}

/** Source `MonsterCollectionMenuItem` activation/claim coordinator. */
export class CollectionFlow {
  private goals: readonly CollectionGoalDefinition[] = [];
  private rows: readonly CollectionFlowRowState[] = [];
  private readonly tintedGoalKeys = new Set<string>();
  private elapsedMs = 0;
  private collectionType: string | undefined;
  private disposed = false;
  private shown = false;
  private baseMounted = false;
  private invoking = false;
  private chatOpen = false;
  private ownedPresentation: CollectionFlowOwnedPresentationDebugState =
    emptyCollectionOwnedPresentation();

  constructor(private readonly options: CollectionFlowOptions) {}

  async show(collectionType: string): Promise<void> {
    if (this.disposed) throw new Error("CollectionFlow: cannot show a disposed flow");
    if (this.shown) throw new Error("CollectionFlow: flow is already shown");
    const goals = this.options.catalog.get(collectionType);
    if (goals === undefined) {
      throw new Error(`CollectionFlow: missing collection type ${collectionType}`);
    }
    this.shown = true;
    this.collectionType = collectionType;
    this.goals = goals;
    this.refreshRows();

    await this.options.presentation.mountBase({
      title: localizedString(this.options.strings, "CollectionHutListTitleKey"),
      rows: this.rows,
      onSelect: (goalKey) => {
        void this.activateGoal(goalKey).catch((error: unknown) => {
          queueMicrotask(() => { throw error; });
        });
      },
      onClose: () => this.dispose(),
    });
    if (this.disposed) return;
    this.baseMounted = true;

    this.installNewCompletedTints();
    this.refreshTint();








    if (!this.options.requestChatPresentation("MonsterCollection", true)) return;

    this.chatOpen = true;
    this.ownedPresentation = collectionOwnedPresentation("intro-chat");
    this.options.presentation.setBaseVisible(false);
    try {
      await this.options.presentation.showChat(
        localizedString(this.options.strings, "MonsterCollectionChatKey"),
        () => {
          this.chatOpen = false;
          this.ownedPresentation = emptyCollectionOwnedPresentation();
          if (!this.disposed) this.options.presentation.setBaseVisible(true);
        },
      );
    } catch (error) {
      this.chatOpen = false;
      this.ownedPresentation = emptyCollectionOwnedPresentation();
      throw error;
    }
  }

  update(deltaMs: number): void {
    if (this.disposed || !this.shown) return;
    if (!Number.isFinite(deltaMs) || deltaMs < 0) {
      throw new Error(`CollectionFlow: invalid ticker delta ${deltaMs}`);
    }
    this.elapsedMs = (this.elapsedMs + deltaMs) % 1_000;
    this.refreshTint();
  }

  requestBack(): boolean {
    if (this.disposed || !this.shown) return false;
    return this.options.presentation.requestBack();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.chatOpen = false;
    this.ownedPresentation = emptyCollectionOwnedPresentation();
    this.options.presentation.dispose();
    this.options.onClose();
  }

  get debugState(): Record<string, unknown> {
    return {
      kind: "collection",
      open: this.shown && !this.disposed,
      collectionType: this.collectionType ?? null,
      invoking: this.invoking,
      chatOpen: this.chatOpen,
      ownedPresentation: { ...this.ownedPresentation },
      rows: this.rows.map((row) => ({ ...row })),
    };
  }

  private async activateGoal(goalKey: string): Promise<void> {
    if (this.disposed || this.invoking) return;
    const goal = this.goals.find(({ key }) => key === goalKey);
    if (goal === undefined) throw new Error(`CollectionFlow: unknown goal ${goalKey}`);
    this.invoking = true;
    try {
      this.refreshRows();
      const current = this.options.runtime.collectionGoalProgress(goal);
      if (!current.complete) {
        this.ownedPresentation = collectionOwnedPresentation("description", goal.key);
        try {
          await this.options.presentation.showMessage({
            title: localizedString(this.options.strings, "CollectionGoalKey"),
            message: localizedString(
              this.options.strings,
              `${goal.key}CollectionQuestDescriptionKey`,
            ),
            okLabel: localizedString(this.options.strings, "OkButtonKey"),
          });
        } finally {
          this.ownedPresentation = emptyCollectionOwnedPresentation();
        }
        return;
      }
      if (current.claimed) {
        await this.showAlreadyFinished(goal.key);
        return;
      }

      const result = await this.options.runtime.claimCollectionGoal(
        goal,
        this.options.rng,
        this.options.allocateMonsterInstanceId,
      );
      // Official claims round-trip to the authority, so the menu can be closed while one is in
      // flight. The claim itself is already committed and mirrored by this point; only the
      // presentation is abandoned, and touching a disposed presentation would throw.
      if (this.disposed) return;
      if (!result.ok) {
        if (result.reason === "already-claimed") {
          this.refreshRows();
          await this.showAlreadyFinished(goal.key);
          return;
        }
        throw new Error(`CollectionFlow: complete goal ${goal.key} became incomplete during claim`);
      }

      this.refreshRows();
      this.installNewCompletedTints();
      this.refreshTint();
      if (this.disposed) return;
      this.ownedPresentation = collectionOwnedPresentation("committed-loot", goal.key);
      try {
        await this.options.presentation.showRewards(result.rewards);
      } finally {
        this.ownedPresentation = emptyCollectionOwnedPresentation();
      }
      // The loot page lists the Egg; the hatch itself follows it, as it does after quest loot.
      for (const egg of result.pendingEggs) {
        if (this.disposed) return;
        await (typeof egg === "string"
          ? this.options.hatchEgg(egg)
          : this.options.hatchEgg(egg.kind, { repeatPicks: egg.repeatPicks }));
      }
    } finally {
      this.invoking = false;
    }
  }

  private async showAlreadyFinished(goalKey: string): Promise<void> {
    this.ownedPresentation = collectionOwnedPresentation("repeat", goalKey);
    try {
      await this.options.presentation.showMessage({
        title: localizedString(
          this.options.strings,
          "AlreadyFinishedCollectionQuestTitleKey",
        ),
        message: localizedString(
          this.options.strings,
          "AlreadyFinishedCollectionQuestMessageKey",
        ),
        okLabel: localizedString(this.options.strings, "OkButtonKey"),
      });
    } finally {
      this.ownedPresentation = emptyCollectionOwnedPresentation();
    }
  }

  private refreshRows(): void {
    this.rows = Object.freeze(this.goals.map((goal) => {
      const value = this.options.runtime.collectionGoalProgress(goal);
      return Object.freeze({
        goalKey: goal.key,
        label: formatCollectionRowLabel(
          localizedString(this.options.strings, `${goal.key}CollectionQuestTitleKey`),
          value.percentComplete,
        ),
        percentComplete: value.percentComplete,
        complete: value.complete,
        claimed: value.claimed,
        enabled: true as const,
        tint: value.complete ? collectionCompletedRowTint(this.elapsedMs) : 0xffffff,
      });
    }));
    if (this.baseMounted) this.options.presentation.updateRows(this.rows);
  }

  private installNewCompletedTints(): void {
    const added: string[] = [];
    for (const row of this.rows) {
      if (!row.complete || this.tintedGoalKeys.has(row.goalKey)) continue;
      this.tintedGoalKeys.add(row.goalKey);
      added.push(row.goalKey);
    }
    if (added.length > 0) this.options.presentation.installCompletedTint(Object.freeze(added));
  }

  private refreshTint(): void {
    if (!this.baseMounted) return;
    this.rows = Object.freeze(this.rows.map((row) => Object.freeze({
      ...row,
      tint: row.complete ? collectionCompletedRowTint(this.elapsedMs) : 0xffffff,
    })));
    this.options.presentation.updateRows(this.rows);
  }
}

export type CollectionFlowOwnedPresentationKind =
  | "none"
  | "intro-chat"
  | "description"
  | "repeat"
  | "committed-loot";

export interface CollectionFlowOwnedPresentationDebugState {
  readonly kind: CollectionFlowOwnedPresentationKind;
  readonly goalKey: string | null;
}

function collectionOwnedPresentation(
  kind: Exclude<CollectionFlowOwnedPresentationKind, "none">,
  goalKey: string | null = null,
): CollectionFlowOwnedPresentationDebugState {
  return Object.freeze({ kind, goalKey });
}

function emptyCollectionOwnedPresentation(): CollectionFlowOwnedPresentationDebugState {
  return Object.freeze({ kind: "none" as const, goalKey: null });
}
