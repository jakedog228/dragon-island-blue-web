import {
  AnimatedSprite,
  Container,
  Graphics,
  Point,
  Rectangle,
  Sprite,
  Texture,
  type FederatedPointerEvent,
  type Spritesheet,
} from "pixi.js";
import {
  CONTENT_SCALE_FACTOR,
  createRenderableSpriteNode,
  LifecycleScope,
  makeTtfLabel,
  minimumHitRectLocal,
  rectContainsPoint,
  OUTLINE_FADE_ALPHA,
  outlineBackgroundNode,
  pointSprite,
  Scale9,
  type FixedStage,
  type ParticleAsset,
} from "@dib/renderer";
import type { DungeonDefinition } from "@dib/gamedata/dungeon";
import { heroXpPercent, type Rng } from "@dib/engine";
import {
  type DungeonDirection,
  type DungeonEncounter,
  type DungeonLoot,
  type DungeonRoom,
  type DungeonRoomEntryAction,
  type DungeonRoomSelectionResult,
  type DungeonSession,
  type DungeonTreasure,
} from "@dib/engine/dungeon";
import type { LoadedGame } from "../loadGame.js";
import type { AudioPlayer } from "../audio.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { screenPointsForMode, sourcePointsPerPortPoint } from "../displayMode.js";
import {
  easeExponentialInOut,
  easeSineInOut,
  tween,
  tweenWithResult,
} from "../tween.js";
import {
  DUNGEON_CAMERA_MS,
  DUNGEON_FOREST_SHADOW_OPACITY,
  DUNGEON_FOREST_SHADOW_SCALE_Y,
  DUNGEON_FOREST_SHADOW_TINT,
  DUNGEON_HERO_FRAME_MS,
  DUNGEON_LAYER_Z,
  DUNGEON_POPUP_ROOT_Z_INDEX,
  DUNGEON_TILE_PT,
  DUNGEON_WALK_LEG_MS,
  type DungeonBreederPulseState,
  dungeonCameraTransform,
  advanceDungeonBreederPulse,
  dungeonContentCenter,
  dungeonConnectorTiles,
  dungeonDoorWalkTarget,
  dungeonEncounterOutline,
  dungeonEncounterRoomFitScale,
  dungeonEncounterRoomPosition,
  initialDungeonBreederPulseState,
  dungeonFloorTilePosition,
  dungeonForestTreeKey,
  dungeonForestTreePlacements,
  dungeonForestTreeScale,
  dungeonFrameName,
  dungeonHeroFrameName,
  dungeonHudLayout,
  nearestMaterializedRoom,
  dungeonRoomRect,
  dungeonRoomLinkDoorPosition,
  dungeonRoomTouchRadiusPt,
  dungeonRoomZ,
  dungeonVisibleRoomIds,
  dungeonWallFrameName,
  type DungeonDoorNodeMetrics,
} from "./dungeonDisplayMath.js";
import {
  chooseDungeonWaypoint,
  showDungeonMessage,
  showNewInfiniteMonsterSlotTutorial,
  showWaypointReachedTutorial,
  type WaypointSelectionState,
} from "./dungeonDialogs.js";
import { showDungeonLootManagement } from "./dungeonLootPageProvider.js";
import {
  dungeonSameRoomInteraction,
  dungeonTouchRequiresRoomSelection,
} from "./dungeonTouchArbitration.js";
import {
  dungeonCollectionMonsterTypes,
  formatDungeonCaught,
  formatDungeonLocalizedName,
  formatInfiniteDungeonUnlock,
  infiniteDungeonUnlockLabelFont,
  infiniteDungeonUnlockLabelLayout,
  INFINITE_DUNGEON_UNLOCK_BACKING_CONFIG,
  INFINITE_DUNGEON_UNLOCK_BACKING_Z,
  INFINITE_DUNGEON_UNLOCK_LABEL_DELAY_MS,
  INFINITE_DUNGEON_UNLOCK_LABEL_FADE_MS,
  INFINITE_DUNGEON_UNLOCK_LABEL_Z,
} from "./dungeonHudMath.js";
import type { InfiniteDungeonFloorEntry } from "@dib/player-domain";
import type { AppliedPlayerReward } from "../player/rewards.js";
import type { DungeonRouteDescriptor, DungeonRuntimeTransition } from "@dib/engine/dungeon-runtime";
import {
  WORLD_HERO_XP_AUTO_CLOSE_MS,
  WORLD_HERO_XP_TOGGLE_MS,
  worldHeroXpBarPosition,
  worldHeroXpCollapsedX,
  worldHeroXpFontSize,
  worldHeroXpLabelGap,
} from "../world/worldChromeMath.js";
import { localizedRenderableName, localizedString } from "../localization.js";
import { WorldNotificationHost } from "../world/worldNotificationHost.js";
import { PopupHost } from "../ui/popup.js";
import { SourceFlashingSprite } from "../ui/flashingSprite.js";
import { flashActionOpacity } from "../ui/flashingSpriteMath.js";
import {
  showDungeonFloorDetectionChat,
} from "./dungeonFloorChat.js";
import type { ChainedTextChatHandle } from "../ui/chainedTextChat.js";
import {
  dungeonFloorDetectionChatKey,
  type DungeonFloorDetectionChatKey,
} from "./dungeonFloorChatMath.js";
import { waypointFloorOptions } from "./dungeonWaypointMath.js";
import {
  FOREST_TREE_ALL_VALUES_ORDER_CODE,
  FOREST_TREE_ALL_VALUES_ORDER_DIAGNOSTIC,
  isVolcanoInfiniteDungeonInstance,
  LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
  LEADERBOARD_PLATFORM_HOOK_MESSAGE,
} from "./dungeonDiagnostics.js";
import {
  DungeonChestSparkles,
  dungeonChestSparklePlacement,
} from "./dungeonChestSparkles.js";

export interface DungeonEncounterRequest {
  readonly encounter: DungeonEncounter;
  readonly roomId: string;
  readonly definition: DungeonDefinition;
}

export interface DungeonNodeDeps {
  readonly stage: FixedStage;
  readonly game: LoadedGame;
  readonly audio: AudioPlayer;
  readonly definition: DungeonDefinition;
  readonly session: DungeonSession;
  readonly route: DungeonRouteDescriptor;
  /** Development-only native stream for scene-construction draw-order verification. */
  readonly fidelityRng?: Rng;
  readonly initiallyHidden?: boolean;
  /** Ordinary POINode dungeon entry permits the pre-entry waypoint selector. */
  readonly allowWaypointSelection?: boolean;
  readonly onEncounter: (
    request: DungeonEncounterRequest,
    preparation: Promise<void>,
  ) => void | Promise<void>;
  readonly onPrepareEncounter?: (request: DungeonEncounterRequest) => void | Promise<void>;
  readonly onSelectRoom?: (
    roomId: string,
    onIntentAccepted?: (selection: DungeonRoomSelectionResult) => void,
  ) => DungeonRoomSelectionResult | Promise<DungeonRoomSelectionResult>;
  readonly onActivateZone: (
    zoneId: string,
  ) => DungeonRuntimeTransition | undefined | Promise<DungeonRuntimeTransition | undefined>;
  readonly onTransition: (
    transition: Exclude<DungeonRuntimeTransition, { kind: "blocked" }>,
  ) => void | Promise<void>;
  readonly onWaypoint: (
    firstReach: boolean,
  ) => readonly DungeonRouteDescriptor[] | Promise<readonly DungeonRouteDescriptor[]>;
  readonly onWaypointTravel: (destination: DungeonRouteDescriptor) => void | Promise<void>;
  /** Native `CatchQuestDisplay show...` dispatch, after waypoint selection reports no popup. */
  readonly onCatchQuest?: () => void;
  /** Native dungeon music request, after the name plate and before room `enterLogic`. */
  readonly onMusic?: () => void;
  /** Source `showTutorialForFlag:` claims this durable flag before presenting the popup. */
  readonly claimTutorialFlag: (flag: string) => boolean | Promise<boolean>;
  readonly claimFloorPresence: () => boolean;


  readonly onInfiniteDungeonFloor: (floor: number) => InfiniteDungeonFloorEntry;


  readonly onLoot: (
    loot: readonly DungeonLoot[],
    treasure: DungeonTreasure,
  ) => readonly AppliedPlayerReward[] | Promise<readonly AppliedPlayerReward[]>;


  readonly onLootClaim?: (
    treasure: DungeonTreasure,
  ) => Promise<(() => Promise<void>) | undefined>;
  readonly heroLevel: number;
  readonly heroTotalHighestLevels: number;
  readonly isMonsterRegistered: (shortType: string) => boolean;
  readonly isCollectionMonsterEligible: (
    shortType: string,
    extraLivingArguments: Readonly<Record<string, unknown>> | undefined,
  ) => boolean;
  readonly onMenu: () => void | Promise<void>;
  /** App-owned menu transition still owns input after its visible menu has closed. */
  readonly isInputBlocked?: () => boolean;
  /** App-owned MasterMenu/overlay state exported through render_game_to_text. */
  readonly menuState?: () => {
    readonly menu: Record<string, unknown> | null;
    readonly sceneFade:
      | { readonly route: string; readonly phase: string; readonly alpha: number }
      | undefined;
    readonly overlay: Record<string, unknown> | null;
  };
  readonly onStateChanged: () => void;
  readonly onNotificationHostReady?: (host: WorldNotificationHost) => void;
  readonly onDiagnostic?: (message: string, detail?: Readonly<Record<string, unknown>>) => void;
  readonly diagnostics?: () => readonly Readonly<Record<string, unknown>>[];
}

interface DungeonTextureSet {
  readonly theme: ReadonlyMap<string, Texture>;
  readonly hero: Spritesheet;
  readonly encounterSprites: ReadonlyMap<string, Texture>;
  readonly menuButton: Texture;
  readonly heroXpFrame: Texture;
  readonly heroXpBar: Texture;
  readonly namePlate: Texture;
  readonly chestSparkle: ParticleAsset;
  readonly background?: Texture;
}

/** Non-forest rooms own a composite wall, not a keyed tree dictionary. */
const EMPTY_FOREST_TREES: ReadonlyMap<string, Sprite> = new Map();

interface DungeonEncounterPresentation {
  readonly root: Container;
  readonly localContentCenter: Point;

  readonly outline: Container;
}

