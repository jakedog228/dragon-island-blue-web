import type { BattleSession, BattleEvent } from "@dib/engine";

/** Camera-only mapping. IDs and RNG order always remain the authority's canonical values. */
export function pvpPerspectiveEvent(event: BattleEvent, you: 0 | 1): BattleEvent {
  if (you === 0) return event;
  if ("team" in event) return { ...event, team: event.team === 0 ? 1 : 0 };
  if (event.type === "battleStarted") return { ...event, teams: [event.teams[1], event.teams[0]] };
  if (event.type === "battleEnded" && event.winner !== "draw") return { ...event, winner: event.winner === 0 ? 1 : 0 };
  return event;
}

export function pvpPerspectiveSession(session: BattleSession, you: 0 | 1): BattleSession {
  const teamQueries = new Set(["activeIdsOf", "deadIdsOf", "benchCountOf", "benchIdsOf", "summonIdOf", "targetableIdsOf"]);
  return new Proxy(session, {
    get(target, key) {
      if (key === "events") return target.events.map(e => pvpPerspectiveEvent(e, you));
      if (key === "teamOf") return (id: string) => target.teamOf(id) === you ? 0 : 1;
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (teamQueries.has(String(key))) return (team: 0 | 1) => value.call(target, team === 0 ? you : you === 0 ? 1 : 0);
      if (key === "submitEnemyAction") return () => {
        const resolved = target.submitEnemyAction();
        return { ...resolved, events: resolved.events.map(e => pvpPerspectiveEvent(e, you)) };
      };
      if (key === "advanceForPresentation") return () => {
        const step = target.advanceForPresentation();
        return step.type === "ended" && step.report.winner !== "draw" ? {
          ...step, report: { ...step.report, winner: step.report.winner === you ? 0 : 1 },
        } : step;
      };
      return value.bind(target);
    },
  });
}
