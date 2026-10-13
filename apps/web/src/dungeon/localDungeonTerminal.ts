import {
  GuildQuestRuntime,
  type GuildQuestEvent,
  type GuildQuestEventResult,
  type GuildQuestStateSnapshot,
  type ForkableRng,
  type Rng,
} from "@dib/engine";
import {
  dungeonCaptureInstanceId,
  type DungeonRoomRosterUpdateHooks,
  type DungeonRouteDescriptor,
  type DungeonRunSnapshot,
} from "@dib/engine/dungeon-runtime";
import type { GameData } from "@dib/gamedata/browser";
import {
  PlayerRuntimeState,
  type PlayerRuntimeStateSnapshot,
} from "../player/playerRuntimeState.js";
import type { WorldProgressStateSnapshot } from "../player/gameState.js";

export interface LocalDungeonTerminalCheckpoint {
  readonly player: PlayerRuntimeStateSnapshot;
  readonly quests?: GuildQuestStateSnapshot;
  readonly dungeon: DungeonRunSnapshot | null;
  /** Always present so defeat/town purge can durably clear prior ownership. */
  readonly pendingBattleRewardKeys: Readonly<Record<string, string>>;
  /** Prepared world/town state replaces the live world projection for terminal saves. */
  readonly world?: WorldProgressStateSnapshot;
}

export interface LocalDungeonTerminalApplication {
  /** The world projection is built off to the side and included in the terminal checkpoint. */
  readonly world?: WorldProgressStateSnapshot;
  /** Must only swap already-prepared aggregate references. */
  readonly accept: () => void;
  /** Plain prebuilt gate for ordinary listeners; commit flips only this data property. */
  readonly listenerGate?: { active: boolean };
  /** Must restore the exact references present before accept. */
  readonly rollback: () => void;
}

export interface LocalDungeonTerminalHost {
  readonly data: GameData;
  readonly player: PlayerRuntimeState;
  readonly quests?: GuildQuestRuntime;
  readonly pendingBattleRewardKeys?: Readonly<Record<string, string>>;
  readonly captureIdentity?: LocalDungeonCaptureIdentity;
  readonly persist: (checkpoint: LocalDungeonTerminalCheckpoint) => Promise<void>;
  readonly prepareApplication?: (
    outcome: LocalDungeonTerminalOutcome,
    player: PlayerRuntimeState,
    quests: GuildQuestRuntime | undefined,
    stageQuestEventResult: (result: GuildQuestEventResult) => void,
  ) => LocalDungeonTerminalApplication;
  readonly presentQuestEventResult?: (
    runtime: GuildQuestRuntime,
    result: GuildQuestEventResult,
  ) => void | Promise<void>;
}

export interface LocalDungeonCaptureIdentity {
  readonly runSeed: number;
  readonly route: DungeonRouteDescriptor;
  readonly captureSerial: number;
}

export type LocalDungeonTerminalOutcome = "victory" | "retreat" | "defeat";

export interface LocalDungeonRngStage {
  /**
   * Detached stream facade used by the prospective world trip. After acceptance it follows the
   * accepted live identity, so long-lived consumers do not retain the pre-commit fork.
   */
  readonly staged: ForkableRng;
  /** Adopt the detached stream exactly once after durable acceptance. */
  accept(resolveAcceptedIdentity?: (detached: ForkableRng) => ForkableRng): ForkableRng;
  /** Restore the live stream identity after rejection. */
  rollback(): ForkableRng;
}

/** Fork the local seeded world stream before constructing terminal consequences. The live stream
 * is never passed to the staged trip, so rejection cannot consume or replace it. */
export function stageLocalDungeonRng(live: Rng): LocalDungeonRngStage {
  const liveForkable = live as Partial<ForkableRng>;
  if (typeof liveForkable.fork !== "function") {
    throw new Error("LocalDungeonTerminal: local world RNG is not forkable");
  }
  const acceptedLive = live as ForkableRng;
  const detached = acceptedLive.fork();
  let target: ForkableRng = detached;
  const staged: ForkableRng = Object.freeze({
    fork: () => target.fork(),
    next: () => target.next(),
    intBelow: (n: number) => target.intBelow(n),
    chance: (p: number) => target.chance(p),
  });
  let adopted = false;
  return {
    staged,
    accept: (resolveAcceptedIdentity) => {
      if (adopted) throw new Error("LocalDungeonTerminal: staged world RNG already adopted");
      const acceptedIdentity = resolveAcceptedIdentity?.(detached) ?? detached;
      target = acceptedIdentity;
      adopted = true;
      return staged;
    },
    rollback: () => {
      target = acceptedLive;
      return acceptedLive;
    },
  };
}


