import type { PvpCommandV1, PvpClientSetupV1, PvpEntryV1, PvpMatchViewV1 } from "@dib/game-protocol";
import { PvpClient, PvpClientError } from "./pvpClient.js";

export interface PvpControllerState {
  readonly match: PvpMatchViewV1 | null;
  readonly busy: boolean;
  readonly error: Error | undefined;
  readonly canRetry: boolean;
}
/** Owns one network operation at a time. Failed writes retain their exact idempotency envelope. */
export class PvpMatchController {
  private match: PvpMatchViewV1 | null = null;
  private busy = false;
  private error: Error | undefined;
  private retryOperation: (() => Promise<PvpMatchViewV1 | null>) | undefined;
  private disposed = false;
  private running: Promise<void> | undefined;
  private writeQueued = false;
  constructor(private readonly client: PvpClient, private readonly setup: PvpClientSetupV1,
    private readonly entry: () => PvpEntryV1, private readonly changed: (state: PvpControllerState) => void) {}
  get state(): PvpControllerState { return { match: this.match, busy: this.busy, error: this.error, canRetry: this.retryOperation !== undefined }; }
  dispose(): void { this.disposed = true; }
  private emit(): void { if (!this.disposed) this.changed(this.state); }
  private async run(operation: () => Promise<PvpMatchViewV1 | null>, write = false): Promise<void> {
    if (this.disposed || this.writeQueued || (!write && this.running)) return;
    if (write) {
      // A player input during background polling waits for that read instead of disappearing.
      // Only one write can wait; a second tap cannot create another idempotency envelope.
      this.writeQueued = true; this.busy = true; this.emit();
      await this.running;
      if (this.disposed) { this.writeQueued = false; this.busy = false; return; }
    }
    this.busy = write || this.match === null; this.error = undefined; this.emit();
    const pending = this.perform(operation, write);
    this.running = pending;
    await pending;
    if (this.running === pending) this.running = undefined;
    if (write) this.writeQueued = false;
    this.busy = this.writeQueued; this.emit();
  }
  private async perform(operation: () => Promise<PvpMatchViewV1 | null>, write: boolean): Promise<void> {
    try {
      const next = await operation();
      if (this.disposed) return;
      if (!next || !this.match || next.matchId !== this.match.matchId || next.revision >= this.match.revision) this.match = next;
      if (write) this.retryOperation = undefined;
      // A read after a lost response can prove that the pending operation committed.
      if (this.match?.status === "ended" || this.match?.status === "cancelled" || this.match?.status === "expired") this.retryOperation = undefined;
    } catch (error) {
      this.error = error instanceof Error ? error : new Error(String(error));
      const uncertain = !(error instanceof PvpClientError) || error.details.code === "UNAVAILABLE";
      if (write) this.retryOperation = uncertain ? operation : undefined;
    }
  }
  async refresh(): Promise<void> { await this.run(() => this.match ? this.client.read(this.match.matchId) : this.client.current(this.setup)); }
  async invite(): Promise<void> {
    if (this.retryOperation) return;
    try {
      const request = { requestId: crypto.randomUUID(), setup: this.setup, entry: this.entry() };
      await this.run(() => this.client.invite(request), true);
    } catch (error) { this.error = error instanceof Error ? error : new Error(String(error)); this.emit(); }
  }
  async join(code: string): Promise<void> {
    if (this.retryOperation) return;
    try {
      const request = { requestId: crypto.randomUUID(), setup: this.setup, entry: this.entry(), code: code.trim().toUpperCase() };
      await this.run(() => this.client.join(request), true);
    } catch (error) { this.error = error instanceof Error ? error : new Error(String(error)); this.emit(); }
  }
  async submit(action: PvpCommandV1["action"]): Promise<void> {
    const match = this.match;
    if (!match || !match.decisionId || match.status !== "active" || this.retryOperation) return;
    const request = { commandId: crypto.randomUUID(), expectedRevision: match.revision, decisionId: match.decisionId, action };
    await this.run(() => this.client.command(match.matchId, request), true);
  }
  async cancel(): Promise<void> {
    const match = this.match;
    if (!match || match.status !== "waiting" || this.retryOperation) return;
    const requestId = crypto.randomUUID();
    await this.run(() => this.client.cancel(match.matchId, requestId), true);
  }
  async retry(): Promise<void> { if (this.retryOperation) await this.run(this.retryOperation, true); }
  newMatch(): void {
    if (this.busy || this.retryOperation || this.match?.status === "active" || this.match?.status === "waiting") return;
    this.match = null; this.error = undefined; this.emit();
  }
}
