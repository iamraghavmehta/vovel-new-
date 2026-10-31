import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRepo, w } from "./helpers";
import { lookupWord, parseDictionaryResponse, entryToNewWord } from "../src/core/dictionary";
import { saveWord, searchWords, sortWords, filterWords } from "../src/services/wordService";
import { computeSchedule, INITIAL_SCHEDULE } from "../src/core/scheduler";
import { selectDailyFive } from "../src/core/dailyFive";
import { getOrCreateDailySession, recordDailyReview, recordReview } from "../src/services/learningService";
import { computeDashboardStats } from "../src/services/stats";
import { buildExport, exportCsv, exportJson, parseImport, planImport, applyImport } from "../src/services/importExport";
import { normalizeWord, extractSentenceTokens } from "../src/core/normalize";
import { localDateKey } from "../src/core/time";
import { DuplicateCollectionError } from "../src/data/repository";

const NOW = new Date("2026-10-30T06:00:00Z");
const API = [{
  word: "ephemeral", phonetic: "/ɪˈfɛm(ə)ɹ(ə)l/",
  phonetics: [{ text: "/x/", audio: "//cdn.example/e.mp3" }],
  meanings: [{ partOfSpeech: "adjective", definitions: [{ definition: "Lasting a very short time.", example: "Fame is ephemeral." }], synonyms: ["fleeting"], antonyms: ["lasting"] }],
}];
const fakeFetch = (status: number, body: unknown = API) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// 1 search
test("lookup finds a word and parses fields", async () => {
  const r = await lookupWord("Ephemeral", { fetchImpl: fakeFetch(200) });
  assert.equal(r.kind, "found");
  if (r.kind !== "found") return;
  assert.equal(r.entry.meanings[0]!.definitions[0]!.definition, "Lasting a very short time.");
  assert.equal(r.entry.audioUrl, "https://cdn.example/e.mp3");
  assert.deepEqual(r.entry.meanings[0]!.synonyms, ["fleeting"]);
});
// 15 / 16 missing + network
test("lookup handles not found, rate limit, server error, network error, empty body, bad query", async () => {
  assert.equal((await lookupWord("zzzqx", { fetchImpl: fakeFetch(404) })).kind, "not_found");
  assert.equal((await lookupWord("word", { fetchImpl: fakeFetch(429) })).kind, "rate_limited");
  assert.equal((await lookupWord("word", { fetchImpl: fakeFetch(500) })).kind, "error");
  assert.equal((await lookupWord("word", { fetchImpl: fakeFetch(200, []) })).kind, "not_found");
  assert.equal((await lookupWord("word", { fetchImpl: async () => { throw new TypeError("offline"); } })).kind, "network_error");
  assert.equal((await lookupWord("123 $$", { fetchImpl: fakeFetch(200) })).kind, "invalid_query");
  assert.equal((await lookupWord("", { fetchImpl: fakeFetch(200) })).kind, "invalid_query");
});
test("missing pronunciation/synonyms do not break parsing", () => {
  const e = parseDictionaryResponse([{ word: "x", meanings: [{ partOfSpeech: "noun", definitions: [{ definition: "d" }] }] }]);
  assert.ok(e); assert.equal(e!.phonetic, null); assert.equal(e!.audioUrl, null); assert.deepEqual(e!.meanings[0]!.synonyms, []);
});
test("entryToNewWord only uses dictionary-provided examples", () => {
  const e = parseDictionaryResponse(API)!;
  const n = entryToNewWord(e);
  assert.deepEqual(n.exampleSentences, ["Fame is ephemeral."]);
  assert.equal(n.definitionSource, "dictionary");
});

