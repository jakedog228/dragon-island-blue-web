import {
  type ClearDungeonQuestDefinition,
  type QuestCatalog,
  type QuestDefinition,
  type QuestJsonValue,
  type QuantityQuestDefinition,
} from "@dib/gamedata/browser";

export const MAX_ACTIVE_GUILD_QUESTS = 3;

export type GuildQuestProgress = Readonly<Record<string, QuestJsonValue>>;

export interface GuildQuestStateSnapshot {
  readonly schemaVersion: 1;
  readonly activeQuestNames: readonly string[];
  readonly finishedQuestNames: readonly string[];
  readonly progressByQuestName: Readonly<Record<string, GuildQuestProgress>>;
  /** Source `UserSavedData.dialogsSeen`, separate from quest completion. */
  readonly dialogsSeen: readonly string[];
  /** Source global fixed-encounter registry, separate from POI and dungeon-run state. */
  readonly completedFixedEncounterKeys: readonly string[];
  /** Source `battleRewardsReceived`, deliberately separate from encounter completion. */
  readonly receivedBattleRewardKeys: readonly string[];
}

export interface GuildQuestMutation {
  readonly kind:
    | "start"
    | "progress"
    | "claim"
    | "drop-all"
    | "dialog-seen"
    | "fixed-encounter"
    | "battle-reward";
  readonly questName?: string;
  /**
   * Source persistence distinction. Non-nil progress writes and explicit record-town saves are
   * immediate; several collection mutations are dirty/deferred until their enclosing flow saves.
   */
  readonly sourcePersistence: "immediate" | "deferred";
}


export interface GuildQuestWorldPayload {
  readonly instanceName: string;
  readonly encounterPoiCount: number;
  readonly completedEncounterPoiCount: number;
}

export type GuildQuestEvent =
  | {
      readonly id: 0;
      readonly target: { readonly shortType: string; readonly inEnemyDeadMembers: boolean };
    }
  | { readonly id: 1; readonly world: GuildQuestWorldPayload }


  | { readonly id: 2; readonly world: GuildQuestWorldPayload }
  | { readonly id: 3 }
  | {
      readonly id: 4;
      readonly dungeon: {
        readonly instanceName: string;
        readonly floor: number;
        readonly survivingMonstersByRoom: readonly number[];
      };
    }
  | { readonly id: 5; readonly spiritShortType: string }
  | { readonly id: 6; readonly monsterShortType: string }
  | { readonly id: 7; readonly monsterShortType: string }
  | {
      readonly id: 8;
      readonly firstIngredientShortType: string;
      readonly secondIngredientShortType: string;
    }
  | {
      readonly id: 9;
      readonly battle: {
        readonly questKey?: string;
        readonly uniqueKey?: string;
        readonly friendlyTeamCount: number;
        readonly battingOrderSize: number;
        readonly difficultyModifier: number;
      };
    }
  | {
      readonly id: 10;
      readonly dungeon: { readonly instanceName: string; readonly floor: number };
    }
  | { readonly id: 11; readonly townName: string };

export interface GuildQuestEventResult {
  /** Quests whose source path requests a progress notification, including WinBattleList event 9. */
  readonly notificationQuestNames: readonly string[];
  /** Quests whose source path performed a non-nil local progress write. */
  readonly changedQuestNames: readonly string[];
}

export interface GuildQuestProgressCount {
  readonly current: number;
  readonly required: number;
}

/**
 * Pure source-shaped Guild/story quest aggregate.
 *
 * Dungeon catch challenges, Monster Collection goals, POI completion, and party/profile state do
 * not enter this class. That separation is observable in the original save and condition paths.
 */
export class GuildQuestRuntime {
  private readonly activeNames: string[];
  private readonly finishedNames: string[];
  private readonly progress = new Map<string, GuildQuestProgress>();
  private readonly seenDialogs = new Set<string>();
  private readonly completedFixedEncounters = new Set<string>();
  private readonly receivedBattleRewards = new Set<string>();
  private onMutation: (mutation: GuildQuestMutation) => void = () => {};
  readonly droppedActiveQuestNamesDuringRestore: readonly string[];

