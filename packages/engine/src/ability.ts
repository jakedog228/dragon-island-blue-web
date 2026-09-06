


import type { AbilityComponentDef, AbilityDef, Element, GameData, StatName } from "@dib/gamedata";
import type { Rng } from "./rng.js";
import {
  activationLengthScale,
  applyDamage,
  applyMagnification,
  divideForTargets,
  rollDamage,
} from "./damage.js";
import { parseAbilityArgument } from "./abilityArgs.js";
import type { CaptureCardLevel } from "./capture.js";
import type { StatOnlyBuffSpec, StatusEffect } from "./buff.js";
import { hasteEffectText, statEffectText, type AbilityEffectText } from "./effectText.js";
import { AbilityPhaseScheduler } from "./scheduler.js";

const f = Math.fround;

/** Fail-loud guard for any `UsableAbilityComponent` subclass this slice doesn't implement. */
export class UnimplementedComponentError extends Error {
  constructor(className: string) {
    super(`ability component not implemented in this slice: ${className}`);
    this.name = "UnimplementedComponentError";
  }
}

export interface AbilityUse {
  source: string;
  /** Combined event/display order and compatibility fallback for one-sided low-level uses. */
  targets: string[];
  /** Phase-specific selections. BattleCore always supplies both, including explicit empties. */
  enemyTargets?: string[];
  friendlyTargets?: string[];
  ability: AbilityDef;
  args: Record<string, unknown>;
}

export interface AbilityResultEntry {
  target: string;
  hpDelta?: number;
  element?: Element | null;
  captureSuccess?: boolean;
  statusApplied?: StatusEffect;
  stunDelay?: number;
}

export interface AbilityOutcome {
  results: AbilityResultEntry[];
  rngDraws: number;
}

/**
 * Minimal living-lookup interface Task 9's Battle implements. See deviation #8 in this file's
 * header for why `levelOf`/`isDestroyed` were added beyond the brief's shape.
 */
export interface BattleWorld {
  statsOf(id: string): Record<StatName, number>;
  elementOf(id: string): Element;
  hpOf(id: string): number;
  levelOf(id: string): number;
  applyHpDelta(
    id: string,
    delta: number,
    sourceId: string,


    opts?: {
      element?: Element;
      sourceStat?: StatName;
      displayZeroDamage?: boolean;
      /** Native direct `adjustHP:` calls do not pass through Living's damage-taken listeners. */
      bypassDamageTakenListeners?: boolean;
      /** Direct component-sourced damage can kill without crediting a Living source. */
      suppressKillCredit?: boolean;
      /** Explicitly distinguish native nil/non-Living death sources from the displayed source. */
      sourceOfDeath?: string | undefined;
    },
  ): void;
  resolveCapture?(sourceId: string, targetId: string, cardLevel: CaptureCardLevel, partyLevel: number): boolean;
  isDestroyed?(id: string): boolean;
  addStatOnlyBuff?(targetId: string, spec: StatOnlyBuffSpec): boolean;
  magnifyContext?(sourceId: string, targetId: string): MagnifyContext;
  isBoss?(id: string): boolean;
  addTimeDelay?(id: string, amount: number): void;
  removeStatusBuffs?(id: string, statuses: readonly StatusEffect[]): void;
  removeAllBuffs?(id: string): void;
  notifyAbilityEvent?(event: number, args: unknown): void;
  /** Authored `sourceBuffs`/`enemyBuffs`/`friendlyBuffs` entry application (buffs.md §2.1):
   *  `{type: "<Buffs.json path>", arguments}` attached to `targetId`, sourced from `sourceId`
   *  (always the ability's caster, buffs.md §2.1's `livingSource:` invariant). */
  applyAuthoredBuff?(targetId: string, entry: BuffListEntry, sourceId: string): void;
  /** `notifyLiving:dealtDamage:toTarget:` (buffs.md §7) — fired ONLY from the
   *  DamageDealing/Attack component path, only for nonzero landed damage, scoped to `sourceId`'s
   *  own SlowProc/StunProc-kind buffs (never poison ticks, reflections, or heals). */
  notifyDamageDealt?(sourceId: string, targetId: string, amount: number): void;
  /** AbilityResult parameter producers consumed by the presentation tier. */
  notifyEffectText?(targetId: string, effect: AbilityEffectText): void;
  /** Direct Stun's successful result; proc stuns are produced inside BattleCore instead. */
  notifyStunned?(targetId: string, sourceId: string, delay: number): void;
  // -------------------------------------------------------------------------------------------
  // Remaining-ability-component hooks (components-full.md). All roster/queue/currency mutation
  // stays in the world (BattleCore); components only decide WHAT to do. RNG draws made INSIDE
  // these hooks (bench picks, random summon type, mid-battle scheduling) go through the world's
  // own shared rng stream and are NOT counted in `AbilityOutcome.rngDraws`.
  /** The living's species shortType (`[living name]`) — AddMonster's default clone type (§1). */
  speciesOf?(id: string): string;


  summonMonster?(shortType: string, summonerId: string, hpStyle: SummonHpStyle): void;
  /** `+[MonsterpediaBookData bookTemplateMonstersFromCategory:0]` + `randomElement` (§2): one
   *  uniform draw over the Normal-category catalog, optionally star-filtered. */
  randomSummonType?(minStars: number): string;


  desoulSummon?(holderId: string, casterId: string): void;


