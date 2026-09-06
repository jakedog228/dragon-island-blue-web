import type { StatName } from "@dib/gamedata";

const f = Math.fround;

export const STATUS_NAMES = ["Sleep", "Paralyze", "Poison", "Confuse"] as const;
export type StatusEffect = (typeof STATUS_NAMES)[number];

export interface StatOnlyBuffSpec {
  sourceId: string;
  sourceLevel: number;
  sourceLevelScalor?: number;
  duration?: number;
  stats?: readonly StatName[];
  statsHelp?: boolean;
  haste?: number;
  stackName?: string;
  statusEffects?: readonly StatusEffect[];
  removeOnHurt?: boolean;
}


export interface ActiveStatOnlyBuff {
  readonly sourceId: string;
  readonly level: number;
  readonly duration: number | undefined;
  durationLeft: number | undefined;
  readonly stats: readonly StatName[];
  readonly statsHelp: boolean;
  readonly haste: number;
  readonly stackName: string | undefined;
  readonly statusEffects: readonly StatusEffect[];
  readonly removeOnHurt: boolean;
}

export function createStatOnlyBuff(spec: StatOnlyBuffSpec): ActiveStatOnlyBuff {
  const scalor = f(spec.sourceLevelScalor ?? 1);
  const level = Math.max(1, Math.round(f(f(spec.sourceLevel) * scalor)));
  const duration = spec.duration === undefined ? undefined : Math.trunc(spec.duration);
  return {
    sourceId: spec.sourceId,
    level,
    duration,
    durationLeft: duration,
    stats: spec.stats ?? [],
    statsHelp: spec.statsHelp ?? true,
    haste: f(spec.haste ?? 0),
    stackName: spec.stackName,
    statusEffects: spec.statusEffects ?? [],
    removeOnHurt: spec.removeOnHurt ?? false,
  };
}


export function statWeight(stat: StatName): number {
  return stat === "Defense" || stat === "Resist" ? f(1.5) : f(1);
}

/** `level*weight`, sign-flipped when the buff is a debuff (`statsHelp:false`). */
function signedStatBonus(level: number, statsHelp: boolean, stat: StatName): number {
  const amount = f(f(level) * statWeight(stat));
  return statsHelp ? amount : f(-amount);
}

export function statOnlyBonus(buff: ActiveStatOnlyBuff, stat: StatName): number {
  if (!buff.stats.includes(stat)) return 0;
  return signedStatBonus(buff.level, buff.statsHelp, stat);
}

export function allowsStatOnlyBuff(
  active: readonly ActiveStatOnlyBuff[],
  incoming: ActiveStatOnlyBuff,
): boolean {
  return !active.some(
    (buff) => buff.stackName !== undefined && buff.stackName === incoming.stackName,
  );
}

export function advanceStatOnlyBuffs(
  active: readonly ActiveStatOnlyBuff[],
  amount: number,
): ActiveStatOnlyBuff[] {
  const remaining: ActiveStatOnlyBuff[] = [];
  for (const buff of active) {
    if (buff.durationLeft === undefined) {
      remaining.push(buff);
      continue;
    }
    buff.durationLeft -= amount;
    if (buff.durationLeft > 0) remaining.push(buff);
  }
  return remaining;
}


export type BuffKind =
  | "statOnly"
  | "poison"
  | "deathSentence"
  | "reflective"
  | "slowProc"
  | "stunProc"
  | "statShift";

/**
 * `extracted/data/Buffs.json` classNames -> the general `kind` this engine models them as
 * (buffs.md §0's registry table). `StunBuff` (`Offensive.Stun`) and `AuraBuff` (`Aura`) have
 * ZERO shipped carriers (buffs.md §6: Stun-the-Buff is only ever built by `StunProcBuff`, which
 * this port implements directly as the `stunProc` kind rather than constructing an inert
 * `StunBuff` child; §9: `AuraBuff` is confirmed dead ObjC data, never referenced by any shipped
 * `buffTypes` array) — instantiating either is a fail-loud error, not a guess.
 */
export function resolveBuffKind(className: string, buffTypePath: string): BuffKind {
  switch (className) {
    case "Buff":
    case "RemoveOnHurtBuff":
      return "statOnly";
    case "DamageOverTimeBuff":
      return "poison";
    case "DeathSentenceBuff":
      return "deathSentence";
    case "ReflectiveBuff":
      return "reflective";
    case "SlowProcBuff":
      return "slowProc";
    case "StunProcBuff":
      return "stunProc";
    case "StatShiftBuff":
      return "statShift";
    case "StunBuff":
      throw new Error(`StunBuff (${buffTypePath}) has zero shipped carriers (buffs.md §6) — not implemented`);
    case "AuraBuff":
      throw new Error(
        `AuraBuff (${buffTypePath}) is dead data, never instantiated by shipped content (buffs.md §9) — not implemented`,
      );
    default:
      throw new Error(`unknown Buff class "${className}" for buff type ${buffTypePath}`);
  }
}

