import {
  EGG_REEL_REPLAY_FRICTION_MAX,
  EGG_REEL_MIN_HELD_FRAMES,
  EggReel,
  dungeonGemItemTier,
  type EggHatchKind,
  type EggHatchPrize,
  type EggHatchPool,
  type EggReelState,
  type Rng,
} from "@dib/engine";
import {
  Box,
  createRenderableSpriteNode,
  makeTtfLabel,
  pointSprite,
} from "@dib/renderer";
import {
  Container,
  Rectangle,
  Sprite,
  type FederatedPointerEvent,
  type Spritesheet,
  type Texture,
  type Ticker,
} from "pixi.js";
import type { LoadedGame } from "../loadGame.js";
import type { AudioPlayer } from "../audio.js";
import type { PlayerRuntimeState } from "../player/playerRuntimeState.js";
import {
  runInsufficientFundsStoreHandoff,
  type OpenGoldStoreHandoff,
} from "../player/goldStoreHandoff.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { sourcePointsPerPortPoint } from "../displayMode.js";
import {
  buildMonsterHatchMessageContent,
  showMonsterHatchPopup,
} from "../ui/monsterHatchPopup.js";
import {
  createMonsterManagementNode,
  type MonsterManagementDebugState,
  type MonsterManagementNode,
} from "../battle/monsterManagementNode.js";
import {
  buildAbilityInfoContent,
  buildElementHelpContent,
  buildLivingInfoContent,
  buildSoulStoneInfoContent,
  ITEM_INFO_GAP_BEFORE_BUTTONS,
  LIVING_STAT_NAMES,
  type ElementHelpName,
} from "../battle/infoDisplays.js";
import { localizedRenderableName, localizedString } from "../localization.js";
import { monsterpediaHalfStarTexture } from "./monsterpediaCard.js";
import { dungeonGemGlowAlpha } from "../dungeon/dungeonLootPageModel.js";
import { DIRECTOR_INTERFACE_Z_INDEX, PopupHost } from "../ui/popup.js";
import {
  buildPartyAbilityInfoModel,
  buildPartyLivingInfoSnapshot,
  type PartyLivingInfoContext,
} from "./partyLivingInfoModel.js";
import {
  easeElasticInOut,
  easeExponentialInOut,
  tween,
} from "../tween.js";
import {
  EGG_PREVIEW_STAR_FINAL_SCALE,
  EGG_PREVIEW_STAR_MOVE_MS,
  EGG_PREVIEW_STAR_SCALE_MS,
  advanceEggGemGlowClock,
  eggAllowsSecondSpin,
  eggFeedMessageKey,
  eggHatchLayout,
  eggMonsterPreviewScale,
  eggPreviewEntryLayouts,
  eggPreviewStarEntry,
  eggPreviewStarAttachment,
  eggPreviewStarGeometry,
  eggProviderAmountFontSize,
  eggProviderFitScale,
  eggReelEntryLayouts,
} from "./eggHatchMath.js";
import {
  createLocalEggHatchSession,
  type EggHatchSession,
  type EggHatchSpin,
  type EggReleaseCommitment,
} from "./eggHatchSession.js";

const SLOT_Z = 90;
const SLOT_DECORATION_Z = SLOT_Z + 1;

/** Fixed replay step shared with Official heldFrames. Native SlotMachineNode uses elapsed dt. */
const REEL_FRAME_MS = 1000 / 60;
/**
 * Frames a single browser tick may replay. A backgrounded tab hands back an arbitrarily large
 * delta; the reel resumes rather than teleporting, and the held-frame count the authority replays
 * is this counter either way, so nothing desynchronizes.
 */
const REEL_MAX_CATCHUP_FRAMES = 8;
/**
 * Frames spent easing the provisional coast onto the committed one. The provisional uses the
 * fastest friction the draw can produce, which always travels the least, so the displayed reel is
 * never ahead of the committed one and the correction is monotonically forward.
 */
const RELEASE_BLEND_FRAMES = 12;

/**
 * The presentation reel is a replay, never a source of chance: the friction that decides a landing
 * belongs to the session (locally, the demo stream; online, the server, after the release point is
 * committed). Any draw here would be a second, divergent roll.
 */
const PRESENTATION_RNG: Rng = Object.freeze({
  next: (): number => { throw new Error("Egg hatch presentation must not draw randomness"); },
  intBelow: (): number => { throw new Error("Egg hatch presentation must not draw randomness"); },
  chance: (): boolean => { throw new Error("Egg hatch presentation must not draw randomness"); },
});

export interface EggHatchFlowOptions {
  readonly parent: Container;
  readonly owner: object;
  readonly game: LoadedGame;
  readonly audio: AudioPlayer;
  readonly ticker: Ticker;
  readonly player: PlayerRuntimeState;
  /**
   * Demo/offline hatching stream. Exactly one of `rng` and `session` must be supplied: `rng` builds
   * a local session that owns the pool, the previews, and the friction draw, while `session` hands
   * all three to an authority.
   */
  readonly rng?: Rng;
  /** Fidelity-Lab-only normalization matching the emulator's NSDictionary traversal. */
  readonly foundationDictionaryOrder?: "lexicographic";
  readonly session?: EggHatchSession;
  readonly kind: EggHatchKind;



  readonly allowSecondSpin?: boolean;
  /** `Egg.numRepeats`: select this many registered species before constructing the reel. */
  readonly repeatPicks?: number;
  /** Internal transient mirror of native `Egg.eggPicks`, populated by {@link show}. */
  readonly scriptedProviders?: readonly EggHatchPrize[];
  readonly onStateChanged: () => void;
  readonly nextMonsterInstanceId: (shortType: string) => string;
  /** Source `spinAgain:` mounts Store category 3 before showing CannotAffordThing. */
  readonly openGoldStore: OpenGoldStoreHandoff;
  readonly onClose?: () => void;
}

interface ReelEntry {
  readonly prize: EggHatchPrize;
  readonly root: Container;
}

export interface EggHatchDebugState {
  readonly open: true;
  readonly kind: EggHatchKind;
  readonly phase: "rolling" | "reward" | "feed" | "question";
  readonly pressed: boolean;
  readonly poolCount: number;
  readonly providers: readonly EggHatchPrize[];
  readonly reelPrizes: readonly EggHatchPrize[];
  readonly heldFrames: number;
  readonly releasedAtFrame: number | null;
  readonly reel: EggReelState | null;
  readonly gemGlowElapsedMs: number;
  readonly selected: EggHatchPrize | null;
  readonly visibleEntries: readonly {
    index: number;
    prize: EggHatchPrize;
    x: number;
    y: number;
    selected: boolean;
  }[];
  readonly previewMonsters: readonly string[];
  readonly feedPicker: MonsterManagementDebugState | null;
}

