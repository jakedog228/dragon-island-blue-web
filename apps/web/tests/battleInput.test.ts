import { describe, expect, it, vi } from "vitest";
import type { PlayerChoice } from "@dib/engine";
import { ButtonSprite } from "@dib/renderer";
import { Container, Rectangle, Texture, type FederatedPointerEvent } from "pixi.js";
import { BattleNode } from "../src/battle/battleNode.js";
import { MonsterTurnPanel } from "../src/battle/monsterTurnPanel.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

const ENEMY_CHOICE: PlayerChoice = {
  slot: "usable1",
  abilityPath: "Offensive.Test.Strike",
  displayName: "Strike",
  tier: undefined,
  activationLength: 100,
  targeting: { kind: "enemies", count: 1 },
};

const ALL_ENEMIES_CHOICE: PlayerChoice = {
  ...ENEMY_CHOICE,
  abilityPath: "Offensive.Test.AllStrike",
  targeting: { kind: "allEnemies" },
};

type SwipeMatch = { name: string; midpoint: { x: number; y: number } };

interface InternalPanel {
  choicesBySlot: Map<number, PlayerChoice>;
  handleSwipeMatch(match: SwipeMatch): void;
}

interface ChoiceResultHarness {
  readonly audio: { playSfx: ReturnType<typeof vi.fn> };
  readonly panel: MonsterTurnPanel;
  readonly panelInternal: InternalPanel;
  readonly showPanel: ReturnType<typeof vi.fn>;
  readonly setPanelShown: ReturnType<typeof vi.fn>;
  readonly friendlyAttack: ReturnType<typeof vi.fn>;
  readonly showMessagePopup: ReturnType<typeof vi.fn>;
  awaitChoice(choice: PlayerChoice): Promise<unknown>;
}

function makeChoiceResultHarness(input: {
  readonly queueIds: readonly string[];
  readonly targetableIds: readonly string[];
  readonly boundsById?: Readonly<Record<string, { x: number; y: number; width: number; height: number }>>;
}): ChoiceResultHarness {
  const panel = Object.create(MonsterTurnPanel.prototype) as MonsterTurnPanel;
  const panelInternal = panel as unknown as InternalPanel;
  panelInternal.choicesBySlot = new Map();

  const audio = { playSfx: vi.fn() };
  const showPanel = vi.fn(async () => {});
  const setPanelShown = vi.fn();
  const friendlyAttack = vi.fn();
  const showMessagePopup = vi.fn(async () => {});
  const node = Object.create(BattleNode.prototype) as unknown as {
    panel: MonsterTurnPanel;
    audio: typeof audio;
    session: {
      queueOrder(): readonly string[];
      teamOf(id: string): 0 | 1;
      targetableIdsOf(team: 0 | 1): readonly string[];
    };
    scene: {
      toLocal(point: { x: number; y: number }): { x: number; y: number };
      toGlobal(point: { x: number; y: number }): { x: number; y: number };
    };
    targetNodeOf(id: string): { visible: boolean; getBounds(): { x: number; y: number; width: number; height: number } };
    targetRefOf(id: string): { id: string; hitNode: { visible: boolean } };
    targetRefGlobalBounds(ref: { id: string }): { x: number; y: number; width: number; height: number };
    friendlySnapshotOf(id: string): object;
    showPanel: typeof showPanel;
    setPanelShown: typeof setPanelShown;
    friendlyDisplay: { setSummonSelectMode: typeof friendlyAttack };
    targetPicker: { showMessagePopup: typeof showMessagePopup };
    awaitPlayerChoice(step: { actorId: string; choices: readonly PlayerChoice[] }): Promise<unknown>;
  };
  node.panel = panel;
  node.audio = audio;
  node.session = {
    queueOrder: () => input.queueIds,
    teamOf: () => 1,
    targetableIdsOf: () => input.targetableIds,
  };
  node.scene = { toLocal: (point) => point, toGlobal: (point) => point };
  node.targetNodeOf = (id) => ({
    visible: true,
    getBounds: () => input.boundsById?.[id] ?? { x: 0, y: 0, width: 10, height: 10 },
  });
  node.targetRefOf = (id) => ({ id, hitNode: { visible: true } });
  node.targetRefGlobalBounds = (ref) => (
    input.boundsById?.[ref.id] ?? { x: 0, y: 0, width: 10, height: 10 }
  );
  node.friendlySnapshotOf = vi.fn(() => ({}));
  node.showPanel = showPanel;
  node.setPanelShown = setPanelShown;
  node.friendlyDisplay = { setSummonSelectMode: friendlyAttack };
  node.targetPicker = { showMessagePopup };

  return {
    audio,
    panel,
    panelInternal,
    showPanel,
    setPanelShown,
    friendlyAttack,
    showMessagePopup,
    awaitChoice: (choice) => node.awaitPlayerChoice({ actorId: "hero", choices: [choice] }),
  };
}

