


import type { Rng } from "./rng.js";
import { applyMod } from "./fmath.js";

const f = Math.fround;


export function initialBattleDelay(speed: number, rng: Rng): number {
  const b = f(speed / -300); // (float)speed / -300.0f
  const base = applyMod(100, b);
  const u = rng.next(); // exactly ONE draw; U in [0,1)
  return f(base + f(u * 10));
}


export function abilityTimeCost(activationLength: number, haste: number, noHaste: boolean): number {
  if (noHaste) return activationLength;
  return Math.trunc(applyMod(activationLength, haste));
}


export type AbilityPhaseIndex = 0 | 1 | 2;


export class AbilityPhaseScheduler {
  private readonly countdownsVal: [number, number, number];
  private readonly completedVal: [boolean, boolean, boolean];

  constructor(
    countdowns: readonly [number, number, number],
    eligible: readonly [boolean, boolean, boolean] = [true, true, true],
  ) {
    this.countdownsVal = [f(countdowns[0]), f(countdowns[1]), f(countdowns[2])];
    this.completedVal = [!eligible[0], !eligible[1], !eligible[2]];
  }

  /**
   * Subtract elapsed float32 time from all slots, mark at most one eligible overdue slot
   * complete, and return that phase for dispatch. Equal countdowns retain the lower index.
   */
  advance(elapsed: number): AbilityPhaseIndex | undefined {
    const delta = f(elapsed);
    for (let i = 0; i < 3; i++) {
      this.countdownsVal[i] = f((this.countdownsVal[i] as number) - delta);
    }

    let selected: AbilityPhaseIndex | undefined;
    let selectedCountdown = 0;
    for (let i = 0; i < 3; i++) {
      const phase = i as AbilityPhaseIndex;
      const countdown = this.countdownsVal[phase];
      if (this.completedVal[phase] || countdown > 0) continue;
      if (selected === undefined || selectedCountdown > countdown) {
        selected = phase;
        selectedCountdown = countdown;
      }
    }

    if (selected !== undefined) this.completedVal[selected] = true;
    return selected;
  }

  snapshot(): {
    countdowns: readonly [number, number, number];
    completed: readonly [boolean, boolean, boolean];
  } {
    return {
      countdowns: [...this.countdownsVal],
      completed: [...this.completedVal],
    };
  }
}

export class TimedQueue<T> {
  /** Sorted ascending by `times_`; ties broken by stable insertion order (§0). */
  private itemsArr: T[] = [];
  /** Parallel to `itemsArr` — absolute integer queue times. */
  private timesArr: number[] = [];
  /** `-[TimedQue init]` zero-fills the struct (TimedQue.txt:1) — baseline starts at 0. */
  private timeAtFrontVal = 0;

  private indexOf(item: T): number {
    return this.itemsArr.indexOf(item);
  }

  private assertInt(time: number, who: string): void {
    if (!Number.isInteger(time)) {
      throw new Error(`TimedQueue.${who}: time must be an integer (queue times are ints in the binary), got ${time}`);
    }
  }

  /**
   * Insert `item` at absolute `time`, or reposition it there if already queued.
   * Mirrors `-[TimedQue setTime:forItem:]` @ TimedQue.txt:220 exactly: the insertion index is
   * computed by scanning the array *before* any removal (first index whose stored time is
   * strictly greater than `time`), then the existing entry (if any) is removed and the index
   * is adjusted down by one if it sat before the removed slot.
   */
  setTime(item: T, time: number): void {
    this.assertInt(time, "setTime");
    const existingIndex = this.indexOf(item);

    let insertIndex = this.timesArr.length;
    for (let i = 0; i < this.timesArr.length; i++) {
      if ((this.timesArr[i] as number) > time) {
        insertIndex = i;
        break;
      }
    }

    if (existingIndex !== -1) {
      this.itemsArr.splice(existingIndex, 1);
      this.timesArr.splice(existingIndex, 1);
      if (existingIndex < insertIndex) insertIndex--;
    }

    this.itemsArr.splice(insertIndex, 0, item);
    this.timesArr.splice(insertIndex, 0, time);
  }


  addTime(item: T, delta: number): void {
    const idx = this.indexOf(item);
    if (idx === -1) {
      throw new Error('TimedQueue.addTime: item not found in queue ("Tried to add time to something but it was not found")');
    }
    const newTime = (this.timesArr[idx] as number) + delta;
    this.setTime(item, newTime);
  }


  moveToFront(item: T): void {
    const idx = this.indexOf(item);
    if (idx === -1) {
      throw new Error("TimedQueue.moveToFront: item not found in queue");
    }
    this.itemsArr.splice(idx, 1);
    this.timesArr.splice(idx, 1);
    this.itemsArr.unshift(item);
    this.timesArr.unshift(this.timeAtFrontVal);
  }

  /** Removes `item` if present; no-op if it isn't queued (mirrors call sites that guard with
   *  `containsItem:` before removing, e.g. `advanceQueWithCounter:`'s dead/teamless cleanup). */
  remove(item: T): void {
    const idx = this.indexOf(item);
    if (idx === -1) return;
    this.itemsArr.splice(idx, 1);
    this.timesArr.splice(idx, 1);
  }


  front(): T | undefined {
    return this.itemsArr[0];
  }

  /** The current baseline (`self.timeAtFront`). */
  timeAtFront(): number {
    return this.timeAtFrontVal;
  }

  /** Absolute stored time for `item`. Fails loudly if it isn't queued. */
  timeForItem(item: T): number {
    const idx = this.indexOf(item);
    if (idx === -1) {
      throw new Error("TimedQueue.timeForItem: item not found in queue");
    }
    return this.timesArr[idx] as number;
  }


  advanceTimeToNext(): number {
    if (this.itemsArr.length === 0) {
      throw new Error("TimedQueue.advanceTimeToNext: queue is empty");
    }
    const newFrontTime = this.timesArr[0] as number;
    const delta = newFrontTime - this.timeAtFrontVal;
    this.timeAtFrontVal = newFrontTime;
    return delta;
  }


  order(): readonly T[] {
    return [...this.itemsArr];
  }

  /** Same underlying sorted array as `order()` — `TimedQue` maintains no separate unsorted
   *  representation, so both accessors expose identical contents. */
  items(): readonly T[] {
    return [...this.itemsArr];
  }

  /** Whether `item` is currently queued. */
  has(item: T): boolean {
    return this.indexOf(item) !== -1;
  }
}
