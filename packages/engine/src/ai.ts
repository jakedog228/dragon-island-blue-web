



























































import type { AbilityDef, GameData, JobAbilityRef } from "@dib/gamedata";
import type { Rng } from "./rng.js";
import { parseAbilityArgument } from "./abilityArgs.js";

/** Minimal living/roster-lookup interface `battle.ts`'s `HeadlessBattle` implements. */
export interface AiWorld {
  /** The monster shortType backing this living id (for `GameData.jobAbilitiesOrEmpty`). */
  shortTypeOf(id: string): string;
  /** Live `targetableMembers` of `id`'s ENEMY team, front-of-party-first order. */
  enemyPoolOf(id: string): string[];
  /** Live `targetableMembers` of `id`'s OWN team, front-of-party-first order. */
  friendlyPoolOf(id: string): string[];





  blockUseReasonOf?(actorId: string, ability: AbilityDef, args: Record<string, unknown>): string | undefined;
  /** The taunt-redirect `sum` for one candidate (targeting-passives.md §A): the summed
   *  `targetPriorityAdjustment` of every LivingChild attached to the candidate — its active
   *  Buffs' own values (Scapegoat/Detaunt self-buffs) plus every job ability's args-over-dict
   *  value (the static `"EasyTarget"` passives). Optional: worlds without it redirect with all
   *  sums 0 (originals-only pool). */
  targetPriorityOf?(id: string): number;
}

export interface AiDecision {
  ability: AbilityDef;
  /** The job-ability-ref's own `arguments` dict (merged into `AbilityUse.args` by the caller). */
  args: Record<string, unknown>;
  enemyTargets: string[];
  friendlyTargets: string[];
  /** Total RNG draws consumed building this decision (aiChance gates + weighted pick + target
   *  picks) — exposed for draw-order audits in tests. */
  rngDraws: number;
}

function slotOf(ref: JobAbilityRef): number | undefined {
  const m = /^usable(\d+)$/.exec(ref.slot);
  return m ? Number(m[1]) : undefined;
}

function isUsableAbilityClass(className: string): boolean {
  return className === "CombatAbility" || className === "NonCombatAbility";
}

/** battle.md §4a point 3: NonCombatAbility is always blocked in this always-in-combat engine. */
function isBlockedInCombat(className: string): boolean {
  return className === "NonCombatAbility";
}

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}



function wrlWeight(weight: number): number {
  const w = Math.trunc(weight);
  return w <= 0 ? 1 : w;
}





function weightedPick<T>(items: Array<{ item: T; weight: number }>, rng: Rng): T {
  let endValue = 0;
  const cumulative: number[] = [];
  for (const it of items) {
    endValue += wrlWeight(it.weight);
    cumulative.push(endValue);
  }
  const roll = rng.intBelow(endValue);
  for (let i = 0; i < items.length; i++) {
    if (cumulative[i]! > roll) return items[i]!.item;
  }
  throw new Error("weightedPick: prefix-sum scan fell through (unreachable: roll < endValue)");
}


















export function redirectEnemyTargets(
  actorId: string,
  enemyTargets: readonly string[],
  world: AiWorld,
  rng: Rng,
): string[] {
  if (enemyTargets.length === 0) return [...enemyTargets];

  interface Entry {
    id: string;
    weight: number;
  }
  const pool: Entry[] = [];
  for (const candidate of world.enemyPoolOf(actorId)) {
    const sum = world.targetPriorityOf?.(candidate) ?? 0;
    if (enemyTargets.includes(candidate)) {
      pool.push({ id: candidate, weight: Math.max(Math.trunc(sum) + 100, 1) });
    } else if (sum >= 1) {
      pool.push({ id: candidate, weight: wrlWeight(sum) });
    }
  }

  const result: string[] = [];
  const remaining = [...pool];
  let endValue = remaining.reduce((total, e) => total + e.weight, 0);
  for (let i = 0; i < enemyTargets.length && remaining.length > 0; i++) {
    if (remaining.length === 1) {
      // removeRandomElement's sole-element fast path: returned directly, ZERO draws consumed.
      result.push(remaining[0]!.id);
      remaining.length = 0;
      break;
    }
    const roll = rng.intBelow(endValue);
    let cumulative = 0;
    let idx = 0;
    for (; idx < remaining.length; idx++) {
      cumulative += remaining[idx]!.weight;

      if (cumulative >= roll) break;
    }
    const [picked] = remaining.splice(idx, 1);
    result.push(picked!.id);
    endValue -= picked!.weight;
  }
  return result;
}

/** Uniform-without-replacement pick of `n` ids from `pool` (battle.md §4b: `arc4random() %
 *  poolCount`, ported via `rng.intBelow`). Stops early if the pool empties. */
