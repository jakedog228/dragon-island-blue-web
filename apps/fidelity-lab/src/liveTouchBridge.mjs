import fs from "node:fs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class LiveTouchBridge {
  constructor(inputFile, ackFile, { timeoutMs = 5_000, pollMs = 2 } = {}) {
    this.inputFile = inputFile;
    this.ackFile = ackFile;
    this.timeoutMs = timeoutMs;
    this.pollMs = pollMs;
    this.nextId = 1;
    this.ackOffset = 0;
    this.acknowledgements = new Map();
    this.isReady = false;
  }




  readAcknowledgements() {
    let size;
    try {
      size = fs.statSync(this.ackFile).size;
    } catch {
      return false;
    }
    if (size < this.ackOffset) this.ackOffset = 0;
    if (size === this.ackOffset) return false;
    const buffer = Buffer.alloc(size - this.ackOffset);
    const descriptor = fs.openSync(this.ackFile, "r");
    let read;
    try {
      read = fs.readSync(descriptor, buffer, 0, buffer.length, this.ackOffset);
    } finally {
      fs.closeSync(descriptor);
    }
    if (read === 0) return false;
    const complete = buffer.lastIndexOf(0x0a, read - 1) + 1;
    if (complete === 0) return false;
    this.ackOffset += complete;
    let ready = false;
    for (const line of buffer.toString("utf8", 0, complete).trim().split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === "READY" && parts[1] === "1") {
        ready = true;
        this.isReady = true;
      }
      if ((parts.length === 3 || parts.length === 5) && parts[0] === "ACK") {
        const id = Number(parts[1]);
        const registeredAt = Number(parts[2]);
        const rawState = parts.length === 5 ? Number(parts[3]) : undefined;
        const calls = parts.length === 5 ? Number(parts[4]) : undefined;
        const validPosition = parts.length === 3 || (
          Number.isSafeInteger(rawState) && rawState >= 0 && rawState <= 0xffffffff &&
          Number.isSafeInteger(calls) && calls >= 0
        );
        if (Number.isSafeInteger(id) && Number.isSafeInteger(registeredAt) && validPosition) {
          this.acknowledgements.set(id, Object.freeze({
            registeredAt,
            ...(rawState === undefined ? {} : { rawState, calls }),
          }));
        }
      }
    }
    return ready;
  }

  async waitFor(predicate, label, deadlineEpochMs = Date.now() + this.timeoutMs) {
    while (Date.now() < deadlineEpochMs) {
      const value = predicate();
      if (value !== undefined && value !== false) return value;
      await sleep(this.pollMs);
    }
    throw new Error(`Timed out waiting for TouchHLE live input ${label}`);
  }

  async ready() {
    if (this.isReady) return true;
    return this.waitFor(() => this.readAcknowledgements() || this.isReady, "readiness");
  }

  async input({ phase, x, y }, targetEpochMs) {
    const phaseName = ({ down: "DOWN", move: "MOVE", up: "UP" })[phase];
    if (phaseName === undefined) throw new Error(`Unknown live TouchHLE input phase ${phase}`);
    // The harness parses this field with `u64::from_str`, which rejects any fractional literal and
    // silently drops the whole command. Dashboard gestures are stamped with `performance.now()`,
    // so every deadline that is not rounded here costs the phase plus a full acknowledgement
    // timeout. Sub-millisecond precision is meaningless against the emulator's per-frame poll.
    const deadline = Math.round(targetEpochMs);
    if (!Number.isSafeInteger(deadline) || deadline < 0) {
      throw new Error(`Live TouchHLE input needs a non-negative epoch deadline, got ${targetEpochMs}`);
    }
    const id = this.nextId++;
    fs.appendFileSync(this.inputFile, `INPUT ${id} ${deadline} ${phaseName} ${x} ${y}\n`);
    // The harness acknowledges a phase after its due event has synchronously returned from UIKit,
    // so nothing can register before the deadline. Sleeping to it first keeps a scheduled phase
    // from polling the whole way there, and keeps the timeout a measure of native dispatch delay
    // rather than of how far ahead it was scheduled.
    const remaining = deadline - Date.now();
    if (remaining > 0) await sleep(remaining);
    return this.waitFor(() => {
      this.readAcknowledgements();
      const acknowledgement = this.acknowledgements.get(id);
      if (acknowledgement !== undefined) this.acknowledgements.delete(id);
      return acknowledgement;
    }, `acknowledgement ${id}`, Math.max(Date.now(), deadline) + this.timeoutMs);
  }
}
