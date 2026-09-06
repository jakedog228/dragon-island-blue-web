


declare global {
  // eslint-disable-next-line no-var
  var __DIB_DEBUG__: boolean | undefined;
}

/** One narrative line. `data` is passed straight through to the console (objects stay
 *  expandable in DevTools). Categories keep the stream filterable: type "[DIB:turn" or
 *  "[DIB:render" into the DevTools filter box. */
export function battleDebug(category: "turn" | "render" | "status" | "gate", message: string, data?: unknown): void {
  const sink = globalThis.__DIB_DEBUG__ ? console.log : console.debug;
  if (data === undefined) sink(`[DIB:${category}] ${message}`);
  else sink(`[DIB:${category}] ${message}`, data);
}

/** Compact one-line description of a BattleEvent for narrative lines (structural clone of the
 *  event object itself would flood the stream; this keeps one event per line, greppable). */
export function describeEvent(e: Record<string, unknown>): string {
  const parts: string[] = [String(e["type"])];
  for (const key of ["target", "targets", "source", "living", "phase", "amount", "buffType", "reason", "cause", "effect"]) {
    const v = e[key];
    if (v !== undefined && v !== null) parts.push(`${key}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
  }
  return parts.join(" ");
}
