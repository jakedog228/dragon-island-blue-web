import { setOwnedTexture } from "@dib/renderer";
import {
  AnimatedSprite,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type Text,
} from "pixi.js";
import {
  CONTENT_SCALE_FACTOR,
  LifecycleScope,
  makeTtfLabel,
  minimumHitRectLocal,
  OUTLINE_FADE_ALPHA,
  OUTLINE_FADE_BORDER_PT,
  pointSprite,
  type FixedStage,
} from "@dib/renderer";
import {
  parseDungeonTreasureData,
  sourceTutorialTopic,
  type ChatDefinition,
  type LicenseDef,
  type QuestDefinition,
  type TownBuildingDefinition,
  type TownEnterChatDefinition,
  type TownPortalDestination,
  type WorldData,
  type WorldPointOfInterest,
} from "@dib/gamedata/browser";
import type {
  GuildQuestEvent,
  GuildQuestRuntime,
  PlayerReward,
  Rng,
  WorldArrivalResult,
  WorldPoiState,
  WorldTrip,
  WorldTripParty,
  WorldTripSharedState,
} from "@dib/engine";
import {
  advanceWorldDay,
  generateQuestRewards,
  generateTournamentPrize,
  mulberry32,
  sourceConditionsAreMet,
  type SourceConditionContext,
} from "@dib/engine";
import type { GameCommandV1 } from "@dib/game-protocol";
import type { InstalledCommandResult } from "../authority/gameAuthorityClient.js";
import type { AccountGateway } from "../authority/accountGateway.js";
import type { LoadedGame } from "../loadGame.js";
import type { AudioPlayer } from "../audio.js";
import type { KeyboardShortcut, KeyboardShortcutRouter } from "../keyboardShortcuts.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import {
  easeExponentialInOut,
  easeExponentialOut,
  tween,
  tweenWithResult,
} from "../tween.js";
import { localizedRenderableName, localizedString } from "../localization.js";
import {
  runSourceBlackSceneFade,
  type SourceBlackSceneFadeState,
} from "../sourceSceneFade.js";
import {
  WORLD_HERO_SCALE,
  WORLD_WALK_FRAME_MS,
  WORLD_RETURN_FADE_MS,
  WORLD_TELEPORT_FADE_IN_MS,
  WORLD_TELEPORT_FADE_OUT_MS,
  WORLD_ADJACENT_MOVE_MS,
  WORLD_CARDINAL_SLIDE_MS,
  WORLD_IPAD_BORDER_TEXTURE_RECT_PX,
  WORLD_STATE_SPRITE_SCALE,
  hasWorldMapIndent,
  worldMapSizePt,
  worldMapSpriteSizePt,
  worldMapPositionToPixi,
  worldBattleZoomTransform,
  worldMapTextureRect,
  worldPoiPointToPixi,
  worldPoiPointToScenePixi,
  worldSettledDirection,
  worldWalkDirection,
  worldWalkFrameName,
  type WorldWalkDirection,
} from "./worldDisplayMath.js";
import {
  worldArrivalContinuation,
  type WorldPoiRoutingPolicy,
  type WorldSceneRequest,
} from "./worldPoiRouting.js";
import {
  WORLD_HERO_XP_AUTO_CLOSE_MS,
  WORLD_HERO_XP_TOGGLE_MS,
  heroXpPercent,
  type NamePlatePlacement,
  type WorldNamePlateTrigger,
  worldHeroXpBarPosition,
  worldHeroXpCollapsedX,
  worldHeroXpFontSize,
  worldHeroXpLabelGap,
  worldMenuPosition,
  worldNamePlatePlacement,
} from "./worldChromeMath.js";
import { WorldMenu } from "./worldMenu.js";
import { EggHatchFlow } from "./eggHatchFlow.js";
import {
  createOfficialEggHatchSession,
  type OfficialEggHatchAuthority,
} from "./eggHatchSession.js";
import type { WorldMenuAction } from "./worldMenuMath.js";
import { BigMapNode } from "./bigMapNode.js";
import {
  minimumWorldHitRectangle,
  townLocalMinimumTouchSize,
  townPoiAggregateHitRegions,
  type WorldHitRectangle,
  worldMinimumTouchSize,
} from "./worldHitTest.js";
import { showOptionsPanel, type OptionsPanelHandle } from "./optionsPanel.js";
import {
  showHighscoresPanel,
  type HighscoresPanelHandle,
  type HighscoresSource,
} from "./highscoresScreen.js";
import { showMainMenuConfirmation } from "./mainMenuConfirmation.js";
import {
  hasCompleteSourceTutorialSurface,
  hasSourceTutorialTopicSurface,
  TutorialMenu,
} from "./tutorialMenu.js";
import { PartyEditorFlow } from "./partyEditorFlow.js";
import { partyManagementShowsFirstUseTutorial } from "./partyEditorMath.js";
import { MonsterpediaFlow } from "./monsterpediaFlow.js";
import { GuildQuestFlow, guildQuestListAvailable } from "./guildQuestFlow.js";
import {
  CollectionFlow,
  PixiCollectionFlowPresentation,
  type WorldCollectionAdapter,
} from "./collectionFlow.js";
import {
  showGuildQuestChat,
  type GuildQuestChatHandle,
} from "./guildQuestChat.js";
import { townBuildingIsRevealed, townBuildingRevealChanges } from "./guildQuestConditions.js";
import { nextTownEnterChat, selectTownEnterChat } from "./townEnterChat.js";
import { dispatchTransition } from "./transitionDispatch.js";
import { projectWorldPoiState } from "./worldPoiProjection.js";
import type { PlayerRuntimeState } from "../player/playerRuntimeState.js";
import type { InventoryItemId, PlayerStatName } from "@dib/player-domain";
import {
  purchaseStoreStock,
  type StorePurchaseResult,
  type StoreStock,
} from "@dib/player-domain";
import {
  showInventoryManagement,
  type InventoryManagementHandle,
} from "../player/inventoryManagementFlow.js";
import { CharacterManagementFlow } from "../player/characterManagementFlow.js";
import { StoreFlow } from "../player/storeFlow.js";
import { ArenaFlow } from "../player/arenaFlow.js";
import { TournamentFlow } from "../player/tournamentFlow.js";
import { TownWarpFlow } from "./townWarpFlow.js";
import { BlackMarketDemoFlow } from "./blackMarketDemoFlow.js";
import { resolveBlackMarketCloseSpriteKey } from "./blackMarketCloseSprite.js";
import { showBlackMarketNotReadyPopup } from "./blackMarketNotReadyPopup.js";
import type {
  DemoImageLoader,
  ExternalPageOpener,
} from "./blackMarketDemoModel.js";
import { applyPlayerRewards } from "../player/rewards.js";
import {
  showCommittedStoreLootManagement,
  showDungeonLootManagement,
} from "../dungeon/dungeonLootPageProvider.js";
import { PopupHost } from "../ui/popup.js";
import { SourceFlashingSprite } from "../ui/flashingSprite.js";
import {
  showPlotTutorial,
  type PlotTutorialDebugState,
  type PlotTutorialHandle,
} from "../ui/plotGameFlow.js";
import {
  buildLocalizedMonsterHatchMessageContent,
  buildMonsterHatchMessageBlock,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  REPLAY_BATTLE_TUTORIAL_FLAG,
  shouldShowReplayBattleTutorial,
  showReplayBattleTutorial,
} from "./replayBattleTutorial.js";
import {
  TOWN_ENTRY_REVEAL_DELAY_MS,
  TOWN_ENTRY_ZOOM_MS,
  TOWN_EXIT_SPRITE_SCALE,
  TOWN_EXIT_ZOOM_MS,
  TOWN_FIELD_FLAGS_FADE_OUT_MS,
  TOWN_FIELD_MENU_FADE_OUT_MS,
  TOWN_FIELD_RESTORE_FADE_MS,
  TOWN_MENU_FADE_MS,
  townBuildingEnabled,
  townBuildingIconOffsetY,
  townBuildingLabelOffsetY,
  townCounterScale,
  townHouseSpriteScale,
  townLabelFontSize,
  townMenuLocalPosition,
  townRelativePointToPixi,
  townWorldZoomTarget,
} from "./townDisplayMath.js";
import {
  WorldNotificationHost,
  type TownDayNotificationState,
} from "./worldNotificationHost.js";

export interface WorldEncounterRequest {
  readonly arrival: Extract<WorldArrivalResult, { kind: "encounter" }>;
  readonly poi: WorldPointOfInterest;
}

export interface WorldExitRequest {
  readonly poi: WorldPointOfInterest;
  readonly targetWorld: string;
  readonly targetPoi: string;
}

export interface ArenaChallengeRequest {
  readonly license: LicenseDef;
  readonly townName: string;
  readonly questGiver?: string;
}

export interface TournamentBattleRequest {
  readonly tournament: import("@dib/gamedata/browser").TournamentDef;
  readonly round: number;
  readonly townName: string;
  readonly questGiver?: string;
}

export interface WorldNodeDeps {
  stage: FixedStage;
  game: LoadedGame;
  audio: AudioPlayer;
  keyboard: KeyboardShortcutRouter;
  world: WorldData;
  trip: WorldTrip;
  party: WorldTripParty;
  /** Live player aggregate used by Monsterpedia registration/combine commands. */
  playerRuntime: PlayerRuntimeState;
  guildQuests?: GuildQuestRuntime;
  collection?: WorldCollectionAdapter;
  guildTavernBackgroundSpriteKey?: string;
  questRewardRng: Rng;
  /** Development-only process-global source RNG. Native music selection shares arc4random with
   * mechanics even when the category has only one track; Official presentation leaves it absent. */
  sourceRng?: Rng;
  /** Fidelity-Lab-only normalization matching the emulator's NSDictionary traversal. */
  fidelityFoundationOrder?: "lexicographic";
  /** Shared refresh registries, exposed only through render_game_to_text for lifecycle proof. */
  refreshState: WorldTripSharedState;
  heroProgress: {
    readonly level: number;
    readonly totalHighestLevels: number;
  };
  visitedWorlds: ReadonlySet<string>;
  initiallyHidden?: boolean;
  /** Inter-world replacements keep the source-hidden marker absent until their transition ends. */
  deferMarkerReveal?: boolean;
  initialSlideDelta?: { readonly x: number; readonly y: number };
  poiRouting: WorldPoiRoutingPolicy;
  onEncounter: (request: WorldEncounterRequest) => void | Promise<void>;
  onArenaChallenge: (request: ArenaChallengeRequest) => void | Promise<void>;
  onTournamentBattle: (request: TournamentBattleRequest) => void | Promise<void>;
  onPvp?: import("../player/arenaFlow.js").ArenaFlowOptions["onPvp"];
  onTournamentPrize: (
    tournament: import("@dib/gamedata/browser").TournamentDef,
  ) => void | Promise<void>;
  readonly tournamentEnabled: boolean;
  tournamentRoundPortraitFile: (
    tournament: import("@dib/gamedata/browser").TournamentDef,
    round: number,
  ) => string | undefined;
  onTournamentFinished: (parent: Container) => void | Promise<void>;
  onWorldExit: (request: WorldExitRequest) => void | Promise<void>;
  onSceneRequest: (request: WorldSceneRequest) => void | Promise<void>;
  /** `Chats.plist` lookup with the source nil-record fallback (`loadChatDefinition`). */
  chatDefinition: (name: string) => ChatDefinition;
  /** Source `GotoTownMenuItem.activate:` direct return to `UserSavedData.lastTown`. */
  onTownPortal?: () => void | Promise<void>;









  onTournamentExit?: () => void | Promise<void>;
  /** Source in-town `TownWarpMenuItem` picker and explicit destination route. */
  townWarp?: {
    readonly backgroundSpriteKey: string;
    readonly destinations: readonly TownPortalDestination[];
    readonly visitedTownNames: ReadonlySet<string>;
    readonly onTravel: (townName: string) => void | Promise<void>;
  };
  /** Source `BlackMarketMenuItem` service-readiness state (`![Deal isFetching] &&
   * [appDelegate newsFullyLoaded]`). Anything other than an explicit `true` reproduces the
   * source's not-ready dialog; see `blackMarketAvailability.ts` for the single configuration
   * point that supplies this. */
  blackMarketServiceReady?: boolean;
  /** App-owned presentation-only Black Market demo, reached only when
   * `blackMarketServiceReady` bypasses the source blocker. Absent when Menus.plist.BlackMarket is
   * not structurally available in the selected package. */
  blackMarketDemo?: {
    readonly backgroundSpriteKey: string;
    readonly imageLoader: DemoImageLoader<Texture>;
    readonly opener: ExternalPageOpener;
  };
  /** Confirmed `MainMenuMenuItem` route back to the title/save-slot shell. */
  onMainMenu: () => void | Promise<void>;
  /** Rebuilds renderer geometry and resumes this save after display/text settings change. */
  onPresentationChange: () => void | Promise<void>;
  /** Official online account settings edited by the Options popup; absent offline. */
  account?: AccountGateway;
  /**
   * Public most-XP board behind the source `Highscores` row. Present only in official online play:
   * archive play has no server to rank against, so the row stays inert exactly as before.
   */
  scoreboard?: HighscoresSource;
  /** `+[Player enteredTown:]` persistence boundary, reached after the one-second reveal gate. */
  onTownEntered: (townName: string) => void;
  /** Supplies the director-owned notification host to the app-level quest event coordinator. */
  onNotificationHostReady?: (host: WorldNotificationHost) => void;
  /** App-owned checkpoint hook after WorldTrip accepts a POI move and updates its caches. */
  onStateChanged: () => void;
  /** Offline autosave boundary for a claim whose items are still in modal presentation. */
  beginLocalRewardCheckpoint?: () => (() => void);
  /** Director-level category-3 Store mount for an unaffordable paid Egg repeat. */
  openGoldStore: (
    parent: Container,
    owner: object,
    player: PlayerRuntimeState,
    checkpointAfter: () => void,
  ) => Promise<{ readonly closed: Promise<void> }>;
  /**
   * Local-simulation guild quest events raised by town flows this node owns. Install only when no
   * Official authority is active — the command service reduces the same mutations server-side.
   */
  onQuestEvent?: (event: GuildQuestEvent) => void;
  /** Semantic mutation bridge used by official online play. Local presentation remains renderer-owned. */
  authority?: {
    /** v25 records dungeon chats and enforces the source zone-change condition gate. */
    readonly sourceStoryRules?: boolean;
    navigate(
      targetPoiId: string,
      onIntentAccepted: () => void,
    ): Promise<{
      readonly movement: "walk" | "teleport" | "same";
      readonly randomDraws: readonly number[];
      readonly committedAt?: string;
      /**
       * Applies the authority's post-command projection after the retained local trip has
       * replayed the accepted move. Applying it before `WorldTrip.navigate()` can change the
       * completion graph underneath the trip while its current POI is still the pre-command POI.
       */
      readonly synchronizeProjection?: () => void;
    }>;
    leaveTown(): Promise<{ readonly committedAt?: string }>;
    claimTutorialFlag(flag: string): Promise<void>;
    claimDialog(dialogId: string): Promise<void>;
    submitParty(
      command: Extract<GameCommandV1, { type: `party.${string}` }>,
    ): Promise<InstalledCommandResult>;
    submitQuest(
      command: Extract<
        GameCommandV1,
        { type: "quest.accept" | "quest.claim" | "quest.dropAll" }
      >,
    ): Promise<InstalledCommandResult>;
    submitPlayer(
      command: Extract<
        GameCommandV1,
        {
          type:
            | "player.dropInventoryItem"
            | "player.equipGem"
            | "player.unequipGem"
            | "player.incrementSkill"
            | "player.decrementSkill";
        }
      >,
    ): Promise<InstalledCommandResult>;
    submitStore(
      command: Extract<GameCommandV1, { type: "store.purchase" }>,
    ): Promise<InstalledCommandResult>;
    /**
     * Drives the authoritative v12 Egg continuation. Every online Egg — Store, quest loot,
     * tournament, Collection, dungeon — runs through this seam, because the continuation the
     * granting command leaves pending is the only command the slot will admit until it is
     * finished (`assertOfficialGameV12CommandAdmitted`).
     */
    egg: OfficialEggHatchAuthority;
  };
}

export interface RetainedWorldSession {
  readonly world: WorldData;
  readonly trip: WorldTrip;
  readonly party: WorldTripParty;
  readonly playerRuntime: PlayerRuntimeState;
  readonly guildQuests?: GuildQuestRuntime;
  readonly questRewardRng: Rng;
  readonly fidelityFoundationOrder?: "lexicographic";
  readonly refreshState: WorldTripSharedState;
  readonly heroProgress: WorldNodeDeps["heroProgress"];
}

interface PoiDisplay {
  readonly poi: WorldPointOfInterest;
  readonly root: Container;
  readonly base: Sprite;
  readonly stateSprite: Sprite;
  readonly town?: TownPoiDisplay;
  renderedState: Exclude<WorldPoiState, 3> | null;
  renderedTextureKey: string | null;
}

interface TownBuildingDisplay {
  readonly definition: TownBuildingDefinition;
  readonly root: Container;
  readonly house: Sprite;
  /** `setupForRenderable:context:`'s authored-`conditions` verdict for this house. */
  readonly revealed: boolean;
  readonly menuRoot?: Container;
  readonly labelRoot?: Container;
  readonly flashTarget?: Sprite;
}

interface TownPoiDisplay {
  /** The POI node every house and service layer is attached to. */
  readonly parent: Container;




  readonly buildings: TownBuildingDisplay[];
  readonly exit: Container;
  readonly exitFlashTarget: Sprite;
  readonly menuButton: Sprite;
}

type WorldMovementResult = { readonly kind: "completed" | "cancelled" };
let worldNodeDebugSerial = 0;

/** Pixi counterpart of source `WorldNode`: shipped map, POINodes, state flags, and the retained
 * hero marker, all authored in Cocos point space under the same x2 stage mount as battle. */
export class WorldNode {
  readonly sceneKind = "world" as const;

  /** Point-scaled parent shared by ordinary and restored reward presentations. */
  get notificationParent(): Container { return this.pointRoot; }
  private readonly debugSceneInstanceId = ++worldNodeDebugSerial;
  private readonly lifecycle = new LifecycleScope();
  private readonly pointRoot = new Container();
  private readonly scene = new Container();
  private readonly clip: Graphics;
  private readonly mapLayer = new Container();
  private readonly chrome = new Container();
  private readonly transitionShade = new Graphics();
  private readonly poiDisplays = new Map<string, PoiDisplay>();
  private stateTextures!: Record<Exclude<WorldPoiState, 3>, Texture>;
  private heroWalkTextures!: Readonly<Record<string, Texture>>;
  private readonly byName: ReadonlyMap<string, WorldPointOfInterest>;
  private marker!: AnimatedSprite;
  private menuSprite!: Sprite;
  private heroXpRoot!: Container;
  private heroXpFrameWidth = 0;
  private heroXpFillMask!: Graphics;
  private heroXpFillRect = { x: 0, y: 0, w: 0, h: 0 };
  private heroXpLevelLabel!: Text;
  private heroXpExpanded = true;
  private heroXpInitialClosePending = true;
  private heroXpTransition:
    | { readonly from: number; readonly to: number; elapsedMs: number; readonly expanding: boolean }
    | undefined;
  private readonly worldNamePlateText: string;
  private notifications!: WorldNotificationHost;
  private movementAbort: AbortController | undefined;
  private markerRevealAbort: AbortController | undefined;
  private lastWalkDirection: WorldWalkDirection = "front";
  private transitionFailure:
    | { readonly route: string; readonly message: string }
    | undefined;
  private sourceSceneFade: SourceBlackSceneFadeState | undefined;
  private locked = false;
  private walking = false;
  private elapsedMs = 0;
  private activeMenu: WorldMenu | undefined;
  private activeBigMap: BigMapNode | undefined;
  private activePartyEditor: PartyEditorFlow | undefined;
  private activeMonsterpedia: MonsterpediaFlow | undefined;
  private activeCollection: CollectionFlow | undefined;
  private activeOptions: OptionsPanelHandle | undefined;
  private activeHighscores: HighscoresPanelHandle | undefined;
  private activeTutorialMenu: TutorialMenu | undefined;
  private activeGuildQuests: GuildQuestFlow | undefined;
  private activeEggHatch: EggHatchFlow | undefined;
  private activeInventory: InventoryManagementHandle | undefined;
  private activeCharacterManagement: CharacterManagementFlow | undefined;
  private activeStore: StoreFlow | undefined;
  private activeBlackMarketDemo: BlackMarketDemoFlow | undefined;
  private activeArena: ArenaFlow | undefined;
  private activeTournament: TournamentFlow | undefined;
  private activeTownWarp: TownWarpFlow | undefined;
  private activeTownEnterChat: GuildQuestChatHandle | undefined;
  private activeTownEnterChatName: string | undefined;
  private activePlotTutorial: PlotTutorialHandle | undefined;
  private plotTutorialState: PlotTutorialDebugState | undefined;
  private townFlash:
    | {
        readonly key: string | null;
        readonly target: "exit" | number;
        readonly overlay: SourceFlashingSprite;
      }
    | undefined;
  private townEnterChatOpening = false;
  // Narrow deterministic-harness-only debug-state ownership for the source Warp Gate disabled-chat
  // branch. Ordinary runtime does not expose this extra state: `TownWarpMenuItem activate:`
  // presents the message directly and does not retain a modal flow of its own.
  private activeTownWarpDisabledChat = false;
  private modalOpening = false;
  private keyboardActive = false;
  private mapHome = { x: 0, y: 0 };
  private menuHome = { x: 0, y: 0 };
  private activeTown: { readonly poi: WorldPointOfInterest; readonly display: TownPoiDisplay } | undefined;
  private townZoomAbort: AbortController | undefined;
  private townMenuAbort: AbortController | undefined;
  private fieldChromeAbort: AbortController | undefined;
  private combineSerial = 0;
  private questRewardSerial = 0;
  private drainingLegacyEggs = false;
  private authoritativeNowSeconds: number | undefined;
  private readonly tutorialClaims = new Map<string, Promise<"claimed" | "existing" | "failed">>();