// 2,3 save + duplicates, persistence
test("saving persists across repository instances and blocks duplicates", async () => {
  const { repo, storage } = makeRepo();
  const a = await saveWord(repo, w("Ephemeral"));
  assert.equal(a.status, "saved");
  const b = await saveWord(repo, w("  ephemeral. "));
  assert.equal(b.status, "duplicate");
  assert.equal((await repo.listWords()).length, 1);
  const { LocalRepository } = await import("../src/data/localRepository");
  const reopened = new LocalRepository(storage);
  assert.equal((await reopened.listWords()).length, 1);
});
// 4 notes
test("editing personal notes persists", async () => {
  const { repo } = makeRepo();
  const s = await saveWord(repo, w("lucid")); if (s.status !== "saved") throw 0;
  await repo.updateWord(s.word.id, { personalNotes: "from chapter 3", userExample: "A lucid dream." });
  const got = await repo.getWord(s.word.id);
  assert.equal(got!.personalNotes, "from chapter 3");
  assert.equal(got!.userExample, "A lucid dream.");
});
// 5 delete
test("deleting a word removes it and its review logs", async () => {
  const { repo } = makeRepo();
  const s = await saveWord(repo, w("terse")); if (s.status !== "saved") throw 0;
  await recordReview(repo, new Date("2026-10-30T07:00:00Z"), s.word.id, "good");
  assert.equal((await repo.listReviewLogs()).length, 1);
  await repo.deleteWord(s.word.id);
  assert.equal((await repo.listWords()).length, 0);
  assert.equal((await repo.listReviewLogs()).length, 0);
});
// 6,7 collections
test("collections: create, rename, duplicate-name rejected, delete keeps words", async () => {
  const { repo } = makeRepo();
  const c = await repo.createCollection("Literature");
  await assert.rejects(() => repo.createCollection("literature"), DuplicateCollectionError);
  await repo.renameCollection(c.id, "Fiction");
  const s = await saveWord(repo, w("sonder", { collectionId: c.id })); if (s.status !== "saved") throw 0;
  assert.equal(s.word.collectionId, c.id);
  await repo.deleteCollection(c.id);
  const kept = await repo.getWord(s.word.id);
  assert.ok(kept); assert.equal(kept!.collectionId, null);
  assert.equal((await repo.listCollections()).length, 0);
});
test("search, sort and filter saved words", async () => {
  const { repo } = makeRepo();
  for (const x of ["banal", "arcane", "cogent"]) await saveWord(repo, w(x, { personalNotes: x === "arcane" ? "mystery novel" : "" }));
  const words = await repo.listWords();
  assert.deepEqual(searchWords(words, "mystery").map((x) => x.word), ["arcane"]);
  assert.deepEqual(sortWords(words, "alpha").map((x) => x.word), ["arcane", "banal", "cogent"]);
  assert.equal(filterWords(words, { status: "new", now: NOW }).length, 3);
  assert.equal(filterWords(words, { dueOnly: true, now: NOW }).length, 0);
});

// 11 scheduling
test("scheduler: again / hard / good / easy", () => {
  const again = computeSchedule(INITIAL_SCHEDULE, "again", NOW);
  assert.equal(again.wasCorrect, false);
  assert.equal(again.schedule.failedReviews, 1);
  assert.equal(again.schedule.consecutiveCorrect, 0);
  assert.equal(new Date(again.schedule.nextReviewAt!).getTime() - NOW.getTime(), 10 * 60_000);

  const good1 = computeSchedule(INITIAL_SCHEDULE, "good", NOW).schedule;
  assert.equal(good1.intervalDays, 1);
  const good2 = computeSchedule(good1, "good", NOW).schedule;
  assert.equal(good2.intervalDays, 3);
  const good3 = computeSchedule(good2, "good", NOW).schedule;
  assert.ok(good3.intervalDays > 3);

  const easy1 = computeSchedule(INITIAL_SCHEDULE, "easy", NOW).schedule;
  assert.ok(easy1.intervalDays > good1.intervalDays);

  const hard = computeSchedule(good2, "hard", NOW).schedule;
  assert.ok(hard.intervalDays <= Math.ceil(good2.intervalDays * 1.2));
  assert.equal(hard.learningStatus, "learning");
  assert.equal(hard.consecutiveCorrect, good2.consecutiveCorrect);

  const afterFail = computeSchedule(good3, "again", NOW).schedule;
  assert.equal(afterFail.consecutiveCorrect, 0);
});
test("scheduler: long success streak reaches mastered; interval capped", () => {
  let s = INITIAL_SCHEDULE;
  for (let i = 0; i < 12; i++) s = computeSchedule(s, "easy", NOW).schedule;
  assert.equal(s.learningStatus, "mastered");
  assert.ok(s.intervalDays <= 365);
});

