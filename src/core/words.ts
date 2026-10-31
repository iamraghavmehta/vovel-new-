import { normalizeWord } from "./normalize";
import { INITIAL_SCHEDULE } from "./scheduler";
import type { NewWordInput, Word } from "./types";

const clean = (xs: string[] | undefined) =>
  [...new Set((xs ?? []).map((s) => s.trim()).filter(Boolean))];

/** Build a complete Word from user/dictionary input. Throws if the word or definition is empty. */
export function buildWord(input: NewWordInput, id: string, now: Date): Word {
  const word = input.word.trim();
  const normalizedWord = normalizeWord(word);
  if (!normalizedWord) throw new Error("A word is required.");
  const definition = input.definition.trim();
  if (!definition) throw new Error("A definition is required.");
  const ts = now.toISOString();
  const created = input.createdAt && !Number.isNaN(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : ts;
  return {
    id,
    word,
    normalizedWord,
    partOfSpeech: input.partOfSpeech?.trim() || null,
    pronunciation: input.pronunciation?.trim() || null,
    audioUrl: input.audioUrl ?? null,
    definition,
    definitionSource: input.definitionSource ?? "user",
    synonyms: clean(input.synonyms),
    antonyms: clean(input.antonyms),
    exampleSentences: clean(input.exampleSentences),
    userExample: input.userExample?.trim() ?? "",
    personalNotes: input.personalNotes ?? "",
    originalContext: input.originalContext?.trim() ?? "",
    source: input.source?.trim() ?? "",
    etymology: input.etymology ?? null,
    collectionId: input.collectionId ?? null,
    ...INITIAL_SCHEDULE,
    createdAt: created,
    updatedAt: ts,
  };
}

export function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
