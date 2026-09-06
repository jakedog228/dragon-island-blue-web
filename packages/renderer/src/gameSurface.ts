import type { LifecycleScope } from "./lifecycle.js";

/** Browser default actions that can claim a press or drag over the gameplay surface.
 *
 *  The original has no analogue for any of them: its launch path installs a native `EAGLView`
 *  (a `CAEAGLLayer` view) as the director's OpenGL view, and that view forwards
 *  `touchesBegan/Moved/Ended/Cancelled:withEvent:` straight to `CCTouchDispatcher`. A held finger
 *  reaches the game with no document selection, callout, or drag layer in between. */
const GUARDED_EVENTS = ["contextmenu", "selectstart", "dragstart"] as const;

/** The DOM surface the guards need. `HTMLCanvasElement` satisfies it structurally; keeping the
 *  parameter minimal lets the policy be unit-tested without a DOM environment. */
export interface GameSurfaceTarget {
  draggable: boolean;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

/** Treat the gameplay canvas as an application surface rather than selectable document content.
 *
 *  CSS carries the primary policy (`-webkit-touch-callout`, `user-select`, `-webkit-user-drag` on
 *  `.game-viewport`); these listeners are the defense in depth for the paths CSS does not cover —
 *  desktop right-click/control-click menus, selections started from outside the canvas, and
 *  WebKit's native element drag. Without them a browser gesture can also steal an in-progress
 *  drag, which would break the swipe-attack, drag-scroll, and party-reorder inputs.
 *
 *  Cancellation is `preventDefault()` only: propagation must continue so Pixi's event system and
 *  any scene-level handlers still observe the event. */
export function installGameSurfaceGuards(
  surface: GameSurfaceTarget,
  lifecycle: LifecycleScope,
): void {
  surface.draggable = false;
  const preventBrowserSurfaceAction = (event: Event): void => {
    event.preventDefault();
  };
  for (const eventType of GUARDED_EVENTS) {
    surface.addEventListener(eventType, preventBrowserSurfaceAction);
    lifecycle.add(() => {
      surface.removeEventListener(eventType, preventBrowserSurfaceAction);
    });
  }
}
