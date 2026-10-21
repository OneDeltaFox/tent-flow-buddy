import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Plus, RefreshCw, MoreHorizontal, Pencil, Archive, ArchiveRestore, ArrowRight } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
  return <div className="race-home" aria-label="Your races">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-2xl font-semibold">Your races</h3>
      {races.some(race => race.role === "owner") && <button className="desk-primary ml-auto" onClick={() => setCreating(true)}><Plus size={18} />Create New Race</button>}
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
        <ul className="divide-y divide-border border-y border-border">{races.filter(race => showArchived || !race.archived).map(race => <li key={race.id} className="race-home-row">
          <div className="min-w-0 flex-1">
          <h4 className="break-words font-semibold">{race.name}</h4>
          <p className="mt-2 flex items-center gap-3 text-sm capitalize"><span className={`race-state ${race.archived ? "" : race.state === "active" ? "race-state-active" : "race-state-closed"}`}>{race.archived ? "Archived" : race.state}</span><span className="text-muted-foreground">{race.role}</span></p>
          <p className="mt-2 text-xs text-muted-foreground">{race.timezone}</p></div>
          <div className="flex items-center gap-2">
          {!race.archived && <button type="button" onClick={() => setSelected(race)} className="desk-secondary">Open board<ArrowRight size={16} /></button>}
          {race.role === "owner" && <DropdownMenu><DropdownMenuTrigger asChild><button className="desk-icon" aria-label={`Race options for ${race.name}`} title="Race options"><MoreHorizontal size={20} /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem className="min-h-11" onSelect={() => setRenaming(race)}><Pencil size={16} />Rename Race</DropdownMenuItem>
            {race.state === "closed" && <DropdownMenuItem className="min-h-11" disabled={archiving} onSelect={() => void archive(race)}>{race.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}{race.archived ? "Restore Race" : "Archive Race"}</DropdownMenuItem>}
          </DropdownMenuContent></DropdownMenu>}
          </div>
        </li>)}</ul>}
    <Invitations client={client} onAccepted={() => setAttempt(value => value + 1)} />
    {(creating || renaming) && <RaceEditor client={client} race={renaming ?? undefined} sources={races.filter(race => race.role === "owner")}
      onClose={() => { setCreating(false); setRenaming(null); }} onSaved={() => setAttempt(value => value + 1)} />}
  </div>;
}
