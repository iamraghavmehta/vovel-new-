import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Snapshot } from "../core/types";
import type { VovelRepository } from "../data/repository";

interface Toast { id: number; text: string; tone: "ok" | "warn" }
export interface Store {
  repo: VovelRepository;
  snap: Snapshot | null;
  reload: () => Promise<void>;
  now: () => Date;
  notify: (text: string, tone?: "ok" | "warn") => void;
  storageWarning: string | null;
}
const Ctx = createContext<Store | null>(null);
export const useStore = (): Store => {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside provider");
  return s;
};

export function VovelProvider({ repo, storageWarning, children }: { repo: VovelRepository; storageWarning: string | null; children?: React.ReactNode }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const reload = useCallback(async () => setSnap(await repo.exportSnapshot()), [repo]);
  useEffect(() => { void reload(); }, [reload]);
  const notify = useCallback((text: string, tone: "ok" | "warn" = "ok") => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const value = useMemo<Store>(() => ({ repo, snap, reload, now: () => new Date(), notify, storageWarning }), [repo, snap, reload, notify, storageWarning]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}

/** Hash router: "#/words/abc?x=1" → { path: ["words","abc"], query }. */
export function useRoute() {
  const read = () => {
    const raw = window.location.hash.replace(/^#\/?/, "");
    const [p = "", q = ""] = raw.split("?");
    return { path: p.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q) };
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
export const go = (to: string) => { window.location.hash = to; };
