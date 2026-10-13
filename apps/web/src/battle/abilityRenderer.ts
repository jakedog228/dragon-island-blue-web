































import { Container, Graphics, Sprite, type Ticker } from "pixi.js";
import { easeElasticOut, easeExponentialOut, shakenOffset, tween } from "../tween.js";
import type { GameData } from "@dib/gamedata/browser";
import type { BattleEvent } from "@dib/engine";
import { buildAnimation, makeTtfLabel, pointSprite, CONTENT_SCALE_FACTOR, type AssetLibrary } from "@dib/renderer";
import { resolveAnimation, type AnimationsData } from "@dib/renderer/animations";
import { sfxForTier } from "./preloadPlan.js";
import { monsterpediaHalfStarTexture } from "../world/monsterpediaCard.js";
import {
  effectPosition,
  rectFromCorners,
  effectAnimationLifetimeMs,
  resolveMeleeAttack,
  requireImplementedEffectBuilder,
  damageFloaterText,
  healFloaterText,
  parseCocosPoint,
  parseCocosRect,
  DAMAGE_FLOATER_COLOR,
  HEAL_FLOATER_COLOR,
  MESSAGE_DEFAULT_COLOR,
  LABEL_BIRTH_COLOR,
  FRAME_SLIDE_MS,
  FRAME_SLIDE_FADE_MS,
  floaterFontSizePt,
  floaterDistancePt,
  parameterFloaterPosition,
  effectTextPresentation,
  floaterAlphaAt,
  floaterLifetimeMs,
  CAPTURE_INITIAL_FLIGHT_MS,
  CAPTURE_SHAKE_MS,
  CAPTURE_FAILURE_ACTION_MS,
  CAPTURE_FAILURE_MOVE_MS,
  CAPTURE_SUCCESS_REVEAL_MS,
  CAPTURE_SUCCESS_LINGER_MS,
  captureCardStarRowPosition,
  MOTHER_FLY_MS,
  MOTHER_SCALE_MS,
  MOTHER_SCALE_PEAK,
  MOTHER_FLASH_MS,
  MOTHER_FLASH_COUNT,
  type Rect,
  type MeleeAttacksData,
  type MeleeAttackFrame,
} from "./abilityRendererMath.js";
import { imageEffectHoldMs, IMAGE_EFFECT_FADE_MS, buffTargetPhaseKey } from "./statusOverlayMath.js";
import { battleDebug } from "./debugLog.js";
import { SCREEN_H, SCREEN_W } from "./displayShared.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { SourcePointParticleSystem } from "../sourcePointParticleSystem.js";

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}














export interface TargetDisplayArea {
  /** The original `livingDisplayForLiving:` node, whose local origin is passed through
   *  `convertToWorldSpace:CGPointZero`. */
  node: Container;
  /** The node's authored Cocos `contentSize`. This deliberately excludes overflowing children. */
  width: number;
  height: number;
}

export interface TargetNodeLookup {
  displayAreaOf(id: string): TargetDisplayArea | null;
  /** Whether `target` is on the same team as `source` — needed for `buffAdded`'s phase-dict
   *  selection (status-effects.md §7 item 2 / `abilityRendererMath.ts`'s `buffTargetPhaseKey`):
   *  unlike `damageDealt`/`healed`, a buff carries no implicit team relationship from its event
   *  type alone (a buff can land on either team). Optional so existing lightweight test doubles
   *  that never exercise `buffAdded` keep compiling unchanged. */
  sameTeam?(source: string, target: string): boolean;
}

/** Source-faithful `convertToWorldSpace:CGPointZero` + `contentSize` rectangle, expressed in the
 * effect parent's local coordinates. Exported so the overflow-child regression is testable. */
export function targetContentRectInLayer(area: TargetDisplayArea, effectLayer: Container): Rect {
  const worldTl = area.node.toGlobal({ x: 0, y: 0 });
  const worldBr = area.node.toGlobal({ x: area.width, y: area.height });
  const tl = effectLayer.toLocal(worldTl);
  const br = effectLayer.toLocal(worldBr);
  return rectFromCorners(tl, br);
}

export interface RenderResultOpts {
  /** The ability whose `eventData` (`effectBuilders`/`meleeType`/`message`) and `soundTable` drive
   *  this call — mirrors the old `sequencer.ts`'s `use.abilityPath`. */
  abilityPath: string;
  /** Brace tier (`abilityArgs.ts`'s `braceTier`), used for both `Animations.json`'s per-tier
   *  sub-config (§3 point 1) and the tier-matched sfx table; `undefined` falls back to tier 1
   *  (matches the existing `sfxForTier`/`resolveAnimation` convention elsewhere in this battle UI). */
  tier: number | undefined;
  /** The `AttackAbilityComponent`'s stamped `meleeType` display parameter (engine ability.ts
   *  header point 2 / formulas.md row 35: the component stamps its `attackType` onto each damaged
   *  result, consumed by ParameterEffectBuilder branch 3 — effects-info.md §6). Resolved by the
   *  caller from the job-ability instance's `commonComponentArguments.attackType` (see
   *  `attackTypeForUse` in preloadPlan.ts). This is how plain attacks (no soundTable, no
   *  effectBuilders) get their animation + sound — previously missing entirely from this port,
   *  which left every basic attack silent and invisible. */
  meleeKey?: string;
  /** The job-ref instance's effective sound table (`soundTableForUse` in preloadPlan.ts —
   *  `-[UsableAbility _initWithName:dictionary:arguments:]` reads `soundTable` ARGUMENTS-FIRST,
   *  the job-ref table replacing the dictionary's outright). Absent (older callers/tests), the
   *  ability dictionary's own table is the correct no-override fallback. */
  soundTable?: Record<string, unknown>;
}

export interface AbilityRendererOpts {
  gameData: GameData;
  animations: AnimationsData;
  meleeAttacks: MeleeAttacksData;
  assets: AssetLibrary;
  audio: { playSfx(name: string): void };
  /** Effect nodes are added here (never into a target's own display node — every effect is
   *  independently positioned in world space per §1, not parented to what it's centered on). */
  effectLayer: Container;
  /** The shared presentation clock (see the clock-domain note above) — every effect lifetime
   *  and floater hold awaits ticker time, never `setTimeout`. */
  ticker: Ticker;
  /**
   * Native `CCParticleSystem.initParticle:` uses libc `random()`, not `arc4random()`. Keep this
   * separate from BattleNode's mechanics stream; the override is for deterministic particle tests.
   */
  particleRandom?: () => number;
  monsterNameOf?: (shortType: string) => string;
  highestCapturedLevelOf?: (shortType: string) => number;
  /** Localized string lookup for `stunned`'s "Stun" floater (status-effects.md §3: the
   *  ParameterEffectBuilder branch-4 `message`/`messageColor` pair `StunAbilityComponent`
   *  appends is a localized `"StunKey"` string, not a literal). Defaults to identity so tests that
   *  never exercise `stunned` keep compiling with plain keys. */
  localizedString?: (key: string) => string;
}








