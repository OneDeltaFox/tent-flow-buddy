import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvitationHandler } from '../supabase/functions/send-race-invitation/handler.mjs';
const body = {raceId:'00000000-0000-0000-0000-000000000001',invitationId:'00000000-0000-0000-0000-000000000002'};
function setup(overrides={}) {
  const calls=[];
  const handler=createInvitationHandler({appUrl:'https://triagedesk-test.pages.dev/',authenticate:async()=>({}),claim:async()=>{calls.push('claim');return 'invited@example.test';},send:async(email)=>calls.push(email),...overrides});
  const request=(value=body,headers={})=>handler(new Request('https://function.test/',{method:'POST',headers:{Authorization:'Bearer user',Origin:'https://triagedesk-test.pages.dev',...headers},body:JSON.stringify(value)}));
  return {calls,request};
}
test('sends only to email resolved by protected claim',async()=>{
  const {calls,request}=setup(); assert.equal((await request()).status,200); assert.deepEqual(calls,['claim','invited@example.test']);
});
test('rejects unverified callers, foreign origins, and caller-controlled destinations',async()=>{
  for(const config of [{authenticate:async()=>null},{appUrl:''}]) {
    const {calls,request}=setup(config); assert.notEqual((await request()).status,200); assert.deepEqual(calls,[]);
  }
  const {calls,request}=setup();
  assert.equal((await request(body,{Origin:'https://evil.test'})).status,403);
  assert.equal((await request({...body,email:'other@example.test'})).status,400);
  assert.equal((await request({...body,redirectTo:'https://evil.test'})).status,400);
  assert.equal((await request({...body,raceId:'invalid'})).status,400);
  assert.deepEqual(calls,[]);
});
test('never sends after denied claim and never retries uncertain delivery',async()=>{
  const denied=setup({claim:async()=>{throw Error();}}); assert.equal((await denied.request()).status,409); assert.deepEqual(denied.calls,[]);
  let sends=0; const uncertain=setup({send:async()=>{sends++;throw Error();}});
  assert.equal((await uncertain.request()).status,502); assert.equal(sends,1);
});
