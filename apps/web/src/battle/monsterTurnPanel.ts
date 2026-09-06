


























import { Container, Sprite, type FederatedPointerEvent, type Text, type Texture, type Ticker } from "pixi.js";
import { Box, ButtonSprite, pointSprite, makeTtfLabel, StrokeRecognizer, BATTLE_STROKES, CONTENT_SCALE_FACTOR, type AssetLibrary, type StrokeMatch } from "@dib/renderer";
import type { PlayerChoice } from "@dib/engine";
import { FriendlyMonsterDisplay } from "./friendlyMonsterDisplay.js";
import type { StatusOverlayHost } from "./statusOverlay.js";
import type { FriendlySnapshot } from "./friendlyTeamDisplay.js";
import { HeroDisplay } from "./heroDisplay.js";
import type { BattlePlayerProfile } from "../player/battlePlayerState.js";
import {
  SCREEN_W,
  SCREEN_H,
  TURN_PANEL_CARD_WIDTH,
  heroDisplayPosition,
  captureCardIdleDelayMs,
  CAPTURE_CARD_SHAKE_MS,
  CAPTURE_CARD_SHAKE_OFFSET,
  NEW_OVERLAY_GLOW_SCALE,
  NEW_OVERLAY_GLOW_FADE_LEG_MS,
  NEW_OVERLAY_LABEL_SIZE,
  NEW_OVERLAY_LABEL_START_SCALE,
  NEW_OVERLAY_LABEL_POP_MS,
  NEW_OVERLAY_LABEL_FADE_REMOVE_MS,
  FRIENDLY_CARD_EDGE_INSET,
} from "./displayShared.js";
import { tween, easeElasticOut, easeElasticInOut, shakenOffset } from "../tween.js";
import {
  swipeableFromTargeting,
  SWIPE_DIRECTION_BY_SLOT,
  swipeSpriteKey,
  slotNumberOf,
  formatTU,
  lockedSlotNumbers,
  abilitySlotPixiPos,
  abilityCardLabelOffsets,
  bottomRowGap,
  bottomRowPixiPos,
  abilityInfoButtonTopLeft,
  captureCardPixiPosition,
  type SwipeDirection,
} from "./turnPanelMath.js";





export type PanelChoice = PlayerChoice;
export type SecondaryActionKind = "delay" | "bench" | "retreat";

export interface MonsterTurnPanelOpts {
  assets: AssetLibrary;
  ticker: Ticker;
  profile: BattlePlayerProfile;
  onHeroPress: () => void;
  /** Source-global RNG draw used by each capture card's one-time idle cadence roll. */
  rand?: () => number;
  /** Source recognizer is panel-owned but globally registered as a non-swallowing touch delegate. */
  gestureTarget?: Container;
}

/** One targetable enemy's capture-card mount (see MonsterTurnPanelShowOpts.captureHosts). */
export interface CaptureHost {
  id: string;
  /** The enemy's own display widget the `Item_Card1.png` button parents onto. */
  node: Container;



  isNew?: boolean;
}

export interface MonsterTurnPanelShowOpts {


  unknownSkillsLeft?: number;
  /** `monster.evolveType` (turn-panel.md §2a) — `!= 0` forces "always show '???'". Defaults to 0. */
  evolveType?: number;






  captureHosts?: readonly CaptureHost[];
  /** Localized `"NewKey"` string ("NEW!") for the first-capture overlay. Required when any
   *  host `isNew` — fail loud rather than render an unlocalized placeholder. */
  newLabelText?: string;
}















export class MonsterTurnPanel extends Container {
  private readonly assets: AssetLibrary;
  private readonly ticker: Ticker;
  private readonly gestureRecognizer: StrokeRecognizer;
  private readonly gestureTarget: Container;
  private readonly profile: BattlePlayerProfile;
  private readonly heroPress: () => void;
  private readonly rand: () => number;
  private readonly choicesBySlot = new Map<1 | 2 | 3 | 4, PanelChoice>();

  /** Built once, lazily, and never rebuilt across `show()` calls (the bar background and hero HUD
   *  don't depend on `actor`/`choices`). */
  private bar: Sprite | undefined;
  private heroDisplay: HeroDisplay | undefined;
  /** Rebuilt fresh on every `show()` (turn-dependent content). */
  private readonly dynamic = new Container();
  private actingCard: FriendlyMonsterDisplay | undefined;
  /** Battle living id of the monster the current acting card portrays (see `notifyHp` /
   *  `actingCardStatusHost` — the acting card is a real `FriendlyMonsterDisplay`, so it is both an
   *  `ILivingHealthListener` and an `IStatusEffectListener` in the original). */
  private actingLivingId: string | undefined;