export class AbilityRenderer {
  private readonly gd: GameData;
  private readonly anims: AnimationsData;
  private readonly meleeAttacks: MeleeAttacksData;
  private readonly assets: AssetLibrary;
  private readonly audio: { playSfx(name: string): void };
  private readonly effectLayer: Container;
  private readonly ticker: Ticker;
  private readonly particleRandom: () => number;
  private readonly monsterNameOf: (shortType: string) => string;
  private readonly highestCapturedLevelOf: (shortType: string) => number;
  private readonly localizedString: (key: string) => string;
  /**
   * Cocos paints equal-z children in `addChild:` order. The source's
   * `addNodesForAbilityResult:parentNode:displayArea:` invokes authored effect builders first and
   * ParameterEffectBuilder last, all synchronously (effects-info.md §0/§6), so parameter text is
   * above the move art. Browser asset lookup is asynchronous, however: assigning paint order only
   * when a texture finishes loading reverses that relationship and can also reorder two authored
   * effect builders. Reserve the source-equivalent insertion order at DISPATCH time, before any
   * await, and map it to Pixi zIndex on the shared sortable effect layer.
   */
  private nextEffectPaintOrder = 0;
  /** Owns every asynchronous effect action for this battle scene. Pixi destroys transforms when
   * the scene is torn down, so allowing an old ticker callback to run afterward is both a leak and
   * a hard crash (`Cannot set properties of null`). */
  private readonly actions = new AbortController();

  private get active(): boolean {
    return !this.actions.signal.aborted && !this.effectLayer.destroyed;
  }

  /** Ticker-time sleep (see the clock-domain note at the top of this file). */
  private sleep(ms: number): Promise<void> {
    return ms <= 0
      ? Promise.resolve()
      : tween(this.ticker, ms, () => {}, (t) => t, this.actions.signal);
  }

  constructor(opts: AbilityRendererOpts) {
    this.gd = opts.gameData;
    this.anims = opts.animations;
    this.meleeAttacks = opts.meleeAttacks;
    this.assets = opts.assets;
    this.audio = opts.audio;
    this.effectLayer = opts.effectLayer;
    this.effectLayer.sortableChildren = true;
    // Damage labels and effect sprites can outlive a turn and overlap the next panel or picker.
    // Pixi's passive descendants still participate in a static scene's hit test: an effect hit
    // resolves to the scene and masks controls underneath. This entire layer is presentation only.
    this.effectLayer.eventMode = "none";
    this.ticker = opts.ticker;
    this.particleRandom = opts.particleRandom ?? Math.random;
    this.monsterNameOf = opts.monsterNameOf ?? ((shortType) => shortType);
    this.highestCapturedLevelOf = opts.highestCapturedLevelOf ?? (() => 0);
    this.localizedString = opts.localizedString ?? ((key) => key);
  }

  private reserveEffectPaintOrder(): number {
    const order = this.nextEffectPaintOrder;
    this.nextEffectPaintOrder += 1;
    return order;
  }

  private mountEffectNodes(
    paintOrder: number,
    ...nodes: Array<Container | Sprite | Graphics>
  ): boolean {
    if (!this.active) {
      for (const node of nodes) {
        if (!node.destroyed) node.destroy({ children: true });
      }
      return false;
    }
    for (const node of nodes) node.zIndex = paintOrder;
    this.effectLayer.addChild(...nodes);
    return true;
  }

  /** Cancels ticker listeners before the owning scene destroys its Pixi children. Idempotent. */
  dispose(): void {
    this.actions.abort();
  }

  /** `notifyAbilityTargetAlteredToMonster:` fires when the ability is queued, before impact. */
  async renderQueuedEffects(events: BattleEvent[], nodes: TargetNodeLookup): Promise<void> {
    if (!this.active) return;
    const pending: Promise<void>[] = [];
    for (const event of events) {
      if (event.type !== "targetAltered") continue;
      const displayArea = nodes.displayAreaOf(event.target);
      if (!displayArea) continue;
      pending.push(this.spawnFloater(
        this.localizedString("BlockedKey"),
        LABEL_BIRTH_COLOR,
        this.localRectOf(displayArea),
        0,
        "blocked",
        false,
      ));
    }
    await Promise.all(pending);
  }

  /** Source-phase effects fire at ability activation, before the target phase's 0.5s delay. */
  async renderSourceEffects(
    sourceId: string,
    nodes: TargetNodeLookup,
    opts: RenderResultOpts,
  ): Promise<void> {
    if (!this.active) return;
    const area = nodes.displayAreaOf(sourceId);
    if (!area) return;
    const ability = this.gd.ability(opts.abilityPath);
    const eventData = recordOf(ability.raw["eventData"]);
    const source = recordOf(eventData["sourceEventData"]);
    const rect = this.localRectOf(area);
    const pending: Promise<void>[] = [];
    for (const builder of this.effectBuildersOf(source)) {
      const kind = requireImplementedEffectBuilder(builder["class"], ability.path);
      if (kind === "AnimationEffectBuilder") {
        const name = builder["animationName"];
        if (typeof name !== "string") throw new Error(`AnimationEffectBuilder without name on ${ability.path}`);
        pending.push(this.spawnAnimationEffect(name, opts.tier, rect, typeof builder["offset"] === "string" ? builder["offset"] : undefined));
      } else if (kind === "ParticleEffectBuilder") {
        const file = builder["file"];
        if (typeof file !== "string") throw new Error(`ParticleEffectBuilder without file on ${ability.path}`);
        pending.push(this.spawnParticleEffect(file, rect));
      } else {
        throw new Error(`CaptureEffectBuilder is invalid in sourceEventData (${ability.path})`);
      }
    }
    for (const builder of this.globalEffectBuildersOf(source)) {
      const kind = requireImplementedEffectBuilder(builder["class"], ability.path);
      if (kind !== "ParticleEffectBuilder") {
        throw new Error(`${kind} is unsupported in globalEffectBuilders on ${ability.path}`);
      }
      const file = builder["file"];
      if (typeof file !== "string") throw new Error(`ParticleEffectBuilder without file on ${ability.path}`);
      pending.push(this.spawnParticleEffect(file, { x: 0, y: 0, width: SCREEN_W, height: SCREEN_H }));
    }
    await Promise.all(pending);
  }






