async function expectPending(choiceResult: Promise<unknown>): Promise<void> {
  let settled = false;
  void choiceResult.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
}

describe("Battle target-node geometry", () => {
  it("uses the full enemy display for selection while retaining the monster sprite for visuals", () => {
    const hitNode = new Container();
    const visualNode = new Container();
    const node = Object.create(BattleNode.prototype) as unknown as {
      session: { teamOf(id: string): 0 | 1 };
      enemyDisplay: { nodeOf(id: string): Container; targetNodeOf(id: string): Container };
      targetRefOf(id: string): {
        id: string;
        hitNode: Container;
        visualNode: Container;
        contentSize: { w: number; h: number };
      };
    };
    node.session = { teamOf: () => 1 };
    node.enemyDisplay = { nodeOf: () => hitNode, targetNodeOf: () => visualNode };

    const ref = node.targetRefOf("enemy");
    expect(ref.id).toBe("enemy");
    expect(ref.hitNode).toBe(hitNode);
    expect(ref.visualNode).toBe(visualNode);
    expect(ref.contentSize.w).toBe(128);
    expect([210, 274]).toContain(ref.contentSize.h);
  });
});

function swipe(panel: InternalPanel, name = "leftToRight", midpoint = { x: 5, y: 5 }): void {
  panel.handleSwipeMatch({ name, midpoint });
}

function pointerEvent(button: ButtonSprite, x: number, y: number, pointerId: number) {
  return {
    pointerId,
    global: { x, y },
    // Texture.EMPTY is 1px and ButtonSprite folds it to 0.5pt. Preserve the global panel path but
    // map the same sequence into that real button-local content rect for containment callbacks.
    getLocalPosition: (target: unknown) => (target === button ? { x: x / 200, y: y / 200 } : { x, y }),
    propagationStopped: false,
    stopPropagation() {
      this.propagationStopped = true;
    },
  };
}

function dispatchFromButton(
  button: ButtonSprite,
  panel: MonsterTurnPanel,
  type: "pointerdown" | "globalpointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
  pointerId: number,
): void {
  const event = pointerEvent(button, x, y, pointerId);
  const federatedEvent = event as unknown as FederatedPointerEvent;
  button.emit(type, federatedEvent);
  if (!event.propagationStopped) panel.emit(type, federatedEvent);
}

function dispatchToPanel(
  button: ButtonSprite,
  panel: MonsterTurnPanel,
  type: "pointerdown" | "globalpointermove" | "pointerup" | "pointercancel",
  x: number,
  y: number,
  pointerId: number,
): void {
  panel.emit(type, pointerEvent(button, x, y, pointerId) as unknown as FederatedPointerEvent);
}

function makePanelButtonArbitrationHarness() {
  const panel = new MonsterTurnPanel({
    assets: {} as never,
    ticker: {} as never,
    profile: {} as never,
    onHeroPress: () => {},
  });
  const internal = panel as unknown as {
    choicesBySlot: Map<number, PlayerChoice>;
    gestureRecognizer: { setEnabled(enabled: boolean): void };
  };
  internal.choicesBySlot.set(1, ENEMY_CHOICE);
  internal.gestureRecognizer.setEnabled(true);
  panel.visible = true;

  const picker = vi.fn();
  const submission = vi.fn();
  panel.onNeedsTargets(picker);
  panel.onPick(submission);

  const button = new ButtonSprite({ normalTexture: Texture.EMPTY });
  button.hitArea = new Rectangle(0, 0, 75, 75);
  button.onPress(() => panel.activateAbilitySlot(1));
  panel.addChild(button);
  return { panel, button, picker, submission };
}

