import {
  Container,
  Geometry,
  Mesh,
  RenderTexture,
  Shader,
  Sprite,
  State,
  type Renderer,
  type Ticker,
} from "pixi.js";
import { CONTENT_SCALE_FACTOR } from "@dib/renderer";
import { stepMonsterpediaCocosInterval } from "./monsterpediaAnimationMath.js";
import {
  MONSTERPEDIA_PAGE_TURN_DURATION_MS,
  buildMonsterpediaPageTurnMesh,
} from "./monsterpediaPageTurnMath.js";

const VERTEX_SOURCE = `
attribute vec2 aPosition;
attribute vec2 aUV;
attribute float aDepthRatio;
attribute float aClipZ;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;

varying vec2 vUV;
varying vec4 vColor;

void main(void) {
  vec3 projected = uProjectionMatrix * uWorldTransformMatrix *
    uTransformMatrix * vec3(aPosition, 1.0);
  gl_Position = vec4(projected.xy * aDepthRatio, aClipZ, aDepthRatio);
  vUV = aUV;
  vColor = uWorldColorAlpha * uColor;
}
`;

const FRAGMENT_SOURCE = `
varying vec2 vUV;
varying vec4 vColor;
uniform sampler2D uTexture;

void main(void) {
  gl_FragColor = texture2D(uTexture, vUV) * vColor;
}
`;

export interface MonsterpediaPageTurnOpts {
  readonly renderer: Renderer;
  readonly ticker: Ticker;
  readonly host: Container;
  readonly outgoing: Container;
  readonly incoming: Container;
  readonly widthPt: number;
  readonly heightPt: number;
  readonly backwards: boolean;
  /**
   * Swaps the live scene over to the incoming page. Invoked synchronously on the completing frame,
   * between the last curl update and the teardown below, so both land in one render.
   */
  readonly commit: () => void;
  readonly signal: AbortSignal;
}

function capture(
  renderer: Renderer,
  scene: Container,
  widthPt: number,
  heightPt: number,
): RenderTexture {
  const texture = RenderTexture.create({
    width: widthPt,
    height: heightPt,
    resolution: CONTENT_SCALE_FACTOR,
    antialias: false,
    scaleMode: "nearest",
  });
  renderer.render({
    container: scene,
    target: texture,
    clear: true,
    clearColor: [0, 0, 0, 0],
  });
  return texture;
}

function createCurlMesh(
  texture: RenderTexture,
  widthPt: number,
  heightPt: number,
  progress: number,
): Mesh<Geometry, Shader> {
  const data = buildMonsterpediaPageTurnMesh(
    widthPt,
    heightPt,
    CONTENT_SCALE_FACTOR,
    progress,
  );
  const geometry = new Geometry({
    label: "monsterpediaPageTurnGrid16x12",
    attributes: {
      aPosition: { buffer: data.positions, format: "float32x2" },
      aUV: { buffer: data.uvs, format: "float32x2" },
      aDepthRatio: { buffer: data.depthRatios, format: "float32" },
      aClipZ: { buffer: data.clipDepths, format: "float32" },
    },
    indexBuffer: data.indices,
    topology: "triangle-list",
  });
  const shader = Shader.from({
    gl: {
      name: "monsterpedia-page-turn",
      vertex: VERTEX_SOURCE,
      fragment: FRAGMENT_SOURCE,
    },
    resources: {
      uTexture: texture.source,
    },
  });
  const state = State.for2d();
  state.culling = false;
  state.depthTest = true;
  state.depthMask = true;
  const mesh = new Mesh({ geometry, shader, texture, state });
  mesh.label = "monsterpediaPageTurn:curl";
  return mesh;
}

function updateCurlMesh(
  mesh: Mesh<Geometry, Shader>,
  widthPt: number,
  heightPt: number,
  progress: number,
): void {
  const data = buildMonsterpediaPageTurnMesh(
    widthPt,
    heightPt,
    CONTENT_SCALE_FACTOR,
    progress,
  );
  const positions = mesh.geometry.getBuffer("aPosition");
  positions.data = data.positions;
  positions.update();
  const depths = mesh.geometry.getBuffer("aDepthRatio");
  depths.data = data.depthRatios;
  depths.update();
  const clipDepths = mesh.geometry.getBuffer("aClipZ");
  clipDepths.data = data.clipDepths;
  clipDepths.update();
}

/**
 * Runs the recovered CCTransitionPageTurn composition and owns every temporary render resource.
 * The caller retains both live scenes until `commit` runs on the completing frame.
 */
export function runMonsterpediaPageTurn(
  opts: MonsterpediaPageTurnOpts,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (opts.signal.aborted) {
      resolve(false);
      return;
    }
    const outgoingTexture = capture(
      opts.renderer,
      opts.outgoing,
      opts.widthPt,
      opts.heightPt,
    );
    const incomingTexture = capture(
      opts.renderer,
      opts.incoming,
      opts.widthPt,
      opts.heightPt,
    );
    const bottomTexture = opts.backwards ? outgoingTexture : incomingTexture;
    const topTexture = opts.backwards ? incomingTexture : outgoingTexture;
    const bottom = new Sprite(bottomTexture);
    bottom.label = "monsterpediaPageTurn:bottom";
    const mesh = createCurlMesh(
      topTexture,
      opts.widthPt,
      opts.heightPt,
      opts.backwards ? 1 - 1e-6 : 0,
    );
    mesh.visible = !opts.backwards;
    const transition = new Container();
    transition.label = "monsterpediaPageTurn";
    transition.eventMode = "none";
    transition.addChild(bottom, mesh);
    opts.host.addChild(transition);
    opts.outgoing.visible = false;

    let elapsedMs = 0;
    let firstTick = true;
    let settled = false;
    const finish = (completed: boolean) => {
      if (settled) return;
      settled = true;
      opts.ticker.remove(step);
      opts.signal.removeEventListener("abort", onAbort);
      try {
        // The scene swap has to happen here, not in the awaiting caller: this runs inside a ticker
        // listener, and the renderer's own listener drains later in this same frame. A promise
        // continuation would resume only after that render, so revealing the outgoing scene below
        // would put the pre-turn page on screen for one frame before the new one replaces it.
        if (completed) opts.commit();
      } finally {
        opts.outgoing.visible = true;
        transition.parent?.removeChild(transition);
        transition.removeChildren();
        bottom.destroy();
        const geometry = mesh.geometry;
        const shader = mesh.shader;
        mesh.destroy();
        geometry.destroy(true);
        shader?.destroy();
        transition.destroy();
        outgoingTexture.destroy(true);
        incomingTexture.destroy(true);
        resolve(completed);
      }
    };
    const onAbort = () => finish(false);
    const step = () => {
      const next = stepMonsterpediaCocosInterval(elapsedMs, opts.ticker.deltaMS, firstTick);
      elapsedMs = next.elapsedMs;
      firstTick = next.firstTick;
      const progress = Math.min(1, elapsedMs / MONSTERPEDIA_PAGE_TURN_DURATION_MS);
      if (opts.backwards) {
        mesh.visible = progress > 0;
        updateCurlMesh(mesh, opts.widthPt, opts.heightPt, 1 - progress);
      } else {
        updateCurlMesh(mesh, opts.widthPt, opts.heightPt, progress);
      }
      if (progress >= 1) finish(true);
    };

    opts.signal.addEventListener("abort", onAbort, { once: true });
    opts.ticker.add(step);
  });
}
