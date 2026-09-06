import {
  WorldTripParty,
  collectionClaimId,
  collectionGoalProgress,
  generateQuestRewards,
  type CombineMonsterQuestEvent,
  type CombineMonsterResult,
  type CollectionGoalProgress,
  type PlayerMonsterInstance,
  type PlayerReward,
  type Rng,
  type SoulStoneSetup,
} from "@dib/engine";
import type { CollectionGoalDefinition, GameData } from "@dib/gamedata/browser";
import {
  CollectionClaims,
  applyPlayerRewards,
  type AppliedPlayerReward,
} from "@dib/player-domain";
import type { BattlePlayerState } from "./battlePlayerState.js";
import type { BattleTripParty } from "./battleTripParty.js";
import type { PlayerCollection } from "./playerCollection.js";
import type { InventoryItemId, PlayerStatName } from "@dib/player-domain";
import {
  PlayerProfile,
  battingOrderSizeFor,
  type PlayerProfileConfig,
  type PlayerProfileStateSnapshot,
} from "./playerProfile.js";

const SAVE_ME_GOLD_COST = 100;
const SAVE_ME_TUTORIAL_FLAG = "SaveMe";

export type PlayerPartyStateSnapshot =
  | {
      readonly kind: "standalone-levels";
      readonly levels: readonly number[];
    }
  | {
      readonly kind: "world-trip-party";
      readonly battingOrderSize: number;
      /** Legacy field. The active prefix is `min(battingOrderSize, monsters.length)` — the source
       * stores no length — so this is validated on restore and otherwise ignored, and is no longer
       * written. */
      readonly battingOrderLength?: number;


      readonly battingOrderSlotIds?: readonly (string | null)[];
      readonly reserveOrderIds?: readonly string[];
      readonly monsters: readonly PlayerMonsterInstance[];
      /** Unequipped owned soul-stone pool (`Player.soulStones`). Optional so pre-editor saves
       * restore with an empty pool. */
      readonly soulStones?: readonly SoulStoneSetup[];
    };

/** JSON-safe boundary for the player-owned state implemented by the current vertical slice. World
 * navigation state is deliberately separate: a future save service can checkpoint both without
 * making battle or renderer objects persistent. */
export interface PlayerRuntimeStateSnapshotV1 {
  readonly schemaVersion: 1;
  readonly profile: PlayerProfileStateSnapshot;
  readonly party: PlayerPartyStateSnapshot;
}

export interface PlayerRuntimeStateSnapshotV2 {
  readonly schemaVersion: 2;
  readonly profile: PlayerProfileStateSnapshot;
  readonly party: PlayerPartyStateSnapshot;
  readonly claimedCollectionGoalIds: readonly string[];
}

export type PlayerRuntimeStateSnapshot =
  | PlayerRuntimeStateSnapshotV1
  | PlayerRuntimeStateSnapshotV2;

/** Owns exactly one profile and, for world play, exactly one authoritative party aggregate.
 * BattleNode receives only battleState(); future towns/shops can receive the richer runtime object
 * without creating shadow copies of species, levels, inventory, or spirit state. */
export class PlayerRuntimeState {
  profile: PlayerProfile;
  party: WorldTripParty | undefined;
  collection: PlayerCollection;
  private standaloneLevels: readonly number[] | undefined;
  private collectionClaims: CollectionClaims;
  private onChanged: () => void = () => {};
  private onQuestEvent: (event: CombineMonsterQuestEvent) => void = () => {};

