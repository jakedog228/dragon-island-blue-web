import { describe, expect, it } from "vitest";
import { DayNotificationQueue } from "../src/world/dayNotificationQueue.js";

describe("DayNotificationQueue", () => {
  it("keeps diagnostics on the presented banner until it finishes", () => {
    const queue = new DayNotificationQueue<{ day: number; visible: boolean }>();
    const day2 = { day: 2, visible: false };
    const day3 = { day: 3, visible: false };

    expect(queue.enqueue(day2)).toBe(day2);
    day2.visible = true;
    expect(queue.enqueue(day3)).toBeUndefined();
    expect(queue.current).toBe(day2);
    expect(queue.queuedCount).toBe(1);
    expect(day3.visible).toBe(false);

    expect(queue.finishCurrent()).toBe(day3);
    expect(day2.visible).toBe(false);
    expect(queue.current).toBe(day3);
    expect(queue.queuedCount).toBe(0);
  });

  it("does not let queued-object visibility replace the current diagnostic identity", () => {
    const queue = new DayNotificationQueue<{ id: string; visible: boolean }>();
    const current = { id: "current", visible: true };
    const queued = { id: "queued", visible: false };
    queue.enqueue(current);
    queue.enqueue(queued);

    queued.visible = true;

    expect(queue.current?.id).toBe("current");
  });
});