  sacrificeBenchMember?(casterId: string): number | undefined;


  switchWithRandomReserve?(casterId: string, targetId: string): void;
  /** `-[UserSavedData spendSilver:]` (§6): deduct `cost` if affordable; false = silent no-op. */
  spendSilver?(sourceId: string, cost: number): boolean;
  /** `-[Battle moveToFrontForLiving:]` via MoveToFront (§7): make `targetId` the queue head. */
  moveToFront?(sourceId: string, targetId: string): void;


  notifyPhaseResolved?(phase: "friends" | "enemy", sourceId: string, targetIds: readonly string[]): void;
}

/** `AddMonsterAbilityComponent.hpStyle` (components-full.md §1): "match"=0, "split"=1,
 *  anything-else/absent="full" (100%, the raw int 2). */
export type SummonHpStyle = "match" | "split" | "full";

/** One `sourceBuffs`/`enemyBuffs`/`friendlyBuffs`/`revengeBuffs`/`passiveBuffs` array entry
 *  (buffs.md §2.1's confirmed shape). */
export interface BuffListEntry {
  type: string;
  arguments?: Record<string, unknown> | undefined;
}

export interface MagnifyContext {
  targetFullName: string;
  targetStatuses: readonly string[];
  sourceTimeInCombat: number;
  friendlyDeadCount: number;
  enemyDeadCount: number;
  friendlyActiveCount: number;
  sourceKillsMade: number;
}

export type PhaseKind = "source" | "friends" | "enemy";

/**
 * Every implemented `UsableAbilityComponent` subclass and the exact phase(s) whose
 * `performLogicFor<Phase>PhaseWithSource:` it overrides (or inherits — DamageDealing-family
 * subclasses inherit the enemy phase, components-full.md §0). Any class not in this table is
 * unimplemented -> throws (`FeatherAbilityComponent` is deliberately absent: it's a raw
 * CCDirector scene-replacement with no battle-state surface, components-full.md §12).
 */
export const COMPONENT_PHASES: Partial<Record<string, readonly PhaseKind[]>> = {
  AttackAbilityComponent: ["enemy"],
  DamageDealingAbilityComponent: ["enemy"],
  HealingAbilityComponent: ["friends"],
  CaptureAbilityComponent: ["enemy"],


  AnalyzeAbilityComponent: ["source"],
  StatModAbilityComponent: ["friends", "enemy"],
  HasteAbilityComponent: ["friends", "enemy"],
  MagnifyAbilityComponent: ["friends", "enemy"],
  StunAbilityComponent: ["friends", "enemy"],
  ParalyzeAbilityComponent: ["friends", "enemy"],
  SleepAbilityComponent: ["friends", "enemy"],
  ConfuseAbilityComponent: ["friends", "enemy"],
  StatusRemoveAbilityComponent: ["friends", "enemy"],
  RemoveAllBuffsAbilityComponent: ["friends", "enemy"],
  // components-full.md §3: IS-A DamageDealingAbilityComponent — inherited enemy-phase attack
  // plus its own source-phase (heal-back/self-damage) and friends-phase (split heal) overrides.
  DrainLifeAbilityComponent: ["source", "friends", "enemy"],
  // components-full.md §8: IS-A DamageDealingAbilityComponent — inherited enemy phase only; its
  // own additions are `notifyBeginning` (queue-time element roll) + `modifyFinalDamage:`.
  DiceAbilityComponent: ["enemy"],
  AddMonsterAbilityComponent: ["friends", "enemy"],
  CallMonsterAbilityComponent: ["source"],
  SacrificeAbilityComponent: ["friends", "enemy"],
  SwitchAbilityComponent: ["friends", "enemy"],
  SpendSilverAbilityComponent: ["source"],
  MoveToFrontAbilityComponent: ["friends", "enemy"],
  ApplyBuffAbilityComponent: ["friends", "enemy"],
  EscapeAbilityComponent: ["source"],
  DesoulAbilityComponent: ["friends"],
};

/** `arc4random() % 7` element enum (damage.md: 0=Life 1=Death 2=Water 3=Fire 4=Earth 5=Air
 *  6=Arcane) — DiceAbilityComponent's `notifyBeginning` element pick (components-full.md §8). */
const DICE_ELEMENTS: readonly Element[] = ["Life", "Death", "Water", "Fire", "Earth", "Air", "Arcane"];

interface ComponentInstance {
  def: AbilityComponentDef;
  args: Record<string, unknown>;
}

