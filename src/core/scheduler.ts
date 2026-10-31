/**
 * Spaced-repetition scheduler — a SIMPLIFIED, SM-2-inspired implementation.
 *
 * It is NOT a scientifically validated optimal learning system. Intervals and
 * multipliers below are sensible MVP defaults; tune them against real review data.
 *
 * Ratings:
 *   again — forgot: failure recorded, streak reset, retry in 10 minutes.
 *   hard  — recalled with difficulty: small interval growth, stays "learning".
 *   good  — recalled: 1 day → 3 days → previous interval × ease.
 *   easy  — recalled instantly: 4 days → 7 days → previous interval × ease × 1.3.
 */
import type { LearningStatus, Rating, ReviewLog, ScheduleFields, Word } from "./types";
import { MS_PER_DAY, MS_PER_MINUTE, addMs } from "./time";

export const INITIAL_EASE = 2.5;
export const MIN_EASE = 1.3;
export const MAX_EASE = 3.0;
export const MAX_INTERVAL_DAYS = 365;
/** Early retry delay after AGAIN. */
export const AGAIN_RETRY_MINUTES = 10;
/** Two reviews of the same word closer together than this are treated as accidental. */
export const MIN_REVIEW_GAP_MS = 5_000;

export const INITIAL_SCHEDULE: ScheduleFields = {
  learningStatus: "new",
  repetitions: 0,
  failedReviews: 0,
  consecutiveCorrect: 0,
  intervalDays: 0,
  easeFactor: INITIAL_EASE,
  lastReviewedAt: null,
  nextReviewAt: null,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export interface ScheduleResult {
  schedule: ScheduleFields;
  wasCorrect: boolean;
}

/** Pure function: compute the next schedule for a word given a rating at `now`. */
export function computeSchedule(
  current: ScheduleFields,
  rating: Rating,
  now: Date,
): ScheduleResult {
  const nowIso = now.toISOString();
  const base = {
    repetitions: current.repetitions + 1,
    lastReviewedAt: nowIso,
  };

  if (rating === "again") {
    return {
      wasCorrect: false,
      schedule: {
        ...base,
        failedReviews: current.failedReviews + 1,
        consecutiveCorrect: 0,
        intervalDays: 0,
        easeFactor: round2(clamp(current.easeFactor - 0.2, MIN_EASE, MAX_EASE)),
        nextReviewAt: addMs(now, AGAIN_RETRY_MINUTES * MS_PER_MINUTE),
        learningStatus: "learning",
      },
    };
  }

  if (rating === "hard") {
    // Recalled, but not enough to count toward the success streak.
    const interval = clamp(Math.max(1, Math.round(current.intervalDays * 1.2)), 1, MAX_INTERVAL_DAYS);
    return {
      wasCorrect: true,
      schedule: {
        ...base,
        failedReviews: current.failedReviews,
        consecutiveCorrect: current.consecutiveCorrect,
        intervalDays: interval,
        easeFactor: round2(clamp(current.easeFactor - 0.15, MIN_EASE, MAX_EASE)),
        nextReviewAt: addMs(now, interval * MS_PER_DAY),
        learningStatus: "learning",
      },
    };
  }

  const streak = current.consecutiveCorrect + 1;
  const ease = round2(clamp(current.easeFactor + (rating === "easy" ? 0.15 : 0), MIN_EASE, MAX_EASE));
  let interval: number;
  if (rating === "good") {
    interval = streak === 1 ? 1 : streak === 2 ? 3 : Math.round(current.intervalDays * ease);
  } else {
    interval = streak === 1 ? 4 : streak === 2 ? 7 : Math.round(current.intervalDays * ease * 1.3);
  }
  // Never shrink the interval on a successful recall, and keep within sane bounds.
  interval = clamp(Math.max(interval, Math.ceil(current.intervalDays) + 1), 1, MAX_INTERVAL_DAYS);

  return {
    wasCorrect: true,
    schedule: {
      ...base,
      failedReviews: current.failedReviews,
      consecutiveCorrect: streak,
      intervalDays: interval,
      easeFactor: ease,
      nextReviewAt: addMs(now, interval * MS_PER_DAY),
      learningStatus: statusFor(interval, streak),
    },
  };
}

/** Status implied by review performance (manual changes remain possible elsewhere). */
export function statusFor(intervalDays: number, consecutiveCorrect: number): LearningStatus {
  if (intervalDays >= 21 && consecutiveCorrect >= 3) return "mastered";
  if (intervalDays >= 6) return "familiar";
  return "learning";
}

export type ReviewOutcome =
  | { ok: true; word: Word; log: ReviewLog }
  | { ok: false; reason: "too_soon" };

/**
 * Apply a rating to a word, producing the updated word and a review log.
 * Rejects a second review of the same word within MIN_REVIEW_GAP_MS so accidental
 * double-clicks cannot schedule a word twice.
 */
export function applyReview(
  word: Word,
  rating: Rating,
  now: Date,
  dedupeKey: string,
  newId: () => string,
): ReviewOutcome {
  if (
    word.lastReviewedAt &&
    now.getTime() - new Date(word.lastReviewedAt).getTime() < MIN_REVIEW_GAP_MS
  ) {
    return { ok: false, reason: "too_soon" };
  }
  const { schedule, wasCorrect } = computeSchedule(word, rating, now);
  const updated: Word = { ...word, ...schedule, updatedAt: now.toISOString() };
  const log: ReviewLog = {
    id: newId(),
    wordId: word.id,
    rating,
    wasCorrect,
    reviewedAt: now.toISOString(),
    nextReviewAt: schedule.nextReviewAt ?? now.toISOString(),
    dedupeKey,
  };
  return { ok: true, word: updated, log };
}
