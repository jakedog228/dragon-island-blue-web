import { describe, expect, it } from "vitest";
import { popupMenuGeometry } from "../src/ui/popupMenuMath.js";
import {
  TOURNAMENT_PORTRAIT_MAX_HEIGHT_PT,
  TOURNAMENT_PORTRAIT_WIDTH_PT,
  TOURNAMENT_UNKNOWN_SCALE,
  tournamentMenuGeometry,
  tournamentRewardLayout,
  tournamentRoundLayout,
  tournamentRewardsButtonLayout,
  tournamentTitleLayout,
} from "../src/player/tournamentDisplayMath.js";

/**
 * Card interiors measured directly out of `tournamentBrackets-hd.png` by flood-filling its
 * enclosed transparent holes: a uniform 84pt horizontal / 38pt vertical step, each interior
 * 49.5x62.5pt, with the opponent hole 78pt below its hero. The art is 416x263.5pt, centred.
 * These are the independent oracle for the decoded `-[TournamentNode init]` constants.
 */
const BRACKET = { w: 416, h: 263.5 } as const;
const HERO_HOLE = { x: 4.5, y: 4.5, w: 49.5, h: 62.5 } as const;
const OPPONENT_HOLE_DROP = 78;
const STEP_X = 84;
const STEP_Y = 38;

const screens = { iphone: { w: 480, h: 320 }, ipad: { w: 512, h: 384 } } as const;

function heroHole(mode: "iphone" | "ipad", round: number) {
  const screen = screens[mode];
  const left = screen.w / 2 - BRACKET.w / 2;
  const top = screen.h / 2 - BRACKET.h / 2;
  return {
    x: left + HERO_HOLE.x + STEP_X * round,
    y: top + HERO_HOLE.y + STEP_Y * round,
    w: HERO_HOLE.w,
    h: HERO_HOLE.h,
  };
}