  async renderResult(events: BattleEvent[], nodes: TargetNodeLookup, opts: RenderResultOpts): Promise<void> {
    if (!this.active) return;
    const ability = this.gd.ability(opts.abilityPath);
    const eventData = recordOf(ability.raw["eventData"]);
    const soundTable = opts.soundTable ?? recordOf(ability.raw["soundTable"]);
    const sfxFile = sfxForTier(soundTable, opts.tier);
    battleDebug(
      "render",
      `renderResult ${ability.path}: builders friends=${this.effectBuildersOf(recordOf(eventData["friendlyTargetEventData"])).length}` +
        ` enemy=${this.effectBuildersOf(recordOf(eventData["enemyTargetEventData"])).length}` +
        ` sfx=${sfxFile ?? "none"} melee=${opts.meleeKey ?? "none"}`,
    );
    let sfxPlayed = false;
    const pending: Promise<void>[] = [];
    const rowsByTarget = new Map<string, number>();
    const takeRow = (target: string): number => {
      const row = rowsByTarget.get(target) ?? 0;
      rowsByTarget.set(target, row + 1);
      return row;
    };
    // Targets that already got a phase-specific flash this call -- `phaseResolved`'s generic
    // fallback (below) must skip any of these, never double-render the same phase's
    // effectBuilders twice (engine ability.ts's `notifyPhaseResolved` doc comment).
    const renderedTargets = new Set<string>();












    const deferredMessageFloaters = new Map<
      string,
      Array<{ text: string; color: number; rect: Rect; row: number }>
    >();
    const flushDeferredMessageFloaters = (target: string): void => {
      const floaters = deferredMessageFloaters.get(target);
      if (!floaters) return;
      deferredMessageFloaters.delete(target);
      for (const floater of floaters) {
        pending.push(this.spawnFloater(
          floater.text,
          floater.color,
          floater.rect,
          floater.row,
          "message",
        ));
      }
    };
    /** Immediate when the target already flashed this call, deferred behind its builders otherwise. */
    const queueMessageFloater = (
      text: string,
      color: number,
      target: string,
      rect: Rect,
      row: number,
    ): void => {
      if (renderedTargets.has(target)) {
        pending.push(this.spawnFloater(text, color, rect, row, "message"));
        return;
      }
      const floaters = deferredMessageFloaters.get(target) ?? [];
      floaters.push({ text, color, rect, row });
      deferredMessageFloaters.set(target, floaters);
    };
















    for (const e of events) {
      if (e.type === "buffTriggered") {
        // status-effects.md §4: the flash is built from the BUFF's OWN sourceEventData (Buffs.json),
        // not the current ability's eventData. `living` is the wearer reacting to damage it took.
        const displayArea = nodes.displayAreaOf(e.living);
        if (!displayArea) continue;
        const rect = this.localRectOf(displayArea);
        const buff = this.gd.buff(e.buffType);
        const sourceDict = recordOf(recordOf(buff.raw["eventData"])["sourceEventData"]);
        for (const b of this.effectBuildersOf(sourceDict)) {
          const kind = requireImplementedEffectBuilder(b["class"], buff.path);
          if (kind === "ImageEffectBuilder") {
            pending.push(this.spawnImageEffectFromData(b, rect, buff.path));
          } else if (kind === "AnimationEffectBuilder") {
            const name = b["animationName"];
            if (typeof name !== "string") {
              throw new Error(`AnimationEffectBuilder entry without animationName on buff ${buff.path}`);
            }
            const offset = typeof b["offset"] === "string" ? b["offset"] : undefined;
            pending.push(this.spawnAnimationEffect(name, opts.tier, rect, offset));
          } else {
            throw new Error(`${kind} is unsupported for buffTriggered on ${buff.path}`);
          }
        }
      } else if (e.type === "damageDealt" && e.cause === "reflected") {
















        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;
        pending.push(this.spawnFloater(
          damageFloaterText(e.amount),
          DAMAGE_FLOATER_COLOR,
          this.localRectOf(displayArea),
          0,
          "numeric",
        ));
      } else if (e.type === "stunned" && e.reactive) {
        // StunProcBuff: same "StunKey"/white AbilityResult as a direct stun, but its own inline
        // dispatch — so it reserves a slot here, under the ability's damage number, at row 0.
        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;
        pending.push(this.spawnFloater(
          this.localizedString("StunKey"),
          MESSAGE_DEFAULT_COLOR,
          this.localRectOf(displayArea),
          0,
          "message",
        ));
      }
    }

    for (const e of events) {
      if (e.type === "captureResolved") {
        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;
        renderedTargets.add(e.target);
        const rect = this.localRectOf(displayArea);
        const phaseDict = recordOf(eventData["enemyTargetEventData"]);
        for (const builder of this.effectBuildersOf(phaseDict)) {
          const kind = requireImplementedEffectBuilder(builder["class"], ability.path);
          if (kind !== "CaptureEffectBuilder") {
            throw new Error(`${kind} is unexpected in Utility.Capture enemyTargetEventData`);
          }
          pending.push(this.spawnCaptureEffect(e.target, e.success, rect));
        }
        continue;
      }
      if (e.type === "buffAdded") {





        if (e.cause !== undefined) {
          battleDebug("render", `skip buffAdded ${e.buffType} on ${e.target}: collateral (cause=${e.cause}), no cast flash`);
          continue;
        }
        // status-effects.md §7 item 2: dispatch the CURRENT ability's own eventData exactly like
        // damageDealt/healed already do (same spawnAnimationEffect/floater/sound machinery) --
        // this is the Hypnosis-style "cast flash" half of a status ability; the SEPARATE
        // persistent overlay (Zzz/bolts/particles) is battleNode.ts's status-overlay subsystem,
        // driven from this same event stream but NOT this class's concern.
        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;
        renderedTargets.add(e.target);
        if (sfxFile && !sfxPlayed) {
          sfxPlayed = true;
          this.audio.playSfx(sfxFile);
        }
        const rect = this.localRectOf(displayArea);
        // Unlike damageDealt (always enemy)/healed (always friendly), a buff carries no implicit
        // team from its event type alone -- resolve the real relationship (self-buffs count as
        // same-team without needing the lookup).
        const sameTeam = e.source === e.target ? true : (nodes.sameTeam?.(e.source, e.target) ?? true);
        const phaseDict = recordOf(eventData[buffTargetPhaseKey(sameTeam)]);
        // hideBlood (status-effects.md §5: declared true on every non-damage ability, never
        // false) is a no-op here -- this renderer has no blood-splatter visual to suppress.
        for (const b of this.effectBuildersOf(phaseDict)) {
          const kind = requireImplementedEffectBuilder(b["class"], ability.path);
          if (kind === "AnimationEffectBuilder") {
            const name = b["animationName"];
            if (typeof name !== "string") {
              throw new Error(`AnimationEffectBuilder entry without animationName on ${ability.path}`);
            }
            const offset = typeof b["offset"] === "string" ? b["offset"] : undefined;
            pending.push(this.spawnAnimationEffect(name, opts.tier, rect, offset));
          } else if (kind === "ImageEffectBuilder") {
            pending.push(this.spawnImageEffectFromData(b, rect, ability.path));
          } else if (kind === "ParticleEffectBuilder") {
            const file = b["file"];
            if (typeof file !== "string") {
              throw new Error(`ParticleEffectBuilder entry without file on ${ability.path}`);
            }
            pending.push(this.spawnParticleEffect(file, rect));
          } else {
            throw new Error(`${kind} is unsupported for buffAdded on ${ability.path}`);
          }
        }
        continue;
      }
      if (e.type === "buffRemoved") {

















        if (e.reason !== "removed") {
          battleDebug("render", `skip buffRemoved ${e.buffType} on ${e.target}: reason=${e.reason} is not this cast's doing`);
          continue;
        }
        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;
        if (renderedTargets.has(e.target)) continue;
        renderedTargets.add(e.target);
        if (sfxFile && !sfxPlayed) {
          sfxPlayed = true;
          this.audio.playSfx(sfxFile);
        }
        const rect = this.localRectOf(displayArea);
        const builders = [
          ...this.effectBuildersOf(recordOf(eventData["friendlyTargetEventData"])),
          ...this.effectBuildersOf(recordOf(eventData["enemyTargetEventData"])),
        ];
        for (const b of builders) {
          const kind = requireImplementedEffectBuilder(b["class"], ability.path);
          if (kind !== "AnimationEffectBuilder") {
            throw new Error(`${kind} is unsupported for buffRemoved on ${ability.path}`);
          }
          const name = b["animationName"];
          if (typeof name !== "string") {
            throw new Error(`AnimationEffectBuilder entry without animationName on ${ability.path}`);
          }
          const offset = typeof b["offset"] === "string" ? b["offset"] : undefined;
          pending.push(this.spawnAnimationEffect(name, opts.tier, rect, offset));
        }
        continue;
      }
      if (e.type === "movedToFront") {
        // MoveToFrontAbilityComponent's friendlyTargetEventData (Utility.MoveToFront "Pass":
        // "DefenseResistUp" on the moved target) had no dispatch branch either -- its OWN
        // sourceEventData ("DefenseResistDown") already rendered fine via renderSourceEffects
        // (unconditional, no event needed), which is why only the TARGET's flash was missing.
        // Mirrors buffAdded's same-team phase-key resolution (movedToFront does carry `source`).
        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;
        renderedTargets.add(e.target);
        if (sfxFile && !sfxPlayed) {
          sfxPlayed = true;
          this.audio.playSfx(sfxFile);
        }
        const rect = this.localRectOf(displayArea);
        const sameTeam = e.source === e.target ? true : (nodes.sameTeam?.(e.source, e.target) ?? true);
        const phaseDict = recordOf(eventData[buffTargetPhaseKey(sameTeam)]);
        for (const b of this.effectBuildersOf(phaseDict)) {
          const kind = requireImplementedEffectBuilder(b["class"], ability.path);
          if (kind !== "AnimationEffectBuilder") {
            throw new Error(`${kind} is unsupported for movedToFront on ${ability.path}`);
          }
          const name = b["animationName"];
          if (typeof name !== "string") {
            throw new Error(`AnimationEffectBuilder entry without animationName on ${ability.path}`);
          }
          const offset = typeof b["offset"] === "string" ? b["offset"] : undefined;
          pending.push(this.spawnAnimationEffect(name, opts.tier, rect, offset));
        }
        continue;
      }
      if (e.type === "stunned") {
        // A reactive (StunProcBuff) stun already reserved its below-the-move-art slot in the
        // pre-pass; only DIRECT StunAbilityComponent stuns are handled here.
        if (e.reactive) continue;







        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;
        const rect = this.localRectOf(displayArea);
        const row = takeRow(e.target);
        queueMessageFloater(this.localizedString("StunKey"), MESSAGE_DEFAULT_COLOR, e.target, rect, row);
        continue;
      }
      if (e.type === "effectText") {
        const displayArea = nodes.displayAreaOf(e.target);
        if (!displayArea) continue;




















        const presentation = effectTextPresentation(e.effect, this.localizedString);
        const row = takeRow(e.target);
        if (e.effect.kind === "miss") {
          // Same paint-order rule as STUN!: builders first, message above them.
          queueMessageFloater(
            presentation.text,
            presentation.color,
            e.target,
            this.localRectOf(displayArea),
            row,
          );
          continue;
        }
        pending.push(this.spawnFloater(
          presentation.text,
          presentation.color,
          this.localRectOf(displayArea),
          row,
          "message",
        ));
        continue;
      }
      if (e.type === "deathSentence") {
        // status-effects.md §3: DeathSentenceBuff's expiry kill has NO visual trigger of its own
        // (a silent timer) -- the `died` event it produces is rendered by the team displays'
        // notifyDied, not this class. Explicitly acknowledged rather than silently falling
        // through, so a future reader knows this was considered, not missed.
        continue;
      }
      // `buffTriggered` (reactive thorns) is rendered entirely in the reactive pre-pass above, so
      // it paints UNDER this cast's own results; it is intentionally absent here and falls through
      // to the terminal non-damage/heal `continue` if it ever reaches this loop.
      if (e.type === "phaseResolved") {










        const key = e.phase === "friends" ? "friendlyTargetEventData" : "enemyTargetEventData";
        const builders = this.effectBuildersOf(recordOf(eventData[key]));






        const whiffMeleeKey = e.phase === "enemy" ? opts.meleeKey : undefined;
        if (builders.length === 0 && whiffMeleeKey === undefined && e.targets.every(
          (targetId) => !deferredMessageFloaters.has(targetId),
        )) {
          battleDebug("render", `phaseResolved ${e.phase}: no declared builders/melee — nothing to render (targets: ${e.targets.join(", ")})`);
          continue;
        }
        for (const targetId of e.targets) {
          if (renderedTargets.has(targetId)) {
            battleDebug("render", `phaseResolved ${e.phase}: ${targetId} already flashed by a specific event this cast`);
            flushDeferredMessageFloaters(targetId);
            continue;
          }
          battleDebug("render", `phaseResolved ${e.phase}: fallback flash on ${targetId} (${builders.length} builders${whiffMeleeKey !== undefined ? `, whiff melee ${whiffMeleeKey}` : ""})`);
          renderedTargets.add(targetId);
          const displayArea = nodes.displayAreaOf(targetId);
          if (!displayArea) {
            flushDeferredMessageFloaters(targetId);
            continue; // e.g. Switch's outgoing monster if its removal ever races ahead
          }
          if (sfxFile && !sfxPlayed) {
            sfxPlayed = true;
            this.audio.playSfx(sfxFile);
          }
          const rect = this.localRectOf(displayArea);
          for (const b of builders) {
            const kind = requireImplementedEffectBuilder(b["class"], ability.path);
            if (kind === "AnimationEffectBuilder") {
              const name = b["animationName"];
              if (typeof name !== "string") {
                throw new Error(`AnimationEffectBuilder entry without animationName on ${ability.path}`);
              }
              const offset = typeof b["offset"] === "string" ? b["offset"] : undefined;
              pending.push(this.spawnAnimationEffect(name, opts.tier, rect, offset));
            } else if (kind === "ImageEffectBuilder") {
              pending.push(this.spawnImageEffectFromData(b, rect, ability.path));
            } else if (kind === "ParticleEffectBuilder") {
              const file = b["file"];
              if (typeof file !== "string") {
                throw new Error(`ParticleEffectBuilder entry without file on ${ability.path}`);
              }
              pending.push(this.spawnParticleEffect(file, rect));
            } else {
              throw new Error(`${kind} is unsupported for phaseResolved on ${ability.path}`);
            }
          }
          if (whiffMeleeKey !== undefined) {
            pending.push(this.spawnMeleeEffect(whiffMeleeKey, opts.tier, rect));
          }
          flushDeferredMessageFloaters(targetId);
        }
        continue;
      }
      // silverSpent has no dedicated visual (no real ability declares effectBuilders keyed to
      // it). movedToFront/buffRemoved are handled above; buffTriggered and reactive stunned in the
      // pre-pass. targetAltered was already rendered by renderQueuedEffects at queue time, before
      // the target phase delay.
      if (e.type !== "damageDealt" && e.type !== "healed") continue;
      const displayArea = nodes.displayAreaOf(e.target);
      if (!displayArea) continue; // stale/already-removed target -- not a fidelity bug, see TargetNodeLookup's doc
      if (e.cause !== undefined) {





















        battleDebug("render", `collateral ${e.type} on ${e.target} (cause=${e.cause}): no floater here`);
        continue;
      }
      renderedTargets.add(e.target);
      battleDebug("render", `${e.type} on ${e.target}: full treatment (flash + floater${sfxFile && !sfxPlayed ? " + sfx" : ""})`);

      // sfxFile undefined (no tier entry) is a legitimate "this ability has no sound" case, not an
      // error -- AudioPlayer.playSfx itself throws loudly on a preload-plan gap (an sfxFile that
      // was never preloaded), matching the old sequencer's own comment at this exact call site.
      if (sfxFile && !sfxPlayed) {
        sfxPlayed = true;
        this.audio.playSfx(sfxFile);
      }

      const rect = this.localRectOf(displayArea);
      const phaseDict = this.phaseDictFor(eventData, e.type);

      for (const b of this.effectBuildersOf(phaseDict)) {
        // Builder classes are phase-specific. Ordinary damage/heal results accept animation
        // builders here, plus Mother (the four `*Mother` abilities declare it ALONGSIDE their
        // AnimationEffectBuilder in the same enemyTargetEventData array — both run together,
        // status-effects.md §5); Particle is handled on sourceEventData and Capture on
        // captureResolved. Never silently reinterpret a builder attached to the wrong phase.
        const kind = requireImplementedEffectBuilder(b["class"], ability.path);
        if (kind === "MotherEffectBuilder") {
          const spriteFile = b["spriteFile"];
          if (typeof spriteFile !== "string") {
            throw new Error(`MotherEffectBuilder entry without spriteFile on ${ability.path}`);
          }
          pending.push(this.spawnMotherEffect(spriteFile, rect));
          continue;
        }
        if (kind === "ParticleEffectBuilder") {
          const file = b["file"];
          if (typeof file !== "string") {
            throw new Error(`ParticleEffectBuilder entry without file on ${ability.path}`);
          }
          pending.push(this.spawnParticleEffect(file, rect));
          continue;
        }
        if (kind !== "AnimationEffectBuilder") {
          throw new Error(`${kind} is unsupported for ${e.type} on ${ability.path}`);
        }
        const name = b["animationName"];
        if (typeof name !== "string") {
          throw new Error(`AnimationEffectBuilder entry without animationName on ${ability.path}`);
        }
        const offset = typeof b["offset"] === "string" ? b["offset"] : undefined;
        pending.push(this.spawnAnimationEffect(name, opts.tier, rect, offset));
      }

      // The stamped meleeType (opts.meleeKey — AttackAbilityComponent stamps its attackType onto
      // every DAMAGED result, formulas.md row 35) and/or a literal `meleeType` eventData key
      // (none in the real corpus, kept for completeness). Damage events only — the stamp rides
      // the attack component's own results.
      const meleeTypeKey = phaseDict?.["meleeType"];
      if (typeof meleeTypeKey === "string") {
        pending.push(this.spawnMeleeEffect(meleeTypeKey, opts.tier, rect));
      } else if (opts.meleeKey !== undefined && e.type === "damageDealt") {
        pending.push(this.spawnMeleeEffect(opts.meleeKey, opts.tier, rect));
      }

      const isHeal = e.type === "healed";
      const text = isHeal ? healFloaterText(e.amount) : damageFloaterText(e.amount);
      const color = isHeal ? HEAL_FLOATER_COLOR : DAMAGE_FLOATER_COLOR;
      const row = takeRow(e.target);











      pending.push(this.spawnFloater(text, color, rect, row, "numeric"));
    }

    // Defensive fallback for a stale/unmapped additive phase event. The source never drops the
    // ParameterEffectBuilder text merely because a later visual callback is absent.
    for (const target of [...deferredMessageFloaters.keys()]) flushDeferredMessageFloaters(target);

    await Promise.all(pending);
  }













