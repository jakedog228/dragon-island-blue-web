import { describe, expect, it, vi } from "vitest";
import { GAME_PROTOCOL_VERSION, type ScoreboardResponseV1 } from "@dib/game-protocol";

// The screen module pulls in Pixi for its presentation half; Pixi probes `navigator` at import.
// Same shim the other headless world-module tests use.
vi.hoisted(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { userAgent: "vitest" },
  });
});

import {
  HIGHSCORES_PAGE_SIZE,
  HighscoresScreen,
  highscoresViewState,
  type HighscoresPresentation,
  type HighscoresViewState,
  type HighscoresViewer,
} from "../src/world/highscoresScreen.js";

function board(
  entries: Array<{ rank: number; username: string; heroLevel?: number; totalXp?: number }>,
): ScoreboardResponseV1 {
  return {
    protocolVersion: GAME_PROTOCOL_VERSION,
    generatedAt: "2026-08-08T00:00:00.000Z",
    entries: entries.map((entry) => ({
      rank: entry.rank,
      username: entry.username,
      heroLevel: entry.heroLevel ?? 10,
      totalXp: entry.totalXp ?? 100,
    })),
  };
}

function ranked(count: number): ScoreboardResponseV1 {
  return board(Array.from({ length: count }, (_unused, index) => ({
    rank: index + 1,
    username: `player-${index}`,
    totalXp: count - index,
  })));
}

/** Records every render so a test can assert on what the player would actually have seen. */
function recorder(): HighscoresPresentation & {
  readonly renders: HighscoresViewState[];
  closes: number;
  disposals: number;
} {
  const renders: HighscoresViewState[] = [];
  return {
    renders,
    closes: 0,
    disposals: 0,
    render(state) { renders.push(state); },
    requestClose() { this.closes += 1; },
    dispose() { this.disposals += 1; },
  };
}

describe("highscores view state", () => {
  const viewer: HighscoresViewer = { username: "Ada Lovelace", publicScoreboard: true };

  it("says it is loading, with no page controls to press yet", () => {
    const state = highscoresViewState({ load: { status: "loading" }, viewer, page: 3 });
    expect(state.body).toEqual({ kind: "loading" });
    expect(state).toMatchObject({ page: 0, pageCount: 1, totalEntries: 0 });
  });

  it("surfaces the failure the server actually reported", () => {
    const state = highscoresViewState({
      load: { status: "error", message: "this server publishes no scoreboard" },
      page: 0,
    });
    // Not a generic "unavailable": the operator's own words are the only thing that tells a player
    // whether to retry or stop trying.
    expect(state.body).toEqual({
      kind: "error",
      message: "this server publishes no scoreboard",
    });
  });

  it("distinguishes an empty board from a broken one", () => {
    const state = highscoresViewState({ load: { status: "ready", response: board([]) }, page: 0 });
    expect(state.body).toEqual({ kind: "empty" });
    expect(state.totalEntries).toBe(0);
  });

  it("marks the viewer's own row regardless of case or spacing", () => {
    const state = highscoresViewState({
      load: {
        status: "ready",
        response: board([
          { rank: 1, username: "Grace Hopper" },
          { rank: 2, username: "ada  lovelace" },
        ]),
      },
      viewer: { username: " ADA Lovelace ", publicScoreboard: true },
      page: 0,
    });
    // The board carries no player id, so identity is the normalized, case-folded name — which the
    // registry's own case-insensitive uniqueness rule makes unambiguous.
    expect(state.body.kind === "rows" && state.body.rows.map((row) => row.own)).toEqual([
      false,
      true,
    ]);
  });

  it("leaves every row unmarked when nobody is signed in", () => {
    const state = highscoresViewState({
      load: { status: "ready", response: board([{ rank: 1, username: "Grace Hopper" }]) },
      page: 0,
    });
    expect(state.body.kind === "rows" && state.body.rows.every((row) => !row.own)).toBe(true);
    // An operator-issued invite has no account, so there is no Options row to point it at.
    expect(state.footer).toBeUndefined();
  });

  it("points an opted-out player at the setting, and says nothing to an opted-in one", () => {
    const opts = { load: { status: "ready" as const, response: ranked(3) }, page: 0 };
    expect(highscoresViewState({ ...opts, viewer }).footer).toBeUndefined();
    expect(highscoresViewState({
      ...opts,
      viewer: { ...viewer, publicScoreboard: false },
    }).footer).toContain("Options");
    // The footer belongs to the viewer, not the board: it shows on an empty one too.
    expect(highscoresViewState({
      load: { status: "ready", response: board([]) },
      viewer: { ...viewer, publicScoreboard: false },
      page: 0,
    }).footer).toContain("Options");
    // But never over a failure, where the page cannot say anything true about visibility.
    expect(highscoresViewState({
      load: { status: "error", message: "offline" },
      viewer: { ...viewer, publicScoreboard: false },
      page: 0,
    }).footer).toBeUndefined();
  });

  it("pages the board and clamps a page number out of range", () => {
    const response = ranked(HIGHSCORES_PAGE_SIZE * 2 + 3);
    const first = highscoresViewState({ load: { status: "ready", response }, page: 0 });
    expect(first.pageCount).toBe(3);
    expect(first.body.kind === "rows" && first.body.rows).toHaveLength(HIGHSCORES_PAGE_SIZE);
    expect(first.body.kind === "rows" && first.body.rows[0]?.rank).toBe(1);

    const last = highscoresViewState({ load: { status: "ready", response }, page: 2 });
    expect(last.body.kind === "rows" && last.body.rows).toHaveLength(3);
    expect(last.body.kind === "rows" && last.body.rows[0]?.rank).toBe(HIGHSCORES_PAGE_SIZE * 2 + 1);

    // A page beyond the end shows the last page rather than an empty card.
    expect(highscoresViewState({ load: { status: "ready", response }, page: 99 }).page).toBe(2);
    expect(highscoresViewState({ load: { status: "ready", response }, page: -4 }).page).toBe(0);
  });
});

