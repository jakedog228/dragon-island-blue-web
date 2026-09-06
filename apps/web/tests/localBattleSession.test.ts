import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import { mulberry32, type BattleEvent, type TeamMemberSetup } from "@dib/engine";
import { PlayerProfile } from "../src/player/playerProfile.js";
import {
  createLocalBattleSession,
  mirrorLocalCapturePurchaseToBattleWallet,
  settleLocalBattleWalletEvents,
} from "../src/battle/localBattleSession.js";

const gd = loadGameData();

function profile(silver: number): PlayerProfile {
  return new PlayerProfile({
    heroLevel: 12,
    monsterPartyLevels: [12],
    silver,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
  });
}

describe("local battle wallet settlement", () => {
  it("seeds the BattleSession from the durable profile wallet", () => {
    const p = profile(500);
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Abomination", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];

    const session = createLocalBattleSession(gd, teams, mulberry32(1), p);

    expect(session.silver).toBe(500);
    expect(p.snapshot().silver).toBe(500);
  });

  it("carries an encounter-wide capture ban into the local engine session", () => {
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Abomination", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = createLocalBattleSession(
      gd,
      teams,
      mulberry32(1),
      profile(500),
      { blockCapture: true },
    );

    expect(session.captureStatusOf(session.targetableIdsOf(1)[0]!)).toBe("uncapturable");
  });

  it("settles a real Money Slap debit into PlayerProfile exactly once", () => {
    const p = profile(500);
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Abomination", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = createLocalBattleSession(gd, teams, mulberry32(42), p);

    let step = session.advance();
    while (step.type === "enemyTurnResolved") step = session.advance();
    if (step.type !== "awaitingPlayer") throw new Error(`expected player turn, got ${step.type}`);
    const moneySlap = step.choices.find((choice) => choice.slot === "usable1");
    if (!moneySlap) throw new Error("Abomination has no Money Slap choice");
    const events = session.submitPlayerAction(moneySlap.slot, [session.targetableIdsOf(1)[0]!]);

    expect(events).toContainEqual(expect.objectContaining({ type: "silverSpent", amount: 120, remaining: 380 }));
    expect(p.snapshot().silver).toBe(500);
    settleLocalBattleWalletEvents(p, events);
    expect(p.snapshot().silver).toBe(380);
    expect(() => settleLocalBattleWalletEvents(p, events)).toThrow("Local battle silver mirror diverged");
    expect(p.snapshot().silver).toBe(380);
  });

  it("keeps a silver capture-card purchase and a later Money Slap on one wallet", () => {
    const p = profile(500);
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Abomination", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = createLocalBattleSession(gd, teams, mulberry32(42), p);

    const purchase = p.spendCaptureCard(2);
    expect(purchase).toEqual({
      ok: true,
      source: "purchased",
      cost: { currency: "silver", amount: 250 },
    });
    mirrorLocalCapturePurchaseToBattleWallet(session, purchase);
    expect(session.silver).toBe(250);

    let step = session.advance();
    while (step.type === "enemyTurnResolved") step = session.advance();
    if (step.type !== "awaitingPlayer") throw new Error(`expected player turn, got ${step.type}`);
    const events = session.submitPlayerAction("usable1", [session.targetableIdsOf(1)[0]!]);
    expect(events).toContainEqual(expect.objectContaining({ type: "silverSpent", amount: 120, remaining: 130 }));

    settleLocalBattleWalletEvents(p, events);
    expect(p.snapshot().silver).toBe(130);
  });

  it("leaves an unaffordable local wallet unchanged", () => {
    const p = profile(100);
    const teams: [TeamMemberSetup[], TeamMemberSetup[]] = [
      [{ shortType: "Abomination", level: 12 }],
      [{ shortType: "FireCub", level: 10 }],
    ];
    const session = createLocalBattleSession(gd, teams, mulberry32(42), p);

    let step = session.advance();
    while (step.type === "enemyTurnResolved") step = session.advance();
    if (step.type !== "awaitingPlayer") throw new Error(`expected player turn, got ${step.type}`);
    const events = session.submitPlayerAction("usable1", [session.targetableIdsOf(1)[0]!]);

    expect(events.some((event) => event.type === "silverSpent")).toBe(false);
    settleLocalBattleWalletEvents(p, events);
    expect(session.silver).toBe(100);
    expect(p.snapshot().silver).toBe(100);
  });

  it("fails loudly if the session wallet and durable profile diverge", () => {
    const p = profile(100);
    const impossible: BattleEvent[] = [
      { type: "silverSpent", source: "team1:0:Abomination", amount: 120, remaining: 0 },
    ];

    expect(() => settleLocalBattleWalletEvents(p, impossible)).toThrow("Local battle silver mirror diverged");
    expect(p.snapshot().silver).toBe(100);
  });

  it("settles an enemy Abomination's Money Slap against the same global profile wallet", () => {
    let resolvedEvents: BattleEvent[] | undefined;
    let resolvedSessionSilver: number | undefined;

    for (let seed = 0; seed < 100 && resolvedEvents === undefined; seed += 1) {
      const p = profile(500);
      const session = createLocalBattleSession(
        gd,
        [[{ shortType: "FireCub", level: 150 }], [{ shortType: "Abomination", level: 12 }]],
        mulberry32(seed),
        p,
      );
      for (let turn = 0; turn < 24; turn += 1) {
        const step = session.advanceForPresentation();
        if (step.type === "ended") break;
        if (step.type === "awaitingPlayer") {
          session.submitDelayAction();
          continue;
        }
        const resolved = session.submitEnemyAction();
        if (resolved.events.some((event) => event.type === "silverSpent")) {
          resolvedEvents = resolved.events;
          resolvedSessionSilver = session.silver;
          settleLocalBattleWalletEvents(p, resolved.events);
          expect(p.snapshot().silver).toBe(380);
          break;
        }
      }
    }

    expect(resolvedEvents).toContainEqual(
      expect.objectContaining({ type: "silverSpent", source: expect.stringContaining("t1m"), amount: 120, remaining: 380 }),
    );
    expect(resolvedSessionSilver).toBe(380);
  });
});
