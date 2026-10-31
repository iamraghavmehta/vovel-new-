/** Text helpers: duplicate-key normalisation and sentence word extraction. */

/**
 * Canonical key for duplicate detection: Unicode-normalised, lowercased, with
 * surrounding punctuation stripped and inner whitespace collapsed.
 */
export function normalizeWord(input: string): string {
  return input
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");
}

/** True when the string looks like a lookup for one word or a short phrase. */
export function looksLikeSingleTerm(input: string): boolean {
  const n = normalizeWord(input);
  if (!n) return false;
  return n.split(" ").length <= 2 && !/[.!?;:,]/.test(input.trim().replace(/[.!?]+$/, ""));
}

export interface SentenceToken {
  /** The word as written in the sentence. */
  text: string;
  normalized: string;
  /**
   * A cheap guess, NOT a reliable detector: long words that are not in a small
   * stop-list. Used only to pre-highlight candidates; the user always chooses.
   */
  likelyUnfamiliar: boolean;
}

const COMMON_LONG_WORDS = new Set([
  "because", "through", "another", "between", "something", "everything", "without",
  "nothing", "anything", "however", "although", "together", "against", "around",
  "before", "during", "should", "thought", "though", "people", "little", "always",
  "different", "important", "someone", "whether", "himself", "herself", "itself",
  "themselves", "yourself", "myself", "morning", "evening", "tonight", "yesterday",
  "country", "children", "question", "father", "mother", "brother", "sister",
]);

/** Split a pasted sentence into distinct candidate words, in order of appearance. */
export function extractSentenceTokens(sentence: string): SentenceToken[] {
  const matches = sentence.normalize("NFKC").match(/[\p{L}][\p{L}'’-]*/gu) ?? [];
  const seen = new Set<string>();
  const tokens: SentenceToken[] = [];
  for (const raw of matches) {
    const text = raw.replace(/^[-'’]+|[-'’]+$/g, "");
    const normalized = normalizeWord(text);
    if (normalized.length < 2 || seen.has(normalized)) continue;
    seen.add(normalized);
    tokens.push({
      text,
      normalized,
      likelyUnfamiliar: normalized.length >= 8 && !COMMON_LONG_WORDS.has(normalized),
    });
  }
  return tokens;
}

/** Levenshtein distance, early-exiting once `max` is exceeded. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/**
 * Suggest similarly spelled words from a list the caller already owns (e.g. the
 * user's saved words). This does not invent words, it only matches known ones.
 */
export function suggestSimilar(query: string, candidates: string[], limit = 3): string[] {
  const q = normalizeWord(query);
  if (q.length < 3) return [];
  const maxDist = q.length <= 5 ? 1 : 2;
  return candidates
    .map((c) => ({ c, d: editDistance(q, normalizeWord(c), maxDist) }))
    .filter((x) => x.d > 0 && x.d <= maxDist)
    .sort((x, y) => x.d - y.d || x.c.localeCompare(y.c))
    .slice(0, limit)
    .map((x) => x.c);
}
