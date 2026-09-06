


import { loadGameData } from "@dib/gamedata";
import { parseAbilityArgument } from "../src/abilityArgs.js";

const IMPLEMENTED = new Set([
  "AttackAbilityComponent",
  "DamageDealingAbilityComponent",
  "HealingAbilityComponent",
]);
const DAMAGE_CLASSES = new Set(["AttackAbilityComponent", "DamageDealingAbilityComponent"]);
const BUFF_KEYS = ["sourceBuffs", "enemyBuffs", "passiveBuffs"] as const;

const gd = loadGameData();

for (const m of gd.allMonsters()) {
  const refs = gd.jobAbilitiesOrEmpty(m.shortType);
  if (refs.length === 0) continue;

  if (!refs.every((r) => /^usable\d+$/.test(r.slot))) continue; // criterion 1

  let ok = true;
  let hasSelectableDamage = false;
  for (const r of refs) {
    const ability = gd.ability(r.type);
    const argComponents = Array.isArray(r.arguments["components"])
      ? (r.arguments["components"] as Array<{ type: string }>)
      : [];
    const merged = [...ability.components, ...argComponents].map(
      (c) => gd.abilityComponent(c.type).className,
    );
    if (!merged.every((cls) => IMPLEMENTED.has(cls))) ok = false; // criterion 2
    if (BUFF_KEYS.some((k) => ability.raw[k] !== undefined || r.arguments[k] !== undefined)) {
      ok = false; // criterion 3 (both locations)
    }
    if (r.arguments["targetPriorityAdjustment"] !== undefined) ok = false; // criterion 4
    const slot = Number(/^usable(\d+)$/.exec(r.slot)![1]);
    if (slot >= 1 && ability.className === "CombatAbility" && merged.some((cls) => DAMAGE_CLASSES.has(cls))) {
      hasSelectableDamage = true; // criterion 5
    }
    try {
      const weight = parseAbilityArgument(r.arguments["activationLength"] ?? ability.activationLength);
      if (slot >= 1 && weight <= 0) ok = false; // criterion 6 (zero weight)
    } catch {
      ok = false; // criterion 6 (malformed tier)
    }
  }
  if (!ok || !hasSelectableDamage) continue;

  console.log(
    `${m.shortType}\tstars=${m.stars}\telement=${m.element}\tabilities=${refs
      .map((r) => `${r.slot}:${r.type}`)
      .join(",")}`,
  );
}
