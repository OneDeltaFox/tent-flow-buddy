import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Mail, RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

type Preview = { token: string; generation: number; total: number; active: number; state: string };
type Report = { id: string; generated_at: string; totals: Record<string, number | null> };
export function EndRace({ client, raceId, raceName, onClose, onChanged }: {
  client: SupabaseClient; raceId: string; raceName: string; onClose: () => void; onChanged: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [confirm, setConfirm] = useState("");
  const [allowActive, setAllowActive] = useState(false);
  const [recipients, setRecipients] = useState("");
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
  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setPreview(null); setConfirm(""); setAllowActive(false); setError("");
    try {
      setReports(await request("race_daily_reports", { p_race: raceId }));
      setPreview(await request("end_race_preview", { p_race: raceId }));
    } catch { setError("Unable to load End Race. Owner access and migration 014 are required."); }
    finally { lock.current = false; setBusy(false); }
  }
  useEffect(() => { void load(); }, [client, raceId]);
  async function finish() {
    if (lock.current || !preview || confirm !== "END RACE" || (preview.active > 0 && !allowActive)) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await request("end_race", { p_race: raceId, p_token: preview.token, p_generation: preview.generation, p_confirm: confirm, p_allow_active: allowActive });
      setEnded(true); setPreview(null);
      setReports(await request("race_daily_reports", { p_race: raceId }));
    } catch {
      setPreview(null);
      setError("Result not confirmed. Refresh this dialog and check saved reports before retrying. The board may have changed.");
    } finally { lock.current = false; setBusy(false); }
  }
  function email(report: Report) {
    const addresses = recipients.split(/[;,]/).map(value => value.trim()).filter(Boolean);
    if (!addresses.length || addresses.length > 10 || addresses.some(value => !/^[^\s@<>:]+@[^\s@<>:]+\.[^\s@<>:]+$/.test(value))) {
      setError("Enter 1-10 valid email addresses separated by commas."); return;
    }
    setError("");
    const body = ["TriageDesk combined performance report", `Generated: ${new Date(report.generated_at).toLocaleString()}`,
      "Timing values are seconds. Timing summaries with fewer than five samples are withheld.",
      ...Object.entries(report.totals).map(([key, value]) => `${key.replaceAll("_", " ")}: ${value === null ? "Not available / withheld" : Math.round(value * 10) / 10}`)].join("\n");
    window.location.href = `mailto:${addresses.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent("TriageDesk aggregate report")}&body=${encodeURIComponent(body)}`;
  }
  async function startNextDay() {
    if (lock.current || !reports[0]) return;
    lock.current = true; setBusy(true); setError("");
    try { await request("start_next_race_day", { p_race: raceId, p_report: reports[0].id }); onChanged(); }
    catch { setError("Start not confirmed. Close and refresh the race list before retrying."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) { if (ended) onChanged(); else onClose(); } }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>End Race / Daily Reports</DialogTitle>
      <p className="break-words font-semibold">{raceName}</p>
      <DialogDescription>Patient records and histories will be permanently removed from the active database. Beds and pools will be ready; the layout will remain. Account records and provider backups are not erased by this action.</DialogDescription>
      {error && <p role="alert">{error}</p>}
      {ended ? <p role="status">Race ended. Patient records cleared and report saved.</p> : preview?.state === "active" && <>
        <p>{preview.total} patient records; {preview.active} still active or incoming.</p>
        {preview.active > 0 && <label className="flex gap-2"><input type="checkbox" checked={allowActive} onChange={event => setAllowActive(event.target.checked)} />Delete unresolved patients too. They will be counted as incomplete, not discharged.</label>}
        <label className="grid gap-1">Type END RACE to confirm<input className="min-h-11 rounded border bg-background p-2" value={confirm} onChange={event => setConfirm(event.target.value)} /></label>
        <button className={`${button} bg-destructive text-destructive-foreground`} disabled={busy || confirm !== "END RACE" || (preview.active > 0 && !allowActive)} onClick={() => void finish()}>End Race and Delete Patient Data</button>
      </>}
      {(ended || preview?.state === "closed") && reports[0] && <button className={button} disabled={busy} onClick={() => void startNextDay()}>Start Next Day With This Layout</button>}
      <button className={`${button} flex items-center justify-center gap-2`} disabled={busy} onClick={() => void load()}><RefreshCw size={16} />Refresh Reports</button>
      <label className="grid gap-1">Report email addresses<input className="min-h-11 rounded border bg-background p-2" value={recipients} onChange={event => setRecipients(event.target.value)} placeholder="name@example.com, name@example.com" /></label>
      <p className="text-sm text-muted-foreground">Email opens a draft in your email app. Review the recipients and send it there.</p>
      {reports.map(report => <div key={report.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2"><span>{new Date(report.generated_at).toLocaleString()} · {report.totals["total_visits"]} patients</span><button className={`${button} flex items-center gap-2`} onClick={() => email(report)}><Mail size={16} />Email Report</button></div>)}
      <button className={button} disabled={busy} onClick={() => { if (ended) onChanged(); else onClose(); }}>Close</button>
    </DialogContent>
  </Dialog>;
}
