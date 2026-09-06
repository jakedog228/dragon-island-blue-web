import { loadChatDefinition, type ChatDefinition, type ChatResourceSource } from "@dib/gamedata/browser";
import type { BattleLifecycleChatV1 } from "@dib/game-protocol";

/**
 * Rehydrate archive-neutral Official lifecycle metadata with only the portrait selected by the
 * browser's local content package. Historical projections intentionally have no lifecycle field.
 */
export function rehydrateOfficialBattleWinChat(
  battle: object,
  resources: ChatResourceSource,
): ChatDefinition | undefined {
  const projected = "winChat" in battle
    ? (battle as { readonly winChat?: BattleLifecycleChatV1 }).winChat
    : undefined;
  if (projected === undefined) return undefined;
  const local = loadChatDefinition(resources, projected.name);
  return Object.freeze({
    name: projected.name,
    alwaysShow: projected.alwaysShow,
    messageKeys: Object.freeze([...projected.messageKeys]),
    ...(local.imageFile === undefined ? {} : { imageFile: local.imageFile }),
  });
}
