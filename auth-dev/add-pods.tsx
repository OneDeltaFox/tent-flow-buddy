import { useRef, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { Pod } from "@/lib/tent-data";

type SectionPlan = { token: string; color: string; beds_per_pod: number; new_names: string[]; changes: { id: string; from: string; to: string; beds: { id: string; from: string; to: string }[] }[] };

export function AddPods({ client, raceId, onSaved, pods = [] }: { client: SupabaseClient; raceId: string; onSaved: () => void; pods?: (Pod & { kind?: string })[] }) {
  const [open, setOpen] = useState(false);
  const [prefix, setPrefix] = useState("");
  const [start, setStart] = useState(1);
  const [count, setCount] = useState(1);
  const [beds, setBeds] = useState(4);
  const [kind, setKind] = useState("regular");
  const [color, setColor] = useState("#facc15");
  const [capability, setCapability] = useState("");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [section, setSection] = useState("");
  const [plan, setPlan] = useState<SectionPlan | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const uncertainPods = useRef(pods);
  const lock = useRef(false);
  const colors = [...new Set(pods.filter(pod => pod.kind !== "pool").map(pod => pod.color.toLowerCase()))];
  function sectionLabel(value: string) {
    const names = pods.filter(pod => pod.kind !== "pool" && pod.color.toLowerCase() === value).map(pod => pod.name).sort((a,b) => a.localeCompare(b, undefined, { numeric: true }));
    return `${names[0]}${names.length > 1 ? ` - ${names[names.length-1]}` : ""} (${value})`;
  }
  const label = (n: number) => `${prefix.trim()}${prefix.trim() ? " " : ""}${n}`;
  const input = "min-h-12 w-full rounded border border-border bg-background px-3";
  const button = "inline-flex min-h-12 items-center justify-center gap-2 rounded border border-border px-4";
  function addCapability() {
    const value = capability.trim();
    if (value && !capabilities.includes(value) && capabilities.length < 20) {
      setCapabilities([...capabilities, value]); setCapability("");
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || uncertain) return;
    lock.current = true;
    setBusy(true); setError(""); setSaved("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (section) {
        const result = await client.rpc("preview_section_pods", { p_race: raceId, p_color: section, p_count: count, p_beds: beds }).abortSignal(controller.signal);
        if (result.error) { setError("Could not preview this section. Refresh the board. Regular pods must have unique numbers and each color must form one consecutive section."); }
        else setPlan(result.data);
        return;
      }
      const result = await client.rpc("create_pods", { p_race: raceId, p_pods:
        Array.from({ length: count }, (_, i) => ({ name: label(start + i), beds, kind, color, capabilities })) }).abortSignal(controller.signal);
      if (result.error) {
        setError(result.error.code === "23505" ? "A pod name already exists. Change the starting number or prefix." :
          "Could not confirm the save. Refresh the board before retrying; the batch may already be saved.");
      } else {
        setSaved(`${result.data} pod${result.data === 1 ? "" : "s"} added.`);
        setStart(start + count); setOpen(false); onSaved();
      }
    } catch { setError("Could not confirm the save. Refresh the board before retrying."); }
    finally { clearTimeout(timer); lock.current = false; setBusy(false); }
  }
  async function confirmSection() {
    if (!plan || lock.current || uncertain) return;
    lock.current = true; setBusy(true); setError("");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc("add_section_pods", { p_race: raceId, p_color: section, p_count: count, p_beds: beds, p_capabilities: capabilities, p_expected_token: plan.token }).abortSignal(controller.signal);
      if (result.error) {
        setPlan(null);
        if (result.error.code === "40001") setError("The layout changed. Preview the changes again before confirming.");
        else { uncertainPods.current = pods; setUncertain(true); setError("Save not confirmed. Close and refresh the board before adding another batch; this batch may already exist."); }
      } else { setSaved(`${result.data} pods added.`); setPlan(null); setOpen(false); onSaved(); }
    } catch { uncertainPods.current = pods; setUncertain(true); setError("Save not confirmed. Close and refresh the board before adding another batch."); }
    finally { clearTimeout(timer); lock.current = false; setBusy(false); }
  }
  function close() {
    if (lock.current) return;
    if ((plan || capability.trim() || capabilities.length > 0) && !window.confirm("Discard this pod batch?")) return;
    setPlan(null); setOpen(false);
  }
  return <div className="grid gap-3">
    <button type="button" className={`${button} justify-self-start`} onClick={() => { setOpen(true); setPlan(null); setUncertain(false); setError(""); }} disabled={busy || (uncertain && pods === uncertainPods.current)}><Plus size={18} />Add pods</button>
    {saved && <p role="status">{saved}</p>}
    <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent className="board-modal">
    <DialogTitle>Add pods</DialogTitle>
    <DialogDescription className="sr-only">Create a pod batch for this race</DialogDescription>
    {plan ? <div className="grid gap-4">
      <h3 className="font-semibold">Confirm section changes</h3>
      <p className="break-words">Add: {plan.new_names.join(", ")}</p>
      <p>{plan.beds_per_pod} beds per new pod</p>
      <p className="break-words">Capabilities: {capabilities.join(", ") || "None"}</p>
      {plan.changes.length > 0 ? <div><h4 className="font-semibold">Renumber existing pods and beds</h4>
        <ul className="grid gap-2">{[...plan.changes].reverse().map(change => <li key={change.id} className="break-words border-b border-border py-2">
          <strong>{change.from} → {change.to}</strong>
          <p className="text-sm text-muted-foreground">{change.beds.map(bed => `${bed.from} → ${bed.to}`).join(", ")}</p>
        </li>)}</ul></div> : <p>No existing pods will be renumbered.</p>}
      <p>Patients stay in their existing beds. Patient records and timing history are preserved.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || uncertain} onClick={() => { void confirmSection(); }}>{busy ? "Saving..." : "Confirm addition"}</button>
        <button type="button" className={button} disabled={busy} onClick={() => setPlan(null)}>Back</button></div>
      {error && <p role="alert">{error}</p>}
    </div> : <>
    {colors.length > 0 && <label className="grid gap-2">Color section<div className="flex items-center gap-2">
      {section && <span aria-hidden className="h-6 w-6 shrink-0 rounded border" style={{ backgroundColor: section }} />}
      <select className={input} value={section} disabled={busy || uncertain} onChange={event => { setSection(event.target.value); setError(""); }}>
        <option value="">New group / pools</option>{colors.map(value => <option key={value} value={value}>{sectionLabel(value)}</option>)}
      </select></div></label>}
    <form onSubmit={submit} className="grid gap-4 border-y border-border py-4">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!section && <label className="grid gap-2">Name prefix (optional)<input className={input} maxLength={60} value={prefix} onChange={e => setPrefix(e.target.value)} /></label>}
        {!section && <label className="grid gap-2">Starting number<input className={input} type="number" min={1} max={9999} required value={start} onChange={e => setStart(Number(e.target.value))} /></label>}
        <label className="grid gap-2">Number of pods<input className={input} type="number" min={1} max={50} required value={count} onChange={e => setCount(Number(e.target.value))} /></label>
        <label className="grid gap-2">Beds per pod<input className={input} type="number" min={1} max={20} required value={beds} onChange={e => setBeds(Number(e.target.value))} /></label>
        {!section && <label className="grid gap-2">Pod type<select className={input} value={kind} onChange={e => { setKind(e.target.value); if (e.target.value === "pool") setBeds(1); }}><option value="regular">Regular</option><option value="pool">Pool</option></select></label>}
        {!section && <label className="grid gap-2">Pod color<input aria-label="Pod color" type="color" className="h-12 w-16" value={color} onChange={e => setColor(e.target.value)} /></label>}
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 gap-2">Capability<input className={input} disabled={busy} maxLength={80} value={capability} onChange={e => setCapability(e.target.value)} /></label>
        <button type="button" className={button} disabled={busy || !capability.trim() || capabilities.length >= 20} onClick={addCapability} aria-label="Add capability" title="Add capability"><Plus size={18} /></button>
      </div>
      <ul className="flex flex-wrap gap-3">{capabilities.map(value => <li key={value} className="flex max-w-full items-center gap-2"><span className="break-words">{value}</span><button type="button" disabled={busy} className="p-3" aria-label={`Remove ${value}`} title={`Remove ${value}`} onClick={() => setCapabilities(capabilities.filter(c => c !== value))}><X size={18} /></button></li>)}</ul>
      <p>{section ? sectionLabel(section) : `${label(start)}${count > 1 ? ` to ${label(start + count - 1)}` : ""}`} · {count * beds} new beds</p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || uncertain || Boolean(capability.trim())}>{busy ? "Loading..." : section ? "Preview changes" : "Create pods"}</button>
        <button type="button" className={button} disabled={busy} onClick={close}>Cancel</button></div>
    </form>
    </>}
    </DialogContent>
    </Dialog>
  </div>;
}
