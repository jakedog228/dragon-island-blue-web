const finite = (value) => typeof value === "number" && Number.isFinite(value);

const rectangle = (room) => ({
  x: room.x,
  y: room.y,
  width: room.width,
  height: room.height,
});

const rectangleKey = ({ x, y, width, height }) => `${x},${y},${width},${height}`;

function effectivelyVisibleRoomNodes(nodes) {
  const ancestorVisibility = [];
  const rooms = [];
  for (const node of nodes) {
    ancestorVisibility.length = node.depth;
    const parentVisible = node.depth === 0 ? true : ancestorVisibility[node.depth - 1] !== false;
    const visible = parentVisible && node.visible;
    ancestorVisibility[node.depth] = visible;
    if (visible && node.className === "RoomNode") rooms.push(node);
  }
  return rooms;
}

function snapGrid(value) {
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= 0.15 ? rounded : Number(value.toFixed(3));
}

function floorIdentity(port) {
  return `${port.instanceName}|${port.sourceFile}|${port.floor}|${port.seed}`;
}

/**
 * Accumulates the native RoomNodes observed during a mirrored dungeon walkthrough and compares
 * their normalized rectangles with the port's complete generated floor. Native camera translation
 * and scale are removed by aligning the centred native room with the port's current room; Y is
 * inverted because HSCENE reports window coordinates while dungeon generation is Cocos Y-up.
 */
export class DungeonTopologyTracker {
  constructor() {
    this.identity = undefined;
    this.observed = new Map();
    this.lastNativeMs = undefined;
    this.alignmentErrors = [];
    this.pendingObservation = undefined;
  }

  observe(nativeScene, port) {
    if (nativeScene === undefined) {
      return undefined;
    }
    const nativeDungeon = (nativeScene.nodes ?? []).some((node) =>
      node.className === "DungeonNode" && node.visible !== false);
    const portDungeon = port?.mode === "dungeon";
    if (nativeDungeon !== portDungeon) {
      return Object.freeze({
        verdict: "scene-mismatch",
        nativeDungeon,
        portDungeon,
        message: nativeDungeon
          ? "Native is in a dungeon while the web port is not"
          : "Web port is in a dungeon while native is not",
      });
    }
    if (!nativeDungeon) return undefined;
    if (!Array.isArray(port.rooms)) {
      return Object.freeze({
        verdict: "incomplete",
        nativeDungeon: true,
        portDungeon: true,
        message: "Web port dungeon state did not expose generated rooms",
      });
    }
    const identity = floorIdentity(port);
    if (identity !== this.identity) {
      this.identity = identity;
      this.observed.clear();
      this.lastNativeMs = undefined;
      this.alignmentErrors = [];
      this.pendingObservation = undefined;
    }

    const portRooms = port.rooms.filter((room) =>
      [room.x, room.y, room.width, room.height].every(finite));
    const current = portRooms.find((room) => room.id === port.currentRoomId);
    const nativeRooms = effectivelyVisibleRoomNodes(nativeScene.nodes ?? []);
    if (current === undefined || nativeRooms.length === 0) return this.snapshot(portRooms);

    if (nativeScene.nativeMs !== this.lastNativeMs) {
      this.lastNativeMs = nativeScene.nativeMs;
      const sceneRoot = (nativeScene.nodes ?? []).find((node) =>
        node.depth === 0 && node.className === "CCScene");
      const focus = sceneRoot?.tap ?? { x: 240, y: 160 };
      const nativeCurrent = nativeRooms.reduce((best, room) => {
        const distance = (room.tap.x - focus.x) ** 2 + (room.tap.y - focus.y) ** 2;
        return best === undefined || distance < best.distance ? { room, distance } : best;
      }, undefined);

      // DungeonNode centres the current room after its camera tween. Never permanently accumulate
      // a transition frame (or a stale native dump paired with a newer port snapshot) as topology.
      // Require the exact centred room geometry in two consecutive complete HSCENE dumps.
      if (nativeCurrent !== undefined && nativeCurrent.distance <= 4) {
        const observationKey = JSON.stringify([
          port.currentRoomId,
          ...nativeRooms.map((room) => [room.tap.x, room.tap.y, room.size.w, room.size.h]),
        ]);
        const stableCount = this.pendingObservation?.key === observationKey
          ? this.pendingObservation.count + 1
          : 1;
        this.pendingObservation = { key: observationKey, count: stableCount };
        if (stableCount < 2) return this.snapshot(portRooms);

        const scaleX = nativeCurrent.room.size.w / current.width;
        const scaleY = nativeCurrent.room.size.h / current.height;
        const scale = (scaleX + scaleY) / 2;
        const relativeScaleError = Math.abs(scaleX - scaleY) / Math.max(scaleX, scaleY);
        if (!(scale > 0) || relativeScaleError > 0.03) {
          this.alignmentErrors.push({
            nativeMs: nativeScene.nativeMs,
            kind: "current-room-shape",
            port: rectangle(current),
            nativeSize: nativeCurrent.room.size,
          });
        } else {
          const currentCenter = {
            x: current.x + current.width / 2,
            y: current.y + current.height / 2,
          };
          for (const room of nativeRooms) {
            const width = room.size.w / scale;
            const height = room.size.h / scale;
            const centerX = currentCenter.x + (room.tap.x - nativeCurrent.room.tap.x) / scale;
            const centerY = currentCenter.y - (room.tap.y - nativeCurrent.room.tap.y) / scale;
            const normalized = Object.freeze({
              x: snapGrid(centerX - width / 2),
              y: snapGrid(centerY - height / 2),
              width: snapGrid(width),
              height: snapGrid(height),
            });
            this.observed.set(rectangleKey(normalized), normalized);
          }
        }
      }
    }
    return this.snapshot(portRooms);
  }

  snapshot(portRooms) {
    const expected = new Map(portRooms.map((room) => {
      const normalized = rectangle(room);
      return [rectangleKey(normalized), normalized];
    }));
    const nativeOnly = [...this.observed].filter(([key]) => !expected.has(key)).map(([, room]) => room);
    const portNotObserved = [...expected].filter(([key]) => !this.observed.has(key)).map(([, room]) => room);
    const matchedRooms = this.observed.size - nativeOnly.length;
    const verdict = this.alignmentErrors.length > 0 || nativeOnly.length > 0
      ? "different"
      : portNotObserved.length === 0 && expected.size > 0
        ? "match"
        : "incomplete";
    return Object.freeze({
      identity: this.identity,
      verdict,
      nativeObservedRooms: this.observed.size,
      portRooms: expected.size,
      matchedRooms,
      nativeOnly: Object.freeze(nativeOnly),
      portNotObserved: Object.freeze(portNotObserved),
      alignmentErrors: Object.freeze(this.alignmentErrors.slice()),
    });
  }
}
