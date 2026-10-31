import React, { useMemo, useState } from "react";
import type { Word } from "../../core/types";
import { useStore } from "../store";
import { copyText, Empty, PageHead, StatusPill } from "../ui";

/** Words worth bringing into your own writing, plus a private practice box. Nothing is sent anywhere. */
export default function WordsToUse() {
  const { repo, snap, reload, notify } = useStore();
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<null | { found: boolean; word: string }>(null);
  const picks = useMemo(() => {
    const words = snap?.words ?? [];
    const rank = (w: Word) => ({ familiar: 0, learning: 1, mastered: 2, new: 3 }[w.learningStatus]);
    return [...words].sort((a, b) => rank(a) - rank(b) || a.word.localeCompare(b.word)).slice(0, 12);
  }, [snap]);
  if (!snap) return <p className="muted">Loading…</p>;
  if (snap.words.length === 0) return <><PageHead title="Words to Use" /><Empty title="No words to use yet">Save a few words first. This page then suggests ones to bring into your own writing.<div><a className="btn btn-primary" href="#/discover">Add a word</a></div></Empty></>;

  const chosen = snap.words.find((w) => w.id === target) ?? null;
  function check() {
    if (!chosen) return;
    const esc = chosen.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    setChecked({ found: new RegExp(`(^|[^\\p{L}])${esc}([^\\p{L}]|$)`, "iu").test(text), word: chosen.word });
  }
  const example = (w: Word) => w.userExample || w.exampleSentences[0] || "";

  return (
    <>
      <PageHead title="Words to Use" sub="Knowing a word is one thing. Using it is how it becomes yours." />
      <div className="list">
        {picks.map((w) => (
          <article key={w.id} className="card use-card">
            <div className="row between"><h2 className="serif">{w.word}</h2><StatusPill status={w.learningStatus} /></div>
            <p>{w.definition}</p>
            <p className="muted">{example(w) ? <>“{example(w)}”</> : "No example yet — write your own on the word’s page."}</p>
            <div className="row"><button className="btn" onClick={async () => notify((await copyText(w.word)) ? `Copied “${w.word}”.` : "Couldn't copy.", "ok")}>Copy word</button><button className="btn" onClick={() => { setTarget(w.id); setChecked(null); document.getElementById("practice")?.scrollIntoView({ behavior: "smooth" }); }}>Practise</button></div>
          </article>
        ))}
      </div>
      <section id="practice" className="card">
        <h2>Writing practice</h2>
        <p className="muted small">Stays in your browser — nothing is uploaded or analysed externally.</p>
        <label className="field"><span>Word</span>
          <select className="input" value={target} onChange={(e) => { setTarget(e.target.value); setChecked(null); }}>
            <option value="">Choose a saved word…</option>{snap.words.map((w) => <option key={w.id} value={w.id}>{w.word}</option>)}
          </select>
        </label>
        {chosen && <p className="muted">{chosen.definition}</p>}
        <label className="field"><span>Write a sentence using it</span><textarea className="input" rows={3} value={text} onChange={(e) => { setText(e.target.value); setChecked(null); }} /></label>
        <button className="btn btn-primary" disabled={!chosen || !text.trim()} onClick={check}>Check</button>
        {checked && (
          <div className={`banner ${checked.found ? "banner-ok" : "banner-warn"}`} role="status">
            {checked.found ? <>“{checked.word}” appears in your sentence.</> : <>“{checked.word}” doesn’t appear exactly as written (other forms like “{checked.word}s” aren’t matched).</>}
            {" "}This only checks that the word is present — it can’t judge grammar or whether the meaning is right.
          </div>
        )}
        {checked?.found && chosen && (
          <button className="btn" onClick={async () => { await repo.updateWord(chosen.id, { userExample: text.trim() }); await reload(); notify(`Saved as your example for “${chosen.word}”.`); }}>Save as my example for “{chosen.word}”</button>
        )}
      </section>
    </>
  );
}
