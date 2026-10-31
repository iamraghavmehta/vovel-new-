# VOVEL — Find your words.

*Discover words. Remember them. Make them yours.*

A personal vocabulary archive: save words you meet while reading, practise a few each day
with spaced repetition (the **Daily Five**), and bring them into your own writing.

> **Read this first — what this build is and isn't.** It was built in a sandbox that could not
> reach the npm registry, so **Next.js, Tailwind, shadcn/ui, Zod and Vitest were not used**.
> The app is a React 19 single-page app with hand-written CSS design tokens, bundled with Bun,
> and the domain logic is dependency-free strict TypeScript. See [Deviations](#deviations-from-the-brief).
> It runs **in local mode only**; Supabase (schema, RLS, repository) is written and the SQL is tested,
> but **no sign-in UI is wired up**.

## Quick start

```bash
npm install            # react, react-dom, typescript, tsx, playwright (+ type packages)
npm run build          # needs Bun (https://bun.sh) — bundles src/app/main.tsx → dist/
npm run serve          # http://localhost:5173
```

Open it, skip or complete the welcome tour, search a word, save it. Data is stored in this browser's
`localStorage` and survives refreshes. **It is not synced or backed up** — use Settings → Export JSON.

## Commands and what they verify

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc` over `src/core`, `src/data`, `src/services` (strict, `noUncheckedIndexedAccess`) |
| `npm test` | 28 engine tests (Node's built-in runner via `tsx`) |
| `npm run e2e` | Builds, then drives headless Chromium through the full user journey (42 checks) |
| `npm run test:rls` | Applies the migration to a throwaway local Postgres and runs 13 isolation checks (needs Postgres 16 binaries; run as non-root) |

Results from the build session are in [Verification status](#verification-status).

## Project structure

```
src/
  core/        Pure logic, no I/O: types, scheduler (SM-2-inspired), Daily Five selection,
               dictionary client + parser, text normalisation, timezone helpers
  data/        VovelRepository interface; LocalRepository (browser); SupabaseRepository (cloud, unverified live)
  services/    saveWord/search/sort/filter, learning (daily session, idempotent reviews, review groups),
               dashboard stats, JSON/CSV import-export, local→cloud migration
  app/         React UI: store + hash router, pages (Home, Discover, MyWords, WordDetail, Learn, Collections,
               WordsToUse, Settings, Onboarding)
public/        index.html, styles.css (design tokens, light + dark, reduced-motion)
supabase/      migrations/ (schema + RLS), tests/ (RLS isolation tests)
tests/         engine.test.ts, e2e/journey.mjs
docs/          SUPABASE.md, KEYBOARD.md
```

Storage is behind `VovelRepository`; the UI and services never touch `localStorage` or Supabase directly.

## How it behaves

- **Search** uses the real Free Dictionary API. Unknown words, rate limits, timeouts and offline states each
  show a specific message. Nothing is invented: a word with no entry can only be saved with *your own*
  definition, which is labelled as yours. Dictionary content and personal notes are visually separate.
- **Duplicates** are blocked on a normalised key (case, punctuation, whitespace). Searching a saved word shows
  the existing entry with an "Open" link.
- **Daily Five** is chosen once per local day (in your configured timezone) and persisted, so refreshing never
  reshuffles it. Priority: overdue → frequently forgotten (≥2 lapses) → new/never reviewed → low mastery → the rest,
  avoiding words used in the last 3 sessions when alternatives exist. With fewer than five words it shows fewer.
- **Reviews are idempotent.** Each review has a key (`daily:<date>:<wordId>`); a repeat click, refresh or revisit
  records nothing. A second review of the same word within 5 s is rejected. Studying ahead (before a word is due)
  never writes to its schedule.
- **Dashboard** numbers are computed from stored words, review logs and sessions. A new user sees onboarding, not zeros.
- **Import** is two-phase (preview, then explicit confirm), validates the file, skips duplicates and never overwrites.
  CSV export neutralises spreadsheet formula injection (`=`, `+`, `-`, `@`).

### Scheduler (simplified, not scientifically validated)

SM-2-*inspired*, with MVP defaults chosen by judgement — **not** a validated optimal-learning model. Tune against real data.

| Rating | Effect |
|---|---|
| Again | lapse recorded, success streak reset, retry in **10 min**, ease −0.20 |
| Hard | interval ×1.2 (min 1 day), streak unchanged, ease −0.15, stays "learning" |
| Good | 1 day → 3 days → previous interval × ease |
| Easy | 4 days → 7 days → previous interval × ease × 1.3, ease +0.15 |

Interval is capped at 365 days and never shrinks on success. Status: *mastered* at ≥21 days and ≥3 correct in a row,
*familiar* at ≥6 days, otherwise *learning*. You can also change status manually.

## Deviations from the brief

| Brief | What was built | Why |
|---|---|---|
| Next.js App Router | React SPA, hash routing, Bun bundle | npm registry blocked (HTTP 403) |
| Tailwind + shadcn/ui | Hand-written CSS with design tokens | same |
| Zod | Hand-written validators (`parseImport`, dictionary parser) | same |
| Vitest | Node test runner + `tsx` | same |
| Supabase auth flows | Schema, RLS, repository, migration helper — **no sign-in/sign-up/recovery UI** | `@supabase/supabase-js` not installable |
| Web Notifications | Permission request only; **no reminders are sent** | needs a service worker / push backend |
| Account deletion | Not implemented | needs a server-side function with the service-role key |

Porting to Next.js is mostly mechanical: `src/core`, `src/data`, `src/services` are framework-free; pages become route files.

## Verification status

Actually run in the build session:

- `tsc` (strict) on core/data/services — **clean**
- Engine tests — **28 / 28 passed**
- Browser end-to-end — **42 / 42 checks passed**, 3 consecutive runs, desktop (1280px) and mobile (390px) viewports, zero console errors
- RLS — migration applied to PostgreSQL 16, **13 / 13 isolation checks passed**

**Not** run, and why:

- **Live dictionary calls.** The sandbox's network blocks `api.dictionaryapi.dev`, so the e2e test serves fixture responses
  for that host (test script only; the app has no mocks). Verify the real API once on your machine.
- **Type-check of `.tsx` files.** `@types/react` was unavailable. They are bundled and exercised by the e2e test but not `tsc`-checked.
  Run `npm install && npx tsc --noEmit --jsx react-jsx -p tsconfig.json` after adding `src/app` to `include`.
- **Lint.** No ESLint TypeScript plugin was available.
- **`SupabaseRepository` against a live project**, and the RLS test used a stub `auth` schema, not real Supabase Auth.
- Real mobile devices, screen readers, Safari/Firefox. Accessibility work (labels, focus rings, `aria-current`, dialogs,
  live regions, reduced motion, contrast) was designed in but only checked in Chromium with no automated audit.

## Known limitations

- Local data lives in one browser profile; clearing site data erases it. No cross-device sync until Supabase is wired.
- "Likely unfamiliar word" highlighting is a crude length heuristic, labelled as such.
- Writing practice only checks that the exact word appears; it says so and cannot judge grammar.
- Daily Five avoids recent repeats only among words in the same priority tier; new words are always newest-first.
- Pronunciation audio is whatever the dictionary supplies (often absent for rarer words).
- The scheduler's cap and multipliers are unvalidated defaults.

## Next steps

1. `npm install` on a networked machine; run all four commands above; fix whatever surfaces.
2. Wire Supabase (see `docs/SUPABASE.md`): auth UI, repository selection, migration prompt.
3. Port to Next.js + Tailwind/shadcn if you want that stack; add Zod at the import boundary.
4. Android keyboard — see `docs/KEYBOARD.md`.
