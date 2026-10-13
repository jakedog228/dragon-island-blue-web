import { describe, expect, it } from "vitest";
import { fullTrustModModules } from "../src/content/modModuleCatalog.js";

describe("full-trust runtime module discovery", () => {
  it("keeps src-relative IDs for same-directory gifts, nested battle modules and workspace APIs", () => {
    expect(fullTrustModModules.has("web/content/characterEggGift.ts")).toBe(true);
    expect(fullTrustModModules.has("web/battle/battleNode.ts")).toBe(true);
    expect(fullTrustModModules.has("@dib/engine")).toBe(true);
    expect(fullTrustModModules.has("web/./characterEggGift.ts")).toBe(false);
  });
});
