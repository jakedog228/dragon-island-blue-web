import { describe, expect, it, vi } from "vitest";
import { localGuildQuestEventOption } from "../src/authority/questAuthorityBoundary.js";

describe("Guild quest authority boundary", () => {
  it("installs the local BattleNode mutation callback only for offline simulation", () => {
    const dispatch = vi.fn();
    expect(localGuildQuestEventOption(false, dispatch)).toEqual({
      onQuestEvent: dispatch,
    });
    expect(localGuildQuestEventOption(true, dispatch)).toEqual({});
  });
});