  private captureButtons: Array<{ targetId: string; nodes: [Container, Container] }> = [];
  private captureHitTargets: Array<{ node: Container; targetId: string }> = [];
  private abilityInfoButtons: Array<{ slot: number; row: Container; button: ButtonSprite; tuLabel: Text }> = [];
  private abilityButtons: Array<{ slot: number; abilityPath: string; row: Container; button: ButtonSprite }> = [];
  private secondaryButtons: Array<{ kind: SecondaryActionKind; box: Box; button: ButtonSprite }> = [];
  private lockedSlots = new Set<1 | 2 | 3 | 4>();

  private pickCb: ((choice: PanelChoice, via: "tap" | "swipe", gestureMidpoint?: { x: number; y: number }) => void) | undefined;
  private needsTargetsCb: ((choice: PanelChoice) => void) | undefined;
  private infoCb: ((choice: PanelChoice) => void) | undefined;
  private lockedTapCb: (() => void) | undefined;
  private blockedTapCb: ((choice: PanelChoice) => void) | undefined;
  private captureTapCb: ((targetId: string) => void) | undefined;
  private delayTapCb: (() => void) | undefined;
  private benchTapCb: (() => void) | undefined;
  private retreatTapCb: (() => void) | undefined;
  private actingCardTapCb: ((livingId: string) => void) | undefined;

  constructor(opts: MonsterTurnPanelOpts) {
    super();
    this.assets = opts.assets;
    this.ticker = opts.ticker;
    this.profile = opts.profile;
    this.heroPress = opts.onHeroPress;
    this.rand = opts.rand ?? Math.random;
    this.gestureTarget = opts.gestureTarget ?? this;
    this.gestureRecognizer = new StrokeRecognizer(this.gestureTarget, { patterns: BATTLE_STROKES });
    // Cocos ButtonSprites register with the touch dispatcher independently of sibling draw order.
    // The scene-level release hit below reproduces that arbitration for cards rendered below the
    // enemy name; the shared Popup stops propagation, so modal touches never leak here.
    this.gestureTarget.on("pointertap", (event) => this.handleCaptureSceneTap(event));
    this.gestureRecognizer.onStroke((match) => this.handleSwipeMatch(match));
    this.gestureRecognizer.setEnabled(false);
    this.visible = false;
  }

  /** `-[MonsterTurnPanel useAbilityCallback:]`/`lockedAbilityCallback:` tap path (turn-panel.md
   *  §2b/§9) for abilities that fire immediately — self-only abilities auto-resolve with no
   *  picker (turn-panel.md §9: "auto-queues the ability with [self] as the friendly target...
   *  immediately... removes the panel") — AND every swipe-fired ability (`handleRecognizer:`,
   *  which queues directly, never opening `TargetPickerGui`). `via` distinguishes the two so a
   *  caller that logs/animates differently for tap-vs-swipe can. */
  onPick(cb: (choice: PanelChoice, via: "tap" | "swipe", gestureMidpoint?: { x: number; y: number }) => void): void {
    this.pickCb = cb;
  }

  /** `pickUsableAbility:`'s non-self-only branch (turn-panel.md §9): "otherwise it looks up
   *  targetPickerData.targetPickerGui and delegates target-picking to it" — every tapped ability
   *  whose targeting needs an explicit pick (single/multi enemy or friendly, or an all-*
   *  confirmation) routes here; Task 13 wires the actual `TargetPickerGui` popup. */
  onNeedsTargets(cb: (choice: PanelChoice) => void): void {
    this.needsTargetsCb = cb;
  }

  /** `infoPressed:` (followup-layout.md §2.1e: `info.png` -> `AbilityInfoDisplay`) — Task 13
   *  wires the actual popup. */
  onInfo(cb: (choice: PanelChoice) => void): void {
    this.infoCb = cb;
  }







  onActingCardTap(cb: (livingId: string) => void): void {
    this.actingCardTapCb = cb;
  }

  /** `lockedAbilityCallback:` (followup-layout.md §2.1a): shows the `"LockedAbility"` popup
   *  message. Not part of the brief's literal 3-callback list but explicitly mandated by its
   *  Composition section ("tap shows the LockedAbility popup message") — added additively rather
   *  than silently dropped or smuggled into `onInfo` (a different real selector/popup entirely). */
  onLockedTap(cb: () => void): void {
    this.lockedTapCb = cb;
  }

