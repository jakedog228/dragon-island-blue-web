import { loadPortSettings } from "./portSettings.js";
import { refreshRuntimeSettingCaches } from "./runtimeSettingsRefresh.js";

let settings = loadPortSettings();

/**
 * Active renderer-session settings. Changing display/text presentation rebuilds the current
 * renderer session, then refreshes every module-level source-layout cache before constructing the
 * replacement scene. Audio changes are also applied immediately by Options.
 */
export let DISPLAY_MODE = settings.displayMode;
export let TEXT_RESOLUTION_MODE = settings.textResolutionMode;
export const AUDIO_CONFIG = {
  sound: settings.sound,
  music: settings.music,
};

export function refreshRuntimeSettings(): void {
  settings = loadPortSettings();
  DISPLAY_MODE = settings.displayMode;
  TEXT_RESOLUTION_MODE = settings.textResolutionMode;
  AUDIO_CONFIG.sound = settings.sound;
  AUDIO_CONFIG.music = settings.music;
  refreshRuntimeSettingCaches();
}
