export * from "./database.types";
export * from "./functionError";

export const CODE_LENGTH = 6;

export const NOTIFICATION_KINDS = {
  DESIGNEE_REQUESTED: "designee_requested",
  DESIGNEE_REVIEWED: "designee_reviewed",
  CODE_VALIDATED: "code_validated",
  INVALID_CODE_ATTEMPT: "invalid_code_attempt",
  CUSTODY_RESTRICTED_ATTEMPT: "custody_restricted_attempt",
  LATE_PICKUP: "late_pickup",
  EMERGENCY_BROADCAST: "emergency_broadcast",
  CHAT_REPORT_FILED: "chat_report_filed",
} as const;

// Cryptographically-random numeric code. Used by the generate-event-code
// Edge Function (the only place codes are actually minted); safe to reuse
// client-side for display/preview purposes only.
export function generateNumericCode(length: number = CODE_LENGTH): string {
  const globalCrypto = (globalThis as { crypto?: Crypto }).crypto;
  const bytes = new Uint8Array(length);
  if (globalCrypto?.getRandomValues) {
    globalCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let code = "";
  for (let i = 0; i < length; i++) code += (bytes[i] % 10).toString();
  return code;
}
