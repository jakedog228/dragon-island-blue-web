export type Cleanup = () => void;

/** Small ownership scope for scene/application resources.
 *
 * Cleanups run once in reverse registration order. The abort signal lets ticker-driven waits stop
 * promptly when their owning scene is disposed, preventing old scene continuations from leaking
 * into later navigation. */
export class LifecycleScope {
  private readonly controller = new AbortController();
  private cleanups: Cleanup[] = [];
  private disposedValue = false;

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get disposed(): boolean {
    return this.disposedValue;
  }

  add(cleanup: Cleanup): void {
    if (this.disposedValue) {
      cleanup();
      return;
    }
    this.cleanups.push(cleanup);
  }

  dispose(): void {
    if (this.disposedValue) return;
    this.disposedValue = true;
    this.controller.abort();
    const cleanups = this.cleanups.reverse();
    this.cleanups = [];
    const errors: unknown[] = [];
    for (const cleanup of cleanups) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, "LifecycleScope cleanup failed");
  }
}
