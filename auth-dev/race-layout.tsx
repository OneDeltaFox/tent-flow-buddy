import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, RefreshCw, Settings } from "lucide-react";
import { AddPods } from "./add-pods";
import { PodCard } from "@/components/tent-board";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Pod = { id: string; name: string; color: string; kind: "regular" | "pool"; closed: boolean; capabilities: string[];
  beds: { id: string; label: string; status: "open" | "occupied" | "cleaning" }[] };
const tones = {
  open: "border-status-open text-status-open bg-status-open/15",
  occupied: "border-status-occupied text-status-occupied bg-status-occupied/15",
  cleaning: "border-status-cleaning text-muted-foreground bg-status-cleaning/15",
};

export function RaceLayout({ client, race, onBack }: {
  client: SupabaseClient; race: { id: string; name: string; role: string; state: string }; onBack: () => void;
}) {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = pods.find(pod => pod.id === selectedId);
  const activeBeds = pods.filter(pod => !pod.closed).flatMap(pod => pod.beds);
  const occupied = pods.flatMap(pod => pod.beds).filter(bed => bed.status === "occupied").length;
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setPods([]); setSelectedId(null); setLoading(true); setError(false);
    async function load() {
      try {
        const result = await client.rpc("race_layout", { p_race: race.id }).abortSignal(controller.signal);
        if (!active) return;
        if (result.error) setError(true);
        else setPods(result.data ?? []);
      } catch { if (active) setError(true); }
      finally { window.clearTimeout(timeout); if (active) setLoading(false); }
    }
    void load();
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); };
  }, [client, race.id, attempt]);
  return <section aria-label="Race layout" className="grid gap-4">
    <div className="flex items-center gap-3">
      <button type="button" onClick={onBack} aria-label="Back to races" title="Back to races" className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border"><ArrowLeft size={20} /></button>
      <h3 className="min-w-0 flex-1 break-words text-xl font-semibold">{race.name}</h3>
      <button type="button" disabled={loading} onClick={() => setAttempt(v => v + 1)} aria-label="Refresh layout" title="Refresh layout" className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-border disabled:opacity-50"><RefreshCw size={20} /></button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
      <div className="flex gap-6 font-mono">
        <div><p className="text-xs text-muted-foreground">Occupied beds</p><p className="text-3xl font-bold">{loading || error ? "--" : occupied}</p></div>
        <div><p className="text-xs text-muted-foreground">Open beds</p><p className="text-3xl font-bold text-status-open">{loading || error ? "--" : `${activeBeds.filter(bed => bed.status === "open").length} / ${activeBeds.length}`}</p></div>
      </div>
      {race.role === "owner" && race.state === "active" && <details className="relative">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-border px-3"><Settings size={16} />Race Settings</summary>
        <div className="absolute right-0 top-full z-20 w-64 rounded border border-border bg-card p-3 shadow-xl">
          <AddPods client={client} raceId={race.id} onSaved={() => setAttempt(v => v + 1)} />
        </div>
      </details>}
    </div>
    <p className="text-sm text-muted-foreground">Layout only. Patient records and patient actions are not connected yet.</p>
    {loading ? <p role="status">Loading pods...</p> : error ? <p role="alert">Unable to load this race. Refresh to retry.</p> : pods.length === 0 ?
      <p role="status">No pods have been added to this race.</p> :
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">{pods.map(pod => <PodCard key={pod.id}
        pod={{ ...pod, zone: pod.kind === "pool" ? "Pool" : "", staff: [] }}
        selected={pod.id === selectedId} setup={false} readOnly
        onSelect={() => setSelectedId(pod.id)} onEdit={() => {}} onEditPatient={() => {}}
      />)}</div>}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelectedId(null); }}>
      {selected && <DialogContent className="board-modal" style={{ borderLeftColor: selected.color, borderLeftWidth: 5 }}>
        <DialogTitle>{selected.name}</DialogTitle>
        <DialogDescription>{selected.closed ? "Closed" : "Open"}{selected.kind === "pool" ? " · Pool" : ""}</DialogDescription>
        <p className="break-words text-sm text-muted-foreground">{selected.capabilities.join(", ")}</p>
        <div className="grid grid-cols-2 gap-2">{selected.beds.map(bed => <div key={bed.id} className={`min-w-0 rounded border p-3 ${tones[bed.status]}`}>
          <p className="break-words font-semibold">{bed.label}</p>
          <p className="text-sm capitalize">{selected.closed && bed.status === "open" ? "Unavailable" : bed.status === "cleaning" ? "Turnover" : bed.status}</p>
        </div>)}</div>
      </DialogContent>}
    </Dialog>
  </section>;
}
