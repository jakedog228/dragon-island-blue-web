import { officialReconnectEnemyTeam } from "./authority/battleAppearance.js";
// Keep Pixi's deterministic renderer implementations installed before any renderer construction.
// Full-trust Offline mods now deliberately allow same-realm evaluation; this import still avoids
// swapping Pixi implementations depending on whether a profile happens to be selected.
import "pixi.js/unsafe-eval";
import { Graphics, type Container } from "pixi.js";
import type { PresentationEventV1 } from "@dib/game-protocol";
import {
  FixedStage,
  bitmapFontFile,
  SHIPPED_BITMAP_FONT_SIZES,
  configureTtfTextResolution,
} from "@dib/renderer";
import {
  AUDIO_CONFIG,
  DISPLAY_MODE,
  TEXT_RESOLUTION_MODE,
  refreshRuntimeSettings,
} from "./runtimeSettings.js";
import { combatBackgroundSpriteKey, stagePixelsForMode, screenPointsForMode } from "./displayMode.js";
import {
  loadChatDefinition,
  loadTownPortalDestinations,
  loadQuestCatalog,
  loadDungeonData,
  loadWorldData,
  resolveTownPortalDestination,
  type DungeonDefinition,
  type WorldData,
  type TournamentDef,
} from "@dib/gamedata/browser";
import {
  ARENA_COMBAT_BACKGROUND_FILE,
  installedBattleBackgroundFile,
} from "./authority/battleScene.js";
import { rehydrateOfficialBattleWinChat } from "./authority/battleLifecycleChat.js";
import { loadGame } from "./loadGame.js";
import { AudioPlayer } from "./audio.js";
import { computePreloadPlan } from "./battle/preloadPlan.js";
import { BattleNode, type DefeatRecoveryAdapter } from "./battle/battleNode.js";
import {
  createWorldTripSharedState,
  advanceWorldDay,
  canOfferSaveMe,
  buildLicenseChallengeEncounter,
  buildTournamentEncounter,
  emptyGuildQuestStateSnapshot,
  GuildQuestRuntime,
  replayableRng,
  type Rng,
  dungeonRunUsesLegacyTopology,
  dungeonDefinitionId,
  type BattleReplaySnapshotV1,
  type ReplayableRng,
  type TeamMemberSetup,
  type GuildQuestEvent,
  type GuildQuestEventResult,
  type GuildQuestStateSnapshot,
  type PlayerReward,
  type WorldTripSharedState,
} from "@dib/engine";
import {
  battleSpriteKey,
  DEMO_ENCOUNTER,
  DEMO_FEATURE_ROLLS,
  type EncounterConfig,
} from "./battle/encounter.js";
import { encounterUsesKnownMonsters, rosterRng, sampleEncounter } from "./battle/rosterSampler.js";
import { createTickerAdvancer, tween } from "./tween.js";
import { allUnlockedPlayerCollection, demoPlayerCollection } from "./player/playerCollection.js";
import {
  DEMO_PLAYER_PROFILE_DEFAULTS,
  establishedPlayerTutorialFlags,
  sourceNewGameProfileDefaults,
} from "./player/demoPlayerProfile.js";
import { loadRequiredLocalFonts } from "./localFonts.js";
import { restrictPlayerProfileToRoster, type PlayerProfileConfig } from "./player/playerProfile.js";
import { PlayerRuntimeState, type PlayerRuntimeStateSnapshot } from "./player/playerRuntimeState.js";
import { StoreFlow } from "./player/storeFlow.js";
import { purchaseStoreStock } from "@dib/player-domain";
import { earnedLicenseWinDialogs } from "./player/licenseDialogRepair.js";
import { SaveHealthMonitor } from "./player/saveHealth.js";
import { installSaveHealthBanner } from "./ui/saveHealthBanner.js";
import {
  describeStoragePersistence,
  isUnderStoragePressure,
  requestPersistentStorage,
} from "./player/storagePersistence.js";
import {
  acquireLocalContent,
  type AcquiredContent,
} from "./content/contentGate.js";
import {
  officialProjectionDungeonRun,
  projectionToGameState,
} from "./authority/officialAuthoritySaveStore.js";
import { localGuildQuestEventOption } from "./authority/questAuthorityBoundary.js";
import {
  createOfficialDefeatRecoveryAdapter,
  resolveOfficialDefeatReturn,
} from "./authority/officialDefeatRecovery.js";
import type { ImportedContentPackage } from "./content/archivePackage.js";
import { hasImportedModProfile } from "./content/moddedContent.js";
import { identifyContentLogicPack } from "./content/logicPackIdentity.js";
import { pvpModEnabled } from "./pvp/pvpMod.js";
import { PvpClient } from "./pvp/pvpClient.js";
import { showPvpFlow } from "./pvp/pvpFlow.js";
import { assertOfficialContentBoundary } from "./content/onlineModBoundary.js";
import { runStartupSequence, type StartupLoadTask } from "./startup/startupSequence.js";
import { runSourceBlackSceneFade } from "./sourceSceneFade.js";
import { SOURCE_BLACK_SCENE_FADE_HALF_MS } from "./sourceSceneFadeMath.js";
import { StartupDiagnostics, type StartupPhase } from "./startup/startupDiagnostics.js";
import { createStartupSpritePreloadTasks } from "./startup/startupPreloadPlan.js";
import {
  WorldNode,
  type ArenaChallengeRequest,
  type TournamentBattleRequest,
  type WorldEncounterRequest,
  type WorldExitRequest,
} from "./world/worldNode.js";
import type { HighscoresViewer } from "./world/highscoresScreen.js";
import {
  createBlackMarketDemoExternalPageOpener,
  createBlackMarketDemoImageLoader,
} from "./world/blackMarketDemoCapabilities.js";
import { blackMarketServiceReady } from "./world/blackMarketAvailability.js";
import { EggHatchFlow, type EggHatchFlowOptions } from "./world/eggHatchFlow.js";
import {
  createOfficialEggHatchSession,
  type OfficialEggHatchAuthority,
} from "./world/eggHatchSession.js";
import {
  createLocalCollectionDialogRuntime,
  createLocalCollectionAdapter,
  createOfficialCollectionAdapter,
} from "./world/collectionFlow.js";
import {
  DEMO_WORLD_CONFIG,
  createRandomDemoParty,
  createSourceNewGameParty,
  createWorldTrip,
  recordDemoEvolutionHistory,
} from "./world/worldDemoState.js";
import { SOURCE_STARTER_CHOICES } from "./ui/plotGameFlowMath.js";
import {
  isTownPortalOutgoingScene,
  WORLD_RETURN_FADE_MS,
  worldTransitionPresentation,
} from "./world/worldDisplayMath.js";
import { createWorldPoiRoutingPolicy, type WorldSceneRequest } from "./world/worldPoiRouting.js";
import { worldBattleReturnsToOriginTown } from "./world/worldBattleReturnPolicy.js";
import { SceneCoordinator, SceneHandlerRegistry } from "./sceneCoordinator.js";
import {
  DungeonFeatureController,
  type PreparedAuthoritativeDungeonRun,
  type DungeonCapableScene,
} from "./dungeon/installDungeonFeature.js";
import { recoverIncompatibleLocalDungeonSave } from "./dungeon/localDungeonSaveRecovery.js";
import {
  LocalDungeonTerminal,
  type LocalDungeonTerminalApplication,
  type LocalDungeonCaptureIdentity,
  type LocalDungeonTerminalOutcome,
  stageLocalDungeonRng,
} from "./dungeon/localDungeonTerminal.js";
import type {
  DungeonRouteDescriptor,
  DungeonRunSnapshot,
  DungeonRuntimeContext,
  DungeonTerminalFlowIdentity,
} from "@dib/engine/dungeon-runtime";
import { createFidelityLabRuntime } from "./debug/fidelityLabRuntime.js";
import {
  commitOfficialProjectionAdoption,
  prepareOfficialProjectionAdoption,
} from "./authority/officialProjectionAdoption.js";
import {
  restoreWorldTripSharedState,
  snapshotWorldProgress,
  type PlayerGameStateSnapshot,
  type WorldProgressStateSnapshot,
} from "./player/gameState.js";
import { KeyboardShortcutRouter } from "./keyboardShortcuts.js";
import {
  WorldNotificationHost,
  type LocalizedMessageNotificationState,
} from "./world/worldNotificationHost.js";
import {
  acceptedGuildQuestNotification,
  committedGuildQuestNotifications,
  progressGuildQuestNotification,
  type GuildQuestNotificationState,
} from "./world/guildQuestNotifications.js";
import { guildQuestProgress, guildQuestTitle } from "./world/guildQuestText.js";
import {
  buildWorldBattle,
  withWorldBattleSaveMePolicy,
} from "./world/worldBattle.js";
import {
  showCommittedStoreLootManagement,
  showDungeonLootManagement,
} from "./dungeon/dungeonLootPageProvider.js";
import { applyPlayerRewards } from "./player/rewards.js";
import { showGuildQuestChat } from "./world/guildQuestChat.js";
import { localizedString } from "./localization.js";
import { showNarratedPlot } from "./startup/newGameFlow.js";
import {
  runOfficialTournamentSaveMeReconnect,
  runTournamentRetreatReturn,
} from "./player/tournamentRetreat.js";
import { arenaExitDisposition } from "./player/arenaExit.js";
import type { ScenarioRuntime } from "./debug/scenarioMode.js";
import type { InstalledSlotProjection } from "./authority/gameAuthorityClient.js";
import { installAppViewportSizing, installGameViewport } from "./platform/gameViewport.js";
import {
  initialWorldBootRoute,
  resolveRestoredTownDestination,
  restoredTownMetadata,
} from "./world/worldBootRoute.js";

/** GUI/battle sfx BattleNode plays by name (not ability-kit sfx, which come from the preload plan).
 *  Preloaded up front so `AudioPlayer.playSfx` never fails loud on a battle-scene sound. Music
 *  tracks (Battle1..7, Win1 — all .mp3) are NOT in this list: they stream through the exclusive
 *  music channel (audio.ts playMusic), and preloadSfx rejects them by design. */
const GUI_SFX = [
  "Encounter", "click", "notAllowed", "CaptureSuccess", "CaptureFail", "Escape",
] as const;

type AppScene = DungeonCapableScene;
type ShellMode = "content" | "loading" | "start";
// Capture this once, before the app installs its own `advanceTime` hook. In-memory renderer
// restarts must retain the initial runtime kind instead of treating that app-owned hook as a
// newly-arrived deterministic browser harness and stopping the replacement ticker.
const DETERMINISTIC_HARNESS = typeof
  (globalThis as Record<string, unknown>)["advanceTime"] === "function";
const FIDELITY_LAB = createFidelityLabRuntime();
if (FIDELITY_LAB !== undefined) {



  (globalThis as Record<string, unknown>)["__DIB_FIDELITY_LAB_ANCHOR__"] =
    (rawState: number, nativeCalls?: number) => FIDELITY_LAB.anchor(rawState, nativeCalls);
}
installAppViewportSizing();

interface BootOptions {
  readonly acquired?: AcquiredContent;
  readonly audio?: AudioPlayer;
  readonly autoLaunchSlotId?: import("@dib/save-protocol").SaveSlotId;
  readonly presentationResumeMode?: "world" | "town" | "dungeon";
  readonly resumeStartupAtSaveSelect?: boolean;
  /** Completes a MainMenuMenuItem black fade whose first half ran on the retired gameplay stage. */
  readonly startStartupCovered?: boolean;
}