/**
 * `SlotMachineNode` + the standard Silver/Golden `Egg` rewarder. One flow survives paid repeats;
 * each spin owns exactly one generated reel and one Casino music request.
 */
export class EggHatchFlow {
  private readonly root = new Container();
  private readonly layout = eggHatchLayout(DISPLAY_MODE);
  private reel: EggReel | undefined;
  private reelState: EggReelState | undefined;
  private pool: EggHatchPool | undefined;
  private entries: readonly ReelEntry[] = [];
  private selectedPrize: EggHatchPrize | undefined;
  private previewMonsters: readonly string[] = [];
  private gemGlows: Sprite[] = [];
  private gemGlowClock = { elapsedMs: 0, firstTick: true };
  private previewStarAnimationStarts: Array<() => void> = [];
  private feedPicker: MonsterManagementNode | undefined;
  private feedInspectionPending = false;
  private resolveFeedPicker: (() => void) | undefined;
  private activePointer: number | undefined;
  private phase: EggHatchDebugState["phase"] = "rolling";
  private closed = false;
  private casinoOwned = false;
  /** Whole 1/60-second reel updates run by the current spin, i.e. the release point once tapped. */
  private frameIndex = 0;
  private frameCarryMs = 0;
  private releasedAtFrame = 0;
  private released = false;
  private committedReel: EggReel | undefined;
  private commitment: EggReleaseCommitment | undefined;
  private blendFrames = 0;
  private failure: unknown;
  /** `Egg._initWithName:dictionary:arguments:` snapshots this once; paid repeats reuse it. */
  private readonly allowSecondSpin: boolean;
  private readonly session: EggHatchSession;
  private resolveFinished!: () => void;
  private rejectFinished!: (error: unknown) => void;
  readonly finished: Promise<void>;

  private constructor(private readonly opts: EggHatchFlowOptions) {
    if ((opts.rng === undefined) === (opts.session === undefined)) {
      throw new Error("Egg hatching needs exactly one of a local rng or an authoritative session");
    }
    this.allowSecondSpin = opts.allowSecondSpin ??
      eggAllowsSecondSpin(opts.player.profile.heroLevel);
    this.session = opts.session ?? createLocalEggHatchSession({
      game: opts.game.gd,
      kind: opts.kind,
      rng: opts.rng!,
      ...(opts.foundationDictionaryOrder === undefined
        ? {}
        : { foundationDictionaryOrder: opts.foundationDictionaryOrder }),
      playerView: () => this.playerView(),
      spendGold: (cost) => opts.player.profile.spendGold(cost),
      allowSecondSpin: this.allowSecondSpin,
      ...(opts.scriptedProviders === undefined
        ? {}
        : { scriptedProviders: opts.scriptedProviders }),
    });
    this.finished = new Promise<void>((resolve, reject) => {
      this.resolveFinished = resolve;
      this.rejectFinished = reject;
    });
    this.root.label = `eggHatch:${opts.kind}`;
    this.root.sortableChildren = true;
    // Player.hatchEgg: adds SlotMachineNode to the same director notification node as StoreNode.
    // Give retained interfaces equal z so Pixi's stable child order preserves that later add.
    this.root.zIndex = DIRECTOR_INTERFACE_Z_INDEX;
    this.root.eventMode = "static";
    this.root.cursor = "pointer";
    this.root.hitArea = new Rectangle(0, 0, this.layout.screen.w, this.layout.screen.h);
    this.root.on("pointerdown", this.pointerDown);
    this.root.on("pointerup", this.pointerEnded);
    this.root.on("pointerupoutside", this.pointerEnded);
    // Native implements no ccTouchCancelled:. Clearing ownership without release preserves that.
    this.root.on("pointercancel", this.pointerCancelled);
  }

  static async show(opts: EggHatchFlowOptions): Promise<EggHatchFlow> {
    if (opts.player.party === undefined) {
      throw new Error("Egg hatching requires a durable world party");
    }
    // `Player.hatchEgg:` mounts SlotMachineNode on CCDirector.notificationNode. Resolve the same
    // director-owned root as automatic popups so an Egg awarded by a still-open scene interface
    // remains above that interface for its complete reel/picker/question lifetime.
    const parent = PopupHost.presentationParentFor(opts.parent);
    const scriptedProviders = opts.repeatPicks === undefined
      ? undefined
      : await selectRepeatEggProviders({ ...opts, parent }, opts.repeatPicks);
    const flow = new EggHatchFlow({
      ...opts,
      parent,
      ...(scriptedProviders === undefined ? {} : { scriptedProviders }),
    });
    await flow.enter();
    return flow;
  }

  /**
   * Pick the continuation up where it stands. Only a spin that has not landed yet renders a reel:
   * `-[SlotMachineNode update:]` removes the node the instant it stops, so a resumed landing or a
   * resumed repeat question is popups alone in the source too.
   */
  private async enter(): Promise<void> {
    const entry = this.session.entry;
    if (entry.phase === "spin") {
      await this.beginSpin();
      return;
    }
    this.root.eventMode = "none";
    if (entry.phase === "prize") {
      this.phase = "reward";
      this.selectedPrize = entry.landedPrize;
      void this.guarded(this.presentPrize(entry.landedPrize));
      return;
    }
    this.phase = "question";
    // The settled prize survives the reload; the fed recipient's pre-feed level does not, so the
    // resumed question uses the plain finished/again wording rather than a feed-specific one.
    void this.guarded(
      this.showSpinQuestion(prizeDisplayName(this.opts.game, entry.settledPrize)),
    );
  }

  /** Routes a detached continuation failure into `finished` instead of an unhandled rejection. */
  private guarded(work: Promise<void>): Promise<void> {
    return work.catch((error: unknown) => { this.fail(error); });
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.failure = error ?? new Error("Egg hatch failed");
    this.dispose();
  }

