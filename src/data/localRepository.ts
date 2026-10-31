/**
 * Local-first repository. Everything lives in ONE browser's storage (by default
 * window.localStorage) and is never sent anywhere. Clearing site data, switching
 * browsers or devices will not carry it over — export a backup or use the cloud
 * migration flow once an account is connected.
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
import {
  DuplicateCollectionError,
  DuplicateWordError,
  NotFoundError,
  type VovelRepository,
} from "./repository";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage for tests and for environments without localStorage. */
export class MemoryStorage implements KeyValueStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

export const LOCAL_STORAGE_KEY = "vovel:v1";
const emptySnapshot = (): Snapshot => ({
  words: [],
  collections: [],
  reviewLogs: [],
  dailySessions: [],
  preferences: { ...DEFAULT_PREFERENCES },
});

export class LocalRepository implements VovelRepository {
  readonly kind = "local" as const;
  private data: Snapshot;

  constructor(
    private readonly storage: KeyValueStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly key: string = LOCAL_STORAGE_KEY,
  ) {
    this.data = this.load();
  }

  private load(): Snapshot {
    const raw = this.storage.getItem(this.key);
    if (!raw) return emptySnapshot();
    try {
      const parsed = JSON.parse(raw) as Partial<Snapshot>;
      return {
        ...emptySnapshot(),
        ...parsed,
        preferences: { ...DEFAULT_PREFERENCES, ...(parsed.preferences ?? {}) },
      };
    } catch {
      // Never silently discard: keep the unreadable payload under a backup key.
      this.storage.setItem(`${this.key}:corrupt-${this.now().getTime()}`, raw);
      return emptySnapshot();
    }
  }

  private persist(): void {
    this.storage.setItem(this.key, JSON.stringify(this.data));
  }

  // ---- Words ----
  async listWords() {
    return structuredClone(this.data.words);
  }
  async getWord(id: string) {
    const w = this.data.words.find((x) => x.id === id);
    return w ? structuredClone(w) : null;
  }
  async findWordByNormalized(normalized: string) {
    const w = this.data.words.find((x) => x.normalizedWord === normalizeWord(normalized));
    return w ? structuredClone(w) : null;
  }
  async addWord(input: NewWordInput): Promise<Word> {
    const word = buildWord(input, newId(), this.now());
    const existing = this.data.words.find((w) => w.normalizedWord === word.normalizedWord);
    if (existing) throw new DuplicateWordError(structuredClone(existing));
    if (word.collectionId && !this.data.collections.some((c) => c.id === word.collectionId)) {
      word.collectionId = null;
    }
    this.data.words.push(word);
    this.persist();
    return structuredClone(word);
  }
  private requireWord(id: string): Word {
    const w = this.data.words.find((x) => x.id === id);
    if (!w) throw new NotFoundError("Word");
    return w;
  }
  async updateWord(id: string, patch: WordPatch): Promise<Word> {
    const w = this.requireWord(id);
    if (patch.collectionId && !this.data.collections.some((c) => c.id === patch.collectionId)) {
      throw new NotFoundError("Collection");
    }
    Object.assign(w, patch, { updatedAt: this.now().toISOString() });
    this.persist();
    return structuredClone(w);
  }
  async updateSchedule(id: string, schedule: ScheduleFields): Promise<Word> {
    const w = this.requireWord(id);
    Object.assign(w, schedule, { updatedAt: this.now().toISOString() });
    this.persist();
    return structuredClone(w);
  }
  async deleteWord(id: string) {
    this.requireWord(id);
    this.data.words = this.data.words.filter((w) => w.id !== id);
    this.data.reviewLogs = this.data.reviewLogs.filter((l) => l.wordId !== id);
    for (const s of this.data.dailySessions) {
      s.selectedWordIds = s.selectedWordIds.filter((x) => x !== id);
      s.completedWordIds = s.completedWordIds.filter((x) => x !== id);
    }
    this.persist();
  }

  // ---- Collections ----
  async listCollections() {
    return structuredClone(this.data.collections);
  }
  private assertUniqueName(name: string, exceptId?: string) {
    const lower = name.trim().toLowerCase();
    if (this.data.collections.some((c) => c.id !== exceptId && c.name.toLowerCase() === lower)) {
      throw new DuplicateCollectionError(name.trim());
    }
  }
  async createCollection(name: string): Promise<Collection> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A collection name is required.");
    this.assertUniqueName(trimmed);
    const c: Collection = { id: newId(), name: trimmed, createdAt: this.now().toISOString() };
    this.data.collections.push(c);
    this.persist();
    return structuredClone(c);
  }
  async renameCollection(id: string, name: string): Promise<Collection> {
    const c = this.data.collections.find((x) => x.id === id);
    if (!c) throw new NotFoundError("Collection");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A collection name is required.");
    this.assertUniqueName(trimmed, id);
    c.name = trimmed;
    this.persist();
    return structuredClone(c);
  }
  async deleteCollection(id: string) {
    if (!this.data.collections.some((c) => c.id === id)) throw new NotFoundError("Collection");
    this.data.collections = this.data.collections.filter((c) => c.id !== id);
    // Words are kept; they simply lose the association.
    for (const w of this.data.words) if (w.collectionId === id) w.collectionId = null;
    this.persist();
  }

  // ---- Reviews ----
  async listReviewLogs() {
    return structuredClone(this.data.reviewLogs);
  }
  async addReviewLog(log: ReviewLog) {
    if (this.data.reviewLogs.some((l) => l.dedupeKey === log.dedupeKey)) return false;
    this.data.reviewLogs.push(structuredClone(log));
    this.persist();
    return true;
  }

  // ---- Daily sessions ----
  async getDailySession(localDate: string) {
    const s = this.data.dailySessions.find((x) => x.localDate === localDate);
    return s ? structuredClone(s) : null;
  }
  async listDailySessions() {
    return structuredClone(this.data.dailySessions);
  }
  async saveDailySession(session: DailySession) {
    const i = this.data.dailySessions.findIndex((s) => s.localDate === session.localDate);
    if (i >= 0) this.data.dailySessions[i] = structuredClone(session);
    else this.data.dailySessions.push(structuredClone(session));
    this.persist();
    return structuredClone(session);
  }

  // ---- Preferences ----
  async getPreferences() {
    return { ...this.data.preferences };
  }
  async savePreferences(prefs: Preferences) {
    this.data.preferences = { ...prefs };
    this.persist();
    return { ...prefs };
  }

  // ---- Bulk ----
  async exportSnapshot() {
    return structuredClone(this.data);
  }
  async clearAll() {
    this.data = emptySnapshot();
    this.storage.removeItem(this.key);
  }
}
