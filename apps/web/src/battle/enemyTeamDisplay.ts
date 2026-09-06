
























import { Container, Text, type Sprite, type Texture, type Ticker } from "pixi.js";
import {
  Box,
  pointSprite,
  makeTtfLabel,
  OUTLINE_FADE_ALPHA,
  type AssetLibrary,
} from "@dib/renderer";
import { EnemyMonsterDisplay } from "./enemyMonsterDisplay.js";
import { tween, easeExponentialOut, easeExponentialInOut } from "../tween.js";
import {
  enemyNameColor,
  ENEMY_NAME_COLOR_FALLBACK,
  SCREEN_W,
  SCREEN_H,
  ENEMY_SLOT_WIDTH,
  ENEMY_SLOT_HEIGHT,
  MEMBERS_BOX_GAP_TWO,
  BENCH_BOX_INSET,
  membersBoxXCocos,
  membersBoxYCocos,
  enemyEntranceDelayMs,
  enemyEntranceDropPts,
  ENEMY_ENTRANCE_MOVE_MS,
  ENEMY_ADDED_REORDER_DELAY_MS,
  ENEMY_REORDER_MOVE_MS,
  reorderEntranceStart,
} from "./displayShared.js";




export interface EnemySnapshot {
  id: string;
  name: string;
  /** AssetLibrary sprite key for the standalone field sprite, e.g. "Minotaur-hd". */
  spriteKey: string;







  portraitFrame?: string;
  hp: number;
  maxHp: number;
  /** Star count in halves (e.g. Spark 2.5 — see class doc). */
  rarity?: number;
  /** `Monsters.json` `rendererData.scale` (data-driven field-sprite scale — see
   *  EnemyMonsterDisplayOpts.rendererScale). */
  rendererScale?: number;
  /** Monster element (e.g. "Fire") — resolves the General-hd `Element<element>.png` badge. */
  element?: string;
}

export interface EnemyTeamDisplayOpts {
  assets: AssetLibrary;
  ticker: Ticker;
}

export type EnemyBenchTapResult = "analyzeNotReady" | "noMonstersToAnalyze" | "showReserves";

export class EnemyTeamDisplay extends Container {
  private readonly assets: AssetLibrary;
  private readonly ticker: Ticker;
  private readonly membersBox = new Box({ horizontal: true, gap: 0, positiveAlignDirection: true });
  /** Insertion order mirrors the original's `memberNodes` (join order, promoted reserves
   *  appended at the end); dead members are deleted on `notifyDied`. */
  private readonly displays = new Map<string, EnemyMonsterDisplay>();

  private readonly colorSlots = new Map<string, number>();
  /** Built-but-unparented promoted reserves awaiting the 1.0s-deferred `reorderMonsters`
   *  (original: in `memberNodes` but with `parent != membersBox`). */
  private pendingAdds: EnemyMonsterDisplay[] = [];
  /** `stopActionByTag:1` stand-in: bumping cancels the pending deferred reorder. */
  private reorderGen = 0;
  /** Per-node move-tween cancellation (the original's later `runAction:` simply out-writes the
   *  earlier MoveTo each frame; one canonical move per node is this port's equivalent). */
  private readonly moveGen = new WeakMap<Container, number>();
  private benchBadge: Container | undefined;
  private benchLabel: Text | undefined;
  private benchCount = 0;
  private analyzeEnabled = false;
  private benchBlinkGen = 0;
  private benchBlinkRunning = false;
  private initialEntranceStarted = false;
  private elementTapCb: ((element: string) => void) | undefined;
  private analyzeTapCb: ((id: string) => void) | undefined;
  private benchTapCb: ((result: EnemyBenchTapResult) => boolean) | undefined;
  private bodyPressStartCb: ((id: string) => boolean) | undefined;
  private bodyPressEndCb: ((id: string) => void) | undefined;

  constructor(opts: EnemyTeamDisplayOpts) {
    super();
    this.assets = opts.assets;
    this.ticker = opts.ticker;
    this.addChild(this.membersBox);
  }









