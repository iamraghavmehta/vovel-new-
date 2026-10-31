/**
 * Backup export (JSON, CSV) and validated JSON import with preview + confirmation.
 * Import is two-phase: planImport() is pure and changes nothing; applyImport() only
 * runs after the caller has shown the preview and received explicit confirmation.
 * Existing words are never overwritten — duplicates are skipped and reported.
 */
import { normalizeWord } from "../core/normalize";
import { LEARNING_STATUSES, type LearningStatus, type NewWordInput, type ScheduleFields, type Snapshot, type Word } from "../core/types";
import type { VovelRepository } from "../data/repository";

export const EXPORT_APP = "vovel";
export const EXPORT_SCHEMA_VERSION = 1;
export const MAX_IMPORT_WORDS = 20_000;

export interface ExportedWord {
  word: string;
  definition: string;
  definitionSource: "dictionary" | "user";
  partOfSpeech: string | null;
  pronunciation: string | null;
  synonyms: string[];
  antonyms: string[];
  exampleSentences: string[];
  userExample: string;
  personalNotes: string;
  originalContext: string;
  source: string;
  etymology: string | null;
  collection: string | null;
  learningStatus: LearningStatus;
  repetitions: number;
  failedReviews: number;
  consecutiveCorrect: number;
  intervalDays: number;
  easeFactor: number;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
  createdAt: string;
}

export interface ExportFile {
  app: typeof EXPORT_APP;
  schemaVersion: number;
  exportedAt: string;
  collections: { name: string }[];
  words: ExportedWord[];
}

export function buildExport(snapshot: Snapshot, now: Date): ExportFile {
  const names = new Map(snapshot.collections.map((c) => [c.id, c.name]));
  return {
    app: EXPORT_APP,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    collections: snapshot.collections.map((c) => ({ name: c.name })),
    words: snapshot.words.map((w) => ({
      word: w.word,
      definition: w.definition,
      definitionSource: w.definitionSource,
      partOfSpeech: w.partOfSpeech,
      pronunciation: w.pronunciation,
      synonyms: w.synonyms,
      antonyms: w.antonyms,
      exampleSentences: w.exampleSentences,
      userExample: w.userExample,
      personalNotes: w.personalNotes,
      originalContext: w.originalContext,
      source: w.source,
      etymology: w.etymology,
      collection: w.collectionId ? (names.get(w.collectionId) ?? null) : null,
      learningStatus: w.learningStatus,
      repetitions: w.repetitions,
      failedReviews: w.failedReviews,
      consecutiveCorrect: w.consecutiveCorrect,
      intervalDays: w.intervalDays,
      easeFactor: w.easeFactor,
      lastReviewedAt: w.lastReviewedAt,
      nextReviewAt: w.nextReviewAt,
      createdAt: w.createdAt,
    })),
  };
}

export function exportJson(snapshot: Snapshot, now: Date): string {
  return JSON.stringify(buildExport(snapshot, now), null, 2);
}

