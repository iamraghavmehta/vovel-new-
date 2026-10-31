/** Dashboard statistics. Every number is derived from stored words, logs and sessions. */
import { lastNDateKeys, localDateKey, shiftDateKey } from "../core/time";
import type { DailySession, ReviewLog, Word } from "../core/types";

export interface DashboardStats {
  totalWords: number;
  dueNow: number;
  /** Words whose first successful recall (hard/good/easy) happened in the last 7 local days. */
  learnedThisWeek: number;
  streakDays: number;
  dailyFive: { selected: number; completed: number; complete: boolean };
  recentlySaved: Word[];
  currentlyLearning: Word[];
  /** Reviews per local day for the last 7 days, oldest first. */
  activity: { date: string; reviews: number }[];
}

export function computeDashboardStats(
  words: Word[],
  logs: ReviewLog[],
  sessions: DailySession[],
  now: Date,
  timezone: string,
): DashboardStats {
  const today = localDateKey(now, timezone);
  const week = lastNDateKeys(now, timezone, 7);
  const weekSet = new Set(week);

  const dayOf = (iso: string) => localDateKey(new Date(iso), timezone);
  const reviewsPerDay = new Map<string, number>();
  const firstCorrect = new Map<string, string>(); // wordId → earliest correct review date
  const sortedLogs = [...logs].sort((a, b) => a.reviewedAt.localeCompare(b.reviewedAt));
  for (const l of sortedLogs) {
    const d = dayOf(l.reviewedAt);
    reviewsPerDay.set(d, (reviewsPerDay.get(d) ?? 0) + 1);
    if (l.wasCorrect && !firstCorrect.has(l.wordId)) firstCorrect.set(l.wordId, d);
  }

  const wordIds = new Set(words.map((w) => w.id));
  const learnedThisWeek = [...firstCorrect.entries()].filter(
    ([id, d]) => wordIds.has(id) && weekSet.has(d),
  ).length;

  // Streak: consecutive days with ≥1 review, ending today — or yesterday if today has none yet.
  let cursor = reviewsPerDay.has(today) ? today : shiftDateKey(today, -1);
  let streakDays = 0;
  while (reviewsPerDay.has(cursor)) {
    streakDays++;
    cursor = shiftDateKey(cursor, -1);
  }

  const session = sessions.find((s) => s.localDate === today);
  const selected = session?.selectedWordIds.length ?? 0;
  const completed = session?.completedWordIds.filter((id) => session.selectedWordIds.includes(id)).length ?? 0;

  return {
    totalWords: words.length,
    dueNow: words.filter((w) => w.nextReviewAt !== null && new Date(w.nextReviewAt) <= now).length,
    learnedThisWeek,
    streakDays,
    dailyFive: { selected, completed, complete: selected > 0 && completed >= selected },
    recentlySaved: [...words].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5),
    currentlyLearning: words.filter((w) => w.learningStatus === "learning").slice(0, 8),
    activity: week.map((date) => ({ date, reviews: reviewsPerDay.get(date) ?? 0 })),
  };
}
