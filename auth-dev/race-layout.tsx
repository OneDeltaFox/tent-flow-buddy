import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { StatusBoard } from "@/components/status-board";
import type { Bed, Pod, Triage } from "@/lib/tent-data";
import { useAutoRefresh } from "./auto-refresh";

type DisplayBed = { bed_id: string; bib: string | null; triage: Triage | null; complaint: string | null;
  medical_started_at: string | null; pool_started_at: string | null; reserved: boolean };
type Snapshot = { pods: Pod[]; beds: DisplayBed[]; metrics: { census: number; incoming: number; seen: number; discharged: number; ems: number; other: number } };
function tone(bed: Bed) {
  if (bed.status === "cleaning") return "bg-status-cleaning/40 border-status-cleaning text-muted-foreground";
  if (bed.status === "open") return "bg-status-open/15 border-status-open/50 text-status-open";
  switch (bed.triage) {
    case "immediate": return "bg-status-critical border-status-critical text-foreground";
    case "delayed": return "bg-status-occupied border-status-occupied text-background";
    case "minor": return "bg-status-open border-status-open text-background";
    default: return "bg-muted border-muted-foreground text-foreground";
  }
}

export function RaceLayout({ client, race, onBack }: {
  client: SupabaseClient; race: { id: string; name: string; role: string; state: string }; onBack: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [updated, setUpdated] = useState("");
  const autoLoad = useRef<() => Promise<void>>(async () => {});
  const canRefresh = useAutoRefresh(() => autoLoad.current());
  useEffect(() => {
    let active = true;
    let controller: AbortController | null = null;
    setSnapshot(null); setError(false); setUpdated("");
    async function load(background = false) {
      if (controller) return;
      const request = new AbortController();
      controller = request;
      const timeout = window.setTimeout(() => request.abort(), 15000);
      try {
        const result = await client.rpc("viewer_status", { p_race: race.id }).abortSignal(request.signal);
        if (!active) return;
        if (result.error || !result.data) {
          setError(true);
          // Clear patient information when authorization is lost or cannot be verified.
          setSnapshot(null);
        } else if (!background || canRefresh()) {
          setSnapshot(result.data); setError(false);
          setUpdated(new Date().toLocaleTimeString("en-GB"));
        }
      } catch { if (active) { setError(true); setSnapshot(null); } }
      finally { window.clearTimeout(timeout); controller = null; }
    }
    autoLoad.current = () => load(true);
    void load();
    return () => { active = false; controller?.abort(); autoLoad.current = async () => {}; };
  }, [client, race.id, attempt]);
  const poolStarts: Record<string, number> = {};
  const pods = snapshot?.pods.map(pod => ({ ...pod, zone: "", staff: [], beds: pod.beds.map(bed => {
    const display = snapshot.beds.find(row => row.bed_id === bed.id);
    if (display?.pool_started_at) poolStarts[bed.id] = Date.parse(display.pool_started_at);
    return { ...bed, label: bed.label.replace(/^pod\s+(\d+)-(\d+)$/i, "$1-$2"),
      ...(display?.bib ? { bib: display.bib, triage: display.triage ?? "untriaged", complaint: display.complaint ?? "", reserved: display.reserved,
        arrivedAt: display.medical_started_at ? Date.parse(display.medical_started_at) : undefined } : {}) };
  }) })) ?? [];
  return <section aria-label="Viewer status board">
    <div className="flex flex-wrap items-center gap-3 p-3">
      {!snapshot && <button onClick={onBack} aria-label="Back to races" title="Back to races" className="size-11 border p-3"><ArrowLeft size={18} /></button>}
      <button onClick={() => setAttempt(v => v + 1)} aria-label="Refresh status board" title="Refresh status board" className="size-11 border p-3"><RefreshCw size={18} /></button>
      {error ? <p role="alert">Status board unavailable. Retrying automatically. Migration 010 and race access are required.</p> : <p role="status" className="text-sm text-muted-foreground">{updated ? `Auto-update on · Updated ${updated}` : "Loading status board..."}</p>}
    </div>
    {snapshot && <StatusBoard pods={pods} eventName={race.name} incomingCount={snapshot.metrics.incoming}
      metrics={snapshot.metrics} poolStartedAt={poolStarts} bedTone={tone} onClose={onBack} backLabel="Back to races" />}
  </section>;
}
