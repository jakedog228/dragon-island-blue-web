import { describe, expect, it } from "vitest";
import {
  mulberry32,
  replayableRng,
  restoreBattleReplay,
  type BattleEvent,
  type BattleReplaySnapshotV1,
} from "@dib/engine";
import { GameData, loadGameData, loadRawJson } from "@dib/gamedata";
import { resolveDataDir } from "../../../packages/gamedata/src/dataDir.js";
import earnedReincarnation from "./fixtures/earned-official-reincarnation-replay.json";
import {
  mountOfficialBattlePresentation,
  restoredAnalyzeEnabled,
  restoredRosterIdentities,
  restoredStatusCounts,
} from "../src/battle/officialBattlePresentation.js";

const data = loadGameData();

/** Dungeon 1 floor 4's fixed Resistance encounter, paired with the reported three-monster party. */
function resistanceOpeningReplay(): {
  readonly replay: BattleReplaySnapshotV1;
  readonly authority: ReturnType<typeof restoreBattleReplay>;
} {
  const uncommitted: BattleReplaySnapshotV1 = {
    schemaVersion: 1,
    teams: [
      [
        { shortType: "SnowCub", level: 5 },
        { shortType: "FireCub", level: 5 },
        { shortType: "Spark", level: 5 },
      ],
      [{
        shortType: "Resistance",
        level: 6,
        boss: true,
        flatStatBonuses: { MaxHP: 500, Speed: 100 },
      }],
    ],
    options: { fightingGroupSize: 3 },
    commands: [],
    randomDraws: [],
  };
  const source = mulberry32(0);
  const authority = restoreBattleReplay(data, uncommitted, { randomSource: () => source.next() });
  return {
    authority,
    replay: { ...uncommitted, randomDraws: authority.randomDraws! },
  };
}

