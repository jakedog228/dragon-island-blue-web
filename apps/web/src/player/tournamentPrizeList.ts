import {
  makeTtfLabel,
  pointSprite,
  type AssetLibrary,
} from "@dib/renderer";
import { buildTournamentRewardNode } from "./tournamentRewardNode.js";
import type { GameData, TournamentDef } from "@dib/gamedata/browser";
import type { PlayerReward } from "@dib/engine";
import {
  Container,
  Graphics,
  Rectangle,
  type FederatedPointerEvent,
  type FederatedWheelEvent,
  type Ticker,
} from "pixi.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { sourceFullscreenSprite } from "../ui/sourceFullscreenSprite.js";
import {
  PRIZE_ROW_TEXT_COLOR,
  PRIZE_TITLE_TEXT_COLOR,
  aspectFitScale,
  clampScrollOffset,
  prizeListOffsetForThumbTop,
  prizeListScrollBar,
  prizeListThumbTop,
  tournamentPrizeListLayout,
  type PrizeListScrollBar,
  type RectPt,
} from "./tournamentPrizeListMath.js";

export interface TournamentPrizeListOptions {
  readonly parent: Container;
  readonly assets: AssetLibrary;
  readonly ticker: Ticker;
  readonly data: GameData;
  /** `-[UserSavedData currentTournamentIndex]`: the lock clears once this passes a row's index. */
  readonly currentTournamentIndex: number;
  /** Chat portrait for a tournament's final round, matching the source cell's own lookup. */
  readonly finalRoundPortraitFile: (tournament: TournamentDef) => string | undefined;
  /** `-[Tournament itemRewards]`; the cell renders element zero. */
  readonly prizeRewards: (tournament: TournamentDef) => readonly PlayerReward[];
  readonly onClose: () => void;
  readonly onClick: () => void;
}












export class TournamentPrizeList extends Container {
  private closed = false;
  private scrollOffset = 0;
  private contentHeight = 0;
  private viewportHeight = 0;
  /**
   * Drag deltas are measured in the TABLE's own point space, not in `event.global`. The list is
   * rendered under `FixedStage.root`'s letterbox scale times the world's CONTENT_SCALE_FACTOR, so
   * a raw global delta scrolls the content two to three times as far as the pointer actually
   * travelled — and by a factor that changes with the window size.
   */
  private drag: {
    readonly id: number;
    readonly mode: "content" | "thumb";
    readonly startLocalY: number;
    readonly startOffset: number;
  } | undefined;
  private table!: Container;
  private rowsRoot!: Container;
  private scrollThumb: Graphics | undefined;
  private scrollBar: PrizeListScrollBar | undefined;
  private readonly rowStates: Array<Record<string, unknown>> = [];

  private constructor(private readonly opts: TournamentPrizeListOptions) {
    super();
  }

  static async show(opts: TournamentPrizeListOptions): Promise<TournamentPrizeList> {
    const view = new TournamentPrizeList(opts);
    await view.build();
    opts.parent.addChild(view);
    return view;
  }

  get debugState(): Record<string, unknown> {
    return {
      kind: "tournamentPrizeList",
      open: !this.closed,
      rows: this.rowStates,
      scrollOffset: this.scrollOffset,
      maxScroll: Math.max(0, this.contentHeight - this.viewportHeight),
      thumbTop: this.scrollThumb?.position.y ?? null,
      dragging: this.drag?.mode ?? null,
    };
  }

  requestBack(): boolean {
    this.dispose();
    return true;
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    this.opts.onClose();
    this.parent?.removeChild(this);
    this.destroy({ children: true });
  }

