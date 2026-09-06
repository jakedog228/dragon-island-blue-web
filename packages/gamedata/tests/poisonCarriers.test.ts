import { describe, expect, it } from "vitest";
import { loadGameData } from "../src/loadNode.js";

const POISON_BUFF = {
  type: "Offensive.Poison",
  arguments: {
    duration: 500,
    roll: { relatedStat: "Attack" },
  },
};

function poisonPayloads(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(poisonPayloads);
  if (value === null || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [
    ...(record.type === "Offensive.Poison" ? [record] : []),
    ...Object.values(record).flatMap(poisonPayloads),
  ];
}

describe("shipped Poison carriers", () => {
  it("pins every concrete monster job slot that converges on Offensive.Poison", () => {
    const gd = loadGameData();
    const carriers = gd.allMonsters().flatMap((monster) =>
      gd.jobAbilitiesOrEmpty(monster.shortType).flatMap((ref) => {
        const payloads = [
          ...poisonPayloads(gd.ability(ref.type).raw),
          ...poisonPayloads(ref.arguments),
        ];
        if (payloads.length === 0) return [];
        expect(payloads).toEqual([POISON_BUFF]);
        return [`${monster.shortType}|${ref.slot}|${ref.type}`];
      }),
    ).sort();

    expect(new Set(carriers.map((entry) => entry.split("|", 1)[0])).size).toBe(21);
    expect(carriers).toEqual([
      "BabyNessie|Curse|Passive.Generic",
      "BloodKnight|usable1|Offensive.Poison.PoisonAttack",
      "BloodKnight|usable2|Offensive.DarkMist.DarkMistAll",
      "Bones|usable1|Offensive.Poison.PoisonAttack",
      "Bones|usable2|Offensive.Poison.PoisonAll",
      "DarkMage|usable3|Offensive.DarkMist.DarkMistAll",
      "GiantAnt|usable1|Offensive.Poison.PoisonAttack",
      "GiantWasp|usable1|Offensive.Poison.PoisonAttack",
      "KemetGod|Pharao'sCurse|Passive.Generic",
      "KemetKing|Pharao'sCurse|Passive.Generic",
      "Mutation|usable1|Offensive.Poison.PoisonAttack",
      "Pincer|usable1|Offensive.Poison.PoisonAttack",
      "Pincer|usable3|Offensive.Poison.PoisonAll",
      "SerpentKnight|usable1|Offensive.Poison.PoisonAttack",
      "SerpentKnight|usable2|Offensive.Poison.PoisonAll",
      "SerpentMage|usable1|Offensive.Poison.PoisonAttack",
      "SerpentMage|usable2|Offensive.Poison.PoisonAll",
      "SkullCrow|usable1|Offensive.Poison.PoisonAttack",
      "SkullCrow|usable2|Offensive.DarkMist.DarkMistAll",
      "SnakeGod|usable1|Offensive.Poison.PoisonAttack",
      "SnakeGod|usable2|Offensive.DarkMist.DarkMistAll",
      "SpikeCrab|usable3|Offensive.Poison.PoisonAttack",
      "SpikeMonster|usable3|Offensive.Poison.PoisonAttack",
      "SteelSnake|usable4|Offensive.DarkMist.DarkMistAll",
      "Stinger|usable1|Offensive.Poison.PoisonAttack",
      "TerrorClaw|usable1|Offensive.Poison.PoisonAttack",
      "TerrorClaw|usable3|Offensive.Poison.PoisonAttackAll",
      "TurtleKing|usable1|Offensive.Poison.PoisonAttack",
      "WaspQueen|usable1|Offensive.Poison.PoisonAttack",
      "WaspQueen|usable4|Offensive.Poison.DoublePoisonAttack",
    ]);
  });
});