export class LocalDungeonTerminalRetryOwner {
  private retryAction: (() => boolean) | undefined;

  arm(retry: () => boolean): void {
    this.retryAction = retry;
  }

  hasPending(): boolean {
    return this.retryAction !== undefined;
  }

  retry(): boolean {
    const retry = this.retryAction;
    if (retry === undefined) return false;
    this.retryAction = undefined;
    try {
      const accepted = retry();
      if (!accepted) this.retryAction = retry;
      return accepted;
    } catch (error) {
      this.retryAction = retry;
      throw error;
    }
  }

  clear(): void {
    this.retryAction = undefined;
  }
}


export class LocalDungeonTerminalContinuation {
  private record: {
    readonly flowKey: string;
    readonly outcome: LocalDungeonTerminalOutcome;
    readonly resume: () => Promise<void>;
  } | undefined;

  commit(flowKey: string, outcome: LocalDungeonTerminalOutcome, resume: () => Promise<void>): void {
    if (this.record !== undefined) {
      throw new Error("LocalDungeonTerminalContinuation: committed continuation already exists");
    }
    this.record = { flowKey, outcome, resume };
  }

  hasCommitted(): boolean {
    return this.record !== undefined;
  }

  async resume(flowKey: string, outcome: LocalDungeonTerminalOutcome): Promise<void> {
    const record = this.record;
    if (record === undefined) {
      throw new Error("LocalDungeonTerminalContinuation: no committed continuation");
    }
    if (record.flowKey !== flowKey || record.outcome !== outcome) {
      throw new Error("LocalDungeonTerminalContinuation: flow/outcome identity conflict");
    }
    await record.resume();
    this.record = undefined;
  }
}

/** The local-only aggregate that owns one dungeon terminal's prospective player/quest state.
 * BattleNode and the engine both write here until the single checkpoint succeeds. */
export class LocalDungeonTerminal {
  readonly player: PlayerRuntimeState;
  readonly quests: GuildQuestRuntime | undefined;
  private readonly data: GameData;
  private readonly persistCheckpoint: LocalDungeonTerminalHost["persist"];
  private readonly prepareApplication: LocalDungeonTerminalHost["prepareApplication"];
  private readonly presentQuestEventResult: LocalDungeonTerminalHost["presentQuestEventResult"];
  private captureIdentity: LocalDungeonCaptureIdentity | undefined;
  private _captureSerial: number;
  private preparedPlayer: PlayerRuntimeStateSnapshot | undefined;
  private preparedQuests: GuildQuestStateSnapshot | undefined;
  private preparedPendingBattleRewardKeys: Readonly<Record<string, string>> | undefined;
  private preparedQuestPresentations: readonly QuestPresentation[] = [];
  private questPresentations: QuestPresentation[] = [];
  private questPresentationCursor = 0;
  private preparedQuestPresentationCursor = 0;
  private readonly pendingBattleRewards = new Map<string, string>();
  private application: LocalDungeonTerminalApplication | undefined;
  private applicationAcceptanceAttempted = false;
  private applicationAccepted = false;
  private persisted = false;

  constructor(host: LocalDungeonTerminalHost) {
    this.data = host.data;
    this.persistCheckpoint = host.persist;
    this.prepareApplication = host.prepareApplication;
    this.presentQuestEventResult = host.presentQuestEventResult;
    this.captureIdentity = host.captureIdentity;
    this._captureSerial = host.captureIdentity?.captureSerial ?? 0;
    if (!Number.isSafeInteger(this._captureSerial) || this._captureSerial < 0) {
      throw new Error("LocalDungeonTerminal: invalid capture serial");
    }
    for (const [treasureId, rewardKey] of Object.entries(host.pendingBattleRewardKeys ?? {})) {
      this.pendingBattleRewards.set(treasureId, rewardKey);
    }
    this.player = PlayerRuntimeState.fromStateSnapshot(
      host.data,
      host.player.stateSnapshot(),
      host.player.collection,
    );
    this.quests = host.quests === undefined
      ? undefined
      : new GuildQuestRuntime(host.quests.catalog, host.quests.stateSnapshot());
  }

