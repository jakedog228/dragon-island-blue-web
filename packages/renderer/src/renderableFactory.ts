import { Container, Rectangle, Sprite, type Texture } from "pixi.js";
import { pointSprite } from "./pointSprite.js";

export interface RenderableSpriteSpec {
  texture: Texture;
  /** Shipped monster rendererData is absent or exactly `{ scale: number }`. */
  rendererData?: unknown;
  label?: string;
}

function authoredRendererScale(rendererData: unknown): number {
  if (rendererData === undefined) return 1;
  if (
    rendererData === null ||
    typeof rendererData !== "object" ||
    Array.isArray(rendererData)
  ) {
    throw new Error("RendererFactory: rendererData must be an object");
  }
  const data = rendererData as Record<string, unknown>;
  const unsupported = Object.keys(data).filter((key) => key !== "scale");
  if (unsupported.length > 0) {
    throw new Error(`RendererFactory: unsupported rendererData keys ${unsupported.join(", ")}`);
  }
  const scale = data["scale"];
  if (scale === undefined) return 1;
  if (typeof scale !== "number" || !Number.isFinite(scale)) {
    throw new Error("RendererFactory: rendererData.scale must be finite");
  }
  return scale;
}


export function createRenderableSpriteNode(spec: RenderableSpriteSpec): Container {
  const root = new Container();
  root.label = spec.label ?? "renderable";
  const sprite = pointSprite(spec.texture);
  root.addChild(sprite);
  root.boundsArea = new Rectangle(0, 0, sprite.width, sprite.height);
  const scale = authoredRendererScale(spec.rendererData);
  root.scale.set(scale);
  return root;
}

/** Returns the factory root's sole CCSprite child. */
export function renderableSprite(node: Container): Sprite {
  const sprites = node.children.filter((child): child is Sprite => child instanceof Sprite);
  if (sprites.length !== 1) {
    throw new Error(`RendererFactory: expected exactly one CCSprite child, got ${sprites.length}`);
  }
  return sprites[0]!;
}

/** Authored RendererFactory content size after the root's rendererData scale, excluding effects
 * or other non-layout children that callers may attach later. */
export function renderableScaledContentSize(node: Container): { w: number; h: number } {
  const bounds = node.boundsArea;
  if (bounds === null) {
    throw new Error("RendererFactory: renderable root is missing its authored boundsArea");
  }
  return {
    w: bounds.width * Math.abs(node.scale.x),
    h: bounds.height * Math.abs(node.scale.y),
  };
}
