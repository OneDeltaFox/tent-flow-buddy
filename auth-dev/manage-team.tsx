import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Trash2, UserPlus, RefreshCw, Shield } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Role = "editor" | "viewer";
type Member = { id: string; email: string; role: Role | "owner" };
type Change = { email: string; previous: Role | null; next: Role | null };
export function ManageTeam({ client, raceId, onClose }: { client: SupabaseClient; raceId: string; onClose: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("viewer");
  const [pending, setPending] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded border px-3 disabled:opacity-50";
  async function request(endpoint: string, args: Record<string, unknown>) {
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 15000);
    try { return await client.rpc(endpoint,args).abortSignal(abort.signal); }
    finally { clearTimeout(timer); if (controller.current === abort) controller.current = null; }
  }
  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setReady(false); setPending(null);
    try {
      const result = await request("race_team", { p_race: raceId });
      if (result.error) throw result.error;
      if (alive.current) { setMembers(result.data ?? []); setReady(true); }
    } catch { if (alive.current) { setMembers([]); setError("Unable to load team. Owner access and migration 011 are required."); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => { alive.current=true; void load(); return () => { alive.current=false; controller.current?.abort(); }; }, [client,raceId]);
  async function save() {
    if (lock.current || !pending || !ready) return;
    lock.current=true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await request("set_race_member", { p_race: raceId, p_email: pending.email, p_expected_role: pending.previous, p_role: pending.next });
      if (result.error) throw result.error;
      if (!alive.current) return;
      setPending(null); setEmail(""); setMessage("Team access updated.");
      lock.current=false; await load();
    } catch (cause) {
      if (alive.current) {
        setReady(false);
        setError((cause as {code?: string}).code === "P0002" ? "Account not found. Invite or create this account in Supabase first, then refresh." : "Change not confirmed. Refresh the team and check access before retrying.");
      }
    } finally { lock.current=false; if (alive.current) setBusy(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !lock.current) onClose(); }}>
    <DialogContent className="board-modal">
      <DialogTitle>{pending ? "Confirm team access" : "Manage Team"}</DialogTitle>
      <DialogDescription>Race-specific access</DialogDescription>
      {pending ? <div className="grid gap-4">
        <p className="break-all font-semibold">{pending.email}</p>
        <p>{pending.previous ?? "No access"} to {pending.next ?? "No race access"}</p>
        <p>{pending.next === "editor" ? "Can view and edit patients. Cannot manage pods or the team." : pending.next === "viewer" ? "Can view the status board, including race numbers, complaints and timers. Cannot edit." : "Future requests to this race will be denied. Already displayed information cannot be recalled."}</p>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy || !ready} onClick={() => void save()}>Confirm change</button><button className={button} disabled={busy} onClick={() => setPending(null)}>Back</button></div>
      </div> : <div className="grid gap-4">
        <ul className="divide-y">{members.map(member => <li key={member.id} className="flex flex-wrap items-center gap-2 py-3">
          <span className="min-w-0 flex-1 break-all">{member.email}</span>
          {member.role === "owner" ? <span className="flex items-center gap-2"><Shield size={16} />Owner</span> : <>
            <select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy || !ready} className="min-h-11 rounded border bg-background px-2" onChange={event => { setMessage(""); setPending({ email: member.email, previous: member.role as Role, next: event.target.value as Role }); }}><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
            <button className={button} disabled={busy || !ready} aria-label={`Remove ${member.email}`} title={`Remove ${member.email}`} onClick={() => { setMessage(""); setPending({ email: member.email, previous: member.role as Role, next: null }); }}><Trash2 size={18} /></button>
          </>}
        </li>)}</ul>
        <form className="grid gap-3 border-t pt-3" onSubmit={event => {
          event.preventDefault(); const value=email.trim().toLowerCase();
          if (members.some(member => member.email.toLowerCase()===value)) { setError("This account already has race access."); return; }
          setError(""); setMessage(""); setPending({ email: value, previous: null, next: role });
        }}>
          <label className="grid gap-1">Existing account email<input type="email" required maxLength={320} value={email} disabled={busy || !ready} onChange={event => setEmail(event.target.value)} className="min-h-11 min-w-0 rounded border bg-background px-3" /></label>
          <label className="grid gap-1">Access<select value={role} disabled={busy || !ready} onChange={event => setRole(event.target.value as Role)} className="min-h-11 rounded border bg-background px-3"><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>
          <button className={button} disabled={busy || !ready}><UserPlus size={18} />Add member</button>
        </form>
      </div>}
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <div className="flex gap-2"><button className={button} disabled={busy} aria-label="Refresh team" title="Refresh team" onClick={() => void load()}><RefreshCw size={18} /></button><button className={button} disabled={busy} onClick={onClose}>Close</button></div>
    </DialogContent>
  </Dialog>;
}
