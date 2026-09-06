import type { DisplayMode } from "../displayMode.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { startupLayout } from "../startup/startupConstants.js";
import type { ImportedContentPackage } from "./archivePackage.js";

export interface SourceLoadingScreenMetrics {
  readonly screenWidthPt: number;
  readonly screenHeightPt: number;
  readonly backgroundWidthPt: number;
  readonly backgroundHeightPt: number;
  readonly labelBottomPt: number;
  readonly labelFontPt: number;
}

export interface SourceLoadingScreenLayout {
  readonly frameWidthPx: number;
  readonly frameHeightPx: number;
  readonly backgroundWidthPx: number;
  readonly backgroundHeightPx: number;
  readonly sourceImageWidthPx: number;
  readonly sourceImageHeightPx: number;
  readonly sourceImageLeftPx: number;
  readonly sourceImageTopPx: number;
  readonly labelBottomPx: number;
  readonly labelFontPx: number;
}

export interface PreparedSourceLoadingScreen {
  mount(host: HTMLElement): void;
  dismiss(): void;
}

export interface PreparedSourceLandingBackdrop {
  mount(host: HTMLElement): void;
  dismiss(): void;
}

/** Source-classified geometry for the DOM bridge shown before Pixi can mount its preloader. */
export function sourceLoadingScreenMetrics(mode: DisplayMode): SourceLoadingScreenMetrics {
  const layout = startupLayout(mode);
  return {
    screenWidthPt: layout.screen.w,
    screenHeightPt: layout.screen.h,
    backgroundWidthPt: layout.background.sizePt.w,
    backgroundHeightPt: layout.background.sizePt.h,
    labelBottomPt: layout.preloader.bottomInset,
    labelFontPt: layout.preloader.labelFont,
  };
}

/** Fits the source stage inside a host and scales every child from that same point-space frame. */
export function sourceLoadingScreenLayout(
  mode: DisplayMode,
  hostWidthPx: number,
  hostHeightPx: number,
  sourceImageWidth: number,
  sourceImageHeight: number,
): SourceLoadingScreenLayout {
  if (
    !Number.isFinite(hostWidthPx) ||
    !Number.isFinite(hostHeightPx) ||
    !Number.isFinite(sourceImageWidth) ||
    !Number.isFinite(sourceImageHeight) ||
    hostWidthPx <= 0 ||
    hostHeightPx <= 0 ||
    sourceImageWidth <= 0 ||
    sourceImageHeight <= 0
  ) {
    throw new Error("source loading screen dimensions must be finite and positive");
  }
  const metrics = sourceLoadingScreenMetrics(mode);
  const textureRect = startupLayout(mode).background.textureRectPx;
  if (
    sourceImageWidth < textureRect.x + textureRect.w ||
    sourceImageHeight < textureRect.y + textureRect.h
  ) {
    throw new Error(
      `mainscreenBackground.png is ${sourceImageWidth}x${sourceImageHeight}; ` +
      `source crop requires ${textureRect.x + textureRect.w}x${textureRect.y + textureRect.h}`,
    );
  }
  const scale = Math.min(
    hostWidthPx / metrics.screenWidthPt,
    hostHeightPx / metrics.screenHeightPt,
  );
  const backgroundWidthPx = metrics.backgroundWidthPt * scale;
  const backgroundHeightPx = metrics.backgroundHeightPt * scale;
  return {
    frameWidthPx: metrics.screenWidthPt * scale,
    frameHeightPx: metrics.screenHeightPt * scale,
    backgroundWidthPx,
    backgroundHeightPx,
    sourceImageWidthPx: backgroundWidthPx * sourceImageWidth / textureRect.w,
    sourceImageHeightPx: backgroundHeightPx * sourceImageHeight / textureRect.h,
    sourceImageLeftPx: -backgroundWidthPx * textureRect.x / textureRect.w,
    sourceImageTopPx: -backgroundHeightPx * textureRect.y / textureRect.h,
    labelBottomPx: metrics.labelBottomPt * scale,
    labelFontPx: metrics.labelFontPt * scale,
  };
}

