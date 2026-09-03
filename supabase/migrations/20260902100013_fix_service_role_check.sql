-- Bug: trg_event_codes_protect_fields and trg_schools_protect_secret checked
-- current_setting('request.jwt.claim.role', true) = 'service_role' — the
-- flattened per-key GUC PostgREST does not always set. Verified live:
-- validate-event-code's service-role UPDATE (setting used_at) was being
-- rejected by the "only revoke may be set outside the service role" guard
-- because that GUC read NULL, not 'service_role'. Supabase's own
-- auth.role() helper checks both the flattened GUC and the JSON
-- request.jwt.claims fallback — use that instead everywhere this pattern
-- is used.

create or replace function public.trg_event_codes_protect_fields()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.used_at is distinct from old.used_at
     or new.code is distinct from old.code
     or new.qr_payload is distinct from old.qr_payload
     or new.expires_at is distinct from old.expires_at
     or new.student_id is distinct from old.student_id
     or new.school_id is distinct from old.school_id
     or (old.revoked = true and new.revoked = false) then
    raise exception 'event_codes: only revoked may be set (false -> true) outside the service role';
  end if;
  return new;
end;
$$;

create or replace function public.trg_schools_protect_secret()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.signing_secret_ref is distinct from old.signing_secret_ref then
    raise exception 'schools.signing_secret_ref can only be changed by the service role';
  end if;
  return new;
end;
$$;
