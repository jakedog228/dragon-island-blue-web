


import { Container, type FederatedPointerEvent, type Sprite, type Text, type Texture, type Ticker } from "pixi.js";
import { nearestMinimumHit, pointSprite, makeTtfLabel, ProgressBar, hpTint, CONTENT_SCALE_FACTOR, type AssetLibrary } from "@dib/renderer";
import { easeExponentialIn, easeExponentialOut } from "../tween.js";
import {
  CallFunc,
  DelayTime,
  Ease,
  MoveTo,
  RotateTo,
  ScaleTo,
  TickerActionRunner,
  sequence,
  spawn,
} from "./cocosActionRunner.js";
import {
  portraitFrameKey,
  formatTimeDelay,
  turnOrderLayout,
  turnOrderEntryChildLayout,
  TURN_ORDER_BAR_SCALE,
  TURN_ORDER_LABEL_SIZE,
  TURN_ORDER_FLIP_MS,
  TURN_ORDER_SLIDE_MS,
  TURN_ORDER_RESTORE_MS,
  TURN_ORDER_WARP_MS,
  TURN_ORDER_CAPTURE_REMOVAL_DELAY_MS,
  TURN_ORDER_DEATH_REMOVAL_DELAY_MS,
  TURN_ORDER_REMOVAL_FALL_MS,
  TURN_ORDER_REMOVAL_TARGET,
  TURN_ORDER_REMOVAL_ROTATION_DEG,
  turnOrderMembershipChanges,
  turnOrderLabelFill,
} from "./displayShared.js";

/** Per-monster data the column needs on every `refresh()`. Minimal, local snapshot type (mirrors
 *  `EnemySnapshot`/`FriendlySnapshot`'s own convention) — Task 15 builds this from
 *  `BattleSession`/`GameData`/`EnemyTeamDisplay.displayColorOf`. */
export interface TurnOrderMonsterInfo {
  name: string;
  /** MonsterPortraits-hd atlas frame override, e.g. "Minotaur_icon.png"; defaults to
   *  `portraitFrameKey(name)` when omitted. */
  portraitFrame?: string;
  hp: number;
  maxHp: number;
  team: 0 | 1;
  /** `EnemyTeamDisplay.displayColorOf(id)` — only consulted for `team !== 0` (turn-order-input.md
   *  §1: "player-team entries get no tint"). */
  colorTint?: number;
}

/** Decoupled provider (Task 1's `session.queueOrder()`/`timeDelayOf()` + Task 9's per-monster
 *  lookups, wired by Task 15) — keeps this class importing neither `@dib/engine` nor
 *  `EnemyTeamDisplay` directly, matching every sibling battle-widget file's own snapshot
 *  convention. */
export interface TurnOrderProvider {
  /** `[Battle sharedInstance] queOrder` (turn-order-input.md §1) — living actor ids, soonest
   *  first. The column's ONLY sort: entries are laid out in exactly this array's order. */
  order(): string[];
  /** `[Battle timeDelayForLiving:]` (turn-order-input.md §1) — time-units until `id` acts. */
  delayOf(id: string): number;
  infoOf(id: string): TurnOrderMonsterInfo;
}

export interface TurnOrderDisplayOpts {
  assets: AssetLibrary;
  ticker: Ticker;
  provider: TurnOrderProvider;
}

interface TurnOrderEntry {
  root: Container;
  icon: Sprite;
  label: Text;
  bar: ProgressBar;
  team: 0 | 1;


  labelFill: number;
}

export interface TurnOrderRefreshOpts {
  /** Captured ids use the source's 2s hold before falling; every other removal starts at once. */
  captureSuccessIds?: readonly string[];
}

export interface TurnOrderAddOpts {
  /** `queOrder` as the source's own `notifyTeam:addedMonster:` listener would have read it: after
   *  this turn's removals and the joiner's `timeAtFront + initialBattleDelay` insertion, but
   *  BEFORE `advanceQueWithCounter:` recharges the acting living. Omit it for additions that
   *  happen outside a resolved turn (the spirit summon), where the provider already IS that
   *  queue. */
  projectedOrder?: readonly string[];
}

export interface TurnOrderHitCandidate {
  id: string;
  team: 0 | 1;
  x: number;
  y: number;
}


