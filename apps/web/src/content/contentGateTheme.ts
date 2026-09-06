export const CONTENT_GATE_MODE_STORAGE_KEY = "dib.content-gate-mode.v1";

export const CONTENT_GATE_MODES = ["dark", "light"] as const;
export type ContentGateMode = (typeof CONTENT_GATE_MODES)[number];

interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ColorSchemePreference {
  readonly matches: boolean;
  addEventListener?(type: "change", listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener?(
    type: "change",
    listener: (event: { readonly matches: boolean }) => void,
  ): void;
}

interface ThemeEnvironment {
  readonly storage?: ThemeStorage;
  readonly colorScheme?: ColorSchemePreference;
}

export function parseContentGateMode(value: string | null): ContentGateMode | undefined {
  return CONTENT_GATE_MODES.includes(value as ContentGateMode)
    ? value as ContentGateMode
    : undefined;
}

export function systemContentGateMode(prefersDark: boolean): ContentGateMode {
  return prefersDark ? "dark" : "light";
}

export function applyContentGateMode(panel: HTMLElement, mode: ContentGateMode): void {
  panel.dataset["gateMode"] = mode;
}

export function installContentGateThemeToggle(
  panel: HTMLElement,
  environment: ThemeEnvironment = {},
): () => void {
  const button = panel.querySelector<HTMLButtonElement>("[data-gate-theme-toggle]");
  if (button === null) throw new Error("content gate is missing its theme toggle");

  const storage = environment.storage ?? browserStorage();
  const colorScheme = environment.colorScheme ?? browserColorScheme();
  let manualMode = readManualMode(storage);
  let mode = manualMode ?? systemContentGateMode(colorScheme?.matches ?? true);

  const render = (): void => {
    applyContentGateMode(panel, mode);
    const nextMode = mode === "dark" ? "light" : "dark";
    const label = `Switch to ${nextMode} mode`;
    button.dataset["gateThemeMode"] = mode;
    button.setAttribute("aria-label", label);
    button.title = label;
  };

  const onClick = (): void => {
    mode = mode === "dark" ? "light" : "dark";
    manualMode = mode;
    writeManualMode(storage, mode);
    render();
  };
  const onSystemChange = (event: { readonly matches: boolean }): void => {
    if (manualMode !== undefined) return;
    mode = systemContentGateMode(event.matches);
    render();
  };

  button.addEventListener("click", onClick);
  colorScheme?.addEventListener?.("change", onSystemChange);
  render();

  return () => {
    button.removeEventListener("click", onClick);
    colorScheme?.removeEventListener?.("change", onSystemChange);
  };
}

function readManualMode(storage: ThemeStorage | undefined): ContentGateMode | undefined {
  if (storage === undefined) return undefined;
  try {
    return parseContentGateMode(storage.getItem(CONTENT_GATE_MODE_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

function writeManualMode(storage: ThemeStorage | undefined, mode: ContentGateMode): void {
  if (storage === undefined) return;
  try {
    storage.setItem(CONTENT_GATE_MODE_STORAGE_KEY, mode);
  } catch {
    // The live toggle still works when storage is unavailable or full.
  }
}

function browserStorage(): ThemeStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function browserColorScheme(): ColorSchemePreference | undefined {
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  } catch {
    return undefined;
  }
}