/**
 * Decodes the archive image while the content gate is still visible, then returns a bridge that
 * can replace the gate without exposing the renderer's black initialization frame.
 */
export async function prepareSourceLoadingScreen(
  content: ImportedContentPackage,
  mode: DisplayMode = DISPLAY_MODE,
): Promise<PreparedSourceLoadingScreen> {
  const loadingText = content.data.strings["LoadingKey"];
  if (typeof loadingText !== "string" || loadingText.length === 0) {
    throw new Error("LoadingKey must be a non-empty localized string");
  }
  const root = document.createElement("section");
  root.className = "source-loading-bridge";
  root.setAttribute("role", "status");
  root.setAttribute("aria-label", loadingText);

  const frame = document.createElement("div");
  frame.className = "source-loading-bridge__frame";
  const backgroundCrop = document.createElement("div");
  backgroundCrop.className = "source-loading-bridge__background";
  const background = document.createElement("img");
  background.className = "source-loading-bridge__background-image";
  background.alt = "";
  background.src = content.resources.url("mainscreenBackground.png");
  await background.decode();

  const label = document.createElement("div");
  label.className = "source-loading-bridge__label";
  const text = document.createElement("span");
  text.textContent = loadingText;
  const dots = document.createElement("span");
  dots.className = "source-loading-bridge__dots";
  dots.setAttribute("aria-hidden", "true");
  label.append(text, dots);
  backgroundCrop.appendChild(background);
  frame.append(backgroundCrop, label);
  root.appendChild(frame);

  let timer: ReturnType<typeof globalThis.setInterval> | undefined;
  let visualPoll: number | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let resizeHost: HTMLElement | undefined;
  let dotCount = 0;
  let mounted = false;
  const applyLayout = (): void => {
    if (resizeHost === undefined) return;
    const bounds = resizeHost.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const layout = sourceLoadingScreenLayout(
      mode,
      bounds.width,
      bounds.height,
      background.naturalWidth,
      background.naturalHeight,
    );
    frame.style.width = `${layout.frameWidthPx}px`;
    frame.style.height = `${layout.frameHeightPx}px`;
    backgroundCrop.style.width = `${layout.backgroundWidthPx}px`;
    backgroundCrop.style.height = `${layout.backgroundHeightPx}px`;
    background.style.width = `${layout.sourceImageWidthPx}px`;
    background.style.height = `${layout.sourceImageHeightPx}px`;
    background.style.left = `${layout.sourceImageLeftPx}px`;
    background.style.top = `${layout.sourceImageTopPx}px`;
    label.style.bottom = `${layout.labelBottomPx}px`;
    label.style.fontSize = `${layout.labelFontPx}px`;
  };
  const dismiss = (): void => {
    if (timer !== undefined) {
      globalThis.clearInterval(timer);
      timer = undefined;
    }
    if (visualPoll !== undefined) {
      globalThis.cancelAnimationFrame(visualPoll);
      visualPoll = undefined;
    }
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    globalThis.removeEventListener("resize", applyLayout);
    resizeHost = undefined;
    root.remove();
    mounted = false;
  };
  const dismissWhenPixiIsVisible = (): void => {
    const app = (globalThis as Record<string, unknown>)["__PIXI_APP__"] as
      | { stage?: { children?: unknown[] } }
      | undefined;
    const stack = [...(app?.stage?.children ?? [])] as Array<{
      label?: string;
      visible?: boolean;
      children?: unknown[];
    }>;
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (
        node.visible !== false &&
        (
          node.label === "sourceTitleScene" ||
          node.label === "sourceStartupBackground:mainscreenBackground"
        )
      ) {
        dismiss();
        return;
      }
      stack.push(...(node.children ?? []) as typeof stack);
    }
    visualPoll = globalThis.requestAnimationFrame(dismissWhenPixiIsVisible);
  };
  return {
    mount(host) {
      if (mounted) throw new Error("source loading screen is already mounted");
      mounted = true;
      resizeHost = host;
      host.replaceChildren(root);
      applyLayout();
      resizeObserver = new ResizeObserver(applyLayout);
      resizeObserver.observe(host);
      globalThis.addEventListener("resize", applyLayout);
      timer = globalThis.setInterval(() => {
        dotCount = dotCount >= 3 ? 1 : dotCount + 1;
        dots.textContent = ".".repeat(dotCount);
      }, 500);
      visualPoll = globalThis.requestAnimationFrame(dismissWhenPixiIsVisible);
    },
    dismiss,
  };
}

