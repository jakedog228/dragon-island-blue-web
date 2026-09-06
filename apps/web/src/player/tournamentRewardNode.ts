import { createRenderableSpriteNode, type AssetLibrary } from "@dib/renderer";
import type { GameData } from "@dib/gamedata/browser";
import type { PlayerReward } from "@dib/engine";
import type { Container } from "pixi.js";










export async function buildTournamentRewardNode(
  prize: PlayerReward,
  assets: AssetLibrary,
  data: GameData,
  label: string,
): Promise<Container> {
  if (prize.kind === "monsterJoin") {
    const monster = data.monsterByShortType(prize.shortType);
    return createRenderableSpriteNode({
      texture: await assets.sprite(`${prize.shortType}-hd`),
      rendererData: monster.rendererData,
      label: `${label}:monsterJoin`,
    });
  }
  const inventory = await assets.atlas("InventoryItemFrames-hd");
  const frameName = prize.kind === "monsterEgg" ? "MonsterEgg.png" : "Egg.png";
  const texture = inventory.textures[frameName];
  if (texture === undefined) {
    throw new Error(`InventoryItemFrames-hd is missing prize frame ${frameName}`);
  }
  return createRenderableSpriteNode({ texture, label: `${label}:${prize.kind}` });
}
