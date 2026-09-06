


import { Container, type Sprite, type Ticker } from "pixi.js";
import { pointSprite, type AssetLibrary } from "@dib/renderer";
import { tween, easeExponentialInOut } from "../tween.js"; // ease used by popForward only
import { FriendlyMonsterDisplay } from "./friendlyMonsterDisplay.js";
import { HeroDisplay } from "./heroDisplay.js";
import type { BattlePlayerProfile } from "../player/battlePlayerState.js";
import {
  SCREEN_W,
  SCREEN_H,
  SUMMON_SLOT_INDEX,
  SUMMON_EVICT_DELAY_MS,
  SUMMON_EVICT_REMOVE_MS,
  SPIRIT_BKG_Y_COCOS,
  SPIRIT_BKG_OPACITY,
  partyCardX,
  POP_FORWARD_X_FRACTION,
  POP_FORWARD_Y_COCOS,
  POP_FORWARD_ENTRY_MS,
  POP_FORWARD_HOLD_MS,
  POP_FORWARD_EXIT_MS,
  FRIENDLY_SLOT_REFLOW_MS,
  FRIENDLY_ROW_Y_COCOS,
  positionForSlot,
  deathThenCompactSchedule,
  heroDisplayPosition,
} from "./displayShared.js";

/** Minimal, local snapshot type (Task 15 builds this from BattleSession + GameData — mirrors
 *  `EnemySnapshot` in enemyTeamDisplay.ts). */
export interface FriendlySnapshot {
  id: string;
  name: string;
  /** AssetLibrary sprite key for the standalone field sprite, e.g. "FireCub-hd". */
  spriteKey: string;
  hp: number;
  maxHp: number;
  /** `Monsters.json` `rendererData.scale` — data-driven field-sprite scale, used by the
   *  `popForward` spotlight clone (the full-size field renderable). */
  rendererScale?: number;
}

const sleep = (ticker: Ticker, ms: number, signal?: AbortSignal): Promise<void> =>
  ms <= 0 ? Promise.resolve() : tween(ticker, ms, () => {}, (t) => t, signal);

export interface FriendlyTeamDisplayOpts {
  assets: AssetLibrary;
  ticker: Ticker;
  profile: BattlePlayerProfile;
}

export class FriendlyTeamDisplay extends Container {
  private readonly assets: AssetLibrary;
  private readonly ticker: Ticker;
  private readonly profile: BattlePlayerProfile;
  private readonly cards = new Map<string, FriendlyMonsterDisplay>();
  /** Removed cards keep presenting their independent 1s spin/shrink after leaving the three
   * live `slots`, matching `dieingMonsterNodes` in the native display. */
  private readonly dyingCards = new Map<string, FriendlyMonsterDisplay>();
  /** Slot index -> monster id, i.e. `team.monsterMembers` order (team-displays.md §4
   *  "adjustMonsterSlots"). The summon occupant is NEVER in this list — it lives in the
   *  `summonId` ivar (native `summonDisplay`, soulstones.md §10.11) outside the party reflow. */
  private order: string[] = [];
  /** Native `summonDisplay` ivar (soulstones.md §10.11.1) — the current summon occupant's id.
   *  Its card also lives in `cards` (the summon is targetable/buffable exactly like a regular
   *  slot, §10.11.2/§10.11.4) but is excluded from `order` so party reflow never touches it. */
  private summonId: string | undefined;
  /** Evicted summon cards riding out §10.11.1's `CCDelayTime(1.0)+RemoveFromParentAction(0.5)` —
   *  still parented/visible (hard cut at 1.5s, no fade) but already outside `cards`/`summonId`,
   *  mirroring the native ivar being nulled synchronously at the top of the notify method. */
  private readonly lingeringSummonCards = new Set<FriendlyMonsterDisplay>();
  private readonly rendererScales = new Map<string, number>();
  private bottomBar: Sprite | undefined;
  private heroDisplay: HeroDisplay | undefined;
  private spiritBackground: Sprite | undefined;
  private summonSelectMode = false;
  private tapCallback: ((id: string) => void) | undefined;
  private emptySpiritTapCallback: (() => void) | undefined;
  private popForwardCount = 0;
  private popForwardStarts = 0;
  private readonly activePopForwardNodes = new Set<Sprite>();
  /** The spotlight is parented directly to BattleNode's scene, not to this display. Destroying
   *  that scene (world exit or rematch) therefore destroys the clone while its free-standing
   *  entry/hold/exit action may still be running. Abort those ticker listeners before Pixi nulls
   *  the clone's transform; this mirrors removeFromParentAndCleanup:YES stopping Cocos actions. */
  private readonly popForwardActions = new AbortController();

