


import type { AbilityDef, Element, GameData, MonsterDef, StatName } from "@dib/gamedata";
import type { Rng } from "./rng.js";
import { TimedQueue, abilityTimeCost, initialBattleDelay } from "./scheduler.js";
import {
  blockUseReason,
  performAbility,
  type AbilityUse,
  type BattleWorld,
  type BuffListEntry,
  type SummonHpStyle,
} from "./ability.js";
import { parseAbilityArgument } from "./abilityArgs.js";
import { baseStat, baseStatRaw } from "./stats.js";
import { spiritCombatLevel } from "./spirit.js";
import { soulStoneBonusForStat } from "./soulStone.js";
import { applyDamage, rollDamage } from "./damage.js";
import { redirectEnemyTargets, type AiDecision, type AiWorld } from "./ai.js";
import {
  battleLivingId,
  type BattleEvent,
  type BattleReport,
  type CollateralBuffCause,
  type CollateralHpCause,
  type PlayerBattleTerminalSnapshot,
  type TeamMemberSetup,
} from "./events.js";
import { captureChance, type CaptureCardLevel, type CaptureStatus } from "./capture.js";
import { xpAwardPerParticipant } from "./xp.js";
import {
  STATUS_NAMES,
  allowAddBuffGeneral,
  advanceActiveBuffDuration,
  bonusForStatGeneral,
  createActiveBuff,
  hasteOfBuffGeneral,
  poisonTick,
  reflectAmount,
  resolveBuffKind,
  slowProcHaste,
  stunProcDelay,
  type ActiveBuff,
  type ActiveStatOnlyBuff,
  type StatOnlyBuffSpec,
  type StatusEffect,
} from "./buff.js";

const STAT_NAMES: readonly StatName[] = ["Attack", "Defense", "Magic", "MaxHP", "Resist", "Speed"];

/** Recursion bound past which the dead/destroyed-front skip loop throws (battle.md §1: the
 *  binary asserts "Battle stuck in infinite loop" past 11 `advanceQueWithCounter:` recursions). */
const MAX_FRONT_SKIPS = 11;

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" ? v : fallback;
}

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function statNameOf(value: unknown): StatName {
  if (
    value === "Attack" ||
    value === "Defense" ||
    value === "Magic" ||
    value === "MaxHP" ||
    value === "Resist" ||
    value === "Speed"
  ) {
    return value;
  }
  throw new Error(`StatShiftBuff: unknown stat ${String(value)}`);
}

/** `Buff.statusEffects` (buffs.md §1.1): static-Buffs.json-dict-only, index 4 (unknown name)
 *  silently dropped. */
function statusEffectsFromStatic(v: unknown): StatusEffect[] {
  if (v === null || typeof v !== "object") return [];
  const dict = v as Record<string, unknown>;
  return STATUS_NAMES.filter((name) => dict[name] === true);
}

/** A living's own Passive.Aura job ability, pre-resolved at construction (buffs.md §9). */
interface AuraSpec {
  buffTypes: string[];
  buffArguments: Array<Record<string, unknown> | undefined>;
}

/** One buff this living's own aura granted to a teammate, tracked so it can be precisely
 *  removed when the owner leaves battle (buffs.md §9's `grantedBuffs` ivar). */
interface AuraGrant {
  recipientId: string;
  buffId: number;
  buffType: string;
}

/** An equipped soul stone, resolved at construction (events.ts `SoulStoneSetup` + the Items.json
 *  `SoulStoneDef` its element selects). Immutable except for the one native mutation path:
 *  Desoul's consume (`desoulSummon` below, soulstones.md §7.2/§10.5) clears the whole slot. */
interface EquippedSoulStone {
  element: Element;
  level: number;
  enabledStats: readonly StatName[];
  sourceType: string | undefined;
}

interface LivingState {
  id: string;
  sourceInstanceId: string | undefined;
  team: 0 | 1;
  shortType: string;
  monster: MonsterDef;
  level: number;
  baseStatsRaw: Record<StatName, number>;
  /** Item slot "Monster" content — at most one (RootJob.slots, soulstones.md §4.4). */
  soulStone: EquippedSoulStone | undefined;
  /** Permanent player-provider (hero skill + Gem) Buff children — see TeamMemberSetup.playerBuffs.
   *  Held apart from `buffs` because they are durable party state owned by WorldTripParty, not
   *  battle-runtime instances: nothing in a battle adds, stacks, or expires them. */
  playerBuffs: Partial<Record<StatName, number>> | undefined;
  buffs: ActiveBuff[];
  timeInCombat: number;
  killsMade: number;
  boss: boolean;
  element: Element;
  maxHp: number;
  hp: number;
  dead: boolean;
  capturable: boolean;
  captureAttemptMade: boolean;
  captured: boolean;
  /** Set by every `stripBuffsOnLeaveBattle` call site, i.e. exactly the native
   *  `-[Team fireMonsterLeft:]` transitions. Reported through `playerTerminalSnapshot`. */
  leftBattle: boolean;
  auraSpec: AuraSpec | undefined;
  auraGrants: AuraGrant[];


  berserk: boolean;
  /** Only HeroDisplay's native Spirit summon is autonomous on team 0. */
  nativeSpirit: boolean;
  /** Native `Monster.summoned`: AddMonster/CallMonster creations do not receive Job XP. */
  summoned: boolean;
  /** Native `Monster.noReward`: AddMonster/CallMonster creations grant no XP when defeated. */
  noReward: boolean;
}

/** Immutable reward fields read by `BattleNode.performAwardLogic` after battle resolution. */
export interface BattleXpLivingState {
  shortType: string;
  level: number;
  summoned: boolean;
  noReward: boolean;
}

/** Exact source collections and result produced for `BattleNode.performAwardLogic`. */
export interface PostBattleXpSummary {
  participantIds: string[];
  awardedIds: string[];
  defeatedIds: string[];
  amount: number;
}

export interface ScriptedAbilityStep {
  /** Defaults to the queued ability. Supplying another path lets a mod compose shipped or
   * mod-authored mechanics without a new engine component. */
  readonly abilityPath?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly enemyTargets: readonly string[];
  readonly friendlyTargets: readonly string[];
}

export interface ScriptedAbilityStepResult {
  readonly events: BattleEvent[];
}

interface OpenScriptedTurn {
  actor: LivingState;
  decision: AiDecision;
}

export class BattleCore {
  private readonly data: GameData;
  private readonly rng: Rng;
  private readonly fightingGroupSize: number;
  private readonly blockCapture: boolean;

  private readonly livings = new Map<string, LivingState>();
  /** Construction-time team-0 roster only. Summons and AddMonster creations never enter the
   * durable between-encounter projection. */
  private readonly initialPlayerLivingIds: string[] = [];
  private readonly initialPlayerSourceIds = new Set<string>();
  /** `Team.monsterMembers` — the active fighting slots (battle.md §2), index 0/1 = team number. */
  private readonly active: [string[], string[]] = [[], []];
  /** `Team.replacementMembers` — the reserve bench. */
  private readonly bench: [string[], string[]] = [[], []];
  /** `Team.summon` (ivar[4], soulstones.md §10.1) — the single per-team summon slot, entirely
   *  OUTSIDE the `fightingGroupSize` cap. Joins `targetableMembers` (the aiWorld pools below)
   *  additively but never `monsterMembers`, so it cannot hold off the win/loss check. */
  private readonly summonSlot: [string | undefined, string | undefined] = [undefined, undefined];
  /** `Team.deadMembers` — append-only. */
  private readonly deadMembers: [string[], string[]] = [[], []];

  private readonly capturedMembers: string[] = [];

  private readonly queue = new TimedQueue<string>();
  private readonly eventLog: BattleEvent[] = [];
  private winnerValue: 0 | 1 | undefined;
  private retreatedValue = false;
  /** Next per-team `battleLivingId` construction index for mid-battle summons (AddMonster/
   *  CallMonster) — continues past the initial roster so ids stay globally unique. */
  private readonly nextConstructionIndex: [number, number] = [0, 0];
  /** `UserSavedData`'s silver — a single global player-save wallet in the binary, spent by
   *  SpendSilverAbilityComponent regardless of which side casts (components-full.md §6). */
  private silverAmount: number;
  /** `Battle` ivar[9] (battle.md "guaranteed retreat"): armed by `notifyAbilityEvent:1`
   *  (EscapeAbilityComponent), consumed right after the arming ability completes. */
  private pendingGuaranteedRetreat = false;
  private openScriptedTurn: OpenScriptedTurn | undefined;

  /** See battle.ts header, deviation #6. Stashed just before each `performAbility` call; a
   *  fallback only — every damage-dealing `applyHpDelta` call site now passes `opts.element`
   *  explicitly (buffs.md's poison/reflect ticks need a *different* element than the acting
   *  monster's own, so the ambient stash alone stopped being sufficient). */
  private pendingDamageElement: Element | undefined;