async function boot(options: BootOptions = {}): Promise<void> {
  const host = document.getElementById("app");
  if (!host) throw new Error("#app missing");
  const scenes = new SceneCoordinator<AppScene, ShellMode>("content");
  const startupDiagnostics = new StartupDiagnostics();
  (globalThis as Record<string, unknown>)["render_game_to_text"] = (): string =>
    JSON.stringify({ mode: scenes.mode, startup: startupDiagnostics.snapshot() });
  const acquired = options.acquired ?? await acquireLocalContent(host);
  assertOfficialContentBoundary(acquired);
  const { content, official } = acquired;
  const mods = hasImportedModProfile(content) ? content.mods : undefined;
  await mods?.runPhase("boot:starting", { host, acquired, content, scenes, startupDiagnostics });
  const renderHost = installGameViewport(host);
  // The public most-XP board behind the source `Highscores` row. Built once and shared by every
  // host that can raise the Master Menu; `undefined` in archive play, which keeps the row inert.
  const officialScoreboard = official?.authority.scoreboard === undefined
    ? undefined
    : {
        fetch: official.authority.scoreboard,
        // Read per render rather than captured: the Options panel can flip the opt-in while the
        // board is open, and the footer has to follow it.
        viewer: (): HighscoresViewer | undefined => {
          const account = official.authority.account?.current();
          return account === undefined
            ? undefined
            : { username: account.username, publicScoreboard: account.publicScoreboard };
        },
      };
  let saveStore = acquired.saveStore;
  let scenarioRuntime: ScenarioRuntime | undefined;
  // Ask before the first checkpoint: browser-local saves otherwise sit in best-effort storage the
  // browser may evict, and a quota already near its ceiling should be reported, not discovered
  // when a write starts failing.
  let storageSummary: string;
  if (acquired.scenario === undefined) {
    const storageReport = await requestPersistentStorage();
    storageSummary = describeStoragePersistence(storageReport);
    if (isUnderStoragePressure(storageReport)) console.warn(`[save] ${storageSummary}`);
    else console.info(`[save] ${storageSummary}`);
  } else {
    storageSummary = `Scenario storage is transient (${acquired.scenario.configuration.transport}).`;
    console.info(`[save] ${storageSummary}`);
  }
  startupDiagnostics.patch({ storage: storageSummary });
  scenes.setShellMode("loading");



  let bridgedPhase: StartupPhase | undefined;
  const stopStartupModeSync = startupDiagnostics.subscribe(({ phase }) => {
    if (phase === bridgedPhase) return;
    bridgedPhase = phase;
    scenes.setShellMode(phase === "preloader" ? "loading" : "start");
  });
  activeContent = content;
  globalThis.addEventListener("pagehide", () => content.dispose(), { once: true });
  // Stage size follows the persisted Options selection: 960x640 iPhone / 1024x768 iPad,
  // always points x2.
  const stagePx = stagePixelsForMode(DISPLAY_MODE);
  // TTF bake density must be configured before any makeTtfLabel; FixedStage.init then feeds
  // letterbox scale for "modern" mode.
  configureTtfTextResolution(TEXT_RESOLUTION_MODE);
  const stage = new FixedStage({ width: stagePx.w, height: stagePx.h });
  await stage.init(renderHost, { deterministicHarness: DETERMINISTIC_HARNESS });
  const keyboard = new KeyboardShortcutRouter(window);
  globalThis.addEventListener("pagehide", () => keyboard.dispose(), { once: true });
  let guildQuestDebugState: (() => unknown) | undefined;
  let playerDebugState: (() => unknown) | undefined;
  let defeatRecoveryDebugState: (() => unknown) | undefined;
  let questNotificationHost: WorldNotificationHost | undefined;
  const pendingQuestNotifications: Array<
    GuildQuestNotificationState | LocalizedMessageNotificationState
  > = [];

  // The development client installs a provisional hook before page code. That signal lets us
  // stop real rAF immediately, before asset-load duration can advance deterministic scenarios.
  const deterministicHarness = DETERMINISTIC_HARNESS;
  const advanceTicker = createTickerAdvancer(stage.app.ticker);
  const advanceTime = async (ms: number): Promise<void> => {
    await advanceTicker(ms);
    // Async battle continuations run after ticker listeners. Render once more after they settle so
    // a checkpoint reflects the exported state rather than the preceding frame.
    if (stage.destroyed) return;
    stage.app.render();
  };
  if (deterministicHarness) stage.app.ticker.stop();
  (globalThis as Record<string, unknown>)["advanceTime"] = advanceTime;
  // Built BEFORE `render_game_to_text` is installed, because that hook reads `audio.debugState`
  // and the boot path between the two awaits dynamic imports (the scenario runtime and the
  // fixed-combat preparer). A harness polling the hook inside that window reached `audio` in its
  // temporal dead zone and got a ReferenceError instead of a state snapshot.
  const audio = options.audio ?? new AudioPlayer(AUDIO_CONFIG);
  audio.setLevels(AUDIO_CONFIG);
  if (options.audio === undefined) {
    audio.installLifecycle(document);
    globalThis.addEventListener("pagehide", () => audio.dispose(), { once: true });
  }
  const screenPt = screenPointsForMode(DISPLAY_MODE);
  (globalThis as Record<string, unknown>)["render_game_to_text"] = (): string => {
    const active = scenes.renderGameState();
    return JSON.stringify({
      coordinateSystem:
        `stage ${stagePx.w}x${stagePx.h}, origin top-left, +x right, +y down; ` +
        `game is ${screenPt.w}x${screenPt.h} points under x2 (displayMode ${DISPLAY_MODE})`,
      // Structured geometry for browser harness coordinate mapping (display-mode agnostic).
      displayMode: DISPLAY_MODE,
      textResolutionMode: TEXT_RESOLUTION_MODE,
      stagePx: { w: stagePx.w, h: stagePx.h },
      screenPt: { w: screenPt.w, h: screenPt.h },
      ...(active ?? {
        mode: scenes.mode,
        ...(scenes.mode !== "content" ? { startup: startupDiagnostics.snapshot() } : {}),
      }),
      // Audio belongs to the app rather than an individual scene. Keep it at the common browser
      // boundary so transition checks can prove the incoming scene selected its source track.
      audio: audio.debugState,
      ...(guildQuestDebugState === undefined ? {} : { guildQuests: guildQuestDebugState() }),
      ...(playerDebugState === undefined ? {} : { player: playerDebugState() }),
      ...(defeatRecoveryDebugState === undefined
        ? {}
        : { defeatRecovery: defeatRecoveryDebugState() }),
      ...(scenarioRuntime === undefined
        ? {}
        : {
            scenario: {
              ...scenarioRuntime.configuration,
              launch: scenarioRuntime.worldAction ?? "combat",
              transient: true,
            },
          }),
      ...(FIDELITY_LAB === undefined ? {} : { fidelityLab: FIDELITY_LAB.snapshot() }),
    });
  };

  await mods?.runPhase("boot:ready", {
    host,
    renderHost,
    acquired,
    content,
    scenes,
    stage,
    keyboard,
    audio,
    startupDiagnostics,
    advanceTime,
  });

  let gameContent = content;
  let preparedFixedEncounter: EncounterConfig | undefined;
  if (acquired.scenario?.configuration.kind === "combat") {
    if (!import.meta.env.DEV) throw new Error("Scenario storage is unavailable in production.");
    const fixed = acquired.scenario.configuration.fixedCombat;
    if (fixed === undefined) throw new Error("Combat Scenario is missing its fixed roster.");
    const prepared = (await import("./debug/fixedCombatScenario.js"))
      .prepareFixedCombatScenario(content, fixed);
    gameContent = prepared.gameContent;
    preparedFixedEncounter = prepared.encounter;
  }
  let game = loadGame(gameContent);
  game = await mods?.runPhase("game:loaded", game) ?? game;
  mods?.host.set("game", game);
  if (acquired.scenario !== undefined) {
    if (!import.meta.env.DEV) throw new Error("Scenario storage is unavailable in production.");
    const built = (await import("./debug/scenarioRuntime.js")).buildScenarioRuntime(
      game,
      content,
      acquired.scenario.configuration,
      preparedFixedEncounter,
    );
    acquired.scenario.store.resetInitialState(built.state);
    saveStore = acquired.scenario.store;
    scenarioRuntime = built.runtime;
  }
  // Encounter selection, most-specific first:
  //  1. `__DIB_TEST_ENCOUNTER__` — a browser scenario's explicit roster (e.g. the
  //     reserve-promotion scenario needs a 4th enemy so a death actually promotes).
  //  2. `__DIB_TEST_ROSTER_SEED__` — a scenario exercising the RANDOM sampler deterministically.
  //  3. deterministic harness with neither hook — the legacy fixed demo roster, so existing
  //     scenarios keep their exact teams.
  //  4. real page load — a fresh uniform sample from the full monster roster.
  // Every sampled path is a DEMO composition, so it opts into `DEMO_FEATURE_ROLLS` (random boss /
  // soul-stone exercise). The builder itself stays clean: a real full-game encounter would arrive
  // as an explicit EncounterConfig (case 1) and never carries these scenario-only sprinkles.
  const rosterSeed = (globalThis as Record<string, unknown>)["__DIB_TEST_ROSTER_SEED__"] as
    | number
    | undefined;
  const explicitEncounter =
    scenarioRuntime?.encounter ??
    (globalThis as Record<string, unknown>)["__DIB_TEST_ENCOUNTER__"] as
      | EncounterConfig
      | undefined;
  const worldHarness =
    scenarioRuntime?.worldAction !== undefined ||
    (globalThis as Record<string, unknown>)["__DIB_TEST_WORLD_DEMO__"] === true;
  const dungeonHarnessRoute = (globalThis as Record<string, unknown>)["__DIB_TEST_DUNGEON_ROUTE__"] as
    | DungeonRouteDescriptor
    | undefined;
  // The startup save-slot screen owns save selection, so no restored snapshot exists yet. A
  // deterministic fixture that restores a world save must therefore opt in with
  // `__DIB_TEST_WORLD_DEMO__` (the dungeon fixture does) rather than being inferred from the save.
  const useWorldDemo =
    content.worldNames.length > 0 &&
    explicitEncounter === undefined &&
    rosterSeed === undefined &&
    (!deterministicHarness || worldHarness);
  const demoSample = (rng: ReturnType<typeof rosterRng>): EncounterConfig =>
    sampleEncounter(game.gd, rng, { featureRolls: DEMO_FEATURE_ROLLS });
  const selectedEncounter =
    explicitEncounter ??
    (rosterSeed !== undefined
      ? demoSample(rosterRng(rosterSeed))
      : deterministicHarness
        ? encounterUsesKnownMonsters(game.gd, DEMO_ENCOUNTER)
          ? DEMO_ENCOUNTER
          : demoSample(rosterRng(20260722))
        : demoSample(rosterRng()));
  const backgroundKey = content.combatBackgroundKeys.includes(selectedEncounter.backgroundKey)
    ? selectedEncounter.backgroundKey
    : content.combatBackgroundKeys[0]!;
  const encounter: EncounterConfig = { ...selectedEncounter, backgroundKey };
  const profileOverride = (globalThis as Record<string, unknown>)["__DIB_TEST_PLAYER_PROFILE__"] as
    | PlayerProfileConfig
    | undefined;
  let profileConfig = profileOverride ?? restrictPlayerProfileToRoster(
    {
      ...DEMO_PLAYER_PROFILE_DEFAULTS,
      monsterPartyLevels: encounter.playerTeam.map((monster) => monster.level),
    },
    game.gd.allMonsters().map((monster) => monster.shortType),
  );


  profileConfig = {
    ...profileConfig,
    evolveChainOf: (shortType) => game.gd.evolveChainOrUndefined(shortType),
    licenseBattingOrderSize: game.gd.license(profileConfig.licenseType ?? "Novice").battingOrderSize,
  };
  // Standalone battle fixtures do not own a WorldTripParty, so build their collection view from
  // the same configured profile instead of maintaining a second captured-types list. The test
  // hook remains for scenarios that explicitly need every species unlocked.
  const allUnlockedOverride = (globalThis as Record<string, unknown>)["__DIB_TEST_ALL_UNLOCKED__"] as
    | boolean
    | undefined;
  let standaloneCollection = allUnlockedOverride === true
    ? allUnlockedPlayerCollection()
    : demoPlayerCollection(Object.keys(profileConfig.highestCapturedLevels ?? {}));
  const knownShortTypes = game.gd.allMonsters().map((monster) => monster.shortType);
  const townPortalDestinations = content.hasTownCapability
    ? loadTownPortalDestinations(content.resources)
    : [];
  const shortTypes = [...encounter.playerTeam, ...encounter.enemyTeam].map((m) => m.shortType);
  const plan = computePreloadPlan(game.gd, game.anims, game.meleeAttacks, shortTypes);
  const startupTasks: StartupLoadTask[] = [];
  const addStartupTask = (label: string, run: () => Promise<unknown>): void => {
    startupTasks.push({ label, run: async () => { await run(); } });
  };
  for (const [size, bold] of SHIPPED_BITMAP_FONT_SIZES) {
    const key = `${bitmapFontFile(size, bold)}-hd`;
    addStartupTask(`font ${key}`, () => game.assets.font(key));
  }
  addStartupTask("local font Marker Felt", loadRequiredLocalFonts);
  if (!useWorldDemo) {
    for (const atlas of plan.atlases) addStartupTask(`atlas ${atlas}`, () => game.assets.atlas(atlas));
    for (const particle of plan.particles) {
      addStartupTask(`particle ${particle}`, () => game.assets.particle(particle));
    }
    for (const sfx of plan.sfx) {
      addStartupTask(`sfx ${sfx}`, () => audio.preloadSfx(sfx, game.assets.audioUrl(sfx)));
    }
  }
  for (const sfx of GUI_SFX) {
    addStartupTask(`sfx ${sfx}`, () => audio.preloadSfx(sfx, game.assets.audioUrl(sfx)));
  }
  if (content.hasTownCapability) {
    for (const sfx of ["night", "rooster"] as const) {
      addStartupTask(`sfx ${sfx}`, () => audio.preloadSfx(sfx, game.assets.audioUrl(sfx)));
    }
  }
  if (content.hasDungeonCapability) {
    // `Encounter` already ships in GUI_SFX; the stair/entry cue is dungeon-only.
    for (const sfx of ["Stairs_EnterDungeon"] as const) {
      addStartupTask(`sfx ${sfx}`, () => audio.preloadSfx(sfx, game.assets.audioUrl(sfx)));
    }
  }
  if (!useWorldDemo) {
    for (const setup of [...encounter.playerTeam, ...encounter.enemyTeam]) {
      const spriteKey = battleSpriteKey(setup);
      addStartupTask(`monster ${setup.shortType}`, () => game.assets.sprite(spriteKey));
    }
    addStartupTask(
      `combat background ${encounter.backgroundKey}`,
      () => game.assets.sprite(encounter.backgroundKey),
    );
  }
  startupTasks.push(...createStartupSpritePreloadTasks(game.assets));
  for (const atlas of ["General-hd", "MonsterpediaFrames-hd", "FXSheet-hd"] as const) {
    addStartupTask(`atlas ${atlas}`, () => game.assets.atlas(atlas));
  }
  // Both can appear on timing-sensitive paths after battle start. AssetLibrary caches particle
  // config+texture promises, so loading them here keeps browser blob fetch/decode outside combat:
  // Poison is a persistent status overlay; progressBarParticles backs the source XP-award card.
  for (const particle of ["PoisonParticles.plist", "progressBarParticles.plist"] as const) {
    addStartupTask(`particle ${particle}`, () => game.assets.particle(particle));
  }
  const sourceNewGameIntro =
    useWorldDemo &&
    (globalThis as Record<string, unknown>)["__DIB_TEST_SKIP_SOURCE_NEW_GAME_INTRO__"] !== true &&
    content.resources.has("Plot.plist") &&
    ["plot_start1", "pickDragonBacking-hd", ...SOURCE_STARTER_CHOICES.flatMap(
      ({ shortType }) => [`${shortType}-hd`],
    )].every((key) => game.assets.hasSprite(key)) &&
    ["fieldMovement", "battleTutorial1", "battleTutorial2", "catchTutorial"]
      .every((key) => game.assets.hasSprite(key)) &&
    game.assets.hasAudio("Dungeon2.mp3") &&
    SOURCE_STARTER_CHOICES.every(({ shortType }) =>
      knownShortTypes.includes(shortType));

  let restarting = false;
  // `runStartupSequence` owns the title/save-picker scenes itself -- they are not in
  // `SceneCoordinator`, so `scenes.clear()` below does not reach them. Pixi destroys application
  // plugins (TickerPlugin -> `Ticker.destroy()` -> `_head = null`) before it recursively destroys
  // the stage children, so leaving them to be destroyed AS children means a child destructor that
  // cancels a ticker-backed action runs against a dead ticker. The save picker's 0.5s dim fade is
  // exactly that: `SourcePopupMenu.destroy` aborts it, the abort calls `Ticker.remove`, and
  // `Ticker.remove` dereferences the nulled `_head` -- "Cannot read properties of null (reading
  // 'next')". Retire the startup scenes first, while the ticker is still alive.
  let disposeStartupSequence: (() => void) | undefined;
  const restartStartupShell = async (): Promise<void> => {
    if (restarting) return;
    restarting = true;
    if ((globalThis as Record<string, unknown>)["__DIB_TEST_SESSION_RESTARTS__"] === true) {
      delete (globalThis as Record<string, unknown>)["__DIB_TEST_RESTART_SESSION__"];
    }
    scenes.clear("start");
    disposeStartupSequence?.();
    stopStartupModeSync();
    keyboard.dispose();
    stage.destroy();
    host.replaceChildren();
    refreshRuntimeSettings();
    queueMicrotask(() => {
      void startBoot({ acquired, audio, resumeStartupAtSaveSelect: true });
    });
  };
  if ((globalThis as Record<string, unknown>)["__DIB_TEST_SESSION_RESTARTS__"] === true) {
    (globalThis as Record<string, unknown>)["__DIB_TEST_RESTART_SESSION__"] = {
      presentation: restartStartupShell,
      audio: () => audio.debugState,
      startup: () => startupDiagnostics.snapshot(),
    };
  }
  const startupAutoLaunchSlotId =
    options.autoLaunchSlotId ??
    (scenarioRuntime === undefined || options.resumeStartupAtSaveSelect === true
      ? undefined
      : "slot-1");
  const externallyDrivenStartupClock =
    deterministicHarness &&
    (globalThis as Record<string, unknown>)["__DIB_TEST_EXTERNAL_STARTUP_CLOCK__"] === true;
  const startup = await runStartupSequence({
    stage,
    game,
    keyboard,
    resources: content.resources,
    audio,
    saveStore,
    loadTasks: startupTasks,
    sourceNewGameIntro,
    diagnostics: startupDiagnostics,
    ...(deterministicHarness && !externallyDrivenStartupClock
      ? { driveDeterministicTime: advanceTime }
      : {}),
    ...(startupAutoLaunchSlotId === undefined
      ? {}
      : { autoLaunchSlotId: startupAutoLaunchSlotId }),
    ...(options.resumeStartupAtSaveSelect === true ? { resumeAtSaveSelect: true } : {}),
    ...(options.startStartupCovered === true ? { startCovered: true } : {}),
    onPresentationChange: restartStartupShell,
    registerDispose: (dispose) => { disposeStartupSequence = dispose; },
    ...(official?.authority.account === undefined
      ? {}
      : { account: official.authority.account }),
  });
  await mods?.runPhase("startup:loaded", {
    startup,
    game,
    stage,
    scenes,
    audio,
    content,
  });
  const saveSession = startup.saveSession;
  const officialSlot = official === undefined
    ? undefined
    : await official.ensureSlot(
        saveSession.slotId,
        startup.newGameStarterShortType,
      );
  let restoredSave = officialSlot?.snapshot ?? startup.restoredSave;
  const saveHealth = new SaveHealthMonitor();
  saveHealth.subscribe((health) => {
    startupDiagnostics.patch({
      saveHealth: health.healthy
        ? `saves OK${health.lastSuccessAt === undefined ? "" : ` (last ${health.lastSuccessAt})`}`
        : `FAILING: ${health.detail ?? "unknown"} x${health.consecutiveFailures}`,
    });
  });
  const disposeSaveHealthBanner = installSaveHealthBanner({
    monitor: saveHealth,
    ...(saveSession.adoptStoredRevision === undefined
      ? {}
      : {
          onTakeOverSlot: async (): Promise<void> => {
            // Deliberately player-driven: this abandons the optimistic check and overwrites
            // whatever the other tab wrote. See `SaveConflictError` for why it is never automatic.
            await saveSession.adoptStoredRevision?.();
            saveHealth.clearConflict();
            checkpoint();
          },
        }),
  });
  if (startup.newGameStarterShortType !== undefined) {
    if (profileOverride === undefined) {
      profileConfig = {
        ...sourceNewGameProfileDefaults(startup.newGameStarterShortType),
        monsterPartyLevels: [1],
      };
    }
    standaloneCollection = demoPlayerCollection([startup.newGameStarterShortType]);
  }
  if (
    restoredSave?.dungeon !== undefined &&
    !content.hasDungeonCapability
  ) {
    throw new Error(
      "saved game contains an active dungeon run, but the selected package is not dungeon-capable",
    );
  }
  const questCatalog = content.resources.has("Quests.plist")
    ? loadQuestCatalog(content.resources)
    : undefined;
  let guildQuests = questCatalog === undefined
    ? undefined
    : new GuildQuestRuntime(
        questCatalog,
        restoredSave?.quests ?? emptyGuildQuestStateSnapshot(),
      );
  const collectionDialogs = questCatalog === undefined
    ? createLocalCollectionDialogRuntime({
        official: officialSlot !== undefined,
        hasCollectionRoute: game.hasCollectionRoute,
        ...(restoredSave?.quests === undefined ? {} : { snapshot: restoredSave.quests }),
      })
    : undefined;
  if (
    guildQuests !== undefined &&
    officialSlot === undefined &&
    (restoredSave?.player.profile.schemaVersion === 5 ||
      restoredSave?.player.profile.schemaVersion === 6 ||
      restoredSave?.player.profile.schemaVersion === 7 ||
      restoredSave?.player.profile.schemaVersion === 8)
  ) {
    for (const name of earnedLicenseWinDialogs(
      game.gd,
      restoredSave.player.profile.licenseType,
    )) {
      guildQuests.requestChatPresentation(name, true);
    }
  }
  const guildTavernBackgroundSpriteKey = resolveGuildTavernBackgroundSpriteKey(content);
  const townWarpBackgroundSpriteKey = resolvePopupMenuBackgroundSpriteKey(content, "TownWarp");



  const fixtureBlackMarketReady =
    (globalThis as Record<string, unknown>)["__DIB_TEST_BLACK_MARKET_SERVICE_READY__"];
  if (
    fixtureBlackMarketReady !== undefined &&
    (!deterministicHarness || typeof fixtureBlackMarketReady !== "boolean")
  ) {
    throw new Error(
      "Black Market readiness fixture is a deterministic-harness-only boolean override",
    );
  }
  const blackMarketReady = deterministicHarness && typeof fixtureBlackMarketReady === "boolean"
    ? fixtureBlackMarketReady
    : blackMarketServiceReady();
  // Once the blocker IS lifted, the selected archive can enable the destination only by
  // structurally supplying the source BlackMarket menu's full-screen background. Cards, URLs, and
  // metadata never enter this decision or the app-shell capabilities.
  const blackMarketBackgroundSpriteKey = resolvePopupMenuBackgroundSpriteKey(content, "BlackMarket");
  const blackMarketDemoImageLoader = createBlackMarketDemoImageLoader();
  const blackMarketDemoOpener = createBlackMarketDemoExternalPageOpener();
  const initialGuildQuests = guildQuests;
  if (initialGuildQuests !== undefined) {
    const fixtureFinishedQuestCount =
      (globalThis as Record<string, unknown>)["__DIB_TEST_FINISHED_QUEST_COUNT__"];
    if (deterministicHarness && fixtureFinishedQuestCount !== undefined) {
      if (
        !Number.isSafeInteger(fixtureFinishedQuestCount) ||
        (fixtureFinishedQuestCount as number) < 0
      ) {
        throw new Error("Finished quest fixture count must be a non-negative safe integer");
      }
      const snapshot = initialGuildQuests.stateSnapshot();
      initialGuildQuests.replaceStateSnapshot({
        ...snapshot,
        finishedQuestNames: questCatalog!.definitions
          .slice(0, fixtureFinishedQuestCount as number)
          .map(({ name }) => name),
      });
    }
    const fixtureDialogsSeen =
      (globalThis as Record<string, unknown>)["__DIB_TEST_DIALOGS_SEEN__"];
    if (deterministicHarness && Array.isArray(fixtureDialogsSeen)) {
      for (const name of fixtureDialogsSeen) {
        if (typeof name !== "string") throw new Error("Dialog fixture names must be strings");
        initialGuildQuests.requestChatPresentation(name, true);
      }
    }
    const fixtureQuestNames =
      (globalThis as Record<string, unknown>)["__DIB_TEST_GUILD_QUEST_NAMES__"];
    if (deterministicHarness && Array.isArray(fixtureQuestNames)) {
      for (const name of fixtureQuestNames) {
        if (typeof name !== "string") throw new Error("Guild quest fixture names must be strings");
        if (!initialGuildQuests.startQuest(name)) throw new Error(`Could not start Guild quest fixture ${name}`);
      }
    }
    const fixtureTown = (globalThis as Record<string, unknown>)["__DIB_TEST_GUILD_QUEST_TOWN__"];
    if (deterministicHarness && typeof fixtureTown === "string") {
      // Same contract as the fixture-name loop above: a fixture that cannot be honoured must
      // say so. Silently ignoring the return value made an unsatisfiable town read out as an
      // empty quest list, which is indistinguishable from the wrong content archive, an
      // already-active quest, and a full active-quest cap (`quests.ts`).
      if (initialGuildQuests.startFirstAvailableQuestInTown(fixtureTown) === undefined) {
        throw new Error(
          `Could not start a Guild quest in fixture town ${fixtureTown}: ` +
            `${initialGuildQuests.questsAvailableInTown(fixtureTown)} available there, ` +
            `active=${JSON.stringify(initialGuildQuests.activeQuestNames())}, ` +
            `finished=${JSON.stringify(initialGuildQuests.finishedQuestNames())}`,
        );
      }
    }
    guildQuestDebugState = () => ({
      activeQuestNames: initialGuildQuests.activeQuestNames(),
      activeQuests: initialGuildQuests.activeQuests().map((quest) => ({
        name: quest.name,
        title: guildQuestTitle(game.strings, quest),
        progress: guildQuestProgress(game.strings, initialGuildQuests, quest),
        complete: initialGuildQuests.isComplete(quest.name),
      })),
      completedActiveQuestNames: initialGuildQuests.completedActiveQuestNames(),
      finishedQuestNames: initialGuildQuests.finishedQuestNames(),
      usableQuestKeys: initialGuildQuests.activeQuests()
        .map(({ questKey }) => questKey)
        .filter((key): key is string => key !== undefined && initialGuildQuests.canUseQuestKey(key)),
      notification: questNotificationHost?.debugState.questNotification,
      queuedNotificationCount:
        questNotificationHost?.debugState.queuedNotificationCount ??
        pendingQuestNotifications.length,
    });
  }
  const standalonePlayer = useWorldDemo
    ? undefined
    : restoredSave === undefined
      ? PlayerRuntimeState.standalone(profileConfig, standaloneCollection)
      : PlayerRuntimeState.fromStateSnapshot(game.gd, restoredSave.player, standaloneCollection);
  const savedWorld = restoredSave?.world;
  if (savedWorld !== undefined && !content.worldNames.includes(savedWorld.worldName)) {
    throw new Error(`saved world ${savedWorld.worldName} is unavailable in the selected content package`);
  }
  const restoredLastTownName = restoredTownMetadata(content.hasTownCapability, savedWorld?.lastTownName);
  resolveRestoredTownDestination(
    content.hasTownCapability,
    savedWorld?.lastTownName,
    townPortalDestinations,
  );
  const officialLocation = officialSlot?.coordinator.projection.location;
  const startupTownDestination = useWorldDemo &&
      options.presentationResumeMode !== "world" &&
      options.presentationResumeMode !== "dungeon" &&
      restoredSave?.dungeon === undefined &&
      officialLocation?.kind !== "world" &&
      officialLocation?.kind !== "battle" &&
      officialLocation?.kind !== "dungeon"
    ? content.hasTownCapability
      ? resolveTownPortalDestination(townPortalDestinations, restoredLastTownName)
      : undefined
    : undefined;
  const fixtureWorldName = deterministicHarness && worldHarness
    ? (globalThis as Record<string, unknown>)["__DIB_TEST_WORLD_NAME__"] as string | undefined
    : undefined;
  const fixturePoiName = deterministicHarness && worldHarness
    ? (globalThis as Record<string, unknown>)["__DIB_TEST_POI_NAME__"] as string | undefined
    : undefined;
  if (fixtureWorldName !== undefined && !content.worldNames.includes(fixtureWorldName)) {
    throw new Error(`World fixture ${fixtureWorldName} is unavailable`);
  }
  const selectedWorldName = fixtureWorldName ??
    startupTownDestination?.worldName ??
    savedWorld?.worldName ??
    (content.worldNames.includes(DEMO_WORLD_CONFIG.worldName)
      ? DEMO_WORLD_CONFIG.worldName
      : content.worldNames[0]);
  const initialWorldData = useWorldDemo && selectedWorldName !== undefined
    ? loadWorldData(content.resources, selectedWorldName, new Set(knownShortTypes))
    : undefined;
  const initialPoiName = initialWorldData === undefined
    ? undefined
    : fixturePoiName !== undefined
      ? fixturePoiName
      : startupTownDestination !== undefined
      ? startupTownDestination.townName
      : savedWorld !== undefined
      ? savedWorld.currentPoiName
      : initialWorldData.pointsOfInterest.some((poi) => poi.name === DEMO_WORLD_CONFIG.initialPoiName)
      ? DEMO_WORLD_CONFIG.initialPoiName
      : (initialWorldData.pointsOfInterest.find((poi) => poi.randomPopulators.length === 0) ??
          initialWorldData.pointsOfInterest[0])?.name;
  if (initialWorldData !== undefined && initialPoiName === undefined) {
    throw new Error(`World ${initialWorldData.name} has no points of interest`);
  }





  const authoredTownFlashKeys = new Set<string>();
  if (useWorldDemo) {
    for (const worldName of content.worldNames) {
      let data: WorldData;
      try {
        data = worldName === initialWorldData?.name && initialWorldData !== undefined
          ? initialWorldData
          : loadWorldData(content.resources, worldName, new Set(knownShortTypes));
      } catch {
        continue;
      }
      for (const poi of data.pointsOfInterest) {
        for (const building of poi.town?.buildings ?? []) {
          if (building.tutorialFlashKey !== undefined) {
            authoredTownFlashKeys.add(building.tutorialFlashKey);
          }
        }
      }
    }
  }
  /** Fixtures and pre-tutorial-schema saves are past the intro; see `establishedPlayerTutorialFlags`. */
  const establishedTutorialFlags = establishedPlayerTutorialFlags(authoredTownFlashKeys);
  // Reassigns only the world route: `standalonePlayer` above is built before any world/town data
  // exists and has no town chrome to flash.
  if (startup.newGameStarterShortType === undefined) {
    profileConfig = {
      ...profileConfig,
      tutorialFlags: profileOverride?.tutorialFlags ?? establishedTutorialFlags,
    };
  }
  /**
   * `PlayerProfile.fromStateSnapshot` drops `tutorialFlags` for pre-schema-4 snapshots, since the
   * field did not exist. Restoring one as "nothing seen" resurrects every first-visit hint on a
   * save whose player is demonstrably past them, so adopt the established set instead. Runs before
   * the change listener is attached, so it dirties nothing until the next real checkpoint.
   */
  const adoptLegacyTutorialFlags = (runtime: PlayerRuntimeState): void => {
    if ((restoredSave?.player.profile.schemaVersion ?? 4) >= 4) return;
    for (const flag of establishedTutorialFlags) runtime.profile.claimTutorialFlag(flag);
  };
  if (standalonePlayer !== undefined && restoredSave !== undefined) {
    adoptLegacyTutorialFlags(standalonePlayer);
  }

  const preloadWorldEncounter = async (nextEncounter: EncounterConfig): Promise<void> => {
    const roster = [...nextEncounter.playerTeam, ...nextEncounter.enemyTeam].map((member) => member.shortType);
    const nextPlan = computePreloadPlan(game.gd, game.anims, game.meleeAttacks, roster);
    await Promise.all([
      ...nextPlan.atlases.map((atlas) => game.assets.atlas(atlas)),
      ...nextPlan.particles.map((particle) => game.assets.particle(particle)),
      ...nextPlan.sfx.map((sfx) => audio.hasSfx(sfx)
        ? Promise.resolve()
        : audio.preloadSfx(sfx, game.assets.audioUrl(sfx))),
      ...roster.map((shortType) => game.assets.sprite(`${shortType}-hd`)),
      game.assets.sprite(nextEncounter.backgroundKey),
    ]);
  };

  let worldGeneration = 0;
  let captureSerial = 0;
  let worldData: WorldData | undefined = initialWorldData;
  let playerRuntime: PlayerRuntimeState | undefined;
  playerDebugState = () => {
    const runtime = playerRuntime ?? standalonePlayer;
    if (runtime === undefined) return null;
    const profile = runtime.profile.stateSnapshot();
    const wallet = runtime.profile.snapshot();
    return {
      heroLevel: profile.hero.level,
      silver: profile.silver,
      gold: profile.gold,
      captureCards: wallet.captureCards,
      highestCapturedLevels: profile.highestCapturedLevels,
      tutorialFlags: profile.tutorialFlags,
      tournament: profile.tournament,
      party: runtime.party?.monsters().map((monster) => ({ ...monster })) ?? null,
      items: runtime.profile.inventory.legacyItemCounts(),
    };
  };
  let worldTrip: ReturnType<typeof createWorldTrip> | undefined;
  let worldRng: Rng | undefined;
  let officialWorldRng: ReplayableRng | undefined;
  let worldSharedState: WorldTripSharedState | undefined;
  let latestWorldProgress: WorldProgressStateSnapshot | undefined = savedWorld;
  let lastTownName = restoredLastTownName;
  const knownTownNames = new Set(townPortalDestinations.map(({ townName }) => townName));
  const visitedTownNames = new Set<string>(
    content.hasTownCapability && savedWorld?.schemaVersion === 2
      ? savedWorld.visitedTownNames
      : [
          ...(content.hasTownCapability
            ? (savedWorld?.everCompletedPois ?? []).filter((name) => knownTownNames.has(name))
            : []),
          ...(restoredLastTownName === undefined ? [] : [restoredLastTownName]),
        ],
  );
  const visitedTownFixture =
    (globalThis as Record<string, unknown>)["__DIB_TEST_VISITED_TOWN_COUNT__"];
  if (visitedTownFixture !== undefined) {
    if (
      !deterministicHarness ||
      !Number.isSafeInteger(visitedTownFixture) ||
      (visitedTownFixture as number) < 0
    ) {
      throw new Error("Visited-town fixture requires a non-negative deterministic count");
    }
    visitedTownNames.clear();
    for (const { townName } of townPortalDestinations.slice(
      0,
      visitedTownFixture as number,
    )) {
      visitedTownNames.add(townName);
    }
    if (lastTownName !== undefined) visitedTownNames.add(lastTownName);
  }
  for (const townName of visitedTownNames) {
    if (!knownTownNames.has(townName)) {
      throw new Error(`saved visited town ${townName} is unavailable in the selected content package`);
    }
  }
  let pendingRestore = restoredSave;
  // MainMenu's source route purges cached field/dungeon scenes and always rebuilds lastTown.
  let pendingDungeonRestore =
    officialSlot === undefined
      ? undefined
      : officialProjectionDungeonRun(officialSlot.coordinator.projection);
  pendingDungeonRestore ??=
    restoredSave?.dungeon;
  let dungeonFeature: DungeonFeatureController<ShellMode> | undefined;
  const enqueueQuestNotification = (
    notification: GuildQuestNotificationState | LocalizedMessageNotificationState,
  ): void => {
    if (questNotificationHost === undefined) {
      pendingQuestNotifications.push(notification);
      return;
    }
    if (notification.kind === "localized-message") {
      questNotificationHost.enqueueLocalizedMessage(notification);
      return;
    }
    questNotificationHost.enqueueQuest(notification);
  };
  const presentQuestEventResult = (result: GuildQuestEventResult): void => {
    if (guildQuests === undefined) return;
    for (const name of result.notificationQuestNames) {
      enqueueQuestNotification(progressGuildQuestNotification(
        game.strings,
        guildQuests,
        guildQuests.catalog.requireQuest(name),
      ));
    }
  };
  const pendingOfficialQuestEvents: PresentationEventV1[] = [];
  const presentOfficialQuestEvents = (events: readonly PresentationEventV1[]): void => {
    if (guildQuests === undefined) return;
    for (const notification of committedGuildQuestNotifications(
      game.strings,
      guildQuests,
      events,
    )) {
      enqueueQuestNotification(notification);
    }
  };
  const retainOfficialQuestEvents = (events: readonly PresentationEventV1[]): void => {
    pendingOfficialQuestEvents.push(
      ...events.filter((event) => event.type === "quest.progressed"),
    );
  };
  const presentRetainedOfficialQuestEvents = (): void => {
    presentOfficialQuestEvents(pendingOfficialQuestEvents.splice(0));
  };
  const pendingOfficialBattleRewards: PlayerReward[] = [];
  const retainOfficialBattleRewards = (events: readonly PresentationEventV1[]): void => {
    for (const event of events) {
      if (event.type !== "battle.rewardsGranted") continue;
      pendingOfficialBattleRewards.push(...event.rewards.map((reward) =>
        reward.kind === "gem"
          ? { ...reward, enabledStats: [...reward.enabledStats] }
          : { ...reward }));
    }
  };
  /**
   * The Abyss's authoritative `infiniteHighestLevel` transitions, held between the command that
   * moved the run onto a deeper floor and the `DungeonNode` that presents its consequences. The
   * server emits `dungeon.infiniteFloorEntered` only on a strictly deeper floor, so an empty queue
   * is the ordinary case and the node falls back to the projection's own value — which is exactly
   * the pre-write value on every path that did not deepen.
   */
  const pendingOfficialInfiniteFloorEntries: { floor: number; previousHighest: number }[] = [];
  const retainOfficialInfiniteFloorEntries = (
    events: readonly PresentationEventV1[],
  ): void => {
    for (const event of events) {
      if (event.type !== "dungeon.infiniteFloorEntered") continue;
      pendingOfficialInfiniteFloorEntries.push({
        floor: event.floor,
        previousHighest: event.previousHighest,
      });
    }
  };
  const takeOfficialInfiniteFloorEntry = (
    floor: number,
  ): { readonly previousHighest: number } | undefined => {
    const index = pendingOfficialInfiniteFloorEntries.findIndex((entry) => entry.floor === floor);
    if (index < 0) return undefined;
    const [entry] = pendingOfficialInfiniteFloorEntries.splice(index, 1);
    return entry;
  };
  let deferredQuestCheckpointDepth = 0;
  const dispatchGuildQuestEvent = (
    event: GuildQuestEvent,
    options: { readonly deferCheckpoint?: boolean } = {},
  ): void => {
    if (guildQuests === undefined) return;
    if (options.deferCheckpoint === true) deferredQuestCheckpointDepth += 1;
    try {
      presentQuestEventResult(event.id === 9
        ? guildQuests.recordBattleWin(event)
        : guildQuests.fireEvent(event));
    } finally {
      if (options.deferCheckpoint !== true) return;
      deferredQuestCheckpointDepth -= 1;
    }
  };
  if (deterministicHarness) {
    (globalThis as Record<string, unknown>)["__DIB_TEST_FIRE_GUILD_QUEST_EVENT__"] =
      dispatchGuildQuestEvent;
  }
  /**
   * `WorldTrip` owns the source POI quest-event producers (events 1 and 2). Under Official
   * authority the same POI completion is reduced server-side and arrives through the projection,
   * so the retained local mirror must stay silent — the `localGuildQuestEventOption` rule applied
   * to the world trip.
   */
  const localWorldTripQuestEvents = (): ((event: GuildQuestEvent) => void) | undefined =>
    officialSlot === undefined ? (event) => { dispatchGuildQuestEvent(event); } : undefined;
  const attachQuestNotificationHost = (host: WorldNotificationHost): void => {
    questNotificationHost = host;
    for (const notification of pendingQuestNotifications.splice(0)) {
      if (notification.kind === "localized-message") {
        host.enqueueLocalizedMessage(notification);
      } else {
        host.enqueueQuest(notification);
      }
    }
  };
  const connectQuestEvents = (
    runtime: PlayerRuntimeState,
    isActive: () => boolean = () => true,
  ): void => {
    runtime.setQuestEventListener((event) => {
      if (!isActive()) return;
      dispatchGuildQuestEvent({
        id: 8,
        firstIngredientShortType: event.target1.shortType,
        secondIngredientShortType: event.target2.shortType,
      });
    });



    runtime.profile.setSpiritExperienceListener((shortType) => {
      if (!isActive() || officialSlot !== undefined) return;
      dispatchGuildQuestEvent({ id: 5, spiritShortType: shortType });
    });
  };
  const currentGameStateSnapshot = (
    override: { readonly dungeon?: DungeonRunSnapshot | null } = {},
  ): PlayerGameStateSnapshot | undefined => {
    const runtime = playerRuntime ?? standalonePlayer;
    if (runtime === undefined) return undefined;
    let world: WorldProgressStateSnapshot | undefined;
    if (worldData !== undefined && worldTrip !== undefined && worldSharedState !== undefined) {
      world = snapshotWorldProgress(
        worldData.name,
        worldTrip.currentPoiName,
        worldSharedState,
        latestWorldProgress?.everCompletedPois,
        lastTownName,
        visitedTownNames,
      );
      latestWorldProgress = world;
    }
    const dungeon = Object.prototype.hasOwnProperty.call(override, "dungeon")
      ? override.dungeon ?? undefined
      : dungeonFeature?.snapshot();
    const quests = guildQuests?.stateSnapshot() ?? collectionDialogs?.stateSnapshot();
    const pendingBattleRewardKeys = dungeonFeature?.pendingBattleRewardSnapshot();
    return {
      schemaVersion: 1,
      player: runtime.stateSnapshot(),
      ...(quests === undefined ? {} : { quests }),
      ...(world === undefined ? {} : { world }),
      ...(dungeon === undefined ? {} : { dungeon }),
      ...(pendingBattleRewardKeys === undefined ? {} : { pendingBattleRewardKeys }),
    };
  };
  const persistCheckpoint = async (
    override: { readonly dungeon?: DungeonRunSnapshot | null } = {},
  ): Promise<void> => {
    const state = currentGameStateSnapshot(override);
    if (state === undefined) return;
    try {
      await saveSession.save(state);
      saveHealth.recordSuccess();
    } catch (error) {
      saveHealth.recordFailure(saveSession.slotId, error);
      throw error;
    }
  };
  const checkpoint = (): void => {
    void persistCheckpoint().catch((error: unknown) => {
      // Still logged for the console trail, but the banner is what the player actually sees.
      console.error("Save checkpoint failed", error);
    });
  };
  const checkpointAsync = (
    override?: { readonly dungeon?: DungeonRunSnapshot | null },
  ): Promise<void> =>
    persistCheckpoint(override);
  const persistLocalDungeonTerminal = async (checkpoint: {
    readonly player: PlayerRuntimeStateSnapshot;
    readonly quests?: GuildQuestStateSnapshot;
    readonly dungeon: DungeonRunSnapshot | null;
    readonly pendingBattleRewardKeys: Readonly<Record<string, string>>;
    readonly world?: WorldProgressStateSnapshot;
  }): Promise<void> => {
    const current = currentGameStateSnapshot({ dungeon: checkpoint.dungeon });
    if (current === undefined) return;
    const state: PlayerGameStateSnapshot = {
      ...current,
      player: checkpoint.player,
      ...(checkpoint.quests === undefined ? {} : { quests: checkpoint.quests }),
      ...(checkpoint.world === undefined ? {} : { world: checkpoint.world }),
      pendingBattleRewardKeys: checkpoint.pendingBattleRewardKeys,
    };
    try {
      await saveSession.save(state);
      saveHealth.recordSuccess();
    } catch (error) {
      saveHealth.recordFailure(saveSession.slotId, error);
      throw error;
    }
  };
  const attachGuildQuestRuntime = (
    runtime: GuildQuestRuntime | undefined,
    isActive: () => boolean = () => true,
  ): void => {
    if (runtime === undefined) return;
    runtime.setMutationListener((mutation) => {
      if (!isActive()) return;
      if (mutation.kind === "start" && mutation.questName !== undefined) {
        enqueueQuestNotification(acceptedGuildQuestNotification(
          game.strings,
          runtime,
          runtime.catalog.requireQuest(mutation.questName),
        ));
      }
      if (deferredQuestCheckpointDepth === 0) checkpoint();
    });
  };
  let activeDefeatStore: StoreFlow | undefined;
  let defeatStoreOpening = false;
  let defeatStoreOpenCount = 0;
  let defeatStoreCloseCount = 0;
  defeatRecoveryDebugState = () => ({
    storeOpening: defeatStoreOpening,
    storeOpenCount: defeatStoreOpenCount,
    storeCloseCount: defeatStoreCloseCount,
    store: activeDefeatStore?.debugState ?? null,
  });
  const openGoldStoreHandoff = async (
    runtime: PlayerRuntimeState,
    presentation: () => { readonly parent: Container; readonly owner: object },
    checkpointAfter: () => void,
    purchaseUnavailableMessage?: string,
  ): Promise<{ readonly closed: Promise<void> }> => {
    if (defeatStoreOpening || activeDefeatStore !== undefined) {
      throw new Error("gold Store handoff already has an active StoreFlow");
    }
    // Claim the opening slot before the first asynchronous asset/build boundary. Without this
    // sentinel, two callers can both pass the active-flow check while StoreFlow.show is pending.
    defeatStoreOpening = true;
    let flow: StoreFlow | undefined;
    try {
      const host = presentation();
      flow = await StoreFlow.show({
        parent: host.parent,
        owner: host.owner,
        assets: game.assets,
        scale9: game.scale9,
        strings: game.strings,
        ticker: stage.app.ticker,
        data: game.gd,
        profile: runtime.profile,
        onClick: () => audio.playSfx("click"),
        onBlocked: () => audio.playSfx("notAllowed"),
        onClose: () => {
          defeatStoreOpening = false;
          defeatStoreCloseCount += 1;
          if (activeDefeatStore === flow) activeDefeatStore = undefined;
          checkpointAfter();
        },
        // These source continuations call Store's direct category-3 path, not FirstShop.
        onFirstShop: () => undefined,
        ...(purchaseUnavailableMessage === undefined ? {} : { purchaseUnavailableMessage }),
        purchase: (stock, quantity) => {
          if (purchaseUnavailableMessage !== undefined) {
            throw new Error("authority-pinned gold Store attempted a purchase");
          }
          const result = purchaseStoreStock(runtime.profile, stock, quantity);
          checkpointAfter();
          return result;
        },
        presentCommittedRewards: (items) => showCommittedStoreLootManagement({
          parent: host.parent,
          owner: host.owner,
          game,
          audio,
          ticker: stage.app.ticker,
        }, items),
        onEggPurchased: () => {
          throw new Error("category-3 gold Store handoff cannot purchase an Egg");
        },
      });
      activeDefeatStore = flow;
      defeatStoreOpening = false;
      defeatStoreOpenCount += 1;
      return { closed: flow.showGoldPurchaseCategoryAndWait() };
    } catch (error) {
      defeatStoreOpening = false;
      if (activeDefeatStore === flow) activeDefeatStore = undefined;
      throw error;
    }
  };
  const localDefeatRecovery = (
    runtime: PlayerRuntimeState,
    encounterConfig: EncounterConfig,
    battle: () => BattleNode,
    checkpointAfter: () => void = checkpoint,
  ): DefeatRecoveryAdapter => ({
    canOffer: () => {
      const wallet = runtime.profile.snapshot();
      return canOfferSaveMe({
        blockSaveMe: encounterConfig.blockSaveMe ?? true,
        tutorialSeen: runtime.profile.hasTutorialFlag("SaveMe"),
        heroLevel: runtime.profile.heroLevel,
        gold: wallet.gold,
      });
    },
    markTutorialSeen: () => runtime.markSaveMeTutorialSeen(),
    acceptSaveMe: async () => runtime.resolveLocalSaveMe().ok
      ? "saved"
      : "insufficient-funds",
    openGoldStore: () => openGoldStoreHandoff(
      runtime,
      () => ({ parent: battle().notificationParent, owner: battle() }),
      checkpointAfter,
    ),
  });
  const officialDefeatRecovery = (
    runtime: PlayerRuntimeState,
    battle: () => BattleNode,
  ): DefeatRecoveryAdapter => {
    if (officialSlot === undefined) {
      throw new Error("Official defeat recovery requires an authority slot");
    }
    return createOfficialDefeatRecoveryAdapter({
      projection: () => officialSlot.coordinator.projection,
      submit: (command) => officialSlot.coordinator.submit(command),
      openGoldStore: () => openGoldStoreHandoff(
        runtime,
        () => ({ parent: battle().notificationParent, owner: battle() }),
        () => undefined,
        "Purchases are unavailable while a battle recovery decision is pending.",
      ),
    });
  };
  const tearDownAndRestart = async (autoLaunchCurrentSlot: boolean): Promise<void> => {
    if (restarting) return;
    restarting = true;
    const activeMode = scenes.renderGameState()?.["mode"];
    const presentationResumeMode =
      activeMode === "world" || activeMode === "town" || activeMode === "dungeon"
        ? activeMode
        : undefined;




    try {
      await persistCheckpoint();
      await saveSession.flush();
    } catch (error) {
      // A renderer rebuild is optional; losing live progress is not. Keep the current scene and
      // its player-facing save-health banner intact when the checkpoint cannot be certified.
      console.error("Session restart checkpoint failed; retaining the live scene", error);
      restarting = false;
      return;
    }
    if ((globalThis as Record<string, unknown>)["__DIB_TEST_SESSION_RESTARTS__"] === true) {
      delete (globalThis as Record<string, unknown>)["__DIB_TEST_RESTART_SESSION__"];
    }
    if (!autoLaunchCurrentSlot) {



      const shade = new Graphics().rect(0, 0, stagePx.w, stagePx.h).fill(0x000000);
      shade.label = "mainMenuReturnTransitionShade";
      shade.alpha = 0;
      shade.eventMode = "static";
      shade.zIndex = 1_000_000;
      stage.root.sortableChildren = true;
      stage.root.addChild(shade);
      await tween(stage.app.ticker, SOURCE_BLACK_SCENE_FADE_HALF_MS, (t) => { shade.alpha = t; });
    }
    dungeonFeature?.clear();
    scenes.clear("start");
    // Normally a no-op: `launchSlot` already retired the startup scenes. It is not a no-op if the
    // sequence never reached launch, and the ticker-death hazard described at
    // `restartStartupShell` applies identically here.
    disposeStartupSequence?.();
    disposeSaveHealthBanner();
    stopStartupModeSync();
    keyboard.dispose();
    stage.destroy();
    host.replaceChildren();
    refreshRuntimeSettings();
    queueMicrotask(() => {
      void startBoot({
        acquired,
        audio,
        ...(autoLaunchCurrentSlot ? { autoLaunchSlotId: saveSession.slotId } : {}),
        ...(autoLaunchCurrentSlot && presentationResumeMode !== undefined
          ? { presentationResumeMode }
          : {}),
        ...(!autoLaunchCurrentSlot ? { startStartupCovered: true } : {}),
      });
    });
  };
  const restartToMainMenu = (): Promise<void> => tearDownAndRestart(false);
  const restartSession = (): Promise<void> => tearDownAndRestart(true);
  if ((globalThis as Record<string, unknown>)["__DIB_TEST_SESSION_RESTARTS__"] === true) {
    (globalThis as Record<string, unknown>)["__DIB_TEST_RESTART_SESSION__"] = {
      presentation: restartSession,
      mainMenu: restartToMainMenu,
      audio: () => audio.debugState,
      snapshot: currentGameStateSnapshot,
      saveHealth: () => startupDiagnostics.snapshot().saveHealth,
      // `snapshot()` is a browser persistence aggregate, not the wire projection: revision,
      // location and decision never appear in it, so a mirror mismatch across a presentation
      // restart cannot be attributed to authority state from the snapshot alone. Expose the
      // provenance separately so a failing comparison can say WHICH generation it read.
      officialProvenance: () => officialSlot === undefined ? undefined : {
        slotId: officialSlot.coordinator.projection.slotId,
        revision: officialSlot.coordinator.projection.revision,
        updatedAt: officialSlot.coordinator.projection.updatedAt,
        location: officialSlot.coordinator.projection.location,
        decisionType: officialSlot.coordinator.projection.decision.type,
        hasDungeon: officialSlot.coordinator.projection.dungeon !== undefined,
      },
    };
  }
  attachGuildQuestRuntime(guildQuests);
  collectionDialogs?.setMutationListener(() => checkpoint());
  if ((guildQuests?.droppedActiveQuestNamesDuringRestore.length ?? 0) > 0) checkpoint();
  if (standalonePlayer !== undefined) connectQuestEvents(standalonePlayer);








  let worldSessionStarted = false;
  const startWorldSession = (): void => {
    // Structural guard, not defensive noise: this used to be the combat-loss handler, and a
    // silently-wiped save is the one failure the player cannot recover from. Fail loudly instead.
    if (worldSessionStarted) {
      throw new Error(
        "startWorldSession is boot-only; calling it during play discards the live party and " +
          "profile, and the next save checkpoint would overwrite the slot with that blank state",
      );
    }
    worldSessionStarted = true;
    dungeonFeature?.clear();
    if (initialWorldData === undefined || initialPoiName === undefined) throw new Error("world demo is unavailable");
    const configuredSeed = (globalThis as Record<string, unknown>)["__DIB_TEST_WORLD_SEED__"] as
      | number
      | undefined;
    const seed = configuredSeed === undefined
      ? deterministicHarness
        ? 20260722 + worldGeneration
        : Math.floor(Math.random() * 0x100000000)
      : configuredSeed + worldGeneration;
    worldGeneration++;
    worldData = initialWorldData;
    if (pendingRestore !== undefined) {
      if (pendingRestore.world === undefined || pendingRestore.player.party.kind !== "world-trip-party") {
        throw new Error("saved state is not a world-trip save");
      }
      playerRuntime = PlayerRuntimeState.fromStateSnapshot(game.gd, pendingRestore.player);
      adoptLegacyTutorialFlags(playerRuntime);
      connectQuestEvents(playerRuntime);
      worldSharedState = restoreWorldTripSharedState(pendingRestore.world);
      latestWorldProgress = pendingRestore.world;
      if (officialSlot === undefined) {
        worldRng = FIDELITY_LAB?.rng ?? rosterRng(seed);
      } else {
        officialWorldRng = replayableRng([]);
        worldRng = officialWorldRng;
      }
      worldTrip = createWorldTrip(
        initialWorldData,
        initialPoiName,
        worldRng,
        knownShortTypes,
        worldSharedState,
        guildQuests,
        localWorldTripQuestEvents(),
      );
      pendingRestore = undefined;
      playerRuntime.setChangeListener(checkpoint);
      captureSerial = 0;
      return;
    }
    const partyConfig =
      ((globalThis as Record<string, unknown>)["__DIB_TEST_WORLD_PARTY__"] as
        typeof DEMO_WORLD_CONFIG.party | undefined) ?? DEMO_WORLD_CONFIG.party;
    const party = startup.newGameStarterShortType === undefined
      ? createRandomDemoParty(game.gd, FIDELITY_LAB?.rng ?? rosterRng(seed ^ 0x9e3779b9), partyConfig)
      : createSourceNewGameParty(game.gd, startup.newGameStarterShortType);
    playerRuntime = PlayerRuntimeState.world(profileConfig, party);
    connectQuestEvents(playerRuntime);
    // Fabricate the evolution history a directly-configured demo party never played through, so
    // pre-evolved members' ancestors appear in the Monsterpedia (evolve-chain rows) and hero XP —
    // exactly as recordCapturedMonster would have during a real playthrough. Runs before the change
    // listener is attached so it does not spam save checkpoints. The runtime collection and hero-XP
    // model stay source-faithful; this only supplies the state a real save would already hold.
    if (
      startup.newGameStarterShortType === undefined &&
      !(
        deterministicHarness &&
        (globalThis as Record<string, unknown>)["__DIB_TEST_SKIP_DEMO_EVOLUTION_HISTORY__"] === true
      )
    ) {
      recordDemoEvolutionHistory(playerRuntime.profile, party, game.gd);
    }
    playerRuntime.setChangeListener(checkpoint);
    worldRng = FIDELITY_LAB?.rng ?? rosterRng(seed);
    worldSharedState = createWorldTripSharedState();
    const fixturePoiWins = (globalThis as Record<string, unknown>)["__DIB_TEST_WORLD_POI_WINS__"];
    if (deterministicHarness && fixturePoiWins !== undefined) {
      if (fixturePoiWins === null || typeof fixturePoiWins !== "object" || Array.isArray(fixturePoiWins)) {
        throw new Error("World POI wins fixture must be a POI-name record");
      }
      const knownPoiNames = new Set(initialWorldData.pointsOfInterest.map((poi) => poi.name));
      for (const [poiName, wins] of Object.entries(fixturePoiWins)) {
        if (!knownPoiNames.has(poiName)) throw new Error(`World POI wins fixture names missing ${poiName}`);
        if (!Number.isSafeInteger(wins) || (wins as number) < 0) {
          throw new Error(`World POI wins fixture has invalid ${poiName} count ${String(wins)}`);
        }
        worldSharedState.poiWins.set(poiName, wins as number);
      }
    }
    if (
      (globalThis as Record<string, unknown>)["__DIB_TEST_TOWN_DIRTY_REFRESH__"] === true
    ) {
      const preferredProbe =
        (globalThis as Record<string, unknown>)["__DIB_TEST_TOWN_DIRTY_REFRESH_POI__"] as
          | string
          | undefined;
      const probe = initialWorldData.pointsOfInterest.find(
        (poi) => poi.name === preferredProbe && poi.name !== initialPoiName,
      ) ?? initialWorldData.pointsOfInterest.find((poi) => poi.name !== initialPoiName);
      if (probe === undefined) throw new Error("town refresh test hook requires a second POI");
      worldSharedState.occurrenceThisRefresh.set(probe.name, false);
      worldSharedState.completedThisRefresh.add(probe.name);
    }
    worldTrip = createWorldTrip(
      initialWorldData,
      initialPoiName,
      worldRng,
      knownShortTypes,
      worldSharedState,
      guildQuests,
      localWorldTripQuestEvents(),
    );
    captureSerial = 0;
  };
  const adoptOfficialProjection = (): void => {
    if (officialSlot === undefined || initialWorldData === undefined) return;
    const projection = officialSlot.coordinator.projection;
    const snapshot = projectionToGameState(officialSlot.coordinator.projection);
    if (snapshot.world === undefined || snapshot.player.party.kind !== "world-trip-party") {
      throw new Error("official projection cannot rebuild the world session");
    }
    if (snapshot.quests === undefined || questCatalog === undefined) {
      throw new Error("official projection cannot rebuild Guild/story state");
    }
    if ((projection.location.kind === "battle") !== (projection.battle !== undefined)) {
      throw new Error("official battle location and battle envelope disagree");
    }
    const legacyDungeonTopology = snapshot.dungeon !== undefined &&
      dungeonRunUsesLegacyTopology(snapshot.dungeon);
    if (
      legacyDungeonTopology &&
      projection.location.kind === "battle"
    ) {
      throw new Error(
        "official dungeon battle cannot be adopted from legacy synthetic room geometry",
      );
    }
    if (
      legacyDungeonTopology &&
      projection.location.kind === "dungeon" &&
      (
        projection.location.dungeonId !== snapshot.dungeon!.current.session.definitionId ||
        projection.location.floor !== snapshot.dungeon!.current.session.floor ||
        projection.location.roomId !== snapshot.dungeon!.current.session.currentRoomId
      )
    ) {
      throw new Error("official legacy dungeon location cannot be mapped to its run");
    }
    type PreparedWorld = {
      readonly data: WorldData;
      readonly shared: WorldTripSharedState;
      readonly rng: ReplayableRng;
      readonly trip: ReturnType<typeof createWorldTrip>;
      readonly visitedTownNames: readonly string[];
    };
    let preparedPlayer: PlayerRuntimeState | undefined;
    let preparedQuests: GuildQuestRuntime | undefined;
    const prepared = prepareOfficialProjectionAdoption<
      PlayerRuntimeState,
      GuildQuestRuntime,
      PreparedWorld,
      PreparedAuthoritativeDungeonRun
    >({
      player: () => {
        const player = PlayerRuntimeState.fromStateSnapshot(game.gd, snapshot.player);
        preparedPlayer = player;
        return player;
      },
      quests: () => {
        const quests = new GuildQuestRuntime(questCatalog, snapshot.quests!);
        preparedQuests = quests;
        return quests;
      },
      world: () => {
        const shared = restoreWorldTripSharedState(snapshot.world!);
        const rng = replayableRng([]);
        const data = snapshot.world!.worldName === initialWorldData.name
          ? initialWorldData
          : loadWorldData(
              content.resources,
              snapshot.world!.worldName,
              new Set(knownShortTypes),
            );
        const quests = preparedQuests;
        if (quests === undefined) throw new Error("official quest preflight did not complete");
        return {
          data,
          shared,
          rng,
          trip: createWorldTrip(
            data,
            snapshot.world!.currentPoiName,
            rng,
            knownShortTypes,
            shared,
            quests,
          ),
          visitedTownNames: projection.world?.visitedTownIds ?? [snapshot.world!.lastTownName ?? ""],
        };
      },
      dungeon: () => {
        if (dungeonFeature === undefined) {
          if (snapshot.dungeon !== undefined) {
            throw new Error("official projection contains a dungeon without a dungeon feature");
          }
          return { hasAuthoritativeRun: false, run: undefined, insideDungeon: false };
        }
        const player = preparedPlayer;
        const quests = preparedQuests;
        if (player === undefined || quests === undefined) {
          throw new Error("official dungeon preflight dependencies are incomplete");
        }
        const context: DungeonRuntimeContext = {
          resources: content.resources,
          monsterTypes: game.gd.allMonsters().map((monster) => monster.shortType),
          isCompletionSet: (key) => quests.hasCompletedFixedEncounter(key),
          isQuestUsable: (key) => quests.canUseQuestKey(key),
          isMonsterRegistered: (shortType) => player.profile.highestRegisteredLevel(shortType) > 0,
          isCatchQuestDone: (instanceName) => player.profile.hasCompletedCatchQuest(instanceName),
          waypointFloorsForDungeon: (instanceName) => player.profile.dungeonWaypointsFor(instanceName),
        };
        return dungeonFeature.prepareAuthoritativeRun(snapshot.dungeon, context);
      },
    });
    // These are the cross-envelope checks that must complete before a live listener or reference
    // changes. The projection is already structurally parsed by projectionToGameState above.
    const projectedDungeon = projection.dungeon !== undefined;
    if (prepared.dungeon.hasAuthoritativeRun !== projectedDungeon) {
      throw new Error("official projection dungeon envelope is inconsistent");
    }
    if (projection.location.kind === "dungeon" && !prepared.dungeon.hasAuthoritativeRun) {
      throw new Error("official dungeon location omitted its authoritative run");
    }
    if (
      projectedDungeon &&
      (projection.location.kind === "none" ||
        projection.location.kind === "world" ||
        projection.location.kind === "town")
    ) {
      throw new Error("official dungeon run is attached to a non-dungeon location");
    }
    if (prepared.world.data.name !== snapshot.world.worldName) {
      throw new Error("official projection world data does not match its world envelope");
    }
    if (prepared.world.trip.currentPoiName !== snapshot.world.currentPoiName) {
      throw new Error("official projection world trip does not match its current POI");
    }
    if (projection.location.kind !== "dungeon" && projection.location.kind !== "none") {
      const locationPoi = projection.location.kind === "town"
        ? projection.location.townId
        : projection.location.poiId;
      if (
        projection.location.worldId !== snapshot.world.worldName ||
        locationPoi !== snapshot.world.currentPoiName
      ) {
        throw new Error("official projection location disagrees with its world envelope");
      }
    }
    if (projectedDungeon) {
      const dungeon = projection.dungeon!;
      const preparedRun = prepared.dungeon.run;
      if (preparedRun === undefined) throw new Error("official dungeon preflight omitted its run");
      const preparedFloor = preparedRun.session.snapshot();
      const effectiveDungeonLocation = legacyDungeonTopology && projection.location.kind === "dungeon"
        ? {
            ...projection.location,
            dungeonId: preparedFloor.definitionId,
            floor: preparedFloor.floor,
            roomId: preparedFloor.currentRoomId,
          }
        : projection.location;
      if (
        dungeon.worldId !== snapshot.world.worldName ||
        dungeon.entrancePoiId !== snapshot.world.currentPoiName
      ) {
        throw new Error("official dungeon envelope disagrees with its world envelope");
      }
      if (
        effectiveDungeonLocation.kind === "dungeon" &&
        (effectiveDungeonLocation.dungeonId !== preparedFloor.definitionId ||
          effectiveDungeonLocation.floor !== preparedFloor.floor ||
          effectiveDungeonLocation.roomId !== preparedFloor.currentRoomId)
      ) {
        throw new Error("official dungeon location disagrees with its restored run");
      }
    }
    const adoptedPlayer = prepared.player;
    const adoptedQuests = prepared.quests;
    const preparedWorld = prepared.world;
    // All operations below are deliberately non-fallible assignments/setter bindings. Bind the
    // replacement listeners before any live reference changes; a future setter failure therefore
    // cannot leave the current player, quest, world, or dungeon objects mixed with new state.
    connectQuestEvents(adoptedPlayer);
    attachGuildQuestRuntime(adoptedQuests);
    adoptedPlayer.setChangeListener(checkpoint);
    commitOfficialProjectionAdoption(prepared, (aggregate) => {
      const world = aggregate.world;
      dungeonFeature?.adoptPreparedAuthoritativeRun(aggregate.dungeon);
      playerRuntime = aggregate.player;
      guildQuests = aggregate.quests;
      worldData = world.data;
      worldSharedState = world.shared;
      worldTrip = world.trip;
      latestWorldProgress = snapshot.world;
      lastTownName = snapshot.world!.lastTownName;
      visitedTownNames.clear();
      for (const town of world.visitedTownNames) {
        if (town.length > 0) visitedTownNames.add(town);
      }
      officialWorldRng = world.rng;
      worldRng = world.rng;
    });
  };
  const syncOfficialWorldProjection = (): void => {
    const projected = officialSlot?.coordinator.projection.world;
    if (projected === undefined || worldSharedState === undefined) return;
    worldSharedState.occurrenceThisRefresh.clear();
    for (const [poi, occurs] of Object.entries(projected.occurrenceByPoi)) {
      worldSharedState.occurrenceThisRefresh.set(poi, occurs);
    }
    worldSharedState.completedThisRefresh.clear();
    for (const poi of projected.completedPoiIds) worldSharedState.completedThisRefresh.add(poi);
    worldSharedState.poiWins.clear();
    for (const [poi, wins] of Object.entries(projected.poiWins)) {
      worldSharedState.poiWins.set(poi, wins);
    }
    worldSharedState.everCompletedPois.clear();
    for (const poi of projected.everCompletedPoiIds) worldSharedState.everCompletedPois.add(poi);
    visitedTownNames.clear();
    for (const town of projected.visitedTownIds ?? [projected.lastTownId]) {
      visitedTownNames.add(town);
    }
    worldSharedState.dayNumber = projected.dayNumber;
    lastTownName = projected.lastTownId;
  };
  const syncOfficialQuestProjection = (): void => {
    if (officialSlot === undefined || guildQuests === undefined) return;
    const projected = officialSlot.coordinator.projection.quests;
    if (projected === undefined) {
      throw new Error("official projection omitted advertised Guild/story state");
    }
    guildQuests.replaceStateSnapshot({
      schemaVersion: 1,
      activeQuestNames: projected.activeQuestNames,
      finishedQuestNames: projected.finishedQuestNames,
      progressByQuestName: projected.progressByQuestName,
      dialogsSeen: projected.dialogsSeen,
      completedFixedEncounterKeys: projected.completedFixedEncounterKeys,
      receivedBattleRewardKeys: projected.receivedBattleRewardKeys,
    });
  };
  /**
   * Settle the authority's deferred defeat decision before any exit adopts a projection. Without
   * it the slot stays pinned on `pendingDefeat` and rejects every subsequent command, and the
   * committed projection is still sitting in its battle location.
   */
  const submitOfficialDefeatReturn = async (): Promise<void> => {
    if (officialSlot === undefined) return;
    await resolveOfficialDefeatReturn(
      officialSlot.coordinator.projection,
      (command) => officialSlot.coordinator.submit(command),
    );
  };
  const submitOfficialTutorialFlag = async (flag: string): Promise<void> => {
    if (officialSlot === undefined) return;
    try {
      await officialSlot.coordinator.submit({
        type: "player.claimTutorialFlag",
        flag,
      });
    } catch (error) {
      // A conflict path has already bootstrapped the coordinator. Mirror any tutorial claims made
      // by the other writer so the current scene can retry without submitting a duplicate no-op.
      for (const claimed of officialSlot.coordinator.projection.player.tutorialFlags) {
        playerRuntime?.profile.claimTutorialFlag(claimed);
      }
      throw error;
    }
  };
  if (useWorldDemo) startWorldSession();
  else standalonePlayer?.setChangeListener(checkpoint);

  /**
   * World-owned monster identities are process-local: `worldGeneration` restarts at 1 and
   * `captureSerial` at 0 on every boot, so a restored save already holding `trip-1-capture-1-X`
   * collides with the first capture of the new session (WorldTripParty rejects duplicate
   * instanceIds). Skip past any id the live party already owns, exactly as
   * `WorldNode.nextCombineInstanceId` does; the dungeon route instead persists its serial in the
   * run snapshot.
   */
  const nextPartyInstanceId = (prefix: string, shortType: string): string => {
    const existing = new Set(
      (playerRuntime?.party?.monsters() ?? []).map((monster) => monster.instanceId),
    );
    let candidate: string;
    do {
      candidate = `${prefix}-${worldGeneration}-${++captureSerial}-${shortType}`;
    } while (existing.has(candidate));
    return candidate;
  };

  /**
   * The renderer's bridge to the authoritative v12 Egg continuation.
   *
   * `submitEgg` returns the committed events so a settled monster keeps the party identity the
   * authority minted; `pendingEgg` is read back from the freshly committed projection rather than
   * cached, because every command in the sequence advances the phase. No projection *adoption*
   * happens here on purpose: adoption replaces `playerRuntime` and the party object, and an Egg is
   * hatched mid-scene by nodes that hold both by reference. The retained aggregates are mirrored
   * in place instead, exactly as `WorldNode.mutateInventory` mirrors a committed inventory command.
   */
  const officialEggAuthority = (): OfficialEggHatchAuthority => ({
    submitEgg: async (command) => {
      const slot = officialSlot;
      if (slot === undefined) throw new Error("Egg continuation requires the official authority");
      const result = await slot.coordinator.submit(command);
      return result.events;
    },
    pendingEgg: () => {
      const pending = officialSlot?.coordinator.projection.pendingEgg;
      return pending !== undefined && "phase" in pending ? pending : undefined;
    },
    spendRepeatGold: (cost) => playerRuntime?.profile.spendGold(cost) ?? false,
  });

  /**
   * Run a pending Egg continuation to `egg.finish` against an already-mounted presentation parent.
   * Used by the entry points that own no `WorldNode` (tournament prizes, boot-time resume).
   */
  const runOfficialEggHatch = async (host: {
    readonly parent: EggHatchFlowOptions["parent"];
    readonly owner: object;
    readonly instanceIdPrefix: string;
  }): Promise<void> => {
    const authority = officialEggAuthority();
    const pending = authority.pendingEgg();
    if (pending === undefined || playerRuntime === undefined) return;
    const flow = await EggHatchFlow.show({
      parent: host.parent,
      owner: host.owner,
      game,
      audio,
      ticker: stage.app.ticker,
      player: playerRuntime,
      session: createOfficialEggHatchSession(authority),
      kind: pending.kind,
      nextMonsterInstanceId: (shortType) =>
        nextPartyInstanceId(host.instanceIdPrefix, shortType),
      onStateChanged: checkpoint,
      openGoldStore: () => openGoldStoreHandoff(
        playerRuntime!,
        () => ({ parent: host.parent, owner: host.owner }),
        () => undefined,
        "Purchases are unavailable while an Official Egg decision is pending.",
      ),
    });
    await flow.finished;
  };

  const nextBattleSeed = (): number | Rng =>
    FIDELITY_LAB?.rng ??
    ((globalThis as Record<string, unknown>)["__DIB_TEST_BATTLE_SEED__"] as number | undefined) ??
    (deterministicHarness ? 20260708 : Math.floor(Math.random() * 0x100000000));
  let dungeonRunGeneration = 0;
  const nextDungeonSeed = (): number => {
    const configured = (globalThis as Record<string, unknown>)["__DIB_TEST_DUNGEON_SEED__"] as
      | number
      | undefined;
    const seed = configured === undefined
      ? deterministicHarness
        ? 20260724 + dungeonRunGeneration
        : Math.floor(Math.random() * 0x100000000)
      : configured + dungeonRunGeneration;
    dungeonRunGeneration++;
    return seed >>> 0;
  };

  type WorldStart =
    | { readonly kind: "initial"; readonly fade: boolean; readonly townName: string }
    | { readonly kind: "resumeWorld" }
    | { readonly kind: "resumeTown"; readonly townName: string }
    | { readonly kind: "worldSlide"; readonly delta: { readonly x: number; readonly y: number } }
    | { readonly kind: "worldFade" }
    | {
        readonly kind: "townPortal" | "townWarp" | "combatLoss" | "tournamentExit";
        readonly townName: string;
        readonly terminalStateCommitted?: boolean;
      }






    | {
        readonly kind: "arenaReturn";
        readonly townName: string;
        readonly autoEnterTown: boolean;
      }
    | { readonly kind: "battleReturn" | "dungeonReturn"; readonly suppressCheckpoint?: boolean };

  // Open world interactions register here. Town entry deliberately retains the live WorldNode:
  // native TownPOINode zooms and animates that map instead of replacing it with a parallel state.
  const worldSceneHandlers = new SceneHandlerRegistry<WorldSceneRequest>();
  worldSceneHandlers.register("town", async (request) => {
    if (request.arrival.kind === "encounter") {
      throw new Error(
        `Town scene received encounter-bearing arrival for ${request.poi.name}; ` +
          "arrival encounters must dispatch before town continuation",
      );
    }
    const current = scenes.current;
    if (!(current instanceof WorldNode)) throw new Error("Town entry requires the active world scene");


    dungeonFeature?.clear();
    await current.enterTown(request.poi.name);
  });
  worldSceneHandlers.register("dungeon", async (request) => {
    if (dungeonFeature === undefined) {
      throw new Error("Dungeon scene was requested without a verified dungeon feature adapter");
    }
    if (officialSlot === undefined) {
      await dungeonFeature.enterFromWorld(request);
      return;
    }
    const result = await officialSlot.coordinator.submit({
      type: "world.activateZone",
      zoneId: request.poi.name,
    });
    if (result.projection.dungeon === undefined) {
      throw new Error("Official dungeon entry omitted its authoritative run");
    }
    adoptOfficialProjection();
    retainOfficialQuestEvents(result.events);
    retainOfficialInfiniteFloorEntries(result.events);
    await dungeonFeature.enterPreparedAuthoritativeFromWorld();
  });
  // No authoritative command records the `MonsterCollection` intro chat (`player.claimDialog` is
  // town-enter only, `claimTutorialFlag` is allowlist-gated), but none is needed: the chat has no
  // `Chats.plist` record, so its synthesized `alwaysShow` is 1 and the source replays it on every
  // visit anyway. This set only keeps the shared seam honest for authored show-once records.
  const officialCollectionChatSeen = new Set<string>();
  const worldCollectionAdapter = officialSlot === undefined
    ? createLocalCollectionAdapter({
        official: false,
        hasCollectionRoute: game.hasCollectionRoute,
        dialogs: guildQuests ?? collectionDialogs,
        nextPartyInstanceId,
      })
    : createOfficialCollectionAdapter({
        official: true,
        hasCollectionRoute: game.hasCollectionRoute,
        introChatSeen: officialCollectionChatSeen,
        mirror: () => {
          if (playerRuntime === undefined) {
            throw new Error("official Collection claim has no live player aggregate");
          }
          return playerRuntime;
        },
        claim: async (goalId) => {
          const result = await officialSlot.coordinator.submit({
            type: "collection.claim",
            goalId,
          });
          const claimed = result.events.find((event) =>
            event.type === "quest.rewardClaimed" && event.questId === goalId);
          if (claimed === undefined || claimed.type !== "quest.rewardClaimed") {
            throw new Error(`official Collection goal ${goalId} omitted its committed rewards`);
          }
          return {
            rewards: claimed.rewards,
            committedMonsterIds: result.events.flatMap((event) =>
              event.type === "player.monsterAdded" && event.reason === "reward"
                ? [event.instanceId]
                : []),
          };
        },
      });
  const worldPoiRouting = createWorldPoiRoutingPolicy({
    collections: game.hasCollectionRoute && worldCollectionAdapter !== undefined,
    dungeons: content.hasDungeonCapability,
    worldExits: true,
  });
  // `GlobalSavedData.visitedWorlds` stand-in until the world-progress save schema owns this set.
  // Every mounted world is necessarily visited; BigMapNode uses it to mask the remaining 4x4 cells.
  const visitedWorlds = new Set<string>();
  let onTownPortal: (() => Promise<void>) | undefined;
  let onTournamentExit: (() => Promise<void>) | undefined;
  let runInitialScenarioAction: (() => Promise<void>) | undefined;

  const startWorld = async (entry: WorldStart): Promise<void> => {
    if (!worldData || !worldTrip || !worldRng || !worldSharedState || !playerRuntime?.party) {
      throw new Error("world demo state is missing");
    }
    const worldForScene = worldData;
    visitedWorlds.add(worldForScene.name);
    const runtimeForScene = playerRuntime;
    const partyForScene = playerRuntime.party;
    const tripForScene = worldTrip;
    const profileForScene = playerRuntime.profile;
    let node!: WorldNode;
    // `entry` distinguishes walking into the encounter from a Save Me restart of the fight that was
    // just lost (see BattleExitOutcome). The roster is deterministic from `arrival`, so a restart
    // rebuilds the identical enemies; only the player team differs, being freshly derived from the
    // healed party. The arrival transition zooms out of the world node, which a restart no longer
    // has on stage, so the two entries mount through different transitions.
    const mountWorldBattle = async (
      { arrival, poi }: WorldEncounterRequest,
      entry: "arrival" | "restart",
    ): Promise<void> => {
      const battleRuntime = officialSlot === undefined ? runtimeForScene : playerRuntime;
      if (battleRuntime?.party === undefined) {
        throw new Error("World battle requires a live player aggregate");
      }
      const backgroundKey = combatBackgroundSpriteKey(poi.combatBackground ?? worldForScene.combatBackground);
      if (!content.combatBackgroundKeys.includes(backgroundKey)) {
        throw new Error(`World encounter references unavailable combat background ${backgroundKey}`);
      }
      const worldBattle = buildWorldBattle(
        arrival.encounter,
        backgroundKey,
        battleRuntime.party.projectAliveBattingPrefix(),
      );
      const nextEncounter = withWorldBattleSaveMePolicy(worldBattle.encounter, {
        owner: "world",
        authority: officialSlot === undefined ? "local" : "official",
      });
      const projectedBattle = officialSlot?.coordinator.projection.battle;
      if (officialSlot !== undefined && projectedBattle === undefined) {
        throw new Error("official world encounter has no authoritative battle projection");
      }
      const officialBattleRng = projectedBattle === undefined
        ? undefined
        : replayableRng(projectedBattle.randomDraws);
      pendingOfficialBattleRewards.length = 0;
      let markReady!: () => void;
      const ready = new Promise<void>((resolve) => { markReady = resolve; });
      const returnToRetainedWorld = async (autoEnterTownName?: string): Promise<void> => {
        if (officialSlot !== undefined) {
          if (!worldData || !worldTrip || !worldRng || !worldSharedState || !playerRuntime?.party) {
            throw new Error("Official battle return cannot rebind the retained world session");
          }
          const adoptedRuntime = playerRuntime;
          const adoptedParty = playerRuntime.party;
          node.rebindRetainedSession({
            world: worldData,
            trip: worldTrip,
            party: adoptedParty,
            playerRuntime: adoptedRuntime,
            ...(guildQuests === undefined ? {} : { guildQuests }),
            questRewardRng: worldRng,
            ...(FIDELITY_LAB?.foundationDictionaryOrder === undefined
              ? {}
              : { fidelityFoundationOrder: FIDELITY_LAB.foundationDictionaryOrder }),
            refreshState: worldSharedState,
            heroProgress: {
              get level() { return adoptedRuntime.profile.heroLevel; },
              get totalHighestLevels() {
                return adoptedRuntime.profile.heroTotalHighestLevels;
              },
            },
          });
        }
        node.prepareBattleReturn();
        await scenes.replace(node, async ({ outgoing, activate, retireOutgoing }) => {
          if (outgoing?.sceneKind !== "battle") {
            throw new Error("Retained world battle return requires an outgoing battle scene");
          }
          const shade = new Graphics().rect(0, 0, stagePx.w, stagePx.h).fill(0x000000);
          shade.alpha = 0;
          stage.root.addChild(shade);
          try {
            await tween(stage.app.ticker, 250, (t) => { shade.alpha = t; });
            retireOutgoing();
            activate();
            if (autoEnterTownName === undefined) {
              node.playFieldMusic();
            } else {
              await node.enterTown(autoEnterTownName);
            }
            await tween(stage.app.ticker, 250, (t) => { shade.alpha = 1 - t; });
          } finally {
            shade.destroy();
          }
        }, { preserveIncomingOnFailure: true });
        // SceneCoordinator clears its replacement flag only after the callback above returns.
        // Unlocking here prevents a last-fade-frame tap from attempting a nested replacement.
        // Town entry owns its own one-second lockout through `showNameplate`; releasing the field
        // lock here would make its controls active before the source reveal boundary.
        if (autoEnterTownName === undefined) node.finishReturnTransition();
        checkpoint();
      };
      const discardRetainedWorld = (): void => { node.destroy(); };
      let battle!: BattleNode;
      battle = new BattleNode({
        stage,
        game,
        audio,
        keyboard,
        encounter: nextEncounter,
        tripParty: battleRuntime.battleParty(),
        captureInstanceId: (shortType) => nextPartyInstanceId("trip-capture", shortType),
        playerState: battleRuntime.battleState(),
        defeatRecovery: officialSlot === undefined
          ? localDefeatRecovery(battleRuntime, nextEncounter, () => battle)
          : officialDefeatRecovery(battleRuntime, () => battle),
        openGoldStore: () => openGoldStoreHandoff(
          battleRuntime,
          () => ({ parent: battle.notificationParent, owner: battle }),
          officialSlot === undefined ? checkpoint : () => undefined,
          officialSlot === undefined
            ? undefined
            : "Purchases are unavailable while an Official battle is active.",
        ),
        ...(projectedBattle === undefined || officialBattleRng === undefined
          ? {}
          : {
              authority: {
                battleId: projectedBattle.battleId,
                replay: officialBattleReplay(projectedBattle),
                submit: async (command) => {
                  const result = await officialSlot!.coordinator.submit(command);
                  const replay = result.events.find((event) =>
                    event.type === "battle.replayAdvanced");
                  if (replay === undefined || replay.battleId !== projectedBattle.battleId) {
                    throw new Error("official battle response omitted its committed draw suffix");
                  }
                  officialBattleRng.appendCommittedDraws(replay.randomDraws);
                  retainOfficialQuestEvents(result.events);
                  retainOfficialBattleRewards(result.events);
                },
                claimTutorialFlag: async (flag) => {
                  await submitOfficialTutorialFlag(flag);
                },
              },
            }),
        ...localGuildQuestEventOption(officialSlot !== undefined, dispatchGuildQuestEvent),
        ...(guildQuests === undefined
          ? {}
          : {
              requestChatPresentation: (name: string, alwaysShow: boolean) =>
                guildQuests!.requestChatPresentation(name, alwaysShow),
            }),
          onReady: markReady,
          onExit: async (outcome) => {
            if (outcome === "saveMe") {



              battle.teardownCombatMonstersForReturn();
              if (officialSlot !== undefined) {
                adoptOfficialProjection();
                // Historical Official versions intentionally minted a replacement battle. Keep
                // their immutable projection readable while current v22 takes the source route.
                if (officialSlot.coordinator.projection.location.kind === "battle") {
                  await mountWorldBattle({ arrival, poi }, "restart");
                  return;
                }
              }
              await returnToRetainedWorld(
                worldBattleReturnsToOriginTown("saveMe", poi.town !== undefined)
                  ? poi.name
                  : undefined,
              );
              return;
            }
          if (officialSlot !== undefined) {
            const committedRewards = pendingOfficialBattleRewards.splice(0);
            if (outcome === "defeat") await submitOfficialDefeatReturn();
            adoptOfficialProjection();
            presentRetainedOfficialQuestEvents();
            if (outcome === "victory" && committedRewards.length > 0) {
              await showDungeonLootManagement({
                parent: battle.notificationParent,
                owner: battle,
                game,
                audio,
                ticker: stage.app.ticker,
              }, committedRewards, () => {
                // The command service already committed every reward atomically. This callback
                // only closes the source LootPageProvider presentation; it must not apply twice.
              });
            }
            await runOfficialEggHatch({
              parent: battle.notificationParent,
              owner: battle,
              instanceIdPrefix: "official-battle-egg",
            });
            if (officialSlot.coordinator.projection.location.kind === "town") {
              discardRetainedWorld();
              await returnAfterCombatLoss({ terminalStateCommitted: true });
            } else {
              await returnToRetainedWorld();
            }
            return;
          }
          if (outcome === "victory") {
            tripForScene.recordEncounterWin(arrival.poiName);
            const rewardAlreadyReceived =
              worldBattle.rewardKey !== undefined &&
              guildQuests?.hasReceivedBattleReward(worldBattle.rewardKey) === true;
            if (worldBattle.rewards.length > 0 && !rewardAlreadyReceived) {
              await showDungeonLootManagement({
                parent: battle.notificationParent,
                owner: battle,
                game,
                audio,
                ticker: stage.app.ticker,
              }, worldBattle.rewards, async (remaining) => {
                for (const reward of remaining) {
                  if (reward.kind === "egg" || reward.kind === "monsterEgg" || reward.kind === "repeatEgg") {
                    const flow = await EggHatchFlow.show({
                      parent: battle.notificationParent,
                      owner: battle,
                      game,
                      audio,
                      ticker: stage.app.ticker,
                      player: runtimeForScene,
                      rng: worldRng!,
                      ...(FIDELITY_LAB?.foundationDictionaryOrder === undefined
                        ? {}
                        : { foundationDictionaryOrder: FIDELITY_LAB.foundationDictionaryOrder }),
                      kind: reward.kind === "monsterEgg" ? "gold" : "silver",
                      ...(reward.kind === "repeatEgg" ? { repeatPicks: reward.numRepeats } : {}),
                      nextMonsterInstanceId: (shortType) =>
                        nextPartyInstanceId("egg-hatch", shortType),
                      onStateChanged: checkpoint,
                      openGoldStore: () => openGoldStoreHandoff(
                        runtimeForScene,
                        () => ({ parent: battle.notificationParent, owner: battle }),
                        checkpoint,
                      ),
                    });
                    await flow.finished;
                  } else {
                    applyPlayerRewards(runtimeForScene.profile, [reward], {
                      addMonsterJoin: (shortType, jobLevel) => {
                        const joined = runtimeForScene.addJoinedMonster(
                          nextPartyInstanceId("fixed-reward", shortType),
                          shortType,
                          jobLevel,
                        );
                        return { instanceId: joined.instanceId };
                      },
                    });
                    checkpoint();
                  }
                }
                if (worldBattle.rewardKey !== undefined) {
                  guildQuests?.markBattleRewardReceived(worldBattle.rewardKey);
                }
                checkpoint();
              });
            }
          }
          if (outcome === "defeat") {





            discardRetainedWorld();
            await returnAfterCombatLoss();
            return;
          }
          await returnToRetainedWorld(
            worldBattleReturnsToOriginTown(outcome, poi.town !== undefined)
              ? poi.name
              : undefined,
          );
        },
      });
      // Native constructs the BattleNode (and plays Encounter) before transition onEnter. Keep its
      // Pixi root hidden while assets/building finish behind the outgoing world.
      battle.setSceneVisible(false);
      const prepareBattle = async (): Promise<void> => {
        await preloadWorldEncounter(nextEncounter);
        const run = battle.start(officialBattleRng ?? nextBattleSeed());
        await Promise.race([
          ready,
          run.then(() => { throw new Error("BattleNode ended before its transition-ready callback"); }),
        ]);
        void run.catch((error: unknown) => {
          console.error("World-owned BattleNode failed", error);
          queueMicrotask(() => { throw error; });
        });
      };
      if (entry === "restart") {
        // The outgoing scene is the lost battle, not the world, so there is no encounter zoom to
        // play; the healed fight simply takes the stage once it has built.
        await scenes.replace(battle, async ({ activate }) => {
          await prepareBattle();
          activate();
          battle.notifyEnterTransitionDidFinish();
        });
        return;
      }
      await scenes.replace(battle, async ({ outgoing, activate, retainOutgoing }) => {
        if (outgoing !== node) throw new Error("World encounter transition lost its outgoing world scene");
        const zoom = node.playEncounterZoom(poi.name);
        const prepare = prepareBattle();
        await Promise.all([zoom, prepare]);
        node.coverIncomingScene();
        activate();
        await node.finishEncounterZoom();
        retainOutgoing();
        battle.notifyEnterTransitionDidFinish();
      });
    };
    const onEncounter = async (request: WorldEncounterRequest): Promise<void> => {
      await mountWorldBattle(request, "arrival");
    };
    const onWorldExit = async ({ targetWorld, targetPoi }: WorldExitRequest): Promise<void> => {
      // Validate and materialize the browser-local destination before an Official command can
      // commit it. The authority already accepts every authored world link; package failures must
      // not leave its projection one world ahead of the visible client.
      if (!content.worldNames.includes(targetWorld)) {
        throw new Error(`World exit from ${worldForScene.name} references unavailable world ${targetWorld}`);
      }
      const targetData = loadWorldData(content.resources, targetWorld, new Set(knownShortTypes));
      if (!targetData.pointsOfInterest.some((poi) => poi.name === targetPoi)) {
        throw new Error(`World exit ${worldForScene.name} references missing ${targetWorld}.${targetPoi}`);
      }
      const presentation = worldTransitionPresentation(
        worldForScene.name,
        targetWorld,
        DISPLAY_MODE,
      );
      if (officialSlot !== undefined) {
        const currentPoiId = officialSlot.coordinator.projection.location.kind === "world"
          ? officialSlot.coordinator.projection.location.poiId
          : undefined;
        if (currentPoiId === undefined) {
          throw new Error("Official world exit requires a world projection");
        }
        const result = await officialSlot.coordinator.submit({
          type: "world.activateZone",
          zoneId: currentPoiId,
        });
        if (
          result.projection.location.kind !== "world" ||
          result.projection.location.worldId !== targetWorld ||
          result.projection.location.poiId !== targetPoi
        ) {
          throw new Error(`Official world exit did not commit ${targetWorld}.${targetPoi}`);
        }
        syncOfficialWorldProjection();
      }
      // Reuse the trip RNG object and all durable player objects. createWorldTrip.begin() performs
      // the source's first-arrival suppression at the target zone-change POI.
      const targetTrip = createWorldTrip(
        targetData,
        targetPoi,
        worldRng!,
        knownShortTypes,
        worldSharedState,
        guildQuests,
        localWorldTripQuestEvents(),
      );
      worldData = targetData;
      worldTrip = targetTrip;
      await startWorld(
        presentation.kind === "cardinal-slide"
          ? { kind: "worldSlide", delta: presentation.delta }
          : { kind: "worldFade" },
      );
    };
    const onArenaChallenge = async ({
      license,
      townName,
    }: ArenaChallengeRequest): Promise<void> => {
      const challenge = buildLicenseChallengeEncounter(license);
      // ChatGameFlowEvent belongs to Encounter/BattleNode. Presenting it here used the raw
      // device-pixel stage before BattleNode existed: the dialog was half-sized, could be painted
      // under the incoming combat board, and said "Fight!" before that board was ready.
      const challengeStartChat = challenge.startChatKey === undefined
        ? undefined
        : loadChatDefinition(content.resources, challenge.startChatKey);
      const challengeWinChat = challenge.winChatKey === undefined
        ? undefined
        : loadChatDefinition(content.resources, challenge.winChatKey);
      const officialStart = officialSlot === undefined
        ? undefined
        : await officialSlot.coordinator.submit({ type: "arena.startLicenseChallenge" });
      const projectedBattle = officialStart?.projection.battle;
      if (officialSlot !== undefined && projectedBattle === undefined) {
        throw new Error("Official Arena challenge omitted its battle projection");
      }
      // The Arena background is a source constant and always resolved locally; the authority owns
      // the roster and rewards, not which art presents them.
      const backgroundKey = combatBackgroundSpriteKey(ARENA_COMBAT_BACKGROUND_FILE);
      if (!content.combatBackgroundKeys.includes(backgroundKey)) {
        throw new Error(`Arena challenge references unavailable combat background ${backgroundKey}`);
      }
      const built = projectedBattle === undefined
        ? buildWorldBattle(
            challenge.encounter,
            backgroundKey,
            partyForScene.projectAliveBattingPrefix(),
          )
        : undefined;
      const replay = projectedBattle === undefined ? undefined : officialBattleReplay(projectedBattle);
      const arenaEncounter = withWorldBattleSaveMePolicy(
        projectedBattle === undefined
          ? {
            ...built!.encounter,
            allowRetreat: false,
            ...(challengeStartChat === undefined ? {} : { startChat: challengeStartChat }),
            ...(challengeWinChat === undefined ? {} : { winChat: challengeWinChat }),
          }
          : {
            backgroundKey,
            allowRetreat: false,
            ...(challengeStartChat === undefined ? {} : { startChat: challengeStartChat }),
            ...(challengeWinChat === undefined ? {} : { winChat: challengeWinChat }),
            ...(projectedBattle.breederXpBonus === undefined
              ? {}
              : { breederXpBonus: projectedBattle.breederXpBonus }),
            playerTeam: replay!.teams[0].map((member) => ({ ...member })),
            enemyTeam: replay!.teams[1].map((member) => ({ ...member })),
          },
        {
          owner: "arena",
          authority: officialSlot === undefined ? "local" : "official",
        },
      );
      const officialArenaRng = projectedBattle === undefined
        ? undefined
        : replayableRng(projectedBattle.randomDraws);
      let markReady!: () => void;
      const ready = new Promise<void>((resolve) => { markReady = resolve; });
      let battle!: BattleNode;
      battle = new BattleNode({
        stage,
        game,
        audio,
        keyboard,
        encounter: arenaEncounter,
        tripParty: runtimeForScene.battleParty(),
        captureInstanceId: (shortType) => nextPartyInstanceId("arena-capture", shortType),
        playerState: runtimeForScene.battleState(),
        openGoldStore: () => openGoldStoreHandoff(
          runtimeForScene,
          () => ({ parent: battle.notificationParent, owner: battle }),
          officialSlot === undefined ? checkpoint : () => undefined,
          officialSlot === undefined
            ? undefined
            : "Purchases are unavailable while an Official battle is active.",
        ),
        ...(officialSlot === undefined && guildQuests !== undefined
          ? {
              requestChatPresentation: (name: string, alwaysShow: boolean) =>
                guildQuests!.requestChatPresentation(name, alwaysShow),
            }
          : {}),
        ...(projectedBattle === undefined || officialArenaRng === undefined
          ? localGuildQuestEventOption(false, dispatchGuildQuestEvent)
          : {
              authority: {
                battleId: projectedBattle.battleId,
                replay: officialBattleReplay(projectedBattle),
                submit: async (command) => {
                  const result = await officialSlot!.coordinator.submit(command);
                  const replayEvent = result.events.find((event) =>
                    event.type === "battle.replayAdvanced");
                  if (
                    replayEvent === undefined ||
                    replayEvent.battleId !== projectedBattle.battleId
                  ) {
                    throw new Error("official Arena response omitted its committed draw suffix");
                  }
                  officialArenaRng.appendCommittedDraws(replayEvent.randomDraws);
                  retainOfficialQuestEvents(result.events);
                },
                claimTutorialFlag: submitOfficialTutorialFlag,
              },
            }),
        onReady: markReady,
        onExit: async (outcome) => {
          const disposition = arenaExitDisposition(outcome);
          if (disposition === "sourceEscapeStall") {









            return;
          }
          if (disposition === "victory") {
            if (officialSlot === undefined) {
              profileForScene.increaseLicenseAfterChallenge(license);
              checkpoint();
            } else {
              adoptOfficialProjection();
              presentRetainedOfficialQuestEvents();
            }


            enqueueQuestNotification({
              kind: "localized-message",
              title: localizedString(game.strings, "NewLicenseTitleKey"),
              message: localizedString(game.strings, "NewLicenseMessageKey"),
              image: "Icon@2x.png",
              visible: false,
            });
            const licenseName = localizedString(
              game.strings,
              `License${license.type}NameKey`,
            );






            const wonChat = await showGuildQuestChat({
              parent: battle.notificationParent,
              assets: game.assets,
              scale9: game.scale9,
              ticker: stage.app.ticker,
              message: localizedString(game.strings, "ArenaWonChatKey")
                .replace("%@", licenseName),
            });
            wonChat.root.visible = false;
            audio.playMusic(game.assets.audioUrl("Dungeon2.mp3"), {
              loop: false,
              assetName: "Dungeon2.mp3",
            });
            await showNarratedPlot({
              parent: battle.notificationParent,
              assets: game.assets,
              strings: game.strings,
              ticker: stage.app.ticker,
              keyboard,
              imageKey: "plot_start1",
              textKey: `WonLicense${profileForScene.licenseOrdinal}PlotKey`,
            });



            wonChat.root.visible = true;
          } else {
            if (officialSlot !== undefined) {
              adoptOfficialProjection();
              presentRetainedOfficialQuestEvents();
            }



            await showGuildQuestChat({
              parent: battle.notificationParent,
              assets: game.assets,
              scale9: game.scale9,
              ticker: stage.app.ticker,
              message: localizedString(game.strings, "ArenaLostChatKey"),
            });
          }


          await startWorld({
            kind: "arenaReturn",
            townName,
            autoEnterTown: disposition === "defeat",
          });
        },
      });
      battle.setSceneVisible(false);
      await scenes.replace(battle, async ({ outgoing, activate, retireOutgoing }) => {
        if (outgoing !== node) {
          throw new Error("Arena challenge transition lost its outgoing town scene");
        }
        const prepare = (async (): Promise<void> => {
          await preloadWorldEncounter(arenaEncounter);
          const run = battle.start(officialArenaRng ?? nextBattleSeed());
          await Promise.race([
            ready,
            run.then(() => { throw new Error("Arena BattleNode ended before becoming ready"); }),
          ]);
          void run.catch((error: unknown) => {
            console.error("Arena-owned BattleNode failed", error);
            queueMicrotask(() => { throw error; });
          });
        })();
        await runSourceBlackSceneFade({
          parent: stage.root,
          ticker: stage.app.ticker,
          width: stagePx.w,
          height: stagePx.h,
          route: "arena-challenge-battle",
          onMidpoint: async () => {
            await prepare;
            retireOutgoing();
            activate();
            battle.notifyEnterTransitionDidFinish();
          },
        });
      });
    };





    const mountTournamentBattle = async (
      { tournament, round, townName, questGiver }: TournamentBattleRequest,
      entry: "arrival" | "restart",
      retainedRound?: ReturnType<typeof buildTournamentEncounter>,
    ): Promise<void> => {
      const battleRuntime = officialSlot === undefined ? runtimeForScene : playerRuntime;
      if (battleRuntime?.party === undefined) {
        throw new Error("Tournament battle requires a live player aggregate");
      }
      const localTournamentRound = officialSlot !== undefined
        ? undefined
        : entry === "restart"
          ? retainedRound
          : buildTournamentEncounter(tournament, round, worldRng!);
      const localRewards = localTournamentRound?.rewards ?? [];
      const tournamentStartChat = (() => {
        if (officialSlot === undefined) {
          return localTournamentRound?.startChatKey;
        }
        return tournamentStartChatKey(tournament, round);
      })();
      const tournamentStartChatDefinition = tournamentStartChat === undefined
        ? undefined
        : loadChatDefinition(content.resources, tournamentStartChat);
      const backgroundKey = combatBackgroundSpriteKey("ArenaCombat.png");
      if (!content.combatBackgroundKeys.includes(backgroundKey)) {
        throw new Error(`Tournament references unavailable combat background ${backgroundKey}`);
      }
      const officialStart = officialSlot === undefined || entry === "restart"
        ? undefined
        : await officialSlot.coordinator.submit({ type: "tournament.startBattle" });
      const projectedBattle = entry === "arrival"
        ? officialStart?.projection.battle
        : officialSlot?.coordinator.projection.battle;
      if (officialSlot !== undefined && projectedBattle === undefined) {
        throw new Error("Official Tournament omitted its battle projection");
      }
      const replay = projectedBattle === undefined ? undefined : officialBattleReplay(projectedBattle);
      let tournamentEncounter: EncounterConfig;
      if (projectedBattle === undefined) {
        if (localTournamentRound === undefined) {
          throw new Error("Local Tournament data unavailable");
        }
        const built = buildWorldBattle(
          localTournamentRound.encounter,
          backgroundKey,
          battleRuntime.party.projectAliveBattingPrefix(),
        );
        tournamentEncounter = {
          ...built.encounter,
          allowRetreat: false,


          blockSaveMe: false,
          ...(tournamentStartChatDefinition === undefined
            ? {}
            : { startChat: tournamentStartChatDefinition }),
        };
      } else {
        tournamentEncounter = {
          backgroundKey,
          allowRetreat: false,
          blockSaveMe: false,
          ...(tournamentStartChatDefinition === undefined
            ? {}
            : { startChat: tournamentStartChatDefinition }),
          ...(projectedBattle.breederXpBonus === undefined
            ? {}
            : { breederXpBonus: projectedBattle.breederXpBonus }),
          playerTeam: replay!.teams[0].map((member) => ({ ...member })),
          enemyTeam: replay!.teams[1].map((member) => ({ ...member })),
        };
      }
      tournamentEncounter = withWorldBattleSaveMePolicy(tournamentEncounter, {
        owner: "tournament",
        authority: officialSlot === undefined ? "local" : "official",
      });
      const officialTournamentRng = projectedBattle === undefined
        ? undefined
        : replayableRng(projectedBattle.randomDraws);
      let markReady!: () => void;
      const ready = new Promise<void>((resolve) => { markReady = resolve; });
      let battle!: BattleNode;
      battle = new BattleNode({
        stage,
        game,
        audio,
        keyboard,
        encounter: tournamentEncounter,
        tripParty: battleRuntime.battleParty(),
        captureInstanceId: (shortType) => nextPartyInstanceId("tournament-capture", shortType),
        playerState: battleRuntime.battleState(),
        defeatRecovery: officialSlot === undefined
          ? localDefeatRecovery(battleRuntime, tournamentEncounter, () => battle)
          : officialDefeatRecovery(battleRuntime, () => battle),
        openGoldStore: () => openGoldStoreHandoff(
          battleRuntime,
          () => ({ parent: battle.notificationParent, owner: battle }),
          officialSlot === undefined ? checkpoint : () => undefined,
          officialSlot === undefined
            ? undefined
            : "Purchases are unavailable while an Official battle is active.",
        ),
            ...(projectedBattle === undefined || officialTournamentRng === undefined
              ? localGuildQuestEventOption(false, dispatchGuildQuestEvent)
              : {
              authority: {
                battleId: projectedBattle.battleId,
                replay: officialBattleReplay(projectedBattle),
                submit: async (command) => {
                  const result = await officialSlot!.coordinator.submit(command);
                  const replayEvent = result.events.find((event) =>
                    event.type === "battle.replayAdvanced");
                  if (
                    replayEvent === undefined ||
                    replayEvent.battleId !== projectedBattle.battleId
                  ) {
                    throw new Error("official Tournament response omitted its committed draw suffix");
                  }
                  officialTournamentRng.appendCommittedDraws(replayEvent.randomDraws);
                  retainOfficialQuestEvents(result.events);
                },
                claimTutorialFlag: submitOfficialTutorialFlag,
              },
            }),
        onReady: markReady,
        onExit: async (outcome) => {
          if (outcome === "saveMe") {
            // Source Tournament Save Me follows the same chat-before-town lifecycle as Escape.
            // Recovery already debited/healed atomically, so do not progress/checkpoint/remount.
            battle.teardownCombatMonstersForReturn();
            await runTournamentRetreatReturn({
              authoritative: officialSlot !== undefined,
              adoptOfficialProjection,
              presentRetainedOfficialQuestEvents,
              showTournamentLostChat: async () => {
                await showGuildQuestChat({
                  parent: battle.notificationParent,
                  assets: game.assets,
                  scale9: game.scale9,
                  ticker: stage.app.ticker,
                  message: game.strings["TournamentLostChatKey"] ?? "TournamentLostChatKey",
                });
              },
              startWorld: async () => {
                await startWorld({ kind: "arenaReturn", townName, autoEnterTown: true });
              },
            });
            return;
          }




          let presentedLoot = false;
          if (outcome === "victory") {
            if (officialSlot !== undefined) {
              adoptOfficialProjection();
              presentRetainedOfficialQuestEvents();
            } else {
              profileForScene.tournament.settleBattle("victory");
              checkpoint();
            }
            if (officialSlot === undefined) {
              const rewards = localTournamentRound?.rewards ?? [];
              if (rewards.length > 0) {
                presentedLoot = true;
                await showDungeonLootManagement({
                  parent: battle.notificationParent,
                  owner: battle,
                  game,
                  audio,
                  ticker: stage.app.ticker,
                }, rewards, async (remaining) => {
                  for (const reward of remaining) {
                    if (reward.kind === "egg" || reward.kind === "monsterEgg" || reward.kind === "repeatEgg") {
                      const flow = await EggHatchFlow.show({
                        parent: battle.notificationParent,
                        owner: battle,
                        game,
                        audio,
                        ticker: stage.app.ticker,
                        player: runtimeForScene,
                        rng: worldRng!,
                        ...(FIDELITY_LAB?.foundationDictionaryOrder === undefined
                          ? {}
                          : { foundationDictionaryOrder: FIDELITY_LAB.foundationDictionaryOrder }),
                        kind: reward.kind === "monsterEgg" ? "gold" : "silver",
                        ...(reward.kind === "repeatEgg" ? { repeatPicks: reward.numRepeats } : {}),
                        nextMonsterInstanceId: (shortType) =>
                          nextPartyInstanceId("tournament-egg", shortType),
                        onStateChanged: checkpoint,
                        openGoldStore: () => openGoldStoreHandoff(
                          runtimeForScene,
                          () => ({ parent: battle.notificationParent, owner: battle }),
                          checkpoint,
                        ),
                      });
                      await flow.finished;
                    } else {
                      applyPlayerRewards(profileForScene, [reward], {
                        addMonsterJoin: (shortType, jobLevel) => {
                          const joined = runtimeForScene.addJoinedMonster(
                            nextPartyInstanceId("tournament-round", shortType),
                            shortType,
                            jobLevel,
                          );
                          return { instanceId: joined.instanceId };
                        },
                      });
                      checkpoint();
                    }
                  }
                });
              }
            }
          } else if (outcome === "defeat") {
            if (officialSlot !== undefined) {
              await submitOfficialDefeatReturn();
              adoptOfficialProjection();
              presentRetainedOfficialQuestEvents();
            } else {
              profileForScene.tournament.settleBattle("defeat");
              checkpoint();
            }
          } else if (outcome === "retreat") {
            await runTournamentRetreatReturn({
              authoritative: officialSlot !== undefined,
              adoptOfficialProjection,
              presentRetainedOfficialQuestEvents,
              showTournamentLostChat: async () => {




                await showGuildQuestChat({
                  parent: battle.notificationParent,
                  assets: game.assets,
                  scale9: game.scale9,
                  ticker: stage.app.ticker,
                  message: game.strings["TournamentLostChatKey"] ?? "TournamentLostChatKey",
                });
              },
              startWorld: async () => {
                await startWorld({
                  kind: "arenaReturn",
                  townName,
                  autoEnterTown: true,
                });
              },
            });
            return;
          }
          await startWorld({
            kind: "arenaReturn",
            townName,
            autoEnterTown: !presentedLoot,
          });
        },
      });
      battle.setSceneVisible(false);
      await scenes.replace(battle, async ({ outgoing, activate, retireOutgoing }) => {
        // On a restart the outgoing scene is the round that was just lost, not the town.
        if (entry === "arrival" && outgoing !== node) {
          throw new Error("Tournament transition lost its outgoing town scene");
        }
        const prepare = (async (): Promise<void> => {
          await preloadWorldEncounter(tournamentEncounter);
          const run = battle.start(officialTournamentRng ?? nextBattleSeed());
          await Promise.race([
            ready,
            run.then(() => { throw new Error("Tournament BattleNode ended before becoming ready"); }),
          ]);
          void run.catch((error: unknown) => {
            console.error("Tournament battle failed", error);
          });
        })();
        if (entry === "restart") {
          await prepare;
          activate();
          battle.notifyEnterTransitionDidFinish();
          return;
        }
        await runSourceBlackSceneFade({
          parent: stage.root,
          ticker: stage.app.ticker,
          width: stagePx.w,
          height: stagePx.h,
          route: "tournament-battle",
          onMidpoint: async () => {
            await prepare;
            retireOutgoing();
            activate();
            battle.notifyEnterTransitionDidFinish();
          },
        });
      });
    };
    const onTournamentBattle = async (request: TournamentBattleRequest): Promise<void> => {
      await mountTournamentBattle(request, "arrival");
    };
    node = await WorldNode.create({
      stage,
      game,
      audio,
      keyboard,
      world: worldForScene,
      trip: tripForScene,
      party: partyForScene,
      playerRuntime: runtimeForScene,
      ...(guildQuests === undefined ? {} : { guildQuests }),
      ...localGuildQuestEventOption(officialSlot !== undefined, dispatchGuildQuestEvent),
      ...(worldCollectionAdapter === undefined
        ? {}
        : { collection: worldCollectionAdapter }),
      ...(guildTavernBackgroundSpriteKey === undefined
        ? {}
        : { guildTavernBackgroundSpriteKey }),
      blackMarketServiceReady: blackMarketReady,
      ...(blackMarketBackgroundSpriteKey === undefined
        ? {}
        : {
            blackMarketDemo: {
              backgroundSpriteKey: blackMarketBackgroundSpriteKey,
              imageLoader: blackMarketDemoImageLoader,
              opener: blackMarketDemoOpener,
            },
      }),
      questRewardRng: worldRng!,
      ...(officialSlot === undefined && FIDELITY_LAB !== undefined
        ? { sourceRng: FIDELITY_LAB.rng }
        : {}),
      ...(FIDELITY_LAB?.foundationDictionaryOrder === undefined
        ? {}
        : { fidelityFoundationOrder: FIDELITY_LAB.foundationDictionaryOrder }),
      refreshState: worldSharedState,
      heroProgress: {
        get level() { return profileForScene.heroLevel; },
        get totalHighestLevels() { return profileForScene.heroTotalHighestLevels; },
      },
      visitedWorlds,
      ...(
        entry.kind === "battleReturn" ||
        entry.kind === "dungeonReturn" ||
        entry.kind === "arenaReturn" ||
        entry.kind === "townPortal" ||
        entry.kind === "townWarp" ||
        entry.kind === "combatLoss" ||
        entry.kind === "worldFade"
          ? { initiallyHidden: true }
          : {}
      ),
      ...(entry.kind === "worldSlide" ? { initialSlideDelta: entry.delta } : {}),
      ...(
        entry.kind === "worldSlide" || entry.kind === "worldFade"
          ? { deferMarkerReveal: true }
          : {}
      ),
      poiRouting: worldPoiRouting,
      onEncounter,
      onArenaChallenge,
      onTournamentBattle,
      get onPvp() { return pvpModEnabled() ? (parent: Container, onClose: () => void) => showPvpFlow({
        parent, onClose, game, ticker: stage.app.ticker,
        connect: async () => {
          const identity = await identifyContentLogicPack(content);
          const setup = { logicPackId: identity.logicPackId, mods: hasImportedModProfile(content)
            ? content.modProfile.packages.map(({ id, version, digest }) => ({ id, version, digest })) : [] };
          if (official !== undefined) {
            if (!official.authority.pvpTransport) throw new Error("This Official connection does not support PvP. Update the client and server.");
            return { client: new PvpClient(official.authority.pvpTransport), setup };
          }
          return { client: await PvpClient.offline(), setup };
        },
        entry: () => official === undefined
          ? { source: "offline", party: partyForScene.projectAliveBattingPrefix().map(({ currentHp: _hp, sourceInstanceId: _id, capturable: _capture, ...member }) => member) }
          : { source: "official", slotId: saveSession.slotId },
      }) : undefined; },
      onTournamentPrize: async () => {
        if (officialSlot === undefined) {
          throw new Error("local Tournament prize claim must stay scene-owned");
        }
        await officialSlot.coordinator.submit({ type: "tournament.claimPrize" });
        adoptOfficialProjection();
        // The claim leaves the Egg continuation pending, and it is the only command the slot will
        // admit until `egg.finish` clears it. `tournament.settlePrize` is retired — see
        // RESERVED_GAME_COMMAND_TYPES_V1.
        await runOfficialEggHatch({
          parent: stage.root,
          owner: node,
          instanceIdPrefix: "tournament-egg",
        });
      },
      tournamentRoundPortraitFile: (tournament, round) => {
        const populator = tournament.monsterPopulators[round];
        const args = populator?.["arguments"];
        if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
        const fixed = (args as Record<string, unknown>)["fixedEncounters"];
        if (!Array.isArray(fixed) || fixed.length !== 1) return undefined;
        const encounter = fixed[0];
        if (encounter === null || typeof encounter !== "object" || Array.isArray(encounter)) {
          return undefined;
        }
        const start = (encounter as Record<string, unknown>)["startEvent"];
        if (start === null || typeof start !== "object" || Array.isArray(start)) return undefined;
        const chatKey = (start as Record<string, unknown>)["chatKey"];
        return typeof chatKey === "string"
          ? loadChatDefinition(content.resources, chatKey).imageFile
          : undefined;
      },
      // Plot.plist `TournamentFinished` authors `music: Dungeon2` alongside its image and text,
      // exactly like the WonLicense pages the Arena win path plays.
      onTournamentFinished: (parent) => {
        audio.playMusic(game.assets.audioUrl("Dungeon2.mp3"), {
          loop: false,
          assetName: "Dungeon2.mp3",
        });
        return showNarratedPlot({
          parent,
          assets: game.assets,
          strings: game.strings,
          ticker: stage.app.ticker,
          keyboard,
          imageKey: "plot_start1",
          textKey: "TournamentFinishedPlotKey",
        });
      },
      onWorldExit,
      onSceneRequest: (request) => worldSceneHandlers.dispatch(request),
      ...(onTownPortal === undefined ? {} : { onTownPortal }),
      ...(onTournamentExit === undefined ? {} : { onTournamentExit }),
      tournamentEnabled: official === undefined ? true : official.authority.pack.capabilities.tournaments,
      ...(townWarpBackgroundSpriteKey === undefined
        ? {}
        : {
            townWarp: {
              backgroundSpriteKey: townWarpBackgroundSpriteKey,
              destinations: townPortalDestinations,
              visitedTownNames,
              onTravel: async (townName: string): Promise<void> => {
                if (officialSlot !== undefined) {
                  const result = await officialSlot.coordinator.submit({
                    type: "world.usePortal",
                    destinationTownId: townName,
                  });
                  if (
                    result.projection.location.kind !== "town" ||
                    result.projection.location.townId !== townName
                  ) {
                    throw new Error(
                      `Official Warp Gate did not commit destination town ${townName}`,
                    );
                  }
                  syncOfficialWorldProjection();
                  syncOfficialQuestProjection();
                  presentOfficialQuestEvents(result.events);
                }
                await returnToTown(townName, "townWarp");
              },
            },
          }),
      onMainMenu: restartToMainMenu,
      onPresentationChange: restartSession,
      ...(official?.authority.account === undefined
        ? {}
        : { account: official.authority.account }),
      ...(officialScoreboard === undefined ? {} : { scoreboard: officialScoreboard }),
      onTownEntered: (townName) => {


        if (guildQuests !== undefined && officialSlot === undefined) {
          presentQuestEventResult(guildQuests.enteredTown(townName));
        }
        lastTownName = townName;
        visitedTownNames.add(townName);
      },
      onNotificationHostReady: attachQuestNotificationHost,
      onStateChanged: checkpoint,
      openGoldStore: (parent, owner, runtime, checkpointAfter) => openGoldStoreHandoff(
        runtime,
        () => ({ parent, owner }),
        checkpointAfter,
        officialSlot === undefined
          ? undefined
          : "Purchases are unavailable while an Official Egg decision is pending.",
      ),
      ...(officialSlot === undefined
        ? {}
        : {
            authority: {
              navigate: async (targetPoiId: string, onIntentAccepted: () => void) => {
                const result = await officialSlot.coordinator.submit(
                  { type: "world.navigate", targetPoiId },
                  { onIntentAccepted },
                );
                const arrival = result.events.find((event) => event.type === "world.arrived");
                if (arrival === undefined || arrival.poiId !== targetPoiId) {
                  throw new Error(`official navigation to ${targetPoiId} omitted world.arrived`);
                }
                if (officialWorldRng === undefined) {
                  throw new Error("official navigation RNG was not initialized");
                }
                officialWorldRng.appendCommittedDraws(arrival.randomDraws);
                return {
                  movement: arrival.movement,
                  randomDraws: arrival.randomDraws,
                  ...(result.projection.updatedAt === undefined
                    ? {}
                    : { committedAt: result.projection.updatedAt }),
                  synchronizeProjection: () => {
                    syncOfficialWorldProjection();
                    // Battle start/win dialogs are already committed server-side, but the retained
                    // renderer mirror must still see the pre-claim state for this first presentation.
                    if (result.projection.location.kind !== "battle") {
                      syncOfficialQuestProjection();
                      presentOfficialQuestEvents(result.events);
                    }
                  },
                };
              },
              leaveTown: async () => {
                const result = await officialSlot.coordinator.submit({ type: "world.leaveTown" });
                syncOfficialWorldProjection();
                return result.projection.updatedAt === undefined
                  ? {}
                  : { committedAt: result.projection.updatedAt };
              },
              claimTutorialFlag: async (flag) => {
                await submitOfficialTutorialFlag(flag);
              },
              claimDialog: async (dialogId) => {
                const result = await officialSlot.coordinator.submit({
                  type: "player.claimDialog",
                  dialogId,
                });
                const claimed = result.events.find((event) =>
                  event.type === "player.dialogClaimed" && event.dialogId === dialogId);
                if (claimed === undefined) {
                  throw new Error(`official dialog ${dialogId} omitted its acknowledgement`);
                }
                syncOfficialQuestProjection();
              },
              submitParty: async (command) => {
                const result = await officialSlot.coordinator.submit(command);
                syncOfficialQuestProjection();
                presentOfficialQuestEvents(result.events);
                return result;
              },
              submitQuest: async (command) => {
                const runtime = guildQuests;
                if (runtime === undefined) {
                  throw new Error("official quest command requires the Guild/story runtime");
                }
                const result = await officialSlot.coordinator.submit(command);
                syncOfficialQuestProjection();
                presentOfficialQuestEvents(result.events);
                for (const event of result.events) {
                  if (event.type !== "quest.accepted") continue;
                  enqueueQuestNotification(acceptedGuildQuestNotification(
                    game.strings,
                    runtime,
                    runtime.catalog.requireQuest(event.questId),
                  ));
                }
                return result;
              },
              submitPlayer: async (command) => {
                return await officialSlot.coordinator.submit(command);
              },
              submitStore: async (command) => {
                return await officialSlot.coordinator.submit(command);
              },
              egg: officialEggAuthority(),
            },
          }),
    });
    const locksInputUntilReturnIdle =
      entry.kind === "battleReturn" ||
      entry.kind === "dungeonReturn" ||
      entry.kind === "arenaReturn";
    if (locksInputUntilReturnIdle) node.lockForReturnTransition();
    await scenes.replace(node, async ({ outgoing, activate, retireOutgoing }) => {
      if (
        entry.kind === "battleReturn" ||
        entry.kind === "dungeonReturn" ||
        entry.kind === "arenaReturn"
      ) {
        const expectedKind = entry.kind === "dungeonReturn" ? "dungeon" : "battle";
        if (outgoing?.sceneKind !== expectedKind) {
          throw new Error(`World ${entry.kind} transition requires an outgoing ${expectedKind} scene`);
        }
        const shade = new Graphics().rect(0, 0, stagePx.w, stagePx.h).fill(0x000000);
        shade.alpha = 0;
        stage.root.addChild(shade);
        await tween(stage.app.ticker, 250, (t) => { shade.alpha = t; });
        retireOutgoing();
        activate();
        node.playFieldMusic();
        if (entry.kind === "arenaReturn" && entry.autoEnterTown) {
          await node.enterTown(entry.townName);
        }
        await tween(stage.app.ticker, 250, (t) => { shade.alpha = 1 - t; });
        shade.destroy();




        if (entry.kind === "dungeonReturn") node.showMapName();
        return;
      }
      if (entry.kind === "worldSlide") {
        if (outgoing?.sceneKind !== "world") {
          throw new Error("World slide transition requires an outgoing world scene");
        }
        activate();
        await Promise.all([
          node.playCardinalSlideIn(entry.delta),
          outgoing.playCardinalSlideOut(entry.delta),
        ]);
        node.playFieldMusic();
        node.revealMarkerAfterTransition();
        node.showMapName("slide-end");
        return;
      }
      if (entry.kind === "worldFade") {
        if (outgoing?.sceneKind !== "world") {
          throw new Error("World fade transition requires an outgoing world scene");
        }


        const shade = new Graphics().rect(0, 0, stagePx.w, stagePx.h).fill(0x000000);
        shade.alpha = 0;
        stage.root.addChild(shade);
        try {
          await tween(stage.app.ticker, WORLD_RETURN_FADE_MS / 2, (t) => { shade.alpha = t; });
          retireOutgoing();
          activate();
          await tween(stage.app.ticker, WORLD_RETURN_FADE_MS / 2, (t) => { shade.alpha = 1 - t; });
        } finally {
          shade.destroy();
        }
        node.playFieldMusic();
        node.revealMarkerAfterTransition();
        node.showMapName();
        return;
      }
      if (
        entry.kind === "townPortal" ||
        entry.kind === "townWarp" ||
        entry.kind === "combatLoss" ||
        entry.kind === "tournamentExit"
      ) {





        const outgoingIsExpected = entry.kind === "combatLoss"
          ? outgoing?.sceneKind === "battle"
          : isTownPortalOutgoingScene(outgoing?.sceneKind);
        if (!outgoingIsExpected) {
          throw new Error(
            entry.kind === "combatLoss"
              ? "Combat-loss town return requires an outgoing battle scene"
              : `${entry.kind} town return requires an outgoing world or dungeon scene`,
          );
        }


        const shade = new Graphics().rect(0, 0, stagePx.w, stagePx.h).fill(0x000000);
        shade.alpha = 0;
        stage.root.addChild(shade);
        try {
          await tween(stage.app.ticker, WORLD_RETURN_FADE_MS / 2, (t) => { shade.alpha = t; });
          retireOutgoing();
          activate();
          node.playFieldMusic();
          await node.enterTown(entry.townName, {
            ...(entry.terminalStateCommitted === true ? { gameplayCommitted: true } : {}),
          });
          await tween(stage.app.ticker, WORLD_RETURN_FADE_MS / 2, (t) => { shade.alpha = 1 - t; });
        } finally {
          shade.destroy();
        }
        return;
      }
      if (outgoing !== undefined) throw new Error("Initial world start requires no outgoing scene");
      if (entry.kind === "resumeWorld") {
        activate();
        return;
      }
      if (entry.kind === "resumeTown") {
        activate();
        await node.enterTown(entry.townName, { presentationResume: true });
        return;
      }
      if (entry.kind !== "initial") throw new Error(`Unhandled world entry kind ${entry.kind}`);
      activate();
      node.playFieldMusic();
      await node.enterTown(entry.townName);
      if (entry.fade) await node.fadeIn();
    });
    if (locksInputUntilReturnIdle) node.finishReturnTransition();
    if (scenarioRuntime?.worldAction === "egg") {
      runInitialScenarioAction = () =>
        node.presentEggHatchForBrowserTest(scenarioRuntime!.configuration.eggKind);
    } else if (scenarioRuntime?.worldAction === "arena") {
      runInitialScenarioAction = () => node.presentArenaForBrowserTest();
    }
    if (
      (globalThis as Record<string, unknown>)["__DIB_TEST_WORLD_DEMO__"] === true &&
      officialSlot === undefined
    ) {
      (globalThis as Record<string, unknown>)["__DIB_TEST_SHOW_EGG_HATCH__"] =
        (kind: "silver" | "gold", repeatPicks?: number) =>
          node.presentEggHatchForBrowserTest(
            kind,
            repeatPicks === undefined ? {} : { repeatPicks },
          );
      (globalThis as Record<string, unknown>)["__DIB_TEST_OPEN_INVENTORY__"] =
        () => node.presentInventoryForBrowserTest();
      (globalThis as Record<string, unknown>)["__DIB_TEST_OPEN_CHARACTER__"] =
        () => node.presentCharacterForBrowserTest();
      (globalThis as Record<string, unknown>)["__DIB_TEST_OPEN_STORE__"] =
        () => node.presentStoreForBrowserTest();
      (globalThis as Record<string, unknown>)["__DIB_TEST_OPEN_ARENA__"] =
        () => node.presentArenaForBrowserTest();
      (globalThis as Record<string, unknown>)["__DIB_TEST_OPEN_TOWN_WARP__"] =
        () => node.presentTownWarpForBrowserTest();
    }
    if (
      !("suppressCheckpoint" in entry && entry.suppressCheckpoint === true) &&
      !("terminalStateCommitted" in entry && entry.terminalStateCommitted === true)
    ) checkpoint();
  };







  const returnToTown = async (
    townName: string | undefined,
    kind: "townPortal" | "townWarp" | "combatLoss" | "tournamentExit",
    terminalStateCommitted = false,
  ): Promise<void> => {
    const destination = resolveTownPortalDestination(townPortalDestinations, townName);
    const targetData = loadWorldData(
      content.resources,
      destination.worldName,
      new Set(knownShortTypes),
    );
    const targetTown = targetData.pointsOfInterest.find(
      ({ name, town }) => name === destination.townName && town !== undefined,
    );
    if (targetTown === undefined) {
      throw new Error(
        `Town return destination ${destination.worldName}.${destination.townName} ` +
          "is not an authored town POI",
      );
    }
    // A committed Save Me defeat already accepted this exact world/town aggregate before its
    // single terminal save. Rebuilding it here would be a post-persist setter/parser boundary
    // and could create a second, fallible adoption. The incoming node is presentation-only.
    if (terminalStateCommitted) {
      if (
        worldData?.name !== destination.worldName ||
        worldTrip?.currentPoiName !== destination.townName
      ) {
        throw new Error("committed dungeon defeat has no matching prepared town aggregate");
      }
    } else {
      // The live party/RNG/refresh aggregates survive either the outdoor or dungeon scene change.
      dungeonFeature?.clear();
      worldData = targetData;
      worldTrip = createWorldTrip(
        targetData,
        destination.townName,
        worldRng!,
        knownShortTypes,
        worldSharedState!,
        guildQuests,
        localWorldTripQuestEvents(),
      );
    }
    await startWorld({
      kind,
      townName: destination.townName,
      ...(terminalStateCommitted ? { terminalStateCommitted: true } : {}),
    });
  };
  const returnToSavedTown = async (kind: "townPortal" | "combatLoss"): Promise<void> => {
    await returnToTown(lastTownName, kind);
  };





  const returnAfterCombatLoss = async (options: { readonly terminalStateCommitted?: boolean } = {}): Promise<void> => {
    if (townPortalDestinations.length === 0) {
      // Port adaptation: with no authored town there is no `+[Player enteredTown:]` to reach, so
      // apply its party restore directly. Without it the whole party stays at zero HP and
      // `projectAliveBattingPrefix()` would yield an unbuildable empty team on the next encounter.
      if (options.terminalStateCommitted !== true) playerRuntime?.party?.restoreAtTown(Date.now() / 1000);
      dungeonFeature?.clear();
      await startWorld({
        kind: "battleReturn",
        ...(options.terminalStateCommitted === true ? { suppressCheckpoint: true } : {}),
      });
      return;
    }
    await returnToTown(
      lastTownName,
      "combatLoss",
      options.terminalStateCommitted === true,
    );
  };

  function cloneWorldSharedState(source: WorldTripSharedState): WorldTripSharedState {
    const copy = createWorldTripSharedState();
    copy.occurrenceThisRefresh.clear();
    for (const [poi, occurs] of source.occurrenceThisRefresh) copy.occurrenceThisRefresh.set(poi, occurs);
    copy.completedThisRefresh.clear();
    for (const poi of source.completedThisRefresh) copy.completedThisRefresh.add(poi);
    copy.poiWins.clear();
    for (const [poi, wins] of source.poiWins) copy.poiWins.set(poi, wins);
    copy.everCompletedPois.clear();
    for (const poi of source.everCompletedPois) copy.everCompletedPois.add(poi);
    copy.notifiedCompletedPois.clear();
    for (const poi of source.notifiedCompletedPois) copy.notifiedCompletedPois.add(poi);
    copy.dayNumber = source.dayNumber;
    return copy;
  }

  /** Prepare the complete local terminal aggregate before the engine's persist boundary. */
  const prepareLocalDungeonApplication = (
    outcome: LocalDungeonTerminalOutcome,
    stagedPlayer: PlayerRuntimeState,
    stagedQuests: GuildQuestRuntime | undefined,
    stageQuestEventResult: (result: GuildQuestEventResult) => void,
  ): LocalDungeonTerminalApplication => {
    if (worldData === undefined || worldTrip === undefined || worldSharedState === undefined || worldRng === undefined) {
      throw new Error("local dungeon terminal requires a complete world aggregate");
    }
    if (stagedPlayer.party === undefined) {
      throw new Error("local dungeon terminal requires a world-trip player");
    }

    const previous = {
      player: playerRuntime,
      quests: guildQuests,
      worldData,
      worldTrip,
      worldSharedState,
      worldRng,
      latestWorldProgress,
      lastTownName,
      visitedTownNames: new Set(visitedTownNames),
    };
    const stagedShared = cloneWorldSharedState(worldSharedState);
    const worldRngStage = stageLocalDungeonRng(worldRng);
    let fidelityRngBeforeAccept: Rng | undefined;
    let stagedData = worldData;
    let stagedPoiName = worldTrip.currentPoiName;
    let stagedLastTownName = lastTownName;
    const stagedVisitedTownNames = new Set(visitedTownNames);

    if (outcome === "defeat") {
      if (townPortalDestinations.length === 0) {
        stagedPlayer.party.restoreAtTown(Date.now() / 1000);
        stagedPlayer.profile.resetSpiritsForTownReturn();
      } else {
        const destination = resolveTownPortalDestination(townPortalDestinations, lastTownName);
        stagedData = loadWorldData(content.resources, destination.worldName, new Set(knownShortTypes));
        const targetTown = stagedData.pointsOfInterest.find(
          ({ name, town }) => name === destination.townName && town !== undefined,
        );
        if (targetTown === undefined) {
          throw new Error(
            `Town return destination ${destination.worldName}.${destination.townName} is not an authored town POI`,
          );
        }
        stagedPoiName = destination.townName;
        stagedPlayer.party.restoreAtTown(Date.now() / 1000);
        stagedPlayer.profile.resetSpiritsForTownReturn();
        stagedLastTownName = destination.townName;
        stagedVisitedTownNames.add(destination.townName);
      }
    }

    // Build the replacement trip and its shared maps against the detached quest owner. `begin()`
    // is part of construction and only touches the detached shared state.
    const stagedTrip = createWorldTrip(
      stagedData,
      stagedPoiName,
      worldRngStage.staged,
      knownShortTypes,
      stagedShared,
      stagedQuests,
      // POI quest events raised while staging must land on the detached runtime and its staged
      // presentation queue, never on the live one.
      stagedQuests === undefined
        ? undefined
        : (event) => { stageQuestEventResult(stagedQuests.fireEvent(event)); },
    );
    if (outcome === "defeat" && townPortalDestinations.length > 0) {
      advanceWorldDay(stagedShared);
      stagedTrip.refreshAtTown();
      if (stagedQuests !== undefined) stageQuestEventResult(stagedQuests.enteredTown(stagedPoiName));
    }
    const stagedWorld = snapshotWorldProgress(
      stagedData.name,
      stagedTrip.currentPoiName,
      stagedShared,
      latestWorldProgress?.everCompletedPois,
      stagedLastTownName,
      stagedVisitedTownNames,
    );

    // Listener installation is still preflight. The commit below is only reference assignment.
    const listenerGate = { active: false };
    connectQuestEvents(stagedPlayer, () => listenerGate.active);
    attachGuildQuestRuntime(stagedQuests, () => listenerGate.active);

    return Object.freeze({
      world: stagedWorld,
      listenerGate,
      accept: (): void => {
        playerRuntime = stagedPlayer;
        guildQuests = stagedQuests;
        worldData = stagedData;
        worldTrip = stagedTrip;
        worldSharedState = stagedShared;
        worldRng = worldRngStage.accept(FIDELITY_LAB === undefined
          ? undefined
          : (detached) => {


              fidelityRngBeforeAccept = FIDELITY_LAB.rng.fork();
              FIDELITY_LAB.adopt(detached);
              return FIDELITY_LAB.rng;
            });
        latestWorldProgress = stagedWorld;
        lastTownName = stagedLastTownName;
        visitedTownNames.clear();
        for (const town of stagedVisitedTownNames) visitedTownNames.add(town);
      },
      rollback: (): void => {
        // These are direct assignments only; no parser, listener registration, or setter is
        // reachable after the persistence boundary.
        playerRuntime = previous.player;
        guildQuests = previous.quests;
        worldData = previous.worldData;
        worldTrip = previous.worldTrip;
        worldSharedState = previous.worldSharedState;
        worldRng = worldRngStage.rollback();
        if (FIDELITY_LAB !== undefined && fidelityRngBeforeAccept !== undefined) {
          FIDELITY_LAB.adopt(fidelityRngBeforeAccept);
        }
        latestWorldProgress = previous.latestWorldProgress;
        lastTownName = previous.lastTownName;
        visitedTownNames.clear();
        for (const town of previous.visitedTownNames) visitedTownNames.add(town);
        listenerGate.active = false;
      },
    });
  };

  onTownPortal = townPortalDestinations.length === 0
    ? undefined
    : officialSlot === undefined
      ? async (): Promise<void> => { await returnToSavedTown("townPortal"); }
      : async (): Promise<void> => {
          const result = await officialSlot.coordinator.submit({
            type: "world.useDirectTownReturn",
          });
          if (result.projection.location.kind !== "town") {
            throw new Error("Official Town Portal did not commit a town location");
          }
          syncOfficialWorldProjection();
          syncOfficialQuestProjection();
          presentOfficialQuestEvents(result.events);
          await returnToSavedTown("townPortal");
        };











  onTournamentExit = townPortalDestinations.length === 0 || officialSlot !== undefined
    ? undefined
    : async (): Promise<void> => { await returnToTown(lastTownName, "tournamentExit"); };

  if (pendingDungeonRestore !== undefined && !content.hasDungeonCapability) {
    throw new Error("saved dungeon state is unavailable in the selected content package");
  }
  const initialDungeonGuildQuests = guildQuests;
  const currentDungeonGuildQuests = (): GuildQuestRuntime => {
    if (guildQuests === undefined) throw new Error("dungeon quest runtime is unavailable");
    return guildQuests;
  };
  if (content.hasDungeonCapability) {
    dungeonFeature = new DungeonFeatureController<ShellMode>({
      stage,
      game,
      audio,
      keyboard,
      content,
      scenes,
      player: () => {
        if (playerRuntime === undefined) throw new Error("dungeon feature requires world player state");
        return playerRuntime;
      },
      nextBattleSeed,
      nextRunSeed: nextDungeonSeed,
      ...(officialSlot === undefined && FIDELITY_LAB !== undefined
        ? {
            fidelityRng: FIDELITY_LAB.rng,
            ...(FIDELITY_LAB.foundationDictionaryOrder === undefined
              ? {}
              : { fidelityFoundationOrder: FIDELITY_LAB.foundationDictionaryOrder }),
          }
        : {}),
      checkpoint,
      checkpointAsync,
      openGoldStore: (parent, owner, runtime, checkpointAfter) => openGoldStoreHandoff(
        runtime,
        () => ({ parent, owner }),
        checkpointAfter,
        officialSlot === undefined
          ? undefined
          : "Purchases are unavailable while an Official decision is pending.",
      ),
      onWorldExit: async (change) => {
        if (!content.worldNames.includes(change.targetWorld)) {
          throw new Error(`Dungeon exit references unavailable world ${change.targetWorld}`);
        }
        if (worldRng === undefined || worldSharedState === undefined) {
          throw new Error("Dungeon exit requires an active world trip");
        }
        const targetData = loadWorldData(content.resources, change.targetWorld, new Set(knownShortTypes));
        if (!targetData.pointsOfInterest.some((poi) => poi.name === change.targetZoneChange)) {
          throw new Error(
            `Dungeon exit references missing ${change.targetWorld}.${change.targetZoneChange}`,
          );
        }
        worldData = targetData;
        worldTrip = createWorldTrip(
          targetData,
          change.targetZoneChange,
          worldRng,
          knownShortTypes,
          worldSharedState,
          guildQuests,
          localWorldTripQuestEvents(),
        );
        await startWorld({ kind: "dungeonReturn" });
      },
      onDefeat: async (options = {}) => {


        await returnAfterCombatLoss(options);
      },
      ...(onTownPortal === undefined ? {} : { onTownPortal }),
      onMainMenu: restartToMainMenu,
      onPresentationChange: restartSession,
      ...(official?.authority.account === undefined
        ? {}
        : { account: official.authority.account }),
      ...(officialScoreboard === undefined ? {} : { scoreboard: officialScoreboard }),
      defeatRecovery: (
        battle: () => BattleNode,
        dungeonEncounter: EncounterConfig,
        stagedPlayer?: PlayerRuntimeState,
        stagedCheckpoint?: () => void,
      ) => {
        if (playerRuntime === undefined) {
          throw new Error("Dungeon Save Me requires world player state");
        }
        return officialSlot === undefined
          ? localDefeatRecovery(
              stagedPlayer ?? playerRuntime,
              dungeonEncounter,
              battle,
              stagedCheckpoint ?? checkpoint,
            )
          : officialDefeatRecovery(playerRuntime, battle);
      },
      ...(officialSlot === undefined
        ? {
            createLocalTerminal: (
              pendingBattleRewardKeys,
              captureIdentity,
            ) => {
              if (playerRuntime === undefined) {
                throw new Error("Local dungeon terminal requires world player state");
              }
              if (captureIdentity === undefined) {
                throw new Error("Local dungeon terminal capture identity is missing");
              }
              return new LocalDungeonTerminal({
                data: game.gd,
                player: playerRuntime,
                ...(guildQuests === undefined ? {} : { quests: guildQuests }),
                ...(pendingBattleRewardKeys === undefined ? {} : { pendingBattleRewardKeys }),
                captureIdentity,
                persist: persistLocalDungeonTerminal,
                prepareApplication: (outcome, stagedPlayer, stagedQuests, stageQuestEventResult) =>
                  prepareLocalDungeonApplication(
                    outcome,
                    stagedPlayer,
                    stagedQuests,
                    stageQuestEventResult,
                  ),
                presentQuestEventResult: (runtime, result) => {
                  for (const name of result.notificationQuestNames) {
                    enqueueQuestNotification(progressGuildQuestNotification(
                      game.strings,
                      runtime,
                      runtime.catalog.requireQuest(name),
                    ));
                  }
                },
              });
            },
          }
        : {}),
      ...(initialDungeonGuildQuests === undefined
        ? {}
        : {
            isCompletionSet: (key: string) => currentDungeonGuildQuests().hasCompletedFixedEncounter(key),
            isQuestUsable: (questKey: string) => currentDungeonGuildQuests().canUseQuestKey(questKey),
            // Read live rather than captured: adopting an Official slot replaces the runtime.
            guildQuests: (): GuildQuestRuntime | undefined => guildQuests,
            hasReceivedBattleReward: (key: string) => currentDungeonGuildQuests().hasReceivedBattleReward(key),
            markBattleRewardReceived: (key: string) => {
              currentDungeonGuildQuests().markBattleRewardReceived(key);
            },
            ...localGuildQuestEventOption(officialSlot !== undefined, dispatchGuildQuestEvent),
            ...(officialSlot === undefined
              ? {
                  onDungeonRoomRosterUpdated: (
                    instanceName: string,
                    floor: number,
                    survivingMonstersByRoom: readonly number[],
                    _flow: DungeonTerminalFlowIdentity,
                    _registerRollback: (rollback: () => void) => void,
                  ): { readonly rollback: () => void; readonly commit: () => void } => {
                    const before = currentDungeonGuildQuests().stateSnapshot();
                    try {
                      dispatchGuildQuestEvent({
                        id: 4,
                        dungeon: { instanceName, floor, survivingMonstersByRoom },
                      }, { deferCheckpoint: true });
                    } catch (error) {
                      currentDungeonGuildQuests().replaceStateSnapshot(before);
                      throw error;
                    }
                    return {
                      rollback: () => {
                        currentDungeonGuildQuests().replaceStateSnapshot(before);
                      },
                      commit: () => undefined,
                    };
                  },
                }
              : {}),
            requestChatPresentation: (name: string, alwaysShow: boolean) =>
              currentDungeonGuildQuests().requestChatPresentation(name, alwaysShow),
            onNotificationHostReady: attachQuestNotificationHost,
          }),
      onDiagnostic: (message, detail) => console.warn(`[dungeon] ${message}`, detail ?? {}),
      ...(officialSlot === undefined
        ? {}
        : {
            authority: {
              projection: () => officialSlot.coordinator.projection,
              submit: async (command, hooks) => {
                const result = await officialSlot.coordinator.submit(command, hooks);
                retainOfficialQuestEvents(result.events);
                retainOfficialInfiniteFloorEntries(result.events);
                return result;
              },
              adoptProjection: () => {
                adoptOfficialProjection();
                presentRetainedOfficialQuestEvents();
              },
              claimTutorialFlag: submitOfficialTutorialFlag,
              takeInfiniteFloorEntry: takeOfficialInfiniteFloorEntry,
              egg: officialEggAuthority(),
            },
          }),
    });
  }


  let startupBattleNode: BattleNode | undefined;
  /**
   * Rebuild the definition for an in-flight dungeon battle from the route the projection already
   * carries. The route names a mechanical dungeon file, never a resource, and the definition it
   * produces is the same one the live dungeon path uses to pick its background.
   */
  const reconnectDungeonDefinition = (dungeonId: string): DungeonDefinition | undefined => {
    const route = officialSlot?.coordinator.projection.dungeon?.run.current.route;
    if (route === undefined) return undefined;
    const definition = loadDungeonData(
      content.resources,
      route.typeName,
      route.sourceFile,
      route.floor,
      new Set(game.gd.allMonsters().map(({ shortType }) => shortType)),
    );
    return dungeonDefinitionId(definition) === dungeonId ? definition : undefined;
  };
  if (useWorldDemo) {
    const reconnectBattle = officialSlot?.coordinator.projection.battle;
    const reconnectDungeonBattleReturn = officialSlot === undefined ||
        !("dungeonBattleReturn" in officialSlot.coordinator.projection)
      ? undefined
      : officialSlot.coordinator.projection.dungeonBattleReturn;
    if (reconnectBattle !== undefined) {
      if (playerRuntime === undefined) throw new Error("official battle reconnect requires player state");
      const reconnectDungeonBattle = officialSlot!.coordinator.projection.dungeon !== undefined;
      if (reconnectDungeonBattle) {
        if (dungeonFeature === undefined) {
          throw new Error("Official dungeon battle reconnect has no dungeon feature");
        }
        // The retained run is normally already live when a battle returns. A document reload has
        // only its authoritative snapshot, so prepare it now and consume the entry presentations
        // that necessarily preceded the active battle. Terminal adoption will inherit this state.
        adoptOfficialProjection();
        dungeonFeature.prepareAuthoritativeBattleReconnect();
      }
      const replay = officialBattleReplay(reconnectBattle);
      // The authority names the scene; the background comes from local content, exactly as it does
      // when this same battle is entered live.
      const reconnectBackgroundFile = installedBattleBackgroundFile(reconnectBattle, {
        world: (worldId) => worldData?.name === worldId ? worldData : undefined,
        dungeon: (dungeonId) => reconnectDungeonDefinition(dungeonId),
      });
      const reconnectBackgroundKey = combatBackgroundSpriteKey(reconnectBackgroundFile);
      if (!content.combatBackgroundKeys.includes(reconnectBackgroundKey)) {
        throw new Error(
          `official battle references unavailable combat background ${reconnectBackgroundFile}`,
        );
      }
      const reconnectWinChat = rehydrateOfficialBattleWinChat(
        reconnectBattle,
        content.resources,
      );
      const reconnectEncounter = withWorldBattleSaveMePolicy({
        backgroundKey: reconnectBackgroundKey,
        allowRetreat: reconnectBattle.allowRetreat,
        ...(reconnectBattle.breederXpBonus === undefined
          ? {}
          : { breederXpBonus: reconnectBattle.breederXpBonus }),
        ...(reconnectWinChat === undefined ? {} : { winChat: reconnectWinChat }),
        playerTeam: replay.teams[0].map((member) => ({ ...member })),
        enemyTeam: officialReconnectEnemyTeam(reconnectBattle, replay.teams[1], {
          world: (worldId) => worldData?.name === worldId ? worldData : undefined,
          dungeon: reconnectDungeonDefinition,
        }, officialSlot?.coordinator.projection.dungeon?.run.current.route.floor),
      }, { owner: "reconnect", authority: "official" });
      await preloadWorldEncounter(reconnectEncounter);
      const rng = replayableRng(reconnectBattle.randomDraws);
      pendingOfficialBattleRewards.length = 0;
      let markReady!: () => void;
      const ready = new Promise<void>((resolve) => { markReady = resolve; });
      let node!: BattleNode;
      node = new BattleNode({
        stage,
        game,
        audio,
        keyboard,
        encounter: reconnectEncounter,
        tripParty: playerRuntime.battleParty(),
        captureInstanceId: (shortType) => nextPartyInstanceId("official-reconnect-capture", shortType),
        playerState: playerRuntime.battleState(),
        defeatRecovery: officialDefeatRecovery(playerRuntime, () => node),
        openGoldStore: () => openGoldStoreHandoff(
          playerRuntime!,
          () => ({ parent: node.notificationParent, owner: node }),
          () => undefined,
          "Purchases are unavailable while an Official battle is active.",
        ),
        ...(guildQuests === undefined
          ? {}
          : {
              requestChatPresentation: (name: string, alwaysShow: boolean) =>
                guildQuests!.requestChatPresentation(name, alwaysShow),
            }),
        onReady: markReady,
        ...(reconnectDungeonBattle && dungeonFeature !== undefined
          ? {
              onExitFailure: (_outcome, _error, retry) => {
                dungeonFeature!.handleAuthoritativeBattleExitFailure(retry);
              },
            }
          : {}),
        authority: {
          battleId: reconnectBattle.battleId,
          replay: officialBattleReplay(reconnectBattle),
          resumeExisting: true,
          submit: async (command) => {
            const result = await officialSlot!.coordinator.submit(command);
            const replay = result.events.find((event) =>
              event.type === "battle.replayAdvanced");
            if (replay === undefined || replay.battleId !== reconnectBattle.battleId) {
              throw new Error("official reconnect response omitted its committed draw suffix");
            }
            rng.appendCommittedDraws(replay.randomDraws);
            retainOfficialQuestEvents(result.events);
            retainOfficialBattleRewards(result.events);
          },
          claimTutorialFlag: async (flag) => {
            await submitOfficialTutorialFlag(flag);
          },
        },
        onExit: async (outcome) => {
          if (outcome === "saveMe") {
            const handledTournamentReturn = await runOfficialTournamentSaveMeReconnect({
              simulationVersion: official?.authority.pack.simulationVersion ?? "",
              battle: reconnectBattle,
              teardownCombatMonsters: () => node.teardownCombatMonstersForReturn(),
              adoptOfficialProjection,
              presentRetainedOfficialQuestEvents,
              showTournamentLostChat: async () => {
                await showGuildQuestChat({
                  parent: node.notificationParent,
                  assets: game.assets,
                  scale9: game.scale9,
                  ticker: stage.app.ticker,
                  message: game.strings["TournamentLostChatKey"] ?? "TournamentLostChatKey",
                });
              },
              startWorld: async () => {
                const location = officialSlot!.coordinator.projection.location;
                if (location.kind !== "town") {
                  throw new Error("Official Tournament Save Me did not return to town");
                }
                await startWorld({
                  kind: "arenaReturn",
                  townName: location.townId,
                  autoEnterTown: true,
                });
              },
            });
            if (handledTournamentReturn) return;
            const saveMeLocation = officialSlot!.coordinator.projection.location;
            // Historical authorities installed a replacement battle. Current v22 instead invokes
            // the source World/Dungeon retreat callback and leaves no battle to remount.
            if (saveMeLocation.kind === "battle") {
              adoptOfficialProjection();
              await new Promise<void>((resolve, reject) => {
                setTimeout(() => {
                  void restartSession().then(resolve, reject);
                }, 0);
              });
              return;
            }
            node.teardownCombatMonstersForReturn();
            presentRetainedOfficialQuestEvents();
            if (saveMeLocation.kind === "dungeon") {
              if (dungeonFeature === undefined) {
                throw new Error("Official dungeon Save Me return has no dungeon feature");
              }
              await dungeonFeature.adoptAndEnterPreparedAuthoritativeFromBattle("retreat");
            } else {
              adoptOfficialProjection();
              if (saveMeLocation.kind === "town") {
                await returnAfterCombatLoss({ terminalStateCommitted: true });
              } else if (saveMeLocation.kind === "world") {
                await startWorld({ kind: "battleReturn" });
              } else {
                throw new Error("Official World Save Me returned to an unsupported location");
              }
            }
            return;
          }
          const committedRewards = pendingOfficialBattleRewards.splice(0);
          if (outcome === "defeat") await submitOfficialDefeatReturn();
          adoptOfficialProjection();
          presentRetainedOfficialQuestEvents();
          if (outcome === "victory" && committedRewards.length > 0) {
            await showDungeonLootManagement({
              parent: node.notificationParent,
              owner: node,
              game,
              audio,
              ticker: stage.app.ticker,
            }, committedRewards, () => {
              // Reconnected Official battles already committed these rewards server-side.
            });
          }
          await runOfficialEggHatch({
            parent: node.notificationParent,
            owner: node,
            instanceIdPrefix: "official-reconnect-battle-egg",
          });
          if (officialSlot!.coordinator.projection.location.kind === "town") {
            await returnAfterCombatLoss({ terminalStateCommitted: true });
          } else if (
            officialSlot!.coordinator.projection.location.kind === "dungeon" &&
            officialSlot!.coordinator.projection.dungeon !== undefined
          ) {
            if (dungeonFeature === undefined) {
              throw new Error("Official dungeon battle return has no dungeon feature");
            }
            if (outcome === "defeat") {
              throw new Error("Official dungeon defeat retained a dungeon return location");
            }
            await dungeonFeature.enterPreparedAuthoritativeFromBattle(outcome);
          } else {
            await startWorld({ kind: "battleReturn" });
          }
        },
      });
      startupBattleNode = node;
      await scenes.replace(node);
      const run = node.start(rng);
      await Promise.race([
        ready,
        run.then(() => { throw new Error("Official battle ended before reconnect became ready"); }),
      ]);
      void run.catch((error: unknown) => {
        console.error("Official reconnect BattleNode failed", error);
        queueMicrotask(() => { throw error; });
      });
    } else if (reconnectDungeonBattleReturn !== undefined) {
      if (dungeonFeature === undefined || pendingDungeonRestore === undefined) {
        throw new Error("Official dungeon battle return receipt has no restorable dungeon run");
      }
      // The terminal command committed before this browser could consume its response. Rebuild the
      // authoritative aggregate, restore the pre-battle presentation baseline from the durable
      // receipt, and finish the exact same battle-return seam used by a live terminal callback.
      adoptOfficialProjection();
      dungeonFeature.prepareAuthoritativeBattleReturn(reconnectDungeonBattleReturn);
      await dungeonFeature.restorePreparedAuthoritativeBattleReturn(
        reconnectDungeonBattleReturn.outcome,
      );
      pendingDungeonRestore = undefined;
    } else if (pendingDungeonRestore !== undefined) {
      // A saved run resumes inside its cached floor; the world scene it was entered from is
      // rebuilt only when the run exits, exactly as the source DungeonCache restore does.
      if (dungeonFeature === undefined) throw new Error("saved dungeon feature is unavailable");
      try {
        await dungeonFeature.restore(pendingDungeonRestore, {
          presentationResume: options.presentationResumeMode === "dungeon",
          ...(restoredSave?.pendingBattleRewardKeys === undefined
            ? {}
            : { pendingBattleRewardKeys: restoredSave.pendingBattleRewardKeys }),
        });
        pendingDungeonRestore = undefined;
      } catch (error) {
        const recovery = officialSlot === undefined && restoredSave !== undefined
          ? recoverIncompatibleLocalDungeonSave(restoredSave, error)
          : undefined;
        if (recovery === undefined) throw error;

        // DungeonCache is process-transient in the source. If neither maintained generator can
        // reproduce an older offline floor, keep every player-owned save domain and return to the
        // saved entrance POI instead of turning one stale cache into a total slot lockout.
        console.warn(
          `[save] Abandoned an incompatible active dungeon run and resumed the saved world: ${recovery.detail}`,
        );
        restoredSave = recovery.state;
        pendingDungeonRestore = undefined;
        dungeonFeature.clear();
        checkpoint();
        await startWorld({ kind: "resumeWorld" });
        audio.playMusic(game.assets.audioUrl("Field1.mp3"), {
          loop: true,
          assetName: "Field1.mp3",
        });
      }
    } else {
      if (
        officialLocation?.kind === "world" ||
        options.presentationResumeMode === "world" ||
        (
          deterministicHarness &&
          (globalThis as Record<string, unknown>)["__DIB_TEST_START_IN_WORLD__"] === true
        )
      ) {
        await startWorld({ kind: "resumeWorld" });
        audio.playMusic(game.assets.audioUrl("Field1.mp3"), {
          loop: true,
          assetName: "Field1.mp3",
        });
      } else {








        if (options.presentationResumeMode === "dungeon") {
          throw new Error(
            "Dungeon presentation resume has no restorable dungeon run: " +
            JSON.stringify({
              officialSlot: officialSlot !== undefined,
              projectionRevision: officialSlot?.coordinator.projection.revision,
              projectionLocation: officialLocation?.kind,
              projectionHasDungeon: officialSlot?.coordinator.projection.dungeon !== undefined,
              restoredSaveHasDungeon: restoredSave?.dungeon !== undefined,
              dungeonFeature: dungeonFeature !== undefined,
            }),
          );
        }
        await startWorld(initialWorldBootRoute({
          hasTownCapability: content.hasTownCapability,
          townName: startupTownDestination?.townName,
          fixturePoiName,
          fixturePoiIsTown: fixturePoiName === undefined
            ? undefined
            : initialWorldData?.pointsOfInterest.find((poi) => poi.name === fixturePoiName)?.town !== undefined,
          presentationResumeMode: options.presentationResumeMode === "town" ? "town" : "other",
        }));
      }
      if (dungeonHarnessRoute !== undefined) {
        if (dungeonFeature === undefined) throw new Error("dungeon fixture requires verified dungeon content");
        const waypointState = (globalThis as Record<string, unknown>)["__DIB_TEST_DUNGEON_WAYPOINT_STATE__"];
        if (
          waypointState !== undefined &&
          waypointState !== "undiscovered" &&
          waypointState !== "registered"
        ) {
          throw new Error(`invalid dungeon waypoint fixture state ${String(waypointState)}`);
        }
        await dungeonFeature.enterRoute(
          dungeonHarnessRoute,
          waypointState === undefined ? undefined : { waypointState },
        );
      }
    }




    await runOfficialEggHatch({
      parent: stage.root,
      owner: scenes.current ?? stage.root,
      instanceIdPrefix: "resumed-egg",
    });
  } else {
    if (standalonePlayer === undefined) throw new Error("standalone player state is missing");
    const standaloneEncounter = withWorldBattleSaveMePolicy(encounter, {
      owner: "direct-demo",
      authority: "local",
    });
    let markReady!: () => void;
    const ready = new Promise<void>((resolve) => { markReady = resolve; });
    let node!: BattleNode;
    node = new BattleNode({
      stage,
      game,
      audio,
      keyboard,
      encounter: standaloneEncounter,
      playerState: standalonePlayer.battleState(),
      openGoldStore: () => openGoldStoreHandoff(
        standalonePlayer,
        () => ({ parent: node.notificationParent, owner: node }),
        checkpoint,
      ),
      onQuestEvent: dispatchGuildQuestEvent,
      onReady: markReady,
    });
    startupBattleNode = node;
    await scenes.replace(node);
    const run = node.start(nextBattleSeed());
    await Promise.race([
      ready,
      run.then(() => { throw new Error("BattleNode ended before its startup-ready callback"); }),
    ]);
    void run.catch((error: unknown) => {
      console.error("Startup-owned BattleNode failed", error);
      queueMicrotask(() => { throw error; });
    });
  }
  checkpoint();
  // An active gameplay scene now owns SceneCoordinator.mode. Stop the shell-mode bridge before
  // finishTransition publishes the startup "complete" diagnostic.
  stopStartupModeSync();
  await startup.finishTransition();
  startupBattleNode?.notifyEnterTransitionDidFinish();
  if (runInitialScenarioAction !== undefined) {
    void runInitialScenarioAction().catch((error: unknown) => {
      console.error("Scenario launcher failed", error);
      queueMicrotask(() => { throw error; });
    });
  }

  globalThis.addEventListener("pagehide", () => {
    // Every player/world mutation checkpoints at its owning change callback. Starting a fresh
    // fetch here races document teardown (Chromium cancels it during reload and reports a false
    // save failure), so pagehide only observes work that was already queued.
    void saveSession.flush();
  }, { once: true });
}