  get activePopForwardCount(): number {
    return this.popForwardCount;
  }

  /** Cumulative pop-forward starts (debug/browser choreography, including completed actions). */
  get popForwardStartCount(): number {
    return this.popForwardStarts;
  }

  get cardLayoutStates(): Array<Record<string, unknown>> {
    return this.order.flatMap((id) => {
      const card = this.cards.get(id);
      return card ? [{ id, ...card.sourceLayoutState }] : [];
    });
  }

  get memberPositionState(): Array<{ id: string; x: number; y: number; dying: boolean }> {
    return [
      ...this.order.flatMap((id) => {
        const card = this.cards.get(id);
        return card ? [{ id, x: card.x, y: card.y, dying: false }] : [];
      }),
      ...[...this.dyingCards].map(([id, card]) => ({ id, x: card.x, y: card.y, dying: true })),
    ];
  }

  constructor(opts: FriendlyTeamDisplayOpts) {
    super();
    this.assets = opts.assets;
    this.ticker = opts.ticker;
    this.profile = opts.profile;
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.popForwardActions.abort();
    super.destroy(options);
  }

  /**
   * Builds (or rebuilds, on rematch) the friendly row from `friends`, in roster order (slot index
   * = array index). Resolves every texture up front via `AssetLibrary` — a preload gap fails
   * loudly here rather than rendering a blank/wrong widget (mirrors `EnemyTeamDisplay.initTeam`).
   * The initial build places cards directly at their slot (no reflow animation — reflow is only
   * for subsequent roster changes, see `adjustMonsterSlots`).
   */
  async initTeam(friends: FriendlySnapshot[]): Promise<void> {
    for (const card of this.cards.values()) card.destroy({ children: true });
    for (const card of this.dyingCards.values()) card.destroy({ children: true });
    for (const card of this.lingeringSummonCards) card.destroy({ children: true });
    this.cards.clear();
    this.dyingCards.clear();
    this.lingeringSummonCards.clear();
    this.order = [];
    this.summonId = undefined;
    this.rendererScales.clear();

    await this.ensureBottomBar();
    await this.ensureSpiritBackground();
    // §10.11.3's flagged construction-time asymmetry: the ORIGINAL only toggles this reactively
    // (on the next replacedSummon event), so a rebuild must restore the empty-summon state itself
    // — a rematch after a summon-occupied battle would otherwise keep the box hidden.
    if (this.spiritBackground) this.spiritBackground.visible = true;
    await this.ensureHeroDisplay();

    for (const f of friends) {
      const card = await this.buildCard(f);
      this.addChild(card);
      this.cards.set(f.id, card);
      this.order.push(f.id);
    }
    this.adjustMonsterSlots(false);
  }

  /** `-[FriendlyMonsterDisplay notifyLiving:healthChangedTo:delta:]` delegate. No-op for an
   *  unknown id (a stale event after death is expected, not an error). */
  notifyHp(id: string, hp: number): void {
    (this.cards.get(id) ?? this.dyingCards.get(id))?.setHp(hp);
  }


  notifyPlayerTurnStarted(): void {
    this.dyingCards.clear();
  }

  hasMonster(id: string): boolean {
    return this.cards.has(id);
  }


  async notifyAdded(f: FriendlySnapshot): Promise<void> {
    await this.notifyAddedMany([f]);
  }

