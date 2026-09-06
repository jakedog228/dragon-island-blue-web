import { describe, it, expect } from "vitest";
import {
  NOT_YOUR_TURN_COLOR,
  NOT_YOUR_TURN_FADE_MS,
  NOT_YOUR_TURN_FLAG_LIMIT,
  NOT_YOUR_TURN_HOLD_MS,
  NOT_YOUR_TURN_LIFETIME_MS,
  NOT_YOUR_TURN_OUTLINE_RADIUS_PT,
  nextNotYourTurnFlag,
  notYourTurnAlphaAt,
  notYourTurnFontSizePt,
} from "../src/battle/notYourTurnBanner.js";
import { NOT_YOUR_TURN_BANNER_Z, sceneManifest } from "../src/battle/battleNodeScene.js";
import { POPUP_HOST_Z_INDEX } from "../src/ui/popup.js";

// `-[BattleNode ccTouchBegan:] @ 0xc4788` — re-notes/not-your-turn.md. Every constant below is a
// raw-decoded source literal, not a tuned value; the assertions pin the decode, so a future edit
// that "rounds" one has to argue with the address it cites.

describe("NOT YOUR TURN banner constants", () => {
  it("uses the 30/60 idiom pair from the literal pool at 0xc4a04/0xc4a08", () => {
    // `00 00 f0 41` = 30.0f and `00 00 70 42` = 60.0f, selected by `userInterfaceIdiom == 1`.
    // iPad halves into normalized port points, so both modes land on 30.
    expect(notYourTurnFontSizePt("iphone")).toBe(30);
    expect(notYourTurnFontSizePt("ipad")).toBe(30);
  });

  it("is a much larger label than the shared sub_652d8 floater's 16/24 pair", () => {
    // Guards against anyone "unifying" this with abilityRenderer's parameter floaters.
    expect(notYourTurnFontSizePt("iphone")).toBeGreaterThan(16);
  });

  it("holds 1.0s then fades 1.0s, a fixed 2.0s independent of string length", () => {
    // CCDelayTime(1.0f) + FadeAndRemoveAction(1.0f) @ 0xc49a4/0xc49bc. The 0.3s-per-character
    // clamped lifetime in effect-text.md belongs to sub_64fdc, which this path never calls.
    expect(NOT_YOUR_TURN_HOLD_MS).toBe(1000);
    expect(NOT_YOUR_TURN_FADE_MS).toBe(1000);
    expect(NOT_YOUR_TURN_LIFETIME_MS).toBe(2000);
  });

  it("is white by inheritance with a 1.0pt black outline radius", () => {
    // No setColor:/setOpacity: exists on the path, so ccWHITE survives; the outline call at
    // 0xc496c passes colour 0xff000000 (black) and borderWidth 1.0f (0x3f800000).
    expect(NOT_YOUR_TURN_COLOR).toBe(0xffffff);
    expect(NOT_YOUR_TURN_OUTLINE_RADIUS_PT).toBe(1);
  });

  it("paints above every scene child but below the popup layer", () => {
    // sub_6522c adds it to the running scene last, so it covers BattleNode's whole subtree; the
    // source's popups live on CCDirector.notificationNode and therefore still cover it.
    const maxSceneZ = Math.max(...sceneManifest().map((child) => child.z));
    expect(NOT_YOUR_TURN_BANNER_Z).toBeGreaterThan(maxSceneZ);
    expect(NOT_YOUR_TURN_BANNER_Z).toBeLessThan(POPUP_HOST_Z_INDEX);
  });
});

describe("notYourTurnAlphaAt", () => {
  it("stays fully opaque for the whole CCDelayTime hold", () => {
    expect(notYourTurnAlphaAt(0)).toBe(1);
    expect(notYourTurnAlphaAt(500)).toBe(1);
    expect(notYourTurnAlphaAt(NOT_YOUR_TURN_HOLD_MS)).toBe(1);
  });

  it("fades linearly to zero across the FadeAndRemoveAction", () => {
    expect(notYourTurnAlphaAt(1500)).toBeCloseTo(0.5, 10);
    expect(notYourTurnAlphaAt(1750)).toBeCloseTo(0.25, 10);
    expect(notYourTurnAlphaAt(NOT_YOUR_TURN_LIFETIME_MS)).toBe(0);
  });

  it("never returns a negative alpha past the removal boundary", () => {
    expect(notYourTurnAlphaAt(5000)).toBe(0);
  });
});

describe("nextNotYourTurnFlag", () => {
  const claimed = (...keys: string[]) => (key: string) => keys.includes(key);

  it("claims NotYourTurn1 on a save that has never seen the banner", () => {
    expect(nextNotYourTurnFlag(() => false)).toBe("NotYourTurn1");
  });

  it("advances one slot per prior appearance", () => {
    expect(nextNotYourTurnFlag(claimed("NotYourTurn1"))).toBe("NotYourTurn2");
    expect(nextNotYourTurnFlag(claimed("NotYourTurn1", "NotYourTurn2", "NotYourTurn3")))
      .toBe("NotYourTurn4");
  });

  it("returns null once all six lifetime slots are spent", () => {
    // The `r5 > 6` bound at 0xc481a/0xc481c: after this the banner never shows again for the save.
    expect(nextNotYourTurnFlag(() => true)).toBeNull();
    const all = Array.from({ length: NOT_YOUR_TURN_FLAG_LIMIT }, (_u, i) => `NotYourTurn${i + 1}`);
    expect(nextNotYourTurnFlag(claimed(...all))).toBeNull();
  });

  it("tolerates gaps, because the source scans slots rather than counting them", () => {
    // The loop tests each key independently; a set slot 1 with an unset slot 2 yields slot 2.
    expect(nextNotYourTurnFlag(claimed("NotYourTurn1", "NotYourTurn3"))).toBe("NotYourTurn2");
    expect(nextNotYourTurnFlag(claimed("NotYourTurn2"))).toBe("NotYourTurn1");
  });

  it("caps the lifetime budget at exactly six", () => {
    expect(NOT_YOUR_TURN_FLAG_LIMIT).toBe(6);
  });
});