  async initTeam(enemies: EnemySnapshot[]): Promise<void> {
    this.initialEntranceStarted = false;
    this.membersBox.visible = false;
    this.analyzeEnabled = false;
    this.benchBlinkGen += 1;
    this.benchBlinkRunning = false;
    if (this.benchLabel) this.benchLabel.alpha = 1;
    this.reorderGen++; // cancel any pending reorder from a previous battle
    for (const pending of this.pendingAdds) pending.destroy({ children: true });
    this.pendingAdds = [];
    this.membersBox.clearBoxChildren();
    this.displays.clear();
    this.colorSlots.clear();
    await this.ensureBenchBadge();
    this.setBenchCount(0);


    this.membersBox.gap = enemies.length === 2 ? MEMBERS_BOX_GAP_TWO : 0;

    for (const [i, e] of enemies.entries()) {
      this.colorSlots.set(e.id, i);
      const display = await this.buildDisplay(e, enemyNameColor(i));
      // EnemyMonsterDisplay has a fixed source-authored contentSize. Monster art is allowed to
      // overflow it visually, but that overflow must not widen the Box slot.
      this.membersBox.addBoxChild(display, {
        contentSize: { w: ENEMY_SLOT_WIDTH, h: ENEMY_SLOT_HEIGHT },
      });
      this.displays.set(e.id, display);
    }
    this.applyMembersBoxPosition();

  }

  /** Begin the source entrance only after BattleNode receives onEnterTransitionDidFinish.
   * The complete box remains hidden until every asynchronously built child has been placed at
   * its roundf'd 125pt-above-rest start, so intermediate members cannot flash at their packed
   * positions. Movement remains fire-and-forget with the source 0.5s + 0.25s·i stagger. */
  startInitialEntrance(): void {
    if (this.initialEntranceStarted) return;
    this.initialEntranceStarted = true;
    let index = 0;
    for (const display of this.displays.values()) {
      display.startInitialActions();
      void this.runInitialEntrance(display, index);
      index++;
    }
    this.membersBox.visible = true;
  }

  get initialEntranceHasStarted(): boolean {
    return this.initialEntranceStarted;
  }

  /** `-[EnemyMonsterDisplay notifyLiving:healthChangedTo:delta:]` delegate. No-op for an unknown
   *  id (a stale event after death is expected, not an error). */
  notifyHp(id: string, hp: number): void {
    this.displays.get(id)?.setHp(hp);
  }

  /** `EnemyMonsterDisplay notifyActivatedAbility:onLiving:` delegate. */
  notifyActivatedAbility(id: string): Promise<void> {
    const display = this.displays.get(id);
    return display ? display.notifyActivatedAbility() : Promise.resolve();
  }

  /** Cumulative ability-activation pulse starts across live enemy displays (debug only). */
  get abilityPulseStartCount(): number {
    let total = 0;
    for (const display of this.displays.values()) total += display.abilityPulseStartCount;
    return total;
  }

  /** Pulse starts for one enemy id, or 0 if that display is gone. */
  abilityPulseStartCountOf(id: string): number {
    return this.displays.get(id)?.abilityPulseStartCount ?? 0;
  }

  /** Whether `id` currently has a live display (including a not-yet-parented promoted reserve) —
   *  battleNode's promotion diff uses this to find newly joined enemies. */
  hasMonster(id: string): boolean {
    return this.displays.has(id);
  }












  async notifyAdded(e: EnemySnapshot): Promise<void> {
    await this.notifyAddedMany([e]);
  }

  /** Native back-to-back promotions append every new member before the shared tag-1 delayed
   * reorder fires. Serial asset construction preserves notification order; one final delay then
   * parents and animates the whole pending group together. */
  async notifyAddedMany(enemies: readonly EnemySnapshot[]): Promise<void> {
    const phases = this.notifyAddedManyPhases(enemies);
    void phases.registered.catch(() => undefined); // the entrance promise below owns the failure
    await phases.entrance;
  }