  private constructor(options: {
    profile: PlayerProfile;
    collection: PlayerCollection;
    party?: WorldTripParty;
    standaloneLevels?: readonly number[];
    collectionClaims?: CollectionClaims;
  }) {
    this.profile = options.profile;
    this.collection = options.collection;
    this.party = options.party;
    // Single binding point for the hero-skill/Gem providers the source attaches to every bench
    // Monster (`-[Player applyPlayerBuffsToMonsters:]`). Every factory funnels through this
    // constructor, so a party can never reach gameplay computing stone-free base stats while a
    // battle projected from it computes buffed ones.
    this.party?.setPlayerBuffSource(() => this.profile.battleStatBonuses());
    this.collectionClaims = options.collectionClaims ?? new CollectionClaims();
    this.standaloneLevels = options.standaloneLevels === undefined
      ? undefined
      : [...options.standaloneLevels];
  }

  static standalone(config: PlayerProfileConfig, collection: PlayerCollection): PlayerRuntimeState {
    const levels = [...config.monsterPartyLevels];
    return new PlayerRuntimeState({
      profile: new PlayerProfile(config),
      collection,
      standaloneLevels: levels,
    });
  }

  static world(config: PlayerProfileConfig, party: WorldTripParty): PlayerRuntimeState {
    const members = party.monsters();
    if (members.length === 0) throw new Error("PlayerRuntimeState: world party must not be empty");
    const profile = new PlayerProfile({
      ...config,
      monsterPartyLevels: members.map((monster) => monster.level),
    }, party);
    return new PlayerRuntimeState({
      profile,
      party,
      collection: {
        hasCapturedSimpleType: (shortType) => profile.highestRegisteredLevel(shortType) > 0,
      },
    });
  }

  battleState(): BattlePlayerState {
    return { profile: this.profile, collection: this.collection };
  }

  /** Persistence is attached at the aggregate boundary so future town/shop modules can mutate
   * profile domains without acquiring storage or network dependencies. */
  setChangeListener(listener: () => void): void {
    this.onChanged = listener;
    this.profile.setChangeListener(listener);
  }

  /** Future quest-system seam. Combining emits source event 8 at the append-result /
   * consume-ingredients boundary rather than dropping that gameplay signal. */
  setQuestEventListener(listener: (event: CombineMonsterQuestEvent) => void): void {
    this.onQuestEvent = listener;
  }

