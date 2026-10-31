-- Run after the migration (see docs/SUPABASE.md). Aborts with an error if any isolation check fails.
\set ON_ERROR_STOP on
create temp table _r (name text, ok boolean);
\set alice '''11111111-1111-1111-1111-111111111111'''
\set bob   '''22222222-2222-2222-2222-222222222222'''
insert into auth.users (id, email) values (:alice, 'a@x.test'), (:bob, 'b@x.test');
select set_config('request.jwt.claim.sub', '', false);

-- profile auto-created
insert into _r select 'profile row created on signup', count(*) = 2 from public.profiles;
grant all on _r to authenticated, anon;

-- Alice writes data
set role authenticated; select set_config('request.jwt.claim.sub', :alice, false);
insert into public.collections (name) values ('Lit');
insert into public.words (word, normalized_word, definition, collection_id)
  select 'ephemeral', 'ephemeral', 'short-lived', id from public.collections where name = 'Lit';
insert into public.review_logs (word_id, rating, was_correct, next_review_at, dedupe_key)
  select id, 'good', true, now() + interval '1 day', 'daily:2026-10-30:x' from public.words;
insert into public.daily_sessions (local_date) values ('2026-10-30');
insert into _r select 'alice sees her own rows', (select count(*) from public.words) = 1 and (select count(*) from public.collections) = 1;

-- Bob sees nothing of Alice's
select set_config('request.jwt.claim.sub', :bob, false);
insert into _r select 'bob sees zero words / collections / logs / sessions',
  (select count(*) from public.words) = 0 and (select count(*) from public.collections) = 0
  and (select count(*) from public.review_logs) = 0 and (select count(*) from public.daily_sessions) = 0;
insert into _r select 'bob sees only his own profile', (select count(*) from public.profiles) = 1;

-- Bob cannot update / delete Alice's rows (affects 0 rows)
with u as (update public.words set personal_notes = 'hacked' returning 1) insert into _r select 'bob cannot update alice words', count(*) = 0 from u;
with d as (delete from public.words returning 1) insert into _r select 'bob cannot delete alice words', count(*) = 0 from d;

-- Bob cannot insert rows claiming to be Alice
do $$ begin
  begin insert into public.words (user_id, word, normalized_word, definition) values ('11111111-1111-1111-1111-111111111111', 'x', 'x', 'y');
    insert into _r values ('bob cannot insert as alice', false);
  exception when others then insert into _r values ('bob cannot insert as alice', true); end;
end $$;

-- Bob cannot attach his word to Alice's collection (composite FK + RLS)
select set_config('request.jwt.claim.sub', :alice, false);
create temp table _c as select id from public.collections limit 1;
grant all on _c to authenticated;
select set_config('request.jwt.claim.sub', :bob, false);
do $$ declare cid uuid; begin
  select id into cid from _c;
  begin insert into public.words (word, normalized_word, definition, collection_id) values ('b', 'b', 'd', cid);
    insert into _r values ('bob cannot link to alice collection', false);
  exception when others then insert into _r values ('bob cannot link to alice collection', true); end;
end $$;

-- Duplicate normalised word for the same user is rejected; same word for another user is fine
select set_config('request.jwt.claim.sub', :alice, false);
do $$ begin
  begin insert into public.words (word, normalized_word, definition) values ('Ephemeral', 'ephemeral', 'again');
    insert into _r values ('duplicate normalised word rejected', false);
  exception when unique_violation then insert into _r values ('duplicate normalised word rejected', true); end;
end $$;
select set_config('request.jwt.claim.sub', :bob, false);
insert into public.words (word, normalized_word, definition) values ('ephemeral', 'ephemeral', 'bob own copy');
insert into _r select 'same word allowed for a different user', count(*) = 1 from public.words;

-- Duplicate review key rejected (idempotency)
select set_config('request.jwt.claim.sub', :alice, false);
do $$ begin
  begin insert into public.review_logs (word_id, rating, was_correct, next_review_at, dedupe_key)
        select id, 'good', true, now(), 'daily:2026-10-30:x' from public.words;
    insert into _r values ('duplicate review key rejected', false);
  exception when unique_violation then insert into _r values ('duplicate review key rejected', true); end;
end $$;

-- Deleting a collection keeps the word
delete from public.collections;
insert into _r select 'deleting a collection keeps its words', (select count(*) from public.words where collection_id is null) = 1;

-- Anonymous role has no access
reset role; set role anon;
do $$ begin
  begin perform count(*) from public.words; insert into _r values ('anon cannot read words', false);
  exception when insufficient_privilege then insert into _r values ('anon cannot read words', true); end;
end $$;

reset role;
select case when ok then 'PASS' else 'FAIL' end as result, name from _r order by ok, name;
do $$ begin if exists (select 1 from _r where not ok) then raise exception 'RLS test failures'; end if; end $$;
