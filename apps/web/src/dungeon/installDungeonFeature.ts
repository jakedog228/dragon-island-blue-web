import { restoreOfficialDungeonRun } from "../authority/battleAppearance.js";
import { Graphics, type Container } from "pixi.js";
import type { DungeonZoneChange } from "@dib/gamedata/dungeon";
import { loadChatDefinition, sourceTutorialTopic } from "@dib/gamedata/browser";
import type {
  DungeonLoot,
  DungeonMonster,
  DungeonRoomEntryAction,
  DungeonTreasure,
} from "@dib/engine/dungeon";
import {
  mulberry32,
  replayableRng,
  type Rng,
  type BattleReplaySnapshotV1,
  type GuildQuestEvent,
  type GuildQuestRuntime,
  type TeamMemberSetup,
} from "@dib/engine";
import type {
  GameCommandV1,
  OfficialDungeonBattleReturnV1,
  PresentationEventV1,
} from "@dib/game-protocol";
import {
  infiniteDungeonFloorEntry,
  type InfiniteDungeonFloorEntry,
} from "@dib/player-domain";
import type { WorldNotificationHost } from "../world/worldNotificationHost.js";
import { localizedString } from "../localization.js";
import type { ManagedScene, SceneCoordinator } from "../sceneCoordinator.js";
import type { ImportedContentPackage } from "../content/archivePackage.js";
import type { FixedStage } from "@dib/renderer";
import type { LoadedGame } from "../loadGame.js";
import type { AudioPlayer } from "../audio.js";
import {
  dungeonDirectionForShortcut,
  isAdvanceShortcut,
  type KeyboardShortcutRouter,
} from "../keyboardShortcuts.js";
import type { PlayerRuntimeState } from "../player/playerRuntimeState.js";
import {
  showInventoryManagement,
  type InventoryManagementHandle,
} from "../player/inventoryManagementFlow.js";
import { BattleNode, type DefeatRecoveryAdapter } from "../battle/battleNode.js";
import { battleSpriteKey, type EncounterConfig } from "../battle/encounter.js";
import { computePreloadPlan } from "../battle/preloadPlan.js";
import { tween } from "../tween.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode } from "../displayMode.js";
import {
  runSourceBlackSceneFade,
  type SourceBlackSceneFadeState,
} from "../sourceSceneFade.js";
import type { WorldNode } from "../world/worldNode.js";
import type { WorldSceneRequest } from "../world/worldPoiRouting.js";
import { WorldMenu } from "../world/worldMenu.js";
import { EggHatchFlow } from "../world/eggHatchFlow.js";
import {
  createOfficialEggHatchSession,
  type OfficialEggHatchAuthority,
} from "../world/eggHatchSession.js";
import {
  enabledDungeonMenuActions,
  type WorldMenuAction,
} from "../world/worldMenuMath.js";
import {
  showOptionsPanel,
  type OptionsPanelHandle,
} from "../world/optionsPanel.js";
import {
  showHighscoresPanel,
  type HighscoresPanelHandle,
  type HighscoresSource,
} from "../world/highscoresScreen.js";
import { showMainMenuConfirmation } from "../world/mainMenuConfirmation.js";
import {
  hasCompleteSourceTutorialSurface,
  hasSourceTutorialTopicSurface,
  TutorialMenu,
} from "../world/tutorialMenu.js";
import { dungeonPopupEnvironment } from "./dungeonDialogs.js";
import {
  buildMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import type { Popup } from "../ui/popup.js";
import { PartyEditorFlow } from "../world/partyEditorFlow.js";
import { partyManagementShowsFirstUseTutorial } from "../world/partyEditorMath.js";
import { MonsterpediaFlow } from "../world/monsterpediaFlow.js";
import { GuildQuestFlow, guildQuestListAvailable } from "../world/guildQuestFlow.js";
import {
  showPlotTutorial,
  type PlotTutorialDebugState,
  type PlotTutorialHandle,
} from "../ui/plotGameFlow.js";
import {
  adoptOfficialDungeonTerminalProjection,
  allocateDungeonTerminalFlow,
  buildDungeonBattle,
  createDungeonBattleLifecycleDiagnosticReporter,
  officialDungeonBattleReturnActions,
  stageDungeonBattleReward,
  terminalDungeonCheckpointOverride,
  terminalDungeonMonsterRoster,
} from "./dungeonBattle.js";
import {
  LocalDungeonTerminal,
  LocalDungeonTerminalContinuation,
  LocalDungeonTerminalRetryOwner,
  type LocalDungeonCaptureIdentity,
} from "./localDungeonTerminal.js";
import { showDungeonCatchQuestDisplay } from "./dungeonCatchQuestDisplay.js";
import { DungeonNode, type DungeonEncounterRequest } from "./dungeonNode.js";
import { showDungeonLootManagement } from "./dungeonLootPageProvider.js";
import type { InstalledSlotProjection } from "../authority/gameAuthorityClient.js";
import {
  CommandRecoveredBeforeNewIntentError,
  CommandStateResyncedError,
  isCommandReconciliation,
} from "../authority/commandCoordinator.js";
import { resolveOfficialDefeatReturn } from "../authority/officialDefeatRecovery.js";
import type { AccountGateway } from "../authority/accountGateway.js";
import {
  applyPlayerRewards,
  type AppliedPlayerReward,
} from "../player/rewards.js";
import {
  DungeonRuntimeController,
  type DungeonRouteDescriptor,
  type DungeonRunSnapshot,
  type DungeonRuntimeContext,
  type DungeonRoomRosterUpdateHooks,
  type DungeonTerminalFlowIdentity,
} from "@dib/engine/dungeon-runtime";
export {
  LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
  LEADERBOARD_PLATFORM_HOOK_MESSAGE,
  isVolcanoInfiniteDungeonInstance,
} from "./dungeonDiagnostics.js";

export type DungeonCapableScene =
  (BattleNode | WorldNode | DungeonNode) & ManagedScene<"battle" | "world" | "dungeon">;

function localDungeonTerminalFlowKey(flow: DungeonTerminalFlowIdentity): string {
  return [
    flow.route.typeName,
    flow.route.sourceFile,
    flow.route.floor,
    flow.route.entryZoneName ?? "",
    flow.id,
  ].join("\u0000");
}

export interface DungeonFeatureHost<ShellMode extends string> {
  readonly stage: FixedStage;
  readonly game: LoadedGame;
  readonly audio: AudioPlayer;
  readonly keyboard: KeyboardShortcutRouter;
  readonly content: ImportedContentPackage;
  readonly scenes: SceneCoordinator<DungeonCapableScene, ShellMode>;
  readonly player: () => PlayerRuntimeState;
  readonly nextBattleSeed: () => number | Rng;
  readonly nextRunSeed: () => number;
  /** Development-only native `arc4random` stream shared across local mechanics. */
  readonly fidelityRng?: Rng;
  /** Development-only Foundation traversal order supplied by the Fidelity Lab. */
  readonly fidelityFoundationOrder?: "lexicographic";
  readonly checkpoint: () => void;
  /** Director-level category-3 Store mount shared by Egg and capture insufficient-funds paths. */
  readonly openGoldStore: (
    parent: Container,
    owner: object,
    player: PlayerRuntimeState,
    checkpointAfter: () => void,
  ) => Promise<{ readonly closed: Promise<void> }>;
  /** Awaitable persistence required by local terminal transactions. */
  readonly checkpointAsync: (
    override?: { readonly dungeon?: DungeonRunSnapshot | null },
  ) => Promise<void>;
  readonly onWorldExit: (change: Extract<DungeonZoneChange, { kind: "worldExit" }>) => void | Promise<void>;
  readonly onDefeat: (options?: { readonly terminalStateCommitted?: boolean }) => void | Promise<void>;
  /** Source GotoTownMenuItem direct-return route; absent only when the package has no towns. */
  readonly onTownPortal?: () => void | Promise<void>;
  /** Confirmed MainMenuMenuItem route back to the title/save-slot shell. */
  readonly onMainMenu: () => void | Promise<void>;
  readonly onPresentationChange: () => void | Promise<void>;
  /** Official online account settings edited by the Options popup; absent offline. */
  readonly account?: AccountGateway;
  /**
   * Public most-XP board behind the source `Highscores` row. The source builder keeps its common
   * rows operable with `world == nil`, so the row is live in a dungeon exactly as in a world —
   * present only in official online play, absent (and inert) otherwise.
   */
  readonly scoreboard?: HighscoresSource;
  /** Shared recovery seam. A lazy BattleNode getter keeps Store presentation in the app shell;
   * local hosts mutate their staged aggregate, while Official hosts submit the v14+ continuation. */
  readonly defeatRecovery?: (
    battle: () => BattleNode,
    encounter: EncounterConfig,
    stagedPlayer?: PlayerRuntimeState,
    stagedCheckpoint?: () => void,
  ) => DefeatRecoveryAdapter;
  /** Local-only detached aggregate factory. Official hosts must omit this seam. */
  readonly createLocalTerminal?: (
    pendingBattleRewardKeys?: Readonly<Record<string, string>>,
    captureIdentity?: LocalDungeonCaptureIdentity,
  ) => LocalDungeonTerminal;
  readonly isCompletionSet?: (key: string) => boolean;
  readonly isQuestUsable?: (questKey: string) => boolean;
  readonly hasReceivedBattleReward?: (key: string) => boolean;
  readonly markBattleRewardReceived?: (key: string) => void;
  readonly onQuestEvent?: (event: GuildQuestEvent) => void;
  /**
   * Guild quest runtime behind the MasterMenu `QuestsMenuItem` row. A getter, not a value: the shell
   * replaces its runtime when a slot adopts Official authority, and the dungeon controller outlives
   * that swap. Absent, the row stays disabled the way Town Portal does.
   */
  readonly guildQuests?: () => GuildQuestRuntime | undefined;
  /** Local event-4 adapter may defer its save checkpoint until the runtime commits the room plan. */
  readonly onDungeonRoomRosterUpdated?: (
    instanceName: string,
    floor: number,
    survivingMonstersByRoom: readonly number[],
    flow: DungeonTerminalFlowIdentity,
    registerRollback: (rollback: () => void) => void,
  ) => void | DungeonRoomRosterUpdateHooks;
  readonly requestChatPresentation?: (name: string, alwaysShow: boolean) => boolean;
  readonly onNotificationHostReady?: (host: WorldNotificationHost) => void;
  readonly onDiagnostic?: (message: string, detail?: Readonly<Record<string, unknown>>) => void;
  readonly authority?: {
    readonly projection: () => InstalledSlotProjection;
    readonly submit: (
      command: Extract<
        GameCommandV1,
        {
          type:
            | `dungeon.${string}`
            | `battle.${string}`
            | `party.${string}`
            | "player.dropInventoryItem";
        }
      >,
      hooks?: { readonly onIntentAccepted?: () => void },
    ) => Promise<{
      readonly projection: InstalledSlotProjection;
      readonly events: readonly PresentationEventV1[];
    }>;
    readonly adoptProjection: () => void;
    readonly claimTutorialFlag: (flag: string) => Promise<void>;
    /**
     * Consumes the authority's own `dungeon.infiniteFloorEntered` decision for `floor`, if the
     * command that moved the run there reported one. Absent, the run did not deepen the Abyss and
     * the projection's `infiniteDungeonHighestLevel` is already the pre-write value.
     */
    readonly takeInfiniteFloorEntry?: (
      floor: number,
    ) => { readonly previousHighest: number } | undefined;
    /**
     * Drives the authoritative v12 Egg continuation a dungeon reward left pending. Treasure and
     * catch Eggs are hatched by the server online; drawing the pool from `nextRunSeed` here would
     * hand the player a prize the authority never agreed to, and would leave the slot wedged on
     * the continuation nothing finished.
     */
    readonly egg: OfficialEggHatchAuthority;
  };
}

export interface PreparedAuthoritativeDungeonRun {
  readonly hasAuthoritativeRun: boolean;
  readonly run: DungeonRuntimeController | undefined;
  readonly insideDungeon: boolean;
}

/** Mirror a server-priced injury heal into the retained dungeon party object. Projection adoption
 * would replace the object underneath the open editor, so this follows WorldNode's in-place party
 * command seam and consumes the committed cost/balance events. */
export async function healDungeonPartyMonster(
  player: Pick<PlayerRuntimeState, "healPartyMonster" | "healPartyMonsterAtCost">,
  authority: DungeonFeatureHost<string>["authority"],
  instanceId: string,
  nowSeconds: number,
): Promise<ReturnType<PlayerRuntimeState["healPartyMonster"]>> {
  if (authority === undefined) return player.healPartyMonster(instanceId, nowSeconds);
  const result = await authority.submit({ type: "party.healInjury", instanceId });
  const healed = result.events.find(
    (event) => event.type === "party.injuryHealed" && event.instanceId === instanceId,
  );
  if (healed === undefined || healed.type !== "party.injuryHealed") {
    throw new Error("official dungeon injury response omitted its committed price");
  }
  const currency = result.events.find(
    (event) => event.type === "player.currencyChanged" && event.currency === "gold",
  );
  if (currency === undefined || currency.type !== "player.currencyChanged") {
    throw new Error("official dungeon injury response omitted its committed gold balance");
  }
  return player.healPartyMonsterAtCost(instanceId, healed.goldCost, currency.balance);
}

/** Translate only the authority's committed continuation into the neutral token expected by the
 * existing dungeon hatch presenter. No reward bytes or client-side provider decision participate. */
export function officialPendingDungeonEggReward(
  authority: Pick<NonNullable<DungeonFeatureHost<string>["authority"]>, "egg">,
): Extract<DungeonLoot, { kind: "egg" | "monsterEgg" }> | undefined {
  const pending = authority.egg.pendingEgg();
  if (pending === undefined) return undefined;
  return Object.freeze({ kind: pending.kind === "silver" ? "egg" : "monsterEgg" });
}

function dungeonOfficialBattleReplay(
  battle: NonNullable<InstalledSlotProjection["battle"]>,
): BattleReplaySnapshotV1 {
  const team = (members: (typeof battle.teams)[number]): TeamMemberSetup[] =>
    members.map((member) => {
      const flatStatBonuses = member.flatStatBonuses === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(member.flatStatBonuses).filter((entry): entry is [string, number] =>
              typeof entry[1] === "number"),
          ) as NonNullable<TeamMemberSetup["flatStatBonuses"]>;
      const playerBuffs = member.playerBuffs === undefined
        ? undefined
        : Object.fromEntries(
            Object.entries(member.playerBuffs).filter((entry): entry is [string, number] =>
              typeof entry[1] === "number"),
          ) as NonNullable<TeamMemberSetup["playerBuffs"]>;
      return {
        shortType: member.shortType,
        level: member.level,
        ...(member.currentHp === undefined ? {} : { currentHp: member.currentHp }),
        ...(member.capturable === undefined ? {} : { capturable: member.capturable }),
        ...(member.sourceInstanceId === undefined
          ? {}
          : { sourceInstanceId: member.sourceInstanceId }),
        ...(member.boss === undefined ? {} : { boss: member.boss }),
        ...(flatStatBonuses === undefined ? {} : { flatStatBonuses }),
        ...(playerBuffs === undefined ? {} : { playerBuffs }),
        ...(member.soulStone === undefined
          ? {}
          : {
              soulStone: {
                element: member.soulStone.element,
                level: member.soulStone.level,
                ...(member.soulStone.sourceType === undefined
                  ? {}
                  : { sourceType: member.soulStone.sourceType }),
              },
            }),
      };
    });
  return {
    schemaVersion: 1,
    teams: [team(battle.teams[0]), team(battle.teams[1])],
    options: {
      ...(battle.options.fightingGroupSize === undefined
        ? {}
        : { fightingGroupSize: battle.options.fightingGroupSize }),
      ...(battle.options.blockCapture === undefined
        ? {}
        : { blockCapture: battle.options.blockCapture }),
      ...(battle.options.silver === undefined ? {} : { silver: battle.options.silver }),
    },
    randomDraws: [...battle.randomDraws],
    commands: battle.commands.map((command) => {
      if (command.type === "ability") return { ...command, targetIds: [...command.targetIds] };
      if (command.type === "capture") {
        return {
          type: command.type,
          actorId: command.actorId,
          targetId: command.targetId,
          cardLevel: command.cardLevel,
          partyLevel: command.partyLevel,
          ...(command.externalSilverDebit === undefined
            ? {}
            : { externalSilverDebit: command.externalSilverDebit }),
        };
      }
      return { ...command };
    }),
  };
}

