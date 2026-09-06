await dibMod.files.run("scripts/clock.js");
const { RealtimeCombatClock } = dibMod.exports;
const [{ BattleNode }, { turnOrderResolutionPlan }, { PopupHost }, { showCaptureCardPopup },
  { mirrorLocalCapturePurchaseToBattleWallet, settleLocalBattleWalletEvents }] = await Promise.all([
  dibMod.modules.load("web/battle/battleNode.ts"),
  dibMod.modules.load("web/battle/turnOrderFlow.ts"),
  dibMod.modules.load("web/ui/popup.ts"),
  dibMod.modules.load("web/battle/captureCardPopup.ts"),
  dibMod.modules.load("web/battle/localBattleSession.ts"),
]);
const battles = new WeakMap();
const active = new Set();
const cancelledScript = Symbol("realtime script actor removed");
const structuralTypes = new Set(["died", "captured", "switched", "monsterAdded", "summonChanged", "escaped", "battleEnded"]);

// Project committed state independently of a character's dialogue/preload/animation hook.
// Each native listener consumes an event once, even when a scripted mod also forwards it.
for (const method of ["applyAbilityEvents", "applyHp", "applyPresentedSpiritReadiness",
  "applyStatusOverlayEvents", "fireEnemyDefeatQuestEvents", "handleDeaths"]) {
  dibMod.intercept(BattleNode.prototype, method, function (next, events, ...args) {
    const state = battles.get(this);
    if (!state) return next(events, ...args);
    let seen = state.listeners.get(method);
    if (!seen) state.listeners.set(method, seen = new WeakSet());
    const fresh = events.filter((event) => !seen.has(event));
    fresh.forEach((event) => seen.add(event));
    if (method === "applyHp") return next(fresh.map((event) =>
      event.type === "damageDealt" || event.type === "healed"
        ? { ...event, hpAfter: this.session.hpOf(event.target) } : event), ...args);
    return next(fresh, ...args);
  });
}

function queueProjection(node, state, events) {
  const fresh = events.filter((event) => !state.projectedEvents.has(event));
  if (!fresh.length || state.stopped) return;
  fresh.forEach((event) => state.projectedEvents.add(event));
  settleLocalBattleWalletEvents(node.profile, fresh);
  state.baseBuild = state.baseBuild.then(() => {
    if (!state.stopped) return presentTicks(node, fresh);
  });
  void state.baseBuild.catch(state.fail);
}

// Preserve the OUTER character hooks, but give their innermost stock presentation a single
// construction join. A hook may await dialogue/dance before calling next; the
// already-committed engine batch is reconciled now. Its later next still renders the character's
// effects, with that character's preloaded assets/context, but cannot replay roster mutations.
function queuePresentation(node, state, next, args) {
  if (state.stopped || node.lifecycle.disposed) return Promise.resolve();
  const fresh = args[0].filter((event) => !state.presentedEvents.has(event));
  if (!fresh.length) return state.baseBuild;
  fresh.forEach((event) => state.presentedEvents.add(event));
  if (!state.clock.core.isAlive(args[1]) || !node.tryNode(args[1])) return state.baseBuild;
  const visibleEvents = fresh.filter((event) => event.type !== "silverSpent" && !structuralTypes.has(event.type) &&
    (event.target === undefined || node.tryNode(event.target) !== undefined));
  // Invoke next on the wrapper's call stack: mods can scope damage/effect context around that
  // call (Cat does). Deferring the invocation would lose or mix that context across actors.
  const build = Promise.resolve(next(visibleEvents, ...args.slice(1)));
  state.baseBuild = Promise.all([state.baseBuild, build]).then(() => undefined);
  void state.baseBuild.catch(state.fail);
  return state.baseBuild;
}
dibMod.interceptBase(BattleNode.prototype, "playTurn", function (next, ...args) {
  const state = battles.get(this);
  return state ? queuePresentation(this, state, next, args) : next(...args);
});

function dispatchTurn(node, state, ...args) {
  // Scripted mods own their mechanical steps; their final next carries those events. The
  // no-delay sleep makes existing burst scripts settle without spending wall-clock TU.
  queueProjection(node, state, args[0]);
  const task = Promise.resolve(node.playTurn(...args));
  state.modTasks.add(task);
  void task.then(() => {
    state.modTasks.delete(task);
    state.clock.refresh();
  }, (error) => {
    state.modTasks.delete(task);
    if (!state.stopped && error !== cancelledScript) state.fail(error);
  });
}

