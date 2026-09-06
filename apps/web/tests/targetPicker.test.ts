import { describe, it, expect } from "vitest";
import {
  beginTargetPicking,
  pickTarget,
  cancelTargetPicking,
  isTargetPickingDone,
  isTargetPickingCancelled,
  pickedIds,
  outlineStampAnglesDeg,
  outlineBorderWidthLocal,
  outlineRenderTextureGeometry,
  cancelButtonMarginPt,
  cancelButtonPixiTopLeft,
  requestFromTargeting,
  type TargetPickerState,
} from "../src/battle/targetPickerMath.js";


describe("beginTargetPicking — clamp + auto-complete fast path", () => {
  it("clamps enemiesNeeded/friendsNeeded to the available node count", () => {
    // requested 3 enemies but only 2 valid enemy nodes exist -> clamps to 2.
    const state = beginTargetPicking(
      { enemiesNeeded: 3, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1", "e2"],
      [],
    );
    expect(state.enemiesNeeded).toBe(2);
    expect(state.phase).toBe("enemies");
  });

  it("clamps friendsNeeded independently of enemiesNeeded", () => {
    const state = beginTargetPicking(
      { enemiesNeeded: 0, friendsNeeded: 5, allEnemies: false, allFriends: false },
      [],
      ["f1", "f2", "f3"],
    );
    expect(state.friendsNeeded).toBe(3);
    expect(state.phase).toBe("friends");
  });

  it("allEnemies -> auto-completes instantly (phase 'done', no manual pick needed)", () => {
    const state = beginTargetPicking(
      { enemiesNeeded: 0, friendsNeeded: 0, allEnemies: true, allFriends: false },
      ["e1", "e2", "e3"],
      [],
    );
    expect(isTargetPickingDone(state)).toBe(true);
    expect(pickedIds(state)).toEqual(["e1", "e2", "e3"]);
  });

  it("allFriends -> auto-completes instantly with every valid friend id", () => {
    const state = beginTargetPicking(
      { enemiesNeeded: 0, friendsNeeded: 0, allEnemies: false, allFriends: true },
      [],
      ["f1", "f2"],
    );
    expect(isTargetPickingDone(state)).toBe(true);
    expect(pickedIds(state)).toEqual(["f1", "f2"]);
  });

  it("the shipped mixed all-teams shape auto-completes with distinct enemy and friend buckets", () => {
    const request = requestFromTargeting({
      kind: "mixed",
      enemyCount: 1, // inherited from Sleep; allEnemies takes precedence
      friendlyCount: 0,
      allEnemies: true,
      allFriends: true,
    });
    const state = beginTargetPicking(request, ["e1"], ["f1"]);
    expect(isTargetPickingDone(state)).toBe(true);
    expect(pickedIds(state)).toEqual(["e1", "f1"]);
  });

  it("zero needed on both sides (e.g. a self-only ability) -> auto-completes with no targets", () => {
    const state = beginTargetPicking(
      { enemiesNeeded: 0, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1"],
      ["f1"],
    );
    expect(isTargetPickingDone(state)).toBe(true);
    expect(pickedIds(state)).toEqual([]);
  });

  it("allEnemies + a manual friend pick still required -> starts in the friends phase directly", () => {
    const state = beginTargetPicking(
      { enemiesNeeded: 0, friendsNeeded: 1, allEnemies: true, allFriends: false },
      ["e1", "e2"],
      ["f1"],
    );
    expect(state.phase).toBe("friends");
    expect(isTargetPickingDone(state)).toBe(false);
  });
});

describe("target-picker source visual geometry", () => {
  it("bakes twelve 30-degree silhouette visits into one render texture", () => {
    expect(outlineStampAnglesDeg()).toEqual([
      0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330,
    ]);
    expect(outlineBorderWidthLocal("enemy", 0.625)).toBeCloseTo(3.2);
    expect(outlineBorderWidthLocal("friend", 0.625)).toBe(2);

    const geometry = outlineRenderTextureGeometry({
      contentW: 105,
      contentH: 128,
      anchorX: 0.5,
      anchorY: 0.5,
      side: "enemy",
      cocosScale: 0.625,
    });
    expect(geometry).toEqual({
      border: 3.2,
      textureW: 111,
      textureH: 134,
      spriteAnchorX: 55.7 / 111,
      spriteAnchorY: 67.2 / 134,
    });

    expect(outlineBorderWidthLocal("enemy", 0.625, "ipad")).toBeCloseTo(1.6);
    expect(outlineBorderWidthLocal("friend", 0.625, "ipad")).toBe(1);
    expect(outlineRenderTextureGeometry({
      contentW: 105,
      contentH: 128,
      anchorX: 0.5,
      anchorY: 0.5,
      side: "enemy",
      cocosScale: 0.625,
      mode: "ipad",
    })).toEqual({
      border: 1.6,
      textureW: 108,
      textureH: 131,
      spriteAnchorX: 54.1 / 108,
      spriteAnchorY: 65.6 / 131,
    });


    expect(outlineRenderTextureGeometry({
      contentW: 90,
      contentH: 61.5,
      anchorX: 0.5,
      anchorY: 0.5,
      side: "friend",
      cocosScale: 1,
    })).toEqual({
      border: 2,
      textureW: 94,
      textureH: 65,
      spriteAnchorX: 47 / 94,
      spriteAnchorY: 32.75 / 65,
    });
  });

  it("places the cancel arrow at the source center rather than the dashboard corner", () => {
    expect(cancelButtonMarginPt("iphone")).toBe(5);
    expect(cancelButtonMarginPt("ipad")).toBe(2.5);
    expect(cancelButtonPixiTopLeft({
      screenW: 480,
      screenH: 320,
      scaledW: 18,
      scaledH: 12,
      mode: "iphone",
    })).toEqual({ x: 457, y: 194 });
    expect(cancelButtonPixiTopLeft({
      screenW: 512,
      screenH: 384,
      scaledW: 18,
      scaledH: 12,
      mode: "ipad",
    })).toEqual({ x: 491.5, y: 268 });
  });
});

describe("pickTarget — order enforcement (enemies before friends)", () => {
  function start(): TargetPickerState {
    return beginTargetPicking(
      { enemiesNeeded: 1, friendsNeeded: 1, allEnemies: false, allFriends: false },
      ["e1", "e2"],
      ["f1", "f2"],
    );
  }

  it("a friend id tapped while still collecting enemies is a miss, not accepted", () => {
    const s0 = start();
    expect(s0.phase).toBe("enemies");
    const { state: s1, outcome } = pickTarget(s0, "f1");
    expect(outcome).toBe("miss");
    expect(s1.phase).toBe("enemies"); // unchanged -- still collecting enemies
    expect(s1.pickedFriends).toEqual([]);
  });

  it("switches to the friends phase only once the enemy quota is met", () => {
    const s0 = start();
    const { state: s1, outcome: o1 } = pickTarget(s0, "e1");
    expect(o1).toBe("picked");
    expect(s1.phase).toBe("friends"); // enemy quota (1) met -> switched

    const { state: s2, outcome: o2 } = pickTarget(s1, "f1");
    expect(o2).toBe("picked");
    expect(s2.phase).toBe("done");
    expect(pickedIds(s2)).toEqual(["e1", "f1"]); // enemies-then-friends order
  });

  it("an unknown/invalid id for the active side is a miss", () => {
    const s0 = start();
    const { state: s1, outcome } = pickTarget(s0, "nonexistent");
    expect(outcome).toBe("miss");
    expect(s1.phase).toBe("enemies");
  });

  it("multi-target: stays in the enemies phase until its own quota is met", () => {
    const s0 = beginTargetPicking(
      { enemiesNeeded: 2, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1", "e2", "e3"],
      [],
    );
    const { state: s1 } = pickTarget(s0, "e1");
    expect(s1.phase).toBe("enemies"); // 1 of 2 -- not done yet
    const { state: s2 } = pickTarget(s1, "e2");
    expect(s2.phase).toBe("done");
    expect(pickedIds(s2)).toEqual(["e1", "e2"]);
  });
});

describe("pickTarget — duplicate rejection", () => {
  it("re-tapping an already-picked node is ignored (not a miss, doesn't advance the quota)", () => {
    const s0 = beginTargetPicking(
      { enemiesNeeded: 2, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1", "e2"],
      [],
    );
    const { state: s1 } = pickTarget(s0, "e1");
    const { state: s2, outcome } = pickTarget(s1, "e1");
    expect(outcome).toBe("duplicate");
    expect(s2.pickedEnemies).toEqual(["e1"]); // unchanged
    expect(s2.phase).toBe("enemies"); // quota (2) still not met
  });
});

describe("pickTarget — count clamp interacts correctly with manual picking", () => {
  it("only ever needs the clamped count, even though more nodes exist", () => {
    const s0 = beginTargetPicking(
      { enemiesNeeded: 1, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1", "e2", "e3"],
      [],
    );
    expect(s0.enemiesNeeded).toBe(1);
    const { state: s1, outcome } = pickTarget(s0, "e2");
    expect(outcome).toBe("picked");
    expect(s1.phase).toBe("done");
    expect(pickedIds(s1)).toEqual(["e2"]);
  });
});

describe("cancelTargetPicking — resets and rejects further picks", () => {
  it("moves to the cancelled phase and ignores subsequent picks", () => {
    const s0 = beginTargetPicking(
      { enemiesNeeded: 1, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1"],
      [],
    );
    const cancelled = cancelTargetPicking(s0);
    expect(isTargetPickingCancelled(cancelled)).toBe(true);
    expect(isTargetPickingDone(cancelled)).toBe(false);

    const { state: s1, outcome } = pickTarget(cancelled, "e1");
    expect(outcome).toBe("ignored");
    expect(isTargetPickingCancelled(s1)).toBe(true);
  });

  it("cancelling mid-pick discards any partial progress from a fresh begin", () => {
    const s0 = beginTargetPicking(
      { enemiesNeeded: 2, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1", "e2"],
      [],
    );
    const { state: s1 } = pickTarget(s0, "e1");
    const cancelled = cancelTargetPicking(s1);
    expect(cancelled.phase).toBe("cancelled");


    const fresh = beginTargetPicking(
      { enemiesNeeded: 2, friendsNeeded: 0, allEnemies: false, allFriends: false },
      ["e1", "e2"],
      [],
    );
    expect(fresh.pickedEnemies).toEqual([]);
  });
});
