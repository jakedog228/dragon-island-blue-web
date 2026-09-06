import { loadGameData } from "@dib/gamedata";
const data: any = (loadGameData as any)();
const seen = new Map<string, any>();
for (const m of data.allMonsters()) {
  for (const ref of data.jobAbilitiesOrEmpty(m.shortType)) {
    if (!/^usable\d+$/.test(ref.slot)) continue;
    const ability = data.ability(ref.type);
    if (ability.className !== "CombatAbility") continue;
    const tp: any = ability.targetPicker ?? {};
    const enemySide = tp.allEnemies === true || (typeof tp.enemyTargets === "number" && tp.enemyTargets >= 1);
    if (!enemySide || tp.selfOnly === true) continue;
    const key = JSON.stringify({ t: ref.type, a: ref.arguments });
    if (!seen.has(key)) seen.set(key, { type: ref.type, args: ref.arguments, name: ref.arguments["instanceName"], tp });
  }
}
console.log("pool size", seen.size);
for (const v of seen.values()) console.log(v.name, "|", v.type, "|", JSON.stringify(v.args));
