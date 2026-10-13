import type { GameData } from "@dib/gamedata";
import type { BattleSession } from "./session.js";
import type { PvpCommand, PvpDecision } from "./pvp.js";

export const PVP_ADAPTER_API = "pvp-adapter-v1" as const;
export type PvpIntentScalar = string | number | boolean;
/** Small semantic inputs, not snapshots, damage, clocks or random outcomes. */
export type PvpIntent = Readonly<Record<string, PvpIntentScalar | readonly PvpIntentScalar[]>>;
export interface PvpAdapterIdentity {
  readonly rulesId: string;
  /** SHA-256 of the shared, immutable rules artifact. */
  readonly digest: string;
}
export type PvpTurn = Extract<PvpDecision, { type: "turn" }>;
export interface PvpAdapterCommand {
  /** Must reject unknown fields, invalid types and out-of-range inputs. Runs before execute. */
  parse(input: PvpIntent): unknown;
  /** Resolve exactly one complete turn, using session methods and the supplied recorded RNG. */
  execute(input: unknown, turn: PvpTurn): void;
}
export interface PvpBattleAdapterInstance {
  readonly commands?: Readonly<Record<string, PvpAdapterCommand>>;
  /** Ordered observers/guards; use instance-local state, never global prototype patches. */
  beforeCommand?(command: PvpCommand, turn: PvpTurn): void;
  afterCommand?(command: PvpCommand, turn: PvpTurn): void;
  /** Rebuilt by replay; read by the local presentation, never accepted from the player. */
  state?(): PvpIntent;
}
export interface PvpBattleAdapter extends PvpAdapterIdentity {
  readonly apiVersion: typeof PVP_ADAPTER_API;
  /** Dependencies must precede this adapter. Profiles explicitly approve the complete order. */
  readonly requires?: readonly string[];
  readonly conflicts?: readonly string[];
  create(context: {
    readonly data: GameData;
    readonly session: BattleSession;
    readonly random: () => number;
  }): PvpBattleAdapterInstance;
}

export function validatePvpAdapters(adapters: readonly PvpBattleAdapter[]): void {
  if (adapters.length > 64) throw new Error("Too many PvP adapters");
  const seen = new Set<string>();
  const all = new Set(adapters.map((adapter) => adapter.rulesId));
  for (const adapter of adapters) {
    if (adapter.apiVersion !== PVP_ADAPTER_API || !/^[A-Za-z0-9_.:-]{1,160}$/.test(adapter.rulesId) ||
        !/^[a-f0-9]{64}$/.test(adapter.digest) || typeof adapter.create !== "function") {
      throw new Error("Invalid PvP adapter identity or API version");
    }
    if (seen.has(adapter.rulesId)) throw new Error(`Duplicate PvP adapter ${adapter.rulesId}`);
    for (const required of adapter.requires ?? []) {
      if (!seen.has(required)) throw new Error(`${adapter.rulesId} requires preceding adapter ${required}`);
    }
    for (const conflict of adapter.conflicts ?? []) {
      if (all.has(conflict)) throw new Error(`${adapter.rulesId} conflicts with ${conflict}`);
    }
    seen.add(adapter.rulesId);
  }
}

export function requirePvpAdapters(
  identities: readonly PvpAdapterIdentity[], adapters: readonly PvpBattleAdapter[],
): void {
  validatePvpAdapters(adapters);
  if (identities.length !== adapters.length || identities.some((identity, index) =>
    identity.rulesId !== adapters[index]?.rulesId || identity.digest !== adapters[index]?.digest)) {
    throw new Error("This match requires its original ordered PvP adapters and exact rules digests.");
  }
}