// Stock capture spends in the popup callback because nothing can attack during that callback's
// turn. Here the chooser returns intent; validate and spend atomically inside the combat pump.
dibMod.intercept(BattleNode.prototype, "openCaptureChooser", async function (next, actorId, targetId, finish, fail) {
  const state = battles.get(this);
  if (!state) return next(actorId, targetId, finish, fail);
  if (this.activeCapturePopup || !this.scene || !state.clock.ready.has(actorId)) return;
  const generation = state.generation;
  const partyLevel = this.profile.capturePartyLevel();
  this.capturePopupKind = "captureChooser";
  this.setPresentationState("captureCardChoice");
  let popup;
  let chosen = false;
  try {
    popup = await showCaptureCardPopup({
      parent: this.scene, assets: this.game.assets, scale9: this.game.scale9,
      ticker: this.stage.app.ticker, strings: this.game.strings, inventory: this.profile.snapshot(),
      options: [1, 2, 3].map((level) => ({ level,
        status: this.session.captureStatusOf(targetId),
        chance: this.session.captureChanceOf(targetId, level, partyLevel),
      })),
      onChoose: (level) => {
        if (chosen || state.stopped || generation !== state.generation) return;
        chosen = true;
        popup?.dismiss();
        this.capturePopupKind = null;
        this.activeCapturePopup = undefined;
        finish(level);
      },
      onCancel: () => { this.capturePopupKind = null; this.activeCapturePopup = undefined; },
      onDismiss: () => { if (this.activeCapturePopup === popup) this.activeCapturePopup = undefined; },
      sfx: this.popupSfx(),
    });
    if (chosen || state.stopped || generation !== state.generation || popup.isDismissed) popup.dismiss();
    else this.activeCapturePopup = popup;
  } catch (error) { fail(error); }
});

// Devtools' no-combat-delay behavior, automatically enabled for this mod's battles. Source
// effects, death actions and queue motion retain their independent animation lifetimes.
for (const method of ["sleep", "awaitTimeDelay"]) {
  dibMod.intercept(BattleNode.prototype, method, function (next, ms) {
    const state = battles.get(this);
    if (!state) return next(ms);
    const caster = this.session.pendingScripted?.actorId;
    if (caster !== undefined && (state.clock.ended || !state.clock.core.isAlive(caster))) {
      return Promise.reject(cancelledScript);
    }
    return Promise.resolve();
  });
}
dibMod.intercept(BattleNode.prototype, "phaseStartDelayMs", function (next, ...args) {
  return battles.has(this) ? 0 : next(...args);
});

// Panel construction resolves cached textures asynchronously. Join construction before another
// transaction may remove its hosts; never await its input or an animation from the combat pump.
dibMod.intercept(BattleNode.prototype, "showPanel", function (next, ...args) {
  const state = battles.get(this);
  const build = next(...args);
  if (state) {
    state.panelBuild = build;
    void build.catch(state.fail);
  }
  return build;
});

// The hero can install a spirit outside playTurn. Share its asynchronous display registration
// with the pump, so a newly scheduled summon never outruns its asset/roster construction.
dibMod.intercept(BattleNode.prototype, "applyRosterEvents", function (next, events, ...args) {
  const state = battles.get(this);
  if (state) {
    const fresh = events.filter((event) => !state.rosterEvents.has(event));
    fresh.forEach((event) => state.rosterEvents.add(event));
    events = fresh;
  }
  const build = next(events, ...args);
  if (state) {
    state.rosterBuilds.add(build);
    state.rosterChanged ||= events.some((e) =>
      ["died", "captured", "summonChanged", "switched", "monsterAdded", "escaped"].includes(e.type));
    state.clock.refresh(events);
    retireInput(this, events);
    void build.then(() => state.rosterBuilds.delete(build), state.fail);
  }
  return build;
});

// Late popup/management construction must not resurrect input from a cancelled readiness.
for (const method of ["showSecondaryConfirmation", "showSecondaryMessage", "openReserveManagement"]) {
  dibMod.intercept(BattleNode.prototype, method, async function (next, ...args) {
    const state = battles.get(this);
    const generation = state?.generation;
    const result = await next(...args);
    if (state && (state.stopped || generation !== state.generation)) {
      if (method === "openReserveManagement") {
        this.activeMonsterManagement?.destroy({ children: true });
        this.activeMonsterManagement = undefined;
      } else {
        this.activeSecondaryPopup?.dismiss();
        this.activeSecondaryPopup = undefined;
        this.secondaryPopupKind = null;
      }
    }
    return result;
  });
}