function officialBattleReplay(
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
        ...(member.sourceInstanceId === undefined ? {} : { sourceInstanceId: member.sourceInstanceId }),
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
      switch (command.type) {
        case "ability":
          return { ...command, targetIds: [...command.targetIds] };
        case "capture":
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
        case "delay":
        case "retreat":
          return { ...command };
        case "summonSpirit":
          return { ...command };
      }
    }),
  };
}

function resolveGuildTavernBackgroundSpriteKey(
  content: ImportedContentPackage,
): string | undefined {
  return resolvePopupMenuBackgroundSpriteKey(content, "Tavern");
}

function resolvePopupMenuBackgroundSpriteKey(
  content: ImportedContentPackage,
  menuName: string,
): string | undefined {
  if (!content.resources.has("Menus.plist")) return undefined;
  const menus = content.resources.plist("Menus.plist");
  if (typeof menus !== "object" || menus === null || Array.isArray(menus)) {
    throw new Error("Menus.plist must be a dictionary");
  }
  const menu = (menus as Readonly<Record<string, unknown>>)[menuName];
  if (menu === undefined) return undefined;
  if (typeof menu !== "object" || menu === null || Array.isArray(menu)) {
    throw new Error(`Menus.plist.${menuName} must be a dictionary`);
  }
  const file = (menu as Readonly<Record<string, unknown>>)["fullScreenBackground"];
  if (typeof file !== "string" || !file.toLowerCase().endsWith(".png")) {
    throw new Error(
      `Menus.plist.${menuName}.fullScreenBackground must be a PNG resource`,
    );
  }
  const key = file.replace(/\.png$/i, "");
  if (!content.manifest.sprites[key]) {
    throw new Error(
      `${menuName} full-screen background ${file} is absent from the runtime manifest`,
    );
  }
  return key;
}

