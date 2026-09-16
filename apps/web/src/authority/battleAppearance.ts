import { loadDungeonData, selectDungeonFloorPopulation, type DungeonDefinition,
  type DungeonResourceSource } from "@dib/gamedata/dungeon";
import { DungeonRuntimeController, dungeonChallengeLevel, dungeonFixedMonsterLevel, type DungeonRuntimeContext, type DungeonMonster, type DungeonRunSnapshot, type TeamMemberSetup } from "@dib/engine";
import type { BattleSceneV1, FixedBattleEncounterV1 } from "@dib/game-protocol";
import { canonicalLogicValue } from "@dib/logic-pack";
import type { BattleTeamMemberSetup } from "../battle/encounter.js";
import type { BattleSceneSources } from "./battleScene.js";

type AuthoredMonster = { readonly type: string; readonly level?: number; readonly extraLivingArguments?: Readonly<Record<string, unknown>> };

/** v24 delegates dungeon generation to the immutable authority's historical generator.
 * Reconstruct those exact rooms before validating rosters; Offline's newer generator differs. */
export function restoreOfficialDungeonRun(context: DungeonRuntimeContext, snapshot: DungeonRunSnapshot): DungeonRuntimeController {
  return DungeonRuntimeController.restore({ ...context, legacyDungeonGenerationSemantics: true },
    restoreOfficialDungeonAppearance(snapshot, context.resources, context.monsterTypes));
}

function mechanicalArguments(monster: AuthoredMonster): string {
  return JSON.stringify(canonicalLogicValue((monster.extraLivingArguments ?? {}) as
    Parameters<typeof canonicalLogicValue>[0]));
}

/** Find every valid ordered survivor alignment. Repeated species must never steal another
 * instance's art. If old mechanical records cannot distinguish different appearances, fail
 * explicitly instead of guessing. This does not generate encounters or consume any RNG. */
export function restoreFixedMonsterAppearance(
  members: readonly DungeonMonster[],
  authored: readonly AuthoredMonster[],
): DungeonMonster[] {
  const n = members.length, m = authored.length;
  const matches = members.map((member) => authored.map((candidate) =>
    (candidate.type === "Random" || candidate.type === member.type) &&
    (candidate.level === undefined || candidate.level === member.level) &&
    mechanicalArguments(member) === mechanicalArguments(candidate)));
  const prefix = Array.from({ length: n + 1 }, () => Array<boolean>(m + 1).fill(false));
  prefix[0]!.fill(true);
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    prefix[i]![j] = prefix[i]![j - 1]! || (prefix[i - 1]![j - 1]! && matches[i - 1]![j - 1]!);
  }
  if (!prefix[n]![m]) throw new Error("Official fixed roster does not match local encounter arguments");
  const suffix = Array.from({ length: n + 1 }, () => Array<boolean>(m + 1).fill(false));
  suffix[n]!.fill(true);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    suffix[i]![j] = suffix[i]![j + 1]! || (suffix[i + 1]![j + 1]! && matches[i]![j]!);
  }
  return members.map((member, i) => {
    const candidates = authored.filter((_, j) => matches[i]![j] && prefix[i]![j] && suffix[i + 1]![j + 1]);
    const renderer = candidates[0]?.extraLivingArguments?.rendererData;
    if (candidates.some((candidate) => JSON.stringify(candidate.extraLivingArguments?.rendererData) !== JSON.stringify(renderer))) {
      throw new Error("Official fixed roster has ambiguous local appearance; mechanical identities are indistinguishable");
    }
    return { ...structuredClone(member), ...(renderer === undefined ? {} : {
      extraLivingArguments: { ...structuredClone(member.extraLivingArguments ?? {}), rendererData: structuredClone(renderer) },
    }) };
  });
}

function dungeonFixedMonsters(definition: DungeonDefinition, floor: number, encounterId: string) {
  const populator = selectDungeonFloorPopulation(definition, floor, "monsterPopulator")?.monsterPopulator;
  const fixed = populator?.fixedEncounters.find((candidate) => `encounter-fixed-${candidate.sourceIndex}` === encounterId);
  if (fixed === undefined) throw new Error(`Official fixed encounter ${encounterId} is unavailable in local dungeon`);
  return fixed.monsters.map((monster) => ({ ...monster,
    level: dungeonFixedMonsterLevel(dungeonChallengeLevel(definition, floor), populator!.levelScalor, monster.levelScalor),
  }));
}

