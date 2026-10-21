import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { createInvitationHandler } from "./handler.mjs";

const url = Deno.env.get("SUPABASE_URL")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const appUrl = Deno.env.get("INVITATION_APP_URL") ?? "";
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const timedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(10000) });

Deno.serve(createInvitationHandler({
  appUrl,
  async authenticate(token: string) {
    const client = createClient(url, anon, { ...options, global: { fetch: timedFetch, headers: { Authorization: `Bearer ${token}` } } });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return client;
  },
  async claim(client: ReturnType<typeof createClient>, race: string, invitation: string) {
    const { data, error } = await client.rpc("claim_invitation_email", { p_race: race, p_invitation: invitation });
    if (error) throw new Error("Invitation unavailable or email already attempted.");
    return data.email;
  },
  async send(email: string) {
    const admin = createClient(url, service, { ...options, global: { fetch: timedFetch } });
    const result = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: appUrl });
    if (!result.error) return;
    // Only this definite Auth response is safe to fall back from. Never retry a timeout.
    if (result.error.code !== "email_exists" && result.error.code !== "user_already_exists") throw new Error("Email not confirmed.");
    const auth = createClient(url, anon, { ...options, global: { fetch: timedFetch } });
    const { error } = await auth.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: appUrl } });
    if (error) throw new Error("Email not confirmed.");
  },
}));
