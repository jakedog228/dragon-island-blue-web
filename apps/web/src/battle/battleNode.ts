import type { MultiplayerBattle } from "./multiplayerBattle.js";






























import { Container, Graphics, Rectangle, Sprite, Texture, type FederatedPointerEvent } from "pixi.js";
import {
  Scale9,
  makeColoredBitmapLabel,
  makeTtfLabel,
  CONTENT_SCALE_FACTOR,
  LifecycleScope,
  minimumHitRectLocal,
  type FixedStage,
} from "@dib/renderer";
import {
  BattleSession,
  buildPlayerChoices,
  mulberry32,
  type BattleReplaySnapshotV1,
  type BattleEvent,
  type CaptureCardLevel,
  type GuildQuestEvent,
  type PlayerChoice,
  type PresentationSessionStep,
  type ReplayableRng,
  type Rng,
} from "@dib/engine";
import type { GameCommandV1 } from "@dib/game-protocol";
import type { ChatDefinition, MonsterDef, StatName } from "@dib/gamedata";
import { applyPlayerBattleBonuses } from "@dib/player-domain";
import type { LoadedGame } from "../loadGame.js";
import type { AudioPlayer } from "../audio.js";
import {
  battleAbilitySlotForShortcut,
  isAdvanceShortcut,
  type KeyboardShortcut,
  type KeyboardShortcutRouter,
} from "../keyboardShortcuts.js";
import type { BattleTripParty } from "../player/battleTripParty.js";
import { tween } from "../tween.js";
import { attackTypeForUse, computePreloadPlan, soundTableForUse } from "./preloadPlan.js";
import {
  statusFinishWaitsForFollowingUpdate,
  state1ContinuationDelayMs,
  removalLogicHoldMs,
  terminalPresentationDelayMs,
  sceneManifest,
  backgroundPosCocos,
  turnOrderPosCocos,
  BACKGROUND_SIZE,
  BACKGROUND_TEXTURE_RECT_PX,
  FRIENDLY_ATTACK_SPOTLIGHT_Z,
  NOT_YOUR_TURN_BANNER_Z,
  type SceneChildKey,
} from "./battleNodeScene.js";
import { nextNotYourTurnFlag, showNotYourTurnBanner } from "./notYourTurnBanner.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { idiomPairPt } from "../displayMode.js";
import {
  SCREEN_W,
  SCREEN_H,
  ENEMY_SLOT_WIDTH,
  ENEMY_SLOT_HEIGHT,
  automaticTurnActivationMotion,
  type AutomaticTurnActivationMotion,
} from "./displayShared.js";
import { EnemyTeamDisplay, type EnemySnapshot } from "./enemyTeamDisplay.js";
import { FriendlyTeamDisplay, type FriendlySnapshot } from "./friendlyTeamDisplay.js";
import { TurnOrderDisplay, type TurnOrderProvider, type TurnOrderMonsterInfo } from "./turnOrderDisplay.js";
import { MonsterTurnPanel } from "./monsterTurnPanel.js";
import { AbilityRenderer, targetContentRectInLayer, type TargetDisplayArea } from "./abilityRenderer.js";
import { StatusTextDisplay, STATUS_TEXT_SIZE } from "./statusText.js";
import { TargetPicker, type TargetRef, type LivingInfoSnapshot } from "./targetPicker.js";
import { evolveChainInfoRows, soulStoneStatRows, type ElementHelpName, type LivingInfoAbility, type LivingInfoEvolveRow, type LivingInfoSoulStone } from "./infoDisplays.js";
import { abilityStatusTextLine, localizedRenderableName, localizedString } from "../localization.js";
import { battleDebug, describeEvent } from "./debugLog.js";
import { Popup, PopupHost } from "../ui/popup.js";
import { WorldNotificationHost } from "../world/worldNotificationHost.js";
import {
  buildMonsterHatchMessageContent,
  buildLocalizedMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import { showCaptureCardPopup } from "./captureCardPopup.js";
import { showLostCapturesPopup, type LostCaptureEntry } from "./lostCapturesPopup.js";
import { XpAwardDisplay, type XpAwardEntry } from "./postBattleDisplay.js";
import {
  jobLevelAfterAward,
  jobXpCostOfNextLevel,
  jobXpForLevel,
} from "./postBattleMath.js";
import { levelUpPages, type LevelUpEntry } from "./levelUpText.js";
import {
  EvolutionOverlay,
  loadEvolutionAssets,
  type EvolutionAssets,
} from "./evolutionDisplay.js";
import {
  EVOLVE_END_DELAY_MS,
  EVOLVE_PERFORM_DELAY_MS,
  evolutionBattingPrefix,
  evolutionRenderableTypes,
  firstEvolveCandidate,
} from "./evolutionMath.js";
import {
  battleMusicRole,
  battleOriginalShortType,
  battlePortraitFrame,
  battleSpriteKey,
  type EncounterConfig,
} from "./encounter.js";
import { officialEncounterRoster } from "./officialEncounterRoster.js";
import type { BattlePlayerState } from "../player/battlePlayerState.js";
import { RemoteGameAuthorityError } from "../authority/gameAuthorityClient.js";
import {
  runInsufficientFundsStoreHandoff,
  type OpenGoldStoreHandoff,
} from "../player/goldStoreHandoff.js";
import { BattleRoster } from "./battleRoster.js";
import { buildAbilityInfoModel, buildPassiveAbilityInfoModel, type AbilityInfoContext } from "./abilityInfo.js";
import {
  createMonsterManagementNode,
  type MonsterManagementEntry,
  type MonsterManagementNode,
} from "./monsterManagementNode.js";
import { StatusOverlayController, type StatusOverlayHost } from "./statusOverlay.js";
import { SpiritMenu } from "./spiritMenu.js";
import type { SpiritMenuItemModel } from "./spiritMenuMath.js";
import { buildSpiritMenuItems } from "./spiritMenuMath.js";
import {
  preAdvanceQueueProjection,
  turnOrderResolutionPlan,
  type TurnOrderResolutionPlan,
} from "./turnOrderFlow.js";
import { enemyDefeatQuestEvents } from "./battleQuestEvents.js";
import {
  createLocalBattleSession,
  mirrorLocalCapturePurchaseToBattleWallet,
  settleLocalBattleWalletEvents,
} from "./localBattleSession.js";
import {
  mountOfficialBattlePresentation,
  restoredAnalyzeEnabled,
  restoredRosterIdentities,
  restoredStatusCounts,
  type RestoredRosterIdentity,
} from "./officialBattlePresentation.js";
import {
  showGuildQuestChat,
  type GuildQuestChatHandle,
} from "../world/guildQuestChat.js";
import {
  showPlotTutorial,
  type PlotTutorialDebugState,
  type PlotTutorialHandle,
} from "../ui/plotGameFlow.js";
import { BATTLE_TUTORIAL_DELAY_MS } from "../ui/plotGameFlowMath.js";

/** `Monsters.json` `rendererData.scale` — the data-driven field-sprite scale (display-only
 *  passthrough on `MonsterDef.rendererData`, observed shape `{scale: number}`). */
function rendererScaleOf(rendererData: unknown): number | undefined {
  if (rendererData === null || typeof rendererData !== "object") return undefined;
  const scale = (rendererData as Record<string, unknown>)["scale"];
  return typeof scale === "number" ? scale : undefined;
}

/** One friendly Job's post-battle presentation state. World-owned battles mirror each mutation
 *  into `WorldTripParty`; direct fixtures keep it only through their post-battle chain. The `batting`/`bench`
 *  lists share these objects by reference, mirroring the source's single Monster instances
 *  appearing in both `monstersFromBattingOrderWithAlive:` and `monstersOnBench` scans. */
interface PostBattlePartyMonster {
  id: string;
  sourceInstanceId?: string;
  shortType: string;
  level: number;
  cumulativeXp?: number;
}






export type BattleExitOutcome = "victory" | "defeat" | "retreat" | "saveMe";

export interface RetryableTerminalExit {
  /** Returns false while a terminal exit is in flight or after one has completed. */
  dispatch(outcome: BattleExitOutcome): boolean;
  /** Starts a new BattleNode presentation lifecycle (used by the direct-battle rematch path). */
  reset(): void;
  readonly inFlight: BattleExitOutcome | undefined;
  readonly completed: BattleExitOutcome | undefined;
}

/** State 6 (`escaped`) has no `battleEnded` winner; the loop hands it to onBattleRetreated. */
export function terminalPresentationWinner(
  events: readonly BattleEvent[],
  battleEscaped: boolean,
): 0 | 1 | undefined {
  const turnOrderPlan = turnOrderResolutionPlan(events);
  if (!turnOrderPlan.terminal || battleEscaped) return undefined;
  const ended = events.find((event): event is Extract<BattleEvent, { type: "battleEnded" }> =>
    event.type === "battleEnded"
  );
  if (ended === undefined || ended.winner === "draw") {
    throw new Error("BattleNode: terminal turn omitted a source-valid battleEnded winner");
  }
  return ended.winner;
}

/** Small async state machine for terminal navigation. A rejected exit clears only the in-flight
 * latch, retains the failed outcome for an exact retry, and reports through the supplied error
 * channel; a successful exit is permanently suppressed until the owner starts a new lifecycle. */
export function createRetryableTerminalExit(
  execute: (outcome: BattleExitOutcome) => void | Promise<void>,
  reportError: (error: unknown) => void = (error) => {
    console.error("BattleNode terminal exit failed", error);
    queueMicrotask(() => { throw error; });
  },
): RetryableTerminalExit {
  let inFlight: BattleExitOutcome | undefined;
  let completed: BattleExitOutcome | undefined;
  let failed: BattleExitOutcome | undefined;
  let generation = 0;
  return {
    dispatch(outcome): boolean {
      if (inFlight !== undefined || completed !== undefined) return false;
      if (failed !== undefined && failed !== outcome) {
        throw new Error(`BattleNode terminal exit retry changed outcome from ${failed} to ${outcome}`);
      }
      inFlight = outcome;
      const attemptGeneration = ++generation;
      void Promise.resolve().then(() => execute(outcome)).then(() => {
        if (generation !== attemptGeneration) return;
        inFlight = undefined;
        failed = undefined;
        completed = outcome;
      }, (error: unknown) => {
        if (generation !== attemptGeneration) return;
        inFlight = undefined;
        failed = outcome;
        reportError(error);
      });
      return true;
    },
    reset(): void {
      generation += 1;
      inFlight = undefined;
      completed = undefined;
      failed = undefined;
    },
    get inFlight(): BattleExitOutcome | undefined { return inFlight; },
    get completed(): BattleExitOutcome | undefined { return completed; },
  };
}

export interface TerminalEnemyMemberProjection {
  readonly constructionIndex: number;
  readonly createdMidBattle: boolean;
  readonly status: "active" | "reserve" | "dead" | "captured";
}

/** Projects the source dungeon roster from the terminal enemy membership census.
 * Dead/captured members are absent from BattleSession's active/reserve census in production; the
 * explicit statuses keep this boundary pure and make that exclusion testable without Pixi. */
export function projectOriginalEnemySurvivorConstructionIndices(
  members: readonly TerminalEnemyMemberProjection[],
): readonly number[] {
  const indices = new Set<number>();
  for (const member of members) {
    if ((member.status === "active" || member.status === "reserve") && !member.createdMidBattle) {
      indices.add(member.constructionIndex);
    }
  }
  return Object.freeze([...indices].sort((left, right) => left - right));
}

/** Application-owned local defeat recovery. Battle presentation never reads the wallet, tutorial
 * flags, or durable party directly; the active save/runtime adapter owns those decisions. */
export interface DefeatRecoveryAdapter {
  canOffer(): boolean;
  markTutorialSeen(): void | Promise<void>;
  acceptSaveMe(): Promise<"saved" | "insufficient-funds">;
  /** Resolves only after Store is mounted. Its nested promise resolves through Store's normal
   * close lifecycle, giving BattleNode two distinct ordering edges for the stacked refusal. */
  openGoldStore(): Promise<{ readonly closed: Promise<void> }>;
}




const ENCOUNTER_WIN_LOGIC_DELAY_MS = 500;

const SAVE_ME_GOLD_COST = 100;
/** Below this, a `timeDelay` remainder is floating-point dust from summing frame deltas rather
 *  than hold the source would still be counting. See `drainTimeDelay`. */
const TIME_DELAY_RESIDUE_MS = 1e-6;

export interface BattleNodeDeps {
  multiplayer?: MultiplayerBattle;
  stage: FixedStage;
  game: LoadedGame;
  audio: AudioPlayer;
  keyboard: KeyboardShortcutRouter;
  encounter: EncounterConfig;
  /** Explicit player-owned state boundary. The battle scene neither creates demo state nor owns
   *  persistence; the app shell supplies both collection reads and capture economy mutations. */
  playerState: BattlePlayerState;
  /** Present only for navigation-owned encounters. Direct battle fixtures omit this and retain
   * the historical rematch behavior. */
  tripParty?: BattleTripParty;
  /** Required whenever the source encounter allows Save Me; blocked fixtures may omit it. */
  readonly defeatRecovery?: DefeatRecoveryAdapter;

  readonly openGoldStore?: OpenGoldStoreHandoff;
  captureInstanceId?: (shortType: string, level: number) => string;
  onExit?: (outcome: BattleExitOutcome) => void | Promise<void>;

  onCommittedTerminal?: (outcome: BattleExitOutcome) => void | Promise<void>;

  onExitFailure?: (
    outcome: BattleExitOutcome,
    error: unknown,
    retry: () => boolean,
  ) => void;
  onQuestEvent?: (event: GuildQuestEvent) => void;
  requestChatPresentation?: (name: string, alwaysShow: boolean) => boolean;
  onReady?: () => void;
  /** Official semantic-command bridge. It appends newly committed draws before resolving. */
  authority?: {
    readonly battleId: string;
    readonly replay: BattleReplaySnapshotV1;
    readonly resumeExisting?: boolean;
    submit(command: Extract<GameCommandV1, { type: `battle.${string}` }>): Promise<void>;
    claimTutorialFlag(flag: string): Promise<void>;
  };
}

export class BattleNode {
  readonly sceneKind = "battle" as const;
  private readonly lifecycle = new LifecycleScope();
  private readonly multiplayer: MultiplayerBattle | undefined;
  private readonly stage: FixedStage;
  private readonly game: LoadedGame;
  private readonly audio: AudioPlayer;
  private readonly keyboard: KeyboardShortcutRouter;
  private readonly encounter: EncounterConfig;
  private roster: BattleRoster;
  private readonly collection: BattlePlayerState["collection"];
  private readonly profile: BattlePlayerState["profile"];
  private readonly tripParty: BattleTripParty | undefined;
  private readonly defeatRecovery: DefeatRecoveryAdapter | undefined;
  private readonly openGoldStore: OpenGoldStoreHandoff | undefined;
  private readonly captureInstanceId: BattleNodeDeps["captureInstanceId"];
  private readonly onExit: BattleNodeDeps["onExit"];
  private readonly onCommittedTerminal: BattleNodeDeps["onCommittedTerminal"];
  private readonly onExitFailure: BattleNodeDeps["onExitFailure"];
  private readonly onQuestEvent: BattleNodeDeps["onQuestEvent"];
  private readonly requestChatPresentation: NonNullable<BattleNodeDeps["requestChatPresentation"]>;
  private readonly onReady: BattleNodeDeps["onReady"];
  private readonly authority: BattleNodeDeps["authority"];
  private terminalExit!: RetryableTerminalExit;
  private terminalRetryOutcome: BattleExitOutcome | undefined;
  private activeTerminalRetryPopup: Popup | undefined;
  private lastTerminalExitOutcome: BattleExitOutcome | undefined;
  private enterTransitionFinished = false;
  private readySignaled = false;
  private resolveEnterTransition!: () => void;
  private readonly enterTransitionDone = new Promise<void>((resolve) => {
    this.resolveEnterTransition = resolve;
  });
  private tripTerminalCommitted = false;

  /** The ×2 point-space mount (480x320 authored -> 960x640 device). Persists for the node's life;
   *  its single child `scene` is destroyed + rebuilt fresh on every `start()` (rematch lesson —
   *  never revive a destroyed v8 Container). */
  private readonly pointRoot = new Container();
  /** Cocos's GL viewport clips every child to 480×320. Without this, authored bleed sprites paint
   * into FixedStage's browser letterbox instead of stopping at the game-screen border. */
  private readonly sceneClip = new Graphics().rect(0, 0, SCREEN_W, SCREEN_H).fill(0xffffff);
  private scene: Container | undefined;

  private session!: BattleSession;
  /**
   * Local Battle and BattleNode share native's process-global arc4random stream. Official battle
   * presentation deliberately leaves this undefined: its committed mechanic tape is authority-
   * owned and presentation-only draws must never consume it.
   */
  private sourceRng: Rng | undefined;
  private enemyDisplay!: EnemyTeamDisplay;
  private friendlyDisplay!: FriendlyTeamDisplay;
  private turnOrder!: TurnOrderDisplay;
  private panel!: MonsterTurnPanel;
  private abilityRenderer!: AbilityRenderer;
  private effectLayer!: Container;
  private statusText!: StatusTextDisplay;
  private targetPicker!: TargetPicker;
  private activeSpiritMenu: SpiritMenu | undefined;
  private spiritMenuOpening = false;
  private spiritSelectionPending = false;
  private activeCapturePopup: Popup | undefined;
  private activeEncounterChat: GuildQuestChatHandle | undefined;
  private activePlotTutorial: PlotTutorialHandle | undefined;
  private plotTutorialState: PlotTutorialDebugState | undefined;
  private capturePopupKind: "captureChooser" | "cannotAfford" | null = null;
  private capturePurchasePending = false;
  private activeSecondaryPopup: Popup | undefined;
  private secondaryPopupKind: "confirmSkip" | "confirmRetreat" | "noRetreat" | "noBattingOrder" | "retreated" | null = null;
  private activeAnalyzePopup: Popup | undefined;
  private analyzePopupKind: "analyzeNotReady" | "noMonstersToAnalyze" | null = null;
  private activeMonsterManagement: MonsterManagementNode | undefined;
  private activePostBattlePopup: Popup | undefined;
  private postBattlePopupKind: "xpAward" | "returnToTown" | null = null;
  /** `-[Encounter showLostCaptures]`'s popup. Tracked separately from the loss/retreat popup it
   *  stacks on top of: the source creates it SECOND on the loss path and FIRST on the retreat
   *  path, so it is not always the topmost modal. */
  private activeLostCapturesPopup: Popup | undefined;
  private activeXpAwardDisplay: XpAwardDisplay | undefined;
  /** Level-up pages pre-built in showXpAwardPopup (`performAwardLogic` queues them BEFORE the
   *  popup shows — flow doc §1.2); the popup's Close button reveals them. */
  private pendingLevelUpPages: string[] = [];
  /** Post-battle party model for the evolution chain (see PostBattlePartyMonster). */
  private postBattleParty: { batting: PostBattlePartyMonster[]; bench: PostBattlePartyMonster[] } | undefined;
  private evolutionOverlay: EvolutionOverlay | undefined;
  private evolutionAssets: EvolutionAssets | undefined;
  private evolutionAssetsPromise: Promise<EvolutionAssets> | undefined;






  private xpAwardPopupClosed = false;
  private evolveChainStarted = false;
  private monsterManagementOpening = false;
  /** status-effects.md §2/§7 item 3 — the persistent Zzz/bolts/particles overlay tracker. Rebuilt
   *  per `buildScene()` (like every other scene-owned display) so a rematch never reuses stale
   *  ticker-bound spawn loops from a destroyed scene. */
  private statusOverlays!: StatusOverlayController;


  private actingCardOverlayDisposer: (() => void) | undefined;
  /** Set when this turn's events included an `escaped` guaranteed-retreat (events.ts:
   *  `{type:"escaped"}`) — checked by `loop()` right after each `playTurn` call so the SAME
   *  Retreat-chat/Escape.m4a presentation the player's own successful retreat uses fires
   *  regardless of which living's ability triggered it (status-effects.md's `escaped` doc:
   *  "guaranteed retreat... the Escape.m4a moment", identical to the player-retreat success path). */
  private battleEscaped = false;
  private pendingTerminalPresentation:
    | { winner: 0 | 1; removedLivingCount: number; frontTeam: 0 | 1 | undefined }
    | undefined;
  /** Native Battle's non-permanent `HasConfirmedSkip` property: reset for each battle/rematch. */
  private hasConfirmedSkip = false;

  /** Live per-living HP, seeded to MaxHP and updated from `damageDealt`/`healed` events — the
   *  single source TurnOrderDisplay's `infoOf` and the info popups read. */
  private readonly hp = new Map<string, number>();

  /** True while a `TargetPicker` pick is in progress — gates portrait/info taps (seam 2). */
  private picking = false;
  private built = false;
  private elapsedPresentationMs = 0;
  private presentationState = "building";
  private buildPhase = "idle";
  /** Display builds started this turn that later id->node lookups depend on; see
   *  `settleDisplayRegistrations`. */
  private pendingDisplayRegistrations: Promise<void>[] = [];
  private presentationStateSinceMs = 0;
  private activeActorId: string | null = null;
  private activeAbilityPath: string | null = null;
  private swipeTargetFeedbackCount = 0;
  private latestSwipeTargetFeedback: "notAllowed" | null = null;
  private latestPlayerSubmission: {
    readonly actorId: string;
    readonly slot: PlayerChoice["slot"];
    readonly abilityPath: string;
    readonly selectedTargetIds: readonly string[];
    readonly submittedTargetIds: readonly string[];
  } | null = null;
  /** Monotonic browser-contract evidence. `awaitPlayerChoice()` clears the latest submission when
   *  a new panel opens, so the latest-value field alone cannot distinguish that legitimate reset
   *  from a status-finish release leaking through to an underlying ability card. */
  private playerAbilitySubmissionCount = 0;
  /** Browser-contract snapshot taken before each resolved turn reaches impact. The engine has
   *  already resolved synchronously here, but the TU presentation has not consumed action cost
   *  or removals yet. */
  private turnOrderAtTurnStart:
    | { displayedQueue: string[]; delayText: Record<string, string> }
    | null = null;
  private latestSecondaryAction: Record<string, unknown> | null = null;
  private cancelPendingChoice: (() => void) | undefined;
  private resumedStep: PresentationSessionStep | undefined;
  /** Reconnect-only history used to reconstruct current presentation state without replaying old
   * attacks. Fresh Official mounts deliberately leave this empty and present their opening turns. */
  private restoredPresentationEvents: readonly BattleEvent[] = [];
  /** A fresh Official replay visibly presents an automatic prefix whose spirit charge is already
   * committed in the projected profile. Suppress that one prefix; after its first player decision,
   * later command batches still mirror into the retained browser profile exactly once. */
  private suppressCommittedOpeningSpiritCharge = false;
  private keyboardActive = false;

  /** AbilityRenderer's stale-tolerant lookup (returns null for an already-removed target). */
  private readonly nodeLookup = {
    displayAreaOf: (id: string): TargetDisplayArea | null => this.tryEffectArea(id),
    // buffAdded's phase-dict selection (status-effects.md §7 item 2) -- unlike damageDealt/healed,
    // a buff carries no implicit team relationship from its event type alone.
    sameTeam: (source: string, target: string): boolean => this.session.teamOf(source) === this.session.teamOf(target),
  };

  constructor(deps: BattleNodeDeps) {
    this.stage = deps.stage;
    this.multiplayer = deps.multiplayer;
    this.game = deps.game;
    this.audio = deps.audio;
    this.keyboard = deps.keyboard;
    // Snapshot setup once so engine construction, display adaptation, and debug state can never
    // disagree if an app-level encounter object is reused or mutated after navigation begins.
    const encounter: EncounterConfig = {
      backgroundKey: deps.encounter.backgroundKey,
      allowRetreat: deps.encounter.allowRetreat ?? true,
      blockSaveMe: deps.encounter.blockSaveMe ?? true,
      ...(deps.encounter.blockCapture === undefined
        ? {}
        : { blockCapture: deps.encounter.blockCapture }),
      ...(deps.encounter.breederXpBonus !== undefined
        ? { breederXpBonus: deps.encounter.breederXpBonus }
        : {}),
      ...(deps.encounter.questKey === undefined ? {} : { questKey: deps.encounter.questKey }),
      ...(deps.encounter.uniqueKey === undefined ? {} : { uniqueKey: deps.encounter.uniqueKey }),
      ...(deps.encounter.startChat === undefined ? {} : { startChat: deps.encounter.startChat }),
      ...(deps.encounter.winChat === undefined ? {} : { winChat: deps.encounter.winChat }),
      ...(deps.encounter.difficultyModifier === undefined
        ? {}
        : { difficultyModifier: deps.encounter.difficultyModifier }),
      // A party-projected team already carries the player's permanent hero-skill/Gem buff
      // children (WorldTripParty owns them, exactly as the source keeps them on the bench
      // Monster), and an authoritative replay carries whatever the authority projected. Only a
      // standalone demo team — no durable party behind it — still needs them derived here.
      playerTeam: deps.authority === undefined && deps.tripParty === undefined && deps.multiplayer === undefined
        ? applyPlayerBattleBonuses(deps.encounter.playerTeam, deps.playerState.profile)
        : deps.encounter.playerTeam.map((member) => ({ ...member })),
      enemyTeam: deps.encounter.enemyTeam.map((member) => ({ ...member })),
    };
    this.encounter = deps.authority === undefined
      ? encounter
      : officialEncounterRoster(encounter, deps.authority.replay);
    this.roster = new BattleRoster(this.encounter, this.multiplayer?.you);
    this.collection = deps.playerState.collection;
    this.profile = deps.playerState.profile;
    this.tripParty = deps.tripParty;
    this.defeatRecovery = deps.defeatRecovery;
    this.openGoldStore = deps.openGoldStore;
    if (!this.encounter.blockSaveMe && this.defeatRecovery === undefined) {
      throw new Error("BattleNode: an unblocked encounter requires a defeatRecovery adapter");
    }
    this.captureInstanceId = deps.captureInstanceId;
    this.onExit = deps.onExit;
    this.onCommittedTerminal = deps.onCommittedTerminal;
    this.onExitFailure = deps.onExitFailure;
    this.terminalExit = createRetryableTerminalExit(async (outcome) => {
      if (this.onExit) {
        await this.onExit(outcome);
        this.terminalRetryOutcome = undefined;
        this.activeTerminalRetryPopup?.dismiss();
        this.notifyCommittedTerminal(outcome);
      } else {
        await this.start(Date.now() >>> 0);
        this.terminalRetryOutcome = undefined;
        this.activeTerminalRetryPopup?.dismiss();
      }
    }, (error: unknown) => {
      this.terminalRetryOutcome = this.lastTerminalExitOutcome;
      if (this.terminalRetryOutcome !== undefined && this.onExitFailure !== undefined) {
        this.onExitFailure(
          this.terminalRetryOutcome,
          error,
          () => this.retryTerminalExit(),
        );
        return;
      }
      console.error("BattleNode terminal exit failed; retry is available", error);
      void this.showTerminalExitRetryPopup();
    });
    this.onQuestEvent = deps.onQuestEvent;
    this.requestChatPresentation = deps.requestChatPresentation ?? (() => true);
    this.onReady = deps.onReady;
    this.authority = deps.authority;
    deps.keyboard.register(shortcut => this.handleKeyboardShortcut(shortcut) ||
      (this.multiplayer !== undefined && this.keyboardActive), this.lifecycle.signal);
    if (
      this.tripParty !== undefined &&
      this.captureInstanceId === undefined &&
      this.authority === undefined
    ) {
      throw new Error("BattleNode: a trip-owned battle requires captureInstanceId");
    }

    this.pointRoot.scale.set(CONTENT_SCALE_FACTOR);
    this.pointRoot.label = "battlePointRoot";
    this.pointRoot.sortableChildren = true;
    this.pointRoot.addChild(this.sceneClip);
    this.stage.root.addChild(this.pointRoot);
    WorldNotificationHost.registerAutomaticPresentationRootFor(this.stage.root, this.pointRoot);
    this.lifecycle.add(() => {
      if (this.pointRoot.parent) this.pointRoot.parent.removeChild(this.pointRoot);
      if (!this.pointRoot.destroyed) this.pointRoot.destroy({ children: true });
    });

    // Per-frame HP-bar easing for every live display (each widget's own `update(dtMs)` contract).
    this.stage.app.ticker.add(this.updateFn);
    this.lifecycle.add(() => this.stage.app.ticker.remove(this.updateFn));

    // Screen-wide tap-to-advance for the status-text dialog (seam 3 / battle-node.md §8:
    // `-[BattleNode ... setIsTouchEnabled:1]` + `statusTextAdvance:`). Attached once; gated so it
    // only fires when the dialog is actually showing and no pick is in progress (during picking the
    // TargetPicker owns touches). The dialog's own box-tap (statusText.ts) still works too.
    const stagePixi = this.stage.app.stage;
    stagePixi.eventMode = "static";
    stagePixi.hitArea = this.stage.app.screen;
    stagePixi.on("pointertap", this.handleStageTap);
    this.lifecycle.add(() => stagePixi.off("pointertap", this.handleStageTap));

    stagePixi.on("pointerdowncapture", this.handleNotYourTurnProbe);
    this.lifecycle.add(() => stagePixi.off("pointerdowncapture", this.handleNotYourTurnProbe));
    this.audio.playSfx("Encounter");
  }


  async start(seed: number | Rng): Promise<void> {
    if (this.lifecycle.disposed) throw new Error("BattleNode.start: battle node is destroyed");
    const localRng = this.authority === undefined && this.multiplayer === undefined
      ? (typeof seed === "number" ? mulberry32(seed) : seed)
      : undefined;
    this.sourceRng = localRng;




    this.elapsedPresentationMs = 0;
    this.tripTerminalCommitted = false;
    this.terminalRetryOutcome = undefined;
    this.lastTerminalExitOutcome = undefined;
    this.activeTerminalRetryPopup?.dismiss();
    this.activeTerminalRetryPopup = undefined;
    this.terminalExit.reset();
    this.hasConfirmedSkip = false;
    this.battleEscaped = false;
    // A fresh BattleNode starts with `timeDelay` at its 0 initializer; a rematch must not inherit
    // the previous fight's residue. `notYourTurnShown` is the same kind of instance ivar (@ 0x129)
    // and is likewise zero on a fresh node, so a rematch is allowed one more banner — subject to
    // the persistent six-slot budget, which a rematch does NOT reset.
    this.timeDelay = 0;
    this.notYourTurnShown = false;
    this.pendingTerminalPresentation = undefined;
    this.latestSecondaryAction = null;
    this.secondaryPopupKind = null;
    this.activeSecondaryPopup = undefined;
    this.analyzePopupKind = null;
    this.activeAnalyzePopup = undefined;
    this.activeMonsterManagement = undefined;
    this.monsterManagementOpening = false;
    this.activePostBattlePopup = undefined;
    this.postBattlePopupKind = null;
    this.activeLostCapturesPopup = undefined;
    this.activeXpAwardDisplay = undefined;
    this.pendingLevelUpPages = [];
    this.postBattleParty = undefined;
    this.evolutionOverlay = undefined; // scene child — destroyed with the old scene below
    this.evolutionAssets = undefined;
    this.evolutionAssetsPromise = undefined;
    this.xpAwardPopupClosed = false;
    this.evolveChainStarted = false;
    this.activeSpiritMenu = undefined;
    this.spiritMenuOpening = false;
    this.spiritSelectionPending = false;
    // A rematch rebuilds every display from scratch (initTeam clears the id maps), so any
    // registration still pending from the previous battle refers to nodes this one won't own.
    this.pendingDisplayRegistrations = [];
    this.turnOrderAtTurnStart = null;
    this.setPresentationState("building");
    this.buildPhase = "scene";
    await this.buildScene();
    if (this.lifecycle.disposed) return;
    this.buildPhase = "session";
    if (this.multiplayer) {
      this.session = this.multiplayer.session;
      this.resumedStep = this.multiplayer.resumedStep;
      this.restoredPresentationEvents = this.multiplayer.historyEvents;
      this.suppressCommittedOpeningSpiritCharge = false;
    } else if (this.authority === undefined) {
      this.session = createLocalBattleSession(
        this.game.gd,
        [structuredClone(this.encounter.playerTeam), structuredClone(this.encounter.enemyTeam)],
        localRng!,
        this.profile,
        this.encounter.blockCapture === undefined
          ? {}
          : { blockCapture: this.encounter.blockCapture },
      );
      this.resumedStep = undefined;
      this.restoredPresentationEvents = [];
      this.suppressCommittedOpeningSpiritCharge = false;
    } else {
      if (typeof seed === "number") {
        throw new Error("BattleNode: official replay requires a committed draw-tape RNG");
      }
      const mount = mountOfficialBattlePresentation(
        this.game.gd,
        this.authority.replay,
        seed as ReplayableRng,
        this.authority.resumeExisting === true,
      );
      this.session = mount.session;
      this.resumedStep = mount.resumedStep;
      this.restoredPresentationEvents = mount.historyEvents;
      this.suppressCommittedOpeningSpiritCharge = this.authority.resumeExisting !== true;
    }
    // The roster accumulates mid-battle constructions (registerMidBattle), but the fresh session above
    // only knows the encounter's initial setups — a rematch must not carry last battle's summon
    // ids into buildSnapshots' session lookups. Rebuilt here because Rematch stands in for the
    // original's new-BattleNode construction (see start()'s music note above).
    this.roster = new BattleRoster(this.encounter, this.multiplayer?.you);
    const restoredIdentities = restoredRosterIdentities(this.restoredPresentationEvents);
    for (const identity of restoredIdentities) {
      this.roster.registerMidBattle(identity.id, identity.team, {
        shortType: identity.shortType,
        level: identity.level,
      });
    }
    this.buildPhase = "roster";
    await this.preloadRestoredRoster(this.multiplayer ? this.roster.entries().map(entry => ({ id: entry.id, team: entry.team, shortType: entry.setup.shortType, level: entry.setup.level })) : restoredIdentities);
    if (this.lifecycle.disposed) return;

    // Team displays render ACTIVE members only (the original's `team.monsterMembers`); the 4th+
    // setup entries are `replacementMembers` (engine bench) and only appear via the promotion
    // path (`notifyAdded`). The six-per-side demo exercises this after active members fall.
    // NOTE: activeIdsOf, not aliveIdsOnTeam — the queue is only seeded on the first session
    // step, so queueOrder() is still empty here.
    const { friendly, enemy } = this.buildSnapshots();
    const activeF = new Set(this.session.activeIdsOf(0));
    const activeE = new Set(this.session.activeIdsOf(1));
    this.buildPhase = "teams";
    await this.friendlyDisplay.initTeam(friendly.filter((f) => activeF.has(f.id)));
    await this.enemyDisplay.initTeam(enemy.filter((e) => activeE.has(e.id)));
    this.enemyDisplay.setBenchCount(this.session.benchCountOf(1));
    this.buildPhase = "restored-presentation";
    await this.hydrateRestoredPresentation(this.restoredPresentationEvents);
    if (this.lifecycle.disposed) return;

    this.enemyDisplay.onElementTap((element) => void this.targetPicker.showElementInfo(element as ElementHelpName));
    this.enemyDisplay.onAnalyzeTap((id) => void this.openLivingInfo(id));
    this.enemyDisplay.onBenchTap((result) => {
      if (result === "showReserves") {
        if (this.activeMonsterManagement || this.monsterManagementOpening) return false;
        void this.openReserveManagement(1).catch((error: unknown) => {
          // An async asset/constructor failure would otherwise become an easy-to-miss rejected
          // promise after EnemyTeamDisplay has consumed Analyze. Preserve the project's
          // fail-loud contract in both the browser console and the global error channel.
          console.error("MonsterManagementNode failed to open", error);
          queueMicrotask(() => { throw error; });
        });
        return true;
      }
      void this.handleEnemyBenchTap(result);
      return true;
    });
    this.friendlyDisplay.onCardTap((id) => void this.openLivingInfo(id));
    this.panel.onActingCardTap((id) => void this.openLivingInfo(id));
    this.friendlyDisplay.onEmptySpiritTap(() => void this.targetPicker.showMessagePopup("NoSpirit"));
    this.turnOrder.onOwnTap((id) => void this.openLivingInfo(id));

    this.buildPhase = "ready";
    this.built = true;
    if (!this.readySignaled) {
      this.readySignaled = true;
      this.onReady?.();
    }
    // Native constructs the visible battle children, begins the enemy entrance actions, starts
    // BGM, and schedules showAIPopup from onEnterTransitionDidFinish. Asset-backed Pixi children
    // may be prepared early, but stay hidden and motionless until that same boundary.
    await this.enterTransitionDone;
    if (this.lifecycle.disposed) return;
    this.enemyDisplay.startInitialEntrance();
    if (this.scene) this.scene.visible = true;
    const music = battleMusicRole(this.encounter.breederXpBonus);
    this.playMusicTrack(music.category, music.trackCount, true);
    if (!this.multiplayer && this.authority?.resumeExisting !== true) await this.presentInitialTutorials();
    if (this.lifecycle.disposed) return;
    await this.showEncounterChat(this.encounter.startChat, "startEvent");
    if (this.lifecycle.disposed) return;
    await this.loop();
  }

  /** Releases scene resources and input/ticker ownership. Idempotent so a future scene stack can
   * safely tear down battle from navigation and error paths alike. Rematch does not call this; it
   * intentionally rebuilds the child scene within the same source-equivalent BattleNode life. */
  destroy(): void {
    if (this.lifecycle.disposed) return;
    this.notifyEnterTransitionDidFinish();
    this.built = false;
    this.picking = false;
    this.cancelPendingChoice?.();
    this.cancelPendingChoice = undefined;
    this.disposeActingCardStatusOverlays();
    this.statusOverlays?.dispose();
    this.activeEncounterChat?.dismiss(true);
    this.activeEncounterChat = undefined;
    this.activePlotTutorial?.dismiss();
    this.activePlotTutorial = undefined;
    this.plotTutorialState = undefined;
    this.abilityRenderer?.dispose();
    if (this.scene !== undefined) PopupHost.for(this.scene).dismissAll();
    this.lifecycle.dispose();
    this.scene = undefined;
  }

  private readonly handleStageTap = (e: FederatedPointerEvent): void => {
    if (!this.built || this.activeMonsterManagement) return;
    if (this.picking) {









      if (e.target === this.scene) this.audio.playSfx("notAllowed");
      return;
    }
    if (this.statusText.visible) this.statusText.advance();
  };

  private readonly updateFn = (): void => {
    if (
      !this.built ||
      !this.enterTransitionFinished ||
      !this.pointRoot.visible ||
      this.scene?.visible !== true
    ) return;
    const rawDt = this.stage.app.ticker.deltaMS;






    const dt = rawDt * this.gameSpeed;
    // The diagnostic clock deliberately stays on RAW wall time: it is what lets a scenario observe
    // that a scaled gate actually elapses in less real time. It is port-only and has no source ivar.
    this.elapsedPresentationMs += rawDt;
    this.enemyDisplay.update(dt);
    this.friendlyDisplay.update(dt);
    this.turnOrder.update(dt);
    this.panel.update(dt);
    this.activeMonsterManagement?.update(dt);
    this.activeXpAwardDisplay?.update(dt);
  };

  private async buildScene(): Promise<void> {
    this.built = false;
    this.picking = false;
    this.hp.clear();
    this.activeMonsterManagement = undefined;
    this.monsterManagementOpening = false;
    // A rematch rebuilds the scene without recreating this BattleNode (see this class's own
    // header) -- the previous overlay controller's spawn loops are bound to the OLD
    // enemy/friendlyDisplay instances this rebuild is about to discard, so they must stop first.
    this.disposeActingCardStatusOverlays();
    this.statusOverlays?.dispose();
    this.abilityRenderer?.dispose();

    if (this.scene) {
      // A rematch replaces the scene under the same BattleNode. Source automatic presenters live
      // on CCDirector.notificationNode, so explicitly retire any presenter that outlived its scene.
      PopupHost.for(this.scene).dismissAll();
      this.pointRoot.removeChild(this.scene);
      this.scene.destroy({ children: true });
    }
    const scene = new Container();
    scene.label = "battleScene";
    scene.visible = this.enterTransitionFinished;
    scene.sortableChildren = true;
    scene.eventMode = "static";
    scene.hitArea = new Rectangle(0, 0, SCREEN_W, SCREEN_H);
    this.pointRoot.addChild(scene);
    scene.mask = this.sceneClip;
    this.scene = scene;

    const zOf = new Map<SceneChildKey, number>(sceneManifest().map((c) => [c.key, c.z]));
    const { assets, scale9 } = this.game;
    const ticker = this.stage.app.ticker;





    this.buildPhase = "background";
    const bgFull = await assets.sprite(this.encounter.backgroundKey);
    if (bgFull.width < BACKGROUND_TEXTURE_RECT_PX.w || bgFull.height < BACKGROUND_TEXTURE_RECT_PX.h) {
      throw new Error(
        `combat background ${this.encounter.backgroundKey} is ${bgFull.width}x${bgFull.height}px; ` +
          `the forced texture rect needs at least ${BACKGROUND_TEXTURE_RECT_PX.w}x${BACKGROUND_TEXTURE_RECT_PX.h}`,
      );
    }
    // 512x384pt rect, Cocos anchor (0,0) at backgroundPosCocos (iPhone: (-16,-32) immediates).
    // Cocos anchor (0,0) is the sprite's BOTTOM-LEFT corner; under the Y-down flip that corner
    // carries Pixi anchor (0,1) placed at (xCocos, SCREEN_H - yCocos) — on iPhone (-16, 352), so
    // the 384pt-tall sprite spans Pixi y[-32,352] / x[-16,496], bleeding past the 480x320 screen
    // exactly as the original does (iPad mode: exact full-screen fit, see backgroundPosCocos).
    const bg = new Sprite(
      new Texture({
        source: bgFull.source,
        frame: new Rectangle(
          BACKGROUND_TEXTURE_RECT_PX.x,
          BACKGROUND_TEXTURE_RECT_PX.y,
          BACKGROUND_TEXTURE_RECT_PX.w,
          BACKGROUND_TEXTURE_RECT_PX.h,
        ),
      }),
    );
    bg.width = BACKGROUND_SIZE.w;
    bg.height = BACKGROUND_SIZE.h;
    bg.anchor.set(0, 1);
    const bgPos = backgroundPosCocos(SCREEN_W, SCREEN_H);
    bg.position.set(bgPos.x, SCREEN_H - bgPos.y);
    bg.zIndex = zOf.get("background")!;
    scene.addChild(bg);

    this.enemyDisplay = new EnemyTeamDisplay({ multiplayer: this.multiplayer !== undefined, assets, ticker });
    this.enemyDisplay.zIndex = zOf.get("enemyTeamDisplay")!;
    scene.addChild(this.enemyDisplay);

    this.friendlyDisplay = new FriendlyTeamDisplay({ assets, ticker, profile: this.profile });
    this.friendlyDisplay.zIndex = zOf.get("friendlyTeamDisplay")!;
    scene.addChild(this.friendlyDisplay);

    const overlayHost: StatusOverlayHost = {
      monsterSpriteOf: (id) => this.enemyDisplay.monsterSpriteOf(id) ?? this.friendlyDisplay.monsterSpriteOf(id),
      attachBehindMonster: (id, node) =>
        this.enemyDisplay.attachBehindMonster(id, node) || this.friendlyDisplay.attachBehindMonster(id, node),
    };
    this.statusOverlays = new StatusOverlayController({
      assets,
      ticker,
      host: overlayHost,
      statusRandom: () => this.sourceRandom(),
    });

    this.turnOrder = new TurnOrderDisplay({ assets, ticker, provider: this.turnOrderProvider() });
    const turnOrderPos = turnOrderPosCocos(SCREEN_H);
    this.turnOrder.position.set(turnOrderPos.x, SCREEN_H - turnOrderPos.y);
    this.turnOrder.zIndex = zOf.get("turnOrderDisplay")!;
    scene.addChild(this.turnOrder);

    // StatusText (z=11) is built before AbilityRenderer so the renderer's `onMessage` can push
    // ability `message` lines straight into it.
    this.buildPhase = "status-text";
    this.statusText = await this.buildStatusText();
    this.statusText.zIndex = zOf.get("statusText")!;
    scene.addChild(this.statusText);

    this.effectLayer = new Container();
    this.effectLayer.zIndex = zOf.get("abilityRenderer")!;
    scene.addChild(this.effectLayer);
    this.abilityRenderer = new AbilityRenderer({
      gameData: this.game.gd,
      animations: this.game.anims,
      meleeAttacks: this.game.meleeAttacks,
      assets,
      audio: { playSfx: (name) => this.audio.playSfx(name) },
      effectLayer: this.effectLayer,
      ticker: this.stage.app.ticker, // shared presentation clock — see abilityRenderer.ts's header
      monsterNameOf: (shortType) => localizedRenderableName(this.game.strings, [shortType]),
      highestCapturedLevelOf: (shortType) => this.profile.highestRegisteredLevel(shortType),
      localizedString: (key) => localizedString(this.game.strings, key),
    });

    this.panel = new MonsterTurnPanel({
      assets,
      ticker,
      gestureTarget: scene,
      profile: this.profile,
      rand: () => this.sourceRandom(),
      onHeroPress: () => void this.openSpiritMenu(),
    });
    this.panel.zIndex = zOf.get("monsterTurnPanel")!;
    scene.addChild(this.panel);

    // TargetPicker: mounted over the field, reused across turns + as this port's info/locked popup
    // host. High z so its cancel button + popups float above the HUD.
    this.targetPicker = new TargetPicker({
      assets,
      ticker,
      renderer: this.stage.app.renderer,
      scale9,
      strings: this.game.strings,
      sfx: this.pickerSfx(),
    });
    this.targetPicker.zIndex = 50;
    scene.addChild(this.targetPicker);
    this.buildPhase = "scene-ready";
  }

  private async buildStatusText(): Promise<StatusTextDisplay> {
    const background = await Scale9.fromConfig(this.game.scale9, "PopupBackgroundThin", this.game.assets, {
      w: STATUS_TEXT_SIZE.w,
      h: STATUS_TEXT_SIZE.h,
    });
    const finishTexture = await this.game.assets.sprite("downArrow-hd");
    return new StatusTextDisplay({
      background,
      finishTexture,
      // Left-aligned, wrapped at exactly the box width, unbounded height — the raw label
      // construction in ChainedTextLabel (status-text-geometry.md; retires the port's prior
      // single-line centered guess).
      makeLabel: (text) =>
        makeColoredBitmapLabel(text, 20, true, {
          wordWrapWidth: STATUS_TEXT_SIZE.w,
          align: "left",
        }),
      ticker: this.stage.app.ticker,




      position: {
        x: idiomPairPt(260, 520, DISPLAY_MODE),
        y: SCREEN_H - idiomPairPt(130, 260, DISPLAY_MODE),
      },
    });
  }

  // --- session loop -------------------------------------------------------------------------

  private async submitAuthoritative(
    command: Extract<GameCommandV1, { type: `battle.${string}` }>,
  ): Promise<void> {
    await this.authority?.submit(command);
  }

  private requireAuthoritativeBattleId(): string {
    // Local mode never transports the placeholder; keeping command construction shared prevents
    // its presentation branch from drifting from the official semantic action.
    return this.authority?.battleId ?? "local-presentation";
  }

  private async loop(): Promise<void> {
    let queueInitialized = false;
    for (;;) {




      const terminal = this.pendingTerminalPresentation;
      if (terminal !== undefined) {
        this.pendingTerminalPresentation = undefined;
        this.setPresentationState("battleEndDelay");
        await this.onBattleEnded(terminal.winner, terminal.removedLivingCount, terminal.frontTeam);
        return;
      }







      const continuationRoute = this.statusText.hasText
        ? "status-text-finish"
        : "empty-status";
      if (continuationRoute === "status-text-finish") {
        battleDebug("gate", "next turn held: status text present (tap it or wait the 5s waitLimit)");
        this.statusText.showFinishNode();
      }
      const acknowledgment = await this.statusText.waitForAcknowledgment();
      if (this.lifecycle.disposed) return;
      const resumedStep = this.resumedStep;
      const eventCountBeforeAdvance = this.session.events.length;
      const step: PresentationSessionStep = resumedStep ?? this.session.advanceForPresentation();
      this.resumedStep = undefined;
      // `seedAndStart` can install passive status effects before the first actor is selected. Those
      // events have no enclosing turn for playTurn() to consume, so reconcile them at the same
      // presentation boundary. This also fixes local passive statuses, not just Official starts.
      if (resumedStep === undefined) {
        this.applyStatusOverlayEvents(this.session.events.slice(eventCountBeforeAdvance));
      }
      if (step.type === "ended") {
        this.setPresentationState("battleEndDelay");
        await this.onBattleEnded(step.report.winner, 0, this.terminalQueueFrontTeam());
        return;
      }







      const entersState2 = step.type !== "awaitingEnemy" || !step.forcedLooseTurn;
      if (entersState2) {
        this.statusText.clearStatusText();
        // Team.notifyBattleStateChangedTo: state 2 synchronously calls this on its listeners.
        // It releases stale dying-card lookup ownership without cancelling the cards' independent
        // RemoveFromParentAction tails.
        this.friendlyDisplay.notifyPlayerTurnStarted();
      }
      if (!queueInitialized) {


        await this.turnOrder.initialize();
        queueInitialized = true;
      }

      this.activeActorId = step.actorId;
      this.activeAbilityPath = null;
      this.setPresentationState("turnLeadIn");


















      const actorTeam = this.session.teamOf(step.actorId);
      const earlyFriendlyPopForward =
        step.type === "awaitingEnemy" && actorTeam === 0 && !step.forcedLooseTurn;
      if (earlyFriendlyPopForward) {
        this.startPresentationTask(
          this.friendlyDisplay.popForward(step.actorId, this.scene!, FRIENDLY_ATTACK_SPOTLIGHT_Z),
          "friendly pop-forward",
        );
      }



      await this.awaitTimeDelay(state1ContinuationDelayMs(actorTeam, continuationRoute));
      if (this.lifecycle.disposed) return;

      // A manual status finish occurs between scheduler passes. `statusTextAdvance:` has already
      // selected the new front and synchronously entered state 2/3, but player-panel construction
      // and Encounter.passTime: belong to the following BattleNode update. The 5-second auto-finish
      // runs inside ChainedTextLabel.update; that label precedes BattleNode in the priority-0 list,
      // so the later BattleNode update in the SAME scheduler pass consumes it without this wait.
      if (statusFinishWaitsForFollowingUpdate(continuationRoute, acknowledgment)) {
        await this.waitForBattleUpdate();
        if (this.lifecycle.disposed) return;
      }

      if (step.type === "awaitingEnemy") {
        const resolved = this.session.submitEnemyAction();
        // Disabled fronts share this auto-resolve path (session forces Utility.LooseTurn) for
        // either team. `automaticTurnActivationMotion` models the source state route: forced
        // LooseTurn skipped state 2, while ordinary enemy/friendly AI actions reached it.
        // Team-0 AI pop-forward already started above at state-2 entry; only enemyPulse remains.
        const motion = automaticTurnActivationMotion(actorTeam, resolved.abilityPath);
        await this.playTurn(
          resolved.events,
          resolved.actorId,
          resolved.abilityPath,
          resolved.tier,
          earlyFriendlyPopForward && motion === "friendlyPopForward" ? "none" : motion,
          resolved.slot,
        );
        if (this.battleEscaped) {
          await this.onBattleRetreated();
          return;
        }
        continue;
      }

      if (this.multiplayer) {
        // Same panel, picker, swipe handling and renderer. Only intent ownership differs.
        for (;;) {
          this.setPresentationState(actorTeam === 0 ? "awaitingPlayerChoice" : "awaitingOpponent");
          let action: import("@dib/engine").PvpAction | undefined;
          if (actorTeam === 0) {
            const selection = await this.awaitPlayerChoice(step);
            if (this.lifecycle.disposed) return;
            if (selection.kind === "cancelled") return;
            if (selection.kind === "capture" || selection.kind === "retreat") throw new Error("PvP exhibition does not accept campaign actions");
            action = selection.kind === "delay" ? { type: "delay", actorId: step.actorId } : {
              type: "ability", actorId: step.actorId, slot: selection.choice.slot,
              targets: this.submitTargetsFor(selection.choice, selection.targets),
            };
          }
          this.setPanelShown(false);
          const resolved = await this.multiplayer.resolve(step, action);
          if (this.lifecycle.disposed) return;
          if (resolved.terminal) { this.multiplayer.ended(); return; }
          if (resolved.spiritId) {
            await this.presentMultiplayerSummon(resolved.events, resolved.spiritId);
            continue;
          }
          if (!resolved.abilityPath) throw new Error("Committed PvP action omitted its ability");
          await this.playTurn(resolved.events, step.actorId, resolved.abilityPath, resolved.tier,
            automaticTurnActivationMotion(actorTeam, resolved.abilityPath), resolved.slot);
          if (this.battleEscaped) { this.multiplayer.ended(); return; }
          break;
        }
        continue;
      }

      // Player-controlled state 2 only creates the panel (`mtpNeeded`). MonsterTurnPanel starts
      // pop-forward from its queue-completion paths, after the ability/targets are committed.
      // Reaching the first decision consumes the only replay prefix that was already reflected in
      // the authority projection. Every subsequently presented turn belongs to a new submission.
      this.suppressCommittedOpeningSpiritCharge = false;
      this.setPresentationState("awaitingPlayerChoice");
      const selection = await this.awaitPlayerChoice(step);
      if (selection.kind === "cancelled" || this.lifecycle.disposed) return;
      this.setPanelShown(false);
      if (selection.kind === "capture") {
        if (this.authority !== undefined) {
          const spent = this.profile.spendCaptureCard(selection.cardLevel);
          if (!spent.ok) {
            throw new Error("BattleNode: authority accepted a capture the local wallet cannot mirror");
          }
          if (
            spent.source === "purchased" &&
            spent.cost !== undefined &&
            spent.cost.currency === "silver"
          ) {
            this.session.applyExternalSilverDebit(spent.cost.amount);
          }
        }
        const events = this.session.submitCaptureAction(
          selection.targetId,
          selection.cardLevel,
          this.profile.capturePartyLevel(),
        );
        await this.playTurn(events, step.actorId, "Utility.Capture", 4, "none");
        if (this.battleEscaped) {
          await this.onBattleRetreated();
          return;
        }
      } else if (selection.kind === "delay") {
        await this.submitAuthoritative({
          type: "battle.delay",
          battleId: this.requireAuthoritativeBattleId(),
          actorId: step.actorId,
        });


        const resolved = this.session.submitDelayAction();
        this.latestSecondaryAction = {
          abilityPath: resolved.abilityPath,
          activationLength: resolved.activationLength,
          noHaste: true,
        };
        await this.playTurn(resolved.events, step.actorId, resolved.abilityPath, undefined, "none");
        if (this.battleEscaped) {
          await this.onBattleRetreated();
          return;
        }
      } else if (selection.kind === "retreat") {
        await this.submitAuthoritative({
          type: "battle.retreat",
          battleId: this.requireAuthoritativeBattleId(),
          actorId: step.actorId,
        });
        const resolved = this.session.submitRetreatAction(30);
        this.latestSecondaryAction = resolved.success
          ? { kind: "retreat", chance: 30, success: true }
          : { abilityPath: resolved.abilityPath, chance: 30, success: false };
        if (resolved.success) {
          await this.onBattleRetreated();
          return;
        }
        // `attemptRetreatForMonster:chance:` appends this exact localized line BEFORE the queued
        // LooseTurn starts. State 1 must not advance while the status block remains visible.
        this.statusText.push(localizedString(this.game.strings, resolved.statusTextKey));
        await this.playTurn(resolved.events, step.actorId, resolved.abilityPath, 4, "none");
        if (this.battleEscaped) {
          await this.onBattleRetreated();
          return;
        }







        this.setPresentationState("retreatFailedAwaitingStatus");
      } else {
        // Ability-commit paths (`pickUsableAbility:` self-only / `notifyAbilityQueued`) start
        // showFriendlyAttackAnimationForLiving: at queue time — not at impact.
        this.startPresentationTask(
          this.friendlyDisplay.popForward(step.actorId, this.scene!, FRIENDLY_ATTACK_SPOTLIGHT_Z),
          "friendly pop-forward",
        );
        const targetIds = this.submitTargetsFor(selection.choice, selection.targets);
        await this.submitAuthoritative({
          type: "battle.chooseAbility",
          battleId: this.requireAuthoritativeBattleId(),
          actorId: step.actorId,
          slot: selection.choice.slot,
          targetIds,
        });
        this.latestPlayerSubmission = {
          actorId: step.actorId,
          slot: selection.choice.slot,
          abilityPath: selection.choice.abilityPath,
          selectedTargetIds: [...selection.targets],
          submittedTargetIds: [...targetIds],
        };
        this.playerAbilitySubmissionCount += 1;
        const events = this.session.submitPlayerAction(
          selection.choice.slot,
          targetIds,
        );
        await this.playTurn(
          events,
          step.actorId,
          selection.choice.abilityPath,
          selection.choice.tier,
          "none",
          selection.choice.slot,
        );
        if (this.battleEscaped) {
          await this.onBattleRetreated();
          return;
        }
      }
    }
  }








  private async playTurn(
    events: BattleEvent[],
    actorId: string,
    abilityPath: string,
    tier: number | undefined,
    activationMotion: AutomaticTurnActivationMotion,
    slot?: string,
    opts?: { skipSourceEffects?: boolean },
  ): Promise<void> {
    if (this.authority === undefined) settleLocalBattleWalletEvents(this.profile, events);
    const turnOrderEntries = this.turnOrder.liveEntryState;
    const turnOrderIdsAtTurnStart = new Set(turnOrderEntries.map((entry) => entry.id));
    this.turnOrderAtTurnStart = {
      displayedQueue: [...this.turnOrder.displayedOrder],
      delayText: Object.fromEntries(turnOrderEntries.map((entry) => [entry.id, entry.delayText])),
    };
    battleDebug(
      "turn",
      `${this.session.shortTypeOf(actorId)} (${actorId}) performs ${abilityPath}` +
        ` [tier=${tier ?? "-"} motion=${activationMotion} ${events.length} events]`,
    );
    for (const e of events) battleDebug("turn", `  event: ${describeEvent(e as unknown as Record<string, unknown>)}`);
    // The AttackAbilityComponent's stamped meleeType (formulas.md row 35) — resolves the plain
    // attacks' MeleeAttacks animation + sound (see RenderResultOpts.meleeKey).
    const meleeKey = attackTypeForUse(this.game.gd, this.session.shortTypeOf(actorId), {
      ...(slot !== undefined ? { slot } : {}),
      abilityPath,
    });
    // The instance's ARGUMENTS-FIRST sound table (soundTableForUse doc — job-ref override
    // replaces the ability dictionary's table; how BlackHole reaches GammaBurst.m4a instead of
    // the Stun dictionary's Glacier.m4a).
    const soundTable = soundTableForUse(this.game.gd, this.session.shortTypeOf(actorId), {
      ...(slot !== undefined ? { slot } : {}),
      abilityPath,
    });








    const delayMs = this.phaseStartDelayMs(abilityPath);




    const rosterAssetWarmups = this.startRosterAssetWarmups(events);
    this.activeAbilityPath = abilityPath;
    // `notifyAbilityTargetAlteredToMonster:` is queue-time feedback: its unoutlined localized
    // "Blocked" floater starts before the target phase's impact delay.
    this.startPresentationTask(
      this.abilityRenderer.renderQueuedEffects(events, this.nodeLookup),
      "queued target-altered effects",
    );
    if (opts?.skipSourceEffects !== true) {
      this.startPresentationTask(
        this.abilityRenderer.renderSourceEffects(actorId, this.nodeLookup, { abilityPath, tier }),
        "ability source effects",
      );
    }









    const sourceStatusKey = (() => {
      const eventData = this.game.gd.ability(abilityPath).raw["eventData"];
      const sourceDict = (eventData as Record<string, unknown> | undefined)?.["sourceEventData"];
      const key = (sourceDict as Record<string, unknown> | undefined)?.["statusTextLocalizationKey"];
      return typeof key === "string" ? key : undefined;
    })();
    if (sourceStatusKey !== undefined) {
      const line = abilityStatusTextLine(
        this.game.strings,
        sourceStatusKey,
        localizedRenderableName(this.game.strings, [this.session.shortTypeOf(actorId)]),
      );
      battleDebug("status", `${abilityPath} source-phase ${sourceStatusKey}: "${line}"`);
      this.statusText.push(line);
    }
    if (activationMotion === "enemyPulse") {



      this.startPresentationTask(
        this.enemyDisplay.notifyActivatedAbility(actorId),
        "enemy ability activation pulse",
      );
    } else if (activationMotion === "friendlyPopForward") {
      // Team-0 AI (spirit/Berserk) starts this at state-2 entry *before* the 1.0s pacing sleep
      // in `loop()` (matching `notifyBattleStateChangedTo:` case 2 before timeDelay). This branch
      // remains for any caller that still requests the motion at ability start (none today for
      // the AI route). Player-controlled ability-commit paths start pop-forward from the panel
      // callbacks above and pass activationMotion "none" here.
      this.startPresentationTask(
        this.friendlyDisplay.popForward(actorId, this.scene!, FRIENDLY_ATTACK_SPOTLIGHT_Z),
        "friendly pop-forward",
      );
    }
    this.setPresentationState("phaseDelay");
    if (delayMs > 0) await this.sleep(delayMs);
    if (this.lifecycle.disposed) return;
    this.setPresentationState("impact");
    this.applyAbilityEvents(events);
    this.applyPresentedSpiritReadiness(events);
    this.applyHp(events);
    this.fireEnemyDefeatQuestEvents(events);
    // Persistent status overlays (status-effects.md §7 item 3) are driven from THIS SAME
    // per-turn event replay, at presentation/impact time -- not instantly at engine-resolution
    // time, matching every other impact-bundle piece above/below this line.
    this.applyStatusOverlayEvents(events);








    const effect = this.abilityRenderer.renderResult(events, this.nodeLookup, {
      abilityPath,
      tier,
      soundTable,
      ...(meleeKey !== undefined ? { meleeKey } : {}),
    });
    await this.applyRosterEvents(events, rosterAssetWarmups);
    if (this.lifecycle.disposed) return;








    const postAdvanceQueue = this.session.queueOrder();
    const addedTurnOrderIds = postAdvanceQueue.filter((id) => !turnOrderIdsAtTurnStart.has(id));
    // The queue the source's add listener reads -- see `preAdvanceQueueProjection`.
    const preAdvanceQueue = preAdvanceQueueProjection(actorId, postAdvanceQueue);
    const turnOrderPlan = turnOrderResolutionPlan(events);
    // Deaths/captures only: this drives `handleDeaths` and the terminal state's living-removal
    // pacing, neither of which a switch-out participates in.
    const removalCount = turnOrderPlan.removedIds.length;
    const terminalWinner = terminalPresentationWinner(events, this.battleEscaped);
    if (terminalWinner !== undefined) {
      this.pendingTerminalPresentation = {
        winner: terminalWinner,
        removedLivingCount: removalCount,






        frontTeam: this.terminalQueueFrontTeam(),
      };
    }
    const deaths = removalCount > 0 ? this.handleDeaths(events) : Promise.resolve();








    const queueCommit = turnOrderPlan.terminal
      ? this.turnOrder.freezeTerminalRemoval(turnOrderPlan.teamRemovedIds, {
          captureSuccessIds: turnOrderPlan.captureSuccessIds,
        })
      : this.commitTurnOrderForTurn(turnOrderPlan, addedTurnOrderIds, preAdvanceQueue);
    const presentationSettled = Promise.all([effect, deaths, queueCommit]);
    // Historical safety net, retained deliberately. It predates the source-event split and used to
    // compensate for one-shot sidebar motion racing a fast action; every ordinary notification now
    // ends in a LIVE `warpNodesExcludingObject:` read, so by the time this runs the column is
    // already converged and the extra pass moves nothing (`startWarpMoves` skips zero-delta
    // moves). Keep it until a browser trace shows `turnOrderCounters` never changing across it,
    // then delete it rather than letting it mask a missing roster event.
    this.startPresentationTask(
      turnOrderPlan.terminal
        ? presentationSettled.then(() => undefined)
        : presentationSettled.then(() => this.turnOrder.notifyBattleTimePassed()),
      turnOrderPlan.terminal ? "terminal turn presentation" : "turn presentation reconciliation",
    );

    if (removalCount > 0) {
      this.setPresentationState("deathResolution");
      // Continuing turns must exhaust the shared BattleNode timeDelay before state 1 can advance.
      // Terminal victory carries the same contribution into terminalPresentationDelayMs; defeat
      // uses Encounter's independent 1.5s action and ignores BattleNode.timeDelay in state 5.
      if (!turnOrderPlan.terminal) {



        await this.awaitTimeDelay(removalLogicHoldMs(removalCount));
        if (this.lifecycle.disposed) return;
      }
    }
    // Native's team listeners hand back a fully built widget on the resolution call stack; this
    // port's are async texture resolves started above as free-standing presentation tasks. Join
    // the CONSTRUCTION half here so no turn can end with a live id that `nodeOf` cannot resolve
    // (the next panel's capture hosts / target picking read every live enemy). The deferred
    // entrance animations are NOT joined and keep running past this point.
    await this.settleDisplayRegistrations();
    if (this.lifecycle.disposed) return;
    if (!turnOrderPlan.terminal) this.setPresentationState("turnComplete");
    // NOTE: no trailing pacing here — the state-1 pacing precedes the NEXT actor's turn and is
    // keyed on that actor's team (see loop()'s citation).
  }

  /** The ability's populated target phase's `startDelay` in ms (formulas.md row 34: the key
   *  exists on `eventData.(enemy|friendly)TargetEventData`; default 0.5 when the dict exists but
   *  omits it; 0 when the ability has no target phase at all). Real abilities populate exactly
   *  one of the two dicts (row 34's scan). */
  private phaseStartDelayMs(abilityPath: string): number {
    const raw = this.game.gd.ability(abilityPath).raw;
    const eventData = raw["eventData"];
    if (eventData === null || typeof eventData !== "object") return 0;
    for (const key of ["enemyTargetEventData", "friendlyTargetEventData"]) {
      const phase = (eventData as Record<string, unknown>)[key];
      if (phase !== null && typeof phase === "object") {
        const sd = (phase as Record<string, unknown>)["startDelay"];
        return (typeof sd === "number" ? sd : 0.5) * 1000;
      }
    }
    return 0;
  }

  private awaitPlayerChoice(
    step: Extract<PresentationSessionStep, { type: "awaitingPlayer" }>,
  ): Promise<
    | { kind: "ability"; choice: PlayerChoice; targets: string[] }
    | { kind: "capture"; targetId: string; cardLevel: CaptureCardLevel }
    | { kind: "delay" }
    | { kind: "retreat" }
    | { kind: "cancelled" }
  > {
    this.latestSwipeTargetFeedback = null;
    this.latestPlayerSubmission = null;
    return new Promise((resolve, reject) => {
      const actorSnap = this.friendlySnapshotOf(step.actorId);
      let settled = false;
      const clearPendingCancel = (): void => {
        this.cancelPendingChoice = undefined;
      };
      this.cancelPendingChoice = () => {
        if (settled) return;
        settled = true;
        clearPendingCancel();
        resolve({ kind: "cancelled" });
      };
      const finish = (choice: PlayerChoice, targets: string[]): void => {
        if (settled || this.multiplayer?.busy) return;
        settled = true;
        clearPendingCancel();
        resolve({ kind: "ability", choice, targets });
      };

      this.panel.onPick((choice, via, gestureMidpoint) => {
        // Tap reaches here only for self-targeting (auto-queued, no picker); swipe reaches here for
        // any swipeable ability and fires against the ability's default valid target(s), which the
        // panel has no data to resolve (monsterTurnPanel.ts's handleSwipe doc) — resolved here.
        const targets = via === "swipe" ? this.defaultTargets(choice, gestureMidpoint) : [];




        const kind = choice.targeting.kind;
        if (via === "swipe" && (kind === "enemies" || kind === "allEnemies") && targets.length === 0) {
          this.latestSwipeTargetFeedback = "notAllowed";
          this.swipeTargetFeedbackCount += 1;
          this.audio.playSfx("notAllowed");
          return;
        }
        finish(choice, targets);
      });
      this.panel.onNeedsTargets((choice) => {
        if (settled || this.multiplayer?.busy) return;
        this.picking = true;
        this.friendlyDisplay.setSummonSelectMode(true);
        this.setPresentationState("targetPicking");
        // Target picking happens over the open FIELD: the panel hides and the friendly row
        // returns (the original's `hideButtons`/`setVisible:0`, turn-panel.md §9).
        this.setPanelShown(false);
        void this.targetPicker.begin(
          choice,
          this.targetRefs(this.aliveIdsOnTeam(1)),
          this.targetRefs(this.aliveIdsOnTeam(0)),
          (targets) => {
            this.picking = false;
            this.friendlyDisplay.setSummonSelectMode(false);
            this.setPresentationState("abilityQueued");
            finish(choice, targets);
          },
          () => {
            // Cancelled — back to the ability buttons for the same actor.
            this.picking = false;
            this.friendlyDisplay.setSummonSelectMode(false);
            this.setPresentationState("awaitingPlayerChoice");



            if (settled) return;
            void this.showPanel(actorSnap, step.choices);
          },
        );
      });
      this.panel.onInfo((choice) => {
        if (this.picking) return;
        const entry = this.roster.entryOf(step.actorId);
        const model = buildAbilityInfoModel(
          this.game.gd,
          this.game.strings,
          entry.setup.shortType,
          choice,
          this.abilityInfoContext(step.actorId),
        );
        void this.targetPicker.showAbilityInfo(model);
      });
      this.panel.onLockedTap(() => void this.targetPicker.showLockedAbilityPopup());
      this.panel.onBlockedTap((choice) => {
        if (choice.blockReason === undefined) throw new Error("BattleNode: blocked panel choice lacks blockReason");
        void this.targetPicker.showMessagePopup(choice.blockReason);
      });
      this.panel.onCaptureTap((targetId) => {
        // A panel build resolves assets asynchronously, so never trust a rendered hit proxy as
        // authority. `capturePressed:` still opens the chooser for nonzero capture status;
        // `capture:` owns the final rejection without spending a card.
        if (!this.activeCapturePopup && this.capturePopupKind === null && !settled) {
          void this.openCaptureChooser(
            step.actorId,
            targetId,
            (cardLevel) => {
              if (settled) return;
              settled = true;
              clearPendingCancel();
              resolve({ kind: "capture", targetId, cardLevel });
            },
            (error) => {
              if (settled) return;
              settled = true;
              clearPendingCancel();
              reject(error);
            },
          );
        }
      });
      this.panel.onDelayTap(() => {
        if (settled || this.multiplayer?.busy || this.secondaryPopupKind !== null) return;
        const commit = (): void => {
          if (settled) return;
          this.hasConfirmedSkip = true;
          settled = true;
          clearPendingCancel();
          resolve({ kind: "delay" });
        };
        if (this.hasConfirmedSkip) {
          commit();
        } else {
          void this.showSecondaryConfirmation("ConfirmTurnSkip", "confirmSkip", commit);
        }
      });
      this.panel.onRetreatTap(() => {
        if (this.multiplayer) { this.requestMultiplayerForfeit(); return; }
        if (settled || this.secondaryPopupKind !== null) return;
        if (this.encounter.allowRetreat !== true) {
          void this.showSecondaryMessage("NoRetreat", "noRetreat");
          return;
        }
        void this.showSecondaryConfirmation("ConfirmRetreat", "confirmRetreat", () => {
          if (settled) return;
          settled = true;
          clearPendingCancel();
          resolve({ kind: "retreat" });
        });
      });
      this.panel.onBenchTap(() => {





        if (settled || this.multiplayer?.busy || this.secondaryPopupKind !== null) return;
        if (this.activeMonsterManagement || this.monsterManagementOpening) return;
        if (this.session.benchCountOf(0) === 0) {
          void this.showSecondaryMessage("NoBattingOrder", "noBattingOrder");
          return;
        }
        void this.openReserveManagement(0).catch((error: unknown) => {
          console.error("MonsterManagementNode failed to open", error);
          queueMicrotask(() => { throw error; });
        });
      });

      void this.showPanel(actorSnap, step.choices);
    });
  }








  private async showPanel(actor: FriendlySnapshot, choices: readonly PlayerChoice[]): Promise<void> {










    const captureHosts = this.aliveIdsOnTeam(1)
      .filter((id) => this.session.captureStatusOf(id) === "available")
      .map((id) => ({
        id,
        node: this.enemyDisplay.nodeOf(id),


        isNew: !this.collection.hasCapturedSimpleType(
          battleOriginalShortType(this.roster.entryOf(id).setup),
        ),
      }));





    const localizedChoices = choices.map((choice) => ({
      ...choice,
      displayName: localizedRenderableName(this.game.strings, [
        choice.displayName,
        choice.abilityPath.split(".").at(-1)!,
      ]),
    }));
    // Tear down the previous acting card's overlays BEFORE panel.show destroys that card (its
    // ticker-bound poison spawn loop must be stopped, not orphaned onto a destroyed node).
    this.disposeActingCardStatusOverlays();
    await this.panel.show(actor, localizedChoices, {
      captureHosts,
      newLabelText: localizedString(this.game.strings, "NewKey"),
    });
    if (this.lifecycle.disposed) return;
    // Register the freshly-built acting card as its own status-effect listener so an already-
    // poisoned/slept/paralyzed/confused actor shows its overlay on the bottom-left portrait — the
    // only visible friendly card while the panel hides the field row (status-effects.md §1).
    const actingHost = this.panel.actingCardStatusHost();
    if (actingHost) this.actingCardOverlayDisposer = this.statusOverlays.addHost(actingHost.host);
    this.friendlyDisplay.visible = false;
  }

  /** PvP's existing retreat control ends the exhibition only after native confirmation. */
  requestMultiplayerForfeit(): void {
    if (!this.multiplayer || this.multiplayer.busy || this.lifecycle.disposed || !this.built ||
      !["awaitingPlayerChoice", "awaitingOpponent"].includes(this.presentationState)) return;
    void this.showSecondaryConfirmation("ConfirmRetreat", "confirmRetreat", () => this.multiplayer?.forfeit());
  }

  /** Route shell Back through the same popup/picker ownership as keyboard Escape. */
  requestMultiplayerBack(): void {
    if (this.multiplayer) this.handleKeyboardShortcut({ key: "escape" });
  }

  /** Native MonsterHatchPopup yes/no family used by both toolbar confirmations. */
  private async showSecondaryConfirmation(
    messageName: "ConfirmTurnSkip" | "ConfirmRetreat",
    kind: "confirmSkip" | "confirmRetreat",
    onYes: () => void,
  ): Promise<void> {
    if (this.secondaryPopupKind !== null || !this.scene) return;
    const previousState = this.presentationState;
    this.secondaryPopupKind = kind;
    this.setPresentationState(kind === "confirmSkip" ? "skipTurnConfirmation" : "retreatConfirmation");
    let popup: Popup | undefined;
    popup = await showMonsterHatchPopup(this.monsterHatchEnvironment(this.scene), {
      title: this.multiplayer && kind === "confirmRetreat" ? "Surrender?" : localizedString(this.game.strings, `${messageName}TitleKey`),
      content: this.multiplayer && kind === "confirmRetreat"
        ? buildMonsterHatchMessageContent("Surrender this match? Your opponent will win.")
        : buildLocalizedMonsterHatchMessageContent(this.game.strings, messageName),
      buttons: [
        { label: localizedString(this.game.strings, "YesButtonKey"), onPress: onYes },
        { label: localizedString(this.game.strings, "NoButtonKey"), onPress: () => {} },
      ],
      onDismiss: () => {
        if (this.activeSecondaryPopup === popup) this.activeSecondaryPopup = undefined;
        if (this.secondaryPopupKind === kind) this.secondaryPopupKind = null;
        if (this.presentationState === "skipTurnConfirmation" || this.presentationState === "retreatConfirmation") {
          this.setPresentationState(previousState);
        }
      },
    });
    if (this.lifecycle.disposed) { popup.dismiss(); return; }
    this.activeSecondaryPopup = popup;
  }




  private async showSecondaryMessage(
    messageName: "NoRetreat" | "NoBattingOrder",
    kind: "noRetreat" | "noBattingOrder",
  ): Promise<void> {
    if (this.secondaryPopupKind !== null || !this.scene) return;
    this.secondaryPopupKind = kind;
    const state = kind === "noRetreat" ? "noRetreatMessage" : "noBattingOrderMessage";
    this.setPresentationState(state);
    let popup: Popup | undefined;
    popup = await showMonsterHatchPopup(this.monsterHatchEnvironment(this.scene), {
      title: localizedString(this.game.strings, `${messageName}TitleKey`),
      content: buildLocalizedMonsterHatchMessageContent(this.game.strings, messageName),
      buttons: [{ label: localizedString(this.game.strings, "OkButtonKey"), onPress: () => {} }],
      onDismiss: () => {
        if (this.activeSecondaryPopup === popup) this.activeSecondaryPopup = undefined;
        if (this.secondaryPopupKind === kind) this.secondaryPopupKind = null;
        if (this.presentationState === state) this.setPresentationState("awaitingPlayerChoice");
      },
    });
    this.activeSecondaryPopup = popup;
  }

  private async handleEnemyBenchTap(
    result: "analyzeNotReady" | "noMonstersToAnalyze" | "showReserves",
  ): Promise<void> {
    if (result === "showReserves") return; // mounted by openEnemyReserveManagement
    const messageName = result === "analyzeNotReady" ? "AnalyzeNotReady" : "NoMonstersToAnalyze";
    if (this.analyzePopupKind !== null || !this.scene) return;
    this.analyzePopupKind = result;
    let popup: Popup | undefined;
    popup = await showMonsterHatchPopup(this.monsterHatchEnvironment(this.scene), {
      title: localizedString(this.game.strings, `${messageName}TitleKey`),
      content: buildLocalizedMonsterHatchMessageContent(this.game.strings, messageName),
      buttons: [{ label: localizedString(this.game.strings, "OkButtonKey"), onPress: () => {} }],
      onDismiss: () => {
        if (this.activeAnalyzePopup === popup) this.activeAnalyzePopup = undefined;
        if (this.analyzePopupKind === result) this.analyzePopupKind = null;
      },
    });
    this.activeAnalyzePopup = popup;
  }












  private async openReserveManagement(team: 0 | 1): Promise<void> {
    if (this.activeMonsterManagement || this.monsterManagementOpening || !this.scene) return;
    const sceneAtStart = this.scene;
    const reserveIds = this.session.benchIdsOf(team);
    if (reserveIds.length === 0) {
      // Both callers own their no-reserves branch (AnalyzeNotReady gating / NoBattingOrder
      // popup) and should never route here with an empty replacementMembers list. Keep a
      // race/schema error loud instead of fabricating an empty UI.
      throw new Error(`MonsterManagementNode: reached with no team-${team} replacementMembers`);
    }
    this.monsterManagementOpening = true;
    const entries: MonsterManagementEntry[] = reserveIds.map((id) => {
      const roster = this.roster.entryOf(id);
      const monster = this.game.gd.monsterByShortType(roster.setup.shortType);
      const rendererScale = rendererScaleOf(roster.setup.rendererData ?? monster.rendererData);
      const predecessors = this.game.gd.allMonsters().filter(
        (candidate) => candidate.evolveData?.newType === monster.shortType,
      );
      if (predecessors.length > 1) {
        throw new Error(
          `MonsterManagementNode: ${monster.shortType} has multiple evolution predecessors: ` +
            predecessors.map((candidate) => candidate.shortType).join(", "),
        );
      }
      const entry: MonsterManagementEntry = {
        id,
        shortType: monster.shortType,
        level: roster.setup.level,
        stars: monster.stars,
        element: monster.element,
        ...(roster.setup.soulStone === undefined
          ? {}
          : { soulStoneElement: roster.setup.soulStone.element }),
        ...(rendererScale !== undefined ? { rendererScale } : {}),
      };
      if (monster.evolveData) {
        entry.evolveLevel = monster.evolveData.levelReq;
        entry.previousEvolveLevel = predecessors[0]?.evolveData?.levelReq ?? 1;
      }
      return entry;
    });

    const managementState = team === 1 ? "enemyReserveManagement" : "friendlyReserveManagement";
    let management: MonsterManagementNode | undefined;
    try {
      management = await createMonsterManagementNode({
        assets: this.game.assets,
        strings: this.game.strings,
        style: 4,
        entries,
        onClose: () => {
          if (this.activeMonsterManagement === management) this.activeMonsterManagement = undefined;
          if (this.presentationState === managementState) {
            this.setPresentationState("awaitingPlayerChoice");
          }
        },
        onInspect: (id) => void this.openLivingInfo(id),


        onElementHelp: (element) => void this.targetPicker.showElementInfo(element as ElementHelpName),
      });
      if (this.lifecycle.disposed || this.scene !== sceneAtStart) {
        management.destroy({ children: true });
        return;
      }
      this.activeMonsterManagement = management;
      sceneAtStart.addChild(management);
      this.setPresentationState(managementState);
    } finally {
      this.monsterManagementOpening = false;
    }
  }

  private async openCaptureChooser(
    actorId: string,
    targetId: string,
    finish: (cardLevel: CaptureCardLevel) => void,
    fail: (error: unknown) => void,
  ): Promise<void> {
    if (this.activeCapturePopup || !this.scene) return;
    const partyLevel = this.profile.capturePartyLevel();
    const status = this.session.captureStatusOf(targetId);
    this.capturePopupKind = "captureChooser";
    this.setPresentationState("captureCardChoice");
    let popup: Popup | undefined;
    popup = await showCaptureCardPopup({
      parent: this.scene,
      assets: this.game.assets,
      scale9: this.game.scale9,
      ticker: this.stage.app.ticker,
      strings: this.game.strings,
      inventory: this.profile.snapshot(),
      options: ([1, 2, 3] as const).map((level) => ({
        level,
        status,
        chance: this.session.captureChanceOf(targetId, level, partyLevel),
      })),
      onChoose: (level) => {
        if (this.capturePurchasePending) return;
        // `capture:` rechecks status and exact nonzero chance at invocation time.
        if (
          this.session.captureStatusOf(targetId) !== "available" ||
          this.session.captureChanceOf(targetId, level, partyLevel) === 0
        ) {
          this.audio.playSfx("notAllowed");
          return;
        }
        if (this.authority === undefined) {
          const spent = this.profile.spendCaptureCard(level);
          if (!spent.ok) {
            popup?.dismiss();
            this.activeCapturePopup = undefined;
            this.capturePopupKind = null;
            void this.handleCaptureCannotAfford().catch((error: unknown) => {
              fail(error);
            });
            return;
          }
          mirrorLocalCapturePurchaseToBattleWallet(this.session, spent);
        } else {
          this.capturePurchasePending = true;
          void this.submitAuthoritative({
            type: "battle.attemptCapture",
            battleId: this.requireAuthoritativeBattleId(),
            actorId,
            targetId,
            cardLevel: level,
          }).then(() => {
            if (this.lifecycle.disposed) return;
            popup?.dismiss();
            this.activeCapturePopup = undefined;
            this.capturePopupKind = null;
            this.setPresentationState("abilityQueued");
            finish(level);
          }).catch((error: unknown) => {
            if (this.lifecycle.disposed) return;
            if (error instanceof RemoteGameAuthorityError && error.code === "INSUFFICIENT_FUNDS") {
              popup?.dismiss();
              this.activeCapturePopup = undefined;
              this.capturePopupKind = null;
              return this.handleCaptureCannotAfford();
            }
            fail(error);
          }).finally(() => { this.capturePurchasePending = false; });
          return;
        }
        popup?.dismiss();
        this.activeCapturePopup = undefined;
        this.capturePopupKind = null;
        this.setPresentationState("abilityQueued");
        finish(level);
      },
      onCancel: () => {
        this.activeCapturePopup = undefined;
        this.capturePopupKind = null;
        this.setPresentationState("awaitingPlayerChoice");
      },
      sfx: this.popupSfx(),
      onDismiss: () => {
        if (this.activeCapturePopup === popup) this.activeCapturePopup = undefined;
      },
    });
    // The Popup is already mounted and interactive while `Popup.show` awaits its 0.2s pop-in.
    // A card choice can therefore resolve the logical chooser while the local `popup` binding is
    // still undefined in `onChoose` above. Reconcile that early decision after the await instead
    // of resurrecting the spent chooser underneath later automatic popups.
    if (popup.isDismissed || this.capturePopupKind !== "captureChooser" || !this.scene) {
      if (!popup.isDismissed) popup.dismiss();
      return;
    }
    this.activeCapturePopup = popup;
  }

  private async showCannotAffordPopup(): Promise<void> {
    if (!this.scene) return;
    this.capturePopupKind = "cannotAfford";
    this.setPresentationState("captureCannotAfford");
    let popup: Popup | undefined;
    popup = await Popup.show(this.scene, {
      assets: this.game.assets,
      scale9: this.game.scale9,
      ticker: this.stage.app.ticker,
      title: localizedString(this.game.strings, "CannotAffordThingTitleKey"),
      content: (() => {
        const content = new Container();
        const label = makeTtfLabel(
          localizedString(this.game.strings, "CannotAffordThingMessageKey"),
          16,
          { outline: false },
        );
        content.addChild(label);
        return content;
      })(),
      buttons: [
        {
          label: localizedString(this.game.strings, "OkButtonKey"),
          onPress: () => { this.capturePopupKind = null; },
        },
      ],
      dismissOnTap: false,
      zIndex: 1000,
      sfx: this.popupSfx(),
      onDismiss: () => {
        if (this.activeCapturePopup === popup) this.activeCapturePopup = undefined;
      },
    });
    this.activeCapturePopup = popup;
  }

  private async handleCaptureCannotAfford(): Promise<void> {
    const openStore = this.openGoldStore;
    if (openStore === undefined) {
      throw new Error("BattleNode: capture insufficient funds requires a category-3 Store handoff");
    }
    await runInsufficientFundsStoreHandoff({
      openStore,
      presentCannotAfford: () => this.showCannotAffordPopup(),
      resume: () => {
        if (this.lifecycle.disposed) return;
        this.capturePopupKind = null;
        this.setPresentationState("awaitingPlayerChoice");
      },
    });
  }

  private setPanelShown(shown: boolean): void {
    if (!shown) {
      this.panel.hide();
      this.disposeActingCardStatusOverlays();
    }
    this.friendlyDisplay.visible = !shown;
  }



  private disposeActingCardStatusOverlays(): void {
    this.actingCardOverlayDisposer?.();
    this.actingCardOverlayDisposer = undefined;
  }

  private async onBattleRetreated(): Promise<void> {
    if (!this.scene) return;
    if (this.multiplayer) { this.multiplayer.ended(); return; }
    this.setPresentationState("retreated");
    this.commitTripTerminalState();
    // `attemptRetreatForMonster:chance:` success: Battle state 6 + `Escape.m4a`.
    this.audio.playSfx("Escape");
    // Teardown, not acknowledgment: hiding alone would strand a non-empty `currentStatusText`
    // now that visibility no longer implies emptiness.
    this.teardownCombatMonstersForReturn();






    await this.showLostCaptures();
    if (this.lifecycle.disposed || !this.scene) return;

    // The popup carries the exact shipped chat line; its button returns world-owned battles to
    // navigation and retains Rematch only for direct fixtures.
    const content = new Container();
    content.addChild(makeTtfLabel(localizedString(this.game.strings, "RetreatChatKey"), 16, { outline: false }));
    this.secondaryPopupKind = "retreated";
    let popup: Popup | undefined;
    popup = await Popup.show(this.scene, {
      assets: this.game.assets,
      scale9: this.game.scale9,
      ticker: this.stage.app.ticker,
      content,
      buttons: [
        {
          label: this.onExit ? localizedString(this.game.strings, "OkButtonKey") : "Rematch",
          onPress: () => this.finishBattle("retreat"),
        },
      ],
      dismissOnTap: false,
      zIndex: 1000,
      sfx: this.popupSfx(),
      onDismiss: () => {
        if (this.activeSecondaryPopup === popup) this.activeSecondaryPopup = undefined;
        if (this.secondaryPopupKind === "retreated") this.secondaryPopupKind = null;
      },
    });
    this.activeSecondaryPopup = popup;
  }




  private terminalQueueFrontTeam(): 0 | 1 | undefined {
    const frontId = this.session.queueOrder()[0];
    return frontId === undefined ? undefined : this.session.teamOf(frontId);
  }

  private async onBattleEnded(
    winner: 0 | 1 | "draw",
    removedLivingCount: number,
    frontTeam: 0 | 1 | undefined,
  ): Promise<void> {







    if (winner === "draw") throw new Error("BattleNode: the source has no post-battle draw display");
    const terminalDelay = terminalPresentationDelayMs(winner, removedLivingCount, frontTeam);






    if (winner === 0) await this.awaitTimeDelay(terminalDelay);
    else await this.sleep(terminalDelay);
    if (this.lifecycle.disposed) return;
    this.setPresentationState("battleEnded");
    const won = winner === 0;
    if (this.multiplayer) {
      if (won) this.playMusicTrack("Win", 1, false);
      this.multiplayer.ended();
      return;
    }
    this.commitTripTerminalState();





    if (won) this.playMusicTrack("Win", 1, false);






    if (won) {
      // The source state-4 award branch clears old combat status immediately before
      // performAwardLogic; terminal state never waits for state 1's finish arrow.
      this.statusText.clearStatusText();
      await this.showXpAwardPopup();
    } else await this.showReturnToTownPopup();
  }

  private postBattleRestart(): void {





    void this.performWinLogic();
  }









  private async performWinLogic(): Promise<void> {
    await this.sleep(ENCOUNTER_WIN_LOGIC_DELAY_MS);
    if (this.lifecycle.disposed) return;
    this.onQuestEvent?.({
      id: 9,
      battle: {
        ...(this.encounter.questKey === undefined ? {} : { questKey: this.encounter.questKey }),
        ...(this.encounter.uniqueKey === undefined ? {} : { uniqueKey: this.encounter.uniqueKey }),
        friendlyTeamCount: this.session.activeIdsOf(0).length,
        battingOrderSize: this.tripParty?.battingOrderSize ?? this.encounter.playerTeam.length,
        difficultyModifier: this.encounter.difficultyModifier ?? 0,
      },
    });
    this.awardTripCaptures();
    await this.showEncounterChat(this.encounter.winChat, "winEvent");
    if (this.lifecycle.disposed) return;
    // `combatVictoryFinished:`: navigation-owned battles return to their world while direct
    // fixtures retain the historical rematch fallback.
    this.finishBattle("victory");
  }

  private async showEncounterChat(
    chat: ChatDefinition | undefined,
    state: "startEvent" | "winEvent",
    onFirstPresentationReady: () => void = () => {},
  ): Promise<void> {
    if (
      chat === undefined ||
      !this.scene ||
      !this.requestChatPresentation(chat.name, chat.alwaysShow)
    ) {
      onFirstPresentationReady();
      return;
    }
    const keys = chat.messageKeys.length === 0 ? [`${chat.name}ChatKey`] : chat.messageKeys;
    for (const [index, key] of keys.entries()) {
      if (this.lifecycle.disposed || !this.scene) return;
      this.setPresentationState(state);
      let handle: GuildQuestChatHandle | undefined;
      handle = await showGuildQuestChat({
        parent: this.scene,
        assets: this.game.assets,
        scale9: this.game.scale9,
        ticker: this.stage.app.ticker,
        message: localizedString(this.game.strings, key),
        ...(chat.imageFile === undefined ? {} : { portraitFile: chat.imageFile }),
        onDismiss: () => {
          if (this.activeEncounterChat === handle) this.activeEncounterChat = undefined;
        },
      });
      this.activeEncounterChat = handle;
      if (index === 0) onFirstPresentationReady();
      await handle.closed;
    }
  }

  /** Captured source simple types for dungeon catch-quest bookkeeping at the terminal boundary. */
  capturedShortTypes(): readonly string[] {
    return Object.freeze(this.session.capturedIds().map((id) =>
      battleOriginalShortType(this.roster.entryOf(id).setup)));
  }







  private notifyCommittedTerminal(outcome: BattleExitOutcome): void {
    if (this.onCommittedTerminal === undefined) return;
    try {
      void Promise.resolve(this.onCommittedTerminal(outcome)).catch((error: unknown) => {
        console.error("BattleNode committed-terminal notification failed", error);
      });
    } catch (error: unknown) {
      console.error("BattleNode committed-terminal notification failed", error);
    }
  }

  /** Original dungeon-enemy construction indices still alive at a terminal battle boundary.
   * Active and reserve membership are read from BattleSession; captured/dead members have already
   * left those collections, while mid-battle summons are excluded from the dungeon room model. */
  terminalEnemyConstructionIndices(): readonly number[] {
    const activeIds = new Set(this.session.activeIdsOf(1));
    const reserveIds = new Set(this.session.benchIdsOf(1));
    return projectOriginalEnemySurvivorConstructionIndices([
      ...[...activeIds].map((id) => {
        const entry = this.roster.entryOf(id);
        return Object.freeze({
          constructionIndex: entry.constructionIndex,
          createdMidBattle: entry.createdMidBattle,
          status: "active" as const,
        });
      }),
      ...[...reserveIds].map((id) => {
        const entry = this.roster.entryOf(id);
        return Object.freeze({
          constructionIndex: entry.constructionIndex,
          createdMidBattle: entry.createdMidBattle,
          status: "reserve" as const,
        });
      }),
    ]);
  }

  private displayNameOf(id: string): string {
    const setup = this.roster.entryOf(id).setup;
    return setup.displayName ?? localizedRenderableName(this.game.strings, [setup.shortType]);
  }

  /** Scene-transition ownership only; input/ticker state remains alive while hidden. */
  setSceneVisible(visible: boolean): void {
    this.pointRoot.visible = visible;
    this.keyboardActive = visible;
  }





  notifyEnterTransitionDidFinish(): void {
    if (this.enterTransitionFinished) return;
    this.enterTransitionFinished = true;
    this.resolveEnterTransition();
  }

  private readonly handleKeyboardShortcut = ({ key }: Pick<KeyboardShortcut, "key">): boolean => {
    if (!this.keyboardActive || !this.built) return false;
    if (key === "escape") {





      if (this.activeLostCapturesPopup?.visible === true) {
        this.activeLostCapturesPopup.dismiss();
        return true;
      }
      // Post-battle buttons own required continuation callbacks; a raw dismiss would skip those
      // callbacks and wedge the evolution/return flow, so Esc is intentionally consumed there.
      if (this.activePostBattlePopup !== undefined || this.evolutionOverlay !== undefined) return true;
      if (this.activeSpiritMenu !== undefined) {
        this.activeSpiritMenu.requestClose();
        return true;
      }
      if (this.activeMonsterManagement !== undefined) {
        this.activeMonsterManagement.requestClose();
        return true;
      }
      if (this.targetPicker.dismissTopPopup()) return true;
      if (this.activeCapturePopup !== undefined) {
        this.activeCapturePopup.dismiss();
        return true;
      }
      if (this.activeSecondaryPopup !== undefined) {
        this.activeSecondaryPopup.dismiss();
        return true;
      }
      if (this.activeAnalyzePopup !== undefined) {
        this.activeAnalyzePopup.dismiss();
        return true;
      }
      if (this.picking) {
        this.targetPicker.cancelViaEscape();
        return true;
      }
      if (this.multiplayer) { this.requestMultiplayerForfeit(); return true; }
      return false;
    }
    if (isAdvanceShortcut(key)) {
      if (
        this.picking ||
        this.activeSpiritMenu !== undefined ||
        this.activeMonsterManagement !== undefined ||
        this.activeCapturePopup !== undefined ||
        this.activeSecondaryPopup !== undefined ||
        this.activeAnalyzePopup !== undefined ||
        this.activePostBattlePopup !== undefined ||
        this.targetPicker.hasOpenPopup ||
        !this.statusText.visible
      ) return false;
      this.statusText.advance();
      return true;
    }
    const slot = battleAbilitySlotForShortcut(key);
    if (slot === undefined) return false;
    if (
      this.presentationState !== "awaitingPlayerChoice" ||
      !this.panel.visible ||
      this.multiplayer?.busy ||
      this.picking ||
      this.activeSpiritMenu !== undefined ||
      this.activeMonsterManagement !== undefined ||
      this.activeCapturePopup !== undefined ||
      this.activeSecondaryPopup !== undefined ||
      this.activeAnalyzePopup !== undefined ||
      this.activePostBattlePopup !== undefined ||
      this.targetPicker.hasOpenPopup
    ) return false;
    return this.panel.activateAbilitySlot(slot);
  };

  private finishBattle(outcome: BattleExitOutcome): void {
    this.lastTerminalExitOutcome = outcome;
    this.terminalExit.dispatch(outcome);
  }

  private commitTripTerminalState(): void {
    if (this.authority !== undefined || this.tripParty === undefined || this.tripTerminalCommitted) return;
    this.tripParty.commitBattleSnapshot(this.session.playerTerminalSnapshot());
    this.tripTerminalCommitted = true;
  }

  private awardTripCaptures(): void {
    if (this.authority !== undefined || this.tripParty === undefined) return;
    for (const id of this.session.capturedIds()) {
      const setup = this.roster.entryOf(id).setup;
      const shortType = battleOriginalShortType(setup);
      const instanceId = this.captureInstanceId!(shortType, setup.level);
      this.tripParty.addCapturedMonster({ instanceId, shortType, level: setup.level });
      this.onQuestEvent?.({ id: 7, monsterShortType: shortType });
    }
  }

  /** Source encounter-owner popup mount used for post-victory fixed treasure. */
  get notificationParent(): Container {
    if (this.scene === undefined) throw new Error("BattleNode scene is not built");
    return this.scene;
  }








  teardownCombatMonstersForReturn(): void {
    this.statusText.clearStatusText();
    this.friendlyDisplay.visible = false;
    this.enemyDisplay.visible = false;
    this.effectLayer.visible = false;
  }






  private async presentInitialTutorials(): Promise<void> {
    await this.sleep(BATTLE_TUTORIAL_DELAY_MS);
    if (this.lifecycle.disposed) return;
    if (!this.profile.hasTutorialFlag("Tutorial0")) {
      await this.presentPlotTutorialIfUnseen("Tutorial0", [
        "battleTutorial1.png",
        "battleTutorial2.png",
      ]);
      return;
    }
    await this.presentPlotTutorialIfUnseen("Tutorial1", ["catchTutorial.png"]);
  }

  private async presentPlotTutorialIfUnseen(
    key: string,
    images: readonly string[],
  ): Promise<void> {
    if (
      this.lifecycle.disposed ||
      this.profile.hasTutorialFlag(key) ||
      images.some((image) => !this.game.assets.hasSprite(image.replace(/\.png$/i, "")))
    ) {
      return;
    }
    // Source persists the flag before allocating/presenting PlotGameFlowEvent. Official play
    // keeps that ordering across the network so a reload cannot resurrect an acknowledged page.
    await this.authority?.claimTutorialFlag(key);
    if (this.lifecycle.disposed) return;
    this.profile.claimTutorialFlag(key);
    const handle = await showPlotTutorial({
      parent: this.notificationParent,
      owner: this,
      assets: this.game.assets,
      scale9: this.game.scale9,
      strings: this.game.strings,
      ticker: this.stage.app.ticker,
      keyboard: this.keyboard,
      key,
      images,
      onClick: () => this.audio.playSfx("click"),
      onStateChanged: (state) => { this.plotTutorialState = state; },
    });
    if (this.lifecycle.disposed) {
      handle.dismiss();
      return;
    }
    this.activePlotTutorial = handle;
    await handle.done;
    if (this.activePlotTutorial === handle) this.activePlotTutorial = undefined;
  }

  private fireEnemyDefeatQuestEvents(events: readonly BattleEvent[]): void {
    for (const event of enemyDefeatQuestEvents(
      events,
      new Set(this.session.deadIdsOf(1)),
      (id) => battleOriginalShortType(this.roster.entryOf(id).setup),
    )) {
      this.onQuestEvent?.(event);
    }
  }

  private async showXpAwardPopup(): Promise<void> {
    // Read the engine's exact Team collections instead of reconstructing them from presentation
    // events: a dead Team.summon emits `died` but source replaceDeadMonster: never appends it to
    // deadMembers. Native order is deadMembers followed by monsterMembers.
    const { awardedIds, amount } = this.session.postBattleXpSummary(
      this.encounter.breederXpBonus,
    );

    // `performAwardLogic`'s award loop skips summoned members (`summoned == 0` gate, flow doc
    // §1.1) — they get no XP bar, no `awardXp:`, and no level-ups. (The aggregate `amount` above
    // keeps the full dead+alive participant set as its divisor, the verified aggregation read —
    // xp-award-verification.md.)
    // Apply `awardXp:` + the `while (canLevelUp)` loop NOW — the source levels every Job and
    // queues the level-up text BEFORE the XP popup is even constructed (flow doc §1.1/§1.2).
    // Battle Jobs spawn exactly at their level boundary (`_initWithName:` seeds
    // `xp = xpForLevel(level)`), so cumulative xp is that boundary plus the award.
    const rosterBench: PostBattlePartyMonster[] = this.roster
      .entries()
      .filter((entry) => entry.team === 0 && !entry.createdMidBattle)
      .map((entry) => {
        const sourceInstanceId = entry.setup.sourceInstanceId;
        const durable = sourceInstanceId === undefined ? undefined : this.tripParty?.monster(sourceInstanceId);
        return {
          id: entry.id,
          ...(sourceInstanceId === undefined ? {} : { sourceInstanceId }),
          shortType: durable?.shortType ?? battleOriginalShortType(entry.setup),
          level: durable?.level ?? entry.setup.level,
          ...(durable === undefined ? {} : { cumulativeXp: durable.cumulativeXp }),
        };
      });
    const rosterBySourceInstanceId = new Map(
      rosterBench
        .filter((member): member is PostBattlePartyMonster & { sourceInstanceId: string } =>
          member.sourceInstanceId !== undefined)
        .map((member) => [member.sourceInstanceId, member]),
    );
    const bench: PostBattlePartyMonster[] = this.tripParty === undefined
      ? rosterBench
      : this.tripParty.monsters().map((monster) => {
          const rosterMember = rosterBySourceInstanceId.get(monster.instanceId);
          return {
            id: rosterMember?.id ?? `trip:${monster.instanceId}`,
            sourceInstanceId: monster.instanceId,
            shortType: monster.shortType,
            level: monster.level,
            cumulativeXp: monster.cumulativeXp,
          };
        });
    const benchById = new Map(bench.map((member) => [member.id, member]));











    const batting: PostBattlePartyMonster[] = this.tripParty === undefined
      ? bench
      : evolutionBattingPrefix(bench, this.tripParty.battingOrderLength());
    const levelUpEntries: LevelUpEntry[] = [];
    const entries: XpAwardEntry[] = [];
    for (const id of awardedIds) {
      const member = benchById.get(id);
      if (!member) throw new Error(`XP award participant ${id} is missing from the friendly roster`);
      const penalty = this.game.gd.jobXpPenalty(member.shortType);
      const levelBoundaryXp = jobXpForLevel(member.level, penalty);
      const beforeXp = (member.cumulativeXp ?? levelBoundaryXp) - levelBoundaryXp;
      entries.push({
        id,
        shortType: member.shortType,
        beforeXp,
        afterXp: beforeXp + amount,
        xpCostOfNextLevel: jobXpCostOfNextLevel(member.level, penalty),
      });
      const durableAward = member.sourceInstanceId === undefined
        ? undefined
        : this.tripParty?.awardXp(member.sourceInstanceId, amount);
      const cumulativeXp = durableAward?.cumulativeXp ?? levelBoundaryXp + beforeXp + amount;
      const endLevel = durableAward?.level ?? jobLevelAfterAward(member.level, cumulativeXp, penalty);
      member.cumulativeXp = cumulativeXp;
      if (endLevel > member.level) {
        levelUpEntries.push({
          monster: this.game.gd.monsterByShortType(member.shortType),
          displayName: localizedRenderableName(this.game.strings, [member.shortType]),
          startLevel: member.level,
          endLevel,
        });
        member.level = endLevel; // `increaseLevel`'s mutation, batting/bench shared object
      }
    }
    this.postBattleParty = { batting, bench };
    this.pendingLevelUpPages = levelUpPages(this.game.strings, levelUpEntries);

    // Native performAwardLogic constructs and shows the XP popup before beginEvolve can request
    // any evolved renderable. Start the browser-only fetch concurrently, but never await it on the
    // Win1/XP-screen critical path. If the player closes unusually quickly, runEvolveChain awaits
    // the retained promise behind its already-mounted locked overlay.
    const defOf = (shortType: string) => this.game.gd.monsterByShortType(shortType);
    this.evolutionAssetsPromise = firstEvolveCandidate(batting, defOf)
      ? loadEvolutionAssets(this.game.assets, evolutionRenderableTypes(bench, defOf))
      : undefined;
    // Register a rejection observer immediately so a user who leaves the XP popup open cannot
    // produce a transient unhandled-rejection report. The original promise remains rejected and
    // is awaited below, where the battle's normal fail-loud path owns it.
    void this.evolutionAssetsPromise?.catch(() => undefined);

    const display = await XpAwardDisplay.create({
      assets: this.game.assets,
      strings: this.game.strings,
      amount,
      entries,
    });
    if (this.lifecycle.disposed || !this.scene) return;
    this.activeXpAwardDisplay = display;
    let popup!: Popup;
    popup = await Popup.show(this.scene, {
      assets: this.game.assets,
      scale9: this.game.scale9,
      ticker: this.stage.app.ticker,
      content: display.content,








      contentLayoutBounds: {
        x: 0,
        y: 0,
        w: display.content.boxContentSize.w,
        h: display.content.boxContentSize.h,
      },
      buttons: [


        { label: localizedString(this.game.strings, "CloseButtonKey"), onPress: () => this.closeXpAwardPopup() },
      ],

      dismissOnTap: false,
      zIndex: 1000,
      sfx: this.popupSfx(),
      onDismiss: () => {
        if (this.activePostBattlePopup === popup) this.activePostBattlePopup = undefined;
        this.activeXpAwardDisplay = undefined;
        this.postBattlePopupKind = null;
      },
    });
    if (!popup.isDismissed) {
      this.activePostBattlePopup = popup;
      this.postBattlePopupKind = "xpAward";
    }
  }

  /** The XP popup's Close-button selector split (flow doc §1.2): with no level-ups the button IS
   *  `beginEvolve:`; with level-ups it's `beginWaitingForText:` — reveal the pre-queued pages,
   *  whose registered finish invocation then runs `beginEvolve:`. */
  private closeXpAwardPopup(): void {




    if (this.xpAwardPopupClosed) return;
    this.xpAwardPopupClosed = true;
    const pages = this.pendingLevelUpPages;
    this.pendingLevelUpPages = [];
    if (pages.length === 0) {
      void this.runEvolveChain();
      return;
    }
    // Defer past the Close tap's own dispatch: pixi bubbles the same pointertap up to the
    // stage-wide statusTextAdvance handler, which would advance (eat) the header page the
    // instant showPages makes the box visible. The original's popup swallows its touch outright
    // (PopupLayerNode full-screen swallower), so the reveal never races the closing tap there.
    // Same defer-past-dismiss pattern as postBattleRestart.
    void Promise.resolve().then(() => {
      if (this.lifecycle.disposed) return;
      this.statusText.showPages(pages, () => void this.runEvolveChain());
    });
  }






  private async runEvolveChain(): Promise<void> {
    // Backstop for the invariant `closeXpAwardPopup` already protects: exactly one chain per
    // battle. This is the terminal consumer of BOTH close-button branches (the direct call and
    // the `showPages` finish invocation), so guarding here covers any future caller too. A second
    // concurrent loop would double-evolve the bench, fight over the single tag-2/tag-3 overlay
    // slots, and call `postBattleRestart` twice — restarting the demo mid-reveal.
    if (this.evolveChainStarted) return;
    this.evolveChainStarted = true;
    const party = this.postBattleParty;
    if (!party || !this.scene) {
      this.postBattleRestart();
      return;
    }
    const defOf = (shortType: string) => this.game.gd.monsterByShortType(shortType);
    // The first source pass still tears down statusText and clears locked again before endBattle,
    // but it creates no evolution children and needs no texture bundle.
    if (!firstEvolveCandidate(party.batting, defOf)) {
      this.statusText.clearStatusText();
      this.postBattleRestart();
      return;
    }
    if (!this.evolutionOverlay) {
      // Mount the locked-touch consumer before awaiting the background preload, so an unusually
      // fast Close cannot expose an interactive blank battle while evolved textures finish.
      this.evolutionOverlay = new EvolutionOverlay(this.stage.app.ticker);


      this.evolutionOverlay.zIndex = 1100;
      this.scene.addChild(this.evolutionOverlay);
      const assets = this.evolutionAssets ?? await (
        this.evolutionAssetsPromise ?? loadEvolutionAssets(
          this.game.assets,
          evolutionRenderableTypes(party.bench, defOf),
        )
      );
      if (this.lifecycle.disposed) return;
      this.evolutionAssets = assets;
      this.evolutionOverlay.setAssets(assets);
    }
    const overlay = this.evolutionOverlay;
    // Chained evolutions (A->B->C with both levelReqs met) loop exactly like the source; the
    // shipped evolveData graph is acyclic, so a runaway loop is a data/port bug — fail loud.
    for (let iterations = 0; ; iterations++) {
      if (iterations > 100) throw new Error("evolution chain did not terminate — evolveData cycle?");
      if (this.lifecycle.disposed) return;
      // beginEvolve: top — the statusText box is shown-then-removed; this port's box is a
      // persistent scene child, so clearing is the equivalent teardown.
      this.statusText.clearStatusText();
      const candidate = firstEvolveCandidate(party.batting, defOf);
      if (!candidate) {
        this.postBattleRestart(); // [Battle sharedInstance] endBattle
        overlay.clearBanner(); // the tag-3 cleanup runs AFTER endBattle on this path (§5 quirk)
        return;
      }

      this.playMusicTrack("Evolve", 1, false);
      const candidateScale = rendererScaleOf(defOf(candidate.shortType).rendererData) ?? 1;
      overlay.showShake(candidate.shortType, candidateScale);
      this.onQuestEvent?.({ id: 6, monsterShortType: candidate.shortType });
      overlay.showBanner(); // adds this iteration's banner, removes the previous one
      await this.sleep(EVOLVE_PERFORM_DELAY_MS);
      if (this.lifecycle.disposed) return;
      this.performEvolution(party, defOf);
      await this.sleep(EVOLVE_END_DELAY_MS);
      if (this.lifecycle.disposed) return;
      overlay.removeReveal(); // endEvolve
    }
  }








  private performEvolution(
    party: { batting: PostBattlePartyMonster[]; bench: PostBattlePartyMonster[] },
    defOf: (shortType: string) => MonsterDef,
  ): void {
    const overlay = this.evolutionOverlay!;
    overlay.removeShake();
    const candidate = firstEvolveCandidate(party.bench, defOf);
    if (!candidate) {
      console.error("Mid evolve, failed to find the monster who was evolving");
      return;
    }
    const oldDef = defOf(candidate.shortType);
    const newType = oldDef.evolveData!.newType;
    const evolvedDef = defOf(newType);



    candidate.shortType = newType;
    if (candidate.sourceInstanceId !== undefined && this.tripParty !== undefined) {
      const evolved = this.tripParty.evolve(candidate.sourceInstanceId);
      if (evolved.shortType !== newType) {
        throw new Error(`BattleNode: durable evolution produced ${evolved.shortType}, expected ${newType}`);
      }
      candidate.cumulativeXp = evolved.cumulativeXp;
    }
    overlay.showReveal({
      shortType: newType,
      displayName: localizedRenderableName(this.game.strings, [newType]),
      oldStars: oldDef.stars,
      newStars: evolvedDef.stars,
      rendererScale: rendererScaleOf(evolvedDef.rendererData) ?? 1,
    });
  }

  private async showReturnToTownPopup(): Promise<void> {
    if (this.lifecycle.disposed) return;
    const defeatRecovery = this.encounter.blockSaveMe ? undefined : this.defeatRecovery;
    if (!this.encounter.blockSaveMe && defeatRecovery === undefined) {
      throw new Error("BattleNode: an unblocked encounter requires a defeatRecovery adapter");
    }
    const offerSaveMe = defeatRecovery?.canOffer() ?? false;
    if (offerSaveMe) await defeatRecovery!.markTutorialSeen();
    if (this.lifecycle.disposed) return;

    await this.showDefeatPopup(
      localizedString(this.game.strings, "AllDeadTitleKey"),
      offerSaveMe
        ? buildMonsterHatchMessageContent(
            localizedString(this.game.strings, "AllDeadSaveMeMessageKey")
              .replace("%d", String(SAVE_ME_GOLD_COST)),
          )
        : buildLocalizedMonsterHatchMessageContent(this.game.strings, "AllDead"),
      offerSaveMe
        ? [
            {
              label: localizedString(this.game.strings, "YesButtonKey"),
              // PopupMenuItem removes the invoked loss popup synchronously. Do not return the
              // async adapter promise here: Popup's promise-aware button would otherwise keep the
              // swallowing modal above the Store for the entire category-3 wait.
              onPress: () => {
                void this.acceptSaveMe(defeatRecovery!).catch((error: unknown) => {
                  queueMicrotask(() => { throw error; });
                });
              },
            },
            {
              label: localizedString(this.game.strings, "NoButtonKey"),
              onPress: () => this.finishBattle("defeat"),
            },
          ]
        : [{
            label: localizedString(this.game.strings, "OkButtonKey"),
            onPress: () => this.finishBattle("defeat"),
          }],
    );
    if (this.lifecycle.disposed) return;
    await this.showLostCaptures();
  }

  /** Callable presentation retry for a rejected terminal navigation/save. The failed outcome is
   * retained by the same terminal state machine, so a successful retry cannot duplicate capture,
   * quest, reward, or dungeon-resolution work. */
  retryTerminalExit(): boolean {
    const outcome = this.terminalRetryOutcome;
    if (outcome === undefined) return false;
    if (this.terminalExit.inFlight !== undefined || this.terminalExit.completed !== undefined) {
      return false;
    }
    this.terminalRetryOutcome = undefined;
    this.activeTerminalRetryPopup?.dismiss();
    this.activeTerminalRetryPopup = undefined;
    const dispatched = this.terminalExit.dispatch(outcome);
    if (!dispatched) this.terminalRetryOutcome = outcome;
    return dispatched;
  }

  terminalExitRetryAvailable(): boolean {
    return this.terminalRetryOutcome !== undefined;
  }

  private async acceptSaveMe(defeatRecovery: DefeatRecoveryAdapter): Promise<void> {
    const result = await defeatRecovery.acceptSaveMe();
    if (this.lifecycle.disposed) return;
    if (result === "saved") {
      // The adapter owns the committed transaction. Hosts choose the post-recovery lifecycle.
      this.finishBattle("saveMe");
      return;
    }

    // `useSaveMe:` mounts Store category 3 first, immediately stacks NotEnoughGold above it, and
    // gives Store close to `performLooseLogic2`. Await only the mount handshake here; the nested
    // close promise remains pending while the refusal is visible above the live Store.
    const store = await defeatRecovery.openGoldStore();
    if (this.lifecycle.disposed) return;
    await this.showDefeatPopup(
      localizedString(this.game.strings, "NotEnoughGoldTitleKey"),
      buildLocalizedMonsterHatchMessageContent(this.game.strings, "NotEnoughGold"),
      [{
        label: localizedString(this.game.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
    );
    if (this.lifecycle.disposed) return;
    await store.closed;
    if (this.lifecycle.disposed) return;



    await this.showReturnToTownPopup();
  }

  private async showDefeatPopup(
    title: string,
    content: Container,
    buttons: ReadonlyArray<{ label: string; onPress: () => void | Promise<void> }>,
  ): Promise<void> {
    const scene = this.scene;
    if (this.lifecycle.disposed || scene === undefined) return;
    let popup!: Popup;
    popup = await showMonsterHatchPopup(this.monsterHatchEnvironment(scene), {
      title,
      content,
      buttons,
      onDismiss: () => {
        if (this.activePostBattlePopup === popup) {
          this.activePostBattlePopup = undefined;
          this.postBattlePopupKind = null;
        }
      },
    });
    if (this.lifecycle.disposed) {
      popup.dismiss();
      return;
    }
    if (!popup.isDismissed) {
      this.activePostBattlePopup = popup;
      this.postBattlePopupKind = "returnToTown";
    }
  }

  private async showTerminalExitRetryPopup(): Promise<void> {
    const scene = this.scene;
    if (this.lifecycle.disposed || scene === undefined || this.terminalRetryOutcome === undefined) return;
    if (this.activeTerminalRetryPopup !== undefined && !this.activeTerminalRetryPopup.isDismissed) return;
    let popup!: Popup;
    popup = await showMonsterHatchPopup(this.monsterHatchEnvironment(scene), {
      title: "Save failed",
      content: buildMonsterHatchMessageContent("The terminal exit was not saved. Try again."),
      buttons: [{ label: "Retry", onPress: () => { this.retryTerminalExit(); } }],
      onDismiss: () => {
        if (this.activeTerminalRetryPopup === popup) this.activeTerminalRetryPopup = undefined;
      },
    });
    if (this.lifecycle.disposed || popup.isDismissed || this.terminalRetryOutcome === undefined) {
      popup.dismiss();
      return;
    }
    this.activeTerminalRetryPopup = popup;
  }










  private async showLostCaptures(): Promise<void> {
    if (!this.scene || this.lifecycle.disposed) return;
    const entries: LostCaptureEntry[] = this.session.capturedIds().map((id) => {
      const setup = this.roster.entryOf(id).setup;
      const rendererData = setup.rendererData ?? this.game.gd.monsterByShortType(setup.shortType).rendererData;
      return {
        spriteKey: battleSpriteKey(setup),
        ...(rendererData === undefined ? {} : { rendererData }),
      };
    });
    if (entries.length === 0) return;
    const popup = await showLostCapturesPopup(
      this.monsterHatchEnvironment(this.scene),
      this.game.assets,
      this.game.strings,
      entries,
      (dismissed) => {
        if (this.activeLostCapturesPopup === dismissed) this.activeLostCapturesPopup = undefined;
      },
    );
    if (this.lifecycle.disposed || popup === undefined) return;
    if (!popup.isDismissed) this.activeLostCapturesPopup = popup;
  }

  // --- data / lookups -----------------------------------------------------------------------

  /** A reconnect can resume after CallMonster/Desoul constructed identities that were not in the
   * encounter's initial teams. Register and preload those identities before any snapshot or turn-
   * order lookup can observe them. Historical dead identities stay registered, matching the live
   * event path and keeping later replay references resolvable. */
  private async preloadRestoredRoster(identities: readonly RestoredRosterIdentity[]): Promise<void> {
    const shortTypes = [...new Set(identities.map((identity) => identity.shortType))];
    if (shortTypes.length === 0) return;
    const plan = computePreloadPlan(this.game.gd, this.game.anims, this.game.meleeAttacks, shortTypes);
    await Promise.all([
      ...shortTypes.map((shortType) => this.game.assets.sprite(`${shortType}-hd`)),
      ...plan.atlases.map((atlas) => this.game.assets.atlas(atlas)),
      ...plan.particles.map((particle) => this.game.assets.particle(particle)),
      ...plan.sfx.map((sfx) => this.audio.preloadSfx(sfx, this.game.assets.audioUrl(sfx))),
    ]);
  }

  /** Rebuild reconnect-only UI latches from committed history without replaying old animations. */
  private async hydrateRestoredPresentation(events: readonly BattleEvent[]): Promise<void> {
    if (events.length === 0) return;

    const friendlySummon = this.session.summonIdOf(0);
    if (friendlySummon !== undefined) {
      await this.friendlyDisplay.notifySummonChanged(this.friendlySnapshotOf(friendlySummon));
      if (this.lifecycle.disposed) return;
    }

    const enemySummon = this.session.summonIdOf(1);
    if (this.multiplayer && enemySummon) await this.enemyDisplay.notifyAdded(this.enemySnapshotOf(enemySummon));
    for (const [id, counts] of restoredStatusCounts(events)) {
      this.statusOverlays.hydrateCounts(id, counts);
    }
    if (restoredAnalyzeEnabled(events)) this.enemyDisplay.allowAnalyze();
  }

  private buildSnapshots(): { friendly: FriendlySnapshot[]; enemy: EnemySnapshot[] } {
    const friendly: FriendlySnapshot[] = [];
    const enemy: EnemySnapshot[] = [];
    for (const { id, team, setup } of this.roster.entries()) {
      const maxHp = this.session.maxHpOf(id);
      const currentHp = this.session.hpOf(id);
      this.hp.set(id, currentHp);
      const monster = this.game.gd.monsterByShortType(setup.shortType);
      const rendererScale = rendererScaleOf(setup.rendererData ?? monster.rendererData);
      // Fixed dungeon encounters may override Living.displayName/rendererData per instance.
      const displayName = setup.displayName ?? localizedRenderableName(this.game.strings, [setup.shortType]);
      const spriteKey = battleSpriteKey(setup);
      if (team === 0) {
        friendly.push({
          id,
          name: displayName,
          spriteKey,
          hp: currentHp,
          maxHp,
          ...(rendererScale !== undefined ? { rendererScale } : {}),
        });
      } else {
        enemy.push({
          id,
          name: displayName,
          spriteKey,
          portraitFrame: battlePortraitFrame(setup),
          hp: currentHp,
          maxHp,



          rarity: monster.stars,
          element: monster.element,
          ...(rendererScale !== undefined ? { rendererScale } : {}),
        });
      }
    }
    return { friendly, enemy };
  }

  private turnOrderProvider(): TurnOrderProvider {
    return {
      order: () => this.session.queueOrder(),
      delayOf: (id) => this.session.timeDelayOf(id),
      infoOf: (id): TurnOrderMonsterInfo => {
        const team = this.session.teamOf(id);
        const maxHp = this.session.maxHpOf(id);
        const setup = this.roster.entryOf(id).setup;
        return {
          name: this.displayNameOf(id),
          // `addNodeForMonster:` builds the atlas frame from Monster.name, not Living.displayName.
          // A dungeon instance may override/localize the latter, but portrait assets remain keyed
          // by the raw monster type (`<shortType>_icon.png`).
          portraitFrame: battlePortraitFrame(setup),
          hp: this.hp.get(id) ?? maxHp,
          maxHp,
          team,
          ...(team !== 0 ? { colorTint: this.enemyDisplay.displayColorOf(id) } : {}),
        };
      },
    };
  }






  private applyAbilityEvents(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type !== "abilityEvent") continue;
      if (event.event === 1) continue; // Escape's retreat arm — handled via the `escaped` event
      if (event.event !== 0) {
        throw new Error(`BattleNode: unsupported ability event ${event.event}`);
      }
      this.enemyDisplay.allowAnalyze();
    }
  }

  private applyHp(events: readonly BattleEvent[]): void {
    for (const e of events) {
      if (e.type !== "damageDealt" && e.type !== "healed") continue;
      this.hp.set(e.target, e.hpAfter);
      if (this.session.teamOf(e.target) === 0) {
        this.friendlyDisplay.notifyHp(e.target, e.hpAfter);


        this.panel.notifyHp(e.target, e.hpAfter);
      } else this.enemyDisplay.notifyHp(e.target, e.hpAfter);
      this.turnOrder.syncLivingHp(e.target);
    }
  }

  /** `Battle notifyLiving:{dealt,took}Damage:` -> HeroData readiness; damage amount is ignored. */
  private applyPresentedSpiritReadiness(events: readonly BattleEvent[]): void {
    if (!this.suppressCommittedOpeningSpiritCharge) this.applySpiritReadiness(events);
  }

  private applySpiritReadiness(events: readonly BattleEvent[]): void {
    for (const e of events) {
      if (e.type !== "damageDealt") continue;
      const source = this.roster.entryOf(e.source);
      const target = this.roster.entryOf(e.target);
      if (source.team === 0) {
        this.profile.chargeSpiritForDealtDamage(source.setup.level, target.setup.level);
      }
      if (target.team === 0) {
        this.profile.chargeSpiritForTakenDamage(target.setup.level, source.setup.level);
      }
    }
  }

  /** Feeds `buffAdded`/`buffRemoved` into the transition-counted overlay tracker
   *  (status-effects.md §1/§7 item 3) — synchronous count bookkeeping; the resulting
   *  spawn/despawn is async (asset loads) and intentionally NOT awaited here, mirroring every
   *  other `startPresentationTask`-style fire-and-forget visual in this method (the tracker's own
   *  0->1/1->0 gate is what prevents any race from double-showing/hiding). */
  private applyStatusOverlayEvents(events: readonly BattleEvent[]): void {
    for (const e of events) {
      if (e.type === "buffAdded") this.statusOverlays.onBuffAdded(e.target, e.statusEffects);
      else if (e.type === "buffRemoved") this.statusOverlays.onBuffRemoved(e.target, e.statusEffects);
    }
  }

  /** `monsterAdded`/`switched`/`escaped` (events.ts's remaining-ability-component additions) —
   * Dynamic constructions are awaited because their assets must exist before a display is built.
   * Switch is different: both members already belong to the preloaded roster, and the source's
   * synchronous removed/added callbacks only start overlapping presentation actions. */
  private async applyRosterEvents(
    events: readonly BattleEvent[],
    assetWarmups: ReadonlyMap<string, Promise<void>> = new Map(),
  ): Promise<void> {
    for (const e of events) {
      if (e.type === "monsterAdded") await this.handleMonsterAdded(e, assetWarmups.get(e.shortType));
      else if (e.type === "switched") this.handleSwitched(e);
      else if (e.type === "summonChanged") {
        await this.handleSummonChanged(
          e,
          e.shortType === undefined ? undefined : assetWarmups.get(e.shortType),
        );
      }
      else if (e.type === "escaped") this.battleEscaped = true;
      // silverSpent/movedToFront need no roster presentation. targetAltered is intentionally not
      // handled here because renderQueuedEffects already showed its Blocked feedback pre-impact.
    }
  }

  private startRosterAssetWarmups(events: readonly BattleEvent[]): ReadonlyMap<string, Promise<void>> {
    const warmups = new Map<string, Promise<void>>();
    for (const event of events) {
      const shortType = event.type === "monsterAdded"
        ? event.shortType
        : event.type === "summonChanged" && event.added !== undefined
          ? event.shortType
          : undefined;
      if (shortType === undefined || warmups.has(shortType)) continue;
      const pending = this.preloadDynamicRosterType(shortType);
      // The impact path remains the error owner. Observing the promise here merely prevents a
      // premature browser unhandled-rejection report during a nonzero phase delay.
      void pending.catch(() => {});
      warmups.set(shortType, pending);
    }
    return warmups;
  }

  private async preloadDynamicRosterType(shortType: string): Promise<void> {
    const plan = computePreloadPlan(this.game.gd, this.game.anims, this.game.meleeAttacks, [shortType]);
    await Promise.all([
      this.game.assets.sprite(`${shortType}-hd`),
      ...plan.atlases.map((atlas) => this.game.assets.atlas(atlas)),
      ...plan.particles.map((particle) => this.game.assets.particle(particle)),
      ...plan.sfx.map((sfx) => this.audio.preloadSfx(sfx, this.game.assets.audioUrl(sfx))),
    ]);
  }








  private async handleSummonChanged(
    e: Extract<BattleEvent, { type: "summonChanged" }>,
    assetWarmup?: Promise<void>,
  ): Promise<void> {
    if (e.added !== undefined && e.shortType !== undefined && e.level !== undefined) {
      this.roster.registerMidBattle(e.added, e.team, { shortType: e.shortType, level: e.level });
      this.hp.set(e.added, this.session.hpOf(e.added));
      await (assetWarmup ?? this.preloadDynamicRosterType(e.shortType));
      if (this.lifecycle.disposed) return;
    }
    if (e.team === 0) {
      await this.friendlyDisplay.notifySummonChanged(
        e.added !== undefined ? this.friendlySnapshotOf(e.added) : undefined,
      );
      if (e.added !== undefined) this.statusOverlays.refreshHostsFor(e.added);
    } else if (this.multiplayer) {
      if (e.removed) void this.enemyDisplay.notifyDied(e.removed);
      if (e.added) { await this.enemyDisplay.notifyAdded(this.enemySnapshotOf(e.added)); this.statusOverlays.refreshHostsFor(e.added); }
    }
  }






  private async handleMonsterAdded(
    e: Extract<BattleEvent, { type: "monsterAdded" }>,
    assetWarmup?: Promise<void>,
  ): Promise<void> {
    // Info popups / ability-info / view-party all resolve identity through the roster registry —
    // a summon must be registered before any of those can be tapped for it.
    this.roster.registerMidBattle(e.living, e.team, { shortType: e.shortType, level: e.level });
    // NOT maxHp: an hpStyle:"split" clone materializes at HALF the summoner's hp, and "match"
    // copies it (components-full.md §1) — the engine's post-resolution hp is the real value, and
    // there is no damageDealt event for the clone's own below-max start to correct it later.
    this.hp.set(e.living, this.session.hpOf(e.living));
    await (assetWarmup ?? this.preloadDynamicRosterType(e.shortType));
    if (this.lifecycle.disposed) return;
    // `Team.addNewMonster:` bench-appends first; the front line only gains the summon when a slot
    // was open (components-full.md §1). A BENCHED summon (full front line) must not appear on the
    // field — its assets are still loaded above so a later death-promotion (handleDeaths' roster
    // diff, which assumes preloaded assets) can display it without a mid-promotion fetch.
    const isActive = this.session.activeIdsOf(e.team).includes(e.living);
    if (e.team === 0) {
      if (isActive) {
        await this.friendlyDisplay.notifyAddedMany([this.friendlySnapshotOf(e.living)]);
        this.statusOverlays.refreshHostsFor(e.living);
      }
    } else {
      if (isActive) {
        await this.enemyDisplay.notifyAddedMany([this.enemySnapshotOf(e.living)]);
        this.statusOverlays.refreshHostsFor(e.living);
      }
      this.enemyDisplay.setBenchCount(this.session.benchCountOf(1));
    }
  }











  private handleSwitched(e: Extract<BattleEvent, { type: "switched" }>): void {
    // Team.switchInBattleMonster sends its remove and add notifications synchronously. Each
    // listener merely starts Cocos actions; neither notification waits for the outgoing display's
    // animation. Preserve that overlap here. Awaiting notifyDied before notifyAddedMany used to
    // leave an invented one-second empty slot (and would turn the source's invisible t=1..2 dying
    // node tail into an additional visible entrance delay).
    const removal = e.team === 0
      ? this.friendlyDisplay.notifyDied(e.out)
      : this.enemyDisplay.notifyDied(e.out, { captureSuccess: true });


    this.hp.set(e.in, this.session.hpOf(e.in));
    let addition: Promise<void>;
    if (e.team === 0) {
      const cards = this.friendlyDisplay.notifyAddedMany([this.friendlySnapshotOf(e.in)]);
      // Construction only -- see settleDisplayRegistrations. The switch-in must resolve through
      // nodeOf by the time the next panel/target picker reads the live teams.
      this.trackDisplayRegistration(cards);
      addition = cards.then(() => {
        if (!this.lifecycle.disposed) this.statusOverlays.refreshHostsFor(e.in);
      });
    } else {
      const enemyAdd = this.enemyDisplay.notifyAddedManyPhases([this.enemySnapshotOf(e.in)]);
      this.trackDisplayRegistration(enemyAdd.registered);
      addition = enemyAdd.entrance.then(() => {
        if (!this.lifecycle.disposed) this.statusOverlays.refreshHostsFor(e.in);
      });
      this.enemyDisplay.setBenchCount(this.session.benchCountOf(1));
    }
    this.startPresentationTask(
      Promise.all([removal, addition]).then(() => undefined),
      "switched monster displays",
    );
  }























  private async commitTurnOrderForTurn(
    plan: TurnOrderResolutionPlan,
    addedIds: readonly string[],
    preAdvanceQueue: readonly string[],
  ): Promise<void> {
    const removal = plan.teamRemovedIds.length > 0
      ? this.turnOrder.notifyTeamRemovedMonsters(plan.teamRemovedIds, {
          captureSuccessIds: plan.captureSuccessIds,
        })
      : Promise.resolve();
    if (addedIds.length > 0) {
      await this.turnOrder.notifyTeamAddedMonsters(addedIds, { projectedOrder: preAdvanceQueue });
      if (this.lifecycle.disposed) {
        // Nothing else will consume the removal handle once the node is gone.
        void removal.catch(() => undefined);
        return;
      }
    }
    await Promise.all([
      removal,
      this.turnOrder.notifyBattleTimePassed({ captureSuccessIds: plan.captureSuccessIds }),
    ]);
  }

  private async handleDeaths(events: readonly BattleEvent[]): Promise<void> {
    const deaths: Promise<void>[] = [];
    for (const e of events) {
      if (e.type !== "died") continue;
      deaths.push(
        this.session.teamOf(e.living) === 0
          ? this.friendlyDisplay.notifyDied(e.living)
          : this.enemyDisplay.notifyDied(e.living),
      );
    }
    for (const e of events) {
      if (e.type !== "captured") continue;
      deaths.push(this.enemyDisplay.notifyDied(e.living, { captureSuccess: true }));
    }
    // The engine's death pipeline promotes the bench front in the same step (core.ts
    // handleDeath), which in the original raises `notifyTeam:addedMonster:` (the 1.0s-deferred
    // animated entrance) and `notifyChangedReplacementsForTeam:` (bench badge). Diff both active
    // rosters against their displays to reach the two FIELD presentation locations: the friendly
    // row and the enemy field. TurnOrderDisplay is NOT one of them -- since the source-event split
    // its membership belongs to `notifyTeamAddedMonsters`, which `playTurn` admits itself from the
    // queue diff so the sidebar's add keeps its source order against the battle-time update.
    const friendlyPromotionSnapshots: FriendlySnapshot[] = [];
    for (const id of this.session.activeIdsOf(0)) {
      if (this.friendlyDisplay.hasMonster(id)) continue;
      friendlyPromotionSnapshots.push(this.friendlySnapshotOf(id));
    }
    const enemyPromotionSnapshots: EnemySnapshot[] = [];
    for (const id of this.session.activeIdsOf(1)) {
      if (this.enemyDisplay.hasMonster(id)) continue;
      enemyPromotionSnapshots.push(this.enemySnapshotOf(id));
    }
    const friendlyPromotions = this.friendlyDisplay.notifyAddedMany(friendlyPromotionSnapshots).then(() => {
      for (const snapshot of friendlyPromotionSnapshots) this.statusOverlays.refreshHostsFor(snapshot.id);
    });
    // The friendly row has no deferred entrance -- the whole promise IS its card construction, and
    // `targetRefOf` resolves team-0 ids through `FriendlyTeamDisplay.nodeOf` the same way.
    this.trackDisplayRegistration(friendlyPromotions);
    const enemyAdd = this.enemyDisplay.notifyAddedManyPhases(enemyPromotionSnapshots);
    // The turn may not finish while these displays are still being built: the next panel resolves
    // every live enemy id (capture hosts, target picking). Only construction is joined -- the
    // 1.0s entrance below stays free-standing.
    this.trackDisplayRegistration(enemyAdd.registered);
    const enemyPromotions = enemyAdd.entrance.then(() => {
      for (const snapshot of enemyPromotionSnapshots) this.statusOverlays.refreshHostsFor(snapshot.id);
    });
    this.enemyDisplay.setBenchCount(this.session.benchCountOf(1));
    // This promise represents visual completion only. `playTurn` starts it as a free-standing
    // presentation task and applies the source's independent 0.5s-per-removal logic hold itself;
    // neither the 2s death widget nor the promoted reserve's 1s-deferred entrance serializes the
    // battle clock.
    this.startPresentationTask(enemyPromotions, "enemy reserve promotion entrance");
    await Promise.all([...deaths, friendlyPromotions]);
  }

  /**
   * Joins display CONSTRUCTION that a later id->node lookup depends on.
   *
   * Native's team listeners (`notifyTeam:addedMonster:`, `switchInBattleMonster:with...`) build
   * the joiner's widget synchronously on the resolution call stack, so by the time the turn ends
   * every live id already resolves to a node. In this port each build is an async texture
   * resolve, and the two entrances that own one (`handleDeaths`' reserve promotion,
   * `handleSwitched`' incoming member) are deliberately fire-and-forget so the 1.0s entrance
   * choreography never gates the battle clock. That left a window — and, on a rejected build, a
   * permanent hole — in which the NEXT turn panel resolved a live enemy id that had no display
   * yet: `showPanel`'s capture hosts and `targetRefOf` both go through `nodeOf`, which fails
   * loudly ("unknown monster id"). Registration is therefore joined at the turn boundary while
   * the entrance stays free-standing; in the normal (preloaded) case this costs microtasks.
   */
  private trackDisplayRegistration(registration: Promise<void>): void {
    this.pendingDisplayRegistrations.push(registration);
  }

  /** Drains `trackDisplayRegistration`. A registration that itself schedules another (a promotion
   *  arriving while an earlier build is in flight) is picked up by the loop rather than left for
   *  the next turn. Rejections propagate: a failed build must not become a silent id hole. */
  private async settleDisplayRegistrations(): Promise<void> {
    while (this.pendingDisplayRegistrations.length > 0) {
      const batch = this.pendingDisplayRegistrations;
      this.pendingDisplayRegistrations = [];
      await Promise.all(batch);
    }
  }

  /** Cocos actions and render listeners schedule visuals without blocking battle progression. */
  private startPresentationTask(task: Promise<void>, label: string): void {
    void task.catch((error: unknown) => {
      console.error(`BattleNode ${label} failed`, error);
    });
  }

  private aliveIdsOnTeam(team: 0 | 1): string[] {


    return this.session.queueOrder().filter((id) => this.session.teamOf(id) === team);
  }

  /** `BattleSession.submitPlayerAction` builds the pool itself for self/all-* targeting and REJECTS
   *  any explicit targets for those kinds (session.ts `resolveTargets` `requireEmpty`). The tap
   *  path routes all-* through the TargetPicker's auto-complete, which returns the full id list, so
   *  those are collapsed back to `[]` here before submit; single/multi picks pass through. */
  private submitTargetsFor(choice: PlayerChoice, picked: string[]): string[] {
    const k = choice.targeting.kind;
    return k === "self" || k === "allEnemies" || k === "allFriends" ? [] : picked;
  }

  private defaultTargets(choice: PlayerChoice, gestureMidpoint?: { x: number; y: number }): string[] {
    const t = choice.targeting;
    switch (t.kind) {
      case "self":
      case "allFriends":
        return [];
      case "allEnemies":
        return this.validEnemyTargets(this.aliveIdsOnTeam(1));
      case "mixed":
        return [];
      case "enemies": {
        if (t.count !== 1 || !gestureMidpoint) return [];






        const midpointGlobal = this.scene!.toGlobal(gestureMidpoint);
        let nearest: { id: string; distance2: number } | undefined;
        for (const id of this.validEnemyTargets(this.aliveIdsOnTeam(1))) {
          const ref = this.targetRefOf(id);
          if (!ref.hitNode.visible) continue;
          const bounds = this.targetRefGlobalBounds(ref);
          if (
            midpointGlobal.x < bounds.x || midpointGlobal.x >= bounds.x + bounds.width ||
            midpointGlobal.y < bounds.y || midpointGlobal.y >= bounds.y + bounds.height
          ) continue;
          const dx = bounds.x + bounds.width * 0.5 - midpointGlobal.x;
          const dy = bounds.y + bounds.height * 0.5 - midpointGlobal.y;
          const distance2 = dx * dx + dy * dy;
          if (!nearest || distance2 < nearest.distance2) nearest = { id, distance2 };
        }
        return nearest ? [nearest.id] : [];
      }
      case "friends":
        return this.aliveIdsOnTeam(0).slice(0, t.count);
    }
  }




  private validEnemyTargets(candidateIds: readonly string[]): string[] {
    const targetable = new Set(this.session.targetableIdsOf(1));
    return candidateIds.filter((id) => targetable.has(id));
  }

  private targetRefs(ids: readonly string[]): TargetRef[] {
    return ids.map((id) => this.targetRefOf(id));
  }

  /**
   * Source listener arrays contain full LivingDisplay widgets; outline/effect presentation uses
   * each widget's separate `statusEffectParent`. Keeping both nodes explicit prevents the small
   * rendered monster sprite from accidentally becoming the manual/swipe selection rectangle.
   */
  private targetRefOf(id: string): TargetRef {
    if (this.session.teamOf(id) === 1) {
      return {
        id,
        hitNode: this.enemyDisplay.nodeOf(id),
        visualNode: this.enemyDisplay.targetNodeOf(id),
        contentSize: { w: ENEMY_SLOT_WIDTH, h: ENEMY_SLOT_HEIGHT },
      };
    }
    const card = this.friendlyDisplay.nodeOf(id);
    return {
      id,
      hitNode: card,
      visualNode: this.friendlyDisplay.targetNodeOf(id),
      contentSize: { w: card.contentWidth, h: card.contentHeight },
    };
  }


  private targetRefGlobalBounds(ref: TargetRef): { x: number; y: number; width: number; height: number } {
    const local = minimumHitRectLocal(
      { x: 0, y: 0, w: ref.contentSize.w, h: ref.contentSize.h },
      { x: ref.hitNode.scale.x, y: ref.hitNode.scale.y },
    );
    const corners = [
      ref.hitNode.toGlobal({ x: local.x, y: local.y }),
      ref.hitNode.toGlobal({ x: local.x + local.w, y: local.y }),
      ref.hitNode.toGlobal({ x: local.x, y: local.y + local.h }),
      ref.hitNode.toGlobal({ x: local.x + local.w, y: local.y + local.h }),
    ];
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
  }

  private friendlySnapshotOf(id: string): FriendlySnapshot {
    const setup = this.roster.entryOf(id).setup;
    const shortType = setup.shortType;
    const maxHp = this.session.maxHpOf(id);
    const rendererScale = rendererScaleOf(setup.rendererData ?? this.game.gd.monsterByShortType(shortType).rendererData);
    return {
      id,
      name: this.displayNameOf(id),
      spriteKey: battleSpriteKey(setup),
      hp: this.hp.get(id) ?? maxHp,
      maxHp,
      ...(rendererScale !== undefined ? { rendererScale } : {}),
    };
  }

  /** Same data path as buildSnapshots' enemy branch, for a single (promoted-reserve) id. */
  private enemySnapshotOf(id: string): EnemySnapshot {
    const setup = this.roster.entryOf(id).setup;
    const shortType = setup.shortType;
    const maxHp = this.session.maxHpOf(id);
    const monster = this.game.gd.monsterByShortType(shortType);
    const rendererScale = rendererScaleOf(setup.rendererData ?? monster.rendererData);
    return {
      id,
      name: this.displayNameOf(id),
      spriteKey: battleSpriteKey(setup),
      hp: this.hp.get(id) ?? maxHp,
      maxHp,
      rarity: monster.stars,
      element: monster.element,
      ...(rendererScale !== undefined ? { rendererScale } : {}),
    };
  }

  private async openSpiritMenu(): Promise<void> {
    if (
      !this.built ||
      !this.scene ||
      !this.panel.visible ||
      this.picking ||
      this.activeSpiritMenu ||
      this.spiritMenuOpening ||
      this.multiplayer?.busy ||
      this.spiritSelectionPending
    ) return;
    const snapshot = this.profile.spiritSnapshot();
    if (snapshot.spirits.length === 0) {
      await this.targetPicker.showMessagePopup("HaveNoSpirits");
      return;
    }
    if (!snapshot.full) {
      await this.targetPicker.showMessagePopup("HeroNotFull");
      return;
    }
    this.spiritMenuOpening = true;
    try {
      const menu = await SpiritMenu.show(this.scene, {
        assets: this.game.assets,
        scale9: this.game.scale9,
        ticker: this.stage.app.ticker,
        gameData: this.game.gd,
        strings: this.game.strings,
        profile: this.profile,
        onClick: () => this.audio.playSfx("click"),
        onClose: () => {
          if (this.activeSpiritMenu === menu) this.activeSpiritMenu = undefined;
        },
        onSelect: (item) => {
          if (item.kind !== "spirit" || item.shortType === undefined) return;
          void this.selectSpirit(item).catch((error: unknown) => {
            console.error("Hero spirit selection failed", error);
            queueMicrotask(() => { throw error; });
          });
        },
      });
      if (this.lifecycle.disposed) {
        menu.destroy({ children: true });
        return;
      }
      this.activeSpiritMenu = menu;
    } finally {
      this.spiritMenuOpening = false;
    }
  }

  private async presentMultiplayerSummon(events: readonly BattleEvent[], id: string): Promise<void> {
    this.applyStatusOverlayEvents(events);
    await this.applyRosterEvents(events);
    if (this.lifecycle.disposed) return;
    const removed = turnOrderResolutionPlan(events).teamRemovedIds;
    if (removed.length) this.startPresentationTask(this.turnOrder.notifyTeamRemovedMonsters(removed), "PvP spirit replacement");
    await this.turnOrder.notifyTeamAddedMonsters([id]);
  }

  private async selectSpirit(item: SpiritMenuItemModel): Promise<void> {
    if (item.kind !== "spirit" || item.shortType === undefined || this.spiritSelectionPending) return;
    this.spiritSelectionPending = true;
    try {
      // Native order: Team.setSummon first, then Player.spiritSummoned (+33 XP/spend/lock), then
      // setAi. BattleCore stamps AI at construction but otherwise preserves that observable order.
      if (this.multiplayer) {
        const result = await this.multiplayer.summon(item.shortType);
        if (this.lifecycle.disposed) return;
        this.profile.useSpirit(item.shortType);
        if (result.spiritId) await this.presentMultiplayerSummon(result.events, result.spiritId);
        return;
      }
      const savedXp = this.profile.spiritSavedXp(item.shortType);
      await this.submitAuthoritative({
        type: "battle.summonSpirit",
        battleId: this.requireAuthoritativeBattleId(),
        shortType: item.shortType,
      });
      const result = this.session.summonSpirit(item.shortType, savedXp);
      this.profile.useSpirit(item.shortType);
      await this.applyRosterEvents(result.events);


      if (!this.lifecycle.disposed) await this.turnOrder.notifyTeamAddedMonsters([result.id]);
    } finally {
      this.spiritSelectionPending = false;
    }
  }

  private async openLivingInfo(id: string): Promise<void> {
    if (this.picking) return; // seam 2: no info popups while a pick is in progress
    const shortType = this.session.shortTypeOf(id);
    const monster = this.game.gd.monsterByShortType(shortType);
    const level = this.roster.entryOf(id).setup.level;
    // Ability rows — the original's `[living abilities]`: the turn panel's usable-combat set
    // PLUS every passive (non-`usableN`-slot) job ref, each localized per
    // `-[Renderable localizedName]` (see LivingInfoSnapshot.abilities' doc). Soul stones grant
    // no abilities in shipped data, so job refs are the complete list.
    const abilities: LivingInfoAbility[] = buildPlayerChoices(this.game.gd, shortType).map(
      (choice) => ({
        kind: "usable",
        choice: {
          ...choice,
          displayName: localizedRenderableName(this.game.strings, [
            choice.displayName,
            choice.abilityPath.split(".").at(-1)!,
          ]),
        },
      }),
    );
    for (const ref of this.game.gd.jobAbilitiesOrEmpty(shortType)) {
      if (/^usable\d+$/.test(ref.slot)) continue;
      const typeName = ref.type.split(".").at(-1)!;
      const instanceName = ref.arguments["instanceName"];
      abilities.push({
        kind: "passive",
        ref,
        displayName: localizedRenderableName(this.game.strings, [
          typeof instanceName === "string" ? instanceName : typeName,
          typeName,
        ]),
      });
    }




    const statEnum: ReadonlyArray<[1 | 2 | 3 | 4 | 5, StatName]> = [
      [1, "Attack"],
      [2, "Magic"],
      [3, "Speed"],
      [4, "Defense"],
      [5, "Resist"],
    ];
    const effectiveStats = this.session.effectiveStatsOf(id);
    const stats = statEnum
      .map(([statType, statName]) => ({ statType, value: effectiveStats[statName] }))
      .filter((row) => row.value >= 1);
    // Equipped soul stone — LIVE engine state (`childrenOfType:[SoulStone class]` — the section
    // must disappear after Desoul consumes the stone, so the roster setup is NOT the source).
    // Name via the `Renderable<Element>SoulStoneNameKey` table (all 7 present — e.g. "Fire Soul
    // Stone"); stat table = the stone's OWN isolated bonuses (soulstone-info-display.md §1/§3.1).
    const stone = this.session.soulStoneOf(id);
    const soulStones: LivingInfoSoulStone[] = stone === undefined
      ? []
      : [{
          name: localizedRenderableName(this.game.strings, [`${stone.element}SoulStone`]),
          stats: soulStoneStatRows(stone.level, this.game.gd.soulStoneByElement(stone.element).enabledStats),
        }];
    // Monsterpedia evolve-chain rows (evolve-chain-rows.md §3): per-stage unlock gate =
    // `highestLevelMonsterOfSimpleType: chain[i+1] > 0`, the SAME collection query as the
    // capture-card NEW! overlay — so the real save-data layer lights these up through the
    // identical `PlayerCollection` seam (standalone fixture: configured profile; world: live
    // profile). rendererScale mirrors every other RendererFactory-node snapshot.
    const evolveRows: LivingInfoEvolveRow[] = evolveChainInfoRows(
      this.game.gd.evolveChainOf(shortType),
      (t) => this.collection.hasCapturedSimpleType(t),
      (t) => this.game.gd.monsterByShortType(t),
    ).map((row) => {
      const rowScale = rendererScaleOf(this.game.gd.monsterByShortType(row.shortType).rendererData);
      return { ...row, ...(rowScale !== undefined ? { rendererScale: rowScale } : {}) };
    });







    const xpPenalty = this.game.gd.jobXpPenalty(shortType);
    const durableXpSource = this.roster.entryOf(id).setup.sourceInstanceId;
    const durableMonster = durableXpSource === undefined ? undefined : this.tripParty?.monster(durableXpSource);
    const xpLevel = durableMonster?.level ?? level;
    const levelBoundaryXp = jobXpForLevel(xpLevel, xpPenalty);
    const xpThisLevel = (durableMonster?.cumulativeXp ?? levelBoundaryXp) - levelBoundaryXp;
    const snapshot: LivingInfoSnapshot = {
      name: this.displayNameOf(id),
      monster,
      level,
      hp: this.hp.get(id) ?? this.session.maxHpOf(id),
      maxHp: this.session.maxHpOf(id),
      xpThisLevel,
      xpCostOfNextLevel: jobXpCostOfNextLevel(xpLevel, xpPenalty),
      stats,
      abilities,
      soulStones,
      evolveRows,
    };
    await this.targetPicker.showLivingInfo(snapshot, (ability) => ability.kind === "usable"
      ? buildAbilityInfoModel(
        this.game.gd,
        this.game.strings,
        shortType,
        ability.choice,
        this.abilityInfoContext(id),
      )
      : buildPassiveAbilityInfoModel(
        this.game.gd,
        this.game.strings,
        ability.ref,
        ability.displayName,
        this.abilityInfoContext(id),
      ));
  }

  private abilityInfoContext(id: string): AbilityInfoContext {
    const entry = this.roster.entryOf(id);
    const monster = this.game.gd.monsterByShortType(entry.setup.shortType);
    const magnify = this.session.magnifySourceContextOf(id);
    return {
      level: entry.setup.level,
      stats: this.session.effectiveStatsOf(id),
      element: monster.element,
      timeInCombat: magnify.sourceTimeInCombat,
      friendlyDeadCount: magnify.friendlyDeadCount,
      enemyDeadCount: magnify.enemyDeadCount,
      friendlyActiveCount: magnify.friendlyActiveCount,
      killsMade: magnify.sourceKillsMade,
    };
  }

  /** Combined lookup across both team displays (seam 1) — fail-loud for an id neither owns. */
  private nodeOf(id: string): Container {
    const node = this.tryNode(id);
    if (!node) throw new Error(`BattleNode.nodeOf: unknown living id "${id}"`);
    return node;
  }

  private tryNode(id: string): Container | null {
    try {
      return this.enemyDisplay.nodeOf(id);
    } catch {
      /* not an enemy — fall through */
    }
    try {
      return this.friendlyDisplay.nodeOf(id);
    } catch {
      /* not a friend either */
    }
    return null;
  }

  /** Exact inputs to `AbilityRenderer handleAbilityResults:`'s display-area construction:
   *  living-display node origin + its authored contentSize, never its children-derived bounds. */
  private tryEffectArea(id: string): TargetDisplayArea | null {
    try {
      return {
        node: this.enemyDisplay.nodeOf(id),
        width: ENEMY_SLOT_WIDTH,
        height: ENEMY_SLOT_HEIGHT,
      };
    } catch {
      /* not an enemy — fall through */
    }
    try {
      const card = this.friendlyDisplay.nodeOf(id);
      return { node: card, width: card.contentWidth, height: card.contentHeight };
    } catch {
      /* not a friend either */
    }
    return null;
  }

  private targetNodeOf(id: string): Container {
    try {
      return this.enemyDisplay.targetNodeOf(id);
    } catch {
      /* not an enemy */
    }
    return this.friendlyDisplay.targetNodeOf(id);
  }

  private setPresentationState(state: string): void {
    this.presentationState = state;
    this.presentationStateSinceMs = this.elapsedPresentationMs;
  }

  private enemyBenchPoint(): { x: number; y: number } | null {
    const global = this.enemyDisplay.benchLabelGlobalCenter;
    if (!global || !this.scene) return null;
    const point = this.scene.toLocal(global);
    return { x: point.x, y: point.y };
  }

  /** Concise deterministic state used by browser choreography and screenshot checkpoints. */
  renderGameState(): Record<string, unknown> {
    const monsters: Array<Record<string, unknown>> = [];
    if (this.built && this.scene) {
      for (const { id, team } of this.roster.entries()) {
        const display = this.tryNode(id);
        if (!display) continue;
        const displayPos = this.scene.toLocal(display.getGlobalPosition());
        const target = this.targetNodeOf(id);
        const targetPos = this.scene.toLocal(target.getGlobalPosition());
        const hitRef = this.targetRefOf(id);
        const hitGlobal = this.targetRefGlobalBounds(hitRef);
        const hitTl = this.scene.toLocal({ x: hitGlobal.x, y: hitGlobal.y });
        const hitBr = this.scene.toLocal({
          x: hitGlobal.x + hitGlobal.width,
          y: hitGlobal.y + hitGlobal.height,
        });
        const elementGlobal = team === 1 ? this.enemyDisplay.elementIconGlobalCenterOf(id) : null;
        const elementPoint = elementGlobal ? this.scene.toLocal(elementGlobal) : null;
        const effectArea = this.tryEffectArea(id);
        const effectRect = effectArea ? targetContentRectInLayer(effectArea, this.effectLayer) : null;
        monsters.push({
          id,
          team,
          ...(this.session.sourceInstanceIdOf(id) === undefined
            ? {}
            : { sourceInstanceId: this.session.sourceInstanceIdOf(id) }),
          level: this.roster.entryOf(id).setup.level,
          aiControlled: this.session.isAiControlled(id),
          hp: this.hp.get(id) ?? 0,
          maxHp: this.session.maxHpOf(id),
          effectiveStats: this.session.effectiveStatsOf(id),
          haste: this.session.hasteOf(id),
          activeBuffs: this.session.activeBuffsOf(id),
          statusEffects: this.session.statusEffectsOf(id),
          statusOverlays: this.statusOverlays.debugStateOf(id),
          statusOverlayParticles: { Poison: this.statusOverlays.debugPoisonParticleCountOf(id) },
          visible: display.visible && (team === 0 ? this.friendlyDisplay.visible : this.enemyDisplay.visible),
          displayPoint: { x: displayPos.x, y: displayPos.y },
          targetPoint: { x: (hitTl.x + hitBr.x) / 2, y: (hitTl.y + hitBr.y) / 2 },
          targetScale: { x: target.scale.x, y: target.scale.y },
          targetSize: { w: Math.abs(hitBr.x - hitTl.x), h: Math.abs(hitBr.y - hitTl.y) },
          visualTargetPoint: { x: targetPos.x, y: targetPos.y },
          visualTargetSize: { w: target.width, h: target.height },
          ...(effectRect ? { effectRect } : {}),
          ...(team === 1 ? { starGroups: this.enemyDisplay.activeStarGroupCountOf(id) } : {}),
          ...(team === 1
            ? {
                captureStatus: this.session.captureStatusOf(id),
                captureChancePercent: {
                  1: Math.round(this.session.captureChanceOf(id, 1, this.profile.capturePartyLevel()) * 100),
                  2: Math.round(this.session.captureChanceOf(id, 2, this.profile.capturePartyLevel()) * 100),
                  3: Math.round(this.session.captureChanceOf(id, 3, this.profile.capturePartyLevel()) * 100),
                },
              }
            : {}),
          ...(elementPoint ? { elementPoint: { x: elementPoint.x, y: elementPoint.y } } : {}),
        });
      }
    }
    return {
      coordinateSystem: `battle points ${SCREEN_W}x${SCREEN_H}, origin top-left after Cocos Y flip, +x right, +y down; mounted x2 on stage`,
      // Structured geometry for browser harness coordinate mapping (display-mode agnostic).
      displayMode: DISPLAY_MODE,
      stagePx: { w: this.stage.width, h: this.stage.height },
      screenPt: { w: SCREEN_W, h: SCREEN_H },
      mode: this.built ? "battle" : "building",
      buildPhase: this.buildPhase,
      presentation: {
        state: this.presentationState,
        elapsedMs: this.elapsedPresentationMs,
        stateAgeMs: this.elapsedPresentationMs - this.presentationStateSinceMs,
        gameSpeed: this.gameSpeed,
      },
      entry: {
        transitionFinished: this.enterTransitionFinished,
        sceneVisible: this.scene?.visible ?? false,
        enemyEntranceStarted: this.built
          ? this.enemyDisplay.initialEntranceHasStarted
          : false,
      },
      activeActorId: this.activeActorId,
      activeAbilityPath: this.activeAbilityPath,
      battleInput: {
        latestSwipeTargetFeedback: this.latestSwipeTargetFeedback,
        swipeTargetFeedbackCount: this.swipeTargetFeedbackCount,
        playerAbilitySubmissionCount: this.playerAbilitySubmissionCount,
        latestPlayerSubmission: this.latestPlayerSubmission === null
          ? null
          : {
              ...this.latestPlayerSubmission,
              selectedTargetIds: [...this.latestPlayerSubmission.selectedTargetIds],
              submittedTargetIds: [...this.latestPlayerSubmission.submittedTargetIds],
            },
      },
      audio: this.audio.debugState,
      picking: this.picking,
      activePopup: this.built
        ? (this.activePlotTutorial ? "plotTutorial" : null) ??
          (this.activeEncounterChat ? "encounterChat" : null) ??
          (this.activeTerminalRetryPopup ? "terminalRetry" : null) ??
          (this.activeSpiritMenu ? "spiritMenu" : null) ??
          this.postBattlePopupKind ??
          this.analyzePopupKind ??
          this.secondaryPopupKind ??
          this.capturePopupKind ??
          this.targetPicker.activePopupKind ??
          (this.activeMonsterManagement ? "monsterManagement" : null)
        : null,
      encounter: {
        backgroundKey: this.encounter.backgroundKey,
        allowRetreat: this.encounter.allowRetreat,
        questKey: this.encounter.questKey ?? null,
        uniqueKey: this.encounter.uniqueKey ?? null,
        startChat: this.encounter.startChat?.name ?? null,
        winChat: this.encounter.winChat?.name ?? null,
      },
      tutorial: this.plotTutorialState ?? null,
      postBattle: this.built ? this.activeXpAwardDisplay?.debugState ?? null : null,
      postBattleButtons:
        this.built && this.scene && this.activePostBattlePopup
          ? this.activePostBattlePopup.buttonCenters.map(({ label, x, y }) => ({
              label,
              point: this.scene!.toLocal({ x, y }),
            }))
          : [],
      monsterManagement: this.built ? this.activeMonsterManagement?.debugState ?? null : null,
      monsterManagementOpening: this.built ? this.monsterManagementOpening : false,
      abilityInfo: this.built ? this.targetPicker.activeAbilityInfoState : null,
      abilityInfoButtons: this.built ? this.panel.abilityInfoButtonStates() : [],
      abilityButtons: this.built ? this.panel.abilityButtonStates() : [],
      targetPickerVisuals: this.built ? this.targetPicker.visualState : { outlines: [], cancel: null },
      actingCardLayout: this.built ? this.panel.actingCardLayoutState() : null,
      friendlyCardLayouts: this.built ? this.friendlyDisplay.cardLayoutStates : [],
      friendlyMemberPositions: this.built ? this.friendlyDisplay.memberPositionState : [],
      // Summon-slot presentation (soulstones.md §10.11): occupant card geometry, evicted cards
      // still riding the 1.5s removal linger, the spirit-box toggle, and the engine's own slots.
      friendlySummon: this.built ? this.friendlyDisplay.summonDisplayState ?? null : null,
      lingeringSummonCards: this.built ? this.friendlyDisplay.lingeringSummonCount : 0,
      spiritBackgroundVisible: this.built ? this.friendlyDisplay.spiritBackgroundVisible ?? null : null,
      summonIds: this.built ? [this.session.summonIdOf(0) ?? null, this.session.summonIdOf(1) ?? null] : [null, null],
      spirit: this.built
        ? {
            profile: this.profile.spiritSnapshot(),
            tiers: buildSpiritMenuItems(this.profile.spiritSnapshot(), this.game.gd, this.game.strings)
              .filter((item) => item.kind === "spirit"),
            fieldHero: this.friendlyDisplay.heroState,
            panelHero: this.panel.heroState,
            menu: this.activeSpiritMenu?.debugState ?? null,
            menuOpening: this.spiritMenuOpening,
            selectionPending: this.spiritSelectionPending,
          }
        : null,
      capture: this.built
        ? {
            inventory: this.profile.snapshot(),
            partyLevelUsed: this.profile.capturePartyLevel(),
            pendingCapturedIds: this.session.capturedIds(),
            adjacentCardTargetIds: this.panel.captureButtonTargetIds(),
          }
        : null,
      panelVisible: this.built ? this.panel.visible : false,
      secondaryActions: this.built ? this.panel.secondaryButtonStates() : [],
      hasConfirmedSkip: this.hasConfirmedSkip,
      latestSecondaryAction: this.latestSecondaryAction,
      statusText: this.built
        ? { visible: this.statusText.visible, text: this.statusText.buffer.combined }
        : { visible: false, text: null },
      statusTextPages: this.built ? [...this.statusText.pendingPages] : [],
      pendingLevelUpPages: this.built ? [...this.pendingLevelUpPages] : [],
      postBattleParty: this.built
        ? this.postBattleParty
          ? {
              batting: this.postBattleParty.batting.map((m) => ({ ...m })),
              bench: this.postBattleParty.bench.map((m) => ({ ...m })),
            }
          : null
        : null,
      evolutionOverlayActive: this.built ? this.evolutionOverlay !== undefined && !this.evolutionOverlay.destroyed : false,
      friendlyRowVisible: this.built ? this.friendlyDisplay.visible : false,
      friendlyPopForwardCount: this.built ? this.friendlyDisplay.activePopForwardCount : 0,
      friendlyPopForwardLayers: this.built ? this.friendlyDisplay.popForwardPaintState : [],
      friendlyPopForwardStarts: this.built ? this.friendlyDisplay.popForwardStartCount : 0,
      enemyAbilityPulseStarts: this.built ? this.enemyDisplay.abilityPulseStartCount : 0,
      enemyAbilityPulseStartsById: this.built
        ? Object.fromEntries(
            this.enemyDisplay.memberPositionState.map((m) => [
              m.id,
              this.enemyDisplay.abilityPulseStartCountOf(m.id),
            ]),
          )
        : {},
      activeEffects: this.built ? this.effectLayer.children.length : 0,
      activeEffectNodes: this.built
        ? this.effectLayer.children.map((node) => ({
            label: node.label,
            zIndex: node.zIndex,
            x: node.position.x,
            y: node.position.y,
            scaleX: node.scale.x,
            scaleY: node.scale.y,
            rotation: node.rotation,
            alpha: node.alpha,
          }))
        : [],
      queue: this.built ? this.session.queueOrder() : [],
      // Box-local positions + parented flags of the live enemy displays — the entrance/reorder
      // browser scenarios assert the drop-in start, stagger, and the promoted reserve's 1.0s
      // unparented window from these.
      enemyMemberPositions: this.built ? this.enemyDisplay.memberPositionState : [],
      enemyBenchCountShown: this.built ? this.enemyDisplay.benchCountShown : 0,
      enemyBenchCenter: this.built ? this.enemyBenchPoint() : null,
      enemyAnalyze: this.built
        ? {
            ...this.enemyDisplay.analyzeState,
            analyzedMonsterIds: this.enemyDisplay.analyzedMonsterIds,
          }
        : { enabled: false, blinking: false, labelVisible: false, analyzedMonsterIds: [] },
      friendlyBenchCount: this.built ? this.session.benchCountOf(0) : 0,
      enemyBenchIds: this.built ? this.session.benchIdsOf(1) : [],
      displayedQueue: this.built ? [...this.turnOrder.displayedOrder] : [],
      turnOrderEntries: this.built ? this.turnOrder.liveEntryState : [],
      turnOrderAtTurnStart: this.built ? this.turnOrderAtTurnStart : null,
      turnOrderAnimating: this.built ? this.turnOrder.isAnimatingFrontChange : false,
      // Source-event divergence trace. `membershipSafetyNet` must stay 0 (roster events are
      // the source's only membership writer); `liveCallbacks` vs `battleTimeNotifications`
      // is what proves a burst converges in one callback horizon instead of N of them.
      turnOrderCounters: this.built ? { ...this.turnOrder.counters } : null,
      turnOrderFalling: this.built ? this.turnOrder.fallingEntryState : [],
      monsters,
    };
  }

  private pickerSfx(): { onClick: () => void; onNotAllowed: () => void } {
    return {
      onClick: () => this.audio.playSfx("click"),
      onNotAllowed: () => this.audio.playSfx("notAllowed"),
    };
  }






  private playMusicTrack(category: string, trackCount: number, loop: boolean): void {
    this.audio.requestMusic(category, trackCount, loop, (count, shouldLoop) => {
      const n = 1 + (this.sourceRng?.intBelow(count) ?? Math.floor(Math.random() * count));
      this.audio.playMusic(this.game.assets.audioUrl(`${category}${n}`), {
        loop: shouldLoop,
        assetName: `${category}${n}.mp3`,
      });
    });
  }

  private sourceRandom(): number {
    return this.sourceRng?.next() ?? Math.random();
  }

  private popupSfx(): { onButtonPress: () => void; onButtonBlocked: () => void } {
    return {
      onButtonPress: () => this.audio.playSfx("click"),
      onButtonBlocked: () => this.audio.playSfx("notAllowed"),
    };
  }

  private monsterHatchEnvironment(parent: Container) {
    return {
      parent,
      assets: this.game.assets,
      scale9: this.game.scale9,
      ticker: this.stage.app.ticker,
      zIndex: 1000,
      sfx: this.popupSfx(),
    };
  }
















  gameSpeed = readTestGameSpeed();

  private sleep(ms: number): Promise<void> {
    const scaled = ms / this.gameSpeed;
    return scaled <= 0
      ? Promise.resolve()
      : tween(this.stage.app.ticker, scaled, () => {}, (t) => t, this.lifecycle.signal);
  }













  private timeDelay = 0;


  private notYourTurnShown = false;


  private readonly handleNotYourTurnProbe = (): void => {
    if (!this.built || !this.enterTransitionFinished) return;
    if (!this.pointRoot.visible || this.scene?.visible !== true) return;
    if (this.evolutionOverlay !== undefined) return;
    if (this.timeDelay <= TIME_DELAY_RESIDUE_MS) return;
    if (this.notYourTurnShown) return;
    const flag = nextNotYourTurnFlag((key) => this.profile.hasTutorialFlag(key));
    if (flag === null) return; // six lifetime slots spent; never shows again for this save
    this.notYourTurnShown = true;
    this.profile.claimTutorialFlag(flag);
    void this.authority?.claimTutorialFlag(flag).catch((error: unknown) => {
      console.error("BattleNode: NOT YOUR TURN tutorial flag claim failed", error);
    });
    void showNotYourTurnBanner({
      parent: this.scene,
      ticker: this.stage.app.ticker,
      text: localizedString(this.game.strings, "NotYourTurnKey"),
      screenW: SCREEN_W,
      screenH: SCREEN_H,
      mode: DISPLAY_MODE,
      zIndex: NOT_YOUR_TURN_BANNER_Z,
      signal: this.lifecycle.signal,
    }).catch((error: unknown) => {
      console.error("BattleNode: NOT YOUR TURN banner failed", error);
    });
  };


  private awaitTimeDelay(addMs: number): Promise<void> {
    if (!Number.isFinite(addMs)) throw new Error(`BattleNode.awaitTimeDelay: invalid hold ${addMs}`);
    if (addMs <= 0 && this.timeDelay <= 0) return Promise.resolve();
    this.timeDelay += addMs;
    return this.drainTimeDelay();
  }




  private drainTimeDelay(): Promise<void> {
    const ticker = this.stage.app.ticker;
    const signal = this.lifecycle.signal;
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        ticker.remove(step);
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const step = (): void => {
        // `> TIME_DELAY_RESIDUE_MS`, not `> 0`. The source counts a float ivar down against float
        // frame deltas; this port subtracts doubles whose running sum lands a few ulps either side
        // of the charge. Landing at +1.8e-13 is not another frame of hold in the source -- it is
        // arithmetic dust, and testing it against zero spends a whole 16.7ms frame on it. That
        // made the terminal victory gate nondeterministic in the browser: the same 2500ms hold
        // dispatched after one frame on some runs and two on others. Nine orders below a frame,
        // so any real remaining hold still survives the comparison.
        if (this.timeDelay > TIME_DELAY_RESIDUE_MS) {
          this.timeDelay -= this.gameSpeed * ticker.deltaMS;
          return;
        }
        finish();
      };
      const onAbort = (): void => finish();
      signal.addEventListener("abort", onAbort, { once: true });
      ticker.add(step);
    });
  }

  /** Resolves on the next Pixi update, the port's counterpart to one later BattleNode update call. */
  private waitForBattleUpdate(): Promise<void> {
    const ticker = this.stage.app.ticker;
    const signal = this.lifecycle.signal;
    return new Promise((resolve) => {
      if (signal.aborted) {
        resolve();
        return;
      }
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        ticker.remove(onUpdate);
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onUpdate = (): void => finish();
      const onAbort = (): void => finish();
      signal.addEventListener("abort", onAbort, { once: true });
      ticker.add(onUpdate);
    });
  }
}

/** Reads the harness-only battle-speed override (see `BattleNode.gameSpeed`). Absent in every
 *  normal session, so the returned value is the source's 1.0 unless a scenario opts in. Rejects
 *  non-finite and non-positive values outright: a zero or negative multiplier would turn the
 *  fixed-duration waits into an infinite or negative sleep rather than failing visibly. */
function readTestGameSpeed(): number {
  const override = (globalThis as Record<string, unknown>)["__DIB_TEST_GAME_SPEED__"];
  if (override === undefined) return 1;
  if (typeof override !== "number" || !Number.isFinite(override) || override <= 0) {
    throw new Error(`__DIB_TEST_GAME_SPEED__ must be a positive finite number, got ${String(override)}`);
  }
  return override;
}
