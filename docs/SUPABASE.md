# Supabase setup

**Status:** schema, RLS and `SupabaseRepository` exist. The RLS policies were tested on a real PostgreSQL 16 with a
*stubbed* `auth` schema (`npm run test:rls`). The repository adapter and sign-in UI have **not** been run against a live project.

## 1. Create the project and apply the migration

1. Create a project at supabase.com.
2. SQL editor → paste `supabase/migrations/20261030000000_vovel_init.sql` → run
   (or `supabase db push` with the Supabase CLI).
3. Auth → Providers: enable Email. Auth → URL configuration: add your site URL and redirect URL for password recovery.

What it creates: `profiles`, `collections`, `words`, `review_logs`, `daily_sessions`; RLS on all five
(`user_id = auth.uid()`); `unique(user_id, normalized_word)`; composite foreign keys so a word can only reference
*the same user's* collection and a review only *the same user's* word; `ON DELETE SET NULL` for collections
(words are kept); a unique `(user_id, dedupe_key)` on reviews (idempotent); a signup trigger that creates the profile.
`anon` has no table privileges.

## 2. Environment variables

| Variable | Where | Notes |
|---|---|---|
| `VOVEL_SUPABASE_URL` | browser | project URL |
| `VOVEL_SUPABASE_ANON_KEY` | browser | **public** anon key only |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | never ship to the browser; needed only for account deletion |

## 3. Wiring (not done yet)

```ts
import { createClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "./data/supabaseRepository";
const supabase = createClient(URL, ANON_KEY);
const { data } = await supabase.auth.getUser();
const repo = new SupabaseRepository(supabase, data.user!.id);   // same interface as LocalRepository
```

Still to build: sign-up / log-in / log-out / password-recovery screens, choosing the repository by session, and a prompt that calls
`previewMigration(local, cloud)` → shows the plan → `runMigration` only after confirmation. Local data is never deleted by migration.

## 4. Re-running the isolation tests

```bash
sudo -u <non-root-user> PGBIN=/usr/lib/postgresql/16/bin bash supabase/tests/run_rls.sh
```
Before going live, repeat the key checks against the real project with two real accounts.

## Account deletion
Needs a server-side function (service-role key) that deletes the `auth.users` row; all user tables cascade from it. Not implemented.