  /**
   * `notifyAddedMany` split at its one port-introduced boundary.
   *
   * `-[EnemyTeamDisplay notifyTeam:addedMonster:]` builds the joiner's node SYNCHRONOUSLY (its
   * atlas is already resident) and defers only the reorder by 1.0s, so in the original the new id
   * resolves to a widget the instant the listener returns. Here construction is an async texture
   * resolve, which splits that one moment in two: `registered` resolves once every new member is
   * in the id map (what `nodeOf`/`targetNodeOf`/`monsterSpriteOf` consumers depend on), while
   * `entrance` covers the tag-1 deferred reorder — pure choreography, never a battle-clock gate.
   * Callers that must keep ids resolvable (battleNode's turn boundary) join `registered` and let
   * `entrance` run as a free-standing presentation task.
   */
  notifyAddedManyPhases(
    enemies: readonly EnemySnapshot[],
  ): { registered: Promise<void>; entrance: Promise<void> } {
    const built = this.registerAdded(enemies);
    return {
      registered: built.then(() => undefined),
      entrance: built.then((lastDisplay) => this.runDeferredReorder(lastDisplay)),
    };
  }

  /** Phase 1 — colour assignment plus serial display construction. Resolves with the LAST member
   *  built (the tag-1 reorder's generation owner), or undefined when nothing was added. */
  private async registerAdded(
    enemies: readonly EnemySnapshot[],
  ): Promise<EnemyMonsterDisplay | undefined> {
    // Assign EVERY new member's slot before the first await: TurnOrderDisplay reads
    // displayColorOf once at entry creation, and battleNode's queue refresh runs concurrently
    // with this build loop — a slot assigned only after an earlier member's texture awaits
    // could resolve as the white fallback (grey sidebar label vs. correctly-tinted field name).
    for (const e of enemies) {
      if (this.displays.has(e.id) || this.colorSlots.has(e.id)) continue;
      this.colorSlots.set(e.id, this.lowestFreeColorSlot());
    }
    let lastDisplay: EnemyMonsterDisplay | undefined;
    for (const e of enemies) {
      if (this.displays.has(e.id)) continue;
      const display = await this.buildDisplay(e, enemyNameColor(this.colorSlots.get(e.id)!));
      this.displays.set(e.id, display);
      this.pendingAdds.push(display);
      lastDisplay = display;
    }
    return lastDisplay;
  }

  /** Phase 2 — the 1.0s tag-1 delay, then the group parent + animated reorder. */
  private async runDeferredReorder(lastDisplay: EnemyMonsterDisplay | undefined): Promise<void> {
    if (!lastDisplay) return;
    const gen = ++this.reorderGen; // stopActionByTag:1 — replace any pending reorder
    await this.sleepMs(ENEMY_ADDED_REORDER_DELAY_MS);
    if (gen !== this.reorderGen || lastDisplay.destroyed) return;
    this.reorderMonsters();
  }









  async notifyDied(id: string, opts?: { captureSuccess?: boolean }): Promise<void> {
    const display = this.displays.get(id);
    if (!display) return;
    this.displays.delete(id);
    this.colorSlots.delete(id); // team-displays.md §1: displayColorMapping removeObjectForKey:
    this.pendingAdds = this.pendingAdds.filter((d) => d !== display);
    this.cancelMove(display); // a running entrance/reorder MoveTo must not fight the death anim

    const abs = this.membersBox.toGlobal(display.position);
    this.membersBox.removeBoxChild(display);
    const local = this.toLocal(abs);
    this.addChild(display);
    display.position.set(local.x, local.y);

    await display.performDeathAnimation(opts?.captureSuccess ?? false);
    // Scene teardown may have recursively destroyed the detached death widget while its action
    // was in flight. Cocos cleanup stops that action; Pixi teardown is eager, so avoid a second
    // destroy after the lifecycle-safe animation continuation retires.
    if (!display.destroyed) display.destroy({ children: true });
  }