  private async spawnMotherEffect(spriteFile: string, rect: Rect): Promise<void> {
    const paintOrder = this.reserveEffectPaintOrder();
    const base = spriteFile.replace(/\.png$/, "");
    const texture = await this.assets.sprite(`${base}-hd`);
    if (!this.active) return;
    const sprite = pointSprite(texture);
    sprite.label = `mother:${base}`;
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(SCREEN_W / 2, SCREEN_H / 2);
    const baseScaleX = sprite.scale.x;
    const baseScaleY = sprite.scale.y;
    if (!this.mountEffectNodes(paintOrder, sprite)) return;

    const from = { x: SCREEN_W / 2, y: SCREEN_H / 2 };
    const to = effectPosition(rect);
    await Promise.all([
      tween(this.ticker, MOTHER_FLY_MS, (t) => {
        if (sprite.destroyed) return;
        const e = easeExponentialOut(t);
        sprite.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
      }, (t) => t, this.actions.signal),
      tween(this.ticker, MOTHER_SCALE_MS, (t) => {
        if (sprite.destroyed) return;
        const s = 1 + (MOTHER_SCALE_PEAK - 1) * t;
        sprite.scale.set(baseScaleX * s, baseScaleY * s);
      }, (t) => t, this.actions.signal),
    ]);
    if (!this.active || sprite.destroyed) return;
    await tween(this.ticker, MOTHER_FLASH_MS, (t) => {
      if (sprite.destroyed) return;
      // MOTHER_FLASH_COUNT full pulses across the window: alpha dips to 0.4 mid-pulse.
      const phase = (t * MOTHER_FLASH_COUNT) % 1;
      sprite.alpha = 1 - 0.6 * Math.sin(phase * Math.PI);
    }, (t) => t, this.actions.signal);
    if (!this.active || sprite.destroyed) return;
    if (!sprite.destroyed) sprite.alpha = 1;
    await tween(this.ticker, MOTHER_SCALE_MS, (t) => {
      if (sprite.destroyed) return;
      const s = MOTHER_SCALE_PEAK + (1 - MOTHER_SCALE_PEAK) * t;
      sprite.scale.set(baseScaleX * s, baseScaleY * s);
    }, (t) => t, this.actions.signal);
    if (!this.active) return;
    if (!sprite.destroyed) sprite.destroy();
  }


