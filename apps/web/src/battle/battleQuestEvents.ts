import type { BattleEvent, GuildQuestEvent } from "@dib/engine";

export function enemyDefeatQuestEvents(
  events: readonly BattleEvent[],
  enemyDeadIds: ReadonlySet<string>,
  shortTypeOf: (id: string) => string,
): readonly Extract<GuildQuestEvent, { id: 0 }>[] {
  const result: Extract<GuildQuestEvent, { id: 0 }>[] = [];
  for (const event of events) {
    if (event.type !== "died" || !enemyDeadIds.has(event.living)) continue;
    result.push({
      id: 0,
      target: {
        shortType: shortTypeOf(event.living),
        inEnemyDeadMembers: true,
      },
    });
  }
  return Object.freeze(result);
}
