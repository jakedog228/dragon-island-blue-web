import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";
import {
  TOURNAMENT_COOLDOWN_SECONDS,
  TournamentProgress,
  buildTournamentEncounter,
  generateTournamentPrize,
} from "../src/tournament.js";
import { mulberry32 } from "../src/rng.js";

const data = loadGameData();

describe("Tournament source state and authored encounters", () => {
  it("loads the twelve ordered classes and each four-round encounter", () => {
    expect(data.allTournaments().map(({ name }) => name))
      .toEqual(["K", "J", "I", "H", "G", "F", "E", "D", "C", "B", "A", "S"]);
    for (const tournament of data.allTournaments()) {
      for (let round = 0; round < 4; round += 1) {
        const built = buildTournamentEncounter(tournament, round, mulberry32(round + 1));
        expect(built.encounter.monsters.length).toBeGreaterThan(0);
        expect(built.encounter.challengeLevel).toBe(tournament.challengeLevel);
        expect(built.startChatKey).toBeTruthy();
      }
    }
  });

  it("enforces the daily attempt clock and four-victory prize transition", () => {
    const progress = new TournamentProgress();
    expect(progress.beginBattle(1_000)).toBe(0);
    progress.settleBattle("victory");
    expect(progress.stateSnapshot()).toMatchObject({ index: 0, round: 1, status: 1 });
    expect(progress.beginBattle(1_000 + 60)).toBe(TOURNAMENT_COOLDOWN_SECONDS - 60);
    for (let round = 1; round < 4; round += 1) {
      expect(progress.beginBattle(1_000 + round * TOURNAMENT_COOLDOWN_SECONDS)).toBe(0);
      progress.settleBattle("victory");
    }
    expect(progress.stateSnapshot()).toMatchObject({ index: 0, round: 4, status: 2 });
    expect(progress.claimPrize()).toBe(1);
    expect(progress.stateSnapshot()).toMatchObject({ index: 1, round: 0, status: 0 });
  });

  it("resets the round on loss without clearing the attempt clock", () => {
    const progress = new TournamentProgress();
    progress.beginBattle(10);
    progress.settleBattle("victory");
    progress.settleBattle("defeat");
    expect(progress.stateSnapshot()).toMatchObject({ round: 0, status: 0, timeLast: 10 });
    expect(progress.beginBattle(11)).toBe(TOURNAMENT_COOLDOWN_SECONDS - 1);
  });

  it("preserves the complete snapshot, including timeLast, on Escape retreat", () => {
    const progress = new TournamentProgress({
      schemaVersion: 1,
      index: 3,
      round: 2,
      status: 1,
      timeLast: 1_234,
    });
    const before = progress.stateSnapshot();
    progress.settleBattle("retreat");
    expect(progress.stateSnapshot()).toEqual(before);
    expect(progress.timeToNextTournament(1_235)).toBe(TOURNAMENT_COOLDOWN_SECONDS - 1);
  });

  it("generates the first class's authored fixed prize", () => {
    expect(generateTournamentPrize(data.allTournaments()[0]!, mulberry32(1))).toEqual([
      { kind: "monsterJoin", shortType: "UnhappyBird", jobLevel: 8 },
    ]);
  });

  it("spends the populator's chanceToAppear draw before any reward draw", () => {


    const source = mulberry32(7);
    const chances: number[] = [];
    let draws = 0;
    const recording = {
      next: () => { draws += 1; return source.next(); },
      intBelow: (n: number) => { draws += 1; return source.intBelow(n); },
      chance: (p: number) => { chances.push(p); draws += 1; return source.chance(p); },
    };

    buildTournamentEncounter(data.allTournaments()[0]!, 0, recording);
    // First roll is the encounter's own authored chanceToAppear of 1; the treasure roll follows.
    expect(chances[0]).toBe(1);
    expect(draws).toBeGreaterThan(1);
    // Same tape without the leading roll would have handed the treasure a different number.
    expect(mulberry32(7).next()).not.toBe(source.next());
  });
});
