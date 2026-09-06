import { describe, expect, it } from "vitest";
import { loadRawJson, resolveDataDir } from "@dib/gamedata";
import { popupMenuLabelOutline } from "../src/ui/popupMenuMath.js";
import { collectionMenuMetrics } from "../src/world/collectionMath.js";










describe("PopupMenu text outline", () => {
  it("draws no halo, whatever the config's outlineText gate says", () => {
    for (const width of [0, 1, 2, 4]) {
      expect(popupMenuLabelOutline(width)).toEqual({ outline: false });
    }
  });

  it("keeps the Collection menu unoutlined even though its config never clears outlineText", () => {



    const metrics = collectionMenuMetrics("iphone");
    expect(metrics.configName).toBe("CenteredWithClose");
    const menus = loadRawJson(resolveDataDir(), "Menus.json") as Record<
      string,
      Record<string, unknown>
    >;
    expect(menus[metrics.configName]?.["outlineText"]).toBeUndefined();
    expect(popupMenuLabelOutline(metrics.outlineWidth).outline).toBe(false);
  });

  it("records MasterMenu as the only shipped config that clears the gate", () => {


    const menus = loadRawJson(resolveDataDir(), "Menus.json") as Record<
      string,
      Record<string, unknown>
    >;
    const optOut = Object.entries(menus)
      .filter(([, config]) => config["outlineText"] === false)
      .map(([name]) => name);
    expect(optOut).toEqual(["MasterMenu"]);
  });
});
