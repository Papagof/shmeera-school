import { json, corsHeaders } from "../_shared/http.ts";
import { errorResponse, HttpError } from "../_shared/errors.ts";
import { verifyTwilioSignature } from "../_shared/twilioSignature.ts";

// POST /twilio-webhook — inbound Twilio status callbacks (SMS delivery
// receipts, Verify results, call status). SPEC.md §8.
//
// Set TWILIO_WEBHOOK_URL to this function's exact public URL (Twilio signs
// over the full URL it called) for signature verification to work.
const AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN");
const FUNCTION_URL = Deno.env.get("TWILIO_WEBHOOK_URL");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed");

    const formData = await req.formData();
    const params: Record<string, string> = {};
    for (const [key, value] of formData.entries()) params[key] = String(value);

    const signature = req.headers.get("X-Twilio-Signature");
    if (AUTH_TOKEN && FUNCTION_URL) {
      if (!signature || !(await verifyTwilioSignature(FUNCTION_URL, params, signature, AUTH_TOKEN))) {
        throw new HttpError(403, "Invalid Twilio signature");
      }
    } else {
      console.warn("[twilio-webhook] TWILIO_AUTH_TOKEN/TWILIO_WEBHOOK_URL not set — skipping signature verification");
    }

    // Twilio's callback payload doesn't carry any of our own identifiers by
    // default. Once outbound sends record their Twilio SID against the
    // event/alert that triggered them, correlate here and update delivery
    // status; for now just log for observability.
    console.log("[twilio-webhook] received", params);

    return json({ received: true });
  } catch (err) {
    return errorResponse(err);
  }
});
