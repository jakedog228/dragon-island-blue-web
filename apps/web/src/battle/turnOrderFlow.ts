import type { BattleEvent } from "@dib/engine";

export interface TurnOrderResolutionPlan {
  /** Native state 4/5/6 skips the later battle-time `updateOrder` notification. */
  terminal: boolean;
  /** Livings the DEATH pipeline removed (`died`/`captured`). Drives `handleDeaths` and the
   *  terminal state's living-removal pacing count — NOT the turn-order column, which also has to
   *  present switch-outs. */
  removedIds: readonly string[];


  teamRemovedIds: readonly string[];
  /** Captures hold their detached portrait for two seconds before the common fall. */
  captureSuccessIds: readonly string[];
}

/**
 * Splits native `notifyTeam:removedMonster:` presentation (which invokes its own `updateOrder`)
 * from the later `notifyBattleTimePassed:` update. A terminal win/loss/escape still presents and
 * compacts removals, but never samples the post-turn queue state.
 */
export function turnOrderResolutionPlan(events: readonly BattleEvent[]): TurnOrderResolutionPlan {
  const removedIds: string[] = [];
  const teamRemovedIds: string[] = [];
  const captureSuccessIds: string[] = [];
  let terminal = false;

  // One pass, so `teamRemovedIds` keeps the order the source's own `fireMonsterLeft:` calls
  // happen in rather than grouping deaths ahead of switch-outs.
  for (const event of events) {
    if (event.type === "died") {
      removedIds.push(event.living);
      teamRemovedIds.push(event.living);
    } else if (event.type === "captured") {
      removedIds.push(event.living);
      teamRemovedIds.push(event.living);
      captureSuccessIds.push(event.living);
    } else if (event.type === "switched") {
      // NOT a capture: the outgoing monster has no `captureSuccess` property, so `boolValue` on
      // the nil lookup is 0 and it takes the ordinary immediate fall. (The FIELD displays do
      // borrow the capture-flavoured no-shake removal for a switch-out — see `handleSwitched` —
      // but that is a different listener with a different reason.)
      teamRemovedIds.push(event.out);
    } else if (event.type === "battleEnded" || event.type === "escaped") {
      terminal = true;
    }
  }

  return { terminal, removedIds, teamRemovedIds, captureSuccessIds };
}


export function preAdvanceQueueProjection(
  actorId: string,
  postAdvanceQueue: readonly string[],
): readonly string[] {
  if (!postAdvanceQueue.includes(actorId)) return postAdvanceQueue;
  return [actorId, ...postAdvanceQueue.filter((id) => id !== actorId)];
}