  private async spawnCaptureEffect(targetId: string, success: boolean, rect: Rect): Promise<void> {
    const paintOrder = this.reserveEffectPaintOrder();
    const shortType = targetId.split(":").at(-1);
    if (!shortType) throw new Error(`CaptureEffectBuilder: malformed living id ${targetId}`);
    const monster = this.gd.monsterByShortType(shortType);
    const atlas = await this.assets.atlas("MonsterpediaFrames-hd");
    const general = await this.assets.atlas("General-hd");
    if (!this.active) return;
    const cardIndex = Math.floor(monster.stars) > 8 ? 3 : Math.floor(monster.stars) > 4 ? 2 : 1;
    const frameTexture = atlas.textures[`monsterCard${cardIndex}.png`];
    const starTexture = atlas.textures["rarityStar.png"];
    const highestTexture = atlas.textures["highestLevel.png"];
    const evolveTexture = atlas.textures["evolveChain.png"];
    const elementTexture = general.textures[`Element${monster.element}.png`];
    if (!frameTexture || !starTexture || !highestTexture || !evolveTexture || !elementTexture) {
      throw new Error(`CaptureEffectBuilder: MonsterCardNode frames missing for ${shortType}`);
    }

    const card = new Container();
    card.label = "captureMonsterCard";
    const frame = pointSprite(frameTexture);
    frame.label = "captureMonsterCardFrame";
    card.addChild(frame);
    const details = new Container();
    details.label = "captureMonsterCardDetails";
    details.alpha = 0;
    card.addChild(details);

    const portraitTexture = await this.assets.sprite(`${shortType}-hd`);
    if (!this.active) {
      card.destroy({ children: true });
      return;
    }
    const portrait = pointSprite(portraitTexture);
    portrait.anchor.set(0.5);
    const rendererScale = recordOf(monster.rendererData)["scale"];
    const sourceScale = typeof rendererScale === "number" ? rendererScale : 1;
    portrait.scale.set(portrait.scale.x * sourceScale, portrait.scale.y * sourceScale);


    const fit = Math.min(1, 103 / portrait.width, 73 / portrait.height);
    portrait.scale.set(portrait.scale.x * fit, portrait.scale.y * fit);
    portrait.position.set(60.5, frame.height - 93.5);
    details.addChild(portrait);

    const name = makeTtfLabel(this.monsterNameOf(shortType), 12, { fill: 0x000000, outline: false });
    // Source anchor (0.5,0) in Cocos -> (0.5,1) in Pixi's Y-down frame.
    name.anchor.set(0.5, 1);
    name.position.set(60, frame.height - 128);
    details.addChild(name);

    const starRow = new Container();
    const starCount = Math.floor(monster.stars);
    for (let i = 0; i < starCount; i++) {
      const star = pointSprite(starTexture);
      star.label = "captureMonsterCardFullStar";
      star.position.x = i * star.width;
      starRow.addChild(star);
    }
    if (monster.stars % 1 !== 0) {
      const star = pointSprite(monsterpediaHalfStarTexture(starTexture));
      star.label = "captureMonsterCardHalfStar";
      star.position.x = starCount * (starTexture.width / CONTENT_SCALE_FACTOR);
      starRow.addChild(star);
    }
    const starRowPosition = captureCardStarRowPosition(
      frame.width,
      frame.height,
      starRow.width,
      starRow.height,
    );
    starRow.position.set(starRowPosition.x, starRowPosition.y);
    details.addChild(starRow);

    const highest = pointSprite(highestTexture);

    highest.anchor.set(0.5, 0.7);
    highest.position.set(26, frame.height - 16);
    details.addChild(highest);
    const level = makeTtfLabel(String(this.highestCapturedLevelOf(shortType)), 16, { fill: 0x000000, outline: false });
    level.anchor.set(0.5);

    level.position.set(26, frame.height - 19);
    details.addChild(level);
    const element = pointSprite(elementTexture);
    element.anchor.set(0.5);
    element.position.set(59, frame.height - 20);
    details.addChild(element);
    const belongsToEvolveChain = monster.evolveData !== undefined || this.gd.allMonsters().some(
      (candidate) => candidate.evolveData?.newType === shortType,
    );
    if (belongsToEvolveChain) {
      const evolve = pointSprite(evolveTexture);
      evolve.anchor.set(0.5);
      evolve.position.set(83, frame.height - 25);
      details.addChild(evolve);
    }


    const index = makeTtfLabel(String(this.gd.monsterBookIndex(shortType)), 16, {
      fill: 0x000000,
      outline: false,
    });
    index.anchor.set(0.5);
    index.position.set(101, frame.height - 16);
    details.addChild(index);

    card.pivot.set(frame.width / 2, frame.height / 2);
    const screenCenter = { x: SCREEN_W * 0.5, y: SCREEN_H * 0.5 };
    card.position.set(screenCenter.x, screenCenter.y);
    card.scale.set(0.1);
    if (!this.mountEffectNodes(paintOrder, card)) return;

    const target = effectPosition(rect);
    const firstRotation = Math.PI * 16; // +2880 degrees
    await tween(this.ticker, CAPTURE_INITIAL_FLIGHT_MS, (t) => {
      card.position.set(
        screenCenter.x + (target.x - screenCenter.x) * t,
        screenCenter.y + (target.y - screenCenter.y) * t,
      );
      card.rotation = firstRotation * t;
      card.scale.set(0.1 + 0.9 * t);
    }, easeExponentialOut, this.actions.signal);
    if (!this.active || card.destroyed) return;

    const base = { x: card.position.x, y: card.position.y };
    await tween(this.ticker, CAPTURE_SHAKE_MS, (t) => {
      const d = shakenOffset(easeElasticOut(t, 0.1), 6);
      card.position.set(base.x + d, base.y - d);
    }, (t) => t, this.actions.signal);
    if (!this.active || card.destroyed) return;
    card.position.set(base.x, base.y);

    if (success) {
      await tween(
        this.ticker,
        CAPTURE_SUCCESS_REVEAL_MS,
        (t) => (details.alpha = t),
        (t) => t,
        this.actions.signal,
      );
      if (!this.active || card.destroyed) return;
      this.audio.playSfx("CaptureSuccess");
      await this.sleep(CAPTURE_SUCCESS_LINGER_MS);
      if (!this.active || card.destroyed) return;
    } else {
      const from = { x: card.position.x, y: card.position.y, rotation: card.rotation };
      await tween(this.ticker, CAPTURE_FAILURE_ACTION_MS, (t) => {
        const moveT = Math.min(1, t / (CAPTURE_FAILURE_MOVE_MS / CAPTURE_FAILURE_ACTION_MS));
        card.position.set(
          from.x + (SCREEN_W * 1.5 - from.x) * moveT,
          from.y + (SCREEN_H * -0.5 - from.y) * moveT,
        );
        card.scale.set(1 + 2 * t);
        card.rotation = from.rotation + Math.PI * 16 * t;
      }, easeExponentialOut, this.actions.signal);
      if (!this.active || card.destroyed) return;
      this.audio.playSfx("CaptureFail");
    }
    if (!card.destroyed) card.destroy({ children: true });
  }