  get debugState(): EggHatchDebugState {
    const layouts = this.reelState === undefined
      ? []
      : eggReelEntryLayouts(this.reelState, this.entries.length, DISPLAY_MODE);
    return {
      open: true,
      kind: this.opts.kind,
      phase: this.phase,
      pressed: this.activePointer !== undefined,
      poolCount: this.pool?.reel.length ?? 0,
      providers: this.pool?.providers ?? [],
      reelPrizes: this.pool?.reel ?? [],
      heldFrames: this.frameIndex,
      releasedAtFrame: this.released ? this.releasedAtFrame : null,
      reel: this.reelState ?? null,
      gemGlowElapsedMs: this.gemGlowClock.elapsedMs,
      selected: this.selectedPrize ?? null,
      visibleEntries: layouts.filter(({ visible }) => visible).map((entry) => ({
        index: entry.index,
        prize: this.entries[entry.index]!.prize,
        x: entry.x,
        y: entry.y,
        selected: entry.selected,
      })),
      previewMonsters: [...this.previewMonsters],
      feedPicker: this.feedPicker?.debugState ?? null,
    };
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.opts.ticker.remove(this.tick);
    this.opts.ticker.remove(this.tickFeedPicker);
    this.resolveFeedPicker?.();
    this.resolveFeedPicker = undefined;
    const feedPicker = this.feedPicker;
    this.feedPicker = undefined;
    if (feedPicker !== undefined && !feedPicker.destroyed) {
      feedPicker.parent?.removeChild(feedPicker);
      feedPicker.destroy({ children: true });
    }
    this.root.removeAllListeners();
    if (this.root.parent) this.root.parent.removeChild(this.root);
    if (!this.root.destroyed) this.root.destroy({ children: true });
    this.releaseCasinoMusic();
    if (this.failure === undefined) this.resolveFinished();
    else this.rejectFinished(this.failure);
    this.opts.onClose?.();
  }

  private async beginSpin(): Promise<void> {
    await this.renderSpin(await this.session.begin());
  }

  private async renderSpin(spin: EggHatchSpin): Promise<void> {
    this.phase = "rolling";
    this.selectedPrize = undefined;
    this.activePointer = undefined;
    this.frameIndex = 0;
    this.frameCarryMs = 0;
    this.releasedAtFrame = 0;
    this.released = false;
    this.committedReel = undefined;
    this.commitment = undefined;
    this.blendFrames = 0;
    this.gemGlowClock = { elapsedMs: 0, firstTick: true };
    this.root.eventMode = "static";
    this.pool = spin.pool;
    this.previewMonsters = spin.previewMonsterShortTypes;
    this.reel = new EggReel(spin.pool.reel.length, PRESENTATION_RNG);
    this.reelState = this.reel.state();
    await this.rebuildReel(spin.pool);
    this.opts.parent.addChild(this.root);
    this.previewStarAnimationStarts.splice(0).forEach((start) => start());
    this.opts.audio.lockMusic("Casino");
    this.opts.audio.playMusic(this.opts.game.assets.audioUrl("Casino1.mp3"), {
      loop: true,
      assetName: "Casino1.mp3",
    });
    this.casinoOwned = true;
    this.opts.ticker.add(this.tick);
  }

  private playerView() {
    const profile = this.opts.player.profile;
    const spiritXp = new Map(
      profile.spiritSnapshot().spirits.map(({ shortType, savedXp }) => [shortType, savedXp]),
    );
    return {
      highestRegisteredLevel: (shortType: string) => profile.highestRegisteredLevel(shortType),
      highestRegisteredLivingLevel: profile.highestRegisteredLivingLevel(),
      goldEggMonsterLevel: profile.goldEggMonsterLevel(),
      availableGemSlots: [0, 1, 2].filter((slot) =>
        slot < profile.licenseGemSlots) as (0 | 1 | 2)[],
      hasCombineRecipe: (shortType: string) => profile.hasCombineRecipe(shortType),
      spiritSavedXp: (shortType: string) => spiritXp.get(shortType) ?? 0,
    };
  }

  private async rebuildReel(pool: EggHatchPool): Promise<void> {
    this.opts.ticker.remove(this.tick);
    this.root.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.gemGlows = [];
    this.previewStarAnimationStarts = [];
    const assets = this.opts.game.assets;
    const [backgroundTexture, arrowTexture, backingTexture, inventory, largeStar] =
      await Promise.all([
        assets.sprite(this.layout.backgroundAsset),
        assets.sprite("SlotArrow-hd"),
        assets.sprite(this.layout.backingAsset),
        assets.atlas("InventoryItemFrames-hd"),
        assets.sprite("largeRarityStar-hd"),
      ]);

    const background = pointSprite(backgroundTexture);
    background.label = "eggHatch:background";
    background.zIndex = SLOT_Z;
    this.root.addChild(background);

    const built = await Promise.all(pool.reel.map(async (prize, index) => {
      const backing = pointSprite(backingTexture);
      const root = new Container();
      root.label = `eggHatch:reel:${index}:${prize.kind}`;
      root.boundsArea = new Rectangle(0, 0, this.layout.backing.w, this.layout.backing.h);
      root.addChild(backing);
      const display = await this.buildProviderDisplay(prize, inventory);
      const bounds = display.boundsArea ?? display.getLocalBounds();
      const fit = eggProviderFitScale(
        bounds.height,
        this.layout.backing.h,
      );
      display.scale.set(fit);
      const rendered = display.getLocalBounds();
      display.position.set(
        this.layout.backing.w / 2 - (rendered.x + rendered.width / 2) * display.scale.x,
        this.layout.backing.h / 2 - (rendered.y + rendered.height / 2) * display.scale.y,
      );
      root.addChild(display);
      return { prize, root };
    }));
    this.entries = Object.freeze(built);
    for (const { root } of this.entries) this.root.addChild(root);

    const arrow = pointSprite(arrowTexture);
    arrow.label = "eggHatch:arrow";
    arrow.anchor.set(0.5);
    arrow.position.copyFrom(this.layout.arrowCenter);
    arrow.zIndex = SLOT_DECORATION_Z;
    this.root.addChild(arrow);

    await this.addPrizePreviews(pool, largeStar);
    this.applyReelLayout();
  }

