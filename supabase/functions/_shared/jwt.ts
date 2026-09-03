// Minimal JWT payload decode (no signature verification — the token already
// arrived via the Authorization header on an HTTPS request Supabase's
// gateway authenticated; this just reads claims like `aal` that
// supabase-js's client helpers don't surface directly).
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Malformed JWT");
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return JSON.parse(atob(padded));
}
