import {
  Container,
  Geometry,
  Mesh,
  Point,
  Shader,
  Sprite,
  UniformGroup,
} from "pixi.js";
import type { DisplayMode } from "../displayMode.js";
import {
  managementPerspectiveFocalPt,
  managementPerspectiveZEyePt,
  sourceCoverflowOrbitTrig,
} from "./monsterManagementMath.js";

const VERTEX_SOURCE = `
attribute vec2 aPosition;
attribute vec2 aUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
uniform vec4 uPivotEyeSinCos;
uniform vec4 uCameraFocalEpsilon;

varying vec2 vUV;
varying vec4 vColor;

void main(void) {
  vec3 source = uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.0);
  float localX = source.x - uPivotEyeSinCos.x;
  float worldZ = uPivotEyeSinCos.z * localX - uCameraFocalEpsilon.w;
  float cameraDistance = uPivotEyeSinCos.y - worldZ;
  float depthRatio = cameraDistance / uPivotEyeSinCos.y;
  vec2 rotated = vec2(
    uPivotEyeSinCos.x + uPivotEyeSinCos.w * localX,
    source.y
  );
  vec2 camera = uCameraFocalEpsilon.xy;
  vec2 projected = camera +
    uCameraFocalEpsilon.z * (rotated - camera) / cameraDistance;
  vec3 clip = uProjectionMatrix * vec3(projected, 1.0);

  // Carry the camera-space W through rasterization. This gives every atlas sprite the same
  // perspective-correct interpolation that its directly submitted Cocos quad received.
  gl_Position = vec4(clip.xy * depthRatio, 0.0, depthRatio);
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

export type CflowProjectedSprite = Mesh<Geometry, Shader>;

/**
 * Source-equivalent card camera owner.
 *
 * Cocos visits each descendant sprite beneath the card's `CCOrbitCamera` matrix. Consequently
 * every sprite quad must enter the GPU independently. A Pixi Filter is observably different: it
 * first rasterizes the complete subtree and then bilinearly samples that temporary texture. This
 * controller replaces the card's Sprite leaves with direct projective meshes sharing one camera
 * uniform group. Containers and touch bounds remain affine/unprojected, as they do in Cocos.
 */
export class CflowPerspectiveFilter {
  private readonly pivotEyeSinCos: Float32Array;
  private readonly cameraFocalEpsilon: Float32Array;
  private readonly pivot = new Point();
  private readonly camera = new Point();
  private readonly cameraUnitY = new Point();
  private readonly replacements = new Map<Sprite, CflowProjectedSprite>();
  private readonly spriteQuads = new Map<Sprite, {
    mesh: CflowProjectedSprite;
    positions: Float32Array;
    uvs: Float32Array;
  }>();
  private readonly resources: Array<{ geometry: Geometry; shader: Shader }> = [];
  private readonly previousOnRender: Container["onRender"];
  private orbitSin = 0;
  private orbitCos = 1;

  constructor(
    private readonly card: Container,
    private readonly screenRoot: Container,
    private readonly screen: Readonly<{ w: number; h: number }>,
    private readonly mode: DisplayMode,
    private readonly localPivot: Readonly<{ x: number; y: number }> = { x: 0, y: 40 },
  ) {
    const cameraUniforms = new UniformGroup({
      uPivotEyeSinCos: { value: new Float32Array([0, 1, 0, 1]), type: "vec4<f32>" },
      uCameraFocalEpsilon: { value: new Float32Array([0, 0, 1, 0]), type: "vec4<f32>" },
    });
    this.pivotEyeSinCos = cameraUniforms.uniforms.uPivotEyeSinCos as Float32Array;
    this.cameraFocalEpsilon = cameraUniforms.uniforms.uCameraFocalEpsilon as Float32Array;

    for (const sprite of this.collectSprites(card)) {
      const mesh = this.projectSprite(sprite, cameraUniforms);
      this.replacements.set(sprite, mesh);
    }

    this.previousOnRender = card.onRender;
    card.onRender = (renderer) => {
      this.previousOnRender?.(renderer);
      this.updateCameraUniforms();
    };
  }

  private collectSprites(root: Container): Sprite[] {
    const sprites: Sprite[] = [];
    const visit = (node: Container): void => {
      for (const child of [...node.children]) {
        if (child instanceof Sprite) sprites.push(child);
        else if (child instanceof Container) visit(child);
      }
    };
    visit(root);
    return sprites;
  }

  private projectSprite(sprite: Sprite, cameraUniforms: UniformGroup): CflowProjectedSprite {
    const bounds = sprite.visualBounds;
    const uvs = sprite.texture.uvs;
    const positions = new Float32Array([
      bounds.minX, bounds.minY,
      bounds.maxX, bounds.minY,
      bounds.maxX, bounds.maxY,
      bounds.minX, bounds.maxY,
    ]);
    const textureUvs = new Float32Array([
      uvs.x0, uvs.y0,
      uvs.x1, uvs.y1,
      uvs.x2, uvs.y2,
      uvs.x3, uvs.y3,
    ]);
    const geometry = new Geometry({
      attributes: {
        aPosition: {
          buffer: positions,
          format: "float32x2",
        },
        aUV: {
          buffer: textureUvs,
          format: "float32x2",
        },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]),
      topology: "triangle-list",
    });
    const shader = Shader.from({
      gl: {
        name: "dib-cflow-direct-sprite",
        vertex: VERTEX_SOURCE,
        fragment: FRAGMENT_SOURCE,
      },
      resources: {
        uTexture: sprite.texture.source,
        cameraUniforms,
      },
    });
    const mesh = new Mesh({ geometry, shader, texture: sprite.texture });
    mesh.label = sprite.label;
    mesh.position.copyFrom(sprite.position);
    mesh.scale.copyFrom(sprite.scale);
    mesh.skew.copyFrom(sprite.skew);
    mesh.pivot.copyFrom(sprite.pivot);
    mesh.rotation = sprite.rotation;
    mesh.alpha = sprite.alpha;
    mesh.tint = sprite.tint;
    mesh.visible = sprite.visible;
    mesh.zIndex = sprite.zIndex;
    if (sprite.eventMode !== undefined) mesh.eventMode = sprite.eventMode;
    mesh.roundPixels = false;

    const parent = sprite.parent;
    if (!parent) throw new Error("CFlow perspective sprite has no parent");
    const index = parent.getChildIndex(sprite);
    parent.removeChild(sprite);
    parent.addChildAt(mesh, index);
    this.resources.push({ geometry, shader });
    this.spriteQuads.set(sprite, { mesh, positions, uvs: textureUvs });
    return mesh;
  }

  projectedSprite(sprite: Sprite): CflowProjectedSprite {
    const replacement = this.replacements.get(sprite);
    if (!replacement) throw new Error("Sprite is not a descendant of this CFlow card");
    return replacement;
  }

  /** Reproduces the injury icon's bottom-up rectangular mask without a second, unprojected Pixi
   * stencil pass: Cocos submits the clipped sprite vertices under the same parent camera. */
  setVerticalReveal(sprite: Sprite, progress: number): void {
    const quad = this.spriteQuads.get(sprite);
    if (!quad) throw new Error("Sprite is not a descendant of this CFlow card");
    const amount = Math.max(0, Math.min(1, progress));
    const positions = quad.positions;
    const uvs = quad.uvs;
    const bottomY = positions[5]!;
    const fullTopY = sprite.visualBounds.minY;
    const topY = bottomY - (bottomY - fullTopY) * amount;
    positions[1] = topY;
    positions[3] = topY;
    const sourceUvs = sprite.texture.uvs;
    uvs[0] = sourceUvs.x3 + (sourceUvs.x0 - sourceUvs.x3) * amount;
    uvs[1] = sourceUvs.y3 + (sourceUvs.y0 - sourceUvs.y3) * amount;
    uvs[2] = sourceUvs.x2 + (sourceUvs.x1 - sourceUvs.x2) * amount;
    uvs[3] = sourceUvs.y2 + (sourceUvs.y1 - sourceUvs.y2) * amount;
    quad.mesh.geometry.getBuffer("aPosition").update();
    quad.mesh.geometry.getBuffer("aUV").update();
  }

  setOrbitDegrees(degrees: number): void {
    const trig = sourceCoverflowOrbitTrig(degrees);
    this.orbitSin = trig.sin;
    this.orbitCos = trig.cos;
  }

  private updateCameraUniforms(): void {
    // Pixi runs RenderGroup.onRender callbacks before updateRenderGroupTransforms. Reading the
    // cached world transform here therefore lags moving cards by one frame and, for a newly rebuilt
    // Party Editor card, reads the constructor's identity transform on its first frame. Resolve the
    // live local-transform chain so a transfer between batting and reserves cannot flash through a
    // stale perspective projection.
    this.card.toGlobal(this.localPivot, this.pivot, false);
    this.screenRoot.toGlobal(
      { x: this.screen.w / 2, y: this.screen.h / 2 },
      this.camera,
      false,
    );
    this.screenRoot.toGlobal(
      { x: this.screen.w / 2, y: this.screen.h / 2 + 1 },
      this.cameraUnitY,
      false,
    );
    const presentationScale = Math.hypot(
      this.cameraUnitY.x - this.camera.x,
      this.cameraUnitY.y - this.camera.y,
    );
    this.pivotEyeSinCos[0] = this.pivot.x;
    this.pivotEyeSinCos[1] = managementPerspectiveZEyePt(this.screen.h, this.mode) * presentationScale;
    this.pivotEyeSinCos[2] = this.orbitSin;
    this.pivotEyeSinCos[3] = this.orbitCos;
    this.cameraFocalEpsilon[0] = this.camera.x;
    this.cameraFocalEpsilon[1] = this.camera.y;
    this.cameraFocalEpsilon[2] = managementPerspectiveFocalPt(this.screen.h) * presentationScale;
    this.cameraFocalEpsilon[3] = Math.pow(2, -23) * presentationScale /
      (this.mode === "ipad" ? 2 : 1);
  }

  destroy(_destroyPrograms = false): void {
    this.card.onRender = this.previousOnRender;
    for (const { geometry, shader } of this.resources) {
      geometry.destroy(true);
      shader.destroy();
    }
    this.resources.length = 0;
    this.replacements.clear();
    this.spriteQuads.clear();
  }
}
