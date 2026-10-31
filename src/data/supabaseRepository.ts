/**
 * Cloud repository backed by Supabase (PostgREST). Implements the same interface as
 * LocalRepository, so the product code does not change when storage moves to the cloud.
 *
 * STATUS: written against the migration in supabase/migrations and the supabase-js query
 * API, but NOT exercised against a live Supabase project in the build environment (no
 * network access to npm/Supabase). Row-level isolation is verified separately at the SQL
 * level by supabase/tests/rls_test.sql. Treat this adapter as unverified until the
 * integration steps in docs/SUPABASE.md have been run.
 *
 * The client is injected (never constructed here), and it must be created with the
 * public ANON key. The service-role key must never be used in browser code.
 */
import { normalizeWord } from "../core/normalize";
import { buildWord, newId } from "../core/words";
import {
  DEFAULT_PREFERENCES,
  type Collection,
  type DailySession,
  type NewWordInput,
  type Preferences,
  type ReviewLog,
  type ScheduleFields,
  type Snapshot,
  type Word,
  type WordPatch,
} from "../core/types";
import { DuplicateCollectionError, DuplicateWordError, NotFoundError, type VovelRepository } from "./repository";

/* eslint-disable @typescript-eslint/no-explicit-any */
/** The subset of SupabaseClient used here. Pass `createClient(url, anonKey)`. */
export interface SupabaseLike {
  from(table: string): any;
}
type Row = Record<string, any>;
const UNIQUE_VIOLATION = "23505";

function fail(error: { message: string; code?: string } | null, what: string): never {
  throw new Error(`${what}: ${error?.message ?? "unknown error"}`);
}
async function run<T>(q: PromiseLike<{ data: T; error: any }>, what: string): Promise<T> {
  const { data, error } = await q;
  if (error) fail(error, what);
  return data;
}

const toWord = (r: Row): Word => ({
  id: r.id, word: r.word, normalizedWord: r.normalized_word, partOfSpeech: r.part_of_speech,
  pronunciation: r.pronunciation, audioUrl: r.audio_url, definition: r.definition,
  definitionSource: r.definition_source, synonyms: r.synonyms ?? [], antonyms: r.antonyms ?? [],
  exampleSentences: r.example_sentences ?? [], userExample: r.user_example, personalNotes: r.personal_notes,
  originalContext: r.original_context, source: r.source, etymology: r.etymology, collectionId: r.collection_id,
  learningStatus: r.learning_status, repetitions: r.repetitions, failedReviews: r.failed_reviews,
  consecutiveCorrect: r.consecutive_correct, intervalDays: Number(r.interval_days), easeFactor: Number(r.ease_factor),
  lastReviewedAt: r.last_reviewed_at, nextReviewAt: r.next_review_at, createdAt: r.created_at, updatedAt: r.updated_at,
});
const fromWord = (w: Word): Row => ({
  id: w.id, word: w.word, normalized_word: w.normalizedWord, part_of_speech: w.partOfSpeech,
  pronunciation: w.pronunciation, audio_url: w.audioUrl, definition: w.definition,
  definition_source: w.definitionSource, synonyms: w.synonyms, antonyms: w.antonyms,
  example_sentences: w.exampleSentences, user_example: w.userExample, personal_notes: w.personalNotes,
  original_context: w.originalContext, source: w.source, etymology: w.etymology, collection_id: w.collectionId,
  learning_status: w.learningStatus, repetitions: w.repetitions, failed_reviews: w.failedReviews,
  consecutive_correct: w.consecutiveCorrect, interval_days: w.intervalDays, ease_factor: w.easeFactor,
  last_reviewed_at: w.lastReviewedAt, next_review_at: w.nextReviewAt, created_at: w.createdAt,
});
const PATCH_COLUMNS: Record<keyof WordPatch, string> = {
  definition: "definition", definitionSource: "definition_source", partOfSpeech: "part_of_speech",
  pronunciation: "pronunciation", synonyms: "synonyms", antonyms: "antonyms", exampleSentences: "example_sentences",
  userExample: "user_example", personalNotes: "personal_notes", originalContext: "original_context",
  source: "source", collectionId: "collection_id", learningStatus: "learning_status",
};
const SCHEDULE_COLUMNS: Record<keyof ScheduleFields, string> = {
  learningStatus: "learning_status", repetitions: "repetitions", failedReviews: "failed_reviews",
  consecutiveCorrect: "consecutive_correct", intervalDays: "interval_days", easeFactor: "ease_factor",
  lastReviewedAt: "last_reviewed_at", nextReviewAt: "next_review_at",
};
function mapKeys(obj: Record<string, unknown>, cols: Record<string, string>): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) if (k in cols) out[cols[k]!] = v;
  return out;
}