  displayColorOf(id: string): number {
    const slot = this.colorSlots.get(id);
    return slot === undefined ? ENEMY_NAME_COLOR_FALLBACK : enemyNameColor(slot);
  }

  /** For targeting/effects — the monster's own display node. Throws for an unknown id (fail
   *  loudly rather than let a caller silently target nothing). */
  nodeOf(id: string): Container {
    const display = this.displays.get(id);
    if (!display) throw new Error(`EnemyTeamDisplay.nodeOf: unknown monster id "${id}"`);
    return display;
  }

  /** `LivingDisplay.statusEffectParent` == `monsterNode` (status-effects.md §1) — the persistent
   *  status-overlay subsystem's anchor. `null` for an unknown/removed id (stale-id no-op, mirrors
   *  `notifyHp`), not a throw: unlike `nodeOf` (targeting/effects, expected always-live), the
   *  overlay tracker can legitimately outlive its living by one presentation tick. */
  monsterSpriteOf(id: string): Sprite | null {
    return this.displays.get(id)?.monsterNode ?? null;
  }

  /** Inserts `node` as a sibling of `id`'s monster sprite, painted BEHIND it — PoisonEffect's
   *  negative-z requirement (status-effects.md §2's WARNING flag; see statusOverlay.ts's header
   *  for why this can't just be a child of `monsterNode` like the other three overlays). This
   *  widget already sorts children by `zIndex` (`sortableChildren = true`, set for the name
   *  label's z=2), so a lower `zIndex` reliably paints first regardless of insertion order. */
  attachBehindMonster(id: string, node: Container): boolean {
    const display = this.displays.get(id);
    if (!display) return false;
    node.zIndex = -1;
    display.addChild(node);
    return true;
  }

  /** `EnemyMonsterDisplay statusEffectParent` is `monsterNode`, not the 128x210 display box. */
  targetNodeOf(id: string): Container {
    const display = this.displays.get(id);
    if (!display) throw new Error(`EnemyTeamDisplay.targetNodeOf: unknown monster id "${id}"`);
    return display.monsterNode;
  }

  /** Deterministic interaction probe for `EnemyMonsterDisplay.showStars` repeatability. */
  activeStarGroupCountOf(id: string): number {
    const display = this.displays.get(id);
    if (!display) throw new Error(`EnemyTeamDisplay.activeStarGroupCountOf: unknown monster id "${id}"`);
    return display.activeStarGroupCount;
  }

  onElementTap(cb: (element: string) => void): void {
    this.elementTapCb = cb;
  }

  onAnalyzeTap(cb: (id: string) => void): void {
    this.analyzeTapCb = cb;
  }

  /** Installs/removes the exclusive live enemy-body press channel exposed to executable mod
   * coroutines. Closures on existing and promoted displays read these fields dynamically. */
  setLiveTargetPressHandlers(handlers?: {
    start: (id: string) => boolean;
    end: (id: string) => void;
  }): void {
    this.bodyPressStartCb = handlers?.start;
    this.bodyPressEndCb = handlers?.end;
  }

  /** Return true only when the caller actually mounted the source destination. This keeps a
   * deliberately deferred MonsterManagementNode route from consuming Analyze state. */
  onBenchTap(cb: (result: EnemyBenchTapResult) => boolean): void {
    this.benchTapCb = cb;
  }







  allowAnalyze(): void {
    this.analyzeEnabled = true;
    for (const display of this.displays.values()) display.setAnalyzeEnabled(true);
    if (this.benchCount !== 0) this.startBenchBlink();
  }

  elementIconGlobalCenterOf(id: string): { x: number; y: number } | null {
    const display = this.displays.get(id);
    if (!display) throw new Error(`EnemyTeamDisplay.elementIconGlobalCenterOf: unknown monster id "${id}"`);
    return display.elementIconGlobalCenter;
  }



  setBenchCount(n: number): void {
    if (!Number.isInteger(n) || n < 0) throw new Error(`EnemyTeamDisplay.setBenchCount: invalid count ${n}`);
    this.benchCount = n;
    if (this.benchLabel) this.benchLabel.text = String(n);
  }

