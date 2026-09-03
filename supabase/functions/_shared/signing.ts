import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { HttpError } from "./errors.ts";

// Per-school HMAC signing for QR payloads (SPEC.md §3.3.2). Secrets live in
// Supabase Vault, referenced from schools.signing_secret_ref, and are only
// ever read via the service-role client.

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function hmacSign(secret: string, payload: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

export async function hmacVerify(secret: string, payload: string, signatureB64: string): Promise<boolean> {
  try {
    const key = await hmacKey(secret);
    const sigBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    return await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

export function decodeQrPayload(qrPayload: string): { payloadJson: string; signature: string } {
  const [encodedPayload, signature] = qrPayload.split(".");
  if (!encodedPayload || !signature) throw new HttpError(400, "Malformed QR payload");
  try {
    return { payloadJson: atob(encodedPayload), signature };
  } catch {
    throw new HttpError(400, "Malformed QR payload");
  }
}

export async function getSchoolSigningSecret(service: SupabaseClient, schoolId: string): Promise<string> {
  const { data: school, error } = await service
    .from("schools")
    .select("signing_secret_ref")
    .eq("id", schoolId)
    .single();
  if (error || !school?.signing_secret_ref) throw new HttpError(500, "School signing secret not provisioned");

  // The Data API only exposes public/graphql_public — `vault` isn't
  // reachable via `.schema("vault")`, even for service_role. Go through the
  // public.vault_get_decrypted_secret RPC wrapper instead (see
  // 20260902100011_vault_rpc.sql).
  const { data: secret, error: secretErr } = await service.rpc("vault_get_decrypted_secret", {
    p_name: school.signing_secret_ref,
  });
  if (secretErr || !secret) throw new HttpError(500, "Unable to load signing secret from Vault");
  return secret as string;
}
