import React, { useEffect, useRef, useState } from "react";
import { go, useStore } from "../store";

const GOALS = ["Reading", "Academic vocabulary", "Everyday communication", "Writing", "Creative expression"];

/** Short, skippable intro. Completing or skipping it is remembered. */
export default function Onboarding() {
  const { repo, snap, reload } = useStore();
  const [step, setStep] = useState(0);
  const [goals, setGoals] = useState<string[]>([]);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  if (!snap) return null;
  async function finish(dest?: string) {
    await repo.savePreferences({ ...snap!.preferences, goals: goals.length ? goals : snap!.preferences.goals, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", onboardingCompleted: true });
    ref.current?.close(); await reload(); if (dest) go(dest);
  }
  const last = 4;
  const screens = [
    <><h2 className="serif">Welcome to VOVEL.</h2><p className="lede">Find your words.</p><p className="muted">Discover words. Remember them. Make them yours.</p></>,
    <><h2 className="serif">What do you want to improve?</h2><div className="chips">{GOALS.map((g) => <label key={g} className="check chip-check"><input type="checkbox" checked={goals.includes(g)} onChange={(e) => setGoals(e.target.checked ? [...goals, g] : goals.filter((x) => x !== g))} /> {g}</label>)}</div></>,
    <><h2 className="serif">Meet the Daily Five.</h2><p>Each day VOVEL picks five words from your own collection and asks you to recall them before showing the meaning. It schedules each word to return just as you’re about to forget it.</p></>,
    <><h2 className="serif">Save your first word.</h2><p>Met an unfamiliar word while reading? Search it, read the real dictionary entry, and keep it. You can even paste the whole sentence.</p></>,
    <><h2 className="serif">Your Word Vault awaits.</h2><p>Everything you save lives in My Words — private to this browser until you choose otherwise.</p></>,
  ];
  return (
    <dialog ref={ref} className="dialog onboarding" aria-label="Welcome to VOVEL" onCancel={(e) => { e.preventDefault(); void finish(); }}>
      <div className="dots" aria-hidden="true">{screens.map((_, i) => <i key={i} className={i === step ? "on" : ""} />)}</div>
      <div className="ob-body">{screens[step]}</div>
      <div className="row between">
        <button className="btn" onClick={() => void finish()}>Skip</button>
        <div className="row">
          {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          {step < last ? <button className="btn btn-primary" onClick={() => setStep(step + 1)}>{step === 3 ? "Next" : "Continue"}</button>
            : <button className="btn btn-primary" onClick={() => void finish("/discover")}>Save a word</button>}
        </div>
      </div>
    </dialog>
  );
}
