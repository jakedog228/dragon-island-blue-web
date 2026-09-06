export interface KeyboardShortcut {
  readonly key: string;
  readonly originalEvent: KeyboardEvent;
}

export type KeyboardShortcutHandler = (shortcut: KeyboardShortcut) => boolean;

export function isAdvanceShortcut(key: string): boolean {
  return key === "enter" || key === " ";
}

export function battleAbilitySlotForShortcut(key: string): 1 | 2 | 3 | 4 | undefined {
  if (key !== "1" && key !== "2" && key !== "3" && key !== "4") return undefined;
  return Number(key) as 1 | 2 | 3 | 4;
}

export function dungeonDirectionForShortcut(
  key: string,
): "north" | "east" | "south" | "west" | undefined {
  switch (key) {
    case "w": return "north";
    case "d": return "east";
    case "s": return "south";
    case "a": return "west";
    default: return undefined;
  }
}

interface KeyboardEventTarget {
  addEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
    options?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: "keydown",
    listener: (event: KeyboardEvent) => void,
    options?: EventListenerOptions | boolean,
  ): void;
}

/**
 * One web-native keyboard boundary for the Pixi application.
 *
 * Handlers are consulted newest-first so a modal/sub-flow registered after its owning scene gets
 * first refusal. A handler returns true only when it actually consumed the key; browser defaults
 * and propagation remain untouched otherwise.
 */
export class KeyboardShortcutRouter {
  private readonly handlers: KeyboardShortcutHandler[] = [];
  private disposed = false;

  constructor(private readonly target: KeyboardEventTarget) {
    target.addEventListener("keydown", this.onKeyDown, { capture: true });
  }

  register(handler: KeyboardShortcutHandler, signal?: AbortSignal): () => void {
    if (this.disposed) throw new Error("KeyboardShortcutRouter is disposed");
    this.handlers.push(handler);
    let registered = true;
    const unregister = (): void => {
      if (!registered) return;
      registered = false;
      signal?.removeEventListener("abort", unregister);
      const index = this.handlers.lastIndexOf(handler);
      if (index >= 0) this.handlers.splice(index, 1);
    };
    if (signal?.aborted) unregister();
    else signal?.addEventListener("abort", unregister, { once: true });
    return unregister;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.handlers.length = 0;
    this.target.removeEventListener("keydown", this.onKeyDown, { capture: true });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (
      this.disposed ||
      event.defaultPrevented ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isEditableKeyboardTarget(event.target)
    ) return;
    const shortcut = { key: event.key.toLowerCase(), originalEvent: event };
    for (let index = this.handlers.length - 1; index >= 0; index -= 1) {
      if (!this.handlers[index]!(shortcut)) continue;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  };
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") return false;
  const candidate = target as {
    readonly tagName?: unknown;
    readonly isContentEditable?: unknown;
  };
  if (candidate.isContentEditable === true) return true;
  if (typeof candidate.tagName !== "string") return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(candidate.tagName.toUpperCase());
}
