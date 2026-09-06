import { Container, Rectangle, Texture } from "pixi.js";
import type { PlayerReward } from "@dib/engine";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PixiCollectionFlowPresentation,
  type CollectionFlowRowState,
} from "../src/world/collectionFlow.js";
import { screenPointsForMode } from "../src/displayMode.js";
import { collectionMenuMetrics } from "../src/world/collectionMath.js";
import { popupMenuGeometry } from "../src/ui/popupMenuMath.js";

const ui = vi.hoisted(() => ({
  menuBuilds: [] as Array<Record<string, unknown>>,
  popupShows: [] as Array<Record<string, unknown>>,
  messageShows: [] as Array<Record<string, unknown>>,
  chatShows: [] as Array<Record<string, unknown>>,
  hosts: new Map<object, {
    stack: Array<{ dismiss(): void }>;
    cancelledOwners: object[];
  }>(),
}));

vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

vi.mock("@dib/renderer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dib/renderer")>();
  const { Container: MockContainer } = await import("pixi.js");
  return {
    ...actual,
    makeTtfLabel: (value: string, fontSize: number) => {
      const label = new MockContainer() as Container & {
        anchor: { set(x: number, y?: number): void };
        text: string;
        tint: number;
      };
      Object.defineProperties(label, {
        width: { configurable: true, get: () => value.length * 10 },
        height: { configurable: true, get: () => fontSize },
      });
      label.anchor = { set: () => undefined };
      label.text = value;
      label.tint = 0xffffff;
      return label;
    },
  };
});

vi.mock("../src/ui/popupMenuView.js", async () => {
  const { Container } = await import("pixi.js");
  return {
    buildPopupMenuView: async (options: Record<string, any>) => {
      ui.menuBuilds.push(options);
      const handlers = new Map<Container, (event: unknown) => void>();
      const buttons = options.columns[0].map((item: any, row: number) => {
        const node = new Container();
        return {
          item,
          node,
          label: { text: item.label, tint: 0xffffff },
          layout: {
            column: 0,
            row,
            label: { x: 100, y: 50 + row * 30, w: 40, h: 20 },
            background: { x: 91, y: 44 + row * 30, w: 58, h: 32 },
          },
          onPress: (handler: (event: unknown) => void) => handlers.set(node, handler),
        };
      });
      for (const { node } of buttons) options.parent.addChild(node);
      return {
        geometry: {
          title: { x: 100, y: 10, w: 80, h: 20 },
          content: { x: 91, y: 10, w: 98, h: 100 },
          buttons: [buttons.map(({ layout }: any) => layout)],
        },
        buttons,
        invokeAt: (point: { x: number; y: number }, event: unknown) => {
          const button = buttons.find(({ layout }: any) =>
            point.x >= layout.label.x && point.x < layout.label.x + layout.label.w &&
            point.y >= layout.label.y && point.y < layout.label.y + layout.label.h);
          if (button === undefined) return false;
          handlers.get(button.node)?.(event);
          return true;
        },
      };
    },
  };
});

vi.mock("../src/ui/popup.js", async () => {
  const { Container } = await import("pixi.js");
  const hostFor = (parent: object) => {
    let host = ui.hosts.get(parent);
    if (host === undefined) {
      host = { stack: [], cancelledOwners: [] };
      ui.hosts.set(parent, host);
    }
    return host;
  };
  class Popup extends Container {
    isDismissed = false;
    private onDismiss: (() => void) | undefined;
    private host: ReturnType<typeof hostFor> | undefined;

    static async show(parent: object, options: Record<string, any>): Promise<Popup> {
      ui.popupShows.push(options);
      const popup = new Popup();
      popup.onDismiss = options.onDismiss;
      popup.host = hostFor(parent);
      popup.host.stack.push(popup);
      return popup;
    }

    dismiss(): void {
      if (this.isDismissed) return;
      this.isDismissed = true;
      if (this.host !== undefined) {
        const index = this.host.stack.indexOf(this);
        if (index >= 0) this.host.stack.splice(index, 1);
      }
      this.onDismiss?.();
    }
  }
  return {
    Popup,
    PopupHost: {
      for(parent: object) {
        const host = hostFor(parent);
        return {
          dismissTop: () => {
            const popup = host.stack.at(-1);
            if (popup === undefined) return false;
            popup.dismiss();
            return true;
          },
          dismissOwnedBy: (owner: object) => {
            host.cancelledOwners.push(owner);
            for (const popup of [...host.stack].reverse()) popup.dismiss();
          },
        };
      },
    },
  };
});

