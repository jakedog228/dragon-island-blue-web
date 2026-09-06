// An intentional Offline rules conversion. Costs, AI, damage, death, replacement and RNG
// remain BattleSession transactions; only the queue's notion of elapsed time is replaced.
class RealtimeCombatClock {
  constructor(session) {
    if (session.started) throw new Error("Realtime Combat requires a fresh battle session");
    this.session = session;
    this.core = session.core;
    this.queue = this.core.queue;
    this.time = 0;
    this.remainderMs = 0;
    this.ready = new Map();
    this.steps = new Map();
    this.selected = undefined;
    this.disposers = [];
    const patch = (object, key, value) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      object[key] = value;
      this.disposers.push(() => {
        if (descriptor) Object.defineProperty(object, key, descriptor);
        else delete object[key];
      });
    };
    const front = this.queue.front.bind(this.queue);
    patch(this.queue, "front", () => this.selected ?? front());
    patch(this.queue, "timeAtFront", () => this.time);
    // Turn completion and initial seeding must NEVER jump the wall clock to another actor.
    patch(this.queue, "advanceTimeToNext", () => 0);
    patch(this.queue, "addTime", (id, delta) => {
      this.queue.setTime(id, Math.max(this.time, this.queue.timeForItem(id)) + delta);
    });
    patch(this.queue, "moveToFront", (id) => {
      if (!this.queue.has(id)) throw new Error("Realtime Combat: unqueued move-to-front target");
      this.queue.setTime(id, this.time);
    });
    patch(session, "timeDelayOf", (id) => Math.max(0, this.queue.timeForItem(id) - this.time));
    const finishScript = session.finishScriptedPlayerAction.bind(session);
    patch(session, "finishScriptedPlayerAction", () => {
      const id = session.pendingScripted?.actorId;
      const events = finishScript();
      if (!this.ended && id !== undefined && this.queue.has(id) && session.timeDelayOf(id) === 0) {
        this.queue.setTime(id, this.time + 1);
      }
      this.refresh(events);
      this.onEvents?.(events);
      return events;
    });
    const performScript = session.performScriptedPlayerAbility.bind(session);
    patch(session, "performScriptedPlayerAbility", (step) => {
      if (this.ended) return { events: [] };
      // Another actor can remove an aimed-at target between scripted steps.
      const enemyPool = new Set(this.core.aiWorld.enemyPoolOf(session.pendingScripted.actorId));
      const friendlyPool = new Set(this.core.aiWorld.friendlyPoolOf(session.pendingScripted.actorId));
      const result = performScript({ ...step,
        enemyTargets: step.enemyTargets.filter((id) => enemyPool.has(id)),
        friendlyTargets: step.friendlyTargets.filter((id) => friendlyPool.has(id)),
      });
      this.refresh(result.events);
      this.onEvents?.(result.events);
      return result;
    });
    session.started = true;
    this.core.seedAndStart();
    this.refresh();
  }

  get ended() { return this.core.winner !== undefined || this.session.retreated; }

  addElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) throw new Error("Realtime Combat: invalid elapsed time");
    if (!this.ended) this.remainderMs += ms;
  }

  tick() {
    if (this.ended || this.remainderMs + 1e-8 < 20) return undefined;
    this.remainderMs = Math.max(0, this.remainderMs - 20);
    this.time += 1;
    const before = this.session.events.length;
    this.core.advanceBuffDurations(1);
    this.core.checkWinLoss();
    const events = this.session.events.slice(before);
    this.refresh(events);
    return events;
  }

  refresh(events = []) {
    const live = new Set(this.session.queueOrder());
    const casting = this.session.pendingScripted?.actorId;
    for (const id of this.ready.keys()) {
      if (id === casting || !live.has(id) || !this.core.isAlive(id) || this.session.timeDelayOf(id) > 0) {
        this.ready.delete(id);
        this.steps.delete(id);
      }
    }
    // Preserve arrival order even if later move-to-front effects reorder TimedQueue.
    for (const id of live) {
      if (id !== casting && this.core.isAlive(id) && this.session.timeDelayOf(id) === 0 && !this.ready.has(id)) {
        this.ready.set(id, this.time);
      }
    }
    for (const event of events) {
      if (event.type === "buffAdded" || event.type === "buffRemoved") this.steps.delete(event.target);
    }
    const pending = this.session.pending;
    if (pending && !this.ready.has(pending.actorId)) this.session.pending = undefined;
  }

  step(id) {
    this.refresh();
    if (this.ended || !this.ready.has(id)) return undefined;
    // AI control changes who chooses the move, not an ally's place in the FIFO.
    // Gate before advanceForPresentation so waiting allies do not roll status/kit RNG early.
    if (this.session.teamOf(id) === 0 &&
        (this.session.pendingScripted !== undefined || id !== this.friendlyId())) return undefined;
    if (!this.steps.has(id)) {
      const previous = this.session.pending;
      this.session.pending = undefined;
      this.selected = id;
      try {
        // Goes through other mods' advance interceptors too (e.g. Cat's per-turn kit).
        this.steps.set(id, this.withoutScript(() => this.session.advanceForPresentation()));
      } finally {
        this.selected = undefined;
        this.session.pending = previous;
        this.session.pendingEnemyId = undefined;
        this.session.pendingForcedLooseTurn = false;
      }
    }
    return this.steps.get(id);
  }

  automaticId() {
    this.refresh();
    for (const id of this.ready.keys()) {
      if (this.step(id)?.type === "awaitingEnemy") return id;
    }
    return undefined;
  }

  playerStep() {
    this.refresh();
    const id = this.friendlyId();
    const step = id === undefined ? undefined : this.step(id);
    return step?.type === "awaitingPlayer" ? step : undefined;
  }

  friendlyId() {
    // One shared FIFO for manual, Berserk and status-forced allied turns. Enemies bypass it.
    for (const id of this.ready.keys()) {
      if (this.session.teamOf(id) === 0) return id;
    }
    return undefined;
  }

  offer(step) {
    this.session.pending = { actorId: step.actorId, choices: step.choices };
  }

  act(id, submit) {
    const step = this.step(id);
    if (!step) throw new Error("Realtime Combat: actor is no longer ready/alive or is waiting behind an ally");
    const previous = this.session.pending;
    this.selected = id;
    this.session.pending = step.type === "awaitingPlayer"
      ? { actorId: id, choices: step.choices } : undefined;
    this.session.pendingEnemyId = step.type === "awaitingEnemy" ? id : undefined;
    this.session.pendingForcedLooseTurn = step.type === "awaitingEnemy" && step.forcedLooseTurn;
    const before = this.session.events.length;
    try {
      const result = this.withoutScript(submit);
      // Zero-cost custom content gets at most one activation per 20 ms, never an infinite
      // synchronous loop. A waiting player's next cost starts NOW, with no negative-TU credit.
      if (!this.ended && this.session.pendingScripted?.actorId !== id &&
          this.queue.has(id) && this.session.timeDelayOf(id) === 0) {
        this.queue.setTime(id, this.time + 1);
      }
      this.ready.delete(id);
      this.steps.delete(id);
      return result;
    } finally {
      this.selected = undefined;
      this.session.pendingEnemyId = undefined;
      this.session.pendingForcedLooseTurn = false;
      this.session.pending = previous?.actorId !== id ? previous : undefined;
      this.refresh(this.session.events.slice(before));
    }
  }

  withoutScript(work) {
    const pending = this.session.pendingScripted;
    if (pending === undefined) return work();
    const open = this.core.openScriptedTurn;
    this.session.pendingScripted = undefined;
    this.core.openScriptedTurn = undefined;
    try { return work(); }
    finally {
      this.session.pendingScripted = pending;
      this.core.openScriptedTurn = open;
    }
  }

  snapshot() {
    return {
      tuPerSecond: 50,
      elapsedTu: this.time,
      remainderMs: this.remainderMs,
      ready: [...this.ready.keys()],
      readyFriendly: [...this.ready.keys()].filter((id) =>
        this.session.teamOf(id) === 0),
      tu: Object.fromEntries(this.session.queueOrder().map((id) => [id, this.session.timeDelayOf(id)])),
      ended: this.ended,
    };
  }

  dispose() {
    for (const restore of this.disposers.reverse()) restore();
    this.disposers = [];
  }
}
dibMod.exports.RealtimeCombatClock = RealtimeCombatClock;
