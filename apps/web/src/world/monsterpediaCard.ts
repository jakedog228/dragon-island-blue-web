import { Container, Rectangle, Sprite, Texture } from "pixi.js";
import {
  createRenderableSpriteNode,
  makeTtfLabel,
  pointSprite,
  renderableScaledContentSize,
  type AssetLibrary,
} from "@dib/renderer";
import type { GameData } from "@dib/gamedata/browser";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import {
  localizedRenderableName,
  type LocalizedStrings,
} from "../localization.js";
import {
  monsterpediaCardLayout,
  monsterpediaHalfStarFrame,
} from "./monsterpediaLayoutMath.js";
import type { MonsterpediaEntry } from "./monsterpediaModel.js";

let CARD_LAYOUT = monsterpediaCardLayout(DISPLAY_MODE);
export let MONSTERPEDIA_CARD_SIZE = CARD_LAYOUT.size;
registerRuntimeSettingsRefresh(() => {
  CARD_LAYOUT = monsterpediaCardLayout(DISPLAY_MODE);
  MONSTERPEDIA_CARD_SIZE = CARD_LAYOUT.size;
});

export interface MonsterpediaCardAssets {
  readonly cardFrames: readonly [Texture, Texture, Texture];
  readonly rarityStar: Texture;
  readonly rarityHalfStar: Texture;
  readonly highestLevel: Texture;
  readonly evolveChain: Texture;
  readonly questionmark: Texture;
  readonly combine: Texture;
  readonly unknownIngredient: Texture;
  readonly elementTextures: Readonly<Record<string, Texture>>;
}

export interface MonsterpediaCardHandle {
  readonly root: Container;
  readonly ingredientNodes: readonly Container[];
  readonly debug: {
    readonly shortType: string;
    readonly known: boolean;
    readonly highestLevel: number;
    readonly ordinal: number;
    readonly recipe: boolean;
    readonly recipeKnown?: boolean;
    readonly ingredientTints: readonly number[];
  };
}

export async function loadMonsterpediaCardAssets(assets: AssetLibrary): Promise<MonsterpediaCardAssets> {
  const [atlas, general] = await Promise.all([
    assets.atlas("MonsterpediaFrames-hd"),
    assets.atlas("General-hd"),
  ]);
  const required = (name: string): Texture => {
    const texture = atlas.textures[name];
    if (!texture) throw new Error(`MonsterpediaFrames-hd is missing ${name}`);
    return texture;
  };
  const elementTextures: Record<string, Texture> = {};
  for (const element of ["Air", "Arcane", "Death", "Earth", "Fire", "Life", "Water"] as const) {
    const texture = general.textures[`Element${element}.png`];
    if (!texture) throw new Error(`General-hd is missing Element${element}.png`);
    elementTextures[element] = texture;
  }
  const rarityStar = required("rarityStar.png");
  return {
    cardFrames: [required("monsterCard1.png"), required("monsterCard2.png"), required("monsterCard3.png")],
    rarityStar,
    rarityHalfStar: monsterpediaHalfStarTexture(rarityStar),
    highestLevel: required("highestLevel.png"),
    evolveChain: required("evolveChain.png"),
    questionmark: required("questionmark.png"),
    combine: required("combine.png"),
    unknownIngredient: required("unknownCombineIngredient.png"),
    elementTextures,
  };
}

function cardFrameIndex(stars: number): 0 | 1 | 2 {
  return Math.floor(stars) > 8 ? 2 : Math.floor(stars) > 4 ? 1 : 0;
}

function shrinkRenderableToFit(node: Container, maxW: number, maxH: number): void {
  const size = renderableScaledContentSize(node);
  const fit = Math.min(1, maxW / size.w, maxH / size.h);
  node.scale.set(node.scale.x * fit, node.scale.y * fit);
}

async function monsterPortrait(
  assets: AssetLibrary,
  data: GameData,
  shortType: string,
  maxW: number,
  maxH: number,
): Promise<Container> {
  const monster = data.monsterByShortType(shortType);
  const portrait = createRenderableSpriteNode({
    texture: await assets.sprite(`${shortType}-hd`),
    rendererData: monster.rendererData,
    label: `monsterpediaPortrait:${shortType}`,
  });
  shrinkRenderableToFit(portrait, maxW, maxH);
  const bounds = portrait.boundsArea;
  if (bounds === null) throw new Error(`Monsterpedia portrait ${shortType} has no authored bounds`);
  portrait.pivot.set(bounds.width / 2, bounds.height / 2);
  return portrait;
}


