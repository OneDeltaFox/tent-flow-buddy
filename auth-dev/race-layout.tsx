import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, RefreshCw } from "lucide-react";

type Pod = { id: string; name: string; color: string; kind: string; closed: boolean; capabilities: string[];
  beds: { id: string; label: string; status: "open" | "occupied" | "cleaning" }[] };
const tones = {
  open: "border-status-open text-status-open bg-status-open/15",
  occupied: "border-status-occupied text-status-occupied bg-status-occupied/15",
  cleaning: "border-status-cleaning text-muted-foreground bg-status-cleaning/15",
};

export function RaceLayout({ client, race, onBack }: {
  client: SupabaseClient; race: { id: string; name: string }; onBack: () => void;
}) {
  const [pods, setPods] = useState<Pod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setPods([]); setLoading(true); setError(false);
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
    <p className="text-sm text-muted-foreground">Read-only</p>
    {loading ? <p role="status">Loading pods...</p> : error ? <p role="alert">Unable to load this race. Refresh to retry.</p> : pods.length === 0 ?
      <p role="status">No pods have been added to this race.</p> :
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{pods.map(pod => <article key={pod.id}
        className="min-w-0 rounded border border-border border-t-4 p-4" style={{ borderTopColor: /^#[0-9a-f]{6}$/i.test(pod.color) ? pod.color : undefined }}>
        <h4 className="break-words text-lg font-semibold">{pod.name}</h4>
        <p className="text-sm">{pod.closed ? "Closed" : "Open"}{pod.kind === "pool" ? " · Pool" : ""}</p>
        <p className="break-words text-sm text-muted-foreground">{pod.capabilities.join(", ")}</p>
        <div className="mt-3 grid grid-cols-2 gap-2">{pod.beds.map(bed => <div key={bed.id} className={`min-w-0 rounded border p-3 ${tones[bed.status]}`}>
          <p className="break-words font-semibold">{bed.label}</p>
          <p className="text-sm capitalize">{pod.closed && bed.status === "open" ? "Unavailable" : bed.status === "cleaning" ? "Turnover" : bed.status}</p>
        </div>)}</div>
      </article>)}</div>}
  </section>;
}
