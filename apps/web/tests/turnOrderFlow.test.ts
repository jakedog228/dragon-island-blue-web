import { describe, expect, it } from "vitest";
import type { BattleEvent } from "@dib/engine";
import { preAdvanceQueueProjection, turnOrderResolutionPlan } from "../src/battle/turnOrderFlow.js";

describe("turnOrderResolutionPlan", () => {
  it("keeps the common refresh for a nonterminal capture and classifies its delayed removal", () => {
    const events: BattleEvent[] = [
      { type: "captured", living: "enemy", source: "hero", cardLevel: 3 },
    ];

    expect(turnOrderResolutionPlan(events)).toEqual({
      terminal: false,
      removedIds: ["enemy"],
      teamRemovedIds: ["enemy"],
      captureSuccessIds: ["enemy"],
    });
  });

  it("routes a switch-out through the team removal listener but not the death pipeline", () => {


    const events: BattleEvent[] = [{ type: "switched", out: "benched", in: "joiner", team: 0 }];

    expect(turnOrderResolutionPlan(events)).toEqual({
      terminal: false,
      removedIds: [],
      teamRemovedIds: ["benched"],
      captureSuccessIds: [],
    });
  });

  it("keeps every leaver in resolution order when a switch and a death share one turn", () => {
    const events: BattleEvent[] = [
      { type: "switched", out: "benched", in: "joiner", team: 0 },
      { type: "died", living: "enemy" },
    ];

    const plan = turnOrderResolutionPlan(events);
    expect(plan.teamRemovedIds).toEqual(["benched", "enemy"]);
    expect(plan.removedIds).toEqual(["enemy"]);
  });

  it.each([
    ["capture victory", [
      { type: "captured", living: "enemy", source: "hero", cardLevel: 3 },
      { type: "battleEnded", winner: 0, time: 12 },
    ] satisfies BattleEvent[], ["enemy"]],
    ["lethal victory", [
      { type: "died", living: "enemy" },
      { type: "battleEnded", winner: 0, time: 12 },
    ] satisfies BattleEvent[], ["enemy"]],
    ["lethal defeat", [
      { type: "died", living: "hero" },
      { type: "battleEnded", winner: 1, time: 12 },
    ] satisfies BattleEvent[], ["hero"]],
    ["guaranteed escape", [
      { type: "escaped", living: "hero" },
    ] satisfies BattleEvent[], []],
  ])("suppresses the final updateOrder for %s", (_name, events, removedIds) => {
    expect(turnOrderResolutionPlan(events)).toMatchObject({
      terminal: true,
      removedIds,
    });
  });
});

describe("preAdvanceQueueProjection (the queue notifyTeam:addedMonster: reads)", () => {
  it("restores the acting living to the front the source had not yet charged", () => {


    expect(preAdvanceQueueProjection("fireCub", ["snowCub", "reserve", "fireCub"]))
      .toEqual(["fireCub", "snowCub", "reserve"]);
  });

  it("keeps every other living's relative order, since only the actor's time moved", () => {
    expect(preAdvanceQueueProjection("a", ["b", "c", "a", "d"])).toEqual(["a", "b", "c", "d"]);
  });

  it("passes the queue through when the actor left it (sacrifice, self-switch, own death)", () => {
    const post = ["b", "reserve", "c"];
    expect(preAdvanceQueueProjection("a", post)).toBe(post);
  });

  it("is the identity when the actor is still front (a zero-cost ability)", () => {
    expect(preAdvanceQueueProjection("a", ["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });
});