  constructor(
    readonly catalog: QuestCatalog,
    snapshot: GuildQuestStateSnapshot = emptyGuildQuestStateSnapshot(),
  ) {
    const parsed = parseGuildQuestStateSnapshot(snapshot);
    const dropped: string[] = [];
    this.activeNames = [];
    for (const name of parsed.activeQuestNames) {
      if (catalog.questForName(name) === undefined) {
        dropped.push(name);
      } else {
        this.activeNames.push(name);
      }
    }
    this.finishedNames = [...parsed.finishedQuestNames];
    for (const [name, value] of Object.entries(parsed.progressByQuestName)) {
      if (!dropped.includes(name)) this.progress.set(name, cloneRecord(value));
    }
    for (const name of parsed.dialogsSeen) this.seenDialogs.add(name);
    for (const key of parsed.completedFixedEncounterKeys) this.completedFixedEncounters.add(key);
    for (const key of parsed.receivedBattleRewardKeys) this.receivedBattleRewards.add(key);
    this.droppedActiveQuestNamesDuringRestore = Object.freeze(dropped);
  }

  setMutationListener(listener: (mutation: GuildQuestMutation) => void): void {
    this.onMutation = listener;
  }

  activeQuestNames(): readonly string[] {
    return Object.freeze([...this.activeNames]);
  }

  finishedQuestNames(): readonly string[] {
    return Object.freeze([...this.finishedNames]);
  }

  activeQuests(): readonly QuestDefinition[] {
    return Object.freeze(this.activeNames.map((name) => this.catalog.requireQuest(name)));
  }

  completedActiveQuestNames(): readonly string[] {
    return Object.freeze(this.activeNames.filter((name) => this.isComplete(name)));
  }

  questProgress(name: string): GuildQuestProgress {
    return cloneRecord(this.progress.get(name) ?? {});
  }

  /**
   * Integer objective units for authoritative presentation events. The browser still formats the
   * source-specific text from the committed snapshot; these counts make `quest.progressed`
   * truthful for every quest family without sending localized presentation strings.
   */
  questProgressCount(name: string): GuildQuestProgressCount {
    const quest = this.catalog.requireQuest(name);
    const data = this.progress.get(name);
    switch (quest.className) {
      case "DefeatMonstersQuest":
      case "MakeSoulstonesQuest":
      case "GetSpiritTotemQuest":
      case "PromoteMonsterQuest":
      case "CombineMonstersQuest":
      case "WinBattleQuest":
      case "CatchMonstersQuest":
        return progressCount(numericProgress(data, "quantity"), quest.quantity);
      case "ClearWorldQuest":
        return progressCount(
          Math.round(Math.fround(numericProgress(data, "percent")) * 100),
          Math.max(1, Math.round(Math.fround(quest.percent) * 100)),
        );
      case "ClearDungeonQuest": {
        let cleared = 0;
        for (let floor = quest.startFloor; floor <= quest.endFloor; floor++) {
          const value = data?.[`monstersLeftOnFloor:${floor}`];
          if (typeof value === "number" && Math.trunc(value) === 0) cleared++;
        }
        return progressCount(cleared, quest.endFloor - quest.startFloor + 1);
      }
      case "ReachDungeonFloorQuest":
        return progressCount(data?.["reached"] === true ? 1 : 0, 1);
      case "VisitTownQuest":
        return progressCount(data?.["reachedTown"] === true ? 1 : 0, 1);
      case "WinBattleListQuest":
        return progressCount(
          quest.battleKeys.filter((key) => this.completedFixedEncounters.has(key)).length,
          quest.battleKeys.length,
        );
    }
  }

  hasFinishedQuest(name: string): boolean {
    requireName(name, "quest name");
    return this.finishedNames.includes(name);
  }

