import type { CollectionGoalDefinition } from "@dib/gamedata/browser";
import type { CollectionGoalProgress, PlayerReward, Rng } from "@dib/engine";
import { describe, expect, it, vi } from "vitest";
import {
  CollectionFlow,
  createCollectionDialogRuntime,
  createLocalCollectionDialogRuntime,
  createLocalCollectionAdapter,
  createOfficialCollectionAdapter,
  type CollectionFlowPresentation,
  type CollectionFlowRowState,
  type CollectionFlowRuntime,
} from "../src/world/collectionFlow.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

function goal(
  key: string,
  monsterTypes: readonly string[],
  rewards: readonly PlayerReward[] = [],
): CollectionGoalDefinition {
  return {
    collectionType: "Base",
    key,
    monsterTypes,
    treasureData: {
      defaultSpawnChance: 1,
      levelScalor: 1,
      items: rewards.map((reward) => reward.kind === "gold"
        ? { kind: "gold" as const, levelScalor: reward.amount }
        : { kind: "silver" as const, levelScalor: 1 }),
    },
  };
}

function progress(
  definition: CollectionGoalDefinition,
  percentComplete: number,
  claimed = false,
): CollectionGoalProgress {
  const total = definition.monsterTypes.length;
  const owned = percentComplete === 100 ? total : 0;
  return {
    goalId: `CollectionQuest${definition.key}`,
    owned,
    total,
    percentComplete,
    complete: percentComplete === 100,
    claimed,
  };
}

class FakePresentation implements CollectionFlowPresentation {
  readonly events: string[] = [];
  readonly messages: Array<{ title: string; message: string; okLabel: string }> = [];
  readonly rewards: Array<readonly PlayerReward[]> = [];
  rows: readonly CollectionFlowRowState[] = [];
  baseTitle: string | undefined;
  baseVisible = false;
  baseMounted = false;
  disposed = false;
  private onSelect: ((goalKey: string) => void) | undefined;
  private onClose: (() => void) | undefined;
  private chatDismiss: (() => void) | undefined;

  async mountBase(options: {
    readonly title: string;
    readonly rows: readonly CollectionFlowRowState[];
    readonly onSelect: (goalKey: string) => void;
    readonly onClose: () => void;
  }): Promise<void> {
    this.events.push("base");
    this.baseMounted = true;
    this.baseTitle = options.title;
    this.rows = options.rows;
    this.onSelect = options.onSelect;
    this.onClose = options.onClose;
    this.baseVisible = true;
  }

  installCompletedTint(goalKeys: readonly string[]): void {
    this.events.push(`tint:${goalKeys.join(",")}`);
  }

  updateRows(rows: readonly CollectionFlowRowState[]): void {
    if (!this.baseMounted) throw new Error("base must mount before row updates");
    this.rows = rows;
  }

  setBaseVisible(visible: boolean): void {
    this.baseVisible = visible;
  }

  async showMessage(options: {
    readonly title: string;
    readonly message: string;
    readonly okLabel: string;
  }): Promise<void> {
    this.events.push("message");
    this.messages.push(options);
  }

  async showChat(message: string, onDismiss: () => void): Promise<void> {
    this.events.push("chat");
    this.chatDismiss = onDismiss;
  }

  async showRewards(rewards: readonly PlayerReward[]): Promise<void> {
    this.events.push("rewards");
    this.rewards.push([...rewards]);
  }

  requestBack(): boolean {
    if (this.chatDismiss !== undefined) {
      const dismiss = this.chatDismiss;
      this.chatDismiss = undefined;
      dismiss();
      return true;
    }
    this.onClose?.();
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.baseVisible = false;
    this.chatDismiss = undefined;
  }

  select(goalKey: string): void {
    this.onSelect?.(goalKey);
  }
}

function strings(values: Record<string, string>): Readonly<Record<string, string>> {
  return new Proxy(values, {
    get(target, key: string) {
      return target[key] ?? key;
    },
  });
}

