export interface VisibleNotification {
  visible: boolean;
}

/** Queue ownership separated from Pixi presentation so diagnostics always name the active item. */
export class DayNotificationQueue<T extends VisibleNotification> {
  private active: T | undefined;
  private readonly waiting: T[] = [];

  get current(): T | undefined {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiting.length;
  }

  enqueue(notification: T): T | undefined {
    if (this.active !== undefined) {
      this.waiting.push(notification);
      return undefined;
    }
    this.active = notification;
    return notification;
  }

  finishCurrent(): T | undefined {
    if (this.active !== undefined) this.active.visible = false;
    this.active = this.waiting.shift();
    return this.active;
  }
}
