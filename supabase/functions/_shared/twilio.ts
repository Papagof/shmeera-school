// Twilio Verify/SMS/Voice wiring. If credentials aren't configured (e.g. in
// local dev), calls no-op with a console warning instead of throwing, so the
// rest of a function's logic can still be exercised.

const ACCOUNT_SID = Deno.env.get("TWILIO_ACCOUNT_SID");
const AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const FROM_NUMBER = Deno.env.get("TWILIO_FROM_NUMBER");

function configured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER);
}

function authHeader(): string {
  return `Basic ${btoa(`${ACCOUNT_SID}:${AUTH_TOKEN}`)}`;
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
