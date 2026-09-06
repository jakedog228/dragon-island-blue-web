import {
  BattleSession,
  STATUS_NAMES,
  restoreBattleReplay,
  type BattleEvent,
  type BattleReplaySnapshotV1,
  type PresentationSessionStep,
  type ReplayableRng,
  type StatusEffect,
} from "@dib/engine";
import type { GameData } from "@dib/gamedata";

export interface RestoredRosterIdentity {
  readonly id: string;
  readonly team: 0 | 1;
  readonly shortType: string;
  readonly level: number;
}

export interface OfficialBattlePresentationMount {
  readonly session: BattleSession;
  readonly resumedStep: PresentationSessionStep | undefined;
  /** Historical events are hydration input only; reconnects must never replay their animations. */
  readonly historyEvents: readonly BattleEvent[];
}

/**
 * A fresh Official scene presents the committed automatic prefix from its beginning. A reconnect
 * instead mounts directly at the committed decision and uses history only to hydrate current UI.
 */
export function mountOfficialBattlePresentation(
  data: GameData,
  replay: BattleReplaySnapshotV1,
  rng: ReplayableRng,
  resumeExisting: boolean,
): OfficialBattlePresentationMount {
  if (resumeExisting) {
    const restored = restoreBattleReplay(data, replay, { replayRng: rng });
    if (restored.step.type === "retreated") {
      throw new Error("official presentation cannot mount a retreated replay");
    }
    return {
      session: restored.session,
      resumedStep: restored.step,
      historyEvents: restored.events,
    };
  }

  if (replay.commands.length !== 0) {
    throw new Error("fresh official battle presentation cannot contain historical player commands");
  }
  if (replay.randomDraws === undefined) {
    throw new Error("fresh official battle presentation requires a committed random-draw tape");
  }
  if (rng.cursor !== 0) {
    throw new Error(`fresh official battle presentation RNG is already at cursor ${rng.cursor}`);
  }
  if (JSON.stringify(rng.draws) !== JSON.stringify(replay.randomDraws)) {
    throw new Error("fresh official battle presentation RNG does not match the committed snapshot tape");
  }

  // Validate the complete authority-projected prefix with an independent tape. The visible
  // session then consumes its shared tape from cursor zero, one presented turn at a time.
  restoreBattleReplay(data, replay);
  return {
    session: new BattleSession(
      data,
      [
        replay.teams[0].map((member) => structuredClone(member)),
        replay.teams[1].map((member) => structuredClone(member)),
      ],
      rng,
      replay.options,
    ),
    resumedStep: undefined,
    historyEvents: [],
  };
}

/** Exact live status stack counts after folding a deterministic replay history. */
export function restoredStatusCounts(
  events: readonly BattleEvent[],
): ReadonlyMap<string, Readonly<Record<StatusEffect, number>>> {
  const counts = new Map<string, Record<StatusEffect, number>>();
  const row = (id: string): Record<StatusEffect, number> => {
    let current = counts.get(id);
    if (current === undefined) {
      current = { Sleep: 0, Paralyze: 0, Poison: 0, Confuse: 0 };
      counts.set(id, current);
    }
    return current;
  };
  for (const event of events) {
    if (event.type !== "buffAdded" && event.type !== "buffRemoved") continue;
    const current = row(event.target);
    const delta = event.type === "buffAdded" ? 1 : -1;
    for (const status of event.statusEffects) {
      current[status] = Math.max(0, current[status] + delta);
    }
  }
  return new Map(
    [...counts].map(([id, current]) => [
      id,
      Object.freeze(Object.fromEntries(STATUS_NAMES.map((status) => [status, current[status]]))) as Record<StatusEffect, number>,
    ]),
  );
}

/** Every identity constructed after initial setup, in first-construction order. */
export function restoredRosterIdentities(events: readonly BattleEvent[]): readonly RestoredRosterIdentity[] {
  const byId = new Map<string, RestoredRosterIdentity>();
  for (const event of events) {
    const identity: RestoredRosterIdentity | undefined = event.type === "monsterAdded"
      ? { id: event.living, team: event.team, shortType: event.shortType, level: event.level }
      : event.type === "summonChanged" && event.added !== undefined &&
          event.shortType !== undefined && event.level !== undefined
        ? { id: event.added, team: event.team, shortType: event.shortType, level: event.level }
        : undefined;
    if (identity !== undefined && !byId.has(identity.id)) byId.set(identity.id, identity);
  }
  return Object.freeze([...byId.values()]);
}

/** Analyze is a battle-presentation latch enabled by engine event 0. */
export function restoredAnalyzeEnabled(events: readonly BattleEvent[]): boolean {
  return events.some((event) => event.type === "abilityEvent" && event.event === 0);
}