function componentRunsInPhase(className: string, phase: PhaseKind): boolean {
  return COMPONENT_PHASES[className]?.includes(phase) ?? false;
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function relatedStatOf(component: ComponentInstance): StatName | undefined {
  const roll = { ...recordOf(component.def.raw["roll"]), ...recordOf(component.args["roll"]) };
  const stat = roll["relatedStat"];
  return typeof stat === "string" ? (stat as StatName) : undefined;
}

function statNameOf(value: unknown): StatName {
  if (value === "Attack" || value === "Defense" || value === "Magic" || value === "MaxHP" ||
      value === "Resist" || value === "Speed") return value;
  throw new Error(`StatModAbilityComponent: unknown stat ${String(value)}`);
}

function statusNameOf(value: unknown): StatusEffect {
  if (value === "Sleep" || value === "Paralyze" || value === "Poison" || value === "Confuse") {
    return value;
  }
  throw new Error(`unknown status effect ${String(value)}`);
}

function disablingLength(
  className: string,
  activationLength: number,
  abilityScalor: number,
  numTargets: number,
): number {
  let first: number;
  switch (className) {
    case "StunAbilityComponent":
      first = Math.trunc(f(f(activationLength) * activationLengthScale(activationLength)));
      break;
    case "ParalyzeAbilityComponent":
      first = Math.trunc(f(f(activationLength) * f(1.3)));
      break;
    case "SleepAbilityComponent":
      first = Math.trunc(f(f(activationLength) * f(1.5)));
      break;
    case "ConfuseAbilityComponent":
      first = Math.trunc(f(f(activationLength) * f(1.75)));
      break;
    default:
      throw new Error(`no disabling length formula for ${className}`);
  }
  const scaled = Math.trunc(f(f(first) * f(abilityScalor)));
  return Math.round(divideForTargets(scaled, numTargets));
}

function addMagnitude(current: number, amount: number): number {
  return f(f(current) + f(amount));
}

function magnificationForTarget(
  current: number,
  args: Record<string, unknown>,
  context: MagnifyContext,
): number {
  let result = current;
  const targetMultipliers = recordOf(args["targetMultipliers"]);
  for (const component of context.targetFullName.split(".")) {
    const amount = targetMultipliers[component];
    if (typeof amount === "number") {
      result = addMagnitude(result, amount);
      break;
    }
  }
  const statusMultipliers = recordOf(args["statusMultipliers"]);
  for (const status of context.targetStatuses) {
    const amount = statusMultipliers[status];
    if (typeof amount === "number") {
      result = addMagnitude(result, amount);
      break;
    }
  }
  const scaledTerms: Array<[string, number]> = [
    ["timeInCombatMultiplier", context.sourceTimeInCombat],
    ["friendlyDeadMultiplier", context.friendlyDeadCount],
    ["enemyDeadMultiplier", context.enemyDeadCount],
  ];
  for (const [key, value] of scaledTerms) {
    const multiplier = args[key];
    if (typeof multiplier === "number") result = addMagnitude(result, f(f(multiplier) * f(value)));
  }
  const teamSizeMultiplier = args["teamSizeMultiplier"];
  if (typeof teamSizeMultiplier === "number" && context.friendlyActiveCount >= 2) {
    result = addMagnitude(result, f(f(teamSizeMultiplier) * f(context.friendlyActiveCount - 1)));
  }
  const aloneMultiplier = args["aloneMultiplier"];
  if (typeof aloneMultiplier === "number" && context.friendlyActiveCount === 1) {
    result = addMagnitude(result, aloneMultiplier);
  }
  const myKillsMultiplier = args["myKillsMultiplier"];
  if (typeof myKillsMultiplier === "number") {
    result = addMagnitude(result, f(f(myKillsMultiplier) * f(context.sourceKillsMade)));
  }
  return result;
}


function rollNumTargets(ability: AbilityDef, kind: "enemy" | "friends"): number {
  const tp = recordOf(ability.targetPicker);
  const all = tp[kind === "enemy" ? "allEnemies" : "allFriends"];
  if (all === true) return 3;
  const n = tp[kind === "enemy" ? "enemyTargets" : "friendlyTargets"];
  if (typeof n === "number" && n > 0) return n;
  return 0;
}

interface PhaseSlot {
  kind: PhaseKind;
  countdown: number;
  eligible: boolean;
  fired: boolean;
}

/**
 * `-[UsableAbility performAbilityPhase:...]` / `-[Living startQueuedAbility]` /
 * `-[Living isCompleteAfterAdvanceingTime:...]` (ability.md §2). Synchronous countdown race:
 * fires every eligible, un-fired phase in ascending-countdown order (ties toward the lower
 * index) until none remain.
 */
function computeFiringOrder(ability: AbilityDef): PhaseKind[] {
  const raw = ability.raw;
  const eventData = recordOf(raw["eventData"]);
  const sourceEventData = eventData["sourceEventData"];
  const friendlyEventData = eventData["friendlyTargetEventData"];
  const enemyEventData = eventData["enemyTargetEventData"];

  const hasSource = sourceEventData !== undefined;
  const hasFriendly = friendlyEventData !== undefined;
  const hasEnemy = enemyEventData !== undefined;

  const sourceDelay = hasSource ? numberOr(recordOf(sourceEventData)["startDelay"], 0) : 0;
  const friendlyDelay = hasFriendly ? numberOr(recordOf(friendlyEventData)["startDelay"], 0.5) : 0;
  const enemyDelay = hasEnemy ? numberOr(recordOf(enemyEventData)["startDelay"], 0.5) : 0;

  const phases: PhaseSlot[] = [


    { kind: "source", countdown: sourceDelay, eligible: true, fired: false },
    { kind: "friends", countdown: friendlyDelay, eligible: hasFriendly, fired: false },
    { kind: "enemy", countdown: enemyDelay, eligible: hasEnemy, fired: false },
  ];

  const order: PhaseKind[] = [];
  const scheduler = new AbilityPhaseScheduler(
    [phases[0]!.countdown, phases[1]!.countdown, phases[2]!.countdown],
    [phases[0]!.eligible, phases[1]!.eligible, phases[2]!.eligible],
  );
  let elapsed = 0;
  for (;;) {
    const phase = scheduler.advance(elapsed);
    if (phase !== undefined) {
      order.push(phases[phase]!.kind);
      elapsed = 0;
      continue;
    }

    const snapshot = scheduler.snapshot();
    let nextDelay = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 3; i++) {
      const phaseIndex = i as 0 | 1 | 2;
      if (snapshot.completed[phaseIndex]) continue;
      const countdown = snapshot.countdowns[phaseIndex];
      if (countdown > 0 && countdown < nextDelay) nextDelay = countdown;
    }
    if (!Number.isFinite(nextDelay)) break;
    elapsed = nextDelay;
  }
  return order;
}