  /** Source `ParticleEffectBuilder`: one auto-removing CCParticleSystemPoint at the authored rect. */
  private async spawnParticleEffect(
    file: string,
    rect: Rect,
    position: Readonly<{ x: number; y: number }> = effectPosition(rect),
  ): Promise<void> {
    const paintOrder = this.reserveEffectPaintOrder();
    const asset = await this.assets.particle(file);
    if (!this.active) return;
    const emitter = new SourcePointParticleSystem({
      asset,
      configName: file,
      mode: DISPLAY_MODE,
      ticker: this.ticker,
      autoRemoveOnFinish: true,
      rand: this.particleRandom,
    });
    emitter.position.set(position.x, position.y);
    if (!this.mountEffectNodes(paintOrder, emitter)) return;
    emitter.start();
    await emitter.completion;
  }










  private localRectOf(area: TargetDisplayArea): Rect {
    return targetContentRectInLayer(area, this.effectLayer);
  }

  /** enemy/friendly split per event type (a damage event's parameters live in
   *  `enemyTargetEventData`, a heal event's in `friendlyTargetEventData` — `formulas.md` row 34's
   *  finding that real abilities populate exactly one of the two applies here too). */
  private phaseDictFor(
    eventData: Record<string, unknown>,
    eventType: "damageDealt" | "healed",
  ): Record<string, unknown> | undefined {
    const key = eventType === "healed" ? "friendlyTargetEventData" : "enemyTargetEventData";
    const dict = eventData[key];
    return dict !== undefined ? recordOf(dict) : undefined;
  }

