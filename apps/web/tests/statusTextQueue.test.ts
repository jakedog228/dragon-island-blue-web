import { describe, it, expect } from "vitest";
import type { BattleEvent } from "@dib/engine";
import { StatusTextBuffer, formatEventLines } from "../src/battle/statusTextQueue.js";


describe("StatusTextBuffer — sub_66aa8 append semantics", () => {
  it("starts empty (hasText false, combined null)", () => {
    const b = new StatusTextBuffer();
    expect(b.hasText).toBe(false);
    expect(b.combined).toBeNull();
  });

  it("the first append gets NO leading separator (appendString: path, 0x66af6)", () => {
    const b = new StatusTextBuffer();
    b.append("L1");
    expect(b.combined).toBe("L1");
  });

  it("subsequent appends prepend a newline (appendFormat:@\"\\n%@\", 0x66ad6)", () => {
    const b = new StatusTextBuffer();
    b.append("L1");
    b.append("L2");
    expect(b.combined).toBe("L1\nL2");
  });

  it("an empty line is a hard no-op — dst is untouched (cmp r0,#0; it eq; pop @ 0x66ac4)", () => {
    const b = new StatusTextBuffer();
    b.append("");
    expect(b.hasText).toBe(false);
    b.append("L1");
    b.append(""); // must NOT append a bare separator
    expect(b.combined).toBe("L1");
  });

  it("clear() empties the buffer (clearStatusText @ 0xb0974)", () => {
    const b = new StatusTextBuffer();
    b.append("L1");
    b.clear();
    expect(b.hasText).toBe(false);
    expect(b.combined).toBeNull();
  });
});

describe("StatusTextBuffer — rolling-window cap (0xb0844 cmp #5 / 0xb089c subs #4)", () => {
  const after = (n: number): string => {
    const b = new StatusTextBuffer();
    for (let i = 1; i <= n; i++) b.append(`L${i}`);
    return b.combined ?? "";
  };

  it("does not fire below 5 split components", () => {
    expect(after(4)).toBe("L1\nL2\nL3\nL4");
  });

  it("fires at N=5: drops L1, keeps 4 components, and leaves a TRAILING newline", () => {


    expect(after(5)).toBe("L2\nL3\nL4\nL5\n");
  });

  it("N=6: the trailing newline collides with the next prepended one, burning a slot on an empty component", () => {
    // pre-cap: "L2\nL3\nL4\nL5\n" + "\n" + "L6" -> split ["L2","L3","L4","L5","","L6"]
    // kept [2..5] = ["L4","L5","","L6"] -> only THREE real lines survive, not four.
    expect(after(6)).toBe("L4\nL5\n\nL6\n");
  });

  it("N=7: degrades to two real lines", () => {
    expect(after(7)).toBe("\nL6\n\nL7\n");
  });

  it("N>=7 is a steady state of exactly two real lines, shifting by one per append", () => {
    expect(after(8)).toBe("\nL7\n\nL8\n");
    expect(after(9)).toBe("\nL8\n\nL9\n");
    expect(after(20)).toBe("\nL19\n\nL20\n");
  });

  it("real (non-empty) line count peaks at 4 exactly once, then decays to a permanent 2", () => {
    const realLines = (n: number) => after(n).split("\n").filter((s) => s.length > 0).length;
    expect([4, 5, 6, 7, 8, 9, 12].map(realLines)).toEqual([4, 4, 3, 2, 2, 2, 2]);
  });

  it("the most recent line is always retained, however far the window has decayed", () => {
    for (const n of [1, 4, 5, 6, 7, 12, 30]) {
      expect(after(n).split("\n")).toContain(`L${n}`);
    }
  });

  it("autoAdvanceAfter is exactly 5.0 seconds (setWaitLimit: 0x40a00000)", () => {
    expect(new StatusTextBuffer().autoAdvanceAfter).toBe(5.0);
  });
});

describe("formatEventLines (moved verbatim from BattleScreen.logEvents, wording unchanged)", () => {
  const nameOf = (id: string) => id.split(":").at(-1) ?? id;

  it("abilityUsed with targets: '<source> → <ability leaf> @ <targets>'", () => {
    const events: BattleEvent[] = [
      { type: "abilityUsed", source: "t0m0:FireCub", ability: "Fire.Ember", targets: ["t1m0:Minotaur"] },
    ];
    expect(formatEventLines(events, nameOf)).toEqual(["FireCub → Ember @ Minotaur"]);
  });

  it("abilityUsed with multiple targets joins them with ', '", () => {
    const events: BattleEvent[] = [
      {
        type: "abilityUsed",
        source: "t0m0:FireCub",
        ability: "Fire.Ember",
        targets: ["t1m0:Minotaur", "t1m1:Spark"],
      },
    ];
    expect(formatEventLines(events, nameOf)).toEqual(["FireCub → Ember @ Minotaur, Spark"]);
  });

  it("abilityUsed with no targets (self-only) omits the ' @ ...' suffix entirely", () => {
    const events: BattleEvent[] = [
      { type: "abilityUsed", source: "t0m0:FireCub", ability: "Utility.Delay", targets: [] },
    ];
    expect(formatEventLines(events, nameOf)).toEqual(["FireCub → Delay"]);
  });

  it("died: '<name> fainted'", () => {
    const events: BattleEvent[] = [{ type: "died", living: "t1m0:Minotaur" }];
    expect(formatEventLines(events, nameOf)).toEqual(["Minotaur fainted"]);
  });

  it("battleEnded winner 0 -> 'Victory!', otherwise 'Defeat…'", () => {
    expect(formatEventLines([{ type: "battleEnded", winner: 0, time: 12 }], nameOf)).toEqual(["Victory!"]);
    expect(formatEventLines([{ type: "battleEnded", winner: 1, time: 12 }], nameOf)).toEqual(["Defeat…"]);
    expect(formatEventLines([{ type: "battleEnded", winner: "draw", time: 12 }], nameOf)).toEqual(["Defeat…"]);
  });

  it("unformatted event types (turnStarted, battleStarted, damageDealt, healed) produce no lines", () => {
    const events: BattleEvent[] = [
      { type: "battleStarted", teams: [["a"], ["b"]] },
      { type: "turnStarted", living: "a", time: 0 },
      { type: "damageDealt", source: "a", target: "b", amount: 5, element: "Fire", hpAfter: 10 },
      { type: "healed", source: "a", target: "a", amount: 3, hpAfter: 20 },
    ];
    expect(formatEventLines(events, nameOf)).toEqual([]);
  });

  it("multiple events in one call produce one line per formatted event, in order", () => {
    const events: BattleEvent[] = [
      { type: "abilityUsed", source: "t0m0:FireCub", ability: "Fire.Ember", targets: ["t1m0:Minotaur"] },
      { type: "died", living: "t1m0:Minotaur" },
      { type: "battleEnded", winner: 0, time: 12 },
    ];
    expect(formatEventLines(events, nameOf)).toEqual(["FireCub → Ember @ Minotaur", "Minotaur fainted", "Victory!"]);
  });
});
