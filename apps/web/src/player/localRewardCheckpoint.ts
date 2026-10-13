/** Keeps Offline autosaves at the last complete state while a modal reward is being collected.
 * A reload during the modal retries the unclaimed reward instead of saving a claim without its
 * items. Presentation and live quest state still advance in source order. Official continuations
 * have their own server transaction and must not use this boundary.
 */
export class LocalRewardCheckpoint<T> {
  private pending: { snapshot: T } | undefined;

  begin(snapshot: T): () => void {
    if (this.pending !== undefined) throw new Error("A local reward checkpoint is already pending");
    const pending = { snapshot: structuredClone(snapshot) };
    this.pending = pending;
    return () => {
      if (this.pending === pending) this.pending = undefined;
    };
  }

  snapshot(current: () => T): T {
    return this.pending === undefined ? current() : structuredClone(this.pending.snapshot);
  }
}
