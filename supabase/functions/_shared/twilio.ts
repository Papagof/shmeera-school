// Twilio Verify/SMS/Voice wiring. If credentials aren't configured (e.g. in
// local dev), calls no-op with a console warning instead of throwing, so the
// rest of a function's logic can still be exercised.
//
// The account SID is always required (it's in the request URL, not just
// auth). For the Basic Auth credential itself, an API Key (SID starting
// "SK" + its secret) is preferred over the account's master Auth Token —
// an API Key can be revoked/rotated independently without invalidating
// every other use of the account, including webhook signature verification
// (twilioSignature.ts), which needs the real Auth Token regardless and so
// keeps reading TWILIO_AUTH_TOKEN on its own.
const ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const API_KEY_SID = Deno.env.get("TWILIO_API_KEY_SID");
const API_KEY_SECRET = Deno.env.get("TWILIO_API_KEY_SECRET");
const AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

function configured(): boolean {
  return Boolean(ACCOUNT_SID && FROM_NUMBER && ((API_KEY_SID && API_KEY_SECRET) || AUTH_TOKEN));
}

function authHeader(): string {
  const [user, pass] = API_KEY_SID && API_KEY_SECRET ? [API_KEY_SID, API_KEY_SECRET] : [ACCOUNT_SID, AUTH_TOKEN];
  return `Basic ${btoa(`${user}:${pass}`)}`;
}

export async function sendSms(to: string, body: string): Promise<void> {
  if (!configured()) {
    console.warn(`[twilio:sms] not configured — would send to ${to}: ${body}`);
    return;
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: FROM_NUMBER!, Body: body }),
  });
  if (!res.ok) console.error("[twilio:sms] failed", res.status, await res.text());
}

export async function placeVoiceCall(to: string, twimlUrl: string): Promise<void> {
  if (!configured()) {
    console.warn(`[twilio:voice] not configured — would call ${to} with TwiML from ${twimlUrl}`);
    return;
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${ACCOUNT_SID}/Calls.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: FROM_NUMBER!, Url: twimlUrl }),
  });
  if (!res.ok) console.error("[twilio:voice] failed", res.status, await res.text());
}
