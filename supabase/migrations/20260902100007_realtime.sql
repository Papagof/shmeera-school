-- Realtime channels are named school:{school_id}:... (SPEC.md §3.3.5). The
-- tables backing them keep the same RLS as everywhere else, so Realtime
-- Authorization prevents subscribing outside one's own school even if the
-- channel name is guessed.
alter publication supabase_realtime add table public.events;
alter publication supabase_realtime add table public.security_alerts;
alter publication supabase_realtime add table public.event_codes;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.chat_threads;