  constructor(
    data: GameData,
    teams: [TeamMemberSetup[], TeamMemberSetup[]],
    rng: Rng,
    opts?: { fightingGroupSize?: number; blockCapture?: boolean; silver?: number },
  ) {
    this.data = data;
    this.rng = rng;
    this.fightingGroupSize = opts?.fightingGroupSize ?? 3;
    this.blockCapture = opts?.blockCapture ?? false;
    this.silverAmount = opts?.silver ?? 0;

    if (teams[0].length === 0 || teams[1].length === 0) {
      throw new Error("HeadlessBattle: both teams need at least one monster");
    }
    this.nextConstructionIndex = [teams[0].length, teams[1].length];

    for (const teamNum of [0, 1] as const) {
      teams[teamNum].forEach((setup, idx) => {
        const monster = data.monsterByShortType(setup.shortType);
        const id = battleLivingId(teamNum, idx, setup.shortType);
        const baseStatsRaw = {} as Record<StatName, number>;
        for (const stat of STAT_NAMES) {
          const flatBonus = setup.flatStatBonuses?.[stat] ?? 0;
          if (!Number.isFinite(flatBonus)) {
            throw new Error(
              `HeadlessBattle: ${setup.shortType} flatStatBonuses.${stat} must be finite; ` +
                `got ${String(flatBonus)}`,
            );
          }
          baseStatsRaw[stat] = Math.fround(
            baseStatRaw(monster, stat, setup.level) + Math.fround(flatBonus),
          );
        }
        // An equipped stone joins the valueForCachedStat accumulator as an ordinary child
        // (soulstones.md §4.5), so MaxHP/hp are set through statOf AFTER construction (below),
        // not the stone-free baseStat — matching Living.setCreationFile:'s
        // `hp = valueForCachedStat(0)`.
        const soulStone: EquippedSoulStone | undefined = setup.soulStone
          ? {
              element: setup.soulStone.element,
              level: setup.soulStone.level,
              enabledStats: this.data.soulStoneByElement(setup.soulStone.element).enabledStats,
              sourceType: setup.soulStone.sourceType,
            }
          : undefined;
        // Fail-fast guard for hand-written setups: a Desoul cast reads the stone's sourceType
        // to know WHAT to revive (soulstones.md §10.6), and a native stone always carries one.
        // Surfacing the omission here keeps a mid-battle cast from ever throwing.
        if (
          soulStone !== undefined &&
          soulStone.sourceType === undefined &&
          data.jobAbilitiesOrEmpty(setup.shortType).some((ref) => ref.type === "Utility.Desoul")
        ) {
          throw new Error(
            `HeadlessBattle: ${setup.shortType} carries Utility.Desoul — its soul stone needs ` +
              "sourceType (the species Desoul revives)",
          );
        }
        let playerBuffs: Partial<Record<StatName, number>> | undefined;
        if (setup.playerBuffs !== undefined) {
          const bonuses: Partial<Record<StatName, number>> = {};
          for (const stat of STAT_NAMES) {
            const bonus = setup.playerBuffs[stat];
            if (bonus === undefined) continue;
            if (!Number.isFinite(bonus)) {
              throw new Error(
                `HeadlessBattle: ${setup.shortType} playerBuffs.${stat} must be finite; got ${String(bonus)}`,
              );
            }
            bonuses[stat] = bonus;
          }
          playerBuffs = bonuses;
        }
        const living: LivingState = {
          id,
          sourceInstanceId: setup.sourceInstanceId,
          team: teamNum,
          shortType: setup.shortType,
          monster,
          level: setup.level,
          baseStatsRaw,
          soulStone,
          playerBuffs,
          buffs: [],
          timeInCombat: 0,
          killsMade: 0,
          boss: setup.boss ?? false,
          element: monster.element,
          maxHp: 0, // set via statOf below, once the (possibly stone-bearing) state exists
          hp: 0,
          dead: false,
          capturable: setup.capturable ?? true,
          captureAttemptMade: false,
          captured: false,
          leftBattle: false,
          auraSpec: this.resolveAuraSpec(setup.shortType),
          auraGrants: [],
          berserk: this.hasBerserkAbility(setup.shortType),
          nativeSpirit: false,
          summoned: false,
          noReward: false,
        };

        living.maxHp = this.statOf(living, "MaxHP");
        if (setup.currentHp !== undefined) {
          if (!Number.isInteger(setup.currentHp) || setup.currentHp < 1) {
            throw new Error(
              `HeadlessBattle: ${setup.shortType} currentHp must be a positive integer; ` +
                `got ${setup.currentHp}`,
            );
          }
          living.hp = setup.currentHp;
        } else {
          living.hp = living.maxHp;
        }
        if (this.livings.has(id)) {
          throw new Error(`HeadlessBattle: duplicate living id ${id} (two identical setups at the same index?)`);
        }
        this.livings.set(id, living);
        if (teamNum === 0) {
          if (
            setup.sourceInstanceId !== undefined &&
            this.initialPlayerSourceIds.has(setup.sourceInstanceId)
          ) {
            throw new Error(`HeadlessBattle: duplicate player sourceInstanceId ${setup.sourceInstanceId}`);
          }
          this.initialPlayerLivingIds.push(id);
          if (setup.sourceInstanceId !== undefined) {
            this.initialPlayerSourceIds.add(setup.sourceInstanceId);
          }
        }
        if (this.active[teamNum].length < this.fightingGroupSize) this.active[teamNum].push(id);
        else this.bench[teamNum].push(id);
      });
    }
  }

  private livingOrThrow(id: string): LivingState {
    const living = this.livings.get(id);
    if (!living) throw new Error(`HeadlessBattle: unknown living id ${id}`);
    return living;
  }

  private emit(event: BattleEvent): void {
    this.eventLog.push(event);
  }

  private rawStatOf(living: LivingState, stat: StatName): number {
    let raw = living.baseStatsRaw[stat];
    // Children join valueForCachedStat:'s float32 accumulator in attach order (Living.addChild:
    // appends — soulstones.md §4.5): Job (already inside baseStatsRaw's term2) -> equipped Item
    // (pre-battle) -> Buffs. The player's permanent hero-skill/Gem buffs are the first Buff
    // children (`-[Player applyPlayerBuffsToMonsters:]` addChild:s them outside battle), so they
    // accumulate after the stone and before anything a battle attaches.
    if (living.soulStone) {
      raw = Math.fround(
        raw + soulStoneBonusForStat(living.soulStone.level, living.soulStone.enabledStats, stat),
      );
    }
    if (living.playerBuffs) {
      raw = Math.fround(raw + (living.playerBuffs[stat] ?? 0));
    }
    for (const buff of living.buffs) raw = Math.fround(raw + bonusForStatGeneral(buff, stat));
    return raw;
  }

  private statOf(living: LivingState, stat: StatName): number {
    return Math.max(0, Math.round(this.rawStatOf(living, stat)));
  }

  private recalculateMaxHp(living: LivingState): void {
    const raw = this.rawStatOf(living, "MaxHP");


    if (raw < living.hp) living.hp = Math.trunc(raw);
    living.maxHp = Math.max(0, Math.round(raw));
  }

  private statsOf(id: string): Record<StatName, number> {
    const living = this.livingOrThrow(id);
    const stats = {} as Record<StatName, number>;
    for (const stat of STAT_NAMES) stats[stat] = this.statOf(living, stat);
    return stats;
  }

  private hasteOfLiving(living: LivingState): number {
    let haste = 0;
    for (const buff of living.buffs) haste = Math.fround(haste + hasteOfBuffGeneral(buff));
    return haste;
  }

  // -----------------------------------------------------------------------------------------
  // Generalized buff construction (buffs.md §2/§3/§5/§7/§8/§9) and the allowAddBuff chain (§1.6).

  /** `BerserkAbility` detection (targeting-passives.md §C — the sole shipped carrier is
   *  `Humanoid.Yeti`'s `Passive.Berserk`). `SelfDestructAbility` (zero shipped carriers) stays
   *  fail-loud here rather than silently ignored. */
  private hasBerserkAbility(shortType: string): boolean {
    let berserk = false;
    for (const ref of this.data.jobAbilitiesOrEmpty(shortType)) {
      const className = this.data.ability(ref.type).className;
      if (className === "BerserkAbility") berserk = true;
      if (className === "SelfDestructAbility") {
        throw new Error(
          `SelfDestructAbility on ${shortType}: zero shipped carriers exist (targeting-passives.md §C) — not implemented`,
        );
      }
    }
    return berserk;
  }

  /** Resolves a living's own `Passive.Aura` job ability/abilities into `AuraSpec` (buffs.md §9).
   *  `hurt:true` is unshipped (fail loud, per the task brief); malformed `buffTypes`/
   *  `buffArguments` (length mismatch) makes that one aura ref inert, mirroring the binary's own
   *  "forces help=hurt=false" fallback rather than throwing on data no real carrier exercises. */
  private resolveAuraSpec(shortType: string): AuraSpec | undefined {
    const buffTypes: string[] = [];
    const buffArguments: Array<Record<string, unknown> | undefined> = [];
    for (const ref of this.data.jobAbilitiesOrEmpty(shortType)) {
      if (this.data.ability(ref.type).className !== "AuraAbility") continue;
      const args = ref.arguments;
      if (args["hurt"] === true) {
        throw new Error(
          `AuraAbility ${ref.type} on ${shortType} sets hurt:true — zero shipped carriers use this (buffs.md §9), not implemented`,
        );
      }
      if (args["help"] !== true) continue;
      const types = args["buffTypes"];
      const argsList = args["buffArguments"];
      if (!Array.isArray(types) || !Array.isArray(argsList) || types.length !== argsList.length) continue;
      for (let i = 0; i < types.length; i++) {
        const t = types[i];
        if (typeof t !== "string") continue;
        buffTypes.push(t);
        buffArguments.push(recordOf(argsList[i]));
      }
    }
    return buffTypes.length > 0 ? { buffTypes, buffArguments } : undefined;
  }

  /**
   * `Buff._initWithName:dictionary:arguments:` + `setupBuffFromLivingProvider:sourceLiving:`
   * (buffs.md §1.1/§1.4), generalized across every concrete subclass (§3/§5/§8). `sourceId` is
   * always the buff's caster/owner (never the target). `opts.permanent` is threaded through only
   * by `applyPassiveBuffs` (buffs.md §2.3 — "the ONLY call site... that sets permanent").
   */
  private buildBuff(
    entry: BuffListEntry,
    sourceId: string,
    opts?: { permanent?: boolean },
  ): ActiveBuff {
    const def = this.data.buff(entry.type);
    const rawStatic = def.raw;
    const args = entry.arguments ?? {};
    if (args["chance"] !== undefined) {


      throw new Error(`authored buff "${entry.type}" has an unsupported "chance" key`);
    }
    const kind = resolveBuffKind(def.className, entry.type);

    const durationRaw = args["duration"] ?? rawStatic["duration"];
    const hasDuration = args["duration"] !== undefined || rawStatic["duration"] !== undefined;
    const duration = hasDuration ? Math.trunc(durationRaw as number) : undefined;

    const scalor = numberOr(args["sourceLevelScalor"], 1); // arguments-only default (buffs.md §1.1)
    const source = this.livingOrThrow(sourceId);

    const statusEffects = statusEffectsFromStatic(rawStatic["statusEffects"]);
    const stackName =
      (args["stackName"] as string | undefined) ?? (rawStatic["stackName"] as string | undefined);
    const targetPriorityAdjustment = numberOr(
      args["targetPriorityAdjustment"],
      numberOr(rawStatic["targetPriorityAdjustment"], 0),
    );

    const base = {
      buffType: entry.type,
      sourceId,
      sourceLevel: source.level,
      sourceLevelScalor: scalor,
      duration,
      stackName,
      statusEffects,
      targetPriorityAdjustment,
      permanent: opts?.permanent ?? false,
    };

    switch (kind) {
      case "statOnly": {
        const statsDict = recordOf(args["stats"] ?? rawStatic["stats"]);
        const stats = (Object.keys(statsDict) as StatName[]).filter((s) => statsDict[s] === true);
        const statsHelp = args["statsHelp"] !== false;
        const haste = numberOr(args["haste"] ?? rawStatic["haste"], 0);
        const removeOnHurt = def.className === "RemoveOnHurtBuff";
        return createActiveBuff({ ...base, kind, stats, statsHelp, haste, removeOnHurt });
      }
      case "poison": {
        if (!hasDuration) {
          throw new Error(
            `DamageOverTimeBuff ${entry.type} has no duration (buffs.md §3 — fail-loud in the original binary too)`,
          );
        }
        const roll = recordOf(args["roll"]);
        const relatedStatRaw = roll["relatedStat"];
        if (typeof relatedStatRaw !== "string") {
          throw new Error(`DamageOverTimeBuff ${entry.type} missing roll.relatedStat`);
        }
        const relatedStat = statNameOf(relatedStatRaw);
        const abilityScalor = numberOr(roll["abilityScalor"], 1);
        const stat = this.statOf(source, relatedStat);
        // buffs.md §3: ONE rng draw at buff-creation time, numTargets hardcoded 1, NO
        // activationLength scaling (`rollForLivingProvider:living:numTargets:1`, no
        // UsableAbility context).
        const totalRoll = rollDamage(
          {
            abilityScalor,
            stat,
            activationLength: 0,
            scaleByActivationLength: false,
            randomness: 0.2,
            numTargets: 1,
          },
          this.rng,
        );
        const perTimeUnit = Math.fround(Math.fround(totalRoll) / Math.fround(duration!));
        return createActiveBuff({
          ...base,
          kind,
          poisonPerTimeUnit: perTimeUnit,
          poisonOriginalDuration: duration!,
          poisonRelatedStat: relatedStat,
        });
      }
      case "reflective": {
        const fixedReflect = rawStatic["fixedReflect"] === true;
        return createActiveBuff({ ...base, kind, fixedReflect });
      }
      case "statShift": {
        const sourceStat = statNameOf(args["sourceStat"]);
        const destinationStat = statNameOf(args["destinationStat"]);
        const shiftSnapshot = this.statOf(source, sourceStat);
        return createActiveBuff({
          ...base,
          kind,
          shiftSourceStat: sourceStat,
          shiftDestinationStat: destinationStat,
          shiftSnapshot,
        });
      }
      case "deathSentence":
      case "slowProc":
      case "stunProc":
        return createActiveBuff({ ...base, kind });
    }
  }

