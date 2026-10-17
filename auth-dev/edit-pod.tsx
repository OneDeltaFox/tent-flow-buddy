import { useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pod } from "@/lib/tent-data";
import { Plus, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function EditPod({ client, pod, onClose, onSaved }: {
  client: SupabaseClient; pod: Pod; onClose: () => void; onSaved: () => void;
}) {
  const [closed, setClosed] = useState(Boolean(pod.closed));
  const [capabilities, setCapabilities] = useState([...pod.capabilities]);
  const [capability, setCapability] = useState("");
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const dirty = closed !== Boolean(pod.closed) || JSON.stringify(capabilities) !== JSON.stringify(pod.capabilities);
  const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded border border-border px-3 disabled:opacity-50";
  function close() { if (!lock.current && (!dirty || window.confirm("Discard unsaved pod changes?"))) onClose(); }
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc("update_pod", { p_pod: pod.id,
        p_expected: { name: pod.name, closed: Boolean(pod.closed), capabilities: pod.capabilities },
        p_closed: closed, p_capabilities: capabilities }).abortSignal(controller.signal);
      if (result.error) throw result.error;
      onSaved(); onClose();
    } catch {
      setError("Save not confirmed. Close this window and refresh the board before trying again.");
    } finally { clearTimeout(timer); lock.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="board-modal" style={{ borderLeftColor: pod.color, borderLeftWidth: 5 }}>
      <DialogTitle>{review ? "Confirm pod changes" : "Edit Pod"}: {pod.name}</DialogTitle>
      <DialogDescription>{pod.beds.filter(bed => bed.status === "occupied").length} patients assigned</DialogDescription>
      {review ? <div className="grid gap-3">
        <p>Pod status: <strong>{closed ? "Closed to new assignments" : "Open"}</strong></p>
        <p className="break-words">Capabilities: {capabilities.join(", ") || "None"}</p>
        {pod.capabilities.some(value => !capabilities.includes(value)) && <p className="break-words">Remove: {pod.capabilities.filter(value => !capabilities.includes(value)).join(", ")}</p>}
        {closed && <p>Existing patients and timing will be preserved.</p>}
        <div className="flex gap-2"><button type="button" className={button} disabled={busy || Boolean(error)} onClick={() => { void save(); }}>{busy ? "Saving..." : "Confirm changes"}</button>
          <button type="button" className={button} disabled={busy} onClick={() => setReview(false)}>Back</button></div>
      </div> : <form className="grid gap-4" onSubmit={event => { event.preventDefault(); setReview(true); }}>
        <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={closed} onChange={event => setClosed(event.target.checked)} />Closed to new assignments</label>
        <ul className="flex flex-wrap gap-2">{capabilities.map(value => <li key={value} className="flex max-w-full items-center gap-2 rounded border px-2">
          <span className="break-words">{value}</span><button type="button" title={`Remove ${value}`} aria-label={`Remove ${value}`} className="p-3" onClick={() => setCapabilities(capabilities.filter(item => item !== value))}><X size={18} /></button>
        </li>)}</ul>
        <div className="flex items-end gap-2"><label className="grid min-w-0 flex-1 gap-2">Capability<input className="min-h-11 w-full rounded border bg-background px-3" maxLength={80} value={capability} onChange={event => setCapability(event.target.value)} /></label>
          <button type="button" className={button} title="Add capability" aria-label="Add capability" disabled={!capability.trim() || capabilities.length >= 20} onClick={() => { const value = capability.trim(); if (!capabilities.includes(value)) setCapabilities([...capabilities,value]); setCapability(""); }}><Plus size={18} /></button></div>
        <div className="flex gap-2"><button className={button} disabled={!dirty || Boolean(capability.trim()) || Boolean(error)}>Review changes</button><button type="button" className={button} onClick={close}>Cancel</button></div>
      </form>}
      {error && <p role="alert">{error}</p>}
    </DialogContent>
  </Dialog>;
}
