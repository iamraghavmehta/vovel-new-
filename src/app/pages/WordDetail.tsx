import React, { useEffect, useState } from "react";
import { LEARNING_STATUSES, type LearningStatus, type Word } from "../../core/types";
import { go, useStore } from "../store";
import { copyText, fmtDate, PageHead, STATUS_LABEL, StatusPill, useConfirm, wordSummary } from "../ui";

export default function WordDetail({ id }: { id: string }) {
  const { repo, snap, reload, notify, now } = useStore();
  const word = snap?.words.find((w) => w.id === id) ?? null;
  const [notes, setNotes] = useState("");
  const [userExample, setUserExample] = useState("");
  const [context, setContext] = useState("");
  const [source, setSource] = useState("");
  const confirm = useConfirm();
  useEffect(() => { if (word) { setNotes(word.personalNotes); setUserExample(word.userExample); setContext(word.originalContext); setSource(word.source); } }, [word?.id]);

  if (!snap) return <p className="muted">Loading…</p>;
  if (!word) return <div className="empty"><h3>Word not found</h3><p className="muted">It may have been deleted.</p><a className="btn" href="#/words">Back to My Words</a></div>;
  const tz = snap.preferences.timezone;
  const dirty = notes !== word.personalNotes || userExample !== word.userExample || context !== word.originalContext || source !== word.source;

  async function patch(p: Partial<Word>, msg: string) { await repo.updateWord(word!.id, p as never); await reload(); notify(msg); }
  async function share() {
    const text = wordSummary(word!);
    if (navigator.share) { try { await navigator.share({ title: word!.word, text }); return; } catch { /* cancelled */ } }
    notify((await copyText(text)) ? "Sharing isn't supported here — copied to clipboard instead." : "Couldn't share or copy.", "warn");
  }

  return (
    <>
      <p><a href="#/words" className="back">← My Words</a></p>
      <article className="card entry">
        <div className="entry-head">
          <h1 className="entry-word serif">{word.word}</h1>
          <div className="muted">{word.pronunciation ?? ""} {word.partOfSpeech && <em>· {word.partOfSpeech}</em>}</div>
          {word.audioUrl && <audio controls preload="none" src={word.audioUrl} aria-label={`Pronunciation of ${word.word}`} />}
          <StatusPill status={word.learningStatus} />
        </div>
        <p className="source-tag">{word.definitionSource === "dictionary" ? "Definition from the dictionary" : "Your own definition"}</p>
        <p className="definition">{word.definition}</p>
        <div className="row">
          <button className="btn" onClick={async () => notify((await copyText(word.definition)) ? "Definition copied." : "Couldn't copy.", "ok")}>Copy definition</button>
          <button className="btn" onClick={async () => notify((await copyText(wordSummary(word))) ? "Word copied." : "Couldn't copy.")}>Copy word</button>
          <button className="btn" onClick={share}>Share</button>
        </div>
        {word.exampleSentences.length > 0 && <><h3>Dictionary examples</h3><ul>{word.exampleSentences.map((s, i) => <li key={i}>“{s}”</li>)}</ul></>}
        <p className="small"><span className="muted">Synonyms:</span> {word.synonyms.join(", ") || "—"}</p>
        <p className="small"><span className="muted">Antonyms:</span> {word.antonyms.join(", ") || "—"}</p>
        {word.etymology && <p className="small"><span className="muted">Etymology:</span> {word.etymology}</p>}
      </article>

      <section className="card">
        <h2>Your notes <small className="muted">— written by you</small></h2>
        <label className="field"><span>Your own example sentence</span><textarea className="input" rows={2} value={userExample} onChange={(e) => setUserExample(e.target.value)} /></label>
        <label className="field"><span>Where you met it</span><textarea className="input" rows={2} value={context} onChange={(e) => setContext(e.target.value)} /></label>
        <label className="field"><span>Source / book title</span><input className="input" value={source} onChange={(e) => setSource(e.target.value)} /></label>
        <label className="field"><span>Personal notes</span><textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => patch({ personalNotes: notes, userExample: userExample.trim(), originalContext: context.trim(), source: source.trim() }, "Notes saved.")}>Save notes</button>
      </section>

      <section className="card">
        <h2>Learning</h2>
        <div className="grid2">
          <label className="field"><span>Status</span>
            <select className="input" value={word.learningStatus} onChange={(e) => patch({ learningStatus: e.target.value as LearningStatus }, "Status updated.")}>
              {LEARNING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="field"><span>Collection</span>
            <select className="input" value={word.collectionId ?? ""} onChange={(e) => patch({ collectionId: e.target.value || null }, "Collection updated.")}>
              <option value="">None</option>{snap.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        <dl className="facts">
          <div><dt>Added</dt><dd>{fmtDate(word.createdAt, tz)}</dd></div>
          <div><dt>Last reviewed</dt><dd>{fmtDate(word.lastReviewedAt, tz)}</dd></div>
          <div><dt>Next review</dt><dd>{word.nextReviewAt ? (new Date(word.nextReviewAt) <= now() ? "Due now" : fmtDate(word.nextReviewAt, tz)) : "Not scheduled yet"}</dd></div>
          <div><dt>Interval</dt><dd>{word.intervalDays ? `${word.intervalDays} day${word.intervalDays === 1 ? "" : "s"}` : "—"}</dd></div>
          <div><dt>Reviews</dt><dd>{word.repetitions} ({word.failedReviews} forgotten)</dd></div>
          <div><dt>Recall streak</dt><dd>{word.consecutiveCorrect}</dd></div>
        </dl>
      </section>

      <section className="card danger-zone">
        <button className="btn btn-danger" onClick={() => confirm.ask({ title: `Delete “${word.word}”?`, body: "This removes the word, your notes and its review history from this browser. It cannot be undone.", confirmLabel: "Delete word", onConfirm: async () => { await repo.deleteWord(word.id); await reload(); notify("Word deleted."); go("/words"); } })}>Delete word</button>
      </section>
      {confirm.dialog}
    </>
  );
}