  private constructor(private readonly deps: WorldNodeDeps) {
    const mapSize = worldMapSizePt(DISPLAY_MODE);
    this.clip = new Graphics().rect(0, 0, mapSize.w, mapSize.h).fill(0xffffff);
    this.pointRoot.visible = deps.initiallyHidden !== true;
    this.byName = new Map(deps.world.pointsOfInterest.map((poi) => [poi.name, poi]));
    this.worldNamePlateText = localizedRenderableName(deps.game.strings, [deps.world.name]);
    if (!this.byName.has(deps.trip.currentPoiName)) {
      throw new Error(`WorldNode: current POI ${deps.trip.currentPoiName} is missing from ${deps.world.name}`);
    }
    if (deps.playerRuntime.party !== deps.party) {
      throw new Error("WorldNode: player runtime and world party must share one aggregate");
    }
    // The claim owner has to match the session's authority. An Official session reaching the
    // browser-local claim path would author state the server never committed; an offline session
    // reaching the Official path has no authority to submit through.
    if (deps.collection !== undefined) {
      const expected = deps.authority === undefined ? "local" : "official";
      if (deps.collection.mode !== expected) {
        throw new Error(
          `WorldNode: ${expected} session requires a ${expected} Collection adapter, ` +
            `not ${deps.collection.mode}`,
        );
      }
    }
    const collectionRoute = deps.world.pointsOfInterest.find(
      (poi) => deps.poiRouting.route(poi).kind === "collection",
    );
    if (collectionRoute !== undefined && deps.collection === undefined) {
      throw new Error(
        `WorldNode: Collection route ${collectionRoute.name} requires a live Collection adapter`,
      );
    }
    if (
      deps.townWarp === undefined &&
      deps.world.pointsOfInterest.some((poi) => poi.town?.buildings.some(
        ({ className }) => className === "TownWarpMenuItem",
      ))
    ) {
      throw new Error(
        `WorldNode: ${deps.world.name} contains TownWarpMenuItem but its TownWarp menu ` +
          "resources/registry are unavailable",
      );
    }
    deps.keyboard.register(this.handleKeyboardShortcut, this.lifecycle.signal);
  }

  static async create(deps: WorldNodeDeps): Promise<WorldNode> {
    const node = new WorldNode(deps);
    await node.build();
    return node;
  }

  private async build(): Promise<void> {
    const { stage, game, world } = this.deps;
    const mapSize = worldMapSizePt(DISPLAY_MODE);
    const hasIndent = hasWorldMapIndent(world.map.indent);
    const hasTown = world.pointsOfInterest.some((poi) => poi.town !== undefined);
    this.pointRoot.scale.set(CONTENT_SCALE_FACTOR);
    this.pointRoot.sortableChildren = true;
    this.pointRoot.addChild(this.clip, this.scene);
    this.scene.mask = this.clip;
    const mapPosition = worldMapPositionToPixi(world.map.indent, DISPLAY_MODE);
    this.mapHome = mapPosition;
    this.mapLayer.position.set(mapPosition.x, mapPosition.y);
    if (this.deps.initialSlideDelta) {
      this.scene.position.set(this.deps.initialSlideDelta.x, this.deps.initialSlideDelta.y);
      this.locked = true;
    }
    this.transitionShade.rect(0, 0, mapSize.w, mapSize.h).fill(0x000000);
    this.transitionShade.alpha = 0;
    this.transitionShade.visible = false;
    this.pointRoot.addChild(this.transitionShade);
    stage.root.addChild(this.pointRoot);

    const [mapFull, borderFull] = await Promise.all([
      game.assets.sprite(stem(world.map.spriteFile)),
      DISPLAY_MODE === "ipad" && !hasIndent ? game.assets.sprite("ipadBorder") : undefined,
    ]);
    if (borderFull) {
      const borderRect = WORLD_IPAD_BORDER_TEXTURE_RECT_PX;
      if (borderFull.width < borderRect.w || borderFull.height < borderRect.h) {
        throw new Error(
          `ipadBorder.png is ${borderFull.width}x${borderFull.height}px; ` +
            `the source crop requires ${borderRect.w}x${borderRect.h}`,
        );
      }
      const borderTexture = new Texture({
        source: borderFull.source,
        frame: new Rectangle(borderRect.x, borderRect.y, borderRect.w, borderRect.h),
      });
      const border = new Sprite(borderTexture);
      setOwnedTexture(border, borderTexture);
      border.anchor.set(0, 0);
      border.width = mapSize.w;
      border.height = mapSize.h;
      this.scene.addChild(border);
    }
    this.scene.addChild(this.mapLayer);
    const crop = worldMapTextureRect(DISPLAY_MODE, hasIndent);
    if (mapFull.width < crop.w || mapFull.height < crop.h) {
      throw new Error(
        `world map ${world.map.spriteFile} is ${mapFull.width}x${mapFull.height}px; ` +
          `the source crop requires ${crop.w}x${crop.h}`,
      );
    }
    const mapTexture = new Texture({
      source: mapFull.source,
      frame: new Rectangle(crop.x, crop.y, crop.w, crop.h),
    });
    const map = new Sprite(mapTexture);
    setOwnedTexture(map, mapTexture);
    map.anchor.set(0, 0);
    const mapSpriteSize = worldMapSpriteSizePt(DISPLAY_MODE, hasIndent);
    map.width = mapSpriteSize.w;
    map.height = mapSpriteSize.h;
    this.mapLayer.addChild(map);

    const [green, red, blue, arrow, heroAtlas, menuTexture, namePlateTexture, sunriseTexture, notificationIconTexture, generalAtlas] = await Promise.all([
      game.assets.sprite("greenFlag-hd"),
      game.assets.sprite("redFlag-hd"),
      game.assets.sprite("blueFlag-hd"),
      game.assets.sprite("walkArrow"),
      game.assets.atlas("HeroWalkFrames-hd"),
      game.assets.sprite("menuButton-hd"),
      game.assets.sprite("namePlate-hd"),
      hasTown ? game.assets.sprite("sunrise-hd") : Texture.EMPTY,
      this.deps.guildQuests === undefined ? Texture.EMPTY : game.assets.sprite("Icon@2x"),
      game.assets.atlas("General-hd"),
    ]);
    this.notifications = WorldNotificationHost.for(stage.root, stage.app.ticker, {
      namePlate: namePlateTexture,
      sunrise: sunriseTexture,
      notificationIcon: notificationIconTexture,
    });
    this.notifications.registerAutomaticPresentationRoot(this.pointRoot);
    this.deps.onNotificationHostReady?.(this.notifications);
    this.stateTextures = {
      0: green,
      1: red,
      2: blue,
      4: arrow,
    };
    this.heroWalkTextures = heroAtlas.textures;

    for (const poi of world.pointsOfInterest) {
      const root = new Container();
      const position = worldPoiPointToPixi(poi.position, DISPLAY_MODE, hasIndent);
      root.position.set(position.x, position.y);
      const baseKey = resolvedSpriteKey(game, poi.renderer.spriteFile);
      const base = new Sprite(await game.assets.sprite(baseKey));
      base.anchor.set(0.5);
      base.zIndex = -20_000;
      if (baseKey.endsWith("-hd") || baseKey.endsWith("-ipadhd")) base.scale.set(1 / CONTENT_SCALE_FACTOR);
      root.addChild(base);

      const stateSprite = new Sprite(Texture.EMPTY);
      stateSprite.anchor.set(0.5);
      const flagOffset = poi.renderer.flagOffset ?? { x: 0, y: 0 };


      stateSprite.position.set(flagOffset.x, -flagOffset.y);
      stateSprite.eventMode = "none";
      stateSprite.zIndex = 20_000;
      root.addChild(stateSprite);
      const town = poi.town === undefined ? undefined : await this.buildTownPoi(root, poi);
      this.mapLayer.addChild(root);
      this.poiDisplays.set(poi.name, {
        poi,
        root,
        base,
        stateSprite,
        renderedState: null,
        renderedTextureKey: null,
        ...(town ? { town } : {}),
      });
    }
    this.scene.eventMode = "static";
    this.scene.cursor = "pointer";
    this.scene.hitArea = new Rectangle(0, 0, mapSize.w, mapSize.h);
    this.scene.on("pointertap", this.handleWorldTap);

    const initialDirection = this.lastWalkDirection;
    this.marker = new AnimatedSprite(
      Array.from({ length: 8 }, (_, index) => ({
        texture: requiredFrame(heroAtlas.textures, worldWalkFrameName(initialDirection, index + 1)),
        time: WORLD_WALK_FRAME_MS,
      })),
    );
    this.marker.anchor.set(0.5);
    this.marker.scale.set(
      WORLD_HERO_SCALE.x / CONTENT_SCALE_FACTOR,
      WORLD_HERO_SCALE.y / CONTENT_SCALE_FACTOR,
    );
    this.marker.loop = true;
    this.marker.visible = false;
    this.marker.zIndex = 2;
    this.mapLayer.sortableChildren = true;
    this.mapLayer.addChild(this.marker);

    this.buildChrome(
      menuTexture,
      requiredFrame(generalAtlas.textures, "heroXpFrame.png"),
      requiredFrame(generalAtlas.textures, "heroXpBar.png"),
      hasIndent,
    );

    this.refreshPoiStates();
    const current = this.requirePoi(this.deps.trip.currentPoiName);
    const currentPosition = worldPoiPointToPixi(current.position, DISPLAY_MODE, hasIndent);
    this.marker.position.set(currentPosition.x, currentPosition.y);
    this.marker.alpha = 0;
    if (this.deps.deferMarkerReveal !== true) this.revealMarkerAfterTransition();

    stage.app.ticker.add(this.updateFn);
    this.lifecycle.add(() => stage.app.ticker.remove(this.updateFn));
    this.lifecycle.add(() => {
      this.movementAbort?.abort();
      this.movementAbort = undefined;
      this.markerRevealAbort?.abort();
      this.markerRevealAbort = undefined;
      this.walking = false;
      if (this.pointRoot.parent) this.pointRoot.parent.removeChild(this.pointRoot);
      if (!this.pointRoot.destroyed) this.pointRoot.destroy({ children: true });
    });
  }

  /** Source's 0.5-second fade transition used when an encounter returns to the same world/POI. */
  async fadeIn(): Promise<void> {
    this.pointRoot.alpha = 0;
    await tween(this.deps.stage.app.ticker, WORLD_RETURN_FADE_MS, (t) => { this.pointRoot.alpha = t; });
  }

  /** Block field input while a return transition is still owned by SceneCoordinator. */
  lockForReturnTransition(): void {
    if (!this.isAlive()) throw new Error("WorldNode: cannot lock a destroyed returning world");
    this.locked = true;
  }

  /** Restore the exact retained field before the source 0.5-second battle-return fade.
   * ZoomInAtPointTransition temporarily owns the world transform and hides its scene at the
   * opaque midpoint; Cocos restores that outgoing scene when it becomes the return destination.
   * Keep input locked until SceneCoordinator has completed the entire replacement. */
  async prepareBattleReturn(): Promise<void> {
    if (!this.isAlive()) throw new Error("WorldNode: cannot return to a destroyed retained world");
    this.lockForReturnTransition();
    this.cancelMovement();
    await this.regateTownBuildingServices();
    if (!this.isAlive()) throw new Error("WorldNode: destroyed while re-gating its town services");
    this.pointRoot.alpha = 1;
    this.scene.visible = true;
    this.scene.pivot.set(0, 0);
    this.scene.position.set(0, 0);
    this.scene.scale.set(1, 1);
    this.transitionShade.alpha = 0;
    this.transitionShade.visible = false;
    this.transitionFailure = undefined;
    this.refreshPoiStates();
    this.refreshHeroXp();
    this.settleMarkerAt(this.requirePoi(this.deps.trip.currentPoiName), true);
  }

  /**
   * Projection adoption replaces the complete player/world aggregate. A retained WorldNode keeps
   * its Pixi scene identity across combat, so it must explicitly follow that replacement before
   * field input resumes; otherwise navigation appends committed draws to the new RNG while the
   * node consumes the exhausted pre-combat trip tape.
   */
  rebindRetainedSession(session: RetainedWorldSession): void {
    if (!this.isAlive()) throw new Error("WorldNode: cannot rebind a destroyed retained world");
    if (session.world.name !== this.deps.world.name) {
      throw new Error(
        `WorldNode: retained world ${this.deps.world.name} cannot adopt ${session.world.name}`,
      );
    }
    if (session.playerRuntime.party !== session.party) {
      throw new Error("WorldNode: retained player runtime and party must share one aggregate");
    }
    if (!this.byName.has(session.trip.currentPoiName)) {
      throw new Error(
        `WorldNode: retained session references unknown POI ${session.trip.currentPoiName}`,
      );
    }
    this.deps.trip = session.trip;
    this.deps.party = session.party;
    this.deps.playerRuntime = session.playerRuntime;
    if (session.guildQuests === undefined) delete this.deps.guildQuests;
    else this.deps.guildQuests = session.guildQuests;
    this.deps.questRewardRng = session.questRewardRng;
    if (session.fidelityFoundationOrder === undefined) delete this.deps.fidelityFoundationOrder;
    else this.deps.fidelityFoundationOrder = session.fidelityFoundationOrder;
    this.deps.refreshState = session.refreshState;
    this.deps.heroProgress = session.heroProgress;
  }

  /** Release field input only after the coordinator's replacement promise has become idle. */
  finishReturnTransition(): void {
    if (this.isAlive()) this.locked = false;
  }






  revealMarkerAfterTransition(): void {
    if (!this.isAlive()) throw new Error("WorldNode: cannot reveal a destroyed world marker");
    this.markerRevealAbort?.abort();
    const abort = new AbortController();
    this.markerRevealAbort = abort;
    this.marker.visible = true;
    this.marker.alpha = 0;
    void tween(
      this.deps.stage.app.ticker,
      WORLD_TELEPORT_FADE_IN_MS,
      (t) => { this.marker.alpha = t; },
      undefined,
      abort.signal,
    ).then(() => {
      if (abort.signal.aborted || this.marker.destroyed) return;
      this.marker.alpha = 1;
      if (this.markerRevealAbort === abort) this.markerRevealAbort = undefined;
    });
  }

  /** Incoming half of `POINode.performVisitLogic`'s cardinal one-screen/one-second slide. */
  async playCardinalSlideIn(delta: { readonly x: number; readonly y: number }): Promise<void> {
    this.locked = true;
    this.scene.position.set(delta.x, delta.y);
    await tween(this.deps.stage.app.ticker, WORLD_CARDINAL_SLIDE_MS, (t) => {
      this.scene.position.set(delta.x * (1 - t), delta.y * (1 - t));
    });
    this.scene.position.set(0, 0);
    this.locked = false;
  }

  /** Outgoing half; caller destroys this node only after the concurrent tween completes. */
  async playCardinalSlideOut(delta: { readonly x: number; readonly y: number }): Promise<void> {
    this.locked = true;


    this.menuSprite.visible = false;
    const startX = this.scene.position.x;
    const startY = this.scene.position.y;
    await tween(this.deps.stage.app.ticker, WORLD_CARDINAL_SLIDE_MS, (t) => {
      this.scene.position.set(startX - delta.x * t, startY - delta.y * t);
    });
  }

  /** `ZoomInAtPointTransition(2s, scale=2, zoomPoint=POI world position)`. */
  async playEncounterZoom(poiName: string): Promise<void> {
    this.locked = true;
    const poi = this.requirePoi(poiName);
    const transform = worldBattleZoomTransform(poi.position, DISPLAY_MODE, this.deps.world.map.indent);
    this.scene.pivot.set(transform.pivot.x, transform.pivot.y);
    this.scene.position.set(transform.pivot.x, transform.pivot.y);
    this.transitionShade.visible = true;


    await tween(this.deps.stage.app.ticker, transform.zoomAndFadeInMs, (raw) => {
      const eased = easeExponentialOut(raw);
      this.scene.scale.set(1 + (transform.scale - 1) * eased);
      this.scene.position.set(
        transform.pivot.x + (transform.finalPosition.x - transform.pivot.x) * eased,
        transform.pivot.y + (transform.finalPosition.y - transform.pivot.y) * eased,
      );
      this.transitionShade.alpha = raw;
    });
  }

  /** Called after the incoming BattleNode is mounted behind the fully opaque transition layer. */
  async finishEncounterZoom(): Promise<void> {

    this.deps.stage.root.addChild(this.pointRoot);
    const transform = worldBattleZoomTransform(
      this.requirePoi(this.deps.trip.currentPoiName).position,
      DISPLAY_MODE,
      this.deps.world.map.indent,
    );
    await tween(this.deps.stage.app.ticker, transform.fadeOutMs, (t) => {
      this.transitionShade.alpha = 1 - t;
    });
  }

  /** Keep the opaque source transition layer above an incoming scene while it builds. */
  coverIncomingScene(): void {
    if (!this.transitionShade.visible || this.transitionShade.alpha < 1) {
      throw new Error("WorldNode: incoming scene may only be covered at the opaque zoom midpoint");
    }
    this.deps.stage.root.addChild(this.pointRoot);
    // At the source midpoint hideOutShowIn swaps scene visibility under the opaque layer. Leaving
    // this scene visible makes the fade-out reveal the old world instead of the incoming battle.
    this.scene.visible = false;
  }

  destroy(): void {
    if (this.lifecycle.disposed) return;
    this.locked = true;
    this.activeMenu?.close(() => { this.activeMenu = undefined; });
    this.activeBigMap?.dispose();
    this.activeBigMap = undefined;
    this.activePartyEditor?.dispose();
    this.activePartyEditor = undefined;
    this.activeMonsterpedia?.dispose();
    this.activeMonsterpedia = undefined;
    this.activeCollection?.dispose();
    this.activeCollection = undefined;
    this.activeOptions?.popup.dismiss();
    this.activeOptions = undefined;
    this.activeHighscores?.dispose();
    this.activeHighscores = undefined;
    this.activeTutorialMenu?.close();
    this.activeTutorialMenu = undefined;
    this.activeGuildQuests?.dispose();
    this.activeGuildQuests = undefined;
    this.activeEggHatch?.dispose();
    this.activeEggHatch = undefined;
    this.activeInventory?.requestClose();
    this.activeInventory = undefined;
    this.activeCharacterManagement?.dispose();
    this.activeCharacterManagement = undefined;
    this.activeStore?.dispose();
    this.activeStore = undefined;
    this.activeBlackMarketDemo?.dispose();
    this.activeBlackMarketDemo = undefined;
    this.activeArena?.dispose();
    this.activeArena = undefined;
    this.activeTournament?.dispose();
    this.activeTournament = undefined;
    this.activeTownWarp?.dispose();
    this.activeTownWarp = undefined;
    this.activeTownEnterChat?.dismiss(true);
    this.activeTownEnterChat = undefined;
    this.activeTownEnterChatName = undefined;
    this.activePlotTutorial?.dismiss();
    this.activePlotTutorial = undefined;
    this.plotTutorialState = undefined;
    this.stopTownFlash();


    PopupHost.for(this.pointRoot).dismissAll();
    this.townZoomAbort?.abort();
    this.townMenuAbort?.abort();
    this.fieldChromeAbort?.abort();
    this.lifecycle.dispose();
  }

