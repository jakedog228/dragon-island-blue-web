


import type { BattleEvent } from "@dib/engine";

/**
 * Formats engine `BattleEvent`s into human-readable lines. Moved verbatim (wording unchanged) from
 * `BattleScreen.logEvents` (apps/web/src/battle/BattleScreen.ts) per the Task 8 brief — that
 * class's copy is left in place for now (it's deleted wholesale in Task 15's BattleNode
 * integration); `nameOf` replaces its `this.session.shortTypeOf` call so this module stays pixi-
 * and-engine-session-free.
 */
export function formatEventLines(events: readonly BattleEvent[], nameOf: (id: string) => string): string[] {
  const lines: string[] = [];
  for (const e of events) {
    if (e.type === "abilityUsed") {
      const targets = e.targets.map(nameOf).join(", ");
      lines.push(`${nameOf(e.source)} → ${e.ability.split(".").at(-1)}${targets ? ` @ ${targets}` : ""}`);
    } else if (e.type === "died") {
      lines.push(`${nameOf(e.living)} fainted`);
    } else if (e.type === "battleEnded") {
      lines.push(e.winner === 0 ? "Victory!" : "Defeat…");
    }
  }
  return lines;
}


export class StatusTextBuffer {

  static readonly CAP_THRESHOLD = 5;

  static readonly KEPT_COMPONENTS = 4;

  readonly autoAdvanceAfter = 5.0;

  private text = "";


  get hasText(): boolean {
    return this.text.length > 0;
  }


  get combined(): string | null {
    return this.text.length === 0 ? null : this.text;
  }


  append(line: string): void {

    if (line.length === 0) return;
    if (this.text.length === 0) {
      this.text = line;
    } else {
      this.text = `${this.text}\n${line}`;
    }


    const components = this.text.split("\n");
    if (components.length >= StatusTextBuffer.CAP_THRESHOLD) {


      let rebuilt = "";
      for (let i = components.length - StatusTextBuffer.KEPT_COMPONENTS; i < components.length; i++) {
        rebuilt += `${components[i]}\n`;
      }
      this.text = rebuilt;
    }
  }


  clear(): void {
    this.text = "";
  }
}
