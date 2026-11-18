'use strict';
// NEW local derivative tests only. In-memory existing PGlite is not native PG17,
// managed acceptance, independent-session lock proof, deployment or activation.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const R=require('../server/schedule-ticket-repository.cjs');
const sql=fs.readFileSync(path.join(__dirname,'../sql/schedule_ticket_v1.sql'),'utf8');
const h=x=>createHash('sha256').update(x).digest('hex'),canonical=R.canonicalScheduleTicketV1;
const slot=1893456000000,nonce='1'.repeat(32),key='sb_secret_LOCAL_FICTIONAL_ONLY_123456789';
const base={ticketId:'11111111-1111-4111-8111-111111111111',cron:'0 0 1 1 *',scheduledTime:slot,deadline:slot+5000,rootSha256:'1'.repeat(64),acceptanceSha256:'2'.repeat(64)};
function fixtureEnvelope(time=slot){
 const selection={snapshotId:'22222222-2222-4222-8222-222222222222',sourceProjectRef:'tzymapahsfiyhgilsmxl',sourceBucket:'listing-photos',sourcePath:'33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/local-test.png',sourcePathSha256:'4'.repeat(64)};
 const selectionSha256=h(canonical(selection));
 const request={version:'rr-cf-backup-root-request-v1',selectionSha256,executionId:'5'.repeat(32),nonce:'6'.repeat(32),requestedAt:time,deadline:time+5000};
 // Deliberately fictional authority fields: repository is NOT signature authority.
 const envelope={selection,request,ownerGrant:{fixture:true},enrollment:{fixture:true},custodyReview:{fixture:true},collectorGrantReview:{fixture:true},sourcePrincipalGrant:{fixture:true},lease:null,signedWindowBinding:null};
 const envelopeText=canonical(envelope),envelopeSha256=h(envelopeText),identity={...base,scheduledTime:time,deadline:time+5000,requestSha256:h(canonical(request)),selectionSha256};
 return {identity,envelope,envelopeText,envelopeSha256,record:{version:'rr-schedule-ticket-record-v1',...identity,envelopeText,envelopeSha256,consumed:false}};
}
const data=fixtureEnvelope(),signal=()=>new AbortController().signal;
const response=p=>new Response(JSON.stringify(p),{headers:{'content-type':'application/json'}});
function withClock(t,time=slot+100){t.mock.method(Date,'now',()=>time);}
function rpcArgs(x){return [x.ticketId,x.cron,x.scheduledTime,x.deadline,x.rootSha256,x.acceptanceSha256,x.requestSha256,x.selectionSha256];}
const readCall='SELECT public.rr_test_backup_schedule_ticket_read_v1($1,$2,$3,$4,$5,$6,$7,$8) AS p';
const consumeCall='SELECT public.rr_test_backup_schedule_ticket_consume_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS p';
async function dbFixture(t,{controlled=true,prelude='',install=true}={}){
 const db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;CREATE SCHEMA rr_sandbox;'+prelude);
 if(controlled){await db.exec('CREATE SCHEMA rr_fixture;CREATE TABLE rr_fixture.clock(now_ms bigint NOT NULL);INSERT INTO rr_fixture.clock VALUES('+String(slot+100)+');CREATE FUNCTION rr_fixture.clock_now() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$SELECT to_timestamp(now_ms::numeric/1000) FROM rr_fixture.clock$$;');}
 if(install)await db.exec(controlled?sql.replaceAll('clock_timestamp()','rr_fixture.clock_now()'):sql);
 return db;
}
async function seed(db,d=data){await db.query('INSERT INTO rr_sandbox.backup_schedule_ticket_v1(ticket_id,cron,scheduled_time,deadline,root_sha256,acceptance_sha256,request_sha256,selection_sha256,envelope_text,envelope_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[...rpcArgs(d.identity),d.envelopeText,d.envelopeSha256]);}
async function grantFixture(db){await db.exec('GRANT EXECUTE ON FUNCTION public.rr_test_backup_schedule_ticket_read_v1(uuid,text,bigint,bigint,text,text,text,text),public.rr_test_backup_schedule_ticket_consume_v1(uuid,text,bigint,bigint,text,text,text,text,text,text) TO service_role;');}
test('default OFF, legacy/publishable/malformed keys and missing signal do not dispatch',async t=>{
 withClock(t);let calls=0;const transport=async()=>{calls++;return response(data.record);};
 for(const opts of [{},{enabled:false,serviceKey:key},{enabled:true,serviceKey:'eyJLegacyJwt'},{enabled:true,serviceKey:'sb_publishable_fictional'},{enabled:true,serviceKey:'sb_secret_short'},{enabled:true,serviceKey:key+'\n'}]){
  const repo=R.createScheduleTicketRepositoryV1({...opts,transport});assert.equal(repo.ready,false);await assert.rejects(repo.read(data.identity,{signal:signal()}),/HELD/);
 }
 const repo=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport});await assert.rejects(repo.read(data.identity),/HELD/);assert.equal(calls,0);
});
test('READ fixed origin/POST/no-redirect, eight arguments and canonical immutable returned envelope',async t=>{
 withClock(t);let calls=0;const repo=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async(url,o)=>{
  calls++;assert.equal(url,'https://tzymapahsfiyhgilsmxl.supabase.co/rest/v1/rpc/rr_test_backup_schedule_ticket_read_v1');assert.equal(o.method,'POST');assert.equal(o.redirect,'manual');assert.equal(o.cache,'no-store');assert.equal(o.headers.apikey,key);assert.equal(o.headers.authorization,undefined);assert.equal(o.headers['accept-encoding'],'identity');assert.ok(o.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(JSON.parse(o.body)).sort(),['p_ticket_id','p_cron','p_scheduled_time','p_deadline','p_root_sha256','p_acceptance_sha256','p_request_sha256','p_selection_sha256'].sort());assert.equal(o.body.includes(data.envelopeSha256),false);return response(data.record);
 }});assert.deepEqual(await repo.read(data.identity,{signal:signal()}),data.record);assert.equal(calls,1);
});
test('CONSUME exact hash+nonce, winner claim and consumed responses never expose envelope',async t=>{
 withClock(t);const x={...data.identity,envelopeSha256:data.envelopeSha256,nonce};let calls=0;
 const claim={version:'rr-schedule-ticket-claim-v1',ticketId:x.ticketId,nonce,envelopeSha256:x.envelopeSha256,claimedAt:slot+100,consumed:true};
 const consumed={version:'rr-schedule-ticket-consumed-v1',ticketId:x.ticketId,consumed:true};
 const repo=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async(url,o)=>{assert.ok(url.endsWith('/rr_test_backup_schedule_ticket_consume_v1'));const p=JSON.parse(o.body);assert.equal(p.p_envelope_sha256,x.envelopeSha256);assert.equal(p.p_nonce,nonce);assert.equal(Object.keys(p).length,10);return response(calls++?consumed:claim);}});
 assert.deepEqual(await repo.consume(x,{signal:signal()}),claim);assert.deepEqual(await repo.consume(x,{signal:signal()}),consumed);assert.equal(calls,2);
});
test('wrong identities, hidden/accessor input, early/late/renewed slot and zero nonce never dispatch',async t=>{
 withClock(t);let calls=0;const repo=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async()=>{calls++;return response(data.record);}});
 for(const patch of [{extra:true},{deadline:slot+5001},{scheduledTime:slot+1},{scheduledTime:slot+60000,deadline:slot+65000},{scheduledTime:slot-60000,deadline:slot-55000},{rootSha256:'0'.repeat(64)},{cron:'* * * * *\n'},{ticketId:'../wrong'},{ticketId:[data.identity.ticketId]}])await assert.rejects(repo.read({...data.identity,...patch},{signal:signal()}),/HELD/);
 const hidden={...data.identity};Object.defineProperty(hidden,'hidden',{value:true});await assert.rejects(repo.read(hidden,{signal:signal()}),/HELD/);
 const accessor={...data.identity};Object.defineProperty(accessor,'cron',{get(){throw Error('must not execute');},enumerable:true});await assert.rejects(repo.read(accessor,{signal:signal()}),/HELD/);
 await assert.rejects(repo.consume({...data.identity,envelopeSha256:data.envelopeSha256,nonce:'0'.repeat(32)},{signal:signal()}),/HELD/);
 await assert.rejects(repo.consume({...data.identity,envelopeSha256:data.envelopeSha256,nonce:[nonce]},{signal:signal()}),/HELD/);assert.equal(calls,0);
});
test('redirect/cache/wrong tuple/hash/noncanonical/duplicate/oversized/malformed response is HOLD, never retry',async t=>{
 withClock(t);const bad=[()=>new Response(null,{status:302,headers:{location:'https://example.invalid'}}),()=>new Response(JSON.stringify(data.record),{headers:{'content-type':'application/json',age:'1'}}),()=>response({...data.record,rootSha256:'8'.repeat(64)}),()=>response({...data.record,envelopeSha256:'8'.repeat(64)}),()=>response({...data.record,envelopeText:JSON.stringify(data.envelope,null,2)}),()=>new Response('{"version":1,"version":2}',{headers:{'content-type':'application/json'}}),()=>new Response('x'.repeat(524289),{headers:{'content-type':'application/json'}}),()=>new Response('{}',{headers:{'content-type':'text/plain'}}),()=>response({...data.record,credentials:'forbidden-extra'})];
 for(const answer of bad){let calls=0;const repo=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async()=>{calls++;return answer();}});await assert.rejects(repo.read(data.identity,{signal:signal()}),/HELD/);assert.equal(calls,1);}
});
test('aborted/uncertain CONSUME is HOLD with no automatic retry or late acceptance',async t=>{
 withClock(t);let calls=0;const c=new AbortController();let started;
 const began=new Promise(resolve=>{started=resolve;});const repo=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async()=>{calls++;started();return new Promise(()=>{});}});
 const pending=repo.consume({...data.identity,envelopeSha256:data.envelopeSha256,nonce},{signal:c.signal});await began;c.abort();await assert.rejects(pending,/HELD/);assert.equal(calls,1);
 const pre=new AbortController();pre.abort();await assert.rejects(repo.read(data.identity,{signal:pre.signal}),/HELD/);assert.equal(calls,1);
});
test('nonidentity encoding rejects even without length; identity preserves the strict length equality',async t=>{
 withClock(t);
 for(const encoding of ['gzip','br','identity, gzip','']){
  let calls=0;const repo=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async(_url,o)=>{calls++;assert.equal(o.headers['accept-encoding'],'identity');return new Response(JSON.stringify(data.record),{headers:{'content-type':'application/json','content-encoding':encoding}});}});
  await assert.rejects(repo.read(data.identity,{signal:signal()}),/HELD/);assert.equal(calls,1);
 }
 const text=JSON.stringify(data.record),size=Buffer.byteLength(text);
 const valid=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async()=>new Response(text,{headers:{'content-type':'application/json','content-encoding':'IDENTITY','content-length':String(size)}})});
 assert.deepEqual(await valid.read(data.identity,{signal:signal()}),data.record);
 const wrongLength=R.createScheduleTicketRepositoryV1({enabled:true,serviceKey:key,transport:async()=>new Response(text,{headers:{'content-type':'application/json','content-encoding':'identity','content-length':String(size+1)}})});
 await assert.rejects(wrongLength.read(data.identity,{signal:signal()}),/HELD/);
});
test('SQL source actual-clock atomic install is empty/closed with exact RPC signatures and no old-table dependency',async t=>{
 assert.equal((sql.match(/clock_timestamp\(\)/g)||[]).length,3);assert.equal(/\bCOMMIT\s*;/i.test(sql),false);assert.equal(/CREATE\s+SCHEMA|CREATE\s+EXTENSION|REFERENCES\s+rr_sandbox\./i.test(sql),false);
 const db=await dbFixture(t,{controlled:false});assert.equal((await db.query('SELECT count(*)::int n FROM rr_sandbox.backup_schedule_ticket_v1')).rows[0].n,0);
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await db.query("SELECT has_table_privilege($1,'rr_sandbox.backup_schedule_ticket_v1','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') p",[role])).rows[0].p,false);
  for(const name of ['rr_test_backup_schedule_ticket_read_v1(uuid,text,bigint,bigint,text,text,text,text)','rr_test_backup_schedule_ticket_consume_v1(uuid,text,bigint,bigint,text,text,text,text,text,text)'])assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') p',[role,'public.'+name])).rows[0].p,false);
 }
 assert.equal((await db.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='rr_sandbox.backup_schedule_ticket_v1'::regclass AND contype='f'")).rows[0].n,0);
});
test('SQL READ and CAS: one winner, all replay nonces consumed without envelope; no table access granted',async t=>{
 const db=await dbFixture(t);await seed(db);await grantFixture(db);await db.exec('SET ROLE service_role');
 assert.deepEqual((await db.query(readCall,rpcArgs(data.identity))).rows[0].p,data.record);
 const results=await Promise.all(Array.from({length:8},(_,i)=>db.query(consumeCall,[...rpcArgs(data.identity),data.envelopeSha256,(i+1).toString(16).repeat(32)])));
 // PGlite queues this ONE connection. This is not independent-session lock proof.
 assert.equal(results.filter(r=>r.rows[0].p.version==='rr-schedule-ticket-claim-v1').length,1);
 const losers=results.slice(1).map(r=>r.rows[0].p);for(const p of losers)assert.deepEqual(p,{version:'rr-schedule-ticket-consumed-v1',ticketId:base.ticketId,consumed:true});
 assert.deepEqual((await db.query(readCall,rpcArgs(data.identity))).rows[0].p,losers[0]);
 await assert.rejects(db.query('SELECT * FROM rr_sandbox.backup_schedule_ticket_v1'),/permission denied/);
});
test('SQL every tuple/hash mismatch, early/late/zero nonce rejects without consumption',async t=>{
 const db=await dbFixture(t);await seed(db);const a=rpcArgs(data.identity);
 for(let i=0;i<a.length;i++){const wrong=a.slice();wrong[i]=i===0?'99999999-9999-4999-8999-999999999999':i===1?'* * * * *':i===2||i===3?a[i]+1:'9'.repeat(64);await assert.rejects(db.query(readCall,wrong),/SLOT_HELD/);await assert.rejects(db.query(consumeCall,[...wrong,data.envelopeSha256,nonce]),/SLOT_HELD/);}
 await assert.rejects(db.query(consumeCall,[...a,'9'.repeat(64),nonce]),/SLOT_HELD/);await assert.rejects(db.query(consumeCall,[...a,data.envelopeSha256,'0'.repeat(32)]),/NONCE_HELD/);
 for(const time of [slot-1,slot+5000]){await db.query('UPDATE rr_fixture.clock SET now_ms=$1',[time]);await assert.rejects(db.query(readCall,a),/SLOT_HELD/);await assert.rejects(db.query(consumeCall,[...a,data.envelopeSha256,nonce]),/SLOT_HELD/);}
 assert.equal((await db.query('SELECT claimed_nonce FROM rr_sandbox.backup_schedule_ticket_v1')).rows[0].claimed_nonce,null);
});
test('SQL claim is permanently one-way: immutable tuple/text, no delete/truncate/reseed/reset',async t=>{
 const db=await dbFixture(t);await seed(db);
 for(const query of ["UPDATE rr_sandbox.backup_schedule_ticket_v1 SET root_sha256=repeat('8',64)",'DELETE FROM rr_sandbox.backup_schedule_ticket_v1','TRUNCATE rr_sandbox.backup_schedule_ticket_v1'])await assert.rejects(db.exec(query),/IMMUTABLE/);
 await assert.rejects(seed(db),/duplicate key/);await db.query(consumeCall,[...rpcArgs(data.identity),data.envelopeSha256,nonce]);
 for(const query of ['UPDATE rr_sandbox.backup_schedule_ticket_v1 SET claimed_nonce=NULL,claimed_at=NULL',"UPDATE rr_sandbox.backup_schedule_ticket_v1 SET claimed_nonce=repeat('2',32)","UPDATE rr_sandbox.backup_schedule_ticket_v1 SET envelope_text='{}'"] )await assert.rejects(db.exec(query),/IMMUTABLE/);
});
test('SQL actual unchanged wall clock rejects a past slot; no fixture clock substitution claims actual compatibility',async t=>{
 const db=await dbFixture(t,{controlled:false});const actual=Number((await db.query('SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint now')).rows[0].now),past=fixtureEnvelope(Math.floor(actual/60000)*60000-60000);await seed(db,past);
 await assert.rejects(db.query(readCall,rpcArgs(past.identity)),/SLOT_HELD/);await assert.rejects(db.query(consumeCall,[...rpcArgs(past.identity),past.envelopeSha256,nonce]),/SLOT_HELD/);
});
test('SQL install rolls back fully on inherited hostile grants, partial names and outer transaction rollback',async t=>{
 const hostile=await dbFixture(t,{controlled:false,install:false,prelude:'CREATE ROLE rr_fixture_hostile;GRANT rr_fixture_hostile TO service_role;ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO rr_fixture_hostile;'});
 await assert.rejects(hostile.exec(sql),/OWNER_ONLY_ACL_HELD|EFFECTIVE_PRIVILEGE_HELD/);assert.equal((await hostile.query("SELECT to_regclass('rr_sandbox.backup_schedule_ticket_v1') r")).rows[0].r,null);
 assert.equal((await hostile.query("SELECT count(*)::int n FROM pg_proc WHERE proname='rr_test_backup_schedule_ticket_read_v1'")).rows[0].n,0);
 const partial=await dbFixture(t,{controlled:false,install:false,prelude:'CREATE FUNCTION public.rr_test_backup_schedule_ticket_read_v1() RETURNS int LANGUAGE sql AS $$SELECT 1$$;'});
 await assert.rejects(partial.exec(sql),/INSTALL_TARGET_HELD/);assert.equal((await partial.query("SELECT to_regclass('rr_sandbox.backup_schedule_ticket_v1') r")).rows[0].r,null);
 const outer=await dbFixture(t,{controlled:false,install:false});await outer.exec('BEGIN');await outer.exec(sql);await outer.exec('ROLLBACK');assert.equal((await outer.query("SELECT to_regclass('rr_sandbox.backup_schedule_ticket_v1') r")).rows[0].r,null);
});
test('SQL install fixes pg_catalog search path before resolving any installer helper or new expression',async t=>{
 const db=await dbFixture(t,{controlled:false,install:false,prelude:"CREATE SCHEMA rr_fixture_hostile;CREATE FUNCTION rr_fixture_hostile.to_regnamespace(text) RETURNS regnamespace LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'HOSTILE_SEARCH_PATH_EXECUTED';END$$;SET search_path=rr_fixture_hostile,pg_catalog;"});
 await assert.rejects(db.query("SELECT to_regnamespace('rr_sandbox')"),/HOSTILE_SEARCH_PATH_EXECUTED/);
 const before=(await db.query("SELECT pg_catalog.current_setting('search_path') p")).rows[0].p;
 await db.exec('BEGIN');await db.exec(sql);assert.equal((await db.query('SELECT count(*)::int n FROM rr_sandbox.backup_schedule_ticket_v1')).rows[0].n,0);
 assert.equal((await db.query("SELECT pg_catalog.current_setting('search_path') p")).rows[0].p,before);
 await db.exec('ROLLBACK');assert.equal((await db.query("SELECT pg_catalog.to_regclass('rr_sandbox.backup_schedule_ticket_v1') p")).rows[0].p,null);
});
test('SQL owner-only fence rejects unrelated custom-role default table/function grants and rolls back all additions',async t=>{
 for(const grant of ['ALTER DEFAULT PRIVILEGES IN SCHEMA rr_sandbox GRANT SELECT ON TABLES TO rr_fixture_unrelated;','ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO rr_fixture_unrelated;']){
  const db=await dbFixture(t,{controlled:false,install:false,prelude:'CREATE ROLE rr_fixture_unrelated;'+grant});
  assert.equal((await db.query("SELECT pg_has_role('service_role','rr_fixture_unrelated','MEMBER') p")).rows[0].p,false);
  await assert.rejects(db.exec(sql),/OWNER_ONLY_ACL_HELD/);
  assert.equal((await db.query("SELECT to_regclass('rr_sandbox.backup_schedule_ticket_v1') r")).rows[0].r,null);
  assert.equal((await db.query("SELECT count(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','rr_sandbox') AND p.proname IN('backup_schedule_ticket_no_reset_v1','rr_test_backup_schedule_ticket_read_v1','rr_test_backup_schedule_ticket_consume_v1')")).rows[0].n,0);
 }
});
