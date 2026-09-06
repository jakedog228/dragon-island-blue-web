import { describe, expect, it } from "vitest";
import {
  battleAbilitySlotForShortcut,
  dungeonDirectionForShortcut,
  isAdvanceShortcut,
  KeyboardShortcutRouter,
  type KeyboardShortcutHandler,
} from "../src/keyboardShortcuts.js";

class FakeKeyboardTarget {
  listener: ((event: KeyboardEvent) => void) | undefined;

  addEventListener(
    _type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void {
    this.listener = listener;
  }

  removeEventListener(
    _type: "keydown",
    listener: (event: KeyboardEvent) => void,
  ): void {
    if (this.listener === listener) this.listener = undefined;
  }

  dispatch(
    key: string,
    options: Partial<KeyboardEvent> & { target?: EventTarget | null } = {},
  ): { prevented: boolean; stopped: boolean } {
    let prevented = false;
    let stopped = false;
    this.listener?.({
      key,
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      defaultPrevented: false,
      target: null,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; },
      ...options,
    } as unknown as KeyboardEvent);
    return { prevented, stopped };
  }
}

describe("KeyboardShortcutRouter", () => {
  it("maps only the approved non-arrow gameplay shortcuts", () => {
    expect(["1", "2", "3", "4"].map(battleAbilitySlotForShortcut)).toEqual([1, 2, 3, 4]);
    expect(battleAbilitySlotForShortcut("5")).toBeUndefined();
    expect(dungeonDirectionForShortcut("w")).toBe("north");
    expect(dungeonDirectionForShortcut("d")).toBe("east");
    expect(dungeonDirectionForShortcut("s")).toBe("south");
    expect(dungeonDirectionForShortcut("a")).toBe("west");
    for (const arrow of ["arrowup", "arrowright", "arrowdown", "arrowleft"]) {
      expect(dungeonDirectionForShortcut(arrow)).toBeUndefined();
      expect(battleAbilitySlotForShortcut(arrow)).toBeUndefined();
    }
    expect(isAdvanceShortcut("enter")).toBe(true);
    expect(isAdvanceShortcut(" ")).toBe(true);
    expect(isAdvanceShortcut("arrowright")).toBe(false);
  });

  it("dispatches normalized plain keys newest-first and consumes only handled events", () => {
    const target = new FakeKeyboardTarget();
    const router = new KeyboardShortcutRouter(target);
    const calls: string[] = [];
    router.register(({ key }) => { calls.push(`old:${key}`); return true; });
    const removeNewest = router.register(({ key }) => {
      calls.push(`new:${key}`);
      return key === "escape";
    });

    expect(target.dispatch("Escape")).toEqual({ prevented: true, stopped: true });
    expect(calls).toEqual(["new:escape"]);
    calls.length = 0;
    expect(target.dispatch("W")).toEqual({ prevented: true, stopped: true });
    expect(calls).toEqual(["new:w", "old:w"]);

    removeNewest();
    calls.length = 0;
    expect(target.dispatch("1")).toEqual({ prevented: true, stopped: true });
    expect(calls).toEqual(["old:1"]);
  });

  it("ignores repeats, browser modifiers, editable targets, and unhandled keys", () => {
    const target = new FakeKeyboardTarget();
    const router = new KeyboardShortcutRouter(target);
    const calls: string[] = [];
    router.register(({ key }) => { calls.push(key); return false; });

    expect(target.dispatch("w", { repeat: true })).toEqual({ prevented: false, stopped: false });
    expect(target.dispatch("w", { ctrlKey: true })).toEqual({ prevented: false, stopped: false });
    expect(target.dispatch("w", {
      target: { tagName: "input" } as unknown as EventTarget,
    })).toEqual({ prevented: false, stopped: false });
    expect(target.dispatch("w", {
      target: { isContentEditable: true } as unknown as EventTarget,
    })).toEqual({ prevented: false, stopped: false });
    expect(target.dispatch("x")).toEqual({ prevented: false, stopped: false });
    expect(calls).toEqual(["x"]);
  });

  it("unregisters with AbortSignal and removes its global listener on dispose", () => {
    const target = new FakeKeyboardTarget();
    const router = new KeyboardShortcutRouter(target);
    const controller = new AbortController();
    const handler: KeyboardShortcutHandler = () => true;
    router.register(handler, controller.signal);
    controller.abort();
    expect(target.dispatch("Escape")).toEqual({ prevented: false, stopped: false });
    router.dispose();
    expect(target.listener).toBeUndefined();
    expect(() => router.register(handler)).toThrow(/disposed/);
  });
});
