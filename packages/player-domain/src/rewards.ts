// Provider-neutral reward settlement belongs to player state, never presentation.
import type { PlayerReward } from "@dib/engine/rewards";
import type { PlayerProfile } from "./playerProfile.js";

export type AppliedPlayerReward =
  | { readonly kind: "silver"; readonly amount: number; readonly balance: number }
  | { readonly kind: "gold"; readonly amount: number; readonly balance: number }
  | { readonly kind: "spiritTotem"; readonly shortType: string; readonly firstTime: boolean; readonly savedXpAfter: number }
  | { readonly kind: "recipe"; readonly combineName: string; readonly newlyLearned: boolean }
  | {
      readonly kind: "usable";
      readonly definitionPath: string;
      readonly instanceName: string;
      readonly level: number;
      readonly instanceId: string;
    }
  | { readonly kind: "monsterJoin"; readonly shortType: string; readonly jobLevel: number; readonly instanceId: string }
  | { readonly kind: "item"; readonly key: string; readonly amount: number; readonly total: number };

/**
 * Sole application seam from provider-neutral engine rewards into durable player state.
 *
 * Treasure, catch quests, egg hatching, and later reward providers must use this path so currency,
 * inventory identity, recipe idempotence, spirit XP, and change notification stay consistent.
 */
export function applyPlayerRewards(
  profile: PlayerProfile,
  rewards: readonly PlayerReward[],
  options: {
    readonly addMonsterJoin?: (
      shortType: string,
      jobLevel: number,
    ) => { readonly instanceId: string };
  } = {},
): readonly AppliedPlayerReward[] {
  const results: AppliedPlayerReward[] = [];
  for (const reward of rewards) {
    switch (reward.kind) {
      case "silver":
        results.push(Object.freeze({
          kind: "silver",
          amount: reward.amount,
          balance: profile.awardSilver(reward.amount),
        }));
        break;
      case "gold":
        results.push(Object.freeze({
          kind: "gold",
          amount: reward.amount,
          balance: profile.awardGold(reward.amount),
        }));
        break;
      case "spiritTotem": {
        const awarded = profile.awardSpiritTotem(reward.shortType);
        results.push(Object.freeze({
          kind: "spiritTotem",
          shortType: reward.shortType,
          firstTime: awarded.firstTime,
          savedXpAfter: awarded.savedXpAfter,
        }));
        break;
      }
      case "recipe":
        results.push(Object.freeze({
          kind: "recipe",
          combineName: reward.combineName,
          newlyLearned: profile.learnCombineRecipe(reward.combineName),
        }));
        break;
      case "egg":
      case "monsterEgg":
      case "repeatEgg":
        // `Player.addItem:` invokes Egg.destroyFromPickup synchronously and never inserts either
        // standard egg into usableItems. Presentation must intercept these rewards and run the
        // hatch reducer; silently serializing one is an invented lifecycle.
        throw new Error(
          `${reward.kind} is destroy-on-pickup and requires the egg hatch presentation/settlement path`,
        );
      case "usable": {
        const item = profile.inventory.addUsable(
          reward.definitionPath,
          reward.instanceName,
          reward.level,
        );
        results.push(Object.freeze({
          kind: "usable",
          definitionPath: reward.definitionPath,
          instanceName: reward.instanceName,
          level: reward.level,
          instanceId: item.id,
        }));
        break;
      }
      case "gem":
        results.push(itemResult(
          profile,
          `GemLevel:${reward.level}:Quality:${reward.quality}:Slot:${reward.slot}:Stats:${reward.enabledStats.join(",")}`,
          1,
        ));
        break;
      case "monsterJoin": {
        if (options.addMonsterJoin === undefined) {
          throw new Error(
            `MonsterJoin reward ${reward.shortType} requires a durable world-party destination`,
          );
        }
        const joined = options.addMonsterJoin(reward.shortType, reward.jobLevel);
        results.push(Object.freeze({
          kind: "monsterJoin",
          shortType: reward.shortType,
          jobLevel: reward.jobLevel,
          instanceId: joined.instanceId,
        }));
        break;
      }
    }
  }
  return Object.freeze(results);
}

function itemResult(profile: PlayerProfile, key: string, amount: number): AppliedPlayerReward {
  return Object.freeze({ kind: "item", key, amount, total: profile.awardItem(key, amount) });
}