  /** A choice whose `PlayerChoice.blockReason` is set (`-[UsableAbility
   *  blockUseReasonForLiving:inCombat:]`, e.g. `"NoReplacementMembers"`). The source shows that
   *  localized reason in MonsterHatchPopup; it does not request notAllowed. The panel supplies the
   *  choice so BattleNode can own that popup, and never reaches `onPick`/`onNeedsTargets`. */
  onBlockedTap(cb: (choice: PanelChoice) => void): void {
    this.blockedTapCb = cb;
  }

  /** `capturePressed:` dispatch from the per-enemy `ButtonSprite`. */
  onCaptureTap(cb: (targetId: string) => void): void {
    this.captureTapCb = cb;
  }


  onDelayTap(cb: () => void): void {
    this.delayTapCb = cb;
  }


  onRetreatTap(cb: () => void): void {
    this.retreatTapCb = cb;
  }



  onBenchTap(cb: () => void): void {
    this.benchTapCb = cb;
  }

  /** Removes both the visible art and transparent hit proxy for one unavailable target. */
  removeCaptureButton(targetId: string): void {
    const removed = this.captureButtons.filter((entry) => entry.targetId === targetId);
    for (const entry of removed) {
      for (const node of entry.nodes) {
        if (!node.destroyed) node.destroy({ children: true });
      }
    }
    if (removed.length === 0) return;
    this.captureButtons = this.captureButtons.filter((entry) => entry.targetId !== targetId);
    this.captureHitTargets = this.captureHitTargets.filter((entry) => entry.targetId !== targetId);
  }

  /** Current live adjacent-card targets for render_game_to_text/browser lifecycle proof. */
  captureButtonTargetIds(): string[] {
    return this.captureButtons
      .filter((entry) => entry.nodes.some((node) => !node.destroyed))
      .map((entry) => entry.targetId);
  }

  /** Point-space centers exposed for deterministic browser interaction/alignment proof. */
  abilityInfoButtonStates(): Array<{
    slot: number;
    center: { x: number; y: number };
    tuCenter: { x: number; y: number };
  }> {
    return this.abilityInfoButtons
      .filter(({ button }) => !button.destroyed)
      .map(({ slot, row, button, tuLabel }) => ({
        slot,
        center: {
          x: row.position.x + button.position.x + button.width / 2,
          y: row.position.y + button.position.y + button.height / 2,
        },
        tuCenter: {
          x: row.position.x + tuLabel.position.x,
          y: row.position.y + tuLabel.position.y + tuLabel.height / 2,
        },
      }));
  }

  /** Real ability-card centers (locked/empty slots excluded) for display-mode-agnostic browser
   * input. This is presentation truth only; the engine choice remains authoritative. */
  abilityButtonStates(): Array<{
    slot: number;
    abilityPath: string;
    center: { x: number; y: number };
  }> {
    return this.abilityButtons
      .filter(({ button }) => !button.destroyed)
      .map(({ slot, abilityPath, row, button }) => ({
        slot,
        abilityPath,
        center: {
          x: row.position.x + button.position.x + button.width / 2,
          y: row.position.y + button.position.y + button.height / 2,
        },
      }));
  }

  /** Web-native number-key seam. It deliberately reuses the same locked, blocked, automatic-self,
   * and target-picker callbacks as the visible ability card instead of submitting to the engine
   * directly. */
  activateAbilitySlot(slot: 1 | 2 | 3 | 4): boolean {
    if (!this.visible) return false;
    if (this.lockedSlots.has(slot)) {
      this.lockedTapCb?.();
      return true;
    }
    const choice = this.choicesBySlot.get(slot);
    if (choice === undefined) return false;
    if (choice.blockReason !== undefined) {
      this.blockedTapCb?.(choice);
      return true;
    }
    this.handleTap(choice);
    return true;
  }

  /** Live point-space geometry for deterministic browser order/input proof. */
  secondaryButtonStates(): Array<{
    kind: SecondaryActionKind;
    center: { x: number; y: number };
    enabled: boolean;
  }> {
    return this.secondaryButtons
      .filter(({ button }) => !button.destroyed)
      .map(({ kind, box, button }) => ({
        kind,
        center: {
          x: box.position.x + button.position.x + button.width / 2,
          y: box.position.y + button.position.y + button.height / 2,
        },
        enabled: button.enabled,
      }));
  }