  get captureSerial(): number {
    return this._captureSerial;
  }

  /** Allocate from the detached terminal aggregate; the live dungeon adopts this serial only
   * after its durable terminal checkpoint succeeds. */
  nextCaptureInstanceId(encounterId: string, shortType: string): string {
    const identity = this.captureIdentity;
    if (identity === undefined) {
      throw new Error("LocalDungeonTerminal: capture identity is unavailable");
    }
    this._captureSerial += 1;
    return dungeonCaptureInstanceId(
      identity.runSeed,
      identity.route,
      encounterId,
      this._captureSerial,
      shortType,
    );
  }


  beginTerminalPreparation(outcome: LocalDungeonTerminalOutcome): void {
    if (this.persisted) throw new Error("LocalDungeonTerminal: terminal is already committed");
    this.preparedPlayer = this.player.stateSnapshot();
    this.preparedQuests = this.quests?.stateSnapshot();
    this.preparedPendingBattleRewardKeys = this.pendingBattleRewardSnapshot();
    this.preparedQuestPresentations = [...this.questPresentations];
    this.preparedQuestPresentationCursor = this.questPresentationCursor;
    this.application = undefined;
    this.applicationAcceptanceAttempted = false;
    this.applicationAccepted = false;
    if (outcome === "defeat") this.pendingBattleRewards.clear();
    try {
      this.application = this.prepareApplication?.(
        outcome,
        this.player,
        this.quests,
        (result) => this.stageQuestEventResult(result),
      ) ?? {
        accept: () => undefined,
        rollback: () => undefined,
      };
    } catch (error) {
      this.restorePreparedState();
      throw error;
    }
  }

  async persist(dungeon: DungeonRunSnapshot | null): Promise<void> {
    if (this.preparedPlayer === undefined) {
      throw new Error("LocalDungeonTerminal: terminal preparation is missing");
    }
    this.acceptBeforePersist();
    try {
      await this.persistCheckpoint({
        player: this.player.stateSnapshot(),
        ...(this.quests === undefined ? {} : { quests: this.quests.stateSnapshot() }),
        dungeon,
        pendingBattleRewardKeys: this.pendingBattleRewardSnapshot(),
        ...(this.application?.world === undefined ? {} : { world: this.application.world }),
      });
      this.persisted = true;
    } catch (error) {
      this.rollbackAcceptedApplication();
      this.restorePreparedState();
      throw error;
    }
  }

  /** Mark the accepted aggregate complete. The irreversible path contains no state adoption. */
  commit(): void {
    if (!this.persisted) throw new Error("LocalDungeonTerminal: cannot commit before persistence");
    if (!this.applicationAccepted) {
      throw new Error("LocalDungeonTerminal: accepted application is missing");
    }
    // Listener bindings were installed while detached but remain terminal-silent through event 9,
    // event 4, and persistence. Activation is a direct flag flip on the prepared binding gate.
    const listenerGate = this.application?.listenerGate;
    if (listenerGate !== undefined) listenerGate.active = true;
  }

  /** Called by the engine rollback hook if a failure happens after persistence but before engine
   * assignment. It makes the aggregate retryable again while retaining the BattleNode-prepared
   * state. */
  rollbackTerminalPreparation(): void {
    this.rollbackAcceptedApplication();
    this.persisted = false;
    this.restorePreparedState();
  }

  /** Keep the staged aggregate alive while a post-persist navigation continuation is retried. */
  clear(): void {
    this.preparedPlayer = undefined;
    this.preparedQuests = undefined;
    this.preparedPendingBattleRewardKeys = undefined;
    this.preparedQuestPresentations = [];
    this.questPresentations = [];
    this.questPresentationCursor = 0;
    this.preparedQuestPresentationCursor = 0;
    this.application = undefined;
    this.applicationAcceptanceAttempted = false;
    this.applicationAccepted = false;
  }

  setPendingBattleReward(treasureId: string, rewardKey: string): void {
    if (treasureId.length === 0 || rewardKey.length === 0) {
      throw new Error("LocalDungeonTerminal: pending reward identity must be non-empty");
    }
    const previous = this.pendingBattleRewards.get(treasureId);
    if (previous !== undefined && previous !== rewardKey) {
      throw new Error(`LocalDungeonTerminal: pending reward conflict for ${treasureId}`);
    }
    this.pendingBattleRewards.set(treasureId, rewardKey);
  }

