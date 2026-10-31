# VOVEL Keyboard (future — not built)

No keyboard exists in this repository, and the web app does not pretend to have one. "Words to Use" is the MVP stand-in.

## Shape
A separate Android app containing an `InputMethodService` (IME), talking to the user's vocabulary through a documented API.

```
Android IME  ──(local cache, Room/SQLite)──▶  suggestions + definitions on-device
     ▲                                          ▲
     └── periodic, user-initiated sync ────────┘──▶ Supabase (RLS-protected, user's JWT)
```

## Features
- Suggestion strip: saved words matching the **current word prefix only**, ranked by learning status (learning/familiar first).
- Long-press a suggestion → short definition; tap → insert.
- Words come from a local cache synced from the account; works offline.

## Privacy rules (non-negotiable)
- Never log, store or transmit typed text. Match the current prefix on-device and discard it.
- Disable all suggestions in password, email, URL, number and `IME_FLAG_NO_PERSONALIZED_LEARNING` / incognito fields.
- No network call on keystrokes; no third-party/AI service ever receives typed text.
- Sync only vocabulary the user already saved, over their authenticated Supabase session.
- Explicit opt-in screen explaining exactly what the keyboard can see.

## Steps
1. Stabilise the Supabase schema and add a read-only "vocabulary snapshot" endpoint (RLS-scoped, paginated by `updated_at`).
2. Android IME prototype with a hard-coded word list and prefix matcher.
3. Local cache + sync; privacy review (no logging, field-type gating).
4. Insertion UX, definitions, "used this word" signal feeding Words to Use (counts only, never text).
5. Security review and Play Store IME disclosure requirements.
