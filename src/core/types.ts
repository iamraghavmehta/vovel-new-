/**
 * VOVEL domain types. Pure data — no framework or storage imports.
 * All timestamps are ISO-8601 UTC strings. Local calendar dates (daily sessions)
 * are "YYYY-MM-DD" strings computed in the user's configured timezone.
 */

export const LEARNING_STATUSES = ["new", "learning", "familiar", "mastered"] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export const RATINGS = ["again", "hard", "good", "easy"] as const;
export type Rating = (typeof RATINGS)[number];

export interface Word {
  id: string;
  word: string;
  /** Lowercased, trimmed key used for duplicate prevention. */
  normalizedWord: string;
  partOfSpeech: string | null;
  pronunciation: string | null;
  audioUrl: string | null;
  definition: string;
  /** Where `definition` came from: a dictionary API or typed by the user. */
  definitionSource: "dictionary" | "user";
  synonyms: string[];
  antonyms: string[];
  /** Example sentences from the dictionary (never fabricated). */
  exampleSentences: string[];
  /** The user's own example sentence for this word. */
  userExample: string;
  personalNotes: string;
  /** Sentence / passage where the user met the word. */
  originalContext: string;
  /** Book, article, or other source title supplied by the user. */
  source: string;
  etymology: string | null;
  collectionId: string | null;
  learningStatus: LearningStatus;
  /** Number of recorded reviews. */
  repetitions: number;
  failedReviews: number;
  consecutiveCorrect: number;
  intervalDays: number;
  easeFactor: number;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields a caller supplies when saving a new word; the rest are derived. */
export interface NewWordInput {
  word: string;
  definition: string;
  definitionSource?: "dictionary" | "user";
  partOfSpeech?: string | null;
  pronunciation?: string | null;
  audioUrl?: string | null;
  synonyms?: string[];
  antonyms?: string[];
  exampleSentences?: string[];
  userExample?: string;
  personalNotes?: string;
  originalContext?: string;
  source?: string;
  etymology?: string | null;
  collectionId?: string | null;
  /** Preserved when importing a backup; otherwise set to the save time. */
  createdAt?: string;
}

export type WordPatch = Partial<
  Pick<
    Word,
    | "definition"
    | "definitionSource"
    | "partOfSpeech"
    | "pronunciation"
    | "synonyms"
    | "antonyms"
    | "exampleSentences"
    | "userExample"
    | "personalNotes"
    | "originalContext"
    | "source"
    | "collectionId"
    | "learningStatus"
  >
>;

/** Scheduling fields — written only by the scheduler (and by import). */
export type ScheduleFields = Pick<
  Word,
  | "learningStatus"
  | "repetitions"
  | "failedReviews"
  | "consecutiveCorrect"
  | "intervalDays"
  | "easeFactor"
  | "lastReviewedAt"
  | "nextReviewAt"
>;

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
}

export interface ReviewLog {
  id: string;
  wordId: string;
  rating: Rating;
  wasCorrect: boolean;
  reviewedAt: string;
  nextReviewAt: string;
  /**
   * Idempotency key, e.g. `daily:2026-10-29:<wordId>`. A key can be stored at most
   * once, which is what prevents duplicate review records on refresh / double-click.
   */
  dedupeKey: string;
}

export interface DailySession {
  id: string;
  localDate: string;
  selectedWordIds: string[];
  completedWordIds: string[];
  completedAt: string | null;
  createdAt: string;
}

export interface Preferences {
  displayName: string;
  timezone: string;
  goals: string[];
  dailyCount: number;
  onboardingCompleted: boolean;
  /** True only after the browser has actually granted notification permission. */
  notificationsEnabled: boolean;
}

export interface Snapshot {
  words: Word[];
  collections: Collection[];
  reviewLogs: ReviewLog[];
  dailySessions: DailySession[];
  preferences: Preferences;
}

export const DEFAULT_PREFERENCES: Preferences = {
  displayName: "",
  timezone: "UTC",
  goals: [],
  dailyCount: 5,
  onboardingCompleted: false,
  notificationsEnabled: false,
};