/** Rehydrate before strict DungeonRuntimeController.restore, including cached/retreated rosters.
 * Only archive-local renderer data is added; all mechanical snapshot checks still run. */
export function restoreOfficialDungeonAppearance(
  snapshot: DungeonRunSnapshot,
  resources: DungeonResourceSource,
  monsterTypes: readonly string[],
): DungeonRunSnapshot {
  const floor = (entry: DungeonRunSnapshot["current"]): DungeonRunSnapshot["current"] => {
    const rosters = entry.session.encounterRosters;
    if (!rosters?.some((roster) => roster.encounterId.startsWith("encounter-fixed-"))) return entry;
    const definition = loadDungeonData(resources, entry.route.typeName, entry.route.sourceFile,
      entry.route.floor, new Set(monsterTypes));
    return { ...entry, session: { ...entry.session, encounterRosters: rosters.map((roster) =>
      !roster.encounterId.startsWith("encounter-fixed-") ? roster : { ...roster,
        monsters: restoreFixedMonsterAppearance(roster.monsters,
          dungeonFixedMonsters(definition, entry.route.floor, roster.encounterId)),
      }) } };
  };
  return { ...snapshot, current: floor(snapshot.current), cachedFloors: snapshot.cachedFloors.map(floor) };
}

export function officialReconnectEnemyTeam(
  battle: object,
  committed: readonly TeamMemberSetup[],
  sources: BattleSceneSources,
  dungeonFloor?: number,
): BattleTeamMemberSetup[] {
  if (!("fixedEncounter" in battle) || !("scene" in battle)) {
    throw new Error("Official reconnect requires the v24 fixed encounter identity");
  }
  const fixed = battle.fixedEncounter as FixedBattleEncounterV1 | null;
  if (fixed === null) return structuredClone([...committed]);
  const scene = battle.scene as BattleSceneV1;
  let authored: readonly AuthoredMonster[];
  if (fixed.source.kind === "world" && scene.kind === "world") {
    const world = sources.world(scene.worldId);
    const poi = world?.pointsOfInterest.find((candidate) => candidate.name === scene.poiId);
    // WorldTrip uses only candidate zero of the selected threshold row, including historical saves.
    const tableKey = fixed.source.tableKey;
    const entry = poi?.randomPopulators.find((row) => String(row.tier) === tableKey);
    const monsters = entry?.fixedEncounters[0]?.monsters;
    if (monsters === undefined || monsters.length !== committed.length) {
      throw new Error("Official fixed world encounter is unavailable in local archive");
    }
    authored = monsters;
  } else if (fixed.source.kind === "dungeon" && scene.kind === "dungeon" && dungeonFloor !== undefined) {
    const definition = sources.dungeon(scene.dungeonId);
    if (definition === undefined) throw new Error("Official fixed dungeon is unavailable in local archive");
    authored = dungeonFixedMonsters(definition, dungeonFloor, fixed.source.encounterId);
  } else throw new Error("Official fixed encounter disagrees with its battle scene");
  if (fixed.members.length !== committed.length || fixed.members.some((member, index) =>
    member.type !== committed[index]?.shortType || member.level !== committed[index]?.level)) {
    throw new Error("Official fixed encounter disagrees with its replay roster");
  }
  const restored = restoreFixedMonsterAppearance(fixed.members.map((member) => ({
    type: member.type, level: member.level,
    ...(member.extraLivingArguments === undefined ? {} : { extraLivingArguments: member.extraLivingArguments }),
  })), authored);
  return committed.map((setup, index) => {
    const args = restored[index]!.extraLivingArguments;
    return { ...structuredClone(setup),
      ...(typeof args?.displayName === "string" ? { displayName: args.displayName } : {}),
      ...(args?.rendererData === undefined ? {} : { rendererData: structuredClone(args.rendererData) }),
    };
  });
}
