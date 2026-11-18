'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {fixture,withClock,memoryRepository,W}=require('./helpers/scheduled-fixture.cjs');
const A=require('../server/schedule-admission.cjs');
const V=require('../runtime/server/backup_scoped_execution_v5.cjs');
const {createAuthenticatedControlPlaneCollectorV5}=require('../runtime/server/backup_authenticated_collector_v5.cjs');
const {scheduleProfile,observedSchedules}=require('../runtime/server/backup_scheduled_test_profile_v1.cjs');
function journal(x,repo){return A.createScheduledSingleTestJournal({enabled:true,construction:x.construction,journalKey:x.keys.journalCapability,journalRoleKeys:x.roleKeys('journal'),repository:repo,signingKey:x.f.testOnlyKeys.journal,clock:Date.now});}
function caller(x,j,run){return A.createScheduledSingleTestCaller({enabled:true,construction:x.construction,journalKey:x.keys.journalCapability,claim:v=>j.admit(v),run,clock:Date.now});}
function rootOptions(x,wire=x.wire){return {enabled:true,construction:{...x.construction,enrollment:wire.enrollment},selection:wire.selection,request:wire.request,ownerGrant:wire.ownerGrant,custodyReview:wire.custodyReview};}
test('default OFF has no ticket/control/source effect',()=>withClock(async()=>{
 const c=A.createScheduledSingleTestCaller(),j=A.createScheduledSingleTestJournal();
 assert.equal(c.ready,false);assert.equal(j.ready,false);
 await assert.rejects(c.scheduled({}));await assert.rejects(j.admit({}));
}));
test('actual derivative root and42-read collector accept ONLY the profiled Caller schedule after durable consume',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x);let sourceHooks=0;
 W.authenticateCfRootV1(rootOptions(x),Date.now());
 const c=caller(x,journal(x,repo),async(wire)=>{
  assert.equal(repo.consumed,true);assert.equal(W.cfCanonical(wire),W.cfCanonical(x.wire));
  const o=rootOptions(x,wire),issuer=W.createCfWindowV1Issuer({...o,roleKeys:x.roleKeys('verifier'),signingKey:x.f.testOnlyKeys.collector,collector:createAuthenticatedControlPlaneCollectorV5(x.h.options('archive-original-create'))});
  const lease=await issuer.issue({rootMac:W.cfRootMacV1(x.keys.rootControl,o)},{signal:new AbortController().signal});W.verifyCfLeaseV1(W.authenticateCfRootV1(o),lease);
  sourceHooks++;return {sourceHookReached:true};
 });
 assert.deepEqual(await c.scheduled(x.controller()),{sourceHookReached:true});
 assert.deepEqual(repo.calls,['read','consume']);assert.equal(x.h.calls.length,42);assert.equal(sourceHooks,1);
 await assert.rejects(c.scheduled(x.controller()));assert.equal(sourceHooks,1);assert.equal(repo.calls.length,2);
}));
test('concurrent Caller instances issue only one downstream run through durable claim',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x),j=journal(x,repo);let runs=0;
 const calls=[caller(x,j,async()=>++runs),caller(x,j,async()=>++runs)];
 const out=await Promise.allSettled(calls.map(c=>c.scheduled(x.controller())));
 assert.equal(out.filter(r=>r.status==='fulfilled').length,1);assert.equal(runs,1);assert.equal(repo.consumed,true);
}));
test('lost consume reply remains consumed/UNKNOWN and cannot reach source on a new instance',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x,{afterConsume(){throw Error('lost reply');}}),j=journal(x,repo);let runs=0;
 await assert.rejects(caller(x,j,async()=>++runs).scheduled(x.controller()));
 await assert.rejects(caller(x,j,async()=>++runs).scheduled(x.controller()));
 assert.equal(repo.consumed,true);assert.equal(runs,0);assert.deepEqual(repo.calls,['read','consume','read']);
}));
test('lost response after run rejects and does not rearm ticket or retry source',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x),j=journal(x,repo);let runs=0;
 await assert.rejects(caller(x,j,async()=>{runs++;throw Error('response lost after work');}).scheduled(x.controller()));
 await assert.rejects(caller(x,j,async()=>++runs).scheduled(x.controller()));assert.equal(runs,1);assert.equal(repo.consumed,true);
}));
test('early, late, wrong scheduledTime, wrongCron events perform zero ticket/source calls',()=>withClock(async clock=>{
 for(const mutate of [x=>{clock.set(x.profile.scheduledTime-1);return x.controller();},x=>{clock.set(x.profile.deadline);return x.controller();},x=>({...x.controller(),scheduledTime:x.profile.scheduledTime+60000}),x=>({...x.controller(),cron:'* * * * *'})]){
  clock.set(Math.floor(clock.now()/60000)*60000);const x=fixture(),repo=memoryRepository(x);let runs=0;
  const event=mutate(x);await assert.rejects(caller(x,journal(x,repo),async()=>++runs).scheduled(event));assert.equal(repo.calls.length,0);assert.equal(runs,0);
 }
}));
test('same page/instance concurrent calls are latched before awaited ticket read',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x),j=journal(x,repo);let runs=0;const c=caller(x,j,async()=>++runs);
 const r=await Promise.allSettled([c.scheduled(x.controller()),c.scheduled(x.controller())]);
 assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(runs,1);assert.deepEqual(repo.calls,['read','consume']);
}));
test('untrusted admission MAC and whole-profile mismatch cannot cause a repository read',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x),j=journal(x,repo);
 await assert.rejects(j.admit({body:{},mac:'0'.repeat(64)}));assert.deepEqual(repo.calls,[]);
 const bad={...x.construction,root:{...x.f.root,acceptanceSha256:'f'.repeat(64)}};
 assert.equal(A.createScheduledSingleTestCaller({enabled:true,construction:bad,journalKey:x.keys.journalCapability,claim:()=>{},run:()=>{},clock:Date.now}).ready,false);
 assert.equal(A.createScheduledSingleTestJournal({enabled:true,construction:x.construction,journalKey:Buffer.alloc(32,99),journalRoleKeys:x.roleKeys('journal'),repository:repo,signingKey:x.f.testOnlyKeys.journal,clock:Date.now}).ready,false);
}));
test('signed request mutation, invalid external signature and extra credential field fail before consume',()=>withClock(async()=>{
 for(const mutate of [w=>{w.request.deadline++;},w=>{w.ownerGrant.signature=Buffer.alloc(64).toString('base64');},w=>{w.serverKey='sb_secret_FICTIONAL_NEVER_ALLOWED';}]){
  const x=fixture();mutate(x.wire);const repo=memoryRepository(x);let runs=0;
  await assert.rejects(caller(x,journal(x,repo),async()=>++runs).scheduled(x.controller()));assert.equal(repo.consumed,false);assert.equal(runs,0);assert.deepEqual(repo.calls,['read']);
 }
}));
test('a delayed read cannot slide clock/deadline or dispatch the durable consume',()=>withClock(async clock=>{
 const x=fixture(),base=memoryRepository(x),repo=memoryRepository(x,{async read(v,o){const r=await base.read(v,o);clock.set(x.profile.deadline);return r;}});let runs=0;
 await assert.rejects(caller(x,journal(x,repo),async()=>++runs).scheduled(x.controller()));assert.equal(repo.consumed,false);assert.equal(runs,0);assert.deepEqual(repo.calls,['read']);
}));
test('deadline race aborts a noncooperative read and its late return cannot consume or run',()=>withClock(async clock=>{
 const x=fixture(),base=memoryRepository(x);let release,reads=0,runs=0,consumes=0,signal;
 const repo={read(v,o){reads++;signal=o.signal;return new Promise(resolve=>{release=async()=>resolve(await base.read(v,{signal:new AbortController().signal}));});},consume(){consumes++;throw Error('must not dispatch');}};
 clock.set(x.profile.deadline-10);const c=caller(x,journal(x,repo),async()=>++runs);
 await assert.rejects(c.scheduled(x.controller()));await new Promise(resolve=>setTimeout(resolve,5));assert.equal(reads,1);assert.equal(signal.aborted,true);assert.equal(consumes,0);
 await release();await new Promise(resolve=>setImmediate(resolve));assert.equal(consumes,0);assert.equal(runs,0);await assert.rejects(c.scheduled(x.controller()));assert.equal(reads,1);
}));
test('collector holds missing, extra, changed Caller Cron and any schedule on another role',()=>withClock(async()=>{
 for(const mutation of [()=>[],cron=>[{cron},{cron}],()=>[{cron:'* * * * *'}]]){
  const x=fixture();x.h.data.get(x.scheduleURL).result.schedules=mutation(x.profile.cron);
  const collector=createAuthenticatedControlPlaneCollectorV5(x.h.options('archive-original-create'));
  await assert.rejects(collector.collectEvidence(x.h.input()));assert.ok(x.h.calls.length<=42);
 }
 const x=fixture(),url=x.scheduleURL.replace(x.f.participants[0].name,x.f.participants[2].name);
 x.h.data.get(url).result.schedules=[{cron:x.profile.cron}];
 await assert.rejects(createAuthenticatedControlPlaneCollectorV5(x.h.options('archive-original-create')).collectEvidence(x.h.input()));
}));
test('profile/namespace/5s guards and direct-root entrypoint closure remain exact',()=>withClock(async()=>{
 const x=fixture();assert.throws(()=>scheduleProfile({...x.profile,deadline:x.profile.deadline+1}));
 assert.throws(()=>observedSchedules('caller',{schedules:[{cron:x.profile.cron,extra:true}]},x.profile));
 for(const role of [0,2]){const y=fixture();y.f.participants[role].ingress.schedules=role===0?[]:[{cron:y.profile.cron}];y.h.repin();const bad={...y.construction,packetSha256:y.f.packetSha(),enrollment:y.f.enrollment};assert.equal(V.createScopedExecutionV5Validator({enabled:true,...bad,purpose:'archive-original-create',clock:Date.now}).ready,false);}
 const p=path.join(__dirname,'../runtime/workers/backup-cf-v1/caller.mjs'),s=fs.readFileSync(p,'utf8');assert.ok(s.includes('async scheduled('));assert.ok(!s.includes('export class BackupCaller'));assert.ok(s.includes("status:404"));
}));
test('actual private wrappers consume first, keep the same q, and enter original collector before a deliberate source stop',()=>withClock(async()=>{
 const x=fixture(),repo=memoryRepository(x),filename=path.join(__dirname,'../runtime/workers/backup-cf-v1/private-runtime.cjs');
 const m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));
 // The real reviewed wrapper macro is supplied only with this ephemeral PUBLIC
 // fixture key. No real compiler, provider key or deployed artifact is asserted.
 m._compile('const __RR_PROTECTED_REVIEWER_JSON__='+JSON.stringify(JSON.stringify(x.f.reviewerKey))+';\n'+fs.readFileSync(filename,'utf8'),filename);
 const runtime=m.exports,originalFetch=globalThis.fetch;
 const p=x.profile,id={ticketId:p.ticketId,cron:p.cron,scheduledTime:p.scheduledTime,deadline:p.deadline,rootSha256:W.cfDigest(x.f.root),acceptanceSha256:W.cfDigest(x.f.executionAcceptance),requestSha256:p.requestSha256,selectionSha256:p.selectionSha256};
 let noRetry=0,sourceStops=0,disposed=0;const posts=[];
 const rpc=async pending=>{const out={...await pending};Object.defineProperty(out,Symbol.dispose,{value(){disposed++;},enumerable:false});return out;};
 globalThis.fetch=async(url,init)=>{
  const prefix='https://tzymapahsfiyhgilsmxl.supabase.co/rest/v1/rpc/';assert.ok(url.startsWith(prefix));assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,undefined);posts.push(url);
  const args=JSON.parse(init.body),value=url.endsWith('_read_v1')?await repo.read(id,{signal:init.signal}):await repo.consume({...id,envelopeSha256:args.p_envelope_sha256,nonce:args.p_nonce},{signal:init.signal});
  const response=Response.json(value);Object.defineProperty(response,'url',{value:url});return response;
 };
 try{
  const roles={rootControl:'ROOT_CONTROL_HMAC',sourceCapability:'SOURCE_CAPABILITY_HMAC',sourceSeal:'SOURCE_INVENTORY_SEAL_HMAC',journalCapability:'JOURNAL_CAPABILITY_HMAC',upload:'RACK_RELIC_TEST_R2_CAPABILITY_HEX',read:'RACK_RELIC_TEST_R2_RECEIPT_READ_CAPABILITY_HEX',dispatch:'ARCHIVE_DISPATCH_HMAC',manifest:'RACK_RELIC_BACKUP_MANIFEST_HEX'};
  const env={...x.f.secretValues(),RACK_RELIC_BACKUP_V2_ENABLED:'false',RACK_RELIC_BACKUP_V5_ENABLED:'true',JOURNAL_FACADE_ENABLED:'false',JOURNAL_V5_FACADE_ENABLED:'true',JOURNAL_SUPABASE_SERVER_KEY:'sb_secret_FICTIONAL_SCHEDULE_WRAPPER_ONLY_1234567890',JOURNAL_RECEIPT_SIGNING_KEY:x.f.testOnlyKeys.journal.export({type:'pkcs8',format:'der'}).toString('base64')};
  for(const [n,b]of Object.entries(roles))env[b]=x.keys[n].toString('hex');
  env.TO_JOURNAL={consumeScheduledTicket:message=>rpc(runtime.scheduledClaim(env,message))};
  env.TO_VERIFIER={issue:(wire,v)=>rpc((async()=>{assert.equal(repo.consumed,true);assert.equal(W.cfCanonical(wire),W.cfCanonical(x.wire));const o=rootOptions(x,wire),issuer=W.createCfWindowV1Issuer({...o,roleKeys:x.roleKeys('verifier'),signingKey:x.f.testOnlyKeys.collector,collector:createAuthenticatedControlPlaneCollectorV5(x.h.options('archive-original-create'))});const lease=await issuer.issue(v,{signal:new AbortController().signal});return {lease,signedWindowBinding:issuer.sourceBinding()};})())};
  env.TO_GATEWAY={inspectNewManifest:wire=>rpc((async()=>{assert.equal(repo.consumed,true);return {version:'rr-cf-new-manifest-absent-v1',rootRequestSha256:W.cfDigest(wire.request),snapshotId:wire.selection.snapshotId,absent:true};})())};
  env.TO_SOURCE={async capture(){assert.equal(repo.consumed,true);sourceStops++;throw Error('deliberate source stop; no photo IO');}};
  const result=await runtime.scheduled(env,{...x.controller(),noRetry(){noRetry++;}});
  assert.equal(result.photoSnapshotComplete,false);assert.equal(repo.consumed,true);assert.equal(posts.length,2);assert.equal(x.h.calls.length,42);assert.equal(sourceStops,1);assert.equal(noRetry,1);assert.equal(disposed,3);
  await assert.rejects(runtime.scheduled(env,{...x.controller(),noRetry(){noRetry++;}}));assert.equal(sourceStops,1);assert.equal(posts.length,3);assert.equal(x.h.calls.length,42);
  const disabled={...env,RACK_RELIC_BACKUP_V5_ENABLED:'false'};await assert.rejects(runtime.scheduled(disabled,{...x.controller(),noRetry(){}}));assert.equal(posts.length,3);
 }finally{globalThis.fetch=originalFetch;}
}));
