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
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  const migrationDir = new URL('../migrations/',import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n=>n.endsWith('.sql')).sort()) {
    await exec(await readFile(new URL(name,migrationDir),'utf8'));
  }
  await exec(`insert into auth.users values ('${owner}'),('${editor}'),('${viewer}'),('${outsider}');
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
    await assert.rejects(transition(editor,visit,3,'assigned',bed),/Bed unavailable/);
    const turnover=(await query('select id from race_private.turnovers where bed_id=$1 and ended_at is null',[bed])).rows[0].id;
    await asUser(editor,'select race_private.ready_bed($1,$2)',[bed,turnover]);
    await assert.rejects(asUser(editor,'select race_private.ready_bed($1,$2)',[bed,turnover]),/Stale turnover/);
    await transition(editor,visit,3,'assigned',bed);
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
    const report=(await asUser(owner,'select * from race_private.report_preview($1)',[race])).rows[0];
    assert.equal(report.total_visits,2); assert.equal(report.incomplete_visits,1);
    assert.equal(report.notification_samples,1); assert.equal(report.notification_mean_seconds,600);
    assert.equal(report.medical_samples,1); assert.equal(report.medical_mean_seconds,3600);
    assert.equal(report.medical_median_seconds,3600);
    assert.equal(report.pool_samples,1); assert.equal(report.pool_mean_seconds,600);
    assert.equal(report.transfers,3); assert.equal(report.other,1);
    assert.equal(/FAKE|Dizziness|Private|Fictional detail|visit_id|bib|complaint|notes/.test(JSON.stringify(report)),false);
    assert.equal((await query('select * from race_private.reports')).rows.length,0);
    await assert.rejects(asUser(editor,'select * from race_private.report_preview($1)',[race]),/Access denied/);
    await assert.rejects(asUser(owner,'select * from race_private.report_preview($1)',[foreignRace]),/Access denied/);
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
