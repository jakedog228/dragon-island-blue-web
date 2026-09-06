/**
 * Source reward vocabulary shared by treasure, quest, egg, shop, and future award providers.
 *
 * Providers decide which rewards are generated and in what order. Applying them to durable player
 * state belongs to the web/player layer, keeping this engine model storage- and presentation-free.
 */
export type RewardGemQuality = 0 | 1;
export type RewardGemSlot = 0 | 1 | 2 | 3;
export const REWARD_GEM_STATS = Object.freeze([
  "MaxHP",
  "Attack",
  "Magic",
  "Speed",
  "Defense",
  "Resist",
] as const);
export type RewardGemStat = (typeof REWARD_GEM_STATS)[number];

/** Lossless source-generated Gem identity, including post-slot with-replacement stat rolls. */
export interface GemReward {
  readonly kind: "gem";
  readonly level: number;
  readonly quality: RewardGemQuality;
  readonly slot: RewardGemSlot;
  readonly enabledStats: readonly RewardGemStat[];
}

/**
 * Rewards that can be granted directly to the durable player profile.
 *
 * This union is intentionally provider-neutral. `DungeonLoot` remains a compatibility alias in
 * the dungeon module, but a treasure chest is only one source of these same reward objects.
 */
export type PlayerReward =
  | { readonly kind: "silver"; readonly amount: number }
  | { readonly kind: "gold"; readonly amount: number }
  | GemReward
  | { readonly kind: "spiritTotem"; readonly shortType: string }
  | { readonly kind: "recipe"; readonly combineName: string }
  | { readonly kind: "egg" }
  | { readonly kind: "monsterEgg" }
  | {
      readonly kind: "repeatEgg";
      readonly definitionPath: string;
      readonly instanceName: string;
      readonly numRepeats: number;
    }
  | {
      readonly kind: "usable";
      readonly definitionPath: string;
      readonly instanceName: string;
      readonly level: number;
    }
  | { readonly kind: "monsterJoin"; readonly shortType: string; readonly jobLevel: number };
