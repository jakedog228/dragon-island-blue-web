import { Container, type Texture } from "pixi.js";
import { Box, makeTtfLabel, pointSprite } from "@dib/renderer";
import {
  MANAGEMENT_LEVEL_FONT_PT,
  MANAGEMENT_STAR_COUNT_FONT_PT,
  MANAGEMENT_STAR_TEXT_GAP_PT,
  evolutionProgressPercent,
  managementDetailOpacity,
  managementSummaryBoxPosition,
} from "../battle/monsterManagementMath.js";
import { localizedString, type LocalizedStrings } from "../localization.js";
import { DISPLAY_MODE } from "../runtimeSettings.js";
import { unscaledIdiomPt } from "../displayMode.js";

export interface ManagementSelectionSummaryEntry {
  readonly instanceId: string;
  readonly level: number;
  readonly stars: number;
  readonly evolveLevel?: number;
  readonly previousEvolveLevel?: number;
}

/** Shared source composition for MonsterManagementNode's top/bottom selected-monster displays. */
export class ManagementSelectionSummary extends Container {
  private currentId: string | undefined;
  private summaryNode: Container | undefined;
  private evolutionLabel: ReturnType<typeof makeTtfLabel> | undefined;
  private elapsedMs = 0;

  constructor(
    private readonly rarityStarTexture: Texture,
    private readonly strings: LocalizedStrings,
  ) {
    super();
    this.eventMode = "none";
  }

  setEntry(entry: ManagementSelectionSummaryEntry | undefined): void {
    if (entry?.instanceId === this.currentId) return;
    this.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.currentId = entry?.instanceId;
    this.summaryNode = undefined;
    this.evolutionLabel = undefined;
    this.elapsedMs = 0;
    if (entry === undefined) return;

    const summary = new Box({
      horizontal: true,
      positiveAlignDirection: true,
      gap: unscaledIdiomPt(5, DISPLAY_MODE),
    });
    summary.addBoxChild(pointSprite(this.rarityStarTexture));
    const starText = Number.isInteger(entry.stars)
      ? `${entry.stars}`
      : `${Math.floor(entry.stars)}.5`;
    summary.addBoxChild(
      makeTtfLabel(
        starText,
        unscaledIdiomPt(MANAGEMENT_STAR_COUNT_FONT_PT, DISPLAY_MODE),
        { outline: false },
      ),
      { gapBefore: unscaledIdiomPt(MANAGEMENT_STAR_TEXT_GAP_PT, DISPLAY_MODE) },
    );
    summary.addBoxChild(
      makeTtfLabel(
        `${localizedString(this.strings, "LevelShortKey")}:${entry.level}`,
        unscaledIdiomPt(MANAGEMENT_LEVEL_FONT_PT, DISPLAY_MODE),
        { outline: false },
      ),
    );
    const summaryPosition = managementSummaryBoxPosition(summary.boxContentSize);
    summary.position.set(summaryPosition.x, summaryPosition.y);
    this.addChild(summary);
    this.summaryNode = summary;

    if (entry.evolveLevel !== undefined) {
      const percent = evolutionProgressPercent(
        entry.level,
        entry.evolveLevel,
        entry.previousEvolveLevel ?? 1,
      );
      const text = localizedString(this.strings, "EvolvedProgressFormatKey")
        .replace("%d%%", `${percent}%`);
      const evolution = makeTtfLabel(
        text,
        unscaledIdiomPt(MANAGEMENT_LEVEL_FONT_PT, DISPLAY_MODE),
        { outline: false },
      );
      evolution.anchor.set(0.5);
      evolution.alpha = 0;
      this.addChild(evolution);
      this.evolutionLabel = evolution;
    }
    this.applyOpacity();
  }

  update(dtMs: number): void {
    if (this.currentId === undefined) return;
    this.elapsedMs += dtMs;
    this.applyOpacity();
  }

  private applyOpacity(): void {
    const opacity = this.evolutionLabel
      ? managementDetailOpacity(this.elapsedMs)
      : { summary: 1, evolution: 0 };
    if (this.summaryNode) this.summaryNode.alpha = opacity.summary;
    if (this.evolutionLabel) this.evolutionLabel.alpha = opacity.evolution;
  }
}