dibMod.intercept(BattleNode.prototype, "renderGameState", function (next, ...args) {
  const rendered = next(...args);
  const state = battles.get(this);
  if (!state) return rendered;
  return {
    ...rendered,
    codeMods: {
      ...(rendered.codeMods ?? {}),
      realtimeCombat: {
        ...state.clock.snapshot(),
        promptedActor: state.prompt?.actorId ?? null,
        automaticActions: state.automaticActions,
        playerActions: state.playerActions,
        invalidatedChoices: state.invalidatedChoices,
        pendingModPresentations: state.modTasks.size,
        scriptedActor: this.session.pendingScripted?.actorId ?? null,
        running: !state.stopped,
      },
    },
  };
});

function clearPrompt(node, state) {
  state.generation += 1;
  state.prompt = undefined;
  state.selection = undefined;
  // Settle the old callback FIRST: targetPicker.cancel invokes its cancel callback, which
  // must see a settled choice and must not asynchronously rebuild the dead actor's panel.
  node.cancelPendingChoice?.();
  node.targetPicker.cancel();
  node.picking = false;
  node.friendlyDisplay.setSummonSelectMode(false);
  node.setPanelShown(false);
  node.session.pending = undefined;
  if (node.scene) PopupHost.for(node.scene).dismissAll();
  node.activeCapturePopup = undefined;
  node.capturePopupKind = null;
  node.activeSecondaryPopup = undefined;
  node.secondaryPopupKind = null;
  node.activeMonsterManagement?.destroy({ children: true });
  node.activeMonsterManagement = undefined;
}

function invalidatesPrompt(events, state) {
  return state.prompt && events.some((e) =>
    ["died", "captured", "switched", "monsterAdded", "summonChanged", "escaped"].includes(e.type) ||
    ((e.type === "buffAdded" || e.type === "buffRemoved") && e.target === state.prompt.actorId));
}

function retireInput(node, events) {
  for (const event of events) {
    const id = event.type === "died" || event.type === "captured" ? event.living
      : event.type === "switched" ? event.out
      : event.type === "summonChanged" ? event.removed : undefined;
    if (id !== undefined) {
      const display = node.tryNode(id);
      if (display) display.eventMode = "none";
    }
  }
}

async function presentTicks(node, events) {
  if (events.length === 0) return;
  retireInput(node, events);
  node.applyAbilityEvents(events);
  node.applyPresentedSpiritReadiness(events);
  node.applyHp(events);
  node.fireEnemyDefeatQuestEvents(events);
  node.applyStatusOverlayEvents(events);
  await node.applyRosterEvents(events);
  const plan = turnOrderResolutionPlan(events);
  if (plan.teamRemovedIds.length > 0 || events.some((e) => e.type === "monsterAdded" || e.type === "summonChanged")) {
    const before = new Set(node.turnOrder.displayedOrder);
    node.startPresentationTask(node.handleDeaths(events), "realtime status deaths");
    await node.settleDisplayRegistrations();
    const order = node.session.queueOrder();
    node.startPresentationTask(
      node.commitTurnOrderForTurn(plan, order.filter((id) => !before.has(id)), order),
      "realtime status queue",
    );
  } else {
    node.startPresentationTask(node.turnOrder.notifyBattleTimePassed(), "realtime committed queue");
  }
}

