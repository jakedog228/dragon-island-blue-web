export const HERO_SHADER_INTERVAL_SECONDS = Math.fround(0.3);
export const HERO_SHADER_UPDATE_MS = HERO_SHADER_INTERVAL_SECONDS * 1000;
export const HERO_REVEAL_OPACITY = 100 / 255;
export const HERO_FLASH_SPEED_SECONDS = Math.fround(1.5);
export const HERO_FLASH_PERIOD_MS = HERO_FLASH_SPEED_SECONDS * 1000;

/** ColorRevealNode's bottom-up Cocos rectangle expressed in the port's Pixi Y-down frame. */
export function heroRevealRect(
  readiness: number,
  hasSpirits: boolean,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number; percent: number } {
  const percent = hasSpirits ? 1 - readiness : 1;
  return { x: 0, y: height * (1 - percent), w: width, h: height * percent, percent };
}


export function heroFlashOpacity(elapsedMs: number): number {
  return heroFlashOpacitySeconds(Math.fround(elapsedMs / 1000));
}

export function heroFlashOpacitySeconds(elapsedSeconds: number): number {
  let timerSeconds = Math.fround(elapsedSeconds);
  while (timerSeconds >= HERO_FLASH_SPEED_SECONDS) {
    timerSeconds = Math.fround(timerSeconds - HERO_FLASH_SPEED_SECONDS);
  }
  const half = Math.fround(HERO_FLASH_SPEED_SECONDS * Math.fround(0.5));
  const unit = timerSeconds < half
    ? Math.fround(timerSeconds / half)
    : Math.fround(1 - Math.fround(Math.fround(timerSeconds - half) / half));
  return Math.trunc(Math.fround(unit * Math.fround(255))) / 255;
}
