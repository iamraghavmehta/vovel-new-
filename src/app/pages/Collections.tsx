import React, { useState } from "react";
import { DuplicateCollectionError } from "../../data/repository";
import { useStore } from "../store";
import { Empty, PageHead, useConfirm } from "../ui";

export default function Collections() {
  const { repo, snap, reload, notify } = useStore();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const confirm = useConfirm();
  if (!snap) return <p className="muted">Loading…</p>;
  const count = (id: string | null) => snap.words.filter((w) => w.collectionId === id).length;

  async function guarded(fn: () => Promise<unknown>, ok: string) {
    try { await fn(); await reload(); notify(ok); }
    catch (e) { notify(e instanceof DuplicateCollectionError || e instanceof Error ? e.message : "Something went wrong.", "warn"); }
  }

  return (
    <>
      <PageHead title="Collections" sub="Group words by book, subject or purpose. Deleting a collection never deletes its words." />
      <form className="card row" onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void guarded(async () => { await repo.createCollection(name); setName(""); }, "Collection created."); }}>
        <label className="sr-only" htmlFor="nc">New collection name</label>
        <input id="nc" className="input grow" placeholder="New collection — e.g. Literature, Words I Want to Use" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-primary" type="submit">Create</button>
      </form>
      <div className="list">
        <a className="coll-row" href="#/words"><span className="serif">All Words</span><span className="muted">{snap.words.length}</span></a>
        {snap.collections.map((c) => (
          <div key={c.id} className="coll-row">
            {editing === c.id ? (
              <form className="row grow" onSubmit={(e) => { e.preventDefault(); void guarded(async () => { await repo.renameCollection(c.id, draft); setEditing(null); }, "Collection renamed."); }}>
                <label className="sr-only" htmlFor={`rn-${c.id}`}>Rename collection</label>
                <input id={`rn-${c.id}`} className="input grow" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} />
                <button className="btn btn-primary" type="submit">Save</button><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            ) : (
              <>
                <a className="grow serif coll-name" href={`#/words?c=${c.id}`}>{c.name}</a>
                <span className="muted">{count(c.id)} word{count(c.id) === 1 ? "" : "s"}</span>
                <button className="btn" onClick={() => { setEditing(c.id); setDraft(c.name); }}>Rename</button>
                <button className="btn btn-danger" onClick={() => confirm.ask({ title: `Delete “${c.name}”?`, body: `The collection will be removed. Its ${count(c.id)} word(s) will be kept and moved out of any collection.`, confirmLabel: "Delete collection", onConfirm: () => void guarded(() => repo.deleteCollection(c.id), "Collection deleted. Words kept.") })}>Delete</button>
              </>
            )}
          </div>
        ))}
      </div>
      {snap.collections.length === 0 && <Empty title="No collections yet">Create one above, then assign words from their page or while saving.</Empty>}
      {confirm.dialog}
    </>
  );
}