  private async buildProviderDisplay(prize: EggHatchPrize, inventory: Spritesheet): Promise<Container> {
    if (prize.kind === "monster") {
      const monster = this.opts.game.gd.monsterByShortType(prize.shortType);
      return createRenderableSpriteNode({
        texture: await this.opts.game.assets.sprite(`${prize.shortType}-hd`),
        rendererData: monster.rendererData,
        label: `eggHatch:provider:monster:${prize.shortType}`,
      });
    }
    const root = new Container();
    root.label = `eggHatch:provider:${prize.kind}`;
    const frame = providerFrame(prize);
    const icon = pointSprite(requiredFrame(inventory, frame));
    root.addChild(icon);
    root.boundsArea = new Rectangle(0, 0, icon.width, icon.height);
    if (prize.kind === "gem" && prize.quality === 1) {
      root.sortableChildren = true;
      icon.anchor.set(0.5);
      icon.position.set(icon.width / 2, icon.height / 2);
      const slot = ["Novice", "Veteran", "Elite"][prize.slot]!;
      const glow = pointSprite(requiredFrame(inventory, `${slot}GemGlow.png`));
      glow.label = "eggHatch:provider:gemGlow";
      glow.anchor.set(0.5);
      glow.position.copyFrom(icon.position);
      glow.tint = 0x3ff1ff;
      glow.blendMode = "normal";
      glow.zIndex = -1;
      glow.eventMode = "none";
      root.addChild(glow);
      this.gemGlows.push(glow);
    }
    if (prize.kind === "gold" || prize.kind === "silver") {
      const amount = makeTtfLabel(
        String(prize.amount),
        eggProviderAmountFontSize(DISPLAY_MODE),
        { outline: true },
      );
      amount.anchor.set(0.5);
      amount.position.set(icon.width / 2, icon.height / 2);
      root.addChild(amount);
    }
    return root;
  }

  private async addPrizePreviews(pool: EggHatchPool, largeStar: Texture): Promise<void> {
    const previews = await Promise.all(
      this.previewMonsters.map((shortType) =>
        this.buildMonsterPreview(shortType, largeStar, "ordinary")),
    );
    const previewLayouts = eggPreviewEntryLayouts(
      previews.map((preview) => ({ w: preview.width, h: preview.height })),
      DISPLAY_MODE,
    );
    for (const [index, preview] of previews.entries()) {
      preview.position.copyFrom(previewLayouts[index]!);
      preview.zIndex = SLOT_DECORATION_Z;
      this.root.addChild(preview);
    }
    const guaranteed = pool.providers.find((prize) =>
      prize.kind === "monster" && prize.prizeMonster);
    if (guaranteed?.kind === "monster") {
      const preview = await this.buildMonsterPreview(guaranteed.shortType, largeStar, "prize");
      preview.position.set(
        this.layout.prizeCenter.x - preview.width / 2,
        this.layout.prizeCenter.y - preview.height / 2,
      );
      preview.zIndex = SLOT_DECORATION_Z;
      this.root.addChild(preview);
    }
  }

  private async buildMonsterPreview(
    shortType: string,
    largeStar: Texture,
    role: "ordinary" | "prize",
  ): Promise<Container> {
    const monster = this.opts.game.gd.monsterByShortType(shortType);
    const render = createRenderableSpriteNode({
      texture: await this.opts.game.assets.sprite(`${shortType}-hd`),
      rendererData: monster.rendererData,
      label: `eggHatch:preview:${shortType}`,
    });
    const bounds = render.boundsArea!;
    render.scale.set(eggMonsterPreviewScale(bounds.width, bounds.height, DISPLAY_MODE));
      const animatedStars = buildStarRow(monster.stars, largeStar);
      const stars = animatedStars.row;
      stars.label = `eggHatch:previewStars:${role}:${shortType}`;
      const starSize = stars.boxContentSize;
      const attachment = eggPreviewStarAttachment(
        bounds.width,
        bounds.height,
        starSize.h,
        Math.abs(render.scale.x),
      );
    stars.pivot.copyFrom(attachment.pivot);
    stars.position.copyFrom(attachment.position);
    stars.scale.set(attachment.scale);
    render.addChild(stars);
    this.previewStarAnimationStarts.push(() => {
      animatedStars.start(
        this.opts.ticker,
        () => this.closed || stars.destroyed || render.destroyed,
      );
    });
    // The attached star child does not enlarge the renderer's authored Box contentSize.
    return render;
  }

  private readonly pointerDown = (event: FederatedPointerEvent): void => {
    if (this.phase !== "rolling" || this.activePointer !== undefined) return;
    this.activePointer = event.pointerId;
    this.reel?.press();
    event.stopPropagation();
  };

  private readonly pointerEnded = (event: FederatedPointerEvent): void => {
    if (event.pointerId !== this.activePointer) return;
    this.activePointer = undefined;
    event.stopPropagation();
    this.commitRelease();
  };

  private readonly pointerCancelled = (event: FederatedPointerEvent): void => {
    if (event.pointerId === this.activePointer) this.activePointer = undefined;
    event.stopPropagation();
  };






  private commitRelease(): void {
    const reel = this.reel;
    if (reel === undefined || this.released || this.phase !== "rolling") return;
    if (this.frameIndex < EGG_REEL_MIN_HELD_FRAMES) return;
    this.released = true;
    this.releasedAtFrame = this.frameIndex;
    // A conservative bound, not a prediction: the fastest friction the draw can produce travels the
    // least, so this coast stays at or behind the committed one until the commitment arrives.
    reel.replayRelease(EGG_REEL_REPLAY_FRICTION_MAX);
    void this.session.release(this.frameIndex).then(
      (commitment) => { this.installCommitment(commitment); },
      (error: unknown) => { this.fail(error); },
    );
  }

  /** Replay the committed coast from the same release frame, then ease the display onto it. */
  private installCommitment(commitment: EggReleaseCommitment): void {
    if (this.closed || this.pool === undefined || this.phase !== "rolling") return;
    const committed = new EggReel(this.pool.reel.length, PRESENTATION_RNG);
    committed.advanceFrames(this.releasedAtFrame);
    if (!committed.replayRelease(commitment.friction)) {
      this.fail(new Error("committed Egg friction was refused by the presentation replay"));
      return;
    }
    committed.advanceFrames(this.frameIndex - this.releasedAtFrame);
    this.committedReel = committed;
    this.commitment = commitment;
    // Nothing has been drawn under the provisional coast yet, so there is nothing to correct.
    this.blendFrames = this.frameIndex === this.releasedAtFrame ? RELEASE_BLEND_FRAMES : 0;
  }