  /** `Living.addChild:`'s `allowAddBuff:` gate + attach + `buffAdded` event (buffs.md §1.6).
   *  Returns whether the buff actually attached (rejected buffs are never attached and emit no
   *  event, buffs.md §1.6/§3 of the task brief). `cause` (events.ts `CollateralBuffCause`) is
   *  stamped by the attach paths that run OUTSIDE an ability's own phase dispatch (proc/revenge/
   *  aura/passive) so renderers never mistake such an attach for the acting cast's result;
   *  ability-pipeline callers (`addStatOnlyBuff`, `applyAuthoredBuff`) leave it unset. */
  private tryAttachBuff(target: LivingState, buff: ActiveBuff, cause?: CollateralBuffCause): boolean {
    const allowed = allowAddBuffGeneral(target.buffs, buff, { isBoss: target.boss });
    if (!allowed) return false;
    target.buffs.push(buff);
    if (buff.kind === "statOnly" && buff.stats.includes("MaxHP")) this.recalculateMaxHp(target);
    this.emit({
      type: "buffAdded",
      target: target.id,
      source: buff.sourceId,
      buffType: buff.buffType,
      statusEffects: buff.statusEffects,
      permanent: buff.permanent,
      ...(buff.duration !== undefined ? { duration: buff.duration } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
    return true;
  }

  /** `-[Ability applyPassiveBuffsToLiving:]` (buffs.md §2.3): every job ability's own
   *  ability-dict-level `passiveBuffs` attaches to the living itself, `permanent: true`. */
  private applyPassiveBuffs(living: LivingState): void {
    for (const ref of this.data.jobAbilitiesOrEmpty(living.shortType)) {
      const passives = this.data.ability(ref.type).raw["passiveBuffs"];
      if (!Array.isArray(passives)) continue;
      for (const entry of passives as BuffListEntry[]) {
        this.tryAttachBuff(living, this.buildBuff(entry, living.id, { permanent: true }), "passive");
      }
    }
  }

  /** `-[AuraAbility applyBuffsToLiving:]` (buffs.md §9): grant `owner`'s aura pairs to
   *  `recipient` (owner included when `recipient === owner`), tracking each successfully-attached
   *  instance in `owner.auraGrants` for precise removal later. */
  private grantAuraToOne(owner: LivingState, recipient: LivingState): void {
    const spec = owner.auraSpec;
    if (!spec) return;
    for (let i = 0; i < spec.buffTypes.length; i++) {
      const entry: BuffListEntry = { type: spec.buffTypes[i]!, arguments: spec.buffArguments[i] };
      const buff = this.buildBuff(entry, owner.id);
      if (this.tryAttachBuff(recipient, buff, "aura")) {
        owner.auraGrants.push({ recipientId: recipient.id, buffId: buff.id, buffType: buff.buffType });
      }
    }
  }

  /** `-[AuraAbility applyBuffsToTeam:]` (buffs.md §9): every currently-active member of
   *  `owner`'s team, owner included. */
  private grantAuraToTeam(owner: LivingState): void {
    for (const id of this.active[owner.team]) this.grantAuraToOne(owner, this.livingOrThrow(id));
  }


  private seedEnterBattle(): void {
    for (const teamNum of [0, 1] as const) {
      for (const id of this.active[teamNum]) this.applyPassiveBuffs(this.livingOrThrow(id));
    }
    for (const teamNum of [0, 1] as const) {
      for (const id of this.active[teamNum]) {
        const living = this.livingOrThrow(id);
        if (living.auraSpec) this.grantAuraToTeam(living);
      }
    }
  }

  /**
   * Mid-battle bench-promotion battle-entry (buffs.md §2.3's "a bench member at its promotion",
   * §9's `notifyTeam:addedMonster:` single-monster apply): the promoted living's own
   * passiveBuffs; if it owns an aura, that aura now grants to the WHOLE current team (itself
   * included — buffs.md #2's own "enters battle" hook, reasonably fired here too); separately,
   * every OTHER already-active aura owner grants its aura to the promoted living alone (it wasn't
   * part of the team when those owners' own team-wide grant originally ran, so it never received
   * theirs until now).
   */
  private promoteEnterBattle(id: string): void {
    const living = this.livingOrThrow(id);
    this.applyPassiveBuffs(living);
    let grantedOwnAura = false;
    for (const otherId of this.active[living.team]) {
      if (otherId === id) {
        if (living.auraSpec) this.grantAuraToTeam(living);
        grantedOwnAura = true;
        continue;
      }
      const other = this.livingOrThrow(otherId);
      if (other.auraSpec) this.grantAuraToOne(other, living);
    }
    // A summon-slot arrival is NOT in the active roster, so the loop's own-aura branch can't
    // fire for it; grant its aura over the team like any other entrant. (Native summon-vs-aura
    // interplay is unexercised by shipped data — no Desoul/Spirit carrier has an aura — so this
    // mirrors the ordinary notifyEnteredBattleFromTeam fanout rather than a traced special case.)
    if (!grantedOwnAura && living.auraSpec && this.summonSlot[living.team] === id) {
      this.grantAuraToTeam(living);
    }
  }

  /** Strips ALL buffs (including permanent) and this living's own aura grants — `Living.
   *  notifyLeftBattleFromTeam:`'s `removeBuffsIncludingPermanent:1` plus `AuraAbility.
   *  notifyLeftBattleWithLiving:fromTeam:`'s `[grantedBuffs removeAllObjects]` (buffs.md §1.7/§9).
   *  Called for both death and capture. */
  private stripBuffsOnLeaveBattle(living: LivingState): void {
    // Native `removeBuffsIncludingPermanent:YES` also destroys the PERMANENT player-skill/Gem
    // children that `-[Player applyPlayerBuffsToMonsters:]` attached outside battle. Those are
    // durable party state here, so record the leave and let the party drop them at the terminal
    // boundary (they are restored at the next apply site — town, Save Me, equip, bench add).
    living.leftBattle = true;
    const before = living.buffs;
    if (before.length > 0) {
      living.buffs = [];
      for (const buff of before) {
        this.emit({
          type: "buffRemoved",
          target: living.id,
          buffType: buff.buffType,
          statusEffects: buff.statusEffects,
          reason: "leftBattle",
        });
      }
      if (before.some((buff) => buff.kind === "statOnly" && buff.stats.includes("MaxHP"))) {
        this.recalculateMaxHp(living);
      }
    }
    if (living.auraGrants.length > 0) {
      for (const grant of living.auraGrants) {
        const recipient = this.livings.get(grant.recipientId);
        if (!recipient) continue;
        const idx = recipient.buffs.findIndex((buff) => buff.id === grant.buffId);
        if (idx === -1) continue; // already gone (e.g. stacking rejection elsewhere) — no-op, buffs.md §9
        const [removed] = recipient.buffs.splice(idx, 1);
        this.emit({
          type: "buffRemoved",
          target: recipient.id,
          buffType: grant.buffType,
          statusEffects: removed!.statusEffects,
          // A consequence of the GRANTER leaving battle, not a StatusRemove/RemoveAllBuffs cast
          // (native: AuraAbility.notifyLeftBattleWithLiving:fromTeam:'s silent removeAllObjects —
          // no AbilityResult, no cast flash). MUST be "leftBattle", not "removed": the ability
          // renderer treats `reason:"removed"` as "this cast's own strip" and plays the acting
          // move's animation on the target. Emitting "removed" here painted the killer's move
          // (e.g. Imp's "Death"/Plague) onto every teammate whose aura buff this death revoked.
          reason: "leftBattle",
        });
      }
      living.auraGrants = [];
    }
  }

  /** `Ability.notifyLiving:diedWithAbilityPerformEnvironment:sourceOfDeath:` (buffs.md §2.2):
   *  every job-ref `arguments.revengeBuffs`/ability-dict `revengeBuffs` entry of the DEAD living
   *  applies to the killer, sourced from the DEAD living (so the poison setup roll uses ITS
   *  Attack, not the killer's). Only reachable when `sourceOfDeath` is a real Living id (never
   *  for sacrifice's nil-source self-kill or a reflect kill — see `handleDeath`'s caller). */
  private applyRevengeBuffs(deadLiving: LivingState, killerId: string): void {
    const killer = this.livings.get(killerId);
    if (!killer || killer.dead || killer.captured) return; // dead-target skip, buffs.md §2.1
    const entries: BuffListEntry[] = [];
    for (const ref of this.data.jobAbilitiesOrEmpty(deadLiving.shortType)) {
      const refList = ref.arguments["revengeBuffs"];
      if (Array.isArray(refList)) entries.push(...(refList as BuffListEntry[]));
      const abilityRevenge = this.data.ability(ref.type).raw["revengeBuffs"];
      if (Array.isArray(abilityRevenge)) entries.push(...(abilityRevenge as BuffListEntry[]));
    }
    for (const entry of entries) {
      this.tryAttachBuff(killer, this.buildBuff(entry, deadLiving.id), "revenge");
    }
  }

  private statusesOfLiving(living: LivingState): StatusEffect[] {
    const statuses: StatusEffect[] = [];
    for (const status of STATUS_NAMES) {
      if (living.buffs.some((buff) => buff.statusEffects.includes(status))) statuses.push(status);
    }
    return statuses;
  }

  /** `world.addStatOnlyBuff` — the pre-existing StatMod/Haste/Paralyze/Sleep/Confuse call sites
   *  in ability.ts (unchanged mechanics/RNG). Builds a `kind: "statOnly"` general buff; the
   *  buffType is inferred from the (always-singular, in these call sites) status flag so
   *  `buffAdded`/`buffRemoved` events carry the real Buffs.json path rather than a generic
   *  "StatOnly" for Paralyze/Sleep/Confuse (buffs.md #13's event-routing ask; a reasonable
   *  port-level inference — the BattleWorld interface itself is frozen, so no call site changes). */
  private addStatOnlyBuff(targetId: string, spec: StatOnlyBuffSpec): boolean {
    const target = this.livingOrThrow(targetId);
    const buffType = inferStatOnlyBuffType(spec.statusEffects);
    const incoming = createActiveBuff({
      buffType,
      kind: "statOnly",
      sourceId: spec.sourceId,
      sourceLevel: spec.sourceLevel,
      sourceLevelScalor: spec.sourceLevelScalor,
      duration: spec.duration,
      stackName: spec.stackName,
      statusEffects: spec.statusEffects,
      stats: spec.stats,
      statsHelp: spec.statsHelp,
      haste: spec.haste,
      removeOnHurt: spec.removeOnHurt,
    });
    return this.tryAttachBuff(target, incoming);
  }

  private removeStatusBuffs(id: string, statuses: readonly StatusEffect[]): void {
    const living = this.livingOrThrow(id);
    const before = living.buffs;
    const removed = before.filter((buff) => buff.statusEffects.some((s) => statuses.includes(s)));
    if (removed.length === 0) return;
    living.buffs = before.filter((buff) => !buff.statusEffects.some((s) => statuses.includes(s)));
    for (const buff of removed) {
      this.emit({
        type: "buffRemoved",
        target: id,
        buffType: buff.buffType,
        statusEffects: buff.statusEffects,
        reason: "removed",
      });
    }
  }

  private removeAllBuffs(id: string): void {
    const living = this.livingOrThrow(id);
    const before = living.buffs;
    const removed = before.filter((buff) => !buff.permanent);
    if (removed.length === 0) return;
    living.buffs = before.filter((buff) => buff.permanent);
    const maxHpChanged = removed.some((buff) => buff.kind === "statOnly" && buff.stats.includes("MaxHP"));
    for (const buff of removed) {
      this.emit({
        type: "buffRemoved",
        target: id,
        buffType: buff.buffType,
        statusEffects: buff.statusEffects,
        reason: "removed",
      });
    }
    if (maxHpChanged) this.recalculateMaxHp(living);
  }

  /** `DamageOverTimeBuff.notifyBattleTimePassed:` (buffs.md §3), called BEFORE the buff's own
   *  duration countdown in the same tick (§3: "super called LAST"). Sets `living.dead` via the
   *  normal death pipeline if the tick kills. */
  private tickPoison(living: LivingState, buff: ActiveBuff, timePassed: number): void {
    const elapsed = Math.min(buff.poisonOriginalDuration!, timePassed);
    const { amount, remainder } = poisonTick(buff.poisonPerTimeUnit!, buff.poisonRemainder!, elapsed);
    buff.poisonRemainder = remainder;
    if (amount === 0) return;
    const element = living.element; // victim's CURRENT element (buffs.md §3: no shipped override)
    const stats = this.statsOf(living.id);
    const final = applyDamage({
      amount,
      damageElement: element,
      sourceStat: buff.poisonRelatedStat!,
      defenderElement: element,
      defenderDefense: stats.Defense,
      defenderResist: stats.Resist,
      defenderCurrentHp: living.hp,
      level: living.level, // buffs.md §3: victim's OWN level, not max(attacker,defender)
    });


    this.applyHpDelta(living.id, -final, living.id, {
      reflected: true,
      element,
      sourceOfDeath: living.id,
      cause: "poisonTick",
    });
  }

  /** `DeathSentenceBuff.notifyExpiringWithAbilityPerformEnvironment:` (buffs.md §4): direct kill,
   *  bypassing `adjustHP:`/`allowDeath` entirely — no damage event, boss-immune, requires the
   *  buff's source to still be in battle. */
  private tryDeathSentenceKill(living: LivingState, buff: ActiveBuff): void {
    const source = this.livings.get(buff.sourceId);
    const sourceInBattle = source !== undefined && !source.dead && !source.captured;
    if (!sourceInBattle || living.boss) return; // fizzle, buffs.md §4
    source!.killsMade += 1;
    this.emit({ type: "deathSentence", target: living.id, source: buff.sourceId });
    this.handleDeath(living, buff.sourceId);
  }


  private triggerReflect(
    wearer: LivingState,
    buff: ActiveBuff,
    incomingAmount: number,
    incomingElement: Element,
    attackerId: string,
    sourceStat: StatName,
  ): void {
    const attacker = this.livings.get(attackerId);
    if (!attacker || attacker.id === wearer.id) return;


    this.emit({ type: "buffTriggered", living: wearer.id, buffType: buff.buffType });
    const amount = reflectAmount(buff, incomingAmount);
    const defender = this.statsOf(attacker.id);
    const final = applyDamage({
      amount,
      damageElement: incomingElement,
      sourceStat,
      defenderElement: attacker.element,
      defenderDefense: defender.Defense,
      defenderResist: defender.Resist,
      defenderCurrentHp: attacker.hp,
      level: Math.max(buff.level, attacker.level),
    });
    this.applyHpDelta(attacker.id, -final, wearer.id, {
      reflected: true,
      element: incomingElement,
      suppressKillCredit: true,
      sourceOfDeath: undefined,
      cause: "reflected",
    });
  }

  /** `notifyLiving:dealtDamage:toTarget:` (buffs.md §7): SlowProc/StunProc fire unconditionally
   *  on the WEARER's own nonzero landed damage, scoped to the DamageDealing/Attack path only
   *  (ability.ts's attack case is the only caller). */
  private notifyDamageDealt(sourceId: string, targetId: string, amount: number): void {
    if (amount <= 0) return;
    const source = this.livingOrThrow(sourceId);
    const target = this.livingOrThrow(targetId);
    if (target.dead || target.captured) return; // this same hit may have just killed the target
    for (const buff of source.buffs) {
      if (buff.kind === "stunProc") {
        if (!target.boss) {
          const delay = stunProcDelay(buff.level);
          this.queue.addTime(target.id, delay);
          this.emit({ type: "stunned", target: target.id, source: sourceId, delay, reactive: true });
        }
      } else if (buff.kind === "slowProc") {
        // NO boss check (confirmed asymmetry, buffs.md §7) — always attempted, subject only to
        // the normal hasteDown stacking rejection.
        const haste = slowProcHaste(buff.level);
        const hasteDown = createActiveBuff({
          buffType: "StatOnly",
          kind: "statOnly",
          sourceId,
          sourceLevel: source.level,
          duration: 500,
          stackName: "hasteDown",
          haste,
        });
        this.tryAttachBuff(target, hasteDown, "proc");
      }
    }
  }

  /** `Buff.notifyBattleTimePassed:` generalized across every kind (buffs.md §14): iterate
   *  livings in construction order, per living per buff in attach order — DoT damage first, then
   *  countdown/expiry (matching §3's "super called last"). DeathSentence/Poison kills cascade
   *  through the normal death pipeline immediately. Returns whether any death occurred this pass
   *  (so `resolveTurn` can run a post-tick win/loss check). */
  private advanceBuffDurations(amount: number): boolean {
    let anyDeath = false;
    for (const living of this.livings.values()) {
      if (living.dead || living.captured) continue;


      const snapshot = [...living.buffs];
      for (const buff of snapshot) {
        if (living.dead) break; // an earlier buff's tick just killed this living this pass
        if (!living.buffs.includes(buff)) continue; // already removed by an earlier side effect this tick
        if (buff.kind === "poison") {
          this.tickPoison(living, buff, amount);
          if (living.dead) {
            anyDeath = true;
            break;
          }
        }
        const status = advanceActiveBuffDuration(buff, amount);
        if (status === "expired") {
          const idx = living.buffs.indexOf(buff);
          if (idx !== -1) living.buffs.splice(idx, 1);
          this.emit({
            type: "buffRemoved",
            target: living.id,
            buffType: buff.buffType,
            statusEffects: buff.statusEffects,
            reason: "expired",
          });
          if (buff.kind === "statOnly" && buff.stats.includes("MaxHP")) this.recalculateMaxHp(living);
          if (buff.kind === "deathSentence") {
            this.tryDeathSentenceKill(living, buff);
            if (living.dead) {
              anyDeath = true;
              break;
            }
          }
        }
      }
    }
    return anyDeath;
  }

  /** `-[Ability applyBuffs:toAbilityResultTargets:livingSource:]` (ability.ts BattleWorld hook). */
  private applyAuthoredBuff(targetId: string, entry: BuffListEntry, sourceId: string): void {
    this.tryAttachBuff(this.livingOrThrow(targetId), this.buildBuff(entry, sourceId));
  }

  /** `ability.ts`'s `BattleWorld` — the ONLY mutation surface `performAbility` uses. */
  private readonly battleWorld: BattleWorld = {
    statsOf: (id) => this.statsOf(id),
    elementOf: (id) => this.livingOrThrow(id).element,
    hpOf: (id) => this.livingOrThrow(id).hp,
    levelOf: (id) => this.livingOrThrow(id).level,
    applyHpDelta: (id, delta, sourceId, opts) => this.applyHpDelta(id, delta, sourceId, opts),
    isDestroyed: (id) => this.livingOrThrow(id).captured,
    resolveCapture: (sourceId, targetId, cardLevel, partyLevel) =>
      this.resolveCapture(sourceId, targetId, cardLevel, partyLevel),
    addStatOnlyBuff: (targetId, spec) => this.addStatOnlyBuff(targetId, spec),
    magnifyContext: (sourceId, targetId) => {
      const source = this.livingOrThrow(sourceId);
      const target = this.livingOrThrow(targetId);
      return {
        targetFullName: target.monster.path,
        targetStatuses: this.statusesOfLiving(target),
        sourceTimeInCombat: source.timeInCombat,
        friendlyDeadCount: this.deadMembers[source.team].length,
        enemyDeadCount: this.deadMembers[source.team === 0 ? 1 : 0].length,
        friendlyActiveCount: this.active[source.team].length,
        sourceKillsMade: source.killsMade,
      };
    },
    isBoss: (id) => this.livingOrThrow(id).boss,
    addTimeDelay: (id, amount) => {
      const living = this.livingOrThrow(id);
      if (!living.dead) this.queue.addTime(id, amount);
    },
    removeStatusBuffs: (id, statuses) => this.removeStatusBuffs(id, statuses),
    removeAllBuffs: (id) => this.removeAllBuffs(id),
    notifyAbilityEvent: (event, args) => {
      this.emit({ type: "abilityEvent", event, arguments: args });


      if (event === 1) this.pendingGuaranteedRetreat = true;
    },
    applyAuthoredBuff: (targetId, entry, sourceId) => this.applyAuthoredBuff(targetId, entry, sourceId),
    notifyDamageDealt: (sourceId, targetId, amount) => this.notifyDamageDealt(sourceId, targetId, amount),
    notifyEffectText: (target, effect) => this.emit({ type: "effectText", target, effect }),
    notifyStunned: (target, source, delay) => this.emit({ type: "stunned", target, source, delay }),
    speciesOf: (id) => this.livingOrThrow(id).shortType,
    summonMonster: (shortType, summonerId, hpStyle) => this.summonMonster(shortType, summonerId, hpStyle),
    randomSummonType: (minStars) => this.randomSummonType(minStars),
    desoulSummon: (holderId, casterId) => this.desoulSummon(holderId, casterId),
    sacrificeBenchMember: (casterId) => this.sacrificeBenchMember(casterId),
    switchWithRandomReserve: (casterId, targetId) => this.switchWithRandomReserve(casterId, targetId),
    spendSilver: (sourceId, cost) => this.spendSilverFor(sourceId, cost),
    moveToFront: (sourceId, targetId) => this.moveLivingToFront(sourceId, targetId),
    notifyPhaseResolved: (phase, source, targets) => this.emit({ type: "phaseResolved", phase, source, targets }),
  };

  /** `ai.ts`'s `AiWorld` — read-only roster queries `assignAbility` needs. */
  readonly aiWorld: AiWorld = {
    shortTypeOf: (id) => this.livingOrThrow(id).shortType,


    enemyPoolOf: (id) => this.targetableIdsOf(this.livingOrThrow(id).team === 0 ? 1 : 0),
    friendlyPoolOf: (id) => this.targetableIdsOf(this.livingOrThrow(id).team),
    blockUseReasonOf: (id, ability, args) => this.blockUseReasonFor(id, ability, args),
    targetPriorityOf: (id) => this.targetPriorityOf(id),
  };


  private targetPriorityOf(id: string): number {
    const living = this.livingOrThrow(id);
    let sum = 0;
    for (const buff of living.buffs) sum += buff.targetPriorityAdjustment;
    for (const ref of this.data.jobAbilitiesOrEmpty(living.shortType)) {
      const fromArgs = ref.arguments["targetPriorityAdjustment"];
      const fromDict = this.data.ability(ref.type).raw["targetPriorityAdjustment"];
      sum += typeof fromArgs === "number" ? fromArgs : typeof fromDict === "number" ? fromDict : 0;
    }
    return sum;
  }


  blockUseReasonFor(casterId: string, ability: AbilityDef, args: Record<string, unknown>): string | undefined {
    const caster = this.livingOrThrow(casterId);
    return blockUseReason(ability, args, this.data, {
      activeCount: this.active[caster.team].length,
      benchCount: this.bench[caster.team].length,
      fightingGroupSize: this.fightingGroupSize,
      hasSoulStoneEquipped: caster.soulStone !== undefined,
    });
  }

  get winner(): 0 | 1 | undefined {
    return this.winnerValue;
  }

  /** Native Battle state 6. Retreat is terminal but is not a win/loss and has no winningTeam. */
  get retreated(): boolean {
    return this.retreatedValue;
  }

  get events(): readonly BattleEvent[] {
    return this.eventLog;
  }

  teamOf(id: string): 0 | 1 {
    return this.livingOrThrow(id).team;
  }

  /** Immutable combat level used by battle-owned listeners such as HeroData spirit charging. */
  levelOf(id: string): number {
    return this.livingOrThrow(id).level;
  }

  shortTypeOf(id: string): string {
    return this.livingOrThrow(id).shortType;
  }

  /** Durable monster/save identity associated with this battle participant, when supplied. */
  sourceInstanceIdOf(id: string): string | undefined {
    return this.livingOrThrow(id).sourceInstanceId;
  }

  isAlive(id: string): boolean {
    const living = this.livingOrThrow(id);
    return !living.dead && !living.captured;
  }

  /** Whether this living's turns are AI-piloted: every team-1 monster (native wild `ai`), plus
   *  any team-0 monster carrying `Passive.Berserk` (its entry hook set `ai = BadguyAI.ai`
   *  because `ai` was nil — targeting-passives.md §C, permanent for the whole battle). */
  isAiControlled(id: string): boolean {
    const living = this.livingOrThrow(id);
    return living.team === 1 || living.berserk || living.nativeSpirit;
  }

  hpOf(id: string): number {
    return this.livingOrThrow(id).hp;
  }

  maxHpOf(id: string): number {
    return this.livingOrThrow(id).maxHp;
  }

  effectiveStatsOf(id: string): Record<StatName, number> {
    return this.statsOf(id);
  }


  magnifySourceContextOf(id: string): {
    sourceTimeInCombat: number;
    friendlyDeadCount: number;
    enemyDeadCount: number;
    friendlyActiveCount: number;
    sourceKillsMade: number;
  } {
    const source = this.livingOrThrow(id);
    return {
      sourceTimeInCombat: source.timeInCombat,
      friendlyDeadCount: this.deadMembers[source.team].length,
      enemyDeadCount: this.deadMembers[source.team === 0 ? 1 : 0].length,
      friendlyActiveCount: this.active[source.team].length,
      sourceKillsMade: source.killsMade,
    };
  }

  hasteOf(id: string): number {
    return this.hasteOfLiving(this.livingOrThrow(id));
  }

  /** Legacy StatOnly-shaped projection (pre-authored-buff-engine public contract, kept for
   *  session.ts/apps-web display): only `kind: "statOnly"` buffs are represented here — poison/
   *  deathSentence/reflective/proc/statShift buffs don't have an `ActiveStatOnlyBuff`-shaped
   *  view and are intentionally omitted from this accessor. Use `rawBuffsOf` (below) to see
   *  every buff kind (test/debug only, not part of the frozen Task 9 event/report API). */
  activeBuffsOf(id: string): readonly ActiveStatOnlyBuff[] {
    return this.livingOrThrow(id)
      .buffs.filter((buff) => buff.kind === "statOnly")
      .map((buff) => ({
        sourceId: buff.sourceId,
        level: buff.level,
        duration: buff.duration,
        durationLeft: buff.durationLeft,
        stats: [...buff.stats],
        statsHelp: buff.statsHelp,
        haste: buff.haste,
        stackName: buff.stackName,
        statusEffects: [...buff.statusEffects],
        removeOnHurt: buff.removeOnHurt,
      }));
  }

  /** Every active buff of every kind, for tests/debugging. Not part of the frozen public event
   *  API — apps/web keeps using `activeBuffsOf`/`statusEffectsOf`. */
  rawBuffsOf(id: string): readonly ActiveBuff[] {
    return this.livingOrThrow(id).buffs.map((buff) => ({ ...buff }));
  }

  statusEffectsOf(id: string): readonly StatusEffect[] {
    return this.statusesOfLiving(this.livingOrThrow(id));
  }

  isDisabled(id: string): boolean {
    const statuses = this.statusesOfLiving(this.livingOrThrow(id));
    if (statuses.includes("Sleep") || statuses.includes("Paralyze")) return true;
    if (!statuses.includes("Confuse")) return false;

    return this.rng.intBelow(2) === 0;
  }

  captureStatusOf(id: string): CaptureStatus {
    const living = this.livingOrThrow(id);
    if (this.blockCapture || !living.capturable || living.monster.category === "Summon") {
      return "uncapturable";
    }
    return living.captureAttemptMade ? "alreadyTried" : "available";
  }

  captureChanceOf(id: string, cardLevel: CaptureCardLevel, partyLevel: number): number {
    const living = this.livingOrThrow(id);
    if (this.captureStatusOf(id) !== "available") return 0;
    return captureChance(
      cardLevel,
      partyLevel,
      living.level,
      Math.round(living.monster.stars * 2),
      living.hp / living.maxHp,
    );
  }

  /** FUTURE_PARTY_INTEGRATION: native `Battle.capturedMonsters`; not a player-party mutation. */
  capturedIds(): string[] {
    return [...this.capturedMembers];
  }

  frontActorId(): string {
    const frontId = this.queue.front();
    if (frontId === undefined) throw new Error("HeadlessBattle: queue unexpectedly empty mid-battle");
    return frontId;
  }


  timeDelayOf(id: string): number {
    return this.queue.timeForItem(id) - this.queue.timeAtFront();
  }


  queueOrder(): string[] {
    return [...this.queue.order()];
  }

  /** `Team.replacementMembers` bench size for `team` — non-active reserve members. */
  benchCountOf(team: 0 | 1): number {
    return this.bench[team].length;
  }

  /** Ordered `Team.replacementMembers` identity for read-only reserve presentation. */
  benchIdsOf(team: 0 | 1): string[] {
    return [...this.bench[team]];
  }

  /** `Team.monsterMembers` — the ACTIVE fighting-group ids in join order (promoted reserves
   *  appended at the end, per `addReplacementMonster`). Valid before `seedAndStart` runs,
   *  unlike `queueOrder` (the queue is only seeded on battle start). */
  activeIdsOf(team: 0 | 1): string[] {
    return [...this.active[team]];
  }

  /** `Team.deadMembers` in native append order. The separate summon slot never enters it. */
  deadIdsOf(team: 0 | 1): string[] {
    return [...this.deadMembers[team]];
  }

  /** Source-owned fields consumed by post-battle XP calculation and award eligibility. */
  xpStateOf(id: string): BattleXpLivingState {
    const living = this.livingOrThrow(id);
    return {
      shortType: living.shortType,
      level: living.level,
      summoned: living.summoned,
      noReward: living.noReward,
    };
  }

  /**
   * Source-faithful post-battle XP membership and aggregation.
   *
   * Friendly membership is `deadMembers + monsterMembers`; ordinary Add/Call creations remain
   * in that divisor but their `summoned` flag excludes them from `awardXp:`. Enemy deadMembers
   * remain in order, with `noReward` creations skipped by the math. Team.summon is structurally
   * absent from both arrays rather than filtered after the fact.
   */
  postBattleXpSummary(breederXpBonus?: number): PostBattleXpSummary {
    const participantIds = [...this.deadMembers[0], ...this.active[0]];
    const defeatedIds = [...this.deadMembers[1]];
    const amount = xpAwardPerParticipant(
      participantIds.map((id) => this.livingOrThrow(id).level),
      defeatedIds.map((id) => {
        const living = this.livingOrThrow(id);
        return {
          level: living.level,
          stars: living.monster.stars,
          noReward: living.noReward,
        };
      }),
      breederXpBonus,
    );
    return {
      participantIds,
      awardedIds: participantIds.filter((id) => !this.livingOrThrow(id).summoned),
      defeatedIds,
      amount,
    };
  }


  targetableIdsOf(team: 0 | 1): string[] {
    const summon = this.summonSlot[team];
    return summon === undefined ? [...this.active[team]] : [...this.active[team], summon];
  }


  summonIdOf(team: 0 | 1): string | undefined {
    return this.summonSlot[team];
  }

  /** The living's CURRENTLY equipped soul stone — `childrenOfType:[SoulStone class]` as
   *  `LivingInfoDisplay`'s soul-stone section reads it (soulstone-info-display.md §1). Live
   *  state, not the construction setup: Desoul's consume (`desoulSummon`) unequips the stone
   *  mid-battle and the section must stop listing it. At most one per monster (RootJob.slots,
   *  soulstones.md §4.4). */
  soulStoneOf(id: string): { element: Element; level: number } | undefined {
    const stone = this.livingOrThrow(id).soulStone;
    return stone === undefined ? undefined : { element: stone.element, level: stone.level };
  }


  playerTerminalSnapshot(): PlayerBattleTerminalSnapshot {
    if (this.winnerValue === undefined && !this.retreatedValue) {
      throw new Error("BattleCore.playerTerminalSnapshot: battle has not reached a terminal state");
    }
    const snapshot: PlayerBattleTerminalSnapshot = {};
    for (const livingId of this.initialPlayerLivingIds) {
      const living = this.livingOrThrow(livingId);
      if (living.sourceInstanceId === undefined) continue;
      snapshot[living.sourceInstanceId] = {
        currentHp: living.hp,
        leftBattle: living.leftBattle,
        ...(living.soulStone === undefined
          ? {}
          : {
              soulStone: {
                element: living.soulStone.element,
                level: living.soulStone.level,
                ...(living.soulStone.sourceType === undefined
                  ? {}
                  : { sourceType: living.soulStone.sourceType }),
              },
            }),
      };
    }
    return snapshot;
  }

  report(): BattleReport {
    if (this.winnerValue === undefined) {
      throw new Error("BattleCore.report: battle has not resolved yet");
    }
    return { winner: this.winnerValue, events: this.eventLog, elapsed: this.queue.timeAtFront() };
  }

  /**
   * `-[Living adjustHP:.../hitWithDamage:]` + `applyHpDelta` (ability.ts) call site. Clamps to
   * `[0, maxHp]`, emits `damageDealt`/`healed` for the ACTUAL (post-clamp) delta (damage.md §6:
   * healing clamps to MaxHP and notifies with the actual, possibly-smaller, amount — damage is
   * already pre-clamped by `applyDamage` internally, so this clamp is a no-op for it), then
   * synchronously runs the death pipeline if hp reached 0 (battle.ts header deviation #7).
   *
   * `opts` threads the authored-buff engine's extra needs (buffs.md §3/§4/§5) through this single
   * mutation point: `reflected` exempts a hit from waking a ReflectiveBuff AND from ever being
   * reflected itself (one bounce); `suppressKillCredit`/`sourceOfDeath` decouple "who gets
   * displayed as this hit's source" (still `sourceId`, always) from "who gets kill credit / who
   * revengeBuffs sees as the killer" (defaults to `sourceId`, overridable to `undefined` for a
   * sacrifice's true nil source or a reflect kill's non-Living Damage.source, buffs.md §2.2/§5/§6).
   */
  private applyHpDelta(
    id: string,
    delta: number,
    sourceId: string,
    opts?: {
      reflected?: boolean;
      bypassDamageTakenListeners?: boolean;
      suppressKillCredit?: boolean;
      element?: Element;
      sourceStat?: StatName;
      sourceOfDeath?: string | undefined;
      /** events.ts `CollateralHpCause`: stamped onto the emitted damageDealt/healed so renderers
       *  can tell a collateral HP change (poison tick/reflect bounce/sacrifice self-kill) apart
       *  from the acting ability's own hit. Absent on every ability-pipeline call (the
       *  battleWorld binding never sets it). NOTE: distinct from `reflected`, which poison ticks
       *  ALSO set purely for its exemption semantics (no bounce, no wake-suppression). */
      cause?: CollateralHpCause;
      /** ability.ts `BattleWorld.applyHpDelta`'s doc: the DamageDealing pipeline built a real
       *  Damage object, so a FULLY-MITIGATED 0 still emits a display-only `damageDealt` of
       *  amount 0 (native red "-0", damage.md §2's `[result addParameter:]` outside the
       *  `final >= 1` guard) — with none of the real-damage side effects (no wake, no reflect,
       *  no proc: all gated on nonzero damage natively, damage.md §5/§6). */
      displayZeroDamage?: boolean;
    },
  ): void {
    const living = this.livingOrThrow(id);
    const clamped = Math.max(0, Math.min(living.maxHp, living.hp + delta));
    const actualDelta = clamped - living.hp;
    living.hp = clamped;

    if (actualDelta < 0) {
      const element = opts?.element ?? this.pendingDamageElement;
      if (!element) throw new Error("HeadlessBattle: damageDealt with no pending damage element set");
      this.emit({
        type: "damageDealt",
        source: sourceId,
        target: id,
        amount: -actualDelta,
        element,
        hpAfter: living.hp,
        ...(opts?.cause !== undefined ? { cause: opts.cause } : {}),
      });
      // RemoveOnHurtBuff (Offensive.Sleep) unregisters itself on any non-zero damage result,
      // regardless of source (buffs.md §3 cross-ref — includes Poison ticks and reflected hits).
      if (!opts?.bypassDamageTakenListeners) {
        const woken = living.buffs.filter((buff) => buff.kind === "statOnly" && buff.removeOnHurt);
        if (woken.length > 0) {
          living.buffs = living.buffs.filter((buff) => !(buff.kind === "statOnly" && buff.removeOnHurt));
          for (const buff of woken) {
            this.emit({
              type: "buffRemoved",
              target: id,
              buffType: buff.buffType,
              statusEffects: buff.statusEffects,
              reason: "hurt",
            });
          }
        }
        // ReflectiveBuff (buffs.md §5): non-reflected hits only, one bounce, no kill credit.
        if (!opts?.reflected) {
          const reflective = living.buffs.find((buff) => buff.kind === "reflective");
          if (reflective) {
            this.triggerReflect(living, reflective, -actualDelta, element, sourceId, opts?.sourceStat ?? "Attack");
          }
        }
      }
    } else if (actualDelta > 0) {
      this.emit({
        type: "healed",
        source: sourceId,
        target: id,
        amount: actualDelta,
        hpAfter: living.hp,
        ...(opts?.cause !== undefined ? { cause: opts.cause } : {}),
      });
    } else if (delta === 0 && opts?.displayZeroDamage) {
      // Fully-mitigated hit: display-only zero damageDealt (see the opt's doc above). Emitted
      // OUTSIDE the real-damage branch so wake-on-hurt/reflect/death never see it.
      const element = opts?.element ?? this.pendingDamageElement;
      if (!element) throw new Error("HeadlessBattle: damageDealt with no pending damage element set");
      this.emit({ type: "damageDealt", source: sourceId, target: id, amount: 0, element, hpAfter: living.hp });
    }

    if (living.hp <= 0 && !living.dead) {
      if (!opts?.suppressKillCredit) {
        const source = this.livings.get(sourceId);
        if (source) source.killsMade += 1;
      }
      const sourceOfDeath = opts && "sourceOfDeath" in opts ? opts.sourceOfDeath : sourceId;
      this.handleDeath(living, sourceOfDeath);
    }
  }

  /**
   * battle.md §5 death pipeline: mark dead, move active->dead, emit `died`, remove from the
   * `TimedQueue` (the actual point a dead Living leaves the queue, per `Battle
   * notifyTeam:removedMonster:`), backfill the vacated active slot from the bench front (if any)
   * and schedule its `initialBattleDelay` at `trunc(timeAtFront + delay)` — ONE fresh RNG draw,
   * part of the ability's own draw stream (matches "the replacement scheduling draw is part of
   * the stream"). `sourceOfDeath` is the TRUE killer Living id, or `undefined` when the binary's
   * own `Damage.source`/`sourceOfAdjust` isn't a Living (sacrifice's nil source, a reflect kill's
   * Buff-instance source, buffs.md §2.2) — gates `revengeBuffs` (buffs.md §2.2) exactly like the
   * binary's `isKindOfClass Living` check.
   */
  private handleDeath(living: LivingState, sourceOfDeath: string | undefined): void {
    living.dead = true;
    living.hp = 0;

    // revengeBuffs (buffs.md §2.2): BEFORE stripping this living's own buffs, so its poison
    // setup roll reads its CURRENT (pre-strip) effective Attack.
    if (sourceOfDeath !== undefined) this.applyRevengeBuffs(living, sourceOfDeath);

    this.stripBuffsOnLeaveBattle(living);


    if (this.summonSlot[living.team] === living.id) {
      this.summonSlot[living.team] = undefined;
      this.emit({ type: "died", living: living.id });
      this.queue.remove(living.id);
      this.emit({ type: "summonChanged", team: living.team, removed: living.id, added: undefined });
      return;
    }

    const activeRoster = this.active[living.team];
    const idx = activeRoster.indexOf(living.id);
    if (idx !== -1) activeRoster.splice(idx, 1);
    this.deadMembers[living.team].push(living.id);

    this.emit({ type: "died", living: living.id });
    this.queue.remove(living.id);

    this.promoteReplacement(living.team);
  }


  attemptRetreat(id: string, chance: number): boolean {
    if (this.winnerValue !== undefined || this.retreatedValue) {
      throw new Error("BattleCore.attemptRetreat: battle is already terminal");
    }
    if (!Number.isInteger(chance) || chance < 0 || chance > 100) {
      throw new Error(`BattleCore.attemptRetreat: invalid percent ${chance}`);
    }
    const living = this.livingOrThrow(id);
    if (living.dead || living.captured) {
      throw new Error(`BattleCore.attemptRetreat: ${id} is not an active living`);
    }
    if (this.rng.intBelow(100) >= chance) return false;
    this.retreatedValue = true;
    // `Encounter.showLostCaptures` makes every capture from this battle unavailable for award.
    // This slice has no lost-capture presentation, so discard its pending-award seam immediately.
    this.capturedMembers.length = 0;
    return true;
  }

  private promoteReplacement(team: 0 | 1): void {
    const activeRoster = this.active[team];
    const bench = this.bench[team];
    const replacementId = bench.shift();
    if (replacementId !== undefined) {
      activeRoster.push(replacementId); // Team.addReplacementMonster: appended, not reinserted
      const replacement = this.livingOrThrow(replacementId);
      const delay = initialBattleDelay(this.statOf(replacement, "Speed"), this.rng); // ONE draw
      // scheduler.md §2 mid-battle joiners: the sum is a float32 add before the trunc.
      const scheduledTime = Math.trunc(Math.fround(this.queue.timeAtFront() + delay));
      this.queue.setTime(replacementId, scheduledTime);
      // buffs.md §2.3/§9: a promoted bench member gets its own passiveBuffs, and battle-entry
      // aura bookkeeping (its own aura granting to the team; existing owners granting to it).
      this.promoteEnterBattle(replacementId);
    }
  }


  private summonMonster(shortType: string, summonerId: string, hpStyle: SummonHpStyle): void {
    const summoner = this.livingOrThrow(summonerId);
    const team = summoner.team;
    const monster = this.data.monsterByShortType(shortType);
    const level = summoner.level; // (int)[abilitySource level]
    const baseStatsRaw = {} as Record<StatName, number>;
    for (const stat of STAT_NAMES) baseStatsRaw[stat] = baseStatRaw(monster, stat, level);
    const maxHp = baseStat(monster, "MaxHP", level);

    let hp = maxHp;
    let splitTarget: number | undefined;
    if (hpStyle === "match") {
      hp = Math.max(1, Math.min(summoner.hp, maxHp));
    } else if (hpStyle === "split") {
      splitTarget = Math.max(0, Math.floor(summoner.hp / 2));
      hp = splitTarget;
    }

    const id = battleLivingId(team, this.nextConstructionIndex[team]++, shortType);
    const living: LivingState = {
      id,
      sourceInstanceId: undefined,
      team,
      shortType,
      monster,
      level,
      baseStatsRaw,
      // Mid-battle summons are freshly built monsters (Monster.monsterOfShortType:level:) — they
      // never carry an equipped item.
      soulStone: undefined,
      // Battle-created monsters never sat on the player's bench, so
      // `-[Player applyPlayerBuffsToMonsters:]` never attached hero-skill/Gem children to them.
      playerBuffs: undefined,
      buffs: [],
      timeInCombat: 0,
      killsMade: 0,
      boss: false,
      element: monster.element,
      maxHp,
      hp,
      dead: false,
      capturable: false, // §1/§2: newMonster.capturable = false (noReward/summoned analogues)
      captureAttemptMade: false,
      captured: false,
      leftBattle: false,
      auraSpec: this.resolveAuraSpec(shortType),
      auraGrants: [],
      berserk: this.hasBerserkAbility(shortType),
      nativeSpirit: false,
      summoned: true,
      noReward: true,
    };
    this.livings.set(id, living);

    // "split" halves the summoner too — binary order: both adjustHP: calls run BEFORE
    // team.addNewMonster:. A summoner at 1 hp reaches 0 and dies through the normal pipeline
    // (its own death promotion happens before the clone joins). No mitigation/elemental pass
    // (raw adjustHP:), no kill credit, nil sourceOfAdjust.
    if (splitTarget !== undefined && summoner.hp !== splitTarget) {
      this.applyHpDelta(summonerId, splitTarget - summoner.hp, summonerId, {
        reflected: true,
        suppressKillCredit: true,
        element: summoner.element,
        sourceOfDeath: undefined,
      });
    }

    this.emit({ type: "monsterAdded", living: id, shortType, level, team, summoner: summonerId });

    if (living.hp <= 0) {
      // Degenerate "split" at summoner hp <= 1: the clone materializes at 0 hp — it dies on
      // arrival (the binary's adjustHP: fires the death path before addNewMonster: even runs).
      living.dead = true;
      this.deadMembers[team].push(id);
      this.emit({ type: "died", living: id });
      return;
    }

    this.bench[team].push(id);
    if (this.active[team].length < this.fightingGroupSize) this.promoteReplacement(team);
  }


  summonSpirit(shortType: string, savedXp: number): string {
    if (this.winnerValue !== undefined || this.retreatedValue) {
      throw new Error("BattleCore.summonSpirit: battle has ended");
    }
    const monster = this.data.monsterByShortType(shortType);
    const level = spiritCombatLevel(monster, savedXp);
    const baseStatsRaw = {} as Record<StatName, number>;
    for (const stat of STAT_NAMES) baseStatsRaw[stat] = baseStatRaw(monster, stat, level);
    const id = battleLivingId(0, this.nextConstructionIndex[0]++, shortType);
    const living: LivingState = {
      id,
      sourceInstanceId: undefined,
      team: 0,
      shortType,
      monster,
      level,
      baseStatsRaw,
      soulStone: undefined,
      // Battle-created monsters never sat on the player's bench, so
      // `-[Player applyPlayerBuffsToMonsters:]` never attached hero-skill/Gem children to them.
      playerBuffs: undefined,
      buffs: [],
      timeInCombat: 0,
      killsMade: 0,
      boss: false,
      element: monster.element,
      maxHp: 0,
      hp: 0,
      dead: false,
      capturable: false,
      captureAttemptMade: false,
      captured: false,
      leftBattle: false,
      auraSpec: this.resolveAuraSpec(shortType),
      auraGrants: [],
      berserk: this.hasBerserkAbility(shortType),
      nativeSpirit: true,
      summoned: false,
      noReward: false,
    };
    living.maxHp = this.statOf(living, "MaxHP");
    living.hp = living.maxHp;
    this.livings.set(id, living);
    this.setSummon(0, id, undefined, "spirit");
    return id;
  }

  private setSummon(
    team: 0 | 1,
    newId: string | undefined,
    summonerId?: string,
    origin?: "spirit",
  ): void {
    const oldId = this.summonSlot[team];
    if (oldId !== undefined) {
      const old = this.livingOrThrow(oldId);
      this.queue.remove(oldId);
      if (!old.dead) this.stripBuffsOnLeaveBattle(old); // death already stripped via handleDeath
      this.summonSlot[team] = undefined;
    }
    if (newId !== undefined) {
      this.summonSlot[team] = newId;
      const summoned = this.livingOrThrow(newId);
      const delay = initialBattleDelay(this.statOf(summoned, "Speed"), this.rng); // ONE draw
      this.queue.setTime(newId, Math.trunc(Math.fround(this.queue.timeAtFront() + delay)));
      this.promoteEnterBattle(newId);
    }
    if (oldId !== undefined || newId !== undefined) {
      const summoned = newId !== undefined ? this.livingOrThrow(newId) : undefined;
      this.emit({
        type: "summonChanged",
        team,
        removed: oldId,
        added: newId,
        ...(summoned !== undefined
          ? { shortType: summoned.shortType, level: summoned.level }
          : {}),
        ...(summonerId !== undefined ? { summoner: summonerId } : {}),
        ...(origin !== undefined ? { origin } : {}),
      });
    }
  }


  private desoulSummon(holderId: string, casterId: string): void {
    const holder = this.livingOrThrow(holderId);
    const stone = holder.soulStone;
    if (!stone) return; // native: itemInSlot:4 isKindOfClass check fails — result skipped silently
    if (stone.sourceType === undefined) {
      // Port-only state (a native stone always carries sourceType). The constructor guard blocks
      // this for Desoul carriers, so reaching here means a mid-battle equip path bypassed it.
      throw new Error(
        `DesoulAbilityComponent: ${holderId}'s soul stone has no sourceType to revive ` +
          "(SoulStoneSetup.sourceType is required on Desoul carriers)",
      );
    }
    const caster = this.livingOrThrow(casterId);
    const team = holder.team;
    const monster = this.data.monsterByShortType(stone.sourceType); // fail-loud on unknown species
    const level = caster.level; // (int)[abilitySource level] — NOT the stone's level
    const baseStatsRaw = {} as Record<StatName, number>;
    for (const stat of STAT_NAMES) baseStatsRaw[stat] = baseStatRaw(monster, stat, level);
    const id = battleLivingId(team, this.nextConstructionIndex[team]++, stone.sourceType);
    const living: LivingState = {
      id,
      sourceInstanceId: undefined,
      team,
      shortType: stone.sourceType,
      monster,
      level,
      baseStatsRaw,
      soulStone: undefined,
      // Battle-created monsters never sat on the player's bench, so
      // `-[Player applyPlayerBuffsToMonsters:]` never attached hero-skill/Gem children to them.
      playerBuffs: undefined,
      buffs: [],
      timeInCombat: 0,
      killsMade: 0,
      boss: false,
      element: monster.element,
      maxHp: 0,
      hp: 0,
      dead: false,
      capturable: true, // §10.7: factory default — Desoul does NOT set capturable=false
      captureAttemptMade: false,
      captured: false,
      leftBattle: false,
      auraSpec: this.resolveAuraSpec(stone.sourceType),
      auraGrants: [],
      berserk: this.hasBerserkAbility(stone.sourceType),
      nativeSpirit: false,
      summoned: false,
      noReward: false,
    };
    // Fresh monsterOfShortType:level: spawn — full (stone-free) MaxHP, no hpStyle math (§10.6).
    living.maxHp = this.statOf(living, "MaxHP");
    living.hp = living.maxHp;
    this.livings.set(id, living);

    this.setSummon(team, id, casterId); // native order: setSummon: BEFORE removeChild: (§10.6)

    holder.soulStone = undefined;


    holder.maxHp = this.statOf(holder, "MaxHP");
  }


  private randomSummonType(minStars: number): string {
    const pool = this.data
      .allMonsters()
      .filter((m) => m.category === "Normal" && (minStars < 1 || m.stars >= minStars));
    if (pool.length === 0) {
      throw new Error(`CallMonsterAbilityComponent: empty summon pool (minStars ${minStars})`);
    }
    return pool[this.rng.intBelow(pool.length)]!.shortType;
  }


  private sacrificeBenchMember(casterId: string): number | undefined {
    const team = this.livingOrThrow(casterId).team;
    const bench = this.bench[team];
    if (bench.length === 0) return undefined; // nil randomElement -> killReplacementMonster fails
    const idx = this.rng.intBelow(bench.length); // ONE uniform draw per phase-firing
    const victimId = bench[idx]!;
    bench.splice(idx, 1);
    const victim = this.livingOrThrow(victimId);
    victim.dead = true;
    victim.hp = 0;
    this.stripBuffsOnLeaveBattle(victim);
    this.deadMembers[team].push(victimId);
    this.emit({ type: "died", living: victimId });
    return victim.level;
  }


  private switchWithRandomReserve(casterId: string, targetId: string): void {
    const team = this.livingOrThrow(casterId).team;
    const bench = this.bench[team];
    if (bench.length === 0) return; // blockUseReason gates this; nil reserve would assert in the binary
    const target = this.livingOrThrow(targetId);
    const activeRoster = this.active[team];
    const outIdx = activeRoster.indexOf(targetId);


    if (this.summonSlot[team] === targetId) return;
    if (target.team !== team || outIdx === -1) {
      throw new Error(
        "SwitchAbilityComponent: target is not an active member of the caster's team " +
          "(binary assert in switchInBattleMonster:withReserveMonster:)",
      );
    }
    const reserveIdx = this.rng.intBelow(bench.length); // ONE uniform draw per target
    const reserveId = bench[reserveIdx]!;

    activeRoster.splice(outIdx, 1);
    this.queue.remove(targetId); // fireMonsterLeft -> Battle notifyTeam:removedMonster:
    this.stripBuffsOnLeaveBattle(target); // leaving battle strips every buff (buffs.md §1.7/§9)
    bench[reserveIdx] = targetId; // outgoing takes the incoming monster's old bench slot

    activeRoster.push(reserveId); // incoming appended to the active roster END
    const reserve = this.livingOrThrow(reserveId);
    const delay = initialBattleDelay(this.statOf(reserve, "Speed"), this.rng); // ONE draw
    this.queue.setTime(reserveId, Math.trunc(Math.fround(this.queue.timeAtFront() + delay)));
    this.promoteEnterBattle(reserveId);
    this.emit({ type: "switched", out: targetId, in: reserveId, team });
  }

  /** `-[UserSavedData spendSilver:]` via SpendSilverAbilityComponent (components-full.md §6):
   *  deducts from the single global wallet if affordable; an unaffordable cost fails silently. */
  private spendSilverFor(sourceId: string, cost: number): boolean {
    if (this.silverAmount < cost) return false;
    this.silverAmount -= cost;
    this.emit({ type: "silverSpent", source: sourceId, amount: cost, remaining: this.silverAmount });
    return true;
  }

  /** The player-save silver wallet backing SpendSilverAbilityComponent (0 unless opts.silver). */
  get silver(): number {
    return this.silverAmount;
  }

  /**
   * Server-private replay hook for a capture card bought from the shared save wallet between
   * battle turns. It emits no battle event: the authoritative application layer owns the purchase
   * event, while this keeps later SpendSilver ability eligibility and replay ordering exact.
   */
  applyExternalSilverDebit(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`BattleCore.applyExternalSilverDebit: invalid amount ${amount}`);
    }
    if (this.silverAmount < amount) {
      throw new Error(
        `BattleCore.applyExternalSilverDebit: ${amount} exceeds wallet ${this.silverAmount}`,
      );
    }
    this.silverAmount -= amount;
  }


  private moveLivingToFront(sourceId: string, targetId: string): void {
    const target = this.livingOrThrow(targetId);
    if (target.dead || target.captured || !this.queue.has(targetId)) return;
    this.queue.moveToFront(targetId);
    this.emit({ type: "movedToFront", target: targetId, source: sourceId });
  }


  private resolveCapture(
    sourceId: string,
    targetId: string,
    cardLevel: CaptureCardLevel,
    partyLevel: number,
  ): boolean {
    const target = this.livingOrThrow(targetId);
    const chance = this.captureChanceOf(targetId, cardLevel, partyLevel);
    const success = this.captureStatusOf(targetId) === "available" && this.rng.next() < chance;
    target.captureAttemptMade = true;
    this.emit({ type: "captureResolved", source: sourceId, target: targetId, cardLevel, chance, success });
    if (!success) return false;

    target.captured = true;
    // buffs.md §1.7: leaving battle (death OR capture) strips every buff, including permanent.
    this.stripBuffsOnLeaveBattle(target);
    this.capturedMembers.push(targetId);
    const activeRoster = this.active[target.team];
    const idx = activeRoster.indexOf(targetId);
    if (idx !== -1) activeRoster.splice(idx, 1);
    // A captured summon-slot occupant (capturable=true is the Desoul factory default, §10.7 —
    // reachable only for an enemy-side summon) vacates the slot like any other departure.
    if (this.summonSlot[target.team] === targetId) {
      this.summonSlot[target.team] = undefined;
      this.emit({ type: "summonChanged", team: target.team, removed: targetId, added: undefined });
    }
    this.queue.remove(targetId);
    this.emit({ type: "captured", living: targetId, source: sourceId, cardLevel });
    this.promoteReplacement(target.team);
    return true;
  }

  /** battle.md §3: the moment either team's active roster hits zero, the battle ends. Team 0
   *  empty -> loss (winner 1), checked FIRST (matches the binary's team-0-first loop priority);
   *  else team 1 empty -> win (winner 0). Returns true iff the battle just ended. */
  private checkWinLoss(): boolean {
    if (this.active[0].length === 0) {
      this.winnerValue = 1;
      this.emit({ type: "battleEnded", winner: 1, time: this.queue.timeAtFront() });
      return true;
    }
    if (this.active[1].length === 0) {
      this.winnerValue = 0;
      this.emit({ type: "battleEnded", winner: 0, time: this.queue.timeAtFront() });
      return true;
    }
    return false;
  }

  /** One full turn: decide -> perform -> sacrifice check -> reschedule -> win/loss ->
   *  advance queue -> buff ticks -> post-tick win/loss (battle.ts header deviation #1; buffs.md
   *  §14's tick-order addition). Assumes the queue's front is alive (the caller is responsible
   *  for the dead-front skip loop). `turnStarted` is emitted BEFORE `decide` runs — identical to
   *  the pre-extraction event/RNG order. */
  resolveTurn(decide: (actorId: string) => AiDecision): void {
    if (this.openScriptedTurn !== undefined) {
      throw new Error("BattleCore.resolveTurn: a scripted turn is already open");
    }
    const opened = this.openTurn(decide);
    this.performDecision(opened.actor, opened.decision);
    this.finishDecision(opened.actor, opened.decision);
  }

  /** Opens one player turn for executable mod code. The engine emits the ordinary queued-use
   * event now, but defers all mechanics and queue advancement until the mod finishes. */
  beginScriptedTurn(decision: AiDecision): { actorId: string } {
    if (this.openScriptedTurn !== undefined) {
      throw new Error("BattleCore.beginScriptedTurn: a scripted turn is already open");
    }
    const opened = this.openTurn(() => decision);
    this.openScriptedTurn = opened;
    return { actorId: opened.actor.id };
  }

  /** Runs one ordinary ability transaction inside an open scripted turn. The mod can repeat,
   * branch, or compose different abilities; all target ids are revalidated against live teams. */
  performScriptedAbility(step: ScriptedAbilityStep): ScriptedAbilityStepResult {
    const open = this.openScriptedTurn;
    if (open === undefined) throw new Error("BattleCore.performScriptedAbility: no scripted turn is open");
    const before = this.eventLog.length;
    if (open.actor.dead) return { events: [] };
    const enemyPool = this.aiWorld.enemyPoolOf(open.actor.id);
    const friendlyPool = this.aiWorld.friendlyPoolOf(open.actor.id);
    for (const id of step.enemyTargets) {
      if (!enemyPool.includes(id)) throw new Error(`BattleCore.performScriptedAbility: ${id} is not a live enemy`);
    }
    for (const id of step.friendlyTargets) {
      if (!friendlyPool.includes(id)) throw new Error(`BattleCore.performScriptedAbility: ${id} is not a live friend`);
    }
    const ability = step.abilityPath === undefined ? open.decision.ability : this.data.ability(step.abilityPath);
    const args = step.abilityPath === undefined || step.abilityPath === open.decision.ability.path
      ? { ...open.decision.args, ...step.args }
      : { ...step.args };
    const enemyTargets = step.enemyTargets.length > 0
      ? redirectEnemyTargets(open.actor.id, [...step.enemyTargets], this.aiWorld, this.rng)
      : [];
    for (const target of enemyTargets) {
      if (!step.enemyTargets.includes(target)) this.emit({ type: "targetAltered", source: open.actor.id, target });
    }
    this.performDecision(open.actor, {
      ability,
      args,
      enemyTargets,
      friendlyTargets: [...step.friendlyTargets],
      rngDraws: 0,
    });
    return { events: this.eventLog.slice(before) };
  }

  randomScriptedPick(candidates: readonly string[]): string | undefined {
    if (this.openScriptedTurn === undefined) throw new Error("BattleCore.randomScriptedPick: no scripted turn is open");
    const targetable = new Set([...this.active[0], ...this.active[1], ...this.summonSlot.filter((id): id is string => id !== undefined)]);
    for (const id of candidates) if (!targetable.has(id)) throw new Error(`BattleCore.randomScriptedPick: ${id} is not targetable`);
    return candidates.length === 0 ? undefined : candidates[this.rng.intBelow(candidates.length)];
  }

  scriptedRandomFloat(): number {
    if (this.openScriptedTurn === undefined) throw new Error("BattleCore.scriptedRandomFloat: no scripted turn is open");
    return this.rng.next();
  }

  scriptedRandomInt(exclusiveMax: number): number {
    if (this.openScriptedTurn === undefined) throw new Error("BattleCore.scriptedRandomInt: no scripted turn is open");
    if (!Number.isInteger(exclusiveMax) || exclusiveMax < 1 || exclusiveMax > 0x7fff_ffff) {
      throw new Error("BattleCore.scriptedRandomInt: exclusiveMax must be an integer from 1 through 2147483647");
    }
    return this.rng.intBelow(exclusiveMax);
  }

  finishScriptedTurn(): BattleEvent[] {
    const open = this.openScriptedTurn;
    if (open === undefined) throw new Error("BattleCore.finishScriptedTurn: no scripted turn is open");
    const before = this.eventLog.length;
    this.openScriptedTurn = undefined;
    this.finishDecision(open.actor, open.decision);
    return this.eventLog.slice(before);
  }

  private openTurn(decide: (actorId: string) => AiDecision): {
    actor: LivingState;
    decision: AiDecision;
  } {
    const frontId = this.queue.front();
    if (frontId === undefined) throw new Error("HeadlessBattle: queue unexpectedly empty mid-battle");
    const actor = this.livingOrThrow(frontId);

    this.emit({ type: "turnStarted", living: actor.id, time: this.queue.timeAtFront() });

    const decision = decide(actor.id);
    // `Living.queAbility:` -> `Battle.adjustAbilityArgumentsForLiving:` (targeting-passives.md
    // §A): the taunt redirect rewrites enemyTargets for EVERY queued ability with at least one
    // (player and AI alike, capture included), consuming its removeRandomElement draws even when
    // no candidate carries an adjustment. friendlyTargets are never touched.
    const enemyTargets =
      decision.enemyTargets.length > 0
        ? redirectEnemyTargets(actor.id, decision.enemyTargets, this.aiWorld, this.rng)
        : decision.enemyTargets;
    for (const t of enemyTargets) {
      if (!decision.enemyTargets.includes(t)) {
        // `notifyAbilityTargetAlteredToMonster:` — the binary's render-listener-only fanout.
        this.emit({ type: "targetAltered", source: actor.id, target: t });
      }
    }
    const targets = [...enemyTargets, ...decision.friendlyTargets];
    this.emit({ type: "abilityUsed", source: actor.id, ability: decision.ability.path, targets });

    return {
      actor,
      decision: { ...decision, enemyTargets, friendlyTargets: decision.friendlyTargets },
    };
  }

  private performDecision(actor: LivingState, decision: AiDecision): void {
    const targets = [...decision.enemyTargets, ...decision.friendlyTargets];
    const use: AbilityUse = {
      source: actor.id,
      targets,
      enemyTargets: decision.enemyTargets,
      friendlyTargets: decision.friendlyTargets,
      ability: decision.ability,
      args: decision.args,
    };
    this.pendingDamageElement = actor.element; // battle.ts header deviation #6
    performAbility(use, this.battleWorld, this.rng, this.data);
    this.pendingDamageElement = undefined;
  }

  private finishDecision(actor: LivingState, decision: AiDecision): void {
    // Guaranteed retreat (battle.md, `passTime:` state-3): EscapeAbilityComponent's
    // notifyAbilityEvent:1 armed the flag during the ability; the moment the ability completes,
    // `attemptRetreatForMonster:chance:100` runs — its arc4random draw still happens but can
    // never fail (roll in [0,99] < 100). Terminal state 6: no winner, no requeue, no sacrifice
    // roll, no further ticks.
    if (this.pendingGuaranteedRetreat) {
      this.pendingGuaranteedRetreat = false;
      this.rng.intBelow(100); // the wasted-but-real draw, for RNG-order fidelity
      this.retreatedValue = true;
      this.capturedMembers.length = 0; // Encounter.showLostCaptures — same as attemptRetreat
      this.emit({ type: "escaped", living: actor.id });
      return;
    }

    // advance step (battle.md §1 advanceQueWithCounter:)
    const activationLengthRaw = decision.args["activationLength"] ?? decision.ability.activationLength;
    const activationLength = parseAbilityArgument(activationLengthRaw);
    const noHaste = decision.args["noHaste"] === true || decision.ability.raw["noHaste"] === true;
    const timeUsed = abilityTimeCost(activationLength, this.hasteOfLiving(actor), noHaste);
    actor.timeInCombat += timeUsed;
    // ability.md §7: sacrificeChance can only ever come from a job-ref's `arguments` in this
    // corpus (AbilitySchema's strict schema has no ability-dictionary-level `sacrificeChance`
    // field — none of the 96 resolved ability nodes reachable from Jobs.json declare one).
    const sacrificeChance = numberOr(decision.args["sacrificeChance"], 0);

    if (!actor.dead) {
      const u = this.rng.next(); // fresh draw, battle.md §1 (scheduler.md-confirmed direction)
      if (u < sacrificeChance) {


        this.pendingDamageElement = actor.element;
        this.applyHpDelta(actor.id, -actor.hp, actor.id, {
          suppressKillCredit: true,
          sourceOfDeath: undefined,
          cause: "sacrifice",
        });
        this.pendingDamageElement = undefined;
      } else if (timeUsed >= 1 && this.queue.has(actor.id)) {


        this.queue.addTime(actor.id, timeUsed);
      }
    } else if (this.queue.has(actor.id)) {
      this.queue.remove(actor.id); // defensive fallback, battle.md §1
    }

    if (this.checkWinLoss()) return;

    const timePassed = this.queue.advanceTimeToNext();
    const anyDeathFromTicks = this.advanceBuffDurations(timePassed);
    if (anyDeathFromTicks) this.checkWinLoss();
  }

  /** The seeding block + battleStarted emit + initial queue rebase from runToCompletion. */
  seedAndStart(): void {


    for (const teamNum of [0, 1] as const) {
      for (const id of this.active[teamNum]) {
        const living = this.livingOrThrow(id);
        const delay = Math.trunc(initialBattleDelay(this.statOf(living, "Speed"), this.rng));
        this.queue.setTime(id, delay);
      }
    }

    this.emit({
      type: "battleStarted",
      teams: [
        [...this.active[0], ...this.bench[0]],
        [...this.active[1], ...this.bench[1]],
      ],
    });

    // buffs.md §2.3/§9: every active living's passiveBuffs, then every aura owner's team-wide
    // grant — team-0-then-team-1 active order, zero RNG draws.
    this.seedEnterBattle();

    this.queue.advanceTimeToNext(); // rebase timeAtFront to the earliest-scheduled living
  }

  /** dead/destroyed-front skip loop (battle.md §1's defensive fallback — the death pipeline
   *  removes dead entries from the queue immediately, so this rarely triggers in practice;
   *  kept for fidelity to the binary's own recursion-bounded assert). */
  skipDeadFront(): void {
    let skips = 0;
    while (true) {
      const frontId = this.queue.front();
      if (frontId === undefined) throw new Error("HeadlessBattle: queue unexpectedly empty mid-battle");
      if (!this.livingOrThrow(frontId).dead) break;
      skips++;
      if (skips > MAX_FRONT_SKIPS) throw new Error('HeadlessBattle: "Battle stuck in infinite loop"');
      this.queue.remove(frontId);
    }
  }
}

/** `addStatOnlyBuff`'s buffType inference (see its own doc comment above). */
function inferStatOnlyBuffType(statusEffects: readonly StatusEffect[] | undefined): string {
  if (!statusEffects || statusEffects.length === 0) return "StatOnly";
  if (statusEffects.includes("Sleep")) return "Offensive.Sleep";
  if (statusEffects.includes("Paralyze")) return "Offensive.Paralyze";
  if (statusEffects.includes("Confuse")) return "Offensive.Confuse";
  return "StatOnly";
}
