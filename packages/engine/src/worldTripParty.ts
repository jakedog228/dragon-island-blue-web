


import type { GameData, StatName } from "@dib/gamedata";
import type {
  PlayerBattleTerminalSnapshot,
  SoulStoneSetup,
  TeamMemberSetup,
} from "./events.js";
import { soulStoneBonusForStat, soulStoneMintLevel } from "./soulStone.js";
import { monsterStat, monsterStats, type MonsterStatChildren } from "./stats.js";
import { jobLevelAfterAward, jobXpCostOfNextLevel, jobXpForLevel } from "./xp.js";

const MAX_LEVEL = 150;
const SAVE_ME_GOLD_COST = 100;
const STAT_NAMES: readonly StatName[] = [
  "MaxHP", "Attack", "Magic", "Speed", "Defense", "Resist",
];


export type PlayerBuffBonuses = Readonly<Partial<Record<StatName, number>>>;


export type PlayerBuffSource = () => PlayerBuffBonuses;

const NO_PLAYER_BUFFS: PlayerBuffBonuses = Object.freeze({});

export interface SaveMeEligibilityInput {
  readonly blockSaveMe: boolean;
  readonly tutorialSeen: boolean;
  readonly heroLevel: number;
  readonly gold: number;
}


export function canOfferSaveMe(input: SaveMeEligibilityInput): boolean {
  return (
    !input.blockSaveMe &&
    input.heroLevel >= 6 &&
    (input.tutorialSeen || input.gold >= SAVE_ME_GOLD_COST)
  );
}

export interface PlayerMonsterInstance {
  instanceId: string;
  shortType: string;
  level: number;
  cumulativeXp: number;
  currentHp: number;
  injureTime?: number;
  healTime?: number;
  soulStone?: SoulStoneSetup;
}

export interface CapturedMonsterSetup {
  instanceId: string;
  shortType: string;
  level: number;
}

export interface XpAwardResult {
  instanceId: string;
  previousLevel: number;
  level: number;
  previousMaxHp: number;
  maxHp: number;
  currentHp: number;
  cumulativeXp: number;
}

export interface CombineMonsterResult {
  readonly monster: PlayerMonsterInstance;
  readonly consumed: readonly [PlayerMonsterInstance, PlayerMonsterInstance];
}

export interface WorldTripPartyOrdering {
  readonly battingOrderSlotIds: readonly (string | null)[];
  readonly reserveOrderIds: readonly string[];
}

export interface WorldTripPartyStateSnapshotV1 {
  readonly schemaVersion: 1;
  readonly battingOrderSize: number;
  /** Durable bench order. Its prefix is the batting order; there is no parallel active count. */
  readonly monsters: readonly PlayerMonsterInstance[];
  readonly ownedSoulStones: readonly SoulStoneSetup[];
}

export interface OwnedSoulStoneEntry {
  readonly token: string;
  readonly stone: SoulStoneSetup;
}


export interface CombineMonsterQuestEvent {
  readonly eventId: 8;
  readonly target1: PlayerMonsterInstance;
  readonly target2: PlayerMonsterInstance;
}

function cloneSoulStone(stone: SoulStoneSetup | undefined): SoulStoneSetup | undefined {
  return stone === undefined
    ? undefined
    : {
        element: stone.element,
        level: stone.level,
        ...(stone.sourceType === undefined ? {} : { sourceType: stone.sourceType }),
      };
}

function cloneMonster(monster: PlayerMonsterInstance): PlayerMonsterInstance {
  return {
    instanceId: monster.instanceId,
    shortType: monster.shortType,
    level: monster.level,
    cumulativeXp: monster.cumulativeXp,
    currentHp: monster.currentHp,
    ...(monster.injureTime === undefined ? {} : { injureTime: monster.injureTime }),
    ...(monster.healTime === undefined ? {} : { healTime: monster.healTime }),
    ...(monster.soulStone === undefined ? {} : { soulStone: cloneSoulStone(monster.soulStone)! }),
  };
}


export class WorldTripParty {
  private readonly members: PlayerMonsterInstance[];
  /** Unequipped owned soul stones (`Player.soulStones`) — the Insert Soul Stone picker's pool and
   * the Convert To Soul Stone sink. Empty by default, exactly as the original starts you (its own
   * "No Soul Stones" copy tells you to convert a monster first). */
  private readonly stones: Array<{ token: string; stone: SoulStoneSetup }>;
  private nextStoneToken = 0;
  private battingOrderSizeValue: number;


  private readonly playerBuffsById = new Map<string, PlayerBuffBonuses>();
  private playerBuffSource: PlayerBuffSource = () => NO_PLAYER_BUFFS;

