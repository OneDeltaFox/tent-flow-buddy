import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ComplaintOption } from "@/lib/complaints";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

export function ManageComplaints({ client, raceId, initial, onClose, onSaved }: {
  client: SupabaseClient; raceId: string; initial: ComplaintOption[]; onClose: () => void; onSaved: () => void;
}) {
  const [options,setOptions]=useState(initial.map(x=>({...x})));
  const [expected]=useState(initial);
  const [label,setLabel]=useState("");
  const [review,setReview]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const dirty=JSON.stringify(options)!==JSON.stringify(expected);
  const valid=options.every(x=>x.label.trim() && x.label.trim().toLowerCase()!=="other") && new Set(options.map(x=>x.label.trim().toLowerCase())).size===options.length;
  const button="min-h-11 rounded border px-3 disabled:opacity-50";
  function close() { if(!busy && (!dirty || window.confirm("Discard complaint list changes?"))) onClose(); }
  async function save() {
    if(busy || !valid) return;
    setBusy(true);
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),15000);
    try {
      const result=await client.rpc("save_race_complaints",{p_race:raceId,p_expected:expected,p_options:options.map(x=>({...x,label:x.label.trim()}))}).abortSignal(controller.signal);
      if(result.error) throw result.error;
      onSaved(); onClose();
    } catch { setError("Save not confirmed. Close and reopen the complaint list before retrying."); }
    finally { clearTimeout(timer); setBusy(false); }
  }
  return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="board-modal">
    <DialogTitle>{review ? "Confirm complaint changes" : "Manage Chief Complaints"}</DialogTitle>
    <DialogDescription>Existing patient complaints remain unchanged. Other stays available.</DialogDescription>
    {review ? <>
      <ul className="grid gap-2">{options.map((x,i)=><li key={i}>{x.label} {x.enabled ? "" : "(Hidden)"}</li>)}</ul>
      <button className={button} disabled={busy || Boolean(error)} onClick={()=>void save()}>{busy ? "Saving..." : "Confirm changes"}</button>
      <button className={button} disabled={busy} onClick={()=>setReview(false)}>Back</button>
    </> : <>
      <div className="grid gap-2">{options.map((x,i)=><div key={i} className="flex min-w-0 items-center gap-3">
        <input aria-label={`Complaint ${i+1}`} maxLength={80} className="min-h-11 min-w-0 flex-1 rounded border bg-background px-2" value={x.label} onChange={e=>setOptions(options.map((v,j)=>i===j?{...v,label:e.target.value}:v))}/>
        <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={x.enabled} onChange={e=>setOptions(options.map((v,j)=>i===j?{...v,enabled:e.target.checked}:v))}/>Visible</label>
      </div>)}</div>
      <div className="flex min-w-0 gap-2"><input aria-label="New complaint" maxLength={80} className="min-h-11 min-w-0 flex-1 rounded border bg-background px-2" value={label} onChange={e=>setLabel(e.target.value)}/><button className={button} aria-label="Add complaint" title="Add complaint" disabled={!label.trim() || options.length>=100 || label.trim().toLowerCase()==="other" || options.some(x=>x.label.toLowerCase()===label.trim().toLowerCase())} onClick={()=>{setOptions([...options,{label:label.trim(),enabled:true}]);setLabel("");}}><Plus size={18}/></button></div>
      {!valid && <p role="alert">Use unique, nonempty names. Other is reserved.</p>}
      <button className={button} disabled={!dirty || !valid || Boolean(label.trim()) || Boolean(error)} onClick={()=>setReview(true)}>Review changes</button>
    </>}
    {error && <p role="alert">{error}</p>}
    <button className={button} disabled={busy} onClick={close}>Cancel</button>
  </DialogContent></Dialog>;
}
