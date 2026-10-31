/**
 * Dictionary lookup against the Free Dictionary API (https://dictionaryapi.dev).
 * Nothing here invents content: every field comes from the API response, and every
 * failure mode is returned as an explicit result instead of fabricated data.
 */
import { normalizeWord } from "./normalize";
import type { NewWordInput } from "./types";

export const DICTIONARY_BASE_URL = "https://api.dictionaryapi.dev/api/v2/entries/en/";
export const DICTIONARY_SOURCE_LABEL = "Free Dictionary API (dictionaryapi.dev)";

export interface DictionaryDefinition {
  definition: string;
  example: string | null;
}

export interface DictionaryMeaning {
  partOfSpeech: string;
  definitions: DictionaryDefinition[];
  synonyms: string[];
  antonyms: string[];
}

export interface DictionaryEntry {
  word: string;
  phonetic: string | null;
  audioUrl: string | null;
  meanings: DictionaryMeaning[];
  etymology: string | null;
  sourceUrls: string[];
}

export type LookupResult =
  | { kind: "found"; entry: DictionaryEntry }
  | { kind: "not_found" }
  | { kind: "rate_limited" }
  | { kind: "network_error"; message: string }
  | { kind: "error"; message: string }
  | { kind: "invalid_query" };

type FetchLike = (input: string, init?: { signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export interface LookupOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => s !== null) : [];
const unique = (xs: string[]) => [...new Set(xs)];

/** Only accept https audio URLs (the API returns protocol-relative URLs on occasion). */
function cleanAudioUrl(raw: string | null): string | null {
  if (!raw) return null;
  const url = raw.startsWith("//") ? `https:${raw}` : raw;
  return url.startsWith("https://") ? url : null;
}

/** Parse the API's JSON array of entries into one merged DictionaryEntry, or null if unusable. */
export function parseDictionaryResponse(data: unknown): DictionaryEntry | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  const entries = data.filter(isRecord);
  if (entries.length === 0) return null;

  const first = entries[0]!;
  const word = str(first.word);
  if (!word) return null;

  let phonetic: string | null = null;
  let audioUrl: string | null = null;
  let etymology: string | null = null;
  const sourceUrls: string[] = [];
  const meanings: DictionaryMeaning[] = [];

  for (const e of entries) {
    phonetic ??= str(e.phonetic);
    etymology ??= str(e.origin);
    sourceUrls.push(...strArray(e.sourceUrls));
    if (Array.isArray(e.phonetics)) {
      for (const p of e.phonetics) {
        if (!isRecord(p)) continue;
        phonetic ??= str(p.text);
        audioUrl ??= cleanAudioUrl(str(p.audio));
      }
    }
    if (!Array.isArray(e.meanings)) continue;
    for (const m of e.meanings) {
      if (!isRecord(m)) continue;
      const partOfSpeech = str(m.partOfSpeech) ?? "unknown";
      const definitions: DictionaryDefinition[] = [];
      const synonyms = strArray(m.synonyms);
      const antonyms = strArray(m.antonyms);
      if (Array.isArray(m.definitions)) {
        for (const d of m.definitions) {
          if (!isRecord(d)) continue;
          const definition = str(d.definition);
          if (!definition) continue;
          definitions.push({ definition, example: str(d.example) });
          synonyms.push(...strArray(d.synonyms));
          antonyms.push(...strArray(d.antonyms));
        }
      }
      if (definitions.length === 0) continue;
      meanings.push({
        partOfSpeech,
        definitions,
        synonyms: unique(synonyms),
        antonyms: unique(antonyms),
      });
    }
  }

  if (meanings.length === 0) return null;
  return { word, phonetic, audioUrl, meanings, etymology, sourceUrls: unique(sourceUrls) };
}

/** Look a word up. Never throws: failures come back as typed results. */
export async function lookupWord(query: string, options: LookupOptions = {}): Promise<LookupResult> {
  const term = normalizeWord(query);
  if (!term || term.length > 60 || /[^\p{L}\p{M}'’ -]/u.test(term)) return { kind: "invalid_query" };

  const fetchImpl: FetchLike | undefined =
    options.fetchImpl ?? (typeof fetch === "function" ? (fetch as unknown as FetchLike) : undefined);
  if (!fetchImpl) return { kind: "network_error", message: "fetch is not available in this environment." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000);
  try {
    const res = await fetchImpl(DICTIONARY_BASE_URL + encodeURIComponent(term), {
      signal: controller.signal,
    });
    if (res.status === 404) return { kind: "not_found" };
    if (res.status === 429) return { kind: "rate_limited" };
    if (!res.ok) return { kind: "error", message: `The dictionary service responded with status ${res.status}.` };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { kind: "error", message: "The dictionary service returned an unreadable response." };
    }
    const entry = parseDictionaryResponse(body);
    // A 200 with no usable definitions is treated the same as no result.
    return entry ? { kind: "found", entry } : { kind: "not_found" };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      kind: "network_error",
      message: aborted ? "The dictionary lookup timed out." : "Could not reach the dictionary service.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface DraftOverrides {
  meaningIndex?: number;
  personalNotes?: string;
  originalContext?: string;
  source?: string;
  collectionId?: string | null;
}

/**
 * Turn a dictionary entry into a NewWordInput. The chosen meaning becomes the
 * definition; example sentences are only those supplied by the dictionary.
 */
export function entryToNewWord(entry: DictionaryEntry, overrides: DraftOverrides = {}): NewWordInput {
  const meaning = entry.meanings[overrides.meaningIndex ?? 0] ?? entry.meanings[0]!;
  const examples = unique(
    entry.meanings.flatMap((m) => m.definitions.map((d) => d.example).filter((x): x is string => x !== null)),
  );
  return {
    word: entry.word,
    definition: meaning.definitions[0]!.definition,
    definitionSource: "dictionary",
    partOfSpeech: meaning.partOfSpeech,
    pronunciation: entry.phonetic,
    audioUrl: entry.audioUrl,
    synonyms: unique(entry.meanings.flatMap((m) => m.synonyms)).slice(0, 12),
    antonyms: unique(entry.meanings.flatMap((m) => m.antonyms)).slice(0, 12),
    exampleSentences: examples.slice(0, 5),
    etymology: entry.etymology,
    personalNotes: overrides.personalNotes ?? "",
    originalContext: overrides.originalContext ?? "",
    source: overrides.source ?? "",
    collectionId: overrides.collectionId ?? null,
  };
}