export class SupabaseRepository implements VovelRepository {
  readonly kind = "cloud" as const;
  constructor(private readonly db: SupabaseLike, private readonly userId: string) {}

  // Words
  async listWords() {
    return (await run<Row[]>(this.db.from("words").select("*").order("created_at", { ascending: false }), "List words")).map(toWord);
  }
  async getWord(id: string) {
    const r = await run<Row | null>(this.db.from("words").select("*").eq("id", id).maybeSingle(), "Get word");
    return r ? toWord(r) : null;
  }
  async findWordByNormalized(normalized: string) {
    const r = await run<Row | null>(this.db.from("words").select("*").eq("normalized_word", normalizeWord(normalized)).maybeSingle(), "Find word");
    return r ? toWord(r) : null;
  }
  async addWord(input: NewWordInput): Promise<Word> {
    const word = buildWord(input, newId(), new Date());
    const { data, error } = await this.db.from("words").insert({ ...fromWord(word), user_id: this.userId }).select("*").single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) {
        const existing = await this.findWordByNormalized(word.normalizedWord);
        if (existing) throw new DuplicateWordError(existing);
      }
      fail(error, "Save word");
    }
    return toWord(data);
  }
  async updateWord(id: string, patch: WordPatch) {
    const { data, error } = await this.db.from("words").update(mapKeys(patch as Row, PATCH_COLUMNS)).eq("id", id).select("*").maybeSingle();
    if (error) fail(error, "Update word");
    if (!data) throw new NotFoundError("Word");
    return toWord(data);
  }
  async updateSchedule(id: string, schedule: ScheduleFields) {
    const { data, error } = await this.db.from("words").update(mapKeys(schedule as unknown as Row, SCHEDULE_COLUMNS)).eq("id", id).select("*").maybeSingle();
    if (error) fail(error, "Update schedule");
    if (!data) throw new NotFoundError("Word");
    return toWord(data);
  }
  async deleteWord(id: string) {
    await run(this.db.from("words").delete().eq("id", id), "Delete word"); // review_logs cascade in SQL
  }

  // Collections
  async listCollections(): Promise<Collection[]> {
    const rows = await run<Row[]>(this.db.from("collections").select("*").order("created_at"), "List collections");
    return rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }
  async createCollection(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A collection name is required.");
    const { data, error } = await this.db.from("collections").insert({ name: trimmed, user_id: this.userId }).select("*").single();
    if (error) { if (error.code === UNIQUE_VIOLATION) throw new DuplicateCollectionError(trimmed); fail(error, "Create collection"); }
    return { id: data.id, name: data.name, createdAt: data.created_at };
  }
  async renameCollection(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A collection name is required.");
    const { data, error } = await this.db.from("collections").update({ name: trimmed }).eq("id", id).select("*").maybeSingle();
    if (error) { if (error.code === UNIQUE_VIOLATION) throw new DuplicateCollectionError(trimmed); fail(error, "Rename collection"); }
    if (!data) throw new NotFoundError("Collection");
    return { id: data.id, name: data.name, createdAt: data.created_at };
  }
  async deleteCollection(id: string) {
    await run(this.db.from("collections").delete().eq("id", id), "Delete collection"); // words keep: FK ON DELETE SET NULL
  }

  // Reviews
  async listReviewLogs(): Promise<ReviewLog[]> {
    const rows = await run<Row[]>(this.db.from("review_logs").select("*").order("reviewed_at"), "List reviews");
    return rows.map((r) => ({ id: r.id, wordId: r.word_id, rating: r.rating, wasCorrect: r.was_correct, reviewedAt: r.reviewed_at, nextReviewAt: r.next_review_at, dedupeKey: r.dedupe_key }));
  }
  async addReviewLog(log: ReviewLog) {
    const { error } = await this.db.from("review_logs").insert({
      id: log.id, user_id: this.userId, word_id: log.wordId, rating: log.rating, was_correct: log.wasCorrect,
      reviewed_at: log.reviewedAt, next_review_at: log.nextReviewAt, dedupe_key: log.dedupeKey,
    });
    if (error) { if (error.code === UNIQUE_VIOLATION) return false; fail(error, "Record review"); }
    return true;
  }

  // Daily sessions
  private toSession = (r: Row): DailySession => ({ id: r.id, localDate: r.local_date, selectedWordIds: r.selected_word_ids ?? [], completedWordIds: r.completed_word_ids ?? [], completedAt: r.completed_at, createdAt: r.created_at });
  async getDailySession(localDate: string) {
    const r = await run<Row | null>(this.db.from("daily_sessions").select("*").eq("local_date", localDate).maybeSingle(), "Get session");
    return r ? this.toSession(r) : null;
  }
  async listDailySessions() {
    return (await run<Row[]>(this.db.from("daily_sessions").select("*").order("local_date"), "List sessions")).map(this.toSession);
  }
  async saveDailySession(s: DailySession) {
    const row = { id: s.id, user_id: this.userId, local_date: s.localDate, selected_word_ids: s.selectedWordIds, completed_word_ids: s.completedWordIds, completed_at: s.completedAt, created_at: s.createdAt };
    return this.toSession(await run<Row>(this.db.from("daily_sessions").upsert(row, { onConflict: "user_id,local_date" }).select("*").single(), "Save session"));
  }

  // Preferences (profiles row)
  async getPreferences(): Promise<Preferences> {
    const r = await run<Row | null>(this.db.from("profiles").select("*").eq("id", this.userId).maybeSingle(), "Get preferences");
    if (!r) return { ...DEFAULT_PREFERENCES };
    return { displayName: r.display_name, timezone: r.timezone, goals: r.goals ?? [], dailyCount: r.daily_count, onboardingCompleted: r.onboarding_completed, notificationsEnabled: r.notifications_enabled };
  }
  async savePreferences(p: Preferences) {
    await run(this.db.from("profiles").upsert({ id: this.userId, display_name: p.displayName, timezone: p.timezone, goals: p.goals, daily_count: p.dailyCount, onboarding_completed: p.onboardingCompleted, notifications_enabled: p.notificationsEnabled }), "Save preferences");
    return { ...p };
  }

  // Bulk
  async exportSnapshot(): Promise<Snapshot> {
    const [words, collections, reviewLogs, dailySessions, preferences] = await Promise.all([
      this.listWords(), this.listCollections(), this.listReviewLogs(), this.listDailySessions(), this.getPreferences(),
    ]);
    return { words, collections, reviewLogs, dailySessions, preferences };
  }
  async clearAll() {
    // Collections/words/logs cascade-delete via foreign keys; sessions are separate.
    await run(this.db.from("daily_sessions").delete().eq("user_id", this.userId), "Clear sessions");
    await run(this.db.from("words").delete().eq("user_id", this.userId), "Clear words");
    await run(this.db.from("collections").delete().eq("user_id", this.userId), "Clear collections");
  }
}