describe("MonsterTurnPanel child-button arbitration", () => {
  it("a recognized glyph wholly inside an ability card opens only its picker", () => {
    const { panel, button, picker, submission } = makePanelButtonArbitrationHarness();

    dispatchFromButton(button, panel, "pointerdown", 10, 30, 11);
    dispatchFromButton(button, panel, "globalpointermove", 50, 30, 11);
    dispatchFromButton(button, panel, "pointerup", 50, 30, 11);

    expect(picker).toHaveBeenCalledTimes(1);
    expect(submission).not.toHaveBeenCalled();
  });

  it("an additional pointer beginning inside is swallowed and cannot release the owner's press", () => {
    const { panel, button, picker, submission } = makePanelButtonArbitrationHarness();

    dispatchFromButton(button, panel, "pointerdown", 10, 30, 11);
    dispatchFromButton(button, panel, "pointerdown", 10, 30, 22);
    dispatchFromButton(button, panel, "globalpointermove", 50, 30, 22);
    dispatchFromButton(button, panel, "pointerup", 50, 30, 22);
    expect(picker).not.toHaveBeenCalled();
    expect(submission).not.toHaveBeenCalled();

    dispatchFromButton(button, panel, "pointerup", 10, 30, 11);
    expect(picker).toHaveBeenCalledTimes(1);
  });

  it("an outside-start panel gesture crosses a held button without altering its owner", () => {
    const { panel, button, picker, submission } = makePanelButtonArbitrationHarness();

    dispatchFromButton(button, panel, "pointerdown", 10, 30, 11);
    dispatchToPanel(button, panel, "pointerdown", -30, 30, 22);
    dispatchFromButton(button, panel, "globalpointermove", 30, 30, 22);
    dispatchFromButton(button, panel, "pointerup", 30, 30, 22);

    expect(submission).toHaveBeenCalledTimes(1);
    expect(submission).toHaveBeenCalledWith(ENEMY_CHOICE, "swipe", { x: 0, y: 30 });
    expect(picker).not.toHaveBeenCalled();

    dispatchFromButton(button, panel, "pointerup", 10, 30, 11);
    expect(picker).toHaveBeenCalledTimes(1);
  });
});

describe("Battle input empty-target feedback (-[MonsterTurnPanel handleRecognizer:] @ 0xa2258)", () => {
  it("requests notAllowed and leaves the turn open when midpoint selection finds no enemy", async () => {
    const harness = makeChoiceResultHarness({ queueIds: [], targetableIds: [] });
    harness.panelInternal.choicesBySlot.set(1, ENEMY_CHOICE);
    const choiceResult = harness.awaitChoice(ENEMY_CHOICE);

    swipe(harness.panelInternal);

    expect(harness.audio.playSfx).toHaveBeenCalledTimes(1);
    expect(harness.audio.playSfx).toHaveBeenCalledWith("notAllowed");
    expect(harness.showPanel).toHaveBeenCalledTimes(1);
    expect(harness.setPanelShown).not.toHaveBeenCalled();
    expect(harness.friendlyAttack).not.toHaveBeenCalled();
    await expectPending(choiceResult);
  });

  it("requests notAllowed and leaves the turn open when validation removes the midpoint candidate", async () => {
    const harness = makeChoiceResultHarness({ queueIds: ["enemy"], targetableIds: [] });
    harness.panelInternal.choicesBySlot.set(1, ENEMY_CHOICE);
    const choiceResult = harness.awaitChoice(ENEMY_CHOICE);

    swipe(harness.panelInternal);

    expect(harness.audio.playSfx).toHaveBeenCalledTimes(1);
    expect(harness.audio.playSfx).toHaveBeenCalledWith("notAllowed");
    expect(harness.showPanel).toHaveBeenCalledTimes(1);
    expect(harness.setPanelShown).not.toHaveBeenCalled();
    expect(harness.friendlyAttack).not.toHaveBeenCalled();
    await expectPending(choiceResult);
  });

  it("requests notAllowed and leaves the turn open when the midpoint misses every targetable enemy", async () => {
    const harness = makeChoiceResultHarness({
      queueIds: ["enemy"],
      targetableIds: ["enemy"],
      boundsById: { enemy: { x: 100, y: 100, width: 10, height: 10 } },
    });
    harness.panelInternal.choicesBySlot.set(1, ENEMY_CHOICE);
    const choiceResult = harness.awaitChoice(ENEMY_CHOICE);

    swipe(harness.panelInternal);

    expect(harness.audio.playSfx).toHaveBeenCalledTimes(1);
    expect(harness.audio.playSfx).toHaveBeenCalledWith("notAllowed");
    expect(harness.showPanel).toHaveBeenCalledTimes(1);
    expect(harness.setPanelShown).not.toHaveBeenCalled();
    expect(harness.friendlyAttack).not.toHaveBeenCalled();
    await expectPending(choiceResult);
  });

  it("requests notAllowed and leaves the turn open when an all-enemy swipe has no candidates", async () => {
    const harness = makeChoiceResultHarness({ queueIds: [], targetableIds: [] });
    harness.panelInternal.choicesBySlot.set(1, ALL_ENEMIES_CHOICE);
    const choiceResult = harness.awaitChoice(ALL_ENEMIES_CHOICE);

    swipe(harness.panelInternal);

    expect(harness.audio.playSfx).toHaveBeenCalledTimes(1);
    expect(harness.audio.playSfx).toHaveBeenCalledWith("notAllowed");
    expect(harness.showPanel).toHaveBeenCalledTimes(1);
    expect(harness.setPanelShown).not.toHaveBeenCalled();
    expect(harness.friendlyAttack).not.toHaveBeenCalled();
    await expectPending(choiceResult);
  });
});

