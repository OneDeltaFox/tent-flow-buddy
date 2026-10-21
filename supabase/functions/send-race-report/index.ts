import { createClient } from "npm:@supabase/supabase-js@2.117.3";
import { createReportHandler } from "./handler.mjs";

const key = Deno.env.get("RESEND_API_KEY");
const timedFetch = (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) });
Deno.serve(createReportHandler({
  appUrl: Deno.env.get("INVITATION_APP_URL") ?? "",
  configured: Boolean(key),
  async authenticate(token: string) {
    const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: timedFetch, headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser(token);
    return error || !data.user ? null : client;
  },
  async claim(client: ReturnType<typeof createClient>, body: { raceId: string; reportId: string; attemptId: string }) {
    const { data, error } = await client.rpc("claim_report_email", { p_race: body.raceId, p_report: body.reportId, p_attempt: body.attemptId });
    if (error) throw error;
    return data;
  },
  async send(recipients: string[], text: string, attempt: string) {
    const response = await timedFetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `race-report/${attempt}` },
      body: JSON.stringify({ from: "TriageDesk <noreply@triagedeskapp.com>", to: "noreply@triagedeskapp.com", bcc: recipients, subject: "TriageDesk aggregate report", text }),
    });
    if (!response.ok || !(await response.json()).id) throw new Error("Delivery not confirmed");
  },
}));
