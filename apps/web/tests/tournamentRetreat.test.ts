import { describe, expect, it } from "vitest";
import {
  runOfficialTournamentSaveMeReconnect,
  runTournamentRetreatReturn,
} from "../src/player/tournamentRetreat.js";

describe("Tournament return reconciliation (Escape and Save Me)", () => {
  it("orders Official adoption, retained events, TournamentLost chat, and town rebuild for Escape", async () => {
    const calls: string[] = [];
    await runTournamentRetreatReturn({
      authoritative: true,
      adoptOfficialProjection: () => calls.push("adopt"),
      presentRetainedOfficialQuestEvents: () => calls.push("events"),
      showTournamentLostChat: async () => { calls.push("chat"); },
      startWorld: async () => { calls.push("world"); },
    });
    expect(calls).toEqual(["adopt", "events", "chat", "world"]);
  });

  it.each(["official-game-v20", "official-game-v21", "official-game-v22", "official-game-v23", "official-game-v24", "official-game-v25"])(
    "selects and orders the Official %s Tournament reconnect return",
    async (simulationVersion) => {
    const calls: string[] = [];
    const handled = await runOfficialTournamentSaveMeReconnect({
      simulationVersion,
      battle: { scene: { kind: "tournament" } },
      teardownCombatMonsters: () => calls.push("teardown"),
      adoptOfficialProjection: () => calls.push("adopt"),
      presentRetainedOfficialQuestEvents: () => calls.push("events"),
      showTournamentLostChat: async () => { calls.push("chat"); },
      startWorld: async () => { calls.push("world"); },
    });
    expect(handled).toBe(true);
    expect(calls).toEqual(["teardown", "adopt", "events", "chat", "world"]);
    },
  );

  it.each([
    ["official-game-v19", "tournament"],
    ["official-game-v20", "world"],
    ["official-game-v21", "world"],
    ["official-game-v22", "world"],
  ])("leaves historical or non-Tournament reconnects to their existing host (%s, %s)", async (
    simulationVersion,
    kind,
  ) => {
    const calls: string[] = [];
    const handled = await runOfficialTournamentSaveMeReconnect({
      simulationVersion,
      battle: { scene: { kind } },
      teardownCombatMonsters: () => calls.push("teardown"),
      adoptOfficialProjection: () => calls.push("adopt"),
      presentRetainedOfficialQuestEvents: () => calls.push("events"),
      showTournamentLostChat: async () => { calls.push("chat"); },
      startWorld: async () => { calls.push("world"); },
    });
    expect(handled).toBe(false);
    expect(calls).toEqual([]);
  });

  it("keeps local Escape/Save Me free of Official adoption while retaining chat-before-town order", async () => {
    const calls: string[] = [];
    await runTournamentRetreatReturn({
      authoritative: false,
      adoptOfficialProjection: () => calls.push("adopt"),
      presentRetainedOfficialQuestEvents: () => calls.push("events"),
      showTournamentLostChat: async () => { calls.push("chat"); },
      startWorld: async () => { calls.push("world"); },
    });
    expect(calls).toEqual(["chat", "world"]);
  });
});