  private effectBuildersOf(phaseDict: Record<string, unknown> | undefined): Record<string, unknown>[] {
    const builders = phaseDict?.["effectBuilders"];
    if (!Array.isArray(builders)) return [];
    return builders.map(recordOf);
  }

  private globalEffectBuildersOf(phaseDict: Record<string, unknown> | undefined): Record<string, unknown>[] {
    const builders = phaseDict?.["globalEffectBuilders"];
    if (!Array.isArray(builders)) return [];
    return builders.map(recordOf);
  }





  private async spawnAnimationEffect(
    name: string,
    tier: number | undefined,
    rect: Rect,
    offset: string | undefined,
  ): Promise<void> {
    const paintOrder = this.reserveEffectPaintOrder();
    const { entry } = resolveAnimation(this.anims, name, tier ?? 1);
    const sheets = await Promise.all(entry.spritesheets.map((s) => this.assets.atlas(`${s}-hd`)));
    if (!this.active) return;
    const anim = buildAnimation(entry, sheets);
    anim.label = `animation:${name}`;
    anim.scale.set(1 / CONTENT_SCALE_FACTOR); // pointSprite.ts's fold -- see this file's header
    const pos = effectPosition(rect, offset);
    anim.position.set(pos.x, pos.y);
    if (!this.mountEffectNodes(paintOrder, anim)) return;
    anim.play();
    await this.sleep(effectAnimationLifetimeMs(entry.numFrames, entry.fps));
    if (!this.active || anim.destroyed) return;
    anim.destroy();
  }












  private async spawnMeleeEffect(key: string, tier: number | undefined, rect: Rect): Promise<void> {
    const entry = resolveMeleeAttack(this.meleeAttacks, key);
    this.audio.playSfx(entry.soundFile);
    if (entry.type === "animation") {
      if (!entry.effectData) throw new Error(`MeleeAttacks["${key}"]: type "animation" without effectData`);
      await this.spawnAnimationEffect(entry.effectData.animationName, tier, rect, entry.effectData.offset);
    } else if (entry.type === "frameSlide") {
      if (!entry.frames || entry.frames.length === 0) {
        throw new Error(`MeleeAttacks["${key}"]: type "frameSlide" without frames`);
      }
      await this.spawnFrameSlide(entry.frames, rect);
    } else {
      throw new Error(`unknown melee attack type: "${entry.type}" (MeleeAttacks["${key}"])`);
    }
  }