vi.mock("../src/ui/monsterHatchPopup.js", () => ({
  buildMonsterHatchMessageContent: (message: string) => {
    const content = new Container();
    content.label = `message:${message}`;
    return content;
  },
  showMonsterHatchPopup: async (_environment: unknown, options: Record<string, any>) => {
    ui.messageShows.push(options);
    options.onDismiss?.();
    return { isDismissed: true, dismiss: () => undefined };
  },
}));

vi.mock("../src/world/guildQuestChat.js", () => ({
  showGuildQuestChat: async (options: Record<string, any>) => {
    ui.chatShows.push(options);
    let dismissed = false;
    return {
      dismiss: () => {
        if (dismissed) return;
        dismissed = true;
        options.onDismiss?.();
      },
    };
  },
}));

const rows: readonly CollectionFlowRowState[] = [
  {
    goalKey: "First", label: "First (0%)", percentComplete: 0,
    complete: false, claimed: false, enabled: true, tint: 0xffffff,
  },
  {
    goalKey: "Second", label: "Second (100%)", percentComplete: 100,
    complete: true, claimed: true, enabled: true, tint: 0xffff00,
  },
];

describe("PixiCollectionFlowPresentation", () => {
  beforeEach(() => {
    ui.menuBuilds.length = 0;
    ui.popupShows.length = 0;
    ui.messageShows.length = 0;
    ui.chatShows.length = 0;
    ui.hosts.clear();
  });

  it("mounts one CenteredWithClose column with source-finalized input and owner cleanup", async () => {
    const parent = new Container();
    const selected = vi.fn();
    const closed = vi.fn();
    const presentedRewards = vi.fn(async () => undefined);
    const presentation = new PixiCollectionFlowPresentation({
      parent,
      assets: {
        sprite: async () => Texture.WHITE,
        hasSprite: () => true,
      } as never,
      scale9: {} as never,
      strings: { BackButtonKey: "Back", OkButtonKey: "OK" },
      ticker: {} as never,
      onClick: vi.fn(),
      onBlocked: vi.fn(),
      presentRewards: presentedRewards,
    });

    await presentation.mountBase({
      title: "Collection Quests",
      rows,
      onSelect: selected,
      onClose: closed,
    });

    expect(ui.menuBuilds).toHaveLength(1);
    expect((ui.menuBuilds[0]!["columns"] as any[][])[0]!.map(({ label }) => label))
      .toEqual(["First (0%)", "Second (100%)"]);
    expect(ui.popupShows[0]).toMatchObject({
      backgroundKey: null,
      dismissOnTap: false,
      runScaleAction: false,
    });
    expect((ui.menuBuilds[0] as any).installParentInput).toBe(false);
    const close = (ui.popupShows[0] as any).screenChildren[0].node as Container;
    expect(close.label).toBe("collection:close");
    expect((close.children[1] as any).text).toBe("Back");
    expect(close.hitArea).toBeInstanceOf(Rectangle);

    // Modal PopupMenu claims the whole sequence at its root, then resolves only the release point.
    // Begin on empty backdrop and release on the first row: source invokes that row.
    const popup = ui.hosts.get(parent)!.stack[0] as unknown as Container;
    popup.emit("pointerdown", { pointerId: 7 } as never);
    popup.emit("pointerup", {
      pointerId: 7,
      stopPropagation: vi.fn(),
      getLocalPosition: (target: Container) => target === (ui.menuBuilds[0] as any).parent
        ? { x: 120, y: 55 }
        : { x: -1_000, y: -1_000 },
    } as never);
    expect(selected).toHaveBeenCalledWith("First");

    presentation.installCompletedTint(["Second"]);
    presentation.updateRows([{ ...rows[0]!, label: "First (50%)" }, rows[1]!]);
    expect(presentation.debugState).toMatchObject({
      mounted: true,
      completedTintGoalKeys: ["Second"],
      rows: [
        expect.objectContaining({ label: "First (50%)" }),
        expect.objectContaining({ label: "Second (100%)" }),
      ],
    });

    const rewards: readonly PlayerReward[] = [{ kind: "gold", amount: 7 }];
    await presentation.showRewards(rewards);
    expect(presentedRewards).toHaveBeenCalledWith(rewards, expect.any(Object));

    const closeHit = close.hitArea as Rectangle;
    popup.emit("pointerdown", { pointerId: 8 } as never);
    popup.emit("pointerup", {
      pointerId: 8,
      stopPropagation: vi.fn(),
      getLocalPosition: (target: Container) => target === close
        ? { x: closeHit.x + closeHit.width / 2, y: closeHit.y + closeHit.height / 2 }
        : { x: -1_000, y: -1_000 },
    } as never);
    expect(closed).toHaveBeenCalledTimes(1);

    presentation.dispose();
    expect(ui.hosts.get(parent)?.cancelledOwners).toHaveLength(1);
  });

  it("mounts a titled empty Collection root without fabricating a row button", async () => {
    const parent = new Container();
    const closed = vi.fn();
    const presentation = new PixiCollectionFlowPresentation({
      parent,
      assets: { sprite: async () => Texture.WHITE, hasSprite: () => true } as never,
      scale9: {} as never,
      strings: { BackButtonKey: "Back", OkButtonKey: "OK" },
      ticker: {} as never,
      onClick: vi.fn(),
      onBlocked: vi.fn(),
      presentRewards: async () => undefined,
    });

    await presentation.mountBase({
      title: "Collection Quests",
      rows: [],
      onSelect: vi.fn(),
      onClose: closed,
    });

    expect((ui.menuBuilds[0] as any).title.value).toBe("Collection Quests");
    expect((ui.menuBuilds[0] as any).columns).toEqual([[]]);
    expect((ui.menuBuilds[0] as any).allowEmptyColumns).toBe(true);
    const emptyGeometry = popupMenuGeometry(
      screenPointsForMode("iphone"),
      { w: 100, h: 20 },
      [[]],
      collectionMenuMetrics("iphone"),
      "iphone",
      true,
    );
    expect(emptyGeometry.buttons).toEqual([[]]);
    expect(() => popupMenuGeometry(
      screenPointsForMode("iphone"),
      { w: 100, h: 20 },
      [[]],
      collectionMenuMetrics("iphone"),
      "iphone",
    )).toThrow(/column 0 is empty/);
    expect(presentation.debugState).toMatchObject({ mounted: true, rows: [] });
    expect(presentation.requestBack()).toBe(true);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it("routes back to chat before the retained base popup", async () => {
    const parent = new Container();
    const presentation = new PixiCollectionFlowPresentation({
      parent,
      assets: { sprite: async () => Texture.WHITE, hasSprite: () => true } as never,
      scale9: {} as never,
      strings: { BackButtonKey: "Back", OkButtonKey: "OK" },
      ticker: {} as never,
      onClick: vi.fn(),
      onBlocked: vi.fn(),
      presentRewards: async () => undefined,
    });
    await presentation.mountBase({ title: "Collection Quests", rows, onSelect: vi.fn(), onClose: vi.fn() });
    const chatDismissed = vi.fn();
    await presentation.showChat("Welcome", chatDismissed);

    expect(presentation.requestBack()).toBe(true);
    expect(chatDismissed).toHaveBeenCalledTimes(1);
    expect(ui.hosts.get(parent)?.stack).toHaveLength(1);
    expect(presentation.requestBack()).toBe(true);
    expect(ui.hosts.get(parent)?.stack).toHaveLength(0);
  });
});
