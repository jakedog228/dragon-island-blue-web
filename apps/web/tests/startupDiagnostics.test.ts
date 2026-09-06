import { describe, expect, it, vi } from "vitest";
import { StartupDiagnostics } from "../src/startup/startupDiagnostics.js";

describe("StartupDiagnostics", () => {
  it("publishes defensive serializable snapshots", () => {
    const diagnostics = new StartupDiagnostics();
    const listener = vi.fn();
    const unsubscribe = diagnostics.subscribe(listener);
    diagnostics.update({ phase: "title" });
    diagnostics.patch({ dots: " 98%" });
    unsubscribe();
    diagnostics.update({ phase: "launching", selectedSlot: "slot-1" });

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls[1]![0]).toEqual({ phase: "title" });
    expect(listener.mock.calls[2]![0]).toEqual({ phase: "title", dots: " 98%" });
  });

  it("carries session-scoped durability fields across phase replacement", () => {
    const diagnostics = new StartupDiagnostics();
    diagnostics.patch({ storage: "Save storage is persistent.", saveHealth: "saves OK" });
    // `update` deliberately replaces phase-scoped fields, but "are saves durable and landing?"
    // stays true across every phase and must survive.
    diagnostics.update({ phase: "save-select", selectedSlot: "slot-2" });

    expect(diagnostics.snapshot()).toEqual({
      phase: "save-select",
      selectedSlot: "slot-2",
      storage: "Save storage is persistent.",
      saveHealth: "saves OK",
    });

    diagnostics.patch({ saveHealth: "FAILING: conflict x2" });
    diagnostics.update({ phase: "complete" });
    expect(diagnostics.snapshot()).toMatchObject({
      phase: "complete",
      saveHealth: "FAILING: conflict x2",
    });
  });
});