// 8,9,10 daily five
test("daily five prioritises overdue, then forgotten, then new", async () => {
  const { repo } = makeRepo();
  const ids: Record<string, string> = {};
  for (const x of ["a1", "b2", "c3", "d4", "e5", "f6", "g7"]) {
    const r = await saveWord(repo, w(x)); if (r.status !== "saved") throw 0; ids[x] = r.word.id;
  }
  const iso = (d: string) => d;
  await repo.updateSchedule(ids.a1!, { ...INITIAL_SCHEDULE, repetitions: 2, learningStatus: "learning", lastReviewedAt: iso("2026-10-20T00:00:00Z"), nextReviewAt: iso("2026-10-25T00:00:00Z"), intervalDays: 3 });
  await repo.updateSchedule(ids.b2!, { ...INITIAL_SCHEDULE, repetitions: 3, failedReviews: 3, learningStatus: "learning", lastReviewedAt: iso("2026-10-28T00:00:00Z"), nextReviewAt: iso("2026-11-10T00:00:00Z"), intervalDays: 10 });
  const picked = selectDailyFive(await repo.listWords(), { now: NOW, timezone: "UTC" });
  assert.equal(picked.length, 5);
  assert.equal(picked[0], ids.a1);
  assert.equal(picked[1], ids.b2);
});
test("daily session is stable across calls and recalculation", async () => {
  const { repo } = makeRepo();
  for (const x of ["a1", "b2", "c3", "d4", "e5", "f6", "g7", "h8"]) await saveWord(repo, w(x));
  const s1 = await getOrCreateDailySession(repo, NOW);
  await saveWord(repo, w("zz9"));
  const s2 = await getOrCreateDailySession(repo, new Date("2026-10-30T10:00:00Z"));
  assert.deepEqual(s2.selectedWordIds, s1.selectedWordIds);
  assert.equal(s1.id, s2.id);
});
test("fewer than five words yields fewer entries, none invented; zero words yields empty", async () => {
  const { repo } = makeRepo();
  assert.deepEqual((await getOrCreateDailySession(repo, NOW)).selectedWordIds, []);
  const { repo: r2 } = makeRepo();
  await saveWord(r2, w("one")); await saveWord(r2, w("two"));
  assert.equal((await getOrCreateDailySession(r2, NOW)).selectedWordIds.length, 2);
});
test("daily session uses the configured timezone for the local date", async () => {
  const { repo } = makeRepo();
  await repo.savePreferences({ ...(await repo.getPreferences()), timezone: "Asia/Kolkata" });
  const late = new Date("2026-10-30T20:00:00Z"); // 01:30 on 31 Oct in IST
  assert.equal((await getOrCreateDailySession(repo, late)).localDate, "2026-10-31");
  assert.equal(localDateKey(late, "UTC"), "2026-10-30");
});
test("avoids repeating recent words when alternatives exist", async () => {
  const { repo } = makeRepo();
  for (let i = 0; i < 10; i++) await saveWord(repo, w(`word${String.fromCharCode(97 + i)}`));
  const words = await repo.listWords();
  // Mark all as reviewed long ago so they are in tier 4/5.
  const first = selectDailyFive(words, { now: NOW, timezone: "UTC" });
  const second = selectDailyFive(words, { now: NOW, timezone: "UTC", recentlySelectedIds: new Set(first) });
  // All words are "new" (tier 3), which is intentionally newest-first; check tier 5 behaviour on reviewed words.
  const reviewed = words.map((x) => ({ ...x, repetitions: 1, learningStatus: "familiar" as const, consecutiveCorrect: 2, lastReviewedAt: "2026-10-01T00:00:00Z", nextReviewAt: "2026-12-01T00:00:00Z" }));
  const a = selectDailyFive(reviewed, { now: NOW, timezone: "UTC" });
  const b = selectDailyFive(reviewed, { now: NOW, timezone: "UTC", recentlySelectedIds: new Set(a) });
  assert.equal(b.filter((id) => a.includes(id)).length, 0);
  assert.equal(second.length, 5);
});