describe("CollectionFlow", () => {
  it("mounts authored rows, installs complete tint, then requests the intro chat", async () => {
    const incomplete = goal("First", ["FireCub"]);
    const complete = goal("Second", []);
    const presentation = new FakePresentation();
    const events = presentation.events;
    const requestChatPresentation = vi.fn(() => {
      events.push("intro");
      return true;
    });
    const runtime: CollectionFlowRuntime = {
      collectionGoalProgress: (definition) => definition.key === "First"
        ? progress(definition, 0)
        : progress(definition, 100, true),
      claimCollectionGoal: vi.fn() as never,
    };
    const onClose = vi.fn();
    const flow = new CollectionFlow({
      catalog: new Map([["Base", [incomplete, complete]]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        FirstCollectionQuestTitleKey: "First Goal",
        SecondCollectionQuestTitleKey: "Second Goal",
        MonsterCollectionChatKey: "Welcome",
      }),
      runtime,
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation,
      hatchEgg: async () => undefined,
      presentation,
      onClose,
    });

    await flow.show("Base");

    expect(events).toEqual(["base", "tint:Second", "intro", "chat"]);
    expect(presentation.rows).toEqual([
      expect.objectContaining({
        goalKey: "First", label: "First Goal (0%)", complete: false, claimed: false, enabled: true,
      }),
      expect.objectContaining({
        goalKey: "Second", label: "Second Goal (100%)", complete: true, claimed: true, enabled: true,
      }),
    ]);
    expect(presentation.baseVisible).toBe(false);
    expect(requestChatPresentation).toHaveBeenCalledWith("MonsterCollection", true);

    expect(flow.requestBack()).toBe(true);
    expect(presentation.baseVisible).toBe(true);
    expect(flow.debugState).toMatchObject({ kind: "collection", open: true, chatOpen: false });
    expect(flow.requestBack()).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(flow.debugState).toMatchObject({ open: false });
  });

  it("mounts an authored empty root with its title and the normal intro-chat lifecycle", async () => {
    const presentation = new FakePresentation();
    const requestChatPresentation = vi.fn(() => {
      presentation.events.push("intro");
      return true;
    });
    const flow = new CollectionFlow({
      catalog: new Map([["Empty", []]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        MonsterCollectionChatKey: "Welcome",
      }),
      runtime: {
        collectionGoalProgress: vi.fn() as never,
        claimCollectionGoal: vi.fn() as never,
      },
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation,
      hatchEgg: async () => undefined,
      presentation,
      onClose: vi.fn(),
    });

    await flow.show("Empty");

    expect(presentation.events).toEqual(["base", "intro", "chat"]);
    expect(presentation.baseTitle).toBe("Collection Quests");
    expect(presentation.rows).toEqual([]);
    expect(presentation.baseVisible).toBe(false);
    expect(requestChatPresentation).toHaveBeenCalledWith("MonsterCollection", true);
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "intro-chat", goalKey: null },
    });

    expect(flow.requestBack()).toBe(true);
    expect(presentation.baseVisible).toBe(true);
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "none", goalKey: null },
    });
    expect(flow.requestBack()).toBe(true);
  });




  it("replays the Old Sage intro on every visit through the real durable dialog owner", async () => {
    const dialogs = createCollectionDialogRuntime();
    const visit = async (): Promise<FakePresentation> => {
      const presentation = new FakePresentation();
      const flow = new CollectionFlow({
        catalog: new Map([["Base", []]]),
        strings: strings({ MonsterCollectionChatKey: "Old Sage:\n\"Welcome to my humble abode.\"" }),
        runtime: {
          collectionGoalProgress: vi.fn() as never,
          claimCollectionGoal: vi.fn() as never,
        },
        rng: {} as Rng,
        allocateMonsterInstanceId: () => "unused",
        requestChatPresentation: (name, alwaysShow) =>
          dialogs.requestChatPresentation(name, alwaysShow),
        hatchEgg: async () => undefined,
        presentation,
        onClose: vi.fn(),
      });
      await flow.show("Base");
      return presentation;
    };

    const first = await visit();
    expect(first.events).toEqual(["base", "chat"]);
    expect(first.baseVisible).toBe(false);
    // Seen is still recorded before presentation; it simply cannot gate an alwaysShow record.
    expect(dialogs.stateSnapshot().dialogsSeen).toEqual(["MonsterCollection"]);

    const second = await visit();
    expect(second.events).toEqual(["base", "chat"]);
    expect(second.baseVisible).toBe(false);

    // A reload restores dialogsSeen; the greeting must survive it.
    const restored = createCollectionDialogRuntime(dialogs.stateSnapshot());
    expect(restored.requestChatPresentation("MonsterCollection", true)).toBe(true);
  });

  it("reports each owned nested presentation while it dismisses and restores the base", async () => {
    const incomplete = goal("Incomplete", ["FireCub"]);
    const repeat = goal("Repeat", []);
    const loot = goal("Loot", []);
    const presentation = new LifecyclePresentation();
    const claimCollectionGoal = vi.fn((definition: CollectionGoalDefinition) => ({
      ok: true as const,
      progress: progress(definition, 100, true),
      rewards: [{ kind: "gold" as const, amount: 7 }],
      applied: [{ kind: "gold" as const, amount: 7, balance: 7 }],
      pendingEggs: [],
    }));
    const flow = new CollectionFlow({
      catalog: new Map([["Base", [incomplete, repeat, loot]]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        IncompleteCollectionQuestTitleKey: "Incomplete",
        IncompleteCollectionQuestDescriptionKey: "Find one.",
        RepeatCollectionQuestTitleKey: "Repeat",
        LootCollectionQuestTitleKey: "Loot",
        CollectionGoalKey: "Collection Goal",
        AlreadyFinishedCollectionQuestTitleKey: "Already Finished",
        AlreadyFinishedCollectionQuestMessageKey: "Already claimed.",
        OkButtonKey: "OK",
      }),
      runtime: {
        collectionGoalProgress: (definition) => definition.key === "Incomplete"
          ? progress(definition, 0)
          : progress(definition, 100, definition.key === "Repeat"),
        claimCollectionGoal,
      },
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation: () => false,
      hatchEgg: async () => undefined,
      presentation,
      onClose: vi.fn(),
    });
    await flow.show("Base");

    presentation.select("Incomplete");
    await Promise.resolve();
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "description", goalKey: "Incomplete" },
    });
    expect(presentation.baseVisible).toBe(true);
    expect(flow.requestBack()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "none", goalKey: null },
    });
    expect(presentation.baseVisible).toBe(true);

    presentation.select("Repeat");
    await Promise.resolve();
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "repeat", goalKey: "Repeat" },
    });
    expect(flow.requestBack()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "none", goalKey: null },
    });

    presentation.select("Loot");
    await Promise.resolve();
    expect(claimCollectionGoal).toHaveBeenCalledTimes(1);
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "committed-loot", goalKey: "Loot" },
    });
    expect(flow.requestBack()).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(flow.debugState).toMatchObject({
      ownedPresentation: { kind: "none", goalKey: null },
    });
    expect(presentation.baseVisible).toBe(true);
  });

  // Unreachable for `MonsterCollection` itself, whose synthesized record keeps `alwaysShow` true;
  // this pins the generic contract the shared seam still owes an authored show-once record.
  it("leaves the retained base visible when the intro request reports suppressed", async () => {
    const definition = goal("Seen", ["FireCub"]);
    const presentation = new FakePresentation();
    const requestChatPresentation = vi.fn(() => false);
    const flow = new CollectionFlow({
      catalog: new Map([["Base", [definition]]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        SeenCollectionQuestTitleKey: "Seen Goal",
        MonsterCollectionChatKey: "Do not repeat",
      }),
      runtime: {
        collectionGoalProgress: (value) => progress(value, 0),
        claimCollectionGoal: vi.fn() as never,
      },
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation,
      hatchEgg: async () => undefined,
      presentation,
      onClose: vi.fn(),
    });

    await flow.show("Base");

    expect(presentation.events).toEqual(["base"]);
    expect(presentation.baseVisible).toBe(true);
    expect(requestChatPresentation).toHaveBeenCalledWith("MonsterCollection", true);
  });

  it("recomputes activation progress for incomplete, first-claim, and repeat branches", async () => {
    const incomplete = goal("Incomplete", ["FireCub"]);
    const complete = goal("Complete", [], [{ kind: "gold", amount: 7 }]);
    const presentation = new FakePresentation();
    const claimed = new Set<string>();
    const claimCollectionGoal = vi.fn((definition: CollectionGoalDefinition) => {
      if (claimed.has(definition.key)) {
        return { ok: false as const, reason: "already-claimed" as const, progress: progress(definition, 100, true) };
      }
      claimed.add(definition.key);
      return {
        ok: true as const,
        progress: progress(definition, 100, true),
        rewards: [{ kind: "gold" as const, amount: 7 }],
        applied: [{ kind: "gold" as const, amount: 7, balance: 7 }],
        pendingEggs: [],
      };
    });
    const runtime: CollectionFlowRuntime = {
      collectionGoalProgress: (definition) => definition.key === "Incomplete"
        ? progress(definition, 0)
        : progress(definition, 100, claimed.has(definition.key)),
      claimCollectionGoal,
    };
    const flow = new CollectionFlow({
      catalog: new Map([["Base", [incomplete, complete]]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        IncompleteCollectionQuestTitleKey: "Incomplete",
        IncompleteCollectionQuestDescriptionKey: "Find one Fire Cub.",
        CompleteCollectionQuestTitleKey: "Complete",
        CollectionGoalKey: "Collection Goal",
        OkButtonKey: "OK",
        AlreadyFinishedCollectionQuestTitleKey: "Already Finished",
        AlreadyFinishedCollectionQuestMessageKey: "Already claimed.",
      }),
      runtime,
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "collection-reward",
      requestChatPresentation: () => false,
      hatchEgg: async () => undefined,
      presentation,
      onClose: vi.fn(),
    });
    await flow.show("Base");

    presentation.select("Incomplete");
    await Promise.resolve();
    expect(presentation.messages.at(-1)).toEqual({
      title: "Collection Goal", message: "Find one Fire Cub.", okLabel: "OK",
    });

    presentation.select("Complete");
    await Promise.resolve();
    expect(claimCollectionGoal).toHaveBeenCalledTimes(1);
    expect(presentation.rewards).toEqual([[{ kind: "gold", amount: 7 }]]);
    expect(presentation.rows.find(({ goalKey }) => goalKey === "Complete"))
      .toMatchObject({ claimed: true, enabled: true });

    // The claim seam is awaited (an official claim round-trips to the authority), so the loot page
    // settles one tick after the rows do; the flow refuses reentry until then.
    await Promise.resolve();
    presentation.select("Complete");
    await Promise.resolve();
    expect(claimCollectionGoal).toHaveBeenCalledTimes(1);
    expect(presentation.messages.at(-1)).toEqual({
      title: "Already Finished", message: "Already claimed.", okLabel: "OK",
    });
  });

  it("rejects reentrant activation and prevents stale asynchronous UI after disposal", async () => {
    const complete = goal("Complete", []);
    let resolveRewards!: () => void;
    const rewardsDismissed = new Promise<void>((resolve) => { resolveRewards = resolve; });
    const presentation = new FakePresentation();
    presentation.showRewards = vi.fn(async (rewards: readonly PlayerReward[]) => {
      presentation.rewards.push([...rewards]);
      await rewardsDismissed;
    });
    const claimCollectionGoal = vi.fn((definition: CollectionGoalDefinition) => ({
      ok: true as const,
      progress: progress(definition, 100, true),
      rewards: [{ kind: "gold" as const, amount: 1 }],
      applied: [{ kind: "gold" as const, amount: 1, balance: 1 }],
      pendingEggs: [],
    }));
    const onClose = vi.fn();
    const flow = new CollectionFlow({
      catalog: new Map([["Base", [complete]]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        CompleteCollectionQuestTitleKey: "Complete",
      }),
      runtime: {
        collectionGoalProgress: (definition) => progress(definition, 100),
        claimCollectionGoal,
      },
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation: () => false,
      hatchEgg: async () => undefined,
      presentation,
      onClose,
    });
    await flow.show("Base");

    presentation.select("Complete");
    presentation.select("Complete");
    await Promise.resolve();
    expect(claimCollectionGoal).toHaveBeenCalledTimes(1);

    flow.dispose();
    resolveRewards();
    await Promise.resolve();
    expect(presentation.disposed).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(flow.debugState).toMatchObject({ open: false });
  });

  it("accepts scene ticks during the asynchronous base mount without touching unowned rows", async () => {
    const definition = goal("Mounting", []);
    const presentation = new FakePresentation();
    const mountBase = presentation.mountBase.bind(presentation);
    let releaseMount!: () => void;
    const mountGate = new Promise<void>((resolve) => { releaseMount = resolve; });
    presentation.mountBase = async (options) => {
      await mountGate;
      await mountBase(options);
    };
    const flow = new CollectionFlow({
      catalog: new Map([["Base", [definition]]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        MountingCollectionQuestTitleKey: "Mounting",
      }),
      runtime: {
        collectionGoalProgress: (value) => progress(value, 100),
        claimCollectionGoal: vi.fn() as never,
      },
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation: () => false,
      hatchEgg: async () => undefined,
      presentation,
      onClose: vi.fn(),
    });

    const shown = flow.show("Base");
    expect(() => flow.update(250)).not.toThrow();
    releaseMount();
    await shown;

    expect(presentation.rows[0]).toMatchObject({ tint: 0xffff80 });
  });

  it("treats a claim-time already-claimed result as the standard repeat branch", async () => {
    const definition = goal("Stale", []);
    const presentation = new FakePresentation();
    const collectionGoalProgress = vi.fn((value: CollectionGoalDefinition) =>
      progress(value, 100, false));
    const claimCollectionGoal = vi.fn((value: CollectionGoalDefinition) => ({
      ok: false as const,
      reason: "already-claimed" as const,
      progress: progress(value, 100, true),
    }));
    const flow = new CollectionFlow({
      catalog: new Map([["Base", [definition]]]),
      strings: strings({
        CollectionHutListTitleKey: "Collection Quests",
        StaleCollectionQuestTitleKey: "Stale Goal",
        AlreadyFinishedCollectionQuestTitleKey: "Already Finished",
        AlreadyFinishedCollectionQuestMessageKey: "Already claimed.",
        OkButtonKey: "OK",
      }),
      runtime: { collectionGoalProgress, claimCollectionGoal },
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation: () => false,
      hatchEgg: async () => undefined,
      presentation,
      onClose: vi.fn(),
    });
    await flow.show("Base");

    presentation.select("Stale");
    await Promise.resolve();

    expect(claimCollectionGoal).toHaveBeenCalledTimes(1);
    expect(collectionGoalProgress).toHaveBeenCalledTimes(4);
    expect(presentation.rewards).toEqual([]);
    expect(presentation.messages).toEqual([{
      title: "Already Finished", message: "Already claimed.", okLabel: "OK",
    }]);
  });

  it("fails loudly for a missing collection root", async () => {
    const flow = new CollectionFlow({
      catalog: new Map(),
      strings: strings({}),
      runtime: {} as CollectionFlowRuntime,
      rng: {} as Rng,
      allocateMonsterInstanceId: () => "unused",
      requestChatPresentation: () => false,
      hatchEgg: async () => undefined,
      presentation: new FakePresentation(),
      onClose: vi.fn(),
    });

    await expect(flow.show("Missing")).rejects.toThrow(/missing collection type Missing/);
  });
});