async function submitSelection(node, state) {
  const { selection, step } = state.selection;
  const current = state.clock.playerStep();
  if (current !== step || !state.clock.ready.has(step.actorId)) {
    clearPrompt(node, state);
    state.invalidatedChoices += 1;
    return;
  }
  const actorId = step.actorId;
  let events, abilityPath, tier, slot;


  if (selection.kind === "ability") {
    const choice = step.choices.find((entry) => entry.slot === selection.choice.slot);
    const ref = node.session.data.jobAbilitiesOrEmpty(node.session.shortTypeOf(actorId))
      .find((entry) => entry.slot === selection.choice.slot);
    const targets = node.submitTargetsFor(selection.choice, selection.targets);
    if (!choice || !ref || state.clock.core.blockUseReasonFor(
      actorId, node.session.data.ability(ref.type), ref.arguments,
    ) !== undefined) {
      clearPrompt(node, state);
      state.clock.steps.delete(actorId);
      return;
    }
    // resolveTargets validates live membership without changing state or drawing RNG.
    try { node.session.resolveTargets(actorId, choice.targeting, targets); }
    catch {
      clearPrompt(node, state);
      state.invalidatedChoices += 1;
      return;
    }
    events = state.clock.act(actorId, () => node.session.submitPlayerAction(choice.slot, targets));
    abilityPath = choice.abilityPath;
    tier = choice.tier;
    slot = choice.slot;
    node.latestPlayerSubmission = {
      actorId, slot, abilityPath,
      selectedTargetIds: [...selection.targets], submittedTargetIds: [...targets],
    };
    node.playerAbilitySubmissionCount += 1;
  } else if (selection.kind === "capture") {
    if (!node.session.targetableIdsOf(1).includes(selection.targetId) ||
        node.session.captureStatusOf(selection.targetId) !== "available" ||
        node.session.captureChanceOf(selection.targetId, selection.cardLevel, node.profile.capturePartyLevel()) <= 0) {
      clearPrompt(node, state);
      state.invalidatedChoices += 1;
      return;
    }
    const spent = node.profile.spendCaptureCard(selection.cardLevel);
    if (!spent.ok) {
      clearPrompt(node, state);
      node.audio.playSfx("notAllowed");
      return;
    }
    mirrorLocalCapturePurchaseToBattleWallet(node.session, spent);
    events = state.clock.act(actorId, () => node.session.submitCaptureAction(
      selection.targetId, selection.cardLevel, node.profile.capturePartyLevel(),
    ));
    abilityPath = "Utility.Capture";
    tier = 4;
  } else if (selection.kind === "delay") {
    const result = state.clock.act(actorId, () => node.session.submitDelayAction());
    ({ events, abilityPath } = result);
    node.latestSecondaryAction = { abilityPath, activationLength: result.activationLength, noHaste: true };
  } else if (selection.kind === "retreat") {
    const result = state.clock.act(actorId, () => node.session.submitRetreatAction(30));
    events = result.events;
    if (!result.success) { abilityPath = result.abilityPath; tier = 4; }
    node.latestSecondaryAction = { kind: "retreat", chance: 30, success: result.success };
  } else return;
  clearPrompt(node, state);
  state.playerActions += 1;
  retireInput(node, events);
  if (abilityPath) {
    dispatchTurn(node, state, events, actorId, abilityPath, tier,
      selection.kind === "ability" ? "friendlyPopForward" : "none", slot);
  }
}

