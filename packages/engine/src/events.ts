// Shared battle event/report API. Update every consumer when changing these shapes.
// `battle.ts` is the sole producer.

import type { Element, StatName } from "@dib/gamedata";
import type { StatusEffect } from "./buff.js";
import type { AbilityEffectText } from "./effectText.js";

/** See `damageDealt`/`healed`'s `cause` doc below. */
export type CollateralHpCause = "poisonTick" | "reflected" | "sacrifice";

/** See `buffAdded`'s `cause` doc below. */
export type CollateralBuffCause = "proc" | "revenge" | "aura" | "passive";

export type BattleEvent =
  | { type: "battleStarted"; teams: [string[], string[]] }
  | { type: "turnStarted"; living: string; time: number }
  | { type: "abilityUsed"; source: string; ability: string; targets: string[] }


  | { type: "abilityEvent"; event: number; arguments: unknown }


  | { type: "damageDealt"; source: string; target: string; amount: number; element: Element; hpAfter: number; cause?: CollateralHpCause }
  | { type: "healed"; source: string; target: string; amount: number; hpAfter: number; cause?: CollateralHpCause }
  | { type: "died"; living: string }
  | {
      type: "captureResolved";
      source: string;
      target: string;
      cardLevel: 1 | 2 | 3;
      chance: number;
      success: boolean;
    }
  | { type: "captured"; living: string; source: string; cardLevel: 1 | 2 | 3 }
  | { type: "battleEnded"; winner: 0 | 1 | "draw"; time: number }


  | {
      type: "buffAdded";
      target: string;
      source: string;
      buffType: string;
      statusEffects: readonly StatusEffect[];
      permanent: boolean;
      duration?: number;
      cause?: CollateralBuffCause;
    }
  | {
      type: "buffRemoved";
      target: string;
      buffType: string;
      statusEffects: readonly StatusEffect[];
      reason: "expired" | "removed" | "hurt" | "leftBattle";
    }


  | { type: "stunned"; target: string; source: string; delay: number; reactive?: boolean }


  | { type: "effectText"; target: string; effect: AbilityEffectText }
  | { type: "deathSentence"; target: string; source: string }


  | { type: "monsterAdded"; living: string; shortType: string; level: number; team: 0 | 1; summoner: string }


  | { type: "switched"; out: string; in: string; team: 0 | 1 }
  /** `-[UserSavedData spendSilver:]` succeeded for a SpendSilverAbilityComponent cost. */
  | { type: "silverSpent"; source: string; amount: number; remaining: number }
  /** `-[Battle moveToFrontForLiving:]` (TimedQue moveToFrontForItem:) via MoveToFront. */
  | { type: "movedToFront"; target: string; source: string }


  | {
      type: "summonChanged";
      team: 0 | 1;
      removed: string | undefined;
      added: string | undefined;
      shortType?: string;
      level?: number;
      summoner?: string;
      /** Present only for HeroDisplay's native autonomous spirit construction. */
      origin?: "spirit";
    }
  /** Guaranteed retreat: `notifyAbilityEvent:1` armed the flag and the always-succeeding
   * `attemptRetreatForMonster:chance:100` roll fired (battle state 6, terminal, no winner). */
  | { type: "escaped"; living: string }
  /** `notifyAbilityTargetAlteredToMonster:` (targeting-passives.md §A): the taunt redirect
   * drew `target` into the ability's enemy-target list even though it wasn't originally picked.
   * Render-listener-only in the binary; the following `abilityUsed` already carries the final
   * (post-redirect) targets. */
  | { type: "targetAltered"; source: string; target: string }
  /** A reactive buff fired its own visual trigger outside any ability-cast phase dispatch
   * (gui/status-effects.md §4): ReflectiveBuff's `notifyLiving:tookDamage:` builds an
   * AbilityResult from the BUFF's own `sourceEventData` (the thorns.png flash) the moment its
   * wearer takes non-reflected damage. `living` is the buff's wearer; the reflected
   * `damageDealt` (source = wearer) follows in the same event run. */
  | { type: "buffTriggered"; living: string; buffType: string }


  | { type: "phaseResolved"; phase: "friends" | "enemy"; source: string; targets: readonly string[] };


export interface SoulStoneSetup {
  /** Element of the SACRIFICED monster — resolves `SoulStones.<Element>SoulStone`. */
  element: Element;
  /** The stone's `Item.level` ivar — immutable and unclamped after mint (soulstones.md §5.5).
   * Compute from a sacrifice with `soulStoneMintLevel(stars, level)`. */
  level: number;
  /** Sacrificed monster's type name (`sourceType` property, §2.2) — the Desoul revive target
   * (`shortType` in this port). Never affects stats, but LOAD-BEARING for `Utility.Desoul`:
   * BattleCore rejects at construction a stone WITHOUT it on a monster whose kit carries
   * Desoul (a native stone always has one — `buildSoulStone` writes it unconditionally; only
   * hand-written port setups can omit it). */
  sourceType?: string;
}

export interface TeamMemberSetup {
  shortType: string;
  level: number;
  /** Optional in-memory trip HP when projecting an existing player monster into a new battle.
   * Omission preserves `Living.setCreationFile:`'s native full-HP initialization. A projected
   * participant must be alive, so zero-HP monsters are filtered by the party layer rather than
   * constructed here. HP may transiently exceed the current MaxHP after Desoul consumes a
   * MaxHP-bearing stone; the source leaves it unclamped until the next HP adjustment. */
  currentHp?: number;
  /** Per-instance Monster.capturable. The native initializer defaults this to true. */
  capturable?: boolean;
  /** Optional durable player/save identity from which this temporary battle participant was
   * projected. It never affects source battle math, scheduling, targeting, or the stable battle
   * id; it is retained solely for later progression/award integration. */
  sourceInstanceId?: string;
  /** Native Living.boss flag: immune to Sleep, Paralyze, Confuse, and direct Stun. */
  boss?: boolean;
  /** Flat source `Breeder.statBonuses` applied to every member before combat. This is deliberately
   * separate from temporary buffs and soul-stone children: it mutates the creation-time cached
   * stat basis exactly once and therefore also participates in initial MaxHP/full-HP setup. */
  flatStatBonuses?: Partial<Record<StatName, number>>;


  playerBuffs?: Partial<Record<StatName, number>>;
  /** Equipped soul stone, if any (see SoulStoneSetup). */
  soulStone?: SoulStoneSetup;
}

/** Durable, battle-runtime-free state copied back to the player party at a terminal boundary.
 * Keys are `TeamMemberSetup.sourceInstanceId`; battle ids, buffs, queue state, and summons never
 * cross this seam. */
export interface PlayerBattleTerminalMemberState {
  currentHp: number;
  soulStone?: SoulStoneSetup;


  leftBattle: boolean;
}

export type PlayerBattleTerminalSnapshot = Record<string, PlayerBattleTerminalMemberState>;

/** Stable temporary battle identity. The original construction index remains part of the id even
 * after reserve promotion, so display and test consumers never derive identity from a live slot. */
export function battleLivingId(team: 0 | 1, constructionIndex: number, shortType: string): string {
  return `t${team}m${constructionIndex}:${shortType}`;
}

export interface BattleReport {
  winner: 0 | 1 | "draw";
  events: readonly BattleEvent[];
  elapsed: number;
}
