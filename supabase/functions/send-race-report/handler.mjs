const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = ['total_visits','completed_visits','incomplete_visits','notification_samples','notification_mean_seconds','notification_median_seconds','medical_samples','medical_mean_seconds','medical_median_seconds','pool_samples','pool_mean_seconds','pool_median_seconds','transfers','discharged','ems','other'];

export function reportText(report) {
  return ['TriageDesk combined performance report', `Generated: ${new Date(report.generated_at).toISOString()}`,
    'Timing values are seconds. Timing summaries with fewer than five samples are withheld.',
    ...fields.map(key => {
      const value = report.totals[key];
      const group = key.split('_')[0];
      const withheld = /_(mean|median)_seconds$/.test(key) && !(report.totals[`${group}_samples`] >= 5);
      return `${key.replaceAll('_', ' ')}: ${!withheld && typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 10) / 10 : 'Not available / withheld'}`;
    })].join('\n');
}

export function createReportHandler({ appUrl, configured, authenticate, claim, send }) {
  let origin;
  try { const url = new URL(appUrl); if (url.protocol === 'https:') origin = url.origin; } catch { /* Fail closed. */ }
  return async request => {
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin && request.headers.get('Origin') === origin) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
    if (!origin || !configured) return reply(503, { error: 'Report email is not configured.' });
    if (request.headers.get('Origin') && request.headers.get('Origin') !== origin) return reply(403, { error: 'Origin not allowed.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1];
    let client;
    try { client = token && await authenticate(token); } catch { /* Deny invalid sessions. */ }
    if (!client) return reply(401, { error: 'Sign in required.' });
    let body;
    try {
      const raw = await request.text();
      if (raw.length > 4096) throw new Error();
      body = JSON.parse(raw);
      if (!body || !uuid.test(body.raceId) || !uuid.test(body.reportId) || !uuid.test(body.attemptId) ||
        Object.keys(body).some(key => !['raceId','reportId','attemptId','recipients'].includes(key)) ||
        !Array.isArray(body.recipients) || !body.recipients.length || body.recipients.length > 10 ||
        body.recipients.some(address => typeof address !== 'string' || address.length > 254 || !/^[^\s@<>:,;]+@[^\s@<>:,;]+\.[^\s@<>:,;]+$/.test(address))) throw new Error();
      body.recipients = [...new Set(body.recipients.map(address => address.toLowerCase()))];
    } catch { return reply(400, { error: 'Invalid request.' }); }
    let report;
    try { report = await claim(client, body); }
    catch { return reply(409, { error: 'Report unavailable, already attempted, or sending limit reached.' }); }
    try { await send(body.recipients, reportText(report), body.attemptId); }
    catch { return reply(502, { error: 'Email delivery not confirmed. Check Resend delivery logs before sending again.' }); }
    return reply(200, { accepted: true });
  };
}
