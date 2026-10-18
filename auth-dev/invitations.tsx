import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Mail, RefreshCw, UserPlus, X } from "lucide-react";

type Invitation = { id: string; email?: string; name?: string; role: string; expires_at: string; email_attempted_at?: string | null };
type Action = { endpoint: string; args: Record<string, unknown>; description: string };
export function Invitations({ client, raceId, onAccepted }: { client: SupabaseClient; raceId?: string; onAccepted?: () => void }) {
  const [items, setItems] = useState<Invitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
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
  async function sendEmail(invitationId: string) {
    const controller = new AbortController(); abort.current = controller;
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const { data, error: deliveryError } = await client.functions.invoke("send-race-invitation", {
        body: { raceId, invitationId }, signal: controller.signal,
      });
      if (deliveryError || data?.sent !== true) throw new Error("Email not confirmed");
    } finally { clearTimeout(timer); }
  }
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; abort.current?.abort(); }; }, [client, raceId]);
  async function confirm() {
    if (!pending || lock.current || !ready) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (pending.endpoint === "send_email") {
        await sendEmail(String(pending.args["p_invitation"]));
        if (alive.current) setMessage("Email accepted for sending. The recipient must sign in and accept their race invitation.");
      } else {
        const result = await request(pending.endpoint, pending.args);
        if (pending.endpoint === "create_race_invitation") {
          if (!alive.current) return;
          await sendEmail(result);
          if (alive.current) setMessage("Invitation created and email accepted for sending.");
        }
      }
      if (!alive.current) return;
      setPending(null); setEmail("");
      lock.current = false; await load();
      if (!raceId) onAccepted?.();
    } catch {
      if (alive.current) { setReady(false); setError("Change or email delivery not confirmed. Refresh invitations before retrying. The invitation may already exist. If email was attempted, check delivery logs before canceling and creating another invitation."); }
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <section className="grid gap-3 border-t pt-4" aria-label="Invitations">
    <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">Invitations</h3><button className={button} disabled={busy} title="Refresh invitations" aria-label="Refresh invitations" onClick={() => void load()}><RefreshCw size={18} /></button></div>
    {pending ? <div className="grid gap-3"><p className="break-words">{pending.description}</p><div className="flex gap-2"><button className={button} disabled={busy || !ready} onClick={() => void confirm()}>Confirm invitation</button><button className={button} disabled={busy} onClick={() => setPending(null)}>Back</button></div></div> : <>
      {ready && items.length === 0 && <p>No pending invitations.</p>}
      <ul className="divide-y">{items.map(item => <li className="flex flex-wrap items-center gap-3 py-2" key={item.id}>
        <div className="min-w-0 flex-1"><p className="break-words">{item.email ?? item.name}</p><p className="capitalize">{item.role}</p><p className="text-sm">{Date.parse(item.expires_at) <= Date.now() ? "Expired" : `Expires ${new Date(item.expires_at).toLocaleDateString()}`}</p>{raceId && item.email_attempted_at && <p className="text-sm">Email attempted {new Date(item.email_attempted_at).toLocaleString()}</p>}</div>
        {raceId && !item.email_attempted_at && Date.parse(item.expires_at) > Date.now() && <button className={button} disabled={busy || !ready} title={`Send invitation email to ${item.email}`} aria-label={`Send invitation email to ${item.email}`} onClick={() => setPending({ endpoint: "send_email", args: { p_invitation: item.id }, description: `Send an account invitation or sign-in email to ${item.email}? Race access still requires acceptance.` })}><Mail size={18} /></button>}
        {raceId ? <button className={button} disabled={busy || !ready} title={`Cancel invitation for ${item.email}`} aria-label={`Cancel invitation for ${item.email}`} onClick={() => setPending({ endpoint: "cancel_race_invitation", args: { p_race: raceId, p_invitation: item.id }, description: `Cancel the invitation for ${item.email}?` })}><X size={18} /></button> : <button className={button} disabled={busy || !ready} onClick={() => setPending({ endpoint: "accept_race_invitation", args: { p_invitation: item.id }, description: `Accept ${item.role} access to ${item.name}?` })}>Accept</button>}
      </li>)}</ul>
      {raceId && <form className="grid gap-3" onSubmit={event => { event.preventDefault(); setPending({ endpoint: "create_race_invitation", args: { p_race: raceId, p_email: email.trim(), p_role: role }, description: `Create a seven-day ${role} invitation and send an account invitation or sign-in email to ${email.trim()}? Race access still requires acceptance.` }); }}>
        <label className="grid gap-1">Invitation email<input className="min-h-11 min-w-0 rounded border bg-background px-3" type="email" required maxLength={320} disabled={busy || !ready} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="grid gap-1">Invitation role<select className="min-h-11 rounded border bg-background px-3" value={role} disabled={busy || !ready} onChange={event => setRole(event.target.value)}><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>
        <button className={button} disabled={busy || !ready}><UserPlus size={18} />Send invitation</button>
      </form>}
    </>}
    {error && <p role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
