import { describe, expect, it } from "vitest";
import { installCocosSourceAlphaAddBlend } from "../src/cocosBlendModes.js";

describe("Cocos WebGL blend-mode adapter", () => {
  it("uses ordinary SRC_ALPHA/ONE initially and after context restoration", () => {
    let listener: { contextChange(): void } | undefined;
    const blendModesMap: Record<string, number[]> = {
      "add-npm": [770, 1, 1, 1],
    };
    const renderer = {
      gl: { SRC_ALPHA: 770, ONE: 1 },
      state: { blendModesMap },
      runners: {
        contextChange: {
          add(value: { contextChange(): void }) { listener = value; },
          remove(value: { contextChange(): void }) {
            if (listener === value) listener = undefined;
          },
        },
      },
    };

    const remove = installCocosSourceAlphaAddBlend(renderer as never);
    expect(blendModesMap["add-npm"]).toEqual([770, 1]);

    blendModesMap["add-npm"] = [770, 1, 1, 1];
    listener?.contextChange();
    expect(blendModesMap["add-npm"]).toEqual([770, 1]);

    remove();
    expect(listener).toBeUndefined();
  });
});
