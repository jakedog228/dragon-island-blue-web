import { describe, expect, it } from "vitest";
import {
  destructivePopupLayout,
  editableLivingInfoHeaderGap,
} from "../src/world/partyEditorPopupMath.js";

describe("editable LivingInfo popup geometry", () => {
  it("uses the style-2 header's bare 20pt action-to-name gap in both normalized modes", () => {
    expect(editableLivingInfoHeaderGap("iphone")).toBe(20);
    expect(editableLivingInfoHeaderGap("ipad")).toBe(10);
  });

  it("places the destructive renderer below the message in iPhone mode", () => {
    expect(destructivePopupLayout("iphone")).toEqual({
      messageWidth: 300,
      messageHeight: 100,
      messageFontSize: 14,
      gap: 5,
      rendererY: 105,
      roundingScale: 1,
    });
  });

  it("selects native iPad pairs and preserves the bare-gap half point after normalization", () => {
    expect(destructivePopupLayout("ipad")).toEqual({
      messageWidth: 300,
      messageHeight: 100,
      messageFontSize: 14,
      gap: 2.5,
      rendererY: 102.5,
      roundingScale: 2,
    });
  });
});