dibMod.interceptBase(BattleNode.prototype, "loop", async function () {
  if (this.authority !== undefined) throw new Error("Realtime Combat is Offline only");
  const node = this;
  // Unlike stock pacing, realtime permits choosing a move under live attack art. Pixi's
  // non-interactive Sprite still wins hit testing under an interactive ancestor (an empty hit
  // path bubbles to battleScene), so the entire decorative layer must opt out explicitly.
  node.effectLayer.eventMode = "none";
  const decorativeChild = (child) => {
    if (child.label === "friendlyAttackSpotlight") child.eventMode = "none";
  };
  node.scene?.on("childAdded", decorativeChild);


  const clock = battles.get(node)?.clock ?? new RealtimeCombatClock(node.session);
  // A character reticle may retain old target ids across strikes. Retiring bodies can keep
  // their death art, but must immediately stop being aimable through the sprite lookup.
  if (node.enemyDisplay?.monsterSpriteOf) {
    const display = node.enemyDisplay;
    const previous = Object.getOwnPropertyDescriptor(display, "monsterSpriteOf");
    const lookup = display.monsterSpriteOf;
    display.monsterSpriteOf = (id) => clock.queue.has(id) ? lookup.call(display, id) : null;
    node.lifecycle.add(() => {
      if (previous) Object.defineProperty(display, "monsterSpriteOf", previous);
      else delete display.monsterSpriteOf;
    });
  }
  let resolveDone, rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  const state = {
    clock, generation: 0, prompt: undefined, selection: undefined,
    panelBuild: Promise.resolve(), stopped: false, pumping: false,
    rosterBuilds: new Set(), rosterChanged: false,
    baseBuild: Promise.resolve(), presentedEvents: new WeakSet(), modTasks: new Set(),
    projectedEvents: new WeakSet(), rosterEvents: new WeakSet(), listeners: new Map(),
    automaticActions: 0, playerActions: 0, invalidatedChoices: 0,
    fail: (error) => { stop(); rejectDone(error); },
    stop: () => { stop(); resolveDone(); },
  };
  const ticker = node.stage.app.ticker;
  let suspended = typeof document !== "undefined" && document.hidden;
  const onVisibility = () => { suspended = true; };
  function stop() {
    if (state.stopped) return;
    state.stopped = true;
    ticker.remove(onTick);
    node.lifecycle.signal.removeEventListener("abort", state.stop);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    active.delete(state);
    node.scene?.off("childAdded", decorativeChild);
    if (!node.lifecycle.disposed) clearPrompt(node, state);
  }
  async function finish() {
    stop();
    node.statusText.clearStatusText();
    node.pendingTerminalPresentation = undefined;
    if (node.session.retreated) await node.onBattleRetreated();
    else await node.onBattleEnded(clock.core.winner, 0, node.terminalQueueFrontTeam());
    resolveDone();
  }
  async function pump() {
    if (state.pumping || state.stopped) return;
    state.pumping = true;
    try {
      do {
        await state.panelBuild;
        await state.baseBuild;
        await Promise.all([...state.rosterBuilds]);
        await node.settleDisplayRegistrations();
        if (state.stopped) return;
        if (state.rosterChanged) {
          state.rosterChanged = false;
          if (state.prompt) { state.invalidatedChoices += 1; clearPrompt(node, state); }
        }
        if (state.selection) await submitSelection(node, state);
        await state.baseBuild;
        if (state.stopped) return;
        if (clock.ended) { await finish(); return; }
        let id;
        while ((id = clock.automaticId()) !== undefined) {
          const step = clock.step(id);
          const result = clock.act(id, () => node.session.submitEnemyAction());
          retireInput(node, result.events);
          state.automaticActions += 1;
          if (invalidatesPrompt(result.events, state)) {
            state.invalidatedChoices += 1;
            clearPrompt(node, state);
          }
          // playTurn joins display construction only: all effects, deaths, spotlight and
          // queue motion are free-running, and the mod removes both kinds of combat hold.
          dispatchTurn(node, state, result.events, id, result.abilityPath, result.tier,
            step.forcedLooseTurn ? "none" : node.session.teamOf(id) === 1
              ? "enemyPulse" : "friendlyPopForward");
          await state.baseBuild;
          if (state.stopped) return;
          if (clock.ended) { await finish(); return; }
        }
        node.statusText.clearStatusText();
        const step = clock.playerStep();
        if (state.prompt && state.prompt !== step) clearPrompt(node, state);
        if (step && !state.prompt) {
          clock.offer(step);
          state.prompt = step;
          const generation = state.generation;
          node.activeActorId = step.actorId;
          node.activeAbilityPath = null;
          node.suppressCommittedOpeningSpiritCharge = false;
          node.friendlyDisplay.notifyPlayerTurnStarted();
          node.setPresentationState("awaitingPlayerChoice");
          void node.awaitPlayerChoice(step).then((selection) => {
            if (state.stopped || generation !== state.generation || selection.kind === "cancelled") return;
            state.selection = { selection, step };
            void pump();
          }, (error) => {
            if (!state.stopped && generation === state.generation) state.fail(error);
          });
        } else if (!step) {
          node.activeActorId = null;
          node.setPresentationState("realtimeCountdown");
        } else if (!node.picking && node.secondaryPopupKind === null && node.capturePopupKind === null) {
          node.activeActorId = step.actorId;
          node.setPresentationState("awaitingPlayerChoice");
        }
        await state.panelBuild;
        if (state.stopped) return;
        const events = clock.tick();
        if (events === undefined) break;
        if (invalidatesPrompt(events, state)) {
          await state.panelBuild;
          state.invalidatedChoices += 1;
          clearPrompt(node, state);
        }
        await presentTicks(node, events);
        refreshLabels();
      } while (!state.stopped);
    } catch (error) { state.fail(error); }
    finally { state.pumping = false; }
  }
  function refreshLabels() {
    // Refresh text without scheduling 50 queue-reorder animations per second.
    for (const [id, entry] of node.turnOrder.entries) {
      if (clock.queue.has(id)) entry.label.text = String(node.session.timeDelayOf(id)).padStart(3, " ");
    }
  }
  function onTick() {
    if (state.stopped) return;
    // elapsedMS is unscaled by Devtools' speed-up and by gameSpeed: always 50 TU/sec.
    // Discard the first resumed frame too: elapsedMS may include the entire time hidden.
    if (typeof document !== "undefined" && document.hidden) return;
    if (suspended) { suspended = false; return; }
    clock.addElapsed(ticker.elapsedMS);
    refreshLabels();
    void pump();
  }
  battles.set(node, state);
  clock.onEvents = (events) => queueProjection(node, state, events);
  active.add(state);
  node.lifecycle.signal.addEventListener("abort", state.stop, { once: true });
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
  try {
    node.applyStatusOverlayEvents(node.session.events);
    await node.turnOrder.initialize();
    if (!state.stopped) { ticker.add(onTick); void pump(); }
    await done;
  } finally {
    stop();
    // Keep the clock projection through terminal UI; release the instance patches when the
    // scene itself goes away (the next battle always constructs a new BattleSession).
    node.lifecycle.add(() => clock.dispose());
  }
});
dibMod.onDispose(() => {
  for (const state of [...active]) { state.stop(); state.clock.dispose(); }
});
