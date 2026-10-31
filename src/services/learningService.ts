/**
 * Daily Five sessions and review recording. All scheduling math lives in core/scheduler;
 * this layer decides *whether* a review may be recorded and persists the result.
 */
import { selectDailyFive } from "../core/dailyFive";
import { applyReview } from "../core/scheduler";
import { isDue, localDateKey, shiftDateKey } from "../core/time";
import type { DailySession, Rating, Word } from "../core/types";
import { newId } from "../core/words";
import type { VovelRepository } from "../data/repository";

const RECENT_SESSION_DAYS = 3;

/**
 * Return today's Daily Five session, creating and persisting it on first call.
 * Because the selection is persisted, refreshing never produces a different set.
 */
export async function getOrCreateDailySession(repo: VovelRepository, now: Date): Promise<DailySession> {
  const prefs = await repo.getPreferences();
  const localDate = localDateKey(now, prefs.timezone);
  const existing = await repo.getDailySession(localDate);
  if (existing) return existing;

  const [words, sessions] = await Promise.all([repo.listWords(), repo.listDailySessions()]);
  const recentDates = new Set(
    Array.from({ length: RECENT_SESSION_DAYS }, (_, i) => shiftDateKey(localDate, -(i + 1))),
  );
  const recentlySelectedIds = new Set(
    sessions.filter((s) => recentDates.has(s.localDate)).flatMap((s) => s.selectedWordIds),
  );
  const selectedWordIds = selectDailyFive(words, {
    now,
    timezone: prefs.timezone,
    recentlySelectedIds,
    count: prefs.dailyCount,
  });
  return repo.saveDailySession({
    id: newId(),
    localDate,
    selectedWordIds,
    completedWordIds: [],
    // An empty session has nothing to complete.
    completedAt: null,
    createdAt: now.toISOString(),
  });
}

export type ReviewStatus =
  | { status: "recorded"; word: Word; sessionComplete?: boolean }
  | { status: "duplicate" }
  | { status: "too_soon" }
  | { status: "practice"; word: Word }
  | { status: "not_in_session" }
  | { status: "not_found" };

/** Record a rating for a word in today's Daily Five. Safe to call repeatedly. */
export async function recordDailyReview(
  repo: VovelRepository,
  now: Date,
  wordId: string,
  rating: Rating,
): Promise<ReviewStatus> {
  const session = await getOrCreateDailySession(repo, now);
  if (!session.selectedWordIds.includes(wordId)) return { status: "not_in_session" };
  // Revisiting a completed card (or double-clicking) never records a second review.
  if (session.completedWordIds.includes(wordId)) return { status: "duplicate" };

  const word = await repo.getWord(wordId);
  if (!word) return { status: "not_found" };

  const outcome = applyReview(word, rating, now, `daily:${session.localDate}:${wordId}`, newId);
  if (!outcome.ok) return { status: "too_soon" };

  const stored = await repo.addReviewLog(outcome.log);
  if (!stored) return { status: "duplicate" };
  const updated = await repo.updateSchedule(wordId, outcome.word);

  const completedWordIds = [...session.completedWordIds, wordId];
  const sessionComplete = session.selectedWordIds.every((id) => completedWordIds.includes(id));
  await repo.saveDailySession({
    ...session,
    completedWordIds,
    completedAt: sessionComplete ? now.toISOString() : null,
  });
  return { status: "recorded", word: updated, sessionComplete };
}

/** True when reviewing now would be "studying ahead" of the scheduled date. */
export function isStudyAhead(word: Word, now: Date): boolean {
  return word.nextReviewAt !== null && !isDue(word.nextReviewAt, now);
}

/**
 * Record a rating from the Review Centre. With `studyAhead`, nothing is written, so
 * practising early cannot distort a word's scheduling history.
 */
export async function recordReview(
  repo: VovelRepository,
  now: Date,
  wordId: string,
  rating: Rating,
  options: { studyAhead?: boolean } = {},
): Promise<ReviewStatus> {
  const word = await repo.getWord(wordId);
  if (!word) return { status: "not_found" };
  if (options.studyAhead && isStudyAhead(word, now)) return { status: "practice", word };

  // Keyed on the state being reviewed: re-submitting the same card yields the same key.
  const outcome = applyReview(word, rating, now, `review:${wordId}:${word.lastReviewedAt ?? "never"}`, newId);
  if (!outcome.ok) return { status: "too_soon" };
  const stored = await repo.addReviewLog(outcome.log);
  if (!stored) return { status: "duplicate" };
  return { status: "recorded", word: await repo.updateSchedule(wordId, outcome.word) };
}

export interface ReviewGroups {
  overdue: Word[];
  dueToday: Word[];
  learning: Word[];
  familiar: Word[];
  mastered: Word[];
  newWords: Word[];
}

/** Group words for the Review Centre. Overdue = scheduled before today's local date. */
export function groupForReview(words: Word[], now: Date, timezone: string): ReviewGroups {
  const today = localDateKey(now, timezone);
  const g: ReviewGroups = { overdue: [], dueToday: [], learning: [], familiar: [], mastered: [], newWords: [] };
  for (const w of words) {
    if (w.nextReviewAt) {
      const day = localDateKey(new Date(w.nextReviewAt), timezone);
      if (day < today) g.overdue.push(w);
      else if (day === today) g.dueToday.push(w);
    }
    if (w.learningStatus === "learning") g.learning.push(w);
    else if (w.learningStatus === "familiar") g.familiar.push(w);
    else if (w.learningStatus === "mastered") g.mastered.push(w);
    else g.newWords.push(w);
  }
  g.overdue.sort((a, b) => (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? ""));
  g.dueToday.sort((a, b) => (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? ""));
  return g;
}