/**
 * Generalized runtime buff instance. Flat shape (kind-specific fields are optional and only
 * populated for their own `kind`) rather than a discriminated union, since `core.ts` needs to
 * mutate `durationLeft`/`poisonRemainder` in place and a flat shape keeps that simple.
 */
export interface ActiveBuff {
  readonly id: number;
  readonly buffType: string; // Buffs.json path, e.g. "Offensive.Poison" — used for events only.
  readonly kind: BuffKind;
  readonly sourceId: string; // the caster/owner ("source" ivar, buffs.md §1.4) — never the target.
  readonly level: number; // max(1, round(f32(sourceLevel)*f32(scalor))) — buffs.md §1.1/§1.4.
  readonly duration: number | undefined;
  durationLeft: number | undefined;
  readonly stackName: string | undefined;
  readonly statusEffects: readonly StatusEffect[]; // static-Buffs.json-dict-only (buffs.md §1.1).
  permanent: boolean; // only ever true via passiveBuffs application (buffs.md §2.3).
  readonly targetPriorityAdjustment: number;

  // kind "statOnly" (plain `Buff` incl. StatOnly/Paralyze/Confuse/Detaunt-family, and
  // `RemoveOnHurtBuff`/Sleep, and every aura/proc-created StatOnly child).
  readonly stats: readonly StatName[];
  readonly statsHelp: boolean;
  readonly haste: number;
  readonly removeOnHurt: boolean;

  // kind "poison" (DamageOverTimeBuff, buffs.md §3).
  poisonPerTimeUnit?: number | undefined;
  poisonRemainder?: number | undefined;
  readonly poisonOriginalDuration?: number | undefined;
  readonly poisonRelatedStat?: StatName | undefined;

  // kind "reflective" (ReflectiveBuff, buffs.md §5).
  readonly fixedReflect?: boolean | undefined;

  // kind "statShift" (StatShiftBuff, buffs.md §8).
  readonly shiftSourceStat?: StatName | undefined;
  readonly shiftDestinationStat?: StatName | undefined;
  readonly shiftSnapshot?: number | undefined;
}

let nextBuffId = 1;
/** Exposed for tests that need a fresh, independent id stream; not used by production code
 *  beyond `createActiveBuff`'s own internal counter. */
export function allocateBuffId(): number {
  return nextBuffId++;
}

export interface GeneralBuffSpec {
  buffType: string;
  kind: BuffKind;
  sourceId: string;
  sourceLevel: number;
  sourceLevelScalor?: number | undefined; // arguments-only in the binary; default 1.0 (buffs.md §1.1).
  duration?: number | undefined; // already resolved (arguments ?? dictionary) and trunc'd by the caller.
  stackName?: string | undefined;
  statusEffects?: readonly StatusEffect[] | undefined;
  targetPriorityAdjustment?: number | undefined;
  permanent?: boolean | undefined;
  stats?: readonly StatName[] | undefined;
  statsHelp?: boolean | undefined;
  haste?: number | undefined;
  removeOnHurt?: boolean | undefined;
  poisonPerTimeUnit?: number | undefined;
  poisonOriginalDuration?: number | undefined;
  poisonRelatedStat?: StatName | undefined;
  fixedReflect?: boolean | undefined;
  shiftSourceStat?: StatName | undefined;
  shiftDestinationStat?: StatName | undefined;
  shiftSnapshot?: number | undefined;
}

/** General-purpose `ActiveBuff` constructor. `core.ts`'s `buildBuff` resolves every
 *  Buffs.json-shape-specific detail (kind, statusEffects, poison roll, statshift snapshot, ...)
 *  and calls this with the final numbers; this function only does the universal
 *  level/duration/id bookkeeping identical to `createStatOnlyBuff`'s formula (buffs.md §1.1). */
export function createActiveBuff(spec: GeneralBuffSpec): ActiveBuff {
  const scalor = f(spec.sourceLevelScalor ?? 1);
  const level = Math.max(1, Math.round(f(f(spec.sourceLevel) * scalor)));
  const duration = spec.duration === undefined ? undefined : Math.trunc(spec.duration);
  return {
    id: allocateBuffId(),
    buffType: spec.buffType,
    kind: spec.kind,
    sourceId: spec.sourceId,
    level,
    duration,
    durationLeft: duration,
    stackName: spec.stackName,
    statusEffects: spec.statusEffects ?? [],
    permanent: spec.permanent ?? false,
    targetPriorityAdjustment: spec.targetPriorityAdjustment ?? 0,
    stats: spec.stats ?? [],
    statsHelp: spec.statsHelp ?? true,
    haste: f(spec.haste ?? 0),
    removeOnHurt: spec.removeOnHurt ?? false,
    poisonPerTimeUnit: spec.poisonPerTimeUnit,
    poisonRemainder: spec.poisonPerTimeUnit !== undefined ? 0 : undefined,
    poisonOriginalDuration: spec.poisonOriginalDuration,
    poisonRelatedStat: spec.poisonRelatedStat,
    fixedReflect: spec.fixedReflect,
    shiftSourceStat: spec.shiftSourceStat,
    shiftDestinationStat: spec.shiftDestinationStat,
    shiftSnapshot: spec.shiftSnapshot,
  };
}

