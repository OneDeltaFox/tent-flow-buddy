import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, RefreshCw, Settings } from "lucide-react";
import { TentBoard } from "@/components/tent-board";
import type { BoardCommand } from "@/lib/connected-board";
import type { Pod, Triage, DispositionCategory } from "@/lib/tent-data";
import { AddPods } from "./add-pods";
import { EditPod } from "./edit-pod";
import { createPatientId } from "./patient-id";
import { useAutoRefresh } from "./auto-refresh";
import { ManageTeam } from "./manage-team";

type Visit = { id: string; revision: number; bib: string; triage: Triage; complaint: string; notes: string; source: string; eta: string;
  medical_started_at: string | null; dispositioned_at: string | null; disposition: DispositionCategory; other_disposition: string | null };
type Placement = { visit_id: string; bed_id: string; started_at: string; ended_at: string | null; kind: string };
type Snapshot = { pods: Pod[]; visits: Visit[]; placements: Placement[]; reservations?: { visit_id: string; bed_id: string }[]; turnovers: { id: string; bed_id: string }[] };

export function PatientBoard({ client, race, onBack }: {
  client: SupabaseClient; race: { id: string; name: string; state: string; role: string }; onBack: () => void;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [editingPod, setEditingPod] = useState<Pod | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const lock = useRef(false);
  const alive = useRef(true);
  const createId = useRef<string | null>(null);
  const readController = useRef<AbortController | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const canRefresh = useAutoRefresh(async () => {
    if (!lock.current && !needsRefresh && !editingPod) await load(true);
  });
  async function load(background = false) {
    if (background && readController.current) return false;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc("patient_board", { p_race: race.id }).abortSignal(controller.signal);
      if (!alive.current || readController.current !== controller) return false;
      if (controller.signal.aborted) throw new Error("Refresh timed out");
      if (result.error) throw result.error;
      if (background && (lock.current || !canRefresh())) return false;
      if (alive.current) { setSnapshot(result.data); setNeedsRefresh(false); }
      setSyncFailed(false);
      setLastUpdated(new Date().toLocaleTimeString([], { hour12: false }));
      return true;
    } catch {
      if (controller.signal.aborted && readController.current !== controller) return false;
      if (background) { if (alive.current) setSyncFailed(true); return false; }
      if (alive.current) { setNeedsRefresh(true); setError("Unable to load patient records. Refresh before making changes. Database migration 007 must be installed."); }
      return false;
    } finally { clearTimeout(timer); if (readController.current === controller) readController.current = null; }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; readController.current?.abort(); readController.current = null; }; }, [client, race.id]);
  async function refresh() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try { await load(); } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function run(command: BoardCommand) {
    if (lock.current || !snapshot || needsRefresh || syncFailed || race.state !== "active") return false;
    lock.current = true; setBusy(true); setError("");
    readController.current?.abort(); readController.current = null;
    const ref = "ref" in command ? command.ref : undefined;
    const visitId = ref?.kind === "incoming" ? ref.incomingId : ref ? (snapshot.placements.find(p => p.bed_id === ref.bedId && !p.ended_at)?.visit_id ?? snapshot.reservations?.find(r => r.bed_id === ref.bedId)?.visit_id) : undefined;
    const visit = snapshot.visits.find(v => v.id === visitId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (ref && !visit) throw new Error("Patient no longer available");
      let result;
      if (command.action === "save") {
        if (!visit && !createId.current) createId.current = createPatientId();
        result = await client.rpc("save_patient", { p_race: race.id, p_visit: visit?.id ?? createId.current, p_revision: visit?.revision ?? null,
          p_details: { bib: command.details.bib, triage: command.details.triage, complaint: command.details.complaint ?? "", notes: command.details.operationalStatus ?? "",
            ...(command.details.source !== undefined ? { source: command.details.source } : {}), ...(command.details.eta !== undefined ? { eta: command.details.eta } : {}) }, p_bed: command.bed ?? null }).abortSignal(controller.signal);
      } else if (command.action === "ready") {
        const turnover = snapshot.turnovers.find(t => t.bed_id === command.bed);
        if (!turnover) throw new Error("Stale turnover");
        result = await client.rpc("ready_patient_bed", { p_bed: command.bed, p_turnover: turnover.id }).abortSignal(controller.signal);
      } else {
        result = await client.rpc("move_patient", { p_visit: visit!.id, p_revision: visit!.revision,
          p_action: command.action === "move" ? "assigned" : "dispositioned", p_bed: command.action === "move" ? command.bed : null,
          p_category: command.action === "disposition" ? command.category : null, p_other: command.action === "disposition" ? command.description ?? null : null }).abortSignal(controller.signal);
      }
      if (result.error) throw result.error;
      if (command.action === "save" && !visit) createId.current = null;
      await load();
      return true;
    } catch {
      setNeedsRefresh(true);
      setError("Save was not confirmed. Refresh and check the patient before retrying. Another user may have changed the record or bed.");
      return false;
    } finally { clearTimeout(timer); lock.current = false; if (alive.current) setBusy(false); }
  }
  const livePlacements = snapshot?.placements.filter(p => !p.ended_at) ?? [];
  const details = (visit: Visit) => ({ bib: visit.bib, triage: visit.triage, complaint: visit.complaint, operationalStatus: visit.notes });
  const pods = snapshot ? [...snapshot.pods].sort((a,b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(pod => ({ ...pod, zone: "", staff: [], beds: [...pod.beds].sort((a,b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map(original => {
    const bed = { ...original, label: original.label.replace(/^pod\s+(\d+)-(\d+)$/i, "$1-$2") };
    const placement = livePlacements.find(p => p.bed_id === bed.id);
    const reservation = snapshot.reservations?.find(r => r.bed_id === bed.id);
    const visit = snapshot.visits.find(v => v.id === (placement?.visit_id ?? reservation?.visit_id));
    return visit ? { ...bed, ...details(visit), visitId: visit.id, reserved: Boolean(reservation), arrivedAt: visit.medical_started_at ? Date.parse(visit.medical_started_at) : undefined,
      since: visit.medical_started_at ? new Date(visit.medical_started_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : undefined } : bed;
  }) })) : [];
  const settings = race.role === "owner" && race.state === "active" ? <details className="relative">
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded border px-3"><Settings size={16} />Race Settings</summary>
    <div className="absolute right-0 top-full z-20 w-64 rounded border bg-card p-3 shadow-xl"><AddPods client={client} raceId={race.id} pods={snapshot?.pods ?? []} onSaved={() => { void refresh(); }} /><button className="mt-2 min-h-11 w-full rounded border px-3" onClick={() => setTeamOpen(true)}>Manage Team</button></div>
  </details> : null;
  return <section className="grid gap-3">
    <div className="flex gap-3">
      <button aria-label="Back to races" title="Back to races" disabled={busy} onClick={onBack} className="min-h-11 border p-3"><ArrowLeft size={18} /></button>
      <button aria-label="Refresh board" title="Refresh board" disabled={busy} onClick={() => { void refresh(); }} className="min-h-11 border p-3"><RefreshCw size={18} /></button>
      {busy && <p role="status">Saving or refreshing...</p>}
      <p role="status" className="self-center text-sm text-muted-foreground">{syncFailed ? "Updates interrupted - displayed data may be out of date. Retrying..." : lastUpdated ? `Auto-update on · Updated ${lastUpdated}` : "Connecting..."}</p>
    </div>
    {error && <p role="alert">{error}</p>}
    {snapshot?.pods.length === 0 && <p role="status">No pods have been added to this race.</p>}
    {!snapshot ? <p role="status">{error ? "Patient board unavailable." : "Loading patient board..."}</p> :
      <div inert={busy || needsRefresh || syncFailed || race.state !== "active"}>
        <TentBoard connected={{ pods, incoming: snapshot.visits.filter(v => !v.dispositioned_at && !livePlacements.some(p => p.visit_id === v.id)).map(v => ({ id: v.id, ...details(v), source: v.source, eta: v.eta })),
          dispositions: snapshot.visits.filter(v => v.dispositioned_at).map(v => ({ id: v.id, ...details(v), category: v.disposition, time: new Date(v.dispositioned_at!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }), from: "Medical", description: v.other_disposition ?? undefined })),
          eventName: race.name, run, settings, readOnly: race.state !== "active",
          ...(race.role === "owner" && race.state === "active" ? { onEditPod: (id: string) => setEditingPod(snapshot.pods.find(pod => pod.id === id) ?? null) } : {}) }} />
      </div>}
    {editingPod && <EditPod key={editingPod.id} client={client} pod={editingPod} onClose={() => setEditingPod(null)} onSaved={() => { void refresh(); }} />}
    {teamOpen && race.role === "owner" && <ManageTeam client={client} raceId={race.id} onClose={() => setTeamOpen(false)} />}
  </section>;
}
