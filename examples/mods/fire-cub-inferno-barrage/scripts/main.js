// This entire move is package-owned. The site has no Inferno Barrage identifier, registration
// point, or presentation branch: the mod overlays ordinary content and composes the engine's
// generic scripted-turn primitives by intercepting the real runtime classes. Every real monster
// whose resolved move set has fewer than four usable slots gets one copy in its first empty slot.
const ABILITY_PATH = "DevDragonIslandBlueFireCub.FireCubInfernoBarrage";
const COMPONENT_PATH = "DevDragonIslandBlueFireCub.RapidPhysicalStrike";
const DESCRIPTION_KEY = "ModInfernoBarrageDescriptionKey";
const STRIKE_COUNT = 20;
const STRIKE_INTERVAL_MS = 200;
// The aiming reticle. Enemy slots are `ENEMY_SLOT_WIDTH` (128/256 by idiom) apart, so a radius
// past half of that leaves no dead band between adjacent monsters for the pointer to fall into —
// the gap-driven reversion to random targeting that pressing an individual body suffered from.
// A two-member team spreads to 192pt of spacing (`MEMBERS_BOX_GAP_TWO`), whose middle IS outside
// every circle: that is the deliberate "aim at nothing" region, not a gap.
const CIRCLE_RADIUS_SOURCE_PT = 80;
const CIRCLE_LOCKED_COLOR = 0xff8a2b;
const CIRCLE_LOOSE_COLOR = 0xdfe6ec;
const USABLE_SLOTS = ["usable1", "usable2", "usable3", "usable4"];
// This move paces itself through `BattleNode.sleep`, which is exactly the seam a battle-timing mod
// takes over. `optionalDependencies` + `loadAfter` guarantee that if devtools is selected it is
// already registered here, so its published toggle can be read rather than guessed at, and
// `dibMod.original` is deliberately NOT used: a player who asked for delay-free battles gets them.
const DEVTOOLS_ID = "dev.dragonislandblue.devtools";

function fastBattlesEnabled() {
  try {
    return dibMod.host.get(`mods.${DEVTOOLS_ID}`)?.settings().noBattleDelays === true;
  } catch {
    return false;
  }
}

dibMod.hooks.on("content:loaded", ({ value: content }) => {
  const namespace = "DevDragonIslandBlueFireCub";
  const sourceData = GameData.fromRaw({
    monsters: content.data.monsters,
    jobs: content.data.jobs,
    abilities: content.data.abilities,
    abilityComponents: content.data.abilityComponents,
    buffs: content.data.buffs,
  });
  let jobs = content.data.jobs;
  const assignedSlots = {};
  for (const monster of sourceData.allMonsters()) {
    const occupied = new Set(
      sourceData.jobAbilitiesOrEmpty(monster.shortType)
        .map(({ slot }) => slot)
        .filter((slot) => USABLE_SLOTS.includes(slot)),
    );
    const slot = USABLE_SLOTS.find((candidate) => !occupied.has(candidate));
    if (slot === undefined) continue;
    jobs = withJobAbility(jobs, monster.path, slot, {
      arguments: { activationLength: "{4}", instanceName: "Inferno" },
      type: ABILITY_PATH,
    });
    assignedSlots[monster.shortType] = slot;
  }
  dibMod.exports.assignedSlots = Object.freeze({ ...assignedSlots });

  return {
    ...content,
    data: {
      ...content.data,
      abilityComponents: {
        ...content.data.abilityComponents,
        [namespace]: {
          ...(content.data.abilityComponents[namespace] ?? {}),
          RapidPhysicalStrike: {
            class: "DamageDealingAbilityComponent",
            roll: { relatedStat: "Attack" },
          },
        },
      },
      abilities: {
        ...content.data.abilities,
        [namespace]: {
          ...(content.data.abilities[namespace] ?? {}),
          FireCubInfernoBarrage: {
            abstract: false,
            abilityScalor: 0.06,
            activationLength: "{4}",
            components: [{
              type: COMPONENT_PATH,
              arguments: { modDescriptionKey: DESCRIPTION_KEY },
            }],
            eventData: {
              enemyTargetEventData: {
                effectBuilders: [{ animationName: "Fire", class: "AnimationEffectBuilder" }],
                hideBlood: true,
                startDelay: 0,
              },
            },
            parent: "SelfOnlyRoot",
          },
        },
      },
      jobs: {
        ...jobs,
      },
      strings: {
        ...content.data.strings,
        RenderableFireCubInfernoBarrageNameKey: "Inferno",
        RenderableInfernoNameKey: "Inferno",
        [DESCRIPTION_KEY]:
          "Strikes 20 times over 4 seconds. A ring follows your finger: the enemy nearest its " +
          "centre takes every strike. Aim away from the enemies and each strike picks one at " +
          "random. You can move the ring during the barrage. Strikes continue for 0 damage if " +
          "their target is defeated before the barrage ends.",
      },
    },
  };
});

