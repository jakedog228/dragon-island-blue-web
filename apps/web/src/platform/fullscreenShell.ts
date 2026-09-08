export type FullscreenState =
  | "active"
  | "standalone"
  | "available"
  | "install-required"
  | "unavailable";

export type FullscreenActionResult =
  | { readonly kind: "already-active" }
  | { readonly kind: "entered" }
  | { readonly kind: "install-guidance" }
  | { readonly kind: "unavailable-guidance" }
  | { readonly kind: "failed"; readonly message: string };

export interface FullscreenRuntime {
  readonly fullscreenElement?: unknown;
  readonly fullscreenEnabled?: boolean;
  readonly standalone: boolean;
  readonly appleMobile: boolean;
  readonly target: {
    readonly requestFullscreen?: () => Promise<void>;
  };
  readonly lockLandscape?: () => Promise<void>;
}

export interface FullscreenGuidance {
  readonly title: string;
  readonly message: string;
  readonly steps?: readonly string[];
  readonly warning?: string;
}

/** Capability-first state. Apple-mobile detection is used only to choose useful fallback copy. */
export function fullscreenState(runtime: FullscreenRuntime): FullscreenState {
  if (runtime.fullscreenElement != null) return "active";
  if (runtime.standalone) return "standalone";
  if (
    runtime.fullscreenEnabled !== false &&
    typeof runtime.target.requestFullscreen === "function"
  ) return "available";
  return runtime.appleMobile ? "install-required" : "unavailable";
}

/** A control is useful only when it can enter fullscreen or explain the iPhone install route. */
export function shouldOfferFullscreenAction(state: FullscreenState): boolean {
  return state === "available" || state === "install-required";
}

/**
 * Runs only the capability action. UI guidance is projected separately so this path remains
 * independently testable and a rejected browser request becomes a visible result rather than an
 * unhandled promise rejection.
 */
export async function performFullscreenAction(
  runtime: FullscreenRuntime,
): Promise<FullscreenActionResult> {
  const state = fullscreenState(runtime);
  if (state === "active" || state === "standalone") return { kind: "already-active" };
  if (state === "install-required") return { kind: "install-guidance" };
  if (state === "unavailable") return { kind: "unavailable-guidance" };

  try {
    await runtime.target.requestFullscreen!();
    // Orientation lock is a best-effort platform enhancement. WebKit and other browsers can
    // expose the method while rejecting it outside a supported fullscreen/window configuration.
    try {
      await runtime.lockLandscape?.();
    } catch {
      // Fullscreen has already succeeded; leaving orientation user-controlled is the fallback.
    }
    return { kind: "entered" };
  } catch (error) {
    return {
      kind: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function fullscreenGuidance(result: FullscreenActionResult): FullscreenGuidance | undefined {
  if (result.kind === "install-guidance") {
    return {
      title: "Use the full-screen web app",
      message: "On iPhone, interactive pages cannot hide the browser chrome from a normal tab.",
      steps: [
        "Open the browser Share menu.",
        "Choose Add to Home Screen.",
        "Launch the new icon from the Home Screen.",
      ],
      warning:
        "If Add to Home Screen is missing, open this page in Safari and install it there. " +
        "The installed app has separate offline saves and settings, so export any browser-local " +
        "saves first. Open the installed app while connected and wait for offline startup to be ready. " +
        "Play Offline once there to remember game content, and keep your IPA/ZIP downloaded in Files.",
    };
  }
  if (result.kind === "unavailable-guidance") {
    return {
      title: "Full screen is unavailable",
      message:
        "This browser does not expose a full-screen page API. Use its own window or installation controls when available.",
    };
  }
  if (result.kind === "failed") {
    return {
      title: "Full screen could not start",
      message: result.message,
    };
  }
  return undefined;
}

/** Browser-facing action shared by the content gate and the source-styled Options popup. */
export async function activateFullscreenExperience(): Promise<FullscreenActionResult> {
  const result = await performFullscreenAction(browserFullscreenRuntime());
  const guidance = fullscreenGuidance(result);
  if (guidance !== undefined) showFullscreenGuidance(guidance);
  return result;
}

export function browserFullscreenRuntime(): FullscreenRuntime {
  const fullscreenTarget = document.documentElement;
  const requestFullscreen = typeof fullscreenTarget.requestFullscreen === "function"
    ? () => fullscreenTarget.requestFullscreen()
    : undefined;
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: "landscape") => Promise<void>;
  };
  return {
    fullscreenElement: document.fullscreenElement,
    fullscreenEnabled: document.fullscreenEnabled,
    standalone: isStandaloneWebApp(),
    appleMobile: isAppleMobileNavigator(navigator),
    target: requestFullscreen === undefined ? {} : { requestFullscreen },
    ...(typeof orientation?.lock === "function"
      ? { lockLandscape: () => orientation.lock!("landscape") }
      : {}),
  };
}

export function isAppleMobileNavigator(
  value: Pick<Navigator, "userAgent" | "platform" | "maxTouchPoints">,
): boolean {
  return /iPhone|iPad|iPod/i.test(value.userAgent) ||
    (value.platform === "MacIntel" && value.maxTouchPoints > 1);
}

function isStandaloneWebApp(): boolean {
  const appleStandalone = (navigator as Navigator & { readonly standalone?: boolean }).standalone;
  return appleStandalone === true ||
    globalThis.matchMedia?.("(display-mode: standalone)").matches === true ||
    globalThis.matchMedia?.("(display-mode: fullscreen)").matches === true;
}

function showFullscreenGuidance(guidance: FullscreenGuidance): void {
  document.querySelector<HTMLDialogElement>("[data-fullscreen-guidance]")?.remove();
  const dialog = document.createElement("dialog");
  dialog.className = "platform-fullscreen-dialog";
  dialog.dataset["fullscreenGuidance"] = "true";
  dialog.setAttribute("aria-labelledby", "platform-fullscreen-title");

  const card = document.createElement("div");
  card.className = "platform-fullscreen-dialog__card";
  const title = document.createElement("h2");
  title.id = "platform-fullscreen-title";
  title.textContent = guidance.title;
  const message = document.createElement("p");
  message.textContent = guidance.message;
  card.append(title, message);

  if (guidance.steps !== undefined) {
    const steps = document.createElement("ol");
    for (const text of guidance.steps) {
      const item = document.createElement("li");
      item.textContent = text;
      steps.appendChild(item);
    }
    card.appendChild(steps);
  }
  if (guidance.warning !== undefined) {
    const warning = document.createElement("p");
    warning.className = "platform-fullscreen-dialog__warning";
    warning.textContent = guidance.warning;
    card.appendChild(warning);
  }

  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close";
  close.addEventListener("click", () => dialog.close());
  card.appendChild(close);
  dialog.appendChild(card);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.open = true;
}
