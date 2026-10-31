-- VOVEL initial schema. Every table is owned by a user and protected by Row Level Security.
-- Timestamps are timestamptz (UTC). Daily sessions use a plain DATE computed client-side
-- in the user's configured timezone (profiles.timezone).

create extension if not exists pgcrypto;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  goals text[] not null default '{}',
  daily_count int not null default 5 check (daily_count between 1 and 20),
  onboarding_completed boolean not null default false,
  notifications_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- collections ----------
create table public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, id)  -- target for composite foreign keys (prevents cross-user references)
);
create unique index collections_user_name_key on public.collections (user_id, lower(btrim(name)));

-- ---------- words ----------
create table public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  word text not null check (char_length(btrim(word)) between 1 and 120),
  normalized_word text not null check (char_length(normalized_word) between 1 and 120),
  part_of_speech text,
  pronunciation text,
  audio_url text check (audio_url is null or audio_url like 'https://%'),
  definition text not null check (char_length(btrim(definition)) > 0),
  definition_source text not null default 'user' check (definition_source in ('dictionary', 'user')),
  synonyms text[] not null default '{}',
  antonyms text[] not null default '{}',
  example_sentences text[] not null default '{}',
  user_example text not null default '',
  personal_notes text not null default '',
  original_context text not null default '',
  source text not null default '',
  etymology text,
  collection_id uuid,
  learning_status text not null default 'new' check (learning_status in ('new', 'learning', 'familiar', 'mastered')),
  repetitions int not null default 0 check (repetitions >= 0),
  failed_reviews int not null default 0 check (failed_reviews >= 0),
  consecutive_correct int not null default 0 check (consecutive_correct >= 0),
  interval_days numeric not null default 0 check (interval_days >= 0 and interval_days <= 365),
  ease_factor numeric not null default 2.5 check (ease_factor between 1.3 and 3.0),
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  -- One entry per normalised word per user.
  unique (user_id, normalized_word),
  -- The collection must belong to the same user; deleting it only clears the link (words are kept).
  foreign key (user_id, collection_id) references public.collections (user_id, id) on delete set null (collection_id)
);
create index words_user_next_review_idx on public.words (user_id, next_review_at);
create index words_user_collection_idx on public.words (user_id, collection_id);
create index words_user_created_idx on public.words (user_id, created_at desc);

-- ---------- review_logs ----------
create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  word_id uuid not null,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  was_correct boolean not null,
  reviewed_at timestamptz not null default now(),
  next_review_at timestamptz not null,
  -- Idempotency key: the same review can never be stored twice (refresh / double click).
  dedupe_key text not null,
  unique (user_id, dedupe_key),
  foreign key (user_id, word_id) references public.words (user_id, id) on delete cascade
);
create index review_logs_user_reviewed_idx on public.review_logs (user_id, reviewed_at desc);
create index review_logs_word_idx on public.review_logs (user_id, word_id);

-- ---------- daily_sessions ----------
create table public.daily_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  local_date date not null,
  selected_word_ids uuid[] not null default '{}',
  completed_word_ids uuid[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, local_date)
);

-- ---------- triggers ----------
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger words_touch before update on public.words
  for each row execute function public.touch_updated_at();

-- Create a profile row whenever a user signs up.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.collections enable row level security;
alter table public.words enable row level security;
alter table public.review_logs enable row level security;
alter table public.daily_sessions enable row level security;

create policy profiles_own on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy collections_own on public.collections for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy words_own on public.words for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy review_logs_own on public.review_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy daily_sessions_own on public.daily_sessions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Anonymous visitors get nothing; signed-in users get table access filtered by the policies above.
revoke all on public.profiles, public.collections, public.words, public.review_logs, public.daily_sessions from anon, public;
grant select, insert, update, delete on public.profiles, public.collections, public.words, public.review_logs, public.daily_sessions to authenticated;
