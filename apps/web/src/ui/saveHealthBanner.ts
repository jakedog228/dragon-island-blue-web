import type { SaveHealthMonitor, SaveHealthState } from "../player/saveHealth.js";
import { saveHealthBannerView } from "./saveHealthBannerMath.js";

export interface SaveHealthBannerOptions {
  readonly monitor: SaveHealthMonitor;
  readonly host?: HTMLElement;
  /**
   * Takes the slot over from whichever tab currently owns it. Offered only for conflicts, and only
   * behind an explicit press — automatic recovery would silently overwrite the other tab.
   */
  readonly onTakeOverSlot?: () => Promise<void>;
}

/**
 * A DOM overlay rather than a Pixi node on purpose: a save failure has to be visible during scene
 * transitions, popups and battle, none of which own a reliable place to draw shell chrome, and the
 * banner must survive a renderer that is itself mid-teardown.
 */
export function installSaveHealthBanner(options: SaveHealthBannerOptions): () => void {
  const host = options.host ?? document.body;
  const banner = document.createElement("div");
  banner.className = "save-health";
  banner.setAttribute("role", "alert");
  banner.hidden = true;

  const text = document.createElement("p");
  text.className = "save-health__text";
  banner.appendChild(text);

  const action = document.createElement("button");
  action.type = "button";
  action.className = "save-health__action";
  action.hidden = true;
  banner.appendChild(action);
  host.appendChild(banner);

  let busy = false;
  action.addEventListener("click", () => {
    if (busy || options.onTakeOverSlot === undefined) return;
    busy = true;
    action.disabled = true;
    action.textContent = "Taking over…";
    void options.onTakeOverSlot()
      .catch((error: unknown) => {
        text.textContent = `Could not take over the slot: ${describe(error)}`;
      })
      .finally(() => {
        busy = false;
        action.disabled = false;
      });
  });

  const render = (state: SaveHealthState): void => {
    const view = saveHealthBannerView(state, options.onTakeOverSlot !== undefined);
    banner.hidden = !view.visible;
    if (!view.visible) return;
    banner.classList.toggle("save-health--conflict", view.conflictStyle);
    text.textContent = view.text;
    action.hidden = !view.actionVisible;
    if (view.actionVisible && !busy) action.textContent = "Save here anyway";
  };

  const unsubscribe = options.monitor.subscribe(render);
  return () => {
    unsubscribe();
    banner.remove();
  };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