/**
 * Prepares the same source startup crop behind the browser-owned content gate. The image remains
 * fully opaque inside a root that fades in after its zero-opacity state has painted. A separate
 * gate scrim keeps the form calm and readable, then fades away before the DOM loading bridge
 * replaces it with the pixel-aligned source presentation.
 */
export async function prepareSourceLandingBackdrop(
  content: ImportedContentPackage,
  mode: DisplayMode = DISPLAY_MODE,
): Promise<PreparedSourceLandingBackdrop> {
  const root = document.createElement("div");
  root.className = "content-gate__backdrop";
  root.setAttribute("aria-hidden", "true");

  const frame = document.createElement("div");
  frame.className = "content-gate__backdrop-frame";
  const backgroundCrop = document.createElement("div");
  backgroundCrop.className = "content-gate__backdrop-background";
  const background = document.createElement("img");
  background.className = "content-gate__backdrop-image";
  background.alt = "";
  background.src = content.resources.url("mainscreenBackground.png");
  await background.decode();

  const scrim = document.createElement("div");
  scrim.className = "content-gate__backdrop-scrim";
  backgroundCrop.appendChild(background);
  frame.appendChild(backgroundCrop);
  root.append(frame, scrim);

  let resizeObserver: ResizeObserver | undefined;
  let resizeHost: HTMLElement | undefined;
  let revealFrame: number | undefined;
  let mounted = false;
  const applyLayout = (): void => {
    if (resizeHost === undefined) return;
    const bounds = resizeHost.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const layout = sourceLoadingScreenLayout(
      mode,
      bounds.width,
      bounds.height,
      background.naturalWidth,
      background.naturalHeight,
    );
    frame.style.width = `${layout.frameWidthPx}px`;
    frame.style.height = `${layout.frameHeightPx}px`;
    backgroundCrop.style.width = `${layout.backgroundWidthPx}px`;
    backgroundCrop.style.height = `${layout.backgroundHeightPx}px`;
    background.style.width = `${layout.sourceImageWidthPx}px`;
    background.style.height = `${layout.sourceImageHeightPx}px`;
    background.style.left = `${layout.sourceImageLeftPx}px`;
    background.style.top = `${layout.sourceImageTopPx}px`;
  };
  const dismiss = (): void => {
    if (revealFrame !== undefined) {
      globalThis.cancelAnimationFrame(revealFrame);
      revealFrame = undefined;
    }
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    globalThis.removeEventListener("resize", applyLayout);
    resizeHost = undefined;
    root.remove();
    mounted = false;
  };
  return {
    mount(host) {
      if (mounted) throw new Error("source landing backdrop is already mounted");
      mounted = true;
      resizeHost = host;
      host.prepend(root);
      applyLayout();
      if (typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver(applyLayout);
        resizeObserver.observe(host);
      }
      globalThis.addEventListener("resize", applyLayout);
      revealFrame = globalThis.requestAnimationFrame(() => {
        revealFrame = globalThis.requestAnimationFrame(() => {
          revealFrame = undefined;
          if (mounted) root.classList.add("content-gate__backdrop--visible");
        });
      });
    },
    dismiss,
  };
}
