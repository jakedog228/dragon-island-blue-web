import {
  SAVE_SLOT_IDS,
  type SaveSlotId,
  type SaveSlotSummary,
} from "@dib/save-protocol";
import type { PlayerGameStateSnapshot } from "../player/gameState.js";
import type { SaveSession, SaveSlotStore } from "../player/saveStore.js";
import type { ScenarioTransport } from "./scenarioMode.js";

const SCENARIO_SLOT = SAVE_SLOT_IDS[0];
const SCENARIO_UPDATED_AT = "2000-01-01T00:00:00.000Z";
const ONLINE_SIMULATION_LATENCY_MS = 80;

/**
 * A deliberately non-persistent save adapter. The initial snapshot is retained as an immutable
 * fixture; every load gets a fresh clone and every checkpoint is discarded. It never delegates to
 * BrowserSaveConnection or OfficialAuthoritySaveStore.
 */
export class ScenarioSaveStore implements SaveSlotStore {
  private initialState: PlayerGameStateSnapshot | undefined;

  constructor(readonly transport: ScenarioTransport) {}

  installInitialState(state: PlayerGameStateSnapshot): void {
    if (this.initialState !== undefined) {
      throw new Error("Scenario save state is already installed");
    }
    this.initialState = cloneState(state);
  }


  resetInitialState(state: PlayerGameStateSnapshot): void {
    this.initialState = cloneState(state);
  }

  get slots(): readonly SaveSlotSummary[] {
    return this.initialState === undefined ? [] : [this.requireSummary()];
  }

  summary(slotId: SaveSlotId): SaveSlotSummary | undefined {
    return slotId === SCENARIO_SLOT && this.initialState !== undefined
      ? this.requireSummary()
      : undefined;
  }

  async loadSlotState(slotId: SaveSlotId): Promise<PlayerGameStateSnapshot | undefined> {
    await this.crossTransportBoundary();
    if (slotId !== SCENARIO_SLOT || this.initialState === undefined) return undefined;
    return cloneState(this.initialState);
  }

  open(slotId: SaveSlotId, preloadedState?: PlayerGameStateSnapshot): SaveSession {
    if (slotId !== SCENARIO_SLOT) throw new Error(`Scenario mode has no slot ${slotId}`);
    const initial = preloadedState ?? this.requireState();
    return {
      slotId,
      load: async () => {
        await this.crossTransportBoundary();
        return cloneState(initial);
      },
      // Scenario checkpoints intentionally disappear. In particular, this method never forwards
      // the client-authored snapshot into either browser storage or an authority command.
      save: async () => {
        await this.crossTransportBoundary();
      },
      flush: async () => {
        await this.crossTransportBoundary();
      },
    };
  }

  private requireState(): PlayerGameStateSnapshot {
    if (this.initialState === undefined) throw new Error("Scenario save state is not installed");
    return this.initialState;
  }

  private requireSummary(): SaveSlotSummary {
    this.requireState();
    return {
      slotId: SCENARIO_SLOT,
      revision: 1,
      updatedAt: SCENARIO_UPDATED_AT,
      compatible: true,
    };
  }

  private async crossTransportBoundary(): Promise<void> {
    if (this.transport !== "online") return;
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, ONLINE_SIMULATION_LATENCY_MS);
    });
  }
}

function cloneState(state: PlayerGameStateSnapshot): PlayerGameStateSnapshot {
  return structuredClone(state);
}