  constructor(
    private readonly data: GameData,
    monsters: readonly PlayerMonsterInstance[],
    battingOrderSize: number,
    ownedSoulStones: readonly SoulStoneSetup[] = [],


    legacyBattingOrderLength: number = Math.min(battingOrderSize, monsters.length),
    ordering?: WorldTripPartyOrdering,
  ) {
    if (!Number.isInteger(battingOrderSize) || battingOrderSize < 0) {
      throw new Error(`WorldTripParty: battingOrderSize must be a non-negative integer; got ${battingOrderSize}`);
    }
    this.battingOrderSizeValue = battingOrderSize;
    const ids = new Set<string>();
    this.members = monsters.map((monster) => {
      if (monster.instanceId.length === 0) {
        throw new Error("WorldTripParty: instanceId must not be empty");
      }
      if (ids.has(monster.instanceId)) {
        throw new Error(`WorldTripParty: duplicate instanceId ${monster.instanceId}`);
      }
      ids.add(monster.instanceId);
      this.validateLevelAndXp(monster.shortType, monster.level, monster.cumulativeXp);
      this.validateInjury(monster);
      this.validateSoulStone(monster.soulStone);
      const copy = cloneMonster(monster);
      this.validateHp(copy.currentHp, `${copy.instanceId} currentHp`, true);
      return copy;
    });
    this.stones = ownedSoulStones.map((stone) => {
      this.validateSoulStone(stone);
      return {
        token: this.allocateStoneToken(),
        stone: cloneSoulStone(stone)!,
      };
    });
    const maximumBattingLength = Math.min(this.battingOrderSize, this.members.length);
    if (
      !Number.isInteger(legacyBattingOrderLength) ||
      legacyBattingOrderLength < 0 ||
      legacyBattingOrderLength > maximumBattingLength
    ) {
      throw new Error(
        `WorldTripParty: battingOrderLength must be an integer in [0, ${maximumBattingLength}]; got ${legacyBattingOrderLength}`,
      );
    }
    // Short-lived schema-3 builds persisted session holes. Accept those snapshots once, validate
    // them strictly, and compact them into the native durable representation on load.
    if (ordering !== undefined) this.importLegacyOrdering(ordering, ids);
  }


  setPlayerBuffSource(source: PlayerBuffSource): void {
    this.playerBuffSource = source;
    const bonuses = this.readPlayerBuffs();
    for (const member of this.members) this.playerBuffsById.set(member.instanceId, bonuses);
  }

  /** The permanent player buffs currently attached to one member (its live Buff children). */
  playerBuffsOf(instanceId: string): PlayerBuffBonuses {
    this.memberOrThrow(instanceId);
    return this.playerBuffsById.get(instanceId) ?? NO_PLAYER_BUFFS;
  }


  fullRestoreAndReapplyPermanentBuffs(): void {
    this.applyPlayerBuffsToMonsters(this.members);
  }


  private applyPlayerBuffsToMonster(member: PlayerMonsterInstance): void {
    this.applyPlayerBuffsToMonsters([member]);
  }

  private applyPlayerBuffsToMonsters(members: readonly PlayerMonsterInstance[]): void {
    // The native method reads the providers ONCE per call (the `skillValueForStat:` prologue loop
    // and a single `gemsInLicense` enumeration), then applies the same values to every monster.
    const bonuses = this.readPlayerBuffs();
    for (const member of members) {
      this.playerBuffsById.set(member.instanceId, bonuses);
      // Third loop of applyPlayerBuffsToMonsters:: `adjustHP:[valueForCachedStat:0]` AFTER the
      // buffs are attached, so the heal target is the buff-inclusive MaxHP. Reviving a
      // zero-HP member here is native: the clamp lets the adjustment run from 0.
      member.currentHp = this.maxHpOfState(member);
    }
  }

  private readPlayerBuffs(): PlayerBuffBonuses {
    const raw = this.playerBuffSource();
    const bonuses: Partial<Record<StatName, number>> = {};
    for (const stat of STAT_NAMES) {
      const bonus = raw[stat];
      if (bonus === undefined || bonus === 0) continue;
      if (!Number.isFinite(bonus)) {
        throw new Error(`WorldTripParty: player buff ${stat} must be finite; got ${String(bonus)}`);
      }
      bonuses[stat] = bonus;
    }
    return Object.freeze(bonuses);
  }

  monsters(): readonly PlayerMonsterInstance[] {
    return this.members.map(cloneMonster);
  }

  stateSnapshot(): WorldTripPartyStateSnapshotV1 {
    return {
      schemaVersion: 1,
      battingOrderSize: this.battingOrderSize,
      monsters: this.monsters(),
      ownedSoulStones: this.ownedSoulStoneEntries().map(({ stone }) => stone),
    };
  }

