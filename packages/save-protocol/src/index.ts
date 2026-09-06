export const LEGACY_CONTENT_FINGERPRINT_SCOPE = "dib-identity-plists-v1" as const;
export const PREVIOUS_CONTENT_FINGERPRINT_SCOPE = "dib-identity-plists-v2" as const;
export const PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V3 = "dib-identity-plists-v3" as const;
export const PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V4 = "dib-identity-plists-v4" as const;
export const PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V5 = "dib-identity-plists-v5" as const;
export const PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V6 = "dib-identity-plists-v6" as const;
export const CONTENT_FINGERPRINT_SCOPE = "dib-identity-plists-v7" as const;
export type ContentFingerprintScope =
  | typeof LEGACY_CONTENT_FINGERPRINT_SCOPE
  | typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE
  | typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V3
  | typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V4
  | typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V5
  | typeof PREVIOUS_CONTENT_FINGERPRINT_SCOPE_V6
  | typeof CONTENT_FINGERPRINT_SCOPE;
export const SAVE_SLOT_IDS = ["slot-1", "slot-2", "slot-3"] as const;
export type SaveSlotId = typeof SAVE_SLOT_IDS[number];

export interface ContentFingerprintInput<
  Scope extends ContentFingerprintScope = ContentFingerprintScope,
> {
  readonly algorithm: "SHA-256";
  readonly scope: Scope;
  readonly digest: string;
}

export interface SaveSlotSummary {
  readonly slotId: SaveSlotId;
  readonly revision: number;
  readonly updatedAt: string;
  readonly compatible: boolean;
}
