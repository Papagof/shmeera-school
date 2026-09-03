-- Testing-only dependency: powers the cross-tenant isolation regression
-- suite in supabase/tests/database (SPEC.md §3.3.9). Harmless to have
-- installed in any environment.
create extension if not exists pgtap with schema extensions;
