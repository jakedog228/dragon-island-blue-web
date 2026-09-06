




















export interface BitmapWrapFont {
  /** `ccBMFontDef.xAdvance` (entry `+0x1c`); 0 for a code point the .fnt never defined, matching
   *  the original's zero-filled `BMFontArray_`. */
  xAdvance(character: string): number;


  kerning(first: string | undefined, second: string): number;

  readonly paddingLeft: number;

  readonly paddingRight: number;
}




export interface BitmapWrapLine {
  readonly start: number;
  readonly end: number;
}

const NEWLINE = "\n";
const SPACE = " ";







function measuredCharacter(character: string): string {
  const code = character.codePointAt(0);
  return code !== undefined && code >>> 11 !== 0 ? "?" : character;
}














export function wrapBitmapCharacters(
  characters: readonly string[],
  limit: number,
  font: BitmapWrapFont,
): readonly BitmapWrapLine[] {
  if (!Number.isFinite(limit)) throw new Error(`wrapBitmapCharacters: invalid limit ${limit}`);
  const total = characters.length;
  if (total === 0) return Object.freeze([Object.freeze({ start: 0, end: 0 })]);

  const lines: BitmapWrapLine[] = [];
  let lineStart = 0;        // var_4c_1
  let backtrackFloor = -1;  // var_60_1 — the scan never walks back past the previous break
  let width = 0;            // r11
  let previous: string | undefined;  // var_90_1, the kerning predecessor
  let index = 0;

  while (index < total) {
    const raw = characters[index]!;
    const character = measuredCharacter(raw);
    const kerning = font.kerning(previous, character);
    const isNewline = raw === NEWLINE;

    if (!isNewline && width <= limit) {
      previous = character;
      width += font.xAdvance(character) + kerning + font.paddingRight;
      index += 1;
      continue;
    }

    // Break path. Walk back to the last space, unwinding widths as we go.
    const overflowIndex = index;
    let scan = index - 1;
    let spaceIndex = -1;
    let brokeAtSpace = false;
    if (scan > backtrackFloor && !isNewline) {
      for (;;) {
        const current = measuredCharacter(characters[scan]!);
        const preceding = scan > lineStart ? measuredCharacter(characters[scan - 1]!) : undefined;
        if (current === SPACE && spaceIndex === -1) {
          spaceIndex = scan;

          if (scan + 1 < total) brokeAtSpace = true;
        }
        width -= font.kerning(preceding, current) + font.xAdvance(current) + font.paddingLeft;
        if (spaceIndex !== -1 && (lineStart === scan || preceding !== SPACE)) break;
        scan -= 1;
        if (scan <= backtrackFloor) break;
      }
    }

    const lineEnd = brokeAtSpace ? spaceIndex + 1 : overflowIndex;
    lines.push(Object.freeze({ start: lineStart, end: lineEnd }));

    width = 0;
    previous = undefined;
    if (!brokeAtSpace) {
      // `if ((var_50_1 & 1) == 0)`: the character that triggered the break — including a `\n`,
      // whose glyph is absent from the shipped fonts and so contributes only padding — opens the
      // next line and is accumulated before the scan advances past it.
      previous = character;
      width = font.xAdvance(character) + kerning + font.paddingRight;
    }
    lineStart = lineEnd;
    backtrackFloor = lineEnd;
    index = (brokeAtSpace ? spaceIndex : overflowIndex) + 1;
  }

  lines.push(Object.freeze({ start: lineStart, end: total }));
  return Object.freeze(lines);
}










export function joinWrappedBitmapLines(
  characters: readonly string[],
  lines: readonly BitmapWrapLine[],
  trimTrailingWhitespace: boolean,
): readonly string[] {
  const out: string[] = [];
  for (const line of lines) {
    let end = line.end;
    if (trimTrailingWhitespace) {
      while (end > line.start && /^\s$/.test(characters[end - 1]!)) end -= 1;
    }
    if (out.length > 0 && characters[line.start] !== NEWLINE) out.push(NEWLINE);
    for (let i = line.start; i < end; i += 1) out.push(characters[i]!);
  }
  return out;
}