export function nearestTurnOrderHit(
  candidates: readonly TurnOrderHitCandidate[],
  point: Readonly<{ x: number; y: number }>,
): { id: string; team: 0 | 1 } | undefined {
  return nearestMinimumHit(
    candidates.map((candidate) => ({
      value: { id: candidate.id, team: candidate.team },
      contentRect: { x: candidate.x, y: candidate.y, w: 0, h: 0 },
      ownScale: { x: 1, y: 1 },
    })),
    point,
  );
}

export class TurnOrderDisplay extends Container {
  private readonly assets: AssetLibrary;
  private readonly provider: TurnOrderProvider;
  private readonly entries = new Map<string, TurnOrderEntry>();
  /** Mirrors the ORIGINAL's `self->nodeOrder` (ivar +248) — the column's OWN idea of the current
   *  order. `updateOrder` compares `nodeOrder[0]` against the live `queOrder[0]` to decide whether
   *  a front peel is due, and `warpNodesExcludingObject:` REPLACES this array at callback time
   *  from the queue it reads then (turn-order-input.md §1). It is deliberately NOT assigned when
   *  a front-change sequence is dispatched: committing it at dispatch is what let this port's
   *  logical order — and the tap arbitration reading it — run ahead of the sprites. */
  private nodeOrder: string[] = [];


  private blockUpdate = true;


  private projectionEpoch = 0;
  private terminalFrozen = false;
  private readonly fallingEntries = new Map<string, TurnOrderEntry>();
  /** Per-id token invalidated by every removal, so an atlas load that resolves after its subject
   *  left the queue is discarded instead of parenting a ghost. */
  private readonly entryGenerations = new Map<string, number>();
  private nextGeneration = 1;
  private readonly loadingEntries = new Set<string>();
  private hpBackTexture: Texture | undefined;
  private hpForeTexture: Texture | undefined;
  private tapCallback: ((id: string) => void) | undefined;
  private initialized = false;
  private activeFrontSequences = 0;
  private activeWarpMoves = 0;
  /** Everything currently outstanding — actions AND async entry loads. Teardown and deterministic
   *  tests read this; it is NEVER consulted before admitting new work (see `whenSettled`). */
  private readonly pending = new Set<Promise<void>>();
  /** Divergence counters for the browser traces. `membershipSafetyNet` should stay at zero: the
   *  source only ever adds/removes nodes from its team listeners, so a nonzero count means
   *  BattleNode failed to emit a roster event and this class covered for it. */
  readonly counters = {
    battleTimeNotifications: 0,
    frontSequencesAdmitted: 0,
    liveCallbacks: 0,
    membershipSafetyNet: 0,
  };
  /** Every Cocos-style action in this widget belongs to the battle scene. A removed entry can
   * still be inside its three-second fall when world navigation destroys that scene, so leaving
   * these ticker listeners alive writes through Pixi's destroyed (null) transform on the next
   * frame. */
  private readonly actions = new AbortController();
  /** `CCActionManager` on the app ticker: multiple actions per node, insertion-ordered stepping,
   *  and per-phase transform capture — the three properties an `await`-chained tween cannot supply
   *  once notifications are admitted concurrently (cocosActionRunner.ts). */
  private readonly runner: TickerActionRunner;

  constructor(opts: TurnOrderDisplayOpts) {
    super();
    this.assets = opts.assets;
    this.provider = opts.provider;
    this.runner = new TickerActionRunner(opts.ticker, this.actions.signal);


    this.eventMode = "static";
    this.hitArea = { contains: (x, y) => this.nearestEntryAt({ x, y }) !== undefined };
    this.on("pointertap", this.handlePointerTap);
  }

  private readonly handlePointerTap = (event: FederatedPointerEvent): void => {
    const entry = this.nearestEntryAt(event.getLocalPosition(this));
    if (!entry) return;
    event.stopPropagation();
    if (entry.team === 0) this.tapCallback?.(entry.id);
  };

  private nearestEntryAt(point: Readonly<{ x: number; y: number }>): { id: string; team: 0 | 1 } | undefined {
    return nearestTurnOrderHit(
      this.nodeOrder.flatMap((id) => {
        const entry = this.entries.get(id);
        return entry ? [{ id, team: entry.team, x: entry.root.x, y: entry.root.y }] : [];
      }),
      point,
    );
  }


  onOwnTap(cb: (id: string) => void): void {
    this.tapCallback = cb;
  }

