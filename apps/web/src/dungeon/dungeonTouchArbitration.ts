export type DungeonSameRoomInteraction =
  | { readonly kind: "zone"; readonly zoneId: string }
  | { readonly kind: "waypoint" }
  | { readonly kind: "encounter"; readonly encounterId: string }
  | { readonly kind: "none" };

/** A current-room body touch belongs to RoomNode's local zone/waypoint/encounter arbitration. */
export function dungeonTouchRequiresRoomSelection(
  touchedRoomId: string,
  currentRoomId: string,
): boolean {
  return touchedRoomId !== currentRoomId;
}


export function dungeonSameRoomInteraction(
  zoneIdsInSourceOrder: readonly string[],
  hitZoneIds: ReadonlySet<string>,
  waypointHit: boolean,
  pendingEncounterId?: string,
): DungeonSameRoomInteraction {
  const zoneId = zoneIdsInSourceOrder.find((id) => hitZoneIds.has(id));
  if (zoneId !== undefined) return Object.freeze({ kind: "zone", zoneId });
  if (waypointHit) return Object.freeze({ kind: "waypoint" });
  if (pendingEncounterId !== undefined) {
    return Object.freeze({ kind: "encounter", encounterId: pendingEncounterId });
  }
  return Object.freeze({ kind: "none" });
}
