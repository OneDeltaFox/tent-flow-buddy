import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Plus, RefreshCw } from "lucide-react";
import { RaceEditor } from "./race-editor";
import { RaceLayout } from "./race-layout";
import { PatientBoard } from "./patient-board";
import { Invitations } from "./invitations";

type Race = { id: string; name: string; timezone: string; state: string; role: string; archived?: boolean };

export function RaceList({ client }: { client: SupabaseClient }) {
  const [races, setRaces] = useState<Race[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<Race | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Race | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState("");
  const archiveLock = useRef(false);
  async function archive(race: Race) {
    if (archiveLock.current || !window.confirm(race.archived
      ? `Restore "${race.name}" to the race list? It will remain closed.`
      : `Archive "${race.name}"? It will be hidden from the default race list for the team. Nothing is deleted, and you can restore it later.`)) return;
    archiveLock.current = true; setArchiving(true); setArchiveError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc("set_race_archived", { p_race: race.id, p_archived: !race.archived }).abortSignal(controller.signal);
      if (result.error) throw result.error;
      setAttempt(value => value + 1);
    } catch { setArchiveError("Archive change not confirmed. Refresh the race list and check before retrying. Only owners can archive closed races."); }
    finally { window.clearTimeout(timeout); archiveLock.current = false; setArchiving(false); }
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    setRaces([]);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    async function load() {
      try {
        const { data, error: requestError } = await client.rpc("my_races").abortSignal(controller.signal);
        if (!active) return;
        if (requestError) setError(true);
        else setRaces(data ?? []);
      } catch { if (active) setError(true); }
      finally { window.clearTimeout(timeout); if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; window.clearTimeout(timeout); controller.abort(); };
  }, [client, attempt]);
  if (selected) return selected.role === "viewer"
    ? <RaceLayout key={selected.id} client={client} race={selected} onBack={() => setSelected(null)} />
    : <PatientBoard key={selected.id} client={client} race={selected} onBack={() => { setSelected(null); setAttempt(value => value + 1); }} />;
  return <div className="grid gap-3" aria-label="Your races">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold">Your races</h3>
      {races.some(race => race.role === "owner") && <button className="flex min-h-12 items-center gap-2 rounded border px-4" onClick={() => setCreating(true)}><Plus size={18} />Create New Race</button>}
      <button type="button" title="Refresh races" aria-label="Refresh races" disabled={loading}
        onClick={() => setAttempt(value => value + 1)}
        className="flex h-12 w-12 items-center justify-center rounded border border-border disabled:opacity-50">
        <RefreshCw size={18} />
      </button>
    </div>
    <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />Show archived races</label>
    {archiveError && <p role="alert">{archiveError}</p>}
    {!loading && !error && races.length > 0 && races.every(race => race.archived) && !showArchived && <p role="status">All your races are archived.</p>}
    {loading ? <p role="status">Loading races...</p> : error ?
      <p role="alert">Unable to load races. Refresh to retry.</p> : races.length === 0 ?
        <p role="status">No races assigned to your account.</p> :
        <ul className="divide-y divide-border">{races.filter(race => showArchived || !race.archived).map(race => <li key={race.id} className="py-4">
          <h4 className="break-words font-semibold">{race.name}</h4>
          <p className="capitalize">{race.role} · {race.archived ? "Archived" : race.state}</p>
          <p className="text-sm text-muted-foreground">{race.timezone}</p>
          {!race.archived && <button type="button" onClick={() => setSelected(race)} className="mt-3 min-h-12 rounded border border-border px-4 py-2">Open board</button>}
          {race.role === "owner" && race.state === "closed" && <button type="button" disabled={archiving} onClick={() => void archive(race)} className="ml-2 mt-3 min-h-12 rounded border px-4 py-2 disabled:opacity-50">{race.archived ? "Restore Race" : "Archive Race"}</button>}
          {race.role === "owner" && <button type="button" onClick={() => setRenaming(race)} className="ml-2 mt-3 min-h-12 rounded border px-4 py-2">Rename Race</button>}
        </li>)}</ul>}
    <Invitations client={client} onAccepted={() => setAttempt(value => value + 1)} />
    {(creating || renaming) && <RaceEditor client={client} race={renaming ?? undefined} sources={races.filter(race => race.role === "owner")}
      onClose={() => { setCreating(false); setRenaming(null); }} onSaved={() => setAttempt(value => value + 1)} />}
  </div>;
}
