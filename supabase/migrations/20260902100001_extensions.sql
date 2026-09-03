-- Core extensions used across the schema.
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "pg_cron" with schema extensions;

-- Helper functions live outside `public` so PostgREST never exposes them as RPC
-- endpoints. Only `public` (+ graphql_public) is listed in api.schemas.
create schema if not exists private;
grant usage on schema private to authenticated;
