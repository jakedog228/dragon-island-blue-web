
export const CHAINED_TEXT_CHAT_DIM_ALPHA = 0xc8 / 0xff;

export const CHAINED_TEXT_CHAT_DIM_FADE_MS = 500;

export function chainedTextChatDimAlpha(elapsedMs: number, stacked: boolean): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(`chained text dim elapsedMs must be finite and nonnegative, got ${elapsedMs}`);
  }
  if (stacked) return CHAINED_TEXT_CHAT_DIM_ALPHA;
  return CHAINED_TEXT_CHAT_DIM_ALPHA *
    Math.min(1, elapsedMs / CHAINED_TEXT_CHAT_DIM_FADE_MS);
}






export const CHAINED_TEXT_CHAT_PORTRAIT_TOASTER_MS = 250;

















export function chainedTextChatPortraitRevealFraction(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error(
      `chat portrait toaster elapsedMs must be finite and nonnegative, got ${elapsedMs}`,
    );
  }
  return Math.min(1, elapsedMs / CHAINED_TEXT_CHAT_PORTRAIT_TOASTER_MS);
}
