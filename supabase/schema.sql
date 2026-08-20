-- ==============================================================================
-- JARVIS PERSISTENT MEMORY SCHEMA FOR SUPABASE
-- Run this in your Supabase SQL Editor (https://supabase.com/dashboard/project/_/sql)
-- ==============================================================================

create table if not exists public.jarvis_memories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null default 'jarvis-local-user',
  category text not null default 'general', -- 'fact', 'preference', 'instruction', 'contact', 'project', 'general'
  content text not null,
  importance integer not null default 3,    -- 1 (low) to 5 (critical)
  source text not null default 'text',      -- 'text', 'voice', 'manual'
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.jarvis_memories enable row level security;

-- Policy: Allow service_role full access (server-side operations)
do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'jarvis_memories' and policyname = 'Service role full access'
  ) then
    create policy "Service role full access" on public.jarvis_memories
      for all
      using (true)
      with check (true);
  end if;
end $$;

-- Fast lookup indexes
create index if not exists idx_jarvis_memories_user on public.jarvis_memories(user_id);
create index if not exists idx_jarvis_memories_category on public.jarvis_memories(user_id, category);
create index if not exists idx_jarvis_memories_importance on public.jarvis_memories(user_id, importance desc);
create index if not exists idx_jarvis_memories_created_at on public.jarvis_memories(user_id, created_at desc);
