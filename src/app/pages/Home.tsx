import React from "react";
import { computeDashboardStats } from "../../services/stats";
import { go, useStore } from "../store";
import { PageHead, StatusPill, WordRow } from "../ui";

export default function Home() {
  const { snap, now } = useStore();
  if (!snap) return <p className="muted">Loading…</p>;
  const tz = snap.preferences.timezone;
  const s = computeDashboardStats(snap.words, snap.reviewLogs, snap.dailySessions, now(), tz);
  const name = snap.preferences.displayName;
  const max = Math.max(1, ...s.activity.map((a) => a.reviews));
  const dayLabel = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

  if (s.totalWords === 0) {
    return (
      <section className="hero">
        <p className="eyebrow">Discover → Save → Understand → Remember → Use</p>
        <h1 className="hero-title serif">Find your words.</h1>
        <p className="lede">Discover words. Remember them. Make them yours.</p>
        <p className="muted">VOVEL is a personal vocabulary archive. Save the words you meet while reading, practise a few each day with spaced repetition, and bring them into your own writing.</p>
        <a className="btn btn-primary btn-lg" href="#/discover">Save your first word</a>
      </section>
    );
  }

  const sessionLabel = s.dailyFive.selected === 0 ? "Start today’s Daily Five" : s.dailyFive.complete ? "View today’s Daily Five" : s.dailyFive.completed > 0 ? "Continue Daily Five" : "Start today’s Daily Five";

  return (
    <>
      <PageHead title={name ? `Welcome back, ${name}` : "Today"} sub="What have I collected? What should I learn? What should I revise?"
        actions={<><a className="btn btn-primary" href="#/daily">{sessionLabel}</a>{s.dueNow > 0 ? <a className="btn" href="#/review/session">Review {s.dueNow} due</a> : <a className="btn" href="#/review">Review</a>}</>} />
      <div className="stats" aria-label="Your numbers">
        <div className="stat"><b>{s.totalWords}</b><span>words saved</span></div>
        <div className="stat"><b>{s.dueNow}</b><span>due for review</span></div>
        <div className="stat"><b>{s.learnedThisWeek}</b><span>learned this week</span></div>
        <div className="stat"><b>{s.streakDays}</b><span>day streak</span></div>
        <div className="stat"><b>{s.dailyFive.selected ? `${s.dailyFive.completed}/${s.dailyFive.selected}` : "—"}</b><span>Daily Five today</span></div>
      </div>
      <section className="card" aria-label="Activity in the last seven days">
        <h2>Last 7 days</h2>
        <div className="bars" role="img" aria-label={`Reviews per day: ${s.activity.map((a) => `${dayLabel(a.date)} ${a.reviews}`).join(", ")}`}>
          {s.activity.map((a) => (
            <div key={a.date} className="bar-col"><span className="bar-n">{a.reviews}</span><div className="bar-track"><div className="bar-fill" style={{ height: `${(a.reviews / max) * 100}%` }} /></div><span className="bar-l">{dayLabel(a.date)}</span></div>
          ))}
        </div>
        {s.activity.every((a) => a.reviews === 0) && <p className="muted small">No reviews yet — your first session will show up here.</p>}
      </section>
      <div className="two-col">
        <section className="card"><h2>Recently saved</h2><div className="list">{s.recentlySaved.map((w) => <WordRow key={w.id} word={w} now={now()} tz={tz} />)}</div></section>
        <section className="card"><h2>Currently learning</h2>
          {s.currentlyLearning.length === 0 ? <p className="muted">Words enter “learning” after your first review.</p> :
            <ul className="plain">{s.currentlyLearning.map((w) => <li key={w.id}><a className="serif" href={`#/words/${w.id}`}>{w.word}</a> <StatusPill status={w.learningStatus} /></li>)}</ul>}
        </section>
      </div>
    </>
  );
}
