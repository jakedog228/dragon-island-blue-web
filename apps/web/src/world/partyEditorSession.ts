// Transient ordering model for editable MonsterManagementNode styles 0/1.
//
// The native node copies the compact Player roster into a fixed nullable batting array plus a
// local reserve array. Arrow/drag/sort/Remove-All operations mutate only those copies. Explicit
// close compacts the nonnil batting IDs and submits that priority to Player; forced teardown
// discards the copies. Permanent transactions (destroy/convert/equip/heal) remain domain-owned
// and reconcile this session by stable instance ID.

export type PartyEditorSlotId = string | undefined;

export class PartyEditorSession {
  private readonly slots: PartyEditorSlotId[];
  private readonly reserves: string[];
  private selectedBatting = 0;
  private selectedReserve = 0;

  constructor(
    readonly battingCapacity: number,
    activeIds: readonly string[],
    reserveIds: readonly string[],
  ) {
    if (!Number.isInteger(battingCapacity) || battingCapacity < 0) {
      throw new Error(
        `PartyEditorSession: battingCapacity must be a non-negative integer; got ${battingCapacity}`,
      );
    }
    if (activeIds.length > battingCapacity) {
      throw new Error(
        `PartyEditorSession: ${activeIds.length} active IDs exceed capacity ${battingCapacity}`,
      );
    }
    const allIds = [...activeIds, ...reserveIds];
    const seen = new Set<string>();
    for (const id of allIds) {
      if (id.length === 0) throw new Error("PartyEditorSession: instance ID must not be empty");
      if (seen.has(id)) throw new Error(`PartyEditorSession: duplicate instance ID ${id}`);
      seen.add(id);
    }
    this.slots = Array.from(
      { length: battingCapacity },
      (_, index) => activeIds[index],
    );
    this.reserves = [...reserveIds];
  }

  battingSlotIds(): readonly PartyEditorSlotId[] {
    return [...this.slots];
  }

  reserveOrderIds(): readonly string[] {
    return [...this.reserves];
  }

  compactActiveIds(): readonly string[] {
    return this.slots.filter((id): id is string => id !== undefined);
  }

  freeSpace(): number {
    return this.slots.filter((id) => id === undefined).length;
  }

  selectedBattingIndex(): number {
    return this.selectedBatting;
  }

  selectedReserveIndex(): number {
    return this.selectedReserve;
  }

  setSelections(battingIndex: number, reserveVisualIndex: number): void {
    this.selectedBatting = clampIndex(battingIndex, this.slots.length);
    this.selectedReserve = clampIndex(reserveVisualIndex, this.reserves.length + 1);
  }

  canMoveBatting(fromIndex: number, delta: number): boolean {
    if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= this.slots.length) {
      return false;
    }
    if (this.slots[fromIndex] === undefined || !Number.isInteger(delta)) return false;
    const target = clamp(fromIndex + delta, 0, this.slots.length - 1);
    return target !== fromIndex;
  }

  moveBatting(fromIndex: number, delta: number): number {
    if (!this.canMoveBatting(fromIndex, delta)) return fromIndex;
    const target = clamp(fromIndex + delta, 0, this.slots.length - 1);
    const [moved] = this.slots.splice(fromIndex, 1);
    this.slots.splice(target, 0, moved);
    this.selectedBatting = target;
    return target;
  }

  moveBattingToReserve(fromIndex: number, reserveVisualBoundary: number): boolean {
    this.assertBattingIndex(fromIndex, "moveBattingToReserve");
    const moved = this.slots[fromIndex];
    if (moved === undefined) return false;
    if (!Number.isInteger(reserveVisualBoundary)) {
      throw new Error(
        `PartyEditorSession.moveBattingToReserve: reserve boundary must be an integer; got ${reserveVisualBoundary}`,
      );
    }
    const boundary = clamp(reserveVisualBoundary, 0, this.reserves.length);
    this.reserves.splice(boundary, 0, moved);
    this.slots[fromIndex] = undefined;
    this.selectedBatting = fromIndex;


    this.selectedReserve = boundary;
    return true;
  }

  moveReserveToBatting(reserveIndex: number, targetSlot: number): boolean {
    if (this.freeSpace() === 0) return false;
    if (!Number.isInteger(reserveIndex) || reserveIndex < 0 || reserveIndex >= this.reserves.length) {
      throw new Error(
        `PartyEditorSession.moveReserveToBatting: reserveIndex out of range [0, ${this.reserves.length}); got ${reserveIndex}`,
      );
    }
    this.assertBattingIndex(targetSlot, "moveReserveToBatting");
    const moved = this.reserves[reserveIndex]!;
    if (this.slots[targetSlot] === undefined) {
      this.slots[targetSlot] = moved;
    } else {
      const firstNil = this.slots.indexOf(undefined);
      if (firstNil < 0) return false;
      this.slots[firstNil] = moved;
      const [inserted] = this.slots.splice(firstNil, 1);
      this.slots.splice(targetSlot, 0, inserted);
    }
    this.reserves.splice(reserveIndex, 1);
    this.selectedBatting = targetSlot;
    this.selectedReserve = clampIndex(reserveIndex + 1, this.reserves.length + 1);
    return true;
  }

  sortReserves(compareIds: (leftId: string, rightId: string) => number): void {
    this.reserves.sort(compareIds);
    this.selectedReserve = clampIndex(this.selectedReserve, this.reserves.length + 1);
  }

  removeAll(compareIds: (leftId: string, rightId: string) => number): boolean {
    let moved = false;
    for (let index = 0; index < this.slots.length; index += 1) {
      const id = this.slots[index];
      if (id === undefined) continue;
      this.reserves.push(id);
      this.slots[index] = undefined;
      moved = true;
    }
    if (!moved) return false;
    this.reserves.sort(compareIds);
    this.selectedBatting = 0;
    this.selectedReserve = 0;
    return true;
  }

  removeMonster(instanceId: string): void {
    const slot = this.slots.indexOf(instanceId);
    if (slot >= 0) this.slots[slot] = undefined;
    const reserve = this.reserves.indexOf(instanceId);
    if (reserve >= 0) this.reserves.splice(reserve, 1);
    this.selectedBatting = clampIndex(this.selectedBatting, this.slots.length);
    this.selectedReserve = clampIndex(this.selectedReserve, this.reserves.length + 1);
  }

  private assertBattingIndex(index: number, operation: string): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.slots.length) {
      throw new Error(
        `PartyEditorSession.${operation}: batting index out of range [0, ${this.slots.length}); got ${index}`,
      );
    }
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampIndex(value: number, count: number): number {
  if (count <= 0) return 0;
  return clamp(Number.isInteger(value) ? value : 0, 0, count - 1);
}