  hasSeenDialog(name: string): boolean {
    requireName(name, "dialog name");
    return this.seenDialogs.has(name);
  }

  hasCompletedFixedEncounter(key: string): boolean {
    requireName(key, "fixed encounter key");
    return this.completedFixedEncounters.has(key);
  }

  hasReceivedBattleReward(key: string): boolean {
    requireName(key, "battle reward key");
    return this.receivedBattleRewards.has(key);
  }

  canAddMoreQuests(): boolean {
    return this.activeNames.length < MAX_ACTIVE_GUILD_QUESTS;
  }


  startQuest(name: string): boolean {
    const definition = this.catalog.requireQuest(name);
    if (!this.canAddMoreQuests() || this.activeNames.includes(definition.name)) return false;
    this.activeNames.push(definition.name);
    this.emit({ kind: "start", questName: definition.name, sourcePersistence: "deferred" });
    return true;
  }

  questsAvailableInTown(townName: string): number {
    requireName(townName, "town name");
    let result = 0;
    for (const quest of this.catalog.definitions) {
      if (
        quest.source === townName &&
        !this.activeNames.includes(quest.name) &&
        !this.finishedNames.includes(quest.name)
      ) {
        result++;
      }
    }
    return result;
  }

  firstAvailableQuestInTown(townName: string): QuestDefinition | undefined {
    requireName(townName, "town name");
    if (!this.canAddMoreQuests()) return undefined;
    return this.catalog.definitions.find((candidate) =>
      candidate.source === townName &&
      !this.activeNames.includes(candidate.name) &&
      !this.finishedNames.includes(candidate.name)
    );
  }

  /** Tavern `newQuest:`'s second, independent plist scan. */
  startFirstAvailableQuestInTown(townName: string): QuestDefinition | undefined {
    const quest = this.firstAvailableQuestInTown(townName);
    return quest !== undefined && this.startQuest(quest.name) ? quest : undefined;
  }


  completeQuest(name: string): boolean {
    requireName(name, "quest name");
    const activeIndex = this.activeNames.indexOf(name);
    if (activeIndex < 0) return false;
    this.activeNames.splice(activeIndex, 1);
    this.progress.delete(name);
    if (this.finishedNames.includes(name)) {
      this.emit({ kind: "claim", questName: name, sourcePersistence: "deferred" });
      return false;
    }
    this.finishedNames.push(name);
    this.emit({ kind: "claim", questName: name, sourcePersistence: "deferred" });
    return true;
  }

  claimFirstCompletedQuest(): QuestDefinition | undefined {
    const name = this.activeNames.find((candidate) => this.isComplete(candidate));
    if (name === undefined || !this.completeQuest(name)) return undefined;
    return this.catalog.requireQuest(name);
  }

  clearAllQuests(): void {
    for (const name of this.activeNames) this.progress.delete(name);
    this.activeNames.length = 0;
    this.emit({ kind: "drop-all", sourcePersistence: "immediate" });
  }

  /**
   * True only for an exact active quest key whose objective is still incomplete. In particular,
   * objective-complete/unclaimed is active but unusable.
   */
  canUseQuestKey(key: string): boolean {
    requireName(key, "quest key");
    return this.activeNames.some((name) => {
      const quest = this.catalog.requireQuest(name);
      return quest.questKey === key && !this.isComplete(name);
    });
  }

  isComplete(name: string): boolean {
    return this.isDefinitionComplete(this.catalog.requireQuest(name));
  }

  fireEvent(event: GuildQuestEvent): GuildQuestEventResult {
    const notifications: string[] = [];
    const changed: string[] = [];
    // Source synchronously enumerates the in-memory active object array.
    for (const name of [...this.activeNames]) {
      const result = this.applyEvent(this.catalog.requireQuest(name), event);
      if (result.notify) notifications.push(name);
      if (result.changed) changed.push(name);
    }
    return Object.freeze({
      notificationQuestNames: Object.freeze(notifications),
      changedQuestNames: Object.freeze(changed),
    });
  }


