import type { DisplayMode } from "./displayMode.js";

export type TextResolutionMode = "original" | "modern";
export type AudioLevel = 0 | 0.25 | 0.5 | 0.75 | 1;

export interface PortSettings {
  displayMode: DisplayMode;
  textResolutionMode: TextResolutionMode;
  sound: AudioLevel;
  music: AudioLevel;
}

export const DEFAULT_PORT_SETTINGS: PortSettings = {
  displayMode: "ipad",
  textResolutionMode: "modern",
  sound: 0.25,
  music: 0.5,
};

const STORAGE_KEY = "dib.portSettings.v1";
const AUDIO_LEVELS: readonly number[] = [0, 0.25, 0.5, 0.75, 1];

function storage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function isAudioLevel(value: unknown): value is AudioLevel {
  return typeof value === "number" && AUDIO_LEVELS.includes(value);
}

export function loadPortSettings(store = storage()): PortSettings {
  if (!store) return { ...DEFAULT_PORT_SETTINGS };
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PORT_SETTINGS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      displayMode: parsed["displayMode"] === "iphone" || parsed["displayMode"] === "ipad"
        ? parsed["displayMode"]
        : DEFAULT_PORT_SETTINGS.displayMode,
      textResolutionMode: parsed["textResolutionMode"] === "original" || parsed["textResolutionMode"] === "modern"
        ? parsed["textResolutionMode"]
        : DEFAULT_PORT_SETTINGS.textResolutionMode,
      sound: isAudioLevel(parsed["sound"]) ? parsed["sound"] : DEFAULT_PORT_SETTINGS.sound,
      music: isAudioLevel(parsed["music"]) ? parsed["music"] : DEFAULT_PORT_SETTINGS.music,
    };
  } catch {
    return { ...DEFAULT_PORT_SETTINGS };
  }
}

export function savePortSettings(settings: PortSettings, store = storage()): void {
  if (!store) return;
  store.setItem(STORAGE_KEY, JSON.stringify(settings));
}
