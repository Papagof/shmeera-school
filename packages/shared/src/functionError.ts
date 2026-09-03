// supabase-js's `functions.invoke()` throws a FunctionsHttpError whose
// `.message` is a generic "Edge Function returned a non-2xx status code" —
// the actual `{ error: "..." }` body every Edge Function here returns
// (see supabase/functions/_shared/errors.ts) is only reachable via
// `error.context`, a raw Response. Every screen calling invoke() should
// show this instead of the generic message, especially error paths where
// the specific reason is safety-relevant (e.g. the teacher STOP screen).
export async function describeFunctionError(error: unknown): Promise<string> {
  const context = (error as { context?: Response })?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // fall through to the generic message below
    }
  }
  return (error as { message?: string })?.message ?? "Something went wrong";
}