  /** Batched form used when one all-target impact promotes several reserves synchronously.
   * Native Team sends its add notifications in replacementMembers order; serial construction
   * keeps that order deterministic even though browser texture lookup is asynchronous. All new
   * cards snap to their final slots, while any surviving old cards receive the one-second move. */
  async notifyAddedMany(friends: readonly FriendlySnapshot[]): Promise<void> {
    const newIds = new Set<string>();
    for (const f of friends) {
      if (this.cards.has(f.id)) continue;
      const card = await this.buildCard(f);
      this.addChild(card);
      this.cards.set(f.id, card);
      this.order.push(f.id);
      newIds.add(f.id);
    }
    this.adjustMonsterSlots(true, newIds);
  }


  async notifyDied(id: string): Promise<void> {
    // The summon occupant is not in the native `slots` dict this handler walks — a dying summon's
    // ONLY removal presentation is the `notifySummonChanged` eviction linger (soulstones.md
    // §10.11.1); running the party death-spin/compact on it here would double-present.
    if (id === this.summonId) return;
    const card = this.cards.get(id);
    if (!card) return;


    this.cards.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this.dyingCards.set(id, card);
    const [, compact, remove] = deathThenCompactSchedule();
    await Promise.all([
      card.performDeathAnimation(),
      sleep(this.ticker, compact!.atMs),
    ]);
    // Native adjustMonsterSlots compacts the live row now, but retains the scale-zero card in
    // dieingMonsterNodes for its own 1.0s RemoveFromParentAction. Keep that lifecycle separate
    // from the visible spin/scale action just as the source does.
    this.adjustMonsterSlots(true);
    await sleep(this.ticker, remove!.durationMs);
    this.dyingCards.delete(id);
    card.destroy({ children: true });
  }


  async notifySummonChanged(added: FriendlySnapshot | undefined): Promise<void> {
    const oldId = this.summonId;
    const oldCard = oldId !== undefined ? this.cards.get(oldId) : undefined;
    if (oldId !== undefined) {
      this.cards.delete(oldId);
      this.rendererScales.delete(oldId);
    }
    this.summonId = undefined;
    if (oldCard) {
      if (added === undefined) {
        this.lingeringSummonCards.add(oldCard);
        void this.evictSummonCard(oldCard);
      } else {
        oldCard.destroy({ children: true });
      }
    }
    if (added !== undefined) {
      const card = await this.buildCard(added);
      this.addChild(card);
      this.cards.set(added.id, card);
      this.summonId = added.id;
      card.position.set(
        positionForSlot(SUMMON_SLOT_INDEX),
        SCREEN_H - FRIENDLY_ROW_Y_COCOS - card.contentHeight,
      );
    }
    if (this.spiritBackground) this.spiritBackground.visible = this.summonId === undefined;
  }

  /** §10.11.1's eviction sequence — 1.0s delay + 0.5s inert RemoveFromParentAction, then a hard
   *  cut. The card keeps rendering untouched throughout; it is already out of `cards`, so any
   *  stale HP event for it simply no-ops (same as post-death events, `notifyHp`'s contract). */
  private async evictSummonCard(card: FriendlyMonsterDisplay): Promise<void> {
    await sleep(this.ticker, SUMMON_EVICT_DELAY_MS + SUMMON_EVICT_REMOVE_MS);
    this.lingeringSummonCards.delete(card);
    if (!card.destroyed) card.destroy({ children: true });
  }

  /** Current summon occupant + its card geometry (browser/test probe — mirrors
   *  `memberPositionState`'s role for the party row). `lingering` counts evicted cards still
   *  riding out the 1.5s removal action. */
  get summonDisplayState(): { id: string; x: number; y: number } | undefined {
    if (this.summonId === undefined) return undefined;
    const card = this.cards.get(this.summonId);
    return card ? { id: this.summonId, x: card.x, y: card.y } : undefined;
  }

