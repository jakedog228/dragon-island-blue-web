import { Container, Graphics, Rectangle, type Text, type Ticker } from "pixi.js";
import { makeTtfLabel, type AssetLibrary, type Scale9SpritesData } from "@dib/renderer";
import { normalizeAccountUsername, type ScoreboardResponseV1 } from "@dib/game-protocol";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { registerRuntimeSettingsRefresh } from "../runtimeSettingsRefresh.js";
import { idiomPairPt } from "../displayMode.js";
import { showMonsterHatchPopup } from "../ui/monsterHatchPopup.js";
import type { Popup } from "../ui/popup.js";


export const HIGHSCORES_PAGE_SIZE = 10;

const PRIVATE_FOOTER = "Your scores are private — Options → Scores to share.";
const EMPTY_MESSAGE = "No players have made their scores public yet.";
const LOADING_MESSAGE = "Loading scores…";

const ROW_COLOR = 0xffffff;
const OWN_ROW_COLOR = 0xffe14d;
const DIM_COLOR = 0xa6a6a6;
const ERROR_COLOR = 0xff8a80;

/** The signed-in account, when there is one. Operator-issued invites have no account and no row. */
export interface HighscoresViewer {
  readonly username: string;
  readonly publicScoreboard: boolean;
}

export interface HighscoresRowView {
  readonly rank: number;
  readonly username: string;
  readonly heroLevel: number;
  readonly totalXp: number;
  /** True for the viewer's own entry, matched by normalized username — see `highscoresViewState`. */
  readonly own: boolean;
}

export type HighscoresBody =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "empty" }
  | { readonly kind: "rows"; readonly rows: readonly HighscoresRowView[] };

export interface HighscoresViewState {
  readonly body: HighscoresBody;
  /** Present only when there is something actionable to say about the viewer's own visibility. */
  readonly footer?: string;
  /** Zero-based, already clamped into range. */
  readonly page: number;
  readonly pageCount: number;
  readonly totalEntries: number;
}

export type HighscoresLoad =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly response: ScoreboardResponseV1 };

/**
 * The whole screen as a pure function of what has been loaded and who is looking.
 *
 * The board carries no player id — a public, unauthenticated route has no business publishing the
 * durable correlation handle — so the viewer's own row is found by name. That is sound because
 * `assertUsernameAvailable` (`apps/game-server/src/invites.ts`) enforces case-insensitive
 * uniqueness, so a normalized, case-folded name identifies at most one account.
 */
export function highscoresViewState(input: {
  readonly load: HighscoresLoad;
  readonly viewer?: HighscoresViewer;
  readonly page: number;
}): HighscoresViewState {
  const viewer = input.viewer;
  // A viewer who has opted out is the only one told anything: an opted-in player can see their own
  // row, and an operator invite has no Options row to be pointed at.
  const footer = viewer !== undefined && !viewer.publicScoreboard ? PRIVATE_FOOTER : undefined;

  if (input.load.status !== "ready") {
    return {
      body: input.load.status === "loading"
        ? { kind: "loading" }
        : { kind: "error", message: input.load.message },
      page: 0,
      pageCount: 1,
      totalEntries: 0,
    };
  }

  const entries = input.load.response.entries;
  const pageCount = Math.max(1, Math.ceil(entries.length / HIGHSCORES_PAGE_SIZE));
  const page = Math.min(Math.max(0, Math.trunc(input.page)), pageCount - 1);
  if (entries.length === 0) {
    return { body: { kind: "empty" }, ...(footer === undefined ? {} : { footer }), page, pageCount, totalEntries: 0 };
  }

  const own = viewer === undefined ? undefined : usernameKey(viewer.username);
  const rows = entries
    .slice(page * HIGHSCORES_PAGE_SIZE, (page + 1) * HIGHSCORES_PAGE_SIZE)
    .map((entry): HighscoresRowView => ({
      rank: entry.rank,
      username: entry.username,
      heroLevel: entry.heroLevel,
      totalXp: entry.totalXp,
      own: own !== undefined && usernameKey(entry.username) === own,
    }));
  return {
    body: { kind: "rows", rows },
    ...(footer === undefined ? {} : { footer }),
    page,
    pageCount,
    totalEntries: entries.length,
  };
}