describe("Battle input non-empty-target exits", () => {
  it("chooses midpoint-nearest from targetable enemies instead of rejecting an untargetable nearer enemy", async () => {
    const harness = makeChoiceResultHarness({
      queueIds: ["untargetable-near", "targetable-far"],
      targetableIds: ["targetable-far"],
      boundsById: {
        "untargetable-near": { x: 0, y: 0, width: 10, height: 10 },
        "targetable-far": { x: 0, y: 0, width: 210, height: 10 },
      },
    });
    harness.panelInternal.choicesBySlot.set(1, ENEMY_CHOICE);
    const choiceResult = harness.awaitChoice(ENEMY_CHOICE);
    let resolved: unknown;
    void choiceResult.then((result) => {
      resolved = result;
    });

    swipe(harness.panelInternal);
    await Promise.resolve();

    expect(resolved).toEqual({ kind: "ability", choice: ENEMY_CHOICE, targets: ["targetable-far"] });
    expect(harness.audio.playSfx).not.toHaveBeenCalled();
    expect(harness.setPanelShown).not.toHaveBeenCalled();
  });

  it("keeps unmatched, unsupported, and friendly-target-needed swipes silent", async () => {
    const harness = makeChoiceResultHarness({ queueIds: ["enemy"], targetableIds: ["enemy"] });
    const unsupported: PlayerChoice = { ...ENEMY_CHOICE, targeting: { kind: "mixed", enemyCount: 2, friendlyCount: 0, allEnemies: false, allFriends: false } };
    const friendlyNeeded: PlayerChoice = { ...ENEMY_CHOICE, targeting: { kind: "friends", count: 1 } };
    const choiceResult = harness.awaitChoice(ENEMY_CHOICE);

    swipe(harness.panelInternal, "upToDown");
    harness.panelInternal.choicesBySlot.set(1, unsupported);
    swipe(harness.panelInternal);
    harness.panelInternal.choicesBySlot.set(1, friendlyNeeded);
    swipe(harness.panelInternal);

    expect(harness.audio.playSfx).not.toHaveBeenCalled();
    expect(harness.showMessagePopup).not.toHaveBeenCalled();
    expect(harness.setPanelShown).not.toHaveBeenCalled();
    await expectPending(choiceResult);
  });

  it("shows the blocked ability's localized message instead of requesting notAllowed", async () => {
    const harness = makeChoiceResultHarness({ queueIds: ["enemy"], targetableIds: ["enemy"] });
    const blocked: PlayerChoice = { ...ENEMY_CHOICE, blockReason: "NoReplacementMembers" };
    harness.panelInternal.choicesBySlot.set(1, blocked);
    const choiceResult = harness.awaitChoice(blocked);

    swipe(harness.panelInternal);

    expect(harness.showMessagePopup).toHaveBeenCalledTimes(1);
    expect(harness.showMessagePopup).toHaveBeenCalledWith("NoReplacementMembers");
    expect(harness.audio.playSfx).not.toHaveBeenCalled();
    expect(harness.setPanelShown).not.toHaveBeenCalled();
    await expectPending(choiceResult);
  });
});