  recordBattleWin(event: Extract<GuildQuestEvent, { id: 9 }>): GuildQuestEventResult {
    if (event.battle.uniqueKey !== undefined) this.markFixedEncounterComplete(event.battle.uniqueKey);
    return this.fireEvent(event);
  }

  markFixedEncounterComplete(key: string): boolean {
    requireName(key, "fixed encounter key");
    if (this.completedFixedEncounters.has(key)) return false;
    this.completedFixedEncounters.add(key);
    this.emit({ kind: "fixed-encounter", sourcePersistence: "deferred" });
    return true;
  }

  markBattleRewardReceived(key: string): boolean {
    requireName(key, "battle reward key");
    if (this.receivedBattleRewards.has(key)) return false;
    this.receivedBattleRewards.add(key);
    this.emit({ kind: "battle-reward", sourcePersistence: "deferred" });
    return true;
  }

  /**
   * Generic chat replay gate: first display marks seen before presentation; already-seen records
   * are suppressed only when effective `alwaysShow` is false.
   */
  requestChatPresentation(name: string, alwaysShow = true): boolean {
    requireName(name, "dialog name");
    if (this.seenDialogs.has(name)) return alwaysShow;
    this.seenDialogs.add(name);
    this.emit({ kind: "dialog-seen", sourcePersistence: "deferred" });
    return true;
  }


  enteredTown(townName: string): GuildQuestEventResult {
    requireName(townName, "town name");
    for (const name of [...this.activeNames]) {
      const quest = this.catalog.requireQuest(name);
      if (quest.eraseDataAtTown && !this.isDefinitionComplete(quest)) this.setProgress(name, {});
    }
    return this.recordTownVisit(townName);
  }


  recordTownVisit(townName: string): GuildQuestEventResult {
    return this.fireEvent({ id: 11, townName: requireName(townName, "town name") });
  }

  stateSnapshot(): GuildQuestStateSnapshot {
    const progressByQuestName: Record<string, GuildQuestProgress> = {};
    for (const name of [...this.progress.keys()].sort()) {
      progressByQuestName[name] = cloneRecord(this.progress.get(name)!);
    }
    return Object.freeze({
      schemaVersion: 1,
      activeQuestNames: Object.freeze([...this.activeNames]),
      finishedQuestNames: Object.freeze([...this.finishedNames]),
      progressByQuestName: Object.freeze(progressByQuestName),
      dialogsSeen: Object.freeze([...this.seenDialogs].sort()),
      completedFixedEncounterKeys: Object.freeze([...this.completedFixedEncounters].sort()),
      receivedBattleRewardKeys: Object.freeze([...this.receivedBattleRewards].sort()),
    });
  }

  /**
   * Replace the browser mirror from a committed authoritative projection without emitting local
   * mutation callbacks. The catalog is immutable and logic-pack-bound; only its durable aggregate
   * is synchronized.
   */
  replaceStateSnapshot(snapshot: GuildQuestStateSnapshot): void {
    const parsed = parseGuildQuestStateSnapshot(snapshot);
    for (const name of parsed.activeQuestNames) this.catalog.requireQuest(name);
    for (const name of Object.keys(parsed.progressByQuestName)) this.catalog.requireQuest(name);
    this.activeNames.splice(0, this.activeNames.length, ...parsed.activeQuestNames);
    this.finishedNames.splice(0, this.finishedNames.length, ...parsed.finishedQuestNames);
    this.progress.clear();
    for (const [name, value] of Object.entries(parsed.progressByQuestName)) {
      this.progress.set(name, cloneRecord(value));
    }
    this.seenDialogs.clear();
    for (const name of parsed.dialogsSeen) this.seenDialogs.add(name);
    this.completedFixedEncounters.clear();
    for (const key of parsed.completedFixedEncounterKeys) this.completedFixedEncounters.add(key);
    this.receivedBattleRewards.clear();
    for (const key of parsed.receivedBattleRewardKeys) this.receivedBattleRewards.add(key);
  }

