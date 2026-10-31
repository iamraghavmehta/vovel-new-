import React from "react";
import { createRoot } from "react-dom/client";
import { LocalRepository, MemoryStorage, type KeyValueStorage } from "../data/localRepository";
import { go, useRoute, useStore, VovelProvider } from "./store";
import Home from "./pages/Home";
import Discover from "./pages/Discover";
import MyWords from "./pages/MyWords";
import WordDetail from "./pages/WordDetail";
import { DailyFive, Review } from "./pages/Learn";
import Collections from "./pages/Collections";
import WordsToUse from "./pages/WordsToUse";
import Settings from "./pages/Settings";
import Onboarding from "./pages/Onboarding";

const NAV = [
  { to: "/", label: "Home", icon: "◐" },
  { to: "/words", label: "My Words", icon: "❡" },
  { to: "/daily", label: "Daily Five", icon: "5" },
  { to: "/review", label: "Review", icon: "↻" },
  { to: "/collections", label: "Collections", icon: "▤" },
  { to: "/use", label: "Words to Use", icon: "✎" },
  { to: "/settings", label: "Settings", icon: "⚙" },
];

function Shell() {
  const { path, query } = useRoute();
  const { snap, storageWarning } = useStore();
  const [section = "", a = "", b = ""] = path;
  const [q, setQ] = React.useState("");
  let page: React.ReactNode;
  switch (section) {
    case "": page = <Home />; break;
    case "discover": page = <Discover query={a} />; break;
    case "words": page = a ? <WordDetail id={a} /> : <MyWords key={query.get("c") ?? ""} initialCollection={query.get("c") ?? ""} />; break;
    case "daily": page = <DailyFive />; break;
    case "review": page = <Review mode={a} wordId={b} />; break;
    case "collections": page = <Collections />; break;
    case "use": page = <WordsToUse />; break;
    case "settings": page = <Settings />; break;
    default: page = <div className="empty"><h3>Page not found</h3><a className="btn" href="#/">Go home</a></div>;
  }
  const active = (to: string) => (to === "/" ? section === "" : `/${section}` === to);
  const showTour = snap && !snap.preferences.onboardingCompleted && snap.words.length === 0 && section === "";
  return (
    <div className="app">
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); document.getElementById("main")?.focus(); }}>Skip to content</a>
      <aside className="sidebar">
        <a className="brand serif" href="#/" aria-label="VOVEL home">Vovel<span>.</span></a>
        <nav aria-label="Primary"><ul>{NAV.map((n) => <li key={n.to}><a href={`#${n.to}`} aria-current={active(n.to) ? "page" : undefined}><span aria-hidden="true" className="ico">{n.icon}</span>{n.label}</a></li>)}</ul></nav>
        <p className="side-note muted small">Local mode · saved in this browser only</p>
      </aside>
      <div className="content">
        <form className="topsearch" role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { go(`/discover/${encodeURIComponent(q.trim())}`); setQ(""); } }}>
          <label className="sr-only" htmlFor="top-q">Search for a word or paste a sentence</label>
          <input id="top-q" className="input" placeholder="Search a word or paste a sentence…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
          <button className="btn btn-primary" type="submit">Search</button>
        </form>
        {storageWarning && <div className="banner banner-warn" role="alert">{storageWarning}</div>}
        <main id="main" tabIndex={-1}>{page}</main>
      </div>
      <nav className="tabbar" aria-label="Primary mobile">
        {NAV.filter((n) => ["/", "/words", "/daily", "/review", "/settings"].includes(n.to)).map((n) => <a key={n.to} href={`#${n.to}`} aria-current={active(n.to) ? "page" : undefined}><span aria-hidden="true" className="ico">{n.icon}</span>{n.label}</a>)}
        <a href="#/discover" className="fab" aria-label="Add a word">＋</a>
      </nav>
      {showTour && <Onboarding />}
    </div>
  );
}

function pickStorage(): { storage: KeyValueStorage; warning: string | null } {
  try {
    const k = "__vovel_probe";
    window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k);
    return { storage: window.localStorage, warning: null };
  } catch {
    return { storage: new MemoryStorage(), warning: "Your browser is blocking storage, so words can’t be saved between visits. Allow site data (or leave private browsing) to keep your vocabulary." };
  }
}

const { storage, warning } = pickStorage();
const repo = new LocalRepository(storage);
createRoot(document.getElementById("root")!).render(<VovelProvider repo={repo} storageWarning={warning}><Shell /></VovelProvider>);