  actingCardLayoutState(): Record<string, unknown> | null {
    const card = this.actingCard;
    const livingId = this.actingLivingId;
    return card === undefined || livingId === undefined
      ? null
      : { livingId, ...card.sourceLayoutState };
  }






  notifyHp(id: string, hp: number): void {
    if (this.actingLivingId === id && this.actingCard && !this.actingCard.destroyed) {
      this.actingCard.setHp(hp);
    }
  }









  actingCardStatusHost(): { id: string; host: StatusOverlayHost } | null {
    const card = this.actingCard;
    const id = this.actingLivingId;
    if (!card || card.destroyed || id === undefined) return null;
    return {
      id,
      host: {
        monsterSpriteOf: (queryId) => (queryId === id && !card.destroyed ? card.monsterSprite : null),
        attachBehindMonster: (queryId, node) => {
          if (queryId !== id || card.destroyed) return false;
          card.addChildAt(node, 0); // before monsterSprite (the card's first child) -> painted behind it
          return true;
        },
      },
    };
  }

  /** Rebuilds the panel for `actor`'s turn and shows it. Every texture is resolved up front via
   *  `AssetLibrary` — a preload gap fails loudly rather than rendering a blank/wrong widget
   *  (matches every sibling `initTeam`/`refresh`). */
  async show(actor: FriendlySnapshot, choices: readonly PanelChoice[], showOpts: MonsterTurnPanelShowOpts = {}): Promise<void> {
    await this.ensureStaticChildren();
    this.abilityInfoButtons = [];
    this.secondaryButtons = [];
    this.dynamic.removeChildren().forEach((c) => c.destroy({ children: true }));

    const generalAtlas = await this.assets.atlas("General-hd");
    const hpBackTexture = generalAtlas.textures["monsterHpBarBack.png"];
    const hpForeTexture = generalAtlas.textures["monsterHpBar.png"];
    const infoTexture = generalAtlas.textures["info.png"];
    if (!hpBackTexture || !hpForeTexture || !infoTexture) {
      throw new Error("MonsterTurnPanel: General-hd atlas is missing monsterHpBar(Back)/info.png frames");
    }

    // NOTE: no separate acting-card backing sprite exists — the ornate frame around the acting
    // card is painted INTO combatBottomBar.png's left end (verified by viewing the asset; a
    // prior revision invented a combatSlideBar.png backing here, which is actually an unrelated
    // slider widget asset).
    const monsterTexture = await this.assets.sprite(actor.spriteKey);
    const actingCard = new FriendlyMonsterDisplay({
      name: actor.name,
      monsterTexture,
      ...(actor.rendererScale !== undefined ? { rendererScale: actor.rendererScale } : {}),
      hpBackTexture,
      hpForeTexture,
      maxHp: actor.maxHp,
      hp: actor.hp,
      ticker: this.ticker,
      slotWidth: TURN_PANEL_CARD_WIDTH, // turn-panel.md §1: winSize.width/6.0
    });
    actingCard.label = "turnPanel:actingCard";
    actingCard.setMainLiving(true);
    actingCard.eventMode = "static";
    actingCard.cursor = "pointer";
    actingCard.on("pointertap", (event) => {


      event.stopPropagation();
      this.actingCardTapCb?.(actor.id);
    });
    // (5,5) Cocos bottom-left (disasm-confirmed) — Pixi: bottom-anchor via the card's own
    // union-of-children height.
    this.dynamic.addChild(actingCard);
    actingCard.position.set(
      FRIENDLY_CARD_EDGE_INSET,
      SCREEN_H - FRIENDLY_CARD_EDGE_INSET - actingCard.contentHeight,
    );
    this.actingCard = actingCard;
    this.actingLivingId = actor.id;

    const buttonTexture = await this.assets.sprite("button-hd");
    const bySlot = new Map<number, PanelChoice>();
    for (const choice of choices) bySlot.set(slotNumberOf(choice.slot), choice);
    this.choicesBySlot.clear();
    this.abilityButtons = [];
    for (const [slot, choice] of bySlot) this.choicesBySlot.set(slot as 1 | 2 | 3 | 4, choice);
    const locked = new Set(
      lockedSlotNumbers([...bySlot.keys()], {
        unknownSkillsLeft: showOpts.unknownSkillsLeft ?? 4,
        ...(showOpts.evolveType !== undefined ? { evolveType: showOpts.evolveType } : {}),
      }),
    );
    this.lockedSlots = new Set(locked);

    for (const slot of [1, 2, 3, 4] as const) {
      const choice = bySlot.get(slot);
      if (!choice && !locked.has(slot)) continue; // counter exhausted -- renders nothing at all
      await this.buildAbilityCard(slot, choice, locked.has(slot), buttonTexture, infoTexture);
    }

    await this.buildBottomRow();
    await this.buildCaptureButtons(showOpts.captureHosts ?? [], showOpts.newLabelText);

    this.visible = true;
    this.gestureRecognizer.setEnabled(true);
  }