async function ingredientPortrait(
  assets: AssetLibrary,
  data: GameData,
  shortType: string,
  maxW: number,
  maxH: number,
): Promise<Container> {
  data.monsterByShortType(shortType);
  const portrait = createRenderableSpriteNode({
    texture: await assets.sprite(`${shortType}-hd`),
    label: `monsterpediaIngredientRenderable:${shortType}`,
  });
  shrinkRenderableToFit(portrait, maxW, maxH);
  return portrait;
}

const HALF_STAR_TEXTURES = new WeakMap<Texture, Texture>();

/** Source texture-rect crop: retain the left half at full geometry, never squeeze the artwork. */
export function monsterpediaHalfStarTexture(texture: Texture): Texture {
  const cached = HALF_STAR_TEXTURES.get(texture);
  if (cached) return cached;
  const frame = monsterpediaHalfStarFrame(texture.frame);
  const half = new Texture({
    source: texture.source,
    frame: new Rectangle(
      frame.x,
      frame.y,
      frame.width,
      frame.height,
    ),
  });
  HALF_STAR_TEXTURES.set(texture, half);
  return half;
}

/** Source `MonsterCardNode` construction shared by the book and expanded evolution chains. */
export async function createMonsterpediaCard(
  assets: AssetLibrary,
  cardAssets: MonsterpediaCardAssets,
  data: GameData,
  strings: LocalizedStrings,
  entry: MonsterpediaEntry,
  options: {
    readonly ingredientRegistered?: readonly [boolean, boolean];
    readonly onOpen: () => void;
  },
): Promise<MonsterpediaCardHandle> {
  const { monster } = entry;
  const root = new Container();
  root.label = `monsterpediaCard:${monster.shortType}`;
  root.eventMode = "static";
  root.cursor = "pointer";
  root.hitArea = new Rectangle(0, 0, CARD_LAYOUT.size.w, CARD_LAYOUT.size.h);
  root.on("pointertap", (event) => {
    event.stopPropagation();
    options.onOpen();
  });

  const frame = pointSprite(cardAssets.cardFrames[cardFrameIndex(monster.stars)]);
  frame.label = "monsterpediaCardFrame";
  root.addChild(frame);

  const known = entry.known;
  if (known) {
    const portrait = await monsterPortrait(
      assets,
      data,
      monster.shortType,
      CARD_LAYOUT.portrait.ordinaryMax.w,
      CARD_LAYOUT.portrait.ordinaryMax.h,
    );
    portrait.position.set(
      CARD_LAYOUT.portrait.ordinaryCenter.x,
      frame.height - CARD_LAYOUT.portrait.ordinaryCenter.yFromFrameBottom,
    );
    root.addChild(portrait);

    const name = makeTtfLabel(
      localizedRenderableName(strings, [monster.shortType]),
      CARD_LAYOUT.name.fontPt,
      {
      fill: 0x000000,
      outline: false,
      },
    );
    name.anchor.set(0.5, 1);
    name.position.set(CARD_LAYOUT.name.x, frame.height - CARD_LAYOUT.name.yFromFrameBottom);
    root.addChild(name);

    const starRow = new Container();
    const starCount = Math.floor(monster.stars);
    for (let index = 0; index < starCount; index += 1) {
      const star = pointSprite(cardAssets.rarityStar);
      star.label = "monsterpediaRarityStar:full";
      star.position.x = index * star.width;
      starRow.addChild(star);
    }
    if (monster.stars % 1 !== 0) {
      const star = pointSprite(cardAssets.rarityHalfStar);
      star.label = "monsterpediaRarityStar:half";
      const fullStarProbe = pointSprite(cardAssets.rarityStar);
      star.position.x = starCount * fullStarProbe.width;
      fullStarProbe.destroy();
      starRow.addChild(star);
    }
    starRow.position.set(
      Math.round((frame.width - starRow.width) / 2),
      frame.height - CARD_LAYOUT.rarityYFromFrameBottom - starRow.height / 2,
    );
    root.addChild(starRow);

    const highest = pointSprite(cardAssets.highestLevel);
    highest.anchor.set(0.5, 0.7);
    highest.position.set(
      CARD_LAYOUT.highestBadge.x,
      frame.height - CARD_LAYOUT.highestBadge.yFromFrameBottom,
    );
    root.addChild(highest);
    const levelFont = entry.highestLevel >= 100
      ? CARD_LAYOUT.highestLevel.fontPt * (10 / 16)
      : entry.highestLevel >= 10
        ? CARD_LAYOUT.highestLevel.fontPt * (13 / 16)
        : CARD_LAYOUT.highestLevel.fontPt;
    const level = makeTtfLabel(String(entry.highestLevel), levelFont, {
      fill: 0x000000,
      outline: false,
    });
    level.anchor.set(0.5);
    level.position.set(
      CARD_LAYOUT.highestLevel.x,
      frame.height - CARD_LAYOUT.highestLevel.yFromFrameBottom,
    );
    root.addChild(level);

    const elementTexture = cardAssets.elementTextures[monster.element];
    if (!elementTexture) throw new Error(`Monsterpedia card: no ${monster.element} element frame`);
    const element = pointSprite(elementTexture);
    element.anchor.set(0.5);
    element.position.set(
      CARD_LAYOUT.element.x,
      frame.height - CARD_LAYOUT.element.yFromFrameBottom,
    );
    root.addChild(element);

    const belongsToEvolveChain = monster.evolveData !== undefined || data.allMonsters().some(
      (candidate) => candidate.evolveData?.newType === monster.shortType,
    );
    if (belongsToEvolveChain) {
      const evolve = pointSprite(cardAssets.evolveChain);
      evolve.anchor.set(0.5);
      evolve.position.set(
        CARD_LAYOUT.evolveChain.x,
        frame.height - CARD_LAYOUT.evolveChain.yFromFrameBottom,
      );
      root.addChild(evolve);
    }
  } else {
    const question = pointSprite(cardAssets.questionmark);
    question.anchor.set(0.5);
    if (question.height > CARD_LAYOUT.unknownMaxHeight) {
      const fit = CARD_LAYOUT.unknownMaxHeight / question.height;
      question.scale.set(question.scale.x * fit, question.scale.y * fit);
    }
    question.position.set(CARD_LAYOUT.unknownCenter.x, CARD_LAYOUT.unknownCenter.y);
    root.addChild(question);
  }


  const index = makeTtfLabel(String(entry.ordinal), CARD_LAYOUT.index.fontPt, {
    fill: 0x000000,
    outline: false,
  });
  index.anchor.set(0.5);
  index.position.set(
    CARD_LAYOUT.index.x,
    frame.height - CARD_LAYOUT.index.yFromFrameBottom,
  );
  root.addChild(index);

  const ingredientNodes: Container[] = [];
  if (entry.kind === "recipe") {
    for (const [slot, ingredient] of entry.recipe.ingredients.entries()) {
      const sprite = entry.recipeKnown
        ? await ingredientPortrait(
            assets,
            data,
            ingredient,
            CARD_LAYOUT.ingredientMax.w,
            CARD_LAYOUT.ingredientMax.h,
          )
        : pointSprite(cardAssets.unknownIngredient);
      const center = CARD_LAYOUT.ingredientCenters[slot]!;
      if (sprite instanceof Sprite) {
        sprite.anchor.set(center.anchorX, center.anchorY);
      } else {
        const bounds = sprite.boundsArea;
        if (bounds === null) {
          throw new Error(`Monsterpedia ingredient ${ingredient} has no authored bounds`);
        }
        sprite.pivot.set(bounds.width * center.anchorX, bounds.height * center.anchorY);
      }
      sprite.position.set(center.x, center.y);
      sprite.label = `monsterpediaIngredient:${slot}:${ingredient}`;
      if (entry.recipeKnown && !(options.ingredientRegistered?.[slot] ?? true)) {
        sprite.tint = 0x000000;
      }
      root.addChild(sprite);
      ingredientNodes.push(sprite);
    }
    const combine = pointSprite(cardAssets.combine);
    combine.anchor.set(0.5);
    combine.position.set(CARD_LAYOUT.combine.x, CARD_LAYOUT.combine.y);
    combine.label = `monsterpediaCombine:${monster.shortType}`;
    // `combine.png` is decoration. The native touch list contains MonsterCardNode itself, not a
    // second enlarged combine hit target; Make/Look is reached by opening the recipe card.
    combine.eventMode = "none";
    root.addChild(combine);
  }

  return {
    root,
    ingredientNodes,
    debug: {
      shortType: monster.shortType,
      known: entry.known,
      highestLevel: entry.highestLevel,
      ordinal: entry.ordinal,
      recipe: entry.kind === "recipe",
      ...(entry.kind === "recipe" ? { recipeKnown: entry.recipeKnown } : {}),
      ingredientTints: ingredientNodes.map((node) => node.tint as number),
    },
  };
}