function filterTargets(ids: string[], world: BattleWorld): string[] {
  return ids.filter((id) => {
    if (world.isDestroyed?.(id)) return false;
    if (world.hpOf(id) <= 0) return false; // "dead" per damage.md §6 (Living.dead == hp==0)
    return true;
  });
}

function buffListEntries(v: unknown): BuffListEntry[] {
  return Array.isArray(v) ? (v as BuffListEntry[]) : [];
}

/**
 * `UsableAbility._init`'s buff-list concatenation (buffs.md §2.1): the ability dictionary's own
 * list entries first, then the job-ref/use-argument-supplied entries appended after — both apply,
 * neither overrides the other.
 */
function buffListFor(
  key: "sourceBuffs" | "enemyBuffs" | "friendlyBuffs",
  ability: AbilityDef,
  args: Record<string, unknown>,
): BuffListEntry[] {
  return [...buffListEntries(ability.raw[key]), ...buffListEntries(args[key])];
}

/**
 * `-[UsableAbility performAbilityPhase:withLiving:arguments:firedAbilityEvents:
 * abilityEnvironment:]` family (ability.md §§1-5). Builds one `AbilityResult`-equivalent per
 * live target per firing phase and runs each phase's components (in declared order) against it.
 *
 * See this file's header for every deviation from the Task 8 brief, each citing its ability.md
 * section.
 */
