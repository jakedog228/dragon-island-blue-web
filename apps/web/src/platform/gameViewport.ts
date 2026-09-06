export interface AppViewportReadings {
  readonly standalone: boolean;
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly visualWidth?: number;
  readonly visualHeight?: number;
  readonly documentWidth: number;
  readonly documentHeight: number;
}

export interface AppViewportSize {
  readonly width: number;
  readonly height: number;
  readonly source: "window" | "visual-viewport" | "document";
}

type ViewportPair = readonly [width: number, height: number];

function validPair(width: number | undefined, height: number | undefined): ViewportPair | undefined {
  return Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0
    ? [width!, height!]
    : undefined;
}

/**
 * Chooses one coherent viewport pair. Installed web apps deliberately prefer `innerWidth/Height`:
 * iOS can leave `dvh`/VisualViewport on the previous orientation while the window metrics have
 * already reached the new Home Screen geometry. Normal tabs prefer VisualViewport because browser
 * chrome and the software keyboard can make it smaller than the layout viewport.
 */
export function resolveAppViewportSize(readings: AppViewportReadings): AppViewportSize {
  const windowPair = validPair(readings.innerWidth, readings.innerHeight);
  const visualPair = validPair(readings.visualWidth, readings.visualHeight);
  const documentPair = validPair(readings.documentWidth, readings.documentHeight);
  const choices: ReadonlyArray<readonly [AppViewportSize["source"], ViewportPair | undefined]> =
    readings.standalone
      ? [["window", windowPair], ["document", documentPair], ["visual-viewport", visualPair]]
      : [["visual-viewport", visualPair], ["window", windowPair], ["document", documentPair]];
  const selected = choices.find(([, pair]) => pair !== undefined);
  if (selected === undefined) throw new Error("No positive browser viewport dimensions are available");
  return { width: selected[1]![0], height: selected[1]![1], source: selected[0] };
}

function standalonePresentation(): boolean {
  const appleStandalone = (navigator as Navigator & { readonly standalone?: boolean }).standalone;
  return appleStandalone === true ||
    globalThis.matchMedia?.("(display-mode: standalone)").matches === true ||
    globalThis.matchMedia?.("(display-mode: fullscreen)").matches === true;
}

function currentViewportSize(): AppViewportSize {
  const visualViewport = window.visualViewport;
  return resolveAppViewportSize({
    standalone: standalonePresentation(),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    ...(visualViewport === null
      ? {}
      : { visualWidth: visualViewport.width, visualHeight: visualViewport.height }),
    documentWidth: document.documentElement.clientWidth,
    documentHeight: document.documentElement.clientHeight,
  });
}

/**
 * Owns the CSS viewport variables for the whole shell. WebKit can publish orientation geometry in
 * stages, so every relevant event is sampled immediately, across two animation frames, and after
 * short settling windows. The writes are idempotent and therefore safe when several events fire.
 */
export function installAppViewportSizing(): () => void {
  const root = document.documentElement;
  let firstFrame = 0;
  let secondFrame = 0;
  let timers: number[] = [];
  let disposed = false;

  const apply = (): void => {
    if (disposed) return;
    const size = currentViewportSize();
    const width = `${size.width}px`;
    const height = `${size.height}px`;
    if (root.style.getPropertyValue("--dib-app-viewport-width") !== width) {
      root.style.setProperty("--dib-app-viewport-width", width);
    }
    if (root.style.getPropertyValue("--dib-app-viewport-height") !== height) {
      root.style.setProperty("--dib-app-viewport-height", height);
    }
    root.dataset["appViewportSource"] = size.source;
  };
  const clearScheduled = (): void => {
    if (firstFrame !== 0) cancelAnimationFrame(firstFrame);
    if (secondFrame !== 0) cancelAnimationFrame(secondFrame);
    firstFrame = 0;
    secondFrame = 0;
    timers.forEach((timer) => clearTimeout(timer));
    timers = [];
  };
  const settle = (): void => {
    if (disposed) return;
    apply();
    clearScheduled();
    firstFrame = requestAnimationFrame(() => {
      firstFrame = 0;
      apply();
      secondFrame = requestAnimationFrame(() => {
        secondFrame = 0;
        apply();
      });
    });
    timers = [50, 250, 1_000].map((delay) => window.setTimeout(apply, delay));
  };
  const refreshWhenVisible = (): void => {
    if (document.visibilityState !== "hidden") settle();
  };

  window.addEventListener("resize", settle);
  window.addEventListener("orientationchange", settle);
  window.addEventListener("pageshow", settle);
  window.visualViewport?.addEventListener("resize", settle);
  document.addEventListener("fullscreenchange", settle);
  document.addEventListener("visibilitychange", refreshWhenVisible);
  screen.orientation?.addEventListener?.("change", settle);
  settle();

  return () => {
    if (disposed) return;
    disposed = true;
    clearScheduled();
    window.removeEventListener("resize", settle);
    window.removeEventListener("orientationchange", settle);
    window.removeEventListener("pageshow", settle);
    window.visualViewport?.removeEventListener("resize", settle);
    document.removeEventListener("fullscreenchange", settle);
    document.removeEventListener("visibilitychange", refreshWhenVisible);
    screen.orientation?.removeEventListener?.("change", settle);
    delete root.dataset["appViewportSource"];
    root.style.removeProperty("--dib-app-viewport-width");
    root.style.removeProperty("--dib-app-viewport-height");
  };
}

/**
 * Moves any already-mounted source loading bridge into the safe-area host used by Pixi. The outer
 * #app remains edge-to-edge and black, so sensor/home-indicator gutters become natural letterbox
 * space instead of shrinking or offsetting browser-owned content-gate UI.
 */
export function installGameViewport(host: HTMLElement): HTMLElement {
  const existing = host.querySelector<HTMLElement>(":scope > .game-viewport");
  if (existing !== null) throw new Error("game viewport is already installed");
  const viewport = document.createElement("div");
  viewport.className = "game-viewport";
  const mounted = [...host.childNodes];
  host.replaceChildren(viewport);
  viewport.append(...mounted);
  return viewport;
}