  /** App-shell scene-transition ownership only. */
  setSceneVisible(visible: boolean): void {
    this.pointRoot.visible = visible;
    this.keyboardActive = visible;
  }


  showMapName(trigger: WorldNamePlateTrigger = "delayed-entry"): void {
    const current = this.byName.get(this.deps.trip.currentPoiName);
    if (current === undefined) {
      throw new Error(
        `WorldNode: cannot place ${this.deps.world.name}'s name plate without current POI ` +
          this.deps.trip.currentPoiName,
      );
    }
    this.showNamePlate(
      this.worldNamePlateText,
      "worldNamePlate",
      worldNamePlatePlacement(DISPLAY_MODE, current.position, trigger),
    );
  }

  private showNamePlate(
    text: string,
    label: string,
    placement: NamePlatePlacement = "lower-right",
  ): void {
    this.notifications.showNamePlate(text, label, placement);
  }

  private enqueueDayNotification(notification: TownDayNotificationState): void {
    this.notifications.enqueueDay(notification);
  }

  renderGameState(): Record<string, unknown> {
    const states = this.deps.trip.poiStates();
    const notifications = this.notifications.debugState;
    const popups = PopupHost.for(this.pointRoot).debugState;
    return {
      mode: this.activeTown === undefined ? "world" : "town",
      sceneInstanceId: this.debugSceneInstanceId,
      world: this.deps.world.name,
      currentPoi: this.deps.trip.currentPoiName,
      locked: this.locked,
      walking: this.walking,
      transitionFailure: this.transitionFailure,
      sceneFade: this.sourceSceneFade,
      tutorial: this.plotTutorialState,
      town: this.activeTown === undefined ? undefined : {
        name: this.activeTown.poi.name,
        zoom: this.activeTown.poi.town!.zoom,
        buildings: this.activeTown.display.buildings.map(({ definition, menuRoot }) => ({
          sourceIndex: definition.sourceIndex,
          className: definition.className,
          editable: definition.editable,
          // `revealed` is the source `setupForRenderable:context:` outcome: false means the town
          // shows an anonymous house with no icon, name plate, or touch surface.
          revealed: menuRoot !== undefined,
          enabled: menuRoot !== undefined && this.townBuildingIsEnabled(definition),
          fake: definition.fake,
        })),
        exitEnabled: true,
        dayNotification: notifications.dayNotification,
        namePlate: notifications.namePlate,
        flashing: this.townFlash === undefined ? undefined : {
          key: this.townFlash.key,
          target: this.townFlash.target,
          ...this.townFlash.overlay.debugState,
        },
      },
      refresh: {
        occurrenceByPoi: Object.fromEntries(
          [...this.deps.refreshState.occurrenceThisRefresh].sort(([left], [right]) =>
            left.localeCompare(right)),
        ),
        completedPois: [...this.deps.refreshState.completedThisRefresh].sort(),
      },
      markerVisible: this.marker.visible,
      markerAlpha: this.marker.alpha,
      markerPlaying: this.marker.playing,
      markerDirection: this.lastWalkDirection,
      markerPosition: { x: this.marker.position.x, y: this.marker.position.y },
      slidePosition: { x: this.scene.position.x, y: this.scene.position.y },
      sceneTransform: {
        position: { x: this.scene.position.x, y: this.scene.position.y },
        pivot: { x: this.scene.pivot.x, y: this.scene.pivot.y },
        scale: this.scene.scale.x,
      },
      elapsedMs: Math.round(this.elapsedMs),
      notifications: {
        ...notifications,
        global: this.notifications.parent === this.deps.stage.root,
      },
      chrome: {
        menu: {
          visible: this.menuSprite.visible,
          alpha: this.menuSprite.alpha,
          position: { x: this.menuSprite.position.x, y: this.menuSprite.position.y },
          center: {
            x: this.menuSprite.position.x + this.menuSprite.width / 2,
            y: this.menuSprite.position.y + this.menuSprite.height / 2,
          },
          functional: this.menuSprite.eventMode === "static",
        },
        heroXp: {
          level: this.deps.heroProgress.level,
          totalHighestLevels: this.deps.heroProgress.totalHighestLevels,
          percent: heroXpPercent(
            this.deps.heroProgress.level,
            this.deps.heroProgress.totalHighestLevels,
          ),
          expanded: this.heroXpExpanded,
          moving: this.heroXpTransition !== undefined,
          visible: this.heroXpRoot.visible,
          alpha: this.heroXpRoot.alpha,
          x: this.heroXpRoot.position.x,
        },
        mapName: notifications.namePlate,
      },
      inputBlockers: {
        modalOpening: this.modalOpening,
        townEnterChatOpening: this.townEnterChatOpening,
        activeTownEnterChat: this.activeTownEnterChat !== undefined,
        activeTownEnterChatName: this.activeTownEnterChatName ?? null,
        activePlotTutorial: this.activePlotTutorial !== undefined,
        hasModal: this.hasModal(),
      },
      menu: this.activeMenu?.debugState ?? null,
      overlay: this.overlayDebugState(popups),
      poiStates: Object.fromEntries(states),
      selectablePois: this.deps.trip.selectablePoiNames().filter((name) => {
        const poi = this.byName.get(name);
        return poi !== undefined && this.deps.poiRouting.route(poi).kind !== "blocked";
      }),
      blockedPois: this.deps.world.pointsOfInterest
        .filter((poi) => this.deps.poiRouting.route(poi).kind === "blocked")
        .map((poi) => poi.name),
      pois: this.deps.world.pointsOfInterest.map((poi) => {
        const display = this.poiDisplays.get(poi.name);
        return {
          name: poi.name,
          state: states.get(poi.name),
          logicalState: states.get(poi.name),
          renderedState: display?.renderedState ?? null,
          renderedTextureKey: display?.renderedTextureKey ?? null,
          stateVisible: display?.stateSprite.visible ?? false,
          stateAlpha: display?.stateSprite.alpha ?? 0,
          route: this.deps.poiRouting.route(poi),
          mapPosition: worldPoiPointToPixi(
            poi.position,
            DISPLAY_MODE,
            hasWorldMapIndent(this.deps.world.map.indent),
          ),
          position: worldPoiPointToScenePixi(poi.position, DISPLAY_MODE, this.deps.world.map.indent),
        };
      }),
      party: this.deps.party.monsters().map((monster, index) => ({
        index,
        instanceId: monster.instanceId,
        shortType: monster.shortType,
        level: monster.level,
        currentHp: monster.currentHp,
        fainted: monster.currentHp === 0,
        injured: monster.injureTime !== undefined,
        soulStone: monster.soulStone === undefined
          ? null
          : { element: monster.soulStone.element, level: monster.soulStone.level },
      })),
    };
  }

  private readonly updateFn = (): void => {
    if (!this.pointRoot.visible) return;
    const deltaMs = this.deps.stage.app.ticker.deltaMS;
    this.elapsedMs += deltaMs;
    this.activePartyEditor?.update(deltaMs);
    this.activeMonsterpedia?.update(deltaMs);
    this.activeCollection?.update(deltaMs);
    this.flushDeferredTownEntryNotifications();
    if (
      !this.drainingLegacyEggs &&
      this.deps.authority === undefined &&
      this.pointRoot.visible &&
      !this.locked &&
      !this.walking &&
      !this.hasModal() &&
      (
        this.deps.playerRuntime.profile.itemCount("Egg") > 0 ||
        this.deps.playerRuntime.profile.itemCount("MonsterEgg") > 0
      )
    ) {
      this.drainingLegacyEggs = true;
      void this.drainLegacyStoredEggs().finally(() => { this.drainingLegacyEggs = false; });
    }
    if (this.heroXpInitialClosePending && this.elapsedMs >= WORLD_HERO_XP_AUTO_CLOSE_MS) {
      this.heroXpInitialClosePending = false;
      this.toggleHeroXp(false);
    }
    const heroTransition = this.heroXpTransition;
    if (heroTransition !== undefined) {
      heroTransition.elapsedMs += deltaMs;
      const raw = Math.min(1, heroTransition.elapsedMs / WORLD_HERO_XP_TOGGLE_MS);
      const t = easeExponentialInOut(raw);
      this.heroXpRoot.position.x = heroTransition.from + (heroTransition.to - heroTransition.from) * t;
      if (raw >= 1) {
        this.heroXpRoot.position.x = heroTransition.to;
        this.heroXpExpanded = heroTransition.expanding;
        this.heroXpTransition = undefined;
      }
    }
  };




  async enterTown(
    poiName: string,
    options: {
      readonly presentationResume?: boolean;
      /** Gameplay transaction was already committed atomically by an authority/staged terminal.
       * Run native entry presentation, but do not replay its durable mutations. */
      readonly gameplayCommitted?: boolean;
    } = {},
  ): Promise<void> {
    if (this.activeTown !== undefined) return;
    const display = this.poiDisplays.get(poiName);
    if (display?.town === undefined || display.poi.town === undefined) {
      throw new Error(`WorldNode: ${poiName} is not a parsed town`);
    }

    this.locked = true;
    this.activeMenu?.close(() => { this.activeMenu = undefined; });
    this.menuSprite.eventMode = "none";
    this.menuSprite.cursor = "default";
    this.marker.visible = false;
    const townDisplay = display.town;
    const townDefinition = display.poi.town;
    this.activeTown = { poi: display.poi, display: townDisplay };

    this.townZoomAbort?.abort();
    const zoomAbort = new AbortController();
    this.townZoomAbort = zoomAbort;
    this.townMenuAbort?.abort();
    const menuAbort = new AbortController();
    this.townMenuAbort = menuAbort;
    this.fieldChromeAbort?.abort();
    this.fieldChromeAbort = undefined;

    void tween(
      this.deps.stage.app.ticker,
      TOWN_FIELD_MENU_FADE_OUT_MS,
      (t) => { this.menuSprite.alpha = 1 - t; },
      undefined,
      menuAbort.signal,
    );
    // Native state 3 owns no flagSprite, so notifyEnteredTown can fade only materialized flags.
    const flagSprites = [...this.poiDisplays.values()]
      .map(({ stateSprite }) => stateSprite)
      .filter((stateSprite) => stateSprite.visible && stateSprite.texture !== Texture.EMPTY);
    void tween(
      this.deps.stage.app.ticker,
      TOWN_FIELD_FLAGS_FADE_OUT_MS,
      (t) => {
        for (const stateSprite of flagSprites) stateSprite.alpha = 1 - t;
      },
      undefined,
      menuAbort.signal,
    );

    if (options.presentationResume === true) {
      // A renderer/settings rebuild is not another gameplay visit. Reconstruct the final town
      // composition without advancing the day, healing/restoring the party, resetting spirits,
      // refreshing encounters/quests, replaying entry chat, or emitting persistence callbacks.
      this.deps.audio.playMusic(this.deps.game.assets.audioUrl("Town1.mp3"), {
        loop: true,
        assetName: "Town1.mp3",
      });
      const screen = worldMapSizePt(DISPLAY_MODE);
      const focus = worldPoiPointToPixi(
        display.poi.position,
        DISPLAY_MODE,
        hasWorldMapIndent(this.deps.world.map.indent),
      );
      const target = townWorldZoomTarget(screen, focus, townDefinition.zoom, this.mapHome);
      this.scene.pivot.copyFrom(target.pivot);
      this.scene.position.copyFrom(target.position);
      this.scene.scale.set(target.scale);
      this.locked = false;
      this.showTownMenus(townDisplay, menuAbort.signal);
      this.showNamePlate(
        localizedRenderableName(this.deps.game.strings, [display.poi.name]),
        "townNamePlate",
      );
      this.scheduleTownEntryNotifications(() => {
        if (this.activeTown?.poi.name === poiName) this.startTownTutorialFlash(townDisplay);
      });
      if (this.townMenuAbort === menuAbort) this.townMenuAbort = undefined;
      return;
    }



    const day = this.deps.authority === undefined && options.gameplayCommitted !== true
      ? advanceWorldDay(this.deps.refreshState)
      : this.deps.refreshState.dayNumber;
    this.enqueueDayNotification({
      day,
      title: localizedString(this.deps.game.strings, "DayFormatKey").replace("%d", String(day)),
      message: localizedString(this.deps.game.strings, "DayEndKey"),
      image: "sunrise.png",
      visible: false,
    });
    if (options.gameplayCommitted !== true) this.deps.onStateChanged();

    this.deps.audio.playSfx("night");
    this.playTownMusic();

    const screen = worldMapSizePt(DISPLAY_MODE);
    const focus = worldPoiPointToPixi(
      display.poi.position,
      DISPLAY_MODE,
      hasWorldMapIndent(this.deps.world.map.indent),
    );
    const target = townWorldZoomTarget(screen, focus, townDefinition.zoom, this.mapHome);
    const from = {
      x: this.scene.position.x,
      y: this.scene.position.y,
      scale: this.scene.scale.x,
      pivotX: this.scene.pivot.x,
      pivotY: this.scene.pivot.y,
    };

    const zoom = tween(this.deps.stage.app.ticker, TOWN_ENTRY_ZOOM_MS, (raw) => {
      const t = easeExponentialOut(raw);
      this.scene.pivot.set(
        from.pivotX + (target.pivot.x - from.pivotX) * t,
        from.pivotY + (target.pivot.y - from.pivotY) * t,
      );
      this.scene.position.set(
        from.x + (target.position.x - from.x) * t,
        from.y + (target.position.y - from.y) * t,
      );
      this.scene.scale.set(from.scale + (target.scale - from.scale) * t);
    }, undefined, zoomAbort.signal);
    void zoom.then(() => {
      if (this.townZoomAbort === zoomAbort) this.townZoomAbort = undefined;
    });

    void (async (): Promise<void> => {
      await tween(
        this.deps.stage.app.ticker,
        TOWN_ENTRY_REVEAL_DELAY_MS,
        () => {},
        undefined,
        menuAbort.signal,
      );
      if (menuAbort.signal.aborted || this.activeTown?.poi.name !== poiName) return;



      this.locked = false;
      this.showTownMenus(townDisplay, menuAbort.signal);
      this.showNamePlate(
        localizedRenderableName(this.deps.game.strings, [display.poi.name]),
        "townNamePlate",
      );
      if (options.gameplayCommitted !== true) {












        this.deps.party.restoreAtTown(this.authoritativeNowSeconds ?? Date.now() / 1000);
        this.authoritativeNowSeconds = undefined;
        this.deps.playerRuntime.profile.resetSpiritsForTownReturn();
        this.deps.trip.refreshAtTown();
        this.deps.onTownEntered(poiName);
        this.deps.onStateChanged();
      }



      this.scheduleTownEntryNotifications(() => {
        if (this.activeTown?.poi.name !== poiName) return;
        void this.presentTownEnterChat(townDefinition.enterChats);
        this.startTownTutorialFlash(townDisplay);
      });
      if (this.townMenuAbort === menuAbort) this.townMenuAbort = undefined;
    })();
  }




  async leaveTown(): Promise<void> {
    const active = this.activeTown;
    if (active === undefined || this.locked || this.hasModal()) return;
    this.locked = true;
    try {
      const departure = await this.deps.authority?.leaveTown();
      if (departure?.committedAt !== undefined) {
        const committedAt = Date.parse(departure.committedAt);
        if (!Number.isFinite(committedAt)) {
          throw new Error("official town departure returned an invalid commit time");
        }
        this.deps.party.purgeExpiredInjuries(committedAt / 1_000);
      }
    } catch (error) {
      this.locked = false;
      this.deps.audio.playSfx("notAllowed");
      this.transitionFailure = {
        route: `leave town ${active.poi.name}`,
        message: error instanceof Error ? error.message : String(error),
      };
      return;
    }

    this.townZoomAbort?.abort();
    this.townMenuAbort?.abort();
    const zoomAbort = new AbortController();
    const menuAbort = new AbortController();
    this.townZoomAbort = zoomAbort;
    this.townMenuAbort = menuAbort;

    for (const building of active.display.buildings) {
      building.root.eventMode = "none";
      if (building.menuRoot) building.menuRoot.eventMode = "none";
    }
    active.display.exit.eventMode = "none";
    active.display.menuButton.eventMode = "none";
    const from = {
      x: this.scene.position.x,
      y: this.scene.position.y,
      scale: this.scene.scale.x,
      pivotX: this.scene.pivot.x,
      pivotY: this.scene.pivot.y,
    };

    await Promise.all([
      this.hideTownMenus(active.display, menuAbort.signal),
      tween(this.deps.stage.app.ticker, TOWN_EXIT_ZOOM_MS, (raw) => {
        const t = easeExponentialOut(raw);
        this.scene.pivot.set(from.pivotX * (1 - t), from.pivotY * (1 - t));
        this.scene.position.set(
          from.x * (1 - t),
          from.y * (1 - t),
        );
        this.scene.scale.set(from.scale + (1 - from.scale) * t);
      }, undefined, zoomAbort.signal),
    ]);
    if (zoomAbort.signal.aborted || menuAbort.signal.aborted || this.activeTown !== active) return;

    this.scene.pivot.set(0, 0);
    this.scene.position.set(0, 0);
    this.scene.scale.set(1);
    this.activeTown = undefined;
    this.stopTownFlash();
    this.menuSprite.visible = true;
    this.menuSprite.alpha = 0;
    this.menuSprite.eventMode = "static";
    this.menuSprite.cursor = "pointer";
    this.refreshPoiStates();
    this.marker.visible = true;
    this.marker.alpha = 0;


    this.deps.audio.playSfx("rooster");
    await this.presentIntroTutorial("Tutorial2", ["fieldMovement.png"]);
    this.playFieldMusic();
    this.locked = false;
    this.fieldChromeAbort?.abort();
    const fieldChromeAbort = new AbortController();
    this.fieldChromeAbort = fieldChromeAbort;
    void tween(
      this.deps.stage.app.ticker,
      TOWN_FIELD_RESTORE_FADE_MS,
      (t) => {
        this.menuSprite.alpha = t;
        this.marker.alpha = t;
      },
      undefined,
      fieldChromeAbort.signal,
    ).then(() => {
      if (fieldChromeAbort.signal.aborted) return;
      this.menuSprite.alpha = 1;
      this.marker.alpha = 1;
      if (this.fieldChromeAbort === fieldChromeAbort) this.fieldChromeAbort = undefined;
    });
    if (this.townZoomAbort === zoomAbort) this.townZoomAbort = undefined;
    if (this.townMenuAbort === menuAbort) this.townMenuAbort = undefined;
  }


  playFieldMusic(): void {
    this.playSourceMusicTrack("Field", 1);
  }


  private playTownMusic(): void {
    this.playSourceMusicTrack("Town", 1);
  }

  private playSourceMusicTrack(category: string, trackCount: number): void {
    this.deps.audio.requestMusic(category, trackCount, true, (count, shouldLoop) => {
      const index = 1 + (
        this.deps.sourceRng?.intBelow(count) ?? Math.floor(Math.random() * count)
      );
      const assetName = `${category}${index}.mp3`;
      this.deps.audio.playMusic(this.deps.game.assets.audioUrl(assetName), {
        loop: shouldLoop,
        assetName,
      });
    });
  }

