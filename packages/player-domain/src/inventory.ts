export type PlayerStatName = "MaxHP" | "Attack" | "Magic" | "Speed" | "Defense" | "Resist";

export type GemSlot = 0 | 1 | 2 | 3;
export type InventoryItemId = string;

interface InventoryItemBase {
  readonly id: InventoryItemId;
  /** Resolved Items.plist path used to reconstruct the source object. */
  readonly definitionPath: string;
  readonly instanceName: string;
}

export interface UsableInventoryItem extends InventoryItemBase {
  readonly kind: "usable";
  readonly level: number;
}

export interface GemInventoryItem extends InventoryItemBase {
  readonly kind: "gem";
  readonly level: number;
  readonly quality: number;
  readonly slot: GemSlot;
  readonly enabledStats: readonly PlayerStatName[];
}

export interface EggInventoryItem extends InventoryItemBase {
  readonly kind: "egg";
  readonly onlyMonsters: boolean;
  readonly repeats: boolean;
}

export type PlayerInventoryItem =
  | UsableInventoryItem
  | GemInventoryItem
  | EggInventoryItem;

export interface PlayerInventoryStateV1 {
  readonly schemaVersion: 1;
  readonly nextItemSequence: number;
  /** Source `Player.savedItems`: independent objects; duplicate rows are never durable stacks. */
  readonly looseItems: readonly PlayerInventoryItem[];
  /** Source `Player.savedGemsInLicense`, keyed by the four license slots. */
  readonly equippedGems: Readonly<Partial<Record<GemSlot, GemInventoryItem>>>;
}

export interface InventoryGroup {
  readonly instanceName: string;
  readonly representativeId: InventoryItemId;
  readonly count: number;
}

const GEM_STATS: readonly PlayerStatName[] = [
  "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
];

/** Renderer-free mirror of Player's loose item arrays plus `gemsInLicense`. */
export class PlayerInventory {
  private readonly loose = new Map<InventoryItemId, PlayerInventoryItem>();
  private readonly equipped = new Map<GemSlot, GemInventoryItem>();
  private nextSequence: number;
  private onChanged: () => void;

  constructor(
    state: PlayerInventoryStateV1 = emptyPlayerInventoryState(),
    onChanged: () => void = () => {},
  ) {
    this.onChanged = onChanged;
    if (state.schemaVersion !== 1) {
      throw new Error(`PlayerInventory: unsupported schema ${String((state as { schemaVersion?: unknown }).schemaVersion)}`);
    }
    requireSequence(state.nextItemSequence);
    this.nextSequence = state.nextItemSequence;
    for (const raw of state.looseItems) {
      const item = freezeValidatedItem(raw);
      if (this.loose.has(item.id)) throw new Error(`PlayerInventory: duplicate item id ${item.id}`);
      this.loose.set(item.id, item);
    }
    for (const [rawSlot, raw] of Object.entries(state.equippedGems)) {
      const slot = Number(rawSlot);
      requireGemSlot(slot);
      const gem = freezeValidatedItem(raw);
      if (gem.kind !== "gem" || gem.slot !== slot) {
        throw new Error(`PlayerInventory: equipped slot ${slot} has incompatible item`);
      }
      if (this.loose.has(gem.id) || [...this.equipped.values()].some(({ id }) => id === gem.id)) {
        throw new Error(`PlayerInventory: duplicate item id ${gem.id}`);
      }
      this.equipped.set(slot, gem);
    }
    const maximumSequence = [...this.allItems()]
      .map(({ id }) => sequenceFromId(id))
      .reduce((maximum, value) => Math.max(maximum, value), 0);
    if (this.nextSequence <= maximumSequence) {
      throw new Error(
        `PlayerInventory: next sequence ${this.nextSequence} does not exceed existing ${maximumSequence}`,
      );
    }
  }

  setChangeListener(listener: () => void): void {
    this.onChanged = listener;
  }

  looseItems(): readonly PlayerInventoryItem[] {
    return [...this.loose.values()];
  }

  equippedGems(): readonly GemInventoryItem[] {
    return [...this.equipped.values()];
  }

  allItems(): readonly PlayerInventoryItem[] {
    return [...this.loose.values(), ...this.equipped.values()];
  }

