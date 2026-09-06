const MOD_ID = "dev.dragonislandblue.pirate-panic-dancer";
const NAMESPACE = "ModPirate";
const MONSTER_PATH = `${NAMESPACE}.PirateMan`;
const PANIC_PATH = `${NAMESPACE}.Panic`;
const SHORT_TYPE = "PirateMan";
const FIELD_SPRITE_NAME = "PirateMan-hd";
const PORTRAIT_ATLAS = "MonsterPortraits-hd";
const PORTRAIT_FRAME = "PirateMan_icon.png";
const DANCE_PATH = "Utility.Dance";
const TAUNT_PRIORITY = 50;
const DANCE_MS = 2600;

const [
  { BattleSession, braceTier },
  { AssetLibrary, pointSprite },
  { Container, Graphics, RenderTexture, Sprite },
  { BattleNode },
  { showGuildQuestChat },
  { tween },
  { screenPointsForMode },
  runtimeSettings,
] = await Promise.all([
  dibMod.modules.load("@dib/engine"),
  dibMod.modules.load("@dib/renderer"),
  dibMod.modules.load("pixi.js"),
  dibMod.modules.load("web/battle/battleNode.ts"),
  dibMod.modules.load("web/world/guildQuestChat.ts"),
  dibMod.modules.load("web/tween.ts"),
  dibMod.modules.load("web/displayMode.ts"),
  dibMod.modules.load("web/runtimeSettings.ts"),
]);

// -------------------------------------------------------------------------------------------------
// Content overlay. "Turtle" in the shipped bestiary is Animal.GiantTurtle / "Giant Turtle".
// Copying its authored values (rather than recomputing a lookalike curve) also keeps the category,
// quality, field scale and unarmed type coherent with every generic game surface.
// -------------------------------------------------------------------------------------------------

dibMod.hooks.on("content:loaded", ({ value: content }) => {
  const turtle = content.data.monsters?.Animal?.GiantTurtle;
  if (turtle === undefined) {
    throw new Error(`${MOD_ID}: Animal.GiantTurtle is missing from the content package`);
  }
  if (content.manifest.sprites?.[FIELD_SPRITE_NAME] === undefined) {
    throw new Error(`${MOD_ID}: ${FIELD_SPRITE_NAME} is missing from the content package`);
  }
  return {
    ...content,
    data: {
      ...content.data,
      monsters: {
        ...content.data.monsters,
        [NAMESPACE]: {
          ...(content.data.monsters[NAMESPACE] ?? {}),
          PirateMan: {
            category: turtle.category,
            element: turtle.element,
            index: 990002,
            parent: "RootMonster",
            quality: turtle.quality,
            ...(turtle.rendererData === undefined
              ? {}
              : { rendererData: { ...turtle.rendererData } }),
            rootStats: { ...turtle.rootStats },
            stars: turtle.stars,
            unarmedAttackType: turtle.unarmedAttackType,
          },
        },
      },
      jobs: {
        ...content.data.jobs,
        [NAMESPACE]: {
          ...(content.data.jobs[NAMESPACE] ?? {}),
          PirateMan: {
            jobAbilities: {
              Panic: {
                arguments: {
                  instanceName: "Panic",
                  targetPriorityAdjustment: TAUNT_PRIORITY,
                },
                type: PANIC_PATH,
              },
            },
            parent: "RootJob",
          },
        },
      },
      abilities: {
        ...content.data.abilities,
        [NAMESPACE]: {
          ...(content.data.abilities[NAMESPACE] ?? {}),
          // BerserkAbility is the engine's native automatic-control marker. The job-ref's positive
          // targetPriorityAdjustment is simultaneously the native taunt provider.
          Panic: { parent: "Passive.Berserk" },
        },
      },
      strings: {
        ...content.data.strings,
        RenderablePirateManNameKey: "Pirate",
        RenderablePanicNameKey: "Panic",
      },
    },
  };
});

// -------------------------------------------------------------------------------------------------
// Battle-scoped dialogue cycle.
//
// ChainedTextChat uses one bold BMFont for its whole line; the shipped ^#RRGGBB...^^ grammar adds
// selective colour emphasis. Thus every line is bold, while the marked words receive a second,
// visible emphasis channel without inventing an HTML text layer over the canvas.
// -------------------------------------------------------------------------------------------------

