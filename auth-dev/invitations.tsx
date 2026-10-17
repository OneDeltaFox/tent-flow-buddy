import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RefreshCw, UserPlus, X } from "lucide-react";

type Invitation = { id: string; email?: string; name?: string; role: string; expires_at: string };
type Action = { endpoint: string; args: Record<string, unknown>; description: string };
export function Invitations({ client, raceId, onAccepted }: { client: SupabaseClient; raceId?: string; onAccepted?: () => void }) {
  const [items, setItems] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Action | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const abort = useRef<AbortController | null>(null);
  const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded border px-3 disabled:opacity-50";
  async function request(endpoint: string, args: Record<string, unknown>) {
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const result = await client.rpc(endpoint, args).abortSignal(controller.signal);
      if (result.error) throw result.error;
      return result.data;
    } finally { clearTimeout(timer); }
  }
  async function load() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setReady(false); setPending(null); setError("");
    try {
      const data = await request(raceId ? "race_invitations" : "my_race_invitations", raceId ? { p_race: raceId } : {});
      if (alive.current) { setItems(data ?? []); setReady(true); }
    } catch { if (alive.current) { setItems([]); setError("Invitations unavailable. Refresh to retry."); } }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; abort.current?.abort(); }; }, [client, raceId]);
  async function confirm() {
    if (!pending || lock.current || !ready) return;
    lock.current = true; setBusy(true); setError("");
    try {
      await request(pending.endpoint, pending.args);
      if (!alive.current) return;
      setPending(null); setEmail("");
      lock.current = false; await load();
      if (!raceId) onAccepted?.();
    } catch {
      if (alive.current) { setReady(false); setError("Change not confirmed. Refresh invitations and race access before retrying. Existing members cannot be invited again."); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="grid gap-3 border-t pt-4" aria-label="Invitations">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Invitations</h3><button className={button} disabled={busy} title="Refresh invitations" aria-label="Refresh invitations" onClick={() => void load()}><RefreshCw size={18} /></button></div>
    {pending ? <div className="grid gap-3"><p className="break-words">{pending.description}</p><div className="flex gap-2"><button className={button} disabled={busy || !ready} onClick={() => void confirm()}>Confirm invitation</button><button className={button} disabled={busy} onClick={() => setPending(null)}>Back</button></div></div> : <>
      {ready && items.length === 0 && <p>No pending invitations.</p>}
      <ul className="divide-y">{items.map(item => <li className="flex flex-wrap items-center gap-3 py-2" key={item.id}>
        <div className="min-w-0 flex-1"><p className="break-words">{item.email ?? item.name}</p><p className="capitalize">{item.role}</p><p className="text-sm">{Date.parse(item.expires_at) <= Date.now() ? "Expired" : `Expires ${new Date(item.expires_at).toLocaleDateString()}`}</p></div>
        {raceId ? <button className={button} disabled={busy || !ready} title={`Cancel invitation for ${item.email}`} aria-label={`Cancel invitation for ${item.email}`} onClick={() => setPending({ endpoint: "cancel_race_invitation", args: { p_race: raceId, p_invitation: item.id }, description: `Cancel the invitation for ${item.email}?` })}><X size={18} /></button> : <button className={button} disabled={busy || !ready} onClick={() => setPending({ endpoint: "accept_race_invitation", args: { p_invitation: item.id }, description: `Accept ${item.role} access to ${item.name}?` })}>Accept</button>}
      </li>)}</ul>
      {raceId && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); setPending({ endpoint: "create_race_invitation", args: { p_race: raceId, p_email: email.trim(), p_role: role }, description: `Create a seven-day ${role} invitation for ${email.trim()}? No email will be sent.` }); }}>
        <label className="grid gap-1">Invitation email<input className="min-h-11 min-w-0 rounded border bg-background px-3" type="email" required maxLength={320} disabled={busy || !ready} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="grid gap-1">Invitation role<select className="min-h-11 rounded border bg-background px-3" value={role} disabled={busy || !ready} onChange={event => setRole(event.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>
        <p className="text-sm">Email delivery is not connected. The invitation will be available after sign-in with the matching verified email.</p>
        <button className={button} disabled={busy || !ready}><UserPlus size={18} />Create invitation</button>
      </form>}
    </>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