  /** Command-decorated party view for BattleNode. Each durable mutation updates only the relevant
   * collection-history entry; there is no whole-party synchronization pass. */
  battleParty(): BattleTripParty {
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: standalone battle has no durable trip party");
    }
    return {
      battingOrderSize: party.battingOrderSize,
      battingOrderLength: () => party.battingOrderLength(),
      battingOrderMonsters: () => {
        if (party.purgeExpiredInjuries(Date.now() / 1000)) this.onChanged();
        return party.battingOrderMonsters();
      },
      monsters: () => party.monsters(),
      monster: (instanceId) => party.monster(instanceId),
      commitBattleSnapshot: (snapshot) => {
        party.commitBattleSnapshot(snapshot);
        this.onChanged();
      },
      addCapturedMonster: (setup) => {
        const captured = party.addCapturedMonster(setup);
        if (!this.profile.recordCapturedMonster(captured.shortType, captured.level)) this.onChanged();
        return captured;
      },
      awardXp: (instanceId, amount) => {
        const result = party.awardXp(instanceId, amount);
        const monster = party.monster(instanceId);
        if (!this.profile.recordCapturedMonster(monster.shortType, monster.level)) this.onChanged();
        return result;
      },
      evolve: (instanceId) => {
        const evolved = party.evolve(instanceId);
        if (!this.profile.recordCapturedMonster(evolved.shortType, evolved.level)) this.onChanged();
        return evolved;
      },
    };
  }

  /** Town Monsterpedia command. Recipe ownership stays in PlayerProfile; ordered concrete-party
   * mutation stays in WorldTripParty. Every success checkpoints exactly once through either the
   * new registration write or the explicit already-known-result branch. */
  combineMonsters(
    resultInstanceId: string,
    resultShortType: string,
    firstIngredientId: string,
    secondIngredientId: string,
  ): CombineMonsterResult {
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: standalone battle has no durable trip party");
    }
    if (!this.profile.hasCombineRecipe(resultShortType)) {
      throw new Error(`PlayerRuntimeState: combine recipe ${resultShortType} is not learned`);
    }
    const result = party.combineMonsters(
      resultInstanceId,
      resultShortType,
      firstIngredientId,
      secondIngredientId,
      (event) => this.onQuestEvent(event),
    );
    if (!this.profile.recordCapturedMonster(result.monster.shortType, result.monster.level)) {
      this.onChanged();
    }
    return result;
  }

  /** `DestroyOnPickup.MonsterJoin` reward: append the authored species/level as a full-HP reserve
   * and register the acquired monster in the same durable collection-history domain as capture. */
  addJoinedMonster(
    instanceId: string,
    shortType: string,
    jobLevel: number,
  ): PlayerMonsterInstance {
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: MonsterJoin reward requires a durable world party");
    }
    const joined = party.addCapturedMonster({
      instanceId,
      shortType,
      level: jobLevel,
    });
    if (!this.profile.recordCapturedMonster(joined.shortType, joined.level)) this.onChanged();
    return joined;
  }


  mutateSkill(action: "increment" | "decrement", stat: PlayerStatName): boolean {
    // One observable checkpoint for the allocation plus the party rebuild it triggers.
    this.profile.setChangeListener(() => {});
    let changed: boolean;
    try {
      changed = action === "increment"
        ? this.profile.incrementSkill(stat)
        : this.profile.decrementSkill(stat);
      if (changed) this.party?.fullRestoreAndReapplyPermanentBuffs();
    } finally {
      this.profile.setChangeListener(this.onChanged);
    }
    if (changed) this.onChanged();
    return changed;
  }


  equipGem(id: InventoryItemId): ReturnType<PlayerProfile["equipGem"]> {
    this.profile.setChangeListener(() => {});
    let result: ReturnType<PlayerProfile["equipGem"]>;
    try {
      result = this.profile.equipGem(id);
      this.party?.fullRestoreAndReapplyPermanentBuffs();
    } finally {
      this.profile.setChangeListener(this.onChanged);
    }
    this.onChanged();
    return result;
  }


  markSaveMeTutorialSeen(): void {
    this.profile.claimTutorialFlag(SAVE_ME_TUTORIAL_FLAG);
  }


  resolveLocalSaveMe():
    | { readonly ok: true; readonly goldCost: 100 }
    | { readonly ok: false; readonly reason: "insufficient-funds" } {
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: local Save Me requires a durable world party");
    }
    if (this.profile.snapshot().gold < SAVE_ME_GOLD_COST) {
      return { ok: false, reason: "insufficient-funds" };
    }

    // PlayerProfile normally checkpoints each wallet mutation. Suppress that intermediate
    // callback so persistence can observe only the completed wallet + roster transaction.
    this.profile.setChangeListener(() => {});
    try {
      if (!this.profile.spendGold(SAVE_ME_GOLD_COST)) {
        throw new Error("PlayerRuntimeState: prechecked Save Me gold debit unexpectedly failed");
      }
      party.applySaveMeRecovery();
    } finally {
      this.profile.setChangeListener(this.onChanged);
    }
    this.onChanged();
    return { ok: true, goldCost: SAVE_ME_GOLD_COST };
  }


  claimCollectionGoal(
    goal: CollectionGoalDefinition,
    rng: Rng,
    allocateMonsterInstanceId: (shortType: string, level: number) => string,
  ):
    | {
        readonly ok: false;
        readonly reason: "incomplete" | "already-claimed";
        readonly progress: CollectionGoalProgress;
      }
    | {
        readonly ok: true;
        readonly progress: CollectionGoalProgress;
        readonly rewards: readonly PlayerReward[];
        readonly applied: readonly AppliedPlayerReward[];
        /**
         * Destroy-on-pickup Eggs this treasure rolled, in generation order. `applyPlayerRewards`
         * refuses them by design; the caller must run the hatch presentation for each, exactly as
         * the quest and battle reward loops do.
         */
        readonly pendingEggs: readonly (
          | "silver"
          | "gold"
          | { readonly kind: "silver"; readonly repeatPicks: number }
        )[];
      } {
    const progress = this.collectionGoalProgress(goal);
    if (!progress.complete) {
      return Object.freeze({ ok: false, reason: "incomplete", progress });
    }
    if (progress.claimed) {
      return Object.freeze({ ok: false, reason: "already-claimed", progress });
    }

    const checkpoint = this.onChanged;
    let claimRecorded = false;
    this.onChanged = () => {};
    this.profile.setChangeListener(() => {});
    try {
      this.collectionClaims.claim(progress.goalId);
      claimRecorded = true;
      const rewards = generateQuestRewards(goal.treasureData, 1, rng);
      // `Egg.destroyFromPickup` hatches inside `Player.addItem:`, so a hatch is presentation, not
      // state, and cannot run under this suppressed checkpoint. Split it out for the caller.
      // Ordering is not observable here: every shipped Collection goal carries exactly one
      // treasure item (`Collection.plist` Base, 4 goals), so no reward can precede or follow an
      // Egg in the same claim and influence its pool.
      const pendingEggs = rewards.flatMap<"silver" | "gold" | { readonly kind: "silver"; readonly repeatPicks: number }>((reward) =>
        reward.kind === "egg" ? (["silver"] as const)
        : reward.kind === "monsterEgg" ? (["gold"] as const)
        : reward.kind === "repeatEgg" ? ([Object.freeze({
            kind: "silver" as const,
            repeatPicks: reward.numRepeats,
          })] as const)
        : [],
      );
      const settled = rewards.filter(
        (reward) => reward.kind !== "egg" && reward.kind !== "monsterEgg" && reward.kind !== "repeatEgg",
      );
      const joinIds = this.preallocateCollectionMonsterJoinIds(
        settled,
        allocateMonsterInstanceId,
      );
      let joinIndex = 0;
      const applied = applyPlayerRewards(this.profile, settled, {
        addMonsterJoin: (shortType, jobLevel) => {
          const instanceId = joinIds[joinIndex++];
          if (instanceId === undefined) {
            throw new Error("PlayerRuntimeState: Collection MonsterJoin allocation is missing");
          }
          this.addJoinedMonster(instanceId, shortType, jobLevel);
          return { instanceId };
        },
      });
      return Object.freeze({
        ok: true,
        progress: this.collectionGoalProgress(goal),
        rewards,
        applied,
        pendingEggs: Object.freeze(pendingEggs),
      });
    } finally {
      this.onChanged = checkpoint;
      this.profile.setChangeListener(checkpoint);
      if (claimRecorded) checkpoint();
    }
  }

  /**
   * Official mirror of a Collection claim the authority already committed.
   *
   * The server owns the claim record, the reward roll and every minted monster id, so nothing here
   * generates or decides anything: it replays the committed batch into the live aggregate the world
   * scene holds by reference. Adoption of the next projection is not a substitute — the flow is
   * mid-presentation and the nodes hold this object, exactly as `presentQuestRewards` does for an
   * official quest claim.
   *
   * Eggs are split out for the same reason as the local claim: `Egg.destroyFromPickup` is a hatch
   * presentation, and online it is a separate server continuation the caller must drive.
   */
  mirrorCommittedCollectionClaim(
    goal: CollectionGoalDefinition,
    rewards: readonly PlayerReward[],
    committedMonsterIds: readonly string[],
  ): {
    readonly progress: CollectionGoalProgress;
    readonly rewards: readonly PlayerReward[];
    readonly applied: readonly AppliedPlayerReward[];
    readonly pendingEggs: readonly (
      | "silver"
      | "gold"
      | { readonly kind: "silver"; readonly repeatPicks: number }
    )[];
  } {
    const goalId = collectionClaimId(goal);
    const checkpoint = this.onChanged;
    this.onChanged = () => {};
    this.profile.setChangeListener(() => {});
    try {
      this.collectionClaims.claim(goalId);
      const pendingEggs = rewards.flatMap<"silver" | "gold" | { readonly kind: "silver"; readonly repeatPicks: number }>((reward) =>
        reward.kind === "egg" ? (["silver"] as const)
        : reward.kind === "monsterEgg" ? (["gold"] as const)
        : reward.kind === "repeatEgg" ? ([Object.freeze({
            kind: "silver" as const,
            repeatPicks: reward.numRepeats,
          })] as const)
        : [],
      );
      const settled = rewards.filter(
        (reward) => reward.kind !== "egg" && reward.kind !== "monsterEgg" && reward.kind !== "repeatEgg",
      );
      let joinIndex = 0;
      const applied = applyPlayerRewards(this.profile, settled, {
        addMonsterJoin: (shortType, jobLevel) => {
          const instanceId = committedMonsterIds[joinIndex++];
          if (instanceId === undefined) {
            throw new Error(
              `PlayerRuntimeState: official Collection claim ${goalId} omitted a committed monster id`,
            );
          }
          this.addJoinedMonster(instanceId, shortType, jobLevel);
          return { instanceId };
        },
      });
      if (joinIndex !== committedMonsterIds.length) {
        throw new Error(
          `PlayerRuntimeState: official Collection claim ${goalId} committed ` +
            `${String(committedMonsterIds.length)} monsters for ${String(joinIndex)} join rewards`,
        );
      }
      return Object.freeze({
        progress: this.collectionGoalProgress(goal),
        rewards,
        applied,
        pendingEggs: Object.freeze(pendingEggs),
      });
    } finally {
      this.onChanged = checkpoint;
      this.profile.setChangeListener(checkpoint);
      checkpoint();
    }
  }

  /** Egg `feedMonster:` selection: the generated prize is transient; the selected bench monster
   * receives one exact full Job band and one `increaseLevel`, then collection history checkpoints. */
  feedHatchedMonster(
    recipientInstanceId: string,
    fedShortType: string,
    fedLevel: number,
  ): PlayerMonsterInstance {
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: egg feeding requires a durable world party");
    }
    // Validate the transient monster identity even though native eatMonster: does not derive XP
    // from it. This prevents malformed presentation state from becoming a silent durable write.
    if (fedShortType.length === 0 || !Number.isSafeInteger(fedLevel) || fedLevel < 1) {
      throw new Error(`PlayerRuntimeState: invalid fed monster ${fedShortType} level ${fedLevel}`);
    }
    const result = party.feedOneLevel(recipientInstanceId);
    const recipient = party.monster(recipientInstanceId);
    if (!this.profile.recordCapturedMonster(recipient.shortType, recipient.level)) this.onChanged();
    if (result.level !== recipient.level) {
      throw new Error("PlayerRuntimeState: egg feed result diverged from durable recipient");
    }
    return recipient;
  }


  healPartyMonster(
    instanceId: string,
    nowSeconds: number,
  ): { ok: true; cost: number } | { ok: false; cost: number } {
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: standalone battle has no durable trip party");
    }
    const cost = party.injuryHealCost(instanceId, nowSeconds);
    if (this.profile.snapshot().gold < cost) return { ok: false, cost };
    party.healInjury(instanceId);
    if (!this.profile.spendGold(cost)) {
      throw new Error("PlayerRuntimeState: prechecked injury gold debit unexpectedly failed");
    }
    return { ok: true, cost };
  }

  /** Official-online mirror of the same command using the server-committed price. */
  healPartyMonsterAtCost(
    instanceId: string,
    cost: number,
    balance: number,
  ): { ok: true; cost: number } {
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: standalone battle has no durable trip party");
    }
    if (
      !Number.isSafeInteger(cost) ||
      cost < 0 ||
      !Number.isSafeInteger(balance) ||
      balance < 0
    ) {
      throw new Error("PlayerRuntimeState: authoritative injury settlement is invalid");
    }
    party.healInjury(instanceId);
    const localBalance = this.profile.snapshot().gold;
    if (localBalance > balance) {
      if (!this.profile.spendGold(localBalance - balance)) {
        throw new Error("PlayerRuntimeState: authoritative injury gold reconciliation failed");
      }
    } else if (localBalance < balance) {
      this.profile.awardGold(balance - localBalance);
    }
    return { ok: true, cost };
  }

  stateSnapshot(): PlayerRuntimeStateSnapshotV2 {
    return {
      schemaVersion: 2,
      profile: this.profile.stateSnapshot(),
      party: this.party === undefined
        ? {
            kind: "standalone-levels",
            levels: [...this.requireStandaloneLevels()],
          }
        : {
            kind: "world-trip-party",
            battingOrderSize: this.party.battingOrderSize,
            monsters: this.party.monsters(),
            soulStones: this.party.ownedSoulStones(),
          },
      claimedCollectionGoalIds: this.collectionClaims.snapshot(),
    };
  }

  static fromStateSnapshot(
    data: GameData,
    snapshot: PlayerRuntimeStateSnapshot,
    standaloneCollection?: PlayerCollection,
  ): PlayerRuntimeState {
    const schemaVersion = (snapshot as { readonly schemaVersion: unknown }).schemaVersion;
    if (schemaVersion !== 1 && schemaVersion !== 2) {
      throw new Error(`PlayerRuntimeState: unsupported state schema ${String(schemaVersion)}`);
    }
    const profileSnapshot = discardUnavailableOptionalSaveContent(data, snapshot.profile);
    const collectionClaims = restoreCollectionClaims(snapshot);
    if (
      profileSnapshot.schemaVersion === 3 ||
      profileSnapshot.schemaVersion === 4 ||
      profileSnapshot.schemaVersion === 5 ||
      profileSnapshot.schemaVersion === 6 ||
      profileSnapshot.schemaVersion === 7 ||
      profileSnapshot.schemaVersion === 8
    ) {
      for (const resultShortType of profileSnapshot.learnedCombineRecipes) {
        data.combineRecipe(resultShortType);
      }
    }
    if (snapshot.party.kind === "standalone-levels") {
      if (standaloneCollection === undefined) {
        throw new Error("PlayerRuntimeState: restoring standalone state requires a collection implementation");
      }
      const levels = [...snapshot.party.levels];
      return new PlayerRuntimeState({
        profile: PlayerProfile.fromStateSnapshot(profileSnapshot, levels),
        collection: standaloneCollection,
        standaloneLevels: levels,
        collectionClaims,
      });
    }

    const hasAnyExplicitOrdering =
      snapshot.party.battingOrderSlotIds !== undefined ||
      snapshot.party.reserveOrderIds !== undefined;
    if (
      hasAnyExplicitOrdering &&
      (
        snapshot.party.battingOrderSlotIds === undefined ||
        snapshot.party.reserveOrderIds === undefined
      )
    ) {
      throw new Error("PlayerRuntimeState: party ordering requires both slot and reserve arrays");
    }
    const party = new WorldTripParty(
      data,
      snapshot.party.monsters,
      snapshot.party.battingOrderSize,
      snapshot.party.soulStones ?? [],
      snapshot.party.battingOrderLength,
      !hasAnyExplicitOrdering
        ? undefined
        : {
            battingOrderSlotIds: snapshot.party.battingOrderSlotIds!,
            reserveOrderIds: snapshot.party.reserveOrderIds!,
          },
    );
    const licenseBattingOrderSize = data.license(
      profileSnapshot.schemaVersion === 5 || profileSnapshot.schemaVersion === 6 ||
        profileSnapshot.schemaVersion === 7 || profileSnapshot.schemaVersion === 8
        ? profileSnapshot.licenseType
        : "Novice",
    ).battingOrderSize;
    const profile = PlayerProfile.fromStateSnapshot(
      profileSnapshot,
      party.monsters().map((monster) => monster.level),
      party,
      {
        evolveChainOf: (shortType) => data.evolveChainOrUndefined(shortType),
        licenseBattingOrderSize,
      },
    );


    party.setBattingOrderSize(battingOrderSizeFor(
      data.license(profile.licenseType).battingOrderSize,
      profile.heroLevel,
      { infiniteDungeonHighestLevel: profile.infiniteDungeonHighestLevel },
    ));
    return new PlayerRuntimeState({
      profile,
      party,
      collection: {
        hasCapturedSimpleType: (shortType) => profile.highestRegisteredLevel(shortType) > 0,
      },
      collectionClaims,
    });
  }

  /** Adopt one already-persisted aggregate without replaying mutation listeners. The caller owns
   * the surrounding checkpoint boundary; this method only replaces the complete player state. */
  replaceStateSnapshot(data: GameData, snapshot: PlayerRuntimeStateSnapshot): void {
    const changeListener = this.onChanged;
    const questListener = this.onQuestEvent;
    const replacement = PlayerRuntimeState.fromStateSnapshot(data, snapshot, this.collection);
    this.profile = replacement.profile;
    this.party = replacement.party;
    this.collection = replacement.collection;
    this.standaloneLevels = replacement.standaloneLevels;
    this.collectionClaims = replacement.collectionClaims;
    this.onChanged = changeListener;
    this.onQuestEvent = questListener;
    this.profile.setChangeListener(changeListener);
  }

  /** Read-only Collection projection. Claim ownership remains private to this aggregate. */
  collectionGoalProgress(goal: CollectionGoalDefinition): CollectionGoalProgress {
    return collectionGoalProgress(
      goal,
      (shortType) => this.profile.highestRegisteredLevel(shortType),
      new Set(this.collectionClaims.snapshot()),
    );
  }

  private preallocateCollectionMonsterJoinIds(
    rewards: readonly PlayerReward[],
    allocateMonsterInstanceId: (shortType: string, level: number) => string,
  ): readonly string[] {
    const joins = rewards.filter(
      (reward): reward is Extract<PlayerReward, { readonly kind: "monsterJoin" }> =>
        reward.kind === "monsterJoin",
    );
    if (joins.length === 0) return Object.freeze([]);
    const party = this.party;
    if (party === undefined) {
      throw new Error("PlayerRuntimeState: Collection MonsterJoin reward requires a durable world party");
    }
    const occupied = new Set(party.monsters().map(({ instanceId }) => instanceId));
    const ids = joins.map(({ shortType, jobLevel }) => {
      const instanceId = allocateMonsterInstanceId(shortType, jobLevel);
      if (typeof instanceId !== "string" || instanceId.length === 0) {
        throw new Error("PlayerRuntimeState: Collection MonsterJoin ID must be a non-empty string");
      }
      if (occupied.has(instanceId)) {
        throw new Error(`PlayerRuntimeState: duplicate Collection MonsterJoin ID ${instanceId}`);
      }
      occupied.add(instanceId);
      return instanceId;
    });
    return Object.freeze(ids);
  }

  private requireStandaloneLevels(): readonly number[] {
    if (this.standaloneLevels === undefined) {
      throw new Error("PlayerRuntimeState: standalone party levels are missing");
    }
    return this.standaloneLevels;
  }
}