type DungeonSceneEntry =
  | {
    readonly kind: "worldEntry" | "route";
    readonly actions?: undefined;
  }
  | {
    readonly kind: "restore";
    /** A renderer-only rebuild is not a native new DungeonNode scene entry. */
    readonly presentationResume?: boolean;
    readonly onSceneReady?: () => Promise<void>;
    readonly actions?: undefined;
  }
  | {
    readonly kind: "battleReturn";
    readonly actions: readonly DungeonRoomEntryAction[] | null;
    /** Port-only cold bootstrap after the terminal command committed in another document. */
    readonly documentRestore?: boolean;
    readonly onSceneReady?: () => Promise<void>;
  };

/**
 * Pluggable app-shell adapter for the pure dungeon loader/engine. It is the only layer that knows
 * about BattleNode, popups, audio, save checkpoints, or scene transitions; DungeonRuntimeController
 * remains a serializable run cache and DungeonNode remains a renderer over one DungeonSession.
 */
export class DungeonFeatureController<ShellMode extends string> {
  private run: DungeonRuntimeController | undefined;
  /** Source Item instances persist with a cached run; a renderer/scene rebuild must not recreate
   * their initializer draws. Track first materialization per run and floor without retaining runs. */
  private readonly materializedItemFloors = new WeakMap<DungeonRuntimeController, Set<string>>();
  /** The native DungeonCache outlives a DungeonNode/world exit, but is purged on town entry. */
  private insideDungeon = false;
  private readonly diagnostics: Array<{
    code: string;
    message: string;
    detail?: Readonly<Record<string, unknown>>;
  }> = [];
  private readonly pendingBattleRewardKeys = new Map<string, string>();
  private activeEggHatch: EggHatchFlow | undefined;
  private eggMonsterSequence = 0;
  private activeLocalTerminal: LocalDungeonTerminal | undefined;
  private readonly localTerminalContinuation = new LocalDungeonTerminalContinuation();
  private readonly localTerminalRetryOwner = new LocalDungeonTerminalRetryOwner();
  private activeLocalTerminalRetryPopup: Popup | undefined;

  constructor(private readonly host: DungeonFeatureHost<ShellMode>) {
    if (!host.content.hasDungeonCapability) {
      throw new Error("DungeonFeatureController requires a package with verified dungeon capability");
    }
  }

  get active(): boolean { return this.insideDungeon; }

  snapshot(): DungeonRunSnapshot | undefined {
    // DungeonCache is process-transient in the source. The port persists only an active run so a
    // reload can resume inside it; an overworld cache remains live until town entry in this tab.
    return this.insideDungeon ? this.run?.snapshot() : undefined;
  }