/** Spreadsheet apps execute cells starting with these characters as formulas. */
function csvCell(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const CSV_HEADERS = [
  "word", "part_of_speech", "definition", "pronunciation", "synonyms", "antonyms",
  "example_sentences", "your_example", "personal_notes", "original_context", "source",
  "collection", "status", "date_added", "last_reviewed", "next_review",
] as const;

/** CSV is for reading/backup in spreadsheets; JSON is the format to re-import. */
export function exportCsv(snapshot: Snapshot): string {
  const names = new Map(snapshot.collections.map((c) => [c.id, c.name]));
  const rows = snapshot.words.map((w: Word) =>
    [
      w.word, w.partOfSpeech ?? "", w.definition, w.pronunciation ?? "",
      w.synonyms.join("; "), w.antonyms.join("; "), w.exampleSentences.join(" | "),
      w.userExample, w.personalNotes, w.originalContext, w.source,
      w.collectionId ? (names.get(w.collectionId) ?? "") : "",
      w.learningStatus, w.createdAt, w.lastReviewedAt ?? "", w.nextReviewAt ?? "",
    ].map(csvCell).join(","),
  );
  return [CSV_HEADERS.join(","), ...rows].join("\r\n");
}

// ---------- Import ----------

export interface ImportedWord {
  input: NewWordInput;
  collectionName: string | null;
  schedule: ScheduleFields | null;
}

export interface ImportIssue {
  index: number;
  message: string;
}

export type ParseResult =
  | { ok: true; words: ImportedWord[]; collections: string[]; invalid: ImportIssue[] }
  | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const isoOrNull = (v: unknown): string | null =>
  typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;
const finite = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

/** Validate a JSON string against the export schema. Never throws. */
export function parseImport(text: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }
  if (!isRecord(data) || data.app !== EXPORT_APP) {
    return { ok: false, error: "This does not look like a VOVEL export file." };
  }
  if (typeof data.schemaVersion !== "number" || data.schemaVersion > EXPORT_SCHEMA_VERSION) {
    return { ok: false, error: "This export was created by a newer, unsupported version of VOVEL." };
  }
  if (!Array.isArray(data.words)) return { ok: false, error: "The file has no words list." };
  if (data.words.length > MAX_IMPORT_WORDS) {
    return { ok: false, error: `Imports are limited to ${MAX_IMPORT_WORDS} words.` };
  }

  const words: ImportedWord[] = [];
  const invalid: ImportIssue[] = [];
  const collectionNames = new Set<string>();
  for (const c of Array.isArray(data.collections) ? data.collections : []) {
    if (isRecord(c) && typeof c.name === "string" && c.name.trim()) collectionNames.add(c.name.trim());
  }

  data.words.forEach((raw: unknown, index: number) => {
    if (!isRecord(raw)) return invalid.push({ index, message: "Entry is not an object." });
    const word = optStr(raw.word).trim();
    const definition = optStr(raw.definition).trim();
    if (!normalizeWord(word)) return invalid.push({ index, message: "Missing word." });
    if (!definition) return invalid.push({ index, message: `"${word}" has no definition.` });
    if (word.length > 120) return invalid.push({ index, message: "Word is too long." });

    const status = LEARNING_STATUSES.includes(raw.learningStatus as LearningStatus)
      ? (raw.learningStatus as LearningStatus)
      : "new";
    const hasSchedule = typeof raw.repetitions === "number" || raw.nextReviewAt != null;
    const collectionName = optStr(raw.collection).trim() || null;
    if (collectionName) collectionNames.add(collectionName);

    words.push({
      collectionName,
      input: {
        word,
        definition,
        definitionSource: raw.definitionSource === "dictionary" ? "dictionary" : "user",
        partOfSpeech: optStr(raw.partOfSpeech) || null,
        pronunciation: optStr(raw.pronunciation) || null,
        synonyms: strList(raw.synonyms),
        antonyms: strList(raw.antonyms),
        exampleSentences: strList(raw.exampleSentences),
        userExample: optStr(raw.userExample),
        personalNotes: optStr(raw.personalNotes),
        originalContext: optStr(raw.originalContext),
        source: optStr(raw.source),
        etymology: optStr(raw.etymology) || null,
        createdAt: isoOrNull(raw.createdAt) ?? undefined,
      },
      schedule: hasSchedule
        ? {
            learningStatus: status,
            repetitions: Math.round(finite(raw.repetitions, 0, 0, 100_000)),
            failedReviews: Math.round(finite(raw.failedReviews, 0, 0, 100_000)),
            consecutiveCorrect: Math.round(finite(raw.consecutiveCorrect, 0, 0, 100_000)),
            intervalDays: finite(raw.intervalDays, 0, 0, 365),
            easeFactor: finite(raw.easeFactor, 2.5, 1.3, 3),
            lastReviewedAt: isoOrNull(raw.lastReviewedAt),
            nextReviewAt: isoOrNull(raw.nextReviewAt),
          }
        : null,
    });
  });

  return { ok: true, words, collections: [...collectionNames], invalid };
}

export interface ImportPlan {
  toAdd: ImportedWord[];
  duplicates: { word: string; reason: "already_saved" | "repeated_in_file" }[];
  invalid: ImportIssue[];
  newCollections: string[];
}

/** Pure preview: what WOULD happen. Nothing is written. */
export function planImport(
  parsed: Extract<ParseResult, { ok: true }>,
  existing: { words: Word[]; collections: { name: string }[] },
): ImportPlan {
  const have = new Set(existing.words.map((w) => w.normalizedWord));
  const seen = new Set<string>();
  const toAdd: ImportedWord[] = [];
  const duplicates: ImportPlan["duplicates"] = [];
  for (const w of parsed.words) {
    const key = normalizeWord(w.input.word);
    if (have.has(key)) duplicates.push({ word: w.input.word, reason: "already_saved" });
    else if (seen.has(key)) duplicates.push({ word: w.input.word, reason: "repeated_in_file" });
    else {
      seen.add(key);
      toAdd.push(w);
    }
  }
  const haveCollections = new Set(existing.collections.map((c) => c.name.toLowerCase()));
  const newCollections = parsed.collections.filter(
    (name) => !haveCollections.has(name.toLowerCase()) && toAdd.some((w) => w.collectionName?.toLowerCase() === name.toLowerCase()),
  );
  return { toAdd, duplicates, invalid: parsed.invalid, newCollections };
}

export interface ImportSummary {
  added: number;
  skippedDuplicates: number;
  invalid: number;
  collectionsCreated: number;
  failed: { word: string; message: string }[];
}

/** Apply a previously previewed plan. Call only after the user confirms. */
export async function applyImport(repo: VovelRepository, plan: ImportPlan): Promise<ImportSummary> {
  const collections = new Map((await repo.listCollections()).map((c) => [c.name.toLowerCase(), c.id]));
  let collectionsCreated = 0;
  for (const name of plan.newCollections) {
    if (collections.has(name.toLowerCase())) continue;
    const c = await repo.createCollection(name);
    collections.set(name.toLowerCase(), c.id);
    collectionsCreated++;
  }

  let added = 0;
  let skippedDuplicates = plan.duplicates.length;
  const failed: ImportSummary["failed"] = [];
  for (const item of plan.toAdd) {
    try {
      const collectionId = item.collectionName ? (collections.get(item.collectionName.toLowerCase()) ?? null) : null;
      const word = await repo.addWord({ ...item.input, collectionId });
      if (item.schedule) await repo.updateSchedule(word.id, item.schedule);
      added++;
    } catch (err) {
      // A duplicate that appeared since the preview is skipped, never overwritten.
      if (err instanceof Error && err.name === "DuplicateWordError") skippedDuplicates++;
      else failed.push({ word: item.input.word, message: err instanceof Error ? err.message : "Unknown error" });
    }
  }
  return { added, skippedDuplicates, invalid: plan.invalid.length, collectionsCreated, failed };
}
