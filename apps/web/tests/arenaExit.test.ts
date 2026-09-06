import { describe, expect, it } from "vitest";
import { arenaExitDisposition } from "../src/player/arenaExit.js";

describe("ArenaEncounter terminal dispatch", () => {
  it("keeps state-6 Escape distinct from both Arena loss and Tournament retreat", () => {
    expect(arenaExitDisposition("victory")).toBe("victory");
    expect(arenaExitDisposition("defeat")).toBe("defeat");
    expect(arenaExitDisposition("retreat")).toBe("sourceEscapeStall");
  });

  it("retains ArenaEncounter's source Save Me block", () => {
    expect(() => arenaExitDisposition("saveMe")).toThrow(/block Save Me/i);
  });
});
