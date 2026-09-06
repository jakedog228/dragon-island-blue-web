import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import {
  BattleSession,
  COMPONENT_PHASES,
  mulberry32,
  type PlayerChoice,
  type Targeting,
} from "@dib/engine";
import { GameData, loadWorldData } from "@dib/gamedata/browser";
import { describe, expect, it } from "vitest";
import { importContentArchive } from "../src/content/archivePackage.js";

const archiveSetting = process.env["DIB_TEST_CONTENT_ARCHIVE"];
const repositoryRoot = resolve(import.meta.dirname, "../../..");

const requiredSprites = [
  "MMScreen",
  "PopupMenuCloseButton-hd",
  "inBattingOrderBkg-hd",
  "notInBattingOrderBkg-hd",
  "emptySlotHeads-hd",
  "emptySlotArrows-hd",
  "orderAllLeftArrow-hd",
  "orderLeftArrow-hd",
  "orderRightArrow-hd",
  "orderAllRightArrow-hd",
  "soulStoneButton-hd",
  "sortByName-hd",
  "sortByStars-hd",
  "sortByLevel-hd",
  "destroyMonster-hd",
  "removeAllFromBattingOrder-hd",
  "bookPage",
  "leaveIcon",
  "cancelMonsterPickButton-hd",
  "sleepZ-hd",
  "confusionStatus-hd",
  "paralyzeBolt-hd",
  "downArrow-hd",
  "combatBottomBar-hd",
  "heroBattlePortrait-hd",
  "heroFrame-hd",
  "button-hd",
  "benchButton-hd",
  "retreatButton-hd",
  "delayButton-hd",
  "benchBox-hd",
  "spiritBkg-hd",
  "charscreenBackButton-hd",
  "captureCard1-hd",
  "captureCard2-hd",
  "captureCard3-hd",
  "cardGlow-hd",
  "largeRarityStar-hd",
  "monsterEvolved",
  "scrollbar-hd",
  "scrollbarTrack-hd",
  "greenFlag-hd",
  "redFlag-hd",
  "blueFlag-hd",
  "menuButton-hd",
  "namePlate-hd",
  "sunrise-hd",
  "walkArrow",
  "ipadBorder",
] as const;

const requiredAtlases = [
  "General-hd",
  "MonsterPortraits-hd",
  "MonsterpediaFrames-hd",
  "InventoryItemFrames-hd",
  "FXSheet-hd",
  "HeroWalkFrames-hd",
] as const;

const requiredFonts = ["arial_14-hd", "arial_14_bold-hd", "arial_18_bold-hd", "arial_20_bold-hd"] as const;
const requiredAudio = [
  "Encounter",
  "click",
  "notAllowed",
  "CaptureSuccess",
  "CaptureFail",
  "Escape",
  "Battle1",
  "Battle2",
  "Battle3",
  "Battle4",
  "Battle5",
  "Battle6",
  "Battle7",
  "Win1",
  "Evolve1",
] as const;