describe("TournamentNode source geometry", () => {
  it("seats every portrait in its bracket card on both idioms", () => {
    for (const mode of ["iphone", "ipad"] as const) {
      for (const round of [0, 1, 2, 3]) {
        const layout = tournamentRoundLayout(round, mode);
        const hole = heroHole(mode, round);

        // Bottom-centre anchored: horizontally centred on the card interior. The hole was
        // flood-filled out of anti-aliased art, so it reads ~0.5px (0.25pt) tight per edge.
        expect(Math.abs(layout.x - (hole.x + hole.w / 2))).toBeLessThanOrEqual(0.5);

        // The portrait is wider and taller than the interior on purpose — the bracket art is
        // drawn afterwards and its frame hides the overhang. Overhang stays under ~5pt a side.
        const halfOverhang = (TOURNAMENT_PORTRAIT_WIDTH_PT - hole.w) / 2;
        expect(halfOverhang).toBeGreaterThan(0);
        expect(halfOverhang).toBeLessThan(5);

        for (const [bottomY, holeTop] of [
          [layout.heroBottomY, hole.y],
          [layout.opponentBottomY, hole.y + OPPONENT_HOLE_DROP],
        ] as const) {
          // A full-height portrait spans the interior top to bottom. Both edges are allowed to
          // land within a point of the measured hole (anti-aliasing, plus the source's 79pt
          // opponent drop against the art's 78pt hole spacing) and to overhang by a few points,
          // since the bracket frame is drawn over the result.
          const top = bottomY - TOURNAMENT_PORTRAIT_MAX_HEIGHT_PT;
          expect(top).toBeLessThan(holeTop + 1);
          expect(holeTop - top).toBeLessThan(5);
          expect(bottomY).toBeGreaterThan(holeTop + hole.h - 1);
          expect(bottomY - (holeTop + hole.h)).toBeLessThan(5);
        }





        expect(layout.opponentBottomY - layout.unknownBottomY).toBe(15);
        const unknownTop = layout.unknownBottomY - 68 * TOURNAMENT_UNKNOWN_SCALE;
        const opponentHoleTop = hole.y + OPPONENT_HOLE_DROP;
        expect(unknownTop).toBeGreaterThan(opponentHoleTop);
        expect(layout.unknownBottomY).toBeLessThan(opponentHoleTop + hole.h);
      }
    }
  });

  it("seats the class prize inside the bracket's oversized final frame", () => {
    // Ninth flood-filled hole in `tournamentBrackets-hd.png`, the one with no matchup pair:
    // 343,148 67x83.5pt bracket-local, i.e. the trophy frame the source's `itemRewards[0]`
    // RendererFactory node targets. The 60x80pt fit box is a purpose-built fit for it.
    const FINAL_HOLE = { x: 343, y: 148, w: 67, h: 83.5 } as const;
    for (const mode of ["iphone", "ipad"] as const) {
      const screen = screens[mode];
      const hole = {
        x: screen.w / 2 - BRACKET.w / 2 + FINAL_HOLE.x,
        y: screen.h / 2 - BRACKET.h / 2 + FINAL_HOLE.y,
        w: FINAL_HOLE.w,
        h: FINAL_HOLE.h,
      };
      const reward = tournamentRewardLayout(mode);
      expect(reward.maxWidth).toBe(60);
      expect(reward.maxHeight).toBe(80);
      expect(reward.maxWidth).toBeLessThan(hole.w);
      expect(reward.maxHeight).toBeLessThan(hole.h);
      // The source centre lands within a few points of the art's hole centre; the frame is drawn
      // over the node afterwards, exactly as it is over the portraits.
      expect(Math.abs(reward.center.x - (hole.x + hole.w / 2))).toBeLessThan(5);
      expect(Math.abs(reward.center.y - (hole.y + hole.h / 2))).toBeLessThan(5);
      // And the whole fit box stays inside the interior on both axes. It is flush to the right
      // edge (442 == 442) and 0.25pt past the bottom, which is how tightly `172`/`60`/`80` were
      // authored against this hole — the decisive evidence that they target it.
      expect(reward.center.x - reward.maxWidth / 2).toBeGreaterThan(hole.x);
      expect(reward.center.x + reward.maxWidth / 2).toBeLessThanOrEqual(hole.x + hole.w);
      expect(reward.center.y - reward.maxHeight / 2).toBeGreaterThan(hole.y);
      expect(reward.center.y + reward.maxHeight / 2).toBeLessThan(hole.y + hole.h + 0.5);
    }
  });

  it("keeps the round step and glow offsets on the source constants", () => {
    for (const mode of ["iphone", "ipad"] as const) {
      const first = tournamentRoundLayout(0, mode);
      const second = tournamentRoundLayout(1, mode);
      expect(second.x - first.x).toBe(STEP_X);
      expect(second.heroBottomY - first.heroBottomY).toBe(STEP_Y);
      expect(first.glow.x - first.x).toBe(14);
      expect(first.heroBottomY - first.glow.y).toBe(32);
    }
  });

  it("sets the class letter beside its right-aligned captions, not under them", () => {
    // `letterX = (w - 5 - letterWidth) - 5`, `captionRight = letterX - 5`, `topY = 20` — all three
    // literals bare in `-[TournamentNode init]`, so iPad halves them into port points.
    for (const mode of ["iphone", "ipad"] as const) {
      const gap = mode === "ipad" ? 2.5 : 5;
      const titles = tournamentTitleLayout(30, mode);
      expect(titles.letterX).toBe(screens[mode].w - 30 - 2 * gap);
      expect(titles.captionRight).toBe(titles.letterX - gap);
      expect(titles.topY).toBe(mode === "ipad" ? 10 : 20);
      // The captions end to the LEFT of the letter — the whole point of the correction.
      expect(titles.captionRight).toBeLessThan(titles.letterX);
    }
  });

  it("moves the Tournament popup content to the shipped bottom-left anchor", () => {
    for (const mode of ["iphone", "ipad"] as const) {
      const screen = screens[mode];
      const centered = popupMenuGeometry(screen, null, [[{ w: 100, h: 20 }]], {
        itemGap: 30,
        columnGap: 0,
        titleGap: 10,
        backgroundMarginX: 9,
        backgroundMarginY: 6,
      }, mode);
      const result = tournamentMenuGeometry(centered, mode);
      expect(result.content.x).toBe(10);
      expect(result.content.y + result.content.h).toBe(screen.h - 10);
    }
  });

  it("keeps Rewards out of the primary/Back flow at its source custom position", () => {
    const metrics = {
      itemGap: 30,
      columnGap: 20,
      titleGap: 5,
      backgroundMarginX: 9,
      backgroundMarginY: 6,
    };
    for (const mode of ["iphone", "ipad"] as const) {
      const screen = screens[mode];
      const flowed = tournamentMenuGeometry(
        popupMenuGeometry(screen, null, [[{ w: 140, h: 20 }, { w: 50, h: 20 }]], metrics, mode),
        mode,
      );
      const rewardSeed = popupMenuGeometry(
        screen,
        null,
        [[{ w: 75, h: 20 }]],
        metrics,
        mode,
      ).buttons[0]![0]!;
      const reward = tournamentRewardsButtonLayout(flowed, rewardSeed, mode);
      const primary = flowed.buttons[0]![0]!;
      const back = flowed.buttons[0]![1]!;
      const center = (layout: typeof reward) => ({
        x: layout.label.x + layout.label.w / 2,
        y: layout.label.y + layout.label.h / 2,
      });
      const flowedCenter = {
        x: flowed.content.x + flowed.content.w / 2,
        y: flowed.content.y + flowed.content.h / 2,
      };
      const expectedCustom = mode === "iphone" ? { x: 316, y: -20 } : { x: 332.5, y: 5 };

      expect(center(reward)).toEqual({
        x: flowedCenter.x + expectedCustom.x,
        y: flowedCenter.y - expectedCustom.y,
      });
      expect(center(primary).y).toBeLessThan(center(reward).y);
      expect(center(reward).x).toBeGreaterThan(center(primary).x);
      expect(center(back).y).toBeGreaterThan(center(primary).y);
      expect(reward.background.x + reward.background.w / 2).toBe(center(reward).x);
      expect(reward.background.y + reward.background.h / 2).toBe(center(reward).y);
    }
  });
});
