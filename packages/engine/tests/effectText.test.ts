import { describe, expect, it } from "vitest";
import { hasteEffectText, statEffectText } from "../src/effectText.js";

describe("AbilityResult effect-text producers", () => {
  it("uses the applied StatOnly amount, including Defense/Resist's 1.5 weight", () => {
    expect(statEffectText({
      sourceId: "hero",
      sourceLevel: 7,
      stats: ["Attack"],
      statsHelp: true,
    }, "Attack")).toEqual({ kind: "stat", stat: "Attack", direction: "up", amount: 7 });
    expect(statEffectText({
      sourceId: "hero",
      sourceLevel: 7,
      stats: ["Defense"],
      statsHelp: false,
    }, "Defense")).toEqual({ kind: "stat", stat: "Defense", direction: "down", amount: 10 });
  });

  it("reproduces appendHasteParametersForAmount's transformed and truncated percentages", () => {
    expect(hasteEffectText(Math.fround(-0.6000000238418579))).toEqual({
      kind: "haste", direction: "up", amount: 37,
    });
    expect(hasteEffectText(Math.fround(0.30000001192092896))).toEqual({
      kind: "haste", direction: "down", amount: 30,
    });
  });
});