  override destroy(options?: Parameters<Container["destroy"]>[0]): void {
    this.actions.abort();
    this.nodeOrder = [];
    this.entries.clear();
    this.fallingEntries.clear();
    this.entryGenerations.clear();
    this.loadingEntries.clear();
    this.pending.clear();
    super.destroy(options);
  }

  /** Propagates one `ProgressBar` ease tick to every live HP bar (mirrors
   *  `EnemyTeamDisplay.update`/`FriendlyTeamDisplay.update`). Positional/scale animation is NOT
   *  driven from here — that belongs to this widget's `CCActionManager` analogue, which owns its
   *  own ticker slot exactly as Cocos schedules the real one. */
  update(dtMs: number): void {
    for (const entry of this.entries.values()) entry.bar.update(dtMs);
    for (const entry of this.fallingEntries.values()) entry.bar.update(dtMs);
  }


  async initialize(): Promise<void> {
    if (this.initialized || this.destroyed || this.actions.signal.aborted) return;
    await this.ensureHpTextures();
    if (this.destroyed || this.actions.signal.aborted) return;
    const order = this.provider.order();
    for (const id of order) {
      await this.createEntry(id, this.provider.infoOf(id), this.provider.delayOf(id));
      if (this.destroyed || this.actions.signal.aborted) return;
    }
    this.nodeOrder = order.filter((id) => this.entries.has(id));
    this.initialized = true;
    this.blockUpdate = false;
    // nodeOrder[0] now matches queOrder[0], so this takes `updateOrder`'s same-front arm straight
    // into `warpNodesExcludingObject:nil` — the 0.5s slide-in from the origin.
    await this.updateOrder(EMPTY_CAPTURES);
  }


  notifyBattleTimePassed(opts: TurnOrderRefreshOpts = {}): Promise<void> {
    this.counters.battleTimeNotifications += 1;
    return this.updateOrder(new Set(opts.captureSuccessIds ?? []));
  }


  async notifyTeamAddedMonsters(ids: readonly string[], opts: TurnOrderAddOpts = {}): Promise<void> {
    if (this.destroyed || this.actions.signal.aborted || this.terminalFrozen) return;
    // `addNodeForMonster:` is synchronous in the source and completes BEFORE `updateOrder` runs,
    // so this path waits for the portraits rather than letting the layout pass race them.
    const additions = ids.filter((id) => !this.entries.has(id) && !this.loadingEntries.has(id));
    await Promise.all(additions.map((id) => this.track(this.loadEntry(id).then(() => undefined))));
    if (this.destroyed || this.actions.signal.aborted || this.terminalFrozen) return;
    void this.updateOrder(EMPTY_CAPTURES, opts.projectedOrder);
  }


  notifyTeamRemovedMonsters(ids: readonly string[], opts: TurnOrderRefreshOpts = {}): Promise<void> {
    return this.removeAndCompact(ids, opts, false);
  }

  /**
   * The terminal variant of that same source point. `moveToEndStateIfBattleOver` suppresses the
   * following battle-time notification, so the column must FREEZE here: the epoch bump retires
   * every already-admitted live callback's structural write, and `terminalFrozen` rejects any
   * later notification outright.
   */
  freezeTerminalRemoval(ids: readonly string[], opts: TurnOrderRefreshOpts = {}): Promise<void> {
    return this.removeAndCompact(ids, opts, true);
  }


  syncLivingHp(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.applyHealth(entry, this.provider.infoOf(id));
  }

  /**
   * Aggregate over currently outstanding actions and entry loads, for teardown and deterministic
   * tests ONLY. It must never be awaited before admitting a notification — that would rebuild the
   * global FIFO this class exists to remove.
   */
  async whenSettled(): Promise<void> {
    // Settling one action can admit its successor (a front sequence's callback starts the warps),
    // so drain until the outstanding set stops refilling.
    for (let guard = 0; guard < 64 && this.pending.size > 0; guard++) {
      await Promise.all([...this.pending]);
    }
  }

  /** Deterministic presentation state for browser choreography: the column's logical `nodeOrder`,
   *  which under the source model catches up in the live callback rather than at dispatch. */
  get displayedOrder(): readonly string[] {
    return this.nodeOrder;
  }

  get isAnimatingFrontChange(): boolean {
    return this.activeFrontSequences > 0 || this.activeWarpMoves > 0;
  }