  static fromStateSnapshot(
    data: GameData,
    snapshot: WorldTripPartyStateSnapshotV1,
  ): WorldTripParty {
    if (snapshot.schemaVersion !== 1) {
      throw new Error(`WorldTripParty: unsupported snapshot schema ${String(snapshot.schemaVersion)}`);
    }
    if (!Array.isArray(snapshot.monsters) || !Array.isArray(snapshot.ownedSoulStones)) {
      throw new Error("WorldTripParty: malformed state snapshot");
    }
    return new WorldTripParty(
      data,
      snapshot.monsters,
      snapshot.battingOrderSize,
      snapshot.ownedSoulStones,
    );
  }

  monster(instanceId: string): PlayerMonsterInstance {
    return cloneMonster(this.memberOrThrow(instanceId));
  }

  maxHpOf(instanceId: string): number {
    return this.maxHpOfState(this.memberOrThrow(instanceId));
  }

  /**
   * Effective Living stats for one bench member — species/level, equipped stone, and the
   * permanent hero-skill/Gem buff children, accumulated in `valueForCachedStat:` order.
   *
   * Info cards, ability-description contexts, and projections MUST read stats from here rather
   * than recombining `baseStat` with their own child terms: the buff children are private to this
   * aggregate precisely so a second, slightly different formula cannot drift away from the one a
   * battle will use.
   */
  statsOf(instanceId: string): Record<StatName, number> {
    const member = this.memberOrThrow(instanceId);
    return monsterStats(
      this.data.monsterByShortType(member.shortType),
      member.level,
      this.statChildren(member.soulStone, this.playerBuffsById.get(member.instanceId)),
    );
  }

  /** Native alive-filtered durable projection: scan the compact priority prefix, then filter. */
  projectAliveBattingPrefix(): TeamMemberSetup[] {
    return this.members
      .slice(0, this.battingOrderLength())
      .filter((monster) => monster.currentHp > 0 && monster.injureTime === undefined)
      .map((monster) => {
        const playerBuffs = this.playerBuffsById.get(monster.instanceId);
        return {
          shortType: monster.shortType,
          level: monster.level,
          currentHp: monster.currentHp,
          sourceInstanceId: monster.instanceId,
          // `Encounter.initWithArguments:` reuses the player's Monster objects, buff children and
          // all. Projecting them keeps the battle's MaxHP identical to this aggregate's.
          ...(playerBuffs === undefined || Object.keys(playerBuffs).length === 0
            ? {}
            : { playerBuffs: { ...playerBuffs } }),
          ...(monster.soulStone === undefined ? {} : { soulStone: cloneSoulStone(monster.soulStone)! }),
        };
      });
  }

  /** Commit the mutable Monster state battle teardown carries into the next encounter. */
  commitBattleSnapshot(snapshot: PlayerBattleTerminalSnapshot): void {
    for (const [instanceId, terminal] of Object.entries(snapshot)) {
      const member = this.memberOrThrow(instanceId);
      this.validateSoulStone(terminal.soulStone);
      const nextStone = cloneSoulStone(terminal.soulStone);
      this.validateHp(terminal.currentHp, `${instanceId} terminal currentHp`, true);
      member.currentHp = terminal.currentHp;
      if (nextStone === undefined) delete member.soulStone;
      else member.soulStone = nextStone;
      // A member that left its Team mid-battle went through `notifyLeftBattleFromTeam:`'s
      // `removeBuffsIncludingPermanent:YES`, which destroys the permanent player-skill/Gem
      // children too; survivors are only unregistered by `-[Team notifyDestroyed]` and keep
      // theirs. The next application site (town, Save Me, equip, bench add) rebuilds them.
      if (terminal.leftBattle) this.playerBuffsById.delete(instanceId);
    }
  }