  private readonly tick = (): void => {
    if (this.reel === undefined || this.phase !== "rolling") return;
    const deltaMs = this.opts.ticker.deltaMS;
    this.frameCarryMs += deltaMs;
    let budget = REEL_MAX_CATCHUP_FRAMES;
    while (this.frameCarryMs >= REEL_FRAME_MS && budget > 0) {
      this.frameCarryMs -= REEL_FRAME_MS;
      budget -= 1;
      this.advanceReelFrame();
      if (this.reelState!.stopped) break;
    }
    if (this.frameCarryMs >= REEL_FRAME_MS) this.frameCarryMs = 0;
    const state = this.reelState!;
    this.gemGlowClock = advanceEggGemGlowClock(this.gemGlowClock, deltaMs);
    const glowAlpha = dungeonGemGlowAlpha(this.gemGlowClock.elapsedMs);
    for (const glow of this.gemGlows) glow.alpha = glowAlpha;
    this.applyReelLayout();
    // A slow release reply can outlast the fastest provisional coast. Its stopped slot is only
    // presentation; neither a prize nor a settlement command may precede the actual commitment.
    if (!state.stopped || this.commitment === undefined) return;
    this.opts.ticker.remove(this.tick);
    const selected = this.entries[state.centerIndex]!.prize;
    this.selectedPrize = selected;
    this.phase = "reward";
    this.root.eventMode = "none";
    // showPrizeForProvider calls the rewarder before SlotMachineNode removes itself.
    void this.guarded(this.presentPrize(selected));
    if (this.root.parent) this.root.parent.removeChild(this.root);
    this.releaseCasinoMusic();
  };

  /**
   * One native update. Before a commitment the free spin is exact — it consumes no randomness and
   * runs at a constant speed, so this counter is the whole release point the authority replays.
   * After one, the display converges onto the committed coast and rests on the committed slot.
   */
  private advanceReelFrame(): void {
    const provisional = this.reel!.advanceFrame();
    this.frameIndex += 1;
    const committed = this.committedReel;
    if (committed === undefined) {
      this.reelState = provisional;
      return;
    }
    const target = committed.advanceFrame();
    if (this.blendFrames >= RELEASE_BLEND_FRAMES) {
      this.reelState = target.stopped ? this.commitment!.finalReelState : target;
      return;
    }
    this.blendFrames += 1;
    const progress = this.blendFrames / RELEASE_BLEND_FRAMES;
    const eased = progress * (2 - progress);
    const index = provisional.index + (target.index - provisional.index) * eased;
    this.reelState = target.stopped && this.blendFrames >= RELEASE_BLEND_FRAMES
      ? this.commitment!.finalReelState
      : Object.freeze({
          elapsedSeconds: target.elapsedSeconds,
          index,
          speed: target.speed,
          friction: target.friction,
          centerIndex: Math.floor(index) % this.entries.length,
          stopped: false,
        });
  }

  private applyReelLayout(): void {
    if (this.reelState === undefined) return;
    const layouts = eggReelEntryLayouts(this.reelState, this.entries.length, DISPLAY_MODE);
    for (const layout of layouts) {
      const entry = this.entries[layout.index]!.root;
      entry.position.set(layout.x, layout.y);
      entry.visible = layout.visible;
    }
  }

  private async presentPrize(prize: EggHatchPrize): Promise<void> {
    if (prize.kind === "monster") {
      await this.presentMonsterPrize(prize);
      return;
    }
    // Non-Egg Items ask the question before Player.addItem:. Standard Silver/Gold pools cannot
    // contain a nested Egg, so every non-monster provider follows this branch.
    const onPresent = await this.settleKeep(() => this.applyNonMonsterPrize(prize));
    await this.showSpinQuestion(
      prizeDisplayName(this.opts.game, prize),
      undefined,
      onPresent,
    );
  }

  /**
   * Settle a kept prize the way the active session settles it.
   *
   * A local session applies it as the repeat question presents, which is the source's own order.
   * An authoritative one has to have `egg.resolvePrize` accepted before the server will admit
   * either `egg.repeat` or `egg.finish`, so it settles first and the popup presents afterwards.
   */
  private async settleKeep(
    applyLocally: (joinedInstanceId?: string) => void,
  ): Promise<(() => void) | undefined> {
    if (this.session.settlesAtPresentation) return () => { applyLocally(); };
    const mirror = await this.session.resolve({ kind: "keep" });
    applyLocally(mirror.joinedInstanceId);
    return undefined;
  }

  private async presentMonsterPrize(
    prize: Extract<EggHatchPrize, { kind: "monster" }>,
  ): Promise<void> {
    const displayName = localizedRenderableName(this.opts.game.strings, [prize.shortType]);
    let resolve!: (choice: "keep" | "feed") => void;
    const choice = new Promise<"keep" | "feed">((done) => { resolve = done; });
    await showMonsterHatchPopup(this.popupEnvironment(), {
      title: formatOne(localizedString(this.opts.game.strings, "WinPrizeTitleFormatKey"), displayName),
      content: buildMonsterHatchMessageContent(
        localizedString(this.opts.game.strings, "WonMonsterMessageKey"),
      ),
      buttons: [
        { label: localizedString(this.opts.game.strings, "KeepKey"), onPress: () => resolve("keep") },
        { label: localizedString(this.opts.game.strings, "FeedToButtonKey"), onPress: () => resolve("feed") },
      ],
      onDismiss: () => undefined,
    });
    if (await choice === "feed") {
      await this.presentFeedPicker(prize, displayName);
      return;
    }
    // Source asks the repeat question before appending the monster.
    const onPresent = await this.settleKeep(
      (joinedInstanceId) => this.keepMonster(prize, joinedInstanceId),
    );
    await this.showSpinQuestion(displayName, undefined, onPresent);
  }

