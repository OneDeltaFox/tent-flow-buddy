import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const url = process.env.DATABASE_TEST_URL;
if (url && new URL(url).pathname !== '/tent_flow_test') {
  throw new Error('Only a disposable database named tent_flow_test is allowed');
}
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const owner=id(1), editor=id(2), viewer=id(3), outsider=id(4), race=id(10), foreignRace=id(11);
const regular=id(20), pool=id(21), closed=id(22), bed=id(30), poolBed=id(31), closedBed=id(32), foreignBed=id(33), secondBed=id(34);
const visit=id(40), incoming=id(41), foreignVisit=id(42);

test('database foundation', async (t) => {
  const db = url ? new pg.Client({connectionString:url}) : new PGlite();
  if (url) await db.connect();
  const exec = (sql) => url ? db.query(sql) : db.exec(sql);
  const query = (sql, args=[]) => db.query(sql,args);
  t.after(async () => { if (url) await db.end(); else await db.close(); });
  // Fail instead of changing any pre-existing schema. This harness never drops a database.
  assert.equal((await query("select 1 from pg_namespace where nspname in ('race_private','auth')")).rows.length,0);
  await exec(`create role authenticated nologin; create role anon nologin;
    create schema auth;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  const migrationDir = new URL('../migrations/',import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()) {
    await exec(await readFile(new URL(name,migrationDir),'utf8'));
  }
  await exec(`insert into auth.users(id) values ('${owner}'),('${editor}'),('${viewer}'),('${outsider}');
    insert into race_private.races(id,owner_id,name) values ('${race}','${owner}','Fictional race'),('${foreignRace}','${outsider}','Other race');
    insert into race_private.memberships values ('${race}','${editor}','editor'),('${race}','${viewer}','viewer');
    insert into race_private.pods(id,race_id,name,kind,color,closed) values
      ('${regular}','${race}','Pod 1','regular','#ffcc00',false),
      ('${pool}','${race}','Pool 1','pool','#ffcc00',false),
      ('${closed}','${race}','Closed','regular','#ffcc00',true),
      ('${id(23)}','${foreignRace}','Other','regular','#ffcc00',false);
    insert into race_private.beds(id,race_id,pod_id,label) values
      ('${bed}','${race}','${regular}','1-1'),('${secondBed}','${race}','${regular}','1-2'),
      ('${poolBed}','${race}','${pool}','Pool 1-1'),('${closedBed}','${race}','${closed}','Closed-1'),
      ('${foreignBed}','${foreignRace}','${id(23)}','Other-1');
    insert into race_private.visits(id,race_id,notified_at) values
      ('${visit}','${race}',clock_timestamp()-interval '10 minutes'),
      ('${incoming}','${race}',null),('${foreignVisit}','${foreignRace}',null);
    insert into race_private.visit_details(visit_id,race_id,bib,complaint,notes) values
      ('${visit}','${race}','FAKE-1','Dizziness','Private test note'),
      ('${incoming}','${race}','FAKE-2','Other','Another private note'),
      ('${foreignVisit}','${foreignRace}','FAKE-3','','');`);

  async function asUser(user,sql,args=[]) {
    await exec('set role authenticated');
    await query("select set_config('request.jwt.claim.sub',$1,false)",[user]);
    try { return await query(sql,args); } finally { await exec('reset role'); }
  }
  const transition=(user,v,revision,action,destination=null,category=null,other=null)=>asUser(user,
    'select race_private.transition_visit($1,$2,$3,$4,$5,$6)',[v,revision,action,destination,category,other]);

  await t.test('reporting and report email are disabled for every app role', async()=>{
    for (const user of [owner,editor,viewer,outsider]) {
      await assert.rejects(asUser(user,'select public.claim_report_email($1,$2,$3)',[race,id(980),id(981)]),/permission denied/);
      await assert.rejects(asUser(user,'select public.race_daily_reports($1)',[race]),/permission denied/);
      await assert.rejects(asUser(user,'select * from race_private.report_preview($1)',[race]),/permission denied/);
    }
  });
  await t.test('End Race is confirmed, owner-only, atomic and retry-safe across days', async()=>{
    const r=id(900), p=id(901), b=id(902), v=id(903);
    await query('insert into race_private.races(id,owner_id,name) values($1,$2,$3)',[r,owner,'Reset fixture']);
    await query("insert into race_private.pods(id,race_id,name,color) values($1,$2,'Pod 1','#ffcc00')",[p,r]);
    await query("insert into race_private.beds(id,race_id,pod_id,label,cleaning) values($1,$2,$3,'1-1',true)",[b,r,p]);
    await query('insert into race_private.visits(id,race_id) values($1,$2)',[v,r]);
    await query("insert into race_private.visit_details(visit_id,race_id,bib,notes) values($1,$2,'SECRET-BIB','SECRET-NOTE')",[v,r]);
    const preview=async()=> (await asUser(owner,'select public.end_race_preview($1) p',[r])).rows[0].p;
    const end=(u,x,confirmation='END RACE',allow=true)=>asUser(u,'select public.end_race($1,$2,$3,$4,$5) id',[r,x.token,x.generation,confirmation,allow]);
    const initial=await preview();
    for(const u of [editor,viewer,outsider]) await assert.rejects(end(u,initial),/Access denied/);
    await assert.rejects(end(owner,initial,'no'),/Confirmation/);
    await assert.rejects(end(owner,initial,'END RACE',false),/Active patients/);
    await query('update race_private.visits set revision=revision+1 where id=$1',[v]);
    await assert.rejects(end(owner,initial),/Board changed/);
    assert.equal((await query('select count(*)::int n from race_private.visit_details where race_id=$1',[r])).rows[0].n,1);
    const current=await preview();
    const saved=(await end(owner,current)).rows[0].id;
    for(const table of ['visits','visit_details','placements','events','turnovers','bed_reservations']) {
      assert.equal((await query(`select count(*)::int n from race_private.${table} where race_id=$1`,[r])).rows[0].n,0);
    }
    assert.equal((await query('select cleaning from race_private.beds where id=$1',[b])).rows[0].cleaning,false);
    assert.equal((await query('select state from race_private.races where id=$1',[r])).rows[0].state,'closed');
    assert.equal((await query('select count(*)::int n from race_private.daily_reports where race_id=$1',[r])).rows[0].n,0);
    const receipt=(await query('select * from race_private.race_resets where id=$1',[saved])).rows[0];
    assert.deepEqual(Object.keys(receipt).sort(),['generation','id','race_id']);
    assert.equal((await preview()).last_reset_id,saved);
    assert.equal((await preview()).report_free,true);
    assert.equal((await end(owner,current)).rows[0].id,saved);
    await asUser(owner,'select public.start_next_race_day($1,$2)',[r,saved]);
    await query('insert into race_private.visits(id,race_id) values($1,$2)',[v,r]);
    assert.equal((await end(owner,current)).rows[0].id,saved);
    assert.equal((await query('select count(*)::int n from race_private.visits where race_id=$1',[r])).rows[0].n,1);
    assert.equal((await query('select state from race_private.races where id=$1',[r])).rows[0].state,'active');
    await query('delete from race_private.visits where race_id=$1',[r]);
    await query('delete from race_private.race_resets where race_id=$1',[r]);
    await query('delete from race_private.beds where race_id=$1',[r]);
    await query('delete from race_private.pods where race_id=$1',[r]);
    await query('delete from race_private.races where id=$1',[r]);
  });

  await t.test('invitations require verified matching email and preserve existing access', async()=>{
    const invited=id(501), wrong=id(502);
    await query('insert into auth.users(id,email) values ($1,$2),($3,$4)',[invited,'invite@example.test',wrong,'wrong@example.test']);
    for (const user of [editor,viewer,outsider]) await assert.rejects(asUser(user,'select public.create_race_invitation($1,$2,$3)',[race,'invite@example.test','editor']),/Access denied/);
    await assert.rejects(asUser(owner,'select public.create_race_invitation($1,$2,$3)',[race,'invite@example.test','owner']),/Invalid role/);
    const create=async()=> (await asUser(owner,'select public.create_race_invitation($1,$2,$3) id',[race,' INVITE@example.test ','editor'])).rows[0].id;
    const first=await create();
    await assert.rejects(create(),/duplicate key/);
    assert.deepEqual((await asUser(invited,'select public.my_race_invitations() i')).rows[0].i,[]);
    await assert.rejects(asUser(invited,'select public.accept_race_invitation($1)',[first]),/Verified email/);
    await query('update auth.users set email_confirmed_at=now() where id in ($1,$2)',[invited,wrong]);
    await assert.rejects(asUser(wrong,'select public.accept_race_invitation($1)',[first]),/unavailable/);
    await assert.rejects(asUser(editor,'select public.cancel_race_invitation($1,$2)',[race,first]),/Access denied/);
    await asUser(owner,'select public.cancel_race_invitation($1,$2)',[race,first]);
    await assert.rejects(asUser(invited,'select public.accept_race_invitation($1)',[first]),/unavailable/);
    const expired=await create();
    await query("update race_private.invitations set expires_at=now()-interval '1 second' where id=$1",[expired]);
    await assert.rejects(asUser(invited,'select public.accept_race_invitation($1)',[expired]),/unavailable/);
    const last=await create();
    assert.equal((await asUser(invited,'select public.my_race_invitations() i')).rows[0].i.length,1);
    await asUser(invited,'select public.accept_race_invitation($1)',[last]);
    assert.equal((await query('select role from race_private.memberships where race_id=$1 and user_id=$2',[race,invited])).rows[0].role,'editor');
    await assert.rejects(asUser(invited,'select public.accept_race_invitation($1)',[last]),/unavailable/);
    await assert.rejects(create(),/already has access/);
    await assert.rejects(asUser(viewer,'select public.race_invitations($1)',[race]),/Access denied/);
    await exec('set role anon');
    await assert.rejects(query('select public.my_race_invitations()'),/permission denied/);
    await exec('reset role');
    // Isolate this fixture from the existing team audit-count assertions.
    await query('delete from race_private.team_events where user_id=$1',[invited]);
    await query('delete from race_private.memberships where user_id=$1',[invited]);
  });

  await t.test('invitation email claims enforce ownership, expiry, one attempt and owner-wide limits', async()=>{
    const create=async(n)=> (await asUser(owner,'select public.create_race_invitation($1,$2,$3) id',[race,`delivery-${n}@example.test`,'viewer'])).rows[0].id;
    const claim=(user,inv,r=race)=>asUser(user,'select public.claim_invitation_email($1,$2) result',[r,inv]);
    const inv=await create(0);
    for(const user of [editor,viewer,outsider]) await assert.rejects(claim(user,inv),/Access denied/);
    await assert.rejects(claim(owner,inv,foreignRace),/Access denied/);
    assert.deepEqual((await claim(owner,inv)).rows[0].result,{email:'delivery-0@example.test'});
    await assert.rejects(claim(owner,inv),/already attempted/);
    const canceled=await create('canceled');
    await asUser(owner,'select public.cancel_race_invitation($1,$2)',[race,canceled]);
    await assert.rejects(claim(owner,canceled),/unavailable/);
    const expired=await create('expired');
    await query("update race_private.invitations set expires_at=now()-interval '1 second' where id=$1",[expired]);
    await assert.rejects(claim(owner,expired),/unavailable/);
    for(let n=1;n<10;n++) await claim(owner,await create(n));
    await assert.rejects(claim(owner,await create(10)),/limit reached/);
    await exec('set role anon');
    await assert.rejects(query('select public.claim_invitation_email($1,$2)',[race,inv]),/permission denied/);
    await exec('reset role');
  });

  await t.test('viewer display endpoint is member-only and strictly projected', async()=>{
    for (const user of [owner,editor,viewer]) {
      const s=(await asUser(user,'select public.viewer_status($1) s',[race])).rows[0].s;
      assert.deepEqual(Object.keys(s).sort(),['beds','metrics','pods']);
      assert.deepEqual(Object.keys(s.beds[0]).sort(),['bed_id','bib','complaint','label','medical_started_at','pod_id','pool_started_at','reserved','status','triage']);
      assert.equal(s.metrics.incoming,2);
      assert.ok(!JSON.stringify(s).includes('Private test note'));
      assert.ok(!JSON.stringify(s).includes('FAKE-3'));
    }
    await assert.rejects(asUser(outsider,'select public.viewer_status($1)',[race]),/Access denied/);
    await exec('set role anon');
    await assert.rejects(query('select public.viewer_status($1)',[race]),/permission denied/);
    await exec('reset role');
  });

  await t.test('all application tables have RLS; anonymous functions are denied',async()=>{
    assert.equal((await query("select count(*)::int n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='race_private' and c.relkind='r' and not c.relrowsecurity")).rows[0].n,0);
    await exec('set role anon');
    await assert.rejects(query('select * from race_private.status_board($1)',[race]),/permission denied/);
    await exec('reset role');
  });
  await t.test('public race list enforces membership without disclosing owner ids',async()=>{
    for (const [user, role, expectedRace] of [[owner,'owner',race],[editor,'editor',race],[viewer,'viewer',race],[outsider,'owner',foreignRace]]) {
      const rows=(await asUser(user,'select * from public.my_races()')).rows;
      assert.equal(rows.length,1);
      assert.equal(rows[0].id,expectedRace);
      assert.equal(rows[0].role,role);
      assert.deepEqual(Object.keys(rows[0]).sort(),['id','name','role','state','timezone']);
    }
    assert.equal((await asUser(id(999),'select * from public.my_races()')).rows.length,0);
    await exec('set role anon');
    await assert.rejects(query('select * from public.my_races()'),/permission denied/);
    await exec('reset role');
  });
  await t.test('layout is member-only and contains no patient details',async()=>{
    for (const user of [owner,editor,viewer]) {
      const result=(await asUser(user,'select public.race_layout($1) layout',[race])).rows[0].layout;
      assert.equal(result.length,3);
      assert.ok(result.every(p=>p.beds.every(b=>b.status==='open')));
      assert.ok(!JSON.stringify(result).includes('FAKE-'));
      assert.deepEqual(Object.keys(result[0]).sort(),['beds','capabilities','closed','color','id','kind','name']);
      assert.deepEqual(Object.keys(result[0].beds[0]).sort(),['id','label','status']);
    }
    await assert.rejects(asUser(outsider,'select public.race_layout($1)',[race]),/Access denied/);
    await assert.rejects(asUser(owner,'select public.race_layout($1)',[foreignRace]),/Access denied/);
    await exec('set role anon');
    await assert.rejects(query('select public.race_layout($1)',[race]),/permission denied/);
    await exec('reset role');
  });
  await t.test('race isolation and viewer redaction',async()=>{
    assert.equal((await asUser(outsider,'select * from race_private.visits where race_id=$1',[race])).rows.length,0);
    assert.equal((await asUser(viewer,'select * from race_private.visit_details')).rows.length,0);
    assert.equal((await asUser(viewer,'select * from race_private.events')).rows.length,0);
    assert.equal((await asUser(viewer,'select * from race_private.status_board($1)',[foreignRace])).rows.length,0);
    await assert.rejects(transition(viewer,visit,0,'arrived'),/Access denied/);
    await assert.rejects(transition(outsider,visit,0,'arrived'),/Access denied/);
    await assert.rejects(asUser(editor,"update race_private.memberships set role='editor'"),/permission denied/);
    await assert.rejects(asUser(owner,"update race_private.beds set cleaning=false"),/permission denied/);
  });
  await t.test('notification does not start medical time; arrival alone does not either',async()=>{
    const before=(await query('select * from race_private.visits where id=$1',[visit])).rows[0];
    assert.equal(before.medical_started_at,null);
    assert.equal((await query('select triage from race_private.visit_details where visit_id=$1',[visit])).rows[0].triage,'untriaged');
    await transition(editor,visit,0,'arrived');
    const after=(await query('select * from race_private.visits where id=$1',[visit])).rows[0];
    assert.ok(after.arrived_at); assert.equal(after.medical_started_at,null);
  });
  await t.test('reject closed and cross-race beds without changing revision',async()=>{
    await assert.rejects(transition(editor,visit,1,'assigned',closedBed),/Bed unavailable/);
    await assert.rejects(transition(editor,visit,1,'assigned',foreignBed),/Bed unavailable/);
    assert.equal((await query('select revision from race_private.visits where id=$1',[visit])).rows[0].revision,1);
  });
  await t.test('assignment starts medical clock; stale retries and occupied beds fail',async()=>{
    await transition(editor,visit,1,'assigned',bed);
    await assert.rejects(transition(editor,visit,1,'assigned',poolBed),/Stale visit/);
    await assert.rejects(transition(editor,incoming,0,'assigned',bed),/Bed unavailable/);
    assert.equal((await query('select count(*)::int n from race_private.placements where ended_at is null')).rows[0].n,1);
  });
  await t.test('pool movement preserves medical clock and starts independent interval',async()=>{
    const start=(await query('select medical_started_at from race_private.visits where id=$1',[visit])).rows[0].medical_started_at;
    await transition(editor,visit,2,'assigned',poolBed);
    const board=(await asUser(viewer,'select * from race_private.status_board($1)',[race])).rows.find(x=>x.bed_id===poolBed);
    assert.equal(new Date(board.medical_started_at).getTime(),new Date(start).getTime());
    assert.ok(board.pool_started_at); assert.equal('notes' in board,false);
    assert.equal((await query('select bed_id from race_private.bed_reservations where visit_id=$1',[visit])).rows[0].bed_id,bed);
    assert.equal((await query('select id from race_private.turnovers where bed_id=$1 and ended_at is null',[bed])).rows.length,0);
    await assert.rejects(transition(editor,incoming,0,'assigned',bed),/reserved/);
    const snapshot=(await asUser(owner,'select public.patient_board($1) as board',[race])).rows[0].board;
    assert.equal(snapshot.reservations.length,1);
    assert.equal(snapshot.pods.flatMap(p=>p.beds).find(b=>b.id===bed).status,'occupied');
    await transition(editor,visit,3,'assigned',bed);
    assert.equal((await query('select * from race_private.bed_reservations where visit_id=$1',[visit])).rows.length,0);
    const oldPool=(await query('select * from race_private.placements where bed_id=$1',[poolBed])).rows[0];
    assert.ok(oldPool.ended_at);
    const poolTurnover=(await query('select id from race_private.turnovers where bed_id=$1 and ended_at is null',[poolBed])).rows[0].id;
    await asUser(editor,'select race_private.ready_bed($1,$2)',[poolBed,poolTurnover]);
    await transition(editor,visit,4,'assigned',poolBed);
  });
  await t.test('disposition requires Other detail, closes pool, leaves cleaning',async()=>{
    await assert.rejects(transition(editor,visit,5,'dispositioned',null,'other',' '),/Other description required/);
    await transition(editor,visit,5,'dispositioned',null,'other','Fictional detail');
    await assert.rejects(transition(editor,visit,6,'assigned',secondBed),/already dispositioned/);
    assert.equal((await query('select * from race_private.placements where visit_id=$1 and ended_at is null',[visit])).rows.length,0);
    assert.equal((await query('select cleaning from race_private.beds where id=$1',[poolBed])).rows[0].cleaning,true);
    assert.equal((await query('select cleaning from race_private.beds where id=$1',[bed])).rows[0].cleaning,true);
    assert.equal((await query('select * from race_private.bed_reservations where visit_id=$1',[visit])).rows.length,0);
  });
  await t.test('direct bed entry auto-arrives without inventing notification',async()=>{
    await transition(owner,incoming,0,'assigned',secondBed);
    const v=(await query('select * from race_private.visits where id=$1',[incoming])).rows[0];
    assert.equal(v.notified_at,null);
    assert.equal(new Date(v.arrived_at).getTime(),new Date(v.medical_started_at).getTime());
  });
  await t.test('report averages known intervals, excludes incomplete visits and private data',async()=>{
    // Deterministic timestamps are test fixtures, never accepted from a browser command.
    await query(`update race_private.visits set notified_at='2026-01-01 10:00Z',arrived_at='2026-01-01 10:10Z',medical_started_at='2026-01-01 10:15Z',dispositioned_at='2026-01-01 11:15Z' where id=$1`,[visit]);
    await query(`update race_private.placements set started_at='2026-01-01 10:20Z',ended_at='2026-01-01 10:25Z' where visit_id=$1 and kind='pool'`,[visit]);
    // Historical report code remains for migration reproducibility, inaccessible to app roles.
    await query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
    const report=(await query('select * from race_private.report_preview($1)',[race])).rows[0];
    assert.equal(report.total_visits,2); assert.equal(report.incomplete_visits,1);
    assert.equal(report.notification_samples,1); assert.equal(report.notification_mean_seconds,600);
    assert.equal(report.medical_samples,1); assert.equal(report.medical_mean_seconds,3600);
    assert.equal(report.medical_median_seconds,3600);
    assert.equal(report.pool_samples,1); assert.equal(report.pool_mean_seconds,600);
    assert.equal(report.transfers,3); assert.equal(report.other,1);
    assert.equal(/FAKE|Dizziness|Private|Fictional detail|visit_id|bib|complaint|notes/.test(JSON.stringify(report)),false);
    assert.equal((await query('select * from race_private.reports')).rows.length,0);
    await assert.rejects(asUser(editor,'select * from race_private.report_preview($1)',[race]),/permission denied/);
    await assert.rejects(asUser(owner,'select * from race_private.report_preview($1)',[foreignRace]),/permission denied/);
  });
  await t.test('pod batches require owner, validate settings, and rollback duplicate names',async()=>{
    const batch=JSON.stringify([{name:'Batch 1',kind:'regular',color:'#ffcc00',beds:4,capabilities:['Cooling','IV']}]);
    const create=(user,payload=batch)=>asUser(user,'select public.create_pods($1,$2)',[race,payload]);
    await assert.rejects(create(editor),/Access denied/);
    await assert.rejects(create(viewer),/Access denied/);
    await assert.rejects(create(outsider),/Access denied/);
    await assert.rejects(create(owner,'[]'),/1 to 50/);
    await assert.rejects(create(owner,JSON.stringify([{name:'Bad',kind:'regular',color:'#ffcc00',beds:0,capabilities:[]}])),/1 to 20/);
    assert.equal((await create(owner)).rows[0].create_pods,1);
    const labels=(await query("select b.label from race_private.beds b join race_private.pods p on p.id=b.pod_id where p.name='Batch 1' order by b.label")).rows.map(r=>r.label);
    assert.deepEqual(labels,['Batch 1-1','Batch 1-2','Batch 1-3','Batch 1-4']);
    const duplicate=JSON.stringify([{name:'Rollback',kind:'pool',color:'#ffcc00',beds:1,capabilities:[]},JSON.parse(batch)[0]]);
    await assert.rejects(create(owner,duplicate),/duplicate key/);
    assert.equal((await query("select count(*)::int n from race_private.pods where name='Rollback'")).rows[0].n,0);
    await exec('set role anon');
    await assert.rejects(query('select public.create_pods($1,$2)',[race,batch]),/permission denied/);
    await exec('reset role');
  });
  await t.test('patient RPCs enforce access, atomic edits, revisions and stable create IDs',async()=>{
    const fresh=id(70), target=id(71);
    await query('insert into race_private.beds(id,race_id,pod_id,label) values($1,$2,$3,$4)',[target,race,regular,'1-70']);
    const payload=JSON.stringify({bib:'TEST-70',complaint:'Dizziness',notes:'Private note'});
    const save=(user,revision=null,destination=null,body=payload)=>asUser(user,'select public.save_patient($1,$2,$3,$4,$5)',[race,fresh,revision,body,destination]);
    for(const user of [viewer,outsider]) {
      await assert.rejects(save(user),/Access denied/);
      await assert.rejects(asUser(user,'select public.patient_board($1)',[race]),/Access denied/);
    }
    await assert.rejects(save(editor,null,closedBed),/Bed unavailable/);
    assert.equal((await query('select id from race_private.visits where id=$1',[fresh])).rows.length,0);
    await save(editor);
    await assert.rejects(save(editor),/Stale visit/);
    const snapshot=(await asUser(owner,'select public.patient_board($1) board',[race])).rows[0].board;
    const created=snapshot.visits.find(v=>v.id===fresh);
    assert.equal(created.triage,'untriaged'); assert.ok(created.notified_at); assert.equal(created.medical_started_at,null);
    await assert.rejects(save(editor,1,closedBed,JSON.stringify({bib:'SHOULD-ROLLBACK'})),/Bed unavailable/);
    assert.equal((await query('select bib from race_private.visit_details where visit_id=$1',[fresh])).rows[0].bib,'TEST-70');
    await save(editor,1,target);
    await assert.rejects(save(editor,1),/Stale visit/);
    await assert.rejects(asUser(viewer,"select public.move_patient($1,2,'dispositioned',null,'discharged')",[fresh]),/Access denied/);
    await asUser(editor,"select public.move_patient($1,2,'dispositioned',null,'discharged')",[fresh]);
    const turnover=(await query('select id from race_private.turnovers where bed_id=$1 and ended_at is null',[target])).rows[0].id;
    await asUser(editor,'select public.ready_patient_bed($1,$2)',[target,turnover]);
    await assert.rejects(asUser(editor,'select public.ready_patient_bed($1,$2)',[target,turnover]),/Stale turnover/);
    await assert.rejects(save(editor,3),/already dispositioned/);
    await exec('set role anon');
    await assert.rejects(query('select public.patient_board($1)',[race]),/permission denied/);
    await assert.rejects(query('select public.save_patient($1,$2,null,$3)',[race,id(72),payload]),/permission denied/);
    await exec('reset role');
  });
  await t.test('closing races reject commands and no End Race command exists',async()=>{
    await query("update race_private.races set state='closing' where id=$1",[race]);
    await assert.rejects(transition(owner,incoming,1,'dispositioned',null,'discharged'),/not active/);
    await query("update race_private.races set state='active' where id=$1",[race]);
    assert.equal((await query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='race_private' and proname in ('end_race','close_race','delete_patient')")).rows.length,0);
  });
  await t.test('pod management preserves patients and atomically renumbers color sections',async()=>{
    const r=id(80), patient=id(81);
    await query('insert into race_private.races(id,owner_id,name) values($1,$2,$3)',[r,owner,'Section test']);
    await query("insert into race_private.memberships values($1,$2,'editor'),($1,$3,'viewer')",[r,editor,viewer]);
    await asUser(owner,'select public.create_pods($1,$2)',[r,JSON.stringify([
      ...[1,2,3,4].map(n=>({name:`Pod ${n}`,kind:'regular',color:n<=2?'#ff8800':'#ffff00',beds:2,capabilities:['Cooling']})),
      {name:'Pool 1',kind:'pool',color:'#ff8800',beds:1,capabilities:[]}
    ])]);
    const pod=(await query("select * from race_private.pods where race_id=$1 and name='Pod 3'",[r])).rows[0];
    const beds=(await query('select * from race_private.beds where pod_id=$1 order by label',[pod.id])).rows;
    await asUser(owner,'select public.save_patient($1,$2,null,$3,$4)',[r,patient,JSON.stringify({bib:'SECTION-TEST'}),beds[0].id]);
    const before=(await query('select * from race_private.visits where id=$1',[patient])).rows[0];
    const expected={name:pod.name,closed:false,capabilities:['Cooling']};
    const edit=(user,closed,caps,old=expected)=>asUser(user,'select public.update_pod($1,$2,$3,$4)',[pod.id,JSON.stringify(old),closed,JSON.stringify(caps)]);
    for(const user of [editor,viewer,outsider]) await assert.rejects(edit(user,true,[]),/Access denied/);
    await edit(owner,true,['Cooling','IV','IV']);
    await assert.rejects(edit(owner,false,[]),/Pod changed/);
    await assert.rejects(asUser(owner,'select public.save_patient($1,$2,null,$3,$4)',[r,id(82),JSON.stringify({bib:'REJECTED'}),beds[1].id]),/Bed unavailable/);
    assert.equal((await query('select bed_id from race_private.placements where visit_id=$1 and ended_at is null',[patient])).rows[0].bed_id,beds[0].id);
    await edit(owner,false,['Cooling'],{name:pod.name,closed:true,capabilities:['Cooling','IV']});
    const preview=(user=owner)=>asUser(user,"select public.preview_section_pods($1,'#ff8800',2,4) plan",[r]);
    for(const user of [editor,viewer,outsider]) await assert.rejects(preview(user),/Access denied/);
    let plan=(await preview()).rows[0].plan;
    assert.deepEqual(plan.new_names,['Pod 3','Pod 4']);
    assert.equal(plan.changes.find(c=>c.id===pod.id).to,'Pod 5');
    const apply=(user,token,caps=[])=>asUser(user,"select public.add_section_pods($1,'#ff8800',2,4,$2,$3)",[r,JSON.stringify(caps),token]);
    for(const user of [editor,viewer,outsider]) await assert.rejects(apply(user,plan.token),/Access denied/);
    await query('update race_private.beds set cleaning=true where id=$1',[beds[1].id]);
    await assert.rejects(apply(owner,plan.token),/Layout changed/);
    plan=(await preview()).rows[0].plan;
    await assert.rejects(apply(owner,plan.token,[123]),/Invalid capabilities/);
    assert.equal((await query('select name from race_private.pods where id=$1',[pod.id])).rows[0].name,'Pod 3');
    await apply(owner,plan.token,['IV']);
    await assert.rejects(apply(owner,plan.token),/Layout changed/);
    assert.equal((await query('select name from race_private.pods where id=$1',[pod.id])).rows[0].name,'Pod 5');
    const afterBeds=(await query('select * from race_private.beds where pod_id=$1 order by label',[pod.id])).rows;
    assert.deepEqual(afterBeds.map(b=>b.id),beds.map(b=>b.id));
    assert.deepEqual(afterBeds.map(b=>b.label),['5-1','5-2']);
    assert.equal(afterBeds[1].cleaning,true);
    assert.deepEqual((await query('select * from race_private.visits where id=$1',[patient])).rows[0],before);
    assert.equal((await query('select bed_id from race_private.placements where visit_id=$1 and ended_at is null',[patient])).rows[0].bed_id,beds[0].id);
    assert.equal((await query("select count(*)::int n from race_private.pods where race_id=$1 and name='Pool 1'",[r])).rows[0].n,1);
    await assert.rejects(asUser(owner,'select public.create_pods($1,$2)',[r,JSON.stringify([{name:'3',kind:'regular',color:'#ff8800',beds:1,capabilities:[]}])]),/duplicate key/);
    await query("update race_private.races set state='closed' where id=$1",[r]);
    await assert.rejects(preview(),/not active/);
    await assert.rejects(edit(owner,true,[]),/not active/);
    await exec('set role anon');
    await assert.rejects(query("select public.preview_section_pods($1,'#ff8800',2,4)",[r]),/permission denied/);
    await assert.rejects(query('select public.update_pod($1,$2,false,$3)',[pod.id,JSON.stringify(expected),'[]']),/permission denied/);
    await exec('reset role');
  });
  await t.test('pool transfers retain reservations and a different regular bed releases them atomically',async()=>{
    const r=id(90), v=id(91);
    await query('insert into race_private.races(id,owner_id,name) values($1,$2,$3)',[r,owner,'Reservation test']);
    await asUser(owner,'select public.create_pods($1,$2)',[r,JSON.stringify([
      {name:'Pod 1',kind:'regular',color:'#ff8800',beds:2,capabilities:[]},
      {name:'Pool 1',kind:'pool',color:'#ffff00',beds:2,capabilities:[]}
    ])]);
    const beds=(await query('select b.id,p.kind from race_private.beds b join race_private.pods p on p.id=b.pod_id where b.race_id=$1 order by p.kind,b.label',[r])).rows;
    const pools=beds.filter(b=>b.kind==='pool'), regulars=beds.filter(b=>b.kind==='regular');
    await asUser(owner,'select public.save_patient($1,$2,null,$3,$4)',[r,v,JSON.stringify({bib:'TEST',triage:'untriaged'}),regulars[0].id]);
    const move=(rev,b)=>asUser(owner,"select public.move_patient($1,$2,'assigned',$3)",[v,rev,b]);
    await move(1,pools[0].id);
    await assert.rejects(move(1,pools[1].id),/Stale/);
    await move(2,pools[1].id);
    assert.equal((await query('select bed_id from race_private.bed_reservations where visit_id=$1',[v])).rows[0].bed_id,regulars[0].id);
    await assert.rejects(asUser(owner,"select race_private.transition_visit_without_reservation($1,3,'assigned',$2)",[v,regulars[0].id]),/permission denied/);
    await assert.rejects(move(3,foreignBed),/unavailable/);
    await move(3,regulars[1].id);
    assert.equal((await query('select * from race_private.bed_reservations where visit_id=$1',[v])).rows.length,0);
    assert.equal((await query('select cleaning from race_private.beds where id=$1',[regulars[0].id])).rows[0].cleaning,true);
    assert.equal((await query('select count(*)::int n from race_private.turnovers where race_id=$1 and ended_at is null',[r])).rows[0].n,3);
  });
  await t.test('team commands are owner-only, race-scoped, audited and reject stale changes',async()=>{
    const teamRace=id(95);
    await query('insert into race_private.races(id,owner_id,name) values($1,$2,$3)',[teamRace,owner,'Team test']);
    for (const [user,email] of [[owner,'owner@example.com'],[editor,'editor@example.com'],[viewer,'viewer@example.com'],[outsider,'outsider@example.com']]) {
      await query('update auth.users set email=$2 where id=$1',[user,email]);
    }
    const change=(user,email,expected,next)=>asUser(user,'select public.set_race_member($1,$2,$3,$4)',[teamRace,email,expected,next]);
    for (const user of [editor,viewer,outsider]) {
      await assert.rejects(asUser(user,'select public.race_team($1)',[teamRace]),/Access denied/);
      await assert.rejects(change(user,'editor@example.com',null,'editor'),/Access denied/);
    }
    await assert.rejects(change(owner,'owner@example.com',null,'viewer'),/Owner access/);
    await assert.rejects(change(owner,'missing@example.com',null,'viewer'),/Account not found/);
    await assert.rejects(change(owner,'editor@example.com',null,'owner'),/Invalid role/);
    await change(owner,' EDITOR@EXAMPLE.COM ',null,'viewer');
    await assert.rejects(asUser(editor,'select public.patient_board($1)',[teamRace]),/Access denied/);
    await change(owner,'editor@example.com','viewer','editor');
    await asUser(editor,'select public.patient_board($1)',[teamRace]);
    await assert.rejects(change(owner,'editor@example.com','viewer',null),/Membership changed/);
    const team=(await asUser(owner,'select public.race_team($1) team',[teamRace])).rows[0].team;
    assert.equal(team.length,2);
    assert.ok(team.some(m=>m.role==='owner' && m.id===owner));
    await change(owner,'editor@example.com','editor',null);
    await assert.rejects(asUser(editor,'select public.viewer_status($1)',[teamRace]),/Access denied/);
    assert.equal((await query('select role from race_private.memberships where race_id=$1 and user_id=$2',[race,editor])).rows[0].role,'editor');
    assert.equal((await query('select count(*)::int n from race_private.team_events where race_id=$1',[teamRace])).rows[0].n,3);
    await exec('set role anon');
    await assert.rejects(query('select public.race_team($1)',[teamRace]),/permission denied/);
    await assert.rejects(query('select public.set_race_member($1,$2,null,$3)',[teamRace,'editor@example.com','editor']),/permission denied/);
    await exec('reset role');
  });
  await t.test('real concurrent clients cannot both claim one bed',{skip:!url},async()=>{
    const a=id(50), b=id(51), target=id(35);
    await query('insert into race_private.beds(id,race_id,pod_id,label) values($1,$2,$3,$4)',[target,race,regular,'1-3']);
    await query('insert into race_private.visits(id,race_id) values($1,$3),($2,$3)',[a,b,race]);
    const clients=[new pg.Client({connectionString:url}),new pg.Client({connectionString:url})];
    try {
      for (const c of clients) { await c.connect(); await c.query('set role authenticated'); await c.query("select set_config('request.jwt.claim.sub',$1,false)",[editor]); }
      const results=await Promise.allSettled(clients.map((c,i)=>c.query("select race_private.transition_visit($1,0,'assigned',$2)",[i===0?a:b,target])));
      assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
      assert.equal(results.filter(r=>r.status==='rejected').length,1);
      assert.equal((await query('select * from race_private.placements where bed_id=$1 and ended_at is null',[target])).rows.length,1);
    } finally { for (const c of clients) await c.end(); }
  });
});
