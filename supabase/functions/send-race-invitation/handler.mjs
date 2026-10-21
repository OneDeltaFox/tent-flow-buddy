const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createInvitationHandler({ appUrl, authenticate, claim, send }) {
  let origin;
  try {
    const parsed = new URL(appUrl);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash) origin = parsed.origin;
  } catch { /* Missing configuration must fail closed. */ }
  return async request => {
    const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Vary": "Origin" };
    if (origin && request.headers.get("Origin") === origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "authorization, apikey, content-type, x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (!origin) return reply(503, { error: "Email delivery is not configured." });
    if (request.headers.get("Origin") && request.headers.get("Origin") !== origin) return reply(403, { error: "Origin not allowed." });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return reply(405, { error: "Method not allowed." });
    const token = request.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return reply(401, { error: "Sign in required." });
    let client;
    try { client = await authenticate(token); } catch { return reply(401, { error: "Sign in required." }); }
    if (!client) return reply(401, { error: "Sign in required." });
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 1024) return reply(400, { error: "Invalid request." });
      body = JSON.parse(raw);
      if (!body || !uuid.test(body.raceId) || !uuid.test(body.invitationId) || Object.keys(body).some(key => !["raceId", "invitationId"].includes(key))) throw new Error();
    } catch { return reply(400, { error: "Invalid request." }); }
    let email;
    try { email = await claim(client, body.raceId, body.invitationId); }
    catch { return reply(409, { error: "Invitation unavailable, already attempted, or sending limit reached. Refresh invitations." }); }
    try { await send(email); }
    catch { return reply(502, { error: "Email delivery not confirmed. Check delivery logs before creating another invitation." }); }
    return reply(200, { sent: true });
  };
}