  get liveEntryState(): Array<{
    id: string;
    x: number;
    y: number;
    scaleX: number;
    team: 0 | 1;
    labelFill: number;
    delayText: string;
    /** Committed HP target for this bar. Owned solely by `syncLivingHp`; a queue callback that
     *  moved it would be replaying a health event the source routes through its own listener. */
    hpRatio: number;
    entryOriginGlobal: { x: number; y: number };
    iconGlobalCenter: { x: number; y: number };
  }> {
    return [...this.entries].map(([id, entry]) => {
      // Canvas-global icon center (getBounds carries the full world transform) — the browser
      // scenarios' stable tap target for the own-team info popup (onOwnTap), reachable in every
      // presentation state unlike the friendly row (hidden while the turn panel is up).
      const iconBounds = entry.icon.getBounds();
      const entryOriginGlobal = this.toGlobal({ x: entry.root.x, y: entry.root.y });
      return {
        id,
        x: entry.root.x,
        y: entry.root.y,
        scaleX: entry.root.scale.x,
        team: entry.team,
        labelFill: entry.labelFill,
        delayText: entry.label.text,
        hpRatio: entry.bar.ratio,
        entryOriginGlobal,
        iconGlobalCenter: {
          x: iconBounds.x + iconBounds.width / 2,
          y: iconBounds.y + iconBounds.height / 2,
        },
      };
    });
  }

  get fallingEntryState(): Array<{ id: string; x: number; y: number; rotationDeg: number }> {
    return [...this.fallingEntries].map(([id, entry]) => ({
      id,
      x: entry.root.x,
      y: entry.root.y,
      rotationDeg: (entry.root.rotation * 180) / Math.PI,
    }));
  }


  private updateOrder(captures: ReadonlySet<string>, sample?: readonly string[]): Promise<void> {
    if (this.destroyed || this.actions.signal.aborted) return Promise.resolve();
    if (this.blockUpdate || this.terminalFrozen) return Promise.resolve();
    const dispatchOrder = sample ?? this.provider.order();
    // `updateOrder` is a no-op on an empty queOrder (turn-order-input.md §1).
    if (dispatchOrder.length === 0) return Promise.resolve();
    // The same-front arm's `warpNodesExcludingObject:nil`, against whichever queue this dispatch
    // is entitled to read.
    const warpSameFront = (): Promise<void> =>
      sample === undefined ? this.warpLive(this.projectionEpoch, captures) : this.warpProjected(sample);

    const displayedFront = this.nodeOrder[0];
    const frontChanged = displayedFront !== undefined && displayedFront !== dispatchOrder[0];
    if (!frontChanged) return warpSameFront();

    const entry = this.entries.get(displayedFront);
    const targetSlot = turnOrderLayout(dispatchOrder).find((slot) => slot.id === displayedFront);
    if (!entry || !targetSlot) {


      return warpSameFront();
    }

    // `CCSequence(CCScaleTo(0.5s, -1, 1), CCMoveTo(0.5s, dest), CCSpawn(CCScaleTo(0.5s, 1, 1),
    //  CCCallFuncO(self, warpNodesExcludingObject:, oldFront)))` sent through `runAction:`
    // (turn-order-input.md §1). `runAction:` appends to the node's action array — it neither waits
    // for nor cancels an earlier sequence, so a second acknowledgment inside the 1.5s admits a
    // second sequence whose `CCScaleTo` captures whatever scale the first one has reached.
    const epoch = this.projectionEpoch;
    const action = sequence([
      new ScaleTo(TURN_ORDER_FLIP_MS, -1, 1),
      new MoveTo(TURN_ORDER_SLIDE_MS, targetSlot.x, targetSlot.y),
      spawn([
        new ScaleTo(TURN_ORDER_RESTORE_MS, 1, 1),
        new CallFunc(() => void this.warpLive(epoch, captures, displayedFront)),
      ]),
    ]);
    this.counters.frontSequencesAdmitted += 1;
    this.activeFrontSequences += 1;
    const handle = this.runner.runAction(entry.root, action);
    return this.track(handle.finished.finally(() => {
      this.activeFrontSequences -= 1;
    }));
  }


