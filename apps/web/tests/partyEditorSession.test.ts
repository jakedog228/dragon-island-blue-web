import { describe, expect, it } from "vitest";
import { PartyEditorSession } from "../src/world/partyEditorSession.js";

describe("PartyEditorSession", () => {
  it("keeps nullable batting holes transient and compacts only at the commit boundary", () => {
    const session = new PartyEditorSession(5, ["a", "b", "c"], ["d", "e"]);
    expect(session.moveBattingToReserve(1, 0)).toBe(true);
    expect(session.battingSlotIds()).toEqual(["a", undefined, "c", undefined, undefined]);
    expect(session.reserveOrderIds()).toEqual(["b", "d", "e"]);
    expect(session.compactActiveIds()).toEqual(["a", "c"]);
  });

  it("fills an empty target directly and shifts an occupied target toward the first hole", () => {
    const direct = new PartyEditorSession(5, ["a", "b", "c"], ["x"]);
    expect(direct.moveReserveToBatting(0, 3)).toBe(true);
    expect(direct.battingSlotIds()).toEqual(["a", "b", "c", "x", undefined]);

    const shifted = new PartyEditorSession(5, ["a", "b", "c"], ["x"]);
    expect(shifted.moveReserveToBatting(0, 1)).toBe(true);
    expect(shifted.battingSlotIds()).toEqual(["a", "x", "b", "c", undefined]);
  });

  it("moves occupied cards through holes while nil and boundary arrows remain inert", () => {
    const session = new PartyEditorSession(5, ["a", "b", "c"], []);
    session.moveBattingToReserve(1, 0);
    expect(session.canMoveBatting(0, -1)).toBe(false);
    expect(session.canMoveBatting(1, 1)).toBe(false);
    expect(session.canMoveBatting(2, -1)).toBe(true);
    expect(session.moveBatting(2, -1)).toBe(1);
    expect(session.battingSlotIds()).toEqual(["a", "c", undefined, undefined, undefined]);
  });

  it("uses the reserve visual index directly as the insertion boundary", () => {
    const beforeFirst = new PartyEditorSession(3, ["a", "b"], ["c", "d"]);
    beforeFirst.moveBattingToReserve(1, 0);
    expect(beforeFirst.reserveOrderIds()).toEqual(["b", "c", "d"]);
    expect(beforeFirst.selectedReserveIndex()).toBe(0);

    const afterFirst = new PartyEditorSession(3, ["a", "b"], ["c", "d"]);
    afterFirst.moveBattingToReserve(1, 1);
    expect(afterFirst.reserveOrderIds()).toEqual(["c", "b", "d"]);
    // Reserve CFlow is [nil, c, b, d]. Source restores selectedIndex=1, leaving c centered and
    // the newly removed b one visible slot to its right rather than recentering on b.
    expect(afterFirst.selectedReserveIndex()).toBe(1);
  });

  it("remove-all appends occupied slots then reapplies the local sort only", () => {
    const session = new PartyEditorSession(4, ["a", "b"], ["c"]);
    const rank = new Map([["a", 2], ["b", 1], ["c", 3]]);
    expect(session.removeAll((left, right) => rank.get(left)! - rank.get(right)!)).toBe(true);
    expect(session.battingSlotIds()).toEqual([undefined, undefined, undefined, undefined]);
    expect(session.reserveOrderIds()).toEqual(["b", "a", "c"]);
    expect(session.removeAll(() => 0)).toBe(false);
  });

  it("removes permanent-transaction IDs without compacting unrelated slots", () => {
    const session = new PartyEditorSession(5, ["a", "b", "c"], ["d"]);
    session.moveBattingToReserve(1, 0);
    session.removeMonster("c");
    expect(session.battingSlotIds()).toEqual(["a", undefined, undefined, undefined, undefined]);
    expect(session.reserveOrderIds()).toEqual(["b", "d"]);
  });
});