  hide(): void {
    this.gestureRecognizer.setEnabled(false);
    this.visible = false;
    this.removeCaptureButtons();
  }

  /** Propagates one `ProgressBar` ease tick to the acting card's HP bar (mirrors every sibling
   *  team-display's own `update(dtMs)`). */
  update(dtMs: number): void {
    this.actingCard?.update(dtMs);
    this.heroDisplay?.update(dtMs);
  }

  private async ensureStaticChildren(): Promise<void> {
    if (this.bar) return;







    const barTexture = await this.assets.sprite("combatBottomBar-hd");
    const bar = pointSprite(barTexture);



    bar.position.set(0, SCREEN_H - bar.height);
    this.addChildAt(bar, 0);
    this.bar = bar;

    this.addChild(this.dynamic);

    // HeroDisplay: doc constant `winSize - HeroDisplay.contentSize` (turn-panel.md §1 / team-
    // displays.md §4). team-displays.md §4 (the FriendlyTeamDisplay analysis that actually owns
    // HeroDisplay) resolves that formula to the *bottom-right* corner of the screen and notes it
    // "matches footage"; all reference frames (appstore_2, video frames 009/011/013) confirm the
    // ornate hero portrait sits bottom-right. In this port's point-space Pixi frame (panel at screen
    // origin, Y-down) the formula evaluates literally to (SCREEN_W - w, SCREEN_H - h) — a prior
    // revision dropped the y-term (used 0 = TOP), the #1 Cocos-Y-up→Pixi-Y-down flip bug. The
    // `contentSize` in that formula is heroFrame.png's size (team-displays.md §6), not the Pixi
    // bounds union — heroDisplayPosition/HeroDisplay.contentWidth/contentHeight. Added last
    // (topmost); this enabled copy owns the spirit-menu touch.
    const hero = await HeroDisplay.create(this.assets, {
      profile: this.profile,
      enabled: true,
      onPress: this.heroPress,
    });
    const heroPos = heroDisplayPosition(hero.contentWidth, hero.contentHeight);
    hero.position.set(heroPos.x, heroPos.y);
    this.addChild(hero);
    this.heroDisplay = hero;
  }

  get heroState(): HeroDisplay["debugState"] & { point: { x: number; y: number } | null } {
    const hero = this.heroDisplay;
    if (!hero) {
      return { readiness: 0, coverPercent: 1, flashing: false, flashOpacity: 0, enabled: true, point: null };
    }
    return {
      ...hero.debugState,
      point: { x: hero.x + hero.hitCenter.x, y: hero.y + hero.hitCenter.y },
    };
  }

