export class MirroredInputGate {
  #pointerId;
  #mirroring = false;

  get state() {
    if (this.#mirroring) return "mirroring";
    if (this.#pointerId !== undefined) return "capturing";
    return "ready";
  }

  get busy() {
    return this.state !== "ready";
  }

  begin(pointerId) {
    if (this.busy) return false;
    this.#pointerId = pointerId;
    return true;
  }

  owns(pointerId) {
    return this.#pointerId === pointerId;
  }

  commit(pointerId) {
    if (!this.owns(pointerId)) return false;
    this.#pointerId = undefined;
    this.#mirroring = true;
    return true;
  }

  cancel(pointerId) {
    if (!this.owns(pointerId)) return false;
    this.#pointerId = undefined;
    return true;
  }

  complete() {
    if (!this.#mirroring) return false;
    this.#mirroring = false;
    return true;
  }
}
