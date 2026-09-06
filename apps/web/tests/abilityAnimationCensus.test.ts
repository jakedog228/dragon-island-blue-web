


import { describe, expect, it } from "vitest";
import { loadGameData } from "@dib/gamedata";

const gd = loadGameData();

type Phase = "friends" | "enemy";
const PHASE_KEYS: readonly [Phase, string][] = [
  ["friends", "friendlyTargetEventData"],
  ["enemy", "enemyTargetEventData"],
];


const UNCONDITIONALLY_THROWS: ReadonlySet<string> = new Set([]);

function recordOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function effectBuildersOf(eventData: Record<string, unknown>, key: string): unknown[] {
  const builders = recordOf(eventData[key])["effectBuilders"];
  return Array.isArray(builders) ? builders : [];
}

interface Finding {
  /** `abilityPath#phase` -- e.g. "Utility.Desoul#friends". */
  key: string;
  abilityPath: string;
  phase: Phase;
  /** Job-authored `instanceName`s (the in-game move name) that reach this exact gap. */
  moveNames: string[];
  monsters: string[];
  componentClasses: string[];
}


function censusFindings(): Finding[] {
  const findings = new Map<string, Finding>();
  for (const monster of gd.allMonsters()) {
    for (const ref of gd.jobAbilitiesOrEmpty(monster.shortType)) {
      const ability = gd.ability(ref.type);
      const argComponentRefs = Array.isArray(ref.arguments["components"])
        ? (ref.arguments["components"] as Array<{ type: string }>)
        : [];
      const classNames = [...argComponentRefs, ...ability.components].map(
        (c) => gd.abilityComponent(c.type).className,
      );
      const eventData = recordOf(ability.raw["eventData"]);

      for (const [phase, key] of PHASE_KEYS) {
        const builders = effectBuildersOf(eventData, key);
        if (builders.length === 0) continue;
        const throwers = classNames.filter((c) => UNCONDITIONALLY_THROWS.has(c));
        if (throwers.length === 0) continue; // phaseResolved's fallback covers everything else
        const instanceName = typeof ref.arguments["instanceName"] === "string"
          ? (ref.arguments["instanceName"] as string)
          : ref.type;
        const findingKey = `${ability.path}#${phase}`;
        const existing = findings.get(findingKey);
        if (existing) {
          if (!existing.moveNames.includes(instanceName)) existing.moveNames.push(instanceName);
          if (!existing.monsters.includes(monster.shortType)) existing.monsters.push(monster.shortType);
        } else {
          findings.set(findingKey, {
            key: findingKey,
            abilityPath: ability.path,
            phase,
            moveNames: [instanceName],
            monsters: [monster.shortType],
            componentClasses: throwers,
          });
        }
      }
    }
  }
  return [...findings.values()].sort((a, b) => a.key.localeCompare(b.key));
}


const KNOWN_GAPS: readonly string[] = [];

describe("ability animation census (every move's declared effectBuilders vs what actually renders)", () => {
  it("matches the currently-known set of moves whose animation silently never plays", () => {
    const findings = censusFindings();
    const foundKeys = findings.map((f) => f.key).sort();
    const expectedKeys = [...KNOWN_GAPS].sort();
    if (JSON.stringify(foundKeys) !== JSON.stringify(expectedKeys)) {
      const details = findings
        .map((f) => `  ${f.key} -- moves [${f.moveNames.join(", ")}] on [${f.monsters.join(", ")}] (components: ${f.componentClasses.join(", ") || "none"})`)
        .join("\n");
      throw new Error(
        "Ability animation census mismatch.\n" +
          "This means either a NEW move silently lost its animation (a data change added an " +
          "effectBuilders array to a phase containing a component that unconditionally throws " +
          "before reaching notifyPhaseResolved -- see UNCONDITIONALLY_THROWS), or a KNOWN gap got " +
          "fixed and this file's KNOWN_GAPS list is now stale (remove the fixed entry).\n" +
          `Expected: ${JSON.stringify(expectedKeys)}\n` +
          `Found:    ${JSON.stringify(foundKeys)}\n` +
          `Details:\n${details}`,
      );
    }
    expect(foundKeys).toEqual(expectedKeys);
  });

  it("sanity: the census actually walks a substantial number of real job abilities", () => {
    let total = 0;
    for (const monster of gd.allMonsters()) total += gd.jobAbilitiesOrEmpty(monster.shortType).length;
    expect(total).toBeGreaterThan(200);
  });
});