export function performAbility(
  use: AbilityUse,
  world: BattleWorld,
  rng: Rng,
  gameData: GameData,
): AbilityOutcome {
  const raw = use.ability.raw;


  const argComponentRefs = Array.isArray(use.args["components"])
    ? (use.args["components"] as Array<{ type: string; arguments?: Record<string, unknown> }>)
    : [];
  const componentRefs = [...argComponentRefs, ...use.ability.components];
  const commonComponentArgs = recordOf(use.args["commonComponentArguments"]);
  const components: ComponentInstance[] = componentRefs.map((ref) => ({
    def: gameData.abilityComponent(ref.type),

    args: { ...recordOf(ref["arguments"]), ...commonComponentArgs },
  }));

  // Fail loud BEFORE any world mutation (deviation #7/9 above).
  for (const component of components) {
    if (!COMPONENT_PHASES[component.def.className]) {
      throw new UnimplementedComponentError(component.def.className);
    }
  }

  const results: AbilityResultEntry[] = [];
  let rngDraws = 0;


  const diceElements = new Map<ComponentInstance, Element>();
  for (const component of components) {
    if (component.def.className === "DiceAbilityComponent") {
      diceElements.set(component, DICE_ELEMENTS[rng.intBelow(7)]!);
      rngDraws++;
    }
  }
  // ability.md §1: arguments (use.args) win over the ability's own resolved dictionary.
  const rawActivationLength = use.args["activationLength"] ?? use.ability.activationLength;
  const activationLength = parseAbilityArgument(rawActivationLength);
  const abilityScalor = numberOr(use.args["abilityScalor"], numberOr(raw["abilityScalor"], 1.0));

  const liveEnemyTargets = filterTargets(use.enemyTargets ?? use.targets, world);
  const liveFriendlyTargets = filterTargets(use.friendlyTargets ?? use.targets, world);
  const firingOrder = computeFiringOrder(use.ability);

  // `previousAbilityResults[2]` (components-full.md §3): DrainLife's heal-back reads the sum of
  // "damage" params accumulated by the enemy phase's already-fired results of THIS ability use.
  // The DamageDealing-family pipeline below is the only writer of those params, so a running
  // total is exactly that sum (0 until the enemy phase fires — the real data delays DrainLife's
  // source phase past the enemy phase via startDelay 0.6 > 0.5).
  let enemyPhaseDamageTotal = 0;


  const runDamagePipeline = (
    component: ComponentInstance,
    targetIds: string[],
    magnification: number,
    modifyFinal?: (amount: number, targetId: string) => number,
  ): void => {
    const relatedStat = relatedStatOf(component);
    // damage.md §2 (VERIFIED): config-fetched once from the targetPicker — see rollNumTargets
    // above (Part 1(b): enemy side now VERIFIED, no live-count fallback).
    const numTargets = rollNumTargets(use.ability, "enemy");
    for (const targetId of targetIds) {
      const stat = relatedStat ? world.statsOf(use.source)[relatedStat] : 0;
      const roll = rollDamage(
        {
          abilityScalor,
          stat,
          activationLength,
          scaleByActivationLength: true,
          randomness: 0.2,
          numTargets,
        },
        rng,
      );
      rngDraws++;
      let baseAmount = applyMagnification(roll, magnification);
      if (baseAmount < 1) continue; // whiffs entirely, damage.md step 3
      if (modifyFinal) {
        // Dice mismatch's `setAmount:0` happens AFTER the >= 1 gate, so the Damage object exists
        // and rides the whole hitWithDamage: pipeline to a final of 0 — which skips notify/adjustHP
        // (`if (final >= 1)`, damage.md §5) but STILL adds the result's display param (§2's
        // `[result addParameter:]` sits outside that guard): natively a mismatched Dice target
        // shows a red "-0", not nothing. Flow the 0 through rather than `continue`.
        baseAmount = modifyFinal(baseAmount, targetId);
      }

      // No ability/component in extracted/data ever sets a `damageElement` override
      // (grepped both Abilities.json and AbilityComponents.json), so element always
      // falls back to the attacker's own element (damage.md §2's "element == 7" path).
      const damageElement = world.elementOf(use.source);
      const defender = world.statsOf(targetId);
      const final = applyDamage({
        amount: baseAmount,
        damageElement,
        sourceStat: relatedStat ?? "Attack",
        defenderElement: world.elementOf(targetId),
        defenderDefense: defender.Defense,
        defenderResist: defender.Resist,
        defenderCurrentHp: world.hpOf(targetId),
        level: Math.max(world.levelOf(use.source), world.levelOf(targetId)),
      });
      const sourceStat = relatedStat ?? "Attack";
      // `final > 0 ? -final : 0` (not bare `-final`) so a fully-mitigated hit records 0, never -0.
      const hpDelta = final > 0 ? -final : 0;
      world.applyHpDelta(targetId, hpDelta, use.source, {
        element: damageElement,
        sourceStat,
        displayZeroDamage: true, // this pipeline built a real Damage object — see the opt's doc
      });
      results.push({ target: targetId, hpDelta, element: damageElement });
      enemyPhaseDamageTotal += final;
      // buffs.md §7: SlowProc/StunProc fire unconditionally on the WEARER's own nonzero
      // landed damage, DamageDealing/Attack path only (never poison ticks/reflections/heals).
      if (final > 0) world.notifyDamageDealt?.(use.source, targetId, final);
    }
  };

  // Magnification resets at the top of every phase dispatcher and Magnify components accumulate
  // into it in component order before a later damage/heal component consumes it.
  for (const phaseKind of firingOrder) {
    const targetIds = phaseKind === "source"
      ? [use.source]
      : phaseKind === "friends"
        ? liveFriendlyTargets
        : liveEnemyTargets;
    let magnification = 0;

    for (const component of components) {
      if (!componentRunsInPhase(component.def.className, phaseKind)) continue;

      switch (component.def.className) {
        // Part 1(a): AttackAbilityComponent IS a DamageDealingAbilityComponent subclass
        // (battle.md §0/§7) — super runs the full roll/magnify/elemental/mitigation pipeline
        // from ITS OWN merged `roll` dict before its own body stamps a display-only "meleeType"
        // tag (not observable through AbilityOutcome). Same code path as its superclass.
        case "AttackAbilityComponent":
        case "DamageDealingAbilityComponent":
        {
          runDamagePipeline(component, targetIds, magnification);
          break;
        }

        // components-full.md §8: inherited DamageDealing enemy phase + `modifyFinalDamage:` —
        // a binary hit-or-total-miss gamble: only targets whose element matches this use's one
        // pre-rolled element take damage (magnified by matchMagnification); everyone else takes
        // exactly zero (raw-Thumb-confirmed `setAmount:0`).
        case "DiceAbilityComponent": {
          const chosenElement = diceElements.get(component)!;
          const matchMagnification = numberOr(
            component.args["matchMagnification"],
            numberOr(component.def.raw["matchMagnification"], 0.5),
          );
          runDamagePipeline(component, targetIds, magnification, (amount, targetId) =>
            world.elementOf(targetId) === chosenElement
              ? applyMagnification(amount, matchMagnification) // trunc32(applyMod(f32(amount), m))
              : 0,
          );
          break;
        }

        // components-full.md §3: enemy phase = inherited DamageDealing attack; source phase =
        // heal-back (or negative-healPercent self-damage) scaled off the enemy phase's landed
        // total; friends phase = per-target split of the same total (unexercised by real kits).
        case "DrainLifeAbilityComponent": {
          if (phaseKind === "enemy") {
            runDamagePipeline(component, targetIds, magnification);
            break;
          }
          const healPercent = f(
            numberOr(component.args["healPercent"], numberOr(component.def.raw["healPercent"], 0.5)),
          );
          const total = enemyPhaseDamageTotal;
          if (phaseKind === "source") {
            if (total >= 1) {
              if (healPercent >= 0) {

                const healed = Math.trunc(f(f(total) * healPercent));
                if (healed >= 1) {
                  world.applyHpDelta(use.source, healed, use.source);
                  results.push({ target: use.source, hpDelta: healed, element: null });
                }
              } else {
                // "Reckless attack": direct adjustHP: — bypasses hitWithDamage:, so NO elemental
                // adjustment and NO Defense/Resist mitigation. Damage.source is the component
                // (not a Living): no kill credit, no revenge trigger. Wendigo's authored
                // DesparateAttack uses this branch with healPercent -0.25.
                const amount = Math.trunc(f(f(total) * -healPercent));
                world.applyHpDelta(use.source, -amount, use.source, {
                  element: world.elementOf(use.source),
                  sourceStat: relatedStatOf(component) ?? "Attack",
                  bypassDamageTakenListeners: true,
                  suppressKillCredit: true,
                  sourceOfDeath: undefined,
                });
                if (amount >= 1) {
                  results.push({ target: use.source, hpDelta: -amount, element: world.elementOf(use.source) });
                }
              }
            }
          } else {


            const n = targetIds.length;
            for (const targetId of targetIds) {
              const amount = Math.floor(f(f(f(total) * healPercent) / f(n)));
              if (amount < 1) continue;
              world.applyHpDelta(targetId, amount, use.source);
              results.push({ target: targetId, hpDelta: amount, element: null });
            }
          }
          break;
        }


        case "AddMonsterAbilityComponent": {
          if (!world.summonMonster || !world.speciesOf) {
            throw new Error("AddMonsterAbilityComponent: BattleWorld has no summon support");
          }
          // All three fields read from `arguments` ONLY (no dictionary fallback, §1's init table).
          // `ownerLevelScalor` is parsed by the binary's init but never read by
          // `performAddWithType:` (level comes straight from `[abilitySource level]`) — not ported.
          const addType = typeof component.args["addType"] === "string"
            ? (component.args["addType"] as string)
            : undefined;
          const hpStyleRaw = component.args["hpStyle"];
          const hpStyle: SummonHpStyle =
            hpStyleRaw === "match" ? "match" : hpStyleRaw === "split" ? "split" : "full";
          for (const targetId of targetIds) {
            if (world.isBoss?.(targetId)) continue; // §1: boss targets skipped
            world.summonMonster(addType ?? world.speciesOf(targetId), use.source, hpStyle);
          }
          break;
        }


        case "CallMonsterAbilityComponent": {
          if (!world.summonMonster || !world.randomSummonType) {
            throw new Error("CallMonsterAbilityComponent: BattleWorld has no summon support");
          }
          const monsterType = typeof component.args["monsterType"] === "string"
            ? (component.args["monsterType"] as string)
            : undefined;
          const minStars = numberOr(component.args["minStars"], 0);
          world.summonMonster(monsterType ?? world.randomSummonType(minStars), use.source, "full");
          break;
        }

        // components-full.md §4: runs ONCE per phase-firing (ignores currentResults) — kill one
        // random bench member of the caster's team, add f32(victimLevel) * levelMultiplier to
        // this phase's magnification (visible to a LATER component's roll in the same phase:
        // real carriers prepend Sacrifice before MagicAttack via args-level components).
        case "SacrificeAbilityComponent": {
          if (!world.sacrificeBenchMember) {
            throw new Error("SacrificeAbilityComponent: BattleWorld has no sacrifice support");
          }
          const levelMultiplier = numberOr(component.args["levelMultiplier"], 0);
          const victimLevel = world.sacrificeBenchMember(use.source);
          if (victimLevel !== undefined) {

            magnification = f(f(f(victimLevel) * f(levelMultiplier)) + f(magnification));
          }
          break;
        }

        // components-full.md §5: ONE random bench draw PER TARGET — swap each target out for a
        // random reserve of the CASTER's team (real carriers are all self-only "Switch").
        case "SwitchAbilityComponent": {
          if (!world.switchWithRandomReserve) {
            throw new Error("SwitchAbilityComponent: BattleWorld has no switch support");
          }
          for (const targetId of targetIds) {
            world.switchWithRandomReserve(use.source, targetId);
          }
          break;
        }

        // components-full.md §6: cost = level*10; on success add damageMagnifier to THIS (source)
        // phase's magnification — which the enemy/friends dispatcher then resets before any roll
        // reads it, so the bonus is functionally dead in every real composition ("MoneySlap"
        // spends silver for zero damage bonus). Replicated faithfully; do NOT "fix" by persisting
        // magnification across phases.
        case "SpendSilverAbilityComponent": {
          if (!world.spendSilver) {
            throw new Error("SpendSilverAbilityComponent: BattleWorld has no silver support");
          }
          const damageMagnifier = numberOr(component.args["damageMagnifier"], 0);
          const cost = world.levelOf(use.source) * 10;
          if (world.spendSilver(use.source, cost)) {
            magnification = f(f(magnification) + f(damageMagnifier));
          }
          break;
        }

        // components-full.md §7: per-target `moveToFrontForLiving:` (TimedQue head reposition).
        case "MoveToFrontAbilityComponent": {
          if (!world.moveToFront) {
            throw new Error("MoveToFrontAbilityComponent: BattleWorld has no queue support");
          }
          for (const targetId of targetIds) {
            world.moveToFront(use.source, targetId);
          }
          break;
        }

        // components-full.md §9: dual-phase, unconditional, no RNG — attach ONE fixed named buff
        // per target (a completely separate mechanism from the authored sourceBuffs/enemyBuffs/
        // friendlyBuffs lists' chance-gated path). No shipped carrier; implemented as the generic
        // custom-move hook the buff engine already supports.
        case "ApplyBuffAbilityComponent": {
          if (!world.applyAuthoredBuff) {
            throw new Error("ApplyBuffAbilityComponent: BattleWorld has no buff applier");
          }
          const buffType = component.args["buffType"];
          if (typeof buffType !== "string") {
            throw new Error("ApplyBuffAbilityComponent: missing buffType argument");
          }
          const buffArguments = recordOf(component.args["buffArguments"]);
          for (const targetId of targetIds) {
            world.applyAuthoredBuff(targetId, { type: buffType, arguments: buffArguments }, use.source);
          }
          break;
        }

        // components-full.md §10: the entire component is `notifyAbilityEvent:1` — the world's
        // Battle arms a guaranteed-retreat flag and, after this ability completes, runs the
        // always-succeeding (but still rng-consuming) attemptRetreatForMonster:chance:100.
        case "EscapeAbilityComponent": {
          if (!world.notifyAbilityEvent) {
            throw new Error("EscapeAbilityComponent: BattleWorld has no ability-event receiver");
          }
          world.notifyAbilityEvent(1, null);
          break;
        }


        case "DesoulAbilityComponent": {
          if (!world.desoulSummon) {
            throw new Error("DesoulAbilityComponent: BattleWorld has no desoul-summon support");
          }
          for (const targetId of targetIds) {
            world.desoulSummon(targetId, use.source);
          }
          break;
        }

        case "HealingAbilityComponent": {
          const relatedStat = relatedStatOf(component);

          const n = targetIds.length;


          const rollTargets = 1;
          const splitDivisor = f(f(n) * f(0.7));
          for (const targetId of targetIds) {
            const stat = relatedStat ? world.statsOf(use.source)[relatedStat] : 0;
            const roll = rollDamage(
              {
                abilityScalor,
                stat,
                activationLength,
                scaleByActivationLength: true,
                randomness: 0.2,
                numTargets: rollTargets,
              },
              rng,
            );
            rngDraws++;
            // trunc32(applyMod(roll, magnification)) — reused from damage.ts, see deviation #5.
            let amount = applyMagnification(roll, magnification);
            if (n >= 2) {

              amount = Math.round(f(f(amount) / splitDivisor));
            }
            if (amount < 1) continue; // dropped, ability.md §5

            world.applyHpDelta(targetId, amount, use.source);
            results.push({ target: targetId, hpDelta: amount, element: null });
          }
          break;
        }

        case "CaptureAbilityComponent": {
          const cardLevel = use.args["captureCardLevel"];
          const partyLevel = use.args["capturePartyLevel"];
          if ((cardLevel !== 1 && cardLevel !== 2 && cardLevel !== 3) || typeof partyLevel !== "number") {
            throw new Error("CaptureAbilityComponent: missing captureCardLevel/capturePartyLevel arguments");
          }
          if (!world.resolveCapture) throw new Error("CaptureAbilityComponent: BattleWorld has no capture resolver");
          for (const targetId of targetIds) {
            const success = world.resolveCapture(use.source, targetId, cardLevel, partyLevel);
            rngDraws++;
            results.push({ target: targetId, captureSuccess: success });
          }
          break;
        }

        case "AnalyzeAbilityComponent": {
          if (!world.notifyAbilityEvent) {
            throw new Error("AnalyzeAbilityComponent: BattleWorld has no ability-event receiver");
          }
          world.notifyAbilityEvent(0, null);
          break;
        }

        case "StatModAbilityComponent": {
          if (!world.addStatOnlyBuff) {
            throw new Error("StatModAbilityComponent: BattleWorld has no buff receiver");
          }
          const stat = statNameOf(component.args["stat"]);
          const help = component.args["help"] !== false;
          const duration = numberOr(component.args["duration"], 1200);
          for (const targetId of targetIds) {
            const spec: StatOnlyBuffSpec = {
              sourceId: use.source,
              sourceLevel: world.levelOf(use.source),
              duration,
              stats: [stat],
              statsHelp: help,
            };
            world.addStatOnlyBuff(targetId, spec);
            world.notifyEffectText?.(targetId, statEffectText(spec, stat));
          }
          break;
        }

        case "HasteAbilityComponent": {
          if (!world.addStatOnlyBuff) {
            throw new Error("HasteAbilityComponent: BattleWorld has no buff receiver");
          }
          const help = component.args["help"] !== false;
          const haste = help ? f(-0.6000000238418579) : f(0.30000001192092896);
          const duration = numberOr(component.args["duration"], 500);
          for (const targetId of targetIds) {
            world.addStatOnlyBuff(targetId, {
              sourceId: use.source,
              sourceLevel: world.levelOf(use.source),
              duration,
              haste,
              stackName: help ? "hasteUp" : "hasteDown",
            });
            world.notifyEffectText?.(targetId, hasteEffectText(haste));
          }
          break;
        }

        case "MagnifyAbilityComponent": {
          if (!world.magnifyContext) {
            throw new Error("MagnifyAbilityComponent: BattleWorld has no magnification context");
          }
          for (const targetId of targetIds) {
            magnification = magnificationForTarget(
              magnification,
              component.args,
              world.magnifyContext(use.source, targetId),
            );
          }
          break;
        }

        case "StunAbilityComponent":
        case "ParalyzeAbilityComponent":
        case "SleepAbilityComponent":
        case "ConfuseAbilityComponent": {
          if (!world.addStatOnlyBuff || !world.addTimeDelay) {
            throw new Error(`${component.def.className}: BattleWorld has no status receiver`);
          }
          const applyChance = numberOr(component.args["applyChance"], 0.75);
          const length = disablingLength(
            component.def.className,
            activationLength,
            abilityScalor,
            // Every native *LengthForAbilitySource: helper calls numberOfEnemyTargets, even when
            // the same component is running its friends-phase override.
            rollNumTargets(use.ability, "enemy"),
          );
          for (const targetId of targetIds) {
            const succeeds = rng.next() < applyChance;
            rngDraws++;
            if (!succeeds) {
              world.notifyEffectText?.(targetId, { kind: "miss" });
              continue;
            }
            if (component.def.className === "StunAbilityComponent") {
              if (!world.isBoss?.(targetId)) {
                world.addTimeDelay(targetId, length);
                world.notifyStunned?.(targetId, use.source, length);
                results.push({ target: targetId, stunDelay: length });
              }
              continue;
            }
            const status = component.def.className === "ParalyzeAbilityComponent"
              ? "Paralyze"
              : component.def.className === "SleepAbilityComponent"
                ? "Sleep"
                : "Confuse";
            const added = world.addStatOnlyBuff(targetId, {
              sourceId: use.source,
              sourceLevel: world.levelOf(use.source),
              duration: length,
              statusEffects: [status],
              removeOnHurt: status === "Sleep",
            });
            if (added) results.push({ target: targetId, statusApplied: status });
          }
          break;
        }

        case "StatusRemoveAbilityComponent": {
          if (!world.removeStatusBuffs) {
            throw new Error("StatusRemoveAbilityComponent: BattleWorld has no status remover");
          }
          const rawStatuses = component.args["statusTypes"];
          if (!Array.isArray(rawStatuses)) {
            throw new Error("StatusRemoveAbilityComponent: missing statusTypes");
          }
          const statuses = rawStatuses.map(statusNameOf);
          for (const targetId of targetIds) world.removeStatusBuffs(targetId, statuses);
          break;
        }

        case "RemoveAllBuffsAbilityComponent": {
          if (!world.removeAllBuffs) {
            throw new Error("RemoveAllBuffsAbilityComponent: BattleWorld has no buff remover");
          }
          for (const targetId of targetIds) world.removeAllBuffs(targetId);
          break;
        }

        default:
          // Unreachable: every class was validated against the supported phase maps above.
          throw new UnimplementedComponentError(component.def.className);
      }
    }

    // buffs.md §2.1: AFTER that phase's own component logic, apply its authored buff list
    // (sourceBuffs -> [source] in the source phase; friendlyBuffs/enemyBuffs -> that phase's live
    // targets) — ability-dictionary entries CONCAT job-ref/use-argument entries, both apply.
    const buffKey = phaseKind === "source" ? "sourceBuffs" : phaseKind === "friends" ? "friendlyBuffs" : "enemyBuffs";
    const buffList = buffListFor(buffKey, use.ability, use.args);
    if (buffList.length > 0) {
      if (!world.applyAuthoredBuff) {
        throw new Error(`authored buff list "${buffKey}" present but BattleWorld has no buff applier`);
      }
      for (const targetId of targetIds) {
        if (world.hpOf(targetId) <= 0) continue; // dead targets never receive the buff (buffs.md §2.1)
        for (const entry of buffList) {
          if (recordOf(entry.arguments)["chance"] !== undefined) {


            throw new Error(`authored buff entry "${entry.type}" has an unsupported "chance" key`);
          }
          world.applyAuthoredBuff(targetId, entry, use.source);
        }
      }
    }

    // notifyPhaseResolved's own doc comment (BattleWorld interface, above): the generic
    // per-phase-resolution fallback so a friends/enemy phase with no side-effect-producing
    // component still has an event to hang its declared effectBuilders off. Fired once per
    // firing phase (never per-component), AFTER that phase's components and buff list, so an
    // event-array consumer sees every one of this phase's OWN side-effect events first.
    if (phaseKind !== "source" && targetIds.length > 0) {
      world.notifyPhaseResolved?.(phaseKind, use.source, targetIds);
    }
  }

  return { results, rngDraws };
}

