import { LocalRepository, MemoryStorage } from "../src/data/localRepository";
import type { NewWordInput } from "../src/core/types";

export function makeRepo(now: () => Date = () => new Date("2026-10-30T06:00:00Z")) {
  const storage = new MemoryStorage();
  return { repo: new LocalRepository(storage, now), storage };
}

export const w = (word: string, extra: Partial<NewWordInput> = {}): NewWordInput => ({
  word,
  definition: `definition of ${word}`,
  ...extra,
});
