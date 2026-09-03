// Twilio request signature validation (X-Twilio-Signature), per Twilio's
// documented algorithm: HMAC-SHA1 of the full request URL with all POST
// param key/value pairs appended in sorted-key order, base64-encoded.
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string,
): Promise<boolean> {
  let data = url;
  for (const key of Object.keys(params).sort()) {
    data += key + params[key];
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));
  return computed === signature;
}