  private async presentFeedPicker(
    prize: Extract<EggHatchPrize, { kind: "monster" }>,
    displayName: string,
  ): Promise<void> {
    this.phase = "feed";
    const party = this.opts.player.party!;
    let selected = false;
    let resolve!: () => void;
    const closed = new Promise<void>((done) => { resolve = done; });
    this.resolveFeedPicker = resolve;
    const node = await createMonsterManagementNode({
      assets: this.opts.game.assets,
      scale9: this.opts.game.scale9,
      strings: this.opts.game.strings,
      style: 2,
      entries: party.monsters().map((member) => {
        const monster = this.opts.game.gd.monsterByShortType(member.shortType);
        const scale = rendererScale(monster.rendererData);
        return {
          id: member.instanceId,
          shortType: member.shortType,
          level: member.level,
          stars: monster.stars,
          element: monster.element,
          ...(scale === undefined ? {} : { rendererScale: scale }),
        };
      }),
      selectButtonText: localizedString(this.opts.game.strings, "FeedToButtonKey"),
      cancelButtonText: localizedString(this.opts.game.strings, "CancelButtonKey"),
      onInspect: (instanceId) => { void this.presentFeedMonsterInfo(instanceId); },
      onElementHelp: (element) => { void this.showFeedElementHelp(element); },
      onSelect: (instanceId) => {
        selected = true;
        const recipient = party.monster(instanceId);
        const recipientWasFull = recipient.level >= 150;
        // The recipient's pre-feed level picks the message. The authority reaches the same
        // full-recipient discard itself; it is told the recipient either way.
        const messageKey = eggFeedMessageKey(recipient.level);
        const template = localizedString(
          this.opts.game.strings,
          messageKey,
        );
        const message = formatOne(template, displayName);
        void this.guarded((async () => {
          // A full recipient discards the prize on both sides: `settlePrize` reaches the same
          // `recipient-full` settlement the local path skips the level award for.
          if (!this.session.settlesAtPresentation) {
            await this.session.resolve({ kind: "feed", recipientInstanceId: instanceId });
          }
          if (!recipientWasFull) {
            this.opts.player.feedHatchedMonster(instanceId, prize.shortType, prize.level);
            this.opts.onStateChanged();
          }
          await this.showSpinQuestion(displayName, message);
        })());
      },
      onClose: () => {
        this.feedPicker = undefined;
        this.opts.ticker.remove(this.tickFeedPicker);
        if (!selected) {
          void this.guarded((async () => {
            const onPresent = await this.settleKeep(
      (joinedInstanceId) => this.keepMonster(prize, joinedInstanceId),
    );
            onPresent?.();
            await this.showSpinQuestion(displayName);
          })());
        }
        this.resolveFeedPicker = undefined;
        resolve();
      },
    });
    this.opts.parent.addChild(node);
    this.feedPicker = node;
    this.opts.ticker.add(this.tickFeedPicker);
    await closed;
    this.resolveFeedPicker = undefined;
  }

  private readonly tickFeedPicker = (): void => {
    this.feedPicker?.update(this.opts.ticker.deltaMS);
  };

  private partyLivingInfoContext(instanceId: string): PartyLivingInfoContext {
    return {
      gd: this.opts.game.gd,
      strings: this.opts.game.strings,
      collection: this.opts.player.profile,
      member: this.opts.player.party!.monster(instanceId),
      playerBuffs: this.opts.player.party!.playerBuffsOf(instanceId),
    };
  }

  private async presentFeedMonsterInfo(instanceId: string): Promise<void> {
    if (this.feedInspectionPending || this.closed) return;
    this.feedInspectionPending = true;
    try {
      const context = this.partyLivingInfoContext(instanceId);
      const snapshot = buildPartyLivingInfoSnapshot(context);
      const content = await buildLivingInfoContent(
        snapshot,
        this.opts.game.assets,
        this.opts.game.strings,
        {
          onElementTap: () => void this.showFeedElementHelp(snapshot.monster.element),
          onStatTap: (statType) =>
            void this.showFeedMessage(`Stat${LIVING_STAT_NAMES[statType]!}Info`),
          onXpTap: () => void this.showFeedMessage("XPInfo"),
          onAbilityTap: (ability) =>
            void this.showFeedAbilityInfo(buildPartyAbilityInfoModel(context, ability)),
          onSoulStoneTap: (stone) => void this.showFeedSoulStoneInfo(stone),
          onSoulStoneTitleTap: () => void this.showFeedMessage("ItemsInfo"),
        },
      );
      await new Promise<void>((resolve, reject) => {
        void showMonsterHatchPopup(this.popupEnvironment(), {
          content,
          buttons: [{
            label: localizedString(this.opts.game.strings, "OkButtonKey"),
            onPress: () => undefined,
          }],
          onDismiss: resolve,
        }).catch(reject);
      });
    } finally {
      this.feedInspectionPending = false;
    }
  }

