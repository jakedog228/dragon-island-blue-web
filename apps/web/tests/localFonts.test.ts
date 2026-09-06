import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadRequiredLocalFonts,
  MARKER_FELT_FAMILY,
} from "../src/localFonts.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFontEnvironment(
  load: (source: string | ArrayBuffer) => Promise<void>,
): { added: unknown[]; sources: Array<string | ArrayBuffer> } {
  const added: unknown[] = [];
  const sources: Array<string | ArrayBuffer> = [];
  class MockFontFace {
    readonly family: string;
    readonly source: string | ArrayBuffer;
    readonly descriptors: FontFaceDescriptors;

    constructor(family: string, source: string | ArrayBuffer, descriptors: FontFaceDescriptors) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
      sources.push(source);
    }

    async load(): Promise<MockFontFace> {
      await load(this.source);
      return this;
    }
  }
  vi.stubGlobal("FontFace", MockFontFace);
  vi.stubGlobal("document", { fonts: { add: (face: unknown) => added.push(face) } });
  return { added, sources };
}

describe('required "Marker Felt" family boot binding', () => {
  it("registers the family, preferring a local copy over the bundled licensed face", async () => {
    const env = stubFontEnvironment(async () => {});

    const status = await loadRequiredLocalFonts();

    expect(status).toBe("loaded");
    expect(env.sources).toHaveLength(1);
    const source = env.sources[0] as string;
    // Standard CSS src list: installed system copy first (no fetch), bundled face as the fallback.
    expect(source).toMatch(/^local\("Marker Felt"\), url\(/);
    expect(source).toMatch(/MarkerFelt|\.ttf/);
    expect(env.added).toHaveLength(1);
    expect(env.added[0]).toMatchObject({
      family: MARKER_FELT_FAMILY,
      descriptors: { weight: "normal" },
    });
  });

  it("degrades to the browser fallback when even the bundled face fails to load", async () => {
    const env = stubFontEnvironment(async () => {
      throw new Error("load failed");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const status = await loadRequiredLocalFonts();

    expect(status).toBe("fallback");
    expect(env.added).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/"Marker Felt" could not be loaded/),
    );
    warn.mockRestore();
  });
});