  private warpLive(epoch: number, captures: ReadonlySet<string>, excludeId?: string): Promise<void> {
    if (this.destroyed || this.actions.signal.aborted) return Promise.resolve();
    // A callback admitted before a terminal removal may still complete its own transform restore,
    // but it must not write structure or labels across that boundary.
    if (epoch !== this.projectionEpoch) return Promise.resolve();

    this.counters.liveCallbacks += 1;
    // One coherent projection, read synchronously before anything can await: reading the order,
    // yielding, then reading the delays would assemble the column out of two different moments.
    const order = this.provider.order();
    const infos = new Map(order.map((id) => [id, this.provider.infoOf(id)] as const));
    const delays = new Map(order.map((id) => [id, this.provider.delayOf(id)] as const));

    this.reconcileMembership(order, infos, captures);

    // `nodeOrder` is REPLACED here — the source's only commit point for the column's logical
    // order, and therefore also for the tap arbitration that reads it.
    this.nodeOrder = order.filter((id) => this.entries.has(id));

    for (const id of this.nodeOrder) {
      const entry = this.entries.get(id)!;
      entry.label.text = formatTimeDelay(delays.get(id) ?? 0);
      this.applyLabelFill(entry, infos.get(id)!);
    }

    // Slots come from the QUEUE index, not from the matched subset: a queued living whose node is
    // still loading leaves its slot empty rather than shifting everyone below it up.
    return this.startWarpMoves(order, excludeId);
  }


  private warpProjected(order: readonly string[]): Promise<void> {
    this.nodeOrder = order.filter((id) => this.entries.has(id));
    return this.startWarpMoves(order);
  }

  /**
   * PORT SAFETY NET, not source behavior. The source adds and removes nodes exclusively from
   * `notifyTeam:addedMonster:`/`removedMonster:`/`replacedSummon:`, so this should find nothing to
   * do; `counters.membershipSafetyNet` exposes it if BattleNode ever misses a roster event.
   * Removals reuse the same fall the team listener starts, which is what this port shipped before
   * the event split — the fallback behaves exactly as it always did rather than inventing anything.
   */
  private reconcileMembership(
    order: readonly string[],
    infos: ReadonlyMap<string, TurnOrderMonsterInfo>,
    captures: ReadonlySet<string>,
  ): void {
    const { removed } = turnOrderMembershipChanges([...this.entries.keys()], order);
    if (removed.length > 0) {
      this.counters.membershipSafetyNet += removed.length;
      this.detachEntries(new Set(removed), captures);
    }
    for (const id of order) {
      if (this.entries.has(id) || this.loadingEntries.has(id)) continue;
      this.counters.membershipSafetyNet += 1;
      this.startEntryLoad(id, infos.get(id));
    }
  }

  /** `warpNodesExcludingObject:`'s per-node linear `CCMoveTo(0.5s)` to the slot its queue index
   *  gives it, skipping the actor that is still mirrored at its own destination. */
  private startWarpMoves(order: readonly string[], excludeId?: string): Promise<void> {
    const moves: Promise<void>[] = [];
    for (const slot of turnOrderLayout(order)) {
      if (slot.id === excludeId) continue;
      const entry = this.entries.get(slot.id);
      if (!entry) continue;
      // A zero-delta `CCMoveTo` writes its captured start every frame, so skipping it is
      // observationally identical: any concurrent action on the same node was admitted later and
      // therefore already wins the frame's final write.
      if (entry.root.x === slot.x && entry.root.y === slot.y) continue;
      this.activeWarpMoves += 1;
      const handle = this.runner.runAction(entry.root, new MoveTo(TURN_ORDER_WARP_MS, slot.x, slot.y));
      moves.push(handle.finished.finally(() => {
        this.activeWarpMoves -= 1;
      }));
    }
    if (moves.length === 0) return Promise.resolve();
    return this.track(Promise.all(moves).then(() => undefined));
  }

  // ---------------------------------------------------------------------------------------------
  // Membership
  // ---------------------------------------------------------------------------------------------

  private removeAndCompact(
    ids: readonly string[],
    opts: TurnOrderRefreshOpts,
    terminal: boolean,
  ): Promise<void> {
    if (this.destroyed || this.actions.signal.aborted) return Promise.resolve();
    if (terminal) {
      // Retire in-flight live callbacks BEFORE anything else touches the column.
      this.projectionEpoch += 1;
      this.terminalFrozen = true;
    }
    if (ids.length === 0) return Promise.resolve();
    const removed = new Set(ids);
    this.detachEntries(removed, new Set(opts.captureSuccessIds ?? []));
    // At this source point `queOrder` differs from the displayed order only by the removals: the
    // acting living has not yet paid TU or advanced battle time. Compact survivors around the gap
    // from the column's OWN order, without querying this port's already-advanced engine queue.
    this.nodeOrder = this.nodeOrder.filter((id) => !removed.has(id));
    return this.startWarpMoves(this.nodeOrder);
  }

