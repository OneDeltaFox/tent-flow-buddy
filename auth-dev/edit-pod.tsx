import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pod } from "@/lib/tent-data";
import { Plus, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function EditPod({ client, pod, onClose, onSaved }: {
  client: SupabaseClient; pod: Pod; onClose: () => void; onSaved: () => void;
}) {
  const [closed, setClosed] = useState(Boolean(pod.closed));
  const [name, setName] = useState(pod.name);
  const [color, setColor] = useState(pod.color);
  const [kind, setKind] = useState(pod.kind || "regular");
  const [beds, setBeds] = useState(pod.beds.length);
  const [capabilities, setCapabilities] = useState([...pod.capabilities]);
  const [capability, setCapability] = useState("");
  const [review, setReview] = useState(false);
  const [deleting,setDeleting]=useState(false);
  const [deleteConfirm,setDeleteConfirm]=useState("");
  const hasPatients=pod.beds.some(b=>b.status==="occupied" || b.bib || b.reserved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const dirty = name.trim() !== pod.name || color !== pod.color || kind !== (pod.kind || "regular") || beds !== pod.beds.length || closed !== Boolean(pod.closed) || JSON.stringify(capabilities) !== JSON.stringify(pod.capabilities);
  const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded border border-border px-3 disabled:opacity-50";
  function close() { if (!lock.current && (!dirty || window.confirm("Discard unsaved pod changes?"))) onClose(); }
  async function remove() {
    if(lock.current || deleteConfirm!==pod.name || hasPatients) return;
    lock.current=true; setBusy(true);
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const result=await client.rpc("delete_pod",{p_pod:pod.id,p_expected:{name:pod.name,color:pod.color,kind:pod.kind || "regular",beds:pod.beds.length,closed:Boolean(pod.closed),capabilities:pod.capabilities},p_confirm:deleteConfirm}).abortSignal(controller.signal);
      if(result.error) throw result.error;
      onSaved(); onClose();
    } catch { setError("Deletion not confirmed. Close and refresh the board before retrying. Assigned patients or reserved beds block deletion."); }
    finally {clearTimeout(timer);lock.current=false;setBusy(false);}
  }
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc("edit_pod_settings", { p_pod: pod.id,
        p_expected: { name: pod.name, color: pod.color, kind: pod.kind || "regular", beds: pod.beds.length, closed: Boolean(pod.closed), capabilities: pod.capabilities },
        p_name: name.trim(), p_color: color, p_kind: kind, p_beds: beds,
        p_closed: closed, p_capabilities: capabilities }).abortSignal(controller.signal);
      if (result.error) throw result.error;
      onSaved(); onClose();
    } catch (cause) {
      const message = (cause as { message?: string })?.message || "";
      const known = ["Cannot remove used or reserved beds", "Cannot change type while occupied or reserved", "Pod name or number already exists", "Pod changed; refresh before retrying", "Race is not active"];
      setError(known.includes(message) ? message : "Save not confirmed. Close this window and refresh the board before trying again.");
    } finally { clearTimeout(timer); lock.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="board-modal" style={{ borderLeftColor: pod.color, borderLeftWidth: 5 }}>
      <DialogTitle>{deleting ? "Delete Pod" : review ? "Confirm pod changes" : "Edit Pod"}: {pod.name}</DialogTitle>
      <DialogDescription>{pod.beds.filter(bed => bed.status === "occupied").length} patients assigned</DialogDescription>
      {deleting ? <div className="grid gap-3">
        <p>Remove {pod.name} and its beds from this race? Patient history and timings will remain. Other pods will not be renumbered.</p>
        <label className="grid gap-2">Type {pod.name} to confirm<input className="min-h-11 rounded border bg-background px-3" disabled={busy} value={deleteConfirm} onChange={e=>setDeleteConfirm(e.target.value)}/></label>
        <button className={`${button} border-destructive text-destructive`} disabled={busy || Boolean(error) || deleteConfirm!==pod.name || hasPatients} onClick={()=>void remove()}>Confirm Delete Pod</button>
        <button className={button} disabled={busy} onClick={()=>setDeleting(false)}>Cancel</button>
      </div> : review ? <div className="grid gap-3">
        <p className="break-words">Name: <strong>{name.trim()}</strong></p>
        <p className="flex items-center gap-2">Color: <span className="inline-block h-6 w-6 border" style={{ backgroundColor: color }} />{color}</p>
        <p>Type: {kind === "pool" ? "Pool" : "Regular"}; beds: {pod.beds.length} &rarr; {beds}</p>
        {beds < pod.beds.length && <p>Highest-numbered beds will be removed only if unused. Patient history and reserved beds are protected.</p>}
        <p>Pod status: <strong>{closed ? "Closed to new assignments" : "Open"}</strong></p>
        <p className="break-words">Capabilities: {capabilities.join(", ") || "None"}</p>
        {pod.capabilities.some(value => !capabilities.includes(value)) && <p className="break-words">Remove: {pod.capabilities.filter(value => !capabilities.includes(value)).join(", ")}</p>}
        {closed && <p>Existing patients and timing will be preserved.</p>}
        <div className="flex gap-2"><button type="button" className={button} disabled={busy || Boolean(error)} onClick={() => { void save(); }}>{busy ? "Saving..." : "Confirm changes"}</button>
          <button type="button" className={button} disabled={busy} onClick={() => setReview(false)}>Back</button></div>
      </div> : <form className="grid gap-4" onSubmit={event => { event.preventDefault(); setReview(true); }}>
        <label className="grid gap-2">Pod name<input required maxLength={80} className="min-h-11 rounded border bg-background px-3" value={name} onChange={event => setName(event.target.value)} /></label>
        <label className="grid gap-2">Pod color<input aria-label="Pod color" type="color" className="h-12 w-16" value={color} onChange={event => setColor(event.target.value)} /></label>
        <label className="grid gap-2">Pod type<select className="min-h-11 rounded border bg-background px-3" value={kind} onChange={event => setKind(event.target.value as "regular" | "pool")}><option value="regular">Regular</option><option value="pool">Pool</option></select></label>
        <label className="grid gap-2">Beds per pod<input required type="number" min={1} max={20} className="min-h-11 rounded border bg-background px-3" value={beds} onChange={event => setBeds(Number(event.target.value))} /></label>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={closed} onChange={event => setClosed(event.target.checked)} />Closed to new assignments</label>
        <ul className="flex flex-wrap gap-2">{capabilities.map(value => <li key={value} className="flex max-w-full items-center gap-2 rounded border px-2">
          <span className="break-words">{value}</span><button type="button" title={`Remove ${value}`} aria-label={`Remove ${value}`} className="p-3" onClick={() => setCapabilities(capabilities.filter(item => item !== value))}><X size={18} /></button>
        </li>)}</ul>
        <div className="flex items-end gap-2"><label className="grid min-w-0 flex-1 gap-2">Capability<input className="min-h-11 w-full rounded border bg-background px-3" maxLength={80} value={capability} onChange={event => setCapability(event.target.value)} /></label>
          <button type="button" className={button} title="Add capability" aria-label="Add capability" disabled={!capability.trim() || capabilities.length >= 20} onClick={() => { const value = capability.trim(); if (!capabilities.includes(value)) setCapabilities([...capabilities,value]); setCapability(""); }}><Plus size={18} /></button></div>
        <div className="flex gap-2"><button className={button} disabled={!dirty || Boolean(capability.trim()) || Boolean(error)}>Review changes</button><button type="button" className={button} onClick={close}>Cancel</button></div>
        <div className="border-t pt-3"><button type="button" className={`${button} border-destructive text-destructive`} disabled={hasPatients || Boolean(error)} onClick={()=>{setDeleteConfirm("");setDeleting(true);}}><Trash2 size={18}/>Delete Pod</button>{hasPatients && <p className="mt-2 text-sm">Move or disposition patients and release reserved beds before deleting this pod.</p>}</div>
      </form>}
      {error && <p role="alert">{error}</p>}
    </DialogContent>
  </Dialog>;
}