  /**
   * One ability-row slot (turn-panel.md §2). `row`'s own local origin IS the Cocos anchor point
   * `(0.5, 1.0)` (E1 in followup-layout.md §2.1: top-center of the background sprite) — under
   * this port's ay -> 1-ay anchor flip (see popForward's citation in friendlyTeamDisplay.ts for
   * the same reasoning) that's Pixi anchor (0.5, 0), i.e. every child below is positioned as an
   * offset DOWN from the icon's own top edge, centered on its horizontal middle.
   */
  private async buildAbilityCard(
    slot: 1 | 2 | 3 | 4,
    choice: PanelChoice | undefined,
    locked: boolean,
    buttonTexture: Texture,
    infoTexture: Texture,
  ): Promise<void> {
    const row = new Container();
    // Slot anchor uses the ctor's 90/180 base and 75/172 step idiom pairs, normalized by
    // turnPanelMath.ts; anchor (0.5, 1.0) is raw-disasm-resolved there.
    const slotPos = abilitySlotPixiPos(slot);
    row.position.set(slotPos.x, slotPos.y);
    this.dynamic.addChild(row);

    let iconTexture = buttonTexture; // "button.png" -- both the "???" slot and non-swipeable real
    // abilities share this same background (followup-layout.md §2.1a/b).
    let direction: SwipeDirection | undefined;
    if (choice && swipeableFromTargeting(choice.targeting)) {
      direction = SWIPE_DIRECTION_BY_SLOT[slot];
      iconTexture = await this.assets.sprite(swipeSpriteKey(direction));
    }

    const icon = new ButtonSprite({ normalTexture: iconTexture });
    // Deterministic browser-scenario handle, matching `abilityInfo:${slot}` below. `ButtonSprite`
    // owns its own touch, so a scenario can assert this node is the top hit at the centre
    // `abilityButtonStates()` reports before blaming the ability for a click that never landed.
    icon.label = `ability:${slot}`;
    icon.position.set(-icon.width / 2, 0); // anchor (0.5,1.0) Cocos -> top-center, see method doc
    row.addChild(icon);

    if (locked) {




      const label = makeTtfLabel("???", 12, { outline: true });
      label.anchor.set(0.5, 0.5);
      label.position.set(icon.width / 2, icon.height / 2);
      icon.addChild(label);
      icon.onPress(() => this.lockedTapCb?.());
      return;
    }
    if (!choice) return; // counter exhausted (turn-panel.md §2a) -- no card at all for this slot

    const labelOffsets = abilityCardLabelOffsets();

    const nameLabel = makeTtfLabel(choice.displayName, 12, { outline: true });
    nameLabel.anchor.set(0.5, 0);
    nameLabel.position.set(0, labelOffsets.nameY);
    row.addChild(nameLabel);

    // Same bare PLAIN preset as the name label above (the init pass outlines both).
    const tuLabel: Text = makeTtfLabel(formatTU(choice.activationLength), 10, { outline: true });
    tuLabel.anchor.set(0.5, 0);
    tuLabel.position.set(0, labelOffsets.tuY);
    row.addChild(tuLabel);



    const infoBtn = new ButtonSprite({ normalTexture: infoTexture });
    infoBtn.label = `abilityInfo:${slot}`;
    const infoPos = abilityInfoButtonTopLeft(
      tuLabel.position.y,
      tuLabel.height,
      infoBtn.width,
      infoBtn.height,
      labelOffsets.infoCenterX,
    );
    infoBtn.position.set(infoPos.x, infoPos.y);
    infoBtn.onPress(() => this.infoCb?.(choice));
    row.addChild(infoBtn);
    this.abilityInfoButtons.push({ slot, row, button: infoBtn, tuLabel });

    // useAbilityCallback: (followup-layout.md §2.1b/c) is wired on BOTH swipeable and
    // non-swipeable real ability cards -- a swipeable card is still tappable.
    if (choice.blockReason !== undefined) {




      row.alpha = 0.5;
      icon.onPress(() => this.blockedTapCb?.(choice));
    } else {
      icon.onPress(() => this.handleTap(choice));
    }
    this.abilityButtons.push({ slot, abilityPath: choice.abilityPath, row, button: icon });

  }

  private handleTap(choice: PanelChoice): void {
    if (choice.targeting.kind === "self") {
      this.pickCb?.(choice, "tap"); // turn-panel.md §9: auto-queued, no picker
      return;
    }
    this.needsTargetsCb?.(choice);
  }

  private handleSwipeMatch(match: StrokeMatch): void {
    const slot = ([1, 2, 3, 4] as const).find((candidate) => SWIPE_DIRECTION_BY_SLOT[candidate] === match.name);
    if (slot === undefined) return;
    const choice = this.choicesBySlot.get(slot);
    if (!choice || !swipeableFromTargeting(choice.targeting)) return;
    if (choice.blockReason !== undefined) {
      // A blocked ability's swipe zone still overlays the (dimmed) card -- refuse exactly like its
      // tap handler does, rather than letting a swipe bypass the block (session.submitPlayerAction
      // throws on a blocked slot either way, so this must never reach that call).
      this.blockedTapCb?.(choice);
      return;
    }
    this.handleSwipe(choice, match.midpoint);
  }

  private handleSwipe(choice: PanelChoice, midpoint: { x: number; y: number }): void {
    // handleRecognizer: queues directly against the ability's default valid target(s) -- single
    // enemy or all enemies (turn-panel.md §9) -- which this class has no data to resolve itself
    // (it never receives the live target pool); the caller (Task 15) is responsible for that
    // resolution before calling `BattleSession.submitPlayerAction`.
    this.pickCb?.(choice, "swipe", midpoint);
  }