  get lingeringSummonCount(): number {
    return this.lingeringSummonCards.size;
  }

  get spiritBackgroundVisible(): boolean | undefined {
    return this.spiritBackground?.visible;
  }

  /** For targeting/effects — the monster's own card node. Throws for an unknown id (fail loudly
   *  rather than let a caller silently target nothing, mirrors `EnemyTeamDisplay.nodeOf`). */
  nodeOf(id: string): FriendlyMonsterDisplay {
    const card = this.cards.get(id);
    if (!card) throw new Error(`FriendlyTeamDisplay.nodeOf: unknown monster id "${id}"`);
    return card;
  }

  /** `FriendlyMonsterDisplay statusEffectParent` is the monster sprite. */
  targetNodeOf(id: string): Sprite {
    return this.nodeOf(id).monsterSprite;
  }

  /** Null-safe sibling of `targetNodeOf` for the persistent status-overlay subsystem
   *  (status-effects.md §1) — a stale/removed id is expected there (mirrors `notifyHp`), not a
   *  fidelity bug worth throwing over. */
  monsterSpriteOf(id: string): Sprite | null {
    return this.cards.get(id)?.monsterSprite ?? null;
  }

  /** Inserts `node` as a sibling of `id`'s monster sprite, painted BEHIND it — see
   *  `enemyTeamDisplay.ts`'s `attachBehindMonster` for the full negative-z rationale
   *  (statusOverlay.ts's header). This widget has no `sortableChildren` z-index sort (its paint
   *  order is plain insertion order, per this class's own header), so the equivalent here is
   *  inserting at index 0 — before `monsterSprite`, which is the first child added in
   *  `FriendlyMonsterDisplay`'s own constructor. */
  attachBehindMonster(id: string, node: Container): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.addChildAt(node, 0);
    return true;
  }

  /** Propagates one `ProgressBar` ease tick to every live HP bar (see
   *  `FriendlyMonsterDisplay.update`). */
  update(dtMs: number): void {
    for (const card of this.cards.values()) card.update(dtMs);
    this.heroDisplay?.update(dtMs);
  }

  /** Registers the tap callback Task 13 uses to open `LivingInfoDisplay` for the tapped monster
   *  (`ccTouchEnded:` -> base `LivingDisplay` touch flow -> `monsterTouched`, team-displays.md §3/
   *  §4). Only one callback is kept at a time (matches every other `on*` wiring point in this
   *  battle UI, e.g. `Hud.showChoices`). */
  onCardTap(cb: (id: string) => void): void {
    this.tapCallback = cb;
  }

  onEmptySpiritTap(cb: () => void): void {
    this.emptySpiritTapCallback = cb;
  }

  /** `Battle.state == 3` ("select summon") gate on `FriendlyMonsterDisplay.ccTouchBegan:`
   *  (team-displays.md §4: "only accepts the touch... if mainLiving is true **or** the battle is
   *  in state 3"). BattleNode drives it only for the source-equivalent target-picking state;
   *  it defaults false for every ordinary field presentation. */
  setSummonSelectMode(active: boolean): void {
    this.summonSelectMode = active;
  }


  async popForward(id: string, onParent: Container, zIndex: number): Promise<void> {
    const card = this.nodeOf(id);
    const clone = pointSprite(card.monsterTexture);
    // Full-size field renderable = natural point size × the data-driven rendererData.scale
    // (mirrors EnemyMonsterDisplay's field-sprite sizing; footage frame_021 shows the spotlight
    // at field size, not card-thumbnail size).
    const dataScale = this.rendererScales.get(id) ?? 1;
    clone.scale.set(clone.scale.x * dataScale, clone.scale.y * dataScale);


    clone.anchor.set(0.5, 1);
    const targetX = POP_FORWARD_X_FRACTION * SCREEN_W;
    const targetY = SCREEN_H - POP_FORWARD_Y_COCOS;
    const contentHeight = clone.height;
    // Cocos `(90-height) -> 90 -> -height`, converted directly into this Pixi Y-down frame.
    clone.position.set(targetX, targetY + contentHeight);
    clone.label = "friendlyAttackSpotlight";
    clone.zIndex = zIndex;
    onParent.addChild(clone);
    this.activePopForwardNodes.add(clone);
    this.popForwardStarts += 1;
    this.popForwardCount += 1;
    const signal = this.popForwardActions.signal;
    try {
      await tween(
        this.ticker,
        POP_FORWARD_ENTRY_MS,
        (t) => {
          if (!clone.destroyed) clone.y = targetY + contentHeight * (1 - t);
        },
        easeExponentialInOut,
        signal,
      );
      if (signal.aborted) return;
      await sleep(this.ticker, POP_FORWARD_HOLD_MS, signal);
      if (signal.aborted) return;
      await tween(
        this.ticker,
        POP_FORWARD_EXIT_MS,
        (t) => {
          if (!clone.destroyed) clone.y = targetY + (SCREEN_H + contentHeight - targetY) * t;
        },
        easeExponentialInOut,
        signal,
      );
    } finally {
      this.popForwardCount -= 1;
      this.activePopForwardNodes.delete(clone);
      if (!clone.destroyed) clone.destroy();
    }
  }

  /** Browser contract surface for the source's direct-BattleNode z=2 spotlight attachment. */
  get popForwardPaintState(): Array<{ zIndex: number; parentIsFriendlyDisplay: boolean }> {
    return [...this.activePopForwardNodes].map((node) => ({
      zIndex: node.zIndex,
      parentIsFriendlyDisplay: node.parent === this,
    }));
  }


  private adjustMonsterSlots(animate: boolean, newIds: ReadonlySet<string> = new Set()): void {
    this.order.forEach((id, i) => {
      const card = this.cards.get(id);
      if (!card) return;


      const x = partyCardX(i);
      const y = SCREEN_H - FRIENDLY_ROW_Y_COCOS - card.contentHeight;
      if (!animate || newIds.has(id) || (card.position.x === x && card.position.y === y)) {
        card.position.set(x, y);
        return;
      }
      void this.animateCardTo(card, x, y);
    });
  }


  private async animateCardTo(card: FriendlyMonsterDisplay, x: number, y: number): Promise<void> {
    const startX = card.position.x;
    const startY = card.position.y;
    await tween(this.ticker, FRIENDLY_SLOT_REFLOW_MS, (t) => {
      // Several members can die on one impact (notably UnhappyBird's Detonate). Each source
      // removal schedules its own delayed adjustMonsterSlots, so an earlier compaction can have
      // started a MoveTo on a card that a sibling removal destroys on the same tick. Cocos
      // removeFromParentAndCleanup:YES stops that node's actions; mirror that lifecycle gate
      // before touching Pixi's transform, which destroy() nulls internally.
      if (card.destroyed) return;
      card.position.set(startX + (x - startX) * t, startY + (y - startY) * t);
    });
  }

  private handleCardTap(id: string, card: FriendlyMonsterDisplay): void {

    if (!card.isMainLiving && !this.summonSelectMode) return;
    this.tapCallback?.(id);
  }

  private async buildCard(f: FriendlySnapshot): Promise<FriendlyMonsterDisplay> {
    const hpAtlas = await this.assets.atlas("General-hd");
    const hpBackTexture = hpAtlas.textures["monsterHpBarBack.png"];
    const hpForeTexture = hpAtlas.textures["monsterHpBar.png"];
    if (!hpBackTexture || !hpForeTexture) {
      throw new Error("FriendlyTeamDisplay: General-hd atlas is missing monsterHpBar(Back).png frames");
    }
    const monsterTexture = await this.assets.sprite(f.spriteKey);
    if (f.rendererScale !== undefined) this.rendererScales.set(f.id, f.rendererScale);
    const card = new FriendlyMonsterDisplay({
      name: f.name,
      monsterTexture,
      ...(f.rendererScale !== undefined ? { rendererScale: f.rendererScale } : {}),
      hpBackTexture,
      hpForeTexture,
      maxHp: f.maxHp,
      hp: f.hp,
      ticker: this.ticker,
      slotWidth: SCREEN_W / 5,
    });
    card.eventMode = "static";
    card.cursor = "pointer";
    card.on("pointertap", () => this.handleCardTap(f.id, card));
    return card;
  }

  /** `combatBottomBar.png` background, anchor (0,0) — bottom-left anchored, spans up from the
   *  screen's bottom edge (team-displays.md §4: the FIRST composition item of
   *  `initWithTeam:` — previously missing entirely from this port, leaving the cards floating
   *  on the field with no bar). The -hd sprite is 512pt wide vs the 480pt screen, so it's
   *  horizontally centered (same bleed convention as the battle background / the turn panel's
   *  own bar). Built lazily, reused across `initTeam` rebuilds. */
  private async ensureBottomBar(): Promise<void> {
    if (this.bottomBar) return;
    const texture = await this.assets.sprite("combatBottomBar-hd");
    const bar = pointSprite(texture);


    bar.position.set(0, SCREEN_H - bar.height);
    this.addChildAt(bar, 0);
    this.bottomBar = bar;
  }

  /** `HeroDisplay` at `winSize - heroDisplay.contentSize` — bottom-right of the screen
   *  (team-displays.md §4: FriendlyTeamDisplay owns the hero portrait; it is visible whenever
   *  the friendly row is, panel or no panel — footage frames 013/017/021). `contentSize` is
   *  heroFrame.png's size (team-displays.md §6), not the Pixi bounds union —
   *  heroDisplayPosition/HeroDisplay.contentWidth/contentHeight. This field-owned copy remains
   *  disabled; the turn-panel-owned copy receives chooser taps. */
  private async ensureHeroDisplay(): Promise<void> {
    if (this.heroDisplay) return;
    const hero = await HeroDisplay.create(this.assets, { profile: this.profile, enabled: false });
    const heroPos = heroDisplayPosition(hero.contentWidth, hero.contentHeight);
    hero.position.set(heroPos.x, heroPos.y);
    this.addChild(hero);
    this.heroDisplay = hero;
  }

  get heroState(): HeroDisplay["debugState"] {
    return this.heroDisplay?.debugState ?? {
      readiness: 0, coverPercent: 1, flashing: false, flashOpacity: 0, enabled: false,
    };
  }

  /** `spiritBackground` (`spiritBkg.png`, team-displays.md §4) — see displayShared.ts's
   *  `SPIRIT_BKG_Y_COCOS`/`SPIRIT_BKG_OPACITY` for the cited tint/opacity/y. Visible only while
   *  the slot is empty; state-3 taps produce NoSpirit rather than opening the hero chooser.
   *  Built lazily and reused across `initTeam` rebuilds. Occupies the leftmost fifth of the
   *  bar (slot 0's own position — see `positionForSlot`'s footage-derived slot mapping). */
  private async ensureSpiritBackground(): Promise<void> {
    if (this.spiritBackground) return;
    const texture = await this.assets.sprite("spiritBkg-hd");
    const bg = pointSprite(texture);
    bg.anchor.set(0.5, 0.5); // CCSprite spriteWithFile:'s real default (no override cited here)
    bg.tint = 0x000000; // setColor:0
    bg.alpha = SPIRIT_BKG_OPACITY;


    bg.position.set(SPIRIT_BKG_Y_COCOS, SCREEN_H - SPIRIT_BKG_Y_COCOS);
    bg.eventMode = "static";
    bg.on("pointertap", (event) => {
      // FriendlyTeamDisplay.ccTouchBegan: claims this exact region only in Battle.state 3,
      // while the friendly row is visible and the summon slot is empty.
      if (!this.summonSelectMode || !this.visible || this.summonId !== undefined) return;
      event.stopPropagation();
      this.emptySpiritTapCallback?.();
    });
    this.addChild(bg);
    this.spiritBackground = bg;
  }
}
