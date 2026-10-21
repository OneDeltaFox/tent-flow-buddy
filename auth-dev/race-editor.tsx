import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { createPatientId } from "./patient-id";

type Race = { id: string; name: string; timezone: string };
export function RaceEditor({ client, race, sources = [], onClose, onSaved }: {
  client: SupabaseClient; race?: Race | undefined; sources?: Race[]; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(race?.name ?? "");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
  const [source, setSource] = useState("");
  const [copyTeam, setCopyTeam] = useState(false);
  const [team, setTeam] = useState<{ id: string; email: string; role: string }[]>([]);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = useRef<string | null>(null);
  const lock = useRef(false);
  const button = "min-h-11 rounded border border-border px-4 disabled:opacity-50";
  function close() {
    if (!lock.current && (name === (race?.name ?? "") || window.confirm("Discard unsaved race settings?"))) onClose();
  }
  async function reviewChanges() {
    if (lock.current) return;
    if (!copyTeam || race) { setReview(true); return; }
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc("race_team", { p_race: source }).abortSignal(controller.signal);
      if (result.error || !Array.isArray(result.data)) throw new Error("Team unavailable");
      setTeam(result.data); setReview(true);
    } catch { setError("Unable to load team access. Refresh the team review before continuing."); }
    finally { clearTimeout(timer); lock.current = false; setBusy(false); }
  }
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (!race && !id.current) id.current = createPatientId();
      const result = race
        ? await client.rpc("rename_race", { p_race: race.id, p_expected_name: race.name, p_name: name.trim() }).abortSignal(controller.signal)
        : await client.rpc(copyTeam ? "create_race_with_team" : "create_race", { p_id: id.current, p_name: name.trim(), p_timezone: timezone, p_source: source || null,
          ...(copyTeam ? { p_expected_team: team } : {}) }).abortSignal(controller.signal);
      if (result.error?.code === "40001") { setReview(false); setTeam([]); setError("Team changed. Review the current people and roles again before creating this race."); return; }
      if (result.error) throw result.error;
      onSaved(); onClose();
    } catch {
      setError("Save not confirmed. You can retry this same request, or close and refresh the race list to check. Migration 018 and owner access are required.");
    } finally { clearTimeout(timer); lock.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="board-modal">
      <DialogTitle>{race ? "Rename Race" : "Create New Race"}</DialogTitle>
      <DialogDescription>{race ? "Patient data, layout, and timers stay unchanged." : "A separate race with its own patients and team access."}</DialogDescription>
      {review ? <div className="grid gap-4">
        <p className="break-words">Race: <strong>{name.trim()}</strong></p>
        {!race && <><p className="break-words">Timezone: {timezone}</p><p className="break-words">Layout: {sources.find(item => item.id === source)?.name ?? "Empty"}</p>
          <p>No patients, timers, or pending invitations will be copied. All copied pods and pools will be open and ready. The previous race is not ended or cleared.</p>
          {copyTeam ? <section aria-label="Team access to copy"><h3 className="font-semibold">Team access to copy</h3>
            {team.filter(member => member.role !== "owner").length === 0 ? <p>No Editors or Viewers to copy.</p> : <ul className="divide-y divide-border">{team.filter(member => member.role !== "owner").map(member => <li key={member.id} className="break-words py-2">{member.email} <strong className="capitalize">{member.role}</strong></li>)}</ul>}
            <p>These users will immediately have access to the new race. No invitations or emails will be sent.</p></section> : <p>No team access will be copied.</p>}</>}
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : race ? "Confirm rename" : "Confirm new race"}</button>
          <button className={button} disabled={busy || Boolean(error)} onClick={() => setReview(false)}>Back</button></div>
      </div> : <form className="grid gap-4" onSubmit={event => { event.preventDefault(); void reviewChanges(); }}>
        <fieldset disabled={busy} className="grid min-w-0 gap-4">
        <label className="grid gap-2">Race name<input required maxLength={200} className="min-h-11 w-full rounded border bg-background px-3" value={name} onChange={event => setName(event.target.value)} /></label>
        {!race && <><label className="grid gap-2">Timezone<input required list="race-timezones" className="min-h-11 w-full rounded border bg-background px-3" value={timezone} onChange={event => setTimezone(event.target.value)} /></label>
          <datalist id="race-timezones">{["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "UTC"].map(value => <option key={value} value={value} />)}</datalist>
          <label className="grid gap-2">Starting layout<select className="min-h-11 w-full rounded border bg-background px-3" value={source} onChange={event => { setSource(event.target.value); setCopyTeam(false); setTeam([]); }}>
            <option value="">Empty layout</option>{sources.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>
          {source && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={copyTeam} onChange={event => setCopyTeam(event.target.checked)} />Copy team access</label>}</>}
        <div className="flex gap-2"><button className={button} disabled={!name.trim() || (race && name.trim() === race.name)}>Review</button><button type="button" className={button} onClick={close}>Cancel</button></div>
        </fieldset>
      </form>}
      {error && <p role="alert">{error}</p>}
    </DialogContent>
  </Dialog>;
}
