import type { BattleEvent, GuildQuestEvent } from "@dib/engine";

export function enemyDefeatQuestEvents(
  events: readonly BattleEvent[],
  enemyDeadIds: ReadonlySet<string>,
  shortTypeOf: (id: string) => string,
): readonly Extract<GuildQuestEvent, { id: 0 }>[] {
  const result: Extract<GuildQuestEvent, { id: 0 }>[] = [];
  const createdTypes = new Map<string, string>();
  for (const event of events) {
    // Split at 1 HP creates a zero-HP clone which dies in this same result. Its display roster
    // is registered later at impact; the construction event already owns its exact identity.
    if (event.type === "monsterAdded") createdTypes.set(event.living, event.shortType);
    if (event.type !== "died" || !enemyDeadIds.has(event.living)) continue;
    result.push({
      id: 0,
      target: {
        shortType: createdTypes.get(event.living) ?? shortTypeOf(event.living),
        inEnemyDeadMembers: true,
      },
    });
  }
  return Object.freeze(result);
}