function usernameKey(username: string): string {
  return normalizeAccountUsername(username).toLowerCase();
}

/** Where the board comes from and who is looking. Both are read per open, never cached here. */
export interface HighscoresSource {
  fetch(): Promise<ScoreboardResponseV1>;
  viewer(): HighscoresViewer | undefined;
}

/** The seam the driver below talks to, so its state machine is testable without a renderer. */
export interface HighscoresPresentation {
  render(state: HighscoresViewState): void;
  /** Web-native equivalent of pressing the visible Ok button. */
  requestClose(): void;
  dispose(): void;
}

/**
 * Load-and-page state machine. Kept apart from Pixi because a network-backed screen inside a modal
 * stack has more states than a local one, and because the response can land after the screen has
 * already been torn down by a scene change.
 */
export class HighscoresScreen {
  private load: HighscoresLoad = { status: "loading" };
  private page = 0;
  private disposed = false;

  constructor(
    private readonly source: HighscoresSource,
    private readonly presentation: HighscoresPresentation,
  ) {}

  /** Renders the loading state, then the result. Never rejects: a failure *is* one of the states. */
  async start(): Promise<void> {
    this.repaint();
    try {
      const response = await this.source.fetch();
      if (this.disposed) return;
      this.load = { status: "ready", response };
    } catch (error) {
      if (this.disposed) return;
      this.load = { status: "error", message: describeFailure(error) };
    }
    this.repaint();
  }

  turnPage(delta: number): void {
    if (this.disposed) return;
    const before = this.state();
    const next = Math.min(Math.max(0, before.page + delta), before.pageCount - 1);
    if (next === before.page) return;
    this.page = next;
    this.repaint();
  }

  state(): HighscoresViewState {
    const viewer = this.source.viewer();
    return highscoresViewState({
      load: this.load,
      ...(viewer === undefined ? {} : { viewer }),
      page: this.page,
    });
  }

  requestBack(): boolean {
    if (this.disposed) return false;
    this.presentation.requestClose();
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.presentation.dispose();
  }

  debugState(): Record<string, unknown> {
    const state = this.state();
    return {
      open: !this.disposed,
      status: this.load.status,
      body: state.body.kind,
      page: state.page,
      pageCount: state.pageCount,
      totalEntries: state.totalEntries,
      ...(state.footer === undefined ? {} : { footer: state.footer }),
      ...(state.body.kind === "rows"
        ? { rows: state.body.rows.map((row) => ({ rank: row.rank, username: row.username, own: row.own })) }
        : {}),
      ...(state.body.kind === "error" ? { message: state.body.message } : {}),
    };
  }

  private repaint(): void {
    if (this.disposed) return;
    this.presentation.render(this.state());
  }
}

/** Surfaces the server's own words; anything else would hide the reason the board is missing. */
function describeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 0 ? message : "Scores are unavailable right now.";
}

// --- Pixi presentation -------------------------------------------------------------------------

// The card is measured once by `Popup.show`, so the board area is a FIXED box that every state
// draws into: were it sized per state, the card would be built around "Loading scores…" and then be
// overrun by the rows that replace it.
let BOARD_WIDTH = idiomPairPt(300, 600, DISPLAY_MODE);
let ROW_HEIGHT = idiomPairPt(16, 32, DISPLAY_MODE);
let ROW_FONT = idiomPairPt(12, 24, DISPLAY_MODE);
let SMALL_FONT = idiomPairPt(10, 20, DISPLAY_MODE);
let PAGER_HEIGHT = idiomPairPt(20, 40, DISPLAY_MODE);
let FOOTER_HEIGHT = idiomPairPt(26, 52, DISPLAY_MODE);
registerRuntimeSettingsRefresh(() => {
  BOARD_WIDTH = idiomPairPt(300, 600, DISPLAY_MODE);
  ROW_HEIGHT = idiomPairPt(16, 32, DISPLAY_MODE);
  ROW_FONT = idiomPairPt(12, 24, DISPLAY_MODE);
  SMALL_FONT = idiomPairPt(10, 20, DISPLAY_MODE);
  PAGER_HEIGHT = idiomPairPt(20, 40, DISPLAY_MODE);
  FOOTER_HEIGHT = idiomPairPt(26, 52, DISPLAY_MODE);
});

