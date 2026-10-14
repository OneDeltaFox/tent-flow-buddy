import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Plus, X } from "lucide-react";

export function AddPods({ client, raceId, onSaved }: { client: SupabaseClient; raceId: string; onSaved: () => void }) {
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
    if (busy) return;
    setBusy(true); setError(""); setSaved("");
    try {
      const result = await client.rpc("create_pods", { p_race: raceId, p_pods:
        Array.from({ length: count }, (_, i) => ({ name: label(start + i), beds, kind, color, capabilities })) });
      if (result.error) {
        setError(result.error.code === "23505" ? "A pod name already exists. Change the starting number or prefix." :
          "Could not confirm the save. Refresh the board before retrying; the batch may already be saved.");
      } else {
        setSaved(`${result.data} pod${result.data === 1 ? "" : "s"} added.`);
        setStart(start + count); setOpen(false); onSaved();
      }
    } catch { setError("Could not confirm the save. Refresh the board before retrying."); }
    finally { setBusy(false); }
  }
  return <div className="grid gap-3">
    <button type="button" className={`${button} justify-self-start`} onClick={() => { setOpen(!open); setError(""); }} disabled={busy}><Plus size={18} />Add pods</button>
    {saved && <p role="status">{saved}</p>}
    {open && <form onSubmit={submit} className="grid gap-4 border-y border-border py-4">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-2">Name prefix (optional)<input className={input} maxLength={60} value={prefix} onChange={e => setPrefix(e.target.value)} /></label>
        <label className="grid gap-2">Starting number<input className={input} type="number" min={1} max={9999} required value={start} onChange={e => setStart(Number(e.target.value))} /></label>
        <label className="grid gap-2">Number of pods<input className={input} type="number" min={1} max={50} required value={count} onChange={e => setCount(Number(e.target.value))} /></label>
        <label className="grid gap-2">Beds per pod<input className={input} type="number" min={1} max={20} required value={beds} onChange={e => setBeds(Number(e.target.value))} /></label>
        <label className="grid gap-2">Pod type<select className={input} value={kind} onChange={e => { setKind(e.target.value); if (e.target.value === "pool") setBeds(1); }}><option value="regular">Regular</option><option value="pool">Pool</option></select></label>
        <label className="grid gap-2">Pod color<input aria-label="Pod color" type="color" className="h-12 w-16" value={color} onChange={e => setColor(e.target.value)} /></label>
      </fieldset>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 flex-1 gap-2">Capability<input className={input} disabled={busy} maxLength={80} value={capability} onChange={e => setCapability(e.target.value)} /></label>
        <button type="button" className={button} disabled={busy || !capability.trim() || capabilities.length >= 20} onClick={addCapability} aria-label="Add capability" title="Add capability"><Plus size={18} /></button>
      </div>
      <ul className="flex flex-wrap gap-3">{capabilities.map(value => <li key={value} className="flex max-w-full items-center gap-2"><span className="break-words">{value}</span><button type="button" disabled={busy} className="p-3" aria-label={`Remove ${value}`} title={`Remove ${value}`} onClick={() => setCapabilities(capabilities.filter(c => c !== value))}><X size={18} /></button></li>)}</ul>
      <p>{label(start)}{count > 1 ? ` to ${label(start + count - 1)}` : ""} · {count * beds} beds</p>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || Boolean(capability.trim())}>{busy ? "Saving..." : "Create pods"}</button>
        <button type="button" className={button} disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
  </div>;
}