  private applyEvent(
    quest: QuestDefinition,
    event: GuildQuestEvent,
  ): { readonly notify: boolean; readonly changed: boolean } {
    switch (quest.className) {
      case "DefeatMonstersQuest":
        return event.id === 0 &&
          event.target.inEnemyDeadMembers &&
          matchesOptionalType(quest, event.target.shortType)
          ? this.increaseQuantity(quest)
          : NO_EVENT_CHANGE;
      case "ClearWorldQuest":
        if (event.id !== 1 || event.world.instanceName !== quest.type) return NO_EVENT_CHANGE;
        return this.setPercentage(
          quest,
          event.world.encounterPoiCount === 0
            ? 1
            : event.world.completedEncounterPoiCount / event.world.encounterPoiCount,
        );
      case "MakeSoulstonesQuest":
        return event.id === 3 ? this.increaseQuantity(quest) : NO_EVENT_CHANGE;
      case "ClearDungeonQuest":
        return event.id === 4 ? this.updateClearDungeon(quest, event.dungeon) : NO_EVENT_CHANGE;
      case "GetSpiritTotemQuest":
        return event.id === 5 && matchesOptionalType(quest, event.spiritShortType)
          ? this.increaseQuantity(quest)
          : NO_EVENT_CHANGE;
      case "PromoteMonsterQuest":
        return event.id === 6 && matchesOptionalType(quest, event.monsterShortType)
          ? this.increaseQuantity(quest)
          : NO_EVENT_CHANGE;
      case "CombineMonstersQuest":
        return event.id === 8 &&
          (
            (quest.type1 === event.firstIngredientShortType &&
              quest.type2 === event.secondIngredientShortType) ||
            (quest.type1 === event.secondIngredientShortType &&
              quest.type2 === event.firstIngredientShortType)
          )
          ? this.increaseQuantity(quest)
          : NO_EVENT_CHANGE;
      case "WinBattleQuest":
        return event.id === 9 && this.qualifiesBattleWin(quest, event.battle)
          ? this.increaseQuantity(quest)
          : NO_EVENT_CHANGE;
      case "ReachDungeonFloorQuest":
        if (
          event.id !== 10 ||
          event.dungeon.instanceName !== quest.type ||
          event.dungeon.floor < quest.floor
        ) {
          return NO_EVENT_CHANGE;
        }
        return this.replaceProgress(quest.name, { reached: true });
      case "CatchMonstersQuest":
        return event.id === 7 && matchesOptionalType(quest, event.monsterShortType)
          ? this.increaseQuantity(quest)
          : NO_EVENT_CHANGE;
      case "VisitTownQuest":
        return event.id === 11 && event.townName === quest.townName
          ? this.replaceProgress(quest.name, { reachedTown: true })
          : NO_EVENT_CHANGE;
      case "WinBattleListQuest":
        return event.id === 9 &&
          event.battle.uniqueKey !== undefined &&
          quest.battleKeys.includes(event.battle.uniqueKey)
          ? { notify: true, changed: false }
          : NO_EVENT_CHANGE;
    }
  }

  private increaseQuantity(
    quest: QuantityQuestDefinition,
    delta = 1,
  ): { readonly notify: boolean; readonly changed: boolean } {
    const current = numericProgress(this.progress.get(quest.name), "quantity");
    const next = Math.min(quest.quantity, current + Math.trunc(delta));
    if (current === next) return NO_EVENT_CHANGE;
    this.setProgress(quest.name, { ...(this.progress.get(quest.name) ?? {}), quantity: next });
    return EVENT_CHANGED;
  }

  private setPercentage(
    quest: Extract<QuestDefinition, { className: "ClearWorldQuest" }>,
    value: number,
  ): { readonly notify: boolean; readonly changed: boolean } {
    const current = numericProgress(this.progress.get(quest.name), "percent");
    const next = Math.fround(value);
    if (!(next > current)) return NO_EVENT_CHANGE;

    this.setProgress(quest.name, { percent: next });
    return EVENT_CHANGED;
  }