const PANIC_LINES = Object.freeze([
  Object.freeze({
    message: "^#ff5b61DONT LET ME DIEE^^",
    plain: "DONT LET ME DIEE",
    shake: "strong",
  }),
  Object.freeze({
    message: "^#ffd34ePLEEEEEASE^^ PLEEEEAAAAAAASEEE ^#ff6b8aPLEASEEE^^",
    plain: "PLEEEEEASE PLEEEEAAAAAAASEEE PLEASEEE",
    shake: "strong",
  }),
  Object.freeze({
    message: "WHERE AM I ^#70e1f5WHERE AM I^^",
    plain: "WHERE AM I WHERE AM I",
    shake: "medium",
  }),
  Object.freeze({
    message: "ITS IN MY ^#b6ff75EYES^^",
    plain: "ITS IN MY EYES",
    shake: "mild",
  }),
  Object.freeze({
    message: "I'M ^#9be7ffDYINGGG^^",
    plain: "I'M DYINGGG",
    shake: "medium",
  }),
  Object.freeze({
    message: "^#66e0ffSET ME FREE^^",
    plain: "SET ME FREE",
    shake: "medium",
  }),
  Object.freeze({
    message: "DO YOU EVEN ^#ffe066REMEMBER^^ ME?",
    plain: "DO YOU EVEN REMEMBER ME?",
    shake: "mild",
  }),
  Object.freeze({
    message: "^#ff6f61AIIEEEEE AYOOOOOWWWW^^",
    plain: "AIIEEEEE AYOOOOOWWWW",
    shake: "medium",
  }),
  Object.freeze({
    message: "^#ff6f61ugh...^^",
    plain: "ugh...",
    shake: "medium",
  }),
]);

