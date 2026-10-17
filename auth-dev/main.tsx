import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type Session } from "@supabase/supabase-js";
import { LogIn, LogOut } from "lucide-react";
import { RaceList } from "./race-list";
import "./styles.css";

const url = import.meta.env["VITE_SUPABASE_URL"];
const key = import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
const callbackFailed = new URLSearchParams(window.location.hash.slice(1)).has("error") ||
  new URLSearchParams(window.location.search).has("error");
// Only modern publishable keys are accepted. Never put a service-role key here.
const configured = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url ?? "") &&
  key?.startsWith("sb_publishable_");
const client = configured ? createClient(url, key, {
  auth: {
    storageKey: "tent-flow-dev-auth",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
  },
}) : null;

function SignIn() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(client));
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"password" | "link" | "reset">("password");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [editingPassword, setEditingPassword] = useState(false);
  const redirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href;
  const googleEnabled = import.meta.env["VITE_GOOGLE_AUTH_ENABLED"] === "true";

  useEffect(() => {
    if (!client) return;
    let active = true;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, next) => {
      if (active) {
        setSession(next);
        setPassword("");
        if (event === "PASSWORD_RECOVERY") setEditingPassword(true);
      }
    });
    client.auth.getSession().then(({ data, error: authError }) => {
      if (!active) return;
      setSession(data.session);
      if (authError || callbackFailed) setError("Sign-in could not be completed. Request a new link and open it in this browser.");
      setLoading(false);
      // Remove callback parameters, including provider errors, from the address bar.
      window.history.replaceState(null, "", window.location.pathname);
    }).catch(() => {
      if (active) {
        setError("Unable to check your session. Reload to retry.");
        setLoading(false);
      }
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!client || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "password") {
        const { error: authError } = await client.auth.signInWithPassword({ email: email.trim(), password });
        setPassword("");
        if (authError) setError("Unable to sign in. Check your email and password, or reset your password.");
        return;
      }
      if (mode === "reset") {
        const { error: authError } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (authError) setError("Unable to send a reset link. Please try again later.");
        else setMessage("If this account is eligible, a password reset link will arrive by email. Open it in this browser.");
        return;
      }
      const { error: authError } = await client.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: false,
          emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
        },
      });
      if (authError) setError("Unable to send a sign-in link. Check your invitation or try again later.");
      else setMessage("Check your email for a sign-in link. Open it in this browser.");
    } catch {
      setError("Unable to connect. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function savePassword(event: FormEvent) {
    event.preventDefault();
    if (!client || busy) return;
    setError("");
    setMessage("");
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const { error: authError } = await client.auth.updateUser({ password });
      if (authError) setError("Unable to update your password. You may need to sign in again or request a fresh reset link.");
      else { setEditingPassword(false); setMessage("Password updated."); }
    } catch { setError("Unable to connect. Please try again."); }
    finally { setPassword(""); setConfirmation(""); setBusy(false); }
  }

  async function googleSignIn() {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { error: authError } = await client.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
      if (authError) setError("Google sign-in is unavailable. Please use email sign-in.");
    } catch { setError("Unable to connect to Google sign-in."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    if (!client || busy) return;
    setBusy(true);
    setError("");
    try {
      const { error: authError } = await client.auth.signOut({ scope: "local" });
      if (authError) setError("Sign-out failed. Please try again.");
      else { setSession(null); setMessage(""); setEmail(""); setPassword(""); setConfirmation(""); setEditingPassword(false); }
    } catch { setError("Sign-out failed. Please try again."); }
    finally { setBusy(false); }
  }

  const button = "inline-flex min-h-12 items-center justify-center gap-2 rounded border border-foreground bg-foreground px-4 py-3 font-semibold text-background disabled:opacity-50";
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border px-6 py-5">
        <h1 className="text-2xl font-bold">TriageDesk</h1>
        <p className="text-sm text-muted-foreground">Development</p>
      </header>
      <section className={`mx-auto grid w-full ${session ? "max-w-none px-2 py-4" : "max-w-md px-6 py-12"} gap-5`}>
        <h2 className="text-xl font-semibold">{session ? "Account" : "Sign in"}</h2>
        {!client ? <p role="status">Development sign-in is not configured.</p> : loading ?
          <p role="status">Checking session...</p> : session ? <>
            <p className="break-all">{session.user.email}</p>
            {editingPassword ? <form onSubmit={savePassword} className="grid w-full max-w-md gap-4">
              <label className="grid gap-2">New password
                <input type="password" required minLength={12} autoComplete="new-password" value={password} disabled={busy}
                  onChange={(event) => setPassword(event.target.value)} className="min-h-12 rounded border border-border bg-background px-3" />
              </label>
              <p className="text-sm text-muted-foreground">Use at least 12 characters.</p>
              <label className="grid gap-2">Confirm password
                <input type="password" required minLength={12} autoComplete="new-password" value={confirmation} disabled={busy}
                  onChange={(event) => setConfirmation(event.target.value)} className="min-h-12 rounded border border-border bg-background px-3" />
              </label>
              <button className={button} disabled={busy}>Save password</button>
              <button type="button" disabled={busy} onClick={() => { setEditingPassword(false); setPassword(""); setConfirmation(""); }}>Cancel</button>
            </form> : <button className={button} disabled={busy} onClick={() => { setEditingPassword(true); setError(""); setMessage(""); }}>Set or change password</button>}
            <RaceList key={session.user.id} client={client} />
            <button className={button} disabled={busy} onClick={signOut}><LogOut size={18} />Sign out</button>
          </> : <form onSubmit={signIn} className="grid gap-4">
            <label className="grid gap-2 font-medium">Email
              <input type="email" required autoComplete="email" value={email}
                onChange={(event) => setEmail(event.target.value)} disabled={busy}
                className="min-h-12 w-full rounded border border-border bg-background px-3" />
            </label>
            {mode === "password" && <label className="grid gap-2 font-medium">Password
              <input type="password" required autoComplete="current-password" value={password} disabled={busy}
                onChange={(event) => setPassword(event.target.value)} className="min-h-12 w-full rounded border border-border bg-background px-3" />
            </label>}
            <button className={button} disabled={busy}><LogIn size={18} />{busy ? "Please wait..." : mode === "password" ? "Sign in" : mode === "reset" ? "Send password reset link" : "Send sign-in link"}</button>
            {googleEnabled && <button type="button" className={button} disabled={busy} onClick={googleSignIn}>Continue with Google</button>}
            {([ ["password", "Use password"], ["link", "Email me a sign-in link"], ["reset", "Forgot password?"] ] as const).filter(([value]) => value !== mode).map(([value, label]) =>
              <button type="button" key={value} disabled={busy} className="min-h-12 underline" onClick={() => { setMode(value); setPassword(""); setError(""); setMessage(""); }}>{label}</button>)}
          </form>}
        {message && <p role="status">{message}</p>}
        {error && <p role="alert" className="text-red-600">{error}</p>}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<SignIn />);