  /**
   * frameSlide (§6 branch 3b): per `frames[]` element, shows `spriteFrameName` (FXSheet-hd)
   * scaled by `scaleValues`, revealed by animating a rectangular mask from `relativeStart` to
   * `relativeEnd` (both `"{{x,y},{w,h}}"` fractions of the frame's own size — the
   * `TextureRectSlideAction` relative params), centered on the target rect, with Hide/Show
   * bookends between elements (CCSequence). Raw ARM gives 250ms per texture slide, then one
   * 200ms FadeAndRemoveAction after the complete concatenated sequence.
   */
  private async spawnFrameSlide(frames: readonly MeleeAttackFrame[], rect: Rect): Promise<void> {
    const paintOrder = this.reserveEffectPaintOrder();
    const sheet = await this.assets.atlas("FXSheet-hd");
    if (!this.active) return;
    const mid = effectPosition(rect);
    const firstTexture = sheet.textures[frames[0]!.spriteFrameName];
    if (!firstTexture) throw new Error(`FXSheet-hd atlas is missing frameSlide frame ${frames[0]!.spriteFrameName}`);
    // The original allocates one initially-hidden CCSprite and changes its frame/scale/place/
    // anchor for each concatenated sequence element. Keep one Pixi Sprite and one mask likewise.
    const sprite = pointSprite(firstTexture);
    sprite.label = `melee:${frames.map((frame) => frame.spriteFrameName).join("+")}`;
    sprite.anchor.set(0.5, 0.5);
    sprite.position.set(mid.x, mid.y);
    const mask = new Graphics();
    mask.label = "melee-mask";
    sprite.mask = mask;
    // The mask is a Pixi implementation detail for the source's TextureRectSlideAction. Give it
    // the same reserved order as the visible sprite so it cannot split the source paint sequence.
    if (!this.mountEffectNodes(paintOrder, sprite, mask)) return;

    for (const f of frames) {
      if (!this.active || sprite.destroyed || mask.destroyed) return;
      const texture = sheet.textures[f.spriteFrameName];
      if (!texture) throw new Error(`FXSheet-hd atlas is missing frameSlide frame ${f.spriteFrameName}`);
      const scale = parseCocosPoint(f.scaleValues);
      const start = parseCocosRect(f.relativeStart);
      const end = parseCocosRect(f.relativeEnd);

      sprite.texture = texture;
      // pointSprite's content-scale fold is 1/2; CCScaleTo then applies the authored values.
      sprite.scale.set(scale.x / CONTENT_SCALE_FACTOR, scale.y / CONTENT_SCALE_FACTOR);
      sprite.position.set(mid.x, mid.y);
      const w = sprite.width;
      const h = sprite.height;
      mask.position.set(mid.x - w / 2, mid.y - h / 2);
      await tween(this.ticker, FRAME_SLIDE_MS, (t) => {
        const rx = start.x + (end.x - start.x) * t;
        const ry = start.y + (end.y - start.y) * t;
        const rw = start.w + (end.w - start.w) * t;
        const rh = start.h + (end.h - start.h) * t;
        mask.clear().rect(rx * w, ry * h, Math.max(rw * w, 0.001), Math.max(rh * h, 0.001)).fill(0xffffff);
      }, (t) => t, this.actions.signal);
      if (!this.active || sprite.destroyed || mask.destroyed) return;
    }
    await tween(
      this.ticker,
      FRAME_SLIDE_FADE_MS,
      (t) => (sprite.alpha = 1 - t),
      (t) => t,
      this.actions.signal,
    );
    if (!this.active) return;
    if (!sprite.destroyed) sprite.destroy();
    if (!mask.destroyed) mask.destroy();
  }

  /** `ImageEffectBuilder` (status-effects.md §7 item 4): a single static sprite frame packed in
   *  the FXSheet-hd atlas (confirmed for `thorns.png`, `Buffs.json`'s `Offensive.FixedReflection`),
   *  held for `data["length"]` seconds (default 1.0s), then a hardcoded 0.25s fade-remove. */
  private async spawnImageEffect(spriteFrame: string, lengthS: number | undefined, rect: Rect): Promise<void> {
    const paintOrder = this.reserveEffectPaintOrder();
    const sheet = await this.assets.atlas("FXSheet-hd");
    if (!this.active) return;
    const texture = sheet.textures[spriteFrame];
    if (!texture) throw new Error(`FXSheet-hd atlas is missing ImageEffectBuilder frame ${spriteFrame}`);
    const sprite = pointSprite(texture);
    sprite.label = `image:${spriteFrame}`;
    sprite.anchor.set(0.5, 0.5);
    const pos = effectPosition(rect);
    sprite.position.set(pos.x, pos.y);
    if (!this.mountEffectNodes(paintOrder, sprite)) return;
    await this.sleep(imageEffectHoldMs(lengthS));
    if (!this.active || sprite.destroyed) return;
    await tween(
      this.ticker,
      IMAGE_EFFECT_FADE_MS,
      (t) => (sprite.alpha = 1 - t),
      (t) => t,
      this.actions.signal,
    );
    if (!this.active || sprite.destroyed) return;
    sprite.destroy();
  }

  private spawnImageEffectFromData(data: Record<string, unknown>, rect: Rect, path: string): Promise<void> {
    const spriteFrame = data["spriteframe"];
    if (typeof spriteFrame !== "string") throw new Error(`ImageEffectBuilder without spriteframe on ${path}`);
    const length = typeof data["length"] === "number" ? data["length"] : undefined;
    return this.spawnImageEffect(spriteFrame, length, rect);
  }







  private async spawnFloater(
    text: string,
    color: number,
    rect: Rect,
    row: number,
    kind: "numeric" | "message" | "blocked",
    outline = true,
  ): Promise<void> {
    const paintOrder = this.reserveEffectPaintOrder();
    const pos = parameterFloaterPosition(rect, row, kind, DISPLAY_MODE);
    const lifetimeMs = floaterLifetimeMs(text);
    const label = makeTtfLabel(text, floaterFontSizePt(DISPLAY_MODE), { fill: color, outline });
    label.label = `floater:${text}`;
    label.anchor.set(0.5, 0.5);
    label.position.set(pos.x, pos.y);
    if (!this.mountEffectNodes(paintOrder, label)) return;
    await tween(this.ticker, lifetimeMs, (t) => {
      const elapsedMs = lifetimeMs * t;
      label.position.y = pos.y - floaterDistancePt(DISPLAY_MODE) * t;
      label.alpha = floaterAlphaAt(elapsedMs, lifetimeMs);
    }, (t) => t, this.actions.signal);
    if (!this.active || label.destroyed) return;
    label.destroy();
  }
}
