import React, { useEffect, useState } from "react";
import { lookupWord, entryToNewWord, DICTIONARY_SOURCE_LABEL, type DictionaryEntry, type LookupResult } from "../../core/dictionary";
import { extractSentenceTokens } from "../../core/normalize";
import { findSaved, saveWord, similarSavedWords } from "../../services/wordService";
import type { Word } from "../../core/types";
import { go, useStore } from "../store";
import { PageHead } from "../ui";

/** Search + capture: a word, or a pasted sentence in which the user picks the word to save. */
export default function Discover({ query }: { query: string }) {
  const { repo, snap, reload, notify } = useStore();
  const [input, setInput] = useState(query);
  const [sentence, setSentence] = useState<string | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Word | null>(null);
  const [existing, setExisting] = useState<Word | null>(null);
  const [similar, setSimilar] = useState<string[]>([]);
  const [meaning, setMeaning] = useState(0);
  const [notes, setNotes] = useState("");
  const [context, setContext] = useState("");
  const [source, setSource] = useState("");
  const [collectionId, setCollectionId] = useState("");
  const [manual, setManual] = useState("");

  async function run(raw: string) {
    const text = raw.trim();
    setSaved(null); setResult(null); setExisting(null); setSimilar([]); setMeaning(0);
    if (!text) return;
    const isSentence = text.split(/\s+/).length > 2;
    if (isSentence) { setSentence(text); setContext(text); setTerm(null); return; }
    setSentence(null); setTerm(text);
    setLoading(true);
    const ex = await findSaved(repo, text);
    setExisting(ex);
    const r = await lookupWord(text);
    setResult(r);
    if (r.kind === "not_found") setSimilar(await similarSavedWords(repo, text));
    setLoading(false);
  }
  useEffect(() => { setInput(query); if (query) void run(query); /* eslint-disable-next-line */ }, [query]);

  function submit(e: React.FormEvent) { e.preventDefault(); go(`/discover/${encodeURIComponent(input.trim())}`); if (input.trim() === query) void run(input); }

  async function save(entry: DictionaryEntry | null) {
    const draft = entry
      ? entryToNewWord(entry, { meaningIndex: meaning, personalNotes: notes, originalContext: context, source, collectionId: collectionId || null })
      : { word: term ?? "", definition: manual.trim(), definitionSource: "user" as const, personalNotes: notes, originalContext: context, source, collectionId: collectionId || null };
    if (!draft.definition) { notify("Add a definition of your own to save this word.", "warn"); return; }
    const r = await saveWord(repo, draft);
    if (r.status === "duplicate") { setExisting(r.existing); notify(`“${r.existing.word}” is already in My Words.`, "warn"); return; }
    setSaved(r.word); await reload(); notify(`Saved “${r.word.word}” to My Words.`);
  }

  const tokens = sentence ? extractSentenceTokens(sentence) : [];
  const collections = snap?.collections ?? [];
  const entry = result?.kind === "found" ? result.entry : null;

  return (
    <>
      <PageHead title="Discover" sub="Search a word, or paste a sentence and pick the word you want to keep." />
      <form className="searchbar" onSubmit={submit} role="search">
        <label htmlFor="q" className="sr-only">Search for a word or paste a sentence</label>
        <input id="q" className="input input-lg" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Try “ephemeral”, or paste a sentence…" autoComplete="off" spellCheck={false} />
        <button className="btn btn-primary btn-lg" type="submit">Search</button>
      </form>

      {sentence && (
        <section className="card" aria-label="Pick a word from your sentence">
          <h2>Which word do you want to save?</h2>
          <p className="context-quote serif">“{sentence}”</p>
          <div className="chips" role="group" aria-label="Words in the sentence">
            {tokens.map((t) => (
              <button key={t.normalized} className={`chip ${t.likelyUnfamiliar ? "chip-hint" : ""}`} onClick={() => { setTerm(t.text); setSentence(null); setContext(sentence); setInput(t.text); void (async () => { setLoading(true); setExisting(await findSaved(repo, t.text)); const r = await lookupWord(t.text); setResult(r); if (r.kind === "not_found") setSimilar(await similarSavedWords(repo, t.text)); setLoading(false); })(); }}>{t.text}</button>
            ))}
          </div>
          <p className="muted small">Highlighted words are only a rough guess (longer, less common-looking words). Any word can be chosen. The sentence is saved as your reading context.</p>
        </section>
      )}

      {loading && <p className="muted" role="status">Looking up “{term}”…</p>}

      {existing && !saved && (
        <div className="banner banner-info" role="status">
          <strong>“{existing.word}” is already in My Words.</strong>
          <a className="btn" href={`#/words/${existing.id}`}>Open saved entry</a>
        </div>
      )}

      {result && result.kind !== "found" && !loading && (
        <div className="banner banner-warn" role="alert">
          {result.kind === "not_found" && <>No dictionary entry was found for “{term}”. Check the spelling{similar.length ? <>; similar words you have saved: {similar.join(", ")}</> : null}. You can still save it with your own definition below.</>}
          {result.kind === "rate_limited" && <>The dictionary service is rate-limiting requests. Wait a moment and search again, or save with your own definition below.</>}
          {result.kind === "network_error" && <>{result.message} Check your connection and try again — you can also save with your own definition below.</>}
          {result.kind === "error" && <>{result.message} Try again shortly.</>}
          {result.kind === "invalid_query" && <>Enter a single English word (letters, apostrophes or hyphens).</>}
        </div>
      )}

      {result && result.kind !== "found" && result.kind !== "invalid_query" && !loading && !existing && term && (
        <section className="card">
          <h2>Save with your own definition</h2>
          <p className="muted small">This will be marked as <em>your definition</em>, not a dictionary result.</p>
          <label className="field"><span>Definition</span><textarea className="input" rows={2} value={manual} onChange={(e) => setManual(e.target.value)} /></label>
          <CaptureFields {...{ notes, setNotes, context, setContext, source, setSource, collectionId, setCollectionId, collections }} />
          <button className="btn btn-primary" onClick={() => save(null)}>Save to My Words</button>
        </section>
      )}

      {entry && (
        <article className="card entry" aria-label={`Dictionary entry for ${entry.word}`}>
          <div className="entry-head">
            <h2 className="entry-word serif">{entry.word}</h2>
            <div className="muted">{entry.phonetic ?? "No phonetic spelling available"}</div>
            {entry.audioUrl ? <audio controls preload="none" src={entry.audioUrl} aria-label={`Pronunciation of ${entry.word}`} /> : <small className="muted">No pronunciation audio available.</small>}
          </div>
          <p className="source-tag">From {DICTIONARY_SOURCE_LABEL}</p>
          {entry.meanings.map((m, i) => (
            <div key={i} className={`meaning ${i === meaning ? "meaning-picked" : ""}`}>
              <div className="row between">
                <em className="pos">{m.partOfSpeech}</em>
                {!saved && !existing && entry.meanings.length > 1 && (
                  <label className="small"><input type="radio" name="meaning" checked={i === meaning} onChange={() => setMeaning(i)} /> Use this meaning</label>
                )}
              </div>
              <ol>{m.definitions.slice(0, i === meaning ? 6 : 3).map((d, j) => <li key={j}>{d.definition}{d.example && <div className="muted ex">“{d.example}”</div>}</li>)}</ol>
              <p className="small"><span className="muted">Synonyms:</span> {m.synonyms.length ? m.synonyms.slice(0, 8).join(", ") : <span className="muted">none listed</span>}</p>
              <p className="small"><span className="muted">Antonyms:</span> {m.antonyms.length ? m.antonyms.slice(0, 8).join(", ") : <span className="muted">none listed</span>}</p>
            </div>
          ))}
          <p className="small"><span className="muted">Etymology:</span> {entry.etymology ?? <span className="muted">not provided by the dictionary</span>}</p>

          {saved ? (
            <div className="banner banner-ok success-pop" role="status">
              <strong>Saved to My Words.</strong>
              <a className="btn" href={`#/words/${saved.id}`}>Open “{saved.word}”</a>
            </div>
          ) : !existing && (
            <div className="capture">
              <h3>Make it yours <small className="muted">(your own notes — not from the dictionary)</small></h3>
              <CaptureFields {...{ notes, setNotes, context, setContext, source, setSource, collectionId, setCollectionId, collections }} />
              <button className="btn btn-primary btn-lg" onClick={() => save(entry)}>Save to My Words</button>
            </div>
          )}
        </article>
      )}

      {!query && !sentence && !result && (
        <div className="empty"><h3>Find your words.</h3><p className="muted">Search for any English word to see its definition, pronunciation, synonyms and examples — then save it to your personal archive. VOVEL looks words up in a real dictionary; it never makes up definitions.</p></div>
      )}
    </>
  );
}

function CaptureFields(p: { notes: string; setNotes: (s: string) => void; context: string; setContext: (s: string) => void; source: string; setSource: (s: string) => void; collectionId: string; setCollectionId: (s: string) => void; collections: { id: string; name: string }[] }) {
  return (
    <div className="grid2">
      <label className="field"><span>Where did you meet it? <small className="muted">(sentence or passage)</small></span><textarea className="input" rows={2} value={p.context} onChange={(e) => p.setContext(e.target.value)} /></label>
      <label className="field"><span>Personal note</span><textarea className="input" rows={2} value={p.notes} onChange={(e) => p.setNotes(e.target.value)} /></label>
      <label className="field"><span>Source / book title</span><input className="input" value={p.source} onChange={(e) => p.setSource(e.target.value)} /></label>
      <label className="field"><span>Collection</span>
        <select className="input" value={p.collectionId} onChange={(e) => p.setCollectionId(e.target.value)}>
          <option value="">None</option>{p.collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
    </div>
  );
}
