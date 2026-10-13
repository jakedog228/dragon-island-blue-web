import type { TownBuildingConditions } from "@dib/gamedata/browser";
import type { GuildQuestRuntime } from "@dib/engine";

/**
 * Source `Conditions` predicates used by the eight authored conditional town buildings.
 *
 * A leading `!` negates the single stored identity. The shipped corpus uses:
 * - `chats`: membership in `UserSavedData.dialogsSeen`;
 * - `inProgressQuests`: `Player.canUseQuestKey:` (active and incomplete);
 * - `quests`: membership in the durable finished-quest names.
 */
export function guildTownConditionsPass(
  conditions: TownBuildingConditions | undefined,
  quests: GuildQuestRuntime,
): boolean {
  if (conditions === undefined) return true;
  return (
    conditionPasses(conditions.chats, (name) => quests.hasSeenDialog(name)) &&
    conditionPasses(conditions.inProgressQuests, (name) => quests.canUseQuestKey(name)) &&
    conditionPasses(conditions.quests, (name) => quests.hasFinishedQuest(name))
  );
}






















export function townBuildingIsRevealed(
  conditions: TownBuildingConditions | undefined,
  quests: GuildQuestRuntime | undefined,
): boolean {
  if (conditions === undefined) return true;
  return quests !== undefined && guildTownConditionsPass(conditions, quests);
}

/**
 * Indices whose fresh `townBuildingIsRevealed` verdict differs from the one the retained node was
 * built with. Source `backToWorld:` rebuilds the WorldNode after every world battle, so these are
 * exactly the houses whose service layer a new node would construct differently.
 */
export function townBuildingRevealChanges(
  built: readonly { readonly revealed: boolean }[],
  verdicts: readonly boolean[],
): number[] {
  if (built.length !== verdicts.length) {
    throw new Error(
      `town building re-gate has ${verdicts.length} verdicts for ${built.length} buildings`,
    );
  }
  return built.flatMap(({ revealed }, index) => revealed === verdicts[index] ? [] : [index]);
}

function conditionPasses(
  expression: string | undefined,
  predicate: (name: string) => boolean,
): boolean {
  if (expression === undefined) return true;
  const negated = expression.startsWith("!");
  const name = negated ? expression.slice(1) : expression;
  if (name.length === 0) throw new Error("Guild Tavern condition has an empty identity");
  const value = predicate(name);
  return negated ? !value : value;
}