  /** Apply one participant's post-battle XP and native alive-only MaxHP-delta heal. */
  awardXp(instanceId: string, amount: number): XpAwardResult {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new Error(`WorldTripParty.awardXp: amount must be a non-negative safe integer; got ${amount}`);
    }
    const member = this.memberOrThrow(instanceId);
    const previousLevel = member.level;
    const previousMaxHp = this.maxHpOfState(member);
    const cumulativeXp = member.cumulativeXp + amount;
    if (!Number.isSafeInteger(cumulativeXp)) {
      throw new Error(`WorldTripParty.awardXp: cumulative XP overflow for ${instanceId}`);
    }
    const level = jobLevelAfterAward(
      previousLevel,
      cumulativeXp,
      this.data.jobXpPenalty(member.shortType),
    );
    member.cumulativeXp = cumulativeXp;
    member.level = level;
    const maxHp = this.maxHpOfState(member);
    if (member.currentHp > 0) {
      member.currentHp = Math.min(maxHp, member.currentHp + (maxHp - previousMaxHp));
    }
    return {
      instanceId,
      previousLevel,
      level,
      previousMaxHp,
      maxHp,
      currentHp: member.currentHp,
      cumulativeXp,
    };
  }

  get battingOrderSize(): number {
    return this.battingOrderSizeValue;
  }


  setBattingOrderSize(size: number): void {
    if (!Number.isSafeInteger(size) || size < 1) {
      throw new Error(`WorldTripParty: battingOrderSize must be a positive safe integer; got ${size}`);
    }
    this.battingOrderSizeValue = size;
  }


  feedOneLevel(instanceId: string): XpAwardResult {
    const member = this.memberOrThrow(instanceId);
    if (member.level > 149) {
      throw new Error(`WorldTripParty.feedOneLevel: ${instanceId} is already level ${member.level}`);
    }
    const previousLevel = member.level;
    const previousMaxHp = this.maxHpOfState(member);
    const penalty = this.data.jobXpPenalty(member.shortType);
    const amount = jobXpCostOfNextLevel(previousLevel, penalty);
    const cumulativeXp = member.cumulativeXp + amount;
    if (!Number.isSafeInteger(cumulativeXp)) {
      throw new Error(`WorldTripParty.feedOneLevel: cumulative XP overflow for ${instanceId}`);
    }
    member.cumulativeXp = cumulativeXp;
    member.level = previousLevel + 1;
    const floor = jobXpForLevel(member.level, penalty);
    if (member.cumulativeXp < floor) member.cumulativeXp = floor;
    const maxHp = this.maxHpOfState(member);
    return {
      instanceId,
      previousLevel,
      level: member.level,
      previousMaxHp,
      maxHp,
      currentHp: member.currentHp,
      cumulativeXp: member.cumulativeXp,
    };
  }


  addCapturedMonster(setup: CapturedMonsterSetup): PlayerMonsterInstance {
    if (this.members.some((member) => member.instanceId === setup.instanceId)) {
      throw new Error(`WorldTripParty: duplicate instanceId ${setup.instanceId}`);
    }
    this.validateLevel(setup.level);
    this.data.monsterByShortType(setup.shortType);
    const cumulativeXp = jobXpForLevel(setup.level, this.data.jobXpPenalty(setup.shortType));
    const captured: PlayerMonsterInstance = {
      instanceId: setup.instanceId,
      shortType: setup.shortType,
      level: setup.level,
      cumulativeXp,
      currentHp: 0,
    };
    this.members.push(captured);
    // `addBenchMonster:atIndex:silently:`'s tail: attach the player's permanent buff children,
    // then heal to the buff-inclusive MaxHP. This is the acquisition's full-HP spawn.
    this.applyPlayerBuffsToMonster(captured);
    return cloneMonster(captured);
  }

  /** Source combine transaction: append a fresh full-HP level-1 result, emit quest event 8 while
   * all three objects coexist, then remove authored ingredient slot 1 followed by slot 2. The
   * result is appended at the back of the bench; whether that is a lineup slot or a reserve is
   * decided by the derived prefix, so consuming active ingredients can pull it straight in. */
  combineMonsters(
    resultInstanceId: string,
    resultShortType: string,
    firstIngredientId: string,
    secondIngredientId: string,
    onQuestEvent?: (event: CombineMonsterQuestEvent) => void,
  ): CombineMonsterResult {
    if (resultInstanceId.length === 0) {
      throw new Error("WorldTripParty.combineMonsters: result instanceId must not be empty");
    }
    if (this.members.some((member) => member.instanceId === resultInstanceId)) {
      throw new Error(`WorldTripParty.combineMonsters: duplicate result instanceId ${resultInstanceId}`);
    }
    if (firstIngredientId === secondIngredientId) {
      throw new Error("WorldTripParty.combineMonsters: ingredient instances must be distinct");
    }
    const recipe = this.data.combineRecipe(resultShortType);
    const first = this.memberOrThrow(firstIngredientId);
    const second = this.memberOrThrow(secondIngredientId);
    if (first.shortType !== recipe.ingredients[0]) {
      throw new Error(
        `WorldTripParty.combineMonsters: first ingredient for ${resultShortType} must be ` +
          `${recipe.ingredients[0]}; got ${first.shortType}`,
      );
    }
    if (second.shortType !== recipe.ingredients[1]) {
      throw new Error(
        `WorldTripParty.combineMonsters: second ingredient for ${resultShortType} must be ` +
          `${recipe.ingredients[1]}; got ${second.shortType}`,
      );
    }

    const level = 1;
    const monster: PlayerMonsterInstance = {
      instanceId: resultInstanceId,
      shortType: resultShortType,
      level,
      cumulativeXp: jobXpForLevel(level, this.data.jobXpPenalty(resultShortType)),
      currentHp: 0,
    };
    const consumed: [PlayerMonsterInstance, PlayerMonsterInstance] = [
      cloneMonster(first),
      cloneMonster(second),
    ];

    this.members.push(monster);
    // The combine result reaches the bench through `addBenchMonster:`, so it spawns with the
    // player's buff children attached and at the resulting (buff-inclusive) full HP.
    this.applyPlayerBuffsToMonster(monster);
    try {
      onQuestEvent?.({
        eventId: 8,
        target1: cloneMonster(consumed[0]),
        target2: cloneMonster(consumed[1]),
      });
    } catch (error) {
      // A future quest adapter is outside the party aggregate and may fail. Since its callback
      // occurs before either authored removal, undo the sole mutation made so far and rethrow;
      // callers never observe a half-combined durable roster.
      const resultIndex = this.members.findIndex((candidate) => candidate.instanceId === resultInstanceId);
      if (resultIndex >= 0) this.members.splice(resultIndex, 1);
      this.playerBuffsById.delete(resultInstanceId);
      throw error;
    }
    this.removeCombinedIngredient(firstIngredientId, "first");
    this.removeCombinedIngredient(secondIngredientId, "second");
    return {
      monster: cloneMonster(monster),
      consumed: [cloneMonster(consumed[0]), cloneMonster(consumed[1])],
    };
  }


  evolve(instanceId: string): PlayerMonsterInstance {
    const member = this.memberOrThrow(instanceId);
    const evolution = this.data.monsterByShortType(member.shortType).evolveData;
    if (evolution === undefined) {
      throw new Error(`WorldTripParty.evolve: ${member.shortType} has no evolution`);
    }
    if (member.level < evolution.levelReq) {
      throw new Error(
        `WorldTripParty.evolve: ${member.shortType} requires level ${evolution.levelReq}; got ${member.level}`,
      );
    }
    this.data.monsterByShortType(evolution.newType);
    member.shortType = evolution.newType;
    member.cumulativeXp = jobXpForLevel(
      member.level,
      this.data.jobXpPenalty(evolution.newType),
    );
    this.applyPlayerBuffsToMonster(member);
    delete member.injureTime;
    delete member.healTime;
    return cloneMonster(member);
  }


  applySaveMeRecovery(): void {
    for (const member of this.members) {
      delete member.injureTime;
      delete member.healTime;
    }
    this.fullRestoreAndReapplyPermanentBuffs();
  }


  restoreAtTown(now: number): void {
    if (!Number.isFinite(now)) {
      throw new Error(`WorldTripParty.restoreAtTown: now must be finite; got ${now}`);
    }
    this.purgeExpiredInjuries(now);
    this.fullRestoreAndReapplyPermanentBuffs();
  }


  purgeExpiredInjuries(nowSeconds: number): boolean {
    if (!Number.isFinite(nowSeconds)) {
      throw new Error(`WorldTripParty.purgeExpiredInjuries: nowSeconds must be finite; got ${nowSeconds}`);
    }
    let changed = false;
    for (const member of this.members) {
      if (member.healTime === undefined || member.healTime > nowSeconds) continue;
      delete member.injureTime;
      delete member.healTime;
      changed = true;
    }
    return changed;
  }


  injuryHealCost(instanceId: string, nowSeconds: number): number {
    if (!Number.isFinite(nowSeconds)) {
      throw new Error(`WorldTripParty.injuryHealCost: nowSeconds must be finite; got ${nowSeconds}`);
    }
    const member = this.memberOrThrow(instanceId);
    if (member.injureTime === undefined || member.healTime === undefined) {
      throw new Error(`WorldTripParty.injuryHealCost: ${instanceId} is not injured`);
    }
    const duration = member.healTime - member.injureTime;
    if (duration <= 0) return 25;
    const remaining = 1 - (nowSeconds - member.injureTime) / duration;
    const proportional = Math.trunc(member.level * remaining);
    return Math.max(25, Math.trunc(Math.max(proportional, member.level * 0.1)));
  }

  healInjury(instanceId: string): void {
    const member = this.memberOrThrow(instanceId);
    if (member.injureTime === undefined || member.healTime === undefined) {
      throw new Error(`WorldTripParty.healInjury: ${instanceId} is not injured`);
    }
    delete member.injureTime;
    delete member.healTime;
  }

  /** The unequipped owned soul-stone pool, in acquisition order (newest last), as the Insert
   * Soul Stone picker lists it. */
  ownedSoulStones(): readonly SoulStoneSetup[] {
    return this.stones.map(({ stone }) => cloneSoulStone(stone)!);
  }

  /** Runtime-stable identity for asynchronous/paged inventory selection. */
  ownedSoulStoneEntries(): readonly OwnedSoulStoneEntry[] {
    return this.stones.map(({ token, stone }) => ({
      token,
      stone: cloneSoulStone(stone)!,
    }));
  }


  dropSoulStoneByToken(token: string): SoulStoneSetup {
    const index = this.stones.findIndex((entry) => entry.token === token);
    if (index < 0) {
      throw new Error(`WorldTripParty.dropSoulStoneByToken: unknown or stale token ${token}`);
    }
    const [dropped] = this.stones.splice(index, 1);
    return cloneSoulStone(dropped!.stone)!;
  }


  battingOrderLength(): number {
    return Math.min(this.battingOrderSize, this.members.length);
  }

  battingOrderMonsters(): readonly PlayerMonsterInstance[] {
    return this.members.slice(0, this.battingOrderLength()).map(cloneMonster);
  }

  /** Packed durable prefix projected into the editor's fixed-capacity opening snapshot. */
  battingOrderSlots(): readonly (PlayerMonsterInstance | undefined)[] {
    const active = this.battingOrderLength();
    return Array.from(
      { length: this.battingOrderSize },
      (_, index) => index < active ? cloneMonster(this.members[index]!) : undefined,
    );
  }

  battingOrderSlotIds(): readonly (string | null)[] {
    return this.battingOrderSlots().map((member) => member?.instanceId ?? null);
  }

  reserveMonsters(): readonly PlayerMonsterInstance[] {
    return this.members.slice(this.battingOrderLength()).map(cloneMonster);
  }

  reserveOrderIds(): readonly string[] {
    return this.members.slice(this.battingOrderLength()).map((member) => member.instanceId);
  }

  battingOrderFreeSpace(): number {
    return this.battingOrderSize - this.battingOrderLength();
  }

  /**
   * Durable compact reorder helper. Editable MonsterManagement uses PartyEditorSession instead;
   * its fixed nullable moves are committed through `commitBattingPriority`.
   */
  moveBattingOrderMember(fromIndex: number, toIndex: number): void {
    const active = this.battingOrderLength();
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= active) {
      throw new Error(
        `WorldTripParty.moveBattingOrderMember: fromIndex out of range [0, ${active}); got ${fromIndex}`,
      );
    }
    if (!Number.isInteger(toIndex)) {
      throw new Error(`WorldTripParty.moveBattingOrderMember: toIndex must be an integer; got ${toIndex}`);
    }
    const target = Math.min(active - 1, Math.max(0, toIndex));
    if (target === fromIndex) return;
    const [moved] = this.members.splice(fromIndex, 1);
    this.members.splice(target, 0, moved!);
  }

  /**
   * Direct durable transfer helper; the editor stages this operation in PartyEditorSession.
   *
   * Relocation only: the prefix length is derived, so demoting a member while the lineup has free
   * slots simply moves it to the back of the bench and the lineup keeps covering it — the source
   * has no way to leave an active slot empty while any member is benched.
   */
  moveBattingOrderMemberToReserves(fromIndex: number, reserveIndex: number): void {
    const active = this.battingOrderLength();
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= active) {
      throw new Error(
        `WorldTripParty.moveBattingOrderMemberToReserves: fromIndex out of range [0, ${active}); got ${fromIndex}`,
      );
    }
    if (!Number.isInteger(reserveIndex)) {
      throw new Error(
        `WorldTripParty.moveBattingOrderMemberToReserves: reserveIndex must be an integer; got ${reserveIndex}`,
      );
    }
    const [moved] = this.members.splice(fromIndex, 1);
    const remainingActive = Math.min(this.battingOrderSize, this.members.length);
    const reserveLength = this.members.length - remainingActive;
    const boundary = Math.min(reserveLength, Math.max(0, reserveIndex));
    this.members.splice(remainingActive + boundary, 0, moved!);
  }

  /**
   * Direct durable transfer helper; the editor stages fixed-slot insertion separately. Promoting a
   * reserve pushes whichever member falls off the end of the derived prefix into the reserves — the
   * lineup is a positional window, so a promotion is always a swap rather than a free insertion.
   */
  moveReserveMemberToBattingOrder(reserveIndex: number, battingIndex: number): void {
    const active = this.battingOrderLength();
    if (active === 0) {
      throw new Error("WorldTripParty.moveReserveMemberToBattingOrder: the batting order has no slots");
    }
    const reserveLength = this.members.length - active;
    if (!Number.isInteger(reserveIndex) || reserveIndex < 0 || reserveIndex >= reserveLength) {
      throw new Error(
        `WorldTripParty.moveReserveMemberToBattingOrder: reserveIndex out of range [0, ${reserveLength}); got ${reserveIndex}`,
      );
    }
    if (!Number.isInteger(battingIndex)) {
      throw new Error(
        `WorldTripParty.moveReserveMemberToBattingOrder: battingIndex must be an integer; got ${battingIndex}`,
      );
    }
    const sourceIndex = active + reserveIndex;
    const [moved] = this.members.splice(sourceIndex, 1);
    const target = Math.min(active - 1, Math.max(0, battingIndex));
    this.members.splice(target, 0, moved!);
  }

  /** Direct durable helper; editable reserve sorting remains session-local. */
  sortReserves(compare: (a: PlayerMonsterInstance, b: PlayerMonsterInstance) => number): void {
    const active = this.battingOrderLength();
    const sorted = this.members
      .slice(active)
      .map(cloneMonster)
      .sort(compare);
    this.members.splice(active, sorted.length, ...sorted);
  }


  commitBattingPriority(activeIds: readonly string[]): void {
    if (activeIds.length > this.battingOrderSize) {
      throw new Error(
        `WorldTripParty.commitBattingPriority: ${activeIds.length} active IDs exceed capacity ${this.battingOrderSize}`,
      );
    }
    const currentById = new Map(this.members.map((member) => [member.instanceId, member] as const));
    const seen = new Set<string>();
    const active: PlayerMonsterInstance[] = [];
    for (const id of activeIds) {
      if (seen.has(id)) {
        throw new Error(`WorldTripParty.commitBattingPriority: duplicate instanceId ${id}`);
      }
      const member = currentById.get(id);
      if (member === undefined) {
        throw new Error(`WorldTripParty.commitBattingPriority: unknown instanceId ${id}`);
      }
      seen.add(id);
      active.push(member);
    }
    const nonactive = this.members.filter((member) => !seen.has(member.instanceId));
    this.members.splice(0, this.members.length, ...active, ...nonactive);
  }


  destroyMonster(instanceId: string): PlayerMonsterInstance {
    if (this.members.length < 2) {
      throw new Error("WorldTripParty.destroyMonster: cannot destroy the party's last member");
    }
    const index = this.members.findIndex((candidate) => candidate.instanceId === instanceId);
    if (index === -1) throw new Error(`WorldTripParty.destroyMonster: unknown instanceId ${instanceId}`);
    const [destroyed] = this.members.splice(index, 1);
    this.playerBuffsById.delete(instanceId);
    return cloneMonster(destroyed!);
  }


  convertToSoulStone(instanceId: string): SoulStoneSetup {
    if (this.members.length < 2) {
      throw new Error("WorldTripParty.convertToSoulStone: cannot sacrifice the party's last member");
    }
    const index = this.members.findIndex((candidate) => candidate.instanceId === instanceId);
    if (index === -1) throw new Error(`WorldTripParty.convertToSoulStone: unknown instanceId ${instanceId}`);
    const member = this.members[index]!;
    const monster = this.data.monsterByShortType(member.shortType);
    const stone: SoulStoneSetup = {
      element: monster.element,
      level: soulStoneMintLevel(monster.stars, member.level),
      sourceType: member.shortType,
    };
    this.validateSoulStone(stone);
    this.members.splice(index, 1);
    this.playerBuffsById.delete(instanceId);
    this.stones.push({
      token: this.allocateStoneToken(),
      stone: cloneSoulStone(stone)!,
    });
    return cloneSoulStone(stone)!;
  }


  insertSoulStone(instanceId: string, stoneIndex: number): void {
    if (!Number.isInteger(stoneIndex) || stoneIndex < 0 || stoneIndex >= this.stones.length) {
      throw new Error(`WorldTripParty.insertSoulStone: stoneIndex out of range [0, ${this.stones.length}); got ${stoneIndex}`);
    }
    this.insertSoulStoneByToken(instanceId, this.stones[stoneIndex]!.token);
  }

  insertSoulStoneByToken(instanceId: string, token: string): void {
    const member = this.memberOrThrow(instanceId);
    const stoneIndex = this.stones.findIndex((entry) => entry.token === token);
    if (stoneIndex < 0) {
      throw new Error(`WorldTripParty.insertSoulStoneByToken: unknown or stale token ${token}`);
    }
    const [entry] = this.stones.splice(stoneIndex, 1);
    // Overwrite drops any previous stone with no path back to the pool — the source's destroy.
    // `equipItem:` removes/destroys the old child first. `Living.removeChild:` clears cached stats
    // but leaves HP unchanged, so the subsequent add compares against stone-free MaxHP.
    member.soulStone = entry!.stone;


    const definition = this.data.soulStoneByElement(entry!.stone.element);
    const maxHpBonus = soulStoneBonusForStat(
      entry!.stone.level,
      definition.enabledStats,
      "MaxHP",
    );
    if (maxHpBonus !== 0) member.currentHp = Math.max(1, member.currentHp + maxHpBonus);
  }

  private memberOrThrow(instanceId: string): PlayerMonsterInstance {
    const member = this.members.find((candidate) => candidate.instanceId === instanceId);
    if (member === undefined) throw new Error(`WorldTripParty: unknown instanceId ${instanceId}`);
    return member;
  }

  private removeCombinedIngredient(instanceId: string, slot: "first" | "second"): void {
    const index = this.members.findIndex((candidate) => candidate.instanceId === instanceId);
    if (index < 0) {
      throw new Error(`WorldTripParty.combineMonsters: lost ${slot} ingredient ${instanceId}`);
    }
    this.members.splice(index, 1);
    this.playerBuffsById.delete(instanceId);
  }

  private importLegacyOrdering(
    ordering: WorldTripPartyOrdering,
    memberIds: ReadonlySet<string>,
  ): void {
    if (ordering.battingOrderSlotIds.length !== this.battingOrderSize) {
      throw new Error(
        `WorldTripParty: battingOrderSlotIds length ${ordering.battingOrderSlotIds.length} != capacity ${this.battingOrderSize}`,
      );
    }
    const ordered = [
      ...ordering.battingOrderSlotIds.filter((id): id is string => id !== null),
      ...ordering.reserveOrderIds,
    ];
    const seen = new Set<string>();
    for (const id of ordered) {
      if (!memberIds.has(id)) throw new Error(`WorldTripParty: ordering references unknown instanceId ${id}`);
      if (seen.has(id)) throw new Error(`WorldTripParty: ordering repeats instanceId ${id}`);
      seen.add(id);
    }
    if (seen.size !== memberIds.size) {
      const missing = [...memberIds].filter((id) => !seen.has(id));
      throw new Error(`WorldTripParty: ordering omits instanceId ${missing.join(", ")}`);
    }
    const memberById = new Map(this.members.map((member) => [member.instanceId, member] as const));
    this.members.splice(
      0,
      this.members.length,
      ...ordered.map((id) => memberById.get(id)!),
    );
  }

  private maxHpOfState(member: PlayerMonsterInstance): number {
    return this.maxHp(
      member.shortType,
      member.level,
      member.soulStone,
      this.playerBuffsById.get(member.instanceId),
    );
  }

  private maxHp(
    shortType: string,
    level: number,
    stone: SoulStoneSetup | undefined,
    playerBuffs: PlayerBuffBonuses | undefined,
  ): number {
    return monsterStat(
      this.data.monsterByShortType(shortType),
      "MaxHP",
      level,
      this.statChildren(stone, playerBuffs),
    );
  }

  private statChildren(
    stone: SoulStoneSetup | undefined,
    playerBuffs: PlayerBuffBonuses | undefined,
  ): MonsterStatChildren {
    return {
      ...(stone === undefined
        ? {}
        : {
            soulStone: {
              level: stone.level,
              enabledStats: this.data.soulStoneByElement(stone.element).enabledStats,
            },
          }),
      ...(playerBuffs === undefined ? {} : { playerBuffs }),
    };
  }

  private validateLevelAndXp(shortType: string, level: number, cumulativeXp: number): void {
    this.validateLevel(level);
    this.data.monsterByShortType(shortType);
    if (!Number.isSafeInteger(cumulativeXp) || cumulativeXp < 0) {
      throw new Error(`WorldTripParty: cumulativeXp must be a non-negative safe integer; got ${cumulativeXp}`);
    }
    const penalty = this.data.jobXpPenalty(shortType);
    const floor = jobXpForLevel(level, penalty);
    const ceiling = level < MAX_LEVEL ? jobXpForLevel(level + 1, penalty) : undefined;
    if (cumulativeXp < floor || (ceiling !== undefined && cumulativeXp >= ceiling)) {
      throw new Error(
        `WorldTripParty: ${shortType} level ${level} disagrees with cumulativeXp ${cumulativeXp}`,
      );
    }
  }

  private validateLevel(level: number): void {
    if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) {
      throw new Error(`WorldTripParty: level must be an integer in [1, ${MAX_LEVEL}]; got ${level}`);
    }
  }

  private validateHp(value: number, label: string, allowZero: boolean): void {
    const minimum = allowZero ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`WorldTripParty: ${label} must be an integer >= ${minimum}; got ${value}`);
    }
  }

  private validateInjury(monster: PlayerMonsterInstance): void {
    if ((monster.injureTime === undefined) !== (monster.healTime === undefined)) {
      throw new Error(`WorldTripParty: ${monster.instanceId} injury requires both injureTime and healTime`);
    }
    if (monster.injureTime !== undefined && monster.healTime !== undefined) {
      if (!Number.isFinite(monster.injureTime) || !Number.isFinite(monster.healTime)) {
        throw new Error(`WorldTripParty: ${monster.instanceId} injury timestamps must be finite`);
      }
      if (monster.healTime < monster.injureTime) {
        throw new Error(`WorldTripParty: ${monster.instanceId} healTime precedes injureTime`);
      }
    }
  }

  private validateSoulStone(stone: SoulStoneSetup | undefined): void {
    if (stone === undefined) return;
    if (!Number.isInteger(stone.level) || stone.level < 1) {
      throw new Error(`WorldTripParty: soul-stone level must be a positive integer; got ${stone.level}`);
    }
    this.data.soulStoneByElement(stone.element);
    if (stone.sourceType !== undefined) this.data.monsterByShortType(stone.sourceType);
  }

  private allocateStoneToken(): string {
    this.nextStoneToken += 1;
    return `soul-stone-${this.nextStoneToken}`;
  }
}