export interface HighscoresPanelOptions {
  parent: Container;
  assets: AssetLibrary;
  scale9: Scale9SpritesData;
  strings: LocalizedStrings;
  ticker: Ticker;
  source: HighscoresSource;
  onClick: () => void;
  onDismiss: () => void;
}

export interface HighscoresPanelHandle {
  popup: Popup;
  requestBack(): boolean;
  requestClose(): void;
  /** Called by the owning scene's teardown so a late response cannot touch destroyed nodes. */
  dispose(): void;
  debugState(): Record<string, unknown>;
}

/** Builds the card, mounts it, and kicks off the load. Resolves once the card is on screen. */
export async function showHighscoresPanel(
  options: HighscoresPanelOptions,
): Promise<HighscoresPanelHandle> {
  const content = new Container();
  content.label = "highscoresContent";
  const bodyHeight = ROW_HEIGHT * (HIGHSCORES_PAGE_SIZE + 1);
  content.addChild(
    new Graphics()
      .rect(0, 0, BOARD_WIDTH, bodyHeight + PAGER_HEIGHT + FOOTER_HEIGHT)
      .fill({ color: 0x000000, alpha: 0 }),
  );
  const body = new Container();
  const pager = new Container();
  pager.position.set(0, bodyHeight);
  const footer = new Container();
  footer.position.set(0, bodyHeight + PAGER_HEIGHT);
  content.addChild(body, pager, footer);

  let screen!: HighscoresScreen;
  const presentation: HighscoresPresentation = {
    render(state) {
      if (content.destroyed) return;
      paintBody(body, state);
      paintPager(pager, state, (delta) => {
        options.onClick();
        screen.turnPage(delta);
      });
      paintFooter(footer, state);
    },
    requestClose() {
      if (popup.isDismissed) return;
      options.onClick();
      popup.dismiss();
    },
    dispose() {
      if (!popup.isDismissed) popup.dismiss();
    },
  };
  screen = new HighscoresScreen(options.source, presentation);

  const popup = await showMonsterHatchPopup({
    parent: options.parent,
    assets: options.assets,
    scale9: options.scale9,
    ticker: options.ticker,
    zIndex: 90,
    sfx: { onButtonPress: options.onClick },
  }, {
    title: localizedString(options.strings, "ShowLeaderboardsKey"),
    content,
    buttons: [{ label: localizedString(options.strings, "OkButtonKey"), onPress: () => {} }],
    onDismiss: () => {
      screen.dispose();
      options.onDismiss();
    },
  });
  // Started only after the card exists: `render` reaches into nodes the popup has already mounted,
  // and the very first paint is the loading state the player should see while the request runs.
  void screen.start();
  return {
    popup,
    requestBack: () => screen.requestBack(),
    requestClose: () => presentation.requestClose(),
    dispose: () => screen.dispose(),
    debugState: () => screen.debugState(),
  };
}

/** Column right/left edges inside `BOARD_WIDTH`, as fractions so both idioms share one layout. */
function columns(): { rank: number; name: number; level: number; xp: number } {
  return {
    rank: BOARD_WIDTH * 0.07,
    name: BOARD_WIDTH * 0.1,
    level: BOARD_WIDTH * 0.72,
    xp: BOARD_WIDTH,
  };
}

