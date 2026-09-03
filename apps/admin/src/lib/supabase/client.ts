import { createBrowserClient } from "@supabase/ssr";

// Not parameterized with Database: the hand-written types in
// @shmeera/shared don't carry Supabase's generated Relationships metadata,
// which the typed client needs to type joined `.select("foo(bar)")` calls.
// Regenerate real types once the project is connected (see
// packages/shared/src/database.types.ts) and reintroduce
// createBrowserClient<Database>(...) then.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
