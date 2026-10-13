import { describe, expect, it } from "vitest";
import { PvpInviteRequestV1Schema, PvpCommandV1Schema, PvpRosterMemberV1Schema, PvpMatchViewV1Schema, PvpAdapterIntentV1Schema } from "../src/pvp.js";

const logicPackId = `logic-v1:${"a".repeat(64)}`;
const request = { requestId: "11111111-1111-4111-8111-111111111111", setup: { logicPackId, mods: [] }, entry: { source: "official", slotId: "slot-1" } };
describe("PvP wire boundaries", () => {
  it("Official entries admit only a slot reference, never an authored party or outcome", () => {
    expect(PvpInviteRequestV1Schema.parse(request)).toEqual(request);
    expect(PvpInviteRequestV1Schema.safeParse({ ...request, entry: { ...request.entry, party: [{ shortType: "FireCub", level: 999 }] } }).success).toBe(false);
    expect(PvpInviteRequestV1Schema.safeParse({ ...request, winner: 0 }).success).toBe(false);
  });
  it.each(["randomDraws", "damage", "reward", "timestamp", "seed"])("commands refuse player-authored %s", (field) => {
    const command = { commandId: request.requestId, expectedRevision: 2, decisionId: "pvp-decision", action: { type: "delay", actorId: "t0m0:FireCub" } };
    expect(PvpCommandV1Schema.safeParse({ ...command, [field]: 1 }).success).toBe(false);
  });
  it("requires the rules identity in a match response and rejects presentation resource fields", () => {
    const view = { protocolVersion: "pvp-protocol-v1", matchId: request.requestId, revision: 0, status: "waiting", you: 0,
      players: [{ name: "Host", source: "offline" }], expiresAt: 1000, notes: [] };
    expect(PvpMatchViewV1Schema.safeParse(view).success).toBe(false);
    expect(PvpMatchViewV1Schema.safeParse({ ...view, logicPackId }).success).toBe(true);
    expect(PvpMatchViewV1Schema.safeParse({ ...view, logicPackId, backgroundKey: "ArenaCombat" }).success).toBe(false);
  });
  it("accepts an older equipped stone without inventing its optional source species", () => {
    const member = { shortType: "FireCub", level: 5, soulStone: { element: "Fire", level: 4 } };
    expect(PvpRosterMemberV1Schema.parse(member)).toEqual(member);
    expect(PvpRosterMemberV1Schema.safeParse({ ...member, currentHp: 1 }).success).toBe(false);
    expect(PvpRosterMemberV1Schema.safeParse({ ...member, sourceInstanceId: "private-campaign-id" }).success).toBe(false);
  });
});


describe("bounded PvP adapter intent", () => {
  it("admits semantic scalar/array input but rejects snapshots, nested state and unbounded payloads", () => {
    expect(PvpAdapterIntentV1Schema.parse({ target: "t1m0:FireCub", samples: [0, 0.5, 1], pressed: true })).toBeDefined();
    for (const input of [{ state: { hp: 999 } }, { path: Array(129).fill(0) }, { value: Infinity },
      { target: "x".repeat(161) }, Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`x${i}`, 1]))]) {
      expect(PvpAdapterIntentV1Schema.safeParse(input).success).toBe(false);
    }
  });
});
