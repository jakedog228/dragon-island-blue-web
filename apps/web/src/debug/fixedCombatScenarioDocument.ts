import type { ImportedContentPackage } from "../content/archivePackage.js";
import type { ScenarioFixedCombatConfiguration } from "./scenarioMode.js";
import { prepareFixedCombatScenario } from "./fixedCombatScenario.js";

export const FIXED_COMBAT_SCENARIO_DOCUMENT_KIND = "dragon-island-blue-fixed-combat";
export const FIXED_COMBAT_SCENARIO_DOCUMENT_VERSION = 1;

export interface FixedCombatScenarioDocumentV1 {
  readonly kind: typeof FIXED_COMBAT_SCENARIO_DOCUMENT_KIND;
  readonly version: typeof FIXED_COMBAT_SCENARIO_DOCUMENT_VERSION;
  readonly encounter: ScenarioFixedCombatConfiguration;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}



export function stringifyFixedCombatScenarioDocument(
  encounter: ScenarioFixedCombatConfiguration,
): string {
  const document: FixedCombatScenarioDocumentV1 = {
    kind: FIXED_COMBAT_SCENARIO_DOCUMENT_KIND,
    version: FIXED_COMBAT_SCENARIO_DOCUMENT_VERSION,
    encounter,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Parse and validate against the currently selected archive before any editor state is changed. */
export function parseFixedCombatScenarioDocument(
  text: string,
  content: ImportedContentPackage,
): ScenarioFixedCombatConfiguration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Encounter JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isObject(parsed)) throw new Error("Encounter JSON must contain an object document.");
  if (parsed["kind"] !== FIXED_COMBAT_SCENARIO_DOCUMENT_KIND) {
    throw new Error(
      `Encounter JSON kind must be ${FIXED_COMBAT_SCENARIO_DOCUMENT_KIND}.`,
    );
  }
  if (parsed["version"] !== FIXED_COMBAT_SCENARIO_DOCUMENT_VERSION) {
    throw new Error(
      `Encounter JSON version must be ${FIXED_COMBAT_SCENARIO_DOCUMENT_VERSION}.`,
    );
  }
  if (!isObject(parsed["encounter"])) {
    throw new Error("Encounter JSON is missing its encounter object.");
  }
  const encounter = parsed["encounter"] as unknown as ScenarioFixedCombatConfiguration;
  try {
    // This is the same archive-aware, fail-loud validation run immediately before boot. Besides
    // structural bounds it proves every species, ability, background, Spirit, and Soul Stone.
    prepareFixedCombatScenario(content, encounter);
  } catch (error) {
    throw new Error(
      `Encounter JSON is incompatible with this content package: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return structuredClone(encounter);
}