  private async showFeedElementHelp(element: string): Promise<void> {
    const names: ReadonlySet<string> = new Set([
      "Life",
      "Death",
      "Water",
      "Fire",
      "Earth",
      "Air",
      "Arcane",
    ]);
    if (!names.has(element)) return;
    const name = element as ElementHelpName;
    await showMonsterHatchPopup(this.popupEnvironment(), {
      title: localizedString(this.opts.game.strings, `Element${name}HelpTitleKey`),
      content: buildElementHelpContent(name, this.opts.game.strings),
      buttons: [{
        label: localizedString(this.opts.game.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
    });
  }

  private async showFeedMessage(name: string): Promise<void> {
    await showMonsterHatchPopup(this.popupEnvironment(), {
      title: localizedString(this.opts.game.strings, `${name}TitleKey`),
      content: buildMonsterHatchMessageContent(
        localizedString(this.opts.game.strings, `${name}MessageKey`),
      ),
      buttons: [{
        label: localizedString(this.opts.game.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
    });
  }

  private async showFeedAbilityInfo(
    model: ReturnType<typeof buildPartyAbilityInfoModel>,
  ): Promise<void> {
    await showMonsterHatchPopup(this.popupEnvironment(), {
      content: buildAbilityInfoContent(model),
      buttons: [{
        label: localizedString(this.opts.game.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
      hideOverlays: true,
    });
  }

  private async showFeedSoulStoneInfo(
    stone: Parameters<typeof buildSoulStoneInfoContent>[0],
  ): Promise<void> {
    const content = await buildSoulStoneInfoContent(
      stone,
      this.opts.game.assets,
      {
        onStatTap: (statType) =>
          void this.showFeedMessage(`Stat${LIVING_STAT_NAMES[statType]!}Info`),
      },
    );
    await showMonsterHatchPopup(this.popupEnvironment(), {
      content,
      buttons: [{
        label: localizedString(this.opts.game.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
      gapBeforeButtons: ITEM_INFO_GAP_BEFORE_BUTTONS,
    });
  }

  /** `joinedInstanceId` is the authority's own party identity when one settled this prize; the
   * renderer mirror must adopt it rather than mint a second id for the same monster. */
  private keepMonster(
    prize: Extract<EggHatchPrize, { kind: "monster" }>,
    joinedInstanceId?: string,
  ): void {
    this.opts.player.addJoinedMonster(
      joinedInstanceId ?? this.opts.nextMonsterInstanceId(prize.shortType),
      prize.shortType,
      prize.level,
    );
    this.opts.onStateChanged();
  }

  private applyNonMonsterPrize(prize: Exclude<EggHatchPrize, { kind: "monster" }>): void {
    const profile = this.opts.player.profile;
    switch (prize.kind) {
      case "gold":
        profile.awardGold(prize.amount);
        break;
      case "silver":
        profile.awardSilver(prize.amount);
        break;
      case "recipe":
        profile.learnCombineRecipe(prize.combineName);
        break;
      case "spiritTotem":
        profile.awardSpiritTotem(prize.shortType);
        break;
      case "item":
        profile.inventory.addUsable(
          prize.definitionPath,
          prize.definitionPath.split(".").at(-1)!,
          prize.level,
        );
        break;
      case "gem":
        profile.inventory.addGem({
          definitionPath: `Gems.GeneratedQuality${prize.quality}`,
          level: prize.level,
          quality: prize.quality,
          slot: prize.slot,
          enabledStats: prize.enabledStats,
        });
        break;
    }
    this.opts.onStateChanged();
  }

  private async showSpinQuestion(
    displayName: string,
    messageOverride?: string,
    onPresent?: () => void,
  ): Promise<void> {
    this.phase = "question";
    const canRepeat = this.session.canRepeat();
    const result: { action: "again" | "done" } = { action: "done" };
    let resolve!: () => void;
    const dismissed = new Promise<void>((done) => { resolve = done; });
    const cost = this.session.repeatCost();
    const message = messageOverride ?? formatOne(
      localizedString(
        this.opts.game.strings,
        canRepeat ? "SpinAgainMessageKey" : "SpinFinishedMessageFormatKey",
      ),
      displayName,
    );
    await showMonsterHatchPopup(this.popupEnvironment(), {
      title: localizedString(
        this.opts.game.strings,
        canRepeat ? "SpinAgainTitleKey" : "SpinFinishedTitleKey",
      ),
      content: buildMonsterHatchMessageContent(message),
      buttons: canRepeat
        ? [
            {
              label: localizedString(this.opts.game.strings, "YesGoldFormatKey")
                .replace("%d", String(cost)),
              onPress: () => { result.action = "again"; },
            },
            { label: localizedString(this.opts.game.strings, "NoButtonKey"), onPress: () => undefined },
          ]
        : [{ label: localizedString(this.opts.game.strings, "OkButtonKey"), onPress: () => undefined }],
      ...(onPresent === undefined ? {} : { onPresent }),
      onDismiss: resolve,
    });
    await dismissed;
    if (result.action !== "again") {
      // Clearing the continuation is what releases the slot; only a completed Egg does it.
      await this.session.finish();
      this.dispose();
      return;
    }
    const outcome = await this.session.repeat();
    if (outcome.kind === "unaffordable") {
      await runInsufficientFundsStoreHandoff({
        openStore: this.opts.openGoldStore,
        presentCannotAfford: () => this.showCannotAfford(),
        // `setCloseCallbackTarget:selector:` points back to `showSpinAgainQuestion:`.
        resume: () => this.showSpinQuestion(displayName, messageOverride),
      });
      return;
    }
    this.opts.onStateChanged();
    await this.renderSpin(outcome.spin);
  }

  private async showCannotAfford(): Promise<void> {
    let resolve!: () => void;
    const dismissed = new Promise<void>((done) => { resolve = done; });
    await showMonsterHatchPopup(this.popupEnvironment(), {
      title: localizedString(this.opts.game.strings, "CannotAffordThingTitleKey"),
      content: buildMonsterHatchMessageContent(
        localizedString(this.opts.game.strings, "CannotAffordThingMessageKey"),
      ),
      buttons: [{ label: localizedString(this.opts.game.strings, "OkButtonKey"), onPress: () => undefined }],
      onDismiss: resolve,
    });
    await dismissed;
  }

  private popupEnvironment() {
    return {
      parent: this.opts.parent,
      assets: this.opts.game.assets,
      scale9: this.opts.game.scale9,
      ticker: this.opts.ticker,
      owner: this.opts.owner,
      zIndex: SLOT_DECORATION_Z + 2,
      sfx: {
        onButtonPress: () => this.opts.audio.playSfx("click"),
        onButtonBlocked: () => this.opts.audio.playSfx("notAllowed"),
      },
    };
  }

  private releaseCasinoMusic(): void {
    if (!this.casinoOwned) return;
    this.casinoOwned = false;
    this.opts.audio.releaseMusicLock("Casino");
  }
}









async function selectRepeatEggProviders(
  opts: EggHatchFlowOptions,
  numRepeats: number,
): Promise<readonly EggHatchPrize[]> {
  if (!Number.isSafeInteger(numRepeats) || numRepeats < 1) {
    throw new Error(`Clone Egg numRepeats must be a positive integer; got ${numRepeats}`);
  }
  if (opts.session !== undefined) {
    throw new Error("Clone Egg rewards are not supported by the Official authority");
  }
  const popupEnvironment = {
    parent: opts.parent,
    assets: opts.game.assets,
    scale9: opts.game.scale9,
    ticker: opts.ticker,
    owner: opts.owner,
    zIndex: SLOT_DECORATION_Z + 2,
    sfx: {
      onButtonPress: () => opts.audio.playSfx("click"),
      onButtonBlocked: () => opts.audio.playSfx("notAllowed"),
    },
  };
  await new Promise<void>((resolve, reject) => {
    void showMonsterHatchPopup(popupEnvironment, {
      title: localizedString(opts.game.strings, "RepeatEggTitleKey"),
      content: buildMonsterHatchMessageContent(
        localizedString(opts.game.strings, "RepeatEggMessageKey"),
      ),
      buttons: [{
        label: localizedString(opts.game.strings, "OkButtonKey"),
        onPress: () => undefined,
      }],
      onDismiss: resolve,
    }).catch(reject);
  });

  const picked: EggHatchPrize[] = [];
  const pickedTypes = new Set<string>();
  while (picked.length < numRepeats) {
    const registered = opts.game.gd.allMonsters().filter(
      (monster) =>
        opts.player.profile.highestRegisteredLevel(monster.shortType) > 0 &&
        !pickedTypes.has(monster.shortType),
    );
    const candidates = [...registered];
    if (candidates.length < numRepeats) {
      const byStars = [...opts.game.gd.allMonsters()].sort(
        (left, right) => left.stars - right.stars,
      );
      for (const monster of byStars) {
        if (pickedTypes.has(monster.shortType)) continue;
        candidates.push(monster);
        if (candidates.length >= numRepeats) break;
      }
    }
    if (candidates.length === 0) {
      throw new Error("Clone Egg has no Monsterpedia candidates to duplicate");
    }

    let selectedType: string | undefined;
    let node: MonsterManagementNode | undefined;
    await new Promise<void>((resolve, reject) => {
      void createMonsterManagementNode({
        assets: opts.game.assets,
        scale9: opts.game.scale9,
        strings: opts.game.strings,
        style: 3,
        entries: candidates.map((monster, index) => {
          const scale = rendererScale(monster.rendererData);
          return {
            id: `${monster.shortType}:${index}`,
            shortType: monster.shortType,
            level: 1,
            stars: monster.stars,
            element: monster.element,
            ...(scale === undefined ? {} : { rendererScale: scale }),
          };
        }),
        selectButtonText: localizedString(opts.game.strings, "ChooseButtonKey"),
        onInspect: () => undefined,
        onElementHelp: (element) => {
          const name = element as ElementHelpName;
          void showMonsterHatchPopup(popupEnvironment, {
            title: localizedString(opts.game.strings, `Element${name}HelpTitleKey`),
            content: buildElementHelpContent(name, opts.game.strings),
            buttons: [{
              label: localizedString(opts.game.strings, "OkButtonKey"),
              onPress: () => undefined,
            }],
          });
        },
        onSelect: (id) => {
          selectedType = candidates[Number(id.slice(id.lastIndexOf(":") + 1))]?.shortType;
        },
        onClose: () => {
          opts.ticker.remove(tick);
          resolve();
        },
      }).then((created) => {
        node = created;
        opts.parent.addChild(created);
        opts.ticker.add(tick);
      }).catch(reject);

      function tick(): void {
        node?.update(opts.ticker.deltaMS);
      }
    });
    if (selectedType === undefined) {
      throw new Error("Clone Egg picker closed without selecting a monster");
    }
    pickedTypes.add(selectedType);
    picked.push(Object.freeze({
      kind: "monster",
      shortType: selectedType,
      level: 1,
      prizeMonster: false,
    }));
  }
  return Object.freeze(picked);
}

function providerFrame(prize: Exclude<EggHatchPrize, { kind: "monster" }>): string {
  switch (prize.kind) {
    case "gold": return "pileGold.png";
    case "silver": return "pileSilver.png";
    case "recipe": return "Item_Recipe.png";
    case "spiritTotem": return "Item_Totem.png";
    case "item": return `Item_Card${prize.level}.png`;
    case "gem": {
      const slot = ["Novice", "Veteran", "Elite", "Grandmaster"][prize.slot]!;
      return `${slot}Gem${dungeonGemItemTier(prize.level)}.png`;
    }
  }
}

function prizeDisplayName(game: LoadedGame, prize: EggHatchPrize): string {
  switch (prize.kind) {
    case "monster": return localizedRenderableName(game.strings, [prize.shortType]);
    case "gold": return formatOne(localizedString(game.strings, "RenderableGoldNameKey"), prize.amount);
    case "silver": return formatOne(localizedString(game.strings, "RenderableSilverNameKey"), prize.amount);
    case "recipe": return formatOne(
      localizedString(game.strings, "RenderableRecipeNameKey"),
      localizedRenderableName(game.strings, [prize.combineName]),
    );
    case "spiritTotem": return formatOne(
      localizedString(game.strings, "RenderableSpiritTotemNameKey"),
      localizedRenderableName(game.strings, [prize.shortType]),
    );
    case "item": return localizedRenderableName(game.strings, [prize.definitionPath.split(".").at(-1)!]);
    case "gem": {
      const slot = ["Novice", "Veteran", "Elite", "Grandmaster"][prize.slot]!;
      return `${localizedString(game.strings, `${slot}SlotKey`)} ${
        localizedString(game.strings, `GemItemLevel${dungeonGemItemTier(prize.level)}Key`)
      }`;
    }
  }
}

interface AnimatedPreviewStarRow {
  readonly row: Box;
  start(ticker: Ticker, cancelled: () => boolean): void;
}








function buildStarRow(stars: number, texture: Texture): AnimatedPreviewStarRow {
  const probe = pointSprite(texture);
  const geometry = eggPreviewStarGeometry(DISPLAY_MODE, probe.width, probe.height);
  probe.destroy();
  const sprites = Array.from({ length: Math.ceil(stars) }, (_, index) => {
    const star = pointSprite(
      index >= Math.floor(stars) ? monsterpediaHalfStarTexture(texture) : texture,
    );
    const naturalScale = {
      x: star.scale.x * geometry.assetScale,
      y: star.scale.y * geometry.assetScale,
    };
    star.scale.set(
      naturalScale.x * EGG_PREVIEW_STAR_FINAL_SCALE,
      naturalScale.y * EGG_PREVIEW_STAR_FINAL_SCALE,
    );
    return { star, naturalScale };
  });
  const row = new Box({
    horizontal: true,
    gap: geometry.gap,
    positiveAlignDirection: true,
    roundingScale: sourcePointsPerPortPoint(DISPLAY_MODE),
  });
  for (const { star } of sprites) {
    row.addBoxChild(star);
  }
  const animations = sprites.map(({ star, naturalScale }, index) => {
    const entry = eggPreviewStarEntry(DISPLAY_MODE, index);
    const rest = {
      x: star.position.x,
      y: star.height / 2,
    };
    star.anchor.set(0.5);
    star.position.set(rest.x, rest.y - entry.startOffsetY);
    star.scale.set(naturalScale.x, naturalScale.y);
    return { star, naturalScale, rest, entry };
  });
  return {
    row,
    start: (ticker, cancelled) => {
      for (const { star, naturalScale, rest, entry } of animations) {
        void (async () => {
          await tween(ticker, entry.delayMs, () => {});
          if (cancelled() || star.destroyed) return;
          await Promise.all([
            tween(
              ticker,
              EGG_PREVIEW_STAR_MOVE_MS,
              (t) => {
                if (!cancelled() && !star.destroyed) {
                  star.position.y = rest.y - entry.startOffsetY * (1 - t);
                }
              },
              easeExponentialInOut,
            ),
            tween(
              ticker,
              EGG_PREVIEW_STAR_SCALE_MS,
              (t) => {
                if (!cancelled() && !star.destroyed) {
                  const scale = 1 + (EGG_PREVIEW_STAR_FINAL_SCALE - 1) * t;
                  star.scale.set(naturalScale.x * scale, naturalScale.y * scale);
                }
              },
              easeElasticInOut,
            ),
          ]);
        })();
      }
    },
  };
}

function requiredFrame(sheet: Spritesheet, name: string): Texture {
  const texture = sheet.textures[name];
  if (texture === undefined) throw new Error(`Egg hatch atlas is missing ${name}`);
  return texture;
}

function rendererScale(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("egg hatch monster rendererData must be an object");
  }
  const scale = (value as Record<string, unknown>)["scale"];
  return typeof scale === "number" ? scale : undefined;
}

function formatOne(template: string, value: string | number): string {
  return template.replace(/%@|%d/, String(value));
}