let activeContent: ImportedContentPackage | undefined;

/** Render a readable, actionable panel when a local package fails the runtime contract. */
function showFatalError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const host = document.getElementById("app") ?? document.body;
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;inset:0;display:flex;align-items:center;justify-content:center;" +
    "background:#12131a;color:#e6e6ee;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;" +
    "padding:24px;box-sizing:border-box;z-index:9999;";
  const card = document.createElement("div");
  card.style.cssText = "max-width:640px;width:100%;";
  const guidance = "The selected local archive does not satisfy the runtime content contract. " +
    "No archive bytes were uploaded. Reload to choose another archive.";
  card.innerHTML =
    '<h1 style="margin:0 0 12px;font-size:18px;color:#ff8a8a;">Local content cannot start</h1>' +
    `<pre style="white-space:pre-wrap;margin:0 0 16px;">${escapeHtml(guidance)}</pre>` +
    `<details style="opacity:.7;"><summary style="cursor:pointer;">error detail</summary>` +
    `<pre style="white-space:pre-wrap;margin:8px 0 0;">${escapeHtml(message)}</pre></details>`;
  panel.appendChild(card);
  host.appendChild(panel);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

async function startBoot(options: BootOptions = {}): Promise<void> {
  try {
    await boot(options);
  } catch (error) {
    console.error(error);
    activeContent?.dispose();
    activeContent = undefined;
    showFatalError(error);
  }
}

function tournamentStartChatKey(
  tournament: TournamentDef,
  round: number,
): string | undefined {
  const populator = tournament.monsterPopulators[round];
  const args = populator?.["arguments"];
  if (args === null || typeof args !== "object" || Array.isArray(args)) return undefined;
  const fixed = (args as Record<string, unknown>)["fixedEncounters"];
  if (!Array.isArray(fixed) || fixed.length === 0) return undefined;
  const encounter = fixed[0];
  if (encounter === null || typeof encounter !== "object" || Array.isArray(encounter)) {
    return undefined;
  }
  const startEvent = (encounter as Record<string, unknown>)["startEvent"];
  const chatKey = startEvent === null || typeof startEvent !== "object" || Array.isArray(startEvent)
    ? undefined
    : (startEvent as Record<string, unknown>)["chatKey"];
  return typeof chatKey === "string" ? chatKey : undefined;
}

void startBoot();