/** Clones only the category/job path being changed. Monster and Job paths are intentionally the
 * same source identities; a missing path is package/schema drift and must fail loudly. */
function withJobAbility(jobs, path, slot, ability) {
  const segments = path.split(".");
  const result = { ...jobs };
  let source = jobs;
  let destination = result;
  for (const segment of segments) {
    const node = source[segment];
    if (node === null || typeof node !== "object" || Array.isArray(node)) {
      throw new Error(`Inferno Barrage: Jobs.${path} does not match monster path ${path}`);
    }
    const clone = { ...node };
    destination[segment] = clone;
    source = node;
    destination = clone;
  }
  const inheritedOrOwned = destination.jobAbilities;
  destination.jobAbilities = {
    ...(inheritedOrOwned === null || typeof inheritedOrOwned !== "object" || Array.isArray(inheritedOrOwned)
      ? {}
      : inheritedOrOwned),
    [slot]: ability,
  };
  return result;
}

const [
  { BattleSession },
  { GameData },
  { BattleNode },
  { Graphics },
  { idiomPairPt },
  runtimeSettings,
] = await Promise.all([
  dibMod.modules.load("@dib/engine"),
  dibMod.modules.load("@dib/gamedata/browser"),
  dibMod.modules.load("web/battle/battleNode.ts"),
  dibMod.modules.load("pixi.js"),
  dibMod.modules.load("web/displayMode.ts"),
  dibMod.modules.load("web/runtimeSettings.ts"),
]);

// ---------------------------------------------------------------------------------------------
// Aiming. The ring is drawn in `BattleNode`'s point root, so its radius is an ordinary source
// point value that adapts with the display mode exactly like the slot metrics it is sized against.
// ---------------------------------------------------------------------------------------------

function circleRadiusPt() {
  return idiomPairPt(
    CIRCLE_RADIUS_SOURCE_PT,
    CIRCLE_RADIUS_SOURCE_PT * 2,
    runtimeSettings.DISPLAY_MODE,
  );
}

/** Opens the reticle for one barrage: pointer tracking, the ring itself, and the target policy.
 *  Everything it installs is undone by the returned `close`, including on an aborted turn. */
function openAimingReticle(battle, targetCandidates) {
  const stage = battle.stage.app.stage;
  const radius = circleRadiusPt();
  const ring = new Graphics()
    // Outer dark stroke first so the ring survives a bright fire animation behind it, then the
    // live-coloured ring, then a barely-there fill that reads as "this area is being aimed at"
    // without hiding the monster under it.
    .circle(0, 0, radius + 1).stroke({ color: 0x000000, width: 3, alpha: 0.5 })
    // Drawn white so `tint` alone carries the colour, exactly, with no geometry rebuild per frame.
    .circle(0, 0, radius).stroke({ color: 0xffffff, width: 2, alpha: 0.95 })
    .circle(0, 0, radius).fill({ color: 0xffffff, alpha: 0.06 });
  ring.label = "infernoBarrageReticle";
  // Pointer-transparent: the ring rides above the field and must never eat a tap the scene owns.
  ring.eventMode = "none";
  ring.zIndex = 1_000_000;
  ring.visible = false;
  ring.tint = CIRCLE_LOOSE_COLOR;
  battle.pointRoot.addChild(ring);

  let pointer = null;
  let locked = null;
  const trackPointer = (event) => {
    pointer = { x: event.global.x, y: event.global.y };
  };
  // A mouse that never moves during the barrage still has a known position; a touch that has not
  // happened yet does not, and the ring stays hidden until the finger lands.
  const seed = battle.stage.app.renderer.events.pointer;
  if (typeof seed?.pointerType === "string" && seed.pointerType !== "") {
    pointer = { x: seed.global.x, y: seed.global.y };
  }
  // `globalpointermove` reaches a listener whether or not the pointer is over it, which is what
  // makes the ring follow across empty field, over the player's own cards, and off the enemies
  // entirely. `pointerdown` covers the touch that taps without ever moving.
  stage.on("globalpointermove", trackPointer);
  stage.on("pointerdown", trackPointer);

  /** The enemy MOST inside the ring: the one whose sprite centre sits nearest the ring's own
   *  centre, among those inside it at all. Ties cannot survive a float comparison in practice,
   *  and the first-listed enemy winning one is the same order the shipped displays are built in. */
  const focusOf = (enemies) => {
    if (pointer === null || enemies.length === 0) return null;
    const centre = battle.pointRoot.toLocal(pointer);
    let best = null;
    for (const id of enemies) {
      const sprite = battle.enemyDisplay.monsterSpriteOf(id);
      if (sprite === null) continue;
      const at = battle.pointRoot.toLocal(sprite.toGlobal({ x: 0, y: 0 }));
      const dx = at.x - centre.x;
      const dy = at.y - centre.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > radius * radius) continue;
      if (best === null || distanceSquared < best.distanceSquared) best = { id, distanceSquared };
    }
    return best?.id ?? null;
  };

  const refresh = () => {
    if (ring.destroyed) return;
    ring.visible = pointer !== null;
    if (pointer === null) return;
    const at = battle.pointRoot.toLocal(pointer);
    ring.position.set(at.x, at.y);
    const focused = focusOf(targetCandidates());
    if (focused === locked) return;
    locked = focused;
    // Colour is the whole feedback channel for "this strike will follow you" versus "this strike
    // is a coin toss", so it is recomputed every frame rather than only when a strike lands.
    ring.tint = focused === null ? CIRCLE_LOOSE_COLOR : CIRCLE_LOCKED_COLOR;
  };
  refresh();
  const ticker = battle.stage.app.ticker;
  ticker.add(refresh);

  return {
    radius,
    pointAt: () => pointer === null ? null : { ...battle.pointRoot.toLocal(pointer) },
    focusOf,
    close: () => {
      ticker.remove(refresh);
      stage.off("globalpointermove", trackPointer);
      stage.off("pointerdown", trackPointer);
      if (!ring.destroyed) ring.destroy();
    },
  };
}