  private updateClearDungeon(
    quest: ClearDungeonQuestDefinition,
    dungeon: Extract<GuildQuestEvent, { id: 4 }>["dungeon"],
  ): { readonly notify: boolean; readonly changed: boolean } {
    if (
      dungeon.instanceName !== quest.type ||
      dungeon.floor < quest.startFloor ||
      dungeon.floor > quest.endFloor
    ) {
      return NO_EVENT_CHANGE;
    }
    let surviving = 0;
    for (const count of dungeon.survivingMonstersByRoom) {
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error("GuildQuestRuntime: dungeon surviving-monster counts must be nonnegative integers");
      }
      surviving += count;
    }
    const key = `monstersLeftOnFloor:${dungeon.floor}`;
    const current = this.progress.get(quest.name);
    this.setProgress(quest.name, { ...(current ?? {}), [key]: surviving });
    return {
      notify: surviving === 0 || (quest.startFloor === quest.endFloor && quest.showMonsterCount),
      changed: true,
    };
  }

  private qualifiesBattleWin(
    quest: QuantityQuestDefinition,
    battle: Extract<GuildQuestEvent, { id: 9 }>["battle"],
  ): boolean {

    if (quest.questKey !== undefined && quest.questKey !== battle.questKey) return false;
    if (
      quest.difficultyModifier !== undefined &&
      quest.difficultyModifier >= 1 &&
      battle.difficultyModifier < quest.difficultyModifier
    ) {
      return false;
    }
    if (quest.allAlive === true) return battle.friendlyTeamCount === battle.battingOrderSize;
    if (quest.monstersLeft !== undefined) return battle.friendlyTeamCount <= quest.monstersLeft;
    return true;
  }

  private replaceProgress(
    name: string,
    value: GuildQuestProgress,
  ): { readonly notify: boolean; readonly changed: boolean } {
    this.setProgress(name, value);
    return EVENT_CHANGED;
  }

  private setProgress(name: string, value: GuildQuestProgress): void {
    this.progress.set(name, cloneRecord(value));
    this.emit({ kind: "progress", questName: name, sourcePersistence: "immediate" });
  }

  private isDefinitionComplete(quest: QuestDefinition): boolean {
    const data = this.progress.get(quest.name);
    switch (quest.className) {
      case "DefeatMonstersQuest":
      case "MakeSoulstonesQuest":
      case "GetSpiritTotemQuest":
      case "PromoteMonsterQuest":
      case "CombineMonstersQuest":
      case "WinBattleQuest":
      case "CatchMonstersQuest":
        return numericProgress(data, "quantity") >= quest.quantity;
      case "ClearWorldQuest":
        return numericProgress(data, "percent") + 0.002 >= quest.percent;
      case "ClearDungeonQuest": {
        let cleared = 0;
        for (let floor = quest.startFloor; floor <= quest.endFloor; floor++) {
          const value = data?.[`monstersLeftOnFloor:${floor}`];
          if (typeof value === "number" && Math.trunc(value) === 0) cleared++;
        }
        return cleared >= quest.endFloor - quest.startFloor + 1;
      }
      case "ReachDungeonFloorQuest":
        return data?.["reached"] === true;
      case "VisitTownQuest":
        return data?.["reachedTown"] === true;
      case "WinBattleListQuest":
        return quest.battleKeys.every((key) => this.completedFixedEncounters.has(key));
    }
  }

  private emit(mutation: GuildQuestMutation): void {
    this.onMutation(Object.freeze(mutation));
  }
}

const NO_EVENT_CHANGE = Object.freeze({ notify: false, changed: false });
const EVENT_CHANGED = Object.freeze({ notify: true, changed: true });

