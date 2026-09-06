import { Container, type Texture } from "pixi.js";
import { pointSprite } from "@dib/renderer";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { unscaledIdiomPt } from "../displayMode.js";
import { MANAGEMENT_CARD_SIZE_PT } from "../battle/monsterManagementMath.js";


export function buildManagementItemBadge(texture: Texture): Container {
  const root = new Container();
  root.label = "managementItemBadge";
  root.eventMode = "none";
  root.position.set(-MANAGEMENT_CARD_SIZE_PT / 2, MANAGEMENT_CARD_SIZE_PT / 2);

  // Everything below this node lives in the item's own pre-fit point space, exactly like the
  // source's renderer node and its outline child.
  const scaled = new Container();
  scaled.label = "managementItemBadgeScale";
  root.addChild(scaled);

  const target = MANAGEMENT_CARD_SIZE_PT / 5;
  const center = pointSprite(texture);
  center.anchor.set(0, 1);
  const fit = Math.min(1, target / Math.max(1, center.width), target / Math.max(1, center.height));
  scaled.scale.set(fit);

  const border = unscaledIdiomPt(2, DISPLAY_MODE);
  for (let degrees = 0; degrees < 360; degrees += 30) {
    const radians = degrees * Math.PI / 180;
    const outline = pointSprite(texture);
    outline.anchor.set(0, 1);
    outline.scale.copyFrom(center.scale);
    outline.position.set(Math.cos(radians) * border, Math.sin(radians) * border);
    outline.tint = 0x000000;
    scaled.addChild(outline);
  }
  scaled.addChild(center);
  return root;
}
