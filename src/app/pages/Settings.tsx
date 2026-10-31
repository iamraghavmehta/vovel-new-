import React, { useRef, useState } from "react";
import { exportCsv, exportJson, parseImport, planImport, applyImport, type ImportPlan, type ImportSummary } from "../../services/importExport";
import { isValidTimeZone } from "../../core/time";
import { useStore } from "../store";
import { download, PageHead, useConfirm } from "../ui";

const GOALS = ["Reading", "Academic vocabulary", "Everyday communication", "Writing", "Creative expression"];

export default function Settings() {
  const { repo, snap, reload, notify, now } = useStore();
  const confirm = useConfirm();
  const file = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  if (!snap) return <p className="muted">Loading…</p>;
  const p = snap.preferences;
  const zones: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["UTC"];
  const zoneList = zones.includes(p.timezone) ? zones : [p.timezone, ...zones];
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const save = async (patch: Partial<typeof p>, msg = "Saved.") => { await repo.savePreferences({ ...p, ...patch }); await reload(); notify(msg); };

  async function onFile(f: File | undefined) {
    setPlan(null); setSummary(null); setImportError(null);
    if (!f) return;
    if (f.size > 20_000_000) { setImportError("That file is too large to import."); return; }
    const parsed = parseImport(await f.text());
    if (!parsed.ok) { setImportError(parsed.error); return; }
    setPlan(planImport(parsed, { words: snap!.words, collections: snap!.collections }));
  }
  async function enableNotifications() {
    if (typeof Notification === "undefined") { notify("This browser doesn't support notifications.", "warn"); return; }
    const perm = await Notification.requestPermission();
    await save({ notificationsEnabled: perm === "granted" }, perm === "granted" ? "Notifications enabled." : "Permission wasn't granted, so notifications are still off.");
  }

  return (
    <>
      <PageHead title="Settings" />
      <section className="card">
        <h2>Profile & learning</h2>
        <label className="field"><span>Display name</span><input className="input" value={name ?? p.displayName} onChange={(e) => setName(e.target.value)} onBlur={() => name !== null && name !== p.displayName && void save({ displayName: name.trim() })} /></label>
        <label className="field"><span>Timezone <small className="muted">(decides when your Daily Five rolls over)</small></span>
          <select className="input" value={p.timezone} onChange={(e) => isValidTimeZone(e.target.value) && void save({ timezone: e.target.value })}>{zoneList.map((z) => <option key={z}>{z}</option>)}</select>
        </label>
        {detected !== p.timezone && <button className="btn" onClick={() => void save({ timezone: detected })}>Use this device’s timezone ({detected})</button>}
        <label className="field"><span>Daily session size</span>
          <select className="input" value={p.dailyCount} onChange={(e) => void save({ dailyCount: Number(e.target.value) })}>{[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n} words{n === 5 ? " (Daily Five)" : ""}</option>)}</select>
          <small className="muted">Applies to sessions created from tomorrow; today’s selection stays fixed.</small>
        </label>
        <fieldset className="field"><legend>What do you want to improve?</legend>
          <div className="chips">{GOALS.map((g) => <label key={g} className="check"><input type="checkbox" checked={p.goals.includes(g)} onChange={(e) => void save({ goals: e.target.checked ? [...p.goals, g] : p.goals.filter((x) => x !== g) })} /> {g}</label>)}</div>
        </fieldset>
        <div className="field"><span>Notifications</span>
          <p className="muted small">{p.notificationsEnabled ? "Browser permission granted." : "Off. Reminders need your browser’s permission, which hasn’t been granted."} (VOVEL does not send push reminders in this version.)</p>
          {!p.notificationsEnabled && <button className="btn" onClick={enableNotifications}>Ask for permission</button>}
        </div>
        <button className="btn" onClick={() => void save({ onboardingCompleted: false }, "Welcome tour will show on Home.")}>Replay welcome tour</button>
      </section>

      <section className="card">
        <h2>Back up & restore</h2>
        <p className="muted">Download your vocabulary. JSON restores everything (including review schedules); CSV is for reading in a spreadsheet.</p>
        <div className="row">
          <button className="btn" onClick={() => repo.exportSnapshot().then((s) => download(`vovel-backup-${now().toISOString().slice(0, 10)}.json`, exportJson(s, now()), "application/json"))}>Export JSON</button>
          <button className="btn" onClick={() => repo.exportSnapshot().then((s) => download(`vovel-words-${now().toISOString().slice(0, 10)}.csv`, exportCsv(s), "text/csv"))}>Export CSV</button>
        </div>
        <label className="field"><span>Import a VOVEL JSON backup</span><input ref={file} className="input" type="file" accept="application/json,.json" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        {importError && <div className="banner banner-warn" role="alert">{importError}</div>}
        {plan && !summary && (
          <div className="banner banner-info" role="region" aria-label="Import preview">
            <div>
              <strong>Import preview — nothing has changed yet.</strong>
              <ul className="plain">
                <li>{plan.toAdd.length} new word{plan.toAdd.length === 1 ? "" : "s"} will be added{plan.toAdd.length > 0 && <>: {plan.toAdd.slice(0, 8).map((w) => w.input.word).join(", ")}{plan.toAdd.length > 8 ? "…" : ""}</>}</li>
                <li>{plan.duplicates.length} duplicate{plan.duplicates.length === 1 ? "" : "s"} will be skipped (your existing entries are never overwritten)</li>
                <li>{plan.newCollections.length} new collection{plan.newCollections.length === 1 ? "" : "s"}{plan.newCollections.length ? `: ${plan.newCollections.join(", ")}` : ""}</li>
                {plan.invalid.length > 0 && <li>{plan.invalid.length} invalid entr{plan.invalid.length === 1 ? "y" : "ies"} will be ignored</li>}
              </ul>
              <div className="row">
                <button className="btn btn-primary" disabled={plan.toAdd.length === 0} onClick={async () => { const r = await applyImport(repo, plan); setSummary(r); setPlan(null); await reload(); if (file.current) file.current.value = ""; }}>Confirm import</button>
                <button className="btn" onClick={() => { setPlan(null); if (file.current) file.current.value = ""; }}>Cancel</button>
              </div>
            </div>
          </div>
        )}
        {summary && <div className="banner banner-ok" role="status"><div><strong>Import finished.</strong> Added {summary.added}, skipped {summary.skippedDuplicates} duplicate(s), ignored {summary.invalid} invalid, created {summary.collectionsCreated} collection(s){summary.failed.length ? `, ${summary.failed.length} failed` : ""}.</div></div>}
      </section>

      <section className="card" id="privacy">
        <h2>Storage & privacy</h2>
        <p><strong>Local mode.</strong> Your words, notes and progress are stored only in this browser on this device. They aren’t uploaded, synced or backed up — clearing site data, using a private window, or switching browsers will lose them. Export a backup regularly.</p>
        <p className="muted">Cloud accounts (sync across devices) are not enabled in this build, so nothing here is synchronised. The only network request VOVEL makes is the dictionary lookup, which sends the single word you searched for to the Free Dictionary API.</p>
        <p className="muted">Writing practice and personal notes never leave your browser.</p>
      </section>

      <section className="card danger-zone">
        <h2>Reset local data</h2>
        <p className="muted">Permanently deletes all {snap.words.length} words, collections, review history and settings from this browser. Export first if you want a copy.</p>
        <button className="btn btn-danger" onClick={() => confirm.ask({ title: "Delete all local data?", body: `This permanently erases ${snap.words.length} word(s), your collections, review history and preferences from this browser. This cannot be undone.`, confirmLabel: "Erase everything", onConfirm: async () => { await repo.clearAll(); await reload(); notify("All local data erased."); } })}>Erase all local data…</button>
      </section>
      {confirm.dialog}
    </>
  );
}