/**
 * `Living.allowAddBuff:` (buffs.md §1.6). SPEC CORRECTION (coordinator, targeting-passives.md
 * §C): `ImmunityAbility` is dead ObjC data — `Passive.Immunity`/`Passive.PseudoImmunity` resolve
 * to plain `class: "Ability"` in the shipped `Abilities.json`, never `ImmunityAbility`, so the
 * `immunities` argument lists authored on ~20+ Jobs.json leaves (CatRider1, the Spirit hero-spirit
 * jobs, etc.) are inert in the original game. This engine therefore implements ONLY the two real
 * gates: (a) the hardcoded boss immunity (Sleep/Paralyze/Confuse, NOT Poison) and (b) the
 * stackName-equality rejection — no third immunity axis.
 */
export function allowAddBuffGeneral(
  active: readonly ActiveBuff[],
  incoming: ActiveBuff,
  opts: { isBoss: boolean },
): boolean {
  if (opts.isBoss && incoming.statusEffects.some((status) => status !== "Poison")) return false;
  if (active.some((buff) => buff.stackName !== undefined && buff.stackName === incoming.stackName)) {
    return false;
  }
  return true;
}

/** `LivingProvider.bonusForStat:`/`StatShiftBuff.bonusForStat:` dispatch (buffs.md §1.1/§8). */
export function bonusForStatGeneral(buff: ActiveBuff, stat: StatName): number {
  switch (buff.kind) {
    case "statOnly":
      return buff.stats.includes(stat) ? signedStatBonus(buff.level, buff.statsHelp, stat) : 0;
    case "statShift": {
      const snapshot = buff.shiftSnapshot ?? 0;
      if (buff.shiftDestinationStat === stat) return f(snapshot);
      if (buff.shiftSourceStat === stat) return f(-snapshot);
      return 0;
    }
    default:
      return 0;
  }
}

/** `LivingProvider.calculateHaste`'s per-buff contribution. Only StatOnly-kind buffs carry a
 *  `haste` ivar (buffs.md §1.1); every other kind contributes 0. */
export function hasteOfBuffGeneral(buff: ActiveBuff): number {
  return buff.kind === "statOnly" ? buff.haste : 0;
}

/** `Buff.notifyBattleTimePassed:`'s duration countdown (buffs.md §1.3), generalized. Mutates
 *  `buff.durationLeft` in place and reports whether the buff just expired this tick. A buff with
 *  no `duration` key at all (`durationLeft === undefined`) never expires. */
export function advanceActiveBuffDuration(buff: ActiveBuff, amount: number): "active" | "expired" {
  if (buff.durationLeft === undefined) return "active";
  buff.durationLeft -= amount;
  return buff.durationLeft > 0 ? "active" : "expired";
}

export interface PoisonTickResult {
  amount: number;
  remainder: number;
}

/**
 * `DamageOverTimeBuff.notifyBattleTimePassed:`'s per-tick math (buffs.md §3): `raw =
 * f32(f32(perTimeUnit*f32(elapsed)) + remainder)`; `amount = trunc toward zero`; `remainder =
 * f32(raw - f32(amount))`. Pure — `core.ts` handles the resulting `hitWithDamage:`-equivalent
 * pipeline and the mutation of `buff.poisonRemainder`.
 */
export function poisonTick(perTimeUnit: number, remainderIn: number, elapsed: number): PoisonTickResult {
  const raw = f(f(perTimeUnit * f(elapsed)) + remainderIn);
  const amount = Math.trunc(raw);
  const remainder = f(raw - f(amount));
  return { amount, remainder };
}

/**
 * `ReflectiveBuff.notifyLiving:tookDamage:`'s amount formulas (buffs.md §5):
 * `fixedReflectAmount = round(f32(source.level)*1.0f)`; `percentReflect =
 * round(f32(incomingAmount) * f32(f32(source.level)*0.01f))`. `buff.level` already equals
 * `source.level` for both shipped carriers (`Offensive.FixedReflection`/`PercentReflection`
 * never set a `sourceLevelScalor` argument, so the general level formula's scalor is always the
 * 1.0 default and degenerates to the raw source level) — see buff.ts's `createActiveBuff`.
 */
export function reflectAmount(buff: ActiveBuff, incomingAmount: number): number {
  if (buff.fixedReflect) return Math.round(f(buff.level));
  return Math.round(f(f(incomingAmount) * f(f(buff.level) * f(0.01))));
}

/** `StunProcBuff` (buffs.md §7): same flat `level*20` formula as `StunBuff` (buffs.md §6),
 *  reused here since this engine implements `Offensive.Stun`'s only real trigger (`StunProcBuff`)
 *  directly rather than constructing an inert child `StunBuff`. */
export function stunProcDelay(level: number): number {
  return level * 20;
}

/** `SlowProcBuff` (buffs.md §7): `float32(level) / 60.0f`. */
export function slowProcHaste(level: number): number {
  return f(f(level) / f(60.0));
}