function shuffledLineOrder(random = Math.random) {
  const order = PANIC_LINES.map((_, index) => index);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const draw = random();
    if (!(draw >= 0 && draw < 1)) {
      throw new Error(`${MOD_ID}: dialogue random source returned ${draw}; expected [0, 1)`);
    }
    const swap = Math.floor(draw * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return Object.freeze(order);
}

function createLineCycle(random = Math.random) {
  return { order: shuffledLineOrder(random), cursor: 0 };
}

function takeLine(cycle) {
  const line = PANIC_LINES[cycle.order[cycle.cursor]];
  if (line === undefined) throw new Error(`${MOD_ID}: corrupt dialogue cycle`);
  cycle.cursor = (cycle.cursor + 1) % cycle.order.length;
  return line;
}

const cycleByBattle = new WeakMap();
const presentationByBattle = new WeakMap();

// Build one random permutation when a battle starts. Rematches are new battles for this purpose,
// even when the app reuses the same BattleNode instance.
dibMod.intercept(BattleNode.prototype, "start", function (next, ...args) {
  const teams = [
    ...(this.encounter?.playerTeam ?? []),
    ...(this.encounter?.enemyTeam ?? []),
  ];
  if (teams.some((member) => member.shortType === SHORT_TYPE)) {
    cycleByBattle.set(this, createLineCycle());
  } else {
    cycleByBattle.delete(this);
  }
  presentationByBattle.delete(this);
  return next(...args);
});

// -------------------------------------------------------------------------------------------------
// Turn transaction. No usable job slot is fabricated: Panic only makes Pirate AI-controlled, and
// this seam replaces the AI's otherwise-empty candidate fallback with the real zero-effect Dance.
// Disabled turns still delegate untouched, preserving the single isDisabled draw and LooseTurn.
// -------------------------------------------------------------------------------------------------

dibMod.intercept(BattleSession.prototype, "submitEnemyAction", function (next, ...args) {
  const actorId = this.pendingEnemyId;
  if (actorId === undefined || this.shortTypeOf(actorId) !== SHORT_TYPE || this.pendingForcedLooseTurn) {
    return next(...args);
  }
  const before = this.core.events.length;
  const ability = this.data.ability(DANCE_PATH);
  const argsForUse = {};
  this.core.resolveTurn(() => ({
    ability,
    args: argsForUse,
    enemyTargets: [],
    friendlyTargets: [actorId],
    rngDraws: 0,
  }));
  this.pendingEnemyId = undefined;
  this.pendingForcedLooseTurn = false;
  return {
    type: "enemyTurnResolved",
    actorId,
    abilityPath: ability.path,
    tier: braceTier(ability.activationLength),
    events: this.core.events.slice(before),
  };
});

// -------------------------------------------------------------------------------------------------
// Presentation: authentic chat/portrait, line-weighted whole-screen shake, then a readable dance.
// -------------------------------------------------------------------------------------------------

const SHAKE_SPECS = Object.freeze({
  // Custom mod-authored point-space offsets. They intentionally remain identical in normalized
  // iPhone (480x320) and iPad (512x384) point spaces.
  mild: Object.freeze({ amplitude: 1.5, durationMs: 360 }),
  medium: Object.freeze({ amplitude: 3.2, durationMs: 560 }),
  strong: Object.freeze({ amplitude: 6.0, durationMs: 820 }),
});

function startScreenShake(battle, strength) {
  const spec = SHAKE_SPECS[strength];
  if (spec === undefined) throw new Error(`${MOD_ID}: unknown shake strength ${strength}`);
  const root = battle.pointRoot;
  const ticker = battle.stage.app.ticker;
  const base = { x: root.position.x, y: root.position.y };
  const controller = new AbortController();
  const lifecycleSignal = battle.lifecycle?.signal;
  const onLifecycleAbort = () => controller.abort();
  lifecycleSignal?.addEventListener("abort", onLifecycleAbort, { once: true });
  const finished = tween(
    ticker,
    spec.durationMs,
    (t) => {
      if (root.destroyed) return;
      const decay = (1 - t) ** 1.4;
      root.position.set(
        base.x + Math.sin(t * Math.PI * 18) * spec.amplitude * decay,
        base.y + Math.sin(t * Math.PI * 25 + 0.7) * spec.amplitude * 0.62 * decay,
      );
    },
    undefined,
    controller.signal,
  ).finally(() => {
    lifecycleSignal?.removeEventListener("abort", onLifecycleAbort);
    if (!root.destroyed) root.position.set(base.x, base.y);
  });
  return {
    finished,
    stop: () => controller.abort(),
  };
}

const CONFETTI_COLORS = Object.freeze([0xffd45c, 0x6ee7ff, 0xff6d8d, 0xa7ff79, 0xc394ff]);

async function danceLikeABuffoon(battle, signal) {
  if (battle.scene === undefined || battle.effectLayer === undefined) return;
  const texture = await battle.game.assets.sprite(FIELD_SPRITE_NAME);
  if (signal.aborted || battle.scene === undefined) return;

  const screen = screenPointsForMode(runtimeSettings.DISPLAY_MODE);
  const root = new Container();
  root.label = "piratePanicDance";
  root.position.set(screen.w * 0.5, screen.h * 0.73);
  root.eventMode = "none";

  const shadow = new Graphics()
    .ellipse(0, 2, 46, 9)
    .fill({ color: 0x07152c, alpha: 0.42 });
  shadow.label = "piratePanicDanceShadow";
  root.addChild(shadow);

  const pirate = pointSprite(texture);
  pirate.label = "piratePanicDanceSprite";
  pirate.anchor.set(0.5, 1);
  const turtleScale = battle.game.gd.monsterByShortType(SHORT_TYPE).rendererData?.scale ?? 1;
  const baseScale = pirate.scale.x * turtleScale;
  pirate.scale.set(baseScale);
  root.addChild(pirate);

  const confetti = Array.from({ length: 12 }, (_, index) => {
    const piece = new Graphics()
      .rect(-1.5, -4, 3, 8)
      .fill({ color: CONFETTI_COLORS[index % CONFETTI_COLORS.length] });
    piece.label = `piratePanicConfetti:${index}`;
    piece.alpha = 0;
    root.addChild(piece);
    return piece;
  });

  battle.effectLayer.addChild(root);
  try {
    await tween(
      battle.stage.app.ticker,
      DANCE_MS,
      (t) => {
        if (root.destroyed) return;
        const beat = t * Math.PI * 8;
        const leap = Math.abs(Math.sin(beat));
        root.position.set(
          screen.w * 0.5 + Math.sin(beat * 0.5) * screen.w * 0.16 + Math.sin(beat * 1.5) * 9,
          screen.h * 0.73 - leap * screen.h * 0.105,
        );
        pirate.rotation = Math.sin(beat) * 0.28 + Math.sin(beat * 0.5) * 0.12;
        const squash = Math.cos(beat * 2) * 0.09;
        pirate.scale.set(baseScale * (1 + squash), baseScale * (1 - squash));
        shadow.alpha = 0.42 - leap * 0.22;
        shadow.scale.set(1 - leap * 0.35, 1 - leap * 0.12);
        for (const [index, piece] of confetti.entries()) {
          const launch = Math.max(0, t * 1.35 - index / confetti.length * 0.45);
          const angle = index * 2.399963229728653 + t * 5;
          const radius = 28 + 58 * Math.min(1, launch);
          piece.position.set(
            Math.cos(angle) * radius,
            -70 - Math.sin(angle) * 28 + 88 * launch * launch,
          );
          piece.rotation = angle * 1.8;
          piece.alpha = launch <= 0 ? 0 : Math.max(0, 1 - launch * 0.75);
        }
      },
      undefined,
      signal,
    );
  } finally {
    if (!root.destroyed) root.destroy({ children: true });
  }
}

// Remember an early tap until BattleNode reaches its status-finish wait. Calling advance during
// playTurn alone loses the acknowledgment because that waiter has not been installed yet.
const skipGateByStatus = new WeakMap();
function skipGateFor(battle) {
  const status = battle.statusText;
  const existing = skipGateByStatus.get(status);
  if (existing !== undefined) return existing;
  const gate = { pending: false };
  const restoreWait = dibMod.intercept(status, "waitForAcknowledgment", function (next, ...args) {
    const waiting = next(...args);
    if (gate.pending) {
      gate.pending = false;
      this.advance("manual");
    }
    return waiting;
  });
  const restoreClear = dibMod.intercept(status, "clearStatusText", function (next, ...args) {
    gate.pending = false;
    return next(...args);
  });
  battle.lifecycle?.signal.addEventListener("abort", () => {
    restoreWait();
    restoreClear();
    skipGateByStatus.delete(status);
  }, { once: true });
  skipGateByStatus.set(status, gate);
  return gate;
}

dibMod.intercept(BattleNode.prototype, "playTurn", async function (
  next, events, actorId, abilityPath, tier, activationMotion, slot, opts,
) {
  if (this.session.shortTypeOf(actorId) !== SHORT_TYPE || abilityPath !== DANCE_PATH) {
    return await next(events, actorId, abilityPath, tier, activationMotion, slot, opts);
  }

  const cycle = cycleByBattle.get(this) ?? createLineCycle();
  cycleByBattle.set(this, cycle);
  const line = takeLine(cycle);
  const turn = (presentationByBattle.get(this)?.turn ?? 0) + 1;
  const presentation = {
    phase: "loadingDialogue",
    turn,
    line: line.plain,
    markup: line.message,
    shake: line.shake,
    cycleCursor: cycle.cursor,
    cycleLength: cycle.order.length,
  };
  presentationByBattle.set(this, presentation);

  if (this.scene === undefined) {
    return await next(events, actorId, abilityPath, tier, "none", slot, opts);
  }
  const chat = await showGuildQuestChat({
    parent: this.scene,
    assets: this.game.assets,
    scale9: this.game.scale9,
    ticker: this.stage.app.ticker,
    message: line.message,
    portraitFile: "PirateMan.png",
  });
  if (this.lifecycle?.signal.aborted) {
    chat.dismiss(true);
    return;
  }
  // Only this mod's chat bypasses the native opening-fade guard. Use a completed tap so the
  // release that closes the dialogue cannot also skip the following dance.
  const dismissOnTap = (event) => {
    event.stopPropagation();
    chat.dismiss(true);
  };
  chat.root.on("pointertapcapture", dismissOnTap);
  presentationByBattle.set(this, { ...presentation, phase: "dialogue" });
  const shake = startScreenShake(this, line.shake);
  const dismissOnDispose = () => chat.dismiss(true);
  this.lifecycle?.signal.addEventListener("abort", dismissOnDispose, { once: true });
  try {
    await chat.closed;
  } finally {
    chat.root.off("pointertapcapture", dismissOnTap);
    this.lifecycle?.signal.removeEventListener("abort", dismissOnDispose);
    shake.stop();
    await shake.finished;
  }
  if (this.lifecycle?.signal.aborted) return;

  presentationByBattle.set(this, {
    phase: "dance",
    turn,
    line: line.plain,
    markup: line.message,
    shake: line.shake,
    cycleCursor: cycle.cursor,
    cycleLength: cycle.order.length,
  });
  // Suppress the stock enemy scale pulse: the package's full-size dance is this action's
  // activation motion. The normal zero-effect Dance transaction, TU, status text, and queue update
  // still run through BattleNode and BattleCore.
  const controller = new AbortController();
  const lifecycleSignal = this.lifecycle?.signal;
  const cancel = () => controller.abort();
  const gate = skipGateFor(this);
  const stage = this.stage.app.stage;
  const skip = (event) => {
    event.stopPropagation();
    gate.pending = true;
    controller.abort();
  };
  // Capture precedes the full-screen status box's swallowing handler. This also works while
  // the sprite is loading or the finish arrow is in its invisible blink phase.
  stage.on("pointertapcapture", skip);
  lifecycleSignal?.addEventListener("abort", cancel, { once: true });
  const unregisterDispose = dibMod.onDispose(cancel);
  try {
    await Promise.all([
      next(events, actorId, abilityPath, tier, "none", slot, opts),
      danceLikeABuffoon(this, controller.signal),
    ]);
  } finally {
    controller.abort();
    stage.off("pointertapcapture", skip);
    lifecycleSignal?.removeEventListener("abort", cancel);
    unregisterDispose();
  }
  const current = presentationByBattle.get(this);
  if (current?.turn === turn) presentationByBattle.set(this, { ...current, phase: "complete" });
});

// Runtime portrait: the selected archive's own PirateMan texture is cropped into the standard
// 48x48 monster atlas cell. No copy of the source PNG is written into this package.
let renderer;
dibMod.hooks.on("boot:ready", ({ value: boot }) => {
  renderer = boot.stage.app.renderer;
});

dibMod.intercept(AssetLibrary.prototype, "atlas", async function (next, name) {
  const sheet = await next(name);
  if (name !== PORTRAIT_ATLAS || sheet.textures[PORTRAIT_FRAME] !== undefined || renderer === undefined) {
    return sheet;
  }
  const source = await this.sprite(FIELD_SPRITE_NAME);
  const holder = new Container();
  const sprite = new Sprite(source);
  // The 309x370 HD source portrait's face/hat region maps into the game's native 48px icon cell.
  sprite.scale.set(0.28);
  sprite.position.set(-20.25, -13.75);
  holder.addChild(sprite);
  const portrait = RenderTexture.create({ width: 48, height: 48, antialias: true });
  renderer.render({ container: holder, target: portrait, clear: true });
  holder.destroy({ children: true });
  sheet.textures[PORTRAIT_FRAME] = portrait;
  dibMod.onDispose(() => portrait.destroy(true));
  return sheet;
});

dibMod.intercept(BattleNode.prototype, "renderGameState", function (next, ...args) {
  const rendered = next(...args);
  const state = presentationByBattle.get(this);
  return {
    ...rendered,
    codeMods: {
      ...(rendered.codeMods ?? {}),
      piratePanic: state === undefined ? null : { ...state },
    },
  };
});

dibMod.exports.monsterPath = MONSTER_PATH;
dibMod.exports.panicPath = PANIC_PATH;
dibMod.exports.shortType = SHORT_TYPE;
dibMod.exports.dancePath = DANCE_PATH;
dibMod.exports.tauntPriority = TAUNT_PRIORITY;
dibMod.exports.danceMs = DANCE_MS;
dibMod.exports.lines = PANIC_LINES;
dibMod.exports.shakeSpecs = SHAKE_SPECS;
dibMod.exports.shuffledLineOrder = shuffledLineOrder;
dibMod.exports.createLineCycle = createLineCycle;
dibMod.exports.takeLine = takeLine;
