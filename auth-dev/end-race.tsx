import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Preview = { token: string; generation: number; total: number; active: number; state: string; report_free: boolean; last_reset_id?: string | null };
export function EndRace({ client, raceId, raceName, onClose, onChanged }: {
  client: SupabaseClient; raceId: string; raceName: string; onClose: () => void; onChanged: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirm, setConfirm] = useState("");
  const [allowActive, setAllowActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ended, setEnded] = useState(false);
  const lock = useRef(false);
  const button = "min-h-11 rounded border px-3 disabled:opacity-50";
  async function request(name: string, args: Record<string, unknown>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc(name, args).abortSignal(controller.signal);
      if (result.error) throw result.error;
      return result.data;
    } finally { clearTimeout(timer); }
  }
  async function readPreview() {
    const next = await request("end_race_preview", { p_race: raceId }) as Preview;
    if (next?.report_free !== true) throw new Error("Reset update required");
    setPreview(next);
  }
  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setPreview(null); setConfirm(""); setAllowActive(false); setError("");
    try { await readPreview(); }
    catch { setError("Unable to load End Race. Owner access and the report-free reset update are required."); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => { void load(); }, [client, raceId]);
  async function finish() {
    if (lock.current || !preview?.report_free || confirm !== "END RACE" || (preview.active > 0 && !allowActive)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await request("end_race", { p_race: raceId, p_token: preview.token, p_generation: preview.generation, p_confirm: confirm, p_allow_active: allowActive });
      setEnded(true); setPreview(null);
      await readPreview();
    } catch {
      setPreview(null);
      setError("Result not confirmed. Refresh this dialog and check the race status before retrying. The board may have changed.");
    } finally { lock.current = false; setBusy(false); }
  }
  async function startNextDay() {
    if (lock.current || !preview?.last_reset_id) return;
    lock.current = true; setBusy(true); setError("");
    try { await request("start_next_race_day", { p_race: raceId, p_report: preview.last_reset_id }); onChanged(); }
    catch { setError("Start not confirmed. Close and refresh the race list before retrying."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) { if (ended) onChanged(); else onClose(); } }}>
    <DialogContent style={{ maxHeight: "90dvh", overflowY: "auto" }} className="sm:max-w-xl" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>End Race</DialogTitle>
      <p className="break-words font-semibold">{raceName}</p>
      <DialogDescription>Patient details, movements, and timing histories will be permanently removed from the active database. No report will be saved. Beds and pools will be ready; the layout, capabilities, and team permissions will remain. Provider backups and previously exported copies are not erased.</DialogDescription>
      {error && <p role="alert">{error}</p>}
      {ended ? <p role="status">Race ended. Patient data cleared. Layout ready for reuse.</p> : preview?.state === "active" && <>
        <p>{preview.total} patient records; {preview.active} still active or incoming.</p>
        {preview.active > 0 && <label className="flex gap-2"><input type="checkbox" checked={allowActive} onChange={event => setAllowActive(event.target.checked)} />Clear patients who are still active or incoming too.</label>}
        <label className="grid gap-1">Type END RACE to confirm<input className="min-h-11 rounded border bg-background p-2" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
        <button className={`${button} bg-destructive text-destructive-foreground`} disabled={busy || confirm !== "END RACE" || (preview.active > 0 && !allowActive)} onClick={() => void finish()}>End Race and Delete Patient Data</button>
      </>}
      {preview?.state === "closed" && preview.last_reset_id && <button className={button} disabled={busy} onClick={() => void startNextDay()}>Start Next Day With This Layout</button>}
      <button className={`${button} flex items-center justify-center gap-2`} disabled={busy} onClick={() => void load()}><RefreshCw size={16} />Refresh Status</button>
      <button className={button} disabled={busy} onClick={() => { if (ended) onChanged(); else onClose(); }}>Close</button>
    </DialogContent>
  </Dialog>;
}
