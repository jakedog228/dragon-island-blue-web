import { Container } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import {
  POPUP_HOST_Z_INDEX,
  PopupHost,
  type NotificationOverlay,
  type Popup,
} from "../src/ui/popup.js";
import { CHAINED_TEXT_CHAT_Z_INDEX } from "../src/ui/chainedTextChat.js";

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest", platform: "Win32" },
  });
});

function popupStub(host: PopupHost, owner: object, hidesWhenNotOnTop = true): Popup {
  const popup = new Container() as unknown as Popup;
  Object.assign(popup, {
    hidesWhenNotOnTop,
    dismiss: vi.fn(() => {
      host.release(popup, owner);
      popup.destroy({ children: true });
    }),
  });
  return popup;
}

function overlayStub(): NotificationOverlay & { hidden: boolean } {
  const node = new Container();
  const overlay = {
    node,
    hidden: false,
    setHiddenByLayerAbove(hidden: boolean) {
      overlay.hidden = hidden;
      node.visible = !hidden;
    },
  };
  return overlay;
}

describe("PopupHost", () => {
  it("mounts one notification host above scene content and reuses it", () => {
    const parent = new Container();
    const host = PopupHost.for(parent);
    expect(PopupHost.for(parent)).toBe(host);
    expect(parent.sortableChildren).toBe(true);
    expect(host.zIndex).toBe(POPUP_HOST_Z_INDEX);
    expect(host.parent).toBe(parent);
  });

  it("routes descendant callers into the registered director-owned presentation band", () => {
    const stage = new Container();
    const scene = new Container();
    const descendant = new Container();
    const presentation = new Container();
    stage.addChild(scene, presentation);
    scene.addChild(descendant);
    PopupHost.registerAutomaticPresentationRoot(stage, presentation);

    const host = PopupHost.for(descendant);

    expect(PopupHost.presentationParentFor(descendant)).toBe(presentation);
    expect(PopupHost.presentationParentFor(presentation)).toBe(presentation);
    expect(host.parent).toBe(presentation);
    expect(PopupHost.for(scene)).toBe(host);
  });

  it("hides and restores nested popups within the scene-scoped stack", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const first = popupStub(host, owner);
    const second = popupStub(host, owner);

    expect(host.mount(first, owner)).toBe(false);
    expect(host.mount(second, owner)).toBe(true);
    expect(first.visible).toBe(false);
    expect(second.visible).toBe(true);
    expect(host.modalDepth).toBe(2);

    host.release(second, owner);
    expect(first.visible).toBe(true);
    expect(host.modalDepth).toBe(1);
  });

  it("retains a source non-hiding paged display beneath nested item information", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const paged = popupStub(host, owner, false);
    const info = popupStub(host, owner);

    host.mount(paged, owner);
    host.mount(info, owner);

    expect(paged.visible).toBe(true);
    expect(info.visible).toBe(true);
  });

  it("draws chats over the popup band so a later notice is not buried by an open popup", () => {
    expect(CHAINED_TEXT_CHAT_Z_INDEX).toBeGreaterThan(POPUP_HOST_Z_INDEX);
  });

  it("hides a popup under a chat raised after it and restores it when the chat closes", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const selection = popupStub(host, owner);
    host.mount(selection, owner);
    const chat = overlayStub();



    expect(host.registerOverlay(chat)).toBe(true);
    expect(selection.visible).toBe(false);

    host.releaseOverlay(chat);
    expect(selection.visible).toBe(true);
  });

  it("keeps the source non-hiding paged display readable underneath a chat", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const loot = popupStub(host, owner, false);
    host.mount(loot, owner);

    host.registerOverlay(overlayStub());

    expect(loot.visible).toBe(true);
  });

  it("hides a live chat under a popup raised over it and reveals it first on dismissal", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const beneath = popupStub(host, owner);
    host.mount(beneath, owner);
    const chat = overlayStub();
    host.registerOverlay(chat);
    const plot = popupStub(host, owner);


    expect(host.mount(plot, owner)).toBe(true);
    expect(chat.hidden).toBe(true);



    host.release(plot, owner);
    expect(chat.hidden).toBe(false);
    expect(beneath.visible).toBe(false);
  });

  it("prunes a chat destroyed by scene teardown instead of stranding the popups beneath", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const popup = popupStub(host, owner);
    host.mount(popup, owner);
    const chat = overlayStub();
    host.registerOverlay(chat);
    chat.node.destroy();

    const next = popupStub(host, owner);
    host.mount(next, owner);
    host.release(next, owner);

    expect(popup.visible).toBe(true);
  });

  it("dismisses owner popups top-down without touching another flow", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const otherOwner = {};
    const first = popupStub(host, owner);
    const second = popupStub(host, owner);
    const unrelated = popupStub(host, otherOwner);
    host.mount(first, owner);
    host.mount(second, owner);
    host.mount(unrelated, otherOwner);

    host.dismissOwnedBy(owner);

    expect(first.destroyed).toBe(true);
    expect(second.destroyed).toBe(true);
    expect(unrelated.destroyed).toBe(false);
    expect(unrelated.visible).toBe(true);
    expect(host.modalDepth).toBe(1);
  });

  it("dismisses only the visible top popup for contextual keyboard back", () => {
    const host = PopupHost.for(new Container());
    const owner = {};
    const first = popupStub(host, owner);
    const second = popupStub(host, owner);
    host.mount(first, owner);
    host.mount(second, owner);

    expect(host.dismissTop()).toBe(true);
    expect(second.destroyed).toBe(true);
    expect(first.destroyed).toBe(false);
    expect(first.visible).toBe(true);
    expect(host.modalDepth).toBe(1);
    expect(host.dismissTop()).toBe(true);
    expect(host.dismissTop()).toBe(false);
  });

  it("cancels an owner token so pending popup builders cannot remount after disposal", () => {
    const host = PopupHost.for(new Container());
    const owner = {};

    host.dismissOwnedBy(owner);

    expect(host.isOwnerCancelled(owner)).toBe(true);
    expect(host.modalDepth).toBe(0);
  });
});
