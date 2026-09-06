import { describe, expect, it, vi } from "vitest";
import type { DungeonDefinition } from "@dib/gamedata/browser";
import type { DungeonEncounter } from "@dib/engine/dungeon";
import { dungeonTerminalFlowIdentity } from "@dib/engine/dungeon-runtime";
import type { SlotProjectionV1 } from "@dib/game-protocol";
import {
  battleMusicRole,
  battlePortraitFrame,
  battleSpriteKey,
} from "../src/battle/encounter.js";
import type { DefeatRecoveryAdapter } from "../src/battle/battleNode.js";
import {
  DUNGEON_RESERVED_DIAGNOSTIC_CODES,
  DUNGEON_RUNTIME_DIAGNOSTIC_CODES,
  FOREST_TREE_ALL_VALUES_ORDER_CODE,
  FOREST_TREE_ALL_VALUES_ORDER_DIAGNOSTIC,
} from "../src/dungeon/dungeonDiagnostics.js";
import {
  buildDungeonBattle,
  createDungeonBattleLifecycleDiagnosticReporter,
  dungeonBattleLifecycleDiagnostics,
  allocateDungeonTerminalFlow,
  adoptOfficialDungeonTerminalProjection,
  officialDungeonBattleReturnActions,
  resolveDungeonBattleTerminal,
  terminalDungeonCheckpointOverride,
  terminalDungeonMonsterRoster,
  withDungeonRoomRosterLoss,
} from "../src/dungeon/dungeonBattle.js";

const definition = (instanceName = "NorthCave") => ({
  instanceName,
  presentation: {
    combatBackgroundFile: "CaveCombat.png",
  } as Pick<DungeonDefinition, "presentation">["presentation"],
});

function fixed(): DungeonEncounter {
  return {
    id: "fixed:1", kind: "fixed", completionKey: "boss-1", questKey: "DefeatBoss",
    monsters: [{ type: "BlackDragon", level: 12, extraLivingArguments: {
      boss: true, displayName: "Fafnir", rendererData: { class: "CCSprite", spriteFile: "BlackDragon.png" },
    } }],
    breeder: {
      type: "Normal",
      arguments: { stats: { Attack: 0, Defense: -10, MaxHP: 500, Speed: 25 }, xpBonus: 3 },
    },
  };
}