  pendingBattleRewardSnapshot(): Readonly<Record<string, string>> | undefined {
    if (this.pendingBattleRewardKeys.size === 0) return undefined;
    return Object.freeze(Object.fromEntries(
      [...this.pendingBattleRewardKeys.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ));
  }

  diagnosticSnapshot(): readonly Readonly<{
    code: string;
    message: string;
    detail?: Readonly<Record<string, unknown>>;
  }>[] {
    return Object.freeze(this.diagnostics.map((entry) => Object.freeze({ ...entry })));
  }

  async enterFromWorld(request: WorldSceneRequest): Promise<void> {
    if (this.localTerminalContinuation.hasCommitted()) {
      throw new Error("Dungeon feature cannot enter a new route while a terminal continuation is pending");
    }
    const change = request.poi.zoneChange;
    if (change?.kind !== "dungeon" || !change.dungeon || !change.dungeonFile) {
      throw new Error(`Dungeon route ${request.poi.name} has no complete dungeon zone change`);
    }
    const route = {
      typeName: change.dungeon,
      sourceFile: change.dungeonFile,
      floor: change.dungeonLevel ?? 1,
      ...(change.targetZoneChange === undefined ? {} : { entryZoneName: change.targetZoneChange }),
    };
    if (this.run === undefined) {
      this.run = DungeonRuntimeController.enter(this.runtimeContext(this.host.nextRunSeed()), route);
    } else {
      this.run.reenterFromWorld(route);
    }
    this.insideDungeon = true;
    await this.ensureDungeonSfx();
    this.host.audio.playSfx("Stairs_EnterDungeon");
    await this.startDungeonScene({ kind: "worldEntry" });
  }

  /** Explicit route seam used by deterministic browser fixtures and future non-world entrances. */
  async enterRoute(
    route: DungeonRouteDescriptor,
    fixture?: { readonly waypointState: "undiscovered" | "registered" },
  ): Promise<void> {
    this.run = DungeonRuntimeController.enter(this.runtimeContext(this.host.nextRunSeed()), route);
    if (fixture !== undefined) this.prepareWaypointBrowserFixture(this.run, fixture.waypointState);
    this.insideDungeon = true;
    await this.ensureDungeonSfx();
    this.host.audio.playSfx("Stairs_EnterDungeon");
    await this.startDungeonScene({ kind: "worldEntry" });
  }

  /**
   * Opt-in browser choreography seam. Generated waypoint rooms deliberately carry encounters in
   * the shipped North Cave corpus, so a visual contract needs a source-state setup rather than
   * silently changing generation density or battle rules.
   */
  private prepareWaypointBrowserFixture(
    run: DungeonRuntimeController,
    state: "undiscovered" | "registered",
  ): void {
    const floor = run.session.state;
    const target = floor.rooms.find((room) => room.waypoint);
    if (target === undefined) {
      throw new Error(`waypoint browser fixture floor ${floor.floor} has no waypoint room`);
    }
    const queue = [floor.currentRoomId];
    const previous = new Map<string, string>();
    while (queue.length > 0) {
      const roomId = queue.shift()!;
      if (roomId === target.id) break;
      const room = floor.rooms.find((candidate) => candidate.id === roomId);
      if (room === undefined) throw new Error(`waypoint fixture lost room ${roomId}`);
      for (const link of room.links) {
        if (link.targetRoomId === floor.currentRoomId || previous.has(link.targetRoomId)) continue;
        previous.set(link.targetRoomId, roomId);
        queue.push(link.targetRoomId);
      }
    }
    const path: string[] = [];
    for (let roomId = target.id; roomId !== floor.currentRoomId;) {
      path.push(roomId);
      const prior = previous.get(roomId);
      if (prior === undefined) throw new Error(`waypoint fixture cannot reach ${target.id}`);
      roomId = prior;
    }
    for (const roomId of path.reverse()) run.session.moveToRoom(roomId);
    if (state === "undiscovered") return;

    const encounter = run.session.currentRoom.encounter;
    if (encounter !== undefined) run.resolveEncounter(encounter, "victory");
    const treasure = run.session.currentRoom.encounter?.treasure ?? run.session.currentRoom.treasure;
    if (treasure !== undefined) run.session.collectTreasure(treasure.id);
    run.registerWaypoint();
  }

  async restore(
    snapshot: DungeonRunSnapshot,
    options: {
      readonly presentationResume?: boolean;
      readonly pendingBattleRewardKeys?: Readonly<Record<string, string>>;
      readonly onSceneReady?: () => Promise<void>;
    } = {},
  ): Promise<void> {
    if (this.localTerminalContinuation.hasCommitted()) {
      throw new Error("Dungeon feature cannot enter a new route while a terminal continuation is pending");
    }
    this.run = this.host.authority === undefined
      ? DungeonRuntimeController.restore(this.runtimeContext(), snapshot)
      : restoreOfficialDungeonRun(this.runtimeContext(), snapshot);
    this.insideDungeon = true;
    this.pendingBattleRewardKeys.clear();
    for (const [treasureId, rewardKey] of Object.entries(options.pendingBattleRewardKeys ?? {})) {
      if (treasureId.length === 0 || rewardKey.length === 0) {
        throw new Error("dungeon pending battle reward identity must not be empty");
      }
      this.pendingBattleRewardKeys.set(treasureId, rewardKey);
    }
    // Promote active snapshots written before UserSavedData-owned waypoint persistence was split
    // from the transient DungeonCache. The assigned run makes any resulting checkpoint complete.
    for (const waypoint of this.run.waypointDiscoveries()) {
      this.host.player().profile.registerDungeonWaypoint(
        waypoint.instanceName,
        waypoint.floor,
      );
    }
    if (options.presentationResume === true) {
      // An in-memory renderer rebuild retains the live run's already-consumed transient entry
      // presentations. A document reload intentionally omits this flag and gets normal restore
      // behavior.
      this.run.claimCurrentFloorPresence();
      this.run.takeChangedCatchQuestProgress();
    }
    // Migrate completion from dungeon snapshots written before the source-owned
    // `UserSavedData.catchQuestsDone` set was represented in PlayerProfile.
    for (const instanceName of this.run.snapshot().completedCatchQuestInstances ?? []) {
      this.host.player().profile.completeCatchQuest(instanceName);
    }
    if (this.run.migratedLegacyTopology) {
      this.recordDiagnostic(
        "Migrated a pre-native-topology dungeon save by regenerating its active floor",
        {
          sourceSchemaVersion: snapshot.schemaVersion,
          route: this.run.route,
        },
      );
      this.host.checkpoint();
    }
    if (this.run.restoredLegacyGeneration) {
      this.recordDiagnostic(
        "Restored an offline dungeon save with the compatible historical generator",
        {
          sourceSchemaVersion: snapshot.schemaVersion,
          route: this.run.route,
        },
      );
    }
    await this.startDungeonScene({
      kind: "restore",
      ...(options.presentationResume === true ? { presentationResume: true } : {}),
      ...(options.onSceneReady === undefined ? {} : { onSceneReady: options.onSceneReady }),
    });
  }

  async enterPreparedAuthoritativeFromWorld(): Promise<void> {
    if (this.run === undefined) throw new Error("Official dungeon entry has no prepared run");
    this.insideDungeon = true;
    await this.ensureDungeonSfx();
    this.host.audio.playSfx("Stairs_EnterDungeon");
    await this.startDungeonScene({ kind: "worldEntry" });
  }

  /**
   * A document reload can reconnect directly into a battle after the source floor-entry phases
   * already ran in the prior client. Seed those presentation-only values while the projection is
   * still at the battle-start snapshot; the terminal adoption can then inherit them and still
   * detect any catch progress newly committed by the battle itself.
   */
  prepareAuthoritativeBattleReconnect(): void {
    const run = this.requireRun();
    run.claimCurrentFloorPresence();
    run.takeChangedCatchQuestProgress();
  }

  /** Seed a terminal-settled reload from the authority's pre-battle presentation receipt. */
  prepareAuthoritativeBattleReturn(handoff: OfficialDungeonBattleReturnV1): void {
    const run = this.requireRun();
    const floor = run.session.state;
    if (
      floor.definitionId !== handoff.dungeonId ||
      floor.floor !== handoff.floor ||
      floor.currentRoomId !== handoff.roomId
    ) {
      throw new Error("Official dungeon battle return receipt disagrees with its prepared run");
    }
    run.claimCurrentFloorPresence();
    run.seedCurrentCatchQuestPresentation(handoff.catchTypesBeforeBattle);
  }

  /** Return a reconnected Official battle to its retained dungeon without replaying world-entry
   * sound, waypoint selection, or the uncleared encounter on retreat. */
  async enterPreparedAuthoritativeFromBattle(
    outcome: "victory" | "retreat",
  ): Promise<DungeonNode> {
    const run = this.requireRun();
    this.insideDungeon = true;
    const actions = officialDungeonBattleReturnActions(outcome, run.session);
    return this.startDungeonScene({ kind: "battleReturn", actions });
  }

  /** Adopt a just-committed terminal projection and cross the retained battle-return seam. */
  async adoptAndEnterPreparedAuthoritativeFromBattle(
    outcome: "victory" | "retreat",
  ): Promise<DungeonNode> {
    if (this.host.authority === undefined) {
      throw new Error("authoritative dungeon battle return requires an authority");
    }
    adoptOfficialDungeonTerminalProjection(this.host.authority, outcome);
    return this.enterPreparedAuthoritativeFromBattle(outcome);
  }

  /** Consume a durable terminal receipt during cold bootstrap, where no BattleNode survives to be
   * the outgoing scene. Room actions and checkpoint ownership remain identical to battleReturn. */
  async restorePreparedAuthoritativeBattleReturn(
    outcome: "victory" | "retreat",
    onSceneReady?: () => Promise<void>,
  ): Promise<DungeonNode> {
    const run = this.requireRun();
    this.insideDungeon = true;
    const actions = officialDungeonBattleReturnActions(outcome, run.session);
    return this.startDungeonScene({ kind: "battleReturn", actions, documentRestore: true,
      ...(onSceneReady === undefined ? {} : { onSceneReady }) });
  }

  clear(): void {


    if (this.localTerminalContinuation.hasCommitted()) return;
    this.run = undefined;
    this.insideDungeon = false;
    this.pendingBattleRewardKeys.clear();
    if (!this.localTerminalContinuation.hasCommitted()) this.activeLocalTerminal = undefined;
    this.localTerminalRetryOwner.clear();
    this.activeLocalTerminalRetryPopup?.dismiss();
    this.activeLocalTerminalRetryPopup = undefined;
  }



  handleAuthoritativeBattleExitFailure(retry: () => boolean): void {
    this.handleTerminalExitFailure(retry);
  }

  private handleTerminalExitFailure(retry: () => boolean): void {



    this.localTerminalRetryOwner.arm(retry);
    void this.showLocalTerminalRetryPopup().catch((error: unknown) => {
      queueMicrotask(() => { throw error; });
    });
  }

  private async showLocalTerminalRetryPopup(): Promise<void> {
    const scene = this.host.scenes.current;
    if (scene === undefined || (scene.sceneKind !== "battle" && scene.sceneKind !== "dungeon")) return;
    if (
      this.activeLocalTerminalRetryPopup !== undefined &&
      !this.activeLocalTerminalRetryPopup.isDismissed
    ) return;
    let popup!: Popup;
    popup = await showMonsterHatchPopup(dungeonPopupEnvironment({
      parent: scene.notificationParent,
      owner: this,
      game: this.host.game,
      audio: this.host.audio,
      ticker: this.host.stage.app.ticker,
    }), {
      title: "Save failed",
      content: buildMonsterHatchMessageContent("The terminal exit was not saved. Try again."),
      buttons: [{
        label: "Retry",
        onPress: () => {
          try {
            this.localTerminalRetryOwner.retry();
          } catch (error) {
            queueMicrotask(() => { throw error; });
          }
        },
      }],
      onDismiss: () => {
        if (this.activeLocalTerminalRetryPopup === popup) {
          this.activeLocalTerminalRetryPopup = undefined;
        }
      },
    });
    if (
      this.host.scenes.current !== scene ||
      !this.localTerminalRetryOwner.hasPending() ||
      popup.isDismissed
    ) {
      popup.dismiss();
      return;
    }
    this.activeLocalTerminalRetryPopup = popup;
  }

  /** Restore an Official run without touching the live feature or presentation state. */
  prepareAuthoritativeRun(
    snapshot: DungeonRunSnapshot | undefined,
    context: DungeonRuntimeContext = this.runtimeContext(),
  ): PreparedAuthoritativeDungeonRun {
    if (snapshot === undefined) {
      return Object.freeze({ hasAuthoritativeRun: false, run: undefined, insideDungeon: false });
    }
    return Object.freeze({
      hasAuthoritativeRun: true,
      run: (() => {
        const prepared = restoreOfficialDungeonRun(context, snapshot);
        // Transient presentation state is copied while the replacement is detached. The commit
        // phase below must not call a mutating helper after the first live aggregate swap.
        if (this.run !== undefined) prepared.inheritTransientPresentationState(this.run);
        return prepared;
      })(),
      insideDungeon: true,
    });
  }

  /** Commit a previously prepared Official run; this method performs no fallible restore. */
  adoptPreparedAuthoritativeRun(prepared: PreparedAuthoritativeDungeonRun): void {
    if (prepared.hasAuthoritativeRun) {
      this.run = prepared.run;
      this.insideDungeon = prepared.insideDungeon;
      return;
    }
    this.insideDungeon = false;
  }

  private runtimeContext(runSeed?: number): DungeonRuntimeContext {
    return {
      resources: this.host.content.resources,
      monsterTypes: this.host.game.gd.allMonsters().map((monster) => monster.shortType),
      ...(this.host.fidelityRng === undefined ? {} : { fidelityRng: this.host.fidelityRng }),
      ...(this.host.fidelityFoundationOrder === undefined
        ? {}
        : { fidelityFoundationOrder: this.host.fidelityFoundationOrder }),
      ...(this.host.authority === undefined
        ? { allowLegacyDungeonGenerationRestore: true }
        : {}),
      isMonsterRegistered: (shortType) =>
        this.host.player().profile.highestRegisteredLevel(shortType) > 0,
      isCatchQuestDone: (instanceName) =>
        this.host.player().profile.hasCompletedCatchQuest(instanceName),
      waypointFloorsForDungeon: (instanceName) =>
        this.host.player().profile.dungeonWaypointsFor(instanceName),
      onWaypointRegistered: (instanceName, floor) => {
        this.host.player().profile.registerDungeonWaypoint(instanceName, floor);
      },
      // Event 10 has no source emitter (see `onDungeonFloorEntered`); the local terminal owns its
      // own dispatch, so route through it when one is active at fire time.
      ...(this.host.onQuestEvent === undefined && this.host.onDungeonRoomRosterUpdated === undefined
        ? {}
        : {
            onDungeonFloorEntered: (instanceName: string, floor: number): void => {
              const event = { id: 10, dungeon: { instanceName, floor } } as const;
              if (this.activeLocalTerminal !== undefined) {
                this.activeLocalTerminal.onQuestEvent(event);
                return;
              }
              this.host.onQuestEvent?.(event);
            },
          }),
      ...(this.host.onQuestEvent === undefined && this.host.onDungeonRoomRosterUpdated === undefined
        ? {}
        : {
        onDungeonRoomRosterUpdated: (
          instanceName: string,
          floor: number,
          survivingMonstersByRoom: readonly number[],
          flow: DungeonTerminalFlowIdentity,
          registerRollback: (rollback: () => void) => void,
        ): void | DungeonRoomRosterUpdateHooks => {
          if (this.activeLocalTerminal !== undefined) {
            return this.activeLocalTerminal.onDungeonRoomRosterUpdated(
              instanceName,
              floor,
              survivingMonstersByRoom,
              registerRollback,
            );
          }
          if (this.host.onDungeonRoomRosterUpdated !== undefined) {
            return this.host.onDungeonRoomRosterUpdated(
              instanceName,
              floor,
              survivingMonstersByRoom,
              flow,
              registerRollback,
            );
          }
          this.host.onQuestEvent!({ id: 4, dungeon: { instanceName, floor, survivingMonstersByRoom } });
        },
      }),
      ...(runSeed === undefined ? {} : { runSeed }),
      ...(this.host.isCompletionSet === undefined ? {} : { isCompletionSet: this.host.isCompletionSet }),
      ...(this.host.isQuestUsable === undefined ? {} : { isQuestUsable: this.host.isQuestUsable }),
    };
  }

  private requireRun(): DungeonRuntimeController {
    if (this.run === undefined) throw new Error("Dungeon feature has no active run");
    return this.run;
  }

  private async startDungeonScene(entry: DungeonSceneEntry): Promise<DungeonNode> {
    const run = this.requireRun();
    const player = this.host.player();
    if (player.party === undefined) throw new Error("Dungeon play requires a durable world-trip party");
    const sceneSession = run.session;
    const sceneRoute = run.route;
    const sceneDefinition = run.definition;
    let node!: DungeonNode;
    let activeMenu: WorldMenu | undefined;
    let activePartyEditor: PartyEditorFlow | undefined;
    let activeMonsterpedia: MonsterpediaFlow | undefined;
    let activeGuildQuests: GuildQuestFlow | undefined;
    let activeOptions: OptionsPanelHandle | undefined;
    let activeHighscores: HighscoresPanelHandle | undefined;
    let activeInventory: InventoryManagementHandle | undefined;
    let activeTutorialMenu: TutorialMenu | undefined;
    let activePlotTutorial: PlotTutorialHandle | undefined;
    let plotTutorialState: PlotTutorialDebugState | undefined;
    let sourceSceneFade: SourceBlackSceneFadeState | undefined;
    let menuActionPending = false;
    let musicNotified = false;
    const notifyDungeonMusic = (): void => {
      // Port-only presentationResume retains the existing track. This says only that the music
      // selector is not called; DungeonNode construction/materialization may still use renderer RNG.
      if (entry.kind === "restore" && entry.presentationResume === true) return;


      if (musicNotified) return;
      musicNotified = true;
      this.playDungeonMusic();
    };
    const settleLoot = async (
      loot: readonly DungeonLoot[],
    ): Promise<readonly AppliedPlayerReward[]> => {
      const applied: AppliedPlayerReward[] = [];
      // Egg.destroyFromPickup hatches during Player.addItem, so do not partition this source-
      // ordered array: earlier rewards must be visible to the pool and later rewards must not.
      for (const reward of loot) {
        if (reward.kind === "egg" || reward.kind === "monsterEgg" || reward.kind === "repeatEgg") {
          await this.presentDungeonEggs(node, [reward]);
        } else {
          applied.push(...this.awardLoot([reward]));
          this.host.checkpoint();
        }
      }
      return applied;
    };
    const launchMenuAction = (action: () => void | Promise<void>): void => {
      menuActionPending = true;
      void Promise.resolve()
        .then(action)
        .catch((error: unknown) => {
          // Menu callbacks originate at a Pixi event boundary. Preserve fail-loud behavior instead
          // of converting a missing destination or asset into an inert-looking button.
          queueMicrotask(() => { throw error; });
        })
        .finally(() => {
          if (!node.lifecycleSignal.aborted) menuActionPending = false;
        });
    };
    const presentPartyManagementTutorial = async (): Promise<void> => {
      const topic = sourceTutorialTopic(this.host.game.sourceTutorialTopics, "Tutorial4");
      if (
        !partyManagementShowsFirstUseTutorial(1) ||
        !hasSourceTutorialTopicSurface(this.host.game, topic) ||
        player.profile.hasTutorialFlag(topic.key) ||
        activePlotTutorial !== undefined
      ) {
        return;
      }
      await this.host.authority?.claimTutorialFlag(topic.key);
      if (!player.profile.claimTutorialFlag(topic.key)) return;
      // Source setTutorialFlag marks UserSavedData dirty before PlotGameFlowEvent begins.
      this.host.checkpoint();
      const handle = await showPlotTutorial({
        parent: node.notificationParent,
        owner: node,
        assets: this.host.game.assets,
        scale9: this.host.game.scale9,
        strings: this.host.game.strings,
        ticker: this.host.stage.app.ticker,
        keyboard: this.host.keyboard,
        key: topic.key,
        images: topic.images,
        onClick: () => this.host.audio.playSfx("click"),
        onStateChanged: (state) => {
          plotTutorialState = state;
          this.host.checkpoint();
        },
      });
      if (node.lifecycleSignal.aborted) {
        handle.dismiss();
        return;
      }
      activePlotTutorial = handle;
      void handle.done.then(() => {
        if (activePlotTutorial === handle) activePlotTutorial = undefined;
        this.host.checkpoint();
      });
    };



    if (this.host.fidelityRng !== undefined) {
      let materializedFloors = this.materializedItemFloors.get(run);
      if (materializedFloors === undefined) {
        materializedFloors = new Set<string>();
        this.materializedItemFloors.set(run, materializedFloors);
      }
      const itemFloorKey = `${sceneSession.state.definitionId}\u0000${sceneSession.state.floor}`;
      if (!materializedFloors.has(itemFloorKey)) {
        for (const room of sceneSession.state.rooms) {
          const treasure = room.encounter?.treasure ?? room.treasure;
          for (const loot of treasure?.loot ?? []) {
            if (loot.kind === "silver") this.host.fidelityRng.next();
          }
        }
        materializedFloors.add(itemFloorKey);
      }
    }

    node = await DungeonNode.create({
      stage: this.host.stage,
      game: this.host.game,
      audio: this.host.audio,
      definition: run.definition,
      session: sceneSession,
      route: sceneRoute,
      ...(this.host.fidelityRng === undefined ? {} : { fidelityRng: this.host.fidelityRng }),
      initiallyHidden: true,
      allowWaypointSelection: entry.kind === "worldEntry",
      onEncounter: (request, preparation) => this.startEncounter(
        node,
        request,
        undefined,
        preparation,
      ),
      onPrepareEncounter: (request) => this.prepareEncounter(request),
      ...(this.host.authority === undefined
        ? {}
        : {
            onSelectRoom: async (roomId: string, onIntentAccepted) => {
              // Predict the presentation transition from the pre-command room. The committed
              // projection may synchronously adopt the destination into `sceneSession`; forking
              // afterward collapses a real door walk into a same-room selection.
              const preview = sceneSession.fork();
              const selection = preview.selectMaterializedRoom(roomId);
              await this.host.authority!.submit(
                { type: "dungeon.selectRoom", roomId },
                { onIntentAccepted: () => onIntentAccepted?.(selection) },
              );
              this.host.authority!.adoptProjection();
              if (selection.kind === "changed-room") {
                const adoptedRoomId = sceneSession.state.currentRoomId;
                if (adoptedRoomId === selection.fromRoomId) {




                  sceneSession.selectMaterializedRoom(roomId);
                } else if (adoptedRoomId !== selection.toRoomId) {
                  throw new Error(
                    `Official dungeon adopted unexpected room ${adoptedRoomId}; expected ` +
                    `${selection.fromRoomId} or ${selection.toRoomId}`,
                  );
                }
              }
              return selection;
            },
          }),
      onActivateZone: async (zoneId) => {
        if (this.host.authority === undefined) {
          return run.activateZoneForSession(sceneSession, zoneId);
        }
        const result = await this.host.authority.submit({
          type: "dungeon.activateZone",
          zoneId,
        });
        const preview = restoreOfficialDungeonRun(this.runtimeContext(), run.snapshot());
        const transition = preview.activateZoneForSession(preview.session, zoneId);
        this.host.authority.adoptProjection();
        return transition;
      },
      onTransition: async (transition) => {
        try {
          if (transition.kind === "world") {
            const change = transition.change;


            this.insideDungeon = false;
            this.host.checkpoint();
            await this.host.onWorldExit(change);
            return;
          }
          await this.startDungeonScene({ kind: "route" });
        } catch (error) {
          if (this.run === run && this.host.scenes.current === node) {
            run.rollbackToScene(sceneRoute, sceneDefinition, sceneSession);
            this.insideDungeon = true;
          }
          throw error;
        }
      },
      onWaypoint: (firstReach) => {
        const controller = this.requireRun();
        if (firstReach && this.host.authority === undefined) {
          controller.registerWaypoint();
          this.host.checkpoint();
        }
        return controller.availableWaypoints();
      },
      onWaypointTravel: async (destination) => {
        if (run.session !== sceneSession) return;
        if (this.host.authority === undefined) {
          run.travelToWaypoint(destination);
          this.host.checkpoint();
        } else {
          const result = await this.host.authority.submit({
            type: "dungeon.travelToWaypoint",
            floor: destination.floor,
          });
          this.host.authority.adoptProjection();
        }
        try {
          await this.startDungeonScene({ kind: "route" });
        } catch (error) {
          if (this.run === run && this.host.scenes.current === node) {
            run.rollbackToScene(sceneRoute, sceneDefinition, sceneSession);
          }
          throw error;
        }
      },
      onCatchQuest: () => {
        if (this.host.scenes.current !== node) return;
        const changedCatchQuest = run.takeChangedCatchQuestProgress();
        if (changedCatchQuest === undefined) return;
        // Native dispatches CatchQuestDisplay and immediately continues into the name plate and
        // music calls. Popup construction/pop-in is detached but remains owned by this node.
        void this.showCatchQuest(node, changedCatchQuest)
          .catch((error: unknown) => { queueMicrotask(() => { throw error; }); });
      },
      onMusic: notifyDungeonMusic,
      claimTutorialFlag: async (flag) => {
        await this.host.authority?.claimTutorialFlag(flag);
        return player.profile.claimTutorialFlag(flag);
      },
      claimFloorPresence: () => run.claimCurrentFloorPresence(),
      onInfiniteDungeonFloor: (floor) => this.recordInfiniteDungeonFloor(floor),
      // Online settlement is pure state, so it runs behind the still-mounted loot card in the
      // native `closePopup` order, and the Egg it can produce is the continuation after removal.
      // Offline settlement presents as it walks the rewards, so it keeps `onLoot`'s later slot.
      ...(this.host.authority === undefined ? {} : {
        onLootClaim: async (treasure: DungeonTreasure) => {
          const authority = this.host.authority;
          if (authority === undefined) throw new Error("Official treasure claim lost its authority");
          try {
            await authority.submit({ type: "dungeon.openTreasure", treasureId: treasure.id });
          } catch (error) {
            // `CommandCoordinator.submit` stores a NEWER projection and only then throws, both on
            // a revision conflict (it bootstraps first) and when an uncertain envelope is
            // recovered before a newer intent. Adopting only on the success tail left the mounted
            // dungeon rendering the older mirror — including the chest this claim had already
            // removed locally — until some later scene reconstruction happened to hide it.
            if (
              error instanceof CommandStateResyncedError ||
              error instanceof CommandRecoveredBeforeNewIntentError
            ) {
              authority.adoptProjection();
            }
            throw error;
          }
          authority.adoptProjection();
          return async () => { await this.presentPendingOfficialEgg(node); };
        },
      }),
      onLoot: async (loot, treasure) => {
        const result = await settleLoot(loot);
        const rewardKey = this.pendingBattleRewardKeys.get(treasure.id);
        if (rewardKey !== undefined) {
          this.pendingBattleRewardKeys.delete(treasure.id);
          this.host.markBattleRewardReceived?.(rewardKey);
        }
        return result;
      },
      heroLevel: player.profile.heroLevel,
      heroTotalHighestLevels: player.profile.heroTotalHighestLevels,
      isMonsterRegistered: (shortType) => player.profile.highestRegisteredLevel(shortType) > 0,
      isCollectionMonsterEligible: (shortType, extraLivingArguments) =>
        extraLivingArguments?.capturable !== false &&
        this.host.game.gd.monsterByShortType(shortType).category !== "Summon",
      onMenu: async () => {
        if (
          activeMenu !== undefined ||
          activePartyEditor !== undefined ||
          activeMonsterpedia !== undefined ||
          activeGuildQuests !== undefined ||
          activeOptions !== undefined ||
          activeHighscores !== undefined ||
          activeInventory !== undefined ||
          activeTutorialMenu !== undefined ||
          activePlotTutorial !== undefined ||
          sourceSceneFade !== undefined ||
          menuActionPending
        ) return;
        activeMenu = await WorldMenu.show(node.notificationParent, {
          assets: this.host.game.assets,
          scale9: this.host.game.scale9,
          strings: this.host.game.strings,
          ticker: this.host.stage.app.ticker,
          // The source builder keeps its common actions operable in dungeon context and swaps only
          // Big Map for Catch Quest. Rows whose destination systems remain unimplemented stay
          // visibly disabled; already-implemented routes must not regress merely because world=nil.
          enabledActions: enabledDungeonMenuActions(
            this.host.onTownPortal !== undefined,
            hasCompleteSourceTutorialSurface(this.host.game),
            guildQuestListAvailable(this.host.game.assets, this.host.guildQuests?.()),
            this.host.scoreboard !== undefined,
          ),
          context: "dungeon",
          editable: false,
          onClick: () => this.host.audio.playSfx("click"),
          onClose: () => { activeMenu = undefined; },
          onSelect: (action: WorldMenuAction) => {
            if (action === "options") {
              launchMenuAction(async () => {
                const handle = await showOptionsPanel({
                  parent: node.notificationParent,
                  assets: this.host.game.assets,
                  scale9: this.host.game.scale9,
                  strings: this.host.game.strings,
                  ticker: this.host.stage.app.ticker,
                  audio: this.host.audio,
                  onClick: () => this.host.audio.playSfx("click"),
                  onDismiss: () => { activeOptions = undefined; },
                  onPresentationChange: this.host.onPresentationChange,
                  ...(this.host.account === undefined ? {} : { account: this.host.account }),
                });
                if (node.lifecycleSignal.aborted) {
                  handle.popup.dismiss();
                  return;
                }
                activeOptions = handle;
              });
            } else if (action === "highscores") {
              const scoreboard = this.host.scoreboard;
              if (scoreboard === undefined) return;
              launchMenuAction(async () => {
                let handle: HighscoresPanelHandle | undefined;
                handle = await showHighscoresPanel({
                  parent: node.notificationParent,
                  assets: this.host.game.assets,
                  scale9: this.host.game.scale9,
                  strings: this.host.game.strings,
                  ticker: this.host.stage.app.ticker,
                  source: scoreboard,
                  onClick: () => this.host.audio.playSfx("click"),
                  onDismiss: () => {
                    if (activeHighscores === handle) activeHighscores = undefined;
                  },
                });
                if (node.lifecycleSignal.aborted) {
                  handle.dispose();
                  return;
                }
                activeHighscores = handle;
              });
            } else if (action === "items") {
              launchMenuAction(async () => {
                let handle: InventoryManagementHandle | undefined;
                handle = await showInventoryManagement({
                  parent: node.notificationParent,
                  owner: node,
                  assets: this.host.game.assets,
                  scale9: this.host.game.scale9,
                  strings: this.host.game.strings,
                  ticker: this.host.stage.app.ticker,
                  data: this.host.game.gd,
                  profile: player.profile,
                  type: 2,
                  title: localizedString(this.host.game.strings, "ItemsInfoTitleKey"),
                  onClick: () => this.host.audio.playSfx("click"),
                  onBlocked: () => this.host.audio.playSfx("notAllowed"),
                  onClose: () => {
                    if (activeInventory === handle) activeInventory = undefined;
                  },
                  mutate: async (_action, itemId) => {
                    await this.host.authority?.submit({
                      type: "player.dropInventoryItem",
                      itemId,
                    });
                    player.profile.inventory.drop(itemId);
                    this.host.checkpoint();
                  },
                });
                if (node.lifecycleSignal.aborted) {
                  handle?.requestClose();
                  return;
                }
                activeInventory = handle;
              });
            } else if (action === "catchQuest") {
              launchMenuAction(() => this.showCatchQuest(node, run.catchQuestProgress()));
            } else if (action === "monsters") {
              launchMenuAction(() => this.showDungeonPartyEditor(
                node,
                (editor) => { activePartyEditor = editor; },
                presentPartyManagementTutorial,
              ));
            } else if (action === "monsterpedia") {
              launchMenuAction(() => this.showDungeonMonsterpedia(node, (flow) => {
                activeMonsterpedia = flow;
              }, (state) => { sourceSceneFade = state; }));
            } else if (action === "quests") {
              launchMenuAction(async () => {
                const runtime = this.host.guildQuests?.();
                if (!guildQuestListAvailable(this.host.game.assets, runtime)) {
                  throw new Error("Dungeon QuestsMenuItem has no Guild quest runtime");
                }
                let flow: GuildQuestFlow | undefined;
                flow = await GuildQuestFlow.showQuestList({
                  parent: node.notificationParent,
                  game: this.host.game,
                  audio: this.host.audio,
                  ticker: this.host.stage.app.ticker,
                  runtime,




                  onClaimReward: () => {
                    throw new Error("Guild quest rewards are not claimable from the dungeon menu");
                  },
                  onStateChanged: this.host.checkpoint,
                  onClose: () => {
                    if (activeGuildQuests === flow) activeGuildQuests = undefined;
                  },
                });
                if (node.lifecycleSignal.aborted) {
                  flow.dispose();
                  return;
                }
                activeGuildQuests = flow;
              });
            } else if (action === "tutorials") {
              launchMenuAction(async () => {
                let menu: TutorialMenu | undefined;
                menu = await TutorialMenu.show({
                  parent: node.notificationParent,
                  assets: this.host.game.assets,
                  scale9: this.host.game.scale9,
                  strings: this.host.game.strings,
                  ticker: this.host.stage.app.ticker,
                  keyboard: this.host.keyboard,
                  topics: this.host.game.sourceTutorialTopics,
                  onClick: () => this.host.audio.playSfx("click"),
                  onClose: () => {
                    if (activeTutorialMenu === menu) activeTutorialMenu = undefined;
                  },
                  onStateChanged: this.host.checkpoint,
                });
                if (node.lifecycleSignal.aborted) {
                  menu.close();
                  return;
                }
                activeTutorialMenu = menu;
              });
            } else if (action === "townPortal") {
              const portal = this.host.onTownPortal;
              if (portal === undefined) {
                throw new Error("Dungeon Town Portal is unavailable for this content package");
              }
              launchMenuAction(portal);
            } else if (action === "mainMenu") {
              launchMenuAction(() => showMainMenuConfirmation({
                parent: node.notificationParent,
                assets: this.host.game.assets,
                scale9: this.host.game.scale9,
                strings: this.host.game.strings,
                ticker: this.host.stage.app.ticker,
                owner: node,
                onClick: () => this.host.audio.playSfx("click"),
                onConfirm: this.host.onMainMenu,
              }));
            }
          },
        });
      },
      menuState: () => ({
        menu: activeMenu?.debugState ?? null,
        sceneFade: sourceSceneFade,
        overlay:
          activeTutorialMenu?.debugState ??
          (this.activeEggHatch === undefined
            ? undefined
            : { ...this.activeEggHatch.debugState } as Record<string, unknown>) ??
          (plotTutorialState === undefined
            ? undefined
            : { kind: "tutorial", tutorial: plotTutorialState }) ??
          activePartyEditor?.debugState ??
          activeMonsterpedia?.debugState ??
          activeGuildQuests?.debugState ??
          activeOptions?.debugState() ??
          activeHighscores?.debugState() ??
          activeInventory?.debugState ??
          null,
      }),
      onStateChanged: this.host.checkpoint,
      diagnostics: () => this.diagnosticSnapshot(),
      ...(this.host.onNotificationHostReady === undefined
        ? {}
        : { onNotificationHostReady: this.host.onNotificationHostReady }),
      onDiagnostic: (message, detail) => {
        this.recordDiagnostic(message, detail);
      },
    });

    const updateMenuFlows = (): void => {
      const deltaMs = this.host.stage.app.ticker.deltaMS;
      activePartyEditor?.update(deltaMs);
      activeMonsterpedia?.update(deltaMs);
    };
    this.host.stage.app.ticker.add(updateMenuFlows);
    const unregisterKeyboard = this.host.keyboard.register(({ key }) => {
      if (this.host.scenes.current !== node) return false;
      if (key === "escape") {
        if (sourceSceneFade !== undefined) return true;
        if (activePlotTutorial !== undefined) return true;
        if (activeTutorialMenu !== undefined) return activeTutorialMenu.requestBack();
        if (activeOptions !== undefined) {
          activeOptions.requestClose();
          return true;
        }
        if (activeHighscores !== undefined) return activeHighscores.requestBack();
        // Ahead of `dismissTopPopup`, as in the world chain: the flow's own Back closes its stacked
        // quest Chat before the quest popup underneath it.
        if (activeGuildQuests !== undefined) {
          activeGuildQuests.requestBack();
          return true;
        }
        if (activeInventory !== undefined) {
          activeInventory.requestClose();
          activeInventory = undefined;
          return true;
        }
        if (node.dismissTopPopup()) return true;
        if (activeMonsterpedia !== undefined) {
          activeMonsterpedia.requestBack();
          return true;
        }
        if (activePartyEditor !== undefined) {
          activePartyEditor.requestBack();
          return true;
        }
        if (activeMenu !== undefined) {
          activeMenu.close(() => { activeMenu = undefined; });
          return true;
        }
        if (menuActionPending) return true;
        return node.requestMenu();
      }
      if (isAdvanceShortcut(key)) {
        // Same precedence as Back: the floor notice draws over the entrance selector and swallows
        // input while it is up, so Advance may not reach a "Go To" it is covering.
        return node.advanceKeyboardText() || node.confirmKeyboardDialog();
      }
      if (
        activeMenu !== undefined ||
        activePartyEditor !== undefined ||
        activeMonsterpedia !== undefined ||
        activeGuildQuests !== undefined ||
        activeOptions !== undefined ||
        activeHighscores !== undefined ||
        activeInventory !== undefined ||
        activeTutorialMenu !== undefined ||
        activePlotTutorial !== undefined ||
        sourceSceneFade !== undefined ||
        menuActionPending
      ) return false;
      const direction = dungeonDirectionForShortcut(key);
      return direction === undefined ? false : node.requestDirectionalMove(direction);
    }, node.lifecycleSignal);
    node.onDestroy(() => {
      unregisterKeyboard();
      this.host.stage.app.ticker.remove(updateMenuFlows);
      activeMenu?.close(() => { activeMenu = undefined; });
      activePartyEditor?.dispose();
      activePartyEditor = undefined;
      activeMonsterpedia?.dispose();
      activeMonsterpedia = undefined;
      activeGuildQuests?.dispose();
      activeGuildQuests = undefined;
      activeOptions?.popup.dismiss();
      activeOptions = undefined;
      activeHighscores?.dispose();
      activeHighscores = undefined;
      activeInventory?.requestClose();
      activeInventory = undefined;
      activeTutorialMenu?.close();
      activeTutorialMenu = undefined;
      activePlotTutorial?.dismiss();
      activePlotTutorial = undefined;
      plotTutorialState = undefined;
    });

    const initialActions = entry.kind === "battleReturn" ? entry.actions : undefined;
    // Source scene factories call DungeonNode.setCurrentRoom before the incoming scene is added.
    // Start its 0.25s out/teleport/0.25s in assignment now so it stays under this 0.5s cover.
    void node.prepareStart(initialActions);
    await this.host.scenes.replace(node, async ({ outgoing, activate, retireOutgoing }) => {
      if (
        outgoing === undefined &&
        (
          entry.kind === "restore" ||
          (entry.kind === "battleReturn" && entry.documentRestore === true)
        )
      ) {
        // Port-only document restore: there is no outgoing scene and therefore no fade.
        activate();
        return;
      }
      if (outgoing === undefined) throw new Error(`Dungeon ${entry.kind} transition has no outgoing scene`);
      const shade = new Graphics().rect(
        0, 0, this.host.stage.app.screen.width, this.host.stage.app.screen.height,
      ).fill(0x000000);
      shade.alpha = 0;
      this.host.stage.root.addChild(shade);
      await tween(this.host.stage.app.ticker, 250, (t) => { shade.alpha = t; });
      retireOutgoing();
      activate();
      await tween(this.host.stage.app.ticker, 250, (t) => { shade.alpha = 1 - t; });
      shade.destroy();
    });
    if ("onSceneReady" in entry && entry.onSceneReady !== undefined) {
      // A restored room can immediately await Take All. Reveal the prepared scene before those
      // player-owned entry actions; waiting for start() first deadlocks behind the startup shade.
      await node.prepareStart(initialActions);
      await entry.onSceneReady();
    }
    await node.start(initialActions);


    if (this.run !== undefined && entry.kind !== "battleReturn") this.host.checkpoint();
    return node;
  }

  private async showDungeonPartyEditor(
    node: DungeonNode,
    setActive: (editor: PartyEditorFlow | undefined) => void,
    onReady?: () => void | Promise<void>,
  ): Promise<void> {
    const player = this.host.player();
    if (player.party === undefined) throw new Error("Dungeon Monsters requires a world-trip party");
    let editor: PartyEditorFlow | undefined;
    editor = await PartyEditorFlow.show({
      parent: node.notificationParent,
      assets: this.host.game.assets,
      scale9: this.host.game.scale9,
      strings: this.host.game.strings,
      ticker: this.host.stage.app.ticker,
      gd: this.host.game.gd,
      party: player.party,
      // DungeonNode passes editable=NO to GeneralMenuItem, the same style-1 policy as WorldNode.
      style: 1,
      signal: node.lifecycleSignal,
      // Local-only: in Official mode `party.convertToSoulStone` is reduced server-side, which
      // already fires event 3 and returns it in the command projection.
      ...(this.host.onQuestEvent === undefined
        ? {}
        : { onQuestEvent: this.host.onQuestEvent }),
      hasCapturedSimpleType: (shortType) =>
        player.profile.highestRegisteredLevel(shortType) > 0,
      healInjury: (instanceId, nowSeconds) =>
        healDungeonPartyMonster(player, this.host.authority, instanceId, nowSeconds),
      ...(this.host.authority === undefined
        ? {}
        : {
            submitAuthoritative: async (command) => await this.host.authority!.submit(command),
          }),
      onStateChanged: this.host.checkpoint,
      onClose: () => {
        setActive(undefined);
        editor?.dispose();
      },
      playSfx: (key) => this.host.audio.playSfx(key),
    });
    if (editor === undefined || node.lifecycleSignal.aborted) {
      editor?.dispose();
      return;
    }
    setActive(editor);
    await onReady?.();
  }

  private async showDungeonMonsterpedia(
    node: DungeonNode,
    setActive: (flow: MonsterpediaFlow | undefined) => void,
    setFade: (state: SourceBlackSceneFadeState | undefined) => void,
  ): Promise<void> {
    const player = this.host.player();
    if (player.party === undefined) throw new Error("Dungeon Monsterpedia requires a world-trip party");
    let flow: MonsterpediaFlow | undefined;
    flow = await MonsterpediaFlow.show({
      parent: node.notificationParent,
      assets: this.host.game.assets,
      scale9: this.host.game.scale9,
      strings: this.host.game.strings,
      ticker: this.host.stage.app.ticker,
      renderer: this.host.stage.app.renderer,
      gd: this.host.game.gd,
      profile: player.profile,
      partyMembers: () => player.party!.monsters().map((member) => ({
        ...member,
        playerBuffs: player.party!.playerBuffsOf(member.instanceId),
      })),
      editable: false,
      deferPresentation: true,
      signal: node.lifecycleSignal,
      showCategoryName: (text) => node.showMenuNamePlate(text),
      combineMonsters: () => {
        throw new Error("Dungeon Monsterpedia is view-only");
      },
      ...(this.host.authority === undefined
        ? {}
        : {
            claimTutorialFlag: async (flag: string) => {
              await this.host.authority!.claimTutorialFlag(flag);
            },
          }),
      onClose: async () => {
        const closing = flow;
        if (closing === undefined) return;
        const screen = screenPointsForMode(DISPLAY_MODE);
        await runSourceBlackSceneFade({
          parent: node.notificationParent,
          ticker: this.host.stage.app.ticker,
          width: screen.w,
          height: screen.h,
          route: "dungeon-menu-monsterpedia-return",
          signal: node.lifecycleSignal,
          onState: setFade,
          onMidpoint: () => {
            setActive(undefined);
            closing.dispose();
          },
        });
      },
      playSfx: (key) => this.host.audio.playSfx(key),
    });
    if (flow === undefined || node.lifecycleSignal.aborted) {
      flow?.dispose();
      return;
    }
    const screen = screenPointsForMode(DISPLAY_MODE);
    const opened = await runSourceBlackSceneFade({
      parent: node.notificationParent,
      ticker: this.host.stage.app.ticker,
      width: screen.w,
      height: screen.h,
      route: "dungeon-menu-monsterpedia",
      signal: node.lifecycleSignal,
      onState: setFade,
      onMidpoint: () => {
        setActive(flow);
        flow!.present();
      },
    });
    if (!opened || node.lifecycleSignal.aborted) {
      setActive(undefined);
      flow.dispose();
    }
  }

  private async showCatchQuest(
    node: DungeonNode,
    progress: ReturnType<DungeonRuntimeController["catchQuestProgress"]>,
  ): Promise<void> {
    await showDungeonCatchQuestDisplay({
      parent: node.notificationParent,
      owner: node.notificationOwner,
      game: this.host.game,
      audio: this.host.audio,
      ticker: this.host.stage.app.ticker,
      definition: this.requireRun().definition,
      progress,
      onClaim: async () => {
        const run = this.requireRun();
        if (this.host.authority !== undefined) {
          const loot = run.claimCatchQuestReward();
          const result = await this.host.authority.submit({
            type: "dungeon.claimCatchReward",
          });
          this.host.authority.adoptProjection();
          if (loot.length > 0) {
            await showDungeonLootManagement({
              parent: node.notificationParent,
              owner: node.notificationOwner,
              game: this.host.game,
              audio: this.host.audio,
              ticker: this.host.stage.app.ticker,
            }, loot, () => {});
          }
          await this.presentPendingOfficialEgg(node);
          return;
        }
        const loot = run.claimCatchQuestReward();
        // Source writes dungeon.instanceName into UserSavedData.catchQuestsDone after invoking the
        // loot provider. The runtime has already made the popup one-shot; persist the same identity
        // before waiting for the nested web modal to close.
        if (run.catchQuestProgress()?.rewardCollected === true) {
          this.host.player().profile.completeCatchQuest(run.definition.instanceName);
        }
        if (loot.length === 0) {
          this.host.checkpoint();
          return;
        }
        await showDungeonLootManagement({
          parent: node.notificationParent,
          owner: node.notificationOwner,
          game: this.host.game,
          audio: this.host.audio,
          ticker: this.host.stage.app.ticker,
        }, loot, async (remaining) => {
          for (const reward of remaining) {
            if (reward.kind === "egg" || reward.kind === "monsterEgg" || reward.kind === "repeatEgg") {
              await this.presentDungeonEggs(node, [reward]);
            } else {
              this.awardLoot([reward]);
              this.host.checkpoint();
            }
          }
        });
        this.host.checkpoint();
      },
    });
  }







  private async startEncounter(
    node: DungeonNode | undefined,
    request: DungeonEncounterRequest,
    restart?: {
      readonly terminalFlow: DungeonTerminalFlowIdentity | undefined;
      readonly localTerminal: LocalDungeonTerminal | undefined;
    },
    preparation?: Promise<void>,
  ): Promise<void> {
    if (this.localTerminalContinuation.hasCommitted()) {
      throw new Error("Dungeon encounter cannot start while a terminal continuation is pending");
    }
    const run = this.requireRun();
    const player = restart?.localTerminal?.player ?? this.host.player();
    if (player.party === undefined) throw new Error("Dungeon battle requires a world-trip party");
    const built = buildDungeonBattle(
      request.definition,
      request.encounter,
      player.party.projectAliveBattingPrefix(),
      { authority: this.host.authority === undefined ? "local" : "official" },
    );
    const encounter = this.withChatEvents(built.encounter, request.encounter);
    if (!this.host.content.combatBackgroundKeys.includes(encounter.backgroundKey)) {
      throw new Error(`Dungeon encounter references unavailable combat background ${encounter.backgroundKey}`);
    }
    for (const diagnostic of built.diagnostics) {
      this.recordDiagnostic(diagnostic.message, {
        code: diagnostic.code,
        encounterId: request.encounter.id,
        ...(diagnostic.detail ?? {}),
      });
    }
    // Native assets and its synchronous save path are resident before RoomNode's fixed callback.
    // The browser begins equivalent preparation at flourish start, but a cold decode or durable
    // checkpoint can outlive that second. Start the source white transition immediately and keep
    // any unavoidable browser-only wait under its opaque midpoint instead of visibly freezing the
    // centred encounter marker. Save Me restarts have no outgoing DungeonNode/flourish and retain
    // their existing transition ownership below.
    const entryShade = node === undefined || preparation === undefined
      ? undefined
      : new Graphics().rect(
          0,
          0,
          this.host.stage.app.screen.width,
          this.host.stage.app.screen.height,
        ).fill(0xffffff);
    if (entryShade !== undefined) {
      entryShade.label = "dungeonBattleTransitionShade";
      entryShade.alpha = 0;
      this.host.stage.root.addChild(entryShade);
    }
    const entryCover = entryShade === undefined
      ? undefined
      : tween(this.host.stage.app.ticker, 250, (t) => { entryShade.alpha = t; });
    try {
      if (preparation === undefined) await this.preloadEncounter(encounter);
      else await preparation;
    const projectedBattle = this.host.authority?.projection().battle;
    if (this.host.authority !== undefined && projectedBattle === undefined) {
      throw new Error("official dungeon encounter has no authoritative battle projection");
    }
    const authorityRng = projectedBattle === undefined
      ? undefined
      : replayableRng(projectedBattle.randomDraws);




    await this.host.scenes.whenIdle();
    if (node !== undefined && (node.lifecycleSignal.aborted || this.host.scenes.current !== node)) {
      return;
    }

    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    const terminalRoster = (): readonly DungeonMonster[] => terminalDungeonMonsterRoster(
      request.encounter,
      battle.terminalEnemyConstructionIndices(),
    );
    const beforeTerminalFlow = this.host.authority === undefined ? run.snapshot() : undefined;
    const terminalFlow = restart !== undefined
      ? restart.terminalFlow
      : allocateDungeonTerminalFlow(
          this.host.authority === undefined ? "local" : "official",
          () => run.allocateTerminalFlowIdentity(request.encounter.id),
        );
    // Only an untrusted local run allocates a browser-owned terminal identity. Official battle
    // presentation starts from the committed battle projection and must not checkpoint or mutate
    // a local dungeon before the reducer's terminal command is adopted.
    if (restart === undefined && terminalFlow !== undefined) {
      try {
        await this.host.checkpointAsync();
      } catch (error) {
        if (beforeTerminalFlow === undefined) throw error;
        run.rollbackUncommittedTerminalFlow(terminalFlow, beforeTerminalFlow);
        throw error;
      }
    }
    const reportPostWinDiagnostics = createDungeonBattleLifecycleDiagnosticReporter(
      request.encounter,
      (diagnostic) => this.recordDiagnostic(diagnostic.message, {
        code: diagnostic.code,
        encounterId: request.encounter.id,
        ...(diagnostic.detail ?? {}),
      }),
    );
    const localTerminal = restart !== undefined
      ? restart.localTerminal
      : this.host.authority === undefined
      ? (() => {
          if (this.host.createLocalTerminal === undefined) {
            throw new Error("local dungeon terminal aggregate is unavailable");
          }
          return this.host.createLocalTerminal(
            this.pendingBattleRewardSnapshot(),
            {
              runSeed: run.runSeed,
              route: run.route,
              captureSerial: run.snapshot().captureSerial,
            },
          );
        })()
      : undefined;
    this.activeLocalTerminal = localTerminal;
    const battlePlayer = localTerminal?.player ?? player;
    const onQuestEvent = this.host.authority !== undefined ||
        (this.host.onQuestEvent === undefined && localTerminal === undefined)
      ? undefined
      : (event: GuildQuestEvent) => {
          if (localTerminal !== undefined) localTerminal.onQuestEvent(event);
          else this.host.onQuestEvent?.(event);
        };
    let battle!: BattleNode;
    const defeatRecovery = encounter.blockSaveMe || this.host.defeatRecovery === undefined
      ? undefined
      : this.host.defeatRecovery(
          () => battle,
          encounter,
          localTerminal?.player,
          localTerminal === undefined ? undefined : () => undefined,
        );
    battle = new BattleNode({
      stage: this.host.stage,
      game: this.host.game,
      audio: this.host.audio,
      keyboard: this.host.keyboard,
      encounter,
      tripParty: battlePlayer.battleParty(),
      playerState: battlePlayer.battleState(),
      ...(defeatRecovery === undefined ? {} : { defeatRecovery }),
      openGoldStore: () => this.host.openGoldStore(
        battle.notificationParent,
        battle,
        battlePlayer,
        localTerminal === undefined ? this.host.checkpoint : () => undefined,
      ),
      ...(projectedBattle === undefined || authorityRng === undefined
        ? {}
        : {
            authority: {
              battleId: projectedBattle.battleId,
              replay: dungeonOfficialBattleReplay(projectedBattle),
              submit: async (command) => {
                const result = await this.host.authority!.submit(command);
                const replay = result.events.find((event) =>
                  event.type === "battle.replayAdvanced");
                if (replay === undefined || replay.battleId !== projectedBattle.battleId) {
                  throw new Error("official dungeon battle response omitted its committed draws");
                }
                authorityRng.appendCommittedDraws(replay.randomDraws);
                if (result.events.some((event) => event.type === "battle.rewardsGranted")) {
                  throw new Error(
                    "official dungeon battle settled room-owned treasure before Take All",
                  );
                }
              },
              claimTutorialFlag: (flag) => this.host.authority!.claimTutorialFlag(flag),
            },
          }),
      ...(onQuestEvent === undefined ? {} : { onQuestEvent }),
      ...(this.host.requestChatPresentation === undefined
        ? {}
        : { requestChatPresentation: this.host.requestChatPresentation }),
      ...(this.host.authority === undefined
        ? {
          captureInstanceId: (shortType: string) =>
              localTerminal!.nextCaptureInstanceId(request.encounter.id, shortType),
          }
        : {}),
      onReady: markReady,
      onExitFailure: (_outcome, _error, retry) => {
        this.handleTerminalExitFailure(retry);
      },
      onCommittedTerminal: (outcome) => {
        if (outcome === "victory") reportPostWinDiagnostics(outcome);
      },
      onExit: async (outcome) => {
        const terminalOutcome = outcome === "saveMe" ? "retreat" : outcome;
        if (outcome === "saveMe") {
          if (this.host.authority !== undefined) {
            // Current authority returns the source-shaped previous-room projection. Retain the
            // historical replacement path only for an immutable older simulation projection.
            if (this.host.authority.projection().location.kind === "battle") {
              this.host.authority.adoptProjection();
              await this.startEncounter(undefined, request);
              return;
            }
            await this.adoptAndEnterPreparedAuthoritativeFromBattle("retreat");
            return;
          }
        }
        if (this.host.authority !== undefined) {
          if (outcome === "defeat") {
            await resolveOfficialDefeatReturn(
              this.host.authority.projection(),
              (command) => this.host.authority!.submit(command),
            );
          }
          adoptOfficialDungeonTerminalProjection(this.host.authority, terminalOutcome);
          if (terminalOutcome === "defeat") {
            this.clear();
            await this.host.onDefeat();
            return;
          }
          const returnedNode = await this.enterPreparedAuthoritativeFromBattle(terminalOutcome);
          await this.presentPendingOfficialEgg(returnedNode);
          return;
        }
        if (terminalFlow === undefined) {
          throw new Error("local dungeon terminal flow was not allocated");
        }
        if (localTerminal === undefined) {
          throw new Error("local dungeon terminal aggregate is missing");
        }
         const flowKey = localDungeonTerminalFlowKey(terminalFlow);
         const finishCommittedHandoff = (): void => {
           this.activeLocalTerminal = undefined;
           localTerminal.clear();
           this.localTerminalRetryOwner.clear();
           this.activeLocalTerminalRetryPopup?.dismiss();
           this.activeLocalTerminalRetryPopup = undefined;
            if (terminalOutcome === "defeat") {
             // `clear()` is intentionally suppressed while the continuation is committed. Once
             // resume succeeds the record is gone, so purge the dungeon cache exactly once.
             this.run = undefined;
             this.insideDungeon = false;
             this.pendingBattleRewardKeys.clear();
           }
         };
         if (this.localTerminalContinuation.hasCommitted()) {
           await this.localTerminalContinuation.resume(flowKey, terminalOutcome);
           finishCommittedHandoff();
           return;
        }
         localTerminal.beginTerminalPreparation(terminalOutcome);
        const capturedTypes = terminalOutcome === "victory" ? battle.capturedShortTypes() : [];
        const activeRun = this.requireRun();
        const resolution = await activeRun.settleEncounterTerminal(
          request.encounter,
          terminalFlow,
          terminalOutcome,
          terminalRoster(),
          capturedTypes,
          (snapshot) => localTerminal.persist(terminalDungeonCheckpointOverride(terminalOutcome, snapshot)),
           (preparation) => {
            stageDungeonBattleReward(terminalOutcome, request.encounter, preparation, localTerminal);
            preparation.setCaptureSerial(localTerminal.captureSerial);
            localTerminal.acceptBeforePersist(preparation.registerRollback);
          },
        );
        localTerminal.commit();
        this.pendingBattleRewardKeys.clear();
        if (terminalOutcome !== "defeat") {
          for (const [treasureId, rewardKey] of Object.entries(
            localTerminal.pendingBattleRewardSnapshot() ?? {},
          )) {
            this.pendingBattleRewardKeys.set(treasureId, rewardKey);
          }
        }
         if (terminalOutcome === "defeat") {
           const resume = async (): Promise<void> => {
             await localTerminal.presentCommittedQuestEvents();
             await this.host.onDefeat({ terminalStateCommitted: true });
           };
           this.localTerminalContinuation.commit(flowKey, terminalOutcome, resume);
           await this.localTerminalContinuation.resume(flowKey, terminalOutcome);
           finishCommittedHandoff();
           return;
        }
        let entryActions = resolution.entryActions;
        const treasureAction = entryActions.find((action) => action.kind === "treasure");
         const resume = async (): Promise<void> => {
           await localTerminal.presentCommittedQuestEvents();
           await this.startDungeonScene({
             kind: "battleReturn",
              actions: terminalOutcome === "retreat" ? null : entryActions,
           });
         };
         this.localTerminalContinuation.commit(flowKey, terminalOutcome, resume);
         await this.localTerminalContinuation.resume(flowKey, terminalOutcome);
         finishCommittedHandoff();
      },
    });
    battle.setSceneVisible(false);
    await this.host.scenes.replace(battle, async ({ outgoing, activate, retireOutgoing }) => {
      // On a Save Me restart the outgoing scene is the battle that was just lost, not the dungeon.
      if (node !== undefined && outgoing !== node) {
        throw new Error("Dungeon battle transition lost its outgoing dungeon scene");
      }





      const shade = entryShade ?? new Graphics().rect(
        0, 0, this.host.stage.app.screen.width, this.host.stage.app.screen.height,
      ).fill(0xffffff);
      shade.label = "dungeonBattleTransitionShade";
      if (entryShade === undefined) {
        shade.alpha = 0;
        this.host.stage.root.addChild(shade);
      }
      const runBattle = battle.start(authorityRng ?? this.host.nextBattleSeed());
      await Promise.all([
        entryCover ?? tween(this.host.stage.app.ticker, 250, (t) => { shade.alpha = t; }),
        Promise.race([
          ready,
          runBattle.then(() => { throw new Error("Dungeon BattleNode ended before transition-ready"); }),
        ]),
      ]);
      retireOutgoing();
      activate();
      await tween(this.host.stage.app.ticker, 250, (t) => { shade.alpha = 1 - t; });
      shade.destroy();
      battle.notifyEnterTransitionDidFinish();
      void runBattle.catch((error: unknown) => {
        if (isCommandReconciliation(error)) return;
        console.error("Dungeon-owned BattleNode failed", error);
        queueMicrotask(() => { throw error; });
      });
    });
    } finally {
      if (entryShade !== undefined && !entryShade.destroyed) entryShade.destroy();
    }
  }

  private async preloadEncounter(config: EncounterConfig): Promise<void> {
    const roster = [...config.playerTeam, ...config.enemyTeam].map((member) => member.shortType);
    const plan = computePreloadPlan(this.host.game.gd, this.host.game.anims, this.host.game.meleeAttacks, roster);
    await Promise.all([
      ...plan.atlases.map((atlas) => this.host.game.assets.atlas(atlas)),
      ...plan.particles.map((particle) => this.host.game.assets.particle(particle)),
      ...plan.sfx.map((sfx) => this.host.audio.hasSfx(sfx)
        ? Promise.resolve()
        : this.host.audio.preloadSfx(sfx, this.host.game.assets.audioUrl(sfx))),
      ...[...config.playerTeam, ...config.enemyTeam]
        .map((member) => battleSpriteKey(member))
        .map((key) => this.host.game.assets.sprite(key)),
      this.host.game.assets.sprite(config.backgroundKey),
    ]);
  }

  private withChatEvents(
    config: EncounterConfig,
    source: DungeonEncounterRequest["encounter"],
  ): EncounterConfig {
    const chat = (event: typeof source.startEvent, path: string) => {
      if (event === undefined) return undefined;
      if (event.className !== "ChatGameFlowEvent") return undefined;
      const keys = Object.keys(event.data);
      if (keys.length !== 1 || keys[0] !== "chatKey" || typeof event.data["chatKey"] !== "string") {
        throw new Error(`${path} ChatGameFlowEvent must contain exactly one string chatKey`);
      }
      return loadChatDefinition(this.host.content.resources, event.data["chatKey"]);
    };
    const startChat = chat(source.startEvent, `Dungeon encounter ${source.id}.startEvent`);
    const winChat = chat(source.winEvent, `Dungeon encounter ${source.id}.winEvent`);
    return {
      ...config,
      ...(startChat === undefined ? {} : { startChat }),
      ...(winChat === undefined ? {} : { winChat }),
    };
  }

  private awardLoot(loot: readonly DungeonLoot[]): readonly AppliedPlayerReward[] {
    return applyPlayerRewards(this.host.player().profile, loot);
  }

  private async presentDungeonEggs(
    node: DungeonNode,
    eggs: readonly Extract<DungeonLoot, { kind: "egg" | "monsterEgg" | "repeatEgg" }>[],
  ): Promise<void> {
    for (const egg of eggs) {
      if (this.activeEggHatch !== undefined) {
        throw new Error("Dungeon: an egg hatch flow is already active");
      }


      const authority = this.host.authority;
      const pending = authority?.egg.pendingEgg();
      if (authority !== undefined && pending === undefined) {
        throw new Error("official dungeon Egg loot left no pending hatch continuation");
      }
      let flow: EggHatchFlow | undefined;
      flow = await EggHatchFlow.show({
        parent: node.notificationParent,
        owner: node.notificationOwner,
        game: this.host.game,
        audio: this.host.audio,
        ticker: this.host.stage.app.ticker,
        player: this.host.player(),
        ...(authority === undefined
          ? { rng: this.host.fidelityRng ?? mulberry32(this.host.nextRunSeed()) }
          : { session: createOfficialEggHatchSession(authority.egg) }),
        ...(authority !== undefined || this.host.fidelityFoundationOrder === undefined
          ? {}
          : { foundationDictionaryOrder: this.host.fidelityFoundationOrder }),
        kind: pending?.kind ?? (egg.kind === "monsterEgg" ? "gold" : "silver"),
        ...(egg.kind === "repeatEgg" ? { repeatPicks: egg.numRepeats } : {}),
        nextMonsterInstanceId: (shortType) =>
          `dungeon-egg-${++this.eggMonsterSequence}-${shortType}`,
        onStateChanged: this.host.checkpoint,
        openGoldStore: () => this.host.openGoldStore(
          node.notificationParent,
          node.notificationOwner,
          this.host.player(),
          this.host.checkpoint,
        ),
        onClose: () => {
          if (this.activeEggHatch === flow) this.activeEggHatch = undefined;
        },
      });
      if (node.lifecycleSignal.aborted) {
        flow.dispose();
        return;
      }
      this.activeEggHatch = flow;
      await flow.finished;
    }
  }

  private async presentPendingOfficialEgg(node: DungeonNode): Promise<void> {
    const authority = this.host.authority;
    if (authority === undefined) return;
    const reward = officialPendingDungeonEggReward(authority);
    if (reward !== undefined) await this.presentDungeonEggs(node, [reward]);
  }

  private async prepareEncounter(request: DungeonEncounterRequest): Promise<void> {
    const player = this.host.player();
    if (player.party === undefined) throw new Error("Dungeon battle requires a world-trip party");
    const built = buildDungeonBattle(
      request.definition,
      request.encounter,
      player.party.projectAliveBattingPrefix(),
      { authority: this.host.authority === undefined ? "local" : "official" },
    );
    await this.preloadEncounter(this.withChatEvents(built.encounter, request.encounter));
  }

  private playDungeonMusic(): void {
    this.host.audio.requestMusic("Dungeon", 2, true, (count, shouldLoop) => {
      const index = 1 + (this.host.fidelityRng?.intBelow(count) ?? Math.floor(Math.random() * count));
      const assetName = `Dungeon${index}.mp3`;
      this.host.audio.playMusic(this.host.game.assets.audioUrl(assetName), { loop: shouldLoop, assetName });
    });
  }

  private async ensureDungeonSfx(): Promise<void> {
    if (this.host.audio.hasSfx("Stairs_EnterDungeon")) return;
    await this.host.audio.preloadSfx(
      "Stairs_EnterDungeon",
      this.host.game.assets.audioUrl("Stairs_EnterDungeon.m4a"),
    );
  }

  private recordDiagnostic(
    message: string,
    detail?: Readonly<Record<string, unknown>>,
  ): void {
    const code = typeof detail?.code === "string" ? detail.code : message;
    this.diagnostics.push({ code, message, ...(detail === undefined ? {} : { detail }) });
    this.host.onDiagnostic?.(message, detail);
  }












  private recordInfiniteDungeonFloor(floor: number): InfiniteDungeonFloorEntry {
    const profile = this.host.player().profile;
    const authority = this.host.authority;
    if (authority !== undefined) {
      const pending = authority.takeInfiniteFloorEntry?.(floor);
      return infiniteDungeonFloorEntry(
        pending?.previousHighest ?? profile.infiniteDungeonHighestLevel,
        floor,
      );
    }
    const entry = profile.recordInfiniteDungeonFloor(floor);
    if (entry.updated) this.host.checkpoint();
    return entry;
  }

}
