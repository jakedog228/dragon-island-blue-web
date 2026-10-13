import type { RemoteGameAuthorityError } from "./gameAuthorityClient.js";

/** Browser-shell recovery shared by concurrent reads; no simulation or archive state is changed. */
export function createAuthorityRecoveryPrompt(): (error: RemoteGameAuthorityError) => Promise<void> {
  let pending: Promise<void> | undefined;
  return (error) => pending ??= new Promise<void>((resolve) => {
    const versionChanged = error.code === "PACK_UNAVAILABLE";
    const rejected = !versionChanged && !error.retryable;
    const shade = document.createElement("div");
    shade.className = "official-recovery";
    shade.dataset.gameShortcuts = "blocked";
    shade.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#101521ed;display:grid;place-items:center;padding:24px;color:white;font:16px system-ui";
    const panel = document.createElement("div");
    panel.setAttribute("role", "alertdialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "official-recovery-title");
    panel.style.cssText = "max-width:420px;text-align:center";
    const title = document.createElement("h2");
    title.id = "official-recovery-title";
    title.textContent = versionChanged ? "Game updated" : rejected ? "Action could not complete" : "Connection interrupted";
    const message = document.createElement("p");
    message.textContent = versionChanged
      ? "The server has been updated. Reload to continue from your saved progress."
      : rejected ? "The server rejected this action. Continue to restore your saved game and choose again."
      : "Your action is waiting for confirmation. Retry when your connection returns to continue safely.";
    const button = document.createElement("button");
    button.textContent = versionChanged ? "Reload" : rejected ? "Continue" : "Retry";
    button.style.cssText = "padding:12px 28px;font:inherit;cursor:pointer";
    button.addEventListener("click", () => {
      if (versionChanged) { window.location.reload(); return; }
      shade.remove();
      pending = undefined;
      resolve();
    });
    // Keep keyboard shortcuts in the covered Pixi scene from submitting another intent.
    shade.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Tab") { event.preventDefault(); button.focus(); }
    });
    panel.append(title, message, button);
    shade.append(panel);
    document.body.append(shade);
    button.focus();
  });
}