const futureResourceFamilies = [
  "Chats.plist",
  "Dialogs.plist",
  "Plot.plist",
  "Worlds.plist",
  "PointsOfInterest.plist",
  "POIConnections.plist",
  "Rooms.plist",
  "ZoneChanges.plist",
  "Towns.plist",
  "Quests.plist",
  "Tournaments.plist",
  "Dungeons.plist",
] as const;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a dictionary`);
  }
  return value as Record<string, unknown>;
}

async function pngDimensions(url: string): Promise<{ width: number; height: number }> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  if (bytes.length < 24 || String.fromCharCode(...bytes.subarray(1, 4)) !== "PNG") {
    throw new Error("resource is not a PNG");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function autoTargets(session: BattleSession, actorId: string, targeting: Targeting): string[] {
  const enemies = session.activeIdsOf(1).filter((id) => id !== actorId);
  const friends = session.activeIdsOf(0);
  switch (targeting.kind) {
    case "self":
    case "allEnemies":
    case "allFriends":
      return [];
    case "enemies":
      return enemies.slice(0, Math.min(targeting.count, enemies.length));
    case "friends":
      return friends.slice(0, Math.min(targeting.count, friends.length));
    case "mixed": {
      const enemyCount = targeting.allEnemies
        ? enemies.length
        : Math.min(targeting.enemyCount, enemies.length);
      const friendlyCount = targeting.allFriends
        ? friends.length
        : Math.min(targeting.friendlyCount, friends.length);
      return [...enemies.slice(0, enemyCount), ...friends.slice(0, friendlyCount)];
    }
  }
}

function pickChoice(gameData: GameData, choices: PlayerChoice[]): PlayerChoice | undefined {
  const usable = choices.filter((choice) => choice.blockReason === undefined);
  const damageComponents = new Set([
    "AttackAbilityComponent",
    "DamageDealingAbilityComponent",
    "DiceAbilityComponent",
    "DrainLifeAbilityComponent",
  ]);
  return (
    usable.find((choice) =>
      gameData
        .ability(choice.abilityPath)
        .components.some((component) => damageComponents.has(gameData.abilityComponent(component.type).className)),
    ) ?? usable[0]
  );
}

describe("operator-supplied runtime content archive", () => {
  it.runIf(archiveSetting !== undefined)(
    "satisfies current battle runtime roles and retains future source-shaped families",
    async () => {
      const archivePath = isAbsolute(archiveSetting!) ? archiveSetting! : resolve(repositoryRoot, archiveSetting!);
      const content = importContentArchive(new Uint8Array(readFileSync(archivePath)), archivePath);
      try {
        const gd = GameData.fromRaw({
          monsters: content.data.monsters,
          jobs: content.data.jobs,
          abilities: content.data.abilities,
          abilityComponents: content.data.abilityComponents,
          buffs: content.data.buffs,
          ...(content.data.items !== undefined ? { items: content.data.items } : {}),
        });
        const monsters = gd.allMonsters();
        expect(monsters.length).toBeGreaterThanOrEqual(18);
        for (const monster of monsters) {
          expect(content.manifest.sprites).toHaveProperty(`${monster.shortType}-hd`);
          const uses = gd.jobAbilities(monster.shortType).filter((ref) => /^usable\d+$/.test(ref.slot));
          expect(uses.length, `${monster.shortType} has no usable ability`).toBeGreaterThan(0);
          for (const use of uses) {
            const ability = gd.ability(use.type);
            expect(ability.className, use.type).toBe("CombatAbility");
            for (const component of ability.components) {
              const definition = gd.abilityComponent(component.type);
              expect(COMPONENT_PHASES[definition.className], `${use.type} -> ${component.type}`).toBeDefined();
            }
          }
        }

        for (const key of requiredSprites) expect(content.manifest.sprites, key).toHaveProperty(key);
        for (const key of requiredAtlases) expect(content.manifest.atlases, key).toHaveProperty(key);
        for (const key of requiredFonts) expect(content.manifest.fonts, key).toHaveProperty(key);
        for (const key of requiredAudio) expect(content.manifest.audio, key).toHaveProperty(key);
        expect(content.manifest.particles).toHaveProperty("PoisonParticles.plist");
        expect(content.manifest.particles).toHaveProperty("Sparkle.plist");
        expect(content.manifest.particles).toHaveProperty("progressBarParticles.plist");
        expect(content.manifest.particles).toHaveProperty("destroyMonsterParticles.plist");

        const portraits = record(content.resources.plist("MonsterPortraits-hd.plist"), "MonsterPortraits-hd");
        const portraitFrames = record(portraits["frames"], "MonsterPortraits-hd.frames");
        for (const monster of monsters) expect(portraitFrames).toHaveProperty(`${monster.shortType}_icon.png`);

        for (const family of futureResourceFamilies) {
          expect(content.resources.has(family), `missing future resource ${family}`).toBe(true);
          expect(() => content.resources.plist(family)).not.toThrow();
        }

        expect(content.worldNames.length).toBeGreaterThan(0);
        const knownMonsterTypes = new Set(monsters.map((monster) => monster.shortType));
        for (const worldName of content.worldNames) {
          const world = loadWorldData(content.resources, worldName, knownMonsterTypes);
          expect(world.pointsOfInterest.length, worldName).toBeGreaterThan(0);
          expect(content.manifest.sprites).toHaveProperty(world.map.spriteFile.slice(0, -4));
        }

        for (const key of content.combatBackgroundKeys) {
          const dimensions = await pngDimensions(content.resources.url(`${key}.png`));
          expect(dimensions.width, key).toBeGreaterThanOrEqual(1024);
          expect(dimensions.height, key).toBeGreaterThanOrEqual(768);
        }
      } finally {
        content.dispose();
      }
    },
  );

  it.runIf(archiveSetting !== undefined)(
    "constructs and completes a deterministic battle from imported game data",
    () => {
      const archivePath = isAbsolute(archiveSetting!) ? archiveSetting! : resolve(repositoryRoot, archiveSetting!);
      const content = importContentArchive(new Uint8Array(readFileSync(archivePath)), archivePath);
      try {
        const gameData = GameData.fromRaw({
          monsters: content.data.monsters,
          jobs: content.data.jobs,
          abilities: content.data.abilities,
          abilityComponents: content.data.abilityComponents,
          buffs: content.data.buffs,
          ...(content.data.items !== undefined ? { items: content.data.items } : {}),
        });
        const roster = gameData.allMonsters().slice(0, 12);
        expect(roster).toHaveLength(12);

        const session = new BattleSession(
          gameData,
          [
            roster.slice(0, 6).map((monster) => ({ shortType: monster.shortType, level: 12 })),
            roster.slice(6, 12).map((monster) => ({ shortType: monster.shortType, level: 12 })),
          ],
          mulberry32(0xc1eade),
          { fightingGroupSize: 3 },
        );

        const maximumSteps = 500;
        let report: Extract<ReturnType<BattleSession["advance"]>, { type: "ended" }>["report"] | undefined;
        for (let stepNumber = 0; stepNumber < maximumSteps; stepNumber++) {
          const step = session.advance();
          if (step.type === "ended") {
            report = step.report;
            break;
          }
          if (step.type !== "awaitingPlayer") continue;
          const choice = pickChoice(gameData, step.choices);
          if (choice === undefined) {
            session.submitDelayAction();
            continue;
          }
          session.submitPlayerAction(choice.slot, autoTargets(session, step.actorId, choice.targeting));
        }

        expect(report, `battle did not terminate within ${maximumSteps} steps`).toBeDefined();
        expect([0, 1]).toContain(report!.winner);
        expect(report!.events.length).toBeGreaterThan(0);
      } finally {
        content.dispose();
      }
    },
  );
});