/**
 * A cross-profile compatibility attempt keeps structural state strict, but absent optional
 * registrations behave like inert inventory/knowledge instead of making the whole save
 * unopenable. Essential party/world identities remain fail-loud in their owning restorers.
 */
function discardUnavailableOptionalSaveContent(
  data: GameData,
  snapshot: PlayerProfileStateSnapshot,
): PlayerProfileStateSnapshot {
  const knownSpiritXp = Object.fromEntries(
    Object.entries(snapshot.spiritSavedXp)
      .filter(([shortType]) => data.evolveChainOrUndefined(shortType) !== undefined),
  );
  const knownUsedSpirits = snapshot.spiritsUsedThisTrip.filter(
    (shortType) => Object.prototype.hasOwnProperty.call(knownSpiritXp, shortType),
  );
  const recipeSnapshot = snapshot.schemaVersion === 3 || snapshot.schemaVersion === 4 ||
    snapshot.schemaVersion === 5 || snapshot.schemaVersion === 6 ||
    snapshot.schemaVersion === 7 || snapshot.schemaVersion === 8
    ? snapshot
    : undefined;
  const knownRecipes = recipeSnapshot === undefined
    ? undefined
    : recipeSnapshot.learnedCombineRecipes.filter(
        (shortType) => data.combineRecipeOrUndefined(shortType) !== undefined ||
          data.evolveChainOrUndefined(shortType) !== undefined,
      );
  const inventorySnapshot = snapshot.schemaVersion === 5 || snapshot.schemaVersion === 6 ||
    snapshot.schemaVersion === 7 || snapshot.schemaVersion === 8
    ? snapshot
    : undefined;
  const inventory = inventorySnapshot === undefined ? undefined : {
    ...inventorySnapshot.inventory,
    looseItems: inventorySnapshot.inventory.looseItems.filter(
      (item) => data.itemOrUndefined(item.definitionPath) !== undefined,
    ),
    equippedGems: Object.fromEntries(
      Object.entries(inventorySnapshot.inventory.equippedGems).filter(
        ([, item]) => item !== undefined && data.itemOrUndefined(item.definitionPath) !== undefined,
      ),
    ),
  };
  const removedCount = Object.keys(snapshot.spiritSavedXp).length - Object.keys(knownSpiritXp).length +
    snapshot.spiritsUsedThisTrip.length - knownUsedSpirits.length +
    (knownRecipes === undefined ? 0 : recipeSnapshot!.learnedCombineRecipes.length - knownRecipes.length) +
    (inventory === undefined || inventorySnapshot === undefined ? 0 :
      inventorySnapshot.inventory.looseItems.length - inventory.looseItems.length +
      Object.keys(inventorySnapshot.inventory.equippedGems).length - Object.keys(inventory.equippedGems).length);
  if (removedCount === 0) return snapshot;
  console.warn(
    `[save] Ignored ${removedCount} optional saved registrations unavailable in this content profile.`,
  );
  return {
    ...snapshot,
    spiritSavedXp: knownSpiritXp,
    spiritsUsedThisTrip: knownUsedSpirits,
    ...(knownRecipes === undefined ? {} : { learnedCombineRecipes: knownRecipes }),
    ...(inventory === undefined ? {} : { inventory }),
  } as PlayerProfileStateSnapshot;
}

function restoreCollectionClaims(snapshot: PlayerRuntimeStateSnapshot): CollectionClaims {
  if (snapshot.schemaVersion === 1) return new CollectionClaims();
  if (!Array.isArray(snapshot.claimedCollectionGoalIds)) {
    throw new Error("PlayerRuntimeState: schema 2 claimedCollectionGoalIds must be an array");
  }
  const claims = new CollectionClaims(snapshot.claimedCollectionGoalIds);
  const canonical = claims.snapshot();
  if (
    canonical.length !== snapshot.claimedCollectionGoalIds.length ||
    canonical.some((goalId, index) => goalId !== snapshot.claimedCollectionGoalIds[index])
  ) {
    throw new Error("PlayerRuntimeState: claimedCollectionGoalIds must be sorted and unique");
  }
  return claims;
}
