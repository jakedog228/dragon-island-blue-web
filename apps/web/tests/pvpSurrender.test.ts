import { describe, expect, it, vi } from "vitest";
import { BattleNode } from "../src/battle/battleNode.js";
import { PvpBattleView } from "../src/pvp/pvpBattleView.js";
import { createPvpBattle } from "@dib/engine";
import { loadGameData } from "@dib/gamedata";

vi.hoisted(() => Object.defineProperty(globalThis, "navigator", { configurable: true, value: { userAgent: "vitest" } }));

describe("native PvP surrender", () => {
  it.each(["defeat", "forfeit", "timeout", "turn-limit"])("keeps native victory animation ownership but settles external endings immediately: %s", endReason => {
    const match = { matchId: "same-match", status: "ended", endReason };
    const receiver = { match, playback: { inputBlocked: false, update: vi.fn() }, ended: vi.fn() };
    PvpBattleView.prototype.update.call(receiver as never, match as never, false);
    expect(receiver.playback.update).toHaveBeenCalledWith(match);
    expect(receiver.ended).toHaveBeenCalledTimes(endReason === "defeat" ? 0 : 1);
  });
  it("exposes the current actor to the native demo driver after turns change", () => {
    const gd = loadGameData();
    const { restored } = createPvpBattle(gd, [[{ shortType: "FireCub", level: 5 }], [{ shortType: "SnowCub", level: 5 }]], () => 0.5);
    const receiver = { game: { gd }, playback: { restored }, battle: { renderGameState: () => ({
      activeActorId: "t1m0:SnowCub", presentation: { state: "awaitingPlayerChoice" },
    }) } };
    const current = Object.getOwnPropertyDescriptor(PvpBattleView.prototype, "restored")!.get!.call(receiver);
    expect(current.decision).toMatchObject({ type: "turn", team: 1, actorId: "t1m0:SnowCub" });
    expect(current.decision.choices.length).toBeGreaterThan(0);
    expect(restored.decision).toMatchObject({ actorId: "t0m0:FireCub" });
  });
  it.each(["awaitingPlayerChoice", "awaitingOpponent"])("requires native confirmation at either player's decision: %s", presentationState => {
    const forfeit = vi.fn(), confirm = vi.fn();
    const receiver = { multiplayer: { busy: false, forfeit }, lifecycle: { disposed: false }, built: true,
      presentationState, showSecondaryConfirmation: confirm };
    BattleNode.prototype.requestMultiplayerForfeit.call(receiver as never);
    expect(confirm).toHaveBeenCalledWith("ConfirmRetreat", "confirmRetreat", expect.any(Function));
    expect(forfeit).not.toHaveBeenCalled();
    confirm.mock.calls[0]![2](); expect(forfeit).toHaveBeenCalledOnce();
  });
  it("does not open surrender during commitment, animations, teardown or campaign combat", () => {
    const confirm = vi.fn();
    const base = { multiplayer: { busy: false, forfeit: vi.fn() }, lifecycle: { disposed: false }, built: true,
      presentationState: "awaitingPlayerChoice", showSecondaryConfirmation: confirm };
    for (const change of [{ multiplayer: undefined }, { multiplayer: { busy: true } }, { lifecycle: { disposed: true } },
      { built: false }, { presentationState: "battleEnded" }, { presentationState: "retreatConfirmation" }, { presentationState: "impact" }]) {
      BattleNode.prototype.requestMultiplayerForfeit.call({ ...base, ...change } as never);
    }
    expect(confirm).not.toHaveBeenCalled();
  });
});