  pendingBattleRewardSnapshot(): Readonly<Record<string, string>> {
    return Object.freeze(Object.fromEntries(
      [...this.pendingBattleRewards.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ));
  }

  /** Accept every prebuilt local owner before the engine calls persist(). */
  acceptBeforePersist(registerRollback?: (rollback: () => void) => void): void {
    if (this.applicationAccepted) return;
    const application = this.application;
    if (application === undefined) throw new Error("LocalDungeonTerminal: application is missing");
    const rollback = (): void => this.rollbackAcceptedApplication();
    registerRollback?.(rollback);
    this.applicationAcceptanceAttempted = true;
    try {
      application.accept();
      this.applicationAccepted = true;
    } catch (error) {
      this.rollbackAcceptedApplication();
      throw error;
    }
  }

  /** Emit staged quest presentation only after durable persistence and engine adoption. */
  async presentCommittedQuestEvents(): Promise<void> {
    while (this.questPresentationCursor < this.questPresentations.length) {
      const presentation = this.questPresentations[this.questPresentationCursor]!;
      // A descriptor remains owned by this continuation until its consumer resolves. A thrown or
      // rejected notification therefore leaves the cursor on the same item for the next retry;
      // earlier resolved descriptors stay acknowledged and are never redelivered.
      await this.presentQuestEventResult?.(presentation.runtime, presentation.result);
      this.questPresentationCursor += 1;
    }
  }

  stageQuestEventResult(result: GuildQuestEventResult): void {
    if (this.quests === undefined) return;
    this.questPresentations.push({ runtime: this.quests, result });
  }

  onQuestEvent(event: GuildQuestEvent): void {
    if (this.quests === undefined) return;
    const result = event.id === 9
      ? this.quests.recordBattleWin(event)
      : this.quests.fireEvent(event);
    this.stageQuestEventResult(result);
  }

  /** Battle chats belong to the same detached quest state as battle wins. Writing the live
   * runtime here would lose their progression flags when terminal settlement adopts this one. */
  requestChatPresentation(name: string, alwaysShow: boolean): boolean {
    return this.quests?.requestChatPresentation(name, alwaysShow) ?? true;
  }

  onDungeonRoomRosterUpdated(
    instanceName: string,
    floor: number,
    survivingMonstersByRoom: readonly number[],
    _registerRollback?: (rollback: () => void) => void,
  ): void | DungeonRoomRosterUpdateHooks {
    if (this.quests === undefined) return;
    const before = this.quests.stateSnapshot();
    const presentationsBefore = this.questPresentations.length;
    try {
      const result = this.quests.fireEvent({
        id: 4,
        dungeon: { instanceName, floor, survivingMonstersByRoom },
      });
      this.stageQuestEventResult(result);
    } catch (error) {
      this.quests.replaceStateSnapshot(before);
      this.questPresentations.length = presentationsBefore;
      throw error;
    }
    return {
      rollback: () => {
        this.rollbackTerminalPreparation();
        this.quests!.replaceStateSnapshot(before);
        this.questPresentations.length = presentationsBefore;
      },
    };
  }

  hasReceivedBattleReward(key: string): boolean {
    return this.quests?.hasReceivedBattleReward(key) ?? false;
  }

  markBattleRewardReceived(key: string): boolean {
    return this.quests?.markBattleRewardReceived(key) ?? false;
  }

  private restorePreparedState(): void {
    if (this.preparedPlayer === undefined) return;
    this.player.replaceStateSnapshot(this.data, this.preparedPlayer);
    if (this.quests !== undefined && this.preparedQuests !== undefined) {
      this.quests.replaceStateSnapshot(this.preparedQuests);
    }
    this.pendingBattleRewards.clear();
    for (const [treasureId, rewardKey] of Object.entries(this.preparedPendingBattleRewardKeys ?? {})) {
      this.pendingBattleRewards.set(treasureId, rewardKey);
    }
    this.questPresentations = [...this.preparedQuestPresentations];
    this.questPresentationCursor = this.preparedQuestPresentationCursor;
  }

  private rollbackAcceptedApplication(): void {
    if (!this.applicationAcceptanceAttempted) return;
    const application = this.application;
    this.applicationAcceptanceAttempted = false;
    this.applicationAccepted = false;
    application?.rollback();
  }
}

interface QuestPresentation {
  readonly runtime: GuildQuestRuntime;
  readonly result: GuildQuestEventResult;
}
