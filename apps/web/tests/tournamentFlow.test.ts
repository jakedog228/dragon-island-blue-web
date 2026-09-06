import { describe, expect, it, vi } from "vitest";
import { TournamentFlow } from "../src/player/tournamentFlow.js";
import { PopupHost } from "../src/ui/popup.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

describe("TournamentFlow debug state", () => {
  it("keeps the active Tournament overlay while exposing its nested cooldown popup", () => {
    const popupState = {
      depth: 1,
      stack: [{
        visible: true,
        dismissed: false,
        contentLabel: null,
        buttons: ["Ok"],
      }],
    };
    vi.spyOn(PopupHost, "for").mockReturnValue({ debugState: popupState } as PopupHost);
    const progress = {
      index: 0,
      round: 0,
      status: 0,
      timeToNextTournament: vi.fn(() => 86_399),
    };
    const receiver = {
      opts: {
        profile: { tournament: progress },
        data: { tournament: vi.fn(() => ({ name: "K" })) },
        nowSeconds: () => 1_001,
      },
      closed: false,
      buttons: [{ action: "primary", enabled: true }],
      prizeList: undefined,
      now: () => 1_001,
    };
    const debugState = Object.getOwnPropertyDescriptor(
      TournamentFlow.prototype,
      "debugState",
    )?.get;
    expect(debugState).toBeDefined();

    expect(debugState!.call(receiver)).toMatchObject({
      kind: "tournament",
      open: true,
      round: 0,
      status: 0,
      timeToNext: 86_399,
      popups: popupState,
    });
    expect(progress.timeToNextTournament).toHaveBeenCalledWith(1_001);
  });

  it("presents the all-tournaments-finished plot inside the Tournament scene before exiting", async () => {
    const calls: string[] = [];
    const receiver = {
      finishedTournament: true,
      closed: false,
      opts: {
        onFinished: vi.fn((parent: unknown) => {
          expect(parent).toBe(receiver);
          calls.push("plot");
        }),
      },
      requestExit: vi.fn(async (reason: string) => {
        expect(reason).toBe("finished");
        calls.push("exit");
      }),
    };

    await TournamentFlow.prototype.presentFinishedPlotIfNeeded.call(receiver as never);

    expect(receiver.opts.onFinished).toHaveBeenCalledOnce();
    expect(receiver.requestExit).toHaveBeenCalledOnce();
    expect(calls).toEqual(["plot", "exit"]);
  });
});
