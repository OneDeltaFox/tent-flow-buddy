import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReportHandler, reportText } from '../../supabase/functions/send-race-report/handler.mjs';
const id = '00000000-0000-0000-0000-000000000001';
const report = { generated_at: '2026-10-18T12:00:00Z', totals: { total_visits: 5, medical_samples: 1, medical_mean_seconds: 99, notes: 'SECRET', bib: 'PRIVATE' } };
test('report formatter sends only allowlisted aggregates and suppresses small timings', () => {
  const text = reportText(report);
  assert.match(text, /total visits: 5/);
  assert.doesNotMatch(text, /SECRET|PRIVATE|99/);
});
test('email handler validates auth, origin, recipients, claim and delivery result', async () => {
  let claims = 0, sends = 0;
  const options = { appUrl: 'https://triagedeskapp.com', configured: true, authenticate: async token => token === 'valid' ? {} : null,
    claim: async () => { claims++; return report; }, send: async () => { sends++; } };
  const request = (body, token='valid', origin='https://triagedeskapp.com') => new Request('https://example.com', { method:'POST', headers:{Authorization:`Bearer ${token}`,Origin:origin}, body:JSON.stringify(body) });
  const body = { raceId:id, reportId:id, attemptId:id, recipients:['test@example.com'] };
  const handler = createReportHandler(options);
  assert.equal((await handler(request(body,'bad'))).status,401);
  assert.equal((await handler(request(body,'valid','https://evil.example'))).status,403);
  assert.equal((await handler(request({...body,recipients:['x\r\n@example.com']}))).status,400);
  assert.equal((await handler(request({...body,totals:report.totals}))).status,400);
  assert.equal(claims,0);
  assert.equal((await handler(request(body))).status,200);
  assert.equal(sends,1);
  assert.equal((await createReportHandler({...options,configured:false})(request(body))).status,503);
  assert.equal((await createReportHandler({...options,claim:async()=>{throw Error();}})(request(body))).status,409);
  assert.equal(sends,1);
  assert.equal((await createReportHandler({...options,send:async()=>{throw Error();}})(request(body))).status,502);
});