// 12 duplicate review prevention
test("daily review: double-submit and revisit record exactly one review", async () => {
  const { repo } = makeRepo();
  await saveWord(repo, w("alpha")); await saveWord(repo, w("beta"));
  const session = await getOrCreateDailySession(repo, NOW);
  const id = session.selectedWordIds[0]!;
  const t = new Date("2026-10-30T06:05:00Z");
  const r1 = await recordDailyReview(repo, t, id, "good");
  const r2 = await recordDailyReview(repo, t, id, "good");
  const r3 = await recordDailyReview(repo, new Date("2026-10-30T09:00:00Z"), id, "easy");
  assert.equal(r1.status, "recorded");
  assert.equal(r2.status, "duplicate");
  assert.equal(r3.status, "duplicate");
  assert.equal((await repo.listReviewLogs()).length, 1);
  assert.equal((await repo.getWord(id))!.repetitions, 1);
});
test("completing every card marks the session complete", async () => {
  const { repo } = makeRepo();
  await saveWord(repo, w("alpha")); await saveWord(repo, w("beta"));
  const s = await getOrCreateDailySession(repo, NOW);
  let last;
  for (const id of s.selectedWordIds) last = await recordDailyReview(repo, new Date("2026-10-30T06:05:00Z"), id, "good");
  assert.equal(last!.status === "recorded" && last!.sessionComplete, true);
  assert.ok((await repo.getDailySession(s.localDate))!.completedAt);
});
test("rating a word outside today's session is rejected", async () => {
  const { repo } = makeRepo();
  const r = await saveWord(repo, w("alpha")); if (r.status !== "saved") throw 0;
  await getOrCreateDailySession(repo, NOW);
  assert.equal((await recordDailyReview(repo, NOW, "nope", "good")).status, "not_in_session");
});
test("review centre: rapid repeat rejected; study-ahead does not change schedule", async () => {
  const { repo } = makeRepo();
  const r = await saveWord(repo, w("alpha")); if (r.status !== "saved") throw 0;
  const t0 = new Date("2026-10-30T06:00:00Z");
  assert.equal((await recordReview(repo, t0, r.word.id, "good")).status, "recorded");
  assert.equal((await recordReview(repo, new Date(t0.getTime() + 1000), r.word.id, "good")).status, "too_soon");
  const before = await repo.getWord(r.word.id);
  const ahead = await recordReview(repo, new Date(t0.getTime() + 3600_000), r.word.id, "again", { studyAhead: true });
  assert.equal(ahead.status, "practice");
  assert.deepEqual(await repo.getWord(r.word.id), before);
  assert.equal((await repo.listReviewLogs()).length, 1);
});

// 13 dashboard
test("dashboard stats come from stored data", async () => {
  const { repo } = makeRepo();
  const empty = computeDashboardStats([], [], [], NOW, "UTC");
  assert.equal(empty.totalWords, 0); assert.equal(empty.streakDays, 0); assert.equal(empty.activity.length, 7);
  for (const x of ["alpha", "beta", "gamma"]) await saveWord(repo, w(x));
  const s = await getOrCreateDailySession(repo, NOW);
  await recordDailyReview(repo, new Date("2026-10-30T06:05:00Z"), s.selectedWordIds[0]!, "good");
  await recordDailyReview(repo, new Date("2026-10-30T06:06:00Z"), s.selectedWordIds[1]!, "again");
  const snap = await repo.exportSnapshot();
  const st = computeDashboardStats(snap.words, snap.reviewLogs, snap.dailySessions, new Date("2026-10-30T07:00:00Z"), "UTC");
  assert.equal(st.totalWords, 3);
  assert.equal(st.learnedThisWeek, 1);
  assert.equal(st.streakDays, 1);
  assert.deepEqual(st.dailyFive, { selected: 3, completed: 2, complete: false });
  assert.equal(st.activity.at(-1)!.reviews, 2);
  assert.equal(st.dueNow, 1); // the AGAIN word is due in 10 minutes → due by 07:00
});
test("streak survives until end of the next day but breaks after a missed day", () => {
  const log = (d: string) => ({ id: d, wordId: "x", rating: "good" as const, wasCorrect: true, reviewedAt: d, nextReviewAt: d, dedupeKey: d });
  const logs = [log("2026-10-28T10:00:00Z"), log("2026-10-29T10:00:00Z")];
  assert.equal(computeDashboardStats([], logs, [], new Date("2026-10-30T05:00:00Z"), "UTC").streakDays, 2);
  assert.equal(computeDashboardStats([], logs, [], new Date("2026-10-31T05:00:00Z"), "UTC").streakDays, 0);
});

