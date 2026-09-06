export const DEFAULT_PORT_AUDIO_LEVELS = Object.freeze({
  sound: 0.25,
  music: 0.5,
});

export function controlledPortBrowserArguments({ muteAudio = false } = {}) {
  return [
    "--enable-unsafe-swiftshader",
    ...(muteAudio ? ["--mute-audio"] : []),
    "--autoplay-policy=no-user-gesture-required",
  ];
}

export function controlledPortBrowserLaunchOptions({ muteAudio = false } = {}) {
  return {
    args: controlledPortBrowserArguments({ muteAudio }),
    // Playwright adds --mute-audio to every headless Chromium launch. Omitting that switch from
    // our own args is therefore insufficient: passthrough must filter Playwright's default too.
    ignoreDefaultArgs: muteAudio ? undefined : ["--mute-audio"],
  };
}