describe("createLocalCollectionAdapter", () => {
  it("installs only for local persisted dialogs and reuses the collision-safe reward ID seam", () => {
    const requestChatPresentation = vi.fn(() => true);
    const nextPartyInstanceId = vi.fn((prefix: string, shortType: string) =>
      `${prefix}-1-${shortType}`);
    const dialogs = { requestChatPresentation };

    expect(createLocalCollectionAdapter({
      official: true,
      hasCollectionRoute: true,
      dialogs,
      nextPartyInstanceId,
    })).toBeUndefined();
    expect(createLocalCollectionAdapter({
      official: false,
      hasCollectionRoute: false,
      dialogs: undefined,
      nextPartyInstanceId,
    })).toBeUndefined();

    const adapter = createLocalCollectionAdapter({
      official: false,
      hasCollectionRoute: true,
      dialogs,
      nextPartyInstanceId,
    });
    expect(adapter?.requestChatPresentation("MonsterCollection", true)).toBe(true);
    expect(adapter?.allocateMonsterInstanceId("FireCub", 5)).toBe(
      "collection-reward-1-FireCub",
    );
    expect(requestChatPresentation).toHaveBeenCalledWith("MonsterCollection", true);
    expect(nextPartyInstanceId).toHaveBeenCalledWith("collection-reward", "FireCub");
  });

  it("does not install for an unrelated package even when a Guild dialog owner exists", () => {
    expect(createLocalCollectionDialogRuntime({
      official: false,
      hasCollectionRoute: false,
    })).toBeUndefined();
    expect(createLocalCollectionAdapter({
      official: false,
      hasCollectionRoute: false,
      dialogs: { requestChatPresentation: vi.fn() },
      nextPartyInstanceId: vi.fn(),
    })).toBeUndefined();
  });

  it("uses dialogsSeen as the Collection-only persistence owner without accepting quest state", () => {
    const dialogs = createCollectionDialogRuntime();
    expect(dialogs.requestChatPresentation("MonsterCollection", false)).toBe(true);
    const snapshot = dialogs.stateSnapshot();
    expect(snapshot).toMatchObject({
      activeQuestNames: [],
      finishedQuestNames: [],
      progressByQuestName: {},
      dialogsSeen: ["MonsterCollection"],
      completedFixedEncounterKeys: [],
      receivedBattleRewardKeys: [],
    });
    expect(createCollectionDialogRuntime(snapshot).requestChatPresentation(
      "MonsterCollection",
      false,
    )).toBe(false);
    expect(() => createCollectionDialogRuntime({
      ...snapshot,
      activeQuestNames: ["GuildQuest"],
    })).toThrow(/quest state requires Quests\.plist/i);
  });

  it("restores dialog-only state for a promoted local route and checkpoints future dialog mutations", () => {
    const restored = createCollectionDialogRuntime();
    expect(restored.requestChatPresentation("MonsterCollection", false)).toBe(true);
    const snapshot = restored.stateSnapshot();
    const checkpoint = vi.fn();
    const owner = createLocalCollectionDialogRuntime({
      official: false,
      hasCollectionRoute: true,
      snapshot,
    });
    owner?.setMutationListener(checkpoint);

    expect(owner?.stateSnapshot().dialogsSeen).toEqual(["MonsterCollection"]);
    expect(owner?.requestChatPresentation("CollectionFollowup", false)).toBe(true);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(owner?.stateSnapshot().dialogsSeen).toEqual([
      "CollectionFollowup",
      "MonsterCollection",
    ]);
  });

  it("rejects restored quest state without a quest catalog even when world presentation is disabled", () => {
    const snapshot = createCollectionDialogRuntime().stateSnapshot();
    expect(() => createLocalCollectionDialogRuntime({
      official: false,
      hasCollectionRoute: true,
      snapshot: { ...snapshot, activeQuestNames: ["GuildQuest"] },
    })).toThrow(/Collection-only package.*Quests\.plist/i);
  });

  it("keeps Official missing-catalog restore fail-closed and does not create a local owner", () => {
    expect(createLocalCollectionDialogRuntime({
      official: true,
      hasCollectionRoute: true,
    })).toBeUndefined();
    expect(() => createLocalCollectionDialogRuntime({
      official: true,
      hasCollectionRoute: true,
      snapshot: createCollectionDialogRuntime().stateSnapshot(),
    })).toThrow(/saved game contains Guild quest state.*Quests\.plist/i);
  });
});