/** Pixi counterpart of source DungeonNode/RoomNode. All game rules live in DungeonSession. */
export class DungeonNode {
  readonly sceneKind = "dungeon" as const;
  private readonly lifecycle = new LifecycleScope();
  private readonly pointRoot = new Container();
  /** Director-notification sibling above the persistent world/name-plate host. */
  private readonly popupRoot = new Container();
  private readonly clip: Graphics;
  private readonly world = new Container();
  private readonly roomLayer = new Container();
  private readonly heroLayer = new Container();
  private readonly chrome = new Container();
  private readonly encounterSprites = new Map<string, DungeonEncounterPresentation>();
  private readonly waypointSprites = new Map<string, Sprite>();
  private readonly zoneSprites = new Map<string, Sprite>();
  /**
   * Native sparkle systems are children of persistent RoomNode chests. The port redraws room
   * containers after movement, so retain each live system across that renderer-only rebuild; a
   * collected chest is the only path that destroys it and resets its continuous emission state.
   */
  private readonly chestSparkles = new Map<string, DungeonChestSparkles>();
  /** `RoomNode.doors` (`+264`), one dictionary per room keyed by the link's target instance name;
   *  `setCurrentRoom:` looks the walk's door up in the room being ENTERED, keyed by the room being
   *  left. Keeping the door's own metrics is what lets the walk reproduce the source corner. */
  private readonly doorNodes = new Map<string, DungeonDoorNodeMetrics>();


  private readonly forestLayouts = new Map<string, { readonly frameIndex: number; readonly scales: readonly number[] }>();
  /** RoomNode instances persist after first materialization in the source. Cache their random
   *  cave decoration/door frames while the port rebuilds renderer-only shells. */
  private readonly caveWallItemFrames = new Map<string, readonly number[]>();
  private readonly doorFrameIndices = new Map<string, number>();
  private textures!: DungeonTextureSet;
  private hero!: AnimatedSprite;
  private notifications!: WorldNotificationHost;
  private heroXpRoot!: Container;
  private heroXpFrameWidth = 0;
  private locked = false;
  private waypointTravelPending = false;
  private get inputLocked(): boolean {
    return this.locked || this.waypointTravelPending || this.deps.isInputBlocked?.() === true;
  }
  private pendingAction: DungeonRoomEntryAction | undefined;
  private waypointSelectionState: WaypointSelectionState | undefined;
  private waypointKeyboardConfirm: (() => void) | undefined;
  private floorDetectionChat:
    | { readonly key: DungeonFloorDetectionChatKey; readonly message: string }
    | undefined;
  private floorDetectionChatHandle: ChainedTextChatHandle | undefined;
  /** Resolves once the entrance waypoint selector is on the band, so the floor notice lands over
   *  it. Undefined when this entry raises no selector. */
  private entranceSelectorPresented: Promise<void> | undefined;
  private lootProviderState: { readonly treasureId: string; readonly pendingCount: number } | undefined;
  private lastDirection: DungeonDirection = "south";
  private startPrepared = false;
  private preparedEntryActions: readonly DungeonRoomEntryAction[] = Object.freeze([]);
  private initialHeroAssignment: Promise<void> | undefined;
  private started = false;
  private heroXpCloseScheduled = false;
  private heroXpInitialClosePending = false;
  private heroXpInitialCloseController: AbortController | undefined;
  private readonly wallFrameIndex: number;
  private readonly floorFrameIndex: number;
  /** Native RoomNodes start their own action when first materialized by `showRoom:`. Keep one
   * state per encounter so redraws preserve phase while a newly revealed breeder starts at 255. */
  private readonly breederPulseStates = new Map<string, DungeonBreederPulseState>();
  /** `removeFromParentAndCleanup:YES` stops only the selected preview's outline sprite action. */
  private readonly frozenBreederEncounterAlphas = new Map<string, number>();
  private readonly breederPulseTick = (): void => {
    for (const [id, presentation] of this.encounterSprites) {
      if (this.frozenBreederEncounterAlphas.has(id)) continue;
      const pulse = this.breederPulseStates.get(id);
      if (pulse === undefined) continue;
      const next = advanceDungeonBreederPulse(pulse, this.deps.stage.app.ticker.deltaMS);
      this.breederPulseStates.set(id, next);
      presentation.outline.alpha = next.alpha;
    }
  };
  /** Native HeroXpNode state: 0 expanded, 1 collapsed, 2 animating. */
  private heroXpState: 0 | 1 | 2 = 0;

  private constructor(private readonly deps: DungeonNodeDeps) {
    const screen = screenPointsForMode(DISPLAY_MODE);
    this.clip = new Graphics().rect(0, 0, screen.w, screen.h).fill(0xffffff);
    this.pointRoot.visible = deps.initiallyHidden !== true;
    this.wallFrameIndex = 1 + this.randomIntBelow(deps.definition.presentation.wallFrameCount);
    this.floorFrameIndex = 1 + (deps.route.floor % deps.definition.presentation.floorFrameCount);
  }

  static async create(deps: DungeonNodeDeps): Promise<DungeonNode> {
    const node = new DungeonNode(deps);
    await node.build();
    return node;
  }


  prepareStart(initialActions?: readonly DungeonRoomEntryAction[] | null): Promise<void> {
    if (this.startPrepared) {
      if (this.initialHeroAssignment === undefined) {
        throw new Error("DungeonNode prepared without an initial hero assignment");
      }
      return this.initialHeroAssignment;
    }
    this.startPrepared = true;
    this.preparedEntryActions = initialActions === undefined
      ? this.deps.session.enterCurrentRoom()
      : initialActions ?? Object.freeze([] as DungeonRoomEntryAction[]);
    this.renderFloor(false);
    this.initialHeroAssignment = this.animateInitialHeroAssignment();
    return this.initialHeroAssignment;
  }

  /** Dispatch the native entry phases only after SceneCoordinator owns this node. `null` resumes
   * from retreat without retriggering the uncleared encounter; an explicit list resumes
   * post-victory guarded treasure exactly once. */
  async start(initialActions?: readonly DungeonRoomEntryAction[] | null): Promise<void> {
    if (this.started) throw new Error("DungeonNode.start may only be called once");
    this.started = true;
    await this.prepareStart(initialActions);
    if (this.lifecycle.disposed) return;


    this.onEnterTransitionDidFinish();
    const waypointShown = this.deps.allowWaypointSelection === true
      ? await this.openWaypoint(false, true)
      : false;
    if (!waypointShown) this.deps.onCatchQuest?.();
    this.notifications.showNamePlate(
      formatDungeonLocalizedName(
        localizedRenderableName(this.deps.game.strings, [this.deps.definition.instanceName]),
        this.deps.route.floor,
        localizedString(this.deps.game.strings, "DungeonLevelKey"),
      ),
      "dungeonNamePlate",
      "upper-inset",
    );
    this.deps.onMusic?.();
    const processing = this.processEntryActions(this.preparedEntryActions);
    // enterLogic's registration/tutorial/encounter scheduling is synchronous in the source.
    // Let this async port reach its first presentation wait, then perform the later floor scan
    // without waiting for a popup, loot provider, or battle transition to finish.
    await Promise.resolve();
    if (!this.lifecycle.disposed) {
      void this.presentFloorDetectionChat()
        .catch((error: unknown) => { queueMicrotask(() => { throw error; }); });
    }
    await processing;
  }

  private async animateInitialHeroAssignment(): Promise<void> {
    // `setCurrentRoom:` has no reciprocal old-room door on a newly constructed DungeonNode:
    // FadeTo(.25,0), teleport to the RoomNode center, FadeTo(.25,255), then `walkFinished`.
    this.locked = true;
    const target = this.hero.position.clone();
    this.hero.position.set(0, 0);
    this.hero.alpha = 1;
    await tween(
      this.deps.stage.app.ticker,
      250,
      (t) => { this.hero.alpha = 1 - t; },
      undefined,
      this.lifecycle.signal,
    );
    if (this.lifecycle.disposed) return;
    this.hero.position.copyFrom(target);
    await tween(
      this.deps.stage.app.ticker,
      250,
      (t) => { this.hero.alpha = t; },
      undefined,
      this.lifecycle.signal,
    );
    this.locked = false;
  }

  get notificationParent(): Container { return this.popupRoot; }
  get notificationOwner(): object { return this; }

  /** Register app-owned overlay/ticker cleanup behind the scene's single disposal boundary. */
  onDestroy(cleanup: () => void): void { this.lifecycle.add(cleanup); }

  /** Async menu flows must not finish construction after their DungeonNode has retired. */
  get lifecycleSignal(): AbortSignal { return this.lifecycle.signal; }


  showMenuNamePlate(text: string): void {
    this.notifications.showNamePlate(text, "monsterpediaCategoryNamePlate", "upper-inset");
  }

