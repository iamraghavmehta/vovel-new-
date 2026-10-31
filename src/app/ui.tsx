import React, { useEffect, useRef, useState } from "react";
import type { LearningStatus, Word } from "../core/types";

export const STATUS_LABEL: Record<LearningStatus, string> = { new: "New", learning: "Learning", familiar: "Familiar", mastered: "Mastered" };

export function StatusPill({ status }: { status: LearningStatus }) {
  return <span className={`pill pill-${status}`}>{STATUS_LABEL[status]}</span>;
}

export function fmtDate(iso: string | null, tz?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
}
export function fmtWhen(iso: string | null, now: Date, tz?: string): string {
  if (!iso) return "Not scheduled";
  const d = new Date(iso);
  if (d <= now) return "Due now";
  return `Due ${fmtDate(iso, tz)}`;
}

export function PageHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <header className="page-head">
      <div><h1>{title}</h1>{sub && <p className="muted">{sub}</p>}</div>
      {actions && <div className="row">{actions}</div>}
    </header>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="empty"><h3>{title}</h3><div className="muted">{children}</div></div>;
}

export function WordRow({ word, now, tz }: { word: Word; now: Date; tz: string }) {
  return (
    <a className="word-row" href={`#/words/${word.id}`}>
      <span className="word-title serif">{word.word}</span>
      <span className="muted clamp">{word.definition}</span>
      <span className="row-meta"><StatusPill status={word.learningStatus} /><small className="muted">{fmtWhen(word.nextReviewAt, now, tz)}</small></span>
    </a>
  );
}

export interface ConfirmState { title: string; body: string; confirmLabel: string; onConfirm: () => void }
export function ConfirmDialog({ state, onClose }: { state: ConfirmState | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (state && !d.open) d.showModal();
    if (!state && d.open) d.close();
  }, [state]);
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-labelledby="cd-title">
      {state && (
        <form method="dialog" onSubmit={(e) => e.preventDefault()}>
          <h2 id="cd-title">{state.title}</h2>
          <p>{state.body}</p>
          <div className="row end">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-danger" autoFocus onClick={() => { state.onConfirm(); onClose(); }}>{state.confirmLabel}</button>
          </div>
        </form>
      )}
    </dialog>
  );
}
export function useConfirm() {
  const [state, setState] = useState<ConfirmState | null>(null);
  return { ask: setState, dialog: <ConfirmDialog state={state} onClose={() => setState(null)} /> };
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const wordSummary = (w: Word) =>
  `${w.word}${w.pronunciation ? ` ${w.pronunciation}` : ""}${w.partOfSpeech ? ` (${w.partOfSpeech})` : ""}\n${w.definition}${w.userExample ? `\nExample: ${w.userExample}` : ""}`;