  private async buildBottomRow(): Promise<void> {
    const [benchTexture, retreatTexture, delayTexture] = await Promise.all([
      this.assets.sprite("benchButton-hd"),
      this.assets.sprite("retreatButton-hd"),
      this.assets.sprite("delayButton-hd"),
    ]);
    const box = new Box({ horizontal: true, gap: bottomRowGap(), positiveAlignDirection: true });
    const bench = new ButtonSprite({ normalTexture: benchTexture });
    const retreat = new ButtonSprite({ normalTexture: retreatTexture });
    const delay = new ButtonSprite({ normalTexture: delayTexture });
    delay.label = "secondary:delay";
    bench.label = "secondary:bench";
    retreat.label = "secondary:retreat";
    delay.onPress(() => this.delayTapCb?.());
    bench.onPress(() => this.benchTapCb?.());
    retreat.onPress(() => this.retreatTapCb?.());
    box.addBoxChild(delay);
    box.addBoxChild(bench);
    box.addBoxChild(retreat);
    const pos = bottomRowPixiPos(box.boxContentSize.w, this.bar!.height, box.boxContentSize.h);
    box.position.set(pos.x, pos.y);
    this.dynamic.addChild(box);
    this.secondaryButtons = [
      { kind: "delay", box, button: delay },
      { kind: "bench", box, button: bench },
      { kind: "retreat", box, button: retreat },
    ];
  }













  private async buildCaptureButtons(hosts: readonly CaptureHost[], newLabelText?: string): Promise<void> {
    this.removeCaptureButtons();
    if (hosts.length === 0) return;
    const atlas = await this.assets.atlas("InventoryItemFrames-hd");
    const texture = atlas.textures["Item_Card1.png"];
    if (!texture) throw new Error("MonsterTurnPanel: InventoryItemFrames-hd atlas is missing Item_Card1.png");

    const glowTexture = hosts.some((h) => h.isNew) ? await this.assets.sprite("cardGlow-hd") : undefined;
    const capturePosition = captureCardPixiPosition();
    for (const host of hosts) {
      // COCOS CHILD-Z SEMANTICS: the glow is `addChild:z:-1` on the ButtonSprite, and Cocos
      // draws negative-z children BEFORE the node's own texture (glow BEHIND the card art),
      // then self, then z>=0 children (the "NEW!" label ABOVE the art). A Pixi Sprite always
      // draws its own texture before every child, so the button is modeled as a Container
      // (position/scale/idle-shake owner = the ButtonSprite) whose card ART is an explicit
      // z=0 child — restoring a slot for the glow underneath. A prior revision parented the
      // glow to the art sprite itself, which pulsed it OVER the card (user-reported).
      const card = new Container();
      card.label = "captureCard"; // deterministic-scenario handle (Pixi node label, no visual effect)
      card.sortableChildren = true;
      card.scale.set(0.75);
      card.position.set(capturePosition.x, capturePosition.y);
      const art = pointSprite(texture);
      art.label = "captureCardArt";
      art.anchor.set(0.5, 0);
      card.addChild(art);
      host.node.addChild(card);
      // Cocos touch delegates arbitrate independently of sibling draw order. This transparent
      // proxy keeps the real ButtonSprite state machine above the z=2 name while the visible
      // card remains at its source z=0 below that name.
      const proxy = new ButtonSprite({
        normalTexture: texture,
        userObject: host.id,
        // Pixi prunes fully transparent branches from pointer hit testing; 1/1000 is visually
        // imperceptible but keeps this Cocos-dispatch proxy in the event tree.
        spriteAlpha: 0.001,
      });
      proxy.label = "captureCardHit";
      proxy.scale.set(0.75);
      proxy.position.set(capturePosition.x, capturePosition.y);
      proxy.pivot.set(proxy.width / proxy.scale.x / 2, 0);
      proxy.zIndex = 3;
      host.node.addChild(proxy);
      this.captureHitTargets.push({ node: proxy, targetId: host.id });
      this.captureButtons.push({ targetId: host.id, nodes: [card, proxy] });
      void this.runCaptureCardIdle(card, proxy);
      if (host.isNew) {
        if (!glowTexture) throw new Error("MonsterTurnPanel: cardGlow texture unresolved for a NEW host");
        if (newLabelText === undefined) {
          throw new Error("MonsterTurnPanel: newLabelText (localized NewKey) is required when a host isNew");
        }
        this.buildNewOverlay(card, 0, art.height / 2, glowTexture, newLabelText);
      }
    }
  }

















