


import { describe, expect, it } from "vitest";
import { PlayerProfile } from "../src/playerProfile.js";

function profile(spiritReadiness = 0): PlayerProfile {
  return new PlayerProfile({
    heroLevel: 3,
    monsterPartyLevels: [1],
    silver: 0,
    gold: 0,
    captureCards: { 1: 0, 2: 0, 3: 0 },
    spiritReadiness,
  });
}

function recorded(player: PlayerProfile): Array<[string, number]> {
  const seen: Array<[string, number]> = [];
  player.setSpiritExperienceListener((shortType, amount) => { seen.push([shortType, amount]); });
  return seen;
}

describe("spirit experience quest-event seam", () => {
  it("reports a totem pickup, awarding 1 the first time and 100 afterwards", () => {
    const player = profile();
    const seen = recorded(player);


    expect(player.awardSpiritTotem("Resistance")).toMatchObject({ firstTime: true, savedXpAfter: 1 });
    expect(player.awardSpiritTotem("Resistance")).toMatchObject({ firstTime: false, savedXpAfter: 101 });
    expect(seen).toEqual([["Resistance", 1], ["Resistance", 100]]);
  });

  it("reports a spirit summon's 33 saved XP", () => {
    const player = profile(1);
    player.awardSpiritTotem("Resistance");
    const seen = recorded(player);

    expect(player.useSpirit("Resistance")).toEqual({ savedXpBefore: 1, savedXpAfter: 34 });
    expect(seen).toEqual([["Resistance", 33]]);
  });

  it("keeps every award route on one seam so a single listener covers them all", () => {
    const player = profile(1);
    const seen = recorded(player);
    player.awardSpiritTotem("Resistance");
    player.awardSpiritTotem("Resistance");
    player.useSpirit("Resistance");
    expect(seen.map(([type]) => type)).toEqual(["Resistance", "Resistance", "Resistance"]);
    expect(player.spiritSavedXp("Resistance")).toBe(1 + 100 + 33);
  });

  it("does not report when restoring a saved profile's spirit XP", () => {
    const source = profile();
    source.awardSpiritTotem("Resistance");
    const snapshot = source.stateSnapshot();

    const restored = PlayerProfile.fromStateSnapshot(snapshot, [1]);
    const seen = recorded(restored);
    expect(seen).toEqual([]);
    expect(restored.spiritSavedXp("Resistance")).toBe(1);
  });
});
