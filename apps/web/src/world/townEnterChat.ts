import type {
  ChatDefinition,
  TownEnterChatDefinition,
} from "@dib/gamedata/browser";

export interface TownEnterChatState {
  hasSeenDialog(name: string): boolean;
  requestChatPresentation(name: string, alwaysShow: boolean): boolean;
}


export function selectTownEnterChat(
  entries: readonly TownEnterChatDefinition[],
  state: TownEnterChatState,
): ChatDefinition | undefined {
  const chat = nextTownEnterChat(entries, state);
  return chat !== undefined &&
      state.requestChatPresentation(chat.name, chat.alwaysShow)
    ? chat
    : undefined;
}

/** Pure selector used before an authoritative dialog acknowledgement is committed. */
export function nextTownEnterChat(
  entries: readonly TownEnterChatDefinition[],
  state: Pick<TownEnterChatState, "hasSeenDialog">,
): ChatDefinition | undefined {
  for (const { chat, requiredSeenChat } of entries) {
    if (!townEnterChatConditionPasses(requiredSeenChat, state)) continue;
    if (!state.hasSeenDialog(chat.name) || chat.alwaysShow) return chat;
  }
  return undefined;
}

export function townEnterChatConditionPasses(
  expression: string | undefined,
  state: Pick<TownEnterChatState, "hasSeenDialog">,
): boolean {
  if (expression === undefined) return true;
  const negated = expression.startsWith("!");
  const name = negated ? expression.slice(1) : expression;
  if (name.length === 0) throw new Error("town enter-chat condition has an empty identity");
  const seen = state.hasSeenDialog(name);
  return negated ? !seen : seen;
}
