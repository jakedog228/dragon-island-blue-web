import {
  loadChatDefinition, loadDungeonData, loadWorldData,
  type DungeonResourceSource, type DungeonOpaqueEvent,
} from "@dib/gamedata/browser";








export function earnedDungeonBattleDialogs(
  resources: DungeonResourceSource,
  worldNames: readonly string[],
  knownMonsters: ReadonlySet<string>,
  completedKeys: readonly string[],
): readonly string[] {
  if (completedKeys.length === 0) return [];
  const completed = new Set(completedKeys);
  const dialogs = new Set<string>();
  const worlds = worldNames.map(name => loadWorldData(resources, name, knownMonsters));
  interface AuthoredFixedEncounter {
    readonly uniqueKey?: string;
    readonly everyXFloors?: number;
    readonly startEvent?: DungeonOpaqueEvent;
    readonly winEvent?: DungeonOpaqueEvent;
    readonly path: string;
    readonly dungeon: boolean;
  }
  const authored: AuthoredFixedEncounter[] = [];
  for (const world of worlds) {
    for (const poi of world.pointsOfInterest) {
      for (const populator of poi.randomPopulators) {
        for (const fixed of populator.fixedEncounters) {
          authored.push({
            ...(fixed.uniqueKey === undefined ? {} : { uniqueKey: fixed.uniqueKey }),
            ...(fixed.everyXFloors === undefined ? {} : { everyXFloors: fixed.everyXFloors }),
            path: `${world.name}.${poi.name}`,
            dungeon: false,
          });
        }
      }
    }
  }

  const pending: { readonly typeName: string; readonly sourceFile: string; readonly floor: number }[] = [];
  for (const world of worlds) {
    for (const poi of world.pointsOfInterest) {
      const change = poi.zoneChange;
      if (
        change?.kind !== "dungeon" ||
        change.dungeon === undefined ||
        change.dungeonFile === undefined
      ) {
        continue;
      }
      pending.push({
        typeName: change.dungeon,
        sourceFile: change.dungeonFile,
        floor: change.dungeonLevel ?? 1,
      });
    }
  }
  const visited = new Set<string>();
  while (pending.length > 0) {
    const route = pending.shift()!;
    const routeKey = `${route.typeName}:${route.sourceFile}`;
    if (visited.has(routeKey)) continue;
    visited.add(routeKey);
    const definition = loadDungeonData(
      resources,
      route.typeName,
      route.sourceFile,
      route.floor,
      knownMonsters,
    );
    for (const population of definition.floorPopulations) {
      for (const fixed of population.monsterPopulator?.fixedEncounters ?? []) {
        authored.push({
          ...(fixed.uniqueKey === undefined ? {} : { uniqueKey: fixed.uniqueKey }),
          ...(fixed.everyXFloors === undefined ? {} : { everyXFloors: fixed.everyXFloors }),
          ...(fixed.startEvent === undefined ? {} : { startEvent: fixed.startEvent }),
          ...(fixed.winEvent === undefined ? {} : { winEvent: fixed.winEvent }),
          path: `${definition.sourceFile}.floor${population.sourceFloor}.fixed[${fixed.sourceIndex}]`,
          dungeon: true,
        });
      }
      for (const zone of population.zoneChanges) {
        if (zone.kind !== "dungeonExit") continue;
        pending.push({
          typeName: zone.dungeonType,
          sourceFile: zone.dungeonFile,
          floor: zone.dungeonLevel ?? 1,
        });
      }
    }
  }
  const cadenceKeys = authored
    .filter((entry) => entry.uniqueKey !== undefined && entry.everyXFloors !== undefined)
    .map((entry) => entry.uniqueKey!);
  for (const entry of authored) {
    const key = entry.uniqueKey;
    if (!entry.dungeon || key === undefined || !completed.has(key)) continue;
    if (entry.everyXFloors !== undefined && entry.everyXFloors !== 0) continue;
    if (authored.filter((other) => other.uniqueKey === key).length !== 1) continue;
    if (cadenceKeys.some((prefix) =>
      key.length > prefix.length &&
      key.startsWith(prefix) &&
      /^-?[0-9]+$/.test(key.slice(prefix.length)))) {
      continue;
    }
    for (const event of [entry.startEvent, entry.winEvent]) {
      if (event?.className !== "ChatGameFlowEvent") continue;
      const keys = Object.keys(event.data), key = event.data["chatKey"];
      if (keys.length !== 1 || keys[0] !== "chatKey" || typeof key !== "string") {
        throw new Error(`${entry.path}: ChatGameFlowEvent must contain exactly one string chatKey`);
      }
      dialogs.add(loadChatDefinition(resources, key).name);
    }
  }
  return Object.freeze([...dialogs].sort());
}