  item(id: InventoryItemId): PlayerInventoryItem {
    const item = this.loose.get(id) ?? [...this.equipped.values()].find((entry) => entry.id === id);
    if (item === undefined) throw new Error(`PlayerInventory: unknown item ${id}`);
    return item;
  }

  isLoose(id: InventoryItemId): boolean {
    return this.loose.has(id);
  }

  gemInSlot(slot: GemSlot): GemInventoryItem | undefined {
    return this.equipped.get(slot);
  }

  countByInstanceName(instanceName: string): number {
    requireName(instanceName, "instanceName");
    return this.looseItems().filter((item) => item.instanceName === instanceName).length;
  }

  removeFirstLooseByInstanceName(instanceName: string): PlayerInventoryItem | undefined {
    const item = this.looseItems().find((candidate) => candidate.instanceName === instanceName);
    return item === undefined ? undefined : this.removeLoose(item.id);
  }

  /** `ItemPickerGui` keeps the selected object alive through ability resolution, then removes
   * that exact saved object only from the completion callback. */
  consumeUsableAfterAbility(id: InventoryItemId): UsableInventoryItem {
    const item = this.loose.get(id);
    if (item?.kind !== "usable") {
      throw new Error(`PlayerInventory: loose usable item ${id} not found`);
    }
    this.loose.delete(id);
    this.onChanged();
    return item;
  }

  legacyItemCounts(): Readonly<Record<string, number>> {
    const counts = new Map<string, number>();
    for (const item of this.loose.values()) {
      if (item.kind === "usable") continue;
      const key = legacyKeyForItem(item);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Object.freeze(Object.fromEntries([...counts].sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0)));
  }

  addLegacyItem(key: string): PlayerInventoryItem {
    if (key === "Egg") {
      return this.addEgg({ definitionPath: "DestroyOnPickup.Egg", instanceName: "Egg" });
    }
    if (key === "MonsterEgg") {
      return this.addEgg({
        definitionPath: "DestroyOnPickup.MonsterEgg",
        instanceName: "MonsterEgg",
        onlyMonsters: true,
      });
    }
    const gem = parseLegacyGemKey(key);
    if (gem === undefined) throw new Error(`PlayerInventory: unsupported legacy item key ${key}`);
    return this.addGem(gem);
  }

  /** Source type-2 grouping: first independent object represents an instanceName group. */
  usableGroups(): readonly InventoryGroup[] {
    const groups = new Map<string, InventoryGroup>();
    for (const item of this.loose.values()) {
      if (item.kind !== "usable") continue;
      const group = groups.get(item.instanceName);
      groups.set(item.instanceName, group === undefined
        ? Object.freeze({ instanceName: item.instanceName, representativeId: item.id, count: 1 })
        : Object.freeze({ ...group, count: group.count + 1 }));
    }
    return [...groups.values()];
  }

  addUsable(definitionPath: string, instanceName: string, level = 1): UsableInventoryItem {
    requirePositiveInteger(level, "usable level");
    return this.add({
      kind: "usable",
      id: this.allocateId(),
      definitionPath,
      instanceName,
      level,
    }) as UsableInventoryItem;
  }

  addEgg(options: {
    readonly definitionPath: string;
    readonly instanceName: string;
    readonly onlyMonsters?: boolean;
    readonly repeats?: boolean;
  }): EggInventoryItem {
    return this.add({
      kind: "egg",
      id: this.allocateId(),
      definitionPath: options.definitionPath,
      instanceName: options.instanceName,
      onlyMonsters: options.onlyMonsters ?? false,
      repeats: options.repeats ?? false,
    }) as EggInventoryItem;
  }

  addGem(options: {
    readonly definitionPath: string;
    readonly level: number;
    readonly quality: number;
    readonly slot: GemSlot;
    readonly enabledStats: readonly PlayerStatName[];
  }): GemInventoryItem {
    requirePositiveInteger(options.level, "gem level");
    if (!Number.isSafeInteger(options.quality) || options.quality < 0) {
      throw new Error(`PlayerInventory: invalid gem quality ${options.quality}`);
    }
    requireGemSlot(options.slot);
    return this.add({
      kind: "gem",
      id: this.allocateId(),
      definitionPath: options.definitionPath,
      instanceName: lastSegment(options.definitionPath),
      level: options.level,
      quality: options.quality,
      slot: options.slot,
      enabledStats: [...options.enabledStats],
    }) as GemInventoryItem;
  }