// A session is marked only after the ordinary choice builder proves that the selected dynamic
// slot is this mod's move. This avoids changing any native ability which shares the slot number.
const openActions = new WeakMap();
const barrageStates = new WeakMap();

dibMod.intercept(BattleSession.prototype, "submitPlayerAction", function (next, slot, targets) {
  const choice = this.pending?.choices?.find((candidate) => candidate.slot === slot);
  if (choice?.abilityPath !== ABILITY_PATH) return next(slot, targets);
  const opened = this.beginScriptedPlayerAction(slot);
  openActions.set(this, opened);
  return opened.events;
});

dibMod.intercept(BattleNode.prototype, "playTurn", async function (
  next,
  events,
  actorId,
  abilityPath,
  tier,
  activationMotion,
  slot,
  opts,
) {
  const opened = openActions.get(this.session);
  if (abilityPath !== ABILITY_PATH || opened?.actorId !== actorId) {
    return await next(events, actorId, abilityPath, tier, activationMotion, slot, opts);
  }
  openActions.delete(this.session);

  const startedAt = performance.now();
  const state = {
    active: true,
    actorId,
    abilityPath: ABILITY_PATH,
    strikeCount: STRIKE_COUNT,
    completedStrikes: 0,
    // Scheduled pacing, and what the clock actually did. They diverge whenever another package
    // owns `sleep`, and only the measured one may be trusted for anything but display.
    elapsedMs: 0,
    realElapsedMs: 0,
    fastMode: fastBattlesEnabled(),
    // Where the ring is in the scene's own point space (null until a pointer exists), how big it
    // is, and which enemy it holds — the aim the next strike will use, readable between strikes.
    reticlePt: null,
    reticleRadiusPt: 0,
    focusedTargetId: null,
    targetIds: [],
    damageAmounts: [],
  };
  barrageStates.set(this, state);
  this.activeAbilityPath = ABILITY_PATH;
  this.setPresentationState("infernoBarrage");
  this.startPresentationTask(
    this.abilityRenderer.renderSourceEffects(actorId, this.nodeLookup, { abilityPath, tier }),
    "Inferno Barrage source effects",
  );

  // Keep every opponent that has occupied the field during this barrage in the reticle's set.
  // Structural death presentation is deliberately deferred until the scripted turn closes, so
  // these bodies still have a display area and can receive the remaining move art.
  const aimableTargets = new Set(this.session.targetableIdsOf(1));
  const reticle = openAimingReticle(this, () => [...aimableTargets]);
  state.reticleRadiusPt = reticle.radius;
  // The ring decides the target, but a press that lands on an enemy body still belongs to this
  // move: claiming it through the shipped live-press channel is what stops an aiming drag from
  // also popping each monster's stars display behind the barrage.
  this.enemyDisplay.setLiveTargetPressHandlers({ start: () => true, end: () => {} });

  const structuralEvents = [];
  const damageElementsByTarget = new Map();
  let lastTarget;
  let finished = false;
  try {
    for (let strike = 0; strike < STRIKE_COUNT; strike += 1) {
      await this.sleep(STRIKE_INTERVAL_MS);
      state.elapsedMs += STRIKE_INTERVAL_MS;
      state.realElapsedMs = Math.round(performance.now() - startedAt);
      if (this.lifecycle.disposed) return;

      const enemies = this.session.targetableIdsOf(1);
      for (const enemy of enemies) aimableTargets.add(enemy);
      // Aim is read fresh per strike, so moving the ring mid-barrage redirects the very next one.
      const focused = reticle.focusOf([...aimableTargets]);
      state.reticlePt = reticle.pointAt();
      state.focusedTargetId = focused;
      // No enemy inside the ring — including the whole barrage before the player's first touch —
      // falls back to the engine's own scripted pick, keeping the draw on the ability's RNG stream
      // instead of inventing a second one.
      const target = focused ?? this.session.randomScriptedPlayerPick(enemies) ?? lastTarget;
      if (target === undefined) continue;
      lastTarget = target;

      const alreadyDefeated = this.session.hpOf(target) <= 0;
      let result;
      if (alreadyDefeated) {
        const element = damageElementsByTarget.get(target);
        if (element === undefined) {
          throw new Error(`Inferno Barrage: defeated target ${target} has no prior damage element`);
        }
        // Dead livings are intentionally rejected by the engine's mechanical target validator.
        // This event is presentation-only: it leaves HP at zero, triggers no damage listeners or
        // readiness, but gives the ordinary renderer the same effect and red "-0" channel.
        result = {
          events: [{
            type: "damageDealt",
            source: actorId,
            target,
            amount: 0,
            element,
            hpAfter: 0,
          }],
        };
      } else {
        result = this.session.performScriptedPlayerAbility({
          enemyTargets: [target],
          friendlyTargets: [],
        });
        for (const event of result.events) {
          if (event.type === "damageDealt" && event.source === actorId && event.target === target) {
            damageElementsByTarget.set(target, event.element);
          }
        }
      }
      state.completedStrikes += 1;
      state.targetIds.push(target);
      state.damageAmounts.push(
        result.events.find((event) =>
          event.type === "damageDealt" && event.source === actorId && event.target === target
        )?.amount ?? 0,
      );

      this.applyAbilityEvents(result.events);
      if (!alreadyDefeated) this.applyPresentedSpiritReadiness(result.events);
      this.applyHp(result.events);
      this.applyStatusOverlayEvents(result.events);
      this.startPresentationTask(
        this.abilityRenderer.renderQueuedEffects(result.events, this.nodeLookup),
        `Inferno Barrage queued effects ${strike + 1}`,
      );
      this.startPresentationTask(
        this.abilityRenderer.renderResult(result.events, this.nodeLookup, { abilityPath, tier }),
        `Inferno Barrage result ${strike + 1}`,
      );
      for (const event of result.events) {
        if (["died", "captured", "monsterAdded", "switched", "summonChanged", "escaped"]
          .includes(event.type)) structuralEvents.push(event);
      }
    }

    const finishEvents = this.session.finishScriptedPlayerAction();
    finished = true;
    await next(
      [...structuralEvents, ...finishEvents],
      actorId,
      abilityPath,
      tier,
      "none",
      slot,
      { skipSourceEffects: true },
    );
  } finally {
    reticle.close();
    this.enemyDisplay.setLiveTargetPressHandlers();
    state.focusedTargetId = null;
    state.reticlePt = null;
    state.active = false;
    if (!finished) {
      try { this.session.finishScriptedPlayerAction(); } catch { /* already closed or disposed */ }
    }
  }
});

dibMod.intercept(BattleNode.prototype, "renderGameState", function (next, ...args) {
  const rendered = next(...args);
  const state = barrageStates.get(this);
  return {
    ...rendered,
    codeMods: {
      ...(rendered.codeMods ?? {}),
      infernoBarrage: state === undefined ? null : {
        ...state,
        ...(state.reticlePt === null ? {} : { reticlePt: { ...state.reticlePt } }),
        targetIds: [...state.targetIds],
      },
    },
  };
});

dibMod.exports.abilityPath = ABILITY_PATH;
dibMod.exports.componentPath = COMPONENT_PATH;