function paintBody(body: Container, state: HighscoresViewState): void {
  clear(body);
  const column = columns();
  if (state.body.kind !== "rows") {
    const message = state.body.kind === "loading"
      ? LOADING_MESSAGE
      : state.body.kind === "empty"
        ? EMPTY_MESSAGE
        : state.body.message;
    const label = makeTtfLabel(message, ROW_FONT, {
      wordWrapWidth: BOARD_WIDTH,
      align: "center",
      outline: false,
      fill: state.body.kind === "error" ? ERROR_COLOR : DIM_COLOR,
    });
    label.anchor.set(0.5);
    label.position.set(BOARD_WIDTH / 2, ROW_HEIGHT * (HIGHSCORES_PAGE_SIZE + 1) / 2);
    body.addChild(label);
    return;
  }

  addCell(body, "#", column.rank, 0, 1, DIM_COLOR);
  addCell(body, "Player", column.name, 0, 0, DIM_COLOR);
  addCell(body, "Lv", column.level, 0, 1, DIM_COLOR);
  addCell(body, "XP", column.xp, 0, 1, DIM_COLOR);
  state.body.rows.forEach((row, index) => {
    const y = (index + 1) * ROW_HEIGHT;
    const color = row.own ? OWN_ROW_COLOR : ROW_COLOR;
    addCell(body, `${row.rank}`, column.rank, y, 1, color);
    addCell(body, truncateName(row.username), column.name, y, 0, color);
    addCell(body, `${row.heroLevel}`, column.level, y, 1, color);
    addCell(body, row.totalXp.toLocaleString("en-US"), column.xp, y, 1, color);
  });
}

/**
 * Paging lives in the content rather than the popup's button row: `PopupButtonSpec.enabled` is read
 * when the row is built, which is before the first response has landed, so a button there could
 * never dim itself at the ends of the board.
 */
function paintPager(
  pager: Container,
  state: HighscoresViewState,
  turn: (delta: number) => void,
): void {
  clear(pager);
  if (state.body.kind !== "rows" || state.pageCount <= 1) return;
  const centerY = PAGER_HEIGHT / 2;
  const position = makeTtfLabel(`${state.page + 1} / ${state.pageCount}`, SMALL_FONT, {
    outline: false,
    fill: DIM_COLOR,
  });
  position.anchor.set(0.5);
  position.position.set(BOARD_WIDTH / 2, centerY);
  pager.addChild(position);
  addPagerButton(pager, "Prev", BOARD_WIDTH * 0.25, centerY, state.page > 0, () => turn(-1));
  addPagerButton(
    pager,
    "Next",
    BOARD_WIDTH * 0.75,
    centerY,
    state.page < state.pageCount - 1,
    () => turn(1),
  );
}

function paintFooter(footer: Container, state: HighscoresViewState): void {
  clear(footer);
  if (state.footer === undefined) return;
  const label = makeTtfLabel(state.footer, SMALL_FONT, {
    wordWrapWidth: BOARD_WIDTH,
    align: "center",
    outline: false,
    fill: DIM_COLOR,
  });
  label.anchor.set(0.5);
  label.position.set(BOARD_WIDTH / 2, FOOTER_HEIGHT / 2);
  footer.addChild(label);
}

function addPagerButton(
  pager: Container,
  text: string,
  x: number,
  y: number,
  enabled: boolean,
  onPress: () => void,
): void {
  const label = makeTtfLabel(text, SMALL_FONT, { outline: false, fill: enabled ? ROW_COLOR : DIM_COLOR });
  label.label = `highscoresPage:${text.toLowerCase()}`;
  label.anchor.set(0.5);
  label.position.set(x, y);
  if (enabled) {
    label.eventMode = "static";
    label.cursor = "pointer";
    label.hitArea = new Rectangle(-label.width / 2, -label.height / 2, label.width, label.height);
    label.on("pointertap", onPress);
  }
  pager.addChild(label);
}

function addCell(
  parent: Container,
  text: string,
  x: number,
  y: number,
  anchorX: number,
  fill: number,
): Text {
  const label = makeTtfLabel(text, ROW_FONT, { outline: false, fill });
  label.anchor.set(anchorX, 0);
  label.position.set(x, y);
  parent.addChild(label);
  return label;
}

/** The wire schema caps usernames well below this, but a long name must not run into the Lv column. */
function truncateName(username: string): string {
  return username.length <= 16 ? username : `${username.slice(0, 15)}…`;
}

function clear(container: Container): void {
  for (const child of container.removeChildren()) child.destroy();
}
