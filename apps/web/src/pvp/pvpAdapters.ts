import { requirePvpAdapters, type PvpAdapterIdentity, type PvpBattleAdapter, type PvpIntent, type PvpTurn, type RestoredPvpBattle } from "@dib/engine";
import type { Container } from "pixi.js";
import type { LoadedGame } from "../loadGame.js";

export interface PvpClientAdapterContext {
  readonly game: LoadedGame;
  readonly battle: RestoredPvpBattle;
  readonly turn: PvpTurn;
  readonly you: 0 | 1;
}
export interface PvpAdapterControl {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly input: PvpIntent;
  readonly disabled?: boolean;
}
export interface PvpClientAdapter {
  readonly rules: PvpBattleAdapter;
  readonly label?: string;
  controls?(context: PvpClientAdapterContext): readonly PvpAdapterControl[];
  /** Optional custom canvas input. Installed only on your turn; dispose on redraw/commit/exit. */
  mount?(context: PvpClientAdapterContext & {
    readonly root: Container;
    readonly width: number;
    readonly height: number;
    readonly controlsTop: number;
    readonly targets: ReadonlyMap<string, { x: number; y: number }>;
    submit(command: string, input: PvpIntent): void;
    back(): void;
  }): () => void;
}

const registered = new Map<string, PvpClientAdapter>();

/** Call during a mod's activation and give the returned cleanup to ctx.onDispose. */
export function registerPvpAdapter(adapter: PvpClientAdapter): () => void {
  if (registered.has(adapter.rules.rulesId)) throw new Error(`PvP adapter already registered: ${adapter.rules.rulesId}`);
  // Dependency/order checks run against the complete negotiated profile on resolution.
  requirePvpAdapters([{ rulesId: adapter.rules.rulesId, digest: adapter.rules.digest }], [
    { ...adapter.rules, requires: [], conflicts: [] },
  ]);
  registered.set(adapter.rules.rulesId, adapter);
  return () => { if (registered.get(adapter.rules.rulesId) === adapter) registered.delete(adapter.rules.rulesId); };
}

export function resolvePvpClientAdapters(identities: readonly PvpAdapterIdentity[]): readonly PvpClientAdapter[] {
  const selected = identities.map((identity) => {
    const adapter = registered.get(identity.rulesId);
    if (!adapter) throw new Error(`Missing PvP client adapter ${identity.rulesId}. Enable the reviewed mod release used by this match.`);
    return adapter;
  });
  requirePvpAdapters(identities, selected.map((adapter) => adapter.rules));
  return selected;
}