describe("dungeon battle boundary", () => {
  it("separates shipped/runtime diagnostics from future-package vocabulary", () => {
    const runtime = new Set<string>(DUNGEON_RUNTIME_DIAGNOSTIC_CODES);
    expect(DUNGEON_RESERVED_DIAGNOSTIC_CODES.every((code) => !runtime.has(code))).toBe(true);
    expect(DUNGEON_RUNTIME_DIAGNOSTIC_CODES).toEqual([
      "unsupported-breeder-type",
      "unsupported-breeder-argument",
      "unsupported-breeder-stat",
      "unsupported-living-argument",
      "opaque-start-event",
      "opaque-win-event",
      "opaque-achievement",
      "leaderboard-platform-hook-unavailable",
      "save-me-disabled",
      "zone-room-choice-tie-order",
      "forest-tree-allValues-order",
    ]);
    // Retired once the Abyss unlock branch got its source vectors and tests: the port now runs the
    // threshold write instead of announcing that it could not.
    expect(DUNGEON_RUNTIME_DIAGNOSTIC_CODES).not.toContain("volcano-infinite-unlock-unverified");
    expect(DUNGEON_RUNTIME_DIAGNOSTIC_CODES).not.toContain("music-transition-timing");
    expect(DUNGEON_RESERVED_DIAGNOSTIC_CODES).toEqual(["opaque-battle-reward"]);
    expect(FOREST_TREE_ALL_VALUES_ORDER_CODE).toBe("forest-tree-allValues-order");
    expect(FOREST_TREE_ALL_VALUES_ORDER_DIAGNOSTIC).toBe(
      "UNVERIFIED: forest-tree-allValues-order",
    );
  });

  it("does not allocate a local terminal identity for Official presentation", () => {
    const allocate = vi.fn(() => dungeonTerminalFlowIdentity(
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
      "local-flow",
    ));

    expect(allocateDungeonTerminalFlow("official", allocate)).toBeUndefined();
    expect(allocate).not.toHaveBeenCalled();
    expect(allocateDungeonTerminalFlow("local", allocate)?.id).toBe("local-flow");
    expect(allocate).toHaveBeenCalledTimes(1);
  });

  it("adopts each committed Official terminal projection before local continuation", () => {
    for (const outcome of ["victory", "retreat", "defeat"] as const) {
      const adoptedProjection = outcome === "defeat"
        ? { location: { kind: "town" }, battle: undefined, dungeon: undefined }
        : { location: { kind: "dungeon" }, battle: undefined, dungeon: {} };
      let projection = adoptedProjection;
      const calls: string[] = [];
      const authority = {
        projection: () => {
          calls.push("read");
          return projection as unknown as SlotProjectionV1;
        },
        adoptProjection: () => {
          calls.push("adopt");
          projection = adoptedProjection;
        },
      };

      const result = adoptOfficialDungeonTerminalProjection(authority, outcome);

      expect(result).toBe(projection);
      expect(calls).toEqual(["read", "adopt", "read"]);
    }
  });

  it("replays committed room entry actions after Official victory but not retreat or defeat", () => {
    const treasure = {
      kind: "treasure",
      roomId: "room-1",
      treasure: { id: "guarded-1", guarded: true, loot: [] },
    } as const;
    const enterCurrentRoom = vi.fn(() => [treasure]);

    expect(officialDungeonBattleReturnActions("victory", { enterCurrentRoom }))
      .toEqual([treasure]);
    expect(officialDungeonBattleReturnActions("retreat", { enterCurrentRoom })).toBeNull();
    expect(officialDungeonBattleReturnActions("defeat", { enterCurrentRoom })).toBeNull();
    expect(enterCurrentRoom).toHaveBeenCalledTimes(1);
  });

  it("keeps Official victory diagnostics behind committed terminal adoption", () => {
    const encounter = {
      ...fixed(),
      winEvent: { className: "PlotGameFlowEvent", data: { plot: "win" } },
      achievement: "AchievementOne",
    } satisfies DungeonEncounter;
    const reported: string[] = [];
    const report = createDungeonBattleLifecycleDiagnosticReporter(encounter, (entry) => {
      reported.push(entry.code);
    });
    const onCommittedTerminal = (outcome: "victory" | "retreat" | "defeat"): void => {
      if (outcome === "victory") report(outcome);
    };
    let committed = false;
    const authority = {
      projection: () => (committed
        ? { location: { kind: "dungeon" }, battle: undefined, dungeon: {} }
        : { location: { kind: "battle" }, battle: {}, dungeon: {} }) as unknown as SlotProjectionV1,
      adoptProjection: () => { committed = true; },
    };

    expect(() => adoptOfficialDungeonTerminalProjection(authority, "victory")).toThrow(
      /still in battle state/,
    );
    // The production caller invokes the reporter only after adoption resolves; no callback is
    // made for the rejected/uncommitted projection.
    expect(reported).toEqual([]);

    // A later committed authority response replaces the projection; only then does the real
    // onCommittedTerminal caller run.
    committed = true;
    adoptOfficialDungeonTerminalProjection(authority, "victory");
    onCommittedTerminal("victory");
    onCommittedTerminal("retreat");
    onCommittedTerminal("defeat");
    expect(reported).toEqual(["opaque-win-event", "opaque-achievement"]);
  });

  it("persists the terminal dungeon for local victory/retreat but clears it in the defeat checkpoint", () => {
    const snapshot = { marker: "prepared-dungeon" } as never;

    expect(terminalDungeonCheckpointOverride("victory", snapshot)).toBe(snapshot);
    expect(terminalDungeonCheckpointOverride("retreat", snapshot)).toBe(snapshot);
    expect(terminalDungeonCheckpointOverride("defeat", snapshot)).toBeNull();
  });

  it("orchestrates roster notification before the distinct terminal resolution", () => {
    const calls: string[] = [];
    const flow = dungeonTerminalFlowIdentity(
      { typeName: "Test", sourceFile: "Dungeon_Test.plist", floor: 1 },
      "flow-1",
    );
    const result = resolveDungeonBattleTerminal({
      synchronizeEncounterRoomRoster: (_encounter, _flow, roster) => {
        calls.push(`sync:${roster.length}`);
        return true;
      },
      resolveEncounter: (_encounter, outcome, capturedTypes) => {
        calls.push(`resolve:${outcome}:${capturedTypes.join(",")}`);
        return "resolved";
      },
    }, { id: "fixed:1" }, flow, "victory", [], ["Bat"]);

    expect(result).toBe("resolved");
    expect(calls).toEqual(["sync:0", "resolve:victory:Bat"]);
  });

  it("retains only terminal surviving encounter members without inventing HP state", () => {
    const encounter = {
      ...fixed(),
      monsters: [
        { type: "Bat", level: 4 },
        { type: "Slime", level: 5, extraLivingArguments: { boss: true } },
      ],
    } satisfies DungeonEncounter;

    expect(terminalDungeonMonsterRoster(encounter, [1])).toEqual([encounter.monsters[1]]);
    expect(() => terminalDungeonMonsterRoster(encounter, [2])).toThrow(/construction index 2/);
  });

  it("retains fixed-encounter presentation, sprite overrides, and breeder mechanics", () => {
    const built = buildDungeonBattle(definition(), fixed(), [{ shortType: "Slime", level: 5 }]);
    expect(built.encounter.breederXpBonus).toBe(3);
    expect(built.encounter.enemyTeam[0]).toMatchObject({
      shortType: "BlackDragon", boss: true, displayName: "Fafnir",
      capturable: false,
      flatStatBonuses: { MaxHP: 500, Speed: 25 },
      rendererData: { spriteFile: "BlackDragon.png" },
    });
    expect(battleSpriteKey(built.encounter.enemyTeam[0]!)).toBe("BlackDragon-hd");
    expect(battlePortraitFrame(built.encounter.enemyTeam[0]!)).toBe("BlackDragon_icon.png");
    expect(built.encounter).toMatchObject({
      allowRetreat: true,
      blockSaveMe: false,
      questKey: "DefeatBoss",
      uniqueKey: "boss-1",
      difficultyModifier: 0,
    });
  });

  it("uses missing breeder allowCapture as false and applies it after living overrides", () => {
    const encounter = {
      ...fixed(),
      monsters: [{
        type: "BlackDragon",
        level: 12,
        extraLivingArguments: { capturable: true },
      }],
    } satisfies DungeonEncounter;
    expect(buildDungeonBattle(
      definition(),
      encounter,
      [{ shortType: "Slime", level: 5 }],
    ).encounter.enemyTeam[0]?.capturable).toBe(false);
  });

  it("materializes Breeder's default XP bonus so breeder presence survives the battle boundary", () => {
    const encounter = {
      ...fixed(),
      breeder: { type: "Normal", arguments: {} },
      monsters: [{ type: "BlackDragon", level: 12 }],
    } satisfies DungeonEncounter;
    const built = buildDungeonBattle(
      definition(),
      encounter,
      [{ shortType: "Slime", level: 5 }],
    );
    expect(built.encounter.breederXpBonus).toBe(1);
    expect(built.encounter.enemyTeam[0]?.boss).toBeUndefined();
    expect(battleMusicRole(built.encounter.breederXpBonus)).toEqual({
      category: "BossBattle",
      trackCount: 5,
    });
  });

  it("keeps unknown source fields diagnostic and rejects malformed known fields", () => {
    const unknown = {
      ...fixed(),
      breeder: { type: "Normal", arguments: { stats: { Luck: 1 }, mystery: 4 } },
    } satisfies DungeonEncounter;
    const built = buildDungeonBattle(definition(), unknown, [{ shortType: "Slime", level: 5 }]);
    expect(built.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
      "unsupported-breeder-stat", "unsupported-breeder-argument",
    ]));
    expect(built.diagnostics.map((entry) => entry.code)).not.toContain("save-me-disabled");

    const malformed = {
      ...fixed(),
      breeder: { type: "Normal", arguments: { stats: { MaxHP: "many" } } },
    } as unknown as DungeonEncounter;
    expect(() => buildDungeonBattle(definition(), malformed, [{ shortType: "Slime", level: 5 }]))
      .toThrow(/breeder\.stats\.MaxHP must be a safe integer/);
  });

  it("names every independent unsupported battle hook exactly once", () => {
    const encounter = {
      ...fixed(),
      breeder: {
        type: "Normal",
        arguments: {
          stats: { Luck: 1 },
          mystery: 4,
        },
      },
      monsters: [{
        type: "BlackDragon",
        level: 12,
        extraLivingArguments: { unknownLivingArgument: true },
      }],
      startEvent: { className: "PlotGameFlowEvent", data: { plot: "start" } },
      winEvent: { className: "PlotGameFlowEvent", data: { plot: "win" } },
      questKey: "OpaqueQuestHook",
      achievement: "OpaqueAchievementHook",
    } satisfies DungeonEncounter;

    const codes = buildDungeonBattle(
      definition(),
      encounter,
      [{ shortType: "Slime", level: 5 }],
    ).diagnostics.map((diagnostic) => diagnostic.code);

    expect(codes).toEqual([
      "unsupported-breeder-stat",
      "unsupported-breeder-argument",
      "unsupported-living-argument",
      "opaque-start-event",
    ]);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).not.toContain("opaque-battle-reward");
    expect(codes).not.toContain("quest-gate-advisory");
  });

  it("reports a non-Normal breeder as its own unavailable branch", () => {
    const encounter = {
      ...fixed(),
      breeder: { type: "Elite", arguments: { stats: { Attack: 99 }, mystery: true } },
      achievement: "OpaqueAchievementHook",
    } satisfies DungeonEncounter;
    const diagnostics = buildDungeonBattle(
      definition(),
      encounter,
      [{ shortType: "Slime", level: 5 }],
    ).diagnostics;

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unsupported-breeder-type",
    ]);
    expect(diagnostics.filter(({ code }) => code === "unsupported-breeder-type")).toHaveLength(1);
    expect(diagnostics[0]?.detail).toMatchObject({ type: "Elite" });
  });

  it("keeps victory-only diagnostics behind the post-win lifecycle seam", () => {
    const encounter = {
      ...fixed(),
      winEvent: { className: "PlotGameFlowEvent", data: { plot: "win" } },
      achievement: "AchievementOne",
    } satisfies DungeonEncounter;

    expect(dungeonBattleLifecycleDiagnostics(encounter, "victory").map(({ code }) => code))
      .toEqual(["opaque-win-event", "opaque-achievement"]);
    expect(dungeonBattleLifecycleDiagnostics(encounter, "retreat")).toEqual([]);
    expect(dungeonBattleLifecycleDiagnostics(encounter, "defeat")).toEqual([]);

    const reported: string[] = [];
    const report = createDungeonBattleLifecycleDiagnosticReporter(encounter, (entry) => {
      reported.push(entry.code);
    });
    report("victory");
    report("victory");
    expect(reported).toEqual(["opaque-win-event", "opaque-achievement"]);

    // A new battle lifecycle gets a new reporter; unrelated historical lifecycle entries are not
    // globally deduplicated by the controller.
    createDungeonBattleLifecycleDiagnosticReporter(encounter, (entry) => {
      reported.push(entry.code);
    })("victory");
    expect(reported).toEqual([
      "opaque-win-event", "opaque-achievement", "opaque-win-event", "opaque-achievement",
    ]);
  });

  it("blocks Save Me for Volcano variants but allows an ordinary Official dungeon", () => {
    expect(buildDungeonBattle(
      definition("Volcano"),
      fixed(),
      [{ shortType: "Slime", level: 5 }],
    ).encounter).toMatchObject({ blockSaveMe: true, blockCapture: true });
    expect(buildDungeonBattle(
      definition("VolcanoB"),
      fixed(),
      [{ shortType: "Slime", level: 5 }],
    ).encounter).toMatchObject({ blockSaveMe: true, blockCapture: true });
    const official = buildDungeonBattle(
      definition("NorthCave"),
      fixed(),
      [{ shortType: "Slime", level: 5 }],
      { authority: "official" },
    );
    expect(official.encounter.blockSaveMe).toBe(false);
    expect(official.encounter.blockCapture).toBeUndefined();
    expect(official.diagnostics.map((entry) => entry.code)).not.toContain("save-me-disabled");
  });

  it("does not apply dungeon roster loss while Save Me eligibility is queried", async () => {
    const calls: string[] = [];
    const recovery: DefeatRecoveryAdapter = {
      canOffer: () => {
        calls.push("can-offer");
        return true;
      },
      markTutorialSeen: () => { calls.push("tutorial"); },
      acceptSaveMe: async () => {
        calls.push("accept");
        return "saved";
      },
      openGoldStore: async () => {
        calls.push("store");
        return { closed: Promise.resolve() };
      },
    };
    const wrapped = withDungeonRoomRosterLoss(recovery, () => {
      calls.push("room-roster-loss");
    });

    expect(wrapped.canOffer()).toBe(true);
    await wrapped.markTutorialSeen();
    expect(await wrapped.acceptSaveMe()).toBe("saved");
    await wrapped.openGoldStore();
    expect(wrapped.canOffer()).toBe(true);
    await wrapped.markTutorialSeen();
    expect(calls).toEqual(["can-offer", "tutorial", "accept", "store", "can-offer", "tutorial"]);
  });

  it("leaves room-roster staging to the terminal transaction", () => {
    let rosterAttempts = 0;
    const recovery: DefeatRecoveryAdapter = {
      canOffer: () => true,
      markTutorialSeen: () => {},
      acceptSaveMe: async () => "saved",
      openGoldStore: async () => ({ closed: Promise.resolve() }),
    };
    const wrapped = withDungeonRoomRosterLoss(recovery, () => {
      rosterAttempts += 1;
    });

    expect(wrapped.canOffer()).toBe(true);
    expect(rosterAttempts).toBe(0);
  });
});
