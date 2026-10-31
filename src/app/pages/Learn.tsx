import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Rating, Word } from "../../core/types";
import { getOrCreateDailySession, groupForReview, isStudyAhead, recordDailyReview, recordReview } from "../../services/learningService";
import { go, useStore } from "../store";
import { Empty, fmtDate, PageHead, StatusPill, WordRow } from "../ui";

const RATINGS: { r: Rating; label: string; hint: string; key: string }[] = [
  { r: "again", label: "Again", hint: "I forgot", key: "1" },
  { r: "hard", label: "Hard", hint: "I struggled", key: "2" },
  { r: "good", label: "Good", hint: "I remembered", key: "3" },
  { r: "easy", label: "Easy", hint: "Immediately", key: "4" },
];

export interface CardResult { word: Word; rating: Rating }

/** One recall card at a time: prompt → reveal → rate. Ratings are submitted once per card. */
function CardFlow({ words, submit, onDone, label }: {
  words: Word[];
  submit: (w: Word, r: Rating) => Promise<{ ok: boolean; note?: string }>;
  onDone: (results: CardResult[]) => void;
  label: string;
}) {
  const [i, setI] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<CardResult[]>([]);
  const revealBtn = useRef<HTMLButtonElement>(null);
  const word = words[i];

  useEffect(() => { setRevealed(false); setTimeout(() => revealBtn.current?.focus(), 0); }, [i]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (!revealed && (e.key === " " || e.key === "Enter") && (e.target as HTMLElement)?.tagName !== "BUTTON") { e.preventDefault(); setRevealed(true); }
      const m = RATINGS.find((x) => x.key === e.key);
      if (revealed && m) void rate(m.r);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function rate(r: Rating) {
    if (busy || !word) return;
    setBusy(true);
    const res = await submit(word, r);
    setBusy(false);
    const next = [...results, { word, rating: r }];
    setResults(next);
    if (i + 1 >= words.length) onDone(next); else setI(i + 1);
  }
  if (!word) return null;
  const example = word.userExample || word.exampleSentences[0] || word.originalContext;

  return (
    <section className="flash" aria-label={label}>
      <div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={words.length} aria-valuenow={i} aria-label="Session progress"><span style={{ width: `${(i / words.length) * 100}%` }} /></div>
      <p className="muted center">{i + 1} of {words.length}</p>
      <h2 className="flash-word serif">{word.word}</h2>
      {word.pronunciation && <p className="muted center">{word.pronunciation}</p>}
      {!revealed ? (
        <>
          <p className="center muted">What does <strong>{word.word}</strong> mean? Try to recall it first.</p>
          <div className="center"><button ref={revealBtn} className="btn btn-primary btn-lg" onClick={() => setRevealed(true)}>Reveal meaning</button></div>
          <p className="center muted small kbd-hint">Press Space to reveal</p>
        </>
      ) : (
        <div className="reveal">
          {word.partOfSpeech && <p className="center muted"><em>{word.partOfSpeech}</em></p>}
          <p className="flash-def">{word.definition}</p>
          <p className="flash-example">{example ? <>“{example}”</> : <span className="muted">No example saved yet — add your own on the word’s page.</span>}</p>
          <p className="center muted small">How well did you recall it?</p>
          <div className="ratings" role="group" aria-label="Rate your recall">
            {RATINGS.map((x) => (
              <button key={x.r} className={`btn rate rate-${x.r}`} disabled={busy} onClick={() => rate(x.r)}>
                <strong>{x.label}</strong><small>{x.hint}</small><kbd>{x.key}</kbd>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Summary({ results, title, extra }: { results: CardResult[]; title: string; extra?: React.ReactNode }) {
  const ok = results.filter((r) => r.rating !== "again").length;
  const practice = results.filter((r) => r.rating === "again" || r.rating === "hard");
  return (
    <section className="card summary success-pop">
      <h2>{title}</h2>
      <div className="stat-row">
        <div><b>{results.length}</b><span>reviewed</span></div>
        <div><b>{ok}</b><span>recalled</span></div>
        <div><b>{practice.length}</b><span>need more practice</span></div>
      </div>
      {practice.length > 0 && <p className="muted">To revisit: {practice.map((r) => r.word.word).join(", ")}. They’ll come back sooner.</p>}
      {extra}
      <div className="row"><a className="btn btn-primary" href="#/">Back home</a><a className="btn" href="#/words">My Words</a></div>
    </section>
  );
}

export function DailyFive() {
  const { repo, snap, reload, now, notify } = useStore();
  const [ids, setIds] = useState<string[] | null>(null);
  const [done, setDone] = useState<CardResult[] | null>(null);
  const [started, setStarted] = useState(false);
  const [completedBefore, setCompletedBefore] = useState<string[]>([]);
  const [localDate, setLocalDate] = useState("");

  useEffect(() => { void (async () => {
    const s = await getOrCreateDailySession(repo, now());
    setIds(s.selectedWordIds); setCompletedBefore(s.completedWordIds); setLocalDate(s.localDate); await reload();
  })(); }, [repo]);

  if (!snap || !ids) return <p className="muted">Preparing today’s words…</p>;
  const all = ids.map((id) => snap.words.find((w) => w.id === id)).filter((w): w is Word => !!w);
  const remaining = all.filter((w) => !completedBefore.includes(w.id));
  const total = snap.words.length;
  const target = snap.preferences.dailyCount;

  if (all.length === 0) return (
    <>
      <PageHead title="Daily Five" sub="A small, focused session from your own vocabulary." />
      <Empty title="No words to practise yet">Save a few words you’ve met while reading and your Daily Five will appear here tomorrow — or right now.<div><a className="btn btn-primary" href="#/discover">Add a word</a></div></Empty>
    </>
  );

  if (done) return <><PageHead title="Daily Five" /><Summary results={done} title="Session complete" /></>;

  if (remaining.length === 0 || (!started && completedBefore.length > 0 && remaining.length === 0)) {
    return (
      <>
        <PageHead title="Daily Five" sub={`Today · ${localDate}`} />
        <section className="card success-pop">
          <h2>Today’s session is complete</h2>
          <p className="muted">You reviewed {all.length} word{all.length === 1 ? "" : "s"} today. Revisiting them below does not record extra reviews.</p>
          <div className="list">{all.map((w) => <WordRow key={w.id} word={w} now={now()} tz={snap.preferences.timezone} />)}</div>
        </section>
      </>
    );
  }

  return (
    <>
      <PageHead title="Daily Five" sub={`Today · ${all.length} word${all.length === 1 ? "" : "s"} chosen from your vocabulary`} />
      {all.length < target && (
        <div className="banner banner-info">You have {total} saved word{total === 1 ? "" : "s"}, so today’s session has {all.length}. Save {target - all.length} more to fill a full Daily Five. <a href="#/discover">Add a word</a></div>
      )}
      {!started ? (
        <section className="card">
          <h2>{remaining.length === all.length ? "Ready when you are" : `Continue — ${remaining.length} left`}</h2>
          <ol className="plain">{remaining.map((w) => <li key={w.id}><span className="serif">{w.word}</span> <StatusPill status={w.learningStatus} /></li>)}</ol>
          <button className="btn btn-primary btn-lg" onClick={() => setStarted(true)}>Start session</button>
        </section>
      ) : (
        <CardFlow
          label="Daily Five card"
          words={remaining}
          submit={async (w, r) => {
            const res = await recordDailyReview(repo, now(), w.id, r);
            await reload();
            if (res.status === "recorded" && res.sessionComplete) notify("Daily Five complete. Nicely done.");
            return { ok: res.status === "recorded" };
          }}
          onDone={(res) => setDone(res)}
        />
      )}
    </>
  );
}

export function Review({ mode, wordId }: { mode: string; wordId: string }) {
  const { repo, snap, reload, now, notify } = useStore();
  const [queue, setQueue] = useState<Word[] | null>(null);
  const [practice, setPractice] = useState(false);
  const [done, setDone] = useState<CardResult[] | null>(null);
  const tz = snap?.preferences.timezone ?? "UTC";
  const groups = useMemo(() => (snap ? groupForReview(snap.words, now(), tz) : null), [snap]);

  useEffect(() => {
    if (!snap) return;
    if (mode === "session" && !queue) {
      const n = now();
      const due = snap.words.filter((w) => w.nextReviewAt && new Date(w.nextReviewAt) <= n).sort((a, b) => a.nextReviewAt!.localeCompare(b.nextReviewAt!));
      setQueue(due); setPractice(false);
    }
    if (mode === "word" && wordId && !queue) {
      const w = snap.words.find((x) => x.id === wordId);
      setQueue(w ? [w] : []); setPractice(!!w && isStudyAhead(w, now()));
    }
  }, [snap, mode, wordId]);
  useEffect(() => { if (mode === "") { setQueue(null); setDone(null); } }, [mode]);

  if (!snap || !groups) return <p className="muted">Loading…</p>;

  if (queue) {
    if (done) return <><PageHead title="Review" /><Summary results={done} title={practice ? "Practice complete" : "Review complete"} extra={practice ? <p className="muted">This was early practice, so it didn’t change the word’s schedule.</p> : null} /></>;
    if (queue.length === 0) return <><PageHead title="Review" /><Empty title="Nothing to review">No words are due right now.<div><a className="btn" href="#/review">Back to Review</a></div></Empty></>;
    return (
      <>
        <PageHead title="Review" sub={practice ? "Studying ahead — this won’t change the schedule." : "Active recall for words that are due."} actions={<a className="btn" href="#/review">Exit</a>} />
        <CardFlow label="Review card" words={queue}
          submit={async (w, r) => {
            const res = await recordReview(repo, now(), w.id, r, { studyAhead: true });
            await reload();
            if (res.status === "too_soon") notify("Already reviewed a moment ago.", "warn");
            return { ok: res.status === "recorded" };
          }}
          onDone={setDone} />
      </>
    );
  }

  const dueCount = groups.overdue.length + groups.dueToday.length;
  const section = (title: string, list: Word[], empty: string) => (
    <section className="card" aria-label={title}>
      <h2>{title} <small className="muted">{list.length}</small></h2>
      {list.length === 0 ? <p className="muted">{empty}</p> : <div className="list">{list.slice(0, 12).map((w) => (
        <div key={w.id} className="word-row-wrap"><WordRow word={w} now={now()} tz={tz} /><a className="btn small-btn" href={`#/review/word/${w.id}`}>{isStudyAhead(w, now()) ? "Study ahead" : "Review"}</a></div>
      ))}{list.length > 12 && <p className="muted small">…and {list.length - 12} more in My Words.</p>}</div>}
    </section>
  );

  return (
    <>
      <PageHead title="Review" sub="Try to recall each meaning before revealing it." actions={dueCount > 0 ? <a className="btn btn-primary" href="#/review/session">Start review ({dueCount})</a> : null} />
      {dueCount === 0 && <Empty title="You’re all caught up">No words are due. Come back later, or study ahead below — early practice won’t change your schedule.</Empty>}
      <div className="stat-row card"><div><b>{groups.overdue.length}</b><span>overdue</span></div><div><b>{groups.dueToday.length}</b><span>due today</span></div><div><b>{groups.learning.length}</b><span>learning</span></div><div><b>{groups.familiar.length}</b><span>familiar</span></div><div><b>{groups.mastered.length}</b><span>mastered</span></div></div>
      {section("Overdue", groups.overdue, "Nothing overdue.")}
      {section("Due today", groups.dueToday, "Nothing else due today.")}
      {section("Currently learning", groups.learning, "No words in the learning stage.")}
      {section("Familiar", groups.familiar, "No familiar words yet.")}
      {section("Mastered", groups.mastered, "No mastered words yet.")}
      <p className="muted small">Next review dates use your timezone ({tz}). Last updated {fmtDate(now().toISOString(), tz)}.</p>
    </>
  );
}