  private async build(): Promise<void> {
    const { stage, game, definition, audio } = this.deps;
    const atlasNames = definition.presentation.atlasNames.map((name) => `${name}-hd`);
    const encounterSpriteKeys = new Map<string, string>();
    for (const room of this.deps.session.state.rooms) {
      const monster = room.encounter?.monsters[0];
      if (monster === undefined) continue;
      encounterSpriteKeys.set(room.encounter!.id, dungeonMonsterSpriteKey(game, monster));
    }
    const [themeSheets, hero, general, menuButton, namePlate, notificationIcon, encounterTextures, chestSparkle, background] = await Promise.all([
      Promise.all(atlasNames.map((name) => game.assets.atlas(name))),
      game.assets.atlas("HeroWalkFrames-hd"),
      game.assets.atlas("General-hd"),
      game.assets.sprite(game.assets.hasSprite("menuButton-hd") ? "menuButton-hd" : "menuButton"),
      game.assets.sprite("namePlate-hd"),
      game.assets.hasSprite("Icon@2x")
        ? game.assets.sprite("Icon@2x")
        : Promise.resolve(Texture.EMPTY),
      Promise.all([...encounterSpriteKeys.entries()].map(async ([id, key]) => [id, await game.assets.sprite(key)] as const)),
      game.assets.particle("Sparkle.plist"),
      definition.presentation.backgroundImage === undefined
        ? Promise.resolve(undefined)
        : game.assets.sprite(stem(definition.presentation.backgroundImage) + (game.assets.hasSprite(`${stem(definition.presentation.backgroundImage)}-hd`) ? "-hd" : "")),
    ]);
    if (!audio.hasSfx("Stairs_EnterDungeon")) {
      await audio.preloadSfx("Stairs_EnterDungeon", game.assets.audioUrl("Stairs_EnterDungeon.m4a"));
    }
    const theme = new Map<string, Texture>();
    for (const sheet of themeSheets) for (const [name, texture] of Object.entries(sheet.textures)) theme.set(name, texture);
    this.textures = Object.freeze({
      theme,
      hero,
      heroXpFrame: requiredTexture(general, "heroXpFrame.png"),
      heroXpBar: requiredTexture(general, "heroXpBar.png"),
      namePlate,
      chestSparkle,
      encounterSprites: new Map(encounterTextures),
      menuButton,
      ...(background ? { background } : {}),
    });

    this.pointRoot.scale.set(CONTENT_SCALE_FACTOR);
    this.pointRoot.sortableChildren = true;
    this.pointRoot.label = "dungeonPointRoot";
    this.popupRoot.scale.set(CONTENT_SCALE_FACTOR);
    this.popupRoot.sortableChildren = true;
    this.popupRoot.label = "dungeonPopupRoot";
    this.popupRoot.zIndex = DUNGEON_POPUP_ROOT_Z_INDEX;
    this.popupRoot.visible = this.pointRoot.visible;
    const screen = screenPointsForMode(DISPLAY_MODE);
    this.pointRoot.eventMode = "static";
    this.pointRoot.hitArea = new Rectangle(0, 0, screen.w, screen.h);
    this.pointRoot.on("pointertap", (event: FederatedPointerEvent) => {
      if (this.locked) return;
      const point = event.getLocalPosition(this.world);
      const room = nearestMaterializedRoom(
        this.deps.session.state,
        point,
        dungeonRoomTouchRadiusPt(DISPLAY_MODE) / this.world.scale.x,
      );
      if (room !== undefined) {
        void this.handleRoomTouch(room.id, point).catch((error: unknown) => {
          this.deps.onDiagnostic?.("authoritative dungeon touch failed", Object.freeze({
            roomId: room.id,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
      }
    });
    this.world.sortableChildren = true;
    this.world.label = "dungeonWorld";
    this.world.zIndex = DUNGEON_LAYER_Z.world;
    this.roomLayer.sortableChildren = true;
    this.roomLayer.label = "dungeonRoomLayer";
    this.roomLayer.zIndex = 0;
    this.heroLayer.label = "dungeonHeroLayer";
    this.heroLayer.zIndex = 1;
    this.chrome.label = "dungeonChrome";
    this.chrome.zIndex = DUNGEON_LAYER_Z.chrome;
    this.world.addChild(this.roomLayer, this.heroLayer);
    this.pointRoot.addChild(this.clip, this.world, this.chrome);
    this.world.mask = this.clip;
    stage.root.addChild(this.pointRoot, this.popupRoot);
    this.notifications = WorldNotificationHost.for(stage.root, stage.app.ticker, {
      namePlate,
      sunrise: Texture.EMPTY,
      notificationIcon,
    });
    this.notifications.registerAutomaticPresentationRoot(this.pointRoot);
    this.notifications.registerAutomaticPresentationRoot(this.popupRoot);
    this.deps.onNotificationHostReady?.(this.notifications);
    this.lifecycle.add(() => {
      if (this.pointRoot.parent) this.pointRoot.parent.removeChild(this.pointRoot);
      this.pointRoot.destroy({ children: true });
      if (this.popupRoot.parent) this.popupRoot.parent.removeChild(this.popupRoot);
      this.popupRoot.destroy({ children: true });
    });
    if (this.deps.session.state.rooms.some((room) => room.encounter?.breeder !== undefined)) {
      stage.app.ticker.add(this.breederPulseTick);
      this.lifecycle.add(() => stage.app.ticker.remove(this.breederPulseTick));
    }

    if (background !== undefined) {
      const sprite = pointSprite(background);
      sprite.zIndex = DUNGEON_LAYER_Z.background;
      this.pointRoot.addChildAt(sprite, 0);
    }
    this.buildChrome();
    this.renderFloor(false);
  }

  private buildChrome(): void {
    const screen = screenPointsForMode(DISPLAY_MODE);
    const layout = dungeonHudLayout(screen);
    this.chrome.sortableChildren = true;

    const menu = pointSprite(this.textures.menuButton);
    menu.label = "dungeonMenuButton";
    menu.anchor.set(1, 0);
    menu.position.set(layout.menu.x, layout.menu.y);
    menu.zIndex = 90_010;
    menu.eventMode = "static";
    menu.cursor = "pointer";
    const menuBounds = menu.getLocalBounds();
    const menuHit = minimumHitRectLocal(
      { x: menuBounds.x, y: menuBounds.y, w: menuBounds.width, h: menuBounds.height },
      menu.scale,
    );
    menu.hitArea = new Rectangle(menuHit.x, menuHit.y, menuHit.w, menuHit.h);
    // Source DungeonNode.showMenu is distinct from RoomNode's waypoint interaction. Keep those
    // paths separate: the retained menu button opens the app-owned dungeon menu, while tapping the
    // room portal opens native waypoint selection.
    menu.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.requestMenu();
    });

    this.chrome.addChild(menu);
    this.buildHeroXp();
  }

  private updateChrome(): void {
    // DungeonHud and HeroXpNode are separate native children. Their exact retained presentation is
    // ported independently; do not substitute guessed counters or a plain level label here.
  }

  private buildHeroXp(): void {
    const screen = screenPointsForMode(DISPLAY_MODE);
    const root = new Container();
    root.label = "dungeonHeroXp";
    this.heroXpRoot = root;
    const frame = pointSprite(this.textures.heroXpFrame);
    this.heroXpFrameWidth = frame.width;
    const frameHeight = frame.height;
    root.position.set(0, screen.h - frameHeight);
    root.eventMode = "static";
    root.cursor = "pointer";
    const heroXpHit = minimumHitRectLocal(
      { x: 0, y: 0, w: frame.width, h: frameHeight },
      root.scale,
    );
    root.hitArea = new Rectangle(heroXpHit.x, heroXpHit.y, heroXpHit.w, heroXpHit.h);
    root.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.handleHeroXpTap();
    });
    root.addChild(frame);

    const barPosition = worldHeroXpBarPosition(DISPLAY_MODE);
    const centerY = frameHeight - barPosition.y;
    const back = pointSprite(this.textures.heroXpBar);
    back.anchor.set(0, 0.5);
    back.position.set(barPosition.x, centerY);
    const fill = pointSprite(this.textures.heroXpBar);
    fill.anchor.set(0, 0.5);
    fill.position.copyFrom(back.position);
    fill.tint = 0xff8080;
    const progress = heroXpPercent(this.deps.heroLevel, this.deps.heroTotalHighestLevels);
    const mask = new Graphics()
      .rect(barPosition.x, centerY - fill.height / 2, fill.width * progress, fill.height)
      .fill(0xffffff);
    fill.mask = mask;
    root.addChild(back, fill, mask);
    const level = makeTtfLabel(
      `${localizedString(this.deps.game.strings, "LevelShortKey")} ${this.deps.heroLevel}`,
      worldHeroXpFontSize(DISPLAY_MODE),

      { outlineAlpha: OUTLINE_FADE_ALPHA },
    );
    level.anchor.set(0, 0.5);
    level.position.set(barPosition.x + back.width + worldHeroXpLabelGap(DISPLAY_MODE), centerY);
    root.addChild(level);
    this.chrome.addChild(root);
  }

  private scheduleHeroXpClose(): void {
    if (this.heroXpCloseScheduled) return;
    this.heroXpCloseScheduled = true;
    this.heroXpInitialClosePending = true;
    const controller = new AbortController();
    this.heroXpInitialCloseController = controller;
    const cancelForLifecycle = (): void => controller.abort();
    this.lifecycle.signal.addEventListener("abort", cancelForLifecycle, { once: true });
    void tweenWithResult(
      this.deps.stage.app.ticker,
      WORLD_HERO_XP_AUTO_CLOSE_MS,
      () => undefined,
      undefined,
      controller.signal,
    ).then((result) => {
      this.lifecycle.signal.removeEventListener("abort", cancelForLifecycle);
      if (this.heroXpInitialCloseController === controller) {
        this.heroXpInitialCloseController = undefined;
      }
      if (!this.heroXpInitialClosePending) return;
      this.heroXpInitialClosePending = false;
      if (result === "completed" && !this.lifecycle.disposed && this.heroXpState === 0) {
        void this.toggleHeroXp(false);
      }
    });
  }

  private buildCaughtLabel(): void {
    const instance = this.deps.definition.instanceName;
    if (isVolcanoInfiniteDungeonInstance(instance)) {
      this.enterInfiniteDungeonFloor();
      return;
    }
    const types = this.collectionMonsterTypes();
    const caught = types.filter(this.deps.isMonsterRegistered).length;
    const template = localizedString(this.deps.game.strings, "DungeonMonstersCaughtFormatString");
    const label = makeTtfLabel(formatDungeonCaught(template, caught, types.length), 16, {
      outline: false,
    });
    label.label = "dungeonCaughtLabel";


    label.anchor.set(0, 0);
    label.position.set(5, 5);
    label.zIndex = 20;
    this.chrome.addChild(label);
  }


  private enterInfiniteDungeonFloor(): void {
    const entry = this.deps.onInfiniteDungeonFloor(this.deps.route.floor);
    // The port has no Game Center; the score submission is the one step with no local equivalent.
    this.deps.onDiagnostic?.(LEADERBOARD_PLATFORM_HOOK_MESSAGE, {
      code: LEADERBOARD_PLATFORM_HOOK_DIAGNOSTIC,
      sourceMethod: "DungeonNode.onEnterTransitionDidFinish",
      instanceName: this.deps.definition.instanceName,
      category: "DIBlueInfiniteDungeon",
      score: entry.leaderboardScore,
    });
    if (entry.unlocked) {

      void Promise.resolve(this.deps.claimTutorialFlag("NewInfiniteMonsterSlot"))
        .then((claimed) => {
          if (!claimed) return;
          return showNewInfiniteMonsterSlotTutorial(this.persistentDialogContext());
        })
        .catch((error: unknown) => { queueMicrotask(() => { throw error; }); });

      this.notifications.enqueueLocalizedMessage({
        kind: "localized-message",
        title: localizedString(this.deps.game.strings, "NewInfiniteMonsterSlotTitleKey"),
        message: localizedString(this.deps.game.strings, "NewInfiniteMonsterSlotMessageShortKey"),
        image: "Icon@2x.png",
        visible: false,
      });
    }
    void this.presentInfiniteDungeonUnlockLabel(entry.nextThreshold)
      .catch((error: unknown) => { queueMicrotask(() => { throw error; }); });
  }


  private async presentInfiniteDungeonUnlockLabel(nextFloor: number): Promise<void> {
    const font = infiniteDungeonUnlockLabelFont(DISPLAY_MODE);
    const template = localizedString(this.deps.game.strings, "InfiniteDungeonUnlockFormatKey");
    const content = formatInfiniteDungeonUnlock(template, nextFloor);
    const text = makeTtfLabel(content, font.fontSizePt, { outline: false });
    text.label = "dungeonInfiniteUnlockLabel";
    text.anchor.set(0, 0);


    const size = { w: text.width, h: text.height };
    const layout = infiniteDungeonUnlockLabelLayout(DISPLAY_MODE, size);
    const outline = outlineBackgroundNode({
      sample: () => {
        const stamp = makeTtfLabel(content, font.fontSizePt, { outline: false });
        stamp.anchor.set(0, 0);
        return stamp;
      },
      contentSize: size,
      sourcePointsPerLocalPoint: sourcePointsPerPortPoint(DISPLAY_MODE),
      radiusPt: layout.outlineWidthPt,
      color: 0x000000,
      alpha: 1,
      label: "dungeonInfiniteUnlockOutline",
    });
    // Between the backing (-9) and the text (0): the stamps share the text's own local frame, so
    // both sit at the root's origin.
    outline.zIndex = -1;

    let backing: Scale9;
    try {
      backing = await Scale9.fromConfig(
        this.deps.game.scale9,
        INFINITE_DUNGEON_UNLOCK_BACKING_CONFIG,
        this.deps.game.assets,
        size,
      );
    } catch (error) {
      text.destroy({ children: true });
      outline.destroy({ children: true });
      throw error;
    }
    if (this.lifecycle.disposed) {
      text.destroy({ children: true });
      outline.destroy({ children: true });
      backing.destroy({ children: true });
      return;
    }
    backing.label = "dungeonInfiniteUnlockBacking";
    // Cocos centres a Scale9Sprite on its position; this class lays out from its top-left corner.
    backing.position.set(
      layout.backingCenter.x - backing.contentWidth / 2,
      layout.backingCenter.y - backing.contentHeight / 2,
    );
    backing.zIndex = INFINITE_DUNGEON_UNLOCK_BACKING_Z;

    const root = new Container();
    root.label = "dungeonInfiniteUnlock";
    root.sortableChildren = true;
    root.position.set(layout.topLeft.x, layout.topLeft.y);
    root.zIndex = INFINITE_DUNGEON_UNLOCK_LABEL_Z;
    root.addChild(backing, outline, text);
    this.chrome.addChild(root);

    const done = await tweenWithResult(
      this.deps.stage.app.ticker,
      INFINITE_DUNGEON_UNLOCK_LABEL_DELAY_MS,
      () => undefined,
      undefined,
      this.lifecycle.signal,
    );
    if (done !== "completed" || this.lifecycle.disposed || root.destroyed) return;
    await tween(
      this.deps.stage.app.ticker,
      INFINITE_DUNGEON_UNLOCK_LABEL_FADE_MS,
      (t) => {
        // Two independent Cocos fades, both 1 -> 0 over the same 2.0s: one alpha ramp reproduces
        // them without the compounding a parent/child pair would introduce in Pixi.
        text.alpha = 1 - t;
        backing.alpha = 1 - t;
      },
      undefined,
      this.lifecycle.signal,
    );
    // `CCFadeAndRemove` removes the label; the backing is its child and leaves with it.
    if (root.destroyed) return;
    if (root.parent) root.parent.removeChild(root);
    root.destroy({ children: true });
  }

  private onEnterTransitionDidFinish(): void {
    this.buildCaughtLabel();
    if (this.deps.definition.presentation.style === "forest") {
      this.deps.onDiagnostic?.(FOREST_TREE_ALL_VALUES_ORDER_DIAGNOSTIC, {
        code: FOREST_TREE_ALL_VALUES_ORDER_CODE,
        sourceClass: "RoomNode",
        style: "forest",
      });
    }
  }

  private handleHeroXpTap(): void {
    // `HeroXpNode click:` gives the pending onEnter auto-close action first refusal: that first
    // tap only cancels the delay and leaves the panel expanded. Its own targeted delegate remains
    // active even while DungeonNode has locked movement/menu touches.
    if (this.heroXpInitialClosePending) {
      this.heroXpInitialClosePending = false;
      this.heroXpInitialCloseController?.abort();
      this.heroXpInitialCloseController = undefined;
      return;
    }
    if (this.heroXpState === 2) return;
    void this.toggleHeroXp(this.heroXpState === 1);
  }

  private async toggleHeroXp(expanding: boolean): Promise<void> {
    if (this.heroXpState === 2) return;
    this.heroXpState = 2;
    const from = this.heroXpRoot.x;
    const target = expanding
      ? 0
      : worldHeroXpCollapsedX(DISPLAY_MODE, this.heroXpFrameWidth);
    const result = await tweenWithResult(
      this.deps.stage.app.ticker,
      WORLD_HERO_XP_TOGGLE_MS,
      (t) => {
        this.heroXpRoot.x = from + (target - from) * t;
      },
      easeExponentialInOut,
      this.lifecycle.signal,
    );
    if (result === "completed") {
      this.heroXpRoot.x = target;
      this.heroXpState = expanding ? 0 : 1;
    }
  }

  private collectionMonsterTypes(): readonly string[] {
    return dungeonCollectionMonsterTypes(
      this.deps.definition,
      this.deps.isCollectionMonsterEligible,
    );
  }

  private renderFloor(animateCamera: boolean): void {
    // Preserve source-persistent emitters while the port replaces renderer-only RoomNode shells.
    for (const sparkle of this.chestSparkles.values()) sparkle.removeFromParent();
    for (const child of this.roomLayer.removeChildren()) child.destroy({ children: true });
    this.encounterSprites.clear();
    this.waypointSprites.clear();
    this.zoneSprites.clear();
    this.doorNodes.clear();
    for (const child of this.heroLayer.removeChildren()) child.destroy({ children: true });
    const floor = this.deps.session.state;
    const visible = new Set(dungeonVisibleRoomIds(floor));
    const snapshot = this.deps.session.snapshot();
    const cleared = new Set(snapshot.clearedEncounterIds);
    const collected = new Set(snapshot.collectedTreasureIds);
    const materializedRooms = floor.rooms.filter((room) => room.explored || visible.has(room.id));
    const presentation = this.deps.definition.presentation;
    for (const connector of dungeonConnectorTiles(materializedRooms)) {
      const connectorRoot = new Container();
      connectorRoot.label = `dungeonConnector:${connector.key}`;
      connectorRoot.position.set(connector.x, connector.y);
      connectorRoot.zIndex = presentation.style === "forest"
        ? dungeonRoomZ({ y: connector.gridY })
        : 0;
      const tile = this.themeSprite(dungeonFrameName(presentation.floorFrameFormat, this.floorFrameIndex));
      tile.label = `dungeonConnectorFloor:${connector.key}`;
      tile.zIndex = 0;
      connectorRoot.addChild(tile);
      if (presentation.floorOverlayFrame !== undefined) {
        const overlay = this.themeSprite(presentation.floorOverlayFrame);
        overlay.label = `dungeonConnectorOverlay:${connector.key}`;
        overlay.zIndex = 1;
        connectorRoot.addChild(overlay);
      }
      this.roomLayer.addChild(connectorRoot);
    }
    for (const room of materializedRooms) {
      const display = this.buildRoom(room, cleared, collected);
      this.roomLayer.addChild(display);
    }
    for (const [treasureId, sparkle] of this.chestSparkles) {
      if (sparkle.parent !== null) continue;
      sparkle.destroy({ children: true });
      this.chestSparkles.delete(treasureId);
    }
    this.hero = this.buildHero();
    this.heroLayer.addChild(this.hero);
    const screen = screenPointsForMode(DISPLAY_MODE);
    const transform = dungeonCameraTransform(floor, screen);
    if (animateCamera) {
      const from = { x: this.world.x, y: this.world.y, scale: this.world.scale.x };
      void tween(this.deps.stage.app.ticker, DUNGEON_CAMERA_MS, (t) => {
        this.world.position.set(from.x + (transform.x - from.x) * t, from.y + (transform.y - from.y) * t);
        this.world.scale.set(from.scale + (transform.scale - from.scale) * t);
      }, easeExponentialInOut, this.lifecycle.signal);
    } else {
      this.world.position.set(transform.x, transform.y);
      this.world.scale.set(transform.scale);
    }
  }

  private buildRoom(room: DungeonRoom, cleared: ReadonlySet<string>, collected: ReadonlySet<string>): Container {
    const root = new Container();
    root.label = `dungeonRoom:${room.id}`;
    const rect = dungeonRoomRect(room);
    root.position.set(rect.x, rect.y);
    root.zIndex = dungeonRoomZ(room);
    root.sortableChildren = true;
    const presentation = this.deps.definition.presentation;
    for (let y = 0; y < room.height; y++) for (let x = 0; x < room.width; x++) {
      const floor = this.themeSprite(dungeonFrameName(presentation.floorFrameFormat, this.floorFrameIndex));
      const position = dungeonFloorTilePosition(room, x, y);
      floor.position.set(position.x, position.y);
      floor.zIndex = 0;
      root.addChild(floor);
      if (presentation.floorOverlayFrame !== undefined) {
        const overlay = this.themeSprite(presentation.floorOverlayFrame);
        overlay.position.copyFrom(floor.position);
        overlay.zIndex = 1;
        root.addChild(overlay);
      }
    }
    const forestTrees = this.buildWalls(root, room);
    for (const link of room.links) {
      const north = link.offset.y === room.height;
      const door = this.themeSprite(north
        ? presentation.northDoorFrame
        : dungeonFrameName(presentation.doorFrameFormat, this.doorFrameIndex(room, link.targetRoomId)));
      const position = dungeonRoomLinkDoorPosition(room, link);
      door.anchor.set(0.5, position.anchorY);
      door.position.set(position.x, position.y);
      // Read the size before rotating: the source walk consumes `contentSize`, which stays in the
      // sprite's own unrotated frame no matter what `setRotation:` did to it.
      this.doorNodes.set(dungeonDoorNodeKey(room.id, link.targetRoomId), Object.freeze({
        x: position.x,
        y: position.y,
        width: door.width,
        height: door.height,
      }));
      door.rotation = position.rotation;
      door.zIndex = 2;


      if (presentation.style === "forest") {
        door.visible = false;
        const tree = forestTrees.get(dungeonForestTreeKey(link.offset.x, link.offset.y));
        if (tree === undefined) {
          throw new Error(`Dungeon forest room ${room.id} has no boundary tree at the ${link.targetRoomId} door`);
        }
        tree.visible = false;
      }
      root.addChild(door);
    }

    if (room.encounter !== undefined && !cleared.has(room.encounter.id)) {
      const texture = this.textures.encounterSprites.get(room.encounter.id);
      if (texture === undefined) throw new Error(`Dungeon encounter sprite is missing for ${room.encounter.id}`);
      const monster = room.encounter.monsters[0];
      if (monster === undefined) throw new Error(`Dungeon encounter ${room.encounter.id} has no presentation monster`);
      const authoredRendererData = dungeonMonsterRendererScaleData(this.deps.game, monster);
      const icon = createRenderableSpriteNode({
        texture,
        ...(authoredRendererData === undefined ? {} : { rendererData: authoredRendererData }),
        label: `dungeonEncounter:${room.encounter.id}`,
      });
      const bounds = icon.boundsArea;
      if (bounds === null) throw new Error(`Dungeon encounter ${room.encounter.id} has no authored content bounds`);
      const center = dungeonContentCenter({ x: bounds.x, y: bounds.y, w: bounds.width, h: bounds.height });
      const localContentCenter = new Point(center.x, center.y);
      icon.pivot.copyFrom(localContentCenter);


      const roomFitScale = dungeonEncounterRoomFitScale(
        { w: bounds.width, h: bounds.height },
        DISPLAY_MODE,
      );
      icon.scale.set(roomFitScale);
      const treasure = room.encounter?.treasure ?? room.treasure;
      const ownsItems = treasure !== undefined && !collected.has(treasure.id);
      icon.position.copyFrom(dungeonEncounterRoomPosition(
        room,
        ownsItems,
        room.waypoint,
        DISPLAY_MODE,
      ));


      icon.zIndex = 4;
      const outline = this.buildEncounterOutline(
        icon,
        texture,
        room.encounter.id,
        room.encounter.breeder !== undefined,
      );
      this.encounterSprites.set(room.encounter.id, Object.freeze({
        root: icon,
        localContentCenter,
        outline,
      }));
      root.addChild(icon);
    }
    const treasure = room.encounter?.treasure ?? room.treasure;
    if (treasure !== undefined && !collected.has(treasure.id)) {
      const chest = this.themeSprite(presentation.chestFrame);
      chest.label = `dungeonChest:${treasure.id}`;
      chest.anchor.set(0.5);
      chest.position.set(room.width * DUNGEON_TILE_PT - chest.width / 2, room.height * DUNGEON_TILE_PT - chest.height / 2);
      chest.zIndex = 3;
      let sparkle = this.chestSparkles.get(treasure.id);
      if (sparkle === undefined) {
        sparkle = new DungeonChestSparkles(
          this.textures.chestSparkle,
          this.deps.stage.app.ticker,
          DISPLAY_MODE,
          dungeonChestSparklePlacement(chest),
        );
        sparkle.label = `dungeonChestSparkles:${treasure.id}`;
        this.chestSparkles.set(treasure.id, sparkle);
      }
      chest.addChild(sparkle);
      root.addChild(chest);
    }
    if (room.waypoint) {
      const waypoint = this.themeSprite(presentation.portalFrame);
      waypoint.label = `dungeonWaypoint:${room.id}`;
      waypoint.anchor.set(0.5);
      waypoint.position.set(
        room.width * DUNGEON_TILE_PT - waypoint.width / 2,
        room.height * DUNGEON_TILE_PT - waypoint.height / 2,
      );
      waypoint.zIndex = 4;
      if (this.deps.session.isWaypointRegistered()) waypoint.tint = 0x96ff96;
      this.waypointSprites.set(room.id, waypoint);
      root.addChild(waypoint);
    }
    for (const zone of room.zones) {
      const frame = zone.change.kind === "stairsDown" ||
          (zone.change.kind === "dungeonExit" && zone.change.sourceType === "DungeonStairsDown")
        ? presentation.stairsDownFrame
        : presentation.stairsUpFrame;
      const sprite = this.themeSprite(frame);
      sprite.anchor.set(0.5);
      sprite.position.set(room.width * DUNGEON_TILE_PT / 2, room.height * DUNGEON_TILE_PT / 2 + 10);
      sprite.zIndex = 2;
      this.zoneSprites.set(zone.id, sprite);
      root.addChild(sprite);
    }
    return root;
  }


  private buildEncounterOutline(
    icon: Container,
    texture: Texture,
    encounterId: string,
    hasBreeder: boolean,
  ): Container {
    const spec = dungeonEncounterOutline(hasBreeder, DISPLAY_MODE);
    const content = icon.boundsArea;
    if (content === null) throw new Error("dungeon encounter outline requires authored contentSize");
    const outline = outlineBackgroundNode({
      sample: () => pointSprite(texture),
      contentSize: { w: content.width, h: content.height },
      sourcePointsPerLocalPoint: sourcePointsPerPortPoint(DISPLAY_MODE),
      radiusPt: spec.radiusPt,
      color: spec.color,
      alpha: spec.alpha,
      label: "dungeonEncounterOutline",
    });
    outline.zIndex = -1;
    icon.addChildAt(outline, 0);
    if (spec.pulse) {
      let pulse = this.breederPulseStates.get(encounterId);
      if (pulse === undefined) {
        pulse = initialDungeonBreederPulseState();
        this.breederPulseStates.set(encounterId, pulse);
      }
      outline.alpha = this.frozenBreederEncounterAlphas.get(encounterId) ??
        pulse.alpha;
    }
    return outline;
  }

  /** Returns the forest boundary trees keyed by their occupied link offset, so `buildRoom` can blank
   *  the one each doorway stands in. Non-forest rooms own no such dictionary and return empty. */
  private buildWalls(root: Container, room: DungeonRoom): ReadonlyMap<string, Sprite> {
    const presentation = this.deps.definition.presentation;
    if (presentation.style === "forest") {
      const layout = this.forestRoomLayout(room);
      const frame = dungeonWallFrameName(presentation.wallFrameFormat, layout.frameIndex, room);
      const trees = new Map<string, Sprite>();
      const placements = dungeonForestTreePlacements(room, DISPLAY_MODE);
      placements.forEach((placement, index) => {
        const tree = this.themeSprite(frame);
        tree.anchor.set(0.5, 1);
        tree.position.set(placement.x, placement.y);
        if (placement.shadow) {
          tree.alpha = DUNGEON_FOREST_SHADOW_OPACITY / 255;
          tree.tint = DUNGEON_FOREST_SHADOW_TINT;
          tree.scale.y *= DUNGEON_FOREST_SHADOW_SCALE_Y;
        }
        // The source multiplies the live `scaleX`/`scaleY` rather than assigning, which is what keeps
        // the front row's squash — and, here, the point-sprite normalization — underneath it.
        const scale = layout.scales[index];
        if (scale === undefined) throw new Error(`Dungeon forest room ${room.id} lost a tree scale draw`);
        tree.scale.set(tree.scale.x * scale, tree.scale.y * scale);
        tree.zIndex = 1;
        root.addChild(tree);
        trees.set(dungeonForestTreeKey(placement.offsetX, placement.offsetY), tree);
      });
      return trees;
    }
    // RoomNode's wall-item pass precedes its door pass. The current composite renderer does not
    // need separate item sprites, but it must retain the source's frame choices: x advances across
    // the north wall, north-door slots are skipped, and every third remaining slot gets an item.
    this.caveWallItemLayout(room);
    const wall = this.themeSprite(dungeonWallFrameName(presentation.wallFrameFormat, this.wallFrameIndex, room));
    const sourceDelta = (wall.width - room.width * DUNGEON_TILE_PT) / 2;
    wall.position.set(
      -sourceDelta,
      -sourceDelta,
    );
    wall.zIndex = 1;
    root.addChild(wall);
    return EMPTY_FOREST_TREES;
  }


  private forestRoomLayout(room: DungeonRoom): { readonly frameIndex: number; readonly scales: readonly number[] } {
    const cached = this.forestLayouts.get(room.id);
    if (cached !== undefined) return cached;
    const count = Math.max(1, this.deps.definition.presentation.wallFrameCount);
    const layout = Object.freeze({
      frameIndex: 1 + this.randomIntBelow(count),
      scales: Object.freeze(dungeonForestTreePlacements(room, DISPLAY_MODE)
        .map(() => dungeonForestTreeScale(this.randomUnit()))),
    });
    this.forestLayouts.set(room.id, layout);
    return layout;
  }


  private caveWallItemLayout(room: DungeonRoom): readonly number[] {
    const cached = this.caveWallItemFrames.get(room.id);
    if (cached !== undefined) return cached;
    const count = this.deps.definition.presentation.wallItemCount;
    const frames: number[] = [];
    for (let x = 0; x < room.width; x++) {
      if ((room.width + room.height + x) % 3 !== 0) continue;
      if (room.links.some((link) => link.offset.x === x && link.offset.y > 0)) continue;
      frames.push(count < 2 ? 1 : 1 + this.randomIntBelow(count));
    }
    const frozen = Object.freeze(frames);
    this.caveWallItemFrames.set(room.id, frozen);
    return frozen;
  }


  private doorFrameIndex(room: DungeonRoom, targetRoomId: string): number {
    const key = `${room.id}|${targetRoomId}`;
    const cached = this.doorFrameIndices.get(key);
    if (cached !== undefined) return cached;
    const count = this.deps.definition.presentation.doorFrameCount;
    const index = count < 2 ? 1 : 1 + this.randomIntBelow(count);
    this.doorFrameIndices.set(key, index);
    return index;
  }

  private randomIntBelow(count: number): number {
    return this.deps.fidelityRng?.intBelow(count) ?? Math.floor(Math.random() * count);
  }

  private randomUnit(): number {
    return this.deps.fidelityRng?.next() ?? Math.random();
  }

  private buildHero(): AnimatedSprite {
    const textures = Array.from({ length: 8 }, (_, index) => this.heroTexture(this.lastDirection, index + 1));
    const hero = new AnimatedSprite(textures);
    hero.label = "dungeonHero";
    hero.anchor.set(0.5);
    hero.animationSpeed = 1000 / DUNGEON_HERO_FRAME_MS / 60;
    hero.loop = true;
    hero.scale.set(1 / CONTENT_SCALE_FACTOR);
    const room = this.deps.session.currentRoom;
    const rect = dungeonRoomRect(room);
    hero.position.set(rect.x + rect.w / 2, rect.y + rect.h / 2);
    hero.zIndex = 100000;
    return hero;
  }

  private async handleRoomTouch(roomId: string, worldPoint: Readonly<{ x: number; y: number }>): Promise<void> {
    if (this.inputLocked) return;
    if (dungeonTouchRequiresRoomSelection(roomId, this.deps.session.state.currentRoomId)) {
      await this.selectRoom(roomId);
      return;
    }

    const room = this.deps.session.currentRoom;
    const hitZoneIds = new Set(room.zones
      .filter((zone) => {
        const sprite = this.zoneSprites.get(zone.id);
        return sprite !== undefined && this.worldPointHits(sprite, worldPoint);
      })
      .map((zone) => zone.id));
    const waypoint = this.waypointSprites.get(room.id);
    const action = dungeonSameRoomInteraction(
      room.zones.map((zone) => zone.id),
      hitZoneIds,
      waypoint !== undefined && this.worldPointHits(waypoint, worldPoint),
      room.encounter !== undefined && this.encounterSprites.has(room.encounter.id)
        ? room.encounter.id
        : undefined,
    );
    if (action.kind === "zone") {
      await this.activateZone(action.zoneId);
      return;
    }
    if (action.kind === "waypoint") {
      await this.useWaypoint();
      return;
    }
    if (action.kind === "encounter" && room.encounter !== undefined) {
      await this.triggerEncounter(room.id, room.encounter);
    }
  }

  private async selectRoom(roomId: string): Promise<void> {
    if (this.inputLocked) return;
    if (this.deps.onSelectRoom === undefined) {
      const selection = this.deps.session.selectMaterializedRoom(roomId);
      if (selection.kind === "changed-room") await this.animateRoomSelection(selection);
      return;
    }
    let acknowledged = false;
    try {
      const selection = await this.deps.onSelectRoom(roomId, (preview) => {
        if (preview.kind !== "changed-room" || this.locked) return;
        acknowledged = true;
        this.locked = true;
        const direction = preview.direction;
        if (direction !== undefined) {
          this.lastDirection = direction;
          this.hero.textures = Array.from(
            { length: 8 },
            (_, index) => this.heroTexture(direction, index + 1),
          );
          this.hero.play();
        }
      });
      if (selection.kind === "changed-room") {
        await this.animateRoomSelection(selection, acknowledged);
      } else if (acknowledged) {
        this.hero.stop();
        this.locked = false;
      }
    } catch (error) {
      if (acknowledged) {
        this.hero.stop();
        this.locked = false;
      }
      throw error;
    }
  }

  private worldPointHits(display: Container, point: Readonly<{ x: number; y: number }>): boolean {
    const bounds = display.getLocalBounds();
    const corners = [
      this.world.toLocal(display.toGlobal({ x: bounds.x, y: bounds.y })),
      this.world.toLocal(display.toGlobal({ x: bounds.x + bounds.width, y: bounds.y })),
      this.world.toLocal(display.toGlobal({ x: bounds.x, y: bounds.y + bounds.height })),
      this.world.toLocal(display.toGlobal({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })),
    ];
    const xs = corners.map(({ x }) => x);
    const ys = corners.map(({ y }) => y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return rectContainsPoint(minimumHitRectLocal({
      x,
      y,
      w: Math.max(...xs) - x,
      h: Math.max(...ys) - y,
    }, { x: 1, y: 1 }), point);
  }

  private async animateRoomSelection(
    result: Extract<DungeonRoomSelectionResult, { kind: "changed-room" }>,
    intentAlreadyAcknowledged = false,
  ): Promise<void> {
    if (this.locked && !intentAlreadyAcknowledged) return;
    this.locked = true;
    const before = this.deps.session.state.rooms.find((room) => room.id === result.fromRoomId);
    if (before === undefined) throw new Error(`Dungeon movement lost source room ${result.fromRoomId}`);
    const beforeRect = dungeonRoomRect(before);
    const after = this.deps.session.currentRoom;
    const afterRect = dungeonRoomRect(after);
    const start = { x: beforeRect.x + beforeRect.w / 2, y: beforeRect.y + beforeRect.h / 2 };
    const end = { x: afterRect.x + afterRect.w / 2, y: afterRect.y + afterRect.h / 2 };
    this.renderFloor(true);
    this.hero.position.set(start.x, start.y);

    const localDoor = result.transition === "door-walk"
      ? this.doorNodes.get(dungeonDoorNodeKey(after.id, before.id))
      : undefined;
    if (result.transition === "fade-teleport") {


      const entryActions = this.processEntryActions(result.actions);
      void entryActions.catch(() => undefined);
      try {
        await tween(this.deps.stage.app.ticker, 250, (t) => { this.hero.alpha = 1 - t; }, undefined, this.lifecycle.signal);
        this.hero.position.set(end.x, end.y);
        await tween(this.deps.stage.app.ticker, 250, (t) => { this.hero.alpha = t; }, undefined, this.lifecycle.signal);
        this.hero.stop();
        this.deps.onStateChanged();
        await entryActions;
      } finally {
        this.locked = false;
      }
      return;
    }
    if (localDoor === undefined || result.direction === undefined) {
      throw new Error(`Dungeon door-walk ${before.id} -> ${after.id} is missing its reciprocal door`);
    }
    const direction = result.direction;
    this.lastDirection = direction;
    const corner = dungeonDoorWalkTarget(localDoor);
    const door = { x: afterRect.x + corner.x, y: afterRect.y + corner.y };
    const frames = Array.from({ length: 8 }, (_, index) => this.heroTexture(direction, index + 1));
    this.hero.textures = frames;
    this.hero.play();
    const entryActions = this.processEntryActions(result.actions);
    void entryActions.catch(() => undefined);
    try {
      await tween(this.deps.stage.app.ticker, DUNGEON_WALK_LEG_MS, (t) => {
        this.hero.position.set(start.x + (door.x - start.x) * t, start.y + (door.y - start.y) * t);
      }, undefined, this.lifecycle.signal);
      const finalDirection = directionForDelta(end.x - door.x, end.y - door.y);
      this.lastDirection = finalDirection;
      this.hero.textures = Array.from({ length: 8 }, (_, index) => this.heroTexture(finalDirection, index + 1));
      await tween(this.deps.stage.app.ticker, DUNGEON_WALK_LEG_MS, (t) => {
        this.hero.position.set(door.x + (end.x - door.x) * t, door.y + (end.y - door.y) * t);
      }, undefined, this.lifecycle.signal);
      this.hero.stop();
      this.deps.onStateChanged();
      await entryActions;
    } finally {
      this.locked = false;
    }
  }

  private async processEntryActions(actions: readonly DungeonRoomEntryAction[]): Promise<void> {
    // Every exit clears the pending action deliberately. The success tail alone left a rejected
    // claim — or a disposal mid-action — reporting a treasure the node is no longer working on.
    try {
      await this.runEntryActions(actions);
    } finally {
      this.pendingAction = undefined;
    }
  }

  private async runEntryActions(actions: readonly DungeonRoomEntryAction[]): Promise<void> {
    for (const action of actions) {
      this.pendingAction = action;
      if (action.kind === "waypoint") {


        await this.deps.onWaypoint(true);
        if (this.lifecycle.disposed) return;
        void this.presentWaypointDiscovery(action.roomId).catch((error: unknown) => {
          // Presentation is deliberately fire-and-forget to match `enterLogic`; contain any
          // renderer failure so it cannot become an unhandled rejection on the dungeon ticker.
          this.deps.onDiagnostic?.("dungeon waypoint discovery presentation failed", Object.freeze({
            roomId: action.roomId,
            error: error instanceof Error ? error.message : String(error),
          }));
        });
        if (await this.deps.claimTutorialFlag("WaypointReached")) {
          // UserSavedData mounts tutorials on CCDirector.notificationNode. This persistent host
          // deliberately outlives the DungeonNode when the one-second battle transition follows.
          void showWaypointReachedTutorial(this.persistentDialogContext())
            .catch((error: unknown) => { queueMicrotask(() => { throw error; }); });
        }
      } else if (action.kind === "encounter") {
        await this.triggerEncounter(action.roomId, action.encounter);
        if (this.lifecycle.disposed) return;
      } else {
        const loot = this.deps.session.collectTreasure(action.treasure.id);
        // RoomNode clears room ownership and removes the chest before LootPageProvider is shown.
        this.renderFloor(false);
        this.lootProviderState = Object.freeze({
          treasureId: action.treasure.id,
          pendingCount: loot.length,
        });
        try {
          const claimLoot = this.deps.onLootClaim;
          await showDungeonLootManagement(
            this.dialogContext(),
            loot,
            claimLoot === undefined
              ? async (remaining) => { await this.deps.onLoot(remaining, action.treasure); }
              : (() => {
                let continuation: (() => Promise<void>) | undefined;
                return {
                  commit: async () => { continuation = await claimLoot(action.treasure); },
                  afterDismiss: async () => { await continuation?.(); },
                };
              })(),
          );
        } finally {
          this.lootProviderState = undefined;
        }
        if (this.lifecycle.disposed) return;
      }
      this.deps.onStateChanged();
      this.updateChrome();
      // A bare waypoint action leaves the live portal node in place while its source action runs.
      // Other actions own their existing redraw/removal paths.
      if (action.kind !== "waypoint") this.renderFloor(false);
    }
  }

  private async presentFloorDetectionChat(): Promise<void> {
    if (!this.deps.claimFloorPresence()) return;
    await this.entranceSelectorPresented;
    if (this.lifecycle.disposed) return;
    const rooms = this.deps.session.state.rooms;
    const key = dungeonFloorDetectionChatKey(
      rooms.some((room) => room.encounter?.breeder !== undefined),
      rooms.some((room) => room.waypoint),
    );
    if (key === undefined) return;
    const message = localizedString(this.deps.game.strings, `${key}ChatKey`);
    this.floorDetectionChat = Object.freeze({ key, message });
    this.floorDetectionChatHandle = await showDungeonFloorDetectionChat({
      parent: this.notifications,
      assets: this.deps.game.assets,
      scale9: this.deps.game.scale9,
      ticker: this.deps.stage.app.ticker,
      mode: DISPLAY_MODE,
      key,
      message,
      onDismiss: () => {
        this.floorDetectionChat = undefined;
        this.floorDetectionChatHandle = undefined;
      },
    });
  }

  /** Web-native Enter/Space seam for the live chained-text floor notice. */
  advanceKeyboardText(): boolean {
    const node = this.floorDetectionChatHandle?.root;
    if (node === undefined || node.destroyed) return false;
    node.emit("pointertap", undefined as unknown as FederatedPointerEvent);
    return true;
  }

  /** Web-native Enter/Space seam for the current numeric waypoint selection. */
  confirmKeyboardDialog(): boolean {
    const confirm = this.waypointKeyboardConfirm;
    if (confirm === undefined) return false;
    confirm();
    return true;
  }


  dismissTopPopup(): boolean {
    if (this.dismissFloorDetectionChat()) return true;
    return PopupHost.for(this.popupRoot).dismissTop() ||
      PopupHost.for(this.notifications).dismissTop();
  }

  /** True while the notice owns the band, whether or not its launch guard let this close it. */
  private dismissFloorDetectionChat(): boolean {
    const handle = this.floorDetectionChatHandle;
    if (handle === undefined || handle.root.destroyed) return false;
    handle.dismiss();
    return true;
  }

  /** Web-native equivalent of tapping the retained dungeon menu button. */
  requestMenu(): boolean {
    if (this.inputLocked) return false;
    void this.deps.onMenu();
    return true;
  }

  /** Cardinal keyboard movement uses the engine's direct-link seam, then the same two-leg door
   * presentation and entry-action processing as a pointer-selected adjacent room. */
  requestDirectionalMove(direction: DungeonDirection): boolean {
    if (
      this.inputLocked ||
      this.floorDetectionChat !== undefined ||
      PopupHost.for(this.popupRoot).modalDepth > 0 ||
      PopupHost.for(this.notifications).modalDepth > 0
    ) return false;
    if (!this.deps.session.availableDirections().includes(direction)) return true;
    if (this.deps.onSelectRoom === undefined) {
      const moved = this.deps.session.move(direction);
      void this.animateRoomSelection({
        kind: "changed-room",
        fromRoomId: moved.fromRoomId,
        toRoomId: moved.toRoomId,
        transition: "door-walk",
        direction: moved.direction,
        actions: moved.actions,
      });
      return true;
    }
    const targetRoomId = this.deps.session.linkedRoomId(direction);
    if (targetRoomId === undefined) {
      throw new Error(`Dungeon ${direction} movement lost its linked room`);
    }
    void this.selectRoom(targetRoomId)
      .catch((error: unknown) => {
        this.deps.onDiagnostic?.("authoritative dungeon movement failed", Object.freeze({
          direction,
          targetRoomId,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
    return true;
  }

  private async activateZone(zoneId: string): Promise<void> {
    if (this.locked) return;
    this.locked = true;
    try {
      const transition = await this.deps.onActivateZone(zoneId);
      if (transition === undefined) {
        this.deps.onDiagnostic?.("ignored stale dungeon zone touch", Object.freeze({
          zoneId,
          sceneRoomId: this.deps.session.state.currentRoomId,
        }));
        return;
      }
      this.deps.onStateChanged();
      if (transition.kind === "blocked") {
        await showDungeonMessage(
          this.dialogContext(),
          "FloorNotClearTitleKey",
          "FloorNotClearMessageKey",
        );
        return;
      }
      this.deps.audio.playSfx("Stairs_EnterDungeon");
      await this.deps.onTransition(transition);
    } finally {
      this.locked = false;
    }
  }

  private async triggerEncounter(roomId: string, encounter: DungeonEncounter): Promise<void> {
    this.locked = true;
    const request = Object.freeze({ encounter, roomId, definition: this.deps.definition });
    // Native assets are already resident when triggerBattle begins. Start the web preload at the
    // same touch boundary so the fixed flourish does not finish into a visible loading pause.
    const preparing = Promise.resolve(this.deps.onPrepareEncounter?.(request));
    // Observe a fast rejection immediately; the same promise is handed to the transition owner
    // after the fixed flourish so the failure still reaches the owning interaction without an
    // interim unhandled rejection.
    void preparing.catch(() => undefined);
    const screen = screenPointsForMode(DISPLAY_MODE);
    const forced = dungeonCameraTransform(this.deps.session.state, screen, 1.5);
    const cameraFrom = { x: this.world.x, y: this.world.y, scale: this.world.scale.x };
    const presentation = this.encounterSprites.get(encounter.id);
    const icon = presentation?.root;
    let iconFrom: { x: number; y: number; scaleX: number; scaleY: number } | undefined;
    if (presentation !== undefined) {
      const globalCenter = presentation.root.toGlobal(presentation.localContentCenter);
      const preservedCenter = this.pointRoot.toLocal(globalCenter);
      const icon = presentation.root;
      iconFrom = {
        x: preservedCenter.x,
        y: preservedCenter.y,
        // Native preserves only the content-center position across the reparent. The room-fit
        // root scale remains F (it is not multiplied by scrollableScene's current camera scale).
        scaleX: icon.scale.x,
        scaleY: icon.scale.y,
      };


      if (encounter.breeder !== undefined) {
        this.frozenBreederEncounterAlphas.set(encounter.id, presentation.outline.alpha);
      }
      icon.removeFromParent();
      icon.position.set(iconFrom.x, iconFrom.y);
      icon.scale.set(iconFrom.scaleX, iconFrom.scaleY);
      icon.zIndex = 999;
      icon.eventMode = "none";
      this.pointRoot.addChild(icon);
    }
    await Promise.all([
      tween(this.deps.stage.app.ticker, DUNGEON_CAMERA_MS, (t) => {
        this.world.position.set(
          cameraFrom.x + (forced.x - cameraFrom.x) * t,
          cameraFrom.y + (forced.y - cameraFrom.y) * t,
        );
        this.world.scale.set(cameraFrom.scale + (forced.scale - cameraFrom.scale) * t);
      }, easeExponentialInOut, this.lifecycle.signal),
      icon === undefined || iconFrom === undefined
        ? Promise.resolve()
        : tween(this.deps.stage.app.ticker, 1000, (t) => {
          icon.position.set(
            iconFrom.x + (screen.w / 2 - iconFrom.x) * t,
            iconFrom.y + (screen.h / 2 - iconFrom.y) * t,
          );
        }, undefined, this.lifecycle.signal),
      icon === undefined || iconFrom === undefined
        ? Promise.resolve()
        : tween(this.deps.stage.app.ticker, 1000, (t) => {
          icon.scale.set(
            iconFrom.scaleX + (1 - iconFrom.scaleX) * t,
            iconFrom.scaleY + (1 - iconFrom.scaleY) * t,
          );
        }, easeSineInOut, this.lifecycle.signal),
      tween(this.deps.stage.app.ticker, 1000, () => undefined, undefined, this.lifecycle.signal),
    ]);
    try {


      await this.deps.onEncounter(request, preparing);
    } finally {
      if (!this.lifecycle.disposed) this.locked = false;
    }
  }

  private async presentWaypointDiscovery(roomId: string): Promise<void> {
    if (!this.waypointSprites.has(roomId)) return;


    let flashTarget: Sprite | undefined;
    let flashOverlay: SourceFlashingSprite | undefined;
    let flashFailure: unknown;
    const retireFlashOverlay = (): void => {
      const overlay = flashOverlay;
      flashOverlay = undefined;
      if (overlay === undefined) return;
      try {
        overlay.destroy();
      } catch (error) {
        flashFailure ??= error;
      }
    };
    const recordFlashFailure = (error: unknown): void => {
      flashFailure ??= error;
      retireFlashOverlay();
    };
    const updateFlashUnsafe = (t: number): void => {
      const waypoint = this.waypointSprites.get(roomId);
      if (waypoint === undefined || waypoint.destroyed || waypoint.parent === null) {
        retireFlashOverlay();
        flashTarget = undefined;
        return;
      }

      // `renderFloor` replaces RoomNode shells. Rebind the renderer-only overlays if another entry
      // action redraws the floor while the native-equivalent action is still in flight.
      if (waypoint !== flashTarget) {
        retireFlashOverlay();
        waypoint.alpha = 1;
        waypoint.tint = 0xffffff;
        flashTarget = waypoint;
        flashOverlay = new SourceFlashingSprite(waypoint.parent, waypoint);
      }

      // A renderer failure degrades to the continuously visible white base, never to the reported
      // whole-sprite disappearance. The tint phase still runs and reaches the registered state.
      waypoint.alpha = 1;
      waypoint.tint = 0xffffff;
      flashOverlay?.setFlashOpacity(flashActionOpacity(t, 2));
    };
    const updateFlash = (t: number): void => {
      try {
        updateFlashUnsafe(t);
      } catch (error) {
        // This callback runs inside Pixi's ticker. `tweenWithResult` does not catch update errors,
        // and this source-nonblocking sequence is intentionally launched without awaiting it.
        recordFlashFailure(error);
      }
    };

    try {
      updateFlash(0); // `FlashAction.startWithTarget:` explicitly writes flashOpacity = 0.
      await tween(
        this.deps.stage.app.ticker,
        2000,
        updateFlash,
        undefined,
        this.lifecycle.signal,
      );
    } finally {
      retireFlashOverlay();
    }
    if (flashFailure !== undefined && !this.lifecycle.disposed) {
      this.deps.onDiagnostic?.("dungeon waypoint discovery flash degraded", Object.freeze({
        roomId,
        error: flashFailure instanceof Error ? flashFailure.message : String(flashFailure),
      }));
    }
    if (this.lifecycle.disposed) return;

    await tween(this.deps.stage.app.ticker, 1000, (t) => {
      const waypoint = this.waypointSprites.get(roomId);
      if (waypoint === undefined || waypoint.destroyed) return;
      waypoint.alpha = 1;
      waypoint.tint = rgb(
        255 + (150 - 255) * t,
        255,
        255 + (150 - 255) * t,
      );
    }, undefined, this.lifecycle.signal);
    const waypoint = this.waypointSprites.get(roomId);
    if (waypoint !== undefined && !waypoint.destroyed) {
      waypoint.alpha = 1;
      waypoint.tint = 0x96ff96;
    }
  }

  private async useWaypoint(): Promise<void> {
    if (this.locked) return;
    this.locked = true;
    try {
      await this.openWaypoint(true);
      if (!this.lifecycle.disposed) this.deps.onStateChanged();
    } finally {
      this.locked = false;
    }
  }

  private async openWaypoint(showNowhere: boolean, nonBlocking = false): Promise<boolean> {
    const destinations = await this.deps.onWaypoint(false);
    if (this.lifecycle.disposed) return false;
    if (waypointFloorOptions(
      this.deps.route,
      destinations,
      this.deps.definition.creation.lastFloor,
    ).length === 0) {
      if (showNowhere) {
        await showDungeonMessage(
          this.dialogContext(),
          "WaypointNowhereToGoTitleKey",
          "WaypointNowhereToGoMessageKey",
        );
      }
      return false;
    }
    // The source turn raises the selector first and the floor notice second, so the notice is the
    // later insert that covers it. Both are async here, so the notice waits on this mount rather
    // than racing the selector's asset load and landing underneath it.
    let markPresented: () => void = () => {};
    if (nonBlocking) {
      this.entranceSelectorPresented = new Promise<void>((resolve) => { markPresented = resolve; });
    }
    const selection = chooseDungeonWaypoint(
      this.dialogContext(),
      this.deps.route,
      destinations,
      this.deps.definition.creation.lastFloor,
      () => markPresented(),
    );
    if (nonBlocking) {
      void selection
        .then(async (destination) => {
          if (destination === undefined || this.lifecycle.disposed) return;
          await this.travelToWaypoint(destination);
        })
        .catch((error: unknown) => { queueMicrotask(() => { throw error; }); })
        // A cancelled owner token retires a still-loading popup without ever presenting it; the
        // notice must not wait forever on a selector that will never mount.
        .finally(() => markPresented());
      // Native showWaypointSelection returns as soon as the selector is dispatched. Popup asset
      // loading and dismissal are owned by the scene and do not gate the following entry phases.
      return true;
    }
    const destination = await selection;
    if (destination === undefined || this.lifecycle.disposed) return false;
    await this.travelToWaypoint(destination);
    return true;
  }

  private async travelToWaypoint(destination: DungeonRouteDescriptor): Promise<void> {
    // The entrance selector is detached from start(): dismissing it must not expose the old
    // floor while the authority commits travel and the replacement scene loads. Keep separate
    // ownership so a finishing room-entry animation cannot release this transition's input.
    if (this.waypointTravelPending || this.lifecycle.disposed) return;
    this.waypointTravelPending = true;
    try {
      await this.deps.onWaypointTravel(destination);
    } finally {
      this.waypointTravelPending = false;
    }
  }

  private dialogContext() {
    return {
      parent: this.notificationParent,
      owner: this.notificationOwner,
      game: this.deps.game,
      audio: this.deps.audio,
      ticker: this.deps.stage.app.ticker,
      onWaypointSelectionChanged: (state: WaypointSelectionState | undefined) => {
        this.waypointSelectionState = state;
      },
      setWaypointKeyboardConfirm: (confirm: (() => void) | undefined) => {
        this.waypointKeyboardConfirm = confirm;
      },
    } as const;
  }

  /** Director-owned popup context used by tutorials that survive scene replacement. */
  private persistentDialogContext() {
    return {
      parent: this.notifications,
      owner: this,
      game: this.deps.game,
      audio: this.deps.audio,
      ticker: this.deps.stage.app.ticker,
    } as const;
  }

  private themeSprite(name: string): Sprite {
    const texture = this.textures.theme.get(name);
    if (texture === undefined) throw new Error(`Dungeon theme atlas is missing ${name}`);
    return pointSprite(texture);
  }

  private heroTexture(direction: DungeonDirection, frame: number): Texture {
    const name = dungeonHeroFrameName(direction, frame);
    const texture = this.textures.hero.textures[name];
    if (texture === undefined) throw new Error(`HeroWalkFrames-hd is missing ${name}`);
    return texture;
  }

  setSceneVisible(visible: boolean): void {
    this.pointRoot.visible = visible;
    this.popupRoot.visible = visible;
    // HeroXpNode schedules its initial close from onEnter, which corresponds to first activation,
    // not construction (asset loading) or DungeonNode's later transition-finished entry logic.
    if (visible) this.scheduleHeroXpClose();
  }

  renderGameState(): Record<string, unknown> {
    const floor = this.deps.session.state;
    const camera = dungeonCameraTransform(floor, screenPointsForMode(DISPLAY_MODE));
    const visible = new Set(dungeonVisibleRoomIds(floor));
    const materializedRooms = floor.rooms.filter((room) => room.explored || visible.has(room.id));
    const menuState = this.deps.menuState?.();
    return {
      mode: "dungeon",
      instanceName: this.deps.definition.instanceName,
      sourceFile: this.deps.definition.sourceFile,
      dungeonType: this.deps.definition.typeName,
      floor: floor.floor,
      seed: this.deps.session.snapshot().seed,
      challengeLevel: floor.challengeLevel,
      currentRoomId: floor.currentRoomId,
      availableDirections: this.deps.session.availableDirections(),
      remainingEncounters: this.deps.session.remainingEncounterCount(),
      locked: this.inputLocked,
      started: this.started,
      hero: {
        x: this.hero.x,
        y: this.hero.y,
        alpha: this.hero.alpha,
        playing: this.hero.playing,
      },
      pendingAction: this.pendingAction?.kind,
      waypointSelection: this.waypointSelectionState,
      floorDetectionChat: this.floorDetectionChat,
      popups: {
        scene: PopupHost.for(this.popupRoot).debugState,
        persistent: PopupHost.for(this.notifications).debugState,
      },
      lootProvider: this.lootProviderState,
      catchQuest: this.deps.session.catchQuestProgress(),
      menu: menuState?.menu ?? null,
      sceneFade: menuState?.sceneFade,
      overlay: menuState?.overlay ?? null,
      camera,
      renderedRoomIds: materializedRooms.map((room) => room.id),
      connectors: dungeonConnectorTiles(materializedRooms),
      rooms: floor.rooms.map((room) => ({
        id: room.id, x: room.x, y: room.y, width: room.width, height: room.height,
        links: room.links, explored: room.explored, waypoint: room.waypoint,
        encounter: room.encounter?.id, treasure: (room.encounter?.treasure ?? room.treasure)?.id,
        zones: room.zones.map((zone) => ({
          id: zone.id,
          kind: zone.change.kind,
          ...(zone.change.kind === "dungeonExit" || zone.change.kind === "worldExit"
            ? { instanceName: zone.change.instanceName }
            : {}),
        })),
      })),
      chestSparkles: [...this.chestSparkles.entries()].map(([treasureId, sparkle]) => ({
        treasureId,
        particleCount: sparkle.particleCount,
        particleTopology: sparkle.particleTopology,
        particleBlendMode: sparkle.particleBlendMode,
        emitterPosition: sparkle.sourcePosition,
        pixiLocalPosition: { x: sparkle.x, y: sparkle.y },
        positionVariance: sparkle.positionVariance,
      })),
      diagnostics: floor.diagnostics,
      runtimeDiagnostics: this.deps.diagnostics?.() ?? [],
      chrome: {
        heroXpExpanded: this.heroXpState === 0,
        heroXpMoving: this.heroXpState === 2,
        heroXpInitialClosePending: this.heroXpInitialClosePending,
        caught: this.deps.definition.instanceName === "Volcano" ||
            this.deps.definition.instanceName === "VolcanoB"
          ? undefined
          : (() => {
              const types = this.collectionMonsterTypes();
              return {
                current: types.filter(this.deps.isMonsterRegistered).length,
                total: types.length,
              };
            })(),
        namePlate: this.notifications.debugState.namePlate,
      },
    };
  }

  destroy(): void {
    if (this.lifecycle.disposed) return;
    this.floorDetectionChatHandle?.dismiss(true);
    this.floorDetectionChatHandle = undefined;
    // Cancel owner-bound async popup construction before destroying the roots. A catch-quest or
    // waypoint builder that is still loading must not mount into a retired DungeonNode.
    PopupHost.for(this.popupRoot).dismissOwnedBy(this);
    PopupHost.for(this.popupRoot).dismissAll();
    this.lifecycle.dispose();
  }
}

/** One flat map standing in for the source's per-`RoomNode` `doors` dictionary. */
function dungeonDoorNodeKey(roomId: string, targetRoomId: string): string {
  return `${roomId}\u0000${targetRoomId}`;
}

function directionForDelta(dx: number, dy: number): DungeonDirection {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function rgb(red: number, green: number, blue: number): number {
  return (Math.round(red) << 16) | (Math.round(green) << 8) | Math.round(blue);
}

function requiredTexture(sheet: Spritesheet, name: string): Texture {
  const texture = sheet.textures[name];
  if (texture === undefined) throw new Error(`General-hd is missing ${name}`);
  return texture;
}

function stem(path: string): string {
  const slash = path.lastIndexOf("/");
  const base = slash === -1 ? path : path.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? base : base.slice(0, dot);
}

function dungeonMonsterSpriteKey(
  game: LoadedGame,
  monster: DungeonEncounter["monsters"][number],
): string {
  const rendererData = monster.extraLivingArguments?.["rendererData"];
  if (rendererData !== null && typeof rendererData === "object" && !Array.isArray(rendererData)) {
    const file = (rendererData as Readonly<Record<string, unknown>>)["spriteFile"];
    if (typeof file === "string" && /\.png$/i.test(file)) {
      const base = stem(file);
      if (game.assets.hasSprite(`${base}-hd`)) return `${base}-hd`;
      if (game.assets.hasSprite(base)) return base;
    }
  }
  const hd = `${monster.type}-hd`;
  return game.assets.hasSprite(hd) ? hd : monster.type;
}

function dungeonMonsterRendererScaleData(
  game: LoadedGame,
  monster: DungeonEncounter["monsters"][number],
): Readonly<{ scale: number }> | undefined {
  const override = monster.extraLivingArguments?.["rendererData"];
  const rendererData = override ?? game.gd.monsterByShortType(monster.type).rendererData;
  if (rendererData === undefined) return undefined;
  if (rendererData === null || typeof rendererData !== "object" || Array.isArray(rendererData)) {
    throw new Error(`Dungeon monster ${monster.type} rendererData must be an object`);
  }
  const scale = (rendererData as Readonly<Record<string, unknown>>)["scale"];
  if (scale === undefined) return undefined;
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    throw new Error(`Dungeon monster ${monster.type} rendererData.scale must be finite`);
  }
  return Object.freeze({ scale });
}