describe("Official battle presentation mount", () => {
  it.each([undefined, true, false])("keeps fresh and reconnected Job levels identical (source rules %s)", sourceJobLevels => {
    const uncommitted: BattleReplaySnapshotV1 = { schemaVersion: 1,
      teams: [[{ shortType: "FireTiger", level: 150 }], [{ shortType: "Centurion", level: 151 }]],
      options: sourceJobLevels === undefined ? {} : { sourceJobLevels }, randomDraws: [], commands: [] };
    const random = mulberry32(777);
    const authority = restoreBattleReplay(data, uncommitted, { randomSource: () => random.next() });
    const replay = { ...uncommitted, randomDraws: authority.randomDraws! };
    for (const resume of [false, true]) {
      const mounted = mountOfficialBattlePresentation(data, replay, replayableRng(replay.randomDraws), resume);
      expect(mounted.session.levelOf("t1m0:Centurion")).toBe(sourceJobLevels ? 150 : 151);
    }
  });

  it("replays earned Reincarnation identically across archive and extracted dictionary order", () => {
    const reverseDictionaries = (value: unknown): unknown => Array.isArray(value)
      ? value.map(reverseDictionaries)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseDictionaries(child)]))
        : value;
    const directory = resolveDataDir();
    const reordered = GameData.fromRaw({
      monsters: reverseDictionaries(loadRawJson(directory, "Monsters.json")) as ReturnType<typeof loadRawJson>,
      jobs: loadRawJson(directory, "Jobs.json"),
      abilities: loadRawJson(directory, "Abilities.json"),
      abilityComponents: loadRawJson(directory, "AbilityComponents.json"),
      buffs: loadRawJson(directory, "Buffs.json"),
    });
    const replay = earnedReincarnation as unknown as BattleReplaySnapshotV1;
    const authority = restoreBattleReplay(data, replay);
    // This is the existing server candidate order: the fix must preserve its saved outcomes.
    const paths = data.allMonsters().filter(monster => monster.category === "Normal").map(monster => monster.path);
    expect(paths).toEqual([...paths].sort());
    expect(authority.events).toContainEqual(expect.objectContaining({
      type: "monsterAdded", shortType: "Sludge", team: 1,
    }));
    const tape = replayableRng(replay.randomDraws!);
    const mounted = mountOfficialBattlePresentation(reordered, replay, tape, true);
    expect(mounted.resumedStep).toEqual(authority.step);
    expect(mounted.historyEvents).toEqual(authority.events);
    expect(tape.cursor).toBe(replay.randomDraws!.length);

    // Also play from turn zero with only each committed prefix available, like the live browser.
    const prefix = (count: number) => {
      const tape = replayableRng(replay.randomDraws!);
      const restored = restoreBattleReplay(data, { ...replay, commands: replay.commands.slice(0, count) }, { replayRng: tape });
      return { restored, draws: replay.randomDraws!.slice(0, tape.cursor) };
    };
    const opening = prefix(0);
    const liveTape = replayableRng(opening.draws);
    const live = mountOfficialBattlePresentation(reordered,
      { ...replay, commands: [], randomDraws: opening.draws }, liveTape, false);
    const advance = () => {
      let step = live.session.advanceForPresentation();
      while (step.type === "awaitingEnemy") {
        live.session.submitEnemyAction();
        step = live.session.advanceForPresentation();
      }
      return step;
    };
    expect(advance()).toEqual(opening.restored.step);
    for (const [index, command] of replay.commands.entries()) {
      if (command.type !== "ability") throw new Error("earned fixture has an unexpected command");
      const expected = prefix(index + 1);
      liveTape.appendCommittedDraws(expected.draws.slice(liveTape.draws.length));
      live.session.submitPlayerAction(command.slot, [...command.targetIds]);
      expect(advance()).toEqual(expected.restored.step);
      expect(live.session.events).toEqual(expected.restored.events);
      expect(liveTape.cursor).toBe(expected.draws.length);
    }
  });

  it("presents the committed Resistance opening from turn zero instead of skipping to Spark", () => {
    const { replay, authority } = resistanceOpeningReplay();
    expect(authority.step).toMatchObject({ type: "awaitingPlayer", actorId: "t0m2:Spark" });
    expect(authority.events).toContainEqual(expect.objectContaining({
      type: "buffAdded",
      target: "t0m0:SnowCub",
      statusEffects: ["Sleep"],
    }));

    const mounted = mountOfficialBattlePresentation(
      data,
      replay,
      replayableRng(replay.randomDraws!),
      false,
    );
    expect(mounted.resumedStep).toBeUndefined();
    expect(mounted.historyEvents).toEqual([]);
    expect(mounted.session.events).toEqual([]);

    const presented: BattleEvent[] = [];
    const actors: { id: string; forced: boolean }[] = [];
    let step = mounted.session.advanceForPresentation();
    while (step.type === "awaitingEnemy") {
      actors.push({ id: step.actorId, forced: step.forcedLooseTurn });
      presented.push(...mounted.session.submitEnemyAction().events);
      step = mounted.session.advanceForPresentation();
    }

    expect(actors).toEqual([
      { id: "t1m0:Resistance", forced: false },
      { id: "t0m1:FireCub", forced: true },
      { id: "t0m0:SnowCub", forced: true },
    ]);
    expect(step).toMatchObject({ type: "awaitingPlayer", actorId: "t0m2:Spark" });
    expect(presented).toContainEqual(expect.objectContaining({
      type: "abilityUsed",
      source: "t1m0:Resistance",
      ability: "Offensive.Sleep.SleepAllTeams",
    }));
    expect(presented).toContainEqual(expect.objectContaining({
      type: "buffAdded",
      target: "t0m0:SnowCub",
      statusEffects: ["Sleep"],
    }));
    expect(mounted.session.statusEffectsOf("t0m0:SnowCub")).toContain("Sleep");
    expect(step).toEqual(authority.step);
  });

  it("fast-forwards reconnects but returns exact status history for UI hydration", () => {
    const { replay, authority } = resistanceOpeningReplay();
    const mounted = mountOfficialBattlePresentation(
      data,
      replay,
      replayableRng(replay.randomDraws!),
      true,
    );
    expect(mounted.resumedStep).toEqual(authority.step);
    expect(mounted.historyEvents).toEqual(authority.events);
    expect(restoredStatusCounts(mounted.historyEvents).get("t0m0:SnowCub")?.Sleep).toBe(1);
    expect(mounted.session.statusEffectsOf("t0m0:SnowCub")).toContain("Sleep");
  });

  it("folds stacks, dynamic identities, and Analyze's presentation latch", () => {
    const events = [
      { type: "buffAdded", target: "target", source: "source", buffType: "a", statusEffects: ["Sleep"], permanent: false },
      { type: "buffAdded", target: "target", source: "source", buffType: "b", statusEffects: ["Sleep"], permanent: false },
      { type: "buffRemoved", target: "target", buffType: "a", statusEffects: ["Sleep"], reason: "removed" },
      { type: "buffAdded", target: "target", source: "source", buffType: "Offensive.Poison", statusEffects: ["Poison"], permanent: false },
      { type: "buffAdded", target: "target", source: "source", buffType: "Offensive.Poison", statusEffects: ["Poison"], permanent: false },
      { type: "buffRemoved", target: "target", buffType: "Offensive.Poison", statusEffects: ["Poison"], reason: "expired" },
      { type: "monsterAdded", living: "new-monster", shortType: "FireCub", level: 7, team: 0, summoner: "source" },
      { type: "summonChanged", team: 0, removed: undefined, added: "new-summon", shortType: "SnowCub", level: 8, summoner: "source" },
      { type: "monsterAdded", living: "new-monster", shortType: "FireCub", level: 7, team: 0, summoner: "source" },
      { type: "abilityEvent", event: 0, arguments: null },
    ] satisfies BattleEvent[];

    expect(restoredStatusCounts(events).get("target")).toEqual({
      Sleep: 1,
      Paralyze: 0,
      Poison: 1,
      Confuse: 0,
    });
    expect(restoredRosterIdentities(events)).toEqual([
      { id: "new-monster", team: 0, shortType: "FireCub", level: 7 },
      { id: "new-summon", team: 0, shortType: "SnowCub", level: 8 },
    ]);
    expect(restoredAnalyzeEnabled(events)).toBe(true);
  });

  it("rejects a fresh mount whose replay already contains player history", () => {
    const { replay, authority } = resistanceOpeningReplay();
    if (authority.step.type !== "awaitingPlayer") throw new Error("fixture did not reach player");
    const withHistory: BattleReplaySnapshotV1 = {
      ...replay,
      commands: [{ type: "delay", actorId: authority.step.actorId }],
    };
    expect(() => mountOfficialBattlePresentation(
      data,
      withHistory,
      replayableRng(replay.randomDraws!),
      false,
    )).toThrow(/historical player commands/);
  });
});