  private buildNewOverlay(
    card: Container,
    centerX: number,
    centerY: number,
    glowTexture: Texture,
    newLabelText: string,
  ): void {
    const center = { x: centerX, y: centerY };

    const glow = pointSprite(glowTexture);
    glow.label = "captureCardGlow";
    glow.anchor.set(0.5, 0.5);
    glow.scale.set(glow.scale.x * NEW_OVERLAY_GLOW_SCALE, glow.scale.y * NEW_OVERLAY_GLOW_SCALE);
    glow.position.set(center.x, center.y);
    glow.zIndex = -1;
    card.addChild(glow);
    void this.runNewGlowPulse(glow);



    const label = makeTtfLabel(newLabelText, NEW_OVERLAY_LABEL_SIZE, { outline: true });
    label.label = "captureCardNewLabel";
    label.anchor.set(0.5, 0.5);
    // makeTtfLabel's node scale is its 1/CSF raster fold — multiply the source's scale onto it.
    this.setLabelSourceScale(label, NEW_OVERLAY_LABEL_START_SCALE);
    label.position.set(center.x, center.y);
    label.zIndex = 0; // plain addChild: after the art — stable sort keeps it above (Cocos z=0-after-self)
    card.addChild(label);
    void this.runNewLabelPop(label);
  }

  /** Applies a source-space scale on top of makeTtfLabel's built-in 1/CSF raster fold. */
  private setLabelSourceScale(label: Text, sourceScale: number): void {
    label.scale.set(sourceScale / CONTENT_SCALE_FACTOR);
  }


  private async runNewGlowPulse(glow: Sprite): Promise<void> {
    while (!glow.destroyed) {
      await tween(this.ticker, NEW_OVERLAY_GLOW_FADE_LEG_MS, (t) => {
        if (!glow.destroyed) glow.alpha = 1 - t;
      });
      if (glow.destroyed) return;
      await tween(this.ticker, NEW_OVERLAY_GLOW_FADE_LEG_MS, (t) => {
        if (!glow.destroyed) glow.alpha = t;
      });
    }
  }



  private async runNewLabelPop(label: Text): Promise<void> {
    const from = NEW_OVERLAY_LABEL_START_SCALE;
    const to = NEW_OVERLAY_GLOW_SCALE;
    await tween(
      this.ticker,
      NEW_OVERLAY_LABEL_POP_MS,
      (t) => {
        if (!label.destroyed) this.setLabelSourceScale(label, from + (to - from) * t);
      },
      easeElasticInOut,
    );
    if (label.destroyed) return;
    await tween(this.ticker, NEW_OVERLAY_LABEL_FADE_REMOVE_MS, (t) => {
      if (!label.destroyed) label.alpha = 1 - t;
    });
    if (!label.destroyed) label.destroy();
  }





  private async runCaptureCardIdle(card: Container, proxy?: Container): Promise<void> {
    const delayMs = captureCardIdleDelayMs(this.rand());
    const base = { x: card.position.x, y: card.position.y };
    while (!card.destroyed) {
      await tween(this.ticker, delayMs, () => {});
      if (card.destroyed) return;
      await tween(this.ticker, CAPTURE_CARD_SHAKE_MS, (t) => {
        if (card.destroyed) return;
        const e = easeElasticOut(t, 0.1);
        const d = shakenOffset(e, CAPTURE_CARD_SHAKE_OFFSET);
        card.position.set(base.x + d, base.y - d);
        proxy?.position.set(base.x + d, base.y - d);
      });
      if (card.destroyed) return;
      card.position.set(base.x, base.y);
      proxy?.position.set(base.x, base.y);
    }
  }

  private removeCaptureButtons(): void {
    for (const entry of this.captureButtons) {
      // children:true — the NEW overlay's glow/label are card children whose animation loops
      // key off their own `destroyed` flags.
      for (const node of entry.nodes) {
        if (!node.destroyed) node.destroy({ children: true });
      }
    }
    this.captureButtons = [];
    this.captureHitTargets = [];
  }

  private handleCaptureSceneTap(event: FederatedPointerEvent): void {
    if (!this.visible) return;
    for (const hit of this.captureHitTargets) {
      if (hit.node.destroyed) continue;
      const bounds = hit.node.getBounds();
      if (
        event.global.x >= bounds.x &&
        event.global.x < bounds.x + bounds.width &&
        event.global.y >= bounds.y &&
        event.global.y < bounds.y + bounds.height
      ) {
        this.captureTapCb?.(hit.targetId);
        return;
      }
    }
  }
}
