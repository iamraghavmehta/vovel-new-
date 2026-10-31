import React, { useMemo, useState } from "react";
import { LEARNING_STATUSES } from "../../core/types";
import { filterWords, searchWords, sortWords, type WordSort } from "../../services/wordService";
import { go, useStore } from "../store";
import { Empty, PageHead, STATUS_LABEL, WordRow } from "../ui";

export default function MyWords({ initialCollection }: { initialCollection: string }) {
  const { snap, now } = useStore();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<WordSort>("recent");
  const [collection, setCollection] = useState(initialCollection);
  const [status, setStatus] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [recent, setRecent] = useState(false);
  const words = snap?.words ?? [];
  const tz = snap?.preferences.timezone ?? "UTC";
  const shown = useMemo(() => {
    const n = now();
    return sortWords(
      filterWords(searchWords(words, q), { collectionId: collection || null, status: (status || null) as never, dueOnly, recentDays: recent ? 7 : null, now: n }),
      sort,
    );
  }, [words, q, sort, collection, status, dueOnly, recent]);
  const collections = snap?.collections ?? [];
  const current = collections.find((c) => c.id === collection);

  return (
    <>
      <PageHead title={current ? current.name : "My Words"} sub={`${shown.length} of ${words.length} word${words.length === 1 ? "" : "s"}`} actions={<a className="btn btn-primary" href="#/discover">Add a word</a>} />
      {words.length === 0 ? (
        <Empty title="Your word archive is empty">Search for a word you met recently and save it. Everything you save stays here, and is kept after you close the page.<div><a className="btn btn-primary" href="#/discover">Find your first word</a></div></Empty>
      ) : (
        <>
          <div className="filters" role="search">
            <label className="sr-only" htmlFor="mw-q">Search your saved words</label>
            <input id="mw-q" className="input" placeholder="Search your words, notes, sources…" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="sr-only" htmlFor="mw-sort">Sort</label>
            <select id="mw-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value as WordSort)}>
              <option value="recent">Recently added</option><option value="alpha">A → Z</option><option value="oldest">Oldest first</option><option value="nextReview">Next review</option>
            </select>
            <label className="sr-only" htmlFor="mw-c">Collection</label>
            <select id="mw-c" className="input" value={collection} onChange={(e) => { setCollection(e.target.value); go(e.target.value ? `/words?c=${e.target.value}` : "/words"); }}>
              <option value="">All words</option><option value="none">No collection</option>{collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="mw-s">Status</label>
            <select id="mw-s" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option>{LEARNING_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={dueOnly} onChange={(e) => setDueOnly(e.target.checked)} /> Due for review</label>
            <label className="check"><input type="checkbox" checked={recent} onChange={(e) => setRecent(e.target.checked)} /> Added this week</label>
          </div>
          {shown.length === 0 ? <Empty title="No words match">Try clearing a filter or search term.</Empty> : (
            <div className="list">{shown.map((w) => <WordRow key={w.id} word={w} now={now()} tz={tz} />)}</div>
          )}
        </>
      )}
    </>
  );
}
