import { describe, expect, it } from "vitest";
import {
  backupSlotRowView,
  parseSlotChoice,
  saveBackupPanelCapabilities,
} from "../src/content/saveBackupPanelMath.js";
import { saveHealthBannerView } from "../src/ui/saveHealthBannerMath.js";
import type { SaveHealthState } from "../src/player/saveHealth.js";

const formatStamp = (iso: string): string => `@${iso}`;
const summary = { slotId: "slot-1", revision: 4, updatedAt: "T1", compatible: true } as const;

describe("backup slot rows", () => {
  it("reads an empty slot as unusable in both directions", () => {
    expect(backupSlotRowView({ formatStamp })).toEqual({
      detail: "Empty",
      canExport: false,
      canRollBack: false,
      rollBackTitle: "No earlier revision is retained for this slot",
    });
  });

  it("locks a slot bound to a different archive", () => {
    const view = backupSlotRowView({
      summary: { ...summary, compatible: false },
      formatStamp,
    });
    expect(view).toMatchObject({
      detail: "Bound to a different archive",
      canExport: false,
      canRollBack: false,
    });
  });

  it("prefers the decoded preview over the bare revision", () => {
    const view = backupSlotRowView({
      summary,
      preview: { heroLevel: 12, partySize: 3, partyTopLevel: 14 },
      formatStamp,
    });
    expect(view.detail).toBe("Level 12 · 3 in party · @T1");
    expect(view.canExport).toBe(true);
  });

  it("still allows exporting a slot whose state will not decode", () => {
    const view = backupSlotRowView({ summary, unreadable: true, formatStamp });
    expect(view.detail).toBe("Revision 4 (unreadable) · @T1");
    // Exporting the raw envelope is precisely what a recovery attempt needs.
    expect(view.canExport).toBe(true);
  });

  it("enables rollback only when a previous revision is retained", () => {
    expect(backupSlotRowView({ summary, formatStamp }).canRollBack).toBe(false);
    const view = backupSlotRowView({
      summary,
      previous: { revision: 3, updatedAt: "T0" },
      formatStamp,
    });
    expect(view.canRollBack).toBe(true);
    expect(view.rollBackTitle).toBe("Roll back to revision 3 from @T0");
  });
});

describe("storage settings capabilities", () => {
  it("keeps Offline recovery controls local", () => {
    expect(saveBackupPanelCapabilities("offline")).toEqual({
      canImport: true,
      canRollBack: true,
      requestsPersistentStorage: true,
    });
  });

  it("makes Online settings strictly export-only", () => {
    expect(saveBackupPanelCapabilities("online")).toEqual({
      canImport: false,
      canRollBack: false,
      requestsPersistentStorage: false,
    });
  });
});

describe("import slot choice", () => {
  it("maps 1..3 onto the source slot ids", () => {
    expect(parseSlotChoice("1")).toBe("slot-1");
    expect(parseSlotChoice(" 3 ")).toBe("slot-3");
  });

  it("treats cancel and an empty answer as no choice", () => {
    expect(parseSlotChoice(null)).toBeUndefined();
    expect(parseSlotChoice("   ")).toBeUndefined();
  });

  it("rejects out-of-range and non-numeric answers rather than guessing a slot", () => {
    expect(() => parseSlotChoice("0")).toThrow(/no slot 0/);
    expect(() => parseSlotChoice("4")).toThrow(/no slot 4/);
    expect(() => parseSlotChoice("two")).toThrow(/not a slot number/);
    expect(() => parseSlotChoice("1.5")).toThrow(/not a slot number/);
  });
});

describe("save health banner view", () => {
  const failing = (over: Partial<SaveHealthState> = {}): SaveHealthState => ({
    healthy: false,
    consecutiveFailures: 1,
    conflicted: false,
    detail: "Could not save slot-1: disk full",
    ...over,
  });

  it("stays hidden while saves are landing", () => {
    const view = saveHealthBannerView(
      { healthy: true, consecutiveFailures: 0, conflicted: false },
      true,
    );
    expect(view).toMatchObject({ visible: false, actionVisible: false });
  });

  it("shows the failure detail and counts repeats after the first", () => {
    expect(saveHealthBannerView(failing(), false).text).toBe("Could not save slot-1: disk full");
    expect(saveHealthBannerView(failing({ consecutiveFailures: 4 }), false).text)
      .toBe("Could not save slot-1: disk full (4 failed saves)");
  });

  it("offers take-over only for a conflict the host can actually resolve", () => {
    expect(saveHealthBannerView(failing({ conflicted: true }), true).actionVisible).toBe(true);
    // No recovery hook (e.g. a session without adoptStoredRevision): do not offer the button.
    expect(saveHealthBannerView(failing({ conflicted: true }), false).actionVisible).toBe(false);
    // A quota failure is not fixed by taking the slot over, so the destructive action stays away.
    expect(saveHealthBannerView(failing(), true).actionVisible).toBe(false);
  });

  it("styles a conflict differently from an outright failure", () => {
    expect(saveHealthBannerView(failing({ conflicted: true }), true).conflictStyle).toBe(true);
    expect(saveHealthBannerView(failing(), true).conflictStyle).toBe(false);
  });

  it("falls back to generic text when no detail was recorded", () => {
    const view = saveHealthBannerView(
      { healthy: false, consecutiveFailures: 1, conflicted: false },
      false,
    );
    expect(view.text).toBe("Saving failed.");
  });
});