  private async build(): Promise<void> {
    const layout = tournamentPrizeListLayout(DISPLAY_MODE);
    this.label = "tournamentPrizeList";
    this.zIndex = 1_000;
    this.eventMode = "static";
    this.hitArea = new Rectangle(0, 0, layout.screen.w, layout.screen.h);
    for (const event of [
      "pointerdown", "pointerup", "pointerupoutside", "pointertap", "pointermove",
    ] as const) this.on(event, (pointer: FederatedPointerEvent) => pointer.stopPropagation());

    // The controller nib's root image view is `ArenaCombat.png`, the same plate the Arena menu uses.
    const background = sourceFullscreenSprite(
      await this.opts.assets.sprite("ArenaCombat"),
      DISPLAY_MODE,
      "ArenaCombat",
    );
    background.eventMode = "none";
    this.addChild(background);

    // `titleLabel`: ArialMT, centred in its frame. The iPad nib authors a 1064pt-wide label on a
    // 1024pt screen, so its centre sits slightly right of the screen's — reproduced, not corrected.
    const title = makeTtfLabel("Tournament Prizes", layout.titleFontSize, {
      fill: PRIZE_TITLE_TEXT_COLOR,
      bold: false,
      outline: false,
    });
    title.label = "prizeList:title";
    title.anchor.set(0.5);
    title.position.set(
      layout.titleLabel.x + layout.titleLabel.w / 2,
      layout.titleLabel.y + layout.titleLabel.h / 2,
    );
    this.addChild(title);

    await this.buildTable(layout);

    const close = pointSprite(await this.opts.assets.sprite("PopupMenuCloseButton-hd"));
    close.label = "prizeList:close";
    close.position.set(layout.closeButton.x, layout.closeButton.y);
    close.width = layout.closeButton.w;
    close.height = layout.closeButton.h;
    close.eventMode = "static";
    close.cursor = "pointer";
    close.on("pointertap", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.opts.onClick();
      this.dispose();
    });
    this.addChild(close);
  }

  private async buildTable(
    layout: ReturnType<typeof tournamentPrizeListLayout>,
  ): Promise<void> {
    const table = new Container();
    table.label = "prizeList:table";
    table.position.set(layout.table.x, layout.table.y);
    this.table = table;
    this.addChild(table);

    // The mask has to be a separate node from the one being clipped — masking the container that
    // also parents the mask leaves the rows unclipped, which lets a scrolled row bleed above the
    // table's top edge.
    const mask = new Graphics().rect(0, 0, layout.table.w, layout.table.h).fill(0xffffff);
    mask.label = "prizeList:tableMask";
    table.addChild(mask);

    this.rowsRoot = new Container();
    this.rowsRoot.label = "prizeList:rows";
    this.rowsRoot.mask = mask;
    table.addChild(this.rowsRoot);

    // `tableView:cellForRowAtIndexPath:` indexes `count - 1 - row`, so the newest class is first.
    const entries = [...this.opts.data.allTournaments()].reverse();
    for (const [row, entry] of entries.entries()) {
      const cell = await this.buildRow(layout, entry, row);
      cell.position.set(0, row * layout.rowHeight);
      this.rowsRoot.addChild(cell);
    }
    this.contentHeight = entries.length * layout.rowHeight;
    this.viewportHeight = layout.table.h;

    const bar = prizeListScrollBar(layout, this.contentHeight);
    this.scrollBar = bar;
    if (bar !== undefined) {
      // The strip is a couple of points wide, so both nodes take a hit area several times their
      // drawn width: with a mouse the pointer only has to land NEAR the bar. It widens inward
      // only — the table's own hit area prunes its whole subtree outside `table.w`, so grab room
      // past the right edge would be dead. `track` is a hit region that draws nothing: UIKit's
      // indicator has no track, and adding one would change a look that is otherwise off the nib.
      const grab = bar.width * 3;
      const track = new Container();
      track.label = "prizeList:scrollTrack";
      track.position.set(bar.x, 0);
      track.eventMode = "static";
      track.cursor = "pointer";
      track.hitArea = new Rectangle(-grab, 0, bar.width + grab, this.viewportHeight);
      table.addChild(track);

      const thumb = new Graphics()
        .roundRect(0, 0, bar.width, bar.thumbHeight, bar.width / 2)
        .fill({ color: 0x000000, alpha: 0.35 });
      thumb.label = "prizeList:scrollIndicator";
      thumb.position.set(bar.x, 0);
      thumb.eventMode = "static";
      thumb.cursor = "pointer";
      thumb.hitArea = new Rectangle(-grab, 0, bar.width + grab, bar.thumbHeight);
      table.addChild(thumb);
      this.scrollThumb = thumb;

      // Both bar presses stop propagation so the table's content drag below does not also claim
      // the pointer and fight this one for the same offset.
      thumb.on("pointerdown", (event: FederatedPointerEvent) => {
        event.stopPropagation();
        this.beginDrag(event, "thumb");
      });
      track.on("pointerdown", (event: FederatedPointerEvent) => {
        event.stopPropagation();
        // Pressing the strip centres the thumb on the press, then keeps dragging from there.
        const localY = this.table.toLocal(event.global).y;
        this.applyScroll(prizeListOffsetForThumbTop(bar, localY - bar.thumbHeight / 2));
        this.beginDrag(event, "thumb");
      });
    }

    table.eventMode = "static";
    table.hitArea = new Rectangle(0, 0, layout.table.w, layout.table.h);
    table.on("pointerdown", (event: FederatedPointerEvent) => {
      event.stopPropagation();
      this.beginDrag(event, "content");
    });
    const move = (event: FederatedPointerEvent): void => {
      const drag = this.drag;
      if (drag === undefined || drag.id !== event.pointerId) return;
      event.stopPropagation();
      const delta = this.table.toLocal(event.global).y - drag.startLocalY;
      if (drag.mode === "content") {
        // Content follows the finger: dragging up reveals later rows.
        this.applyScroll(drag.startOffset - delta);
        return;
      }
      // The thumb follows the pointer, and the content moves by the matching share of its range.
      const scrolled = this.scrollBar;
      if (scrolled === undefined) return;
      this.applyScroll(drag.startOffset + prizeListOffsetForThumbTop(scrolled, delta));
    };
    const end = (event: FederatedPointerEvent): void => {
      if (this.drag?.id !== event.pointerId) return;
      event.stopPropagation();
      this.drag = undefined;
    };
    table.on("globalpointermove", move);
    table.on("pointerup", end);
    table.on("pointerupoutside", end);

    // Desktop wheel support, with no touch-only source counterpart. A notch's `deltaY` is in
    // screen pixels, which the table's own transform converts into the point delta the drag
    // path uses — without that the same notch scrolls two to three times too far.
    table.on("wheel", (event: FederatedWheelEvent) => {
      event.stopPropagation();
      const step = event.deltaMode === 1 // DOM_DELTA_LINE (Firefox) -> ~16px/line
        ? this.toTablePoints(event.deltaY * 16)
        : event.deltaMode === 2 // DOM_DELTA_PAGE (rare) -> one viewport, already in points
          ? event.deltaY * this.viewportHeight
          : this.toTablePoints(event.deltaY); // DOM_DELTA_PIXEL
      this.applyScroll(this.scrollOffset + step);
    });

    this.applyScroll(0);
  }

  private beginDrag(event: FederatedPointerEvent, mode: "content" | "thumb"): void {
    this.drag = {
      id: event.pointerId,
      mode,
      startLocalY: this.table.toLocal(event.global).y,
      startOffset: this.scrollOffset,
    };
  }

  /** Converts a length in renderer screen pixels into the table's own point space. */
  private toTablePoints(screenPixels: number): number {
    const origin = this.table.toLocal({ x: 0, y: 0 });
    const unit = this.table.toLocal({ x: 0, y: 1 });
    const perPixel = unit.y - origin.y;
    return perPixel === 0 ? screenPixels : screenPixels * perPixel;
  }

  private applyScroll(next: number): void {
    this.scrollOffset = clampScrollOffset(next, this.contentHeight, this.viewportHeight);
    this.rowsRoot.position.y = -this.scrollOffset;
    const bar = this.scrollBar;
    if (bar === undefined || this.scrollThumb === undefined) return;
    this.scrollThumb.position.y = prizeListThumbTop(bar, this.scrollOffset);
  }

  private async buildRow(
    layout: ReturnType<typeof tournamentPrizeListLayout>,
    entry: TournamentDef,
    row: number,
  ): Promise<Container> {
    const cell = new Container();
    cell.label = `prizeList:row:${row}`;
    const frames = layout.row;

    const rewards = this.opts.prizeRewards(entry);
    const prize = rewards[0];
    if (prize !== undefined) {
      const node = await this.buildPrizeNode(prize);
      const bounds = node.boundsArea;
      if (bounds !== null && bounds.width > 0 && bounds.height > 0) {
        const fit = aspectFitScale(
          { w: bounds.width, h: bounds.height },
          { w: frames.reward.w, h: frames.reward.h },
        );
        node.scale.set(node.scale.x * fit, node.scale.y * fit);
        node.position.set(
          frames.reward.x + (frames.reward.w - bounds.width * Math.abs(node.scale.x)) / 2,
          frames.reward.y + (frames.reward.h - bounds.height * Math.abs(node.scale.y)) / 2,
        );
      } else {
        node.position.set(frames.reward.x, frames.reward.y);
      }
      node.label = `prizeList:reward:${row}`;
      node.eventMode = "none";
      cell.addChild(node);
    }

    // `setHidden:` is driven by `currentTournamentIndex > index`, so the lock stays on until the
    // class has actually been claimed.
    const locked = this.opts.currentTournamentIndex <= entry.index;
    if (locked) {
      const lock = pointSprite(await this.opts.assets.sprite("lock@2x"));
      lock.label = `prizeList:lock:${row}`;
      // UIViewContentModeCenter: natural size, centred in its frame.
      lock.anchor.set(0.5);
      lock.position.set(
        frames.lock.x + frames.lock.w / 2,
        frames.lock.y + frames.lock.h / 2,
      );
      lock.eventMode = "none";
      cell.addChild(lock);
    }

    const classLetter = this.centeredLabel(
      entry.name,
      layout.rowTitleFontSize,
      frames.title,
    );
    classLetter.label = `prizeList:class:${row}`;
    cell.addChild(classLetter);

    const subtitle = makeTtfLabel(entry.subtitle, layout.rowSubtitleFontSize, {
      fill: PRIZE_ROW_TEXT_COLOR,
      bold: true,
      outline: false,
      wordWrapWidth: frames.subtitle.w,
    });
    subtitle.label = `prizeList:subtitle:${row}`;
    subtitle.anchor.set(0, 0.5);
    subtitle.position.set(frames.subtitle.x, frames.subtitle.y + frames.subtitle.h / 2);
    cell.addChild(subtitle);

    const portraitFile = this.opts.finalRoundPortraitFile(entry);
    if (portraitFile !== undefined) {
      const npc = pointSprite(
        await this.opts.assets.sprite(portraitFile.replace(/\.png$/i, "")),
      );
      npc.label = `prizeList:npc:${row}`;
      const fit = aspectFitScale(
        { w: npc.width, h: npc.height },
        { w: frames.npc.w, h: frames.npc.h },
      );
      npc.scale.set(npc.scale.x * fit, npc.scale.y * fit);
      npc.anchor.set(0.5);
      npc.position.set(
        frames.npc.x + frames.npc.w / 2,
        frames.npc.y + frames.npc.h / 2,
      );
      npc.eventMode = "none";
      cell.addChild(npc);
    }

    this.rowStates.push({
      row,
      index: entry.index,
      name: entry.name,
      locked,
      prize: prize?.kind ?? null,
      npc: portraitFile ?? null,
    });
    return cell;
  }

  private centeredLabel(text: string, sizePt: number, frame: RectPt) {
    const label = makeTtfLabel(text, sizePt, {
      fill: PRIZE_ROW_TEXT_COLOR,
      bold: true,
      outline: false,
    });
    label.anchor.set(0.5);
    label.position.set(frame.x + frame.w / 2, frame.y + frame.h / 2);
    return label;
  }

  private async buildPrizeNode(prize: PlayerReward): Promise<Container> {
    return buildTournamentRewardNode(
      prize,
      this.opts.assets,
      this.opts.data,
      "prizeList:rewardIcon",
    );
  }
}