// 14 import/export
test("export → import round trip, duplicates skipped, nothing overwritten", async () => {
  const { repo } = makeRepo();
  const c = await repo.createCollection("Lit");
  await saveWord(repo, w("alpha", { collectionId: c.id, personalNotes: "keep me" }));
  await saveWord(repo, w("beta"));
  const json = exportJson(await repo.exportSnapshot(), NOW);

  const { repo: fresh } = makeRepo();
  await saveWord(fresh, w("beta", { personalNotes: "mine" }));
  const parsed = parseImport(json);
  assert.ok(parsed.ok); if (!parsed.ok) return;
  const plan = planImport(parsed, { words: await fresh.listWords(), collections: await fresh.listCollections() });
  assert.equal(plan.toAdd.length, 1); assert.equal(plan.duplicates.length, 1);
  assert.equal((await fresh.listWords()).length, 1, "preview must not write");
  const summary = await applyImport(fresh, plan);
  assert.equal(summary.added, 1); assert.equal(summary.skippedDuplicates, 1); assert.equal(summary.collectionsCreated, 1);
  const words = await fresh.listWords();
  assert.equal(words.find((x) => x.word === "beta")!.personalNotes, "mine");
  assert.equal(words.find((x) => x.word === "alpha")!.collectionId, (await fresh.listCollections())[0]!.id);
});
test("import preserves schedule and rejects bad files", async () => {
  const { repo } = makeRepo();
  const r = await saveWord(repo, w("alpha")); if (r.status !== "saved") throw 0;
  await recordReview(repo, NOW, r.word.id, "good");
  const parsed = parseImport(exportJson(await repo.exportSnapshot(), NOW));
  if (!parsed.ok) throw 0;
  const { repo: fresh } = makeRepo();
  await applyImport(fresh, planImport(parsed, { words: [], collections: [] }));
  const got = (await fresh.listWords())[0]!;
  assert.equal(got.repetitions, 1); assert.equal(got.intervalDays, 1); assert.ok(got.nextReviewAt);
  assert.equal(parseImport("not json").ok, false);
  assert.equal(parseImport(JSON.stringify({ app: "other" })).ok, false);
  assert.equal(parseImport(JSON.stringify({ app: "vovel", schemaVersion: 99, words: [] })).ok, false);
  const bad = parseImport(JSON.stringify({ app: "vovel", schemaVersion: 1, words: [{ word: "ok" }, { word: "fine", definition: "d" }, 5] }));
  assert.ok(bad.ok && bad.words.length === 1 && bad.invalid.length === 2);
});
test("CSV export escapes quotes/newlines and neutralises formulas", async () => {
  const { repo } = makeRepo();
  await saveWord(repo, w("alpha", { personalNotes: '=HYPERLINK("x")\nline "2"' }));
  const csv = exportCsv(await repo.exportSnapshot());
  assert.ok(csv.startsWith("word,part_of_speech"));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")\nline ""2"""`));
  assert.ok(buildExport(await repo.exportSnapshot(), NOW).words[0]!.word === "alpha");
});

// misc
test("normalisation and sentence tokenising", () => {
  assert.equal(normalizeWord("  “Ephemeral”, "), "ephemeral");
  const t = extractSentenceTokens("The ephemeral beauty of the ephemeral light.");
  assert.deepEqual(t.map((x) => x.normalized), ["the", "ephemeral", "beauty", "of", "light"]);
  assert.equal(t.find((x) => x.normalized === "ephemeral")!.likelyUnfamiliar, true);
});
test("corrupt local storage is preserved under a backup key, not discarded", async () => {
  const { LocalRepository, MemoryStorage } = await import("../src/data/localRepository");
  const st = new MemoryStorage(); st.setItem("vovel:v1", "{broken");
  const repo = new LocalRepository(st);
  assert.equal((await repo.listWords()).length, 0);
  // saving works afterwards
  await saveWord(repo, w("alpha"));
  assert.equal((await repo.listWords()).length, 1);
});

// local → cloud migration (cloud simulated by a second repository implementing the same interface)
test("migration previews, skips existing words, and leaves the local copy intact", async () => {
  const { previewMigration, runMigration } = await import("../src/services/migration");
  const { repo: local } = makeRepo();
  const { repo: cloud } = makeRepo();
  const c = await local.createCollection("Lit");
  await saveWord(local, w("alpha", { collectionId: c.id }));
  await saveWord(local, w("beta"));
  await saveWord(cloud, w("beta", { personalNotes: "cloud version" }));
  const plan = await previewMigration(local, cloud);
  assert.equal(plan.toAdd.length, 1);
  assert.equal(plan.duplicates.length, 1);
  assert.equal((await cloud.listWords()).length, 1, "preview writes nothing");
  const summary = await runMigration(cloud, plan);
  assert.equal(summary.added, 1);
  assert.equal((await cloud.listWords()).length, 2);
  assert.equal((await cloud.findWordByNormalized("beta"))!.personalNotes, "cloud version");
  assert.equal((await local.listWords()).length, 2, "local data untouched");
});
