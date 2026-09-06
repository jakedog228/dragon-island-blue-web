


import { describe, expect, it } from "vitest";
import type { Rng } from "../src/rng.js";
import {
  WorldTrip,
  createWorldTripSharedState,
  type WorldDefinition,
} from "../src/world.js";
import type { GuildQuestEvent } from "../src/quests.js";

/** These flows must complete POIs without consuming encounter randomness. */
class NoDrawRng implements Rng {
  next(): number {
    throw new Error("unexpected next() draw");
  }
  intBelow(): number {
    throw new Error("unexpected intBelow() draw");
  }
  chance(): boolean {
    throw new Error("unexpected chance() draw");
  }
}

/** Two encounter POIs plus one encounterless town, so `hasEncounter` filtering is observable. */
function questWorld(): WorldDefinition {
  const encounter = {
    table: {
      "1": {
        monsterPopulator: {
          class: "DefaultMonsterPopulator" as const,
          minMonstersPerPack: 1,
          maxMonstersPerPack: 1,
          types: [{ type: "Slime", chance: 100 }],
          fixedEncounters: [],
        },
      },
    },
  };
  return {
    instanceName: "World_2-3",
    pointsOfInterest: [
      { instanceName: "Town" },
      { instanceName: "Field", encounter },
      { instanceName: "Cave", encounter },
    ],
    connections: [
      { poi1: "Town", poi2: "Field" },
      { poi1: "Field", poi2: "Cave" },
    ],
  };
}

/**
 * `begin()` completes an encounterless starting POI, which legitimately notifies completion for the
 * town before any objective work happens. Events are cleared afterwards so each test asserts only
 * on what its own actions produced.
 */
function tripWithEvents(): { trip: WorldTrip; events: GuildQuestEvent[] } {
  const events: GuildQuestEvent[] = [];
  const trip = new WorldTrip(questWorld(), "Town", new NoDrawRng(), {
    randomMonsterTypes: [],
    sharedState: createWorldTripSharedState(),
    onQuestEvent: (event) => { events.push(event); },
  });
  trip.begin();
  expect(events).toEqual([
    {
      id: 2,
      world: { instanceName: "World_2-3", encounterPoiCount: 2, completedEncounterPoiCount: 0 },
    },
  ]);
  events.length = 0;
  return { trip, events };
}

describe("world POI quest-event producers", () => {
  it("fires event 1 on an encounter win, counting only POIs that have an encounter", () => {
    const { trip, events } = tripWithEvents();
    trip.recordEncounterWin("Field");

    const world = events.filter((event) => event.id === 1);
    expect(world).toHaveLength(1);
    // `Town` is excluded by `hasEncounter`; `Field` is the one completed encounter POI of two.
    expect(world[0]).toEqual({
      id: 1,
      world: { instanceName: "World_2-3", encounterPoiCount: 2, completedEncounterPoiCount: 1 },
    });

    trip.recordEncounterWin("Cave");
    const second = events.filter((event) => event.id === 1).at(-1);
    expect(second).toEqual({
      id: 1,
      world: { instanceName: "World_2-3", encounterPoiCount: 2, completedEncounterPoiCount: 2 },
    });
  });

  it("suppresses event 1 for a POI already completed this refresh, but still counts the win", () => {
    const { trip, events } = tripWithEvents();
    trip.recordEncounterWin("Field");
    events.length = 0;


    expect(trip.recordEncounterWin("Field")).toBe(2);
    expect(events.filter((event) => event.id === 1)).toHaveLength(0);
  });

  it("notifies POI completion at most once per run, across town refreshes", () => {
    const { trip, events } = tripWithEvents();
    trip.recordEncounterWin("Field");
    expect(events.filter((event) => event.id === 2)).toHaveLength(1);

    // A town refresh clears `completedThisRefresh` but not the process-global notify gate.
    trip.refreshAtTown();
    trip.recordEncounterWin("Field");
    expect(events.filter((event) => event.id === 2)).toHaveLength(1);
  });

  it("carries the same world payload on event 2 as on event 1", () => {
    const { trip, events } = tripWithEvents();
    trip.recordEncounterWin("Field");
    const second = events.find((event) => event.id === 2);
    expect(second).toEqual({
      id: 2,
      world: { instanceName: "World_2-3", encounterPoiCount: 2, completedEncounterPoiCount: 1 },
    });
  });

  it("stays silent when no quest listener is installed", () => {
    const trip = new WorldTrip(questWorld(), "Town", new NoDrawRng(), {
      randomMonsterTypes: [],
      sharedState: createWorldTripSharedState(),
    });
    trip.begin();
    expect(() => trip.recordEncounterWin("Field")).not.toThrow();
  });

  it("does not double-notify a POI the starting arrival already completed", () => {
    const { trip, events } = tripWithEvents();
    trip.navigate("Town", []);
    expect(events.filter((event) => event.id === 2)).toHaveLength(0);
  });

  it("refuses a quest listener on a world with no instanceName to compare against", () => {
    const { instanceName: _omitted, ...anonymous } = questWorld();
    expect(() => new WorldTrip(anonymous, "Town", new NoDrawRng(), {
      randomMonsterTypes: [],
      onQuestEvent: () => {},
    })).toThrow(/instanceName/);
  });
});