describe("createOfficialCollectionAdapter", () => {
  function officialFixture(options: {
    readonly claimed?: boolean;
    readonly complete?: boolean;
  } = {}) {
    const definition = goal("Complete", ["FireCub"], [{ kind: "gold", amount: 7 }]);
    const committed = {
      progress: progress(definition, 100, true),
      rewards: [
        { kind: "gold" as const, amount: 7 },
        { kind: "monsterJoin" as const, shortType: "FireCub", jobLevel: 3 },
      ],
      applied: [],
      pendingEggs: ["gold"] as const,
    };
    const mirrorCommittedCollectionClaim = vi.fn(() => committed);
    const collectionGoalProgress = vi.fn(() =>
      progress(definition, options.complete === false ? 40 : 100, options.claimed ?? false));
    const claim = vi.fn(async (_goalId: string) => ({
      rewards: committed.rewards,
      committedMonsterIds: ["authority-minted-9"],
    }));
    const adapter = createOfficialCollectionAdapter({
      official: true,
      hasCollectionRoute: true,
      introChatSeen: new Set<string>(),
      mirror: () => ({ collectionGoalProgress, mirrorCommittedCollectionClaim }),
      claim,
    });
    return { adapter, definition, claim, collectionGoalProgress, mirrorCommittedCollectionClaim };
  }

  it("installs only for an Official session that actually carries the Collection catalog", () => {
    const seams = {
      introChatSeen: new Set<string>(),
      mirror: () => { throw new Error("unused"); },
      claim: async () => { throw new Error("unused"); },
    };
    expect(createOfficialCollectionAdapter({
      ...seams, official: false, hasCollectionRoute: true,
    })).toBeUndefined();
    expect(createOfficialCollectionAdapter({
      ...seams, official: true, hasCollectionRoute: false,
    })).toBeUndefined();
    expect(createOfficialCollectionAdapter({
      ...seams, official: true, hasCollectionRoute: true,
    })?.mode).toBe("official");
  });

  it("claims once through the authority and mirrors the committed rewards and minted ids", async () => {
    const { adapter, definition, claim, mirrorCommittedCollectionClaim } = officialFixture();

    const result = await adapter?.runtime?.claimCollectionGoal(
      definition,
      {} as Rng,
      () => "never-used",
    );

    expect(claim).toHaveBeenCalledTimes(1);
    expect(claim).toHaveBeenCalledWith("CollectionQuestComplete");
    expect(mirrorCommittedCollectionClaim).toHaveBeenCalledWith(
      definition,
      [
        { kind: "gold", amount: 7 },
        { kind: "monsterJoin", shortType: "FireCub", jobLevel: 3 },
      ],
      ["authority-minted-9"],
    );
    expect(result).toMatchObject({
      ok: true,
      pendingEggs: ["gold"],
      progress: { claimed: true },
    });
  });

  it("refuses an incomplete or already-claimed goal without spending a command", async () => {
    const incomplete = officialFixture({ complete: false });
    await expect(incomplete.adapter?.runtime?.claimCollectionGoal(
      incomplete.definition, {} as Rng, () => "never-used",
    )).resolves.toMatchObject({ ok: false, reason: "incomplete" });
    expect(incomplete.claim).not.toHaveBeenCalled();

    const claimed = officialFixture({ claimed: true });
    await expect(claimed.adapter?.runtime?.claimCollectionGoal(
      claimed.definition, {} as Rng, () => "never-used",
    )).resolves.toMatchObject({ ok: false, reason: "already-claimed" });
    expect(claimed.claim).not.toHaveBeenCalled();
  });

  it("refuses to mint a reward id locally, because the authority owns every instance id", () => {
    const { adapter } = officialFixture();
    expect(() => adapter?.allocateMonsterInstanceId("FireCub", 5))
      .toThrow(/authority-minted instance ids/i);
  });

  it("shows the intro chat once per seen-set and still honours an always-show request", () => {
    const introChatSeen = new Set<string>();
    const adapter = createOfficialCollectionAdapter({
      official: true,
      hasCollectionRoute: true,
      introChatSeen,
      mirror: () => { throw new Error("unused"); },
      claim: async () => { throw new Error("unused"); },
    });

    expect(adapter?.requestChatPresentation("MonsterCollection", false)).toBe(true);
    expect(adapter?.requestChatPresentation("MonsterCollection", false)).toBe(false);
    expect(adapter?.requestChatPresentation("MonsterCollection", true)).toBe(true);
    expect([...introChatSeen]).toEqual(["MonsterCollection"]);
  });
});

