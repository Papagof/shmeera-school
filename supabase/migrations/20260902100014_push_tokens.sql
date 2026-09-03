-- Expo push token registry (SPEC.md §9, build order step 8). Each row is a
-- device registration for one user in one school; a user can hold several
-- (multiple devices). Tokens are self-managed — the owning user (guardian
-- or teacher) can read/write only their own rows; only service_role (Edge
-- Functions sending notifications) reads across a school.

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android', 'web')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index push_tokens_school_id_idx on public.push_tokens (school_id);
create index push_tokens_user_id_idx on public.push_tokens (user_id);

alter table public.push_tokens enable row level security;

create policy push_tokens_select_own on public.push_tokens for select
  using (user_id = (select auth.uid()));

create policy push_tokens_insert_own on public.push_tokens for insert
  with check (
    user_id = (select auth.uid())
    and school_id in (select private.current_school_ids())
  );

create policy push_tokens_update_own on public.push_tokens for update
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy push_tokens_delete_own on public.push_tokens for delete
  using (user_id = (select auth.uid()));

create or replace function public.trg_push_tokens_touch_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger trg_push_tokens_touch_updated_at
before update on public.push_tokens
for each row execute function public.trg_push_tokens_touch_updated_at();
