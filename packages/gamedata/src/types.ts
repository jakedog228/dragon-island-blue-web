


export type Element = "Air" | "Arcane" | "Death" | "Earth" | "Fire" | "Life" | "Water";
export type StatName = "Attack" | "Defense" | "Magic" | "MaxHP" | "Resist" | "Speed";

export interface MonsterDef {
  path: string; // "Animal.BatFiend"
  shortType: string; // "BatFiend" (last path segment; used by evolveData.newType & Jobs)
  category: "Collection" | "Combine" | "Egg" | "Normal" | "Summon";
  element: Element;
  index: number;
  quality: number;
  stars: number;
  rootStats: Record<StatName, number>;
  unarmedAttackType: string;
  evolveData?: { levelReq: number; newType: string };


  eggUnlockQuality: number;
  summonXpBonus?: number;
  rendererData?: unknown; // display-only passthrough
}


export interface CombineRecipeDef {
  resultShortType: string;
  ingredients: readonly [string, string];
}


export interface SoulStoneDef {
  path: string;


  element: Element;


  enabledStats: readonly StatName[];
}

export type ItemSlot =
  | "Novice"
  | "Veteran"
  | "Elite"
  | "Grandmaster"
  | "Monster"
  | "Useable"
  | "Other";

export type ItemClassName =
  | "Item"
  | "Gem"
  | "SoulStone"
  | "Egg"
  | "CustomEgg"
  | "Gold"
  | "Silver"
  | "MonsterJoin"
  | "Recipe"
  | "SpiritTotem";

/** Strict resolved `Items.plist` leaf. Runtime construction arguments (Gem level/quality/stats,
 * Egg repeats, recipe/monster identities) live on inventory instances rather than mutating this
 * immutable definition. */
export interface ItemDef {
  readonly path: string;
  readonly instanceName: string;
  readonly className: ItemClassName;
  readonly slot: ItemSlot;
  readonly abilities: readonly string[];
  readonly enabledStats: readonly StatName[];
  readonly holderBuffs: readonly Readonly<Record<string, unknown>>[];
  /** Native Item initialization prefers the definition's level over creation arguments. */
  readonly level?: number;
  readonly repeats: boolean;
  readonly onlyMonsters: boolean;
  readonly rendererData?: unknown;
}

export type LicenseType =
  | "Novice"
  | "Apprentice"
  | "Veteran"
  | "Expert"
  | "Elite"
  | "Master"
  | "Grandmaster";

export interface LicenseDef {
  readonly type: LicenseType;
  readonly ordinal: number;
  readonly heroLevelRequired: number;
  readonly completedQuestsRequired: number;
  readonly challengeLevel: number;
  readonly battingOrderSize: number;
  readonly gemSlots: number;
  /** Source encounter provider dictionary retained for the arena reducer. */
  readonly monsterPopulator: Readonly<Record<string, unknown>>;
}

/** One ordered `Tournaments.plist` entry. Tournament order is durable player progression state,
 * and each of the four populator dictionaries is selected directly by round index. */
export interface TournamentDef {
  readonly index: number;
  readonly name: string;
  readonly subtitle: string;
  readonly challengeLevel: number;
  readonly prizeImage: string;
  readonly monsterPopulators: readonly Readonly<Record<string, unknown>>[];
  readonly treasureData: Readonly<Record<string, unknown>>;
}

/** One resolved Buffs.json node used by the native ability-help description pipeline. */
export interface BuffDef {
  path: string;
  className: string;
  raw: Record<string, unknown>;
}

export interface JobAbilityRef {
  slot: string;
  type: string;
  arguments: Record<string, unknown>;
}

export interface AbilityDef {
  path: string;
  className: string; // "CombatAbility" | "NonCombatAbility" | …
  activationLength?: string; // raw "{N}" string until Task 8 REs it
  components: Array<{ type: string } & Record<string, unknown>>;
  targetPicker?: Record<string, unknown>;
  aiChance?: number;
  raw: Record<string, unknown>; // full resolved node (eventData, soundTable, buffs…)
}

export interface AbilityComponentDef {
  path: string;
  className: string; // "AttackAbilityComponent" | …
  raw: Record<string, unknown>;
}