  /** Propagates one `ProgressBar` ease tick to every live HP bar (see EnemyMonsterDisplay.update). */
  update(dtMs: number): void {
    for (const d of this.displays.values()) d.update(dtMs);
  }

  /** Deterministic probe: the bench-count badge's rendered number. */
  get benchCountShown(): number {
    return this.benchCount;
  }

  get analyzeState(): { enabled: boolean; blinking: boolean; labelVisible: boolean } {
    return {
      enabled: this.analyzeEnabled,
      blinking: this.benchBlinkRunning,
      // The blink phase (drawn or not this instant). Hit-testability is deliberately NOT gated
      // on this — see startBenchBlink.
      labelVisible: (this.benchLabel?.alpha ?? 0) > 0 && (this.benchLabel?.visible ?? false),
    };
  }

  get analyzedMonsterIds(): string[] {
    return [...this.displays].flatMap(([id, display]) => display.isAnalyzeEnabled ? [id] : []);
  }

  get benchLabelGlobalCenter(): { x: number; y: number } | null {
    if (!this.benchLabel) return null;
    const bounds = this.benchLabel.getBounds();
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  /** Deterministic probes for the entrance/reorder browser scenarios: box-local positions of the
   *  currently PARENTED member displays (a pending promoted reserve is deliberately absent —
   *  that's the 1.0s invisibility window itself). */
  get memberPositionState(): {
    id: string;
    x: number;
    y: number;
    fieldCenterX: number;
    fieldCenterY: number;
    parented: boolean;
  }[] {
    return [...this.displays.entries()].map(([id, d]) => ({
      id,
      x: d.position.x,
      y: d.position.y,
      // Authored battle-point coordinate. Unlike Pixi bounds, this stays tied to the fixed
      // EnemyMonsterDisplay slot even when its field sprite overflows hundreds of points.
      fieldCenterX: this.membersBox.position.x + d.position.x + d.monsterNode.position.x,
      fieldCenterY: this.membersBox.position.y + d.position.y + d.restingMonsterCenterY,
      parented: d.parent === this.membersBox,
    }));
  }

  /** One shared per-enemy widget builder (join and promotion paths — the original's single
   *  `initWithMonster:displayColor:` call site pair). */
  private async buildDisplay(e: EnemySnapshot, color: number): Promise<EnemyMonsterDisplay> {
    const hpAtlas = await this.assets.atlas("General-hd");
    const hpBackTexture = hpAtlas.textures["monsterHpBarBack.png"];
    const hpForeTexture = hpAtlas.textures["monsterHpBar.png"];
    if (!hpBackTexture || !hpForeTexture) {
      throw new Error("EnemyTeamDisplay: General-hd atlas is missing monsterHpBar(Back).png frames");
    }
    const monsterTexture = await this.assets.sprite(e.spriteKey);
    // e.portraitFrame is intentionally NOT consumed here — see the EnemySnapshot field doc.
    let starTexture: Texture | undefined;
    if (e.rarity !== undefined && e.rarity > 0) {
      starTexture = await this.assets.sprite("largeRarityStar-hd");
    }
    // Element badge: `Element<element>.png` (General-hd). Fail loudly on a gap — every real
    // monster has a valid element and every element has a frame in the atlas.
    let elementTexture: Texture | undefined;
    if (e.element) {
      elementTexture = hpAtlas.textures[`Element${e.element}.png`];
      if (!elementTexture) {
        throw new Error(`EnemyTeamDisplay: General-hd atlas is missing Element${e.element}.png`);
      }
    }
    const display = new EnemyMonsterDisplay({
      name: e.name,
      nameColor: color,
      monsterTexture,
      hpBackTexture,
      hpForeTexture,
      maxHp: e.maxHp,
      hp: e.hp,
      ticker: this.ticker,
      ...(e.rendererScale !== undefined ? { rendererScale: e.rendererScale } : {}),
      ...(elementTexture ? { elementTexture } : {}),
      ...(e.element ? { onElementTap: () => this.elementTapCb?.(e.element!) } : {}),
      onAnalyzeTap: () => this.analyzeTapCb?.(e.id),
      onBodyPressStart: () => this.bodyPressStartCb?.(e.id) ?? false,
      onBodyPressEnd: () => this.bodyPressEndCb?.(e.id),
      ...(starTexture && e.rarity ? { starTexture, starCount: e.rarity } : {}),
    });
    display.label = `enemyDisplay:${e.id}`;
    return display;
  }




  private lowestFreeColorSlot(): number {
    const used = new Set(this.colorSlots.values());
    for (let s = 0; s <= 2; s++) if (!used.has(s)) return s;
    console.error("Missing available color for enemy monster display");
    return 3;
  }

  /** Initial-load drop-in for one member (see initTeam). */
  private async runInitialEntrance(display: EnemyMonsterDisplay, index: number): Promise<void> {
    const rest = { x: display.position.x, y: display.position.y };

    display.position.set(Math.round(rest.x), Math.round(rest.y - enemyEntranceDropPts()));
    await this.sleepMs(enemyEntranceDelayMs(index));
    if (display.destroyed) return;
    await this.animateTo(display, rest, ENEMY_ENTRANCE_MOVE_MS, easeExponentialOut);
  }








  private reorderMonsters(): void {
    const oldPositions = new Map<EnemyMonsterDisplay, { x: number; y: number }>();
    for (const d of this.displays.values()) {
      if (d.parent === this.membersBox) oldPositions.set(d, { x: d.position.x, y: d.position.y });
    }
    const boxOld = { x: this.membersBox.position.x, y: this.membersBox.position.y };


    this.membersBox.gap = this.displays.size === 2 ? MEMBERS_BOX_GAP_TWO : 0;
    const newlyParented = [...this.pendingAdds];
    for (const pending of newlyParented) {

      this.membersBox.addBoxChild(pending, {
        contentSize: { w: ENEMY_SLOT_WIDTH, h: ENEMY_SLOT_HEIGHT },
      });
    }
    this.pendingAdds = [];
    this.membersBox.layoutChildren();
    // Cocos `onEnter` begins actions only once `setChildEnumeration:` parents the new display.
    // In particular, the 2.5s rarity-star and 6s element-dim delays must not consume the 1.0s
    // interval where `addedMonster:` deliberately keeps a promoted reserve unparented.
    for (const display of newlyParented) display.startInitialActions();
    const boxNew = this.computeMembersBoxPosition();

    for (const d of this.displays.values()) {
      if (d.parent !== this.membersBox) continue;
      const rest = { x: d.position.x, y: d.position.y };
      const old = oldPositions.get(d);
      if (old) {
        d.position.set(old.x, old.y);
      } else {


        const start = reorderEntranceStart(rest, boxNew.x, boxOld.x);
        d.position.set(start.x, start.y);
      }
      void this.animateTo(d, rest, ENEMY_REORDER_MOVE_MS, easeExponentialInOut);
    }




    void this.animateTo(this.membersBox, boxNew, ENEMY_REORDER_MOVE_MS, easeExponentialInOut);
  }












  private computeMembersBoxPosition(): { x: number; y: number } {
    const x = membersBoxXCocos(this.membersBox.boxContentSize.w);
    const y = SCREEN_H - (membersBoxYCocos() + ENEMY_SLOT_HEIGHT / 2);
    return { x: Math.round(x), y: Math.round(y) };
  }

  private applyMembersBoxPosition(): void {
    const pos = this.computeMembersBoxPosition();
    this.membersBox.position.set(pos.x, pos.y);
  }

  private sleepMs(ms: number): Promise<void> {
    return ms <= 0 ? Promise.resolve() : tween(this.ticker, ms, () => {});
  }

  /** One canonical position tween per node; starting a new one (or cancelMove) supersedes any
   *  running one so late frames of a superseded move can't fight the current animation. */
  private async animateTo(
    node: Container,
    to: { x: number; y: number },
    ms: number,
    ease: (t: number) => number,
  ): Promise<void> {
    const gen = (this.moveGen.get(node) ?? 0) + 1;
    this.moveGen.set(node, gen);
    const from = { x: node.position.x, y: node.position.y };
    await tween(
      this.ticker,
      ms,
      (t) => {
        if (node.destroyed || this.moveGen.get(node) !== gen) return;
        node.position.set(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
      },
      ease,
    );
  }

  private cancelMove(node: Container): void {
    this.moveGen.set(node, (this.moveGen.get(node) ?? 0) + 1);
  }

  /** `benchBox.png`, Cocos anchor (1,1), inset `BENCH_BOX_INSET` from EnemyTeamDisplay's own
   *  content box's top-right corner (team-displays.md §1 bench-badge row / followup-layout.md §3.1)
   *  — this class's content box is taken to be the full 480x320 screen area it's mounted over.
   *  `benchCountLabel` centered on it (`benchBox.contentSize*0.5`, resolved to (0.5,0.5) by
   *  followup-layout.md §3.1). Built lazily (needs an async asset load) and reused across
   *  `initTeam` rebuilds.
   *
   *  FINAL-REVIEW FIX (Cocos-Y-up → Pixi-Y-down anchor flip): Cocos anchor (1,1) is the sprite's
   *  TOP-right corner under Y-up; under this class's Y-down/top-left frame that corner carries Pixi
   *  anchor (1,0) (the ay → 1−ay flip used throughout this UI). A prior revision left the Pixi
   *  anchor at (1,1), which hung the badge UPWARD off the top of the screen so only a ~5pt sliver
   *  showed (confirmed in port-shots). Anchor (1,0) at y=`BENCH_BOX_INSET` makes it hang DOWNWARD,
   *  fully visible top-right; the centered inner label's y offset flips with it (−h/2 → +h/2). */
  private async ensureBenchBadge(): Promise<void> {
    if (this.benchBadge) return;
    const texture = await this.assets.sprite("benchBox-hd");
    const badge = pointSprite(texture);
    badge.anchor.set(1, 0);
    badge.position.set(SCREEN_W - BENCH_BOX_INSET, BENCH_BOX_INSET);








    const label = makeTtfLabel("0", 16, {
      fill: 0xffffff,
      outline: true,
      outlineAlpha: OUTLINE_FADE_ALPHA,
    });
    label.anchor.set(0.5, 0.5);
    label.position.set(SCREEN_W - BENCH_BOX_INSET - badge.width / 2, BENCH_BOX_INSET + badge.height / 2);
    label.eventMode = "static";
    label.cursor = "pointer";
    label.on("pointertap", () => this.handleBenchTap());
    this.addChild(badge);
    this.addChild(label);
    this.benchBadge = badge;
    this.benchLabel = label;
  }







  private handleBenchTap(): void {
    if (!this.analyzeEnabled) {
      this.benchTapCb?.("analyzeNotReady");
      return;
    }
    if (this.benchCount === 0) {
      this.benchTapCb?.("noMonstersToAnalyze");
      return;
    }
    // Already analyzed field monsters keep their individual flags, while promoted reserve
    // displays are constructed with the default false flag.
    if (this.benchTapCb?.("showReserves") === true) this.analyzeEnabled = false;
  }









  private startBenchBlink(): void {
    if (this.benchBlinkRunning) return;
    this.benchBlinkRunning = true;
    const gen = ++this.benchBlinkGen;
    void (async () => {
      while (this.benchBlinkGen === gen && !this.destroyed) {
        if (this.benchLabel) this.benchLabel.alpha = 0;
        await this.sleepMs(250);
        if (this.benchBlinkGen !== gen || this.destroyed) return;
        if (this.benchLabel) this.benchLabel.alpha = 1;
        await this.sleepMs(250);
      }
    })();
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.benchBlinkGen += 1;
    this.benchBlinkRunning = false;
    super.destroy(options);
  }
}
