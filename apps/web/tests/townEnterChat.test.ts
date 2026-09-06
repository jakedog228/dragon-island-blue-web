import { describe, expect, it } from "vitest";
import type { ChatDefinition, TownEnterChatDefinition } from "@dib/gamedata/browser";
import {
  nextTownEnterChat,
  selectTownEnterChat,
  townEnterChatConditionPasses,
  type TownEnterChatState,
} from "../src/world/townEnterChat.js";

const chat = (name: string): ChatDefinition => ({
  name,
  alwaysShow: false,
  imageFile: "ClerkGirl.png",
  messageKeys: [],
});

class DialogState implements TownEnterChatState {
  readonly calls: string[] = [];
  constructor(readonly seen = new Set<string>()) {}
  hasSeenDialog(name: string): boolean { return this.seen.has(name); }
  requestChatPresentation(name: string, alwaysShow: boolean): boolean {
    this.calls.push(name);
    if (this.seen.has(name)) return alwaysShow;
    this.seen.add(name);
    return true;
  }
}

describe("TownPOINode ordered enter-chat scan", () => {
  const entries: readonly TownEnterChatDefinition[] = [
    { chat: chat("LeslieIntro1") },
    { chat: chat("LeslieIntro2"), requiredSeenChat: "LeslieSaved" },
    { chat: chat("LeslieIntro2.5"), requiredSeenChat: "LeslieIntro2" },
  ];

  it("marks and returns only the first actually presented chat per town entry", () => {
    const state = new DialogState();
    expect(selectTownEnterChat(entries, state)?.name).toBe("LeslieIntro1");
    expect(state.seen).toEqual(new Set(["LeslieIntro1"]));
    expect(state.calls).toEqual(["LeslieIntro1"]);
  });

  it("selects an authoritative candidate without mutating the local mirror", () => {
    const state = new DialogState(new Set(["LeslieIntro1", "LeslieSaved"]));
    expect(nextTownEnterChat(entries, state)?.name).toBe("LeslieIntro2");
    expect(state.seen).toEqual(new Set(["LeslieIntro1", "LeslieSaved"]));
    expect(state.calls).toEqual([]);
  });

  it("continues past a suppressed prior chat and stops after the first eligible successor", () => {
    const state = new DialogState(new Set(["LeslieIntro1", "LeslieSaved"]));
    expect(selectTownEnterChat(entries, state)?.name).toBe("LeslieIntro2");
    expect(state.seen.has("LeslieIntro2")).toBe(true);
    expect(state.seen.has("LeslieIntro2.5")).toBe(false);
    expect(state.calls).toEqual(["LeslieIntro2"]);
  });

  it("supports Conditions.chats negation and rejects an empty identity", () => {
    const state = new DialogState(new Set(["Seen"]));
    expect(townEnterChatConditionPasses("Seen", state)).toBe(true);
    expect(townEnterChatConditionPasses("!Seen", state)).toBe(false);
    expect(townEnterChatConditionPasses("!Missing", state)).toBe(true);
    expect(() => townEnterChatConditionPasses("!", state)).toThrow(/empty identity/);
  });
});