/** The roster/inventory facts `blockUseReason` needs about the would-be caster's situation. */
export interface BlockUseContext {
  /** Caster's team `monsterMembers.count` (active front line). */
  activeCount: number;
  /** Caster's team `replacementMembers.count` (bench). */
  benchCount: number;
  /** `Team.fightingGroupSize`. */
  fightingGroupSize: number;
  /** Whether the caster has a SoulStone in item slot 4 (`itemInSlot:4 isKindOfClass: SoulStone`,
   *  soulstones.md §7.1) — true iff the caster's `TeamMemberSetup.soulStone` is set. Gates
   *  `Utility.Desoul` ("MonsterHasNoSoulStone"). */
  hasSoulStoneEquipped: boolean;
}


export function blockUseReason(
  ability: AbilityDef,
  args: Record<string, unknown>,
  gameData: GameData,
  ctx: BlockUseContext,
): string | undefined {
  const argComponentRefs = Array.isArray(args["components"])
    ? (args["components"] as Array<{ type: string }>)
    : [];
  const componentRefs = [...argComponentRefs, ...ability.components];
  for (const ref of componentRefs) {
    const className = gameData.abilityComponent(ref.type).className;
    switch (className) {
      case "AddMonsterAbilityComponent":


        if (!(ctx.activeCount < ctx.fightingGroupSize && ctx.benchCount === 0)) {
          return "NoRoomToAddMonster";
        }
        break;
      case "SacrificeAbilityComponent":
      case "SwitchAbilityComponent":
        if (ctx.benchCount === 0) return "NoReplacementMembers";
        break;
      case "DesoulAbilityComponent":
        if (!ctx.hasSoulStoneEquipped) return "MonsterHasNoSoulStone";
        break;
      default:
        break; // base-class blockUseReasonForLiving: returns 0 — never blocks
    }
  }
  return undefined;
}
