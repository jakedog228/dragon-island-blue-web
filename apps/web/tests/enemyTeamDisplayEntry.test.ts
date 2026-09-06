import { describe, expect, it, vi } from "vitest";
import { EnemyTeamDisplay } from "../src/battle/enemyTeamDisplay.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});
vi.mock("../src/runtimeSettings.js", () => ({ DISPLAY_MODE: "iphone" }));

type EntryHarness = {
  initialEntranceStarted: boolean;
  membersBox: { visible: boolean };
  displays: Map<string, object>;
  runInitialEntrance: ReturnType<typeof vi.fn>;
};

const startInitialEntrance = (EnemyTeamDisplay.prototype as unknown as {
  startInitialEntrance(this: EntryHarness): void;
}).startInitialEntrance;

const reorderMonsters = (EnemyTeamDisplay.prototype as unknown as {
  reorderMonsters(this: object): void;
}).reorderMonsters;

describe("EnemyTeamDisplay transition-owned initial entrance", () => {
  it("positions every built member before exposing the box and starts only once", () => {
    const first = { startInitialActions: vi.fn() };
    const second = { startInitialActions: vi.fn() };
    const harness: EntryHarness = {
      initialEntranceStarted: false,
      membersBox: { visible: false },
      displays: new Map([["first", first], ["second", second]]),
      runInitialEntrance: vi.fn(() => Promise.resolve()),
    };

    startInitialEntrance.call(harness);
    expect(first.startInitialActions).toHaveBeenCalledOnce();
    expect(second.startInitialActions).toHaveBeenCalledOnce();
    expect(harness.runInitialEntrance.mock.calls).toEqual([[first, 0], [second, 1]]);
    expect(harness.membersBox.visible).toBe(true);
    expect(harness.initialEntranceStarted).toBe(true);

    startInitialEntrance.call(harness);
    expect(harness.runInitialEntrance).toHaveBeenCalledTimes(2);
    expect(first.startInitialActions).toHaveBeenCalledOnce();
    expect(second.startInitialActions).toHaveBeenCalledOnce();
  });

  it("starts a promoted reserve's onEnter actions only after the delayed reorder parents it", () => {
    const position = {
      x: 40,
      y: 30,
      set(x: number, y: number): void {
        this.x = x;
        this.y = y;
      },
    };
    const pending: {
      parent?: object;
      position: typeof position;
      startInitialActions: ReturnType<typeof vi.fn>;
    } = {
      position,
      startInitialActions: vi.fn(() => {
        expect(pending.parent).toBe(membersBox);
      }),
    };
    const membersBox = {
      position: { x: 5, y: 6 },
      gap: 0,
      addBoxChild: vi.fn((display: typeof pending) => {
        display.parent = membersBox;
      }),
      layoutChildren: vi.fn(),
    };
    const harness = {
      displays: new Map([["promoted", pending]]),
      pendingAdds: [pending],
      membersBox,
      computeMembersBoxPosition: vi.fn(() => ({ x: 12, y: 18 })),
      animateTo: vi.fn(() => Promise.resolve()),
    };

    expect(pending.startInitialActions).not.toHaveBeenCalled();
    reorderMonsters.call(harness);

    expect(membersBox.addBoxChild).toHaveBeenCalledWith(pending, expect.any(Object));
    expect(pending.startInitialActions).toHaveBeenCalledOnce();
    expect(harness.pendingAdds).toEqual([]);
  });
});