function pickWithoutReplacement(pool: readonly string[], n: number, rng: Rng): string[] {
  const remaining = [...pool];
  const chosen: string[] = [];
  for (let i = 0; i < n && remaining.length > 0; i++) {
    const idx = rng.intBelow(remaining.length);
    chosen.push(remaining[idx]!);
    remaining.splice(idx, 1);
  }
  return chosen;
}

/**
 * -[BadguyAI assignAbilityToMonster:] (battle.md §4). Picks (or defaults to `Utility.Delay`),
 * then builds the concrete enemy/friendly target arrays for `actorId`.
 */
export function assignAbility(actorId: string, world: AiWorld, gameData: GameData, rng: Rng): AiDecision {
  let rngDraws = 0;
  const refs = gameData.jobAbilitiesOrEmpty(world.shortTypeOf(actorId));

  interface Candidate {
    ref: JobAbilityRef;
    ability: AbilityDef;
    weight: number;
  }
  const candidates: Candidate[] = [];

  for (const ref of refs) {
    const ability = gameData.ability(ref.type);
    if (!isUsableAbilityClass(ability.className)) continue; // not a UsableAbility -> no draw at all

    const slot = slotOf(ref);
    if (slot === undefined) {
      throw new Error(
        `assignAbility: UsableAbility ref "${ref.slot}" (${ref.type}) doesn't match the "usableN" ` +
          `slot-key shape this port's slot semantics are derived from (battle.md §4a UNVERIFIED item)`,
      );
    }
    if (slot < 1) continue;

    // ability.md §7: aiChance reads the ability's own DICTIONARY first, THEN falls back to the
    // job-ref's arguments — the OPPOSITE precedence from every other ability field in this
    // codebase (activationLength etc. are arguments-over-dictionary). Default 1.0 if neither.
    const argsAiChance = typeof ref.arguments["aiChance"] === "number" ? (ref.arguments["aiChance"] as number) : undefined;
    const aiChance = ability.aiChance ?? argsAiChance ?? 1.0;
    const u = rng.next();
    rngDraws++;
    const passed = u < aiChance;



    if (
      passed &&
      !isBlockedInCombat(ability.className) &&
      world.blockUseReasonOf?.(actorId, ability, ref.arguments) === undefined
    ) {
      const rawActivationLength = ref.arguments["activationLength"] ?? ability.activationLength;
      const weight = parseAbilityArgument(rawActivationLength);
      candidates.push({ ref, ability, weight });
    }
  }

  let chosen: { ref: JobAbilityRef; ability: AbilityDef } | undefined;
  if (candidates.length > 0) {
    chosen = weightedPick(
      candidates.map((c) => ({ item: { ref: c.ref, ability: c.ability }, weight: c.weight })),
      rng,
    );
    rngDraws++;
  }

  if (!chosen) {
    // battle.md §4a: "ability = Renderable(Utility.Delay)" — no target-building step at all.
    // (The unconditional queAbility-time redirect still runs downstream in resolveTurn, but with
    // zero enemyTargets it early-returns and draws nothing — targeting-passives.md §A.)
    return {
      ability: gameData.ability("Utility.Delay"),
      args: {},
      enemyTargets: [],
      friendlyTargets: [],
      rngDraws,
    };
  }

  const tp = recordOf(chosen.ability.targetPicker);
  let enemyTargets: string[] = [];
  let friendlyTargets: string[] = [];

  if (tp["selfOnly"] === true) {
    friendlyTargets = [actorId]; // enemyTargets key left unset entirely, battle.md §4b
  } else {
    if (tp["allEnemies"] === true) {
      enemyTargets = [...world.enemyPoolOf(actorId)];
    } else {
      const n = tp["enemyTargets"];
      if (typeof n === "number" && n >= 1) {
        enemyTargets = pickWithoutReplacement(world.enemyPoolOf(actorId), n, rng);
        rngDraws += enemyTargets.length;
      }
    }

    if (tp["allFriends"] === true) {
      friendlyTargets = [...world.friendlyPoolOf(actorId)];
    } else {
      const n = tp["friendlyTargets"];
      if (typeof n === "number" && n >= 1) {
        friendlyTargets = pickWithoutReplacement(world.friendlyPoolOf(actorId), n, rng);
        rngDraws += friendlyTargets.length;
      }
    }
  }

  // battle.md §4b: adjustAbilityArgumentsForLiving: (the taunt redirect, `redirectEnemyTargets`)
  // runs AFTER target-building, as part of the queAbility: call — BattleCore.resolveTurn applies
  // it to this decision's enemyTargets before performing, for AI and player decisions alike.
  return { ability: chosen.ability, args: chosen.ref.arguments, enemyTargets, friendlyTargets, rngDraws };
}