  /** `-[Player removeItem:]`: exact loose-object removal. Equipped objects intentionally fail. */
  removeLoose(id: InventoryItemId): PlayerInventoryItem | undefined {
    const item = this.loose.get(id);
    if (item === undefined) return undefined;
    this.loose.delete(id);
    this.onChanged();
    return item;
  }

  /** Player-context `InventoryPageProvider equipItem:`. The occupied Gem returns loose. */
  equipGem(id: InventoryItemId, slotAllowed: (slot: GemSlot) => boolean): {
    readonly equipped: GemInventoryItem;
    readonly displaced?: GemInventoryItem;
  } {
    const candidate = this.loose.get(id);
    if (candidate?.kind !== "gem") throw new Error(`PlayerInventory: loose Gem ${id} not found`);
    if (!slotAllowed(candidate.slot)) {
      throw new Error(`PlayerInventory: license does not allow Gem slot ${candidate.slot}`);
    }
    const displaced = this.equipped.get(candidate.slot);
    if (displaced !== undefined) this.loose.set(displaced.id, displaced);
    this.equipped.set(candidate.slot, candidate);
    this.loose.delete(candidate.id);
    this.onChanged();
    return Object.freeze({
      equipped: candidate,
      ...(displaced === undefined ? {} : { displaced }),
    });
  }

  /** Safe source unequip = addItem(gem), then removeGemFromLicense(exact gem). */
  unequipGem(id: InventoryItemId): GemInventoryItem {
    const entry = [...this.equipped].find(([, gem]) => gem.id === id);
    if (entry === undefined) throw new Error(`PlayerInventory: equipped Gem ${id} not found`);
    const [slot, gem] = entry;
    this.loose.set(gem.id, gem);
    this.equipped.delete(slot);
    this.onChanged();
    return gem;
  }

  /** Source quirk: Drop on an equipped Gem confirms and rebuilds but mutates nothing. */
  drop(id: InventoryItemId): boolean {
    if ([...this.equipped.values()].some((gem) => gem.id === id)) return false;
    return this.removeLoose(id) !== undefined;
  }

  stateSnapshot(): PlayerInventoryStateV1 {
    return Object.freeze({
      schemaVersion: 1,
      nextItemSequence: this.nextSequence,
      looseItems: Object.freeze(this.looseItems().map(cloneItem)),
      equippedGems: Object.freeze(Object.fromEntries(
        [...this.equipped].map(([slot, gem]) => [slot, cloneItem(gem)]),
      )),
    });
  }

  private allocateId(): InventoryItemId {
    const id = `item-${this.nextSequence}`;
    this.nextSequence += 1;
    return id;
  }

  private add(item: PlayerInventoryItem): PlayerInventoryItem {
    const frozen = freezeValidatedItem(item);
    this.loose.set(frozen.id, frozen);
    this.onChanged();
    return frozen;
  }
}

export function emptyPlayerInventoryState(): PlayerInventoryStateV1 {
  return Object.freeze({
    schemaVersion: 1,
    nextItemSequence: 1,
    looseItems: Object.freeze([]),
    equippedGems: Object.freeze({}),
  });
}

/** Deterministic one-way migration from the port's old counters/encoded reward bag. */
export function migrateLegacyInventory(
  captureCards: Readonly<Record<1 | 2 | 3, number>>,
  legacyItems: Readonly<Record<string, number>>,
): PlayerInventoryStateV1 {
  const inventory = new PlayerInventory();
  const cardDefs = {
    1: ["Usables.Card", "Card"],
    2: ["Usables.CardSilver", "CardSilver"],
    3: ["Usables.CardGold", "CardGold"],
  } as const;
  for (const level of [1, 2, 3] as const) {
    requireCount(captureCards[level], `capture card ${level}`);
    for (let index = 0; index < captureCards[level]; index += 1) {
      inventory.addUsable(cardDefs[level][0], cardDefs[level][1], level);
    }
  }
  for (const key of Object.keys(legacyItems).sort()) {
    const count = legacyItems[key]!;
    requireCount(count, key);
    for (let index = 0; index < count; index += 1) {
      if (key === "Egg") {
        inventory.addLegacyItem(key);
      } else if (key === "MonsterEgg") {
        inventory.addLegacyItem(key);
      } else {
        inventory.addLegacyItem(key);
      }
    }
  }
  return inventory.stateSnapshot();
}