describe("highscores screen", () => {
  const source = (
    fetch: () => Promise<ScoreboardResponseV1>,
    viewer?: HighscoresViewer,
  ) => ({ fetch, viewer: () => viewer });

  it("paints the loading state before the response and the rows after it", async () => {
    const presentation = recorder();
    const screen = new HighscoresScreen(
      source(async () => ranked(2)),
      presentation,
    );
    await screen.start();
    expect(presentation.renders.map((state) => state.body.kind)).toEqual(["loading", "rows"]);
  });

  it("turns a failure into a state rather than a rejection", async () => {
    const presentation = recorder();
    const screen = new HighscoresScreen(
      source(async () => { throw new Error("Scores are unavailable right now."); }),
      presentation,
    );
    // A rejection here would escape into the menu's activation handler; the screen owns it instead.
    await expect(screen.start()).resolves.toBeUndefined();
    expect(screen.debugState()).toMatchObject({
      status: "error",
      message: "Scores are unavailable right now.",
    });
  });

  it("ignores a response that lands after the scene tore the screen down", async () => {
    const presentation = recorder();
    let settle: (response: ScoreboardResponseV1) => void = () => {};
    const screen = new HighscoresScreen(
      source(() => new Promise((resolve) => { settle = resolve; })),
      presentation,
    );
    const started = screen.start();
    expect(presentation.renders).toHaveLength(1);

    screen.dispose();
    settle(ranked(3));
    await started;
    // Nothing repainted after disposal: the Pixi nodes behind the presentation are gone by now.
    expect(presentation.renders).toHaveLength(1);
    expect(presentation.disposals).toBe(1);
    expect(screen.debugState()).toMatchObject({ open: false });
    screen.dispose();
    expect(presentation.disposals).toBe(1);
  });

  it("re-reads the viewer on every paint so a live opt-in change follows", async () => {
    const presentation = recorder();
    let current: HighscoresViewer = { username: "Ada", publicScoreboard: false };
    const screen = new HighscoresScreen(
      { fetch: async () => ranked(HIGHSCORES_PAGE_SIZE + 1), viewer: () => current },
      presentation,
    );
    await screen.start();
    expect(presentation.renders.at(-1)?.footer).toContain("Options");

    // The Options panel can flip the setting while the board is open.
    current = { username: "Ada", publicScoreboard: true };
    screen.turnPage(1);
    expect(presentation.renders.at(-1)?.footer).toBeUndefined();
    expect(presentation.renders.at(-1)?.page).toBe(1);
  });

  it("does not repaint for a page turn that would go past either end", async () => {
    const presentation = recorder();
    const screen = new HighscoresScreen(source(async () => ranked(3)), presentation);
    await screen.start();
    const painted = presentation.renders.length;

    screen.turnPage(-1);
    screen.turnPage(1);
    expect(presentation.renders).toHaveLength(painted);
  });

  it("closes through the presentation and reports the back press as handled", async () => {
    const presentation = recorder();
    const screen = new HighscoresScreen(source(async () => ranked(1)), presentation);
    await screen.start();

    expect(screen.requestBack()).toBe(true);
    expect(presentation.closes).toBe(1);
    // Once disposed the screen no longer claims the Escape key, so the layer beneath gets it.
    screen.dispose();
    expect(screen.requestBack()).toBe(false);
    expect(presentation.closes).toBe(1);
  });
});
