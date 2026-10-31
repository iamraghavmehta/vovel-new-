/**
 * Daily Five selection. Priority order:
 *   1. Overdue words (most overdue first).
 *   2. Frequently forgotten words (2+ failed reviews).
 *   3. Recently added, never-reviewed words (newest first).
 *   4. Low-mastery words (fewest consecutive correct recalls first).
 *   5. Anything else eligible, least recently reviewed first.
 *
 * Tiers 4–5 prefer words that were NOT in recent sessions, so the same words are not
 * repeated while alternatives exist. If fewer than `count` words exist, fewer are
 * returned — entries are never invented.
 */
import type { Word } from "./types";
import { localDateKey } from "./time";

export const DAILY_COUNT = 5;
export const FORGOTTEN_THRESHOLD = 2;

export interface SelectionContext {
  now: Date;
  timezone: string;
  /** Word ids chosen in recent daily sessions (e.g. the previous 3 days). */
  recentlySelectedIds?: ReadonlySet<string>;
  count?: number;
}

const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export function selectDailyFive(words: Word[], ctx: SelectionContext): string[] {
  const count = ctx.count ?? DAILY_COUNT;
  const nowMs = ctx.now.getTime();
  const today = localDateKey(ctx.now, ctx.timezone);
  const recent = ctx.recentlySelectedIds ?? new Set<string>();
  const chosen: Word[] = [];
  const taken = new Set<string>();

  const take = (list: Word[], preferNonRecent: boolean) => {
    const ordered = preferNonRecent
      ? [...list.filter((w) => !recent.has(w.id)), ...list.filter((w) => recent.has(w.id))]
      : list;
    for (const w of ordered) {
      if (chosen.length >= count) return;
      if (taken.has(w.id)) continue;
      taken.add(w.id);
      chosen.push(w);
    }
  };

  const reviewedToday = (w: Word) =>
    w.lastReviewedAt !== null && localDateKey(new Date(w.lastReviewedAt), ctx.timezone) === today;
  const isOverdue = (w: Word) => w.nextReviewAt !== null && t(w.nextReviewAt) <= nowMs;

  // 1. Overdue.
  take(
    words.filter(isOverdue).sort((a, b) => t(a.nextReviewAt) - t(b.nextReviewAt)),
    false,
  );
  // 2. Frequently forgotten.
  take(
    words
      .filter((w) => w.failedReviews >= FORGOTTEN_THRESHOLD && !reviewedToday(w))
      .sort((a, b) => b.failedReviews - a.failedReviews || t(a.lastReviewedAt) - t(b.lastReviewedAt)),
    false,
  );
  // 3. New, never reviewed — newest first.
  take(
    words.filter((w) => w.repetitions === 0).sort((a, b) => t(b.createdAt) - t(a.createdAt)),
    false,
  );
  // 4. Low mastery.
  take(
    words
      .filter((w) => (w.learningStatus === "learning" || w.learningStatus === "familiar") && !reviewedToday(w))
      .sort((a, b) => a.consecutiveCorrect - b.consecutiveCorrect || t(a.lastReviewedAt) - t(b.lastReviewedAt)),
    true,
  );
  // 5. Everything else not already seen today, least recently reviewed first.
  take(
    words.filter((w) => !reviewedToday(w)).sort((a, b) => t(a.lastReviewedAt) - t(b.lastReviewedAt)),
    true,
  );

  return chosen.map((w) => w.id);
}