  private async buildTownPoi(parent: Container, poi: WorldPointOfInterest): Promise<TownPoiDisplay> {
    const town = poi.town;
    if (town === undefined) throw new Error(`WorldNode: missing town data for ${poi.name}`);
    parent.sortableChildren = true;
    const buildings: TownBuildingDisplay[] = [];
    for (const definition of town.buildings) {
      const root = new Container();
      root.label = `town:${poi.name}:building:${definition.sourceIndex}`;
      const position = townRelativePointToPixi(definition.position, DISPLAY_MODE);
      root.position.set(position.x, position.y);
      // Native adds every house at z=0; Cocos preserves source insertion order for equal-z
      // siblings. A monotonically increasing zIndex recreates that order under Pixi sorting while
      // leaving the POI base below and town icons above.
      root.zIndex = definition.sourceIndex;
      const house = pointSprite(
        await this.deps.game.assets.sprite(resolvedSpriteKey(this.deps.game, definition.spriteFile)),
      );
      house.anchor.set(0.5);
      house.scale.set(
        house.scale.x * townHouseSpriteScale(DISPLAY_MODE),
        house.scale.y * townHouseSpriteScale(DISPLAY_MODE),
      );
      root.addChild(house);





      const anonymous: TownBuildingDisplay = { definition, root, house, revealed: false };
      parent.addChild(root);
      buildings.push(
        this.townBuildingConditionsPass(definition)
          ? await this.attachTownBuildingService(poi, parent, anonymous)
          : anonymous,
      );
    }

    const exit = new Container();
    exit.label = `town:${poi.name}:exit`;
    const exitPosition = townRelativePointToPixi(town.exit.position, DISPLAY_MODE);
    exit.position.set(exitPosition.x, exitPosition.y);
    // Source adds the exit after every house at the same z=0, before the z=1 icon sprites.
    exit.zIndex = town.buildings.length;
    exit.visible = false;
    exit.alpha = 0;
    const exitSprite = pointSprite(
      await this.deps.game.assets.sprite(resolvedSpriteKey(this.deps.game, town.exit.spriteFile)),
    );
    exitSprite.anchor.set(0.5);
    exitSprite.scale.set(
      exitSprite.scale.x * TOWN_EXIT_SPRITE_SCALE,
      exitSprite.scale.y * TOWN_EXIT_SPRITE_SCALE,
    );


    const exitLabel = makeTtfLabel(
      localizedString(this.deps.game.strings, "LeaveTownKey"),
      townLabelFontSize(DISPLAY_MODE),
      {
        fill: 0xffffff,
        outline: true,
        outlineWidthPt: OUTLINE_FADE_BORDER_PT,
        outlineAlpha: OUTLINE_FADE_ALPHA,
        textureScaleMode: "nearest",
      },
    );
    exitLabel.anchor.set(0.5, 0);
    exitLabel.position.set(0, exitSprite.height / 2);
    exitLabel.scale.set(
      exitLabel.scale.x * townCounterScale(town.zoom),
      exitLabel.scale.y * townCounterScale(town.zoom),
    );
    exit.addChild(exitSprite, exitLabel);
    const exitHit = minimumWorldHitRectangle(
      {
        x: -exitSprite.width / 2,
        y: -exitSprite.height / 2,
        width: exitSprite.width,
        height: exitSprite.height,
      },
      townLocalMinimumTouchSize(town.zoom, DISPLAY_MODE),
    );
    exit.hitArea = new Rectangle(exitHit.x, exitHit.y, exitHit.width, exitHit.height);
    exit.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (this.activeTown?.poi.name !== poi.name || this.locked || this.hasModal()) return;
      void this.activateTownExit();
    });
    parent.addChild(exit);

    const menuButton = pointSprite(await this.deps.game.assets.sprite("menuButton-hd"));
    menuButton.label = `town:${poi.name}:menuButton`;
    const menuPosition = townMenuLocalPosition(
      worldMapSizePt(DISPLAY_MODE),
      DISPLAY_MODE,
      town.zoom,
      poi.renderer.menuButtonOffset,
    );
    menuButton.position.set(menuPosition.x, menuPosition.y);
    menuButton.scale.set(
      menuButton.scale.x * townCounterScale(town.zoom),
      menuButton.scale.y * townCounterScale(town.zoom),
    );
    const townMenuBounds = menuButton.getLocalBounds();
    const townMenuHit = minimumHitRectLocal(
      { x: townMenuBounds.x, y: townMenuBounds.y, w: townMenuBounds.width, h: townMenuBounds.height },
      menuButton.scale,
    );
    menuButton.hitArea = new Rectangle(townMenuHit.x, townMenuHit.y, townMenuHit.w, townMenuHit.h);
    menuButton.visible = false;
    menuButton.alpha = 0;
    menuButton.eventMode = "none";
    menuButton.cursor = "default";
    menuButton.zIndex = 20_000;
    menuButton.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (this.activeTown?.poi.name !== poi.name || this.locked || this.hasModal()) return;
      void this.showMenu();
    });
    parent.addChild(menuButton);
    return {
      parent,
      buildings,
      exit,
      exitFlashTarget: exitSprite,
      menuButton,
    };
  }

  /** Source authored-`conditions` verdict for one house; see `townBuildingIsRevealed`. */
  private townBuildingConditionsPass(definition: TownBuildingDefinition): boolean {
    return !definition.fake &&
      townBuildingIsRevealed(definition.conditions, this.deps.guildQuests);
  }

  /**
   * The service branch of `setupForRenderable:context:`'s per-house loop: the icon, name plate,
   * both `ccTouchEnded:` hit surfaces, and the tutorial-flash target. `building.root` already owns
   * the anonymous house sprite and is already attached to `parent`.
   */
  private async attachTownBuildingService(
    poi: WorldPointOfInterest,
    parent: Container,
    building: TownBuildingDisplay,
  ): Promise<TownBuildingDisplay> {
    const town = poi.town;
    if (town === undefined) throw new Error(`WorldNode: missing town data for ${poi.name}`);
    const { definition, root, house } = building;
    if (!definition.iconSpriteFile || !definition.nameLabel) {
      return { definition, root, house, revealed: true };
    }
    const menuRoot = new Container();
    menuRoot.label = `town:${poi.name}:menu:${definition.className}`;
    menuRoot.position.copyFrom(root.position);
    menuRoot.zIndex = 10_000 + definition.sourceIndex;
    menuRoot.visible = false;
    menuRoot.alpha = 0;
    menuRoot.eventMode = "none";
    menuRoot.cursor = "default";
    const icon = pointSprite(
      await this.deps.game.assets.sprite(
        resolvedSpriteKey(this.deps.game, definition.iconSpriteFile),
      ),
    );
    icon.anchor.set(0.5);
    icon.position.set(0, -townBuildingIconOffsetY(DISPLAY_MODE));
    icon.scale.set(
      icon.scale.x * townCounterScale(town.zoom),
      icon.scale.y * townCounterScale(town.zoom),
    );
    const label = makeTtfLabel(
      localizedString(this.deps.game.strings, definition.nameLabel),
      townLabelFontSize(DISPLAY_MODE),
      {
        fill: 0xffffff,
        outline: true,





        outlineWidthPt: OUTLINE_FADE_BORDER_PT,
        outlineAlpha: OUTLINE_FADE_ALPHA,
        textureScaleMode: "nearest",
      },
    );
    label.anchor.set(0.5, 0);
    label.position.set(0, townBuildingLabelOffsetY(house.height));
    label.scale.set(
      label.scale.x * townCounterScale(town.zoom),
      label.scale.y * townCounterScale(town.zoom),
    );
    label.visible = false;
    label.alpha = 0;
    label.eventMode = "none";
    // Source keeps the label with its z=0 house and raises only the icon to the z=1 menu
    // layer. Later source-ordered houses may therefore occlude an earlier house label.
    root.addChild(label);
    menuRoot.addChild(icon);
    const iconHit = minimumWorldHitRectangle(
      {
        x: icon.position.x - icon.width / 2,
        y: icon.position.y - icon.height / 2,
        width: icon.width,
        height: icon.height,
      },
      townLocalMinimumTouchSize(town.zoom, DISPLAY_MODE),
    );
    menuRoot.hitArea = new Rectangle(iconHit.x, iconHit.y, iconHit.width, iconHit.height);
    const activate = (event: FederatedPointerEvent): void => {
      event.stopPropagation();
      if (
        !this.townBuildingIsEnabled(definition) ||
        this.activeTown?.poi.name !== poi.name ||
        this.locked ||
        this.hasModal() ||
        this.modalOpening
      ) return;
      void this.activateTownBuilding(definition);
    };
    menuRoot.on("pointertap", activate);




    const houseHit = minimumWorldHitRectangle(
      { x: -house.width / 2, y: -house.height / 2, width: house.width, height: house.height },
      townLocalMinimumTouchSize(town.zoom, DISPLAY_MODE),
    );
    root.hitArea = new Rectangle(houseHit.x, houseHit.y, houseHit.width, houseHit.height);
    root.eventMode = "none";
    root.cursor = "default";
    root.on("pointertap", activate);
    parent.addChild(menuRoot);
    return { definition, root, house, revealed: true, menuRoot, labelRoot: label, flashTarget: icon };
  }

  /** Reverse of `attachTownBuildingService`: leave only the anonymous house. */
  private detachTownBuildingService(building: TownBuildingDisplay): TownBuildingDisplay {
    const { definition, root, house } = building;
    root.off("pointertap");
    root.hitArea = null;
    root.eventMode = "none";
    root.cursor = "default";
    building.labelRoot?.destroy();
    building.menuRoot?.destroy({ children: true });
    return { definition, root, house, revealed: false };
  }












  private async regateTownBuildingServices(): Promise<void> {
    if (this.activeTown !== undefined) {
      throw new Error(
        `WorldNode: cannot re-gate town services while ${this.activeTown.poi.name} is open`,
      );
    }
    for (const display of this.poiDisplays.values()) {
      const town = display.town;
      if (town === undefined) continue;
      const verdicts = town.buildings.map(({ definition }) =>
        this.townBuildingConditionsPass(definition));
      for (const index of townBuildingRevealChanges(town.buildings, verdicts)) {
        const building = town.buildings[index]!;
        town.buildings[index] = verdicts[index]
          ? await this.attachTownBuildingService(display.poi, town.parent, building)
          : this.detachTownBuildingService(building);
      }
    }
  }

  private showTownMenus(town: TownPoiDisplay, signal: AbortSignal): void {
    for (const building of town.buildings) {
      const menuRoot = building.menuRoot;
      if (!menuRoot) continue;
      menuRoot.visible = true;
      menuRoot.alpha = 0;
      if (building.labelRoot) {
        building.labelRoot.visible = true;
        building.labelRoot.alpha = 0;
      }
      void tween(this.deps.stage.app.ticker, TOWN_MENU_FADE_MS, (t) => {
        if (!menuRoot.destroyed) menuRoot.alpha = t;
        if (building.labelRoot && !building.labelRoot.destroyed) building.labelRoot.alpha = t;
      }, undefined, signal);
    }
    this.refreshTownBuildingInteractivity(town);
    town.exit.visible = true;
    town.exit.alpha = 0;
    town.exit.eventMode = "static";
    town.exit.cursor = "pointer";
    void tween(this.deps.stage.app.ticker, TOWN_MENU_FADE_MS, (t) => {
      if (!town.exit.destroyed) town.exit.alpha = t;
    }, undefined, signal);
    town.menuButton.visible = true;
    town.menuButton.alpha = 0;
    town.menuButton.eventMode = "static";
    town.menuButton.cursor = "pointer";
    void tween(this.deps.stage.app.ticker, TOWN_MENU_FADE_MS, (t) => {
      if (!town.menuButton.destroyed) town.menuButton.alpha = t;
    }, undefined, signal);
  }

  private async hideTownMenus(town: TownPoiDisplay, signal: AbortSignal): Promise<void> {
    await tween(this.deps.stage.app.ticker, TOWN_MENU_FADE_MS, (t) => {
      town.buildings.forEach((building) => {
        // Source runs an absolute CCFadeOut even when an early exit overlaps the still-running
        // reveal CCFadeIn; the newer action writes last each frame.
        if (building.menuRoot) building.menuRoot.alpha = 1 - t;
        if (building.labelRoot) building.labelRoot.alpha = 1 - t;
      });
      town.exit.alpha = 1 - t;
      town.menuButton.alpha = 1 - t;
    }, undefined, signal);
    if (signal.aborted) return;
    for (const building of town.buildings) {
      building.root.eventMode = "none";
      building.root.cursor = "default";
      if (building.menuRoot) {
        building.menuRoot.eventMode = "none";
        building.menuRoot.cursor = "default";
      }
      // Associated fadeSprites run CCHide after their FadeOut; icon/control roots remain attached
      // and visible at opacity zero.
      if (building.labelRoot) building.labelRoot.visible = false;
    }
    town.menuButton.eventMode = "none";
  }

  private buildChrome(
    menuTexture: Texture,
    heroXpFrameTexture: Texture,
    heroXpBarTexture: Texture,
    hasMapIndent: boolean,
  ): void {
    const screen = worldMapSizePt(DISPLAY_MODE);
    this.menuSprite = pointSprite(menuTexture);
    this.menuSprite.label = "worldMenuButton";
    const menuPosition = worldMenuPosition(DISPLAY_MODE, hasMapIndent);
    this.menuHome = menuPosition;
    this.menuSprite.position.set(menuPosition.x, menuPosition.y);
    this.menuSprite.eventMode = "static";
    this.menuSprite.cursor = "pointer";
    const menuBounds = this.menuSprite.getLocalBounds();
    const menuHit = minimumHitRectLocal(
      { x: menuBounds.x, y: menuBounds.y, w: menuBounds.width, h: menuBounds.height },
      this.menuSprite.scale,
    );
    this.menuSprite.hitArea = new Rectangle(menuHit.x, menuHit.y, menuHit.w, menuHit.h);
    this.menuSprite.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      void this.showMenu();
    });
    this.chrome.addChild(this.menuSprite);

    this.heroXpRoot = new Container();
    const frame = pointSprite(heroXpFrameTexture);
    this.heroXpFrameWidth = frame.width;
    const frameHeight = frame.height;
    this.heroXpRoot.position.set(0, screen.h - frameHeight);
    this.heroXpRoot.eventMode = "static";
    this.heroXpRoot.cursor = "pointer";
    const heroXpHit = minimumHitRectLocal(
      { x: 0, y: 0, w: frame.width, h: frameHeight },
      this.heroXpRoot.scale,
    );
    this.heroXpRoot.hitArea = new Rectangle(heroXpHit.x, heroXpHit.y, heroXpHit.w, heroXpHit.h);
    this.heroXpRoot.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      if (this.locked || this.activeTown !== undefined) return;
      this.heroXpInitialClosePending = false;
      const expanding = this.heroXpTransition?.expanding === false ||
        (this.heroXpTransition === undefined && !this.heroXpExpanded);
      this.toggleHeroXp(expanding);
    });
    this.heroXpRoot.addChild(frame);

    const barPosition = worldHeroXpBarPosition(DISPLAY_MODE);
    const barCenterY = frameHeight - barPosition.y;
    const barBack = pointSprite(heroXpBarTexture);
    barBack.anchor.set(0, 0.5);
    barBack.position.set(barPosition.x, barCenterY);
    const barFill = pointSprite(heroXpBarTexture);
    barFill.anchor.set(0, 0.5);
    barFill.position.copyFrom(barBack.position);





    barFill.tint = 0xff8080;
    const fillMask = new Graphics();
    barFill.mask = fillMask;
    this.heroXpFillMask = fillMask;
    this.heroXpFillRect = {
      x: barPosition.x,
      y: barCenterY - barFill.height / 2,
      w: barFill.width,
      h: barFill.height,
    };
    this.heroXpRoot.addChild(barBack, barFill, fillMask);

    const level = makeTtfLabel(
      `${localizedString(this.deps.game.strings, "LevelShortKey")} ${this.deps.heroProgress.level}`,
      worldHeroXpFontSize(DISPLAY_MODE),

      { outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    level.anchor.set(0, 0.5);
    level.position.set(
      barPosition.x + barBack.width + worldHeroXpLabelGap(DISPLAY_MODE),
      barCenterY,
    );
    level.label = "worldHeroXpLevel";
    this.heroXpLevelLabel = level;
    this.heroXpRoot.addChild(level);
    this.refreshHeroXp();
    this.chrome.addChild(this.heroXpRoot);
    this.scene.addChild(this.chrome);
  }

  private async showMenu(): Promise<void> {
    if (this.locked || this.walking || this.activeMenu || this.hasModal() || this.modalOpening) return;
    this.modalOpening = true;
    try {
      const menuEditable = this.activeTown !== undefined;
      const enabled = new Set<WorldMenuAction>([
        "items",
        "monsters",
        "monsterpedia",
        "options",
        "mainMenu",
      ]);
      if (hasCompleteSourceTutorialSurface(this.deps.game)) enabled.add("tutorials");
      if (this.guildQuestListAvailable()) enabled.add("quests");
      if (this.deps.onTownPortal !== undefined) enabled.add("townPortal");
      if (this.deps.game.assets.hasSprite("bigmap")) enabled.add("worldMap");
      // Source-authored row, lit only when there is a real board behind it — see the policy note at
      // the head of highscoresScreen.ts. Achievements beside it stays inert.
      if (this.deps.scoreboard !== undefined) enabled.add("highscores");
      this.activeMenu = await WorldMenu.show(this.pointRoot, {
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        enabledActions: enabled,
        // WorldNode.showMenu passes NO; TownPOINode's distinct local button passes YES. Both use
        // the source PopupMenu config named "MasterMenu"; the argument changes destination policy.
        editable: menuEditable,
        onClick: () => this.deps.audio.playSfx("click"),
        onClose: () => { this.activeMenu = undefined; },
        onSelect: (action) => { void this.activateMenuAction(action, menuEditable); },
      });
    } finally {
      this.modalOpening = false;
    }
  }

  private readonly handleKeyboardShortcut = ({ key }: KeyboardShortcut): boolean => {
    if (!this.keyboardActive || key !== "escape") return false;
    if (this.activeCollection !== undefined) return this.activeCollection.requestBack();
    if (this.activePlotTutorial !== undefined) return true;
    if (this.activeTutorialMenu !== undefined) {
      return this.activeTutorialMenu.requestBack();
    }
    if (this.activeOptions !== undefined) {
      this.activeOptions.requestClose();
      return true;
    }
    if (this.activeHighscores !== undefined) {
      return this.activeHighscores.requestBack();
    }
    if (this.activeGuildQuests !== undefined) {
      this.activeGuildQuests.requestBack();
      return true;
    }
    if (this.activeInventory !== undefined) {
      this.activeInventory.requestClose();
      this.activeInventory = undefined;
      return true;
    }
    if (this.activeCharacterManagement !== undefined) {
      return this.activeCharacterManagement.requestBack();
    }
    if (this.activeStore !== undefined) {
      return this.activeStore.requestBack();
    }
    if (this.activeBlackMarketDemo !== undefined) {
      return this.activeBlackMarketDemo.requestBack();
    }
    if (this.activeArena !== undefined) {
      return this.activeArena.requestBack();
    }
    if (this.activeTownWarp !== undefined) {
      this.activeTownWarp.requestClose();
      return true;
    }
    if (this.activeTournament !== undefined) {
      return this.activeTournament.requestBack();
    }
    if (this.activeMonsterpedia !== undefined) {
      this.activeMonsterpedia.requestBack();
      return true;
    }
    if (this.activePartyEditor !== undefined) {
      this.activePartyEditor.requestBack();
      return true;
    }
    if (this.activeBigMap !== undefined) {
      this.activeBigMap.requestClose();
      return true;
    }
    if (this.activeMenu !== undefined) {
      this.activeMenu.close(() => { this.activeMenu = undefined; });
      return true;
    }
    if (this.locked || this.walking || this.modalOpening) return false;
    void this.showMenu();
    return true;
  };

  private async activateMenuAction(action: WorldMenuAction, editable: boolean): Promise<void> {
    if (action === "items") {
      await this.openInventory(2, localizedString(this.deps.game.strings, "ItemsInfoTitleKey"));
      return;
    }
    if (action === "worldMap") {
      this.modalOpening = true;
      try {
        this.activeBigMap = await BigMapNode.show(this.pointRoot, {
          assets: this.deps.game.assets,
          ticker: this.deps.stage.app.ticker,
          currentWorld: this.deps.world.name,
          visitedWorlds: this.deps.visitedWorlds,
          onClick: () => this.deps.audio.playSfx("click"),
          onClose: () => { this.activeBigMap = undefined; },
        });
      } finally {
        this.modalOpening = false;
      }
      return;
    }
    if (action === "monsters") {
      this.modalOpening = true;
      try {
        await this.showPartyEditor(editable ? 0 : 1);
      } finally {
        this.modalOpening = false;
      }
      return;
    }
    if (action === "monsterpedia") {
      this.modalOpening = true;
      try {
        // The outdoor MasterMenu is inspection-only. The distinct town General Menu passes the
        // source editable context through to the same book; the town building does likewise.
        await this.openMonsterpedia(
          editable,
          this.activeTown === undefined
            ? "world-menu-monsterpedia"
            : "town-menu-monsterpedia",
        );
      } finally {
        this.modalOpening = false;
      }
      return;
    }
    if (action === "quests") {
      this.modalOpening = true;
      try {
        await this.openGuildQuestList();
      } finally {
        this.modalOpening = false;
      }
      return;
    }
    if (action === "townPortal") {


      this.locked = true;
      try {
        if (this.deps.onTownPortal === undefined) {
          throw new Error("Town Portal is unavailable for this content package");
        }
        await this.deps.onTownPortal();
      } catch (error) {
        this.locked = false;
        this.reportTransitionFailure("townPortal", error);
      }
      return;
    }
    if (action === "options") {
      this.modalOpening = true;
      try {
        const panel = await showOptionsPanel({
          parent: this.pointRoot,
          assets: this.deps.game.assets,
          scale9: this.deps.game.scale9,
          strings: this.deps.game.strings,
          ticker: this.deps.stage.app.ticker,
          audio: this.deps.audio,
          onClick: () => this.deps.audio.playSfx("click"),
          onDismiss: () => { this.activeOptions = undefined; },
          onPresentationChange: this.deps.onPresentationChange,
          ...(this.deps.account === undefined ? {} : { account: this.deps.account }),
        });
        // The card mounts across an await, so teardown can land first — and this node's own
        // teardown would then never see the panel to dismiss it, stranding its account listener.
        if (this.lifecycle.disposed) {
          panel.popup.dismiss();
          return;
        }
        this.activeOptions = panel;
      } finally {
        this.modalOpening = false;
      }
      return;
    }
    if (action === "highscores") {
      if (this.deps.scoreboard === undefined) return;
      this.modalOpening = true;
      try {
        const panel = await showHighscoresPanel({
          parent: this.pointRoot,
          assets: this.deps.game.assets,
          scale9: this.deps.game.scale9,
          strings: this.deps.game.strings,
          ticker: this.deps.stage.app.ticker,
          source: this.deps.scoreboard,
          onClick: () => this.deps.audio.playSfx("click"),
          onDismiss: () => {
            if (this.activeHighscores === panel) this.activeHighscores = undefined;
          },
        });
        // The card mounts across an await, so a scene teardown can land first; disposing here keeps
        // the in-flight board request from painting into nodes this node has already released.
        if (this.lifecycle.disposed) {
          panel.dispose();
          return;
        }
        this.activeHighscores = panel;
      } finally {
        this.modalOpening = false;
      }
      return;
    }
    if (action === "tutorials") {
      this.modalOpening = true;
      try {
        let menu: TutorialMenu | undefined;
        menu = await TutorialMenu.show({
          parent: this.pointRoot,
          assets: this.deps.game.assets,
          scale9: this.deps.game.scale9,
          strings: this.deps.game.strings,
          ticker: this.deps.stage.app.ticker,
          keyboard: this.deps.keyboard,
          topics: this.deps.game.sourceTutorialTopics,
          onClick: () => this.deps.audio.playSfx("click"),
          onClose: () => {
            if (this.activeTutorialMenu === menu) this.activeTutorialMenu = undefined;
          },
          onStateChanged: () => this.deps.onStateChanged(),
        });
        if (this.lifecycle.disposed) {
          menu.close();
          return;
        }
        this.activeTutorialMenu = menu;
      } finally {
        this.modalOpening = false;
      }
      return;
    }
    if (action === "mainMenu") {
      this.modalOpening = true;
      try {
        await showMainMenuConfirmation({
          parent: this.pointRoot,
          assets: this.deps.game.assets,
          scale9: this.deps.game.scale9,
          strings: this.deps.game.strings,
          ticker: this.deps.stage.app.ticker,
          owner: this,
          onClick: () => this.deps.audio.playSfx("click"),
          onConfirm: this.deps.onMainMenu,
        });
      } finally {
        this.modalOpening = false;
      }
    }
  }

  private refreshTownBuildingInteractivity(town: TownPoiDisplay): void {
    for (const building of town.buildings) {
      // A fake house, or one whose authored `conditions` were rejected when the node was built,
      // never entered `touchableBuildings`. It has no menu root, carries no tap listener, and no
      // pointer mode is claimed for it at all.
      const menuRoot = building.menuRoot;
      if (menuRoot === undefined) continue;
      const enabled = this.townBuildingIsEnabled(building.definition);
      building.root.eventMode = enabled ? "static" : "none";
      building.root.cursor = enabled ? "pointer" : "default";
      menuRoot.eventMode = enabled ? "static" : "none";
      menuRoot.cursor = enabled ? "pointer" : "default";
    }
  }

  /** Town `MonsterManagementMenuItem.activate:` route — editable style 0 with the real reserves
   * collection. The world/general menu reaches the same coordinator as style 1, whose native
   * reserve collection is nil. */
  private async openStore(): Promise<void> {
    if (this.modalOpening || this.locked || this.hasModal() || this.activeTown === undefined) return;
    this.modalOpening = true;
    try {
      let flow: StoreFlow | undefined;
      flow = await StoreFlow.show({
        parent: this.pointRoot,
        owner: this,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        data: this.deps.game.gd,
        profile: this.deps.playerRuntime.profile,
        onClick: () => this.deps.audio.playSfx("click"),
        onBlocked: () => this.deps.audio.playSfx("notAllowed"),
        onClose: () => {
          if (this.activeStore === flow) this.activeStore = undefined;
          this.deps.onStateChanged();
        },
        onFirstShop: async () => {
          const claimed = await this.claimTutorialFlag("FirstShop");
          if (claimed !== "claimed" || this.lifecycle.disposed) return;
          await showMonsterHatchPopup({
            parent: this.pointRoot,
            owner: this,
            assets: this.deps.game.assets,
            scale9: this.deps.game.scale9,
            ticker: this.deps.stage.app.ticker,
            zIndex: 1200,
            sfx: {
              onButtonPress: () => this.deps.audio.playSfx("click"),
              onButtonBlocked: () => this.deps.audio.playSfx("notAllowed"),
            },
          }, {
            title: localizedString(this.deps.game.strings, "FirstShopTitleKey"),
            content: buildMonsterHatchMessageBlock(
              localizedString(this.deps.game.strings, "FirstShopMessageKey"),
            ).root,
            buttons: [{
              label: localizedString(this.deps.game.strings, "OkButtonKey"),
              onPress: () => undefined,
            }],
          });
        },
        purchase: (stock, quantity) => this.purchaseStoreItem(stock, quantity),
        presentCommittedRewards: (items) => showCommittedStoreLootManagement({
          parent: this.pointRoot,
          owner: this,
          game: this.deps.game,
          audio: this.deps.audio,
          ticker: this.deps.stage.app.ticker,
        }, items),
        // A store-bought Egg never offers the paid repeat, whatever the Hero's level.
        onEggPurchased: (kind) => this.showEggHatch(kind, { allowSecondSpin: false }),
      });
      if (this.lifecycle.disposed) {
        flow.dispose();
        return;
      }
      this.activeStore = flow;
    } finally {
      this.modalOpening = false;
    }
  }








  private async openBlackMarket(): Promise<void> {
    if (this.deps.blackMarketServiceReady === true) {
      await this.openBlackMarketDemo();
      return;
    }
    await this.showBlackMarketNotReady();
  }

  /** The source not-ready branch's dialog. It owns no modal state: like every other
   *  `showPopupForLocalizedMessageName:` message popup it is a self-dismissing `Scale9Popup`
   *  whose own modal layer swallows input until its `OkButtonKey` button closes it. */
  private async showBlackMarketNotReady(): Promise<void> {
    if (this.modalOpening || this.locked || this.hasModal()) return;
    this.modalOpening = true;
    try {
      await showBlackMarketNotReadyPopup({
        parent: this.pointRoot,
        owner: this,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        zIndex: 12_000,
        sfx: {
          onButtonPress: () => this.deps.audio.playSfx("click"),
          onButtonBlocked: () => this.deps.audio.playSfx("notAllowed"),
        },
      });
    } finally {
      this.modalOpening = false;
    }
  }

  /** Presentation-only replacement for the retired native Black Market service. */
  private async openBlackMarketDemo(): Promise<void> {
    const configured = this.deps.blackMarketDemo;
    if (
      configured === undefined ||
      this.modalOpening ||
      this.locked ||
      this.hasModal() ||
      this.activeTown === undefined
    ) return;
    this.modalOpening = true;
    let flow!: BlackMarketDemoFlow;
    try {
      flow = new BlackMarketDemoFlow({
        parent: this.pointRoot,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        displayMode: DISPLAY_MODE,
        backgroundSpriteKey: configured.backgroundSpriteKey,
        imageLoader: configured.imageLoader,
        opener: configured.opener,
        onClose: () => {
          if (this.activeBlackMarketDemo === flow) this.activeBlackMarketDemo = undefined;
        },
      });
      // Claim ownership before awaiting resource construction so destroy() can cancel a flow
      // whose structural sprites are still loading.
      this.activeBlackMarketDemo = flow;
      await flow.mount();
      if (this.lifecycle.disposed) {
        flow.dispose();
        return;
      }
    } finally {
      this.modalOpening = false;
    }
  }

  private async openArena(definition: TownBuildingDefinition): Promise<void> {
    if (this.modalOpening || this.locked || this.hasModal() || this.activeTown === undefined) return;
    this.modalOpening = true;
    try {
      let flow: ArenaFlow | undefined;
      flow = await ArenaFlow.show({
        parent: this.pointRoot,
        owner: this,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        data: this.deps.game.gd,
        profile: this.deps.playerRuntime.profile,
        completedQuests: this.deps.guildQuests?.finishedQuestNames().length ?? 0,
        noLicense: definition.noLicense ?? false,
        tournamentEnabled: this.deps.tournamentEnabled,
        ...(this.deps.onPvp === undefined ? {} : { onPvp: this.deps.onPvp }),
        onClick: () => this.deps.audio.playSfx("click"),
        onBlocked: () => this.deps.audio.playSfx("notAllowed"),
        onClose: () => {
          if (this.activeArena === flow) this.activeArena = undefined;
        },
        onChallenge: (license) => this.startArenaChallenge(license, definition.questGiver),
        onTournament: async () => {
          if (this.lifecycle.disposed || this.activeTown === undefined) return;
          let tournamentFlow: TournamentFlow | undefined;
          tournamentFlow = await TournamentFlow.show({
            parent: this.pointRoot,
            assets: this.deps.game.assets,
            scale9: this.deps.game.scale9,
            strings: this.deps.game.strings,
            ticker: this.deps.stage.app.ticker,
            data: this.deps.game.gd,
            profile: this.deps.playerRuntime.profile,
            deferPresentation: true,
            onClick: () => this.deps.audio.playSfx("click"),
            onBlocked: () => this.deps.audio.playSfx("notAllowed"),
            onStateChanged: () => this.deps.onStateChanged(),
            onBattle: (tournament, round) => this.deps.onTournamentBattle({
              tournament,
              round,
              townName: this.activeTown!.poi.name,
              ...(definition.questGiver === undefined
                ? {}
                : { questGiver: definition.questGiver }),
            }),
            onClaimPrize: (tournament) => this.deps.authority === undefined
              ? this.claimTournamentPrize(tournament)
              : this.deps.onTournamentPrize(tournament),
            roundPortraitFile: this.deps.tournamentRoundPortraitFile,
            // Display only. Every shipped class prize is a `fixed` spawn at the generator's
            // default chance of one, so the result never varies — but `generateTournamentPrize`
            // still draws, and the live quest-reward stream must not be advanced by opening a
            // menu. A disposable per-class stream keeps the row render deterministic instead.
            prizeRewards: (tournament) =>
              generateTournamentPrize(
                tournament,
                mulberry32(tournament.index + 1),
                this.deps.game.gd,
              ),
            // TournamentFlow is a z=910 child of this sortable pointRoot. Mounting the Plot page
            // directly on pointRoot leaves its default-z root behind Tournament's opaque
            // saveSlotBackground for the whole narration; make it a Tournament child instead,
            // matching the source scene-owned GameFlowEvent and restoring its input ownership.
            onFinished: (parent) => this.deps.onTournamentFinished(parent),
            onRequestExit: async (reason) => {
              const closing = tournamentFlow;
              if (closing === undefined) return;
              const exitToTown = this.deps.onTournamentExit;
              if (exitToTown !== undefined) {




                await exitToTown();
                return;
              }
              // No authored town destination to rebuild onto: keep the presentation-only fade.
              await this.runSourceSceneFade(`tournament-${reason}-town`, () => {
                closing.dispose();
              });
            },
            onClose: () => {
              if (this.activeTournament === tournamentFlow) {
                this.activeTournament = undefined;
              }
            },
          });
          if (this.lifecycle.disposed) {
            tournamentFlow.dispose();
            return;
          }
          if (tournamentFlow.destroyed || tournamentFlow.debugState["open"] !== true) return;
          const opened = await this.runSourceSceneFade("arena-tournament", () => {
            this.activeTournament = tournamentFlow;
            tournamentFlow.present();
          });
          if (!opened || this.lifecycle.disposed || this.activeTournament !== tournamentFlow) {
            if (this.activeTournament === tournamentFlow) this.activeTournament = undefined;
            tournamentFlow.dispose();
            return;
          }
          if (await tournamentFlow.presentFinishedPlotIfNeeded()) return;
          if (await this.claimTutorialFlag("TournamentTutorial") === "claimed") {
            await tournamentFlow.showFirstEntryTutorial();
          }
        },
      });
      if (this.lifecycle.disposed) {
        flow.dispose();
        return;
      }
      this.activeArena = flow;





      const greeting = await showGuildQuestChat({
        parent: this.pointRoot,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        ticker: this.deps.stage.app.ticker,
        message: localizedString(this.deps.game.strings, "ArenaChatKey"),
      });
      await greeting.closed;
    } finally {
      this.modalOpening = false;
    }
  }

  private startArenaChallenge(license: LicenseDef, questGiver?: string): void {
    const town = this.activeTown;
    if (this.lifecycle.disposed || this.locked || town === undefined) return;
    // ArenaFlow retires its menu before handing off. Own the exposed town immediately,
    // including the Official command and asset preload, until SceneCoordinator retires us.
    this.locked = true;
    this.dispatchOwnedTransition("arena-license-challenge", town.poi, () => this.deps.onArenaChallenge({
      license,
      townName: town.poi.name,
      ...(questGiver === undefined ? {} : { questGiver }),
    }));
  }

  private async purchaseStoreItem(
    stock: StoreStock,
    quantity: number,
  ): Promise<StorePurchaseResult> {
    if (this.deps.authority !== undefined) {
      const result = await this.deps.authority.submitStore({
        type: "store.purchase",
        stockId: stock.id,
        quantity,
      });
      const event = result.events.find((candidate) =>
        candidate.type === "store.purchased" && candidate.stockId === stock.id);
      if (event === undefined || event.type !== "store.purchased") {
        throw new Error(`official store purchase ${stock.id} omitted its committed result`);
      }
      const receivedItems = Object.freeze(event.receivedItems.map((item) => Object.freeze(
        item.kind === "gem"
          ? { ...item, enabledStats: Object.freeze([...item.enabledStats]) }
          : { ...item },
      )));



      const pendingEggKind = this.deps.authority.egg.pendingEgg()?.kind;
      const purchase = Object.freeze({
        stockId: event.stockId,
        quantity: event.quantity,
        currency: event.currency,
        spent: event.spent,
        balance: event.balance,
        receivedItems,
        ...(pendingEggKind === undefined ? {} : { pendingEggKind }),
      });
      this.mirrorOfficialStorePurchase(stock, purchase);
      return purchase;
    }
    const purchased = purchaseStoreStock(
      this.deps.playerRuntime.profile,
      stock,
      quantity,
      this.deps.questRewardRng,
    );
    this.refreshHeroXp();
    this.deps.onStateChanged();
    return purchased;
  }

  /**
   * Copy a committed Store checkout into the retained renderer aggregate.
   *
   * Online the authority owns the debit; nothing here decides anything. The mirror exists because
   * the Store, the HUD, and — for an Egg — the repeat question all read the local profile, and the
   * player must see the gold they just spent leave. Every value comes from the committed event
   * except the stock-shaped side effects the event does not enumerate.
   */
  private mirrorOfficialStorePurchase(stock: StoreStock, purchase: StorePurchaseResult): void {
    const profile = this.deps.playerRuntime.profile;
    const paid = purchase.currency === "silver"
      ? profile.spendSilver(purchase.spent)
      : profile.spendGold(purchase.spent);
    if (!paid) {
      throw new Error(
        `retained ${purchase.currency} disagrees with the Store purchase the authority committed`,
      );
    }
    for (const item of purchase.receivedItems) {
      if (item.kind === "usable") {
        profile.inventory.addUsable(item.definitionPath, item.instanceName, item.level);
      } else if (item.kind === "gem") {
        profile.inventory.addGem({
          definitionPath: item.definitionPath,
          level: item.level,
          quality: item.quality,
          slot: item.slot,
          enabledStats: item.enabledStats,
        });
      }
    }
    // `purchaseStoreStock` applies these per unit and reports no received item for them. Egg
    // receipt entries above are transient LootPageProvider presentation and require no mirror.
    for (let index = 0; index < purchase.quantity; index += 1) {
      if (stock.kind === "recipe") profile.learnCombineRecipe(stock.combineName);
      else if (stock.kind === "spiritTotem") profile.awardSpiritTotem(stock.shortType);
      else if (stock.kind === "silverExchange") profile.awardSilver(stock.silverAmount);
    }
    this.refreshHeroXp();
    this.deps.onStateChanged();
  }

  private async openInventory(
    type: 0 | 2,
    title: string,
  ): Promise<void> {
    if (this.modalOpening || this.locked || this.hasModal()) return;
    this.modalOpening = true;
    try {
      let handle: InventoryManagementHandle | undefined;
      handle = await showInventoryManagement({
        parent: this.pointRoot,
        owner: this,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        data: this.deps.game.gd,
        profile: this.deps.playerRuntime.profile,
        type,
        title,
        onClick: () => this.deps.audio.playSfx("click"),
        onBlocked: () => this.deps.audio.playSfx("notAllowed"),
        onClose: () => {
          if (this.activeInventory === handle) this.activeInventory = undefined;
        },
        mutate: (action, itemId) => this.mutateInventory(action, itemId),
      });
      if (this.lifecycle.disposed) {
        handle?.requestClose();
        return;
      }
      this.activeInventory = handle;
    } finally {
      this.modalOpening = false;
    }
  }

  private async openCharacterManagement(): Promise<void> {
    if (this.modalOpening || this.locked || this.hasModal() || this.activeTown === undefined) return;
    this.modalOpening = true;
    try {
      let flow: CharacterManagementFlow | undefined;
      flow = await CharacterManagementFlow.show({
        parent: this.pointRoot,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        data: this.deps.game.gd,
        profile: this.deps.playerRuntime.profile,
        onClick: () => this.deps.audio.playSfx("click"),
        onBlocked: () => this.deps.audio.playSfx("notAllowed"),
        onClose: () => {
          if (this.activeCharacterManagement === flow) {
            this.activeCharacterManagement = undefined;
          }
        },
        onFirstGemDisplay: () => this.showFirstGemDisplay(),
        mutateInventory: (action, itemId) => this.mutateInventory(action, itemId),
        mutateSkill: (action, stat) => this.mutateSkill(action, stat),
        isMutationPending: () => this.locked,
      });
      if (this.lifecycle.disposed) {
        flow.dispose();
        return;
      }
      this.activeCharacterManagement = flow;
    } finally {
      this.modalOpening = false;
    }
  }

  private async showFirstGemDisplay(): Promise<void> {
    // Closing either retained menu must not release town input while its first-use
    // flag is still being committed. The mounted tutorial takes modal ownership next.
    this.locked = true;
    try {
      const claimed = await this.claimTutorialFlag("FirstCharacterDisplay");
      if (claimed !== "claimed" || this.lifecycle.disposed) return;
      await showMonsterHatchPopup({
        parent: this.pointRoot,
        owner: this,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        ticker: this.deps.stage.app.ticker,
        zIndex: 1200,
        sfx: {
          onButtonPress: () => this.deps.audio.playSfx("click"),
          onButtonBlocked: () => this.deps.audio.playSfx("notAllowed"),
        },
      }, {
        title: localizedString(
          this.deps.game.strings,
          "FirstCharacterDisplayTitleKey",
        ),
        content: buildMonsterHatchMessageBlock(localizedString(
          this.deps.game.strings,
          "FirstCharacterDisplayMessageKey",
        )).root,
        buttons: [{
          label: localizedString(this.deps.game.strings, "OkButtonKey"),
          onPress: () => undefined,
        }],
      });
    } finally {
      this.locked = false;
    }
  }

  private async mutateInventory(
    action: "drop" | "equip" | "unequip",
    itemId: InventoryItemId,
  ): Promise<void> {
    const command = action === "drop"
      ? { type: "player.dropInventoryItem" as const, itemId }
      : action === "equip"
        ? { type: "player.equipGem" as const, itemId }
        : { type: "player.unequipGem" as const, itemId };
    this.locked = true;
    try {
      await this.deps.authority?.submitPlayer(command);
      if (action === "drop") this.deps.playerRuntime.profile.inventory.drop(itemId);
      // Equipping runs through the runtime so the party's permanent buff children are rebuilt and
      // healed with the new Gem, exactly as `-[InventoryPageProvider equipItem:]` does.
      else if (action === "equip") this.deps.playerRuntime.equipGem(itemId);
      else this.deps.playerRuntime.profile.unequipGem(itemId);
      this.deps.onStateChanged();
    } finally {
      this.locked = false;
    }
  }

  private async mutateSkill(
    action: "increment" | "decrement",
    stat: PlayerStatName,
  ): Promise<void> {
    // The Skills child can close during a slow response. Keep its retained menu and the town
    // from starting another command until the allocation has settled.
    this.locked = true;
    try {
      await this.deps.authority?.submitPlayer({
        type: action === "increment" ? "player.incrementSkill" : "player.decrementSkill",
        stat,
      });
      // Through the runtime: a changed allocation rebuilds the party's hero-skill buff children
      // and heals to the new MaxHP (`-[CharacterSkillsNode finished:]`'s full restore).
      const changed = this.deps.playerRuntime.mutateSkill(action, stat);
      if (!changed) throw new Error(`Character skill ${action} rejected for ${stat}`);
      this.deps.onStateChanged();
    } finally {
      this.locked = false;
    }
  }

  private async openTownMonsterManagement(): Promise<void> {
    if (this.modalOpening || this.locked || this.hasModal() || this.activeTown === undefined) return;
    this.modalOpening = true;
    try {
      await this.showPartyEditor(0);
    } finally {
      this.modalOpening = false;
    }
  }

  private async openTownGuild(definition: TownBuildingDefinition): Promise<void> {
    if (
      this.modalOpening ||
      this.locked ||
      this.hasModal() ||
      this.activeTown === undefined ||
      !this.townBuildingIsEnabled(definition)
    ) {
      return;
    }
    const runtime = this.deps.guildQuests;
    const backgroundKey = this.deps.guildTavernBackgroundSpriteKey;
    if (
      runtime === undefined ||
      definition.questGiver === undefined ||
      backgroundKey === undefined
    ) {
      throw new Error("TavernMenuItem presentation capability is incomplete");
    }
    this.modalOpening = true;
    try {
      let flow: GuildQuestFlow | undefined;
      flow = await GuildQuestFlow.showTavern({
        parent: this.pointRoot,
        game: this.deps.game,
        audio: this.deps.audio,
        ticker: this.deps.stage.app.ticker,
        runtime,
        townName: this.activeTown.poi.name,
        questGiver: definition.questGiver,
        tavernBackgroundSpriteKey: backgroundKey,
        ...(this.deps.authority === undefined
          ? {}
          : {
              onAcceptQuest: async (quest: QuestDefinition) => {
                await this.deps.authority!.submitQuest({
                  type: "quest.accept",
                  questId: quest.name,
                });
              },
              onDropAllQuests: async () => {
                await this.deps.authority!.submitQuest({ type: "quest.dropAll" });
              },
              onClaimQuest: async (quest: QuestDefinition) => {
                const result = await this.deps.authority!.submitQuest({
                  type: "quest.claim",
                  questId: quest.name,
                });
                const reward = result.events.find((event) =>
                  event.type === "quest.rewardClaimed" && event.questId === quest.name);
                if (reward === undefined || reward.type !== "quest.rewardClaimed") {
                  throw new Error(`official quest ${quest.name} omitted its committed rewards`);
                }
                const joinedIds = result.events.flatMap((event) =>
                  event.type === "player.monsterAdded" && event.reason === "reward"
                    ? [event.instanceId]
                    : []);
                return (onPresented: () => void) => this.presentQuestRewards(quest, reward.rewards, joinedIds, onPresented);
              },
            }),
        onClaimReward: (quest, onPresented) => this.presentQuestRewards(quest, undefined, [], onPresented),
        ...(this.deps.beginLocalRewardCheckpoint === undefined ? {} : {
          beginRewardCheckpoint: this.deps.beginLocalRewardCheckpoint,
        }),
        onStateChanged: () => this.deps.onStateChanged(),
        onClose: () => {
          if (this.activeGuildQuests === flow) this.activeGuildQuests = undefined;
        },
      });
      if (this.lifecycle.disposed) {
        flow.dispose();
        return;
      }
      this.activeGuildQuests = flow;
    } finally {
      this.modalOpening = false;
    }
  }

  private async openGuildQuestList(): Promise<void> {
    if (this.activeGuildQuests !== undefined || !this.guildQuestListAvailable()) return;
    const runtime = this.deps.guildQuests;
    if (runtime === undefined) throw new Error("QuestsMenuItem has no Guild quest runtime");
    let flow: GuildQuestFlow | undefined;
    flow = await GuildQuestFlow.showQuestList({
      parent: this.pointRoot,
      game: this.deps.game,
      audio: this.deps.audio,
      ticker: this.deps.stage.app.ticker,
      runtime,
      onClaimReward: (quest, onPresented) => this.presentQuestRewards(quest, undefined, [], onPresented),
      onStateChanged: () => this.deps.onStateChanged(),
      onClose: () => {
        if (this.activeGuildQuests === flow) this.activeGuildQuests = undefined;
      },
    });
    if (this.lifecycle.disposed) {
      flow.dispose();
      return;
    }
    this.activeGuildQuests = flow;
  }

  private async presentQuestRewards(
    quest: QuestDefinition,
    committedRewards?: readonly PlayerReward[],
    committedMonsterIds: readonly string[] = [],
    onPresented?: () => void,
  ): Promise<void> {
    const rewards = committedRewards ?? generateQuestRewards(
      parseDungeonTreasureData(
        quest.treasureData,
        `Quests.plist.${quest.name}.treasureData`,
        1,
        this.deps.game.gd,
      ),
      quest.challengeLevel,
      this.deps.questRewardRng,
    );
    if (rewards.length === 0) { onPresented?.(); return; }
    let joinedIndex = 0;
    await showDungeonLootManagement({
      parent: this.pointRoot,
      owner: this,
      game: this.deps.game,
      audio: this.deps.audio,
      ticker: this.deps.stage.app.ticker,
    }, rewards, async (remaining) => {



      for (const reward of remaining) {
        if (reward.kind === "egg" || reward.kind === "monsterEgg" || reward.kind === "repeatEgg") {
          await this.showEggHatch(
            reward.kind === "monsterEgg" ? "gold" : "silver",
            reward.kind === "repeatEgg" ? { repeatPicks: reward.numRepeats } : {},
          );
        } else {
          applyPlayerRewards(this.deps.playerRuntime.profile, [reward], {
            addMonsterJoin: (shortType, jobLevel) => {
              const joined = this.deps.playerRuntime.addJoinedMonster(
                committedMonsterIds[joinedIndex++] ??
                  `quest-reward-${++this.questRewardSerial}-${shortType}`,
                shortType,
                jobLevel,
              );
              return { instanceId: joined.instanceId };
            },
          });
          this.refreshHeroXp();
          this.deps.onStateChanged();
        }
      }
    }, onPresented);
  }

  private async claimTournamentPrize(
    tournament: import("@dib/gamedata/browser").TournamentDef,
  ): Promise<void> {
    const rewards = generateTournamentPrize(
      tournament,
      this.deps.questRewardRng,
      this.deps.game.gd,
    );
    // Native `doAction:` marks the prize claimed immediately after presenting the loot provider.
    // Advance the durable class before its asynchronous item presentations begin.
    this.deps.playerRuntime.profile.tournament.claimPrize();
    this.deps.onStateChanged();
    if (rewards.length === 0) return;
    await showDungeonLootManagement({
      parent: this.pointRoot,
      owner: this,
      game: this.deps.game,
      audio: this.deps.audio,
      ticker: this.deps.stage.app.ticker,
    }, rewards, async (remaining) => {
      for (const reward of remaining) {
        if (reward.kind === "egg" || reward.kind === "monsterEgg" || reward.kind === "repeatEgg") {
          await this.showEggHatch(
            reward.kind === "monsterEgg" ? "gold" : "silver",
            reward.kind === "repeatEgg" ? { repeatPicks: reward.numRepeats } : {},
          );
        } else {
          applyPlayerRewards(this.deps.playerRuntime.profile, [reward], {
            addMonsterJoin: (shortType, jobLevel) => {
              const joined = this.deps.playerRuntime.addJoinedMonster(
                `tournament-prize-${++this.questRewardSerial}-${shortType}`,
                shortType,
                jobLevel,
              );
              return { instanceId: joined.instanceId };
            },
          });
          this.deps.onStateChanged();
        }
      }
    });
  }

  private async showEggHatch(
    kind: "silver" | "gold",
    options: {
      readonly allowSecondSpin?: boolean;
      readonly repeatPicks?: number;
    } = {},
  ): Promise<void> {
    if (this.activeEggHatch !== undefined) {
      throw new Error("WorldNode: an egg hatch flow is already active");
    }


    const authority = this.deps.authority;
    const pending = authority?.egg.pendingEgg();
    if (authority !== undefined && pending === undefined) {
      throw new Error(`official ${kind} Egg left no pending hatch continuation`);
    }
    let flow: EggHatchFlow | undefined;
    flow = await EggHatchFlow.show({
      parent: this.pointRoot,
      owner: this,
      game: this.deps.game,
      audio: this.deps.audio,
      ticker: this.deps.stage.app.ticker,
      player: this.deps.playerRuntime,
      ...(authority === undefined
        ? { rng: this.deps.questRewardRng }
        : { session: createOfficialEggHatchSession(authority.egg) }),
      ...(authority !== undefined || this.deps.fidelityFoundationOrder === undefined
        ? {}
        : { foundationDictionaryOrder: this.deps.fidelityFoundationOrder }),
      kind: pending?.kind ?? kind,
      ...(options.allowSecondSpin === undefined
        ? {}
        : { allowSecondSpin: options.allowSecondSpin }),
      ...(options.repeatPicks === undefined ? {} : { repeatPicks: options.repeatPicks }),
      nextMonsterInstanceId: (shortType) =>
        `egg-hatch-${++this.questRewardSerial}-${shortType}`,
      onStateChanged: () => this.deps.onStateChanged(),
      openGoldStore: () => this.deps.openGoldStore(
        this.pointRoot,
        this,
        this.deps.playerRuntime,
        this.deps.onStateChanged,
      ),
      onClose: () => {
        if (this.activeEggHatch === flow) this.activeEggHatch = undefined;
      },
    });
    if (this.lifecycle.disposed) {
      flow.dispose();
      return;
    }
    this.activeEggHatch = flow;
    await flow.finished;
  }

  /** Deterministic opt-in browser choreography seam. Production reward paths still enter only
   * through destroy-on-pickup quest/battle/dungeon settlement. */
  presentEggHatchForBrowserTest(
    kind: "silver" | "gold",
    options: { readonly repeatPicks?: number } = {},
  ): Promise<void> {
    return this.showEggHatch(kind, options);
  }

  presentInventoryForBrowserTest(): Promise<void> {
    return this.openInventory(2, localizedString(this.deps.game.strings, "ItemsInfoTitleKey"));
  }

  presentCharacterForBrowserTest(): Promise<void> {
    return this.openCharacterManagement();
  }

  presentStoreForBrowserTest(): Promise<void> {
    return this.openStore();
  }

  async presentArenaForBrowserTest(): Promise<void> {
    // Scenario storage can request an immediate arena launch while the initial town zoom/chat
    // still owns the modal slot. A normal building tap simply cannot happen in that interval;
    // this deterministic browser seam must retain its one-shot request until the same slot is
    // reachable instead of silently dropping it through openArena's input guard.
    for (let step = 0; step < 2_400; step++) {
      if (this.lifecycle.disposed) return;
      if (!this.modalOpening && !this.locked && !this.hasModal() && this.activeTown !== undefined) {
        break;
      }
      await tween(this.deps.stage.app.ticker, 25, () => undefined);
    }
    if (this.lifecycle.disposed) return;
    if (this.modalOpening || this.locked || this.hasModal() || this.activeTown === undefined) {
      throw new Error("WorldNode: browser arena seam never reached an unlocked town modal slot");
    }
    return this.openArena({
      sourceIndex: -1,
      className: "ArenaMenuItem",
      position: { x: 0, y: 0 },
      spriteFile: "arena.png",
      questGiver: "KingMan.png",
      noLicense: false,
      fake: false,
      hasConditions: false,
    });
  }

  presentTownWarpForBrowserTest(): Promise<void> {
    return this.openTownWarp();
  }

  /** Migration-only recovery for saves written by the earlier port, which incorrectly serialized
   * standard destroy-on-pickup eggs. Remove the exact loose object before presenting it, matching
   * Player.addItem:'s native destruction boundary and preventing reload duplication. */
  private async drainLegacyStoredEggs(): Promise<void> {
    for (const [instanceName, kind] of [
      ["Egg", "silver"],
      ["MonsterEgg", "gold"],
    ] as const) {
      while (this.deps.playerRuntime.profile.itemCount(instanceName) > 0) {
        const removed =
          this.deps.playerRuntime.profile.inventory.removeFirstLooseByInstanceName(instanceName);
        if (removed?.kind !== "egg") {
          throw new Error(`WorldNode: stored ${instanceName} migration did not remove an Egg`);
        }
        this.deps.onStateChanged();
        await this.showEggHatch(kind);
      }
    }
  }

  private async showPartyEditor(style: 0 | 1): Promise<void> {
    let editor: PartyEditorFlow | undefined;
    const underlayEventMode = this.scene.eventMode ?? "static";
    let underlayRestored = false;
    const restoreUnderlay = (): void => {
      if (underlayRestored) return;
      underlayRestored = true;
      if (!this.scene.destroyed) this.scene.eventMode = underlayEventMode;
    };
    // Party Editor is a full-screen modal sibling of `scene`. Disabling the underlay makes its
    // visible controls own Pixi hit testing instead of merely rejecting world actions afterward.
    this.scene.eventMode = "none";
    try {
      editor = await PartyEditorFlow.show({
        parent: this.pointRoot,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        gd: this.deps.game.gd,
        party: this.deps.party,
        style,
        signal: this.lifecycle.signal,
        nativePointerBridge: {
          canvas: this.deps.stage.app.canvas,
          toRendererPoint: (event) => {
            const stagePoint = this.deps.stage.toStage(event.clientX, event.clientY);
            return this.deps.stage.root.toGlobal(stagePoint);
          },
        },
        ...(this.deps.onQuestEvent === undefined ? {} : { onQuestEvent: this.deps.onQuestEvent }),
        hasCapturedSimpleType: (shortType) =>
          this.deps.playerRuntime.profile.highestRegisteredLevel(shortType) > 0,
        healInjury: async (instanceId, nowSeconds) => {
          const authoritative = await this.deps.authority?.submitParty({
            type: "party.healInjury",
            instanceId,
          });
          if (authoritative !== undefined) {
            const healed = authoritative.events.find(
              (event) => event.type === "party.injuryHealed" && event.instanceId === instanceId,
            );
            if (healed === undefined || healed.type !== "party.injuryHealed") {
              throw new Error("official injury response omitted its committed price");
            }
            const currency = authoritative.events.find(
              (event) => event.type === "player.currencyChanged" && event.currency === "gold",
            );
            if (currency === undefined || currency.type !== "player.currencyChanged") {
              throw new Error("official injury response omitted its committed gold balance");
            }
            return this.deps.playerRuntime.healPartyMonsterAtCost(
              instanceId,
              healed.goldCost,
              currency.balance,
            );
          }
          return this.deps.playerRuntime.healPartyMonster(instanceId, nowSeconds);
        },
        ...(this.deps.authority === undefined
          ? {}
          : {
              submitAuthoritative: async (command) =>
                await this.deps.authority!.submitParty(command),
            }),
        onStateChanged: () => this.deps.onStateChanged(),
        onClose: () => {
          restoreUnderlay();
          if (this.activePartyEditor === editor) {
            this.activePartyEditor = undefined;
            editor?.dispose();
          }
        },
        playSfx: (key) => this.deps.audio.playSfx(key),
      });
    } catch (error) {
      restoreUnderlay();
      throw error;
    }
    if (editor === undefined || this.lifecycle.disposed) {
      restoreUnderlay();
      editor?.dispose();
      return;
    }
    this.activePartyEditor = editor;
    const tutorial = sourceTutorialTopic(this.deps.game.sourceTutorialTopics, "Tutorial4");
    if (
      partyManagementShowsFirstUseTutorial(style) &&
      hasSourceTutorialTopicSurface(this.deps.game, tutorial)
    ) {
      editor.setInputEnabled(false);
      try {
        await this.presentIntroTutorial(tutorial.key, tutorial.images);
        await this.activePlotTutorial?.done;
      } finally {
        editor.setInputEnabled(true);
      }
    }
  }

  private async openTownMonsterpedia(editable: boolean): Promise<void> {
    if (this.modalOpening || this.locked || this.hasModal() || this.activeTown === undefined) return;
    this.modalOpening = true;
    try {
      await this.openMonsterpedia(editable, "town-building-monsterpedia");
    } finally {
      this.modalOpening = false;
    }
  }

  private async openMonsterpedia(editable: boolean, route: string): Promise<void> {
    if (this.activeMonsterpedia !== undefined) return;
    let flow: MonsterpediaFlow | undefined;
    flow = await MonsterpediaFlow.show({
      parent: this.pointRoot,
      assets: this.deps.game.assets,
      scale9: this.deps.game.scale9,
      strings: this.deps.game.strings,
      ticker: this.deps.stage.app.ticker,
      renderer: this.deps.stage.app.renderer,
      gd: this.deps.game.gd,
      profile: this.deps.playerRuntime.profile,


      partyMembers: () => this.deps.party.monsters().map((member) => ({
        ...member,
        playerBuffs: this.deps.party.playerBuffsOf(member.instanceId),
      })),
      editable,
      deferPresentation: true,
      signal: this.lifecycle.signal,
      showCategoryName: (text) => {
        this.showNamePlate(text, "monsterpediaCategoryNamePlate");
      },
      combineMonsters: async ({
        resultShortType,
        firstIngredientId,
        secondIngredientId,
      }) => {
        const authoritativeResult = await this.deps.authority?.submitParty({
          type: "party.combine",
          resultTypeId: resultShortType,
          firstInstanceId: firstIngredientId,
          secondInstanceId: secondIngredientId,
        });
        const authoritativeAddedEvent = authoritativeResult?.events.find(
          (event) => event.type === "player.monsterAdded" && event.reason === "combine",
        );
        const authoritativeInstanceId =
          authoritativeAddedEvent?.type === "player.monsterAdded" &&
          authoritativeAddedEvent.reason === "combine"
            ? authoritativeAddedEvent.instanceId
            : undefined;
        this.deps.playerRuntime.combineMonsters(
          authoritativeInstanceId ?? this.nextCombineInstanceId(resultShortType),
          resultShortType,
          firstIngredientId,
          secondIngredientId,
        );
        this.refreshHeroXp();
      },
      ...(this.deps.authority === undefined
        ? {}
        : {
            claimTutorialFlag: async (flag: string) => {
              await this.deps.authority!.claimTutorialFlag(flag);
            },
          }),
      onClose: async () => {
        const closing = flow;
        if (closing === undefined || this.activeMonsterpedia !== closing) return;
        await this.runSourceSceneFade(`${route}-return`, () => {
          if (this.activeMonsterpedia === closing) this.activeMonsterpedia = undefined;
          closing.dispose();
          this.refreshHeroXp();
        });
      },
      playSfx: (key) => this.deps.audio.playSfx(key),
    });
    if (flow === undefined || this.lifecycle.disposed) {
      flow?.dispose();
      return;
    }
    const opened = await this.runSourceSceneFade(route, () => {
      if (this.lifecycle.disposed) return;
      this.activeMonsterpedia = flow;
      flow.present();
    });
    if (!opened || this.lifecycle.disposed || this.activeMonsterpedia !== flow) {
      if (this.activeMonsterpedia === flow) this.activeMonsterpedia = undefined;
      flow.dispose();
    }
  }

  private runSourceSceneFade(
    route: string,
    onMidpoint: () => void | Promise<void>,
  ): Promise<boolean> {
    const screen = worldMapSizePt(DISPLAY_MODE);
    return runSourceBlackSceneFade({
      parent: this.pointRoot,
      ticker: this.deps.stage.app.ticker,
      width: screen.w,
      height: screen.h,
      route,
      onMidpoint,
      signal: this.lifecycle.signal,
      onState: (state) => { this.sourceSceneFade = state; },
    });
  }

  private openCollection(collectionType: string): void {
    if (this.activeCollection !== undefined || this.modalOpening || this.lifecycle.disposed) return;
    const adapter = this.deps.collection;
    if (adapter === undefined) {
      throw new Error(
        `WorldNode: Collection type ${collectionType} requires a live Collection adapter`,
      );
    }
    const presentation = new PixiCollectionFlowPresentation({
      parent: this.pointRoot,
      assets: this.deps.game.assets,
      scale9: this.deps.game.scale9,
      strings: this.deps.game.strings,
      ticker: this.deps.stage.app.ticker,
      onClick: () => this.deps.audio.playSfx("click"),
      onBlocked: () => this.deps.audio.playSfx("notAllowed"),
      presentRewards: async (rewards, owner) => {
        await showDungeonLootManagement({
          parent: this.pointRoot,
          owner,
          game: this.deps.game,
          audio: this.deps.audio,
          ticker: this.deps.stage.app.ticker,
        }, rewards, () => undefined);
        // Collection claims mutate the retained profile before committed loot is presented. Keep
        // the already-mounted world chrome in sync when that modal hands control back.
        this.refreshHeroXp();
      },
    });
    let flow!: CollectionFlow;
    flow = new CollectionFlow({
      catalog: this.deps.game.collectionCatalog,
      strings: this.deps.game.strings,
      // Online the adapter carries the authority-backed claim owner; offline the world's own
      // player aggregate is it.
      runtime: adapter.runtime ?? this.deps.playerRuntime,
      rng: this.deps.questRewardRng,
      allocateMonsterInstanceId: adapter.allocateMonsterInstanceId,
      requestChatPresentation: adapter.requestChatPresentation,
      hatchEgg: (kind, options) => this.showEggHatch(kind, options),
      presentation,
      onClose: () => {
        if (this.activeCollection === flow) this.activeCollection = undefined;
        this.modalOpening = false;
      },
    });
    this.activeCollection = flow;
    this.modalOpening = true;
    void flow.show(collectionType).then(() => {
      if (this.activeCollection === flow) this.modalOpening = false;
    }).catch((error: unknown) => {
      if (this.activeCollection === flow) this.activeCollection = undefined;
      this.modalOpening = false;
      flow.dispose();
      queueMicrotask(() => { throw error; });
    });
  }

  private overlayDebugState(popups: PopupHost["debugState"]): unknown {
    const collection = this.activeCollection?.debugState;
    if (collection !== undefined) {
      return {
        ...collection,
        popupHost: {
          depth: popups.depth,
          stack: popups.stack.map((popup) => ({
            ...popup,
            buttons: [...popup.buttons],
          })),
        },
      };
    }
    return this.activeBigMap?.debugState ??
      this.activePartyEditor?.debugState ??
      this.activeMonsterpedia?.debugState ??
      this.activeOptions?.debugState() ??
      this.activeHighscores?.debugState() ??
      this.activeTutorialMenu?.debugState ??
      this.activeEggHatch?.debugState ??
      this.activeGuildQuests?.debugState ??
      this.activeInventory?.debugState ??
      this.activeCharacterManagement?.debugState ??
      this.activeStore?.debugState ??
      this.activeBlackMarketDemo?.debugState ??
      this.activeArena?.debugState ??
      this.activeTownWarp?.debugState ??
      this.activeTournament?.debugState ??
      (popups.depth === 0 ? undefined : { kind: "popup", popups }) ??
      (this.activeTownWarpDisabledChat
        ? { kind: "guildQuestChat", chatName: "TownPortalsDisabledChatKey" }
        : undefined) ??
      (this.activeTownEnterChatName === undefined
        ? null
        : { kind: "townEnterChat", chatName: this.activeTownEnterChatName });
  }

  private deferredTownEntryNotifications: (() => void) | undefined;

  private scheduleTownEntryNotifications(present: () => void): void {
    // Reload may rebuild the town underneath an authoritative Egg continuation. Its phase
    // admits only Egg commands, including before the external hatch UI has mounted.
    if (this.deps.authority?.egg.pendingEgg() !== undefined) {
      this.deferredTownEntryNotifications = present;
    } else {
      present();
    }
  }

  private flushDeferredTownEntryNotifications(): void {
    if (this.deferredTownEntryNotifications === undefined || this.lifecycle.disposed ||
      this.locked || this.modalOpening || this.hasModal()) return;
    const present = this.deferredTownEntryNotifications;
    this.deferredTownEntryNotifications = undefined;
    present();
  }

  private hasModal(): boolean {
    return this.tutorialClaims.size > 0 ||
      this.deps.authority?.egg.pendingEgg() !== undefined ||
      this.sourceSceneFade !== undefined ||
      this.activeBigMap !== undefined ||
      this.activePartyEditor !== undefined ||
      this.activeMonsterpedia !== undefined ||
      this.activeCollection !== undefined ||
      this.activeOptions !== undefined ||
      this.activeHighscores !== undefined ||
      this.activeTutorialMenu !== undefined ||
      this.activeGuildQuests !== undefined ||
      this.activeEggHatch !== undefined ||
      this.activeInventory !== undefined ||
      this.activeCharacterManagement !== undefined ||
      this.activeStore !== undefined ||
      this.activeBlackMarketDemo !== undefined ||
      this.activeArena !== undefined ||
      this.activeTownWarp !== undefined ||
      this.activeTournament !== undefined ||
      this.townEnterChatOpening ||
      this.activeTownEnterChat !== undefined ||
      this.activePlotTutorial !== undefined;
  }

  private startTownTutorialFlash(town: TownPoiDisplay): void {
    this.stopTownFlash();
    const profile = this.deps.playerRuntime.profile;
    let key: string | null = "flashTownExit";
    let target: "exit" | number = "exit";
    let parent = town.exit;
    let sprite = town.exitFlashTarget;
    if (profile.hasTutorialFlag(key)) {



      const building = town.buildings.find(({ definition, flashTarget }) =>
        definition.tutorialFlashKey !== undefined &&
        flashTarget !== undefined &&
        this.townBuildingIsEnabled(definition) &&
        !profile.hasTutorialFlag(definition.tutorialFlashKey));
      if (building?.definition.tutorialFlashKey !== undefined && building.flashTarget !== undefined) {
        key = building.definition.tutorialFlashKey;
        target = building.definition.sourceIndex;
        parent = building.menuRoot!;
        sprite = building.flashTarget;
      } else {


        const tavern = this.deps.guildQuests?.completedActiveQuestNames().length
          ? town.buildings.find(({ definition, flashTarget }) =>
              definition.className === "TavernMenuItem" &&
              flashTarget !== undefined &&
              this.townBuildingIsEnabled(definition))
          : undefined;
        if (tavern?.flashTarget === undefined) return;
        key = null;
        target = tavern.definition.sourceIndex;
        parent = tavern.menuRoot!;
        sprite = tavern.flashTarget;
      }
    }
    const overlay = new SourceFlashingSprite(
      parent,
      sprite,
      this.deps.stage.app.ticker,
      1_000,
    );
    overlay.start();
    this.townFlash = { key, target, overlay };
  }

  private stopTownFlash(): void {
    this.townFlash?.overlay.destroy();
    this.townFlash = undefined;
  }

  private async activateTownBuilding(definition: TownBuildingDefinition): Promise<void> {
    if (this.townFlash?.target === definition.sourceIndex) {
      if (
        this.townFlash.key !== null &&
        await this.claimTutorialFlag(this.townFlash.key) === "failed"
      ) return;
      this.stopTownFlash();
    }
    this.deps.audio.playSfx("click");
    if (definition.className === "MonsterManagementMenuItem") {
      await this.openTownMonsterManagement();
    } else if (definition.className === "MonsterpediaMenuItem") {
      // `MonsterpediaMenuItem.activate:` always presents the town-owned editable book.
      await this.openTownMonsterpedia(true);
    } else if (definition.className === "TavernMenuItem") {
      await this.openTownGuild(definition);
    } else if (definition.className === "CharacterDisplayMenuItem") {
      await this.openCharacterManagement();
    } else if (definition.className === "StoreMenuItem") {
      await this.openStore();
    } else if (definition.className === "BlackMarketMenuItem") {
      await this.openBlackMarket();
    } else if (definition.className === "ArenaMenuItem") {
      await this.openArena(definition);
    } else if (definition.className === "TownWarpMenuItem") {
      await this.openTownWarp();
    }
  }

  private async activateTownExit(): Promise<void> {
    if (await this.claimTutorialFlag("flashTownExit") === "failed") return;
    this.stopTownFlash();
    this.deps.audio.playSfx("click");
    await this.leaveTown();
  }

  private async claimTutorialFlag(
    flag: string,
  ): Promise<"claimed" | "existing" | "failed"> {
    if (this.deps.playerRuntime.profile.hasTutorialFlag(flag)) return "existing";
    const existing = this.tutorialClaims.get(flag);
    if (existing !== undefined) return await existing;
    const pending = (async (): Promise<"claimed" | "existing" | "failed"> => {
      try {
        await this.deps.authority?.claimTutorialFlag(flag);
        if (!this.deps.playerRuntime.profile.claimTutorialFlag(flag)) return "existing";
        this.deps.onStateChanged();
        return "claimed";
      } catch (error) {
        this.deps.audio.playSfx("notAllowed");
        this.transitionFailure = {
          route: `claim tutorial ${flag}`,
          message: error instanceof Error ? error.message : String(error),
        };
        return "failed";
      }
    })();
    this.tutorialClaims.set(flag, pending);
    try {
      return await pending;
    } finally {
      if (this.tutorialClaims.get(flag) === pending) this.tutorialClaims.delete(flag);
    }
  }

  /**
   * Source `POINode` calls the zero-delay `showTutorialForFlag:` before notifying the POI
   * completed. Local simulation claims synchronously here so the common arrival checkpoint below
   * persists the tutorial flag and POI completion together. Official play must first commit the
   * separate typed tutorial command; its projection is then mirrored by the shared claim helper.
   */
  private presentReplayBattleTutorial(): void {
    if (
      this.lifecycle.disposed ||
      this.modalOpening ||
      this.deps.playerRuntime.profile.hasTutorialFlag(REPLAY_BATTLE_TUTORIAL_FLAG)
    ) return;

    // Arrival has completed, but its first-use tutorial still owns the next input. Keep
    // navigation/menu actions out through both the authority claim and async popup mounting.
    this.modalOpening = true;
    void (async () => {
      try {
        const claimed = this.deps.authority === undefined
          ? this.deps.playerRuntime.profile.claimTutorialFlag(REPLAY_BATTLE_TUTORIAL_FLAG)
          : await this.claimTutorialFlag(REPLAY_BATTLE_TUTORIAL_FLAG) === "claimed";
        if (claimed) await this.mountReplayBattleTutorial();
      } finally {
        this.modalOpening = false;
      }
    })().catch((error: unknown) => {
      if (!this.lifecycle.disposed) queueMicrotask(() => { throw error; });
    });
  }

  private async mountReplayBattleTutorial(): Promise<void> {
    if (this.lifecycle.disposed) return;
    await showReplayBattleTutorial({
      parent: this.pointRoot,
      owner: this,
      assets: this.deps.game.assets,
      scale9: this.deps.game.scale9,
      ticker: this.deps.stage.app.ticker,
      sfx: {
        onButtonPress: () => this.deps.audio.playSfx("click"),
        onButtonBlocked: () => this.deps.audio.playSfx("notAllowed"),
      },
    }, this.deps.game.strings);
  }

  private async presentIntroTutorial(key: string, images: readonly string[]): Promise<void> {
    if (
      this.lifecycle.disposed ||
      this.activePlotTutorial !== undefined ||
      images.some((image) => !this.deps.game.assets.hasSprite(image.replace(/\.png$/i, ""))) ||
      this.deps.playerRuntime.profile.hasTutorialFlag(key)
    ) {
      return;
    }
    const claim = await this.claimTutorialFlag(key);
    if (
      this.lifecycle.disposed ||
      this.activePlotTutorial !== undefined ||
      claim !== "claimed"
    ) return;
    const handle = await showPlotTutorial({
      parent: this.pointRoot,
      owner: this,
      assets: this.deps.game.assets,
      scale9: this.deps.game.scale9,
      strings: this.deps.game.strings,
      ticker: this.deps.stage.app.ticker,
      keyboard: this.deps.keyboard,
      key,
      images,
      onClick: () => this.deps.audio.playSfx("click"),
      onStateChanged: (state) => {
        this.plotTutorialState = state;
      },
    });
    if (this.lifecycle.disposed) {
      handle.dismiss();
      return;
    }
    this.activePlotTutorial = handle;
    void handle.done.then(() => {
      if (this.activePlotTutorial === handle) this.activePlotTutorial = undefined;
    });
  }

  private async presentTownEnterChat(entries: readonly TownEnterChatDefinition[]): Promise<void> {
    const runtime = this.deps.guildQuests;
    if (runtime === undefined || entries.length === 0 || this.lifecycle.disposed) return;

    const chat = this.deps.authority === undefined
      ? selectTownEnterChat(entries, runtime)
      : nextTownEnterChat(entries, runtime);
    if (chat === undefined) return;
    this.townEnterChatOpening = true;
    this.activeTownEnterChatName = chat.name;
    this.deps.onStateChanged();
    try {
      if (this.deps.authority !== undefined) {
        await this.deps.authority.claimDialog(chat.name);
      }
      await this.presentTownChatDefinition(chat);
    } finally {
      this.townEnterChatOpening = false;
      this.activeTownEnterChat = undefined;
      this.activeTownEnterChatName = undefined;
      if (!this.lifecycle.disposed) {
        if (this.activeTown !== undefined) {
          this.refreshTownBuildingInteractivity(this.activeTown.display);
        }
        this.deps.onStateChanged();
      }
    }
  }

  private async presentTownChatDefinition(chat: ChatDefinition): Promise<void> {
    const keys = chat.messageKeys.length === 0 ? [`${chat.name}ChatKey`] : chat.messageKeys;
    for (const key of keys) {
      if (this.lifecycle.disposed || this.activeTown === undefined) return;
      this.townEnterChatOpening = true;
      let handle: GuildQuestChatHandle | undefined;
      handle = await showGuildQuestChat({
        parent: this.pointRoot,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        ticker: this.deps.stage.app.ticker,
        message: localizedString(this.deps.game.strings, key),
        ...(chat.imageFile === undefined ? {} : { portraitFile: chat.imageFile }),
        onDismiss: () => {
          if (this.activeTownEnterChat === handle) this.activeTownEnterChat = undefined;
        },
      });
      if (this.lifecycle.disposed) {
        handle.dismiss(true);
        return;
      }
      this.townEnterChatOpening = false;
      this.activeTownEnterChat = handle;
      await handle.closed;
    }
  }

  private guildQuestListAvailable(): boolean {
    return guildQuestListAvailable(this.deps.game.assets, this.deps.guildQuests);
  }

  private sourceConditionContext(): SourceConditionContext {
    const quests = this.deps.guildQuests;
    return {
      hasSeenChat: (name) => quests?.hasSeenDialog(name) ?? false,
      hasCompletedBattle: (name) => quests?.hasCompletedFixedEncounter(name) ?? false,
      hasCompletedQuest: (name) => quests?.hasFinishedQuest(name) ?? false,
      canUseQuest: (name) => quests?.canUseQuestKey(name) ?? false,
      hasCompletedPoi: (name) => this.deps.refreshState.everCompletedPois.has(name),
      // `UserSavedData.iapMade` is zero in this resource-package port: neither local saves nor the
      // command service expose the retired App Store purchase channel.
      goldPurchased: 0,
    };
  }

  private async openTownWarp(): Promise<void> {
    const configured = this.deps.townWarp;
    const town = this.activeTown?.poi.name;
    if (
      configured === undefined ||
      town === undefined ||
      this.modalOpening ||
      this.locked ||
      this.hasModal()
    ) return;
    this.modalOpening = true;
    try {
      const current = configured.destinations.find(({ townName }) => townName === town);
      if (current === undefined) {
        throw new Error(`TownWarp registry has no entry for current town ${town}`);
      }
      const conditions = this.sourceConditionContext();
      if (!sourceConditionsAreMet(current.portalConditions, conditions)) {
        const warpEvidenceHarness =
          (globalThis as Record<string, unknown>)["__DIB_TEST_WARP_GATE_EVIDENCE__"] === true;
        if (warpEvidenceHarness) {
          this.activeTownWarpDisabledChat = true;
          this.deps.onStateChanged();
        }
        try {
          const disabled = await showGuildQuestChat({
            parent: this.pointRoot,
            assets: this.deps.game.assets,
            scale9: this.deps.game.scale9,
            ticker: this.deps.stage.app.ticker,
            message: localizedString(this.deps.game.strings, "TownPortalsDisabledChatKey"),
            portraitFile: "ClerkGirl.png",
          });
          await disabled.closed;
        } finally {
          if (warpEvidenceHarness) {
            this.activeTownWarpDisabledChat = false;
            this.deps.onStateChanged();
          }
        }
        return;
      }
      const destinations = configured.destinations
        .filter(({ portalConditions }) => sourceConditionsAreMet(portalConditions, conditions));
      let flow: TownWarpFlow | undefined;
      flow = await TownWarpFlow.show({
        parent: this.pointRoot,
        assets: this.deps.game.assets,
        scale9: this.deps.game.scale9,
        strings: this.deps.game.strings,
        ticker: this.deps.stage.app.ticker,
        backgroundSpriteKey: configured.backgroundSpriteKey,
        destinations,
        visitedTownNames: configured.visitedTownNames,
        questsAvailableInTown: (townName) =>
          this.deps.guildQuests?.questsAvailableInTown(townName) ?? 0,
        isInputBlocked: () => this.modalOpening || this.locked || this.lifecycle.disposed,
        onClick: () => this.deps.audio.playSfx("click"),
        onUnknownTown: async () => {
          await showMonsterHatchPopup({
            parent: this.pointRoot,
            owner: this,
            assets: this.deps.game.assets,
            scale9: this.deps.game.scale9,
            ticker: this.deps.stage.app.ticker,
            zIndex: 12_000,
            sfx: {
              onButtonPress: () => this.deps.audio.playSfx("click"),
              onButtonBlocked: () => this.deps.audio.playSfx("notAllowed"),
            },
          }, {
            title: localizedString(this.deps.game.strings, "UnknownTownTitleKey"),
            content: buildLocalizedMonsterHatchMessageContent(
              this.deps.game.strings,
              "UnknownTown",
            ),
            buttons: [{
              label: localizedString(this.deps.game.strings, "OkButtonKey"),
              onPress: () => undefined,
            }],
          });
        },
        onTravel: async (townName) => {
          this.locked = true;
          try {
            await configured.onTravel(townName);
          } catch (error) {
            this.locked = false;
            this.reportTransitionFailure(`townWarp:${townName}`, error);
          }
        },
        onClose: () => {
          if (this.activeTownWarp === flow) this.activeTownWarp = undefined;
          this.deps.onStateChanged();
        },
      });
      if (this.lifecycle.disposed) {
        flow.dispose();
        return;
      }
      this.activeTownWarp = flow;
      this.deps.onStateChanged();
      if (await this.claimTutorialFlag("TownWarpTutorial") === "claimed" && !this.lifecycle.disposed) {
        await showMonsterHatchPopup({
          parent: this.pointRoot,
          owner: this,
          assets: this.deps.game.assets,
          scale9: this.deps.game.scale9,
          ticker: this.deps.stage.app.ticker,
          zIndex: 12_000,
          sfx: {
            onButtonPress: () => this.deps.audio.playSfx("click"),
            onButtonBlocked: () => this.deps.audio.playSfx("notAllowed"),
          },
        }, {
          title: localizedString(this.deps.game.strings, "TownWarpTutorialTitleKey"),
          content: buildLocalizedMonsterHatchMessageContent(
            this.deps.game.strings,
            "TownWarpTutorial",
          ),
          buttons: [{
            label: localizedString(this.deps.game.strings, "OkButtonKey"),
            onPress: () => undefined,
          }],
        });
      }
    } finally {
      this.modalOpening = false;
    }
  }






  private townBuildingIsEnabled(definition: TownBuildingDefinition): boolean {
    if (!townBuildingEnabled(definition.className)) return false;
    if (definition.className === "TownWarpMenuItem") return this.deps.townWarp !== undefined;
    if (definition.className === "BlackMarketMenuItem") {




      if (this.deps.blackMarketServiceReady !== true) return true;
      const configured = this.deps.blackMarketDemo;
      const menuButton2 = this.deps.game.scale9.MenuButton2;
      if (configured === undefined || menuButton2 === undefined) return false;
      const menuButtonSpriteKey = `${menuButton2.image.replace(/\.png$/i, "")}-hd`;
      const assets = this.deps.game.assets;
      const closeSpriteKey = resolveBlackMarketCloseSpriteKey(assets);
      return assets.hasSprite(configured.backgroundSpriteKey) &&
        assets.hasSprite(menuButtonSpriteKey) &&
        closeSpriteKey !== undefined;
    }
    if (definition.className !== "TavernMenuItem") return true;
    const assets = this.deps.game.assets;
    const runtime = this.deps.guildQuests;
    const backgroundKey = this.deps.guildTavernBackgroundSpriteKey;
    return runtime !== undefined &&
      definition.questGiver !== undefined &&
      backgroundKey !== undefined &&
      assets.hasSprite(backgroundKey) &&
      assets.hasSprite("notification-hd") &&
      this.guildQuestListAvailable();
  }

  private nextCombineInstanceId(shortType: string): string {
    const existing = new Set(this.deps.party.monsters().map((monster) => monster.instanceId));
    let candidate: string;
    do {
      candidate = `trip-combine-${++this.combineSerial}-${shortType}`;
    } while (existing.has(candidate));
    return candidate;
  }

  private refreshHeroXp(): void {
    if (!this.heroXpFillMask || !this.heroXpLevelLabel) return;
    const progress = heroXpPercent(
      this.deps.heroProgress.level,
      this.deps.heroProgress.totalHighestLevels,
    );
    const rect = this.heroXpFillRect;
    this.heroXpFillMask
      .clear()
      .rect(rect.x, rect.y, rect.w * progress, rect.h)
      .fill(0xffffff);
    this.heroXpLevelLabel.text =
      `${localizedString(this.deps.game.strings, "LevelShortKey")} ${this.deps.heroProgress.level}`;
  }

  private toggleHeroXp(expanding: boolean): void {
    const target = expanding ? 0 : worldHeroXpCollapsedX(DISPLAY_MODE, this.heroXpFrameWidth);
    this.heroXpTransition = {
      from: this.heroXpRoot.position.x,
      to: target,
      elapsedMs: 0,
      expanding,
    };
  }

  private readonly handleWorldTap = (event: FederatedPointerEvent): void => {
    if (
      this.locked ||
      this.walking ||
      this.modalOpening ||
      this.hasModal() ||
      this.activeTown !== undefined
    ) return;
    event.stopPropagation();
    const mapPoint = this.mapLayer.toLocal(event.global);
    const minimumSize = worldMinimumTouchSize(DISPLAY_MODE);
    const candidates = [...this.poiDisplays.values()]
      .filter((display) => this.deps.trip.poiState(display.poi.name) !== 3)
      .filter((display) => {
        const baseBounds = minimumWorldHitRectangle(
          rectangleInCoordinateSpace(display.base, this.mapLayer),
          minimumSize,
        );
        return containsPoint(baseBounds, mapPoint) ||
          townPoiHitRegions(display.town, this.mapLayer).some((region) =>
            containsPoint(region, mapPoint)
          );
      })
      .map((display) => {
        const center = display.root.position;
        const dx = center.x - mapPoint.x;
        const dy = center.y - mapPoint.y;
        return { display, distanceSquared: dx * dx + dy * dy };
      })
      .sort((left, right) => left.distanceSquared - right.distanceSquared);
    const selected = candidates[0]?.display;
    if (selected === undefined) return;
    void this.handlePoiTap(selected.poi.name);
  };

  private async handlePoiTap(poiName: string): Promise<void> {
    if (
      this.locked ||
      this.walking ||
      this.modalOpening ||
      this.hasModal() ||
      this.deps.trip.poiState(poiName) === 3
    ) return;
    const previous = this.requirePoi(this.deps.trip.currentPoiName);
    const target = this.requirePoi(poiName);
    const route = this.deps.poiRouting.route(target);
    if (route.kind === "blocked") return;
    const active = this.deps.party.projectAliveBattingPrefix();
    if (route.kind === "navigate" && target.randomPopulators.length > 0 && active.length === 0) {
      throw new Error("WorldNode: cannot enter an encounter with an empty alive batting prefix");
    }

    this.transitionFailure = undefined;
    let optimisticMovement: Promise<WorldMovementResult> | undefined;
    let authorityArrival:
      | {
          readonly movement: "walk" | "teleport" | "same";
          readonly randomDraws: readonly number[];
          readonly committedAt?: string;
          readonly synchronizeProjection?: () => void;
      }
      | undefined;






    const requiresAuthorityNavigation =
      previous.name !== target.name ||
      route.kind === "navigate" ||
      (route.kind === "scene" && route.sceneId === "town");
    if (this.deps.authority !== undefined && requiresAuthorityNavigation) {
      // Own input through the committed response, including town routes with no optimistic
      // movement and field animations that finish before a slow response arrives.
      this.locked = true;
      try {
        authorityArrival = await this.deps.authority.navigate(poiName, () => {
          // Field travel and the same-POI repeat fade begin on pointer acceptance and mask
          // round-trip latency. The server still decides every encounter/value outcome; this is
          // only reversible geometry.
          if (route.kind === "navigate") {
            const adjacent = this.deps.world.connections.some((connection) =>
              connection.requiredCompletedPoiNames === undefined &&
              ((connection.poi1 === previous.name && connection.poi2 === target.name) ||
                (connection.poi2 === previous.name && connection.poi1 === target.name)));
            optimisticMovement = this.playMovement(previous, target, adjacent ? "walk" : "teleport");
          }
        });
        if (authorityArrival.committedAt !== undefined) {
          const committedAt = Date.parse(authorityArrival.committedAt);
          if (!Number.isFinite(committedAt)) {
            throw new Error("official navigation returned an invalid commit time");
          }
          this.authoritativeNowSeconds = committedAt / 1_000;
        }
      } catch (error) {
        this.cancelMovement();
        this.settleMarkerAt(previous, true);
        this.deps.audio.playSfx("notAllowed");
        this.transitionFailure = {
          route: `navigate ${poiName}`,
          message: error instanceof Error ? error.message : String(error),
        };
        return;
      } finally {
        // The synchronous continuation below acquires its scene/encounter lock where needed.
        this.locked = false;
      }
    }
    const result = this.deps.trip.navigate(poiName, active.slice(0, 3).map((member) => member.level));
    if (
      authorityArrival !== undefined &&
      authorityArrival.movement !== "same" &&
      result.movement?.kind !== authorityArrival.movement
    ) {
      throw new Error(
        `WorldNode: local movement ${result.movement?.kind ?? "none"} disagrees with authority ` +
          authorityArrival.movement,
      );
    }
    authorityArrival?.synchronizeProjection?.();
    if (shouldShowReplayBattleTutorial(result)) this.presentReplayBattleTutorial();
    this.deps.onStateChanged();
    const continuation = worldArrivalContinuation(route, result);



    if (continuation === "encounter") {
      if (result.kind !== "encounter") {
        throw new Error("WorldNode: encounter continuation requires an encounter arrival");
      }
      this.refreshPoiStates();
      // A repeat tap has no self-edge, so native `setCurrentPOI:` takes the non-adjacent marker
      // path even though both coordinates are equal: fade out 0.25s, move to the same point, then
      // fade in 0.5s. Encounter construction/zoom begins immediately and runs concurrently.
      void (optimisticMovement ?? this.playMovement(previous, target, result.movement.kind));
      this.locked = true;
      this.dispatchOwnedTransition("encounter", target, () =>
        this.deps.onEncounter({ arrival: result, poi: target }));
      return;
    }

    if (continuation === "immediateScene") {
      if (route.kind !== "scene") {
        throw new Error("WorldNode: immediate scene continuation requires a scene route");
      }
      this.locked = true;
      this.cancelMovement();
      const direction = result.movement === undefined
        ? this.lastWalkDirection
        : worldSettledDirection(
            previous.position,
            target.position,
            result.movement.kind,
            this.lastWalkDirection,
          );
      this.settleMarkerAt(target, false, direction);
      // Deliberately preserve the pre-arrival rendered POI projection through the town-entry
      // fade. The logical trip state above has already committed to the town.
      this.dispatchOwnedTransition(`${route.sceneId} scene`, target, () =>
        this.deps.onSceneRequest({ poi: target, route, arrival: result }));
      return;
    }

    this.refreshPoiStates();

    if (continuation === "immediateCollection") {
      if (route.kind !== "collection") {
        throw new Error("WorldNode: Collection continuation requires a Collection route");
      }
      if (previous.name !== target.name) {
        void (optimisticMovement ?? this.playMovement(previous, target, result.movement!.kind));
      }
      this.openCollection(route.collectionType);
      return;
    }

    if (continuation === "worldExit") {
      if (route.kind !== "worldExit") {
        throw new Error("WorldNode: world-exit continuation requires a world-exit route");
      }
      if (this.zoneChangeBlocked(target)) {
        if (previous.name !== target.name) {
          void (optimisticMovement ?? this.playMovement(previous, target, result.movement!.kind));
        }
        void this.presentZoneChangeFailChat(target);
        return;
      }
      this.locked = true;
      this.cancelMovement();
      this.settleMarkerAt(target, true);
      this.dispatchOwnedTransition("world transition", target, () =>
        this.deps.onWorldExit({
          poi: target,
          targetWorld: route.targetWorld,
          targetPoi: route.targetPoi,
        }));
      return;
    }

    const movement = route.kind === "scene" && previous.name === target.name
      ? Promise.resolve<WorldMovementResult>({ kind: "completed" })
      : optimisticMovement ?? this.playMovement(previous, target, result.movement!.kind);

    if (continuation === "afterMovementScene") {
      if (route.kind !== "scene") {
        throw new Error("WorldNode: delayed scene continuation requires a scene route");
      }
      this.locked = true;
      void movement.then((outcome) => {
        if (outcome.kind !== "completed") return;
        if (this.zoneChangeBlocked(target)) {
          void this.presentZoneChangeFailChat(target);
          return;
        }
        this.dispatchOwnedTransition(`${route.sceneId} scene`, target, () =>
          this.deps.onSceneRequest({ poi: target, route, arrival: result }));
      });
      return;
    }
  }


  private zoneChangeBlocked(target: WorldPointOfInterest): boolean {
    if (this.deps.authority !== undefined && this.deps.authority.sourceStoryRules !== true) return false;
    const conditions = target.zoneChange?.conditions;
    return conditions !== undefined &&
      !sourceConditionsAreMet(conditions, this.sourceConditionContext());
  }

  /**
   * Failed `performVisitLogic` gate: `showChatDialog:` of `<instanceName>Fail`, then return with no
   * transition. The shipped Relic entrance has no `Chats.plist` record, so the nil-record fallback
   * shows `4-4_Beach_2FailChatKey` without a portrait. `showChatDialog:` stores the key in
   * `dialogsSeen` before display; no condition reads it, and the authority has no command that
   * records a non-town chat, so only local play persists it (the server independently rejects the
   * transition).
   */
  private async presentZoneChangeFailChat(target: WorldPointOfInterest): Promise<void> {
    const chat = this.deps.chatDefinition(`${target.name}Fail`);
    if (
      this.deps.authority === undefined &&
      this.deps.guildQuests?.requestChatPresentation(chat.name, chat.alwaysShow) === false
    ) {
      this.locked = false;
      return;
    }
    this.locked = true;
    try {
      const keys = chat.messageKeys.length === 0 ? [`${chat.name}ChatKey`] : chat.messageKeys;
      for (const key of keys) {
        if (this.lifecycle.disposed) return;
        const handle = await showGuildQuestChat({
          parent: this.pointRoot,
          assets: this.deps.game.assets,
          scale9: this.deps.game.scale9,
          ticker: this.deps.stage.app.ticker,
          message: localizedString(this.deps.game.strings, key),
          ...(chat.imageFile === undefined ? {} : { portraitFile: chat.imageFile }),
        });
        if (this.lifecycle.disposed) {
          handle.dismiss(true);
          return;
        }
        await handle.closed;
      }
    } finally {
      if (!this.lifecycle.disposed) {
        this.locked = false;
        this.deps.onStateChanged();
      }
    }
  }

  private async playMovement(
    previous: WorldPointOfInterest,
    target: WorldPointOfInterest,
    kind: "walk" | "teleport",
  ): Promise<WorldMovementResult> {
    this.cancelMovement();
    const abort = new AbortController();
    this.movementAbort = abort;
    this.walking = true;
    const hasIndent = hasWorldMapIndent(this.deps.world.map.indent);
    const from = worldPoiPointToPixi(previous.position, DISPLAY_MODE, hasIndent);
    const to = worldPoiPointToPixi(target.position, DISPLAY_MODE, hasIndent);
    let completed = false;

    try {
      if (kind === "walk") {
        const direction = worldWalkDirection(previous.position, target.position);
        if (!this.isMovementOwner(abort)) return { kind: "cancelled" };
        this.setMarkerDirection(direction);
        this.marker.play();
        const outcome = await tweenWithResult(this.deps.stage.app.ticker, WORLD_ADJACENT_MOVE_MS, (t) => {
          this.marker.position.set(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
        }, undefined, abort.signal);
        if (outcome === "cancelled" || !this.isMovementOwner(abort)) {
          return { kind: "cancelled" };
        }
        this.settleMarkerAt(target, true, direction);
      } else {
        const fadeOut = await tweenWithResult(this.deps.stage.app.ticker, WORLD_TELEPORT_FADE_OUT_MS, (t) => {
          this.marker.alpha = 1 - t;
        }, undefined, abort.signal);
        if (fadeOut === "cancelled" || !this.isMovementOwner(abort)) {
          return { kind: "cancelled" };
        }
        this.marker.position.set(to.x, to.y);
        const fadeIn = await tweenWithResult(this.deps.stage.app.ticker, WORLD_TELEPORT_FADE_IN_MS, (t) => {
          this.marker.alpha = t;
        }, undefined, abort.signal);
        if (fadeIn === "cancelled" || !this.isMovementOwner(abort)) {
          return { kind: "cancelled" };
        }
        this.settleMarkerAt(target, true);
      }
      completed = true;
      return { kind: "completed" };
    } finally {
      if (this.movementAbort === abort) {
        this.movementAbort = undefined;
        this.walking = false;
        if (!completed && this.isAlive()) {
          this.settleMarkerAt(this.requirePoi(this.deps.trip.currentPoiName), true);
        }
      }
    }
  }

  private refreshPoiStates(): void {
    for (const [name, display] of this.poiDisplays) {
      const state = this.deps.trip.poiState(name);
      const route = this.deps.poiRouting.route(display.poi);
      const projection = projectWorldPoiState(state, route.kind === "blocked");
      // Native setState: replaces each flag sprite. Persistent Pixi sprites must explicitly
      // recover that fresh-sprite opacity baseline whenever field state is projected.
      display.stateSprite.alpha = 1;
      display.stateSprite.visible = projection.materialized;
      if (!projection.materialized) {
        display.stateSprite.texture = Texture.EMPTY;
        display.stateSprite.eventMode = "none";
        display.stateSprite.cursor = "default";
        display.renderedState = null;
        display.renderedTextureKey = null;
        continue;
      }
      display.stateSprite.texture = this.stateTextures[projection.renderedState];
      display.stateSprite.scale.set(WORLD_STATE_SPRITE_SCALE);
      display.stateSprite.eventMode = "none";
      display.stateSprite.cursor = "pointer";
      display.renderedState = projection.renderedState;
      display.renderedTextureKey = projection.renderedTextureKey;
    }
  }

  private cancelMovement(): void {
    const owner = this.movementAbort;
    this.movementAbort = undefined;
    owner?.abort();
    this.walking = false;
  }

  private isMovementOwner(owner: AbortController): boolean {
    return !owner.signal.aborted && this.movementAbort === owner && this.isAlive();
  }

  private isAlive(): boolean {
    return !this.lifecycle.disposed && !this.pointRoot.destroyed && !this.marker.destroyed;
  }

  private setMarkerDirection(direction: WorldWalkDirection): void {
    this.lastWalkDirection = direction;
    this.marker.textures = Array.from({ length: 8 }, (_, index) => ({
      texture: requiredFrame(this.heroWalkTextures, worldWalkFrameName(direction, index + 1)),
      time: WORLD_WALK_FRAME_MS,
    }));
  }

  private settleMarkerAt(
    poi: WorldPointOfInterest,
    visible: boolean,
    direction?: WorldWalkDirection,
  ): void {
    if (!this.isAlive()) return;
    if (direction !== undefined) this.setMarkerDirection(direction);
    this.marker.stop();
    this.marker.texture = requiredFrame(
      this.heroWalkTextures,
      worldWalkFrameName(this.lastWalkDirection, 1),
    );
    const position = worldPoiPointToPixi(
      poi.position,
      DISPLAY_MODE,
      hasWorldMapIndent(this.deps.world.map.indent),
    );
    this.marker.position.set(position.x, position.y);
    this.marker.alpha = 1;
    this.marker.visible = visible;
  }

  private dispatchOwnedTransition(
    route: string,
    target: WorldPointOfInterest,
    invoke: () => void | Promise<void>,
  ): void {
    this.transitionFailure = undefined;
    dispatchTransition(invoke, (error) => this.recoverTransitionFailure(route, target, error));
  }

  private reportTransitionFailure(route: string, error: unknown): void {
    console.error(`WorldNode ${route} failed`, error);
    if (!this.isAlive()) return;
    this.transitionFailure = {
      route,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  /**
   * Recovery commits to the already-navigated target. It never rewinds encounter RNG or refresh
   * registries: if this WorldNode is still alive, it rebuilds the field projection, settles the
   * marker at that target, and returns input ownership to the field.
   */
  private recoverTransitionFailure(
    route: string,
    target: WorldPointOfInterest,
    error: unknown,
  ): void {
    console.error(`WorldNode ${route} failed`, error);
    if (!this.isAlive()) return;
    this.transitionFailure = {
      route,
      message: error instanceof Error ? error.message : String(error),
    };
    this.cancelMovement();
    if (this.deps.authority !== undefined) {
      // The command may already have committed a town, battle, or world-exit location. Unlocking
      // this retained field would let it submit another world command against that new authority
      // state (and surface the resulting 422). Rebuild presentation from the committed projection
      // through the same side-effect-free session-restart path used by display changes.
      this.locked = true;
      dispatchTransition(
        () => this.deps.onPresentationChange(),
        (restartError) => this.reportTransitionFailure(`${route} recovery`, restartError),
      );
      return;
    }
    if (this.activeTown === undefined) {
      this.refreshPoiStates();
      this.settleMarkerAt(target, true);
    }
    this.locked = false;
  }

  private requirePoi(name: string): WorldPointOfInterest {
    const poi = this.byName.get(name);
    if (!poi) throw new Error(`WorldNode: unknown POI ${name}`);
    return poi;
  }
}

function containsPoint(
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  point: { readonly x: number; readonly y: number },
): boolean {
  return point.x >= bounds.x && point.x < bounds.x + bounds.width &&
    point.y >= bounds.y && point.y < bounds.y + bounds.height;
}








function townPoiHitRegions(
  town: TownPoiDisplay | undefined,
  coordinateSpace: Container,
): WorldHitRectangle[] {
  if (town === undefined) return [];
  // `iconSprites`/`touchableBuildings` receive a building only inside the service branch of
  // `setupForRenderable:context:`, so fake houses and condition-rejected houses are absent from
  // both unions. `menuRoot` is exactly that branch's port marker.
  const interactive = town.buildings.filter(({ menuRoot }) => menuRoot !== undefined);
  return townPoiAggregateHitRegions(
    interactive.flatMap(({ flashTarget }) =>
      flashTarget === undefined ? [] : [rectangleInCoordinateSpace(flashTarget, coordinateSpace)]
    ),
    interactive.map(({ house }) => rectangleInCoordinateSpace(house, coordinateSpace)),
  );
}

function rectangleInCoordinateSpace(
  node: Container,
  coordinateSpace: Container,
): WorldHitRectangle {
  const bounds = node.getLocalBounds();
  const corners = [
    coordinateSpace.toLocal(node.toGlobal({ x: bounds.x, y: bounds.y })),
    coordinateSpace.toLocal(node.toGlobal({ x: bounds.x + bounds.width, y: bounds.y })),
    coordinateSpace.toLocal(node.toGlobal({ x: bounds.x, y: bounds.y + bounds.height })),
    coordinateSpace.toLocal(node.toGlobal({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(...xs) - x,
    height: Math.max(...ys) - y,
  };
}

function stem(file: string): string {
  return file.replace(/\.png$/i, "");
}

function resolvedSpriteKey(game: LoadedGame, file: string): string {
  const base = stem(file);
  if (game.assets.hasSprite(`${base}-hd`)) return `${base}-hd`;
  if (game.assets.hasSprite(base)) return base;
  throw new Error(`WorldNode: imported manifest has no sprite for ${file}`);
}

function rendererScaleOf(rendererData: unknown): number | undefined {
  if (rendererData === null || typeof rendererData !== "object") return undefined;
  const scale = (rendererData as Record<string, unknown>)["scale"];
  return typeof scale === "number" ? scale : undefined;
}

function requiredFrame(textures: Record<string, Texture>, name: string): Texture {
  const texture = textures[name];
  if (!texture) throw new Error(`HeroWalkFrames-hd is missing ${name}`);
  return texture;
}