export function emptyGuildQuestStateSnapshot(): GuildQuestStateSnapshot {
  return Object.freeze({
    schemaVersion: 1,
    activeQuestNames: Object.freeze([]),
    finishedQuestNames: Object.freeze([]),
    progressByQuestName: Object.freeze({}),
    dialogsSeen: Object.freeze([]),
    completedFixedEncounterKeys: Object.freeze([]),
    receivedBattleRewardKeys: Object.freeze([]),
  });
}

export function parseGuildQuestStateSnapshot(value: unknown): GuildQuestStateSnapshot {
  const raw = dictionary(value, "guild quest state");
  if (raw["schemaVersion"] !== 1) {
    throw new Error(`GuildQuestRuntime: unsupported state schema ${String(raw["schemaVersion"])}`);
  }
  const activeQuestNames = uniqueStringArray(raw["activeQuestNames"], "activeQuestNames");
  const finishedQuestNames = uniqueStringArray(raw["finishedQuestNames"], "finishedQuestNames");
  const dialogsSeen = uniqueStringArray(raw["dialogsSeen"], "dialogsSeen");
  const completedFixedEncounterKeys = uniqueStringArray(
    raw["completedFixedEncounterKeys"],
    "completedFixedEncounterKeys",
  );
  const receivedBattleRewardKeys = raw["receivedBattleRewardKeys"] === undefined
    ? Object.freeze([])
    : uniqueStringArray(raw["receivedBattleRewardKeys"], "receivedBattleRewardKeys");
  const progressRaw = dictionary(raw["progressByQuestName"], "progressByQuestName");
  const progressByQuestName: Record<string, GuildQuestProgress> = {};
  for (const [name, progress] of Object.entries(progressRaw)) {
    requireName(name, "progress quest name");
    progressByQuestName[name] = cloneRecord(
      freezeJsonDictionary(progress, `progressByQuestName.${name}`),
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    activeQuestNames,
    finishedQuestNames,
    progressByQuestName: Object.freeze(progressByQuestName),
    dialogsSeen,
    completedFixedEncounterKeys,
    receivedBattleRewardKeys,
  });
}

function matchesOptionalType(quest: QuantityQuestDefinition, actual: string): boolean {
  return quest.type === undefined || quest.type === actual;
}

function numericProgress(
  data: GuildQuestProgress | undefined,
  key: string,
  fallback = 0,
): number {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function progressCount(current: number, required: number): GuildQuestProgressCount {
  if (!Number.isSafeInteger(required) || required <= 0) {
    throw new Error("GuildQuestRuntime: quest progress target must be a positive safe integer");
  }
  const normalizedCurrent = Math.max(0, Math.min(required, Math.trunc(current)));
  return Object.freeze({ current: normalizedCurrent, required });
}

function cloneRecord(value: GuildQuestProgress): GuildQuestProgress {
  return freezeJsonDictionary(structuredClone(value), "quest progress");
}

function freezeJsonDictionary(value: unknown, label: string): GuildQuestProgress {
  const raw = dictionary(value, label);
  const result: Record<string, QuestJsonValue> = {};
  for (const [key, entry] of Object.entries(raw)) result[key] = freezeJson(entry, `${label}.${key}`);
  return Object.freeze(result);
}

function freezeJson(value: unknown, label: string): QuestJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry, index) => freezeJson(entry, `${label}[${index}]`)));
  }
  if (typeof value === "object") return freezeJsonDictionary(value, label);
  throw new Error(`GuildQuestRuntime: ${label} contains a non-JSON value`);
}

function dictionary(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`GuildQuestRuntime: ${label} must be a dictionary`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function uniqueStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value)) throw new Error(`GuildQuestRuntime: ${label} must be an array`);
  const result = value.map((entry, index) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new Error(`GuildQuestRuntime: ${label}[${index}] must be a non-empty string`);
    }
    return entry;
  });
  if (new Set(result).size !== result.length) {
    throw new Error(`GuildQuestRuntime: ${label} contains duplicates`);
  }
  return Object.freeze(result);
}

function requireName(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GuildQuestRuntime: ${label} must not be empty`);
  }
  return value;
}
