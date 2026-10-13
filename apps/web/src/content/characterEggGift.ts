import { goldEggMonsterLevel, type Rng } from "@dib/engine";
import { CONTENT_SCALE_FACTOR, type FixedStage } from "@dib/renderer";
import { Container } from "pixi.js";
import type { AudioPlayer } from "../audio.js";
import type { LoadedGame } from "../loadGame.js";
import type { PlayerRuntimeState } from "../player/playerRuntimeState.js";
import { EggHatchFlow } from "../world/eggHatchFlow.js";

/** Generic Offline lifecycle payload, before any scene can start its entry dialogue. */
export interface PlayerReadyContext {
  readonly player: PlayerRuntimeState;
  readonly game: LoadedGame;
  readonly stage: FixedStage;
  readonly audio: AudioPlayer;
  readonly rng: Rng;
  readonly nextMonsterInstanceId: (shortType: string) => string;
  readonly checkpoint: () => Promise<void>;
  readonly reveal: () => Promise<void>;
  readonly setDebugState: (read: (() => unknown) | undefined) => void;
}

const pending = new WeakMap<PlayerRuntimeState, Set<string>>();

/** Authored character-mod policy; ordinary Egg mechanics and pools remain unchanged. */
export async function offerCharacterEgg(
  context: PlayerReadyContext,
  modId: string,
  shortType: string,
): Promise<void> {
  const { player } = context;
  const party = player.party;
  if (party === undefined) return;
  const flag = `mod:${modId}:character-egg:${shortType}`;
  if (player.profile.hasTutorialFlag(flag)) return;
  const members = party.monsters();
  const alreadyOwned = members.some(member =>
    member.shortType === shortType || member.soulStone?.sourceType === shortType) ||
    party.ownedSoulStoneEntries().some(({ stone }) => stone.sourceType === shortType);
  if (alreadyOwned) {
    player.profile.claimTutorialFlag(flag);
    await context.checkpoint();
    return;
  }
  const active = pending.get(player) ?? new Set<string>();
  if (active.has(flag)) return;
  active.add(flag);
  pending.set(player, active);
  let flow: EggHatchFlow | undefined;
  let pointRoot: Container | undefined;
  try {
    // Fail before presentation if the registering package omitted its definition.
    context.game.gd.monsterByShortType(shortType);
    // No world notification host exists yet. The Egg is authored in Cocos points, while
    // FixedStage.root is in 2x stage pixels, for both supported display tiers.
    pointRoot = new Container();
    pointRoot.label = "characterEggGift";
    pointRoot.scale.set(CONTENT_SCALE_FACTOR);
    context.stage.root.addChild(pointRoot);
    flow = await EggHatchFlow.show({
      parent: pointRoot,
      owner: pointRoot,
      game: context.game,
      audio: context.audio,
      ticker: context.stage.app.ticker,
      player,
      rng: context.rng,
      kind: "gold",
      allowSecondSpin: false,
      scriptedProviders: [{ kind: "monster", shortType,
        level: goldEggMonsterLevel(members.map(member => member.level)), prizeMonster: false }],
      nextMonsterInstanceId: context.nextMonsterInstanceId,
      // Keep OR feed consumes the gift. Interrupted, unclaimed reels are offered on reload.
      onStateChanged: () => { player.profile.claimTutorialFlag(flag); },
      openGoldStore: async () => { throw new Error("A character gift has no paid repeat"); },
    });
    context.setDebugState(() => ({ character: shortType, eggHatch: flow!.debugState }));
    await context.reveal();
    await flow.finished;
    await context.checkpoint();
  } finally {
    context.setDebugState(undefined);
    flow?.dispose();
    pointRoot?.removeFromParent();
    pointRoot?.destroy({ children: true });
    active.delete(flag);
  }
}
