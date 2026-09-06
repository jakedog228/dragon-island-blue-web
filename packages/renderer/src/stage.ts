import { Application, Container, Graphics } from "pixi.js";
import { computeFit } from "./letterbox.js";
import { LifecycleScope } from "./lifecycle.js";
import { setTtfTextPresentationScale } from "./ttfTextResolution.js";
import { installCocosSourceAlphaAddBlend } from "./cocosBlendModes.js";
import { installGameSurfaceGuards } from "./gameSurface.js";

export const STAGE_WIDTH = 960;
export const STAGE_HEIGHT = 640;

/** Fixed-size logical stage, scaled + letterboxed into its host element. Defaults to the
 *  960x640 retina-iPhone tier; the app can pass another device tier's logical pixel size
 *  (e.g. 1024x768 for the experimental iPad display mode). */
export class FixedStage {
  readonly app = new Application();
  readonly root = new Container();
  /** Logical stage size in device pixels (points x CONTENT_SCALE_FACTOR). */
  readonly width: number;
  readonly height: number;
  /** Last letterbox fit scale (CSS viewport / logical stage). Feeds modern TTF bake density. */
  private _letterboxScale = 1;
  private readonly lifecycle = new LifecycleScope();
  private initialized = false;

  constructor(size?: { width: number; height: number }) {
    this.width = size?.width ?? STAGE_WIDTH;
    this.height = size?.height ?? STAGE_HEIGHT;
  }

  /** Current letterbox scale applied to `root` (1 when the viewport matches the stage exactly). */
  get letterboxScale(): number {
    return this._letterboxScale;
  }

  /** Whether the application/renderer owned by this stage has been released. */
  get destroyed(): boolean {
    return this.lifecycle.disposed;
  }

  async init(
    host: HTMLElement,
    options: { readonly deterministicHarness?: boolean } = {},
  ): Promise<void> {
    if (this.lifecycle.disposed) throw new Error("FixedStage.init: stage is already destroyed");
    if (this.initialized) throw new Error("FixedStage.init: stage is already initialized");
    // The web app installs `advanceTime` for diagnostics after a normal boot too. A later
    // in-memory renderer restart must not reinterpret that app-owned hook as a test harness and
    // create a stopped ticker. Callers that can restart must capture harness intent before boot
    // and pass it explicitly.
    const deterministicHarness = options.deterministicHarness ??
      typeof (globalThis as Record<string, unknown>)["advanceTime"] === "function";
    await this.app.init({
      background: "#000000",
      resizeTo: host,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      // The original is OpenGL ES. WebGL also gives the deterministic harness a preservable
      // drawing buffer, avoiding partial/black captures from the auto-selected WebGPU backend.
      preference: "webgl",
      preserveDrawingBuffer: deterministicHarness,
    });
    this.initialized = true;
    const removeCocosBlendMode = installCocosSourceAlphaAddBlend(this.app.renderer);
    this.lifecycle.add(() => this.app.destroy({ removeView: true }, { children: true }));
    this.lifecycle.add(removeCocosBlendMode);
    const canvas = this.app.canvas;
    // Pixi's `canvas` is the generic `ICanvas`; the web app always renders into a real DOM canvas,
    // and the browser-surface policy below is meaningless without one.
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("FixedStage.init: renderer did not produce a DOM canvas");
    }
    installGameSurfaceGuards(canvas, this.lifecycle);
    host.appendChild(canvas);
    this.app.stage.addChild(this.root);
    // Clip to the logical stage rect: on the original hardware the physical screen edge crops
    // anything positioned past winSize (e.g. the popup kit's ClerkGirl overlay sits at
    // x = -0.15 * free width BY DESIGN); without this mask that overflow would render into the
    // letterbox bars, which have no equivalent on the device.
    const stageMask = new Graphics().rect(0, 0, this.width, this.height).fill(0xffffff);
    this.root.addChild(stageMask);
    this.root.mask = stageMask;
    // Expose for PixiJS devtools and headless scene-graph probes (standard PixiJS convention).
    (globalThis as Record<string, unknown>)["__PIXI_APP__"] = this.app;
    this.lifecycle.add(() => {
      const globals = globalThis as Record<string, unknown>;
      if (globals["__PIXI_APP__"] === this.app) delete globals["__PIXI_APP__"];
    });
    const apply = () => {
      const fit = computeFit(this.app.screen.width, this.app.screen.height, this.width, this.height);
      this._letterboxScale = fit.scale;
      // Modern TTF mode multiplies bake resolution by this scale (ttfTextResolution.ts).
      // Harmless in "original" mode — the value is only read when modern is configured.
      setTtfTextPresentationScale(fit.scale);
      this.root.scale.set(fit.scale);
      this.root.position.set(fit.offsetX, fit.offsetY);
    };
    apply();
    this.app.renderer.on("resize", apply);
    this.lifecycle.add(() => this.app.renderer.off("resize", apply));
    // Pixi's ResizePlugin listens only to `window.resize`. Mobile browsers can settle dynamic
    // viewport units and safe-area insets after that event (or through VisualViewport alone), so
    // observe the actual host as well. This keeps renderer.screen, the CSS canvas, letterboxing,
    // and pointer mapping on the same rectangle after orientation/fullscreen changes.
    if (typeof globalThis.ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        if (!this.lifecycle.disposed) this.app.resize();
      });
      observer.observe(host);
      this.lifecycle.add(() => observer.disconnect());
    }
  }

  /** Releases renderer, canvas, resize hooks, scene graph, and the devtools global exactly once. */
  destroy(): void {
    this.lifecycle.dispose();
  }

  /** Client (CSS pixel) coordinates -> logical stage coordinates. */
  toStage(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.root.position.x) / this.root.scale.x,
      y: (clientY - rect.top - this.root.position.y) / this.root.scale.y,
    };
  }
}