class LifecyclePresentation implements CollectionFlowPresentation {
  rows: readonly CollectionFlowRowState[] = [];
  baseVisible = false;
  private onSelect: ((goalKey: string) => void) | undefined;
  private releaseChild: (() => void) | undefined;

  async mountBase(options: {
    readonly title: string;
    readonly rows: readonly CollectionFlowRowState[];
    readonly onSelect: (goalKey: string) => void;
    readonly onClose: () => void;
  }): Promise<void> {
    this.rows = options.rows;
    this.onSelect = options.onSelect;
    this.baseVisible = true;
  }

  installCompletedTint(): void {}
  updateRows(rows: readonly CollectionFlowRowState[]): void { this.rows = rows; }
  setBaseVisible(visible: boolean): void { this.baseVisible = visible; }

  async showMessage(): Promise<void> {
    await new Promise<void>((resolve) => { this.releaseChild = resolve; });
    this.releaseChild = undefined;
  }

  async showChat(): Promise<void> {}

  async showRewards(): Promise<void> {
    await new Promise<void>((resolve) => { this.releaseChild = resolve; });
    this.releaseChild = undefined;
  }

  requestBack(): boolean {
    if (this.releaseChild === undefined) return false;
    this.releaseChild();
    return true;
  }

  dispose(): void {
    this.releaseChild?.();
    this.releaseChild = undefined;
    this.baseVisible = false;
  }

  select(goalKey: string): void { this.onSelect?.(goalKey); }
}
