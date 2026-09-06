


export type LocalizedStrings = Readonly<Record<string, string>>;


function renderableNameLookup(strings: LocalizedStrings, name: string): string | undefined {
  return strings[`Renderable${name}NameKey`];
}


export function localizedRenderableName(strings: LocalizedStrings, candidates: readonly string[]): string {
  if (candidates.length === 0) throw new Error("localizedRenderableName: no candidate names");
  for (const name of candidates) {
    const hit = renderableNameLookup(strings, name);
    if (hit !== undefined) return hit;
  }
  return candidates[candidates.length - 1]!;
}

/** `-[NSBundle localizedStringForKey:...]` for non-Renderable UI keys (`LevelShortKey`, `HPKey`,
 *  `LockedAbilityTitleKey`, ...). Fail-loudly: these keys are structural (the original always
 *  ships them), so a miss is an extraction/typo bug, not a fallback case. */
export function localizedString(strings: LocalizedStrings, key: string): string {
  const value = strings[key];
  if (value === undefined) throw new Error(`LocalizableStrings.json is missing key "${key}"`);
  return value;
}


export function abilityStatusTextLine(
  strings: LocalizedStrings,
  key: string,
  livingName: string,
): string {
  const template = localizedString(strings, key);
  for (const token of ["@A", "@DAMAGE", "@HEALING"]) {
    if (template.includes(token)) {
      throw new Error(
        `statusTextLocalizationKey "${key}" template uses ${token} — no real carrier does; ` +
          "its substitution (ability name / sub_66770 number format) is unimplemented",
      );
    }
  }
  return template.replaceAll("@N", livingName);
}