export function gemBonusForStat(
  gem: Pick<GemInventoryItem, "level" | "enabledStats">,
  stat: PlayerStatName,
): number {
  if (!gem.enabledStats.includes(stat)) return 0;
  return Math.fround(Math.fround(gem.level) * Math.fround(
    stat === "Defense" || stat === "Resist" ? 1.5 : 1,
  ));
}

function parseLegacyGemKey(key: string): Omit<GemInventoryItem, "id" | "instanceName"> | undefined {
  const match = /^GemLevel:(\d+):Quality:(\d+):Slot:([0-3]):Stats:([A-Za-z,]*)$/.exec(key);
  if (match === null) return undefined;
  const level = Number(match[1]);
  const quality = Number(match[2]);
  const slot = Number(match[3]) as GemSlot;
  const enabledStats = match[4] === "" ? [] : match[4]!.split(",");
  for (const stat of enabledStats) {
    if (!GEM_STATS.includes(stat as PlayerStatName)) {
      throw new Error(`PlayerInventory: legacy Gem has unknown stat ${stat}`);
    }
  }
  return {
    kind: "gem",
    definitionPath: [
      "Gems.RandomNovice", "Gems.RandomVeteran", "Gems.RandomElite", "Gems.RandomGrandmaster",
    ][slot]!,
    level,
    quality,
    slot,
    enabledStats: enabledStats as PlayerStatName[],
  };
}

function freezeValidatedItem(raw: PlayerInventoryItem): PlayerInventoryItem {
  requireName(raw.id, "item id");
  requireName(raw.definitionPath, "definition path");
  requireName(raw.instanceName, "instance name");
  switch (raw.kind) {
    case "usable":
      requirePositiveInteger(raw.level, "usable level");
      return Object.freeze({ ...raw });
    case "egg":
      return Object.freeze({ ...raw });
    case "gem":
      requirePositiveInteger(raw.level, "gem level");
      requireGemSlot(raw.slot);
      if (!Number.isSafeInteger(raw.quality) || raw.quality < 0) {
        throw new Error(`PlayerInventory: invalid gem quality ${raw.quality}`);
      }
      for (const stat of raw.enabledStats) {
        if (!GEM_STATS.includes(stat)) throw new Error(`PlayerInventory: unknown Gem stat ${stat}`);
      }
      if (new Set(raw.enabledStats).size !== raw.enabledStats.length) {
        throw new Error(`PlayerInventory: duplicate Gem stat on ${raw.id}`);
      }
      return Object.freeze({ ...raw, enabledStats: Object.freeze([...raw.enabledStats]) });
  }
}

function cloneItem(item: PlayerInventoryItem): PlayerInventoryItem {
  return item.kind === "gem"
    ? Object.freeze({ ...item, enabledStats: Object.freeze([...item.enabledStats]) })
    : Object.freeze({ ...item });
}

function requireGemSlot(value: number): asserts value is GemSlot {
  if (!Number.isSafeInteger(value) || value < 0 || value > 3) {
    throw new Error(`PlayerInventory: invalid Gem slot ${value}`);
  }
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`PlayerInventory: ${label} must be a positive integer; got ${value}`);
  }
}

function requireCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`PlayerInventory: ${label} count must be a nonnegative integer; got ${value}`);
  }
}

function requireSequence(value: number): void {
  requirePositiveInteger(value, "next item sequence");
}

function requireName(value: string, label: string): void {
  if (value.length === 0) throw new Error(`PlayerInventory: ${label} must not be empty`);
}

function sequenceFromId(id: string): number {
  const match = /^item-(\d+)$/.exec(id);
  return match === null ? 0 : Number(match[1]);
}

function lastSegment(path: string): string {
  const separator = path.lastIndexOf(".");
  return separator < 0 ? path : path.slice(separator + 1);
}

function legacyKeyForItem(item: Exclude<PlayerInventoryItem, UsableInventoryItem>): string {
  if (item.kind === "egg") return item.instanceName;
  return `GemLevel:${item.level}:Quality:${item.quality}:Slot:${item.slot}:Stats:${item.enabledStats.join(",")}`;
}
