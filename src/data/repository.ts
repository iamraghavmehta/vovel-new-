/**
 * Storage-agnostic data-access interface. The product depends only on this;
 * LocalRepository (browser) and SupabaseRepository (cloud) both implement it.
 */
import type {
  Collection,
  DailySession,
  NewWordInput,
  Preferences,
  ReviewLog,
  ScheduleFields,
  Snapshot,
  Word,
  WordPatch,
} from "../core/types";

export type RepositoryKind = "local" | "cloud";

export class DuplicateWordError extends Error {
  constructor(public readonly existing: Word) {
    super(`"${existing.word}" is already in My Words.`);
    this.name = "DuplicateWordError";
  }
}

export class DuplicateCollectionError extends Error {
  constructor(name: string) {
    super(`A collection named "${name}" already exists.`);
    this.name = "DuplicateCollectionError";
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} was not found.`);
    this.name = "NotFoundError";
  }
}

export interface VovelRepository {
  /** "local" = this browser only; "cloud" = synchronised to the user's account. */
  readonly kind: RepositoryKind;

  // Words
  listWords(): Promise<Word[]>;
  getWord(id: string): Promise<Word | null>;
  findWordByNormalized(normalized: string): Promise<Word | null>;
  /** Throws DuplicateWordError if the normalised word already exists. */
  addWord(input: NewWordInput): Promise<Word>;
  updateWord(id: string, patch: WordPatch): Promise<Word>;
  /** Scheduler / import only. */
  updateSchedule(id: string, schedule: ScheduleFields): Promise<Word>;
  deleteWord(id: string): Promise<void>;

  // Collections
  listCollections(): Promise<Collection[]>;
  createCollection(name: string): Promise<Collection>;
  renameCollection(id: string, name: string): Promise<Collection>;
  /** Removes the collection only; its words are kept and become uncategorised. */
  deleteCollection(id: string): Promise<void>;

  // Reviews
  listReviewLogs(): Promise<ReviewLog[]>;
  /** Returns false (and stores nothing) if `log.dedupeKey` was already recorded. */
  addReviewLog(log: ReviewLog): Promise<boolean>;

  // Daily sessions
  getDailySession(localDate: string): Promise<DailySession | null>;
  listDailySessions(): Promise<DailySession[]>;
  saveDailySession(session: DailySession): Promise<DailySession>;

  // Preferences
  getPreferences(): Promise<Preferences>;
  savePreferences(prefs: Preferences): Promise<Preferences>;

  // Bulk
  exportSnapshot(): Promise<Snapshot>;
  /** Deletes everything in this repository. Callers must obtain explicit confirmation first. */
  clearAll(): Promise<void>;
}
