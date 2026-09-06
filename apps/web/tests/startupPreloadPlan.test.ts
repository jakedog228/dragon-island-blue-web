import { describe, expect, it, vi } from "vitest";
import { createStartupSpritePreloadTasks } from "../src/startup/startupPreloadPlan.js";

function assets(available: readonly string[]) {
  const sprite = vi.fn(async (_key: string): Promise<void> => undefined);
  return {
    hasSprite: (key: string) => available.includes(key),
    sprite,
  };
}

describe("startup sprite preload planning", () => {
  it("preloads the base Black Market close sprite for a base-only asset set", async () => {
    const library = assets(["PopupMenuCloseButton"]);
    const tasks = createStartupSpritePreloadTasks(library);

    await Promise.all(tasks.map((task) => task.run()));

    expect(tasks.map((task) => task.label)).toContain("sprite PopupMenuCloseButton");
    expect(tasks.map((task) => task.label)).not.toContain("sprite PopupMenuCloseButton-hd");
    expect(library.sprite).toHaveBeenCalledWith("PopupMenuCloseButton");
    expect(library.sprite).not.toHaveBeenCalledWith("PopupMenuCloseButton-hd");
  });

  it("prefers the HD Black Market close sprite when both variants exist", async () => {
    const library = assets(["PopupMenuCloseButton-hd", "PopupMenuCloseButton"]);
    const tasks = createStartupSpritePreloadTasks(library);

    await Promise.all(tasks.map((task) => task.run()));

    expect(library.sprite).toHaveBeenCalledWith("PopupMenuCloseButton-hd");
    expect(library.sprite).not.toHaveBeenCalledWith("PopupMenuCloseButton");
  });

  it("fails loudly when neither Black Market close sprite exists", () => {
    expect(() => createStartupSpritePreloadTasks(assets([])))
      .toThrow(/PopupMenuCloseButton-hd.*PopupMenuCloseButton/i);
  });
});