  private detachEntries(ids: ReadonlySet<string>, captureSuccessIds: ReadonlySet<string>): void {
    for (const id of ids) {
      const entry = this.entries.get(id);
      // Invalidate even when no entry exists yet: a load still in flight for this id must not
      // parent itself after the removal that retired it.
      this.entryGenerations.delete(id);
      if (!entry) continue;
      this.entries.delete(id);
      entry.root.eventMode = "none";
      this.fallingEntries.set(id, entry);
      this.startRemovalFall(id, entry, captureSuccessIds.has(id));
    }
  }


  private startRemovalFall(id: string, entry: TurnOrderEntry, captureSuccess: boolean): void {
    const delayMs = captureSuccess ? TURN_ORDER_CAPTURE_REMOVAL_DELAY_MS : TURN_ORDER_DEATH_REMOVAL_DELAY_MS;
    const action = sequence([
      new DelayTime(delayMs),
      spawn([
        new Ease(
          new MoveTo(TURN_ORDER_REMOVAL_FALL_MS, TURN_ORDER_REMOVAL_TARGET.x, TURN_ORDER_REMOVAL_TARGET.y),
          easeExponentialIn,
        ),
        new Ease(
          new RotateTo(TURN_ORDER_REMOVAL_FALL_MS, (TURN_ORDER_REMOVAL_ROTATION_DEG * Math.PI) / 180),
          easeExponentialOut,
        ),
      ]),
      new CallFunc(() => {
        this.fallingEntries.delete(id);
        if (!entry.root.destroyed) entry.root.destroy({ children: true });
      }),
    ]);
    void this.track(this.runner.runAction(entry.root, action).finished);
  }

  /** Generation-guarded async creation. The source's `addNodeForMonster:` is synchronous, so this
   *  is the one place the port must invent a rule: a load whose id was removed while the atlas was
   *  in flight is discarded, and a load that completes after the callback that asked for it is
   *  positioned by the NEXT layout pass rather than by the stale request that started it. */
  private async loadEntry(id: string, info?: TurnOrderMonsterInfo): Promise<number | undefined> {
    if (this.loadingEntries.has(id)) return undefined;
    const generation = this.nextGeneration++;
    this.entryGenerations.set(id, generation);
    this.loadingEntries.add(id);
    const resolved = info ?? this.provider.infoOf(id);
    const delay = this.provider.delayOf(id);
    try {
      await this.createEntry(id, resolved, delay, generation);
    } catch (err) {
      // Mirrors BattleNode's presentation-task policy: a missing atlas frame must surface, but it
      // must not reject into a promise nothing is positioned to catch.
      console.error(`TurnOrderDisplay: failed to build turn-order entry "${id}"`, err);
    } finally {
      this.loadingEntries.delete(id);
    }
    return generation;
  }

  /** The safety net's fire-and-forget variant: it cannot await, so it runs the layout pass that
   *  `notifyTeam:addedMonster:` would have run once its own node finally exists. */
  private startEntryLoad(id: string, info?: TurnOrderMonsterInfo): void {
    if (this.loadingEntries.has(id)) return;
    const epoch = this.projectionEpoch;
    void this.track((async () => {
      const generation = await this.loadEntry(id, info);
      if (this.destroyed || this.actions.signal.aborted) return;
      if (epoch !== this.projectionEpoch) return;
      if (generation === undefined || this.entryGenerations.get(id) !== generation) return;
      await this.updateOrder(EMPTY_CAPTURES);
    })());
  }

  private async ensureHpTextures(): Promise<void> {
    if (this.hpBackTexture && this.hpForeTexture) return;
    const atlas = await this.assets.atlas("General-hd");
    if (this.destroyed || this.actions.signal.aborted) return;
    const back = atlas.textures["monsterHpBarBack.png"];
    const fore = atlas.textures["monsterHpBar.png"];
    if (!back || !fore) {
      throw new Error("TurnOrderDisplay: General-hd atlas is missing monsterHpBar(Back).png frames");
    }
    this.hpBackTexture = back;
    this.hpForeTexture = fore;
  }


