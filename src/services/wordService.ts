import { normalizeWord, suggestSimilar } from "../core/normalize";
import type { NewWordInput, Word } from "../core/types";
import { DuplicateWordError, type VovelRepository } from "../data/repository";

export type SaveWordResult =
  | { status: "saved"; word: Word }
  | { status: "duplicate"; existing: Word };

/** Save a word, or report the existing entry if the normalised word is already saved. */
export async function saveWord(repo: VovelRepository, input: NewWordInput): Promise<SaveWordResult> {
  const existing = await repo.findWordByNormalized(input.word);
  if (existing) return { status: "duplicate", existing };
  try {
    return { status: "saved", word: await repo.addWord(input) };
  } catch (err) {
    if (err instanceof DuplicateWordError) return { status: "duplicate", existing: err.existing };
    throw err;
  }
}

/** Look in the user's saved words (for the "already saved" banner before saving). */
export async function findSaved(repo: VovelRepository, query: string): Promise<Word | null> {
  return repo.findWordByNormalized(normalizeWord(query));
}

export async function similarSavedWords(repo: VovelRepository, query: string): Promise<string[]> {
  const words = await repo.listWords();
  return suggestSimilar(query, words.map((w) => w.word));
}

/** Search the user's own saved words (word, definition, notes, context, source). */
export function searchWords(words: Word[], query: string): Word[] {
  const q = query.trim().toLowerCase();
  if (!q) return words;
  return words.filter((w) =>
    [w.word, w.definition, w.personalNotes, w.originalContext, w.source, w.userExample]
      .join("\n")
      .toLowerCase()
      .includes(q),
  );
}

export type WordSort = "recent" | "alpha" | "oldest" | "nextReview";

export interface WordFilter {
  collectionId?: string | "none" | null;
  status?: Word["learningStatus"] | null;
  dueOnly?: boolean;
  recentDays?: number | null;
  now: Date;
}

export function filterWords(words: Word[], f: WordFilter): Word[] {
  return words.filter((w) => {
    if (f.collectionId === "none" && w.collectionId !== null) return false;
    if (f.collectionId && f.collectionId !== "none" && w.collectionId !== f.collectionId) return false;
    if (f.status && w.learningStatus !== f.status) return false;
    if (f.dueOnly && !(w.nextReviewAt !== null && new Date(w.nextReviewAt) <= f.now)) return false;
    if (f.recentDays && f.now.getTime() - new Date(w.createdAt).getTime() > f.recentDays * 86_400_000) return false;
    return true;
  });
}

export function sortWords(words: Word[], sort: WordSort): Word[] {
  const copy = [...words];
  switch (sort) {
    case "alpha":
      return copy.sort((a, b) => a.normalizedWord.localeCompare(b.normalizedWord));
    case "oldest":
      return copy.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    case "nextReview":
      // Scheduled words first (soonest first); unscheduled words last.
      return copy.sort((a, b) => {
        if (a.nextReviewAt === b.nextReviewAt) return 0;
        if (a.nextReviewAt === null) return 1;
        if (b.nextReviewAt === null) return -1;
        return a.nextReviewAt.localeCompare(b.nextReviewAt);
      });
    case "recent":
    default:
      return copy.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