  private async createEntry(
    id: string,
    info: TurnOrderMonsterInfo,
    delay: number,
    generation?: number,
  ): Promise<void> {
    await this.ensureHpTextures();
    if (this.destroyed || this.actions.signal.aborted) return;
    const atlas = await this.assets.atlas("MonsterPortraits-hd");
    if (this.destroyed || this.actions.signal.aborted) return;

    if (generation !== undefined && this.entryGenerations.get(id) !== generation) return;
    if (this.entries.has(id)) return;
    const frameKey = info.portraitFrame ?? portraitFrameKey(info.name);
    const texture = atlas.textures[frameKey];
    if (!texture) throw new Error(`TurnOrderDisplay: MonsterPortraits-hd atlas is missing frame "${frameKey}"`);

    const root = new Container();
    // `addNodeForMonster:` leaves a fresh CCNode at its default origin; the following
    // `updateOrder`/`warpNodesExcludingObject:` supplies the same 0.5s entry motion as every
    // existing node. Initial population follows this path too.
    root.position.set(0, 0);

    // HP mini-bar textures are needed before layout: the bar's cited Cocos (0,-3) anchor-(0,0)
    // position folds its own 0.5x-scaled height into the entry-local bar TOP (see
    // turnOrderEntryChildLayout). backHeight is the container-driving background frame's point
    // height — the same value ProgressBar's own background sprite measures.
    const barBackHeightPt = this.hpBackTexture!.height / CONTENT_SCALE_FACTOR;
    const scaledBarH = barBackHeightPt * TURN_ORDER_BAR_SCALE;


    const icon = pointSprite(texture);
    const childLayout = turnOrderEntryChildLayout(icon.height, scaledBarH);
    icon.position.set(0, childLayout.iconY);
    root.addChild(icon);


    const fill = turnOrderLabelFill(info.team, info.colorTint);


    const label = makeTtfLabel(formatTimeDelay(delay), TURN_ORDER_LABEL_SIZE, {
      fill,
      outline: true,
    });
    label.anchor.set(0, 0.5);
    // Cocos y = scaledH*0.5 above the entry origin = the icon's vertical center (icon spans
    // 0..+h up); Y-down local: -icon.height/2 (turnOrderEntryChildLayout).
    label.position.set(icon.width, childLayout.labelCenterY);
    root.addChild(label);


    const bar = new ProgressBar({
      backgroundTexture: this.hpBackTexture!,
      foregroundTexture: this.hpForeTexture!,
      labelFontFile: null,
      max: info.maxHp,
    });
    bar.scale.set(TURN_ORDER_BAR_SCALE);
    bar.position.set(0, childLayout.barY);
    root.addChild(bar);

    // `ccTouchEnded:` (turn-order-input.md §1): after column-level nearest-node arbitration, an
    // own-team portrait opens LivingInfoDisplay; the enemy branch is inert.
    // Selection is owned by the TurnOrderDisplay-level delegate above. Keep every child passive
    // so overlapping source rectangles cannot be resolved by Pixi's reverse paint order.
    root.eventMode = "none";

    const entry: TurnOrderEntry = { root, icon, label, bar, team: info.team, labelFill: fill };
    this.entries.set(id, entry);
    if (generation === undefined) this.entryGenerations.set(id, this.nextGeneration++);
    this.addChild(root);
    // The construction-time `notifyLiving:healthChangedTo:delta:` seed (turn-order-input.md §1).
    this.applyHealth(entry, info);
  }


  private applyLabelFill(entry: TurnOrderEntry, info: TurnOrderMonsterInfo): void {
    const fill = turnOrderLabelFill(entry.team, info.colorTint);
    if (fill === entry.labelFill) return;
    entry.labelFill = fill;
    entry.label.style.fill = fill;
  }

  private applyHealth(entry: TurnOrderEntry, info: TurnOrderMonsterInfo): void {
    entry.bar.setMax(info.maxHp);
    entry.bar.setRatio(info.maxHp > 0 ? Math.max(0, info.hp / info.maxHp) : 0);
    entry.bar.setTint(hpTint(info.hp, info.maxHp));
  }

  private track(work: Promise<void>): Promise<void> {
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work));
    return work;
  }
}

const EMPTY_CAPTURES: ReadonlySet<string> = new Set<string>();
